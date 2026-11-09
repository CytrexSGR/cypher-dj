// 1.8 Slice 1: Aufnahme-Faden (nicht Echtzeit, normale Priorität, wie der Lade-Faden). Leert alle 10 ms die Ringe der angemeldeten RecSpur in die
// Take-Dateien <ordner>/aufnahme-<spur>-<kennung>.f32 (+ .json), schließt bei phase 2 (fsync) und meldet jeden Take genau einmal (hole_meldung -> /e/aufnahme).
#pragma once

#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/recording_ring.h"
#include "cypherdj/spsc_ring.h"
#include "cypherdj/take_writer.h"

namespace cdj {

struct TakeMeldung {
  int32_t spur, kennung, status;   // status 0 ok, 1 Lücken, 2 abgebrochen (reserviert, wird nie gesendet: abbrechen() meldet nicht), 3 kein_platz
  int64_t frames, start_s;
  int32_t luecken;
  int32_t art = 0;   // 1.8 T7a: 0 audio, 1 midi (spur 0, frames = event count, luecken = refused events)
};

class AufnahmeFaden {
 public:
  explicit AufnahmeFaden(std::string ordner);
  ~AufnahmeFaden();
  void anmelden(RecSpur* p);    // Netz-Faden: vor dem Befehl REC_SPUR
  void abmelden(RecSpur* p);    // Netz-Faden: bevor er den RecSpur freigibt
  void anmelden_midi(RecMidi* p);   // 1.8 T7a: the same for the MIDI recorder (one per run, midi-<kennung>.bin)
  void abmelden_midi(RecMidi* p);
  void starte();                // Faden starten (main.cpp)
  void stoppe();
  void durchgang();             // ein Durchlauf aller Spuren (der Faden ruft es alle 10 ms; Tests rufen es selbst)
  bool hole_meldung(TakeMeldung& m) { return meldungen_.hole(m); }   // nur der Netz-Faden
  const std::string& ordner() const { return ordner_; }

 private:
  struct Lauf { std::unique_ptr<TakeSchreiber> w; int32_t spur = 0, kennung = 0, eingang = 0; int64_t start_s = 0; bool offen_ok = true; };
  // 1.8 T7a: the MIDI take. 12-byte little endian records (i64 sample, u8 status, d1, d2, pad). The thread owns the note state: a note on for a pitch that is open closes it at
  // the new onset first (retrigger rule), a note off for a pitch that is not open in this take (held before the start) is dropped, the notes still open at ende_s get an
  // off at ende_s (by pitch, status 0x80 | channel of the on, velocity 0).
  struct MidiLauf {
    int fd = -1;
    int32_t kennung = 0;
    int64_t start_s = 0, n = 0, letzter_sync_ms = 0;
    bool offen_ok = true, fehler = false;
    bool an[128] = {};
    uint8_t kanal[128] = {};
    std::vector<char> puf;
  };
  void bearbeite_midi(RecMidi* p);
  void midi_ereignis(MidiLauf& l, const MidiEinEreignis& e);
  void midi_satz(MidiLauf& l, int64_t sample, uint8_t st, uint8_t d1, uint8_t d2);
  void midi_leeren(MidiLauf& l);
  bool midi_schliessen(MidiLauf& l, int64_t ende_s);   // closes the open notes (ende_s >= 0), writes, fsync, closes; false: a write error
  void midi_begleitdatei(const MidiLauf& l, int64_t ende_s, int64_t abgelehnt, const char* status);
  void bearbeite(RecSpur* p);
  void begleitdatei(const Lauf& l, int64_t frames, const char* status, int32_t luecken);
  void abbrechen(Lauf& l);   // Puffer schreiben, fsync, schließen, Begleitdatei "abgebrochen" (Abmelden, Kern-Ende); keine Meldung
  std::string ordner_;
  std::mutex m_;
  std::vector<RecSpur*> spuren_;
  std::map<RecSpur*, Lauf> laeufe_;
  std::vector<RecMidi*> midis_;
  std::map<RecMidi*, MidiLauf> midi_laeufe_;
  SpscRing<TakeMeldung, 32> meldungen_;
  std::thread t_;
  std::atomic<bool> aus_{false};
};

}  // namespace cdj
