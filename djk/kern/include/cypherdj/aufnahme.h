// 1.8 Slice 1: Modul Aufnahme im Kern-Callback. Besitzt den Transport nicht: Einsatz und Ende kommen aus der Lage des Arrangements (ArrLage).
// Zustand: 0 steht · 2 wartet auf den Einsatz · 3 nimmt auf · 4 Nachlauf. Abgriff: erz/1..3 (Codes 11..13), bitgleich, in Chunks zu 256 Frames (Teilblöcke werden gesammelt).
// Echtzeit: keine Allokation, keine Sperre. Die Abgriffsliste (rec_tap) ist der EINE Ort der internen Quellen; 1.10 (Resampling) ergänzt sie hier.
// Rein Header (CMakeLists.txt, explizite Quellenlisten mit src/kern.cpp).
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstring>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/aufnahme_ring.h"

namespace cdj {

constexpr int64_t REC_FRIST_SAMPLES = 96000;   // 2 s: Vorgabe der Frist für den Transportstart nach /k/rec/start (Feld frist_samples = 0); sie endet, sobald das Arrangement wartet
constexpr int64_t REC_FRIST_MIN = 48000, REC_FRIST_MAX = 1440000;   // 1 s bis 30 s: was der Befehl tragen darf (osc.json frist_samples)

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
  int scharf() const noexcept { int n = 0; for (RecSpur* p : spur_) n += p ? 1 : 0; return n; }
  int scharf_ohne(int spur) const noexcept { int n = 0; for (int i = 0; i < ARR_SPUREN; ++i) n += (spur_[i] && i != spur - 1) ? 1 : 0; return n; }
  int status() const noexcept { return status_; }
  uint64_t luecken() const noexcept { return luecken_; }
  int32_t kennung() const noexcept { return kennung_; }

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
    return true;
#endif
  }

  // Grund der Ablehnung oder nullptr (angenommen). frist: Samples bis zum Transportstart, 0 = Vorgabe (den Bereich prüft der Aufrufer).
  const char* starte(int64_t id, int32_t kennung, int32_t nachlauf, bool von_cypher, int64_t jetzt, const ArrLage& arr, int64_t frist = 0) noexcept {
    if (!aendern_erlaubt()) return "aufnahme_laeuft";
    if (scharf() == 0) return "kein_eingang";
    if (arr.status != 0) return "ueberlappung";
    id_ = id; kennung_ = kennung; nachlauf_ = nachlauf; von_cypher_ = von_cypher;
    frist_s_ = jetzt + (frist > 0 ? frist : REC_FRIST_SAMPLES);
    arr_gesehen_ = false; start_s_ = -1; ende_ = -1; luecken_ = 0;
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

  // Je Teilblock [s0, s0 + m). tl/tr: die drei Abgriffe erz/1..3, je m Frames ab s0 (rec_tap).
  void block(int64_t s0, int m, const ArrLage& arr, const float* const* tl, const float* const* tr) noexcept {
    if (status_ == 0) return;
    const int64_t s1 = s0 + m;
    if (status_ == 2) {
      if (arr.status == 1) arr_gesehen_ = true;
      if (arr.status == 2) {
#ifdef CYPHERDJ_MUTATION_REC_START_BLOCKANFANG
        start_s_ = s0;   // Fehlerfall: Start am Blockanfang statt am Einsatz-Sample (AK5)
#else
        start_s_ = arr.einsatz;
#endif
        for (RecSpur* p : spur_) {
          if (!p) continue;
          p->kennung = kennung_;
          p->start_s = start_s_;
          p->ende_s = -1;
          p->abgelehnt.store(0, std::memory_order_relaxed);
          p->stage.n = 0;
          p->phase.store(1, std::memory_order_release);
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
    if (ende_ < 0) {
#ifndef CYPHERDJ_MUTATION_REC_NAHT_IGNORIERT
      // Loop-Klammer (Spec 1.8 F2, Andreas „ein Durchgang“): der Take endet am ersten Wrap hinter dem Einsatz. Ohne Nachlauf: hinter der Naht klingt der
      // nächste Durchgang, kein Ausklang des Takes. Die Naht kommt im selben Callback wie der Block (arr_->block läuft vor dem Abgriff), liegt also in [s0, s1).
      if (arr.status == 2 && arr.naht >= start_s_ && arr.naht >= s0) ende_ = arr.naht;
      else
#endif
      if (arr.stopp >= 0 && arr.status == 2) ende_ = arr.stopp + nachlauf_;
      else if (arr.status != 2) ende_ = (arr.beendet >= 0 ? arr.beendet : s0) + nachlauf_;
    }
    const int64_t a = std::max(s0, start_s_), e = ende_ >= 0 ? std::min(s1, ende_) : s1;
    for (RecSpur* p : spur_) {
      if (!p || p->phase.load(std::memory_order_relaxed) != 1) continue;
      const int k = p->eingang - 11;   // rec_tap: 11..13 -> erz/1..3
      if (k < 0 || k > 2) continue;
      sammle(p, a, e, s0, tl[k], tr[k]);
    }
    if (ende_ >= 0 && s1 >= ende_) {
      for (RecSpur* p : spur_) {
        if (!p || p->phase.load(std::memory_order_relaxed) != 1) continue;
        schiebe_stage(p);   // der Rest des letzten, nicht vollen Chunks geht vor dem phase-Wechsel (release) in den Ring
        p->ende_s = ende_;
        p->phase.store(2, std::memory_order_release);
      }
      melde(AufnahmeMeldung::ENDE, id_, ende_, "");
      status_ = 0;
    } else if (ende_ >= 0 && nachlauf_ > 0 && s1 > ende_ - nachlauf_) {
      status_ = 4;   // Nachlauf: das Arrangement ist zu Ende, die Aufnahme sammelt noch nachlauf_ Samples
    }
  }

 private:
  static constexpr uint32_t MELDUNGEN = 16;
  // Sammeln statt je Teilblock einen Chunk (Nachbesserung 1, m4): Teilblöcke sind kurz (Quantum, Ereignisgrenzen); so fasst der Ring immer 512 · 256 Frames.
  void sammle(RecSpur* p, int64_t a, int64_t e, int64_t s0, const float* l, const float* r) noexcept {
    AufnahmeChunk& c = p->stage;
    for (int64_t pos = a; pos < e;) {
      if (c.n > 0 && c.s0 + c.n != pos) schiebe_stage(p);   // Sprung (kommt im Betrieb nicht vor): erst ausschieben, dann neu beginnen
      if (c.n == 0) c.s0 = pos;
      const int32_t n = static_cast<int32_t>(std::min<int64_t>(e - pos, REC_CHUNK - c.n));
      std::memcpy(c.l + c.n, l + (pos - s0), static_cast<std::size_t>(n) * sizeof(float));
      std::memcpy(c.r + c.n, r + (pos - s0), static_cast<std::size_t>(n) * sizeof(float));
      c.n += n;
      pos += n;
#ifdef CYPHERDJ_MUTATION_REC_OHNE_SAMMELN
      schiebe_stage(p);   // Fehlerfall (m4): jeder Teilblock ein eigener Chunk, der Ring fasst bei 64 Frames nur 0,68 s
#else
      if (c.n == REC_CHUNK) schiebe_stage(p);
#endif
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
  int status_ = 0;
  int64_t id_ = 0;
  int32_t kennung_ = 0, nachlauf_ = 0;
  bool von_cypher_ = false, arr_gesehen_ = false;
  int64_t frist_s_ = 0, start_s_ = -1, ende_ = -1;
  uint64_t luecken_ = 0;
  AufnahmeMeldung meldungen_[MELDUNGEN] = {};
  uint32_t meldung_gelesen_ = 0, meldung_geschrieben_ = 0;
};

}  // namespace cdj
