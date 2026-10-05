// DJ-Filter an einem Regler k in [−1, +1] (SCHNITTSTELLEN §1.2, Dossier 04 §4.6 und NP K6):
// links Tiefpass 20 kHz → 60 Hz, rechts Hochpass 20 Hz → 8 kHz, je ein TPT-Zustandsvariablenfilter
// (Zavalishin, wie Faust fi.svf), Güte einstellbar (Vorgabe 0,707, A27 Weg a: Konfig-Wert `filter_guete`). Beide laufen immer mit, es wirkt nur die Seite, die sich
// bewegt (k < 0 Tiefpass, k > 0 Hochpass); die ruhende ist umgangen (04 NP K6: sonst kostet der
// ruhende 20-Hz-Hochpass den Sub-Bass). Totzone |k| < 0,05 blendet auf trocken; bei k = 0 ist der
// Ausgang bitgleich zum Eingang. Teil der öffentlichen Naht von cypherdj_dsp.
#pragma once

#include <cypherdj/dsp/werte.h>

namespace cypherdj::dsp {

// Güte Q beider Seiten (A27 Weg a, kern.toml `filter_guete`). Vorgabe 0,707 ist das Verhalten vor dem Nachtrag,
// bitgleich. An der Eckfrequenz gilt |H(fc)| = Q (Q > 0,707: Resonanzspitze 20·log10(Q) dB). Bereich gesetzt, nicht
// gemessen: den XZ-nahen Wert setzt der Hörvergleich (MVP „Lücken und Entscheide“, Dossier xdj-xz-eq-filter V5).
// Höchstgüte 4 statt 8 (2026-09-26, bis Andreas gehört hat): bei Güte 8 hob schon leichtes Rechtsdrehen (k 0,03 bis
// 0,075, fc 24 bis 31 Hz) den Subbass um +13,7 bis +18,1 dB (gemessen); bei 4 sind es noch bis +12,1 dB.
inline constexpr double kGueteVorgabe = 0.707;
inline constexpr double kGueteMin = 0.5;
inline constexpr double kGueteMax = 4.0;

class DjFilter {
public:
    explicit DjFilter(double fs = kAbtastrate);
    void leeren();
    // In place auf L und R, k je Sample (aus der Bahn des Reglers `filter`), 1 ≤ n ≤ kMaxFrames.
    void verarbeite(float* l, float* r, int n, const double* k);
    // Güte setzen: NaN wird verworfen (die alte bleibt), sonst auf [kGueteMin, kGueteMax] geklemmt. Allokiert nicht,
    // sperrt nicht; wirkt ab dem nächsten Sample ohne Zustandssprung (TPT-SVF). leeren() lässt die Güte stehen.
    void setze_guete(double q);
    double guete() const { return q_; }

private:
    struct Svf {
        double ic1 = 0.0, ic2 = 0.0;
    };
    void koeffizienten(double k);
    double fs_;
    double k_cache_ = 2.0, links_cache_ = -1.0, rechts_cache_ = -1.0;  // außerhalb: erster Aufruf rechnet
    double g_tp_ = 0.0, g_hp_ = 0.0, a_tp_ = 1.0, a_hp_ = 1.0, nass_ = 0.0;
    double q_ = kGueteVorgabe;
    double d_ = 1.0 / kGueteVorgabe;  // Dämpfung 1/Q
    Svf tp_[2], hp_[2];
};

}  // namespace cypherdj::dsp
