// C interface to the native EQ insert (Rust eq_dsp via djk/instruments/reverb_ffi, same libhall_ffi.a as reverb and compressor).
// neu allocates and returns null for a non-finite or non-positive fs or when allocation fails (outside the audio callback); block, setze_band, setze_global, leeren, latenz allocate nothing. block works in place.
// Latency is 69 samples at 44.1/48 kHz (0 from 88 kHz) and does not change with any band setting, bypassed bands included.
#pragma once
#include <cstddef>
#include <cstdint>

extern "C" {
struct CypherEq;
// art: 0 Bell, 1 LowShelf, 2 HighShelf, 3 LowCut, 4 HighCut, 5 Notch, 6 Bandpass; steilheit: 0..3 = 12/24/36/48 dB; kanal: 0 Stereo, 1 Mid, 2 Side
struct CypherEqBand {
  double freq, gain_db, q;
  uint8_t an, art, steilheit, kanal;
};
CypherEq* cypher_eq_neu(double fs);
void cypher_eq_frei(CypherEq* h);
void cypher_eq_setze_band(CypherEq* h, uint32_t i, CypherEqBand b);   // i in 0..8, out of range is ignored; non-finite freq/gain/q is ignored unless an == 0 (then the band goes off with its old numbers)
void cypher_eq_setze_global(CypherEq* h, uint8_t prop_q, double ausgang_db);
void cypher_eq_leeren(CypherEq* h);
uint32_t cypher_eq_latenz(const CypherEq* h);
void cypher_eq_block(CypherEq* h, float* l, float* r, size_t n);
// Dynamic bands (only Bell, Low shelf, High shelf act on it). modus: 0 off, 1 above threshold, 2 below, 3 above with key, 4 below with key; schwelle/bereich in dB; non-finite is ignored.
void cypher_eq_setze_dyn(CypherEq* h, uint32_t i, uint8_t modus, double schwelle, double bereich);
void cypher_eq_setze_dyn_zeiten(CypherEq* h, double attack_ms, double release_ms);   // 0.1..100 / 5..1000 ms, clamped
// Like block, with a key for bands in mode 3/4; kl/kr may be null (no key; null kr reuses kl); latency unchanged.
void cypher_eq_block_schluessel(CypherEq* h, float* l, float* r, const float* kl, const float* kr, size_t n);
float cypher_eq_dyn_db(const CypherEq* h, uint32_t i);   // current dynamic change of band i in dB
float cypher_eq_dyn_max_db(CypherEq* h);                  // signed largest |change| since the last call (negative = cut), reads and resets
}
