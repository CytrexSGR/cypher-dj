// Strand 7 task 1.1: the MIDI stage engine (cdj::MidiStufe, midi_stufe.h) against a recording sink, without the Arrangement.
// Grid: 1/16 at 128 BPM and 48 kHz = 5625 samples per step. Cases:
//   A  up, chord 60 64 67 from beat 0 for 4 beats, one run with all 16 grid points: 16 ONs in order 60 64 67 60 ..., offs at gate 0.5
//   A2 the same block by block (256) after a pre-roll of grid points: same ONs and offs; without pre-roll the first off waits for the next point
//   B  updown with 1 and 3 notes, downup
//   C  played order with 2 octaves
//   D  random: reproducible for one seed, another seed differs
//   E  chord pattern with 2 octaves
//   F  D5: ON 100 samples after a grid point starts at once, 2000 after waits for the next point
//   G  OFF of an unheld pitch passes through to its sink
//   H  queue overflow: verloren counts the lost ON, an OFF is still delivered
//   I  tausch with a changed rate: sounding outputs off at s, no hanging note
//   J  free mode 8 Hz: steps every 6000 samples from the first ON
//   K  two sinks: every OFF reaches the sink of its ON
//   L  pass-through, alle_aus, tausch to pass-through, ruhig
//   N  chord [4, 7] on 60 -> 60 64 67, clipping at 0 and 127
//   O  scale A minor: 61 -> 60, 66 -> 65 (ties down); two inputs on one output share it
//   P  chord + scale on 62 in A minor -> 62 65 69; collapsing pitches are deduplicated
//   Q  overlapping chords sharing 67: no early OFF
//   R  velocity fest 100; kurve +1 on 64 -> 107, -1 -> 8
//   S  velocity zufall within bounds, reproducible, another seed differs
//   T  chance 0 / 100 / 50 (reproducible, a chord sounds as a whole, no OFF for a skipped ON)
//   U  the whole chain with arp: chance per step, the pattern counts over skipped steps
//   V  the first step after a rate change has the gate of the new rate
//   M  no allocation, lock or sleep in 4000 runs, arp and the whole chain (positive control: the counter sees one)
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "cypherdj/arrangement.h"
#include "cypherdj/midi_stufe.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

namespace {

constexpr int64_t L = 5625;   // 1/16 at 128 BPM

struct Ev {
  int senke;
  int spur;
  int64_t ziel;
  int ton, vel;
  bool an;
};

std::vector<Ev> alle;   // every event of every sink, in send order

struct Senke : cdj::ArrSenke {
  int nr;
  explicit Senke(int n) : nr(n) {}
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override { alle.push_back({nr, spur, ziel, ton, vel, an}); }
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
};

std::vector<Ev> ons() {
  std::vector<Ev> o;
  for (const Ev& e : alle)
    if (e.an) o.push_back(e);
  return o;
}
std::vector<Ev> offs() {
  std::vector<Ev> o;
  for (const Ev& e : alle)
    if (!e.an) o.push_back(e);
  return o;
}

// per sink: samples never go back, no ON of a sounding pitch, no OFF of a silent one, nothing sounds at the end
bool paare_ok(bool am_ende_still = true) {
  bool ok = true;
  for (int s = 0; s < 3; ++s) {
    bool klingt[128] = {};
    int64_t letzt = INT64_MIN;
    for (const Ev& e : alle) {
      if (e.senke != s) continue;
      if (e.ziel < letzt) {
        std::fprintf(stderr, "sink %d: sample goes back %lld < %lld\n", s, (long long)e.ziel, (long long)letzt);
        ok = false;
      }
      letzt = e.ziel;
      if (e.an && klingt[e.ton]) {
        std::fprintf(stderr, "sink %d: ON %d at %lld while sounding\n", s, e.ton, (long long)e.ziel);
        ok = false;
      }
      if (!e.an && !klingt[e.ton]) {
        std::fprintf(stderr, "sink %d: OFF %d at %lld while silent\n", s, e.ton, (long long)e.ziel);
        ok = false;
      }
      klingt[e.ton] = e.an;
    }
    if (am_ende_still)
      for (int t = 0; t < 128; ++t)
        if (klingt[t]) {
          std::fprintf(stderr, "sink %d: %d still sounds\n", s, t);
          ok = false;
        }
  }
  return ok;
}

cdj::ArrMidiParam arp(cdj::ArpMuster m, int okt = 1, float gate = 0.5f) {
  cdj::ArrMidiParam p;
  p.an = true;
  p.arp = true;
  p.muster = m;
  p.oktaven = static_cast<uint8_t>(okt);
  p.gate = gate;
  return p;
}

// runs the stage block by block over [von, bis) with the grid points k * schritt (k >= 0, nr = k + nr0) of each block
void laufe(cdj::MidiStufe& st, const cdj::ArrMidiParam& p, int64_t von, int64_t bis, int64_t schritt = L, int64_t raster0 = 0, uint64_t nr0 = 0,
           int block = 256) {
  for (int64_t s0 = von; s0 < bis; s0 += block) {
    const int64_t e = s0 + block;
    cdj::MidiRaster r;
    for (int64_t k = (s0 - raster0 + schritt - 1) / schritt; raster0 + k * schritt < e; ++k) {
      if (raster0 + k * schritt < s0) continue;
      r.s[r.n] = raster0 + k * schritt;
      r.nr[r.n] = nr0 + static_cast<uint64_t>(k);
      ++r.n;
    }
    st.lauf(p, r, e);
  }
}

void akkord_an(cdj::MidiStufe& st, cdj::ArrSenke* se, int64_t an, int64_t aus, std::initializer_list<int> toene) {
  uint64_t k = 1;
  for (int t : toene) st.ein(se, an, static_cast<uint8_t>(t), 100, true, k++);
  for (int t : toene) st.ein(se, aus, static_cast<uint8_t>(t), 0, false, k++);
}

std::vector<int> toene(const std::vector<Ev>& v) {
  std::vector<int> o;
  for (const Ev& e : v) o.push_back(e.ton);
  return o;
}

}  // namespace

int main() {
  alle.reserve(1 << 16);
  Senke a(0), b(1);

  {  // A: one run, all 16 grid points
    alle.clear();
    cdj::MidiStufe st;
    st.setze_spur(3);
    akkord_an(st, &a, 0, 16 * L, {60, 64, 67});
    cdj::MidiRaster r;
    for (int k = 0; k < 16; ++k) {
      r.s[k] = k * L;
      r.nr[k] = static_cast<uint64_t>(k);
    }
    r.n = 16;
    st.lauf(arp(cdj::ArpMuster::up), r, 16 * L + 1);
    const auto on = ons(), of = offs();
    PRUEF(on.size() == 16);
    PRUEF(of.size() == 16);
    const int soll[3] = {60, 64, 67};
    for (size_t i = 0; i < on.size() && i < 16; ++i) {
      PRUEF(on[i].ziel == static_cast<int64_t>(i) * L);
      PRUEF(on[i].ton == soll[i % 3]);
      PRUEF(on[i].vel == 100);
      PRUEF(on[i].spur == 3);
    }
    for (size_t i = 0; i < of.size() && i < 16; ++i) PRUEF(of[i].ziel == static_cast<int64_t>(i) * L + 2813);   // round(0.5 * 5625)
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
    PRUEF(st.ein_noten() == 3);
    PRUEF(st.aus_noten() == 16);
    std::printf("A: %zu ONs, %zu OFFs, first off %lld\n", on.size(), of.size(), of.empty() ? -1LL : (long long)of[0].ziel);
  }

  {  // A2: block by block after a pre-roll (the stage saw the grid before the chord), and without pre-roll
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 20 * L, {60, 64, 67});
    laufe(st, arp(cdj::ArpMuster::up), 0, 22 * L);
    const auto on = ons(), of = offs();
    PRUEF(on.size() == 16);
    PRUEF(of.size() == 16);
    for (size_t i = 0; i < on.size() && i < 16; ++i) {
      PRUEF(on[i].ziel == static_cast<int64_t>(i + 4) * L);
      PRUEF(of[i].ziel == static_cast<int64_t>(i + 4) * L + 2813);
    }
    PRUEF(paare_ok());

    alle.clear();
    cdj::MidiStufe st2;
    akkord_an(st2, &a, 0, 16 * L, {60, 64, 67});
    laufe(st2, arp(cdj::ArpMuster::up), 0, 18 * L);
    const auto of2 = offs();
    PRUEF(ons().size() == 16);
    PRUEF(of2.size() == 16 && of2[0].ziel == L);           // step length unknown at the first grid point: off at the next one
    PRUEF(of2.size() == 16 && of2[1].ziel == L + 2813);    // from then on the gate
    PRUEF(paare_ok());
    std::printf("A2: pre-roll first off %lld, cold first off %lld\n", of.empty() ? -1LL : (long long)of[0].ziel,
                of2.empty() ? -1LL : (long long)of2[0].ziel);
  }

  {  // B: updown with 1 and 3 notes, downup
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 12 * L, {60});
    laufe(st, arp(cdj::ArpMuster::updown), 0, 14 * L);
    PRUEF((toene(ons()) == std::vector<int>(8, 60)));
    PRUEF(paare_ok());

    alle.clear();
    cdj::MidiStufe st3;
    akkord_an(st3, &a, 4 * L, 12 * L, {64, 60, 67});
    laufe(st3, arp(cdj::ArpMuster::updown), 0, 14 * L);
    PRUEF((toene(ons()) == std::vector<int>{60, 64, 67, 64, 60, 64, 67, 64}));
    PRUEF(paare_ok());

    alle.clear();
    cdj::MidiStufe st4;
    akkord_an(st4, &a, 4 * L, 12 * L, {64, 60, 67});
    laufe(st4, arp(cdj::ArpMuster::downup), 0, 14 * L);
    PRUEF((toene(ons()) == std::vector<int>{67, 64, 60, 64, 67, 64, 60, 64}));
    PRUEF(paare_ok());

    alle.clear();
    cdj::MidiStufe st5;
    akkord_an(st5, &a, 4 * L, 8 * L, {64, 60, 67});
    laufe(st5, arp(cdj::ArpMuster::down), 0, 10 * L);
    PRUEF((toene(ons()) == std::vector<int>{67, 64, 60, 67}));
    PRUEF(paare_ok());
  }

  {  // C: played order (arrival order at the same sample), 2 octaves appended in that order
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 11 * L, {67, 60, 64});
    laufe(st, arp(cdj::ArpMuster::played, 2), 0, 13 * L);
    PRUEF((toene(ons()) == std::vector<int>{67, 60, 64, 79, 72, 76, 67}));
    PRUEF(paare_ok());
  }

  {  // D: random
    auto zufallsfolge = [&a](uint32_t saat) {
      alle.clear();
      cdj::MidiStufe st;
      st.setze_spur(2);
      akkord_an(st, &a, 4 * L, 36 * L, {60, 62, 64, 65, 67});
      cdj::ArrMidiParam p = arp(cdj::ArpMuster::random, 2);
      p.saat = saat;
      laufe(st, p, 0, 38 * L);
      PRUEF(paare_ok());
      return toene(ons());
    };
    const auto f1 = zufallsfolge(1), f1b = zufallsfolge(1), f2 = zufallsfolge(2);
    PRUEF(f1.size() == 32);
    PRUEF(f1 == f1b);
    PRUEF(f1 != f2);
    bool alle_gleich = true;
    for (int t : f1) alle_gleich = alle_gleich && t == f1[0];
    PRUEF(!alle_gleich);
    for (int t : f1) PRUEF(t == 60 || t == 62 || t == 64 || t == 65 || t == 67 || t == 72 || t == 74 || t == 76 || t == 77 || t == 79);
    std::printf("D: seed 1 starts %d %d %d %d, seed 2 starts %d %d %d %d\n", f1[0], f1[1], f1[2], f1[3], f2[0], f2[1], f2[2], f2[3]);
  }

  {  // E: chord pattern, 2 octaves: every step all 6 pitches at the step sample
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 8 * L, {60, 64, 67});
    laufe(st, arp(cdj::ArpMuster::chord, 2), 0, 10 * L);
    const auto on = ons();
    PRUEF(on.size() == 24);
    for (size_t i = 0; i < on.size(); ++i) {
      PRUEF(on[i].ziel == static_cast<int64_t>(4 + i / 6) * L);
      const int soll[6] = {60, 64, 67, 72, 76, 79};
      PRUEF(on[i].ton == soll[i % 6]);
    }
    PRUEF(paare_ok());
  }

  {  // F: D5, immediate start up to 1/8 step after a grid point
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L + 100, 6 * L, {60});
    laufe(st, arp(cdj::ArpMuster::up), 0, 8 * L);
    auto on = ons();
    PRUEF(on.size() == 2 && on[0].ziel == 4 * L + 100 && on[1].ziel == 5 * L);   // the step at 4L is used by the early key
    PRUEF(paare_ok());

    alle.clear();
    cdj::MidiStufe st2;
    akkord_an(st2, &a, 4 * L + 2000, 7 * L, {60});
    laufe(st2, arp(cdj::ArpMuster::up), 0, 9 * L);
    on = ons();
    PRUEF(on.size() == 2 && on[0].ziel == 5 * L && on[1].ziel == 6 * L);
    PRUEF(paare_ok());
    std::printf("F: +100 starts at %lld, +2000 starts at %lld\n", (long long)(4 * L + 100), on.empty() ? -1LL : (long long)on[0].ziel);
  }

  {  // G: OFF of an unheld pitch passes through to its sink (with arp and without)
    alle.clear();
    cdj::MidiStufe st;
    st.setze_spur(5);
    st.ein(&b, 1000, 50, 0, false, 9);
    laufe(st, arp(cdj::ArpMuster::up), 0, 2048);
    PRUEF(alle.size() == 1 && alle[0].senke == 1 && alle[0].ton == 50 && !alle[0].an && alle[0].ziel == 1000 && alle[0].spur == 5);
    alle.clear();
    st.ein(&a, 3000, 51, 0, false, 10);
    cdj::ArrMidiParam durch;
    durch.an = true;
    laufe(st, durch, 2048, 4096);
    PRUEF(alle.size() == 1 && alle[0].senke == 0 && alle[0].ton == 51 && !alle[0].an && alle[0].ziel == 3000);
  }

  {  // H: queue overflow
    alle.clear();
    cdj::MidiStufe st;
    cdj::ArrMidiParam durch;
    durch.an = true;
    st.ein(&a, 0, 60, 90, true, 1);
    laufe(st, durch, 0, 256);
    PRUEF(alle.size() == 1);
    for (int i = 0; i < cdj::MIDI_EIN_MAX; ++i) st.ein(&a, 1000, static_cast<uint8_t>(61 + i), 90, true, 100 + i);
    PRUEF(st.verloren() == 0);
    st.ein(&a, 1000, 125, 90, true, 999);   // no room: lost
    PRUEF(st.verloren() == 1);
    st.ein(&a, 900, 60, 0, false, 1000);     // no room: applied at once
    PRUEF(alle.size() == 2 && !alle[1].an && alle[1].ton == 60 && alle[1].ziel == 900);
    laufe(st, durch, 256, 2048);
    PRUEF(ons().size() == 65);
    PRUEF(st.verloren() == 1 + (cdj::MIDI_EIN_MAX - cdj::MIDI_GEHALTEN_MAX));   // pass-through still sends ONs beyond the held set, counted in verloren
    PRUEF(st.gehalten() == cdj::MIDI_GEHALTEN_MAX);
    bool ohne125 = true;
    for (const Ev& e : alle) ohne125 = ohne125 && e.ton != 125;
    PRUEF(ohne125);
    PRUEF(paare_ok(false));
    std::printf("H: verloren %llu, events %zu\n", (unsigned long long)st.verloren(), alle.size());
  }

  {  // I: tausch with a changed rate while an output sounds
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 16 * L, {60, 64, 67});
    const cdj::ArrMidiParam p1 = arp(cdj::ArpMuster::up);
    cdj::ArrMidiParam p2 = p1;
    p2.rate_beats = 0.125;
    PRUEF(cdj::gleich(p1, p1));
    PRUEF(!cdj::gleich(p1, p2));
    laufe(st, p1, 0, 6 * L + 1024);   // steps at 4L, 5L, 6L; the one at 6L sounds until 6L + 2813
    const size_t vorher = alle.size();
    const int64_t s = 6 * L + 1024;
    st.tausch(p1, s);                 // equal: nothing
    PRUEF(alle.size() == vorher);
    st.tausch(p2, s);
    PRUEF(alle.size() == vorher + 1 && !alle.back().an && alle.back().ton == 67 && alle.back().ziel == s);
    laufe(st, p2, s, 20 * L, L / 2, 0, 0);   // the new grid: 1/32
    const auto on = ons();
    PRUEF(on.size() > 3 && on[3].ziel == 13 * (L / 2) && on[3].ton == 60);   // pattern index reset, first step at the next grid point after s
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
  }

  {  // J: free mode 8 Hz from the first ON
    alle.clear();
    cdj::MidiStufe st;
    cdj::ArrMidiParam p = arp(cdj::ArpMuster::up);
    p.sync = false;
    p.rate_hz = 8.0;
    akkord_an(st, &a, 1234, 1234 + 5 * 6000, {60, 64});
    laufe(st, p, 0, 50000);   // grid points are handed in and ignored
    const auto on = ons(), of = offs();
    PRUEF(on.size() == 5);
    for (size_t i = 0; i < on.size(); ++i) {
      PRUEF(on[i].ziel == 1234 + static_cast<int64_t>(i) * 6000);
      PRUEF(on[i].ton == (i % 2 ? 64 : 60));
      PRUEF(of[i].ziel == 1234 + static_cast<int64_t>(i) * 6000 + 3000);
    }
    PRUEF(paare_ok());
  }

  {  // K: two sinks; a pitch handed from sink A to sink B keeps its OFF routing
    alle.clear();
    cdj::MidiStufe st;
    st.ein(&a, 4 * L, 60, 80, true, 1);
    st.ein(&b, 4 * L, 64, 90, true, 2);
    st.ein(&a, 8 * L, 60, 0, false, 3);
    st.ein(&b, 8 * L, 64, 0, false, 4);
    laufe(st, arp(cdj::ArpMuster::up, 1, 1.0f), 0, 10 * L);
    const auto on = ons();
    PRUEF(on.size() == 4);
    for (size_t i = 0; i < on.size(); ++i) {
      PRUEF(on[i].senke == static_cast<int>(i % 2));
      PRUEF(on[i].vel == (i % 2 ? 90 : 80));
    }
    PRUEF(paare_ok());
    // the same pitch from sink B while sink A's 60 still sounds (gate 1): A gets its OFF, then B its ON
    alle.clear();
    cdj::MidiStufe st2;
    st2.ein(&a, 4 * L, 60, 80, true, 1);
    st2.ein(&a, 4 * L + 10, 60, 0, false, 2);
    st2.ein(&b, 5 * L, 60, 70, true, 3);
    st2.ein(&b, 6 * L, 60, 0, false, 4);
    laufe(st2, arp(cdj::ArpMuster::up, 1, 1.0f), 0, 8 * L);
    PRUEF(alle.size() == 4);
    PRUEF(alle.size() == 4 && alle[0].senke == 0 && alle[0].an && alle[1].senke == 0 && !alle[1].an && alle[1].ziel == 5 * L);
    PRUEF(alle.size() == 4 && alle[2].senke == 1 && alle[2].an && alle[3].senke == 1 && !alle[3].an);
    PRUEF(paare_ok());
  }

  {  // L: pass-through, alle_aus, tausch to pass-through, ruhig
    alle.clear();
    cdj::MidiStufe st;
    cdj::ArrMidiParam durch;
    durch.an = true;
    st.ein(&a, 100, 60, 77, true, 1);
    st.ein(&a, 300, 60, 0, false, 2);
    st.ein(&b, 200, 62, 66, true, 3);
    PRUEF(!st.ruhig());
    laufe(st, durch, 0, 512);
    PRUEF(alle.size() == 3);
    PRUEF(alle.size() == 3 && alle[0].ziel == 100 && alle[0].vel == 77 && alle[1].ziel == 200 && alle[1].senke == 1 && alle[2].ziel == 300 && !alle[2].an);
    PRUEF(st.gehalten() == 1);
    st.alle_aus(600);
    PRUEF(alle.size() == 4 && alle[3].ton == 62 && alle[3].senke == 1 && !alle[3].an && alle[3].ziel == 600);
    PRUEF(st.ruhig());

    alle.clear();   // alle_aus before a sent future ON: the OFF is not before its ON
    st.ein(&a, 1000, 61, 50, true, 4);
    laufe(st, durch, 512, 1024 + 256);
    st.alle_aus(900);
    PRUEF(alle.size() == 2 && alle[1].ziel == 1000 && !alle[1].an);

    alle.clear();   // arp running, tausch to pass-through: arp output off at s, held input sounds again at s
    cdj::MidiStufe st2;
    st2.ein(&a, 4 * L, 60, 88, true, 1);
    st2.ein(&a, 4 * L, 67, 99, true, 2);
    laufe(st2, arp(cdj::ArpMuster::up, 1, 1.0f), 0, 5 * L + 100);
    const int64_t s = 5 * L + 100;
    st2.tausch(durch, s);
    const auto& e = alle;
    PRUEF(e.size() == 6);
    PRUEF(e.size() == 6 && !e[3].an && e[3].ton == 67 && e[3].ziel == s);
    PRUEF(e.size() == 6 && e[4].an && e[4].ton == 60 && e[4].ziel == s && e[4].vel == 88);
    PRUEF(e.size() == 6 && e[5].an && e[5].ton == 67 && e[5].ziel == s && e[5].vel == 99);
    st2.ein(&a, 6 * L, 60, 0, false, 3);
    st2.ein(&a, 6 * L, 67, 0, false, 4);
    laufe(st2, durch, s, 7 * L);
    PRUEF(paare_ok());
    PRUEF(st2.ruhig());
  }

  // ---- strand 7 task 3.1: chord, scale, velocity and chance (chain order Chord -> Scale -> Arp -> Velocity -> Chance) ----
  constexpr uint16_t A_MOLL = (1 << 9) | (1 << 11) | (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7);   // A B C D E F G = 2741
  auto durch = [](std::initializer_list<int> akk = {}, uint16_t maske = 0) {
    cdj::ArrMidiParam p;
    p.an = true;
    for (int i : akk) p.akkord[p.akkord_n++] = static_cast<int8_t>(i);
    p.skala_maske = maske;
    return p;
  };
  // one input ON at 100 and its OFF at 300 through p: the ONs sent
  auto eins = [&](const cdj::ArrMidiParam& p, int ton, int vel = 100, uint64_t schl = 1) {
    alle.clear();
    cdj::MidiStufe st;
    st.ein(&a, 100, static_cast<uint8_t>(ton), static_cast<uint8_t>(vel), true, schl);
    st.ein(&a, 300, static_cast<uint8_t>(ton), 0, false, schl + 1);
    laufe(st, p, 0, 512);
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
    return ons();
  };

  {  // N: chord [4, 7] on 60 -> 60 64 67, all at the input's sample; its OFF ends exactly those
    const auto on = eins(durch({4, 7}), 60);
    PRUEF(toene(on) == (std::vector<int>{60, 64, 67}));
    for (const Ev& e : on) PRUEF(e.ziel == 100 && e.vel == 100);
    const auto of = offs();
    PRUEF(of.size() == 3);
    for (const Ev& e : of) PRUEF(e.ziel == 300);
    // clipped: 120 with +12 drops the 132, -24 on 10 drops the -14
    PRUEF(toene(eins(durch({12}), 120)) == (std::vector<int>{120}));
    PRUEF(toene(eins(durch({-24, 7}), 10)) == (std::vector<int>{10, 17}));
  }

  {  // O: scale A minor: 61 -> 60 (tie down), 66 -> 65 (tie down), 60 stays, 70 -> 69 (tie down), 127 (G) stays
    PRUEF(toene(eins(durch({}, A_MOLL), 61)) == (std::vector<int>{60}));
    PRUEF(toene(eins(durch({}, A_MOLL), 66)) == (std::vector<int>{65}));
    PRUEF(toene(eins(durch({}, A_MOLL), 60)) == (std::vector<int>{60}));
    PRUEF(toene(eins(durch({}, A_MOLL), 70)) == (std::vector<int>{69}));
    PRUEF(toene(eins(durch({}, 1 << 1), 0)) == (std::vector<int>{1}));     // only C#: 0 has nothing below, goes up
    PRUEF(toene(eins(durch({}, 1 << 0), 127)) == (std::vector<int>{120}));  // only C: 127 (G) -> 120, 132 is outside
    // two inputs that snap to the same pitch share it: 61 and 62 both -> 60, 62; 61 snaps to 60 and 60 again: one ON, OFF with the last
    alle.clear();
    cdj::MidiStufe st;
    st.ein(&a, 100, 60, 90, true, 1);
    st.ein(&a, 200, 61, 80, true, 2);   // also 60: OFF then ON at 200
    st.ein(&a, 300, 60, 0, false, 3);   // 60 still held by 61: no OFF
    st.ein(&a, 400, 61, 0, false, 4);
    laufe(st, durch({}, A_MOLL), 0, 512);
    PRUEF(alle.size() == 4);
    PRUEF(alle.size() == 4 && alle[1].ziel == 200 && !alle[1].an && alle[2].ziel == 200 && alle[2].an && alle[2].vel == 80);
    PRUEF(alle.size() == 4 && alle[3].ziel == 400 && !alle[3].an && alle[3].ton == 60);
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
  }

  {  // P: chord + scale on D (62) in A minor: 62 66 69 -> 62 65 69 (the chord first, then the scale)
    PRUEF(toene(eins(durch({4, 7}, A_MOLL), 62)) == (std::vector<int>{62, 65, 69}));
    // chord + scale that collapse: [1, 2] on 60 in A minor -> 60 60 62 -> 60 62 (deduplicated)
    PRUEF(toene(eins(durch({1, 2}, A_MOLL), 60)) == (std::vector<int>{60, 62}));
  }

  {  // Q: overlapping chords sharing 67: 60 (60 64 67) from 100 to 300, 63 (63 67 70) from 200 to 400: 67 is not ended at 300
    alle.clear();
    cdj::MidiStufe st;
    st.ein(&a, 100, 60, 100, true, 1);
    st.ein(&a, 200, 63, 100, true, 2);
    st.ein(&a, 300, 60, 0, false, 3);
    st.ein(&a, 400, 63, 0, false, 4);
    laufe(st, durch({4, 7}), 0, 512);
    int64_t aus67 = -1;
    int aus67_n = 0;
    for (const Ev& e : alle)
      if (!e.an && e.ton == 67 && e.ziel > 200) {
        aus67 = e.ziel;
        ++aus67_n;
      }
    PRUEF(aus67 == 400 && aus67_n == 1);
    int bei300 = 0;
    for (const Ev& e : alle) bei300 += !e.an && e.ziel == 300;
    PRUEF(bei300 == 2);   // 60 and 64
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
  }

  {  // R: velocity fest 100; kurve +1 on 64 -> 107 (exponent 0.25), -1 -> 8 (exponent 4), 0 -> unchanged; clipped to 1..127
    cdj::ArrMidiParam p = durch({4});
    p.vel = true;
    p.vel_fest = 100;
    for (const Ev& e : eins(p, 60, 30)) PRUEF(e.vel == 100);
    p.vel_fest = 0;
    p.vel_kurve = 1.0f;
    PRUEF(eins(p, 60, 64).front().vel == 107);
    p.vel_kurve = -1.0f;
    PRUEF(eins(p, 60, 64).front().vel == 8);
    PRUEF(eins(p, 60, 1).front().vel == 1);
    p.vel_kurve = 0.0f;
    PRUEF(eins(p, 60, 64).front().vel == 64);
    p.vel = false;   // stage off: fest is ignored
    p.vel_fest = 100;
    PRUEF(eins(p, 60, 64).front().vel == 64);
  }

  // many inputs, one per key, without arp: the ONs
  auto viele = [&](const cdj::ArrMidiParam& p, int n = 200) {
    alle.clear();
    cdj::MidiStufe st;
    st.setze_spur(2);
    for (int i = 0; i < n; ++i) {
      st.ein(&a, i * 100, 60, 64, true, 1000 + 2 * i);
      st.ein(&a, i * 100 + 50, 60, 0, false, 1001 + 2 * i);
      laufe(st, p, i * 100, i * 100 + 100, L, 0, 0, 100);
    }
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
    return ons();
  };

  {  // S: velocity zufall 10: every ON within 54..74, not all equal, reproducible; another seed differs
    cdj::ArrMidiParam p = durch();
    p.vel = true;
    p.vel_zufall = 10;
    p.saat = 7;
    const auto v1 = viele(p), v2 = viele(p);
    PRUEF(v1.size() == 200);
    int lo = 127, hi = 0;
    bool gleich_alle = true;
    for (size_t i = 0; i < v1.size(); ++i) {
      lo = std::min(lo, v1[i].vel);
      hi = std::max(hi, v1[i].vel);
      gleich_alle &= i < v2.size() && v1[i].vel == v2[i].vel;
    }
    PRUEF(lo >= 54 && hi <= 74 && lo < hi);
    PRUEF(lo == 54 && hi == 74);   // 200 draws hit both ends
    PRUEF(gleich_alle);
    p.saat = 8;
    const auto v3 = viele(p);
    int anders = 0;
    for (size_t i = 0; i < v1.size() && i < v3.size(); ++i) anders += v1[i].vel != v3[i].vel;
    PRUEF(anders > 100);
    std::printf("S: velocity %d..%d, %d of 200 differ for another seed\n", lo, hi, anders);
  }

  {  // T: chance 0 -> nothing (no OFF either), 100 -> all, 50 -> a reproducible set; a chord's outputs go together
    cdj::ArrMidiParam p = durch({4, 7});
    p.chance = 0;
    PRUEF(viele(p).empty() && alle.empty());
    p.chance = 100;
    PRUEF(viele(p).size() == 600);
    p.chance = 50;
    const auto c1 = viele(p);
    const size_t n_aus = offs().size();
    const auto c2 = viele(p);
    PRUEF(c1.size() % 3 == 0 && c1.size() > 150 && c1.size() < 450);
    PRUEF(n_aus == c1.size());   // a skipped ON makes no OFF
    bool gleich_alle = c1.size() == c2.size();
    for (size_t i = 0; gleich_alle && i < c1.size(); ++i) gleich_alle = c1[i].ziel == c2[i].ziel && c1[i].ton == c2[i].ton;
    PRUEF(gleich_alle);
    for (size_t i = 0; i + 2 < c1.size(); i += 3) PRUEF(c1[i].ziel == c1[i + 2].ziel && c1[i].ton == 60 && c1[i + 2].ton == 67);
    p.saat = 99;
    const auto c3 = viele(p);
    bool gleich3 = c1.size() == c3.size();
    for (size_t i = 0; gleich3 && i < c1.size(); ++i) gleich3 = c1[i].ziel == c3[i].ziel;
    PRUEF(!gleich3);
    std::printf("T: chance 50 -> %zu of 200 inputs sound\n", c1.size() / 3);
  }

  {  // U: chord + scale + arp + velocity + chance per arp step: a held 62, chord [4, 7] in A minor -> list 62 65 69;
     //    chance 50 per step, the pattern keeps counting over skipped steps; fest 90 on every step
    cdj::ArrMidiParam p = arp(cdj::ArpMuster::up);
    p.akkord_n = 2;
    p.akkord[0] = 4;
    p.akkord[1] = 7;
    p.skala_maske = A_MOLL;
    p.vel = true;
    p.vel_fest = 90;
    auto lauf_u = [&](const cdj::ArrMidiParam& q) {
      alle.clear();
      cdj::MidiStufe st;
      st.ein(&a, 0, 62, 100, true, 1);
      st.ein(&a, 48 * L, 62, 0, false, 2);
      laufe(st, q, 0, 50 * L);
      PRUEF(paare_ok());
      PRUEF(st.ruhig());
      return ons();
    };
    const auto voll = lauf_u(p);
    PRUEF(voll.size() == 48);
    const int soll[3] = {62, 65, 69};
    for (size_t i = 0; i < voll.size(); ++i) PRUEF(voll[i].ton == soll[i % 3] && voll[i].vel == 90 && voll[i].ziel == static_cast<int64_t>(i) * L);
    p.chance = 50;
    const auto halb = lauf_u(p), halb2 = lauf_u(p);
    PRUEF(halb.size() > 8 && halb.size() < 40);
    PRUEF(halb.size() == halb2.size());
    for (size_t i = 0; i < halb.size(); ++i) {
      const int64_t k = halb[i].ziel / L;
      PRUEF(halb[i].ziel == k * L && halb[i].ton == soll[k % 3]);   // the step that sounds plays its own pattern position
      PRUEF(i >= halb2.size() || halb2[i].ziel == halb[i].ziel);
    }
    std::printf("U: chance 50 per step -> %zu of 48 steps\n", halb.size());
    // chord pattern with chance: a step sounds as a whole or not at all
    p.muster = cdj::ArpMuster::chord;
    const auto akk = lauf_u(p);
    PRUEF(akk.size() % 3 == 0 && akk.size() > 0 && akk.size() < 144);
  }

  {  // V: the first step after a rate change has the gate of the new rate (1/16 -> 1/8 at 6L + 1024: next step 8L, off at 8L + 5625)
    alle.clear();
    cdj::MidiStufe st;
    akkord_an(st, &a, 4 * L, 16 * L, {60, 64, 67});
    const cdj::ArrMidiParam p1 = arp(cdj::ArpMuster::up);
    cdj::ArrMidiParam p2 = p1;
    p2.rate_beats = 0.5;
    laufe(st, p1, 0, 6 * L + 1024);
    const int64_t s = 6 * L + 1024;
    st.tausch(p2, s);
    const size_t vorher = alle.size();
    laufe(st, p2, s, 20 * L, 2 * L, 0, 0);
    PRUEF(alle.size() > vorher + 1);
    PRUEF(alle.size() > vorher + 1 && alle[vorher].an && alle[vorher].ziel == 8 * L);
    PRUEF(alle.size() > vorher + 1 && !alle[vorher + 1].an && alle[vorher + 1].ziel == 8 * L + L);
    PRUEF(paare_ok());
    PRUEF(st.ruhig());
  }

  {  // M: no allocation, lock or sleep in the runs
    alle.clear();
    cdj::MidiStufe st;
    const cdj::ArrMidiParam p = arp(cdj::ArpMuster::updown, 3);
    cdj::ArrMidiParam kette = arp(cdj::ArpMuster::random, 2);   // the whole chain with arp, and without (task 3.1)
    kette.akkord_n = 3;
    kette.akkord[0] = 4;
    kette.akkord[1] = 7;
    kette.akkord[2] = -12;
    kette.skala_maske = A_MOLL;
    kette.vel = true;
    kette.vel_kurve = 0.5f;
    kette.vel_zufall = 20;
    kette.chance = 70;
    cdj::ArrMidiParam kette_durch = kette;
    kette_durch.arp = false;
    const cdj::ArrMidiParam* folge[3] = {&p, &kette, &kette_durch};
    laufe(st, p, 0, 4 * L);
    AbfangZahlen z;
    abfang_an();
    for (int k = 0; k < 40; ++k) {
      const int64_t von = (4 + 8 * k) * L;
      for (int t = 0; t < 8; ++t) st.ein(&a, von + t * 37, static_cast<uint8_t>(48 + t * 3), 100, true, k * 16 + t);
      for (int t = 0; t < 8; ++t) st.ein(t % 2 ? &a : &b, von + 6 * L + t, static_cast<uint8_t>(48 + t * 3), 0, false, k * 16 + 8 + t);
      laufe(st, *folge[k % 3], von, von + 8 * L);
      st.tausch(*folge[(k + 1) % 3], von + 8 * L);
    }
    st.alle_aus(400 * L);
    abfang_aus();
    z = abfang_zahlen();
    std::printf("M: %zu events, allocations %ld, frees %ld, locks %ld, sleeps %ld\n", alle.size(), z.alloc, z.frei, z.sperren, z.schlafen);
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(z.summe() == 0);
    PRUEF(alle.size() > 500 && alle.size() < (1u << 16));   // inside the reserve: the recording sink does not allocate
    abfang_an();
    { std::vector<int> v(100); }
    const long positiv = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);   // positive control: the watcher counts
  }

  PRUEF_ENDE();
}
