// 1.12 Automation slice 3, task 2 (D1, D5, D6, D7): the lane override in the Arrangement. A grip on spur/n/{fader,pan,mute,solo} (here: auto_uebersteuern, the call the core
// makes after the Stellwerk cycle) lets the hand course play instead of the lane, from the grip sample on. The Stellwerk course is emulated with Arrangement::verlauf.
// Measured on the audio of a constant clip (0.5, centre pan -3 dB) where the gain can be computed back, and on the lane buffers auto_buf_ for pan, mute and solo.
//   (a) fader grip in the middle of a block, lane 0 -> -30 dB: the lane plays up to the grip sample, from there the 480 blend (linear in the gain) to the hand value, then the hand value
//   (b) re-enable in the middle of a block: blend back to the lane within 480 samples, then exactly the lane (reference run without a grip)
//   (c) the override survives stop and start and a snapshot swap that keeps the lane; deleting the lane clears it and reports zustand 0, also while stopped; a later lane starts free
//   (d) while the transport does not play (D5) nothing changes: no override, no event
//   (e) auto_letzter_wert is the last lane value and stays so while the hand plays
//   (f) pan blends linearly in the pan value (D7), mute and solo jump (no blend of their own, the mixer fade applies)
//   (d2) re-enable of one field while stopped works (D6), starting an override while stopped does not (D5)
// Mutations (WILL_FAIL): ARR_AUTO_FREIGABE_IM_STOPP (d2), ARR_AUTO_UEBER_OHNE_BLENDE (a), ARR_AUTO_UEBER_TAUSCH_LOESCHT (c), ARR_AUTO_UEBER_IM_STOPP (d).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

namespace cdj {
struct ArrPruefZugang {
  static const float* buf(const Arrangement& a, int i, int f) { return a.auto_buf_[i][f]; }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoEreignis;
using cdj::ArrAutoPunkt;
using Z = cdj::ArrPruefZugang;

namespace {
constexpr int64_t V = 537;
constexpr double MITTE = 0.70710677;
constexpr double SPB120 = 24000.0;   // samples per beat at 120 BPM
constexpr float H = -20.0f;       // the hand value of the fader

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }
double db_von(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }

// A track with a constant clip and up to four lanes (fader, pan, mute, solo); an empty vector means no lane for that field.
struct Lanes {
  std::vector<ArrAutoPunkt> f, p, m, s;
};
cdj::ArrSnapshot* snap(Audio& au, int64_t nr, const Lanes& l) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au.a);
  if (!l.f.empty()) b.lane(1, l.f, cdj::ARR_AUTO_FADER);
  if (!l.p.empty()) b.lane(1, l.p, cdj::ARR_AUTO_PAN);
  if (!l.m.empty()) b.lane(1, l.m, cdj::ARR_AUTO_MUTE);
  if (!l.s.empty()) b.lane(1, l.s, cdj::ARR_AUTO_SOLO);
  return b.fertig();
}

struct Szene {
  std::unique_ptr<Audio> au = Audio::gleich(1200000);
  Treiber t;
  float hand[4][cdj::ARR_BLOCK];   // one course buffer per field (the Arrangement keeps the pointer for the block)
  int r[4];
  std::vector<float> buf[4];            // auto_buf_ of track 0, per field, index = core sample
  std::vector<ArrAutoEreignis> ev;      // drained after every block
  explicit Szene(const Lanes& l) {
    t.k = cdj::Karte(120.0, 0);
    t.laden(snap(*au, 1, l));
    r[0] = t.tab.suche("spur/1/fader");
    r[1] = t.tab.suche("spur/1/pan");
    r[2] = t.tab.suche("spur/1/mute");
    r[3] = t.tab.suche("spur/1/solo");
    PRUEF(r[0] >= 0 && r[1] >= 0 && r[2] >= 0 && r[3] >= 0);
  }
  void starten() { PRUEF(t.arr.start(0.0, 0, false, t.s, V, 256, t.k)); }
  int64_t start_sample() { return t.arr.zustand(t.k, t.s).ursprung_sample; }
  void drain() {
    ArrAutoEreignis e;
    while (t.arr.auto_ereignis_holen(e)) ev.push_back(e);
  }
  // runs whole blocks until t.s >= bis; vor(s0) runs before every block
  template <class F> void lauf(int64_t bis, F&& vor) {
    float b[6][cdj::ARR_BLOCK];
    while (t.s < bis) {
      for (auto& x : b) std::fill(x, x + t.n, 0.0f);
      vor(t.s);
      t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
      t.l.insert(t.l.end(), b[0], b[0] + t.n);
      for (int f = 0; f < 4; ++f) {
        if (buf[f].size() < static_cast<size_t>(t.s + t.n)) buf[f].resize(static_cast<size_t>(t.s + t.n), 0.0f);
        std::copy(Z::buf(t.arr, 0, f), Z::buf(t.arr, 0, f) + t.n, buf[f].begin() + t.s);
      }
      drain();
      t.s += t.n;
    }
  }
  void lauf(int64_t bis) { lauf(bis, [](int64_t) {}); }
  void hand_setzen(int f, float v) {   // the Stellwerk course of the field from the next block on: a constant
    std::fill(hand[f], hand[f] + cdj::ARR_BLOCK, v);
    t.arr.verlauf(r[f], hand[f]);
  }
  double gain(int64_t s) const { return std::fabs(t.l[static_cast<size_t>(s)]) / (0.5 * MITTE); }
  // first block start at or after a project beat
  int64_t block_bei(double beat) { return (static_cast<int64_t>(start_sample() + beat * SPB120) / 256 + 1) * 256; }
};

const Lanes FADER{{P(0, 0.f), P(16, -30.f)}, {}, {}, {}};
double lane_db(Szene& z, int64_t s) { return -30.0 * static_cast<double>(s - z.start_sample()) / SPB120 / 16.0; }
}  // namespace

int main() {
  {  // (a) fader grip in the middle of a block
    Szene z(FADER);
    z.starten();
    const int64_t G = z.block_bei(6.0), sg = G + 100;
    bool ok = false;
    z.lauf(G + 8000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      ok = z.t.arr.auto_uebersteuern(0, 0, true, sg);
    });
    PRUEF(ok);
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(!z.t.arr.auto_uebersteuert(0, 1));
    for (int64_t s = sg - 600; s < sg; ++s) PRUEF_NAH(db_von(z.gain(s)), lane_db(z, s), 0.05);   // the lane plays up to the grip sample
    const double g0 = z.gain(sg - 1), gh = lin(H);
    PRUEF(g0 > 0.2 && g0 < 0.35);   // about -11.3 dB: the positive control that the lane played
    std::printf("a: g0 %.5f gH %.5f first %.5f last %.5f\n", g0, gh, z.gain(sg), z.gain(sg + 479));
    for (int j = 0; j < 480; ++j) PRUEF_NAH(z.gain(sg + j), g0 + (gh - g0) * (j + 1) / 480.0, 2e-4);   // linear in the gain
    for (int64_t s = sg + 480; s < sg + 4000; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);
    PRUEF(z.ev.size() == 1);
    if (z.ev.size() == 1) PRUEF(z.ev[0].spur == 0 && z.ev[0].feld == 0 && z.ev[0].zustand == 1 && z.ev[0].sample == sg);
    // negative control: the same run without a grip plays the lane on
    Szene n(FADER);
    n.starten();
    n.lauf(G + 8000);
    PRUEF_NAH(db_von(n.gain(sg + 2000)), lane_db(n, sg + 2000), 0.05);
    PRUEF(n.ev.empty());
  }
  {  // (b) re-enable in the middle of a block
    Szene z(FADER), ref(FADER);
    z.starten();
    ref.starten();
    const int64_t G = z.block_bei(4.0), sg = G + 100, R = z.block_bei(8.0), sr = R + 37;
    z.lauf(R + 12000, [&](int64_t s0) {
      if (s0 == G) {
        z.hand_setzen(0, H);
        PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, sg));
      }
      if (s0 == R) {
        PRUEF(z.t.arr.auto_uebersteuern(0, 0, false, sr));
        PRUEF(!z.t.arr.auto_uebersteuern(0, 0, false, sr));   // no change: false, no second event
      }
    });
    ref.lauf(R + 12000);
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    const double gh = lin(H);
    for (int64_t s = sr - 300; s < sr; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);   // the hand plays until the re-enable
    for (int j = 0; j < 480; ++j) PRUEF_NAH(z.gain(sr + j), gh + (ref.gain(sr + j) - gh) * (j + 1) / 480.0, 3e-3);
    for (int64_t s = sr + 480 + 40; s < sr + 6000; ++s) PRUEF_NAH(db_von(z.gain(s)), db_von(ref.gain(s)), 0.06);   // then exactly the lane
    PRUEF(z.ev.size() == 2);
    if (z.ev.size() == 2) PRUEF(z.ev[1].zustand == 0 && z.ev[1].sample == sr && z.ev[1].spur == 0 && z.ev[1].feld == 0);
  }
  {  // (c) the override survives stop, start and a swap that keeps the lane; deleting the lane clears it
    Szene z(FADER), n(FADER);
    z.starten();
    n.starten();
    const int64_t G = z.block_bei(4.0), sg = G + 100;
    z.lauf(G + 3000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, sg));
    });
    n.lauf(G + 3000);
    const double gh = lin(H);
    // stop and start again; the control run without an override plays the lane from the start
    for (Szene* q : {&z, &n}) {
      q->t.arr.stopp(0, q->t.s + 64, q->t.k);
      q->lauf(q->t.s + 4096);
      q->starten();
      q->lauf(q->t.s + 6 * 4096);
    }
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));
    const int64_t s2 = z.start_sample() + static_cast<int64_t>(0.5 * SPB120), s2n = n.start_sample() + static_cast<int64_t>(0.5 * SPB120);
    PRUEF_NAH(z.gain(s2), gh, 2e-4);                                           // the hand value, not the lane value at the start
    PRUEF_NAH(db_von(n.gain(s2n)), lane_db(n, s2n), 0.05);                     // control: the lane (about -0.9 dB)
    PRUEF(n.gain(s2n) > 0.85);
    // a swap that keeps the lane (other points): still overridden, the level does not move towards the lane
    const int64_t sw = z.t.s;
    z.t.laden(snap(*z.au, 2, Lanes{{P(0, 0.f), P(16, -10.f)}, {}, {}, {}}));
    z.lauf(sw + 3000);
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));
    for (int64_t s = sw; s < sw + 3000; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);
    const size_t n_ev = z.ev.size();
    PRUEF(n_ev == 1);   // no event for the swap
    // deleting the lane: cleared, zustand 0, the level stays where it is
    const int64_t sd = z.t.s;
    z.t.laden(snap(*z.au, 3, Lanes{}));
    z.lauf(sd + 3000);
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(z.ev.size() == n_ev + 1);
    if (z.ev.size() == n_ev + 1) PRUEF(z.ev.back().zustand == 0 && z.ev.back().sample == sd && z.ev.back().spur == 0 && z.ev.back().feld == 0);
    for (int64_t s = sd + 10; s < sd + 3000; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);
    // a lane that comes back is not overridden (the deletion cleared it)
    z.t.laden(snap(*z.au, 4, FADER));
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
  }
  {  // (c2) deleting the lane while the transport is stopped works as well (checked at the swap, not in auto_block)
    Szene z(FADER);
    z.starten();
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 2000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
    });
    z.t.arr.stopp(0, z.t.s + 64, z.t.k);
    z.lauf(z.t.s + 4096);
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));
    z.ev.clear();
    z.t.laden(snap(*z.au, 2, Lanes{}));
    z.lauf(z.t.s + 1024);
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(z.ev.size() == 1 && z.ev[0].zustand == 0);
  }
  {  // (d) D5: nothing changes while the transport does not play
    Szene z(FADER);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, 0));   // never started
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    z.lauf(2048);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, z.t.s));
    z.starten();
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 8000);
    PRUEF(z.ev.empty());
    PRUEF_NAH(db_von(z.gain(G + 4000)), lane_db(z, G + 4000), 0.05);   // the lane plays on
    z.t.arr.stopp(0, z.t.s + 64, z.t.k);
    z.lauf(z.t.s + 4096);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, z.t.s));              // stopped again
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(!z.t.arr.auto_kann_uebersteuern(0, 0));
    z.drain();
    PRUEF(z.ev.empty());
    // a track without a lane for the field cannot be overridden either (field 1 has no lane here)
    z.starten();
    z.lauf(z.t.s + 4096);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 1, true, z.t.s));
    PRUEF(z.t.arr.auto_kann_uebersteuern(0, 0));
  }
  {  // (d2) D6: re-enabling one field while stopped clears it (D5 only stops the override from starting); the event reports 0
    Szene z(FADER);
    z.starten();
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 2000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
    });
    z.t.arr.stopp(0, z.t.s + 64, z.t.k);
    z.lauf(z.t.s + 4096);
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));
    z.ev.clear();
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, z.t.s));   // starting one while stopped is refused by D5
    PRUEF(z.t.arr.auto_uebersteuern(0, 0, false, z.t.s));   // the re-enable works
    z.drain();
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(z.ev.size() == 1 && z.ev[0].zustand == 0 && z.ev[0].spur == 0 && z.ev[0].feld == 0);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, false, z.t.s));  // second time: no change
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, z.t.s));   // negative control: an override still cannot start while stopped
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    // after the next start the lane plays (not the hand value)
    z.starten();
    z.lauf(z.t.s + 6 * 4096);
    const int64_t s2 = z.start_sample() + static_cast<int64_t>(0.5 * SPB120);
    PRUEF_NAH(db_von(z.gain(s2)), lane_db(z, s2), 0.05);
  }
  {  // (g) event ring: 1024 slots, overflow without draining counts the drops; the state stays readable for a resync (callback thread)
    Szene z(FADER);
    z.starten();
    const int64_t G = z.block_bei(2.0);
    z.lauf(G);
    constexpr int K = 1101;   // 1024 fit, 77 are dropped; the last call (i = 1100) is an override start
    for (int i = 0; i < K; ++i) PRUEF(z.t.arr.auto_uebersteuern(0, 0, i % 2 == 0, G + i / 100));
    PRUEF(z.t.arr.auto_uebersteuert(0, 0));   // the state itself is intact: a reader that saw drops rebuilds from it
    z.drain();
    std::printf("g: %zu events drained, %u dropped\n", z.ev.size(), z.t.arr.auto_ereignis_verloren());
    PRUEF(z.ev.size() == 1024);
    PRUEF(z.t.arr.auto_ereignis_verloren() == K - 1024);
    if (!z.ev.empty()) PRUEF(z.ev[0].zustand == 1 && z.ev[0].sample == G);   // the oldest events are kept, the newest dropped
    PRUEF(z.t.arr.auto_uebersteuern(0, 0, false, G + 20));   // after draining the ring takes events again
    z.drain();
    PRUEF(z.ev.size() == 1025 && z.ev.back().zustand == 0);
    PRUEF(z.t.arr.auto_ereignis_verloren() == K - 1024);
    z.lauf(z.t.s + 2048);   // the block with so many pending changes runs
  }
  {  // (h) auto_alle_freigeben, playing: every overridden field is re-enabled with the blend, one event each
    const Lanes zwei{{P(0, 0.f), P(16, -30.f)}, {P(0, -1.f), P(16, 1.f)}, {}, {}};
    Szene z(zwei), ref(zwei);
    z.starten();
    ref.starten();
    const int64_t G = z.block_bei(4.0), R = z.block_bei(8.0), sr = R + 37;
    z.lauf(R + 8000, [&](int64_t s0) {
      if (s0 == G) {
        z.hand_setzen(0, H);
        z.hand_setzen(1, 0.5f);
        PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
        PRUEF(z.t.arr.auto_uebersteuern(0, 1, true, G + 10));
      }
      if (s0 == R) z.t.arr.auto_alle_freigeben(sr);
    });
    ref.lauf(R + 8000);
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0) && !z.t.arr.auto_uebersteuert(0, 1));
    PRUEF(z.ev.size() == 4);
    int nuller = 0;
    for (size_t i = 2; i < z.ev.size(); ++i) nuller += z.ev[i].zustand == 0 && z.ev[i].sample == sr;
    PRUEF(nuller == 2);
    PRUEF_NAH(z.gain(sr - 1), z.gain(G + 3000), 2e-4);   // the hand plays until the re-enable (steady level, the hand pan 0.5 included)
    for (int64_t s = sr + 480 + 40; s < sr + 4000; ++s) PRUEF_NAH(db_von(z.gain(s)), db_von(ref.gain(s)), 0.06);   // both fields play the lane again
    const size_t n_ev = z.ev.size();
    z.t.arr.auto_alle_freigeben(z.t.s);   // nothing overridden: no event
    z.drain();
    PRUEF(z.ev.size() == n_ev);
  }
  {  // (h2) auto_alle_freigeben, stopped: the state is cleared without a blend, one event per overridden field, none for the others
    const Lanes zwei{{P(0, 0.f), P(16, -30.f)}, {P(0, -1.f), P(16, 1.f)}, {}, {}};
    Szene z(zwei);
    z.starten();
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 2000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
    });
    z.t.arr.stopp(0, z.t.s + 64, z.t.k);
    z.lauf(z.t.s + 4096);
    z.ev.clear();
    z.t.arr.auto_alle_freigeben(z.t.s);
    z.drain();
    PRUEF(!z.t.arr.auto_uebersteuert(0, 0));
    PRUEF(z.ev.size() == 1 && z.ev[0].zustand == 0 && z.ev[0].spur == 0 && z.ev[0].feld == 0);   // pan was never overridden: no event
  }
  {  // (i) two changes of source in one block stay jump-free (D7): re-enable at R, new grip at R + 100; fader (audio) and pan (lane buffer)
    const Lanes zwei{{P(0, 0.f), P(16, -30.f)}, {P(0, -1.f), P(16, 1.f)}, {}, {}};
    Szene z(zwei);
    z.starten();
    const int64_t G = z.block_bei(4.0), B = z.block_bei(8.0), sr = B + 40, sg2 = sr + 100;
    z.lauf(B + 8000, [&](int64_t s0) {
      if (s0 == G) {
        z.hand_setzen(0, H);
        z.hand_setzen(1, 0.5f);
        PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
        PRUEF(z.t.arr.auto_uebersteuern(0, 1, true, G + 10));
      }
      if (s0 == B) {
        for (int f : {0, 1}) {
          PRUEF(z.t.arr.auto_uebersteuern(0, f, false, sr));
          PRUEF(z.t.arr.auto_uebersteuern(0, f, true, sg2));
        }
      }
    });
    const double gh = z.gain(G + 3000);   // the steady hand level (fader -20 dB, hand pan 0.5)
    double gross = 0, pan_gross = 0;
    for (int64_t s = B - 3; s < sg2 + 700; ++s) gross = std::max(gross, std::fabs(z.gain(s) - z.gain(s - 1)));
    for (int64_t s = B - 3; s < sg2 + 480; ++s) pan_gross = std::max(pan_gross, static_cast<double>(std::fabs(z.buf[1][static_cast<size_t>(s)] - z.buf[1][static_cast<size_t>(s - 1)])));
    std::printf("i: largest gain step %.6f (limit 6e-4, a jump is about 0.08), largest pan step %.6f (one blend: %.6f)\n", gross, pan_gross, 0.5 / 480.0);
    PRUEF(z.gain(sg2 - 1) > gh + 0.01);                 // between the two changes the gain moved towards the lane ...
    PRUEF(gross < 6e-4);                                // ... and the second blend starts from there: no jump (a jump is about 0.08); fader and pan blend together
    PRUEF(pan_gross < 1.3e-3);                          // pan: a blend step is at most 0.5 / 480 = 1.04e-3 (a jump is about 0.1)
    for (int64_t s = sg2 + 480 + 10; s < sg2 + 3000; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);   // and ends on the hand value
    PRUEF(z.t.arr.auto_uebersteuert(0, 0) && z.t.arr.auto_uebersteuert(0, 1));
  }
  {  // (k) a lane that was swapped in has not played: auto_letzter_wert is no lane value yet
    Szene z(Lanes{});
    z.starten();
    z.lauf(z.block_bei(2.0));
    PRUEF(!z.t.arr.auto_gespielt(0, 0));
    z.t.laden(snap(*z.au, 2, FADER));
    PRUEF(z.t.arr.auto_kann_uebersteuern(0, 0));
    PRUEF(!z.t.arr.auto_gespielt(0, 0));                 // the swap alone plays nothing
    z.lauf(z.t.s + 512);
    PRUEF(z.t.arr.auto_gespielt(0, 0));                  // after a block it has
  }
  {  // (e) auto_letzter_wert: the last lane value, kept while the hand plays
    Szene z(FADER);
    z.starten();
    const int64_t G = z.block_bei(5.0);
    z.lauf(G);
    const float vor = z.t.arr.auto_letzter_wert(0, 0);
    PRUEF_NAH(vor, z.buf[0][static_cast<size_t>(G - 1)], 1e-6);
    PRUEF_NAH(vor, lane_db(z, G - 1), 0.05);
    PRUEF(vor < -3.0f);
    z.lauf(G + 4096, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, H);
      PRUEF(z.t.arr.auto_uebersteuern(0, 0, true, G + 10));
    });
    const float nach = z.t.arr.auto_letzter_wert(0, 0);
    PRUEF(std::fabs(nach - H) > 3.0f);                       // not the hand value
    PRUEF(nach < vor + 0.05f && nach > vor - 1.0f);          // the lane value at the grip (it moved by at most 10 samples)
    z.lauf(z.t.s + 4096);
    PRUEF_NAH(z.t.arr.auto_letzter_wert(0, 0), nach, 1e-6);  // and it stays
  }
  {  // (f) pan: linear blend in the pan value; mute and solo jump
    const Lanes alle{{}, {P(0, -1.f), P(16, 1.f)}, {P(0, 0.f, 2), P(40, 0.f, 2)}, {P(0, 0.f, 2), P(40, 0.f, 2)}};
    Szene z(alle);
    z.starten();
    const int64_t G = z.block_bei(6.0), sg = G + 100;
    z.lauf(G + 4000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(1, 0.5f);
      z.hand_setzen(2, 1.0f);
      z.hand_setzen(3, 1.0f);
      PRUEF(z.t.arr.auto_uebersteuern(0, 1, true, sg));
      PRUEF(z.t.arr.auto_uebersteuern(0, 2, true, sg));
      PRUEF(z.t.arr.auto_uebersteuern(0, 3, true, sg));
    });
    const double beat = static_cast<double>(sg - 1 - z.start_sample()) / SPB120;
    PRUEF_NAH(z.buf[1][static_cast<size_t>(sg - 1)], -1.0 + 2.0 * beat / 16.0, 0.003);   // the lane plays up to the grip
    const float v0 = z.buf[1][static_cast<size_t>(sg - 1)];
    for (int j = 0; j < 480; ++j) PRUEF_NAH(z.buf[1][static_cast<size_t>(sg + j)], v0 + (0.5f - v0) * (j + 1) / 480.0f, 1e-5);
    PRUEF_NAH(z.buf[1][static_cast<size_t>(sg + 479)], 0.5, 0.0);
    for (int f : {2, 3}) {   // mute, solo: the lane value 0 up to the grip, the hand value 1 from the grip sample, no blend of ours
      PRUEF_NAH(z.buf[f][static_cast<size_t>(sg - 1)], 0.0, 0.0);
      PRUEF_NAH(z.buf[f][static_cast<size_t>(sg)], 1.0, 0.0);
      PRUEF_NAH(z.buf[f][static_cast<size_t>(sg + 100)], 1.0, 0.0);
    }
    // the mixer fade then does the rest: the single track is muted (and soloed) about 480 samples later
    PRUEF(z.gain(sg - 1) > 0.5);   // audible before the grip (the pan lane sits near the centre)
    PRUEF(z.gain(sg + 1500) < 1e-3);
    std::printf("f: pan v0 %.5f -> %.5f, mute/solo jump at sg\n", v0, z.buf[1][static_cast<size_t>(sg + 479)]);
  }
  PRUEF_ENDE();
}
