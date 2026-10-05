// Selbst-Wächter des Kerns (Scheibe 18, Plan-Befund B5): ein eigener kleiner Prozess neben dem Kern, der ihn mit SIGKILL
// tötet, wenn der Echtzeit-Zähler (w im Ring, SCHNITTSTELLEN §6.1) `ms` Millisekunden lang steht. Warum ein Prozess:
// ein angehaltener Kern (SIGSTOP) hält alle seine Fäden an, ein Wächter-Faden stünde mit. Warum überhaupt: systemd
// prüft WatchdogSec mit 250 ms Genauigkeit (sd-event), der Tod kam gemessen bis 450 ms nach dem Hänger, und so lange
// wartet die Notbahn daneben über die Kante mit (Stand 16, sigstop-kern). Der systemd-Watchdog bleibt als zweite Linie.
// Scharf erst, wenn der Zähler einmal gestiegen ist; *ende != 0 heißt geordnetes Ende (kein Kill). Stirbt der Kern,
// stirbt der Wächter mit (PR_SET_PDEATHSIG). Aufrufen, bevor Fäden existieren (vor jack_client_open).
#pragma once

#include <sys/types.h>

#include <cstddef>
#include <cstdint>

namespace cdj {

// Geteilte anonyme Seite zwischen Kern und Wächter: der Callback schreibt je Zyklus w, der Hauptfaden beim geordneten
// Ende ende = 1. Der Wächter hält sonst nichts vom Kern: den Ring gibt er nach dem fork frei (loesen), damit er nicht
// als zweiter Halter von /dev/shm/cypherdj/bus zählt (Prüfstand 16, RingWaechter; gemessen 2026-09-26 in der Querprobe).
struct WaechterSeite {
  uint64_t zaehler;
  int ende;
  int64_t scharf_ab;  // 2026-09-27: 0 = Ausgänge noch nicht verbunden; sonst mono_ns, ab dem der Wächter scharf werden darf.
                      // Paket 2 Slice 1: gilt vor jedem Kill. Kill bei Stillstand >= 300 ms (Karenz-Grenze, ab Beginn des
                      // Stillstands) oder >= Grenze ab max(Beginn, scharf_ab) (MINOR-5: ein Stillstand über das Karenz-Ende zählt
                      // erst ab dem Ende). Der Verbinder setzt es vor jack_connect, ein Port-Callback bei Graph-Änderungen.
};
WaechterSeite* waechter_seite() noexcept;  // nullptr bei Fehler
// zaehler und ende müssen in MAP_SHARED-Speicher liegen. loesen/n: eine Abbildung, die der Wächter sofort freigibt
// (der Ring), oder nullptr. scharf_ab (2026-09-27): nullptr = scharf ab der ersten Erhöhung (Scheibe 18); sonst erst,
// wenn *scharf_ab gesetzt und erreicht ist (main: nach dem Verbinden der Ausgänge plus Karenz, weil das Umbauen des
// Graphen an einer echten Karte den Zyklus gemessen 100,5 ms anhielt). Rückgabe: PID des Wächters, 0 bei ms <= 0
// (aus), -1 bei Fehler (fork).
pid_t starte_selbstwaechter(const uint64_t* zaehler, const int* ende, int ms, void* loesen = nullptr, size_t n = 0,
                            const int64_t* scharf_ab = nullptr) noexcept;

}  // namespace cdj
