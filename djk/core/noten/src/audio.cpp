// Audio and text file I/O: stereo f32 (read, write), mono mix, the s16 reader of the golden vectors, atomic writes via `<aus>.tmp`.
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>

#include "intern.h"

namespace cdj::noten {
namespace {

constexpr size_t CHUNK = 1u << 20;   // bytes per read or write

Fehler abbruchFehler() { return Fehler{"abbruch", "interrupted by SIGTERM"}; }

Fehler oeffnenFehler(const std::string& pfad, int err) {
  if (err == ENOENT || err == ENOTDIR) return Fehler{"datei_fehlt", "File not found: " + pfad};
  return Fehler{"datei_kaputt", "Cannot read " + pfad + ": " + std::strerror(err)};
}

/// Opens for reading; retries after an interrupted call unless SIGTERM is pending (a FIFO blocks in open until a writer exists).
int oeffneLesen(const std::string& pfad, Fehler& fehler) {
  for (;;) {
    const int fd = ::open(pfad.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd >= 0) return fd;
    if (errno == EINTR) {
      if (abbruchAngefordert()) { fehler = abbruchFehler(); return -1; }
      continue;
    }
    fehler = oeffnenFehler(pfad, errno);
    return -1;
  }
}

/// Reads to the end in chunks and hands each chunk to `nimm`. A regular file gives its size as a hint. Polls the SIGTERM flag.
template <class F>
std::optional<Fehler> lesenBisEnde(const std::string& pfad, F nimm, size_t* hinweis) {
  Fehler f;
  const int fd = oeffneLesen(pfad, f);
  if (fd < 0) return f;
  struct stat st {};
  if (hinweis && ::fstat(fd, &st) == 0 && S_ISREG(st.st_mode)) *hinweis = static_cast<size_t>(st.st_size);
  std::vector<unsigned char> puffer(CHUNK);
  std::optional<Fehler> ergebnis;
  for (;;) {
    if (abbruchAngefordert()) { ergebnis = abbruchFehler(); break; }
    const ssize_t n = ::read(fd, puffer.data(), puffer.size());
    if (n < 0) {
      if (errno == EINTR) continue;   // the flag is checked at the top
      ergebnis = Fehler{"datei_kaputt", "Cannot read " + pfad + ": " + std::strerror(errno)};
      break;
    }
    if (n == 0) break;
    nimm(puffer.data(), static_cast<size_t>(n));
  }
  ::close(fd);
  if (!ergebnis && abbruchAngefordert()) ergebnis = abbruchFehler();
  return ergebnis;
}

/// Writes `<pfad>.tmp` through `fuelle` (called with a sink) and renames it; every failure and a pending SIGTERM remove the tmp file.
template <class F>
std::optional<Fehler> schreibeAtomar(const std::string& pfad, F fuelle) {
  const std::string tmp = pfad + ".tmp";
  const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
  if (fd < 0) return Fehler{"schreiben", "Cannot write " + tmp + ": " + std::strerror(errno)};
  auto weg = [&](Fehler f) { ::close(fd); ::unlink(tmp.c_str()); return std::optional<Fehler>(std::move(f)); };
  auto schreibe = [&](const void* daten, size_t n) -> bool {
    const char* p = static_cast<const char*>(daten);
    while (n > 0) {
      const ssize_t w = ::write(fd, p, n);
      if (w < 0) { if (errno == EINTR) continue; return false; }
      p += w;
      n -= static_cast<size_t>(w);
    }
    return true;
  };
  if (!fuelle(schreibe, [] { return abbruchAngefordert(); })) {
    if (abbruchAngefordert()) return weg(abbruchFehler());
    return weg(Fehler{"schreiben", "Cannot write " + tmp + ": " + std::strerror(errno)});
  }
  if (abbruchAngefordert()) return weg(abbruchFehler());
  if (::close(fd) != 0) { ::unlink(tmp.c_str()); return Fehler{"schreiben", "Cannot write " + tmp + ": " + std::strerror(errno)}; }
  if (std::rename(tmp.c_str(), pfad.c_str()) != 0) {
    const int err = errno;
    ::unlink(tmp.c_str());
    return Fehler{"schreiben", "Cannot rename " + tmp + " to " + pfad + ": " + std::strerror(err)};
  }
  return std::nullopt;
}

}  // namespace

std::variant<Stereo, Fehler> liesF32(const std::string& pfad) {
  Stereo s;
  size_t groesse = 0;
  size_t gesamt = 0;
  unsigned char rest[8];   // bytes of a frame that a chunk ended in the middle of
  size_t nrest = 0;
  bool reserviert = false;
  auto nimm = [&](const unsigned char* d, size_t n) {
    if (!reserviert) {
      reserviert = true;
      if (groesse >= 8) { s.l.reserve(groesse / 8); s.r.reserve(groesse / 8); }
    }
    gesamt += n;
    size_t i = 0;
    if (nrest > 0) {
      while (nrest < 8 && i < n) rest[nrest++] = d[i++];
      if (nrest < 8) return;
      float f[2];
      std::memcpy(f, rest, 8);
      s.l.push_back(f[0]);
      s.r.push_back(f[1]);
      nrest = 0;
    }
    const size_t frames = (n - i) / 8;
    const size_t alt = s.l.size();
    s.l.resize(alt + frames);
    s.r.resize(alt + frames);
    for (size_t k = 0; k < frames; ++k) {
      float f[2];
      std::memcpy(f, d + i + 8 * k, 8);
      s.l[alt + k] = f[0];
      s.r[alt + k] = f[1];
    }
    i += frames * 8;
    while (i < n) rest[nrest++] = d[i++];
  };
  // fstat is asked before the first chunk through the hint; the lambda reads it when the first chunk arrives
  if (auto f = lesenBisEnde(pfad, nimm, &groesse)) return *f;
  if (gesamt % 8 != 0) return Fehler{"datei_kaputt", "The f32 file size is not a multiple of 8 bytes."};
  return s;
}

std::optional<Fehler> schreibeF32(const std::string& pfad, const Stereo& s) {
  return schreibeAtomar(pfad, [&](auto schreibe, auto abgebrochen) {
    const size_t n = s.l.size();
    const size_t block = CHUNK / 8;
    std::vector<float> puffer(2 * block);
    for (size_t a = 0; a < n; a += block) {
      if (abgebrochen()) return false;
      const size_t m = std::min(block, n - a);
      for (size_t k = 0; k < m; ++k) {
        puffer[2 * k] = s.l[a + k];
        puffer[2 * k + 1] = s.r[a + k];
      }
      if (!schreibe(puffer.data(), m * 8)) return false;
    }
    return true;
  });
}

std::vector<float> mitte(const Stereo& s) {
  std::vector<float> m(s.l.size());
  for (size_t i = 0; i < m.size(); ++i) m[i] = (s.l[i] + s.r[i]) * 0.5f;
  return m;
}

std::vector<float> liesS16(const std::string& pfad) {
  std::vector<float> out;
  unsigned char rest = 0;
  bool halb = false;
  auto nimm = [&](const unsigned char* d, size_t n) {
    for (size_t i = 0; i < n; ++i) {
      if (!halb) { rest = d[i]; halb = true; continue; }
      halb = false;
      const int16_t v = static_cast<int16_t>(static_cast<uint16_t>(rest | (static_cast<uint16_t>(d[i]) << 8)));
      out.push_back(static_cast<float>(v) / 32768.0f);
    }
  };
  if (lesenBisEnde(pfad, nimm, nullptr)) return {};
  return out;
}

std::variant<std::string, Fehler> liesText(const std::string& pfad) {
  std::string text;
  size_t groesse = 0;
  auto nimm = [&](const unsigned char* d, size_t n) { text.append(reinterpret_cast<const char*>(d), n); };
  if (auto f = lesenBisEnde(pfad, nimm, &groesse)) return *f;
  return text;
}

std::optional<Fehler> schreibeText(const std::string& pfad, const std::string& text) {
  return schreibeAtomar(pfad, [&](auto schreibe, auto abgebrochen) {
    for (size_t a = 0; a < text.size(); a += CHUNK) {
      if (abgebrochen()) return false;
      if (!schreibe(text.data() + a, std::min(CHUNK, text.size() - a))) return false;
    }
    return true;
  });
}

}  // namespace cdj::noten
