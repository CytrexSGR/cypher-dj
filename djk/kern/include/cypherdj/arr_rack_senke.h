// Package 1.9 U6 (spec E9 to E11): the instrument rack as the sink of the rack tracks of the arrangement (ArrArt::rack). One track holds up to
// ARR_RACK_GLIEDER members; each member is a device (RB-338, Baukasten graph, kit, or a Surge slot) with a key zone, a velocity zone, a chain
// range and a gain. This sink routes the notes of the track to the members and adds their outputs into the track input.
//   Routing: a note on goes to every member whose key zone, velocity zone and chain range (ArrSpur::kette of the current snapshot) contain it.
//     All bounds are inclusive. The sink remembers per member the set of notes it holds (128 bits); a note off goes to exactly the members that got the
//     note on, whatever the snapshot says by then (a chain change or a swap does not strand a note). All-notes-off and a transport start reach every member.
//   Members: the internal members (RB-338, bk, kit) are played by the existing sinks through the dispatcher (ArrInternSenke) under their member slot
//     (ARR_SPUREN..ARR_SENKEN_PLAETZE - 1), so a member behaves exactly like a track on its device. A Surge member is played by the Wirt sink of its slot.
//   Time: the Wirt sink needs its notes one round trip early (vorhalt), the internal sinks at the sample. vorhalt() of this sink is the Wirt lead
//     when the snapshot holds a Surge member (ArrSnapshot::rack_wirt), else 0. The events of internal members are held in a fixed queue per track and
//     handed to their sink in the block that holds their target sample, so both kinds of member sound at the same sample at the track bus.
//   Sum: every member is rendered into scratch buffers and added with its gain. A gain that differs from the one of the block before ramps linearly over
//     the block (no step); the first block of a member and an unchanged gain multiply exactly (1.0 is exact).
//   Members that leave (removed from the rack, the track is no longer a rack): the dispatcher fades the internal device for one block, a Surge member gets
//     spur_weg on its slot unless another member or track still plays it.
// Real-time: apart from the constructor no allocation, no lock, no I/O.
#pragma once

#include <cstdint>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/arrangement.h"

namespace cdj {

constexpr int ARR_RACK_WARTE = 256;   // queued events of internal members per rack track until their block

class ArrRackSenke final : public ArrSenke {
 public:
  // intern: the dispatcher that plays the internal members by member slot (ArrInternSenke); wirt: the Wirt sinks of slots 1 and 2 (may be nullptr)
  ArrRackSenke(const Arrangement& arr, ArrSenke* intern, ArrSenke* wirt1, ArrSenke* wirt2) : arr_(arr), intern_(intern) {
    wirt_[0] = wirt1;
    wirt_[1] = wirt2;
  }
  ArrRackSenke(const ArrRackSenke&) = delete;
  ArrRackSenke& operator=(const ArrRackSenke&) = delete;

  int64_t vorhalt() const noexcept override;
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // true: the track still has members to fade out

  uint64_t verloren() const { return verloren_; }   // events over ARR_RACK_WARTE or members over the record places (counted, not reported)
  int glieder(int spur) const;                      // members of the track the sink holds a record of (cost lane self-check)
  uint64_t an(int platz) const { return platz >= ARR_SPUREN && platz < ARR_SENKEN_PLAETZE ? an_[platz - ARR_SPUREN] : 0; }   // note ons routed to a member slot (self-check)

 private:
  static constexpr int REC = 2 * ARR_RACK_GLIEDER;   // records per track: the current members and the ones that left and still fade
  struct Ev {
    int64_t ziel;
    int16_t platz;   // member slot of an internal member
    uint8_t art;     // 0 note on, 1 note off, 2 all off
    uint8_t ton, vel;
  };
  // what the sink knows of one member of a track: its identity (kind, member slot, Surge slot), the notes it holds and the gain it played last
  struct Rec {
    int8_t art = 0;   // 0 free, 1 internal, 2 Surge
    int16_t platz = 0;
    int8_t slot = 0;
    uint64_t klingt[2] = {0, 0};   // 128 bits, bit = note number
    float gain = 1.0f;             // the gain of the last block
    bool gain_da = false;          // false: first block of the member, no ramp
    bool aktuell = false;          // scratch of block(): the member is in the current snapshot
  };
  struct Spur {
    Ev ev[ARR_RACK_WARTE];
    int n = 0;
    Rec rec[REC];
    bool weg = false;   // the track left the sink: the next block fades all members
  };
  Rec* rec_fuer(Spur& p, const ArrGlied& g) noexcept;   // the record of a member (made when new); nullptr: no place
  void sende(Spur& p, int spur, const Rec& r, int64_t ziel, uint8_t ton, uint8_t vel, uint8_t art) noexcept;   // an event to a member
  void faelliges_weitergeben(Spur& p, int64_t bis) noexcept;                                                    // queued events with a target before bis
  bool slot_gespielt(const ArrSnapshot* snap, int slot, int ohne_spur) const noexcept;

  const Arrangement& arr_;
  ArrSenke* intern_;
  ArrSenke* wirt_[ARR_WIRT_SLOTS] = {};
  Spur sp_[ARR_SPUREN];
  uint64_t verloren_ = 0;
  uint64_t an_[ARR_GLIED_PLAETZE] = {};
  float sl_[ARR_BLOCK] = {};
  float sr_[ARR_BLOCK] = {};
};

}  // namespace cdj
