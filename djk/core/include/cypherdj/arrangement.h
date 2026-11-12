// D1 K1 (Spec D1 2.2, 2.3, 2.6): Modul Arrangement im Kern. Spielt einen Wiedergabe-Schnappschuss (arr_playback.h)
// sample-genau auf der einen Uhr. Projekt-Beat p = Kern-Beat − ursprung + start_beat; ein Ereignis auf Projekt-Beat p
// liegt auf llround(sample_at(p + ursprung − start_beat)) (Konvention des Kerns). Teile: Transport mit Start-Regel,
// Quantisierung und Loop-Klammer (arrangement.cpp), Audio-Clip-Stimmen (arr_voices.cpp), Spur-Mixer spur/1..32, Gruppen grp/1..16 (die auch in Gruppen münden können) und Produktions-Master (1.10)
// (arr_output.cpp), Noten an Senken (arr_notes.cpp), Metronom (arr_metronom.cpp). Die Summe geht in den Eingang
// von erz/4. Echtzeit: außer Konstruktor und setze_*/sperre_* (vor dem Start) läuft alles im Callback: keine
// Allokation, keine Sperre, kein I/O.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_auto.h"
#include "cypherdj/arr_export_run.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_returns.h"
#include "cypherdj/arr_track_phase.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/spsc_ring.h"
#include "cypherdj/signalbox/controls.h"
#include "cypherdj/clock.h"
#include "cypherdj/warp_factory.h"

namespace cdj {

constexpr int ARR_BLOCK = 1024;         // größter Teilblock (= MIX_BLOCK; Kern::audio teilt danach)
static_assert(PDC_BLOCK_MAX == ARR_BLOCK, "ArrPdc::verzoegere() takes the longest block of the mixer");
static_assert(ARR_HOST_BLOCK == ARR_BLOCK, "ArrHostStufe::block() takes the longest block of the mixer");
constexpr int ARR_STIMMEN = 8 * ARR_SPUREN;    // gleichzeitig klingende Audio-Clips (fester Pool), je Spur wie bei 8 Spuren (E3)
constexpr int ARR_NAHT = 96;            // Kurzblende an Naht, Stopp und Tausch (2 ms, wie ERZ_AUS)
constexpr int ARR_EIN = 32;             // Kurz-Einblende beim Einstieg mitten in einen Clip (wie ERZ_EIN)
constexpr int ARR_STUMM_BLENDE = 480;   // Mute und Solo: 10 ms
constexpr int ARR_OFFEN = 32 * ARR_SPUREN;     // offene Noten (Off ausstehend), Liste fester Größe, je Spur wie bei 8 Spuren (E3)
constexpr int ARR_KLICK_LAENGE = 96;    // Metronom-Klick, Form wie der Prüfklick (click.h)
constexpr int ARR_ZIEL_BLENDE = 480;    // 1.10: Ziel-Wechsel einer Spur (master ↔ Gruppe) blendet über 10 ms
constexpr int ARR_PM = ARR_SPUREN + ARR_GRUPPEN;   // Streifen-Index des Produktions-Masters: 0..31 Spuren, 32..47 Gruppen, 48 PM
constexpr int ARR_RET0 = ARR_PM + 1;              // 1.10 Slice 3 (P2): the return strips follow the PM, no existing index moves
constexpr int ARR_STREIFEN = ARR_PM + 1 + ARR_RETURNS;
// Fields per strip: 0 fader (dB), 1 pan, 2 mute, 3 solo. Tracks and groups: 4..7 send to return 1..4 (dB). Returns: 4 hall on, 5..10 hall pre, decay, size, low, highcut, tail.
constexpr int ARR_FELDER = 11;
constexpr int ARR_F_SEND0 = 4;
// Live modules task 6: field 8 of a GROUP strip is its headphone cue switch (grp/<n>/cue). Groups use 0..3 and the sends 4..7, so 8 is free there (the return fields 8..10 belong to the return strips).
constexpr int ARR_F_CUE = 8;
static_assert(ARR_F_CUE >= ARR_F_SEND0 + ARR_RETURNS && ARR_F_CUE < ARR_FELDER, "the group cue field must not collide with the sends");
static_assert(ARR_KETTE_PM == ARR_PM && ARR_KETTE_RET0 == ARR_RET0 && ARR_KETTEN == ARR_STREIFEN, "the chain index is the strip index");
static_assert(ARR_BLOCK == INS_BLOCK, "the insert scratch buffers must match the block size");
static_assert(ARR_BLOCK == ARR_RET_BLOCK, "the return buffers must match the block size");
static_assert(ARR_BLOCK == INS_BLOCK && sizeof(ArrArbeit::rb_l) == sizeof(float) * ARR_BLOCK, "the per-lane scratch buffers must match the block size");
static_assert(sizeof(ArrArbeit::rack_l) == sizeof(float) * ARR_BLOCK && sizeof(ArrArbeit::kit_l) == sizeof(float) * ARR_BLOCK, "the rack and Kit lane scratch must match the block size");

// Wohin Noten gehen (Spec 2.4). K2 hängt die RB-FFI (intern) und die Wirt-Slots an, Tests eine Prüfsenke. Alle
// Methoden laufen im Callback: keine Allokation, keine Sperre, kein I/O.
class ArrSenke {
 public:
  virtual ~ArrSenke() = default;
  // Noten mit Ziel-Sample T kommen im Block an, der T − vorhalt() enthält (Wirt: Rundweg 2n; intern: 0).
  virtual int64_t vorhalt() const noexcept = 0;
  virtual void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept = 0;
  virtual void alle_aus(int spur, int64_t ziel) noexcept = 0;            // Stopp: All-Notes-Off der Spur
  virtual void transport_start(int spur, int64_t ziel) noexcept = 0;     // K2: Zustand zurücksetzen (RB-FFI, Spec 2.4)
  // Audio der Spur für [s0, s0 + m) in den Spur-Eingang addieren (RB rendert, Wirt-Rückweg kopiert)
  virtual void block(int spur, int64_t s0, int m, float* l, float* r) noexcept = 0;
  // Mehrkern slice 3.1: may block_bahn() of this track run on another lane at the same time as block_bahn() of another track? Only
  // sinks whose block touches nothing but the track's own state and the lane struct say true. Default false (serial, in order).
  virtual bool parallel_faehig(int spur) const noexcept {
    (void)spur;
    return false;
  }
  // Mehrkern slice 3.2: would block_bahn() of this track do no work at all (no sink state behind the slot)? A unit that does work counts as live load for the track
  // phase whatever the mixer does with its signal afterwards: mute and solo act in mischen, the sink computes the track either way. Default false.
  virtual bool leer(int spur) const noexcept {
    (void)spur;
    return false;
  }
  // The same as block(), with every piece of shared scratch taken from the lane struct `a`. Default: block(), ignoring `a`.
  virtual void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept {
    (void)a;
    block(spur, s0, m, l, r);
  }
  // Mehrkern slice 3 task 6b: work of a sink that touches the state of more than one track and so must not run inside a lane unit (the rack sink's abgaenge() of a new
  // snapshot). The Arrangement calls it on the caller at the start of phase Q, before any unit or serial track runs. true: it did work, the plan is rebuilt.
  virtual bool vor_phase(int64_t s0) noexcept {
    (void)s0;
    return false;
  }
  // Fix F2 (Spec 6.28): die Spur spielt ab s nicht mehr auf dieser Senke (Tausch: andere Art, anderer Slot, leer).
  // andere_spur: eine weitere Spur der neuen Wiedergabe spielt dieselbe Senke. Vorgabe: All-Notes-Off der Spur, wenn
  // keine weitere sie spielt. true: die Senke braucht für diese Spur noch einen block() (Ausblende), das Modul ruft ihn
  // im nächsten Block einmal.
  virtual bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept {
    if (!andere_spur) alle_aus(spur, s);
    return false;
  }
  // Automation slice 2 (E9): spur is the 0-based track index (as in block(i, ...)); the value of the `geraet` lane `param` (0..3 = ARR_GERAET_PARAM_NAME, normalised 0..1) of the track at the
  // project beat of the last RUNNING sample of the block, once per block and lane, before block() of the same block. No call in a block
  // without a running transport and for a track without that lane. Default: ignored (the host sink has no device parameters).
  virtual void auto_parameter(int spur, int param, float wert) noexcept {
    (void)spur;
    (void)param;
    (void)wert;
  }
  // 1.12 slice 5 (D9): a device parameter with a RELATIVE lane and no absolute one. `delta` is the relative lane at the same project beat as auto_parameter would use, in device units
  // (-1..1); the sink adds it to its own base value of the parameter (it knows the base, the core does not) and clamps to 0..1. An absolute lane with a relative one arrives stacked and
  // clamped through auto_parameter. Same call rules as auto_parameter (once per block and lane, before block(), none without a running sample). Default: ignored.
  virtual void auto_parameter_summand(int spur, int param, float delta) noexcept {
    (void)spur;
    (void)param;
    (void)delta;
  }
  // 1.9 U8 T9 (E12): a rack macro drives a parameter of member `glied` (0-based index) of the rack track `spur`. `param` is the index space of ArrGliedZiel (0..3 RB-338, 8..15 knobs,
  // 16 gain in dB), `wert` the real value (0..1, or dB). Called by the Arrangement on the caller thread once per block and target, before phase Q and before any block() of the
  // block, whether the transport runs or not; never from a lane unit. A sink that is no rack sink ignores it. Default: ignored.
  virtual void glied_parameter(int spur, int glied, int param, float wert) noexcept {
    (void)spur;
    (void)glied;
    (void)param;
    (void)wert;
  }
};

enum class ArrStatus : int32_t { steht = 0, wartet = 1, spielt = 2, freeze = 3 };

// Paket K3 (Spec D1 2.5, 3.1 /k/arr/freeze): ein Freeze ist ein Echtzeit-Durchlauf ab von_beat nach der Start-Regel mit
// ausgesetzter Loop-Klammer; das Spur-Signal vor dem Fader geht ab dem Einsatz-Sample (bis − von + ARR_FREEZE_NACHLAUF)
// Beats lang in daten. Der Arrangement-Lade-Faden legt den Auftrag samt Puffer an (Spec 6.29; nie der Callback, nie der
// Netz-Faden), der Kern gibt ihn genau einmal als Ereignis ARR_FREEZE zurück (Fix 2/P1: auch bei vollem Ereignisring,
// die Rückgabe wartet im Kern); der Netz-Faden reicht ihn an den Lade-Faden, der schreibt die Datei und gibt frei.
constexpr double ARR_FREEZE_NACHLAUF = 2.0;      // Beats nach bis_beat (Spec 3.1)
constexpr double ARR_FREEZE_MAX_BEATS = 256.0;   // bis − von höchstens: Puffer für 60 BPM rund 99 MB
struct ArrFreeze {
  int spur = 0;                    // 1..32 (ARR_SPUREN)
  int32_t kennung = 0;             // Datei <arr_ordner>/freeze-<spur>-<kennung>.f32
  double von_beat = 0.0, bis_beat = 0.0;
  std::vector<float> daten;        // 2 · kap Werte, L und R verschränkt
  int64_t kap = 0;                 // Frames
  int64_t start_s = -1;            // Kern-Sample des Einsatzes (p = von_beat)
  int64_t frames = 0;              // Länge ab start_s: (bis − von + Nachlauf) Beats
  int64_t ende_s = -1;             // Kern-Sample, an dem der Durchlauf endete (fertig oder abgebrochen)
  int32_t status = 0;              // 0 fertig, 1 abgebrochen
  // Fix 2/P1: nur der Kern-Faden, solange die Rückgabe auf Platz im Ereignisring wartet (Kern::freeze_melden); der Auftrag
  // ist dann sein eigener Listenknoten, darum wartet jede Rückgabe ohne Obergrenze und ohne Allokation
  ArrFreeze* rueck_naechster = nullptr;
  int32_t rueck_status = 0;        // Status des wartenden Ereignisses ARR_FREEZE (0, 1 oder ARR_FREEZE_ABGELEHNT)
};

// 1.10 slice 7 (T5, /k/arr/abgriff): the sibling of ArrFreeze for ONE point of ONE strip. art 0 track, 1 group, 2 return, 3 production master (PM);
// nr counts from 1 inside the kind (the PM: 1); punkt 0 pre (the strip input in front of its chain), 1 post (what the strip sends on to its target).
// daten (2 * kap values, L and R interleaved) is zero-filled or prefilled by the loader thread, never by the callback. The window is [start_s, start_s + frames):
// start_s is the first sample of the run shifted by the path latency of the tapped point (abgriff_ankunft), frames = the range length exactly, no tail. The hand-over
// is the one of ArrFreeze: the kern returns the job exactly once as event ARR_ABGRIFF (status published with the event ring's release/acquire), the load thread writes
// the file and frees the buffer.
struct ArrAbgriff {
  int art = 0, nr = 1, punkt = 1;
  int32_t kennung = 0;             // file <arr_ordner>/abgriff-<art>-<nr>-<kennung>.f32
  double von_beat = 0.0, bis_beat = 0.0;
  std::vector<float> daten;
  int64_t kap = 0;                 // frames
  int64_t start_s = -1;            // core sample of the first captured frame (onset + arrival)
  int64_t frames = 0;              // length from start_s
  int64_t ende_s = -1;             // core sample at which the run ended (done or aborted)
  int32_t status = 0;              // 0 done, 1 aborted
  ArrAbgriff* rueck_naechster = nullptr;   // kern thread only, while the return waits for room in the event ring (as ArrFreeze)
  int32_t rueck_status = 0;
};
constexpr int32_t ARR_ABGRIFF_ABGELEHNT = 3;   // event ARR_ABGRIFF of a refused job (the receipt 6 came already): free only

struct ArrZustand {                     // /zustand/arr (INTERFACES §5.13)
  int64_t nr;                          // −1 ohne Schnappschuss
  ArrStatus status;
  bool loop_an;
  double projekt_beat;
  int64_t ursprung_sample;              // Kern-Sample des Transport-Starts (p = start_beat im ersten Durchlauf), −1 ohne
  double start_beat;
  bool metronom_an;
};

// 1.12 slice 3 (D6): a state change of the lane override of one track field, for the net thread (task 3). zustand 1: the lane is overridden, 0: it plays again
// (re-enabled, or the lane is gone). spur is the 0-based track index, feld the mixer field 0..3 (fader, pan, mute, solo), sample the core sample of the change.
struct ArrAutoEreignis {
  int16_t spur;
  int8_t feld;
  int8_t zustand;
  int64_t sample;
};

// 1.12 S3 (§4.11 /k/arr/auto, §5.13 /e/auto): OSC counts the tracks 1..32 (0 = all), the Arrangement 0..31. The ONE place of that conversion; the field names live in the
// generated list v::werte::auto_ziel (index = field 0..3, see AUTO_FELDER), nowhere else in C++.
inline constexpr int auto_spur_index(int osc_spur) { return osc_spur - 1; }
inline constexpr int auto_spur_osc(int index) { return index + 1; }

struct ArrPruefZugang;   // nur Tests (test_warp_werk_folgen): liest Spur-Busse und Stimmen, schreibt nichts

class Arrangement {
 public:
  static constexpr int AUTO_FELDER = 4;   // the overridable fields of a track: fader, pan, mute, solo (the names: v::werte::auto_ziel)
  // mit_hall false (test seam, tests without return strips only): the four return Halls are not built (each costs about 1.5 ms of FFT
  // plans, measured 2026-11-01); a return then passes its dry signal only and never computes a wet one
  explicit Arrangement(const cypherdj::stellwerk::ReglerTabelle& tab, bool mit_hall = true);

  // ---- Senken (K2: RB-FFI für alle internen Spuren, je Wirt-Slot eine); nicht im Callback, vor dem Start
  // 1.10 T9 (AK24): render-only key mask. Strip index as in w_ (track, group, PM, return). ziel_aus: the strip adds nothing into its target; sends_aus: nothing into its sends.
  // The key capture points are not masked. Called by the render before block 0 only, never live: nur_schl_ stays false there and block() takes one predictable branch per strip.
  void setze_nur_schluessel(int streifen, bool ziel_aus, bool sends_aus) {
    if (streifen < 0 || streifen >= ARR_STREIFEN) return;
    nur_ziel_aus_[streifen] = ziel_aus;
    nur_sends_aus_[streifen] = sends_aus;
    nur_schl_ = true;
  }
  // 1.10 T10 (AK24): render-only dry-out, the sibling of the mask above and the same branch: every track that targets the master and every group adds nothing into the master
  // (a track that targets a group keeps feeding it, the group's sends need the signal); the sends stay live. Called by the render before block 0 only, never live.
  void setze_trocken_aus() {
    trocken_aus_ = true;
    nur_schl_ = true;
  }
  void setze_senke_intern(ArrSenke* s) { senke_intern_ = s; spur_plan_gueltig_ = false; }
  void setze_senke_wirt(int slot, ArrSenke* s) {
    if (slot >= 1 && slot <= ARR_WIRT_SLOTS) senke_wirt_[slot - 1] = s;
    spur_plan_gueltig_ = false;
  }
  void setze_senke_rack(ArrSenke* s) { senke_rack_ = s; spur_plan_gueltig_ = false; }   // 1.9 U6: the sink of the instrument-rack tracks (ArrArt::rack)
  void sperre_metronom(bool ja) { metronom_gesperrt_ = ja; }   // Prüfmodus und Render: das Metronom klingt nie

  // ---- Befehle, im Callback am Blockanfang s
  // Tauscht den Schnappschuss und gibt den alten zurück (Freigabe im Netz-/Lade-Faden, nie im Callback).
  const ArrSnapshot* tausche(const ArrSnapshot* neu, int64_t s, const Karte& k);
  // Start nach der Start-Regel (Spec 2.2): Einsatz frühestens am ersten Quant-Punkt ≥ s + vorhalt + n. quant 0 sofort,
  // 1 nächster Kern-Beat, 2 Takt mit (Kern-Beat − start_beat) ≡ 0 mod 4. Ein laufender Transport endet bei s mit
  // Kurzblende. false: kein Schnappschuss geladen.
  // 1.8 S4a (D7): vorzaehl_beats > 0 is the count-in. The entry moves that many CORE beats behind the first quant point (ursprung_ = kb + vorzaehl_beats), the status is
  // wartet until then, and while it waits the metronome clicks on the core beats kb .. kb + vorzaehl_beats - 1 (accent on the first of each bar), also with the switch off.
  // 0 (the default) is byte-identical to the code before the parameter (test_arr_start_golden).
  bool start(double start_beat, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k, int vorzaehl_beats = 0);
  // Stopp: 0 sofort (bei s), 1 nächster Projekt-Beat, 2 nächster Projekt-Takt; liegt die Naht davor, an der Naht.
  void stopp(int quant, int64_t s, const Karte& k);
  // Loop-Klammer, am Blockanfang s; bis − von ≥ 1 prüft der Aufrufer
  void loop(bool an, double von, double bis, int64_t s, const Karte& k);
  void ki_stopp(int64_t s, const Karte& k);                  // E-a: beendet bei s einen wartenden Start und den Freeze von cypher, keinen laufenden Transport
  void metronom(bool an, float pegel_db, int ziel);          // ziel 0 master (vor dem Limiter), 1 cue (PFL-Summe)

  // ---- 1.12 slice 3, lane override (D1, D2, D5, D6, D7). All in the callback thread; spur is the 0-based track index, feld the field 0..3.
  // auto_uebersteuern(an = true): from `sample` on the hand (the Stellwerk course) plays instead of the lane, fader and pan through the 480 source blend, mute and solo
  // jump. an = false: the lane plays again, blend back. An override only STARTS while the transport plays (D5); the re-enable works also while stopped (D6: the
  // state is cleared, no blend, nothing plays). Both need a lane for the field and do nothing (false) when the state does not change. The override lives here only:
  // it survives stop, start and a snapshot swap that keeps the lane; deleting the lane clears it. Up to two changes of one field in one block are exact
  // (each starts its own blend from the value that is audible at its sample); a third in the same block takes the first two as already passed.
  bool auto_uebersteuern(int spur, int feld, bool an, int64_t sample);
  bool auto_lane_da(int spur, int feld) const;                // the playback has a lane for the field (the re-report of the core asks it)
  bool auto_uebersteuert(int spur, int feld) const { return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER && auto_ueber_[spur][feld]; }
  // true if auto_uebersteuern(an = true) would take effect now (transport plays, lane present, not yet overridden)
  bool auto_kann_uebersteuern(int spur, int feld) const;
  void auto_alle_freigeben(int64_t sample);                 // re-enable every overridden field (blend while the transport plays)
  // 1.12 S3 (D12): the project beat at Kern sample s, for a sample inside the block about to be played. Unlike projekt_beat it knows the loop seam: a sample at or behind the
  // seam of the running pass gets the origin of the NEXT pass, because arr_->block moves the origin only when it reaches the seam. Computed at the grip, never again later.
  double projekt_beat_bei(const Karte& k, int64_t s) const;
  // 1.8 S4a.3 (D8): the recording starts on a project bar inside a running transport. sample_bei_projekt_beat: the Kern sample at which project beat p sounds, counted from
  // the pass that runs at s_ref (INT64_MIN: the current origin; a s_ref at or behind the seam of the running pass counts from the next pass, like projekt_beat_bei).
  // naht_bei: the Kern sample of the seam that ends the pass running at s_ref (-1 without a loop bracket or when the transport does not play).
  int64_t sample_bei_projekt_beat(const Karte& k, double p, int64_t s_ref = INT64_MIN) const;
  int64_t naht_bei(const Karte& k, int64_t s_ref = INT64_MIN) const;
  float auto_letzter_wert(int spur, int feld) const;        // the value the lane played last (dB for the fader, pan units for pan, 0/1)
  // Event ring (SpscRing, 1024 slots: auto_tausch plus auto_alle_freigeben report up to 128 fields each in one cycle). Producer: the callback thread. Consumer: ONE thread.
  // A full ring drops the NEW event and counts it (auto_ereignis_verloren). The state itself is never lost: auto_uebersteuert() is the truth. It is a plain read, so it is
  // valid in the callback thread only; a reader that sees the drop counter rise rebuilds the full state there (task 3: the core re-reports every overridden field).
  bool auto_ereignis_holen(ArrAutoEreignis& e) { return auto_ev_.hole(e); }
  uint32_t auto_ereignis_verloren() const { return auto_ev_verloren_.load(std::memory_order_relaxed); }
  // Pickup source for the Stellwerk (D2, Task-1 condition 1): true once per override start, for the first applied hand step; false while overridden
  bool auto_lane_wert(int regler, float& wert);
  int auto_regler(int spur, int feld) const { return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER ? spur_regler_[spur][feld] : -1; }
  bool auto_spielt() const { return status_ == ArrStatus::spielt; }
  // true if the lane of the field has played in the last block, i.e. auto_letzter_wert is a real lane value (same condition auto_lane_wert applies)
  bool auto_gespielt(int spur, int feld) const { return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER && auto_war_[spur][feld]; }

  // ---- Spur-Regler spur/<n>/{fader,pan,mute,solo}, Werte je Sample aus dem Stellwerk
  void setze_sofort(int regler, float wert);                 // Start, Neustart-Zustand (nicht während eines Blocks)
  void verlauf(int regler, const float* werte);              // gültig bis zum Ende des nächsten block()

  // ---- ein Teilblock [s0, s0 + m), m <= ARR_BLOCK. Addiert die Summe in aus_l/aus_r (Eingang erz/4, ab Slice 5),
  // das Metronom in metro_master_* (Master-Summe vor dem Limiter) oder metro_cue_* (PFL-Summe, ab Slice 7).
  void block(const Karte& k, int64_t s0, int m, float* aus_l, float* aus_r, float* metro_master_l,
             float* metro_master_r, float* metro_cue_l, float* metro_cue_r);

  // ---- 1.8 S3 (R10): monitoring of an external input. The core hands the pointers of the input pair of an armed track (already offset to the sub-block) before every
  // block(); they are valid for the next block() only and cleared by it. spur0: 0-based track. l/r nullptr = no port = silence (both nullptr: nothing is added).
  // modus (D14): 0 stereo, 1 links, 2 rechts, 3 summe. monitor: 0 aus, 1 auto, 2 ein. aufnahme_laeuft: a take is recording (auto monitors then). The input is added into the
  // track bus AFTER the insert chain and the PDC delay of the track (1.8 T1, slice 3b-lite: the dry monitor has no latency of the chains) and before the fader, so fader, pan, mute
  // and solo take effect. nullptr/nullptr clears the track.
  void monitor_quelle(int spur0, const float* l, const float* r, int modus, int monitor, bool aufnahme_laeuft) noexcept {
    if (spur0 < 0 || spur0 >= ARR_SPUREN) return;
    MonQuelle& q = mon_[spur0];
    q.l = l;
    q.r = r;
    q.modus = static_cast<int8_t>(modus);
    q.monitor = static_cast<int8_t>(monitor);
    q.aufnahme = aufnahme_laeuft;
  }
  // ---- 1.10 slice 5 U2b: DJ sources of a sidechain key (plan E2, E6, E7). Before block() of the same cycle the kernel hands the inputs of the production mixer: l[i], r[i] for i = 0..3
  // are deck/1..4, i = 4 is erz/1 (the Strudel share: a host return into erz/1 is added after the block and is not in it). The pointers are valid for this one block, a nullptr (or
  // l = r = nullptr) is a silent input. The kernel hands them ALWAYS, live and in a render: a render has no deck playing and its inputs are silent by construction (E7).
  static constexpr int DJ_EINGAENGE = 5;
  void dj_schluessel(const float* const* l, const float* const* r);

  // ---- Zustand (nur im Callback-Faden lesen)
  ArrZustand zustand(const Karte& k, int64_t s) const;
  const ArrSnapshot* snapshot() const { return snap_; }
  // counts the swaps (tausche): a new value is a new snapshot, whatever its address (the loader frees and allocates, an address can come back); sinks that act once per snapshot compare this, not the pointer
  uint64_t snapshot_generation() const { return snap_gen_; }
  ArrStatus status() const { return status_; }
  double start_beat() const { return start_beat_; }
  bool von_cypher() const { return von_cypher_; }
  int64_t letzte_naht() const { return letzte_naht_; }       // Kern-Sample des letzten Wraps, −1: keiner
  bool spur_belegt(int i) const { return snap_ && snap_->spur[i].art != ArrArt::leer; }
  float spitze_lesen(int i) { const float v = spitze_[i]; spitze_[i] = 0.0f; return v; }   // nach dem Fader, linear
  float spitze_gruppe_lesen(int g) { return spitze_lesen(ARR_SPUREN + g); }   // 1.10: nach dem Gruppen-Fader, linear
  float spitze_pm_lesen() { return spitze_lesen(ARR_PM); }                    // nach dem PM-Fader
  float spitze_ret_lesen(int r) { return spitze_lesen(ARR_RET0 + r); }        // 1.10 Slice 3: after the return fader
  bool ret_belegt(int r) const { return snap_ && snap_->ret_da[r]; }         // the playback knows return r (0-based)
  bool ret_blendet() const { return ret_.blendet(); }                        // a return strip still fades (P15)
  void hall_sofort();                                                        // main thread before block 0 (render) and in the constructor: Halls take the base values of their controls now
  const ArrInserts& inserts() const { return ins_; }                         // 1.10 slice 4a: readings of the insert pool
  ArrHostStufe& host_stufe() { return ins_.host(); }                          // plan 1.11 T4: the host stages (the core hands the port buffers per block, T5 the health)
  int pdc_latenz() const { return snap_ ? snap_->pdc.gesamt : 0; }           // 1.10 slice 4b T13: the largest path latency of the playback in force, samples
  int pdc_historie(int key) const { return pdc_.historie(key); }             // test seam: samples a delay place holds (0: no ring in use)
  // mehrkern task 4: the pool the return Halls compute on (reverb_pool.h); nullptr = serial. Not owned. Before the first block.
  void setze_hall_pool(HallPool* p) {
    ret_.setze_pool(p);
    spur_pool_ = p;
    spur_plan_gueltig_ = false;   // the lane count follows the pool: the plan is rebuilt at the start of the next block
  }
  // mehrkern slice 3.1: the lane count of the track plan: 0 = from the pool (workers + 1, one lane without a pool), 1..4 = fixed (tests, mode). Callback thread or before the first block.
  void setze_spur_bahnen(int n) {
    spur_bahnen_soll_ = n < 0 ? 0 : (n > ARR_ARBEIT_BAHNEN ? ARR_ARBEIT_BAHNEN : n);
#ifndef CYPHERDJ_MUTATION_SPUR_FLAG_BLEIBT   // error case: the setter leaves the plan valid, the next block keeps the old lane count
    spur_plan_gueltig_ = false;
#endif
  }
  // mehrkern slice 3.2: phase Q on the pool. mode 0 = aus (serial), 1 = an, 2 = auto (an, and one retry after an automatic switch-off). Any thread (an atomic); the callback reads it once per block and a change drops the plan flag.
  void setze_spur_pool(int mode) { spur_modus_.store(mode, std::memory_order_release); }
  int spur_pool_modus() const { return spur_modus_.load(std::memory_order_acquire); }
  void setze_spur_haken(SpurHaken* h) { spur_lauf_.setze_haken(h); }          // test seam, before the block
  void setze_spur_test(const SpurTest& t) { spur_test_ = t; spur_lauf_.setze_test(t); }   // test seam, before the block
  // mehrkern slice 3.2 task 6: the nominal start of the current sub-block on CLOCK_MONOTONIC (cycle stamp plus the offset of the sub-block); 0 = unknown. Before block().
  void setze_zyklus_start(int64_t ns) { zyklus_start_ns_ = ns; }
  int64_t zyklus_start() const { return zyklus_start_ns_; }   // test seam: what the kern handed in for the last sub-block
  const ArrSpurLauf& spur_lauf() const { return spur_lauf_; }                 // counters of the scheduler
  const ArrArbeit& spur_arbeit(int b) const { return spur_arbeit_[b < 0 ? 0 : (b >= ARR_ARBEIT_BAHNEN ? ARR_ARBEIT_BAHNEN - 1 : b)]; }   // test seam: the lane struct (einheiten)
  const ArrSpurPlan& spur_plan() const { return spur_plan_; }                 // test seam: the plan as built
  const float* spur_bus_l(int i) const { return i >= 0 && i < ARR_SPUREN ? bus_l_[i] : nullptr; }                  // test seam: the raw track signal of the last block (before chains, if any)
  const float* spur_bus_r(int i) const { return i >= 0 && i < ARR_SPUREN ? bus_r_[i] : nullptr; }
  bool spur_plan_gueltig() const { return spur_plan_gueltig_; }               // test seam: false = it is rebuilt at the start of the next block
  const ArrReturns& returns() const { return ret_; }                         // counters and test seams of the return Halls
  uint64_t ruhe_zaehler() const { return ruhe_n_; }                              // blocks taken on the quiet path (test seam, P15)
  bool gruppe_belegt(int g) const { return grp_belegt_[g]; }                  // mindestens eine Spur oder benutzte Untergruppe im Schnappschuss schickt in die Gruppe
  // Produktions-Master des zuletzt gerechneten Teilblocks (m Werte, nach dem PM-Fader, ohne Metronom): Summe in erz/4 und Export-Abgriff
  const float* pm_l() const { return pm_l_; }
  const float* pm_r() const { return pm_r_; }
  float wert(int spur, int feld) const { return w_[spur][feld].w; }   // feld 0 fader (dB), 1 pan, 2 mute, 3 solo
  int stimmen() const;
  int warp_stimmen() const;          // Paket 1.13: davon gewarpt (nur Prüfung und Kosten)
  int werk_stimmen() const;          // Paket 1.13 Slice 2: davon im Warp-Werk (COMPLEX, TONES), eine auslaufende mitgezählt
  // Paket 1.13 Slice 2: das Warp-Werk für COMPLEX und TONES. Nicht im Callback, vor dem ersten Block. Ohne Werk (nullptr) spielt ein COMPLEX- oder
  // TONES-Clip als RE-PITCH (im Takt, falsche Tonhöhe) und zählt warp_kein_platz; der Lader lässt solche Clips ohnehin nur mit Bungee zu.
  void setze_warp_werk(WarpWerk* w) { werk_ = w; }
  WarpWerk* warp_werk() const { return werk_; }
  // Karten-Generation des Kerns (Tempoplan::generation_zeiger): wächst sie, setzt das Arrangement die Stimmen des Werks mit der neuen Karte neu an
  void setze_karten_generation(const uint32_t* g) {
    karte_gen_ = g;
    karte_gen_gesehen_ = g ? *g : 0;
  }
  uint64_t warp_unterlauf() const { return warp_unterlauf_; }     // Ausfälle des Rings während einer Stimme (Stille mit Blende)
  uint64_t warp_kein_platz() const { return warp_kein_platz_; }   // Stimmen, die kein Werk-Platz bekam und als RE-PITCH spielen
  uint64_t warp_spaet() const { return warp_spaet_; }             // Stimmen, deren Ring zum Einsatz noch leer war
  uint64_t stimmen_verloren() const { return stimmen_verloren_; }
  int offene_noten() const { return n_offen_; }   // the scheduled notes of the playback only; the live notes of the armed tracks are counted by live_offene_noten()
  // 1.8 T7b: live notes of the MIDI-armed instrument tracks (arr_notes.cpp). Callback thread only, on the caller before arr_->block() like noten_block, never from a lane
  // unit. live_note sends through the sink in force for the track (senke_fuer) and keeps the sink of every On (128 keys per track): the Off goes to that sink, also after a
  // snapshot swap. ziel is a sample inside the FIRST sub-block of the cycle (live_ziel clamps the stamp: Kern::audio hands the sinks 1024 samples at a time, a sink applies
  // everything queued for a track in the next block; an event beyond that block would sit in the sink for a later one, out of reach of a swap or an all-off). A second On of a held key closes the old one at the new onset.
  // live_alle_aus closes every held key (per-key offs to the stored sinks, no all-off: the notes of the playback on the same track keep sounding), live_spur_aus one track.
  void live_note(int spur0, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept;
  void live_alle_aus(int64_t ziel) noexcept;
  void live_spur_aus(int spur0, int64_t ziel) noexcept;
  int live_offene_noten() const noexcept { return n_live_; }
  static int64_t live_ziel(int64_t zyklus_start, uint32_t versatz, int n) noexcept {
    const int64_t erster = std::min<int64_t>(n > 0 ? n : 1, ARR_BLOCK);   // length of the first sub-block of the cycle
    return zyklus_start + std::min<int64_t>(versatz, erster - 1);
  }
  uint64_t noten_verloren() const { return noten_verloren_; }
  // Ereignisse für Quittungen und /zustand/arr: Sample des letzten Einsatzes und Endes (−1: keiner); nach dem Lesen −1
  int64_t hole_gestartet() { const int64_t v = gestartet_bei_; gestartet_bei_ = -1; return v; }
  int64_t hole_gestoppt() { const int64_t v = gestoppt_bei_; gestoppt_bei_ = -1; return v; }
  // 1.8: Lesezugriffe für das Modul Aufnahme (Kern-Sample des Einsatzes, des Endes des letzten Laufs, des geplanten Stopps; −1: keiner)
  int64_t einsatz_sample() const noexcept { return start_s_; }
  int64_t beendet_sample() const noexcept { return beendet_s_; }
  int64_t stopp_sample() const noexcept { return stopp_s_; }
  bool zaehlt_ein() const noexcept { return status_ == ArrStatus::wartet && vorzaehl_n_ > 0; }   // 1.8 S4a: waiting with a count-in (the recording reports status 1)
  bool hole_geaendert() { const bool v = geaendert_; geaendert_ = false; return v; }

  // ---- Freeze (arr_freeze.cpp, Paket K3), im Callback am Blockanfang s. Start wie start() ab f->von_beat, Loop-Klammer
  // ausgesetzt, Stopp am Ende des Nachlaufs. false mit grund: nicht_geladen, ueberlappung (Transport oder Freeze läuft),
  // spur_bereich (Spur leer), zu_gross (Puffer kleiner als die Länge). Stopp, Start, Tausch, KI-Stopp brechen ab, im Kern
  // dazu Tempo-Rampe (6.33) und /k/set/neu (freeze_abbrechen).
  bool freeze(ArrFreeze* f, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k,
              const char*& grund);
  bool freeze_laeuft() const { return freeze_ != nullptr; }
  void setze_auto_schritt(int n) { auto_schritt_ = n < 1 ? 1 : n; }      // test seam: 1 = no hold
  void setze_auto_vorausschau(bool an) { auto_vorausschau_ = an; }       // test seam: false = every lane sample is evaluated (the reference of the look-ahead in auto_block)
  // Fix L1 (/k/set/neu, nach dem Sprung der Zeitachse): ein wartender oder laufender Freeze endet sofort bei s (Status 1,
  // abholen mit hole_freeze_fertig), der Transport steht. Offene Noten der alten Achse fallen weg (ihr Off-Sample läge auf
  // der neuen in der Zukunft), jede Senke bekommt alle_aus bei s.
  void freeze_abbrechen(int64_t s, const Karte& k);
  // Einsatz-Sample eines Freeze (einmal, sonst −1) und der beendete Auftrag (einmal, sonst nullptr)
  int64_t hole_freeze_gestartet() { const int64_t v = freeze_gestartet_bei_; freeze_gestartet_bei_ = -1; return v; }
  ArrFreeze* hole_freeze_fertig() { ArrFreeze* f = freeze_fertig_; freeze_fertig_ = nullptr; return f; }
  // ---- 1.10 slice 7 (arr_tap.cpp): the real-time tap, the sibling of the freeze (the freeze code is untouched). Called in the callback at the block start s.
  // false with grund: nicht_geladen, ueberlappung (transport, freeze or tap runs or waits to be claimed), ausserhalb_bereich (art or punkt), spur_bereich (no such strip in the
  // playback), zu_gross (more than ARR_FREEZE_MAX_BEATS or the buffer too small). One run at a time, shared with the freeze (loop bracket, start beat).
  bool abgriff(ArrAbgriff* a, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k, const char*& grund);
  bool abgriff_laeuft() const { return abg_ != nullptr; }
  // samples of path latency at the tapped point (D7): arr_schluessel_quelle_ankunft for track, group and return, pdc.p_in for the master pre, pdc.gesamt for the master post
  int abgriff_ankunft(int art, int nr, int punkt) const;
  void abgriff_abbrechen(int64_t s, const Karte& k);   // /k/set/neu: like freeze_abbrechen
  int64_t hole_abgriff_gestartet() { const int64_t v = abg_gestartet_bei_; abg_gestartet_bei_ = -1; return v; }
  ArrAbgriff* hole_abgriff_fertig() { ArrAbgriff* f = abg_fertig_; abg_fertig_ = nullptr; return f; }
  // ---- plan 1.11 T12 (arr_export_run.cpp): the real-time export of the production master, the third sibling of the freeze (untouched). Called in the callback at the block start s.
  // false with grund: nicht_geladen, belegt (transport, freeze, tap or another export runs or waits to be collected), ausserhalb_bereich, zu_gross (more than 3600 s). The job is NOT
  // touched on a refusal (the caller tells the writer). Afterwards the job belongs to the writer thread as soon as the run ended (ArrExportLauf::phase): the core keeps only copies.
  bool export_lauf(ArrExportLauf* a, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k, const char*& grund);
  bool export_laeuft() const { return exp_ != nullptr; }
  void export_abbrechen(int64_t s, const Karte& k);   // /k/set/neu: like freeze_abbrechen
  int64_t hole_export_gestartet() { const int64_t v = exp_gestartet_bei_; exp_gestartet_bei_ = -1; return v; }
  // the end of a run, once: status 0 done, 1 aborted; ende_s the core sample (value copies, the job may be gone)
  bool hole_export_fertig(int32_t& status, int64_t& ende_s) {
    if (!exp_fertig_da_) return false;
    exp_fertig_da_ = false;
    status = exp_fertig_status_;
    ende_s = exp_fertig_ende_;
    return true;
  }

 private:
  friend struct ArrPruefZugang;
  double projekt_beat(const Karte& k, double s) const { return k.beat_at(s) - ursprung_ + start_beat_; }
  int64_t sample_von_p(const Karte& k, double p, double urs) const {
    return std::llround(k.sample_at(p + urs - start_beat_));
  }
  // Spec 2.2: die Klammer greift nur, wenn der Kopf bis von unten erreicht. Liegt der Kopf beim Start (start_beat) auf
  // oder hinter bis, oder beim Setzen der Klammer (loop) hinter bis (Naht-Sample < s; genau auf der Naht greift sie,
  // K1 Fix-2), läuft der Transport linear, bis ein neuer Start oder eine neue
  // Klammer vor dem Kopf kommt (Audio, Noten, Metronom und Naht fragen alle hier). So liegt die Naht nie hinter dem Kopf.
  bool klammer() const {
#ifdef CYPHERDJ_MUTATION_ARR_KLAMMER_OHNE_START
    return loop_an_;   // Fehlerfall: Start auf oder hinter bis springt sofort in die Klammer
#else
    return loop_an_ && klammer_vorn_;
#endif
  }
  int64_t naht_sample(const Karte& k) const;     // Sample der Naht (p = bis) des laufenden Durchlaufs, −1 ohne
  void beginne(const Karte& k, int64_t s);
  void beende(int64_t s);
  void wrap(const Karte& k, int64_t s);
  void segment(const Karte& k, int64_t a, int64_t b, int64_t s0);   // Teilblock ohne Transport-Ereignis

  // Audio-Clip-Stimmen (arr_voices.cpp)
  struct Stimme {
    bool aktiv = false;
    int spur = 0;
    uint64_t clip_id = 0;
    const ArrClip* clip = nullptr;   // nullptr: Ausklang aus eigener Kopie
    int64_t clip_s0 = 0;             // (bei Einstieg vergangenes) Kern-Sample des Clip-Anfangs
    int64_t ende = 0;                // Kern-Sample des Clip-Endes
    int64_t ein_n = 0, aus_n = 0;    // Ein- und Ausblende des Clips in Samples
    int64_t ramp_ein_ab = -1;        // Kurz-Einblende ab diesem Sample, −1: keine
    int64_t ab_aus = -1;             // Kurzblende (Stopp) beginnt hier, ARR_NAHT lang, −1: keine
    double p_off = 0.0;              // Paket 1.13: start_beat_ − ursprung_ beim Start dieser Stimme (ein Neustart ändert beides, die Ausblende behält ihre Abbildung)
    // Paket 1.13 Slice 2 (Warp-Werk): die Stimme liest ihren Ring, nicht das Audio. Nach dem Start liest sie den Clip nie wieder (der Schnappschuss
    // darf gehen): Gain und Abbildung stehen hier.
    int werk = -1;                   // Platz im Warp-Werk, −1: keiner
    int64_t werk_ab = 0;             // erstes Sample, das das Werk für diese Stimme liefert (s_h)
    float gain = 1.0f;               // Clip-Gain
    int ramp_n = ARR_EIN;            // Länge der Einblende ab ramp_ein_ab (Werk-Stimmen, und seit Nachbesserung 6 auch RE-PITCH-Stimmen: stimme_starten setzt sie)
    double beat_versatz = 0.0;       // Clip-Beat b(m) = karte.beat_at(m) + beat_versatz (für ein Neuansetzen mit anderer Karte)
    bool naechste = false;           // vorab für den Durchlauf nach der Naht angesetzt
    bool tausch_bruecke = false;     // Nachbesserung 4: gelöst von einem Tausch (der alte Inhalt gilt nicht mehr), sonst von einer neuen Karte (nur das Raster ist alt)
    float gain_alt = 1.0f;           // Nachbesserung 4 (R3): ein Tausch, der nur den Gain ändert, bindet neu; der Gain gleitet ab gain_ab über ARR_NAHT von gain_alt auf gain
    int64_t gain_ab = -1;
    bool luecke = false;             // der Ring war zuletzt zu leer (Stille mit Blende), die nächste Strecke blendet ein
    bool gelesen = false;            // hat schon Audio aus dem Ring bekommen (warp_spaet gegen warp_unterlauf)
    int fade_ein = 0;                // noch zu blendende Samples nach einer Lücke
    bool nachfolgerin = false;       // Nachbesserung 5: von werk_decken als Nachfolgerin einer Brücke angesetzt; solange sie stumm ist, kann ein längerer Einsatz sie bei vollem Pool verdrängen (ihre Brücke holt nach)
    bool spaet_deckung = false;      // Nachbesserung 5: der Ring war zum Einsatz leer (spät): der Clip klingt als RE-PITCH aus dem Clip, bis der Ring liefert, dann Überblendung über ARR_NAHT
    // 1.12 slice 5 (D8): the gain envelope of the clip the voice plays (plain path). hk is a cursor on ArrClip::hk of v.clip and is rebound at every swap (never left on
    // the table of a snapshot that may go); hk_db/hk_lin are the held dB value and its linear gain (pow only when the value moved by more than AUTO_HALT_DB);
    // a swap that changes only the table glides over ARR_NAHT from hk_alt (the factor played at the swap) starting at hk_ab (-1: no glide).
    AutoLane hk;
    float hk_db = 1e9f, hk_lin = 1.0f, hk_alt = 1.0f;   // hk_db 1e9: nothing held yet, the first sample takes the exact value
    int64_t hk_ab = -1;
    bool hk_fest = false;   // 1.12 slice 5 (U8b): a bridge of the werk (v.clip == nullptr) holds the factor hk_lin it had when it was released (its table lives in a snapshot that may go)
    int ak_n = 0, ak_pos = 0;        // Ausklang
    float ak[2 * ARR_NAHT] = {};
  };
  void clips_starten(const Karte& k, int64_t a, int64_t b);
  Stimme* stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_start, int64_t clip_s0, bool rampe,
                       int ramp_n = ARR_EIN);   // nullptr: Pool voll; ramp_n: Länge der Einblende (Nachbesserung 6: ARR_NAHT, wo sie eine Ausblende über ARR_NAHT ablöst)
  void stimmen_einstieg(const Karte& k, int64_t a);
  void stimme_ausklang(Stimme& v, int64_t s, const Karte& k);
  void stimmen_spielen(const Karte& k, int64_t a, int64_t b, int64_t s0, int64_t naht);
  void stimme_warp_spielen(Stimme& v, int64_t a, int64_t b, int64_t s0, int64_t naht);   // Paket 1.13: Quellposition aus W(b), RE-PITCH
  void stimme_beats_spielen(const Karte& k, Stimme& v, int64_t a, int64_t b, int64_t s0, int64_t naht);   // Slice 4: BEATS, Einheiten mit Faktor 1
  bool beats_lage(const Karte& k, const Stimme& v, int64_t t, int& i, int64_t& s0, int64_t& s1) const;   // Slice 4: Einheit und ihre Grenzen in ganzen Samples aus der Karte
  static constexpr int64_t BEATS_ENDLOS = int64_t{1} << 60;                                              // Beginn der „nächsten“ Einheit hinter der letzten
  float hk_faktor(Stimme& v, double clip_beat, int64_t t);   // 1.12 slice 5: the envelope gain of the voice at the clip beat of sample t (held, with the swap glide)
  void hk_binden(Stimme& v, const ArrClip& c, double clip_beat);   // start: a fresh cursor on the table of c, searched at the clip beat
  void hk_umbinden(Stimme& v, const ArrClip& c2, int64_t s, const Karte& k);   // swap that changed the table (and maybe more): the voice moves to c2, the factor glides over ARR_NAHT
  void hk_festhalten(Stimme& v, const Karte& k, int64_t s);   // werk voice becomes a bridge: the cursor goes, the factor in force at s stays (hk_fest)
  void stimmen_tauschen(const ArrSnapshot* neu, int64_t s, const Karte& k);
  void stimmen_stopp(int64_t s);
  void stimmen_naht();
  void stimmen_karte_neu(const Karte& k);   // Nachbesserung 4 (N2): RE-PITCH-Stimmen rechnen ihr End-Sample mit der neuen Karte
  // Warp-Werk (Slice 2, arr_warp.cpp)
  bool werk_clip(const ArrClip& c) const { return c.warp && arr_warp_werk_modus(c.warp->modus); }
  bool hat_stimme(int spur, uint64_t clip_id, int64_t clip_s0) const;
  // ab: erstes Sample, das die Stimme klingen soll (Vorgabe s_h); liegt es vor s_h (clips_starten: der Einsatz ist jetzt, das Werk liefert erst ab a + Frist), klingt
  // der Clip bis s_h als RE-PITCH (spät, gezählt), nicht still (Nachbesserung 5)
  Stimme* werk_stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_h, int64_t clip_s0, bool rampe, int ramp_n, double urs, bool naechste,
                              int64_t ab = INT64_MIN);
  void werk_stimme_spielen(const Karte& k, Stimme& v, int64_t a, int64_t b, int64_t s0, int64_t naht);
  Stimme* werk_verdraengen(int64_t s0, int64_t dauer);            // Nachbesserung 5 (Vorrang): die stumme Nachfolgerin mit dem kürzesten Rest unter dauer, sonst nullptr
  void werk_abloesen(const Karte& k, Stimme& v, const ArrClip* c2, int64_t s, bool tausch);   // Tausch oder neue Karte: die gebundene Stimme v wird Brücke oder geht
  void werk_frei(Stimme& v);                                       // Platz zurückgeben, Stimme beenden
  void warp_vorausblick(const Karte& k, int64_t s0, int m);        // Stimmen für Einsätze der nächsten ARR_WARP_FRIST Samples ansetzen
  void warp_karte_neu(const Karte& k, int64_t s);                  // die Karte hat eine neue Generation: Stimmen des Werks neu ansetzen
  void werk_naechste_verwerfen();                                  // vorab angesetzte Stimmen des nächsten Durchlaufs aufgeben
  int64_t werk_bruecke_bis(int spur, uint64_t clip_id, bool naechste, int64_t s) const;   // bis wohin eine Brücke dieses Clips (ab s noch nicht ausblendend) spielt, INT64_MIN: keine (Nachbesserung 5, m2: −1 kollidierte mit negativen Clip-Starts)
  void werk_decken(const Karte& k, int64_t s0, int m);             // Nachbesserung 4: DIE Stelle der Invariante (je Block): jede Brücke hat ihre Nachfolgerin; Nachbesserung 5: kein Platz ohne Klang
  bool werk_am_start(double start_beat) const;                     // klingt am Start ein Werk-Clip (oder setzt er binnen kurzem ein)?

  // Spur-Mixer (arr_output.cpp)
  struct Wert {
    float w = 0.0f;
    const float* vl = nullptr;
    const float* sw_vl = nullptr;    // Automation Slice 1: the stellwerk course of this block (vl may be replaced by a lane buffer); w stays the base value
  };
  void regler_binden(const cypherdj::stellwerk::ReglerTabelle& tab);
  void mischen(int m, float* aus_l, float* aus_r);
  void verlaeufe_nachfuehren(int m);
  // 1.8 S3 (arr_monitor.cpp): the monitor of the external inputs. block() decides per track after freeze_abgriff (monitor_planen: mon_[i].klingt), mischen() adds the source of
  // a track after its insert chain and its PDC delay and before its fader loop (monitor_spur_addieren, 1.8 T1 slice 3b-lite)
  struct MonQuelle {
    const float* l = nullptr;
    const float* r = nullptr;
    int8_t modus = 0;
    int8_t monitor = 1;
    bool aufnahme = false;
    bool klingt = false;   // decided by monitor_planen for this block: the source is added by mischen()
  };
  MonQuelle mon_[ARR_SPUREN];
  void monitor_planen(const Karte& k, int64_t s0, int m);                       // per track: off / auto / sounds -> mon_[i].klingt
  void monitor_spur_addieren(int i, int m, float* dl, float* dr) const;          // adds the source of track i (channel mode applied) into dl/dr
  void monitor_loeschen() noexcept { for (MonQuelle& q : mon_) q = MonQuelle{}; }   // after every block: a source never survives into the next one
  bool spur_klingt(int i, const Karte& k, int64_t s0, int m) const;   // the transport plays and a clip of the track covers the last sample of the block
  void ruhe(int m);                  // Block ohne Wiedergabe und ohne Klang (Slice 11)

  // Automation Slice 1 (arr_auto.cpp, ADR 032): the fader lane of a track, evaluated per sample in the core
  void auto_segment(const Karte& k, int64_t a, int64_t b, int64_t s0);   // in segment(): project beat per sample of a playing sub-block
  void auto_block(int64_t s0, int m);                                     // before mischen(): fills auto_buf_ and points the fader of the track at it
  void auto_tausch(const ArrSnapshot* neu, int64_t s);                    // in tausche(): lanes appear, change or go; blend from the last played value
  void auto_stopp(int64_t s);                                             // in beende(): the lane stops, the fader blends back to the base value
  void auto_geraet();                                                     // before the sinks' block(): hands the `geraet` lane values to the sink (E9)
  void auto_kette();                                                      // 1.12 slice 6: before mischen(): hands the insert-parameter and rack-macro lane values to ArrInserts, one per block
  void glied_makros_(int64_t s0, int m);                                  // 1.9 U8 T9 (E12): the macro values of the member targets of the rack tracks go to their rack sink; caller thread, before phase Q, every block
  void auto_ueber_abschluss(int64_t s_ende);                              // 1.12 S3: after a block, an override change inside it has passed
  void auto_ueber_setzen(int spur, int feld, bool an, int64_t sample);    // the state change itself (no checks), with the source blend and the event
  void auto_ueber_loeschen(int spur, int feld, int64_t sample);           // clear the state without a blend and report 0 (stopped, or the lane is gone)
  void blende_vormerken(int spur, int feld, int64_t sample);              // a source blend starts at `sample` (at most two per block)
  void auto_ereignis_melden(int spur, int feld, bool zustand, int64_t sample);
  void auto_beginn();                                                     // in beginne(): the start takes the hard lane value, no blend

  // Noten (arr_notes.cpp)
  struct Offen {
    uint64_t id;
    int spur;
    uint8_t ton;
    int64_t an, aus;                 // Ziel-Samples
    double ende_beat;                // Projekt-Beat des Endes (Vergleich beim Tausch)
    ArrSenke* senke;
  };
  ArrSenke* senke_fuer(const ArrSnapshot* s, int spur) const;
  // mehrkern slice 3: phase Q. Every track sink of the block, through the sticky plan: on the Hall pool lanes (3.2, a rack with its members is one
  // unit), or serially on the callback; either way bit-equal to the old loop.
  void spur_quelle(int64_t s0, int m);
  void spur_plan_bauen();
  int spur_bahnen() const;
  void senken_wechsel(const ArrSnapshot* neu, int64_t s);   // Fix F2: Spuren, die ihre Senke verlassen (arrangement.cpp)
  void noten_block(const Karte& k, int64_t s0, int m);
  void noten_fenster(const Karte& k, int spur, ArrSenke* se, int64_t von, int64_t bis);
  void offen_aus_bis(int64_t ende);
  void alle_noten_aus(int64_t s);
  void noten_tauschen(const ArrSnapshot* neu, int64_t s);
  void live_aus_bis(int64_t s) noexcept;   // 1.8 T7b review fix: the live keys that began at or before s end at s; a key with an onset after s stays held (see arr_notes.cpp)
  void live_tauschen(const ArrSnapshot* neu, int64_t s);   // 1.8 T7b: a held live key whose track gets another sink ends on the sink that got the On

  // Freeze (arr_freeze.cpp, Paket K3)
  void freeze_abgriff(int64_t s0, int m);
  void freeze_ende(int64_t s, int32_t status);
  // 1.10 slice 7 (arr_tap.cpp): abgriff_block() runs in block() next to freeze_abgriff (sets abg_s0_, takes the track pre); the other capture points sit in mischen()
  void abgriff_block(int64_t s0, int m);
  void abg_ernte(const float* l, const float* r, int m);   // copies the part of this block that lies in the window of the running tap
  void abg_ende(int64_t s, int32_t status);
  void abg_blockende(int m);   // end of mischen(): silence for an idle strip, then the end of the run when the window is complete
  bool abg_ziel(int art, int punkt) const { return abg_ && abg_->art == art && abg_->punkt == punkt; }
  // plan 1.11 T12 (arr_export_run.cpp): export_block() runs in block() next to abgriff_block (sets exp_s0_), export_blockende() at the end of mischen() after the PM post point
  void export_block(int64_t s0, int m);
  void export_blockende(int m);
  void export_ende(int64_t s, int32_t status, const char* grund);
  bool sonderlauf() const { return freeze_ || abg_ || exp_; }   // a freeze, a tap or an export run suspends the loop bracket and the start beat of the user

  // Metronom (arr_metronom.cpp)
  void klick_form_bauen();
  void metronom_segment(const Karte& k, int64_t a, int64_t b, int64_t s0);

  const ArrSnapshot* snap_ = nullptr;
  uint64_t snap_gen_ = 0;            // incremented by every tausche()
  ArrStatus status_ = ArrStatus::steht;
  bool von_cypher_ = false;
  double start_beat_ = 0.0;
  double ursprung_ = 0.0;            // Kern-Beat mit p = start_beat; verschiebt sich je Naht um bis − von
  int64_t start_s_ = -1;             // Kern-Sample des Einsatzes (wartet, spielt)
  int64_t stopp_s_ = -1;             // geplanter Stopp, −1: keiner
  bool loop_an_ = false;
  bool klammer_vorn_ = false;        // bis lag beim Start oder beim Setzen der Klammer vor dem Kopf (klammer())
  double von_ = 0.0, bis_ = 0.0;
  int64_t letzte_naht_ = -1;
  int64_t gestartet_bei_ = -1, gestoppt_bei_ = -1;
  int64_t beendet_s_ = -1;   // 1.8: Ende des letzten Laufs, gelöscht beim nächsten start()
  int vorzaehl_n_ = 0;       // 1.8 S4a: count-in beats of the waiting start (0: none); cleared at the entry and when the wait ends
  double vorzaehl_kb_ = 0.0; // core beat of the first count-in click (the first quant point)
  bool geaendert_ = false;

  bool einstieg_ = false;            // am nächsten Teilblock Clips ansetzen, die am laufenden Ort schon klingen müssten
  Stimme st_[ARR_STIMMEN];
  uint64_t stimmen_verloren_ = 0;
  // Automation: 8 KiB of project beats per block (ap_); the lane buffers auto_buf_ below are 32 tracks * 4 fields * 1024 * 4 B = 512 KiB (slice 1 had one field: 128 KiB)
  double ap_[ARR_BLOCK] = {};                      // project beat per sample of the block (only filled while a lane plays)
  // Automation slice 2: the fields 0..3 of a track (fader dB, pan, mute 0/1, solo 0/1) can each play a lane. One buffer per track and field (E7, 512 KiB, members: no allocation).
  static constexpr int AUTO_BLENDE_FELDER = 2;   // the fields 0 (fader) and 1 (pan) have a source blend; mute and solo (2, 3) have none
  float auto_buf_[ARR_SPUREN][AUTO_FELDER][ARR_BLOCK] = {};   // the lane value or the blend per sample; Wert::vl points here for a block
  int auto_von_ = 0, auto_bis_ = 0;                // block-relative range [von, bis) in which the lane plays (transport running)
  AutoLane auto_l_[ARR_SPUREN][AUTO_FELDER];       // cursor per track and field on the lane of the current snapshot
  AutoLane auto_g_[ARR_SPUREN][ARR_GERAET_LANE_PARAMS]; // cursor per track and device parameter on the `geraet` lane of the current snapshot
  // 1.12 slice 5 (D9): the cursors of the RELATIVE lanes (summands of the value stack), per track and fader/pan field and per device parameter. New names: kern_bitgleich_auto reads the ones above.
  AutoLane auto_r_[ARR_SPUREN][AUTO_BLENDE_FELDER];
  AutoLane auto_gr_[ARR_SPUREN][ARR_GERAET_LANE_PARAMS];
  AutoLane auto_k_[ARR_KLANES_MAX];                // 1.12 slice 6: cursor per insert / rack lane of the current snapshot (index = ArrSnapshot::klane)
  float auto_zuletzt_[ARR_SPUREN][AUTO_FELDER] = {};   // last value written to auto_buf_ (dB for the fader, pan units for pan)
  bool auto_war_[ARR_SPUREN][AUTO_FELDER] = {};        // the field wrote auto_buf_ in the last block
  // Step hold (task 8 fallback): the lane value is taken over for up to auto_schritt_ samples, so the mixer computes the gain (std::pow, cos/sin) only when the
  // value changes. A step larger than AUTO_HALT_DB (fader) or AUTO_HALT_PAN (pan) is taken at once. Mute and solo are not held (0/1 jumps). Live and render run the same function.
  int auto_schritt_ = 16;                          // samples per hold (1: every sample); set_auto_schritt is a test seam
  int auto_halt_n_[ARR_SPUREN][AUTO_FELDER] = {};      // samples the held value still stays
  float auto_halt_v_[ARR_SPUREN][AUTO_FELDER] = {};    // the held value
  // 1.12 slice 3 (D6): the lane override per track and field, core only. auto_ueber_ is the state after all changes. A change inside the running block is pending
  // until that block has run: auto_ueber_n_ (0..2) changes, at auto_ueber_s_ and auto_ueber_s2_, starting from auto_ueber_alt_ (the state at the block start). Two
  // changes flip the state twice, so auto_block plays alt before the first, !alt between them and alt after the second; each one starts its own source blend.
  bool auto_ueber_[ARR_SPUREN][AUTO_FELDER] = {};
  bool auto_ueber_alt_[ARR_SPUREN][AUTO_FELDER] = {};
  int8_t auto_ueber_n_[ARR_SPUREN][AUTO_FELDER] = {};
  int64_t auto_ueber_s_[ARR_SPUREN][AUTO_FELDER] = {};
  int64_t auto_ueber_s2_[ARR_SPUREN][AUTO_FELDER] = {};
  int auto_ueber_offen_ = 0;                            // fields with a pending change (auto_ueber_n_ > 0)
  bool auto_pickup_[ARR_SPUREN][AUTO_FELDER] = {};      // the pickup was handed out for the override that starts in this cycle (lane_wert answers false until then)
  float auto_lane_v_[ARR_SPUREN][AUTO_FELDER] = {};     // the last value the lane itself played (not a blend, not the hand)
  SpscRing<ArrAutoEreignis, 1024> auto_ev_;             // state changes for the net thread (task 3)
  std::atomic<uint32_t> auto_ev_verloren_{0};
  bool auto_vorausschau_ = true;                       // look-ahead inside a hold (auto_block); false only in tests
  bool auto_probe_aus_[ARR_SPUREN][AUTO_FELDER] = {};  // the look-ahead failed in the running hold window: no second try until the next latch
  // Source blend (D6, E8): field 0 (fader) blends in the gain, field 1 (pan) linearly in the pan value; mute and solo have none (the mixer fade applies).
  int32_t blende_n_[ARR_SPUREN][AUTO_FELDER] = {};     // samples of the source blend still to run (480)
  float blende_g0_[ARR_SPUREN][AUTO_FELDER] = {};      // start value of the running blend: the gain (fader) or the pan value (pan) played just before the source change
  int64_t blende_s_[ARR_SPUREN][AUTO_FELDER];          // absolute sample at which a blend starts, INT64_MIN: none (constructor)
  int64_t blende_s2_[ARR_SPUREN][AUTO_FELDER];         // a second blend start in the same block (re-enable and grip within one block), INT64_MIN: none (constructor)
  double wp_[ARR_BLOCK] = {};        // Paket 1.13: Projekt-Beat je Sample des Teilblocks, einmal je Teilblock für alle gewarpten Stimmen
  float wl_[ARR_BLOCK] = {}, wr_[ARR_BLOCK] = {};   // Slice 2: Lesepuffer für den Ring einer Werk-Stimme
  WarpWerk* werk_ = nullptr;
  bool snap_werk_ = false;           // der Schnappschuss hat Clips im Modus COMPLEX oder TONES (beim Tausch bestimmt)
  uint64_t warp_unterlauf_ = 0, warp_kein_platz_ = 0, warp_spaet_ = 0;
  const uint32_t* karte_gen_ = nullptr;
  uint32_t karte_gen_gesehen_ = 0;
  Wert w_[ARR_STREIFEN][ARR_FELDER];   // per strip (track, group, PM, return) see ARR_FELDER; the PM has field 0 only
  int16_t regler_spur_[cypherdj::stellwerk::MAX_REGLER];
  int8_t regler_feld_[cypherdj::stellwerk::MAX_REGLER];
  int16_t spur_regler_[ARR_SPUREN][4];   // 1.12 S3: the regulator of spur/<n>/{fader,pan,mute,solo}, -1: none (regler_binden)
  bool trocken_aus_ = false;                       // 1.10 T10: render-only dry-out armed (setze_trocken_aus); implies nur_schl_, never true in the live kern
  bool nur_schl_ = false;                          // 1.10 T9: render-only key mask armed (setze_nur_schluessel); never true in the live kern
  bool nur_ziel_aus_[ARR_STREIFEN] = {};           // the strip adds nothing into its target
  bool nur_sends_aus_[ARR_STREIFEN] = {};          // the strip adds nothing into its sends
  float ms_gain_[ARR_STREIFEN];      // Mute/Solo-Blende 0..1
  float spitze_[ARR_STREIFEN] = {};
  bool solo_t_[ARR_BLOCK] = {};      // E3 P5: je Sample des Blocks, ob irgendeine Spur Solo hat (einmal je Block vorberechnet)
  float bus_l_[ARR_SPUREN][ARR_BLOCK] = {};
  float bus_r_[ARR_SPUREN][ARR_BLOCK] = {};
  bool msolo_t_[ARR_GRUPPEN][ARR_BLOCK] = {};   // 1.10: je Sample, ob ein Mitglied der Gruppe Solo hat (nur bei Solo-Verlauf)
  float grp_l_[ARR_GRUPPEN][ARR_BLOCK] = {};    // 1.10: Eingang der Gruppen (Summe der Mitglieder nach deren Fader und Pan; seit den verschachtelten Gruppen auch der Ausgang der Untergruppen)
  float grp_r_[ARR_GRUPPEN][ARR_BLOCK] = {};
  float gblende_[ARR_GRUPPEN][ARR_BLOCK] = {};  // 1.10 Slice 3 (P14): mute/solo fade of each used group per sample, computed before the tracks (the sends of the members use it)
  float gblende_s_[ARR_GRUPPEN][ARR_BLOCK] = {};   // nested groups: the product of the fades of the group and all its ancestors (only for a group with a parent; else gblende_ itself is the product): what sends are scaled by
  bool vsolo_t_[ARR_GRUPPEN][ARR_BLOCK] = {};   // nested groups: per sample, the group or one of its ancestors has solo (only with a solo course)
  uint64_t ruhe_n_ = 0;
  float ret_pre_w_[ARR_RETURNS] = {};             // 1.10 slice 4a: blend 0 = post .. 1 = pre of the sends into each return (state across blocks)
  float ret_pre_t_[ARR_RETURNS][ARR_BLOCK] = {};  // the same per sample for the current block
  ArrInserts ins_;                               // 1.10 slice 4a: pooled insert stages (built in the constructor)
  const float* dj_l_[DJ_EINGAENGE] = {};         // 1.10 slice 5 U2b: the DJ inputs of this block (dj_schluessel), reset at the end of block()
  const float* dj_r_[DJ_EINGAENGE] = {};
  ArrPdc pdc_;                                   // 1.10 slice 4b T13: delay rings of the compensation (exist after the constructor)
  float gsd_l_[ARR_BLOCK] = {}, gsd_r_[ARR_BLOCK] = {};     // nested groups: the pre signal (group sum times its mute/solo fade) of the group in the pass, delayed at its send place (PDC_GRPSEND0 + g)
  float pdcs_l_[ARR_BLOCK] = {}, pdcs_r_[ARR_BLOCK] = {};   // scratch for a sum that is delayed before it joins the PM sum (groups, one return at a time)
  ArrReturns ret_;                               // 1.10 Slice 3: return inputs and presence fades
  float pm_l_[ARR_BLOCK] = {};                  // 1.10: Produktions-Master
  float pm_r_[ARR_BLOCK] = {};
  int8_t ziel_[ARR_SPUREN] = {};                // gültiges Ziel der Spur: 0 master, 1..ARR_GRUPPEN Gruppe
  int8_t ziel_alt_[ARR_SPUREN] = {};            // Ziel vor dem letzten Wechsel (nur während der Blende)
  // nested groups: the target state of the groups, as of the tracks (0 master, 1..ARR_GRUPPEN the parent). A change blends over ARR_ZIEL_BLENDE only when the old target
  // is still open when the group adds (its level in the new order is higher than the group's), else it switches hard at the block start (ziele_pruefen).
  int8_t gziel_[ARR_GRUPPEN] = {};
  int8_t gziel_alt_[ARR_GRUPPEN] = {};
  float gziel_w_[ARR_GRUPPEN] = {};             // 1 = no blend running (regler_binden sets 1)
  // Live modules (reload of a playback that only changes module B): the target of a strip is blended only while the strip keeps playing. A track slot that was empty and is
  // now held (a track arrives), or a group nobody fed and now somebody does, takes its target at once (the old target carries nothing to fade out, so the blend would only
  // leak the new sound into the master); a track slot that is empty now (the track is gone) keeps its last target, so its tail runs out through its group and not around the
  // group faders into the master. A group nobody feeds takes the target of the snapshot at once: the order of the group passes (parents first) comes from the snapshot. `ziel_ok_` / `gziel_ok_`: the strip's target in ziel_ / gziel_ was taken while the strip was held; set and read in ziele_pruefen only.
  bool ziel_ok_[ARR_SPUREN] = {};
  bool gziel_ok_[ARR_GRUPPEN] = {};
  int16_t regler_ins_[cypherdj::stellwerk::MAX_REGLER];   // 1.10 slice 4a: controller -> global slot * INS_PARAM_MAX + parameter of ins/<art>/<n>/*, -1: none
  int16_t regler_rack_[cypherdj::stellwerk::MAX_REGLER];   // 1.10 slice 4c: controller -> rack slot * ARR_MAKROS + macro of rack/<k>/m<n>, -1: none
  float ziel_w_[ARR_SPUREN];                    // Anteil des neuen Ziels 0..1, 1 = Blende fertig (regler_binden setzt 1)
  bool grp_belegt_[ARR_GRUPPEN] = {};
  void ziele_pruefen();                         // am Blockanfang: Ziel-Wechsel aus dem Schnappschuss einleiten

  ArrSenke* senke_intern_ = nullptr;
  ArrSpurPlan spur_plan_;
  bool spur_plan_gueltig_ = false;              // false: rebuilt at the start of the next block (pool, lane count, sink set, a transition ended)
  int spur_bahnen_soll_ = 0;
  HallPool* spur_pool_ = nullptr;               // the pool of the Halls (not owned), only for the lane count
  std::unique_ptr<ArrArbeit[]> spur_arbeit_;    // one work struct per lane, built in the constructor (before the first block)
  ArrSpurLauf spur_lauf_;                       // the scheduler of phase Q (mehrkern slice 3.2)
  std::atomic<int> spur_modus_{0};              // 0 aus, 1 an, 2 auto; the product default lives in kern.toml, not here
  int spur_modus_gesehen_ = 0;                  // callback only: the mode of the last block
  int64_t zyklus_start_ns_ = 0;                 // callback only: see setze_zyklus_start
  SpurTest spur_test_;
  static void spur_einheit(void* ctx, int spur, ArrArbeit& a);
  static void spur_rest(void* ctx);
  void spur_rest_lauf();
  void spur_nach_join();   // on the caller after the join (or after the serial path): a rest track that has become lane-capable drops the plan
  void spur_einheit_ausfuehren(int spur, int64_t s0, int m, ArrArbeit& a);
  int64_t q_s0_ = 0;                            // position of the running phase Q, written before schicke
  int q_m_ = 0;
  static constexpr int SPUR_MIN_LAST = 512;     // live units times block length below which the phase stays serial; task 9 sweep: 4 units already win (-60 us at 256, -25 us at 128), fewer were not measured
  bool spur_seriell_weil(int m);
  ArrSenke* senke_wirt_[ARR_WIRT_SLOTS] = {};
  ArrSenke* senke_rack_ = nullptr;
  // Fix F2 und K2b-Rest (a): je Senke, die eine Spur beim Tausch verlassen hat, ein Eintrag (Senke, Spur); im nächsten
  // Block blendet jede dieser Senken die Spur einmal aus. Wechselt eine Spur in einem Zyklus mehrmals (zwei /k/arr/laden vor
  // demselben Block), bleibt jede verlassene Senke stehen, nicht nur die letzte. Feste Größe, keine Allokation; ein Paar
  // (Senke, Spur) steht höchstens einmal, darum reicht eine Spur je Senke (intern und die Wirt-Slots).
  struct ArrWeg {
    ArrSenke* senke;
    int spur;
  };
  static constexpr int ARR_WEG_MAX = ARR_SPUREN * (2 + ARR_WIRT_SLOTS);   // intern, rack and the Wirt slots
  ArrWeg weg_[ARR_WEG_MAX] = {};
  int n_weg_ = 0;
  void weg_merken(ArrSenke* a, int spur);
  Offen offen_[ARR_OFFEN];
  int n_offen_ = 0;
  int64_t gesendet_bis_[ARR_SPUREN] = {};   // je Spur: Noten mit Ziel-Sample < gesendet_bis sind hinaus
  uint64_t noten_verloren_ = 0;
  // 1.8 T7b: the live table, per track and key the sink that got the live On (nullptr = not held) and the stamp of that On (live_aus_bis leaves a key that has not begun at the
  // stop sample). On the heap, made by the constructor: 64 KB inside the object would push test mains that hold a dozen Arrangements on the stack over the 8 MB limit.
  struct LiveTab {
    ArrSenke* senke[ARR_SPUREN][128] = {};
    int64_t an[ARR_SPUREN][128] = {};
  };
  std::unique_ptr<LiveTab> live_tab_{new LiveTab()};
  ArrSenke* (&live_)[ARR_SPUREN][128] = live_tab_->senke;
  int64_t (&live_an_)[ARR_SPUREN][128] = live_tab_->an;
  int n_live_ = 0;

  bool metro_an_ = false;
  bool metronom_gesperrt_ = false;
  float metro_g_ = 0.25f;
  int metro_ziel_ = 0;
  float klick_form_[ARR_KLICK_LAENGE] = {};
  int klick_rest_ = 0;
  float klick_pegel_ = 0.0f;
  float* metro_l_ = nullptr;         // Ziel des laufenden Blocks (Master- oder PFL-Eingang des Mixers)
  float* metro_r_ = nullptr;
  float* cue_l_ = nullptr;           // live modules task 6: the PFL input of the mixer in any case (also when the metronome goes to the master): the group cue taps are added here
  float* cue_r_ = nullptr;

  ArrFreeze* freeze_ = nullptr;      // laufender Freeze (Paket K3)
  ArrFreeze* freeze_fertig_ = nullptr;
  // 1.10 slice 7: the tap (arr_tap.cpp). Written only on the callback thread: abg_s0_ is set in block() and read in mischen() of the same block, no lock, no atomic.
  ArrAbgriff* abg_ = nullptr;
  ArrAbgriff* abg_fertig_ = nullptr;
  int64_t abg_gestartet_bei_ = -1;
  int64_t abg_s0_ = 0;              // start sample of the block (mischen() has no s0)
  bool abg_geerntet_ = false;       // a capture point wrote this block; if none did (strip idle), mischen() writes silence
  alignas(32) float abg_l_[ARR_BLOCK] = {};   // scratch of the per-sample capture points (track, group and return post)
  alignas(32) float abg_r_[ARR_BLOCK] = {};
  // plan 1.11 T12: the export run. Callback thread only (exp_s0_ is set in block() and read in mischen() of the same block)
  ArrExportLauf* exp_ = nullptr;
  int64_t exp_gestartet_bei_ = -1;
  int64_t exp_s0_ = 0;
  uint32_t exp_host_maske_ = 0;     // bit h-1: the project has a host stage with the flag an on host h
  bool exp_fertig_da_ = false;
  int32_t exp_fertig_status_ = 0;
  int64_t exp_fertig_ende_ = -1;
  int64_t freeze_gestartet_bei_ = -1;
  bool loop_gemerkt_ = false;        // Loop-Klammer des Nutzers, während eines Freeze ausgesetzt
  double start_gemerkt_ = 0.0;       // Fix L10: start_beat des Nutzers, während eines Freeze von_beat
  bool klammer_vorn_gemerkt_ = false;
};

}  // namespace cdj
