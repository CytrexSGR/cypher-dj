// Paket K3 (Spec D1 A7, Schritt 2): Master-Mitschnitt aus dem Audio-Ring (SCHNITTSTELLEN §6.1), sample-genau über das
// Ring-Kopf-Feld sample_minus_w (Frame f klingt am Kern-Sample f + sample_minus_w). Nur lesend: der Ring gehört dem Kern.
// lies() holt alle Frames seit dem letzten Aufruf; der erste Aufruf setzt den Anfang auf das aktuelle w (eine Blockgrenze:
// w steht nach jedem Zyklus am Ende des geschriebenen Blocks). Der Leser muss schneller sein als der Ring abzüglich eines
// Blocks im Flug (Fix L6: 65 536 − 8192 = 57 344 Frames, 1,19 s); sonst ueberlauf. Ändert sich sample_minus_w
// (Kern-Neustart, neue Zeitachse), sprung.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "cypherdj/ring.h"

namespace cdj {

// Fix L6: Marge für den Block, den der Kern gerade schreibt, ohne w schon veröffentlicht zu haben (MAX_BLOCK, kern.h)
constexpr uint64_t RING_BLOCK_MARGE = 8192;

struct RingMitschnitt {
  std::vector<float> l, r;   // Master L, R
  int64_t s0 = -1;           // Kern-Sample von l[0]
  int64_t grenze = -1;       // Kern-Sample einer Blockgrenze (für die Blockphase)
  std::string fehler;        // "" oder ungueltig, ueberlauf, sprung
};

class RingLeser {
 public:
  explicit RingLeser(const cdj_ring_kopf* ring) : r_(ring) {}
  bool lies(RingMitschnitt& m);   // false: fehler gesetzt, der Mitschnitt ist nicht mehr lückenlos

 private:
  const cdj_ring_kopf* r_;
  bool erst_ = true;
  uint64_t w_ = 0;
  uint64_t smw_ = 0;
};

}  // namespace cdj
