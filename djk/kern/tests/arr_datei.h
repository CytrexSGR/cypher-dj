// D1 K1: Wiedergabe-Dateien für Tests (Spec D1 3.2): ein Arbeitsordner unter /dev/shm je Prozess, Audio als rohes f32
// Stereo in audio/<sha>.f32, wiedergabe-<nr>.json mit Clips und Noten (Schlüssel "nr" wie S2, Spec 6.1). Am Ende entfernt.
#pragma once

#include <fcntl.h>
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <utility>
#include <vector>

namespace arrdatei {

struct Ordner {
  std::string pfad;
  explicit Ordner(const char* name, const std::string& basis = "/dev/shm")
      : pfad(basis + "/" + std::string(name) + "_" + std::to_string(getpid())) {
    std::filesystem::create_directories(pfad + "/audio");
  }
  ~Ordner() { std::filesystem::remove_all(pfad); }
  // sha aus einem Zeichen (64-mal), Datei mit frames Frames Gleichwert wert
  std::string audio(char z, int64_t frames, float wert = 0.25f) const {
    const std::string sha(64, z);
    std::vector<float> d(static_cast<size_t>(frames) * 2, wert);
    std::ofstream(pfad + "/audio/" + sha + ".f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
    return sha;
  }
  // Sinus hz mit Spitze amp, L und R gleich (1.10 Slice 2): jede Verschiebung um 1 Sample ist im Rest sichtbar
  std::string sinus(char z, int64_t frames, double hz, float amp) const {
    const std::string sha(64, z);
    std::vector<float> d(static_cast<size_t>(frames) * 2);
    for (int64_t f = 0; f < frames; ++f)
      d[2 * f] = d[2 * f + 1] = amp * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(f) / 48000.0));
    std::ofstream(pfad + "/audio/" + sha + ".f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
    return sha;
  }
  // Impuls: 1,0 auf Frame 0 (L und R), sonst 0; der Einsatz ist am Ausgang als erster Wert ungleich 0 sichtbar
  std::string impuls(char z, int64_t frames) const {
    const std::string sha(64, z);
    std::vector<float> d(static_cast<size_t>(frames) * 2, 0.0f);
    d[0] = d[1] = 1.0f;
    std::ofstream(pfad + "/audio/" + sha + ".f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
    return sha;
  }
  // Audio-Datei aus dem Seiten-Cache werfen (fsync, POSIX_FADV_DONTNEED): das Laden liest dann wirklich vom Datenträger
  void kalt(const std::string& sha) const {
    const int fd = open((pfad + "/audio/" + sha + ".f32").c_str(), O_RDONLY);
    if (fd < 0) return;
    fdatasync(fd);
    posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
    close(fd);
  }
  std::string clip(const char* id, double start, double laenge, const std::string& sha, int64_t frames,
                   int64_t offset = 0, double gain_db = 0.0) const {
    char b[512];
    std::snprintf(b, sizeof b,
                  "{\"id\":\"%s\",\"start_beat\":%.17g,\"laenge_beats\":%.17g,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                  "\"frames\":%lld,\"offset_frames\":%lld,\"gain_db\":%.17g,\"ein_beats\":0.0,\"aus_beats\":0.0}",
                  id, start, laenge, sha.c_str(), pfad.c_str(), sha.c_str(), (long long)frames, (long long)offset, gain_db);
    return b;
  }
  // Paket 1.13: Clip mit Warp (RE-PITCH, Modus 0); marker = Paare (Clip-Beat, Quell-Frame)
  std::string clip_warp(const char* id, double start, double laenge, const std::string& sha, int64_t frames,
                        const std::vector<std::pair<double, double>>& marker, double gain_db = 0.0) const {
    std::string w = ",\"warp\":{\"modus\":0,\"w\":[";
    char z[96];
    for (size_t i = 0; i < marker.size(); ++i) {
      std::snprintf(z, sizeof z, "%s[%.17g,%.17g]", i ? "," : "", marker[i].first, marker[i].second);
      w += z;
    }
    w += "]}";
    std::string c = clip(id, start, laenge, sha, frames, 0, gain_db);
    c.insert(c.size() - 1, w);   // vor der schließenden Klammer
    return c;
  }
  // Paket 1.13: dieselbe Datei im Format /2
  void wiedergabe2_warp(int64_t nr, const std::string& spuren) const {
    std::ofstream(pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/2\",\"nr\":" << nr << ",\"spuren\":[" << spuren << "]}";
  }
  void wiedergabe(int64_t nr, const std::string& spuren) const {
    std::ofstream(pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/1\",\"nr\":" << nr << ",\"spuren\":[" << spuren << "]}";
  }
  // 1.10: Format /2 mit Gruppen-Liste (JSON-Text der Elemente, ohne eckige Klammern); format = "cypherdj-arr/2"
  void wiedergabe2(int64_t nr, const std::string& spuren, const std::string& gruppen, const char* format = "cypherdj-arr/2") const {
    std::ofstream(pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"" << format << "\",\"nr\":" << nr << ",\"spuren\":[" << spuren << "],\"gruppen\":[" << gruppen << "]}";
  }
  void roh(int64_t nr, const std::string& text) const {
    std::ofstream(pfad + "/wiedergabe-" + std::to_string(nr) + ".json") << text;
  }
};

}  // namespace arrdatei
