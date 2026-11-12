// arr-bk slice 3: the insert kind `bk` of the arrangement mixer, a Baukasten effect graph as a stage (pool of 8, knobs k1..k8, latency from the graph).
// Cases (blocks of 256 samples, the mixer's own harness for the arrangement; direct ArrInserts for the structure cases):
//  1 bk_pool_zeilen     pool constant = the contract (8), global order (between utility and host), at most 64 global slots, the 72 rows ins/bk/<n>/{an,k1..k8} exist with the roles in order
//  2 bk_echo_takt       the eighth-note echo of fx-echo-achtel comes one eighth note later at 128 BPM (11250 samples) on a track, left, then right at 2T (ping-pong)
//  3 bk_knopf_zeile     the knob row reaches the graph (gain graph, k1 0.25 -> gain 0.5), a knob lane (`insert.<stage>.k1`, a chain lane of the stage) drives the same knob over time
//  4 bk_sprung          switch off and on (row an), swap of the graph (one block crossfade), removal and entry of the stage (tail and fade in): the biggest sample step stays near the one of the
//                       stationary signal (the jump measure); with the mutation INS_BK_WECHSEL_HART the graph swap steps
//  5 bk_latenz_pdc      a graph with a limiter reports its latency (95 samples), the stage carries it, the delay compensation holds the other track back by it, the bypass keeps the path length
//  6 bk_instanz_leser   the instance in use is published (ArrBkLeser::nutzt) while the stage runs it, its tail runs, and while it fades after a swap; free after the tail; the next owner starts clean
//  7 bk_zustand_bleibt  a snapshot with the same instance keeps the state (the echo still arrives after the swap); a new owner (the stage moves to another strip) starts cleared
//  8 bk_tempo_sprung    the echo time follows a tempo change (128 -> 64 BPM) and a loop jump of the beat reaches an LFO of the graph (takt per block)
//  9 bk_klemme_nan      an output above 8 is clamped to 8, an overflow inside a graph never reaches the strip (finite output)
// 10 bk_waechter        no allocation, no lock, no sleep in 2000 blocks with knob moves, switch, swap and removal (the allocation watcher; skipped under a sanitizer)
// Mutation (CMakeLists.txt): INS_BK_WECHSEL_HART (the old instance is cut at the first sample of the block of a swap: case 4 goes red).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/cypher_bk_ffi.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

bool g_waechter = false;

namespace {

constexpr int64_t V = 537;
constexpr float PAN = 0.70710678f;   // a centred track at the PM: -3 dB

std::string lies(const std::string& pfad) {
  std::ifstream f(pfad, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}
std::string beispiel(const char* name) { return lies(std::string(CYPHERDJ_DJK) + "/instruments/modular_dsp/demos/" + name + ".json"); }

// ---- the test graphs
const char* G_DURCH =
    R"({"format":"baukasten/2","name":"t-durch","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"aus","art":"ausgang"}],)"
    R"("kanten":[{"von":"ein.l","nach":"aus.l"},{"von":"ein.r","nach":"aus.r"}]})";
// gain = the knob k1 from 0 to 2
const char* G_KNOPF =
    R"({"format":"baukasten/2","name":"t-knopf","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"k","art":"regler","nr":1,"min":0,"max":2},)"
    R"({"id":"ml","art":"mul"},{"id":"mr","art":"mul"},{"id":"aus","art":"ausgang"}],)"
    R"("kanten":[{"von":"ein.l","nach":"ml.a"},{"von":"k.aus","nach":"ml.b"},{"von":"ein.r","nach":"mr.a"},{"von":"k.aus","nach":"mr.b"},)"
    R"({"von":"ml.aus","nach":"aus.l"},{"von":"mr.aus","nach":"aus.r"}]})";
std::string g_fest(const char* name, double gain) {   // a fixed gain
  char b[800];
  std::snprintf(b, sizeof b,
                R"({"format":"baukasten/2","name":"%s","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"g","art":"konst","wert":%g},)"
                R"({"id":"ml","art":"mul"},{"id":"mr","art":"mul"},{"id":"aus","art":"ausgang"}],)"
                R"("kanten":[{"von":"ein.l","nach":"ml.a"},{"von":"g.aus","nach":"ml.b"},{"von":"ein.r","nach":"mr.a"},{"von":"g.aus","nach":"mr.b"},)"
                R"({"von":"ml.aus","nach":"aus.l"},{"von":"mr.aus","nach":"aus.r"}]})",
                name, gain);
  return b;
}
const char* G_LIMITER =   // a look-ahead limiter: latency 95 samples
    R"({"format":"baukasten/2","name":"t-lat","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"lim","art":"limiter","decke":0,"vorlauf":2},{"id":"aus","art":"ausgang"}],)"
    R"("kanten":[{"von":"ein.l","nach":"lim.l"},{"von":"ein.r","nach":"lim.r"},{"von":"lim.l","nach":"aus.l"},{"von":"lim.r","nach":"aus.r"}]})";
// the beat as a signal: out = in * sin(2 pi beat) (an lfo of one beat per period)
const char* G_LFO =
    R"({"format":"baukasten/2","name":"t-lfo","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"w","art":"lfo","form":0,"takt":1,"neustart":0},)"
    R"({"id":"ml","art":"mul"},{"id":"mr","art":"mul"},{"id":"aus","art":"ausgang"}],)"
    R"("kanten":[{"von":"ein.l","nach":"ml.a"},{"von":"w.aus","nach":"ml.b"},{"von":"ein.r","nach":"mr.a"},{"von":"w.aus","nach":"mr.b"},)"
    R"({"von":"ml.aus","nach":"aus.l"},{"von":"mr.aus","nach":"aus.r"}]})";
std::string g_summe(const char* name, double wert) {   // in + a constant
  char b[800];
  std::snprintf(b, sizeof b,
                R"({"format":"baukasten/2","name":"%s","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"c","art":"konst","wert":%g},{"id":"al","art":"add"},{"id":"ar","art":"add"},{"id":"aus","art":"ausgang"}],)"
                R"("kanten":[{"von":"ein.l","nach":"al.a"},{"von":"c.aus","nach":"al.b"},{"von":"ein.r","nach":"ar.a"},{"von":"c.aus","nach":"ar.b"},)"
                R"({"von":"al.aus","nach":"aus.l"},{"von":"ar.aus","nach":"aus.r"}]})",
                name, wert);
  return b;
}
std::string g_unendlich() {   // 1e30 * 1e30 overflows float
  return R"({"format":"baukasten/2","name":"t-inf","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"a","art":"konst","wert":1e30},{"id":"b","art":"konst","wert":1e30},{"id":"m","art":"mul"},{"id":"al","art":"add"},{"id":"aus","art":"ausgang"}],)"
         R"("kanten":[{"von":"a.aus","nach":"m.a"},{"von":"b.aus","nach":"m.b"},{"von":"ein.l","nach":"al.a"},{"von":"m.aus","nach":"al.b"},{"von":"al.aus","nach":"aus.l"},{"von":"ein.r","nach":"aus.r"}]})";
}

struct Graph {   // a built instance, freed at the end of the scope (the snapshots never own it)
  CypherBk* h = nullptr;
  uint64_t gen = 0;
  Graph(const std::string& text, uint64_t g) : gen(g) {
    char fehler[256] = {};
    h = cypher_bk_neu(text.c_str(), 48000.0, fehler, sizeof fehler);
    if (!h) std::fprintf(stderr, "graph: %s\n", fehler);
    PRUEF(h != nullptr);
  }
  ~Graph() { cypher_bk_frei(h); }
  Graph(const Graph&) = delete;
  ArrStufe stufe(int slot, bool an = true) const {
    ArrStufe s;
    s.art = ArrInsArt::bk;
    s.slot = static_cast<uint8_t>(slot);
    s.an = an;
    s.bk = h;
    s.bk_gen = gen;
    s.latenz = static_cast<uint16_t>(cypher_bk_latenz(h));
    return s;
  }
};

int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  t.laden(s);
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);
  t.lauf(bis);
}
double hoechster_schritt(const std::vector<float>& x, int64_t a, int64_t b) {
  double m = 0.0;
  for (int64_t i = std::max<int64_t>(a, 1); i < b && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x[i] - x[i - 1])));
  return m;
}
std::pair<int64_t, float> spitze(const std::vector<float>& x, int64_t a, int64_t b) {
  int64_t ix = a;
  float m = 0.0f;
  for (int64_t i = a; i < b && i < static_cast<int64_t>(x.size()); ++i)
    if (std::fabs(x[i]) > m) {
      m = std::fabs(x[i]);
      ix = i;
    }
  return {ix, m};
}
cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, const std::vector<ArrStufe>& kette) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, a);
  if (!kette.empty()) {
    cdj::ArrKette& k = b.s->kette[0];
    for (const ArrStufe& x : kette) k.st[k.n++] = x;
  }
  return b.fertig();
}

// ---- direct ArrInserts driver: one strip (index 0), the stage in slot 0 of the kind, blocks of 256
struct Direkt {
  cdj::ArrInserts ins;
  cdj::ArrKette ketten[cdj::ARR_KETTEN];
  int g = cdj::ins_global(ArrInsArt::bk, 0);
  std::vector<float> l, r;
  double beat = 0.0, bps = 128.0 / 60.0 / 48000.0;
  void kette(int strip, std::initializer_list<ArrStufe> st) {
    cdj::ArrKette& k = ketten[strip];
    k.n = 0;
    for (const ArrStufe& x : st) k.st[k.n++] = x;
  }
  void tausche() { ins.tausche(ketten); }
  // runs the strip `strip` over n samples in blocks of 256 with the input `ein` (index = sample offset into ein, from `von`); the output is appended
  void block(int strip, const std::vector<float>& ein, int64_t von, int64_t n, bool mitschreiben = true) {
    for (int64_t o = 0; o < n; o += 256) {
      const int m = static_cast<int>(std::min<int64_t>(256, n - o));
      float bl[256], br[256];
      for (int i = 0; i < m; ++i) bl[i] = br[i] = von + o + i < static_cast<int64_t>(ein.size()) ? ein[von + o + i] : 0.0f;
      ins.takt(beat, bps);
      ins.kette(strip, &ketten[strip], bl, br, m);
      beat += static_cast<double>(m) * bps;
      if (mitschreiben) {
        l.insert(l.end(), bl, bl + m);
        r.insert(r.end(), br, br + m);
      }
    }
  }
  void zeile(int param, float w) { ins.setze_sofort(g, param, w); }
};

}  // namespace

int main() {
  const std::string echo = beispiel("fx-echo-achtel");
  PRUEF(!echo.empty());
  auto gleich = Audio::gleich(400000, 0.5f);
  auto sin440 = Audio::sinus(400000, 440.0, 0.5f);
  auto impuls = Audio::impuls(400000);

  {  // 1 bk_pool_zeilen
    PRUEF(cdj::ARR_INS_BK == 8);
    PRUEF(cdj::INS_G_BK0 == cdj::INS_G_UTIL0 + cdj::ARR_INS_UTIL && cdj::INS_G_HOST0 == cdj::INS_G_BK0 + cdj::ARR_INS_BK);
    PRUEF(cdj::ARR_INS_ALLE <= 64);
    PRUEF(cdj::ins_global(ArrInsArt::bk, 0) == cdj::INS_G_BK0 && cdj::ins_global(ArrInsArt::bk, 7) == cdj::INS_G_HOST0 - 1 && cdj::ins_global(ArrInsArt::bk, 8) == -1);
    PRUEF(cdj::ins_art(cdj::INS_G_BK0) == ArrInsArt::bk && cdj::ins_art(cdj::INS_G_HOST0 - 1) == ArrInsArt::bk && cdj::ins_art(cdj::INS_G_HOST0) == ArrInsArt::host);
    PRUEF(cdj::INS_BK_PARAM == 65);   // an, k1..k64
    PRUEF(cdj::INS_PARAM_MAX >= cdj::INS_BK_PARAM);   // the stage arrays hold every parameter of the widest stage
    cypherdj::stellwerk::ReglerTabelle tab;
    int n = 0;
    for (int s = 1; s <= 8; ++s)
      for (int k = 0; k <= 64; ++k) {
        char p[48];
        if (k == 0) std::snprintf(p, sizeof p, "ins/bk/%d/an", s);
        else std::snprintf(p, sizeof p, "ins/bk/%d/k%d", s, k);
        const int r = tab.suche(p);
        PRUEF(r >= 0);
        if (r < 0) continue;
        ++n;
        PRUEF(static_cast<int>(tab.def(r).rolle) == static_cast<int>(cypherdj::stellwerk::Rolle::ins_bk_an) + k);
        PRUEF(tab.def(r).vorgabe == (k == 0 ? 0.0f : 0.5f));
        PRUEF(tab.def(r).min == 0.0f && tab.def(r).max == 1.0f);
      }
    PRUEF(n == 520);   // 8 stages x (an + k1..k64)
    PRUEF(tab.suche("ins/bk/9/an") < 0 && tab.suche("ins/bk/1/k65") < 0 && tab.suche("ins/bk/1/k0") < 0 && tab.suche("ins/bk/1/k01") < 0 && tab.suche("ins/bk/1/k033") < 0 && tab.suche("ins/bk/1/k640") < 0);
    PRUEF(cdj::ins_latenz(ArrInsArt::bk) == 0);   // the kind has no fixed latency: the stage carries the graph's
    ArrStufe s;
    s.art = ArrInsArt::bk;
    s.latenz = 95;
    PRUEF(cdj::ins_latenz(s) == 95);
  }

  {  // 2 bk_echo_takt (128 BPM: an eighth note is 11250 samples)
    Graph e(echo, 1);
    auto t = std::make_unique<Treiber>();
    setze(*t, "ins/bk/1/an", 1.0f);
    setze(*t, "ins/bk/1/k1", 0.5f);
    spiele(*t, spur1(&impuls->a, {e.stufe(0)}), 60000);
    const auto [i0, p0] = spitze(t->pml, 0, 5000);
    const auto [i1, p1] = spitze(t->pml, i0 + 5000, i0 + 17000);
    const auto [r1, q1] = spitze(t->pmr, i0 + 5000, i0 + 17000);
    const auto [r2, q2] = spitze(t->pmr, i0 + 17000, i0 + 28000);
    std::printf("2: dry at %lld, left echo at +%lld (%.4f), right at T %.6f, right echo at +%lld (%.4f)\n", static_cast<long long>(i0), static_cast<long long>(i1 - i0), p1, q1, static_cast<long long>(r2 - i0), q2);
    PRUEF(p0 > 0.5f && p1 > 0.05f && std::llabs((i1 - i0) - 11250) <= 1);
    PRUEF(q1 < 1e-4f && q2 > 0.01f && std::llabs((r2 - i0) - 22500) <= 1);
  }

  {  // 3 bk_knopf_zeile: the row, then a lane
    Graph k(G_KNOPF, 1);
    {
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      setze(*t, "ins/bk/1/k1", 0.25f);
      spiele(*t, spur1(&gleich->a, {k.stufe(0)}), 30000);
      const double g = t->pml[29000] / (0.5f * PAN);
      std::printf("3: row k1 0.25 -> gain %.4f (expected 0.5)\n", g);
      PRUEF_NAH(g, 0.5, 0.005);
    }
    {
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &gleich->a);
      b.s->kette[0].n = 1;
      b.s->kette[0].st[0] = k.stufe(0);
      b.kette_lane(0, 0, 1, {{0.0, 0.0f, 0}, {4.0, 1.0f, 0}});   // k1 from 0 to 1 over four beats (1 beat = 22500 samples)
      spiele(*t, b.fertig(), 4 * 22500);
      for (const double beat : {0.5, 1.0, 2.0, 3.0}) {
        const int64_t s = V + static_cast<int64_t>(beat * 22500.0);
        const double g = t->pml[s] / (0.5f * PAN), soll = 2.0 * beat / 4.0;
        std::printf("3: lane at beat %.1f: gain %.4f (expected %.4f)\n", beat, g, soll);
        PRUEF_NAH(g, soll, 0.03);
      }
      PRUEF(t->pml[V + 2 * 22500] > t->pml[V + 22500] * 1.5f);   // it moves
    }
  }

  {  // 3c bk_stufe_65_parameter: 64-knob widening. All 65 parameters of a stage (an, k1..k64) are set through the table rows and read back from the stage
     // array sized by INS_PARAM_MAX; the neighbour stages (slot below and above) keep their defaults, so nothing overflows into them.
    Graph k(G_KNOPF, 1);
    auto t = std::make_unique<Treiber>();
    setze(*t, "ins/bk/1/an", 1.0f);
    for (int n = 1; n <= 64; ++n) setze(*t, "ins/bk/1/k" + std::to_string(n), 0.01f + 0.0125f * static_cast<float>(n));   // 0.0225 .. 0.81, every one distinct
    setze(*t, "ins/bk/2/k64", 0.123f);   // the first row of the next stage after the last row of stage 1
    spiele(*t, spur1(&gleich->a, {k.stufe(0)}), 30000);
    int falsch = 0;
    for (int n = 1; n <= 64; ++n) falsch += t->arr.inserts().wirksam(cdj::INS_G_BK0, n) != 0.01f + 0.0125f * static_cast<float>(n);
    std::printf("3c: %d of 64 knobs of stage 1 read back wrong; stage 2 knob 64 = %.4f (stage 2 is not in a chain: not applied)\n", falsch, t->arr.inserts().wirksam(cdj::INS_G_BK0 + 1, 64));
    PRUEF(falsch == 0);
    PRUEF(t->arr.inserts().wirksam(cdj::INS_G_BK0, 65) == 0.0f);   // one past the last parameter: refused, not read from the next row
    PRUEF(t->arr.inserts().wirksam(cdj::INS_G_BK0 - 1, 64) == 0.0f);   // the stage below (the last utility stage) is untouched
  }

  {  // 3b bk_knopf_32: 32-knob widening. A stage graph that reads knob 9, 17 or 32 follows the row ins/bk/1/k<n> and a chain lane on parameter n
     // (index n of the stage kind, INS_BK_PARAM = 33); a project of the old format sets an, k1..k8 only: the other rows keep their table default 0.5
    for (const int kn : {9, 17, 32, 33, 48, 64}) {   // 33..64: 64-knob widening, they need hall_ffi with REGLER 64
      std::string js = G_KNOPF;
      const size_t pos = js.find("\"nr\":1,");
      PRUEF(pos != std::string::npos);
      js.replace(pos, 7, "\"nr\":" + std::to_string(kn) + ",");
      Graph k(js, 1);
      const std::string zeile = "ins/bk/1/k" + std::to_string(kn);
      const std::string nachbar = "ins/bk/1/k" + std::to_string((kn == 32 || kn == 64) ? kn - 1 : kn + 1);
      double g_alt = 0.0, g_neu = 0.0, g_nachbar = 0.0;
      {   // old project: an and k1..k8 only (here: an and k1)
        auto t = std::make_unique<Treiber>();
        setze(*t, "ins/bk/1/an", 1.0f);
        setze(*t, "ins/bk/1/k1", 0.3f);
        spiele(*t, spur1(&gleich->a, {k.stufe(0)}), 30000);
        g_alt = t->pml[29000] / (0.5f * PAN);
      }
      {   // the row of the knob
        auto t = std::make_unique<Treiber>();
        setze(*t, "ins/bk/1/an", 1.0f);
        setze(*t, zeile, 0.25f);
        spiele(*t, spur1(&gleich->a, {k.stufe(0)}), 30000);
        g_neu = t->pml[29000] / (0.5f * PAN);
      }
      {   // the neighbour row does not move the graph
        auto t = std::make_unique<Treiber>();
        setze(*t, "ins/bk/1/an", 1.0f);
        setze(*t, nachbar, 0.0f);
        spiele(*t, spur1(&gleich->a, {k.stufe(0)}), 30000);
        g_nachbar = t->pml[29000] / (0.5f * PAN);
      }
      std::printf("3b: knob %d: old project (row at default 0.5) gain %.4f (expected 1.0), row 0.25 -> %.4f (expected 0.5), neighbour row 0 -> %.4f (expected 1.0)\n", kn, g_alt, g_neu, g_nachbar);
      PRUEF_NAH(g_alt, 1.0, 0.005);
      PRUEF_NAH(g_neu, 0.5, 0.005);
      PRUEF_NAH(g_nachbar, 1.0, 0.005);
      {   // a chain lane on parameter kn: from 0 to 1 over four beats
        auto t = std::make_unique<Treiber>();
        setze(*t, "ins/bk/1/an", 1.0f);
        Bau b(1);
        b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &gleich->a);
        b.s->kette[0].n = 1;
        b.s->kette[0].st[0] = k.stufe(0);
        b.kette_lane(0, 0, kn, {{0.0, 0.0f, 0}, {4.0, 1.0f, 0}});
        spiele(*t, b.fertig(), 4 * 22500);
        for (const double beat : {1.0, 3.0}) {
          const int64_t sm = V + static_cast<int64_t>(beat * 22500.0);
          const double g = t->pml[sm] / (0.5f * PAN), soll = 2.0 * beat / 4.0;
          std::printf("3b: knob %d lane at beat %.1f: gain %.4f (expected %.4f)\n", kn, beat, g, soll);
          PRUEF_NAH(g, soll, 0.03);
        }
      }
    }
  }

  {  // 4 bk_sprung
    Graph a(g_fest("t-a", 0.25), 1), b(g_fest("t-b", 2.0), 2);
    const double stat = std::max(0.5 * PAN * 0.25 * 0.0576, 0.5 * PAN * 2.0 * 0.0576);   // the larger stationary step of the 440 Hz sine (amplitude * 2 pi f / fs)
    const auto sprung = [&](const std::vector<float>& x, int64_t ab) { return hoechster_schritt(x, ab - 256, ab + 1536) / stat; };
    {  // the row an: off at 60000 (stage gain 0.25 -> dry), on again at 100000
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      t->vor_block = [&](int64_t s) {
        if (s == 59904) setze(*t, "ins/bk/1/an", 0.0f);
        if (s == 99840) setze(*t, "ins/bk/1/an", 1.0f);
      };
      spiele(*t, spur1(&sin440->a, {a.stufe(0)}), 140000);
      const double aus = sprung(t->pml, 59904), ein = sprung(t->pml, 99840);
      std::printf("4: jump measure, switch off %.3f, switch on %.3f\n", aus, ein);
      PRUEF(aus < 1.1 && ein < 1.1);
      PRUEF(t->pml[59000] < 0.5f * PAN * 0.3f && t->pml[100500] < 1.0f);   // the stage works at all (the signal is attenuated): on state 0.25 gain, off state 1.0
      PRUEF(hoechster_schritt(t->pml, 50000, 59000) < 0.5 * PAN * 0.25 * 0.0576 * 1.05 && hoechster_schritt(t->pml, 80000, 90000) > 0.5 * PAN * 0.0576 * 0.9);
    }
    {  // the swap of the graph at 60000: gain 0.25 -> 2.0 over one block
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      t->vor_block = [&](int64_t s) {
        if (s == 59904) t->laden(spur1(&sin440->a, {b.stufe(0)}));
      };
      spiele(*t, spur1(&sin440->a, {a.stufe(0)}), 100000);
      const double w = sprung(t->pml, 59904);
      std::printf("4: jump measure, graph swap %.3f (gain 0.25 -> 2)\n", w);
      PRUEF(w < 1.1);
      PRUEF(hoechster_schritt(t->pml, 80000, 90000) > 0.5 * PAN * 2.0 * 0.0576 * 0.9);   // the new graph plays after the block
    }
    {  // removal at 60000 and entry at 100000
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      t->vor_block = [&](int64_t s) {
        if (s == 59904) t->laden(spur1(&sin440->a, {}));
        if (s == 99840) t->laden(spur1(&sin440->a, {a.stufe(0)}));
      };
      spiele(*t, spur1(&sin440->a, {a.stufe(0)}), 140000);
      const double weg = sprung(t->pml, 59904), neu = sprung(t->pml, 99840);
      std::printf("4: jump measure, removal %.3f, entry %.3f\n", weg, neu);
      PRUEF(weg < 1.1 && neu < 1.1);
    }
  }

  {  // 5 bk_latenz_pdc
    Graph lim(G_LIMITER, 1);
    const int lat = static_cast<int>(cypher_bk_latenz(lim.h));
    std::printf("5: the limiter graph reports a latency of %d samples\n", lat);
    PRUEF(lat == 95);
    const auto lauf = [&](bool mit, bool an, int* pdc_spur2) {
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", an ? 1.0f : 0.0f);
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &impuls->a);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 16.0, &impuls->a);
      if (mit) {
        b.s->kette[0].n = 1;
        b.s->kette[0].st[0] = lim.stufe(0);
      }
      cdj::ArrSnapshot* s = b.fertig();
      if (pdc_spur2) *pdc_spur2 = s->pdc.d[cdj::PDC_SPUR0 + 1];
      spiele(*t, s, 8000);
      const auto [i0, p0] = spitze(t->pml, 0, 8000);
      return std::make_pair(i0, p0);
    };
    int d = -1, d0 = -1;
    const auto ein = lauf(true, true, &d), aus = lauf(true, false, nullptr), ohne = lauf(false, true, &d0);
    std::printf("5: PDC of track 2 %d samples (without the stage %d); both impulses together at %lld with the stage on, %lld bypassed, %lld without a stage\n", d, d0, static_cast<long long>(ein.first),
                static_cast<long long>(aus.first), static_cast<long long>(ohne.first));
    PRUEF(d == lat && d0 == 0);
    PRUEF(ein.first == ohne.first + lat);   // both tracks sit `lat` samples later (the compensation delays track 2, the stage delays track 1)
    PRUEF(aus.first == ein.first);          // the bypass keeps the path length (D10)
  }

  {  // 6 bk_instanz_leser
    Graph a(g_fest("t-a", 0.5), 1), b(g_fest("t-b", 0.25), 2);
    Direkt d;
    d.zeile(0, 1.0f);
    d.kette(0, {a.stufe(0)});
    d.tausche();
    PRUEF(d.ins.nutzt(a.h) && !d.ins.nutzt(b.h) && d.ins.bk_instanz(d.g) == a.h);
    std::vector<float> st(2048, 0.4f);
    d.block(0, st, 0, 2048);
    PRUEF(d.ins.nutzt(a.h));
    d.kette(0, {b.stufe(0)});   // the same owner, another instance: the old one fades in the next block
    d.tausche();
    PRUEF(d.ins.nutzt(a.h) && d.ins.nutzt(b.h));   // `blende` holds a until the fade has run
    d.block(0, st, 0, 256);
    PRUEF(!d.ins.nutzt(a.h) && d.ins.nutzt(b.h));
    d.kette(0, {});   // the stage leaves: a tail on its strip, the instance stays published
    d.tausche();
    PRUEF(d.ins.nutzt(b.h));
    d.block(0, st, 0, 2048);   // the tail has run out (480 samples)
    PRUEF(!d.ins.nutzt(b.h) && d.ins.bk_instanz(d.g) == nullptr && d.ins.slot_eigen(0) == 0);
    d.kette(0, {a.stufe(0)});   // a later entry starts on a published, reset instance
    d.tausche();
    PRUEF(d.ins.nutzt(a.h) && d.ins.bk_instanz(d.g) == a.h);
    d.ins.ruhe();   // nothing plays: the instance is not ours any more
    PRUEF(!d.ins.nutzt(a.h));
  }

  {  // 7 bk_zustand_bleibt
    Graph e(echo, 1);
    std::vector<float> imp(40000, 0.0f);
    imp[100] = 0.5f;
    const auto lauf = [&](bool neuer_besitzer, bool gleiche_instanz) {
      Direkt d;
      d.zeile(0, 1.0f);
      d.zeile(1, 0.5f);
      d.kette(0, {e.stufe(0)});
      d.tausche();
      d.block(0, imp, 0, 5120);   // the impulse went in, the echo is on its way (11250 samples)
      if (neuer_besitzer) {   // the stage moves to strip 1 inside one swap: a new owner, the old tail is cut
        d.ketten[0].n = 0;
        d.kette(1, {e.stufe(0)});
        d.tausche();
        d.l.clear();
        d.block(1, imp, 5120, 20000);
      } else if (gleiche_instanz) {   // a snapshot with the same stage and the same instance
        d.tausche();
        d.l.clear();
        d.block(0, imp, 5120, 20000);
      }
      float m = 0.0f;
      for (int64_t i = 0; i < static_cast<int64_t>(d.l.size()); ++i)
        if (i + 5120 > 11000 + 100 - 200 && i + 5120 < 11000 + 100 + 1000 + 350) m = std::max(m, std::fabs(d.l[i]));
      return m;
    };
    const float bleibt = lauf(false, true), neu = lauf(true, false);
    std::printf("7: echo after a swap with the same instance %.4f, after a move to another strip %.6f\n", bleibt, neu);
    PRUEF(bleibt > 0.05f);   // the delay line kept its content
    PRUEF(neu < 1e-4f);      // a new owner starts cleared
  }

  {  // 8 bk_tempo_sprung
    Graph e(echo, 1), w(G_LFO, 2);
    std::vector<float> imp(120000, 0.0f);
    imp[100] = 0.5f;
    imp[60000] = 0.5f;
    {  // 128 -> 64 BPM at sample 30000: the second impulse (at 60000) echoes one eighth of the NEW tempo later (22500)
      Direkt d;
      d.zeile(0, 1.0f);
      d.zeile(1, 0.5f);
      d.kette(0, {e.stufe(0)});
      d.tausche();
      d.block(0, imp, 0, 30208);
      d.bps = 64.0 / 60.0 / 48000.0;
      d.block(0, imp, 30208, 60000);
      const auto [i1, p1] = spitze(d.l, 100 + 5000, 100 + 17000);
      const auto [i2, p2] = spitze(d.l, 60000 + 5000, 60000 + 30000);
      std::printf("8: echo of the first impulse at +%lld (%.4f), of the second after the tempo change at +%lld (%.4f)\n", static_cast<long long>(i1 - 100), p1, static_cast<long long>(i2 - 60000), p2);
      PRUEF(std::llabs((i1 - 100) - 11250) <= 1);
      PRUEF(std::llabs((i2 - 60000) - 22500) <= 2);
    }
    {  // a loop jump of the beat: the graph gets the beat of the block, so its LFO continues from the new place
      Direkt d;
      d.zeile(0, 1.0f);
      d.kette(0, {w.stufe(0)});
      d.tausche();
      std::vector<float> eins(8192, 0.5f);
      d.beat = 0.0;
      d.block(0, eins, 0, 1024);   // beats 0 .. 0.0356
      d.beat = 3.25;               // the loop seam: the project beat jumps to 3.25 (a quarter beat into a period)
      d.l.clear();
      d.block(0, eins, 0, 256);
      // sample 128 of that block sits at beat 3.25 + 128 * bps; the LFO is sin(2 pi beat) (phase 0 at beat 0), the output 0.5 * that, within the lfo's own phase accuracy
      const double soll = 0.5 * std::sin(2.0 * 3.14159265358979323846 * (3.25 + 128.0 * d.bps));
      std::printf("8: after the loop jump the LFO output at sample 128 is %.4f (expected %.4f from the beat 3.25)\n", d.l[128], soll);
      PRUEF_NAH(d.l[128], soll, 0.02);
      PRUEF(std::fabs(soll) > 0.3);   // the check can tell the new beat from the old one (the old place would give about 0.03)
    }
  }

  {  // 9 bk_klemme_nan
    Graph gross(g_summe("t-gross", 100.0), 1), inf(g_unendlich(), 2);
    std::vector<float> st(8192, 0.1f);
    {
      Direkt d;
      d.zeile(0, 1.0f);
      d.kette(0, {gross.stufe(0)});
      d.tausche();
      d.block(0, st, 0, 4096);
      float m = 0.0f;
      for (size_t i = 2048; i < d.l.size(); ++i) m = std::max(m, std::fabs(d.l[i]));
      std::printf("9: a graph that outputs 100.1 plays at %.3f (clamp %.1f)\n", m, static_cast<double>(cdj::INS_BK_AUS_MAX));
      PRUEF(m == cdj::INS_BK_AUS_MAX);
    }
    {
      Direkt d;
      d.zeile(0, 1.0f);
      d.kette(0, {inf.stufe(0)});
      d.tausche();
      d.block(0, st, 0, 4096);
      float m = 0.0f;
      bool fin = true;
      for (size_t i = 2048; i < d.l.size(); ++i) {
        m = std::max(m, std::fabs(d.l[i]));
        fin = fin && std::isfinite(d.l[i]) && std::isfinite(d.r[i]);
      }
      // the Baukasten program guards its own output (an overflow inside the graph never leaves it), so the strip sees a finite block and nothing to count; the guard behind the stage
      // (the same as for every kind) stays as the second line and is covered by the NaN pass-through mutation of the other kinds
      std::printf("9: a graph with an overflow inside: output finite %d, level %.4f, events counted %llu\n", fin ? 1 : 0, m, static_cast<unsigned long long>(d.ins.nan_zaehler()));
      PRUEF(fin && m <= cdj::INS_BK_AUS_MAX);
    }
  }

  {  // 10 bk_waechter
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("10: skipped (sanitizer build): allocation watcher not available\n");
    } else {
      Graph a(echo, 1), b(g_fest("t-b", 0.5), 2);
      auto t = std::make_unique<Treiber>();
      setze(*t, "ins/bk/1/an", 1.0f);
      Bau bb(1);
      bb.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &sin440->a);
      bb.kette(1, {a.stufe(0)});
      t->laden(bb.fertig());
      t->arr.start(0.0, 0, false, 0, V, 256, t->k);
      auto x = std::make_unique<Treiber>();   // the second snapshots are built before the watcher starts (building allocates)
      cdj::ArrSnapshot* s2 = spur1(&sin440->a, {b.stufe(0)});
      cdj::ArrSnapshot* s3 = spur1(&sin440->a, {});
      cdj::ArrSnapshot* s4 = spur1(&sin440->a, {a.stufe(0)});
      const int r1 = reg(*t, "ins/bk/1/k1"), r2 = reg(*t, "ins/bk/1/an");
      float bl[6][cdj::ARR_BLOCK];
      long viel = 0;
      std::vector<const cdj::ArrSnapshot*> alt;
      for (int blk = 0; blk < 2000; ++blk) {
        if (blk == 0) t->arr.setze_sofort(reg(*t, "ins/bk/1/k1"), 0.5f);
        for (auto& q : bl) std::fill(q, q + 256, 0.0f);
        abfang_an();
        t->arr.setze_sofort(r1, 0.25f + 0.5f * static_cast<float>(blk % 7) / 7.0f);   // knob moves
        if (blk % 97 == 50) t->arr.setze_sofort(r2, (blk / 97) % 2 ? 1.0f : 0.0f);      // switch
        const cdj::ArrSnapshot* tausch = nullptr;
        if (blk == 600) tausch = t->arr.tausche(s2, t->s, t->k);        // swap of the graph
        if (blk == 900) tausch = t->arr.tausche(s3, t->s, t->k);        // removal
        if (blk == 1200) tausch = t->arr.tausche(s4, t->s, t->k);       // entry
        t->arr.block(t->k, t->s, 256, bl[0], bl[1], bl[2], bl[3], bl[4], bl[5]);
        viel += abfang_aus();
        if (tausch) alt.push_back(tausch);
        t->s += 256;
      }
      std::printf("10: allocations, locks and sleeps in 2000 blocks with knob moves, switch, swap, removal and entry: %ld\n", viel);
      PRUEF(viel == 0);
      for (const cdj::ArrSnapshot* q : alt) delete q;
    }
  }
  PRUEF_ENDE();
}
