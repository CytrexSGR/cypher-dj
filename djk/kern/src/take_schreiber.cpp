#include "cypherdj/take_schreiber.h"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>

namespace cdj {

constexpr std::size_t PUF_FRAMES = 32768;   // 256 KiB je write()

TakeSchreiber::TakeSchreiber(const std::string& pfad, int64_t start_s, bool nur_neu)
    : pfad_(pfad), start_(start_s), erwartet_(start_s), nur_neu_(nur_neu) {
  puf_.reserve(PUF_FRAMES * 2);
}
TakeSchreiber::~TakeSchreiber() { if (fd_ >= 0) ::close(fd_); }

bool TakeSchreiber::offen(std::string& fehler) {
  fd_ = ::open(pfad_.c_str(), O_WRONLY | O_CREAT | (nur_neu_ ? O_EXCL : 0), 0644);
  if (fd_ < 0) { fehler = pfad_ + ": " + std::strerror(errno); return false; }
  return true;
}

void TakeSchreiber::leere() {
  const char* p = reinterpret_cast<const char*>(puf_.data());
  std::size_t rest = puf_.size() * sizeof(float);
  while (rest > 0 && !fehler_) {
    const ssize_t n = ::write(fd_, p, rest);
    if (n < 0) { if (errno == EINTR) continue; fehler_ = true; break; }   // ENOSPC und alles andere: Status kein_platz, das Gespeicherte bleibt
    p += n;
    rest -= static_cast<std::size_t>(n);
  }
  puf_.clear();
}

void TakeSchreiber::schreibe_frames(const float* l, const float* r, int n) {
  for (int i = 0; i < n; ++i) {
    if (!fehler_) { puf_.push_back(l ? l[i] : 0.0f); puf_.push_back(r ? r[i] : 0.0f); }
    if (puf_.size() >= PUF_FRAMES * 2) leere();
  }
  erwartet_ += n;
}

void TakeSchreiber::chunk(const AufnahmeChunk& c) {
  int skip = 0;
  if (c.s0 > erwartet_) {   // Sprungstelle: Stille für das Fehlende
#ifndef CYPHERDJ_MUTATION_REC_LUECKE_STILL
    int64_t fehlt = c.s0 - erwartet_;
    luecken_frames_ += fehlt;
    ++luecken_;
    while (fehlt > 0) { const int k = static_cast<int>(std::min<int64_t>(fehlt, REC_CHUNK)); schreibe_frames(nullptr, nullptr, k); fehlt -= k; }
#else
    erwartet_ = c.s0;   // Fehlerfall: die Datei wird still um die Lücke verkürzt und nichts gezählt
#endif
  } else if (c.s0 < erwartet_) {
    skip = static_cast<int>(std::min<int64_t>(erwartet_ - c.s0, c.n));   // Überlappung: das schon Geschriebene nicht noch einmal
  }
  if (skip < c.n) schreibe_frames(c.l + skip, c.r + skip, c.n - skip);
}

bool TakeSchreiber::schliessen(int64_t ende_s, std::string& fehler) {
  if (ende_s > erwartet_) {   // letzte Chunks fehlen
    int64_t fehlt = ende_s - erwartet_;
    luecken_frames_ += fehlt;
    ++luecken_;
    while (fehlt > 0) { const int k = static_cast<int>(std::min<int64_t>(fehlt, REC_CHUNK)); schreibe_frames(nullptr, nullptr, k); fehlt -= k; }
  }
  leere();
  if (fd_ >= 0) {
    if (!fehler_ && ::fsync(fd_) != 0) fehler_ = true;
    if (::close(fd_) != 0) fehler_ = true;
    fd_ = -1;
  }
  if (fehler_) fehler = pfad_ + ": Schreibfehler (Platte voll?)";
  return !fehler_;
}

void TakeSchreiber::sync_wenn_faellig(int64_t jetzt_ms) {
  if (fd_ < 0 || fehler_ || jetzt_ms - letzter_sync_ms_ < 1000) return;
  letzter_sync_ms_ = jetzt_ms;
  leere();
  if (::fsync(fd_) != 0) fehler_ = true;
}

}  // namespace cdj
