// Live modules task 6: headphone cue per group (spec section 6 item 3, "Headphone cue per module"). grp/<n>/cue 0/1 taps the group signal after its chain (and its delay compensation), in front of
// the group fader, balance and mute/solo fade, and adds it to the cue output of Arrangement::block() (cl/cr, the PFL input of the mixer). The master is untouched.
// Cases: 1 cue_an (heard on the cue bus, master and PM tap bit-equal to the run without cue), 2 cue_aus (nothing on the cue bus, also with a cued empty group),
// 3 summe (two cued groups sum), 4 vor_fader_und_mute (fader, balance and mute of the group do not change the cue; the master follows them), 5 nach_kette (the tap is behind
// the group chain), 6 verschachtelt (the cue of a parent holds its children, the cue of a child only its own), 7 zeit (flat project: the cue is sample-aligned to the master;
// a latency on a sibling group: the cue stays at the group's own arrival, measured and printed), 8 umschalten (cue on and off during playback is click free at block borders
// and the master does not move), 9 zeile (row grp/<n>/cue, n = 1..16: 0..1 switch, only the hand may set it).
// Mutations (CMakeLists.txt): ARR_GRUPPE_CUE_AUS (1, 3, 6: the tap is skipped), ARR_GRUPPE_CUE_NACH_FADER (4), ARR_GRUPPE_CUE_MASTER (1: the tap also lands on the master).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
// tracks 1..n, one clip each (8 beats), ziele[i] = group of track i+1 (0 = master); eltern[g] = parent of group g+1
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, const std::vector<int>& ziele, const std::vector<int>& eltern = {}, int64_t nr = 1) {
  Bau b(nr);
  for (size_t i = 0; i < ziele.size(); ++i) {
    const std::string id = "c" + std::to_string(i + 1);
    const int sp = static_cast<int>(i) + 1;
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a).ausgang(sp, ziele[i]);
  }
  for (size_t g = 0; g < eltern.size(); ++g) b.gruppe_ausgang(static_cast<int>(g) + 1, eltern[g]);
  return b.fertig();
}
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis = 99840) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x[i])));
  return m;
}
static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }
static int64_t einsatz(const std::vector<float>& x) {   // first sample above the threshold, -1 if none
  for (size_t i = 0; i < x.size(); ++i)
    if (std::fabs(x[i]) > 1e-4f) return static_cast<int64_t>(i);
  return -1;
}

int main() {
  auto a = Audio::gleich(400000, 0.25f);
  const double EIN = 0.25 * MITTE;   // one track in the middle, left and right
  {  // 1 cue_an
    TR(ref) TR(c)
    spiele(ref, snap(&a->a, {1, 1, 0}));
    setze(c, "grp/1/cue", 1.0f);
    spiele(c, snap(&a->a, {1, 1, 0}));
    PRUEF_NAH(c.cl[99000], 2 * EIN, 1e-6);   // the two members of group 1; track 3 goes straight to the master and is not in the cue
    PRUEF_NAH(c.cr[99000], 2 * EIN, 1e-6);
    PRUEF(gleich(c.l, ref.l) && gleich(c.r, ref.r));   // the master is bit-equal to the run without the cue
    PRUEF(gleich(c.pml, ref.pml) && gleich(c.pmr, ref.pmr));
    PRUEF(spitze(ref.cl, 0, 99840) == 0.0 && spitze(ref.cr, 0, 99840) == 0.0);   // negative control: no cue row set, the cue bus is silent
  }
  {  // 2 cue_aus: with the row at 0 nothing on the cue bus, also if the cue of a group without members is on (it has no signal)
    TR(t)
    setze(t, "grp/2/cue", 1.0f);   // group 2 has no member
    spiele(t, snap(&a->a, {1, 1, 0}));
    PRUEF(spitze(t.cl, 0, 99840) == 0.0 && spitze(t.cr, 0, 99840) == 0.0);
    setze(t, "grp/1/cue", 1.0f);
    t.lauf(100352);
    PRUEF_NAH(t.cl[100200], 2 * EIN, 1e-6);   // switched on while playing
    setze(t, "grp/1/cue", 0.0f);
    t.lauf(100864);
    PRUEF(spitze(t.cl, 100352 + 256, 100864) == 0.0);   // and off again: nothing left
  }
  {  // 3 summe: two cued groups sum, one alone is half
    TR(ref) TR(t) TR(u)
    spiele(ref, snap(&a->a, {1, 2, 0}));
    setze(t, "grp/1/cue", 1.0f);
    setze(t, "grp/2/cue", 1.0f);
    spiele(t, snap(&a->a, {1, 2, 0}));
    setze(u, "grp/2/cue", 1.0f);
    spiele(u, snap(&a->a, {1, 2, 0}));
    PRUEF_NAH(t.cl[99000], 2 * EIN, 1e-6);
    PRUEF_NAH(t.cr[99000], 2 * EIN, 1e-6);
    PRUEF_NAH(u.cl[99000], 1 * EIN, 1e-6);
    PRUEF(gleich(t.l, ref.l) && gleich(u.l, ref.l));
  }
  {  // 4 vor_fader_und_mute: fader -20 dB, balance, mute and solo elsewhere: the cue stays, the master follows
    TR(c0) TR(c)
    setze(c0, "grp/1/cue", 1.0f);
    spiele(c0, snap(&a->a, {1, 1, 0}));
    setze(c, "grp/1/cue", 1.0f);
    spiele(c, snap(&a->a, {1, 1, 0}));
    setze(c, "grp/1/fader", -20.0f);
    setze(c, "grp/1/pan", 1.0f);
    c.lauf(100864);
    PRUEF_NAH(c.cl[100800], 2 * EIN, 1e-6);   // fader and balance are behind the tap
    PRUEF_NAH(c.cr[100800], 2 * EIN, 1e-6);
    PRUEF(c.l[100800] < 0.5 * c0.l[99000]);   // the master did follow (positive control)
    setze(c, "grp/1/fader", 0.0f);
    setze(c, "grp/1/pan", 0.0f);
    setze(c, "grp/1/mute", 1.0f);
    c.lauf(102400);
    PRUEF_NAH(c.l[102300] - EIN, 0.0, 1e-6);   // muted group: only track 3 (none here), so the master holds the third track level only
    PRUEF_NAH(c.cl[102300], 2 * EIN, 1e-6);    // PFL hears also with the group closed (like the PFL of a DJ channel with the fader down)
    // Track level mute and solo act before the group sum: a solo elsewhere silences the member tracks themselves, so there is nothing left to tap (documented at the row in INTERFACES section 1.5; spec section 6 item 3, "Headphone cue per module")
    setze(c, "grp/1/mute", 0.0f);
    setze(c, "grp/2/solo", 1.0f);
    c.lauf(103424);
    PRUEF_NAH(c.cl[103300], 0.0, 1e-6);
  }
  {  // 5 nach_kette: the tap sits behind the group chain (utility gain -6 dB)
    TR(t)
    setze(t, "ins/utility/1/an", 1.0f);
    setze(t, "ins/utility/1/gain", -6.0206f);
    setze(t, "grp/1/cue", 1.0f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a).ausgang(1, 1);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &a->a).ausgang(2, 1);
    b.gruppen_kette(1, {ArrStufe{ArrInsArt::utility, 0, true}});
    spiele(t, b.fertig());
    PRUEF_NAH(t.cl[99000], 0.5 * 2 * EIN, 1e-5);
    PRUEF_NAH(t.l[99000], 0.5 * 2 * EIN, 1e-5);   // the master has the same chain level (unity fader)
  }
  {  // 6 verschachtelt: group 2 inside group 1; track 1 direct in group 1, track 2 in group 2
    TR(p) TR(k) TR(ref)
    spiele(ref, snap(&a->a, {1, 2}, {0, 1}));
    setze(p, "grp/1/cue", 1.0f);
    spiele(p, snap(&a->a, {1, 2}, {0, 1}));
    setze(k, "grp/2/cue", 1.0f);
    spiele(k, snap(&a->a, {1, 2}, {0, 1}));
    PRUEF_NAH(p.cl[99000], 2 * EIN, 1e-6);   // the parent holds its direct track and the child
    PRUEF_NAH(k.cl[99000], 1 * EIN, 1e-6);   // the child alone
    PRUEF_NAH(k.cr[99000], 1 * EIN, 1e-6);
    PRUEF(gleich(p.l, ref.l) && gleich(k.l, ref.l));
    TR(pk)   // both cued: the child is in the cue twice (its own tap and inside the parent), the taps add like two cue buttons
    setze(pk, "grp/1/cue", 1.0f);
    setze(pk, "grp/2/cue", 1.0f);
    spiele(pk, snap(&a->a, {1, 2}, {0, 1}));
    PRUEF_NAH(pk.cl[99000], 3 * EIN, 1e-6);
  }
  {  // 7 zeit: flat project, no latency anywhere: the cue starts at the sample where the master starts
    TR(t)
    setze(t, "grp/1/cue", 1.0f);
    spiele(t, snap(&a->a, {1, 0}));
    const int64_t em = einsatz(t.l), ec = einsatz(t.cl);
    std::printf("7: flat: master onset %lld, cue onset %lld\n", static_cast<long long>(em), static_cast<long long>(ec));
    PRUEF(em > 0 && ec == em);
    // a latency on the sibling group 2 (eq): the master waits for the late path at the PM, the group tap is at the group's own arrival
    TR(u)
    setze(u, "grp/1/cue", 1.0f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &a->a).ausgang(1, 1);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &a->a).ausgang(2, 2);
    b.gruppen_kette(2, {ArrStufe{ArrInsArt::eq, 0, true}});
    spiele(u, b.fertig());
    const int64_t eu = einsatz(u.l), cu = einsatz(u.cl);
    std::printf("7: sibling with eq latency %d: master onset %lld, cue onset %lld (cue minus master %lld)\n", cdj::EqNativ().latenz(), static_cast<long long>(eu),
                static_cast<long long>(cu), static_cast<long long>(cu - eu));
    PRUEF(eu > 0 && cu > 0);
    PRUEF(cu == eu);   // measured: the group is aligned to the longest arrival (PDC_GRP0), the tap behind that alignment lands on the master's sample
  }
  {  // 8 umschalten: switching the row during playback does not touch the master
    TR(ref) TR(t)
    spiele(ref, snap(&a->a, {1, 1, 0}), 102400);
    spiele(t, snap(&a->a, {1, 1, 0}), 99840);
    for (int i = 0; i < 4; ++i) {
      setze(t, "grp/1/cue", (i & 1) ? 0.0f : 1.0f);
      t.lauf(99840 + (i + 1) * 640);
    }
    t.lauf(102400);
    PRUEF(gleich(t.l, ref.l) && gleich(t.r, ref.r));
  }
  {  // 9 zeile: the row of every group, a switch, the hand only (like pfl)
    TR(t)
    for (int n = 1; n <= cdj::ARR_GRUPPEN; ++n) {
      const std::string p = "grp/" + std::to_string(n) + "/cue";
      const int r = reg(t, p);
      if (r < 0) continue;
      const auto& d = t.tab.def(r);
      PRUEF(d.kanal == -1 && d.rolle == cypherdj::stellwerk::Rolle::grp_cue && d.min == 0.0f && d.max == 1.0f && d.vorgabe == 0.0f);
      PRUEF(d.nur_hand && d.ganzzahlig && d.keine_rampe && d.schalt_samples == 0);
    }
    PRUEF(t.tab.suche("grp/1/cue") >= 1258);   // appended at the table end: the first 1258 rows stay as they are
  }
  PRUEF_ENDE();
}
