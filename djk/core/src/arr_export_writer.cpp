// Plan 1.11 T12: the writer thread of the real-time export (see arr_export_run.h). Own thread, own file, never the callback: it drains the ring the callback fills into a TakeSchreiber
// (take_writer.cpp), closes or removes the file and posts the ArrExportMeldung.
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

#include "cypherdj/arr_export_run.h"
#include "cypherdj/take_writer.h"

namespace cdj {

// ---- writer thread ----

ArrExportSchreiber::ArrExportSchreiber(std::unique_ptr<ArrExportLauf> job, std::string pfad) : job_(std::move(job)), pfad_(std::move(pfad)) {
  faden_ = std::thread([this] { lauf(); });
}

ArrExportSchreiber::~ArrExportSchreiber() {
  ende_.store(true, std::memory_order_release);
  halt_.store(false, std::memory_order_release);
  if (faden_.joinable()) faden_.join();
}

void ArrExportSchreiber::lauf() {
  ArrExportLauf& j = *job_;
  std::unique_ptr<TakeSchreiber> sch;
  bool tot = false;   // a write error: the rest is drained and dropped
  float spitze = 0.0f;
  int64_t geschrieben = 0;
  int warte = 0;
  for (;;) {
    const bool kern_fertig = j.phase.load(std::memory_order_acquire) == 1;
    bool bewegt = false;
    AufnahmeChunk c;
    while (!halt_.load(std::memory_order_acquire) && j.ring.hole(c)) {
      bewegt = true;
      if (tot) continue;
      if (!sch) {
        sch = std::make_unique<TakeSchreiber>(pfad_, c.s0, true);
        std::string fehler;
        if (!sch->offen(fehler)) {
          j.schreiber_fehler.store(1, std::memory_order_release);
          sch.reset();
          tot = true;
          continue;
        }
      }
      for (int i = 0; i < c.n; ++i) spitze = std::max(spitze, std::max(std::fabs(c.l[i]), std::fabs(c.r[i])));
      sch->chunk(c);
      geschrieben += c.n;
      if (sch->fehler()) {
        j.schreiber_fehler.store(2, std::memory_order_release);
        tot = true;
      }
    }
    if (kern_fertig && (j.ring.belegt() == 0 || ende_.load(std::memory_order_acquire))) break;
    if (ende_.load(std::memory_order_acquire) && !kern_fertig) {
      // the owner goes away while the core may still hold the job; freeing it could be a write into freed memory. Wait a little for the core (it ends the run at once on a stop);
      // a core that never answers (gone with its process) leaves the job to the leak, which is safe
      if (++warte > 500) {
        job_.release();
        return;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      continue;
    }
    if (!bewegt) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  // the core is done: the result fields are valid
  std::string grund = j.grund;
  bool behalten = j.status == 0 && !tot;
  if (j.ueberlauf.load(std::memory_order_acquire) != 0) {
    grund = "schreiber_ueberlauf";
    behalten = false;
  } else if (const int sf = j.schreiber_fehler.load(std::memory_order_acquire); sf != 0) {
    grund = sf == 1 ? "datei_fehlt" : "kein_platz";
    behalten = false;
  }
  if (sch) {
    std::string fehler;
    if (behalten) {
      if (!sch->schliessen(j.start_s + j.frames, fehler) || sch->luecken() != 0) {
        grund = "kein_platz";
        behalten = false;
      }
    }
    sch.reset();   // closes the descriptor
    if (!behalten) ::unlink(pfad_.c_str());   // no half file stays behind
  }
  if (behalten && geschrieben != j.frames) {   // a run that did not deliver its range is no export
    grund = "abbruch";
    behalten = false;
    ::unlink(pfad_.c_str());
  }
  ArrExportMeldung m;
  m.frames = behalten ? geschrieben : 0;
  m.spitze = behalten ? spitze : 0.0f;
  m.ungesund = j.ungesund;
  std::strncpy(m.grund, behalten ? "" : (grund.empty() ? "abbruch" : grund.c_str()), sizeof m.grund - 1);
  meldung_ = m;
  fertig_.store(true, std::memory_order_release);
}

}  // namespace cdj
