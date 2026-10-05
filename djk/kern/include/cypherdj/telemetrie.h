// Telemetrie des Kerns (SCHNITTSTELLEN.md §5.4, §5.9, ARCHITEKTUR §7): der Kern zählt Frame-Lücken und ausgelassene
// Perioden selbst, weil der JACK-Xrun-Rückruf unter pipewire-jack für Überläufe des eigenen Clients blind ist
// (10 Probe b, K1b: 44 Lücken, 0 Rückrufe). Der Zyklusmesser läuft im Callback und schreibt je Zyklus ein Ereignis
// ZYKLUS sowie LUECKE und QUANTUM in den Ereignisring; das Zustandsfenster im Netz-Faden rechnet daraus die Werte der
// letzten Sekunde für /zustand/kern. Scheibe 08.
#pragma once

#include <cstdint>
#include <vector>

#include "cypherdj/kern.h"

namespace cdj {

class Zyklusmesser {
 public:
  explicit Zyklusmesser(Ereignisring* aus) : aus_(aus) {}

  // Anfang jedes Callbacks. treiber_frame und zyklus_us aus jack_get_cycle_times (current_frames, current_usecs),
  // jetzt_ns aus CLOCK_MONOTONIC, sample = Kern-Sample am Blockanfang.
  void anfang(uint32_t treiber_frame, uint64_t zyklus_us, int64_t jetzt_ns, uint32_t nframes, int64_t sample);
  // Ende jedes Callbacks.
  void ende(int64_t jetzt_ns, int32_t befehle_wartend, int32_t generation, int64_t sample);
  // Zähler "seit Generationsstart" (§5.4) zurücksetzen (/k/set/neu).
  void neue_generation();
  // Nur im Prüfmodus: jeder `alle`-te Zyklus verbrennt `perioden` Perioden im Callback (Fehlerfall 10 K1b).
  void setze_pruef_last(int alle, double perioden) {
    last_alle_ = alle;
    last_perioden_ = perioden;
  }

  int64_t frame_luecken() const { return luecken_; }
  int64_t ausgelassene_perioden() const { return ausgelassen_; }
  int64_t luecken_gesamt() const { return luecken_gesamt_; }  // seit Prozessstart, nie zurückgesetzt
  int64_t ausgelassen_gesamt() const { return ausgelassen_gesamt_; }
  uint64_t zyklen() const { return zyklen_; }
  uint64_t verbrannt() const { return verbrannt_; }

 private:
  void schiebe(const Ereignis& e) {
    if (!aus_->schiebe(e)) ++verloren_;
  }
  Ereignisring* aus_;
  bool erster_ = true;
  uint32_t letzter_frame_ = 0;
  uint32_t letzte_n_ = 0;
  int64_t start_ns_ = 0;
  int32_t aufwach_us_ = 0;
  uint32_t nframes_ = 0;
  int64_t luecken_ = 0, ausgelassen_ = 0;
  int64_t luecken_gesamt_ = 0, ausgelassen_gesamt_ = 0;
  uint64_t zyklen_ = 0;
  uint64_t verloren_ = 0;
  int last_alle_ = 0;
  double last_perioden_ = 0.0;
  uint64_t verbrannt_ = 0;
};

// Werte für /zustand/kern ,iihiiiiiiii (§5.4)
struct KernZustand {
  int32_t generation = 0;
  int32_t quantum = 0;
  int64_t sample = 0;
  int32_t frame_luecken = 0;
  int32_t ausgelassene_perioden = 0;
  int32_t cb_max_us = 0;
  int32_t cb_p99_us = 0;
  int32_t aufwach_max_us = 0;
  int32_t stretcher_aktiv = 0;
  int32_t befehle_wartend = 0;
  int32_t ki_gestoppt = 0;
};

// Scheibe 25: Verteilung der Callback-Dauer über den ganzen Lauf (ARCHITEKTUR §7: p99,9 unter 20 % der Periode, 1,07 ms
// bei 256). Klassen zu 1 µs von 0 bis 20 000 µs, alles darüber in der letzten Klasse. Nur im Netz-Faden (ZYKLUS-Ereignis);
// der Konstruktor legt die Klassen an (nicht im Callback).
class Verteilung {
 public:
  Verteilung() : k_(KLASSEN, 0) {}
  void zaehle(int32_t dauer_us) {
    const int32_t d = dauer_us < 0 ? 0 : dauer_us;
    ++k_[d < KLASSEN ? d : KLASSEN - 1];
    ++n_;
    if (d > max_) max_ = d;
  }
  uint64_t anzahl() const { return n_; }
  int32_t max() const { return max_; }
  // Kleinste Dauer d (µs) mit Anteil der Zyklen <= d mindestens q; -1 ohne Werte.
  int32_t quantil(double q) const {
    if (n_ == 0) return -1;
    const double ziel = q * static_cast<double>(n_);
    uint64_t summe = 0;
    for (int32_t d = 0; d < KLASSEN; ++d) {
      summe += k_[d];
      if (static_cast<double>(summe) >= ziel) return d;
    }
    return KLASSEN - 1;
  }

 private:
  static constexpr int32_t KLASSEN = 20001;
  std::vector<uint64_t> k_;
  uint64_t n_ = 0;
  int32_t max_ = -1;
};

class Zustandsfenster {
 public:
  void zyklus(const Ereignis& e);             // e.art == Ereignis::ZYKLUS
  KernZustand werte(int64_t jetzt_ns) const;  // cb_max, cb_p99, aufwach_max über die letzte Sekunde

 private:
  static constexpr int N = 1024;  // mehr als 375 Zyklen je Sekunde bei Quantum 128
  struct Eintrag {
    int64_t start_ns;
    int32_t dauer_us, aufwach_us;
  };
  Eintrag e_[N]{};
  int kopf_ = 0;
  int anzahl_ = 0;
  KernZustand letzt_{};
};

}  // namespace cdj
