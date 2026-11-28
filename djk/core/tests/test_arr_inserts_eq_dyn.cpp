// Strand 5 slice 2 (task 2.2): the dynamic bands of the EQ stage `eq` (rows ins/eq/<n>/d<m>/{dyn,schwelle,bereich}, parameters 59 + (m - 1) * 3 + p, and
// ins/eq/<n>/{dyn_attack,dyn_release}, parameters 83 and 84) and its measurement (gr of an eq slot = the deepest dynamic change of the block, a cut positive).
// Cases: 1 statisch_bitgleich (an eq stage with static bands and the dynamic rows at their defaults equals an EqNativ given only setze_global/setze_band,
//   bit for bit; negative control: one dynamic band makes it differ), 2 schnitt_gr (band 3 Bell 1 kHz, above, threshold -40, range -12 on a 1 kHz sine
//   at -1 dBFS: the stage cuts about 12 dB and the slot's gr reads about +12; at -60 dBFS nothing is cut and gr stays 0),
// 3 zeilen (rows ins/eq/160/d8/bereich and ins/eq/1/dyn_release with the contract ranges and roles; they follow b8/platz of their instance),
// 4 indizes (59/83/84; through the arrangement the rows land on parameters 5 (b1/freq), 58 (b8/platz), 59, 82, 83, 84, and the d3 rows cut on the PM).
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
#include "cypherdj/eq.h"
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
  if (mit_stufe) b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}});
  return b.fertig();
}

// the contract defaults of a band (insert_module.json vorgabe_je_band)
static constexpr float TYP0[8] = {3, 1, 0, 0, 0, 0, 2, 4};
static constexpr float FREQ0[8] = {30, 100, 250, 800, 2500, 6000, 10000, 18000};

// One eq stage of the pool on its own (ArrInserts, strip 0, blocks of 256), every parameter bound and set by hand (the pattern of test_arr_inserts_saett_clip)
struct Modul {
  static constexpr int M = 256;
  std::unique_ptr<cdj::ArrInserts> ins = std::make_unique<cdj::ArrInserts>();
  std::unique_ptr<cdj::ArrKette[]> ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
  int g = cdj::ins_global(ArrInsArt::eq, 0);
  float w[cdj::INS_EQ_PARAM] = {};
  float l[M] = {}, r[M] = {};
  bool getauscht = false;
  Modul() {
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::eq, 0, true};
    w[0] = 1.0f;   // an
    for (int b = 0; b < 8; ++b) {
      const int o = 3 + b * cdj::INS_EQ_BAND_PARAM;
      w[o + 1] = TYP0[b];
      w[o + 2] = FREQ0[b];
      w[o + 4] = 0.707f;
      w[cdj::INS_EQ_DYN0 + b * cdj::INS_EQ_DYN_PARAM + 1] = -24.0f;   // schwelle default
    }
    w[cdj::INS_EQ_DYN_ATTACK] = 5.0f;
    w[cdj::INS_EQ_DYN_RELEASE] = 80.0f;
  }
  // band b (0-based): an, typ, freq, gain, q
  void band(int b, float typ, float freq, float gain, float q) {
    const int o = 3 + b * cdj::INS_EQ_BAND_PARAM;
    w[o] = 1.0f;
    w[o + 1] = typ;
    w[o + 2] = freq;
    w[o + 3] = gain;
    w[o + 4] = q;
  }
  void dyn(int b, float modus, float schwelle, float bereich) {
    const int o = cdj::INS_EQ_DYN0 + b * cdj::INS_EQ_DYN_PARAM;
    w[o] = modus;
    w[o + 1] = schwelle;
    w[o + 2] = bereich;
  }
  void block() {
    if (!getauscht) {
      for (int p = 0; p < cdj::INS_EQ_PARAM; ++p) {
        ins->binde(g, p, w[p]);
        ins->setze_sofort(g, p, w[p]);
      }
      ins->tausche(ketten.get());
    }
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

// Case 1: true when every block from block `ab` on is bit-equal to an EqNativ given only the static settings (out -2 dB, b2 Low shelf 100 Hz +4, b4 Bell 800 Hz -5 Q 2)
static bool gleich_nativ(bool mit_dyn, int ab, int bloecke) {
  Modul x;
  x.w[1] = -2.0f;   // out
  x.band(1, 1.0f, 100.0f, 4.0f, 0.707f);
  x.band(3, 0.0f, 800.0f, -5.0f, 2.0f);
  if (mit_dyn) x.dyn(3, 1.0f, -40.0f, -6.0f);   // negative control: band 4 cuts dynamically
  cdj::EqNativ n;
  n.setze_global(false, -2.0);
  for (int b = 0; b < 8; ++b) {
    const float* e = x.w + 3 + b * cdj::INS_EQ_BAND_PARAM;
    n.setze_band(b, CypherEqBand{static_cast<double>(e[2]), static_cast<double>(e[3]), static_cast<double>(e[4]), static_cast<uint8_t>(e[0] >= 0.5f ? 1 : 0),
                                 static_cast<uint8_t>(std::lround(e[1])), static_cast<uint8_t>(std::lround(e[5])), static_cast<uint8_t>(std::lround(e[6]))});
  }
  uint32_t z = 4242u;
  float el[Modul::M], er[Modul::M];
  bool gleich = true;
  float gr_max = 0.0f;
  for (int blk = 0; blk < bloecke; ++blk) {
    rauschen(z, x.l, x.r, Modul::M);
    std::memcpy(el, x.l, sizeof el);
    std::memcpy(er, x.r, sizeof er);
    x.block();
    n.block(el, er, Modul::M);
    gr_max = std::max(gr_max, std::fabs(x.ins->gr_db(x.g)));
    if (blk >= ab && (std::memcmp(el, x.l, sizeof el) != 0 || std::memcmp(er, x.r, sizeof er) != 0)) gleich = false;
  }
  if (!mit_dyn) PRUEF(gr_max == 0.0f);   // a static EQ reports no dynamic change
  return gleich;
}

int main() {
  const int g = cdj::ins_global(ArrInsArt::eq, 0);
  PRUEF(g >= 0);

  {  // 1 statisch_bitgleich: from block 4 on (the 10 ms entry blend is over after 480 samples) the stage output is the module output
    const bool statisch = gleich_nativ(false, 4, 200);
    const bool dyn = gleich_nativ(true, 4, 200);
    std::printf("1: static stage bit-equal to the native EQ %d, with one dynamic band bit-equal %d (expected 0)\n", statisch, dyn);
    PRUEF(statisch);
    PRUEF(!dyn);
  }

  {  // 2 schnitt_gr: band 3 Bell 1 kHz Q 1, above, threshold -40 dB, range -12 dB (d = L - T >= 18 dB, so D = -12)
    auto lauf = [](float amp, double* aus_db, float* gr_mittel) {
      Modul x;
      x.band(2, 0.0f, 1000.0f, 0.0f, 1.0f);
      x.dyn(2, 1.0f, -40.0f, -12.0f);
      double ph = 0.0, ein = 0.0, aus = 0.0, gr = 0.0;
      int n_gr = 0;
      for (int blk = 0; blk < 300; ++blk) {
        for (int t = 0; t < Modul::M; ++t) {
          x.l[t] = x.r[t] = amp * static_cast<float>(std::sin(ph));
          ph += 2.0 * 3.14159265358979323846 * 1000.0 / 48000.0;
        }
        if (blk >= 200) ein = std::max(ein, static_cast<double>(amp));
        x.block();
        if (blk >= 200) {   // steady state: 1 s after the start (attack 5 ms, release 80 ms)
          for (int t = 0; t < Modul::M; ++t) aus = std::max(aus, static_cast<double>(std::fabs(x.l[t])));
          gr += x.ins->gr_db(x.g);
          ++n_gr;
        }
      }
      *aus_db = db(aus) - db(ein);
      *gr_mittel = static_cast<float>(gr / n_gr);
    };
    double laut_db = 0.0, leise_db = 0.0;
    float gr_laut = 0.0f, gr_leise = 0.0f;
    lauf(0.89f, &laut_db, &gr_laut);      // -1 dBFS
    lauf(0.001f, &leise_db, &gr_leise);   // -60 dBFS, under the threshold
    std::printf("2: loud sine: gain %.2f dB, gr %.2f dB; quiet sine: gain %.3f dB, gr %.4f dB\n", laut_db, gr_laut, leise_db, gr_leise);
    PRUEF(laut_db < -11.0 && laut_db > -13.0);
    PRUEF(gr_laut > 11.0f && gr_laut < 13.0f);
    PRUEF(std::fabs(leise_db) < 0.2);
    PRUEF(std::fabs(gr_leise) < 0.01f);
  }

  {  // 3 zeilen
    cypherdj::stellwerk::ReglerTabelle tab;
    namespace sw = cypherdj::stellwerk;
    const int b8 = tab.suche("ins/eq/1/b8/platz"), d1 = tab.suche("ins/eq/1/d1/dyn"), rel1 = tab.suche("ins/eq/1/dyn_release");
    const int ber = tab.suche("ins/eq/160/d8/bereich"), an2 = tab.suche("ins/eq/2/an");
    PRUEF(b8 >= 0 && d1 >= 0 && rel1 >= 0 && ber >= 0 && an2 >= 0);
    PRUEF(d1 == b8 + 1 && rel1 == b8 + 8 * 3 + 2 && an2 == rel1 + 2);   // the 26 new rows of an instance follow its b8/platz; then its key row sc (strand 5 slice 4); the next instance follows them
    PRUEF(tab.suche("ins/eq/1/d9/dyn") < 0 && tab.suche("ins/eq/161/dyn_attack") < 0 && tab.suche("ins/eq/1/d0/bereich") < 0);
    const auto& dd = tab.def(d1);
    const auto& ds = tab.def(tab.suche("ins/eq/7/d3/schwelle"));
    const auto& db8 = tab.def(ber);
    const auto& da = tab.def(tab.suche("ins/eq/1/dyn_attack"));
    const auto& dr = tab.def(rel1);
    PRUEF(dd.rolle == sw::Rolle::ins_eq_d_dyn && dd.min == 0.0f && dd.max == 4.0f && dd.vorgabe == 0.0f && dd.ganzzahlig);
    PRUEF(ds.rolle == sw::Rolle::ins_eq_d_schwelle && ds.min == -60.0f && ds.max == 0.0f && ds.vorgabe == -24.0f);
    PRUEF(db8.rolle == sw::Rolle::ins_eq_d_bereich && db8.min == -24.0f && db8.max == 24.0f && db8.vorgabe == 0.0f);
    PRUEF(da.rolle == sw::Rolle::ins_eq_dyn_attack && da.min == 0.1f && da.max == 100.0f && da.vorgabe == 5.0f);
    PRUEF(dr.rolle == sw::Rolle::ins_eq_dyn_release && dr.min == 5.0f && dr.max == 1000.0f && dr.vorgabe == 80.0f);
    std::printf("3: rows ins/eq/1/d1/dyn %d, ins/eq/1/dyn_release %d, ins/eq/160/d8/bereich %d, table %d rows\n", d1, rel1, ber, tab.anzahl());
  }

  {  // 4 indizes: the constants, then the rows through the arrangement (regler_binden) onto the parameters of eq slot 1, and the d3 rows cut on the PM
    PRUEF(cdj::INS_EQ_DYN0 == 59 && cdj::INS_EQ_DYN_ATTACK == 83 && cdj::INS_EQ_DYN_RELEASE == 84 && cdj::INS_EQ_PARAM == 86 && cdj::INS_PARAM_MAX == 86);   // 86 since strand 5 slice 4 (the key row sc, parameter 85)
    auto q = Audio::sinus(300000, 1000.0, 0.9f);
    TR(ref) TR(dyn)
    spiele(ref, spur1(&q->a, false), 200000);
    const int64_t e0 = einsatz(ref.pml);
    PRUEF(e0 > 0 && e0 + 96000 < 200000);
    const int64_t a = e0 + 48000, b = e0 + 96000;   // 1 s after the onset: ramps, entry blend and the detector are settled
    setze(dyn, "ins/eq/1/an", 1.0f);
    setze(dyn, "ins/eq/1/b1/freq", 31.5f);       // parameter 5
    setze(dyn, "ins/eq/1/b8/platz", 2.0f);       // parameter 58 (band 8 stays off)
    setze(dyn, "ins/eq/1/b3/an", 1.0f);
    setze(dyn, "ins/eq/1/b3/freq", 1000.0f);
    setze(dyn, "ins/eq/1/b3/q", 1.0f);
    setze(dyn, "ins/eq/1/d1/dyn", 0.0f);         // parameter 59
    setze(dyn, "ins/eq/1/d3/dyn", 1.0f);         // parameter 65
    setze(dyn, "ins/eq/1/d3/schwelle", -50.0f);  // parameter 66
    setze(dyn, "ins/eq/1/d3/bereich", -12.0f);   // parameter 67
    setze(dyn, "ins/eq/1/d8/bereich", -7.0f);    // parameter 82 (band 8 is off: no effect)
    setze(dyn, "ins/eq/1/dyn_attack", 3.0f);     // parameter 83
    setze(dyn, "ins/eq/1/dyn_release", 200.0f);  // parameter 84
    spiele(dyn, spur1(&q->a, true), 200000);
    const auto& ins = dyn.arr.inserts();
    std::printf("4: parameters 5 %.2f, 58 %.0f, 65 %.0f, 66 %.0f, 67 %.0f, 82 %.0f, 83 %.0f, 84 %.0f\n", ins.wirksam(g, 5), ins.wirksam(g, 58), ins.wirksam(g, 65),
                ins.wirksam(g, 66), ins.wirksam(g, 67), ins.wirksam(g, 82), ins.wirksam(g, 83), ins.wirksam(g, 84));
    PRUEF(ins.wirksam(g, 5) == 31.5f && ins.wirksam(g, 58) == 2.0f && ins.wirksam(g, 59) == 0.0f);
    PRUEF(ins.wirksam(g, 65) == 1.0f && ins.wirksam(g, 66) == -50.0f && ins.wirksam(g, 67) == -12.0f);
    PRUEF(ins.wirksam(g, 82) == -7.0f && ins.wirksam(g, 83) == 3.0f && ins.wirksam(g, 84) == 200.0f);
    const double schnitt = db(spitze(dyn.pml, a, b)) - db(spitze(ref.pml, a, b));
    std::printf("4: PM with the dynamic band against without the stage: %.2f dB, gr %.2f dB\n", schnitt, dyn.arr.inserts().gr_db(g));
    PRUEF(schnitt < -11.0 && schnitt > -13.0);
    PRUEF(dyn.arr.inserts().gr_db(g) > 11.0f && dyn.arr.inserts().gr_db(g) < 13.0f);
  }

  PRUEF_ENDE();
}
