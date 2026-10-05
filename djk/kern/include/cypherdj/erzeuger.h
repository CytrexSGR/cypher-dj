// Plan 2026-09-27 (Strudel im Kern, Stufe 1; SCHNITTSTELLEN §4.8, ADR 024): Erzeuger-Schlange je Strom und Stimmen
// eines Kits. Ereignisse tragen den Beat der Kern-Karte; block() setzt jedes am Sample llround(sample_at(beat)) ein und
// addiert die Stimmen in den Eingang ihres Mixer-Kanals (vor Trim). Außer dem Konstruktor läuft alles im Callback:
// keine Allokation, feste Größen.
#pragma once

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
  // abgelösten Kits enden sofort.
  const Kit* setze_strom(int strom, const Kit* kit, int kanal);
  // Studio S5: Strom als MIDI-Strom (port 1..ERZ_MIDI_PORTS, midi_kanal 1..16); port 0 = kein MIDI (Kit wie bisher).
  // Offene Noten gehen im nächsten block() auf dem ALTEN Port/Kanal aus. Solange MIDI gilt, spielt das Kit nicht.
  void setze_midi(int strom, int port, int midi_kanal);
  // §4.8 „Fenster ersetzen“. jetzt_beat: Beat des ersten noch nicht gespielten Samples.
  ErzZaehler fenster(const ErzFenster& f, double jetzt_beat);
  // Samples [n0, n0 + n), n <= MIX_BLOCK. ein_l[k], ein_r[k]: Eingang des Mixer-Kanals k (addiert). midi (ERZ_MIDI_PORTS
  // Puffer oder nullptr): Note-On/Off der MIDI-Ströme mit t = Sample − zyklus_n0. ausl (oder nullptr): K2, meldet die
  // Einsatz-Samples der gespielten Klänge mit duck (höchstens ErzAusloeser::MAX, der Rest verfällt still).
  void block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, MidiAus* midi = nullptr,
             int64_t zyklus_n0 = 0, ErzAusloeser* ausl = nullptr);
  void leeren();  // neue Zeitachse (§4.2): offene Ereignisse fallen weg, Kits und Stimmen bleiben
  int offen(int strom) const { return (strom >= 1 && strom <= ERZ_STROEME) ? st_[strom - 1].n : 0; }
  int stimmen() const;

 private:
  struct Strom {
    const Kit* kit = nullptr;
    int kanal = -1;
    int n = 0;
    int midi_port = 0, midi_kanal = 1;  // Studio S5: 0 = Kit-Strom
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
  };
  static void noten_aus(Strom& s, int64_t bis, MidiAus* midi, int64_t n0, int64_t zyklus_n0);
  static void spiele(Stimme& v, int von, int bis, float* const* ein_l, float* const* ein_r);
  Strom st_[ERZ_STROEME];
  Stimme sti_[ERZ_STIMMEN];
  int naechste_ = 0;
};

}  // namespace cdj
