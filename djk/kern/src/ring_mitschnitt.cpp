// Paket K3: Master-Mitschnitt aus dem Audio-Ring (ring_mitschnitt.h).
#include "cypherdj/ring_mitschnitt.h"

#include "cypherdj/kern.h"

namespace cdj {

static_assert(RING_BLOCK_MARGE == MAX_BLOCK, "die Marge ist ein Block der Höchstgröße des Kerns");

namespace {

// Fix L6: der Kern schreibt den Block [w, w + n) vor dem Veröffentlichen von w + n; dabei überschreibt er die Plätze der
// Frames [w − CAP, w − CAP + n). Frames ab w_ sind darum nur sicher, solange w − w_ ≤ CAP − n (n höchstens MAX_BLOCK).
bool ueberholt(uint64_t w, uint64_t w_) {
#ifdef CYPHERDJ_MUTATION_RING_OHNE_MARGE
  return w - w_ > CDJ_RING_CAP;   // Fehlerfall: ohne den Block im Flug
#else
  return w - w_ > CDJ_RING_CAP - RING_BLOCK_MARGE;
#endif
}

}  // namespace

bool RingLeser::lies(RingMitschnitt& m) {
  if (!cdj_ring_gueltig(r_)) {
    m.fehler = "ungueltig";
    return false;
  }
  const uint64_t w = cdj_lade(&r_->w);   // Acquire: die Frames vor w sind geschrieben
  const uint64_t smw = cdj_lade(&r_->sample_minus_w);
  if (erst_) {
    erst_ = false;
    w_ = w;
    smw_ = smw;
    m.s0 = static_cast<int64_t>(w + smw);
    m.grenze = m.s0;
    return true;
  }
  if (smw != smw_) {
    m.fehler = "sprung";
    return false;
  }
  if (ueberholt(w, w_)) {
    m.fehler = "ueberlauf";
    return false;
  }
  const float* d = cdj_ring_daten_c(r_);
  for (uint64_t f = w_; f < w; ++f) {
    const uint64_t i = (f % CDJ_RING_CAP) * CDJ_RING_KANAELE;
    m.l.push_back(d[i + 0]);
    m.r.push_back(d[i + 1]);
  }
  if (ueberholt(cdj_lade(&r_->w), w_)) {   // während des Kopierens überholt: die ältesten Frames sind fremd
    m.fehler = "ueberlauf";
    return false;
  }
  w_ = w;
  return true;
}

}  // namespace cdj
