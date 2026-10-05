// Kern-Neustart und Betrieb (Scheibe 18, ADR 016 Entscheidung 4, SCHNITTSTELLEN §4.1, §6.3): was das Hauptprogramm
// an fünf Stellen aufruft.
//   1. starte()             nach dem Anlegen des Kerns, vor jack_activate: Zustand öffnen, neuestes Fach lesen, Karte,
//                           Befehle, Klick und Generation in den Kern übernehmen, Anker merken. Ohne gültiges Fach:
//                           der Kern beginnt wie in Scheibe 08 (Sample 0, Generation 0).
//   2. netz_anschliessen()  vor dem Netz-Faden: Abonnenten-Fächer verbinden, gespeicherte Abonnenten übernehmen.
//   3. zyklus_anfang()      im Callback vor kern.zyklus(): im ersten Zyklus einer fortgesetzten Generation das
//                           Kern-Sample auf den Anker setzen und /e/neustart als erstes Ereignis melden.
//   4. zyklus_ende()        im Callback nach kern.zyklus(): Anker, Karte, Befehle, Klick ins Echtzeit-Fach.
//   5. warte_erster_zyklus(), dann READY=1, dann der Netz-Faden; zyklen() für den Wachhund.
// zyklus_anfang() und zyklus_ende() sind echtzeitfest (keine Allokation, keine Sperre, kein Systemaufruf).
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>

#include "cypherdj/anker.h"
#include "cypherdj/kern.h"
#include "cypherdj/netz.h"
#include "cypherdj/zustand_datei.h"

namespace cdj {

struct Wiederaufnahme {
  bool datei_ok = false;     // Zustandsdatei offen und gesperrt
  bool fortgesetzt = false;  // gültiges Fach übernommen: Generation + 1, Fortsetzung auf dem Anker
  int32_t generation = 0;
  uint64_t stand = 0;        // Stand des gelesenen Echtzeit-Fachs (0: keines)
  int n_segmente = 0;
  int n_befehle = 0;
  int n_abonnenten = 0;
  std::string meldung;
};

class Betrieb {
 public:
  Betrieb();
  // ohne_zustand: Prüfschalter für den Fehlerfall (Kern verhält sich beim Neustart wie in Scheibe 08).
  Wiederaufnahme starte(const std::string& pfad, Kern& kern, bool ohne_zustand = false);
  void netz_anschliessen(Netz& netz, int64_t jetzt_ns);
  void zyklus_anfang(uint32_t frames, int64_t mono_ns, Kern& kern) noexcept;
  void zyklus_ende(uint32_t frames, int64_t mono_ns, uint32_t n, const Kern& kern) noexcept;
  // Nicht-Echtzeit: true, sobald der erste Zyklus gelaufen ist; wartet höchstens max_ms.
  bool warte_erster_zyklus(int max_ms) const;
  uint64_t zyklen() const { return zyklen_.load(std::memory_order_relaxed); }
  const Fortsetzung& fortsetzung() const { return fort_; }  // gültig nach dem ersten Zyklus
  bool fortgesetzt() const { return fortsetzen_; }

 private:
  ZustandDatei datei_;
  FachSchreiber<cdj_z_echtzeit> schreiber_;
  std::unique_ptr<cdj_z_echtzeit> puffer_;  // 123 KB: nicht auf den Stapel
  cdj_z_abos abos_{};
  int n_abos_ = 0;
  uint64_t abo_stand_ = 0;
  Anker anker_{};
  bool fortsetzen_ = false;
  bool erster_vorbei_rt_ = false;           // nur der Callback
  std::atomic<bool> erster_vorbei_{false};  // für die anderen Fäden
  std::atomic<uint64_t> zyklen_{0};         // schreibt nur der Callback
  Fortsetzung fort_{};
};

}  // namespace cdj
