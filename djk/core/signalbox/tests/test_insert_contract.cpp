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
  PRUEFE_GLEICH(n, 12 * 10 + 8 * 59 + 4 * 4 + 12 * 4 + 2 * 3 + 4 * 1 + 8 * 5 + 8 * 65);   // 778 (arr-bk: + bk, 8 instances x 9 rows); 706 before: komp, eq (pool 8 since arr-fx slice 2), saett (4), rack, lim (2), host (plan 1.11 T4: 4 instances, one row `an`), utility (arr-fx slice 1: 8 x 5)
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
  PRUEFE(gesehen.count("ins/eq/8/b8/steil") == 1);   // the last eq of the pool of eight (arr-fx slice 2)
  PRUEFE(gesehen.count("ins/eq/9/b8/steil") == 0);
  PRUEFE(gesehen.count("ins/utility/8/mono_unter") == 1);   // arr-fx slice 1: eight utilities, the longest name has 25 characters
  PRUEFE(gesehen.count("ins/utility/9/an") == 0);
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
  PRUEFE_GLEICH(ins, 120 + 8 * 59 + 4 * 4 + 2 * 3 + 4 + 8 * 5 + 8 * 65);   // arr-bk: + bk (8 x 9);   // slice 4b: komp, eq (8 instances since arr-fx slice 2) and saett (4) have table rows; lim (2 instances, 3 rows); plan 1.11 T4: host (4 instances, 1 row); arr-fx: utility (8 instances, 5 rows)
  PRUEFE_GLEICH(d_min("ins/komp/3/knie"), 0.0f);
  PRUEFE_GLEICH(d_max("ins/komp/3/knie"), 24.0f);
  PRUEFE_GLEICH(d_max("ins/komp/12/schp"), 300.0f);
  PRUEFE_GLEICH(d_max("ins/komp/12/sc"), 32.0f);   // 32 key sources, the DJ side has 14
  PRUEFE(tab().suche("ins/komp/13/an") < 0);
  PRUEFE(tab().suche("ins/komp/0/an") < 0);
  // slice 4b / arr-fx slice 2: eq has eight instances, saett four, lim two; the next one does not exist
  PRUEFE(tab().suche("ins/eq/1/an") >= 0);
  PRUEFE(tab().suche("ins/eq/8/an") >= 0);
  PRUEFE(tab().suche("ins/eq/9/an") < 0);
  PRUEFE(tab().suche("ins/saett/1/an") >= 0);
  PRUEFE(tab().suche("ins/saett/4/an") >= 0);
  PRUEFE(tab().suche("ins/saett/5/an") < 0);
  PRUEFE(tab().suche("ins/lim/1/an") >= 0);
  PRUEFE(tab().suche("ins/lim/2/an") >= 0);
  PRUEFE(tab().suche("ins/lim/3/an") < 0);
  PRUEFE(tab().suche("ins/utility/8/an") >= 0);   // arr-fx slice 1: eight utilities, five rows each
  PRUEFE(tab().suche("ins/utility/9/an") < 0);
  PRUEFE(tab().suche("ins/host/1/an") >= 0);   // plan 1.11 T4: effect hosts, four instances, one row each
  PRUEFE(tab().suche("ins/host/4/an") >= 0);
  PRUEFE(tab().suche("ins/host/5/an") < 0);
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
