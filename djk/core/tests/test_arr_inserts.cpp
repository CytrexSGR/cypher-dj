// 1.10 slice 4a T2: the compressor insert chain of the arrangement mixer on tracks and groups, the pre/post send of a return, state across a swap,
// bypass, NaN and the real-time rule (spec 2.1, 2.2; AK-S4-1, 2, 3, 5, 6, 7).
// Constant 0.25 or a 1 kHz sine of 0.5 per track in the centre, start at bar 90000 (quant 2 from beat 0), blocks of 256.
// Cases: 1 chain_vor_fader, 2 bypass_bitgleich, 3 pre_post, 4 tausch_haelt_zustand, 5 nan_stufe, 6 keine_allokation (counting allocator, positive control), 7 loader, 8 gruppe_kette (group chain, group pre/post tap, track pre tap), 9 return_nach_hall, 10 pm_vor_fader_im_export, 11 loader (return and PM chain).
// 12 sidechain (T4): sidechain_kick, sc_stille_spur, sc_vor_kette.
// 13 pre_post_wechsel (flag flip blends), 14 nan_ganzer_block (whole block silent), 15 angezeigte_reduktion (group without members, mix 0), 16 solo_stummt_pre.
// Mutations (CMakeLists.txt): INS_NACH_FADER (1), INS_PRE_NACH_FADER (3), INS_PRE_OHNE_MUTE (3), INS_TAUSCH_LEERT (4), INS_NAN_DURCHLASS (5), INS_BYPASS_SPRUNG (2), INS_GRUPPE_UEBERSPRUNGEN (8), INS_GRUPPE_PRE_NACH_FADER (8), INS_RET_VOR_HALL (9), INS_PM_NACH_FADER (10), INS_SC_IGNORIERT (12), INS_SC_NACH_KETTE (12), INS_PRE_SPRUNG (13), INS_NAN_NUR_PROBEN (14), INS_GRUPPE_LEER_LAEUFT (15), INS_MIX0_GR_STEHT (15).
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

// a Treiber is about 750 KB: on the heap, or a case with many of them overflows the stack
#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const char* pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double db(double x) { return 20.0 * std::log10(x); }
static double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis; ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
static double groesster_schritt(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[i + 1] - v[i])));
  return m;
}
static bool gleich_bits(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  return std::memcmp(a.data() + von, b.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}

// one track with the audio `a`, optional chain on it; the stage is slot 0 (ins/komp/1)
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, bool mit_kette, bool stufe_an = true, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (mit_kette) b.kette(1, {ArrStufe{ArrInsArt::komp, 0, stufe_an}});
  return b.fertig();
}
// the compressor of AK-S4-1: threshold -30 dB, ratio 8, mix 1, switched on
static void komp_ein(Treiber& t, int slot = 1) {
  const std::string p = "ins/komp/" + std::to_string(slot) + "/";
  setze(t, (p + "an").c_str(), 1.0f);
  setze(t, (p + "schwelle").c_str(), -30.0f);
  setze(t, (p + "ratio").c_str(), 8.0f);
  setze(t, (p + "mix").c_str(), 1.0f);
}

int main() {
  auto sinus = Audio::sinus(400000, 1000.0, 0.5f);   // -6 dBFS
  auto konst = Audio::gleich(400000, 0.25f);

  {  // 1 chain_vor_fader (AK-S4-1): the chain lowers the track by at least 6 dB, and a fader of -12 dB does not change the gain reduction (chain before the fader)
    TR(a0) TR(b0) TR(a12) TR(c12)
    spiele(a0, spur1(&sinus->a, false), 120000);
    komp_ein(b0);
    spiele(b0, spur1(&sinus->a, true), 120000);
    setze(a12, "spur/1/fader", -12.0f);
    spiele(a12, spur1(&sinus->a, false), 120000);
    komp_ein(c12);
    setze(c12, "spur/1/fader", -12.0f);
    spiele(c12, spur1(&sinus->a, true), 120000);
    const double r_a0 = rms(a0.pml, 93000, 117000), r_b0 = rms(b0.pml, 93000, 117000);
    const double r_a12 = rms(a12.pml, 93000, 117000), r_c12 = rms(c12.pml, 93000, 117000);
    PRUEF(r_a0 > 0.1);                                  // the signal is there (positive control)
    const double gr0 = db(r_a0 / r_b0), gr12 = db(r_a12 / r_c12);
    std::printf("1: GR at fader 0 = %.3f dB, at fader -12 = %.3f dB\n", gr0, gr12);
    PRUEF(gr0 >= 6.0);                                  // AK-S4-1: at least 6 dB lower
    PRUEF_NAH(gr12 - gr0, 0.0, 0.1);                    // AK-S4-1: the gain reduction changes by less than 0.1 dB
    PRUEF(b0.arr.inserts().gr_db(0) >= 6.0f);           // and the stage reports it (the /e/ins_gr source)
    // negative control: a stage that is not switched on (row an = 0) changes nothing, bit for bit
    TR(aus)
    setze(aus, "ins/komp/1/schwelle", -30.0f);
    setze(aus, "ins/komp/1/ratio", 8.0f);
    spiele(aus, spur1(&sinus->a, true), 120000);
    PRUEF(gleich_bits(aus.pml, a0.pml, 93000, 117000));
    // the makeup reaches the stage (role order of the eff() index): +12 dB on the same chain lifts the output by 12 dB
    TR(mk)
    komp_ein(mk);
    setze(mk, "ins/komp/1/makeup", 12.0f);
    spiele(mk, spur1(&sinus->a, true), 120000);
    PRUEF_NAH(db(rms(mk.pml, 93000, 117000) / r_b0), 12.0, 0.2);
  }

  {  // 2 bypass_bitgleich (AK-S4-2): an = 0 equals the project without the insert bit for bit after the 480 sample blend; no step larger than the input's
    TR(x) TR(y) TR(z)
    spiele(x, spur1(&sinus->a, false), 140000);
    komp_ein(y);
    y.laden(spur1(&sinus->a, true));
    y.arr.start(0.0, 2, false, 0, V, 256, y.k);
    y.lauf(110000);
    PRUEF(rms(y.pml, 93000, 109000) < 0.8 * rms(x.pml, 93000, 109000));   // the stage works before the switch
    const int64_t s_aus = y.s;
    setze(y, "ins/komp/1/an", 0.0f);
    y.lauf(140000);
    const double eingang = groesster_schritt(x.pml, 93000, 139000);
    PRUEF(eingang > 0.01);
    PRUEF(gleich_bits(y.pml, x.pml, s_aus + 1024, 139000));              // fully off: bit-equal
    const double blende = groesster_schritt(y.pml, s_aus - 10, s_aus + 1024);
    std::printf("2: largest step in the blend %.6f, largest input step %.6f\n", blende, eingang);
    PRUEF(blende <= eingang + 1e-7);                                     // no step larger than the input's
    // switching on again blends in without a step as well
    setze(y, "ins/komp/1/an", 1.0f);
    const int64_t s_ein = y.s;
    y.lauf(y.s + 4096);
    PRUEF(groesster_schritt(y.pml, s_ein - 10, s_ein + 1024) <= eingang + 1e-7);
    // the project's own on flag of the stage (snapshot an = false) with the row on: not computed, bit-equal from the start
    komp_ein(z);
    spiele(z, spur1(&sinus->a, true, false), 140000);
    PRUEF(gleich_bits(z.pml, x.pml, 0, 139000));
  }

  {  // 3 pre_post (AK-S4-3): the return share of a pre return does not follow the track fader, a post return does; mute zeroes both
    auto lauf = [&](bool pre, float fader, bool mit_send, float mute, int64_t bis) {
      auto t = std::make_unique<Treiber>();
      cdj::ArrSnapshot* s = spur1(&konst->a, false);
      s->ret_da[0] = true;
      s->ret_pre[0] = pre;
      setze(*t, "ret/1/hall/an", 0.0f);   // the return passes dry
      setze(*t, "spur/1/send/1", mit_send ? 0.0f : -200.0f);
      setze(*t, "spur/1/fader", fader);
      setze(*t, "spur/1/mute", mute);
      spiele(*t, s, bis);
      return t;
    };
    const double ref = lauf(false, 0.0f, true, 0.0f, 100000)->pml[99000] - lauf(false, 0.0f, false, 0.0f, 100000)->pml[99000];
    PRUEF(ref > 0.1);   // post return at fader 0: the share is there (positive control)
    for (const bool pre : {true, false}) {
      const double d0 = lauf(pre, 0.0f, true, 0.0f, 100000)->pml[99000] - lauf(pre, 0.0f, false, 0.0f, 100000)->pml[99000];
      const double d_inf = lauf(pre, -200.0f, true, 0.0f, 100000)->pml[99000];   // the direct path is zero at -inf: all that is left is the return
      std::printf("3: %s share at fader 0 = %.6f, at fader -inf = %.6g\n", pre ? "pre" : "post", d0, d_inf);
      PRUEF_NAH(d0, pre ? 0.25 : ref, 1e-6);   // pre: the chain output without pan (0.25), post: after the pan law (-3 dB)
      if (pre) {
        PRUEF(d_inf > 0.1);
        PRUEF_NAH(db(d_inf / d0), 0.0, 0.01);   // within 0.01 dB
      } else {
        PRUEF(std::fabs(d_inf) < 1e-6);         // below -120 dBFS
      }
      const double stumm = lauf(pre, 0.0f, true, 1.0f, 102000)->pml[101500];   // muted: the share is gone after the 480 sample fade, in both
      PRUEF(std::fabs(stumm) < 1e-6);
    }
  }

  {  // 4 tausch_haelt_zustand (AK-S4-5): a swap that keeps strip, slot and kind keeps the envelope; a removed stage fades out within 480 samples
    TR(n) TR(w) TR(g) TR(x)
    for (Treiber* t : {&n, &w, &g}) komp_ein(*t);
    spiele(n, spur1(&sinus->a, true), 110000);
    spiele(w, spur1(&sinus->a, true), 110000);
    spiele(g, spur1(&sinus->a, true), 110000);
    spiele(x, spur1(&sinus->a, false), 140000);
    PRUEF(n.s == w.s && w.s == g.s);
    PRUEF(n.arr.inserts().gr_db(0) > 5.0f);   // an envelope is there to keep (positive control)
    const int64_t s_tausch = w.s;
    w.laden(spur1(&sinus->a, true, true, 2));    // same strip, slot and kind
    g.laden(spur1(&sinus->a, false, true, 2));   // the stage is gone
    n.lauf(n.s + 256);
    w.lauf(w.s + 256);
    g.lauf(g.s + 3072);
    const double d_gr = std::fabs(w.arr.inserts().gr_db(0) - n.arr.inserts().gr_db(0));
    std::printf("4: gain reduction %.4f dB without swap, %.4f dB with swap, difference %.5f dB\n", n.arr.inserts().gr_db(0), w.arr.inserts().gr_db(0), d_gr);
    PRUEF(d_gr <= 0.01);
    PRUEF(gleich_bits(w.pml, n.pml, s_tausch, s_tausch + 256));   // and the audio over the swap block is the same
    // the removed stage: within 480 samples (+ the block the swap waits for) the output is the unprocessed signal, without a step larger than the signal's own
    PRUEF(gleich_bits(g.pml, x.pml, s_tausch + 256 + 480, s_tausch + 3000));
    PRUEF(groesster_schritt(g.pml, s_tausch - 10, s_tausch + 1500) <= groesster_schritt(x.pml, 93000, 139000) + 1e-7);
    PRUEF(!g.arr.inserts().lief(0));   // and its state is cleared
  }

  {  // 5 nan_stufe (AK-S4-7): a NaN on one track's input: its chain output is silent for the block, the stage is cleared, the counter rises by one, the other strips are bit-equal
    // track 1: sine, silence, a NaN burst, silence. Run B has the same audio without the burst; track 2 is clean in both.
    auto roh = [&](bool mit_nan) {
      auto a = Audio::sinus(400000, 1000.0, 0.5f);
      for (int64_t f = 20000; f < 400000; ++f) a->d[2 * f] = a->d[2 * f + 1] = 0.0f;
      if (mit_nan)
        for (int64_t f = 40000; f < 40004; ++f) a->d[2 * f] = a->d[2 * f + 1] = std::nanf("");
      return a;
    };
    auto mit = roh(true), ohne = roh(false);
    auto zwei = [&](const cdj::ArrAudio* a1) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a1).kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &sinus->a).kette(2, {ArrStufe{ArrInsArt::komp, 1, true}});
      return b.fertig();
    };
    TR(a) TR(b)
    for (Treiber* t : {&a, &b}) {
      komp_ein(*t, 1);
      komp_ein(*t, 2);
    }
    spiele(a, zwei(&mit->a), 160000);
    spiele(b, zwei(&ohne->a), 160000);
    std::printf("5: nan counter with the burst = %llu, without = %llu\n", static_cast<unsigned long long>(a.arr.inserts().nan_zaehler()),
                static_cast<unsigned long long>(b.arr.inserts().nan_zaehler()));
    PRUEF(a.arr.inserts().nan_zaehler() == 1);
    PRUEF(b.arr.inserts().nan_zaehler() == 0);
    PRUEF(rms(b.pml, 93000, 100000) > 0.01);                  // track 2 plays (positive control)
    PRUEF(gleich_bits(a.pml, b.pml, 0, 159000));              // the other strip is untouched, and the burst track is silent where the burst was
    bool endlich = true;
    for (int64_t i = 0; i < 159000; ++i) endlich = endlich && std::isfinite(a.pml[i]);
    PRUEF(endlich);
    PRUEF(a.arr.inserts().gr_db(0) == 0.0f);                  // the stage of the burst track is cleared
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("6 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 6 keine_allokation (AK-S4-6): 2000 blocks with the 12 stages of the pool in use, two swaps, no allocation; positive control: construction counts
    TR(t)
    for (int k = 1; k <= cdj::ARR_INS_KOMP; ++k) komp_ein(t, k);
    setze(t, "ins/komp/1/sc", 2.0f);   // one stage takes the key of track 2: the key path (plan, copy, block_sc) is under the counting allocator too
    auto bau = [&](int64_t nr, int versatz) {
      Bau b(nr);
      for (int sp = 1; sp <= 8; ++sp) {
        const std::string id = "c" + std::to_string(sp);
        b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, &sinus->a);
        if (sp <= 2) b.ausgang(sp, 1);
        b.kette(sp, {ArrStufe{ArrInsArt::komp, static_cast<uint8_t>((sp - 1 + versatz) % 8), true}});
      }
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 8, true}, ArrStufe{ArrInsArt::komp, 9, true}, ArrStufe{ArrInsArt::komp, 10, true},
                          ArrStufe{ArrInsArt::komp, 11, true}});
      return b.fertig();
    };
    cdj::ArrSnapshot* s0 = bau(1, 0);
    cdj::ArrSnapshot* s1 = bau(2, 0);   // the same chains: state is kept
    cdj::ArrSnapshot* s2 = bau(3, 3);   // the track stages move to other slots: claims, tails
    t.laden(s0);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(100000);
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(8);
    float b[6][cdj::ARR_BLOCK];
    long im_fenster = 0;
    int64_t s = t.s;
    float gr_max = 0.0f;
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 700) alt.push_back(t.arr.tausche(s1, s, t.k));
      if (blk == 1300) alt.push_back(t.arr.tausche(s2, s, t.k));
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      s += 256;
      for (int k = 0; k < cdj::ARR_INS_KOMP; ++k) gr_max = std::max(gr_max, t.arr.inserts().gr_db(k));
    }
    im_fenster = abfang_aus();
    std::printf("6: allocations in 2000 blocks = %ld, largest gain reduction %.2f dB\n", im_fenster, gr_max);
    PRUEF(im_fenster == 0);
    for (int k = 0; k < cdj::ARR_INS_KOMP; ++k) PRUEF(t.arr.inserts().lief(k));   // all 12 pool stages ran in the last block, not just one
    PRUEF(gr_max > 3.0f);                       // the stages really ran (0 allocations of an empty run prove nothing)
    for (const cdj::ArrSnapshot* x : alt) delete x;
    abfang_an();
    { cdj::ArrInserts zweites; }
    const long bau_zaehlt = abfang_aus();
    std::printf("6: allocations while constructing a second pool = %ld\n", bau_zaehlt);
    PRUEF(bau_zaehlt > 0);                      // positive control: the watcher counts
  }
  {  // 7 loader: chain on a track and a group, pre on a return; refusals with a reason (kette_voll, unknown kind, slot out of range, slot twice)
    arrdatei::Ordner o("test_arr_inserts");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto spur = [&](const std::string& chain) {
      return "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}";
    };
    const std::string grp = "{\"nr\":2,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"komp\",\"slot\":5,\"an\":false}]}";
    const std::string ret = "{\"nr\":3,\"ausgang\":{\"art\":\"master\"},\"pre\":true}";
    o.wiedergabe2_ret(60, spur(",\"chain\":[{\"art\":\"komp\",\"slot\":3},{\"art\":\"komp\",\"slot\":1,\"an\":true}]"), grp, ret);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 60, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrKette& k = e.snap->kette[0];
      PRUEF(k.n == 2 && k.st[0].art == ArrInsArt::komp && k.st[0].slot == 2 && k.st[0].an && k.st[1].slot == 0);
      const cdj::ArrKette& g = e.snap->kette[cdj::ARR_SPUREN + 1];
      PRUEF(g.n == 1 && g.st[0].slot == 4 && !g.st[0].an);
      PRUEF(e.snap->ret_pre[2] && !e.snap->ret_pre[0] && e.snap->kette[1].n == 0);   // negative control: no chain, no pre where none was written
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    auto grund = [&](int64_t nr, const std::string& chain) {
      o.wiedergabe2_ret(nr, spur(chain), "{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    const std::string st = "{\"art\":\"komp\",\"slot\":";
    // a track chain in a cypherdj-arr/1 file is refused with a reason, the same file without chain loads (negative control)
    auto v1 = [&](int64_t nr, const std::string& chain) {
      o.wiedergabe(nr, "{\"nr\":1,\"art\":\"audio\"" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(v1(67, ",\"chain\":[" + st + "1}]") == "format");
    PRUEF(v1(68, "") == "+snap");
    PRUEF(grund(60, ",\"chain\":[" + st + "1}," + st + "2}," + st + "3}," + st + "4}," + st + "5}]") == "+snap");    // five stages are the end of a chain (ARR_KETTE 5)
    PRUEF(grund(61, ",\"chain\":[" + st + "1}," + st + "2}," + st + "3}," + st + "4}," + st + "5}," + st + "6}]") == "format");   // the 6th stage: kette_voll
    PRUEF(grund(62, ",\"chain\":[{\"art\":\"bk\",\"slot\":1}]") == "format");                                   // art_unbekannt: bk is slice 4d
    // slice 4b T12: eq and saett are stage kinds with pools of ARR_INS_EQ and ARR_INS_SAETT; the global slot numbering must not collide across kinds
    PRUEF(grund(69, ",\"chain\":[{\"art\":\"eq\",\"slot\":1}]") == "+snap");
    PRUEF(grund(70, ",\"chain\":[{\"art\":\"eq\",\"slot\":" + std::to_string(cdj::ARR_INS_EQ + 1) + "}]") == "format");     // one beyond the eq pool
    PRUEF(grund(71, ",\"chain\":[{\"art\":\"saett\",\"slot\":" + std::to_string(cdj::ARR_INS_SAETT + 1) + "}]") == "format");   // one beyond the saett pool
    PRUEF(grund(72, ",\"chain\":[{\"art\":\"eq\",\"slot\":1},{\"art\":\"eq\",\"slot\":1}]") == "format");                // the same eq slot twice
    PRUEF(grund(73, ",\"chain\":[{\"art\":\"eq\",\"slot\":1},{\"art\":\"saett\",\"slot\":1}," + st + "1}," + st + "12}]") == "+snap");   // one slot 1 of each kind: three kinds do not collide
    PRUEF(grund(74, ",\"chain\":[{\"art\":\"saett\",\"slot\":0}]") == "format");
    PRUEF(grund(63, ",\"chain\":[" + st + "13}]") == "format");
    PRUEF(grund(64, ",\"chain\":[" + st + "0}]") == "format");
    PRUEF(grund(65, ",\"chain\":[" + st + "2}," + st + "2}]") == "format");                                           // one slot, two stages
    PRUEF(grund(66, ",\"chain\":[" + st + "12}]") == "+snap");                                                           // the last slot is fine
  }
  {  // 8 gruppe_kette (spec D6, AK-S4-1, 3): the chain on a group acts over the sum of its members before the group fader, the pre tap of a group send is the chain
     // output without the group fader, a track's pre tap carries its chain output (compressed, not the raw input), mute zeroes both taps
    // one run: 2 tracks (sine) into group 1 or 1 track; the stage is slot 0 on the group (or the track); the return 1 passes dry
    auto lauf = [&](bool gruppe, bool kette, bool pre, float fader, bool mit_send, float mute, int64_t bis) {
      auto t = std::make_unique<Treiber>();
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a);
      if (gruppe) {
        b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &sinus->a);
        b.ausgang(1, 1).ausgang(2, 1);
        if (kette) b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      } else if (kette) {
        b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      }
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      s->ret_pre[0] = pre;
      if (kette) komp_ein(*t);
      setze(*t, "ret/1/hall/an", 0.0f);
      const std::string px = gruppe ? "grp/1/" : "spur/1/";
      setze(*t, (px + "send/1").c_str(), mit_send ? 0.0f : -200.0f);
      setze(*t, (px + "fader").c_str(), fader);
      setze(*t, (px + "mute").c_str(), mute);
      spiele(*t, s, bis);
      return t;
    };
    // the return share: the run with the send minus the run without, over the window (the direct path is identical in both)
    auto anteil = [&](bool gruppe, bool kette, bool pre, float fader) {
      auto m = lauf(gruppe, kette, pre, fader, true, 0.0f, 120000);
      auto o2 = lauf(gruppe, kette, pre, fader, false, 0.0f, 120000);
      std::vector<float> d(m->pml.size());
      for (size_t i = 0; i < d.size(); ++i) d[i] = m->pml[i] - o2->pml[i];
      return rms(d, 93000, 117000);
    };
    {  // (a, b) the group chain lowers the sum by at least 6 dB, and a group fader of -12 dB does not change the gain reduction
      auto ohne0 = lauf(true, false, false, 0.0f, false, 0.0f, 120000);
      auto mit0 = lauf(true, true, false, 0.0f, false, 0.0f, 120000);
      auto ohne12 = lauf(true, false, false, -12.0f, false, 0.0f, 120000);
      auto mit12 = lauf(true, true, false, -12.0f, false, 0.0f, 120000);
      const double gr0 = db(rms(ohne0->pml, 93000, 117000) / rms(mit0->pml, 93000, 117000));
      const double gr12 = db(rms(ohne12->pml, 93000, 117000) / rms(mit12->pml, 93000, 117000));
      std::printf("8: group chain GR at group fader 0 = %.3f dB, at -12 = %.3f dB\n", gr0, gr12);
      PRUEF(rms(ohne0->pml, 93000, 117000) > 0.1);   // the signal is there (positive control)
      PRUEF(gr0 >= 6.0);
      PRUEF_NAH(gr12 - gr0, 0.0, 0.1);
      PRUEF(mit0->arr.inserts().gr_db(0) >= 6.0f);
    }
    {  // (c) a pre return fed by the group send is unchanged at group fader -200 and carries the chain output; a post return goes to zero
      const double pre_ohne = anteil(true, false, true, 0.0f);
      const double pre0 = anteil(true, true, true, 0.0f);
      const double pre_inf = anteil(true, true, true, -200.0f);
      const double post0 = anteil(true, true, false, 0.0f);
      const double post_inf = anteil(true, true, false, -200.0f);
      std::printf("8: group send share, pre: raw %.5f, chain %.5f at fader 0, %.5f at -inf; post: %.5f at fader 0, %.3g at -inf\n", pre_ohne, pre0, pre_inf, post0, post_inf);
      PRUEF(pre0 > 0.01);   // positive control: the share is there
      PRUEF(db(pre_ohne / pre0) >= 6.0);        // the pre tap is the chain output, not the raw sum
      PRUEF_NAH(db(pre_inf / pre0), 0.0, 0.01);   // the group fader does not touch it
      PRUEF(post0 > 0.01);
      PRUEF(post_inf < 1e-6);                   // the post return follows the group fader
      // (d) group mute: the direct path and both taps are gone after the 480 sample fade
      for (const bool pre : {true, false}) {
        auto stumm = lauf(true, true, pre, 0.0f, true, 1.0f, 102000);
        PRUEF(std::fabs(stumm->pml[101500]) < 1e-6);
      }
    }
    {  // a track's pre tap carries its chain output: with the chain the pre share is at least 6 dB lower than without
      const double ohne = anteil(false, false, true, 0.0f);
      const double mit = anteil(false, true, true, 0.0f);
      std::printf("8: track pre share raw %.5f, with chain %.5f\n", ohne, mit);
      PRUEF(mit > 0.01);
      PRUEF(db(ohne / mit) >= 6.0);
    }
  }
  {  // 9 return_nach_hall (spec D5, AK-S4-4): the chain of a return sits after the Hall, before the return fader. Hall off: the dry return input is processed.
     // Hall on: the stage sees the wet signal. A sine burst of 15000 frames goes into the return; 6000 samples after its end the dry send is silent, but the
     // Hall tail still sounds, so a stage after the Hall still works (gain reduction > 0), a stage in front of the Hall has released. The return fader does not change the gain reduction.
    auto roh = [&]() {
      auto a = Audio::sinus(400000, 1000.0, 0.5f);
      for (int64_t f = 15000; f < 400000; ++f) a->d[2 * f] = a->d[2 * f + 1] = 0.0f;
      return a;
    };
    auto stoss = roh();
    // one run: track 1 sends 0 dB into return 1; the return share is the run with the send minus the run without it
    auto lauf = [&](const Audio* quelle, bool kette, bool hall, float rfader, bool mit_send, int64_t bis) {
      auto t = std::make_unique<Treiber>();
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &quelle->a);
      if (kette) b.ret_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      if (kette) {
        komp_ein(*t);
        setze(*t, "ins/komp/1/schwelle", -45.0f);
        setze(*t, "ins/komp/1/release", 20.0f);
      }
      setze(*t, "ret/1/hall/an", hall ? 1.0f : 0.0f);
      setze(*t, "ret/1/fader", rfader);
      setze(*t, "spur/1/send/1", mit_send ? 0.0f : -200.0f);
      spiele(*t, s, bis);
      return t;
    };
    auto anteil = [&](const Audio* quelle, bool kette, bool hall, float rfader, int64_t von, int64_t bis, int64_t lauf_bis, double* gr) {
      auto m = lauf(quelle, kette, hall, rfader, true, lauf_bis);
      auto o2 = lauf(quelle, kette, hall, rfader, false, lauf_bis);
      std::vector<float> d(m->pml.size());
      for (size_t i = 0; i < d.size(); ++i) d[i] = m->pml[i] - o2->pml[i];
      if (gr) *gr = m->arr.inserts().gr_db(0);
      return rms(d, von, bis);
    };
    // hall off, steady sine: the dry return input is processed
    double g_trocken = 0.0, g_trocken12 = 0.0, g_nass = 0.0, g_nass12 = 0.0, g_x = 0.0;
    const double t_ohne = anteil(sinus.get(), false, false, 0.0f, 93000, 117000, 120000, &g_x);
    const double t_mit = anteil(sinus.get(), true, false, 0.0f, 93000, 117000, 120000, &g_trocken);
    anteil(sinus.get(), true, false, -12.0f, 93000, 117000, 120000, &g_trocken12);
    // hall on, burst: the share in the window after the burst is the tail
    const double n_ohne = anteil(stoss.get(), false, true, 0.0f, 108000, 116000, 117000, &g_x);
    const double n_mit = anteil(stoss.get(), true, true, 0.0f, 108000, 116000, 117000, &g_nass);
    anteil(stoss.get(), true, true, -12.0f, 108000, 116000, 117000, &g_nass12);
    std::printf("9: hall off share raw %.5f, chain %.5f (GR %.2f dB), at return fader -12 GR %.2f dB; hall tail raw %.6f, chain %.6f (GR %.2f dB), at -12 GR %.2f dB\n",
                t_ohne, t_mit, g_trocken, g_trocken12, n_ohne, n_mit, g_nass, g_nass12);
    PRUEF(t_ohne > 0.1);                              // the dry share is there (positive control)
    PRUEF(db(t_ohne / t_mit) >= 6.0);                 // hall off: the dry return input is processed
    PRUEF(g_trocken >= 6.0);
    PRUEF_NAH(g_trocken12 - g_trocken, 0.0, 0.1);     // before the return fader
    PRUEF(n_ohne > 0.001);                            // the tail is there (positive control)
    PRUEF(g_nass > 1.0);                              // the stage works on the tail: the send is silent by now, so the stage sits after the Hall
    PRUEF_NAH(g_nass12 - g_nass, 0.0, 0.1);
    PRUEF(n_mit < n_ohne);                            // and the tail is lowered
    // negative control: a chain on the return whose row an is 0 leaves the return output bit-equal to the run without a chain, Hall on and off
    for (const bool hall : {false, true}) {
      auto mit = std::make_unique<Treiber>(), ohne = std::make_unique<Treiber>();
      for (Treiber* t : {mit.get(), ohne.get()}) {
        Bau b(1);
        b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &stoss->a);
        if (t == mit.get()) b.ret_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
        cdj::ArrSnapshot* sn = b.fertig();
        sn->ret_da[0] = true;
        setze(*t, "ret/1/hall/an", hall ? 1.0f : 0.0f);
        setze(*t, "spur/1/send/1", 0.0f);
        spiele(*t, sn, 117000);
      }
      PRUEF(rms(ohne->pml, 93000, 116000) > 0.01);
      PRUEF(gleich_bits(mit->pml, ohne->pml, 0, 116000));
    }
  }
  {  // 10 pm_vor_fader_im_export (spec D5, AK-S4-4): the PM chain acts on the sum before the PM fader; the export tap (pm_abgriff) carries it and follows the PM fader
    auto lauf = [&](bool kette, float fader) {
      auto t = std::make_unique<Treiber>();
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a);
      if (kette) b.pm_kette({ArrStufe{ArrInsArt::komp, 0, true}});
      if (kette) komp_ein(*t);
      setze(*t, "pm/fader", fader);
      spiele(*t, b.fertig(), 120000);
      return t;
    };
    auto ohne0 = lauf(false, 0.0f), mit0 = lauf(true, 0.0f), mit12 = lauf(true, -12.0f);
    const double r0 = rms(ohne0->pml, 93000, 117000), m0 = rms(mit0->pml, 93000, 117000), m12 = rms(mit12->pml, 93000, 117000);
    std::printf("10: PM tap raw %.5f, chain at fader 0 %.5f (GR %.2f dB), at fader -12 %.5f (GR %.2f dB)\n", r0, m0, mit0->arr.inserts().gr_db(0), m12,
                mit12->arr.inserts().gr_db(0));
    PRUEF(r0 > 0.1);                                                           // the signal is there (positive control)
    PRUEF(db(r0 / m0) >= 6.0);                                                 // the export tap carries the insert
    PRUEF_NAH(mit12->arr.inserts().gr_db(0) - mit0->arr.inserts().gr_db(0), 0.0, 0.1);   // the chain sits before the PM fader
    PRUEF_NAH(db(m0 / m12), 12.0, 0.1);                                        // and the tap level follows the PM fader
    // negative control: a chain that is switched off (row an = 0) leaves the tap as it was
    auto aus = std::make_unique<Treiber>();
    {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a).pm_kette({ArrStufe{ArrInsArt::komp, 0, true}});
      spiele(*aus, b.fertig(), 120000);
    }
    PRUEF(gleich_bits(aus->pml, ohne0->pml, 93000, 117000));
  }
  {  // 12 sidechain (T4, AK-S4-15, spec 2.3, D11): sc = n takes the input of track n BEFORE its own chain as the key; sc = 0 and a silent key track give no reduction
    // bass: a quiet 1 kHz sine on track 1 (-40 dBFS, under the threshold on its own); kick: 80 ms bursts of 60 Hz every 24000 samples on track 2 (muted, the key is taken before the mute)
    auto bass = Audio::sinus(400000, 1000.0, 0.01f);
    auto kick = [](float amp) {
      auto x = std::make_unique<Audio>();
      x->d.assign(400000 * 2, 0.0f);
      for (int64_t f = 0; f < 400000; ++f) {
        const double t = static_cast<double>(f % 24000) / 48000.0;
        if (t < 0.08) x->d[2 * f] = x->d[2 * f + 1] = amp * static_cast<float>(std::exp(-t / 0.03) * std::sin(2.0 * 3.14159265358979323846 * 60.0 * t));
      }
      x->fuellen(400000);
      return x;
    };
    // a run: the bass on track 1 with a chain (slot 0) or without, an optional kick track 2 (muted), optional chain on track 2 (slot 1: makeup +12 dB, no compression)
    auto lauf = [&](bool kette, int sc, const Audio* k, bool k_kette, float schwelle, float schp = 0.0f) {
      auto t = std::make_unique<Treiber>();
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
      if (kette) b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      if (k) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &k->a);
      if (k && k_kette) b.kette(2, {ArrStufe{ArrInsArt::komp, 1, true}});
      if (kette) {
        komp_ein(*t);
        setze(*t, "ins/komp/1/schwelle", schwelle);
        setze(*t, "ins/komp/1/knie", 0.0f);
        setze(*t, "ins/komp/1/attack", 1.0f);
        setze(*t, "ins/komp/1/release", 100.0f);
        setze(*t, "ins/komp/1/sc", static_cast<float>(sc));
        if (schp > 0.0f) setze(*t, "ins/komp/1/schp", schp);
      }
      if (k_kette) {
        komp_ein(*t, 2);
        setze(*t, "ins/komp/2/schwelle", 0.0f);
        setze(*t, "ins/komp/2/ratio", 1.0f);
        setze(*t, "ins/komp/2/makeup", 12.0f);
      }
      if (k) setze(*t, "spur/2/mute", 1.0f);
      spiele(*t, b.fertig(), 160000);
      return t;
    };
    // level of the bass in 480 sample windows over two kick periods (the muted kick track is silent in the sum): lowest and highest
    auto fenster = [&](const Treiber& t, double* tief, double* hoch) {
      *tief = 1e9;
      *hoch = 0.0;
      for (int64_t v = 96000; v + 480 <= 144000; v += 240) {
        const double r = rms(t.pml, v, v + 480);
        *tief = std::min(*tief, r);
        *hoch = std::max(*hoch, r);
      }
    };
    auto kicks = kick(0.5f);
    auto roh = lauf(false, 0, nullptr, false, -30.0f);
    double roh_tief = 0.0, roh_hoch = 0.0;
    fenster(*roh, &roh_tief, &roh_hoch);
    PRUEF(roh_tief > 0.002);                                // the bass is there (positive control)
    auto mit = lauf(true, 2, kicks.get(), false, -30.0f);
    auto eigen = lauf(true, 0, kicks.get(), false, -30.0f);
    double m_tief = 0.0, m_hoch = 0.0, e_tief = 0.0, e_hoch = 0.0;
    fenster(*mit, &m_tief, &m_hoch);
    fenster(*eigen, &e_tief, &e_hoch);
    std::printf("12: bass raw %.6f..%.6f; sc=2: lowest %.6f (%.2f dB down), highest %.6f (%.2f dB down); sc=0: lowest %.6f (%.2f dB down)\n", roh_tief, roh_hoch,
                m_tief, db(roh_tief / m_tief), m_hoch, db(roh_hoch / m_hoch), e_tief, db(roh_tief / e_tief));
    PRUEF(db(roh_tief / m_tief) >= 6.0);                    // AK-S4-15: at least 6 dB down inside a pulse
    PRUEF(db(roh_hoch / m_hoch) < 1.0);                     // and recovered between the pulses
    PRUEF(db(roh_tief / e_tief) < 0.5);                     // sc = 0: the same pulses on track 2 do not move the bass
    // sc = 0 with real compression (threshold under the bass): the kick track must not change a single bit of the output
    auto s0_ohne = lauf(true, 0, nullptr, false, -50.0f);
    auto s0_mit = lauf(true, 0, kicks.get(), false, -50.0f);
    PRUEF(s0_ohne->arr.inserts().gr_db(0) > 1.0f);          // the stage really compresses (positive control)
    PRUEF(gleich_bits(s0_ohne->pml, s0_mit->pml, 96000, 144000));
    // sc_stille_spur: key track empty (no track 2 in the snapshot): no reduction, nothing non-finite
    auto leer = lauf(true, 2, nullptr, false, -30.0f);
    double l_tief = 0.0, l_hoch = 0.0;
    fenster(*leer, &l_tief, &l_hoch);
    PRUEF(db(roh_tief / l_tief) < 0.5);
    PRUEF(leer->arr.inserts().nan_zaehler() == 0 && mit->arr.inserts().nan_zaehler() == 0);
    for (size_t i = 96000; i < 144000; ++i) PRUEF(std::isfinite(leer->pml[i]));
    // sc_vor_kette: track 2 carries a +12 dB makeup stage; the key is its input, not its output. Quiet kick (-26 dBFS) under a threshold of -20 dB: no reduction
    auto leise = kick(0.05f), laut = kick(0.4f);
    auto roh2 = lauf(false, 0, nullptr, false, -20.0f);
    double r2_tief = 0.0, r2_hoch = 0.0;
    fenster(*roh2, &r2_tief, &r2_hoch);
    auto vor = lauf(true, 2, leise.get(), true, -20.0f);
    auto pos = lauf(true, 2, laut.get(), false, -20.0f);   // positive control: a kick that really is that loud ducks
    double v_tief = 0.0, v_hoch = 0.0, p_tief = 0.0, p_hoch = 0.0;
    fenster(*vor, &v_tief, &v_hoch);
    fenster(*pos, &p_tief, &p_hoch);
    std::printf("12: sc_vor_kette: quiet kick through a +12 dB stage ducks %.2f dB, a loud kick without a stage %.2f dB\n", db(r2_tief / v_tief), db(r2_tief / p_tief));
    PRUEF(db(r2_tief / p_tief) >= 4.0);                     // the loud key ducks (positive control)
    PRUEF(db(r2_tief / v_tief) < 1.0);                      // the key is taken before track 2's own chain
    // sc_nan: a NaN burst on the KEY track (between two pulses) with the detector high-pass on (schp > 0) must not leave the detector dead: the next kicks duck again
    auto kick_nan = kick(0.5f);
    for (int64_t f = 10000; f < 10200; ++f) kick_nan->d[2 * f] = kick_nan->d[2 * f + 1] = std::numeric_limits<float>::quiet_NaN();
    auto sauber = lauf(true, 2, kicks.get(), false, -30.0f, 100.0f);
    auto nanlauf = lauf(true, 2, kick_nan.get(), false, -30.0f, 100.0f);
    double s_tief = 0.0, s_hoch = 0.0, n_tief = 0.0, n_hoch = 0.0;
    fenster(*sauber, &s_tief, &s_hoch);
    fenster(*nanlauf, &n_tief, &n_hoch);
    std::printf("12: sc_nan: schp 100, clean key ducks %.2f dB, after a NaN burst on the key track %.2f dB (nan count %llu)\n", db(roh_tief / s_tief), db(roh_tief / n_tief),
                static_cast<unsigned long long>(nanlauf->arr.inserts().nan_zaehler()));
    PRUEF(db(roh_tief / s_tief) >= 6.0);                    // positive control: the clean key ducks with schp on
    PRUEF(db(roh_tief / n_tief) >= 6.0);                    // the detector survived the NaN burst
    PRUEF(nanlauf->arr.inserts().nan_zaehler() > 0);        // and the burst really arrived and was counted
  }
  {  // 11 loader (T3): chain on a return and on the PM; refusals with a reason; the same file without them loads (negative control)
    arrdatei::Ordner o("test_arr_inserts_t3");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}";
    const std::string st = "{\"art\":\"komp\",\"slot\":";
    auto laden = [&](int64_t nr, const std::string& ret_kette, const std::string& pm, const char* format = "cypherdj-arr/2") {
      o.roh(nr, std::string("{\"format\":\"") + format + "\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + spur + "],\"gruppen\":[]," +
                    "\"returns\":[{\"nr\":2,\"ausgang\":{\"art\":\"master\"}" + ret_kette + "}]" + pm + "}");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      return x;
    };
    {
      cdj::ArrLadeErgebnis e = laden(70, ",\"chain\":[" + st + "4,\"an\":false}]", ",\"pm\":{\"chain\":[" + st + "7}," + st + "9}]}");
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrKette& r = e.snap->kette[cdj::ARR_KETTE_RET0 + 1];
        PRUEF(r.n == 1 && r.st[0].art == ArrInsArt::komp && r.st[0].slot == 3 && !r.st[0].an);
        const cdj::ArrKette& p = e.snap->kette[cdj::ARR_KETTE_PM];
        PRUEF(p.n == 2 && p.st[0].slot == 6 && p.st[1].slot == 8 && p.st[0].an);
        PRUEF(e.snap->kette[cdj::ARR_KETTE_RET0].n == 0 && e.snap->kette[0].n == 0);   // negative control: no chain where none was written
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    auto grund = [&](int64_t nr, const std::string& ret_kette, const std::string& pm, const char* format = "cypherdj-arr/2") {
      cdj::ArrLadeErgebnis x = laden(nr, ret_kette, pm, format);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(grund(71, "", "") == "+snap");                                                                       // neither: loads
    PRUEF(grund(72, ",\"chain\":[" + st + "2}]", ",\"pm\":{\"chain\":[" + st + "2}]}") == "format");         // one slot on two strips
    PRUEF(grund(73, "", ",\"pm\":{\"chain\":[" + st + "1}," + st + "2}," + st + "3}," + st + "4}," + st + "5}," + st + "6}]}") == "format");   // kette_voll on the PM
    PRUEF(grund(74, "", ",\"pm\":{\"chain\":[{\"art\":\"bk\",\"slot\":1}]}") == "format");                               // bk is slice 4d
    PRUEF(grund(78, "", ",\"pm\":{\"chain\":[{\"art\":\"eq\",\"slot\":1}]}") == "+snap");                                // slice 4b: eq on the PM
    PRUEF(grund(75, "", ",\"pm\":[]") == "format");
    PRUEF(grund(76, "", ",\"pm\":{\"chain\":[" + st + "1}]}", "cypherdj-arr/1") == "format");                 // a /1 file has no pm
    PRUEF(grund(77, "", ",\"pm\":{\"chain\":[" + st + "12}]}") == "+snap");                                    // the last slot is fine
  }
  {  // 13 pre_post_wechsel (review echtzeit-1): flipping the pre/post flag of a return through a swap blends over 480 samples, no step in the return input
    auto schnappschuss = [&](bool pre, int64_t nr) {
      Bau b(nr);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a);
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      s->ret_pre[0] = pre;
      return s;
    };
    for (const bool auf_pre : {true, false}) {
      TR(t)
      setze(t, "ret/1/hall/an", 0.0f);
      setze(t, "spur/1/send/1", 0.0f);
      setze(t, "spur/1/fader", -6.0f);
      spiele(t, schnappschuss(!auf_pre, 1), 110000);
      const int64_t s_tausch = t.s;
      t.laden(schnappschuss(auf_pre, 2));
      t.lauf(s_tausch + 3072);
      const double vorher = groesster_schritt(t.pml, 93000, s_tausch - 10);
      const double nachher = groesster_schritt(t.pml, s_tausch + 1500, s_tausch + 3000);
      const double um = groesster_schritt(t.pml, s_tausch - 10, s_tausch + 1500);
      std::printf("13: %s: largest step before the swap %.5f, after %.5f, around the swap %.5f\n", auf_pre ? "post -> pre" : "pre -> post", vorher, nachher, um);
      PRUEF(vorher > 0.01 && nachher > 0.01);                  // positive control: the signal is there and moves
      PRUEF(um <= std::max(vorher, nachher) * 1.1 + 0.002);    // no step larger than the signal's own in either state (plus the slope of the blend)
      // the end state is the new one: a run that starts on the new flag has the same return share
      TR(f)
      setze(f, "ret/1/hall/an", 0.0f);
      setze(f, "spur/1/send/1", 0.0f);
      setze(f, "spur/1/fader", -6.0f);
      spiele(f, schnappschuss(auf_pre, 1), s_tausch + 3072);
      PRUEF_NAH(f.pml[s_tausch + 3000], t.pml[s_tausch + 3000], 1e-5);
    }
  }

  {  // 14 nan_ganzer_block (review abnahme-1, AK-S4-7): the whole block of the strip is silent, also the samples BEFORE the burst in that block
    auto roh = [&](int64_t f0, bool mit_nan) {
      auto a = Audio::sinus(400000, 1000.0, 0.5f);
      for (int64_t f = f0 + 4; f < 400000; ++f) a->d[2 * f] = a->d[2 * f + 1] = 0.0f;
      if (mit_nan)
        for (int64_t f = f0; f < f0 + 4; ++f) a->d[2 * f] = a->d[2 * f + 1] = std::nanf("");
      return a;
    };
    auto spur_mit_kette = [&](const cdj::ArrAudio* a) { return spur1(a, true); };
    // find where audio frame 0 lands: first block of the clean run
    auto start_probe = roh(40000, false);
    TR(p)
    komp_ein(p);
    spiele(p, spur_mit_kette(&start_probe->a), 100000);
    const std::vector<int64_t> tr = p.treffer(0, 100000);
    PRUEF(!tr.empty());
    const int64_t s0 = tr.front();
    const int64_t f0 = 40000 + ((100 - (s0 + 40000) % 256) + 256) % 256;   // the burst sits 100 samples into a block
    auto sauber = roh(f0, false), mit = roh(f0, true);
    TR(a) TR(b)
    komp_ein(a);
    komp_ein(b);
    spiele(a, spur_mit_kette(&mit->a), 160000);
    spiele(b, spur_mit_kette(&sauber->a), 160000);
    const int64_t blk = ((s0 + f0) / 256) * 256;
    double spitze_a = 0.0, spitze_b = 0.0;
    for (int64_t i = blk; i < blk + 256; ++i) {
      spitze_a = std::max(spitze_a, static_cast<double>(std::fabs(a.pml[i])));
      spitze_b = std::max(spitze_b, static_cast<double>(std::fabs(b.pml[i])));
    }
    std::printf("14: block %lld: peak with the burst %.6g, peak without %.6g, nan counter %llu\n", static_cast<long long>(blk), spitze_a, spitze_b,
                static_cast<unsigned long long>(a.arr.inserts().nan_zaehler()));
    PRUEF(spitze_b > 0.01);                  // positive control: the same block carries signal without the burst
    PRUEF(spitze_a == 0.0);                  // with the burst the whole block is silent
    PRUEF(a.arr.inserts().nan_zaehler() == 1);
  }

  {  // 15 angezeigte_reduktion (review echtzeit-3): /e/ins_gr shows only what is applied: a group that lost its members and a stage with mix 0 report 0 dB
    auto gruppe = [&](bool mitglied) {
      Bau b(mitglied ? 1 : 2);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a);
      if (mitglied) b.ausgang(1, 1);
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      return b.fertig();
    };
    TR(g)
    komp_ein(g);
    spiele(g, gruppe(true), 110000);
    PRUEF(g.arr.inserts().lief(0) && g.arr.inserts().gr_db(0) > 5.0f);   // positive control: the group stage works
    g.laden(gruppe(false));
    g.lauf(g.s + 40 * 256);
    std::printf("15: group without member: lief %d, gr %.3f dB\n", g.arr.inserts().lief(0) ? 1 : 0, g.arr.inserts().gr_db(0));
    PRUEF(!g.arr.inserts().lief(0));
    PRUEF(g.arr.inserts().gr_db(0) == 0.0f);
    TR(m)
    komp_ein(m);
    spiele(m, spur1(&sinus->a, true), 110000);
    PRUEF(m.arr.inserts().gr_db(0) > 5.0f);
    setze(m, "ins/komp/1/mix", 0.0f);
    m.lauf(m.s + 40 * 256);
    std::printf("15: mix 0: gr %.3f dB\n", m.arr.inserts().gr_db(0));
    PRUEF(m.arr.inserts().gr_db(0) == 0.0f);
    setze(m, "ins/komp/1/mix", 1.0f);
    m.lauf(m.s + 40 * 256);
    PRUEF(m.arr.inserts().gr_db(0) > 5.0f);   // and it comes back
  }

  {  // 16 solo_stummt_pre (review abnahme-8b): the solo of another track silences the pre tap of a track like its mute does
    auto lauf = [&](float solo2, float send1) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &sinus->a);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &sinus->a);
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      s->ret_pre[0] = true;
      auto t = std::make_unique<Treiber>();
      setze(*t, "ret/1/hall/an", 0.0f);
      setze(*t, "spur/1/send/1", send1);
      setze(*t, "spur/2/solo", solo2);
      spiele(*t, s, 102000);
      return t;
    };
    const double ohne_solo = rms(lauf(0.0f, 0.0f)->pml, 101000, 101900) - rms(lauf(0.0f, -200.0f)->pml, 101000, 101900);
    const double mit_solo = rms(lauf(1.0f, 0.0f)->pml, 101000, 101900) - rms(lauf(1.0f, -200.0f)->pml, 101000, 101900);
    std::printf("16: pre share of track 1 without solo %.5f, with the solo of track 2 %.5f\n", ohne_solo, mit_solo);
    PRUEF(ohne_solo > 0.05);                 // positive control
    PRUEF(std::fabs(mit_solo) < 1e-5);
  }

  PRUEF_ENDE();
}
