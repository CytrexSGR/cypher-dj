// C-Schnittstelle zu Cypher Komp (Rust komp_dsp über djk/instrumente/hall_ffi, dieselbe libhall_ffi.a wie der Hall).
// neu allokiert (außerhalb des Callbacks); block, setze, leeren, gr_db allokieren nicht. block arbeitet in place.
#pragma once
#include <cstddef>

extern "C" {
struct CypherKomp;
struct CypherKompEinstellung {
  double schwelle_db, ratio, knie_db, attack_ms, release_ms, makeup_db, mix, sc_hochpass_hz;
};
CypherKomp* cypher_komp_neu(double fs);
void cypher_komp_frei(CypherKomp* h);
void cypher_komp_setze(CypherKomp* h, CypherKompEinstellung e);
void cypher_komp_leeren(CypherKomp* h);
double cypher_komp_gr_db(const CypherKomp* h);
void cypher_komp_block(CypherKomp* h, float* l, float* r, size_t n);
void cypher_komp_block_sc(CypherKomp* h, float* l, float* r, const float* kl, const float* kr, size_t n);   // Detektor hört auf kl/kr
}
