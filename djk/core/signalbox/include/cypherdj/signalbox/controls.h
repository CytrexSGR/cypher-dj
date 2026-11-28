// Stellwerk-RT: Regler-Tabelle nach INTERFACES §1.5 (Pfade, Einheiten, Bereiche, Vorgaben, Schaltrampen, Wer darf)
// und Standard-Kurven der Hand nach §7.2. Dazu je Deck der Halter-Eintrag `deck/<n>/transport` (§7.3 Punkt 5, §5.9
// /e/halter); er hat keinen Wert und ist kein Regler für /k/teil. Wird einmal außerhalb des Callbacks gebaut, danach
// nur gelesen.
#pragma once
#include <cstdint>

namespace cypherdj::stellwerk {

constexpr int MAX_REGLER = 24576;   // 2026-10-11: 384 → 512 für komp/* je Quellkanal (98 Regler); 2026-10-20 (E1): 512 → 1024, Deckel
                                   // für 32 Spuren (564 Regler), gemessen: Median und p99,9 des Zyklus unverändert
                                   // (~/messungen/2026-10-20-e1-deckel/BERICHT.md). CDJ_Z_REGLER (state.h) muss mit.
                                   // 2026-11-03 (1.15 A1a): 1024 -> 2048, room for the 96 insert controls of slice 4 plus margin; cost measured (A0).
                                   // 2026-11-11 (arr-bk): 2048 -> 4096. The bk insert pool (8 stages x 9 rows = 72) took the table to 2036 rows and left 12; the check demands 44.
                                   // CDJ_Z_REGLER and the state file version move with it (state.h). Memory and cycle cost: ~/messungen/2026-11-10-kanban-vor-welle1/arr-bk.md.
                                   // 2026-11-20 (container core K2): 4096 -> 8192. 1024 rows strom/1..16/bk/1..64 arrive before the old strips leave (K9), so the table
                                   // holds 5076 rows in between and 4576 at the end; CDJ_Z_REGLER and CDJ_ZUSTAND_VERSION 4 -> 5 move with it.
                                   // strand 1 slice 3: 8192 -> 16384 for an EQ and a compressor per strip (96 + 96 pool slots); CDJ_Z_REGLER and
                                   // CDJ_ZUSTAND_VERSION 5 -> 6 move with it. Row indices stay below 32767, so the int16_t index arrays still hold them.
                                   // strand 1 slice 3b: 16384 -> 24576 for 128 tracks (18 278 rows with pools 160 + 160, gate, mb, 8 hosts and the rows of
                                   // tracks 33..128); CDJ_Z_REGLER moves with it, the state file version stays 6 (16384 was never shipped).
                                   // strand 2 slice 2: + 128 rows plug/<h>/k<m> at the end (18 406 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 5 slice 1: + 8 rows ins/saett/<n>/{kurve,decke} (18 414 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 5 slice 2: + 4160 rows ins/eq/<n>/d<m>/{dyn,schwelle,bereich} and ins/eq/<n>/{dyn_attack,dyn_release} (22 574 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 5 slice 3: + 472 rows: saett pool 4 -> 32 (168), ins/trans/1..32 (192), ins/bild/1..16 (112) (23 046 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 5 slice 4: + 160 rows ins/eq/<n>/sc (23 206 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 13 slice 1: + 320 rows ins/komp/<n>/{glue,auto} (23 526 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 13 slice 2: + 32 rows ins/saett/<n>/knie (23 558 rows); the ceiling, CDJ_Z_REGLER and the version stay.
                                   // strand 13 slice 4: + 80 rows ins/mb/<n>/u<m>/{schwelle,ratio,bereich} and ins/mb/<n>/sc (23 638 rows); the ceiling, CDJ_Z_REGLER and the version stay.
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
  ins_bk_k33, ins_bk_k34, ins_bk_k35, ins_bk_k36, ins_bk_k37, ins_bk_k38, ins_bk_k39, ins_bk_k40, ins_bk_k41, ins_bk_k42, ins_bk_k43, ins_bk_k44, ins_bk_k45, ins_bk_k46, ins_bk_k47, ins_bk_k48, ins_bk_k49, ins_bk_k50, ins_bk_k51, ins_bk_k52, ins_bk_k53, ins_bk_k54, ins_bk_k55, ins_bk_k56, ins_bk_k57, ins_bk_k58, ins_bk_k59, ins_bk_k60, ins_bk_k61, ins_bk_k62, ins_bk_k63, ins_bk_k64,
  // Live modules task 6 (appended after ins_bk_k64, now the last role: the order stays). grp/<n>/cue, n = 1..16: headphone cue of a group of the arrangement.
  grp_cue,
  // Production plan task 8 (appended after grp_cue, now the last role: the order stays). spur/<slot>/bk/<k>, slot 1..16, k 1..64 (32 until the 64-knob live override of 2026-11-16): a TRANSIENT override of knob k of the Baukasten instance
  // in that slot (slot = running number among the tracks with the device bk). Not saved in the state file and not restored (see Kern::abbild, regler_uebernehmen, wiederherstellen).
  spur_bk,
  // Loop deck K7a (appended after spur_bk, now the last role: the order stays). spur/<n>/filter, n = 1..32: DJ filter of an arrangement track, -1 (low-pass) .. +1 (high-pass), 0 is neutral and bit-neutral.
  spur_filter,
  // Loop deck channel strip KZ1 (appended after spur_filter, now the last role: the order stays). spur/<n>/eq/{tief,mitte,hoch}, n = 1..32: the 3-band isolator of an arrangement track, dB -200 (kill) .. +6, 0 is neutral.
  spur_eq_tief,
  spur_eq_mitte,
  spur_eq_hoch,
  // Container core K2 (appended after spur_eq_hoch, now the last role: the order stays). strom/<n>/bk/<k>, n = 1..16, k = 1..64: knob k of the Baukasten graph
  // on Erzeuger stream n. Global rows (channel -1); the stream, not a mixer channel, owns the graph.
  strom_bk,
  // Container core K7 (appended after strom_bk, now the last role: the order stays). spur/<n>/pfl (track into the cue sum, pre-fader), spur/<n>/trim (dB before the track strip), spur/<n>/kill/{tief,mitte,hoch}
  // (0/1, cuts one isolator band while 1, the stored eq value returns on release), n = 1..32.
  spur_pfl,
  spur_trim,
  spur_kill_tief,
  spur_kill_mitte,
  spur_kill_hoch,
  // Loop lane strip K1 (appended behind spur_kill_hoch, now the last role: the order stays). spur/<n>/fx/{1,2,3} (0/1): the track enters beat FX unit 1 / unit 2 / the FX 3 bus, n = 1..32.
  spur_fx_1,
  spur_fx_2,
  spur_fx_3,
  // Pool slice 4 (appended after spur_fx_3, now the last role: the order stays). The gate insert ins/gate/<n>/{an,schwelle,hysterese,ratio,bereich,attack,hold,release}
  // and the multiband insert ins/mb/<n>/{an,grenze_tief,grenze_hoch} and ins/mb/<n>/b<1..3>/{schwelle,ratio,attack,release,knie,makeup,umgehen} (one role per parameter NAME;
  // the band number is read from the path). The rows exist from task 4.1, the stages bind them from task 4.2.
  ins_gate_an, ins_gate_schwelle, ins_gate_hysterese, ins_gate_ratio, ins_gate_bereich, ins_gate_attack, ins_gate_hold, ins_gate_release,
  ins_mb_an, ins_mb_grenze_tief, ins_mb_grenze_hoch,
  ins_mb_b_schwelle, ins_mb_b_ratio, ins_mb_b_attack, ins_mb_b_release, ins_mb_b_knie, ins_mb_b_makeup, ins_mb_b_umgehen,
  // Strand 2 slice 2 (appended after ins_mb_b_umgehen, now the last role: the order stays). plug/<h>/k<m>, h = 1..8, m = 1..16: knob m of effect host h.
  // No consumer in the core: the page server forwards /e/hand moves of these rows to the plugin (the hostlernen pattern).
  plug_regler,
  // Strand 5 slice 1 (appended after plug_regler, now the last role: the order stays). The clip curve ins/saett/<n>/kurve (0 Tanh, 1 Soft clip,
  // 2 Hard clip) and the ceiling ins/saett/<n>/decke (dBFS -24..0) of a saturation stage.
  ins_saett_kurve, ins_saett_decke,
  // Strand 5 slice 2 (appended after ins_saett_decke, now the last role: the order stays). The dynamic EQ: per band ins/eq/<n>/d<m>/{dyn,schwelle,bereich}
  // (dyn 0 off, 1 above, 2 below, 3 above with key, 4 below with key; the band number is read from the path) and per stage ins/eq/<n>/{dyn_attack,dyn_release}.
  ins_eq_d_dyn, ins_eq_d_schwelle, ins_eq_d_bereich, ins_eq_dyn_attack, ins_eq_dyn_release,
  // Strand 5 slice 3 (appended after ins_eq_dyn_release, now the last role: the order stays). The transient shaper ins/trans/<n>/... and the
  // three-band imager ins/bild/<n>/... (pool kinds; the core binds them in slice 3 task 3.4).
  ins_trans_an, ins_trans_angriff, ins_trans_halten, ins_trans_tempo, ins_trans_out, ins_trans_mix,
  ins_bild_an, ins_bild_grenze_tief, ins_bild_grenze_hoch, ins_bild_breite_tief, ins_bild_breite_mitte, ins_bild_breite_hoch, ins_bild_mono_unter,
  // Strand 5 slice 4 (appended after ins_bild_mono_unter, now the last role: the order stays). The key of an EQ stage ins/eq/<n>/sc (0 = its own signal,
  // 1..128 = the input of that track before any chain, as ins_komp_sc); parameter 85 of the stage.
  ins_eq_sc,
  // Strand 13 slice 1 (appended after ins_eq_sc, now the last role: the order stays). The glue mode ins/komp/<n>/glue (stepped ratio, attack and
  // release of a bus compressor) and the auto release ins/komp/<n>/auto of a compressor stage (0/1); parameters 10 and 11 of the stage.
  ins_komp_glue, ins_komp_auto,
  // Strand 13 slice 2 (appended after ins_komp_auto, now the last role: the order stays). The knee of the Hard clip curve ins/saett/<n>/knie
  // (dB 0..12, 0 = the sharp corner); parameter 6 of a saett stage.
  ins_saett_knie,
  // Strand 13 slice 4 (appended after ins_saett_knie, now the last role: the order stays). The upward compression of multiband band m,
  // ins/mb/<n>/u<m>/{schwelle,ratio,bereich} (parameters 24 + (m - 1) * 3 + 0..2; ratio 1 = off), and the key of the stage ins/mb/<n>/sc
  // (0 = its own signal, 1..128 as ins_komp_sc; parameter 33).
  ins_mb_u_schwelle, ins_mb_u_ratio, ins_mb_u_bereich, ins_mb_sc
};
// strand 2 slice 2: plug/<h>/k<m>. The hosts are ARR_INS_HOST of arr_playback.h (8), which this library cannot include; the knob count is
// MAX_PLUGIN_REGLER of djk/ui/project/model.ts (16).
constexpr int REGLER_PLUG_HOSTS = 8;
constexpr int REGLER_PLUG_KNOEPFE = 16;
constexpr int STROM_BK_STROEME = 16;   // container core K2: strom/<n>/bk/<k>, n = 1..16 (ERZ_STROEME of generator.h), appended behind spur/32/eq/hoch, n outer, k inner
constexpr int SPUR_BK_SLOTS = 16;     // Baukasten slots of spur/<slot>/bk/<k>: one per bk track (8 until 2026-11-21, then = ARR_BK_MAX; static_assert in arr_playback.h)
constexpr int SPUR_BK_KNOEPFE = 64;   // knobs of a slot reachable as a live override: spur/<slot>/bk/1..64 (32 until 2026-11-16; production plan task 8)
// strand 1 slice 6: the tracks whose rows sit in the in-place blocks; tracks 33..SPUR_REGLER_SPUREN are in the trailing block
constexpr int SPUR_REGLER_SPUREN_ALT = 32;
constexpr int SPUR_EQ_N = SPUR_REGLER_SPUREN_ALT;       // the in-place block; tracks 33..128 are in the trailing block
constexpr int SPUR_FILTER_N = SPUR_REGLER_SPUREN_ALT;   // the in-place block; tracks 33..128 are in the trailing block
constexpr int BK_REGLER_N = 64;   // knobs of a Baukasten graph reachable through the table: <kanal>/bk/1..64, ins/bk/<n>/k1..k64 (engine: baukasten_dsp::REGLER)
constexpr int SPUR_REGLER_SPUREN = 128;   // all tracks: spur/<n>/..., n = 1..128 (strand 1 slice 6; was 32)
constexpr int GRP_REGLER_GRUPPEN = 8;    // 1.10 (F1: eigene Plätze neben den 32 Spuren): grp/<n>/{fader,pan,mute,solo}, n = 1..8 (the rows inside the first 1258 hashed rows: this stays 8)
constexpr int GRP_REGLER_GRUPPEN_NEU = 8;   // nested groups, task 1: groups 9..16 are appended at the end of the table (no index moves)
constexpr int GRP_REGLER_GRUPPEN_ALLE = GRP_REGLER_GRUPPEN + GRP_REGLER_GRUPPEN_NEU;   // 16 = ARR_GRUPPEN
// 1.10 slice 4a: the insert vocabulary of docs/interfaces/insert_module.json (all kinds, also those without table rows yet):
// number of paths and the i-th path (0 <= i < insert_vertrag_anzahl()). Each is at most 31 characters (ReglerDef::pfad).
int insert_vertrag_anzahl();
const char* insert_vertrag_pfad(int i);
// "spur/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0. Ersetzt die Ziffernarithmetik pfad[5] - '1' (E3).
int spur_nr(const char* pfad);
// "grp/<n>/<feld>" -> n (1..999, ohne führende Null), sonst 0; wie spur_nr
int grp_nr(const char* pfad);

constexpr int RET_REGLER_RETURNS_ALT = 4;   // 1.10 Slice 3: the returns ret/1..4 sit inside the first hashed rows; K6 appends ret/5..8 at the table end (no index moves)
constexpr int RET_REGLER_RETURNS = 8;    // ret/<r>/..., r = 1..8 (own places next to the 32 tracks, decision F1; 8 since container core K6)
constexpr int SND_REGLER = 8;            // spur|grp/<n>/send/<r>, r = 1..8 (one per return)
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
static_assert(MAX_REGLER - 1 <= INT16_MAX, "sortiert_ and the other row index arrays are int16_t");

}  // namespace cypherdj::stellwerk
