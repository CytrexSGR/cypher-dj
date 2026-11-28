// Strand 5 slice 3 task 3.4: the insert kinds `trans` (pool 32, the transient shaper dsp/transient.h) and `bild` (pool 16, the three-band imager dsp/imager.h), 0 samples of latency
// each, and the saturation pool 32. One track, 48 kHz, blocks of 256 where the Arrangement plays (PM tap); the module cases drive ArrInserts directly (strip 0, rows bound by hand).
// Cases: 1 trans_neutral (the stage at its defaults equals the reference bit for bit on the PM tap, and it ran),
// 2 trans_angriff (a decaying 100 Hz burst: angriff +12 raises the first 5 ms by more than 6 dB, the tail after 60 ms stays within 1 dB; gr reports the change; halten -12 lowers the tail),
// 3 bild_neutral (all widths 1: the steady-state magnitude of L and R at 60 Hz .. 12 kHz equals the input within 1e-5; the waveform differs, the allpass ran; breite_hoch 0 makes 10 kHz mono, gr 0),
// 4 tb_lader (trans 32, bild 16 and saett 32 load; trans 33, bild 17 and saett 33 are refused),
// 5 tb_pool_pin (pool constants, enum values 10 and 11, global order komp, eq, saett, lim, utility, bk, gate, mb, trans, bild, host; latency 0; table rows; eight mask words),
// 6 tb_ruhe_einmal (a trans + bild chain with a crossover move plays, stops, the quiet path runs 300 blocks, three times: runs 2 and 3 are bit-equal),
// 7 tb_nan (a NaN in front of a trans and of a bild stage: the block is silent, counted once, the stage plays again after it).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_maske.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr double PI = 3.14159265358979323846;

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
static double rms(const float* v, int von, int bis) {
  double q = 0.0;
  for (int i = von; i < bis; ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
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
static bool gleich_bits_versetzt(const std::vector<float>& a, int64_t von, int64_t bis, int64_t v) {
  return std::memcmp(a.data() + von + v, a.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}
// a decaying 100 Hz burst (exp 50 ms) every 24000 frames, L and R equal, peak 0.5
static std::unique_ptr<Audio> stoesse(int64_t frames) {
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f) {
    const double t = static_cast<double>(f % 24000) / 48000.0;
    x->d[2 * f] = x->d[2 * f + 1] = static_cast<float>(0.5 * std::exp(-t / 0.05) * std::sin(2.0 * PI * 100.0 * t));
  }
  x->fuellen(frames);
  return x;
}
static cdj::ArrSnapshot* spur1(const cdj::ArrAudio* a, std::initializer_list<ArrStufe> kette, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (kette.size() > 0) b.kette(1, kette);
  return b.fertig();
}
static const ArrStufe TRANS1{ArrInsArt::trans, 0, true};
static const ArrStufe BILD1{ArrInsArt::bild, 0, true};

// one stage of the pool on its own (ArrInserts, strip 0, blocks of 256), rows bound and set by hand with the contract defaults
struct Modul {
  static constexpr int M = 256;
  std::unique_ptr<cdj::ArrInserts> ins = std::make_unique<cdj::ArrInserts>();
  std::unique_ptr<cdj::ArrKette[]> ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
  int g;
  float l[M] = {}, r[M] = {};
  explicit Modul(ArrInsArt art) : g(cdj::ins_global(art, 0)) {
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{art, 0, true};
    if (art == ArrInsArt::trans) {   // an, angriff, halten, tempo, out, mix
      const float d[6] = {1.0f, 0.0f, 0.0f, 15.0f, 0.0f, 1.0f};
      for (int k = 0; k < 6; ++k) setze(k, d[k]);
    } else {   // an, grenze_tief, grenze_hoch, breite_tief, breite_mitte, breite_hoch, mono_unter
      const float d[7] = {1.0f, 150.0f, 4000.0f, 1.0f, 1.0f, 1.0f, 0.0f};
      for (int k = 0; k < 7; ++k) setze(k, d[k]);
    }
  }
  void setze(int p, float v) {
    ins->binde(g, p, v);
    ins->setze_sofort(g, p, v);
  }
  void block() {
    if (!getauscht) ins->tausche(ketten.get());
    getauscht = true;
    ins->kette(0, &ketten[0], l, r, M);
    ins->nachfuehren(M);
  }
  bool getauscht = false;
};

int main() {
  const int g_trans = cdj::ins_global(ArrInsArt::trans, 0);
  const int g_bild = cdj::ins_global(ArrInsArt::bild, 0);
  PRUEF(g_trans >= 0 && g_bild >= 0);

  {  // 1 trans_neutral: angriff 0, halten 0, out 0, mix 1 is bit-transparent (the module's own rule), so the PM tap equals the run without the stage
    auto q = stoesse(400000);
    TR(ref) TR(x)
    spiele(ref, spur1(&q->a, {}), 160000);
    setze(x, "ins/trans/1/an", 1.0f);
    spiele(x, spur1(&q->a, {TRANS1}), 160000);
    const int64_t e0 = einsatz(ref.pml);
    PRUEF(e0 > 0 && e0 + 48000 < 160000);
    double d = 0.0;
    for (int64_t i = 0; i < 160000; ++i) d = std::max(d, static_cast<double>(std::fabs(x.pml[i] - ref.pml[i])));
    std::printf("1: trans at its defaults: largest difference to the reference %.3g, peak %.3f, ran %d\n", d, spitze(ref.pml, e0, e0 + 48000), x.arr.inserts().lief(g_trans) ? 1 : 0);
    PRUEF(spitze(ref.pml, e0, e0 + 48000) > 0.1);
    PRUEF(d == 0.0);
    PRUEF(x.arr.inserts().lief(g_trans));
  }

  {  // 2 trans_angriff: the burst at block 40 (after the entry blend); attack +12 against the stage at 0
    auto lauf = [](float angriff, float halten, std::vector<float>& aus, float* gr) {
      Modul x(ArrInsArt::trans);
      x.setze(1, angriff);
      x.setze(2, halten);
      aus.assign(static_cast<size_t>(60 * Modul::M), 0.0f);
      float g = 0.0f;
      for (int blk = 0; blk < 100; ++blk) {
        for (int t = 0; t < Modul::M; ++t) {
          const int f = (blk - 40) * Modul::M + t;
          const double s = f / 48000.0;
          x.l[t] = x.r[t] = f < 0 ? 0.0f : static_cast<float>(0.5 * std::exp(-s / 0.05) * std::sin(2.0 * PI * 100.0 * s));
        }
        x.block();
        if (blk >= 40) {
          std::memcpy(aus.data() + static_cast<size_t>((blk - 40) * Modul::M), x.l, sizeof x.l);
          g = std::max(g, x.ins->gr_db(x.g));
        }
      }
      *gr = g;
    };
    std::vector<float> null, auf, halt;
    float gr0 = 0.0f, gr_auf = 0.0f, gr_halt = 0.0f;
    lauf(0.0f, 0.0f, null, &gr0);
    lauf(12.0f, 0.0f, auf, &gr_auf);
    lauf(0.0f, -12.0f, halt, &gr_halt);
    const double vorn = db(rms(auf.data(), 0, 240) / rms(null.data(), 0, 240));
    const double hinten = db(rms(auf.data(), 2880 + 4800, 2880 + 9600) / rms(null.data(), 2880 + 4800, 2880 + 9600));   // 160 .. 260 ms (60 ms tail plus 100 ms of settling)
    const double halt_hinten = db(rms(halt.data(), 2880, 2880 + 4800) / rms(null.data(), 2880, 2880 + 4800));
    std::printf("2: angriff +12: first 5 ms %+.2f dB, tail %+.2f dB, gr %.2f dB (at 0: %.2f); halten -12: tail after 60 ms %+.2f dB, gr %.2f dB\n", vorn, hinten, gr_auf, gr0, halt_hinten,
                gr_halt);
    PRUEF(vorn > 6.0);
    PRUEF(std::fabs(hinten) < 1.0);
    PRUEF(gr_auf > 6.0f && gr_auf <= 24.0f);
    PRUEF(gr0 == 0.0f);
    PRUEF(halt_hinten < -6.0);
    PRUEF(gr_halt > 6.0f);
  }

  {  // 3 bild_neutral: all widths 1, a stereo sine (R at half level and a quarter period late) at frequencies around both crossovers; the magnitude over a whole number of periods
     // after 1 s of settling equals the input's within 1e-5 on both sides
    const double hz[6] = {60.0, 150.0, 1000.0, 4000.0, 8000.0, 12000.0};
    double schlimmst = 0.0;
    bool anders = false;
    for (double f : hz) {
      Modul x(ArrInsArt::bild);
      double el = 0.0, er = 0.0, al = 0.0, ar = 0.0;
      for (int blk = 0; blk < 300; ++blk) {
        for (int t = 0; t < Modul::M; ++t) {
          const double s = static_cast<double>(blk * Modul::M + t) / 48000.0;
          x.l[t] = static_cast<float>(0.4 * std::sin(2.0 * PI * f * s));
          x.r[t] = static_cast<float>(0.2 * std::sin(2.0 * PI * f * s - 0.5 * PI));
        }
        float il[Modul::M], ir[Modul::M];
        std::memcpy(il, x.l, sizeof il);
        std::memcpy(ir, x.r, sizeof ir);
        x.block();
        if (blk >= 225) {   // 75 blocks = 19 200 samples: a whole number of periods at every frequency above
          for (int t = 0; t < Modul::M; ++t) {
            el += static_cast<double>(il[t]) * il[t];
            er += static_cast<double>(ir[t]) * ir[t];
            al += static_cast<double>(x.l[t]) * x.l[t];
            ar += static_cast<double>(x.r[t]) * x.r[t];
            anders = anders || std::fabs(x.l[t] - il[t]) > 1e-3f;
          }
        }
      }
      const double dl = std::fabs(std::sqrt(al / el) - 1.0), dr = std::fabs(std::sqrt(ar / er) - 1.0);
      schlimmst = std::max(schlimmst, std::max(dl, dr));
      std::printf("3: bild neutral at %.0f Hz: magnitude L %.3g, R %.3g off\n", f, dl, dr);
      PRUEF(x.ins->gr_db(x.g) == 0.0f);
    }
    PRUEF(schlimmst < 1e-5);
    PRUEF(anders);   // the stage ran: the allpass shifts the phase
    // the stage acts: breite_hoch 0 makes a 10 kHz side signal mono (S under -80 dB against the input)
    Modul y(ArrInsArt::bild);
    y.setze(5, 0.0f);
    double s_ein = 0.0, s_aus = 0.0;
    for (int blk = 0; blk < 300; ++blk) {
      for (int t = 0; t < Modul::M; ++t) {
        const double s = static_cast<double>(blk * Modul::M + t) / 48000.0;
        y.l[t] = static_cast<float>(0.3 * std::sin(2.0 * PI * 10000.0 * s));
        y.r[t] = -y.l[t];
      }
      if (blk >= 225)
        for (int t = 0; t < Modul::M; ++t) s_ein += 0.25 * static_cast<double>(y.l[t] - y.r[t]) * (y.l[t] - y.r[t]);
      y.block();
      if (blk >= 225)
        for (int t = 0; t < Modul::M; ++t) s_aus += 0.25 * static_cast<double>(y.l[t] - y.r[t]) * (y.l[t] - y.r[t]);
    }
    const double s_db = 10.0 * std::log10(std::max(s_aus, 1e-30) / s_ein);
    std::printf("3: breite_hoch 0 at 10 kHz: side %.1f dB against the input\n", s_db);
    PRUEF(s_db < -30.0);   // the mid band's LR4 skirt (4 kHz) still carries the side at 10 kHz: about -37 dB
  }

  {  // 4 tb_lader: chain entries of the two kinds and the saett pool end
    arrdatei::Ordner o("test_arr_inserts_trans_bild");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto grund = [&](int64_t nr, const std::string& chain, ArrInsArt art = ArrInsArt::leer, int slot = -1) {
      o.wiedergabe2_ret(nr, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"master\"}" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}", "", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      if (x.snap && slot >= 0) {
        const cdj::ArrKette& k = x.snap->kette[0];
        PRUEF(k.n == 1 && k.st[0].art == art && k.st[0].slot == slot && k.st[0].an);
        PRUEF((x.snap->pdc.gesamt) == (art == ArrInsArt::saett ? cdj::ins_latenz(ArrInsArt::saett) : 0));
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(grund(81, ",\"chain\":[{\"art\":\"trans\",\"slot\":33}]") == "format");
    PRUEF(grund(82, ",\"chain\":[{\"art\":\"trans\",\"slot\":32}]", ArrInsArt::trans, 31) == "+snap");
    PRUEF(grund(83, ",\"chain\":[{\"art\":\"bild\",\"slot\":16}]", ArrInsArt::bild, 15) == "+snap");
    PRUEF(grund(84, ",\"chain\":[{\"art\":\"bild\",\"slot\":17}]") == "format");
    PRUEF(grund(85, ",\"chain\":[{\"art\":\"trans\",\"slot\":1},{\"art\":\"trans\",\"slot\":1}]") == "format");
    PRUEF(grund(86, ",\"chain\":[{\"art\":\"bild\",\"slot\":1,\"latenz\":10}]") == "format");
    PRUEF(grund(87, ",\"chain\":[{\"art\":\"saett\",\"slot\":32}]", ArrInsArt::saett, 31) == "+snap");
    PRUEF(grund(88, ",\"chain\":[{\"art\":\"saett\",\"slot\":33}]") == "format");
    PRUEF(grund(89, ",\"chain\":[{\"art\":\"trans\",\"slot\":1},{\"art\":\"bild\",\"slot\":1}]") == "+snap");
  }

  {  // 5 tb_pool_pin
    PRUEF((cdj::ARR_INS_SAETT) == (32));
    PRUEF((cdj::ARR_INS_TRANS) == (32));
    PRUEF((cdj::ARR_INS_BILD) == (16));
    PRUEF((cdj::INS_TRANS_PARAM) == (6));
    PRUEF((cdj::INS_BILD_PARAM) == (7));
    PRUEF((static_cast<int>(ArrInsArt::trans)) == (10));   // stored in snapshots: never renumbered
    PRUEF((static_cast<int>(ArrInsArt::bild)) == (11));
    PRUEF((static_cast<int>(ArrInsArt::mb)) == (9));
    PRUEF((cdj::ins_latenz(ArrInsArt::trans)) == (0));
    PRUEF((cdj::ins_latenz(ArrInsArt::bild)) == (0));
    PRUEF((cdj::INS_G_TRANS0) == (cdj::INS_G_MB0 + cdj::ARR_INS_MB));
    PRUEF((cdj::INS_G_BILD0) == (cdj::INS_G_TRANS0 + cdj::ARR_INS_TRANS));
    PRUEF((cdj::INS_G_HOST0) == (cdj::INS_G_BILD0 + cdj::ARR_INS_BILD));
    PRUEF((g_trans) == (cdj::INS_G_TRANS0));
    PRUEF((g_bild) == (cdj::INS_G_BILD0));
    PRUEF((cdj::ins_global(ArrInsArt::trans, cdj::ARR_INS_TRANS)) == (-1));
    PRUEF((cdj::ins_global(ArrInsArt::bild, cdj::ARR_INS_BILD)) == (-1));
    PRUEF((cdj::ins_global(ArrInsArt::saett, cdj::ARR_INS_SAETT - 1)) == (cdj::INS_G_LIM0 - 1));
    PRUEF((cdj::ins_global(ArrInsArt::bild, cdj::ARR_INS_BILD - 1)) == (cdj::INS_G_HOST0 - 1));
    PRUEF((cdj::ins_art(cdj::INS_G_TRANS0)) == (ArrInsArt::trans));
    PRUEF((cdj::ins_art(cdj::INS_G_BILD0 - 1)) == (ArrInsArt::trans));
    PRUEF((cdj::ins_art(cdj::INS_G_BILD0)) == (ArrInsArt::bild));
    PRUEF((cdj::ins_art(cdj::INS_G_HOST0 - 1)) == (ArrInsArt::bild));
    PRUEF((cdj::ins_art(cdj::INS_G_TRANS0 - 1)) == (ArrInsArt::mb));     // negative controls: the neighbours are other kinds
    PRUEF((cdj::ins_art(cdj::INS_G_HOST0)) == (ArrInsArt::host));
    PRUEF((cdj::ins_art(cdj::INS_G_LIM0 - 1)) == (ArrInsArt::saett));
    PRUEF((cdj::ARR_INS_ALLE) == (456));                 // 160 + 160 + 32 + 8 + 8 + 8 + 16 + 8 + 32 + 16 + 8
    PRUEF((cdj::ArrSlotMaske::W) == (8));                // eight mask words (six before)
    // a chain with an eq, a trans and a bild: the delay compensation counts the eq only
    auto q = Audio::sinus(1000, 100.0, 0.1f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
    b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}, TRANS1, BILD1});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    PRUEF((s->pdc.gesamt) == (cdj::ins_latenz(ArrInsArt::eq)));
    delete s;
    // the table has the rows of every slot and none beyond
    cypherdj::stellwerk::ReglerTabelle tab;
    int nt = 0, nb = 0, ns = 0;
    for (int r = 0; r < tab.anzahl(); ++r) {
      if (std::strncmp(tab.def(r).pfad, "ins/trans/", 10) == 0) ++nt;
      if (std::strncmp(tab.def(r).pfad, "ins/bild/", 9) == 0) ++nb;
      if (std::strncmp(tab.def(r).pfad, "ins/saett/", 10) == 0) ++ns;
    }
    PRUEF((nt) == (cdj::INS_TRANS_PARAM * cdj::ARR_INS_TRANS));
    PRUEF((nb) == (cdj::INS_BILD_PARAM * cdj::ARR_INS_BILD));
    PRUEF((ns) == (cdj::INS_SAETT_PARAM * cdj::ARR_INS_SAETT));
    PRUEF(tab.suche("ins/trans/32/mix") >= 0 && tab.suche("ins/trans/33/an") < 0);
    PRUEF(tab.suche("ins/bild/16/mono_unter") >= 0 && tab.suche("ins/bild/17/an") < 0);
    PRUEF(tab.suche("ins/saett/32/decke") >= 0 && tab.suche("ins/saett/33/an") < 0);
    // the Arrangement binds the rows: a value set through the row reaches the stage (eff), for the last slot of each kind
    TR(t)
    setze(t, "ins/trans/32/an", 1.0f);
    setze(t, "ins/trans/32/angriff", 7.0f);
    setze(t, "ins/bild/16/an", 1.0f);
    setze(t, "ins/bild/16/mono_unter", 90.0f);
    setze(t, "ins/saett/32/an", 1.0f);
    setze(t, "ins/saett/32/drive", 5.0f);
    auto qs = Audio::sinus(400000, 100.0, 0.1f);
    spiele(t, spur1(&qs->a, {ArrStufe{ArrInsArt::trans, 31, true}, ArrStufe{ArrInsArt::bild, 15, true}, ArrStufe{ArrInsArt::saett, 31, true}}), 120000);
    const int gt = cdj::ins_global(ArrInsArt::trans, 31), gb = cdj::ins_global(ArrInsArt::bild, 15), gs = cdj::ins_global(ArrInsArt::saett, 31);
    PRUEF(t.arr.inserts().lief(gt) && t.arr.inserts().lief(gb) && t.arr.inserts().lief(gs));
    PRUEF((t.arr.inserts().wirksam(gt, 1)) == (7.0f));
    PRUEF((t.arr.inserts().wirksam(gb, 6)) == (90.0f));
    PRUEF((t.arr.inserts().wirksam(gs, 1)) == (5.0f));
    PRUEF((t.arr.inserts().wirksam(gt, 3)) == (15.0f));   // the defaults of the contract
    PRUEF((t.arr.inserts().wirksam(gb, 2)) == (4000.0f));
    std::printf("5: trans rows %d, bild rows %d, saett rows %d, trans0 %d, bild0 %d, host0 %d, ARR_INS_ALLE %d, mask words %d, sizeof(ArrInserts) %zu, sizeof(Arrangement) %zu\n", nt, nb, ns,
                cdj::INS_G_TRANS0, cdj::INS_G_BILD0, cdj::INS_G_HOST0, cdj::ARR_INS_ALLE, cdj::ArrSlotMaske::W, sizeof(cdj::ArrInserts), sizeof(cdj::Arrangement));
  }

  {  // 6 tb_ruhe_einmal: a trans + bild chain plays, stops, the quiet path runs for 300 blocks, three times over (the pattern of test_arr_inserts_dyn case 6). Each run starts at
     // grenze_tief 150 and moves it to 300 while it plays (the imager's crossfade of two filter sets). Runs 2 and 3 are bit-equal, aligned at their first sounding sample: whatever
     // ruhe() and leere() must reset of the transient shaper (envelopes, gain) and the imager (filters, ramps, crossfade, mono stage) is reset.
    auto q = stoesse(400000);
    TR(x)
    setze(x, "ins/trans/1/an", 1.0f);
    setze(x, "ins/trans/1/angriff", 9.0f);
    setze(x, "ins/trans/1/halten", -6.0f);
    setze(x, "ins/bild/1/an", 1.0f);
    setze(x, "ins/bild/1/breite_mitte", 1.5f);
    setze(x, "ins/bild/1/mono_unter", 80.0f);
    constexpr int64_t SPIEL = 150000, RUHE = 300 * 256, ZUG = 30000, LANG = 70000, PERIODE = 1440000;
    static_assert(PERIODE % 90000 == 0 && PERIODE % 256 == 0, "a whole number of bars and of blocks");
    int64_t ein[4] = {-1, -1, -1, -1};
    bool ruhe_lief = true;
    for (int lauf = 1; lauf <= 3; ++lauf) {
      const int64_t s0 = x.s;
      setze(x, "ins/bild/1/grenze_tief", 150.0f);
      x.laden(spur1(&q->a, {TRANS1, BILD1}, lauf));
      x.arr.start(0.0, 2, false, x.s, V, 256, x.k);
      while (ein[lauf] < 0 && x.s < s0 + SPIEL) {
        const int64_t b0 = x.s;
        x.lauf(x.s + 256);
        for (int64_t i = b0; i < x.s && ein[lauf] < 0; ++i)
          if (x.pml[i] != 0.0f) ein[lauf] = i;
      }
      if (ein[lauf] < 0) break;
      x.lauf(ein[lauf] + ZUG);
      setze(x, "ins/bild/1/grenze_tief", 300.0f);
      x.lauf(ein[lauf] + LANG + 2560);
      x.arr.stopp(0, x.s, x.k);
      x.lauf(x.s + 2560);
      x.laden(nullptr);
      const uint64_t r0 = x.arr.ruhe_zaehler();
      x.lauf(std::max(x.s + RUHE, lauf * PERIODE));
      ruhe_lief = ruhe_lief && x.arr.ruhe_zaehler() - r0 >= 290 && x.s == lauf * PERIODE;
    }
    const int64_t lang = LANG;
    std::printf("6: quiet blocks %llu, entries %lld %lld %lld, peak %.3f\n", static_cast<unsigned long long>(x.arr.ruhe_zaehler()), static_cast<long long>(ein[1]),
                static_cast<long long>(ein[2]), static_cast<long long>(ein[3]), ein[3] > 0 ? spitze(x.pml, ein[3], ein[3] + LANG) : 0.0);
    for (int64_t i = 0; i < lang && ein[3] > 0; ++i)
      if (x.pml[ein[2] + i] != x.pml[ein[3] + i]) {
        std::printf("6: runs 2 and 3 first differ at onset + %lld: %.9g against %.9g\n", static_cast<long long>(i), x.pml[ein[2] + i], x.pml[ein[3] + i]);
        break;
      }
    PRUEF(ruhe_lief);
    PRUEF(ein[2] > 0 && ein[3] > ein[2]);
    PRUEF((ein[3] - ein[2]) % 256 == 0);
    PRUEF(ein[3] > 0 && spitze(x.pml, ein[3], ein[3] + LANG) > 0.05);
    PRUEF(gleich_bits_versetzt(x.pml, ein[2], ein[2] + lang, ein[3] - ein[2]));
    PRUEF(gleich_bits_versetzt(x.l, ein[2], ein[2] + lang, ein[3] - ein[2]));
    PRUEF(gleich_bits_versetzt(x.r, ein[2], ein[2] + lang, ein[3] - ein[2]));
  }

  {  // 7 tb_nan: a NaN in the input of the stage (the modules would count it as 0 and hide it): the block is silent, counted once, the stage is cleared and plays again
    for (ArrInsArt art : {ArrInsArt::trans, ArrInsArt::bild}) {
      Modul x(art);
      if (art == ArrInsArt::trans) x.setze(1, 12.0f);
      double ph = 0.0, nach = 0.0;
      bool still = false;
      for (int blk = 0; blk < 120; ++blk) {
        for (int t = 0; t < Modul::M; ++t) {
          x.l[t] = x.r[t] = 0.3f * static_cast<float>(std::sin(ph));
          ph += 2.0 * PI * 1000.0 / 48000.0;
        }
        if (blk == 60) x.l[5] = std::nanf("");
        x.block();
        if (blk == 60) {
          still = true;
          for (int t = 0; t < Modul::M; ++t) still = still && x.l[t] == 0.0f && x.r[t] == 0.0f;
        }
        if (blk == 119) nach = db(rms(x.l, 0, Modul::M));
      }
      std::printf("7: NaN in front of %s: block silent %d, counted %llu, level after %.2f dBFS\n", art == ArrInsArt::trans ? "trans" : "bild", still ? 1 : 0,
                  static_cast<unsigned long long>(x.ins->nan_zaehler()), nach);
      PRUEF(still);
      PRUEF(x.ins->nan_zaehler() == 1);
      PRUEF(nach > -15.0);
    }
  }

  PRUEF_ENDE();
}
