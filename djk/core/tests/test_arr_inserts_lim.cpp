// Master limiter insert kind `lim` of the arrangement mixer (pool 1, KanalLimiter in sample-peak mode, 74 samples of latency).
// A 1 kHz sine on track 1 in the centre, the stage is slot 0 of its kind, start at bar 90000 (quant 2 from beat 0), blocks of 256.
// Cases: 1 lim_haelt_decke (+6 dBFS sine: every output sample stays under the ceiling, at -1 dB and at -6 dB, and the stage reports more than 6 dB of reduction;
// negative control: a -20 dBFS sine passes unchanged, delayed by the latency, with 0 dB reported), 2 lim_bypass (row an = 0: the input delayed by the latency, bit-equal),
// 3 lim_pdc (the latency is the one of a KanalLimiter with the fixed settings, a master chain with one lim gives 74), 4 lim_lader (slot 1 loads, slot 2 is refused: pool 1),
// 5 lim_pool_pin (pool constant, table rows, global index).
// Mutation (CMakeLists.txt): INS_LIM_DECKE_FEST (the stage ignores the decke row and stays at -1 dB: the -6 dB assertion of case 1 goes red).
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
static constexpr int L_LIM = 74;                       // measured: KanalLimiter(48000, {vorhalt 1.5 ms, sample peak}).latenz_samples()
static constexpr int64_t VON = 93000, BIS = 117000;    // well after the 480 sample blend and the latency

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
static double spitze(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
// one track with the audio `a` and a limiter stage on it, or without
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, bool mit_kette) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (mit_kette) b.kette(1, {ArrStufe{ArrInsArt::lim, 0, true}});
  return b.fertig();
}
// largest |a[i + v] - b[i]| over [von, bis)
static double abstand_versetzt(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis, int64_t v) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(a[i + v] - b[i])));
  return m;
}

int main() {
  auto laut = Audio::sinus(400000, 1000.0, 2.0f);     // +6 dBFS peak
  auto leise = Audio::sinus(400000, 1000.0, 0.1f);    // -20 dBFS peak
  const int slot = cdj::ins_global(ArrInsArt::lim, 0);

  {  // 1 lim_haelt_decke
    TR(ref) TR(a) TR(b) TR(lo) TR(lref)
    spiele(ref, spur1(&laut->a, false), 120000);
    const double g = spitze(ref.pml, VON, BIS) / 2.0;      // gain of the path after the stage (pan law of the centre position)
    PRUEF(g > 0.5 && g <= 1.0);                          // positive control: the signal is there and loud
    setze(a, "ins/lim/1/an", 1.0f);
    setze(a, "ins/lim/1/decke", -1.0f);
    spiele(a, spur1(&laut->a, true), 120000);
    const double c1 = std::pow(10.0, -1.0 / 20.0) * (1.0 + 1e-4);
    const double p1 = spitze(a.pml, VON, BIS);
    const float gr1 = a.arr.inserts().gr_db(slot);
    std::printf("1: ceiling -1 dB: peak %.5f (bound %.5f), reduction %.2f dB\n", p1, c1, static_cast<double>(gr1));
    PRUEF(p1 <= c1);
    PRUEF(p1 > 0.99 * std::pow(10.0, -1.0 / 20.0) * g);   // positive control: the limiter lets the signal up to the ceiling pass (it is not just muting)
    setze(b, "ins/lim/1/an", 1.0f);
    setze(b, "ins/lim/1/decke", -6.0f);
    spiele(b, spur1(&laut->a, true), 120000);
    const double c6 = std::pow(10.0, -6.0 / 20.0) * (1.0 + 1e-4);
    const double p6 = spitze(b.pml, VON, BIS);
    const float gr6 = b.arr.inserts().gr_db(slot);
    std::printf("1: ceiling -6 dB: peak %.5f (bound %.5f), reduction %.2f dB\n", p6, c6, static_cast<double>(gr6));
    PRUEF(p6 <= c6);
    PRUEF(p6 > 0.99 * std::pow(10.0, -6.0 / 20.0) * g);
    PRUEF(gr6 > 6.0f);
    // negative control: a quiet signal leaves the stage unchanged, delayed by the latency, and nothing is reported
    spiele(lref, spur1(&leise->a, false), 120000);
    setze(lo, "ins/lim/1/an", 1.0f);
    setze(lo, "ins/lim/1/decke", -1.0f);
    spiele(lo, spur1(&leise->a, true), 120000);
    const double d = abstand_versetzt(lo.pml, lref.pml, VON, BIS - L_LIM, L_LIM);
    std::printf("1: quiet sine: max difference to the delayed input %.3g, reduction %.4f dB\n", d, static_cast<double>(lo.arr.inserts().gr_db(slot)));
    PRUEF(spitze(lo.pml, VON, BIS) > 0.09 * g);          // the signal is there
    PRUEF(d < 1e-6);
    PRUEF((lo.arr.inserts().gr_db(slot)) == (0.0f));
  }

  {  // 2 lim_bypass: the row an = 0 gives the input delayed by the latency, bit-equal, although the signal would be limited
    TR(ref) TR(aus)
    spiele(ref, spur1(&laut->a, false), 120000);
    spiele(aus, spur1(&laut->a, true), 120000);          // an stays 0
    PRUEF(std::memcmp(aus.pml.data() + VON + L_LIM, ref.pml.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON - L_LIM)) == 0);
    PRUEF(std::memcmp(aus.pml.data() + VON, ref.pml.data() + VON, sizeof(float) * static_cast<size_t>(BIS - VON)) != 0);   // negative control: unshifted they differ
    PRUEF(spitze(aus.pml, VON, BIS) > 0.99 * spitze(ref.pml, VON, BIS));   // not limited (the level of the reference)
  }

  {  // 3 lim_pdc
    cypherdj::dsp::KanalLimiterEinstellung e;
    e.vorhalt_ms = 1.5f;
    e.echtspitze = false;
    const int soll = cypherdj::dsp::KanalLimiter(48000.0, e).latenz_samples();
    std::printf("3: KanalLimiter latency %d\n", soll);
    PRUEF((soll) == (L_LIM));
    PRUEF((cdj::ins_latenz(ArrInsArt::lim)) == (soll));
    TR(t)
    cdj::ArrSnapshot* s = spur1(&laut->a, true);
    cdj::arr_pdc_rechnen(*s);
    PRUEF((s->pdc.gesamt) == (L_LIM));                   // one track chain with one lim
    spiele(t, s, 100000);
    PRUEF((t.arr.inserts().latenz(slot)) == (L_LIM));
    PRUEF((t.arr.inserts().latenz(0)) == (0));           // negative control: a komp slot has none
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &laut->a);
    b.pm_kette({ArrStufe{ArrInsArt::lim, 0, true}});
    cdj::ArrSnapshot* pm = b.fertig();
    cdj::arr_pdc_rechnen(*pm);
    std::printf("3: master chain with one lim: pdc %d\n", static_cast<int>(pm->pdc.gesamt));
    PRUEF((pm->pdc.gesamt) == (L_LIM));
    delete pm;
    Bau c(1);
    c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &laut->a);
    cdj::ArrSnapshot* leer = c.fertig();
    cdj::arr_pdc_rechnen(*leer);
    PRUEF((leer->pdc.gesamt) == (0));                    // negative control: no stage, no latency
    delete leer;
  }

  {  // 4 lim_lader: a playback chain entry {art: lim, slot: 1} loads, the slot beyond the pool is refused (pool 2 since arr-fx slice 2)
    arrdatei::Ordner o("test_arr_inserts_lim");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto grund = [&](int64_t nr, const std::string& chain) {
      o.wiedergabe2_ret(nr, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"master\"}" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}", "", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      if (x.snap && nr == 81) {
        const cdj::ArrKette& k = x.snap->kette[0];
        PRUEF(k.n == 1 && k.st[0].art == ArrInsArt::lim && k.st[0].slot == 0 && k.st[0].an);
        PRUEF((x.snap->pdc.gesamt) == (L_LIM));
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(grund(81, ",\"chain\":[{\"art\":\"lim\",\"slot\":1,\"an\":true}]") == "+snap");
    PRUEF(grund(82, ",\"chain\":[{\"art\":\"lim\",\"slot\":" + std::to_string(cdj::ARR_INS_LIM + 1) + "}]") == "format");   // one beyond the pool
    PRUEF(grund(85, ",\"chain\":[{\"art\":\"lim\",\"slot\":" + std::to_string(cdj::ARR_INS_LIM) + "}]") == "+snap");        // the last slot of the pool (arr-fx slice 2: 2)
    PRUEF(grund(83, ",\"chain\":[{\"art\":\"lim\",\"slot\":1},{\"art\":\"lim\",\"slot\":1}]") == "format");     // the same slot twice
    PRUEF(grund(84, ",\"chain\":[{\"art\":\"lim\",\"slot\":0}]") == "format");                                  // slot numbers start at 1
  }

  {  // 5 lim_pool_pin: the pool constant equals the rows of the table, the global index follows the other kinds
    cypherdj::stellwerk::ReglerTabelle tab;
    PRUEF(tab.suche(("ins/lim/" + std::to_string(cdj::ARR_INS_LIM) + "/an").c_str()) >= 0);
    PRUEF(tab.suche(("ins/lim/" + std::to_string(cdj::ARR_INS_LIM + 1) + "/an").c_str()) < 0);
    int n = 0;
    for (int r = 0; r < tab.anzahl(); ++r)
      if (std::strncmp(tab.def(r).pfad, "ins/lim/", 8) == 0) ++n;
    PRUEF((n) == (cdj::INS_LIM_PARAM * cdj::ARR_INS_LIM));
    PRUEF((slot) == (cdj::ARR_INS_KOMP + cdj::ARR_INS_EQ + cdj::ARR_INS_SAETT));
    PRUEF((cdj::ins_global(ArrInsArt::lim, cdj::ARR_INS_LIM)) == (-1));
    PRUEF((cdj::ins_art(slot)) == (ArrInsArt::lim));
    PRUEF((cdj::ARR_INS_ALLE) == (slot + cdj::ARR_INS_LIM + cdj::ARR_INS_UTIL + cdj::ARR_INS_BK + cdj::ARR_INS_HOST));   // plan 1.11 T4 / arr-fx / arr-bk: the utility, bk and host slots follow the limiter
    PRUEF((cdj::INS_G_HOST0) == (slot + cdj::ARR_INS_LIM + cdj::ARR_INS_UTIL + cdj::ARR_INS_BK));
    std::printf("5: pool lim %d, rows %d, global index %d, ARR_INS_ALLE %d\n", cdj::ARR_INS_LIM, n, slot, cdj::ARR_INS_ALLE);
  }
  PRUEF_ENDE();
}
