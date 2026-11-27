// Scheibe 20, Task 13: Hörschein-Register und Prüfer I3a (INTERFACES §17 I3a, §4.5). Aufbau nach test_checker.cpp:
// ein Teil öffnet deck/2/fader (Fader von −200 auf 0 dB), PrueferI3 prüft ihn gegen Register und Deck-Modell.
#include <cmath>
#include <cstdio>

#include "cypherdj/signalbox/i3.h"
#include "check.h"
#include "scenario.h"

using namespace probe;
using namespace cypherdj::stellwerk;

namespace {

int deck_kanal(int n);   // defined below, the double needs it for its default player numbers
int pfad_kanal(const char* fader_pfad);

// Deck-Modell-Doppel: fester Inhalt und feste Quellposition je Kanal-Index, ohne Allokation (feste Kanalzahl).
// Container core K8: player(kanal) is the player number whose track sounds on that strip. By default the four deck strips carry their own player
// (the container input art `player` of the start state); setze_player changes it (0: the strip carries no player, the container input is a module or nothing).
class TestDeck : public DeckModell {
 public:
  TestDeck() {
    for (int n = 1; n <= 4; n++) player_[deck_kanal(n)] = n;
  }
  void setze_player(int kanal, int nr) { player_[kanal] = nr; }
  int player(int kanal) const override { return kanal >= 0 && kanal < MAX_KANAELE ? player_[kanal] : 0; }
  void setze_inhalt(int kanal, const Inhalt& i) {
    inhalt_da_[kanal] = true;
    inhalt_[kanal] = i;
  }
  void setze_quell(int kanal, double beat) {
    quell_da_[kanal] = true;
    quell_[kanal] = beat;
  }
  bool inhalt(int kanal, Inhalt& aus) const override {
    if (kanal < 0 || kanal >= MAX_KANAELE || !inhalt_da_[kanal]) return false;
    aus = inhalt_[kanal];
    return true;
  }
  double quell_beat_bei(int kanal, int64_t) const override {
    if (kanal < 0 || kanal >= MAX_KANAELE || !quell_da_[kanal]) return std::nan("");
    return quell_[kanal];
  }

 private:
  bool inhalt_da_[MAX_KANAELE] = {};
  Inhalt inhalt_[MAX_KANAELE] = {};
  bool quell_da_[MAX_KANAELE] = {};
  double quell_[MAX_KANAELE] = {};
  int player_[MAX_KANAELE] = {};
};

Inhalt inhalt_von(const char* material_id, double bpm, int fassung) {
  Inhalt i{};
  std::snprintf(i.material_id, sizeof i.material_id, "%s", material_id);
  i.bpm_milli = static_cast<int32_t>(bpm * 1000.0 + 0.5);
  i.fassung = fassung;
  return i;
}

// Der echte Kanal-Index von "deck/2" in der Regler-Tabelle (dieselbe Tabelle, die jeder Lauf baut, §1.5 fest verdrahtet).
int deck_kanal(int n) {
  Lauf sonde;
  char pfad[32];
  // K9: the table has four containers; the players 3 and 4 sound through the strips pad/1 and pad/2
  if (n <= 2) std::snprintf(pfad, sizeof pfad, "deck/%d/fader", n);
  else std::snprintf(pfad, sizeof pfad, "pad/%d/fader", n - 2);
  return sonde.sw->tabelle().def(sonde.r(pfad)).kanal;
}
int deck2_kanal() { return deck_kanal(2); }
// The channel index of a strip from any of its rows ("pad/1/fader" -> the index of pad/1)
int pfad_kanal(const char* fader_pfad) {
  Lauf sonde;
  return sonde.sw->tabelle().def(sonde.r(fader_pfad)).kanal;
}

Schein schein_von(const char* hs_id, const char* kanal, const Inhalt& inhalt, double bpm, double gueltig_bis,
                   double quell_von = -1e9, double quell_bis = 1e9) {
  Schein s{};
  std::snprintf(s.hs_id, sizeof s.hs_id, "%s", hs_id);
  std::snprintf(s.kanal, sizeof s.kanal, "%s", kanal);
  s.inhalt = inhalt;
  s.bpm = bpm;
  s.gueltig_bis = gueltig_bis;
  s.quell_von = quell_von;
  s.quell_bis = quell_bis;
  s.belegt = true;
  return s;
}

// Wie test_checker.cpp: ein Teil, der deck/2/fader von −200 auf 0 dB öffnet, Start bei Beat 64 (Sample 1 440 000
// bei 128 BPM). `hs` = Hörschein-Feld des Teils, `quelle` seine Quelle. Rückgabe: Grund::kein, wenn gestartet,
// sonst der Ablehnungsgrund.
// `vorab_pfad`/`vorab_wert`: a second control set before the part (a trim part only opens the channel when the fader is up: pass
// "deck/2/fader" and -10 dB, the trim then goes from its closed value to 0 and trim + fader crosses -26 dB).
Grund lauf(const HoerscheinRegister& reg, const DeckModell& deck, bool an, const char* hs = "",
           Quelle quelle = Quelle::cypher, const char* fader = "deck/2/fader", const char* vorab_pfad = nullptr,
           float vorab_wert = 0.0f) {
  PrueferI3 pr(reg, deck);
  pr.schalte(an);
  Lauf l(128.0, &pr);
  l.sw->setze_direkt(l.r(fader), -200.0f);
  if (vorab_pfad) l.sw->setze_direkt(l.r(vorab_pfad), vorab_wert);
  TeilBefehl b{77, quelle, "pI3", 0, fader, 64, 32, 0, 0, 0, "", hs};
  l.sw->teil(b);
  l.nachlese_ereignisse();
  l.bis(1500000);
  return l.bei(77, Status::gestartet) >= 0 ? Grund::kein : l.grund(77, Status::abgelehnt);
}

}  // namespace

FALL(ausgeschaltet_immer_kein) {
  HoerscheinRegister reg;   // leer: kein Schein
  TestDeck deck;            // kein Inhalt
  PRUEFE(lauf(reg, deck, false, "") == Grund::kein);
  PRUEFE(lauf(reg, deck, false, "unbekannt") == Grund::kein);
}

FALL(eingeschaltet_kein_schein) {
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));   // a loaded track keeps the lock (an empty deck channel is free, see leeres_deck_*)
  PRUEFE(lauf(reg, deck, true, "") == Grund::kein_hoerschein);
  PRUEFE(lauf(reg, deck, true, "unbekannt") == Grund::kein_hoerschein);
}

FALL(schein_anderer_kanal) {
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("mat1", 128.0, 1));
  reg.setze(schein_von("h1", "deck/3", inhalt_von("mat1", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_anderer_kanal);
}

FALL(schein_anderes_material) {
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matB", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_anderer_inhalt);
}

// Andreas 2026-11-18 (SEQ deck): an empty deck channel is free for I3a whatever the pass says; formerly "pass but nothing loaded" was anderer_inhalt.
// Not repaired into anderer_inhalt with a loaded deck: schein_anderes_material pins that.
FALL(leeres_deck_schein_egal) {
  HoerscheinRegister reg;
  TestDeck deck;   // kein setze_inhalt: nichts geladen
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "unbekannt") == Grund::kein);
}

FALL(schein_anderes_tempo) {
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 129.3, 200.0), 0.0);   // >0,5 % ab von 128
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_anderes_tempo);
}

FALL(schein_abgelaufen) {
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 10.0), 0.0);   // gültig nur bis Beat 10
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_abgelaufen);
}

FALL(quellposition_ausserhalb) {
  HoerscheinRegister reg;
  TestDeck deck;
  const int k = deck2_kanal();
  deck.setze_inhalt(k, inhalt_von("matA", 128.0, 1));
  deck.setze_quell(k, 500.0);   // weit außerhalb [0, 72]
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 200.0, 0.0, 8.0), 0.0);   // [0, 72]
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_anderer_abschnitt);
}

FALL(alles_passt) {
  HoerscheinRegister reg;
  TestDeck deck;
  const int k = deck2_kanal();
  deck.setze_inhalt(k, inhalt_von("matA", 128.0, 1));
  deck.setze_quell(k, 4.0);   // innerhalb [0, 72]
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 200.0, 0.0, 8.0), 0.0);   // [0, 72]
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::kein);
}

FALL(quelle_andreas_ohne_schein_kein) {
  HoerscheinRegister reg;   // leer
  TestDeck deck;            // kein Inhalt
  PRUEFE(lauf(reg, deck, true, "", Quelle::andreas) == Grund::kein);
}

FALL(spur_regler_ohne_schein) {
  // D1 K1 (Spec 2.3): spur/* sind kein Kanal-Fader; Cypher öffnet sie ohne Hörschein (A9), wie erz und pad
  HoerscheinRegister reg;   // leer
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));
  for (const char* f : {"spur/1/fader", "spur/8/fader", "spur/3/pan", "grp/1/fader", "grp/8/fader", "grp/3/pan", "pm/fader"})
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/fader") == Grund::kein_hoerschein);   // Gegenprobe
}

FALL(send_und_return_regler_ohne_schein) {
  // 1.10 Slice 3 (I7): sends, return faders and hall values are no channel faders; Cypher opens them without a Hoerschein
  HoerscheinRegister reg;   // leer
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));
  for (const char* f : {"spur/1/send/1", "spur/32/send/4", "grp/3/send/2", "ret/1/fader", "ret/4/pan", "ret/1/hall/decay", "ret/3/hall/fahne"})   // ramp controls only: switches take no ramp
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/fader") == Grund::kein_hoerschein);   // control: a channel fader still needs one
}

FALL(erzeuger_kanal_oeffnet_ohne_schein) {
  // Andreas 2026-09-29: erz/* öffnen ohne Hörschein; Deck-Kanäle bleiben gesperrt (pad/* seit 2026-10-05 offen).
  HoerscheinRegister reg;   // leer
  TestDeck deck;
  deck.setze_inhalt(deck2_kanal(), inhalt_von("matA", 128.0, 1));   // a loaded track: the deck channel is locked
  // K9: the table has no erz/<n> strips any more (the generator strips are the containers); the erz/ exemption of PrueferI3 has no row to meet here
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/fader") == Grund::kein_hoerschein);
  // Andreas 2026-10-05: „diese fader solltest du selber steuern können alle“. pad/* öffnet im Kern ohne Hörschein;
  // ob der Box-Inhalt Cyphers eigener Mitschnitt ist, prüft die Seite (server.ts eigenePad).
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/fader") == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/2/fader") == Grund::kein);
  // Der Kern öffnet auch den Trim (i3.cpp:82 nimmt fader und trim): dieselbe Ausnahme
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/trim") == Grund::kein);
}

// Andreas 2026-11-18 (SEQ deck): a deck channel with NOTHING loaded carries no track, only what the SEQ deck of that place plays into the strip (ADR 038).
// The core cannot tell SEQ from "empty"; the page narrows it to places with a SEQ deck (like pad/*: core free, page decides).
FALL(leeres_deck_oeffnet_ohne_schein) {
  HoerscheinRegister reg;   // leer: kein Schein
  TestDeck deck;            // nothing loaded on any deck
  for (int n = 1; n <= 4; n++) {
    char f[32];
    std::snprintf(f, sizeof f, n <= 2 ? "deck/%d/fader" : "pad/%d/fader", n <= 2 ? n : n - 2);   // K9: the players 3, 4 sound through pad/1, pad/2
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  }
  // trim opens through the same exemption: the fader is up (-10 dB), the trim moves from its closed value to 0 dB
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/trim", "deck/2/fader", -10.0f) == Grund::kein);
}

// Positive control of the previous case: the same calls on a LOADED deck are refused, fader AND trim (the trim line proves that lauf() really
// opens through the trim; if it returned kein here, the empty-deck trim assertion above would be vacuous); with a matching pass they pass.
FALL(geladenes_deck_bleibt_gesperrt) {
  HoerscheinRegister reg;
  TestDeck deck;
  for (int n = 1; n <= 4; n++) deck.setze_inhalt(deck_kanal(n), inhalt_von("matA", 128.0, 1));
  deck.setze_quell(deck_kanal(2), 4.0);   // inside the section of the pass
  for (int n = 1; n <= 4; n++) {
    char f[32];
    std::snprintf(f, sizeof f, n <= 2 ? "deck/%d/fader" : "pad/%d/fader", n <= 2 ? n : n - 2);   // K9: the players 3, 4 sound through pad/1, pad/2
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein_hoerschein);
  }
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/trim", "deck/2/fader", -10.0f) == Grund::kein_hoerschein);
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "h1", Quelle::cypher, "deck/2/trim", "deck/2/fader", -10.0f) == Grund::kein);
}

// The exemption is for deck channels only. There is no other channel gated by I3a: erz/* and pad/* are exempt, and since strand 11 bus/1..4 too
// (a bus carries no track, its fader is no longer hand only). So the empty deck table must not refuse bus/1/fader.
FALL(leeres_deck_nur_deck_kanaele) {
  HoerscheinRegister reg;
  TestDeck deck;   // empty
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "bus/1/fader") == Grund::kein);
  // andreas stays free everywhere, an empty deck changes nothing for him
  PRUEFE(lauf(reg, deck, true, "", Quelle::andreas, "deck/2/fader") == Grund::kein);
  // a part that does not open stays free (not an assertion about the exemption)
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/eq/tief") == Grund::kein);
}

FALL(fader_oeffnet_nicht_ohne_schein_kein) {
  // −200 auf −100: bleibt unter −26 dB, öffnet den Kanal nicht (I3a greift nur beim Öffnen)
  HoerscheinRegister reg;
  TestDeck deck;
  PrueferI3 pr(reg, deck);
  pr.schalte(true);
  Lauf l(128.0, &pr);
  l.sw->setze_direkt(l.r("deck/2/fader"), -200.0f);
  TeilBefehl b{78, Quelle::cypher, "pI3", 0, "deck/2/fader", 64, 32, -100, 0, 0, "", ""};
  l.sw->teil(b);
  l.nachlese_ereignisse();
  l.bis(1500000);
  PRUEFE(l.bei(78, Status::gestartet) >= 0);
  PRUEFE(l.grund(78, Status::abgelehnt) == Grund::kein);
}

FALL(register_gleiche_hs_id_ersetzt_statt_zweiten_platz) {
  HoerscheinRegister reg;
  char id[8];
  for (int i = 0; i < HoerscheinRegister::MAX; i++) {
    std::snprintf(id, sizeof id, "h%02d", i);
    reg.setze(schein_von(id, "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 1000.0), 0.0);
  }
  // Register ist jetzt voll (32 verschiedene hs_id). h00 mit anderem Kanal ersetzen: darf keinen der anderen
  // 31 Plätze verdrängen (sonst wäre die Belegung nicht mehr "ersetzt", sondern "verdrängt einen zweiten").
  reg.setze(schein_von("h00", "deck/3", inhalt_von("matB", 130.0, 2), 130.0, 1000.0), 0.0);
  const Schein* ersetzt = reg.finde("h00");
  PRUEFE(ersetzt != nullptr);
  if (ersetzt) PRUEFE(std::strcmp(ersetzt->kanal, "deck/3") == 0);
  for (int i = 1; i < HoerscheinRegister::MAX; i++) {
    std::snprintf(id, sizeof id, "h%02d", i);
    const Schein* s = reg.finde(id);
    PRUEFE(s != nullptr);
    if (s) PRUEFE(std::strcmp(s->kanal, "deck/2") == 0);
  }
}

FALL(register_33_verdraengt_abgelaufenen) {
  HoerscheinRegister reg;
  char id[8];
  for (int i = 0; i < HoerscheinRegister::MAX; i++) {
    std::snprintf(id, sizeof id, "h%02d", i);
    // h05 läuft schon bei Beat 50 ab, alle anderen erst bei Beat 1000
    const double gueltig = (i == 5) ? 50.0 : 1000.0;
    reg.setze(schein_von(id, "deck/2", inhalt_von("matA", 128.0, 1), 128.0, gueltig), 0.0);
  }
  reg.setze(schein_von("h_neu", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 1000.0), 100.0);   // beat_jetzt=100 > 50
  PRUEFE(reg.finde("h05") == nullptr);          // der abgelaufene ist weg
  PRUEFE(reg.finde("h_neu") != nullptr);        // der neue ist da
  for (int i = 0; i < HoerscheinRegister::MAX; i++) {
    if (i == 5) continue;
    std::snprintf(id, sizeof id, "h%02d", i);
    PRUEFE(reg.finde(id) != nullptr);           // alle anderen 31 bleiben unberührt
  }
}

FALL(register_weg_entfernt) {
  HoerscheinRegister reg;
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 1000.0), 0.0);
  PRUEFE(reg.finde("h1") != nullptr);
  reg.weg("h1");
  PRUEFE(reg.finde("h1") == nullptr);
}

// ---- container core K8: the hearing license follows the container (D-V6, R12: nothing gets stricter) --------------------------------------------------------------------------------
// The key of a Hoerschein is the PLAYER name (deck/<player>), never the container path. A strip needs one only while its container input is `player` and that player holds a track.

FALL(i3_a_player_geladen) {   // container A (deck/1), art player, player 1 loaded: a pass on deck/1 is needed and enough
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck_kanal(1), inhalt_von("matA", 128.0, 1));
  deck.setze_quell(deck_kanal(1), 4.0);   // inside the section of the pass
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/1/fader") == Grund::kein_hoerschein);
  reg.setze(schein_von("h1", "deck/1", inhalt_von("matA", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1", Quelle::cypher, "deck/1/fader") == Grund::kein);
}

FALL(i3_c_player_geladen) {   // container C (pad/1), art player, player 3 loaded: needed, and the key is deck/3, not pad/1
  HoerscheinRegister reg;
  TestDeck deck;
  const int c = pfad_kanal("pad/1/fader");
  deck.setze_player(c, 3);
  deck.setze_inhalt(c, inhalt_von("matC", 128.0, 1));
  deck.setze_quell(c, 4.0);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/fader") == Grund::kein_hoerschein);       // today deck/3 needed one, pad/1 did not: nothing gets stricter, nothing is lost
  reg.setze(schein_von("h1", "pad/1", inhalt_von("matC", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1", Quelle::cypher, "pad/1/fader") == Grund::hoerschein_anderer_kanal);   // the container path is not the key
  reg.setze(schein_von("h2", "deck/3", inhalt_von("matC", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h2", Quelle::cypher, "pad/1/fader") == Grund::kein);                      // the player name is
  PRUEFE(lauf(reg, deck, true, "", Quelle::andreas, "pad/1/fader") == Grund::kein);                       // the hand is never blocked
}

FALL(i3_seq_modul_frei) {   // a SEQ deck: container A takes the module (art modul); even a track left in player 1 is not heard there, the strip is free
  HoerscheinRegister reg;
  TestDeck deck;
  const int a = deck_kanal(1);
  deck.setze_player(a, 0);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/1/fader") == Grund::kein);
  deck.setze_inhalt(a, inhalt_von("matA", 128.0, 1));
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/1/fader") == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/1/trim", "deck/1/fader", -10.0f) == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/fader") == Grund::kein);   // an empty container B is free as before
}

FALL(i3_strudel_frei) {   // a stream (strudel) in a container: art modul on D (pad/2), free; the erz strips stay free
  HoerscheinRegister reg;
  TestDeck deck;
  const int d = pfad_kanal("pad/2/fader");
  deck.setze_player(d, 0);
  deck.setze_inhalt(d, inhalt_von("matD", 128.0, 1));
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/2/fader") == Grund::kein);
}

FALL(i3_loopdeck_frei) {   // a loop deck (pad strips in the old table, containers C and D now) with art modul: free; with a player loaded behind art player it is not
  HoerscheinRegister reg;
  TestDeck deck;
  const int c = pfad_kanal("pad/1/fader");
  deck.setze_player(c, 0);
  deck.setze_inhalt(c, inhalt_von("matC", 128.0, 1));
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/fader") == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/trim", "pad/1/fader", -10.0f) == Grund::kein);
  deck.setze_player(c, 3);   // control: the same strip with the player behind it is locked
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/fader") == Grund::kein_hoerschein);
}

FALL(i3_leer_frei) {   // an empty container (art leer): nothing sounds, free, whatever the player holds
  HoerscheinRegister reg;
  TestDeck deck;
  for (int n = 1; n <= 4; n++) {
    char f[32];
    std::snprintf(f, sizeof f, n <= 2 ? "deck/%d/fader" : "pad/%d/fader", n <= 2 ? n : n - 2);   // K9: the players 3, 4 sound through pad/1, pad/2
    deck.setze_player(deck_kanal(n), 0);
    deck.setze_inhalt(deck_kanal(n), inhalt_von("matX", 128.0, 1));
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  }
  for (const char* f : {"pad/1/fader", "pad/2/fader"}) {
    deck.setze_player(pfad_kanal(f), 0);
    deck.setze_inhalt(pfad_kanal(f), inhalt_von("matX", 128.0, 1));
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  }
}

FALL(i3_spur_ausgenommen) {   // spur, grp and pm rows stay exempt next to loaded containers
  HoerscheinRegister reg;
  TestDeck deck;
  deck.setze_inhalt(deck_kanal(1), inhalt_von("matA", 128.0, 1));
  for (const char* f : {"spur/1/fader", "spur/8/fader", "spur/3/pan", "grp/1/fader", "grp/8/fader", "grp/3/pan", "pm/fader"})
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/1/fader") == Grund::kein_hoerschein);   // control
}

PRUEF_MAIN
