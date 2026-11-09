// Baukasten S3b: das Graph-Werk. Baukasten-Graphen rechnen auf Arbeitsfäden einen Block voraus: der Callback erteilt in
// Zyklus t den Auftrag für Block t+1 (auftrag) und holt in Zyklus t+1 ab (abholen). Was ein Faden noch nicht angefangen
// hat, rechnet der Callback beim Abholen selbst (stehlen); was ein Faden gerade rechnet, ist verspätet (Stille, gezählt).
// Plätze außerhalb 0..GW_PLAETZE-1: auftrag false, abholen LEER, frei false, anlauf tut nichts, l()/r() nullptr.
// Besitz: FREI (Callback darf das Handle anfassen), AUFTRAG/RECHNET (nur der Rechner), FERTIG (Puffer gültig).
// Was der Callback nie tut: warten, sperren, allokieren. faeden 0 = synchron: auftrag rechnet sofort im Aufrufer.
// Die Puffer l()/r() eines Platzes gelten bis zum nächsten auftrag/anlauf auf demselben Platz.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"   // MIX_BLOCK

namespace cdj {

constexpr int GW_PLAETZE = 32;     // 2 · ERZ_STROEME: aktiv + Ausklang je Strom
constexpr int GW_FAEDEN_MAX = 8;

struct GraphZaehler {
  uint64_t auftraege = 0, gestohlen = 0, anlauf = 0, verspaetet = 0, verworfen = 0, haengt = 0, panik = 0;
};

using GraphRechne = int32_t (*)(CypherBk*, float*, float*, size_t);   // Vorgabe cypher_bk_block; Tests setzen einen Stub

// Test-Naht für prioritaet(): setzt SCHED_FIFO `prio` auf den Faden (pthread_t); Rückgabe 0 oder errno-Wert. nullptr: pthread_setschedparam.
using GraphPrioSetzer = int (*)(unsigned long faden, int prio);

struct GraphWerkOptionen {
  int faeden = 0;                  // 0 synchron, 1..GW_FAEDEN_MAX
  GraphRechne rechne = nullptr;    // nullptr: cypher_bk_block
  GraphPrioSetzer prio_setzen = nullptr;   // nur Tests
};

enum class Abholung { GUELTIG, VERSPAETET, VERWORFEN, LEER };

// Zuständigkeit: auftrag, abholen, anlauf, frei, l, r, zaehler gehören dem Callback (ein Faden). stoppe() und prioritaet()
// verbinden Fäden (join) und laufen nie im Callback, nie nebenläufig zueinander und nie nebenläufig zum Destruktor: ein
// zweiter stoppe()-Aufrufer kehrt zurück, ohne auf den Join des ersten zu warten. Aus dem Callback ruft sie niemand
// (sie blockieren); der Besitzer des Werks ruft sie vor der Freigabe der Plätze.
class GraphWerk {
 public:
  virtual ~GraphWerk() = default;   // Implementierung: Destruktor ruft stoppe() (m8)
  // ---- Callback
  virtual bool frei(int platz) const noexcept = 0;
  // Nur auf FREIem Platz: bk rechnet n Frames (n <= MIX_BLOCK) für Ziel-Sample s. false: Platz nicht frei.
  virtual bool auftrag(int platz, CypherBk* bk, int64_t s, int n) noexcept = 0;
  // Ausgabe für Ziel-Sample s und Länge n. GUELTIG: l()/r() gelten, Platz ist FREI. VERSPAETET: ein Faden rechnet noch,
  // Platz bleibt besetzt. VERWORFEN: fertig, aber für ein anderes s oder n; Platz ist FREI. LEER: kein Auftrag.
  virtual Abholung abholen(int platz, int64_t s, int n) noexcept = 0;
  // Callback rechnet n Frames selbst (Anlauf, D5); nur auf FREIem Platz; Ergebnis in l()/r().
  virtual void anlauf(int platz, CypherBk* bk, int n) noexcept = 0;
  virtual const float* l(int platz) const noexcept = 0;
  virtual const float* r(int platz) const noexcept = 0;
  // ---- Betrieb
  virtual int faeden() const noexcept = 0;
  virtual int prioritaet(int jack_prio) = 0;   // SCHED_FIFO jack_prio − 7; jp <= 0 oder ein Faden scheitert: synchron (D10). Rückgabe: Anzahl Fäden ohne SCHED_FIFO
  virtual void stoppe() = 0;                   // idempotent; danach synchron
  virtual GraphZaehler zaehler() const noexcept = 0;
};

std::unique_ptr<GraphWerk> graph_werk_neu(const GraphWerkOptionen& o);

}  // namespace cdj
