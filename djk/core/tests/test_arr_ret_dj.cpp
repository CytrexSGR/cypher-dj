// Loop deck channel strip KZ3: the output of a return of the live container into a DJ channel pair (ret_dj). Neighbours: test_arr_dj_kanal (groups), test_arr_returns (sends and returns).
// Constant 0.25 per track in the centre (d = 0.25 * MITTE on the left); the track sits in group 1 (gruppe_dj = 1), so the PM carries exactly nothing of it, and sends -6.02 dB into return 1.
// Cases: 1 return on DJ channel 3: its signal is in pair 3 and the PM carries none of it (ret_dj 0: it arrives in the PM, pair silent), 2 the offline switch (dj_master_): the return goes to the PM,
// 3 no dj_ausgang call: the return goes to the PM, 4 loader (live flag, nr 0 and 7, art gruppe refused, two returns on one channel accepted), 5 PDC (a DJ return does not raise p_in, its PM delay is 0),
// 6 a swap that removes the return: its fading tail lands in the pair, not in the PM, 7 no allocation over 2000 blocks.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/eq.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr int KAN = 6;
static const double MITTE = 0.70710677;
static const double D = 0.25 * MITTE;

struct Paare {
  std::vector<float> l[KAN], r[KAN];
};
// like Treiber::lauf plus the DJ pairs, zeroed and handed before every block (handed = false: a caller without them)
static void lauf(Treiber& t, Paare& p, int64_t bis, bool handed = true) {
  float b[6][cdj::ARR_BLOCK];
  float dl[KAN][cdj::ARR_BLOCK], dr[KAN][cdj::ARR_BLOCK];
  while (t.s < bis) {
    const int n = t.n;
    for (auto& x : b) std::fill(x, x + n, 0.0f);
    for (int c = 0; c < KAN; ++c) {
      std::fill(dl[c], dl[c] + n, 0.0f);
      std::fill(dr[c], dr[c] + n, 0.0f);
    }
    if (handed) {
      float* pl[KAN];
      float* pr[KAN];
      for (int c = 0; c < KAN; ++c) {
        pl[c] = dl[c];
        pr[c] = dr[c];
      }
      t.arr.dj_ausgang(pl, pr);
    }
    t.arr.block(t.k, t.s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + n);
    t.r.insert(t.r.end(), b[1], b[1] + n);
    for (int c = 0; c < KAN; ++c) {
      p.l[c].insert(p.l[c].end(), dl[c], dl[c] + n);
      p.r[c].insert(p.r[c].end(), dr[c], dr[c] + n);
    }
    t.s += n;
  }
}
static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const char* pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
// track 1 in group 1 (gruppe_dj = 1, so the PM carries none of the track), return 1 exists; dj = the DJ channel of the return (0 = the PM)
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, int dj, bool ret = true, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a).ausgang(1, 1);
  if (ret) {
    if (dj) b.ret_dj(1, dj);
    else b.ret(1);
  }
  cdj::ArrSnapshot* s = b.fertig();
  s->live = true;
  s->gruppe_dj[0] = 1;
  return s;
}
static void vorbereiten(Treiber& t) {
  for (const char* p : {"ret/1/hall/an", "ret/2/hall/an", "ret/3/hall/an", "ret/4/hall/an"}) setze(t, p, 0.0f);   // the dry return: no Hall
  setze(t, "spur/1/send/1", -6.0206f);
}
static void spiele(Treiber& t, Paare& p, cdj::ArrSnapshot* s, int64_t bis = 99840, bool handed = true) {
  vorbereiten(t);
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  lauf(t, p, bis, handed);
}
static double spitze(const std::vector<float>& x, size_t von = 0, size_t bis = SIZE_MAX) {
  double m = 0.0;
  for (size_t i = von; i < x.size() && i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(x[i])));
  return m;
}
static bool nullen(const std::vector<float>& x, size_t von = 0, size_t bis = SIZE_MAX) {
  for (size_t i = von; i < x.size() && i < bis; ++i)
    if (x[i] != 0.0f) return false;
  return true;
}
static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  {  // 1: the return on DJ channel 3 (pair index 2): in the pair, nothing in the PM; with ret_dj 0 the same level arrives in the PM, bit for bit, and the pairs are silent
    TR(dj) TR(pm)
    Paare pd, pp;
    spiele(dj, pd, snap(&a->a, 3));
    spiele(pm, pp, snap(&a->a, 0));
    const double im_paar = pd.l[2][99000], im_pm = pm.l[99000];
    std::printf("1: pair 3 %.6f, PM with ret_dj 0 %.6f (expected %.6f), PM with ret_dj 3 peak %.3g\n", im_paar, im_pm, D * 0.5, spitze(dj.l));
    PRUEF_NAH(im_paar, D * 0.5, 1e-6);
    PRUEF_NAH(im_pm, D * 0.5, 1e-6);
    PRUEF(nullen(dj.l) && nullen(dj.r));                 // the PM output carries none of the return (the group goes to pair 1)
    PRUEF(gleich(pd.l[2], pm.l));                         // the pair carries the old PM signal bit for bit
    PRUEF(gleich(pd.r[2], pm.r));
    PRUEF(nullen(pp.l[2]) && nullen(pp.r[2]));            // ret_dj 0: nothing in pair 3
    PRUEF(spitze(pd.l[0]) > 0.1);                          // the group on pair 1 plays as before
    PRUEF(gleich(pd.l[0], pp.l[0]));                       // and is not touched by the return routing
    for (int c = 1; c < KAN; ++c)
      if (c != 2) PRUEF(nullen(pd.l[c]) && nullen(pd.r[c]));
  }
  {  // 2: the offline switch: the return goes to the PM and the pair stays silent
    TR(o)
    Paare p;
    o.arr.setze_dj_als_master();
    spiele(o, p, snap(&a->a, 3));
    PRUEF_NAH(o.l[99000], D * 1.5, 1e-6);   // the group goes to the master in the offline switch as well: D + 0.5 D
    PRUEF(nullen(p.l[2]) && nullen(p.r[2]));
  }
  {  // 3: a caller that hands no pairs: the return goes to the PM
    TR(o)
    Paare p;
    spiele(o, p, snap(&a->a, 3), 99840, false);
    PRUEF_NAH(o.l[99000], D * 1.5, 1e-6);
    PRUEF(nullen(p.l[2]));
  }
  {  // 4: the loader
    arrdatei::Ordner o("test_arr_ret_dj");
    const std::string au = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, au, 48000) + "]}";
    int64_t nr = 400;
    cdj::ArrSnapshot* behalten = nullptr;
    const auto laden = [&](const std::string& returns, bool live, bool behalte = false) {
      ++nr;
      std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json") << "{\"format\":\"cypherdj-arr/2\",\"nr\":" << nr << ",\"spuren\":[" << spur << "],\"gruppen\":[],\"returns\":[" << returns << "]"
                                                                             << (live ? ",\"live\":true" : "") << "}";
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = e.grund + (e.snap ? "+snap" : "");
      if (behalte) behalten = e.snap.release();
      else cdj::gib_wiedergabe(e.snap.release(), cache);
      return g;
    };
    const auto ret = [](int n, const std::string& ausgang) { return "{\"nr\":" + std::to_string(n) + ",\"ausgang\":" + ausgang + "}"; };
    const std::string DJ3 = "{\"art\":\"dj\",\"nr\":3}";
    PRUEF(laden(ret(1, DJ3), true) == "+snap");
    PRUEF(laden(ret(1, DJ3), false) == "format");                                           // without the head flag
    PRUEF(laden(ret(1, "{\"art\":\"dj\",\"nr\":0}"), true) == "format");
    PRUEF(laden(ret(1, "{\"art\":\"dj\",\"nr\":7}"), true) == "format");
    PRUEF(laden(ret(1, "{\"art\":\"gruppe\",\"nr\":1}"), true) == "format");
    PRUEF(laden(ret(1, "{\"art\":\"master\"}"), true) == "+snap");                           // master stays
    PRUEF(laden(ret(1, "{\"art\":\"master\"}"), false) == "+snap");
    PRUEF(laden(ret(1, DJ3) + "," + ret(2, DJ3), true, true) == "+snap");                  // two returns on one channel
    PRUEF(behalten != nullptr);
    if (behalten) {
      PRUEF(behalten->ret_dj[0] == 3 && behalten->ret_dj[1] == 3 && behalten->ret_dj[2] == 0 && behalten->ret_dj[3] == 0);
      cdj::gib_wiedergabe(behalten, cache);
    }
    ++nr;   // the message names both outputs
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json") << "{\"format\":\"cypherdj-arr/2\",\"nr\":" << nr << ",\"spuren\":[" << spur << "],\"gruppen\":[],\"returns\":[" << ret(1, "{\"art\":\"gruppe\",\"nr\":1}") << "]}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.meldung.find("master") != std::string::npos && e.meldung.find("dj") != std::string::npos);
  }
  {  // 5: PDC. A return chain with latency (an EQ stage) raises P_in for a PM return; a DJ return leaves P_in and the delay of the other paths alone, and its own PM delay is 0
    const ArrStufe EQ{ArrInsArt::eq, 0, true};
    const int L = cdj::EqNativ().latenz();
    PRUEF(L > 0);
    auto bauen = [&](int dj, bool ret_stufe, bool spur_stufe) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a);
      if (spur_stufe) b.kette(1, {EQ});
      if (ret_stufe) b.ret_kette(1, {EQ});
      if (dj) b.ret_dj(1, dj);
      else b.ret(1);
      return std::unique_ptr<cdj::ArrSnapshot>(b.fertig());
    };
    const auto pm_ret = bauen(0, true, false), dj_ret = bauen(2, true, false);
    std::printf("5: p_in PM return %d, DJ return %d, PM_SPUR delay %d / %d, PM_RET0 delay %d / %d (L = %d)\n", pm_ret->pdc.p_in, dj_ret->pdc.p_in, pm_ret->pdc.d[cdj::PDC_PM_SPUR], dj_ret->pdc.d[cdj::PDC_PM_SPUR],
                pm_ret->pdc.d[cdj::PDC_PM_RET0], dj_ret->pdc.d[cdj::PDC_PM_RET0], L);
    PRUEF(pm_ret->pdc.p_in == pm_ret->pdc.t_g + L);        // positive control: the same chain on a PM return raises P_in
    PRUEF(pm_ret->pdc.d[cdj::PDC_PM_SPUR] == L);
    PRUEF(dj_ret->pdc.p_in == dj_ret->pdc.t_g);             // a DJ return does not
    PRUEF(dj_ret->pdc.d[cdj::PDC_PM_SPUR] == 0);
    PRUEF(dj_ret->pdc.d[cdj::PDC_PM_RET0] == 0);
    const auto spur_lat = bauen(2, false, true);            // latency elsewhere (a track chain): the DJ return is not delayed and P_in is the track arrival
    PRUEF(spur_lat->pdc.d[cdj::PDC_PM_RET0] == 0);
    PRUEF(spur_lat->pdc.p_in == spur_lat->pdc.t_g);
  }
  {  // 6: a swap removes the return: the fading tail lands in pair 3 and not in the PM. A swap that keeps it changes nothing
    TR(t)
    Paare p;
    spiele(t, p, snap(&a->a, 3), 99840);   // the start is quantised to a bar: the return sounds from about sample 90000
    const int64_t swap = t.s;
    t.laden(snap(&a->a, 0, false, 2));   // the return is gone (ret_da false); the track and the group stay
    lauf(t, p, swap + 4096);
    const size_t s0 = static_cast<size_t>(swap);
    std::printf("6: tail in pair 3 %.6f at the swap block, %.3g after 960 samples; PM peak %.3g\n", spitze(p.l[2], s0, s0 + 256), spitze(p.l[2], s0 + 1100, s0 + 4096), spitze(t.l));
    PRUEF(spitze(p.l[2], s0 - 256, s0) > D * 0.4);          // it sounded before
    PRUEF(spitze(p.l[2], s0, s0 + 256) > 1e-4);             // the fading tail is in the pair
    PRUEF(nullen(t.l) && nullen(t.r));                      // never in the PM
    PRUEF(nullen(p.l[2], s0 + 1100, s0 + 4096));            // and the hold has ended
  }
  {  // 7: no allocation over 2000 blocks (two returns on two channels, one on the PM, a swap at the middle)
    auto lang = Audio::gleich(700000, 0.25f);
    TR(t)
    auto zwei = [&](int64_t nr) {
      Bau b(nr);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &lang->a).ausgang(1, 1);
      b.ret_dj(1, 3);
      b.ret_dj(2, 6);
      b.ret(3);
      cdj::ArrSnapshot* s = b.fertig();
      s->live = true;
      s->gruppe_dj[0] = 1;
      return s;
    };
    vorbereiten(t);
    setze(t, "spur/1/send/2", -9.0f);
    setze(t, "spur/1/send/3", -12.0f);
    t.laden(zwei(1));
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    Paare p;
    long alloc = 0, summe = 0;
    int gezaehlt = 0;
    float b[6][cdj::ARR_BLOCK], dl[KAN][cdj::ARR_BLOCK], dr[KAN][cdj::ARR_BLOCK];
    for (int blk = 0; blk < 2250; ++blk) {
      const bool zaehlen = blk >= 250;
      if (blk == 1200) t.laden(zwei(2));
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      float* pl[KAN];
      float* pr[KAN];
      for (int c = 0; c < KAN; ++c) {
        std::fill(dl[c], dl[c] + 256, 0.0f);
        std::fill(dr[c], dr[c] + 256, 0.0f);
        pl[c] = dl[c];
        pr[c] = dr[c];
      }
      if (zaehlen) abfang_an();
      t.arr.dj_ausgang(pl, pr);
      t.arr.block(t.k, t.s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (zaehlen) {
        abfang_aus();
        const AbfangZahlen z = abfang_zahlen();
        alloc += z.alloc;
        summe += z.summe();
        ++gezaehlt;
      }
      t.s += 256;
    }
#if ALLOC_ABFANG_VERFUEGBAR
    std::printf("7: %d counted blocks, allocations %ld, all counters %ld\n", gezaehlt, alloc, summe);
    PRUEF(gezaehlt == 2000 && alloc == 0 && summe == 0);
#else
    std::printf("7: skipped (sanitizer build, no allocation hook)\n");
#endif
    abfang_an();
    void* q = std::malloc(16);
    const long positiv = abfang_aus();
    std::free(q);
#if ALLOC_ABFANG_VERFUEGBAR
    PRUEF(positiv >= 1);
#else
    (void)positiv;
#endif
  }
  PRUEF_ENDE();
}
