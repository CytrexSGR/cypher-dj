// 1.15 A5b: the channel limiter on bus/1..4 (D1, D7, D8). Mixer::setze_kanal_limiter(vorhalt_ms, echtspitze) builds the four KanalLimiter
// objects (outside the callback) and sets the latency account to their latenz_samples(). Every case runs on bus/1 and bus/4 (the index
// ends; the sources never own a limiter) and at block sizes 256, 128, 64, 32.
//  (B)   the setter: vorhalt 0 builds nothing (L = 0); 0.5 ms gives 26, with echtspitze 38, 1.5 ms gives 74; L is the limiter's own latenz_samples()
//  (G)   the getter kanal_limiter_reduktion_db(bus): 0 when not built, 0 with lim/an 0, 0 for a bus outside 0..3 (no indexing), about 9 dB for a
//        +6 dBFS sine under a -3 dB ceiling, only on the bus that carries it
//  (L1)  not built (vorhalt 0): lim/an 1 changes nothing (bit-identical to a mixer that never saw lim/an), L = 0. The golden digest: test_mixer_golden
//  (L2)  built, lim/an 0: the bus output equals the input of the unbuilt mixer delayed by L bit for bit (tap and master); positive control lim/an 1
//        with a +6 dBFS sine differs
//  (L3)  on: a +6 dBFS sine (the bus fader at +6 dB after it) peaks at decke - 0.001 dB at the master, at 100 Hz and 1 kHz; with true peak too
//  (L4)  the latency is latenz_samples(): an impulse arrives that many samples after the unbuilt mixer's, with lim/an 0 and 1 (26, 38, 74)
//  (L5)  the on/off crossfade (D7): no step above 0.1 of the peak, switched on and off at eight phases of a 100 Hz sine
//  (L6)  decke and abklingen change at run time: the change takes effect (the new ceiling, a fast or slow release) without a step above 0.1 of the peak
//  (L7)  a send taken before the limiter is not limited (channel_strip.cpp: the sends come off the fader output, in front of the limiter)
//  (L8)  the objects exist before the first block: 0 allocations, frees, locks, sleeps with every path in use and the F01 guard hit
//  (F)   the F01 guard resets the limiter objects (a NaN on a bus-routed source; the reduction a loud burst left behind is gone afterwards)
#include <climits>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "cypherdj/dsp/channel_limiter.h"
#include "mixer_wz_run.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace wzt;

namespace {

namespace dsp = cypherdj::dsp;
constexpr int GROESSEN[] = {256, 128, 64, 32};
constexpr int BUSSE[] = {1, 4};

const char* bpfad(char* puffer, int bus, const char* rest) {
  std::snprintf(puffer, 48, "bus/%d/%s", bus, rest);
  return puffer;
}
void setze_bus(Lauf& l, int bus, const char* rest, float w) {
  char p[48];
  l.setze(bpfad(p, bus, rest), w);
}
void ziel_bus(Lauf& l, int quelle, int bus) { l.setze(quelle, "ziel", static_cast<float>(bus)); }

struct Aufnahme {
  std::vector<float> tap, ml, mr;   // bus sum at the tap (master_summe_l), master out left/right
};

// A mixer with the limiters built as asked (vorhalt 0 = nothing built), bus `bus` fed from erz/1, all faders at 0 dB.
struct Aufbau {
  Lauf l;
  int bus;
  Aufbau(double vorhalt_ms, bool echt, int bus_) : bus(bus_) {
    l.m->setze_kanal_limiter(vorhalt_ms, echt);
    l.setze(ERZ1, "ziel", static_cast<float>(bus));
  }
  // one block of n samples; src(i, t) = source sample at absolute sample t; the block is recorded into a
  template <class F>
  void block(int n, F&& src, Aufnahme& a) {
    for (int i = 0; i < n; ++i) {
      const float v = src(l.t + i);
      l.m->eingang_l(ERZ1)[i] = v;
      l.m->eingang_r(ERZ1)[i] = v;
    }
    l.verarbeite(n);
    a.tap.insert(a.tap.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
    a.ml.insert(a.ml.end(), l.ml, l.ml + n);
    a.mr.insert(a.mr.end(), l.mr, l.mr + n);
  }
};

auto sinus_f(double f, double amp) {
  return [f, amp](long t) { return static_cast<float>(amp * std::sin(2.0 * PI * f * static_cast<double>(t) / 48000.0)); };
}

double spitze_von(const std::vector<float>& x, long von, long bis) {
  float p = 0.0f;
  for (long i = von; i < bis && i < static_cast<long>(x.size()); ++i) p = std::fmax(p, std::fabs(x[static_cast<size_t>(i)]));
  return p;
}
double db_von(double lin) { return 20.0 * std::log10(std::fmax(lin, 1e-15)); }
double max_schritt(const std::vector<float>& x, long von, long bis) {
  double d = 0.0;
  for (long i = std::max(von, 1L); i < bis && i < static_cast<long>(x.size()); ++i)
    d = std::fmax(d, std::fabs(static_cast<double>(x[static_cast<size_t>(i)]) - x[static_cast<size_t>(i) - 1]));
  return d;
}

// ---- (B) ----
void b_setter() {
  struct Fall { double v; bool e; int soll; } faelle[] = {{0.5, false, 26}, {0.5, true, 38}, {1.5, false, 74}, {1.5, true, 86}, {0.1, false, 7}, {20.0, false, 962}};
  for (const Fall& f : faelle) {
    Lauf l;
    PRUEF(!l.m->kanal_limiter_gebaut() && l.m->kanal_latenz() == 0);
    l.m->setze_kanal_limiter(f.v, f.e);
    dsp::KanalLimiterEinstellung es;
    es.vorhalt_ms = static_cast<float>(f.v);
    es.echtspitze = f.e;
    const int eigen = dsp::KanalLimiter(48000.0, es).latenz_samples();
    std::printf("B: vorhalt %.1f ms echtspitze %d: L = %d (limiter's own latenz_samples() %d)\n", f.v, f.e ? 1 : 0, l.m->kanal_latenz(), eigen);
    PRUEF(l.m->kanal_limiter_gebaut());
    PRUEF(l.m->kanal_latenz() == eigen);   // L comes from the limiter
    PRUEF(l.m->kanal_latenz() == f.soll);  // and is the number the plan names
  }
  {   // 0 builds nothing and leaves L at 0; a value below 0.1 is the library's clamp (0.1 ms), the config validator rejects it earlier
    Lauf l;
    l.m->setze_kanal_limiter(0.0, true);
    PRUEF(!l.m->kanal_limiter_gebaut() && l.m->kanal_latenz() == 0);
    l.m->setze_kanal_limiter(-1.0, false);
    PRUEF(!l.m->kanal_limiter_gebaut() && l.m->kanal_latenz() == 0);
    l.m->setze_kanal_limiter(0.05, false);
    PRUEF(l.m->kanal_limiter_gebaut() && l.m->kanal_latenz() == 7);
    l.m->setze_kanal_limiter(0.0, false);   // and back: nothing built again, L = 0
    PRUEF(!l.m->kanal_limiter_gebaut() && l.m->kanal_latenz() == 0);
  }
}

// ---- (G) ----
void g_getter() {
  {   // not built: 0 for every bus, in range or not
    Lauf l;
    for (int b : {0, 1, 2, 3, -1, 4, 5, 100, INT_MIN, INT_MAX}) PRUEF(l.m->kanal_limiter_reduktion_db(b) == 0.0f);
  }
  for (int bus : BUSSE) {
    Aufbau a(0.5, false, bus);
    setze_bus(a.l, bus, "lim/decke", -3.0f);
    Aufnahme rec;
    // lim/an 0: loud signal, nothing reduced
    for (int b = 0; b < 200; ++b) a.block(256, sinus_f(1000.0, 2.0), rec);
    for (int b = 0; b < 4; ++b) PRUEF(a.l.m->kanal_limiter_reduktion_db(b) == 0.0f);
    setze_bus(a.l, bus, "lim/an", 1.0f);
    for (int b = 0; b < 200; ++b) a.block(256, sinus_f(1000.0, 2.0), rec);
    const float r = a.l.m->kanal_limiter_reduktion_db(bus - 1);
    std::printf("G: bus/%d reduction of a +6 dBFS sine under a -3 dB ceiling: %.3f dB (expected about 9.0)\n", bus, r);
    PRUEF(r > 8.5f && r < 9.6f);
    for (int b = 0; b < 4; ++b)
      if (b != bus - 1) PRUEF(a.l.m->kanal_limiter_reduktion_db(b) == 0.0f);   // only the bus that carries the signal
    for (int b : {-1, 4, 7, INT_MIN, INT_MAX}) PRUEF(a.l.m->kanal_limiter_reduktion_db(b) == 0.0f);
    setze_bus(a.l, bus, "lim/an", 0.0f);
    a.block(256, sinus_f(1000.0, 2.0), rec);   // the limiter is still fading out (480 samples) in this block
    PRUEF(a.l.m->kanal_limiter_reduktion_db(bus - 1) == 0.0f);   // lim/an 0: 0 at once, not only after the fade
    for (int b = 0; b < 4; ++b) a.block(256, sinus_f(1000.0, 2.0), rec);
    PRUEF(a.l.m->kanal_limiter_reduktion_db(bus - 1) == 0.0f);
  }
}

// ---- (L1) ----
void l1_nicht_gebaut() {
  for (int n : GROESSEN)
    for (int bus : {1, 2, 3, 4}) {
      Aufbau mit(0.0, false, bus), ohne(0.0, false, bus);
      setze_bus(mit.l, bus, "lim/an", 1.0f);
      setze_bus(mit.l, bus, "lim/decke", -30.0f);
      setze_bus(mit.l, bus, "lim/abklingen", 5.0f);
      Aufnahme am, ao;
      auto src = [](long t) { return static_cast<float>(1.8 * std::sin(2.0 * PI * 700.0 * static_cast<double>(t) / 48000.0)); };
      for (int b = 0; b < 8192 / n; ++b) {
        mit.block(n, src, am);
        ohne.block(n, src, ao);
      }
      PRUEF(am.tap == ao.tap && am.ml == ao.ml && am.mr == ao.mr);   // bit for bit
      PRUEF(mit.l.m->kanal_latenz() == 0 && !mit.l.m->kanal_limiter_gebaut());
      PRUEF(mit.l.m->kanal_limiter_reduktion_db(bus - 1) == 0.0f);
      PRUEF(spitze_von(am.tap, 4096, 8192) > 1.7);   // the signal really is loud and passes unreduced
    }
}

// ---- (L2) ----
void l2_aus_ist_verzoegerung() {
  const int L = 26;
  for (int n : GROESSEN)
    for (int bus : {1, 2, 3, 4}) {
      Aufbau ref(0.0, false, bus), bau(0.5, false, bus);
      PRUEF(bau.l.m->kanal_latenz() == L);
      Aufnahme ar, ab;
      // noise plus a sine, deterministic; below the master limiter's ceiling so the master chain is time invariant for it
      uint32_t z = 12345u;
      auto src = [&z](long t) {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        return static_cast<float>(0.2 * std::sin(2.0 * PI * 330.0 * static_cast<double>(t) / 48000.0) + 0.1 * (static_cast<double>(z) / 2147483648.0 - 1.0));
      };
      // the same sequence for both
      std::vector<float> folge(8192);
      for (long t = 0; t < 8192; ++t) folge[static_cast<size_t>(t)] = src(t);
      auto aus = [&folge](long t) { return folge[static_cast<size_t>(t)]; };
      for (int b = 0; b < 8192 / n; ++b) {
        ref.block(n, aus, ar);
        bau.block(n, aus, ab);
      }
      bool tap_gleich = true, master_gleich = true, anfang_still = true;
      for (long i = 0; i + L < 8192; ++i) {
        tap_gleich = tap_gleich && ab.tap[static_cast<size_t>(i + L)] == ar.tap[static_cast<size_t>(i)];
        master_gleich = master_gleich && ab.ml[static_cast<size_t>(i + L)] == ar.ml[static_cast<size_t>(i)] &&
                        ab.mr[static_cast<size_t>(i + L)] == ar.mr[static_cast<size_t>(i)];
      }
      for (int i = 0; i < L; ++i) anfang_still = anfang_still && ab.tap[static_cast<size_t>(i)] == 0.0f;
      PRUEF(tap_gleich);
      PRUEF(master_gleich);
      PRUEF(anfang_still);
      PRUEF(spitze_von(ar.tap, 0, 8192) > 0.25);
      // positive control: lim/an 1 with a +6 dBFS sine is not that delayed signal
      Aufbau ref2(0.0, false, bus), an(0.5, false, bus);
      setze_bus(an.l, bus, "lim/an", 1.0f);
      setze_bus(an.l, bus, "lim/decke", -3.0f);
      Aufnahme a2, a3;
      auto laut = sinus_f(1000.0, 2.0);
      for (int b = 0; b < 8192 / n; ++b) {
        ref2.block(n, laut, a2);
        an.block(n, laut, a3);
      }
      double d = 0.0;
      for (long i = 4096; i + L < 8192; ++i) d = std::fmax(d, std::fabs(static_cast<double>(a3.tap[static_cast<size_t>(i + L)]) - a2.tap[static_cast<size_t>(i)]));
      PRUEF(d > 0.5);   // measured: about 1.3
    }
}

// ---- (L3) ----
double steady_peak_db(int n, int bus, double vorhalt, bool echt, double f, double decke, float fader_db, bool am_tap = false) {
  Aufbau a(vorhalt, echt, bus);
  setze_bus(a.l, bus, "lim/an", 1.0f);
  setze_bus(a.l, bus, "lim/decke", static_cast<float>(decke));
  setze_bus(a.l, bus, "fader", fader_db);
  Aufnahme rec;
  const long gesamt = 96000;
  for (int b = 0; b < gesamt / n; ++b) a.block(n, sinus_f(f, 2.0), rec);
  return db_von(spitze_von(am_tap ? rec.tap : rec.ml, gesamt - 24000, gesamt));   // the tap is the bus sum in front of the master FX and the master limiter (-1 dBTP)
}

void l3_spitze_an_der_decke() {
  // the bus fader at +6 dB sits in front of the limiter; with the limiter behind it the +6 dB cannot lift the peak above the ceiling
  for (int n : GROESSEN)
    for (int bus : BUSSE)
      for (double f : {100.0, 1000.0}) {
        const double p = steady_peak_db(n, bus, 0.5, false, f, -3.0, 6.0f);
        std::printf("L3: n=%d bus/%d %.0f Hz fader +6: master peak %.4f dBFS (ceiling -3, expected -3.001)\n", n, bus, f, p);
        PRUEF(p <= -3.001 + 0.001);
        PRUEF(p >= -3.001 - 0.02);
      }
  for (int n : GROESSEN)
    for (int bus : BUSSE) {   // true peak mode (+12 samples), other ceilings
      for (double decke : {-3.0, -9.0}) {
        const double p = steady_peak_db(n, bus, 0.5, true, 1000.0, decke, 0.0f);
        std::printf("L3: n=%d bus/%d true peak mode, 1 kHz, ceiling %.1f: master sample peak %.4f dBFS\n", n, bus, decke, p);
        PRUEF(p <= decke - 0.001 + 0.001);   // a sample peak never above the ceiling
        PRUEF(p >= decke - 0.001 - 0.15);    // and the true-peak reserve (0.01 dB) plus the grid phase cost less than 0.15 dB
      }
    }
  for (int n : GROESSEN)
    for (int bus : BUSSE)
      for (bool echt : {false, true}) {   // the default ceiling -0.3 is above the master limiter's -1 dBTP: read it at the bus sum
        const double p = steady_peak_db(n, bus, 0.5, echt, 1000.0, -0.3, 0.0f, true);
        PRUEF(p <= -0.3 - 0.001 + 0.001);
        PRUEF(p >= -0.3 - 0.001 - 0.15);
      }
  {   // 10 kHz sample peaks never exceed the ceiling (they may sit between samples and read lower)
    const double p = steady_peak_db(256, 1, 1.5, false, 10000.0, -3.0, 0.0f);
    std::printf("L3: 10 kHz sample peak %.4f dBFS\n", p);
    PRUEF(p <= -3.001 + 0.001);
  }
}

// ---- (L4) ----
long erster_einsatz(const std::vector<float>& x, long ab, float schwelle) {
  for (long i = ab; i < static_cast<long>(x.size()); ++i)
    if (std::fabs(x[static_cast<size_t>(i)]) > schwelle) return i;
  return -1;
}

void l4_latenz() {
  struct Fall { double v; bool e; int soll; } faelle[] = {{0.5, false, 26}, {0.5, true, 38}, {1.5, false, 74}};
  for (const Fall& f : faelle)
    for (int n : GROESSEN)
      for (int bus : {1, 2, 3, 4})
        for (int an : {0, 1}) {
          Aufbau ref(0.0, false, bus), bau(f.v, f.e, bus);
          if (an) {
            setze_bus(bau.l, bus, "lim/an", 1.0f);
            setze_bus(bau.l, bus, "lim/decke", -3.0f);
          }
          const long IMP = 4000;   // after the warm-up and the crossfade (L + 480 samples)
          auto imp = [IMP](long t) { return t == IMP ? 0.1f : 0.0f; };
          Aufnahme ar, ab;
          for (int b = 0; b < 8192 / n; ++b) {
            ref.block(n, imp, ar);
            bau.block(n, imp, ab);
          }
          const long p0 = erster_einsatz(ar.tap, 0, 0.05f), p1 = erster_einsatz(ab.tap, 0, 0.05f);
          const long m0 = erster_einsatz(ar.ml, 0, 0.02f), m1 = erster_einsatz(ab.ml, 0, 0.02f);
          if (n == 256 && bus == 1) std::printf("L4: vorhalt %.1f echt %d lim/an %d: impulse at %ld (unbuilt) and %ld (built): +%ld, plan %d\n", f.v, f.e ? 1 : 0, an, p0, p1, p1 - p0, f.soll);
          PRUEF(p0 == IMP + 0 || p0 > 0);
          PRUEF(p1 - p0 == f.soll);
          PRUEF(m1 - m0 == f.soll);
          PRUEF(p1 - p0 == bau.l.m->kanal_latenz());
        }
}

// ---- (L5) ----
// returns the largest step of the tap and its peak; the limiter is switched on at sample t_an and off again at t_aus (block boundaries)
struct Schalten {
  double schritt_max, spitze_trocken, spitze_an;
};
Schalten schalten_lauf(int n, int bus, long t_an, long t_aus, double vorhalt = 0.5) {
  Aufbau a(vorhalt, false, bus);
  setze_bus(a.l, bus, "lim/decke", -3.0f);
  Aufnahme rec;
  const long gesamt = 24000;
  for (long t = 0; t < gesamt; t += n) {
    if (t == t_an) setze_bus(a.l, bus, "lim/an", 1.0f);
    if (t == t_aus) setze_bus(a.l, bus, "lim/an", 0.0f);
    a.block(n, sinus_f(100.0, 2.0), rec);
  }
  Schalten s;
  s.schritt_max = max_schritt(rec.tap, 2000, gesamt);
  s.spitze_trocken = spitze_von(rec.tap, 2000, t_an);
  s.spitze_an = spitze_von(rec.tap, t_an + 3000, t_aus);
  return s;
}

void l5_blende() {
  for (int n : GROESSEN)
    for (int bus : BUSSE) {
      double schlimmster = 0.0, spitze = 0.0;
      for (int j = 0; j < 8; ++j) {
        const long t_an = ((4800 + j * 60 + n - 1) / n) * n, t_aus = ((14400 + j * 60 + n - 1) / n) * n;
        const Schalten s = schalten_lauf(n, bus, t_an, t_aus);
        schlimmster = std::fmax(schlimmster, s.schritt_max);
        spitze = std::fmax(spitze, s.spitze_trocken);
        PRUEF(s.spitze_trocken > 1.9);                  // dry: the 2.0 sine
        PRUEF(s.spitze_an > 0.6 && s.spitze_an < 0.72);  // on: about -3 dBFS = 0.708
      }
      std::printf("L5: n=%d bus/%d largest step %.4f of a peak %.3f (limit 0.1 of it = %.3f)\n", n, bus, schlimmster, spitze, 0.1 * spitze);
      PRUEF(schlimmster <= 0.1 * spitze);
    }
}

// The look-ahead is longer than the crossfade (20 ms = 962 samples against 480): the limiter must run unheard until its own delay is full, else the
// crossfade fades in silence. Every 500-sample window from the switch on keeps a peak of at least 0.6 (dry 2.0, limited 0.708).
void l5_warmlauf() {
  for (int n : {256, 32})
    for (int bus : BUSSE) {
      Aufbau a(20.0, false, bus);
      PRUEF(a.l.m->kanal_latenz() == 962);
      setze_bus(a.l, bus, "lim/decke", -3.0f);
      Aufnahme rec;
      const long t_an = (4800 / n) * n, gesamt = 16000;
      for (long t = 0; t < gesamt; t += n) {
        if (t == t_an) setze_bus(a.l, bus, "lim/an", 1.0f);
        a.block(n, sinus_f(100.0, 2.0), rec);
      }
      double tiefste = 1e9;
      for (long w = t_an; w + 500 <= gesamt; w += 100) tiefste = std::fmin(tiefste, spitze_von(rec.tap, w, w + 500));
      std::printf("L5: n=%d bus/%d L=962: lowest 500-sample peak from the switch on: %.3f (limit 0.6)\n", n, bus, tiefste);
      PRUEF(tiefste >= 0.6);
      PRUEF(spitze_von(rec.tap, gesamt - 3000, gesamt) < 0.72);   // and it ends up limited
    }
}

// fix round 1, pin 2: the warm-up length exactly. Mutant WARM_HALB (warm-up L/2) is red only at L = 962: a warm-up too short by L/2 starts the S-curve crossfade L/2 samples early, and the S-curve
// is flat at its start (weight 3 x^2 - 2 x^3 at x = (L/2)/480: 0.018 at L = 74, 0.0003 at L = 26), so the empty limiter delay is almost inaudible; at L = 962 the shortfall of 481 samples is the whole crossfade. A 300 Hz sine, windows of 100 samples (shorter than the crossfade) and the sample step, at L = 26, 74, 962.
void l5_warm_fein() {
  for (double v : {0.5, 1.5, 20.0})
    for (int n : {256, 32})
      for (int bus : BUSSE) {
        Aufbau a(v, false, bus);
        const int L = a.l.m->kanal_latenz();
        setze_bus(a.l, bus, "lim/decke", -3.0f);
        Aufnahme rec;
        const long t_an = (4800 / n) * n, gesamt = t_an + L + 480 + 3000;
        for (long t = 0; t < gesamt; t += n) {
          if (t == t_an) setze_bus(a.l, bus, "lim/an", 1.0f);
          a.block(n, sinus_f(300.0, 2.0), rec);
        }
        double tiefste = 1e9;
        for (long w = t_an; w + 100 <= t_an + L + 480 + 1000; w += 10) tiefste = std::fmin(tiefste, spitze_von(rec.tap, w, w + 100));
        const double schritt = max_schritt(rec.tap, t_an + 1, gesamt);
        if (n == 256 && bus == 1) std::printf("L5 fine: L=%d: lowest 100-sample peak %.3f (limit 0.6), largest step %.4f (limit 0.2)\n", L, tiefste, schritt);
        PRUEF(tiefste >= 0.6);
        PRUEF(schritt <= 0.1 * 2.0);
      }
}

// ---- (L6) ----
void l6_laufzeit_aenderung() {
  for (int n : GROESSEN)
    for (int bus : BUSSE) {
      {   // decke -3 -> -12 -> -3 while the limiter works
        Aufbau a(0.5, false, bus);
        setze_bus(a.l, bus, "lim/an", 1.0f);
        setze_bus(a.l, bus, "lim/decke", -3.0f);
        Aufnahme rec;
        const long T1 = ((9600) / n) * n, T2 = ((19200) / n) * n, END = 28800;
        for (long t = 0; t < END; t += n) {
          if (t == T1) setze_bus(a.l, bus, "lim/decke", -12.0f);
          if (t == T2) setze_bus(a.l, bus, "lim/decke", -3.0f);
          a.block(n, sinus_f(100.0, 2.0), rec);
        }
        const double p1 = db_von(spitze_von(rec.tap, T1 + 6000, T2)), p2 = db_von(spitze_von(rec.tap, T2 + 9000, END));
        const double schritt = max_schritt(rec.tap, 5000, END), spitze = spitze_von(rec.tap, 5000, T1);
        std::printf("L6: n=%d bus/%d decke -3 -> -12: peak %.3f dBFS, back: %.3f dBFS; largest step %.4f of peak %.3f\n", n, bus, p1, p2, schritt, spitze);
        PRUEF(p1 <= -12.001 + 0.001 && p1 >= -12.001 - 0.05);   // the change takes effect
        PRUEF(p2 <= -3.001 + 0.001 && p2 >= -3.001 - 0.05);
        PRUEF(schritt <= 0.1 * spitze);                          // and without a click
      }
      {   // abklingen: after a loud burst a quiet sine recovers fast with 5 ms and slowly with 2000 ms
        double rest[2] = {};
        const float zeiten[2] = {5.0f, 2000.0f};
        for (int v = 0; v < 2; ++v) {
          Aufbau a(0.5, false, bus);
          setze_bus(a.l, bus, "lim/an", 1.0f);
          setze_bus(a.l, bus, "lim/decke", -3.0f);
          setze_bus(a.l, bus, "lim/abklingen", 80.0f);
          Aufnahme rec;
          const long T1 = ((4800) / n) * n, T2 = ((14400) / n) * n;   // burst 4800 .. 14400 (loud), then quiet
          for (long t = 0; t < 24000; t += n) {
            if (t == T1) setze_bus(a.l, bus, "lim/abklingen", zeiten[v]);   // changed at run time, before the burst ends
            a.block(n, [T2](long s) { return static_cast<float>((s < T2 ? 2.0 : 0.1) * std::sin(2.0 * PI * 1000.0 * static_cast<double>(s) / 48000.0)); }, rec);
          }
          // level of the quiet part 20 ms after the burst, against its input level 0.1
          rest[v] = db_von(spitze_von(rec.tap, T2 + 960 + 200, T2 + 960 + 200 + 480) / 0.1);
          std::printf("L6: n=%d bus/%d abklingen %.0f ms: quiet sine 20 ms after the burst is %.2f dB against its input\n", n, bus, zeiten[v], rest[v]);
        }
        PRUEF(rest[0] > -1.0);   // fast: recovered
        PRUEF(rest[1] < -3.0);   // slow: still reduced
      }
    }
}

// ---- (L7) ----
void l7_send_vor_dem_limiter() {
  // the hall return of bus/b's own send 2, with and without the limiter working hard; the tap holds the delayed sum plus the delayed bus, linear
  for (int n : GROESSEN)
    for (int bus : BUSSE) {
      Aufnahme wet[2];
      for (int an = 0; an < 2; ++an) {
        Aufnahme mit, ohne;
        for (int send = 0; send < 2; ++send) {
          Aufbau a(0.5, false, bus);
          setze_bus(a.l, bus, "lim/an", static_cast<float>(an));
          setze_bus(a.l, bus, "lim/decke", -12.0f);
          setze_bus(a.l, bus, "send/2", send ? -6.0f : -200.0f);
          a.l.setze("fx/2/rueckweg", 0.0f);
          Aufnahme& r = send ? mit : ohne;
          for (int b = 0; b < 16000 / n; ++b) a.block(n, sinus_f(1000.0, 1.0), r);
        }
        wet[an].tap.resize(mit.tap.size());
        for (size_t i = 0; i < mit.tap.size(); ++i) wet[an].tap[i] = mit.tap[i] - ohne.tap[i];
      }
      const double e0 = spitze_von(wet[0].tap, 8000, 16000), e1 = spitze_von(wet[1].tap, 8000, 16000);
      double d = 0.0;
      for (size_t i = 0; i < wet[0].tap.size(); ++i) d = std::fmax(d, std::fabs(static_cast<double>(wet[0].tap[i]) - wet[1].tap[i]));
      std::printf("L7: n=%d bus/%d wet part (hall return of the bus's own send): peak %.5f without, %.5f with the limiter at -12 dB; largest difference %.2e\n", n, bus, e0, e1, d);
      PRUEF(e0 > 0.01);   // the send is really audible
      PRUEF(d < 1e-6);    // and the limiter did not touch it
    }
}

// ---- (L8) ----
void l8_alloc() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("L8 skipped (sanitizer build): allocation watcher not available\n");
    return;
  }
  {   // positive control: the watcher sees an allocation
    abfang_an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    const AbfangZahlen pk = abfang_zahlen();
    abfang_aus();
    PRUEF(pk.alloc >= 1);
  }
  Lauf l;
  l.m->setze_kanal_limiter(1.5, true);   // building allocates: outside the watched window
  for (int b = 1; b <= 4; ++b) {
    setze_bus(l, b, "lim/an", 1.0f);
    setze_bus(l, b, "lim/decke", -6.0f);
  }
  ziel_bus(l, ERZ1, 1);
  ziel_bus(l, ERZ2, 2);
  ziel_bus(l, PAD1, 3);
  ziel_bus(l, DECK1, 4);
  l.setze(ERZ1, "send/2", -6.0f);
  l.setze(BUS1, "send/2", -9.0f);
  const int groessen[] = {1, 256, 17, 1024, 64, 255, 512, 3, 128, 1000, 33, 32, 800, 2, 129};
  AbfangZahlen summe;
  long reduziert = 0, nicht_endlich = 0;
  for (long b = 0; b < 6000; ++b) {
    const int n = groessen[b % 15];
    for (int k : {DECK1, ERZ1, ERZ2, PAD1}) l.rausch(k, 1.5, n);
    if (b % 37 == 0) for (int bus = 1; bus <= 4; ++bus) setze_bus(l, bus, "lim/an", static_cast<float>((b / 37 + bus) % 2));
    if (b % 53 == 0) for (int bus = 1; bus <= 4; ++bus) setze_bus(l, bus, "lim/decke", static_cast<float>(-3 - (b % 7) * 6));
    if (b % 61 == 0) for (int bus = 1; bus <= 4; ++bus) setze_bus(l, bus, "lim/abklingen", static_cast<float>(1 + (b % 11) * 150));
    if (b % 1500 == 7) l.m->eingang_l(ERZ1)[0] = NAN;   // the F01 guard (resets the limiters) is in the window too
    abfang_an();
    l.m->verarbeite(n, l.ml, l.mr, l.cl, l.cr);
    abfang_aus();
    summe += abfang_zahlen();
    for (int bus = 0; bus < 4; ++bus) reduziert += l.m->kanal_limiter_reduktion_db(bus) > 1.0f;
    for (int i = 0; i < n; ++i) nicht_endlich += !(std::isfinite(l.ml[i]) && std::isfinite(l.cl[i]));
  }
  std::printf("L8: 6000 blocks, 4 limiters (1.5 ms, true peak): %ld allocations, %ld frees, %ld locks, %ld sleeps; blocks with a reduction > 1 dB: %ld; non-finite %ld\n",
              summe.alloc, summe.frei, summe.sperren, summe.schlafen, reduziert, nicht_endlich);
  PRUEF(summe.alloc == 0 && summe.frei == 0 && summe.sperren == 0 && summe.schlafen == 0);
  PRUEF(reduziert > 1000);   // the limiters really worked in the window
  PRUEF(nicht_endlich == 0);
  PRUEF(l.m->nan_treffer() >= 4);
}

// ---- (F) ----
// A loud burst leaves a deep reduction with a 2000 ms release; a NaN on a source routed to the bus fires the F01 guard; the quiet signal that follows
// must come out at its own level (the limiter was reset) and not still 9 dB down
void f01_setzt_limiter_zurueck() {
  // the NaN has to be injected after the source block is written, so the loop is spelled out
  for (int n : GROESSEN)
    for (int bus : BUSSE) {
      Aufbau a(0.5, false, bus);
      setze_bus(a.l, bus, "lim/an", 1.0f);
      setze_bus(a.l, bus, "lim/decke", -3.0f);
      setze_bus(a.l, bus, "lim/abklingen", 2000.0f);
      const long T_NAN = (14400 / n) * n, END = 24000;
      std::vector<float> tap;
      int treffer_vorher = 0;
      for (long t = 0; t < END; t += n) {
        for (int i = 0; i < n; ++i) {
          const float v = static_cast<float>((t + i < T_NAN ? 2.0 : 0.1) * std::sin(2.0 * PI * 1000.0 * static_cast<double>(t + i) / 48000.0));
          a.l.m->eingang_l(ERZ1)[i] = v;
          a.l.m->eingang_r(ERZ1)[i] = v;
        }
        if (t == T_NAN) {
          a.l.m->eingang_l(ERZ1)[0] = NAN;
          treffer_vorher = static_cast<int>(a.l.m->nan_treffer());
        }
        a.l.verarbeite(n);
        tap.insert(tap.end(), a.l.m->master_summe_l(), a.l.m->master_summe_l() + n);
      }
      PRUEF(a.l.m->nan_treffer() == treffer_vorher + 1);   // the guard fired once
      // the quiet sine 10 ms after the bad block (past the cleared lines): own level, not 9 dB down
      const double pegel = db_von(spitze_von(tap, T_NAN + 960 + 200, T_NAN + 960 + 200 + 480) / 0.1);
      std::printf("F: n=%d bus/%d: quiet sine after the F01 guard: %.2f dB against its input (reset limiter: about 0; a 9 dB reduction left over: about -9)\n", n, bus, pegel);
      PRUEF(pegel > -1.0);
    }
}

// ---- (E) the ear envelopes (core_signalbox.cpp reads kanalzug(c).abgriff for channels 0..13 and master_summe for the master) ----
// Decision (A5a note 2): they stay undelayed. The envelopes run at 1000 Hz (windows of 48 samples) and feed the leitstand / hand view, not audio; the master tap
// is later than a channel tap by exactly L samples, which is 0.54 window at 0.5 ms, 1.54 at 1.5 ms (0.54 + 0.25 with true peak), 20 at the 20 ms maximum.
// Pinned here: the offset is L and nothing else, for a direct source and for the same source routed to a bus.
void e_ohr_huellen() {
  for (int bus : {0, 1, 4})   // 0 = direct to the master
    for (double v : {0.5, 1.5}) {
      long versatz[2] = {};   // master tap minus channel tap, unbuilt and built
      int L = 0;
      for (int gebaut = 0; gebaut < 2; ++gebaut) {
        Aufbau a(gebaut ? v : 0.0, false, bus == 0 ? 1 : bus);
        if (bus == 0) ziel_bus(a.l, ERZ1, 0);
        L = a.l.m->kanal_latenz();
        long k_abgriff = -1, k_master = -1;
        for (long t = 0; t < 4096; t += 256) {
          for (int i = 0; i < 256; ++i) a.l.m->eingang_l(ERZ1)[i] = a.l.m->eingang_r(ERZ1)[i] = (t + i == 1000) ? 0.5f : 0.0f;
          a.l.verarbeite(256);
          for (int i = 0; i < 256; ++i) {
            if (k_abgriff < 0 && std::fabs(a.l.m->kanalzug(ERZ1).abgriff(0)[i]) > 0.1f) k_abgriff = t + i;
            if (k_master < 0 && std::fabs(a.l.m->master_summe_l()[i]) > 0.1f) k_master = t + i;
          }
        }
        PRUEF(k_abgriff >= 0 && k_master >= 0);
        versatz[gebaut] = k_master - k_abgriff;
      }
      std::printf("E: %s, %.1f ms: master tap minus channel tap %ld samples unbuilt, %ld built: L = %d, i.e. %.2f envelope windows of 48\n",
                  bus == 0 ? "direct" : (bus == 1 ? "bus/1" : "bus/4"), v, versatz[0], versatz[1], L, static_cast<double>(L) / 48.0);
      PRUEF(versatz[1] - versatz[0] == L);   // the strip's own one sample on a bus is not L; the built mixer adds exactly L
    }
}

// ---- (X) the crossfader residual of D8 at the real L ----
// route() applies the crossfader weight after the bus line and a direct source's weight before the sum delay, so a crossfader move is heard on a bus channel
// exactly L samples EARLIER than on a direct source (A5a measured it with an injected L; here with the real ones). The behaviour stays (controller decision).
long xfader_einsatz(bool bus, double v, int n, int* L_aus) {
  Lauf l;
  l.m->setze_kanal_limiter(v, false);
  *L_aus = l.m->kanal_latenz();
  if (bus) {
    l.setze(ERZ1, "ziel", 1.0f);
    l.setze(BUS1, "xseite", 0.0f);
  } else {
    l.setze(DECK1, "xseite", 0.0f);
  }
  const long T0 = (4200 / n) * n;
  std::vector<float> tap;
  for (long t = 0; t < 8192; t += n) {
    if (t == T0) l.setze("xfader", 1.0f);   // side A weight 1 -> 0
    for (int i = 0; i < n; ++i) l.m->eingang_l(bus ? ERZ1 : DECK1)[i] = l.m->eingang_r(bus ? ERZ1 : DECK1)[i] = 0.5f;
    l.verarbeite(n);
    tap.insert(tap.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
  }
  for (long i = T0; i < 8192; ++i)
    if (std::fabs(tap[static_cast<size_t>(i)]) < 0.25f) return i;   // the sum falls below half of its level
  return -1;
}

void x_crossfader() {
  for (int n : {256, 32})
    for (double v : {0.5, 1.5}) {
      int L = 0, L0 = 0;
      const long direkt = xfader_einsatz(false, v, n, &L), bus = xfader_einsatz(true, v, n, &L);
      const long direkt0 = xfader_einsatz(false, 0.0, n, &L0), bus0 = xfader_einsatz(true, 0.0, n, &L0);
      std::printf("X: n=%d, %.1f ms (L=%d): crossfader step heard on a direct source at %ld, on a bus channel at %ld (unbuilt: %ld and %ld): the bus is %ld samples earlier\n", n, v, L,
                  direkt, bus, direkt0, bus0, direkt - bus);
      PRUEF(direkt > 0 && bus > 0 && direkt0 > 0 && bus0 > 0);
      PRUEF(direkt - bus == L + (direkt0 - bus0));   // the residual is L, on top of what the unbuilt mixer has
    }
}

// ---- (R) fix round 1, pin 1: switching on again after a run is the same as switching on for the first time (D6) ----
// A loud burst under a 2000 ms release, lim/an 0 (fade-out and reset), a quiet signal for 0.5 s, lim/an 1 again. The twin never switched the limiter on; both get
// the same input throughout, so from the second switch-on the outputs must agree. A limiter that keeps its gain reduction through the switch-off answers 9.6 dB low.
void r_wiedereinschalten() {
  for (int n : GROESSEN)
    for (int bus : BUSSE) {
      Aufnahme a_rec, b_rec;
      const long T_AUS = (12000 / n) * n, T_AN = T_AUS + (24000 / n) * n, END = T_AN + 8000;
      for (int zwilling = 0; zwilling < 2; ++zwilling) {
        Aufbau a(0.5, false, bus);
        setze_bus(a.l, bus, "lim/decke", -3.0f);
        setze_bus(a.l, bus, "lim/abklingen", 2000.0f);
        if (!zwilling) setze_bus(a.l, bus, "lim/an", 1.0f);   // the twin never has the limiter on before T_AN
        for (long t = 0; t < END; t += n) {
          if (t == T_AUS) setze_bus(a.l, bus, "lim/an", 0.0f);
          if (t == T_AN) setze_bus(a.l, bus, "lim/an", 1.0f);
          a.block(n, [T_AUS](long x) { return static_cast<float>((x < T_AUS ? 2.0 : 0.1) * std::sin(2.0 * PI * 1000.0 * static_cast<double>(x) / 48000.0)); }, zwilling ? b_rec : a_rec);
        }
      }
      double d = 0.0;
      for (long i = T_AN; i < END; ++i) d = std::fmax(d, std::fabs(static_cast<double>(a_rec.tap[static_cast<size_t>(i)]) - b_rec.tap[static_cast<size_t>(i)]));
      const double pegel = db_von(spitze_von(a_rec.tap, T_AN + 1000, T_AN + 1480) / 0.1);
      std::printf("R: n=%d bus/%d: quiet sine after 'ran, off, on again' %+.2f dB against its input; largest difference to the never-ran twin %.2e\n", n, bus, pegel, d);
      PRUEF(d < 1e-6);
      PRUEF(pegel > -0.1);
    }
}

// ---- (I) fix round 1, pin 3: the buses do not share a limiter ----
void i_busse_unabhaengig() {
  for (int n : GROESSEN) {
    Lauf l;
    l.m->setze_kanal_limiter(0.5, false);
    const int quellen[4] = {ERZ1, ERZ2, PAD1, DECK1};
    const float decken[4] = {-3.0f, -6.0f, -9.0f, -12.0f};
    const double freq[4] = {440.0, 700.0, 1100.0, 1700.0};
    for (int b = 1; b <= 4; ++b) {
      ziel_bus(l, quellen[b - 1], b);
      setze_bus(l, b, "lim/decke", decken[b - 1]);
      setze_bus(l, b, "lim/an", b == 3 ? 0.0f : 1.0f);   // bus/3 stays off
    }
    for (long t = 0; t < 24000; t += n) {
      for (int b = 0; b < 4; ++b)
        for (int i = 0; i < n; ++i) {
          const float v = static_cast<float>(2.0 * std::sin(2.0 * PI * freq[b] * static_cast<double>(t + i) / 48000.0));
          l.m->eingang_l(quellen[b])[i] = l.m->eingang_r(quellen[b])[i] = v;
        }
      l.verarbeite(n);
    }
    for (int b = 0; b < 4; ++b) {
      const float r = l.m->kanal_limiter_reduktion_db(b);
      const double soll = b == 2 ? 0.0 : 6.02 - decken[b];
      std::printf("I: n=%d bus/%d ceiling %.0f dB: reduction %.3f dB (expected %.2f)\n", n, b + 1, decken[b], r, soll);
      PRUEF(std::fabs(r - soll) < 0.3);
    }
  }
}

// ---- (U) fix round 1, pin 4: the overshoot after a switch-on, bounded ----
// The crossfade starts from the UNlimited dry signal, so after lim/an 0 -> 1 (and after the F01 reset) the bus sits above the ceiling for a while: measured up to
// +9 dB for 7 to 12 ms. That is the price of the click-free switch (the master limiter is behind it). Pinned: from L + 480 + one block after the (last) switch-on or
// the guard the peak is within ceiling + 0.01 dB again.
void u_ueberschwingen() {
  const double GRENZE = std::pow(10.0, (-3.0 + 0.01) / 20.0);
  for (int n : GROESSEN)
    for (int bus : BUSSE)
      for (int fall = 0; fall < 3; ++fall)
        for (double v : {0.5, 1.5}) {
         double davor_max = 0.0;   // the highest peak inside the window over the four signal phases
         for (double PHASE : {0.0, 0.5 * PI, PI, 1.5 * PI}) {   // the overshoot depends on where in the 100 Hz period the switch falls; the bound must hold at all four
          Aufbau a(v, false, bus);
          const int L = a.l.m->kanal_latenz();
          setze_bus(a.l, bus, "lim/decke", -3.0f);
          const long T0 = 7680, END = T0 + 6000;   // 7680 = a multiple of every block size and of the 480-sample period: the same signal phase at the switch for every n
          long t_ref = T0;
          if (fall == 1) setze_bus(a.l, bus, "lim/an", 1.0f);   // C: steady on, then the guard
          std::vector<float> tap;
          for (long t = 0; t < END; t += n) {
            for (int i = 0; i < n; ++i) {
              const float x = static_cast<float>(2.0 * std::sin(2.0 * PI * 100.0 * static_cast<double>(t + i) / 48000.0 + PHASE));
              a.l.m->eingang_l(ERZ1)[i] = a.l.m->eingang_r(ERZ1)[i] = x;
            }
            if (fall == 0 && t == T0) setze_bus(a.l, bus, "lim/an", 1.0f);                       // A: 0 -> 1
            if (fall == 2) {                                                                     // B: on, then 1 -> 0 -> 1 within 64 samples
              if (t == T0 - 4096 / n * n) setze_bus(a.l, bus, "lim/an", 1.0f);
              if (t == T0) setze_bus(a.l, bus, "lim/an", 0.0f);
              if (t == T0 + (n >= 64 ? n : 64)) { setze_bus(a.l, bus, "lim/an", 1.0f); t_ref = t; }
            }
            if (fall == 1 && t == T0) a.l.m->eingang_l(ERZ1)[0] = NAN;                           // C: the F01 guard
            a.l.verarbeite(n);
            tap.insert(tap.end(), a.l.m->master_summe_l(), a.l.m->master_summe_l() + n);
          }
          const long ab = t_ref + L + 480 + n;
          const double p = spitze_von(tap, ab, END);
          long zuletzt = -1;
          for (long i = t_ref; i < END; ++i)
            if (std::fabs(tap[static_cast<size_t>(i)]) > GRENZE) zuletzt = i;
          if ((n == 32 || n == 256) && PHASE == 0.0)
            std::printf("U: %s n=%d bus/%d L=%d: last sample above ceiling + 0.01 dB at +%ld samples after the %s (bound L + 480 + n = %ld); peak from the bound on %.4f dBFS\n",
                        fall == 0 ? "A 0->1" : (fall == 1 ? "C F01" : "B 1->0->1"), n, bus, L, zuletzt - t_ref, fall == 1 ? "guard block" : "switch-on", L + 480 + n, db_von(p));
          PRUEF(p <= GRENZE);
          davor_max = std::fmax(davor_max, spitze_von(tap, t_ref, ab));
         }
          if (fall != 2) {   // the pin is not empty: an overshoot really happened inside the window at some phase (the unlimited dry signal is audible there)
            if (v == 0.5 && bus == 1) std::printf("U: %s n=%d: highest peak inside the window over 4 phases %.3f dBFS (ceiling -3)\n", fall == 0 ? "A" : "C", n, db_von(davor_max));
            PRUEF(davor_max > std::pow(10.0, (-3.0 + 0.05) / 20.0));   // more than 0.05 dB over the ceiling (F01 at n = 64 reaches only +0.10 dB)
          }
        }
}

// ---- (W) fix round 1, pin 5: no reduction is reported while the limiter is still in its unheard warm-up ----
void w_red_im_warmlauf() {
  for (int bus : BUSSE) {
    Aufbau a(20.0, false, bus);   // L = 962: fifteen blocks of 64 of warm-up
    setze_bus(a.l, bus, "lim/decke", -3.0f);
    Aufnahme rec;
    const int n = 64;
    for (int b = 0; b < 100; ++b) a.block(n, sinus_f(300.0, 2.0), rec);
    setze_bus(a.l, bus, "lim/an", 1.0f);
    int im_warm_gemeldet = 0, spaeter_max = 0;
    for (int b = 0; b < 40; ++b) {
      a.block(n, sinus_f(300.0, 2.0), rec);
      const float r = a.l.m->kanal_limiter_reduktion_db(bus - 1);
      if ((b + 1) * n < 962) im_warm_gemeldet += r != 0.0f;   // the whole block inside the warm-up
      else if (b * n > 962) spaeter_max = std::max(spaeter_max, static_cast<int>(r));
    }
    std::printf("W: bus/%d L=962: blocks inside the warm-up that reported a reduction: %d; largest reduction reported afterwards: %d dB\n", bus, im_warm_gemeldet, spaeter_max);
    PRUEF(im_warm_gemeldet == 0);
    PRUEF(spaeter_max >= 8);
  }
}

// ---- (T) fix round 1 and 2, pin 6: true peak mode holds the dBTP ceiling for sines, not for broadband noise ----
// This test records TODAY's deviation of the library (noise reads up to +1.4 dB over the dBTP ceiling, cause open, follow-up package). It is a bound on the present
// behaviour, not a specification. The reference is a 16x Hann-windowed sinc with +-256 taps; it is checked first against a 12 kHz sine at 45 degrees (analytic 0 dB,
// the sample peak is 3 dB lower).
double wahre_spitze_db(const std::vector<float>& x, long von, long bis) {
  constexpr int H = 256, F = 16;
  static std::vector<double> kern[F];
  if (kern[1].empty())
    for (int f = 1; f < F; ++f) {
      kern[f].assign(2 * H, 0.0);
      for (int j = -H + 1; j <= H; ++j) {
        const double d = j - static_cast<double>(f) / F;   // distance of tap j from the new position between sample 0 and 1
        const double sinc = std::sin(PI * d) / (PI * d);
        kern[f][static_cast<size_t>(j + H - 1)] = sinc * (0.5 + 0.5 * std::cos(PI * d / H));
      }
    }
  double p = 0.0;
  for (long i = von; i < bis; ++i) {
    p = std::fmax(p, std::fabs(static_cast<double>(x[static_cast<size_t>(i)])));
    if (i + H >= static_cast<long>(x.size()) || i - H < 0) continue;
    for (int f = 1; f < F; ++f) {
      double a = 0.0;
      for (int j = -H + 1; j <= H; ++j) a += kern[f][static_cast<size_t>(j + H - 1)] * x[static_cast<size_t>(i + j)];
      p = std::fmax(p, std::fabs(a));
    }
  }
  return db_von(p);
}

void t_breitband_tp() {
  {   // the reference itself: a 12 kHz sine at 45 degrees has a sample peak of -3.01 dB and a true peak of exactly 0 dB
    std::vector<float> x(3000);
    for (size_t i = 0; i < x.size(); ++i) x[i] = static_cast<float>(std::sin(2.0 * PI * 12000.0 * static_cast<double>(i) / 48000.0 + PI / 4.0));
    const double tp = wahre_spitze_db(x, 600, 1200), sp = db_von(spitze_von(x, 600, 1200));
    std::printf("T: reference check, 12 kHz at 45 degrees: sample peak %.3f dB, reference %.4f dB (analytic 0)\n", sp, tp);
    PRUEF(sp < -2.9 && sp > -3.1);
    PRUEF(std::fabs(tp) < 0.05);
  }
  double schlimmster = -1e9, kontroll_min = 1e9;
  for (int art = 0; art < 2; ++art)
    for (uint32_t seed : {987654321u, 123456789u, 362436069u, 521288629u}) {
      double tp[2] = {};
      std::vector<double> fenster;
      for (int echt = 0; echt < 2; ++echt) {
        Aufbau a(0.5, echt == 1, 1);
        setze_bus(a.l, 1, "lim/an", 1.0f);
        setze_bus(a.l, 1, "lim/decke", -3.0f);
        uint32_t z = seed;
        auto rnd = [&z]() { z ^= z << 13; z ^= z >> 17; z ^= z << 5; return static_cast<double>(z) / 2147483648.0 - 1.0; };
        Aufnahme rec;
        for (int b = 0; b < 40000 / 256; ++b)
          a.block(256, [&](long) { return static_cast<float>(art == 0 ? 1.7 * rnd() : 0.7 * (rnd() + rnd() + rnd()) / 1.5); }, rec);
        PRUEF(db_von(spitze_von(rec.tap, 10000, 40000)) <= -3.0);   // the sample peak ceiling is held in both modes
        if (echt == 1)
          for (long von : {8000L, 18000L, 28000L}) fenster.push_back(wahre_spitze_db(rec.tap, von, von + 10000));
        else
          tp[0] = wahre_spitze_db(rec.tap, 8000, 18000);
      }
      for (double w : fenster) schlimmster = std::fmax(schlimmster, w);
      kontroll_min = std::fmin(kontroll_min, tp[0]);
    }
  std::printf("T: noise (uniform and triangular, 4 seeds, 3 windows of 10000, 256-tap 16x reference), ceiling -3 dB: worst true peak with echtspitze 1: %+.3f dB over the ceiling (limit +1.6); echtspitze 0: lowest %+.3f dB over\n",
              schlimmster + 3.0, kontroll_min + 3.0);
  PRUEF(schlimmster <= -3.0 + 1.6);   // today's worst +1.44 dB plus margin; the review measured +0.35 to +1.37 dB with other windows
  PRUEF(kontroll_min > -3.0 + 1.0);   // positive control: in sample peak mode the same reference reads over +1 dB, so the measure sees inter-sample peaks
}

}  // namespace

int main() {
  b_setter();
  g_getter();
  l1_nicht_gebaut();
  l2_aus_ist_verzoegerung();
  l3_spitze_an_der_decke();
  l4_latenz();
  l5_blende();
  l5_warmlauf();
  l5_warm_fein();
  l6_laufzeit_aenderung();
  l7_send_vor_dem_limiter();
  l8_alloc();
  f01_setzt_limiter_zurueck();
  e_ohr_huellen();
  x_crossfader();
  r_wiedereinschalten();
  i_busse_unabhaengig();
  u_ueberschwingen();
  w_red_im_warmlauf();
  t_breitband_tp();
  PRUEF_ENDE();
}
