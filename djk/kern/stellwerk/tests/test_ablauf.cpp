// Scheibe 11, Task 7: Ablauf je Zyklus: Start am Ziel-Sample, Rampen in Beats, Setzen mit Schaltrampe, Stumm-Regel,
// S-Kurve, Setzen und Rampe am selben Sample, Tempowechsel nach der Annahme, Verspätung Politik 1, Abbruch hält am Ist-Wert.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

FALL(teil_rampe_golden) {
  // SCHNITTSTELLEN §19.3 teil_rampe: -15 dB nach 0 dB ab Beat 64 über 32 Beats bei 128 BPM
  Lauf l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -15.0f);
  l.beobachte("deck/2/fader");
  const int64_t id = l.teil("deck/2/fader", 64, 32, 0, "p1", 0);
  l.bis(2200000);
  PRUEFE_GLEICH(l.bei(id, Status::gestartet), 1440000);
  PRUEFE_GLEICH(l.bei(id, Status::fertig), 2160000);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1440000), -15.0, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1800000), -7.5, 0.01);   // Abnahme: Beat 80 = -7,5 dB ±0,01 dB
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 2159999), -2.08e-5, 1e-4);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 2160000), 0.0, 0);
  PRUEFE(l.max_schritt("deck/2/fader") < 1e-4);                   // glatt, kein Sprung
}

FALL(halter_und_meldungen_bei_start_und_ende) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -15.0f);
  l.teil("deck/2/fader", 64, 32, 0, "p1", 0);
  l.bis(1440256);
  char h[TEXT];
  halter_text(l.sw->halter(l.r("deck/2/fader")), h, TEXT);
  PRUEFE(std::strcmp(h, "plan:p1") == 0);
  int halter_start = 0, regler_start = 0;
  for (const Ereignis& e : l.ereignisse) {
    if (e.art == EreignisArt::halter && e.sample == 1440000 && std::strcmp(e.halter, "plan:p1") == 0) halter_start++;
    if (e.art == EreignisArt::regler && e.sample == 1440000 && e.wert == -15.0f) regler_start++;
  }
  PRUEFE_GLEICH(halter_start, 1);
  PRUEFE_GLEICH(regler_start, 1);
  l.bis(2160256);
  PRUEFE(l.sw->halter(l.r("deck/2/fader")).art == HalterArt::frei);
  int halter_ende = 0;
  for (const Ereignis& e : l.ereignisse)
    if (e.art == EreignisArt::halter && e.sample == 2160000 && std::strcmp(e.halter, "frei") == 0) halter_ende++;
  PRUEFE_GLEICH(halter_ende, 1);
}

FALL(start_mitten_im_block_am_exakten_sample) {
  Lauf l;
  l.beobachte("deck/1/kill/tief");
  const int64_t id = l.teil("deck/1/kill/tief", 80, 0, 1, "p", 1);
  l.bis(1800512);
  PRUEFE(1800000 % BLOCK != 0);                               // der Start liegt wirklich mitten im Block
  PRUEFE_GLEICH(l.bei(id, Status::gestartet), 1800000);
  PRUEFE_GLEICH(l.bei(id, Status::fertig), 1800240);        // Schaltrampe 5 ms
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1799999), 0, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1800120), 0.5, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1800240), 1, 0);
}

FALL(setzen_von_und_nach_stumm_ueber_minus_60) {
  Lauf l;
  l.beobachte("deck/1/fader");
  l.beobachte("deck/2/fader");
  l.sw->setze_direkt(l.r("deck/2/fader"), -10.0f);
  l.teil("deck/1/fader", 8, 0, -15, "a", 0);    // aus stumm: beginnt bei -60 (§1.2)
  l.teil("deck/2/fader", 8, 0, -200, "b", 0);   // nach stumm: bis -60, dann -200
  l.bis(200000);
  const int64_t s = 180000;   // Beat 8
  PRUEFE_NAH(l.wert_bei("deck/1/fader", s), -60, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", s + 240), -37.5, 1e-4);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", s + 480), -15, 0);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", s + 240), -35, 1e-4);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", s + 479), -59.99935, 1e-4);   // S-Kurve bei u = 479/480 (F2)
  PRUEFE_NAH(l.wert_bei("deck/2/fader", s + 480), -200, 0);
  float gemeldet = 0;
  for (const Ereignis& e : l.ereignisse)
    if (e.art == EreignisArt::regler && e.sample == s && e.regler == l.r("deck/1/fader")) gemeldet = e.wert;
  PRUEFE_NAH(gemeldet, -60, 0);   // /e/regler beim Teilstart meldet den Wert am Start-Sample (§5.7), nicht -200 davor
}

FALL(schaltrampe_beim_setzen_als_s_kurve) {
  // §1.5 Schaltrampe, ausgelegt wie Scheibe 04 (F1, F2): S-Kurve 3u² − 2u³ über die Dauer der Spalte (Kill 5 ms,
  // dB-Regler 10 ms). Der Kanalzug übernimmt den Verlauf des Stellwerks unverändert (04 F7); linear knackt der Kill
  // am 04-Reiz mit −65,74 dBFS, als S-Kurve mit −98,01 dBFS (04, Probe kill_formen).
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/eq/hoch"), -10.0f);
  l.beobachte("deck/1/kill/tief");
  l.beobachte("deck/1/eq/hoch");
  l.teil("deck/1/kill/tief", 80, 0, 1, "p", 0);
  l.teil("deck/1/eq/hoch", 80, 0, -30, "p", 1);
  l.bis(1801024);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1800060), 0.15625, 1e-6);   // u = 0,25 (linear wäre 0,25)
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1800120), 0.5, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/kill/tief", 1800240), 1.0, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/eq/hoch", 1800120), -13.125, 1e-4);     // −10 − 20 · 0,15625 (linear −15)
  PRUEFE_NAH(l.wert_bei("deck/1/eq/hoch", 1800480), -30, 0);
}

FALL(stumm_nach_stumm_bleibt_stumm_und_kein_umweg_ueber_minus_60) {
  // §1.2 mit Festlegung (wie Scheibe 04 F3): eine Rampe von oder nach stumm läuft nur dann über −60 dB, wenn das
  // andere Ende darüber liegt; sie ist nie lauter als ihre beiden Enden.
  Lauf l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -80.0f);
  l.beobachte("deck/1/fader");
  l.beobachte("deck/2/fader");
  l.beobachte("deck/3/fader");
  l.teil("deck/1/fader", 8, 4, -200, "a", 0);   // stumm -> stumm
  l.teil("deck/2/fader", 8, 4, -200, "b", 0);   // -80 -> stumm
  l.teil("deck/3/fader", 8, 4, -80, "c", 0);    // stumm -> -80
  l.bis(300000);
  double m1 = -1000, m2 = -1000, m3 = -1000;
  for (int64_t s = 180000; s < 270000; s++) {
    m1 = std::max<double>(m1, l.wert_bei("deck/1/fader", s));
    m2 = std::max<double>(m2, l.wert_bei("deck/2/fader", s));
    m3 = std::max<double>(m3, l.wert_bei("deck/3/fader", s));
  }
  PRUEFE(m1 <= STUMM_GRENZE);                                    // vorher: stieg bis −60
  PRUEFE_NAH(m2, -80, 0);                                        // vorher: −80 −> −60, dann −200
  PRUEFE_NAH(m3, -80, 0);                                        // vorher: begann bei −60
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 270000), -200, 0);
  PRUEFE_NAH(l.wert_bei("deck/3/fader", 180000), -80, 0);
}

FALL(rampe_aus_stumm_und_s_kurve) {
  Lauf l;
  l.beobachte("deck/1/fader");
  l.beobachte("deck/1/filter");
  l.teil("deck/1/fader", 8, 4, 0, "a", 0);                                  // -200 -> 0: ab -60
  l.teil("deck/1/filter", 8, 4, 1, "a", 1, "", Quelle::cypher, 0, 1);       // S-Kurve 3u^2 - 2u^3
  l.bis(300000);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 180000), -60, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 180000 + 45000), -30, 1e-4);        // halbe Rampe
  PRUEFE_NAH(l.wert_bei("deck/1/filter", 180000 + 22500), 0.15625, 1e-5);   // u = 0,25
  PRUEFE_NAH(l.wert_bei("deck/1/filter", 180000 + 45000), 0.5, 1e-5);
}

FALL(setzen_und_rampe_am_selben_sample) {
  // SCHNITTSTELLEN §14.1 Teile 2 und 3: eine Rampe beginnt beim Zielwert eines Setzens am selben Sample
  Lauf l;
  l.beobachte("deck/2/fader");
  const int64_t a = l.teil("deck/2/fader", 64, 0, -15, "p17", 2, "b_rein");
  const int64_t b = l.teil("deck/2/fader", 64, 32, 0, "p17", 3, "b_rein");
  l.bis(2200000);
  PRUEFE_GLEICH(l.bei(a, Status::gestartet), 1440000);
  PRUEFE_GLEICH(l.bei(a, Status::fertig), 1440000);
  PRUEFE_GLEICH(l.bei(b, Status::gestartet), 1440000);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1440000), -15, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 1800000), -7.5, 0.01);
  int halter = 0, frei = 0;
  for (const Ereignis& e : l.ereignisse)
    if (e.art == EreignisArt::halter && e.sample == 1440000) {
      halter++;
      frei += !std::strcmp(e.halter, "frei");
    }
  PRUEFE_GLEICH(halter, 1);   // Übergabe am selben Sample: plan:p17 einmal, kein Umweg über frei
  PRUEFE_GLEICH(frei, 0);
}

FALL(tempo_132_nach_annahme_schaltpunkte_bleiben_auf_dem_takt) {
  Lauf l;
  const int64_t kill = l.teil("deck/1/kill/tief", B(21), 0, 1, "p1", 1);
  const int64_t fader = l.teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  l.bis(1529856);                   // Zyklus vor Takt 18
  l.uhr.konstant_ab(T(18), 132.0);  // Tempo nach der Annahme gezogen
  l.bis(2200000);
  PRUEFE_GLEICH(l.bei(kill, Status::gestartet), 1791818);   // llround(1 530 000 + 12 · 21 818,18)
  PRUEFE_GLEICH(l.bei(fader, Status::fertig), 2140910);     // erstes Sample mit Beat >= 96
}

FALL(verspaetet_politik_1_restrampe_bis_zum_ende_beat) {
  Lauf l;
  l.beobachte("deck/1/eq/hoch");
  l.bis(25600);   // Beat 1,1378
  const int64_t id = l.teil("deck/1/eq/hoch", 0.5, 7.5, -20, "z", 0, "", Quelle::cypher, 1);   // Ende Beat 8
  l.bis(200000);
  PRUEFE_GLEICH(l.bei(id, Status::verspaetet_ausgefuehrt), 25600);
  PRUEFE(l.grund(id, Status::verspaetet_ausgefuehrt) == Grund::kein);   // Lesart i (Andreas 2026-09-25, FORMAT.md 22): Grund ""
  PRUEFE_GLEICH(l.bei(id, Status::fertig), 180000);                // Ende-Beat unverändert
  const double b0 = 25600.0 * 128 / 60 / SR;
  PRUEFE_NAH(l.wert_bei("deck/1/eq/hoch", 25600), 0, 1e-6);
  PRUEFE_NAH(l.wert_bei("deck/1/eq/hoch", 102800), -20.0 * (102800.0 * 128 / 60 / SR - b0) / (8.0 - b0), 1e-4);
}

FALL(verspaetet_nach_dem_ende_schaltrampe) {
  Lauf l;
  l.beobachte("deck/1/eq/hoch");
  l.bis(25600);
  const int64_t id = l.teil("deck/1/eq/hoch", 0.25, 0.5, -20, "z", 0, "", Quelle::cypher, 1);   // Ende Beat 0,75: vorbei
  l.bis(30000);
  PRUEFE_GLEICH(l.bei(id, Status::verspaetet_ausgefuehrt), 25600);
  PRUEFE_GLEICH(l.bei(id, Status::fertig), 25600 + 480);
  PRUEFE_NAH(l.wert_bei("deck/1/eq/hoch", 25840), -10, 1e-4);
}

FALL(abbruch_haelt_laufenden_teil_am_ist_wert) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -15.0f);
  l.beobachte("deck/2/fader");
  const int64_t id = l.teil("deck/2/fader", 64, 32, 0, "p1", 0);
  l.bis(1620224);
  const float vorher = l.sw->wert(l.r("deck/2/fader"));
  l.sw->abbruch(5, Quelle::leitstand, "p1", nullptr, -1);
  l.bis(2200000);
  PRUEFE_GLEICH(l.bei(id, Status::gestartet), 1440000);   // der Teil lief wirklich (sonst prüfte der Fall nichts)
  PRUEFE(vorher > -15.0f && vorher < -10.0f);
  PRUEFE_GLEICH(l.bei(id, Status::abgebrochen), 1620224);
  PRUEFE(l.grund(id, Status::abgebrochen) == Grund::abbruch);
  PRUEFE_NAH(l.wert_bei("deck/2/fader", 2160000), vorher, 0);
  PRUEFE(l.sw->halter(l.r("deck/2/fader")).art == HalterArt::frei);
}

FALL(angrenzende_rampe_beginnt_beim_endwert_der_vorigen) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/eq/tief"), -10.0f);
  l.beobachte("deck/1/eq/tief");
  const int64_t a = l.teil("deck/1/eq/tief", 64, 8, -20, "p", 0);
  const int64_t b = l.teil("deck/1/eq/tief", 72, 4, -30, "p", 1);
  l.bis(1800000);
  PRUEFE_GLEICH(l.bei(a, Status::fertig), 1620000);
  PRUEFE_GLEICH(l.bei(b, Status::gestartet), 1620000);
  PRUEFE_NAH(l.wert_bei("deck/1/eq/tief", 1620000), -20, 0);   // genau der Endwert der ersten Rampe, kein Rest
  PRUEFE_NAH(l.wert_bei("deck/1/eq/tief", 1642500), -22.5, 1e-4);
}

FALL(setzen_fremder_plan_vor_rampe_am_selben_beat) {
  // I4 erlaubt es (test_einsortieren); die Startfolge wendet das schon angenommene Setzen zuerst an (§17 Reihenfolge)
  Lauf l;
  l.beobachte("deck/1/eq/mitte");
  l.teil("deck/1/eq/mitte", 40, 0, -10, "q", 0);
  l.teil("deck/1/eq/mitte", 40, 8, -30, "t", 0);
  l.bis(1100000);
  PRUEFE_NAH(l.wert_bei("deck/1/eq/mitte", 900000), -10, 1e-5);   // Beat 40: Rampe beginnt beim Setzen-Ziel
  PRUEFE_NAH(l.wert_bei("deck/1/eq/mitte", 990000), -20, 1e-4);   // Beat 44: halbe Rampe
  PRUEFE_NAH(l.wert_bei("deck/1/eq/mitte", 1080000), -30, 0);     // Beat 48: Ende
}

FALL(ruhige_zyklen_ohne_verlauf) {
  Lauf l;
  l.bis(256 * 100);
  const Aenderung* a;
  PRUEFE_GLEICH(l.sw->aenderungen(&a), 0);
  PRUEFE_GLEICH(l.sw->zaehler().zyklen_ruhig, 100);
  PRUEFE_GLEICH(l.sw->zaehler().zyklen_voll, 0);
}

FALL(setze_direkt_erscheint_im_naechsten_verlauf) {
  Lauf l;
  l.beobachte("deck/1/fader");
  l.zyklus();
  l.sw->setze_direkt(l.r("deck/1/fader"), -6.0f);
  l.zyklus();
  const Aenderung* a;
  PRUEFE_GLEICH(l.sw->aenderungen(&a), 1);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 255), -200, 0);
  PRUEFE_NAH(l.wert_bei("deck/1/fader", 256), -6, 0);
  l.zyklus();
  PRUEFE_GLEICH(l.sw->aenderungen(&a), 0);   // Negativ-Kontrolle: ohne Änderung kein Verlauf
}

PRUEF_MAIN
