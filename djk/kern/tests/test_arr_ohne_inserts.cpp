// 1.10 slice 4a T2, negative control: a project of 32 tracks, 2 groups, 2 returns with sends and the Hall, WITHOUT any insert, is bit-equal to what
// the build before this slice produced (the AK1 pattern). kGolden is the FNV-1a hash of the master, the PM tap and the erz/4 sum over 130000 samples,
// printed by this very test built from the parent commit of the task (e879629d, slice 4a T1); it must never change without a stated reason.
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr uint64_t kGolden = 0xb8fafa36680592e3ULL;

static uint64_t fnv(uint64_t h, const std::vector<float>& v) {
  const unsigned char* p = reinterpret_cast<const unsigned char*>(v.data());
  for (size_t i = 0; i < v.size() * sizeof(float); ++i) h = (h ^ p[i]) * 1099511628211ULL;
  return h;
}

int main() {
  std::vector<std::unique_ptr<Audio>> au;
  for (int i = 0; i < 32; ++i) au.push_back(Audio::sinus(400000, 220.0 * (1.0 + i / 10.0), 0.02f));
  auto t_p = std::make_unique<Treiber>();
  Treiber& t = *t_p;
  Bau b(1);
  for (int i = 1; i <= 32; ++i) {
    const std::string id = "c" + std::to_string(i);
    b.spur(i, ArrArt::audio).clip(i, id.c_str(), 0.0, 8.0, &au[i - 1]->a);
    if (i <= 8) b.ausgang(i, 1);
    else if (i <= 12) b.ausgang(i, 2);
  }
  cdj::ArrSnapshot* s = b.fertig();
  s->ret_da[0] = s->ret_da[1] = true;
  for (int i = 1; i <= 32; ++i) {
    const std::string p = "spur/" + std::to_string(i) + "/";
    t.arr.setze_sofort(t.tab.suche((p + "fader").c_str()), -static_cast<float>(i % 7));
    t.arr.setze_sofort(t.tab.suche((p + "pan").c_str()), static_cast<float>((i % 5) - 2) * 0.4f);
    if (i <= 4) t.arr.setze_sofort(t.tab.suche((p + "send/1").c_str()), -6.0f);
    if (i >= 20 && i <= 22) t.arr.setze_sofort(t.tab.suche((p + "send/2").c_str()), -3.0f);
  }
  t.arr.setze_sofort(t.tab.suche("grp/1/send/2"), -9.0f);
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, 537, 256, t.k);
  t.lauf(130000);
  uint64_t h = 1469598103934665603ULL;
  h = fnv(h, t.l);
  h = fnv(h, t.r);
  h = fnv(h, t.pml);
  h = fnv(h, t.pmr);
  std::printf("hash 0x%016llxULL\n", static_cast<unsigned long long>(h));
  double q = 0.0;
  for (float x : t.pml) q += static_cast<double>(x) * x;
  PRUEF(q > 1.0);   // positive control: the project really sounds
  PRUEF(h == kGolden);
  PRUEF_ENDE();
}
