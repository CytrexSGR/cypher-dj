// 1.12 Automation slice 3, task 3: the command Befehl::ARR_AUTO (/k/arr/auto) and the event AUTO_ZUSTAND (/e/auto) in the whole core,
// from the command ring to the event ring (the net thread is test_netz_arr_auto). spur is 1..32 (0 = all), the field 0..3 (fader, pan, mute, solo).
//   (a) command -> state -> event: an 0 overrides (q 1, 3, state, ONE event), an 1 gives the lane back (event 0); other tracks and fields are untouched
//   (b) spur 0 with an 1 releases every overridden field of every track (one event each)
//   (c) refusals: spur outside 0..32 and spur 0 with an 0 give format, a field outside 0..3 gives auto_ziel_unbekannt, cypher with an 0 gives nur_andreas
//       (state unchanged, no event); cypher may re-enable; the same command from andreas works (negative control)
//   (d) D5 stopped transport: an 0 is acknowledged (q 1, 3), nothing changes, no event; an 1 still clears the state and reports 0 (D6). Control: playing works.
//   (e) lost events: the ring to the reader is full (forced), real changes are dropped; the core re-reports and the mirror ends in the true state, also for a lane
//       that went away meanwhile. Control: without the overflow exactly one event per change, no re-report.
//   (f) allocation guard: commands, overrides and the re-report cost 0 allocations inside Kern::zyklus
//   (g) the re-report pauses when the EVENT ring of the core is full and continues in the next cycles (32 tracks); changes mid-resync (a field before and one
//       after the cursor) end in the truth as well
//   (h) the name table: the playback lane names of the generated list v::werte::auto_ziel give exactly the field of their index (one lane at a time)
//   (i) order of the refusals is pinned (spur/an range, then ziel, then spur 0 with an 0, then nur_andreas); in the AI stop cypher gets ki_gestoppt first (core backstop)
// Mutations (WILL_FAIL): ARR_AUTO_CYPHER_UEBERSTEUERT (c), ARR_AUTO_UEBER_IM_STOPP (d, the filter of D5 seen at the command), ARR_AUTO_OHNE_ABGLEICH (e),
// ARR_AUTO_ABGLEICH_VERGISST (g: the re-report forgets the rest when the event ring is full).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>

#include "arr_run.h"
#include "osc_addresses.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

bool g_waechter = false;

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: forces the overflow of the event ring (the reader is behind)
  // fills the ring to the brim with a LIE: track idx, field 0, overridden. A reader that forwards the queue ends with a wrong mirror.
  static int voll_luegen(Arrangement& a, int idx) {
    int n = 0;
    while (a.auto_ev_.schiebe(ArrAutoEreignis{static_cast<int16_t>(idx), 0, 1, 0})) ++n;
    return n;
  }
};
}  // namespace cdj

using k35::N;

namespace {
struct Aufbau {
  k35::Arbeitsbestand ab;
  std::unique_ptr<arr35::Lauf> x;
  std::string audio;
  int spuren;
  std::string spur_json(bool mit_lane) {
    std::string s;
    for (int nr = 1; nr <= spuren; ++nr)
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           x->ordner.clip(("c" + std::to_string(nr)).c_str(), 0.0, 30.0, audio, 800000) + "]" +
           (mit_lane ? ",\"auto\":[" + arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {16.0, -30.0, 0}}) + "]" : "") + "}";
    return s;
  }
  explicit Aufbau(const char* name, int n_spuren = 2) : ab(name), spuren(n_spuren) {
    x.reset(new arr35::Lauf(ab.pfad, name));
    audio = x->ordner.audio('a', 800000, 0.1f);
    x->laden(1, spur_json(true), "andreas", true);
    x->start(0.0, 0);
    x->zyklen(560 * N);   // about beat 6: the lanes play
  }
  const cdj::Arrangement& arr() const { return x->kern->arrangement(); }
  int64_t cmd(int spur, int feld, int an, const char* quelle = "andreas") {
    cdj::Befehl b = x->neu(cdj::Befehl::ARR_AUTO, quelle);
    b.nr = spur;
    b.politik = feld;
    b.an = an;
    return x->sende(b);
  }
  void lauf(int zyklen = 3) { x->zyklen(x->kern->sample() + zyklen * N); }
  // the AUTO_ZUSTAND events from index `ab` on
  std::vector<cdj::Ereignis> events(size_t von = 0) const {
    std::vector<cdj::Ereignis> v;
    for (size_t i = von; i < x->ev.size(); ++i)
      if (x->ev[i].art == cdj::Ereignis::AUTO_ZUSTAND) v.push_back(x->ev[i]);
    return v;
  }
  // the mirror a reader of /e/auto builds: last zustand per (spur, feld)
  std::map<std::pair<int, int>, int> spiegel() const {
    std::map<std::pair<int, int>, int> m;
    for (const auto& e : events()) m[{e.deck, e.fassung}] = e.status;
    return m;
  }
  int zustand(int spur, int feld) const {
    const auto m = spiegel();
    const auto it = m.find({spur, feld});
    return it == m.end() ? 0 : it->second;
  }
  bool refused(int64_t id, const char* grund) const {
    const k35::Q* q6 = x->quittung(id, 6);
    return q6 && q6->grund == grund && !x->quittung(id, 3);
  }
};
}  // namespace

struct Spiegel {   // what a reader of /e/auto sees, fed from the event ring of the core directly
  std::map<std::pair<int, int>, int> m;
  void ein(const cdj::Ereignis& e) { if (e.art == cdj::Ereignis::AUTO_ZUSTAND) m[{e.deck, e.fassung}] = e.status; }
  int hole(int spur, int feld) const { const auto it = m.find({spur, feld}); return it == m.end() ? 0 : it->second; }
};
int frei(cdj::Ereignisring& r) { return static_cast<int>(cdj::Ereignisring::kapazitaet() - r.belegt()); }
void fuellen(cdj::Ereignisring& r, int lassen_frei) {   // fills the event ring with foreign events until `lassen_frei` slots are left
  cdj::Ereignis d{};
  d.art = 9999;
  while (frei(r) > lassen_frei && r.schiebe(d)) {
  }
}
void leeren(cdj::Ereignisring& r, Spiegel& sp) {
  cdj::Ereignis e;
  while (r.hole(e)) sp.ein(e);
}
int falsche(const cdj::Arrangement& arr, const Spiegel& sp) {   // fields where the mirror differs from the truth
  int falsch = 0;
  for (int s = 1; s <= cdj::ARR_SPUREN; ++s)
    for (int f = 0; f < cdj::Arrangement::AUTO_FELDER; ++f) {
      const auto it = sp.m.find({s, f});
      if ((it == sp.m.end() ? 0 : it->second) != (arr.auto_uebersteuert(cdj::auto_spur_index(s), f) ? 1 : 0)) ++falsch;
    }
  return falsch;
}

int main() {
  {  // (a) command -> state -> event
    Aufbau a("test_kern_arr_auto_a");
    const size_t e0 = a.x->ev.size();
    const int64_t id = a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.x->quittung(id, 1) && a.x->quittung(id, 3));
    PRUEF(a.arr().auto_uebersteuert(0, 0));            // OSC track 1 is index 0
    PRUEF(!a.arr().auto_uebersteuert(1, 0));           // the other track keeps its lane
    PRUEF(!a.arr().auto_uebersteuert(0, 1));           // so does the pan of the same track (no lane there anyway)
    auto ev = a.events(e0);
    PRUEF(ev.size() == 1);
    if (!ev.empty()) PRUEF(ev[0].deck == 1 && ev[0].fassung == 0 && ev[0].status == 1 && ev[0].sample >= 560 * N);
    // the same override again changes nothing: acknowledged, no second event (negative control for "event on every call")
    const int64_t id2 = a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.x->quittung(id2, 3));
    PRUEF(a.events(e0).size() == 1);
    // re-enable
    const int64_t id3 = a.cmd(1, 0, 1);
    a.lauf();
    PRUEF(a.x->quittung(id3, 1) && a.x->quittung(id3, 3));
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
    ev = a.events(e0);
    PRUEF(ev.size() == 2);
    if (ev.size() == 2) PRUEF(ev[1].deck == 1 && ev[1].fassung == 0 && ev[1].status == 0);
    std::printf("a: events %zu, mirror (1,fader) = %d\n", ev.size(), a.zustand(1, 0));
  }
  {  // (b) spur 0 with an 1 releases all
    Aufbau a("test_kern_arr_auto_b");
    a.cmd(1, 0, 0);
    a.cmd(2, 0, 0);
    a.lauf();
    PRUEF(a.arr().auto_uebersteuert(0, 0) && a.arr().auto_uebersteuert(1, 0));
    const size_t e1 = a.x->ev.size();
    const int64_t id = a.cmd(0, 0, 1);
    a.lauf();
    PRUEF(a.x->quittung(id, 1) && a.x->quittung(id, 3));
    PRUEF(!a.arr().auto_uebersteuert(0, 0) && !a.arr().auto_uebersteuert(1, 0));
    const auto ev = a.events(e1);
    PRUEF(ev.size() == 2);
    PRUEF(a.zustand(1, 0) == 0 && a.zustand(2, 0) == 0);
    // negative control: an override of ONE track is not released by a spur 1 re-enable of the other
    a.cmd(1, 0, 0);
    a.cmd(2, 0, 0);
    a.lauf();
    a.cmd(2, 0, 1);
    a.lauf();
    PRUEF(a.arr().auto_uebersteuert(0, 0) && !a.arr().auto_uebersteuert(1, 0));
  }
  {  // (c) refusals
    Aufbau a("test_kern_arr_auto_c");
    const size_t e0 = a.x->ev.size();
    const int64_t i_spur = a.cmd(33, 0, 0), i_neg = a.cmd(-1, 0, 0), i_ziel = a.cmd(1, 4, 0), i_ziel2 = a.cmd(1, -1, 0);
    const int64_t i_alle = a.cmd(0, 0, 0), i_an = a.cmd(1, 0, 2);
    const int64_t i_cy = a.cmd(1, 0, 0, "cypher");
    a.lauf();
    PRUEF(a.refused(i_spur, "format") && a.refused(i_neg, "format"));
    PRUEF(a.refused(i_ziel, "auto_ziel_unbekannt") && a.refused(i_ziel2, "auto_ziel_unbekannt"));
    PRUEF(a.refused(i_alle, "format"));
    PRUEF(a.refused(i_an, "format"));
    PRUEF(a.refused(i_cy, "nur_andreas"));
    PRUEF(!a.arr().auto_uebersteuert(0, 0) && !a.arr().auto_uebersteuert(1, 0));   // nothing was touched
    PRUEF(a.events(e0).empty());
    // negative control: the same command from andreas works
    const int64_t i_ok = a.cmd(1, 0, 0, "andreas");
    a.lauf();
    PRUEF(a.x->quittung(i_ok, 3) && a.arr().auto_uebersteuert(0, 0));
    // cypher may re-enable
    const int64_t i_re = a.cmd(1, 0, 1, "cypher");
    a.lauf();
    PRUEF(a.x->quittung(i_re, 3) && !a.arr().auto_uebersteuert(0, 0));
    PRUEF(a.zustand(1, 0) == 0);
  }
  {  // (d) D5 stopped transport
    Aufbau a("test_kern_arr_auto_d");
    a.x->stopp(0);
    a.lauf();
    PRUEF(a.arr().status() == cdj::ArrStatus::steht);
    const size_t e0 = a.x->ev.size();
    const int64_t id = a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.x->quittung(id, 1) && a.x->quittung(id, 3));   // acknowledged with ok
    PRUEF(!a.arr().auto_uebersteuert(0, 0));               // nothing changes
    PRUEF(a.events(e0).empty());                           // and no /e/auto
    // control: while the transport plays the same command overrides (the filter is the transport, not the command)
    a.x->start(0.0, 0);
    a.x->zyklen(a.x->kern->sample() + 560 * N);
    const int64_t id2 = a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.x->quittung(id2, 3) && a.arr().auto_uebersteuert(0, 0));
    PRUEF(a.events(e0).size() == 1);
    // D6: stop, then an 1 clears the state and reports 0
    a.x->stopp(0);
    a.lauf();
    const size_t e1 = a.x->ev.size();
    a.cmd(1, 0, 1);
    a.lauf();
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
    const auto ev = a.events(e1);
    PRUEF(ev.size() == 1);
    if (!ev.empty()) PRUEF(ev[0].deck == 1 && ev[0].status == 0);
  }
  {  // (e) lost events: the core re-reports, the mirror ends in the true state
    Aufbau a("test_kern_arr_auto_e1");
    a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.zustand(1, 0) == 1);   // the reader knows: overridden
    cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(a.arr());
    const int gefuellt = cdj::ArrPruefZugang::voll_luegen(arr, 1);   // a lie about track 2: overridden
    PRUEF(gefuellt > 0);
    const uint32_t v0 = arr.auto_ereignis_verloren();
    a.cmd(1, 0, 1);   // the true change: track 1 back to the lane, its event is dropped
    a.lauf();
    PRUEF(arr.auto_ereignis_verloren() > v0);
    std::printf("e1: queue %d, dropped %u, mirror (1,fader) = %d (2,fader) = %d\n", gefuellt, arr.auto_ereignis_verloren(), a.zustand(1, 0), a.zustand(2, 0));
    PRUEF(a.zustand(1, 0) == 0);   // the lost 0 came back through the re-report
    PRUEF(a.zustand(2, 0) == 0);   // the lie of the queue is gone
    // the mirror is stable afterwards: another override is reported once, no further re-report
    const size_t e2 = a.x->ev.size();
    a.cmd(2, 0, 0);
    a.lauf();
    PRUEF(a.events(e2).size() == 1 && a.zustand(2, 0) == 1);
  }
  {  // (e2) the lane goes away while the ring is full: the mirror must not stay on 1
    Aufbau a("test_kern_arr_auto_e2");
    a.cmd(1, 0, 0);
    a.lauf();
    PRUEF(a.zustand(1, 0) == 1);
    cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(a.arr());
    cdj::ArrPruefZugang::voll_luegen(arr, 1);
    a.x->laden(2, a.spur_json(false));   // a playback without any lane: the override goes, its 0 is dropped
    a.lauf(6);
    PRUEF(!arr.auto_uebersteuert(0, 0));
    PRUEF(arr.auto_ereignis_verloren() > 0);
    std::printf("e2: mirror (1,fader) = %d (2,fader) = %d\n", a.zustand(1, 0), a.zustand(2, 0));
    PRUEF(a.zustand(1, 0) == 0);
    PRUEF(a.zustand(2, 0) == 0);
  }
  {  // (e3) control: without the overflow exactly one event per change and no re-report
    Aufbau a("test_kern_arr_auto_e3");
    const size_t e0 = a.x->ev.size();
    a.cmd(1, 0, 0);
    a.lauf();
    a.cmd(2, 0, 0);
    a.lauf();
    a.cmd(1, 0, 1);
    a.lauf();
    PRUEF(a.events(e0).size() == 3);
    PRUEF(a.x->kern->arrangement().auto_ereignis_verloren() == 0);
    PRUEF(a.zustand(1, 0) == 0 && a.zustand(2, 0) == 1);
  }
  {  // (f) allocation guard
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("skipped (sanitizer build): allocation watcher not available\n");
    } else {
      Aufbau a("test_kern_arr_auto_f");
      k35::Lauf& x = *a.x;
      cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(a.arr());
      long im_zyklus = 0;
      auto zyklus = [&]() {
        const int64_t n0 = x.kern->sample();
        abfang_an();
        x.kern->zyklus(N, n0 * 20833);
        im_zyklus += abfang_aus();
        cdj::Ereignis e;
        while (x.ere->hole(e)) {
        }
      };
      for (int i = 0; i < 20; ++i) zyklus();
      for (int k = 0; k < 6; ++k) {
        a.cmd(1 + k % 2, 0, k % 3 == 0 ? 1 : 0);
        a.cmd(0, 0, k == 5 ? 1 : 0 + 1);
        zyklus();
        cdj::ArrPruefZugang::voll_luegen(arr, 1);   // the re-report runs inside the guarded cycles too
        a.cmd(1, 0, 0);
        zyklus();
        zyklus();
        zyklus();
      }
      std::printf("f: allocations inside Kern::zyklus = %ld\n", im_zyklus);
      PRUEF(im_zyklus == 0);
    }
  }
  {  // (g) the re-report pauses on a full event ring and continues
    Aufbau a("test_kern_arr_auto_g", 32);
    a.x->abholen = false;   // the test reads the event ring itself
    cdj::Ereignisring& ere = *a.x->ere;
    cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(a.arr());
    Spiegel sp;
    leeren(ere, sp);
    for (int t = 1; t <= 32; ++t) a.cmd(t, 0, 0);   // every fader overridden and reported: the mirror holds 32 times 1
    a.lauf(4);
    leeren(ere, sp);
    int ueber = 0;
    for (int t = 1; t <= 32; ++t) ueber += sp.hole(t, 0);
    PRUEF(ueber == 32);
    cdj::ArrPruefZugang::voll_luegen(arr, 0);   // the ring of the Arrangement overflows: the next changes are dropped
    a.cmd(0, 0, 1);                             // release all: 32 events of 0, all dropped; only the re-report can bring the mirror back
    fuellen(ere, 10);                           // only 10 free slots in the event ring: the re-report of 32 fields has to pause
    const uint32_t v0 = arr.auto_ereignis_verloren();
    int vollstaendig_nach = -1;
    for (int z = 0; z < 60; ++z) {
      if (z == 1) a.cmd(30, 0, 0);   // mid-resync: a field the cursor has not reached
      if (z == 2) a.cmd(2, 0, 0);    // mid-resync: a field the cursor has already passed
      if (z == 3) a.cmd(2, 0, 1);    // and back
      a.x->zyklen(a.x->kern->sample() + N);
      leeren(ere, sp);               // the reader drains everything, then the ring is made nearly full again
      if (vollstaendig_nach < 0 && z >= 3 && falsche(arr, sp) == 0) vollstaendig_nach = z;
      if (z < 30) fuellen(ere, 10);
    }
    a.x->zyklen(a.x->kern->sample() + 10 * N);
    leeren(ere, sp);
    std::printf("g: dropped %u -> %u, complete after cycle %d, mismatches %d\n", v0, arr.auto_ereignis_verloren(), vollstaendig_nach, falsche(arr, sp));
    PRUEF(arr.auto_ereignis_verloren() > v0);
    PRUEF(vollstaendig_nach >= 2);            // the re-report really paused (a ring with room needs one cycle)
    PRUEF(falsche(arr, sp) == 0);             // the mirror ends in the truth
    PRUEF(arr.auto_uebersteuert(29, 0));      // the change mid-resync is real and mirrored
    PRUEF(!arr.auto_uebersteuert(1, 0) && !arr.auto_uebersteuert(4, 0));
    PRUEF(sp.hole(30, 0) == 1 && sp.hole(2, 0) == 0 && sp.hole(5, 0) == 0 && sp.hole(32, 0) == 0);   // 32 is after the cursor for the longest: its 1 is gone
  }
  {  // (g2) control: with room in the ring the same actions end in the truth with no pause (the pause above is the full ring, not the sequence)
    Aufbau a("test_kern_arr_auto_g2", 32);
    a.x->abholen = false;
    cdj::Ereignisring& ere = *a.x->ere;
    Spiegel sp;
    a.cmd(5, 0, 0);
    a.cmd(30, 0, 0);
    a.cmd(2, 0, 0);
    a.cmd(2, 0, 1);
    a.lauf(6);
    leeren(ere, sp);
    PRUEF(falsche(a.arr(), sp) == 0 && sp.hole(30, 0) == 1 && sp.hole(5, 0) == 1);
  }
  {  // (h) the names of the generated list give the field of their index
    Aufbau a("test_kern_arr_auto_h");
    static_assert(cypherdj::osc::werte::auto_ziel.size() == cdj::Arrangement::AUTO_FELDER, "one name per field");
    for (int i = 0; i < static_cast<int>(cypherdj::osc::werte::auto_ziel.size()); ++i) {
      const std::string name(cypherdj::osc::werte::auto_ziel[static_cast<size_t>(i)]);
      const bool sprung = name == "mute" || name == "solo";
      const std::string lane = arrdatei::Ordner::auto_lane(sprung ? std::vector<std::tuple<double, double, int>>{{0.0, 0.0, 2}, {4.0, 1.0, 2}}
                                                                  : std::vector<std::tuple<double, double, int>>{{0.0, 0.0, 0}, {16.0, name == "pan" ? 0.5 : -30.0, 0}},
                                                           name.c_str());
      const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + a.x->ordner.clip("c1", 0.0, 30.0, a.audio, 800000) + "],\"auto\":[" + lane + "]}";
      a.x->laden(10 + i, spur, "andreas", true);
      a.lauf(2);
      for (int f = 0; f < cdj::Arrangement::AUTO_FELDER; ++f) {
        PRUEF(a.arr().auto_lane_da(0, f) == (f == i));   // exactly the field of this name; the others have no lane
      }
    }
  }
  {  // (i) order of the refusals and the AI stop
    Aufbau a("test_kern_arr_auto_i");
    const int64_t i1 = a.cmd(99, 4, 0), i2 = a.cmd(0, 4, 0), i3 = a.cmd(0, 0, 0), i4 = a.cmd(1, 4, 0, "cypher"), i5 = a.cmd(99, 0, 0, "cypher");
    a.lauf();
    PRUEF(a.refused(i1, "format"));                // spur outside 0..32 comes before the field
    PRUEF(a.refused(i2, "auto_ziel_unbekannt"));   // the field comes before spur 0 with an 0
    PRUEF(a.refused(i3, "format"));                // spur 0 with an 0
    PRUEF(a.refused(i4, "auto_ziel_unbekannt"));   // the field comes before nur_andreas
    PRUEF(a.refused(i5, "format"));                // so does the range
    // AI stop: the core backstop answers ki_gestoppt first, also for a command that would otherwise be a range error; andreas is not stopped
    cdj::Befehl k = a.x->neu(cdj::Befehl::KI_STOPP, "andreas");
    a.x->sende(k);
    a.lauf();
    const int64_t k1 = a.cmd(1, 0, 1, "cypher"), k2 = a.cmd(99, 4, 0, "cypher"), k3 = a.cmd(1, 0, 0, "andreas");
    a.lauf();
    PRUEF(a.refused(k1, "ki_gestoppt") && a.refused(k2, "ki_gestoppt"));
    PRUEF(a.x->quittung(k3, 3) && a.arr().auto_uebersteuert(0, 0));
  }
  PRUEF_ENDE();
}
