// Der Dehner: Keylock in Echtzeit für eine Quelle (Plan 2026-10-06-keylock-echtzeit.md, Architektur 1 bis 5, Übergabe-
// Vertrag). Quellen-agnostisch (Andreas 07.10.: EIN globaler Keylock für alle Quellen, Decks, Loop-Boxen, REC): der Dehner
// kennt weder Deck noch Material; die Quelle liefert das Band über DehnerQuelle und den Anker über den Ansatz.
// Rubber Band R3 in der Zeit-Bauart (ADR 006, M4): das Band liest die Quelle am Anker, der Stretcher dehnt die Zeit,
// ein Phasenregler (M4 Regler, Verzögerungsmodell) hält die Lage an der Karte. Drei Fäden je Quelle:
//   Callback        liest den StreckRing (Epochen-Köpfe), veröffentlicht je Block Karte und Stand (Dreifachpuffer)
//   Arbeits-Thread  fuelle_synchron(): übernimmt den vorbereiteten Ansatz, rechnet R3, schreibt den Ring
//   Vorbereiter     ansetzen(), vorbereiter_schritt(): Reserve-Instanz vorbereiten (reset, Pad, Startverzögerung)
// Task 1 des Plans fährt den Thread synchron (derselbe Aufruf, den der Thread später macht), ohne JACK.
// Dieser Kopf ist frei von Rubber Band und vom Lader: alle Ziele ohne librubberband binden ihn, der Dehner selbst kommt
// über die Fabrik dehner_neu() aus dehner.cpp, oder nullptr aus stub/dehner_stub.cpp (Keylock dann immer aus).
#pragma once

#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "cypherdj/streck_ring.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int DEHNER_BLOCK = 256;                        // Frames je Ausgabe-Abschnitt (ein Callback-Block, M3/M4)
constexpr int DEHNER_REGEL_TAKT = 43 * DEHNER_BLOCK;     // Samples zwischen zwei Faktor-Setzungen (M4 E3: alle 43 Blöcke)
constexpr int DEHNER_VORLAUF_BL = 4;                     // Vorlauf des Rings in Blöcken (M3 r3_je1_v4)
constexpr int DEHNER_VORLAUF_FRAMES = DEHNER_VORLAUF_BL * DEHNER_BLOCK;
constexpr int ANSATZ_FRIST = 4096;                       // Samples vom Ansatz bis zum Ziel-Sample s_h (85 ms)
constexpr double DEHNER_D = 2400.0;                      // Verzögerungsmodell des Reglers, Samples (M4 E1)
constexpr double DEHNER_CMAX = 1e-4;                     // |c| <= 100 ppm (M4 E3)
constexpr double DEHNER_HORIZONT_BEATS = 1.0;            // Regler-Horizont (M4)
constexpr double DEHNER_E_TOTBAND = 1.0;               // Samples: darunter stellt der Regler nicht (c = 0), s. dehner.cpp
constexpr double DEHNER_EINS_ABSTAND = 1e-6;             // Faktor nie näher als 1e-6 an 1,0 (ADR 020, M4 eins_eps)

// DEHNER_VERSATZ: Korrektur des Bandstarts beim Ansetzen, in Samples (positiv: das Band klänge ohne sie zu spät). Der
// Dehner startet das Band um dehner_versatz(f0) · f0 Quellframes später und der Regler zielt auf soll + dehner_versatz(f0) · f0,
// fest je Ansatz.
//
// Seit Keylock 4.6 (08.10.2026) für die Decks 0, auf Andreas' Ja (08.10. ~08:45 CLI auf die Empfehlung „Tabelle für die
// Decks auf 0“: „ok ja“). Messung ~/messungen/2026-10-07-keylock-echtzeit/task-04/drums2/BERICHT.md: drei echte
// Drum-Loops (mfb, msgintro, boul) bei 96, 110, 132, 140, 150, 172 BPM, Lage der Transienten gegen den Varispeed-Bezug am
// Ziel; ohne Korrektur näher am Beat in 18 von 18 Fällen (Korrelation über 2 kHz; Hüllkurven-Einsatz 17 von 18), Bereich
// −40 … +3 statt −74 … +96 Samples, mittlerer Betrag 12,2 statt 45,0.
// Vorher (Task 1b, a20e826, bis c06b2b8 hier Zeilen 35 bis 80): Tabelle über den Faktor 0,75 bis 1,35 mit 18 Punkten,
// −95,0 Samples bei 96 BPM bis +37,4 bei 172,8 BPM, am Hann-Klick (144 Samples) eingemessen
// (~/messungen/2026-10-07-keylock-echtzeit/task-01-fix/f3_versatz_roh.txt, f3_versatz_korr.txt). Sie legte den Hann-Klick
// im Mittel auf den Beat und die Drums daneben (Befund Sägezahn im Plan: die absolute Lage hängt an der Klickform). Ohne
// Korrektur liegt der Hann-Klick dort, wo f3_versatz_roh.txt ihn misst (Mittel64: 96 BPM −96,2, 132 BPM +4,9, 172,8 BPM
// +40,6); die Tests weisen sein Mittel darum aus und prüfen je Klick gegen rohes R3 und das Ideal.
// Die Schnittstelle bleibt (Faktor -> Samples). Task 7 (Entscheidung der Hauptinstanz 08.10. aus „ein keylock für alle
// quellen“): 0 auch für die Loop-Boxen, kein Versatz je Quelle. Die Erweiterung der Tabelle auf 60 bis 200 BPM am Hann-Klick
// (Task 7 Step 2, Commit be35418) ist damit verworfen; ihre Messungen liegen in ~/messungen/2026-10-07-keylock-echtzeit/
// task-07/step2_*.
constexpr double DEHNER_VERSATZ_DECK = 0.0;
inline double dehner_versatz(double /*faktor*/) { return DEHNER_VERSATZ_DECK; }

// Gehörte Quellposition des Reglers (dehner.cpp P_), Task 5b (Prüfung MINOR): im Loop läuft eine Epoche beliebig lange und P
// wächst ungewickelt. Je Sample in einem double summiert driftet ein nicht dyadischer Faktor (Basis 125,3, Tempo 128:
// −7,1 Frames nach 4 h, Probe task-05-pruefung/qualitaet/probe_p/p_akku.txt). Darum: ganze Frames als Ganzzahl, der
// Bruchteil getrennt; je Abschnitt wird die Abschnittssumme (rund 256, im double fast exakt) aufgeschlagen.
struct DehnerSumme {
  int64_t ganz = 0;
  double rest = 0.0;  // [0, 1)
  void setze(double p) noexcept {
    const double g = std::floor(p);
    ganz = static_cast<int64_t>(g);
    rest = p - g;
  }
  void addiere(double x) noexcept {
    rest += x;
    const double g = std::floor(rest);
    ganz += static_cast<int64_t>(g);
    rest -= g;
  }
  double wert() const noexcept { return static_cast<double>(ganz) + rest; }
};
// Einen Abschnitt von n Samples fortschreiben; f(j): der gehörte Faktor am Sample j des Abschnitts.
template <class F>
inline void dehner_summe_abschnitt(DehnerSumme& P, int n, F&& f) noexcept {
#ifdef CYPHERDJ_MUTATION_DEHNER_P_JE_SAMPLE
  double p = P.wert();  // Fehlerfall (Stand Task 5): je Sample in einem double, wie bis Task 5 (Test dehner_p_summe rot)
  for (int j = 0; j < n; ++j) p += f(j);
  P.setze(p);
#else
  double s = 0.0;
  for (int j = 0; j < n; ++j) s += f(j);
  P.addiere(s);
#endif
}

// Das Band einer Quelle (Deck-Material, Loop, Aufnahme). Vertrag für band():
//  - wird GLEICHZEITIG aus zwei Fäden gerufen (Arbeits-Thread und Vorbereiter, je mit eigenem Zielpuffer): nur lesend,
//    ohne Zustand in der Quelle (kein Lesekopf, kein Zwischenspeicher, der beim Lesen geschrieben wird);
//  - keine Allokation, keine Sperre, kein Systemaufruf;
//  - was es liest, muss leben, bis der Dehner eine Epoche quittiert hat, die diese Quelle nicht mehr benutzt (Vertrag 4).
// Wickeln (Loop-Naht) und Stem-Gewichte sind Sache der Quelle: der Dehner kennt keine Stems, die Quelle liefert die
// fertige Summe (Architektur 8; Stem-Griffe wirken im Keylock darum erst mit Ring und R3-Verzögerung, rund 70 ms später).
class DehnerQuelle {
 public:
  virtual ~DehnerQuelle() = default;
  // n Frames ab Quellframe ab nach l und r (überschreibt); außerhalb des Bandes Stille.
  virtual void band(int64_t ab, int n, float* l, float* r) const noexcept = 0;
  virtual double basis_bpm() const noexcept = 0;  // Tempo, bei dem das Band unverändert klingt (Faktor 1)
};

// Wo im Band der Kopf liegt: kopf(s) = f + (beat_at(s) − b) · fpb, fpb = 60 · 48000 / basis_bpm (wie Deck::kopf_bei).
struct DehnerAnker {
  double b = 0.0;  // Master-Beat
  double f = 0.0;  // Quell-Frame dazu
};

// Was die Callback-Seite je Block veröffentlicht (Dreifachpuffer, ein Schreiber, ein Leser): Karte und Anker der Quelle
// (Architektur 4). Eine interne Erneuerung (vorbereiter_schritt) setzt mit Karte UND Anker aus dem Stand an.
struct KartenStand {
  Karte karte;
  DehnerAnker anker;
  uint32_t generation = 0;  // wächst bei angenommener Rampe, Hand-Segment, SET_NEU (Vertrag 10)
  int64_t s_jetzt = 0;      // Block-Anfang des Callbacks
};

// Epochen vergibt NUR der Dehner (ansetzen() und die interne Erneuerung); 0 heißt „keine“ und wird nie vergeben.
constexpr uint32_t EPOCHE_KEINE = 0;

// Ein Ansatz: ab Sample s_h soll der Ring das Band der Quelle tragen. quelle == nullptr: Leer-Epoche (kein Band; der
// Thread quittiert „Band fallen gelassen“, Vertrag 4).
struct AnsatzAuftrag {
  const DehnerQuelle* quelle = nullptr;
  int64_t s_h = 0;
  DehnerAnker anker;
  Karte karte;
  uint32_t generation = 0;
};

// Keylock Task 6b (Plan Task 6, Abschnitt 3.2 und 3.7, Bauart Q „Wechsel in der Quelle“): ein Wechsel tauscht in der
// LAUFENDEN Epoche das Band, aus dem der Arbeits-Thread speist, ohne neuen Ansatz (kein Einfrieren, keine Brücke, Regler,
// Faktor, Ring, Epoche und Quittung bleiben). Vertrag: `neu` liefert für jeden Quellframe < p_gleich_bis dasselbe wie das
// bisherige Band; ab p_gleich_bis darf es abweichen (der geplante Sprung samt Blende davor). Der Thread nimmt den Auftrag in
// fuelle_synchron() nach uebernehmen() an, wenn die Epoche die des aktiven Ansatzes ist und die Einspeisung (nächster
// Quellframe, den R3 bekäme) noch <= p_gleich_bis liegt: dann hat R3 bis dahin nichts bekommen, worin sich Alt und Neu
// unterscheiden, und der Wechsel ist verlustfrei. Sonst „verfehlt“ (nichts geändert). Ein Auftrag, den der Thread nicht
// gelesen hat, wird vom nächsten überschrieben (Dreifachpuffer, „ueberschrieben“). Der Gegenwechsel (Abbruch, 3.7) ist
// derselbe Auftrag mit dem zuvor gelesenen Band als `neu` und demselben p_gleich_bis.
// Erneuerung (Fix-Runde W2, Prüfung Q1): der Thread meldet jede Annahme {Epoche, Nummer, neu} an den Vorbereiter zurück
// (Dreifachpuffer). Der Vorbereiter übernimmt `neu` in seinen letzten Ansatz, wenn die Meldung die zuletzt von ihm vergebene
// Epoche nennt, und bestätigt dann die Nummer (wechsel_bestaetigt()); jede spätere interne Erneuerung (vorbereiter_schritt)
// setzt mit `neu` an. Überholt eine Erneuerung, die der Vorbereiter VOR dieser Meldung angesetzt hat, die Epoche mit der
// Annahme (Wettlauf zweier Fäden), trägt sie das alte Band: der Thread zählt die Annahme dann als zurückgenommen
// (wechsel_zurueckgenommen() = nr) und der Vorbereiter bestätigt sie nie.
// Lebensdauer: `neu` muss leben, bis ein späterer Wechsel angenommen und bestätigt oder die Epoche quittiert abgelöst ist
// (wie Vertrag 4). Das alte Band einer Nummer nr lesen Thread und Vorbereiter des Dehners nicht mehr, sobald
// wechsel_bestaetigt() >= nr und nr angenommen ist (wechsel_gelesen() >= nr, nr nicht verfehlt), bis ein späterer Wechsel es
// wieder als `neu` nennt. Vorher (nur angenommen, nicht bestätigt) kann eine laufende Erneuerung es noch lesen. Wer es sonst
// noch liest (Leser der Quelle, eigene Ansätze der Quelle), regelt die Quelle (Leihe, Plan 3.6), nicht der Dehner.
// Überschriebene Aufträge zwischen der zuletzt gelesenen Nummer `letzte` und der jetzt gelesenen `nr` (Fix-Runde W2, Q3/S5):
// die Nummern laufen 1, 2, ..., 0xFFFFFFFF, 1, ... (0 wird nie vergeben), über den Überlauf fehlt darum eine Stelle. letzte = 0:
// noch nichts gelesen.
inline uint32_t dehner_wechsel_luecke(uint32_t letzte, uint32_t nr) noexcept {
#ifdef CYPHERDJ_MUTATION_DEHNER_LUECKE_ALT
  const uint32_t l = nr - letzte - 1;  // Fehlerfall (Stand be2a7ef0): zählt am Überlauf ein Überschreiben zu viel
  return l < 0x80000000u ? l : 0;
#else
  uint32_t l = nr - letzte - 1;
  if (letzte != 0 && nr <= letzte) --l;  // über den Überlauf: die übersprungene 0 ist kein Auftrag
  return l < 0x80000000u ? l : 0;
#endif
}

struct WechselAuftrag {
  uint32_t epoche = EPOCHE_KEINE;      // nur in dieser Epoche wirksam
  uint32_t nr = 0;                     // vergibt der Dehner in wechsel() (fortlaufend ab 1); die Eingabe wird überschrieben
  const DehnerQuelle* neu = nullptr;   // liefert bis p_gleich_bis dasselbe wie das bisherige Band
  int64_t p_gleich_bis = 0;            // Quellframe: ab hier weicht neu ab (p_sw − Blende)
};

// Kosten in Nanosekunden, Histogramm 1 µs bis 20 ms, darüber ein Überlauf-Fach.
struct DehnerKosten {
  static constexpr int N = 20001;
  uint64_t n = 0;
  int64_t max_ns = 0, summe_ns = 0;
  std::vector<uint32_t> fach = std::vector<uint32_t>(N, 0);
  void rein(int64_t ns) {
    ++n;
    summe_ns += ns;
    if (ns > max_ns) max_ns = ns;
    int64_t us = ns / 1000;
    if (us < 0) us = 0;
    if (us >= N) us = N - 1;
    ++fach[static_cast<std::size_t>(us)];
  }
  double quantil_us(double q) const {
    if (!n) return 0.0;
    const uint64_t ziel = static_cast<uint64_t>(q * static_cast<double>(n) + 0.999999);
    uint64_t s = 0;
    for (int i = 0; i < N; ++i) {
      s += fach[static_cast<std::size_t>(i)];
      if (s >= ziel) return i;
    }
    return N - 1;
  }
};

// Umbauplan 2026-10-09-bungee-umbau (S1): zwei Maschinen hinter DehnerBasis. R3 (dehner.cpp: Rubber Band, drei Fäden, Regler) und
// Bungee (dehner_bungee.cpp: Position je Korn aus der Karte, synchron im Callback, ein Faden).
enum class DehnerMaschine { R3, Bungee };

struct DehnerOptionen {
  DehnerMaschine maschine = DehnerMaschine::R3;
  // Nur Bungee: log2SynthesisHopAdjust. false = 0 (Korn 512 Frames, "Standard"), true = -1 (Korn 256, "fein").
  bool bungee_fein = false;
  bool versatz_anwenden = true;  // false nur für das Einmessen (Abschnitt 0 der Tests)
  // Vorhalt der Mittelpunkt-Regel (Vertrag 15, M4 E1). Vorgabe 2400 Samples (50 ms) für ALLE Rampen (Prüfung F2): mit 0
  // lag das Mittel in Rampen über 4, 8, 16 Beats bei +30,5, +26,9, +16,7 Samples (task-01-fix/f2_f6_rot.txt), mit 2400
  // in ±3. Bei konstantem Tempo wirkt er nicht (bitgleich, task-01-fix/f7_schwelle.txt).
  double vorhalt_samples = 2400.0;
  int quantum = 256;             // JACK-Quantum: Vorlauf = VORLAUF_BL · max(256, Quantum) Frames (Vertrag 11)
};
inline std::size_t dehner_vorlauf(const DehnerOptionen& o) {
  return static_cast<std::size_t>(DEHNER_VORLAUF_BL) * static_cast<std::size_t>(o.quantum > DEHNER_BLOCK ? o.quantum : DEHNER_BLOCK);
}

class DehnerBasis {
 public:
  virtual ~DehnerBasis() = default;

  // ---- Vorbereiter (eigener Faden, nie der Lade-Faden)
  // Bereitet die Reserve-Instanz vor, übergibt sie dem Thread und gibt die dafür VERGEBENE Epoche zurück (fortlaufend ab
  // 1). EPOCHE_KEINE: keine Reserve frei (besetzt; der Aufrufer versucht es später, es wurde nichts vergeben). Ein
  // wartender, noch nicht übernommener Ansatz wird ersetzt (Vertrag 3).
  virtual uint32_t ansetzen(const AnsatzAuftrag& a) = 0;
  // Ist die Karten-Generation des Standes NEUER als die des letzten Ansatzes und s_h noch nicht erreicht (neue Rampe
  // angenommen), setzt der Dehner mit Karte und Anker des Standes neu an und vergibt dafür die nächste Epoche (zählt
  // ansatz_erneuert()). Ein älterer oder gleicher Stand ändert nichts. Aufruf in jedem Takt des Vorbereiters mit dem
  // letzten veröffentlichten Stand.
  virtual void vorbereiter_schritt(const KartenStand& stand) = 0;

  // ---- Arbeits-Thread (Task 1: synchron aufgerufen, derselbe Aufruf wie in der Thread-Schleife)
  virtual void fuelle_synchron() = 0;

  // ---- Callback (wartefrei)
  virtual void karte_veroeffentlichen(const KartenStand& stand) = 0;
  virtual StreckRing& ring() = 0;
  // Die aktuell gültige Epoche (zuletzt vergeben, Acquire): die EINZIGE Quelle, aus der der Leser seine Ring-Epoche nimmt.
  // EPOCHE_KEINE, solange nie angesetzt wurde.
  virtual uint32_t epoche() const = 0;
  // Task 6b: Wechselauftrag stellen (wartefrei, keine Allokation; ein Schreiber: der Callback). Gibt die vergebene Nummer
  // zurück (fortlaufend ab 1, 0 wird nie vergeben).
  virtual uint32_t wechsel(const WechselAuftrag& a) = 0;

  // ---- Diagnose aus jedem Faden (Atome)
  virtual uint32_t quittiert_e() const = 0;     // letzte Epoche, die der Thread übernommen hat (EPOCHE_KEINE: noch keine)
  virtual int ansatz_erneuert() const = 0;      // Zahl der internen Erneuerungen
  virtual uint64_t auffuellen_kurz() const = 0;   // Abschnitte, deren Ende mit Nullen aufgefüllt wurde (retrieve zu kurz)
  virtual uint64_t auffuellen_zwang() const = 0;  // Speisungen trotz getSamplesRequired() == 0 (M4 zwang256)
  virtual uint64_t ring_voll() const = 0;         // Abschnitte, die nicht in den Ring passten (soll 0 sein; Prüfung F8)
  // Bungee S3: wartet ein Ansatz auf die Übernahme? NUR aus dem Faden, der auch ansetzen() und fuelle_synchron() ruft (Callback
  // bei Bungee, ohne Fäden). Ersetzt die Zahl der Ansätze, die ein Zyklus übernimmt (Kern::keylock_antrieb). R3: immer false.
  virtual bool ansatz_wartet() const { return false; }
  // Task 6b, Wechsel (Atome, Release nach der Entscheidung im Thread). Fix-Runde W2 (Prüfung Q2): wechsel_gelesen() >= nr heißt
  // nur „nr ist entschieden oder überholt“, NICHT „nr ist angenommen“: ein späterer angenommener Auftrag hebt die Zahl über nr,
  // auch wenn nr verfehlt oder überschrieben wurde (Probe P2: nr1 überschrieben, nr2 angenommen, gelesen 2 >= nr1). nr selbst
  // ist angenommen genau dann, wenn wechsel_gelesen() == nr war, solange kein späterer gestellt ist; wer später fragt, braucht
  // die Bestätigung (wechsel_bestaetigt() == nr) oder hält höchstens einen Auftrag zugleich offen.
  virtual uint32_t wechsel_gelesen() const = 0;     // Nummer des zuletzt ANGENOMMENEN Wechsels (0: noch keiner)
  // Ursachen für verfehlt (Fix-Runde W2, Q4/S4): (1) Einspeisung schon hinter p_gleich_bis; (2) Epoche älter als die aktive;
  // (3) Epoche NEUER als die aktive: der Vorbereiter hat sie vergeben (epoche() nennt sie schon), der Thread hat sie in diesem
  // Aufruf noch nicht übernommen, weil sie erst nach seinem uebernehmen() wartend wurde. Der Auftrag wird dann im selben Aufruf
  // als verfehlt verbraucht, nicht aufgehoben (hingenommen: der Aufrufer sieht verfehlt und nimmt den sicheren Weg); (4) keine
  // aktive Epoche, Leer-Epoche oder neu == nullptr.
  virtual uint32_t wechsel_verfehlt() const = 0;    // Nummer des zuletzt gelesenen, aber NICHT angenommenen (0: keiner)
  virtual uint64_t wechsel_n_angenommen() const = 0;
  virtual uint64_t wechsel_n_verfehlt() const = 0;
  virtual uint64_t wechsel_ueberschrieben() const = 0;  // gestellt, aber vom nächsten überschrieben, bevor der Thread las
  virtual uint32_t wechsel_bestaetigt() const = 0;      // Nummer der zuletzt vom Vorbereiter übernommenen Annahme (0: keine)
  virtual uint32_t wechsel_zurueckgenommen() const = 0;  // Nummer der zuletzt von einer älteren Erneuerung überholten Annahme
  virtual uint64_t wechsel_n_zurueckgenommen() const = 0;

  // ---- Diagnose NUR SYNCHRON: lesen Zustand des Arbeits-Threads bzw. Vorbereiters ohne Atom. Nur aufrufen, wenn
  // Thread und Vorbereiter stehen oder aus demselben Faden (Tests mit fuelle_synchron()).
  virtual double faktor_gesetzt() const = 0;     // zuletzt an Rubber Band gegebener Faktor (Quellframes je Ausgabeframe)
  virtual double faktor_kleinster_abstand() const = 0;  // kleinster |f − 1| über alle Setzungen
  virtual double regler_c() const = 0;           // Stellgröße c (relativ)
  virtual int64_t geschrieben_bis() const = 0;   // erstes noch nicht geschriebenes Sample der aktuellen Epoche
  virtual int64_t einspeisung_bis() const = 0;   // Task 6b: nächster Quellframe, den R3 der aktiven Epoche bekäme (-1: keine)
  virtual const DehnerKosten& kosten_render() const = 0;  // ein Ausgabe-Abschnitt von 256 Frames
  virtual const DehnerKosten& kosten_ansatz() const = 0;  // ansetzen() ganz (reset, Pad, Startverzögerung, Pull)
};

// Fabrik (Vertrag 13). dehner.cpp liefert den Dehner mit Rubber Band; stub/dehner_stub.cpp liefert nullptr.
std::unique_ptr<DehnerBasis> dehner_neu(int kennung, const DehnerOptionen& opt = {});  // kennung: nur Diagnose
// Bungee-Maschine (src/dehner_bungee.cpp, nur mit CYPHERDJ_BUNGEE gebaut); dehner_neu() ruft sie bei opt.maschine == Bungee.
std::unique_ptr<DehnerBasis> dehner_bungee_neu(int kennung, const DehnerOptionen& opt);

}  // namespace cdj
