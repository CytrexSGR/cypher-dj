// Paket 1.13 Warp, Slice 2 (Nachbesserung 2): Kosten des Vorausblicks im Callback bei vielen Clips des Werks. Alle Clips liegen in der Zukunft (der erste setzt in 2 000 Beats
// ein), keine Stimme startet: gemessen wird, was der Vorausblick je Block kostet, wenn er nur sucht. Aufruf: kern_kosten_vorausblick [modus (0 RE-PITCH, 2 COMPLEX; Vorgabe 2) [Clips je Spur,
// Vorgabe 128 (4 096 Clips, die Grenze der Wiedergabe) [naht]]]. Kein Test; die Zahlen gehören in den Bericht. Endet mit 2, wenn eine Stimme startet (dann misst das Programm etwas anderes).
// Nachbesserung 3 (Prüfung 3, m1), Lage „naht“: die Clips liegen in der Vergangenheit (Beat 0 bis je_spur), der Transport läuft ab Beat 2000 in der Klammer 2000 bis 2004;
// getrennt ausgewiesen die Blöcke im Fenster ARR_WARP_FRIST vor jeder Naht (dort sucht der Vorausblick auch für den Durchlauf danach) und die übrigen.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "arr_bau.h"   // tests/arr_bau.h (der Aufbau legt tests/ in den Include-Pfad)
#include "cypherdj/warp_werk.h"

bool g_waechter = false;

int main(int argc, char** argv) {
  const int modus = argc > 1 ? std::atoi(argv[1]) : cdj::ARR_WARP_COMPLEX;
  const int je_spur = argc > 2 ? std::atoi(argv[2]) : 128;
  const bool naht = argc > 3 && std::string(argv[3]) == "naht";
  constexpr int64_t FPB125 = 23040;
  arrtest::Treiber t;
  if (!t.mit_werk(4)) {
    std::fprintf(stderr, "kosten_vorausblick: kein Warp-Werk (ohne Bungee gebaut)\n");
    return 2;
  }
  auto src = arrtest::Audio::sinus(2 * FPB125, 800.0, 0.1f);
  arrtest::Bau b;
  for (int sp = 1; sp <= 32; ++sp) {
    b.spur(sp, cdj::ArrArt::audio);
    for (int j = 0; j < je_spur; ++j)
      b.clip(sp, ("c" + std::to_string(sp) + "_" + std::to_string(j)).c_str(), (naht ? 0.0 : 2000.0) + j, 1.0, &src->a).warp({0.0, 1.0}, {0.0, static_cast<double>(FPB125)}, modus);
  }
  cdj::ArrSnapshot* sn = b.fertig();
  if (!sn) {
    std::fprintf(stderr, "kosten_vorausblick: der Schnappschuss kam nicht zustande\n");
    return 2;
  }
  t.laden(sn);
  t.arr.start(naht ? 2000.0 : 0.0, 0, false, 0, 537, 256, t.k);
  if (naht) t.arr.loop(true, 2000.0, 2004.0, 0, t.k);
  std::vector<double> us, fenster;
  const int64_t durchlauf = static_cast<int64_t>(std::llround(t.k.sample_at(4.0)));   // 4 Beats (90 000 Samples bei 128 BPM)
  for (int i = 0; i < (naht ? 6000 : 3000); ++i) {
    const int64_t ph = t.s - t.arr.einsatz_sample();
    const int64_t pm = ((ph % durchlauf) + durchlauf) % durchlauf;
    const bool im_fenster = naht && ph > 0 && pm + 256 + cdj::ARR_WARP_FRIST > durchlauf;
    const auto a = std::chrono::steady_clock::now();
    t.lauf(t.s + 256);
    const auto e = std::chrono::steady_clock::now();
    if (i >= 100) (im_fenster ? fenster : us).push_back(std::chrono::duration<double, std::micro>(e - a).count());
    t.l.clear(); t.r.clear(); t.ml.clear(); t.mr.clear(); t.cl.clear(); t.cr.clear(); t.pml.clear(); t.pmr.clear();
  }
  std::sort(us.begin(), us.end());
  std::sort(fenster.begin(), fenster.end());
  if (naht && !fenster.empty())
    std::printf("Modus %d, %d Clips, Naht: Fenster vor der Naht %zu Blöcke, Median %.1f µs, p99 %.1f µs; übrige Blöcke Median %.1f µs, p99 %.1f µs; Stimmen im Werk %d\n", modus,
                32 * je_spur, fenster.size(), fenster[fenster.size() / 2], fenster[fenster.size() * 99 / 100], us[us.size() / 2], us[us.size() * 99 / 100], t.arr.werk_stimmen());
  else
    std::printf("Modus %d, %d Clips: Block Median %.1f µs, p99 %.1f µs, Maximum %.1f µs, Stimmen im Werk %d\n", modus, 32 * je_spur, us[us.size() / 2], us[us.size() * 99 / 100], us.back(),
                t.arr.werk_stimmen());
  const int stimmen = t.arr.werk_stimmen();
  t.werk->stoppe();
  return stimmen == 0 ? 0 : 2;
}
