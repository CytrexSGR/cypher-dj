// 1.10 slice 4b, T11: cost of the native insert kinds (komp, eq, saett; lim since the master limiter plan, 2026-11-06) per instance, measured before the pool sizes are decided.
// Not a ctest test (the numbers go into the report and into insert_module.json), except the two self-check runs registered in CMakeLists.txt.
//
// Usage: kern_kosten_ins [cycles [runs]]     (default 20000 cycles, 3 runs; the box runs the live studio, so take the runs at different times and
//                                              report all of them; real-time runs go under the shared lock, see the ledger)
// Env: KOSTEN_INS_ARTEN=komp,eq,saett,lim,utility,bk  (default all)   KOSTEN_INS_ANZAHL=0,1,4,8,12,32 (default)   KOSTEN_INS_FAELLE=<substring list> (default all)
//
// What is measured. One cycle = the block size of the core (256 samples, Kern::zyklus) over N instances of one kind, each fed with its own copy of the
// same noise block (-12 dBFS RMS class, uniform +-0.25), in place, one timer around the whole loop of N instances. Per case and N:
//   raw      median/p99/p99.9/max of the cycle with N instances, copy included
//   leer     the same loop with the process call left out (copy of the block N times, same timer): the loop's own cost at that N
//   net      raw median minus leer median, and net per instance (the number the pool sizes are decided from)
//   null     N = 0: the timer and the loop alone (printed once per case; the copy-only column above is what is subtracted, because the copy scales with N)
// Cases per kind: komp: "komp" (threshold -18, ratio 4, mix 1, noise 12 dB over the threshold so the gain computer works) and "komp_sc" (external key);
// eq: "eq_glocke" (8 bell bands), "eq_mix" (a plausible full channel EQ: 2 cuts, 2 shelves, 4 bells, one band Mid), "eq_schlimm" (worst case of the band types:
// 8 cuts of 48 dB alternating low/high, half of them Mid or Side, proportional Q), "eq_bewegt" (eq_mix with one band's gain changed in EVERY cycle: the coefficient update
// path under a moving knob), "eq_b0/b1/b2/b4" (k bell bands on, the rest off: the cost of the band count); saett: "saett" (drive +18 dB, out -6 dB, mix 1, oversampling on) and "saett_bewegt" (setze in every cycle); lim: "lim" (sample peak, ceiling -1 dB, release 80 ms) and "lim_bewegt" (the ceiling moves in every cycle).
//
// Self-check (the pattern of cost_arr_warp.cpp:71, "it does not measure what it should"): in the last cycle of every measurement the number of process calls
// that really happened is counted and compared with N, as is the number of live instances; a difference is exit 2 with no result printed for that case.
// Mutation CYPHERDJ_MUTATION_KOSTEN_INS_EINS builds one instance when more are asked; the self-check must abort (WILL_FAIL ctest).
//
// One JSON line per result ({"teil":"ins",...}) for the report folder.
#include <sched.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "cypherdj/eq.h"
#include "cypherdj/comp.h"
#include "cypherdj/sat.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/dsp/channel_limiter.h"
#include "cypherdj/dsp/utility.h"
#include "cypherdj/arr_inserts_util.h"
#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/dsp/denormal.h"

namespace {

constexpr int BLOCK = 256;   // the cycle of the core (Kern::zyklus)

double jetzt_us() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<double>(ts.tv_sec) * 1e6 + static_cast<double>(ts.tv_nsec) / 1e3;
}

struct Stat { double med, p99, p999, max; };

Stat statistik(std::vector<double>& v) {
  std::sort(v.begin(), v.end());
  auto q = [&](double p) { return v[std::min(v.size() - 1, static_cast<size_t>(p * static_cast<double>(v.size())))]; };
  return {q(0.5), q(0.99), q(0.999), v.back()};
}

// One instance of any kind behind one interface; calls counts the process calls that really happened.
struct Stufe {
  long aufrufe = 0;
  virtual ~Stufe() = default;
  virtual void block(float* l, float* r, int n) = 0;
  virtual void bewege(int zyklus) = 0;   // a parameter change in the cycle ("bewegt" cases), nothing otherwise
  virtual void schluessel(const float*, const float*) {}
};

struct KompStufe : Stufe {
  cdj::Komp k;
  bool sc;
  const float *kl = nullptr, *kr = nullptr;
  explicit KompStufe(bool mit_sc) : sc(mit_sc) {
    k.setze(CypherKompEinstellung{-18.0, 4.0, 6.0, 10.0, 120.0, 0.0, 1.0, 0.0});
  }
  void block(float* l, float* r, int n) override {
    ++aufrufe;
    if (sc && kl) k.block_sc(l, r, kl, kr, n);
    else k.block(l, r, n);
  }
  void bewege(int) override {}
  void schluessel(const float* a, const float* b) override { kl = a; kr = b; }
};

CypherEqBand band(double f, double g, double q, uint8_t art, uint8_t steil = 1, uint8_t kanal = 0) { return CypherEqBand{f, g, q, 1, art, steil, kanal}; }

struct EqStufe : Stufe {
  cdj::EqNativ e;
  bool bewegt;
  CypherEqBand b0{};
  EqStufe(const std::string& fall, bool beweg) : bewegt(beweg) {
    if (fall.compare(0, 4, "eq_b") == 0 && fall.size() == 5) {   // eq_b<k>: k bell bands on, the rest off (the cost of the band count)
      const int k = fall[4] - '0';
      for (int i = 0; i < 8; ++i) {
        CypherEqBand b = band(150.0 * std::pow(1.9, i), i % 2 ? -4.0 : 5.0, 1.2, 0);
        b.an = i < k ? 1 : 0;
        e.setze_band(i, b);
      }
    } else if (fall == "eq_glocke") {
      for (int i = 0; i < 8; ++i) e.setze_band(i, band(100.0 * std::pow(2.0, i), (i % 2 ? -4.0 : 5.0), 1.2, 0));
    } else if (fall == "eq_schlimm") {
      e.setze_global(true, 0.0);
      for (int i = 0; i < 8; ++i) e.setze_band(i, band(i % 2 ? 6000.0 + 1000.0 * i : 60.0 + 20.0 * i, 0.0, 0.9, i % 2 ? 4 : 3, 3, static_cast<uint8_t>(i % 3)));
    } else {   // eq_mix, eq_bewegt
      e.setze_band(0, band(40.0, 0.0, 0.7, 3, 1));          // low cut 24 dB
      e.setze_band(1, band(18000.0, 0.0, 0.7, 4, 1));       // high cut 24 dB
      e.setze_band(2, band(120.0, 3.0, 0.7, 1));            // low shelf
      e.setze_band(3, band(9000.0, 2.0, 0.7, 2));           // high shelf
      e.setze_band(4, band(250.0, -3.0, 1.4, 0));
      e.setze_band(5, band(1000.0, 4.0, 1.0, 0, 1, 1));     // bell on Mid
      e.setze_band(6, band(3500.0, -2.5, 2.0, 0));
      e.setze_band(7, band(7000.0, 3.0, 1.0, 0));
      b0 = band(1000.0, 4.0, 1.0, 0, 1, 1);
    }
    e.leeren();
  }
  void block(float* l, float* r, int n) override { ++aufrufe; e.block(l, r, n); }
  void bewege(int z) override {
    if (!bewegt) return;
    b0.gain_db = 2.0 + 0.5 * static_cast<double>(z % 9);   // never the same value twice in a row
    e.setze_band(5, b0);
  }
};

struct SaettStufe : Stufe {
  cdj::SaettNativ s;
  bool bewegt;
  explicit SaettStufe(bool beweg) : bewegt(beweg) { s.setze(18.0, -6.0, 1.0); s.leeren(); }
  void block(float* l, float* r, int n) override { ++aufrufe; s.block(l, r, n); }
  void bewege(int z) override {
    if (bewegt) s.setze(12.0 + 0.5 * static_cast<double>(z % 9), -6.0, 1.0);
  }
};

// master limiter plan (2026-11-06): the `lim` stage with the fixed settings of ins_lim.h (sample peak, 1.5 ms lookahead), ceiling -1 dB, release 80 ms (the defaults);
// "lim_bewegt" moves the ceiling every cycle (setze_decke_db, real-time safe)
struct LimStufe : Stufe {
  cypherdj::dsp::KanalLimiter q{cdj::INS_LIM_FS, cdj::ins_lim_einstellung()};
  bool bewegt;
  explicit LimStufe(bool beweg) : bewegt(beweg) { q.setze_decke_db(-1.0f); q.setze_abklingen_ms(80.0f); q.leeren(); }
  void block(float* l, float* r, int n) override { ++aufrufe; q.verarbeite(l, r, l, r, n); }
  void bewege(int z) override {
    if (bewegt) q.setze_decke_db(-1.0f - 0.5f * static_cast<float>(z % 9));
  }
};

// arr-fx (2026-11-11): the `utility` stage kind as ArrInserts runs it (cypherdj::dsp::Utility, settings from the rows through util_einstellung, in place, latency 0).
// "utility" = every row at its default (width 1, no bass mono, 0 dB, balance 0: the module's neutral matrix, bit-identical but the call still runs),
// "utility_mono" = bass mono below 120 Hz (the LR8 crossover path switched on), "utility_breite4" = width 4 (the side x4 matrix), "utility_bewegt" = the width changes
// in EVERY cycle (the 10 ms matrix ramp path under a moving knob).
struct UtilStufe : Stufe {
  cypherdj::dsp::Utility u{48000.0};
  bool bewegt;
  UtilStufe(float breite, float mono_hz, bool beweg) : bewegt(beweg) {
    const float e[5] = {1.0f, breite, mono_hz, 0.0f, 0.0f};
    u.setze(cdj::util_einstellung(e));
    u.leeren();
  }
  void block(float* l, float* r, int n) override { ++aufrufe; u.verarbeite(l, r, l, r, n); }
  void bewege(int z) override {
    if (!bewegt) return;
    const float e[5] = {1.0f, 1.0f + 0.1f * static_cast<float>(z % 9), 0.0f, 0.0f, 0.0f};
    u.setze(cdj::util_einstellung(e));
  }
};

// arr-bk slice 3 (2026-11-11): the `bk` stage kind as ArrInserts::rechne_bk runs it: the beat and tempo of the block, one cypher_bk_effekt call (input and output separate), the
// clamp of the output. "bk_<name>" is the stock effect graph <name> of instruments/modular_dsp/demos (every graph with an `eingang` node), "bk_durch" is a graph that only
// connects the input to the output (the price of the stage wrapper and of the FFI call), "bk_bewegt" is fx-echo-achtel with the knob k1 changed in EVERY cycle (the 20 ms smoothing path
// under a moving knob). Settings are the defaults of the graph files; the beat advances with the cycles (128 BPM) so the tempo-synchronous graphs run their clocks.
const char* G_BK_DURCH =
    R"({"format":"baukasten/2","name":"kosten-durch","stimmen":1,"knoten":[{"id":"ein","art":"eingang"},{"id":"aus","art":"ausgang"}],)"
    R"("kanten":[{"von":"ein.l","nach":"aus.l"},{"von":"ein.r","nach":"aus.r"}]})";

std::string lies_datei(const std::string& pfad) {
  std::ifstream f(pfad, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

// the sample root of the graphs that load a file (fx-federhall: feder-ir.f32): a temporary folder with a synthetic spring impulse response (1.2 s of exponentially decaying noise, 48 kHz,
// raw little-endian float32), removed at the end of the process. The real file of the studio is a stored sample; the cost of the convolution depends on its length, not on its content.
struct Wurzel {
  std::string pfad;
  Wurzel() {
    pfad = (std::filesystem::temp_directory_path() / ("kosten_ins_bk_" + std::to_string(::getpid()))).string();
    std::filesystem::create_directories(pfad);
    std::vector<float> ir(57600);
    std::mt19937 g(7);
    std::uniform_real_distribution<float> d(-1.0f, 1.0f);
    for (size_t i = 0; i < ir.size(); ++i) ir[i] = d(g) * std::exp(-6.0f * static_cast<float>(i) / static_cast<float>(ir.size()));
    std::ofstream(pfad + "/feder-ir.f32", std::ios::binary).write(reinterpret_cast<const char*>(ir.data()), static_cast<std::streamsize>(ir.size() * sizeof(float)));
  }
  ~Wurzel() { std::error_code ec; std::filesystem::remove_all(pfad, ec); }
};
const std::string& wurzel() {
  static Wurzel w;
  return w.pfad;
}

struct BkStufe : Stufe {
  CypherBk* h = nullptr;
  bool bewegt;
  double beat = 0.0;
  float ol[BLOCK], orr[BLOCK];
  BkStufe(const std::string& graph, bool beweg) : bewegt(beweg) {
    const std::string text = graph == "durch" ? std::string(G_BK_DURCH)
                                              : lies_datei(std::string(CYPHERDJ_DJK) + "/instruments/modular_dsp/demos/" + (graph == "bewegt" ? "fx-echo-achtel" : graph) + ".json");
    char fehler[256] = {};
    if (!text.empty()) h = cypher_bk_neu_wurzel(text.c_str(), 48000.0, wurzel().c_str(), fehler, sizeof fehler);
    if (!h) std::fprintf(stderr, "kosten_ins: graph %s: %s\n", graph.c_str(), text.empty() ? "file not readable" : fehler);
  }
  ~BkStufe() override { cypher_bk_frei(h); }
  void block(float* l, float* r, int n) override {
    ++aufrufe;   // counted only when the instance exists: a missing graph makes the self-check fail instead of measuring nothing
    if (!h) { --aufrufe; return; }
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_bk_takt(h, beat, 128.0 / 60.0 / 48000.0);
    cypher_bk_effekt(h, l, r, ol, orr, static_cast<size_t>(n));
    for (int t = 0; t < n; ++t) {
      l[t] = std::isfinite(ol[t]) ? std::clamp(ol[t], -8.0f, 8.0f) : ol[t];
      r[t] = std::isfinite(orr[t]) ? std::clamp(orr[t], -8.0f, 8.0f) : orr[t];
    }
    beat += static_cast<double>(n) * 128.0 / 60.0 / 48000.0;
  }
  void bewege(int z) override {
    if (bewegt && h) cypher_bk_regler(h, 1, 0.2f + 0.08f * static_cast<float>(z % 9));
  }
};

struct Fall {
  const char* name;
  const char* art;
  bool beweg;
};
const Fall FAELLE[] = {
    {"komp", "komp", false},       {"komp_sc", "komp", false},    {"eq_glocke", "eq", false}, {"eq_mix", "eq", false},
    {"eq_schlimm", "eq", false},   {"eq_bewegt", "eq", true},
    {"eq_b0", "eq", false},        {"eq_b1", "eq", false},        {"eq_b2", "eq", false},     {"eq_b4", "eq", false},     {"saett", "saett", false},  {"saett_bewegt", "saett", true},
    {"lim", "lim", false},         {"lim_bewegt", "lim", true},
    {"utility", "utility", false}, {"utility_mono", "utility", false}, {"utility_breite4", "utility", false}, {"utility_bewegt", "utility", true},
    {"bk_durch", "bk", false}, {"bk_bewegt", "bk", true},
    {"bk_fx-bandecho", "bk", false},
    {"bk_fx-echo-achtel", "bk", false},
    {"bk_fx-delay-sync", "bk", false},
    {"bk_fx-federhall", "bk", false},
    {"bk_fx-filter-fahrt", "bk", false},
    {"bk_fx-filter-regler", "bk", false},
    {"bk_fx-filter-wobble", "bk", false},
    {"bk_fx-flanger", "bk", false},
    {"bk_fx-lofi-sp1200", "bk", false},
    {"bk_fx-phaser", "bk", false},
    {"bk_fx-resonator", "bk", false},
    {"bk_fx-roehre", "bk", false},
    {"bk_fx-takt-pump", "bk", false},
    {"bk_fx-vocoder-robot", "bk", false},
};

std::unique_ptr<Stufe> neue_stufe(const Fall& f) {
  const std::string n = f.name;
  if (n == "komp") return std::make_unique<KompStufe>(false);
  if (n == "komp_sc") return std::make_unique<KompStufe>(true);
  if (n == "saett" || n == "saett_bewegt") return std::make_unique<SaettStufe>(f.beweg);
  if (n == "lim" || n == "lim_bewegt") return std::make_unique<LimStufe>(f.beweg);
  if (n == "utility") return std::make_unique<UtilStufe>(1.0f, 0.0f, false);
  if (n == "utility_mono") return std::make_unique<UtilStufe>(1.0f, 120.0f, false);
  if (n == "utility_breite4") return std::make_unique<UtilStufe>(4.0f, 0.0f, false);
  if (n == "utility_bewegt") return std::make_unique<UtilStufe>(1.0f, 0.0f, true);
  if (n.compare(0, 3, "bk_") == 0) return std::make_unique<BkStufe>(n.substr(3), f.beweg);
  return std::make_unique<EqStufe>(n, f.beweg);
}

bool in_liste(const char* env, const std::string& wort) {
  if (!env || !*env) return true;
  const std::string l = std::string(",") + env + ",";
  return l.find("," + wort + ",") != std::string::npos;
}
bool teilwort(const char* env, const std::string& wort) {
  if (!env || !*env) return true;
  std::string e = env;
  size_t a = 0;
  while (a <= e.size()) {
    size_t b = e.find(',', a);
    if (b == std::string::npos) b = e.size();
    if (b > a && wort.find(e.substr(a, b - a)) != std::string::npos) return true;
    a = b + 1;
  }
  return false;
}

struct Ergebnis {
  Stat raw, leer;
  long gefragt, gebaut, aufrufe_letzter;
};

// Measures one (case, N). leerlauf: copy only, no process call (the loop's own cost). Returns false when the self-check fails.
bool messe(const Fall& f, int gefragt, int zyklen, bool leerlauf, const std::vector<float>& quelle, Stat* aus, long* gebaut, long* aufrufe_letzter) {
  std::vector<std::unique_ptr<Stufe>> st;
  const int bauen =
#ifdef CYPHERDJ_MUTATION_KOSTEN_INS_EINS
      gefragt > 1 ? 1 : gefragt;   // error case: fewer instances than asked
#else
      gefragt;
#endif
  for (int i = 0; i < bauen; ++i) st.push_back(neue_stufe(f));
  std::vector<float> kl(BLOCK), kr(BLOCK);
  for (int i = 0; i < BLOCK; ++i) { kl[i] = quelle[i]; kr[i] = quelle[BLOCK + i]; }
  for (auto& s : st) s->schluessel(kl.data(), kr.data());
  float l[BLOCK], r[BLOCK];
  auto zyklus = [&](int z) {
    for (auto& s : st) {
      std::memcpy(l, quelle.data(), sizeof l);
      std::memcpy(r, quelle.data() + BLOCK, sizeof r);
      s->bewege(z);
      if (!leerlauf) s->block(l, r, BLOCK);
    }
  };
  for (int z = 0; z < 600; ++z) zyklus(z);   // warm up: filters settle, pages are touched
  std::vector<double> t;
  t.reserve(static_cast<size_t>(zyklen));
  long vorher = 0;
  for (int z = 0; z < zyklen; ++z) {
    if (z == zyklen - 1) for (auto& s : st) vorher += s->aufrufe;
    const double a = jetzt_us();
    zyklus(600 + z);
    t.push_back(jetzt_us() - a);
  }
  long nachher = 0;
  for (auto& s : st) nachher += s->aufrufe;
  *gebaut = static_cast<long>(st.size());
  *aufrufe_letzter = nachher - vorher;
  *aus = statistik(t);
  if (leerlauf) return true;   // the copy-only run has no process call to count
  return *gebaut == gefragt && *aufrufe_letzter == gefragt;
}

}  // namespace

int main(int argc, char** argv) {
  const int zyklen = argc > 1 ? std::atoi(argv[1]) : 20000;
  const int laeufe = argc > 2 ? std::atoi(argv[2]) : 3;
  const char* env_arten = std::getenv("KOSTEN_INS_ARTEN");
  const char* env_anzahl = std::getenv("KOSTEN_INS_ANZAHL");
  const char* env_faelle = std::getenv("KOSTEN_INS_FAELLE");
  std::vector<int> anzahlen;
  {
    const std::string a = env_anzahl && *env_anzahl ? env_anzahl : "0,1,4,8,12,32";
    size_t p = 0;
    while (p <= a.size()) {
      size_t q = a.find(',', p);
      if (q == std::string::npos) q = a.size();
      if (q > p) anzahlen.push_back(std::atoi(a.substr(p, q - p).c_str()));
      p = q + 1;
    }
  }
  std::vector<float> quelle(2 * BLOCK);
  {
    std::mt19937 g(12345);
    std::uniform_real_distribution<float> d(-0.25f, 0.25f);
    for (float& x : quelle) x = d(g);
  }
  int rc = 0;
  for (int lauf = 0; lauf < laeufe; ++lauf) {
    for (const Fall& f : FAELLE) {
      if (!in_liste(env_arten, f.art) || !teilwort(env_faelle, f.name)) continue;
      for (int n : anzahlen) {
        Stat raw{}, leer{};
        long gebaut = 0, aufrufe = 0, g2 = 0, a2 = 0;
        const bool ok = messe(f, n, zyklen, false, quelle, &raw, &gebaut, &aufrufe);
        if (!ok) {
          std::fprintf(stderr, "kosten_ins: case %s: %d instances asked, %ld built, %ld process calls in the last cycle: it does not measure what it should\n", f.name, n,
                       gebaut, aufrufe);
          return 2;   // no result for this case, and none after it
        }
        messe(f, n, zyklen, true, quelle, &leer, &g2, &a2);
        const double netto = raw.med - leer.med;
        std::printf("{\"teil\":\"ins\",\"fall\":\"%s\",\"n\":%d,\"lauf\":%d,\"zyklen\":%d,\"gebaut\":%ld,\"aufrufe\":%ld,\"raw_med\":%.2f,\"raw_p99\":%.2f,\"raw_p999\":%.2f,"
                    "\"raw_max\":%.2f,\"leer_med\":%.2f,\"netto_med\":%.2f,\"netto_je_instanz\":%.2f}\n",
                    f.name, n, lauf, zyklen, gebaut, aufrufe, raw.med, raw.p99, raw.p999, raw.max, leer.med, netto, n > 0 ? netto / n : 0.0);
        std::fflush(stdout);
      }
    }
  }
  return rc;
}
