// Strand 7 task 1.3: the MIDI stage inside the Arrangement (plan 2026-11-27 strang7-midi). Every note of a track with an active stage (ArrSpur::midi.an)
// goes through that track's cdj::MidiStufe; the stage runs every block, also on a stopped transport, and its grid is the project beat grid while the
// transport plays (the clock grid of the Karte while it stands). Map: 128 BPM, 22 500 samples per beat, 1/16 = 5625 samples; a start on the bar lands
// on sample 90 000.
//   1  intern sink (vorhalt 0): chord 60 64 67 held 0..4, arp up 1/16: 16 ONs on the 1/16 grid, offs at gate 0.5 (2813 samples)
//   2  the same on a wirt sink with vorhalt 537: every event arrives in the block that holds ziel - 537
//   3  loop 0..4, chord held 0..4: pass 2 restarts the pattern on the seam sample, the step count keeps rising, no hanging note at the seam
//   4  live key on a stopped transport: steps on the clock grid (D5: 100 samples late starts at once), silence after the release
//   5  stop mid-chord: every output ends at the stop sample, nothing after it
//   6  swap that switches the stage off: outputs off at the swap, a later clip note goes straight to the sink
//   7  swap that changes the rate: offs at the swap, the new grid after it with its own gate from the first step, no hanging note
//   8  a track without midi gives the same events as the same scene with an = false (and with the arp fields set but an = false)
//   9  task 5.2, harmony lane A minor from 0, D minor from 8, scale stage with skala_lane: a 70 at beat 2 -> 69, at beat 8 and 9 -> 70; a lane that starts at 4:
//      skala_maske (A minor) before it; without skala_lane the lane is ignored; a snapshot without the lane plays as before
//  10  task 5.2, arp up 1/16 of a 70 held 6..10 across the change at 8: 69 on every step before 8, 70 from the first step at or after 8 on
//  11  task 5.2, live keys: stopped (start_beat 0) -> A minor; while playing at beat 9 -> D minor, at beat 2 -> A minor
//  12  transport start 337 samples (0.06 step) after a clock grid point: the held chord fires once on project step 0, not also at once on the clock step (16 ONs)
//   M  no allocation, lock or sleep in block() and tausche() with stages running (positive control: the watcher counts)
#include <cstdio>
#include <map>
#include <vector>

#include "arr_build.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int64_t V = 537;
constexpr int64_t START = 90000;   // the bar after sample 0 (quant 2)
constexpr int64_t SCHRITT = 5625;  // 1/16 at 128 BPM
constexpr int64_t GATE = 2813;     // llround(0.5 * 5625)

cdj::ArrMidiParam arp(double rate = 0.25, cdj::ArpMuster m = cdj::ArpMuster::up) {
  cdj::ArrMidiParam p;
  p.an = true;
  p.arp = true;
  p.muster = m;
  p.sync = true;
  p.rate_beats = rate;
  p.oktaven = 1;
  p.gate = 0.5f;
  return p;
}

Bau& akkord(Bau& b, int spur, double von, double laenge) {
  return b.note(spur, "a/60", von, laenge, 60).note(spur, "a/64", von, laenge, 64).note(spur, "a/67", von, laenge, 67);
}

// every ON of a pitch is followed by an OFF of that pitch before the next ON, and the last event of every pitch is an OFF; an OFF without an ON
// (a stray off after a stage was switched off) is allowed
bool keine_haengende(const PruefSenke& s) {
  std::map<int, bool> klingt;   // key: track * 128 + pitch
  for (const PruefSenke::Ev& e : s.ev) {
    const int k = e.spur * 128 + e.ton;
    if (e.an) {
      if (klingt[k]) return false;
      klingt[k] = true;
    } else {
      klingt[k] = false;
    }
  }
  for (const auto& [ton, an] : klingt)
    if (an) return false;
  return true;
}

// pitch class masks (bit pc, 0 = C)
constexpr uint16_t maske_von(std::initializer_list<int> pcs) {
  uint16_t m = 0;
  for (int pc : pcs) m = static_cast<uint16_t>(m | (1u << pc));
  return m;
}
constexpr uint16_t A_MOLL = maske_von({9, 11, 0, 2, 4, 5, 7});
constexpr uint16_t D_MOLL = maske_von({2, 4, 5, 7, 9, 10, 0});

void lane(cdj::ArrSnapshot* s, std::initializer_list<std::pair<double, uint16_t>> e) {
  s->n_harmonie = 0;
  for (const auto& [b, m] : e) {
    s->harmonie_beat[s->n_harmonie] = b;
    s->harmonie_maske[s->n_harmonie] = m;
    ++s->n_harmonie;
  }
}

cdj::ArrMidiParam skala(uint16_t maske, bool mit_lane) {
  cdj::ArrMidiParam p;
  p.an = true;
  p.skala_maske = maske;
  p.skala_lane = mit_lane;
  return p;
}

bool rechtzeitig(const PruefSenke::Ev& e, int64_t v, int n = 256) { return e.block_s0 <= e.ziel - v && e.ziel - v < e.block_s0 + n; }

}  // namespace

int main() {
  {  // 1: intern sink, vorhalt 0
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(3, ArrArt::intern);
    akkord(b, 3, 0.0, 4.0);
    b.midi(3, arp());
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(300000);
    const auto on = rb.ons(), off = rb.offs();
    std::printf("1: %zu ons, %zu offs\n", on.size(), off.size());
    PRUEF(on.size() == 16);
    const int ton_soll[3] = {60, 64, 67};
    for (size_t i = 0; i < on.size() && i < 16; ++i) {
      PRUEF(on[i].ziel == START + static_cast<int64_t>(i) * SCHRITT);
      PRUEF(on[i].ton == ton_soll[i % 3]);
      PRUEF(on[i].vel == 100 && on[i].spur == 2);
    }
    // the 16 step offs at gate, plus nothing else sounding (the input offs at 180 000 are taken by the stage)
    PRUEF(off.size() == 16);
    for (size_t i = 0; i < off.size() && i < 16; ++i) PRUEF(off[i].ziel == START + static_cast<int64_t>(i) * SCHRITT + GATE);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(2).ruhig());
    PRUEF(t.arr.midi_stufe(2).ein_noten() == 3 && t.arr.midi_stufe(2).aus_noten() == 16);
  }
  {  // 2: wirt sink slot 1, vorhalt 537
    Treiber t;
    PruefSenke w(V);
    t.senken.push_back(&w);
    t.arr.setze_senke_wirt(1, &w);
    Bau b;
    b.spur(2, ArrArt::wirt, 1);
    akkord(b, 2, 0.0, 4.0);
    b.midi(2, arp());
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(300000);
    const auto on = w.ons();
    std::printf("2: %zu ons, %zu offs\n", on.size(), w.offs().size());
    PRUEF(on.size() == 16 && w.offs().size() == 16);
    for (size_t i = 0; i < on.size() && i < 16; ++i) PRUEF(on[i].ziel == START + static_cast<int64_t>(i) * SCHRITT);
    for (const PruefSenke::Ev& e : w.ev) PRUEF(rechtzeitig(e, V));
    PRUEF(keine_haengende(w));
  }
  {  // 3: loop 0..4, chord held 0..4: two passes, the second restarts on the seam sample 180 000
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(1, ArrArt::intern);
    akkord(b, 1, 0.0, 4.0);
    b.midi(1, arp());
    t.laden(b.fertig());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(269824);   // before the third pass
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 2048);
    const auto on = rb.ons();
    std::printf("3: %zu ons\n", on.size());
    PRUEF(on.size() == 32);
    const int ton_soll[3] = {60, 64, 67};
    for (size_t i = 0; i < on.size() && i < 32; ++i) {
      const size_t j = i % 16;   // the pattern restarts in every pass
      PRUEF(on[i].ziel == START + static_cast<int64_t>(i / 16) * 90000 + static_cast<int64_t>(j) * SCHRITT);
      PRUEF(on[i].ton == ton_soll[j % 3]);
    }
    PRUEF(on.size() > 16 && on[16].ziel == 180000 && on[16].ton == 60);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(0).ruhig());
  }
  {  // 4: live key on a stopped transport
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(4, ArrArt::intern);
    b.midi(4, arp());
    t.laden(b.fertig());
    t.lauf(45056);   // the stage sees the clock grid (multiples of 5625) while nothing is held
    t.arr.live_note(3, 45100, 60, 90, true);   // 100 samples after the grid point 45 000: immediate (D5)
    t.lauf(90112);
    t.arr.live_note(3, 90150, 60, 0, false);
    t.lauf(150000);
    const auto on = rb.ons();
    std::printf("4: %zu ons, %zu offs\n", on.size(), rb.offs().size());
    PRUEF(on.size() == 9);
    for (size_t i = 0; i < on.size(); ++i) {
      PRUEF(on[i].ziel == (i == 0 ? 45100 : 45000 + static_cast<int64_t>(i) * SCHRITT));
      PRUEF(on[i].ton == 60 && on[i].vel == 90 && on[i].spur == 3);
    }
    PRUEF(rb.offs().size() == 9);
    PRUEF(!rb.ev.empty() && rb.ev.back().ziel == 90000 + GATE && !rb.ev.back().an);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(3).ruhig());
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);
  }
  {  // 5: stop mid-chord (sample 120 000, between the step at 118 125 and its off at 120 938)
    Treiber t;
    t.n = 240;   // 120 000 is a block start
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(1, ArrArt::intern);
    akkord(b, 1, 0.0, 4.0);
    b.midi(1, arp());
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 240, t.k);
    t.lauf(120000);
    t.arr.stopp(0, t.s, t.k);
    t.lauf(200000);
    const auto on = rb.ons(), off = rb.offs();
    std::printf("5: %zu ons, %zu offs\n", on.size(), off.size());
    PRUEF(on.size() == 6);   // 90 000 .. 118 125
    for (const auto& e : on) PRUEF(e.ziel < 120000);
    PRUEF(!off.empty() && off.back().ziel == 120000 && off.back().ton == 67);
    for (const auto& e : off) PRUEF(e.ziel <= 120000);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(0).ruhig());
  }
  {  // 6: swap at 120 000 that switches the stage off; a later clip note (72 at beat 6..7) goes straight to the sink
    Treiber t;
    t.n = 240;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    auto szene = [](bool an) {
      Bau b(an ? 1 : 2);
      b.spur(1, ArrArt::intern);
      akkord(b, 1, 0.0, 4.0);
      b.note(1, "a/72", 6.0, 1.0, 72);
      if (an) b.midi(1, arp());
      return b.fertig();
    };
    t.laden(szene(true));
    t.arr.start(0.0, 2, false, 0, V, 240, t.k);
    t.lauf(120000);
    t.laden(szene(false));
    t.lauf(300000);
    const auto on = rb.ons();
    std::printf("6: %zu ons, %zu offs\n", on.size(), rb.offs().size());
    PRUEF(on.size() == 7);   // six steps, then 72 directly
    for (size_t i = 0; i + 1 < on.size(); ++i) PRUEF(on[i].ziel < 120000);
    PRUEF(on.size() == 7 && on[6].ton == 72 && on[6].ziel == START + 6 * SPB && on[6].vel == 100);
    bool aus_am_tausch = false;
    for (const auto& e : rb.ev) aus_am_tausch |= !e.an && e.ton == 67 && e.ziel == 120000;
    PRUEF(aus_am_tausch);   // the step that sounded at the swap ends there
    bool aus_72 = false;
    for (const auto& e : rb.ev) aus_72 |= !e.an && e.ton == 72 && e.ziel == START + 7 * SPB;
    PRUEF(aus_72);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(0).ruhig());
  }
  {  // 7: swap at 120 000 that changes the rate 1/16 -> 1/8: the sounding step ends at the swap, the next step is the next 1/8 grid point
    Treiber t;
    t.n = 240;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    auto szene = [](double rate, int nr) {
      Bau b(nr);
      b.spur(1, ArrArt::intern);
      akkord(b, 1, 0.0, 4.0);
      b.midi(1, arp(rate));
      return b.fertig();
    };
    t.laden(szene(0.25, 1));
    t.arr.start(0.0, 2, false, 0, V, 240, t.k);
    t.lauf(120000);
    t.laden(szene(0.5, 2));
    t.lauf(300000);
    const auto on = rb.ons();
    std::printf("7: %zu ons, %zu offs\n", on.size(), rb.offs().size());
    // 6 steps of 1/16 before the swap; after it the 1/8 grid from 123 750 to 168 750: 5 steps (the pattern restarts at 60)
    PRUEF(on.size() == 11);
    for (size_t i = 6; i < on.size(); ++i) PRUEF(on[i].ziel == 123750 + static_cast<int64_t>(i - 6) * 2 * SCHRITT);
    PRUEF(on.size() > 6 && on[6].ton == 60);
    bool gate_neu = false;   // the first step after the swap has the gate of the new rate (0.5 * 11 250), not of the old one
    for (const auto& e : rb.ev) gate_neu |= !e.an && e.ton == 60 && e.ziel == 123750 + SCHRITT;
    PRUEF(gate_neu);
    bool aus_am_tausch = false;
    for (const auto& e : rb.ev) aus_am_tausch |= !e.an && e.ton == 67 && e.ziel == 120000;
    PRUEF(aus_am_tausch);
    PRUEF(keine_haengende(rb));
    PRUEF(t.arr.midi_stufe(0).ruhig());
  }
  {  // 8: no stage = the old path, event for event (clip notes, a loop, live keys, a stop)
    auto lauf = [](int fall) {
      Treiber t;
      PruefSenke rb(0), w(V);
      t.senken.push_back(&rb);
      t.senken.push_back(&w);
      t.arr.setze_senke_intern(&rb);
      t.arr.setze_senke_wirt(1, &w);
      Bau b;
      b.spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1);
      akkord(b, 1, 0.0, 4.0);
      akkord(b, 2, 1.0, 2.5);
      if (fall == 1) b.s->spur[0].midi.an = false;
      if (fall == 2) {
        b.midi(1, arp());
        b.s->spur[0].midi.an = false;
        b.midi(2, arp(0.125, cdj::ArpMuster::random));
        b.s->spur[1].midi.an = false;
      }
      t.laden(b.fertig());
      t.arr.loop(true, 0.0, 4.0, t.s, t.k);
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(100096);
      t.arr.live_note(0, 100100, 50, 80, true);
      t.lauf(130048);
      t.arr.live_note(0, 130050, 50, 0, false);
      t.lauf(250112);
      t.arr.stopp(0, t.s, t.k);
      t.lauf(300000);
      std::vector<PruefSenke::Ev> alle = rb.ev;
      alle.insert(alle.end(), w.ev.begin(), w.ev.end());
      return alle;
    };
    const auto a = lauf(0), b = lauf(1), c = lauf(2);
    std::printf("8: %zu events\n", a.size());
    PRUEF(a.size() > 20);
    auto gleich = [](const std::vector<PruefSenke::Ev>& x, const std::vector<PruefSenke::Ev>& y) {
      if (x.size() != y.size()) return false;
      for (size_t i = 0; i < x.size(); ++i)
        if (x[i].spur != y[i].spur || x[i].ziel != y[i].ziel || x[i].ton != y[i].ton || x[i].vel != y[i].vel || x[i].an != y[i].an ||
            x[i].block_s0 != y[i].block_s0)
          return false;
      return true;
    };
    PRUEF(gleich(a, b));
    PRUEF(gleich(a, c));
  }
  {  // 9: clip notes snap to the lane's mask at their own beat
    auto lauf = [](int fall) {
      Treiber t;
      PruefSenke rb(0);
      t.senken.push_back(&rb);
      t.arr.setze_senke_intern(&rb);
      Bau b;
      b.spur(1, ArrArt::intern);
      b.note(1, "a/1", 2.0, 1.0, 70).note(1, "a/2", 8.0, 0.5, 70).note(1, "a/3", 9.0, 1.0, 70);
      b.midi(1, skala(A_MOLL, fall != 2));
      if (fall == 0 || fall == 2) lane(b.s.get(), {{0.0, A_MOLL}, {8.0, D_MOLL}});
      if (fall == 1) lane(b.s.get(), {{4.0, D_MOLL}});
      t.laden(b.fertig());
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(START + 11 * SPB);
      PRUEF(keine_haengende(rb));
      std::vector<int> t_on;
      for (const auto& e : rb.ons()) t_on.push_back(e.ton);
      if (t_on.size() < 3) t_on.resize(3, -1);
      PRUEF(rb.ons().size() == 3 && rb.ons()[0].ziel == START + 2 * SPB && rb.ons()[2].ziel == START + 9 * SPB);
      return t_on;
    };
    const auto a = lauf(0), b = lauf(1), c = lauf(2), d = lauf(3);
    std::printf("9: lane %d %d %d, lane from 4 %d %d %d, without skala_lane %d %d %d, without lane %d %d %d\n", a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1],
                c[2], d[0], d[1], d[2]);
    PRUEF((a == std::vector<int>{69, 70, 70}));
    PRUEF((b == std::vector<int>{69, 70, 70}));   // before the first entry the stage's own mask (A minor)
    PRUEF((c == std::vector<int>{69, 69, 69}));   // skala_lane off: the lane is not read
    PRUEF((d == std::vector<int>{69, 69, 69}));   // no lane in the snapshot: skala_maske
  }
  {  // 10: arp of a held 70 across the change at beat 8
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(1, ArrArt::intern);
    b.note(1, "a/1", 6.0, 4.0, 70);
    cdj::ArrMidiParam p = arp();
    p.skala_maske = A_MOLL;
    p.skala_lane = true;
    b.midi(1, p);
    lane(b.s.get(), {{0.0, A_MOLL}, {8.0, D_MOLL}});
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(START + 11 * SPB);
    const auto on = rb.ons();
    int vor = 0, nach = 0;
    bool ok = on.size() == 16;
    for (size_t i = 0; i < on.size(); ++i) {
      ok = ok && on[i].ziel == START + 6 * SPB + static_cast<int64_t>(i) * SCHRITT;
      if (on[i].ziel < START + 8 * SPB) vor += on[i].ton == 69;
      else nach += on[i].ton == 70;
    }
    std::printf("10: %zu ons, 69 before beat 8: %d, 70 from beat 8: %d\n", on.size(), vor, nach);
    PRUEF(ok && vor == 8 && nach == 8);
    PRUEF(keine_haengende(rb));
  }
  {  // 11: live keys take the lane at the project beat of their sample while playing, at start_beat_ while stopped
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(1, ArrArt::intern);
    b.midi(1, skala(maske_von({0, 2, 4, 5, 7, 9, 11}), true));   // C major before the lane (not reached here)
    lane(b.s.get(), {{0.0, A_MOLL}, {8.0, D_MOLL}});
    t.laden(b.fertig());
    t.lauf(20480);
    t.arr.live_note(0, 20500, 70, 90, true);
    t.lauf(30720);
    t.arr.live_note(0, 30730, 70, 0, false);
    t.lauf(40960);
    t.arr.start(0.0, 2, false, t.s, V, 256, t.k);
    t.lauf(START + 2 * SPB);
    t.arr.live_note(0, START + 2 * SPB + 10, 70, 90, true);
    t.lauf(START + 3 * SPB);
    t.arr.live_note(0, START + 3 * SPB + 10, 70, 0, false);
    t.lauf(START + 9 * SPB);
    t.arr.live_note(0, START + 9 * SPB + 10, 70, 90, true);
    t.lauf(START + 10 * SPB);
    t.arr.live_note(0, START + 10 * SPB + 10, 70, 0, false);
    t.lauf(START + 11 * SPB);
    const auto on = rb.ons();
    std::printf("11: %zu ons: %d %d %d\n", on.size(), on.size() > 0 ? on[0].ton : -1, on.size() > 1 ? on[1].ton : -1, on.size() > 2 ? on[2].ton : -1);
    PRUEF(on.size() == 3 && on[0].ton == 69 && on[1].ton == 69 && on[2].ton == 70);
    PRUEF(keine_haengende(rb));
  }
  {  // 12: start next to the clock grid. Clock point 45 000 (8 steps); the start at block 44 544 with quant 0 enters at 44 544 + 537 + 256 = 45 337
    Treiber t;
    PruefSenke rb(0);
    t.senken.push_back(&rb);
    t.arr.setze_senke_intern(&rb);
    Bau b;
    b.spur(1, ArrArt::intern);
    akkord(b, 1, 0.0, 4.0);
    b.midi(1, arp());
    t.laden(b.fertig());
    t.lauf(44544);   // the stage measured the clock grid
    t.arr.start(0.0, 0, false, t.s, V, 256, t.k);
    t.lauf(300000);
    const auto on = rb.ons();
    constexpr int64_t EIN = 45337;
    std::printf("12: %zu ons, first at %lld %lld\n", on.size(), on.size() > 0 ? static_cast<long long>(on[0].ziel) : -1LL,
                on.size() > 1 ? static_cast<long long>(on[1].ziel) : -1LL);
    PRUEF(on.size() == 16);
    const int ton_soll[3] = {60, 64, 67};
    for (size_t i = 0; i < on.size() && i < 16; ++i) {
      PRUEF(on[i].ziel == EIN + static_cast<int64_t>(i) * SCHRITT);
      PRUEF(on[i].ton == ton_soll[i % 3]);
    }
    PRUEF(keine_haengende(rb));
  }
  {  // M: no allocation, lock or sleep in block() and tausche() with stages on two sinks (clip notes, loop seams, live keys, swaps, a stop)
    Treiber t;
    PruefSenke rb(0), w(V);
    t.arr.setze_senke_intern(&rb);
    t.arr.setze_senke_wirt(1, &w);
    auto szene = [](int nr, double rate, cdj::ArpMuster m, bool an1) {
      Bau b(nr);
      b.spur(1, ArrArt::intern).spur(2, ArrArt::wirt, 1).spur(3, ArrArt::intern);
      akkord(b, 1, 0.0, 4.0);
      akkord(b, 2, 0.5, 3.0);
      b.note(3, "c/1", 1.0, 1.0, 40);
      if (an1) b.midi(1, arp(rate, m));
      b.midi(2, arp(rate / 2, cdj::ArpMuster::updown));
      b.s->spur[1].midi.oktaven = 2;
      cdj::ArrMidiParam frei = arp();
      frei.sync = false;
      frei.rate_hz = 9.0;
      b.midi(3, frei);
      b.s->spur[2].midi.skala_maske = A_MOLL;   // task 5.2: the lane paths too (free arp steps, clip notes, live keys)
      b.s->spur[2].midi.skala_lane = true;
      if (an1) {
        b.s->spur[0].midi.skala_maske = A_MOLL;
        b.s->spur[0].midi.skala_lane = true;
      }
      lane(b.s.get(), {{0.0, A_MOLL}, {2.0, D_MOLL}, {3.0, A_MOLL}});
      return b.fertig();
    };
    cdj::ArrSnapshot* sz[4] = {szene(1, 0.25, cdj::ArpMuster::up, true), szene(2, 0.5, cdj::ArpMuster::random, true),
                               szene(3, 0.25, cdj::ArpMuster::chord, false), szene(4, 0.125, cdj::ArpMuster::played, true)};
    std::vector<const cdj::ArrSnapshot*> weg;
    weg.reserve(8);
    if (const cdj::ArrSnapshot* a = t.arr.tausche(sz[0], 0, t.k)) weg.push_back(a);
    t.arr.loop(true, 0.0, 4.0, 0, t.k);
    float buf[6][cdj::ARR_BLOCK];
    AbfangZahlen z;
    int64_t s = 0;
    bool gestartet = false, gestoppt = false;
    for (int blk = 0; blk < 2400; ++blk, s += 256) {
      if (blk == 10) {
        t.arr.start(0.0, 2, false, s, V, 256, t.k);
        gestartet = true;
      }
      if (blk == 2000) {
        t.arr.stopp(0, s, t.k);
        gestoppt = true;
      }
      const bool tausch = blk % 300 == 150;
      abfang_an();
      if (blk % 97 == 5) t.arr.live_note((blk / 97) % 3, s + 17, static_cast<uint8_t>(48 + blk % 24), 100, true);
      if (blk % 97 == 60) t.arr.live_note((blk / 97) % 3, s + 3, static_cast<uint8_t>(48 + (blk - 55) % 24), 0, false);
      const cdj::ArrSnapshot* alt = tausch ? t.arr.tausche(sz[(blk / 300) % 4], s, t.k) : nullptr;
      t.arr.block(t.k, s, 256, buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]);
      abfang_aus();
      z += abfang_zahlen();
      if (alt && std::find(weg.begin(), weg.end(), alt) == weg.end()) weg.push_back(alt);
    }
    std::printf("M: intern %zu, wirt %zu events, allocations %ld, frees %ld, locks %ld, sleeps %ld\n", rb.ev.size(), w.ev.size(), z.alloc, z.frei,
                z.sperren, z.schlafen);
    PRUEF(gestartet && gestoppt);
    PRUEF(rb.ev.size() > 200 && w.ev.size() > 200 && rb.ev.size() < (1u << 16) && w.ev.size() < (1u << 16));
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(z.summe() == 0);
    PRUEF(keine_haengende(rb) && keine_haengende(w));
    abfang_an();
    { std::vector<int> v(100); }
    const long positiv = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);   // positive control: the watcher counts
    // the Treiber deletes the snapshot in force; the others here
    const cdj::ArrSnapshot* jetzt = t.arr.snapshot();
    for (cdj::ArrSnapshot* x : sz)
      if (x != jetzt) delete x;
  }
  PRUEF_ENDE();
}
