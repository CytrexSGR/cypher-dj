#include <cypherdj/dsp/utility.h>

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/denormal.h>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;

void uebernimm(float& ziel, float neu, float lo, float hi) {
    if (!std::isnan(neu)) ziel = std::clamp(neu, lo, hi);
}

// Copies only the coefficients, the state of `ziel` stays (retuning without a reset).
void stimme(Lr8& ziel, const Lr8& neu) {
    for (int i = 0; i < 4; ++i) ziel.b[i].k = neu.b[i].k;
}

double klein_null(double v) { return std::fabs(v) < 1e-30 ? 0.0 : v; }
}  // namespace

Utility::Utility(double fs) : fs_(fs) {
    rampe_ = std::max(1, static_cast<int>(std::lround(kUtilityRampeMs * 1e-3 * fs_)));
    dc_r_ = std::exp(-2.0 * kPi * kUtilityDcHz / fs_);
    leeren();
}

void Utility::ziel_matrix(double* z) const {
    const double pl = p_.phase_umkehren_l ? -1.0 : 1.0;
    const double pr = p_.phase_umkehren_r ? -1.0 : 1.0;
    // phase invert, then swap: A maps the input to the swapped pair
    double a[4] = {pl, 0.0, 0.0, pr};
    if (p_.seiten_tauschen) { a[0] = 0.0; a[1] = pr; a[2] = pl; a[3] = 0.0; }
    // width in M/S: l = M + w S, r = M − w S
    const double w = p_.breite_prozent / 100.0;
    const double wa = 0.5 * (1.0 + w), wb = 0.5 * (1.0 - w);
    const double wm[4] = {wa, wb, wb, wa};
    // linear balance law and gain
    const double g = db_zu_linear(p_.gain_db);
    const double bal[2] = {g * std::min(1.0, 1.0 - p_.balance), g * std::min(1.0, 1.0 + p_.balance)};
    for (int i = 0; i < 2; ++i)
        for (int j = 0; j < 2; ++j) z[2 * i + j] = bal[i] * (wm[2 * i] * a[j] + wm[2 * i + 1] * a[2 + j]);
}

void Utility::setze(const UtilityParameter& p) {
    const bool dc_alt = p_.dc_sperre;
    const float bass_alt = p_.bass_mono_hz;

    if (!std::isnan(p.gain_db)) p_.gain_db = ist_stumm(p.gain_db) ? kStummDb : std::min(p.gain_db, 24.0f);
    uebernimm(p_.balance, p.balance, -1.0f, 1.0f);
    uebernimm(p_.breite_prozent, p.breite_prozent, 0.0f, kUtilityBreiteMaxProzent);
    if (!std::isnan(p.bass_mono_hz))
        p_.bass_mono_hz = p.bass_mono_hz <= 0.0f ? 0.0f : std::clamp(p.bass_mono_hz, kUtilityBassMonoMinHz, kUtilityBassMonoMaxHz);
    p_.phase_umkehren_l = p.phase_umkehren_l;
    p_.phase_umkehren_r = p.phase_umkehren_r;
    p_.seiten_tauschen = p.seiten_tauschen;
    p_.dc_sperre = p.dc_sperre;

    // matrix
    double z[4];
    ziel_matrix(z);
    if (!std::equal(z, z + 4, m_ziel_)) {
        std::copy(z, z + 4, m_ziel_);
#ifdef CYPHERDJ_DSP_MUTATION_UTILITY_HART
        std::copy(z, z + 4, m_);
        rest_ = 0;
#else
        for (int i = 0; i < 4; ++i) m_schritt_[i] = (m_ziel_[i] - m_[i]) / rampe_;
        rest_ = rampe_;
#endif
    }
    // DC blocker crossfade
    if (p_.dc_sperre != dc_alt) {
        dc_schritt_ = ((p_.dc_sperre ? 1.0 : 0.0) - dc_mix_) / rampe_;
        dc_rest_ = rampe_;
    }
    // bass mono: tune, crossfade
    if (p_.bass_mono_hz > 0.0f && p_.bass_mono_hz != bass_hz_) {
        const bool ruht = bass_mix_ == 0.0 && bass_rest_ == 0;
        for (int c = 0; c < 2; ++c) {
            if (ruht) {
                tp_[c] = lr8_tiefpass(p_.bass_mono_hz, fs_);
                hp_[c] = lr8_hochpass(p_.bass_mono_hz, fs_);
            } else {
                stimme(tp_[c], lr8_tiefpass(p_.bass_mono_hz, fs_));
                stimme(hp_[c], lr8_hochpass(p_.bass_mono_hz, fs_));
            }
        }
        bass_hz_ = p_.bass_mono_hz;
    } else if (p_.bass_mono_hz > 0.0f && bass_mix_ == 0.0 && bass_rest_ == 0) {
        tp_[0].leeren(); tp_[1].leeren(); hp_[0].leeren(); hp_[1].leeren();  // idle filters start empty
    }
    if ((p_.bass_mono_hz > 0.0f) != (bass_alt > 0.0f)) {
        bass_schritt_ = ((p_.bass_mono_hz > 0.0f ? 1.0 : 0.0) - bass_mix_) / rampe_;
        bass_rest_ = rampe_;
    }
}

void Utility::leeren() {
    for (int c = 0; c < 2; ++c) {
        dc_x1_[c] = dc_y1_[c] = 0.0;
        tp_[c].leeren();
        hp_[c].leeren();
    }
    std::copy(m_ziel_, m_ziel_ + 4, m_);
    rest_ = 0;
    dc_mix_ = p_.dc_sperre ? 1.0 : 0.0;
    dc_rest_ = 0;
    bass_mix_ = p_.bass_mono_hz > 0.0f ? 1.0 : 0.0;
    bass_rest_ = 0;
}

void Utility::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n) {
    [[maybe_unused]] DenormalSchutz schutz;
    for (int i = 0; i < n; ++i) {
        double x[2] = {in_l[i], in_r[i]};

        // DC blocker runs always (stays warm, so switching it on does not start with a transient)
        if (dc_rest_ > 0) {
            dc_mix_ += dc_schritt_;
            if (--dc_rest_ == 0) dc_mix_ = p_.dc_sperre ? 1.0 : 0.0;
        }
        for (int c = 0; c < 2; ++c) {
            const double y = klein_null(x[c] - dc_x1_[c] + dc_r_ * dc_y1_[c]);
            dc_x1_[c] = x[c];
            dc_y1_[c] = y;
            if (dc_mix_ != 0.0) x[c] += dc_mix_ * (y - x[c]);
        }

        // bass mono: lows of both channels summed, highs per channel
        if (bass_rest_ > 0) {
            bass_mix_ += bass_schritt_;
            if (--bass_rest_ == 0) bass_mix_ = p_.bass_mono_hz > 0.0f ? 1.0 : 0.0;
        }
        if (bass_mix_ != 0.0 || bass_rest_ > 0) {
            const double tl = tp_[0].schritt(x[0]), tr = tp_[1].schritt(x[1]);
            const double hl = hp_[0].schritt(x[0]), hr = hp_[1].schritt(x[1]);
            const double mono = 0.5 * (tl + tr);
            x[0] += bass_mix_ * (hl + mono - x[0]);
            x[1] += bass_mix_ * (hr + mono - x[1]);
        }

        // matrix
        if (rest_ > 0) {
            for (int k = 0; k < 4; ++k) m_[k] += m_schritt_[k];
            if (--rest_ == 0) std::copy(m_ziel_, m_ziel_ + 4, m_);
        }
        out_l[i] = static_cast<float>(m_[0] * x[0] + m_[1] * x[1]);
        out_r[i] = static_cast<float>(m_[2] * x[0] + m_[3] * x[1]);
    }
}

}  // namespace cypherdj::dsp
