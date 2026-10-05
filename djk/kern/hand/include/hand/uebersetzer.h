// Hand-Weg: übersetzt ein JACK-MIDI-Ereignis über das Mapping in eine Ausgabe für Stellwerk und Kern
// (SCHNITTSTELLEN §7.2, §7.3). Echtzeitfest: keine Allokation, keine Sperre, kein I/O; Nachschlagen über die feste
// Index-Tabelle des Mappings.
//
// §7.3 Punkt 1: jedes Ereignis wirkt am Sample seines Versatzes im Zyklus der Ankunft: sample = zyklus_s0 + versatz.
#pragma once
#include <cstddef>
#include <cstdint>

#include "hand/mapping.h"

namespace hand {

constexpr double SCHRITT_RELATIV = 1.0 / 127.0;   // eine Encoder-Raste in Stellungs-Einheiten (Festlegung F3)
constexpr double TEMPO_SCHRITT_BPM = 0.01;        // eine Raste des Tempo-Encoders (§7.3 Punkt 7)

enum class AusgabeArt : uint8_t {
  regler_absolut,     // x = Stellung 0..1 (wert / 127)
  regler_relativ,     // x = Rasten · SCHRITT_RELATIV, wert = Rasten
  regler_beruehrung,  // Berührungssensor berührt (§7.2 beruehrung)
  regler_umschalten,  // Taste an einem Schalter-Regler gedrückt: der Schalter wechselt
  deck,               // Deck-Aktion: wert = 1 Druck / 0 Loslassen (taste) oder Rasten (loop_laenge, nudge)
  tempo,              // Hand-Segment: wert = Rasten (je TEMPO_SCHRITT_BPM)
  taste               // taste/<name>: wert = 1 Druck / 0 Loslassen; autonomie 0..3; spielart, laenge, kiste_wahl Rasten
};

struct Ausgabe {
  AusgabeArt art;
  int16_t eintrag;    // Index in Mapping::eintrag
  int64_t sample;     // Sample, an dem das Ereignis wirkt
  float x;
  int32_t wert;
};

struct UebersetzerZaehler {
  uint64_t ereignisse = 0;   // alle übergebenen MIDI-Ereignisse
  uint64_t ausgaben = 0;
  uint64_t unbekannt = 0;    // Note oder CC ohne Eintrag im Mapping
  uint64_t ignoriert = 0;    // andere Statusbytes, zu kurz, Loslassen ohne Wirkung, relative 0
};

// Rasten eines relativen Encoders, vorzeichenrichtig (Festlegung F4):
//   zweierkomplement: 1..63 -> +1..+63, 64..127 -> -64..-1, 0 -> 0
//   versatz64:        wert - 64 (65 -> +1, 63 -> -1, 64 -> 0)
int32_t rasten(Kodierung k, uint8_t wert);

class Uebersetzer {
 public:
  explicit Uebersetzer(const Mapping* m) : m_(m) {}
  // Der Kern tauscht das Mapping nach /k/mapping zwischen zwei Zyklen (Zeiger aus dem Nicht-Echtzeit-Faden).
  void mapping(const Mapping* m) { m_ = m; }
  const Mapping* mapping() const { return m_; }

  // Ein Ereignis aus jack_midi_event_get: daten/groesse = buffer/size, versatz = time, n = Blocklänge des Zyklus,
  // zyklus_s0 = Kern-Sample des Blockanfangs. Rückgabe 1 mit Ausgabe in *aus, 0 ohne Wirkung.
  int ereignis(const uint8_t* daten, size_t groesse, int64_t zyklus_s0, uint32_t versatz, uint32_t n, Ausgabe* aus);

  const UebersetzerZaehler& zaehler() const { return z_; }

 private:
  const Mapping* m_;
  UebersetzerZaehler z_;
};

const char* name(AusgabeArt a);

}  // namespace hand
