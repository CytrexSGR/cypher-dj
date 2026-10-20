// D1 K1 (Spec 2.1): gemeinsame Buchführung des gesperrten Speichers für Deck-Lader (lader.h) und Arrangement-Lader
// (arr_wiedergabe.h). Budget = kern.toml speicher_budget_mib. Zwei Fäden buchen (Lade-Faden der Decks, Lade-Faden des
// Arrangements), darum atomar mit Vergleich-und-Tausch: belaste() gelingt nur, wenn die Summe das Budget nicht reißt.
#pragma once

#include <atomic>
#include <cstdint>

namespace cdj {

class SpeicherKonto {
 public:
  explicit SpeicherKonto(int64_t budget_bytes) : budget_(budget_bytes) {}
  // true: bytes sind gebucht. false: das Budget würde reißen, nichts gebucht.
  bool belaste(int64_t bytes) noexcept {
    int64_t alt = gesperrt_.load(std::memory_order_relaxed);
    do {
      if (alt + bytes > budget_) return false;
    } while (!gesperrt_.compare_exchange_weak(alt, alt + bytes, std::memory_order_relaxed));
    return true;
  }
  void entlaste(int64_t bytes) noexcept { gesperrt_.fetch_sub(bytes, std::memory_order_relaxed); }
  int64_t gesperrt() const noexcept { return gesperrt_.load(std::memory_order_relaxed); }
  int64_t budget() const noexcept { return budget_; }

 private:
  const int64_t budget_;
  std::atomic<int64_t> gesperrt_{0};
};

}  // namespace cdj
