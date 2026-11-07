// 1.10 slice 4b T12, negative control of the plan: with only komp stages the results of slice 4a hold bit for bit.
// The run below (a 1 kHz sine on track 1, one komp stage at slot 1 with threshold -30 dB and ratio 8, fader -6 dB, a second one on a group, 120000 samples) was hashed on the
// parent commit of slice 4b (c583a628, slice 4a) and on this tree, both c4cba3d707453cb9; the constant is the FNV-1a 64 of the bit patterns of the PM tap and of the master L and R outputs.
// The program uses only the 4a interfaces, so the same source builds on both trees.
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/arr_wiedergabe.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

// FNV-1a 64 of the run below, measured on c583a628 (slice 4a, no eq/saett code) and equal on slice 4b
static constexpr uint64_t KOMP_HASH_4A = 0xc4cba3d707453cb9ull;

static uint64_t fnv(uint64_t h, const std::vector<float>& v, size_t von, size_t bis) {
  for (size_t i = von; i < bis; ++i) {
    uint32_t u;
    std::memcpy(&u, &v[i], 4);
    for (int k = 0; k < 4; ++k) h = (h ^ ((u >> (8 * k)) & 0xff)) * 0x100000001b3ull;
  }
  return h;
}

int main() {
  auto s1k = Audio::sinus(400000, 1000.0, 0.5f);
  auto s300 = Audio::sinus(400000, 300.0, 0.4f);
  auto t = std::make_unique<Treiber>();
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &s1k->a).ausgang(1, 1).kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
  b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &s300->a).ausgang(2, 1);
  b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 1, true}});
  for (int k = 1; k <= 2; ++k) {
    const std::string p = "ins/komp/" + std::to_string(k) + "/";
    t->arr.setze_sofort(t->tab.suche((p + "schwelle").c_str()), -30.0f);
    t->arr.setze_sofort(t->tab.suche((p + "ratio").c_str()), 8.0f);
    t->arr.setze_sofort(t->tab.suche((p + "an").c_str()), 1.0f);
  }
  t->arr.setze_sofort(t->tab.suche("spur/1/fader"), -6.0f);   // a fader off 0 dB, so a chain moved behind the fader changes the result
  t->laden(b.fertig());
  t->arr.start(0.0, 2, false, 0, 537, 256, t->k);
  t->lauf(120000);
  uint64_t h = 0xcbf29ce484222325ull;
  h = fnv(h, t->pml, 0, 119000);
  h = fnv(h, t->pmr, 0, 119000);
  h = fnv(h, t->ml, 0, 119000);
  h = fnv(h, t->mr, 0, 119000);
  std::printf("komp_hash %016llx\n", static_cast<unsigned long long>(h));
  PRUEF(h == KOMP_HASH_4A);   // the value taken on c583a628 (slice 4a); a change of any komp-only result goes red here
  PRUEF_ENDE();
}
