// Loop deck K7a: the row spur/<n>/filter feeds the Arrangement field ARR_F_FILTER of track n and nothing else. The audio is K7b; this test only
// pins the plumbing: setting the row of track n moves wert(n - 1, ARR_F_FILTER), every other (strip, field) pair keeps its value, and the
// field index does not collide with the sends or the group cue field.
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

using namespace arrtest;

int main() {
  static_assert(cdj::ARR_F_FILTER == 9 && cdj::ARR_F_FILTER != cdj::ARR_F_CUE, "ARR_F_FILTER is field 9, 8 is the group cue");
  static_assert(cdj::ARR_F_FILTER < cdj::ARR_FELDER, "the field exists");
  for (const int n : {1, 2, 17, 32}) {
    auto tp = std::make_unique<Treiber>();
    Treiber& t = *tp;
    const std::string pfad = "spur/" + std::to_string(n) + "/filter";
    const int r = t.tab.suche(pfad.c_str());
    PRUEF(r >= 0);
    if (r < 0) continue;
    // snapshot of the whole grid before the write
    std::vector<float> vor;
    for (int s = 0; s < cdj::ARR_STREIFEN; ++s)
      for (int f = 0; f < cdj::ARR_FELDER; ++f) vor.push_back(t.arr.wert(s, f));
    PRUEF(t.arr.wert(n - 1, cdj::ARR_F_FILTER) == 0.0f);   // default: centre
    t.arr.setze_sofort(r, -0.5f);
    int moved = 0;
    for (int s = 0; s < cdj::ARR_STREIFEN; ++s)
      for (int f = 0; f < cdj::ARR_FELDER; ++f) {
        const float w = t.arr.wert(s, f);
        if (w != vor[s * cdj::ARR_FELDER + f]) {
          ++moved;
          PRUEF(s == n - 1 && f == cdj::ARR_F_FILTER);
          PRUEF(w == -0.5f);
        }
      }
    PRUEF(moved == 1);
    t.arr.setze_sofort(r, 1.0f);
    PRUEF(t.arr.wert(n - 1, cdj::ARR_F_FILTER) == 1.0f);
    // the neighbour track keeps its own field
    const int nb = n < 32 ? n + 1 : n - 1;
    PRUEF(t.arr.wert(nb - 1, cdj::ARR_F_FILTER) == 0.0f);
  }
  PRUEF_ENDE();
}
