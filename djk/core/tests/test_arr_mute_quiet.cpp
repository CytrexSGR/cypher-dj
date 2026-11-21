// 2026-11-21 (Andreas, variant a): a muted pattern gets no note-ons, so its sink falls silent and rests instead of computing at full cost behind a closed mute
// (live: 10 muted SEQ patterns took half the CPU, the clock ran at 110 of 122 BPM). The mute course of the block decides per sample: a scene that unmutes on the bar
// keeps the note on that very sample. Offs still come. Not filtered: the track PFL is on, the old way by the seam (setze_stumm_ruhe(false)).
// Mutation: ARR_STUMM_NOTEN_GEHEN (every note goes, case 1 must go red).
#include <cstdio>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;

// track 3, internal sink (look-ahead 0): notes at beat 0.5 (sample 101250, in the block that starts at 101120) and beat 1.5 (sample 123750), 0.1 beat long
static void aufbau(Treiber& t, PruefSenke& rb) {
  t.senken.push_back(&rb);
  t.arr.setze_senke_intern(&rb);
  t.laden(Bau().spur(3, ArrArt::intern).note(3, "b/n1", 0.5, 0.1, 36).note(3, "b/n2", 1.5, 0.1, 38).fertig());
}

static int ons(const PruefSenke& s) {
  int n = 0;
  for (const auto& e : s.ev) n += e.an ? 1 : 0;
  return n;
}

int main() {
  {   // 1: muted from the start: no note-on reaches the sink, both are counted
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    t.arr.setze_sofort(t.tab.suche("spur/3/mute"), 1.0f);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(130000);
    PRUEF(ons(rb) == 0);
    PRUEF(t.arr.noten_stumm() == 2);
    std::printf("case 1 stumm: ons=%d noten_stumm=%llu\n", ons(rb), (unsigned long long)t.arr.noten_stumm());
  }
  {   // 2: control: unmuted, both notes arrive and nothing is counted
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(130000);
    PRUEF(ons(rb) == 2 && t.arr.noten_stumm() == 0);
  }
  {   // 3: unmute inside the block, exactly on the sample of the first note (a scene on the bar): that note arrives; the second note is muted again by a later block
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    const int mu = t.tab.suche("spur/3/mute");
    t.arr.setze_sofort(mu, 1.0f);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(101120);
    float vl[256];
    for (int i = 0; i < 256; ++i) vl[i] = i < 130 ? 1.0f : 0.0f;   // 101120 + 130 = 101250: unmuted from the note's own sample on
    t.arr.verlauf(mu, vl);
    t.lauf(101376);
    PRUEF(ons(rb) == 1 && rb.ev.size() >= 1 && rb.ev[0].an && rb.ev[0].ziel == 101250);
    t.arr.setze_sofort(mu, 1.0f);
    t.lauf(130000);
    PRUEF(ons(rb) == 1 && t.arr.noten_stumm() == 1);
    int offs = 0;
    for (const auto& e : rb.ev) offs += e.an ? 0 : 1;
    PRUEF(offs >= 1);   // the off of the note that started still comes while the track is muted
  }
  {   // 4: mute one sample after the note: the note still goes (the course is read at the note's sample)
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    const int mu = t.tab.suche("spur/3/mute");
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(101120);
    float vl[256];
    for (int i = 0; i < 256; ++i) vl[i] = i < 131 ? 0.0f : 1.0f;
    t.arr.verlauf(mu, vl);
    t.lauf(101376);
    PRUEF(ons(rb) == 1 && rb.ev[0].ziel == 101250);
  }
  {   // 5: the track PFL is on: the cue hears the track in front of the mute, so the muted track keeps its notes
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    t.arr.setze_sofort(t.tab.suche("spur/3/mute"), 1.0f);
    t.arr.setze_sofort(t.tab.suche("spur/3/pfl"), 1.0f);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(130000);
    PRUEF(ons(rb) == 2 && t.arr.noten_stumm() == 0);
  }
  {   // 6: the seam switches it off: the old way, a muted track gets every note
    Treiber t;
    PruefSenke rb(0);
    aufbau(t, rb);
    t.arr.setze_stumm_ruhe(false);
    t.arr.setze_sofort(t.tab.suche("spur/3/mute"), 1.0f);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(130000);
    PRUEF(ons(rb) == 2 && t.arr.noten_stumm() == 0);
  }
  PRUEF_ENDE();
}
