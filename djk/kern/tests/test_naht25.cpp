// Scheibe 25, Naht: die Kanalzug-Bibliothek (Scheibe 04) und die Stellwerk-Bibliothek (Scheibe 11) bauen im Kern und
// arbeiten zusammen. Das Stellwerk fährt die Rampe aus teil_rampe (SCHNITTSTELLEN §19.3: deck/2/fader −15 → 0 dB ab
// Beat 64 über 32 Beats bei 128 BPM), sein Verlauf je Sample geht in einen Kanalzug. Erwartet: Wert bei Beat 80
// (Sample 1 800 000) −7,5 dB, der Kanalzug ruht danach auf dem letzten Verlauf-Wert, und ein Eingang 1,0 kommt bei
// Fader −200 als exakt 0 heraus (Negativ-Kontrolle), bei −7,5 dB mit 10^(−7,5/20) (nach dem Einschwingen des LR8).
#include <cmath>
#include <memory>

#include <cypherdj/dsp/kanalzug.h>

#include "cypherdj/stellwerk/stellwerk.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;
namespace dsp = cypherdj::dsp;

struct Uhr128 final : sw::Uhr {  // konstant 128 BPM ab Sample 0 (§1.3)
  double beat(int64_t s) const override { return s / 22500.0; }
  double sample_genau(double b) const override { return b * 22500.0; }
  double bpm(int64_t) const override { return 128.0; }
};

int main() {
  Uhr128 uhr;
  auto stw = std::make_unique<sw::Stellwerk>(uhr);
  auto kz = std::make_unique<dsp::Kanalzug>();
  kz->zuruecksetzen();
  const int f = stw->tabelle().suche("deck/2/fader");
  PRUEF(f >= 0);
  stw->teil(sw::TeilBefehl{5, sw::Quelle::cypher, "p1", 1, "deck/2/fader", 64.0, 0.0, -15.0f, 0, 0, "b_rein", "h2"});
  stw->teil(sw::TeilBefehl{6, sw::Quelle::cypher, "p1", 2, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "b_rein", "h2"});
  float ein[256], l[256], r[256];
  for (float& x : ein) x = 1.0f;
  dsp::KanalzugAusgang aus;
  aus.haupt_l = l;
  aus.haupt_r = r;
  float bei_80 = NAN, aus_vor_start = 1.0f, aus_bei_80 = 0.0f;
  for (int64_t s0 = 0; s0 < 2'200'000; s0 += 256) {
    stw->prozess(s0, 256);
    const sw::Aenderung* a;
    const int n = stw->aenderungen(&a);
    for (int k = 0; k < n; ++k)
      if (a[k].regler == f) {
        kz->verlauf(dsp::Regler::fader, a[k].verlauf);
        if (s0 <= 1'800'000 && 1'800'000 < s0 + 256) bei_80 = a[k].verlauf[1'800'000 - s0];
      }
    kz->verarbeite(ein, ein, 256, aus);
    if (s0 + 256 <= 1'440'000) aus_vor_start = std::fabs(l[255]);  // Fader −200: exakt 0
    if (s0 <= 1'800'000 && 1'800'000 < s0 + 256) aus_bei_80 = l[1'800'000 - s0];
    stw->ereignisse_leeren();
  }
  PRUEF_NAH(bei_80, -7.5, 0.01);
  PRUEF(aus_vor_start == 0.0f);
  PRUEF_NAH(aus_bei_80, std::pow(10.0, -7.5 / 20.0), 1e-3);  // DC durch den eingeschwungenen LR8: Verstärkung 1
  PRUEF_NAH(kz->wert(dsp::Regler::fader), 0.0, 1e-6);         // nach dem Ende ruht der Kanalzug auf 0 dB
  PRUEF_ENDE();
}
