// 1.9 U8 T9 (spec E10 to E12, AK-M1, AK-G2): rack macros that drive MEMBERS of an instrument rack (ArrRack::g / ng, Arrangement::glied_makros_, ArrRackSenke::glied_parameter).
// The rack track holds up to four members (RB-338, Baukasten graph, kit); a macro target {makro, glied, param, von, bis} sets one parameter of one member to `von + m * (bis - von)`:
// param 0..3 = the RB-338 parameters (lautstaerke, cutoff, resonanz, env_mod), 8..15 = the Baukasten knobs k1..k8, 16 = the gain of the member in dB. The real RB-338, Baukasten
// and kit sinks run behind the dispatcher; the RB-338 parameter is read from the sink's set log (what reached cypher_rb_setze), the others from the track bus.
// Cases:
//   M1 RB (AK-M1): macro 0 gives `von` on the member's cutoff, macro 1 gives `bis`, the move lands in the block that follows the write of the row; the member's own value
//      (0.5 in the snapshot) is ignored while the macro maps it; a new snapshot with another own value does not win either
//   M2 gain: macro 0.5 between -12 and 0 dB gives -6 dB within 0.01 dB (the member's own snapshot gain of -3 dB is ignored), ramped over one block (no step above the ramp),
//      the macro at 1 gives the snapshot-independent 0 dB; a kit member takes the gain target as well
//   M3 knob: a bk member's k1 follows the macro, bit-equal to the same rack whose snapshot holds that knob value (macro 1 and macro 0); the values differ from each other
//   M4 stopped transport (live monitor path): without start() the macro still moves the RB parameter, block after block
//   M5 target gone: a swap to a snapshot without member targets gives the member's own value back in that block; a rack with a slot but no targets renders bit-equal to
//      a rack track without any rack (the macro rows move, nothing changes)
//   M6 bad targets built by hand (member index beyond the members, a device parameter on a kit member, a knob on an RB-338 member, a Surge-less index 3 on a bk member) do nothing
//   M7 keine_allokation (AK-G2): 2000 blocks over an RB, a bk and a kit member with a macro moving every block and a swap, 0 allocations, locks and sleeps; positive control
//      (skipped with a message where the allocation watcher is not available: sanitizer builds)
//   M8 the real loader with a bk member (graph from a folder): a knob target 8..15 and the gain 16 on a bk member load, an RB-338 parameter 0..3 on it is refused
// Mutations (CMakeLists.txt, as measured): MAKRO_GLIED_ROW_GEWINNT (M1 to M5), MAKRO_GLIED_FALSCHES_GLIED (M1 to M7; M6 and M7 only in part).
//   M9 start value (fix round 2): a mapped RB-338 member (own 0.5, von 0.2 / bis 0.8) renders sample-equal from frame 0 to a plain member at that value (no glide from the stored value
//      at the transport start); counter-check: a macro move in the middle of the playback equals the plain member moved by a swap (still smoothed), and no snap
// Mutations of M9: ARR_RB_START_GLEITET, ARR_RB_START_VORAB_EIGEN, ARR_RB_LIVE_SPRUNG (see CMakeLists.txt).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_loader.h"
#include "cypherdj/arr_rack_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/kit.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: the track buses
  static const float* bus_l(const Arrangement& a, int i) { return a.bus_l_[i]; }
};
struct ArrRbPruefZugang {   // friend of ArrRbSenke: the set log, read between blocks on the driving thread
  static uint64_t n(const ArrRbSenke& s) { return s.protokoll_n_.load(); }
  static const ArrRbSenke::Protokoll* e(const ArrRbSenke& s, uint64_t i) { return s.protokoll_lies(i); }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrGliedZiel;

namespace {

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
constexpr int64_t V = 537;

std::unique_ptr<cdj::Kit> dc_kit(const char* name, float amp, int64_t frames) {
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

struct M {   // one member
  enum Art { RB, BK, KIT } art = RB;
  std::vector<std::pair<const char*, float>> param;   // the member's own values
  CypherBk* bk = nullptr;
  const cdj::Kit* kit = nullptr;
  double gain_db = 0.0;
};
M rb(std::vector<std::pair<const char*, float>> p = {}, double gain_db = 0.0) {
  M m;
  m.art = M::RB;
  m.param = std::move(p);
  m.gain_db = gain_db;
  return m;
}
M bk(CypherBk* h, std::vector<std::pair<const char*, float>> p = {}) {
  M m;
  m.art = M::BK;
  m.bk = h;
  m.param = std::move(p);
  return m;
}
M kit(const cdj::Kit* k, double gain_db = 0.0) {
  M m;
  m.art = M::KIT;
  m.kit = k;
  m.gain_db = gain_db;
  return m;
}
ArrGliedZiel zg(int makro, int glied, int param, float von, float bis) {
  ArrGliedZiel z;
  z.makro = static_cast<uint8_t>(makro);
  z.glied = static_cast<uint8_t>(glied);
  z.param = static_cast<uint8_t>(param);
  z.von = von;
  z.bis = bis;
  return z;
}

// rack track 1 with the members; one note (key 60, from beat 0, 8 beats long); the member targets in the rack of the pool slot 0 (slot = -1: no rack at all)
cdj::ArrSnapshot* rack_snap(int64_t nr, const std::vector<M>& ml, const std::vector<ArrGliedZiel>& ziele, int slot = 0, double note_beat = 0.0) {
  Bau b(nr);
  b.spur(1, ArrArt::rack);
  b.note(1, "n1", note_beat, 8.0, 60, 100);
  cdj::ArrSnapshot* s = b.fertig();
  cdj::ArrSpur& sp = s->spur[0];
  std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
  sp.kette = 0;
  sp.n_glieder = static_cast<int>(ml.size());
  for (size_t i = 0; i < ml.size(); ++i) {
    const M& m = ml[i];
    cdj::ArrGlied& gd = sp.glied[i];
    gd.id = cdj::arr_id(std::string("m") + std::to_string(i));
    gd.platz = cdj::ARR_SPUREN + static_cast<int>(i);
    gd.art = ArrArt::intern;
    gd.gain = static_cast<float>(std::pow(10.0, m.gain_db / 20.0));
    cdj::ArrSpur& dev = s->glied_spur[gd.platz - cdj::ARR_SPUREN];
    dev.nr = gd.platz + 1;
    dev.art = ArrArt::intern;
    if (m.art == M::KIT) {
      std::snprintf(dev.geraet, sizeof dev.geraet, "kit");
      std::snprintf(dev.kit, sizeof dev.kit, "%s", m.kit->name.c_str());
      dev.kit_ptr = m.kit;
      dev.kit_gen = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(m.kit));
    } else {
      std::snprintf(dev.geraet, sizeof dev.geraet, m.art == M::BK ? "bk" : "rb338");
      if (m.art == M::BK) {
        std::snprintf(dev.graph, sizeof dev.graph, "t");
        dev.bk = m.bk;
        dev.bk_gen = 1;
      }
      for (const auto& p : m.param) {
        std::snprintf(dev.param[dev.n_param].name, sizeof dev.param[0].name, "%s", p.first);
        dev.param[dev.n_param++].wert = p.second;
      }
    }
  }
  cdj::ArrRack& r = s->rack[0];
  r.slot = static_cast<int8_t>(slot);
  r.n = 0;
  r.ng = static_cast<uint8_t>(ziele.size());
  for (size_t i = 0; i < ziele.size(); ++i) r.g[i] = ziele[i];
  return s;
}

struct Sinken {
  cdj::ArrRbSenke rb;
  cdj::ArrBkSenke bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  cdj::ArrRackSenke rack;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk(a), kit(a), intern(a, &rb, &bk, &kit), rack(a, &intern, nullptr, nullptr) {
    a.setze_senke_intern(&intern);
    a.setze_senke_rack(&rack);
  }
};

int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
void makro(Treiber& t, int n, float w) { t.arr.setze_sofort(reg(t, "rack/1/m" + std::to_string(n)), w); }   // n = 1..4

// the track bus of track 1, block by block: runs until bis, appends to bus
void bus_lauf(Treiber& t, int64_t bis, std::vector<float>& bus) {
  float b[6][cdj::ARR_BLOCK];
  while (t.s < bis) {
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    const float* q = cdj::ArrPruefZugang::bus_l(t.arr, 0);
    bus.insert(bus.end(), q, q + t.n);
    t.s += t.n;
  }
}

// the last value that reached cypher_rb_setze under `name` on the sink slot `platz`; NaN: none in the ring
float rb_letzter(const cdj::ArrRbSenke& rb, int platz, const char* name) {
  const uint64_t n = cdj::ArrRbPruefZugang::n(rb);
  for (uint64_t i = n; i-- > 0;) {
    const auto* e = cdj::ArrRbPruefZugang::e(rb, i);
    if (e && e->spur == platz && std::strcmp(e->name, name) == 0) return e->wert;
  }
  return std::nanf("");
}

double db(double x) { return 20.0 * std::log10(x); }
double mittel(const std::vector<float>& v, size_t von, size_t bis) {
  double s = 0.0;
  for (size_t i = von; i < bis; ++i) s += v[i];
  return s / static_cast<double>(bis - von);
}
bool bitgleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}
double energie(const std::vector<float>& v) {
  double e = 0.0;
  for (float x : v) e += static_cast<double>(x) * x;
  return e;
}

}  // namespace

int main() {
  auto k_klein = dc_kit("kit_k", 0.05f, 1);
  auto k_dc = dc_kit("kit_dc", 0.2f, 48000 * 3);

  {  // M1 RB (AK-M1): cutoff of member 1 (the kit is member 0, so an off-by-one in the index lands on the kit)
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr);
    Sinken& sk = *sk_p;
    const std::vector<M> ml = {kit(k_klein.get()), rb({{"cutoff", 0.5f}})};
    makro(t, 1, 0.0f);
    t.laden(rack_snap(1, ml, {zg(0, 1, 1, 0.2f, 0.8f)}));
    t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
    std::vector<float> bus;
    bus_lauf(t, 1024, bus);
    const float c0 = rb_letzter(sk.rb, 33, "cutoff");
    makro(t, 1, 1.0f);
    bus_lauf(t, t.s + 256, bus);
    const float c1 = rb_letzter(sk.rb, 33, "cutoff");
    makro(t, 1, 0.5f);
    bus_lauf(t, t.s + 256, bus);
    const float cm = rb_letzter(sk.rb, 33, "cutoff");
    // a swap to a snapshot whose own cutoff is 0.9: the macro still wins
    t.laden(rack_snap(2, {kit(k_klein.get()), rb({{"cutoff", 0.9f}})}, {zg(0, 1, 1, 0.2f, 0.8f)}));
    bus_lauf(t, t.s + 512, bus);
    const float cs = rb_letzter(sk.rb, 33, "cutoff");
    std::printf("M1: cutoff on member 1: macro 0 -> %.4f, macro 1 -> %.4f, macro .5 -> %.4f, after a swap (own value 0.9) -> %.4f\n", c0, c1, cm, cs);
    PRUEF_NAH(c0, 0.2, 1e-6);   // m = 0 gives von, whatever the member's own value says
    PRUEF_NAH(c1, 0.8, 1e-6);   // m = 1 gives bis, in the block after the row was written
    PRUEF_NAH(cm, 0.5, 1e-6);
    PRUEF_NAH(cs, 0.5, 1e-6);
    PRUEF(std::isnan(rb_letzter(sk.rb, 32, "cutoff")));   // negative control: the kit member (slot 32) got no RB parameter
    PRUEF(sk.rb.parameter_gemeldet() > 0);
  }

  {  // M2 gain: member 0 is a DC kit with its own gain of -3 dB; macro 2 maps the gain -12 .. 0 dB
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr);
    Sinken& sk = *sk_p;
    double lref = 0.0;   // reference: the same kit member with 0 dB and no target
    {
      TR(r)
      auto skr_p = std::make_unique<Sinken>(r.arr);
      r.laden(rack_snap(1, {kit(k_dc.get(), 0.0)}, {}));
      r.arr.start(0.0, 0, false, r.s, V, 256, r.k);
      std::vector<float> rb;
      bus_lauf(r, 8192, rb);
      lref = mittel(rb, rb.size() - 256, rb.size());
    }
    makro(t, 2, 1.0f);
    t.laden(rack_snap(1, {kit(k_dc.get(), -3.0)}, {zg(1, 0, cdj::ARR_GLIED_PARAM_GAIN_DB, -12.0f, 0.0f)}));
    t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
    std::vector<float> bus;
    bus_lauf(t, 8192, bus);
    const size_t n1 = bus.size();
    const double l1 = mittel(bus, n1 - 256, n1);   // macro 1 = 0 dB
    makro(t, 2, 0.5f);
    bus_lauf(t, t.s + 256, bus);
    const size_t a0 = n1, a1 = bus.size();
    double groesster = 0.0;
    for (size_t i = a0; i < a1; ++i) groesster = std::max(groesster, std::fabs(static_cast<double>(bus[i]) - bus[i - 1]));
    bus_lauf(t, t.s + 512, bus);
    const size_t n2 = bus.size();
    const double l2 = mittel(bus, n2 - 256, n2);
    const double rampe = std::fabs(l1 - l2) / 256.0;
    std::printf("M2: gain: macro 1 level %.5f, macro .5 level %.5f -> %.3f dB (expected -6.000), largest step in the ramp block %.6f (ramp slope %.6f)\n", l1, l2, db(l2 / l1), groesster, rampe);
    PRUEF_NAH(db(l1 / lref), 0.0, 0.01);       // the own gain of -3 dB is ignored: 0 dB gives the kit as it is (reference without a target)
    PRUEF_NAH(db(l2 / l1), -6.0, 0.01);        // m = 0.5 between -12 and 0 dB
    PRUEF(groesster < 1.5 * rampe + 1e-6);     // one ramp over the block, no step
    PRUEF(groesster > 0.5 * rampe);            // and it is a ramp, not nothing
    makro(t, 2, 0.0f);
    bus_lauf(t, t.s + 768, bus);
    const double l3 = mittel(bus, bus.size() - 256, bus.size());
    PRUEF_NAH(db(l3 / l1), -12.0, 0.01);       // m = 0 gives von
    (void)sk;
  }

  {  // M3 knob: bk member k1, bit-equal to the rack that holds the value itself
    auto lauf = [&](float k1_snap, bool mit_ziel, float makro_wert) {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr);
      Sinken& sk = *sk_p;
      CypherBk* h = bkt::neu(bkt::G_T);
      std::vector<float> bus;
      if (mit_ziel) makro(t, 3, makro_wert);
      t.laden(rack_snap(1, {kit(k_klein.get()), bk(h, {{"k1", k1_snap}})}, mit_ziel ? std::vector<ArrGliedZiel>{zg(2, 1, cdj::ARR_GLIED_PARAM_BK0 + 0, 0.2f, 0.9f)} : std::vector<ArrGliedZiel>{}));
      t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
      bus_lauf(t, 6144, bus);
      (void)sk;
      cypher_bk_frei(h);
      return bus;
    };
    const std::vector<float> m1 = lauf(0.5f, true, 1.0f), r1 = lauf(0.9f, false, 0.0f);
    const std::vector<float> m0 = lauf(0.5f, true, 0.0f), r0 = lauf(0.2f, false, 0.0f);
    const double e1 = energie(m1), e0 = energie(m0);
    std::printf("M3: bk k1: macro 1 vs own 0.9 bit-equal %d, macro 0 vs own 0.2 bit-equal %d; energy at macro 1 %.4f, at macro 0 %.4f (ratio %.3f, k1 ratio %.3f)\n", bitgleich(m1, r1) ? 1 : 0,
                bitgleich(m0, r0) ? 1 : 0, e1, e0, e0 / e1, (0.2 / 0.9) * (0.2 / 0.9));
    PRUEF(e1 > 1e-6 && e0 > 1e-6);   // the instance sounds (a silent pair is bit-equal for nothing)
    PRUEF(bitgleich(m1, r1));
    PRUEF(bitgleich(m0, r0));
    PRUEF(!bitgleich(m1, m0));       // negative control: the two macro values sound different
  }

  {  // M4 stopped transport: no start(), the snapshot is loaded and blocks run (the live monitor)
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr);
    Sinken& sk = *sk_p;
    makro(t, 1, 0.0f);
    t.laden(rack_snap(1, {rb({{"cutoff", 0.5f}})}, {zg(0, 0, 1, 0.2f, 0.8f)}));
    std::vector<float> bus;
    bus_lauf(t, 1024, bus);
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);
    const float c0 = rb_letzter(sk.rb, 32, "cutoff");
    makro(t, 1, 1.0f);
    bus_lauf(t, t.s + 256, bus);
    const float c1 = rb_letzter(sk.rb, 32, "cutoff");
    makro(t, 1, 0.25f);
    bus_lauf(t, t.s + 256, bus);
    const float c2 = rb_letzter(sk.rb, 32, "cutoff");
    std::printf("M4: transport stopped: cutoff macro 0 -> %.4f, 1 -> %.4f, .25 -> %.4f\n", c0, c1, c2);
    PRUEF_NAH(c0, 0.2, 1e-6);
    PRUEF_NAH(c1, 0.8, 1e-6);
    PRUEF_NAH(c2, 0.35, 1e-6);
  }

  {  // M5 target gone, and a rack without targets
    {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr);
      Sinken& sk = *sk_p;
      makro(t, 1, 1.0f);
      t.laden(rack_snap(1, {rb({{"cutoff", 0.5f}})}, {zg(0, 0, 1, 0.2f, 0.8f)}));
      t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
      std::vector<float> bus;
      bus_lauf(t, 2048, bus);
      const float mit = rb_letzter(sk.rb, 32, "cutoff");
      t.laden(rack_snap(2, {rb({{"cutoff", 0.5f}})}, {}));   // the targets are gone, the rack row stays
      bus_lauf(t, t.s + 512, bus);
      const float ohne = rb_letzter(sk.rb, 32, "cutoff");
      std::printf("M5: with the target %.4f, after the swap without it %.4f (own value 0.5)\n", mit, ohne);
      PRUEF_NAH(mit, 0.8, 1e-6);
      PRUEF_NAH(ohne, 0.5, 1e-6);   // the member's own value is back
    }
    auto lauf = [&](int slot) {   // a rack track with the macro rows moving; slot 0 = a rack with no targets, -1 = no rack at all
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr);
      Sinken& sk = *sk_p;
      t.laden(rack_snap(1, {kit(k_dc.get(), -2.0), rb({{"cutoff", 0.6f}})}, {}, slot));
      t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
      std::vector<float> bus;
      for (int i = 0; i < 16; ++i) {
        makro(t, 1 + i % 4, static_cast<float>(i % 5) / 4.0f);
        bus_lauf(t, t.s + 256, bus);
      }
      (void)sk;
      return bus;
    };
    const std::vector<float> a = lauf(0), b = lauf(-1);
    PRUEF(a.size() == 4096 && energie(a) > 1e-6);
    PRUEF(bitgleich(a, b));   // error case: a rack without member targets renders bit-equal to a rack track without a rack
  }

  {  // M6 bad targets built by hand do nothing
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr);
    Sinken& sk = *sk_p;
    CypherBk* h = bkt::neu(bkt::G_T);
    makro(t, 1, 1.0f);
    // member 0 kit, member 1 bk, member 2 RB (own cutoff 0.5): index 3 does not exist; cutoff (1) on the kit; a knob (8) on the RB member; an RB parameter (1) on the bk member
    t.laden(rack_snap(1, {kit(k_klein.get()), bk(h, {{"k1", 0.5f}}), rb({{"cutoff", 0.5f}})},
                      {zg(0, 3, 1, 0.1f, 0.2f), zg(0, 0, 1, 0.1f, 0.2f), zg(0, 2, cdj::ARR_GLIED_PARAM_BK0, 0.1f, 0.2f), zg(0, 1, 1, 0.1f, 0.2f)}));
    t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
    std::vector<float> bus;
    bus_lauf(t, 2048, bus);
    const float c = rb_letzter(sk.rb, 34, "cutoff");
    std::printf("M6: bad targets: cutoff of the RB member %.4f (own value 0.5), reported values %llu\n", c, static_cast<unsigned long long>(sk.rb.parameter_gemeldet()));
    PRUEF_NAH(c, 0.5, 1e-6);
    PRUEF(sk.rb.parameter_gemeldet() == 0);
    cypher_bk_frei(h);   // no block runs after this point
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("M7 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // M7 keine_allokation (AK-G2)
    TR(t)
    auto sk_p = std::make_unique<Sinken>(t.arr);
    Sinken& sk = *sk_p;
    CypherBk* h = bkt::neu(bkt::G_T);
    const std::vector<ArrGliedZiel> ziele = {zg(0, 0, 0, 0.1f, 0.9f), zg(0, 0, 1, 0.2f, 0.8f), zg(1, 0, 2, 0.0f, 1.0f), zg(1, 0, 3, 0.3f, 0.6f), zg(2, 1, cdj::ARR_GLIED_PARAM_BK0, 0.2f, 0.9f),
                                             zg(3, 2, cdj::ARR_GLIED_PARAM_GAIN_DB, -24.0f, 6.0f), zg(3, 0, cdj::ARR_GLIED_PARAM_GAIN_DB, -12.0f, 0.0f)};
    const std::vector<M> ml = {rb({{"cutoff", 0.5f}}), bk(h, {{"k1", 0.5f}}), kit(k_dc.get())};
    cdj::ArrSnapshot* s0 = rack_snap(1, ml, ziele);
    cdj::ArrSnapshot* s1 = rack_snap(2, ml, {});   // the targets leave
    cdj::ArrSnapshot* s2 = rack_snap(3, ml, ziele);
    makro(t, 1, 0.3f);
    t.laden(s0);
    t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
    t.lauf(20000);
    const int r1 = reg(t, "rack/1/m1"), r2 = reg(t, "rack/1/m2"), r3 = reg(t, "rack/1/m3"), r4 = reg(t, "rack/1/m4");
    float b[6][cdj::ARR_BLOCK];
    int64_t s = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(4);   // the vector itself must not allocate inside the window
    const uint64_t g0 = sk.rb.parameter_gemeldet();
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 700) alt.push_back(t.arr.tausche(s1, s, t.k));
      if (blk == 1300) alt.push_back(t.arr.tausche(s2, s, t.k));
      t.arr.setze_sofort(r1, static_cast<float>(blk % 17) / 16.0f);
      t.arr.setze_sofort(r2, static_cast<float>(blk % 13) / 12.0f);
      t.arr.setze_sofort(r3, static_cast<float>(blk % 11) / 10.0f);
      t.arr.setze_sofort(r4, static_cast<float>(blk % 7) / 6.0f);
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      s += 256;
    }
    const long im_fenster = abfang_aus();
    const AbfangZahlen z = abfang_zahlen();
    std::printf("M7: allocations in 2000 blocks = %ld (alloc %ld, free %ld, locks %ld, sleeps %ld); values reported to the RB sink: %llu\n", im_fenster, z.alloc, z.frei, z.sperren, z.schlafen,
                static_cast<unsigned long long>(sk.rb.parameter_gemeldet() - g0));
    PRUEF(im_fenster == 0);
    PRUEF(z.summe() == 0);
    PRUEF(sk.rb.parameter_gemeldet() - g0 > 4 * 1000);   // the hook ran: 4 RB parameters in about 1400 blocks with targets (an empty run proves nothing)
    for (const cdj::ArrSnapshot* x : alt) delete x;
    abfang_an();
    { cdj::ArrInserts zweites; }
    const long bau_zaehlt = abfang_aus();
    PRUEF(bau_zaehlt > 0);   // positive control: the watcher counts
    cypher_bk_frei(h);
  }

  {  // M9 start value (fix round 2): a mapped RB-338 member starts on its mapped value, not on its own value (no glide at the transport start)
    // render: rack track, one RB member, one note from beat 0; `eigen` = the member's own cutoff, `ziele` the member targets, `m0` the macro value written before the start
    auto render = [&](float eigen, const std::vector<ArrGliedZiel>& ziele, float m0, int64_t bis, int64_t tausch_bei, float eigen2, float m1, int64_t makro_bei, int vorlauf = 0) {
      TR(t)
      auto sk_p = std::make_unique<Sinken>(t.arr);
      Sinken& sk = *sk_p;
      (void)sk;
      makro(t, 1, m0);
      t.laden(rack_snap(1, {rb({{"cutoff", eigen}})}, ziele));
      std::vector<float> bus;
      if (vorlauf > 0) {   // the monitor pre-roll of the live core: blocks with the playback loaded and the transport standing, then the start
        std::vector<float> weg;
        bus_lauf(t, t.s + 256 * vorlauf, weg);
      }
      const int64_t s_start = t.s;
      t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
      bis += s_start;   // `bis` and the instants below count from the start
      if (tausch_bei >= 0) tausch_bei += s_start;
      if (makro_bei >= 0) makro_bei += s_start;
      while (t.s < bis) {
        if (tausch_bei >= 0 && t.s == tausch_bei) t.laden(rack_snap(2, {rb({{"cutoff", eigen2}})}, ziele));
        if (makro_bei >= 0 && t.s == makro_bei) makro(t, 1, m1);
        bus_lauf(t, t.s + 256, bus);
      }
      return bus;
    };
    const std::vector<ArrGliedZiel> z = {zg(0, 0, 1, 0.2f, 0.8f)};
    const std::vector<float> a0v = render(0.5f, z, 0.0f, 8192, -1, 0, 0, -1, 7);    // with the monitor pre-roll (7 blocks standing) before the start, as the live core does
    const std::vector<float> p0v = render(0.2f, {}, 0.0f, 8192, -1, 0, 0, -1, 7);
    const std::vector<float> a0 = render(0.5f, z, 0.0f, 8192, -1, 0, 0, -1);        // own 0.5, mapped to 0.2 (macro 0)
    const std::vector<float> p0 = render(0.2f, {}, 0.0f, 8192, -1, 0, 0, -1);       // plain member at 0.2
    const std::vector<float> a1 = render(0.5f, z, 1.0f, 8192, -1, 0, 0, -1);        // own 0.5, mapped to 0.8 (macro 1)
    const std::vector<float> p1 = render(0.8f, {}, 0.0f, 8192, -1, 0, 0, -1);       // plain member at 0.8
    size_t erst0 = a0.size(), erst1 = a1.size();   // first differing frame
    for (size_t i = 0; i < a0.size() && i < p0.size(); ++i) if (a0[i] != p0[i]) { erst0 = i; break; }
    for (size_t i = 0; i < a1.size() && i < p1.size(); ++i) if (a1[i] != p1[i]) { erst1 = i; break; }
    std::printf("M9: start value: macro 0 (own 0.5, von 0.2) first differs from the plain 0.2 member at frame %zu of %zu, macro 1 (bis 0.8) from the plain 0.8 member at %zu\n", erst0, a0.size(), erst1);
    PRUEF(energie(a0) > 1e-6 && energie(a1) > 1e-6 && !bitgleich(a0, a1));   // the note sounds, and the two ends differ
    PRUEF(bitgleich(a0, p0));   // sample-equal from frame 0
    PRUEF(energie(a0v) > 1e-6 && bitgleich(a0v, p0v));   // also after a monitor pre-roll (the playback loaded and running before the start)
    PRUEF(bitgleich(a1, p1));
    // counter-check: a macro move in the middle of the playback keeps its smoothing: it equals the plain member whose own value moves 0.2 -> 0.8 by a swap in the same block
    // (the smoothed path of a parameter change), and it is not the plain member at 0.2 any more
    const std::vector<float> mv = render(0.5f, z, 0.0f, 8192, -1, 0, 1.0f, 2048);
    const std::vector<float> sw = render(0.2f, {}, 0.0f, 8192, 2048, 0.8f, 0, -1);
    PRUEF(std::equal(mv.begin(), mv.begin() + 2048, p0.begin()));   // before the move: the plain member at 0.2
    PRUEF(!bitgleich(mv, p0));                                      // the move acts
    PRUEF(!bitgleich(mv, p1));                                      // and it is no snap to a plain 0.8 member (the filter state is the 0.2 one)
    PRUEF(bitgleich(mv, sw));
  }

  {  // M8 the loader with a bk member
    arrdatei::Ordner o("test_arr_rack_makro_lader");
    const std::string bkdir = o.pfad + "/bk";
    std::filesystem::create_directories(bkdir);
    std::ofstream(bkdir + "/t.json") << bkt::G_T;
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bkdir);
    auto spur = [](const std::string& ziele) {
      return "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":[{\"id\":\"b\",\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\"}],"
             "\"rack\":{\"slot\":1,\"ziele\":[" + ziele + "]},\"noten\":[]}";
    };
    auto ziel = [](int param, double von, double bis) {
      char b[160];
      std::snprintf(b, sizeof b, "{\"makro\":0,\"glied\":0,\"param\":%d,\"von\":%g,\"bis\":%g}", param, von, bis);
      return std::string(b);
    };
    o.wiedergabe2_warp(1, spur(ziel(8, 0.1, 0.9) + "," + ziel(15, 0.0, 1.0) + "," + ziel(16, -12, 0)));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 1, cache);
    if (!e.snap) std::fprintf(stderr, "M8 accept: grund=%s meldung=%s\n", e.grund.c_str(), e.meldung.c_str());
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrRack& r = e.snap->rack[0];
      PRUEF(r.ng == 3 && r.g[0].param == 8 && r.g[1].param == 15 && r.g[2].param == 16);
      PRUEF(e.snap->glied_spur[0].bk != nullptr);
      std::printf("M8: bk member targets 8, 15, 16 load (ng %d)\n", r.ng);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    for (int pa : {0, 3, 7, 17}) {   // an RB-338 parameter, and numbers nobody has, on a bk member
      o.wiedergabe2_warp(2 + pa, spur(ziel(pa, 0.0, 1.0)));
      cdj::ArrLadeErgebnis f = cdj::lade_wiedergabe(o.pfad, 2 + pa, cache);
      PRUEF(f.snap == nullptr && f.grund == "format" && f.meldung.find("not allowed for the Baukasten member") != std::string::npos);
      if (f.snap) cdj::gib_wiedergabe(f.snap.release(), cache);
    }
    PRUEF(cache.bk_eintraege() == 0);   // nothing held after the refusals
  }

  PRUEF_ENDE();
}