// K2 Task 1.2: Erzeuger meldet die Kick-Auslöser (Kit-Klänge mit duck) am absoluten Sample; nur duck-Klänge, Block ohne
// Ereignis meldet nichts, Deckel ErzAusloeser::MAX. Fehlerfall: test_erzeuger_duck_mutation (Blockanfang) muss scheitern.
#include <cmath>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "pruef.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM
constexpr int ERZ1 = 4;

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> puffer_l = std::vector<float>(cdj::MIX_KANAELE * N), puffer_r = puffer_l;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  Welt() {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &puffer_l[k * N]; r[k] = &puffer_r[k * N]; }
  }
  void block(int64_t n0, cdj::ErzAusloeser* a) {
    std::fill(puffer_l.begin(), puffer_l.end(), 0.0f);
    std::fill(puffer_r.begin(), puffer_r.end(), 0.0f);
    erz.block(karte, n0, N, l, r, nullptr, 0, a);
  }
};

cdj::Kit duck_kit() {
  cdj::Kit k;
  for (int i = 0; i < 2; ++i) {
    k.klang[i].frames = 64;
    k.klang[i].daten.assign(2 * 64, 0.5f);
  }
  k.klang[0].duck = true;
  k.klang[1].duck = false;
  k.n = 2;
  return k;
}

cdj::ErzFenster fenster(double ab, double bis, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = 1;
  f.sendung = 1;
  f.ab_beat = ab;
  f.bis_beat = bis;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

}  // namespace

int main() {
  const cdj::Kit kit = duck_kit();
  {  // 1. nur der duck-Klang meldet, am absoluten Sample; Block ohne Ereignis meldet nichts
    Welt w;
    w.erz.setze_strom(1, &kit, ERZ1);
    const int64_t blk_a = 800 * N, blk_b = 1200 * N;  // Blöcke mit je einem Ereignis mitten im Block
    const double b0 = (double)(blk_a + 100) / SPB, b1 = (double)(blk_b + 37) / SPB;
    const auto z = w.erz.fenster(fenster(8.0, 12.0, {{b0, 0, 1, 1.0f}, {b1, 1, 1, 1.0f}}), 0.0);
    PRUEF(z.eingefuegt == 2);
    cdj::ErzAusloeser a{};
    w.block(0, &a);
    PRUEF(a.n == 0);
    a.n = 99;
    w.block(blk_a, &a);
    PRUEF(a.n == 1);
    PRUEF(a.sample[0] == std::llround(w.karte.sample_at(b0)));
    PRUEF(a.sample[0] == blk_a + 100 && a.sample[0] != blk_a);
    w.block(blk_b, &a);  // hh (duck = false): keine Meldung
    PRUEF(a.n == 0);
    w.block(blk_b + N, nullptr);  // ohne Ausgabeparameter weiterhin übersetzbar und lauffähig
  }
  {  // 2. Deckel: 20 bd-Ereignisse im selben 256er-Block (~11 Samples Abstand) -> n == 16, der Rest verfällt still
    Welt w;
    w.erz.setze_strom(1, &kit, ERZ1);
    const int64_t blk = 800 * N;
    const double b0 = (double)(blk + 10) / SPB;  // letztes bei ~ +224 < 256
    cdj::ErzFenster f = fenster(8.0, 12.0, {});
    for (int i = 0; i < 20; ++i) f.ev[f.n++] = cdj::ErzEv{b0 + i * 0.0005, 0, 1, 1.0f};
    const auto z = w.erz.fenster(f, 0.0);
    PRUEF(z.eingefuegt == 20 && z.zu_spaet == 0);  // Fenster nimmt alle 20 an (ERZ_FENSTER_EV 64, ERZ_SCHLANGE 1024)
    PRUEF(w.karte.sample_at(b0 + 19 * 0.0005) < (double)(blk + N));
    cdj::ErzAusloeser a{};
    w.block(blk, &a);
    PRUEF(a.n == cdj::ErzAusloeser::MAX);
    PRUEF(a.sample[0] == std::llround(w.karte.sample_at(b0)));
    std::printf("deckel: n = %d\n", a.n);
  }
  PRUEF_ENDE();
}
