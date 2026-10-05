// Scheibe 20, Task 13: Hörschein-Register und Prüfer I3a (SCHNITTSTELLEN §17 I3a, §4.5). Aufbau nach test_pruefer.cpp:
// ein Teil öffnet deck/2/fader (Fader von −200 auf 0 dB), PrueferI3 prüft ihn gegen Register und Deck-Modell.
#include <cmath>
#include <cstdio>

#include "cypherdj/stellwerk/i3.h"
#include "pruef.h"
#include "szenario.h"

using namespace probe;
using namespace cypherdj::stellwerk;

namespace {

// Deck-Modell-Doppel: fester Inhalt und feste Quellposition je Kanal-Index, ohne Allokation (feste Kanalzahl).
class TestDeck : public DeckModell {
 public:
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
};

Inhalt inhalt_von(const char* material_id, double bpm, int fassung) {
  Inhalt i{};
  std::snprintf(i.material_id, sizeof i.material_id, "%s", material_id);
  i.bpm_milli = static_cast<int32_t>(bpm * 1000.0 + 0.5);
  i.fassung = fassung;
  return i;
}

// Der echte Kanal-Index von "deck/2" in der Regler-Tabelle (dieselbe Tabelle, die jeder Lauf baut, §1.5 fest verdrahtet).
int deck2_kanal() {
  Lauf sonde;
  return sonde.sw->tabelle().def(sonde.r("deck/2/fader")).kanal;
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

// Wie test_pruefer.cpp: ein Teil, der deck/2/fader von −200 auf 0 dB öffnet, Start bei Beat 64 (Sample 1 440 000
// bei 128 BPM). `hs` = Hörschein-Feld des Teils, `quelle` seine Quelle. Rückgabe: Grund::kein, wenn gestartet,
// sonst der Ablehnungsgrund.
Grund lauf(const HoerscheinRegister& reg, const DeckModell& deck, bool an, const char* hs = "",
           Quelle quelle = Quelle::cypher, const char* fader = "deck/2/fader") {
  PrueferI3 pr(reg, deck);
  pr.schalte(an);
  Lauf l(128.0, &pr);
  l.sw->setze_direkt(l.r(fader), -200.0f);
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

FALL(schein_kein_inhalt_geladen) {
  HoerscheinRegister reg;
  TestDeck deck;   // kein setze_inhalt: nichts geladen
  reg.setze(schein_von("h1", "deck/2", inhalt_von("matA", 128.0, 1), 128.0, 200.0), 0.0);
  PRUEFE(lauf(reg, deck, true, "h1") == Grund::hoerschein_anderer_inhalt);
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

FALL(erzeuger_kanal_oeffnet_ohne_schein) {
  // Andreas 2026-09-29: erz/* öffnen ohne Hörschein; Deck- und Pad-Kanäle bleiben gesperrt.
  HoerscheinRegister reg;   // leer
  TestDeck deck;
  for (int n = 1; n <= 8; n++) {
    char f[32];
    std::snprintf(f, sizeof f, "erz/%d/fader", n);
    PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, f) == Grund::kein);
  }
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "deck/2/fader") == Grund::kein_hoerschein);
  PRUEFE(lauf(reg, deck, true, "", Quelle::cypher, "pad/1/fader") == Grund::kein_hoerschein);
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

PRUEF_MAIN
