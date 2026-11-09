// Package 1.9 U6 (T6.3): the instrument rack as a sink (arr_rack_sink.h), through the arrangement with the real RB-338, kit and dispatcher sinks and
// recording stubs. Everything is measured at the track bus (before fader and pan, read through ArrPruefZugang), so sums are exact.
//   R1 zones (AK-R1): members A (key 0..59, impulse 0.5) and B (key 60..127, impulse 0.25): key 59 sounds A only, key 60 B only, each on the sample of
//      a plain kit track with the same notes (0 samples deviation); a key no zone holds stays silent
//   R2 velocity (AK-R2): vel zones 1..63 and 64..127: vel 63 and vel 64 each sound exactly one member
//   R3 overlap (AK-R3): overlapping zones sound both; the bus equals the sum of the two single plain renders bit for bit
//   R4 chain select (AK-R4): a recording stub as the internal sink shows the routing: A (chain 0..63), B (64..127), the chain value switches 0 -> 100 at
//      beat 4 by a swap: the note held over the swap and its note off reach A only, the note after the swap reaches B only; with the real RB-338 as A
//      the held note keeps sounding across the swap (bit-equal to the plain RB track, no step above 0.01) and the note after it sounds on the kit B
//   R5 gain (AK-R5): gain_db -6 gives -6.0 dB within 0.01 dB; a gain change while a sound plays ramps over the block (no step above 0.01 where the
//      input steps 0.3); an unchanged gain stays flat
//   R6 mixed lead (AK-R6): an internal kit member and a Surge member (a stub that delays like the Wirt sink: output one lead after its send sample): both
//      onsets arrive on the same sample (0 deviation); vorhalt() is the lead with a Surge member and 0 without
//   R0 negative control: a rack with ONE member that covers everything is bit-equal to the plain RB-338 track with that device
//   L  a member that is removed fades over one block (no step above 0.01), the other member goes on unchanged, its record is freed
//   A  no allocation in note, block, all-notes-off, transport start and the swap that moves a member (counting operator new, with a positive control)
//   R7 renumbering swap: rack 1 loses a member, the slots of rack 2 move down one and a member of rack 2 takes the slot of the leaver: every note on that
//      reached a slot is ended exactly once on that slot (no hang), and no off reaches a slot that did not hold the note; the note of rack 2 leaving with the swap
//      and the note staying are both run
//   R12 a member that survives under a new slot number while its old slot is left unowned keeps its queued note on (real sinks, Surge stand-in with lead 537,
//      swap times from 225 to 1249 samples before the note on)
//   R13 a leaving kit member: whatever number of keys it holds (0, 8, 32, 33, 40), its one-shots do not ring into the new owner of its slot; the voices of
//      a kit member that stays are not touched (bit-equal to a run without the leaver); an RB-338 leaver gets its per-key offs and no all-off
//   R14 two swaps without a block between, the second snapshot at the address of the first one the sink saw: the members that left still end their notes
// Mutations: ARR_RACK_ZONE_EXKLUSIV (R1), ARR_RACK_OFF_AN_ALLE (R4), ARR_RACK_GAIN_SPRUNG (R5), ARR_RACK_OHNE_VORHALT (R6), ARR_RACK_ABGANG_OHNE_OFF (R7),
// ARR_RACK_ABGANG_UMZUG_NUR_BESETZT (R12), ARR_RACK_ABGANG_KIT_NUR_OFFS and ARR_RACK_ABGANG_AUS_FUER_ALLE (R13), ARR_RACK_SNAP_ZEIGER (R14).
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <utility>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_rack_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/kit.h"
#include "check.h"

// allocation guard (AK-G2): counts every operator new while a watch window is open
static std::atomic<bool> g_waechter{false};
static std::atomic<long> g_allokationen{0};
void* operator new(std::size_t n) {
  if (g_waechter.load(std::memory_order_relaxed)) g_allokationen.fetch_add(1, std::memory_order_relaxed);
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: the track buses
  static const float* bus_l(const Arrangement& a, int i) { return a.bus_l_[i]; }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int64_t E0 = 537 + 256;   // the first sample of the run (start at 0 with lead 537 and block 256)

// ---- kits: every key plays the same one-frame impulse (amp) or a constant (dc) -------------------------------------------------------------
std::unique_ptr<cdj::Kit> impuls_kit(const char* name, float amp, int64_t frames = 1) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = name;
  k->n = cdj::KIT_NOTEN;
  for (int i = 0; i < cdj::KIT_NOTEN; ++i) {
    k->klang[i].name = "t:" + std::to_string(i);
    k->klang[i].frames = frames;
    k->klang[i].daten.assign(static_cast<size_t>(frames) * 2, amp);
  }
  return k;
}

// ---- snapshots ----------------------------------------------------------------------------------------------------------------------------
struct G {   // a member
  enum Art { RB, KIT, SURGE } art = KIT;
  const cdj::Kit* kit = nullptr;
  int slot = 1;
  int ton_lo = 0, ton_hi = 127, vel_lo = 1, vel_hi = 127, kette_lo = 0, kette_hi = 127;
  double gain_db = 0.0;
  std::vector<std::pair<const char*, float>> param;
  const char* id = nullptr;   // member id (zwei_racks_snap); nullptr: "r<rack>m<index>"
};
G kit_g(const cdj::Kit* k, int ton_lo = 0, int ton_hi = 127) {
  G g;
  g.art = G::KIT;
  g.kit = k;
  g.ton_lo = ton_lo;
  g.ton_hi = ton_hi;
  return g;
}
struct N {
  const char* id;
  double beat, laenge;
  int ton, vel;
};

void geraet_kit(cdj::ArrSpur& sp, const cdj::Kit* k) {
  std::snprintf(sp.geraet, sizeof sp.geraet, "kit");
  std::snprintf(sp.kit, sizeof sp.kit, "%s", k->name.c_str());
  sp.kit_ptr = k;
  sp.kit_gen = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(k));
}
void geraet_rb(cdj::ArrSpur& sp, const std::vector<std::pair<const char*, float>>& param) {
  std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
  sp.n_param = 0;
  for (const auto& p : param) {
    std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", p.first);
    sp.param[sp.n_param++].wert = p.second;
  }
}

// a rack track nr with the members gl; the notes go on the rack track
cdj::ArrSnapshot* rack_snap(int64_t nr, int kette, const std::vector<G>& gl, const std::vector<N>& noten, int spur_nr = 1, int platz0 = 0) {
  Bau b(nr);
  b.spur(spur_nr, ArrArt::rack);
  for (const N& n : noten) b.note(spur_nr, n.id, n.beat, n.laenge, n.ton, n.vel);
  cdj::ArrSnapshot* s = b.fertig();
  cdj::ArrSpur& sp = s->spur[spur_nr - 1];
  std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
  sp.kette = kette;
  sp.n_glieder = static_cast<int>(gl.size());
  for (size_t i = 0; i < gl.size(); ++i) {
    const G& g = gl[i];
    cdj::ArrGlied& gd = sp.glied[i];
    gd.id = cdj::arr_id(std::string("m") + std::to_string(i));
    gd.platz = cdj::ARR_SPUREN + platz0 + static_cast<int>(i);
    gd.ton_lo = static_cast<uint8_t>(g.ton_lo);
    gd.ton_hi = static_cast<uint8_t>(g.ton_hi);
    gd.vel_lo = static_cast<uint8_t>(g.vel_lo);
    gd.vel_hi = static_cast<uint8_t>(g.vel_hi);
    gd.kette_lo = static_cast<uint8_t>(g.kette_lo);
    gd.kette_hi = static_cast<uint8_t>(g.kette_hi);
    gd.gain = static_cast<float>(std::pow(10.0, g.gain_db / 20.0));
    cdj::ArrSpur& dev = s->glied_spur[gd.platz - cdj::ARR_SPUREN];
    dev.nr = gd.platz + 1;
    if (g.art == G::SURGE) {
      dev.art = ArrArt::wirt;
      dev.slot = g.slot;
      gd.art = ArrArt::wirt;
      gd.slot = g.slot;
      ++s->rack_wirt;
    } else {
      dev.art = ArrArt::intern;
      gd.art = ArrArt::intern;
      if (g.art == G::KIT) geraet_kit(dev, g.kit);
      else geraet_rb(dev, g.param);
    }
  }
  return s;
}


// two rack tracks (1 and 2) in one snapshot; the members of rack k are numbered one after the other from ARR_SPUREN, as the parser does
cdj::ArrSnapshot* zwei_racks_snap(int64_t nr, const std::vector<G>& g1, const std::vector<G>& g2, const std::vector<std::pair<int, N>>& noten) {
  Bau b(nr);
  b.spur(1, ArrArt::rack);
  b.spur(2, ArrArt::rack);
  for (const auto& n : noten) b.note(n.first, n.second.id, n.second.beat, n.second.laenge, n.second.ton, n.second.vel);
  cdj::ArrSnapshot* s = b.fertig();
  int platz = 0;
  for (int sn = 1; sn <= 2; ++sn) {
    const std::vector<G>& gl = sn == 1 ? g1 : g2;
    cdj::ArrSpur& sp = s->spur[sn - 1];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
    sp.kette = 0;
    sp.n_glieder = static_cast<int>(gl.size());
    for (size_t i = 0; i < gl.size(); ++i) {
      cdj::ArrGlied& gd = sp.glied[i];
      gd.id = cdj::arr_id(gl[i].id ? std::string(gl[i].id) : std::string("r") + std::to_string(sn) + "m" + std::to_string(i));
      gd.platz = cdj::ARR_SPUREN + platz++;
      gd.ton_lo = static_cast<uint8_t>(gl[i].ton_lo);
      gd.ton_hi = static_cast<uint8_t>(gl[i].ton_hi);
      gd.vel_lo = 1;
      gd.vel_hi = 127;
      gd.kette_lo = 0;
      gd.kette_hi = 127;
      gd.gain = 1.0f;
      cdj::ArrSpur& dev = s->glied_spur[gd.platz - cdj::ARR_SPUREN];
      dev.nr = gd.platz + 1;
      if (gl[i].art == G::SURGE) {
        dev.art = ArrArt::wirt;
        dev.slot = gl[i].slot;
        gd.art = ArrArt::wirt;
        gd.slot = gl[i].slot;
        ++s->rack_wirt;
      } else {
        dev.art = ArrArt::intern;
        gd.art = ArrArt::intern;
        if (gl[i].art == G::KIT) geraet_kit(dev, gl[i].kit);
        else geraet_rb(dev, gl[i].param);
      }
    }
  }
  return s;
}

// per (slot or track, key): note ons minus note offs in the order they reached a stand-in sink; hang = a pair left open, unter = an off with no on before it
int bilanz(const std::vector<PruefSenke::Ev>& ev, bool& unter) {
  static int offen[64][128];
  std::memset(offen, 0, sizeof offen);
  unter = false;
  for (const auto& e : ev) {
    int& n = offen[e.spur & 63][e.ton & 127];
    n += e.an ? 1 : -1;
    unter = unter || n < 0;
  }
  int haengt = 0;
  for (auto& z : offen)
    for (int n : z) haengt += n != 0 ? 1 : 0;
  return haengt;
}
// the net count of ons minus offs for one pair
int netto(const std::vector<PruefSenke::Ev>& ev, int spur, int ton) {
  int n = 0;
  for (const auto& e : ev) n += e.spur == spur && e.ton == ton ? (e.an ? 1 : -1) : 0;
  return n;
}

// a plain internal track with one device (the reference of a rack)
cdj::ArrSnapshot* plain_snap(int64_t nr, const G& g, const std::vector<N>& noten) {
  Bau b(nr);
  b.spur(1, ArrArt::intern);
  for (const N& n : noten) b.note(1, n.id, n.beat, n.laenge, n.ton, n.vel);
  cdj::ArrSnapshot* s = b.fertig();
  if (g.art == G::KIT) geraet_kit(s->spur[0], g.kit);
  else geraet_rb(s->spur[0], g.param);
  return s;
}

// Merge 2026-11-07: the Arrangement grew on main (Hall pool, inserts, racks), a Treiber on the stack overflowed 8 MB; as in test_arr_inserts.cpp
#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;

// ---- sinks and a run that records the track bus -----------------------------------------------------------------------------------------
struct Sinken {
  cdj::ArrRbSenke rb;
  cdj::ArrBkSenke bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  cdj::ArrRackSenke rack;
  explicit Sinken(cdj::Arrangement& a, cdj::ArrSenke* wirt1 = nullptr)
      : rb(a), bk(a), kit(a), intern(a, &rb, &bk, &kit), rack(a, &intern, wirt1, nullptr) {
    a.setze_senke_intern(&intern);
    a.setze_senke_rack(&rack);
    if (wirt1) a.setze_senke_wirt(1, wirt1);
  }
};

std::vector<float> bus_lauf(Treiber& t, int64_t bis, int spur = 0) {
  std::vector<float> bus;
  float b[6][cdj::ARR_BLOCK];
  while (t.s < bis) {
    for (PruefSenke* p : t.senken) p->block_s0 = t.s;   // the stand-ins learn the block a note arrives in (as Treiber::lauf does)
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    const float* q = cdj::ArrPruefZugang::bus_l(t.arr, spur);
    bus.insert(bus.end(), q, q + t.n);
    t.s += t.n;
  }
  return bus;
}

// the buses of tracks 1 and 2 (spur 0 and 1) up to bis
void busse_lauf(Treiber& t, int64_t bis, std::vector<float>& bus1, std::vector<float>& bus2) {
  float b[6][cdj::ARR_BLOCK];
  while (t.s < bis) {
    for (PruefSenke* p : t.senken) p->block_s0 = t.s;
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    const float* q1 = cdj::ArrPruefZugang::bus_l(t.arr, 0);
    const float* q2 = cdj::ArrPruefZugang::bus_l(t.arr, 1);
    bus1.insert(bus1.end(), q1, q1 + t.n);
    bus2.insert(bus2.end(), q2, q2 + t.n);
    t.s += t.n;
  }
}

std::vector<float> rack_lauf(cdj::ArrSnapshot* s, int64_t bis) {
  TR(t)
  auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  return bus_lauf(t, bis);
}
std::vector<float> plain_lauf(cdj::ArrSnapshot* s, int64_t bis) {
  TR(t)
  auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  return bus_lauf(t, bis);
}

std::vector<int64_t> treffer(const std::vector<float>& v, float schwelle = 1e-9f) {
  std::vector<int64_t> t;
  for (size_t i = 0; i < v.size(); ++i)
    if (std::fabs(v[i]) > schwelle) t.push_back(static_cast<int64_t>(i));
  return t;
}
bool bitgleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}
double groesster_schritt(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = std::max<int64_t>(von, 1); i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, std::fabs(static_cast<double>(v[i]) - v[i - 1]));
  return m;
}

// Surge stand-in: sends the note one lead before its target (as the Wirt sink does: at the sample ziel - v, never before the block it arrived in)
// and its output is the impulse one lead after the send sample
struct SurgeAttrappe : PruefSenke {
  explicit SurgeAttrappe(int64_t v) : PruefSenke(v) {}
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override {
    ev.push_back({spur, ziel, ton, vel, an, block_s0});
    if (an) impulse.push_back(std::max<int64_t>(ziel - v, block_s0) + v);
  }
};

}  // namespace

int main() {
  auto ka = impuls_kit("ka", 0.5f);
  auto kb = impuls_kit("kb", 0.25f);
  const int64_t BIS = 4 * SPB;

  {  // R1: zones
    const std::vector<N> noten = {{"n59", 0.0, 0.5, 59, 127}, {"n60", 1.0, 0.5, 60, 127}};
    auto bus = rack_lauf(rack_snap(1, 0, {kit_g(ka.get(), 0, 59), kit_g(kb.get(), 60, 127)}, noten), BIS);
    auto refa = plain_lauf(plain_snap(1, kit_g(ka.get()), {noten[0]}), BIS);
    auto refb = plain_lauf(plain_snap(1, kit_g(kb.get()), {noten[1]}), BIS);
    const std::vector<int64_t> t = treffer(bus);
    PRUEF(t.size() == 2);
    if (t.size() == 2) {
      std::printf("R1: hits at %lld and %lld (plain A %lld, plain B %lld), values %.4f %.4f\n", static_cast<long long>(t[0]), static_cast<long long>(t[1]),
                  static_cast<long long>(treffer(refa)[0]), static_cast<long long>(treffer(refb)[0]), bus[t[0]], bus[t[1]]);
      PRUEF(t[0] == E0 && t[1] == E0 + SPB);
      PRUEF(t[0] == treffer(refa)[0] && t[1] == treffer(refb)[0]);   // 0 samples deviation against the plain tracks
      PRUEF(bus[t[0]] == 0.5f && bus[t[1]] == 0.25f);                 // key 59 sounds A only, key 60 B only
    }
    // negative control: a key that no zone holds is silent
    auto stumm = rack_lauf(rack_snap(1, 0, {kit_g(ka.get(), 0, 50), kit_g(kb.get(), 70, 127)}, {{"n60", 0.0, 0.5, 60, 127}}), BIS);
    PRUEF(treffer(stumm).empty());
    // a zone of one key
    auto eins = rack_lauf(rack_snap(1, 0, {kit_g(ka.get(), 60, 60)}, {{"a", 0.0, 0.5, 60, 127}, {"b", 1.0, 0.5, 61, 127}, {"c", 2.0, 0.5, 59, 127}}), BIS);
    PRUEF(treffer(eins).size() == 1);
  }
  {  // R2: velocity
    G a = kit_g(ka.get()), b = kit_g(kb.get());
    a.vel_lo = 1;
    a.vel_hi = 63;
    b.vel_lo = 64;
    b.vel_hi = 127;
    auto bus = rack_lauf(rack_snap(1, 0, {a, b}, {{"v63", 0.0, 0.5, 60, 63}, {"v64", 1.0, 0.5, 60, 64}}), BIS);
    const std::vector<int64_t> t = treffer(bus);
    PRUEF(t.size() == 2);
    if (t.size() == 2) {
      std::printf("R2: vel 63 -> %.6f (A only: %.6f), vel 64 -> %.6f (B only: %.6f)\n", bus[t[0]], 0.5f * (63.0f / 127.0f), bus[t[1]],
                  0.25f * (64.0f / 127.0f));
      PRUEF_NAH(bus[t[0]], 0.5 * 63.0 / 127.0, 1e-7);
      PRUEF_NAH(bus[t[1]], 0.25 * 64.0 / 127.0, 1e-7);
    }
  }
  {  // R3: overlap, the sum of the two single renders bit for bit
    const std::vector<N> noten = {{"a", 0.0, 0.5, 60, 127}, {"b", 0.0, 0.5, 62, 90}, {"c", 1.0, 0.5, 60, 64}, {"d", 1.5, 0.5, 100, 100}, {"e", 2.0, 0.5, 0, 127}};
    auto bus = rack_lauf(rack_snap(1, 0, {kit_g(ka.get()), kit_g(kb.get())}, noten), BIS);
    auto ra = plain_lauf(plain_snap(1, kit_g(ka.get()), noten), BIS);
    auto rb2 = plain_lauf(plain_snap(1, kit_g(kb.get()), noten), BIS);
    std::vector<float> summe(ra.size());
    for (size_t i = 0; i < ra.size(); ++i) summe[i] = ra[i] + rb2[i];
    PRUEF(treffer(bus).size() == 4);   // 5 notes on 4 distinct samples (a and b share beat 0); both members sound at the same samples
    PRUEF(bitgleich(bus, summe));
  }
  {  // R4 (routing): a stub as the internal sink records which member gets which event
    TR(t)
    PruefSenke stub(0);
    cdj::ArrRackSenke rack(t.arr, &stub, nullptr, nullptr);
    t.arr.setze_senke_rack(&rack);
    t.senken.push_back(&stub);
    G a = kit_g(ka.get()), b = kit_g(kb.get());
    a.kette_lo = 0;
    a.kette_hi = 63;
    b.kette_lo = 64;
    b.kette_hi = 127;
    const std::vector<N> noten = {{"held", 0.0, 6.0, 60, 100}, {"later", 5.0, 1.0, 62, 100}};
    t.laden(rack_snap(1, 0, {a, b}, noten));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(E0 + 4 * SPB - 2000);   // up to a block before beat 4
    t.laden(rack_snap(2, 100, {a, b}, noten));   // the swap: the chain value 0 -> 100
    t.lauf(E0 + 8 * SPB);
    struct Soll {
      int platz;
      int ton;
      bool an;
      int64_t ziel;
    };
    const Soll soll[] = {{32, 60, true, E0}, {33, 62, true, E0 + 5 * SPB}, {32, 60, false, E0 + 6 * SPB}, {33, 62, false, E0 + 6 * SPB}};
    int gefunden = 0;
    for (const auto& e : stub.ev)
      for (const Soll& s : soll) gefunden += e.spur == s.platz && e.ton == s.ton && e.an == s.an && e.ziel == s.ziel ? 1 : 0;
    std::printf("R4: %zu events at the stub (4 expected), %d of them the expected ones\n", stub.ev.size(), gefunden);
    PRUEF(stub.ev.size() == 4 && gefunden == 4);   // the note off of the held note reached member A only, the later note only member B
  }
  {  // R4 (audio): the real RB-338 as A holds a note over the swap, the kit B plays the note after it
    G a;
    a.art = G::RB;
    a.param = {{"cutoff", 0.4f}};
    a.kette_hi = 63;
    G b = kit_g(ka.get());
    b.kette_lo = 64;
    const std::vector<N> n1 = {{"held", 0.0, 6.0, 40, 100}};
    const std::vector<N> n2 = {{"later", 5.0, 1.0, 62, 100}};
    std::vector<N> beide = n1;
    beide.push_back(n2[0]);
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
    t.laden(rack_snap(1, 0, {a, b}, beide));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    std::vector<float> bus = bus_lauf(t, E0 + 4 * SPB - 5 * 256);
    const int64_t tausch = t.s;
    t.laden(rack_snap(2, 100, {a, b}, beide));
    std::vector<float> rest = bus_lauf(t, 8 * SPB);
    bus.insert(bus.end(), rest.begin(), rest.end());
    G ar = a;
    ar.kette_hi = 127;
    ar.kette_lo = 0;
    auto ref_rb = plain_lauf(plain_snap(1, ar, n1), 8 * SPB);                 // the RB track alone with the held note
    auto ref_kit = plain_lauf(plain_snap(1, kit_g(ka.get()), n2), 8 * SPB);   // the kit track alone with the later note
    std::vector<float> summe(ref_rb.size());
    for (size_t i = 0; i < ref_rb.size(); ++i) summe[i] = ref_rb[i] + ref_kit[i];
    double e_rb_nach_tausch = 0.0;
    for (int64_t i = tausch; i < 6 * SPB && i < static_cast<int64_t>(ref_rb.size()); ++i) e_rb_nach_tausch += static_cast<double>(ref_rb[i]) * ref_rb[i];
    std::printf("R4: held RB note after the swap: energy %.4f; rack against RB alone + kit alone bit-equal: %d; largest step around the swap %.6f\n",
                e_rb_nach_tausch, bitgleich(bus, summe) ? 1 : 0, groesster_schritt(bus, tausch - 512, tausch + 2048));
    PRUEF(e_rb_nach_tausch > 0.01);   // the held note really sounds after the swap (the test sees a cut)
    PRUEF(bitgleich(bus, summe));
    PRUEF(groesster_schritt(bus, tausch - 512, tausch + 2048) < 0.01);
  }
  {  // R7: a swap that renumbers the member slots (rack 1 loses a member, so the members of rack 2 move down one slot) while rack 2 holds a note
    for (int variante = 0; variante < 2; ++variante) {   // 0: the note leaves with the swap (the off is queued by the swap), 1: the note stays (the off comes later)
      TR(t)
      PruefSenke stub(0);
      cdj::ArrRackSenke rack(t.arr, &stub, nullptr, nullptr);
      t.arr.setze_senke_rack(&rack);
      t.senken.push_back(&stub);
      G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get()), b1 = kit_g(kb.get(), 70, 127);
      const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 61, 100}}, {2, {"held", 0.0, 6.0, 60, 100}}};
      const std::vector<std::pair<int, N>> ohne = {{1, {"x", 0.0, 6.0, 61, 100}}};
      t.laden(zwei_racks_snap(1, {a0, a1}, {b0, b1}, mit));   // slots: a0 32, a1 33, b0 34, b1 35
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(E0 + 2 * SPB);
      t.laden(zwei_racks_snap(2, {a0}, {b0, b1}, variante == 0 ? ohne : mit));   // slots: a0 32, b0 33, b1 34, 35 free
      t.lauf(E0 + 8 * SPB);
      bool unter_null = false;
      const int haengt = bilanz(stub.ev, unter_null);
      std::printf("R7 variant %d: %zu events:", variante, stub.ev.size());
      for (const auto& e : stub.ev) std::printf(" [%d %d %s]", e.spur, e.ton, e.an ? "on" : "off");
      std::printf("\n");
      PRUEF(haengt == 0);        // every note on is ended exactly once, on the slot it went to
      PRUEF(!unter_null);        // no note off reaches a slot that did not hold the note
    }
  }
  {  // R8: the swap that renumbers the slots while events of the leaving member are queued (a Surge member in the snapshot makes the lead 537 samples)
    G su;
    su.art = G::SURGE;
    su.slot = 1;
    const int64_t an_z = E0 + 2 * SPB;   // target of the note on, its off is one beat later
    int schlecht = 0, gesamt = 0;
    int64_t erste = -1;
    for (int64_t tausch = an_z - 1500; tausch <= an_z + SPB + 700; tausch += 256) {
      TR(t)
      PruefSenke stub(0);
      SurgeAttrappe surge(537);
      cdj::ArrRackSenke rack(t.arr, &stub, &surge, nullptr);
      t.arr.setze_senke_rack(&rack);
      t.arr.setze_senke_wirt(1, &surge);
      t.senken.push_back(&stub);
      t.senken.push_back(&surge);
      G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get());
      const std::vector<std::pair<int, N>> mit = {{1, {"x", 2.0, 1.0, 61, 100}}};
      t.laden(zwei_racks_snap(1, {a0, a1}, {b0, su}, mit));   // slots: a0 32, a1 33, b0 34, Surge 35
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(tausch);
      t.laden(zwei_racks_snap(2, {a0}, {b0, su}, mit));   // a1 leaves: b0 -> 33, Surge -> 34
      t.lauf(E0 + 6 * SPB);
      bool unter = false;
      const int haengt = bilanz(stub.ev, unter);
      ++gesamt;
      if (haengt || unter) {
        ++schlecht;
        if (erste < 0) erste = tausch;
        std::printf("R8: swap at %lld (%lld before the note on, %lld before its off): hang %d, off without on %d, events:", static_cast<long long>(tausch),
                    static_cast<long long>(an_z - tausch), static_cast<long long>(an_z + SPB - tausch), haengt, unter ? 1 : 0);
        for (const auto& e : stub.ev) std::printf(" [%d %d %s z=%lld]", e.spur, e.ton, e.an ? "on" : "off", static_cast<long long>(e.ziel));
        std::printf("\n");
      }
    }
    std::printf("R8: %d of %d swap times leave a hang or an off without an on\n", schlecht, gesamt);
    PRUEF(schlecht == 0);
  }
  {  // R9: a Surge member whose member slot changes keeps its note: the note off still reaches the Surge slot, exactly once
    G su;
    su.art = G::SURGE;
    su.slot = 1;
    TR(t)
    PruefSenke stub(0);
    SurgeAttrappe surge(537);
    cdj::ArrRackSenke rack(t.arr, &stub, &surge, nullptr);
    t.arr.setze_senke_rack(&rack);
    t.arr.setze_senke_wirt(1, &surge);
    t.senken.push_back(&stub);
    t.senken.push_back(&surge);
    G a0 = kit_g(ka.get());
    const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 61, 100}}};
    t.laden(zwei_racks_snap(1, {a0, su}, {}, mit));   // a0 32, Surge 33
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(E0 + 2 * SPB);
    t.laden(zwei_racks_snap(2, {su}, {}, mit));   // a0 leaves, the Surge member is now slot 32 (same Surge slot 1)
    t.lauf(E0 + 9 * SPB);
    bool unter = false;
    const int haengt = bilanz(surge.ev, unter);
    std::printf("R9: Surge events:");
    for (const auto& e : surge.ev) std::printf(" [track %d %d %s z=%lld]", e.spur, e.ton, e.an ? "on" : "off", static_cast<long long>(e.ziel));
    std::printf("\n");
    PRUEF(surge.ev.size() == 2);   // one on, one off
    PRUEF(haengt == 0 && !unter);
    PRUEF(surge.ev.size() == 2 && !surge.ev[1].an && surge.ev[1].ziel == E0 + 6 * SPB);   // the note ends where it was written (the record followed the member), not at the swap
  }
  {  // R9b: a Surge member that leaves while another track still plays the same Surge slot gets its off
    G su;
    su.art = G::SURGE;
    su.slot = 1;
    TR(t)
    PruefSenke stub(0);
    SurgeAttrappe surge(537);
    cdj::ArrRackSenke rack(t.arr, &stub, &surge, nullptr);
    t.arr.setze_senke_rack(&rack);
    t.arr.setze_senke_wirt(1, &surge);
    t.senken.push_back(&stub);
    t.senken.push_back(&surge);
    G a0 = kit_g(ka.get());
    const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 61, 100}}};
    t.laden(zwei_racks_snap(1, {a0, su}, {su}, mit));   // rack 1: a0 32, Surge 33; rack 2: Surge 34 (the same Surge slot 1)
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(E0 + 2 * SPB);
    t.laden(zwei_racks_snap(2, {a0}, {su}, mit));   // the Surge member of rack 1 leaves, rack 2 plays slot 1 on
    t.lauf(E0 + 9 * SPB);
    bool unter = false;
    const int haengt = bilanz(surge.ev, unter);
    std::printf("R9b: Surge events:");
    for (const auto& e : surge.ev) std::printf(" [track %d %d %s z=%lld]", e.spur, e.ton, e.an ? "on" : "off", static_cast<long long>(e.ziel));
    std::printf("\n");
    PRUEF(haengt == 0 && !unter);
  }
  {  // R10: the new owner retrigs the key the leaving member holds, in the swap block: the old owner's off must come first and never cancel the new on
    G su;
    su.art = G::SURGE;
    su.slot = 1;
    const int64_t an_z = E0 + 2 * SPB;
    int schlecht = 0, gesamt = 0;
    for (int mit_surge = 0; mit_surge < 2; ++mit_surge)   // without and with the lead 537
      for (int64_t tausch = an_z - 1500; tausch <= an_z; tausch += 256) {
        if (((tausch + 255) / 256) * 256 > (an_z / 256) * 256) continue;   // the swap block must not lie behind the block of the new note on (it is delivered to the old slot then)
        TR(t)
        PruefSenke stub(0);
        SurgeAttrappe surge(537);
        cdj::ArrRackSenke rack(t.arr, &stub, &surge, nullptr);
        t.arr.setze_senke_rack(&rack);
        t.arr.setze_senke_wirt(1, &surge);
        t.senken.push_back(&stub);
        t.senken.push_back(&surge);
        G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get());
        const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 40, 100}}, {2, {"y", 2.0, 1.0, 40, 100}}};
        std::vector<G> r2 = {b0};
        if (mit_surge) r2.push_back(su);
        t.laden(zwei_racks_snap(1, {a0, a1}, r2, mit));   // a0 32, a1 33, b0 34 (both racks play key 40 on all their kit members)
        t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
        t.lauf(tausch);
        t.laden(zwei_racks_snap(2, {a0}, r2, mit));   // a1 leaves, b0 takes slot 33
        t.lauf(E0 + 8 * SPB);
        // slot 33, key 40: the old owner's on, its off, then the new owner's on and off (in this order, whatever the swap time was)
        std::vector<int> folge;
        for (const auto& e : stub.ev)
          if (e.spur == 33 && e.ton == 40) folge.push_back(e.an ? 1 : 0);
        const bool gut = folge == std::vector<int>{1, 0, 1, 0};
        bool unter = false;
        const int haengt = bilanz(stub.ev, unter);
        ++gesamt;
        if (!gut || haengt || unter) {
          ++schlecht;
          std::printf("R10: lead %d, swap at %lld (%lld before the new note): slot 33 key 40 order:", mit_surge ? 537 : 0, static_cast<long long>(tausch),
                      static_cast<long long>(an_z - tausch));
          for (int f : folge) std::printf(" %s", f ? "on" : "off");
          std::printf("; hang %d\n", haengt);
        }
      }
    std::printf("R10: %d of %d swap times with a wrong order at slot 33\n", schlecht, gesamt);
    PRUEF(schlecht == 0);
  }
  {  // R11 (real sinks): the old owner's RB voice does not sound on after the swap, the new owner's note is intact
    G a;
    a.art = G::RB;
    a.param = {{"cutoff", 0.4f}};
    auto energie = [](const std::vector<float>& v, size_t von, size_t bis) {
      double e = 0.0;
      for (size_t i = von; i < bis && i < v.size(); ++i) e += static_cast<double>(v[i]) * v[i];
      return e;
    };
    // (a) rack 1 {RB, RB} holds key 40; the second member leaves and the RB member of rack 2 takes its slot: rack 2 plays no note, its bus stays silent
    {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
      const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 40, 100}}};
      t.laden(zwei_racks_snap(1, {a, a}, {a}, mit));
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      bus_lauf(t, E0 + 2 * SPB, 1);
      const int64_t tausch = t.s;
      t.laden(zwei_racks_snap(2, {a}, {a}, mit));
      std::vector<float> rest = bus_lauf(t, E0 + 5 * SPB, 1);   // the bus of rack 2, the note of rack 1 still holds until beat 6
      const double e = energie(rest, 4096, rest.size());
      std::printf("R11a: rack 2 bus energy from 4096 samples after the swap (%lld) to beat 5: %.9f\n", static_cast<long long>(tausch), e);
      PRUEF(e < 1e-6);   // the old voice is ended (without the fix it sounds on, under the new owner)
    }
    // (b) the new owner plays the same key 40 in the swap block: its note sounds as if the old one never existed
    {
      const int64_t tausch = ((E0 + 2 * SPB) / 256) * 256;   // the swap block holds the sample of the new note
      auto lauf_y = [&](bool mit_x) {
        TR(t)
        auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
        std::vector<std::pair<int, N>> mit = {{2, {"y", 2.0, 1.0, 40, 100}}};
        if (mit_x) mit.push_back({1, {"x", 0.0, 6.0, 40, 100}});
        t.laden(zwei_racks_snap(1, {a, a}, {a}, mit));
        t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
        bus_lauf(t, tausch, 1);
        t.laden(zwei_racks_snap(2, {a}, {a}, mit));
        return bus_lauf(t, E0 + 3 * SPB + 8192, 1);
      };
      const std::vector<float> mit_x = lauf_y(true), ohne_x = lauf_y(false);
      const double e1 = energie(mit_x, 0, mit_x.size()), e0 = energie(ohne_x, 0, ohne_x.size());
      std::printf("R11b: rack 2 bus energy with the old note %.6f, reference without it %.6f\n", e1, e0);
      PRUEF(e0 > 0.01);
      PRUEF(e1 >= 0.95 * e0);   // the new note is not cut by the old owner's off
    }
  }
  {  // R12 (real sinks): a member that survives under a new slot number while its old slot is left unowned keeps its queued note on. Rack 1 {a0, a1, S}
     // loses a1: a0 stays 32, S 34 -> 33, rack 2 {b0, b1}: b0 35 -> 34, b1 36 -> 35, slot 36 is unowned. The note on of rack 2 (key 80, b1's zone) is queued
     // for the old slot 36 when the swap comes (lead 537) and must sound on b1.
    G su;
    su.art = G::SURGE;
    su.slot = 1;
    su.id = "s";
    G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get(), 0, 69), b1 = kit_g(kb.get(), 70, 127);
    a0.id = "a0";
    a1.id = "a1";
    b0.id = "b0";
    b1.id = "b1";
    const int64_t an_z = E0 + 2 * SPB;
    const double soll = 0.25 * 100 / 127.0;
    int schlecht = 0;
    for (int64_t vor : {1249, 993, 737, 481, 225}) {   // samples between the start of the swap block and the note on
      const int64_t t0 = ((an_z - vor) / 256) * 256;
      TR(t)
      SurgeAttrappe surge(537);
      t.senken.push_back(&surge);
      auto sk_p = std::make_unique<Sinken>(t.arr, &surge); Sinken& sk = *sk_p;
      const std::vector<std::pair<int, N>> mit = {{2, {"y", 2.0, 1.0, 80, 100}}};
      t.laden(zwei_racks_snap(1, {a0, a1, su}, {b0, b1}, mit));
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      std::vector<float> bus = bus_lauf(t, t0, 1);
      t.laden(zwei_racks_snap(2, {a0, su}, {b0, b1}, mit));
      std::vector<float> rest = bus_lauf(t, E0 + 3 * SPB, 1);
      bus.insert(bus.end(), rest.begin(), rest.end());
      float mx = 0.0f;
      for (int64_t i = an_z - 3; i <= an_z + 3; ++i) mx = std::max(mx, std::fabs(bus[i]));
      std::printf("R12: the note on starts %lld samples after the swap block start (%lld): rack 2 bus peak %.4f (expected %.4f)\n", static_cast<long long>(an_z - t0),
                  static_cast<long long>(t0), mx, soll);
      if (std::fabs(mx - soll) > 1e-4) ++schlecht;
    }
    PRUEF(schlecht == 0);
  }
  {  // R13 (real sinks): a leaving kit member ends its one-shots on the slot its successor takes over, whatever number of keys it holds; the stayer is untouched
    auto lang = impuls_kit("lang", 0.01f, 60000);   // a long one-shot on every key
    G a0 = kit_g(lang.get()), a1 = kit_g(lang.get()), b0 = kit_g(lang.get());
    a0.id = "a0";
    a1.id = "a1";
    b0.id = "b0";
    auto energie = [](const std::vector<float>& v, size_t von, size_t bis) {
      double e = 0.0;
      for (size_t i = von; i < bis && i < v.size(); ++i) e += static_cast<double>(v[i]) * v[i];
      return e;
    };
    // rack 1 {a0, a1}, rack 2 {b0}: a1 leaves, b0 takes its slot 33. All notes are rack 1's, rack 2 plays nothing. mit_a1 false: the reference without the leaver.
    // gehalten: the notes are still held at the swap, else they ended before it (the voices ring on, the kit ignores the offs). The buses are those of the
    // blocks from the swap block on (6144 samples).
    auto fahre = [&](int nkeys, bool gehalten, bool mit_a1, std::vector<float>& r1, std::vector<float>& r2) {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
      std::vector<std::pair<int, N>> mit;
      std::vector<std::string> ids;
      ids.reserve(64);
      for (int i = 0; i < nkeys; ++i) {
        ids.push_back("k" + std::to_string(i));
        mit.push_back({1, {ids.back().c_str(), 0.0, gehalten ? 6.0 : 0.25, 40 + i, 100}});
      }
      t.laden(zwei_racks_snap(1, mit_a1 ? std::vector<G>{a0, a1} : std::vector<G>{a0}, {b0}, mit));
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      const int64_t tausch = ((E0 + 2 * SPB) / 256) * 256;
      std::vector<float> v1, v2;
      busse_lauf(t, tausch, v1, v2);
      t.laden(zwei_racks_snap(2, {a0}, {b0}, mit));
      r1.clear();
      r2.clear();
      busse_lauf(t, tausch + 6144, r1, r2);
    };
    int schlecht = 0;
    for (int gehalten = 1; gehalten >= 0; --gehalten)
      for (int nkeys : {8, 32, 33, 40}) {
        if (!gehalten && nkeys > 32) continue;
        std::vector<float> mit1, mit2, ohne1, ohne2;
        fahre(nkeys, gehalten != 0, true, mit1, mit2);
        fahre(nkeys, gehalten != 0, false, ohne1, ohne2);
        const double e2 = energie(mit2, 512, mit2.size());   // rack 2 plays nothing: its bus is silent once the fade block of the leaver is over
        const bool stayer_gleich = mit1.size() == ohne1.size() && std::equal(mit1.begin() + 512, mit1.end(), ohne1.begin() + 512);
        const double e1 = energie(mit1, 512, mit1.size());
        std::printf("R13: notes %s, %d keys: rack 2 bus energy %.9f (silent), the stayer's bus equals the run without the leaver: %d (energy %.6f)\n",
                    gehalten ? "held" : "ended", nkeys, e2, stayer_gleich ? 1 : 0, e1);
        if (e2 > 1e-9 || !stayer_gleich || e1 < 1e-3) ++schlecht;
      }
    PRUEF(schlecht == 0);
  }
  {  // R13 (routing): a stub as the internal sink: a leaving kit member gets exactly one all-off on its slot, at the swap block, the member that stays none;
     // a leaving RB-338 member (the sink honours the offs) gets its offs and no all-off
    for (int rb_abgang = 0; rb_abgang < 2; ++rb_abgang) {
      TR(t)
      PruefSenke stub(0);
      cdj::ArrRackSenke rack(t.arr, &stub, nullptr, nullptr);
      t.arr.setze_senke_rack(&rack);
      t.senken.push_back(&stub);
      G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get());
      if (rb_abgang) {
        a1.art = G::RB;
        a1.param = {{"cutoff", 0.4f}};
      }
      a0.id = "a0";
      a1.id = "a1";
      b0.id = "b0";
      std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 61, 100}}, {1, {"y", 0.0, 6.0, 62, 100}}};
      t.laden(zwei_racks_snap(1, {a0, a1}, {b0}, mit));   // a0 32, a1 33, b0 34
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(E0 + 2 * SPB);
      const int64_t tausch = t.s;
      t.laden(zwei_racks_snap(2, {a0}, {b0}, mit));   // a1 leaves, b0 -> 33
      t.lauf(E0 + 4 * SPB);
      int an33 = 0, aus33 = 0;
      for (const auto& e : stub.ev)
        if (e.spur == 33 && e.ziel >= tausch && e.ziel < tausch + 256) ++(e.an ? an33 : aus33);
      int auf_33 = 0, auf_andere = 0;
      bool im_block = true;
      for (const auto& e : stub.alle_aus_ev) {
        (e.first == 33 ? auf_33 : auf_andere) += 1;
        im_block = im_block && e.second >= tausch && e.second < tausch + 256;
      }
      std::printf("R13 stub (%s leaver): offs to slot 33 at the swap block %d, all-offs on slot 33 %d, on other slots %d\n", rb_abgang ? "RB-338" : "kit", aus33, auf_33,
                  auf_andere);
      PRUEF(aus33 == 2);   // the per-key offs are sent in both cases
      PRUEF(auf_andere == 0);   // nothing for the slot of the stayer or a slot nobody lost
      if (rb_abgang) {
        PRUEF(auf_33 == 0);
      } else {
        PRUEF(auf_33 == 1);
        PRUEF(im_block);
      }
    }
  }
  {  // R14 (stub): two swaps without a block between, the second snapshot at the address of the one the sink saw last (the loader frees and allocates):
     // the sink must take it for a new snapshot, the member that left still ends its note on the slot its successor takes
    TR(t)
    PruefSenke stub(0);
    cdj::ArrRackSenke rack(t.arr, &stub, nullptr, nullptr);
    t.arr.setze_senke_rack(&rack);
    t.senken.push_back(&stub);
    G a0 = kit_g(ka.get()), a1 = kit_g(kb.get()), b0 = kit_g(ka.get());
    a0.id = "a0";
    a1.id = "a1";
    b0.id = "b0";
    const std::vector<std::pair<int, N>> mit = {{1, {"x", 0.0, 6.0, 61, 100}}};
    cdj::ArrSnapshot* erste = zwei_racks_snap(1, {a0, a1}, {b0}, mit);   // a0 32, a1 33, b0 34
    t.laden(erste);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(E0 + 2 * SPB);   // the sink has seen `erste`
    cdj::ArrSnapshot* zwischen = zwei_racks_snap(2, {a0, a1}, {b0}, mit);
    PRUEF(t.arr.tausche(zwischen, t.s, t.k) == erste);   // no block runs now
    cdj::ArrSnapshot* dritte = zwei_racks_snap(3, {a0}, {b0}, mit);   // a1 leaves, b0 -> 33
    *erste = std::move(*dritte);   // the content of the third snapshot lives at the address of the first
    delete dritte;
    if (const cdj::ArrSnapshot* a = t.arr.tausche(erste, t.s, t.k)) t.alt.push_back(a);
    PRUEF(t.arr.snapshot() == erste);
    t.lauf(E0 + 8 * SPB);
    bool unter = false;
    const int haengt = bilanz(stub.ev, unter);
    std::printf("R14: %zu events:", stub.ev.size());
    for (const auto& e : stub.ev) std::printf(" [%d %d %s z=%lld]", e.spur, e.ton, e.an ? "on" : "off", static_cast<long long>(e.ziel));
    std::printf("\n");
    PRUEF(haengt == 0);
    PRUEF(!unter);
  }
  {  // R15 (1.8 T7b, stub as the internal sink): a live key held on rack track 1 (a kit member a0 on slot 32 and a second member a1 on slot 33, both on key 40) never hangs.
     // Every way out of the held key ends both members: the player's off (the rack routes it by the record of the note on), live_alle_aus (disarm, run end, disconnect),
     // the rack track that stops being a rack (swap: the old sink gets the off), a member that leaves while the key is held (a1 is an RB-338 in case 2, a kit in case 4; its
     // slot goes to b0 of rack 2: the leaver pass sends its off, a kit leaver also one all-off; a0 stays and holds the key until the player lets go).
    for (int fall = 0; fall < 5; ++fall) {
      TR(t)
      PruefSenke stub(0);
      cdj::ArrRackSenke rack(t.arr, &stub, nullptr, nullptr);
      t.arr.setze_senke_rack(&rack);
      t.senken.push_back(&stub);
      G a0 = kit_g(ka.get()), a1 = fall == 4 ? kit_g(kb.get()) : G(), b0 = kit_g(ka.get());
      if (fall != 4) {
        a1.art = G::RB;
        a1.param = {{"cutoff", 0.4f}};
      }
      a0.id = "a0";
      a1.id = "a1";
      b0.id = "b0";
      t.laden(zwei_racks_snap(1, {a0, a1}, {b0}, {}));   // a0 32, a1 33, b0 34
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(E0 + 2 * SPB);
      t.arr.live_note(0, t.s + 10, 40, 100, true);
      t.lauf(t.s + 4 * 256);
      PRUEF(t.arr.live_offene_noten() == 1);
      PRUEF(netto(stub.ev, 32, 40) == 1 && netto(stub.ev, 33, 40) == 1);   // both members got the note on
      const int64_t tausch = t.s;
      if (fall == 0) {
        t.arr.live_note(0, t.s + 10, 40, 0, false);   // the player lets go
      } else if (fall == 1) {
        t.arr.live_alle_aus(t.s + 10);
      } else if (fall == 3) {
        t.laden(Bau(2).spur(1, ArrArt::intern).fertig());   // the track stops being a rack: the live off goes to the rack sink that got the on
        PRUEF(t.arr.live_offene_noten() == 0);
      } else {
        t.laden(zwei_racks_snap(2, {a0}, {b0}, {}));   // a1 leaves, b0 -> 33
        PRUEF(t.arr.live_offene_noten() == 1);        // the track keeps its sink: the key stays held
      }
      t.lauf(t.s + 8 * 256);
      bool unter = false;
      const int haengt = bilanz(stub.ev, unter);
      int alle_33 = 0;
      for (const auto& e : stub.alle_aus_ev) alle_33 += e.first == 33 && e.second >= tausch ? 1 : 0;
      std::printf("R15 case %d: %zu events, hanging pairs %d, offs before an on %d, all-offs on slot 33 %d, live table %d\n", fall, stub.ev.size(), haengt, unter ? 1 : 0, alle_33,
                  t.arr.live_offene_noten());
      if (fall == 2 || fall == 4) {
        PRUEF(netto(stub.ev, 33, 40) == 0 && netto(stub.ev, 32, 40) == 1 && haengt == 1);   // the leaver ended, a0 still holds the key
        PRUEF(fall == 4 ? alle_33 >= 1 : alle_33 == 0);                                       // a kit leaver also gets its all-off
        t.arr.live_note(0, t.s + 10, 40, 0, false);
        t.lauf(t.s + 4 * 256);
        PRUEF(bilanz(stub.ev, unter) == 0 && !unter && t.arr.live_offene_noten() == 0);
      } else {
        PRUEF(haengt == 0 && !unter && t.arr.live_offene_noten() == 0);
      }
      PRUEF(rack.verloren() == 0);
    }
  }
  {  // R5: gain
    auto dc = impuls_kit("dc", 0.3f, 20000);
    auto plateau = [&](double gain_db) {
      G g = kit_g(dc.get());
      g.gain_db = gain_db;
      auto bus = rack_lauf(rack_snap(1, 0, {g}, {{"n", 0.0, 0.5, 60, 127}}), 2 * SPB);
      return bus[E0 + 5000];
    };
    const double p0 = plateau(0.0), p6 = plateau(-6.0);
    std::printf("R5: plateau %.6f at 0 dB, %.6f at -6 dB, ratio %.4f dB\n", p0, p6, 20.0 * std::log10(p6 / p0));
    PRUEF_NAH(20.0 * std::log10(p6 / p0), -6.0, 0.01);
    // a gain change while the sound plays: 0 dB -> -20 dB at a swap
    G g0 = kit_g(dc.get()), g1 = kit_g(dc.get());
    g1.gain_db = -20.0;
    auto fahre = [&](double zweites) {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
      g1.gain_db = zweites;
      t.laden(rack_snap(1, 0, {g0}, {{"n", 0.0, 0.5, 60, 127}}));
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      std::vector<float> bus = bus_lauf(t, E0 + 2048);
      t.laden(rack_snap(2, 0, {g1}, {{"n", 0.0, 0.5, 60, 127}}));
      std::vector<float> rest = bus_lauf(t, E0 + 8192);
      bus.insert(bus.end(), rest.begin(), rest.end());
      return bus;
    };
    auto rampe = fahre(-20.0);
    const double schritt = groesster_schritt(rampe, E0 + 4, E0 + 8192);   // after the onset (the input steps 0.3 there)
    std::printf("R5: largest sample step during the gain change %.6f (the input steps 0.3), level before %.4f after %.4f\n", schritt, rampe[E0 + 1000],
                rampe[E0 + 6000]);
    PRUEF(schritt < 0.01);
    PRUEF_NAH(rampe[E0 + 6000], 0.3 * 0.1, 1e-6);   // arrived at -20 dB
    PRUEF_NAH(rampe[E0 + 1000], 0.3, 1e-7);
    auto flach = fahre(0.0);   // negative control: the gain does not change, the plateau stays flat to the last bit
    PRUEF(groesster_schritt(flach, E0 + 4, E0 + 8192) == 0.0);
  }
  {  // R6: mixed lead
    auto imp = impuls_kit("imp", 1.0f);
    TR(t)
    SurgeAttrappe surge(537);
    t.senken.push_back(&surge);
    auto sk_p = std::make_unique<Sinken>(t.arr, &surge); Sinken& sk = *sk_p;
    G s;
    s.art = G::SURGE;
    s.slot = 1;
    const std::vector<N> noten = {{"n", 1.0, 0.5, 60, 127}};
    t.laden(rack_snap(1, 0, {kit_g(imp.get()), s}, noten));
    PRUEF(sk.rack.vorhalt() == 537);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    auto bus = bus_lauf(t, 3 * SPB);
    const std::vector<int64_t> hit = treffer(bus);
    std::printf("R6: bus hits at");
    for (int64_t h : hit) std::printf(" %lld (%.4f)", static_cast<long long>(h), bus[h]);
    std::printf("; expected one sample %lld holding 1.25\n", static_cast<long long>(E0 + SPB));
    PRUEF(hit.size() == 1 && hit[0] == E0 + SPB);   // both onsets on the same sample: 1.0 (kit) + 0.25 (Surge stand-in)
    if (hit.size() == 1) PRUEF(bus[hit[0]] == 1.25f);
    // negative control: without a Surge member the lead is 0 and the kit alone sounds on the sample
    Treiber t2;
    SurgeAttrappe surge2(537);
    Sinken sk2(t2.arr, &surge2);
    t2.laden(rack_snap(1, 0, {kit_g(imp.get())}, noten));
    PRUEF(sk2.rack.vorhalt() == 0);
    t2.arr.start(0.0, 0, false, t2.s, 537, 256, t2.k);
    auto bus2 = bus_lauf(t2, 3 * SPB);
    const std::vector<int64_t> hit2 = treffer(bus2);
    PRUEF(hit2.size() == 1 && hit2[0] == E0 + SPB && bus2[hit2[0]] == 1.0f);
  }
  {  // R0: one member that covers everything equals the plain track with that device
    G a;
    a.art = G::RB;
    a.param = {{"cutoff", 0.4f}, {"resonanz", 0.6f}};
    const std::vector<N> noten = {{"a", 0.0, 1.0, 40, 127}, {"b", 1.5, 0.5, 47, 110}, {"c", 2.0, 1.0, 52, 60}};
    auto bus = rack_lauf(rack_snap(1, 0, {a}, noten), BIS);
    auto ref = plain_lauf(plain_snap(1, a, noten), BIS);
    double e = 0.0;
    for (float v : ref) e += static_cast<double>(v) * v;
    PRUEF(e > 0.0);
    PRUEF(bitgleich(bus, ref));
  }
  {  // L: a member that is removed fades over one block, the other goes on
    auto da = impuls_kit("da", 0.3f, 40000), db = impuls_kit("db", 0.2f, 40000);
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
    const std::vector<N> noten = {{"n", 0.0, 0.5, 60, 127}};
    t.laden(rack_snap(1, 0, {kit_g(da.get()), kit_g(db.get())}, noten));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    std::vector<float> bus = bus_lauf(t, E0 + 4096);
    const int64_t tausch = t.s;
    PRUEF(sk.rack.glieder(0) == 2);
    PRUEF_NAH(bus[tausch - 1], 0.5, 1e-6);   // both sound: 0.3 + 0.2
    t.laden(rack_snap(2, 0, {kit_g(da.get())}, noten));   // B leaves
    std::vector<float> rest = bus_lauf(t, tausch + 2048);
    bus.insert(bus.end(), rest.begin(), rest.end());
    const double schritt = groesster_schritt(bus, tausch - 8, tausch + 1024);
    std::printf("L: step at the swap %.6f, level after the fade block %.6f, records %d\n", schritt, bus[tausch + 600], sk.rack.glieder(0));
    PRUEF(schritt < 0.01);
    PRUEF_NAH(bus[tausch + 600], 0.3, 1e-6);   // A alone, unchanged
    PRUEF(sk.rack.glieder(0) == 1);             // the record of B is freed
  }
  {  // A: no allocation
    auto imp = impuls_kit("imp", 1.0f, 400);
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr); Sinken& sk = *sk_p;
    G r;
    r.art = G::RB;
    r.param = {{"cutoff", 0.4f}};
    G k2 = kit_g(imp.get());
    std::vector<N> noten;
    for (int i = 0; i < 32; ++i) noten.push_back({nullptr, 0.0, 0.0, 0, 0});
    std::vector<std::string> ids;
    ids.reserve(40);
    noten.clear();
    for (int i = 0; i < 24; ++i) {
      ids.push_back("n" + std::to_string(i));
      noten.push_back({ids.back().c_str(), 0.125 * i, 0.1, 36 + (i % 12), 100});
    }
    t.laden(rack_snap(1, 0, {r, k2}, noten));
    cdj::ArrSnapshot* zweit = rack_snap(2, 0, {k2, r}, noten, 1, 0);   // the swap that exchanges the two members
    float b[6][cdj::ARR_BLOCK];
    auto bloecke = [&](int n) {
      for (int i = 0; i < n; ++i) {
        for (auto& x : b) std::fill(x, x + 256, 0.0f);
        t.arr.block(t.k, t.s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
        t.s += 256;
      }
    };
    t.alt.reserve(8);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    g_allokationen = 0;
    g_waechter = true;
    bloecke(40);                                           // notes in, notes out
    if (const cdj::ArrSnapshot* alt = t.arr.tausche(zweit, t.s, t.k)) t.alt.push_back(alt);   // the swap that moves the members
    bloecke(40);
    t.arr.stopp(0, t.s, t.k);                              // all notes off
    bloecke(8);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);        // transport start
    bloecke(40);
    g_waechter = false;
    std::printf("A: %ld allocations in the watch window\n", g_allokationen.load());
    PRUEF(g_allokationen.load() == 0);
    g_allokationen = 0;   // positive control: the guard does count
    g_waechter = true;
    auto* p = new int(1);
    g_waechter = false;
    PRUEF(g_allokationen.load() == 1);
    delete p;
    PRUEF(sk.rack.verloren() == 0);
  }
  PRUEF_ENDE();
}
