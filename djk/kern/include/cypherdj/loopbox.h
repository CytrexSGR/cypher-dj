// MVP 2 (Spec docs/specs/2026-09-27-djk-mvp2-loops-design.md, ADR 025, SCHNITTSTELLEN §4.9): zwei Loop-Boxen im Kern.
// Box b spielt ihren Loop phasenstarr zur Kern-Uhr in den Eingang von pad/b (vor Trim): Position = (Beat mod beats)
// · LOOP_SPB, je Block aus dem Beat neu gerechnet. Start und Stopp wirken auf der nächsten Takt-Eins. Loops liegen bei
// 128 BPM: dort liest die Box ganzzahlig (Direktweg, bitgenau); weicht die Karte ab, liest sie mit gebrochenem Schritt
// (Varispeed ohne Tonhöhenerhalt, Plan Tempo-Folge 2026-09-30; mit Keylock, Task 7, klingt dann der Ring des Dehners).
// Außer dem Konstruktor läuft alles im Callback: keine
// Allokation, feste Größen.
#pragma once

#include <atomic>
#include <cmath>
#include <cstdint>

#include "cypherdj/blende.h"
#include "cypherdj/dehner.h"
#include "cypherdj/loop.h"
#include "cypherdj/mixer.h"
#include "cypherdj/streck_quelle.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int LOOP_BOXEN = 2;
constexpr int LOOP_KANAL0 = 12;   // pad/1; Box b spielt in Mixer-Kanal LOOP_KANAL0 + b − 1
constexpr int MITSCHNITT_KANAL = 4;  // erz/1 (Mixer-Layout: deck 0..3, erz 4..11); Mitschnitt liest hier vor Trim
// Welle 2 (Audit 2026-10-01, Erhebung ~/messungen/2026-10-01-klickfrei): Hülle der Loop-Box. Vorgaben der Erhebung,
// gehört 2026-10-06 (Plan Welle 2, Fragen O2, O3, O7), Andreas: „passt alles“ (~/messungen/2026-10-06-welle2-blende/ohr/antworten.md).
constexpr int LOOPBOX_EIN = 32;          // F15: Einsatz 0,67 ms, nur wenn der erste Wert über LOOPBOX_KANTE liegt
constexpr int LOOPBOX_AUS = 144;         // F15: Stopp 3 ms, endet genau auf dem Stoppsample (letztes Sample davor 0)
// Prüfung 2.3 Befund 5: kürzeste Stopp-Rampe. Kommt ein Stopp weniger als LOOPBOX_AUS_MIN Samples vor seiner Eins an
// (bis 0: Eins auf dem Blockanfang), endet die Ausblende LOOPBOX_AUS_MIN Samples nach der Anforderung, also kurz nach der
// Eins, statt mit einem Sprung auf ihr. UNGEHÖRT, gleiche Länge wie LOOPBOX_EIN.
constexpr int LOOPBOX_AUS_MIN = 32;
static_assert(LOOPBOX_AUS_MIN > 0, "Befund 5: 0 wäre der Sprung");
constexpr float LOOPBOX_KANTE = 0.001f;  // F15: −60 dBFS; darunter setzt die Box hart ein, bitgleich wie bisher
// Laden in eine klingende Box (F13, gleich laut, zwei verschiedene Loops): gehört 06.10., Andreas: „passt alles“.
constexpr int LOOPBOX_LADEN_BLENDE = 960;   // 20 ms bei 48 kHz
static_assert(LOOPBOX_LADEN_BLENDE > 0, "Blende 0 wäre der Sprung");
static_assert(LOOPBOX_EIN > 0 && LOOPBOX_AUS > 0, "F15: 0 heißt Fund verworfen, nicht Festschreiben (Plan Welle 2, Task 2.3.8)");

// Keylock Task 7 (Plan 2026-10-06-keylock-echtzeit.md, Detailschnitt 7a 3.2): der Loop einer Box als Band des Dehners.
// Wickelt zustandslos modulo frames (die Loop-Naht im Thread, so hart wie im Direktweg, LoopBoxen::spiele): R3 sieht einen
// periodischen Strom. Ein Aufruf darf mehr als frames Frames verlangen (1-Beat-Loop 22 500 < Quellpuffer 32 768). Nur
// lesend, aus zwei Fäden zugleich (dehner.h); der Loop muss leben, bis die Leihe der Box ihn frei gibt (Vertrag 4).
class BoxBand final : public DehnerQuelle {
 public:
  const Loop* loop = nullptr;
  // Keylock 7b.2: Start aus Stille. Quellframes (ungewickelt) vor still_bis liefert das Band als Stille: der Ring klingt
  // vor dem Einsatz schon (BOX_VORLAGE), ohne den Schwanz des Loops. Keylock 7c.3 (Nachprüfung 7b Q2): der Wert hängt am
  // Versatz, ein Raster in der wartenden Box ändert ihn; dafür bleibt es dasselbe Band (Plan 7a 3.4: wartet = gleiches Band,
  // keine Leihe), der Callback schreibt ihn atomar (relaxed), der Dehner liest ihn je band(). Eine noch laufende alte Epoche
  // sieht den neuen Wert: sie ist in der wartenden Box nicht hörbar (ein hörbarer Ring der Vorlage wird vorher eingefroren),
  // und nach dem Einsatz liest sie nur noch Quellframes hinter dem Einsatz.
  std::atomic<int64_t> still_bis{INT64_MIN};
  BoxBand() = default;
  BoxBand(const BoxBand& o) noexcept : loop(o.loop), still_bis(o.still_bis.load(std::memory_order_relaxed)) {}
  BoxBand& operator=(const BoxBand& o) noexcept {
    loop = o.loop;
    still_bis.store(o.still_bis.load(std::memory_order_relaxed), std::memory_order_relaxed);
    return *this;
  }
  void band(int64_t ab, int n, float* l, float* r) const noexcept override;
  double basis_bpm() const noexcept override { return LOOP_BPM; }
};
// Anker eines Ansatzes bei Sample s (7a 3.2): b = Anfang des Loop-Durchlaufs, in dem s liegt, f = Versatz modulo frames.
// Dann ist kopf(s) mod frames = (Beat mod beats) · LOOP_SPB + Versatz, der Lesekopf des Direktwegs; der Dehner rechnet
// den Kopf ungewickelt (dehner.cpp kopf), nur band() wickelt.
DehnerAnker box_anker(const Karte& k, int64_t s, int beats, int64_t frames, int64_t versatz) noexcept;

constexpr int BOX_KEYLOCK_BAENDER = 4;  // Task 7 (7a 3.3): Plätze der StreckLeihe je Box
// Keylock 7b.2 (Prüfung Task 7 F2): beim Start aus Stille hört die Box den Ring schon so viele Samples vor dem Einsatz E (das
// Band liefert davor Stille). Grund: mit Versatz 0 liegt der Ring am Klick langsam früh (gemessen 100 BPM −104, 80 BPM −217,
// 60 BPM −420 Samples, Mitte eines 144er-Klicks; task-07b/p2_vorher_t4.txt); vorher öffnete die Box erst bei E und schnitt den
// ersten Schlag an (100 BPM −11,2 dB, 80 BPM −25,9 dB). 768 deckt 60 BPM mit Rand (Einsatz des Klicks dort bei E − 492).
// s_h liegt dafür bei E − STRECK_EINSCHWING − BOX_VORLAGE.
constexpr int BOX_VORLAGE = 768;

enum class BoxStatus : int32_t { leer = 0, bereit = 1, wartet = 2, laeuft = 3, endet = 4, tempo = 5 };

struct BoxMeldung {  // ein Statuswechsel mitten im Block, für /e/loop
  int box;
  BoxStatus status;
  int64_t sample;
};

class LoopBoxen {
 public:
  // Box 1..2 bekommt einen Loop. Gibt den abgelösten zurück (nullptr, wenn keiner oder derselbe), bei ungültiger Box
  // den übergebenen: der Aufrufer gibt ihn außerhalb des Callbacks frei. Klingt die Box, wartet der neue Loop (Rückgabe
  // nullptr) und übernimmt im nächsten Block ohne laufende Blende mit einer gleich lauten Blende über LOOPBOX_LADEN_BLENDE Frames (F13); der
  // alte kommt danach über abholen().
  // Keylock Task 7 (7a 3.3, Regel R-B1): mit Dehner geht ein Loop, den der Dehner gelesen haben kann (Ansatz noch nicht
  // durch eine quittierte Epoche abgelöst), NIE als Rückgabewert hinaus: dann nullptr, und er kommt über abholen(), sobald
  // die Leihe ihn frei gibt. s: Sample des Ereignisses (Kern: sample_). Ohne Dehner wie bisher.
  const Loop* laden(int box, const Loop* l, bool von_cypher = false, int64_t s = 0);
  // Freigabe-Ring (fest, ohne Allokation): Loops, die die Box selbst loswird (nach der Ladeblende, verworfene wartende,
  // mit Dehner verliehene nach der Quittung). nullptr, wenn nichts wartet. Nur im Callback-Faden aufrufen, nach laden/block.
  const Loop* abholen();
  // Keylock Task 3 (Fassung 4: EIN Knopf für alle Quellen, Regler `keylock`), Task 7: der Schalter des Rings. Ohne
  // Ereignis-Sample (Tests ohne Dehner, vor dem Start): nur der Stand.
  void keylock(bool an) noexcept { keylock_ = kl_an_ = an; }
  bool keylock() const noexcept { return keylock_; }
  // Task 7: der Schalter ab Sample s (Blockanfang) für Boxen mit Dehner: aus -> was im Ring klingt, blendet in den
  // Varispeed-Weg aus (einfrieren), Leer-Epoche; an -> Ansatz (wartende Box mit Vorlauf). Ohne Dehner wie keylock(an).
  void keylock(bool an, int64_t s) noexcept;
  int abholen_verloren() const { return frei_verloren_; }  // Zähler: Ring voll, Loop nicht mehr zurückgebbar (Leck)
  // beat0: Beat des ersten noch nicht gespielten Samples. false: ungültige Box oder kein Loop geladen.
  bool start(int box, double beat0, int64_t s = 0);  // Task 7: s = Sample des Ereignisses (Ansatz mit Vorlauf)
  bool stopp(int box, double beat0, int64_t s = 0);
  // neue Zeitachse (§4.2): alle Boxen stehen (bereit), Loops bleiben. Ein laufender Mitschnitt gilt als abgebrochen:
  // Rückgabe der Zeiger (nullptr: keiner lief), der Aufrufer gibt ihn außerhalb des Callbacks als /e/mitschnitt frei.
  // F15 (/k/set/neu, Welle 2): VOR leeren() aufrufen, mit der Karte, die bis s gilt. Jede klingende Box rechnet ihren Pfad
  // LOOPBOX_AUS Frames ab s auf dieser Karte weiter und blendet dabei vom Ist-Wert ihrer Hülle auf 0 (Schwanz); block()
  // mischt den Schwanz in die ersten Samples der neuen Zeitachse. Eine laufende Pfad-
  // oder Ladeblende läuft im Schwanz mit beiden Quellen weiter (Prüfung 2.3 Befund 4).
  void ausklingen(const Karte& k, int64_t s);
  void cypher_wartende_verwerfen();  // F13 x §4.7: wartende cypher-Loops über abholen() zurück
  [[nodiscard]] Mitschnitt* leeren(int64_t s = 0);  // Plan-Review: die Rückgabe zu verwerfen wäre ein Leck
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
  int raster(int box, int64_t v, int64_t s = 0);
  int64_t versatz(int box) const { return gueltig(box) ? b_[box - 1].versatz : 0; }

  // ---- Keylock Task 7 (Detailschnitt 7a 3.3 bis 3.5): die Box als Quelle des Dehners. Vor dem Start bzw. nicht im
  // Callback: Karte der Kern-Uhr (Adresse fest, Vertrag 10) und je Box Dehner und Post (nullptr: ohne Keylock, Box wie
  // bisher). Mit Dehner liest die Box bei bpm != 128 (Keylock an) den Ring des Dehners; ihr eigener
  // Lesepfad (Original, Direktweg bzw. Varispeed) ist dann die Brücke. Hängt der Dehner an einer schon spielenden Box,
  // setzt sie am nächsten Blockanfang an.
  void setze_karte(const Karte* k, const uint32_t* generation) noexcept;
  void setze_keylock(int box, DehnerBasis* d, StreckPost* post) noexcept;
  // Varispeed-Weg (Original, ohne Hülle und Gain) der Box für [s, s + n): was das Einfrieren als alten Weg braucht (7a 3.5
  // Punkt 5, wie Deck::vari_vorab). Reine Funktion von Karte, Loop und Versatz.
  void vari_vorab(int box, int64_t s, int n, float* l, float* r) const noexcept;
  const StreckLeser* keylock_leser(int box) const noexcept { return gueltig(box) ? &kl_[box - 1].les : nullptr; }
  bool keylock_bereit(int box) const noexcept { return gueltig(box) && kl_bereit(box - 1); }
  uint64_t keylock_kein_platz(int box) const noexcept { return gueltig(box) ? kl_[box - 1].kein_platz : 0; }
  int keylock_verliehen(int box) const noexcept { return gueltig(box) ? kl_[box - 1].leihe.belegt() : 0; }
  uint64_t keylock_fremd() const noexcept { return kl_fremd_; }  // Blöcke mit einer anderen Karte als setze_karte (T11)
  // Task 7 (K1): die Keylock-Fäden sind beendet (Kern::keylock_faeden_stoppen; nur ohne laufenden Callback): kein Dehner liest
  // mehr, die Leihe wird geleert, abholen() gibt alles heraus, die Boxen spielen ohne Dehner weiter.
  void keylock_getrennt() noexcept;

 private:
  bool keylock_ = true;
  struct Box {
    const Loop* loop = nullptr;
    int64_t versatz = 0;  // Plan Grid
    BoxStatus status = BoxStatus::leer;
    double start_beat = 0.0, stopp_beat = 0.0;
    int64_t start_sample = 0;  // nur für den Fehlerfall der Abnahme (CYPHERDJ_MUTATION_LOOP_AB_START)
    // pfad = Quelle des letzten Blocks (der Loop), blende_alt = abgelöster Loop, der noch ausblendet (F13, nullptr: keine
    // Blende), blende_pos = schon geblendete Frames (0 bis LOOPBOX_LADEN_BLENDE).
    const Loop* pfad = nullptr;
    const Loop* blende_alt = nullptr;
    int blende_pos = 0;
    // F15: Hülle (blende.h), ruhend offen = keine Rechnung. aus_ab: erstes Sample der Stopp-Rampe (−1: noch keins),
    // aus_laeuft: die Stopp-Rampe ist gestartet (eine Rücknahme blendet dann vom Ist-Wert wieder auf).
    Blende huelle;
    int64_t aus_ab = -1;
    int64_t aus_ende = -1;  // Prüfung 2.3 Befund 5: Sample, an dem die Ausblende 0 erreicht (Stoppsample oder kurz danach)
    bool aus_laeuft = false;
    float schwanz_l[LOOPBOX_AUS] = {}, schwanz_r[LOOPBOX_AUS] = {};  // F15: Ausklang nach /k/set/neu
    int schwanz_rest = 0, schwanz_pos = 0;
    // F13: Laden in eine klingende Box. wartend übernimmt in block(); der bisherige Pfad klingt über LOOPBOX_LADEN_BLENDE aus
    // (blende_versatz: sein Versatz in Frames bei 128 BPM, blende_leistung: gleich laut statt linear).
    const Loop* wartend = nullptr;
    bool wartend_cypher = false;             // F13 x §4.7: von cypher geladen, der KI-Stopp verwirft ihn
    bool ring_vor = false;                   // Keylock 7b.2: der Ring klingt schon vor dem Einsatz (BOX_VORLAGE)
    bool vor_aus = false;                    // Keylock 7c.2: ein Ereignis in der Vorlage, der eingefrorene Ring blendet aus
    int64_t blende_versatz = 0;
    bool blende_leistung = false;
  };
  static bool gueltig(int box) { return box >= 1 && box <= LOOP_BOXEN; }
  static double naechste_eins(double beat0) { return std::ceil(beat0 / 4.0 - 1e-9) * 4.0; }
  static void spiele(const Box& b, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l, float* r);
  // Lesekopf mit gebrochenem Schritt über lp; versatz in Frames von lp
  static void spiele_frei(const Loop& lp, double versatz, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l,
                          float* r);
  static void spiele_pfad(const Box& b, const Loop* q, bool direkt, int64_t versatz, const Karte& k, int64_t von,
                          int64_t bis, int64_t n0, float* l, float* r);
  void uebernehmen(Box& b, bool blenden);  // F13: wartender Loop übernimmt
  void gib_frei(Box& b, const Loop* q);   // q loswerden, wenn die Box es nicht mehr braucht (Ring)
  void pfad_verwerfen(Box& b);            // laufender Pfad und Blende vergessen (Box steht oder Loop getauscht)
  void schwanz_mischen(Box& b, int n, float* l, float* r);  // F15
  static_assert(LOOPBOX_AUS <= MIX_BLOCK, "ausklingen() rechnet den Schwanz in alt_l_/alt_r_");
  // Task 7 (7a 3.3, E-m9): verliehene Loops warten im Ring auf die Quittung, höchstens 4 Plätze je Box (8) plus die in
  // einem Aufruf eingereihten (je Box alt und ein verdrängter wartender, 4): Spitze 12.
  static constexpr int FREI_MAX = 16;
  Box b_[LOOP_BOXEN];
  float tmp_l_[MIX_BLOCK] = {}, tmp_r_[MIX_BLOCK] = {};
  float alt_l_[MIX_BLOCK] = {}, alt_r_[MIX_BLOCK] = {};  // F13: abgelöster Loop während der Ladeblende (vorab, kein Malloc)
  const Loop* frei_[FREI_MAX] = {};
  int frei_n_ = 0, frei_verloren_ = 0;
  Mitschnitt* mitschnitt_ = nullptr;  // MVP 2 Scheibe 2: höchstens einer zur Zeit, Besitz bleibt beim Aufrufer
  // ---- Keylock Task 7
  struct Kl {
    DehnerBasis* d = nullptr;
    StreckPost* post = nullptr;
    StreckLeser les;
    StreckLeihe<BoxBand, BOX_KEYLOCK_BAENDER> leihe;
    BoxBand* band = nullptr;  // Band des laufenden Ansatzes (Platz in der Leihe)
    bool offen = false;       // Ansatz am nächsten Blockanfang (Dehner spät angehängt)
    uint64_t kein_platz = 0;
    bool halten = false;  // Keylock 7c.4 (a): Knopf aus auf der Basis bei hörbarem Ring, der Ring klingt weiter
  };
  Kl kl_[LOOP_BOXEN];
  const Karte* kl_k_ = nullptr;
  const uint32_t* kl_gen_ = nullptr;
  bool kl_an_ = true;  // Schalter für den Ring (folgt keylock_)
  uint64_t kl_fremd_ = 0;
  bool kl_bereit(int i) const noexcept { return kl_[i].d && kl_[i].post && kl_k_; }
  void kl_ereignis(int i, int64_t s) noexcept;              // nach Status: Ansatz (wartet: mit Vorlauf) oder Leer-Epoche
  void kl_ansetzen(int i, int64_t s, bool vorlauf) noexcept;
  void kl_leer(int i, int64_t s) noexcept;
  bool kl_einfrieren(int i, int64_t s, bool leistung) noexcept;
  void kl_vorlage_aus(int i, int64_t s) noexcept;  // Keylock 7c.2: Ereignis in der Vorlage, Ring blendet aus statt stumm
  bool verliehen(const Loop* q) const noexcept;
  const Loop* heraus(int i, const Loop* q);  // R-B1: Rückgabewert oder (verliehen) über den Freigabe-Ring
};

}  // namespace cdj
