// Strand 6 task 3.1 (plan 2026-11-27, D12): the envelope follower in the core. Source = the raw signal of a track (before its fader), one block of latency, peak follower with attack and
// release, output clamp((dBFS(env) + 60 + empfindlich_db) / 60, 0, 1), unipolar on every target. Measured on the fader course of a second track (auto_buf_ through the friend struct) and
// on the master level of that track's constant clip. The source track's own fader is at -200 dB: what the follower hears is the signal before the fader.
//   1. a burst (0.5 for 4800 samples, then silence): the output rises with the attack (reaches 1 - 1/e of the -6 dBFS step after one attack time constant plus one block), holds the
//      steady value (-6.02 + 60) / 60, falls with the release (8.686 dB per time constant), and is exactly 0 once the envelope is below -60 dBFS; mod_ausgang reports 2 * out - 1.
//   2. a sustained source with empfindlich_db +24 (output clamps at 1): the second track's master level is base + tiefe within 0.05 dB.
//   3. two runs give the same course bit for bit.
//   4. a snapshot swap with the same nr and art keeps the envelope (D11): the block after the swap continues on the steady value, it does not restart from silence.
//   5. the reader: a follower playback is read (uni forced true, defaults), and its refusals.
//   6. no allocation, no lock in 2000 blocks with a follower and a swap (alloc_intercept.h), positive control.
//   7. a source track whose chain could run inside its track unit (an intern track with an insert and a trim of -24 dB): the follower still hears the signal before trim and chain,
//      as in mischen() and in the export (the track is kept out of the unit); a second such track without a follower does run its chain in the unit (the control).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

namespace cdj {
struct ArrPruefZugang {
  static const float* buf(const Arrangement& a, int i, int f) { return a.auto_buf_[i][f]; }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using Z = cdj::ArrPruefZugang;

namespace {
constexpr int64_t V = 537;
constexpr double MITTE = 0.70710677;
constexpr int64_t BURST = 4800;
constexpr int N = 256;

double db_von(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }

std::unique_ptr<Audio> burst(int64_t frames, int64_t an, float wert = 0.5f) {
  auto x = std::make_unique<Audio>();
  x->d.assign(static_cast<size_t>(frames) * 2, 0.0f);
  for (int64_t f = 0; f < an; ++f) x->d[2 * f] = x->d[2 * f + 1] = wert;
  x->fuellen(frames);
  return x;
}

cdj::ArrMod folger(int nr, int quelle, float tiefe, float angriff = 5.0f, float abfall = 150.0f, float empf = 0.0f) {
  cdj::ArrMod md{};
  md.nr = static_cast<uint8_t>(nr);
  md.art = 1;
  md.quelle = static_cast<int16_t>(quelle);
  md.angriff_ms = angriff;
  md.abfall_ms = abfall;
  md.empfindlich_db = empf;
  md.glatt_ms = 0.0f;   // no smoothing: the fader course is base + tiefe * out exactly
  cdj::ArrModZiel z{};
  z.art = 0;
  z.slot = 1;   // track 2
  z.feld = cdj::ARR_AUTO_FADER;
  z.tiefe = tiefe;
  z.uni = true;
  z.puffer = 0;
  md.z[md.n++] = z;
  return md;
}

struct Szene {
  std::unique_ptr<Audio> quelle_au, ziel_au = Audio::gleich(2400000);
  std::unique_ptr<Treiber> tp = std::make_unique<Treiber>();
  Treiber& t = *tp;
  std::vector<float> fb;   // auto_buf_ of track 2, fader, index = core sample
  std::vector<float> aus;  // mod_ausgang(1) per block, at the block's last sample
  int64_t start_s = 0;
  explicit Szene(std::unique_ptr<Audio> q) : quelle_au(std::move(q)) { t.k = cdj::Karte(120.0, 0); }
  cdj::ArrSnapshot* bau(int64_t nr, const cdj::ArrMod& md) {
    Bau b(nr);
    b.spur(1, ArrArt::audio).clip(1, "q1", 0.0, 90.0, &quelle_au->a);
    b.spur(2, ArrArt::audio).clip(2, "z1", 0.0, 90.0, &ziel_au->a);
    cdj::ArrSnapshot* s = b.fertig();
    s->mod[s->n_mod++] = md;
    s->mod_feld[0].slot = 1;
    s->mod_feld[0].feld = cdj::ARR_AUTO_FADER;
    s->n_mod_felder = 1;
    return s;
  }
  void starten(const cdj::ArrMod& md) {
    t.laden(bau(1, md));
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -200.0f);   // the source is silent at the master; the follower hears it before the fader
    PRUEF(t.arr.start(0.0, 0, false, t.s, V, N, t.k));
    start_s = t.arr.zustand(t.k, t.s).ursprung_sample;
  }
  void lauf(int64_t bis) {
    float b[6][cdj::ARR_BLOCK];
    while (t.s < bis) {
      for (auto& x : b) std::fill(x, x + N, 0.0f);
      t.arr.block(t.k, t.s, N, b[0], b[1], b[2], b[3], b[4], b[5]);
      t.l.insert(t.l.end(), b[0], b[0] + N);
      const size_t e = static_cast<size_t>(t.s + N);
      if (fb.size() < e) fb.resize(e, 0.0f);
      std::copy(Z::buf(t.arr, 1, 0), Z::buf(t.arr, 1, 0) + N, fb.begin() + t.s);
      aus.push_back(t.arr.mod_ausgang(1));
      t.s += N;
    }
  }
  double out(int64_t s, float tiefe) const { return fb[static_cast<size_t>(s)] / tiefe; }   // base 0 dB: the course is tiefe * out
};

void burst_kurve() {   // 1.
  const float tiefe = -12.0f, angriff = 5.0f, abfall = 150.0f;
  Szene z(burst(2400000, BURST));
  z.starten(folger(1, 0, tiefe, angriff, abfall));
  z.lauf(z.start_s + 3 * 48000);
  // the first sample where the source sounds: the clip starts at the origin sample
  const int64_t ein = z.start_s;
  const double stetig = (db_von(0.5) + 60.0) / 60.0;   // 0.8997
  // before the source sounds plus one block of latency, the output is 0
  for (int64_t s = 0; s < ein + N; ++s) PRUEF(z.fb[static_cast<size_t>(s)] == 0.0f);
  // attack: env(t) = 0.5 (1 - exp(-t / tau)); at one tau it is 0.5 (1 - 1/e) = -10.0 dBFS, output (-10.0 + 60) / 60. One block of latency (N samples) on top.
  const double tau_a = angriff * 48.0;
  const double schwelle = (db_von(0.5 * (1.0 - std::exp(-1.0))) + 60.0) / 60.0;
  int64_t erreicht = -1;
  for (int64_t s = ein; s < ein + 4800 && erreicht < 0; ++s)
    if (z.out(s, tiefe) >= schwelle) erreicht = s;
  std::printf("1. attack: the output reaches the one-tau value %.4f %lld samples after the onset (expected about %.0f = one block %d + tau %.0f)\n", schwelle,
              static_cast<long long>(erreicht - ein), N + tau_a, N, tau_a);
  PRUEF(erreicht >= 0);
  PRUEF(std::llabs((erreicht - ein) - static_cast<int64_t>(N + tau_a)) <= 24);   // the clip's own edge fade adds a few samples
  // steady value inside the burst (after 10 attack time constants)
  const int64_t mitte = ein + BURST - 200;
  PRUEF_NAH(z.out(mitte, tiefe), stetig, 2e-3);
  // release: 8.686 dB per tau, 2 tau between the two read points (after the end of the burst plus one block plus 1 tau)
  const double tau_r = abfall * 48.0;
  const int64_t ende = ein + BURST + N;
  const double o1 = z.out(ende + static_cast<int64_t>(tau_r), tiefe), o2 = z.out(ende + static_cast<int64_t>(3.0 * tau_r), tiefe);
  const double soll = 2.0 * 20.0 / std::log(10.0) / 60.0;   // 2 tau = 17.37 dB = 0.2895 of the output
  std::printf("   release: the output falls by %.4f over two release time constants (expected %.4f); steady %.4f (expected %.4f)\n", o1 - o2, soll, z.out(mitte, tiefe), stetig);
  PRUEF_NAH(o1 - o2, soll, 0.01);
  // below -60 dBFS: exactly 0 (the course of track 2 is its base, 0 dB, bit for bit). -60 dB from -6 is 54 dB = 6.2 tau.
  const int64_t still = ende + static_cast<int64_t>(7.0 * tau_r);
  for (int64_t s = still; s < still + 4800; ++s) PRUEF(z.fb[static_cast<size_t>(s)] == 0.0f);
  // the report: 2 * out - 1 at the block's last sample (silence -1, steady 2 * 0.8997 - 1)
  const size_t blk_mitte = static_cast<size_t>(mitte / N);
  PRUEF_NAH(z.aus[blk_mitte], 2.0 * z.out((static_cast<int64_t>(blk_mitte) + 1) * N - 1, tiefe) - 1.0, 1e-5);
  PRUEF(z.aus.back() == -1.0f);
}

void voll_ducken() {   // 2.
  const float tiefe = -12.0f;
  Szene z(Audio::gleich(2400000));
  z.starten(folger(1, 0, tiefe, 5.0f, 150.0f, 24.0f));
  z.lauf(z.start_s + 48000);
  double max_ab = 0.0;
  for (int64_t s = z.start_s + 4800; s < z.start_s + 48000; s += 997) {
    const double g = db_von(std::fabs(z.t.l[static_cast<size_t>(s)]) / (0.5 * MITTE));
    max_ab = std::max(max_ab, std::fabs(g - tiefe));
    PRUEF_NAH(g, tiefe, 0.05);
  }
  std::printf("2. full envelope: track 2 at the master %.4f dB off base + tiefe (%.1f dB)\n", max_ab, tiefe);
}

void deterministisch() {   // 3.
  Szene a(burst(2400000, BURST)), b(burst(2400000, BURST));
  a.starten(folger(1, 0, -12.0f));
  b.starten(folger(1, 0, -12.0f));
  a.lauf(a.start_s + 48000);
  b.lauf(b.start_s + 48000);
  PRUEF(a.fb == b.fb && a.t.l == b.t.l);
  std::printf("3. two runs: fader course and master bit for bit equal (%zu samples)\n", a.fb.size());
}

void tausch_behaelt() {   // 4.
  const float tiefe = -12.0f;
  Szene z(Audio::gleich(2400000));
  z.starten(folger(1, 0, tiefe));
  z.lauf(z.start_s + 24000);
  const double vor = z.out(z.t.s - 1, tiefe);
  cdj::ArrMod neu = folger(1, 0, -6.0f);
  z.t.laden(z.bau(2, neu));
  z.lauf(z.t.s + N);
  const double nach = z.fb[static_cast<size_t>(z.t.s - N)] / -6.0;
  std::printf("4. swap with the same nr: output %.4f before, %.4f in the first sample after (a reset would be 0)\n", vor, nach);
  PRUEF_NAH(nach, vor, 1e-3);
  // another art on the same nr starts afresh: an LFO on nr 1, then the follower again, starts from silence
  cdj::ArrMod lfo{};
  lfo.nr = 1;
  lfo.art = 0;
  lfo.takt = 4.0;
  lfo.glatt_ms = 0.0f;
  lfo.z[lfo.n++] = neu.z[0];
  z.t.laden(z.bau(3, lfo));
  z.lauf(z.t.s + N);
  z.t.laden(z.bau(4, neu));
  z.lauf(z.t.s + N);
  PRUEF(z.fb[static_cast<size_t>(z.t.s - N)] == 0.0f);   // the first block after the change of art plays silence (no course yet)
}

void lader() {   // 5.
  arrdatei::Ordner o("test_arr_mod_folger");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  const std::string spuren = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, a, 48000) + "]},{\"nr\":2,\"art\":\"audio\",\"clips\":[]}";
  int64_t nr = 100;
  const auto lade = [&](const std::string& mod, cdj::ArrMod* kopie = nullptr) {
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/3\",\"nr\":" << nr << ",\"spuren\":[" << spuren << "],\"gruppen\":[],\"returns\":[],\"mod\":" << mod << "}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.grund + (e.snap ? "+snap" : "");
    if (e.snap && kopie && e.snap->n_mod > 0) *kopie = e.snap->mod[0];
    if (!e.snap) std::printf("   refused: %s\n", e.meldung.c_str());
    cdj::gib_wiedergabe(e.snap.release(), cache);
    return g;
  };
  const std::string zl = "\"ziele\":[{\"spur\":2,\"ziel\":\"fader\",\"tiefe\":-6.0,\"uni\":true}]";
  const auto fo = [&](const std::string& felder) { return "[{\"nr\":3,\"art\":\"folger\"," + felder + "," + zl + "}]"; };
  {
    cdj::ArrMod k{};
    PRUEF(lade(fo("\"quelle\":1,\"angriff_ms\":2.5,\"abfall_ms\":300,\"empfindlich_db\":-6,\"glatt_ms\":1.0"), &k) == "+snap");
    PRUEF(k.nr == 3 && k.art == 1 && k.quelle == 0 && k.angriff_ms == 2.5f && k.abfall_ms == 300.0f && k.empfindlich_db == -6.0f && k.n == 1 && k.z[0].uni);
    cdj::ArrMod d{};   // defaults of the formats section, uni false is overruled (a follower is unipolar)
    PRUEF(lade("[{\"nr\":3,\"art\":\"folger\",\"quelle\":1,\"ziele\":[{\"spur\":2,\"ziel\":\"fader\",\"tiefe\":-6.0,\"uni\":false}]}]", &d) == "+snap");
    PRUEF(d.angriff_ms == 5.0f && d.abfall_ms == 150.0f && d.empfindlich_db == 0.0f && d.glatt_ms == 1.0f && d.z[0].uni);
    PRUEF(lade(fo("\"quelle\":2")) == "+snap");   // an empty track is a valid source (silence)
  }
  PRUEF(lade(fo("\"angriff_ms\":5")) == "format");                              // no source
  PRUEF(lade(fo("\"quelle\":3")) == "format");                                  // no such track
  PRUEF(lade(fo("\"quelle\":0")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"angriff_ms\":0.05")) == "format");              // ranges
  PRUEF(lade(fo("\"quelle\":1,\"angriff_ms\":501")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"abfall_ms\":0.5")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"abfall_ms\":5001")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"empfindlich_db\":25")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"empfindlich_db\":-24.5")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"form\":0")) == "format");                       // LFO fields on a follower
  PRUEF(lade(fo("\"quelle\":1,\"takt\":4")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"hz\":1")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"phase\":0")) == "format");
  PRUEF(lade(fo("\"quelle\":1,\"saat\":1")) == "format");
  PRUEF(lade("[{\"nr\":3,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"quelle\":1," + zl + "}]") == "format");   // follower fields on an LFO
  PRUEF(lade("[{\"nr\":3,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"abfall_ms\":100," + zl + "}]") == "format");
  PRUEF(lade("[{\"nr\":3,\"art\":\"huelle\",\"quelle\":1," + zl + "}]") == "format");
  PRUEF(lade("[{\"nr\":3,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"phase\":1.0,\"saat\":1," + zl + "}]") == "format");   // phase stays [0, 1)
}

void ohne_allokation() {   // 6.
  Szene z(burst(2400000, 2400000));
  z.starten(folger(1, 0, -12.0f));
  z.lauf(z.start_s + 4 * N);
  cdj::ArrSnapshot* s2 = z.bau(2, folger(1, 0, -6.0f));
  float bf[6][cdj::ARR_BLOCK];
  int64_t smp = z.t.s;
  std::vector<const cdj::ArrSnapshot*> alt;
  alt.reserve(2);
  abfang_an();
  for (int blk = 0; blk < 2000; ++blk) {
    if (blk == 1000) alt.push_back(z.t.arr.tausche(s2, smp, z.t.k));
    for (auto& x : bf) std::fill(x, x + N, 0.0f);
    z.t.arr.block(z.t.k, smp, N, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
    smp += N;
  }
  const long im_fenster = abfang_aus();
  const AbfangZahlen n = abfang_zahlen();
  const float o = z.t.arr.mod_ausgang(1);
  std::printf("6. 2000 blocks with a follower and a swap: allocations %ld, frees %ld, locks %ld, sleeps %ld; output at the end %.4f\n", im_fenster, n.frei, n.sperren, n.schlafen, o);
  PRUEF(o > 0.5f);   // the follower really ran on a sounding source (0 allocations is not an empty run)
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0 && n.summe() == 0);
  for (const cdj::ArrSnapshot* x : alt) z.t.alt.push_back(x);
  abfang_an();
  { std::vector<int> v(100); }
  const long positiv = abfang_aus();
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);
}

// a sink that writes a constant 0.5 into the track bus, safe on a lane (it touches nothing but the bus)
struct GleichSenke : cdj::ArrSenke {
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int m, float* l, float* r) noexcept override {
    for (int t = 0; t < m; ++t) {
      l[t] += 0.5f;
      r[t] += 0.5f;
    }
  }
  bool parallel_faehig(int) const noexcept override { return true; }
};

void quelle_in_einheit() {   // 7.
  const float tiefe = -12.0f;
  GleichSenke se;
  auto ziel_au = Audio::gleich(2400000);
  auto tp = std::make_unique<Treiber>();
  Treiber& t = *tp;
  t.k = cdj::Karte(120.0, 0);
  t.arr.setze_senke_intern(&se);
  Bau b(1);
  b.spur(1, ArrArt::intern).kette(1, {cdj::ArrStufe{cdj::ArrInsArt::eq, 0, true}});
  b.spur(2, ArrArt::audio).clip(2, "z1", 0.0, 90.0, &ziel_au->a);
  b.spur(3, ArrArt::intern).kette(3, {cdj::ArrStufe{cdj::ArrInsArt::eq, 1, true}});
  cdj::ArrSnapshot* s = b.fertig();
  std::snprintf(s->spur[0].geraet, sizeof s->spur[0].geraet, "rb338");
  std::snprintf(s->spur[2].geraet, sizeof s->spur[2].geraet, "rb338");
  s->mod[s->n_mod++] = folger(1, 0, tiefe);
  s->mod_feld[0].slot = 1;
  s->mod_feld[0].feld = cdj::ARR_AUTO_FADER;
  s->n_mod_felder = 1;
  t.laden(s);
  t.arr.setze_sofort(t.tab.suche("spur/1/trim"), -24.0f);   // in the unit the follower would hear -30 dBFS instead of -6
  t.arr.setze_sofort(t.tab.suche("spur/3/trim"), -24.0f);
  PRUEF(t.arr.start(0.0, 0, false, t.s, V, N, t.k));
  float bf[6][cdj::ARR_BLOCK];
  bool quelle_in_einheit = false, kontrolle_in_einheit = true;
  for (int blk = 0; blk < 400; ++blk) {
    for (auto& x : bf) std::fill(x, x + N, 0.0f);
    t.arr.block(t.k, t.s, N, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
    t.s += N;
    if (blk > 4) {
      quelle_in_einheit = quelle_in_einheit || t.arr.kette_einheit().test(0);
      kontrolle_in_einheit = kontrolle_in_einheit && t.arr.kette_einheit().test(2);
    }
  }
  const double out = Z::buf(t.arr, 1, 0)[N - 1] / tiefe;
  const double soll = (db_von(0.5) + 60.0) / 60.0;
  std::printf("7. source with a chain and trim -24 dB: follower output %.4f (expected %.4f, the signal before trim and chain); source in the unit %d, control in the unit %d\n", out, soll,
              quelle_in_einheit ? 1 : 0, kontrolle_in_einheit ? 1 : 0);
  PRUEF_NAH(out, soll, 2e-3);
  PRUEF(!quelle_in_einheit);
  PRUEF(kontrolle_in_einheit);
  t.arr.setze_senke_intern(nullptr);
}

}  // namespace

int main() {
  burst_kurve();
  voll_ducken();
  deterministisch();
  tausch_behaelt();
  lader();
  ohne_allokation();
  quelle_in_einheit();
  PRUEF_ENDE();
}
