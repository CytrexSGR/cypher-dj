// Strand 5 slice 1 (task 1.2): the saturation stage `saett` with the clip curves and the ceiling (rows ins/saett/<n>/kurve 0 Tanh, 1 Soft, 2 Hard and
// ins/saett/<n>/decke dBFS -24..0, parameters 4 and 5) and its clip measurement (gr of a saett slot = how far the driven signal went over the ceiling, dB).
// Cases: 1 vorgabe_bitgleich (a stage with the defaults equals a SaettNativ driven directly, bit for bit; negative control: Hard clip differs),
// 2 hart_decke (rows through the arrangement: kurve 2, decke -6, drive 24 on a near full-scale sine; the stage peak stays within 1.25 * 0.501 * out of the
//   level the PM shows without the stage; 1.25, not 1.12: the 2x half-band overshoots after the curve, task 1.1 measured that bound for tanh too;
//   negative control: Tanh with decke 0 goes above it), 3 clip_gr (gr > 0 while clipping, exactly 0 at drive 0 on a -20 dBFS sine),
// 4 zeilen (the table has ins/saett/1/kurve and ins/saett/4/decke with the contract ranges, none for slot 5; the parameter count of a saett slot is 6).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/sat.h"
#include "check.h"

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
static double db(double x) { return 20.0 * std::log10(std::max(x, 1e-30)); }
static double spitze(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
static int64_t einsatz(const std::vector<float>& v) {
  for (size_t i = 0; i < v.size(); ++i)
    if (v[i] != 0.0f) return static_cast<int64_t>(i);
  return -1;
}
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, bool mit_stufe) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (mit_stufe) b.kette(1, {ArrStufe{ArrInsArt::saett, 0, true}});
  return b.fertig();
}

// One saett stage of the pool on its own (ArrInserts, strip 0, blocks of 256), rows bound and set by hand (the pattern of test_arr_inserts_dyn)
struct Modul {
  static constexpr int M = 256;
  std::unique_ptr<cdj::ArrInserts> ins = std::make_unique<cdj::ArrInserts>();
  std::unique_ptr<cdj::ArrKette[]> ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
  int g = cdj::ins_global(ArrInsArt::saett, 0);
  float l[M] = {}, r[M] = {};
  bool getauscht = false;
  Modul() {
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::saett, 0, true};
  }
  void setze(int p, float v) {
    ins->binde(g, p, v);
    ins->setze_sofort(g, p, v);
  }
  // an, drive, out, mix, kurve, decke
  void stelle(float drive, float out, float mix, float kurve, float decke) {
    const float w[6] = {1.0f, drive, out, mix, kurve, decke};
    for (int k = 0; k < 6; ++k) setze(k, w[k]);
  }
  void block() {
    if (!getauscht) ins->tausche(ketten.get());
    getauscht = true;
    ins->kette(0, &ketten[0], l, r, M);
    ins->nachfuehren(M);
  }
};

// white noise, fixed seed, peak 0.5, L and R different
static void rauschen(uint32_t& z, float* l, float* r, int m) {
  for (int t = 0; t < m; ++t) {
    z = z * 1664525u + 1013904223u;
    l[t] = 0.5f * (static_cast<float>(z >> 8) / static_cast<float>(1u << 24) * 2.0f - 1.0f);
    z = z * 1664525u + 1013904223u;
    r[t] = 0.5f * (static_cast<float>(z >> 8) / static_cast<float>(1u << 24) * 2.0f - 1.0f);
  }
}

// Case 1: true when every block from block `ab` on is bit-equal to a SaettNativ given setze(12, -6, 1) (and setze_form(kurve, decke) when `form`)
static bool gleich_nativ(float kurve, float decke, bool form, int ab, int bloecke) {
  Modul x;
  x.stelle(12.0f, -6.0f, 1.0f, kurve, decke);
  cdj::SaettNativ n;
  n.setze(12.0, -6.0, 1.0);
  if (form) n.setze_form(static_cast<int>(kurve), static_cast<double>(decke));
  uint32_t z = 777u;
  float el[Modul::M], er[Modul::M];
  bool gleich = true;
  for (int blk = 0; blk < bloecke; ++blk) {
    rauschen(z, x.l, x.r, Modul::M);
    std::memcpy(el, x.l, sizeof el);
    std::memcpy(er, x.r, sizeof er);
    x.block();
    n.block(el, er, Modul::M);
    if (blk >= ab && (std::memcmp(el, x.l, sizeof el) != 0 || std::memcmp(er, x.r, sizeof er) != 0)) gleich = false;
  }
  return gleich;
}

int main() {
  const int g = cdj::ins_global(ArrInsArt::saett, 0);
  PRUEF(g >= 0);

  {  // 1 vorgabe_bitgleich: from block 4 on (the 10 ms entry blend of the stage is over after 480 samples) the stage output is the module output
    const bool vorgabe = gleich_nativ(0.0f, 0.0f, false, 4, 200);
    const bool hart = gleich_nativ(2.0f, 0.0f, false, 4, 200);   // negative control: Hard clip at the stage, the native one stays Tanh
    const bool hart_beide = gleich_nativ(2.0f, -6.0f, true, 4, 200);   // the stage hands kurve and decke to the module
    std::printf("1: defaults bit-equal %d, hard vs tanh bit-equal %d (expected 0), hard -6 dB on both bit-equal %d\n", vorgabe, hart, hart_beide);
    PRUEF(vorgabe);
    PRUEF(!hart);
    PRUEF(hart_beide);
  }

  {  // 2 hart_decke: through the rows ins/saett/1/* of the arrangement (regler_binden maps kurve and decke to parameters 4 and 5)
    auto q = Audio::sinus(300000, 220.0, 0.9f);
    const float out_db = 0.0f;
    const double out = std::pow(10.0, out_db / 20.0), c = std::pow(10.0, -6.0 / 20.0);
    TR(ref) TR(hart) TR(tanh)
    spiele(ref, spur1(&q->a, false), 200000);
    const int64_t e0 = einsatz(ref.pml);
    PRUEF(e0 > 0 && e0 + 72000 < 200000);
    const int64_t a = e0 + 24000, b = e0 + 72000;   // 0.5 s after the onset: the drive, out and ceiling ramps and the entry blend are over
    const double g_pm = spitze(ref.pml, a, b) / 0.9;   // the gain from the clip to the PM tap
    for (Treiber* t : {&hart, &tanh}) {
      setze(*t, "ins/saett/1/an", 1.0f);
      setze(*t, "ins/saett/1/drive", 24.0f);
      setze(*t, "ins/saett/1/out", out_db);
      setze(*t, "ins/saett/1/mix", 1.0f);
    }
    setze(hart, "ins/saett/1/kurve", 2.0f);
    setze(hart, "ins/saett/1/decke", -6.0f);
    spiele(hart, spur1(&q->a, true), 200000);
    spiele(tanh, spur1(&q->a, true), 200000);
    const double grenze = 1.25 * c * out * g_pm;
    const double p_hart = spitze(hart.pml, a, b), p_tanh = spitze(tanh.pml, a, b);
    std::printf("2: PM gain %.4f; hard -6 dB peak %.4f (bound %.4f = 1.25 * %.4f * out); tanh 0 dB peak %.4f; clip %.2f dB\n", g_pm, p_hart, grenze, c, p_tanh,
                hart.arr.inserts().gr_db(g));
    PRUEF(g_pm > 0.1);
    PRUEF(p_hart <= grenze);
    PRUEF(p_hart > 0.8 * c * out * g_pm);   // the stage sounds (it is not silent or bypassed)
    PRUEF(p_tanh > grenze);                 // negative control: without the ceiling the same drive goes above the bound
    PRUEF(hart.arr.inserts().gr_db(g) > 20.0f);
  }

  {  // 3 clip_gr: the clip measurement of the slot
    double ph = 0.0;
    auto sinus = [&](Modul& x, float amp) {
      for (int t = 0; t < Modul::M; ++t) {
        x.l[t] = x.r[t] = amp * static_cast<float>(std::sin(ph));
        ph += 2.0 * 3.14159265358979323846 * 220.0 / 48000.0;
      }
    };
    Modul an, leise;
    an.stelle(24.0f, 0.0f, 1.0f, 2.0f, -6.0f);
    leise.stelle(0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
    float gr_an_min = 1e9f, gr_leise_max = 0.0f;
    for (int blk = 0; blk < 100; ++blk) {
      sinus(an, 0.9f);
      an.block();
      if (blk >= 20) gr_an_min = std::min(gr_an_min, an.ins->gr_db(an.g));
    }
    ph = 0.0;
    for (int blk = 0; blk < 100; ++blk) {
      sinus(leise, 0.1f);   // -20 dBFS, drive 0 dB, ceiling 0 dBFS: never over
      leise.block();
      if (blk >= 20) gr_leise_max = std::max(gr_leise_max, leise.ins->gr_db(leise.g));
    }
    // the driven peak of 0.9 at +24 dB is about 14.3 (23.1 dBFS), 29.1 dB over a -6 dB ceiling; a 220 Hz block of 256 holds a peak every ~1.2 blocks, so a block may hold less
    std::printf("3: clipping: smallest gr %.2f dB over blocks 20..99; drive 0 at -20 dBFS: largest gr %.6f dB\n", gr_an_min, gr_leise_max);
    PRUEF(gr_an_min > 0.0f);
    PRUEF(gr_leise_max == 0.0f);
    PRUEF(an.ins->lief(an.g) && leise.ins->lief(leise.g));
  }

  {  // 4 zeilen
    cypherdj::stellwerk::ReglerTabelle tab;
    const int k1 = tab.suche("ins/saett/1/kurve"), d4 = tab.suche("ins/saett/4/decke");
    PRUEF(k1 >= 0 && d4 >= 0);
    PRUEF(tab.suche("ins/saett/4/kurve") >= 0 && tab.suche("ins/saett/1/decke") >= 0);
    PRUEF(tab.suche("ins/saett/32/decke") >= 0 && tab.suche("ins/saett/33/kurve") < 0);   // pool 32 since strand 5 slice 3 (4 before)
    const auto& dk = tab.def(k1);
    const auto& dd = tab.def(d4);
    PRUEF(dk.rolle == cypherdj::stellwerk::Rolle::ins_saett_kurve && dk.min == 0.0f && dk.max == 2.0f && dk.vorgabe == 0.0f);
    PRUEF(dd.rolle == cypherdj::stellwerk::Rolle::ins_saett_decke && dd.min == -24.0f && dd.max == 0.0f && dd.vorgabe == 0.0f);
    PRUEF(cdj::INS_SAETT_PARAM == 6);
    std::printf("4: rows ins/saett/1/kurve %d, ins/saett/4/decke %d, table %d rows\n", k1, d4, tab.anzahl());
  }

  PRUEF_ENDE();
}
