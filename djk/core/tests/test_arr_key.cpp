// 1.10 slice 5 U1: the structural sidechain key "track post" of a compressor stage, the track order that makes it available in the same block, and the key buffer
// zeroing (plan PLAN-1.10-slices5-8 U1, E8, section 3.1, 3.2).
// Cases: 1 ak13_kern (AK13 core: a bass ducked by a kick track through the row sc and through the structural key; own signal does not duck),
// 2 ak14_kern (AK14 core: a kick fader at -inf: the row (pre) keeps ducking, the structural post key does not),
// 3 post_gleich_post_tap (the post key buffer equals the post send tap of the same track sample for sample), 4 ordnung (a key from a HIGHER track works in the same block),
// 5 sc_stumme_quelle (a muted key track: the post key falls silent, the pre key does not), 6 zeroing (a source whose capture point does not run gives a silent key),
// 7 loader (the refusals and the order), 8 ohne_schluessel (the order is the identity without structural keys), 9 stille_quelle (a key from a track that is not in the project).
// Slice 5 U2a: 10 zellen_aus_vertrag (EVERY cell and EVERY case of docs/interfaces/schluessel_regeln.json against the loader), 11 gruppe_pre_post (group sources: pre follows the
// chain input and ignores the group fader, post follows both), 12 gruppe_verbraucher (a group keyed by another group's pre), 13 return_quellen (PM keyed by return pre/post), 13b return_kette (the return pre key is taken in front of the return's own chain),
// 14 sc_leere_gruppe and 15 sc_leerer_return (a source whose capture point stops running gives a silent key, with positive controls).
// Slice 5 U2b: 10 also walks the DJ list of the file (deck, erz, pad), 16 dj_lag (deck/1 and erz/1 against the row key: the same samples, the same onset, 0 samples), 17 sc_dj_null (a DJ input
// that goes away gives a silent key), 18 ausrichtung_a (an EQ in front of the consumer, row key and post key aligned), 19 ausrichtung_b (EQ on the track and a latency stage in the group chain
// in front of the group stage: the delay is the path sum), 20 spaet (a late post key: the lag is reported and measured), 21 bindung (a key that needs more delay than the ring holds is refused).
// Mutations (CMakeLists.txt): SC_POST_VOR_FADER (2), SC_ORDNUNG_FEST (4), SC_STRUKTUR_IGNORIERT (2), SC_KEIN_NULLEN (6, 14, 15, 17), SC_GRUPPE_NACH_KETTE (11, 12), SC_TABELLE_OFFEN (10), SC_RET_PRE_NACH_KETTE (13b),
// SC_DJ_NULL (16), SC_KEIN_VERSATZ (18, 19), SC_VERSATZ_EINE_STUFE (19).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <memory>
#include <fstream>
#include <sstream>
#include <string>
#include <tuple>
#include <vector>

#include <nlohmann/json.hpp>

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

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static void setze(Treiber& t, const char* pfad, float w) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  t.arr.setze_sofort(r, w);
}
static double db(double x) { return 20.0 * std::log10(x); }
static ArrSchluessel post_von(int nr) { return ArrSchluessel{cdj::ARR_SCHL_SPUR, static_cast<uint8_t>(nr), cdj::ARR_SCHL_POST}; }
static ArrSchluessel schl(uint8_t q, int nr, uint8_t punkt) { return ArrSchluessel{q, static_cast<uint8_t>(nr), punkt}; }

// the compressor of the bass: threshold -30 dB, ratio 8, hard knee, attack 1 ms, release `rel` ms, mix 1
static void komp_duck(Treiber& t, float rel = 100.0f, float sc_zeile = 0.0f) {
  setze(t, "ins/komp/1/an", 1.0f);
  setze(t, "ins/komp/1/schwelle", -30.0f);
  setze(t, "ins/komp/1/ratio", 8.0f);
  setze(t, "ins/komp/1/knie", 0.0f);
  setze(t, "ins/komp/1/attack", 1.0f);
  setze(t, "ins/komp/1/release", rel);
  setze(t, "ins/komp/1/mix", 1.0f);
  setze(t, "ins/komp/1/sc", sc_zeile);
}

// bass on track 1 with the stage (komp slot 0, key `key`), the key source on track `quelle_spur`
static cdj::ArrSnapshot* bau(const Audio* bass, const Audio* quelle, int quelle_spur, ArrSchluessel key, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
  b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, key}});
  if (quelle) b.spur(quelle_spur, ArrArt::audio).clip(quelle_spur, "c2", 0.0, 8.0, &quelle->a);
  return b.fertig();
}

// A run in blocks of 256: the gain reduction the stage reports after every block (index = block, end sample in `ende`)
struct Lauf {
  std::unique_ptr<Treiber> t = std::make_unique<Treiber>();
  std::vector<float> gr;
  std::vector<int64_t> ende;
  void bis(int64_t s_bis) {
    while (t->s < s_bis) {
      t->lauf(t->s + 256);
      gr.push_back(t->arr.inserts().gr_db(0));
      ende.push_back(t->s);
    }
  }
  void start(cdj::ArrSnapshot* s) {
    t->laden(s);
    t->arr.start(0.0, 2, false, 0, V, 256, t->k);
  }
  // the largest gain reduction of the blocks that end in (von, bis]
  float spitze(int64_t von, int64_t s_bis) const {
    float m = 0.0f;
    for (size_t i = 0; i < gr.size(); ++i)
      if (ende[i] > von && ende[i] <= s_bis) m = std::max(m, gr[i]);
    return m;
  }
};

int main() {
  auto bass = Audio::sinus(400000, 1000.0, 0.01f);      // -40 dBFS: under the threshold on its own
  auto klicks = Audio::klicks(400000, 22500);           // one-sample clicks on every beat (128 BPM = 22500 samples)
  auto laut = Audio::sinus(400000, 500.0, 0.5f);        // a loud continuous key

  // where the clicks land: a run with the kick track alone (the click is 1.0 on both channels, -3 dB after the pan law)
  std::vector<int64_t> klick_s;
  {
    Bau b(1);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &klicks->a);
    TR(t)
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(250000);
    for (size_t i = 0; i < t.pml.size(); ++i)
      if (std::fabs(t.pml[i]) > 0.3f) klick_s.push_back(static_cast<int64_t>(i));
  }
  PRUEF(klick_s.size() >= 5);   // positive control: the clicks are there and the reference run found them
  const int64_t BIS = 250000;
  // the clicks the checks use: all after the start of the track and with room for 10 ms after them
  auto in_fenster = [&](const Lauf& l, int64_t c) { return l.spitze(c, c + 480 + 256); };

  {  // 1 ak13_kern (AK13 core): the bass is ducked by >= 6 dB within 10 ms after each click of the kick track, through the row sc and through the structural key; its own signal < 1 dB
    Lauf zeile, struktur, eigen;
    zeile.start(bau(bass.get(), klicks.get(), 2, ArrSchluessel{}));
    komp_duck(*zeile.t, 100.0f, 2.0f);
    zeile.bis(BIS);
    struktur.start(bau(bass.get(), klicks.get(), 2, post_von(2)));
    komp_duck(*struktur.t, 100.0f, 0.0f);
    struktur.bis(BIS);
    eigen.start(bau(bass.get(), klicks.get(), 2, ArrSchluessel{}));
    komp_duck(*eigen.t, 100.0f, 0.0f);
    eigen.bis(BIS);
    float z_min = 1e9f, s_min = 1e9f;
    for (size_t k = 1; k < klick_s.size(); ++k) {
      z_min = std::min(z_min, in_fenster(zeile, klick_s[k]));
      s_min = std::min(s_min, in_fenster(struktur, klick_s[k]));
    }
    std::printf("1: AK13 core: lowest reduction in the 10 ms after a click: row sc %.2f dB, structural post %.2f dB; own signal highest %.3f dB\n", z_min, s_min,
                eigen.spitze(0, BIS));
    PRUEF(z_min >= 6.0f);
    PRUEF(s_min >= 6.0f);
    PRUEF(eigen.spitze(0, BIS) < 1.0f);
  }

  {  // 2 ak14_kern (AK14 core): the kick fader at -inf. The row sc is the track input before any fader: the reduction stays. The structural post key follows the fader: no reduction.
    auto lauf = [&](ArrSchluessel key, float zeile_sc, float kick_fader) {
      Lauf l;
      l.start(bau(bass.get(), laut.get(), 2, key));
      komp_duck(*l.t, 100.0f, zeile_sc);
      setze(*l.t, "spur/2/fader", kick_fader);
      l.bis(160000);
      return l;
    };
    const float zeile_0 = lauf(ArrSchluessel{}, 2.0f, 0.0f).spitze(120000, 160000);
    const float zeile_inf = lauf(ArrSchluessel{}, 2.0f, -200.0f).spitze(120000, 160000);
    const float post_0 = lauf(post_von(2), 0.0f, 0.0f).spitze(120000, 160000);
    const float post_inf = lauf(post_von(2), 0.0f, -200.0f).spitze(120000, 160000);
    std::printf("2: AK14 core: row sc: fader 0 %.2f dB, fader -inf %.2f dB; structural post: fader 0 %.2f dB, fader -inf %.2f dB\n", zeile_0, zeile_inf, post_0, post_inf);
    PRUEF(zeile_0 >= 6.0f);                          // positive control: the loud key ducks
    PRUEF(std::fabs(zeile_inf - zeile_0) <= 1.0f);   // pre: the fader does not matter
    PRUEF(post_0 >= 6.0f);                           // positive control: the post key at fader 0 ducks as much
    PRUEF(post_inf < 1.0f);                          // post: a key track pulled to -inf gives no reduction
  }

  {  // 3 post_gleich_post_tap: the post key buffer equals the post send tap of the same track (a return with the send at 0 dB, post), sample for sample
    Lauf l;
    cdj::ArrSnapshot* s = bau(bass.get(), laut.get(), 2, post_von(2));
    s->ret_da[0] = true;
    l.start(s);
    komp_duck(*l.t, 100.0f, 0.0f);
    setze(*l.t, "ret/1/hall/an", 0.0f);
    setze(*l.t, "spur/2/send/1", 0.0f);
    setze(*l.t, "spur/1/send/1", -200.0f);
    setze(*l.t, "spur/2/fader", -7.0f);   // a fader and a pan that do something: the tap and the key are after both
    setze(*l.t, "spur/2/pan", 0.4f);
    l.bis(150000);
    const float* kl = l.t->arr.inserts().schluessel_puffer(0, false);
    const float* kr = l.t->arr.inserts().schluessel_puffer(0, true);
    const float* tl = l.t->arr.returns().ein_gelesen_l(0);
    const float* tr = l.t->arr.returns().ein_gelesen_r(0);
    double groesste = 0.0, pegel = 0.0;
    for (int i = 0; i < 256; ++i) {
      groesste = std::max({groesste, static_cast<double>(std::fabs(kl[i] - tl[i])), static_cast<double>(std::fabs(kr[i] - tr[i]))});
      pegel = std::max(pegel, static_cast<double>(std::fabs(kl[i])));
    }
    std::printf("3: post key buffer against the post send tap over one block: largest difference %.3g, key level %.4f\n", groesste, pegel);
    PRUEF(pegel > 0.05);       // positive control: there is a signal to compare
    PRUEF(groesste == 0.0);
    PRUEF(std::memcmp(kl, tl, sizeof(float) * 256) == 0 && std::memcmp(kr, tr, sizeof(float) * 256) == 0);
  }

  {  // 4 ordnung: the key is the post of track 5, which sits AFTER the consumer (track 1) in the index order; it must be there in the same block
    cdj::ArrSnapshot* s = bau(bass.get(), klicks.get(), 5, post_von(5));
    int pos1 = -1, pos5 = -1;
    for (int i = 0; i < cdj::ARR_SPUREN; ++i) {
      if (s->spur_ordnung[i] == 0) pos1 = i;
      if (s->spur_ordnung[i] == 4) pos5 = i;
    }
    std::printf("4: order position of track 1: %d, of track 5: %d\n", pos1, pos5);
    PRUEF(pos5 >= 0 && pos5 < pos1);   // track 5 runs before track 1
    Lauf l;
    l.start(s);
    komp_duck(*l.t, 100.0f, 0.0f);
    l.bis(BIS);
    float tief = 1e9f;
    for (size_t k = 1; k < klick_s.size(); ++k) tief = std::min(tief, in_fenster(l, klick_s[k]));
    std::printf("4: lowest reduction in the 10 ms after a click of track 5: %.2f dB\n", tief);
    PRUEF(tief >= 6.0f);
  }

  {  // 5 sc_stumme_quelle: the key track is muted while it plays loud. The post key falls silent after the 10 ms mute fade; the pre key (row sc) is taken before the fade and keeps ducking.
    const int64_t T_MUTE = 130000;
    auto lauf = [&](ArrSchluessel key, float zeile_sc, bool stumm) {
      Lauf l;
      l.start(bau(bass.get(), laut.get(), 2, key));
      komp_duck(*l.t, 5.0f, zeile_sc);
      l.bis(T_MUTE);
      if (stumm) setze(*l.t, "spur/2/mute", 1.0f);
      l.bis(T_MUTE + 4096);
      return l;
    };
    const float vorher = lauf(post_von(2), 0.0f, true).spitze(T_MUTE - 2048, T_MUTE);
    const float post_stumm = lauf(post_von(2), 0.0f, true).spitze(T_MUTE + 2048, T_MUTE + 4096);
    const float post_laut = lauf(post_von(2), 0.0f, false).spitze(T_MUTE + 2048, T_MUTE + 4096);
    const float pre_stumm = lauf(ArrSchluessel{}, 2.0f, true).spitze(T_MUTE + 2048, T_MUTE + 4096);
    std::printf("5: reduction before the mute %.2f dB; after it: post key muted %.2f dB, post key unmuted (control) %.2f dB, pre key muted %.2f dB\n", vorher, post_stumm, post_laut, pre_stumm);
    PRUEF(vorher >= 6.0f);       // the key ducks before the mute
    PRUEF(post_laut >= 6.0f);    // positive control: unmuted it keeps ducking
    PRUEF(post_stumm < 1.0f);    // muted: the post key is silent, no reduction
    PRUEF(pre_stumm >= 6.0f);    // the pre key does not follow the mute
  }

  {  // 6 zeroing (plan 3.2): schluessel_planen() zeroes the key buffer of every listening slot; a block whose capture point does not run gives a silent key
    auto ins = std::make_unique<cdj::ArrInserts>();
    std::vector<cdj::ArrKette> ketten(cdj::ARR_KETTEN);
    ketten[0].n = 1;
    ketten[0].st[0] = ArrStufe{ArrInsArt::komp, 0, true, post_von(2)};
    ins->tausche(ketten.data());
    ins->schluessel_planen(256);
    PRUEF(ins->strukturell(0));
    float* l[cdj::ARR_INS_KOMP];
    float* r[cdj::ARR_INS_KOMP];
    const int n_ziele = ins->post_ziele(1, l, r);
    PRUEF(n_ziele == 1);
    PRUEF(ins->post_ziele(0, l, r) == 0);   // negative control: the post of another track is not listened to
    if (n_ziele == 1) {
      ins->post_ziele(1, l, r);
      for (int i = 0; i < 256; ++i) l[0][i] = r[0][i] = 0.5f;
      ins->post_fertig(1, 256);
    }
    PRUEF(ins->schluessel_puffer(0, false)[255] == 0.5f);   // the capture is there (positive control)
    ins->schluessel_planen(256);                            // the next block: no capture
    bool still = true;
    for (int i = 0; i < 256; ++i) still = still && ins->schluessel_puffer(0, false)[i] == 0.0f && ins->schluessel_puffer(0, true)[i] == 0.0f;
    PRUEF(still);
  }

  {  // 7 loader: the structural key from the playback file
    arrdatei::Ordner o("test_arr_schluessel");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const auto spur = [&](int nr, const std::string& kette) {
      return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + o.clip(("c" + std::to_string(nr)).c_str(), 0.0, 1.0, a, 48000) + "],\"chain\":[" + kette + "]}";
    };
    const auto komp = [](int slot, const std::string& key) {
      return "{\"art\":\"komp\",\"slot\":" + std::to_string(slot) + (key.empty() ? "" : ",\"key\":" + key) + "}";
    };
    const auto key = [](const std::string& q, int nr, const std::string& punkt) {
      return "{\"q\":\"" + q + "\",\"nr\":" + std::to_string(nr) + ",\"punkt\":\"" + punkt + "\"}";
    };
    int nr_datei = 100;
    const auto lade = [&](const std::string& s1, const std::string& s2) {
      const int64_t nr = nr_datei++;
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + s1 + "," + s2 + "]}");
      return cdj::lade_wiedergabe(o.pfad, nr, cache);
    };
    const auto grund = [&](const std::string& k1, const std::string& k2) {
      cdj::ArrLadeErgebnis x = lade(spur(1, k1), spur(2, k2));
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    {
      cdj::ArrLadeErgebnis e = lade(spur(1, komp(1, key("spur", 2, "post"))), spur(2, komp(2, "")));
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrStufe& st = e.snap->kette[0].st[0];
        PRUEF(st.key.quelle == cdj::ARR_SCHL_SPUR && st.key.nr == 2 && st.key.punkt == cdj::ARR_SCHL_POST);
        PRUEF(e.snap->spur_ordnung[0] == 1 && e.snap->spur_ordnung[1] == 0);   // track 2 runs before track 1; the rest keeps its place
        PRUEF(e.snap->spur_ordnung[2] == 2 && e.snap->spur_ordnung[31] == 31);
        PRUEF(e.snap->kette[1].st[0].key.quelle == cdj::ARR_SCHL_KEINE);       // no key where none was written
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(grund(komp(1, ""), komp(2, "")) == "+snap");                                                   // negative control: no key at all loads
    PRUEF(grund(komp(1, key("spur", 2, "post")), komp(2, key("spur", 1, "post"))) == "format");           // two-track post cycle
    PRUEF(grund(komp(1, key("spur", 1, "post")), komp(2, "")) == "format");                              // own post
    PRUEF(grund(komp(1, key("spur", 2, "post")), komp(2, key("spur", 3, "post"))) == "+snap");           // a chain of edges is fine (3 before 2 before 1)
    PRUEF(grund(komp(1, key("grp", 1, "post")), komp(2, "")) == "format");                               // other source kinds come in a later unit
    PRUEF(grund(komp(1, key("spur", 0, "post")), komp(2, "")) == "format");                              // number out of range
    PRUEF(grund(komp(1, key("spur", 33, "post")), komp(2, "")) == "format");
    PRUEF(grund(komp(1, key("spur", 2, "pre")), komp(2, "")) == "format");                               // (spur, pre) has one writer: the row sc
    PRUEF(grund(komp(1, key("spur", 2, "mitte")), komp(2, "")) == "format");
    PRUEF(grund(komp(1, "[1]"), komp(2, "")) == "format");                                               // not an object
    PRUEF(grund("{\"art\":\"eq\",\"slot\":1,\"key\":" + key("spur", 2, "post") + "}", komp(2, "")) == "format");   // only a compressor has a key
    PRUEF(grund("{\"art\":\"eq\",\"slot\":1}", komp(2, "")) == "+snap");                                  // control: the eq without a key loads
  }

  {  // 8 ohne_schluessel (negative control): without a structural key the order is the identity, a stage with only the row sc is unchanged
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
    b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a);
    cdj::ArrSnapshot* s = b.fertig();
    bool identisch = true;
    for (int i = 0; i < cdj::ARR_SPUREN; ++i) identisch = identisch && s->spur_ordnung[i] == i;
    PRUEF(identisch);
    delete s;
    // a key from a LOWER track index than the consumer needs no reordering either: consumer on track 3, key = post of track 1
    Bau c(1);
    c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &laut->a);
    c.spur(3, ArrArt::audio).clip(3, "c3", 0.0, 8.0, &bass->a);
    c.kette(3, {ArrStufe{ArrInsArt::komp, 0, true, post_von(1)}});
    cdj::ArrSnapshot* t = c.fertig();
    bool ident2 = true;
    for (int i = 0; i < cdj::ARR_SPUREN; ++i) ident2 = ident2 && t->spur_ordnung[i] == i;
    PRUEF(ident2);
    delete t;
  }

  {  // 9 stille_quelle: the key names a track that is not in the project: a silent key, no reduction, nothing non-finite (positive control: case 1 with a real track 2)
    Lauf l;
    l.start(bau(bass.get(), nullptr, 0, post_von(9)));
    komp_duck(*l.t, 100.0f, 0.0f);
    l.bis(160000);
    std::printf("9: key from a track that does not exist: reduction %.3f dB, non-finite count %llu\n", l.spitze(100000, 160000),
                static_cast<unsigned long long>(l.t->arr.inserts().nan_zaehler()));
    PRUEF(l.spitze(100000, 160000) < 0.5f);
    PRUEF(l.t->arr.inserts().nan_zaehler() == 0);
    PRUEF(l.t->arr.inserts().strukturell(0));   // the stage did listen to a structural key (so the silence is the key, not a stage that fell back to its own signal)
  }

  {  // 10 zellen_aus_vertrag (plan E20): EVERY cell of the table and EVERY case of docs/interfaces/schluessel_regeln.json against the loader. ja: loads; every other answer:
     // the loader refuses with `format` and names the reason of the answer (sidechain_spaet / _zyklus / _quelle). The track pre cell is the row sc: the structural form is refused.
    using json = nlohmann::json;
    const std::string pfad_json = std::string(CYPHERDJ_DJK) + "/../docs/interfaces/schluessel_regeln.json";
    std::ifstream in(pfad_json);
    PRUEF(in.good());
    std::stringstream ss;
    ss << in.rdbuf();
    const json v = json::parse(ss.str(), nullptr, false);
    PRUEF(!v.is_discarded());
    arrdatei::Ordner o("test_arr_schluessel_v");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    struct Fall {
      std::vector<std::pair<int, int>> spuren;   // number, group (0 = master)
      std::vector<int> gruppen, returns;
      std::vector<std::pair<std::string, json>> stufen;   // strip ("spur/1", "grp/2", "ret/1", "pm"), key object
    };
    int nr_datei = 300;
    int komp_slot = 0;
    const auto stufe = [&](const json& key) {
      return "{\"art\":\"komp\",\"slot\":" + std::to_string(++komp_slot) + ",\"key\":" + key.dump() + "}";
    };
    const auto lade = [&](const Fall& f, std::string* meldung) {
      komp_slot = 0;
      const auto kette_von = [&](const std::string& auf) {
        std::string c;
        for (const auto& s : f.stufen)
          if (s.first == auf) c += (c.empty() ? "" : ",") + stufe(s.second);
        return c.empty() ? std::string() : ",\"chain\":[" + c + "]";
      };
      std::string sp, gr, re, pm;
      for (const auto& s : f.spuren) {
        sp += (sp.empty() ? "" : ",") + std::string("{\"nr\":") + std::to_string(s.first) + ",\"art\":\"audio\",\"clips\":[" + o.clip(("c" + std::to_string(s.first)).c_str(), 0.0, 1.0, a, 48000) + "]" +
              (s.second ? ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string(s.second) + "}" : "") + kette_von("spur/" + std::to_string(s.first)) + "}";
      }
      for (int g : f.gruppen) gr += (gr.empty() ? "" : ",") + std::string("{\"nr\":") + std::to_string(g) + ",\"ausgang\":{\"art\":\"master\"}" + kette_von("grp/" + std::to_string(g)) + "}";
      for (int r : f.returns) re += (re.empty() ? "" : ",") + std::string("{\"nr\":") + std::to_string(r) + ",\"ausgang\":{\"art\":\"master\"}" + kette_von("ret/" + std::to_string(r)) + "}";
      const std::string pc = kette_von("pm");
      const int64_t nr = nr_datei++;
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + sp + "]" + (gr.empty() ? "" : ",\"gruppen\":[" + gr + "]") +
                    (re.empty() ? "" : ",\"returns\":[" + re + "]") + (pc.empty() ? "" : ",\"pm\":{" + pc.substr(1) + "}") + "}");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      if (meldung) *meldung = x.meldung;
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    // the check: erwartet is an answer of the contract or "nur_zeile"
    int geprueft = 0, abgelehnt = 0, geladen = 0;
    const auto pruefe_fall = [&](const std::string& name, const Fall& f, const std::string& erwartet) {
      std::string m;
      const std::string g = lade(f, &m);
      ++geprueft;
      if (erwartet == "ja") {
        ++geladen;
        if (g != "+snap") std::printf("10: %s: expected a load, got %s (%s)\n", name.c_str(), g.c_str(), m.c_str());
        PRUEF(g == "+snap");
      } else {
        ++abgelehnt;
        const std::string grund = erwartet == "nur_zeile" ? "row sc" : "sidechain_" + erwartet;
        const bool gut = g == "format" && m.find(grund) != std::string::npos;
        if (!gut) std::printf("10: %s: expected format/%s, got %s (%s)\n", name.c_str(), grund.c_str(), g.c_str(), m.c_str());
        PRUEF(gut);
      }
    };
    // (a) every cell. Fixture: tracks 1, 2, 3 (member of group 1), 4 (member of group 2); groups 1, 2; returns 1, 2. The consumer is spur/1, grp/1, ret/1 or pm; the source is
    // number 2 of its kind (track 2 is not a member of group 1, group 2 is not the consumer's group), so no dynamic rule interferes.
    const char* const art_name[4] = {"spur", "grp", "ret", "pm"};
    const std::string wer[4] = {"spur/1", "grp/1", "ret/1", "pm"};
    for (int vi = 0; vi < 4; ++vi)
      for (int qi = 0; qi < 4; ++qi)
        for (const char* punkt : {"pre", "post"}) {
          Fall f;
          f.spuren = {{1, 0}, {2, 0}, {3, 1}, {4, 2}};
          f.gruppen = {1, 2};
          f.returns = {1, 2};
          f.stufen.push_back({wer[vi], json{{"q", art_name[qi]}, {"nr", qi == 3 ? 0 : 2}, {"punkt", punkt}}});
          std::string antwort = v.at("zellen").at(art_name[vi]).at(art_name[qi]).at(punkt).get<std::string>();
          for (const auto& z : v.at("nur_zeile"))
            if (z.at("quelle") == art_name[qi] && z.at("punkt") == punkt) antwort = "nur_zeile";
          pruefe_fall(std::string("cell ") + art_name[vi] + "/" + art_name[qi] + "/" + punkt, f, antwort);
        }
    // (b) every case of the file
    for (const json& c : v.at("faelle")) {
      Fall f;
      for (const json& s : c.at("spuren")) f.spuren.push_back({s.at("nr").get<int>(), s.value("gruppe", 0)});
      if (c.contains("gruppen")) for (const json& g : c.at("gruppen")) f.gruppen.push_back(g.get<int>());
      if (c.contains("returns")) for (const json& r : c.at("returns")) f.returns.push_back(r.get<int>());
      for (const json& s : c.at("stufen")) f.stufen.push_back({s.at("auf").get<std::string>(), s.at("key")});
      pruefe_fall("case " + c.at("name").get<std::string>(), f, c.at("erwartet").get<std::string>());
    }
    // (b2) slice 5 U2b: the DJ sources of the file. erlaubt: loads for every consumer kind; zyklus / quelle: refused with the reason of the list; everything the list does not name is `quelle`.
    int dj_geprueft = 0;
    {
      const json& dj = v.at("dj");
      const auto pro_nummer = [&](const char* gruppe, const char* erwartet) {
        for (const json& e : dj.at(gruppe)) {
          const std::string q = e.at("quelle").get<std::string>();
          for (int nr = e.at("nr")[0].get<int>(); nr <= e.at("nr")[1].get<int>(); ++nr)
            for (int vi = 0; vi < 4; ++vi) {   // every consumer kind: a DJ input is there before the arrangement block for all of them
              Fall f;
              f.spuren = {{1, 0}};
              f.gruppen = {1};
              f.returns = {1};
              f.stufen.push_back({wer[vi], json{{"q", q}, {"nr", nr}}});
              pruefe_fall("dj " + q + "/" + std::to_string(nr) + " on " + wer[vi], f, erwartet);
              ++dj_geprueft;
            }
        }
      };
      pro_nummer("erlaubt", "ja");
      pro_nummer("zyklus", "zyklus");
      pro_nummer("quelle", "quelle");
      for (const auto& [q, nr] : std::vector<std::pair<std::string, int>>{{"deck", 5}, {"deck", 0}, {"erz", 9}, {"pad", 3}}) {   // not in the list at all
        Fall f;
        f.spuren = {{1, 0}};
        f.stufen.push_back({"spur/1", json{{"q", q}, {"nr", nr}}});
        pruefe_fall("dj " + q + "/" + std::to_string(nr) + " (not in the list)", f, "quelle");
        ++dj_geprueft;
      }
      {   // the punkt may be left out or given; a wrong one is refused; an unknown source name is refused as before
        Fall f;
        f.spuren = {{1, 0}};
        f.stufen.push_back({"spur/1", json{{"q", "deck"}, {"nr", 1}, {"punkt", "pre"}}});
        pruefe_fall("dj deck/1 with punkt pre", f, "ja");
        Fall g;
        g.spuren = {{1, 0}};
        g.stufen.push_back({"spur/1", json{{"q", "deck"}, {"nr", 1}, {"punkt", "mitte"}}});
        std::string m;
        PRUEF(lade(g, &m) == "format" && m.find("punkt") != std::string::npos);
        Fall h;
        h.spuren = {{1, 0}};
        h.stufen.push_back({"spur/1", json{{"q", "ein"}, {"nr", 1}}});
        PRUEF(lade(h, &m) == "format" && m.find("unbekannt") != std::string::npos);
        dj_geprueft += 3;
      }
      std::printf("10: DJ list of the file: %d keys checked\n", dj_geprueft);
      PRUEF(dj_geprueft >= 4 * (4 + 1) + 4 * 1 + 4 * (2 + 4 + 2) + 4 + 3);   // every number of every group on every consumer kind (deck 1..4, erz 1; erz 4; erz 2..3, 5..8, pad 1..2), the strangers, the punkt cases
    }
    PRUEF(dj_geprueft > 0);
    {   // the fields of a DJ key that loaded
      komp_slot = 0;
      const std::string s1 = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "],\"chain\":[{\"art\":\"komp\",\"slot\":1,\"key\":{\"q\":\"deck\",\"nr\":3}},{\"art\":\"komp\",\"slot\":2,\"key\":{\"q\":\"erz\",\"nr\":1,\"punkt\":\"post\"}}]}";
      const int64_t nr = nr_datei++;
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + s1 + "]}");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(x.snap != nullptr);
      if (x.snap) {
        const ArrSchluessel k1 = x.snap->kette[0].st[0].key, k2 = x.snap->kette[0].st[1].key;
        PRUEF(k1.quelle == cdj::ARR_SCHL_DECK && k1.nr == 3 && k1.punkt == cdj::ARR_SCHL_POST);
        PRUEF(k2.quelle == cdj::ARR_SCHL_ERZ && k2.nr == 1 && k2.punkt == cdj::ARR_SCHL_POST);
        PRUEF(x.snap->spur_ordnung[0] == 0 && x.snap->spur_ordnung[1] == 1);   // a DJ key makes no track edge
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
    }
    std::printf("10: contract: %d cells and cases checked: %d loaded, %d refused\n", geprueft, geladen, abgelehnt);
    PRUEF(geprueft == 4 * 4 * 2 + static_cast<int>(v.at("faelle").size()) + dj_geprueft - 2);   // dj_geprueft also counts the two direct loads of the punkt block, which pruefe_fall does not
    PRUEF(geladen >= 12 && abgelehnt >= 20);   // both outcomes were exercised (a table that answers everything the same way would be a dead check)
    // (c) the fields of what loaded: a group and a return key arrive in the snapshot
    {
      komp_slot = 0;
      const std::string s1 = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "],\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}}";
      const std::string r1 = "{\"nr\":2,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"komp\",\"slot\":1,\"key\":{\"q\":\"grp\",\"nr\":1,\"punkt\":\"pre\"}}]}";
      const std::string p1 = ",\"pm\":{\"chain\":[{\"art\":\"komp\",\"slot\":2,\"key\":{\"q\":\"ret\",\"nr\":2,\"punkt\":\"post\"}}]}";
      const int64_t nr = nr_datei++;
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + s1 + "],\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}],\"returns\":[" + r1 + "]" + p1 + "}");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(x.snap != nullptr);
      if (x.snap) {
        const ArrSchluessel k1 = x.snap->kette[cdj::ARR_KETTE_RET0 + 1].st[0].key;
        const ArrSchluessel k2 = x.snap->kette[cdj::ARR_KETTE_PM].st[0].key;
        PRUEF(k1.quelle == cdj::ARR_SCHL_GRP && k1.nr == 1 && k1.punkt == cdj::ARR_SCHL_PRE);
        PRUEF(k2.quelle == cdj::ARR_SCHL_RET && k2.nr == 2 && k2.punkt == cdj::ARR_SCHL_POST);
      }
      cdj::gib_wiedergabe(x.snap.release(), cache);
    }
  }

  // ---- runtime cases for the group and return sources. The consumer is a compressor (threshold -30 dB, ratio 8, hard knee) that reports gain reduction in slot `slot`.
  const auto komp_slot_ein = [&](Treiber& t, int slot, float rel = 100.0f) {
    const std::string p = "ins/komp/" + std::to_string(slot + 1) + "/";
    setze(t, (p + "an").c_str(), 1.0f);
    setze(t, (p + "schwelle").c_str(), -30.0f);
    setze(t, (p + "ratio").c_str(), 8.0f);
    setze(t, (p + "knie").c_str(), 0.0f);
    setze(t, (p + "attack").c_str(), 1.0f);
    setze(t, (p + "release").c_str(), rel);
    setze(t, (p + "mix").c_str(), 1.0f);
    setze(t, (p + "sc").c_str(), 0.0f);
  };
  // one run: gain reduction of the consumer (slot 0), the largest in (von, bis]
  const auto reduktion = [&](cdj::ArrSnapshot* s, const std::function<void(Treiber&)>& vor, int64_t bis) {
    Lauf l;
    l.start(s);
    komp_slot_ein(*l.t, 0);
    vor(*l.t);
    l.bis(bis);
    return l.spitze(bis - 40000, bis);
  };
  const auto nichts = [](Treiber&) {};

  {  // 11 gruppe_pre_post: the consumer is the compressor of return 1; the key is group 1. Group 1 holds the loud track 2. pre = the group sum before its chain, post = after the group fader.
    const auto projekt = [&](ArrSchluessel key, bool gruppen_kette) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a).ausgang(2, 1);
      b.ret_kette(1, {ArrStufe{ArrInsArt::komp, 0, true, key}});
      if (gruppen_kette) b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 1, true}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      return s;
    };
    const auto fader = [&](float db_g) { return [db_g](Treiber& t) { setze(t, "ret/1/hall/an", 0.0f); setze(t, "grp/1/fader", db_g); }; };
    const float pre_0 = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_PRE), false), fader(0.0f), 160000);
    const float pre_inf = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_PRE), false), fader(-200.0f), 160000);
    const float post_0 = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_POST), false), fader(0.0f), 160000);
    const float post_inf = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_POST), false), fader(-200.0f), 160000);
    std::printf("11: group key on a return stage: pre: fader 0 %.2f dB, fader -inf %.2f dB; post: fader 0 %.2f dB, fader -inf %.2f dB\n", pre_0, pre_inf, post_0, post_inf);
    PRUEF(pre_0 >= 6.0f);                         // positive control: the loud group ducks
    PRUEF(std::fabs(pre_inf - pre_0) <= 1.0f);    // pre: the group fader does not matter
    PRUEF(post_0 >= 6.0f);                        // positive control for post
    PRUEF(post_inf < 1.0f);                       // post: a group pulled to -inf gives no reduction
    // the group has a chain that squashes the sum (-40 dB, ratio 20): pre is the sum BEFORE it, so the key stays loud
    const auto mit_kette = [](Treiber& t) {
      setze(t, "ret/1/hall/an", 0.0f);
      setze(t, "ins/komp/2/an", 1.0f);
      setze(t, "ins/komp/2/schwelle", -40.0f);
      setze(t, "ins/komp/2/ratio", 20.0f);
      setze(t, "ins/komp/2/knie", 0.0f);
      setze(t, "ins/komp/2/attack", 1.0f);
      setze(t, "ins/komp/2/mix", 1.0f);
      setze(t, "ins/komp/2/sc", 0.0f);
    };
    const float pre_kette = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_PRE), true), mit_kette, 160000);
    const float post_kette = reduktion(projekt(schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_POST), true), mit_kette, 160000);
    std::printf("11: group with a squashing chain: pre key %.2f dB, post key (control) %.2f dB\n", pre_kette, post_kette);
    PRUEF(pre_kette >= 6.0f);    // pre = before the group chain
    PRUEF(post_kette < 6.0f);    // control: post = after the chain, which is quiet
  }

  {  // 12 gruppe_verbraucher: group 2 (quiet bass, -40 dBFS) keyed by the pre of group 1 (the loud track 2). The sums are copied before ANY group chain, so group 2 sees group 1 before its chain.
    const auto projekt = [&](bool mit_mitglied, bool kette1) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a).ausgang(2, mit_mitglied ? 1 : 0);
      b.spur(3, ArrArt::audio).clip(3, "c3", 0.0, 8.0, &bass->a).ausgang(3, 2);
      b.gruppen_kette(2, {ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_PRE)}});
      if (kette1) b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 1, true}});
      return b.fertig();
    };
    const auto mit_kette = [](Treiber& t) {
      setze(t, "ins/komp/2/an", 1.0f);
      setze(t, "ins/komp/2/schwelle", -40.0f);
      setze(t, "ins/komp/2/ratio", 20.0f);
      setze(t, "ins/komp/2/knie", 0.0f);
      setze(t, "ins/komp/2/attack", 1.0f);
      setze(t, "ins/komp/2/mix", 1.0f);
      setze(t, "ins/komp/2/sc", 0.0f);
    };
    const float mit = reduktion(projekt(true, false), nichts, 160000);
    const float mit_k = reduktion(projekt(true, true), mit_kette, 160000);
    const float ohne = reduktion(projekt(false, false), nichts, 160000);
    std::printf("12: group 2 keyed by group 1 pre: with the member %.2f dB, with a squashing chain on group 1 %.2f dB, group 1 without member (control) %.2f dB\n", mit, mit_k, ohne);
    PRUEF(mit >= 6.0f);     // positive control
    PRUEF(mit_k >= 6.0f);   // before group 1's chain, whatever the chain does
    PRUEF(ohne < 1.0f);     // group 1 has no member: silent key
  }

  {  // 13 return_quellen: the compressor of the PM keyed by return 1. Track 2 (loud) sends 0 dB into return 1 (Hall off). pre = the return input before its fader, post = after fader and fades.
    const auto projekt = [&](ArrSchluessel key, bool ret_da) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a);
      b.pm_kette({ArrStufe{ArrInsArt::komp, 0, true, key}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = ret_da;
      return s;
    };
    const auto lauf = [&](ArrSchluessel key, float rfader, bool ret_da = true, bool mit_send = true) {
      return reduktion(projekt(key, ret_da), [&](Treiber& t) {
        setze(t, "ret/1/hall/an", 0.0f);
        setze(t, "ret/1/fader", rfader);
        setze(t, "spur/2/send/1", mit_send ? 0.0f : -200.0f);
      }, 160000);
    };
    const float pre_0 = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_PRE), 0.0f);
    const float pre_inf = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_PRE), -200.0f);
    const float post_0 = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST), 0.0f);
    const float post_inf = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST), -200.0f);
    const float fehlt = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST), 0.0f, false);
    const float kein_send = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST), 0.0f, true, false);
    std::printf("13: PM keyed by return 1: pre: fader 0 %.2f dB, fader -inf %.2f dB; post: fader 0 %.2f dB, fader -inf %.2f dB; return not in the project %.2f dB; no send %.2f dB\n", pre_0, pre_inf,
                post_0, post_inf, fehlt, kein_send);
    PRUEF(pre_0 >= 6.0f && post_0 >= 6.0f);       // positive controls
    PRUEF(std::fabs(pre_inf - pre_0) <= 1.0f);    // pre: the return fader does not matter
    PRUEF(post_inf < 1.0f);                       // post: follows the fader
    PRUEF(fehlt < 1.0f && kein_send < 1.0f);      // silent sources give a silent key
  }

  {  // 13b return_kette: return 1 HAS an insert chain (the "vorgemischt" path: the blend is written over the input and the chain runs in place). The PM compressor is keyed by return 1.
     // pre = the blend as it goes INTO the chain, so a chain that squashes the return does not touch it; post = after the chain, so the key is quiet (control).
    const auto projekt = [&](ArrSchluessel key) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a);
      b.ret_kette(1, {ArrStufe{ArrInsArt::komp, 1, true}});
      b.pm_kette({ArrStufe{ArrInsArt::komp, 0, true, key}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = true;
      return s;
    };
    const auto lauf = [&](ArrSchluessel key, float rfader) {
      return reduktion(projekt(key), [&](Treiber& t) {
        setze(t, "ret/1/hall/an", 0.0f);
        setze(t, "ret/1/fader", rfader);
        setze(t, "spur/2/send/1", 0.0f);
        setze(t, "ins/komp/2/an", 1.0f);
        setze(t, "ins/komp/2/schwelle", -40.0f);
        setze(t, "ins/komp/2/ratio", 20.0f);
        setze(t, "ins/komp/2/knie", 0.0f);
        setze(t, "ins/komp/2/attack", 1.0f);
        setze(t, "ins/komp/2/mix", 1.0f);
        setze(t, "ins/komp/2/sc", 0.0f);
      }, 160000);
    };
    const float pre_0 = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_PRE), 0.0f);
    const float pre_inf = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_PRE), -200.0f);
    const float post_0 = lauf(schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST), 0.0f);
    std::printf("13b: return with a squashing chain: pre key %.2f dB (fader -inf %.2f dB), post key (control) %.2f dB\n", pre_0, pre_inf, post_0);
    PRUEF(pre_0 >= 6.0f);                         // pre = the blend before the chain: stays loud
    PRUEF(std::fabs(pre_inf - pre_0) <= 1.0f);    // pre ignores the return fader
    PRUEF(post_0 < 6.0f);                         // control: post = after the chain, which is quiet
  }

  {  // 14 sc_leere_gruppe: the PM compressor keyed by the post of group 1. First the member is in the group (the key is loud), then a new snapshot sends it to the master: the group has no
     // member, its capture point stops running. The key must be silent then, not the samples of the last block (positive control: the same run without the swap keeps ducking).
    const auto projekt = [&](bool mitglied) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a).ausgang(2, mitglied ? 1 : 0);
      b.pm_kette({ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_GRP, 1, cdj::ARR_SCHL_POST)}});
      return b.fertig();
    };
    const auto lauf = [&](bool tausch) {
      Lauf l;
      l.start(projekt(true));
      komp_slot_ein(*l.t, 0, 5.0f);
      l.bis(130000);
      const float vorher = l.spitze(128000, 130000);
      if (tausch) l.t->laden(projekt(false));
      l.bis(130000 + 8192);
      return std::make_pair(vorher, l.spitze(130000 + 4096, 130000 + 8192));
    };
    const auto mit_tausch = lauf(true);
    const auto ohne_tausch = lauf(false);
    std::printf("14: group key: before the swap %.2f dB; after the member left: %.3f dB, without the swap (control) %.2f dB\n", mit_tausch.first, mit_tausch.second, ohne_tausch.second);
    PRUEF(mit_tausch.first >= 6.0f);    // the key ducked while the member was there
    PRUEF(ohne_tausch.second >= 6.0f);  // positive control: with the member it keeps ducking
    PRUEF(mit_tausch.second < 1.0f);    // no member: silent key
  }

  {  // 15 sc_leerer_return: the PM compressor keyed by the post of return 1; a new snapshot without the return: it fades out and does not compute any more. The key must go silent.
    const auto projekt = [&](bool ret_da) {
      Bau b(1);
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &laut->a);
      b.pm_kette({ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_RET, 1, cdj::ARR_SCHL_POST)}});
      cdj::ArrSnapshot* s = b.fertig();
      s->ret_da[0] = ret_da;
      return s;
    };
    const auto lauf = [&](bool tausch) {
      Lauf l;
      l.start(projekt(true));
      komp_slot_ein(*l.t, 0, 5.0f);
      setze(*l.t, "ret/1/hall/an", 0.0f);
      setze(*l.t, "spur/2/send/1", 0.0f);
      l.bis(130000);
      const float vorher = l.spitze(128000, 130000);
      if (tausch) l.t->laden(projekt(false));
      l.bis(130000 + 8192);
      return std::make_pair(vorher, l.spitze(130000 + 4096, 130000 + 8192));
    };
    const auto mit_tausch = lauf(true);
    const auto ohne_tausch = lauf(false);
    std::printf("15: return key: before the swap %.2f dB; after the return left: %.3f dB, without the swap (control) %.2f dB\n", mit_tausch.first, mit_tausch.second, ohne_tausch.second);
    PRUEF(mit_tausch.first >= 6.0f);
    PRUEF(ohne_tausch.second >= 6.0f);
    PRUEF(mit_tausch.second < 1.0f);
  }

  // ---- slice 5 U2b: DJ sources and key alignment (plan E6, E7, E9). The runs hand the DJ inputs through Treiber::dj_sig (Arrangement::dj_schluessel before every block). The reduction is measured
  // on the PM tap of the bass: a reference run with a silent key (same mechanism, no key signal) is bit-identical to a keyed run until the reduction starts, so the first sample where the two
  // differ is the onset of the reduction to the sample.
  const int LAT_EQ = cdj::ins_latenz(ArrInsArt::eq), LAT_SAETT = cdj::ins_latenz(ArrInsArt::saett);   // from the modules, never hard-coded
  std::printf("U2b: latency of the eq stage %d samples, of the saturator %d samples\n", LAT_EQ, LAT_SAETT);
  PRUEF(LAT_EQ > 0 && LAT_SAETT > 0);   // without a latency the alignment cases would prove nothing
  std::vector<float> dj_klick(400000, 0.0f);   // one-sample clicks at the samples the clean run found (the raw input of track 2)
  for (int64_t c : klick_s)
    if (c < 400000) dj_klick[static_cast<size_t>(c)] = 1.0f;
  const int64_t K1 = klick_s[1];   // the click the onsets are measured at (the first one lies in the start-up)
  const auto onset = [](const std::vector<float>& ref, const std::vector<float>& x, int64_t von, int64_t bis) -> int64_t {   // first sample in [von, bis) where the runs differ, -1 none
    for (int64_t i = von; i < bis && i < static_cast<int64_t>(ref.size()) && i < static_cast<int64_t>(x.size()); ++i)
      if (ref[i] != x[i]) return i;
    return -1;
  };
  struct Ausgabe {
    std::vector<float> pml;
    float gr = 0.0f;               // largest gain reduction reported by the stage of slot `slot` in (K1, K1 + 15 ms]
    int verzug = -1, spaet = -1;   // the key delay and lag the stage works with in the last block
  };
  const auto fahre = [&](cdj::ArrSnapshot* snap, const std::function<void(Treiber&)>& vor, int64_t bis = 0, int dj_eingang = -1, int dj_versatz = 0) {   // bis 0: until 6000 samples after the click K1
    Ausgabe a;
    if (bis == 0) bis = K1 + 6000;
    auto tp = std::make_unique<Treiber>();
    Treiber& t = *tp;
    if (dj_eingang >= 0) {
      t.dj_sig_an = true;
      t.dj_sig[dj_eingang].assign(dj_klick.size(), 0.0f);
      for (size_t i = 0; i + static_cast<size_t>(dj_versatz) < dj_klick.size(); ++i) t.dj_sig[dj_eingang][i + static_cast<size_t>(dj_versatz)] = dj_klick[i];
    }
    t.laden(snap);
    vor(t);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    float gr = 0.0f;
    while (t.s < bis) {
      t.lauf(t.s + 256);
      if (t.s > K1 && t.s <= K1 + 480 + 256) gr = std::max(gr, t.arr.inserts().gr_db(0));
    }
    a.pml = t.pml;
    a.gr = gr;
    a.verzug = t.arr.inserts().schluessel_verzug(0);
    a.spaet = t.arr.inserts().schluessel_spaet(0);
    return a;
  };
  const auto vor_schl = [&](float sc_zeile) { return [sc_zeile](Treiber& t) { komp_duck(t, 5.0f, sc_zeile); setze(t, "spur/2/fader", -200.0f); }; };   // release 5 ms: the reduction of the click before has died out to the last bit when the next one comes   // the key track is not heard

  {  // 16 dj_lag (plan E6, open flank 2): deck/1 and erz/1 reach the stage in the block they are handed in. A bass is ducked by the DJ input; the same click on the raw input of track 2 keys another
     // run through the row sc. The two runs are bit-identical over the whole run, so the onset differs by 0 samples; a click handed one sample later moves the onset (the measure resolves one sample).
    const auto projekt = [&](ArrSchluessel key) {
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
      b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, key}});
      b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &klicks->a);
      return b.fertig();
    };
    const ArrSchluessel k_deck = schl(cdj::ARR_SCHL_DECK, 1, cdj::ARR_SCHL_POST), k_erz = schl(cdj::ARR_SCHL_ERZ, 1, cdj::ARR_SCHL_POST);
    const Ausgabe ref = fahre(projekt(k_deck), vor_schl(0.0f));                                  // silent key: nobody hands a signal
    const Ausgabe deck = fahre(projekt(k_deck), vor_schl(0.0f), 0, 0);
    const Ausgabe erz = fahre(projekt(k_erz), vor_schl(0.0f), 0, 4);
    const Ausgabe zeile = fahre(projekt(ArrSchluessel{}), vor_schl(2.0f));
    const Ausgabe deck_spaeter = fahre(projekt(k_deck), vor_schl(0.0f), 0, 0, 1);
    const Ausgabe deck_zwei = fahre(projekt(schl(cdj::ARR_SCHL_DECK, 2, cdj::ARR_SCHL_POST)), vor_schl(0.0f), 0, 0);   // another deck: silent key (negative control)
    const int64_t o_deck = onset(ref.pml, deck.pml, K1 - 2, K1 + 3000), o_erz = onset(ref.pml, erz.pml, K1 - 2, K1 + 3000), o_zeile = onset(ref.pml, zeile.pml, K1 - 2, K1 + 3000);
    const int64_t o_spaeter = onset(ref.pml, deck_spaeter.pml, K1 - 2, K1 + 3000);
    std::printf("16: DJ lag: click on the raw input at sample %lld; onset of the reduction: row key %lld, deck/1 %lld, erz/1 %lld (lag against the row key: deck/1 %lld samples, erz/1 %lld samples); the click "
                "handed one sample later: onset %lld; reduction deck/1 %.2f dB, erz/1 %.2f dB, another deck (control) %.2f dB\n",
                static_cast<long long>(K1), static_cast<long long>(o_zeile), static_cast<long long>(o_deck), static_cast<long long>(o_erz), static_cast<long long>(o_deck - o_zeile),
                static_cast<long long>(o_erz - o_zeile), static_cast<long long>(o_spaeter), deck.gr, erz.gr, deck_zwei.gr);
    PRUEF(o_zeile >= K1 && o_zeile < K1 + 50);   // positive control: the row key ducks right at the click
    PRUEF(deck.gr >= 6.0f && erz.gr >= 6.0f);    // the DJ keys duck as much
    PRUEF(deck_zwei.gr < 1.0f && ref.gr < 1.0f); // negative controls: another deck, and no signal at all, do not duck
    PRUEF(o_deck == o_zeile && o_erz == o_zeile);   // 0 samples
    PRUEF(deck.pml.size() == zeile.pml.size() && std::memcmp(deck.pml.data(), zeile.pml.data(), sizeof(float) * deck.pml.size()) == 0);   // the whole run is bit-identical
    PRUEF(erz.pml.size() == zeile.pml.size() && std::memcmp(erz.pml.data(), zeile.pml.data(), sizeof(float) * erz.pml.size()) == 0);
    PRUEF(o_spaeter == o_zeile + 1);   // the instrument sees one sample
  }

  {  // 17 sc_dj_null (plan 3.2): the DJ input goes away - the kernel hands a nullptr entry, calls with nullptr arrays, or does not call at all. The key is silent from the next block on, never the
     // samples of the block before. Positive control: the same run where the deck keeps playing keeps ducking.
    std::vector<float> mono(400000);
    for (size_t i = 0; i < mono.size(); ++i) mono[i] = laut->d[2 * i];
    const int64_t T = 100000;
    const auto lauf = [&](int art) {   // 0 deck keeps playing, 1 entry nullptr, 2 arrays nullptr, 3 no call
      Bau b(1);
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
      b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_DECK, 1, cdj::ARR_SCHL_POST)}});
      auto tp = std::make_unique<Treiber>();
      Treiber& t = *tp;
      t.vor_block = [&](int64_t s0) {
        const bool da = s0 < T || art == 0;
        const float* l[cdj::Arrangement::DJ_EINGAENGE] = {};
        if (da) l[0] = mono.data() + s0;
        if (!da && art == 3) return;
        if (!da && art == 2) t.arr.dj_schluessel(nullptr, nullptr);
        else t.arr.dj_schluessel(l, l);
      };
      t.laden(b.fertig());
      komp_duck(t, 5.0f, 0.0f);
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      float vorher = 0.0f, nachher = 0.0f;
      while (t.s < T + 8192) {
        t.lauf(t.s + 256);
        const float g = t.arr.inserts().gr_db(0);
        if (t.s > T - 2048 && t.s <= T) vorher = std::max(vorher, g);
        if (t.s > T + 4096) nachher = std::max(nachher, g);
      }
      return std::make_pair(vorher, nachher);
    };
    const auto weiter = lauf(0), eintrag = lauf(1), felder = lauf(2), kein_aufruf = lauf(3);
    std::printf("17: DJ input gone: before %.2f dB; later: deck keeps playing (control) %.2f dB, entry nullptr %.3f dB, arrays nullptr %.3f dB, no call %.3f dB\n", weiter.first, weiter.second,
                eintrag.second, felder.second, kein_aufruf.second);
    PRUEF(weiter.first >= 6.0f && eintrag.first >= 6.0f && felder.first >= 6.0f && kein_aufruf.first >= 6.0f);   // all of them ducked before
    PRUEF(weiter.second >= 6.0f);   // positive control
    PRUEF(eintrag.second < 1.0f && felder.second < 1.0f && kein_aufruf.second < 1.0f);
  }

  // ---- alignment cases (plan E9). The stages that carry a latency are in bypass (project flag off): they only delay, like a bypassed EQ in a chain does (D10). Every case compares the onset of the
  // reduction with the onset of the same project WITHOUT the latency stages (the response of the detector to this click): the alignment is right when the difference is exactly the latency of the
  // path in front of the consumer, i.e. when the key reaches the stage at the time its own audio click does. The key track (2) is heard in every run; the reference run keys the stage with a
  // track that is not in the project (9, a silent key), so it differs from the keyed run exactly where the reduction acts.
  const auto bass_klick = [&](const std::function<void(Bau&, int)>& form, int key_spur) {
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &bass->a);
    form(b, key_spur);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &klicks->a);
    return b.fertig();
  };
  const auto versatz_von = [&](const std::function<void(Bau&, int)>& form, bool zeile) {
    const auto vor = [&](int key_spur) { return [=](Treiber& t) { komp_duck(t, 5.0f, zeile ? static_cast<float>(key_spur) : 0.0f); }; };
    const Ausgabe ref = fahre(bass_klick(form, 9), vor(9));
    const Ausgabe lauf = fahre(bass_klick(form, 2), vor(2));
    const int64_t o = onset(ref.pml, lauf.pml, K1 - 2, K1 + 3000);
    return std::make_tuple(o < 0 ? INT64_MIN : o - K1, lauf);   // onset relative to the click on the raw input
  };

  {  // 18 ausrichtung_a: one EQ in front of the consumer, on its own strip. (1) Row key (track 2 input, arrival 0): the stage input is LAT_EQ late, the key is delayed by it. (2) Post key of track 2: it is
     // captured after the alignment of the tracks (T_trk = LAT_EQ): it meets the stage input without a ring. Each against the same project without the EQ.
    const auto eq_aus = ArrStufe{ArrInsArt::eq, 0, false};
    const auto row0 = versatz_von([&](Bau& b, int) { b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}}); }, true);
    const auto rowa = versatz_von([&](Bau& b, int) { b.kette(1, {eq_aus, ArrStufe{ArrInsArt::komp, 0, true}}); }, true);
    const auto post0 = versatz_von([&](Bau& b, int k) { b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, post_von(k)}}); }, false);
    const auto posta = versatz_von([&](Bau& b, int k) { b.kette(1, {eq_aus, ArrStufe{ArrInsArt::komp, 0, true, post_von(k)}}); }, false);
    const int64_t d_row = std::get<0>(rowa) - std::get<0>(row0), d_post = std::get<0>(posta) - std::get<0>(post0);
    std::printf("18: one EQ (%d samples) in front of the consumer: onset against the project without EQ: row key %lld samples (key delay in the stage %d), post key %lld samples (key delay %d, lag %d); "
                "reduction %.2f / %.2f dB; without EQ: onset after the click row %lld, post %lld\n",
                LAT_EQ, static_cast<long long>(d_row), std::get<1>(rowa).verzug, static_cast<long long>(d_post), std::get<1>(posta).verzug, std::get<1>(posta).spaet, std::get<1>(rowa).gr, std::get<1>(posta).gr,
                static_cast<long long>(std::get<0>(row0)), static_cast<long long>(std::get<0>(post0)));
    PRUEF(std::get<0>(row0) != INT64_MIN && std::get<0>(post0) != INT64_MIN && std::get<0>(rowa) != INT64_MIN && std::get<0>(posta) != INT64_MIN);   // every run ducked (positive control)
    PRUEF(std::get<1>(rowa).gr >= 6.0f && std::get<1>(posta).gr >= 6.0f);
    PRUEF(d_row == LAT_EQ);                          // the reduction starts when the audio click reaches the stage: LAT_EQ after the raw click, as the audio does
    PRUEF(std::get<1>(rowa).verzug == LAT_EQ);       // the delay is the latency of the path in front of the stage
    PRUEF(d_post == LAT_EQ);                         // the post key is aligned by the alignment of the tracks already
    PRUEF(std::get<1>(posta).verzug == 0 && std::get<1>(posta).spaet == 0);   // and needs no ring
    PRUEF(std::get<1>(row0).verzug == 0);            // negative control: nothing in front of the stage, no delay
  }

  {  // 19 ausrichtung_b (path sum): EQ on the track plus a latency stage (the saturator, bypassed) in the group chain in front of the group's compressor. The group compressor is keyed by the row sc of
     // track 2: the key is delayed by the SUM of the two latencies. Against the same project without the latency stages the onset moves by LAT_EQ + LAT_SAETT.
    const auto ohne = versatz_von([&](Bau& b, int) {
      b.spur(1, ArrArt::audio).ausgang(1, 1);
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
    }, true);
    const auto mit = versatz_von([&](Bau& b, int) {
      b.spur(1, ArrArt::audio).ausgang(1, 1);
      b.kette(1, {ArrStufe{ArrInsArt::eq, 0, false}});
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::saett, 0, false}, ArrStufe{ArrInsArt::komp, 0, true}});
    }, true);
    const int64_t d = std::get<0>(mit) - std::get<0>(ohne);
    std::printf("19: path sum: EQ on the track (%d) + saturator in the group chain (%d) in front of the group compressor: onset moved by %lld samples (sum %d), key delay in the stage %d, reduction %.2f dB\n",
                LAT_EQ, LAT_SAETT, static_cast<long long>(d), LAT_EQ + LAT_SAETT, std::get<1>(mit).verzug, std::get<1>(mit).gr);
    PRUEF(std::get<0>(ohne) != INT64_MIN && std::get<0>(mit) != INT64_MIN && std::get<1>(mit).gr >= 6.0f);
    PRUEF(d == LAT_EQ + LAT_SAETT);
    PRUEF(std::get<1>(mit).verzug == LAT_EQ + LAT_SAETT);
  }

  {  // 20 spaet: the consumer has nothing in front of it, but another track carries an EQ, so the tracks are aligned to LAT_EQ and the post key of track 2 arrives LAT_EQ after the stage input. The key
     // is used as it is; the lag is reported (snapshot field and stage reading) and it is what the measurement shows. The EQ on track 6 also delays the output of the consumer's track (alignment of the
     // tracks), which a row key (aligned, nothing in front of the stage) shows alone; the lag is the onset shift of the post key minus that.
    const auto post_0 = [&](Bau& b, int k) { b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, post_von(k)}}); };
    const auto mit_eq6 = [&](Bau& b) {
      b.spur(6, ArrArt::audio).clip(6, "c6", 0.0, 8.0, &bass->a);
      b.kette(6, {ArrStufe{ArrInsArt::eq, 0, false}});
    };
    const auto post_6 = [&](Bau& b, int k) { post_0(b, k); mit_eq6(b); };
    const auto zeile_0 = [&](Bau& b, int) { b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true}}); };
    const auto zeile_6 = [&](Bau& b, int k) { zeile_0(b, k); mit_eq6(b); };
    const auto p0 = versatz_von(post_0, false), p6 = versatz_von(post_6, false), z0 = versatz_von(zeile_0, true), z6 = versatz_von(zeile_6, true);
    cdj::ArrSnapshot* sn = bass_klick(post_6, 2);
    const int gemeldet = sn->kette[0].st[0].schl_spaet, verz = sn->kette[0].st[0].schl_verz;
    delete sn;
    const int64_t ausgang_ = std::get<0>(z6) - std::get<0>(z0);                       // the output of track 1 is aligned to the EQ track: LAT_EQ later
    const int64_t gemessen = (std::get<0>(p6) - std::get<0>(p0)) - ausgang_;          // what is left is the lag of the key
    std::printf("20: late post key: snapshot lag %d samples, delay %d; stage reading lag %d; measured: output shift of the aligned track %lld, onset shift of the post key %lld, so the key lags %lld samples (the EQ is %d)\n",
                gemeldet, verz, std::get<1>(p6).spaet, static_cast<long long>(ausgang_), static_cast<long long>(std::get<0>(p6) - std::get<0>(p0)), static_cast<long long>(gemessen), LAT_EQ);
    PRUEF(std::get<0>(p0) != INT64_MIN && std::get<0>(p6) != INT64_MIN && std::get<0>(z0) != INT64_MIN && std::get<0>(z6) != INT64_MIN && std::get<1>(p6).gr >= 6.0f);   // every run ducked
    PRUEF(gemeldet == LAT_EQ && verz == 0);
    PRUEF(std::get<1>(p6).spaet == LAT_EQ);
    PRUEF(ausgang_ == LAT_EQ);
    PRUEF(gemessen == LAT_EQ);   // the lag that is shown is the lag that is there
    PRUEF(std::get<1>(p0).spaet == 0 && std::get<1>(z6).spaet == 0 && std::get<1>(z6).verzug == 0);   // negative controls: no EQ anywhere, no lag; a row key with nothing in front of the stage needs no delay
  }

  {  // 21 bindung (plan E9, ring bound): a structural key that would need a delay of `grenze` samples or more is refused with the needed and the maximal delay; one sample more room loads. The real bound
     // (ARR_SCHL_VERZ_MAX) is not reachable with the pools (one EQ, one saturator), so the check function takes a smaller one.
    const auto form = [&](Bau& b, int) {
      b.spur(1, ArrArt::audio).ausgang(1, 1);
      b.kette(1, {ArrStufe{ArrInsArt::eq, 0, false}});
      b.gruppen_kette(1, {ArrStufe{ArrInsArt::saett, 0, false}, ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_DECK, 1, cdj::ARR_SCHL_POST)}});
    };
    cdj::ArrSnapshot* sn = bass_klick(form, 2);
    const int noetig = LAT_EQ + LAT_SAETT;   // a DJ key is raw (arrival 0); the group compressor input arrives after both stages
    std::string m_zu, m_ok;
    const bool zu = cdj::arr_schluessel_versatz(*sn, &m_zu, noetig);        // d == grenze: refused
    const bool ok = cdj::arr_schluessel_versatz(*sn, &m_ok, noetig + 1);    // d < grenze: fits
    const int verz = sn->kette[cdj::ARR_SPUREN].st[1].schl_verz;
    const bool real = cdj::arr_schluessel_versatz(*sn);                      // the real bound
    std::printf("21: key delay %d samples: bound %d -> %s (\"%s\"); bound %d -> %s, delay %d; real bound %d -> %s\n", noetig, noetig, zu ? "loads" : "refused", m_zu.c_str(), noetig + 1,
                ok ? "loads" : "refused", verz, cdj::ARR_SCHL_VERZ_MAX, real ? "loads" : "refused");
    PRUEF(!zu);
    PRUEF(m_zu.find(std::to_string(noetig)) != std::string::npos && m_zu.find(std::to_string(noetig - 1)) != std::string::npos);   // names the needed and the maximal delay
    PRUEF(ok && verz == noetig);
    PRUEF(real);
    delete sn;
    cdj::ArrSnapshot* so = bass_klick([&](Bau& b, int) { b.spur(1, ArrArt::audio); b.kette(1, {ArrStufe{ArrInsArt::komp, 0, true, schl(cdj::ARR_SCHL_DECK, 1, cdj::ARR_SCHL_POST)}}); }, 2);
    PRUEF(cdj::arr_schluessel_versatz(*so, nullptr, 1));   // negative control: nothing in front of the stage, no delay needed, even the smallest ring holds it
    delete so;
  }

  PRUEF_ENDE();
}
