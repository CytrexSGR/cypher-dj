// Scheibe 35, Kern-Hand: übersetzt ein JACK-MIDI-Ereignis vom Eingang cypherdj-kern:hand_in (SCHNITTSTELLEN §7.1)
// mit der Hand-Bibliothek (djk/kern/hand, Scheibe 19) über das Mapping (§7.2) in eine Aktion des Kerns: einen Griff
// fürs Stellwerk (§7.3 Punkte 1 bis 3), eine Deck-Taste (play, cue), eine Taste (§5.8) oder eine Raste des
// Tempo-Encoders. Jede Aktion trägt das Sample ihres Versatzes: Zyklusanfang plus Versatz (§7.3 Punkt 1).
// Teil A (MVP) des Plans 35: Umschalt, Nudge, Tap, Laden aus der Kiste kommen mit Teil B.
//
// Echtzeitfest: keine Allokation, keine Sperre, kein I/O.
#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"
#include "hand/mapping.h"
#include "hand/uebersetzer.h"

namespace cdj {

enum class HandArt : uint8_t { griff, deck, taste, tempo };

struct HandAktion {
  HandArt art = HandArt::taste;
  int64_t sample = 0;                    // Sample, an dem die Aktion wirkt
  cypherdj::stellwerk::Griff griff{};    // art griff
  uint8_t deck = 0;                      // art deck: 1 bis 4
  hand::DeckAktion aktion = hand::DeckAktion::play;
  hand::Quant quant = hand::Quant::sofort;
  hand::Taste taste = hand::Taste::annehmen;
  int32_t wert = 0;                      // deck, taste: 1 Druck, 0 Loslassen, oder Rasten; tempo: Rasten
};

class HandEin {
 public:
  HandEin() : ueb_(nullptr) {}
  // nullptr: kein Controller, jedes Ereignis bleibt ohne Wirkung.
  void mapping(const hand::Mapping* m) { ueb_.mapping(m); }
  const hand::Mapping* mapping() const { return ueb_.mapping(); }
  // Ein Ereignis aus jack_midi_event_get im Block [s0, s0 + n). sw liefert den Ist-Wert eines Schalters (Taste an
  // kill/*, pfl). Rückgabe 1 mit Aktion in *aus, 0 ohne Wirkung.
  int ereignis(const uint8_t* daten, size_t groesse, uint32_t versatz, int64_t s0, uint32_t n,
               const cypherdj::stellwerk::Stellwerk& sw, HandAktion* aus);
  const hand::UebersetzerZaehler& zaehler() const { return ueb_.zaehler(); }

 private:
  hand::Uebersetzer ueb_;
};

// /test/hand deck/<n>/play und deck/<n>/cue (Plan 35 E5 a): dieselbe Deck-Taste wie aus MIDI. true mit deck 1 bis 4 und
// play (true) oder cue (false), wenn der Pfad genau so lautet.
inline bool deck_taste_pfad(const char* p, int* deck, bool* play) {
  if (p[0] != 'd' || p[1] != 'e' || p[2] != 'c' || p[3] != 'k' || p[4] != '/' || p[5] < '1' || p[5] > '4' ||
      p[6] != '/')
    return false;
  const char* r = p + 7;
  const bool ist_play = r[0] == 'p' && r[1] == 'l' && r[2] == 'a' && r[3] == 'y' && r[4] == '\0';
  const bool ist_cue = r[0] == 'c' && r[1] == 'u' && r[2] == 'e' && r[3] == '\0';
  if (!ist_play && !ist_cue) return false;
  *deck = p[5] - '0';
  *play = ist_play;
  return true;
}

// /test/hand taste/<name> (Zusatz Scheibe 35, Annahme-Weg der Oberfläche): dieselbe Taste wie am Controller, Namen aus §5.8
// ohne die Encoder-Werte (autonomie, spielart, laenge, kiste_wahl). midi_roh ab 0,5 ist der Druck, darunter das Loslassen.
inline bool test_taste_pfad(const char* p, hand::Taste* t) {
  if (std::strncmp(p, "taste/", 6) != 0) return false;
  hand::Taste k;
  if (!hand::taste_aus_text(p + 6, &k)) return false;
  if (k == hand::Taste::autonomie || k == hand::Taste::spielart || k == hand::Taste::laenge ||
      k == hand::Taste::kiste_wahl)
    return false;
  *t = k;
  return true;
}

// Z2 (ROADMAP Abschnitt 3) für Portnamen aus dem Mapping: unter einer Prüfinstanz heißt jeder eigene ALSA-Client
// "cypherdj-<name>-<i>" (der Softcontroller aus 19 hängt die Instanz an). Aus "Midi-Bridge:cypherdj-softcontroller:hand
// (capture)" wird "Midi-Bridge:cypherdj-softcontroller-i:hand (capture)". Fremde Clients (Andreas' Gerät) bleiben.
// Rückgabe false, wenn aus zu klein ist.
bool hand_port_name(const char* name, const char* instanz, char* aus, size_t max);

}  // namespace cdj
