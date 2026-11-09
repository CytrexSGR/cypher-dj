// D1 K1 Slice 7: Metronom des Moduls Arrangement (Spec D1 2.6, A5). Klicks auf ganzen Projekt-Beats, Betonung bei
// p mod 4 == 0 (voller Pegel aus pegel_db, sonst halber), Ziel master oder cue, gesperrt im Prüfmodus und Render,
// über die Naht wieder ab von. Erster Klick-Wert = Pegel (Klickform beginnt mit 1,0).
// Case 9 (1.8 T0): the count-in with Ziel cue. Mutation: ARR_METRONOM_KERN_TAKT (Betonung nach dem Kern-Takt) macht Fall 1 rot.
#include "arr_build.h"
#include "check.h"

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
  {  // 6: 1.8 S4a.2 (AK18 core part, D7): the count-in clicks while the arrangement waits, also with the switch off. N bars: exactly 4N clicks, the i-th on core beat kb + i
     // (sample 793 + i * 22 500 at 128 BPM), the first of each bar accented, none after the entry, the entry itself is silent (switch off), Ziel master.
    for (const int takte : {1, 2}) {
      Treiber t;
      t.laden(Bau().spur(1, ArrArt::audio).fertig());
      const int V4 = 4 * takte;
      t.arr.metronom(false, -6.0f, 0);   // the switch is off, level and target are set
      t.arr.start(0.0, 0, false, 0, V, 256, t.k, V4);
      const int64_t einsatz = t.arr.einsatz_sample();
      PRUEF(einsatz == 793 + V4 * SPB);
      t.lauf(einsatz + 4 * SPB);
      const auto k = klicks(t.ml, einsatz + 4 * SPB);
      PRUEF(static_cast<int>(k.size()) == V4);
      for (int i = 0; i < V4 && i < static_cast<int>(k.size()); ++i) {
        PRUEF(k[i] == std::llround(t.k.sample_at(t.k.beat_at(793.0) + i)));
        PRUEF(k[i] == einsatz - (V4 - i) * SPB);   // the i-th at entry - (4N - i) beats
        PRUEF_NAH(t.ml[k[i]], i % 4 == 0 ? G : 0.5 * G, 1e-6);
      }
      PRUEF(klicks(t.cl, einsatz + 4 * SPB).empty());
    }
  }
  {  // 7: with the switch ON the count-in clicks are followed by the ordinary ones from the entry (p = 0 accented); sperre_metronom(true) silences both
    for (const bool gesperrt : {false, true}) {
      Treiber t;
      t.laden(Bau().spur(1, ArrArt::audio).fertig());
      t.arr.sperre_metronom(gesperrt);
      t.arr.metronom(true, -6.0f, 0);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k, 4);
      const int64_t einsatz = t.arr.einsatz_sample();
      t.lauf(einsatz + 3 * SPB);
      const auto k = klicks(t.ml, einsatz + 3 * SPB);
      if (gesperrt) {
        PRUEF(k.empty());   // the lock (render, probe mode) beats the count-in
      } else {
        PRUEF(k.size() == 7 && k[0] == 793 && k[3] == 793 + 3 * SPB && k[4] == einsatz && k[6] == einsatz + 2 * SPB);
        if (k.size() == 7) {
          PRUEF_NAH(t.ml[k[0]], G, 1e-6);       // count-in: first of the bar
          PRUEF_NAH(t.ml[k[3]], 0.5 * G, 1e-6);
          PRUEF_NAH(t.ml[k[4]], G, 1e-6);       // the entry is project beat 0, accented
          PRUEF_NAH(t.ml[k[5]], 0.5 * G, 1e-6);
        }
      }
    }
  }
  {  // 8: negative control: without a count-in and with the switch off nothing clicks while waiting (the slice 1 behaviour); a stopped wait leaves no count-in behind
    Treiber t;
    t.laden(Bau().spur(1, ArrArt::audio).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(40000);
    PRUEF(klicks(t.ml, 40000).empty());
    Treiber u;
    u.laden(Bau().spur(1, ArrArt::audio).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k, 8);
    u.lauf(30000);                    // clicks at 793 and 23 293 so far
    PRUEF(klicks(u.ml, 30000).size() == 2);
    u.arr.stopp(0, u.s, u.k);         // the wait ends: no more clicks
    PRUEF(!u.arr.zaehlt_ein());
    u.lauf(200000);
    PRUEF(klicks(u.ml, 200000).size() == 2);
  }
  {  // 9: 1.8 T0 (AK18 names master or cue): the count-in with Ziel cue puts the clicks into the cue/PFL sum and none into the master, switch off. 4N clicks, the i-th on core beat kb + i
    for (const int takte : {1, 2}) {
      Treiber t;
      t.laden(Bau().spur(1, ArrArt::audio).fertig());
      const int V4 = 4 * takte;
      t.arr.metronom(false, -6.0f, 1);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k, V4);
      const int64_t einsatz = t.arr.einsatz_sample();
      t.lauf(einsatz + 4 * SPB);
      const auto k = klicks(t.cl, einsatz + 4 * SPB);
      PRUEF(static_cast<int>(k.size()) == V4);
      for (int i = 0; i < V4 && i < static_cast<int>(k.size()); ++i) {
        PRUEF(k[i] == std::llround(t.k.sample_at(t.k.beat_at(793.0) + i)));
        PRUEF_NAH(t.cl[k[i]], i % 4 == 0 ? G : 0.5 * G, 1e-6);   // first of each bar accented
      }
      PRUEF(klicks(t.ml, einsatz + 4 * SPB).empty());   // the master stays silent: the count-in goes to the chosen target only
    }
  }
  PRUEF_ENDE();
}
