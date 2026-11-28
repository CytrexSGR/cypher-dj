// Strand 13 slice 1 (task 1.2): the compressor stage `komp` with the glue mode and the auto release (rows ins/komp/<n>/glue and ins/komp/<n>/auto,
// switches, parameters 10 and 11 after the key sc; the DSP is comp_dsp Komp::setze_charakter, task 1.1).
// Cases: 1 vorgabe_bitgleich (a stage at the defaults equals a cdj::Komp driven directly, bit for bit; glue 1 on both is bit-equal too;
//   negative control: glue 1 on the stage only differs, the default release 120 ms snaps to 100 ms),
// 2 glue_ratio (glue 1 with ratio 3 compresses like ratio 4: the steady GR of a -6 dBFS sine at threshold -18 dB is within 0.2 dB of the ratio-4 value;
//   negative control: glue 0 with ratio 3 is more than 0.2 dB away),
// 3 auto_release (auto 1 changes the release curve: 300 ms after the level drops below the threshold the GR differs from auto 0 by more than 1 dB),
// 4 zeilen (the table has ins/komp/1/glue and ins/komp/160/auto with the contract ranges, none for slot 161; the parameter count of a komp slot is 12; the rows
//   reach the stage through the arrangement binding: after ins/komp/1/glue = 1 and ins/komp/1/auto = 1 the stage applied 1 and 1 as parameters 10 and 11).
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
#include "cypherdj/comp.h"
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

// The komp values of a stage, parameters 1..8 in the order of the rows (schwelle, ratio, knie, attack, release, makeup, mix, schp), then glue and auto
struct Werte {
  float schwelle = -18.0f, ratio = 4.0f, knie = 6.0f, attack = 10.0f, release = 120.0f, makeup = 0.0f, mix = 1.0f, schp = 0.0f;
  float glue = 0.0f, autor = 0.0f;
  CypherKompEinstellung einstellung() const { return CypherKompEinstellung{schwelle, ratio, knie, attack, release, makeup, mix, schp}; }
};

// One komp stage of the pool on its own (ArrInserts, strip 0, blocks of 256), rows bound and set by hand (the pattern of test_arr_inserts_saett_clip)
struct Modul {
  static constexpr int M = 256;
  std::unique_ptr<cdj::ArrInserts> ins = std::make_unique<cdj::ArrInserts>();
  std::unique_ptr<cdj::ArrKette[]> ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
  int g = cdj::ins_global(ArrInsArt::komp, 0);
  float l[M] = {}, r[M] = {};
  bool getauscht = false;
  Modul() {
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::komp, 0, true};
  }
  void setze(int p, float v) {
    ins->binde(g, p, v);
    ins->setze_sofort(g, p, v);
  }
  void stelle(const Werte& w) {
    const float v[cdj::INS_KOMP_PARAM] = {1.0f, w.schwelle, w.ratio, w.knie, w.attack, w.release, w.makeup, w.mix, w.schp, 0.0f, w.glue, w.autor};
    for (int k = 0; k < cdj::INS_KOMP_PARAM; ++k) setze(k, v[k]);
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

// Case 1: true when every block from block `ab` on is bit-equal to a cdj::Komp given setze(w) (and setze_charakter(glue, auto) when `charakter`)
static bool gleich_direkt(const Werte& stufe, const Werte& direkt, bool charakter, int ab, int bloecke) {
  Modul x;
  x.stelle(stufe);
  cdj::Komp k;
  k.setze(direkt.einstellung());
  if (charakter) k.setze_charakter(direkt.glue >= 0.5f, direkt.autor >= 0.5f);
  uint32_t z = 777u;
  float el[Modul::M], er[Modul::M];
  bool gleich = true;
  for (int blk = 0; blk < bloecke; ++blk) {
    rauschen(z, x.l, x.r, Modul::M);
    std::memcpy(el, x.l, sizeof el);
    std::memcpy(er, x.r, sizeof er);
    x.block();
    k.block(el, er, Modul::M);
    if (blk >= ab && (std::memcmp(el, x.l, sizeof el) != 0 || std::memcmp(er, x.r, sizeof er) != 0)) gleich = false;
  }
  return gleich;
}

// A 1 kHz sine of amplitude `amp` into the stage for `bloecke` blocks; returns the mean GR over the last `mittel` blocks (or the GR of the last block when mittel is 0)
struct Sinus {
  double ph = 0.0;
  float lauf(Modul& x, float amp, int bloecke, int mittel = 0) {
    double summe = 0.0;
    for (int blk = 0; blk < bloecke; ++blk) {
      for (int t = 0; t < Modul::M; ++t) {
        x.l[t] = x.r[t] = amp * static_cast<float>(std::sin(ph));
        ph += 2.0 * 3.14159265358979323846 * 1000.0 / 48000.0;
      }
      x.block();
      if (blk >= bloecke - mittel) summe += x.ins->gr_db(x.g);
    }
    return mittel > 0 ? static_cast<float>(summe / mittel) : x.ins->gr_db(x.g);
  }
};

int main() {
  const int g = cdj::ins_global(ArrInsArt::komp, 0);
  PRUEF(g == 0);

  {  // 1 vorgabe_bitgleich: from block 4 on (the 10 ms entry blend of the stage is over after 480 samples) the stage output is the module output
    Werte vorgabe;
    Werte glue;
    glue.glue = 1.0f;
    Werte glue_auto = glue;
    glue_auto.autor = 1.0f;
    const bool v = gleich_direkt(vorgabe, vorgabe, false, 4, 200);
    const bool nur_stufe = gleich_direkt(glue, vorgabe, false, 4, 200);   // negative control: glue on the stage only (release 120 snaps to 100 ms)
    const bool beide = gleich_direkt(glue, glue, true, 4, 200);           // the stage hands glue to setze_charakter
    const bool beide_auto = gleich_direkt(glue_auto, glue_auto, true, 4, 200);
    std::printf("1: defaults bit-equal %d, glue on the stage only bit-equal %d (expected 0), glue on both %d, glue and auto on both %d\n", v, nur_stufe, beide, beide_auto);
    PRUEF(v);
    PRUEF(!nur_stufe);
    PRUEF(beide);
    PRUEF(beide_auto);
  }

  {  // 2 glue_ratio: -6 dBFS sine (0.501), threshold -18 dB: 12 dB over; ratio 4 reduces about 9 dB, ratio 3 about 8 dB
    const float amp = static_cast<float>(std::pow(10.0, -6.0 / 20.0));
    Werte r4, r3_glue, r3;
    r4.release = 100.0f;   // the release glue snaps 120 to; attack 10 and knie 6 stay as they are
    r3_glue.ratio = 3.0f;
    r3_glue.glue = 1.0f;
    r3.ratio = 3.0f;
    r3.release = 100.0f;
    Modul a, b, c;
    a.stelle(r4);
    b.stelle(r3_glue);
    c.stelle(r3);
    Sinus sa, sb, sc;
    const float gr4 = sa.lauf(a, amp, 400, 100), gr3g = sb.lauf(b, amp, 400, 100), gr3 = sc.lauf(c, amp, 400, 100);
    std::printf("2: steady GR ratio 4 %.3f dB, glue ratio 3 %.3f dB, ratio 3 %.3f dB\n", gr4, gr3g, gr3);
    PRUEF(gr4 > 6.0f);
    PRUEF(std::fabs(gr3g - gr4) <= 0.2f);
    PRUEF(std::fabs(gr3 - gr4) > 0.2f);   // negative control
  }

  {  // 3 auto_release: 2 s at -6 dBFS (about 9 dB GR at ratio 4), then -40 dBFS (below the threshold); GR 300 ms after the drop
    const float laut = static_cast<float>(std::pow(10.0, -6.0 / 20.0)), leise = static_cast<float>(std::pow(10.0, -40.0 / 20.0));
    Werte aus, an;
    an.autor = 1.0f;
    Modul a, b;
    a.stelle(aus);
    b.stelle(an);
    Sinus sa, sb;
    const int zwei_s = 2 * 48000 / Modul::M, ms300 = 300 * 48 / Modul::M;   // 375 and 56 blocks (56 x 256 = 298.7 ms)
    const float vor_aus = sa.lauf(a, laut, zwei_s), vor_an = sb.lauf(b, laut, zwei_s);
    const float nach_aus = sa.lauf(a, leise, ms300), nach_an = sb.lauf(b, leise, ms300);
    std::printf("3: GR before the drop auto 0 %.3f dB, auto 1 %.3f dB; 300 ms after: auto 0 %.3f dB, auto 1 %.3f dB\n", vor_aus, vor_an, nach_aus, nach_an);
    PRUEF(vor_aus > 6.0f && vor_an > 6.0f);
    PRUEF(std::fabs(nach_an - nach_aus) > 1.0f);
    PRUEF(nach_an > nach_aus);   // the slow branch holds the reduction after sustained compression
  }

  {  // 4 zeilen and the binding through the arrangement
    cypherdj::stellwerk::ReglerTabelle tab;
    const int g1 = tab.suche("ins/komp/1/glue"), a160 = tab.suche("ins/komp/160/auto");
    PRUEF(g1 >= 0 && a160 >= 0);
    PRUEF(tab.suche("ins/komp/1/auto") == g1 + 1 && tab.suche("ins/komp/1/sc") == g1 - 1);   // glue and auto follow sc of the same instance
    PRUEF(tab.suche("ins/komp/160/glue") >= 0 && tab.suche("ins/komp/161/glue") < 0);
    const auto& dg = tab.def(g1);
    const auto& da = tab.def(a160);
    PRUEF(dg.rolle == cypherdj::stellwerk::Rolle::ins_komp_glue && dg.min == 0.0f && dg.max == 1.0f && dg.vorgabe == 0.0f && dg.ganzzahlig);
    PRUEF(da.rolle == cypherdj::stellwerk::Rolle::ins_komp_auto && da.min == 0.0f && da.max == 1.0f && da.vorgabe == 0.0f && da.ganzzahlig);
    PRUEF(cdj::INS_KOMP_PARAM == 12 && cdj::INS_KOMP_GLUE == 10 && cdj::INS_KOMP_AUTO == 11);

    auto q = Audio::sinus(200000, 220.0, 0.5f);
    TR(t)
    setze(t, "ins/komp/1/an", 1.0f);
    setze(t, "ins/komp/1/glue", 1.0f);
    setze(t, "ins/komp/1/auto", 1.0f);
    Bau bau(1);
    bau.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a);
    bau.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
    t.laden(bau.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(48000);
    const float wg = t.arr.inserts().wirksam(g, cdj::INS_KOMP_GLUE), wa = t.arr.inserts().wirksam(g, cdj::INS_KOMP_AUTO);
    std::printf("4: rows ins/komp/1/glue %d, ins/komp/160/auto %d, table %d rows; applied through the arrangement: glue %.1f, auto %.1f, GR %.2f dB\n", g1, a160,
                tab.anzahl(), wg, wa, t.arr.inserts().gr_db(g));
    PRUEF(wg == 1.0f && wa == 1.0f);
    PRUEF(t.arr.inserts().lief(g));
  }

  PRUEF_ENDE();
}
