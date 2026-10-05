// Naht-Probe: ein Prüfer wie in Scheibe 20, abgeleitet von pruefer.h mit `override` an allen vier Haken (bricht die
// Naht, baut das nicht mehr; -DNAHT_FEHLERFALL=ON zeigt es), und ein Stellwerk, das die Rampe aus teil_rampe fährt.
// Ausgabe: eine Zeile.
#include <cstdio>
#include <memory>

#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

namespace {
class Zwanzig final : public Pruefer {
 public:
  int vor = 0, zyklus = 0, hand = 0, gefallen = 0;
  Grund vor_teilstart(const Sicht& s, const TeilSicht& t) override {
    vor += s.pruefwert_mit(t.regler, t) > s.pruefwert_vor(t.regler, t) - 1000.0f;
    return Grund::kein;
  }
  void je_zyklus(const Sicht& s, Eingriff& e) override {
    (void)e;
    zyklus += s.zyklus_laenge() > 0;
  }
  void nach_handgriff(const Sicht& s, Eingriff& e, int regler, int64_t sample) override {
    (void)s; (void)e; (void)regler; (void)sample;
    hand++;
  }
  void gruppe_gefallen(const Sicht& s, const char* plan, const char* gruppe, Grund g, int64_t sample) override {
    (void)s; (void)plan; (void)gruppe; (void)g; (void)sample;
    gefallen++;
  }
#ifdef NAHT_FEHLERFALL
  // Fehlerfall: ein Haken mit geänderter Signatur (wie nach einer Änderung an pruefer.h) baut nicht
  Grund vor_teilstart(const Sicht& s, TeilSicht t) override { (void)s; (void)t; return Grund::kein; }
#endif
};
}  // namespace

int main() {
  SimUhr uhr(128.0);
  Zwanzig p;
  auto sw = std::make_unique<Stellwerk>(uhr, &p);
  const int f = sw->tabelle().suche("deck/2/fader");
  sw->setze_direkt(f, -15.0f);
  sw->teil(TeilBefehl{1, Quelle::cypher, "p1", 0, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "b_rein", ""});
  float bei_80 = 0;
  for (int64_t s0 = 0; s0 < 2200000; s0 += 256) {
    sw->prozess(s0, 256);
    const Aenderung* a;
    const int n = sw->aenderungen(&a);
    if (s0 <= 1800000 && 1800000 < s0 + 256)
      for (int k = 0; k < n; k++)
        if (a[k].regler == f) bei_80 = a[k].verlauf[1800000 - s0];
    sw->ereignisse_leeren();
  }
  std::printf("naht: deck/2/fader bei Beat 80 = %.4f dB, vor_teilstart %d, je_zyklus %d\n", bei_80, p.vor, p.zyklus);
  return (bei_80 > -7.51f && bei_80 < -7.49f && p.vor == 1 && p.zyklus > 8000) ? 0 : 1;
}
