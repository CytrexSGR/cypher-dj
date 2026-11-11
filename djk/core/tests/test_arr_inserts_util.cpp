// arr-fx slice 1: the insert kind `utility` of the arrangement mixer (pool 8, the 1.15 Utility module: width in M/S, bass mono, gain, balance; 0 samples of latency).
// Source: a mono-near stereo signal, L = M + S and R = M - S with M = 0.2 (sin 60 Hz + sin 1 kHz) and S = 0.02 (sin 60 Hz + sin 1 kHz), so Side/Mid is -20 dB at both frequencies.
// Side and Mid are read from the production master (PM tap) by a correlation at the frequency over 24000 samples (an integer number of periods of both), blocks of 256.
// Cases: 1 util_breite_track (width 2: Side/Mid +6.02 dB, the mono sum and the Mid level unchanged; width 0: Side gone; the reference without a stage is -20 dB), 2 util_mono_unter (width 2 with mono below 120 Hz:
//   the 60 Hz side stays gone while the 1 kHz side still doubles, the 60 Hz mid keeps its level), 3 util_neutral_und_bypass (default rows: the input bit-equal; row an 0: bit-equal),
// 4 util_gain_balance (+6 dB and balance +0.5 against the reference), 5 util_gruppe_pm_return (the same width on a group, on the master and on a return gives the same Side/Mid gain),
// 6 util_pdc_pool (latency 0 pinned, a chain with an eq and a utility compensates the eq only, pool constant, global order, table rows), 7 util_lader (slot 8 loads, slot 9 and a latency field are refused),
// 8 util_zeilen_pin (rows and roles of the table), 9 util_hohe_slots (utility 7 and 8 are the global slots 32 and 33: they run audibly, alone and in series, and are freed; the 64-bit slot masks). The offline export is test_render_utility.cpp.
// Mutation (CMakeLists.txt): INS_UTIL_BREITE_FEST (the stage ignores the breite row and keeps 1.0: the width assertions of case 1 go red).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr int64_t VON = 93000, BIS = 117000;    // 24000 samples = 1.0 s of 48 kHz: whole periods of 60 Hz and 1 kHz, well after the 480 sample blend

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
// the mono-near source (see the header): length frames
static std::unique_ptr<Audio> quelle(int64_t frames) {
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  const double w = 2.0 * 3.14159265358979323846 / 48000.0;
  for (int64_t f = 0; f < frames; ++f) {
    const double m = 0.2 * (std::sin(w * 60.0 * static_cast<double>(f)) + std::sin(w * 1000.0 * static_cast<double>(f)));
    const double s = 0.02 * (std::sin(w * 60.0 * static_cast<double>(f)) + std::sin(w * 1000.0 * static_cast<double>(f)));
    x->d[2 * f] = static_cast<float>(m + s);
    x->d[2 * f + 1] = static_cast<float>(m - s);
  }
  x->fuellen(frames);
  return x;
}
// amplitude of the component at hz in x over [VON, BIS): |2/N * sum x e^{-jwt}|
static double komponente(const std::vector<float>& x, double hz) {
  const double w = 2.0 * 3.14159265358979323846 * hz / 48000.0;
  double re = 0.0, im = 0.0;
  for (int64_t i = VON; i < BIS; ++i) {
    re += static_cast<double>(x[i]) * std::cos(w * static_cast<double>(i));
    im -= static_cast<double>(x[i]) * std::sin(w * static_cast<double>(i));
  }
  return 2.0 * std::sqrt(re * re + im * im) / static_cast<double>(BIS - VON);
}
static std::vector<float> mitte(const std::vector<float>& l, const std::vector<float>& r) {
  std::vector<float> m(l.size());
  for (size_t i = 0; i < l.size(); ++i) m[i] = 0.5f * (l[i] + r[i]);
  return m;
}
static std::vector<float> seite(const std::vector<float>& l, const std::vector<float>& r) {
  std::vector<float> s(l.size());
  for (size_t i = 0; i < l.size(); ++i) s[i] = 0.5f * (l[i] - r[i]);
  return s;
}
static double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }
// Side/Mid in dB at hz
static double sm_db(const Treiber& t, double hz) { return db(komponente(seite(t.pml, t.pmr), hz)) - db(komponente(mitte(t.pml, t.pmr), hz)); }
static double mitte_db(const Treiber& t, double hz) { return db(komponente(mitte(t.pml, t.pmr), hz)); }
static double seite_db(const Treiber& t, double hz) { return db(komponente(seite(t.pml, t.pmr), hz)); }
// largest |a - b| over [von, bis)
static double abstand(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(a[i] - b[i])));
  return m;
}
// one track with the source, a utility stage on it, or without
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, bool mit_kette) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (mit_kette) b.kette(1, {ArrStufe{ArrInsArt::utility, 0, true}});
  return b.fertig();
}

int main() {
  auto q = quelle(400000);
  const int slot = cdj::ins_global(ArrInsArt::utility, 0);

  {  // 1 util_breite_track
    TR(ref) TR(w2) TR(w0) TR(w1) TR(w4)
    spiele(ref, spur1(&q->a, false), 120000);
    const double sm0 = sm_db(ref, 1000.0);
    std::printf("1: reference Side/Mid at 1 kHz %.3f dB, 60 Hz %.3f dB; mid %.3f dBFS\n", sm0, sm_db(ref, 60.0), mitte_db(ref, 1000.0));
    PRUEF(std::fabs(sm0 + 20.0) < 0.05);                 // the source is -20 dB Side/Mid (a centred track: both channels at the same gain)
    PRUEF(mitte_db(ref, 1000.0) > -20.0);                // the signal is there
    setze(w2, "ins/utility/1/an", 1.0f);
    setze(w2, "ins/utility/1/breite", 2.0f);
    spiele(w2, spur1(&q->a, true), 120000);
    const double sm2 = sm_db(w2, 1000.0);
    std::printf("1: width 2: Side/Mid %.3f dB (%+.3f dB), mid %.4f dB against %.4f dB, latency %d\n", sm2, sm2 - sm0, mitte_db(w2, 1000.0), mitte_db(ref, 1000.0), w2.arr.inserts().latenz(slot));
    PRUEF(std::fabs((sm2 - sm0) - 6.0206) < 0.05);       // side doubled: +6.02 dB
    PRUEF(std::fabs(mitte_db(w2, 1000.0) - mitte_db(ref, 1000.0)) < 0.01);   // the mono sum keeps its level
    PRUEF(std::fabs(mitte_db(w2, 60.0) - mitte_db(ref, 60.0)) < 0.01);
    // the mono sum is the same signal, sample for sample (L + R of the matrix = 2 M)
    {
      std::vector<float> a(w2.pml.size()), b(ref.pml.size());
      for (size_t i = 0; i < a.size(); ++i) { a[i] = w2.pml[i] + w2.pmr[i]; b[i] = ref.pml[i] + ref.pmr[i]; }
      const double d = abstand(a, b, VON, BIS);
      std::printf("1: mono sum, largest difference to the reference %.3g\n", d);
      PRUEF(d < 2e-6);
    }
    {  // width 4 (the contract limit since the order of 2026-11-11): the side x4, +12.04 dB, which takes the Side/Mid of the mono-near source from -20 to -8 dB; the mono sum keeps its level
      setze(w4, "ins/utility/1/an", 1.0f);
      setze(w4, "ins/utility/1/breite", 4.0f);
      spiele(w4, spur1(&q->a, true), 120000);
      const double sm4 = sm_db(w4, 1000.0);
      double spitze_ref = 0.0, spitze_w4 = 0.0;
      for (int i = VON; i < BIS; ++i) {
        spitze_ref = std::max(spitze_ref, static_cast<double>(std::max(std::fabs(ref.pml[i]), std::fabs(ref.pmr[i]))));
        spitze_w4 = std::max(spitze_w4, static_cast<double>(std::max(std::fabs(w4.pml[i]), std::fabs(w4.pmr[i]))));
      }
      std::vector<float> a(w4.pml.size()), b(ref.pml.size());
      for (size_t i = 0; i < a.size(); ++i) { a[i] = w4.pml[i] + w4.pmr[i]; b[i] = ref.pml[i] + ref.pmr[i]; }
      const double d4 = abstand(a, b, VON, BIS);
      std::printf("1: width 4: Side/Mid %.3f dB (%+.3f dB), mid %.4f dB against %.4f dB, mono sum difference %.3g, peak %.4f against %.4f (%+.2f dB)\n", sm4, sm4 - sm0, mitte_db(w4, 1000.0), mitte_db(ref, 1000.0), d4, spitze_w4, spitze_ref, 20.0 * std::log10(spitze_w4 / spitze_ref));
      PRUEF(std::fabs((sm4 - sm0) - 12.0412) < 0.05);
      PRUEF(std::fabs(mitte_db(w4, 1000.0) - mitte_db(ref, 1000.0)) < 0.01);
      PRUEF(d4 < 2e-6);
      PRUEF(spitze_w4 > spitze_ref);   // the peak rises (the Hand text says so); no clipping guard in the stage
    }
    setze(w0, "ins/utility/1/an", 1.0f);
    setze(w0, "ins/utility/1/breite", 0.0f);
    spiele(w0, spur1(&q->a, true), 120000);
    std::printf("1: width 0: side %.1f dBFS (reference %.1f), mid %.4f dB\n", seite_db(w0, 1000.0), seite_db(ref, 1000.0), mitte_db(w0, 1000.0));
    PRUEF(seite_db(w0, 1000.0) < seite_db(ref, 1000.0) - 80.0);   // mono: the side is gone
    PRUEF(std::fabs(mitte_db(w0, 1000.0) - mitte_db(ref, 1000.0)) < 0.01);
    // negative control: width 1 (the default) leaves Side/Mid at the reference
    setze(w1, "ins/utility/1/an", 1.0f);
    spiele(w1, spur1(&q->a, true), 120000);
    PRUEF(std::fabs(sm_db(w1, 1000.0) - sm0) < 0.01);
  }

  {  // 2 util_mono_unter: the low end stays mono while the width opens the highs
    TR(ref) TR(a) TR(b)
    spiele(ref, spur1(&q->a, false), 120000);
    setze(a, "ins/utility/1/an", 1.0f);
    setze(a, "ins/utility/1/breite", 2.0f);
    spiele(a, spur1(&q->a, true), 120000);              // width only: the 60 Hz side doubles too
    setze(b, "ins/utility/1/an", 1.0f);
    setze(b, "ins/utility/1/breite", 2.0f);
    setze(b, "ins/utility/1/mono_unter", 120.0f);
    spiele(b, spur1(&q->a, true), 120000);
    const double s60_ref = seite_db(ref, 60.0), s60_w = seite_db(a, 60.0), s60_m = seite_db(b, 60.0);
    std::printf("2: side at 60 Hz: reference %.1f dBFS, width 2 %.1f, width 2 + mono below 120 Hz %.1f; at 1 kHz %.3f dB Side/Mid\n", s60_ref, s60_w, s60_m, sm_db(b, 1000.0));
    PRUEF(std::fabs((s60_w - s60_ref) - 6.0206) < 0.05);   // without the setting the bass side doubles (the negative control of the claim)
    PRUEF(s60_m < s60_ref - 40.0);                          // with it the bass side is at least 40 dB below the reference (the LR8 high-pass: -48 dB at half the corner, 6 dB of width on top)
    PRUEF(std::fabs((sm_db(b, 1000.0) - sm_db(ref, 1000.0)) - 6.0206) < 0.05);   // the highs still widen
    PRUEF(std::fabs(mitte_db(b, 60.0) - mitte_db(ref, 60.0)) < 0.05);   // the mono part of the bass keeps its level (the split sums to an all-pass)
    PRUEF(std::fabs(mitte_db(b, 1000.0) - mitte_db(ref, 1000.0)) < 0.05);
  }

  {  // 3 util_neutral_und_bypass
    TR(ref) TR(n) TR(aus)
    spiele(ref, spur1(&q->a, false), 120000);
    setze(n, "ins/utility/1/an", 1.0f);                 // every other row at its default: width 1, no mono, 0 dB, balance 0
    spiele(n, spur1(&q->a, true), 120000);
    spiele(aus, spur1(&q->a, true), 120000);            // an stays 0
    PRUEF(std::memcmp(n.pml.data() + VON, ref.pml.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON)) == 0);
    PRUEF(std::memcmp(n.pmr.data() + VON, ref.pmr.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON)) == 0);
    PRUEF(std::memcmp(aus.pml.data() + VON, ref.pml.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON)) == 0);
    PRUEF(n.arr.inserts().lief(slot));                   // the stage really ran (a stage that did not run proves nothing)
    TR(w)
    setze(w, "ins/utility/1/an", 1.0f);
    setze(w, "ins/utility/1/breite", 2.0f);
    spiele(w, spur1(&q->a, true), 120000);
    PRUEF(std::memcmp(w.pml.data() + VON, ref.pml.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON)) != 0);   // negative control: a width of 2 is not bit-equal
  }

  {  // 4 util_gain_balance
    TR(ref) TR(g) TR(b)
    spiele(ref, spur1(&q->a, false), 120000);
    setze(g, "ins/utility/1/an", 1.0f);
    setze(g, "ins/utility/1/gain", 6.0f);
    spiele(g, spur1(&q->a, true), 120000);
    const double dg = mitte_db(g, 1000.0) - mitte_db(ref, 1000.0);
    std::printf("4: gain +6 dB: mid %+.4f dB\n", dg);
    PRUEF(std::fabs(dg - 6.0) < 0.01);                    // the module's gain row is in dB: +6.000
    setze(b, "ins/utility/1/an", 1.0f);
    setze(b, "ins/utility/1/balance", 0.5f);
    spiele(b, spur1(&q->a, true), 120000);
    const double dl = db(komponente(b.pml, 1000.0)) - db(komponente(ref.pml, 1000.0));
    const double dr = db(komponente(b.pmr, 1000.0)) - db(komponente(ref.pmr, 1000.0));
    std::printf("4: balance +0.5: left %+.4f dB, right %+.4f dB\n", dl, dr);
    PRUEF(std::fabs(dl + 6.0206) < 0.01);                // linear balance law: left at 0.5
    PRUEF(std::fabs(dr) < 0.01);
  }

  {  // 5 util_gruppe_pm_return: width acts on a group, on the master and on a return
    TR(ref) TR(g) TR(p) TR(r0) TR(r1)
    spiele(ref, spur1(&q->a, false), 120000);
    const double sm0 = sm_db(ref, 1000.0);
    {  // group 1 carries the track
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a).ausgang(1, 1);
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::utility, 0, true}});
      setze(g, "ins/utility/1/an", 1.0f);
      setze(g, "ins/utility/1/breite", 2.0f);
      spiele(g, b.fertig(), 120000);
    }
    {  // the production master
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
      b.pm_kette({ArrStufe{ArrInsArt::utility, 0, true}});
      setze(p, "ins/utility/1/an", 1.0f);
      setze(p, "ins/utility/1/breite", 2.0f);
      spiele(p, b.fertig(), 120000);
    }
    // return 1 (Hall off: the dry send is processed): the return share is the run with the send minus the run without it
    auto ret_lauf = [&](Treiber& t, bool mit_util, bool mit_send) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
      if (mit_util) b.ret_kette(1, {ArrStufe{ArrInsArt::utility, 0, true}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      setze(t, "ret/1/hall/an", 0.0f);
      setze(t, "spur/1/send/1", mit_send ? 0.0f : -200.0f);
      if (mit_util) {
        setze(t, "ins/utility/1/an", 1.0f);
        setze(t, "ins/utility/1/breite", 2.0f);
      }
      spiele(t, s, 120000);
    };
    TR(a0) TR(a1) TR(b0) TR(b1)
    ret_lauf(a0, false, true);
    ret_lauf(a1, false, false);
    ret_lauf(b0, true, true);
    ret_lauf(b1, true, false);
    auto anteil = [&](const Treiber& m, const Treiber& o) {
      Treiber d;
      d.pml.resize(m.pml.size());
      d.pmr.resize(m.pmr.size());
      for (size_t i = 0; i < d.pml.size(); ++i) { d.pml[i] = m.pml[i] - o.pml[i]; d.pmr[i] = m.pmr[i] - o.pmr[i]; }
      return sm_db(d, 1000.0);
    };
    const double r_ohne = anteil(a0, a1), r_mit = anteil(b0, b1);
    std::printf("5: Side/Mid at 1 kHz: reference %.3f dB, group %.3f, master %.3f, return share without %.3f, with %.3f\n", sm0, sm_db(g, 1000.0), sm_db(p, 1000.0), r_ohne, r_mit);
    PRUEF(std::fabs(sm_db(g, 1000.0) - sm0 - 6.0206) < 0.05);
    PRUEF(std::fabs(sm_db(p, 1000.0) - sm0 - 6.0206) < 0.05);
    PRUEF(std::fabs(r_ohne - sm0) < 0.05);               // negative control: the return share without the stage has the source's Side/Mid
    PRUEF(std::fabs(r_mit - r_ohne - 6.0206) < 0.05);
    (void)r0; (void)r1;
  }

  {  // 6 util_pdc_pool
    PRUEF((cdj::ins_latenz(ArrInsArt::utility)) == (0));
    PRUEF((cdj::INS_UTIL_PARAM) == (5));
    PRUEF((cdj::ARR_INS_UTIL) == (8));                   // "instanzen" of the contract kind utility
    PRUEF((cdj::INS_G_BK0) == (cdj::INS_G_UTIL0 + cdj::ARR_INS_UTIL));   // arr-bk: the bk range follows the utilities, host stays last
    PRUEF((cdj::INS_G_UTIL0) == (cdj::INS_G_LIM0 + cdj::ARR_INS_LIM));
    PRUEF((slot) == (cdj::INS_G_UTIL0));
    PRUEF((cdj::ins_global(ArrInsArt::utility, cdj::ARR_INS_UTIL)) == (-1));
    PRUEF((cdj::ins_global(ArrInsArt::utility, cdj::ARR_INS_UTIL - 1)) == (cdj::INS_G_BK0 - 1));
    PRUEF((cdj::ins_art(cdj::INS_G_UTIL0)) == (ArrInsArt::utility));
    PRUEF((cdj::ins_art(cdj::INS_G_BK0 - 1)) == (ArrInsArt::utility));
    PRUEF((cdj::ins_art(cdj::INS_G_UTIL0 - 1)) == (ArrInsArt::lim));      // negative controls: the neighbours are other kinds
    PRUEF((cdj::ins_art(cdj::INS_G_HOST0)) == (ArrInsArt::host));
    // a chain with an eq and a utility: the delay compensation counts the eq only
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
    b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}, ArrStufe{ArrInsArt::utility, 0, true}});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    const int eq = cdj::ins_latenz(ArrInsArt::eq);
    std::printf("6: eq %d samples, chain eq + utility: pdc %d\n", eq, static_cast<int>(s->pdc.gesamt));
    PRUEF(eq > 0);                                       // negative control: the eq has a latency
    PRUEF((s->pdc.gesamt) == (eq));
    delete s;
    TR(t)
    spiele(t, spur1(&q->a, true), 100000);
    PRUEF((t.arr.inserts().latenz(slot)) == (0));
    // the table has the rows of all 8 slots and none of a ninth
    PRUEF(t.tab.suche("ins/utility/8/balance") >= 0);
    PRUEF(t.tab.suche("ins/utility/9/an") < 0);
    PRUEF(t.tab.suche("ins/utility/1/breite") == t.tab.suche("ins/utility/1/an") + 1);
  }

  {  // 7 util_lader: a playback chain entry {art: utility, slot: 1..8} loads, slot 9, slot 0, a doubled slot and a latenz field are refused
    arrdatei::Ordner o("test_arr_inserts_util");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto grund = [&](int64_t nr, const std::string& chain) {
      o.wiedergabe2_ret(nr, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"master\"}" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}", "", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      if (x.snap && nr == 81) {
        const cdj::ArrKette& k = x.snap->kette[0];
        PRUEF(k.n == 1 && k.st[0].art == ArrInsArt::utility && k.st[0].slot == 0 && k.st[0].an);
        PRUEF((x.snap->pdc.gesamt) == (0));
      }
      if (x.snap && nr == 82) {
        const cdj::ArrKette& k = x.snap->kette[0];
        PRUEF(k.n == 1 && k.st[0].art == ArrInsArt::utility && k.st[0].slot == cdj::ARR_INS_UTIL - 1);
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(grund(81, ",\"chain\":[{\"art\":\"utility\",\"slot\":1,\"an\":true}]") == "+snap");
    PRUEF(grund(82, ",\"chain\":[{\"art\":\"utility\",\"slot\":" + std::to_string(cdj::ARR_INS_UTIL) + "}]") == "+snap");   // the last slot of the pool
    PRUEF(grund(83, ",\"chain\":[{\"art\":\"utility\",\"slot\":" + std::to_string(cdj::ARR_INS_UTIL + 1) + "}]") == "format");   // one beyond the pool
    PRUEF(grund(84, ",\"chain\":[{\"art\":\"utility\",\"slot\":1},{\"art\":\"utility\",\"slot\":1}]") == "format");          // the same slot twice
    PRUEF(grund(85, ",\"chain\":[{\"art\":\"utility\",\"slot\":0}]") == "format");                                                  // slot numbers start at 1
    PRUEF(grund(86, ",\"chain\":[{\"art\":\"utility\",\"slot\":1,\"latenz\":10}]") == "format");                                   // a latency field belongs to a host stage
    PRUEF(grund(87, ",\"chain\":[{\"art\":\"utility\",\"slot\":1},{\"art\":\"utility\",\"slot\":2},{\"art\":\"utility\",\"slot\":3},{\"art\":\"utility\",\"slot\":4}]") == "+snap");   // four stages fill a chain
  }

  {  // 9 util_hohe_slots: utility 7 and 8 are the global slots 32 and 33, beyond a 32-bit mask. They run audibly, alone and together, and are freed again.
    const int g7 = cdj::ins_global(ArrInsArt::utility, 6), g8 = cdj::ins_global(ArrInsArt::utility, 7);
    PRUEF(g7 == 32 && g8 == 33);                         // the pin of why this case exists: a 32-bit mask would lose both
    PRUEF(cdj::ARR_INS_ALLE > 32 && cdj::ARR_INS_ALLE <= 64);
    TR(ref)
    spiele(ref, spur1(&q->a, false), 120000);
    const double sm0 = sm_db(ref, 1000.0);
    auto lauf = [&](Treiber& t, const std::vector<int>& slots, const std::vector<int>& breiten_n) {   // chain of utility slots (1-based), width 2 on the listed ones
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
      if (slots.size() == 1) b.kette(1, {ArrStufe{ArrInsArt::utility, static_cast<uint8_t>(slots[0] - 1), true}});
      else b.kette(1, {ArrStufe{ArrInsArt::utility, static_cast<uint8_t>(slots[0] - 1), true}, ArrStufe{ArrInsArt::utility, static_cast<uint8_t>(slots[1] - 1), true}});
      for (int n : slots) {
        setze(t, "ins/utility/" + std::to_string(n) + "/an", 1.0f);
        if (std::find(breiten_n.begin(), breiten_n.end(), n) != breiten_n.end()) setze(t, "ins/utility/" + std::to_string(n) + "/breite", 2.0f);
      }
      spiele(t, b.fertig(), 120000);
    };
    TR(t7) TR(t8) TR(t78) TR(t_fremd)
    lauf(t7, {7}, {7});
    lauf(t8, {8}, {8});
    lauf(t78, {7, 8}, {7, 8});
    lauf(t_fremd, {7}, {8});                             // negative control: the rows of utility 8 do nothing to a chain that names utility 7
    std::printf("9: Side/Mid at 1 kHz: reference %.3f dB, utility 7 %.3f, utility 8 %.3f, both %.3f, rows of 8 on a chain of 7 %.3f\n", sm0, sm_db(t7, 1000.0), sm_db(t8, 1000.0), sm_db(t78, 1000.0), sm_db(t_fremd, 1000.0));
    PRUEF(std::fabs(sm_db(t7, 1000.0) - sm0 - 6.0206) < 0.05);
    PRUEF(std::fabs(sm_db(t8, 1000.0) - sm0 - 6.0206) < 0.05);
    PRUEF(std::fabs(sm_db(t78, 1000.0) - sm0 - 12.0412) < 0.05);   // both in series: side x2 x2
    PRUEF(std::fabs(sm_db(t_fremd, 1000.0) - sm0) < 0.05);
    PRUEF(t7.arr.inserts().slot_eigen(0) == (uint64_t{1} << g7));
    PRUEF(t8.arr.inserts().slot_eigen(0) == (uint64_t{1} << g8));
    PRUEF(t78.arr.inserts().slot_eigen(0) == ((uint64_t{1} << g7) | (uint64_t{1} << g8)));
    // freed again: the same strip without a chain, run past the tail; then slot 8 on another strip
    Bau b2(2);
    b2.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
    t78.laden(b2.fertig());
    t78.lauf(120000 + 8192);
    PRUEF(t78.arr.inserts().slot_eigen(0) == 0);
    PRUEF(t78.arr.inserts().maske() == 0);
    Bau b3(3);
    b3.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a).spur(2, ArrArt::audio).kette(2, {ArrStufe{ArrInsArt::utility, static_cast<uint8_t>(cdj::ARR_INS_UTIL - 1), true}});
    t78.laden(b3.fertig());
    t78.lauf(120000 + 8192 + 4096);
    PRUEF(t78.arr.inserts().slot_eigen(1) == (uint64_t{1} << g8) && t78.arr.inserts().slot_eigen(0) == 0);   // the freed slot is usable on the other strip
  }

  {  // 8 util_zeilen_pin: the rows of the table equal the contract (5 per slot), the order of the parameters is the order of the roles
    cypherdj::stellwerk::ReglerTabelle tab;
    int n = 0;
    for (int r = 0; r < tab.anzahl(); ++r)
      if (std::strncmp(tab.def(r).pfad, "ins/utility/", 12) == 0) ++n;
    PRUEF((n) == (cdj::INS_UTIL_PARAM * cdj::ARR_INS_UTIL));
    const char* namen[] = {"an", "breite", "mono_unter", "gain", "balance"};
    for (int k = 0; k < cdj::INS_UTIL_PARAM; ++k) {
      const int r = tab.suche((std::string("ins/utility/3/") + namen[k]).c_str());
      PRUEF(r >= 0);
      PRUEF((static_cast<int>(tab.def(r).rolle)) == (static_cast<int>(cypherdj::stellwerk::Rolle::ins_util_an) + k));
    }
    const int rb = tab.suche("ins/utility/1/breite"), rm = tab.suche("ins/utility/1/mono_unter");
    PRUEF(tab.def(rb).vorgabe == 1.0f && tab.def(rb).min == 0.0f && tab.def(rb).max == 4.0f);   // width 1 = unchanged, the contract range 0..4 (0..2 before 2026-11-11)
    PRUEF(tab.def(rm).vorgabe == 0.0f && tab.def(rm).max == 500.0f);
    std::printf("8: utility rows %d, ARR_INS_ALLE %d\n", n, cdj::ARR_INS_ALLE);
  }
  PRUEF_ENDE();
}
