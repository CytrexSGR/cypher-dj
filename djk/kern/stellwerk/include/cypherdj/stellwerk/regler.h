// Stellwerk-RT: Regler-Tabelle nach SCHNITTSTELLEN §1.5 (Pfade, Einheiten, Bereiche, Vorgaben, Schaltrampen, Wer darf)
// und Standard-Kurven der Hand nach §7.2. Dazu je Deck der Halter-Eintrag `deck/<n>/transport` (§7.3 Punkt 5, §5.9
// /e/halter); er hat keinen Wert und ist kein Regler für /k/teil. Wird einmal außerhalb des Callbacks gebaut, danach
// nur gelesen.
#pragma once
#include <cstdint>

namespace cypherdj::stellwerk {

constexpr int MAX_REGLER = 384;
constexpr int MAX_KANAELE = 20;     // deck/1..4, erz/1..8, pad/1..2, bus/1..4, master, cue

enum class Rolle : uint8_t {
  fader, trim, eq_tief, eq_mitte, eq_hoch, kill_tief, kill_mitte, kill_hoch, filter, send, ziel,
  stem_drums, stem_bass, stem_vocals, stem_other, xseite, pfl,
  xfader, master_pegel, cue_mix, cue_pegel, cue_split, fx_notenwert, fx_rueckkopplung, fx_rueckweg, transport,
  duck_tiefe, duck_release, master_kleber,  // K2: am Ende angehängt, die Reihenfolge der Rollen bleibt
  keylock                                   // Keylock Task 3: globaler Schalter für alle Quellen, am Ende angehängt
};

// §7.2 kurve.typ plus zwei Formen für Schalter und Stufenregler (Festlegung dieser Scheibe)
enum class KurvenTyp : uint8_t { fader_db, linear, schalter, stufen };
struct Kurve {
  KurvenTyp typ;
  float min, max;
  bool kill_unter_min;   // §7.2: ganz unten stumm
};

struct ReglerDef {
  char pfad[32];
  int8_t kanal;          // Kanal-Index oder -1 (global)
  int8_t deck;           // 1..4 bei stem/* und transport, sonst 0
  Rolle rolle;
  float min, max, vorgabe;
  int32_t schalt_samples;  // Schaltrampe bei dauer_beats = 0; 0 = sofort
  bool nur_hand;         // §1.5 "Wer darf"
  bool db;               // Pegel in dB mit Stumm-Regel §1.2
  bool keine_rampe;      // nur Setzen erlaubt (Schalter, Stufen, Notenwert)
  bool ganzzahlig;       // Wert muss ganz sein (Schalter, ziel, xseite)
  bool transport;        // deck/<n>/transport: nur Halter, kein Wert, kein /k/teil
  Kurve kurve;           // Standard-Kurve der Hand
};

class ReglerTabelle {
 public:
  ReglerTabelle();
  int anzahl() const { return n_; }
  const ReglerDef& def(int r) const { return def_[r]; }
  int suche(const char* pfad) const;              // -1, wenn unbekannt
  int kanaele() const { return n_kanal_; }
  const char* kanal_name(int k) const { return kanal_[k]; }
  int kanal_suche(const char* name) const;        // "deck/1" -> Index, -1 wenn unbekannt
  int regler_von(int kanal, Rolle rolle) const;   // -1, wenn der Kanal diesen Regler nicht hat
  static float zu_x(const Kurve& k, float wert);  // Wert -> Stellung 0..1
  static float aus_x(const Kurve& k, float x);    // Stellung 0..1 -> Wert
 private:
  ReglerDef def_[MAX_REGLER];
  int n_ = 0;
  int16_t sortiert_[MAX_REGLER];
  char kanal_[MAX_KANAELE][12];
  int n_kanal_ = 0;
};

}  // namespace cypherdj::stellwerk
