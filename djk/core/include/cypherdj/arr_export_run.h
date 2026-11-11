// Plan 1.11 T12 (INTERFACES §4.11 /k/arr/export_lauf, §5.13 /e/export_lauf; D10): the real-time export of the production master. A project with an active effect-host stage cannot
// be rendered offline (the host is a live process), so the core plays it and streams the PM post point into a file: one transport run from von_beat with the loop bracket suspended
// (arr_export_run.cpp, the run pattern of the freeze), the window is the range length exactly, shifted by the path latency of the PM post point so that it starts on von_beat.
//
// Hand-over (no event, no buffer in the callback): the creator (the net thread, a test) allocates the job with its ring and starts an ArrExportSchreiber on it, which owns the job and the
// writer thread. The job travels to the core as a pointer in command ARR_EXPORT_LAUF. The callback copies the window into chunks of 256 frames and pushes them into the ring (SpscRing, one
// writer, one reader); a ring that is full ends the run (`ueberlauf`), a writer that cannot write sets `schreiber_fehler` and ends it too. When the core is done with the job it fills the
// result fields and publishes them with ONE release store of `phase`; after that the core never touches the job again, so the writer thread may free it. The writer drains the ring,
// closes (or removes) the file and posts an ArrExportMeldung. Allocation, file and thread work happen only in the writer's own thread and the creator.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>

#include "cypherdj/recording_ring.h"

namespace cdj {

constexpr double ARR_EXPORT_MAX_S = 3600.0;                                       // longest run, seconds (D10; zu_gross above)
constexpr int64_t ARR_EXPORT_MAX_FRAMES = 3600LL * 48000LL;
constexpr double ARR_EXPORT_MAX_BEATS = 3600.0;                                   // at 60 BPM, the slowest project tempo, a beat is one second
constexpr std::size_t ARR_EXPORT_RING_CHUNKS = 1024;                              // 1024 x 256 frames = 5.5 s of audio between the callback and the disk

struct ArrExportLauf {
  double von_beat = 0.0, bis_beat = 0.0;
  SpscRing<AufnahmeChunk, ARR_EXPORT_RING_CHUNKS> ring;   // callback -> writer
  AufnahmeChunk stage{};                                  // callback only: the chunk being filled
  // result of the core, written before `phase` is released; valid for the writer after it acquires phase 1
  int64_t start_s = -1;      // core sample of the first captured frame (onset + path latency)
  int64_t frames = 0;        // window length, the range in samples
  int64_t ende_s = -1;
  int32_t status = 0;        // 0 done, 1 aborted, 2 refused
  int32_t ungesund = 0;      // blocks of the window with an active host stage on the dry path
  char grund[24] = {};       // "" or the reason of a refusal or abort
  std::atomic<int32_t> phase{0};            // 0 open, 1 the core is done with the job
  std::atomic<int32_t> schreiber_fehler{0}; // writer -> core: 0 none, 1 datei_fehlt (cannot create the file), 2 kein_platz (write error)
  std::atomic<int32_t> ueberlauf{0};        // core -> writer: the ring was full, a chunk is missing
  // the creator, when the job never reaches the core (command ring full): the run is refused for `g`
  void verwerfen(const char* g);
};

// the answer of the writer thread (the net thread adds `luecken` and sends /e/export_lauf)
struct ArrExportMeldung {
  int64_t frames = 0;        // frames in the file, 0 without one
  float spitze = 0.0f;
  int32_t ungesund = 0;
  char grund[24] = {};       // "" = complete file
};

// owns the job, the writer thread and the file. The destructor joins; a job still open then is refused as `abbruch`.
class ArrExportSchreiber {
 public:
  ArrExportSchreiber(std::unique_ptr<ArrExportLauf> job, std::string pfad);
  ~ArrExportSchreiber();
  ArrExportSchreiber(const ArrExportSchreiber&) = delete;
  ArrExportSchreiber& operator=(const ArrExportSchreiber&) = delete;
  ArrExportLauf* job() const { return job_.get(); }   // valid until the core has published phase 1; after that only phase and the result fields may be read by the creator
  bool fertig() const { return fertig_.load(std::memory_order_acquire); }   // the meldung is ready
  const ArrExportMeldung& meldung() const { return meldung_; }              // after fertig()
  void halte(bool an) { halt_.store(an, std::memory_order_release); }       // tests: the writer stops draining (a slow disk)

 private:
  void lauf();
  std::unique_ptr<ArrExportLauf> job_;
  std::string pfad_;
  ArrExportMeldung meldung_;
  std::atomic<bool> fertig_{false}, halt_{false}, ende_{false};
  std::thread faden_;
};

}  // namespace cdj
