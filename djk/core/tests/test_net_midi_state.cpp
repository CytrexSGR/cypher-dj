// Strand 7 task 3.3 (plan 2026-11-27 strang7-midi): the core reports the counters of every active MIDI stage as Ereignis::MIDI_ZUSTAND, the net sends them as
// /zustand/arr/midi ,iiiii (spur, gehalten, ein, aus, verloren). Track 2 (intern rb338) holds the chord 60 64 67 from beat 0 to 4 through an arp up 1/16.
//   1. stopped, one second: two events (2 Hz) for spur 2 only, all counters 0.
//   2. playing through the chord: while it is held some event says gehalten 3; after beat 4 ein 3, verloren 0, gehalten 0, aus = the stage's own ON count, exactly the 16 grid steps.
//   3. a new playback with the same stage: the counters start again from 0 ("since this playback was loaded").
//   4. a playback without the stage: exactly one event for spur 2, all zeros, then nothing for two seconds.
//   5. on the wire: MIDI_ZUSTAND becomes /zustand/arr/midi ,iiiii in the field order of osc.json; a counter above INT32_MAX wraps.
#include <algorithm>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_run.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

bool g_waechter = false;

namespace v = cypherdj::osc;
using E = cdj::Ereignis;
using k35::N;
using k35::SPB;

namespace {

const std::string NOTEN = "\"noten\":[{\"id\":\"c/n1\",\"beat\":0.0,\"laenge\":4.0,\"ton\":60,\"vel\":100},"
                          "{\"id\":\"c/n2\",\"beat\":0.0,\"laenge\":4.0,\"ton\":64,\"vel\":100},"
                          "{\"id\":\"c/n3\",\"beat\":0.0,\"laenge\":4.0,\"ton\":67,\"vel\":100}]";
const std::string MIT = "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{},"
                        "\"midi\":{\"arp\":{\"muster\":\"up\",\"rate\":0.25,\"oktaven\":1,\"gate\":0.5}}," + NOTEN + "}";
const std::string OHNE = "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{}," + NOTEN + "}";

std::vector<E> midi(const arr35::Lauf& x, int64_t von, int64_t bis) {
  std::vector<E> m;
  for (const E& e : x.ev)
    if (e.art == E::MIDI_ZUSTAND && e.sample >= von && e.sample < bis) m.push_back(e);
  return m;
}

void kern_teil(const std::string& ab) {
  arr35::Lauf x(ab, "test_netz_midi_zustand");
  x.laden(1, MIT, "andreas", true);
  x.lauf(8 * N);
  {  // 1.
    const int64_t von = x.kern->sample();
    x.lauf(von + 48000);
    const auto m = midi(x, von, von + 48000);
    bool null = true, nur2 = true;
    for (const E& e : m) {
      nur2 = nur2 && e.deck == 2;
      null = null && e.midi_zahl[0] == 0 && e.midi_zahl[1] == 0 && e.midi_zahl[2] == 0 && e.midi_zahl[3] == 0;
    }
    std::printf("1: stopped, one second: %zu events, only spur 2 %d, all zero %d\n", m.size(), nur2, null);
    PRUEF(m.size() >= 2 && m.size() <= 3);
    PRUEF(nur2 && null);
  }
  {  // 2.
    const int64_t st = x.start(0.0, 0);
    x.lauf(x.kern->sample() + 8 * N);
    const k35::Q* q2 = x.quittung(st, 2);
    PRUEF(q2 != nullptr);
    const int64_t s0 = q2 ? q2->sample : x.kern->sample();
    x.lauf(s0 + 5 * SPB + 24000 + 2 * N);
    int max_geh = 0;
    for (const E& e : midi(x, s0, s0 + 4 * SPB)) max_geh = std::max(max_geh, e.midi_zahl[0]);
    const auto spaet = midi(x, s0 + 5 * SPB, x.kern->sample());
    PRUEF(!spaet.empty());
    if (!spaet.empty()) {
      const E& l = spaet.back();
      std::printf("2: held at most %d; after the chord: gehalten %d ein %d aus %d verloren %d\n", max_geh, l.midi_zahl[0], l.midi_zahl[1], l.midi_zahl[2],
                  l.midi_zahl[3]);
      PRUEF(l.deck == 2);
      PRUEF(l.midi_zahl[0] == 0 && l.midi_zahl[1] == 3 && l.midi_zahl[3] == 0);
      // aus: what the stage itself counted (first playback, so its base is 0), exactly the 16 grid steps of the chord. The start here lies just after a clock
      // grid point (within 1/8 step); project step 0 falls on the sample of the chord and plays the step, the immediate step of D5 does not fire as well (it did: 17)
      PRUEF(static_cast<uint64_t>(l.midi_zahl[2]) == x.kern->arrangement().midi_stufe(1).aus_noten());
      PRUEF(l.midi_zahl[2] == 16);
    }
    PRUEF(max_geh == 3);
  }
  {  // 3.
    x.laden(2, MIT, "andreas", true);
    x.lauf(x.kern->sample() + 8 * N);
    const int64_t von = x.kern->sample();
    x.lauf(von + 24000 + 2 * N);
    const auto m = midi(x, von, x.kern->sample());
    PRUEF(!m.empty());
    if (!m.empty()) {
      const E& l = m.back();
      std::printf("3: new playback, same stage: ein %d aus %d\n", l.midi_zahl[1], l.midi_zahl[2]);
      PRUEF(l.midi_zahl[1] == 0 && l.midi_zahl[2] == 0 && l.midi_zahl[3] == 0);
    }
  }
  {  // 4.
    const int64_t von = x.kern->sample();
    x.laden(3, OHNE, "andreas", true);
    x.lauf(von + 2 * 48000);
    const auto m = midi(x, von, x.kern->sample());
    std::printf("4: stage gone: %zu events in two seconds\n", m.size());
    PRUEF(m.size() == 1);
    if (m.size() == 1) {
      PRUEF(m[0].deck == 2);
      PRUEF(m[0].midi_zahl[0] == 0 && m[0].midi_zahl[1] == 0 && m[0].midi_zahl[2] == 0 && m[0].midi_zahl[3] == 0);
    }
  }
}

void netz_teil() {  // 5.
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  Gegenstelle g;
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    PRUEF(g.warte("/k/willkommen", 200));
  }
  PRUEF(v::zustand_arr_midi.typen == ",iiiii");
  E z{};
  z.art = E::MIDI_ZUSTAND;
  z.deck = 17;
  z.midi_zahl[0] = 2;
  z.midi_zahl[1] = 40;
  z.midi_zahl[2] = -7;   // a wrapped counter goes out as it is
  z.midi_zahl[3] = 1;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/arr/midi", 200));
  PRUEF(g.m.anzahl == 5);
  PRUEF(g.i(0) == 17 && g.i(1) == 2 && g.i(2) == 40 && g.i(3) == -7 && g.i(4) == 1);
  std::printf("5: /zustand/arr/midi %d %d %d %d %d\n", g.i(0), g.i(1), g.i(2), g.i(3), g.i(4));
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_netz_midi_zustand");
  kern_teil(ab.pfad);
  netz_teil();
  PRUEF_ENDE();
}
