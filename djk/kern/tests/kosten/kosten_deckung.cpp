// Paket 1.13 Warp, Slice 2 (Nachbesserung 5): Kosten der Deckung später Einsätze im Callback. 32 Spuren, je ein COMPLEX-Clip ab Beat 0; der Transport startet auf
// Beat 0 (kein Vorausblick), jeder Einsatz ist spät und klingt bis zum ersten Ring-Block als RE-PITCH aus dem Clip. Gemessen über 40 Starts: die Blöcke der ersten Frist
// (8 Blöcke zu 256) gegen die Blöcke 20 bis 59. Aufruf: kern_kosten_deckung [Fäden, Vorgabe 4 [takt]]. Mit „takt“ laufen die Blöcke im Echtzeittakt (5 333 µs), wie im
// Betrieb; ohne laufen sie ungebremst, das Werk kommt nie nach und die Deckung spielt jeden Block (der schlimmste Fall). Kein Test; die Zahlen gehören in den Bericht.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <vector>
#include "arr_bau.h"   // tests/arr_bau.h (der Aufbau legt tests/ in den Include-Pfad)
#include "cypherdj/warp_werk.h"
bool g_waechter = false;
int main(int argc, char** argv) {
  const int faeden = argc > 1 ? std::atoi(argv[1]) : 4;
  const bool takt = argc > 2 && std::string(argv[2]) == "takt";   // Blöcke im Echtzeittakt (256 Samples bei 48 kHz)
  constexpr int64_t FPB125 = 23040;
  std::vector<double> frist, rest; uint64_t spaet = 0, kp = 0, ul = 0;
  auto naechster = std::chrono::steady_clock::now();
  for (int rep = 0; rep < 40; ++rep) {
    arrtest::Treiber t;
    if (!t.mit_werk(faeden)) { std::fprintf(stderr, "kosten_deckung: kein Warp-Werk (ohne Bungee gebaut)\n"); return 2; }
    auto src = arrtest::Audio::sinus(64 * FPB125, 800.0, 0.1f);
    arrtest::Bau b;
    for (int sp = 1; sp <= 32; ++sp) {
      b.spur(sp, cdj::ArrArt::audio);
      b.clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 32.0, &src->a).warp({0.0, 32.0}, {0.0, 32.0 * FPB125 * 1.03}, cdj::ARR_WARP_COMPLEX);
    }
    cdj::ArrSnapshot* sn = b.fertig();
    if (!sn) { std::fprintf(stderr, "kosten_deckung: der Schnappschuss kam nicht zustande\n"); return 2; }
    t.laden(sn);
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    naechster = std::chrono::steady_clock::now();
    for (int i = 0; i < 60; ++i) {
      if (takt) { naechster += std::chrono::microseconds(5333); std::this_thread::sleep_until(naechster); }
      const auto a = std::chrono::steady_clock::now();
      t.lauf(t.s + 256);
      const auto e = std::chrono::steady_clock::now();
      const double us = std::chrono::duration<double, std::micro>(e - a).count();
      if (i < 8) frist.push_back(us); else if (i >= 20) rest.push_back(us);
      t.l.clear(); t.r.clear(); t.ml.clear(); t.mr.clear(); t.cl.clear(); t.cr.clear(); t.pml.clear(); t.pmr.clear();
    }
    spaet += t.arr.warp_spaet(); kp += t.arr.warp_kein_platz(); ul += t.arr.warp_unterlauf();
    t.werk->stoppe();
  }
  std::sort(frist.begin(), frist.end()); std::sort(rest.begin(), rest.end());
  auto q = [](std::vector<double>& v, double p) { return v[std::min(v.size() - 1, (size_t)(v.size() * p))]; };
  std::printf("%s Faeden %d, 32 Spuren, 40 Starts: erste Frist %zu Bloecke Median %.1f us p99 %.1f us max %.1f us | danach %zu Bloecke Median %.1f us p99 %.1f us max %.1f us | spaet %llu kein_platz %llu unterlauf %llu\n",
              takt ? "Takt" : "frei", faeden, frist.size(), q(frist, .5), q(frist, .99), frist.back(), rest.size(), q(rest, .5), q(rest, .99), rest.back(), (unsigned long long)spaet, (unsigned long long)kp, (unsigned long long)ul);
  return 0;
}
