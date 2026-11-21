// Container core K7: the `strom` track (ArrArt::strom) and its sink ArrStromSenke. A strom track adds the stream buffer strom_l/r[n - 1] of the source buffers (stage 1 of the
// audio callback) into its track input, at latency 0, and leaves the strip (fader, groups, DJ outputs) to the Arrangement.
// Cases: 1 stream 5 as a sine (right = minus left) in a strom track on stream 5 that leads into a group on DJ output 3: the DJ pair of index 2 equals the stream sample for sample
// (+-1e-6, after the 2 beat count-in is over) and no other pair carries anything, 2 an unset stream (9): silence, no NaN, leer() true, whereas the sink with a playing stream is not leer,
// 3 the loader: two strom tracks on one stream are refused `format`, quelle.art other than strom is `format`, a stream outside 1..16 is `format`, a strom track in a project that is not
// /4 is `format`; a valid file loads as ArrArt::strom with strom == 5, 4 kernel (arr35::Lauf, erz_quelle[4] feeds stream 5, a /4 live file): the master carries the stream, and after
// 2 s of silence the container pad/1 sleeps (Mixer::schlaeft) -- while the stream sounds it does not.
// Mutation (CMakeLists.txt): STROM_SENKE_EIN_SAMPLE (the sink reads one frame late: case 1 and 4 red).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_run.h"
#include "cypherdj/arr_stream_sink.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/quellpuffer.h"
#include "check.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int KAN = 4;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static float strom_wert(int64_t s) { return 0.4f * std::sin(0.05f * static_cast<float>(s % 100000)); }
static constexpr float MITTE = 0.70710678f;   // the pan law of the track strip at the centre (-3 dB per channel); fader 0 dB, no trim: the only gain between the stream and the DJ pair

struct Paare {
  std::vector<float> l[KAN], r[KAN];
};

// the module-level run: the source buffers are filled with the stream `strom` (1..16, sine left, minus sine right) before every block, the DJ pairs are handed like the kernel does
static void lauf(Treiber& t, cdj::Quellpuffer& q, Paare& p, int strom, int64_t bis, bool spielt, const cdj::ArrStromSenke& se, bool* leer_gesehen = nullptr) {
  float b[6][cdj::ARR_BLOCK];
  float dl[KAN][cdj::ARR_BLOCK], dr[KAN][cdj::ARR_BLOCK];
  while (t.s < bis) {
    const int n = t.n;
    q.leeren(n);
    if (spielt)
      for (int i = 0; i < n; ++i) {
        q.strom_l[strom - 1][i] = strom_wert(t.s + i);
        q.strom_r[strom - 1][i] = -strom_wert(t.s + i);
      }
    for (auto& x : b) std::fill(x, x + n, 0.0f);
    float* pl[KAN];
    float* pr[KAN];
    for (int c = 0; c < KAN; ++c) {
      std::fill(dl[c], dl[c] + n, 0.0f);
      std::fill(dr[c], dr[c] + n, 0.0f);
      pl[c] = dl[c];
      pr[c] = dr[c];
    }
    t.arr.dj_ausgang(pl, pr);
    t.arr.block(t.k, t.s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
    for (int c = 0; c < KAN; ++c) {
      p.l[c].insert(p.l[c].end(), dl[c], dl[c] + n);
      p.r[c].insert(p.r[c].end(), dr[c], dr[c] + n);
    }
    if (leer_gesehen && !se.leer(0)) *leer_gesehen = false;
    t.s += n;
  }
}
static cdj::ArrSnapshot* snap(int strom) {
  Bau b(1);
  b.spur(1, ArrArt::strom).ausgang(1, 1);
  cdj::ArrSnapshot* s = b.fertig();
  s->spur[0].strom = static_cast<int8_t>(strom);
  s->live = true;
  s->gruppe_dj[0] = 3;
  return s;
}

// ---- kernel helpers (see test_arr_dj_channel.cpp) ------------------------------------------------------------------------------------------------------------------------------------
static int64_t lade_roh(arr35::Lauf& x, int64_t nr, const std::string& text) {
  x.ordner.roh(nr, text);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, nr, x.cache);
  PRUEF(e.snap != nullptr);
  if (!e.snap) return -1;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = nr;
  return x.sende(b);
}
static std::string spur_json(int nr, int strom, int gruppe, const char* quelle_art = "strom") {
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"quelle\":{\"art\":\"" + quelle_art + "\",\"strom\":" + std::to_string(strom) + "},\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string(gruppe) + "}}";
}
static std::string datei(const std::string& format, const std::string& spuren, int ngruppen, bool live = true) {
  std::string g;
  for (int i = 1; i <= ngruppen; ++i) g += std::string(i > 1 ? "," : "") + "{\"nr\":" + std::to_string(i) + ",\"ausgang\":{\"art\":\"dj\",\"nr\":" + std::to_string(2 + i) + "}}";
  return "{\"format\":\"" + format + "\",\"nr\":1,\"spuren\":[" + spuren + "],\"live\":" + (live ? "true" : "false") + ",\"gruppen\":[" + g + "]}";
}
static std::string lade_grund(const std::string& ab, const std::string& text, bool* geladen = nullptr, int* strom = nullptr) {
  arr35::Lauf x(ab, "test_arr_strom_senke_lader");
  x.ordner.roh(1, text);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  if (!e.snap) std::fprintf(stderr, "load refused: %s / %s\n", e.grund.c_str(), e.meldung.c_str());
  if (geladen) *geladen = e.snap != nullptr;
  if (e.snap && strom) *strom = e.snap->spur[0].art == ArrArt::strom ? e.snap->spur[0].strom : -1;
  return e.grund;
}

int main() {
  k35::Arbeitsbestand arb("test_arr_strom_senke_ab");
  const std::string ab = arb.pfad;
  // 1 sound: stream 5, DJ output 3 (pair index 2)
  {
    TR(t)
    std::unique_ptr<float[]> mem(new float[cdj::QP_PUFFER * cdj::MIX_BLOCK]());
    cdj::Quellpuffer q;
    q.binde(mem.get());
    cdj::ArrStromSenke se(t.arr, q);
    t.arr.setze_senke_strom(&se);
    t.laden(snap(5));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Paare p;
    bool leer_immer = true;
    lauf(t, q, p, 5, 60000, true, se, &leer_immer);
    PRUEF(!leer_immer);   // a playing stream is work
    double fehl = 0.0, spitze = 0.0, fehl_r = 0.0;
    for (int64_t i = 50000; i < 60000; ++i) {
      fehl = std::max(fehl, static_cast<double>(std::fabs(p.l[2][i] - MITTE * strom_wert(i))));
      fehl_r = std::max(fehl_r, static_cast<double>(std::fabs(p.r[2][i] + MITTE * strom_wert(i))));
      spitze = std::max(spitze, static_cast<double>(std::fabs(p.l[2][i])));
    }
    std::printf("1: pair 3 against the stream: max error L %.3g, R %.3g, peak %.3f\n", fehl, fehl_r, spitze);
    PRUEF(spitze > 0.25);
    PRUEF(fehl < 1e-6 && fehl_r < 1e-6);
    for (int c : {0, 1, 3})
      for (size_t i = 0; i < p.l[c].size(); ++i) PRUEF(p.l[c][i] == 0.0f && p.r[c][i] == 0.0f);
    lauf(t, q, p, 5, 100000, false, se);   // the stream stops: the pair falls to exact zeros (a container sleeps on it)
    size_t erste_nicht_null = 0;
    for (size_t i = 60000; i < p.l[2].size(); ++i)
      if (p.l[2][i] != 0.0f || p.r[2][i] != 0.0f) erste_nicht_null = i;
    std::printf("1: last non-zero sample of the pair after the stop: %zu\n", erste_nicht_null);
    PRUEF(erste_nicht_null < 61000);
    PRUEF(se.leer(0));   // and the sink is idle again
  }
  // 2 unset stream
  {
    TR(t)
    std::unique_ptr<float[]> mem(new float[cdj::QP_PUFFER * cdj::MIX_BLOCK]());
    cdj::Quellpuffer q;
    q.binde(mem.get());
    cdj::ArrStromSenke se(t.arr, q);
    t.arr.setze_senke_strom(&se);
    t.laden(snap(9));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Paare p;
    bool leer_immer = true;
    lauf(t, q, p, 5, 30000, true, se, &leer_immer);   // stream 5 sounds, the track reads stream 9
    PRUEF(leer_immer && se.leer(0));
    bool still = true, endlich = true;
    for (size_t i = 0; i < p.l[2].size(); ++i) {
      still = still && p.l[2][i] == 0.0f && p.r[2][i] == 0.0f;
      endlich = endlich && std::isfinite(p.l[2][i]) && std::isfinite(p.r[2][i]);
    }
    PRUEF(still && endlich);
    PRUEF(se.leer(-1) && se.leer(99));   // out of range: nothing to do
  }
  // 3 the loader
  {
    bool ok = false;
    int strom = 0;
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 5, 1), 1), &ok, &strom) == "" && ok && strom == 5);
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 5, 1) + "," + spur_json(2, 5, 2), 2), &ok) == "format" && !ok);   // zwei_spuren_ein_strom
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 5, 1) + "," + spur_json(2, 6, 2), 2), &ok) == "" && ok);          // two streams are fine
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 17, 1), 1), &ok) == "format" && !ok);
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 0, 1), 1), &ok) == "format" && !ok);
    PRUEF(lade_grund(ab, datei("cypherdj-arr/4", spur_json(1, 5, 1, "modul"), 1), &ok) == "format" && !ok);
    PRUEF(lade_grund(ab, datei("cypherdj-arr/3", spur_json(1, 5, 1), 1), &ok) == "format" && !ok);   // not /4
  }
  // 4 kernel
  {
    arr35::Lauf x(ab, "test_arr_strom_senke_kern");
    x.erz_quelle[4] = [](int64_t s) { return s < 48000 ? 0.25f * std::sin(0.05f * static_cast<float>(s)) : 0.0f; };   // stream 5 sounds for 1 s, then silence
    x.teil("pad/1/fader", 0.0f, 0.0, 0.0);   // container C open
    {   // since K8 the default art is player: container C takes the module, otherwise the arrangement is not heard in C
      cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
      b.nr = 3;
      b.an = cdj::Kern::CONTAINER_ART_MODUL;
      x.sende(b);
    }
    lade_roh(x, 1, datei("cypherdj-arr/4", spur_json(1, 5, 1), 1));
    x.start(0.0, 0);
    const int pad1 = cdj::Mixer::kanal_index("pad/1");
    PRUEF(pad1 >= 0);
    x.lauf(30000);
    PRUEF(!x.kern->mixer().schlaeft(pad1));
    x.lauf(4 * 48000);
    double e = 0.0;
    for (int64_t i = 6000; i < 40000; ++i) e += static_cast<double>(x.l[i]) * x.l[i];
    e = std::sqrt(e / 34000.0);
    std::printf("4: master rms while the stream sounds %.4f\n", e);
    PRUEF(e > 0.01);
    // the DJ filter tail of the strip dies out in a few seconds, then the strip sleeps (lauf() takes an absolute end)
    for (int sek = 5; sek <= 40 && !x.kern->mixer().schlaeft(pad1); ++sek) x.lauf(static_cast<int64_t>(sek) * 48000);
    PRUEF(x.kern->mixer().schlaeft(pad1));
  }
  PRUEF_ENDE();
}
