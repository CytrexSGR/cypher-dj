// DJ view places task 5 (decisions 7 and 8): the DJ-channel output of a group. A top group of a live snapshot with gruppe_dj = 1 or 2 adds into the stereo pair of that channel
// (Arrangement::dj_ausgang, handed by the kernel before block()) instead of the production master; the kernel adds the pair into the channel input of pad/1 or pad/2 before the strip.
// Offline (setze_dj_als_master, the render's switch) the group sums into the master and the production master tap like any group, and the pairs stay silent.
// Cases (Arrangement, Treiber with the pairs): 1 group on dj 1 (silent on the master pair, present on pair 1, bit-equal to the same group on the master), 2 group on dj 2 only on pair 2,
// 3 two groups on two channels do not leak into each other (exact zeros on the other pair), 4 offline switch (master equals the reference, pairs silent), 6 live: the PM tap carries no
// DJ group, 7 a group cleared while the other keeps playing (the other pair is bit-identical), 8 a tempo ramp keeps both on the grid, 9 a snapshot without DJ outputs equals the old output
// bit for bit (the flat golden of test_arr_ohne_inserts, with the pairs handed), and a caller without pairs hears a DJ group on the master, 10 offline: the production master tap carries the
// DJ group (level.ts hangs on it).
// (Case 11, the render program sets the offline switch, is test_render_dj_channel.cpp.)
// Case 5 (kernel, real mixer): the channel input sums the module with a source that is already there (a test click on pad/1), and the strip acts on the module (fader).
// Mutations (CMakeLists.txt): ARR_DJ_INS_MASTER (1, 3: the DJ group is also in the master), ARR_DJ_OFFLINE_AUS (4, 10: the switch is ignored), ARR_DJ_NACH_STRIP (5: added behind the strip).
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_run.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

struct Paare {   // what the two DJ pairs held in each block, one sample after the other
  std::vector<float> l[2], r[2];
};
// like Treiber::lauf, plus the DJ pairs: zeroed and handed before every block (handed = false: a caller that does not know them)
static void lauf(Treiber& t, Paare& p, int64_t bis, bool handed = true) {
  float b[6][cdj::ARR_BLOCK];
  float dl[2][cdj::ARR_BLOCK], dr[2][cdj::ARR_BLOCK];
  while (t.s < bis) {
    const int n = t.n;
    for (auto& x : b) std::fill(x, x + n, 0.0f);
    for (int c = 0; c < 2; ++c) {
      std::fill(dl[c], dl[c] + n, 0.0f);
      std::fill(dr[c], dr[c] + n, 0.0f);
    }
    if (handed) {
      float* pl[2] = {dl[0], dl[1]};
      float* pr[2] = {dr[0], dr[1]};
      t.arr.dj_ausgang(pl, pr);
    }
    t.arr.block(t.k, t.s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + n);
    t.r.insert(t.r.end(), b[1], b[1] + n);
    t.ml.insert(t.ml.end(), b[2], b[2] + n);
    t.mr.insert(t.mr.end(), b[3], b[3] + n);
    t.cl.insert(t.cl.end(), b[4], b[4] + n);
    t.cr.insert(t.cr.end(), b[5], b[5] + n);
    t.pml.insert(t.pml.end(), t.arr.pm_l(), t.arr.pm_l() + n);
    t.pmr.insert(t.pmr.end(), t.arr.pm_r(), t.arr.pm_r() + n);
    for (int c = 0; c < 2; ++c) {
      p.l[c].insert(p.l[c].end(), dl[c], dl[c] + n);
      p.r[c].insert(p.r[c].end(), dr[c], dr[c] + n);
    }
    t.s += n;
  }
}
// track 1 into group 1 (audio a1), track 2 into group 2 (audio a2), each group optional; dj1, dj2: the DJ channel of the group (0 = master). live: the head flag
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a1, const cdj::ArrAudio* a2, int dj1, int dj2, bool g1 = true, bool g2 = true, bool live = true, double von2 = 0.0, double laenge2 = 8.0) {
  Bau b(1);
  if (g1) b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a1).ausgang(1, 1);
  if (g2) b.spur(2, ArrArt::audio).clip(2, "c2", von2, laenge2, a2).ausgang(2, 2);
  cdj::ArrSnapshot* s = b.fertig();
  s->live = live;
  if (g1) s->gruppe_dj[0] = static_cast<uint8_t>(dj1);
  if (g2) s->gruppe_dj[1] = static_cast<uint8_t>(dj2);
  return s;
}
static void spiele(Treiber& t, Paare& p, cdj::ArrSnapshot* s, int64_t bis = 99840, bool handed = true, int quant = 0) {
  t.laden(s);
  t.arr.start(0.0, quant, false, 0, V, 256, t.k);
  lauf(t, p, bis, handed);
}
static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }
static bool nullen(const std::vector<float>& x, size_t von = 0, size_t bis = SIZE_MAX) {   // exactly 0.0f everywhere (and -0.0f too: the sign of zero is not asked)
  for (size_t i = von; i < x.size() && i < bis; ++i)
    if (x[i] != 0.0f) return false;
  return true;
}
static double spitze(const std::vector<float>& x, size_t von = 0, size_t bis = SIZE_MAX) {
  double m = 0.0;
  for (size_t i = von; i < x.size() && i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(x[i])));
  return m;
}
static int64_t einsatz(const std::vector<float>& x, int64_t ab = 0) {
  for (size_t i = static_cast<size_t>(ab); i < x.size(); ++i)
    if (std::fabs(x[i]) > 1e-4f) return static_cast<int64_t>(i);
  return -1;
}
static uint64_t fnv(uint64_t h, const std::vector<float>& v) {
  const unsigned char* q = reinterpret_cast<const unsigned char*>(v.data());
  for (size_t i = 0; i < v.size() * sizeof(float); ++i) h = (h ^ q[i]) * 1099511628211ULL;
  return h;
}

// ---- case 5: the kernel -------------------------------------------------------------------------------------------------------------------------------------------------------
static int64_t lade_roh(arr35::Lauf& x, int64_t nr, const std::string& text) {   // a playback file with the `live` head flag, loaded like the loader thread, handed to the core as ARR_LADEN
  x.ordner.roh(nr, text);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, nr, x.cache);
  PRUEF(e.snap != nullptr);
  if (!e.snap) return -1;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = nr;
  return x.sende(b);
}
static std::string live_datei(arr35::Lauf& x, int64_t nr, const std::string& audio, int64_t frames, bool dj) {
  const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, audio, frames) + "]}";
  return "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[" + spur + "],\"live\":true,\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"" + (dj ? "dj\",\"nr\":1" : "master\"") + "}}]}";
}
// one kernel run of 3 s: pad/1 fader (dB), the module playing (module), the test click on pad/1 (klick); returns the master left
static std::vector<float> kern_lauf(const std::string& ab, double fader_db, bool modul, bool klick, bool dj = true) {
  arr35::Lauf x(ab, "test_arr_dj_kanal_kern");
  const int64_t FR = 400000;
  const std::string a = x.ordner.audio('a', FR, 0.25f);
  x.teil("pad/1/fader", static_cast<float>(fader_db), 0.0, 0.0);
  if (modul) {
    lade_roh(x, 1, live_datei(x, 1, a, FR, dj));
    x.start(0.0, 0);
  }
  if (klick) {
    cdj::Befehl b = x.neu(cdj::Befehl::KLICK);
    std::snprintf(b.pfad, sizeof b.pfad, "pad/1");
    b.an = 1;
    x.sende(b);
  }
  x.lauf(3 * 48000);
  return x.l;
}

// case 12: the swap that clears a module, at the audio quantum Q (256, 512, 1024), real kernel, mixer and strip, pad/1 at -12 dB. The fading tail of the removed group must stay in the DJ pair
// (behind the channel fader): no step and no peak above the steady level on the master. Own run loop, because k35::N is fixed at 256.
static std::vector<float> kern_swap(const std::string& ab, int Q, size_t* swap_out) {
  arr35::Lauf x(ab, "test_arr_dj_kanal_swap");
  const int64_t FR = 400000;
  const std::string a = x.ordner.audio('a', FR, 0.25f);
  x.teil("pad/1/fader", -12.0f, 0.0, 0.0);
  lade_roh(x, 1, live_datei(x, 1, a, FR, true));
  x.start(0.0, 0);
  std::vector<float> l;
  auto lauf = [&](int64_t bis) {
    while (x.kern->sample() < bis) {
      const int64_t n0 = x.kern->sample();
      const uint64_t w0 = cdj_lade(&x.ring->w);
      x.kern->zyklus(Q, n0 * 20833);
      const float* d = cdj_ring_daten_c(x.ring);
      if (static_cast<int64_t>(l.size()) < n0 + Q) l.resize(static_cast<size_t>(n0 + Q));
      for (int i = 0; i < Q; ++i) l[n0 + i] = d[((w0 + static_cast<uint64_t>(i)) % CDJ_RING_CAP) * 4 + 0];
      cdj::Ereignis e;
      while (x.ere->hole(e))
        if (e.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
    }
  };
  lauf(48000 / Q * Q);
  *swap_out = static_cast<size_t>(x.kern->sample());
  lade_roh(x, 2, "{\"format\":\"cypherdj-arr/2\",\"nr\":2,\"spuren\":[],\"live\":true,\"gruppen\":[]}");   // the module is cleared
  lauf(static_cast<int64_t>(*swap_out) + 24000);
  return l;
}

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  auto c = Audio::gleich(400000, 0.5f);
  {  // 1 a group on dj 1: silent on the master pair and the PM tap, present on pair 1, bit-equal to the same group on the master in a reference run
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0, true, false));
    spiele(t, pt, snap(&a->a, &c->a, 1, 0, true, false));
    PRUEF(spitze(ref.l) > 0.1);   // negative control: on the master the group sounds
    PRUEF(nullen(t.l) && nullen(t.r) && nullen(t.pml) && nullen(t.pmr));
    PRUEF(gleich(pt.l[0], ref.l) && gleich(pt.r[0], ref.r));
    PRUEF(nullen(pt.l[1]) && nullen(pt.r[1]));
  }
  {  // 2 a group on dj 2 only on pair 2 (the channel number is the channel's, not the group's)
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0, false, true));
    spiele(t, pt, snap(&a->a, &c->a, 0, 2, false, true));
    PRUEF(spitze(ref.l) > 0.1);
    PRUEF(nullen(t.l) && nullen(t.r));
    PRUEF(gleich(pt.l[1], ref.l) && gleich(pt.r[1], ref.r));
    PRUEF(nullen(pt.l[0]) && nullen(pt.r[0]));
  }
  {  // 3 two groups on two channels do not leak into each other: each pair equals its group alone, the other pair holds exact zeros when its group is not there
    TR(r1) TR(r2) TR(t) TR(s1) TR(s2) Paare p1, p2, pt, q1, q2;
    spiele(r1, p1, snap(&a->a, &c->a, 0, 0, true, false));
    spiele(r2, p2, snap(&a->a, &c->a, 0, 0, false, true));
    spiele(t, pt, snap(&a->a, &c->a, 1, 2));
    PRUEF(gleich(pt.l[0], r1.l) && gleich(pt.r[0], r1.r));
    PRUEF(gleich(pt.l[1], r2.l) && gleich(pt.r[1], r2.r));
    PRUEF(nullen(t.l) && nullen(t.r) && nullen(t.pml));
    PRUEF(spitze(pt.l[0]) > 0.1 && spitze(pt.l[1]) > 0.2);   // the two channels carry different levels (0.25 and 0.5 sources)
    spiele(s1, q1, snap(&a->a, &c->a, 1, 2, true, false));   // only group 1 there: pair 2 exactly silent
    spiele(s2, q2, snap(&a->a, &c->a, 1, 2, false, true));   // only group 2 there: pair 1 exactly silent
    PRUEF(nullen(q1.l[1]) && nullen(q1.r[1]) && spitze(q1.l[0]) > 0.1);
    PRUEF(nullen(q2.l[0]) && nullen(q2.r[0]) && spitze(q2.l[1]) > 0.2);
  }
  {  // 4 the offline switch: both DJ groups sum into the master (equal to the run with both on the master), the pairs stay silent (also when handed)
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0));
    t.arr.setze_dj_als_master();
    spiele(t, pt, snap(&a->a, &c->a, 1, 2));
    PRUEF(spitze(ref.l) > 0.3);
    PRUEF(gleich(t.l, ref.l) && gleich(t.r, ref.r));
    PRUEF(nullen(pt.l[0]) && nullen(pt.r[0]) && nullen(pt.l[1]) && nullen(pt.r[1]));
    PRUEF(t.arr.dj_nr(1) == 1 && t.arr.dj_nr(2) == 2 && t.arr.dj_nr(3) == 0);   // the snapshot still names the channels; the switch only routes
  }
  // case 5: below, with the kernel
  {  // 6 live (switch off): the PM tap carries no DJ group; a project with the group on the master does
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0));
    spiele(t, pt, snap(&a->a, &c->a, 1, 2));
    PRUEF(spitze(ref.pml) > 0.3);
    PRUEF(nullen(t.pml) && nullen(t.pmr));
  }
  {  // 7 a group cleared while the other keeps playing: group 2 goes at block 200; pair 1 is bit-identical to group 1 alone for the whole run, pair 2 plays and then falls silent
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0, true, false), 120000);
    t.laden(snap(&a->a, &c->a, 1, 2));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    lauf(t, pt, 51200);
    t.laden(snap(&a->a, &c->a, 1, 2, true, false));   // group 2 (track 2) removed
    lauf(t, pt, 120000);
    PRUEF(gleich(pt.l[0], ref.l) && gleich(pt.r[0], ref.r));
    PRUEF(spitze(pt.l[1], 40000, 51200) > 0.2);                       // group 2 played before the swap
    PRUEF(spitze(pt.l[1], 51200, 51200 + 200) > 0.0);                 // the 96-sample tail of the removed group's track ends in the DJ pair (held channel), not on the master
    PRUEF(nullen(pt.l[1], 51200 + 4096, 120000) && nullen(pt.r[1], 51200 + 4096, 120000));   // and is silent after its fade
    { size_t n0 = 0, z0 = 0, z1 = 0; for (size_t i = 0; i < t.l.size(); ++i) if (t.l[i] != 0.0f) { if (!n0) z0 = i; z1 = i; ++n0; }
      std::printf("7: master nonzero %zu samples, first %zu last %zu\n", n0, z0, z1); }
    PRUEF(nullen(t.l) && nullen(t.r));
  }
  {  // 8 a tempo ramp 128 to 140 over 4 beats from beat 4 keeps both groups on the grid: impulses at beat 8 (channel 1) and beat 12 (channel 2) land where they land on the master
    auto imp = Audio::impuls(40000);
    auto mk = [&](int dj1, int dj2, bool g1, bool g2) {
      Bau b(1);
      if (g1) b.spur(1, ArrArt::audio).clip(1, "c1", 8.0, 2.0, &imp->a).ausgang(1, 1);
      if (g2) b.spur(2, ArrArt::audio).clip(2, "c2", 12.0, 2.0, &imp->a).ausgang(2, 2);
      cdj::ArrSnapshot* s = b.fertig();
      s->live = true;
      if (g1) s->gruppe_dj[0] = static_cast<uint8_t>(dj1);
      if (g2) s->gruppe_dj[1] = static_cast<uint8_t>(dj2);
      return s;
    };
    TR(r1) TR(r2) TR(t) Paare p1, p2, pt;
    for (Treiber* x : {&r1, &r2, &t}) x->k.rampe(4.0, 140.0, 4.0);
    spiele(r1, p1, mk(0, 0, true, false), 270000);
    spiele(r2, p2, mk(0, 0, false, true), 270000);
    spiele(t, pt, mk(1, 2, true, true), 270000);
    const int64_t e1 = einsatz(pt.l[0]), e2 = einsatz(pt.l[1]);
    std::printf("8: impulse onsets: channel 1 %lld (master reference %lld, grid %lld), channel 2 %lld (master reference %lld, grid %lld)\n", static_cast<long long>(e1),
                static_cast<long long>(einsatz(r1.l)), static_cast<long long>(std::llround(t.k.sample_at(8.0))), static_cast<long long>(e2), static_cast<long long>(einsatz(r2.l)),
                static_cast<long long>(std::llround(t.k.sample_at(12.0))));
    PRUEF(e1 > 0 && e2 > e1);
    PRUEF(e1 == einsatz(r1.l) && e2 == einsatz(r2.l));
    PRUEF(std::llabs((e2 - e1) - (std::llround(t.k.sample_at(12.0)) - std::llround(t.k.sample_at(8.0)))) <= 2);   // the same distance as the tempo map's grid (a fixed start offset aside)
    PRUEF(gleich(pt.l[0], r1.l) && gleich(pt.l[1], r2.l) && gleich(pt.r[0], r1.r) && gleich(pt.r[1], r2.r));
    PRUEF(nullen(t.l) && nullen(t.r));
  }
  {  // 9 a snapshot without DJ outputs: the old output bit for bit. The flat golden of test_arr_ohne_inserts (32 tracks, 2 groups, 2 returns, no insert) with the pairs handed: the same hash,
     // the pairs exactly silent. And a caller that hands no pairs hears a DJ group on the master (nothing lost), equal to the group on the master.
    std::vector<std::unique_ptr<Audio>> au;
    for (int i = 0; i < 32; ++i) au.push_back(Audio::sinus(400000, 220.0 * (1.0 + i / 10.0), 0.02f));
    TR(t) Paare pt;
    Bau b(1);
    for (int i = 1; i <= 32; ++i) {
      const std::string id = "c" + std::to_string(i);
      b.spur(i, ArrArt::audio).clip(i, id.c_str(), 0.0, 8.0, &au[i - 1]->a);
      if (i <= 8) b.ausgang(i, 1);
      else if (i <= 12) b.ausgang(i, 2);
    }
    cdj::ArrSnapshot* s = b.fertig();
    s->ret_da[0] = s->ret_da[1] = true;
    for (int i = 1; i <= 32; ++i) {
      const std::string p = "spur/" + std::to_string(i) + "/";
      t.arr.setze_sofort(t.tab.suche((p + "fader").c_str()), -static_cast<float>(i % 7));
      t.arr.setze_sofort(t.tab.suche((p + "pan").c_str()), static_cast<float>((i % 5) - 2) * 0.4f);
      if (i <= 4) t.arr.setze_sofort(t.tab.suche((p + "send/1").c_str()), -6.0f);
      if (i >= 20 && i <= 22) t.arr.setze_sofort(t.tab.suche((p + "send/2").c_str()), -3.0f);
    }
    t.arr.setze_sofort(t.tab.suche("grp/1/send/2"), -9.0f);
    spiele(t, pt, s, 130000, true, 2);   // quantised start as in the original test
    uint64_t h = 1469598103934665603ULL;
    h = fnv(h, t.l);
    h = fnv(h, t.r);
    h = fnv(h, t.pml);
    h = fnv(h, t.pmr);
    std::printf("9: flat golden hash 0x%016llxULL\n", static_cast<unsigned long long>(h));
    PRUEF(h == 0xb8fafa36680592e3ULL);   // kGolden of test_arr_without_inserts.cpp
    PRUEF(nullen(pt.l[0]) && nullen(pt.r[0]) && nullen(pt.l[1]) && nullen(pt.r[1]));
    TR(ref) TR(u) Paare pr, pu;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0, true, false));
    spiele(u, pu, snap(&a->a, &c->a, 1, 0, true, false), 99840, false);   // the pairs are not handed
    PRUEF(gleich(u.l, ref.l) && gleich(u.r, ref.r) && gleich(u.pml, ref.pml));
    PRUEF(nullen(pu.l[0]));
  }
  {  // 10 offline: the production master tap (pm_abgriff, the render's abgriff 'produktion') carries the DJ group, equal to the run with the group on the master
    TR(ref) TR(t) Paare pr, pt;
    spiele(ref, pr, snap(&a->a, &c->a, 0, 0));
    t.arr.setze_dj_als_master();
    spiele(t, pt, snap(&a->a, &c->a, 1, 2));
    PRUEF(spitze(ref.pml) > 0.3);
    PRUEF(gleich(t.pml, ref.pml) && gleich(t.pmr, ref.pmr));
  }
  {  // 5 the kernel (real mixer, real strip): the module on dj 1 reaches pad/1; the channel input sums it with a source already there (the test click on pad/1); the strip acts on the module
    k35::Arbeitsbestand ab("test_arr_dj_kanal_ab");
    const std::vector<float> m0 = kern_lauf(ab.pfad, 0.0, true, false);                // module alone, fader 0 dB
    const std::vector<float> m6 = kern_lauf(ab.pfad, -6.0, true, false);               // module alone, fader -6 dB
    const std::vector<float> k6 = kern_lauf(ab.pfad, -6.0, false, true);               // click alone, fader -6 dB
    const std::vector<float> b6 = kern_lauf(ab.pfad, -6.0, true, true);                // both, fader -6 dB
    const std::vector<float> g0 = kern_lauf(ab.pfad, 0.0, true, false, false);         // the same module on the master (no DJ output): what the master carries without the new routing
    const size_t w0 = 100000, w1 = 130000;                                              // a window after the click and the module settled
    std::printf("5: module alone at 0 dB peak %.6f, at -6 dB %.6f, click alone at -6 dB %.6f, both %.6f, module on the master %.6f\n", spitze(m0, w0, w1), spitze(m6, w0, w1),
                spitze(k6, 0), spitze(b6, 0), spitze(g0, w0, w1));
    PRUEF(spitze(m0, w0, w1) > 0.05);
    PRUEF_NAH(spitze(m6, w0, w1) / spitze(m0, w0, w1), std::pow(10.0, -6.0 / 20.0), 2e-3);   // the channel fader acts on the module
    PRUEF(spitze(k6, 0) > 0.01);
    // the click sample: both together equal the sum of the two alone, sample for sample (the strip is linear at these levels)
    const int64_t ek = einsatz(k6);
    PRUEF(ek > 0);
    double fehler = 0.0;
    for (size_t i = 0; i < b6.size() && i < m6.size() && i < k6.size(); ++i) fehler = std::max(fehler, std::fabs(static_cast<double>(b6[i]) - m6[i] - k6[i]));
    std::printf("5: largest difference between both and the sum of the two alone: %.3g (first click sample %lld)\n", fehler, static_cast<long long>(ek));
    PRUEF(fehler < 1e-5);
    PRUEF(spitze(b6, 0) > spitze(m6, 0) + 0.001);   // the click really is in the sum
  }
  {  // 12 the swap that clears the module, at three quanta
    k35::Arbeitsbestand ab("test_arr_dj_kanal_ab12");
    for (int Q : {256, 512, 1024}) {
      size_t swap = 0;
      const std::vector<float> l = kern_swap(ab.pfad, Q, &swap);
      const double steady = spitze(l, swap - 2000, swap - 1000);
      double pk = 0.0, sprung = 0.0;
      for (size_t i = swap; i < swap + 4096; ++i) {
        pk = std::max(pk, static_cast<double>(std::fabs(l[i])));
        sprung = std::max(sprung, static_cast<double>(std::fabs(l[i] - l[i - 1])));
      }
      std::printf("12: quantum %d: steady %.4f, peak after the swap %.4f, largest step %.4f\n", Q, steady, pk, sprung);
      PRUEF(steady > 0.01);
      PRUEF(pk <= steady * 1.2);   // no click, no leak past the channel fader
      PRUEF(sprung < 0.01);
      PRUEF(spitze(l, swap + 8192, l.size()) < 1e-6);   // and then silent
    }
  }
  PRUEF_ENDE();
}
