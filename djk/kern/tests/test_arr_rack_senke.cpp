// Package 1.9 U6 (T6.3): the instrument rack as a sink (arr_rack_senke.h), through the arrangement with the real RB-338, kit and dispatcher sinks and
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
// Mutations: ARR_RACK_ZONE_EXKLUSIV (R1), ARR_RACK_OFF_AN_ALLE (R4), ARR_RACK_GAIN_SPRUNG (R5), ARR_RACK_OHNE_VORHALT (R6).
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

#include "arr_bau.h"
#include "cypherdj/arr_bk_senke.h"
#include "cypherdj/arr_intern_senke.h"
#include "cypherdj/arr_kit_senke.h"
#include "cypherdj/arr_rack_senke.h"
#include "cypherdj/arr_rb_senke.h"
#include "cypherdj/kit.h"
#include "pruef.h"

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
