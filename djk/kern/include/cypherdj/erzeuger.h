// Plan 2026-09-27 (Strudel im Kern, Stufe 1; SCHNITTSTELLEN §4.8, ADR 024): Erzeuger-Schlange je Strom und Stimmen
// eines Kits. Ereignisse tragen den Beat der Kern-Karte; block() setzt jedes am Sample llround(sample_at(beat)) ein und
// addiert die Stimmen in den Eingang ihres Mixer-Kanals (vor Trim). Außer dem Konstruktor läuft alles im Callback:
// keine Allokation, feste Größen.
#pragma once

#include <cmath>
#include <cstdint>

#include "cypherdj/kit.h"
#include "cypherdj/mixer.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int ERZ_STROEME = 16;     // §4.8 strom 1 bis 16
constexpr int ERZ_FENSTER_EV = 64;  // /erz/ev je Bundle (der Erzeuger schickt höchstens 20, §2)
constexpr int ERZ_SCHLANGE = 1024;  // offene Ereignisse je Strom (zwei Takte Vorlauf mit großer Reserve)
constexpr int ERZ_STIMMEN = 32;     // gleichzeitig klingende Einsätze aller Ströme
constexpr int ERZ_MIDI_PORTS = 4;   // Studio S5: §7.1 midi_aus_1 bis _4
constexpr int ERZ_MIDI_EV = 256;    // MIDI-Ereignisse je Port und Zyklus
constexpr int ERZ_OFFEN = 64;       // klingende MIDI-Noten je Strom (Note-Off ausstehend)
// Glanz 2.5/2.4 (Erhebung Klickfrei 2026-10-01, Längen UNGEHÖRT, Ohr-Termin mit Andreas steht aus):
constexpr int ERZ_EIN = 32;         // F46: Einblende bei begin > 0 (0,67 ms), höchstens 1/4 des Ausschnitts
constexpr int ERZ_AUS = 96;         // F46/F50: Ausblende am Ende des gespielten Bereichs (2 ms), höchstens 1/4
constexpr int ERZ_AUSKLANG = 240;   // F16/F11: Ausklang einer abgelösten Stimme (5 ms, wie kit_bauen.py AUSBLENDE)
// Plätze für Ausklänge. Ein Ausklang (240 Frames) endet im Block nach seiner Entstehung, aber ein Raub im Block B und ein
// Kit-Tausch vor Block B+1 belegen zusammen bis zu 2 · ERZ_STIMMEN Plätze (Prüfung 06.10.: bei nur ERZ_STIMMEN harter Abbruch).
#ifdef CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLAETZE
constexpr int ERZ_AUSKLAENGE = ERZ_STIMMEN;  // Fehlerfall der Abnahme: zu wenige Plätze
#else
constexpr int ERZ_AUSKLAENGE = 2 * ERZ_STIMMEN;
#endif
constexpr float ERZ_KANTE = 0.001f; // -60 dBFS: leiser ist keine Kante, keine Rampe, Ausgabe bitgleich

// Glanz 2.7 (F19): MIDI-Ströme klingen erst nach dem Rundweg Kern → Wirt → Kern zurück: zwei Zyklen (Dossier 05 Z. 509: 512 bei
// 256) plus der Anteil des Wirts. Gemessen 545 Samples Median bei Quantum 256 (Lord Sawtooth; Fingered 556; Bias des Instruments
// +14; ~/messungen/2026-09-30-k2-sidechain/rundweg.md). Der Kern sendet Note-On/Off um so viel früher; Kit-Ströme unberührt.
constexpr int ERZ_MIDI_RUNDWEG_ZYKLEN = 2;
constexpr int ERZ_MIDI_VORHALT_REST = 25;  // Samples über die zwei Zyklen hinaus: 545 − 512 = 33, minus Bias 5 bis 14

// Studio S5: MIDI eines Zyklus je Port, im Callback gefüllt, in main.cpp nach zyklus() auf JACK ausgegeben.
// t = Versatz im Zyklus (Samples). Reihenfolge ist NICHT garantiert aufsteigend; main.cpp sortiert vor der Ausgabe.
struct MidiAus {
  struct Ev { uint32_t t; uint8_t b[3]; };
  Ev ev[ERZ_MIDI_EV];
  int n = 0;
  int verloren = 0;  // voll oder t < 0: gezählt, nicht geschrieben
  void leer() { n = 0; }
  void schreibe(int64_t t, uint8_t s, uint8_t d1, uint8_t d2) {
    if (n >= ERZ_MIDI_EV || t < 0) { ++verloren; return; }
    ev[n++] = Ev{static_cast<uint32_t>(t), {s, d1, d2}};
  }
};

struct ErzEv {
  double beat;
  int32_t note;
  int32_t muster;
  float velocity;
  float begin = 0.0f, end = 1.0f;  // Scheibe 3: Anteil der Klanglänge (§4.8 Parameter-Schwanz, nr 0 und 1)
  double dauer = 0.0;  // Studio S5: Länge in Beats (§4.8 dauer_beats), für das Note-Off eines MIDI-Stroms
};

// Ein Fenster-Bundle, im Netz-Faden gebaut und geprüft: ev nach beat aufsteigend, jedes in [ab_beat, bis_beat).
struct ErzFenster {
  int32_t strom = 0, sendung = 0;
  double ab_beat = 0.0, bis_beat = 0.0;
  int32_t n = 0;
  ErzEv ev[ERZ_FENSTER_EV];
};

struct ErzZaehler {  // Felder von /erz/quittung (§4.8) außer strom und sendung
  int32_t verworfen = 0, verworfen_anderes_muster = 0, eingefuegt = 0, zu_spaet = 0, ungehoert = 0;
};

// K2 Task 1.2: Kick-Auslöser eines block(): absolute Samples der gespielten Kit-Klänge mit duck = true
struct ErzAusloeser {
  static constexpr int MAX = 16;
  int64_t sample[MAX];
  int n = 0;
};

class Erzeuger {
 public:
  // Strom (1..16) auf ein Kit und einen Mixer-Kanal legen. Gibt das vorige Kit zurück (nullptr, wenn keins oder
  // dasselbe), bei ungültigem Strom das übergebene: der Aufrufer gibt es außerhalb des Callbacks frei. Stimmen des
  // abgelösten Kits klingen ERZ_AUSKLANG Frames aus einer Kopie aus (F11); das alte Kit liest der Callback danach nicht mehr.
  const Kit* setze_strom(int strom, const Kit* kit, int kanal);
  // Studio S5: Strom als MIDI-Strom (port 1..ERZ_MIDI_PORTS, midi_kanal 1..16); port 0 = kein MIDI (Kit wie bisher).
  // Offene Noten gehen im nächsten block() auf dem ALTEN Port/Kanal aus. Solange MIDI gilt, spielt das Kit nicht.
  void setze_midi(int strom, int port, int midi_kanal);
  // Glanz 2.7 (F19): Note-On/Off der MIDI-Ströme gehen um samples früher hinaus. Der Kern setzt das je Zyklus auf
  // ERZ_MIDI_RUNDWEG_ZYKLEN · n + ERZ_MIDI_VORHALT_REST; 0 (Vorgabe) = am Sample des Beats.
  void setze_midi_vorhalt(int64_t samples) { midi_vorhalt_ = samples > 0 ? samples : 0; }
  int64_t midi_vorhalt() const { return midi_vorhalt_; }
  // §4.8 „Fenster ersetzen“. jetzt_beat: Beat des ersten noch nicht gespielten Samples. Für MIDI-Ströme (Glanz 2.7) gilt als
  // "jetzt" das tatsächlich schon Gesendete (Strom::gesendet_bis, Sample + Vorhalt des letzten block()), nicht Sample + Vorhalt
  // des neuen Quantums (Re-Prüfung N2: das wäre bei wachsendem Quantum zu weit vorn, ein Ersatz noch nicht gesendeter Noten fiele aus).
  ErzZaehler fenster(const ErzFenster& f, double jetzt_beat);
  // Samples [n0, n0 + n), n <= MIX_BLOCK. ein_l[k], ein_r[k]: Eingang des Mixer-Kanals k (addiert). midi (ERZ_MIDI_PORTS
  // Puffer oder nullptr): Note-On/Off der MIDI-Ströme mit t = Sample − zyklus_n0. ausl (oder nullptr): K2, meldet die
  // Einsatz-Samples der gespielten Klänge mit duck (höchstens ErzAusloeser::MAX, der Rest verfällt still).
  void block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, MidiAus* midi = nullptr,
             int64_t zyklus_n0 = 0, ErzAusloeser* ausl = nullptr);
  void leeren();  // neue Zeitachse (§4.2): offene Ereignisse fallen weg, Kits und Stimmen bleiben
  int offen(int strom) const { return (strom >= 1 && strom <= ERZ_STROEME) ? st_[strom - 1].n : 0; }
  int stimmen() const;
  int ausklaenge() const;  // F16/F11: belegte Ausklang-Plätze

 private:
  struct Strom {
    const Kit* kit = nullptr;
    int kanal = -1;
    int n = 0;
    int midi_port = 0, midi_kanal = 1;  // Studio S5: 0 = Kit-Strom
    // Glanz 2.7 Prüfung R3: Beat, bis zu dem MIDI dieses Stroms schon hinaus ist (alles mit beat < gesendet_bis). Wächst mit
    // jedem block() um n + Vorhalt; schrumpft das Quantum, liegt es weiter vorn als Sample + neuer Vorhalt.
    double gesendet_bis = -HUGE_VAL;
    struct Offen { int64_t aus; uint8_t note, port, kanal; };
    Offen offen[ERZ_OFFEN];
    int n_offen = 0;
    ErzEv ev[ERZ_SCHLANGE];  // nach beat aufsteigend
  };
  struct Stimme {
    const KitKlang* klang = nullptr;
    int kanal = -1;
    int64_t pos = 0;
    int64_t ende = 0;  // Scheibe 3: floor(end · frames), die Stimme endet dort
    float g = 0.0f;
    int64_t start = 0;  // F46: erster Frame des Ausschnitts
    int ein = 0, aus = 0;  // F46/F50: Rampenlängen dieser Stimme, 0 = keine (bitgleich)
    uint64_t nr = 0;  // F16: Einsatzfolge, die kleinste wird geraubt
  };
  static void noten_aus(Strom& s, int64_t bis, MidiAus* midi, int64_t n0, int64_t zyklus_n0);
  static void spiele(Stimme& v, int von, int bis, float* const* ein_l, float* const* ein_r);
  static float huelle(const Stimme& v, int64_t p);
  void ausklingen(Stimme& v);
  Strom st_[ERZ_STROEME];
  Stimme sti_[ERZ_STIMMEN];
  // F16/F11 (Glanz 2.5.2): Kopie der nächsten ERZ_AUSKLANG Frames einer abgelösten Stimme, Hüllkurve und Ausblende
  // eingerechnet. Liest nach dem Kopieren kein Kit mehr: das alte Kit darf sofort zur Freigabe (ERZ_ALT).
  struct Ausklang {
    int kanal = -1, n = 0, pos = 0;
    float d[2 * ERZ_AUSKLANG];
  };
  Ausklang ak_[ERZ_AUSKLAENGE];  // 64 · 240 · 2 · 4 B = 123 KB (Erhebung nannte 32 Slots, die Prüfung 06.10. zeigte: 64), im Kern-Konstruktor angelegt
  uint64_t gezaehlt_ = 0;
  int64_t midi_vorhalt_ = 0;  // Glanz 2.7 (F19), im Callback gesetzt
};

}  // namespace cdj
