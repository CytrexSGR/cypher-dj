#include <cypherdj/dsp/bahn.h>

#include <algorithm>
#include <cmath>

namespace cypherdj::dsp {

Bahn::Bahn(Regler r, double fs) : regler_(r) {
    const ReglerInfo& ri = info(r);
    einheit_ = ri.einheit;
    schaltform_ = ri.form;
    min_ = ri.min;
    max_ = ri.max;
    schalt_samples_ = std::llround(ri.schaltrampe_ms * 1e-3 * fs);
    p_ = std::exp(-1.0 / (ri.schaltrampe_ms * 1e-3 * fs));
    wert_ = ziel_ = ri.vorgabe;
}

float Bahn::begrenze(float w) const {
    w = std::clamp(w, min_, max_);
    if (einheit_ == Einheit::schalter) return w >= 0.5f ? 1.0f : 0.0f;
    if (einheit_ == Einheit::db) return normiere_db(w);
    return w;
}

double Bahn::begrenze_verlauf(float w) const {
    w = std::clamp(w, min_, max_);
    if (einheit_ == Einheit::db) return normiere_db(w);
    return w;  // Schalter anteilig, Filter wie gegeben
}

void Bahn::setze_sofort(float wert) {
    if (std::isnan(wert)) return;
    wert_ = ziel_ = begrenze(wert);
    modus_ = Modus::ruhend;
}

void Bahn::starte_rampe(double nach, std::int64_t n, Form form) {
    von_ = wert_;
    ziel_ = nach;
    n_ = n;
    i_ = 0;
    form_ = form;
    modus_ = Modus::rampe;
}

void Bahn::setze(float ziel) {
    if (std::isnan(ziel)) return;
    const float z = begrenze(ziel);
#ifdef CYPHERDJ_DSP_MUTATION_KILL_HART
    // Mutation für den Knack-Test (Task 8): Schalter springen hart.
    if (schaltform_ == Schaltform::zweite_ordnung) { setze_sofort(z); return; }
#endif
    if (modus_ == Modus::ruhend && z == static_cast<float>(wert_)) return;
    switch (schaltform_) {
        case Schaltform::s_kurve:
        case Schaltform::zweite_ordnung:
            starte_rampe(z, schalt_samples_, Form::s_kurve);
            break;
        case Schaltform::glaettung:
            ziel_ = z;
            modus_ = Modus::glatt;
            break;
    }
}

bool Bahn::rampe(float nach, std::int64_t dauer_samples, Form form) {
    if (einheit_ == Einheit::schalter || dauer_samples < 1 || std::isnan(nach)) return false;
    starte_rampe(begrenze(nach), dauer_samples, form);
    return true;
}

bool Bahn::verlauf(const float* werte) {
    if (werte == nullptr) return false;
    aussen_ = werte;
    modus_ = Modus::aussen;
    return true;
}

double Bahn::schritt() {
    switch (modus_) {
        case Modus::ruhend:
        case Modus::aussen:
            return wert_;
        case Modus::rampe: {
            const double u = static_cast<double>(i_) / static_cast<double>(n_);
            const double f = form_ == Form::s_kurve ? s_kurve(u) : u;
            wert_ = einheit_ == Einheit::db ? rampe_db_wert(von_, ziel_, f) : von_ + (ziel_ - von_) * f;
            if (++i_ > n_) {
                wert_ = ziel_;
                modus_ = Modus::ruhend;
            }
            return wert_;
        }
        case Modus::glatt:
            wert_ = (1.0 - p_) * ziel_ + p_ * wert_;
            if (std::fabs(wert_ - ziel_) < kEinrasten) {
                wert_ = ziel_;
                modus_ = Modus::ruhend;
            }
            return wert_;
    }
    return wert_;
}

bool Bahn::block(double* werte, int n) {
    if (modus_ == Modus::ruhend) return false;
    if (modus_ == Modus::aussen) {
        double v = wert_;
        for (int i = 0; i < n; ++i) {
            const float e = aussen_[i];
            if (!std::isnan(e)) v = begrenze_verlauf(e);
            werte[i] = v;
        }
        wert_ = ziel_ = v;
        aussen_ = nullptr;
        modus_ = Modus::ruhend;
        return true;
    }
    for (int i = 0; i < n; ++i) werte[i] = schritt();
    return true;
}

}  // namespace cypherdj::dsp
