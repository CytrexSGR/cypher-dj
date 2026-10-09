// Ring der gedehnten Frames zwischen Dehner-Thread (Schreiber) und Callback der Quelle (Leser), Keylock in Echtzeit
// (Plan 2026-10-06-keylock-echtzeit.md, Übergabe-Vertrag 1, 2, 13). Header-only, ohne JACK und ohne Rubber Band:
// die Quellen (deck.cpp, Loop-Boxen, REC) und alle Mutationsziele binden nur diesen Kopf.
//
// Der Ring trägt ABSCHNITTE: vier Wörter Kopf {epoche, s_anfang (lo, hi), n}, danach n Frames Stereo (zwei Wörter je
// Frame, float als Bitmuster). Ein Abschnitt wird mit einem Release-Zähler als Ganzes veröffentlicht.
// Der Leser (Callback) kennt seine aktuelle Epoche und spielt nur Frames dieser Epoche, deren Sample genau passt:
//   verworfen:  ältere Epoche, oder Frames mit s_anfang + i < s (liegen hinter dem Abspielstand)
//   liegen:     ein Abschnitt mit s_anfang > s (die neue Epoche ab s_h, während die Brücke noch klingt) und jede
//               NEUERE Epoche als die aktuelle (Nachprüfung 3, N1)
// Der Leser hält den Kopf des angefangenen Abschnitts bei sich, weil der Block der Quelle (z. B. Deck::block) an Befehlen in Teilblöcke geteilt wird.
// Keine Allokation nach dem Anlegen, keine Sperre, kein Systemaufruf: Leser und Schreiber sind echtzeitfest.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace cdj {

class StreckRing {
 public:
  static constexpr std::size_t KOPF_WOERTER = 4;

  // frames: Fassungsvermögen in Frames (wird auf eine Zweierpotenz aufgerundet, Köpfe eingerechnet).
  // Vorgabe-Größe: VORLAUF_BL · max(256, Quantum) (Vertrag 11), bei Quantum 1024 also 4096 Frames.
  explicit StreckRing(std::size_t frames = 4096) {
    std::size_t w = 2 * frames + 32 * KOPF_WOERTER;
    std::size_t n = 64;
    while (n < w) n <<= 1;
    maske_ = n - 1;
    daten_.assign(n, 0u);
  }

  // ---------------------------------------------------------------- Schreiber (Dehner-Thread)
  // Ein Abschnitt von n Frames ab Sample s_anfang. false: nicht genug Platz, nichts geschrieben.
  bool schreibe(uint32_t epoche, int64_t s_anfang, int n, const float* l, const float* r) noexcept {
    const std::size_t w = schreib_.load(std::memory_order_relaxed);
    const std::size_t noetig = KOPF_WOERTER + 2 * static_cast<std::size_t>(n);
    if (maske_ + 1 - (w - lies_.load(std::memory_order_acquire)) < noetig) return false;
    std::size_t i = w;
    daten_[i++ & maske_] = epoche;
    daten_[i++ & maske_] = static_cast<uint32_t>(static_cast<uint64_t>(s_anfang) & 0xffffffffu);
    daten_[i++ & maske_] = static_cast<uint32_t>(static_cast<uint64_t>(s_anfang) >> 32);
    daten_[i++ & maske_] = static_cast<uint32_t>(n);
    for (int k = 0; k < n; ++k) {
      daten_[i++ & maske_] = bits(l[k]);
      daten_[i++ & maske_] = bits(r[k]);
    }
    schreib_.store(w + noetig, std::memory_order_release);
    return true;
  }
  // Frames im Ring (ohne Köpfe), vom Schreiber aus gesehen: Maß für den Vorlauf.
  std::size_t frames_belegt() const noexcept {
    const std::size_t w = schreib_.load(std::memory_order_relaxed);
    const std::size_t l = lies_.load(std::memory_order_acquire);
    return (w - l) / 2;  // obere Schranke: Köpfe zählen mit (4 Wörter = 2 Frames je Abschnitt)
  }
  std::size_t kapazitaet_frames() const noexcept { return (maske_ + 1) / 2; }

  // ---------------------------------------------------------------- Leser (Callback)
  // Aktuelle Epoche der Quelle. Nur der Leser setzt sie.
  void setze_epoche(uint32_t e) noexcept { epoche_ = e; }
  uint32_t epoche() const noexcept { return epoche_; }

  // Sample, ab dem Frames der aktuellen Epoche bereitliegen (>= s), nach Verwerfen des Älteren; -1: nichts da.
  // Ein Abschnitt, der erst später beginnt (s_anfang > s), bleibt liegen und meldet sein s_anfang.
  int64_t bereit_ab(int64_t s) noexcept {
    if (!trimme(s)) return -1;
    return akt_.s_naechst;
  }
  // Das Sample, ab dem die aktuelle Epoche hörbar werden soll (s_h), solange ihr erster Abschnitt noch nicht gelesen
  // wurde; sonst das Sample des nächsten Frames. -1: nichts da. (Schmale Schnittstelle für die Quelle, Plan Dateien.)
  int64_t ab_sample() noexcept { return trimme(INT64_MIN) ? akt_.s_naechst : -1; }

  // Liest die Frames [s, s + n) der aktuellen Epoche nach l und r (überschreibt). true nur, wenn ALLE n Frames
  // lückenlos da sind; sonst false und nichts gelesen (Unterlauf: die Quelle spielt Varispeed). Älteres wird dabei
  // verworfen, das Spätere bleibt liegen.
  bool lies(int64_t s, int n, float* l, float* r) noexcept {
    if (n <= 0) return true;
    if (!trimme(s) || akt_.s_naechst != s) return false;
    // lückenlos vorhanden? (ohne zu verbrauchen)
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    int64_t haben = akt_.rest;
    std::size_t i = lese_ + 2 * static_cast<std::size_t>(akt_.rest);
    int64_t naechst = akt_.s_naechst + akt_.rest;
    while (haben < n) {
      if (w - i < KOPF_WOERTER) return false;
      Kopf k = kopf_an(i);
      if (k.epoche != epoche_ || k.s_anfang != naechst || w - i < KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n)) return false;
      haben += k.n;
      naechst += k.n;
      i += KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n);
    }
    // verbrauchen
    int fertig = 0;
    while (fertig < n) {
      if (akt_.rest == 0) {
        akt_ = kopf_an(lese_);
        lese_ += KOPF_WOERTER;
        akt_.s_naechst = akt_.s_anfang;
        akt_.rest = akt_.n;
      }
      const int m = static_cast<int>(akt_.rest < n - fertig ? akt_.rest : n - fertig);
      for (int k = 0; k < m; ++k) {
        l[fertig + k] = gleit(daten_[lese_++ & maske_]);
        r[fertig + k] = gleit(daten_[lese_++ & maske_]);
      }
      akt_.rest -= m;
      akt_.s_naechst += m;
      fertig += m;
    }
    lies_.store(lese_, std::memory_order_release);
    return true;
  }

  // Wie viele Frames der aktuellen Epoche liegen ab genau Sample s lückenlos bereit (ohne zu verbrauchen; Älteres wird
  // verworfen)? Für die Quelle, die einen drohenden Unterlauf am Blockanfang erkennt (Task 2b, Prüfung m2).
  int64_t verfuegbar(int64_t s) noexcept {
    if (!trimme(s) || akt_.s_naechst != s) return 0;
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    int64_t haben = akt_.rest;
    std::size_t i = lese_ + 2 * static_cast<std::size_t>(akt_.rest);
    int64_t naechst = akt_.s_naechst + akt_.rest;
    for (;;) {
      if (w - i < KOPF_WOERTER) break;
      const Kopf k = kopf_an(i);
      if (k.epoche != epoche_ || k.s_anfang != naechst || w - i < KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n)) break;
      haben += k.n;
      naechst += k.n;
      i += KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n);
    }
    return haben;
  }

  // Liest höchstens n Frames der aktuellen Epoche ab genau Sample s, so viele lückenlos da sind; Rückgabe: Zahl der
  // gelesenen Frames (0: nichts ab s). Für die Quelle, die je Block so viel nimmt, wie da ist (Task 2: Deck liest den
  // Ring in jedem Block, auch für die Blende der alten Epoche, Vertrag 1 und 8). Älteres wird verworfen.
  int lies_bis(int64_t s, int n, float* l, float* r) noexcept {
    if (n <= 0 || !trimme(s) || akt_.s_naechst != s) return 0;
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    int fertig = 0;
    while (fertig < n) {
      if (akt_.rest == 0) {
        if (w - lese_ < KOPF_WOERTER) break;
        const Kopf k = kopf_an(lese_);
        if (k.epoche != epoche_ || k.s_anfang != akt_.s_naechst ||
            w - lese_ < KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n))
          break;
        lese_ += KOPF_WOERTER;
        akt_.epoche = k.epoche;
        akt_.s_anfang = k.s_anfang;
        akt_.n = k.n;
        akt_.rest = k.n;
        if (akt_.rest == 0) continue;
      }
      const int m = static_cast<int>(akt_.rest < n - fertig ? akt_.rest : n - fertig);
      for (int k = 0; k < m; ++k) {
        l[fertig + k] = gleit(daten_[lese_++ & maske_]);
        r[fertig + k] = gleit(daten_[lese_++ & maske_]);
      }
      akt_.rest -= m;
      akt_.s_naechst += m;
      fertig += m;
    }
    lies_.store(lese_, std::memory_order_release);
    return fertig;
  }

  // Vom Leser aus: alles verwerfen, was im Ring liegt (nur für Tests und Neustart des Kerns, nicht im Betrieb).
  void leeren() noexcept {
    lese_ = schreib_.load(std::memory_order_acquire);
    akt_ = Kopf{};
    lies_.store(lese_, std::memory_order_release);
  }

 private:
  struct Kopf {
    uint32_t epoche = 0;
    int64_t s_anfang = 0;
    int32_t n = 0;
    int64_t s_naechst = 0;  // nur im Leser-Zustand: Sample des nächsten ungelesenen Frames
    int64_t rest = 0;       // nur im Leser-Zustand: ungelesene Frames des angefangenen Abschnitts
  };
  static uint32_t bits(float f) noexcept {
    uint32_t u;
    std::memcpy(&u, &f, sizeof u);
    return u;
  }
  static float gleit(uint32_t u) noexcept {
    float f;
    std::memcpy(&f, &u, sizeof f);
    return f;
  }
  Kopf kopf_an(std::size_t i) const noexcept {
    Kopf k;
    k.epoche = daten_[i & maske_];
    k.s_anfang = static_cast<int64_t>(static_cast<uint64_t>(daten_[(i + 1) & maske_]) |
                                      (static_cast<uint64_t>(daten_[(i + 2) & maske_]) << 32));
    k.n = static_cast<int32_t>(daten_[(i + 3) & maske_]);
    return k;
  }
  // Verwirft Älteres; true, wenn danach ein angefangener Abschnitt der aktuellen Epoche mit rest > 0 vorliegt
  // (akt_.s_naechst ≥ s, falls s nicht INT64_MIN). Neuere Epochen und spätere Abschnitte bleiben liegen.
  bool trimme(int64_t s) noexcept {
    const std::size_t w = schreib_.load(std::memory_order_acquire);
    bool geaendert = false;
    bool ok = false;
    for (;;) {
      if (akt_.rest == 0) {
        if (w - lese_ < KOPF_WOERTER) break;
        Kopf k = kopf_an(lese_);
        if (w - lese_ < KOPF_WOERTER + 2 * static_cast<std::size_t>(k.n)) break;  // (Schreiber veröffentlicht ganz)
        if (k.epoche > epoche_) break;  // neuer als aktuell: liegen lassen
        lese_ += KOPF_WOERTER;
        geaendert = true;
        if (k.epoche < epoche_) {  // älter: überspringen
          lese_ += 2 * static_cast<std::size_t>(k.n);
          continue;
        }
        akt_ = k;
        akt_.s_naechst = k.s_anfang;
        akt_.rest = k.n;
        if (akt_.rest == 0) continue;
      }
      if (akt_.epoche != epoche_) {  // die Epoche der Quelle wechselte mitten im Abschnitt: Rest verwerfen
        lese_ += 2 * static_cast<std::size_t>(akt_.rest);
        akt_.rest = 0;
        geaendert = true;
        continue;
      }
      // angefangener Abschnitt der aktuellen Epoche
      if (s != INT64_MIN && akt_.s_naechst < s) {
        const int64_t weg = (s - akt_.s_naechst < akt_.rest) ? (s - akt_.s_naechst) : akt_.rest;
        lese_ += 2 * static_cast<std::size_t>(weg);
        akt_.rest -= weg;
        akt_.s_naechst += weg;
        geaendert = true;
        continue;
      }
      ok = akt_.rest > 0;
      break;
    }
    if (geaendert) lies_.store(lese_, std::memory_order_release);
    return ok;
  }

  alignas(64) std::atomic<std::size_t> schreib_{0};
  alignas(64) std::atomic<std::size_t> lies_{0};
  std::size_t maske_ = 0;
  std::vector<uint32_t> daten_;
  // Leser-Zustand (nur der Callback)
  alignas(64) std::size_t lese_ = 0;
  uint32_t epoche_ = 0;
  Kopf akt_{};
};

}  // namespace cdj
