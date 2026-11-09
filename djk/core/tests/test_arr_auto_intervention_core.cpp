// 1.12 Automation slice 3, task 2 (D1, D2, D4, D5; conditions of the task 1 reviews), in the whole core: the hand loop, the Stellwerk, the Arrangement.
//   (a) absolute fader, five messages in a row on a track whose fader lane plays: the first only sets the position, the second is the grip (override starts, pickup
//       from the lane value), and every further message moves the value ON from there (condition 1: lane_wert answers false once overridden; a bug lets every
//       step fall back to the lane value, then the value would not move on)
//   (a2) the same with a relative encoder, messages inside one Stellwerk cycle and in following cycles
//   (b) page path (D4): Kern::auto_uebersteuern sets the Stellwerk value to the last lane value first, the value (and the level) then stays until the next /k/teil;
//       control without the call: the lane plays on; re-enable gives the lane back; the stopped transport refuses (D5)
//   (c) teile_nachreichen (condition 2): the replayed holder touches of a restart neither pick up nor override
//   (h) allocation guard with overrides in play: 0 inside Kern::zyklus (grips, page path, re-enable)
//   (a3) resend of the known position is no grip; one 7-bit step is
//   (b3) the page path sets no value for a lane that has not played
// Mutations (WILL_FAIL): ARR_AUTO_SETZE_OHNE_WAR (b3), ARR_AUTO_UEBER_PICKUP_IMMER (a, a2), ARR_AUTO_UEBER_NACHREICHEN_GRIFF (c).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <fstream>

#include "arr_run.h"
#include "cypherdj/signalbox/controls.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

bool g_waechter = false;

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: a lane that has not played (or whose swap-in has not been through a block yet)
  static void nie_gespielt(const Arrangement& a, int i, int f) {
    Arrangement& m = const_cast<Arrangement&>(a);
    m.auto_war_[i][f] = false;
    m.auto_lane_v_[i][f] = -7.0f;   // a leftover of an old lane
  }
};
struct KernPruefZugang {   // friend of Kern: plays the restart state that teile_nachreichen replays
  static void mensch_wieder(Kern& k, int regler) {
    k.n_mensch_wieder_ = 1;
    k.mensch_wieder_[0] = static_cast<int16_t>(regler);
    k.nachreichen_in_ = 1;
  }
};
}  // namespace cdj

using k35::N;

namespace {
const char* MAPPING = R"({"version":1,"geraet":"eingriff","quelle_port":"q","ziel_port":"z","eintraege":[
  {"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"spur/1/fader","art":"absolut","kurve":{"typ":"fader_db","min":-200.0,"max":0.0}},
  {"nachricht":{"typ":"cc","kanal":1,"nr":8},"ziel":"spur/2/fader","art":"relativ","kodierung":"zweierkomplement","kurve":{"typ":"fader_db","min":-200.0,"max":0.0}}],"leds":[]})";

struct Aufbau {
  k35::Arbeitsbestand ab;
  std::string mapping;
  std::unique_ptr<arr35::Lauf> x;
  explicit Aufbau(const char* name, int spuren = 2)
      : ab(name), mapping("/dev/shm/" + std::string(name) + "_" + std::to_string(getpid()) + ".json") {
    std::ofstream(mapping) << MAPPING;
    x.reset(new arr35::Lauf(ab.pfad, name, mapping.c_str()));
    for (int nr = 1; nr <= spuren; ++nr) x->teil(("spur/" + std::to_string(nr) + "/fader").c_str(), 0.0f, 0.0, 0.0);   // base value 0 dB
    const std::string a = x->ordner.audio('a', 800000, 0.1f);
    std::string s;
    for (int nr = 1; nr <= spuren; ++nr)   // a fader lane 0 -> -30 dB over 16 beats on every track
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           x->ordner.clip(("c" + std::to_string(nr)).c_str(), 0.0, 30.0, a, 800000) + "],\"auto\":[" +
           arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {16.0, -30.0, 0}}) + "]}";
    x->laden(1, s, "andreas", true);
    x->start(0.0, 0);
    x->zyklen(560 * N);   // about beat 6: the lane is near -11 dB
  }
  ~Aufbau() { std::remove(mapping.c_str()); }
  double fader(int nr) const { return x->wert(("spur/" + std::to_string(nr) + "/fader").c_str()); }
  const cdj::Arrangement& arr() const { return x->kern->arrangement(); }
  int64_t naechster() const { return (x->kern->sample() / N + 2) * N; }   // start of the cycle after the next
};

// peak of the master left over one cycle (the signal is a constant times the gain, so the peak is the level)
double pegel(const k35::Lauf& x, int64_t n0) {
  double m = 0;
  for (int64_t i = n0; i < n0 + N && i < static_cast<int64_t>(x.l.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x.l[static_cast<size_t>(i)])));
  return m;
}
}  // namespace

int main() {
  {  // (a) absolute fader: position message, grip, then the hand moves ON from the pickup value
    Aufbau a("test_arr_auto_eingriff_kern_a");
    k35::Lauf& x = *a.x;
    const double lane0 = a.arr().auto_letzter_wert(0, 0);
    PRUEF(lane0 < -3.0 && lane0 > -25.0);   // the lane plays and is somewhere in the middle
    double v[6] = {};
    float roh = 0.5f;
    for (int k = 0; k < 5; ++k) {
      const int64_t s = a.naechster();
      x.test_hand("spur/1/fader", roh, s + 10);
      x.zyklen(s + 2 * N);
      v[k] = a.fader(1);
      std::printf("a: message %d raw %.2f -> %.3f dB, overridden %d, lane %.3f\n", k + 1, roh, v[k], a.arr().auto_uebersteuert(0, 0) ? 1 : 0,
                  a.arr().auto_letzter_wert(0, 0));
      if (k == 0) PRUEF(!a.arr().auto_uebersteuert(0, 0));   // the first message only sets the position: no grip
      roh += 0.02f;
    }
    PRUEF(a.arr().auto_uebersteuert(0, 0));
    PRUEF(!a.arr().auto_uebersteuert(1, 0));   // the other track keeps its lane
    PRUEF_NAH(v[0], 0.0, 1e-4);                 // position message: the base value is untouched
    PRUEF(v[1] > lane0 + 0.5 && v[1] < lane0 + 14.0);   // the step starts from the lane value (pickup), not from the base 0 dB
    PRUEF(v[2] > v[1] + 0.5 && v[3] > v[2] + 0.5 && v[4] > v[3] + 0.5);   // condition 1: every message moves ON from the one before
    PRUEF(v[4] < 0.0 + 1e-6);
    x.zyklen(a.naechster() + 40 * N);
    PRUEF_NAH(a.fader(1), v[4], 1e-4);   // the hand holds its value, the lane no longer pulls it
  }
  {  // (a3) controller decision (AK11 "bewegt"): an absolute resend of the known position is no grip, real jitter of one 7-bit step is
    Aufbau a("test_arr_auto_eingriff_kern_a3", 1);
    k35::Lauf& x = *a.x;
    const float roh[4] = {0.5f, 0.5f, 0.5f + 1.0f / 127.0f, 0.5f + 1.0f / 127.0f};   // position, the same value again, one step up, that value again
    const int soll[4] = {0, 0, 1, 1};
    for (int k = 0; k < 4; ++k) {
      const int64_t s = a.naechster();
      x.test_hand("spur/1/fader", roh[k], s + 10);
      x.zyklen(s + 2 * N);
      std::printf("a3: message %d raw %.4f -> overridden %d, value %.3f dB\n", k + 1, roh[k], a.arr().auto_uebersteuert(0, 0) ? 1 : 0, a.fader(1));
      PRUEF((a.arr().auto_uebersteuert(0, 0) ? 1 : 0) == soll[k]);
      if (k == 1) PRUEF_NAH(a.fader(1), 0.0, 1e-4);   // the resend moved nothing, no pickup
    }
  }
  {  // (a2) relative encoder: three messages inside one cycle, then one per cycle
    Aufbau a("test_arr_auto_eingriff_kern_a2");
    k35::Lauf& x = *a.x;
    const double lane0 = a.arr().auto_letzter_wert(1, 0);
    int64_t s = a.naechster();
    for (int i = 0; i < 3; ++i) x.midi_bei(s + 10 + 20 * i, 0xB0, 8, 2);   // +2 ticks, three times in one cycle
    x.zyklen(s + 2 * N);
    const double w1 = a.fader(2);
    std::printf("a2: three messages in one cycle: %.3f dB (lane %.3f)\n", w1, lane0);
    PRUEF(a.arr().auto_uebersteuert(1, 0));
    PRUEF(w1 > lane0 + 0.2);   // three steps up from the lane value ...
    double letzter = w1;
    for (int k = 0; k < 3; ++k) {
      s = a.naechster();
      x.midi_bei(s + 10, 0xB0, 8, 2);
      x.zyklen(s + 2 * N);
      std::printf("a2: further message %d: %.3f dB\n", k + 1, a.fader(2));
      PRUEF(a.fader(2) > letzter + 0.05);   // ... and ON from there (a bug resets to the lane value at every step)
      letzter = a.fader(2);
    }
    PRUEF(a.fader(2) > lane0 + 0.6);
  }
  {  // (b) page path
    Aufbau a("test_arr_auto_eingriff_kern_b", 1), k("test_arr_auto_eingriff_kern_bk", 1);
    k35::Lauf& x = *a.x;
    const double lane0 = a.arr().auto_letzter_wert(0, 0);
    PRUEF(a.arr().auto_kann_uebersteuern(0, 0));
    PRUEF(a.x->kern->auto_uebersteuern(0, 0, true));
    PRUEF(a.arr().auto_uebersteuert(0, 0));
    PRUEF(!a.x->kern->auto_uebersteuern(0, 0, true));   // no change
    x.zyklen(a.naechster() + 2 * N);
    const int64_t t1 = x.kern->sample() - 2 * N;
    const double w1 = a.fader(1), p1 = pegel(x, t1 + 84);
    x.zyklen(x.kern->sample() + 150 * N);
    const int64_t t2 = x.kern->sample() - 2 * N;
    const double w2 = a.fader(1), p2 = pegel(x, t2 + 84);
    std::printf("b: lane at the call %.3f dB, held %.3f -> %.3f dB, level %.5f -> %.5f\n", lane0, w1, w2, p1, p2);
    PRUEF_NAH(w1, lane0, 0.2);                        // the pickup: the value is the lane value of the call
    PRUEF_NAH(w2, w1, 1e-4);                          // and stays, though the lane has moved on
    PRUEF(a.arr().auto_letzter_wert(0, 0) < lane0 + 0.01 && a.arr().auto_letzter_wert(0, 0) > lane0 - 0.5);
    PRUEF_NAH(20.0 * std::log10(p2 / p1), 0.0, 0.05);  // the level is as constant
    // control: the same run without the call plays the lane on (about -3 dB in 150 cycles)
    k35::Lauf& y = *k.x;
    y.zyklen(k.naechster() + 2 * N);
    const double q1 = pegel(y, y.kern->sample() - 2 * N + 84);
    y.zyklen(y.kern->sample() + 150 * N);
    const double q2 = pegel(y, y.kern->sample() - 2 * N + 84);
    PRUEF(20.0 * std::log10(q2 / q1) < -1.5);
    // a /k/teil moves the value, the override stays
    x.teil("spur/1/fader", -3.0f, 0.0, 0.0);
    x.zyklen(x.kern->sample() + 20 * N);
    PRUEF_NAH(a.fader(1), -3.0, 1e-3);
    PRUEF(a.arr().auto_uebersteuert(0, 0));
    // re-enable: the lane plays again
    PRUEF(a.x->kern->auto_uebersteuern(0, 0, false));
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
    // D5: stopped transport refuses
    a.x->stopp(0);
    x.zyklen(x.kern->sample() + 20 * N);
    PRUEF(!a.x->kern->auto_uebersteuern(0, 0, true));
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
    PRUEF_NAH(a.fader(1), -3.0, 1e-3);   // and the Stellwerk value was not touched either
  }
  {  // (b2) D6 via the Kern: the re-enable of one field works while stopped
    Aufbau a("test_arr_auto_eingriff_kern_b2", 1);
    PRUEF(a.x->kern->auto_uebersteuern(0, 0, true));
    a.x->stopp(0);
    a.x->zyklen(a.naechster() + 20 * N);
    PRUEF(a.arr().auto_uebersteuert(0, 0));
    PRUEF(a.x->kern->auto_uebersteuern(0, 0, false));
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
  }
  std::printf("sizeof(Arrangement) = %zu\n", sizeof(cdj::Arrangement));
  {  // (b3) page path, lane that has not played (swapped in this cycle): no setze_direkt, the value is neither 0 nor a leftover; the override still starts
    Aufbau a("test_arr_auto_eingriff_kern_b3", 1);
    k35::Lauf& x = *a.x;
    a.x->teil("spur/1/fader", -2.0f, 0.0, 0.0);
    x.zyklen(a.naechster() + 2 * N);
    cdj::ArrPruefZugang::nie_gespielt(a.arr(), 0, 0);
    PRUEF(!a.arr().auto_gespielt(0, 0));
    PRUEF(a.x->kern->auto_uebersteuern(0, 0, true));
    PRUEF(a.arr().auto_uebersteuert(0, 0));
    x.zyklen(a.naechster() + 2 * N);
    std::printf("b3: value %.3f dB (base -2)\n", a.fader(1));
    PRUEF_NAH(a.fader(1), -2.0, 1e-3);   // untouched: not 0, not -7
  }
  {  // (c) the touches that teile_nachreichen replays after a restart are no grips
    Aufbau a("test_arr_auto_eingriff_kern_c", 1);
    k35::Lauf& x = *a.x;
    const int r = x.kern->stellwerk().tabelle().suche("spur/1/fader");
    cdj::KernPruefZugang::mensch_wieder(*x.kern, r);
    x.zyklen(a.naechster() + 4 * N);
    std::printf("c: after the replayed touch: value %.3f dB, overridden %d\n", a.fader(1), a.arr().auto_uebersteuert(0, 0) ? 1 : 0);
    PRUEF(!a.arr().auto_uebersteuert(0, 0));
    PRUEF_NAH(a.fader(1), 0.0, 1e-4);   // no pickup: the base value stands
  }
  {  // (h) allocation guard with overrides in play
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("skipped (sanitizer build): allocation watcher not available\n");
    } else {
      Aufbau a("test_arr_auto_eingriff_kern_h");
      k35::Lauf& x = *a.x;
      long im_zyklus = 0;
      int64_t ueber = 0;
      auto zyklus = [&](bool midi) {
        const int64_t n0 = x.kern->sample();
        if (midi) {
          const uint8_t m1[3] = {0xB0, 8, 2};
          x.kern->hand_midi(m1, 3, 10);
        }
        abfang_an();
        x.kern->zyklus(N, n0 * 20833);
        im_zyklus += abfang_aus();
        cdj::Ereignis e;
        while (x.ere->hole(e)) {
        }
      };
      for (int i = 0; i < 100; ++i) zyklus(false);
      for (int i = 0; i < 300; ++i) zyklus(i % 3 == 0);   // grip on track 2 and a hand that keeps moving
      ueber += a.arr().auto_uebersteuert(1, 0) ? 1 : 0;
      abfang_an();
      const bool ok1 = x.kern->auto_uebersteuern(0, 0, true);   // page path on track 1
      long page = abfang_aus();
      for (int i = 0; i < 300; ++i) zyklus(i % 3 == 0);
      ueber += a.arr().auto_uebersteuert(0, 0) ? 1 : 0;
      abfang_an();
      const bool ok2 = x.kern->auto_uebersteuern(0, 0, false);   // re-enable (blend)
      const bool ok3 = x.kern->auto_uebersteuern(1, 0, false);
      page += abfang_aus();
      for (int i = 0; i < 300; ++i) zyklus(i % 3 == 0);
      abfang_an();
      void* p = std::malloc(16);
      const long positiv = abfang_aus();
      std::free(p);
      std::printf("h: %ld allocations in 1000 cycles, %ld in the page path calls, positive control %ld, overridden fields seen %lld\n", im_zyklus, page, positiv,
                  static_cast<long long>(ueber));
      PRUEF(ok1 && ok2 && ok3);
      PRUEF(ueber == 2);   // the overrides really happened (0 allocations is not an empty run)
      PRUEF(positiv >= 1);
      PRUEF(im_zyklus == 0 && page == 0);
    }
  }
  PRUEF_ENDE();
}
