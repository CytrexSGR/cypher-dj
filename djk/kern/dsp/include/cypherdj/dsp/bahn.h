// Bahn eines Reglers: Ist-Wert in der Einheit des Reglers, gefahren je Sample.
// Setzen mit Schaltrampe (§1.5), Planteil-Rampen linear oder S (§4.3), dB-Regel (§1.2), Verlauf von außen.
// Teil der öffentlichen Naht von cypherdj_dsp. Echtzeitfest: keine Allokation, keine Sperre.
#pragma once

#include <cstdint>

#include <cypherdj/dsp/regler.h>
#include <cypherdj/dsp/werte.h>

namespace cypherdj::dsp {

enum class Form : std::uint8_t { linear = 0, s_kurve = 1 };  // §4.3 Feld `form`

inline constexpr double kEinrasten = 1e-9;  // Glätter rasten exakt auf dem Ziel ein (a-EQ-Fehler, 05 §4.1)

class Bahn {
public:
    explicit Bahn(Regler r = Regler::fader, double fs = kAbtastrate);

    // Springt ohne Rampe. Nur für Kanäle, die gerade stumm sind (Laden, Neustart-Zustand).
    void setze_sofort(float wert);
    // Setzen mit dauer_beats = 0: fährt die Schaltrampe des Reglers (§1.5) vom Ist-Wert aus.
    void setze(float ziel);
    // Planteil-Segment: vom Ist-Wert nach `nach` über `dauer_samples` Samples, Form linear oder S.
    // Das erste Sample trägt den Ist-Wert (u = 0), Sample dauer_samples trägt `nach`.
    // false und keine Wirkung bei Schaltern, dauer_samples < 1 oder NaN.
    bool rampe(float nach, std::int64_t dauer_samples, Form form);
    // Verlauf von außen (Stellwerk, Scheibe 11 und 25): werte[i] gilt für das i-te Sample des nächsten
    // block()-Aufrufs; der Zeiger muss bis dahin gültig bleiben. Begrenzt auf den Bereich, dB ≤ −120 wird
    // −200, NaN hält den Wert davor. Schalter wirken anteilig (0,25 bleibt 0,25): die Rampe fährt der
    // Aufrufer. Ersetzt Schaltrampe oder Rampe; danach ruht die Bahn auf dem letzten Wert. false bei nullptr.
    bool verlauf(const float* werte);

    float wert() const { return static_cast<float>(wert_); }
    float ziel() const { return static_cast<float>(ziel_); }
    bool faehrt() const { return modus_ != Modus::ruhend; }
    Regler regler() const { return regler_; }

    // Schreibt je Sample den dort gültigen Wert und rückt n Samples vor.
    // false: die Bahn ruht, `werte` bleibt unberührt, für alle n Samples gilt wert().
    bool block(double* werte, int n);

private:
    enum class Modus : std::uint8_t { ruhend, rampe, glatt, aussen };
    double schritt();
    float begrenze(float w) const;
    double begrenze_verlauf(float w) const;
    void starte_rampe(double nach, std::int64_t n, Form form);

    Regler regler_;
    Einheit einheit_;
    Schaltform schaltform_;
    float min_, max_;
    std::int64_t schalt_samples_;
    double p_;  // Pol des Glätters (Schaltform glaettung)
    Modus modus_ = Modus::ruhend;
    double wert_ = 0.0, ziel_ = 0.0;
    double von_ = 0.0;
    std::int64_t i_ = 0, n_ = 0;
    Form form_ = Form::linear;
    const float* aussen_ = nullptr;
};

}  // namespace cypherdj::dsp
