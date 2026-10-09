// Dreifachpuffer: ein Schreiber, ein Leser, keine Sperre, keine Allokation (Keylock in Echtzeit, Plan
// 2026-10-06-keylock-echtzeit.md Architektur 4). Der Schreiber füllt seinen Platz und tauscht ihn mit der Mitte (Neu-Bit 4);
// der Leser holt sich die Mitte, wenn das Bit steht. Der Leser sieht immer den NEUESTEN Stand, Zwischenstände fallen weg.
// Herkunft: aus dehner.cpp (Task 1) herausgelöst, damit auch die Quellen (Deck, Task 2; Loop-Boxen, Task 7) ihn nutzen.
#pragma once

#include <atomic>

namespace cdj {

template <class T>
class Dreifach {
 public:
  void schreibe(const T& v) noexcept {
    p_[w_] = v;
    veroeffentliche();
  }
  // Schreiben an Ort und Stelle (große T ohne Kopie über den Stapel): platz() füllen, dann veroeffentliche().
  T& platz() noexcept { return p_[w_]; }
  void veroeffentliche() noexcept { w_ = mitte_.exchange(w_ | NEU, std::memory_order_acq_rel) & 3; }
  // true: *r zeigt auf einen neuen Stand (gültig bis zum nächsten hole)
  bool hole(const T*& r) noexcept {
    if (!(mitte_.load(std::memory_order_acquire) & NEU)) return false;
    l_ = mitte_.exchange(l_, std::memory_order_acq_rel) & 3;
    r = &p_[l_];
    return true;
  }

 private:
  static constexpr int NEU = 4;
  T p_[3];
  int w_ = 0;  // nur der Schreiber
  int l_ = 1;  // nur der Leser
  std::atomic<int> mitte_{2};
};

}  // namespace cdj
