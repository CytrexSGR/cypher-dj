// Kanalzug eines Kanals (SCHNITTSTELLEN §1.5, §1.6; ADR 008 Entscheidung 1):
//   Trim → LR8-Isolator mit Kill → DJ-Filter → [Abgriff: PFL und Mess-Abgriff] → Fader → Haupt
//                                                                             └→ Sends 1..4 (nach dem Fader)
// DIE NAHT zu Scheibe 25 (Kern-Kanalzug). Spätere Scheiben (14, 22) ergänzen nur additiv:
// keine bestehende Signatur ändern, keine Bedeutung ändern (tests/test_naht.cpp hält das fest).
//
// Echtzeit: verarbeite(), setze(), setze_sofort(), rampe(), verlauf() und alle Lesezugriffe allokieren
// nicht, sperren nicht und werfen nicht. Konstruktor und zuruecksetzen() nur außerhalb des Callbacks.
// Ein Objekt ist groß (feste Puffer für kMaxFrames): auf dem Heap anlegen, nicht auf dem Stack.
//
// Sample-genau: Ereignisse mitten im Block setzt der Aufrufer, indem er den Block am Ereignis
// teilt (verarbeite für den Teil davor, dann setze/rampe, dann verarbeite für den Rest), oder er
// reicht je Regler einen Verlauf je Sample (verlauf(), aus dem Stellwerk).
// Zwei Teilaufrufe liefern bitgleich dasselbe wie ein Aufruf ohne Ereignis (Test).
#pragma once

#include <cstdint>

#include <cypherdj/dsp/bahn.h>
#include <cypherdj/dsp/djfilter.h>
#include <cypherdj/dsp/isolator.h>
#include <cypherdj/dsp/regler.h>
#include <cypherdj/dsp/werte.h>

namespace cypherdj::dsp {

inline constexpr int kAnzahlSends = 4;

struct KanalzugAusgang {
    float* haupt_l = nullptr;                   // Pflicht: nach dem Fader, wird überschrieben
    float* haupt_r = nullptr;
    float* send_l[kAnzahlSends] = {};           // optional: += Haupt · Send-Gain; nullptr = kein Bus
    float* send_r[kAnzahlSends] = {};
};

class Kanalzug {
public:
    explicit Kanalzug(double fs = kAbtastrate);

    // Alle Regler auf ihre Vorgabe (§1.5), Filterzustände leer. Nicht im Callback.
    void zuruecksetzen();
    // Nur die Filterzustände (Isolator, DJ-Filter) leeren, Regler bleiben. Echtzeitfest (Audit F01: NaN-Riegel).
    void zustaende_leeren();

    // Ohne Rampe (Laden, Neustart-Zustand): nur an stummen Kanälen benutzen.
    void setze_sofort(Regler r, float wert);
    // Setzen (dauer_beats = 0) mit der Schaltrampe des Reglers.
    void setze(Regler r, float wert);
    // Planteil-Segment in Samples, linear oder S in der Einheit des Reglers (§4.3), dB mit §1.2.
    // false bei Schaltern (kill/*), dauer_samples < 1 oder NaN.
    bool rampe(Regler r, float nach, std::int64_t dauer_samples, Form form);
    // Verlauf je Sample für den nächsten verarbeite()-Aufruf (Stellwerk, Scheibe 11 und 25); werte muss
    // so viele Samples tragen wie dieser Aufruf und bis dahin gültig bleiben. Semantik: Bahn::verlauf.
    bool verlauf(Regler r, const float* werte);

    float wert(Regler r) const { return bahn_[static_cast<int>(r)].wert(); }
    float ziel(Regler r) const { return bahn_[static_cast<int>(r)].ziel(); }
    bool faehrt(Regler r) const { return bahn_[static_cast<int>(r)].faehrt(); }
    // §1.6: Kanalpegel = Trim + Fader (Ist-Werte), stumm als −200.
    float kanalpegel_db() const { return dsp::kanalpegel_db(wert(Regler::trim), wert(Regler::fader)); }

    // Güte des DJ-Filters (A27 Weg a, kern.toml `filter_guete`, Scheibe 25 liest sie ein): Semantik
    // DjFilter::setze_guete (NaN verworfen, auf [kGueteMin, kGueteMax] geklemmt). Konfig, kein Regler:
    // zuruecksetzen() lässt sie stehen. Echtzeitfest.
    void setze_filter_guete(double q) { filter_.setze_guete(q); }
    double filter_guete() const { return filter_.guete(); }

    // 1 ≤ n ≤ kMaxFrames. `in` darf gleich `aus.haupt` sein.
    void verarbeite(const float* in_l, const float* in_r, int n, const KanalzugAusgang& aus);

    // Geteilter Weg (Ohr Task 16, additiv zur Naht; `verarbeite` ruft beide nacheinander, bitgleich):
    //   verarbeite_vor:  Trim, Isolator, Filter, füllt den Abgriff (1 ≤ n ≤ kMaxFrames, `in` wird nur gelesen).
    //   verarbeite_nach: Fader und Sends, gelesen aus dem Abgriff (`aus.haupt` wird überschrieben).
    // Dazwischen darf der Aufrufer den Abgriff verändern (Beat-FX als Insert vor dem Fader, ADR 008 Punkt 4):
    // abgriff_schreibbar(kanal) ist derselbe Puffer wie abgriff(kanal), n Samples gültig. Echtzeitfest wie verarbeite.
    void verarbeite_vor(const float* in_l, const float* in_r, int n);
    float* abgriff_schreibbar(int kanal) { return abgriff_[kanal]; }
    void verarbeite_nach(int n, const KanalzugAusgang& aus);

    // Abgriff nach Filter, vor dem Fader (PFL und Mess-Abgriff; ADR 008 Punkt 4, SCHNITTSTELLEN §6.2),
    // aus dem letzten verarbeite().
    const float* abgriff(int kanal) const { return abgriff_[kanal]; }
    // Band vor dem Band-Gain des Isolators (§5.6), aus dem letzten verarbeite().
    const float* band(Band b, int kanal) const { return iso_.band(b, kanal); }

private:
    // Füllt g[0..n) mit dem linearen Gain des dB-Reglers r; false, wenn er ruht (dann gilt konst).
    bool db_gains(Regler r, float* g, int n, double& konst);

    Bahn bahn_[kAnzahlRegler];
    Isolator iso_;
    DjFilter filter_;
    double werte_[kMaxFrames] = {};          // Arbeitsspeicher für Bahn::block
    double k_filter_[kMaxFrames] = {};
    float g_trim_[kMaxFrames] = {};
    float g_band_[3][kMaxFrames] = {};
    float g_fader_[kMaxFrames] = {};
    float g_send_[kMaxFrames] = {};
    float abgriff_[2][kMaxFrames] = {};
};

}  // namespace cypherdj::dsp
