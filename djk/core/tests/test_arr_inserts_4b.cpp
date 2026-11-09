// 1.10 slice 4b T12: the EQ and saturator inserts of the arrangement mixer (spec D2, 2.2; AK-S4-6, 11, 12 for the new kinds).
// A 1 kHz or 100 Hz sine of 0.5 on track 1 in the centre, the stage is slot 0 of its kind, start at bar 90000 (quant 2 from beat 0), blocks of 256.
// Cases: 1 eq_wirkt (a +12 dB band at 1 kHz raises a 1 kHz sine by 12 dB and leaves a 100 Hz sine alone; out gain and the proportional-Q switch reach the module),
// 2 eq_baender (every one of the 8 bands is addressable through its rows), 3 eq_bypass (row an = 0 is bit-equal to no insert; the stage with the bands off is transparent in level),
// 4 saett_wirkt (drive 18 dB makes harmonics, the output stays below full scale; out gain; mix 0 is clean), 5 pool_pin (the pool constants equal the table rows),
// 6 keine_allokation (EQ and saturator in the chains, 2000 blocks, two swaps; positive control), 7 komp_unveraendert (a komp-only chain is bit-equal to the run without the 4b code path: the pooled
// komp rows still reach the stage after the global slot numbering changed), 8 nan (a NaN burst on a track with an EQ is silenced and counted).
// Mutations (CMakeLists.txt): INS_EQ_BAND_VERTAUSCHT (2), INS_SAETT_AUS_NACH_DRIVE (4), INS_POOL_PLUS_EINS (5), INS_NAN_DURCHLASS (8).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double db(double x) { return 20.0 * std::log10(x); }
static double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis; ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
static double spitze(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
static bool gleich_bits(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  return std::memcmp(a.data() + von, b.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}
// a[i + v] == b[i] bit for bit over [von, bis): a stage that is switched off still carries its latency (slice 4b T13, spec D10), so the run with the stage
// is the run without it, delayed by the latency of the stage
static bool gleich_bits_versetzt(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis, int64_t v) {
  return std::memcmp(a.data() + von + v, b.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}
// amplitude of the harmonic h of f0 (Hz) in v[von, bis), a whole number of periods (Goertzel-free direct sum)
static double harmonische(const std::vector<float>& v, int64_t von, int64_t bis, double f0, int h) {
  const double w = 2.0 * 3.14159265358979323846 * f0 * h / 48000.0;
  double c = 0.0, s = 0.0;
  for (int64_t i = von; i < bis; ++i) {
    c += v[i] * std::cos(w * static_cast<double>(i));
    s += v[i] * std::sin(w * static_cast<double>(i));
  }
  return 2.0 * std::sqrt(c * c + s * s) / static_cast<double>(bis - von);
}

enum Art { EQ, SAETT };
static const int L_EQ = cdj::ins_latenz(cdj::ArrInsArt::eq);   // 69 samples at 48 kHz, from the module
// one track with the audio `a` and one stage of the kind on it (slot 0), or without
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, int art, bool mit_kette, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (mit_kette) b.kette(1, {ArrStufe{art == EQ ? ArrInsArt::eq : ArrInsArt::saett, 0, true}});
  return b.fertig();
}
static std::string eqp(int n, const std::string& rest) { return "ins/eq/" + std::to_string(n) + "/" + rest; }
// band b (1..8): on, bell/typ, freq, gain, q
static void band(Treiber& t, int b, double freq, double gain, double q, int typ = 0, int an = 1) {
  const std::string p = "b" + std::to_string(b) + "/";
  setze(t, eqp(1, p + "typ"), static_cast<float>(typ));
  setze(t, eqp(1, p + "freq"), static_cast<float>(freq));
  setze(t, eqp(1, p + "gain"), static_cast<float>(gain));
  setze(t, eqp(1, p + "q"), static_cast<float>(q));
  setze(t, eqp(1, p + "an"), static_cast<float>(an));
}
static constexpr int64_t VON = 93000, BIS = 117000;   // 24000 samples: 500 periods of 1 kHz, 100 of ... (100 Hz: 50 periods)

int main() {
  auto s1k = Audio::sinus(400000, 1000.0, 0.5f);
  auto s100 = Audio::sinus(400000, 100.0, 0.5f);

  {  // 1 eq_wirkt: a +12 dB band at 1 kHz (Q 4) raises a 1 kHz sine by 12 dB +- 0.1 at the PM tap and leaves a 100 Hz sine within +- 0.1 dB
    TR(ref1) TR(eq1) TR(ref100) TR(eq100)
    spiele(ref1, spur1(&s1k->a, EQ, false), 120000);
    setze(eq1, eqp(1, "an"), 1.0f);
    band(eq1, 1, 1000.0, 12.0, 4.0);
    spiele(eq1, spur1(&s1k->a, EQ, true), 120000);
    spiele(ref100, spur1(&s100->a, EQ, false), 120000);
    setze(eq100, eqp(1, "an"), 1.0f);
    band(eq100, 1, 1000.0, 12.0, 4.0);
    spiele(eq100, spur1(&s100->a, EQ, true), 120000);
    const double g1k = db(rms(eq1.pml, VON, BIS) / rms(ref1.pml, VON, BIS));
    const double g100 = db(rms(eq100.pml, VON, BIS) / rms(ref100.pml, VON, BIS));
    std::printf("1: 1 kHz +12 dB band: %.3f dB; 100 Hz: %.3f dB\n", g1k, g100);
    PRUEF(rms(ref1.pml, VON, BIS) > 0.1);                  // the signal is there (positive control)
    PRUEF_NAH(g1k, 12.0, 0.1);
    PRUEF_NAH(g100, 0.0, 0.1);
    // out gain (row ins/eq/1/out) and the proportional-Q switch reach the module: bands off, out -6 dB lowers the level by 6 dB
    TR(o)
    setze(o, eqp(1, "an"), 1.0f);
    setze(o, eqp(1, "out"), -6.0f);
    setze(o, eqp(1, "propq"), 1.0f);
    spiele(o, spur1(&s1k->a, EQ, true), 120000);
    const double go = db(rms(o.pml, VON, BIS) / rms(ref1.pml, VON, BIS));
    std::printf("1: out -6 dB, bands off: %.3f dB\n", go);
    PRUEF_NAH(go, -6.0, 0.1);
    // negative control: a band at 100 Hz does not touch the 1 kHz sine by more than 0.1 dB
    TR(fern)
    setze(fern, eqp(1, "an"), 1.0f);
    band(fern, 1, 100.0, 12.0, 4.0);
    spiele(fern, spur1(&s1k->a, EQ, true), 120000);
    PRUEF_NAH(db(rms(fern.pml, VON, BIS) / rms(ref1.pml, VON, BIS)), 0.0, 0.1);
  }

  {  // 2 eq_baender: each of the 8 bands alone, +12 dB at 1 kHz, reaches the module through its own rows (the binding of b<m>/... is right for every m)
    TR(ref)
    spiele(ref, spur1(&s1k->a, EQ, false), 120000);
    for (int b = 1; b <= 8; ++b) {
      TR(t)
      setze(t, eqp(1, "an"), 1.0f);
      band(t, b, 1000.0, 12.0, 4.0);
      spiele(t, spur1(&s1k->a, EQ, true), 120000);
      const double g = db(rms(t.pml, VON, BIS) / rms(ref.pml, VON, BIS));
      std::printf("2: band %d alone: %.3f dB\n", b, g);
      PRUEF_NAH(g, 12.0, 0.1);
    }
    // two bands together add (series): +12 dB at 1 kHz in band 3 and -12 dB in band 6 cancel
    TR(zwei)
    setze(zwei, eqp(1, "an"), 1.0f);
    band(zwei, 3, 1000.0, 12.0, 4.0);
    band(zwei, 6, 1000.0, -12.0, 4.0);
    spiele(zwei, spur1(&s1k->a, EQ, true), 120000);
    PRUEF_NAH(db(rms(zwei.pml, VON, BIS) / rms(ref.pml, VON, BIS)), 0.0, 0.1);
  }

  {  // 3 eq_bypass (AK-S4-2 for the new kind): the row an = 0 is bit-equal to the project without the insert; the same stage switched on with a band is not (positive control)
    TR(x) TR(aus) TR(ein) TR(offen)
    spiele(x, spur1(&s1k->a, EQ, false), 140000);
    band(aus, 1, 1000.0, 12.0, 4.0);   // bands set, but the stage row an stays 0
    spiele(aus, spur1(&s1k->a, EQ, true), 140000);
    PRUEF(gleich_bits_versetzt(aus.pml, x.pml, VON, 139000 - L_EQ, L_EQ));
    PRUEF(!gleich_bits(aus.pml, x.pml, VON, 139000));   // negative control: unshifted they differ (the latency is really there)
    setze(ein, eqp(1, "an"), 1.0f);
    band(ein, 1, 1000.0, 12.0, 4.0);
    spiele(ein, spur1(&s1k->a, EQ, true), 140000);
    PRUEF(!gleich_bits(ein.pml, x.pml, VON, 139000));
    PRUEF(db(rms(ein.pml, VON, BIS) / rms(x.pml, VON, BIS)) > 11.0);
    // switching the row off after it ran: after the blend the tap equals the no-insert tap bit for bit
    setze(ein, eqp(1, "an"), 0.0f);
    ein.lauf(180000);
    TR(ref2)
    spiele(ref2, spur1(&s1k->a, EQ, false), 180000);
    PRUEF(gleich_bits_versetzt(ein.pml, ref2.pml, 150000, 179000 - L_EQ, L_EQ));
    // the stage with all bands off is transparent in level (the oversampler delays and does not colour the level)
    TR(flach)
    setze(flach, eqp(1, "an"), 1.0f);
    spiele(flach, spur1(&s1k->a, EQ, true), 140000);
    PRUEF_NAH(db(rms(flach.pml, VON, BIS) / rms(x.pml, VON, BIS)), 0.0, 0.05);
  }

  {  // 4 saett_wirkt: drive 18 dB on a -6 dBFS sine makes harmonics (THD above 1%), the output stays below full scale; out gain reaches the module; mix 0 is clean
    TR(ref) TR(hart) TR(sanft) TR(trocken) TR(leiser) TR(laut)
    auto saett = [&](Treiber& t, double drive, double out, double mix) {
      setze(t, "ins/saett/1/an", 1.0f);
      setze(t, "ins/saett/1/drive", static_cast<float>(drive));
      setze(t, "ins/saett/1/out", static_cast<float>(out));
      setze(t, "ins/saett/1/mix", static_cast<float>(mix));
    };
    auto thd = [&](const std::vector<float>& v) {
      const double f1 = harmonische(v, VON, BIS, 1000.0, 1);
      double q = 0.0;
      for (int h = 2; h <= 10; ++h) q += std::pow(harmonische(v, VON, BIS, 1000.0, h), 2);
      return std::sqrt(q) / f1;
    };
    spiele(ref, spur1(&s1k->a, SAETT, false), 120000);
    saett(hart, 18.0, 0.0, 1.0);
    spiele(hart, spur1(&s1k->a, SAETT, true), 120000);
    saett(sanft, 0.0, 0.0, 1.0);
    spiele(sanft, spur1(&s1k->a, SAETT, true), 120000);
    saett(trocken, 18.0, 0.0, 0.0);
    spiele(trocken, spur1(&s1k->a, SAETT, true), 120000);
    saett(leiser, 6.0, -6.0, 1.0);
    spiele(leiser, spur1(&s1k->a, SAETT, true), 120000);
    saett(laut, 6.0, 0.0, 1.0);
    spiele(laut, spur1(&s1k->a, SAETT, true), 120000);
    const double thd_hart = thd(hart.pml), thd_sanft = thd(sanft.pml), thd_trocken = thd(trocken.pml), thd_ref = thd(ref.pml);
    std::printf("4: THD drive 18 dB %.3f %%, drive 0 dB %.3f %%, mix 0 %.4f %%, no insert %.4f %%; peak at drive 18 %.3f\n", 100 * thd_hart, 100 * thd_sanft, 100 * thd_trocken,
                100 * thd_ref, spitze(hart.pml, VON, BIS));
    PRUEF(harmonische(hart.pml, VON, BIS, 1000.0, 1) > 0.1);   // the fundamental is there (positive control)
    PRUEF(thd_hart > 0.01);                                    // harmonics
    PRUEF(thd_hart > thd_sanft);                               // more drive, more harmonics
    PRUEF(spitze(hart.pml, VON, BIS) < 1.0);                   // below full scale: the limiter after the PM never has to work
    PRUEF(thd_trocken < 0.001);                                // mix 0: the dry line, clean (harmless input, behaviour unchanged)
    PRUEF(thd_ref < 0.001);
    const double dg = db(rms(laut.pml, VON, BIS) / rms(leiser.pml, VON, BIS));
    std::printf("4: out 0 dB against out -6 dB: %.3f dB\n", dg);
    PRUEF_NAH(dg, 6.0, 0.1);
  }

  {  // 5 pool_pin: the pool constants equal the rows of the table, which come from the contract (the sizes were decided by the cost measurement, T11)
    cypherdj::stellwerk::ReglerTabelle tab;
    PRUEF(tab.suche(("ins/eq/" + std::to_string(cdj::ARR_INS_EQ) + "/an").c_str()) >= 0);
    PRUEF(tab.suche(("ins/eq/" + std::to_string(cdj::ARR_INS_EQ + 1) + "/an").c_str()) < 0);
    PRUEF(tab.suche(("ins/saett/" + std::to_string(cdj::ARR_INS_SAETT) + "/an").c_str()) >= 0);
    PRUEF(tab.suche(("ins/saett/" + std::to_string(cdj::ARR_INS_SAETT + 1) + "/an").c_str()) < 0);
    PRUEF(tab.suche(("ins/komp/" + std::to_string(cdj::ARR_INS_KOMP) + "/an").c_str()) >= 0);
    PRUEF(tab.suche(("ins/komp/" + std::to_string(cdj::ARR_INS_KOMP + 1) + "/an").c_str()) < 0);
    // the eq rows: 3 + 8 x 7 = 59 per instance, the saturator 4
    int eq = 0, sa = 0;
    for (int r = 0; r < tab.anzahl(); ++r) {
      if (std::strncmp(tab.def(r).pfad, "ins/eq/", 7) == 0) ++eq;
      if (std::strncmp(tab.def(r).pfad, "ins/saett/", 10) == 0) ++sa;
    }
    PRUEF((eq) == (59 * cdj::ARR_INS_EQ));
    PRUEF((sa) == (4 * cdj::ARR_INS_SAETT));
    std::printf("5: pools komp %d, eq %d, saett %d; rows eq %d, saett %d\n", cdj::ARR_INS_KOMP, cdj::ARR_INS_EQ, cdj::ARR_INS_SAETT, eq, sa);
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("6 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 6 keine_allokation (AK-S4-6 for the new kinds): 2000 blocks with eq, saett and komp stages in the chains, two swaps, a moving EQ band; positive control: construction counts
    TR(t)
    setze(t, eqp(1, "an"), 1.0f);
    band(t, 1, 1000.0, 6.0, 1.0);
    band(t, 2, 200.0, -3.0, 1.0, 1);
    setze(t, "ins/saett/1/an", 1.0f);
    setze(t, "ins/komp/1/an", 1.0f);
    auto bau = [&](int64_t nr, bool getauscht) {
      Bau b(nr);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &s1k->a);
      if (!getauscht) b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}, ArrStufe{ArrInsArt::saett, 0, true}, ArrStufe{ArrInsArt::komp, 0, true}});
      else b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}, ArrStufe{ArrInsArt::saett, 0, true}});   // the eq leaves, the others stay: a tail and a reorder
      return b.fertig();
    };
    cdj::ArrSnapshot* s0 = bau(1, false);
    cdj::ArrSnapshot* s1 = bau(2, true);
    cdj::ArrSnapshot* s2 = bau(3, false);
    t.laden(s0);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(100000);
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(8);
    float b[6][cdj::ARR_BLOCK];
    long im_fenster = 0;
    int64_t s = t.s;
    const int r_gain = reg(t, eqp(1, "b1/gain"));
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 600) { alt.push_back(t.arr.tausche(s1, s, t.k)); }
      if (blk == 1200) { alt.push_back(t.arr.tausche(s2, s, t.k)); }
      t.arr.setze_sofort(r_gain, 3.0f + 0.1f * static_cast<float>(blk % 40));   // a moving knob: setze_band in the callback
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      s += 256;
    }
    im_fenster = abfang_aus();
    std::printf("6: allocations in 2000 blocks = %ld\n", im_fenster);
    PRUEF((im_fenster) == (0L));
    abfang_an();
    { auto zweite = std::make_unique<cdj::ArrInserts>(); }
    const long bau_zaehlt = abfang_aus();
    std::printf("6: allocations while constructing a second pool = %ld\n", bau_zaehlt);
    PRUEF(bau_zaehlt > 0);   // positive control: the counter sees allocations
    for (const cdj::ArrSnapshot* a : alt) delete a;
  }

  {  // 7 komp_unveraendert: a komp-only chain behaves as in 4a with the eq and saett pools present (the global slot numbering is invisible): 6 dB or more of reduction at -30 dB, bit-equal bypass
    TR(a0) TR(b0) TR(aus)
    auto komp_ein = [&](Treiber& t) {
      setze(t, "ins/komp/1/an", 1.0f);
      setze(t, "ins/komp/1/schwelle", -30.0f);
      setze(t, "ins/komp/1/ratio", 8.0f);
    };
    auto kspur = [&](bool mit) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &s1k->a);
      if (mit) b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
      return b.fertig();
    };
    spiele(a0, kspur(false), 120000);
    komp_ein(b0);
    spiele(b0, kspur(true), 120000);
    setze(aus, "ins/komp/1/schwelle", -30.0f);
    spiele(aus, kspur(true), 120000);
    const double gr = db(rms(a0.pml, VON, BIS) / rms(b0.pml, VON, BIS));
    std::printf("7: komp reduction %.3f dB\n", gr);
    PRUEF(gr >= 6.0);
    PRUEF(gleich_bits(aus.pml, a0.pml, VON, BIS));
    PRUEF(b0.arr.inserts().gr_db(0) >= 6.0f);
    PRUEF((b0.arr.inserts().gr_db(cdj::ARR_INS_KOMP)) == (0.0f));   // the eq slot reports no reduction
  }

  {  // 8 nan: a NaN burst on a track with an EQ stage: that block of the strip is silent, the stage is cleared, the counter rises, the run before the burst is bit-equal to the run without it and the level recovers
    auto nan_audio = Audio::sinus(400000, 1000.0, 0.5f);
    for (int64_t f = 40000; f < 40004; ++f) nan_audio->d[2 * f] = nan_audio->d[2 * f + 1] = std::numeric_limits<float>::quiet_NaN();
    TR(sauber) TR(boese)
    setze(sauber, eqp(1, "an"), 1.0f);
    band(sauber, 1, 1000.0, 6.0, 1.0);
    spiele(sauber, spur1(&s1k->a, EQ, true), 150000);
    setze(boese, eqp(1, "an"), 1.0f);
    band(boese, 1, 1000.0, 6.0, 1.0);
    spiele(boese, spur1(&nan_audio->a, EQ, true), 150000);
    std::printf("8: nan counter %llu\n", static_cast<unsigned long long>(boese.arr.inserts().nan_zaehler()));
    PRUEF(boese.arr.inserts().nan_zaehler() >= 1);
    PRUEF((sauber.arr.inserts().nan_zaehler()) == (0ull));
    // the burst sits at source frame 40000, which plays at about output frame 129800 (the start is quantised to the next bar): before it the two runs are bit-equal,
    // the block of the burst is silent, and the stage plays on afterwards at the same level (the cleared stage has settled again)
    PRUEF(gleich_bits(boese.pml, sauber.pml, 0, 129500));
    PRUEF(spitze(boese.pml, 129792, 129792 + 256) == 0.0);                       // the burst block is silent
    PRUEF_NAH(db(rms(boese.pml, 140000, 149000) / rms(sauber.pml, 140000, 149000)), 0.0, 0.05);
    bool alle_endlich = true;
    for (int64_t i = 0; i < 150000; ++i) alle_endlich = alle_endlich && std::isfinite(boese.pml[i]);
    PRUEF(alle_endlich);
  }

  PRUEF_ENDE();
}
