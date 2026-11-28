// Strand 5 slice 4 (task 4.1): an EQ stage listens to a key. The dynamic bands in key mode (dyn 3 above with key, 4 below with key) detect on the key instead of the stage input:
// the row ins/eq/<n>/sc (parameter 85: 0 = own signal, 1..128 = the input of that track before any chain, as komp sc) or a structural key of the chain entry (as komp, which wins).
// The key index space of ArrInserts covers komp, then eq, then host, then (strand 13 slice 4) mb (ARR_INS_SCHL = ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_HOST + ARR_INS_MB).
// Cases: 1 zeile_duckt (row sc = the kick track: band 1 Low shelf dyn 3 cuts the bass by >= 6 dB during every kick and < 1 dB between them),
// 2 struktur_duckt (the same with a structural key, the post of the kick track, row sc 0),
// 3 ohne_schluessel (no key: a band in key mode acts as own detection: a quiet bass is not cut although the kick plays; a loud bass in mode 3 equals mode 1 bit for bit),
// 4 verzug (the key delay of an eq stage equals the komp one at the same chain position for the same source: row key behind an EQ = its latency, post key 0),
// 5 zeilen (rows ins/eq/1/sc and ins/eq/160/sc: role, range, steps; INS_EQ_SC 85, INS_EQ_PARAM 86; the key index mapping; a lane on the key is ignored),
// 6 lader (the playback file: an eq stage may carry a key, a saturator may not; a lane on eq param 85 is refused).
// Mutation (CMakeLists.txt): INS_EQ_SC_IGNORIERT (1).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrSchluessel;
using cdj::ArrStufe;

static constexpr int64_t V = 537;
static constexpr int64_t TAKT = 22500;    // one beat at 128 BPM
static constexpr int64_t STOSS = 4800;    // a kick: 100 ms of 60 Hz
static constexpr int64_t BIS = 250000;
static const int G = cdj::ins_global(ArrInsArt::eq, 0);

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static ArrSchluessel post_von(int nr) { return ArrSchluessel{cdj::ARR_SCHL_SPUR, static_cast<uint8_t>(nr), cdj::ARR_SCHL_POST}; }

// 60 Hz bursts of STOSS samples at amplitude 0.5 on every beat
static std::unique_ptr<Audio> stoesse(int64_t frames) {
  auto x = std::make_unique<Audio>();
  x->d.assign(static_cast<size_t>(frames) * 2, 0.0f);
  for (int64_t f = 0; f < frames; ++f) {
    const int64_t p = f % TAKT;
    if (p < STOSS) x->d[2 * f] = x->d[2 * f + 1] = 0.5f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * 60.0 * static_cast<double>(p) / 48000.0));
  }
  x->fuellen(frames);
  return x;
}

// the eq of the bass (slot 1): band 1 Low shelf 100 Hz, gain 0, dynamic in mode `modus`, threshold -30 dB, range -12 dB, release 20 ms; row sc `sc`
static void eq_duck(Treiber& t, float modus, float sc) {
  setze(t, "ins/eq/1/an", 1.0f);
  setze(t, "ins/eq/1/b1/an", 1.0f);
  setze(t, "ins/eq/1/b1/typ", 1.0f);
  setze(t, "ins/eq/1/b1/freq", 100.0f);
  setze(t, "ins/eq/1/b1/gain", 0.0f);
  setze(t, "ins/eq/1/d1/dyn", modus);
  setze(t, "ins/eq/1/d1/schwelle", -30.0f);
  setze(t, "ins/eq/1/d1/bereich", -12.0f);
  setze(t, "ins/eq/1/dyn_release", 20.0f);
  setze(t, "ins/eq/1/sc", sc);
}

// the bass on track 1 with `kette`, the kick on track 2
static cdj::ArrSnapshot* bau(const Audio* bass, const Audio* kick, std::initializer_list<ArrStufe> kette) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
  b.kette(1, kette);
  if (kick) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &kick->a);
  return b.fertig();
}

// a run in blocks of 256: the reading of the eq slot after every block
struct Lauf {
  std::unique_ptr<Treiber> t = std::make_unique<Treiber>();
  std::vector<float> gr;
  std::vector<int64_t> ende;
  void start(cdj::ArrSnapshot* s) {
    t->laden(s);
    t->arr.start(0.0, 2, false, 0, V, 256, t->k);
  }
  void bis(int64_t s_bis) {
    while (t->s < s_bis) {
      t->lauf(t->s + 256);
      gr.push_back(t->arr.inserts().gr_db(G));
      ende.push_back(t->s);
    }
  }
  float spitze(int64_t von, int64_t s_bis) const {   // largest reading of the blocks that end in (von, s_bis]
    float m = 0.0f;
    for (size_t i = 0; i < gr.size(); ++i)
      if (ende[i] > von && ende[i] <= s_bis) m = std::max(m, gr[i]);
    return m;
  }
};

int main() {
  auto leise = Audio::sinus(400000, 60.0, 0.01f);   // -40 dBFS: under the threshold on its own
  auto laut = Audio::sinus(400000, 60.0, 0.5f);     // over the threshold on its own
  auto kick = stoesse(400000);

  // where the kicks start on the PM (the start-up offset): a run with the kick track alone
  std::vector<int64_t> kick_s;
  {
    Bau b(1);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &kick->a);
    auto tp = std::make_unique<Treiber>();
    Treiber& t = *tp;
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(BIS);
    int64_t still = 1 << 20;
    for (size_t i = 0; i < t.pml.size(); ++i) {
      if (std::fabs(t.pml[i]) > 1e-4f) {
        if (still > 2 * STOSS) kick_s.push_back(static_cast<int64_t>(i));
        still = 0;
      } else {
        ++still;
      }
    }
  }
  std::printf("kicks found: %zu (first at %lld)\n", kick_s.size(), kick_s.empty() ? -1LL : static_cast<long long>(kick_s[0]));
  PRUEF(kick_s.size() >= 5);   // positive control: the reference run found the kicks
  // during a kick: 20 ms after its start to its end; between: 100 ms after its end to the next kick
  const auto waehrend = [&](const Lauf& l, int64_t k) { return l.spitze(k + 960, k + STOSS); };
  const auto zwischen = [&](const Lauf& l, int64_t k) { return l.spitze(k + 2 * STOSS, k + TAKT - 512); };
  const auto duckt = [&](const Lauf& l, const char* name) {
    float w_min = 1e9f, z_max = 0.0f;
    for (size_t k = 1; k + 1 < kick_s.size(); ++k) {
      w_min = std::min(w_min, waehrend(l, kick_s[k]));
      z_max = std::max(z_max, zwischen(l, kick_s[k]));
    }
    std::printf("%s: lowest cut during a kick %.2f dB, highest cut between kicks %.3f dB\n", name, w_min, z_max);
    PRUEF(w_min >= 6.0f);
    PRUEF(z_max < 1.0f);
  };

  {  // 1 zeile_duckt: row sc = 2 (the kick track's input)
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true}}));
    eq_duck(*l.t, 3.0f, 2.0f);
    l.bis(BIS);
    duckt(l, "1 row sc");
    PRUEF(!l.t->arr.inserts().strukturell(G));
  }

  {  // 2 struktur_duckt: the structural key post of track 2, row sc 0
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true, post_von(2)}}));
    eq_duck(*l.t, 3.0f, 0.0f);
    l.bis(BIS);
    duckt(l, "2 structural post");
    PRUEF(l.t->arr.inserts().strukturell(G));
  }

  {  // 3 ohne_schluessel: no key. A band in key mode detects on the stage input.
    Lauf still;   // the quiet bass is not cut although the kick plays on track 2 (it is nobody's key)
    still.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true}}));
    eq_duck(*still.t, 3.0f, 0.0f);
    still.bis(BIS);
    Lauf m3, m1;   // a loud bass: mode 3 without a key equals mode 1, bit for bit
    m3.start(bau(laut.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true}}));
    eq_duck(*m3.t, 3.0f, 0.0f);
    m3.bis(BIS);
    m1.start(bau(laut.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true}}));
    eq_duck(*m1.t, 1.0f, 0.0f);
    m1.bis(BIS);
    const bool gleich = m3.t->pml.size() == m1.t->pml.size() && std::memcmp(m3.t->pml.data(), m1.t->pml.data(), sizeof(float) * m1.t->pml.size()) == 0;
    std::printf("3: no key: quiet bass highest cut %.3f dB; loud bass mode 3 %.2f dB, mode 1 %.2f dB, PM bit-equal %d\n", still.spitze(0, BIS), m3.spitze(BIS / 2, BIS), m1.spitze(BIS / 2, BIS),
                gleich ? 1 : 0);
    PRUEF(still.spitze(0, BIS) < 0.5f);
    PRUEF(m3.spitze(BIS / 2, BIS) >= 6.0f);   // positive control: the own signal drives the band
    PRUEF(gleich);
  }

  {  // 4 verzug: an EQ that is off (eq slot 2, latency LAT_EQ) in front of the stage. The delay of the key equals the komp one at the same position for the same source.
    const int LAT_EQ = cdj::ins_latenz(ArrInsArt::eq);
    const auto eq_aus = ArrStufe{ArrInsArt::eq, 1, false};
    const auto verzug = [&](ArrStufe stufe, bool zeile) {
      Lauf l;
      l.start(bau(leise.get(), kick.get(), {eq_aus, stufe}));
      eq_duck(*l.t, 3.0f, zeile ? 2.0f : 0.0f);
      setze(*l.t, "ins/komp/1/an", 1.0f);
      setze(*l.t, "ins/komp/1/sc", zeile ? 2.0f : 0.0f);
      l.bis(20000);
      return l.t->arr.inserts().schluessel_verzug(stufe.art == ArrInsArt::komp ? 0 : G);
    };
    const int k_zeile = verzug(ArrStufe{ArrInsArt::komp, 0, true}, true), e_zeile = verzug(ArrStufe{ArrInsArt::eq, 0, true}, true);
    const int k_post = verzug(ArrStufe{ArrInsArt::komp, 0, true, post_von(2)}, false), e_post = verzug(ArrStufe{ArrInsArt::eq, 0, true, post_von(2)}, false);
    std::printf("4: key delay behind an EQ (%d samples): row key komp %d, eq %d; post key komp %d, eq %d\n", LAT_EQ, k_zeile, e_zeile, k_post, e_post);
    PRUEF(LAT_EQ > 0);
    PRUEF(k_zeile == LAT_EQ && e_zeile == k_zeile);
    PRUEF(e_post == k_post && e_post == 0);
  }

  {  // 5 zeilen
    auto tp = std::make_unique<Treiber>();
    for (const char* p : {"ins/eq/1/sc", "ins/eq/160/sc"}) {
      const int r = reg(*tp, p);
      const auto& d = tp->tab.def(r);
      PRUEF(d.rolle == cypherdj::stellwerk::Rolle::ins_eq_sc);
      PRUEF(d.min == 0.0f && d.max == 128.0f && d.vorgabe == 0.0f && d.kurve.typ == cypherdj::stellwerk::KurvenTyp::stufen && d.ganzzahlig);
    }
    PRUEF(cdj::INS_EQ_SC == 85 && cdj::INS_EQ_PARAM == 86 && cdj::INS_PARAM_MAX == 86);
    PRUEF(cdj::ARR_INS_SCHL == cdj::ARR_INS_KOMP + cdj::ARR_INS_EQ + cdj::ARR_INS_HOST + cdj::ARR_INS_MB);   // strand 13 slice 4: + mb
    PRUEF(cdj::ins_schl_index(0) == 0 && cdj::ins_schl_index(cdj::INS_G_EQ0) == cdj::ARR_INS_KOMP && cdj::ins_schl_index(cdj::INS_G_SAETT0 - 1) == cdj::ARR_INS_KOMP + cdj::ARR_INS_EQ - 1);
    PRUEF(cdj::ins_schl_index(cdj::INS_G_SAETT0) == -1 && cdj::ins_schl_index(cdj::INS_G_HOST0) == cdj::ARR_INS_KOMP + cdj::ARR_INS_EQ);
    PRUEF(cdj::ins_schl_index(cdj::INS_G_HOST0 - 1) == -1 && cdj::ins_schl_index(cdj::ARR_INS_ALLE - 1) == cdj::INS_SCHL_MB0 - 1);   // strand 13 slice 4: the mb key indices follow the host ones
    for (int k = 0; k < cdj::ARR_INS_SCHL; ++k) PRUEF(cdj::ins_schl_index(cdj::ins_schl_slot(k)) == k);
    // the row binds to parameter 85 of the slot: the row value is what the key planning reads (a key track in the mask)
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::eq, 0, true}}));
    eq_duck(*l.t, 3.0f, 2.0f);
    l.bis(2048);
    PRUEF(l.t->arr.inserts().schluessel_maske().test(1));
    PRUEF(l.t->arr.inserts().hoert_schluessel(0));
    // a lane on the key is ignored (the key is structure of a block, not a module setting)
    auto ins = std::make_unique<cdj::ArrInserts>();
    auto ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::eq, 0, true};
    ins->tausche(ketten.get());
    ins->lane_stufe(0, ketten[0], 0, cdj::INS_EQ_SC, 3.0f);
    PRUEF(!ins->lane_treibt(G, cdj::INS_EQ_SC));
    ins->lane_stufe(0, ketten[0], 0, cdj::INS_EQ_DYN_RELEASE, 30.0f);   // positive control: the parameter before it takes a lane
    PRUEF(ins->lane_treibt(G, cdj::INS_EQ_DYN_RELEASE));
  }

  {  // 6 lader: the playback file
    arrdatei::Ordner o("test_arr_inserts_eq_schluessel");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const auto spur = [&](int nr, const std::string& kette, const std::string& rest = "") {
      return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + o.clip(("c" + std::to_string(nr)).c_str(), 0.0, 1.0, a, 48000) + "],\"chain\":[" + kette + "]" + rest + "}";
    };
    const std::string key = "{\"q\":\"spur\",\"nr\":2,\"punkt\":\"post\"}";
    int nr_datei = 100;
    const auto lade = [&](const std::string& s1) {
      const int64_t nr = nr_datei++;
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + s1 + "," + spur(2, "") + "]}");
      return cdj::lade_wiedergabe(o.pfad, nr, cache);
    };
    const auto grund = [&](const std::string& s1) {
      cdj::ArrLadeErgebnis x = lade(s1);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    {
      cdj::ArrLadeErgebnis e = lade(spur(1, "{\"art\":\"eq\",\"slot\":1,\"key\":" + key + "}"));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const ArrStufe& st = e.snap->kette[0].st[0];
        PRUEF(st.art == ArrInsArt::eq && st.key.quelle == cdj::ARR_SCHL_SPUR && st.key.nr == 2 && st.key.punkt == cdj::ARR_SCHL_POST);
        PRUEF(e.snap->spur_ordnung[0] == 1);   // the key source runs first, as for a compressor
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(grund(spur(1, "{\"art\":\"saett\",\"slot\":1,\"key\":" + key + "}")) == "format");   // a saturator has no key
    const std::string g85 = grund(spur(1, "{\"art\":\"eq\",\"slot\":1}", ",\"chain_auto\":[{\"stufe\":0,\"param\":85,\"punkte\":[[0,2,0]]}]"));
    const std::string g84 = grund(spur(1, "{\"art\":\"eq\",\"slot\":1}", ",\"chain_auto\":[{\"stufe\":0,\"param\":84,\"punkte\":[[0,30,0]]}]"));
    std::printf("6: lane on eq param 85: %s, on param 84: %s\n", g85.c_str(), g84.c_str());
    PRUEF(g85 == "format");
    PRUEF(g84 == "+snap");   // control: the same lane on dyn_release loads
  }

  PRUEF_ENDE();
}
