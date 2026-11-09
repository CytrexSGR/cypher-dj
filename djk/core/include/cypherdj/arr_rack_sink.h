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
//   Lane unit (mehrkern slice 3): a rack track with ALL its member slots is one unit of phase Q, so racks spread over the Hall pool workers. block_bahn() is block() with
//     the member scratch and the member sinks' scratch taken from the lane struct (ArrArbeit::rack_l/r, and rb_l/kit_l through the dispatcher). parallel_faehig() says yes
//     only when the unit touches nothing but its own track: every member internal and lane-capable (a Surge or bk member keeps the whole rack serial), no record of a
//     Surge member, the track not leaving, AND the whole sink clean (sauber_): no record and no queued event of any track points at a member slot that is not a current
//     member of the same track. A swap renumbers the member slots (slot = ARR_SPUREN + running count over the racks of the snapshot), so until the next block() of a track
//     a stale record or a queued note off of rack A can name the slot of rack B; run on A's lane it would write into B's sink slot while B's unit renders it. That one block
//     runs serial, the plan is rebuilt after it. The scan reads the state of every rack: it must run when no lane unit runs (plan build, and Arrangement::spur_nach_join on the
//     caller after the join), never in the serial remainder that overlaps the workers.
// Real-time: apart from the constructor no allocation, no lock, no I/O.
#pragma once

#include <cstdint>

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/arrangement.h"

namespace cdj {

constexpr int ARR_RACK_WARTE = 256;   // queued events of internal members per rack track until their block
constexpr int ARR_RACK_ABGANG_EINZELN = 32;   // a leaving member that holds more keys than this gets one all-off instead of one off per key (the sink queues hold 256)

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
  void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept override;
  // 1.9 U8 T9 (E12): a macro target on member `glied` of the rack track `spur`: param 0..3 the RB-338 parameters and 8..15 the Baukasten knobs go to the sink of the member's device
  // through the dispatcher (auto_parameter on the member slot; a parameter that does not belong to the device of the member is ignored), 16 is the member's gain in dB, used instead of
  // the gain of the snapshot for the next block(), ramped over that block like any gain change. Caller thread, before phase Q, once per block and target (see Arrangement::glied_makros_);
  // a value that is not reported in a block is not applied: the member's own value is back in that block.
  void glied_parameter(int spur, int glied, int param, float wert) noexcept override;
  bool vor_phase(int64_t s0) noexcept override;   // caller, before phase Q: abgaenge() of a new snapshot (it touches other racks' state, so never inside a lane unit)
  bool parallel_faehig(int spur) const noexcept override;   // see above; reads the state of all racks: call it only while no lane unit runs
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // true: the track still has members to fade out

  uint64_t verloren() const { return verloren_.wert(); }   // events over ARR_RACK_WARTE or members over the record places (counted, not reported)
  int glieder(int spur) const;                      // members of the track the sink holds a record of (cost lane self-check)
  uint64_t an(int platz) const { return platz >= ARR_SPUREN && platz < ARR_SENKEN_PLAETZE ? an_[platz - ARR_SPUREN] : 0; }   // note ons routed to a member slot (self-check)

 private:
  static constexpr int REC = 2 * ARR_RACK_GLIEDER;   // records per track: the current members and the ones that left and still fade
  struct Ev {
    int64_t ziel;
    int16_t platz;   // member slot of an internal member
    uint8_t art;     // 0 note on, 1 note off, 2 all off
    uint8_t ton, vel;
    uint64_t gen;   // the generation of the snapshot (Arrangement::snapshot_generation) that was current when the event was queued, and whether its member was a
    bool neu;       // member of it: an event of an older snapshot, or of a member that had left, belongs to the old owner of the slot, not to the one that holds it now
  };
  // what the sink knows of one member of a track: its identity (kind, member slot, Surge slot), the notes it holds and the gain it played last
  struct Rec {
    int8_t art = 0;   // 0 free, 1 internal, 2 Surge
    int16_t platz = 0;
    int8_t slot = 0;
    uint64_t id = 0;   // the id of the member (ArrGlied::id): the same member keeps it when its slot number changes
    bool kit = false;   // internal member whose device is a kit (refreshed every block): the kit sink ignores note offs, its one-shots end only by an all-off
    uint64_t klingt[2] = {0, 0};   // 128 bits, bit = note number: the notes the member holds (set when the note on is queued, cleared when the off is queued)
    uint64_t geliefert[2] = {0, 0};   // internal member: the notes whose on has reached the sink and whose off has not (what the sink really holds on the slot)
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
  // First block of a new snapshot: members that left and whose slot number another member took over (the sinks keep their voices per slot) end their
  // notes on the old slot before anything of the new owner reaches it (a kit member also gets an all-off, whatever number of keys it holds: the kit sink
  // ignores offs and would let the one-shots ring into the bus of the new owner); a member that went on under another slot number takes its queued events
  // along, also when its old slot is owned by nobody now; a Surge member whose member slot changed hands its notes to its successor.
  void abgaenge(const ArrSnapshot* snap, int64_t s0) noexcept;
  void block_(int spur, int64_t s0, int m, float* l, float* r, float* sl, float* sr, ArrArbeit* a) noexcept;   // a == nullptr: the inner sinks' block()
  bool abgaenge_faellig_() const noexcept;   // a snapshot generation abgaenge() has not run for yet
  bool sauber_(const ArrSnapshot* snap) const noexcept;   // no record and no queued event of any track names a member slot that is not a current member of that track
  bool aktuell_in(const ArrSpur* sp, const Rec& x) const noexcept;   // does a member of the track's snapshot entry have the identity of the record?

  const Arrangement& arr_;
  ArrSenke* intern_;
  ArrSenke* wirt_[ARR_WIRT_SLOTS] = {};
  Spur sp_[ARR_SPUREN];
  ArrZaehler verloren_;   // bumped from block() (rec_fuer) inside lane units: relaxed atomic
  uint64_t gesehen_ = 0;   // the generation of the snapshot abgaenge() last ran for (not its address: a freed snapshot's address can come back)
#ifdef CYPHERDJ_MUTATION_ARR_RACK_SNAP_ZEIGER
  const ArrSnapshot* gesehen_zeiger_ = nullptr;   // error case: the snapshot is told by its address
#endif
  uint64_t an_[ARR_GLIED_PLAETZE] = {};
  // gain targets of this block (glied_parameter on the caller, read and cleared by block_ of the same track inside its own unit): linear gain per member
  float gain_ueber_[ARR_SPUREN][ARR_RACK_GLIEDER] = {};
  bool gain_ueber_da_[ARR_SPUREN][ARR_RACK_GLIEDER] = {};
  float sl_[ARR_BLOCK] = {};
  float sr_[ARR_BLOCK] = {};
};

}  // namespace cdj
