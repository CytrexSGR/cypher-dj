// Paket 1.13 Warp, Slice 2 (ADR 031 Teil 2): das Warp-Werk. COMPLEX (Bungee, Korn 512) und TONES (Bungee, Korn 256) rechnen nicht im Callback:
// 32 Bungee-Stimmen im Callback reißen das Budget (Spec 7.2), und das Arrangement kennt seine Zukunft. Das Werk hält einen festen Pool von
// ARR_WARP_PLAETZE Stimmen (je zwei Bungee-Instanzen, eine für jedes Korn, im Konstruktor angelegt) und je Platz einen Ring (StreckRing) mit dem
// Vorlauf ARR_WARP_VORLAUF Frames. Arbeitsfäden (kern.toml warp_faeden) füllen die Ringe voraus, der Callback liest nur den Ring.
//
// Ablauf einer Stimme: belege() -> ansetzen(platz, Auftrag) mit dem Ziel-Sample s_h, mindestens ARR_WARP_FRIST Samples vor dem Einsatz; der
// Faden übernimmt den Auftrag, setzt Bungee an (reset, Preroll) und schreibt ab s_h Blöcke zu 256 Frames in den Ring, solange er weniger als
// den Vorlauf vor dem Callback liegt (takt() meldet das Sample des Callbacks). gib() beendet die Stimme; ein neuer Auftrag auf demselben Platz
// bekommt eine neue Epoche, der Ring verwirft alles Ältere. Was der Callback nie tut: warten, sperren, allokieren.
//
// Lebensdauer (Pflicht): der Faden liest die Marker eines Clips aus dem Schnappschuss (einmal, beim Übernehmen des Auftrags, in eine eigene
// Kopie) und das Audio des Caches (bei jedem Block seiner Stimme). liest(s) sagt dem Lade-Faden, ob ein abgelöster Schnappschuss s noch gebraucht
// wird: ein Auftrag ist noch nicht übernommen, oder eine Stimme hält ein Audio von s (haelt: vom Übernehmen des Auftrags bis zum Ende der Stimme im
// Faden, also auch zwischen zwei Blöcken und auch dann, wenn der Callback sie nicht beendet hat, wie die alte Stimme eines Tauschs, die bis zur
// Überblendung aus ihrem Ring weiterspielt und dazu weiterrechnet) und s ist der letzte Schnappschuss, der dieses Audio nennt (ArrAudio::ref ist 1:
// der Cache gäbe es mit s frei). Erst wenn liest(s) false ist, darf gib_wiedergabe(s) laufen. Der Lade-Faden wartet darauf, nie der Callback; nur er
// ruft liest(). Grob ist die Frage nach den Aufträgen: ein offener Auftrag irgendeines Platzes hält jeden abgelösten Schnappschuss, denn in welchen er zeigt, darf der
// Lade-Faden nicht lesen (der Dreifachpuffer gehört Callback und Faden). Laufen die Fäden lange nicht, steht darum die Warteliste des Laders (16), und der Netz-Faden
// wartet je Rückgabe bis zu 1 s und gibt dann als Leck auf (Plan, Offene Flanken).
//
// Betriebsarten: faeden 0 = synchron (Offline-Render und Tests): takt() füllt alle Ringe im aufrufenden Faden, deterministisch; faeden 1..8 =
// Arbeitsfäden (Betrieb), takt() weckt sie nur.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/streck_ring.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int ARR_WARP_PLAETZE = 64;        // Stimmen im Pool (32 Spuren, an Nähten und Tauschen kurzzeitig zwei je Clip; reicht er nicht, gilt die Regel bei vollem Pool in werk_decken)
constexpr int ARR_WARP_FRIST = 2048;        // Samples, die ein Auftrag vor seinem Ziel-Sample im Werk liegen muss (43 ms)
constexpr int ARR_WARP_VORLAUF = 8192;      // Frames, die der Ring dem Callback voraus ist (171 ms)
constexpr int WARP_BLOCK = 256;             // Frames je Ringabschnitt
constexpr int ARR_WARP_FAEDEN_MAX = 8;

// Der Auftrag einer Stimme (Callback -> Faden). Die Abbildung: Clip-Beat b(m) = karte.beat_at(m) + beat_versatz, Quellposition W(b(m)) aus den
// Markern des Clips, Geschwindigkeit W'(b) · bpm_at(m) / 60 / 48000. clip == nullptr: die Stimme beenden.
struct WarpAnsatz {
  const ArrClip* clip = nullptr;
  int64_t s_h = 0;            // Ziel-Sample: Frame 0 der Stimme im Ring
  int64_t s_ende = 0;         // letztes Sample + 1, das der Callback von dieser Stimme liest (Clip-Ende); dahinter rechnet der Faden nicht
  double beat_versatz = 0.0;
  Karte karte;
  uint32_t epoche = 0;        // vergibt ansetzen()
};

struct WarpZaehler {
  uint64_t ansaetze = 0;      // übernommene Aufträge
  uint64_t bloecke = 0;       // geschriebene Blöcke zu 256 Frames
  uint64_t ring_voll = 0;     // Schreibversuche, die der Ring nicht aufnahm
  uint64_t verworfen = 0;     // Aufträge, die beim Übernehmen schon überholt waren
};

struct WarpWerkOptionen {
  int faeden = 0;             // 0 synchron, 1..ARR_WARP_FAEDEN_MAX Arbeitsfäden
};

class WarpWerk {
 public:
  virtual ~WarpWerk() = default;

  // ---- Callback (wartefrei, keine Allokation)
  virtual int belege() noexcept = 0;                                 // freier Platz, -1: Pool voll
  virtual void ansetzen(int platz, WarpAnsatz& a) noexcept = 0;      // setzt a.epoche, stellt den Ring auf die neue Epoche
  virtual void gib(int platz) noexcept = 0;                          // die Stimme endet; der Platz ist sofort wieder frei
  virtual StreckRing& ring(int platz) noexcept = 0;
  // Sample, ab dem der Faden die Stimme der laufenden Epoche nicht mehr rechnet (Quelle oder Clip zu Ende); INT64_MAX, solange er rechnet
  virtual int64_t ende_s(int platz) const noexcept = 0;
  virtual void takt(int64_t s_jetzt) noexcept = 0;                   // am Ende jedes Zyklus: Stand des Callbacks melden, Fäden wecken (synchron: füllen)
  virtual int belegt() const noexcept = 0;                           // Plätze in Benutzung (nur Callback)

  // ---- Lade-Faden
  virtual bool liest(const ArrSnapshot* s) const noexcept = 0;

  // ---- Betrieb
  virtual int faeden() const noexcept = 0;
  virtual int prioritaet(int jack_prio) = 0;                         // SCHED_FIFO jack_prio − 6 für die Fäden; Rückgabe: Fäden ohne Erfolg
  virtual void stoppe() = 0;                                         // Fäden beenden und verbinden (vor dem Abbau des Lade-Fadens und der Caches)
  virtual WarpZaehler zaehler() const noexcept = 0;
  virtual std::string schluss_json() const = 0;                      // nach stoppe(): Kosten je Block und Auftrag, CPU der Fäden
  virtual void test_halte(bool an) noexcept = 0;                     // nur Tests: die Fäden (synchron: takt) rechnen nicht
  virtual void test_halte_block(bool an) noexcept = 0;               // nur Tests: ein Faden bleibt im Block stehen (die Stimme hält ihr Audio, haelt)
};

// nullptr, wenn der Kern ohne Bungee gebaut ist
std::unique_ptr<WarpWerk> warp_werk_neu(const WarpWerkOptionen& opt);

}  // namespace cdj
