// Scheibe 25: die Hand gewinnt am selben Sample, offline über Kern::zyklus. Die Golden-Folge hand_gewinnt
// (SCHNITTSTELLEN §19.3) ohne Deck- und Hörschein-Zeilen, der Prüf-Handeingang als Befehl HAND (§19.0, wie /test/hand):
//   0,5 bei Sample 1 500 000 setzt nur die Stellung (§7.3 Punkt 2), 0,5 + 4/128 bei 1 620 000 liegt über der Totzone:
//   Abbruch der Rampe (Teil 7) und des wartenden Teils 8 derselben Gruppe b_rein mit Quittung 7 `hand` bei genau
//   1 620 000, Halter mensch am selben Sample, Teil 9 (Gruppe echo) läuft weiter. Am Master steht der Pegel des
//   Prüfklicks in deck/2 ab dem Griff still, vorher steigt er je Beat um 15/32 dB.
// 1 620 000 liegt 32 Samples hinter einem Blockanfang (6 328 · 256 = 1 619 968). Derselbe Test gegen den Kern mit
// -DCYPHERDJ_MUTATION_HAND_BLOCKANFANG (Griff am Blockanfang) muss scheitern (CTest WILL_FAIL, Fehlerfall der Abnahme).
#include <cstdio>

#include "kern25.h"
#include "pruef.h"

int main() {
  Kern25 k;
  k.mitschreiben = true;
  k.klick(2, "deck/2", 1);
  k.teil(5, "cypher", "p1", 1, "deck/2/eq/tief", 63.0, 0.0, -30.0f, 0, 0, "b_rein", "");
  k.teil(6, "cypher", "p1", 2, "deck/2/fader", 64.0, 0.0, -15.0f, 0, 0, "b_rein", "h2");
  k.teil(7, "cypher", "p1", 3, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "b_rein", "h2");
  k.teil(8, "cypher", "p1", 4, "deck/2/eq/tief", 76.0, 4.0, 0.0f, 0, 0, "b_rein", "");
  k.teil(9, "cypher", "p1", 5, "deck/2/send/1", 68.0, 16.0, -20.0f, 0, 0, "echo", "");
  k.bis(1'400'000);
  k.hand("deck/2/fader", 0.5f, 1'500'000);
  k.bis(1'600'000);
  k.hand("deck/2/fader", 0.53125f, 1'620'000);
  k.bis(2'200'000);

  PRUEF_NAH(k.wert_bei("deck/2/fader", 1'560'000), -12.5, 0.01);  // Stellung allein ändert nichts
  const cdj::Ereignis* q7 = k.q(7, 7);
  const cdj::Ereignis* q8 = k.q(8, 7);
  std::printf("Abbruch Teil 7 bei Sample %lld, Teil 8 bei %lld\n", q7 ? (long long)q7->sample : -1LL,
              q8 ? (long long)q8->sample : -1LL);
  PRUEF(q7 && q7->sample == 1'620'000 && !std::strcmp(q7->grund, "hand") && q7->beat == 72.0);
  PRUEF(q8 && q8->sample == 1'620'000 && !std::strcmp(q8->grund, "hand"));
  PRUEF(k.q(9, 7) == nullptr && k.q(9, 3) && k.q(9, 3)->sample == 1'890'000);  // Gruppe echo läuft zu Ende
  PRUEF_NAH(k.wert_bei("deck/2/send/1", 1'710'000), -40.0, 0.01);             // von stumm ab −60 (§1.2)
  PRUEF_NAH(k.wert_bei("deck/2/eq/tief", 1'800'000), -30.0, 0.01);            // Teil 8 entfiel
  const double f80 = k.wert_bei("deck/2/fader", 1'800'000);
  PRUEF(f80 > -11.25 && f80 <= 0.0);  // skaliert nach oben (FORMAT.md Punkt 22 d)
  bool halter = false, hand = false;
  for (const auto& e : k.ev) {
    if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "deck/2/fader") && !std::strcmp(e.text, "mensch"))
      halter = halter || e.sample == 1'620'000;
    if (e.art == cdj::Ereignis::HAND && !std::strcmp(e.pfad, "deck/2/fader")) hand = hand || e.sample == 1'620'000;
  }
  PRUEF(halter && hand);
  // Am Master: vor dem Griff steigt der Klick je Beat um 15/32 dB, danach steht er
  const double e70 = k.energie_db(1'575'000), e71 = k.energie_db(1'597'500);
  PRUEF_NAH(e71 - e70, 15.0 / 32.0, 0.01);
  // (Schlag 1 des Takts klickt lauter, Z1: je Klasse getrennt)
  double lo[2] = {1e9, 1e9}, hi[2] = {-1e9, -1e9};
  for (int b = 73; b <= 95; ++b) {
    const double e = k.energie_db((int64_t)b * 22'500);
    const int eins = b % 4 == 0 ? 1 : 0;
    lo[eins] = std::fmin(lo[eins], e);
    hi[eins] = std::fmax(hi[eins], e);
  }
  std::printf("Klick-Energie Beat 73 bis 95: Schlag 1 %.4f bis %.4f dB, sonst %.4f bis %.4f dB\n", lo[1], hi[1], lo[0],
              hi[0]);
  PRUEF(hi[1] - lo[1] < 0.01 && hi[0] - lo[0] < 0.01);
  PRUEF_ENDE();
}
