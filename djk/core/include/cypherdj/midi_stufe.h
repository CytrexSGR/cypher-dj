// Strand 7 task 1.1: the MIDI stage of an instrument track (plan 2026-11-27 strang7-midi, section 3.1). One object per track sits in front of
// ArrSenke::note: the Arrangement queues every note of the track with ein() and calls lauf() once per block; the stage sends its output notes
// to the sink named with the input, in time order. Real-time code: after construction no allocation, no lock, no I/O, no exception.
// Chain (D2, task 3.1): Chord -> Scale -> Arp -> Velocity -> Chance. Chord and scale turn one input pitch into a set of output pitches; the arp
// steps over the deduplicated outputs of all held inputs; velocity and chance act per output ON (per arp step; without arp per input ON).
#pragma once

#include <cstdint>

namespace cdj {

class ArrSenke;

constexpr int MIDI_AKKORD_MAX = 6;      // added intervals per chord
constexpr int MIDI_GEHALTEN_MAX = 32;   // held inputs per track (more: counted in verloren, not held)
constexpr int MIDI_EIN_MAX = 64;        // queued input events per track between two runs
constexpr int MIDI_RASTER_MAX = 16;     // grid points handed in per run
constexpr int MIDI_SR = 48000;          // sample rate of the free arp rate (rate_hz)

enum class ArpMuster : uint8_t { up, down, updown, downup, played, random, chord };

struct ArrMidiParam {
  bool an = false;                                  // false: no stage on this track
  uint8_t akkord_n = 0; int8_t akkord[MIDI_AKKORD_MAX] = {};   // chord: semitones added to every input (the input itself stays)
  uint16_t skala_maske = 0;                         // scale: bit pc (0 = C .. 11 = B) set = in scale; 0 = no scale stage
  bool skala_lane = false;                          // slice 5: take the mask of the playback harmony lane at the event's project beat
  bool arp = false; ArpMuster muster = ArpMuster::up; bool sync = true;
  double rate_beats = 0.25;                         // sync: step length in beats
  double rate_hz = 8.0;                             // free: steps per second
  uint8_t oktaven = 1;                              // 1..4
  float gate = 0.5f;                                // 0.05..1, fraction of the step
  bool vel = false; float vel_kurve = 0.0f; uint8_t vel_zufall = 0; uint8_t vel_fest = 0;   // kurve -1..1, zufall 0..64 steps, fest 0 = keep
  uint8_t chance = 100;                             // 0..100 percent
  uint32_t saat = 0;
};

bool gleich(const ArrMidiParam& a, const ArrMidiParam& b) noexcept;   // field by field

// grid samples of this run, ascending, nr = step count since transport start. Slice 5 (task 5.2): maske = the harmony lane's mask at the project beat of each
// grid point, maske_frei = the one at the start of the run for free arp steps; both read only when ArrMidiParam::skala_lane is set (0 = use skala_maske)
struct MidiRaster {
  int n = 0;
  int64_t s[MIDI_RASTER_MAX];
  uint64_t nr[MIDI_RASTER_MAX];
  uint16_t maske[MIDI_RASTER_MAX] = {};
  uint16_t maske_frei = 0;
};

class MidiStufe {
 public:
  MidiStufe() noexcept;
  void setze_spur(int spur) noexcept;                 // the track number passed to ArrSenke::note
  // queue one input; any order between runs. schluessel: a key stable between play and render (D6), used for chance and random. maske: the scale mask
  // of this input (slice 5: the harmony lane's mask at the input's project beat), 0 = ArrMidiParam::skala_maske.
  void ein(ArrSenke* se, int64_t ziel, uint8_t ton, uint8_t vel, bool an, uint64_t schluessel, uint16_t maske = 0) noexcept;
  // apply queued inputs with ziel < bis and grid points r (all < bis) in time order; send outputs with ziel < bis; keep the rest
  void lauf(const ArrMidiParam& p, const MidiRaster& r, int64_t bis) noexcept;
  void alle_aus(int64_t s) noexcept;                  // offs for every sounding output at s; forget inputs, queue, pattern position
  void tausch(const ArrMidiParam& neu, int64_t s) noexcept;   // parameters change at s (see midi_stufe.cpp)
  bool ruhig() const noexcept;                        // nothing held, nothing queued, nothing sounding
  uint64_t ein_noten() const noexcept { return ein_noten_; }   // input ONs taken in
  uint64_t aus_noten() const noexcept { return aus_noten_; }   // output ONs sent
  uint64_t verloren() const noexcept { return verloren_; }     // input ONs dropped (queue or held set full)
  int gehalten() const noexcept { return gn_; }                // distinct held input pitches

 private:
  struct Ereignis {
    int64_t ziel;
    ArrSenke* se;
    uint64_t schluessel;
    uint64_t folge;   // arrival order, keeps the sort stable
    uint16_t maske;   // scale mask of this input, 0 = ArrMidiParam::skala_maske (slice 5 hands in the lane's mask here)
    uint8_t ton, vel;
    bool an;
  };
  struct Gehalten {
    ArrSenke* se;      // sink of the latest ON of this pitch
    uint64_t schluessel;
    uint64_t folge;    // press order (first ON of this pitch while not held)
    uint8_t ton, vel;  // vel of the latest ON
    uint8_t zahl;      // ONs of this pitch not yet ended by an OFF
    uint16_t maske;    // scale mask of the latest ON (as Ereignis::maske)
    uint64_t raus[2];  // without arp: the output pitches this input holds (bit per pitch); its OFF ends exactly those
  };
  struct Stufe {       // one entry of the expanded arp list
    uint8_t ton;
    uint8_t quelle;    // index into geh_
  };
  static constexpr int LISTE_MAX = MIDI_GEHALTEN_MAX * 4;
  static constexpr int64_t KEIN = INT64_MIN;          // no pending off / no grid point seen
  static constexpr int64_t AM_NAECHSTEN = INT64_MAX;  // pending off at the next grid point (step length not known yet)

  static constexpr int FORM_MAX = 1 + MIDI_AKKORD_MAX;   // output pitches of one input

  bool arp_an() const noexcept { return p_.an && p_.arp; }
  int forme(uint8_t ton, uint16_t maske, uint8_t* raus) const noexcept;   // chord, then scale: distinct output pitches, the input's first
  uint8_t vel_form(uint8_t vel, uint64_t schluessel) const noexcept;      // velocity stage (identity when p_.vel is off)
  bool faellt_aus(uint64_t schluessel) const noexcept;                    // chance stage: true = this ON is skipped
  void eingang_an(int i, int64_t t) noexcept;                             // pass-through: the outputs of held input i sound from t
  void eingang_aus(int i, int64_t t) noexcept;                            // the outputs input i holds end at t (shared ones when the last ends)
  void rate_folgen(const ArrMidiParam& neu) noexcept;                     // a new sync rate: step length scaled, the old grid point forgotten
  void einreihen(const Ereignis& e) noexcept;
  void anwenden(const Ereignis& e) noexcept;          // one input at its ziel
  bool halte(const Ereignis& e) noexcept;           // false: held set full (counted in verloren)
  bool lasse(uint8_t ton) noexcept;                   // false: pitch was not held
  void schritt(int64_t t, uint64_t nr, int64_t laenge, uint16_t maske) noexcept;   // maske: the lane's mask at this step (read with skala_lane)
  void spiele(int64_t t, int idx_liste, int64_t laenge, uint64_t nr) noexcept;
  void raus_an(ArrSenke* se, int64_t t, uint8_t ton, uint8_t vel) noexcept;
  void raus_aus(int64_t t, uint8_t ton) noexcept;
  void baue_liste() noexcept;
  int64_t naechstes_aus() const noexcept;             // earliest pending off with a known sample, KEIN if none
  void offene_am_raster(int64_t t) noexcept;          // offs waiting for the next grid point go out at t
  void alle_klingenden_aus(int64_t s) noexcept;

  ArrMidiParam p_{};
  int spur_ = 0;

  Ereignis q_[MIDI_EIN_MAX];   // sorted by ziel, OFF before ON at the same sample, then arrival
  int qn_ = 0;
  uint64_t folge_ = 0;

  Gehalten geh_[MIDI_GEHALTEN_MAX];   // press order
  int gn_ = 0;

  Stufe liste_[LISTE_MAX];     // expanded held set in pattern order (pattern-independent order: up, played)
  int ln_ = 0;
  bool liste_alt_ = true;

  // output bookkeeping per pitch
  ArrSenke* raus_se_[128];
  int64_t raus_an_t_[128];
  int64_t raus_aus_t_[128];    // pending off: KEIN = none (pass-through, ends with its input), AM_NAECHSTEN, or the sample
  bool klingt_[128];
  uint8_t raus_zahl_[128];     // without arp: held inputs sharing this output (0 = an arp step or a re-sent ON owned by nobody)
  int n_klingt_ = 0;
  int n_am_naechsten_ = 0;

  // arp state
  uint64_t idx_ = 0;           // pattern position of the next step
  int64_t raster_letzt_ = KEIN;   // last grid sample seen
  uint64_t raster_nr_ = 0;     // its step number
  bool raster_benutzt_ = false;   // a step fired for the last grid point
  int64_t schritt_laenge_ = 0;    // samples between two consecutive grid points, 0 = not known
  double laenge_rate_ = 0.0;      // the rate_beats schritt_laenge_ was measured at (or scaled to), 0 = none
  bool sofort_ = false;        // immediate step pending at the current sample (D5)
  int64_t sofort_t_ = 0;
  uint16_t sofort_maske_ = 0;  // slice 5: the mask of the input that started the phrase (the immediate step's mask)
  uint16_t liste_maske_ = 0;   // slice 5: with skala_lane the arp list is formed with the mask of the latest step (0 = skala_maske), not per input
  bool frei_an_ = false;       // free mode: phrase running
  int64_t frei_naechst_ = 0;
  uint64_t frei_nr_ = 0;

  uint64_t ein_noten_ = 0, aus_noten_ = 0, verloren_ = 0;
};

}  // namespace cdj
