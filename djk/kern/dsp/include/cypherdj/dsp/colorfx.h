// SOUND COLOR FX am COLOR-Regler des Kanalzugs (Andreas 2026-10-11: „lass erstmal wie am xz machen“; Vorlage
// Pioneer DJM-900NXS2 Handbuch S. 15, ~/messungen/2026-10-11-cypher-hall/pioneer/raw.txt). Der COLOR-Regler ist der
// vorhandene Kanalregler `filter` (k in [−1, +1]); die Art und der PARAMETER sind global wie am Pult (color/art,
// color/param), werden aber je Kanalzug gesetzt, damit eine Art je Kanal später nur eine Reglerfrage ist.
//
// Arten (Reihenfolge der Tasten am XZ): 0 FILTER (der DjFilter selbst, nicht hier), 1 SPACE, 2 DUB ECHO, 3 SWEEP,
// 4 NOISE, 5 CRUSH. Gemeinsam: Totzone |k| < 0,05, dort ist der Ausgang bitgleich zum Eingang, solange keine Fahne
// läuft. SPACE und DUB ECHO speisen ihre Fahne nur, solange der Regler aus der Mitte steht; die Fahne klingt nach
// (wie bei OFF der Beat-FX). Die Kurven folgen dem Handbuch in Richtung und Wirkung, die Zahlen sind gesetzt, nicht
// am Pult gemessen (Hörvergleich mit Andreas offen).
//
// Echtzeit: setze(), leeren() und verarbeite() allokieren nicht, sperren nicht, werfen nicht. Die Puffer
// (Echo, Hall) legt der Konstruktor an; ein Artwechsel leert sie nicht per memset, sondern über Füllzähler.
#pragma once

#include <cstdint>
#include <vector>

#include <cypherdj/dsp/werte.h>

namespace cypherdj::dsp {

enum class ColorArt : std::uint8_t { filter = 0, space = 1, dub_echo = 2, sweep = 3, noise = 4, crush = 5 };
inline constexpr int kColorArtMax = 5;
inline constexpr float kColorParamVorgabe = 0.5f;

class ColorFx {
public:
    explicit ColorFx(double fs = kAbtastrate);
    // Alle Zustände leer (Fahnen weg). Echtzeitfest.
    void leeren();
    // Art (ganz, außerhalb 0..5 → filter), PARAMETER p in [0, 1] (NaN → Vorgabe), Samples je Beat für DUB ECHO
    // (≤ 0 → 0,5 s). Ein Artwechsel leert die Zustände. Echtzeitfest.
    void setze(int art, float param, double samples_pro_beat);
    ColorArt art() const { return art_; }
    // Läuft noch eine Fahne (SPACE, DUB ECHO), obwohl der Regler in der Mitte steht?
    bool faehrt() const { return fahne_ > 0; }
    // In place auf L und R, k je Sample, 1 ≤ n ≤ kMaxFrames. Bei art() == filter: nichts.
    void verarbeite(float* l, float* r, int n, const double* k);

    struct Svf {   // TPT-Zustandsvariablenfilter (Zavalishin), wie DjFilter
        double ic1 = 0.0, ic2 = 0.0;
    };

private:
    void space(float* l, float* r, int n, const double* k);
    void dub_echo(float* l, float* r, int n, const double* k);
    void sweep(float* l, float* r, int n, const double* k);
    void noise(float* l, float* r, int n, const double* k);
    void crush(float* l, float* r, int n, const double* k);

    double fs_;
    ColorArt art_ = ColorArt::filter;
    float p_ = kColorParamVorgabe;
    double spb_ = 24000.0;
    int fahne_ = 0;                 // Samples, die eine Fahne noch mindestens laufen darf (Ruheerkennung)
    int seite_ = -1;                // letzte Seite aus der Mitte: −1 links, +1 rechts (Fahnenfilter)

    Svf f_[2][2];                   // [Stufe][Kanal]: Filter der Arten
    bool ruht_ = true;              // letzter Block ohne Wirkung: beim Wiedereinstieg Filterzustände leeren

    // NOISE
    std::uint32_t rng_[2] = {0x9E3779B9u, 0x7F4A7C15u};
    // CRUSH
    float halt_[2] = {0.0f, 0.0f};
    int halt_zaehler_ = 0;
    // SWEEP (Gate)
    double huelle_ = 0.0, spitze_ = 0.0, gate_ = 1.0;
    // DUB ECHO
    std::vector<float> echo_[2];
    int echo_pos_ = 0, echo_gefuellt_ = 0;
    double echo_d_ = 0.0;           // geglättete Verzögerung in Samples
    double echo_tp_[2] = {0.0, 0.0};
    // SPACE: 4 Leitungen FDN, 2 Allpässe Diffusion je Kanal
    static constexpr int kLeitungen = 4;
    std::vector<float> fdn_[kLeitungen];
    int fdn_len_[kLeitungen] = {};
    int fdn_pos_[kLeitungen] = {};
    double fdn_tp_[kLeitungen] = {};
    std::vector<float> ap_[2][2];
    int ap_pos_[2][2] = {};
    int space_gefuellt_ = 0;
};

}  // namespace cypherdj::dsp
