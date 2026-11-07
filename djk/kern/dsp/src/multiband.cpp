#include <cypherdj/dsp/multiband.h>

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/denormal.h>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;
// Butterworth 4 pole Qs, the same as in biquad.cpp (lr8_tiefpass / lr8_hochpass).
const double kQ1 = 1.0 / (2.0 * std::sin(1.0 * kPi / 8.0));
const double kQ2 = 1.0 / (2.0 * std::sin(3.0 * kPi / 8.0));
constexpr double kPegelBoden = 1e-10;  // -200 dBFS, keeps log10 finite

// Second-order allpass with the poles of tiefpass_2(fc, q): numerator = mirrored denominator.
// LR8 low pass + LR8 high pass = D(-s) / D(s) with D the Butterworth 4 denominator, i.e. these two
// sections (q = kQ1, kQ2) in series (D(s) D(-s) = 1 + s^8).
BiquadKoeff allpass_2(double fc, double q, double fs) {
    BiquadKoeff c = tiefpass_2(fc, q, fs);
    c.b0 = c.a2;
    c.b1 = c.a1;
    c.b2 = 1.0;
    return c;
}

double zeitkoeff(double ms, double fs) { return std::exp(-1.0 / (ms * 0.001 * fs)); }

float begrenzt(float neu, float alt, float lo, float hi) { return std::isnan(neu) ? alt : std::clamp(neu, lo, hi); }
}  // namespace

// --- Detector ------------------------------------------------------------------------------------------------

void MbDetektor::setze(const MbBandEinstellung& e, double fs) {
    schwelle_ = e.schwelle_db;
    steigung_ = 1.0 / static_cast<double>(e.verhaeltnis) - 1.0;
    knie_ = e.knie_db;
    a_anstieg_ = zeitkoeff(e.anstieg_ms, fs);
    a_abklingen_ = zeitkoeff(e.abklingen_ms, fs);
    a_mittel_steigt_ = zeitkoeff(kMbAusgleichSteigtMs, fs);
    a_mittel_faellt_ = zeitkoeff(kMbAusgleichFaelltMs, fs);
}

double MbDetektor::statisch_db(double x_db) const {
    const double d = x_db - schwelle_;
    if (2.0 * d < -knie_) return 0.0;
    if (2.0 * std::fabs(d) <= knie_) {  // inside the knee (knie_ > 0 here, else the branch above or below)
        const double u = d + 0.5 * knie_;
        return steigung_ * u * u / (2.0 * knie_);
    }
    return steigung_ * d;
}

// Smooth decoupled peak detector (Giannoulis et al. 2012, eq. 17) on the reduction r = -statisch >= 0:
//   y1 = max(r, a_R y1 + (1 - a_R) r)    release-only peak hold
//   yL = a_A yL + (1 - a_A) y1           attack smoothing
// A step up of the level gives exactly the one-pole attack (y1 jumps, yL follows). Between the peaks of a
// sine y1 holds with the release coefficient, so tonal signals get the same attack as a step.
double MbDetektor::schritt(double pegel) {
    if (steigung_ == 0.0 && y1_ == 0.0 && g_db_ == 0.0 && m_db_ == 0.0) return 0.0;  // ratio 1, settled: nothing to compute
    const double x_db = 20.0 * std::log10(std::max(pegel, kPegelBoden));
    const double r = -statisch_db(x_db);
    y1_ = std::max(r, a_abklingen_ * y1_ + (1.0 - a_abklingen_) * r);
    double y = -g_db_;
    y = a_anstieg_ * y + (1.0 - a_anstieg_) * y1_;
    if (y1_ < 1e-12) y1_ = 0.0;  // ends the exponential tails (no denormals, exact 0)
    if (std::fabs(y - y1_) < 1e-12) y = y1_;
    g_db_ = -y;
    // Mean of the reduction for the automatic make-up: slow where it grows, faster where it shrinks.
    const double a = g_db_ < m_db_ ? a_mittel_steigt_ : a_mittel_faellt_;
    m_db_ = a * m_db_ + (1.0 - a) * g_db_;
    if (m_db_ > -1e-12) m_db_ = 0.0;   // ends the exponential tail (no denormals, exact 0)
    return g_db_;
}

// --- Compressor ----------------------------------------------------------------------------------------------

void MultibandKompressor::Rampe::setze(double z, int dauer) {
    ziel = z;
    if (dauer <= 0 || z == wert) {
        wert = z;
        rest = 0;
        return;
    }
    schritt = (z - wert) / dauer;
    rest = dauer;
}

MultibandKompressor::MultibandKompressor(double fs, double grenze_tief_hz, double grenze_hoch_hz)
    : fs_(fs), schalt_samples_(static_cast<int>(std::lround(kSchaltMs * 0.001 * fs))) {
    setze_grenzen(grenze_tief_hz, grenze_hoch_hz);
    for (int b = 0; b < kBaender; ++b) det_[b].setze(einst_[b], fs_);
    ziele_neu(true);
    leeren();
}

void MultibandKompressor::setze_grenzen(double grenze_tief_hz, double grenze_hoch_hz) {
    const double hi = 0.45 * fs_;
    const double t = std::isnan(grenze_tief_hz) ? grenze_tief_ : std::clamp(grenze_tief_hz, kMbGrenzeMinHz, hi);
    const double h = std::isnan(grenze_hoch_hz) ? grenze_hoch_ : std::clamp(grenze_hoch_hz, t, hi);
    grenze_tief_ = t;
    grenze_hoch_ = h;
    const Lr8 tp_h = lr8_tiefpass(h, fs_), hp_h = lr8_hochpass(h, fs_);
    const Lr8 tp_t = lr8_tiefpass(t, fs_), hp_t = lr8_hochpass(t, fs_);
    const BiquadKoeff ap1 = allpass_2(t, kQ1, fs_), ap2 = allpass_2(t, kQ2, fs_);
    for (Kanal& k : k_) {  // coefficients only, states stay
        for (int i = 0; i < 4; ++i) {
            k.tp_hoch.b[i].k = tp_h.b[i].k;
            k.hp_hoch.b[i].k = hp_h.b[i].k;
            k.tp_tief.b[i].k = tp_t.b[i].k;
            k.hp_tief.b[i].k = hp_t.b[i].k;
        }
        k.ap_tief[0].k = ap1;
        k.ap_tief[1].k = ap2;
    }
}

void MultibandKompressor::leeren() {
    for (Kanal& k : k_) {
        k.tp_hoch.leeren();
        k.hp_hoch.leeren();
        k.tp_tief.leeren();
        k.hp_tief.leeren();
        k.ap_tief[0].leeren();
        k.ap_tief[1].leeren();
    }
    for (int b = 0; b < kBaender; ++b) {
        det_[b].leeren();
        groesste_[b] = 0.0f;
    }
    ziele_neu(true);
}

// Both halves leave the object consistent with its settings (einst_): detector coefficients and gain-ramp targets always follow them. setze_band
// returns early when called with the settings it already holds (the Mixer calls it in every block); a half that copied the settings without
// the matching detector coefficients or ramp targets would make the next call with those values a no-op and leave the object on the old ones
// (review r1 dsp_trap: detector time constants; review r2 dsp_halb: level -23.01 dB where -17.03 dB).
void MultibandKompressor::uebernehme_detektoren(const MultibandKompressor& o) {
    if (&o == this) return;
    for (int b = 0; b < kBaender; ++b) {   // plain values, no allocation
        einst_[b] = o.einst_[b];
        det_[b] = o.det_[b];   // coefficients and states
        groesste_[b] = o.groesste_[b];
    }
    ziele_neu(false);   // the gain ramps run to the targets of the copied settings (their position is not copied)
}

void MultibandKompressor::uebernehme_rampen(const MultibandKompressor& o) {
    if (&o == this) return;
    for (int b = 0; b < kBaender; ++b) {
        einst_[b] = o.einst_[b];
        det_[b].setze(einst_[b], fs_);   // coefficients only; the detector states stay
        nass_[b] = o.nass_[b];
        trocken_[b] = o.trocken_[b];
        auto_[b] = o.auto_[b];
    }
}

void MultibandKompressor::uebernehme_dynamik(const MultibandKompressor& o) {
    uebernehme_detektoren(o);
    uebernehme_rampen(o);
}

void MultibandKompressor::setze_band(Band b, const MbBandEinstellung& e) {
    MbBandEinstellung& z = einst_[static_cast<int>(b)];
    [[maybe_unused]] const MbBandEinstellung alt = z;
    z.schwelle_db = begrenzt(e.schwelle_db, z.schwelle_db, kMbSchwelleMinDb, kMbSchwelleMaxDb);
    z.verhaeltnis = begrenzt(e.verhaeltnis, z.verhaeltnis, kMbVerhaeltnisMin, kMbVerhaeltnisMax);
    z.anstieg_ms = begrenzt(e.anstieg_ms, z.anstieg_ms, kMbAnstiegMinMs, kMbAnstiegMaxMs);
    z.abklingen_ms = begrenzt(e.abklingen_ms, z.abklingen_ms, kMbAbklingenMinMs, kMbAbklingenMaxMs);
    z.knie_db = begrenzt(e.knie_db, z.knie_db, kMbKnieMinDb, kMbKnieMaxDb);
    z.aufholen_db = begrenzt(e.aufholen_db, z.aufholen_db, kMbAufholenMinDb, kMbAufholenMaxDb);
    z.aufholen_auto = e.aufholen_auto;
    z.solo = e.solo;
    z.umgehen = e.umgehen;
    // Called every block by the Mixer: an unchanged setting must not re-arm the gain ramps (at a block under 240 samples the 5 ms ramp
    // would restart before it ends and run for 22 ms at n = 128, 30 ms at n = 8).
#ifndef CYPHERDJ_DSP_MUTATION_MB_RAMPE_NEU   // error case: every call re-arms the ramps
    if (z.schwelle_db == alt.schwelle_db && z.verhaeltnis == alt.verhaeltnis && z.anstieg_ms == alt.anstieg_ms && z.abklingen_ms == alt.abklingen_ms &&
        z.knie_db == alt.knie_db && z.aufholen_db == alt.aufholen_db && z.aufholen_auto == alt.aufholen_auto && z.solo == alt.solo && z.umgehen == alt.umgehen)
        return;
#endif
    det_[static_cast<int>(b)].setze(z, fs_);
    ziele_neu(false);
}

// Band gain = trocken + nass * 10^(GR/20): bypass -> (1, 0), active -> (0, makeup), muted by solo -> (0, 0).
void MultibandKompressor::ziele_neu(bool sofort) {
    bool solo = false;
    for (const MbBandEinstellung& e : einst_) solo = solo || e.solo;
    for (int b = 0; b < kBaender; ++b) {
        const MbBandEinstellung& e = einst_[b];
        const bool hoerbar = !solo || e.solo;
        const double tr = hoerbar && e.umgehen ? 1.0 : 0.0;
        const double na = hoerbar && !e.umgehen ? std::exp(e.aufholen_db * kLn10Durch20) : 0.0;
        auto_[b].setze(e.aufholen_auto ? 1.0 : 0.0, sofort ? 0 : schalt_samples_);
        trocken_[b].setze(tr, sofort ? 0 : schalt_samples_);
        nass_[b].setze(na, sofort ? 0 : schalt_samples_);
    }
}

void MultibandKompressor::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n) {
    [[maybe_unused]] DenormalSchutz schutz;
    for (int i = 0; i < n; ++i) {
        double band[kBaender][2];
        const float xin[2] = {in_l[i], in_r[i]};
        for (int c = 0; c < 2; ++c) {
            Kanal& k = k_[c];
            const double x = std::isfinite(xin[c]) ? static_cast<double>(xin[c]) : 0.0;
            const double a = k.tp_hoch.schritt(x);  // low + mid
            const double h = k.hp_hoch.schritt(x);
            band[0][c] = k.tp_tief.schritt(a);
            band[1][c] = k.hp_tief.schritt(a);
#if defined(CYPHERDJ_DSP_MUTATION_MB_OHNE_ALLPASS)
            band[2][c] = h;  // mutation: high band without the phase of the lower crossover
#else
            band[2][c] = k.ap_tief[1].schritt(k.ap_tief[0].schritt(h));
#endif
        }
        double y[2] = {0.0, 0.0};
        for (int b = 0; b < kBaender; ++b) {
            const double tr = trocken_[b].weiter();
            const double na = nass_[b].weiter();
            [[maybe_unused]] const double au = auto_[b].weiter();
#if defined(CYPHERDJ_DSP_MUTATION_MB_UNGEKOPPELT)
            // mutation: the left channel's own level drives the band, the right channel stays uncompressed
            const double gr = det_[b].schritt(std::fabs(band[b][0]));
            const double g[2] = {tr + na * std::exp((gr + au * det_[b].ausgleich_db()) * kLn10Durch20), tr + na};
#else
            const double pegel = std::max(std::fabs(band[b][0]), std::fabs(band[b][1]));  // stereo-linked
            const double gr = det_[b].schritt(pegel);
#ifdef CYPHERDJ_DSP_MUTATION_MB_OHNE_AUSGLEICH   // error case: no automatic make-up, compressing only lowers the band
            const double ausgleich = 0.0;
#else
            const double ausgleich = au * det_[b].ausgleich_db();
#endif
            const double gl = tr + na * std::exp((gr + ausgleich) * kLn10Durch20);
            const double g[2] = {gl, gl};
#endif
            y[0] += band[b][0] * g[0];
            y[1] += band[b][1] * g[1];
            if (!einst_[b].umgehen && gr < groesste_[b]) groesste_[b] = static_cast<float>(gr);
        }
        out_l[i] = static_cast<float>(y[0]);
        out_r[i] = static_cast<float>(y[1]);
    }
}

float MultibandKompressor::aktuelle_absenkung_db(Band b) const {
    const int i = static_cast<int>(b);
    return einst_[i].umgehen ? 0.0f : static_cast<float>(det_[i].absenkung_db());
}

float MultibandKompressor::ausgleich_db(Band b) const {
    const int i = static_cast<int>(b);
    return einst_[i].umgehen || !einst_[i].aufholen_auto ? 0.0f : static_cast<float>(det_[i].ausgleich_db());
}

float MultibandKompressor::groesste_absenkung_db(Band b) {
    const int i = static_cast<int>(b);
    const float g = groesste_[i];
    groesste_[i] = 0.0f;
    return g;
}

}  // namespace cypherdj::dsp
