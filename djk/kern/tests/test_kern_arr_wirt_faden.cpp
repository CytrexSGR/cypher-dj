// D1 K2b (Spec A10, 6.28): Messpunkt A4 über zwei Fäden. Der Prüffaden spielt den Callback (Kern::zyklus mit Rückweg
// arr_rueck_1), ein zweiter Faden liest Kern::arr_wirt_messung wie der Hauptfaden in main.cpp, gleichzeitig. Wirt-Spur auf
// Slot 1 mit vier Noten in einer Loop-Klammer von 4 Beats; zu jedem Note-Ein, das der Kern hinausgibt, legt der
// Prüffaden 7 Samples nach dem Ziel einen Impuls in den Rückweg. Nach dem Stopp laufen 300 ms weiter, damit jede offene
// Messung gemeldet ist.
//   1 Jede Messung kommt über den Faden an, vollständig und in Reihenfolge: so viele wie gesendete Note-Ein, je mit
//     dem Ziel des Note-Ein und dem Einsatz Ziel + 7.
//   2 Unter ThreadSanitizer (eigener Bau mit -DCYPHERDJ_TSAN=ON) meldet TSan keinen Befund. Gegenprobe dort: mit
//     -DCYPHERDJ_MUTATION_RING_RELAXED=ON (Ring ohne Release/Acquire) meldet TSan das Datenrennen im Ring des Messpunkts.
#include <atomic>
#include <cstdio>
#include <thread>
#include <vector>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

int main() {
  constexpr int64_t V = 2 * N + 25;   // Vorhalt der Wirt-Senke (537)
  k35::Arbeitsbestand ab("test_kern_arr_wirt_faden");
  arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_faden");
  x.laden(1, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":["
             "{\"id\":\"c/n0\",\"beat\":0.5,\"laenge\":0.25,\"ton\":60,\"vel\":90},"
             "{\"id\":\"c/n1\",\"beat\":1.5,\"laenge\":0.25,\"ton\":62,\"vel\":90},"
             "{\"id\":\"c/n2\",\"beat\":2.5,\"laenge\":0.25,\"ton\":64,\"vel\":90},"
             "{\"id\":\"c/n3\",\"beat\":3.5,\"laenge\":0.25,\"ton\":65,\"vel\":90}]}");
  x.loop(true, 0.0, 4.0);
  x.start(0.0, 0);

  std::atomic<bool> fertig{false};
  std::vector<cdj::ArrWirtMessung> gelesen;
  std::thread leser([&] {   // der Hauptfaden von main.cpp: liest, bis der Callback fertig ist und der Ring leer
    cdj::ArrWirtMessung m{};
    for (;;) {
      const bool f = fertig.load(std::memory_order_acquire);
      while (x.kern->arr_wirt_messung(1, m)) gelesen.push_back(m);
      if (f) break;
      std::this_thread::yield();
    }
  });

  std::vector<float> rl(N, 0.0f), rr(N, 0.0f);
  std::vector<int64_t> ziele, impulse;
  const int64_t stopp_bei = 3 * 4 * SPB, ende = stopp_bei + 14400;   // drei Durchläufe, dann 300 ms Nachlauf
  bool gestoppt = false;
  while (x.kern->sample() < ende) {
    const int64_t n0 = x.kern->sample();
    if (!gestoppt && n0 >= stopp_bei) {
      x.stopp(0);
      gestoppt = true;
    }
    std::fill(rl.begin(), rl.end(), 0.0f);
    std::fill(rr.begin(), rr.end(), 0.0f);
    for (int64_t s : impulse)
      if (s >= n0 && s < n0 + N) rl[s - n0] = rr[s - n0] = 0.5f;
    x.kern->arr_rueck(1, rl.data(), rr.data());
    x.lauf(n0 + N);
    const cdj::MidiAus& m = x.kern->arr_midi_aus(1);
    for (int i = 0; i < m.n; ++i)
      if (m.ev[i].b[0] == 0x90) {
        ziele.push_back(n0 + m.ev[i].t + V);
        impulse.push_back(n0 + m.ev[i].t + V + 7);
      }
  }
  fertig.store(true, std::memory_order_release);
  leser.join();

  std::printf("faden: %zu Note-Ein gesendet, %zu Messungen über den Lesefaden\n", ziele.size(), gelesen.size());
  PRUEF(ziele.size() >= 12);
  PRUEF(gelesen.size() == ziele.size());
  bool gleich = gelesen.size() == ziele.size();
  for (size_t i = 0; gleich && i < ziele.size(); ++i)
    gleich = gelesen[i].slot == 1 && gelesen[i].ziel == ziele[i] && gelesen[i].einsatz == ziele[i] + 7 &&
             gelesen[i].vorhalt == V;
  PRUEF(gleich);
  PRUEF_ENDE();
}
