// C-Schnittstelle zur RB-338 (Rust rb_dsp über djk/instrumente/hall_ffi, dieselbe libhall_ffi.a wie Hall und Komp), für
// die interne Instrument-Spur des Arrangements (D1, Spec 2.4). neu allokiert (außerhalb des Callbacks); alles andere
// allokiert nicht. block im Callback unter cypherdj::dsp::DenormalSchutz aufrufen, wie Hall und Komp.
// Noten: Versatz in Samples ab dem Anfang des nächsten block (auch dahinter: wandert in den Folgeblock), höchstens 256
// gemeldete Ereignisse bis zum nächsten block. Rückgabe 0, -1 voll oder Zeiger null, -2 Ton außerhalb 0..127.
// Am selben Sample: alle_aus vor Note-Ein (egal in welcher Reihenfolge gemeldet); mehrere Note-Ein: die zuletzt gemeldete
// klingt. Velocity vel/127, über 127 geklemmt, Akzent ab 120. Bis zum ersten Note-Ein nach neu/zuruecksetzen ruht die
// Stimme: eine Note bei Versatz k ist bitgleich die um k verschobene Note bei Versatz 0 (A3).
// Parameter: IDs aus rb338 (lautstaerke, wellenform, cutoff, resonanz, env_mod, decay, accent), normiert 0..1, Abbildung,
// Vorgabe (Lautstärke -12 dB) und Glättung wie das Plugin; wirksam ab dem nächsten block. Rückgabe 0, -1 ID unbekannt
// oder Zeiger null, -2 NaN. zuruecksetzen ändert keine Parameter. Transport-Start (live und Render gleich): vorgaben,
// setze für jeden Parameter der Wiedergabe, zuruecksetzen, dann die Noten des Laufs melden. Kein Aufruf nebenläufig mit
// block. Ein Panic im Rust-Teil kommt nicht über die Grenze: block liefert dann Stille und setzt zurück.
#pragma once
#include <cstddef>
#include <cstdint>

extern "C" {
struct CypherRb;
CypherRb* cypher_rb_neu(double fs);   // fs <= 0 oder nicht endlich: nullptr
void cypher_rb_frei(CypherRb* h);
int32_t cypher_rb_note_an(CypherRb* h, uint32_t versatz, uint8_t ton, uint8_t vel);   // vel 0 heißt Note-Aus
int32_t cypher_rb_note_aus(CypherRb* h, uint32_t versatz, uint8_t ton);
int32_t cypher_rb_alle_aus(CypherRb* h, uint32_t versatz);   // Stapel leer, vor Noten-Ein desselben Samples
int32_t cypher_rb_setze(CypherRb* h, const char* id, float normiert);
void cypher_rb_vorgaben(CypherRb* h);        // alle Parameter auf die Vorgabe des Plugins (wie setze)
void cypher_rb_zuruecksetzen(CypherRb* h);   // Phase, Filter, Hüllkurven, Glide; Noten verworfen, Glätter am Ziel
void cypher_rb_block(CypherRb* h, float* aus_l, float* aus_r, size_t n);   // mono auf beide; h null: Stille
}
