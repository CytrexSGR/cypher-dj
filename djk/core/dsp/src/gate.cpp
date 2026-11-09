#include <cypherdj/dsp/gate.h>

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/denormal.h>

namespace cypherdj::dsp {

namespace {
// NaN keeps the old value, anything else is clamped into [lo, hi].
void uebernimm(float& ziel, float neu, float lo, float hi) {
    if (!std::isnan(neu)) ziel = std::clamp(neu, lo, hi);
}
double lin(double db) { return std::exp(db * kLn10Durch20); }
}  // namespace

Gate::Gate(double fs) : fs_(fs) {
    neu_rechnen();
    leeren();
}

void Gate::setze(const GateParameter& p) {
    uebernimm(p_.schwelle_db, p.schwelle_db, -90.0f, 0.0f);
    uebernimm(p_.hysterese_db, p.hysterese_db, 0.0f, 24.0f);
    uebernimm(p_.ratio, p.ratio, 1.0f, kGateRatioUnendlich);
    uebernimm(p_.bereich_db, p.bereich_db, kGateBereichStummDb, 0.0f);
    uebernimm(p_.attack_ms, p.attack_ms, 0.1f, 500.0f);
    uebernimm(p_.hold_ms, p.hold_ms, 0.0f, 2000.0f);
    uebernimm(p_.release_ms, p.release_ms, 1.0f, 5000.0f);
    neu_rechnen();
}

void Gate::neu_rechnen() {
    schwelle_auf_ = lin(p_.schwelle_db);
    schwelle_zu_ = lin(static_cast<double>(p_.schwelle_db) - p_.hysterese_db);
    boden_ = p_.bereich_db <= kGateBereichStummDb ? 0.0 : lin(p_.bereich_db);
    const double hub = 1.0 - boden_;
    // Rate from the span floor → 1; with floor 0 dB (no span) a 1 dB span keeps the gain moving.
    const double spanne = std::max(hub, 1.0 - lin(-1.0));
    schritt_auf_ = spanne / std::max(1.0, p_.attack_ms * 1e-3 * fs_);
    schritt_ab_ = spanne / std::max(1.0, p_.release_ms * 1e-3 * fs_);
    abfall_ = std::exp(-1.0 / (kGateDetektorAbfallMs * 1e-3 * fs_));
    hold_samples_ = std::lround(p_.hold_ms * 1e-3 * fs_);
}

void Gate::leeren() {
    e_ = 0.0;
    g_ = boden_;
    hold_rest_ = 0;
    offen_ = false;
}

void Gate::leeren_offen() {
    e_ = 0.0;
    g_ = 1.0;
    hold_rest_ = hold_samples_;
    offen_ = true;
}

float Gate::gain_db() const {
    return g_ <= 0.0 ? kStummDb : static_cast<float>(20.0 * std::log10(g_));
}

void Gate::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n,
                      const float* sc_l, const float* sc_r) {
    [[maybe_unused]] DenormalSchutz schutz;
    const float* dl = sc_l ? sc_l : in_l;
    const float* dr = sc_r ? sc_r : (sc_l ? sc_l : in_r);
    const bool hart = p_.ratio >= kGateRatioUnendlich;
    const double ratio_m1 = static_cast<double>(p_.ratio) - 1.0;
    for (int i = 0; i < n; ++i) {
        // detector: stereo-linked peak follower
        double xl = std::fabs(static_cast<double>(dl[i])), xr = std::fabs(static_cast<double>(dr[i]));
#ifndef CYPHERDJ_DSP_MUTATION_GATE_INF_KLEBT
        if (!std::isfinite(xl)) xl = 0.0;   // a NaN/Inf key sample must not stick the follower (Inf would hold the gate open for good)
        if (!std::isfinite(xr)) xr = 0.0;
#endif
        const double x = std::max(xl, xr);
        e_ = std::max(x, e_ * abfall_);
        if (e_ < 1e-30) e_ = 0.0;  // no denormals, independent of FTZ
        // state with hysteresis and hold
        if (!offen_) {
            if (e_ >= schwelle_auf_) {
                offen_ = true;
                hold_rest_ = hold_samples_;
            }
        } else if (e_ >= schwelle_zu_) {
            hold_rest_ = hold_samples_;
        } else if (hold_rest_ > 0) {
            --hold_rest_;
        } else {
            offen_ = false;
        }
        // target gain
        double ziel = 1.0;
        if (!offen_) {
            if (hart || e_ <= 0.0) {
                ziel = boden_;
            } else {
                const double pegel_db = 20.0 * std::log10(e_);
                ziel = std::max(boden_, lin(std::min(0.0, (pegel_db - p_.schwelle_db) * ratio_m1)));
            }
        }
        // gain ramp, linear in amplitude
#ifdef CYPHERDJ_DSP_MUTATION_GATE_HART
        g_ = ziel;
#else
        if (g_ < ziel) g_ = std::min(ziel, g_ + schritt_auf_);
        else if (g_ > ziel) g_ = std::max(ziel, g_ - schritt_ab_);
#endif
        const float gf = static_cast<float>(g_);
        verlauf_[i] = gf;
        out_l[i] = in_l[i] * gf;
        out_r[i] = in_r[i] * gf;
    }
}

}  // namespace cypherdj::dsp
