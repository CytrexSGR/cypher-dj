#include <cypherdj/dsp/spectrum.h>

#include <algorithm>
#include <cmath>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr std::size_t kRingMaske = SpektrumAnalysator::kRing - 1;
constexpr double kHannEnbw = 1.5;          // equivalent noise bandwidth of the Hann window in bins
constexpr double kLeistungBoden = 1e-30;   // below this the smoothed power is 0 (no denormals, < kStummDb)
static_assert((SpektrumAnalysator::kRing & kRingMaske) == 0, "ring size must be a power of two");
static_assert(SpektrumAnalysator::kRing >= kMaxFrames + SpektrumAnalysator::kMaxGroesse, "ring too small");
static_assert(std::atomic<std::size_t>::is_always_lock_free, "ring indices must be lock-free");
static_assert(std::atomic<long>::is_always_lock_free, "loss counter must be lock-free");

bool gueltige_groesse(int n) { return n == 1024 || n == 2048 || n == 4096; }
bool gueltige_ueberlappung(int u) { return u == 1 || u == 2 || u == 4 || u == 8; }
float endlich_oder(float v, float ersatz) { return std::isfinite(v) ? v : ersatz; }
}  // namespace

// ------------------------------------------------------------------------------------------------ Fft

Fft::Fft() {
    for (int k = 0; k < kMax / 2; ++k) {
        cos_[k] = std::cos(2.0 * kPi * k / kMax);
        sin_[k] = std::sin(2.0 * kPi * k / kMax);
    }
    setze_groesse(kMax);
}

bool Fft::setze_groesse(int n) {
    if (n < 2 || n > kMax || (n & (n - 1)) != 0) return false;
    n_ = n;
    int bits = 0;
    while ((1 << bits) < n) ++bits;
    for (int i = 0; i < n; ++i) {
        int r = 0;
        for (int b = 0; b < bits; ++b) r |= ((i >> b) & 1) << (bits - 1 - b);
        umkehr_[i] = r;
    }
    return true;
}

void Fft::transformiere(double* re, double* im) const {
    const int n = n_;
    for (int i = 0; i < n; ++i) {
        const int j = umkehr_[i];
        if (j > i) {
            std::swap(re[i], re[j]);
            std::swap(im[i], im[j]);
        }
    }
    for (int len = 2; len <= n; len <<= 1) {
        const int halb = len >> 1;
        const int schritt = kMax / len;
        for (int start = 0; start < n; start += len) {
            for (int j = 0; j < halb; ++j) {
                const double wr = cos_[j * schritt];
                const double wi = -sin_[j * schritt];
                const int a = start + j, b = a + halb;
                const double tr = re[b] * wr - im[b] * wi;
                const double ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}

// ------------------------------------------------------------------------------------ SpektrumAnalysator

SpektrumAnalysator::SpektrumAnalysator(double fs, const SpektrumEinstellung& e)
    : fs_(fs > 0.0 ? fs : kAbtastrate),
      groesse_(gueltige_groesse(e.groesse) ? e.groesse : 2048),
      ueberlappung_(gueltige_ueberlappung(e.ueberlappung) ? e.ueberlappung : 4),
      hop_(groesse_ / ueberlappung_),
      pro_oktave_(std::clamp(e.baender_pro_oktave, 1, 24)),
      f_min_(std::max(1.0f, endlich_oder(e.f_min_hz, 20.0f))),
      f_max_(std::min(endlich_oder(e.f_max_hz, 20000.0f), static_cast<float>(0.5 * fs_))),
      glaettung_ms_(0.0f), glaett_a_(0.0), halten_ms_(0.0f), fallen_db_s_(0.0f), halten_rahmen_(0), fallen_db_rahmen_(0.0f),
      verlauf_pos_(0), seit_rahmen_(0), rahmen_(0), baender_(0) {
    for (float& v : ring_) v = 0.0f;
    baender_anlegen();
    setze_groesse(groesse_);   // window, FFT tables, bins; clears
    setze_glaettung_ms(e.glaettung_ms);
    setze_spitze(e.halten_ms, e.fallen_db_pro_s);
}

void SpektrumAnalysator::baender_anlegen() {
    // centres 1000 Hz * 2^(i/b), edges 1000 Hz * 2^((2i +- 1) / 2b); one formula for both neighbours' edge
    const double b = pro_oktave_;
    const int i0 = static_cast<int>(std::ceil(b * std::log2(f_min_ / 1000.0) - 1e-9));
    const int i1 = static_cast<int>(std::floor(b * std::log2(f_max_ / 1000.0) + 1e-9));
    auto kante = [b](int i) { return static_cast<float>(1000.0 * std::pow(2.0, (2.0 * i - 1.0) / (2.0 * b))); };
    baender_ = 0;
    for (int i = i0; i <= i1 && baender_ < kMaxBaender; ++i, ++baender_) {
        mitte_hz_[baender_] = static_cast<float>(1000.0 * std::pow(2.0, i / b));
        unten_hz_[baender_] = kante(i);
        oben_hz_[baender_] = kante(i + 1);
    }
}

void SpektrumAnalysator::bins_zuordnen() {
    const double bin_hz = fs_ / groesse_;
    const int nyquist = groesse_ / 2;
    for (int b = 0; b < baender_; ++b) {
        const int lo = std::clamp(static_cast<int>(std::ceil(unten_hz_[b] / bin_hz)), 1, nyquist);
        const int hi = std::clamp(static_cast<int>(std::ceil(oben_hz_[b] / bin_hz)), lo, nyquist);
        bin_lo_[b] = lo;
        bin_hi_[b] = hi;  // exclusive; lo == hi: no bin centre inside, interpolated
    }
}

bool SpektrumAnalysator::setze_groesse(int groesse) {
    if (!gueltige_groesse(groesse)) return false;
    groesse_ = groesse;
    fft_.setze_groesse(groesse_);
    for (int i = 0; i < groesse_; ++i) {
#ifdef CYPHERDJ_DSP_MUTATION_SPEKTRUM_OHNE_FENSTER
        fenster_[i] = 1.0;  // mutation: rectangular window
#else
        fenster_[i] = 0.5 * (1.0 - std::cos(2.0 * kPi * i / groesse_));  // periodic Hann
#endif
    }
    hop_ = groesse_ / ueberlappung_;
    bins_zuordnen();
    zeiten_rechnen();
    leeren();
    return true;
}

bool SpektrumAnalysator::setze_ueberlappung(int u) {
    if (!gueltige_ueberlappung(u)) return false;
    ueberlappung_ = u;
    hop_ = groesse_ / ueberlappung_;
    zeiten_rechnen();
    leeren();
    return true;
}

void SpektrumAnalysator::setze_glaettung_ms(float ms) {
    glaettung_ms_ = std::clamp(endlich_oder(ms, 0.0f), 0.0f, 10000.0f);
    zeiten_rechnen();
}

void SpektrumAnalysator::setze_spitze(float halten_ms, float fallen_db_pro_s) {
    halten_ms_ = std::clamp(endlich_oder(halten_ms, 1000.0f), 0.0f, 10000.0f);
    fallen_db_s_ = std::clamp(endlich_oder(fallen_db_pro_s, 20.0f), 0.0f, 1000.0f);
    zeiten_rechnen();
}

void SpektrumAnalysator::zeiten_rechnen() {  // everything that depends on the hop
    const double t = glaettung_ms_ * 0.001;
    glaett_a_ = t <= 0.0 ? 0.0 : std::exp(-static_cast<double>(hop_) / (t * fs_));
    halten_rahmen_ = static_cast<int>(std::lround(halten_ms_ * 0.001 * fs_ / hop_));
    fallen_db_rahmen_ = static_cast<float>(fallen_db_s_ * hop_ / fs_);
}

void SpektrumAnalysator::leeren() {
    for (float& v : verlauf_) v = 0.0f;
    verlauf_pos_ = 0;
    seit_rahmen_ = 0;
    rahmen_ = 0;
    for (int b = 0; b < kMaxBaender; ++b) {
        glatt_[b] = 0.0;
        pegel_db_[b] = kStummDb;
        spitze_db_[b] = kStummDb;
        halten_rest_[b] = 0;
    }
}

void SpektrumAnalysator::verwerfe_bis(std::size_t pos) {
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    const std::size_t r = lese_.load(std::memory_order_relaxed);
#if defined(CYPHERDJ_DSP_MUTATION_SPEKTRUM_SCHNITT_IGNORIERT)  // mutation: the cut is ignored, everything written is dropped
    (void)pos;
    lese_.store(std::max(r, w), std::memory_order_release);
#elif !defined(CYPHERDJ_DSP_MUTATION_SPEKTRUM_OHNE_LESE)  // mutation OHNE_LESE: the read index stays
    lese_.store(std::max(r, std::min(pos, w)), std::memory_order_release);
#else
    (void)pos; (void)w; (void)r;
#endif
#ifndef CYPHERDJ_DSP_MUTATION_SPEKTRUM_OHNE_LEEREN  // mutation: the window keeps data of the old source
    leeren();
#endif
}

void SpektrumAnalysator::schreibe(const float* l, const float* r, int n) {
    const std::size_t w = schreib_.load(std::memory_order_relaxed);
    const std::size_t gelesen = lese_.load(std::memory_order_acquire);
    const std::size_t frei = kRing - (w - gelesen);
    const int m = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(n), frei));
    for (int i = 0; i < m; ++i) {
        const float v = r ? 0.5f * (l[i] + r[i]) : l[i];
        ring_[(w + static_cast<std::size_t>(i)) & kRingMaske] = std::isfinite(v) ? v : 0.0f;
    }
    schreib_.store(w + static_cast<std::size_t>(m), std::memory_order_release);
    if (m < n) verloren_.store(verloren_.load(std::memory_order_relaxed) + (n - m), std::memory_order_relaxed);
}

int SpektrumAnalysator::analysiere() {
    std::size_t r = lese_.load(std::memory_order_relaxed);
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    int neu = 0;
    while (r != w) {
        verlauf_[verlauf_pos_] = ring_[r & kRingMaske];
        ++r;
        if (++verlauf_pos_ == groesse_) verlauf_pos_ = 0;
        if (++seit_rahmen_ == hop_) {
            seit_rahmen_ = 0;
            lese_.store(r, std::memory_order_release);  // hand the space back before the FFT
            rahmen_rechnen();
            ++neu;
        }
    }
    lese_.store(r, std::memory_order_release);
    return neu;
}

void SpektrumAnalysator::rahmen_rechnen() {
    const int n = groesse_;
    for (int i = 0; i < n; ++i) {
        int j = verlauf_pos_ + i;  // oldest sample first
        if (j >= n) j -= n;
        re_[i] = static_cast<double>(verlauf_[j]) * fenster_[i];
        im_[i] = 0.0;
    }
    fft_.transformiere(re_, im_);
    // full-scale sine = 1: amplitude 2|X|/sum(w) with sum(w) = n/2, power divided by the ENBW
    const double norm = (4.0 / n) * (4.0 / n) / kHannEnbw;
    for (int k = 0; k <= n / 2; ++k) leistung_[k] = (re_[k] * re_[k] + im_[k] * im_[k]) * norm;

    const double bin_hz = fs_ / n;
    for (int b = 0; b < baender_; ++b) {
        double p = 0.0;
        if (bin_hi_[b] > bin_lo_[b]) {
            for (int k = bin_lo_[b]; k < bin_hi_[b]; ++k) p += leistung_[k];
        } else {
            const double c = std::clamp(mitte_hz_[b] / bin_hz, 0.0, n / 2.0 - 1.0);
            const int k0 = static_cast<int>(c);
            const double t = c - k0;
            const double dichte = (1.0 - t) * leistung_[k0] + t * leistung_[k0 + 1];
            p = dichte * (oben_hz_[b] - unten_hz_[b]) / bin_hz;
        }
        double g = glaett_a_ * glatt_[b] + (1.0 - glaett_a_) * p;
        if (g < kLeistungBoden) g = 0.0;
        glatt_[b] = g;
        const float pegel = g > 0.0 ? std::max(kStummDb, static_cast<float>(10.0 * std::log10(g))) : kStummDb;
        pegel_db_[b] = pegel;
        if (pegel >= spitze_db_[b]) {
            spitze_db_[b] = pegel;
            halten_rest_[b] = halten_rahmen_;
        } else if (halten_rest_[b] > 0) {
            --halten_rest_[b];
        } else {
            spitze_db_[b] = std::max(pegel, spitze_db_[b] - fallen_db_rahmen_);
        }
    }
    ++rahmen_;
}

}  // namespace cypherdj::dsp
