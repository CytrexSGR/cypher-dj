// Stellwerk-RT: Regler-Tabelle nach SCHNITTSTELLEN §1.5 (Pfade, Einheiten, Bereiche, Vorgaben, Schaltrampen, Wer darf)
// und Standard-Kurven der Hand nach §7.2. Dazu je Deck der Halter-Eintrag `deck/<n>/transport` (§7.3 Punkt 5, §5.9
// /e/halter); er hat keinen Wert und ist kein Regler für /k/teil. Wird einmal außerhalb des Callbacks gebaut, danach
// nur gelesen.
#pragma once
#include <cstdint>

namespace cypherdj::stellwerk {

constexpr int MAX_REGLER = 1024;   // 2026-10-11: 384 → 512 für komp/* je Quellkanal (98 Regler); 2026-10-20 (E1): 512 → 1024, Deckel
                                   // für 32 Spuren (564 Regler), gemessen: Median und p99,9 des Zyklus unverändert
                                   // (~/messungen/2026-10-20-e1-deckel/BERICHT.md). CDJ_Z_REGLER (zustand.h) muss mit.
constexpr int MAX_KANAELE = 20;     // deck/1..4, erz/1..8, pad/1..2, bus/1..4, master, cue

enum class Rolle : uint8_t {
  fader, trim, eq_tief, eq_mitte, eq_hoch, kill_tief, kill_mitte, kill_hoch, filter, send, ziel,
  stem_drums, stem_bass, stem_vocals, stem_other, xseite, pfl,
  xfader, master_pegel, cue_mix, cue_pegel, cue_split, fx_notenwert, fx_rueckkopplung, fx_rueckweg, transport,
  duck_tiefe, duck_release, master_kleber,  // K2: am Ende angehängt, die Reihenfolge der Rollen bleibt
  keylock,                                  // Keylock Task 3: globaler Schalter für alle Quellen, am Ende angehängt
  master_pfl,                               // MASTER CUE (2026-10-10): Master auf die PFL-Seite des Kopfhörers
  color_art, color_param,                   // SOUND COLOR FX (2026-10-11): globale Art 0..5 und PARAMETER 0..1
  komp_an, komp_schwelle, komp_ratio, komp_attack, komp_release, komp_makeup, komp_mix,  // Kompressor je Quellkanal (2026-10-11)
  komp_sc,                                  // Schlüssel des Kompressors: 0 eigenes Signal, 1..14 Quellkanal + 1
  spur_fader, spur_pan, spur_mute, spur_solo,  // D1 K1: Spur-Regler des Arrangements, global (Kanal −1), spur/1..32
  grp_fader, grp_pan, grp_mute, grp_solo,      // 1.10 Slice 1: Gruppen-Regler des Arrangements, global (Kanal −1), grp/1..8
  pm_fader                                     // 1.10 Slice 1: Fader des Produktions-Masters, pm/fader
};
constexpr int SPUR_REGLER_SPUREN = 32;   // D1 K1 (Spec 2.3): spur/<n>/{fader,pan,mute,solo}, n = 1..32 (E3)
constexpr int GRP_REGLER_GRUPPEN = 8;    // 1.10 (F1: eigene Plätze neben den 32 Spuren): grp/<n>/{fader,pan,mute,solo}, n = 1..8
// "spur/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0. Ersetzt die Ziffernarithmetik pfad[5] - '1' (E3).
int spur_nr(const char* pfad);
// "grp/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0; wie spur_nr
int grp_nr(const char* pfad);

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
