// Tracker task 16: `bend` and `pegel` of a bk track, from the playback file to the Baukasten instance.
//   F1 samples         125 BPM (23040 samples a beat): a bend and a pegel event arrive at the sink at the sample of their beat, in the block of that sample
//   F2 glide           a glide in beats arrives as a glide in samples (beat map), ending exactly 2 beats later
//   F3 mitten_im_gleiten  start in the middle of a glide: the value in force as a jump plus the rest of the glide to the target
//   F4 mitten_im_stueck   start behind the events: the value in force goes in at the entry (bend before pegel); neutral is not sent
//   F5 loop            the loop seam sends the value in force at the loop start (always), also a glide that runs on in the new pass
//   F6 stopp           no event at or behind the stop sample; a restart plays the events again from the new entry
//   F7 ohne            a track without bend/pegel gets no fx call at all and renders the same bytes as one with empty lists
//   F8 instanz         stop and restart on a real instance: the restart starts neutral (not at the bend of the first run)
//   F9 keine_allokation  2000 blocks with bend and pegel events every 1/16 beat: 0 allocations, locks and sleeps (positive control: the counter sees one)
//   L1 lader           the loader reads the lists, takes /2 and /3, refuses what is wrong with grund "format", and the 65537th event with "zu_gross"
//   L2 konstante       ARR_FX_PUNKTE_MAX is 65536
//   R1..R5 render      cypherdj-render path: bend +12 from the very sample, pegel 0.5 from the very sample, glide hits the target, start in the middle of a glide (ends on the target), same bytes twice;
//                      on the raw instance: the glide in between and the pitch at a start in the middle of a glide
// R4 and R5 count the pitch on the raw instance output (the render's master chain changes the zero crossings of a saw, so the render checks only the octave, the half and the sample).
// Mutations: none of its own.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_loader.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/render.h"
#include "cypherdj/state.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrFxPunkt;

namespace {

constexpr int64_t SPB125 = 23040;   // samples a beat at 125 BPM (48000 * 60 / 125)

struct FxSenke : PruefSenke {
  struct F {
    int spur;
    int64_t ziel;
    bool pegel;
    float wert;
    int64_t gleit;
    int64_t block_s0;
  };
  std::vector<F> fe;
  explicit FxSenke(int64_t v = 0) : PruefSenke(v) { fe.reserve(1 << 16); }
  void fx(int spur, int64_t ziel, bool pegel, float wert, int64_t gleit) noexcept override { fe.push_back({spur, ziel, pegel, wert, gleit, block_s0}); }
};

bool im_block(const FxSenke::F& e) { return e.block_s0 <= e.ziel && e.ziel < e.block_s0 + 256; }

using Fx = std::vector<ArrFxPunkt>;

// one intern track with a note per beat; a driver with the map at 125 BPM and a recording sink of lead 0 (the lead of the internal bk sink)
struct Lauf {
  Treiber t;
  FxSenke w{0};
  Lauf() {
    t.k = cdj::Karte{125.0, 0};
    t.senken.push_back(&w);
    t.arr.setze_senke_intern(&w);
  }
  ~Lauf() { t.arr.setze_senke_intern(nullptr); }
  void lade(const Fx& bend, const Fx& pegel) {
    t.laden(Bau().spur(1, ArrArt::intern).note(1, "a/n", 0.0, 0.5, 57).fx(1, bend, pegel).fertig());
  }
  int64_t start(double beat) {
    t.arr.start(beat, 2, false, t.s, 0, 256, t.k);
    return t.arr.einsatz_sample();
  }
};

uint64_t fnv(const std::vector<float>& v, uint64_t h) {
  for (float f : v) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    for (int i = 0; i < 4; ++i) {
      h ^= (u >> (8 * i)) & 0xffu;
      h *= 1099511628211ull;
    }
  }
  return h;
}

double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}

// rising zero crossings per second over [a, b): the pitch of a saw
double hz(const std::vector<float>& v, int64_t a, int64_t b) {
  int n = 0;
  for (int64_t i = a + 1; i < b && i < static_cast<int64_t>(v.size()); ++i)
    if (v[i - 1] <= 0.0f && v[i] > 0.0f) ++n;
  return n * 48000.0 / static_cast<double>(b - a);
}

// pitch of x relative to y over [a, b): 1 = same, 2 = an octave up
double ton(const std::vector<float>& x, const std::vector<float>& y, int64_t a, int64_t b) { return hz(x, a, b) / hz(y, a, b); }

struct Sinken {
  cdj::ArrRbSenke rb;
  std::unique_ptr<cdj::ArrBkSenke> bk_h;   // on the heap: ArrBkSenke is about 3.5 MB since 128 tracks (8 MB stack)
  cdj::ArrBkSenke& bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk_h(std::make_unique<cdj::ArrBkSenke>(a)), bk(*bk_h), kit(a), intern(a, &rb, &bk, &kit) { a.setze_senke_intern(&intern); }
};

// one bk track with a note per beat (tone 57, 0.9 beat), the bend and pegel lists, the knob k1
cdj::ArrSnapshot* baue_bk(CypherBk* h, const Fx& bend, const Fx& pegel, int notenzahl, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::intern);
  for (int i = 0; i < notenzahl; ++i) b.note(1, ("v/n" + std::to_string(i)).c_str(), i, 0.9, 57, 127);
  b.fx(1, bend, pegel);
  cdj::ArrSnapshot* s = b.fertig();
  bkt::spur(s, 1, h, 1, {{"k1", 0.5f}});
  return s;
}

// ---- loader texts
std::string bk_spur(int nr, const std::string& felder) {
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"parameter\":{\"k1\":0.5},\"noten\":[{\"id\":\"c" + std::to_string(nr) +
         "/n0\",\"beat\":0,\"laenge\":0.5,\"ton\":57,\"vel\":100}]" + (felder.empty() ? "" : "," + felder) + "}";
}

std::string punkte(int n, double schritt = 0.001) {
  std::string s = "[";
  char z[64];
  for (int i = 0; i < n; ++i) {
    std::snprintf(z, sizeof z, "%s[%.6f,1,0]", i ? "," : "", i * schritt);
    s += z;
  }
  return s + "]";
}

// ---- render
std::unique_ptr<cdj_z_echtzeit> fach_erz4() {
  auto f = std::make_unique<cdj_z_echtzeit>();
  f->n_regler = 1;
  std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "erz/4/fader");
  f->regler[0].wert = 0.0f;
  return f;
}

// a bk track 2 with a note per beat 0..5 (tone 57, 0.9 beat, knob k1 0.5) and the given `bend`/`pegel` text ("" = none)
std::string render_spur(const std::string& felder) {
  std::string n;
  for (int i = 0; i < 6; ++i) {
    char z[160];
    std::snprintf(z, sizeof z, "%s{\"id\":\"c2/n%d\",\"beat\":%d,\"laenge\":0.9,\"ton\":57,\"vel\":100}", i ? "," : "", i, i);
    n += z;
  }
  return "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"parameter\":{\"k1\":0.5},\"noten\":[" + n + "]" + (felder.empty() ? "" : "," + felder) + "}";
}

cdj::RenderErgebnis render(const std::string& arr, int64_t nr, const std::string& bk, double von, double bis) {
  cdj::RenderAuftrag r;
  r.arr_ordner = arr;
  r.nr = nr;
  r.von_beat = von;
  r.bis_beat = bis;
  r.bpm = 125.0;
  r.bk_ordner = bk;
  const auto fach = fach_erz4();
  r.regler = fach.get();
  return cdj::rendere(r);
}

int64_t erster_unterschied(const std::vector<float>& a, const std::vector<float>& b) {
  const size_t n = std::min(a.size(), b.size());
  for (size_t i = 0; i < n; ++i)
    if (a[i] != b[i]) return static_cast<int64_t>(i);
  return -1;
}

// a run on a real instance (graph G_T, one note a beat for 6 beats), the sink in the playback, lead 537: the raw left output, index = core sample; e = the entry sample
std::vector<float> spiele_bk(const Fx& bend, const Fx& pegel, double start_beat, double bis_beat, int64_t& e) {
  Treiber t;
  t.k = cdj::Karte{125.0, 0};
  Sinken sk(t.arr);
  CypherBk* h = bkt::neu(bkt::G_T);
  t.laden(baue_bk(h, bend, pegel, 6));
  t.arr.start(start_beat, 0, false, t.s, 537, 256, t.k);
  e = t.arr.einsatz_sample();
  t.lauf(e + static_cast<int64_t>((bis_beat - start_beat) * static_cast<double>(SPB125)) + 600);
  PRUEF(sk.bk.verloren() == 0);
  std::vector<float> l = t.l;
  t.arr.setze_senke_intern(nullptr);
  cypher_bk_frei(h);
  return l;
}

}  // namespace

int main() {
  static_assert(cdj::ARR_FX_PUNKTE_MAX == 65536, "the limit of the playback is pinned by project_bk_device.test.mjs");
  {  // F1: 125 BPM, a bend at beat 2 and a pegel at beat 3
    Lauf x;
    x.lade({{2.0, 12.0f, 0.0f}}, {{3.0, 0.5f, 0.0f}});
    const int64_t e = x.start(0.0);
    x.t.lauf(e + 4 * SPB125);
    std::printf("F1: entry %lld, %zu events\n", static_cast<long long>(e), x.w.fe.size());
    PRUEF(x.w.fe.size() == 2);   // neutral at the entry is not sent
    if (x.w.fe.size() == 2) {
      const auto& b = x.w.fe[0];
      const auto& g = x.w.fe[1];
      PRUEF(!b.pegel && b.spur == 0 && b.ziel == e + 2 * SPB125 && b.wert == 12.0f && b.gleit == 0 && im_block(b));
      PRUEF(g.pegel && g.spur == 0 && g.ziel == e + 3 * SPB125 && g.wert == 0.5f && g.gleit == 0 && im_block(g));
    }
  }
  {  // F2: a glide of 2 beats from beat 1
    Lauf x;
    x.lade({{1.0, 12.0f, 2.0f}}, {});
    const int64_t e = x.start(0.0);
    x.t.lauf(e + 5 * SPB125);
    PRUEF(x.w.fe.size() == 1);
    if (x.w.fe.size() == 1) {
      PRUEF(x.w.fe[0].ziel == e + SPB125 && x.w.fe[0].wert == 12.0f && x.w.fe[0].gleit == 2 * SPB125 && im_block(x.w.fe[0]));
    }
  }
  {  // F3: start at beat 2 in the middle of a glide 0 -> 12 over 4 beats: the value now (6) and the rest of the glide (2 beats) to 12
    Lauf x;
    x.lade({{0.0, 12.0f, 4.0f}}, {});
    const int64_t e = x.start(2.0);
    x.t.lauf(e + 3 * SPB125);
    std::printf("F3: %zu events\n", x.w.fe.size());
    PRUEF(x.w.fe.size() == 2);
    if (x.w.fe.size() == 2) {
      PRUEF(x.w.fe[0].ziel == e && x.w.fe[0].wert == 6.0f && x.w.fe[0].gleit == 0);
      PRUEF(x.w.fe[1].ziel == e && x.w.fe[1].wert == 12.0f && std::llabs(x.w.fe[1].gleit - 2 * SPB125) <= 1);
    }
  }
  {  // F3b: a chain: the second event starts before the first has ended (the glide starts from the value in force there)
    Lauf x;
    x.lade({{0.0, 12.0f, 4.0f}, {2.0, 0.0f, 2.0f}}, {});   // 0 -> 12 over beats 0..4, at beat 2 (value 6) towards 0 over 2 beats
    const int64_t e = x.start(3.0);                        // value at beat 3: 6 + (0 - 6) * 0.5 = 3, rest 1 beat to 0
    x.t.lauf(e + 2 * SPB125);
    PRUEF(x.w.fe.size() == 2);
    if (x.w.fe.size() == 2) {
      PRUEF(x.w.fe[0].ziel == e && std::fabs(x.w.fe[0].wert - 3.0f) < 1e-5f && x.w.fe[0].gleit == 0);
      PRUEF(x.w.fe[1].ziel == e && x.w.fe[1].wert == 0.0f && std::llabs(x.w.fe[1].gleit - SPB125) <= 1);
    }
  }
  {  // F4: start behind the events: bend before pegel, the value in force; a neutral value is not sent
    Lauf x;
    x.lade({{0.0, 7.0f, 0.0f}, {1.0, 9.0f, 0.0f}}, {{0.0, 0.25f, 0.0f}});
    const int64_t e = x.start(3.0);
    x.t.lauf(e + 2 * SPB125);
    PRUEF(x.w.fe.size() == 2);
    if (x.w.fe.size() == 2) {
      PRUEF(!x.w.fe[0].pegel && x.w.fe[0].ziel == e && x.w.fe[0].wert == 9.0f && x.w.fe[0].gleit == 0);
      PRUEF(x.w.fe[1].pegel && x.w.fe[1].ziel == e && x.w.fe[1].wert == 0.25f && x.w.fe[1].gleit == 0);
    }
    Lauf y;   // 5 then back to 0 at beat 1: from beat 3 nothing is in force that differs from the reset
    y.lade({{0.0, 5.0f, 0.0f}, {1.0, 0.0f, 0.0f}}, {{0.0, 1.0f, 0.0f}});
    const int64_t e2 = y.start(3.0);
    y.t.lauf(e2 + 2 * SPB125);
    PRUEF(y.w.fe.empty());
    Lauf z;   // an event exactly at the start beat is sent once, not twice (the loop of the window, not the state)
    z.lade({{3.0, 4.0f, 0.0f}}, {});
    const int64_t e3 = z.start(3.0);
    z.t.lauf(e3 + SPB125);
    PRUEF(z.w.fe.size() == 1 && z.w.fe[0].ziel == e3 && z.w.fe[0].wert == 4.0f);
  }
  {  // F5: loop 0..4: the value in force at the loop start goes in at the seam, always (neutral too: the end of the old pass left the instance with 12)
    Lauf x;
    x.lade({{1.0, 12.0f, 2.0f}}, {});
    x.t.arr.loop(true, 0.0, 4.0, x.t.s, x.t.k);
    const int64_t e = x.start(0.0);
    x.t.lauf(e + 8 * SPB125 + 1000);
    std::printf("F5: %zu events\n", x.w.fe.size());
    PRUEF(x.w.fe.size() == 4);
    if (x.w.fe.size() == 4) {
      PRUEF(x.w.fe[0].ziel == e + SPB125 && x.w.fe[0].wert == 12.0f && x.w.fe[0].gleit == 2 * SPB125);
      PRUEF(x.w.fe[1].ziel == e + 4 * SPB125 && x.w.fe[1].wert == 0.0f && x.w.fe[1].gleit == 0);
      PRUEF(x.w.fe[2].ziel == e + 5 * SPB125 && x.w.fe[2].wert == 12.0f && x.w.fe[2].gleit == 2 * SPB125);
      PRUEF(x.w.fe[3].ziel == e + 8 * SPB125 && x.w.fe[3].wert == 0.0f && x.w.fe[3].gleit == 0);
      for (const auto& f : x.w.fe) PRUEF(im_block(f));
    }
  }
  {  // F5b: loop 2..4 started at beat 2 inside a glide 0 -> 12 over 4 beats: entry and every seam carry (6, then the glide to 12 over 2 beats)
    Lauf x;
    x.lade({{0.0, 12.0f, 4.0f}}, {});
    x.t.arr.loop(true, 2.0, 4.0, x.t.s, x.t.k);
    const int64_t e = x.start(2.0);
    x.t.lauf(e + 4 * SPB125 + 1000);
    std::printf("F5b: %zu events\n", x.w.fe.size());
    PRUEF(x.w.fe.size() == 6);
    for (size_t i = 0; i + 1 < x.w.fe.size(); i += 2) {
      const int64_t soll = e + static_cast<int64_t>(i / 2) * 2 * SPB125;
      PRUEF(x.w.fe[i].ziel == soll && x.w.fe[i].wert == 6.0f && x.w.fe[i].gleit == 0);
      PRUEF(x.w.fe[i + 1].ziel == soll && x.w.fe[i + 1].wert == 12.0f && std::llabs(x.w.fe[i + 1].gleit - 2 * SPB125) <= 1);
    }
  }
  {  // F6: stop: nothing at or behind the stop; the restart plays the events again from its own entry
    Lauf x;
    x.lade({{1.0, 12.0f, 0.0f}, {3.0, 5.0f, 0.0f}}, {});
    const int64_t e = x.start(0.0);
    x.t.lauf(e + 2 * SPB125);
    PRUEF(x.w.fe.size() == 1 && x.w.fe[0].ziel == e + SPB125);
    x.t.arr.stopp(0, x.t.s, x.t.k);
    x.t.lauf(e + 5 * SPB125);
    PRUEF(x.w.fe.size() == 1);   // the event at beat 3 never went out
    PRUEF(!x.w.alle_aus_ev.empty());
    const size_t davor = x.w.fe.size();
    const int64_t e2 = x.start(0.0);
    x.t.lauf(e2 + 2 * SPB125);
    PRUEF(x.w.fe.size() == davor + 1);
    if (x.w.fe.size() == davor + 1) PRUEF(x.w.fe.back().ziel == e2 + SPB125 && x.w.fe.back().wert == 12.0f);
  }
  {  // F7: a track without the lists: no fx call; with empty lists the same bytes as without lists (instance, graph G_T)
    Lauf x;
    x.t.laden(Bau().spur(1, ArrArt::intern).note(1, "a/n", 0.0, 0.5, 57).fertig());
    const int64_t e = x.start(0.0);
    x.t.lauf(e + 2 * SPB125);
    PRUEF(x.w.fe.empty() && !x.w.ons().empty());   // positive control: the notes played
    std::vector<float> aus[2];
    for (int mit = 0; mit < 2; ++mit) {
      Treiber t;
      t.k = cdj::Karte{125.0, 0};
      Sinken sk(t.arr);
      CypherBk* h = bkt::neu(bkt::G_T);
      Bau b(1);
      b.spur(1, ArrArt::intern);
      for (int i = 0; i < 3; ++i) b.note(1, ("v/n" + std::to_string(i)).c_str(), i, 0.9, 57 + 3 * i, 127);
      if (mit) b.fx(1, {}, {});
      cdj::ArrSnapshot* s = b.fertig();
      bkt::spur(s, 1, h, 1, {{"k1", 0.5f}});
      t.laden(s);
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(3 * SPB125 + 2000);
      aus[mit] = t.l;
      PRUEF(sk.bk.verloren() == 0);
      t.arr.setze_senke_intern(nullptr);
      cypher_bk_frei(h);
    }
    PRUEF(aus[0] == aus[1] && rms(aus[0], 0, static_cast<int64_t>(aus[0].size())) > 0.0);
  }
  {  // F8: real instance: the first run bends +12 from beat 1, stop, restart at beat 0: the first note of the restart is at 220 Hz, not at 440 Hz
    Treiber t;
    t.k = cdj::Karte{125.0, 0};
    Sinken sk(t.arr);
    CypherBk* h = bkt::neu(bkt::G_T);
    t.laden(baue_bk(h, {{1.0, 12.0f, 0.0f}}, {}, 6));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    const int64_t e = t.arr.einsatz_sample();
    t.lauf(e + 2 * SPB125 + 500);
    const double vorher0 = hz(t.l, e + 3000, e + 11000), vorher1 = hz(t.l, e + SPB125 + 3000, e + SPB125 + 11000);
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 4000);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    const int64_t e2 = t.arr.einsatz_sample();
    t.lauf(e2 + 2 * SPB125 + 500);
    const double nachher0 = hz(t.l, e2 + 3000, e2 + 11000), nachher1 = hz(t.l, e2 + SPB125 + 3000, e2 + SPB125 + 11000);
    std::printf("F8: first run %.1f / %.1f Hz, restart %.1f / %.1f Hz, lost %llu\n", vorher0, vorher1, nachher0, nachher1, static_cast<unsigned long long>(sk.bk.verloren()));
    PRUEF_NAH(vorher0, 220.0, 220.0 * 0.03);
    PRUEF_NAH(vorher1, 440.0, 440.0 * 0.03);
    PRUEF_NAH(nachher0, 220.0, 220.0 * 0.03);
    PRUEF_NAH(nachher1, 440.0, 440.0 * 0.03);
    PRUEF(sk.bk.verloren() == 0);
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
  }
  {  // F9: no allocation, lock or sleep with events every 1/16 beat (bend and pegel), 2000 blocks
    Treiber t;
    t.k = cdj::Karte{125.0, 0};
    Sinken sk(t.arr);
    CypherBk* h = bkt::neu(bkt::G_T);
    Fx bend, pegel;
    for (int i = 0; i < 640; ++i) {
      bend.push_back({i / 16.0, static_cast<float>((i % 5) - 2), (i % 3) ? 0.0625f : 0.0f});
      pegel.push_back({i / 16.0 + 0.03125, (i % 2) ? 0.5f : 1.0f, 0.0f});
    }
    t.laden(baue_bk(h, bend, pegel, 40));
    t.arr.loop(true, 0.0, 12.0, t.s, t.k);
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(20000);
    float bf[6][cdj::ARR_BLOCK];
    int64_t smp = t.s;
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      for (auto& v : bf) std::fill(v, v + 256, 0.0f);
      t.arr.block(t.k, smp, 256, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
      smp += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("F9: allocations in 2000 blocks = %ld, events lost %llu\n", im_fenster, static_cast<unsigned long long>(sk.bk.verloren()));
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);
    PRUEF(sk.bk.verloren() == 0);
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
    abfang_an();
    { std::vector<int> v(100); }
    const long positiv = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);   // positive control: the watcher counts
  }

  arrdatei::Ordner o("test_arr_fx");
  const std::string bk = o.pfad + "/bk";
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/t.json") << bkt::G_T;
  {  // L1: the loader
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    auto lade = [&](int64_t nr) { return cdj::lade_wiedergabe(o.pfad, nr, cache); };
    o.wiedergabe2_warp(1, bk_spur(2, "\"bend\":[[0,0,0],[1.5,12,0.5],[2,-3,0]],\"pegel\":[[1,0.5,0.25]]"));
    cdj::ArrLadeErgebnis e = lade(1);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[1];
      PRUEF(s.n_bend == 3 && s.bend != nullptr && s.n_pegel == 1 && s.pegel != nullptr);
      if (s.n_bend == 3 && s.n_pegel == 1) {
        PRUEF(s.bend[1].beat == 1.5 && s.bend[1].wert == 12.0f && s.bend[1].gleit == 0.5f && s.bend[2].wert == -3.0f);
        PRUEF(s.pegel[0].beat == 1.0 && s.pegel[0].wert == 0.5f && s.pegel[0].gleit == 0.25f);
      }
      PRUEF(e.snap->spur[0].n_bend == 0 && e.snap->spur[0].bend == nullptr);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    o.wiedergabe2(2, bk_spur(2, "\"bend\":[[1,1,0]]"), "", "cypherdj-arr/3");   // format /3
    e = lade(2);
    PRUEF(e.snap && e.snap->spur[1].n_bend == 1);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    o.wiedergabe2_warp(3, bk_spur(2, "\"bend\":[],\"pegel\":[]"));   // empty lists load
    e = lade(3);
    PRUEF(e.snap && e.snap->spur[1].n_bend == 0 && e.snap->spur[1].n_pegel == 0);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    o.wiedergabe2_warp(4, bk_spur(2, ""));   // no field: as before
    e = lade(4);
    PRUEF(e.snap && e.snap->spur[1].n_bend == 0 && e.snap->spur[1].bend == nullptr);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);

    struct Fall {
      const char* was;
      std::string felder;
    };
    const Fall falsch[] = {
        {"not a list", "\"bend\":5"},
        {"entry of two", "\"bend\":[[1,2]]"},
        {"entry of four", "\"bend\":[[1,2,0,0]]"},
        {"entry not an array", "\"pegel\":[{\"beat\":1}]"},
        {"negative beat", "\"bend\":[[-1,2,0]]"},
        {"falling beats", "\"bend\":[[2,1,0],[1,1,0]]"},
        {"negative level", "\"pegel\":[[1,-0.5,0]]"},
        {"negative glide", "\"bend\":[[1,2,-1]]"},
        {"value not a number", "\"bend\":[[1,\"x\",0]]"},
    };
    int nr = 10;
    for (const Fall& f : falsch) {
      o.wiedergabe2_warp(nr, bk_spur(2, f.felder));
      e = lade(nr);
      if (e.snap || e.grund != "format") std::fprintf(stderr, "case %s: grund=%s meldung=%s\n", f.was, e.grund.c_str(), e.meldung.c_str());
      PRUEF(e.snap == nullptr && e.grund == "format");
      PRUEF(e.meldung.find("spuren[") != std::string::npos);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
      ++nr;
    }
    // format /1 does not know the fields; a track that is not a bk track refuses them
    o.wiedergabe(nr, bk_spur(2, "\"bend\":[[1,1,0]]"));
    e = lade(nr++);
    PRUEF(e.snap == nullptr && e.grund == "format");
    o.wiedergabe2_warp(nr, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":[],\"bend\":[[1,1,0]]}");
    e = lade(nr++);
    PRUEF(e.snap == nullptr && e.grund == "format");
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    // the limit: 65536 events in all lists of all tracks load, the 65537th is refused
    o.wiedergabe2_warp(nr, bk_spur(1, "\"bend\":" + punkte(32768) + ",\"pegel\":" + punkte(32768)));
    e = lade(nr++);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      PRUEF(e.snap->spur[0].n_bend == 32768 && e.snap->spur[0].n_pegel == 32768);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    o.wiedergabe2_warp(nr, bk_spur(1, "\"bend\":" + punkte(32768) + ",\"pegel\":" + punkte(32768)) + "," + bk_spur(2, "\"bend\":[[0,1,0]]"));
    e = lade(nr++);
    std::printf("L1: 65537 events -> grund '%s', meldung '%s'\n", e.grund.c_str(), e.meldung.c_str());
    PRUEF(e.snap == nullptr && e.grund == "zu_gross" && e.meldung.find("mehr als 65536 bend/pegel") != std::string::npos);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 0);   // every abort released what it had taken
  }
  {  // R1..R5: the offline render
    // notes at beats 0..5, 0.9 beat long, tone 57 = 220 Hz, 125 BPM; the file has no latency of its own (the first note starts at frame 0 when the render starts at beat 0)
    o.wiedergabe2_warp(1, render_spur(""));
    o.wiedergabe2_warp(2, render_spur("\"bend\":[[1.5,12,0]]"));
    o.wiedergabe2_warp(3, render_spur("\"pegel\":[[1.5,0.5,0]]"));
    o.wiedergabe2_warp(4, render_spur("\"bend\":[[1.5,12,1]]"));
    o.wiedergabe2_warp(5, render_spur("\"bend\":[[1,12,4]]"));
    const cdj::RenderErgebnis ref = render(o.pfad, 1, bk, 0.0, 6.0);
    const cdj::RenderErgebnis bd = render(o.pfad, 2, bk, 0.0, 6.0);
    const cdj::RenderErgebnis pg = render(o.pfad, 3, bk, 0.0, 6.0);
    const cdj::RenderErgebnis gl = render(o.pfad, 4, bk, 0.0, 6.0);
    PRUEF(ref.fehler.empty() && bd.fehler.empty() && pg.fehler.empty() && gl.fehler.empty());
    if (!(ref.fehler.empty() && bd.fehler.empty() && pg.fehler.empty() && gl.fehler.empty())) {
      std::fprintf(stderr, "render: '%s' %s / '%s' %s\n", ref.fehler.c_str(), ref.meldung.c_str(), bd.fehler.c_str(), bd.meldung.c_str());
      PRUEF_ENDE();
    }
    // first frame of sound: the note at beat 0
    int64_t o0 = 0;
    while (o0 < static_cast<int64_t>(ref.l.size()) && ref.l[o0] == 0.0f) ++o0;
    const int64_t X = SPB125 * 3 / 2;   // beat 1.5
    const int64_t dB = erster_unterschied(ref.l, bd.l), dP = erster_unterschied(ref.l, pg.l);
    std::printf("R: first sound at frame %lld; bend: first difference at %lld (beat 1.5 = %lld), pegel: %lld; peak ref %.5f\n", static_cast<long long>(o0), static_cast<long long>(dB),
                static_cast<long long>(X), static_cast<long long>(dP), ref.spitze);
    PRUEF(ref.spitze > 0.01f);
    PRUEF(dB >= 0 && dP >= 0);
    // R2: identical up to the very sample of the event (the event sample X is the first that may differ), the octave afterwards
    PRUEF(dB >= X && dB <= X + 1);
    PRUEF_NAH(ton(bd.l, ref.l, SPB125 + 3000, SPB125 + 11000), 1.0, 0.03);       // note 1 before the event
    PRUEF_NAH(ton(bd.l, ref.l, 2 * SPB125 + 3000, 2 * SPB125 + 11000), 2.0, 0.06);   // note 2 after it: an octave
    PRUEF_NAH(ton(bd.l, ref.l, X + 600, X + 4000), 2.0, 0.1);                          // note 1 right behind the event
    // R3: half from the very sample
    PRUEF(dP >= X && dP <= X + 1);
    PRUEF_NAH(rms(pg.l, 2 * SPB125 + 3000, 2 * SPB125 + 11000) / rms(ref.l, 2 * SPB125 + 3000, 2 * SPB125 + 11000), 0.5, 0.02);
    PRUEF_NAH(rms(pg.l, SPB125 + 3000, SPB125 + 11000) / rms(ref.l, SPB125 + 3000, SPB125 + 11000), 1.0, 1e-6);   // before: untouched
    // R4: a glide of 1 beat from beat 1.5 hits +12 at beat 2.5 and holds it; in between it is neither
    PRUEF_NAH(ton(gl.l, ref.l, SPB125 + 3000, SPB125 + 11000), 1.0, 0.03);
    PRUEF_NAH(ton(gl.l, ref.l, 3 * SPB125 + 3000, 3 * SPB125 + 11000), 2.0, 0.06);   // the glide is over at beat 2.5
    PRUEF_NAH(ton(gl.l, ref.l, 5 * SPB125 + 3000, 5 * SPB125 + 11000), 2.0, 0.06);
    // R2b: the same twice, bit for bit
    const cdj::RenderErgebnis bd2 = render(o.pfad, 2, bk, 0.0, 6.0);
    PRUEF(bd2.fehler.empty() && bd.l == bd2.l && bd.r == bd2.r);
    PRUEF(bd.l != ref.l);   // a bend changes the file
    std::printf("R: hash ref %016llx, bend %016llx\n", static_cast<unsigned long long>(fnv(ref.r, fnv(ref.l, 1469598103934665603ull))),
                static_cast<unsigned long long>(fnv(bd.r, fnv(bd.l, 1469598103934665603ull))));
    // R5 (render): start at beat 3 in the middle of a glide 0 -> 12 over beats 1..5: the file still ends on the target (beat 5)
    const cdj::RenderErgebnis mg = render(o.pfad, 5, bk, 3.0, 6.0);
    const cdj::RenderErgebnis mr = render(o.pfad, 1, bk, 3.0, 6.0);
    PRUEF(mg.fehler.empty() && mr.fehler.empty());
    PRUEF_NAH(ton(mg.l, mr.l, 2 * SPB125 + 3000, 2 * SPB125 + 11000), 2.0, 0.06);
  }
  {  // R4/R5 on the raw instance output (a clean saw, so the pitch can be counted): a glide in between, and a start in the middle of it
    int64_t e0 = 0, e1 = 0, e2 = 0, e3 = 0;
    const std::vector<float> neutral = spiele_bk({}, {}, 0.0, 6.0, e0);
    const std::vector<float> gleiten = spiele_bk({{1.5, 12.0f, 1.0f}}, {}, 0.0, 6.0, e1);   // beat 1.5 .. 2.5: 0 -> 12
    const int64_t X = SPB125 * 3 / 2;
    const double mitte = hz(gleiten, e1 + X + 3000, e1 + X + 9000) / hz(neutral, e0 + X + 3000, e0 + X + 9000);
    std::printf("R4: pitch ratio %.3f 3000..9000 samples into the glide (a linear glide in semitones: 2^(1.6/12) .. 2^(4.7/12) = 1.12 .. 1.31)\n", mitte);
    PRUEF(mitte > 1.10 && mitte < 1.33);
    PRUEF_NAH(hz(gleiten, e1 + 3 * SPB125 + 3000, e1 + 3 * SPB125 + 11000) / hz(neutral, e0 + 3 * SPB125 + 3000, e0 + 3 * SPB125 + 11000), 2.0, 0.06);
    // start at beat 3 inside a glide 0 -> 12 over beats 1..5 (6 st in force at beat 3), neutral start for comparison
    const std::vector<float> mitten = spiele_bk({{1.0, 12.0f, 4.0f}}, {}, 3.0, 6.0, e2);
    const std::vector<float> mneutral = spiele_bk({}, {}, 3.0, 6.0, e3);
    const double anfang = hz(mitten, e2 + 500, e2 + 9000) / hz(mneutral, e3 + 500, e3 + 9000);   // 0.02 .. 0.39 beat into the run: 6.1 .. 7.2 st
    std::printf("R5: start in the glide: pitch ratio %.3f at the entry (a neutral start would be 1.0, a start at the target 2.0, the value in force 2^(6.65/12) = 1.47)\n", anfang);
    PRUEF_NAH(anfang, std::pow(2.0, 6.65 / 12.0), 0.06);
    PRUEF_NAH(hz(mitten, e2 + 2 * SPB125 + 3000, e2 + 2 * SPB125 + 11000) / hz(mneutral, e3 + 2 * SPB125 + 3000, e3 + 2 * SPB125 + 11000), 2.0, 0.06);   // beat 5: at the end of the glide
  }
  PRUEF_ENDE();
}
