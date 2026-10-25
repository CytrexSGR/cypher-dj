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

#include "cypherdj/aufnahme_ring.h"
#include "cypherdj/spsc_ring.h"
#include "cypherdj/take_schreiber.h"

namespace cdj {

struct TakeMeldung {
  int32_t spur, kennung, status;   // status 0 ok, 1 Lücken, 2 abgebrochen (reserviert, wird nie gesendet: abbrechen() meldet nicht), 3 kein_platz
  int64_t frames, start_s;
  int32_t luecken;
};

class AufnahmeFaden {
 public:
  explicit AufnahmeFaden(std::string ordner);
  ~AufnahmeFaden();
  void anmelden(RecSpur* p);    // Netz-Faden: vor dem Befehl REC_SPUR
  void abmelden(RecSpur* p);    // Netz-Faden: bevor er den RecSpur freigibt
  void starte();                // Faden starten (main.cpp)
  void stoppe();
  void durchgang();             // ein Durchlauf aller Spuren (der Faden ruft es alle 10 ms; Tests rufen es selbst)
  bool hole_meldung(TakeMeldung& m) { return meldungen_.hole(m); }   // nur der Netz-Faden
  const std::string& ordner() const { return ordner_; }

 private:
  struct Lauf { std::unique_ptr<TakeSchreiber> w; int32_t spur = 0, kennung = 0, eingang = 0; int64_t start_s = 0; bool offen_ok = true; };
  void bearbeite(RecSpur* p);
  void begleitdatei(const Lauf& l, int64_t frames, const char* status, int32_t luecken);
  void abbrechen(Lauf& l);   // Puffer schreiben, fsync, schließen, Begleitdatei "abgebrochen" (Abmelden, Kern-Ende); keine Meldung
  std::string ordner_;
  std::mutex m_;
  std::vector<RecSpur*> spuren_;
  std::map<RecSpur*, Lauf> laeufe_;
  SpscRing<TakeMeldung, 32> meldungen_;
  std::thread t_;
  std::atomic<bool> aus_{false};
};

}  // namespace cdj
