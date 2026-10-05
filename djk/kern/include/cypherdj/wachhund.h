// Gesundheit an systemd (ADR 016 Entscheidung 2): READY=1 nach dem ersten Zyklus, WATCHDOG=1 nur bei
// Echtzeit-Fortschritt. sd_notify ohne libsystemd wie proben/10-robustheit-betrieb/src/minikern.c Z. 56 bis 60
// (SCHNITTSTELLEN §19.4). Läuft im Hauptfaden, nie im Callback. Scheibe 18.
#pragma once

#include <cstdint>

namespace cdj {

// Schickt `text` an $NOTIFY_SOCKET (auch abstrakte Adressen mit '@'). false: keine Variable oder Senden gescheitert.
bool sd_melde(const char* text) noexcept;

class Wachhund {
 public:
  // watchdog_usec aus $WATCHDOG_USEC (0: aus, dann schickt pruefe() nichts).
  explicit Wachhund(int64_t watchdog_usec) : usec_(watchdog_usec) {}
  static int64_t aus_umgebung();  // WATCHDOG_USEC oder 0
  // Abfragetakt: ein Viertel der Watchdog-Zeit (50 ms bei 200 ms), ohne Watchdog 100 ms.
  int64_t takt_us() const { return usec_ > 0 ? usec_ / 4 : 100000; }
  // Alle takt_us() aufrufen mit der Zahl der bisher gelaufenen Callbacks. Schickt WATCHDOG=1 genau dann, wenn sie seit
  // dem letzten Aufruf gestiegen ist. true: gemeldet.
  bool pruefe(uint64_t zyklen) noexcept;
  uint64_t gemeldet() const { return gemeldet_; }
  uint64_t ohne_fortschritt() const { return ohne_; }

 private:
  int64_t usec_;
  uint64_t letzte_ = 0;
  bool erste_ = true;
  uint64_t gemeldet_ = 0;
  uint64_t ohne_ = 0;
};

}  // namespace cdj
