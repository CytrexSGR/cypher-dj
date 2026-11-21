// Loop deck channel strip KZ1: the rows spur/<n>/eq/{tief,mitte,hoch} feed the Arrangement fields ARR_F_EQ0 + 0..2 of track n and nothing else.
// The audio is KZ2; this test pins the plumbing: setting one row of track n moves exactly one (strip, field) pair, the three bands land on
// 10, 11, 12, and the field index does not collide with the filter, the sends or the group cue field.
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

using namespace arrtest;

int main() {
  static_assert(cdj::ARR_F_EQ0 == 10, "the three EQ fields are 10, 11, 12");
  static_assert(cdj::ARR_F_EQ0 > cdj::ARR_F_FILTER && cdj::ARR_F_EQ0 + 2 < cdj::ARR_FELDER, "the EQ fields exist and do not collide with the filter");
  static_assert(cdj::ARR_FELDER == 21, "ARR_FELDER grew from 11 to 13 (KZ1), to 17 (K6, the sends to returns 5..8) and to 21 (K7, trim and kill)");
  const char* baender[3] = {"tief", "mitte", "hoch"};
  for (const int n : {1, 2, 17, 32}) {
    for (int b = 0; b < 3; ++b) {
      auto tp = std::make_unique<Treiber>();
      Treiber& t = *tp;
      const std::string pfad = "spur/" + std::to_string(n) + "/eq/" + baender[b];
      const int r = t.tab.suche(pfad.c_str());
      PRUEF(r >= 0);
      if (r < 0) continue;
      std::vector<float> vor;   // the whole grid before the write
      for (int s = 0; s < cdj::ARR_STREIFEN; ++s)
        for (int f = 0; f < cdj::ARR_FELDER; ++f) vor.push_back(t.arr.wert(s, f));
      PRUEF(t.arr.wert(n - 1, cdj::ARR_F_EQ0 + b) == 0.0f);   // default 0 dB
      t.arr.setze_sofort(r, -7.5f);
      int moved = 0;
      for (int s = 0; s < cdj::ARR_STREIFEN; ++s)
        for (int f = 0; f < cdj::ARR_FELDER; ++f) {
          const float w = t.arr.wert(s, f);
          if (w != vor[s * cdj::ARR_FELDER + f]) {
            ++moved;
            PRUEF(s == n - 1 && f == cdj::ARR_F_EQ0 + b);
            PRUEF(w == -7.5f);
          }
        }
      PRUEF(moved == 1);
      t.arr.setze_sofort(r, 6.0f);
      PRUEF(t.arr.wert(n - 1, cdj::ARR_F_EQ0 + b) == 6.0f);
      const int nb = n < 32 ? n + 1 : n - 1;   // the neighbour track keeps its own fields
      for (int f = 0; f < 3; ++f) PRUEF(t.arr.wert(nb - 1, cdj::ARR_F_EQ0 + f) == 0.0f);
    }
  }
  PRUEF_ENDE();
}
