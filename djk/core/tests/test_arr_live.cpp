// 1.8 T7b: live notes of the MIDI-armed instrument tracks at the module (Arrangement::live_note, live_alle_aus, live_spur_aus, live_tauschen, live_ziel). Stand-in sinks A (internal) and
// B (Wirt slot 1) record what reaches them. The live table keeps the sink that got every On: the Off goes there, also after a swap.
//   L1 routing: On and Off reach the sink of the track (A for track 1, B for track 2), at the stamp; a track without a sink and an Off without an On send nothing; vel 0 as an On is
//      sent as vel 1; the table of the live notes is apart from offene_noten()
//   L2 retrigger: the same key again closes the old note at the new onset (Off before On at the same sample), the table holds one entry
//   L3 live_alle_aus closes every held key of every track, per-key offs only (no all-off: the notes of the playback on the same track keep sounding); live_spur_aus one track
//   L4 transport stop with a scheduled note and a live key on the same track: both end, the table is 0
//   L4b planned (quantized) transport stop inside a block, a live On stamped AFTER the stop sample in the same cycle: the On is queued before Arrangement::block runs, so the stop must not
//      close it (its Off would precede the On: a hanging note whose physical Off is then dropped); it stays held and the player's Off ends it. A key that began before the stop sample ends at it.
//   L5 swap: the Off of a held key reaches the OLD sink (A) when the track gets another sink (B), becomes empty or is unloaded; a swap that keeps the sink keeps the key (negative control)
//   L6 live_ziel: the stamp of an event is clamped into the first sub-block (1024 samples) of the cycle, whatever the quantum
// Mutations: LIVE_NOTE_VERWORFEN (L1), LIVE_ALLE_AUS_LEER (L3, L4), LIVE_AUS_NEUE_SENKE (L5).
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;

namespace {

int zaehle(const PruefSenke& s, int spur, int ton, bool an) {
  int n = 0;
  for (const auto& e : s.ev) n += e.spur == spur && e.ton == ton && e.an == an ? 1 : 0;
  return n;
}

// A: intern (track 1), B: Wirt slot 1 (track 2); a third track stays empty
struct Aufbau {
  std::unique_ptr<Treiber> tp{new Treiber()};
  Treiber& t = *tp;
  PruefSenke a{0}, b{537};
  Aufbau() {
    t.arr.setze_senke_intern(&a);
    t.arr.setze_senke_wirt(1, &b);
    t.senken.push_back(&a);
    t.senken.push_back(&b);
    t.laden(Bau(1).spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1).fertig());
  }
};

}  // namespace

int main() {
  {  // L1: routing
    Aufbau x;
    cdj::Arrangement& r = x.t.arr;
    r.live_note(0, 1000, 60, 100, true);
    r.live_note(1, 2000, 62, 90, true);
    r.live_note(2, 3000, 64, 80, true);   // track 3 is empty: no sink, nothing held
    r.live_note(0, 1100, 61, 0, true);    // vel 0 as an On: sent as 1
    PRUEF(x.a.ons().size() == 2 && x.b.ons().size() == 1);
    PRUEF(x.a.ev.size() >= 2 && x.b.ev.size() >= 1);
    if (x.a.ev.size() >= 2 && x.b.ev.size() >= 1) {
      PRUEF(x.a.ev[0].spur == 0 && x.a.ev[0].ziel == 1000 && x.a.ev[0].ton == 60 && x.a.ev[0].vel == 100 && x.a.ev[0].an);
      PRUEF(x.b.ev[0].spur == 1 && x.b.ev[0].ziel == 2000 && x.b.ev[0].ton == 62 && x.b.ev[0].vel == 90);   // the Wirt sink gets the stamp as it is (it sends at ziel - vorhalt)
      PRUEF(x.a.ev[1].ton == 61 && x.a.ev[1].vel == 1);
    }
    PRUEF(r.live_offene_noten() == 3 && r.offene_noten() == 0);   // the two tables are apart
    r.live_note(0, 1500, 77, 0, false);    // an off with no on: nothing
    r.live_note(0, 1600, 60, 0, false);
    r.live_note(1, 2600, 62, 0, false);
    PRUEF(x.a.offs().size() == 1 && x.b.offs().size() == 1);
    if (x.a.offs().size() == 1) PRUEF(x.a.offs()[0].ton == 60 && x.a.offs()[0].ziel == 1600 && x.a.offs()[0].spur == 0);
    if (x.b.offs().size() == 1) PRUEF(x.b.offs()[0].ton == 62 && x.b.offs()[0].ziel == 2600);
    PRUEF(r.live_offene_noten() == 1);     // key 61 is still held
    r.live_note(0, 1700, 61, 0, false);
    PRUEF(r.live_offene_noten() == 0);
    r.live_note(-1, 1, 60, 100, true);     // out of range: ignored
    r.live_note(cdj::ARR_SPUREN, 1, 60, 100, true);
    PRUEF(r.live_offene_noten() == 0 && x.a.ons().size() == 2);
  }
  {  // L2: retrigger
    Aufbau x;
    cdj::Arrangement& r = x.t.arr;
    r.live_note(0, 1000, 60, 100, true);
    r.live_note(0, 1500, 60, 90, true);
    PRUEF(x.a.ev.size() == 3);
    if (x.a.ev.size() == 3) {
      PRUEF(x.a.ev[0].an && x.a.ev[0].ziel == 1000);
      PRUEF(!x.a.ev[1].an && x.a.ev[1].ziel == 1500 && x.a.ev[1].ton == 60);   // the old note ends at the new onset, before the new On
      PRUEF(x.a.ev[2].an && x.a.ev[2].ziel == 1500 && x.a.ev[2].vel == 90);
    }
    PRUEF(r.live_offene_noten() == 1);
    r.live_note(0, 1800, 60, 0, false);
    PRUEF(r.live_offene_noten() == 0 && x.a.offs().size() == 2);
  }
  {  // L3: live_alle_aus and live_spur_aus
    Aufbau x;
    cdj::Arrangement& r = x.t.arr;
    r.live_note(0, 1000, 60, 100, true);
    r.live_note(0, 1000, 64, 100, true);
    r.live_note(1, 1000, 62, 100, true);
    PRUEF(r.live_offene_noten() == 3);
    r.live_spur_aus(0, 1200);   // one track: A gets both offs, B nothing
    PRUEF(r.live_offene_noten() == 1 && x.a.offs().size() == 2 && x.b.offs().empty());
    r.live_note(0, 1300, 67, 100, true);
    r.live_alle_aus(1400);
    PRUEF(r.live_offene_noten() == 0);
    PRUEF(zaehle(x.a, 0, 67, false) == 1 && zaehle(x.b, 1, 62, false) == 1);
    for (const auto& e : x.a.offs()) PRUEF(e.ziel >= 1200);
    PRUEF(x.a.alle_aus_ev.empty() && x.b.alle_aus_ev.empty());   // per-key offs only
    r.live_alle_aus(1500);   // nothing held: nothing sent
    PRUEF(x.a.offs().size() == 3 && x.b.offs().size() == 1);
  }
  {  // L4: transport stop: a scheduled note and a live key on the same track end together
    Aufbau x;
    x.t.laden(Bau(2).spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1).note(1, "s/n1", 0.0, 4.0, 48, 100).fertig());
    x.t.arr.start(0.0, 0, false, x.t.s, 537, 256, x.t.k);
    x.t.lauf(x.t.s + 4 * 256 + 3000);
    PRUEF(x.a.ons().size() == 1 && x.t.arr.offene_noten() == 1);   // the scheduled note sounds
    x.t.arr.live_note(0, x.t.s + 5, 60, 100, true);
    x.t.lauf(x.t.s + 512);
    PRUEF(x.t.arr.live_offene_noten() == 1 && x.t.arr.status() == cdj::ArrStatus::spielt);
    x.t.arr.stopp(0, x.t.s, x.t.k);   // quant 0: the stop is carried out by the next block (beende)
    x.t.lauf(x.t.s + 256);
    PRUEF(x.t.arr.status() == cdj::ArrStatus::steht && x.t.arr.live_offene_noten() == 0 && x.t.arr.offene_noten() == 0);
    PRUEF(zaehle(x.a, 0, 60, false) == 1 && zaehle(x.a, 0, 48, false) == 1);
    PRUEF(!x.a.alle_aus_ev.empty());   // the all-off of the stop (as before this task)
    // a stop of a stopped transport is no event: a held key keeps sounding
    x.t.arr.live_note(0, x.t.s + 5, 62, 100, true);
    x.t.arr.stopp(0, x.t.s, x.t.k);
    x.t.lauf(x.t.s + 256);
    PRUEF(x.t.arr.live_offene_noten() == 1);
  }
  {  // L4b: planned stop inside a block, live On after the stop sample in the same cycle
    Aufbau x;
    cdj::Arrangement& r = x.t.arr;
    r.start(0.0, 0, false, x.t.s, 537, 256, x.t.k);
    x.t.lauf(24576);   // past the first beat (start at sample 537, 128 bpm): the stop below falls on the second beat, 225 samples into its block
    r.stopp(1, x.t.s, x.t.k);   // next beat: a planned stop, carried out by beende() at its own sample inside a block
    const int64_t z = r.stopp_sample();
    const int64_t bs = z / 256 * 256;   // first sample of the block that holds the stop
    PRUEF(z > x.t.s && z % 256 > 1 && z % 256 < 245);
    x.t.lauf(bs);
    PRUEF(x.t.s == bs && r.status() == cdj::ArrStatus::spielt);
    r.live_note(0, bs + 1, 62, 100, true);    // before the stop sample: held through it, ends at it
    r.live_note(0, z + 10, 60, 100, true);    // after the stop sample, same cycle (Kern::midi_ein_stempeln runs before the block)
    x.t.lauf(bs + 256);
    PRUEF(r.status() == cdj::ArrStatus::steht);
    PRUEF(zaehle(x.a, 0, 62, false) == 1 && !x.a.offs().empty() && x.a.offs()[0].ziel == z);   // the early key ends at the stop sample
    PRUEF(zaehle(x.a, 0, 60, true) == 1 && zaehle(x.a, 0, 60, false) == 0);   // the late key sounds and is still held: no Off before its On
    PRUEF(r.live_offene_noten() == 1);
    PRUEF(x.a.alle_aus_ev.size() == 1 && x.a.alle_aus_ev[0].second == z);
    r.live_note(0, x.t.s + 5, 60, 0, false);   // the player lets go: the Off finds the entry (before the fix it was dropped and the note rang on)
    PRUEF(r.live_offene_noten() == 0 && zaehle(x.a, 0, 60, false) == 1);
    for (const auto& e : x.a.offs())
      if (e.ton == 60) PRUEF(e.ziel >= z + 10);
  }
  {  // L5: swaps
    {  // the track gets another sink (A -> B): the Off goes to A
      Aufbau x;
      cdj::Arrangement& r = x.t.arr;
      r.live_note(0, 1000, 60, 100, true);
      x.t.lauf(x.t.s + 512);
      const int64_t s = x.t.s;
      x.t.laden(Bau(2).spur(1, ArrArt::wirt, 1).spur(2, ArrArt::wirt, 1).fertig());
      PRUEF(r.live_offene_noten() == 0);
      PRUEF(zaehle(x.a, 0, 60, false) == 1 && zaehle(x.b, 0, 60, false) == 0);   // the old sink got the Off, the new one never held the note
      PRUEF(!x.a.offs().empty() && x.a.offs()[0].ziel == s);   // A: vorhalt 0
      r.live_note(0, s + 300, 60, 100, true);   // the key played again goes to the new sink
      PRUEF(zaehle(x.b, 0, 60, true) == 1 && r.live_offene_noten() == 1);
      r.live_note(0, s + 600, 60, 0, false);
      PRUEF(zaehle(x.b, 0, 60, false) == 1 && zaehle(x.a, 0, 60, false) == 1);
    }
    {  // the Wirt sink keeps its vorhalt: the Off of a swap is due at s + vorhalt
      Aufbau x;
      cdj::Arrangement& r = x.t.arr;
      r.live_note(1, 1000, 62, 100, true);
      x.t.lauf(x.t.s + 512);
      const int64_t s = x.t.s;
      x.t.laden(Bau(2).spur(1, ArrArt::intern).spur(2, ArrArt::intern).fertig());   // B -> A
      PRUEF(r.live_offene_noten() == 0 && zaehle(x.b, 1, 62, false) == 1 && zaehle(x.a, 1, 62, false) == 0);
      PRUEF(!x.b.offs().empty() && x.b.offs()[0].ziel == s + 537);
    }
    {  // the track becomes empty, and the playback is unloaded: the Off reaches A both times
      Aufbau x;
      cdj::Arrangement& r = x.t.arr;
      r.live_note(0, 1000, 60, 100, true);
      x.t.laden(Bau(2).spur(2, ArrArt::wirt, 1).fertig());
      PRUEF(r.live_offene_noten() == 0 && zaehle(x.a, 0, 60, false) == 1);
      x.t.laden(Bau(3).spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1).fertig());
      r.live_note(0, x.t.s + 5, 64, 100, true);
      PRUEF(r.live_offene_noten() == 1);
      if (const cdj::ArrSnapshot* alt = r.tausche(nullptr, x.t.s, x.t.k)) x.t.alt.push_back(alt);
      PRUEF(r.live_offene_noten() == 0 && zaehle(x.a, 0, 64, false) == 1);
    }
    {  // negative control: a swap that keeps the sink keeps the key; the later Off goes to the same sink
      Aufbau x;
      cdj::Arrangement& r = x.t.arr;
      r.live_note(0, 1000, 60, 100, true);
      x.t.laden(Bau(2).spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1).fertig());
      PRUEF(r.live_offene_noten() == 1 && x.a.offs().empty());
      r.live_note(0, x.t.s + 100, 60, 0, false);
      PRUEF(r.live_offene_noten() == 0 && x.a.offs().size() == 1);
    }
  }
  {  // L6: live_ziel
    PRUEF(cdj::Arrangement::live_ziel(10000, 100, 256) == 10100);
    PRUEF(cdj::Arrangement::live_ziel(10000, 255, 256) == 10255);
    PRUEF(cdj::Arrangement::live_ziel(10000, 300, 256) == 10255);    // an offset behind the cycle (never from JACK): the last sample
    PRUEF(cdj::Arrangement::live_ziel(10000, 1500, 2048) == 11023);  // quantum 2048: the first sub-block holds 1024 samples
    PRUEF(cdj::Arrangement::live_ziel(10000, 1023, 2048) == 11023);
    PRUEF(cdj::Arrangement::live_ziel(10000, 800, 2048) == 10800);
    PRUEF(cdj::Arrangement::live_ziel(10000, 5, 0) == 10000);        // degenerate cycle length
    PRUEF(cdj::Arrangement::live_ziel(10000, 5, 1) == 10000);
  }
  PRUEF_ENDE();
}
