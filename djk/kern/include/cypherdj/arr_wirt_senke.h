// D1 K2b (Spec 2.2, 2.4, A4): ein Wirt-Slot des Arrangements, arr_midi_<s> -> Carla-Wirt -> arr_rueck_<s>_L/R. Noten
// gehen um den Wirt-Rundweg früher hinaus (Vorhalt 2n + 25 wie die MIDI-Ströme, Glanz 2.7), als JACK-MIDI auf Kanal 1
// in den Zyklus-Puffer midi() (Versatz ab dem Zyklusanfang; main.cpp gibt ihn aus). alle_aus schickt All Notes Off
// (CC 123). Der Rückweg des Zyklus (rueck(), von main.cpp gesetzt) geht geprüft (NaN/Inf raus, ±8) in den Eingang der
// ersten Spur, die den Slot spielt; weitere Spuren desselben Slots bekommen ihn nicht noch einmal.
// Messpunkt A4: zu jedem gesendeten Note-Ein sucht die Senke im Rückweg den ersten Einsatz (Pegel über −40 dBFS nach
// mindestens 10 ms Stille, ab dem Sende-Sample) und meldet Ziel und Einsatz über einen Ring an den Hauptfaden; ohne
// Einsatz binnen 200 ms mit einsatz −1. Springt die Zeitachse zurück (/k/set/neu, Kern-Sample wieder 0), fallen die
// offenen Messungen der alten Achse still weg (Fix F7; die Messvorschrift verlangt isolierte Noten).
// Echtzeit: keine Allokation, keine Sperre, kein I/O.
#pragma once

#include <cstdint>

#include "cypherdj/arrangement.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/spsc_ring.h"

namespace cdj {

constexpr float ARR_A4_SCHWELLE = 0.01f;    // −40 dBFS
constexpr int64_t ARR_A4_STILLE = 480;      // 10 ms unter der Schwelle vor einem Einsatz
constexpr int64_t ARR_A4_FENSTER = 9600;    // 200 ms nach dem Ziel ohne Einsatz: gemeldet mit einsatz −1
constexpr int ARR_A4_OFFEN = 16;            // gesendete Note-Ein ohne Einsatz (ältere fallen weg)

struct ArrWirtMessung {
  int32_t slot;
  int64_t ziel;      // Kern-Sample, auf dem die Note klingen soll
  int64_t einsatz;   // erstes Sample des Einsatzes im Rückweg, −1: keiner
  int64_t vorhalt;   // Vorhalt beim Senden (2n + 25)
};

class ArrWirtSenke final : public ArrSenke {
 public:
  // zyklus_n und zyklus_s0 zeigen in den Kern: Größe und Anfang (Kern-Sample) des laufenden Zyklus.
  ArrWirtSenke(int slot, const int* zyklus_n, const int64_t* zyklus_s0) : slot_(slot), n_(zyklus_n), s0_(zyklus_s0) {}

  int64_t vorhalt() const noexcept override;
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int, int64_t) noexcept override {}   // der Wirt behält seinen Klang (Patch im Wirt, Spec 5)
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  // Fix F2: spielt keine Spur den Slot mehr, All Notes Off (CC 123) und im nächsten Block der Rückweg ausgeblendet
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;

  void zyklus_anfang() noexcept {   // Kern::zyklus, vor arr_nachreichen() und dem Einsortieren
    achse();
    midi_.leer();
  }
  void rueck(const float* l, const float* r) noexcept {
    rl_ = l;
    rr_ = r;
  }
  const MidiAus& midi() const { return midi_; }
  bool messung_holen(ArrWirtMessung& m) noexcept { return mess_.hole(m); }   // nur ein Leser (Hauptfaden)
  int64_t rueck_unendlich() const { return unendlich_; }

 private:
  void schreibe(int64_t ziel, uint8_t st, uint8_t d1, uint8_t d2) noexcept;
  void achse() noexcept;   // Fix F7: springt die Zeitachse zurück (/k/set/neu), offene Messungen der alten verwerfen
  void messen(const float* x, int64_t s0, int m) noexcept;

  int slot_;
  const int* n_;
  const int64_t* s0_;
  MidiAus midi_;
  const float* rl_ = nullptr;
  const float* rr_ = nullptr;
  int64_t letzter_s0_ = -1;
  int64_t zeit_ = -1;          // Fix F7: zuletzt gesehener Zyklusanfang (Kern-Sample)
  bool ausblenden_ = false;   // Fix F2: der nächste block() blendet den Rückweg linear auf 0 aus
  int64_t unendlich_ = 0;
  float mess_puf_[ARR_BLOCK] = {};
  int64_t offen_[ARR_A4_OFFEN] = {};
  int n_offen_ = 0;
  int64_t still_ = ARR_A4_STILLE;
  SpscRing<ArrWirtMessung, 64> mess_;
};

}  // namespace cdj
