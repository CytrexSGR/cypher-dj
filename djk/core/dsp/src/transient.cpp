#include <cypherdj/dsp/transient.h>

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/denormal.h>

namespace cypherdj::dsp {

namespace {
// NaN keeps the old value, anything else is clamped into [lo, hi].
void uebernimm(float& ziel, float neu, float lo, float hi) {
    if (!std::isnan(neu)) ziel = std::clamp(neu, lo, hi);
}
// One-pole coefficient for a time constant (reaches 63% after ms).
double koeff(double ms, double fs) { return 1.0 - std::exp(-1.0 / std::max(1.0, ms * 1e-3 * fs)); }
double db_von(double e) { return 20.0 * std::log10(std::max(e, 1e-10)); }
}  // namespace

Transient::Transient(double fs) : fs_(fs) {
    neu_rechnen();
    leeren();
}

void Transient::setze(const TransientParameter& p) {
    uebernimm(p_.angriff_db, p.angriff_db, -24.0f, 24.0f);
    uebernimm(p_.halten_db, p.halten_db, -24.0f, 24.0f);
    uebernimm(p_.tempo_ms, p.tempo_ms, 1.0f, 200.0f);
    uebernimm(p_.ausgang_db, p.ausgang_db, -24.0f, 24.0f);
    uebernimm(p_.mix, p.mix, 0.0f, 1.0f);
    neu_rechnen();
}

void Transient::neu_rechnen() {
    const double t = p_.tempo_ms;
    ef_auf_ = koeff(kTransientSchnellAttackMs, fs_);
    ef_ab_ = koeff(t, fs_);
    es_auf_ = koeff(t, fs_);
    es_ab_ = koeff(4.0 * t, fs_);
    glatt_ = koeff(kTransientGlaettungMs, fs_);
    param_glatt_ = koeff(kTransientParamGlaettungMs, fs_);
    aus_lin_ = p_.ausgang_db == 0.0f ? 1.0 : std::exp(static_cast<double>(p_.ausgang_db) * kLn10Durch20);
}

void Transient::leeren() {
    ef_ = es_ = 0.0;
    g_db_ = 0.0;
    groesste_ = 0.0;
    mix_ = p_.mix;
    aus_ = aus_lin_;
}

void Transient::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n) {
    [[maybe_unused]] DenormalSchutz schutz;
    const double mix_ziel = p_.mix;
    const double angriff = p_.angriff_db, halten = p_.halten_db;
    for (int i = 0; i < n; ++i) {
        double l = in_l[i], r = in_r[i];
        if (!std::isfinite(l)) l = 0.0;
        if (!std::isfinite(r)) r = 0.0;
        const double x = std::max(std::fabs(l), std::fabs(r));
        ef_ += (x - ef_) * (x > ef_ ? ef_auf_ : ef_ab_);
        es_ += (x - es_) * (x > es_ ? es_auf_ : es_ab_);
        if (ef_ < 1e-30) ef_ = 0.0;   // no denormals, independent of FTZ
        if (es_ < 1e-30) es_ = 0.0;

        double ziel = 0.0;
        if (db_von(std::max(ef_, es_)) > kTransientStilleDb) {
            const double d = db_von(ef_) - db_von(es_);
            ziel = angriff * std::clamp(d / kTransientSpanneDb, 0.0, 1.0) +
                   halten * std::clamp(-d / kTransientSpanneDb, 0.0, 1.0);
            ziel = std::clamp(ziel, -static_cast<double>(kTransientGainMaxDb), static_cast<double>(kTransientGainMaxDb));
        }
        g_db_ += (ziel - g_db_) * glatt_;
        if (ziel == 0.0 && g_db_ < 1e-9 && g_db_ > -1e-9) g_db_ = 0.0;   // settle exactly (and bit-identical at rest)
        groesste_ = std::max(groesste_, std::fabs(g_db_));

        // mix and output level move smoothly too, so a knob jump cannot click
        mix_ += (mix_ziel - mix_) * param_glatt_;
        aus_ += (aus_lin_ - aus_) * param_glatt_;
        if (std::fabs(mix_ziel - mix_) < 1e-9) mix_ = mix_ziel;
        if (std::fabs(aus_lin_ - aus_) < 1e-9) aus_ = aus_lin_;

        const double g = g_db_ == 0.0 ? 1.0 : std::exp(g_db_ * kLn10Durch20);
        const double gesamt = (1.0 - mix_) + g * mix_;   // dry * (1 - mix) + dry * g * mix, same factor on both channels
        out_l[i] = static_cast<float>(l * gesamt * aus_);
        out_r[i] = static_cast<float>(r * gesamt * aus_);
    }
}

}  // namespace cypherdj::dsp
