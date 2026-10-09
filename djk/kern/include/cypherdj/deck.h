// Ein Deck im Direktweg (SCHNITTSTELLEN.md §4.4, §5.5, §13.1; ADR 007, ADR 020 Entscheidung 1): liest das
// eingeblendete Material am Soll-Lesekopf ohne Stretcher. Mit Stems klingt deren Summe (Reihenfolge STEM_NAMEN, je
// Stem mit seinem Pegel stem/*), sonst die Basis-Datei. Scheibe 31; Loop, Roll, Sprung, Hotcue kommen mit 38.
// Echtzeitfest: keine Allokation, keine Sperre, kein Systemaufruf.
//
// Keylock (Plan 2026-10-06-keylock-echtzeit.md, Task 2): mit einem Dehner (setze_keylock) spielt das Deck außerhalb der
// Basis den Ring des Dehners statt des Varispeed-Wegs. Jedes Ereignis (Start, Sprung, Hotcue, Laden, Tausch, Raster, Loop,
// Neustart, Keylock an) gibt über die StreckPost einen Ansatz mit Ziel-Sample s_h = s + ANSATZ_FRIST auf; bis s_h klingt
// der Varispeed-Weg (Brücke, Vertrag 6), bei s_h blendet ein zweiter Blendenplatz in 960 Frames auf den Ring. Klang der
// Ring beim Ereignis, blenden die nächsten bis zu 960 Frames der alten Epoche aus dem Ring aus (Vertrag 8). Auf der Basis
// ist der Direktweg hörbar (bitgleich), der Ring wird weiter gelesen und verworfen (warm, Vertrag 1 und 7). Ein stehendes
// Deck bekommt die Leer-Epoche (Vertrag 18). Material, aus dem der Dehner lesen kann, gibt rueckgabe() erst zurück, wenn
// der Arbeits-Thread eine Epoche quittiert hat, die es nicht mehr benutzt (Vertrag 4, StreckLeihe). Loop auf dem Deck im
// Keylock (Task 5): das Band trägt den Loop und wickelt selbst (DeckBand::band), Loop an und aus sind Ereignisse.
#pragma once

#include <atomic>
#include <cmath>
#include <cstdint>

#include "cypherdj/blende.h"
#include "cypherdj/dehner.h"
#include "cypherdj/lader.h"
#include "cypherdj/streck_quelle.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int DECK_BLENDE = 128;       // §4.4: 128-Frame-Blende beim Start auf laufendem Deck
constexpr int DECK_STOPP_RAMPE = 480;  // §4.4: Stopp mit 10-ms-Rampe
constexpr int DECK_START_EIN = 48;     // F10 (Audit 2026-10-01): Einblende beim Start aus dem Stand, 1 ms. Gehört 2026-10-06 (O1), Andreas: „passt alles“
static_assert(DECK_START_EIN > 0, "F10: 0 heißt Fund verworfen, nicht Festschreiben (Plan Welle 2, Task 2.3.8)");
constexpr int DECKS = 4;
constexpr int DECK_TAUSCH_BLENDE = 960;  // Welle 3 (§4.4 basis_tausch): 20-ms-Blende beim Fassungstausch
// Keylock: die Konstanten des Lesers (streck_quelle.h, Herkunft dort), hier unter den Namen des Decks
constexpr int DECK_KEYLOCK_BLENDE = STRECK_BLENDE;
constexpr int DECK_KEYLOCK_EINSCHWING = STRECK_EINSCHWING;
constexpr int DECK_KEYLOCK_BAENDER = 8;   // Plätze der StreckLeihe je Deck (Material in Gebrauch beim Dehner)
constexpr int DECK_KEYLOCK_VERPASST = STRECK_VERPASST;
constexpr int DECK_MAX_BLOCK = STRECK_MAX_BLOCK;  // größter Block (MIX_BLOCK)
// Keylock 6a (Plan Task 6, Detailschnitt 3.8): Start aus dem Stand, geplant. Vorlage wie BOX_VORLAGE (loopbox.h, 7b.2): der
// Ring klingt so viele Samples vor dem Einsatz s_t (das Band liefert davor Stille), s_h = s_t − STRECK_EINSCHWING − DECK_VORLAGE.
// Startwert = BOX_VORLAGE (am Klick der Box gemessen, 60 BPM Einsatz bei E − 492). Am Deck gemessen nur 60 bis 132 BPM (Basis
// 128, test_deck_geplant P4a/P4b/P4d); darunter schneidet E − 768 rohes R3 an (Prüfung 6a F4: 52 BPM 0,0087, 40 BPM 0,0129 bei
// Sinus 0,5), darum plant 6a erst ab DECK_START_F_MIN.
constexpr int DECK_VORLAGE = 768;
// Fix-Runde 1 F4: kleinster Faktor (Master-BPM / Basis am Einsatz) für einen geplanten Start; darunter der heutige Weg (Brücke).
// 60/128 = 0,46875, das langsamste gemessene Tempo.
constexpr double DECK_START_F_MIN = 60.0 / 128.0;
// Voller Vorlauf vom Planen (Blockanfang n0) bis s_t: s_h = s_t − 1408 − 768 liegt mindestens ANSATZ_FRIST hinter n0, der Ring
// klingt die ganze Vorlage; nur dann Start aus Stille (Fix-Runde 2 F3-R1, Entscheid der Hauptinstanz). Bei Vorlauf V in
// (ANSATZ_FRIST, DECK_START_VORLAUF): früher Ansatz ohne still, s_h = n0 + ANSATZ_FRIST; das Deck setzt im Varispeed ein, die Brücke
// ist kürzer (max(0, 5504 − V) + 960 statt 6464 Samples). Die Box setzt dort still mit verkürzter Vorlage (loopbox.cpp:425), am Deck
// gab das harte Kanten (80 BPM Klick 0,4889). Bei V ≤ ANSATZ_FRIST trüge auch der frühe Ansatz nicht vor s_t: heutiger Weg.
constexpr int DECK_START_VORLAUF = ANSATZ_FRIST + STRECK_EINSCHWING + DECK_VORLAGE;
// Fix-Runde 1 Q2: fällt ein geplanter Start, während der Ring in der Vorlage klingt, blendet er über so viele Frames aus (2,7 ms,
// = STRECK_ALT_MIN). Die 960er Ausblende trug den Einsatz des abgebrochenen Starts (60 BPM: 65 % bzw. 91 % der Eins); s_t − s
// reicht nicht, weil der Einsatz im Ring bei langsamem Tempo schon vor s_t liegt (60 BPM Klickmitte bei E − 326). Fix-Runde 2 Q2-R1,
// Restzone (wie Plan 3.7 Zone 3, Preis): ein Abbruch weniger als rund 200 Samples vor dem Einsatz trifft Signal, das schon im Ring liegt;
// die 128er Ausblende trägt es (gemessen 09.10., test_deck_geplant restzone: 100 BPM E − 1 99 %, E − 127 19 % der Eins; 132 BPM
// E − 1 48 %; ab E − 200 höchstens 0,01). Knopf aus in der Vorlage nimmt dieselbe Ausblende (Fix-Runde 2 Doppel-1).
constexpr int DECK_VORLAGE_AUS = 128;
// Keylock 6b (Plan Task 6, 3.3, Entscheidung „Blende 128 vor dem Ziel“): das PlanBand blendet in [p_sw − 128, p_sw), das Neue
// steht ab dem Ziel voll (der Direktweg blendet NACH dem Ereignis und dämpft die Takt-Eins, Messung 3.3).
constexpr int PLAN_BLENDE_VOR = 128;
constexpr int DECK_PLAN_BLENDE_MAX = 1024;  // Puffer der Blende in DeckBand::band
// Am Ziel darf das angeforderte Frame um so viel vom geplanten abweichen (Rundung: s_t = round(sample_at(ab_beat)) liegt bis 0,5
// Samples neben dem Beat, das Frame bis 0,67 Frames; nach einer Rampe zwischen Planung und Ziel kann llround ein Frame anders liegen)
constexpr int64_t DECK_PLAN_TOL_F = 1;
#ifndef CYPHERDJ_MUTATION_KEYLOCK_EINSCHWING_768  // dieser Fehlerfall verkürzt STRECK_EINSCHWING
static_assert(DECK_START_VORLAUF == 6272, "Detailschnitt 6a 3.8: Mindestvorlauf 6272 Frames (130,7 ms)");
#endif

// Loop-Drift (Plan 2026-10-06 „Offen aus 5b“, Andreas 08.10.: „Ja, reparieren“): Naht j (j ≥ 0) eines Loops der exakten
// Länge lx = L_beats · fpb Frames liegt R(j) = round(j · lx) Frames hinter dem Loop-Anfang (ungewickelt gezählt); Durchlauf j
// ist R(j + 1) − R(j) Frames lang (floor oder ceil von lx). Der Rundungsfehler bleibt unter einem halben Frame statt sich je
// Durchlauf aufzusummieren (vorher feste Länge round(lx): Basis 125,3, 4 Beats −22,1 Frames nach 64 Durchläufen,
// test_deck_keylock Test 33). Ist lx ganzzahlig (Basis 128 ab 1/4 Beat), ist R(j) = j · lx wie vorher (bitgleich, Test 34).
inline int64_t loop_naht_r(double lx, int64_t j) noexcept {
#ifdef CYPHERDJ_MUTATION_LOOP_RUNDUNG_FEST
  return j * std::llround(lx);  // Fehlerfall (Stand vor dem Fix): jeder Durchlauf die gerundete Länge
#else
  return std::llround(static_cast<double>(j) * lx);
#endif
}

// Das Band eines Materials für den Dehner (DehnerQuelle, Vertrag 9): die Summe der Stems mit den Gewichten des Decks
// (Reihenfolge wie Deck::block, bitgleich zum Direktweg). Reine Lesefunktion, aus zwei Fäden zugleich, ohne Allokation;
// die Gewichte sind Atome, die das Deck je Block setzt (Stem-Griffe wirken im Keylock mit Ring und R3-Verzögerung später,
// Architektur 8). Material und Gewichte bleiben gültig, solange die StreckLeihe den Platz hält.
class DeckBand final : public DehnerQuelle {
 public:
  const Material* m = nullptr;
  const std::atomic<float>* g = nullptr;  // STEM_ANZAHL Gewichte (linear)
  int64_t loop_a = 0, loop_l = 0;          // Task 5: Loop [loop_a, loop_a + loop_l) in Frames, loop_l 0 = kein Loop
  double loop_lx = 0.0;                    // Loop-Drift: exakte Länge in Frames (L_beats · fpb), 0 = loop_l
  // Keylock 6a (Plan Task 6, Detailschnitt 3.8): Start aus dem Stand, geplant. Quellframes (ungewickelt) vor still_bis liefert
  // das Band als Stille: der Ring klingt vor dem Einsatz schon (DECK_VORLAGE), ohne das Material vor dem Startframe. Wie
  // BoxBand::still_bis (7c.3): der Callback schreibt atomar (relaxed), der Dehner liest je band(); ein Neuanker im wartenden
  // Deck zieht den Wert am selben Band nach, ohne neuen Platz der Leihe. INT64_MIN: nie still (jeder gewöhnliche Ansatz).
  std::atomic<int64_t> still_bis{INT64_MIN};
  // Keylock 6b (Plan Task 6, Detailschnitt 3.3, Bauart Q „Wechsel in der Quelle“): das PlanBand. Ein Band aus zwei Zuständen
  // über der UNGEWICKELTEN Bandposition p (der Quellposition des Dehners): p < p_sw − x das Material bei p + off mit dem Loop
  // (loop_a, loop_l, loop_lx); p >= p_sw das Material bei p + off_neu mit dem Loop nach dem Ereignis (loop2_*); dazwischen linear,
  // Gewicht des Neuen (p − (p_sw − x) + 1) / x (wie die Naht-Blende in deck_lies, Blende VOR dem Ziel, PLAN_BLENDE_VOR). Mit
  // p_sw = INT64_MAX und off = 0 ist es das gewöhnliche Band (bitgleich, test_deck_geplant band_bitgleich). Unveränderlich, solange
  // verliehen (der Dehner liest aus zwei Fäden); die Felder setzt das Deck nur auf einem frisch genommenen Platz.
  int64_t off = 0;               // Quellframe-Versatz des Zustands vor dem Wechsel
  int64_t p_sw = INT64_MAX;      // Bandposition des Ziels (aus dem Beat, Plan 3.1); INT64_MAX: kein Wechsel
  int64_t off_neu = 0;           // Versatz ab p_sw: off_neu = f_neu − p_sw
  int x = 0;                     // Blende [p_sw − x, p_sw), höchstens DECK_PLAN_BLENDE_MAX
  int64_t loop2_a = 0, loop2_l = 0;  // Loop ab p_sw (loop2_l 0: keiner)
  double loop2_lx = 0.0;
  bool plan() const noexcept { return p_sw != INT64_MAX || off != 0; }
#ifdef CYPHERDJ_PRUEF_GEN
  // Prüfbau (Plan 3.6): Generation des Platzes der StreckLeihe. 0: kein Platz einer Leihe (nicht geprüft); ungerade: verliehen;
  // gerade > 0: frei. band() zählt deck_band_gen_verletzt(), wenn es auf einem freien Platz liest. Kopien tragen sie nicht.
  std::atomic<uint32_t> pruef_gen{0};
#endif
  DeckBand() = default;
  DeckBand(const DeckBand& o) noexcept
      : m(o.m), g(o.g), loop_a(o.loop_a), loop_l(o.loop_l), loop_lx(o.loop_lx),
        still_bis(o.still_bis.load(std::memory_order_relaxed)), off(o.off), p_sw(o.p_sw), off_neu(o.off_neu), x(o.x),
        loop2_a(o.loop2_a), loop2_l(o.loop2_l), loop2_lx(o.loop2_lx) {}
  DeckBand& operator=(const DeckBand& o) noexcept {
    m = o.m;
    g = o.g;
    loop_a = o.loop_a;
    loop_l = o.loop_l;
    loop_lx = o.loop_lx;
    still_bis.store(o.still_bis.load(std::memory_order_relaxed), std::memory_order_relaxed);
    off = o.off;
    p_sw = o.p_sw;
    off_neu = o.off_neu;
    x = o.x;
    loop2_a = o.loop2_a;
    loop2_l = o.loop2_l;
    loop2_lx = o.loop2_lx;
    return *this;
  }
  double loop_lx_wirk() const noexcept { return loop_lx > 0.0 ? loop_lx : static_cast<double>(loop_l); }
  void band(int64_t ab, int n, float* l, float* r) const noexcept override;
  double basis_bpm() const noexcept override { return m ? m->basis_bpm : 128.0; }
};
// Keylock 6a-1 (Plan Task 6, 3.3): der Strom eines Materials mit Loop, wie ihn DeckBand::band bis 6a lieferte, als freie
// Funktion (6b setzt das Band aus zwei Zuständen zusammen). Liest die UNGEWICKELTEN Quellframes [ab + off, ab + off + n) mit den
// Gewichten gw (STEM_ANZAHL, linear), wickelt mit Loop [loop_a, loop_a + loop_l) und exakter Länge lx (0: loop_l) wie Deck::block.
void deck_lies(const Material* m, const float* gw, int64_t off, int64_t loop_a, int64_t loop_l, double lx, int64_t ab, int n,
               float* l, float* r) noexcept;
#ifdef CYPHERDJ_PRUEF_GEN
uint64_t deck_band_gen_verletzt() noexcept;  // Prüfbau: Lesungen auf freien Plätzen (alle Decks, alle Fäden)
#endif

class Deck {
 public:
  // Material übernehmen (am Blockanfang s): Status geladen, Position Quell-Beat 0. Klingt das Deck, blendet das
  // bisherige Material über 128 Frames aus; danach liefert rueckgabe() es genau einmal (Freigabe erst nach Rückgabe).
  void lade(const Material* m, int64_t s) noexcept;
  void entlade(int64_t s) noexcept;
  const Material* rueckgabe() noexcept;
  const Material* material() const noexcept { return m_; }
  // Ab Sample s erklingt Frame f. Läuft das Deck (auch in der Stopp-Rampe), blendet es 128 Frames vom alten Lesekopf.
  // loop_halten (Plan E9, Review F2): Play der Hand nach einer Pause behält den Loop (Traktor, Spec „läuft bis Loop
  // aus“); /k/deck/start und CUE beenden ihn (Attrappe).
  // plan (Keylock 6a): Schlüssel der Aktion (seq im Kern), 0 = ohne. Ist zu ihm ein Start geplant (kl_plane_start) und trägt
  // der Plan noch, setzt das Deck ohne neuen Ansatz ein (der Ring ist schon eingeschwungen, keine Brücke).
  // plan_b (Keylock 6b): Ziel-Beat der Aktion; mit plan die Identität eines geplanten Ereignisses auf laufendem Deck (kl_plane).
  void start(int64_t s, int64_t f, bool loop_halten = false, uint64_t plan = 0, double plan_b = NAN) noexcept;
  // Ab Sample s die 10-ms-Rampe; der Lesekopf läuft in ihr weiter. Rückgabe: Sample, ab dem das Deck steht.
  int64_t stopp(int64_t s, bool loop_halten = false) noexcept;
  // Neustart (§6.3): Zustand ohne Blende setzen.
  void setze_lauf(int64_t anker_s, int64_t anker_f) noexcept;
  // Welle 3 (ADR 028): Karte der Kern-Uhr (lebt im Tempoplan des Kerns, Adresse fest). Mit Karte folgt der Lesekopf dem
  // Beat: kopf(s) = anker_f + (beat_at(s) − anker_b) · fpb, ein Quell-Beat bleibt ein Master-Beat (Varispeed,
  // phasenstarr). Steht das Tempo über den ganzen Block auf der Basis, liest das Deck ganzzahlig wie bis Welle 2
  // (bitgleich). Ohne Karte immer der Direktweg.
  // generation: Zähler der Karte (Tempoplan, Vertrag 10), für den Keylock; nullptr: 0.
  void setze_karte(const Karte* k, const uint32_t* generation = nullptr) noexcept {
    k_ = k;
    gen_ = generation;
    kl_les_.verbinde(kl_, kl_post_, k_, gen_);
  }
  // Neustart mit Anker in Beats (kern_deck_zustand.cpp): Master-Beat anker_b bei Sample anker_s, Frame anker_f.
  void setze_lauf_beat(int64_t anker_s, double anker_b, int64_t anker_f) noexcept;
  double kopf_bei(int64_t s) const noexcept;  // gebrochener Lesekopf (läuft) bzw. Position (steht)
  // Welle 3 (§4.4 /k/deck/basis_tausch, §13.1): ab Sample s klingt die Fassung neu (dasselbe Material, andere Basis) am
  // selben Quell-Beat; der alte Kopf blendet DECK_TAUSCH_BLENDE Frames mit seinem eigenen Schritt aus. Ein Loop wird in
  // die Frames der neuen Fassung umgerechnet, das Raster der alten (Versatz) gilt nicht weiter. Das alte Material geht
  // nach der Blende über rueckgabe() zurück.
  void tausche(int64_t s, const Material* neu) noexcept;
  double anker_b() const noexcept { return anker_b_; }
  bool direkt() const noexcept { return direkt_; }
  void setze_position(int64_t f) noexcept;
  // Plan E9 (§4.4 /k/deck/sprung): um delta Frames ab Sample s. Läuft das Deck, blendet es 128 Frames vom alten Lesekopf
  // (wie start); ein aktiver Loop wandert mit. Steht es, verschiebt sich die Position, begrenzt auf [0, frames].
  void springe(int64_t s, int64_t delta_f, uint64_t plan = 0, double plan_b = NAN) noexcept;  // plan, plan_b: wie start
  // Plan E9 (Hotcue): Lesekopf ab s auf Frame f (läuft: mit Blende, Stopp-Rampe bleibt) bzw. Position (steht).
  void setze_kopf(int64_t s, int64_t f, uint64_t plan = 0, double plan_b = NAN) noexcept;
  // Plan E9 (§4.4 /k/deck/loop): Loop [a_f, a_f + laenge_f); an der Naht zurück mit 128-Frame-Blende. Laden, Start und
  // Stopp löschen ihn (Attrappe). Im Loop gibt es kein Materialende (beats_bis_ende unendlich, wie die Attrappe).
  // Keylock: ab Sample s ein Ereignis (Ansatz mit dem Band des Loops, Brücke; Task 5).
  // Loop-Drift: laenge_exakt = L_beats · fpb (gebrochen); die Nähte liegen bei round(j · laenge_exakt) (loop_naht_r).
  // 0: laenge_f ist exakt (ganzzahlige Länge wie bis Task 5b).
  void loop_an(int64_t s, int64_t a_f, int64_t laenge_f, double laenge_exakt = 0.0, uint64_t plan = 0, double plan_b = NAN) noexcept;
  void loop_aus(int64_t s) noexcept;
  bool loop_aktiv() const noexcept { return loop_l_ > 0; }
  int64_t loop_anfang() const noexcept { return loop_a_; }   // Audit F09: Prüfung vor Sprung und Loop
  int64_t loop_laenge() const noexcept { return loop_l_; }
  // Loop-Drift: längster Durchlauf (ceil der exakten Länge); [loop_anfang, loop_anfang + loop_laenge_max) muss im Material liegen
  int64_t loop_laenge_max() const noexcept { return loop_l_ > 0 ? static_cast<int64_t>(std::ceil(loop_lx_)) : 0; }
  int64_t loop_durchlauf() const noexcept { return loop_j_; }  // Diagnose: Nummer des laufenden Durchlaufs (ab loop_an 0)
  // Stem-Pegel in dB (§1.5 stem/*, stumm ≤ −120): konstant, oder je Sample im nächsten Block ab Index vl_off.
  void stem_db(int stem, float db) noexcept;
  void stem_verlauf(int stem, const float* db) noexcept;
  void verlauf_ende(int m) noexcept;  // letzter Wert (Index m − 1) gilt weiter, Verläufe gelöst
  // Rendert [s, s + n) und addiert auf l und r; vl_off ist der Index des Samples s in den Stem-Verläufen.
  void block(int64_t s, int n, float* l, float* r, int vl_off) noexcept;

  // ---- Keylock (Task 2). Vor dem Start und nicht im Callback: Dehner und Post der Quelle (nullptr: ohne Keylock, das
  // Deck spielt Varispeed wie Welle 3). Beide müssen das Deck überleben bzw. vor ihm ihre Fäden anhalten.
  void setze_keylock(DehnerBasis* d, StreckPost* post) noexcept;
  // Interner Schalter ab Sample s (Task 3 hängt den Regler keylock daran). Aus: Varispeed; klang der Ring, blendet er aus.
  void keylock(int64_t s, bool an) noexcept;
  bool keylock_an() const noexcept { return kl_ && kl_an_; }
  bool keylock_ring_hoerbar() const noexcept { return kl_les_.ring_hoerbar(); }
  bool keylock_blendet() const noexcept { return kl_les_.blendet(); }
  bool keylock_ring_beteiligt() const noexcept { return kl_les_.ring_beteiligt(); }  // Ring hörbar oder in der Blende
  const StreckLeser& keylock_leser() const noexcept { return kl_les_; }              // Diagnose
  int64_t keylock_s_h() const noexcept { return kl_les_.s_h(); }          // Ziel-Sample des laufenden Ansatzes (INT64_MAX: keiner)
  uint32_t keylock_anfrage() const noexcept { return kl_les_.anfrage(); }  // Nummer des letzten Auftrags an die Post
  uint32_t keylock_epoche() const noexcept { return kl_les_.epoche(); }    // Epoche des Auftrags, sobald bekannt
  const DehnerAnker& keylock_anker() const noexcept { return kl_les_.anker(); }
  uint64_t keylock_unterlauf() const noexcept { return kl_les_.unterlauf_n(); }    // Vertrag 2
  uint64_t keylock_hart() const noexcept { return kl_les_.hart_n(); }              // Rückfall ohne Blende
  uint64_t keylock_verpasst() const noexcept { return kl_les_.verpasst_n(); }      // Vertrag 5: s_h gewandert
  uint64_t keylock_aufgegeben() const noexcept { return kl_les_.aufgegeben_n(); }  // Vertrag 5: nach 8 Mal
  uint64_t keylock_gelesen() const noexcept { return kl_les_.gelesen(); }          // Frames aus dem Ring (auch verworfen: warm)
  // §5.5 /zustand/deck: hoerweg 1, solange der Ring am Hörbaren beteiligt ist; stretcher_fuell = Frames im Ring / 256,
  // −1 ohne Keylock (Dehner fehlt, Schalter aus oder Leer-Epoche)
  int keylock_hoerweg() const noexcept { return kl_bereit() && kl_les_.ring_beteiligt() ? 1 : 0; }
  int keylock_vorlauf_bloecke() const noexcept {
    if (!kl_bereit() || !kl_an_ || kl_les_.ist_leer()) return -1;
    return static_cast<int>(kl_->ring().frames_belegt() / DEHNER_BLOCK);
  }
  // Vertrag 4 (Prüfung m4): hat die Rückgabeliste Platz für einen Materialwechsel (Laden, Tausch, Entladen)? Ist sie voll,
  // wartet der Wechsel, bis der Dehner quittiert hat (der Kern fragt vorher). voll_verloren: trotzdem nicht aufgenommen.
#ifdef CYPHERDJ_MUTATION_KEYLOCK_RUECK_OHNE_WARTEN
  bool rueck_frei() const noexcept { return true; }  // Fehlerfall (Stand Task 2): nie warten, volle Liste lässt liegen
#else
  bool rueck_frei() const noexcept { return n_rueck_ + 2 <= RUECK; }
#endif
  uint64_t rueck_voll_verloren() const noexcept { return rueck_verloren_; }
  uint64_t keylock_kein_platz() const noexcept { return kl_kein_platz_; }  // Leihe voll: Ansatz als Leer-Epoche
  int keylock_verliehen() const noexcept { return kl_leihe_.belegt(); }    // Bänder, die der Dehner noch lesen kann
  const StreckLeihe<DeckBand, DECK_KEYLOCK_BAENDER>& keylock_leihe() const noexcept { return kl_leihe_; }  // Diagnose

  // ---- Keylock 6a (Plan Task 6, Detailschnitt 3.8): Start aus dem Stand, geplant. Am Blockanfang n0 (vor block): ein
  // stehendes Deck ohne Loop im Keylock außerhalb der Basis soll bei Sample s_t Frame f spielen (Master-Beat b_t), Schlüssel
  // der Aktion. Liegt s_t mindestens DECK_START_VORLAUF hinter n0, setzt der Leser mit Vorlauf an (ansetzen_ab, s_h =
  // s_t − STRECK_EINSCHWING − DECK_VORLAGE, Anker {b_t, f}, Band mit still_bis = f) und startet aus Stille: das Deck mischt den
  // Ring ab s_t − DECK_VORLAGE. Je Block erneut aufrufen: derselbe Plan bleibt, ein anderer Anker (Raster, Neuanker) setzt mit
  // demselben Band neu an (7c.3). true: der Plan steht. Sonst (zu kurz, Basis, Loop, kein Keylock) fällt ein alter Plan.
  bool kl_plane_start(int64_t n0, int64_t s_t, double b_t, int64_t f, uint64_t schluessel) noexcept;
  // Die geplante Aktion fällt (Abbruch, KI-Stopp, zu spät): klingt der Ring schon in der Vorlage, blendet er gegen Stille aus
  // (7c.2), dann Leer-Epoche.
  void kl_plan_verwerfen(int64_t s) noexcept;
  bool keylock_plan_aktiv() const noexcept { return kl_plan_.aktiv; }
  uint64_t keylock_plan_schluessel() const noexcept { return kl_plan_.aktiv ? kl_plan_.schluessel : 0; }
  bool keylock_vorlage() const noexcept { return kl_vor_; }  // der Ring klingt schon vor dem Einsatz
  uint64_t keylock_geplant_ok() const noexcept { return kl_geplant_ok_; }          // Starts ohne neuen Ansatz
  uint64_t keylock_geplant_verworfen() const noexcept { return kl_geplant_verw_; }  // Pläne, die nicht trugen oder fielen
  uint64_t keylock_geplant_zu_kurz() const noexcept { return kl_geplant_kurz_; }    // Vorlauf ≤ ANSATZ_FRIST (kein Plan)
  uint64_t keylock_geplant_ohne_still() const noexcept { return kl_geplant_frueh_; }  // getragene Starts mit frühem Ansatz (F3)

  // ---- Keylock 6b (Plan Task 6, Detailschnitt 3.4, 3.6, 3.7; Bauart Q „Wechsel in der Quelle“): geplantes Ereignis auf dem
  // LAUFENDEN Deck im Ring (6b-1: ohne Loop davor; Sprung, Hotcue, Start, Loop an). Am Blockanfang n0: ist der Ring stabil (hörbar,
  // keine Blende, Epoche quittiert) und das Ziel außerhalb der Basis, nimmt das Deck einen Leihplatz für das PlanBand (alter Zustand
  // aus dem Band der Epoche, ab p_sw = Bandposition des Ziel-Beats der neue, Blende PLAN_BLENDE_VOR davor) und stellt dem Dehner den
  // Wechsel. Am Ziel (start, springe, setze_kopf, loop_an mit plan = id und plan_b = ab_beat): trägt der Plan, setzt das Deck nur den
  // Zustand (kein Einfrieren, kein Ansatz, keine Brücke), der Leser übernimmt das PlanBand. Ein Plan je Deck; je Block erneut
  // aufrufen (derselbe Plan bleibt, s_t folgt der Karte). Den Vorlauf (PLAN_VORLAUF(f)) prüft der Aufrufer (Kern, Step 7).
  enum KlArt : int { KL_START = 1, KL_LOOP_AN = 5, KL_SPRUNG = 6, KL_HOTCUE = 7 };  // wie DeckAktion::art
  struct KlAktion {
    uint64_t id = 0;        // Schlüssel der Aktion (seq im Kern), nie 0
    int art = KL_SPRUNG;
    double ab_beat = 0.0;   // Ziel-Beat: p_sw hängt am Beat, nicht am Sample (3.1)
    int64_t s_t = 0;        // Ziel-Sample nach der Karte bei der Planung
    int64_t f_neu = 0;      // Frame unmittelbar nach dem Ereignis (Sprung, Hotcue, Start); Loop an: unbenutzt
    int64_t loop_a = 0, loop_l = 0;  // Loop nach dem Ereignis (nur Loop an)
    double loop_lx = 0.0;
  };
  bool kl_plane(int64_t n0, const KlAktion& a) noexcept;  // true: der Plan steht (neu oder derselbe)
  bool keylock_wplan_aktiv() const noexcept { return kl_wplan_.aktiv; }
  uint64_t keylock_wplan_id() const noexcept { return kl_wplan_.aktiv ? kl_wplan_.id : 0; }
  uint32_t keylock_wplan_wnr() const noexcept { return kl_wplan_.wnr; }  // Nummer des letzten Wechsels auf ein PlanBand
  bool keylock_gegen_offen() const noexcept { return kl_gegen_.aktiv; }  // ein Gegenwechsel wartet auf die Entscheidung des Threads
  const DeckBand* keylock_band() const noexcept { return kl_band_; }   // Diagnose: Band der Epoche
  // Zähler 3.7: Abbruch nach der Planung. zurueck: Gegenwechsel angenommen (Zone 1/2, ohne Brücke); bruecke: Zone 3, der Sprung lag
  // im R3, neuer Ansatz (Brücke, der Preis von Q); gespielt: zu nah am Ziel, der Sprung klingt; frei: der Wechsel war nie
  // angenommen (verfehlt oder überschrieben), nichts rückgängig zu machen.
  uint64_t keylock_abbruch_zurueck() const noexcept { return kl_abbr_zurueck_; }
  uint64_t keylock_abbruch_bruecke() const noexcept { return kl_abbr_bruecke_; }
  uint64_t keylock_abbruch_gespielt() const noexcept { return kl_abbr_gespielt_; }
  uint64_t keylock_abbruch_frei() const noexcept { return kl_abbr_frei_; }
  // Fix-Runde W3 S1: ein Ereignis, das den angenommenen Plan nicht trägt, fror den Ring ein, obwohl im Eingefrorenen schon ein Stück des
  // geplanten Sprungs liegen kann (Entscheid der Hauptinstanz: Ausblende wie ohne Plan statt hartem Schnitt).
  uint64_t keylock_abbruch_ausblende() const noexcept { return kl_abbr_ausblende_; }
  uint64_t keylock_plan_abgelehnt() const noexcept { return kl_plan_abgelehnt_; }  // kl_plane ohne Plan (Ring nicht stabil usw.)
  // Diagnose: Ablehnungen je Prüfung in kl_plane (Index = Reihenfolge der Prüfungen in deck.cpp)
  uint64_t keylock_plan_grund(int i) const noexcept { return i >= 0 && i < 16 ? kl_plan_grund_[i] : 0; }
#ifdef CYPHERDJ_PRUEF_GEN
  uint64_t keylock_leser_gen_verletzt() const noexcept { return kl_les_gen_verletzt_; }  // Leser hält einen freigegebenen Platz
#endif

  bool laeuft() const noexcept { return laeuft_; }
  bool geladen() const noexcept { return m_ != nullptr; }
  int64_t frame_bei(int64_t s) const noexcept;       // Lesekopf (läuft) bzw. Position (steht)
  double quell_beat_bei(int64_t s) const noexcept;   // §5.5 quell_beat (hörbare Position)
  double beats_bis_ende_bei(int64_t s) const noexcept;  // §5.5, Faktor 1: Quell-Beats gleich Master-Beats
  int64_t anker_s() const noexcept { return anker_s_; }
  int64_t anker_f() const noexcept { return anker_f_; }
  int64_t position() const noexcept { return pos_f_; }
  // Plan Grid (§4.4 /k/deck/raster): Raster der Fassung auf diesem Deck, Takt-Eins-Linie auf erster_schlag_frame + v.
  // Alle Rechnungen Quell-Beat ↔ Frame laufen über schlag0(). Laden setzt v auf 0.
  int64_t schlag0() const noexcept { return m_ ? m_->erster_schlag_frame + raster_f_ : 0; }
  int64_t raster_versatz() const noexcept { return raster_f_; }
  // Neuer Versatz v ab s (absolut): der Quell-Beat unter dem Kopf bleibt, der Ton rückt um v − alt (wie springe, mit
  // Blende; ein Loop wandert mit).
  void setze_raster(int64_t s, int64_t v) noexcept;

 private:
  void zurueck(const Material* m) noexcept;
  void neu_anker(int64_t s, int64_t f, bool ereignis = true) noexcept;
  void naht(int64_t s, int64_t d) noexcept;  // Task 5b: Loop-Naht, Kopf um genau d Frames zurück
  void blende_von(const Material* alt, int64_t alt_f, float gain) noexcept;
  bool direkt_ueber(int64_t s, int n) const noexcept;  // Welle 3: ganzer Block auf der Basis
  const Material* m_ = nullptr;
  bool laeuft_ = false;
  int64_t anker_s_ = 0, anker_f_ = 0;  // läuft: Frame(s) = anker_f_ + (s − anker_s_)
  int64_t pos_f_ = 0;                  // steht: Position
  int64_t raster_f_ = 0;               // Plan Grid: Versatz des Rasters in Frames
  const Karte* k_ = nullptr;           // Welle 3: Karte der Kern-Uhr (nullptr: Direktweg)
  double anker_b_ = 0.0;               // Welle 3: Master-Beat bei anker_s_
  bool direkt_ = true;                 // Welle 3: der laufende Block liest ganzzahlig
  int stopp_rest_ = 0;
  int64_t loop_a_ = 0, loop_l_ = 0;    // Plan E9: Loop [loop_a_, loop_a_ + loop_l_), loop_l_ 0 = aus
  double loop_lx_ = 0.0;               // Loop-Drift: exakte Länge in Frames
  int64_t loop_j_ = 0;                 // Loop-Drift: laufender Durchlauf (Nähte bei loop_naht_r(loop_lx_, j))
  int64_t loop_lj_ = 0;                // Loop-Drift: Länge des laufenden Durchlaufs, R(j + 1) − R(j)
  void loop_durchlauf_setzen(int64_t j) noexcept {
    loop_j_ = j;
    loop_lj_ = loop_naht_r(loop_lx_, j + 1) - loop_naht_r(loop_lx_, j);
  }
  // Loop-Drift, Prüfung F1 (08.10.): ein neuer Kopf f (Start, Hotcue, Sprung) VOR dem Loop-Anfang hat den Loop noch nicht
  // betreten: Durchlauf 0. Sonst ordnete das Band den ungewickelten Anker f + R(j) dem Durchlauf j − 1 zu (eine Loop-Länge
  // voraus) bzw. mischte in [a0, A) einen fremden Kopf ein; das Deck spielt dort das Material bis zur ersten Naht. Ein Kopf
  // im Loop (f ≥ A) behält seinen Durchlauf (Band und Deck zählen dieselbe Naht). Test 35 loop_ansatz_band.
  void loop_kopf_gesetzt(int64_t f) noexcept {
#ifndef CYPHERDJ_MUTATION_LOOP_KOPF_OHNE_DURCHLAUF
    if (loop_l_ > 0 && f < loop_a_) loop_durchlauf_setzen(0);
#else
    (void)f;  // Fehlerfall (Stand 8ca44597): der Durchlauf bleibt, Test 35 rot
#endif
  }
  // Blende: alter Lesekopf (auch eines abgelösten Materials) klingt 128 Frames lang aus
  const Material* alt_m_ = nullptr;
  int64_t alt_f_ = 0;
  float alt_gain_ = 1.0f;
  int blende_rest_ = 0;
  int blende_len_ = DECK_BLENDE;  // Welle 3: Länge der laufenden Blende (128, beim Tausch 960)
  double alt_pos_ = 0.0;          // Welle 3: gebrochener alter Kopf, wenn er mit alt_schritt_ ≠ 1 weiterläuft
  double alt_schritt_ = 1.0;      // Welle 3: Frames je Sample des alten Kopfs (1: ganzzahlig wie bis Welle 2)
  Blende ein_;  // F10: Einblende des neuen Kopfs beim Start aus dem Stand (blende.h); ruhend offen, keine Rechnung
  static constexpr int RUECK = 8;  // Keylock: Rückgaben warten auf die Quittung des Dehners (Vertrag 4)
  const Material* rueck_[RUECK] = {};
  int n_rueck_ = 0;
  uint64_t rueck_verloren_ = 0;
  float stem_db_[STEM_ANZAHL] = {0.0f, 0.0f, 0.0f, 0.0f};
  float stem_lin_[STEM_ANZAHL] = {1.0f, 1.0f, 1.0f, 1.0f};
  const float* stem_vl_[STEM_ANZAHL] = {};

  // ---- Keylock (Task 2)
  enum class KlOffen : uint8_t { NICHTS, ANSATZ, LEER };  // am nächsten Blockanfang aufzugeben (Neustart, Position)
  bool kl_bereit() const noexcept { return kl_ && kl_post_ && k_; }
  bool kl_band_passt(const DeckBand* b) const noexcept;  // Material und Loop des Bandes gleich denen des Decks, kein PlanBand
  // 6b (3.6): die Zahl, mit der der zweite Freigabeweg der Leihe frei gibt: wechsel_bestaetigt() (Entscheid der Hauptinstanz)
  uint32_t kl_wechsel_frei_nr() const noexcept {
#ifdef CYPHERDJ_MUTATION_PLAN_LEIHE_FRUEH_FREI
    return kl_ ? kl_->wechsel_gelesen() : 0;  // Fehlerfall (Entwurf): frei mit der Annahme, ohne Bestätigung und ohne den Leser
#else
    return kl_ ? kl_->wechsel_bestaetigt() : 0;
#endif
  }
#ifdef CYPHERDJ_MUTATION_KEYLOCK_LOOP_LEER
  bool kl_loop_ok() const noexcept { return loop_l_ == 0; }  // Fehlerfall (Stand vor Task 5): im Loop die Leer-Epoche
#else
  bool kl_loop_ok() const noexcept { return true; }  // Task 5: auch im Loop klingt der Ring
#endif
  void kl_anfordern(int64_t s, bool mit_band) noexcept;
  void kl_ereignis(int64_t s) noexcept;  // nach einem Ereignis: Ansatz oder Leer-Epoche
  bool kl_einfrieren(int64_t s, int max_n = STRECK_BLENDE, bool sprung_grenze = false) noexcept;  // Vertrag 8, Prüfung M1: was klingt, blendet aus; true: nicht aus dem Material
  void vari_vorab(int64_t s, int n, float* l, float* r) const noexcept;  // Varispeed-Weg des jetzigen Kopfs, ohne Gain
  const uint32_t* gen_ = nullptr;
  DehnerBasis* kl_ = nullptr;
  StreckPost* kl_post_ = nullptr;
  StreckLeser kl_les_;
  bool kl_an_ = true;  // interner Schalter (Vorgabe an, wirkt nur mit Dehner)
  bool kl_halten_ = false;  // Keylock 7c.4 (a): Knopf aus auf der Basis bei hörbarem Ring, der Ring klingt weiter
  KlOffen kl_offen_ = KlOffen::NICHTS;
  DeckBand* kl_band_ = nullptr;  // Band des geladenen Materials (Platz in der Leihe)
  StreckLeihe<DeckBand, DECK_KEYLOCK_BAENDER> kl_leihe_;
  std::atomic<float> kl_g_[STEM_ANZAHL] = {1.0f, 1.0f, 1.0f, 1.0f};
  uint64_t kl_kein_platz_ = 0;
  // ---- Keylock 6a: geplanter Start aus dem Stand
  struct KlStartPlan {
    bool aktiv = false;
    uint64_t schluessel = 0;
    int64_t f = 0;     // Startframe
    double b = 0.0;    // Master-Beat des Einsatzes (Anker)
    int64_t s_t = 0;   // Einsatz-Sample (je Block nachgeführt, eine Rampe verschiebt es)
    uint32_t nr = 0;   // Auftrag des Lesers (ansetzen_ab); eine andere Anfrage macht den Plan ungültig
    bool still = true; // Start aus Stille (Vorlage); false: früher Ansatz ohne still (F3), das Deck setzt im Varispeed ein
  };
  KlStartPlan kl_plan_;
  bool kl_vor_ = false;  // der Ring klingt in der Vorlage [s_t − DECK_VORLAGE, s_t)
  uint64_t kl_geplant_ok_ = 0, kl_geplant_verw_ = 0, kl_geplant_kurz_ = 0, kl_geplant_frueh_ = 0;
  uint64_t kl_kurz_schluessel_ = 0;  // zuletzt als zu kurz gezählt (je Aktion einmal)
  bool kl_plan_traegt(int64_t f, uint64_t schluessel) const noexcept;
  void kl_plan_fallen(int64_t s) noexcept;   // Plan aus, Vorlage blendet aus; kein Auftrag
  void kl_vorlage_aus(int64_t s) noexcept;   // 7c.2: der Ring der Vorlage friert ein und blendet gegen Stille aus
  // ---- Keylock 6b: Wechselplan auf laufendem Deck
  struct KlWPlan {
    bool aktiv = false;
    bool selbst = false;     // 3.7 „gespielt“: der Sprung klingt ohnehin, das Deck führt ihn am Ziel selbst aus
    uint64_t id = 0;
    double ab_beat = 0.0;
    int art = 0;
    int64_t f_neu = 0, loop_a = 0, loop_l = 0;
    double loop_lx = 0.0;
    uint32_t wnr = 0, epoche = 0, anfrage = 0;  // Wechsel, Epoche und Anfrage des Lesers beim Planen
    DeckBand* neu = nullptr;                    // PlanBand
    int64_t p_sw = 0, p_gleich = 0;             // Bandposition des Ziels, ab p_gleich weicht das PlanBand ab
  };
  struct KlGegen {  // 3.7 Zone 1/2: Gegenwechsel gestellt, Entscheidung des Threads offen
    bool aktiv = false;
    uint32_t wnr1 = 0, wnr2 = 0, anfrage = 0;
    KlWPlan plan;  // der verworfene Plan (für „gespielt“ in Zone 3)
  };
  KlWPlan kl_wplan_;
  KlGegen kl_gegen_;
  struct KlFrei {  // 3.6 Punkt 3: Altband auf dem zweiten Weg; ändert sich die Anfrage vorher, gibt es der Epochenweg frei
    const DeckBand* b = nullptr;
    uint32_t anfrage = 0;
  };
  KlFrei kl_frei_[DECK_KEYLOCK_BAENDER];
  int kl_n_frei_ = 0;
  uint64_t kl_abbr_ausblende_ = 0;
  uint64_t kl_abbr_zurueck_ = 0, kl_abbr_bruecke_ = 0, kl_abbr_gespielt_ = 0, kl_abbr_frei_ = 0, kl_plan_abgelehnt_ = 0;
  uint64_t kl_plan_grund_[16] = {};
  uint64_t kl_wplan_fehl_id_ = 0;  // zuletzt vom Thread verfehlte Aktion (Schlüssel, Ziel-Beat): nicht noch einmal planen
  double kl_wplan_fehl_b_ = 0.0;
  bool kl_wplan_traegt(uint64_t id, double b, int64_t f, int64_t la, int64_t ll, double llx) const noexcept;
  void kl_wplan_zuende(int64_t s, int64_t f, bool kopf) noexcept;  // Ausführung am Ziel: Zustand (Kopf f, wenn kopf), Leser, Leihe
  void kl_wplan_verwerfen(int64_t s) noexcept;          // 3.7 Zonen
  void kl_wplan_pflege(int64_t s) noexcept;             // je Block nach dem Leser: Anfrage, verfehlt, Gegenwechsel, Ziel
  int64_t kl_wplan_s_t(const KlWPlan& p) const noexcept;  // Ziel-Sample nach der jetzigen Karte
  DeckBand* kl_nimm() noexcept;
  // Fix-Runde W3 S3: ein 6b-Plan, der nicht trug und nicht gespielt wurde, zählt einmal als verworfen, am Deck und am Leser
  void kl_verw6b() noexcept {
    ++kl_geplant_verw_;
    kl_les_.plan_verworfen();
  }  // Platz der Leihe; räumt veraltete Einträge in kl_frei_ für diesen Platz
  int kl_rein_bis(int64_t s) const noexcept;  // so viele Ring-Frames ab s enthalten den geplanten Sprung sicher nicht
#ifdef CYPHERDJ_PRUEF_GEN
  void kl_les_merke(const DeckBand* b) noexcept {
    kl_les_band_ = b;
    kl_les_gen_ = b ? b->pruef_gen.load(std::memory_order_relaxed) : 0;
  }
  const DeckBand* kl_les_band_ = nullptr;
  uint32_t kl_les_gen_ = 0;
  uint64_t kl_les_gen_verletzt_ = 0;
#else
  void kl_les_merke(const DeckBand*) noexcept {}
#endif
};

}  // namespace cdj
