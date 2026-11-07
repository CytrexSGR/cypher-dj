// Package 1.15 (mix tools in the channel strip), task A0: golden digest of Mixer::verarbeite on the UNMODIFIED tree.
//
// Purpose: later tasks add insert stages (gate, utility, multiband, bus limiter) that must be inert when switched off.
// A comparison of two instances of the new code cannot see a regression in the off path itself; this digest, recorded at
// base commit 2f26eeb9 (before any change to the mixer), can.
//
// Scenario (fixed, deterministic, no clock, no randomness beyond the xorshift below):
//   - 14 sources: even index = noise, odd index = sine (frequency per channel), stereo with a small L/R difference.
//     erz/2..erz/7 (six sources) are routed to buses 1..4; erz/1 stays on the master on purpose, so a path from a
//     compressed source (komp) straight to the master is covered as well. erz/8 is cue-only (setze_nur_cue, as kern.cpp).
//   - EQ moves (set and per-sample ramps, one buffer each), kill switches, DJ filter, trim, PFL on several channels.
//   - compressor (komp) on three channels, hall send (send/2 + fx/2/rueckweg), master glue (master/kleber) switched off
//     at block 150, ducking (duck/tiefe -12 dB, a kick every 22500 samples), beat FX: echo (unit 0) on deck/1 and erz/2,
//     flanger (unit 1) on deck/1 and the master from block 60 (so the LFO starts mid-run), routing change to INSERT at
//     block 120, metronome click on the master-sum and PFL inputs, test click on the master input.
//   - 200 blocks of mixed sizes 1..1024 (the first ten are edge sizes), 104 289 samples per signal.
// FNV-1a 64 over the bit patterns of master L/R and cue L/R of every block, in this order, followed per block by
// master_summe_l/r() (the ear tap), the level peaks of spitze_lesen(0..19), limiter_absenkung_db() and komp_gr_db(0/4/12).
//
// What the golden protects (measured with the 29 CYPHERDJ_MUTATION_* switches of mixer.cpp/beatfx.cpp, list in
// ~/messungen/2026-11-02-mix-werkzeuge/A0/mutationen-golden.txt): the sum path (channel strips, routing to master and
// buses, cue/PFL, crossfader), hall, master glue, master limiter, ducking, cue-only handling, the beat FX units (order,
// LFO start, routing change) and the level peaks. What it does NOT protect: the effect-graph paths (BK_* switches:
// no graph is loaded here), anything that needs the real-time threads, file I/O or the network, and any parameter
// range outside the values this scenario sets.
//
// The digest depends on the toolchain (float contraction, libm, and the rustc that builds the hall and compressor libraries).
// The decision is made on the digest first:
//   - digest equal to the recorded one: bit-exact, passed, whatever the toolchain string says (a Debug build, for one,
//     produces the same digest);
//   - digest different on the SAME toolchain string: red, no tolerance (a real change of the mixer);
//   - digest different on ANOTHER toolchain string: the test prints "NOT bit-exact: golden from another toolchain" and
//     compares instead, with 1e-4 relative each, the sums and sums of |x| of master and cue and, per quantity, the ear tap,
//     the level peaks, the limiter reduction and the compressor reduction (everything that goes into the digest).
// The fallback cannot see every mutation: where a mutation moves the worst compared quantity by about as much as the noise
// of such a toolchain it stays green. The mutation tests therefore report SKIP (exit code 77) when they run on another
// toolchain string: a mutation guard needs a bit-exact toolchain. On the recorded one they stay WILL_FAIL.
// The optimisation level does not change the digest: RelWithDebInfo (-O2, the CMake default of djk/kern) and Release (-O3,
// the build type of djk/kern/build per its CMakeCache) give the same value (checked).
//
// Recording (`test_mixer_golden aufnehmen` prints the values without comparing): only on an UNMODIFIED mixer at the
// base commit 2f26eeb9, or when only this scenario changed and the mixer sources are byte-identical to that commit.
// Never to make a failing run green after a change to src/mixer.cpp or the dsp library.
//
// Negative control: one flipped input sample must change the digest; two runs of the same scenario must agree.
#include <gnu/libc-version.h>

#include <cinttypes>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "cypherdj/mixer.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;

// ---- recorded values (task A0, unmodified mixer at 2f26eeb9; compiler from the CMake cache: GNU 13.3.0, no -ffp-contract
// flag set (gnu++20 default "fast", inert without hardware FMA); rustc 1.93.1 for the hall/komp libraries, taken from
// CMake at build time) ----------------------------------------------------------------------------------------------------
static const char* GOLDEN_TOOLCHAIN = "gcc 13.3.0 | opt=on | fma=none | std=gnu | x86_64 | glibc 2.39 | rustc 1.93.1";
static const uint64_t GOLDEN_DIGEST = 0x50f3b73a90f91ed3ull;
// per signal (master L, master R, cue L, cue R): sum of the samples and sum of |samples|, as hex-float literals
static const double GOLDEN_SUMME[4] = {0x1.afec0543b68cp+5, 0x1.b5f6e05997c6p+5, 0x1.0e3c29e70d5ap+6, 0x1.067588d4ff0dp+6};
static const double GOLDEN_BETRAG[4] = {0x1.e191a803a56e3p+13, 0x1.d7c25e54036fap+13, 0x1.3c48e46b307e2p+14, 0x1.3aa61ef53a07p+14};
static const long GOLDEN_SAMPLES = 104289;

namespace {

// What this build is, as far as the digest can depend on it (compiler, optimisation, fused multiply-add, language mode,
// libm).
std::string toolchain_text() {
  std::string s;
#ifdef __clang__
  s += "clang ";
#else
  s += "gcc ";
#endif
  s += __VERSION__;
#ifdef __OPTIMIZE__
  s += " | opt=on";
#else
  s += " | opt=off";
#endif
#ifdef __FAST_MATH__
  s += " | fast-math";
#endif
#ifdef __FP_FAST_FMA
  s += " | fma=hw";
#else
  s += " | fma=none";
#endif
#ifdef __STRICT_ANSI__
  s += " | std=iso";
#else
  s += " | std=gnu";
#endif
#ifdef __AVX2__
  s += " | avx2";
#endif
#ifdef __x86_64__
  s += " | x86_64";
#endif
  s += " | glibc ";
  s += gnu_get_libc_version();
#ifdef CYPHERDJ_RUSTC_VERSION
  s += " | rustc " CYPHERDJ_RUSTC_VERSION;   // from `rustc --version` at configure time (CMakeLists.txt)
#else
  s += " | rustc unknown";
#endif
  return s;
}

#ifdef CYPHERDJ_GOLDEN_MUTANT   // set by CMake on the three mutation targets
constexpr bool MUTANT_BUILD = true;
#else
constexpr bool MUTANT_BUILD = false;
#endif

constexpr int BLOECKE = 200;
constexpr int N_MAX = cdj::MIX_BLOCK;
constexpr double PI = 3.14159265358979323846;
constexpr int KANAL_ERZ8 = 11;   // erz/8: cue-only (VORHOER_KANAL)

struct Xorshift {
  uint64_t s;
  uint64_t next() {
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    return s;
  }
  // uniform in [-1, 1)
  float rausch() { return static_cast<float>(static_cast<double>(next() >> 11) / 4503599627370496.0 - 1.0); }
};

struct Fnv {
  uint64_t h = 0xcbf29ce484222325ull;
  void byte(uint8_t b) {
    h ^= b;
    h *= 0x100000001b3ull;
  }
  void wort(float f) {
    uint32_t u;
    std::memcpy(&u, &f, sizeof u);
    for (int i = 0; i < 4; ++i) byte(static_cast<uint8_t>(u >> (8 * i)));
  }
};

// the quantities that go into the digest besides master/cue: layout of Ergebnis::extra
constexpr int X_EAR = 0;                                          // 2: ear tap L, R
constexpr int X_SPITZE = X_EAR + 2;                               // PEGEL_CUE + 1: level peaks
constexpr int X_LIMITER = X_SPITZE + cdj::Mixer::PEGEL_CUE + 1;   // 1: limiter reduction
constexpr int X_KOMP = X_LIMITER + 1;                             // 3: compressor reduction of deck/1, erz/1, pad/1
constexpr int N_EXTRA = X_KOMP + 3;

struct Ergebnis {
  uint64_t digest = 0;
  double extra[N_EXTRA] = {};      // sum of |x| over the run
  double summe[4] = {};
  double betrag[4] = {};
  long samples = 0;
};

struct Flip {
  int block = -1, kanal = 0, sample = 0;   // one input sample gets +0.25 (negative control)
};

// Sizes: the first blocks are the edge cases, the rest come from a fixed generator.
int groesse(int b, Xorshift& g) {
  static const int randgroessen[] = {1, 1024, 256, 255, 257, 2, 1023, 3, 512, 64};
  if (b < 10) return randgroessen[b];
  return 1 + static_cast<int>(g.next() % N_MAX);
}

Ergebnis lauf(Flip flip) {
  sw::ReglerTabelle tab;
  auto m = std::make_unique<cdj::Mixer>(tab);
  auto r = [&](const std::string& p) {
    const int i = tab.suche(p.c_str());
    PRUEF(i >= 0);
    return i;
  };
  auto setze = [&](const std::string& p, float w) { m->setze_sofort(r(p), w); };

  // ---- fixed set-up ---------------------------------------------------------------------------------------------------
  m->setze_nur_cue(KANAL_ERZ8);   // as kern.cpp does for the browser pre-listen channel
  for (int k = 0; k < cdj::MIX_KANAELE; ++k) {
    const std::string n = cdj::Mixer::kanal_name(k);
    setze(n + "/fader", k % 3 == 0 ? -3.0f : -6.0f);
    setze(n + "/trim", (k % 5) - 2.0f);
    // erz/2..erz/7 (k = 5..10) feed the buses 1..4; the other sources stay on the master (erz/8 never reaches it)
    if (k < cdj::MIX_QUELLEN) setze(n + "/ziel", (k >= 5 && k <= 10) ? static_cast<float>(1 + (k % 4)) : 0.0f);
    if (k < cdj::MIX_QUELLEN) setze(n + "/xseite", static_cast<float>(k % 3));
  }
  setze("xfader", 0.3f);
  setze("master/pegel", -1.0f);
  setze("master/kleber", 0.5f);
  setze("cue/mix", 0.0f);
  setze("cue/pegel", -3.0f);
  setze("master/pfl", 1.0f);
  setze("duck/tiefe", -12.0f);
  for (const char* k : {"deck/1", "erz/2", "pad/2"}) setze(std::string(k) + "/pfl", 1.0f);
  // compressor on deck/1, erz/1, pad/1
  for (const char* k : {"deck/1", "erz/1", "pad/1"}) {
    setze(std::string(k) + "/komp/an", 1.0f);
    setze(std::string(k) + "/komp/schwelle", -24.0f);
    setze(std::string(k) + "/komp/ratio", 3.0f);
    setze(std::string(k) + "/komp/makeup", 2.0f);
  }
  // hall send on four channels, return on
  for (const char* k : {"deck/2", "erz/3", "erz/5", "pad/1"}) setze(std::string(k) + "/send/2", -6.0f);
  setze("fx/2/rueckweg", -4.0f);
  // beat FX: unit 0 (echo) on deck/1 and erz/2 from the start; unit 1 (flanger) on deck/1 and the master, switched on at
  // block 60 (so its LFO starts mid-run), after which deck/1 runs FX1 then FX2
  m->fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.5, 0.4f, 0.5f, 0.5, 0.5, true);
  m->fx_zuweisung_setze(0, 0, true);
  m->fx_zuweisung_setze(0, 5, true);
  m->fx_einheit_setze(1, cdj::BeatFx::AUS, 1.0, 0.0f, 0.5f, 0.5, 0.5, false);
  m->fx_zuweisung_setze(1, 0, true);
  m->fx_zuweisung_setze(1, cdj::Mixer::FX_MASTER, true);

  Xorshift g{0x9e3779b97f4a7c15ull};       // block sizes
  Xorshift rs[cdj::MIX_QUELLEN];          // one noise stream per source
  for (int k = 0; k < cdj::MIX_QUELLEN; ++k) rs[k].s = 0x1234567ull * (k + 1) + 0xabcdefull;

  // the Stellwerk path stores only the pointer (Bahn::verlauf), so every ramp needs its own buffer for the whole block
  float ml[N_MAX] = {}, mr[N_MAX] = {}, cl[N_MAX] = {}, cr[N_MAX] = {};
  float rampe_eq[N_MAX] = {}, rampe_filter[N_MAX] = {};
  Fnv fnv;
  Ergebnis erg;
  long t = 0;
  for (int b = 0; b < BLOECKE; ++b) {
    const int n = groesse(b, g);

    // ---- moves at fixed blocks ------------------------------------------------------------------------------------------
    if (b == 20) setze("deck/1/eq/tief", -12.0f);
    if (b == 35) setze("erz/1/eq/hoch", -200.0f);
    if (b == 50) setze("deck/2/kill/mitte", 1.0f);
    if (b == 60) m->fx_einheit_setze(1, cdj::BeatFx::FLANGER, 1.0, 0.3f, 0.5f, 0.5, 0.5, true);
    if (b == 70) setze("deck/2/kill/mitte", 0.0f);
    if (b == 80) setze("pad/1/kill/tief", 1.0f);
    if (b == 100) setze("pad/1/kill/tief", 0.0f);
    if (b == 110) setze("erz/2/filter", -0.6f);
    if (b == 120) m->fx_routing_setze(cdj::Mixer::ROUTING_INSERT);
    if (b == 130) setze("erz/2/filter", 0.4f);
    if (b == 150) {
      setze("erz/3/eq/mitte", -8.0f);
      setze("master/kleber", 0.0f);
    }
    if (b == 160) setze("bus/2/fader", -2.0f);
    if (b == 170) setze("erz/1/komp/an", 0.0f);
    if (b == 180) setze("erz/1/komp/an", 1.0f);
    if (b >= 40 && b < 44) {   // per-sample ramps (the Stellwerk path): EQ low of deck/3 and the filter of erz/6
      for (int i = 0; i < n; ++i) rampe_eq[i] = -12.0f + 12.0f * static_cast<float>(i) / static_cast<float>(n);
      for (int i = 0; i < n; ++i) rampe_filter[i] = -0.5f + static_cast<float>(i) / static_cast<float>(n);
      m->verlauf(r("deck/3/eq/tief"), rampe_eq);
      m->verlauf(r("erz/6/filter"), rampe_filter);
    }

    // ---- inputs ---------------------------------------------------------------------------------------------------------
    for (int k = 0; k < cdj::MIX_QUELLEN; ++k) {
      const double f = 80.0 * (k + 1) + 13.0 * k;
      for (int i = 0; i < n; ++i) {
        float l, rr;
        if (k % 2 == 0) {
          l = 0.25f * rs[k].rausch();
          rr = 0.25f * rs[k].rausch();
        } else {
          l = static_cast<float>(0.4 * std::sin(2.0 * PI * f * (t + i) / 48000.0));
          rr = static_cast<float>(0.4 * std::sin(2.0 * PI * f * (t + i) / 48000.0 + 0.3));
        }
        if (b == flip.block && k == flip.kanal && i == flip.sample) l += 0.25f;
        m->eingang_l(k)[i] += l;
        m->eingang_r(k)[i] += rr;
      }
    }
    // metronome click on the master sum and the PFL path every 6000 samples (8 samples long), test click on the master
    // input every 17000 samples (4 samples long)
    for (int i = 0; i < n; ++i) {
      if ((t + i) % 6000 < 8) {
        m->summe_eingang_l()[i] += 0.5f;
        m->summe_eingang_r()[i] += 0.5f;
        m->pfl_eingang_l()[i] += 0.5f;
        m->pfl_eingang_r()[i] += 0.5f;
      }
      if ((t + i) % 17000 < 4) {
        m->master_eingang_l()[i] += 0.3f;
        m->master_eingang_r()[i] += 0.3f;
      }
    }
    // kick events for the ducking of erz/2 and erz/3: every 22500 samples, offset into this block
    for (long p = 11250; p < t + n; p += 22500)
      if (p >= t) m->duck_ausloesen(p - t);
    m->fx_takt(static_cast<double>(t) / 22500.0, 128.0 / 60.0 / 48000.0);
    t += n;

    m->verarbeite(n, ml, mr, cl, cr);

    const float* aus[4] = {ml, mr, cl, cr};
    for (int s = 0; s < 4; ++s)
      for (int i = 0; i < n; ++i) {
        fnv.wort(aus[s][i]);
        erg.summe[s] += static_cast<double>(aus[s][i]);
        erg.betrag[s] += std::fabs(static_cast<double>(aus[s][i]));
      }
    for (int i = 0; i < n; ++i) {   // the ear tap (sum before master/pegel and limiter)
      fnv.wort(m->master_summe_l()[i]);
      erg.extra[X_EAR] += std::fabs(static_cast<double>(m->master_summe_l()[i]));
    }
    for (int i = 0; i < n; ++i) {
      fnv.wort(m->master_summe_r()[i]);
      erg.extra[X_EAR + 1] += std::fabs(static_cast<double>(m->master_summe_r()[i]));
    }
    for (int k = 0; k <= cdj::Mixer::PEGEL_CUE; ++k) {
      const float v = m->spitze_lesen(k);
      fnv.wort(v);
      erg.extra[X_SPITZE + k] += std::fabs(static_cast<double>(v));
    }
    {
      const float v = m->limiter_absenkung_db();
      fnv.wort(v);
      erg.extra[X_LIMITER] += std::fabs(static_cast<double>(v));
    }
    int ik = 0;
    for (int k : {0, 4, 12}) {
      const float v = m->komp_gr_db(k);
      fnv.wort(v);
      erg.extra[X_KOMP + ik++] += std::fabs(static_cast<double>(v));
    }
    erg.samples += n;
  }
  erg.digest = fnv.h;
  return erg;
}

bool nah(double ist, double soll, double rel) { return std::fabs(ist - soll) <= rel * std::fmax(std::fabs(soll), 1e-12); }

}  // namespace

// per quantity of Ergebnis::extra (ear tap L/R, level peaks 0..PEGEL_CUE, limiter, compressor x3), sum of |x| over the run
static const double GOLDEN_EXTRA[N_EXTRA] = {
    0x1.87412bf3cd18p+14, 0x1.802819b50b204p+14,
    0x1.3db04ff2p+4, 0x1.18813f8cp+5,
    0x1.50e6a7e88p+5, 0x1.f693ffe2p+5,
    0x1.7e3161894p+3, 0x1.ba11870bp+4,
    0x1.8a6170b1p+5, 0x0p+0,
    0x1.7ab54ab78p+5, 0x1.180ba4ec4p+6,
    0x1.0cdc9b06p+5, 0x0p+0,
    0x1.5c8354a8p+4, 0x1.64a10a59cp+5,
    0x0p+0, 0x0p+0,
    0x0p+0, 0x0p+0,
    0x1.8637a403p+6, 0x1.1370a918p+7,
    0x1.4b2976ecfep+3, 0x1.de08139e228p+10,
    0x1.460162f2cep+10, 0x1.115d3de81fcp+11,
};

int main(int argc, char** argv) {
  const std::string tc = toolchain_text();
  const Ergebnis a = lauf({});
  const Ergebnis b = lauf({});
  std::printf("toolchain: %s\n", tc.c_str());
  std::printf("digest: 0x%016" PRIx64 "  samples: %ld\n", a.digest, a.samples);
  for (int s = 0; s < 4; ++s) std::printf("signal %d: summe %a  betrag %a\n", s, a.summe[s], a.betrag[s]);
  for (int x = 0; x < N_EXTRA; ++x) std::printf("extra %d: betrag %a\n", x, a.extra[x]);

  // determinism: two runs of the same scenario in one process are bit-identical
  PRUEF(a.digest == b.digest);
  PRUEF(a.samples == GOLDEN_SAMPLES);   // the scenario really ran with the recorded block sizes

  // negative control: one flipped input sample (deck/1, block 30, sample 0) changes the digest and the sums
  {
    Flip f;
    f.block = 30;
    f.kanal = 0;
    f.sample = 0;
    const Ergebnis c = lauf(f);
    PRUEF(c.digest != a.digest);
    PRUEF(!nah(c.betrag[0], a.betrag[0], 1e-7) || !nah(c.summe[0], a.summe[0], 1e-7) || !nah(c.betrag[2], a.betrag[2], 1e-7));
  }
  // the output carries signal (not an all-zero scenario that would make any digest "equal")
  for (int s = 0; s < 4; ++s) PRUEF(a.betrag[s] > 100.0);

  if (argc > 1 && std::strcmp(argv[1], "aufnehmen") == 0) {   // recording mode: print only, no comparison
    PRUEF_ENDE();
  }

  // The decision, on the digest first (see the header).
  if (a.digest == GOLDEN_DIGEST) {
    std::printf("bit-exact: digest equal to the recorded one%s\n", tc == GOLDEN_TOOLCHAIN ? "" : " (on another toolchain string)");
  } else if (tc == GOLDEN_TOOLCHAIN) {
    PRUEF(a.digest == GOLDEN_DIGEST);   // same toolchain, different digest: the mixer changed, no tolerance
  } else if (MUTANT_BUILD) {
    if (pruef_fehler == 0) {
      std::printf("SKIP: mutation guard needs bit-exact toolchain (this: %s; recorded: %s)\n", tc.c_str(), GOLDEN_TOOLCHAIN);
      return 77;   // CTest SKIP_RETURN_CODE
    }
  } else {
    std::printf("NOT bit-exact: golden from another toolchain (recorded: %s; this: %s). Comparing sums with 1e-4 relative.\n",
                GOLDEN_TOOLCHAIN, tc.c_str());
    for (int s = 0; s < 4; ++s) {
      PRUEF(std::fabs(a.summe[s] - GOLDEN_SUMME[s]) <= 1e-4 * GOLDEN_BETRAG[s]);
      PRUEF(nah(a.betrag[s], GOLDEN_BETRAG[s], 1e-4));
    }
    for (int x = 0; x < N_EXTRA; ++x) PRUEF(nah(a.extra[x], GOLDEN_EXTRA[x], 1e-4));
  }
  PRUEF_ENDE();
}
