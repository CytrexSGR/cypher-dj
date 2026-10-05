// MVP 2 (Spec docs/specs/2026-09-27-djk-mvp2-loops-design.md, ADR 025, SCHNITTSTELLEN §4.9): zwei Loop-Boxen im Kern.
// Box b spielt ihren Loop phasenstarr zur Kern-Uhr in den Eingang von pad/b (vor Trim): Position = (Beat mod beats)
// · LOOP_SPB, je Block aus dem Beat neu gerechnet. Start und Stopp wirken auf der nächsten Takt-Eins. Loops liegen bei
// 128 BPM: dort liest die Box ganzzahlig (Direktweg, bitgenau); weicht die Karte ab, liest sie mit gebrochenem Schritt
// (Varispeed ohne Tonhöhenerhalt, Plan Tempo-Folge 2026-09-30). Außer dem Konstruktor läuft alles im Callback: keine
// Allokation, feste Größen.
#pragma once

#include <cmath>
#include <cstdint>

#include "cypherdj/loop.h"
#include "cypherdj/mixer.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int LOOP_BOXEN = 2;
constexpr int LOOP_KANAL0 = 12;   // pad/1; Box b spielt in Mixer-Kanal LOOP_KANAL0 + b − 1
constexpr int MITSCHNITT_KANAL = 4;  // erz/1 (Mixer-Layout: deck 0..3, erz 4..11); Mitschnitt liest hier vor Trim

enum class BoxStatus : int32_t { leer = 0, bereit = 1, wartet = 2, laeuft = 3, endet = 4, tempo = 5 };

struct BoxMeldung {  // ein Statuswechsel mitten im Block, für /e/loop
  int box;
  BoxStatus status;
  int64_t sample;
};

class LoopBoxen {
 public:
  // Box 1..2 bekommt einen Loop. Gibt den abgelösten zurück (nullptr, wenn keiner oder derselbe), bei ungültiger Box
  // den übergebenen: der Aufrufer gibt ihn außerhalb des Callbacks frei. Eine laufende Box spielt den neuen weiter.
  const Loop* laden(int box, const Loop* l);
  // Keylock (Plan 2026-09-30): Box 1..2 bekommt eine vorgerenderte Variante ihres Loops (bpm = Renderttempo T_r). Sie
  // gilt nur in Blöcken, in denen |bpm − v->bpm| ≤ 0,05 und k = 0 an beiden Blockrändern; sonst spielt die Box wie
  // heute. Rückgabe wie laden: die abgelöste Variante (nullptr, wenn keine oder dieselbe), bei ungültiger Box oder Box
  // ohne Loop v selbst. Klingt die alte Variante gerade noch (Blende), geht sie erst nach der Blende über abholen()
  // zurück. Der Aufrufer gibt sie außerhalb des Callbacks frei.
  // Abgelehnt (v kommt sofort zurück, die bisherige Variante bleibt, abgelehnt() zählt): v gehört nicht zum geladenen
  // Loop der Box, also anderer name, andere beats, frames ≠ llround(frames_loop · 128 / v->bpm) ± 1, frames ≤ 0,
  // daten.size() ≠ 2 · frames oder ein bpm, das kein Tempo ist. Die Variante übernimmt den name des Originals.
  const Loop* variante_setzen(int box, const Loop* v);
  int abgelehnt() const { return abgelehnt_; }  // Zähler: Varianten, die variante_setzen nicht zu diesem Loop gehörig fand
  const Loop* variante(int box) const { return gueltig(box) ? b_[box - 1].variante : nullptr; }
  // Freigabe-Ring (fest, ohne Allokation): Varianten, die die Box selbst loswird (laden verwirft die Variante des alten
  // Loops; nach einer Blende). nullptr, wenn nichts wartet. Nur im Callback-Faden aufrufen, nach laden/block.
  const Loop* abholen();
  int abholen_verloren() const { return frei_verloren_; }  // Zähler: Ring voll, Variante nicht mehr zurückgebbar (Leck)
  // beat0: Beat des ersten noch nicht gespielten Samples. false: ungültige Box oder kein Loop geladen.
  bool start(int box, double beat0);
  bool stopp(int box, double beat0);
  // neue Zeitachse (§4.2): alle Boxen stehen (bereit), Loops bleiben. Ein laufender Mitschnitt gilt als abgebrochen:
  // Rückgabe der Zeiger (nullptr: keiner lief), der Aufrufer gibt ihn außerhalb des Callbacks als /e/mitschnitt frei.
  [[nodiscard]] Mitschnitt* leeren();  // Plan-Review: die Rückgabe zu verwerfen wäre ein Leck
  // MVP 2 Scheibe 2 (§4.9 /k/loop/rec): startet einen Mitschnitt ab dem nächsten Vielfachen von m->beats Beats.
  // false: es läuft schon einer (Aufrufer meldet ueberlappung und gibt m zurück, ohne ihn zu berühren).
  bool mitschnitt(Mitschnitt* m, double beat0, const Karte& k);
  // Keylock Slice 4 (F3): Einsatz-Beat eines Mitschnitts von beats Beats, der bei beat0 angefordert wird: das nächste
  // Vielfache von beats ab beat0. Dieselbe Rechnung wie in mitschnitt(); der Kern prüft damit vorab, ob eine Rampe
  // in das Fenster [ab_beat, ab_beat + beats) fällt.
  static double mitschnitt_ab_beat(double beat0, int beats);
  // Samples [n0, n0 + n), n <= MIX_BLOCK. ein_l[k], ein_r[k]: Eingang des Mixer-Kanals k (addiert, auch gelesen für
  // den Mitschnitt: ein_l[MITSCHNITT_KANAL] ist erz/1 vor Trim). Schreibt die Statuswechsel dieses Blocks nach
  // meldungen (höchstens max) und gibt ihre Zahl zurück. fertig (optional): wird auf den Mitschnitt gesetzt, sobald
  // sein Puffer voll ist (der Aufrufer meldet /e/mitschnitt und gibt ihn frei); sonst unverändert.
  int block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, BoxMeldung* meldungen,
            int max, Mitschnitt** fertig = nullptr);
  BoxStatus status(int box) const;
  const Loop* loop(int box) const { return gueltig(box) ? b_[box - 1].loop : nullptr; }
  // Plan Grid (§4.9 /k/loop/raster): Versatz der Box absolut setzen. 0 ok, 1 leere Box (nicht_geladen),
  // 2 Betrag ≥ frames oder ungültige Box (ausserhalb_bereich). Laden übernimmt den Versatz des Loops.
  int raster(int box, int64_t v);
  int64_t versatz(int box) const { return gueltig(box) ? b_[box - 1].versatz : 0; }

 private:
  struct Box {
    const Loop* loop = nullptr;
    int64_t versatz = 0;  // Plan Grid
    BoxStatus status = BoxStatus::leer;
    double start_beat = 0.0, stopp_beat = 0.0;
    int64_t start_sample = 0;  // nur für den Fehlerfall der Abnahme (CYPHERDJ_MUTATION_LOOP_AB_START)
    // Keylock: Variante und Blende. pfad = Quelle des letzten Blocks (loop oder Variante), blende_alt = Quelle, aus der
    // noch ausgeblendet wird (nullptr: keine Blende), blende_pos = schon geblendete Frames (0 bis BLENDE_FRAMES).
    const Loop* variante = nullptr;
    const Loop* pfad = nullptr;
    const Loop* blende_alt = nullptr;
    int blende_pos = 0;
  };
  static bool gueltig(int box) { return box >= 1 && box <= LOOP_BOXEN; }
  static double naechste_eins(double beat0) { return std::ceil(beat0 / 4.0 - 1e-9) * 4.0; }
  static void spiele(const Box& b, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l, float* r);
  // Lesekopf mit gebrochenem Schritt über lp (Original oder Variante); versatz in Frames von lp
  static void spiele_frei(const Loop& lp, double versatz, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l,
                          float* r);
  static bool passt(const Loop& lp, const Loop& v);  // gehört v zu lp (name, beats, Länge, Tempo)?
  static bool variante_gilt(const Box& b, double bpm0, double bpm1, bool ruhig);
  static void spiele_pfad(const Box& b, const Loop* q, bool direkt, const Karte& k, int64_t von, int64_t bis, int64_t n0,
                          float* l, float* r);
  void gib_frei(Box& b, const Loop* q);   // q loswerden, wenn die Box es nicht mehr braucht (Ring)
  void pfad_verwerfen(Box& b);            // laufender Pfad und Blende vergessen (Box steht oder Loop getauscht)
  static constexpr int BLENDE_FRAMES = 960;  // 20 ms bei 48 kHz
  static constexpr int FREI_MAX = 8;
  Box b_[LOOP_BOXEN];
  float tmp_l_[MIX_BLOCK] = {}, tmp_r_[MIX_BLOCK] = {};
  float alt_l_[MIX_BLOCK] = {}, alt_r_[MIX_BLOCK] = {};  // Keylock: alter Lesepfad während der Blende (vorab, kein Malloc)
  const Loop* frei_[FREI_MAX] = {};
  int frei_n_ = 0, frei_verloren_ = 0, abgelehnt_ = 0;
  Mitschnitt* mitschnitt_ = nullptr;  // MVP 2 Scheibe 2: höchstens einer zur Zeit, Besitz bleibt beim Aufrufer
};

}  // namespace cdj
