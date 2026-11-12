// Stellwerk-RT: Regler-Tabelle nach INTERFACES §1.5 (Pfade, Einheiten, Bereiche, Vorgaben, Schaltrampen, Wer darf)
// und Standard-Kurven der Hand nach §7.2. Dazu je Deck der Halter-Eintrag `deck/<n>/transport` (§7.3 Punkt 5, §5.9
// /e/halter); er hat keinen Wert und ist kein Regler für /k/teil. Wird einmal außerhalb des Callbacks gebaut, danach
// nur gelesen.
#pragma once
#include <cstdint>

namespace cypherdj::stellwerk {

constexpr int MAX_REGLER = 4096;   // 2026-10-11: 384 → 512 für komp/* je Quellkanal (98 Regler); 2026-10-20 (E1): 512 → 1024, Deckel
                                   // für 32 Spuren (564 Regler), gemessen: Median und p99,9 des Zyklus unverändert
                                   // (~/messungen/2026-10-20-e1-deckel/BERICHT.md). CDJ_Z_REGLER (state.h) muss mit.
                                   // 2026-11-03 (1.15 A1a): 1024 -> 2048, room for the 96 insert controls of slice 4 plus margin; cost measured (A0).
                                   // 2026-11-11 (arr-bk): 2048 -> 4096. The bk insert pool (8 stages x 9 rows = 72) took the table to 2036 rows and left 12; the check demands 44.
                                   // CDJ_Z_REGLER and the state file version move with it (state.h). Memory and cycle cost: ~/messungen/2026-11-10-kanban-vor-welle1/arr-bk.md.
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
  pm_fader,                                    // 1.10 Slice 1: Fader des Produktions-Masters, pm/fader
  bk_regler,                                   // S5r: Graph-Regler je Kanal, <kanal>/bk/<1..64> (1..8 am Tabellenende, 9..32 hinter den Insert-Zeilen, 33..64 dahinter), am Ende angehängt
  // 1.10 Slice 3 (appended after bk_regler: the order of the roles stays). Sends are post fader, hall values are normalised 0..1.
  snd_spur, snd_grp,                           // spur/<n>/send/<r>, grp/<n>/send/<r>: send level in dB to return r
  ret_fader, ret_pan, ret_mute, ret_solo,      // ret/<r>/{fader,pan,mute,solo}
  ret_hall_an, ret_hall_pre, ret_hall_decay, ret_hall_groesse, ret_hall_tief, ret_hall_highcut, ret_hall_fahne,  // ret/<r>/hall/*
  // 1.15 A1b (mix tools, appended after ret_hall_fahne: the order of the roles stays). One role for all per-channel tool rows
  // (the suffix table in tool_controls.h tells which tool and field), one for the global spectrum source.
  werkzeug,          // <k>/gate/*, <k>/util/*, bus/<n>/mb/*, bus/<n>/lim/*
  spektrum_kanal,    // spektrum/kanal: source channel of the one spectrum analyser (global, steps)
  // 1.10 slice 4a T1 (appended after spektrum_kanal: the order of the roles stays). The compressor insert ins/komp/<n>/<parameter>, global rows;
  // the vocabulary is docs/interfaces/insert_module.json (generated rows: src/insert_zeilen.inc).
  ins_komp_an, ins_komp_schwelle, ins_komp_ratio, ins_komp_knie, ins_komp_attack,
  ins_komp_release, ins_komp_makeup, ins_komp_mix, ins_komp_schp, ins_komp_sc,
  // 1.10 slice 4b T12 (appended after ins_komp_sc: the order of the roles stays). The EQ insert ins/eq/<n>/{an,out,propq} and ins/eq/<n>/b<1..8>/<parameter>
  // (one role per parameter NAME; the band number is read from the path), and the saturator insert ins/saett/<n>/{an,drive,out,mix}.
  ins_eq_an, ins_eq_out, ins_eq_propq,
  ins_eq_b_an, ins_eq_b_typ, ins_eq_b_freq, ins_eq_b_gain, ins_eq_b_q, ins_eq_b_steil, ins_eq_b_platz,
  ins_saett_an, ins_saett_drive, ins_saett_out, ins_saett_mix,
  // 1.10 slice 4c T15 (appended after ins_saett_mix: the order of the roles stays). The rack macros rack/<k>/m1..m4, k = 1..12 (0..1): one role per macro number.
  rack_m1, rack_m2, rack_m3, rack_m4,
  // Master limiter (appended after rack_m4: the order of the roles stays). The limiter insert ins/lim/<n>/{an,decke,abklingen}.
  ins_lim_an, ins_lim_decke, ins_lim_abklingen,
  // Plan 1.11 T4 (appended after ins_lim_abklingen: the order of the roles stays). The effect-host insert ins/host/<n>/an, n = 1..4 (a foreign plugin in a host process; no mapped parameter rows).
  ins_host_an,
  // arr-fx slice 1 (appended after ins_host_an: the order of the roles stays). The utility insert ins/utility/<n>/{an,breite,mono_unter,gain,balance}.
  ins_util_an, ins_util_breite, ins_util_mono_unter, ins_util_gain, ins_util_balance,
  // arr-bk slice 3 (appended after ins_util_balance). The Baukasten insert ins/bk/<n>/{an,k1..k8}.
  ins_bk_an, ins_bk_k1, ins_bk_k2, ins_bk_k3, ins_bk_k4, ins_bk_k5, ins_bk_k6, ins_bk_k7, ins_bk_k8,
  // 32-knob widening (appended after ins_bk_k8, still the last role: the order stays). ins/bk/<n>/k9..k32.
  ins_bk_k9, ins_bk_k10, ins_bk_k11, ins_bk_k12, ins_bk_k13, ins_bk_k14, ins_bk_k15, ins_bk_k16, ins_bk_k17, ins_bk_k18, ins_bk_k19, ins_bk_k20, ins_bk_k21, ins_bk_k22, ins_bk_k23, ins_bk_k24, ins_bk_k25, ins_bk_k26, ins_bk_k27, ins_bk_k28, ins_bk_k29, ins_bk_k30, ins_bk_k31, ins_bk_k32,
  // 64-knob widening (appended after ins_bk_k32, still the last role: the order stays). ins/bk/<n>/k33..k64.
  ins_bk_k33, ins_bk_k34, ins_bk_k35, ins_bk_k36, ins_bk_k37, ins_bk_k38, ins_bk_k39, ins_bk_k40, ins_bk_k41, ins_bk_k42, ins_bk_k43, ins_bk_k44, ins_bk_k45, ins_bk_k46, ins_bk_k47, ins_bk_k48, ins_bk_k49, ins_bk_k50, ins_bk_k51, ins_bk_k52, ins_bk_k53, ins_bk_k54, ins_bk_k55, ins_bk_k56, ins_bk_k57, ins_bk_k58, ins_bk_k59, ins_bk_k60, ins_bk_k61, ins_bk_k62, ins_bk_k63, ins_bk_k64
};
constexpr int BK_REGLER_N = 64;   // knobs of a Baukasten graph reachable through the table: <kanal>/bk/1..64, ins/bk/<n>/k1..k64 (engine: baukasten_dsp::REGLER)
constexpr int SPUR_REGLER_SPUREN = 32;   // D1 K1 (Spec 2.3): spur/<n>/{fader,pan,mute,solo}, n = 1..32 (E3)
constexpr int GRP_REGLER_GRUPPEN = 8;    // 1.10 (F1: eigene Plätze neben den 32 Spuren): grp/<n>/{fader,pan,mute,solo}, n = 1..8
// 1.10 slice 4a: the insert vocabulary of docs/interfaces/insert_module.json (all kinds, also those without table rows yet):
// number of paths and the i-th path (0 <= i < insert_vertrag_anzahl()). Each is at most 31 characters (ReglerDef::pfad).
int insert_vertrag_anzahl();
const char* insert_vertrag_pfad(int i);
// "spur/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0. Ersetzt die Ziffernarithmetik pfad[5] - '1' (E3).
int spur_nr(const char* pfad);
// "grp/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0; wie spur_nr
int grp_nr(const char* pfad);

constexpr int RET_REGLER_RETURNS = 4;    // 1.10 Slice 3: ret/<r>/..., r = 1..4 (own places next to the 32 tracks, decision F1)
constexpr int SND_REGLER = 4;            // spur|grp/<n>/send/<r>, r = 1..4 (one per return)
// "ret/<r>/<feld>" -> r (1..999, no leading zero), else 0; like spur_nr
int ret_nr(const char* pfad);
// "spur|grp/<n>/send/<r>" -> r (1..999, no leading zero), else 0. The track or group number is read by spur_nr / grp_nr.
int send_nr(const char* pfad);

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
