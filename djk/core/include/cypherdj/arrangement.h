// D1 K1 (Spec D1 2.2, 2.3, 2.6): Modul Arrangement im Kern. Spielt einen Wiedergabe-Schnappschuss (arr_playback.h)
// sample-genau auf der einen Uhr. Projekt-Beat p = Kern-Beat − ursprung + start_beat; ein Ereignis auf Projekt-Beat p
// liegt auf llround(sample_at(p + ursprung − start_beat)) (Konvention des Kerns). Teile: Transport mit Start-Regel,
// Quantisierung und Loop-Klammer (arrangement.cpp), Audio-Clip-Stimmen (arr_voices.cpp), Spur-Mixer spur/1..128, Gruppen grp/1..16 (die auch in Gruppen
// münden können) und Produktions-Master (1.10)
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
#include "cypherdj/pult_table.h"
#include <cypherdj/beatfx.h>
#include <cypherdj/dsp/colorfx.h>
#include <cypherdj/dsp/djfilter.h>
#include <cypherdj/dsp/isolator.h>
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
constexpr int ARR_PM = ARR_SPUREN + ARR_GRUPPEN;   // strip index of the production master: 0..127 tracks, 128..143 groups, 144 PM (returns 145..152)
constexpr int ARR_RET0 = ARR_PM + 1;              // 1.10 Slice 3 (P2): the return strips follow the PM, no existing index moves
constexpr int ARR_STREIFEN = ARR_PM + 1 + ARR_RETURNS;
// Automation slots: the lane machinery (auto_block and its state arrays) runs over the ARR_SPUREN tracks (slot = track) and the ARR_RETURNS returns (slot
// ARR_SPUREN + r, field 0 = fader only).
// Groups and the PM have no slot: the master takes no volume curve.
constexpr int ARR_AUTO_SLOTS = ARR_SPUREN + ARR_RETURNS;
// Fields per strip: 0 fader (dB), 1 pan, 2 mute, 3 solo. Tracks and groups: 4..7 send to return 1..4 (dB), 13..16 send to return 5..8. Returns: 4 hall on, 5..10 hall pre, decay, size, low, highcut, tail.
constexpr int ARR_FELDER = 24;   // loop deck channel strip KZ1: 11 -> 13 (the track EQ fields 10..12); container core K6: 13 -> 17 (the sends to returns 5..8, fields 13..16); K7: 17 -> 21 (track trim, fields 17..20: ARR_F_TRIM and the three kill fields; the track pfl rides on ARR_F_CUE); loop lane strip K1: 21 -> 24 (fields 21..23: spur/<n>/fx/1..3)
constexpr int ARR_F_SEND0 = 4;
constexpr int ARR_F_SEND4 = 13;   // K6: the sends to returns 5..8 sit behind the track EQ fields so that no existing field moves
constexpr int arr_f_send(int r) { return r < 4 ? ARR_F_SEND0 + r : ARR_F_SEND4 + (r - 4); }   // field of the send to return r (0-based)
// Live modules task 6: field 8 of a GROUP strip is its headphone cue switch (grp/<n>/cue). Groups use 0..3 and the sends 4..7, so 8 is free there (the return fields 8..10 belong to the return strips).
constexpr int ARR_F_CUE = 8;
static_assert(ARR_F_CUE >= ARR_F_SEND0 + 4 && ARR_F_CUE < ARR_FELDER, "the group cue field must not collide with the sends");
constexpr int ARR_F_FILTER = 9;   // loop deck K7a: spur/<n>/filter of a track (-1..+1); groups, returns and the PM never use it
static_assert(ARR_F_FILTER > ARR_F_CUE && ARR_F_FILTER < ARR_FELDER, "the track filter field must not collide with the sends or the group cue field");
// Loop deck channel strip KZ1: spur/<n>/eq/{tief,mitte,hoch} of a track (dB, -200 = kill), fields 10, 11, 12. Return strips use 8..10 for their hall values and tracks never read those, so the index 10 overlaps by design.
constexpr int ARR_F_EQ0 = 10;
static_assert(ARR_F_EQ0 > ARR_F_FILTER && ARR_F_EQ0 + 2 < ARR_FELDER, "the track EQ fields must follow the filter field and fit into the strip");
constexpr int ARR_F_TRIM = 17;    // container core K7: spur/<n>/trim of a track (dB, before the strip)
constexpr int ARR_F_KILL0 = 18;   // container core K7: spur/<n>/kill/{tief,mitte,hoch} of a track (fields 18..20, 0/1)
constexpr int ARR_F_FX0 = 21;     // loop lane strip K1: spur/<n>/fx/{1,2,3} of a track (fields 21..23, 0/1: beat FX unit 1, unit 2, the FX 3 bus)
static_assert(ARR_F_FX0 == ARR_F_KILL0 + 3 && ARR_F_FX0 + 2 < ARR_FELDER, "the track fx fields follow the kill fields and fit into the strip");
static_assert(ARR_F_TRIM > arr_f_send(ARR_RETURNS - 1) && ARR_F_KILL0 == ARR_F_TRIM + 1 && ARR_F_KILL0 + 2 < ARR_FELDER, "the track trim and kill fields follow the sends and fit into the strip");
static_assert(ARR_F_SEND4 > ARR_F_EQ0 + 2 && arr_f_send(ARR_RETURNS - 1) < ARR_FELDER, "the sends to returns 5..8 follow the EQ fields and fit into the strip");
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
  // kraken patch field: pin [satz][zeile][spalte] of the matrix of the track's graph to wert (-1..1), `gen` = Arrangement::snapshot_generation() when the pin was sent. Callback thread, before block(). Default: ignored.
  virtual void stift(int spur, int satz, int zeile, int spalte, float wert, uint64_t gen) noexcept {
    (void)spur; (void)satz; (void)zeile; (void)spalte; (void)wert; (void)gen;
  }
  virtual void transport_start(int spur, int64_t ziel) noexcept = 0;     // K2: Zustand zurücksetzen (RB-FFI, Spec 2.4)
  // audit U33: the start announced by transport_start() is cancelled before it took effect (stop while the start was waiting): forget the pending
  // start and the fade prepared for it. Default: nothing to forget.
  virtual void transport_abbruch(int spur) noexcept { (void)spur; }
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
  // sampler A2 (E8.3): the value of a LATCHED device knob (ArrSpur::bk_rastet) at the project beat of the note-on that is sent with it, evaluated by the core from the device lane
  // at that beat. `param` is 0..63 (k1..k64), `ziel` the target sample of the note-on (same sample, same offset rule), `relativ` true: `wert` is a summand (-1..1) the sink adds
  // to its base value of the knob (a relative lane without an absolute one); false: `wert` is the final value (0..1, absolute lane, clamped sum with a relative one). Called by the
  // Arrangement on the caller thread right BEFORE note() of the same note-on; never for a live note, never for a track without a latched knob. Default: ignored (a sink that
  // does not latch knobs keeps the block value of auto_parameter).
  virtual void note_regler(int spur, int64_t ziel, int param, float wert, bool relativ) noexcept {
    (void)spur;
    (void)ziel;
    (void)param;
    (void)wert;
    (void)relativ;
  }
  // Tracker task 16: a pitch (pegel false: bend in semitones) or level (pegel true: factor) event of the track at sample `ziel`, handed by the Arrangement like note() (same sample rule, same
  // lead). `gleit_samples` 0 jumps to `wert`, above 0 the value is reached linearly after that many samples from the value in force at `ziel`. Only for a bk track with events; never from a
  // lane unit. Default: ignored (only the Baukasten sink has a pitch and a level).
  virtual void fx(int spur, int64_t ziel, bool pegel, float wert, int64_t gleit_samples) noexcept {
    (void)spur;
    (void)ziel;
    (void)pegel;
    (void)wert;
    (void)gleit_samples;
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
  int spur = 0;                    // 1..128 (ARR_SPUREN)
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

// 1.12 S3 (§4.11 /k/arr/auto, §5.13 /e/auto): OSC counts the tracks 1..128 (0 = all), the Arrangement 0..127. The ONE place of that conversion; the field
// names live in the
// generated list v::werte::auto_ziel (index = field 0..3, see AUTO_FELDER), nowhere else in C++.
inline constexpr int auto_spur_index(int osc_spur) { return osc_spur - 1; }
inline constexpr int auto_spur_osc(int index) { return index + 1; }

// Loop deck K2: the launcher plays cells (loops, one-shots) on its own voices, independent of the transport and of the clip pool.
constexpr int ARR_LAUNCH_SPUREN = 8;      // 2 decks x 4 tracks
// Loop lane strip K3/K4: the beat FX units of the launcher tracks. One BeatFx is about 5.6 MB resident (echo line 2.9 MB, Cypher Hall 2.6 MB, flanger), so the arrangement holds a POOL of ARR_FX_POOL instances per unit,
// not one per track: a track gets a slot while it is a launcher track (it has cells); the pool is the 8 launcher tracks, 2 units x 8 = 16 instances. A track without a slot plays dry on spur/<n>/fx/1 and /2.
constexpr int ARR_FX_EINHEITEN = 2;       // beat FX unit 1 and 2 (the Mixer's FX_EINHEITEN)
constexpr int ARR_FX_POOL = ARR_LAUNCH_SPUREN;
constexpr int ARR_FX3_BLENDE = 480;       // the assign / release blend of the FX 3 share, S-curve: the Mixer's MIX_ZIEL_BLENDE (static_assert in core_container.cpp)
constexpr int ARR_LAUNCH_STIMMEN = 24;    // per track: playing + incoming + fading tails
constexpr int ARR_LAUNCH_PAESSE = 48;     // K3: keylock passes (one werk voice each) shared by all launcher voices
constexpr int ARR_LAUNCH_PAESSE_JE = 4;   // K3: passes one keylock voice holds at a time (playing, its successor after a tempo change, the next ones)
enum class LaunchGrund : uint8_t { ok = 0, zelle_leer, spur_bereich, ausserhalb_bereich, nicht_geladen };
struct LaunchMeldung { int64_t id; int status; int64_t sample; double beat; LaunchGrund grund; };   // status 3 (takes effect), 5 (late), 7 (replaced)
struct LaunchStand {
  uint64_t kennung;
  char text[33];
  int zelle;            // 0 silent
  bool verwaist;        // K5
  double ab_beat, versatz_beats;
  int wartend;          // -1 none, 0 stop, 1..8 start
  double wartend_ab;
  uint64_t meldungen_verloren;   // K5: receipts dropped because the 128-entry buffer was full (same value in every entry; for K6 and diagnosis)
};

// S1b K5: the gain envelope of a launcher voice on the re-pitch paths (plain and fallback) is read per sample on the cell position. At a discontinuity (the loop wrap of a
// sawtooth, a step form) the factor glides linearly over ARR_NAHT samples from the factor played before it, as the keylock passes do by cross-fading. The state lives in the
// voice, so a discontinuity on a block boundary is seen too. Without a discontinuity the factor passes unchanged (bit-equal).
struct ZellGainGlatt {
  float vor = -1.0f;   // the envelope factor of the last sample read (-1: none yet)
  float aus = 1.0f;    // the factor played at the last sample
  float alt = 1.0f;    // the factor played just before the last discontinuity
  int64_t ab = -1;     // the sample of the last discontinuity, -1: none
  float an(float lin, int64_t t) {
    if (vor >= 0.0f && std::fabs(lin - vor) > 0.02f * std::max(lin, vor)) {
      alt = aus;
      ab = t;
    }
    vor = lin;
    float g = lin;
    if (ab >= 0 && t - ab < ARR_NAHT) g = alt + (lin - alt) * static_cast<float>(t - ab) / static_cast<float>(ARR_NAHT);
    aus = g;
    return g;
  }
};

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
  // DJ view places (decision 8): offline, a group with a DJ output sums into the master like any top group (and so into the production master tap). Called by the render before block 0 and by
  // nothing else: live (the switch off) such a group adds into the DJ pair of its channel (dj_ausgang) and the master tap does not carry it.
  void setze_dj_als_master() { dj_master_ = true; }
  void setze_senke_intern(ArrSenke* s) { senke_intern_ = s; spur_plan_gueltig_ = false; }
  void setze_senke_wirt(int slot, ArrSenke* s) {
    if (slot >= 1 && slot <= ARR_WIRT_SLOTS) senke_wirt_[slot - 1] = s;
    spur_plan_gueltig_ = false;
  }
  void setze_senke_strom(ArrSenke* s) { senke_strom_ = s; spur_plan_gueltig_ = false; }   // container core K7: the sink of the strom tracks (ArrArt::strom)
  void setze_senke_rack(ArrSenke* s) { senke_rack_ = s; spur_plan_gueltig_ = false; }   // 1.9 U6: the sink of the instrument-rack tracks (ArrArt::rack)
  void setze_filter_guete(double q) { for (cypherdj::dsp::DjFilter& f : filt_) f.setze_guete(q); }   // K7b: the Q of the track filters (kern.toml filter_guete, as the channel filters); not in the callback
  // Loop lane strip K2: the SOUND COLOR FX of the track filter stage. The core hands every sub-block the same art (0 FILTER = the DjFilter, 1..5 = ColorFx), parameter and samples per beat that the mixer gives its Kanalzug
  // objects (Mixer::color_art_ganz and friends). Pointer-free stores, callback thread, no allocation.
  void setze_color(int art, float param, double samples_pro_beat) noexcept {
    col_art_ = art >= 1 && art <= cypherdj::dsp::kColorArtMax ? art : 0;
    col_param_ = param;
    col_spb_ = samples_pro_beat;
  }
  // Loop lane strip K3: the unit settings of the beat FX (the core forwards Mixer::fx_einheit_setze and fx_takt here: the same art, beats, wet and parameter feed the instances of the tracks). Callback thread.
  void fx_einheit_setze(int einheit, int art, double beats, float wet, float param1, bool an) noexcept;
  void fx_slots_tauschen(const ArrSnapshot* neu) noexcept;
  void fx_takt(double beat0, double bps) noexcept { fx_beat0_ = beat0; fx_bps_ = bps; }
  // Loop lane strip K4: whether a graph sits on fx/3 (Mixer::fx3_graph_da), handed by the core before every block. Without a graph no track share is diverted.
  void setze_fx3_graph(bool da) noexcept { fx3_graph_ = da; }
  bool dj_fx3_da(int nr) const noexcept { return nr >= 1 && nr <= DJ_KANAELE && dj_fx3_da_[nr - 1]; }   // the pair of channel nr received a share in the last block
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
  bool auto_uebersteuert(int spur, int feld) const { return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER && auto_ueber_[spur][feld]; }
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
  int auto_regler(int spur, int feld) const { return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER ? spur_regler_[spur][feld] : -1; }
  bool auto_spielt() const { return status_ == ArrStatus::spielt; }
  // Session view S1b K5: the value strip field `feld` of strip `streifen` is mixed with at the end of the last block: the cell envelope while a launcher cell plays one for the field, else the knob value.
  float feld_ziel(int streifen, int feld) const;
  // S1b K6: the state mirror of the cell envelopes. Callback thread only (the kern reports /e/regler in the thread that runs block(), like auto_uebersteuert), so plain reads, no atomics.
  // huelle_wert: true while a launcher cell envelope drives the strip field (w = its value at the end of the last block); false when the knob rules, also in the release block back to it.
  // regler_huelle is the same asked by regulator index; feld_regler is the regulator of a strip field (-1: none), huellen_da() the cheap test whether any envelope is active.
  bool huelle_wert(int streifen, int feld, float& w) const;
  bool regler_huelle(int regler, float& w) const;
  int feld_regler(int streifen, int feld) const { return streifen >= 0 && streifen < ARR_SPUREN && feld >= 0 && feld < ARR_FELDER ? feld_regler_[streifen][feld] : -1; }
  bool huellen_da() const { return zell_an_; }
  // true if the lane of the field has played in the last block, i.e. auto_letzter_wert is a real lane value (same condition auto_lane_wert applies)
  bool auto_gespielt(int spur, int feld) const { return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER && auto_war_[spur][feld]; }

  // ---- Spur-Regler spur/<n>/{fader,pan,mute,solo}, Werte je Sample aus dem Stellwerk
  void setze_sofort(int regler, float wert);                 // Start, Neustart-Zustand (nicht während eines Blocks)
  void verlauf(int regler, const float* werte);              // gültig bis zum Ende des nächsten block()
  // Production plan task 8 (tests, diagnostics): is the transient override of knob k (0-based, 0..31) of Baukasten slot `slot` (0-based, 0..7) written? A playback build clears it.
  bool bk_ueber_da(int slot, int k) const { return slot >= 0 && slot < BK_UEBER_SLOTS && k >= 0 && k < BK_UEBER_KNOEPFE && bk_ueber_[slot][k].da; }

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
  // ---- 1.10 slice 5 U2b, K4: sources of a sidechain key (plan E2, E6, E7; D-V3). Before block() of the same cycle the kernel hands ARR_SCHLUESSEL buffers: l[i], r[i] for i = 0..3 are the containers
  // A..D (deck/1..4 in the file), i = 4..19 the stream buffers 1..16 (strom/1..16, erz/1 = stream 1). The pointers are valid for this one block, a nullptr (or l = r = nullptr) is a silent input.
  // The kernel hands them ALWAYS, live and in a render: a render has no deck playing and its inputs are silent by construction (E7).
  void dj_schluessel(const float* const* l, const float* const* r);
  // ---- DJ view places (decision 7, ADR 038; K5): the DJ outputs = the containers. Before block() of the same cycle the kernel hands the four stereo pairs (index i = container i + 1 = A..D, each of the
  // block's length, zeroed by the kernel) that the groups with a DJ output add into instead of the production master. The pointers are good for this one block and are cleared at its end (like dj_schluessel). A channel without a
  // pair (nullptr), or the offline switch, sends such a group to the master: nothing is lost and a caller without the pairs hears it on the master. No allocation, no lock: pointer stores.
  static constexpr int DJ_KANAELE = PULT_CONTAINER;   // K5: the DJ outputs a group may lead into: nr 1..4 = containers A..D (DJ output n is container n - 1; was nr 1..6 = pad/1, pad/2, deck/1..deck/4, ADR 038)
  // The caller passes exactly DJ_KANAELE entries per side (an array of that size; an entry may be nullptr for a channel without a pair): the parameter types say so, so a later widening cannot read past the end.
  void dj_ausgang(float* const (&l)[DJ_KANAELE], float* const (&r)[DJ_KANAELE]) noexcept {
    for (int i = 0; i < DJ_KANAELE; ++i) {
      dj_aus_l_[i] = l[i];
      dj_aus_r_[i] = r[i];
    }
  }
  // Loop lane strip K4: the pairs that the diverted FX 3 share of the tracks of DJ channel nr is added into (index i = container i + 1), zeroed by the kernel and valid for this one block like dj_ausgang. A channel
  // without a pair (or the offline render) diverts nothing.
  void dj_fx3_ausgang(float* const (&l)[DJ_KANAELE], float* const (&r)[DJ_KANAELE]) noexcept {
    for (int i = 0; i < DJ_KANAELE; ++i) {
      dj_fx3_l_[i] = l[i];
      dj_fx3_r_[i] = r[i];
    }
  }
  // true when the snapshot has a group on DJ channel nr (1..DJ_KANAELE) that the live path routes to a pair: the kernel zeroes and hands the pair only then (the other channels stay untouched, bit for bit)
  // (also while the tail of a group that just lost its DJ output is held, see dj_rest_)
  bool dj_kanal_aktiv(int nr) const noexcept {
    if (!snap_ || dj_master_ || nr < 1 || nr > DJ_KANAELE) return false;
    for (int g = 0; g < ARR_GRUPPEN; ++g)
      if (snap_->gruppe_dj[g] == nr || (dj_rest_n_ > 0 && dj_rest_[g] == nr)) return true;
    for (int r = 0; r < ARR_RETURNS; ++r)   // KZ3: a return on this channel (or its held tail) as well
      if (snap_->ret_dj[r] == nr || (dj_rest_n_ > 0 && ret_dj_rest_[r] == nr)) return true;
    return false;
  }

  // ---- Zustand (nur im Callback-Faden lesen)
  ArrZustand zustand(const Karte& k, int64_t s) const;
  const ArrSnapshot* snapshot() const { return snap_; }
  // DJ view places (decision 5): the DJ channel the group `gruppe` (its number 1..ARR_GRUPPEN, as in the snapshot file) leads into: 0 none (master or a parent group), 1..4 = containers A..D (K5)
  int dj_nr(int gruppe) const noexcept { return snap_ && gruppe >= 1 && gruppe <= ARR_GRUPPEN ? snap_->gruppe_dj[gruppe - 1] : 0; }
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
  ArrInserts& inserts_pegel() { return ins_; }                                // T9: the read-and-reset level readings (pegel_ein_db, pegel_aus_db); callback thread only
  const ArrInserts& inserts() const { return ins_; }                       // 1.10 slice 4a: readings of the insert pool
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
  // mehrkern slice 3.2: phase Q on the pool. mode 0 = aus (serial), 1 = an, 2 = auto (a synonym of an: both retry after an automatic switch-off, with a doubling back-off). Any thread (an atomic); the callback reads it once per block and a change drops the plan flag.
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
  const ArrStreifenMaske& kette_einheit() const { return kette_einheit_; }   // test seam (strand 12 B2): the tracks whose chain ran in their track unit in the last block
  void setze_kette_einheit_aus(bool aus) { kette_einheit_aus_ = aus; }        // test seam, before the block: true keeps every chain in mischen() (the old order, a reference)
  const float* spur_bus_l(int i) const { return i >= 0 && i < ARR_SPUREN ? bus_l_[i] : nullptr; }                  // test seam: the raw track signal of the last block (before chains, if any)
  const float* spur_bus_r(int i) const { return i >= 0 && i < ARR_SPUREN ? bus_r_[i] : nullptr; }
  bool spur_plan_gueltig() const { return spur_plan_gueltig_; }               // test seam: false = it is rebuilt at the start of the next block
  const ArrReturns& returns() const { return ret_; }                         // counters and test seams of the return Halls
  uint64_t ruhe_zaehler() const { return ruhe_n_; }                              // blocks taken on the quiet path (test seam, P15)
  bool gruppe_belegt(int g) const { return grp_belegt_[g]; }                  // mindestens eine Spur oder benutzte Untergruppe im Schnappschuss schickt in die Gruppe
  // Produktions-Master des zuletzt gerechneten Teilblocks (m Werte, nach dem PM-Fader, ohne Metronom): Summe in erz/4 und Export-Abgriff
  const float* pm_l() const { return pm_l_; }
  const float* pm_r() const { return pm_r_; }
  bool eq_leer(int spur) const { return iso_lage_[spur] == 0 && iso_[spur].leer(); }   // loop deck channel strip KZ2 (tests): the isolator of the track is in bypass and holds no state
  bool filter_leer(int spur) const { return filt_[spur].leer(); }
  bool color_leer(int spur) const { return col_[spur].ruhig(0.0); }   // loop lane strip K2 (tests): the colour fx of the track holds no state (art FILTER counts as empty)
  int color_art() const { return col_art_; }
  int fx_slot(int spur) const { return fx_slot_[spur]; }   // loop lane strip K3 (tests): the pool slot of the track, -1 none
  const cdj::BeatFx& fx_instanz(int einheit, int spur) const { return fx_pool_[einheit * ARR_FX_POOL + (fx_slot_[spur] < 0 ? 0 : fx_slot_[spur])]; }   // the instance of the track's slot (slot 0 when it has none)
  float fx3_gewicht(int spur) const { return fx3_gew_[spur]; }   // loop lane strip K4 (tests): the share of the track that goes into the fx/3 bus input   // loop deck K7b (tests): the DJ filter of the track holds no state
  float wert(int spur, int feld) const { return w_[spur][feld].w; }   // feld 0 fader (dB), 1 pan, 2 mute, 3 solo
  int stimmen() const;
  // Loop deck K2 (arr_launcher.cpp). Callback thread, no allocation, no lock. See the plan lane K, task K2.
  LaunchGrund launch_start(uint64_t kennung, int zelle, double ab_beat, double versatz_beats, int64_t id, bool von_cypher);
  LaunchGrund launch_stopp(uint64_t kennung, double ab_beat, int64_t id, bool von_cypher);
  void launch_block(const Karte& k, int64_t s0, int m);
  int launch_stimmen() const;                          // sounding launcher voices
  bool launch_ruhig() const;                           // no voice and nothing pending
  void test_launch_paesse_sperren() noexcept;          // tests only: takes every keylock pass slot that is free now (a pool that is full); never given back
  int launch_meldungen(LaunchMeldung* aus, int max);   // drains the receipts
  int launch_stand(LaunchStand* aus, int max) const;   // one entry per deck track that has cells, a voice or a pending launch
  // K5: snapshot swap (called by tausche before snap_ is replaced; neu == nullptr is an unload), /k/set/neu and unload, KI stop. Callback thread.
  void launch_tauschen(const ArrSnapshot* neu, int64_t s);   // re-resolve every track state, pending launch and voice by kennung
  void launch_alles_aus(int64_t s, bool sofort);             // every voice fades over ARR_NAHT from s (sofort: ends at s), pending launches dropped (receipt 7), holds released
  void launch_ki_stopp();                                    // drops the pending launches that came from cypher (receipt 7)
  uint64_t launch_meldungen_verloren() const { return lm_verloren_; }
  uint32_t launch_aenderung() const { return launch_aend_; }   // increments on every state change
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
  // kraken patch field: one pin of the matrix of a bk track, callback thread before arr_->block like live_note. Goes to the sink of the track now (senke_fuer) stamped with snap_gen_; the sink
  // drops a pending pin whose stamp is older than the generation of the snapshot it plays (a swap in between: the newer snapshot was built from a project that already held the pin or undid it). Nothing when there is no sink.
  void live_stift(int spur0, int satz, int zeile, int spalte, float wert) noexcept;
  int live_offene_noten() const noexcept { return n_live_; }
  static int64_t live_ziel(int64_t zyklus_start, uint32_t versatz, int n) noexcept {
    const int64_t erster = std::min<int64_t>(n > 0 ? n : 1, ARR_BLOCK);   // length of the first sub-block of the cycle
    return zyklus_start + std::min<int64_t>(versatz, erster - 1);
  }
  uint64_t noten_verloren() const { return noten_verloren_; }
  // 2026-11-21 (Andreas: variant a): note-ons of a muted pattern are not sent, so its sink falls silent and rests (the Baukasten sink resets after 1 s of silence and
  // computes nothing until a note) instead of computing at full cost behind a closed mute. Counted here. setze_stumm_ruhe(false) = the old way (test seam).
  uint64_t noten_stumm() const { return noten_stumm_; }
  void setze_stumm_ruhe(bool an) { stumm_ruhe_ = an; }
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
  void auto_send(int m);                                                     // send automation: before mischen(): one gain ramp per block and send lane, read by sends_bereiten()
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
  void fx_fenster(const Karte& k, int spur, ArrSenke* se, int64_t von, int64_t bis);   // tracker task 16: bend and pegel events of the same window (arr_notes.cpp)
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
  // the sample where the active freeze, tap or export run ends (its window start plus its length; the tap and the export window are shifted by the path latency), -1 without a run
  int64_t lauf_ende() const { return freeze_ ? freeze_->start_s + freeze_->frames : abg_ ? abg_->start_s + abg_->frames : exp_ ? exp_->start_s + exp_->frames : -1; }

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
  // Loop deck K2: the launcher pool, separate from st_ (E0: no clip-voice routine touches it). A voice owns copies of what it plays.
  struct LStimme {
    bool aktiv = false;
    bool aktuell = false;     // the voice the track state refers to (not a fading tail)
    int spur = 0;             // track index at launch time
    ArrZelle z;
    double anker = 0.0;       // core beat of sample t0 (phase origin)
    double versatz = 0.0;     // position inside the cell at the anchor, beats
    int64_t t0 = 0;           // un-clamped effect sample (one-shot frame 0)
    int64_t start = 0;        // first sounding sample
    int64_t ein_n = 0;        // 0: hard onset, else fade-in length from start
    int64_t aus_ab = -1;      // fade-out start (ARR_NAHT long), -1: none
    // K3 (keylock): a loop cell with the warp works plays one werk voice per pass (LPass). The pass numbers count from the first pass, which starts at
    // q0 = core beat of the anchor - versatz; pass p starts at the core beat q0 + p * beats. ps indexes lp_ (-1: free).
    bool kl = false;
    bool vorab = false;       // prepared for a pending launch, not yet in effect (never played)
    double q0 = 0.0;
    int64_t nr_next = 0;      // the next pass number to set up
    int ps[ARR_LAUNCH_PAESSE_JE] = {-1, -1, -1, -1};
    // Passes without a pass slot or werk slot (pool full): they play as re-pitch from the cell, one range [fb_von, fb_ende) of consecutive passes. The joins
    // with keylock passes cross-fade over ARR_NAHT: fb_ein_ab fades the range in, fb_aus_ab fades it out (the range then ends at fb_aus_ab + ARR_NAHT).
    int64_t fb_von = -1, fb_ende = -1;          // first sounding sample, end of the last pass (exclusive); fb_ende <= fb_von: none
    int64_t fb_ein_ab = -1, fb_aus_ab = -1;     // -1: none
    int64_t fb_nr0 = 0, fb_nr1 = 0;             // first and last pass number of the range
    ZellGainGlatt gl;                           // S1b K5: the glide of the gain envelope at a discontinuity (re-pitch and fallback reads)
  };
  struct LPass {
    bool belegt = false;
    int platz = -1;           // the werk slot of this pass (kept after the werk gave it back: werk_stimme_spielen sets Stimme::werk to -1)
    bool warte = false;       // freed, but the werk thread may still read c and w (an order of that werk slot is open): the slot stays taken until launch_ernten sees it closed
    int64_t nr = 0;
    int64_t von = 0, ende = 0;   // first sounding sample and end sample (exclusive) of the pass on the core clock
    Stimme s;                 // the werk voice; s.clip points at c
    ArrClip c;                // the copy the werk reads (start_beat 0, laenge_beats = cell beats, 2-marker warp)
    ArrWarp w;
    double wb[2] = {0.0, 0.0}, wf[2] = {0.0, 0.0};
    ZellKarte zk;             // K4: the cell's read map the werk thread copies at the takeover (WarpAnsatz::zell_karte); freed with the pass (warte), like c and w
  };
  struct LSpur {
    bool belegt = false;
    uint64_t kennung = 0;
    char text[33] = {};
    int zelle = 0;
    bool verwaist = false;
    double ab_beat = 0.0, versatz = 0.0;
    int wartend = -1;         // -1 none, 0 stop, 1..8 start
    double wartend_ab = 0.0, wartend_versatz = 0.0;
    int64_t wartend_id = 0;
    bool wartend_cypher = false;
    int wartend_spur = 0;
    ArrZelle wartend_z;
    int vorab = -1;           // K3: index in v of the voice prepared for the pending start, -1: none
    LStimme v[ARR_LAUNCH_STIMMEN];
  };
  static constexpr int LAUNCH_MELDUNGEN = 128;
  LSpur ls_[ARR_LAUNCH_SPUREN];
  LPass lp_[ARR_LAUNCH_PAESSE];
  uint32_t launch_gen_ = 0;   // K3: the tempo map generation the launcher has seen
  LaunchMeldung lm_[LAUNCH_MELDUNGEN];
  int lm_n_ = 0;
  uint64_t lm_verloren_ = 0;   // K5: receipts lost to buffer overflow
  uint32_t launch_aend_ = 0;
  void launch_spur_beenden(LSpur& t, int64_t s, bool sofort);   // K5: drop the pending launch of t, fade or end its voices
  void launch_melden(int64_t id, int status, int64_t sample, double beat);
  void launch_anwenden(LSpur& t, const Karte& k, int64_t s0);
  void launch_spielen(LStimme& v, const Karte& k, int64_t s0, int m, int64_t lo = INT64_MIN, int64_t hi = INT64_MAX);
  // K3 keylock voices (arr_launcher.cpp)
  bool launch_kl_zelle(const ArrZelle& z) const { return werk_ && z.art == ArrZellArt::loop && z.modus == 2 && z.audio && z.beats > 0.0; }
  void launch_frei(LStimme& v);                                   // give back the werk slots and passes of v
  void launch_pass_frei(LStimme& v, int j);
  int64_t launch_pass_von(const LStimme& v, const Karte& k, int64_t nr) const;
  bool launch_pass_vor(LStimme& v, const Karte& k, int64_t s0, int64_t nr, int64_t von, bool zwingend);
  void launch_fb_pass(LStimme& v, int64_t s0, int64_t nr, int64_t von, int64_t ende);   // a pass as re-pitch (no slot)
  void launch_fb_spielen(LStimme& v, const Karte& k, int64_t s0, int m);
  void launch_ernten();                                           // pass slots whose werk thread is done with them become free again
  void launch_kl_block(LStimme& v, const Karte& k, int64_t s0, int m, bool karte_neu);
  void launch_vorab(LSpur& t, const Karte& k, int64_t s0, int m, bool karte_neu);
  void launch_vorab_frei(LSpur& t);
  void launch_kl_aus(LStimme& v, int64_t ab);
  // S1b K5: cell envelopes on the cell position. launch_huellen() (end of launch_block) evaluates the field envelopes of each track's current voice at the block end and writes the ramp
  // from the value of the last block into zell_buf_; mischen() reads the strip field through wert_ueber(). A release (the cell stopped, or another cell without envelope for the field
  // took over) ramps back to the knob value over that one block (frei), then the knob rules again. Only the filter and the sends are ever set (zell_slot).
  void launch_huellen(const Karte& k, int64_t s0, int m);
  Wert wert_ueber(int streifen, int feld) const;
  void zell_ueber_loslassen();   // the quiet path (nothing loaded, nothing sounds): every envelope override ends at once
  uint64_t stimmen_verloren_ = 0;
  static constexpr int ZELL_SLOTS = 1 + ARR_RETURNS;   // S1b K5: slot 0 the filter, slot 1 + r the send to return r
  static int zell_slot(int feld) {
    if (feld == ARR_F_FILTER) return 0;
    for (int r = 0; r < ARR_RETURNS; ++r)
      if (feld == arr_f_send(r)) return 1 + r;
    return -1;
  }
  struct ZellUeber {
    bool da = false;     // the strip reads w (end of block) and zell_buf_ (per sample) instead of the knob
    bool frei = false;   // this block is the release ramp back to the knob; the flag ends at the next block
    float w = 0.0f;      // value at the end of the last block
    int8_t zeile = -1;   // the row of zell_buf_ holding the ramp of this block
  };
  static constexpr int ZELL_ZEILEN = 80;   // 8 launcher tracks * (filter + ARR_RETURNS sends) = 72 fields at most, one row each (a release block reuses the row of its field)
  ZellUeber zell_ueber_[ARR_SPUREN][ARR_FELDER];
  float zell_buf_[ZELL_ZEILEN][ARR_BLOCK] = {};   // 320 KiB (80 rows * ARR_BLOCK * 4 B), a member: no allocation in the callback
  bool zell_zeile_[ZELL_ZEILEN] = {};             // row taken
  bool zell_an_ = false;                                     // some zell_ueber_ is set (the release scan can be skipped otherwise)
  // Automation: 8 KiB of project beats per block (ap_); the lane buffers auto_buf_ below are ARR_AUTO_SLOTS (136) * 4 fields * 1024 * 4 B = 2176 KiB at 128
  // tracks
  double ap_[ARR_BLOCK] = {};                      // project beat per sample of the block (only filled while a lane plays)
  // Automation slice 2: the fields 0..3 of a track (fader dB, pan, mute 0/1, solo 0/1) can each play a lane. One buffer per track and field (E7, members: no
  // allocation).
  static constexpr int AUTO_BLENDE_FELDER = 2;   // the fields 0 (fader) and 1 (pan) have a source blend; mute and solo (2, 3) have none
  float auto_buf_[ARR_AUTO_SLOTS][AUTO_FELDER][ARR_BLOCK] = {};   // the lane value or the blend per sample; Wert::vl points here for a block
  int auto_von_ = 0, auto_bis_ = 0;                // block-relative range [von, bis) in which the lane plays (transport running)
  AutoLane auto_l_[ARR_AUTO_SLOTS][AUTO_FELDER];       // cursor per track and field on the lane of the current snapshot
  AutoLane auto_g_[ARR_SPUREN][ARR_GERAET_LANE_PARAMS]; // cursor per track and device parameter on the `geraet` lane of the current snapshot
  // 1.12 slice 5 (D9): the cursors of the RELATIVE lanes (summands of the value stack), per track and fader/pan field and per device parameter. New names: kern_bitgleich_auto reads the ones above.
  AutoLane auto_r_[ARR_AUTO_SLOTS][AUTO_BLENDE_FELDER];
  AutoLane auto_gr_[ARR_SPUREN][ARR_GERAET_LANE_PARAMS];
  AutoLane auto_k_[ARR_KLANES_MAX];                // 1.12 slice 6: cursor per insert / rack lane of the current snapshot (index = ArrSnapshot::klane)
  // Send automation (ARR_AUTO_SEND, arr_auto.cpp auto_send): per track and return ONE gain ramp per block, fixed-size members, no buffer per sample. The plan is what sends_bereiten reads.
  // The gain runs a0 -> b0 over the samples [0, ts) and, when a loop seam lies inside the block, a1 -> b1 over [ts, m); without a seam ts = m and the second part is unused.
  struct SendPlan {
    float a0 = 0.0f, b0 = 0.0f, a1 = 0.0f, b1 = 0.0f;   // linear gains at the start and end of the two ramp parts
    int ts = 0;                                          // first sample of the second part (the loop seam), m: none
    bool da = false;                                     // the lane (or its ramp back to the knob) rules this send in this block
  };
  SendPlan send_plan_[ARR_SPUREN][ARR_RETURNS];
  AutoLane auto_s_[ARR_SPUREN][ARR_RETURNS];           // cursor per track and send lane of the current snapshot (reset in auto_tausch, searched anew per block)
  float send_lin_[ARR_SPUREN][ARR_RETURNS] = {};       // the lane gain at the end of the last block (held while the transport stands)
  bool send_da_[ARR_SPUREN][ARR_RETURNS] = {};         // the lane drove this send in the last block (the knob was not heard)
  bool send_aktiv_ = false;                            // some send_plan_ entry or send_da_ flag is set (the quick exit of auto_send needs it)
  bool send_spielte_ = false;                          // the transport played in the last block (also without any lane in the snapshot, unlike send_lief_)
  bool send_lief_ = false;                             // the last block had running samples (project beats known)
  double send_p_ende_ = 0.0;                           // project beat of the last running sample of the last running block (a start or a jump back breaks the ramp)
  float auto_zuletzt_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};   // last value written to auto_buf_ (dB for the fader, pan units for pan)
  bool auto_war_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};        // the field wrote auto_buf_ in the last block
  // Step hold (task 8 fallback): the lane value is taken over for up to auto_schritt_ samples, so the mixer computes the gain (std::pow, cos/sin) only when the
  // value changes. A step larger than AUTO_HALT_DB (fader) or AUTO_HALT_PAN (pan) is taken at once. Mute and solo are not held (0/1 jumps). Live and render run the same function.
  int auto_schritt_ = 16;                          // samples per hold (1: every sample); set_auto_schritt is a test seam
  int auto_halt_n_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};      // samples the held value still stays
  float auto_halt_v_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};    // the held value
  // 1.12 slice 3 (D6): the lane override per track and field, core only. auto_ueber_ is the state after all changes. A change inside the running block is pending
  // until that block has run: auto_ueber_n_ (0..2) changes, at auto_ueber_s_ and auto_ueber_s2_, starting from auto_ueber_alt_ (the state at the block start). Two
  // changes flip the state twice, so auto_block plays alt before the first, !alt between them and alt after the second; each one starts its own source blend.
  bool auto_ueber_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};
  bool auto_ueber_alt_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};
  int8_t auto_ueber_n_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};
  int64_t auto_ueber_s_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};
  int64_t auto_ueber_s2_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};
  int auto_ueber_offen_ = 0;                            // fields with a pending change (auto_ueber_n_ > 0)
  bool auto_pickup_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};      // the pickup was handed out for the override that starts in this cycle (lane_wert answers false until then)
  float auto_lane_v_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};     // the last value the lane itself played (not a blend, not the hand)
  SpscRing<ArrAutoEreignis, 1024> auto_ev_;             // state changes for the net thread (task 3)
  std::atomic<uint32_t> auto_ev_verloren_{0};
  bool auto_vorausschau_ = true;                       // look-ahead inside a hold (auto_block); false only in tests
  bool auto_probe_aus_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};  // the look-ahead failed in the running hold window: no second try until the next latch
  // Source blend (D6, E8): field 0 (fader) blends in the gain, field 1 (pan) linearly in the pan value; mute and solo have none (the mixer fade applies).
  int32_t blende_n_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};     // samples of the source blend still to run (480)
  float blende_g0_[ARR_AUTO_SLOTS][AUTO_FELDER] = {};      // start value of the running blend: the gain (fader) or the pan value (pan) played just before the source change
  int64_t blende_s_[ARR_AUTO_SLOTS][AUTO_FELDER];          // absolute sample at which a blend starts, INT64_MIN: none (constructor)
  int64_t blende_s2_[ARR_AUTO_SLOTS][AUTO_FELDER];         // a second blend start in the same block (re-enable and grip within one block), INT64_MIN: none (constructor)
  double wp_[ARR_BLOCK] = {};        // Paket 1.13: Projekt-Beat je Sample des Teilblocks, einmal je Teilblock für alle gewarpten Stimmen
  float wl_[ARR_BLOCK] = {}, wr_[ARR_BLOCK] = {};   // Slice 2: Lesepuffer für den Ring einer Werk-Stimme
  WarpWerk* werk_ = nullptr;
  bool snap_werk_ = false;           // der Schnappschuss hat Clips im Modus COMPLEX oder TONES (beim Tausch bestimmt)
  uint64_t warp_unterlauf_ = 0, warp_kein_platz_ = 0, warp_spaet_ = 0;
  const uint32_t* karte_gen_ = nullptr;
  uint32_t karte_gen_gesehen_ = 0;
  cypherdj::dsp::DjFilter filt_[ARR_SPUREN];   // loop deck K7b: DJ filter of every track (field ARR_F_FILTER), run in mischen() behind the chain and the delay compensation
  // Loop lane strip K2: one ColorFx per track (heap, constructor; about 0.78 MB each, about 100 MB for all 128), run in place of the DjFilter while the
  // colour art is not FILTER
  std::unique_ptr<cypherdj::dsp::ColorFx[]> col_;
  int col_art_ = 0;                  // the art handed by the core (0 FILTER)
  float col_param_ = 0.5f;
  double col_spb_ = 0.0;
  int8_t col_lage_[ARR_SPUREN] = {};   // the art this track's filter stage last ran under (0 FILTER): a change clears the states
  // Loop lane strip K3: BeatFx instances (heap, constructor): [unit * ARR_FX_POOL + slot]. fx_slot_[track] is the slot of a launcher track (-1 none), fx_slot_kennung_[slot] the track identity that holds it.
  std::unique_ptr<cdj::BeatFx[]> fx_pool_;
  int8_t fx_slot_[ARR_SPUREN];
  uint64_t fx_slot_kennung_[ARR_FX_POOL] = {};
  int fx_art_[ARR_FX_EINHEITEN] = {};
  double fx_beats_[ARR_FX_EINHEITEN] = {1.0, 1.0};
  float fx_wet_[ARR_FX_EINHEITEN] = {};
  float fx_p1_[ARR_FX_EINHEITEN] = {0.5f, 0.5f};
  bool fx_an_[ARR_FX_EINHEITEN] = {};
  bool fx_auf_[ARR_FX_EINHEITEN][ARR_FX_POOL] = {};   // the instance input of the slot is open (spur/<n>/fx/<u> switched on), as Mixer::fx_zuw_
  double fx_beat0_ = 0.0, fx_bps_ = 128.0 / 60.0 / 48000.0;
  float fxs_l_[ARR_BLOCK], fxs_r_[ARR_BLOCK], fxs_zw_[ARR_BLOCK];   // what the track adds into its target, held back for the fx chain and the fx/3 split (scratch, mischen())
  // Loop lane strip K4: the share of a track that goes into the fx/3 bus input instead of its target (state as Mixer::fx3_*)
  bool fx3_graph_ = false;
  float fx3_gew_[ARR_SPUREN] = {};
  float fx3_von_[ARR_SPUREN] = {};
  int fx3_rest_[ARR_SPUREN] = {};
  bool fx3_zuw_[ARR_SPUREN] = {};
  float* dj_fx3_l_[DJ_KANAELE] = {};
  float* dj_fx3_r_[DJ_KANAELE] = {};
  bool dj_fx3_da_[DJ_KANAELE] = {};
  double filt_k_[ARR_BLOCK];               // the per-sample filter value of the track in work (scratch, mischen())
  // Loop deck channel strip KZ2: one 3-band isolator per track (fields ARR_F_EQ0 + 0..2), run in mischen() right behind the DJ filter. Heap, allocated once in the constructor (about 24 KB each: not on the stack).
  std::unique_ptr<cypherdj::dsp::Isolator[]> iso_;   // ARR_SPUREN isolators
  float iso_g_[3][ARR_BLOCK];                        // per-sample linear gains of the track in work (scratch)
  float iso_trocken_l_[ARR_BLOCK], iso_trocken_r_[ARR_BLOCK];   // dry copy for the bypass crossfade (scratch)
  uint8_t iso_lage_[ARR_SPUREN] = {};                // 0 bypass, 1 entering (crossfade dry -> wet), 2 running, 3 leaving (wet -> dry)
  int16_t iso_blende_[ARR_SPUREN] = {};              // wet share of the crossfade in samples (0..ARR_NAHT): 0 dry, ARR_NAHT wet
  Wert w_[ARR_STREIFEN][ARR_FELDER];   // per strip (track, group, PM, return) see ARR_FELDER; the PM has field 0 only
  int16_t regler_spur_[cypherdj::stellwerk::MAX_REGLER];
  int8_t regler_feld_[cypherdj::stellwerk::MAX_REGLER];
  int16_t spur_regler_[ARR_AUTO_SLOTS][4];   // 1.12 S3: the regulator of spur/<n>/{fader,pan,mute,solo} and (slot ARR_SPUREN + r, field 0) of ret/<r+1>/fader, -1: none (regler_binden)
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
  const float* dj_l_[ARR_SCHLUESSEL] = {};         // 1.10 slice 5 U2b: the DJ inputs of this block (dj_schluessel), reset at the end of block()
  const float* dj_r_[ARR_SCHLUESSEL] = {};
  float* dj_aus_l_[DJ_KANAELE] = {};             // DJ view places: the DJ pairs of this block (dj_ausgang), reset at the end of block()
  float* dj_aus_r_[DJ_KANAELE] = {};
  bool dj_master_ = false;                       // DJ view places: render only (setze_dj_als_master), never true in the live kern
  // A swap that takes the DJ output from a group (the module is cleared, the group leaves the snapshot) lets the fading tail of its tracks (96 samples) run into the DJ pair for DJ_REST samples
  // instead of the master: dj_rest_[g] is the channel the group had, dj_rest_n_ the samples left. Set in tausche(), counted down in mischen().
  static constexpr int DJ_REST = 960;
  uint8_t dj_rest_[ARR_GRUPPEN] = {};
  uint8_t ret_dj_rest_[ARR_RETURNS] = {};   // KZ3: the DJ channel a return held before a swap removed or rerouted it, for its fade (counted by dj_rest_n_ as well)
  int dj_rest_n_ = 0;
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
  // Production plan task 8 (D10, D11): the rows spur/<slot>/bk/<k> as a transient override of the Baukasten knobs. regler_bkz_: row -> slot * BK_UEBER_KNOEPFE + (k - 1), -1: none (regler_binden).
  // bk_ueber_[slot][k]: the written value and flag; the flag is cleared by every tausche(). bk_slot_[i]: slot (0..SPUR_BK_SLOTS-1) of track index i in the CURRENT snapshot (the running number among
  // the tracks with the device bk, ascending track number), -1: not a bk track (every bk track has a slot: SPUR_BK_SLOTS == ARR_BK_MAX). bk_ueber_melden() reports every written value to the bk sink in every block, before auto_geraet().
  static constexpr int BK_UEBER_SLOTS = cypherdj::stellwerk::SPUR_BK_SLOTS, BK_UEBER_KNOEPFE = cypherdj::stellwerk::SPUR_BK_KNOEPFE;
  struct BkUeber {
    float wert = 0.0f;
    bool da = false;
    const float* vl = nullptr;   // verlauf(): the course of this block, the last sample is taken (bk_ueber_nehmen)
  };
  int16_t feld_regler_[ARR_SPUREN][ARR_FELDER];   // S1b K6: inverse of regler_spur_/regler_feld_ for the track strips (-1: no regulator)
  int16_t regler_bkz_[cypherdj::stellwerk::MAX_REGLER];
  BkUeber bk_ueber_[BK_UEBER_SLOTS][BK_UEBER_KNOEPFE];
  int8_t bk_slot_[ARR_SPUREN];
  void bk_ueber_nehmen(int m);    // a pointer course of the block becomes the written value (also on the quiet path: the pointer is good for one block)
  void bk_ueber_melden(int m);    // before auto_geraet(): every written value goes to the bk sink of its track, every block
  void bk_ueber_loeschen();       // tausche(): the new snapshot is the project value again; also computes bk_slot_ for the snapshot installed
  int16_t regler_ins_[cypherdj::stellwerk::MAX_REGLER];   // 1.10 slice 4a: controller -> global slot * INS_PARAM_MAX + parameter of ins/<art>/<n>/*, -1: none
  static_assert(ARR_INS_ALLE * INS_PARAM_MAX - 1 <= INT16_MAX, "regler_ins_ packs slot * INS_PARAM_MAX + parameter into int16_t");
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
  // Strand 12 B2 (mehrkern 3.3): the tracks whose trim and insert chain run inside their own track unit, on the lane that renders them, instead of in mischen().
  // Written on the caller only, in spur_quelle() before the fork (kette_einheit_planen); the units and mischen() read it. A track qualifies iff it has a chain or tail (ins_.hat),
  // it is a lane unit of spur_plan_ (not a rest track), no sink fades a track out (n_weg_ == 0), no stage it owns listens to a key (row sc or structural), it is no key source
  // (ins_.schluessel_maske(), a track-post capture), and neither the freeze tap nor the track-pre tap reads its bus between phase Q and mischen(). Everything else keeps the old order.
  ArrStreifenMaske kette_einheit_;
  bool kette_einheit_aus_ = false;              // test seam: true = every chain stays in mischen() (the reference of the old order)
  void kette_einheit_planen();
  void trim_anwenden(int i, int m);             // container core K7: the track trim in front of everything the strip does (the unit for a qualified track, mischen() for the others)
  int64_t q_s0_ = 0;                          // position of the running phase Q, written before schicke
  int q_m_ = 0;
  static constexpr int SPUR_MIN_LAST = 512;     // live units times block length below which the phase stays serial; task 9 sweep: 4 units already win (-60 us at 256, -25 us at 128), fewer were not measured
  bool spur_seriell_weil(int m);
  bool spur_konto_aus_ = false;   // set by spur_seriell_weil: this phase is serial because the track account is off (the serial phase is then measured)
  ArrSenke* senke_wirt_[ARR_WIRT_SLOTS] = {};
  ArrSenke* senke_rack_ = nullptr;
  ArrSenke* senke_strom_ = nullptr;   // container core K7
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
  uint64_t noten_stumm_ = 0;     // note-ons not sent because their track was muted at their sample (note_stumm)
  bool stumm_ruhe_ = true;
  int64_t noten_s0_ = 0;         // the block noten_block() works on: the mute course w_[i][2].vl covers [noten_s0_, noten_s0_ + noten_m_)
  int noten_m_ = 0;
  bool note_stumm(int spur, const ArrSenke* se, int64_t an) const;
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
