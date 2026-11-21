// Container core K0: name-based oracle of the console, recorded on the base tree (d65f349e0, 14 source channels).
//
// Why it exists: the old golden test (deleted in K9) digested all 14 sources by index and dies when the console shrinks to four containers (K9).
// The rebuild needs an oracle that survives the shrink: the same signal through a container strip, the buses and the master must
// give the same bytes before and after. This test therefore uses names only:
//   - strips are found with Mixer::kanal_index("deck/1") etc., never by a literal index;
//   - komp/sc takes the values 0..2 only (0 own, 1 deck/1, 2 deck/2: the same meaning in both worlds);
//   - no duck (the duck target moves in K4), no spectrum, no cue-only channel, no erz/* strips.
// Only deck/1, deck/2, pad/1, pad/2, bus/1..4, fx/*, master and cue are used. These are the paths PULT_CONTAINER_PFAD keeps.
//
// Six cases, each an FNV-1a 64 digest over the bit patterns of master L/R (digest "master") and cue L/R (digest "cue") of 64
// blocks of 256 samples. Input is a fixed noise (xorshift) or sine per strip, stereo with a small L/R difference. Fader values
// are in dB (the table's unit): "fader 0.8" of the plan is the linear gain 0.8, that is -1.94 dB.
//   1 deck1_volle_kette   deck/1: trim +3, EQ, DJ filter, compressor on, send 1 and 2 at -6 dB, fader -1.94 dB
//   2 pad2_kill_und_pfl   pad/2: all three kills, PFL on (the cue digest is the PFL path), one band comes back at block 32
//   3 bus_und_xfader      deck/1 -> bus/1, deck/2 -> bus/2 through <strip>/ziel, crossfader at 0.3, strips on the two sides
//   4 master_beatfx       beat FX unit 1 (echo) assigned to the master, deck/1 and pad/1 play
//   5 sidechain_deck2     deck/1 komp/sc = 2 (key = deck/2 input), deck/2 plays kicks
//   6 fx_sends           (X1, R13) sends into fx/2 (hall) and into the graph sends fx/3 and fx/4 (an echo graph each), returns into the master
//                        sum; recorded on the base mixer sources (byte-identical to d65f349e0) in X1, compared by name old against new
// Each case also checks that the output carries signal (a silent case would make any digest "equal").
//
// Toolchain: like the old golden test. Equal digest: bit-exact, passed. Different digest on the recorded toolchain string: red.
// Different digest on another toolchain string: the sums of the four signals are compared with 1e-4 relative.
//
// Recording (`test_mixer_orakel --aufnehmen` prints the values without comparing): only on the base tree d65f349e0 or on a
// tree whose mixer sources are byte-identical to it. Never to make a failing run green after a change to src/mixer.cpp.
// Negative control: one flipped input sample must change the digest of case 1; two runs of a case must agree.
#include <gnu/libc-version.h>

#include <cinttypes>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

// ---- recorded values (K0, base tree d65f349e0) ---------------------------------------------------------------------------
static const char* ORAKEL_TOOLCHAIN = "gcc 13.3.0 | opt=on | fma=none | std=gnu | x86_64 | glibc 2.39 | rustc 1.93.1";
struct Soll {
  uint64_t master, cue;
  double summe[4];    // master L, master R, cue L, cue R: sum of the samples
  double betrag[4];   // and sum of |samples|
};
static const Soll ORAKEL[6] = {
    {0xbcbac9896667a3afull, 0xe2baafe3b62c67d3ull,
     {0x1.24ece8bf287p+3, 0x1.59912f64026cp+2, 0x1.9ec02934668p+1, 0x1.e9491c13dd08p+0},
     {0x1.c9a2300b9b768p+8, 0x1.c13a2c958e8a5p+8, 0x1.43facf988868p+7, 0x1.3e074d5397177p+7}},
    {0x02a8238f58985d90ull, 0x6c2a714788a9d7daull,
     {-0x1.06d8ccb74p+2, -0x1.6f0e4e37bp+2, -0x1.e100191p+1, -0x1.4fd97d53fp+2},
     {0x1.426c422686bp+10, 0x1.42a7933b837p+10, 0x1.2702dc7c519p+10, 0x1.2739228a53dp+10}},
    {0x1311060cf4a88ea1ull, 0xba21b9801853ca5eull,
     {-0x1.f4b0cb25f8p+0, 0x1.5c2c0607082cp+4, -0x1.62763f13dep-1, 0x1.ecf9472e0888p+2},
     {0x1.1e1a8661e3208p+11, 0x1.1e808a43594fcp+11, 0x1.95177875bb4a8p+9, 0x1.95a7e9b47eaa5p+9}},
    {0xc317b8ac51460aadull, 0x59bbee853e2f8640ull,
     {0x1.74c25fe5b28p+1, 0x1.43399a3716a8p+4, 0x1.07e4b940c78p+0, 0x1.c9a6ccf7371p+2},
     {0x1.ec4fc094e6aacp+10, 0x1.edfd9f29f710ep+10, 0x1.5c87a52931f04p+9, 0x1.5db7f82d058b2p+9}},
    {0x1703995082a80a99ull, 0xbc4279af226867f2ull,
     {0x1.321d3c0f3c001p+6, 0x1.5650713dda22p+6, 0x1.b16cac1a706e4p+4, 0x1.e4ae086f6946p+4},
     {0x1.2ca6bff3eac0cp+9, 0x1.2c85be75d182cp+9, 0x1.a9b091afdfc9cp+7, 0x1.a981d619bb174p+7}},
    {0x5a6b08956618387aull, 0x642a5cf7349f0717ull,   // case 6: recorded in X1 on the old mixer sources (d65f349e0), same bytes on the rebuilt console
     {0x1.c45525376cp+1, 0x1.cd0fe4bba0b8p+5, 0x1.403a1f4eb8p+0, 0x1.46682e5e521cp+4},
     {0x1.d3f0efbde9e4p+11, 0x1.d34441094ca12p+11, 0x1.4b46e6e979c3p+10, 0x1.4acca6f3cbb39p+10}},
};

namespace {

#ifdef CYPHERDJ_RUSTC_VERSION
constexpr const char* RUSTC_TEXT = CYPHERDJ_RUSTC_VERSION;
#else
constexpr const char* RUSTC_TEXT = "unknown";
#endif

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
  s += " | rustc ";
  s += RUSTC_TEXT;
  return s;
}

constexpr int BLOECKE = 64;
constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

struct Xorshift {
  uint64_t s;
  uint64_t next() {
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    return s;
  }
  float rausch() { return static_cast<float>(static_cast<double>(next() >> 11) / 4503599627370496.0 - 1.0); }   // [-1, 1)
};

struct Fnv {
  uint64_t h = 0xcbf29ce484222325ull;
  void wort(float f) {
    uint32_t u;
    std::memcpy(&u, &f, sizeof u);
    for (int i = 0; i < 4; ++i) {
      h ^= static_cast<uint8_t>(u >> (8 * i));
      h *= 0x100000001b3ull;
    }
  }
};

struct Ergebnis {
  uint64_t master = 0, cue = 0;
  double summe[4] = {}, betrag[4] = {};
};

struct Flip {
  int block = -1, sample = 0;   // one sample of the first fed strip gets +0.25 (negative control)
};

// one fed strip: noise or sine, a name, its own noise state
struct Quelle {
  const char* name;
  bool rauschen;
  double hz;
  float amp;
  int idx = -1;
  Xorshift rs{};
};

// a kick every 6000 samples (200 samples long, 60 Hz burst), for the sidechain case
float kick(long t) {
  const long p = t % 6000;
  if (p >= 200) return 0.0f;
  return static_cast<float>(0.9 * std::sin(2.0 * PI * 60.0 * static_cast<double>(p) / 48000.0) * (1.0 - static_cast<double>(p) / 200.0));
}

struct Szene {
  std::unique_ptr<sw::ReglerTabelle> tab = std::make_unique<sw::ReglerTabelle>();
  std::unique_ptr<cdj::Mixer> m;
  Szene() { m = std::make_unique<cdj::Mixer>(*tab); }
  int r(const std::string& p) {
    const int i = tab->suche(p.c_str());
    PRUEF(i >= 0);
    return i;
  }
  void setze(const std::string& p, float w) { m->setze_sofort(r(p), w); }
};

// runs the scene: `aufbau` sets the console, `bewegung(block)` moves things at fixed blocks, `quellen` feed strips
template <class Aufbau, class Bewegung>
Ergebnis lauf(Quelle* q, int nq, Aufbau aufbau, Bewegung bewegung, bool kicks_auf_zweiten, Flip flip) {
  Szene s;
  // every strip starts closed (fader default is -200 dB); the case opens what it uses
  aufbau(s);
  for (int i = 0; i < nq; ++i) {
    q[i].idx = cdj::Mixer::kanal_index(q[i].name);
    PRUEF(q[i].idx >= 0);
    q[i].rs.s = 0x1234567ull * (i + 1) + 0xabcdefull;
  }
  float ml[N] = {}, mr[N] = {}, cl[N] = {}, cr[N] = {};
  Fnv fm, fc;
  Ergebnis e;
  long t = 0;
  for (int b = 0; b < BLOECKE; ++b) {
    bewegung(s, b);
    for (int k = 0; k < nq; ++k) {
      for (int i = 0; i < N; ++i) {
        float l, rr;
        if (kicks_auf_zweiten && k == 1) {
          l = rr = kick(t + i);
        } else if (q[k].rauschen) {
          l = q[k].amp * q[k].rs.rausch();
          rr = q[k].amp * q[k].rs.rausch();
        } else {
          l = static_cast<float>(q[k].amp * std::sin(2.0 * PI * q[k].hz * static_cast<double>(t + i) / 48000.0));
          rr = static_cast<float>(q[k].amp * std::sin(2.0 * PI * q[k].hz * static_cast<double>(t + i) / 48000.0 + 0.3));
        }
        if (k == 0 && b == flip.block && i == flip.sample) l += 0.25f;
        s.m->eingang_l(q[k].idx)[i] += l;
        s.m->eingang_r(q[k].idx)[i] += rr;
      }
    }
    s.m->fx_takt(static_cast<double>(t) / 22500.0, 128.0 / 60.0 / 48000.0);
    t += N;
    s.m->verarbeite(N, ml, mr, cl, cr);
    const float* aus[4] = {ml, mr, cl, cr};
    for (int g = 0; g < 4; ++g)
      for (int i = 0; i < N; ++i) {
        (g < 2 ? fm : fc).wort(aus[g][i]);
        e.summe[g] += static_cast<double>(aus[g][i]);
        e.betrag[g] += std::fabs(static_cast<double>(aus[g][i]));
      }
  }
  e.master = fm.h;
  e.cue = fc.h;
  return e;
}

void basis(Szene& s) {   // master open, cue open; no duck, nothing else
  s.setze("master/pegel", -1.0f);
  s.setze("cue/pegel", -3.0f);
  s.setze("cue/mix", 0.0f);
}

void offen(Szene& s, const char* kanal, float fader_db) { s.setze(std::string(kanal) + "/fader", fader_db); }

// ---- the five cases ---------------------------------------------------------------------------------------------------------
Ergebnis fall1(Flip flip) {
  Quelle q[] = {{"deck/1", true, 0.0, 0.3f}};
  return lauf(q, 1,
              [](Szene& s) {
                basis(s);
                offen(s, "deck/1", -1.94f);
                s.setze("deck/1/trim", 3.0f);
                s.setze("deck/1/eq/tief", -4.0f);
                s.setze("deck/1/eq/mitte", 2.0f);
                s.setze("deck/1/eq/hoch", -8.0f);
                s.setze("deck/1/filter", -0.35f);
                s.setze("deck/1/komp/an", 1.0f);
                s.setze("deck/1/komp/schwelle", -24.0f);
                s.setze("deck/1/komp/ratio", 3.0f);
                s.setze("deck/1/komp/makeup", 2.0f);
                s.setze("deck/1/send/1", -6.0f);
                s.setze("deck/1/send/2", -6.0f);
                s.setze("fx/1/rueckweg", -4.0f);
                s.setze("fx/2/rueckweg", -4.0f);
              },
              [](Szene& s, int b) {
                if (b == 30) s.setze("deck/1/filter", 0.4f);
                if (b == 45) s.setze("deck/1/eq/tief", -200.0f);
              },
              false, flip);
}

Ergebnis fall2() {
  Quelle q[] = {{"pad/2", false, 440.0, 0.4f}};
  return lauf(q, 1,
              [](Szene& s) {
                basis(s);
                offen(s, "pad/2", -3.0f);
                s.setze("pad/2/kill/tief", 1.0f);
                s.setze("pad/2/kill/mitte", 1.0f);
                s.setze("pad/2/kill/hoch", 1.0f);
                s.setze("pad/2/pfl", 1.0f);
              },
              [](Szene& s, int b) {
                if (b == 32) s.setze("pad/2/kill/mitte", 0.0f);   // one band comes back halfway
              },
              false, {});
}

Ergebnis fall3() {
  Quelle q[] = {{"deck/1", true, 0.0, 0.25f}, {"deck/2", false, 330.0, 0.4f}};
  return lauf(q, 2,
              [](Szene& s) {
                basis(s);
                offen(s, "deck/1", -3.0f);
                offen(s, "deck/2", -3.0f);
                s.setze("deck/1/ziel", 1.0f);
                s.setze("deck/2/ziel", 2.0f);
                s.setze("deck/1/xseite", 0.0f);
                s.setze("deck/2/xseite", 2.0f);
                offen(s, "bus/1", 0.0f);
                offen(s, "bus/2", -2.0f);
                s.setze("xfader", 0.3f);
              },
              [](Szene& s, int b) {
                if (b == 40) s.setze("xfader", -0.5f);
              },
              false, {});
}

Ergebnis fall4() {
  Quelle q[] = {{"deck/1", true, 0.0, 0.25f}, {"pad/1", false, 220.0, 0.4f}};
  return lauf(q, 2,
              [](Szene& s) {
                basis(s);
                offen(s, "deck/1", -3.0f);
                offen(s, "pad/1", -6.0f);
                s.m->fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.5, 0.4f, 0.5f, 0.5, 0.5, true);
                s.m->fx_zuweisung_setze(0, cdj::Mixer::FX_MASTER, true);
              },
              [](Szene&, int) {}, false, {});
}

Ergebnis fall5() {
  Quelle q[] = {{"deck/1", true, 0.0, 0.3f}, {"deck/2", false, 0.0, 0.0f}};   // deck/2 is fed with kicks (kicks_auf_zweiten)
  return lauf(q, 2,
              [](Szene& s) {
                basis(s);
                offen(s, "deck/1", -3.0f);
                offen(s, "deck/2", -3.0f);
                s.setze("deck/1/komp/an", 1.0f);
                s.setze("deck/1/komp/schwelle", -30.0f);
                s.setze("deck/1/komp/ratio", 8.0f);
                s.setze("deck/1/komp/attack", 1.0f);
                s.setze("deck/1/komp/release", 80.0f);
                // key = deck/2 input. Value 2 means deck/2 in the base and container B in the rebuild.
                s.setze("deck/1/komp/sc", 2.0f);
              },
              [](Szene&, int) {}, true, {});
}

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  PRUEF(g != nullptr);
  return g;
}
static const char* ECHO6 =
    R"({"format":"baukasten/2","name":"echo6","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"d","art":"delay","zeit":7,"fb":0.5,"mix":1,"max":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"d.l"},{"von":"e.r","nach":"d.r"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}]})";

// sends into the three effective buses: fx/2 is the hall, fx/3 and fx/4 carry a send graph (an echo)
Ergebnis fall6() {
  Quelle q[] = {{"deck/1", true, 0.0, 0.25f}, {"deck/2", false, 330.0, 0.4f}};
  return lauf(q, 2,
              [](Szene& s) {
                basis(s);
                offen(s, "deck/1", -3.0f);
                offen(s, "deck/2", -3.0f);
                s.setze("deck/1/send/2", -6.0f);
                s.setze("deck/1/send/3", -4.0f);
                s.setze("deck/2/send/3", -9.0f);
                s.setze("deck/2/send/4", -5.0f);
                s.setze("fx/2/rueckweg", -4.0f);
                s.setze("fx/3/rueckweg", -3.0f);
                s.setze("fx/4/rueckweg", -5.0f);
                s.m->setze_send_graph(2, graph(ECHO6));
                s.m->setze_send_graph(3, graph(ECHO6));
              },
              [](Szene& s, int b) {
                if (b == 40) s.setze("deck/1/send/2", -200.0f);   // the hall tail rings out
              },
              false, {});
}

bool nah(double ist, double soll, double rel) { return std::fabs(ist - soll) <= rel * std::fmax(std::fabs(soll), 1e-12); }

}  // namespace

int main(int argc, char** argv) {
  const bool aufnehmen = argc > 1 && std::strcmp(argv[1], "--aufnehmen") == 0;
  const std::string tc = toolchain_text();
  const char* name[6] = {"deck1_volle_kette", "pad2_kill_und_pfl", "bus_und_xfader", "master_beatfx", "sidechain_deck2", "fx_sends"};
  Ergebnis ist[6] = {fall1({}), fall2(), fall3(), fall4(), fall5(), fall6()};
  const Ergebnis wieder[6] = {fall1({}), fall2(), fall3(), fall4(), fall5(), fall6()};
  std::printf("toolchain: %s\n", tc.c_str());
  for (int c = 0; c < 6; ++c) {
    std::printf("fall %d %s: master 0x%016" PRIx64 " cue 0x%016" PRIx64 "\n", c + 1, name[c], ist[c].master, ist[c].cue);
    for (int g = 0; g < 4; ++g) std::printf("fall %d signal %d: summe %a betrag %a\n", c + 1, g, ist[c].summe[g], ist[c].betrag[g]);
    PRUEF(ist[c].master == wieder[c].master && ist[c].cue == wieder[c].cue);   // two runs agree
  }
  // each case carries signal where it must: master in 1, 3, 4, 5; cue in 2 (PFL path)
  PRUEF(ist[0].betrag[0] > 10.0 && ist[0].betrag[1] > 10.0);
  PRUEF(ist[1].betrag[2] > 10.0 && ist[1].betrag[3] > 10.0);
  PRUEF(ist[2].betrag[0] > 10.0 && ist[2].betrag[1] > 10.0);
  PRUEF(ist[3].betrag[0] > 10.0 && ist[3].betrag[1] > 10.0);
  PRUEF(ist[4].betrag[0] > 10.0 && ist[4].betrag[1] > 10.0);
  PRUEF(ist[5].betrag[0] > 10.0 && ist[5].betrag[1] > 10.0);
  // the cases differ from each other (a digest that ignores the strips would make all of them equal)
  for (int a = 0; a < 6; ++a)
    for (int b = a + 1; b < 6; ++b) PRUEF(ist[a].master != ist[b].master);
  // negative control: one flipped input sample (deck/1, block 30, sample 0) changes the digest of case 1
  {
    Flip f;
    f.block = 30;
    f.sample = 0;
    const Ergebnis c = fall1(f);
    PRUEF(c.master != ist[0].master);
  }
  if (aufnehmen) PRUEF_ENDE();

  const bool gleiche_kette = tc == ORAKEL_TOOLCHAIN;
  bool bitgleich = true;
  for (int c = 0; c < 6; ++c) bitgleich = bitgleich && ist[c].master == ORAKEL[c].master && ist[c].cue == ORAKEL[c].cue;
  if (bitgleich) {
    std::printf("bit-exact: all digests equal to the recorded ones%s\n", gleiche_kette ? "" : " (on another toolchain string)");
  } else if (gleiche_kette) {
    for (int c = 0; c < 6; ++c) {
      PRUEF(ist[c].master == ORAKEL[c].master);   // same toolchain, different digest: the console changed, no tolerance
      PRUEF(ist[c].cue == ORAKEL[c].cue);
    }
  } else {
    std::printf("NOT bit-exact: oracle from another toolchain (recorded: %s; this: %s). Comparing sums with 1e-4 relative.\n",
                ORAKEL_TOOLCHAIN, tc.c_str());
    for (int c = 0; c < 6; ++c)
      for (int g = 0; g < 4; ++g) {
        PRUEF(std::fabs(ist[c].summe[g] - ORAKEL[c].summe[g]) <= 1e-4 * std::fmax(ORAKEL[c].betrag[g], 1e-9));
        PRUEF(nah(ist[c].betrag[g], ORAKEL[c].betrag[g], 1e-4));
      }
  }
  PRUEF_ENDE();
}
