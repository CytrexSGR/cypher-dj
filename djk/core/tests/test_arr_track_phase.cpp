// Mehrkern slice 3.1, task 3: the serial phase skeleton and the sticky plan (arr_track_phase.h, Arrangement::spur_quelle).
//   1 phase_seriell_bitgleich: RB, bk and host (attrappe) tracks mixed, 3000 blocks. The raw track signal the arrangement produces through
//                              the plan (one lane and four lanes) equals the pre-change sink loop (kept here as the reference function),
//                              block by block, bit for bit.
//   2 plan_klebrig:            the lane of every track stays over 100 blocks and over a swap that only changes a parameter; adding or
//                              removing a track changes the lists, the other tracks keep their lane.
//   3 plan_verteilung:         24 RB tracks on 4 lanes: 6 per lane; every track exactly once in the lanes and the remainder; bk and host
//                              only in the remainder.
//   4 plan_uebergang:          (a) a device change puts the track in the remainder for that block, the flag rebuilds the plan after the
//                              block and the track is in a lane list again (bk -> rb338); (b) a block with a fading sink (n_weg_ > 0) runs
//                              serial and rebuilds afterwards; (c) a parameter-only swap leaves every RB track in a lane list (the
//                              regression of a "zuletzt_ non-empty" predicate).
//   5 plan_setter:            setze_spur_bahnen / setze_hall_pool / setze_senke_intern / setze_senke_wirt after the load drop the plan-valid
//                              flag; the next block rebuilds (new lane count) and the track signals stay bit-equal to the reference loop.
// Mutations: SPUR_PLAN_LAESST_SPUR_AUS (a track is left out of every list) must turn cases 1 and 3 red;
//            SPUR_FLAG_BLEIBT (setze_spur_bahnen keeps the flag) must turn case 5 red.
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int M = 256;
constexpr int N_RB = 8;   // case 1 and 2: tracks 0..7 rb338, 8 bk, 9 host

cdj::ArrSnapshot* snap(int64_t nr, int n_rb, int variante, bool mit_bk, CypherBk* h, bool mit_wirt) {
  Bau b(nr);
  for (int i = 0; i < n_rb; ++i) b.spur(i + 1, ArrArt::intern);
  if (mit_bk) b.spur(n_rb + 1, ArrArt::intern);
  if (mit_wirt) b.spur(n_rb + 2, ArrArt::wirt, 1);
  cdj::ArrSnapshot* s = b.fertig();
  for (int i = 0; i < n_rb; ++i) {
    cdj::ArrSpur& sp = s->spur[i];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
    auto p = [&](const char* name, float w) {
      std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
      sp.param[sp.n_param++].wert = w;
    };
    p("cutoff", 0.15f + 0.03f * static_cast<float>(i % 20) + 0.03f * static_cast<float>(variante));
    p("resonanz", 0.2f + 0.05f * static_cast<float>(i % 4));
    p("decay", 0.3f + 0.02f * static_cast<float>(i % 20));
  }
  if (mit_bk) bkt::spur(s, n_rb + 1, h, 1, {{"k1", 0.7f}});
  return s;
}

struct Welt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, nullptr};
  PruefSenke host;
  Welt() {
    t.arr.setze_senke_intern(&intern);
    t.arr.setze_senke_wirt(1, &host);
  }
  void laden(cdj::ArrSnapshot* s, int64_t s0) {
    t.s = s0;
    t.laden(s);
  }
  // one block of the arrangement itself (no notes in the snapshot: the notes below go straight into the sinks)
  void block(int64_t s0) {
    float b[6][cdj::ARR_BLOCK];
    for (auto& x : b) std::fill(x, x + M, 0.0f);
    t.arr.block(t.k, s0, M, b[0], b[1], b[2], b[3], b[4], b[5]);
  }
};

void speise(cdj::ArrSenke& s, int spur, int b, int64_t s0) {
  if (b == 0) s.transport_start(spur, s0);
  const int ph = b % 11;
  const uint8_t ton = static_cast<uint8_t>(33 + spur * 3 + (b / 11) % 5);
  if (ph == 0) s.note(spur, s0 + (b * 7 + spur * 13) % M, ton, static_cast<uint8_t>(90 + spur), true);
  if (ph == 6) s.note(spur, s0 + (b * 5 + spur * 3) % M, ton, 0, false);
}

bool bit_gleich(const float* a, const float* b, int n) { return std::memcmp(a, b, sizeof(float) * static_cast<size_t>(n)) == 0; }

// the plan as a lane per track (-1: not in a lane list)
std::vector<int> bahnen_von(const cdj::ArrSpurPlan& p) {
  std::vector<int> v(cdj::ARR_SPUREN, -1);
  for (int b = 0; b < cdj::ArrSpurPlan::BAHNEN; ++b)
    for (int k = 0; k < p.n(b); ++k) v[p.spur(b, k)] = b;
  return v;
}
bool im_rest(const cdj::ArrSpurPlan& p, int spur) {
  for (int k = 0; k < p.n_rest(); ++k)
    if (p.rest(k) == spur) return true;
  return false;
}

// 1: the arrangement through the plan against the pre-change sink loop (reference function: every sink in track order, block())
void fall1() {
  for (int bahnen : {1, 4}) {
    CypherBk* h = bkt::neu(bkt::G_T);
    CypherBk* h2 = bkt::neu(bkt::G_T);
    {
      Welt a, ref;
      a.t.arr.setze_spur_bahnen(bahnen);
      a.laden(snap(1, N_RB, 0, true, h, true), 0);
      ref.laden(snap(1, N_RB, 0, true, h2, true), 0);
      std::vector<float> rl(M), rr(M);
      double e_rb = 0.0, e_bk = 0.0, e_host = 0.0;
      int ungleich = 0;
      for (int b = 0; b < 3000; ++b) {
        const int64_t s0 = static_cast<int64_t>(b) * M;
        if (b == 1500) {   // a parameter swap in the middle, on both
          a.laden(snap(2, N_RB, 1, true, h, true), s0);
          ref.laden(snap(2, N_RB, 1, true, h2, true), s0);
        }
        for (int i = 0; i <= N_RB; ++i) {
          speise(a.intern, i, b, s0);
          speise(ref.intern, i, b, s0);
        }
        a.host.note(N_RB + 1, s0 + (b * 3) % M, 60, 100, b % 5 == 0);
        ref.host.note(N_RB + 1, s0 + (b * 3) % M, 60, 100, b % 5 == 0);
        a.host.block_s0 = ref.host.block_s0 = s0;
        a.block(s0);
        // the reference: the sink loop of Arrangement::block before the change
        for (int i = 0; i < cdj::ARR_SPUREN; ++i) {
          std::fill(rl.begin(), rl.end(), 0.0f);
          std::fill(rr.begin(), rr.end(), 0.0f);
          if (i <= N_RB) ref.intern.block(i, s0, M, rl.data(), rr.data());
          else if (i == N_RB + 1) ref.host.block(i, s0, M, rl.data(), rr.data());
          if (!bit_gleich(a.t.arr.spur_bus_l(i), rl.data(), M) || !bit_gleich(a.t.arr.spur_bus_r(i), rr.data(), M)) ++ungleich;
          double e = 0.0;
          for (float x : rl) e += static_cast<double>(x) * x;
          (i < N_RB ? e_rb : i == N_RB ? e_bk : e_host) += e;
        }
      }
      PRUEF(ungleich == 0);
      PRUEF(e_rb > 0.0 && e_bk > 0.0 && e_host > 0.0);   // the signals are not silence, so equality means something
      std::printf("case 1 phase_seriell_bitgleich bahnen=%d: ungleich=%d e_rb=%.3g e_bk=%.3g e_host=%.3g\n", bahnen, ungleich, e_rb, e_bk, e_host);
    }
    cypher_bk_frei(h);
    cypher_bk_frei(h2);
  }
}

// 2: sticky
void fall2() {
  Welt w;
  w.t.arr.setze_spur_bahnen(4);
  w.laden(snap(1, N_RB, 0, false, nullptr, false), 0);
  int b = 0;
  auto lauf = [&](int n) {
    for (int k = 0; k < n; ++k, ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < 12; ++i) speise(w.intern, i, b, s0);
      w.block(s0);
    }
  };
  lauf(3);
  const std::vector<int> v0 = bahnen_von(w.t.arr.spur_plan());
  for (int i = 0; i < N_RB; ++i) PRUEF(v0[i] >= 0);
  bool stabil = true;
  for (int k = 0; k < 100; ++k) {
    lauf(1);
    stabil = stabil && bahnen_von(w.t.arr.spur_plan()) == v0;
  }
  PRUEF(stabil);
  w.laden(snap(2, N_RB, 1, false, nullptr, false), static_cast<int64_t>(b) * M);   // parameter only
  PRUEF(bahnen_von(w.t.arr.spur_plan()) == v0);   // straight after the swap
  lauf(5);
  PRUEF(bahnen_von(w.t.arr.spur_plan()) == v0);   // and after the blocks that followed it
  // a track is added: the others keep their lane, the new one joins a lane list
  w.laden(snap(3, N_RB + 1, 1, false, nullptr, false), static_cast<int64_t>(b) * M);
  lauf(4);
  std::vector<int> v1 = bahnen_von(w.t.arr.spur_plan());
  PRUEF(v1 != v0);
  PRUEF(v1[N_RB] >= 0);
  for (int i = 0; i < N_RB; ++i) PRUEF(v1[i] == v0[i]);
  // a track is removed (track 3): it is gone, the others keep their lane
  Bau bb(4);
  for (int i = 0; i < N_RB + 1; ++i)
    if (i != 3) bb.spur(i + 1, ArrArt::intern);
  cdj::ArrSnapshot* s4 = bb.fertig();
  for (int i = 0; i < N_RB + 1; ++i)
    if (i != 3) std::snprintf(s4->spur[i].geraet, sizeof s4->spur[i].geraet, "rb338");
  w.laden(s4, static_cast<int64_t>(b) * M);
  lauf(4);
  const std::vector<int> v2 = bahnen_von(w.t.arr.spur_plan());
  PRUEF(v2[3] == -1);
  for (int i = 0; i < N_RB + 1; ++i)
    if (i != 3) PRUEF(v2[i] == v1[i]);
  std::printf("case 2 plan_klebrig done\n");
}

// 3: distribution
void fall3() {
  CypherBk* h = bkt::neu(bkt::G_T);
  {
    Welt w;
    w.t.arr.setze_spur_bahnen(4);
    w.laden(snap(1, 24, 0, true, h, true), 0);   // 24 rb338 (0..23), bk 24, host 25
    for (int b = 0; b < 3; ++b) {
      for (int i = 0; i < 25; ++i) speise(w.intern, i, b, static_cast<int64_t>(b) * M);
      w.block(static_cast<int64_t>(b) * M);
    }
    const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
    PRUEF(p.bahnen() == 4);
    for (int b = 0; b < 4; ++b) PRUEF(p.n(b) == 6);
    int vorkommen[cdj::ARR_SPUREN] = {};
    for (int b = 0; b < 4; ++b)
      for (int k = 0; k < p.n(b); ++k) ++vorkommen[p.spur(b, k)];
    for (int k = 0; k < p.n_rest(); ++k) ++vorkommen[p.rest(k)];
    for (int i = 0; i < 26; ++i) PRUEF(vorkommen[i] == 1);
    for (int i = 26; i < cdj::ARR_SPUREN; ++i) PRUEF(vorkommen[i] == 0);
    PRUEF(p.n_rest() == 2 && im_rest(p, 24) && im_rest(p, 25));
    const std::vector<int> v = bahnen_von(p);
    PRUEF(v[24] == -1 && v[25] == -1);
  }
  cypher_bk_frei(h);
  std::printf("case 3 plan_verteilung done\n");
}

// 4: transitions
void fall4() {
  CypherBk* h = bkt::neu(bkt::G_T);
  CypherBk* h2 = bkt::neu(bkt::G_T);
  {
    Welt w;
    w.t.arr.setze_spur_bahnen(4);
    int b = 0;
    auto lauf = [&](int n) {
      for (int k = 0; k < n; ++k, ++b) {
        const int64_t s0 = static_cast<int64_t>(b) * M;
        for (int i = 0; i < 4; ++i) speise(w.intern, i, b, s0);
        w.block(s0);
      }
    };
    auto drei = [&](int variante, int64_t nr, bool t0_bk, bool t1_bk) {
      Bau bb(nr);
      for (int i = 0; i < 4; ++i) bb.spur(i + 1, ArrArt::intern);
      cdj::ArrSnapshot* s = bb.fertig();
      for (int i = 0; i < 4; ++i) {
        std::snprintf(s->spur[i].geraet, sizeof s->spur[i].geraet, "rb338");
        std::snprintf(s->spur[i].param[0].name, sizeof s->spur[i].param[0].name, "cutoff");
        s->spur[i].param[0].wert = 0.2f + 0.05f * static_cast<float>(i + variante);
        s->spur[i].n_param = 1;
      }
      if (t0_bk) bkt::spur(s, 1, h, 1, {{"k1", 0.7f}});
      if (t1_bk) bkt::spur(s, 2, h2, 1, {{"k1", 0.6f}});
      return s;
    };
    // track 1 (index 1) starts as bk, the others as rb338
    w.laden(drei(0, 1, false, true), 0);
    lauf(6);
    {
      const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
      PRUEF(im_rest(p, 1));                        // bk
      PRUEF(p.in_liste(0) && p.in_liste(2) && p.in_liste(3));
    }
    // (a) track 0: rb338 -> bk, track 1: bk -> rb338, in one swap
    w.laden(drei(0, 2, true, false), static_cast<int64_t>(b) * M);
    {
      const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
      PRUEF(im_rest(p, 0) && !p.in_liste(0));      // device change: the old sink is still the last one
      PRUEF(im_rest(p, 1) && !p.in_liste(1));      // transition bk -> rb338
      PRUEF(p.in_liste(2) && p.in_liste(3));
    }
    lauf(1);                                       // the transition block runs serial
    PRUEF(!w.t.arr.spur_plan_gueltig());           // track 1 is over its transition: the plan is stale
    lauf(1);
    PRUEF(w.t.arr.spur_plan_gueltig());
    PRUEF(w.t.arr.spur_plan().in_liste(1));        // back in a lane list
    PRUEF(im_rest(w.t.arr.spur_plan(), 0));        // track 0 plays bk now: stays serial
    // (c) a parameter-only swap: every RB track stays in a lane list
    w.laden(drei(3, 3, true, false), static_cast<int64_t>(b) * M);
    {
      const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
      PRUEF(p.in_liste(1) && p.in_liste(2) && p.in_liste(3));
      PRUEF(im_rest(p, 0));
    }
    lauf(3);
    {
      const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
      PRUEF(p.in_liste(1) && p.in_liste(2) && p.in_liste(3));
      PRUEF(w.t.arr.spur_plan_gueltig());
    }
    // (b) a sounding track leaves the playback: its sink fades it out in the next block, the whole phase runs serial in the old order
    {
      Bau bb(4);
      for (int i = 0; i < 4; ++i)
        if (i != 2) bb.spur(i + 1, ArrArt::intern);
      cdj::ArrSnapshot* s = bb.fertig();
      for (int i = 0; i < 4; ++i)
        if (i != 2) std::snprintf(s->spur[i].geraet, sizeof s->spur[i].geraet, "rb338");
      bkt::spur(s, 1, h, 1, {{"k1", 0.7f}});
      // make sure track 2 sounds when it leaves: a note on, no note off
      const int64_t s0 = static_cast<int64_t>(b) * M;
      w.intern.note(2, s0 + 1, 50, 110, true);
      w.block(s0);
      ++b;
      w.laden(s, static_cast<int64_t>(b) * M);
      const int64_t s1 = static_cast<int64_t>(b) * M;
      w.block(s1);
      ++b;
      PRUEF(!w.t.arr.spur_plan_gueltig());         // the serial branch ran and left the plan stale
      double e = 0.0;
      for (int i = 0; i < M; ++i) e += static_cast<double>(w.t.arr.spur_bus_l(2)[i]) * w.t.arr.spur_bus_l(2)[i];
      PRUEF(e > 0.0);                              // the fade of the leaving track reached its bus
      lauf(1);
      PRUEF(w.t.arr.spur_plan_gueltig());
      PRUEF(!w.t.arr.spur_plan().in_liste(2) && !im_rest(w.t.arr.spur_plan(), 2));
      PRUEF(w.t.arr.spur_plan().in_liste(3));
    }
  }
  cypher_bk_frei(h);
  cypher_bk_frei(h2);
  std::printf("case 4 plan_uebergang done\n");
}

// 5: the setters drop the flag, the next block rebuilds, the signals stay equal to the reference loop
void fall5() {
  Welt a, ref;
  a.t.arr.setze_spur_bahnen(4);
  a.laden(snap(1, N_RB, 0, false, nullptr, true), 0);
  ref.laden(snap(1, N_RB, 0, false, nullptr, true), 0);
  std::vector<float> rl(M), rr(M);
  int b = 0, ungleich = 0;
  auto lauf = [&](int n) {
    for (int k = 0; k < n; ++k, ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < N_RB; ++i) {
        speise(a.intern, i, b, s0);
        speise(ref.intern, i, b, s0);
      }
      a.block(s0);
      for (int i = 0; i < cdj::ARR_SPUREN; ++i) {
        std::fill(rl.begin(), rl.end(), 0.0f);
        std::fill(rr.begin(), rr.end(), 0.0f);
        if (i < N_RB) ref.intern.block(i, s0, M, rl.data(), rr.data());
        else if (i == N_RB) ref.host.block(i, s0, M, rl.data(), rr.data());
        if (!bit_gleich(a.t.arr.spur_bus_l(i), rl.data(), M) || !bit_gleich(a.t.arr.spur_bus_r(i), rr.data(), M)) ++ungleich;
      }
    }
  };
  lauf(30);
  PRUEF(a.t.arr.spur_plan_gueltig() && a.t.arr.spur_plan().bahnen() == 4);
  a.t.arr.setze_spur_bahnen(2);
  PRUEF(!a.t.arr.spur_plan_gueltig());
  PRUEF(a.t.arr.spur_plan().bahnen() == 4);   // still the old plan until the block starts
  lauf(1);
  PRUEF(a.t.arr.spur_plan_gueltig() && a.t.arr.spur_plan().bahnen() == 2);
  a.t.arr.setze_spur_bahnen(0);   // from the pool: no pool, one lane
  PRUEF(!a.t.arr.spur_plan_gueltig());
  lauf(1);
  PRUEF(a.t.arr.spur_plan_gueltig() && a.t.arr.spur_plan().bahnen() == 1);
  a.t.arr.setze_spur_bahnen(3);
  lauf(1);
  PRUEF(a.t.arr.spur_plan().bahnen() == 3);
  a.t.arr.setze_hall_pool(nullptr);
  PRUEF(!a.t.arr.spur_plan_gueltig());
  lauf(1);
  PRUEF(a.t.arr.spur_plan_gueltig());
  a.t.arr.setze_senke_intern(&a.intern);
  PRUEF(!a.t.arr.spur_plan_gueltig());
  lauf(1);
  PRUEF(a.t.arr.spur_plan_gueltig());
  a.t.arr.setze_senke_wirt(1, &a.host);
  PRUEF(!a.t.arr.spur_plan_gueltig());
  lauf(2);
  PRUEF(a.t.arr.spur_plan_gueltig());
  PRUEF(ungleich == 0);
  PRUEF(a.t.arr.spur_bus_l(-1) == nullptr && a.t.arr.spur_bus_l(cdj::ARR_SPUREN) == nullptr);
  std::printf("case 5 plan_setter: ungleich=%d\n", ungleich);
}

}  // namespace

int main() {
  fall1();
  fall2();
  fall3();
  fall4();
  fall5();
  PRUEF_ENDE();
}
