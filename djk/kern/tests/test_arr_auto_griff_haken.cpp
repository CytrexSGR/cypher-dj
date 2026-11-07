// 1.12 Automation slice 3, task 1 (D2): the pickup hook in the hand loop of the core, checked against a stub for the lane
// value (the real source comes from the Arrangement in task 2). The hook runs before the Stellwerk applies a hand step and
// sets the regulator to the value the lane played last (setze_direkt), so the first applied value starts from it.
//   g)  a grip on spur/1/fader whose lane plays (stub: true, -20 dB): the value is near -20 dB, not near the base 0 dB;
//       exactly one pickup, for the second message (the first only sets the position)
//   g2) an explicit touch event (mapping note) picks up as well: the value is -20 dB after the touch alone
//   i)  the first message of an absolute fader is swallowed: no pickup, the base value is not touched
//   ii) grip while stopped (stub: false): no pickup, the base value is not touched
//   iii) a regulator the stub does not know (spur/2/fader): no pickup
//   iv) review: an open /k/teil on the regulator and two messages inside the dead zone (0.5, 0.505): the hand step is discarded,
//       so there is no pickup and the base value stays
//   v)  review: a release (note off) is not a grip: no pickup
#include <unistd.h>

#include <cstdio>
#include <fstream>

#include "kern35.h"

bool g_waechter = false;

using k35::N;

namespace {
// Expected value after the pickup (-20 dB lane value) and one absolute step 0.5 -> 0.52 on spur/1/fader (K_SPUR_FADER, max +6 dB):
// x(-20 dB) = 0.0501; the hand scales from the position 0.5: x + (0.52 - 0.5) * (1 - x) / (1 - 0.5) = 0.0501 + 0.038 = 0.0881,
// which the curve maps back to -15.10 dB. Measured -15.099 dB (the step moves the steep low end by about 5 dB).
constexpr double W_G = -15.10;

struct Stub : cdj::AutoPickup {
  int regler = -1;
  bool spielt = true;
  float lane = -20.0f;
  mutable int treffer = 0;   // calls that returned true
  mutable int fragen = 0;
  bool lane_wert(int r, float& w) const override {
    fragen++;
    if (!spielt || r != regler) return false;
    w = lane;
    treffer++;
    return true;
  }
};

const char* MAPPING = R"({"version":1,"geraet":"pickup","quelle_port":"q","ziel_port":"z","eintraege":[
  {"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"spur/1/fader","art":"absolut","kurve":{"typ":"fader_db","min":-200.0,"max":0.0}},
  {"nachricht":{"typ":"note","kanal":1,"nr":38},"ziel":"spur/1/fader","art":"beruehrung"}],"leds":[]})";

struct Aufbau {
  k35::Arbeitsbestand ab;
  std::string mapping;
  std::unique_ptr<k35::Lauf> x;
  Stub stub;
  explicit Aufbau(const char* name)
      : ab(name), mapping("/dev/shm/" + std::string(name) + "_" + std::to_string(getpid()) + ".json") {
    std::ofstream(mapping) << MAPPING;
    x.reset(new k35::Lauf(ab.pfad, mapping.c_str()));
    x->kern->setze_pruefmodus(false);
    x->teil("spur/1/fader", 0.0f, 0.0, 0.0);   // base value 0 dB
    x->teil("spur/2/fader", 0.0f, 0.0, 0.0);
    x->zyklen(4 * N);
    stub.regler = x->kern->stellwerk().tabelle().suche("spur/1/fader");
    x->kern->setze_auto_pickup(&stub);
  }
  ~Aufbau() { std::remove(mapping.c_str()); }
};
}  // namespace

int main() {
  {  // g
    Aufbau a("test_arr_auto_griff_haken_g");
    k35::Lauf& x = *a.x;
    PRUEF_NAH(x.wert("spur/1/fader"), 0.0, 1e-4);
    x.test_hand("spur/1/fader", 0.5f, 5 * N + 10);   // first message: position only
    x.test_hand("spur/1/fader", 0.52f, 6 * N + 10);
    x.zyklen(8 * N);
    std::printf("g: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer == 1);
    PRUEF_NAH(x.wert("spur/1/fader"), W_G, 0.1);   // see W_G
    PRUEF_NAH(x.wert("spur/2/fader"), 0.0, 1e-4);
  }
  {  // g2
    Aufbau a("test_arr_auto_griff_haken_g2");
    k35::Lauf& x = *a.x;
    x.midi_bei(5 * N + 20, 0x90, 38, 127);   // touch on
    x.zyklen(8 * N);
    std::printf("g2: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer == 1);
    PRUEF_NAH(x.wert("spur/1/fader"), -20.0, 1e-3);
  }
  {  // i
    Aufbau a("test_arr_auto_griff_haken_i");
    k35::Lauf& x = *a.x;
    x.test_hand("spur/1/fader", 0.5f, 5 * N + 10);   // only message
    x.zyklen(8 * N);
    std::printf("i: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer == 0);
    PRUEF_NAH(x.wert("spur/1/fader"), 0.0, 1e-4);
  }
  {  // i2: both messages in the same cycle: the second is applied, so the pickup runs
    Aufbau a("test_arr_auto_griff_haken_i2");
    k35::Lauf& x = *a.x;
    x.test_hand("spur/1/fader", 0.5f, 5 * N + 10);
    x.test_hand("spur/1/fader", 0.52f, 5 * N + 20);
    x.zyklen(8 * N);
    std::printf("i2: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer >= 1);
    PRUEF_NAH(x.wert("spur/1/fader"), W_G, 0.1);
  }
  {  // ii
    Aufbau a("test_arr_auto_griff_haken_ii");
    a.stub.spielt = false;
    k35::Lauf& x = *a.x;
    x.test_hand("spur/1/fader", 0.5f, 5 * N + 10);
    x.test_hand("spur/1/fader", 0.52f, 6 * N + 10);
    x.midi_bei(7 * N + 20, 0x90, 38, 127);
    x.zyklen(9 * N);
    std::printf("ii: value %.3f dB, hits %d, asks %d\n", x.wert("spur/1/fader"), a.stub.treffer, a.stub.fragen);
    PRUEF(a.stub.treffer == 0);
    PRUEF(x.wert("spur/1/fader") > -3.0);   // the base value 0 dB moved by the hand scaling only, never towards -20
    PRUEF(a.stub.fragen >= 1);              // the hook did ask (a stopped transport is the stub's answer, not a skipped call)
  }
  {  // iii
    Aufbau a("test_arr_auto_griff_haken_iii");
    k35::Lauf& x = *a.x;
    x.test_hand("spur/2/fader", 0.5f, 5 * N + 10);
    x.test_hand("spur/2/fader", 0.52f, 6 * N + 10);
    x.zyklen(8 * N);
    PRUEF(a.stub.treffer == 0);
    PRUEF(x.wert("spur/2/fader") > -3.0);
  }
  {  // iv: dead zone of an open /k/teil
    Aufbau a("test_arr_auto_griff_haken_iv");
    k35::Lauf& x = *a.x;
    x.teil("spur/1/fader", -6.0f, 40.0, 8.0, "pruefstand", "p");   // open part, starts far in the future: the plan holds the regulator
    x.zyklen(5 * N);
    x.test_hand("spur/1/fader", 0.5f, 5 * N + 10);     // first message: position only
    x.test_hand("spur/1/fader", 0.505f, 6 * N + 10);   // inside 3/128 of the anchor: discarded by the arbiter
    x.zyklen(8 * N);
    std::printf("iv: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer == 0);
    PRUEF_NAH(x.wert("spur/1/fader"), 0.0, 1e-4);
    PRUEF(x.kern->stellwerk().halter(a.stub.regler).art != cypherdj::stellwerk::HalterArt::mensch);
  }
  {  // v: a release is not a grip
    Aufbau a("test_arr_auto_griff_haken_v");
    k35::Lauf& x = *a.x;
    x.midi_bei(5 * N + 20, 0x90, 38, 127);   // touch on: pickup
    x.midi_bei(7 * N + 20, 0x80, 38, 0);     // touch off: release
    x.zyklen(10 * N);
    std::printf("v: value %.3f dB, hits %d\n", x.wert("spur/1/fader"), a.stub.treffer);
    PRUEF(a.stub.treffer == 1);
  }
  PRUEF_ENDE();
}
