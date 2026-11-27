// Strand 1 (pool) slice 4: the insert kinds `gate` (pool 16, the 1.15 noise gate) and `mb` (pool 8, the 1.15 three-band multiband compressor), 0 samples of latency each.
// One track, 48 kHz, blocks of 256. Levels are read from the production master (PM tap); windows start at the onset of the reference run (the start is quantised to the next bar).
// Cases: 1 gate_zu_auf (-60 dBFS under the threshold -40 is closed: below -100 dBFS after 0.5 s, gr > 60 dB; -20 dBFS is open: within 0.01 dB of the reference, gr < 0.1),
// 2 mb_neutral (every band at ratio 1: the RMS of a pink-ish noise equals the reference within 0.05 dB, the crossover sum is an allpass),
// 3 mb_grenze_ohne_sprung (grenze_tief 200 -> 400 under a 100 Hz sine: no sample step above 0.05 across the change; the change takes effect: a 400 Hz sine falls into the low band
//   with makeup -24 dB when grenze_tief moves 200 -> 800), 4 dyn_lader (gate slot 17 and mb slot 9 are refused, gate 16 and mb 8 load),
// 5 dyn_pool_pin (pool constants, global order komp, eq, saett, lim, utility, bk, gate, mb, host; latency 0; table rows),
// 6 dyn_ruhe_einmal (a gate + mb chain with a crossover move plays, stops, the quiet path runs 300 blocks, three times: runs 2 and 3 are bit-equal).
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
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr int64_t HALB = 24000;   // 0.5 s
static constexpr int64_t FENSTER = 12000;

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
static double groesster_schritt(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[i] - v[i - 1])));
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
// pink-ish noise (white through a one-pole low-pass, plus a little white), fixed seed, peak about 0.3
static std::unique_ptr<Audio> rauschen(int64_t frames) {
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  uint32_t z = 12345u;
  double tl = 0.0, tr = 0.0;
  auto weiss = [&]() {
    z = z * 1664525u + 1013904223u;
    return static_cast<double>(z >> 8) / static_cast<double>(1u << 24) * 2.0 - 1.0;
  };
  for (int64_t f = 0; f < frames; ++f) {
    const double wl = weiss(), wr = weiss();
    tl = 0.98 * tl + 0.02 * wl * 6.0;
    tr = 0.98 * tr + 0.02 * wr * 6.0;
    x->d[2 * f] = static_cast<float>(0.15 * tl + 0.03 * wl);
    x->d[2 * f + 1] = static_cast<float>(0.15 * tr + 0.03 * wr);
  }
  x->fuellen(frames);
  return x;
}
// 1 kHz sine whose level alternates every 6000 frames between 0.1 (-20 dBFS) and 0.001 (-60 dBFS): opens and closes a gate at -40
static std::unique_ptr<Audio> stufen(int64_t frames) {
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f) {
    const float a = (f / 6000) % 2 == 0 ? 0.1f : 0.001f;
    x->d[2 * f] = x->d[2 * f + 1] = a * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * 1000.0 * static_cast<double>(f) / 48000.0));
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
static const ArrStufe GATE1{ArrInsArt::gate, 0, true};
static const ArrStufe MB1{ArrInsArt::mb, 0, true};

// Cases 7..10: one stage of the pool on its own (ArrInserts, strip 0, blocks of 256), rows bound and set by hand
struct Modul {
  static constexpr int M = 256;
  std::unique_ptr<cdj::ArrInserts> ins = std::make_unique<cdj::ArrInserts>();
  std::unique_ptr<cdj::ArrKette[]> ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
  int g;
  float l[M] = {}, r[M] = {};
  explicit Modul(ArrInsArt art) : g(cdj::ins_global(art, 0)) {
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{art, 0, true};
  }
  void setze(int p, float v) {
    ins->binde(g, p, v);
    ins->setze_sofort(g, p, v);
  }
  void mb_neutral() {   // an, grenze_tief 200, grenze_hoch 2000, every band at ratio 1 (schwelle, ratio, attack, release, knie, makeup, umgehen)
    setze(0, 1.0f);
    setze(1, 200.0f);
    setze(2, 2000.0f);
    for (int b = 0; b < 3; ++b) {
      const float d[7] = {0.0f, 1.0f, 10.0f, 100.0f, 0.0f, 0.0f, 0.0f};
      for (int k = 0; k < 7; ++k) setze(3 + b * 7 + k, d[k]);
    }
  }
  void gate_vorgabe(float attack, float bereich) {   // off, schwelle -40, hysterese 4, ratio 100, bereich, attack, hold 20, release 100
    const float d[8] = {0.0f, -40.0f, 4.0f, 100.0f, bereich, attack, 20.0f, 100.0f};
    for (int k = 0; k < 8; ++k) setze(k, d[k]);
  }
  void sinus(double& ph, double f, float a) {
    for (int t = 0; t < M; ++t) {
      l[t] = r[t] = a * static_cast<float>(std::sin(ph));
      ph += 2.0 * 3.14159265358979323846 * f / 48000.0;
    }
  }
  void block() {
    if (!getauscht) ins->tausche(ketten.get());
    getauscht = true;
    ins->kette(0, &ketten[0], l, r, M);
    ins->nachfuehren(M);
  }
  double rms() const {
    double q = 0.0;
    for (int t = 0; t < M; ++t) q += static_cast<double>(l[t]) * l[t];
    return std::sqrt(q / M);
  }
  bool getauscht = false;
};

int main() {
  const int g_gate = cdj::ins_global(ArrInsArt::gate, 0);
  const int g_mb = cdj::ins_global(ArrInsArt::mb, 0);
  PRUEF(g_gate >= 0 && g_mb >= 0);

  {  // 1 gate_zu_auf
    auto leise = Audio::sinus(400000, 1000.0, 0.001f);   // -60 dBFS peak
    auto laut = Audio::sinus(400000, 1000.0, 0.1f);      // -20 dBFS peak
    TR(ref_l) TR(ref_h) TR(zu) TR(auf)
    spiele(ref_l, spur1(&leise->a, {}), 160000);
    spiele(ref_h, spur1(&laut->a, {}), 160000);
    const int64_t e0 = einsatz(ref_h.pml);
    PRUEF(e0 > 0 && e0 + HALB + FENSTER < 160000);
    setze(zu, "ins/gate/1/an", 1.0f);
    setze(zu, "ins/gate/1/schwelle", -40.0f);
    spiele(zu, spur1(&leise->a, {GATE1}), e0 + HALB + FENSTER);
    setze(auf, "ins/gate/1/an", 1.0f);
    setze(auf, "ins/gate/1/schwelle", -40.0f);
    spiele(auf, spur1(&laut->a, {GATE1}), e0 + HALB + FENSTER);
    const int64_t a = e0 + HALB, b = a + FENSTER;
    const double zu_db = db(spitze(zu.pml, a, b)), ref_l_db = db(spitze(ref_l.pml, a, b));
    const double d_auf = db(rms(auf.pml, a, b)) - db(rms(ref_h.pml, a, b));
    std::printf("1: closed: peak %.1f dBFS (reference %.1f), gr %.2f dB; open: %+.5f dB against the reference, gr %.4f dB\n", zu_db, ref_l_db, zu.arr.inserts().gr_db(g_gate), d_auf,
                auf.arr.inserts().gr_db(g_gate));
    PRUEF(ref_l_db > -70.0);                              // negative control: the quiet signal is there without the gate
    PRUEF(zu_db < -100.0);
    PRUEF(zu.arr.inserts().gr_db(g_gate) > 60.0f);
    PRUEF(std::fabs(d_auf) < 0.01);
    PRUEF(auf.arr.inserts().gr_db(g_gate) < 0.1f);
    PRUEF(auf.arr.inserts().lief(g_gate) && zu.arr.inserts().lief(g_gate));
  }

  {  // 2 mb_neutral: ratio 1 on every band (the defaults); the sum of the three bands is an allpass
    auto q = rauschen(400000);
    TR(ref) TR(n)
    spiele(ref, spur1(&q->a, {}), 240000);
    const int64_t e0 = einsatz(ref.pml);
    PRUEF(e0 > 0 && e0 + HALB + 10 * FENSTER < 240000);
    setze(n, "ins/mb/1/an", 1.0f);
    spiele(n, spur1(&q->a, {MB1}), 240000);
    const int64_t a = e0 + HALB, b = a + 10 * FENSTER;   // 2.5 s of noise: the RMS of an allpass output converges to the input's
    const double d = db(rms(n.pml, a, b)) - db(rms(ref.pml, a, b));
    bool anders = false;
    for (int64_t i = a; i < b && !anders; ++i) anders = n.pml[i] != ref.pml[i];
    std::printf("2: mb neutral: RMS %+.4f dB against the reference (%.1f dBFS), the waveform differs: %d\n", d, db(rms(ref.pml, a, b)), anders ? 1 : 0);
    PRUEF(std::fabs(d) < 0.05);
    PRUEF(anders);                                        // the stage really ran (the allpass shifts the phase)
    PRUEF(n.arr.inserts().lief(g_mb));
    PRUEF(n.arr.inserts().gr_db(g_mb) < 0.01f);
  }

  {  // 3 mb_grenze_ohne_sprung
    auto q = Audio::sinus(400000, 100.0, 0.5f);
    TR(ref) TR(x)
    spiele(ref, spur1(&q->a, {}), 160000);
    const int64_t e0 = einsatz(ref.pml);
    setze(x, "ins/mb/1/an", 1.0f);
    spiele(x, spur1(&q->a, {MB1}), e0 + HALB);
    const int64_t w = x.s;                                // the change block starts here
    setze(x, "ins/mb/1/grenze_tief", 400.0f);
    x.lauf(w + 8192);
    const double natur = groesster_schritt(ref.pml, w - 2048, w + 4096);
    const double sprung = groesster_schritt(x.pml, w - 2048, w + 4096);
    const double vorher = spitze(x.pml, w - 4800, w), nachher = spitze(x.pml, w + 2400, w + 7200);
    std::printf("3: crossover 200 -> 400 Hz at %lld: largest step %.5f (reference %.5f), peak before %.4f after %.4f\n", static_cast<long long>(w), sprung, natur, vorher, nachher);
    PRUEF(sprung <= 0.05);
    PRUEF(std::fabs(db(nachher / vorher)) < 0.1);         // the allpass sum keeps the level after the move
    // the move takes effect: band 1 (low) at makeup -24 dB; a 400 Hz sine is in the mid band at grenze_tief 200 and in the low band at 800
    auto q4 = Audio::sinus(400000, 400.0, 0.5f);
    TR(y)
    setze(y, "ins/mb/1/an", 1.0f);
    setze(y, "ins/mb/1/b1/makeup", -24.0f);
    spiele(y, spur1(&q4->a, {MB1}), e0 + HALB);
    const int64_t w2 = y.s;
    setze(y, "ins/mb/1/grenze_tief", 800.0f);
    y.lauf(w2 + HALB);
    const double vor = rms(y.pml, w2 - FENSTER, w2), nach = rms(y.pml, w2 + HALB - FENSTER, w2 + HALB);
    std::printf("3: 400 Hz with the low band at -24 dB: crossover 200 Hz %.1f dBFS, 800 Hz %.1f dBFS, largest step %.5f\n", db(vor), db(nach), groesster_schritt(y.pml, w2 - 256, w2 + 4096));
    PRUEF(db(vor / nach) > 20.0);
    PRUEF(groesster_schritt(y.pml, w2 - 256, w2 + 4096) <= 0.05);
  }

  {  // 4 dyn_lader: chain entries of the two kinds, the pool ends
    arrdatei::Ordner o("test_arr_inserts_dyn");
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
        PRUEF((x.snap->pdc.gesamt) == (0));
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    PRUEF(grund(81, ",\"chain\":[{\"art\":\"gate\",\"slot\":17}]") == "format");
    PRUEF(grund(82, ",\"chain\":[{\"art\":\"mb\",\"slot\":8}]", ArrInsArt::mb, 7) == "+snap");
    PRUEF(grund(83, ",\"chain\":[{\"art\":\"gate\",\"slot\":16}]", ArrInsArt::gate, 15) == "+snap");
    PRUEF(grund(84, ",\"chain\":[{\"art\":\"mb\",\"slot\":9}]") == "format");
    PRUEF(grund(85, ",\"chain\":[{\"art\":\"gate\",\"slot\":1},{\"art\":\"gate\",\"slot\":1}]") == "format");
    PRUEF(grund(86, ",\"chain\":[{\"art\":\"mb\",\"slot\":1,\"latenz\":10}]") == "format");
  }

  {  // 5 dyn_pool_pin
    PRUEF((cdj::ARR_INS_GATE) == (16));
    PRUEF((cdj::ARR_INS_MB) == (8));
    PRUEF((cdj::ARR_INS_LIM) == (8));
    PRUEF((cdj::INS_GATE_PARAM) == (8));
    PRUEF((cdj::INS_MB_PARAM) == (24));
    PRUEF((cdj::ins_latenz(ArrInsArt::gate)) == (0));
    PRUEF((cdj::ins_latenz(ArrInsArt::mb)) == (0));
    PRUEF((cdj::INS_G_GATE0) == (cdj::INS_G_BK0 + cdj::ARR_INS_BK));
    PRUEF((cdj::INS_G_MB0) == (cdj::INS_G_GATE0 + cdj::ARR_INS_GATE));
    PRUEF((cdj::INS_G_HOST0) == (cdj::INS_G_MB0 + cdj::ARR_INS_MB));
    PRUEF((g_gate) == (cdj::INS_G_GATE0));
    PRUEF((g_mb) == (cdj::INS_G_MB0));
    PRUEF((cdj::ins_global(ArrInsArt::gate, cdj::ARR_INS_GATE)) == (-1));
    PRUEF((cdj::ins_global(ArrInsArt::mb, cdj::ARR_INS_MB)) == (-1));
    PRUEF((cdj::ins_global(ArrInsArt::mb, cdj::ARR_INS_MB - 1)) == (cdj::INS_G_HOST0 - 1));
    PRUEF((cdj::ins_art(cdj::INS_G_GATE0)) == (ArrInsArt::gate));
    PRUEF((cdj::ins_art(cdj::INS_G_MB0 - 1)) == (ArrInsArt::gate));
    PRUEF((cdj::ins_art(cdj::INS_G_MB0)) == (ArrInsArt::mb));
    PRUEF((cdj::ins_art(cdj::INS_G_HOST0 - 1)) == (ArrInsArt::mb));
    PRUEF((cdj::ins_art(cdj::INS_G_GATE0 - 1)) == (ArrInsArt::bk));      // negative controls: the neighbours are other kinds
    PRUEF((cdj::ins_art(cdj::INS_G_HOST0)) == (ArrInsArt::host));
    PRUEF((cdj::ARR_INS_ALLE) == (380));                 // 160 + 160 + 4 + 8 + 8 + 8 + 16 + 8 + 8 (eight hosts since strand 1 slice 5)
    // a chain with an eq, a gate and an mb: the delay compensation counts the eq only
    auto q = Audio::sinus(1000, 100.0, 0.1f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a);
    b.kette(1, {ArrStufe{ArrInsArt::eq, 0, true}, GATE1, MB1});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    PRUEF((s->pdc.gesamt) == (cdj::ins_latenz(ArrInsArt::eq)));
    delete s;
    // the table has the rows of every slot and none beyond, in the order of the roles
    cypherdj::stellwerk::ReglerTabelle tab;
    int ng = 0, nm = 0;
    for (int r = 0; r < tab.anzahl(); ++r) {
      if (std::strncmp(tab.def(r).pfad, "ins/gate/", 9) == 0) ++ng;
      if (std::strncmp(tab.def(r).pfad, "ins/mb/", 7) == 0) ++nm;
    }
    PRUEF((ng) == (cdj::INS_GATE_PARAM * cdj::ARR_INS_GATE));
    PRUEF((nm) == (cdj::INS_MB_PARAM * cdj::ARR_INS_MB));
    PRUEF(tab.suche("ins/gate/16/release") >= 0 && tab.suche("ins/gate/17/an") < 0);
    PRUEF(tab.suche("ins/mb/8/b3/umgehen") >= 0 && tab.suche("ins/mb/9/an") < 0);
    PRUEF(tab.suche("ins/lim/8/an") >= 0 && tab.suche("ins/lim/9/an") < 0);
    std::printf("5: gate rows %d, mb rows %d, gate0 %d, mb0 %d, host0 %d, ARR_INS_ALLE %d\n", ng, nm, cdj::INS_G_GATE0, cdj::INS_G_MB0, cdj::INS_G_HOST0, cdj::ARR_INS_ALLE);
  }

  {  // 6 dyn_ruhe_einmal: a gate + mb chain plays, stops, the quiet path runs for 300 blocks, three times over. Each run starts at grenze_tief 200 and moves it to 300 while it plays (a crossfade
     // to the other multiband object). Runs 2 and 3 are bit-equal, aligned at their first sounding sample: whatever ruhe() and leere() must reset of the gate, both multiband objects and the
     // crossover state is reset, although run 2 and run 3 start on different objects.
    auto q = stufen(400000);
    TR(x)
    setze(x, "ins/gate/1/an", 1.0f);
    setze(x, "ins/gate/1/schwelle", -40.0f);
    setze(x, "ins/mb/1/an", 1.0f);
    setze(x, "ins/mb/1/b2/schwelle", -30.0f);
    setze(x, "ins/mb/1/b2/ratio", 4.0f);
    // The move lands on a block boundary, so the runs must sit on the same block grid relative to their onset: the onset is on the bar grid (90000 samples), the blocks are 256,
    // so every run starts PERIODE = lcm(90000, 256) = 1 440 000 samples after the one before (the quiet stretch fills the rest; it is far more than 300 blocks).
    constexpr int64_t SPIEL = 150000, RUHE = 300 * 256, ZUG = 30000, LANG = 70000, PERIODE = 1440000;   // the move at onset + ZUG, compared over onset .. onset + LANG
    static_assert(PERIODE % 90000 == 0 && PERIODE % 256 == 0, "a whole number of bars and of blocks");
    int64_t ein[4] = {-1, -1, -1, -1};
    bool ruhe_lief = true;
    for (int lauf = 1; lauf <= 3; ++lauf) {
      const int64_t s0 = x.s;
      setze(x, "ins/mb/1/grenze_tief", 200.0f);
      x.laden(spur1(&q->a, {GATE1, MB1}, lauf));
      x.arr.start(0.0, 2, false, x.s, V, 256, x.k);
      while (ein[lauf] < 0 && x.s < s0 + SPIEL) {
        const int64_t b0 = x.s;
        x.lauf(x.s + 256);
        for (int64_t i = b0; i < x.s && ein[lauf] < 0; ++i)
          if (x.pml[i] != 0.0f) ein[lauf] = i;
      }
      if (ein[lauf] < 0) break;
      x.lauf(ein[lauf] + ZUG);
      setze(x, "ins/mb/1/grenze_tief", 300.0f);
      x.lauf(ein[lauf] + LANG + 2560);
      x.arr.stopp(0, x.s, x.k);
      x.lauf(x.s + 2560);
      x.laden(nullptr);
      const uint64_t r0 = x.arr.ruhe_zaehler();
      x.lauf(std::max(x.s + RUHE, lauf * PERIODE));
      ruhe_lief = ruhe_lief && x.arr.ruhe_zaehler() - r0 >= 290 && x.s == lauf * PERIODE;
    }
    const int64_t lang = LANG;
    std::printf("6: quiet blocks %llu, entries %lld %lld %lld, peak %.3f, gr %.2f\n", static_cast<unsigned long long>(x.arr.ruhe_zaehler()), static_cast<long long>(ein[1]),
                static_cast<long long>(ein[2]), static_cast<long long>(ein[3]), ein[3] > 0 ? spitze(x.pml, ein[3], ein[3] + LANG) : 0.0, x.arr.inserts().gr_db(g_mb));
    for (int64_t i = 0; i < lang && ein[3] > 0; ++i)
      if (x.pml[ein[2] + i] != x.pml[ein[3] + i]) {
        std::printf("6: runs 2 and 3 first differ at onset + %lld: %.9g against %.9g\n", static_cast<long long>(i), x.pml[ein[2] + i], x.pml[ein[3] + i]);
        break;
      }
    PRUEF(ruhe_lief);
    PRUEF(ein[2] > 0 && ein[3] > ein[2]);
    PRUEF((ein[3] - ein[2]) % 256 == 0);                  // the same block grid relative to the onset
    PRUEF(ein[3] > 0 && spitze(x.pml, ein[3], ein[3] + LANG) > 0.01);
    PRUEF(gleich_bits_versetzt(x.pml, ein[2], ein[2] + lang, ein[3] - ein[2]));
    PRUEF(gleich_bits_versetzt(x.l, ein[2], ein[2] + lang, ein[3] - ein[2]));
    PRUEF(gleich_bits_versetzt(x.r, ein[2], ein[2] + lang, ein[3] - ein[2]));
  }

  {  // 7 mb_grenze_sweep: grenze_tief moves +1 Hz per block over 200 blocks (an automation lane, a macro, a knob ramp) under a 150 Hz sine with neutral bands. Every move under a running
     // stage needs a crossfade to the second object; that object must be warm when it is heard (a cold one dipped a block by 9 dB). No block may lie more than 2 dB under the block before the sweep.
    Modul x(ArrInsArt::mb);
    x.mb_neutral();
    double ph = 0.0, vor = 0.0, tiefst = 0.0;
    for (int blk = 0; blk < 400; ++blk) {
      if (blk >= 100 && blk < 300) x.setze(1, 200.0f + static_cast<float>(blk - 99));
      x.sinus(ph, 150.0, 0.3f);
      x.block();
      const double d = db(x.rms());
      if (blk == 99) vor = d;
      if (blk >= 100) tiefst = std::min(tiefst, d - vor);
    }
    std::printf("7: crossover sweep 200 -> 400 Hz, +1 Hz per block: block before %.2f dBFS, deepest block %+.2f dB against it\n", vor, tiefst);
    PRUEF(vor > -15.0);
    PRUEF(tiefst > -2.0);
    // the sweep arrives: band 1 (low) at makeup -24 dB, a 300 Hz sine is in the mid band at grenze_tief 200 and in the low band at the end of the sweep (400)
    Modul y(ArrInsArt::mb);
    y.mb_neutral();
    y.setze(3 + 5, -24.0f);
    double ph2 = 0.0, anfang = 0.0;
    for (int blk = 0; blk < 400; ++blk) {
      if (blk >= 100 && blk < 300) y.setze(1, 200.0f + static_cast<float>(blk - 99));
      y.sinus(ph2, 300.0, 0.3f);
      y.block();
      if (blk == 99) anfang = db(y.rms());
    }
    Modul z(ArrInsArt::mb);   // the control: grenze_tief 400 from the start
    z.mb_neutral();
    z.setze(3 + 5, -24.0f);
    z.setze(1, 400.0f);
    double ph3 = 0.0;
    for (int blk = 0; blk < 400; ++blk) {
      z.sinus(ph3, 300.0, 0.3f);
      z.block();
    }
    std::printf("7: 300 Hz with the low band at -24 dB: before the sweep %.2f dBFS, after it %.2f dBFS, at 400 Hz from the start %.2f dBFS\n", anfang, db(y.rms()), db(z.rms()));
    PRUEF(anfang - db(y.rms()) > 15.0);
    PRUEF(std::fabs(db(y.rms()) - db(z.rms())) < 0.1);   // the last target of the sweep is in effect
  }

  {  // 8 gate_start_offen: the gate is switched on (an 0 -> 1) under a steady -10 dBFS sine, attack 200 ms. Like the mixer's gate it starts OPEN, so the first block plays the input.
    Modul x(ArrInsArt::gate);
    x.gate_vorgabe(200.0f, -80.0f);
    double ph = 0.0, d1 = -200.0;
    for (int blk = 0; blk < 110; ++blk) {
      if (blk == 100) x.setze(0, 1.0f);
      x.sinus(ph, 1000.0, 0.316f);
      const double ein = db(x.rms());
      x.block();
      if (blk == 100) d1 = db(x.rms()) - ein;
    }
    std::printf("8: gate switched on under -10 dBFS, attack 200 ms: first block %+.2f dB against the input\n", d1);
    PRUEF(std::fabs(d1) < 1.0);
    // the stage levels (/e/stufe_pegel) are measured for the gate as for komp and lim: about -10 dBFS in and out, not the -200 of a kind that never measures
    const float pe = x.ins->pegel_ein_db(x.g), pa = x.ins->pegel_aus_db(x.g);
    std::printf("8: stage levels in %.2f, out %.2f dBFS\n", pe, pa);
    PRUEF(std::fabs(pe + 10.0f) < 0.5f && std::fabs(pa + 10.0f) < 0.5f);
  }

  {  // 9 mb_nan_im_wechsel: a NaN in the block that changes the crossover. After the reset the new crossover must be in effect: band 1 (low) at makeup -24 dB, a 1 kHz sine falls into
     // it when grenze_tief moves 200 -> 5000, so the end level equals the control run without the NaN.
    double ende[2] = {0.0, 0.0};
    uint64_t nan[2] = {0, 0};
    for (int mit_nan = 0; mit_nan < 2; ++mit_nan) {
      Modul x(ArrInsArt::mb);
      x.mb_neutral();
      x.setze(3 + 5, -24.0f);
      double ph = 0.0;
      for (int blk = 0; blk < 300; ++blk) {
        x.sinus(ph, 1000.0, 0.3f);
        if (blk == 100) {
          x.setze(1, 5000.0f);
          if (mit_nan) x.l[5] = std::nanf("");
        }
        x.block();
      }
      ende[mit_nan] = db(x.rms());
      nan[mit_nan] = x.ins->nan_zaehler();
      PRUEF(x.ins->pegel_ein_db(x.g) > -11.0f && x.ins->pegel_aus_db(x.g) > -40.0f);   // the stage levels of an mb stage are measured (0.3 peak in, the low band at -24 out)
    }
    std::printf("9: crossover 200 -> 5000 Hz under 1 kHz: control %.2f dBFS, NaN in the change block %.2f dBFS (NaN counted %llu)\n", ende[0], ende[1], static_cast<unsigned long long>(nan[1]));
    PRUEF(nan[0] == 0 && nan[1] == 1);
    PRUEF(ende[0] < -25.0);                                // the control: the crossover moved, the sine is in the low band
    PRUEF(std::fabs(ende[1] - ende[0]) < 0.5);
  }

  {  // 10 gate_gr_boden: bereich -120 closes the gate fully (gain 0); the reported reduction is the range, not the -200 dB of a zero gain
    Modul x(ArrInsArt::gate);
    x.gate_vorgabe(1.0f, -120.0f);
    x.setze(0, 1.0f);
    double ph = 0.0;
    for (int blk = 0; blk < 200; ++blk) {
      x.sinus(ph, 1000.0, 0.0001f);   // -80 dBFS, under the threshold -40: the gate closes after hold and release
      x.block();
    }
    const float gr = x.ins->gr_db(x.g);
    std::printf("10: gate closed at bereich -120: gr %.2f dB, output %.1f dBFS\n", gr, db(x.rms()));
    PRUEF(gr > 100.0f);
    PRUEF(gr <= 120.0f);
  }

  PRUEF_ENDE();
}
