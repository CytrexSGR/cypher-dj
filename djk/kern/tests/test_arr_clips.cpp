// D1 K1 Slice 5: Audio-Clip-Stimmen des Moduls Arrangement (Spec D1 2.2, A2, A5). Einsatz sample-genau (±0), Offset,
// Gain, Ein-/Ausblende des Clips, Einstieg mitten im Clip mit 32-Sample-Einblende, Kurzblende an der Naht (endet auf
// dem Naht-Sample), Kurzblende beim Stopp (beginnt auf dem Stopp-Sample), Tausch (unverändert ohne Blende, geändert
// mit Ausklang), Pool-Grenze. Pan in der Mitte: Faktor cos(π/4) = 0,70710677 (Gesetz −3 dB).
// Mutationen: ARR_CLIP_BLOCKANFANG (Fall 1), ARR_EINSTIEG_OHNE_RAMPE (Fall 4), ARR_NAHT_HART (Fall 6),
// ARR_TAUSCH_OHNE_BINDUNG (Fall 8) machen den Test rot.
#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

int main() {
  {  // 1: zwei Impuls-Clips auf Beat 0 und 1, Start sofort bei 0: Einsätze 793 und 23 293, sonst Stille
    Treiber t;
    auto a = Audio::impuls(1000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 0.5, &a->a).clip(1, "c2", 1.0, 0.5, &a->a).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(50000);
    const auto h = t.treffer(0, 50000);
    PRUEF(h.size() == 2 && h[0] == 793 && h[1] == 793 + SPB);
    PRUEF_NAH(t.l[793], MITTE, 1e-6);
    PRUEF_NAH(t.r[793 + SPB], MITTE, 1e-6);
  }
  {  // 2: offset_frames 1000 einer Rampe: am Einsatz Quellframe 1000, danach 1001
    Treiber t;
    auto a = Audio::rampe(5000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 0.1, &a->a, 1000).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(4096);
    PRUEF_NAH(t.l[793], 1000.0 * MITTE, 1e-2);
    PRUEF_NAH(t.l[794], 1001.0 * MITTE, 1e-2);
    PRUEF_NAH(t.l[792], 0.0, 0.0);
  }
  {  // 3: Clip-Gain −6 dB
    Treiber t;
    auto a = Audio::impuls(1000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 0.5, &a->a, 0, 0.5011872f).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(2048);
    PRUEF_NAH(t.l[793], 0.5011872 * MITTE, 1e-6);
  }
  {  // 4: Start auf Beat 1 mitten im Clip 0..4 einer Rampe: Quellframe 22 500 bei 793, 32 Samples Einblende
    Treiber t;
    auto a = Audio::rampe(200000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &a->a).fertig());
    t.arr.start(1.0, 0, false, 0, V, 256, t.k);
    t.lauf(2048);
    PRUEF_NAH(t.l[793], 0.0, 0.0);
    PRUEF_NAH(t.l[793 + 16], (22500.0 + 16) * 0.5 * MITTE, 1e-1);
    PRUEF_NAH(t.l[793 + 32], (22500.0 + 32) * MITTE, 1e-1);
  }
  {  // 5: Clip 0..2 mit Ein- und Ausblende je 0,5 Beat (11 250 Samples), Gleichwert 0,5
    Treiber t;
    auto a = Audio::gleich(200000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 2.0, &a->a, 0, 1.0f, 0.5, 0.5).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(50000);
    PRUEF_NAH(t.l[793], 0.0, 0.0);
    PRUEF_NAH(t.l[793 + 5625], 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[793 + 11250], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[45793 - 5625], 0.25 * MITTE, 1e-6);
    PRUEF_NAH(t.l[45792], 0.5 / 11250.0 * MITTE, 1e-7);
    PRUEF_NAH(t.l[45793], 0.0, 0.0);
  }
  {  // 6: Naht bei 180 000 (Loop 0..4 ab Takt): letzte 96 Samples blenden aus, der neue Durchlauf setzt voll ein
    Treiber t;
    auto a = Audio::gleich(400000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &a->a).fertig());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(181000);
    PRUEF_NAH(t.l[179904], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[179952], 0.5 * 48.0 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[179999], 0.5 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[180000], 0.5 * MITTE, 1e-6);
    PRUEF(t.arr.stimmen() == 1);
  }
  {  // 7: Stopp auf den nächsten Beat (112 500): Kurzblende beginnt dort, nach 96 Samples still
    Treiber t;
    auto a = Audio::gleich(400000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a).fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(99840);
    t.arr.stopp(1, t.s, t.k);
    t.lauf(120000);
    PRUEF_NAH(t.l[112499], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[112548], 0.5 * 48.0 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[112595], 0.5 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[112596], 0.0, 0.0);
    PRUEF(t.arr.stimmen() == 0);
  }
  {  // 8: Tausch bei 99 840: unverändert spielt ohne Blende weiter; verschoben klingt 96 Samples aus
    for (int geaendert = 0; geaendert < 2; ++geaendert) {
      Treiber t;
      auto a = Audio::gleich(400000);
      t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a).fertig());
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(99840);
      t.laden(Bau(2).spur(1, ArrArt::audio).clip(1, "c1", geaendert ? 0.5 : 0.0, 8.0, &a->a).fertig());
      t.lauf(102000);
      if (!geaendert) {
        for (int64_t i = 99840; i < 99936; ++i) PRUEF_NAH(t.l[i], 0.5 * MITTE, 1e-6);
        PRUEF(t.arr.stimmen() == 1);
      } else {
        PRUEF_NAH(t.l[99840], 0.5 * MITTE, 1e-6);
        PRUEF_NAH(t.l[99887], 0.5 * 49.0 / 96.0 * MITTE, 1e-6);
        PRUEF_NAH(t.l[99936], 0.0, 0.0);              // neue Lage beginnt erst bei Beat 0,5 = 101 250
        PRUEF_NAH(t.l[101250], 0.5 * MITTE, 1e-6);
      }
    }
  }
  {  // 9: Pool-Grenze: 65 gleichzeitige Clips -> 64 Stimmen, eine gezählt verloren
    Treiber t;
    auto a = Audio::gleich(100000);
    Bau b;
    b.spur(1, ArrArt::audio);
    for (int i = 0; i < 65; ++i) b.clip(1, ("c" + std::to_string(i)).c_str(), 0.0, 1.0, &a->a);
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(1024);
    PRUEF(t.arr.stimmen() == 64);
    PRUEF(t.arr.stimmen_verloren() == 1);
  }
  {  // 10: Negativ-Kontrolle: Clip hinter der Loop-Klammer klingt nie
    Treiber t;
    auto a = Audio::impuls(1000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 4.0, 0.5, &a->a).fertig());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(400000);
    PRUEF(t.treffer(0, 400000).empty());
  }
  PRUEF_ENDE();
}
