// D1 K2b: ein Zyklus eines Wirt-Slot-Ausgangs arr_midi_<s> des Kerns ohne JACK, für process() in main.cpp und für Tests:
// zuerst der All-Off-Plan bei Versatz 0 (F06, kanten.h), dann die Ereignisse des Zyklus stabil nach Versatz sortiert (ein
// Off vor einem On am selben Sample bleibt davor), nur Versatz < n. Dieselbe Reihenfolge wie die Schleife der
// Studio-Ströme midi_aus_<p> in process(); die bleibt nach Spec 6.28 wörtlich und benutzt diese Funktion nicht.
// schreibe(t, bytes) schreibt drei Bytes und liefert true, wenn sie Platz fanden. Echtzeit: keine Allokation.
#pragma once

#include <cstdint>
#include <utility>

#include "cypherdj/erzeuger.h"
#include "cypherdj/kanten.h"

namespace cdj {

template <class Schreibe>
AllAusPlan::Ergebnis midi_zyklus(AllAusPlan& plan, int64_t jetzt_ns, const uint8_t (*allaus)[3], const MidiAus& m,
                                 uint32_t n, Schreibe&& schreibe) {
  const AllAusPlan::Ergebnis r = plan.zyklus(jetzt_ns, [&](int i) { return schreibe(0u, allaus[i]); });
  int idx[ERZ_MIDI_EV];
  for (int i = 0; i < m.n; ++i) idx[i] = i;
#ifndef CYPHERDJ_MUTATION_MIDI_UNSORTIERT
  for (int i = 1; i < m.n; ++i)  // Einfügesortierung, stabil
    for (int j = i; j > 0 && m.ev[idx[j]].t < m.ev[idx[j - 1]].t; --j) std::swap(idx[j], idx[j - 1]);
#endif
  for (int i = 0; i < m.n; ++i) {
    const MidiAus::Ev& ev = m.ev[idx[i]];
    if (ev.t < n) schreibe(ev.t, ev.b);
  }
  return r;
}

}  // namespace cdj
