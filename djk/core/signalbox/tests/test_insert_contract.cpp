// 1.10 slice 4a T1: the insert vocabulary (docs/interfaces/insert_module.json, generated into src/insert_zeilen.inc) against the
// controller table. Paths fit ReglerDef::pfad, are unique, and the `komp` ranges equal the DJ-side komp/* rows. The parity with
// presets/devices.ts and the generator diff are checked by djk/contract/tests/test_insert_vertrag.py.
#include <cstdio>
#include <cstring>
#include <set>
#include <string>

#include "check.h"
#include "cypherdj/signalbox/controls.h"

using namespace cypherdj::stellwerk;

namespace {
const ReglerTabelle& tab() {
  static ReglerTabelle t;
  return t;
}
float d_min(const char* pfad) {
  const int r = tab().suche(pfad);
  PRUEFE(r >= 0);
  return r >= 0 ? tab().def(r).min : -1e9f;
}
float d_max(const char* pfad) {
  const int r = tab().suche(pfad);
  PRUEFE(r >= 0);
  return r >= 0 ? tab().def(r).max : -1e9f;
}
}  // namespace

FALL(pfade_des_vertrags_sind_hoechstens_31_zeichen_und_eindeutig) {
  const int n = insert_vertrag_anzahl();
  PRUEFE_GLEICH(n, 160 * 12 + 160 * 86 + 32 * 7 + 12 * 4 + 8 * 3 + 8 * 1 + 8 * 5 + 8 * 65 + 16 * 8 + 8 * 34 + 32 * 6 + 16 * 7);   // strand 13 slice 4: mb 34 rows (u1..u3 x 3, sc); strand 13 slice 2: saett 7 rows (knie); strand 13 slice 1: komp 12 rows (glue, auto); strand 5 slice 4: eq 86 rows (sc); strand 5 slice 3: saett pool 32 (32 x 6), trans 32 x 6, bild 16 x 7; strand 5 slice 2: eq 85 rows (d1..d8 x 3, dyn_attack, dyn_release); strand 5 slice 1: saett 6 rows (kurve, decke); strand 1 slice 4: lim pool 8 (8 x 3), gate 16 (16 x 8 rows) and mb 8 (8 x 24 rows); strand 1 slice 3b: komp and eq pools 160 each (one per strip at 128 tracks; 96 in slice 3); 778 (arr-bk: + bk, 8 instances x 9 rows); 706 before: komp, eq (pool 8 since arr-fx slice 2), saett (4), rack, lim (2), host (plan 1.11 T4: 4 instances, one row `an`), utility (arr-fx slice 1: 8 x 5)
  std::set<std::string> gesehen;
  int zu_lang = 0, doppelt = 0, laengster = 0;
  for (int i = 0; i < n; i++) {
    const char* p = insert_vertrag_pfad(i);
    const int len = static_cast<int>(std::strlen(p));
    laengster = len > laengster ? len : laengster;
    if (len > 31) {
      zu_lang++;
      std::printf("zu lang (%d): %s\n", len, p);
    }
    if (!gesehen.insert(p).second) doppelt++;
  }
  PRUEFE_GLEICH(zu_lang, 0);
  PRUEFE_GLEICH(doppelt, 0);
  std::printf("%d Pfade, laengster %d Zeichen\n", n, laengster);
  PRUEFE(gesehen.count("ins/eq/1/b8/steil") == 1);   // the example of spec section 3: 17 characters
  PRUEFE(gesehen.count("ins/eq/2/b8/steil") == 1);   // the second eq of the pool (2026-11-06)
  PRUEFE(gesehen.count("ins/eq/160/b8/steil") == 1);   // the last eq of the pool of 160 (strand 1 slice 3b; 96 in slice 3; sixteen since slice 1, eight since arr-fx slice 2)
  PRUEFE(gesehen.count("ins/eq/161/b8/steil") == 0);
  PRUEFE(gesehen.count("ins/utility/8/mono_unter") == 1);   // arr-fx slice 1: eight utilities, the longest name has 25 characters
  PRUEFE(gesehen.count("ins/utility/9/an") == 0);
  PRUEFE(gesehen.count("ins/lim/8/abklingen") == 1 && gesehen.count("ins/lim/9/an") == 0);   // strand 1 slice 4: eight limiters
  PRUEFE(gesehen.count("ins/gate/16/release") == 1 && gesehen.count("ins/gate/17/an") == 0);   // gate pool 16
  PRUEFE(gesehen.count("ins/mb/8/b3/schwelle") == 1 && gesehen.count("ins/mb/8/u3/bereich") == 1 && gesehen.count("ins/mb/8/sc") == 1 && gesehen.count("ins/mb/9/an") == 0);   // multiband pool 8, the longest path has 20 characters
}

FALL(komp_zeilen_stehen_in_der_tabelle_und_gleichen_den_dj_zeilen) {
  const char* felder[] = {"an", "schwelle", "ratio", "attack", "release", "makeup", "mix"};
  int verglichen = 0;
  for (int n = 1; n <= 12; n++) {
    for (const char* f : felder) {
      char ins[40], dj[40];
      std::snprintf(ins, sizeof ins, "ins/komp/%d/%s", n, f);
      std::snprintf(dj, sizeof dj, "deck/1/komp/%s", f);
      const int a = tab().suche(ins), b = tab().suche(dj);
      PRUEFE(a >= 0);
      PRUEFE(b >= 0);
      if (a < 0 || b < 0) continue;
      const ReglerDef& x = tab().def(a);
      const ReglerDef& y = tab().def(b);
      PRUEFE_GLEICH(x.min, y.min);
      PRUEFE_GLEICH(x.max, y.max);
      PRUEFE_GLEICH(x.vorgabe, y.vorgabe);
      PRUEFE_GLEICH(static_cast<int>(x.kurve.typ), static_cast<int>(y.kurve.typ));
      PRUEFE_GLEICH(x.ganzzahlig, y.ganzzahlig);
      PRUEFE_GLEICH(x.schalt_samples, y.schalt_samples);
      verglichen++;
    }
  }
  PRUEFE_GLEICH(verglichen, 12 * 7);
}

FALL(komp_zeilen_neue_felder_und_form) {
  int ins = 0;
  for (int r = 0; r < tab().anzahl(); r++) {
    const ReglerDef& d = tab().def(r);
    if (std::strncmp(d.pfad, "ins/", 4) != 0) continue;
    ins++;
    PRUEFE_GLEICH(static_cast<int>(d.kanal), -1);   // global rows, like spur/* and grp/*
    PRUEFE(!d.nur_hand);
    PRUEFE_GLEICH(d.keine_rampe, d.ganzzahlig);
  }
  PRUEFE_GLEICH(ins, 1920 + 160 * 86 + 32 * 7 + 8 * 3 + 8 + 8 * 5 + 8 * 65 + 16 * 8 + 8 * 34 + 32 * 6 + 16 * 7);   // strand 13 slice 4: mb 8 x 34;   // strand 13 slice 2: saett 32 x 7;   // strand 13 slice 1: komp 160 x 12;   // strand 5 slice 4: eq 160 x 86;   // strand 5 slice 3: saett 32 x 6, trans 32 x 6, bild 16 x 7;   // strand 5 slice 2: eq 160 x 85;   // strand 5 slice 1: saett 4 x 6;   // strand 1 slice 4: lim 8 x 3, gate 16 x 8, mb 8 x 24;   // strand 1 slice 3b: 160 komp x 10, 160 eq x 59 (96 each in slice 3);   // arr-bk: + bk (8 x 9);   // slice 4b: komp, eq (8 instances since arr-fx slice 2) and saett (4) have table rows; lim (2 instances, 3 rows); plan 1.11 T4: host (4 instances, 1 row); arr-fx: utility (8 instances, 5 rows)
  PRUEFE_GLEICH(d_min("ins/komp/3/knie"), 0.0f);
  PRUEFE_GLEICH(d_max("ins/komp/3/knie"), 24.0f);
  PRUEFE_GLEICH(d_max("ins/komp/12/schp"), 300.0f);
  PRUEFE_GLEICH(d_max("ins/komp/12/sc"), 32.0f);   // 32 key sources, the DJ side has 14
  PRUEFE(tab().suche("ins/komp/160/an") >= 0);   // strand 1 slice 3b: pool 160
  PRUEFE(tab().suche("ins/komp/161/an") < 0);
  PRUEFE(tab().suche("ins/komp/0/an") < 0);
  // slice 4b / arr-fx slice 2: eq has eight instances, saett four, lim two; the next one does not exist
  PRUEFE(tab().suche("ins/eq/1/an") >= 0);
  PRUEFE(tab().suche("ins/eq/160/an") >= 0);   // strand 1 slice 3b: pool 160
  PRUEFE(tab().suche("ins/eq/161/an") < 0);
  PRUEFE(tab().suche("ins/saett/1/an") >= 0);
  PRUEFE(tab().suche("ins/saett/4/an") >= 0);
  PRUEFE(tab().suche("ins/saett/32/an") >= 0);   // strand 5 slice 3: pool 32 (4 before)
  PRUEFE(tab().suche("ins/saett/33/an") < 0);
  PRUEFE(tab().suche("ins/trans/32/mix") >= 0);   // strand 5 slice 3: transient shaper, 32 instances, six rows each
  PRUEFE(tab().suche("ins/trans/33/an") < 0);
  PRUEFE(tab().suche("ins/bild/16/mono_unter") >= 0);   // strand 5 slice 3: imager, 16 instances, seven rows each
  PRUEFE(tab().suche("ins/bild/17/an") < 0);
  PRUEFE_GLEICH(d_min("ins/trans/1/angriff"), -24.0f);
  PRUEFE_GLEICH(d_max("ins/trans/1/out"), 12.0f);
  PRUEFE_GLEICH(d_max("ins/bild/1/breite_tief"), 1.0f);   // the low band can only narrow
  PRUEFE_GLEICH(d_max("ins/bild/1/breite_hoch"), 2.0f);
  PRUEFE_GLEICH(d_min("ins/bild/1/grenze_hoch"), 1000.0f);
  PRUEFE_GLEICH(d_max("ins/bild/1/mono_unter"), 300.0f);
  PRUEFE(tab().suche("ins/lim/1/an") >= 0);
  PRUEFE(tab().suche("ins/lim/2/an") >= 0);
  PRUEFE(tab().suche("ins/lim/8/an") >= 0);   // strand 1 slice 4: eight limiters (two before)
  PRUEFE(tab().suche("ins/lim/9/an") < 0);
  PRUEFE(tab().suche("ins/utility/8/an") >= 0);   // arr-fx slice 1: eight utilities, five rows each
  PRUEFE(tab().suche("ins/utility/9/an") < 0);
  PRUEFE(tab().suche("ins/host/1/an") >= 0);   // plan 1.11 T4: effect hosts, eight instances since strand 1 slice 5, one row each
  PRUEFE(tab().suche("ins/host/4/an") >= 0);
  PRUEFE(tab().suche("ins/host/8/an") >= 0);
  PRUEFE(tab().suche("ins/host/9/an") < 0);
  PRUEFE(tab().suche("ins/host/0/an") < 0);
  PRUEFE(tab().suche("ins/host/1/decke") < 0);
  PRUEFE_GLEICH(d_min("ins/host/2/an"), 0.0f);
  PRUEFE_GLEICH(d_max("ins/host/2/an"), 1.0f);
  PRUEFE_GLEICH(d_min("ins/lim/1/decke"), -60.0f);
  PRUEFE_GLEICH(d_max("ins/lim/1/decke"), 0.0f);
  PRUEFE_GLEICH(d_min("ins/lim/1/abklingen"), 1.0f);
  PRUEFE_GLEICH(d_max("ins/lim/1/abklingen"), 2000.0f);
  PRUEFE(tab().suche("ins/eq/1/b0/an") < 0);
  PRUEFE(tab().suche("ins/eq/1/b9/an") < 0);
  PRUEFE_GLEICH(d_min("ins/eq/1/b3/gain"), -24.0f);
  PRUEFE_GLEICH(d_max("ins/eq/1/b8/q"), 18.0f);
  PRUEFE_GLEICH(d_max("ins/eq/1/b5/typ"), 6.0f);
  // strand 5 slice 2: the dynamic rows of the bands and the detector times
  PRUEFE(tab().suche("ins/eq/1/d0/dyn") < 0);
  PRUEFE(tab().suche("ins/eq/1/d9/dyn") < 0);
  PRUEFE_GLEICH(d_max("ins/eq/1/d1/dyn"), 4.0f);
  PRUEFE_GLEICH(d_min("ins/eq/160/d8/schwelle"), -60.0f);
  PRUEFE_GLEICH(d_min("ins/eq/2/d4/bereich"), -24.0f);
  PRUEFE_GLEICH(d_max("ins/eq/2/d4/bereich"), 24.0f);
  PRUEFE_GLEICH(d_max("ins/eq/1/dyn_attack"), 100.0f);
  PRUEFE_GLEICH(d_min("ins/eq/160/dyn_release"), 5.0f);
  PRUEFE_GLEICH(d_max("ins/saett/1/drive"), 36.0f);
  PRUEFE_GLEICH(d_min("ins/saett/1/out"), -24.0f);
  // slice 4c (T15): the rack macros rack/<k>/m<n> (k = 1..12, n = 1..4) have rows 0..1; nothing outside that grid
  PRUEFE(tab().suche("rack/1/m1") >= 0);
  PRUEFE(tab().suche("rack/12/m4") >= 0);
  PRUEFE_GLEICH(d_min("rack/5/m3"), 0.0f);
  PRUEFE_GLEICH(d_max("rack/5/m3"), 1.0f);
  PRUEFE(tab().suche("rack/0/m1") < 0);
  PRUEFE(tab().suche("rack/13/m1") < 0);
  PRUEFE(tab().suche("rack/1/m0") < 0);
  PRUEFE(tab().suche("rack/1/m5") < 0);
}

PRUEF_MAIN
