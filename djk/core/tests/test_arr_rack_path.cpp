// Mehrkern slice 3, task 6b: a rack track with all its member slots is ONE lane unit (ArrRackSenke::block_bahn, parallel_faehig), and with it the Kit sink
// (ArrKitSenke::block_bahn, parallel_faehig: Kit TRACKS become lane units too, a side effect of the rack work).
// Sink level (one unit at a time, no pool):
//   1 rack_bahn_bitgleich:    8 racks (3 RB-338 + 1 Kit as arr32rack), 2000 blocks, one unit at a time through ArrRackSenke::block_bahn on lanes 0..3 in
//                             rotation: bit-equal to block() for every rack, also over a parameter and gain swap in the middle; every lane counted rack units
//   2 rack_zwei_faeden:       two real threads run two racks at once on lanes 1 and 2 (a barrier per block), 5 runs: bit-equal to the serial run of each
//                             rack, and the Kit counters equal the serial ones. The real proof against shared rack and Kit scratch.
//   3 rack_parallel_faehig:   table: clean rack true; Surge member, bk member, no members, empty track, out of range false; a device change of a member false
//                             until its block ran; a stale record, an event for a slot of another rack (record already freed), a stale Surge record and a track
//                             that left false, AND a clean neighbour rack false while the dirt lasts (the cleanliness is global), true again after the blocks
//   4 kit_bahn_bitgleich:     8 Kit tracks with dense notes (steals, cut fading voices, lost events), block_bahn on lanes in rotation: bit-equal to block(),
//                             counters equal
//   5 kit_zwei_faeden:        two threads, two Kit tracks, lanes 1 and 2, 5 runs: bit-equal, einsaetze / abgeschnitten / verloren equal to serial
//   6 kit_parallel_faehig:    Kit track and Kit member slot true, RB track false, empty slot false
// Arrangement level (the real phase Q on the Hall pool, 3 workers, SpurHaken: every worker must compute a unit first):
//   7 rack_pool_umzug:        8 racks + 12 plain RB tracks; a swap removes a member of rack 0 (every later member slot moves) with note offs pending: every bus and
//                             the master equal the serial arrangement (racks through block() behind a sink that is not lane-capable) in every block; the racks sit
//                             in the rest right after the swap (dirt) and in the lane lists again one block later; racks computed on every worker lane. Also
//                             with a whole rack track removed (the blocks with a fading sink run serial). The device-type transition and the fade block of a
//                             leaving track both make the racks dirty here by other means, so this case does NOT prove the cleanliness scan: case 11 does.
//   8 rack_pool_festgefahren: 6 clean racks and one rack with a Surge member (never lane-capable) that loses a member with a record: the clean racks are back in the
//                             lane lists one block later (the cleanliness scan runs after the join, once every rest rack ran: not after each rest track)
//   9 rack_modus_aus:         mode 0 (serial, the units through block_bahn on lane 0): equal to the serial arrangement; no worker unit
//  10 kit_rack_pool:          racks of Kit members only and Kit tracks on the pool: equal, scheduler units per worker lane > 0 (ArrArbeit::einheiten counts the RB only)
//  11 rack_pool_umzug_rb:    8 racks of RB members only, 12 plain RB tracks; rack 0 loses its first member (the member slots after it move down), note offs
//                             pending, no device change, no track leaves (no fade block). Equal to serial; the racks are in the rest right after the swap and back in
//                             the lane lists one block later. (With main's abgaenge() the queued events of the old owners are dropped, so this swap no longer leaves
//                             a hazard for a lane: it stays as the reviewer's RB-only scenario.)
//  12 rack_verlaesst_mit_vorhalt: a rack track stops being a rack (0: becomes a plain RB track, 1: removed, 2: a rack of internal members removed while another
//                             rack holds the Surge member) while the rack sink has a lead (Surge member: the internal members' events wait up to `vorhalt` samples
//                             in the queue of the track); 3 is the control without a lead. The queue of the leaving track is cleared at its fade block, so the
//                             racks are back in the lane lists after ONE serial block (asserted: one block after the swap and from vorhalt / M + 2 blocks on).
//  13 rack_abgaenge_vor_der_bahn: a clean swap (gains change) with the racks in lane units: abgaenge() of the new snapshot is due, so no rack is lane-capable right after
//                             the swap; ArrRackSenke::vor_phase runs it on the caller before the units and rebuilds the plan: the racks are in the lane lists and
//                             compute on the workers in the swap block itself. The TSan gate of SPUR_RACK_ABGANG_IN_BAHN runs this case alone.
//  14 rack_zweiter_umzug_gibt_slot_weiter: the one case that needs the cleanliness scan (sauber_): a leaver's queued note off outlives its record (nobody owned its slot,
//                             so abgaenge() kept the queue), a second swap hands the slot to another rack. Until the event is delivered no rack is in a lane list;
//                             equal to serial; afterwards all nine are. The TSan gate of SPUR_RACK_OHNE_SAUBER runs this case alone (race in ArrRbSenke::note).
//  15 glied_makros_bahn (1.9 U8 T9): 8 rack tracks with 4 member macro targets each (RB-338 cutoff and resonance, member gains incl. a kit) on the Hall pool lanes, macro rows moving every block,
//                             two swaps (the second drops a member: its targets are ignored), pool against the serial reference bit for bit; control: the same run without targets differs. TSan: the hook writes on the caller only.
// With an argument (a case number) the program runs that case only.
// Mutations (WILL_FAIL): SPUR_RACK_SCRATCH_GEMEINSAM (the rack lane unit renders into the sink's own scratch) must turn case 2 red; SPUR_KIT_PUF_GEMEINSAM (the Kit
// uses its own mix buffer) cases 2, 5; SPUR_RACK_OHNE_SAUBER (the cleanliness scan says true) cases 3 and 14; SPUR_RACK_REST_EINZELN (the plan check after each rest
// track, as before) cases 7, 8; SPUR_RACK_WEG_QUEUE_BLEIBT (the queue of a leaving track is not cleared) case 12; SPUR_RACK_ABGANG_IN_BAHN (no vor_phase, abgaenge() runs
// lazily inside the first rack unit, no pending check) cases 3 and 13.
// TSan gates (a mutation only the race detector sees, run in the TSan build): SPUR_RACK_SAUBER_IM_REST (the cleanliness scan runs in the serial remainder while
// the workers run the racks), SPUR_RACK_ZAEHLER_PLAIN (the Kit and rack counters are plain integers), SPUR_RACK_OHNE_SAUBER on case 14 (a stale queued note off of one
// rack reaches the RB slot of another rack: a race in ArrRbSenke::note), SPUR_RACK_ABGANG_IN_BAHN on case 13 (abgaenge() on a worker: a race in block_ on the seen generation).
#include <algorithm>
#include <atomic>
#include <barrier>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_rack_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/reverb_pool.h"
#include "cypherdj/kit.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int M = 256;

// ---- the Kit: every key a sound of its own (a decaying sine, the pitch follows the key), long enough to span several blocks -----------------------
std::unique_ptr<cdj::Kit> kit_bau(const char* name, int64_t frames) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = name;
  k->n = cdj::KIT_NOTEN;
  for (int i = 0; i < cdj::KIT_NOTEN; ++i) {
    k->klang[i].name = "t:" + std::to_string(i);
    k->klang[i].frames = frames;
    k->klang[i].daten.resize(static_cast<size_t>(frames) * 2);
    for (int64_t f = 0; f < frames; ++f) {
      const float e = std::exp(-static_cast<float>(f) / 900.0f);
      const float w = std::sin(0.01f * static_cast<float>(i + 3) * static_cast<float>(f));
      k->klang[i].daten[2 * f] = 0.5f * e * w;
      k->klang[i].daten[2 * f + 1] = 0.4f * e * w * (1.0f + 0.01f * static_cast<float>(i));
    }
  }
  return k;
}

void geraet_kit(cdj::ArrSpur& sp, const cdj::Kit* k) {
  std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
  std::snprintf(sp.kit, sizeof sp.kit, "%s", k->name.c_str());
  sp.kit_ptr = k;
  sp.kit_gen = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(k));
}
void geraet_rb(cdj::ArrSpur& sp, float cutoff, float resonanz, float decay) {
  std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
  sp.n_param = 0;
  auto p = [&](const char* name, float w) {
    std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
    sp.param[sp.n_param++].wert = w;
  };
  p("cutoff", cutoff);
  p("resonanz", resonanz);
  p("decay", decay);
}

// ---- snapshots: racks and plain tracks -----------------------------------------------------------------------------------------------------
enum MArt { RB, KIT, BK, SURGE };
struct Mem {
  MArt art;
  int lo, hi;           // key zone
  double gain_db = 0.0;
  float cutoff = 0.4f;
};
struct RackDef {
  int track;            // 0-based track index
  std::vector<Mem> m;
};
// the four members of an arr32rack track (cost lane): three RB-338 on 36..47, 48..59, 60..71 and a Kit on 0..1
RackDef rack4(int track) {
  return {track, {{RB, 36, 47, 0.0, 0.4f}, {RB, 48, 59, -3.0, 0.5f}, {RB, 60, 71, -6.0, 0.6f}, {KIT, 0, 1, 0.0, 0.0f}}};
}

// racks (member slots in the order of the list), plain RB tracks and plain Kit tracks; variante changes the RB parameters and the gains (a swap that keeps the slots)
cdj::ArrSnapshot* snap_bau(int64_t nr, const std::vector<RackDef>& racks, const std::vector<int>& rb_tracks, const std::vector<int>& kit_tracks, const cdj::Kit* kit,
                           int variante) {
  Bau b(nr);
  for (const RackDef& r : racks) b.spur(r.track + 1, ArrArt::rack);
  for (int t : rb_tracks) b.spur(t + 1, ArrArt::intern);
  for (int t : kit_tracks) b.spur(t + 1, ArrArt::intern);
  cdj::ArrSnapshot* s = b.fertig();
  int n_platz = 0;
  for (const RackDef& r : racks) {
    cdj::ArrSpur& sp = s->spur[r.track];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
    sp.kette = 0;
    sp.n_glieder = static_cast<int>(r.m.size());
    for (size_t i = 0; i < r.m.size(); ++i) {
      const Mem& g = r.m[i];
      cdj::ArrGlied& gd = sp.glied[i];
      gd.id = cdj::arr_id(std::string("m") + std::to_string(r.track) + "_" + std::to_string(i));
      gd.platz = cdj::ARR_SPUREN + n_platz++;
      gd.ton_lo = static_cast<uint8_t>(g.lo);
      gd.ton_hi = static_cast<uint8_t>(g.hi);
      gd.gain = static_cast<float>(std::pow(10.0, (g.gain_db - 1.5 * variante) / 20.0));
      cdj::ArrSpur& dev = s->glied_spur[gd.platz - cdj::ARR_SPUREN];
      dev.nr = gd.platz + 1;
      if (g.art == SURGE) {
        dev.art = ArrArt::wirt;
        dev.slot = 1;
        gd.art = ArrArt::wirt;
        gd.slot = 1;
        ++s->rack_wirt;
      } else {
        dev.art = ArrArt::intern;
        gd.art = ArrArt::intern;
        if (g.art == KIT) geraet_kit(dev, kit);
        else if (g.art == BK) std::snprintf(dev.geraet, sizeof dev.geraet, "bk");   // no handle: the sink never plays it, the predicate must still say no
        else geraet_rb(dev, g.cutoff + 0.03f * static_cast<float>(variante), 0.2f, 0.3f);
      }
    }
  }
  for (int t : rb_tracks) geraet_rb(s->spur[t], 0.15f + 0.05f * static_cast<float>(t % 7) + 0.03f * static_cast<float>(variante), 0.2f + 0.05f * static_cast<float>(t % 4), 0.3f);
  for (int t : kit_tracks) geraet_kit(s->spur[t], kit);
  return s;
}

// ---- the notes: deterministic, different per track; a note on per block in a key zone of the rack (36..47, 48..59, 60..71, kit 0..1, Surge 72..83) ----------
uint8_t ton_von(int spur, int b, int k) {
  switch (k % 5) {
    case 0: return static_cast<uint8_t>(36 + (b * 5 + spur) % 12);
    case 1: return static_cast<uint8_t>(48 + (b * 3 + spur * 2) % 12);
    case 2: return static_cast<uint8_t>(60 + (b + spur) % 12);
    case 3: return static_cast<uint8_t>((b + spur) % 2);
    default: return static_cast<uint8_t>(72 + (b + spur) % 12);
  }
}
void speise_rack(cdj::ArrSenke& s, int spur, int b, int64_t s0, int zonen = 4) {
  if (b == 0) s.transport_start(spur, s0);
  const int k = b % zonen;
  s.note(spur, s0 + (b * 7 + spur * 13) % M, ton_von(spur, b, k), static_cast<uint8_t>(90 + spur), true);
  s.note(spur, s0 + (b * 11 + spur * 5) % M, ton_von(spur, b, (k + 2) % zonen), 100, true);
  if (b >= 3) {   // the note offs of three blocks ago
    const int k0 = (b - 3) % zonen;
    s.note(spur, s0 + (b * 3 + spur) % M, ton_von(spur, b - 3, k0), 0, false);
    s.note(spur, s0 + (b * 5 + spur * 3) % M, ton_von(spur, b - 3, (k0 + 2) % zonen), 0, false);
  }
}
// dense Kit notes: n note ons per block on four keys; every 50th block 300 (over ARR_KIT_WARTE: lost events)
void speise_kit(cdj::ArrSenke& s, int spur, int b, int64_t s0) {
  if (b == 0) s.transport_start(spur, s0);
  const int n = b % 50 == 49 ? 300 : (b % 3 == 0 ? 40 : 5);
  for (int i = 0; i < n; ++i) s.note(spur, s0 + (i * 7 + b + spur) % M, static_cast<uint8_t>((i + spur) % 4), static_cast<uint8_t>(60 + i % 60), true);
}

bool gleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}
double energie(const std::vector<float>& l) {
  double e = 0.0;
  for (float x : l) e += static_cast<double>(x) * x;
  return e;
}

// ---- the sink world (heap: the Arrangement and the sinks are large) ------------------------------------------------------------------------
struct Welt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrKitSenke kit{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, &kit};
  PruefSenke surge{0};
  cdj::ArrRackSenke rack{t.arr, &intern, &surge, nullptr};
  Welt() {
    t.arr.setze_senke_intern(&intern);
    t.arr.setze_senke_rack(&rack);
    t.arr.setze_senke_wirt(1, &surge);
  }
  void laden(cdj::ArrSnapshot* s, int64_t s0) {
    t.s = s0;
    t.laden(s);
  }
  void blocke(int spur, int64_t s0) {   // one rack block on lane 0 with the serial entry, output dropped (a state change)
    float l[M] = {}, r[M] = {};
    rack.block(spur, s0, M, l, r);
  }
};

std::vector<RackDef> acht_racks() {
  std::vector<RackDef> v;
  for (int i = 0; i < 8; ++i) v.push_back(rack4(i));
  return v;
}

// 1: serial (block) against block_bahn on rotating lanes
void fall1(const cdj::Kit* kit) {
  constexpr int N = 8, BL = 2000;
  auto a = std::make_unique<Welt>();
  auto b = std::make_unique<Welt>();
  a->laden(snap_bau(1, acht_racks(), {}, {}, kit, 0), 0);
  b->laden(snap_bau(1, acht_racks(), {}, {}, kit, 0), 0);
  auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
  for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
  std::vector<float> oa[N], ob[N];
  bool alle_gleich = true;
  for (int blk = 0; blk < BL; ++blk) {
    const int64_t s0 = static_cast<int64_t>(blk) * M;
    if (blk == 1000) {   // a swap in the middle that keeps the slots (parameters, gains), the same in both
      a->laden(snap_bau(2, acht_racks(), {}, {}, kit, 1), s0);
      b->laden(snap_bau(2, acht_racks(), {}, {}, kit, 1), s0);
    }
    for (int i = 0; i < N; ++i) {
      speise_rack(a->rack, i, blk, s0);
      speise_rack(b->rack, i, blk, s0);
      float la[M] = {}, ra[M] = {}, lb[M] = {}, rb[M] = {};
      a->rack.block(i, s0, M, la, ra);
      b->rack.block_bahn(i, s0, M, lb, rb, lanes[(blk + i) % 4]);
      alle_gleich = alle_gleich && std::memcmp(la, lb, sizeof la) == 0 && std::memcmp(ra, rb, sizeof ra) == 0;
      oa[i].insert(oa[i].end(), la, la + M);
      ob[i].insert(ob[i].end(), lb, lb + M);
    }
  }
  PRUEF(alle_gleich);
  for (int i = 0; i < N; ++i) {
    PRUEF(gleich(oa[i], ob[i]));
    PRUEF(energie(oa[i]) > 1e-3);   // not vacuous
    if (i > 0) PRUEF(!gleich(oa[i], oa[i - 1]));
  }
  uint32_t summe = 0;
  for (int i = 0; i < 4; ++i) {
    PRUEF(lanes[i].rack_einheiten > 0);   // every lane computed rack units
    summe += lanes[i].rack_einheiten;
  }
  PRUEF(summe == static_cast<uint32_t>(N * BL));
  PRUEF(a->kit.einsaetze() > 0 && a->kit.einsaetze() == b->kit.einsaetze());   // the Kit members sounded, and counted alike
  std::printf("case 1 rack_bahn_bitgleich: %d racks x %d blocks, rack units on lanes 0..3 %u/%u/%u/%u, kit voices %llu\n", N, BL, lanes[0].rack_einheiten,
              lanes[1].rack_einheiten, lanes[2].rack_einheiten, lanes[3].rack_einheiten, static_cast<unsigned long long>(b->kit.einsaetze()));
}

// 2: two threads, two racks, lanes 1 and 2
void fall2(const cdj::Kit* kit) {
  constexpr int BL = 2000, WIEDER = 5;
  const int spur[2] = {1, 4};
  std::vector<float> ref[2];
  uint64_t ref_einsaetze = 0;
  {
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, acht_racks(), {}, {}, kit, 0), 0);
    for (int blk = 0; blk < BL; ++blk)
      for (int k = 0; k < 2; ++k) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_rack(w->rack, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        w->rack.block(spur[k], s0, M, l, r);
        ref[k].insert(ref[k].end(), l, l + M);
      }
    ref_einsaetze = w->kit.einsaetze();
  }
  PRUEF(energie(ref[0]) > 1e-3 && energie(ref[1]) > 1e-3 && !gleich(ref[0], ref[1]));
  PRUEF(ref_einsaetze > 0);
  int rot = 0;
  for (int w_nr = 0; w_nr < WIEDER; ++w_nr) {
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, acht_racks(), {}, {}, kit, 0), 0);
    auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
    for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
    std::vector<float> aus[2];
    std::barrier bar(2);
    auto lauf = [&](int k) {
      for (int blk = 0; blk < BL; ++blk) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_rack(w->rack, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        bar.arrive_and_wait();   // both start the unit together
        w->rack.block_bahn(spur[k], s0, M, l, r, lanes[1 + k]);
        aus[k].insert(aus[k].end(), l, l + M);
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    t0.join();
    t1.join();
    for (int k = 0; k < 2; ++k) PRUEF(gleich(aus[k], ref[k]));
    PRUEF(lanes[1].rack_einheiten == BL && lanes[2].rack_einheiten == BL && lanes[0].rack_einheiten == 0);
    PRUEF(w->kit.einsaetze() == ref_einsaetze);   // the Kit counter after two threads equals the serial sum
    PRUEF(w->rack.verloren() == 0 && w->kit.verloren() == 0);
    rot += lanes[1].rack_einheiten + lanes[2].rack_einheiten;
  }
  std::printf("case 2 rack_zwei_faeden: %d runs x %d blocks, %d rack units on lanes 1 and 2, kit voices %llu\n", WIEDER, BL, rot, static_cast<unsigned long long>(ref_einsaetze));
}

// 3: parallel_faehig
void fall3(const cdj::Kit* kit) {
  auto neu = [&](const std::vector<RackDef>& r) {
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, r, {}, {}, kit, 0), 0);
    w->rack.vor_phase(0);   // what the Arrangement does on the caller at the start of phase Q (abgaenge of the new snapshot); until then no rack is lane-capable
    return w;
  };
  const RackDef zwei_a = {0, {{RB, 36, 47}, {KIT, 0, 1}}};
  const RackDef zwei_b = {1, {{RB, 36, 47}, {KIT, 0, 1}}};
  {  // a new snapshot whose abgaenge() has not run: no rack is lane-capable (a lane unit must never be the one that runs it), after vor_phase both are
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, {zwei_a, zwei_b}, {}, {}, kit, 0), 0);
    PRUEF(!w->rack.parallel_faehig(0) && !w->rack.parallel_faehig(1));
    PRUEF(w->rack.vor_phase(0));
    PRUEF(w->rack.parallel_faehig(0) && w->rack.parallel_faehig(1));
    PRUEF(!w->rack.vor_phase(0));   // once per generation
  }
  {  // clean
    auto w = neu({zwei_a, zwei_b});
    PRUEF(w->rack.parallel_faehig(0));
    PRUEF(w->rack.parallel_faehig(1));
    PRUEF(!w->rack.parallel_faehig(2));    // an empty track
    PRUEF(!w->rack.parallel_faehig(-1));
    PRUEF(!w->rack.parallel_faehig(cdj::ARR_SPUREN));
  }
  {  // Surge member, bk member, no members: the rack stays serial, its clean neighbour does not
    auto w = neu({{0, {{RB, 36, 47}, {SURGE, 72, 83}}}, {1, {{RB, 36, 47}, {BK, 60, 71}}}, {2, {}}, {3, {{KIT, 0, 1}}}});
    PRUEF(!w->rack.parallel_faehig(0));
    PRUEF(!w->rack.parallel_faehig(1));
    PRUEF(!w->rack.parallel_faehig(2));
    PRUEF(w->rack.parallel_faehig(3));
  }
  {  // a device change of a member: false until the member's block ran, then true again
    auto w = neu({zwei_a, zwei_b});
    for (int b = 0; b < 4; ++b)
      for (int i = 0; i < 2; ++i) {
        speise_rack(w->rack, i, b, static_cast<int64_t>(b) * M);
        w->blocke(i, static_cast<int64_t>(b) * M);
      }
    PRUEF(w->rack.parallel_faehig(0));
    const RackDef um_a = {0, {{KIT, 36, 47}, {KIT, 0, 1}}};   // member 0 changes from the RB-338 to a Kit, the slot stays
    w->laden(snap_bau(2, {um_a, zwei_b}, {}, {}, kit, 0), 4 * M);
    PRUEF(!w->rack.parallel_faehig(0));   // zuletzt_ of the slot is the RB sink, the snapshot gives the Kit sink
    w->blocke(0, 4 * M);
    PRUEF(w->rack.parallel_faehig(0));
    PRUEF(w->rack.parallel_faehig(1));
  }
  {  // a stale record: a member left, its record is still there: this rack AND the clean neighbour are not capable; after the block both are
    auto w = neu({zwei_a, zwei_b});
    for (int b = 0; b < 4; ++b)
      for (int i = 0; i < 2; ++i) {
        speise_rack(w->rack, i, b, static_cast<int64_t>(b) * M);
        w->blocke(i, static_cast<int64_t>(b) * M);
      }
    PRUEF(w->rack.parallel_faehig(0) && w->rack.parallel_faehig(1));
    w->laden(snap_bau(2, {{0, {{RB, 36, 47}}}, zwei_b}, {}, {}, kit, 0), 4 * M);   // rack 0 loses the Kit member; rack 1 moves one slot down
    PRUEF(!w->rack.parallel_faehig(0));
    PRUEF(!w->rack.parallel_faehig(1));   // the dirt of rack 0 makes the neighbour not capable: its slot numbers moved
    w->blocke(0, 4 * M);
    PRUEF(!w->rack.parallel_faehig(0));   // rack 0 is clean, but rack 1 still holds records of its old slot numbers: the dirt is global
    PRUEF(!w->rack.parallel_faehig(1));
    w->blocke(1, 4 * M);
    PRUEF(w->rack.parallel_faehig(0));
    PRUEF(w->rack.parallel_faehig(1));
  }
  {  // a queued event for a member slot nobody owns after the swap: the record is freed by the fade block, only the queue is dirty until the event is delivered.
     // (An event of an old owner of a slot that another member took over is dropped by abgaenge() now, it leaves no dirt.)
    auto w = neu({{0, {{KIT, 0, 1}}}, {1, {{KIT, 0, 1}, {KIT, 2, 3}}}});   // rack 0: slot 32; rack 1: slots 33, 34
    w->rack.transport_start(1, 0);
    w->rack.note(1, 3 * M + 10, 2, 100, true);   // key 2: member 1 of rack 1 (slot 34), the event waits for block 3
    w->blocke(1, 0);
    PRUEF(w->rack.parallel_faehig(0) && w->rack.parallel_faehig(1));   // its member is current: clean
    w->laden(snap_bau(2, {{0, {{KIT, 0, 1}}}, {1, {{KIT, 0, 1}}}}, {}, {}, kit, 0), M);   // rack 1 loses member 1: slot 34 belongs to nobody
    w->rack.vor_phase(M);
    w->blocke(1, M);   // the fade block frees the record of the left member; the event (target in block 3) stays
    PRUEF(!w->rack.parallel_faehig(0));
    PRUEF(!w->rack.parallel_faehig(1));
    w->blocke(1, 2 * M);
    PRUEF(!w->rack.parallel_faehig(0));   // still queued
    w->blocke(1, 3 * M);                  // the block that holds the target: delivered, the queue is empty
    PRUEF(w->rack.parallel_faehig(0));
    PRUEF(w->rack.parallel_faehig(1));
  }
  {  // the event of an OLD owner of a slot another member took over: abgaenge() drops it, nothing stale stays behind (the member that took the slot over is clean at once)
    auto w = neu({{0, {{KIT, 0, 1}, {KIT, 2, 3}}}, {1, {{KIT, 0, 3}}}});   // rack 0: slots 32, 33; rack 1: slot 34
    w->rack.transport_start(0, 0);
    w->rack.note(0, 3 * M + 10, 2, 100, true);   // key 2: member 1 (slot 33), the event waits for block 3
    w->blocke(0, 0);
    w->laden(snap_bau(2, {{0, {{KIT, 0, 1}}}, {1, {{KIT, 0, 3}}}}, {}, {}, kit, 0), M);   // rack 0 loses member 1; slot 33 is now rack 1's member
    PRUEF(w->rack.vor_phase(M));
    PRUEF(w->rack.parallel_faehig(0) && w->rack.parallel_faehig(1));
  }
  {  // a stale Surge record: the Wirt sink is a serial thing, the rack is not capable until its block freed the record
    auto w = neu({{0, {{KIT, 0, 1}, {SURGE, 72, 83}}}, zwei_b});
    w->rack.transport_start(0, 0);
    w->rack.note(0, 10, 75, 100, true);   // creates the record of the Surge member
    w->laden(snap_bau(2, {{0, {{KIT, 0, 1}}}, zwei_b}, {}, {}, kit, 0), M);
    PRUEF(!w->rack.parallel_faehig(0));
    w->blocke(0, M);
    PRUEF(w->rack.parallel_faehig(0));
  }
  {  // a track that left the sink: the next block fades its members
    auto w = neu({zwei_a, zwei_b});
    w->rack.transport_start(0, 0);
    w->rack.note(0, 10, 40, 100, true);
    w->blocke(0, 0);
    PRUEF(w->rack.parallel_faehig(0));
    PRUEF(w->rack.spur_weg(0, M, false));
    PRUEF(!w->rack.parallel_faehig(0));
    w->blocke(0, M);
    PRUEF(w->rack.parallel_faehig(0));
  }
  std::printf("case 3 rack_parallel_faehig: table done\n");
}

// 4: Kit tracks, serial against block_bahn on rotating lanes
void fall4(const cdj::Kit* kit) {
  constexpr int N = 8, BL = 400;
  std::vector<int> kt;
  for (int i = 0; i < N; ++i) kt.push_back(i);
  auto a = std::make_unique<Welt>();
  auto b = std::make_unique<Welt>();
  a->laden(snap_bau(1, {}, {}, kt, kit, 0), 0);
  b->laden(snap_bau(1, {}, {}, kt, kit, 0), 0);
  auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
  for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
  std::vector<float> oa[N], ob[N];
  for (int blk = 0; blk < BL; ++blk) {
    const int64_t s0 = static_cast<int64_t>(blk) * M;
    for (int i = 0; i < N; ++i) {
      speise_kit(a->intern, i, blk, s0);
      speise_kit(b->intern, i, blk, s0);
      float la[M] = {}, ra[M] = {}, lb[M] = {}, rb[M] = {};
      a->intern.block(i, s0, M, la, ra);
      b->intern.block_bahn(i, s0, M, lb, rb, lanes[(blk + i) % 4]);
      PRUEF(std::memcmp(la, lb, sizeof la) == 0 && std::memcmp(ra, rb, sizeof ra) == 0);
      oa[i].insert(oa[i].end(), la, la + M);
      ob[i].insert(ob[i].end(), lb, lb + M);
    }
  }
  for (int i = 0; i < N; ++i) {
    PRUEF(gleich(oa[i], ob[i]));
    PRUEF(energie(oa[i]) > 1e-3);
  }
  PRUEF(a->kit.einsaetze() == b->kit.einsaetze() && a->kit.abgeschnitten() == b->kit.abgeschnitten() && a->kit.verloren() == b->kit.verloren());
  PRUEF(a->kit.abgeschnitten() > 0 && a->kit.verloren() > 0);   // the dense notes did cut fading voices and lose events: the counters mean something
  std::printf("case 4 kit_bahn_bitgleich: %d kit tracks x %d blocks, einsaetze %llu abgeschnitten %llu verloren %llu\n", N, BL,
              static_cast<unsigned long long>(b->kit.einsaetze()), static_cast<unsigned long long>(b->kit.abgeschnitten()), static_cast<unsigned long long>(b->kit.verloren()));
}

// 5: two threads, two Kit tracks
void fall5(const cdj::Kit* kit) {
  constexpr int BL = 400, WIEDER = 5;
  const int spur[2] = {1, 4};
  const std::vector<int> kt = {0, 1, 2, 3, 4, 5, 6, 7};
  std::vector<float> ref[2];
  uint64_t r_e = 0, r_a = 0, r_v = 0;
  {
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, {}, {}, kt, kit, 0), 0);
    for (int blk = 0; blk < BL; ++blk)
      for (int k = 0; k < 2; ++k) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_kit(w->intern, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        w->intern.block(spur[k], s0, M, l, r);
        ref[k].insert(ref[k].end(), l, l + M);
      }
    r_e = w->kit.einsaetze();
    r_a = w->kit.abgeschnitten();
    r_v = w->kit.verloren();
  }
  PRUEF(energie(ref[0]) > 1e-3 && energie(ref[1]) > 1e-3 && r_a > 0 && r_v > 0);
  for (int w_nr = 0; w_nr < WIEDER; ++w_nr) {
    auto w = std::make_unique<Welt>();
    w->laden(snap_bau(1, {}, {}, kt, kit, 0), 0);
    auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
    for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
    std::vector<float> aus[2];
    std::barrier bar(2);
    auto lauf = [&](int k) {
      for (int blk = 0; blk < BL; ++blk) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_kit(w->intern, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        bar.arrive_and_wait();
        w->intern.block_bahn(spur[k], s0, M, l, r, lanes[1 + k]);
        aus[k].insert(aus[k].end(), l, l + M);
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    t0.join();
    t1.join();
    for (int k = 0; k < 2; ++k) PRUEF(gleich(aus[k], ref[k]));
    PRUEF(w->kit.einsaetze() == r_e && w->kit.abgeschnitten() == r_a && w->kit.verloren() == r_v);   // atomic counters: the sum of two threads equals the serial one
  }
  std::printf("case 5 kit_zwei_faeden: %d runs x %d blocks, einsaetze %llu abgeschnitten %llu verloren %llu equal to serial\n", WIEDER, BL, static_cast<unsigned long long>(r_e),
              static_cast<unsigned long long>(r_a), static_cast<unsigned long long>(r_v));
}

// 6: Kit parallel_faehig
void fall6(const cdj::Kit* kit) {
  auto w = std::make_unique<Welt>();
  w->laden(snap_bau(1, {{3, {{KIT, 0, 1}, {RB, 36, 47}}}}, {1}, {0}, kit, 0), 0);   // track 0 Kit, track 1 RB-338, track 3 a rack: member slots 32 (Kit), 33 (RB)
  PRUEF(w->kit.parallel_faehig(0));       // a Kit track
  PRUEF(w->intern.parallel_faehig(0));
  PRUEF(!w->kit.parallel_faehig(1));      // an RB-338 track
  PRUEF(w->intern.parallel_faehig(1));    // (the dispatcher asks the RB sink)
  PRUEF(!w->kit.parallel_faehig(2));      // empty
  PRUEF(w->kit.parallel_faehig(cdj::ARR_SPUREN));       // member slot 32: a Kit member
  PRUEF(!w->kit.parallel_faehig(cdj::ARR_SPUREN + 1));  // member slot 33: an RB-338 member
  PRUEF(!w->kit.parallel_faehig(cdj::ARR_SPUREN + 5));  // a member slot nobody holds
  PRUEF(!w->kit.parallel_faehig(-1));
  PRUEF(!w->kit.parallel_faehig(cdj::ARR_SENKEN_PLAETZE));
  std::printf("case 6 kit_parallel_faehig: table done\n");
}

// ---- the arrangement level --------------------------------------------------------------------------------------------------------------
// A stand-in for the rack sink that is not lane-capable: the arrangement runs it in the serial remainder through block() (the reference path of the rack)
struct SeriellRack : cdj::ArrSenke {
  cdj::ArrRackSenke& r;
  explicit SeriellRack(cdj::ArrRackSenke& x) : r(x) {}
  int64_t vorhalt() const noexcept override { return r.vorhalt(); }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override { r.note(spur, ziel, ton, vel, an); }
  void alle_aus(int spur, int64_t ziel) noexcept override { r.alle_aus(spur, ziel); }
  void transport_start(int spur, int64_t ziel) noexcept override { r.transport_start(spur, ziel); }
  void block(int spur, int64_t s0, int m, float* l, float* rr) noexcept override { r.block(spur, s0, m, l, rr); }
  bool spur_weg(int spur, int64_t s, bool andere) noexcept override { return r.spur_weg(spur, s, andere); }
  void glied_parameter(int spur, int glied, int param, float wert) noexcept override { r.glied_parameter(spur, glied, param, wert); }
};

struct AWelt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrKitSenke kit{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, &kit};
  PruefSenke surge{0};
  cdj::ArrRackSenke rack{t.arr, &intern, &surge, nullptr};
  SeriellRack seriell{rack};
  float out[6][cdj::ARR_BLOCK] = {};
  explicit AWelt(bool als_referenz) {
    t.arr.setze_senke_intern(&intern);
    t.arr.setze_senke_rack(als_referenz ? static_cast<cdj::ArrSenke*>(&seriell) : static_cast<cdj::ArrSenke*>(&rack));
    t.arr.setze_senke_wirt(1, &surge);
  }
  void laden(cdj::ArrSnapshot* s, int64_t s0) {
    t.s = s0;
    t.laden(s);
  }
  void block(int64_t s0) {
    for (auto& x : out) std::fill(x, x + cdj::ARR_BLOCK, 0.0f);
    surge.block_s0 = s0;
    t.arr.block(t.k, s0, M, out[0], out[1], out[2], out[3], out[4], out[5]);
  }
};

struct PoolW {
  cdj::HallPool p;
  static cdj::HallPoolEinstellung einst(int faeden) {
    cdj::HallPoolEinstellung e;
    e.faeden = faeden;
    e.frist_us = 1000000;   // no late event from SCHED_OTHER wake jitter
    e.bloecke_us = 5333;
    return e;
  }
  explicit PoolW(int faeden) : p(einst(faeden)) { p.setze_fifo_test(true); }
};

// the time gates run on the real clock: a SCHED_OTHER worker that loses the CPU must not switch the phase off in the middle of a test about something else
cdj::SpurTest kein_tor() {
  cdj::SpurTest t;
  t.min_last = 0;
  t.grenze_ns = 10'000'000'000LL;
  t.warte_spaet_ns = 10'000'000'000LL;
  return t;
}

bool bit_gleich(const float* a, const float* b, int n) { return std::memcmp(a, b, sizeof(float) * static_cast<size_t>(n)) == 0; }
int vergleiche(const AWelt& a, const AWelt& ref) {   // every track bus and the master out, bit for bit; the number of differing buffers
  int ungleich = 0;
  for (int i = 0; i < cdj::ARR_SPUREN; ++i)
    if (!bit_gleich(a.t.arr.spur_bus_l(i), ref.t.arr.spur_bus_l(i), M) || !bit_gleich(a.t.arr.spur_bus_r(i), ref.t.arr.spur_bus_r(i), M)) ++ungleich;
  for (int o = 0; o < 6; ++o)
    if (!bit_gleich(a.out[o], ref.out[o], M)) ++ungleich;
  return ungleich;
}
int racks_in_bahnen(const AWelt& w, const std::vector<int>& rack_spuren) {   // rack tracks in the lane lists of the plan in force
  int n = 0;
  const cdj::ArrSpurPlan& p = w.t.arr.spur_plan();
  for (int b = 0; b < p.bahnen(); ++b)
    for (int k = 0; k < p.n(b); ++k)
      for (int r : rack_spuren) n += p.spur(b, k) == r ? 1 : 0;
  return n;
}

std::vector<int> plain_rb(int von, int n) {
  std::vector<int> v;
  for (int i = 0; i < n; ++i) v.push_back(von + i);
  return v;
}

// 7: the swap that renumbers member slots (a member of rack 0 leaves, or the whole rack track), note offs pending
void fall7(const cdj::Kit* kit, bool ganzer_track) {
  constexpr int BL = 90, SW = 40;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(8, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 8; ++i) rack_spuren.push_back(i);
  auto s1 = [&] { return snap_bau(1, acht_racks(), plain, {}, kit, 0); };
  auto s2 = [&] {
    std::vector<RackDef> r = acht_racks();
    if (ganzer_track) r.erase(r.begin());
    else r[0].m.erase(r[0].m.begin());   // rack 0 loses its first RB member: every member slot after it moves down by one
    return snap_bau(2, r, plain, {}, kit, 0);
  };
  a->laden(s1(), 0);
  ref->laden(s1(), 0);
  int ungleich = 0, racks_nach_tausch = -1, racks_zwei_spaeter = -1;
  double e = 0.0;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      a->laden(s2(), s0);
      ref->laden(s2(), s0);
      racks_nach_tausch = racks_in_bahnen(*a, rack_spuren);
    }
    for (int i = 0; i < 8 + 12; ++i) {
      if (i < 8) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else {
        speise_rack(a->intern, i, b, s0, 1);   // plain RB track: zone 0 only
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    if (b == SW - 1)   // notes on now, their note offs wait in the queues across the swap (target in the next block): the stale events of slot_umzug
      for (int i = 0; i < 8; ++i)
        for (int k = 0; k < 4; ++k) {
          const uint8_t ton = ton_von(i, 1000, k);
          for (cdj::ArrSenke* s : {static_cast<cdj::ArrSenke*>(&a->rack), static_cast<cdj::ArrSenke*>(&ref->rack)}) {
            s->note(i, s0 + 10 + k, ton, 100, true);
            s->note(i, s0 + M + 50 + k, ton, 0, false);
          }
        }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    for (int i = 0; i < 8; ++i) e += energie(std::vector<float>(a->t.arr.spur_bus_l(i), a->t.arr.spur_bus_l(i) + M));
    if (b == SW + 1) racks_zwei_spaeter = racks_in_bahnen(*a, rack_spuren);
    if (b == 1) {   // every worker computed a unit by now (the seam forces it): else stop, the rest would wait out the seam cap in every block
      bool alle = true;
      for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
      if (!alle) {
        PRUEF(alle);
        break;
      }
    }
  }
  const int erwartet = ganzer_track ? 7 : 8;
  PRUEF(ungleich == 0);
  PRUEF(e > 1e-3);
  PRUEF(racks_nach_tausch == 0);                   // the dirt of the swap: not one rack in a lane list right after it
  PRUEF(racks_zwei_spaeter == erwartet);           // and every rack in a lane list again after ONE serial block (not a block later: the scan runs after the rest)
  for (int l = 1; l < 4; ++l) PRUEF(a->t.arr.spur_arbeit(l).rack_einheiten >= 1);   // racks computed on every worker lane
  PRUEF(a->t.arr.spur_lauf().z.unfertig == 0);
  PRUEF(pool.p.an(cdj::HallPool::SPUR));
  std::printf("case 7 rack_pool_umzug%s: ungleich=%d racks in lanes after the swap %d, one block later %d, rack units on workers %u/%u/%u (caller %u)\n",
              ganzer_track ? " (track removed)" : "", ungleich, racks_nach_tausch, racks_zwei_spaeter, a->t.arr.spur_arbeit(1).rack_einheiten, a->t.arr.spur_arbeit(2).rack_einheiten,
              a->t.arr.spur_arbeit(3).rack_einheiten, a->t.arr.spur_arbeit(0).rack_einheiten);
}

// 8: the rack that is never lane-capable (Surge member) loses a member that has a record: the clean racks return to the lane lists
void fall8(const cdj::Kit* kit) {
  constexpr int BL = 60, SW = 30;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(7, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 6; ++i) rack_spuren.push_back(i);
  auto racks = [&](bool mit) {
    std::vector<RackDef> v;
    for (int i = 0; i < 6; ++i) v.push_back(rack4(i));
    // the Surge rack (the last rack): after the swap without its last member. Nobody owns that member slot afterwards, so abgaenge() keeps the record and the dirt lasts
    // until the fade block of this rack, which comes after the six clean racks and is never a lane unit itself (a per-track check in the remainder cannot see it go)
    RackDef b = {6, {{SURGE, 72, 83}, {RB, 36, 47}, {RB, 48, 59}}};
    if (!mit) b.m.pop_back();
    v.push_back(b);
    return v;
  };
  a->laden(snap_bau(1, racks(true), plain, {}, kit, 0), 0);
  ref->laden(snap_bau(1, racks(true), plain, {}, kit, 0), 0);
  int ungleich = 0, racks_nach_tausch = -1, racks_zwei_spaeter = -1;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      a->laden(snap_bau(2, racks(false), plain, {}, kit, 0), s0);
      ref->laden(snap_bau(2, racks(false), plain, {}, kit, 0), s0);
      racks_nach_tausch = racks_in_bahnen(*a, rack_spuren);
    }
    for (int i = 0; i < 7 + 12; ++i) {
      if (i < 7) {
        const int zonen = i == 6 ? 5 : 4;   // the Surge rack also gets notes in its Surge zone and in the zone of the member that leaves
        speise_rack(a->rack, i, b, s0, zonen);
        speise_rack(ref->rack, i, b, s0, zonen);
      } else {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    if (b == SW - 1) {   // a record on the member that leaves (the zone 48..59 of the Surge rack)
      a->rack.note(6, s0 + 20, 50, 100, true);
      ref->rack.note(6, s0 + 20, 50, 100, true);
    }
    a->block(s0);
    ref->block(s0);
    a->surge.impulse.clear();   // the Surge stand-in sounds an impulse per note on: keep the vectors short (equal in both worlds)
    ref->surge.impulse.clear();
    ungleich += vergleiche(*a, *ref);
    if (b == SW + 1) racks_zwei_spaeter = racks_in_bahnen(*a, rack_spuren);
    if (b == 1) {
      bool alle = true;
      for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
      if (!alle) {
        PRUEF(alle);
        break;
      }
    }
  }
  PRUEF(ungleich == 0);
  PRUEF(racks_nach_tausch == 0);
  PRUEF(racks_zwei_spaeter == 6);   // the six clean racks are back in the lane lists after one serial block (a per-track check in the remainder needs one more); the Surge rack stays in the remainder for good
  PRUEF(!a->rack.parallel_faehig(6));
  std::printf("case 8 rack_pool_festgefahren: ungleich=%d racks in lanes after the swap %d, one block later %d\n", ungleich, racks_nach_tausch, racks_zwei_spaeter);
}

// 9: mode 0: the units run serial through block_bahn on lane 0 (the rack in a lane list, the same path as the pool without workers)
void fall9(const cdj::Kit* kit) {
  constexpr int BL = 60, SW = 30;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(0);
  a->t.arr.setze_spur_test(kein_tor());
  const std::vector<int> plain = plain_rb(8, 4);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 8; ++i) rack_spuren.push_back(i);
  a->laden(snap_bau(1, acht_racks(), plain, {}, kit, 0), 0);
  ref->laden(snap_bau(1, acht_racks(), plain, {}, kit, 0), 0);
  int ungleich = 0;
  double e = 0.0;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      std::vector<RackDef> r = acht_racks();
      r[2].m.pop_back();
      a->laden(snap_bau(2, r, plain, {}, kit, 1), s0);
      ref->laden(snap_bau(2, r, plain, {}, kit, 1), s0);
    }
    for (int i = 0; i < 12; ++i) {
      if (i < 8) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    for (int i = 0; i < 8; ++i) e += energie(std::vector<float>(a->t.arr.spur_bus_l(i), a->t.arr.spur_bus_l(i) + M));
  }
  PRUEF(ungleich == 0);
  PRUEF(e > 1e-3);
  PRUEF(a->t.arr.spur_lauf().einheiten_worker() == 0 && a->t.arr.spur_lauf().z.blocks_parallel == 0);
  PRUEF(a->t.arr.spur_arbeit(0).rack_einheiten > 0);   // the racks went through block_bahn on lane 0
  PRUEF(a->t.arr.spur_arbeit(1).rack_einheiten == 0);
  std::printf("case 9 rack_modus_aus: ungleich=%d rack units on lane 0: %u\n", ungleich, a->t.arr.spur_arbeit(0).rack_einheiten);
}

// 10: racks of Kit members only and Kit tracks: the units are counted by the scheduler (ArrArbeit::einheiten counts the RB sink only)
void fall10(const cdj::Kit* kit) {
  constexpr int BL = 200;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  std::vector<RackDef> racks;
  for (int i = 0; i < 8; ++i) racks.push_back({i, {{KIT, 0, 1}, {KIT, 2, 3}}});
  const std::vector<int> kt = plain_rb(8, 12);
  a->laden(snap_bau(1, racks, {}, kt, kit, 0), 0);
  ref->laden(snap_bau(1, racks, {}, kt, kit, 0), 0);
  int ungleich = 0;
  double e = 0.0;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 20; ++i) {
      cdj::ArrSenke* sa = i < 8 ? static_cast<cdj::ArrSenke*>(&a->rack) : static_cast<cdj::ArrSenke*>(&a->intern);
      cdj::ArrSenke* sr = i < 8 ? static_cast<cdj::ArrSenke*>(&ref->rack) : static_cast<cdj::ArrSenke*>(&ref->intern);
      if (b == 0) {
        sa->transport_start(i, s0);
        sr->transport_start(i, s0);
      }
      for (int k = 0; k < 3; ++k) {
        const int64_t z = s0 + (b * 5 + k * 37 + i) % M;
        const uint8_t ton = static_cast<uint8_t>((b + k + i) % 4);
        sa->note(i, z, ton, static_cast<uint8_t>(70 + 10 * k), true);
        sr->note(i, z, ton, static_cast<uint8_t>(70 + 10 * k), true);
      }
    }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    for (int i = 0; i < 20; ++i) e += energie(std::vector<float>(a->t.arr.spur_bus_l(i), a->t.arr.spur_bus_l(i) + M));
    if (b == 1) {
      bool alle = true;
      for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
      if (!alle) {
        PRUEF(alle);
        break;
      }
    }
  }
  const cdj::ArrSpurLauf& sl = a->t.arr.spur_lauf();
  PRUEF(ungleich == 0);
  PRUEF(e > 1e-3);
  PRUEF(sl.z.blocks_parallel == BL);
  for (int l = 1; l < 4; ++l) PRUEF(sl.einheiten_bahn(l) >= 1);
  for (int l = 0; l < 4; ++l) PRUEF(a->t.arr.spur_arbeit(l).einheiten == 0);   // no RB unit at all: the scheduler count is the only one that moves
  uint32_t rack_w = 0;
  for (int l = 1; l < 4; ++l) rack_w += a->t.arr.spur_arbeit(l).rack_einheiten;
  PRUEF(rack_w > 0);
  std::printf("case 10 kit_rack_pool: ungleich=%d parallel=%llu worker units=%llu (rack units on workers %u), caller units=%llu\n", ungleich,
              static_cast<unsigned long long>(sl.z.blocks_parallel), static_cast<unsigned long long>(sl.einheiten_worker()), rack_w,
              static_cast<unsigned long long>(sl.z.einheiten_caller));
}

// 11: slot renumbering with RB members only (the reviewer's scenario): no member changes its device type (no transition predicate), no track leaves (no n_weg_ block):
// rack 0 loses its first member, every member slot after it moves down by one, note offs wait in the queues. On the code of that time a stale queued note off of one
// rack reached the RB slot of another rack's unit on a worker (a race in ArrRbSenke::note). With main's abgaenge() the old owners' events are dropped when the swap is
// seen, so this swap alone is no hazard any more; the hazard that is left is case 14. Kept: equal to serial, racks back in the lane lists one block after the swap.
void fall11(const cdj::Kit* kit) {
  constexpr int BL = 90, SW = 40;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(8, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 8; ++i) rack_spuren.push_back(i);
  auto racks = [&](bool ohne_erstes) {
    std::vector<RackDef> v;
    for (int i = 0; i < 8; ++i) v.push_back({i, {{RB, 36, 47, 0.0, 0.4f}, {RB, 48, 59, -3.0, 0.5f}, {RB, 60, 71, -6.0, 0.6f}, {RB, 0, 1, 0.0, 0.7f}}});
    if (ohne_erstes) v[0].m.erase(v[0].m.begin());
    return v;
  };
  a->laden(snap_bau(1, racks(false), plain, {}, kit, 0), 0);
  ref->laden(snap_bau(1, racks(false), plain, {}, kit, 0), 0);
  int ungleich = 0, racks_nach_tausch = -1, racks_spaeter = -1;
  double e = 0.0;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      a->laden(snap_bau(2, racks(true), plain, {}, kit, 0), s0);
      ref->laden(snap_bau(2, racks(true), plain, {}, kit, 0), s0);
      racks_nach_tausch = racks_in_bahnen(*a, rack_spuren);
    }
    for (int i = 0; i < 8 + 12; ++i) {
      if (i < 8) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    if (b == SW - 1)   // note ons now, their note offs wait across the swap (target in the next block)
      for (int i = 0; i < 8; ++i)
        for (int k = 0; k < 4; ++k) {
          const uint8_t ton = ton_von(i, 1000, k);
          for (cdj::ArrSenke* s : {static_cast<cdj::ArrSenke*>(&a->rack), static_cast<cdj::ArrSenke*>(&ref->rack)}) {
            s->note(i, s0 + 10 + k, ton, 100, true);
            s->note(i, s0 + M + 50 + k, ton, 0, false);
          }
        }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    for (int i = 0; i < 8; ++i) e += energie(std::vector<float>(a->t.arr.spur_bus_l(i), a->t.arr.spur_bus_l(i) + M));
    if (b == SW + 1) racks_spaeter = racks_in_bahnen(*a, rack_spuren);
    if (b == 1) {
      bool alle = true;
      for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
      if (!alle) {
        PRUEF(alle);
        break;
      }
    }
  }
  PRUEF(ungleich == 0);
  PRUEF(e > 1e-3);
  PRUEF(racks_nach_tausch == 0);   // dirt: not one rack in a lane list right after the swap
  PRUEF(racks_spaeter == 8);       // and all eight after ONE serial block
  for (int l = 1; l < 4; ++l) PRUEF(a->t.arr.spur_arbeit(l).rack_einheiten >= 1);
  std::printf("case 11 rack_pool_umzug_rb: ungleich=%d racks in lanes after the swap %d, one block later %d, rack units on workers %u/%u/%u\n", ungleich, racks_nach_tausch,
              racks_spaeter, a->t.arr.spur_arbeit(1).rack_einheiten, a->t.arr.spur_arbeit(2).rack_einheiten, a->t.arr.spur_arbeit(3).rack_einheiten);
}

// 13: the first rack block of a new snapshot runs abgaenge() (main's note-off fixes: it reads and rewrites the records and queues of EVERY track and ends the
// notes of leavers on member slots that other racks own now). It runs on the caller at the start of phase Q (ArrRackSenke::vor_phase, called by
// Arrangement::spur_quelle), never inside a lane unit. A clean swap (every member keeps its slot, gains change, note offs pending) with the racks in lane units:
//   - right after the swap no rack is lane-capable (abgaenge is due), the plan has them in the remainder;
//   - the hook runs before the units and rebuilds the plan, so the racks are in the lane lists in the swap block itself and compute on the workers;
//   - equal to the serial arrangement, and (TSan) no lane unit touches the "seen" generation or any other track's records: the gate of SPUR_RACK_ABGANG_IN_BAHN.
void fall13(const cdj::Kit* kit) {
  constexpr int BL = 70, SW = 30;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(8, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 8; ++i) rack_spuren.push_back(i);
  auto racks = [&](double db) {   // the gains of the members (a clean change: nothing moves)
    std::vector<RackDef> v;
    for (int i = 0; i < 8; ++i) v.push_back({i, {{RB, 36, 47, db, 0.4f}, {RB, 48, 59, -3.0 + db, 0.5f}, {RB, 60, 71, -6.0 + db, 0.6f}, {RB, 0, 1, 0.0, 0.7f}}});
    return v;
  };
  a->laden(snap_bau(1, racks(0.0), plain, {}, kit, 0), 0);
  ref->laden(snap_bau(1, racks(0.0), plain, {}, kit, 0), 0);
  int ungleich = 0, racks_nach_tausch = -1, racks_nach_block = -1;
  unsigned worker_vor = 0, worker_swap = 0;
  auto worker_summe = [&] {
    unsigned n = 0;
    for (int l = 1; l < 4; ++l) n += a->t.arr.spur_arbeit(l).rack_einheiten;
    return n;
  };
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      a->laden(snap_bau(2, racks(-4.0), plain, {}, kit, 0), s0);
      ref->laden(snap_bau(2, racks(-4.0), plain, {}, kit, 0), s0);
      racks_nach_tausch = racks_in_bahnen(*a, rack_spuren);
      worker_vor = worker_summe();
    }
    for (int i = 0; i < 8 + 12; ++i) {
      if (i < 8) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    if (b == SW - 1)   // notes on now, their offs wait across the swap
      for (int i = 0; i < 8; ++i)
        for (int k = 0; k < 4; ++k) {
          const uint8_t ton = ton_von(i, 1000, k);
          for (cdj::ArrSenke* s : {static_cast<cdj::ArrSenke*>(&a->rack), static_cast<cdj::ArrSenke*>(&ref->rack)}) {
            s->note(i, s0 + 10 + k, ton, 100, true);
            s->note(i, s0 + M + 50 + k, ton, 0, false);
          }
        }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    if (b == SW) {
      racks_nach_block = racks_in_bahnen(*a, rack_spuren);
      worker_swap = worker_summe() - worker_vor;
    }
  }
  PRUEF(ungleich == 0);
  PRUEF(racks_nach_tausch == 0);    // abgaenge() is due: no rack in a lane list, no lane unit can be the one that runs it
  PRUEF(racks_nach_block == 8);     // the hook ran it on the caller and rebuilt the plan: all eight in the lane lists in the swap block itself
  PRUEF(worker_swap > 0);           // and computed on the workers in that block
  std::printf("case 13 rack_abgaenge_vor_der_bahn: ungleich=%d racks in lanes after the swap %d, after the swap block %d, rack units on workers in the swap block %u\n", ungleich,
              racks_nach_tausch, racks_nach_block, worker_swap);
}

// 14: the hazard sauber_ guards, as it is reachable with main's abgaenge(): that function drops the queued events of an old owner of a slot (by the record of the leaver) as
// long as the record exists. A leaver whose slot nobody owns keeps its queue (the fade block ends the device) and frees the record in that block; the queued event
// outlives its record. A SECOND swap that gives the slot to another rack finds no record to handle it by: the event stays in the queue of the first rack and names a
// slot of the second one. Here: rack 7 loses its last member (slot 63, nobody owns it) with a note off queued far ahead; two blocks later track 8 becomes a rack with
// one member: slot 63. Until the event is delivered (block SW + 8, in rack 7's own block) rack 7 must not run on a lane while rack 8 renders slot 63 on another:
// no rack is in a lane list in that window (sauber_), the output equals the serial arrangement, and afterwards all nine racks are in the lane lists. The TSan gate of
// SPUR_RACK_OHNE_SAUBER runs this case alone (race in ArrRbSenke::note from faelliges_weitergeben on a worker against block_bahn of rack 8).
void fall14(const cdj::Kit* kit) {
  constexpr int BL = 70, SW = 30, SW2 = SW + 2, LIEFER = SW + 8;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(9, 11);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 9; ++i) rack_spuren.push_back(i);
  auto vier = [&](int i) { return RackDef{i, {{RB, 36, 47, 0.0, 0.4f}, {RB, 48, 59, -3.0, 0.5f}, {RB, 60, 71, -6.0, 0.6f}, {RB, 0, 1, 0.0, 0.7f}}}; };
  auto stand = [&](int phase) {   // 0: eight racks of four members; 1: rack 7 without its last member; 2: and track 8 a rack of one member
    std::vector<RackDef> v;
    for (int i = 0; i < 7; ++i) v.push_back(vier(i));
    RackDef r7 = vier(7);
    if (phase >= 1) r7.m.pop_back();
    v.push_back(r7);
    if (phase >= 2) v.push_back({8, {{RB, 36, 47, 0.0, 0.5f}}});
    return v;
  };
  a->laden(snap_bau(1, stand(0), plain, {}, kit, 0), 0);
  ref->laden(snap_bau(1, stand(0), plain, {}, kit, 0), 0);
  int ungleich = 0;
  int in_bahn[BL] = {};
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW || b == SW2) {
      a->laden(snap_bau(2 + (b == SW2), stand(b == SW ? 1 : 2), plain, {}, kit, 0), s0);
      ref->laden(snap_bau(2 + (b == SW2), stand(b == SW ? 1 : 2), plain, {}, kit, 0), s0);
    }
    for (int i = 0; i < 9 + 11; ++i) {
      if (i < 9 && (i < 8 || b >= SW2)) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else if (i >= 9) {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    if (b == SW - 1)   // the held note of rack 7's last member: its off waits far beyond both swaps
      for (cdj::ArrSenke* se : {static_cast<cdj::ArrSenke*>(&a->rack), static_cast<cdj::ArrSenke*>(&ref->rack)}) {
        se->note(7, s0 + 10, 0, 100, true);
        se->note(7, s0 + static_cast<int64_t>(LIEFER - SW + 1) * M + 20, 0, 0, false);
      }
    a->block(s0);
    ref->block(s0);
    ungleich += vergleiche(*a, *ref);
    in_bahn[b] = racks_in_bahnen(*a, rack_spuren);
  }
  PRUEF(ungleich == 0);
  PRUEF(in_bahn[SW - 1] == 8);
  bool fenster = true, danach = true;
  for (int b = SW2 + 1; b < LIEFER; ++b) fenster = fenster && in_bahn[b] == 0;   // the stale event is queued: not one rack runs on a lane
  for (int b = LIEFER + 1; b < BL; ++b) danach = danach && in_bahn[b] == 9;      // delivered (in rack 7's block): all nine back, and they stay
  PRUEF(fenster);
  PRUEF(danach);
  PRUEF(a->rack.parallel_faehig(0));
  std::printf("case 14 rack_zweiter_umzug_gibt_slot_weiter: ungleich=%d racks in lanes before %d, in the window %d, after delivery %d\n", ungleich, in_bahn[SW - 1], in_bahn[SW2 + 3],
              in_bahn[BL - 1]);
}

// 12: a rack track stops being a rack (turns into a plain RB track, or is removed) while the rack sink has a lead (a Surge member somewhere in the snapshot: the internal
// members' events wait up to `vorhalt` samples in the track's queue). Nothing calls the rack sink for that track any more, so whatever stays in its queue or records would
// keep every rack out of the lane lists for good. The track's queue and records must be resolved when it leaves. Bound: the racks are in the lane lists again at the latest
// vorhalt / M + 2 blocks after the swap (the dirt of the leaving track itself goes in the fade block, so the real bound is one serial block).
//   variante 0: the Surge rack track becomes a plain RB track; 1: it is removed; 2: a rack of internal members only is removed while another rack holds the Surge member;
//   3: as 0 without a lead (control: back after one block)
void fall12(const cdj::Kit* kit, int variante) {
  constexpr int BL = 120, SW = 40;
  const int vorhalt = variante == 3 ? 0 : 600;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  a->surge.v = ref->surge.v = vorhalt;
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const int plain0 = variante == 2 ? 8 : 7;
  const std::vector<int> plain = plain_rb(plain0, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 6; ++i) rack_spuren.push_back(i);
  auto s1 = [&] {
    std::vector<RackDef> v;
    for (int i = 0; i < 6; ++i) v.push_back(rack4(i));
    if (variante == 2) {
      v.push_back({6, {{RB, 36, 47}, {RB, 48, 59}}});
      v.push_back({7, {{RB, 36, 47}, {SURGE, 72, 83}}});
    } else {
      v.push_back({6, {{RB, 36, 47}, {SURGE, 72, 83}}});
    }
    return snap_bau(1, v, plain, {}, kit, 0);
  };
  auto s2 = [&] {
    std::vector<RackDef> v;
    for (int i = 0; i < 6; ++i) v.push_back(rack4(i));
    if (variante == 2) v.push_back({7, {{RB, 36, 47}, {SURGE, 72, 83}}});
    std::vector<int> pl = plain;
    if (variante == 0 || variante == 3) pl.push_back(6);
    return snap_bau(2, v, pl, {}, kit, 0);
  };
  a->laden(s1(), 0);
  ref->laden(s1(), 0);
  const int bis_rack = variante == 2 ? 8 : 7;   // tracks below this index are racks (before the swap) or the leaving track
  int ungleich = 0;
  int in_bahn[BL] = {};
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) {
      a->laden(s2(), s0);
      ref->laden(s2(), s0);
    }
    for (int i = 0; i < bis_rack + 12; ++i) {
      if (i < 6) {
        speise_rack(a->rack, i, b, s0);
        speise_rack(ref->rack, i, b, s0);
      } else if (i == 6) {
        if (b < SW) {   // production-like lookahead: the targets lie up to `vorhalt` samples ahead, so the events wait in the queue of the track
          for (cdj::ArrSenke* s : {static_cast<cdj::ArrSenke*>(&a->rack), static_cast<cdj::ArrSenke*>(&ref->rack)}) {
            if (b == 0) s->transport_start(6, s0);
            s->note(6, s0 + vorhalt + 20, 40, 100, true);
            s->note(6, s0 + vorhalt + 120, 40, 0, false);
          }
        } else if (variante == 0 || variante == 3) {   // now a plain RB track
          speise_rack(a->intern, 6, b, s0, 1);
          speise_rack(ref->intern, 6, b, s0, 1);
        }
      } else if (variante == 2 && i == 7) {
        speise_rack(a->rack, 7, b, s0, 2);
        speise_rack(ref->rack, 7, b, s0, 2);
      } else {
        speise_rack(a->intern, i, b, s0, 1);
        speise_rack(ref->intern, i, b, s0, 1);
      }
    }
    a->block(s0);
    ref->block(s0);
    a->surge.impulse.clear();
    ref->surge.impulse.clear();
    a->surge.ev.clear();
    ref->surge.ev.clear();
    ungleich += vergleiche(*a, *ref);
    in_bahn[b] = racks_in_bahnen(*a, rack_spuren);
    if (b == 1) {
      bool alle = true;
      for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
      if (!alle) {
        PRUEF(alle);
        break;
      }
    }
  }
  const int grenze = vorhalt / M + 2;
  PRUEF(ungleich == 0);
  PRUEF(in_bahn[SW - 1] == 6);
  bool bleibt = true;
  for (int b = SW + grenze; b < BL; ++b) bleibt = bleibt && in_bahn[b] == 6;
  PRUEF(bleibt);   // back in the lane lists within the bound, and they stay
  PRUEF(in_bahn[SW + 1] == 6);                                       // in fact after one serial block
  PRUEF(a->rack.parallel_faehig(0));
  std::printf("case 12 rack_verlaesst_mit_vorhalt (variante %d, vorhalt %d): ungleich=%d racks in lanes at swap-1 %d, +1 %d, +%d %d, last %d\n", variante, vorhalt, ungleich,
              in_bahn[SW - 1], in_bahn[SW + 1], grenze, in_bahn[SW + grenze], in_bahn[BL - 1]);
}

}  // namespace

// ---- 15 (1.9 U8 T9): member macro targets on rack tracks on the pool lanes: 8 racks x 4 member targets, macros every block, two swaps (one drops a member), vs the serial reference ----
void ziele_setzen(cdj::ArrSnapshot* s, int ntrack, bool mit) {
  for (int i = 0; i < ntrack; ++i) {
    cdj::ArrRack& r = s->rack[i];
    r.slot = static_cast<int8_t>(i);
    r.n = 0;
    r.ng = 0;
    if (!mit) continue;
    auto z = [&](int mk, int gl, int pa, float von, float bis) {
      cdj::ArrGliedZiel g; g.makro = mk; g.glied = gl; g.param = pa; g.von = von; g.bis = bis; r.g[r.ng++] = g;
    };
    z(i % 4, 0, 1, 0.1f, 0.9f);              // cutoff of RB member 0
    z((i + 1) % 4, 1, 2, 0.0f, 1.0f);        // resonanz of RB member 1
    z((i + 2) % 4, 2, 16, -30.0f, 6.0f);     // gain of RB member 2
    z((i + 3) % 4, 3, 16, -20.0f, 0.0f);     // gain of kit member 3
  }
}
void fall_t9(const cdj::Kit* kit) {
  constexpr int BL = 160, SW = 60, SW2 = 110;
  PoolW pool(3);
  auto a = std::make_unique<AWelt>(false);
  auto ref = std::make_unique<AWelt>(true);
  auto neutral = std::make_unique<AWelt>(true);
  a->t.arr.setze_hall_pool(&pool.p);
  a->t.arr.setze_spur_pool(1);
  a->t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a->t.arr.setze_spur_haken(&hk);
  const std::vector<int> plain = plain_rb(8, 12);
  std::vector<int> rack_spuren;
  for (int i = 0; i < 8; ++i) rack_spuren.push_back(i);
  auto snap = [&](int64_t nr, int var, bool mit, bool weniger) {
    std::vector<RackDef> r = acht_racks();
    if (weniger) r[0].m.pop_back();   // rack 0 loses its kit member (index 3): targets on it must be ignored, not crash
    cdj::ArrSnapshot* s = snap_bau(nr, r, plain, {}, kit, var);
    ziele_setzen(s, 8, mit);
    return s;
  };
  auto reg = [&](AWelt& w, int rk, int mk) { int x = w.t.tab.suche(("rack/" + std::to_string(rk + 1) + "/m" + std::to_string(mk + 1)).c_str()); PRUEF(x >= 0); return x; };
  a->laden(snap(1, 0, true, false), 0);
  ref->laden(snap(1, 0, true, false), 0);
  neutral->laden(snap(1, 0, false, false), 0);
  int ungleich = 0, in_bahnen = 0, neutral_ungleich = 0;
  double e = 0.0;
  for (int b = 0; b < BL; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    if (b == SW) { a->laden(snap(2, 1, true, false), s0); ref->laden(snap(2, 1, true, false), s0); neutral->laden(snap(2, 1, false, false), s0); }
    if (b == SW2) { a->laden(snap(3, 0, b % 2 == 0, true), s0); ref->laden(snap(3, 0, b % 2 == 0, true), s0); neutral->laden(snap(3, 0, false, true), s0); }
    for (int rk = 0; rk < 8; ++rk)
      for (int mk = 0; mk < 4; ++mk) {
        const float v = static_cast<float>((b * 3 + rk * 5 + mk * 7) % 11) / 10.0f;
        a->t.arr.setze_sofort(reg(*a, rk, mk), v);
        ref->t.arr.setze_sofort(reg(*ref, rk, mk), v);
        neutral->t.arr.setze_sofort(reg(*neutral, rk, mk), v);
      }
    for (int i = 0; i < 8 + 12; ++i) {
      if (i < 8) { speise_rack(a->rack, i, b, s0); speise_rack(ref->rack, i, b, s0); speise_rack(neutral->rack, i, b, s0); }
      else { speise_rack(a->intern, i, b, s0, 1); speise_rack(ref->intern, i, b, s0, 1); speise_rack(neutral->intern, i, b, s0, 1); }
    }
    a->block(s0);
    ref->block(s0);
    neutral->block(s0);
    ungleich += vergleiche(*a, *ref);
    neutral_ungleich += vergleiche(*a, *neutral);
    in_bahnen += racks_in_bahnen(*a, rack_spuren);
    for (int i = 0; i < 8; ++i) e += energie(std::vector<float>(a->t.arr.spur_bus_l(i), a->t.arr.spur_bus_l(i) + M));
  }
  std::printf("case 15: %d blocks, differing buffers pool-vs-serial %d, rack-track-in-lane-list block count %d, energy %.3f\n", BL, ungleich, in_bahnen, e);
  std::printf("case 15 positive control: buffers differing from the same run WITHOUT targets: %d\n", neutral_ungleich);
  PRUEF(neutral_ungleich > 0);
  PRUEF(ungleich == 0);
  PRUEF(in_bahnen > 0);
  PRUEF(e > 1e-6);
  bool alle = true;
  for (int l = 1; l < 4; ++l) alle = alle && a->t.arr.spur_lauf().einheiten_bahn(l) >= 1;
  std::printf("case 15: every worker lane computed a unit: %d\n", alle ? 1 : 0);
  PRUEF(alle);
}

int main(int argc, char** argv) {
  const int nur = argc > 1 ? std::atoi(argv[1]) : 0;   // a case number: run that case only (the TSan gate of SPUR_RACK_OHNE_SAUBER runs case 11 alone)
  auto an = [&](int n) { return nur == 0 || nur == n; };
  auto kit = kit_bau("kit_rack_bahn", 3000);
  if (an(1)) fall1(kit.get());
  if (an(2)) fall2(kit.get());
  if (an(3)) fall3(kit.get());
  if (an(4)) fall4(kit.get());
  if (an(5)) fall5(kit.get());
  if (an(6)) fall6(kit.get());
  if (an(7)) {
    fall7(kit.get(), false);
    fall7(kit.get(), true);
  }
  if (an(8)) fall8(kit.get());
  if (an(9)) fall9(kit.get());
  if (an(10)) fall10(kit.get());
  if (an(11)) fall11(kit.get());
  if (an(12))
    for (int v = 0; v < 4; ++v) fall12(kit.get(), v);
  if (an(13)) fall13(kit.get());
  if (an(14)) fall14(kit.get());
  if (an(15)) fall_t9(kit.get());
  PRUEF_ENDE();
}
