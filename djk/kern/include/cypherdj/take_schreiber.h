// 1.8 Slice 1: schreibt die Chunks eines Takes in eine Rohdatei (f32, Stereo verschränkt). Läuft im Aufnahme-Faden, nie im Callback.
// Eine Sprungstelle in den Kern-Samples der Chunks (Ring war voll) wird mit Stille gefüllt und gezählt: die Datei bleibt zeitrichtig, nie still verkürzt.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "cypherdj/aufnahme_ring.h"

namespace cdj {

class TakeSchreiber {
 public:
  // start_s: Kern-Sample des ersten Frames der Datei. nur_neu: O_EXCL (nie eine vorhandene Datei ersetzen); false nur für Tests (/dev/full).
  TakeSchreiber(const std::string& pfad, int64_t start_s, bool nur_neu = true);
  ~TakeSchreiber();
  bool offen(std::string& fehler);
  void chunk(const AufnahmeChunk& c);
  // Füllt bis ende_s mit Stille (fehlende letzte Chunks), schreibt den Puffer, fsync, schließt. false: ein Schreibfehler ist aufgetreten.
  bool schliessen(int64_t ende_s, std::string& fehler);
  void sync_wenn_faellig(int64_t jetzt_ms);   // höchstens ein fsync je Sekunde
  int64_t frames() const { return erwartet_ - start_; }
  int64_t luecken_frames() const { return luecken_frames_; }
  int32_t luecken() const { return luecken_; }
  bool fehler() const { return fehler_; }

 private:
  void schreibe_frames(const float* l, const float* r, int n);   // l/r nullptr = Stille
  void leere();
  std::string pfad_;
  int64_t start_, erwartet_;
  bool nur_neu_, fehler_ = false;
  int fd_ = -1;
  std::vector<float> puf_;
  int64_t luecken_frames_ = 0, letzter_sync_ms_ = 0;
  int32_t luecken_ = 0;
};

}  // namespace cdj
