// 1.10 slice 7 (T5 review fix): a running tap with the track phase on the Hall pool (multi core). 24 rb tracks, 3 workers, a track pre, a track post and
// a production master post tap run in a world with the pool and in the serial world: the three files are bit-equal, and the pool really forked (the
// positive counters), so a run that stayed serial fails instead of passing empty. Pattern of test_arr_spur_pool case 1; the tap reads the track bus after
// the join of the phase, on the callback thread (TSan: no race with the workers).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/reverb_pool.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int M = 256;

struct Pool {
  cdj::HallPool p;
  static cdj::HallPoolEinstellung einst(int faeden) {
    cdj::HallPoolEinstellung e;
    e.faeden = faeden;
    e.frist_us = 1000000;
    e.bloecke_us = 5333;
    return e;
  }
  explicit Pool(int faeden) : p(einst(faeden)) { p.setze_fifo_test(true); }
};

cdj::ArrSnapshot* snap(int n_rb) {
  Bau b(1);
  for (int i = 0; i < n_rb; ++i) b.spur(i + 1, ArrArt::intern);
  cdj::ArrSnapshot* s = b.fertig();
  for (int i = 0; i < n_rb; ++i) {
    cdj::ArrSpur& sp = s->spur[i];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
    auto p = [&](const char* name, float w) {
      std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
      sp.param[sp.n_param++].wert = w;
    };
    p("cutoff", 0.15f + 0.03f * static_cast<float>(i % 20));
    p("resonanz", 0.2f + 0.05f * static_cast<float>(i % 4));
    p("decay", 0.3f + 0.02f * static_cast<float>(i % 20));
  }
  return s;
}

struct Welt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, nullptr};
  PruefSenke host;
  float out[6][cdj::ARR_BLOCK] = {};
  Welt() {
    t.arr.setze_senke_intern(&intern);
    t.arr.setze_senke_wirt(1, &host);
  }
};

void speise(cdj::ArrSenke& s, int spur, int b, int64_t s0) {
  if (b == 0) s.transport_start(spur, s0);
  const int ph = b % 11;
  const uint8_t ton = static_cast<uint8_t>(33 + spur * 3 + (b / 11) % 5);
  if (ph == 0) s.note(spur, s0 + (b * 7 + spur * 13) % M, ton, static_cast<uint8_t>(90 + spur), true);
  if (ph == 6) s.note(spur, s0 + (b * 5 + spur * 3) % M, ton, 0, false);
}

cdj::SpurTest kein_tor() {
  cdj::SpurTest t;
  t.min_last = 0;
  t.grenze_ns = 10'000'000'000LL;
  t.warte_spaet_ns = 10'000'000'000LL;
  return t;
}

cdj::ArrAbgriff auftrag(int art, int nr, int punkt) {
  cdj::ArrAbgriff a;
  a.art = art;
  a.nr = nr;
  a.punkt = punkt;
  a.kennung = 7;
  a.von_beat = 0.0;
  a.bis_beat = 1.0;
  a.kap = 48000 + 2;
  a.daten.assign(static_cast<size_t>(a.kap) * 2, -9.0f);
  return a;
}

// one tap in a world, driven block by block together with the notes of the 24 tracks; returns true when it finished with status 0
bool tap(Welt& w, int& b, cdj::ArrAbgriff& a) {
  const char* grund = "";
  if (!w.t.arr.abgriff(&a, 0, false, static_cast<int64_t>(b) * M, 0, M, w.t.k, grund)) return false;
  for (int n = 0; n < 1200; ++n, ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 24; ++i) speise(w.intern, i, b, s0);
    w.host.block_s0 = s0;
    for (auto& x : w.out) std::fill(x, x + cdj::ARR_BLOCK, 0.0f);
    w.t.arr.block(w.t.k, s0, M, w.out[0], w.out[1], w.out[2], w.out[3], w.out[4], w.out[5]);
    if (w.t.arr.hole_abgriff_fertig() == &a) {
      ++b;
      return a.status == 0;
    }
  }
  return false;
}

}  // namespace

int main() {
  Pool pool(3);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.t.laden(snap(24));
  ref.t.laden(snap(24));
  struct Fall { int art, nr, punkt; };
  const Fall faelle[] = {{0, 5, 1}, {0, 20, 0}, {3, 1, 1}};
  int ba = 0, br = 0;
  for (const Fall& f : faelle) {
    cdj::ArrAbgriff ta = auftrag(f.art, f.nr, f.punkt), tr = auftrag(f.art, f.nr, f.punkt);
    PRUEF(tap(a, ba, ta));
    PRUEF(tap(ref, br, tr));
    PRUEF(ta.frames == tr.frames && ta.frames > 20000 && ta.start_s == tr.start_s);
    const size_t n = static_cast<size_t>(2 * tr.frames);
    double e = 0.0;
    for (size_t i = 0; i < n; ++i) e += static_cast<double>(tr.daten[i]) * tr.daten[i];
    const bool gleich = ta.daten.size() == tr.daten.size() && std::memcmp(ta.daten.data(), tr.daten.data(), n * sizeof(float)) == 0;
    std::printf("pool: tap art %d nr %d punkt %d: %lld frames, energy %.4g, bit-equal to the serial run: %s\n", f.art, f.nr, f.punkt, static_cast<long long>(ta.frames), e,
                gleich ? "yes" : "NO");
    PRUEF(gleich);
    PRUEF(e > 1e-6);   // not silence: equality means something
  }
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  std::printf("pool: blocks parallel %llu, worker units %llu\n", static_cast<unsigned long long>(sl.z.blocks_parallel), static_cast<unsigned long long>(sl.einheiten_worker()));
  PRUEF(sl.z.blocks_parallel > 100);
  PRUEF(sl.einheiten_worker() > 0);
  PRUEF(sl.z.unfertig == 0);
  PRUEF_ENDE();
}
