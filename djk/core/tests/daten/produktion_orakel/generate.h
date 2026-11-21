// Container core K0: generator of the production render oracle fixture, shared by schreibe.cpp and
// tests/test_render_produktion_bitgleich.cpp. Header-only, no library. See schreibe.cpp for the content and the render command.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

inline constexpr int64_t FRAMES = 8 * 48000 + 4096;   // a little longer than the 8 s window
inline const char SHA_A[] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
inline const char SHA_B[] = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

inline void schreibe_audio(const std::string& pfad, bool rauschen) {
  std::vector<float> d(static_cast<size_t>(FRAMES) * 2);
  uint64_t s = 0x9e3779b97f4a7c15ull;
  for (int64_t f = 0; f < FRAMES; ++f) {
    float l, r;
    if (rauschen) {
      auto n = [&] {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        return static_cast<float>(static_cast<double>(s >> 11) / 4503599627370496.0 - 1.0);
      };
      l = 0.2f * n();
      r = 0.2f * n();
    } else {
      const double t = static_cast<double>(f) / 48000.0;
      const double a = 0.5 * (1.0 + 0.5 * std::sin(2.0 * 3.14159265358979323846 * 3.0 * t));
      l = static_cast<float>(0.5 * a * std::sin(2.0 * 3.14159265358979323846 * 220.0 * t));
      r = static_cast<float>(0.5 * a * std::sin(2.0 * 3.14159265358979323846 * 220.0 * t + 0.4));
    }
    d[2 * f] = l;
    d[2 * f + 1] = r;
  }
  std::ofstream(pfad, std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * 4));
}

inline std::string ersetze(std::string t, const std::string& was, const std::string& durch) {
  for (size_t p = t.find(was); p != std::string::npos; p = t.find(was, p + durch.size())) t.replace(p, was.size(), durch);
  return t;
}


// writes <ordner>/audio/<sha>.f32 and <ordner>/wiedergabe-1.json from the template file
inline bool schreibe_projekt(const std::string& ordner, const std::string& vorlage) {
  std::filesystem::create_directories(ordner + "/audio");
  schreibe_audio(ordner + "/audio/" + SHA_A + ".f32", false);
  schreibe_audio(ordner + "/audio/" + SHA_B + ".f32", true);
  std::ifstream in(vorlage);
  if (!in) return false;
  std::string t((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  t = ersetze(t, "@ORDNER@", ordner);
  t = ersetze(t, "@SHA_A@", SHA_A);
  t = ersetze(t, "@SHA_B@", SHA_B);
  t = ersetze(t, "@FRAMES@", std::to_string(FRAMES));
  std::ofstream(ordner + "/wiedergabe-1.json") << t;
  return true;
}
