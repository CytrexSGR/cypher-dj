// Stellwerk-RT: Regler-Tabelle nach SCHNITTSTELLEN §1.5, Standard-Kurven nach §7.2, Deck-Halter nach §7.3 Punkt 5.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"

namespace cypherdj::stellwerk {

namespace {

constexpr int MS(double ms) { return static_cast<int>(ms * SR / 1000.0 + 0.5); }
constexpr Kurve K_FADER{KurvenTyp::fader_db, -200.0f, 0.0f, false};
constexpr Kurve K_EQ{KurvenTyp::linear, -26.0f, 6.0f, true};      // §7.2 Beispiel: linear -26..+6, kill_unter_min
constexpr Kurve K_SCHALTER{KurvenTyp::schalter, 0.0f, 1.0f, false};

Kurve linear(float a, float b) { return Kurve{KurvenTyp::linear, a, b, false}; }
Kurve stufen(float a, float b) { return Kurve{KurvenTyp::stufen, a, b, false}; }

}  // namespace

ReglerTabelle::ReglerTabelle() {
  auto kanal = [&](const char* n) { std::snprintf(kanal_[n_kanal_], sizeof kanal_[0], "%.11s", n); return n_kanal_++; };
  auto neu = [&](const char* pfad, int k, Rolle rolle, float mn, float mx, float vorgabe, int schalt, bool nur_hand,
                 bool db, bool keine_rampe, bool ganz, Kurve kurve, int deck = 0) {
    if (n_ >= MAX_REGLER) {   // K2 Task 0.2: vorher schrieb neu() ohne Prüfung über def_ hinaus
      std::fprintf(stderr, "ReglerTabelle: mehr als %d Regler, %s verworfen\n", MAX_REGLER, pfad);
      std::abort();           // Tabelle wird einmal beim Start gebaut: lieber laut sterben als still Speicher zerstören
    }
    ReglerDef& d = def_[n_++];
    std::snprintf(d.pfad, sizeof d.pfad, "%s", pfad);
    d.kanal = static_cast<int8_t>(k);
    d.deck = static_cast<int8_t>(deck);
    d.rolle = rolle;
    d.min = mn;
    d.max = mx;
    d.vorgabe = vorgabe;
    d.schalt_samples = schalt;
    d.nur_hand = nur_hand;
    d.db = db;
    d.keine_rampe = keine_rampe;
    d.ganzzahlig = ganz;
    d.transport = rolle == Rolle::transport;
    d.kurve = kurve;
  };
  // Kanäle mit Kanalzug (§1.5): deck/1..4, erz/1..8, pad/1..2, bus/1..4
  struct Gruppe { const char* name; int anzahl; };
  const Gruppe gruppen[] = {{"deck", 4}, {"erz", 8}, {"pad", 2}, {"bus", 4}};
  char p[32];
  char kn[16];
  for (const Gruppe& g : gruppen) {
    for (int i = 1; i <= g.anzahl; i++) {
      std::snprintf(kn, sizeof kn, "%s/%d", g.name, i);
      const int k = kanal(kn);
      const bool bus = std::strcmp(g.name, "bus") == 0;
      const bool deck = std::strcmp(g.name, "deck") == 0;
      auto pf = [&](const char* rest) { std::snprintf(p, sizeof p, "%s/%s", kn, rest); return p; };
      neu(pf("fader"), k, Rolle::fader, -200, 0, -200, MS(10), bus, true, false, false, K_FADER);
      neu(pf("trim"), k, Rolle::trim, -24, 24, 0, MS(10), false, false, false, false, linear(-24, 24));
      neu(pf("eq/tief"), k, Rolle::eq_tief, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("eq/mitte"), k, Rolle::eq_mitte, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("eq/hoch"), k, Rolle::eq_hoch, -200, 6, 0, MS(10), false, true, false, false, K_EQ);
      neu(pf("kill/tief"), k, Rolle::kill_tief, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("kill/mitte"), k, Rolle::kill_mitte, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("kill/hoch"), k, Rolle::kill_hoch, 0, 1, 0, MS(5), false, false, true, true, K_SCHALTER);
      neu(pf("filter"), k, Rolle::filter, -1, 1, 0, MS(20), false, false, false, false, linear(-1, 1));
      for (int s = 1; s <= 4; s++) {
        char rest[16];
        std::snprintf(rest, sizeof rest, "send/%d", s);
        neu(pf(rest), k, Rolle::send, -200, 0, -200, MS(10), false, true, false, false, K_FADER);
      }
      if (!bus) neu(pf("ziel"), k, Rolle::ziel, 0, 4, 0, 0, true, false, true, true, stufen(0, 4));
      if (deck) {
        neu(pf("stem/drums"), k, Rolle::stem_drums, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/bass"), k, Rolle::stem_bass, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/vocals"), k, Rolle::stem_vocals, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
        neu(pf("stem/other"), k, Rolle::stem_other, -200, 6, 0, MS(10), false, true, false, false, K_EQ, i);
      }
      neu(pf("xseite"), k, Rolle::xseite, 0, 2, 1, 0, true, false, true, true, stufen(0, 2));
      neu(pf("pfl"), k, Rolle::pfl, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
      if (deck) neu(pf("transport"), k, Rolle::transport, 0, 0, 0, 0, true, false, true, true, K_SCHALTER, i);
    }
  }
  const int master = kanal("master");
  const int cue = kanal("cue");
  neu("xfader", -1, Rolle::xfader, -1, 1, 0, MS(10), true, false, false, false, linear(-1, 1));
  neu("master/pegel", master, Rolle::master_pegel, -200, 0, 0, MS(10), true, true, false, false, K_FADER);
  neu("master/kleber", master, Rolle::master_kleber, 0, 1, 0, MS(10), true, false, false, false, linear(0, 1));
  neu("cue/mix", cue, Rolle::cue_mix, -1, 1, -1, MS(10), true, false, false, false, linear(-1, 1));
  neu("cue/pegel", cue, Rolle::cue_pegel, -200, 0, -12, MS(10), true, true, false, false, K_FADER);
  neu("cue/split", cue, Rolle::cue_split, 0, 1, 0, 0, true, false, true, true, K_SCHALTER);
  for (int n = 1; n <= 2; n++) {
    std::snprintf(p, sizeof p, "fx/%d/notenwert", n);
    neu(p, -1, Rolle::fx_notenwert, 1.0f / 32, 4, 0.75f, 0, false, false, true, false, linear(1.0f / 32, 4));
  }
  for (int n = 1; n <= 2; n++) {
    std::snprintf(p, sizeof p, "fx/%d/rueckkopplung", n);
    neu(p, -1, Rolle::fx_rueckkopplung, 0, 0.95f, 0.5f, MS(10), false, false, false, false, linear(0, 0.95f));
  }
  for (int n = 1; n <= 4; n++) {
    std::snprintf(p, sizeof p, "fx/%d/rueckweg", n);
    neu(p, -1, Rolle::fx_rueckweg, -200, 0, 0, MS(10), false, true, false, false, K_FADER);
  }
  neu("duck/tiefe", -1, Rolle::duck_tiefe, -24, 0, 0, MS(10), false, true, false, false, linear(-24, 0));
  neu("duck/release", -1, Rolle::duck_release, 50, 600, 200, 0, false, false, true, false, linear(50, 600));
  // Keylock Task 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4; Andreas 06.10.: „an jeder dj software gibts nen knopf
  // der über alles die tonhöhe gleichhält“): EIN Schalter für Decks, Loop-Boxen und Loop auf dem Deck, Vorgabe 1, kein
  // Deck-Argument (sonst keine_stems, Prüfer B1), alle Quellen; Argumentfolge wie transport.
  neu("keylock", -1, Rolle::keylock, 0, 1, 1, 0, false, false, true, true, K_SCHALTER);
  for (int i = 0; i < n_; i++) sortiert_[i] = static_cast<int16_t>(i);
  std::sort(sortiert_, sortiert_ + n_, [&](int16_t a, int16_t b) { return std::strcmp(def_[a].pfad, def_[b].pfad) < 0; });
}

int ReglerTabelle::suche(const char* pfad) const {
  int lo = 0, hi = n_ - 1;
  while (lo <= hi) {
    const int mitte = (lo + hi) / 2;
    const int c = std::strcmp(def_[sortiert_[mitte]].pfad, pfad);
    if (c == 0) return sortiert_[mitte];
    if (c < 0) lo = mitte + 1; else hi = mitte - 1;
  }
  return -1;
}

int ReglerTabelle::kanal_suche(const char* name) const {
  for (int k = 0; k < n_kanal_; k++) if (std::strcmp(kanal_[k], name) == 0) return k;
  return -1;
}

int ReglerTabelle::regler_von(int kanal, Rolle rolle) const {
  for (int r = 0; r < n_; r++) if (def_[r].kanal == kanal && def_[r].rolle == rolle) return r;
  return -1;
}

float ReglerTabelle::zu_x(const Kurve& k, float w) {
  float x = 0;
  switch (k.typ) {
    case KurvenTyp::fader_db: x = w <= STUMM_GRENZE ? 0.0f : std::pow(10.0f, (w - k.max) / 20.0f); break;
    case KurvenTyp::linear:
      if (k.kill_unter_min && w < k.min) x = 0.0f; else x = (w - k.min) / (k.max - k.min);
      break;
    case KurvenTyp::schalter: x = w; break;
    case KurvenTyp::stufen: x = (w - k.min) / (k.max - k.min); break;
  }
  return std::min(1.0f, std::max(0.0f, x));
}

float ReglerTabelle::aus_x(const Kurve& k, float x) {
  x = std::min(1.0f, std::max(0.0f, x));
  switch (k.typ) {
    case KurvenTyp::fader_db: return x < 0.001f ? STUMM : k.max + 20.0f * std::log10(x);   // §7.2: unter -60 dB stumm
    case KurvenTyp::linear:
      if (k.kill_unter_min && x <= 0.0f) return STUMM;
      return k.min + x * (k.max - k.min);
    case KurvenTyp::schalter: return x >= 0.5f ? 1.0f : 0.0f;
    case KurvenTyp::stufen: return k.min + std::round(x * (k.max - k.min));
  }
  return 0.0f;
}

}  // namespace cypherdj::stellwerk
