// Strand 6 task 1.5 (plan 2026-11-27, D13): the core reports the output of every modulator as Ereignis::MOD_ZUSTAND, the net sends it as /zustand/mod ,if (nr, wert).
//   1. no modulator in the playback: no MOD_ZUSTAND event at all (negative control).
//   2. two LFOs (nr 1 sine takt 4, nr 2 triangle takt 2 phase 0.25) on a track fader, transport stopped: in one second (48 000 samples) exactly 25 events per nr (25 Hz,
//      every 1920 samples), nothing for any other nr, and each value is the shape at the tempo-map beat of the last sample of the previous block (D4, D5).
//   3. the same while the transport plays: still 25 per nr per second, values in -1..1 (the phase source while playing is task 1.3's test).
//   4. on the wire: MOD_ZUSTAND becomes /zustand/mod ,if with nr first and wert second (the field order the page server reads as [nr, wert]).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "arr_run.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

bool g_waechter = false;

namespace v = cypherdj::osc;
using E = cdj::Ereignis;

namespace {

constexpr double PI2 = 6.283185307179586;

double frac(double x) { return x - std::floor(x); }

std::string wiedergabe(arr35::Lauf& x, int64_t nr, const std::string& mod) {
  const std::string a = x.ordner.audio('a', 48000);
  const std::string spuren = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 48000) + "]}";
  return "{\"format\":\"cypherdj-arr/3\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + spuren + "],\"gruppen\":[],\"returns\":[]" +
         (mod.empty() ? "" : ",\"mod\":" + mod) + "}";
}

void laden(arr35::Lauf& x, int64_t nr, const std::string& mod) {
  x.ordner.roh(nr, wiedergabe(x, nr, mod));
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, nr, x.cache);
  if (!e.snap) std::printf("refused: %s\n", e.meldung.c_str());
  PRUEF(e.snap != nullptr);
  if (!e.snap) return;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = nr;
  x.sende(b);
}

const char* ZWEI =
    "[{\"nr\":1,\"art\":\"lfo\",\"form\":0,\"takt\":4.0,\"phase\":0.0,\"glatt_ms\":1.0,\"saat\":2166136261,\"ziele\":[{\"spur\":1,\"ziel\":\"fader\",\"tiefe\":-6.0}]},"
    "{\"nr\":2,\"art\":\"lfo\",\"form\":1,\"takt\":2.0,\"phase\":0.25,\"glatt_ms\":1.0,\"saat\":7,\"ziele\":[{\"spur\":1,\"ziel\":\"pan\",\"tiefe\":0.5}]}]";

// MOD_ZUSTAND events with sample in [von, bis), per nr
std::map<int, std::vector<E>> mods(const arr35::Lauf& x, int64_t von, int64_t bis) {
  std::map<int, std::vector<E>> m;
  for (const E& e : x.ev)
    if (e.art == E::MOD_ZUSTAND && e.sample >= von && e.sample < bis) m[e.deck].push_back(e);
  return m;
}

void kern_teil(const std::string& ab) {
  {  // 1.
    arr35::Lauf x(ab, "test_netz_mod_zustand");
    laden(x, 1, "");
    x.lauf(48000 + 8 * k35::N);
    int n = 0;
    for (const E& e : x.ev) n += e.art == E::MOD_ZUSTAND;
    std::printf("1: no modulator: %d MOD_ZUSTAND events\n", n);
    PRUEF(n == 0);
  }
  arr35::Lauf x(ab, "test_netz_mod_zustand");
  laden(x, 2, ZWEI);
  x.lauf(8 * k35::N);   // the load takes effect and the arrangement has run its first blocks
  {  // 2.
    const int64_t von = x.kern->sample();
    x.lauf(von + 48000);
    const auto m = mods(x, von, von + 48000);
    const size_t n1 = m.count(1) ? m.at(1).size() : 0, n2 = m.count(2) ? m.at(2).size() : 0;
    std::printf("2: stopped, one second: nr 1 %zu events, nr 2 %zu events, %zu nrs\n", n1, n2, m.size());
    PRUEF(n1 >= 24 && n1 <= 26);
    PRUEF(n2 >= 24 && n2 <= 26);
    PRUEF(m.size() == 2);
    double fmax = 0.0;
    float lo = 2.0f, hi = -2.0f;
    for (int nr : {1, 2}) {
      if (!m.count(nr)) continue;
      for (const E& e : m.at(nr)) {
        const double beat = x.kern->karte().beat_at(static_cast<double>(e.sample - 1));
        const double soll = nr == 1 ? std::sin(PI2 * frac(beat / 4.0)) : 1.0 - 4.0 * std::fabs(frac(beat / 2.0 + 0.25) - 0.5);
        fmax = std::max(fmax, std::fabs(e.wert - soll));
        if (nr == 1) { lo = std::min(lo, e.wert); hi = std::max(hi, e.wert); }
      }
    }
    std::printf("2: largest deviation from the shape %.2e, sine range %.3f..%.3f\n", fmax, lo, hi);
    PRUEF(fmax < 1e-4);
    PRUEF(hi - lo > 0.8f);   // one second at 128 BPM is 2.13 beats, more than half a period of takt 4: the sine sweeps at least 1.0 wherever it starts (positive control against a stuck value)
    // cadence: consecutive events of one nr are 1920 samples apart, give or take one block
    for (int nr : {1, 2}) {
      if (!m.count(nr)) continue;
      const auto& v = m.at(nr);
      for (size_t i = 1; i < v.size(); ++i) PRUEF(std::llabs(v[i].sample - v[i - 1].sample - 1920) <= k35::N);
    }
  }
  {  // 3.
    x.start(1.0, 0);
    x.lauf(x.kern->sample() + 8 * k35::N);
    const int64_t von = x.kern->sample();
    x.lauf(von + 48000);
    const auto m = mods(x, von, von + 48000);
    const size_t n1 = m.count(1) ? m.at(1).size() : 0, n2 = m.count(2) ? m.at(2).size() : 0;
    std::printf("3: playing, one second: nr 1 %zu events, nr 2 %zu events\n", n1, n2);
    PRUEF(n1 >= 24 && n1 <= 26);
    PRUEF(n2 >= 24 && n2 <= 26);
    for (const auto& [nr, v] : m)
      for (const E& e : v) PRUEF(e.wert >= -1.0f && e.wert <= 1.0f);
  }
}

void netz_teil() {  // 4.
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  Gegenstelle g;
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    PRUEF(g.warte("/k/willkommen", 200));
  }
  PRUEF(v::zustand_mod.typen == ",if");
  cdj::Ereignis z{};
  z.art = cdj::Ereignis::MOD_ZUSTAND;
  z.deck = 7;
  z.wert = -0.375f;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/mod", 200));
  PRUEF(g.m.anzahl == 2);
  PRUEF(g.i(0) == 7);           // nr
  PRUEF(g.f(1) == -0.375f);     // wert
  std::printf("4: /zustand/mod nr %d wert %g\n", g.i(0), static_cast<double>(g.f(1)));
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_netz_mod_zustand");
  kern_teil(ab.pfad);
  netz_teil();
  PRUEF_ENDE();
}
