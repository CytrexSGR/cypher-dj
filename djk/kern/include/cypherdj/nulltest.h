// Paket K3 (Spec D1 A7): Null-Test Live gegen Render. Beide Seiten sind ab dem Einsatz plus Limiter-Vorhalt ausgerichtet
// (Index 0 = Kern-Sample ursprung + vorhalt). Gemessen wird im ersten Durchlauf [0, frames − 480): die letzten 10 ms vor
// der Naht nicht (dort blendet live die Kurzblende, der Render läuft linear). Urteile:
//   bestanden: Restsignal-Spitze < −90 dBFS, Signal hörbar und die Selbstprüfung (Live um 1 Sample verschoben) rot;
//   rot:       Restsignal-Spitze ≥ −90 dBFS;
//   ungueltig: Stille (Signal-Spitze beider Läufe < −60 dBFS), Fenster zu kurz, Mitschnitt zu kurz, Blockphase ungleich,
//              Selbstprüfung grün (das Material sieht eine Verschiebung um 1 Sample nicht).
// Die Vorbedingungen (A7, 1.) prüft null_vorbedingungen() am Neustart-Fach des laufenden Kerns.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/zustand.h"

namespace cdj {

constexpr double NULL_SCHWELLE_DB = -90.0;   // Restsignal-Spitze darunter: bestanden (A7, 4.)
constexpr double NULL_STILLE_DB = -60.0;     // Signal-Spitze beider Läufe darunter: ungültig (A7, 5.)
constexpr int64_t NULL_NAHT_RAND = 480;      // 10 ms vor der Naht nicht gemessen (A7, 4.)

enum class NullUrteil { bestanden, rot, ungueltig };

struct NullErgebnis {
  NullUrteil urteil = NullUrteil::ungueltig;
  std::string ursache;         // ungueltig: stille, fenster, mitschnitt_zu_kurz, phase, selbstpruefung_gruen; rot: rest
  double rest_db = -200.0;     // Spitze von live − render im Fenster, dBFS
  double signal_db = -200.0;   // größere Spitze der beiden Läufe im Fenster, dBFS
  double verschoben_db = -200.0;   // Rest-Spitze mit Live um 1 Sample verschoben (Selbstprüfung)
  int64_t fenster = 0;         // Länge des Messfensters
  int64_t schlimmstes = -1;    // Index der größten Abweichung im Fenster
};

// live_* ab Kern-Sample ursprung + vorhalt (n_live Werte), ren_* ab dem Einsatz plus Vorhalt (n_ren Werte); frames =
// Länge des ersten Durchlaufs (bis − von) in Samples.
NullErgebnis null_vergleich(const float* live_l, const float* live_r, int64_t n_live, const float* ren_l,
                            const float* ren_r, int64_t n_ren, int64_t frames);

// Blockphase eines Einsatzes: (einsatz − grenze) mod quantum, immer 0..quantum − 1
int null_phase(int64_t einsatz, int64_t grenze, int quantum);

const char* null_urteil_text(NullUrteil u);

// A7, 1.: aus dem Neustart-Fach f: Decks leer, erz/1..3 und pad/1..2 Fader −200, kein Prüfklick, erz/4 neutral (Fader 0,
// sonst Vorgabe, pfl ausgenommen), keine Tempo-Rampe offen, wirksames Tempo konstant gleich bpm; metronom_an aus
// /zustand/arr. fx_master (Plan-Review K3): eine FX-Einheit hängt an master (/e/fx/zuweisung) und ist an oder seit weniger
// als 5 s aus (/e/fx, SSE-Anfangsbild); der Neustart-Zustand trägt keinen FX-Stand, der Render-Kern hat die FX aus, der
// Export nimmt FX-Einheiten nicht mit. Rückgabe: die Verstöße als Text, leer = erfüllt.
std::vector<std::string> null_vorbedingungen(const cdj_z_echtzeit& f, const cypherdj::stellwerk::ReglerTabelle& tab,
                                             double bpm, bool metronom_an, bool fx_master);

}  // namespace cdj
