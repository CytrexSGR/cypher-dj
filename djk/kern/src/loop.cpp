#include "cypherdj/loop.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <nlohmann/json.hpp>

namespace cdj {

namespace fs = std::filesystem;

std::unique_ptr<Loop> lade_loop(const std::string& ordner, std::string* fehler) {
  auto fail = [&](const std::string& t) {
    if (fehler) *fehler = ordner + "/loop.json: " + t;
    return std::unique_ptr<Loop>();
  };
  std::ifstream in(ordner + "/loop.json");
  if (!in) return fail("fehlt");
  nlohmann::json j;
  try {
    in >> j;
  } catch (const std::exception& e) {
    return fail(std::string("unlesbar: ") + e.what());
  }
  if (!j.is_object() || !j.contains("schema") || j["schema"] != 1) return fail("schema ist nicht 1");
  // MVP 2 Scheibe 3 (E3): beats; alte Dateien mit takte (bis Scheibe 2, Hörtest 27.09.) als beats = 4 · takte
  int beats = 0;
  if (j.contains("beats")) {
    if (!j["beats"].is_number_integer() || !loop_beats_ok(j["beats"].get<int>())) return fail("beats nicht 1, 2, 4, 8, 16 oder 32");
    beats = j["beats"].get<int>();
  } else if (j.contains("takte")) {
    if (!j["takte"].is_number_integer() || !loop_takte_ok(j["takte"].get<int>())) return fail("takte (alt) nicht 1, 2, 4 oder 8");
    beats = 4 * j["takte"].get<int>();
  } else {
    return fail("beats fehlt");
  }
  if (!j.contains("bpm") || !j["bpm"].is_number() || j["bpm"].get<double>() != LOOP_BPM) return fail("bpm ist nicht 128");
  auto l = std::make_unique<Loop>();
  l->name = j.value("name", std::string());
  l->beats = beats;
  l->frames = (int64_t)beats * LOOP_SPB;
  if (!j.contains("frames") || !j["frames"].is_number_integer() || j["frames"].get<int64_t>() != l->frames)
    return fail("frames passt nicht zu beats (" + std::to_string(l->frames) + " erwartet)");
  if (j.contains("versatz_frames")) {  // Plan Grid (§4.9)
    if (!j["versatz_frames"].is_number_integer() || std::llabs(j["versatz_frames"].get<int64_t>()) >= l->frames)
      return fail("versatz_frames nicht ganzzahlig oder Betrag nicht kleiner als frames");
    l->versatz = j["versatz_frames"].get<int64_t>();
  }
  if (j.value("datei", std::string()) != "loop.f32") return fail("datei ist nicht loop.f32");
  std::ifstream f(ordner + "/loop.f32", std::ios::binary | std::ios::ate);
  if (!f) return fail("loop.f32 fehlt");
  if ((int64_t)f.tellg() != l->frames * 8) return fail("loop.f32: Groesse passt nicht zu frames");
  f.seekg(0);
  l->daten.resize((size_t)l->frames * 2);
  f.read(reinterpret_cast<char*>(l->daten.data()), (std::streamsize)(l->frames * 8));
  for (float x : l->daten)
    if (!std::isfinite(x)) return fail("loop.f32: NaN oder Inf");
  return l;
}

void umtasten(const float* ein, int64_t n_ein, float* aus, int64_t n_aus) {
  if (n_ein == n_aus) {
    std::copy(ein, ein + 2 * n_ein, aus);
    return;
  }
  const double PI = 3.14159265358979323846;
  constexpr int H = 16;      // Nulldurchgänge je Seite
  constexpr int FEIN = 512;  // Tabellenschritte je Nulldurchgang
  std::vector<double> tab((size_t)H * FEIN + 2, 0.0);  // g(t) = sinc(t) · Hann(t/H) für t in [0, H]; darüber 0
  for (int i = 0; i < H * FEIN; ++i) {
    const double t = (double)i / FEIN;
    const double s = i == 0 ? 1.0 : std::sin(PI * t) / (PI * t);
    tab[(size_t)i] = s * 0.5 * (1.0 + std::cos(PI * t / H));
  }
  const double v = (double)n_ein / (double)n_aus;  // Eingangs-Frames je Ausgangs-Frame
  const double fc = v > 1.0 ? 1.0 / v : 1.0;       // Grenzfrequenz relativ zur Eingangs-Nyquist (Verkürzen: Tiefpass)
  const int64_t breite = (int64_t)std::ceil((double)H / fc);
  for (int64_t j = 0; j < n_aus; ++j) {
    const double x = (double)j * v;
    const int64_t m = (int64_t)std::floor(x);
    double sl = 0.0, sr = 0.0, sw = 0.0;
    int64_t q = (((m - breite + 1) % n_ein) + n_ein) % n_ein;  // Umlauf: der Mitschnitt ist ein Loop
    for (int64_t i = m - breite + 1; i <= m + breite; ++i) {
      const double u = std::fabs(x - (double)i) * fc * FEIN;
      if (u < (double)(H * FEIN)) {
        const int64_t k = (int64_t)u;
        const double g = tab[(size_t)k] + (tab[(size_t)k + 1] - tab[(size_t)k]) * (u - (double)k);
        sl += g * (double)ein[2 * q];
        sr += g * (double)ein[2 * q + 1];
        sw += g;
      }
      if (++q == n_ein) q = 0;
    }
    aus[2 * j] = (float)(sl / sw);
    aus[2 * j + 1] = (float)(sr / sw);
  }
}

bool schreibe_loop(const std::string& ordner, const Mitschnitt& m, std::string* fehler) {
  auto fail = [&](const std::string& t) {
    if (fehler) *fehler = t;
    return false;
  };
  const fs::path ziel = fs::path(ordner) / m.name;
  // Keylock Slice 4: schreibe_loop bekommt FERTIGE Daten. Ein Mitschnitt bei anderem Tempo (roh_frames != frames) muss
  // vorher mit rendere_rec (R3, Tonhöhe erhalten) auf frames Frames bei 128 BPM gebracht sein (umgerechnet); früher
  // tastete umtasten ihn hier um, das änderte die Tonhöhe um 12·log2(T/128) Halbton. Bei 128 BPM ist roh == frames und die
  // Datei bitgleich mit dem Puffer. roh_frames bleibt als Vermerk (aufnahme_bpm in loop.json).
  const int64_t roh = m.roh_frames > 0 ? m.roh_frames : m.frames;
  if (roh != m.frames && !m.umgerechnet)
    return fail(std::string(m.name) + ": Mitschnitt bei anderem Tempo nicht auf 128 BPM umgerechnet");
  if ((int64_t)m.daten.size() < 2 * m.frames) return fail(std::string(m.name) + ": daten passt nicht zu frames");
  const float* quelle = m.daten.data();
  std::error_code ec;
  if (fs::exists(ziel, ec)) return fail(ziel.string() + ": gibt es schon");
  const fs::path neu = fs::path(ordner) / (std::string(".") + m.name + ".neu");
  auto fail_neu = [&](const std::string& t) {  // keine halbe .neu-Leiche liegen lassen
    std::error_code e2;
    fs::remove_all(neu, e2);
    return fail(t);
  };
  fs::remove_all(neu, ec);
  fs::create_directories(neu, ec);
  if (ec) return fail_neu(neu.string() + ": " + ec.message());
  {
    std::ofstream f(neu / "loop.f32", std::ios::binary);
    if (!f) return fail_neu((neu / "loop.f32").string() + ": nicht schreibbar");
    f.write(reinterpret_cast<const char*>(quelle), (std::streamsize)(m.frames * 8));
    f.close();
    if (!f) return fail_neu((neu / "loop.f32").string() + ": Schreibfehler");
  }
  {
    nlohmann::json j;
    j["schema"] = 1;
    j["name"] = m.name;
    j["beats"] = m.beats;
    j["bpm"] = LOOP_BPM;
    j["frames"] = m.frames;
    j["datei"] = "loop.f32";
    j["quelle"] = "mitschnitt";
    if (roh != m.frames) j["aufnahme_bpm"] = m.bpm;
    std::ofstream f(neu / "loop.json");
    if (!f) return fail_neu((neu / "loop.json").string() + ": nicht schreibbar");
    f << j.dump(1);
    f.close();  // Plan-Review: ein Fehler beim Schließen (volles Dateisystem) zählt auch
    if (!f) return fail_neu((neu / "loop.json").string() + ": Schreibfehler");
  }
  fs::rename(neu, ziel, ec);
  if (ec) return fail_neu(ziel.string() + ": " + ec.message());
  return true;
}

}  // namespace cdj
