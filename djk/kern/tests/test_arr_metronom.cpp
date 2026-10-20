// D1 K1 Slice 7: Metronom des Moduls Arrangement (Spec D1 2.6, A5). Klicks auf ganzen Projekt-Beats, Betonung bei
// p mod 4 == 0 (voller Pegel aus pegel_db, sonst halber), Ziel master oder cue, gesperrt im Prüfmodus und Render,
// über die Naht wieder ab von. Erster Klick-Wert = Pegel (Klickform beginnt mit 1,0).
// Mutation: ARR_METRONOM_KERN_TAKT (Betonung nach dem Kern-Takt) macht Fall 1 rot.
#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double G = 0.50118723;   // −6 dB

static std::vector<int64_t> klicks(const std::vector<float>& x, int64_t bis) {
  std::vector<int64_t> k;
  for (int64_t i = 0; i < bis && i < static_cast<int64_t>(x.size()); ++i)
    if (std::fabs(x[i]) > 0.05f && (k.empty() || i - k.back() > 1000)) k.push_back(i);
  return k;
}

int main() {
  {  // 1: start_beat 2, sofort (Einsatz 793): p = 2, 3, 4, 5 auf 793, 23 293, 45 793, 68 293; betont nur p = 4
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.metronom(true, -6.0f, 0);
    t.arr.start(2.0, 0, false, 0, V, 256, t.k);
    t.lauf(70000);
    const auto k = klicks(t.ml, 70000);
    PRUEF(k.size() == 4 && k[0] == 793 && k[1] == 23293 && k[2] == 45793 && k[3] == 68293);
    PRUEF_NAH(t.ml[793], 0.5 * G, 1e-6);
    PRUEF_NAH(t.ml[45793], G, 1e-6);
    PRUEF_NAH(t.ml[68293], 0.5 * G, 1e-6);
    PRUEF(klicks(t.cl, 70000).empty());
    PRUEF(t.arr.zustand(t.k, 1000).metronom_an);
  }
  {  // 2: Ziel cue: Klicks im PFL-Eingang, Master still
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.metronom(true, -6.0f, 1);
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(30000);
    PRUEF(klicks(t.cl, 30000).size() == 2 && klicks(t.ml, 30000).empty());
    PRUEF_NAH(t.cl[793], G, 1e-6);
  }
  {  // 3: gesperrt (Prüfmodus): kein Klick, Zustand meldet aus
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.sperre_metronom(true);
    t.arr.metronom(true, -6.0f, 0);
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(30000);
    PRUEF(klicks(t.ml, 30000).empty() && klicks(t.cl, 30000).empty());
    PRUEF(!t.arr.zustand(t.k, 1000).metronom_an);
  }
  {  // 4: Loop 0..2 ab Takt (90 000): p = 0 betont, 1 halb, an der Naht 135 000 wieder p = 0 betont
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.metronom(true, -6.0f, 0);
    t.arr.loop(true, 0.0, 2.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(160000);
    const auto k = klicks(t.ml, 160000);
    PRUEF(k.size() == 4 && k[0] == 90000 && k[1] == 112500 && k[2] == 135000 && k[3] == 157500);
    PRUEF_NAH(t.ml[135000], G, 1e-6);
    PRUEF_NAH(t.ml[157500], 0.5 * G, 1e-6);
  }
  {  // 5: Negativ-Kontrolle: Metronom aus, Transport läuft
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(30000);
    PRUEF(klicks(t.ml, 30000).empty() && klicks(t.cl, 30000).empty());
  }
  PRUEF_ENDE();
}
