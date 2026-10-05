#include <cypherdj/dsp/djfilter.h>

#include <algorithm>
#include <cmath>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kTotzone = 0.05;
// Faust fi.svf (Zavalishin, TPT): v1 = (ic1 + g(v0 − ic2)) / (1 + g(g + d)), v2 = ic2 + g·v1.
// `a` ist der vorab gerechnete Kehrwert 1 / (1 + g(g + d)).
inline void svf_schritt(double& ic1, double& ic2, double v0, double g, double a, double& v1, double& v2) {
    v1 = (ic1 + g * (v0 - ic2)) * a;
    v2 = ic2 + g * v1;
    ic1 = 2.0 * v1 - ic1;
    ic2 = 2.0 * v2 - ic2;
}
}  // namespace

DjFilter::DjFilter(double fs) : fs_(fs) { koeffizienten(0.0); }

void DjFilter::leeren() {
    for (int c = 0; c < 2; ++c) tp_[c] = hp_[c] = Svf{};
}

void DjFilter::setze_guete(double q) {
    if (std::isnan(q)) return;
    q_ = std::clamp(q, kGueteMin, kGueteMax);
#ifndef CYPHERDJ_DSP_MUTATION_GUETE_FEST
    d_ = 1.0 / q_;
#endif
    // Kehrwerte a_tp_/a_hp_ hängen an d_: beim nächsten Sample neu rechnen
#ifndef CYPHERDJ_DSP_MUTATION_OHNE_CACHE_INVALIDIERUNG
    k_cache_ = 2.0;
    links_cache_ = rechts_cache_ = -1.0;
#endif
}

void DjFilter::koeffizienten(double k) {
    if (k == k_cache_) return;
    k_cache_ = k;
    // 04 §4.6 (dsp/djfilter.lib): fc_tp = 20000·(60/20000)^max(0, −k), fc_hp = 20·(8000/20)^max(0, k).
    // Nur die Seite, die sich bewegt, rechnet tan() neu (die andere steht auf 20 kHz bzw. 20 Hz).
    const double links = std::max(0.0, -k), rechts = std::max(0.0, k);
    if (links != links_cache_) {
        links_cache_ = links;
        g_tp_ = std::tan(kPi * 20000.0 * std::exp(links * std::log(60.0 / 20000.0)) / fs_);
        a_tp_ = 1.0 / (1.0 + g_tp_ * (g_tp_ + d_));
    }
    if (rechts != rechts_cache_) {
        rechts_cache_ = rechts;
        g_hp_ = std::tan(kPi * 20.0 * std::exp(rechts * std::log(8000.0 / 20.0)) / fs_);
        a_hp_ = 1.0 / (1.0 + g_hp_ * (g_hp_ + d_));
    }
    nass_ = std::min(1.0, std::fabs(k) / kTotzone);
}

void DjFilter::verarbeite(float* l, float* r, int n, const double* k) {
    float* ch[2] = {l, r};
    for (int i = 0; i < n; ++i) {
        koeffizienten(k[i]);
        for (int c = 0; c < 2; ++c) {
            const double x = ch[c][i];
            double v1, v2;
            svf_schritt(tp_[c].ic1, tp_[c].ic2, x, g_tp_, a_tp_, v1, v2);
            const double tp = v2;
            svf_schritt(hp_[c].ic1, hp_[c].ic2, x, g_hp_, a_hp_, v1, v2);
            const double hp = x - d_ * v1 - v2;
            // Beide Zustände laufen immer mit (kein Einschwingen beim Seitenwechsel, der bei k = 0 mit
            // nass = 0 geschieht); trocken exakt bei nass = 0.
            if (nass_ != 0.0) {
                const double y = k[i] < 0.0 ? tp : hp;
                ch[c][i] = static_cast<float>(x * (1.0 - nass_) + y * nass_);
            }
        }
    }
}

}  // namespace cypherdj::dsp
