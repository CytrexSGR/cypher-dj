// C-Schnittstelle zu Cypher Hall (Rust, djk/instrumente/hall_ffi). Gebaut von cargo als libhall_ffi.a (CMakeLists).
// neu allokiert (außerhalb des Callbacks); block, setze, leeren allokieren nicht. block liefert nur den nassen Anteil.
#pragma once
#include <cstddef>
#include <cstdint>

extern "C" {
struct CypherHall;
struct CypherHallEinstellung {
  double frueh, fahne_db, pre_ms, groesse_ms, decay_s, tief_faktor, hoch_faktor, lowcut_hz, highcut_hz, diffusion,
      breite, duck;
  uint8_t freeze;
  uint32_t rahmen;   // Index in {512, 1024, 2048, 4096, 8192}
};
CypherHallEinstellung cypher_hall_vorgabe();
CypherHall* cypher_hall_neu(double fs);
void cypher_hall_frei(CypherHall* h);
void cypher_hall_setze(CypherHall* h, CypherHallEinstellung e);
void cypher_hall_leeren(CypherHall* h);
void cypher_hall_block(CypherHall* h, const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, size_t n);
}
