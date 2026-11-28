// Strand 13 slice 4 (task 4.2): a multiband stage listens to a key and lifts quiet bands.
// The rows ins/mb/<n>/u<m>/{schwelle,ratio,bereich} (parameters 24 + (m - 1) * 3 + 0..2, ratio 1 = off) drive the upward path of band m; the row ins/mb/<n>/sc (parameter 33:
// 0 = own signal, 1..128 = the input of that track before any chain, as komp sc) or a structural key of the chain entry (which wins) is the key all three bands detect their reduction on.
// The key index space of ArrInserts covers komp, eq, host, then mb (ARR_INS_SCHL = ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_HOST + ARR_INS_MB).
// Cases: 1 transparent (the defaults of the new rows: the stage output equals a MultibandKompressor driven directly with the band settings of before, bit for bit),
// 2 zeile_duckt (row sc = the kick track: the low band of a quiet bass is reduced by >= 6 dB during every kick and < 1 dB between them; without a key nothing),
// 3 struktur_duckt (the same with a structural key, the post of the kick track, row sc 0),
// 4 anhebung (u3 ratio 2, threshold -40, range 6: a -60 dBFS high tone is lifted; the per-band reading of band 3 is negative, about -6 dB; bands 1 and 2 read 0),
// 5 verzug (the key delay of an mb stage equals the komp one at the same chain position for the same source),
// 6 zeilen (rows ins/mb/8/u3/bereich and ins/mb/1/sc: role, range, steps; index pins 24, 32, 33; the key index mapping; a lane on the key is ignored, on u1/schwelle it is taken),
// 7 lader (the playback file: an mb stage may carry a key; a lane on mb param 33 is refused, on 32 it loads; a key that needs the whole ring is refused like a compressor's).
// Mutation (CMakeLists.txt): INS_MB_SC_IGNORIERT (2).
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
#include "cypherdj/arr_key.h"
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
static const int G = cdj::ins_global(ArrInsArt::mb, 0);

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

// the mb of the bass (slot 1): band 1 threshold -30 dB, ratio 4, attack 1 ms, release 20 ms, no automatic makeup trim; row sc `sc`
static void mb_duck(Treiber& t, float sc) {
  setze(t, "ins/mb/1/an", 1.0f);
  setze(t, "ins/mb/1/b1/schwelle", -30.0f);
  setze(t, "ins/mb/1/b1/ratio", 4.0f);
  setze(t, "ins/mb/1/b1/attack", 1.0f);
  setze(t, "ins/mb/1/b1/release", 20.0f);
  setze(t, "ins/mb/1/sc", sc);
}

// the bass on track 1 with `kette`, the kick on track 2
static cdj::ArrSnapshot* bau(const Audio* bass, const Audio* kick, std::initializer_list<ArrStufe> kette) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
  b.kette(1, kette);
  if (kick) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &kick->a);
  return b.fertig();
}

// a run in blocks of 256: the reading of the mb slot and of its bands after every block
struct Lauf {
  std::unique_ptr<Treiber> t = std::make_unique<Treiber>();
  std::vector<float> gr, b1, b3;
  std::vector<int64_t> ende;
  void start(cdj::ArrSnapshot* s) {
    t->laden(s);
    t->arr.start(0.0, 2, false, 0, V, 256, t->k);
  }
  void bis(int64_t s_bis) {
    while (t->s < s_bis) {
      t->lauf(t->s + 256);
      gr.push_back(t->arr.inserts().gr_db(G));
      b1.push_back(t->arr.inserts().gr_band_db(0, 0));
      b3.push_back(t->arr.inserts().gr_band_db(0, 2));
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
  auto kick = stoesse(400000);

  {  // 1 transparent: the stage with the defaults of the new rows equals the module of before, driven directly
    auto ins = std::make_unique<cdj::ArrInserts>();
    auto ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::mb, 0, true};
    const float band[3][7] = {{-20, 4, 10, 100, 0, 0, 0}, {-25, 3, 5, 80, 6, 2, 0}, {-30, 6, 1, 50, 0, -1, 0}};
    ins->setze_sofort(G, 0, 1.0f);
    ins->setze_sofort(G, 1, 200.0f);
    ins->setze_sofort(G, 2, 2000.0f);
    for (int b = 0; b < 3; ++b) {
      for (int p = 0; p < cdj::INS_MB_BAND_PARAM; ++p) ins->setze_sofort(G, 3 + b * cdj::INS_MB_BAND_PARAM + p, band[b][p]);
      ins->setze_sofort(G, cdj::INS_MB_AUF0 + b * cdj::INS_MB_AUF_PARAM + 0, -40.0f);   // the contract defaults of the upward rows
      ins->setze_sofort(G, cdj::INS_MB_AUF0 + b * cdj::INS_MB_AUF_PARAM + 1, 1.0f);
      ins->setze_sofort(G, cdj::INS_MB_AUF0 + b * cdj::INS_MB_AUF_PARAM + 2, 6.0f);
    }
    ins->setze_sofort(G, cdj::INS_MB_SC, 0.0f);
    ins->tausche(ketten.get());
    auto ref = std::make_unique<cypherdj::dsp::MultibandKompressor>(48000.0);
    for (int b = 0; b < 3; ++b) {
      cypherdj::dsp::MbBandEinstellung e;   // the settings of before: no upward field set
      e.schwelle_db = band[b][0];
      e.verhaeltnis = band[b][1];
      e.anstieg_ms = band[b][2];
      e.abklingen_ms = band[b][3];
      e.knie_db = band[b][4];
      e.aufholen_db = band[b][5];
      e.umgehen = band[b][6] >= 0.5f;
      ref->setze_band(static_cast<cypherdj::dsp::Band>(b), e);
    }
    ref->setze_grenzen(200.0, 2000.0);
    std::vector<float> l(256), r(256), rl(256), rr(256);
    int64_t f = 0, abweichend = 0, verglichen = 0;
    float gr_max = 0.0f;
    for (int blk = 0; blk < 200; ++blk) {
      for (int t = 0; t < 256; ++t, ++f) {
        const double x = static_cast<double>(f) / 48000.0;
        l[t] = static_cast<float>(0.3 * std::sin(2 * M_PI * 90 * x) + 0.2 * std::sin(2 * M_PI * 900 * x) + 0.2 * std::sin(2 * M_PI * 7000 * x));
        r[t] = static_cast<float>(0.25 * std::sin(2 * M_PI * 110 * x) + 0.2 * std::sin(2 * M_PI * 1300 * x) + 0.15 * std::sin(2 * M_PI * 5000 * x));
      }
      rl = l;
      rr = r;
      ins->schluessel_planen(256);
      ins->kette(0, &ketten[0], l.data(), r.data(), 256);
      ref->verarbeite(rl.data(), rr.data(), rl.data(), rr.data(), 256);
      gr_max = std::max(gr_max, ins->gr_db(G));
      if (blk < 4) continue;   // the entry blend (INS_BLENDE samples) mixes the dry signal in
      for (int t = 0; t < 256; ++t, ++verglichen) abweichend += (l[t] != rl[t]) + (r[t] != rr[t]);
    }
    std::printf("1: defaults: %lld of %lld samples differ from the module driven directly; deepest band %.2f dB\n", static_cast<long long>(abweichend), static_cast<long long>(verglichen), gr_max);
    PRUEF(abweichend == 0);
    PRUEF(gr_max > 3.0f);   // positive control: the bands really compress
    PRUEF(ins->gr_band_db(0, 0) >= 0.0f && ins->gr_band_db(0, 1) >= 0.0f && ins->gr_band_db(0, 2) >= 0.0f);   // no lift with ratio 1
  }

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
  const auto waehrend = [&](const Lauf& l, int64_t k) { return l.spitze(k + 960, k + STOSS); };
  const auto zwischen = [&](const Lauf& l, int64_t k) { return l.spitze(k + 2 * STOSS, k + TAKT - 512); };
  const auto duckt = [&](const Lauf& l, const char* name) {
    float w_min = 1e9f, z_max = 0.0f;
    for (size_t k = 1; k + 1 < kick_s.size(); ++k) {
      w_min = std::min(w_min, waehrend(l, kick_s[k]));
      z_max = std::max(z_max, zwischen(l, kick_s[k]));
    }
    std::printf("%s: lowest reduction during a kick %.2f dB, highest between kicks %.3f dB\n", name, w_min, z_max);
    PRUEF(w_min >= 6.0f);
    PRUEF(z_max < 1.0f);
  };

  {  // 2 zeile_duckt: row sc = 2 (the kick track's input); without the key the quiet bass is not reduced
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::mb, 0, true}}));
    mb_duck(*l.t, 2.0f);
    l.bis(BIS);
    duckt(l, "2 row sc");
    PRUEF(!l.t->arr.inserts().strukturell(G));
    float b1_max = 0.0f;
    for (float x : l.b1) b1_max = std::max(b1_max, x);
    PRUEF(b1_max >= 6.0f);   // the per-band reading of the low band shows the reduction (positive)
    Lauf o;
    o.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::mb, 0, true}}));
    mb_duck(*o.t, 0.0f);
    o.bis(BIS);
    std::printf("2: no key: highest reduction %.3f dB\n", o.spitze(0, BIS));
    PRUEF(o.spitze(0, BIS) < 0.5f);
  }

  {  // 3 struktur_duckt: the structural key post of track 2, row sc 0
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::mb, 0, true, post_von(2)}}));
    mb_duck(*l.t, 0.0f);
    l.bis(BIS);
    duckt(l, "3 structural post");
    PRUEF(l.t->arr.inserts().strukturell(G));
  }

  {  // 4 anhebung: a quiet high tone (-60 dBFS, 6 kHz) in band 3, upward ratio 2 under -40 dB, range 6 dB: lifted by the range
    auto hoch = Audio::sinus(400000, 6000.0, 0.001f);
    Lauf l;
    l.start(bau(hoch.get(), nullptr, {ArrStufe{ArrInsArt::mb, 0, true}}));
    setze(*l.t, "ins/mb/1/an", 1.0f);
    setze(*l.t, "ins/mb/1/u3/ratio", 2.0f);
    setze(*l.t, "ins/mb/1/u3/schwelle", -40.0f);
    setze(*l.t, "ins/mb/1/u3/bereich", 6.0f);
    l.bis(BIS);
    const float b3 = l.b3.back(), b1 = l.b1.back();
    std::printf("4: band 3 reading %.2f dB (lift negative), band 1 %.2f dB, deepest reduction %.2f dB\n", b3, b1, l.gr.back());
    PRUEF(b3 < -5.5f && b3 > -6.5f);
    PRUEF(b1 == 0.0f);
    PRUEF(l.gr.back() < 0.01f);   // the lift is no reduction
  }

  {  // 5 verzug: an EQ that is off (eq slot 2, latency LAT_EQ) in front of the stage. The delay of the key equals the komp one at the same position for the same source.
    const int LAT_EQ = cdj::ins_latenz(ArrInsArt::eq);
    const auto eq_aus = ArrStufe{ArrInsArt::eq, 1, false};
    const auto verzug = [&](ArrStufe stufe, bool zeile) {
      Lauf l;
      l.start(bau(leise.get(), kick.get(), {eq_aus, stufe}));
      mb_duck(*l.t, zeile ? 2.0f : 0.0f);
      setze(*l.t, "ins/komp/1/an", 1.0f);
      setze(*l.t, "ins/komp/1/sc", zeile ? 2.0f : 0.0f);
      l.bis(20000);
      return l.t->arr.inserts().schluessel_verzug(stufe.art == ArrInsArt::komp ? 0 : G);
    };
    const int k_zeile = verzug(ArrStufe{ArrInsArt::komp, 0, true}, true), m_zeile = verzug(ArrStufe{ArrInsArt::mb, 0, true}, true);
    const int k_post = verzug(ArrStufe{ArrInsArt::komp, 0, true, post_von(2)}, false), m_post = verzug(ArrStufe{ArrInsArt::mb, 0, true, post_von(2)}, false);
    std::printf("5: key delay behind an EQ (%d samples): row key komp %d, mb %d; post key komp %d, mb %d\n", LAT_EQ, k_zeile, m_zeile, k_post, m_post);
    PRUEF(LAT_EQ > 0);
    PRUEF(k_zeile == LAT_EQ && m_zeile == k_zeile);
    PRUEF(m_post == k_post && m_post == 0);
  }

  {  // 6 zeilen
    auto tp = std::make_unique<Treiber>();
    {
      const auto& d = tp->tab.def(reg(*tp, "ins/mb/8/u3/bereich"));
      PRUEF(d.rolle == cypherdj::stellwerk::Rolle::ins_mb_u_bereich && d.min == 0.0f && d.max == 24.0f && d.vorgabe == 6.0f);
      const auto& u = tp->tab.def(reg(*tp, "ins/mb/1/u1/ratio"));
      PRUEF(u.rolle == cypherdj::stellwerk::Rolle::ins_mb_u_ratio && u.min == 1.0f && u.max == 4.0f && u.vorgabe == 1.0f);
      const auto& w = tp->tab.def(reg(*tp, "ins/mb/1/u2/schwelle"));
      PRUEF(w.rolle == cypherdj::stellwerk::Rolle::ins_mb_u_schwelle && w.min == -80.0f && w.max == 0.0f && w.vorgabe == -40.0f);
      const auto& s = tp->tab.def(reg(*tp, "ins/mb/1/sc"));
      PRUEF(s.rolle == cypherdj::stellwerk::Rolle::ins_mb_sc && s.min == 0.0f && s.max == 128.0f && s.vorgabe == 0.0f && s.kurve.typ == cypherdj::stellwerk::KurvenTyp::stufen && s.ganzzahlig);
      PRUEF(tp->tab.suche("ins/mb/1/u4/ratio") < 0 && tp->tab.suche("ins/mb/9/sc") < 0);
    }
    PRUEF(cdj::INS_MB_AUF0 == 24 && cdj::INS_MB_AUF0 + 2 * cdj::INS_MB_AUF_PARAM + 2 == 32 && cdj::INS_MB_SC == 33 && cdj::INS_MB_PARAM == 34);
    PRUEF(cdj::ARR_INS_SCHL == cdj::ARR_INS_KOMP + cdj::ARR_INS_EQ + cdj::ARR_INS_HOST + cdj::ARR_INS_MB);
    PRUEF(cdj::ins_schl_index(G) == cdj::INS_SCHL_MB0 && cdj::ins_schl_index(G + cdj::ARR_INS_MB - 1) == cdj::ARR_INS_SCHL - 1 && cdj::ins_schl_index(G - 1) == -1 && cdj::ins_schl_index(cdj::INS_G_TRANS0) == -1);
    PRUEF(cdj::ins_hat_sc_zeile(cdj::ins_schl_index(G)) && !cdj::ins_hat_sc_zeile(cdj::ins_schl_index(cdj::INS_G_HOST0)) && cdj::ins_sc_param(G) == cdj::INS_MB_SC);
    for (int k = 0; k < cdj::ARR_INS_SCHL; ++k) PRUEF(cdj::ins_schl_index(cdj::ins_schl_slot(k)) == k);
    // the rows bind to the parameters 24, 32 and 33 of the slot
    Lauf l;
    l.start(bau(leise.get(), kick.get(), {ArrStufe{ArrInsArt::mb, 0, true}}));
    mb_duck(*l.t, 2.0f);
    setze(*l.t, "ins/mb/1/u1/schwelle", -50.0f);
    setze(*l.t, "ins/mb/1/u3/bereich", 7.0f);
    l.bis(2048);
    PRUEF(l.t->arr.inserts().wirksam(G, 24) == -50.0f && l.t->arr.inserts().wirksam(G, 32) == 7.0f);
    PRUEF(l.t->arr.inserts().schluessel_maske().test(1));   // row 33: the key track in the mask
    PRUEF(l.t->arr.inserts().hoert_schluessel(0));
    // a lane on the key is ignored (the key is structure of a block, not a module setting); a lane on an upward row is taken
    auto ins = std::make_unique<cdj::ArrInserts>();
    auto ketten = std::make_unique<cdj::ArrKette[]>(cdj::ARR_KETTEN);
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::mb, 0, true};
    ins->tausche(ketten.get());
    ins->lane_stufe(0, ketten[0], 0, cdj::INS_MB_SC, 3.0f);
    PRUEF(!ins->lane_treibt(G, cdj::INS_MB_SC));
    ins->lane_stufe(0, ketten[0], 0, cdj::INS_MB_AUF0, -30.0f);
    PRUEF(ins->lane_treibt(G, cdj::INS_MB_AUF0));
  }

  {  // 7 lader: the playback file
    arrdatei::Ordner o("test_arr_inserts_mb_schluessel");
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
      cdj::ArrLadeErgebnis e = lade(spur(1, "{\"art\":\"mb\",\"slot\":1,\"key\":" + key + "}"));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const ArrStufe& st = e.snap->kette[0].st[0];
        PRUEF(st.art == ArrInsArt::mb && st.key.quelle == cdj::ARR_SCHL_SPUR && st.key.nr == 2 && st.key.punkt == cdj::ARR_SCHL_POST);
        PRUEF(e.snap->spur_ordnung[0] == 1);   // the key source runs first, as for a compressor
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(grund(spur(1, "{\"art\":\"gate\",\"slot\":1,\"key\":" + key + "}")) == "format");   // a gate stage has no key (negative control)
    const std::string g33 = grund(spur(1, "{\"art\":\"mb\",\"slot\":1}", ",\"chain_auto\":[{\"stufe\":0,\"param\":33,\"punkte\":[[0,2,0]]}]"));
    const std::string g32 = grund(spur(1, "{\"art\":\"mb\",\"slot\":1}", ",\"chain_auto\":[{\"stufe\":0,\"param\":32,\"punkte\":[[0,8,0]]}]"));
    std::printf("7: lane on mb param 33: %s, on param 32: %s\n", g33.c_str(), g32.c_str());
    PRUEF(g33 == "format");
    PRUEF(g32 == "+snap");   // control: the same lane on u3/bereich loads
    // the ring bound: a structural DJ key behind an EQ (LAT_EQ) needs that delay; a ring of LAT_EQ samples refuses it, one sample more holds it (as for a compressor)
    const int LAT_EQ = cdj::ins_latenz(ArrInsArt::eq);
    auto bass = Audio::sinus(48000, 60.0, 0.1f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 0.5, &bass->a);
    b.kette(1, {ArrStufe{ArrInsArt::eq, 0, false}, ArrStufe{ArrInsArt::mb, 0, true, ArrSchluessel{cdj::ARR_SCHL_DECK, 1, cdj::ARR_SCHL_POST}}});   // a DJ key is raw (arrival 0)
    cdj::ArrSnapshot* sn = b.fertig();
    std::string m_zu, m_ok;
    const bool zu = cdj::arr_schluessel_versatz(*sn, &m_zu, LAT_EQ);
    const bool ok = cdj::arr_schluessel_versatz(*sn, &m_ok, LAT_EQ + 1);
    const int verz = sn->kette[0].st[1].schl_verz;
    std::printf("7: mb key delay %d: bound %d -> %s (\"%s\"); bound %d -> %s\n", verz, LAT_EQ, zu ? "loads" : "refused", m_zu.c_str(), LAT_EQ + 1, ok ? "loads" : "refused");
    PRUEF(!zu && m_zu.find("key_verzoegerung_zu_lang") != std::string::npos);
    PRUEF(ok && verz == LAT_EQ);
    delete sn;
  }

  PRUEF_ENDE();
}
