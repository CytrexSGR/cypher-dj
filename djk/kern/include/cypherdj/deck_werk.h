// Buchführung der Decks im Kern (Scheibe 31, kern_deck.cpp): vier Decks im Direktweg, wartende Deck-Befehle
// (start, stopp) mit Ziel-Beat, offene Lade- und Entlade-Befehle, Regler-Indizes für offen und hörbar (§1.6), Frist-
// Meldungen (§5.9 /e/frist) und der Takt der Zustandsmeldung (§5.5, 50 Hz). Alles feste Felder: echtzeitfest.
#pragma once

#include <cmath>
#include <cstdint>

#include "cypherdj/deck.h"
#include "cypherdj/stellwerk/regler.h"

namespace cdj {

constexpr int MAX_DECK_AKTIONEN = 64;
constexpr int DECK_ZUSTAND_ABSTAND = 960;  // §5.5: 50 Hz bei 48 kHz

struct DeckAktion {
  bool belegt = false;
  uint8_t art = 0;         // 1 start, 2 stopp; Hand (Scheibe 35): 3 Position setzen, 4 stopp und danach zum Cue-Punkt;
                           // Plan E9: 5 loop, 6 sprung, 7 hotcue
  uint8_t politik = 0;     // §16.1: 0 musik, 1 zustand, 2 raster (Plan E9)
  bool verschoben = false; // Plan E9: Politik 2 hat das Ziel auf den nächsten Rasterpunkt gelegt (Quittung 5)
  bool verspaetet = false; // Politik 1, Ziel-Sample beim Einsortieren schon vorbei: am Blockanfang ausführen
  int32_t deck = 0;        // 1 bis 4
  uint32_t seq = 0;        // Reihenfolge der Deck-Befehle (ein späteres Laden verwirft frühere Befehle)
  int64_t id = 0;
  int64_t spaet_sample = 0;  // verspaetet: Ausführungs-Sample
  double ab_beat = 0.0;
  double quell_beat = 0.0;
  double wert_beats = 0.0;   // Plan E9: loop laenge_beats, sprung delta_beats
  int32_t nr = 0;            // Plan E9: hotcue 1 bis 8
  char quelle[48] = {};
  char plan[32] = {};
  char gruppe[40] = {};
  char hoerschein[40] = {};
  // Scheibe 35: Deck-Taste der Hand (play, cue): wirkt am Sample ziel_sample, keine Quittung, nie im Neustart-Zustand
  bool hand = false;
  int64_t ziel_sample = 0;   // hand: Ausführungs-Sample (statt sample_at(ab_beat))
  int64_t ziel_frame = 0;    // hand: art 1 Startframe, art 3 neue Position
  bool loop_halten = false;  // hand: Play/Pause behalten den Loop (Plan E9, Review F2)
};

struct DeckRegler {  // Indizes in der Regler-Tabelle des Stellwerks, -1 wenn es ihn nicht gibt
  int16_t trim = -1, fader = -1, pfl = -1, ziel = -1, xseite = -1;
  int16_t stem[STEM_ANZAHL] = {-1, -1, -1, -1};
};

struct DeckWerk {
  Deck deck[DECKS];
  DeckRegler reg[DECKS];
  int16_t bus_fader[4] = {-1, -1, -1, -1}, bus_xseite[4] = {-1, -1, -1, -1};
  int16_t xfader = -1, master_pegel = -1;
  int8_t stem_deck[cypherdj::stellwerk::MAX_REGLER];  // Regler-Index -> Deck 0..3 bei stem/*, sonst -1
  int8_t stem_nr[cypherdj::stellwerk::MAX_REGLER];    // Regler-Index -> Stem 0..3
  DeckAktion aktion[MAX_DECK_AKTIONEN];
  uint32_t seq = 0;
  // Scheibe 35: Cue-Punkt (Frame) und Vorschau je Deck; ohne gesetzten Cue-Punkt gilt erste_eins_quell_beat
  int64_t cue_f[DECKS] = {};
  bool cue_gesetzt[DECKS] = {};
  bool vorschau[DECKS] = {};          // Cue gedrückt am Cue-Punkt: das Deck spielt, bis die Taste loslässt
  uint32_t laden_seq[DECKS] = {};     // seq des zuletzt eingereihten Ladens je Deck
  int laden_offen[DECKS] = {};        // Lade-Aufträge beim Lader
  // Stopp-Rampe läuft: Quittung fertig am Ende (§4.4)
  bool stopp_offen[DECKS] = {};
  int64_t stopp_id[DECKS] = {}, stopp_ende[DECKS] = {};
  char stopp_quelle[DECKS][48] = {};
  // Entladen: Quittung fertig, sobald das Material zurückgegeben ist
  const Material* entladen_m[DECKS] = {};
  int64_t entladen_id[DECKS] = {};
  char entladen_quelle[DECKS][48] = {};
  // Rückgaben, die der volle Ring noch nicht nahm
  const Material* rueck_warte[8] = {};
  int n_rueck_warte = 0;
  // Frist (§5.9 /e/frist bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks): gemeldete Schwellen je Lauf
  uint8_t frist_gemeldet[DECKS] = {};
  bool leer_melden[DECKS] = {};       // nach dem Entladen einmal Status 0 melden
  double hotcue[DECKS][8];            // Plan E9: Quell-Beat je Platz 1..8, NaN leer; Laden leert
  // Neustart (§6.3): Material der Decks, das vor dem Start wieder einzublenden ist
  struct Wieder {
    bool ja = false;
    char material_id[24] = {};
    double basis_bpm = 0.0;
    int32_t fassung = 0, mit_stems = 0;
    bool laeuft = false;
    double anker_master_beat = 0.0, anker_quell_beat = 0.0;
  } wieder[DECKS];
  DeckWerk() {
    for (int i = 0; i < cypherdj::stellwerk::MAX_REGLER; ++i) stem_deck[i] = stem_nr[i] = -1;
    for (auto& d : hotcue)
      for (double& h : d) h = NAN;
  }
};

}  // namespace cdj
