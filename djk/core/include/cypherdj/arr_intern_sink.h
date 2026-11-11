// Baukasten S20: the one internal sink of the arrangement. An internal track plays on the RB-338, on a Baukasten graph or (1.9) on a Kit, whatever its
// device in the snapshot (ArrSpur::geraet) says; this class forwards notes, transport starts and blocks of each track to the sink of
// its device. It detects a change of device on a track itself (the arrangement sees one sink and calls no spur_weg for it): the old
// sink gets spur_weg and one fade block, then the new one plays. The sinks are owned by the kern.
// Real-time: no allocation, no lock, no I/O.
#pragma once

#include <cstdint>

#include "cypherdj/arrangement.h"

namespace cdj {

class ArrInternSenke final : public ArrSenke {
 public:
  ArrInternSenke(const Arrangement& arr, ArrSenke* rb, ArrSenke* bk, ArrSenke* kit) : arr_(arr), rb_(rb), bk_(bk), kit_(kit) {}

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  // forwards the lane struct to the inner sink; same body as block() (device-change handling included)
  void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept override;
  // true only when the track is not in a device-change transition and the inner sink says true
  bool leer(int spur) const noexcept override {
    const ArrSenke* cur = innen(spur);
    return !cur || cur->leer(spur);
  }
  bool parallel_faehig(int spur) const noexcept override;
  void auto_parameter(int spur, int param, float wert) noexcept override;   // `geraet` lane values: to the sink of the device (the RB-338 parameters, the Baukasten knobs k1..k8)
  void auto_parameter_summand(int spur, int param, float delta) noexcept override;   // 1.12 slice 5: a relative device lane without an absolute one, same dispatch
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;

 private:
  // the sink of the device the current snapshot gives the track; nullptr when it is not an internal track
  ArrSenke* innen(int spur) const noexcept;
  // where a note for this track goes: the current sink, else the one it last played on (a note off of a track that just left)
  ArrSenke* ziel(int spur) const noexcept;
  void block_(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit* a) noexcept;   // a == nullptr: the inner sinks' block()

  const Arrangement& arr_;
  ArrSenke* rb_;
  ArrSenke* bk_;
  ArrSenke* kit_;   // 1.9: a Kit per internal track with device kit
  ArrSenke* zuletzt_[ARR_SENKEN_PLAETZE] = {};   // the sink this track was last blocked on
};

}  // namespace cdj
