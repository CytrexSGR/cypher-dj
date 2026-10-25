// E3 Task 7: Verlaufs-Deckel MAX_BEWEGT. Projekt öffnen setzt bei 32 Spuren 4 * 32 Spur-Regler plus 16 erz/4-Regler
// in einem Zyklus (dauer_beats = 0, Politik 1); jeder braucht einen Verlauf-Slot, sonst erfährt der Mixer nichts (still).
// Vorlage: ~/messungen/2026-10-20-e3-karte/messung/bewegt.cpp.
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <vector>

#include "pruef.h"
#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

namespace {
struct Soll {
  std::string pfad;
  float wert;
};

// Setzt alle Soll-Regler als Teil (dauer 0, Politik 1) und fährt drei Zyklen; liefert die Regler mit Verlauf im ersten.
void fahre(Stellwerk& sw, SimUhr& uhr, const std::vector<Soll>& soll, std::set<int>* mit_verlauf) {
  const ReglerTabelle& t = sw.tabelle();
  sw.prozess(0, 256);
  const double ab = uhr.beat(sw.jetzt());
  int64_t id = 100;
  for (const Soll& s : soll)
    sw.teil(TeilBefehl{id++, Quelle::andreas, "", 0, s.pfad.c_str(), ab, 0.0, s.wert, 0, 1, "", ""});
  const int64_t s0 = sw.jetzt();
  for (int z = 0; z < 3; ++z) {
    sw.prozess(s0 + z * 256, 256);
    if (z == 0) {
      const Aenderung* a;
      const int na = sw.aenderungen(&a);
      for (int i = 0; i < na; ++i) mit_verlauf->insert(a[i].regler);
    }
  }
  (void)t;
}

std::vector<Soll> projekt_oeffnen() {
  std::vector<Soll> soll;
  const char* e4[] = {"erz/4/fader", "erz/4/trim", "erz/4/eq/tief", "erz/4/eq/mitte", "erz/4/eq/hoch", "erz/4/kill/tief",
                      "erz/4/kill/mitte", "erz/4/kill/hoch", "erz/4/filter", "erz/4/komp/an", "erz/4/send/1", "erz/4/send/2",
                      "erz/4/send/3", "erz/4/send/4", "erz/4/ziel", "erz/4/xseite"};
  for (const char* p : e4) soll.push_back({p, std::strstr(p, "send") ? -200.0f : (std::strstr(p, "xseite") ? 1.0f : 0.0f)});
  for (int n = 1; n <= SPUR_REGLER_SPUREN; ++n) {
    char p[32];
    std::snprintf(p, sizeof p, "spur/%d/fader", n); soll.push_back({p, -6.0f});
    std::snprintf(p, sizeof p, "spur/%d/pan", n); soll.push_back({p, 0.25f});
    std::snprintf(p, sizeof p, "spur/%d/mute", n); soll.push_back({p, 1.0f});
    std::snprintf(p, sizeof p, "spur/%d/solo", n); soll.push_back({p, 0.0f});
  }
  return soll;
}
}  // namespace

FALL(projekt_oeffnen_144_regler_alle_mit_verlauf) {
  SimUhr uhr(128.0);
  Stellwerk sw(uhr);
  std::printf("  sizeof(Stellwerk) = %zu, MAX_BEWEGT = %d\n", sizeof(Stellwerk), MAX_BEWEGT);
  const std::vector<Soll> soll = projekt_oeffnen();
  PRUEFE_GLEICH(soll.size(), 144);
  std::set<int> mit;
  fahre(sw, uhr, soll, &mit);
  PRUEFE_GLEICH(sw.zaehler().bewegt_voll, 0);
  PRUEFE_GLEICH(sw.zaehler().teile_voll, 0);
  PRUEFE_GLEICH(mit.size(), 144);   // genau die 144 Regler haben einen Verlauf
  const ReglerTabelle& t = sw.tabelle();
  int ohne = 0, falsch = 0;
  for (const Soll& s : soll) {
    const int r = t.suche(s.pfad.c_str());
    PRUEFE(r >= 0);
    if (r < 0) continue;
    if (!mit.count(r)) ohne++;
    if (std::fabs(sw.wert(r) - s.wert) > 1e-3) falsch++;
  }
  PRUEFE_GLEICH(ohne, 0);     // Mixer und Arrangement erfahren jede Änderung
  PRUEFE_GLEICH(falsch, 0);   // jeder Regler hat den Zielwert
}

// n_teile verschiedene Regler als Teil, dazu ein Hand-Griff auf einen weiteren: n_teile + 1 bewegte Regler.
// Zählung (Review-Nachzug): bewegt_voll zählt abgelehnte slot_fuer-Aufrufe, nicht Regler (Teilstart und Strecke rufen je
// einmal), im Grenzfall steht 1 nur, weil der Griff als letzter und genau einmal ruft. Darum prüft der Fall zusätzlich
// direkt, was ankommt: aenderungen() hat genau min(n_teile + 1, MAX_BEWEGT) Einträge, und der Extra-Regler fehlt darin
// genau dann, wenn der Deckel gerissen ist (erwartet_voll > 0).
static void teile_plus_griff(int n_teile, int64_t erwartet_voll) {
  SimUhr uhr(128.0);
  Stellwerk sw(uhr);
  const ReglerTabelle& t = sw.tabelle();
  std::vector<Soll> soll;
  int extra = -1;
  for (int r = 0; r < t.anzahl(); ++r) {
    const ReglerDef& d = t.def(r);
    if (d.transport || d.nur_hand || d.deck) continue;   // Stems hängen an Deck-Zustand, ihr Teil bewegt nichts
    if (static_cast<int>(soll.size()) < n_teile) {
      soll.push_back({d.pfad, d.max != d.vorgabe ? d.max : d.min});
    } else {
      extra = r;
      break;
    }
  }
  PRUEFE_GLEICH(soll.size(), n_teile);
  PRUEFE(extra >= 0);
  sw.prozess(0, 256);
  const double ab = uhr.beat(sw.jetzt());
  int64_t id = 100;
  for (const Soll& s : soll)
    sw.teil(TeilBefehl{id++, Quelle::andreas, "", 0, s.pfad.c_str(), ab, 0.0, s.wert, 0, 1, "", ""});
  const int64_t s0 = sw.jetzt();
  // §7.3: der erste absolute Wert ist nur Stellung, erst der zweite jenseits der Totzone bewegt den Regler
  sw.hand(Griff{s0 + 10, static_cast<int16_t>(extra), GriffArt::absolut, 0.2f, nullptr});
  sw.hand(Griff{s0 + 20, static_cast<int16_t>(extra), GriffArt::absolut, 0.9f, nullptr});
  sw.prozess(s0, 256);
  PRUEFE_GLEICH(sw.zaehler().teile_voll, 0);   // ein Verlust käme vom Verlaufs-Deckel, nicht vom Teile-Deckel
  PRUEFE_GLEICH(sw.zaehler().bewegt_voll, erwartet_voll);
  const Aenderung* a = nullptr;
  const int na = sw.aenderungen(&a);
  PRUEFE_GLEICH(na, n_teile + 1 > MAX_BEWEGT ? MAX_BEWEGT : n_teile + 1);
  bool extra_da = false;
  for (int i = 0; i < na; ++i) extra_da = extra_da || a[i].regler == extra;
  PRUEFE_GLEICH(extra_da ? 1 : 0, erwartet_voll > 0 ? 0 : 1);   // der verlorene Verlauf ist der des Griffs
}

FALL(deckel_256_teile_plus_ein_griff_verliert_genau_einen_verlauf) { teile_plus_griff(MAX_TEILE, 1); }

// Negativ-Kontrolle: 255 Teile plus ein Griff = 256 bewegte Regler passen in den Deckel
FALL(deckel_255_teile_plus_ein_griff_verliert_nichts) { teile_plus_griff(MAX_TEILE - 1, 0); }

FALL(projekt_oeffnen_mit_gruppen_177_regler_alle_mit_verlauf) {
  SimUhr uhr(128.0);
  Stellwerk sw(uhr);
  std::vector<Soll> soll = projekt_oeffnen();
  for (int n = 1; n <= GRP_REGLER_GRUPPEN; ++n) {
    char p[32];
    std::snprintf(p, sizeof p, "grp/%d/fader", n); soll.push_back({p, -3.0f});
    std::snprintf(p, sizeof p, "grp/%d/pan", n); soll.push_back({p, 0.5f});
    std::snprintf(p, sizeof p, "grp/%d/mute", n); soll.push_back({p, 1.0f});
    std::snprintf(p, sizeof p, "grp/%d/solo", n); soll.push_back({p, 0.0f});
  }
  soll.push_back({"pm/fader", -1.5f});
  PRUEFE_GLEICH(soll.size(), 177);
  std::set<int> mit;
  fahre(sw, uhr, soll, &mit);
  PRUEFE_GLEICH(sw.zaehler().bewegt_voll, 0);
  PRUEFE_GLEICH(sw.zaehler().teile_voll, 0);
  PRUEFE_GLEICH(mit.size(), 177);
  const ReglerTabelle& t = sw.tabelle();
  int ohne = 0, falsch = 0;
  for (const Soll& s : soll) {
    const int r = t.suche(s.pfad.c_str());
    PRUEFE(r >= 0);
    if (r < 0) continue;
    if (!mit.count(r)) ohne++;
    if (std::fabs(sw.wert(r) - s.wert) > 1e-3) falsch++;
  }
  PRUEFE_GLEICH(ohne, 0);
  PRUEFE_GLEICH(falsch, 0);
}

PRUEF_MAIN
