// Paket K3: WAV float32 Stereo 48 kHz schreiben und lesen (wav.h).
#include "cypherdj/wav.h"

#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>

namespace cdj {

namespace {

void u32(std::string& b, uint32_t v) { b.append(reinterpret_cast<const char*>(&v), 4); }   // Little Endian (x86-64)
void u16(std::string& b, uint16_t v) { b.append(reinterpret_cast<const char*>(&v), 2); }
uint32_t lies32(const char* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
uint16_t lies16(const char* p) { uint16_t v; std::memcpy(&v, p, 2); return v; }

// Fix L9: Ziel nur anlegen, wenn es nicht besteht; false mit errno (EEXIST: besteht). Wie arr_freeze_datei.cpp.
bool umbenennen_ohne_ersetzen(const std::string& teil, const std::string& ziel) {
#ifdef CYPHERDJ_MUTATION_WAV_ERSETZT
  return std::rename(teil.c_str(), ziel.c_str()) == 0;   // Fehlerfall L9: ein vorhandenes Ziel wird still ersetzt
#else
#ifdef RENAME_NOREPLACE
  if (renameat2(AT_FDCWD, teil.c_str(), AT_FDCWD, ziel.c_str(), RENAME_NOREPLACE) == 0) return true;
  if (errno != EINVAL && errno != ENOSYS) return false;   // EEXIST oder echter Fehler; sonst kann es das Dateisystem nicht
#endif
  if (link(teil.c_str(), ziel.c_str()) != 0) return false;
  unlink(teil.c_str());
  return true;
#endif
}

}  // namespace

bool schreibe_wav_f32(const std::string& pfad, const std::vector<float>& l, const std::vector<float>& r,
                      std::string& fehler, bool* besteht) {
  if (besteht) *besteht = false;
  if (l.size() != r.size()) {
    fehler = pfad + ": L und R ungleich lang";
    return false;
  }
  if (static_cast<int64_t>(l.size()) > WAV_F32_MAX_FRAMES) {   // Fix L3: der u32-Kopf liefe über
    fehler = pfad + ": " + std::to_string(l.size()) + " Frames, WAV erlaubt höchstens " + std::to_string(WAV_F32_MAX_FRAMES);
    return false;
  }
  const uint32_t frames = static_cast<uint32_t>(l.size());
  const uint32_t daten = frames * 8;
  std::string kopf;
  kopf += "RIFF";
  u32(kopf, 4 + (8 + 18) + (8 + 4) + (8 + daten));
  kopf += "WAVEfmt ";
  u32(kopf, 18);
  u16(kopf, 3);          // WAVE_FORMAT_IEEE_FLOAT
  u16(kopf, 2);          // Kanäle
  u32(kopf, 48000);
  u32(kopf, 48000 * 8);  // Bytes je Sekunde
  u16(kopf, 8);          // Block
  u16(kopf, 32);         // Bits
  u16(kopf, 0);          // cbSize
  kopf += "fact";
  u32(kopf, 4);
  u32(kopf, frames);
  kopf += "data";
  u32(kopf, daten);
  const std::string teil = pfad + "." + std::to_string(getpid()) + ".teil";
  FILE* d = std::fopen(teil.c_str(), "wb");
  if (!d) {
    fehler = teil + ": " + std::strerror(errno);
    return false;
  }
  bool ok = std::fwrite(kopf.data(), 1, kopf.size(), d) == kopf.size();
#ifdef CYPHERDJ_MUTATION_WAV_GANZE_KOPIE
  // Fehlerfall (Stand fix1): der ganze Export verschränkt in einem zweiten Vektor (beim größten Export 786 MB zusätzlich)
  std::vector<float> v(static_cast<size_t>(frames) * 2);
  for (uint32_t i = 0; i < frames; ++i) {
    v[2 * i] = l[i];
    v[2 * i + 1] = r[i];
  }
  ok = ok && std::fwrite(v.data(), sizeof(float), v.size(), d) == v.size();
#else
  // Fix 2/P4: in festen Stücken verschränken (64 Ki Frames, 512 KiB), die Spitze bleibt nahe L + R
  constexpr uint32_t STUECK = 65536;
  std::vector<float> v(static_cast<size_t>(std::min(frames, STUECK)) * 2);
  for (uint32_t a = 0; ok && a < frames; a += STUECK) {
    const uint32_t n = std::min(STUECK, frames - a);
    for (uint32_t i = 0; i < n; ++i) {
      v[2 * i] = l[a + i];
      v[2 * i + 1] = r[a + i];
    }
    ok = std::fwrite(v.data(), sizeof(float), 2 * static_cast<size_t>(n), d) == 2 * static_cast<size_t>(n);
  }
#endif
  const bool zu = std::fclose(d) == 0;
  if (!ok || !zu) {
    fehler = teil + ": " + std::strerror(errno);
    std::remove(teil.c_str());
    return false;
  }
  if (!umbenennen_ohne_ersetzen(teil, pfad)) {
    const int e = errno;
    fehler = pfad + (e == EEXIST ? std::string(": besteht schon (wird nie ersetzt)") : ": " + std::string(std::strerror(e)));
    if (besteht) *besteht = e == EEXIST;
    std::remove(teil.c_str());
    return false;
  }
  return true;
}

bool lies_wav_f32(const std::string& pfad, std::vector<float>& l, std::vector<float>& r, std::string& fehler) {
  std::ifstream f(pfad, std::ios::binary);
  if (!f) {
    fehler = pfad + ": fehlt";
    return false;
  }
  std::string b((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  if (b.size() < 12 || b.compare(0, 4, "RIFF") != 0 || b.compare(8, 4, "WAVE") != 0) {
    fehler = pfad + ": kein RIFF/WAVE";
    return false;
  }
  bool fmt_ok = false;
  for (size_t p = 12; p + 8 <= b.size();) {
    const uint32_t n = lies32(b.data() + p + 4);
    if (p + 8 + n > b.size()) break;
    const char* c = b.data() + p + 8;
    if (b.compare(p, 4, "fmt ") == 0 && n >= 16)
      fmt_ok = lies16(c) == 3 && lies16(c + 2) == 2 && lies32(c + 4) == 48000 && lies16(c + 14) == 32;
    if (b.compare(p, 4, "data") == 0) {
      if (!fmt_ok) break;
      const size_t frames = n / 8;
      l.resize(frames);
      r.resize(frames);
      for (size_t i = 0; i < frames; ++i) {
        std::memcpy(&l[i], c + 8 * i, 4);
        std::memcpy(&r[i], c + 8 * i + 4, 4);
      }
      return true;
    }
    p += 8 + n + (n & 1);
  }
  fehler = pfad + (fmt_ok ? ": kein data-Abschnitt" : ": nicht float32 Stereo 48 kHz");
  return false;
}

}  // namespace cdj
