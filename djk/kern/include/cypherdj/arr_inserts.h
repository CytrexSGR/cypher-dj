// 1.10 slice 4a T2 / 4b T12: the insert chains of the arrangement mixer. Pools of ARR_INS_KOMP compressors (Cypher Komp, komp.h), ARR_INS_EQ EQs (eq.h) and
// ARR_INS_SAETT saturators (saett.h) and ARR_INS_LIM limiters (ins_lim.h, KanalLimiter) built in the constructor, per-slot bypass blend, tail on removal, NaN guard. A slot is addressed by one global index:
// komp 0..ARR_INS_KOMP-1, then the eqs, the saturators and the limiters (ins_global()). The mixer (arr_ausgang.cpp) calls kette() as a block-wise pass over a strip's input buffer,
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
// Key alignment (slice 5 U2b, plan E9): a compressor key arrives at its capture point earlier than the stage input when latency stages sit in front of the stage (the input is later by the
// sum of their latencies, a path sum). The loader computes the delay per stage (ArrStufe::schl_verz for a structural key, schl_verz_zeile for the row sc, arr_schluessel_versatz()); the
// slot delays the key by it in a ring built in the constructor (one stereo ring of ARR_SCHL_VERZ_MAX samples per compressor slot). A key that arrives later is used as it is.
// Rack macros (slice 4c T15, spec D13): the rows rack/<k>/m1..m4 hold four macro values 0..1 per pooled rack. makros_planen() turns the mapping table of a strip (ArrRack) into a value per
// mapped parameter, `von + m * (bis - von)`, once per block before anything reads a parameter; eff() then returns that value for a mapped parameter and ignores the parameter's own row
// (one writer per parameter). A strip without a rack takes no pass; the override is cleared when the table goes away.
#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/eq.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/komp.h"
#include "cypherdj/saett.h"

namespace cdj {

constexpr int INS_BLOCK = 1024;           // = ARR_BLOCK (arrangement.h), checked by a static_assert there
constexpr int INS_BLENDE = 480;           // bypass, enter and leave: 10 ms, as the Hall blend
constexpr int INS_KOMP_PARAM = 10;        // an, schwelle, ratio, knie, attack, release, makeup, mix, schp, sc (the order of the roles ins_komp_*)
constexpr int INS_EQ_BAND_PARAM = 7;      // per band: an, typ, freq, gain, q, steil, platz (the order of the roles ins_eq_b_*)
constexpr int INS_EQ_PARAM = 3 + 8 * INS_EQ_BAND_PARAM;   // an, out, propq, then b1..b8: 59 (ins/eq/<n>/b<m>/<parameter> is index 3 + (m - 1) * 7 + parameter)
constexpr int INS_SAETT_PARAM = 4;        // an, drive, out, mix
constexpr int INS_LIM_PARAM = 3;          // an, decke, abklingen (the order of the roles ins_lim_*)
constexpr int INS_PARAM_MAX = INS_EQ_PARAM;
constexpr int INS_LAT_MAX = 128;          // longest stage latency the dry ring holds (the constructor refuses a module that reports more)

// global slot index of (kind, 0-based slot); -1 for a kind without a pool or a slot out of range
inline int ins_global(ArrInsArt art, int slot) {
  switch (art) {
    case ArrInsArt::komp: return slot >= 0 && slot < ARR_INS_KOMP ? slot : -1;
    case ArrInsArt::eq: return slot >= 0 && slot < ARR_INS_EQ ? ARR_INS_KOMP + slot : -1;
    case ArrInsArt::saett: return slot >= 0 && slot < ARR_INS_SAETT ? ARR_INS_KOMP + ARR_INS_EQ + slot : -1;
    case ArrInsArt::lim: return slot >= 0 && slot < ARR_INS_LIM ? ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT + slot : -1;
    default: return -1;
  }
}
inline ArrInsArt ins_art(int g) {
  return g < ARR_INS_KOMP ? ArrInsArt::komp : g < ARR_INS_KOMP + ARR_INS_EQ ? ArrInsArt::eq : g < ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT ? ArrInsArt::saett : ArrInsArt::lim;
}

class ArrInserts {
 public:
  ArrInserts();                           // builds the pool (allocates, outside the callback)
  ~ArrInserts();
  ArrInserts(const ArrInserts&) = delete;
  ArrInserts& operator=(const ArrInserts&) = delete;

  // ---- controls (written by the Arrangement like the strip controls)
  void binde(int slot, int param, float vorgabe);                // constructor time: the default of a row (slot = global index)
  void setze_sofort(int slot, int param, float w);
  void verlauf(int slot, int param, const float* werte);         // valid until the end of the next block
  void nachfuehren(int m);                                       // after a block: a course ends in the base value

  // ---- rack macros (slice 4c T15): the rows rack/<k>/m<n>, k = 0-based rack slot, n = 0-based macro
  void makro_binde(int rack, int nr, float vorgabe);             // constructor time: the default of a row
  void makro_sofort(int rack, int nr, float w);
  void makro_verlauf(int rack, int nr, const float* werte);      // valid until the end of the next block
  void makros_planen(const ArrKette* ketten, const ArrRack* racks, int m);   // ARR_KETTEN entries each, or nullptr (no playback); once per block, before schluessel_planen()
  float wirksam(int slot, int param) const {                     // the value the module of the slot got last (komp: 1..8, eq: 1..58, saett: 1..3, lim: 1..2); 0 for the others
    return slot >= 0 && slot < ARR_INS_ALLE && param >= 1 && param < INS_PARAM_MAX ? angewandt_[slot][param] : 0.0f;
  }
  bool makro_treibt(int slot, int param) const { return slot >= 0 && slot < ARR_INS_ALLE && param >= 0 && param < INS_PARAM_MAX && ueber_[slot][param]; }

  // ---- structure
  void tausche(const ArrKette* ketten);                          // swap: ARR_KETTEN chains or nullptr (no playback)
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

  // ---- readings
  float gr_db(int slot) const { return gr_[slot]; }              // gain reduction >= 0 of the last block the stage ran in
  bool lief(int slot) const { return lief_[slot]; }              // the stage computed in the last block it was asked for
  uint64_t nan_zaehler() const { return nan_; }
  int latenz(int slot) const { return slot >= 0 && slot < ARR_INS_ALLE ? lat_[slot] : 0; }   // the latency of the stage kind in the slot, samples

 private:
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
    return p_[s][p].vl ? p_[s][p].vl[m - 1] : p_[s][p].w;
  }
  void stufe(int s, bool ziel_an, float* l, float* r, int m);
  void leere(int s);

  void trocken_speise(int s, const float* l, const float* r, int m, float* aus_l, float* aus_r);   // feeds the dry ring of a stage with latency, optionally reads the delayed dry out
  void trocken_leere(int s);
  void setze_dsp(int s, int m);                                  // gives a changed parameter set to the module of the slot (once per block, only on change)
  void rechne(int s, float* l, float* r, int m);                 // the module's block call (komp: with the key when the stage has one)
  int n_param(int s) const {
    return s < ARR_INS_KOMP ? INS_KOMP_PARAM : s < ARR_INS_KOMP + ARR_INS_EQ ? INS_EQ_PARAM : s < ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT ? INS_SAETT_PARAM : INS_LIM_PARAM;
  }

  std::unique_ptr<Komp> komp_[ARR_INS_KOMP];
  std::unique_ptr<EqNativ> eq_[ARR_INS_EQ];
  std::unique_ptr<SaettNativ> saett_[ARR_INS_SAETT];
  std::unique_ptr<cypherdj::dsp::KanalLimiter> lim_[ARR_INS_LIM];
  Wert p_[ARR_INS_ALLE][INS_PARAM_MAX];
  Wert mk_[ARR_RACKS][ARR_MAKROS];          // the macro rows rack/<k>/m<n>
#ifdef CYPHERDJ_MUTATION_MAKRO_SPAET
  float mk_alt_[ARR_RACKS][ARR_MAKROS] = {};   // error case: the macro value of the block before
#endif
  bool ueber_[ARR_INS_ALLE][INS_PARAM_MAX] = {};   // the parameter is driven by a macro in this block
  float ueber_w_[ARR_INS_ALLE][INS_PARAM_MAX] = {};
  bool ueber_aktiv_ = false;                // some entry of ueber_ is set (so that a strip set without racks costs nothing and the entries are cleared once)
  float angewandt_[ARR_INS_ALLE][INS_PARAM_MAX] = {};   // the values last given to the module (komp: schwelle .. schp = 1..8; eq: out .. b8/platz = 1..58; saett: drive .. mix = 1..3; lim: decke, abklingen = 1..2)
  bool gesetzt_[ARR_INS_ALLE] = {};
  int besitzer_[ARR_INS_ALLE];              // strip that owns the slot, -1 none
  bool in_kette_[ARR_INS_ALLE] = {};        // the owner's chain in the current snapshot lists the slot
  int pos_[ARR_INS_ALLE] = {};              // blend position 0..INS_BLENDE (weight = pos / INS_BLENDE)
  bool lief_[ARR_INS_ALLE] = {};
  float gr_[ARR_INS_ALLE] = {};             // gain reduction (komp and lim; eq and saett report 0)
  int sc_[ARR_INS_KOMP] = {};               // key track of the stage in this block, 1..32, 0 = own signal
  int lat_[ARR_INS_ALLE] = {};              // latency of the stage kind of each slot, samples
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
  float dry_l_[INS_BLOCK] = {}, dry_r_[INS_BLOCK] = {};
};

}  // namespace cdj
