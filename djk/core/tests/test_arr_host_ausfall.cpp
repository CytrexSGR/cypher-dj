// Plan 1.11 T5: health of an effect-host stage (ArrHostStufe) and the edge-check decision.
// Cases:
//  1 ausfall_blende   gesund 1 -> 0 while a sine runs: the output crosses to the delayed dry signal in 480 samples (every sample is the convex combination of return and DELAYED dry, checked
//                     sample by sample), the largest step stays below 2 x the step of the plain sine, no gap; back to 1: the return fades in only after 48000 healthy samples (the strip plays
//                     the delayed dry path, residual 0, until then).
//  1b ausfall_kurz    an outage shorter than one block (the flag falls and rises between two blocks, only the fall is recorded by the setter) still restarts the 48000-sample hold-off.
//  2 ausfall_stillstand  D7: the stage has NO stall rule. A closed expander (exact zeros on a loud input) for 10 s leaves the stage on the return path (weight at the end, output exactly 0);
//                     only the health flag switches. (Negative control of the stall rule.)
//  3 gesund_quellen   one atomic per host, two sources: gesund = edge check ok AND server flag; default 0 (a fresh stage plays dry until both said yes).
//  4 kanten_gesund    the edge-check decision (host_kanten_gesund): a host whose client vanished, whose far port is missing, whose edge cannot be held or that has no edges is not healthy
//                     within one supervision period (one call); a healthy host is; hosts decide independently; the foreign edges of other hosts do not matter.
//  5 keine_allokation the stage with the hold-off over 2000 blocks: 0 allocations (positive control: a vector counts).
// Mutations (CMakeLists.txt): HOST_OHNE_BLENDE (1: step above the limit), HOST_TROCKEN_UNVERZOEGERT (1: time jump at the fade), HOST_STILLSTAND_REGEL (2).
#include <algorithm>
#include <cmath>
#include <atomic>
#include <cstdio>
#include <thread>
#include <string>
#include <vector>

#include "cypherdj/arr_host_stufe.h"
#include "cypherdj/edges.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using cdj::HOST_BLENDE;

static constexpr int N = 256;         // block
static constexpr int LAT = 600;       // latency of the stage
static constexpr int HALTE = 48000;   // healthy samples before the fade in
static constexpr float PI = 3.14159265358979f;

static float sinus(int64_t t) { return 0.8f * std::sin(2.0f * PI * 440.0f * static_cast<float>(t) / 48000.0f); }

// a stage with the host process of the test: the return of sample t is -0.8 x the input of t - LAT (far from the delayed dry signal, so that a wrong fade is loud)
struct Lauf {
  cdj::ArrHostStufe st;
  std::vector<float> ein, aus, rueck_hist;
  int64_t t0 = 0;
  float send_l[N] = {}, send_r[N] = {}, rl[N] = {}, ein_b[N] = {}, aus_l[N] = {}, aus_r[N] = {};
  static float rueck_von(int64_t t) { return t >= LAT ? -0.8f * sinus(t - LAT) : 0.0f; }
  // one block with the given flags; records input and output
  void block(bool an, bool gesund, float (*quelle)(int64_t) = sinus, float (*rueck)(int64_t) = rueck_von) {
    for (int i = 0; i < N; ++i) {
      ein_b[i] = quelle(t0 + i);
      rl[i] = rueck(t0 + i);
    }
    st.setze_zeiger(1, send_l, send_r, rl, rl);
    float al[N], ar[N];
    st.block(1, ein_b, ein_b, al, ar, N, LAT, an, gesund);
    for (int i = 0; i < N; ++i) {
      ein.push_back(ein_b[i]);
      aus.push_back(al[i]);
      if (std::fabs(al[i] - ar[i]) > 0.0f) ++pruef_fehler;   // L and R are the same signal here
    }
    t0 += N;
  }
};

static float still(int64_t) { return 0.0f; }
static float laut(int64_t t) { return 0.8f * std::sin(2.0f * PI * 220.0f * static_cast<float>(t) / 48000.0f) + 0.2f; }

int main() {
  // ---------------------------------------------------------------- 1 ausfall_blende
  {
    auto l = std::make_unique<Lauf>();
    l->st.setze_gesund(1, true);
    for (int b = 0; b < 60; ++b) l->block(true, true);   // 15360 samples on the return path (the fresh stage starts healthy in a direct call, no hold-off)
    PRUEF(l->st.gewicht(1) == HOST_BLENDE);
    // drop the flag at a block where the sine is high (a wrong fade is then at its loudest): look ahead
    int warte = 0;
    while (std::fabs(Lauf::rueck_von(l->t0) - sinus(l->t0 - LAT)) < 1.4f && warte < 200) { l->block(true, true); ++warte; }
    const int64_t t_aus = l->t0;
    l->st.setze_gesund(1, false);
    for (int b = 0; b < 8; ++b) l->block(true, false);   // 2048 samples on the unhealthy path
    // the step of the plain sine
    double sin_schritt = 0.0;
    for (int64_t t = 1; t < 4000; ++t) sin_schritt = std::max(sin_schritt, static_cast<double>(std::fabs(sinus(t) - sinus(t - 1))));
    double max_schritt = 0.0, abw = 0.0;
    for (int64_t t = t_aus; t < t_aus + 8 * N; ++t) {
      const size_t i = static_cast<size_t>(t);
      max_schritt = std::max(max_schritt, static_cast<double>(std::fabs(l->aus[i] - l->aus[i - 1])));
      const float d = sinus(t - LAT);       // the delayed dry signal
      const float r = Lauf::rueck_von(t);   // the return
      const int k = static_cast<int>(t - t_aus);
      const float g = k >= HOST_BLENDE ? 0.0f : static_cast<float>(HOST_BLENDE - 1 - k) / static_cast<float>(HOST_BLENDE);   // weight of the return in sample k of the fade
      // sample k of the fade: weight pos = 480 - 1 - k (the weight falls before the sample is computed)
      abw = std::max(abw, static_cast<double>(std::fabs(l->aus[i] - (d + g * (r - d)))));
    }
    std::printf("1: ausfall_blende: largest step %.5f (plain sine %.5f, limit %.5f), deviation from the convex combination of return and DELAYED dry %.7f\n", max_schritt, sin_schritt,
                2.0 * sin_schritt, abw);
    PRUEF(max_schritt < 2.0 * sin_schritt);
    PRUEF(abw < 2e-5);
    PRUEF(l->st.gewicht(1) == 0);
    // after the fade the output is exactly the input delayed by LAT
    double rest = 0.0;
    for (int64_t t = t_aus + HOST_BLENDE; t < t_aus + 8 * N; ++t) rest = std::max(rest, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - sinus(t - LAT))));
    std::printf("1: after the fade the output is the input delayed %d: residual %g\n", LAT, rest);
    PRUEF(rest == 0.0);
    // back to healthy: the dry path stays for 48000 healthy samples, then the return fades in over 480
    const int64_t t_an = l->t0;
    l->st.setze_gesund(1, true);
    for (int b = 0; b < (HALTE + 2 * HOST_BLENDE) / N + 4; ++b) l->block(true, true);
    double vor = 0.0;   // before the hold-off ends: the delayed dry path, exactly
    for (int64_t t = t_an; t < t_an + HALTE - 2; ++t) vor = std::max(vor, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - sinus(t - LAT))));
    double nach = 0.0;   // after hold-off and fade: the return, exactly
    for (int64_t t = t_an + HALTE + HOST_BLENDE + 2; t < t_an + HALTE + 2 * HOST_BLENDE + N; ++t)
      nach = std::max(nach, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - Lauf::rueck_von(t))));
    double mitte = 0.0;   // the fade in itself leaves the dry path (the return really is heard after the hold-off)
    for (int64_t t = t_an + HALTE; t < t_an + HALTE + HOST_BLENDE; ++t)
      mitte = std::max(mitte, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - sinus(t - LAT))));
    std::printf("1: fade in: deviation from the dry path before 48000 healthy samples %g, from the return after the fade %g, largest departure from dry inside the fade %.4f\n", vor, nach, mitte);
    PRUEF(vor == 0.0);
    PRUEF(nach == 0.0);
    PRUEF(mitte > 0.5);
    double schritt_ein = 0.0;
    for (int64_t t = t_an + HALTE - 4; t < t_an + HALTE + 2 * HOST_BLENDE; ++t)
      schritt_ein = std::max(schritt_ein, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - l->aus[static_cast<size_t>(t) - 1])));
    PRUEF(schritt_ein < 2.0 * sin_schritt);
  }
  // ---------------------------------------------------------------- 1b ausfall_kurz
  {
    auto l = std::make_unique<Lauf>();
    l->st.setze_gesund(1, true);
    for (int b = 0; b < 40; ++b) l->block(true, true);
    PRUEF(l->st.gewicht(1) == HOST_BLENDE);
    l->st.setze_kante(1, false);   // the edge check sees the client vanish and the host come back between two blocks
    l->st.setze_kante(1, true);
    PRUEF(l->st.gesund(1));        // the flag reads healthy again, only the memory of the fall remains
    const int64_t t_an = l->t0;
    for (int b = 0; b < (HALTE + 2 * HOST_BLENDE) / N + 4; ++b) l->block(true, true);
    double vor = 0.0;
    for (int64_t t = t_an + HOST_BLENDE + 2; t < t_an + HALTE - 2; ++t) vor = std::max(vor, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - sinus(t - LAT))));
    double nach = 0.0;
    for (int64_t t = t_an + HALTE + HOST_BLENDE + 2; t < t_an + HALTE + 2 * HOST_BLENDE; ++t)
      nach = std::max(nach, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - Lauf::rueck_von(t))));
    std::printf("1b: ausfall_kurz: the blip between two blocks: dry path until the hold-off (deviation %g), return afterwards (deviation %g)\n", vor, nach);
    PRUEF(vor == 0.0);
    PRUEF(nach == 0.0);
  }
  // ---------------------------------------------------------------- 2 ausfall_stillstand
  {
    auto l = std::make_unique<Lauf>();
    l->st.setze_gesund(1, true);
    const int bloecke = 10 * 48000 / N;   // 10 s
    for (int b = 0; b < bloecke; ++b) l->block(true, true, laut, still);   // loud input, the return is exact zeros: a closed expander
    double hoechst = 0.0;
    for (float x : l->aus) hoechst = std::max(hoechst, static_cast<double>(std::fabs(x)));
    double ein_hoechst = 0.0;
    for (float x : l->ein) ein_hoechst = std::max(ein_hoechst, static_cast<double>(std::fabs(x)));
    std::printf("2: ausfall_stillstand: 10 s of exact zeros on a loud input (peak %.2f): weight %d of %d, output peak %g\n", ein_hoechst, l->st.gewicht(1), HOST_BLENDE, hoechst);
    PRUEF(ein_hoechst > 0.9);
    PRUEF(l->st.gewicht(1) == HOST_BLENDE);   // no stall rule: the stage stayed on the return path
    PRUEF(hoechst == 0.0);                    // and what it plays is the return, exact zeros
    // only the flag switches
    l->st.setze_gesund(1, false);
    for (int b = 0; b < 4; ++b) l->block(true, false, laut, still);
    PRUEF(l->st.gewicht(1) == 0);
  }
  // ---------------------------------------------------------------- 3 gesund_quellen
  {
    cdj::ArrHostStufe st;
    PRUEF(!st.gesund(1) && !st.gesund(4));
    st.setze_kante(1, true);
    PRUEF(!st.gesund(1));   // the edge check alone is not enough
    st.setze_server(1, true);
    PRUEF(st.gesund(1));
    st.setze_kante(1, false);
    PRUEF(!st.gesund(1));
    st.setze_kante(1, true);
    PRUEF(st.gesund(1));
    st.setze_server(1, false);
    PRUEF(!st.gesund(1));
    PRUEF(!st.gesund(2));   // another host is untouched
    st.setze_server(2, true);
    PRUEF(!st.gesund(2));
    st.setze_kante(0, true);   // out of range: ignored, nothing crashes
    st.setze_server(5, true);
    PRUEF(!st.gesund(0) && !st.gesund(5));
  }
  // ---------------------------------------------------------------- 4 kanten_gesund
  {
    const std::string kern = "cypherdj-kern-e:";
    auto kanten_fuer = [&](int h) {
      const std::string hs = std::to_string(h);
      return std::vector<cdj::Kante>{{kern + "arr_ins_" + hs + "_L", "carla-" + hs + ":audio-in1"},
                                     {kern + "arr_ins_" + hs + "_R", "carla-" + hs + ":audio-in2"},
                                     {"carla-" + hs + ":audio-out1", kern + "arr_insret_" + hs + "_L"},
                                     {"carla-" + hs + ":audio-out2", kern + "arr_insret_" + hs + "_R"}};
    };
    std::vector<cdj::Kante> soll = kanten_fuer(1);
    for (const auto& k : kanten_fuer(3)) soll.push_back(k);
    soll.push_back({kern + "master_L", "system:playback_1"});   // an edge that has nothing to do with a host
    struct Welt {
      std::vector<std::string> weg;                 // ports that do not exist
      std::vector<std::pair<std::string, std::string>> getrennt;   // edges that are not held
      bool existiert(const std::string& p) const { return std::find(weg.begin(), weg.end(), p) == weg.end(); }
      bool verbunden(const std::string& a, const std::string& b) const {
        if (!existiert(a) || !existiert(b)) return false;
        for (const auto& g : getrennt)
          if (g.first == a && g.second == b) return false;
        return true;
      }
    } welt;
    cdj::KantenIst ist{[](void* c, const char* p) { return static_cast<Welt*>(c)->existiert(p); },
                       [](void* c, const char* a, const char* b) { return static_cast<Welt*>(c)->verbunden(a, b); }, &welt};
    uint32_t m = cdj::host_kanten_gesund(soll, kern, ist);
    std::printf("4: kanten_gesund: all edges held: mask %#x\n", m);
    PRUEF(m == ((1u << 0) | (1u << 2)));   // hosts 1 and 3 have their four edges, hosts 2 and 4 have none: not healthy
    welt.weg.push_back("carla-1:audio-in1");   // the client of host 1 vanishes with all its ports
    welt.weg.push_back("carla-1:audio-in2");
    welt.weg.push_back("carla-1:audio-out1");
    welt.weg.push_back("carla-1:audio-out2");
    m = cdj::host_kanten_gesund(soll, kern, ist);
    PRUEF(m == (1u << 2));   // host 1 falls within this one call (one supervision period), host 3 is not touched
    welt.weg.clear();
    welt.getrennt.push_back({"carla-3:audio-out2", kern + "arr_insret_3_R"});   // one edge cannot be held
    m = cdj::host_kanten_gesund(soll, kern, ist);
    PRUEF(m == (1u << 0));
    welt.getrennt.clear();
    welt.weg.push_back("carla-1:audio-out1");   // only the far port of one edge is gone
    m = cdj::host_kanten_gesund(soll, kern, ist);
    PRUEF(m == (1u << 2));
    welt.weg.clear();
    std::vector<cdj::Kante> luecke = soll;      // the edge file has only three of the four edges of host 1: a half connected host is not healthy
    luecke.erase(luecke.begin() + 3);
    m = cdj::host_kanten_gesund(luecke, kern, ist);
    PRUEF(m == (1u << 2));
    PRUEF(cdj::host_kanten_gesund({}, kern, ist) == 0u);   // no edges at all: nothing is healthy
    // a port of another core instance with the same names is not this instance's host port
    PRUEF(cdj::host_kanten_gesund(soll, "cypherdj-kern-f:", ist) == 0u);
  }
  // ---------------------------------------------------------------- 6 messung_trocken
  {  // while the round-trip measurement runs the stage plays the delayed dry path (faded in 480 samples), afterwards the return fades back in without a hold-off
    auto l = std::make_unique<Lauf>();
    l->st.setze_gesund(1, true);
    for (int b = 0; b < 40; ++b) l->block(true, true);
    PRUEF(l->st.gewicht(1) == HOST_BLENDE);
    const int64_t t_m = l->t0;
    l->st.setze_messung(1, true);
    for (int b = 0; b < 6; ++b) l->block(true, true);
    double rest = 0.0;
    for (int64_t t = t_m + HOST_BLENDE; t < t_m + 6 * N; ++t) rest = std::max(rest, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - sinus(t - LAT))));
    PRUEF(rest == 0.0);
    const int64_t t_e = l->t0;
    l->st.setze_messung(1, false);
    for (int b = 0; b < 6; ++b) l->block(true, true);
    double nach = 0.0;
    for (int64_t t = t_e + HOST_BLENDE + 2; t < t_e + 6 * N; ++t) nach = std::max(nach, static_cast<double>(std::fabs(l->aus[static_cast<size_t>(t)] - Lauf::rueck_von(t))));
    std::printf("6: messung_trocken: dry path during the measurement (residual %g), return again right after it (deviation %g)\n", rest, nach);
    PRUEF(nach == 0.0);
  }
  // ---------------------------------------------------------------- 5 keine_allokation
  {
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("5: allocation guard unavailable under this runtime: skipped, not passed\n");
    } else {
      auto l = std::make_unique<Lauf>();
      l->ein.reserve(1000000);
      l->aus.reserve(1000000);
      l->st.setze_gesund(1, true);
      abfang_an();
      for (int b = 0; b < 2000; ++b) {
        if (b % 300 == 100) l->st.setze_kante(1, false);
        if (b % 300 == 110) l->st.setze_kante(1, true);
        l->block(true, l->st.gesund(1));
      }
      const long n = abfang_aus();
      std::printf("5: keine_allokation: allocations in 2000 blocks with outages = %ld\n", n);
      PRUEF(n == 0);
      abfang_an();
      std::vector<int> v;
      v.push_back(1);
      const long kontrolle = abfang_aus();
      PRUEF(kontrolle > 0);   // positive control: the guard counts
    }
  }
  // ---------------------------------------------------------------- 7 gesund_faeden (TSan: the two sources are set from two threads while the callback runs)
  {
    auto l = std::make_unique<Lauf>();
    std::atomic<bool> stop{false};
    std::thread netz([&] {   // the net thread: the server flag
      for (int i = 0; !stop.load(); ++i) l->st.setze_server(1, (i & 3) != 0);
    });
    std::thread haupt([&] {   // the main thread: the edge check
      for (int i = 0; !stop.load(); ++i) l->st.setze_kante(1, (i & 7) != 0);
    });
    int gesund_n = 0;
    for (int b = 0; b < 3000; ++b) {
      l->block(true, l->st.gesund(1));
      gesund_n += l->st.gesund(1) ? 1 : 0;
    }
    stop.store(true);
    netz.join();
    haupt.join();
    for (float x : l->aus) PRUEF(std::isfinite(x) && std::fabs(x) <= 8.0f);
    std::printf("7: gesund_faeden: 3000 blocks while two threads set the two sources (healthy at %d of them)\n", gesund_n);
  }
  PRUEF_ENDE();
}
