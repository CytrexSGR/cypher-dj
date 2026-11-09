// 1.8 Slice 1: Modul Aufnahme im Kern-Callback. Besitzt den Transport nicht: Einsatz und Ende kommen aus der Lage des Arrangements (ArrLage).
// Zustand: 0 steht · 2 wartet auf den Einsatz · 3 nimmt auf · 4 Nachlauf. Abgriff: erz/1..3, erz/5..7, pad/1..2 (Codes siehe REC_CODES), bitgleich, in Chunks zu 256 Frames (Teilblöcke werden gesammelt).
// Echtzeit: keine Allokation, keine Sperre. Die Abgriffsliste (rec_tap) ist der EINE Ort der internen Quellen; 1.10 (Resampling) ergänzt sie hier.
// Rein Header (CMakeLists.txt, explizite Quellenlisten mit src/core.cpp).
#pragma once

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>

#include "cypherdj/arr_playback.h"
#include "cypherdj/recording_ring.h"
#include "cypherdj/input.h"

namespace cdj {

constexpr int64_t REC_FRIST_SAMPLES = 96000;   // 2 s: Vorgabe der Frist für den Transportstart nach /k/rec/start (Feld frist_samples = 0); sie endet, sobald das Arrangement wartet
constexpr int64_t REC_FRIST_MIN = 48000, REC_FRIST_MAX = 1440000;   // 1 s bis 30 s: was der Befehl tragen darf (osc.json frist_samples)

// S18: the internal tap list. Recording input codes (contract osc.json /k/rec/spur eingang): 11..13 = erz/1..3,
// 15..17 = erz/5..7, 21, 22 = pad/1, pad/2 (rule: erz/N -> 10 + N, pad/N -> 20 + N). 14 (erz/4, production) and 18
// (erz/8, cue) are not taps. A tap slot is the index of the code in REC_CODES (0..7); the table also lives in
// djk/contract/streams.ts (REC_EINGANG), pinned by djk/contract/tests/test_stroeme_tabelle.py.
constexpr int REC_ABGRIFFE = 8;
constexpr int REC_CODES[REC_ABGRIFFE] = {11, 12, 13, 15, 16, 17, 21, 22};
constexpr int REC_MIXER[REC_ABGRIFFE] = {4, 5, 6, 8, 9, 10, 12, 13};   // Mixer index of each code (mixer.h: erz/1..8 = 4..11, pad/1..2 = 12, 13)
constexpr int rec_abgriff_slot(int code) {
  for (int i = 0; i < REC_ABGRIFFE; ++i)
    if (REC_CODES[i] == code) return i;
  return -1;
}
constexpr int rec_mixer_index(int code) {
  const int s = rec_abgriff_slot(code);
  return s < 0 ? -1 : REC_MIXER[s];
}

// 1.8 S2a: the external taps. Recording input codes 1..4 = ein_1..4 (a pair of JACK ports, EingangsBank); the callback hands the pointers of the
// pair, already offset to the sub-block, to Aufnahme::block (el/er[paar - 1]); nullptr = no port = silence.
constexpr int REC_EXTERN = EIN_PAARE;
constexpr bool rec_extern(int code) { return code >= 1 && code <= REC_EXTERN; }

struct ArrLage {
  int status;       // ArrStatus: 0 steht, 1 wartet, 2 spielt, 3 freeze
  int64_t einsatz;  // Einsatz-Sample (arrangement.h einsatz_sample)
  int64_t beendet;  // Ende des letzten Laufs, −1
  int64_t stopp;    // geplanter Stopp, −1
  int64_t naht = -1;   // Kern-Sample des letzten Loop-Wraps (arrangement.h letzte_naht), −1: keiner; zählt nur, wenn es hinter dem Einsatz liegt (ein Wrap eines früheren Laufs bleibt stehen)
};

struct AufnahmeMeldung {
  enum Art : int { EINSATZ = 2, ENDE = 3, ABBRUCH = 7 };
  int art;
  int64_t id;
  int64_t sample;
  char grund[16];
};

class Aufnahme {
 public:
  // Slot nach Spur (1..ARR_SPUREN). Rückgabe: der bisherige RecSpur (zur Freigabe im Netz-Faden). neu = nullptr entschärft.
  RecSpur* setze(int spur, RecSpur* neu) noexcept {
    if (spur < 1 || spur > ARR_SPUREN) return neu;
    RecSpur* alt = spur_[spur - 1];
    spur_[spur - 1] = neu;
    return alt;
  }
  const RecSpur* spur(int spur) const noexcept { return spur < 1 || spur > ARR_SPUREN ? nullptr : spur_[spur - 1]; }   // read-only access to the armed track (S3: in-place monitor rule, monitor feed)
  int scharf() const noexcept { int n = 0; for (RecSpur* p : spur_) n += p ? 1 : 0; return n; }
  // 1.8 T7a (eingang 30, midi_ein_1): one bit per instrument track (bit = nr - 1), one RecMidi for all of them. A MIDI arm does not count against REC_MAX_ARM and is
  // not in scharf() (audio only). an: the first RecMidi that comes is adopted (nullptr back), a further one is returned to the caller (to hand back to the net thread);
  // the arm only takes when a RecMidi exists. !an: clears the bit; the adopted RecMidi is returned when the last bit goes. Out of range: neu comes back.
  // Callers check aendern_erlaubt() first (the take of a run in progress is not touched).
  RecMidi* setze_midi(int spur, bool an, RecMidi* neu) noexcept {
    if (spur < 1 || spur > ARR_SPUREN) return neu;
    const uint32_t bit = 1u << (spur - 1);
    if (an) {
      RecMidi* zurueck = neu;
      if (!midi_ && neu) { midi_ = neu; zurueck = nullptr; }
      if (midi_) midi_scharf_ |= bit;
      return zurueck;
    }
    midi_scharf_ &= ~bit;
    if (midi_scharf_ != 0 || !midi_) return nullptr;
    RecMidi* alt = midi_;
    midi_ = nullptr;
    return alt;
  }
  uint32_t midi_maske() const noexcept { return midi_scharf_; }
  int midi_scharf() const noexcept { return __builtin_popcount(midi_scharf_); }
  const RecMidi* midi_spur() const noexcept { return midi_; }
  int scharf_ohne(int spur) const noexcept { int n = 0; for (int i = 0; i < ARR_SPUREN; ++i) n += (spur_[i] && i != spur - 1) ? 1 : 0; return n; }
  int status() const noexcept { return status_; }
  uint64_t luecken() const noexcept { return luecken_; }
  int32_t kennung() const noexcept { return kennung_; }
  int vorzaehler() const noexcept { return vorzaehler_; }   // 1.8 S4a: count-in bars of the run that waits (the transport start that follows uses 4 * this many beats)

  // Spuren dürfen nur wechseln und ein Take nur beginnen, wenn keiner läuft UND der Faden den letzten geschlossen hat (phase 0 oder 3): sonst ginge eine offene
  // Datei still verloren (Nachbesserung 1, m1; der Fehlerfall liegt zwischen dem Ende im Callback, phase 2, und dem Schließen im Faden).
  bool aendern_erlaubt() const noexcept {
#ifdef CYPHERDJ_MUTATION_REC_AENDERN_NUR_STATUS
    return status_ == 0;   // Fehlerfall (m1): nur der Zustand des Callbacks, nicht der des Fadens
#else
    if (status_ != 0) return false;
    for (RecSpur* p : spur_) {
      if (!p) continue;
      const int ph = p->phase.load(std::memory_order_acquire);
      if (ph == 1 || ph == 2) return false;
    }
    if (midi_) {   // the MIDI take closes like an audio take: not before the thread has
      const int ph = midi_->phase.load(std::memory_order_acquire);
      if (ph == 1 || ph == 2) return false;
    }
    return true;
#endif
  }

  // Grund der Ablehnung oder nullptr (angenommen). frist: Samples bis zum Transportstart, 0 = Vorgabe (den Bereich prüft der Aufrufer).
  // 1.8 S4a.3 (D8): ab_sample >= 0 with a RUNNING transport (arr.status 2): the take begins at that Kern sample (the next bar, or the seam), the transport is not touched;
  // without ab_sample a running transport stays ueberlappung. With a stopped transport ab_sample is ignored (the slice 1 path). vorzaehler_takte: the count-in of this
  // run in bars (0, 1, 2, 4), read by the core for the transport start that follows (vorzaehler()).
  const char* starte(int64_t id, int32_t kennung, int32_t nachlauf, bool von_cypher, int64_t jetzt, const ArrLage& arr, int64_t frist = 0, int64_t ab_sample = -1,
                     int vorzaehler_takte = 0) noexcept {
    if (!aendern_erlaubt()) return "aufnahme_laeuft";
    if (scharf() == 0 && midi_scharf_ == 0) return "kein_eingang";   // 1.8 T7a: a MIDI arm alone is a run (instrument-only), nothing armed at all is not
    const bool laufend = arr.status == 2 && ab_sample >= 0;
    if (arr.status != 0 && !laufend) return "ueberlappung";
    if (laufend && arr.stopp >= 0 && ab_sample >= arr.stopp) return "ueberlappung";   // the transport is planned to stop before the take could begin
    id_ = id; kennung_ = kennung; nachlauf_ = nachlauf; von_cypher_ = von_cypher;
    frist_s_ = jetzt + (frist > 0 ? frist : REC_FRIST_SAMPLES);
    arr_gesehen_ = false; start_s_ = -1; ende_ = -1; luecken_ = 0;
    ab_s_ = laufend ? ab_sample : -1;
    vorzaehler_ = vorzaehler_takte;
    status_ = 2;
    return nullptr;
  }
  void stopp(int64_t jetzt) noexcept {   // /k/rec/stopp
    if (status_ == 2) abbrechen("abbruch");
    else if (status_ == 3 && ende_ < 0) ende_ = jetzt + nachlauf_;
  }
  void ki_stopp(int64_t jetzt) noexcept {   // Stop Cypher: nur Cyphers wartender Start endet; ein laufender Take läuft zu Ende
    (void)jetzt;
    if (status_ == 2 && von_cypher_) abbrechen("ki_stopp");
  }
  bool hole_meldung(AufnahmeMeldung& m) noexcept {
    if (meldung_gelesen_ == meldung_geschrieben_) return false;
    m = meldungen_[meldung_gelesen_++ % MELDUNGEN];
    return true;
  }

  // 1.8 T7a, MIDI of this cycle. The core stamps first (Kern::midi_ein_stempeln, before arr_->block and before block() of the cycle), so the status of the run and the
  // window of the take are not known yet: midi_beginn() empties the cycle buffer at the top of the stamping, midi() collects note on/off and control change (3 bytes,
  // any channel) while a run waits or takes, block() hands the events of its sub-block range [a, e) to the ring, once the take has begun and before it ends.
  // Nothing here touches a sink: live notes are the second commit and run on the caller before arr_->block like noten_block (ledger T7a).
  void midi_beginn() noexcept { vor_n_ = 0; }
  void midi(int64_t sample, const uint8_t* d, int n) noexcept {
    if (!midi_ || n != 3) return;
    const uint8_t t = d[0] & 0xF0;
    if (t != 0x80 && t != 0x90 && t != 0xB0) return;
    if (status_ != 2 && status_ != 3 && status_ != 4) return;
    if (vor_n_ >= MIDI_VOR) {
      if (status_ >= 3) midi_->abgelehnt.fetch_add(1, std::memory_order_relaxed);
      return;
    }
    MidiEinEreignis& e = vor_[vor_n_++];
    e = MidiEinEreignis{};
    e.sample = sample;
    e.b[0] = d[0]; e.b[1] = d[1]; e.b[2] = d[2];
    e.n = 3;
  }

  // Je Teilblock [s0, s0 + m). tl/tr: the internal taps (one entry per code of REC_CODES), m frames from s0 (rec_tap). el/er: the external pairs
  // ein_1..4 (index paar - 1), m frames from s0, nullptr entry = silence; nullptr arrays = no external port at all (slice 1 callers).
  void block(int64_t s0, int m, const ArrLage& arr, const float* const* tl, const float* const* tr, const float* const* el = nullptr,
             const float* const* er = nullptr) noexcept {
#ifdef CYPHERDJ_MUTATION_REC_ALLOC_IM_BLOCK
    {   // mutation (S2a.5, positive control of the allocation guard test_kern_rec_alloc): one allocation per sub-block
      volatile char* v = new char[1];
      v[0] = 1;
      delete[] v;
    }
#endif
    if (status_ == 0) return;
    const int64_t s1 = s0 + m;
    if (status_ == 2) {
      if (arr.status == 1) arr_gesehen_ = true;
      if (ab_s_ >= 0) {   // 1.8 S4a.3 (D8): waiting for the bar (or the seam) inside a running transport
        if (arr.status != 2) {   // the transport stopped (or restarted) before the take began
          abbrechen("abbruch");
          return;
        }
        if (s1 <= ab_s_) return;
      }
      if (arr.status == 2) {
        if (ab_s_ >= 0) {
#ifdef CYPHERDJ_MUTATION_REC_LAUFEND_BLOCKANFANG
          start_s_ = s0;   // mutation (S4a.3): the take begins at the block start, not on the bar
#else
          start_s_ = std::max(ab_s_, s0);   // never before the sub-block that holds it (the core asks for a bar at least one cycle ahead)
#endif
        } else {
#ifdef CYPHERDJ_MUTATION_REC_START_BLOCKANFANG
        start_s_ = s0;   // Fehlerfall: Start am Blockanfang statt am Einsatz-Sample (AK5)
#else
        start_s_ = arr.einsatz;
#endif
        }
        ab_s_ = -1;
        for (RecSpur* p : spur_) {
          if (!p) continue;
          p->kennung = kennung_;
          p->start_s = start_s_;
          p->ende_s = -1;
          p->abgelehnt.store(0, std::memory_order_relaxed);
          p->stage.n = 0;
          p->phase.store(1, std::memory_order_release);
        }
        if (midi_) {   // 1.8 T7a: the MIDI take of the run begins on the same sample as the audio takes
          midi_->kennung = kennung_;
          midi_->start_s = start_s_;
          midi_->ende_s = -1;
          midi_->abgelehnt.store(0, std::memory_order_relaxed);
          midi_->phase.store(1, std::memory_order_release);
        }
        status_ = 3;
        melde(AufnahmeMeldung::EINSATZ, id_, start_s_, "");
#ifdef CYPHERDJ_MUTATION_REC_FRIST_IMMER
      } else if ((arr_gesehen_ && arr.status == 0) || s1 > frist_s_) {   // Fehlerfall (M1): die Frist gilt auch, während das Arrangement wartet
#else
      } else if ((arr_gesehen_ && arr.status == 0) || (s1 > frist_s_ && !arr_gesehen_)) {   // die Frist gilt nur, bis das Arrangement wartet (Quant)
#endif
        abbrechen(arr_gesehen_ ? "abbruch" : "zu_spaet");
        return;
      } else {
        return;
      }
    }
    // nimmt auf
#ifdef REC_KOSTEN_AUFSCHLAG
    {   // 1.8 T11 positive control of the cost gate (never in a product build): a busy wait of 150 us on the steady clock per sub-block of a take
      const auto bis = std::chrono::steady_clock::now() + std::chrono::microseconds(150);
      while (std::chrono::steady_clock::now() < bis) {}
    }
#endif
    if (ende_ < 0) {
#ifndef CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT
      // Loop-Klammer (Spec 1.8 F2, Andreas „ein Durchgang“): der Take endet am ersten Wrap hinter dem Einsatz. Ohne Nachlauf: hinter der Naht klingt der
      // nächste Durchgang, kein Ausklang des Takes. Mit Nachlauf (S2a, D10: externe Eingänge) läuft der Take nachlauf_ Samples über die Naht hinaus. Die Naht kommt im selben Callback wie der Block (arr_->block läuft vor dem Abgriff), liegt also in [s0, s1).
#ifdef CYPHERDJ_MUTATION_REC_NAHT_GLEICH_BEENDET
      if (arr.status == 2 && arr.naht >= start_s_ && arr.naht >= s0) {   // mutation (S4a.3): the seam the take began on ends it at once
#else
      if (arr.status == 2 && arr.naht > start_s_ && arr.naht >= s0) {   // S4a.3: a seam ON the start sample is the one the take began on (D8), it does not end it
#endif
#ifdef CYPHERDJ_MUTATION_REC_NAHT_OHNE_NACHLAUF
        ende_ = arr.naht;   // mutation (S2a.4): the seam ends the take, the tail is ignored
#else
        ende_ = arr.naht + nachlauf_;   // S2a.4 (D10): the tail runs past the seam; 0 = exactly at the seam
#endif
      }
      else
#endif
      if (arr.stopp >= 0 && arr.status == 2) ende_ = arr.stopp + nachlauf_;
      else if (arr.status != 2) ende_ = (arr.beendet >= 0 ? arr.beendet : s0) + nachlauf_;
    }
    const int64_t a = std::max(s0, start_s_), e = ende_ >= 0 ? std::min(s1, ende_) : s1;
    midi_schreiben(a, e);   // 1.8 T7a: the events of this cycle inside [a, e), before the end below sets phase 2
    for (RecSpur* p : spur_) {
      if (!p || p->phase.load(std::memory_order_relaxed) != 1) continue;
      if (rec_extern(p->eingang)) {   // S2a: a pair of external ports in the channel mode of the track
#ifdef CYPHERDJ_MUTATION_REC_EIN_PAAR_VERSETZT
        const int q = p->eingang % REC_EXTERN;   // mutation: pair k reads pair k + 1 (4 wraps to 1)
#else
        const int q = p->eingang - 1;
#endif
        sammle(p, a, e, s0, el ? el[q] : nullptr, er ? er[q] : nullptr, p->modus);
        continue;
      }
#ifdef CYPHERDJ_MUTATION_REC_ERZ6_ALS_5
      const int k = rec_abgriff_slot(p->eingang == 16 ? 15 : p->eingang);   // mutation: erz/6 (16) reads the tap of erz/5 (15)
#else
      const int k = rec_abgriff_slot(p->eingang);   // rec_tap: slot of the code in REC_CODES (S18: erz/1..3, 5..7, pad/1..2)
#endif
      if (k < 0) continue;
      sammle(p, a, e, s0, tl[k], tr[k], 0);
    }
    if (ende_ >= 0 && s1 >= ende_) {
      for (RecSpur* p : spur_) {
        if (!p || p->phase.load(std::memory_order_relaxed) != 1) continue;
        schiebe_stage(p);   // der Rest des letzten, nicht vollen Chunks geht vor dem phase-Wechsel (release) in den Ring
        p->ende_s = ende_;
        p->phase.store(2, std::memory_order_release);
      }
      if (midi_ && midi_->phase.load(std::memory_order_relaxed) == 1) {   // 1.8 T7a: every event of the window is in the ring before the phase change (release)
        midi_->ende_s = ende_;
        midi_->phase.store(2, std::memory_order_release);
      }
      melde(AufnahmeMeldung::ENDE, id_, ende_, "");
      status_ = 0;
    } else if (ende_ >= 0 && nachlauf_ > 0 && s1 > ende_ - nachlauf_) {
      status_ = 4;   // Nachlauf: das Arrangement ist zu Ende, die Aufnahme sammelt noch nachlauf_ Samples
    }
  }

 private:
  static constexpr uint32_t MELDUNGEN = 16;
  static constexpr float STILLE[REC_CHUNK] = {};
  // Sammeln statt je Teilblock einen Chunk (Nachbesserung 1, m4): Teilblöcke sind kurz (Quantum, Ereignisgrenzen); so fasst der Ring immer 512 · 256 Frames.
  // l/r: the source from s0 (nullptr = silence). modus (D14, only the external pairs pass anything but 0): 0 stereo, 1 links (L to both), 2 rechts (R to
  // both), 3 summe (0.5 * (L + R) to both). One loop per mode, no branch per sample.
  void sammle(RecSpur* p, int64_t a, int64_t e, int64_t s0, const float* l, const float* r, int modus) noexcept {
    AufnahmeChunk& c = p->stage;
    for (int64_t pos = a; pos < e;) {
      if (c.n > 0 && c.s0 + c.n != pos) schiebe_stage(p);   // Sprung (kommt im Betrieb nicht vor): erst ausschieben, dann neu beginnen
      if (c.n == 0) c.s0 = pos;
      const int32_t n = static_cast<int32_t>(std::min<int64_t>(e - pos, REC_CHUNK - c.n));
      const std::size_t nb = static_cast<std::size_t>(n) * sizeof(float);
      const float* ls = l ? l + (pos - s0) : STILLE;   // silence is read from a zero block of one chunk (n <= REC_CHUNK)
      const float* rs = r ? r + (pos - s0) : STILLE;
      float* cl = c.l + c.n;
      float* cr = c.r + c.n;
      switch (modus) {
        case 1: std::memcpy(cl, ls, nb); std::memcpy(cr, ls, nb); break;
        case 2: std::memcpy(cl, rs, nb); std::memcpy(cr, rs, nb); break;
        case 3:
          for (int32_t i = 0; i < n; ++i) {
#ifdef CYPHERDJ_MUTATION_REC_SUMME_OHNE_HALB
            const float v = ls[i] + rs[i];   // mutation: the sum without the 0.5
#else
            const float v = (ls[i] + rs[i]) * 0.5f;
#endif
            cl[i] = v;
            cr[i] = v;
          }
          break;
        default: std::memcpy(cl, ls, nb); std::memcpy(cr, rs, nb); break;
      }
      c.n += n;
      pos += n;
#ifdef CYPHERDJ_MUTATION_REC_OHNE_SAMMELN
      schiebe_stage(p);   // Fehlerfall (m4): jeder Teilblock ein eigener Chunk, der Ring fasst bei 64 Frames nur 0,68 s
#else
      if (c.n == REC_CHUNK) schiebe_stage(p);
#endif
    }
  }
  void midi_schreiben(int64_t a, int64_t e) noexcept {
    if (!midi_ || a >= e || midi_->phase.load(std::memory_order_relaxed) != 1) return;
    for (int i = 0; i < vor_n_; ++i) {
      const MidiEinEreignis& ev = vor_[i];
      if (ev.sample < a || ev.sample >= e) continue;
      if (!midi_->ring.schiebe(ev)) midi_->abgelehnt.fetch_add(1, std::memory_order_relaxed);
    }
  }
  void schiebe_stage(RecSpur* p) noexcept {
    AufnahmeChunk& c = p->stage;
    if (c.n == 0) return;
    c.pad = 0;
    if (!p->ring.schiebe(c)) { p->abgelehnt.fetch_add(1, std::memory_order_relaxed); ++luecken_; }
    c.n = 0;
  }
  void abbrechen(const char* grund) noexcept {
    melde(AufnahmeMeldung::ABBRUCH, id_, 0, grund);
    status_ = 0;
  }
  void melde(int art, int64_t id, int64_t sample, const char* grund) noexcept {
    AufnahmeMeldung& m = meldungen_[meldung_geschrieben_ % MELDUNGEN];
    m.art = art; m.id = id; m.sample = sample;
    std::memset(m.grund, 0, sizeof m.grund);
    std::strncpy(m.grund, grund, sizeof m.grund - 1);
    ++meldung_geschrieben_;
  }
  RecSpur* spur_[ARR_SPUREN] = {};
  static constexpr int MIDI_VOR = 256;   // events of ONE cycle (Kern::MAX_MIDI), a take can only use what the cycle brought
  RecMidi* midi_ = nullptr;              // 1.8 T7a: set iff midi_scharf_ != 0
  uint32_t midi_scharf_ = 0;             // bit = track nr - 1 (eingang 30)
  MidiEinEreignis vor_[MIDI_VOR] = {};
  int vor_n_ = 0;
  int status_ = 0;
  int64_t id_ = 0;
  int32_t kennung_ = 0, nachlauf_ = 0;
  bool von_cypher_ = false, arr_gesehen_ = false;
  int64_t frist_s_ = 0, start_s_ = -1, ende_ = -1;
  int64_t ab_s_ = -1;   // 1.8 S4a.3 (D8): the Kern sample the take begins at inside a running transport, -1: the slice 1 path (the einsatz of the arrangement)
  int vorzaehler_ = 0;  // 1.8 S4a: count-in bars of the current run
  uint64_t luecken_ = 0;
  AufnahmeMeldung meldungen_[MELDUNGEN] = {};
  uint32_t meldung_gelesen_ = 0, meldung_geschrieben_ = 0;
};

}  // namespace cdj
