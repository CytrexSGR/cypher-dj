// C-Schnittstelle zu Baukasten-Graphen (Rust baukasten_dsp über djk/instrumente/hall_ffi, dieselbe libhall_ffi.a wie
// Hall, Komp und RB-338), für Erzeuger-Ströme mit Ziel bk:<name> (Baukasten S3a). neu übersetzt und allokiert (Netz-
// Faden) und setzt zurück (Seiten vorgewärmt); alles andere allokiert nicht. block im Callback unter
// cypherdj::dsp::DenormalSchutz aufrufen. Noten: Versatz in Samples ab dem Anfang des nächsten block (dahinter: wandert
// in den Folgeblock), höchstens 256 gemeldete Ereignisse bis zum nächsten block; am selben Sample alle_aus vor aus vor
// an. Rückgabe 0, -1 voll oder Zeiger null, -2 Ton über 127. vel 0..1. Kein Aufruf nebenläufig mit block. Ein Panic im
// Rust-Teil kommt nicht über die Grenze: block liefert dann Stille, setzt zurück und gibt -1.
// Effekt-Graphen (S3c, Knoten `eingang`) rechnen mit `cypher_bk_effekt` im Kanalzug; `cypher_bk_takt` setzt Beat und Tempo je Block.
#pragma once
#include <cstddef>
#include <cstdint>

extern "C" {
struct CypherBk;
// json nullterminiert (baukasten/2); fs > 0. Fehler: nullptr, Text nach fehler (höchstens fehler_laenge Bytes mit Null)
CypherBk* cypher_bk_neu(const char* json, double fs, char* fehler, size_t fehler_laenge);
void cypher_bk_frei(CypherBk* h);
int32_t cypher_bk_note_an(CypherBk* h, uint32_t versatz, uint8_t ton, float vel);
int32_t cypher_bk_note_aus(CypherBk* h, uint32_t versatz, uint8_t ton);
int32_t cypher_bk_alle_aus(CypherBk* h, uint32_t versatz);
int32_t cypher_bk_block(CypherBk* h, float* aus_l, float* aus_r, size_t n);   // überschreibt; h null: Stille
// Effekt (S3c): ein_* Host-Audio, aus_* überschrieben, Ein- und Ausgang getrennt; h null: Stille
int32_t cypher_bk_effekt(CypherBk* h, const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, size_t n);
int32_t cypher_bk_regler(CypherBk* h, uint32_t nr, float wert);   // nr 1..8, 0..1 (geklemmt, NaN ignoriert), 20 ms geglättet; -1 h null oder nr falsch; nicht nebenläufig mit block
void cypher_bk_takt(CypherBk* h, double beat0, double bps);   // beat0 = erstes Sample des nächsten Blocks
uint32_t cypher_bk_hat_eingang(const CypherBk* h);            // 1 Effekt-Graph, 0 Instrument oder null
uint32_t cypher_bk_latenz(const CypherBk* h);
uint32_t cypher_bk_rettungen(const CypherBk* h);
uint32_t cypher_bk_verloren(const CypherBk* h);
uint32_t cypher_bk_panik(const CypherBk* h);
}
