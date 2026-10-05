// Lock-freier Ring für genau einen Schreiber und genau einen Leser: Befehle UDP-Faden -> Callback, Ereignisse
// Callback -> Netz-Faden (Scheibe 08). Ersetzt jack_ringbuffer aus Scheibe 01, weil dessen Umsetzung zur Laufzeit
// von pw-jack kommt (PipeWire) und beim Binden von JACK2: welche Speicherordnung gilt, entscheidet die Bibliothek, und
// ThreadSanitizer sieht nicht hinein. Hier gilt sie sichtbar: Daten schreiben, dann Zähler mit Release; Zähler mit
// Acquire lesen, dann Daten. Keine Allokation, keine Sperre, kein Systemaufruf: im Callback erlaubt (ADR 002).
#pragma once

#include <atomic>
#include <cstddef>
#include <type_traits>

namespace cdj {

template <typename T, std::size_t N>
class SpscRing {
  static_assert(N >= 2 && (N & (N - 1)) == 0, "N muss eine Zweierpotenz sein");
  static_assert(std::is_trivially_copyable_v<T>, "T muss trivial kopierbar sein");

 public:
  // Nur der Schreiber. false: Ring voll, nichts geschrieben.
  bool schiebe(const T& v) noexcept {
    const std::size_t s = schreib_.load(std::memory_order_relaxed);
    if (s - lies_.load(std::memory_order_acquire) == N) return false;
    daten_[s & (N - 1)] = v;
#ifdef CYPHERDJ_MUTATION_RING_RELAXED
    schreib_.store(s + 1, std::memory_order_relaxed);  // Fehlerfall für ThreadSanitizer: Daten nicht veröffentlicht
#else
    schreib_.store(s + 1, std::memory_order_release);
#endif
    return true;
  }
  // Nur der Leser. false: Ring leer.
  bool hole(T& v) noexcept {
    const std::size_t l = lies_.load(std::memory_order_relaxed);
#ifdef CYPHERDJ_MUTATION_RING_RELAXED
    if (l == schreib_.load(std::memory_order_relaxed)) return false;
#else
    if (l == schreib_.load(std::memory_order_acquire)) return false;
#endif
    v = daten_[l & (N - 1)];
    lies_.store(l + 1, std::memory_order_release);
    return true;
  }
  std::size_t belegt() const noexcept {
    return schreib_.load(std::memory_order_acquire) - lies_.load(std::memory_order_acquire);
  }
  static constexpr std::size_t kapazitaet() noexcept { return N; }

 private:
  alignas(64) std::atomic<std::size_t> schreib_{0};
  alignas(64) std::atomic<std::size_t> lies_{0};
  alignas(64) T daten_[N];
};

}  // namespace cdj
