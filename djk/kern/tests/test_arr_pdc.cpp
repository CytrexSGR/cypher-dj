// 1.10 slice 4b T13: latency compensation (PDC) of the arrangement mixer (spec 2.4, D9, D10; AK-S4-8, AK-S4-9).
// An impulse on one track (audio of the clip: 1.0 on frame 0), the path under test is chosen by which track holds the clip; the position of the largest sample at the
// PM tap is the arrival of that path. Latencies are read from the modules (cypher_*_latenz), never hard-coded.
// Cases: 1 pdc_vier_pfade (AK-S4-8: four paths with eq on a track, a plain track, a track through a group with saett and a track through a send and return, all four at the
// same sample, the position equals the project without stages plus the largest path latency; variants with the eq on the return, both stages in one chain, and on the PM),
// 2 pdc_bypass_haelt (AK-S4-9: row an = 0, project flag an = false and an = 1 of an eq stage give the same position),
// 3 pdc_keine_latenz (komp only chains: no ring in the table, none in the state; positive control: an eq makes rings),
// 4 pdc_gleiche_ketten (every strip has the same latency: no ring), 5 pdc_wechsel (the table changes at a swap and never inside a playback),
// 6 pdc_blocktreue (the PM tap is bit-equal for the block sizes 64 to 1024: the ring holds across blocks shorter than the delay),
// 7 pdc_metronom (the click is delayed by the largest path latency like the audio: R3), 8 pdc_vertrag (the latencies of docs/schnittstellen/insert_module.json, which the page reads, equal the modules'),
// 9 pdc_keine_allokation (the delay rings of every place and two swaps that change the table: 2000 blocks without an allocation; positive control: constructing the rings counts).
// Mutations (CMakeLists.txt): PDC_FEHLT_TABELLE (1), PDC_DOPPELT (1), PDC_NUR_BEI_AN (2), INS_BYPASS_OHNE_LATENZ (2), PDC_BLOCK_NEU (6), METRONOM_PDC_FEHLT (7).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <fstream>
#include <nlohmann/json.hpp>

#include "arr_bau.h"
#include "cypherdj/eq.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/saett.h"
#include "pruef.h"
#include "alloc_abfang.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }

// where the topology holds stages: eq on track 1, saett on group 1, eq on return 1, eq+saett on a track, eq on the PM
enum Form { A_EQ_SPUR_SAETT_GRUPPE, B_SAETT_GRUPPE_EQ_RETURN, C_EIN_STRANG_BEIDE, D_EQ_PM, OHNE_STUFEN };

static const ArrStufe EQ{ArrInsArt::eq, 0, true};
static const ArrStufe SA{ArrInsArt::saett, 0, true};

// 4 tracks: 1 plain or with stages, 2 plain, 3 in group 1, 4 sends to return 1 (pre, its own fader at -120 dB so that only the send is heard). Only track `wer` holds the clip.
static cdj::ArrSnapshot* bauen(Form f, int wer, const cdj::ArrAudio* a, int64_t nr = 1) {
  Bau b(nr);
  for (int i = 1; i <= 4; ++i) b.spur(i, ArrArt::audio);
  b.ausgang(3, 1);
  b.clip(wer, "c1", 0.0, 8.0, a);
  if (f == A_EQ_SPUR_SAETT_GRUPPE) { b.kette(1, {EQ}); b.gruppen_kette(1, {SA}); }
  if (f == B_SAETT_GRUPPE_EQ_RETURN) { b.gruppen_kette(1, {SA}); b.ret_kette(1, {EQ}); }
  if (f == C_EIN_STRANG_BEIDE) b.kette(1, {EQ, SA});
  if (f == D_EQ_PM) b.pm_kette({EQ});
  cdj::ArrSnapshot* s = b.fertig();
  s->ret_da[0] = true;
  s->ret_pre[0] = true;
  cdj::arr_pdc_rechnen(*s);
  return s;
}

static void bedienen(Treiber& t, int wer) {
  setze(t, "ret/1/hall/an", 0.0f);                    // the return passes dry
  setze(t, "ins/eq/1/an", 1.0f);                      // the stages run (flat EQ: only the latency; the saturator at 0 dB drive and 0 dB out)
  setze(t, "ins/saett/1/an", 1.0f);
  setze(t, "ins/saett/1/drive", 0.0f);
  setze(t, "ins/saett/1/out", 0.0f);
  setze(t, "ins/saett/1/mix", 1.0f);
  if (wer == 4) {
    setze(t, "spur/4/send/1", 0.0f);
    setze(t, "spur/4/fader", -120.0f);                // the direct path of track 4 is silent: the send alone is under test
  }
}

struct Lage {
  int64_t pos = -1;       // index of the largest |sample| at the PM tap
  double spitze = 0.0;
  int gesamt = 0;         // pdc.gesamt of the snapshot
  int ringe = 0;
};
static Lage lauf(Form f, int wer, int n = 256, int64_t bis = 140000) {
  auto au = Audio::impuls(400000);
  TR(t)
  t.n = n;
  bedienen(t, wer);
  cdj::ArrSnapshot* s = bauen(f, wer, &au->a);
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, n, t.k);
  t.lauf(bis);
  Lage l;
  for (int64_t i = 0; i < static_cast<int64_t>(t.pml.size()); ++i)
    if (std::fabs(t.pml[i]) > l.spitze) { l.spitze = std::fabs(t.pml[i]); l.pos = i; }
  l.gesamt = t.arr.snapshot()->pdc.gesamt;
  l.ringe = t.arr.snapshot()->pdc.ringe;
  return l;
}

int main() {
  const int L_EQ = cdj::EqNativ().latenz();
  const int L_SA = cdj::SaettNativ().latenz();
  std::printf("latencies from the modules: eq %d, saett %d\n", L_EQ, L_SA);
  PRUEF(L_EQ > 0 && L_SA > 0);   // positive control: the stages have a latency to compensate

  {  // 1 pdc_vier_pfade
    struct Fall { Form f; const char* name; int p_erwartet; };
    // The model is worst case (arr_pdc.h): a group chain with latency raises every track, a return chain adds on top of the group arrival.
    const Fall faelle[] = {{A_EQ_SPUR_SAETT_GRUPPE, "A eq track 1 + saett group", L_EQ + L_SA},
                           {B_SAETT_GRUPPE_EQ_RETURN, "B saett group + eq return", L_SA + L_EQ},
                           {C_EIN_STRANG_BEIDE, "C eq+saett on track 1", L_EQ + L_SA},
                           {D_EQ_PM, "D eq on the PM", L_EQ}};
    const Lage ref = lauf(OHNE_STUFEN, 1);
    std::printf("1: reference without stages: impulse at %lld (peak %.3f)\n", static_cast<long long>(ref.pos), ref.spitze);
    PRUEF(ref.spitze > 0.5);   // the impulse is there (positive control)
    PRUEF((ref.gesamt) == 0);
    for (int wer = 2; wer <= 4; ++wer) PRUEF((lauf(OHNE_STUFEN, wer).pos) == (ref.pos));   // the reference is the same for every track
    for (const Fall& fa : faelle) {
      int64_t p[5] = {};
      for (int wer = 1; wer <= 4; ++wer) {
        const Lage l = lauf(fa.f, wer);
        p[wer] = l.pos;
        PRUEF(l.spitze > 0.2);   // an impulse arrives on every path (the send path included)
        PRUEF((l.gesamt) == (fa.p_erwartet));
      }
      std::printf("1: %s: positions %lld %lld %lld %lld, expected %lld\n", fa.name, static_cast<long long>(p[1]), static_cast<long long>(p[2]),
                  static_cast<long long>(p[3]), static_cast<long long>(p[4]), static_cast<long long>(ref.pos + fa.p_erwartet));
      for (int wer = 1; wer <= 4; ++wer) {
        PRUEF((p[wer]) == (p[1]));                                  // AK-S4-8: difference 0 samples between the paths
        PRUEF((p[wer]) == (ref.pos + fa.p_erwartet));               // and the position is the reference plus the largest path latency
      }
    }
  }

  {  // 2 pdc_bypass_haelt (AK-S4-9): the stage switched off by its row, by the project flag, or on gives the same arrival
    auto au = Audio::impuls(400000);
    const Lage ref = lauf(OHNE_STUFEN, 1);
    int64_t p_an = -1;
    {
      const Lage l = lauf(A_EQ_SPUR_SAETT_GRUPPE, 1);
      p_an = l.pos;
    }
    for (int wer = 1; wer <= 2; ++wer) {
      TR(t)
      bedienen(t, wer);
      setze(t, "ins/eq/1/an", 0.0f);                // the row off (bands untouched)
      t.laden(bauen(A_EQ_SPUR_SAETT_GRUPPE, wer, &au->a));
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(140000);
      int64_t p = 0;
      double sp = 0.0;
      for (size_t i = 0; i < t.pml.size(); ++i)
        if (std::fabs(t.pml[i]) > sp) { sp = std::fabs(t.pml[i]); p = static_cast<int64_t>(i); }
      std::printf("2: row an = 0, clip on track %d: position %lld (stage on: %lld)\n", wer, static_cast<long long>(p), static_cast<long long>(p_an));
      PRUEF(sp > 0.2);
      PRUEF((p) == (p_an));
      PRUEF((p) == (ref.pos + L_EQ + L_SA));
    }
    for (int wer = 1; wer <= 2; ++wer) {  // the project flag an = false of the stage in the chain: the path of track 1 and the plain track 2 both keep the latency of the stage
      Bau b(1);
      for (int i = 1; i <= 2; ++i) b.spur(i, ArrArt::audio);
      b.clip(wer, "c1", 0.0, 8.0, &au->a);
      b.kette(1, {ArrStufe{ArrInsArt::eq, 0, false}});
      TR(t)
      bedienen(t, wer);
      t.laden(b.fertig());
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(140000);
      int64_t p = 0;
      double sp = 0.0;
      for (size_t i = 0; i < t.pml.size(); ++i)
        if (std::fabs(t.pml[i]) > sp) { sp = std::fabs(t.pml[i]); p = static_cast<int64_t>(i); }
      std::printf("2: project flag an = false, clip on track %d: position %lld\n", wer, static_cast<long long>(p));
      PRUEF((p) == (ref.pos + L_EQ));
    }
  }

  {  // 3 pdc_keine_latenz: komp-only chains and no chain: no ring in the table, none in the state; positive control: an eq makes rings
    auto au = Audio::sinus(400000, 440.0, 0.3f);
    TR(t)
    Bau b(1);
    for (int i = 1; i <= 3; ++i) b.spur(i, ArrArt::audio).clip(i, ("c" + std::to_string(i)).c_str(), 0.0, 8.0, &au->a);
    b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
    b.pm_kette({ArrStufe{ArrInsArt::komp, 1, true}});
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(120000);
    std::printf("3: komp-only: rings %d, largest path latency %d\n", t.arr.snapshot()->pdc.ringe, t.arr.snapshot()->pdc.gesamt);
    PRUEF((t.arr.snapshot()->pdc.ringe) == (0));
    PRUEF((t.arr.snapshot()->pdc.gesamt) == (0));
    int benutzt = 0;
    for (int k = 0; k < cdj::ARR_PDC_SCHLUESSEL; ++k) benutzt += t.arr.pdc_historie(k) != 0;
    PRUEF((benutzt) == (0));   // the state holds no ring either
    TR(u)
    Bau b2(1);
    for (int i = 1; i <= 3; ++i) b2.spur(i, ArrArt::audio).clip(i, ("c" + std::to_string(i)).c_str(), 0.0, 8.0, &au->a);
    b2.kette(1, {EQ});
    u.laden(b2.fertig());
    u.arr.start(0.0, 2, false, 0, V, 256, u.k);
    u.lauf(120000);
    int in_benutzung = 0;
    for (int k = 0; k < cdj::ARR_PDC_SCHLUESSEL; ++k) in_benutzung += u.arr.pdc_historie(k) != 0;
    std::printf("3: eq on track 1: rings %d, rings in use %d\n", u.arr.snapshot()->pdc.ringe, in_benutzung);
    PRUEF((u.arr.snapshot()->pdc.ringe) == (2));   // the two tracks without the eq
    PRUEF((in_benutzung) == (2));
  }

  {  // 4 pdc_gleiche_ketten: one track, the eq on it: every strip has the same latency, no ring at all
    auto au = Audio::sinus(400000, 440.0, 0.3f);
    TR(t)
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &au->a);
    b.kette(1, {EQ});
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(120000);
    std::printf("4: one track with an eq: rings %d, largest path latency %d\n", t.arr.snapshot()->pdc.ringe, t.arr.snapshot()->pdc.gesamt);
    PRUEF((t.arr.snapshot()->pdc.ringe) == (0));
    PRUEF((t.arr.snapshot()->pdc.gesamt) == (L_EQ));
  }

  {  // 5 pdc_wechsel: a swap that adds an eq on track 1 changes the table at the swap; between the swaps the table of the snapshot in force never changes
    auto au = Audio::sinus(400000, 440.0, 0.3f);
    TR(t)
    auto zwei = [&](bool mit, int64_t nr) {
      Bau b(nr);
      for (int i = 1; i <= 2; ++i) b.spur(i, ArrArt::audio).clip(i, ("c" + std::to_string(i)).c_str(), 0.0, 8.0, &au->a);
      if (mit) b.kette(1, {EQ});
      return b.fertig();
    };
    t.laden(zwei(false, 1));
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(100000);
    const cdj::ArrPdcTabelle vor = t.arr.snapshot()->pdc;
    PRUEF((vor.ringe) == (0));
    bool konstant = true;
    for (int blk = 0; blk < 100; ++blk) {
      t.lauf(t.s + 256);
      konstant = konstant && std::memcmp(&vor, &t.arr.snapshot()->pdc, sizeof vor) == 0;
    }
    PRUEF(konstant);
    t.laden(zwei(true, 2));
    const cdj::ArrPdcTabelle nach = t.arr.snapshot()->pdc;
    std::printf("5: swap: rings %d -> %d, largest path latency %d -> %d\n", vor.ringe, nach.ringe, vor.gesamt, nach.gesamt);
    PRUEF((nach.ringe) == (1));
    PRUEF((nach.d[cdj::PDC_SPUR0 + 1]) == (L_EQ));   // track 2 is delayed by the eq of track 1
    konstant = true;
    for (int blk = 0; blk < 100; ++blk) {
      t.lauf(t.s + 256);
      konstant = konstant && std::memcmp(&nach, &t.arr.snapshot()->pdc, sizeof nach) == 0;
    }
    PRUEF(konstant);
  }

  {  // 6 pdc_blocktreue: the PM tap is bit-equal for the block sizes 64 (shorter than the delay), 100, 128, 480 and 1024 (rings across blocks, the split of the delay)
    auto au = Audio::sinus(400000, 440.0, 0.3f);
    auto au2 = Audio::sinus(400000, 660.0, 0.2f);
    auto bau = [&]() {
      Bau b(1);
      for (int i = 1; i <= 4; ++i) b.spur(i, ArrArt::audio);
      b.ausgang(3, 1);
      b.clip(1, "c1", 0.0, 8.0, &au->a).clip(2, "c2", 0.0, 8.0, &au2->a).clip(3, "c3", 0.0, 8.0, &au->a).clip(4, "c4", 0.0, 8.0, &au2->a);
      b.kette(1, {EQ});
      b.gruppen_kette(1, {SA});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      cdj::arr_pdc_rechnen(*s);
      return s;
    };
    std::vector<float> ref;
    for (int n : {1024, 64, 100, 128, 480, 256}) {
      TR(t)
      t.n = n;
      bedienen(t, 1);
      setze(t, "spur/4/send/1", -6.0f);
      t.laden(bau());
      t.arr.start(0.0, 2, false, 0, V, n, t.k);
      t.lauf(140032);
      if (ref.empty()) { ref = t.pml; continue; }
      const int64_t von = 90000, bis = 139000;
      const bool gleich = std::memcmp(ref.data() + von, t.pml.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
      std::printf("6: block %d against block 1024: %s\n", n, gleich ? "bit-equal" : "DIFFERENT");
      PRUEF(gleich);
    }
    double e = 0.0;
    for (int64_t i = 90000; i < 139000; ++i) e += static_cast<double>(ref[i]) * ref[i];
    PRUEF(e > 1.0);   // the signal is there (positive control)
  }

  {  // 7 pdc_metronom (R3): the click sits outside the PM tap and is shifted by the largest path latency like the audio, in the master and the cue sum
    auto au = Audio::impuls(400000);
    auto klick_pos = [&](bool mit_eq, bool cue) {
      TR(t)
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &au->a);
      if (mit_eq) b.kette(1, {EQ});
      t.laden(b.fertig());
      t.arr.metronom(true, -6.0f, cue ? 1 : 0);
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(140000);
      const std::vector<float>& v = cue ? t.cl : t.ml;
      for (size_t i = 0; i < v.size(); ++i)
        if (std::fabs(v[i]) > 1e-4f) return static_cast<int64_t>(i);
      return int64_t{-1};
    };
    for (bool cue : {false, true}) {
      const int64_t ohne = klick_pos(false, cue), mit = klick_pos(true, cue);
      std::printf("7: first click sample %s: without stages %lld, with the eq %lld (expected %lld)\n", cue ? "cue" : "master", static_cast<long long>(ohne),
                  static_cast<long long>(mit), static_cast<long long>(ohne + L_EQ));
      PRUEF(ohne > 0);   // the click is there (positive control)
      PRUEF((mit) == (ohne + L_EQ));
    }
  }

  {  // 8 pdc_vertrag: the contract table that the page reads has the latency the modules report
    std::ifstream f(std::string(CYPHERDJ_DJK) + "/../docs/schnittstellen/insert_module.json");
    PRUEF(f.good());
    nlohmann::json j = nlohmann::json::parse(f, nullptr, false);
    PRUEF(!j.is_discarded());
    int eq = -1, sa = -1, ko = -1, li = -1;
    if (!j.is_discarded())
      for (const auto& a : j.at("arten")) {
        if (a.at("art") == "eq") eq = a.at("latenz").get<int>();
        if (a.at("art") == "saett") sa = a.at("latenz").get<int>();
        if (a.at("art") == "komp") ko = a.at("latenz").get<int>();
        if (a.at("art") == "lim") li = a.at("latenz").get<int>();   // master limiter plan: pinned against the KanalLimiter of ins_lim.h
      }
    std::printf("8: contract latencies: komp %d, eq %d, saett %d, lim %d (module %d)\n", ko, eq, sa, li, cdj::ins_lim_latenz());
    PRUEF((eq) == (L_EQ));
    PRUEF((sa) == (L_SA));
    PRUEF((ko) == (0));
    PRUEF((li) == (cdj::ins_lim_latenz()));
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("9 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 9 pdc_keine_allokation: rings on tracks, group, return and PM, two swaps that change the table, a send into the return
    auto au = Audio::sinus(400000, 220.0, 0.3f);
    TR(t)
    bedienen(t, 4);
    cdj::ArrSnapshot* s0 = bauen(A_EQ_SPUR_SAETT_GRUPPE, 4, &au->a, 1);
    cdj::ArrSnapshot* s1 = bauen(B_SAETT_GRUPPE_EQ_RETURN, 4, &au->a, 2);
    cdj::ArrSnapshot* s2 = bauen(A_EQ_SPUR_SAETT_GRUPPE, 4, &au->a, 3);   // back to the first table: the rings change d again
    PRUEF(s0->pdc.ringe > 0 && s1->pdc.ringe > 0 && s2->pdc.ringe > 0);   // all three tables really use rings
    t.laden(s0);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(100000);
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(8);
    float b[6][cdj::ARR_BLOCK];
    int64_t pos = t.s;
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 600) alt.push_back(t.arr.tausche(s1, pos, t.k));
      if (blk == 1200) alt.push_back(t.arr.tausche(s2, pos, t.k));
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, pos, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      pos += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("9: allocations in 2000 blocks = %ld\n", im_fenster);
    PRUEF((im_fenster) == (0L));
    abfang_an();
    { auto zweite = std::make_unique<cdj::ArrPdc>(); }
    const long bau_zaehlt = abfang_aus();
    std::printf("9: allocations while constructing the rings = %ld\n", bau_zaehlt);
    PRUEF(bau_zaehlt > 0);   // positive control: the counter sees allocations
    for (const cdj::ArrSnapshot* a : alt) delete a;
  }

  PRUEF_ENDE();
}
