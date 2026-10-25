// I08: roher MIDI-Eingang midi_ein_1. Der Callback schiebt jedes Ereignis (1 bis 3 Byte) mit seinem Kern-Sample in einen Ring;
// Leser sind Diagnose und das Aufnahme-Modul (1.8, Slice 5). Echtzeit: keine Allokation, keine Sperre.
#pragma once

#include <cstddef>
#include <cstdint>

#include "cypherdj/spsc_ring.h"

namespace cdj {

struct MidiEinEreignis {
  int64_t sample;  // Kern-Sample: Zyklusanfang + JACK-Versatz
  uint8_t b[3];
  uint8_t n;       // 1..3
  uint8_t rest[4];
};

class MidiEin {
 public:
  static constexpr std::size_t KAP = 4096;
  // Nur der Callback. n0 = Kern-Sample des Zyklusanfangs, versatz = JACK-Zeit im Zyklus.
  void schiebe(int64_t n0, uint32_t versatz, const uint8_t* d, std::size_t n) noexcept {
    if (n == 0) return;
    ++gesehen_;
    if (n > 3) { ++zu_lang_; return; }  // SysEx und Längeres: gezählt, nicht gespeichert
    MidiEinEreignis e{};
#ifdef CYPHERDJ_MUTATION_MIDI_EIN_OHNE_VERSATZ
    e.sample = n0;  // Fehlerfall: Versatz im Zyklus fällt weg
#else
    e.sample = n0 + static_cast<int64_t>(versatz);
#endif
    for (std::size_t i = 0; i < n; ++i) e.b[i] = d[i];
    e.n = static_cast<uint8_t>(n);
    letztes_ = e.sample;
    if (!ring_.schiebe(e)) ++verloren_;
  }
  // Ein Ereignis, das der Kern nicht mehr puffern konnte (mehr als MAX_MIDI in einem Zyklus): gesehen und verloren.
  void ueberlauf() noexcept { ++gesehen_; ++verloren_; }
  // Neue Zeitachse (/k/set/neu): das letzte Sample gehört zur alten Achse.
  void achse_neu() noexcept { letztes_ = -1; }
  bool hole(MidiEinEreignis& e) noexcept { return ring_.hole(e); }  // nur der Leser
  uint64_t gesehen() const noexcept { return gesehen_; }
  uint64_t verloren() const noexcept { return verloren_; }
  uint64_t zu_lang() const noexcept { return zu_lang_; }
  int64_t letztes_sample() const noexcept { return letztes_; }  // −1 ohne

 private:
  SpscRing<MidiEinEreignis, KAP> ring_;
  uint64_t gesehen_ = 0, verloren_ = 0, zu_lang_ = 0;
  int64_t letztes_ = -1;
};

}  // namespace cdj
