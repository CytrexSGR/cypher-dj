// 1.10 slice 4a T2 / 4b T12: the insert chains of the arrangement mixer. Pools of ARR_INS_KOMP compressors (Cypher Komp, comp.h), ARR_INS_EQ EQs (eq.h) and
// ARR_INS_SAETT saturators (sat.h) and ARR_INS_LIM limiters (ins_lim.h, KanalLimiter) built in the constructor, per-slot bypass blend, tail on removal, NaN guard. A slot is addressed by one global index:
// komp 0..ARR_INS_KOMP-1, then the eqs, the saturators and the limiters (ins_global()). The mixer (arr_output.cpp) calls kette() as a block-wise pass over a strip's input buffer,
// in place, before the per-sample fader loop. Everything except the constructor runs in the callback: no allocation, no lock, no I/O.
//
// Stage life (spec 2.2). Each slot has a weight 0..1 that ramps over INS_BLENDE samples (integer counter, so it reaches its end exactly):
//  * a stage whose strip, slot and kind stay across a swap keeps its state;
//  * a stage that enters (a new owner of the slot) starts cleared and fades in;
//  * a stage that leaves keeps running on its former strip as a tail with the weight falling to 0, then it is cleared;
//    a slot claimed by another strip in the same swap is cut and cleared at once;
//  * a stage that is switched off (project flag or row an) fades out the same way and, at weight 0, is not computed any more and is cleared.
// Parameters are the rows ins/<art>/<n>/<parameter> (real units); they are read once per block (the value at the end of the block).
// Latency (slice 4b): lim reports the look-ahead of its KanalLimiter (74 samples), eq and saett delay their wet signal by the latency the module reports (69 samples at 48 kHz). A stage with a latency delays its dry signal by the
// same amount in a ring of its own, so that the bypass blend, the fully-off stage and a tail all pass the same delay as the running stage (spec D10: a bypass never
// shifts the path); the sum of the stage latencies of a chain is what the delay compensation of the mixer (arr_pdc.h) accounts for.
// Utility stages (arr-fx slice 1): a sixth kind, `utility` (ins/utility/1..ARR_INS_UTIL, rows an, breite, mono_unter, gain, balance), sits between lim and host in the global order. Its module is the 1.15
// Utility (width in M/S, bass mono, gain, balance), 0 samples of latency, so it needs no dry ring and adds nothing to the delay compensation; the stage life is the generic one.
// Host stages (plan 1.11 T4): a fifth kind, `host` (ins/host/1..ARR_INS_HOST, one row an), sits at the end of the global slot order. Its module is ArrHostStufe (arr_host_stufe.h, owned here):
// the strip input goes out to the effect host, the guarded return comes back, and a missing, bypassed or unhealthy host passes the input delayed by the stage latency. The latency is
// the stage's own (ArrStufe::latenz from the playback file, D4): lat_[s] of a host slot is set in tausche() when a snapshot is taken over, never in the callback; its dry ring is the host stage's
// own (ARR_HOST_LAT_MAX), not tl_/tr_. Owner, tail, the on/off blend over INS_BLENDE and the NaN guard treat it like any stage with latency; the health fade lives inside ArrHostStufe, so the two
// fades are weights of one convex combination of return and delayed dry and never open a gap.
// Key alignment (slice 5 U2b, plan E9): a compressor key arrives at its capture point earlier than the stage input when latency stages sit in front of the stage (the input is later by the
// sum of their latencies, a path sum). The loader computes the delay per stage (ArrStufe::schl_verz for a structural key, schl_verz_zeile for the row sc, arr_schluessel_versatz()); the
// slot delays the key by it in a ring built in the constructor (one stereo ring of ARR_SCHL_VERZ_MAX samples per compressor slot). A key that arrives later is used as it is.
// Lanes (1.12 slice 6): an automation lane on a stage parameter or a rack macro (ArrKettenLane) hands ONE value per block to this class (Arrangement::auto_kette, before makros_planen): lane_stufe()
// for a stage parameter, lane_makro() for a macro row. While it is set, eff() returns the lane value (clamped to the row's range) in place of the row, and makro_wert()/makros_planen() read the lane
// value in place of the macro row; a parameter that a rack macro maps stays with the macro (one writer, D13: the loader refuses a lane on a mapped parameter, the order here is the second line of defence).
// lanen_loeschen() runs at the start of every block: a lane that ends (stop, swap) gives the parameter back to its row in the next block. Block rate, like the rows.
// Rack macros (slice 4c T15, spec D13): the rows rack/<k>/m1..m4 hold four macro values 0..1 per pooled rack. makros_planen() turns the mapping table of a strip (ArrRack) into a value per
// mapped parameter, `von + m * (bis - von)`, once per block before anything reads a parameter; eff() then returns that value for a mapped parameter and ignores the parameter's own row
// (one writer per parameter). A strip without a rack takes no pass; the override is cleared when the table goes away.
#pragma once

#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/arr_host_stufe.h"
#include "cypherdj/arr_inserts_util.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/eq.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/comp.h"
#include "cypherdj/sat.h"

namespace cdj {

static_assert(ARR_KETTEN <= 64, "strip masks (maske_loeschen, slot_eigen_ bits per strip) are uint64_t: one bit per strip");

struct ArrArbeit;   // arr_arbeit.h: the per-lane work struct (includes this header)

constexpr int INS_BLOCK = 1024;           // = ARR_BLOCK (arrangement.h), checked by a static_assert there
constexpr int INS_BLENDE = 480;           // bypass, enter and leave: 10 ms, as the Hall blend
constexpr int INS_KOMP_PARAM = 10;        // an, schwelle, ratio, knie, attack, release, makeup, mix, schp, sc (the order of the roles ins_komp_*)
constexpr int INS_EQ_BAND_PARAM = 7;      // per band: an, typ, freq, gain, q, steil, platz (the order of the roles ins_eq_b_*)
constexpr int INS_EQ_PARAM = 3 + 8 * INS_EQ_BAND_PARAM;   // an, out, propq, then b1..b8: 59 (ins/eq/<n>/b<m>/<parameter> is index 3 + (m - 1) * 7 + parameter)
constexpr int INS_SAETT_PARAM = 4;        // an, drive, out, mix
constexpr int INS_LIM_PARAM = 3;          // an, decke, abklingen (the order of the roles ins_lim_*)
constexpr int INS_PARAM_MAX_EQ = INS_EQ_PARAM;   // see INS_PARAM_MAX below (the maximum over all stage kinds, defined after INS_BK_PARAM)
constexpr int INS_HOST_PARAM = 1;         // plan 1.11: an (host stages have no mapped parameter rows)
constexpr int INS_BK_PARAM = 65;          // arr-bk slice 3: an, k1..k64 (the knobs of the Baukasten graph, 0..1; parameter index of kn = n; 9 = an, k1..k8 before the 32-knob widening, 33 before the 64-knob widening)
// The width of every per-stage parameter array: the maximum of all stage parameter counts (komp 10, eq 59, saett 4, lim 3, utility 5, bk 65, host 1). Since the 64-knob widening the Baukasten stage is the widest;
// the static_asserts keep a later widening of any kind from overflowing the arrays silently.
constexpr int INS_PARAM_MAX = INS_BK_PARAM > INS_PARAM_MAX_EQ ? INS_BK_PARAM : INS_PARAM_MAX_EQ;
static_assert(INS_PARAM_MAX >= INS_BK_PARAM, "the stage arrays must hold every parameter of a Baukasten stage (an, k1..k64)");
static_assert(INS_PARAM_MAX >= INS_EQ_PARAM && INS_PARAM_MAX >= INS_KOMP_PARAM && INS_PARAM_MAX >= INS_SAETT_PARAM && INS_PARAM_MAX >= INS_LIM_PARAM && INS_PARAM_MAX >= INS_HOST_PARAM,
              "INS_PARAM_MAX is the maximum over all stage kinds");
constexpr float INS_BK_AUS_MAX = 8.0f;    // |sample| guard of a Baukasten stage output (as the host return guard, HOST_RUECK_MAX)
// first global slot index of each kind (the order of ins_global())
constexpr int INS_G_EQ0 = ARR_INS_KOMP;
constexpr int INS_G_SAETT0 = INS_G_EQ0 + ARR_INS_EQ;
constexpr int INS_G_LIM0 = INS_G_SAETT0 + ARR_INS_SAETT;
constexpr int INS_G_UTIL0 = INS_G_LIM0 + ARR_INS_LIM;      // arr-fx slice 1: the utility range sits between lim and host, so host stays last
constexpr int INS_G_BK0 = INS_G_UTIL0 + ARR_INS_UTIL;     // arr-bk slice 3: the Baukasten range sits between utility and host
constexpr int INS_G_HOST0 = INS_G_BK0 + ARR_INS_BK;
static_assert(INS_G_HOST0 + ARR_INS_HOST == ARR_INS_ALLE, "the host range closes the global slot order");
constexpr int INS_LAT_MAX = 128;          // longest stage latency the dry ring holds (the constructor refuses a module that reports more)

// global slot index of (kind, 0-based slot); -1 for a kind without a pool or a slot out of range
inline int ins_global(ArrInsArt art, int slot) {
  switch (art) {
    case ArrInsArt::komp: return slot >= 0 && slot < ARR_INS_KOMP ? slot : -1;
    case ArrInsArt::eq: return slot >= 0 && slot < ARR_INS_EQ ? ARR_INS_KOMP + slot : -1;
    case ArrInsArt::saett: return slot >= 0 && slot < ARR_INS_SAETT ? ARR_INS_KOMP + ARR_INS_EQ + slot : -1;
    case ArrInsArt::lim: return slot >= 0 && slot < ARR_INS_LIM ? INS_G_LIM0 + slot : -1;
    case ArrInsArt::host: return slot >= 0 && slot < ARR_INS_HOST ? INS_G_HOST0 + slot : -1;
    case ArrInsArt::utility: return slot >= 0 && slot < ARR_INS_UTIL ? INS_G_UTIL0 + slot : -1;
    case ArrInsArt::bk: return slot >= 0 && slot < ARR_INS_BK ? INS_G_BK0 + slot : -1;
    default: return -1;
  }
}
inline ArrInsArt ins_art(int g) {
  return g < ARR_INS_KOMP ? ArrInsArt::komp : g < INS_G_SAETT0 ? ArrInsArt::eq : g < INS_G_LIM0 ? ArrInsArt::saett : g < INS_G_UTIL0 ? ArrInsArt::lim : g < INS_G_BK0 ? ArrInsArt::utility : g < INS_G_HOST0 ? ArrInsArt::bk : ArrInsArt::host;
}

class ArrInserts final : public ArrBkLeser {
 public:
  ArrInserts();                           // builds the pool (allocates, outside the callback)
  ~ArrInserts();
  ArrInserts(const ArrInserts&) = delete;
  ArrInserts& operator=(const ArrInserts&) = delete;

  // ---- controls (written by the Arrangement like the strip controls)
  void binde(int slot, int param, float vorgabe, float mn = 0.0f, float mx = 0.0f);   // constructor time: the default of a row (slot = global index) and, when mn < mx, its range (the clamp of a lane value)
  void setze_sofort(int slot, int param, float w);
  void verlauf(int slot, int param, const float* werte);         // valid until the end of the next block
  void nachfuehren(int m);                                       // after a block: a course ends in the base value

  // ---- lanes (1.12 slice 6), see the header comment. strip = chain index (ARR_KETTEN), stufe/param as in ArrMakroZiel; a stage that is not in the chain of the strip, not owned by it, a parameter
  // out of range, the switch an (0) and the compressor key (9) are ignored. rack/nr: the pooled rack slot (0-based) and the macro 0..3.
  void lane_stufe(int strip, const ArrKette& k, int stufe, int param, float v);
  void lane_makro(int rack, int nr, float v);
  void lanen_loeschen() {
#ifndef CYPHERDJ_MUTATION_ARR_KETTE_LANE_BLEIBT   // error case: the lane values of the block before stay (a lane that ends keeps driving)
    if (lane_aktiv_) { std::memset(lane_, 0, sizeof lane_); std::memset(lane_mk_, 0, sizeof lane_mk_); lane_aktiv_ = false; }
#endif
  }
  bool lane_treibt(int slot, int param) const { return slot >= 0 && slot < ARR_INS_ALLE && param >= 0 && param < INS_PARAM_MAX && lane_[slot][param]; }
  bool lane_makro_treibt(int rack, int nr) const { return rack >= 0 && rack < ARR_RACKS && nr >= 0 && nr < ARR_MAKROS && lane_mk_[rack][nr]; }
  // ---- rack macros (slice 4c T15): the rows rack/<k>/m<n>, k = 0-based rack slot, n = 0-based macro
  void makro_binde(int rack, int nr, float vorgabe);             // constructor time: the default of a row
  void makro_sofort(int rack, int nr, float w);
  void makro_verlauf(int rack, int nr, const float* werte);      // valid until the end of the next block
  void makros_planen(const ArrKette* ketten, const ArrRack* racks, int m);   // ARR_KETTEN entries each, or nullptr (no playback); once per block, before schluessel_planen()
  // 1.9 U8 T9: the value of macro `nr` of rack `rack` that makros_planen() uses in a block of m samples (the value at the end of the block, NaN reads as 0, clamped to 0..1). The member
  // targets of a rack track (ArrGliedZiel) read it here; they have their own table and hook, the insert path above is not changed.
  float makro_wert(int rack, int nr, int m) const noexcept;
  float wirksam(int slot, int param) const {                     // the value the module of the slot got last (komp: 1..8, eq: 1..58, saett: 1..3, lim: 1..2); 0 for the others
    return slot >= 0 && slot < ARR_INS_ALLE && param >= 1 && param < INS_PARAM_MAX ? angewandt_[slot][param] : 0.0f;
  }
  bool makro_treibt(int slot, int param) const { return slot >= 0 && slot < ARR_INS_ALLE && param >= 0 && param < INS_PARAM_MAX && ueber_[slot][param]; }

  // ---- Baukasten stages (arr-bk slice 3). The instance of a stage (ArrStufe::bk) is built by the loader and arrives inside the snapshot; this class owns none of them. A stage that stays across a
  // swap with the same instance (same graph file) keeps its state; another instance (another graph, a changed graph file) is crossfaded over ONE block (the old one is rendered once more with a
  // linear fade to 0, then reset), a new owner starts on a reset instance. The instance in use is published per slot (aktiv, blende) so that the loader frees it only when no snapshot holds it
  // AND the stage does not run it (ArrBkLeser, called from the loader thread). takt(): beat of the first sample of the next block and beats per sample, once per block before the chains.
  bool nutzt(const CypherBk* h) const noexcept override;
  void takt(double beat0, double bps) noexcept {
    takt_beat0_ = beat0;
    takt_bps_ = bps;
  }
  const CypherBk* bk_instanz(int slot) const { return slot >= INS_G_BK0 && slot < INS_G_HOST0 ? bk_[slot - INS_G_BK0].h : nullptr; }   // test seam: the instance the slot runs (nullptr: none)

  // ---- structure
  // swap: ARR_KETTEN chains or nullptr (no playback).
  // Host slots (plan 1.11 fix round 3): one host process serves one strip at a time, so a host slot never moves strips inside one swap. If the new snapshot gives an active slot (or one in its exit tail) to
  // another strip, the swap treats it as a removal only: the old owner exits with its normal tail and the new owner's stage stays out (undelayed input) until a later swap claims the slot after the tail
  // has ended. Rule for the consumer (the server, T7): express a strip change of a host slot as removal in one load and entry in a later load, at least latenz + HOST_BLENDE samples apart.
  void tausche(const ArrKette* ketten);
  void ruhe();                                                   // nothing plays: every stage is cleared

  // ---- sidechain key (spec 2.3, D11): stage row sc = n (1..32) listens to the input of track n, taken before ANY chain of the block runs.
  // The mixer calls schluessel_planen() first, then schluessel_sichern() for every track in schluessel_maske(), then kette() per strip.
  void schluessel_planen(int m);                                 // reads the sc rows of the owned stages (value at the end of the block)
  uint64_t schluessel_maske() const { return schl_maske_; }      // tracks (bit = index) some stage names as its key
  void schluessel_sichern(int spur, const float* l, const float* r, int m);

  // ---- structural key (slice 5, plan 3.2): a komp stage whose chain entry carries a key {spur | grp | ret, nr, pre | post} listens to a key buffer of its own slot
  // (ARR_INS_KOMP x INS_BLOCK x 2 floats, built in the constructor). schluessel_planen() zeroes the first m samples of the buffer of every listening slot at block start; the
  // capture point overwrites them. A source whose capture point does not run in a block therefore gives a silent key, never the samples of the block before.
  // The mixer asks ziele(quelle, punkt, nr) at a capture point, writes the samples into the returned buffers and calls fertig() once after the loop (non-finite guard);
  // kopiere() is the same for a point where the whole block is there at once (group pre, return pre). The 1.10 U1 names post_ziele()/post_fertig() are the track post case.
  int ziele(uint8_t quelle, uint8_t punkt, int nr, float** l, float** r);   // nr 1-based; the key buffers of the slots listening to this source (0 for most strips)
  void fertig(uint8_t quelle, uint8_t punkt, int nr, int m);               // non-finite guard over what was captured, like schluessel_sichern
  void kopiere(uint8_t quelle, uint8_t punkt, int nr, const float* l, const float* r, int m);   // ziele + copy of m samples + fertig
  int post_ziele(int spur, float** l, float** r) { return ziele(ARR_SCHL_SPUR, ARR_SCHL_POST, spur + 1, l, r); }
  void post_fertig(int spur, int m) { fertig(ARR_SCHL_SPUR, ARR_SCHL_POST, spur + 1, m); }
  const float* schluessel_puffer(int slot, bool rechts) const {  // test seam: the key buffer of a komp slot
    return slot >= 0 && slot < ARR_INS_KOMP ? &(rechts ? key_r_ : key_l_)[static_cast<size_t>(slot) * INS_BLOCK] : nullptr;
  }
  bool strukturell(int slot) const { return slot >= 0 && slot < ARR_INS_KOMP && strukt_[slot]; }   // the stage listens to a structural key in this block
  // slice 5 U2b: the delay (samples) the key of the slot goes through in this block: the structural one when the stage has one, the row one when sc > 0, else 0. Test seam and display.
  int schluessel_verzug(int slot) const { return slot >= 0 && slot < ARR_INS_KOMP ? (strukt_[slot] ? verz_s_[slot] : sc_[slot] > 0 ? verz_z_[slot] : 0) : 0; }
  int schluessel_spaet(int slot) const { return slot >= 0 && slot < ARR_INS_KOMP && strukt_[slot] ? spaet_[slot] : 0; }   // the lag of a late structural key, samples

  // ---- per block
  bool hat(int streifen) const { return (maske_ >> streifen) & 1u; }   // the strip has a stage or a tail to run
  void schweige(int streifen);                                   // the strip has no signal this block (a group without members): its stages are cleared, they report nothing
  void kette(int streifen, const ArrKette* k, float* l, float* r, int m);   // in place over m samples; k may be nullptr (tails only)
  // Mehrkern slice 3.1 task 2: the lane forms. kette()/schweige() are `*_bahn` on lane 0 followed by nach_join(). A `*_bahn` call touches only
  // state of its own strip (stages it owns per the mirror slot_eigen_), the scratch of `a`, and reports shared effects through `a`:
  // a cleared strip bit in a.maske_loeschen, a finished tail in a.slot_frei, NaNs in a.nan_zaehler. It never reads or writes besitzer_ or maske_.
  void kette_bahn(int streifen, const ArrKette* k, float* l, float* r, int m, ArrArbeit& a);
  void schweige_bahn(int streifen, ArrArbeit& a);
  // serial, after the join: merges the lane reports (mask bits, slot owners, NaN counts in lane order) and resets the lane fields
  void nach_join(ArrArbeit* lanes, int n);
  uint64_t slot_eigen(int streifen) const { return streifen >= 0 && streifen < ARR_KETTEN ? slot_eigen_[streifen] : 0; }   // test seam
  uint64_t maske() const { return maske_; }                                                                  // test seam

  // ---- readings
  float gr_db(int slot) const { return gr_[slot]; }              // gain reduction >= 0 of the last block the stage ran in
  bool lief(int slot) const { return lief_[slot]; }              // the stage computed in the last block it was asked for
  uint64_t nan_zaehler() const { return nan_; }
  int latenz(int slot) const { return slot >= 0 && slot < ARR_INS_ALLE ? lat_[slot] : 0; }   // the latency of the stage kind in the slot, samples (a host slot: the latenz of the stage of the last swap)
  // plan 1.11 T12: the row ins/host/<h>/an of host h (1..ARR_INS_HOST) is on; the stage runs when this AND the project flag are on (the export counts blocks with such a stage on the dry path)
  bool host_zeile_an(int h) const { return h >= 1 && h <= ARR_INS_HOST && eff(INS_G_HOST0 + h - 1, 0, 1) >= 0.5f; }
  ArrHostStufe& host() { return host_; }                          // plan 1.11: the module of the host slots (the core hands the port buffers, T5 the health)
  const ArrHostStufe& host() const { return host_; }

 private:
  friend struct ArrInsertsPruefZugang;   // tests only: poisons besitzer_ to prove a lane form never reads it
  struct Wert {
    float w = 0.0f;
    const float* vl = nullptr;
#ifdef CYPHERDJ_MUTATION_MAKRO_ROW_GEWINNT
    bool geschrieben = false;   // error case: a row that was written wins over the macro
#endif
  };
  float eff(int s, int p, int m) const {
#ifdef CYPHERDJ_MUTATION_MAKRO_ROW_GEWINNT
    if (ueber_[s][p] && !p_[s][p].geschrieben) return ueber_w_[s][p];
#else
    if (ueber_[s][p]) return ueber_w_[s][p];   // a rack macro drives the parameter: its own row is ignored (spec D13)
#endif
    if (lane_[s][p]) return lane_w_[s][p];     // 1.12 slice 6: a lane drives the parameter for this block (one value per block, already clamped)
    return p_[s][p].vl ? p_[s][p].vl[m - 1] : p_[s][p].w;
  }
  void stufe(int s, bool ziel_an, float* l, float* r, int m, ArrArbeit& a);
  void leere(int s);
  void spiegel_neu();                                            // serial: rebuilds slot_eigen_ from besitzer_ (end of tausche and ruhe)

  void trocken_speise(int s, const float* l, const float* r, int m, float* aus_l, float* aus_r);   // feeds the dry ring of a stage with latency, optionally reads the delayed dry out
  void trocken_leere(int s);
  void setze_dsp(int s, int m);                                  // gives a changed parameter set to the module of the slot (once per block, only on change)
  // the module's block call (komp: with the key when the stage has one). A host slot goes to ArrHostStufe (never to lim_[]): ziel_an is the stage's target switch, tl/tr (optional) receive the
  // delayed dry signal the on/off blend needs.
  void rechne(int s, float* l, float* r, int m, bool ziel_an = true, float* tl = nullptr, float* tr = nullptr, ArrArbeit* a = nullptr);
  void rechne_bk(int s, float* l, float* r, int m, ArrArbeit& a);   // arr-bk slice 3: the effect graph of the slot over the block, with the crossfade to a changed instance
  void bk_besitz_frei(int s);                                      // a slot of a Baukasten stage lost its owner: the instance is no longer ours (unpublished)
  int n_param(int s) const {
    return s < ARR_INS_KOMP ? INS_KOMP_PARAM : s < INS_G_SAETT0 ? INS_EQ_PARAM : s < INS_G_LIM0 ? INS_SAETT_PARAM : s < INS_G_UTIL0 ? INS_LIM_PARAM : s < INS_G_BK0 ? INS_UTIL_PARAM : s < INS_G_HOST0 ? INS_BK_PARAM : INS_HOST_PARAM;
  }

  std::unique_ptr<Komp> komp_[ARR_INS_KOMP];
  std::unique_ptr<EqNativ> eq_[ARR_INS_EQ];
  std::unique_ptr<SaettNativ> saett_[ARR_INS_SAETT];
  std::unique_ptr<cypherdj::dsp::KanalLimiter> lim_[ARR_INS_LIM];
  std::unique_ptr<cypherdj::dsp::Utility> util_[ARR_INS_UTIL];   // arr-fx slice 1
  struct BkSlot {   // arr-bk slice 3: the instance of a Baukasten stage
    CypherBk* h = nullptr;                   // the instance the slot runs (owned by the graph store of the loader); null: none
    uint64_t gen = 0;
    CypherBk* alt = nullptr;                 // the instance that fades out in the next block of the stage (the graph changed)
    std::atomic<const CypherBk*> aktiv{nullptr};    // published with release order: h
    std::atomic<const CypherBk*> blende{nullptr};   // published before aktiv is overwritten: alt, until its fade has run
  };
  BkSlot bk_[ARR_INS_BK];
  double takt_beat0_ = 0.0, takt_bps_ = 0.0;
  ArrHostStufe host_;                       // plan 1.11: the host stages, fixed storage (4 x 2 x ARR_HOST_LAT_MAX floats), part of the object
  Wert p_[ARR_INS_ALLE][INS_PARAM_MAX];
  Wert mk_[ARR_RACKS][ARR_MAKROS];          // the macro rows rack/<k>/m<n>
#ifdef CYPHERDJ_MUTATION_MAKRO_SPAET
  float mk_alt_[ARR_RACKS][ARR_MAKROS] = {};   // error case: the macro value of the block before
#endif
  float mn_[ARR_INS_ALLE][INS_PARAM_MAX] = {};      // range of the row (0, 0 = unknown: a lane value is then not clamped)
  float mx_[ARR_INS_ALLE][INS_PARAM_MAX] = {};
  bool lane_[ARR_INS_ALLE][INS_PARAM_MAX] = {};    // 1.12 slice 6: a lane drives the parameter in this block (lane_w_), cleared by lanen_loeschen() at every block start
  float lane_w_[ARR_INS_ALLE][INS_PARAM_MAX] = {};
  bool lane_mk_[ARR_RACKS][ARR_MAKROS] = {};       // a lane drives the macro in this block
  float lane_mkw_[ARR_RACKS][ARR_MAKROS] = {};
  bool lane_aktiv_ = false;                        // some entry of lane_ / lane_mk_ is set (the clear costs nothing otherwise)
  bool ueber_[ARR_INS_ALLE][INS_PARAM_MAX] = {};   // the parameter is driven by a macro in this block
  float ueber_w_[ARR_INS_ALLE][INS_PARAM_MAX] = {};
  bool ueber_aktiv_ = false;                // some entry of ueber_ is set (so that a strip set without racks costs nothing and the entries are cleared once)
  float angewandt_[ARR_INS_ALLE][INS_PARAM_MAX] = {};   // the values last given to the module (komp: schwelle .. schp = 1..8; eq: out .. b8/platz = 1..58; saett: drive .. mix = 1..3; lim: decke, abklingen = 1..2)
  bool gesetzt_[ARR_INS_ALLE] = {};
  int besitzer_[ARR_INS_ALLE];              // strip that owns the slot, -1 none. Four writers, all serial: tausche, ruhe, nach_join and the serial schweige/kette wrappers (through nach_join)
  uint64_t slot_eigen_[ARR_KETTEN] = {};    // per-strip mirror of besitzer_: bit s of entry st = slot s belongs to strip st. Written by the same writers, plus a finished tail clears its own bit in a *_bahn call
  bool in_kette_[ARR_INS_ALLE] = {};        // the owner's chain in the current snapshot lists the slot
  int pos_[ARR_INS_ALLE] = {};              // blend position 0..INS_BLENDE (weight = pos / INS_BLENDE)
  bool lief_[ARR_INS_ALLE] = {};
  float gr_[ARR_INS_ALLE] = {};             // gain reduction (komp and lim; eq and saett report 0)
  int sc_[ARR_INS_KOMP] = {};               // key track of the stage in this block, 1..32, 0 = own signal
  int lat_[ARR_INS_ALLE] = {};              // latency of each slot, samples: the kind's for the native kinds (constructor), the stage's for a host slot (tausche)
  float tl_[ARR_INS_ALLE][INS_LAT_MAX] = {};   // dry ring of a stage with latency: the last lat_ input samples, L and R
  float tr_[ARR_INS_ALLE][INS_LAT_MAX] = {};
  int tp_[ARR_INS_ALLE] = {};
  uint64_t schl_maske_ = 0;
  ArrSchluessel skey_[ARR_INS_KOMP] = {};   // the structural key of the stage in the slot (from the chain entry at the last swap); a tail keeps the key it had
  bool strukt_[ARR_INS_KOMP] = {};          // this block: the slot listens to its structural key
  int strukt_n_ = 0;                        // this block: how many slots listen (0 = the capture points have nothing to do)
  std::vector<float> key_l_, key_r_;        // ARR_INS_KOMP x INS_BLOCK, built in the constructor
  std::vector<float> ring_l_, ring_r_;      // slice 5 U2b: the key delay rings, ARR_INS_KOMP x ARR_SCHL_VERZ_MAX, built in the constructor
  std::vector<float> verz_l_, verz_r_;      // slice 5 U2b: the delayed key of the block, ARR_INS_KOMP x INS_BLOCK
  int ring_p_[ARR_INS_KOMP] = {};           // write position in the ring of the slot
  bool ring_voll_[ARR_INS_KOMP] = {};       // the ring of the slot holds samples (it is cleared when the key changes, the stage is cleared or the stage runs on its own signal)
  int verz_s_[ARR_INS_KOMP] = {}, verz_z_[ARR_INS_KOMP] = {}, spaet_[ARR_INS_KOMP] = {};   // delay of the structural key, of the row key, lag of a late structural key (from the chain entry at the last swap)
  void ring_leere(int s);
  std::vector<float> schl_l_, schl_r_;      // ARR_SPUREN x INS_BLOCK, built in the constructor
  uint64_t maske_ = 0;                      // strips with a stage or a tail
  uint64_t nan_ = 0;
  std::unique_ptr<ArrArbeit> arbeit0_;      // lane 0 struct of the serial wrappers (built in the constructor)
};

static_assert(INS_PARAM_MAX >= INS_UTIL_PARAM, "INS_PARAM_MAX is the maximum over all stage kinds (utility)");
static_assert(ARR_INS_ALLE <= 64, "slot_eigen_ is a 64-bit mask per strip (32 bits until arr-fx slice 2)");

}  // namespace cdj
