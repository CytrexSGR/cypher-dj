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
}
