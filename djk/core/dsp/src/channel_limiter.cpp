#include <cypherdj/dsp/channel_limiter.h>

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/denormal.h>

namespace cypherdj::dsp {

namespace {
constexpr int kInterpTaps = 97;  // 4 * 24 + 1: centre on a sample, delay 12 input samples
constexpr double kInterpBeta = 6.0;
constexpr double kPi = 3.14159265358979323846;

float decke_linear(float db, bool echtspitze) {
    double reserve = KanalLimiter::kRundungsReserveDb;
    if (echtspitze) reserve += KanalLimiter::kInterpReserveDb;
    return static_cast<float>(std::pow(10.0, (static_cast<double>(db) - reserve) / 20.0));
}
}  // namespace

KanalLimiter::KanalLimiter(double fs, const KanalLimiterEinstellung& e) : fs_(fs > 0.0 ? fs : kAbtastrate) {
    // 4x interpolator: sinc (cut-off fs/2) with Kaiser window, zero taps left out, so phase 0 is the sample
    // itself. Not normalised: the centre tap is exactly 1 and phase 0 reproduces the input bit-exactly.
    for (int f = 0; f < kInterpPhasen; ++f) i_n_[f] = 0;
    const double i0_beta = std::cyl_bessel_i(0.0, kInterpBeta);
    for (int j = 0; j < kInterpTaps; ++j) {
        const double m = (static_cast<double>(j) - (kInterpTaps - 1) / 2.0) / kInterpPhasen;
        const double sinc = std::fabs(m) < 1e-12 ? 1.0 : std::sin(kPi * m) / (kPi * m);
        const double r = 2.0 * j / (kInterpTaps - 1) - 1.0;
        const double c = sinc * std::cyl_bessel_i(0.0, kInterpBeta * std::sqrt(std::max(0.0, 1.0 - r * r))) / i0_beta;
        if (std::fabs(c) > 1e-10) {
            const int f = j % kInterpPhasen;
            i_koeff_[f][i_n_[f]] = c;
            i_index_[f][i_n_[f]] = j / kInterpPhasen;
            ++i_n_[f];
        }
    }

    echtspitze_ = e.echtspitze;
    const float vorhalt_ms = std::clamp(std::isfinite(e.vorhalt_ms) ? e.vorhalt_ms : 1.5f, 0.1f, 20.0f);
    anstieg_ = std::clamp(static_cast<int>(std::lround(vorhalt_ms * 0.001 * fs_)), 1, kMaxAnstieg);
    fenster_ = anstieg_ + 2 * kHalten + 1;
    latenz_ = anstieg_ + kHalten + (echtspitze_ ? kInterpVerzug : 0);
    setze_decke_db(e.decke_db);
    setze_abklingen_ms(e.abklingen_ms);
    leeren();
}

void KanalLimiter::setze_decke_db(float db) {
    decke_db_ = std::clamp(std::isfinite(db) ? db : 0.0f, -60.0f, 0.0f);
    decke_ = decke_linear(decke_db_, echtspitze_);
}

void KanalLimiter::setze_abklingen_ms(float ms) {
    const double t = std::clamp(std::isfinite(ms) ? static_cast<double>(ms) : 80.0, 1.0, 2000.0);
    abkling_koeff_ = 1.0 - std::exp(-1.0 / (t * 0.001 * fs_));
}

void KanalLimiter::leeren() {
    for (auto& k : i_z_)
        for (float& v : k) v = 0.0f;
    i_pos_ = 0;
    min_kopf_ = min_ende_ = min_n_ = 0;
    zeit_ = 0;
    h_rel_ = 1.0;
    for (float& v : mittel_ring_) v = 1.0f;
    mittel_pos_ = 0;
    mittel_summe_ = anstieg_ + 1;
    unter_eins_ = 0;
    for (auto& k : verz_)
        for (float& v : k) v = 0.0f;
    verz_pos_ = 0;
    kleinste_verstaerkung_ = 1.0f;
    letzte_verstaerkung_ = 1.0f;
}

float KanalLimiter::spitze(float xl, float xr) {
    if (!echtspitze_) return std::max(std::fabs(xl), std::fabs(xr));
    // Values at the times n - 12 + f/4; phase 0 is the sample n - 12 itself (centre tap 1, other taps zero).
    i_z_[0][i_pos_] = xl;
    i_z_[1][i_pos_] = xr;
#ifdef CYPHERDJ_DSP_MUTATION_LIMITER_OHNE_ECHTSPITZE
    constexpr int phasen = 1;  // mutation: sample peaks only
#else
    constexpr int phasen = kInterpPhasen;
#endif
    float s = 0.0f;
    for (int c = 0; c < 2; ++c)
        for (int f = 0; f < phasen; ++f) {
            double acc = 0.0;
            for (int t = 0; t < i_n_[f]; ++t) {
                int i = i_pos_ - i_index_[f][t];
                if (i < 0) i += kInterpAbgriffe;
                acc += static_cast<double>(i_z_[c][i]) * i_koeff_[f][t];
            }
            s = std::max(s, static_cast<float>(std::fabs(acc)));
        }
    if (++i_pos_ == kInterpAbgriffe) i_pos_ = 0;
    return s;
}

float KanalLimiter::naechste_verstaerkung(float s) {
    const float q = s > decke_ ? decke_ / s : 1.0f;

    // sliding minimum over fenster_ values
    constexpr int cap = kMaxFenster + 1;
    while (min_n_ > 0) {
        const int letzte = (min_ende_ - 1 + cap) % cap;
        if (min_wert_[letzte] < q) break;
        min_ende_ = letzte;
        --min_n_;
    }
    min_wert_[min_ende_] = q;
    min_zeit_[min_ende_] = zeit_;
    min_ende_ = (min_ende_ + 1) % cap;
    ++min_n_;
    while (min_zeit_[min_kopf_] <= zeit_ - fenster_) {
        min_kopf_ = (min_kopf_ + 1) % cap;
        --min_n_;
    }
    ++zeit_;
    const double h = min_wert_[min_kopf_];

    // release: down at once, up one-pole, never above h
    if (h < h_rel_) {
        h_rel_ = h;
    } else {
        h_rel_ += (h - h_rel_) * abkling_koeff_;
        if (h - h_rel_ < 1e-7) h_rel_ = h;
    }

    // moving average over anstieg_ + 1 values; exactly 1 when all values are 1
    const float neu = static_cast<float>(h_rel_);
    const float alt = mittel_ring_[mittel_pos_];
    mittel_ring_[mittel_pos_] = neu;
    if (++mittel_pos_ == anstieg_ + 1) mittel_pos_ = 0;
    if (alt < 1.0f) --unter_eins_;
    if (neu < 1.0f) ++unter_eins_;
    if (unter_eins_ == 0) {
        mittel_summe_ = anstieg_ + 1;
        return 1.0f;
    }
    mittel_summe_ += static_cast<double>(neu) - static_cast<double>(alt);
    return static_cast<float>(mittel_summe_ / (anstieg_ + 1));
}

void KanalLimiter::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n) {
    [[maybe_unused]] DenormalSchutz schutz;
#ifdef CYPHERDJ_DSP_MUTATION_LIMITER_OHNE_VORHALT
    const int verzug = 0;  // mutation: gain computed with lookahead, but the signal is not delayed
#else
    const int verzug = latenz_;
#endif
    constexpr int ring = kMaxLatenz + 1;
    for (int i = 0; i < n; ++i) {
        const float xl = std::isfinite(in_l[i]) ? in_l[i] : 0.0f;
        const float xr = std::isfinite(in_r[i]) ? in_r[i] : 0.0f;
        const float g = naechste_verstaerkung(spitze(xl, xr));
        kleinste_verstaerkung_ = std::min(kleinste_verstaerkung_, g);
        verz_[0][verz_pos_] = xl;
        verz_[1][verz_pos_] = xr;
        int lese = verz_pos_ - verzug;
        if (lese < 0) lese += ring;
        out_l[i] = verz_[0][lese] * g;
        out_r[i] = verz_[1][lese] * g;
        if (++verz_pos_ == ring) verz_pos_ = 0;
        letzte_verstaerkung_ = g;
    }
}

float KanalLimiter::groesste_absenkung_db() {
    const float db = static_cast<float>(20.0 * std::log10(static_cast<double>(kleinste_verstaerkung_)));
    kleinste_verstaerkung_ = 1.0f;
    return db;
}

}  // namespace cypherdj::dsp
