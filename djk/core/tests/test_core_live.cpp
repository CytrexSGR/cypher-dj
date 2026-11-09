// 1.8 T7b: live notes in the real core. Track 2 is an internal RB-338 track, armed for MIDI (eingang 30, the bit in the module); notes through Kern::midi_ein sound on it at their
// stamp, with nothing recording, and every trigger closes the held key: disarm, end of the run, transport stop, a swap of the playback (the track gets no sink, another sink),
// midi_ein_1 going away. Each case: key held and audible, trigger, the track bus (PM tap) silent within 100 ms, the live table 0 (Arrangement::live_offene_noten).
//   K1 a note at a known offset in a cycle: silent before the stamp, audible from it, the table holds it
//   K2 retrigger: the same key again leaves one entry, the sound goes on; the off closes it
//   K3 disarm  K4 end of the run (the transport keeps playing; a key played after it sounds again)  K5 transport stop  K6 swap (two variants)  K7 midi_ein disconnect
//   K9 planned (quantized) transport stop inside a cycle, the live On stamped after the stop sample in the same cycle: the note sounds from its onset, stays held, the player's off ends it
//   K8 quantum 2048: a note at offset 1500 (second sub-block) is not lost (the stamp is clamped into the first sub-block), and the sink counts nothing lost
// Mutations built against this test: LIVE_AUS_BEI_DISARM_FEHLT (K3). LIVE_NOTE_VERWORFEN and LIVE_ALLE_AUS_LEER have targets only against test_arr_live; here K1 and K4, K5, K7
// pin the same properties through the live table and the bus level, but no mutation binary of this test exists for them.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "arr_run.h"

bool g_waechter = false;
using k35::N;

namespace {

const char* RB = "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.6,\"resonanz\":0.3},\"noten\":[]}";

float spitze(const std::vector<float>& v, int64_t a, int64_t b) {
  float m = 0.0f;
  for (int64_t i = std::max<int64_t>(a, 0); i < b && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, std::fabs(v[i]));
  return m;
}

struct Rig {
  arr35::Lauf x;
  cdj::RecMidi* m = cdj::RecMidi::neu();
  bool adoptiert = false;
  Rig(const std::string& ab, const char* name, const char* spuren = RB) : x(ab, name) {
    x.laden(5, spuren);
    x.lauf(12 * N);
    arm();
  }
  void arm() {
    cdj::Befehl b = x.neu(cdj::Befehl::REC_SPUR, "andreas");
    b.nr = 2; b.an = 1; b.deck = 30; b.zeiger = m;
    const int64_t id = x.sende(b);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(id, 3) != nullptr && x.kern->aufnahme().midi_maske() == (1u << 1));
    adoptiert = true;
  }
  int64_t disarm() {
    cdj::Befehl b = x.neu(cdj::Befehl::REC_SPUR, "andreas");
    b.nr = 2; b.an = 0; b.deck = 30; b.zeiger = nullptr;
    return x.sende(b);
  }
  // the first cycle start at least two cycles ahead
  int64_t voraus() const { return (x.kern->sample() / N + 2) * N; }
  void ein(int64_t s, uint8_t st, uint8_t ton, uint8_t vel) { x.midi_ein_bei(s, st, ton, vel); }
  int live() const { return x.kern->arrangement().live_offene_noten(); }
  void ende() {   // hand the recorder back and free it (the take of a run, if any, is closed as the thread would)
    if (adoptiert) {
      if (m->phase.load() == 2) m->phase.store(3, std::memory_order_release);
      if (x.kern->aufnahme().midi_spur() == m) {
        disarm();
        x.lauf(x.kern->sample() + 3 * N);
      }
    }
    cdj::RecMidi::frei(m);
  }
};

// key held and audible: returns the first sample of the cycle after the trigger window starts
void halten(Rig& r, uint8_t ton, int64_t& ziel) {
  const int64_t basis = r.voraus();
  ziel = basis + 100;
  r.ein(ziel, 0x90, ton, 100);
  r.x.lauf(basis + 4 * N);
  PRUEF(r.live() == 1);
  PRUEF(spitze(r.x.pm_l, ziel, basis + 4 * N) > 0.001f);   // above -60 dBFS
}

// after the trigger: the live table is 0 and the track bus is silent from 100 ms on (a window of 50 ms)
void still(Rig& r, int64_t t, const char* was) {
  r.x.lauf(t + 4800 + 2400 + N);
  const float sp = spitze(r.x.pm_l, t + 4800, t + 4800 + 2400);
  std::printf("%s: live table %d, bus peak in [t + 100 ms, t + 150 ms) %.3g\n", was, r.live(), sp);
  PRUEF(r.live() == 0);
  PRUEF(sp < 1e-4f);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_live");
  {  // K1: sample position, nothing else armed
    Rig r(ab.pfad, "test_kern_live_k1");
    const int64_t ziel = r.voraus() + 100;
    r.ein(ziel, 0x90, 40, 100);
    r.x.lauf(ziel + 4 * N);
    int64_t erster = -1;
    for (int64_t i = ziel - 2 * N; i < ziel + 4 * N && erster < 0; ++i)
      if (r.x.pm_l[i] != 0.0f) erster = i;
    std::printf("K1: stamp %lld, first sound %lld, peak in the cycle %.4f\n", static_cast<long long>(ziel), static_cast<long long>(erster),
                spitze(r.x.pm_l, ziel, (ziel / N + 1) * N));
    PRUEF(erster >= ziel && erster < ziel + 16);   // not before the stamp, and in the cycle that holds it
    PRUEF(spitze(r.x.pm_l, ziel, (ziel / N + 1) * N) > 0.001f);
    PRUEF(r.live() == 1 && r.x.kern->arrangement().offene_noten() == 0);
    PRUEF(r.x.kern->arr_rb().verloren() == 0);
    r.ein(r.voraus() + 7, 0x80, 40, 0);
    r.x.lauf(r.x.kern->sample() + 4 * N);
    PRUEF(r.live() == 0);
    r.ende();
  }
  {  // K2: retrigger
    Rig r(ab.pfad, "test_kern_live_k2");
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t z2 = r.voraus() + 50;
    r.ein(z2, 0x90, 40, 90);
    r.x.lauf(z2 + 4 * N);
    PRUEF(r.live() == 1 && spitze(r.x.pm_l, z2, z2 + 4 * N) > 0.001f);
    r.ein(r.voraus() + 3, 0x90, 40, 0);   // an On with velocity 0 is an off
    r.x.lauf(r.x.kern->sample() + 4 * N);
    PRUEF(r.live() == 0);
    r.ende();
  }
  {  // K3: disarm while a key is held
    Rig r(ab.pfad, "test_kern_live_k3");
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    const int64_t id = r.disarm();
    still(r, t, "K3 disarm");
    PRUEF(r.x.quittung(id, 3) != nullptr && r.x.kern->aufnahme().midi_maske() == 0u);
    r.adoptiert = false;   // the recorder went back through REC_ALT (fassung 1): ende() only frees it
    r.x.lauf(r.x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K4: end of the run; the transport keeps playing, a key played afterwards sounds again
    Rig r(ab.pfad, "test_kern_live_k4");
    const int64_t rr = r.x.rec_start(190, 0);
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 40 * N);
    PRUEF(r.x.quittung(rr, 2) != nullptr && r.x.quittung(sid, 2) != nullptr);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.rec_stopp();
    still(r, t, "K4 run end");
    PRUEF(r.x.quittung(rr, 3) != nullptr && r.x.kern->arrangement().status() == cdj::ArrStatus::spielt);
    const int64_t z2 = r.voraus() + 20;
    r.ein(z2, 0x90, 43, 100);   // not recording any more: the live path still plays
    r.x.lauf(z2 + 4 * N);
    PRUEF(r.live() == 1 && spitze(r.x.pm_l, z2, z2 + 4 * N) > 0.001f);
    r.x.stopp(0);
    r.x.lauf(r.x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K5: transport stop
    Rig r(ab.pfad, "test_kern_live_k5");
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 40 * N);
    PRUEF(r.x.quittung(sid, 2) != nullptr);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.stopp(0);
    still(r, t, "K5 transport stop");
    r.ende();
  }
  {  // K6: swap of the playback: track 2 loses its sink, track 2 gets the Wirt sink
    for (int variante = 0; variante < 2; ++variante) {
      Rig r(ab.pfad, variante ? "test_kern_live_k6b" : "test_kern_live_k6a");
      int64_t ziel = 0;
      halten(r, 40, ziel);
      const int64_t t = r.x.kern->sample();
      if (variante == 0) r.x.laden(6, "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}");   // track 2 is empty
      else r.x.laden(6, "{\"nr\":2,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");                             // track 2 is a Wirt track
      still(r, t, variante ? "K6 swap to the Wirt sink" : "K6 swap to an empty track");
      r.ende();
    }
  }
  {  // K7: midi_ein_1 goes away
    Rig r(ab.pfad, "test_kern_live_k7");
    r.x.kern->ein_verbunden(1u << 8);
    r.x.lauf(r.x.kern->sample() + 3 * N);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.kern->ein_verbunden(0);
    still(r, t, "K7 midi_ein disconnect");
    r.ende();
  }
  {  // K8: quantum 2048, a note in the second sub-block of the cycle
    Rig r(ab.pfad, "test_kern_live_k8");
    arr35::Lauf& x = r.x;
    std::vector<float> pm;
    const auto zyklus = [&](int n, int versatz, uint8_t st, uint8_t ton, uint8_t vel) {   // one cycle of n samples, one MIDI event at the offset (versatz < 0: none)
      const int64_t n0 = x.kern->sample();
      if (versatz >= 0) {
        const uint8_t d[3] = {st, ton, vel};
        x.kern->midi_ein(d, 3, static_cast<uint32_t>(versatz));
      }
      x.kern->zyklus(n, n0 * 20833);
      x.lader.einmal(*x.lr);
      pm.resize(static_cast<size_t>(n0 + n));
      for (int i = 0; i < n; ++i) pm[n0 + i] = x.kern->pm_abgriff_l()[i];
      cdj::Ereignis e;
      while (x.ere->hole(e)) {
        if (e.art != cdj::Ereignis::UHR && e.art != cdj::Ereignis::ZYKLUS) x.ev.push_back(e);
      }
      return n0;
    };
    while (x.kern->sample() % 2048 != 0) x.lauf(x.kern->sample() + N);
    for (int i = 0; i < 4; ++i) zyklus(2048, -1, 0, 0, 0);
    const int64_t n0 = zyklus(2048, 1500, 0x90, 40, 100);   // offset 1500: the second sub-block (1024 .. 2047)
    zyklus(2048, -1, 0, 0, 0);
    int64_t erster = -1;
    for (int64_t i = n0; i < n0 + 4096 && erster < 0; ++i)
      if (pm[i] != 0.0f) erster = i;
    std::printf("K8: quantum 2048, offset 1500 stamped at %lld, first sound %lld, peak %.4f, RB lost %llu\n", static_cast<long long>(n0 + 1023), static_cast<long long>(erster),
                spitze(pm, n0, n0 + 4096), static_cast<unsigned long long>(x.kern->arr_rb().verloren()));
    PRUEF(x.kern->arrangement().live_offene_noten() == 1);
    PRUEF(erster >= n0 + 1023 && erster < n0 + 1023 + 16);   // the clamped stamp: the last sample of the first sub-block, never earlier
    PRUEF(spitze(pm, n0, n0 + 4096) > 0.001f);                 // the note is not lost
    PRUEF(x.kern->arr_rb().verloren() == 0);
    zyklus(2048, 100, 0x80, 40, 0);
    PRUEF(x.kern->arrangement().live_offene_noten() == 0);
    x.lauf(x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K9: planned stop inside a cycle, live On after the stop sample in the same cycle (the review case: it used to ring on with the table at 0)
    Rig r(ab.pfad, "test_kern_live_k9");
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 100 * N);   // past the first beat: the stop falls on a later one, 225 samples into its cycle
    PRUEF(r.x.quittung(sid, 2) != nullptr);
    r.x.stopp(1);   // the next beat
    r.x.lauf(r.x.kern->sample() + 2 * N);
    const int64_t z = r.x.kern->arrangement().stopp_sample();
    const int64_t c = z / N * N;   // start of the cycle that holds the stop sample
    std::printf("K9: stop sample %lld, cycle start %lld, now %lld\n", static_cast<long long>(z), static_cast<long long>(c), static_cast<long long>(r.x.kern->sample()));
    PRUEF(z > 0 && z % N > 0 && z % N < N - 24 && c > r.x.kern->sample() + N);
    r.ein(z + 20, 0x90, 40, 100);
    r.x.lauf(c + 4 * N);
    PRUEF(r.x.kern->arrangement().status() == cdj::ArrStatus::steht);
    std::printf("K9: live table %d, peak after the onset %.4f\n", r.live(), spitze(r.x.pm_l, z + 20, c + 4 * N));
    PRUEF(r.live() == 1);                                       // held: its On came after the stop sample
    PRUEF(spitze(r.x.pm_l, z + 20, c + 4 * N) > 0.001f);        // and it sounds
    const int64_t t = r.voraus() + 7;
    r.ein(t, 0x80, 40, 0);
    r.x.lauf(t + N);
    PRUEF(r.live() == 0);
    still(r, t, "K9 planned stop");
    r.ende();
  }
  PRUEF_ENDE();
}
