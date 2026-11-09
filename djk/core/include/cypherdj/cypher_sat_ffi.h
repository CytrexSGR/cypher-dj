// C interface to the native saturation insert (Rust saett_dsp via djk/instruments/reverb_ffi, same libhall_ffi.a as reverb, compressor and EQ).
// neu allocates (outside the audio callback); block, setze, leeren, latenz allocate nothing. block works in place.
// Latency is a whole number of samples: 69 at 44.1/48 kHz (0 from 88 kHz, no oversampling), independent of mix (the dry line
// is delayed by the same amount). The wet path has an additional fractional offset from the antiderivative antialiasing
// (about 0.25 sample with oversampling, 0.5 without); whole-sample delay compensation cannot remove it.
// neu() starts with drive +12 dB, output -6 dB, mix 1: it saturates before any setze. neu returns null for fs <= 0 or not finite.
// The ranges of the user-facing controls are to be enforced by the controller-table rows added in T12; until then the
// caller must clamp. +-60 dB in setze only guards against overflow. If a panic is caught inside block, the signal is untouched only when it came before the first sample.
#pragma once
#include <cstddef>
#include <cstdint>

extern "C" {
struct CypherSaett;
CypherSaett* cypher_saett_neu(double fs);
void cypher_saett_frei(CypherSaett* h);
// drive_db / ausgang_db limited to +-60 dB, mix 0..1; a non-finite value ignores the whole call
void cypher_saett_setze(CypherSaett* h, double drive_db, double ausgang_db, double mix);
void cypher_saett_leeren(CypherSaett* h);
uint32_t cypher_saett_latenz(const CypherSaett* h);
void cypher_saett_block(CypherSaett* h, float* l, float* r, size_t n);
}
