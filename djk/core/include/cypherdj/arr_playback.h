// D1 K1 (Spec D1 2.1, 3.2): die Wiedergabe eines Arrangements als unveränderlicher Schnappschuss. Der Seiten-Server
// schreibt <arr_ordner>/wiedergabe-<nr>.json; lade_wiedergabe() liest und prüft sie, lädt das Audio über den Cache
// (mmap + MAP_POPULATE + mlock, geteilt über Schnappschüsse, geschlüsselt nach sha256 mit Referenzzähler) und baut
// den Schnappschuss. Der eine Lader für Kern (Lade-Faden, arr_loader.h) und Render (K3). Nicht im Callback: der
// Callback liest nur die fertigen Felder über const-Zeiger.
#pragma once

#include <sys/mman.h>
#include <unistd.h>

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/kit.h"             // 1.9: the Kit struct (header-only destructor; kit.cpp stays out of the link of the standalone targets)
#include "cypherdj/store_account.h"
#include "cypherdj/warp_mapping.h"

struct CypherBk;   // cypher_bk_ffi.h (global, extern "C" functions): a Baukasten graph instance

namespace cdj {

constexpr int ARR_SPUREN = 32;           // Spur-Slots spur/1..32 (Spec 2.3, E3); = SPUR_REGLER_SPUREN (static_assert)
constexpr int ARR_CLIPS_MAX = 4096;     // je Wiedergabe (Spec 3.2)
constexpr int ARR_NOTEN_MAX = 65536;    // je Wiedergabe (Spec 3.2)
constexpr int ARR_WIRT_SLOTS = 2;       // arr_midi_<s>, s = 1..2 (Spec 2.4)
constexpr int ARR_GRUPPEN = 8;          // Gruppen-Spuren grp/1..8 (1.10, F1: eigene Plätze neben den 32 Spuren); = GRP_REGLER_GRUPPEN (static_assert in arr_output.cpp)
constexpr int ARR_RETURNS = 4;          // 1.10 Slice 3: return strips ret/1..4 (own places next to the 32 tracks and 8 groups); = RET_REGLER_RETURNS (static_assert in arr_returns.cpp)
constexpr int ARR_KETTE = 4;            // 1.10 slice 4a: stages per insert chain
constexpr int ARR_KETTE_PM = ARR_SPUREN + ARR_GRUPPEN;     // chain index of the PM (= ARR_PM, static_assert in arrangement.h)
constexpr int ARR_KETTE_RET0 = ARR_KETTE_PM + 1;           // chain index of return 1 (= ARR_RET0)
constexpr int ARR_KETTEN = ARR_KETTE_RET0 + ARR_RETURNS;   // strips with a chain, indexed like the strips: tracks 0..31, groups 32..39, PM 40, returns 41..44
constexpr int ARR_INS_KOMP = 12;        // 1.10 slice 4a: pooled compressors ins/komp/1..12
// 1.10 slice 4b: pooled EQs ins/eq/1..ARR_INS_EQ and saturators ins/saett/1..ARR_INS_SAETT. The sizes were decided by the cost measurement (T11, routing-1-10.md)
// and equal "instanzen" of docs/interfaces/insert_module.json (pinned by test_arr_inserts_vertrag and by the contract test in the stellwerk project).
#ifdef CYPHERDJ_MUTATION_INS_POOL_PLUS_EINS   // error case: a pool constant one above the rows of the table (the pool pin in test_arr_inserts_4b must go red)
constexpr int ARR_INS_EQ = 3;
constexpr int ARR_INS_SAETT = 2;
constexpr int ARR_INS_LIM = 2;
#else
constexpr int ARR_INS_EQ = 2;             // 2026-11-06: 1 -> 2 on Andreas' decision of 2026-11-05 (lane gate median 1650 us, measured on a quiet machine)
constexpr int ARR_INS_SAETT = 1;
constexpr int ARR_INS_LIM = 1;           // master limiter: ins/lim/1 (pool 1 over the whole project, "instanzen" in the contract)
#endif
constexpr int ARR_INS_ALLE = ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT + ARR_INS_LIM;   // one global slot index: komp first, then eq, saett, lim
constexpr int ARR_PARAMETER = 8;        // RB-338-Parameter je interner Spur (K2 liest sie)
constexpr int ARR_BK_MAX = 8;           // S20: Baukasten tracks per playback; = MAX_BK_SPUREN in model.ts
constexpr int ARR_KIT_MAX = 8;          // 1.9: kit tracks per playback (spec E15); counted over tracks AND rack members
// 1.9 U6 (spec E10, E15): instrument racks. A rack track holds up to ARR_RACK_GLIEDER members; every member of every rack takes one member slot
// of the internal sinks (ARR_GLIED_PLAETZE in all). The sinks (RB-338, Baukasten, kit) index their per-slot arrays with ARR_SENKEN_PLAETZE: slots
// 0..31 are the tracks, 32..63 the members, so a sink plays a member exactly like a track. The device of a member sits in
// ArrSnapshot::glied_spur[slot - ARR_SPUREN] (an ArrSpur holding only the device fields) and is read through ArrSnapshot::platz().
constexpr int ARR_RACK_GLIEDER = 4;      // members per rack
constexpr int ARR_RACK_MAX = 8;          // rack tracks per playback
constexpr int ARR_GLIED_PLAETZE = 32;    // member slots in total (= ARR_RACK_MAX * ARR_RACK_GLIEDER)
#ifdef CYPHERDJ_MUTATION_ARR_PLAETZE_NUR_SPUREN
constexpr int ARR_SENKEN_PLAETZE = ARR_SPUREN;   // error case: the sinks know no member slots, a member at slot >= 32 is dropped
#else
constexpr int ARR_SENKEN_PLAETZE = ARR_SPUREN + ARR_GLIED_PLAETZE;
#endif
static_assert(ARR_GLIED_PLAETZE == ARR_RACK_MAX * ARR_RACK_GLIEDER, "member slots = racks x members");
constexpr double ARR_GLIED_GAIN_DB_MIN = -60.0;   // member gain, one range with the project (spec E9)
constexpr double ARR_GLIED_GAIN_DB_MAX = 12.0;
constexpr double ARR_GAIN_DB_MIN = -96.0;    // Clip-Gain, ein Bereich mit S2 (Spec 6.27)
constexpr double ARR_GAIN_DB_MAX = 24.0;
constexpr int ARR_AUTO_PUNKTE_MAX = 65536;       // automation points per playback, all lanes (Automation Slice 1; = MAX_AUTO_PUNKTE in model.ts)
constexpr double ARR_HK_DB_MIN = -200.0;            // 1.12 slice 5: the range of a gain envelope in dB (boost stays the clip gain); -200 is mute, like a fader lane
constexpr double ARR_HK_DB_MAX = 0.0;
constexpr int ARR_AUTO_LANE_PUNKTE_MAX = 8192;   // automation points per lane (= MAX_LANE_PUNKTE in model.ts)
// Lane targets (automation slice 2). The reader maps the project's `ziel` strings onto these from one table (arr_playback.cpp).
constexpr uint8_t ARR_AUTO_FADER = 0;            // the track fader (dB)
constexpr uint8_t ARR_AUTO_PAN = 1;              // pan -1..1
constexpr uint8_t ARR_AUTO_MUTE = 2;             // mute 0 or 1, jump points only
constexpr uint8_t ARR_AUTO_SOLO = 3;             // solo 0 or 1, jump points only
constexpr uint8_t ARR_AUTO_GERAET = 4;           // a parameter of the internal device (RB-338), ArrAutoLane::param tells which, 0..1
// Device parameter names by ArrAutoLane::param: own 0..3 numbering, not the rb_dsp ID order; task 4 maps it to the ID string via this table.
constexpr int ARR_GERAET_PARAMS = 4;             // device lane parameters; every table and array of them is sized by this
constexpr const char* ARR_GERAET_PARAM_NAME[ARR_GERAET_PARAMS] = {"lautstaerke", "cutoff", "resonanz", "env_mod"};
constexpr int ARR_AUTO_LANES_JE_SPUR = 16;       // at most one absolute and one relative lane per (ziel, param): 8 + 8 slots (mute and solo take no relative lane, so 14 in use)
constexpr double ARR_BLENDE_TOLERANZ = 1e-9;  // ein_beats + aus_beats <= laenge_beats + Toleranz (wie S2, model.ts)

// FNV-1a 64 über den ID-Text (Clip-ID, Noten-ID "<clip_id>/<noten_id>"); der Lader prüft Eindeutigkeit je Spur.
inline uint64_t arr_id(const char* t, size_t n) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < n; ++i) {
    h ^= static_cast<uint8_t>(t[i]);
    h *= 1099511628211ULL;
  }
  return h;
}
inline uint64_t arr_id(const std::string& t) { return arr_id(t.data(), t.size()); }


// Automation (ADR 032): one point of a lane. beat = project beat, wert = unit of the target (fader dB -200..6, pan -1..1,
// mute/solo 0 or 1, device 0..1), form = segment INTO this point (0 linear, 1 s-curve, 2 jump). 16 bytes.
struct ArrAutoPunkt {
  double beat;
  float wert;
  uint8_t form;
};
struct ArrAutoLane {
  uint8_t ziel;                     // ARR_AUTO_FADER, _PAN, _MUTE, _SOLO or _GERAET
  uint8_t param;                    // ARR_AUTO_GERAET: index into ARR_GERAET_PARAM_NAME (0..3); else 0
  bool relativ;                     // 1.12 slice 5: a summand lane (modulation), added to the base value or the absolute lane of the same target, then clamped; fader (dB), pan, geraet.* only
  int n;                            // points, at least 1, beats not falling (two at one beat are a jump)
  const ArrAutoPunkt* p;            // into ArrSnapshot::auto_punkte
};
static_assert(sizeof(ArrAutoLane) == 16, "the flag sits in the padding: the lane table keeps its size (the snapshot pages are booked by it)");

struct ArrAudio;   // unten, nach den Seiten-Helfern (eigene Seiten)

struct ArrClip {
  uint64_t id;
  double start_beat, laenge_beats;   // absolute Projekt-Beats
  const ArrAudio* audio;
  int64_t offset_frames;
  float gain;                        // linear, aus gain_db
  double ein_beats, aus_beats;
  const ArrWarp* warp = nullptr;     // Paket 1.13: gewarpter Clip (Marker in ArrSnapshot::warps); nullptr: Quellposition = offset_frames + pos
  // 1.12 slice 5 (D8): the gain envelope of this clip (loop copy), points in copy-local beats [0, laenge) -> dB -200..0 on top of `gain`; into
  // ArrSnapshot::hk_punkte (never into auto_punkte). hk_n 0: no envelope.
  const ArrAutoPunkt* hk = nullptr;
  int hk_n = 0;
};

struct ArrNote {
  uint64_t id;
  double beat, laenge;               // absolute Projekt-Beats
  uint8_t ton, vel;
};

enum class ArrArt : uint8_t { leer = 0, audio = 1, intern = 2, wirt = 3, rack = 4 };   // 1.9: rack = an instrument rack (ArrSpur::glied)

struct ArrParameter {
  char name[16];
  float wert;                        // 0..1 normiert (Spec 2.4)
};

// 1.9 U6 (E9, E10): one member of an instrument rack. The zones and the chain range are inclusive; a note goes to the member when its key,
// its velocity and the chain value of the rack (ArrSpur::kette) all lie inside. The DEVICE of the member (rb338, bk, kit with their parameter,
// graph, instance; or a Surge slot) is not stored here but in ArrSnapshot::glied_spur[platz - ARR_SPUREN], so that the sinks read it exactly
// like the device of a track.
struct ArrGlied {
  uint64_t id = 0;                   // arr_id of the member id (unique inside the rack)
  ArrArt art = ArrArt::leer;         // intern (device in glied_spur) or wirt (Surge, slot)
  int platz = 0;                     // member slot ARR_SPUREN..ARR_SPUREN + ARR_GLIED_PLAETZE - 1 (the slot index the sinks are addressed with)
  int slot = 0;                      // wirt: 1..ARR_WIRT_SLOTS
  uint8_t ton_lo = 0, ton_hi = 127;
  uint8_t vel_lo = 1, vel_hi = 127;
  uint8_t kette_lo = 0, kette_hi = 127;
  float gain = 1.0f;                 // linear, from gain_db -60..+12
};

struct ArrSpur {
  int nr = 0;                        // 1..ARR_SPUREN (32); 0 = leer
  ArrArt art = ArrArt::leer;
  int8_t ausgang = 0;                // 1.10: 0 master, 1..ARR_GRUPPEN Gruppe (Wiedergabe /2); Tiefe 1
  int slot = 0;                      // wirt: 1..2
  char geraet[16] = {};              // intern: "rb338" or "bk"
  // S20, device bk: graph name (the file stem in the graph folder) and the instance. The instance belongs to the graph store of the
  // ArrAudioCache (reference counted by the snapshots, ArrSnapshot::bk_refs); the callback reads it only. bk_gen is unique per built
  // instance (never reused), so the sink tells "same instance" from "another instance at a reused address".
  char graph[33] = {};
  CypherBk* bk = nullptr;
  uint64_t bk_gen = 0;
  // 1.9, device kit: the kit name (folder name in the kit folder) and the shared Kit of the cache's kit store (reference counted by the
  // snapshots, ArrSnapshot::kit_refs); the callback reads it only. kit_gen is unique per loaded Kit (never reused).
  char kit[33] = {};
  const Kit* kit_ptr = nullptr;
  uint64_t kit_gen = 0;
  int n_param = 0;
  ArrParameter param[ARR_PARAMETER] = {};
  int n_clips = 0;
  const ArrClip* clips = nullptr;    // nach start_beat aufsteigend
  int n_noten = 0;
  const ArrNote* noten = nullptr;    // nach beat aufsteigend
  const uint64_t* noten_id = nullptr;    // IDs aufsteigend (Suche beim Tausch)
  const int32_t* noten_id_index = nullptr;
  int n_auto = 0;                    // Automation Slice 1: lanes of this track (none: 0)
  const ArrAutoLane* auto_lanes = nullptr;
  // 1.9 U6: art rack (geraet "rack"): the members and the chain value. A change of the chain value is a swap of the playback; notes that start
  // after it are routed by the new value, sounding notes finish on the members that got their note on.
  int n_glieder = 0;
  ArrGlied glied[ARR_RACK_GLIEDER] = {};
  int kette = 0;                     // 0..127
};

// K1-Fix 8: Speicher in eigenen, anonym abgebildeten Seiten. Der Lade-Faden sperrt ihn nach dem Bau (mlock) und bucht ihn
// auf dem Konto; munmap beim Freigeben hebt die Sperre auf, ohne Nachbarn zu berühren (Sperren zählen unter Linux nicht
// mit: ein munlock auf einer geteilten Heap-Seite löste auch die Sperre aus mlockall). Nie im Callback.
// Inline, damit jede Übersetzungseinheit mit Schnappschüssen (auch Mutationsziele nur mit dem Modul) sie hat.
inline size_t arr_seiten(size_t bytes) noexcept {   // auf ganze Seiten gerundet
  static const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  return (bytes + seite - 1) / seite * seite;
}
inline void* arr_seiten_neu(size_t bytes) {         // wirft std::bad_alloc
  void* p = mmap(nullptr, arr_seiten(bytes ? bytes : 1), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (p == MAP_FAILED) throw std::bad_alloc();
  return p;
}
inline void arr_seiten_frei(void* p, size_t bytes) noexcept {
  if (p) munmap(p, arr_seiten(bytes ? bytes : 1));
}

// Geladenes Audio: rohes f32, 48 kHz, Stereo verschränkt (Spec 2.8). Gehört dem Cache; der Callback liest daten und
// frames je Sample (über ArrClip::audio). K1-Fix-2 Punkt 3: darum liegt auch der Kopf in eigenen Seiten, vom Lade-Faden
// gesperrt (wenn der Cache sperrt) und auf dem Konto gebucht (arr_audio_kopf() Bytes je Audio), wie der Schnappschuss.
struct ArrAudio {
  char sha256[65];
  const float* daten;   // frames · 2 Werte
  int64_t frames;
  // nur der Cache (Lade-Faden):
  void* abbild;
  size_t bytes;
  int32_t ref;          // Zahl der Schnappschüsse, die es nutzen
  bool gesperrt;        // mlock gelungen
  static void* operator new(size_t n) { return arr_seiten_neu(n); }
  static void operator delete(void* p, size_t n) noexcept { arr_seiten_frei(p, n); }
};
inline int64_t arr_audio_kopf() noexcept { return static_cast<int64_t>(arr_seiten(sizeof(ArrAudio))); }

template <class T>
struct ArrSeiten {
  using value_type = T;
  ArrSeiten() noexcept = default;
  template <class U>
  ArrSeiten(const ArrSeiten<U>&) noexcept {}
  T* allocate(size_t n) { return static_cast<T*>(arr_seiten_neu(n * sizeof(T))); }
  void deallocate(T* p, size_t n) noexcept { arr_seiten_frei(p, n * sizeof(T)); }
  template <class U>
  bool operator==(const ArrSeiten<U>&) const noexcept { return true; }
};

// 1.10 slice 4a/4b: one stage of an insert chain. slot is the 0-based index into the pool of its kind (ins/<art>/<slot + 1>); an is the project's on flag
// (a stage runs when this AND its row ins/<art>/<n>/an are on).
enum class ArrInsArt : uint8_t { leer = 0, komp = 1, eq = 2, saett = 3, lim = 4 };
// 1.10 slice 5 U1: the structural sidechain key of a compressor stage (spec 5.5, plan E8). quelle 0 = none (the stage listens to the row sc, the 4a path); this unit knows the
// source kind ARR_SCHL_SPUR with the point ARR_SCHL_POST (the output of track `nr` after fader, pan and mute/solo fade). The pair (spur, pre) has exactly one writer, the row sc.
constexpr uint8_t ARR_SCHL_KEINE = 0;
constexpr uint8_t ARR_SCHL_SPUR = 1;
constexpr uint8_t ARR_SCHL_GRP = 2;    // slice 5 U2a: group `nr` 1..ARR_GRUPPEN; pre = the member sum before the group chain, post = after the group fader
constexpr uint8_t ARR_SCHL_RET = 3;    // slice 5 U2a: return `nr` 1..ARR_RETURNS; pre = the return input after the Hall blend, before its chain, post = after fader and fades
constexpr uint8_t ARR_SCHL_PM = 4;     // slice 5 U2a: only to be refused (sidechain_zyklus): every strip feeds the PM
constexpr uint8_t ARR_SCHL_DECK = 5;   // slice 5 U2b: the input deck/`nr` 1..4 (live only: a render has no deck signal, plan E7); a DJ source has no pre and post, the point is stored as post
constexpr uint8_t ARR_SCHL_ERZ = 6;    // slice 5 U2b: the input erz/1 (the production's Strudel share: a host return into erz/1 is added after the arrangement block and is not in the key, plan E6)
constexpr uint8_t ARR_SCHL_PRE = 0;
constexpr uint8_t ARR_SCHL_POST = 1;
struct ArrSchluessel {
  uint8_t quelle = ARR_SCHL_KEINE;
  uint8_t nr = 0;                  // 1-based number of the source strip
  uint8_t punkt = ARR_SCHL_POST;
};
struct ArrStufe {
  ArrInsArt art = ArrInsArt::leer;
  uint8_t slot = 0;
  bool an = true;
  ArrSchluessel key;               // 1.10 slice 5 U1
  // 1.10 slice 5 U2b (plan E9): the alignment of the key with the input of this stage, in samples, set by arr_schluessel_versatz() (arr_key.h) after the delay compensation is known.
  // The key of a compressor arrives at the time of its capture point; the stage input arrives at the sum of the latencies in front of it (path sum from the delay compensation table).
  uint16_t schl_verz = 0;          // the structural key arrives EARLIER than the stage input: it is delayed by this much in a ring of the slot
  uint16_t schl_verz_zeile = 0;    // the same for a key from the row sc (the input of a track before any chain: arrival 0)
  uint16_t schl_spaet = 0;         // the structural key arrives LATER than the stage input by this much: used as it is, the lag is shown (proj_routing, page)
};
struct ArrKette {
  uint8_t n = 0;
  ArrStufe st[ARR_KETTE];
};

// 1.10 slice 4c T15: the rack macros of a strip (spec D13). A strip with a chain may own one rack (a pooled slot, rack/<slot + 1>/m1..m4): four macro rows 0..1, and a mapping table of
// at most ARR_MAKRO_ZIELE entries. Per block the mixer turns each mapped macro value m into `von + m * (bis - von)` (real units of the parameter) and gives it to the parameter of the
// stage; the stage's own row is ignored while the mapping exists. `stufe` is the 0-based position in the chain of the same strip, `param` the parameter index of the kind (the order
// of docs/interfaces/insert_module.json; the stage switch an = 0 and the compressor key sc = 9 cannot be mapped).
constexpr int ARR_RACKS = 12;          // pooled racks rack/1..12 (= "instanzen" of the kind rack in the contract, pinned by test_arr_rack)
constexpr int ARR_MAKROS = 4;          // macros per rack, rack/<k>/m1..m4
constexpr int ARR_MAKRO_ZIELE = 16;    // mappings per strip
struct ArrMakroZiel {
  uint8_t makro = 0;                   // 0..3
  uint8_t stufe = 0;                   // position in the chain of the strip, 0..ARR_KETTE - 1
  uint8_t param = 0;                   // parameter index of the stage kind
  float von = 0.0f, bis = 0.0f;        // real units: the value at macro 0 and at macro 1
};
// 1.9 U8 T9 (spec E10 to E12): a macro target on a MEMBER of an instrument rack, only on a rack track strip. `glied` is the member index 0..ARR_RACK_GLIEDER - 1, `param` the index
// space of the translator: 0..3 = the four RB-338 parameters (the order of ARR_GERAET_PARAM_NAME), ARR_GLIED_PARAM_BK0 + 0..7 = the Baukasten knobs k1..k8, ARR_GLIED_PARAM_GAIN_DB =
// the gain of any member. von/bis are 0..1 for an RB-338 parameter and a knob, dB (-60..+12) for the gain. The insert macro path (ArrMakroZiel, makros_planen) does not know this table:
// a rack holds n insert targets and ng member targets, together at most ARR_MAKRO_ZIELE.
constexpr int ARR_GLIED_PARAM_BK0 = 8;
constexpr int ARR_GLIED_PARAM_GAIN_DB = 16;
struct ArrGliedZiel {
  uint8_t makro = 0;                   // 0..3
  uint8_t glied = 0;                   // member index in the rack track
  uint8_t param = 0;                   // see above
  float von = 0.0f, bis = 0.0f;        // real units: the value at macro 0 and at macro 1
};
struct ArrRack {
  int8_t slot = -1;                    // 0-based pool slot, -1: the strip has no rack
  uint8_t n = 0;
  ArrMakroZiel z[ARR_MAKRO_ZIELE];
  uint8_t ng = 0;                      // member targets (rack track strips only); n + ng <= ARR_MAKRO_ZIELE
  ArrGliedZiel g[ARR_MAKRO_ZIELE];
};

// 1.10 slice 4b T13: the latency compensation of one playback (spec 2.4, D9, D10). Computed once per snapshot by arr_pdc_rechnen() (arr_pdc.h), never changed during a
// playback. d[key] is the delay in samples of the place `key` (the keys are PDC_* of arr_pdc.h); 0 = no ring. gesamt is the largest path latency (the sum the
// whole production adds to the transport), what the export skips and what the page shows.
constexpr int ARR_PDC_SCHLUESSEL = ARR_SPUREN + ARR_GRUPPEN + ARR_RETURNS + 2 + ARR_RETURNS;   // tracks, groups, track sends per return, PM tracks, PM groups, PM returns
struct ArrPdcTabelle {
  uint16_t d[ARR_PDC_SCHLUESSEL] = {};
  uint16_t gesamt = 0;
  uint8_t ringe = 0;   // places with d > 0 (a project without latency stages has 0: no ring exists)
  // slice 5 U2b: the arrival times (samples after the raw input of a track) of the three sums above the tracks, from the model above; the key alignment reads them
  uint16_t t_trk = 0;  // output of every track chain after the alignment
  uint16_t t_g = 0;    // output of every used group after the alignment (= t_trk without a group)
  uint16_t in_r = 0;   // input of the returns (= t_g)
  uint16_t p_in = 0;   // input of the PM chain
};

struct ArrSnapshot {
  ArrSnapshot() {
    for (int i = 0; i < ARR_SPUREN; ++i) spur_ordnung[i] = static_cast<uint8_t>(i);
  }
  int64_t nr = 0;
  uint8_t spur_ordnung[ARR_SPUREN];  // 1.10 slice 5 U1: the order the tracks run in (chain, then fader loop): a stable topological order over the track-post key edges, the identity without such edges (arr_key.h). A fixed array in the head, so inside the first locked region.
  ArrKette kette[ARR_KETTEN];        // 1.10 slice 4a: insert chain per strip (index as ARR_KETTEN); a chain with n = 0 costs nothing
  ArrRack rack[ARR_KETTEN];           // 1.10 slice 4c: rack macros per strip (index as kette); a strip with slot -1 or n = 0 has no mapping pass
  ArrPdcTabelle pdc;                 // 1.10 slice 4b T13: delays that align every path at the sums; set by arr_pdc_rechnen() (loader, test harness)
  bool ret_pre[ARR_RETURNS] = {};    // 1.10 slice 4a: the sends into this return are taken before the fader and pan of their source (pre), else after
  ArrSpur spur[ARR_SPUREN];          // Index nr − 1
  // 1.9 U6: the devices of the rack members, index = member slot - ARR_SPUREN. art intern (geraet, graph, bk, kit, param as on a track) or wirt
  // (slot); leer = slot unused. Only the device fields are used.
  ArrSpur glied_spur[ARR_GLIED_PLAETZE];
  int rack_wirt = 0;                 // 1.9 U6: Surge members in all racks (the rack sink adds the host lead time when it is above 0)
  // The device of a sink slot: a track (0..31) or a rack member (32..63). One place, so the sinks stay unchanged apart from this lookup.
  const ArrSpur& platz(int p) const noexcept { return p < ARR_SPUREN ? spur[p] : glied_spur[p - ARR_SPUREN]; }
  bool ret_da[ARR_RETURNS] = {};     // 1.10 Slice 3: which returns the playback knows (index nr − 1); the sends themselves are controls, not data
  // Besitz, nur Lade-Faden: Speicher hinter den Zeigern oben (eigene Seiten, gesperrt, K1-Fix 8)
  std::vector<ArrClip, ArrSeiten<ArrClip>> clips;
  std::vector<ArrNote, ArrSeiten<ArrNote>> noten;
  std::vector<uint64_t, ArrSeiten<uint64_t>> noten_id;
  std::vector<int32_t, ArrSeiten<int32_t>> noten_id_index;
  // Paket 1.13: Warp-Marker aller Clips, hintereinander (je Clip ein ArrWarp, dessen Zeiger in warp_beat und warp_frame zeigen)
  std::vector<ArrWarp, ArrSeiten<ArrWarp>> warps;
  std::vector<double, ArrSeiten<double>> warp_beat, warp_frame;
  // Automation Slice 1: lanes and their points (pointers in ArrSpur::auto_lanes / ArrAutoLane::p point into these vectors)
  int n_auto_lanes = 0;
  std::vector<ArrAutoLane, ArrSeiten<ArrAutoLane>> auto_lane_liste;
  std::vector<ArrAutoPunkt, ArrSeiten<ArrAutoPunkt>> auto_punkte;
  // 1.12 slice 5 (D8): the gain envelope points of all clips, hintereinander. Own vector, reserved in the prescan before any push_back: ArrClip::hk points into it,
  // and the lane pointers into auto_punkte must not depend on it. Listed in je_bereich, so booked and locked with the snapshot (gesperrt_bytes).
  std::vector<ArrAutoPunkt, ArrSeiten<ArrAutoPunkt>> hk_punkte;
  std::vector<ArrAudio*> audios;     // jedes genutzte Audio genau einmal (Referenz im Cache); der Callback liest es nie
  std::vector<int32_t> bk_refs;      // S20: slots of the graph store this snapshot holds a reference on (released by gib_wiedergabe)
  std::vector<int32_t> kit_refs;     // 1.9: slots of the kit store this snapshot holds a reference on (released by gib_wiedergabe)
  int64_t gesperrt_bytes = 0;        // Kopf und Felder: auf dem Konto gebucht (und gesperrt, wenn der Cache sperrt)
  static void* operator new(size_t n) { return arr_seiten_neu(n); }
  static void operator delete(void* p, size_t n) noexcept { arr_seiten_frei(p, n); }
};

// S20: the sink tells the store whether the callback still uses a graph instance (published with release order each block). The store
// frees an instance only when no snapshot holds it AND the sink does not use it; otherwise the free waits for the next loader pass
// (precedent WarpWerk::liest). noexcept, lock-free on the reading side.
class ArrBkLeser {
 public:
  virtual bool nutzt(const CypherBk* h) const noexcept = 0;

 protected:
  ~ArrBkLeser() = default;
};

// 1.9: the same for the kit store (ArrAudioCache::kit_gib): the kit sink says, with acquire/release order, whether the callback still plays
// sounds of a Kit. A Kit is freed only when no snapshot holds it AND the sink does not use it. noexcept, lock-free on the reading side.
class ArrKitLeser {
 public:
  virtual bool nutzt(const Kit* k) const noexcept = 0;

 protected:
  ~ArrKitLeser() = default;
};

// 1.9: how the cache loads a kit folder. A function pointer, not a call of cdj::lade_kit, because arr_playback.cpp is compiled standalone
// (without kit.cpp) by dozens of test targets; main.cpp, render.cpp and the kit tests set cdj::lade_kit, the others leave it unset.
using ArrKitLader = std::unique_ptr<Kit> (*)(const std::string& ordner, std::string* fehler);

// Audio-Cache des Lade-Fadens: sha256 -> ArrAudio. Zählt gegen das gemeinsame Konto (speicher_budget_mib, Deck-Lader
// eingeschlossen) und gegen den Teilbetrag arr_budget. Nur aus einem Faden benutzen.
class ArrAudioCache {
 public:
  ArrAudioCache(SpeicherKonto* konto, int64_t arr_budget_bytes, bool sperren = true)
      : konto_(konto), budget_(arr_budget_bytes), sperren_(sperren) {}
  ~ArrAudioCache();
  ArrAudioCache(const ArrAudioCache&) = delete;
  ArrAudioCache& operator=(const ArrAudioCache&) = delete;
  // Liefert das Audio mit ref + 1 (neu geladen oder aus dem Cache). nullptr mit grund "audio_fehlt", "format" oder
  // "zu_gross".
  ArrAudio* hole(const std::string& sha256, const std::string& datei, int64_t frames, std::string& grund,
                 std::string& meldung);
  void gib(ArrAudio* a);          // ref − 1; bei 0 munlock, munmap, Konto zurück
  // K1-Fix 8: Schnappschuss nach dem Bau buchen und (wenn der Cache sperrt) sperren; false mit grund "zu_gross"
  bool sperre(ArrSnapshot& s, std::string& grund, std::string& meldung);
  void entsperre(ArrSnapshot& s);   // vor dem Löschen: entsperren und zurückbuchen
  int64_t gesperrt() const { return gesperrt_; }
  int64_t budget() const { return budget_; }
  int eintraege() const { return static_cast<int>(audio_.size()); }

  // S20 graph store (same thread, same lifetime as the audio cache). The key is (track nr, graph name, hash of the file text): consecutive
  // snapshots with the same key share one instance, so editing a note or a knob rebuilds nothing and cuts no tail.
  void setze_bk_ordner(std::string ordner) { bk_ordner_ = std::move(ordner); }
  void setze_bk_leser(const ArrBkLeser* l) { bk_leser_ = l; }
  // Reads <bk_ordner>/<graph>.json, takes a reference on the instance for track nr (building it on a miss; never in the callback) and
  // returns its slot (>= 0, for ArrSnapshot::bk_refs) or -1 with grund "format" and meldung (the sample root is <bk_ordner>/samples).
  int32_t bk_hole(int nr, const std::string& graph, CypherBk** h, uint64_t* gen, std::string& grund, std::string& meldung);
  void bk_gib(int32_t slot);   // reference - 1; at 0 free the instance, or defer the free while the sink still uses it
  bool bk_nachholen();         // free deferred instances the sink has let go of; true = something was freed
  int bk_eintraege() const;    // live instances (with at least one reference)
  int bk_aufgeschoben() const { return static_cast<int>(bk_aufgeschoben_.size()); }

  // 1.9 kit store (same thread, same lifetime). The key is the kit name plus mtime and size of <ordner>/<name>/kit.json: consecutive snapshots
  // share one Kit, a touched kit.json loads a new one. The bytes of all sounds are booked on the shared account (refused: "zu_gross") and
  // mlocked when the cache locks, because mlockall(MCL_CURRENT) of the core does not cover memory loaded after the start (spec E16).
  void setze_kit_ordner(std::string ordner) { kit_ordner_ = std::move(ordner); }
  void setze_kit_leser(const ArrKitLeser* l) { kit_leser_ = l; }
  void setze_kit_lader(ArrKitLader l) { kit_lader_ = l; }
  // Takes a reference on the Kit <name> (loading it on a miss; never in the callback) and returns its slot (>= 0, for ArrSnapshot::kit_refs),
  // or -1 with grund "format" (no loader, no folder, not loadable; meldung names <ordner>/<name>) or "zu_gross" (account or mlock).
  int32_t kit_hole(const std::string& name, const Kit** k, uint64_t* gen, std::string& grund, std::string& meldung);
  void kit_gib(int32_t slot);   // reference - 1; at 0 free the Kit (unbook, unlock), or defer the free while the sink still uses it
  bool kit_nachholen();         // free deferred Kits the sink has let go of; true = something was freed
  int kit_eintraege() const;    // live Kits (with at least one reference)
  int kit_aufgeschoben() const { return static_cast<int>(kit_aufgeschoben_.size()); }

 private:
  struct BkEintrag {
    std::string schluessel;    // empty = free slot
    CypherBk* h = nullptr;
    uint64_t gen = 0;
    int32_t ref = 0;
  };
  std::string bk_ordner_;
  const ArrBkLeser* bk_leser_ = nullptr;
  std::vector<BkEintrag> bk_;
  std::vector<CypherBk*> bk_aufgeschoben_;   // reference count 0, but the sink still uses it
  uint64_t bk_zaehler_ = 0;
  struct KitEintrag {
    std::string schluessel;    // empty = free slot
    std::unique_ptr<Kit> k;
    uint64_t gen = 0;
    int32_t ref = 0;
    int64_t bytes = 0;         // booked on the account (and locked when the cache locks)
  };
  void kit_freigeben(KitEintrag&& e);   // unlock, unbook, free
  std::string kit_ordner_;
  const ArrKitLeser* kit_leser_ = nullptr;
  ArrKitLader kit_lader_ = nullptr;
  std::vector<KitEintrag> kit_;
  std::vector<KitEintrag> kit_aufgeschoben_;   // reference count 0, but the sink still uses it (memory stays booked until freed)
  uint64_t kit_zaehler_ = 0;
  SpeicherKonto* konto_;
  int64_t budget_;
  bool sperren_;
  int64_t gesperrt_ = 0;
  std::map<std::string, std::unique_ptr<ArrAudio>> audio_;
};

struct ArrLadeErgebnis {
  std::unique_ptr<ArrSnapshot> snap;   // nullptr bei Fehler
  std::string grund;                   // "", "datei_fehlt", "format", "audio_fehlt", "zu_gross", "spur_bereich"
  std::string meldung;                 // für stderr, mit Feld und Wert
};

// Pfad der Wiedergabe-Datei (Spec 2.9): <ordner>/wiedergabe-<nr>.json
std::string wiedergabe_pfad(const std::string& ordner, int64_t nr);

// Liest, prüft und lädt. Der eine Lader für Kern und Render (Spec 2.1). Allokiert, Systemaufrufe: nie im Callback.
ArrLadeErgebnis lade_wiedergabe(const std::string& ordner, int64_t nr, ArrAudioCache& cache);

// Gibt einen Schnappschuss frei (Referenzen im Cache zurück). Nur im Faden, der den Cache besitzt.
void gib_wiedergabe(ArrSnapshot* s, ArrAudioCache& cache);

}  // namespace cdj
