// Plan MVP 2 Task 2: Loop laden (ADR 025). Guter 1-Takt-Loop; jede Prüfung einzeln verletzt.
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <iterator>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "cypherdj/loop.h"
#include "pruef.h"

namespace fs = std::filesystem;

static void schreibe(const fs::path& d, const std::string& json, int64_t frames, float wert = 0.25f) {
  fs::create_directories(d);
  std::ofstream(d / "loop.json") << json;
  if (frames >= 0) {
    std::vector<float> x((size_t)frames * 2, wert);
    std::ofstream(d / "loop.f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(x.data()), (std::streamsize)(x.size() * sizeof(float)));
  }
}
static std::string json(int beats, int64_t frames) {
  return "{\"schema\":1,\"name\":\"t\",\"beats\":" + std::to_string(beats) + ",\"bpm\":128,\"frames\":" +
         std::to_string(frames) + ",\"datei\":\"loop.f32\"}";
}
static std::string fehler_von(const fs::path& d) {
  std::string f;
  auto l = cdj::lade_loop(d.string(), &f);
  PRUEF(!l);
  std::printf("%s: %s\n", d.filename().c_str(), f.c_str());
  return f;
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_loop_" + std::to_string(getpid()));
  schreibe(dir / "gut", json(4, 90000), 90000);
  std::string f;
  auto l = cdj::lade_loop((dir / "gut").string(), &f);
  PRUEF(l && f.empty());
  if (l) PRUEF(l->beats == 4 && l->frames == 90000 && l->daten.size() == 180000 && l->daten[179999] == 0.25f);
  schreibe(dir / "beats3", json(3, 67500), 67500);
  PRUEF(fehler_von(dir / "beats3").find("beats") != std::string::npos);
  // MVP 2 Scheibe 3 (E3): 1 Beat = 22 500 Frames; alte Datei mit takte (Hörtest 27.09.) wird als beats = 4 · takte gelesen
  schreibe(dir / "ein_beat", json(1, 22500), 22500);
  {
    auto e = cdj::lade_loop((dir / "ein_beat").string(), &f);
    PRUEF(e && e->beats == 1 && e->frames == 22500);
  }
  schreibe(dir / "alt", "{\"schema\":1,\"name\":\"c-155150-1t\",\"takte\":2,\"bpm\":128,\"frames\":180000,\"datei\":\"loop.f32\"}", 180000);
  {
    auto a = cdj::lade_loop((dir / "alt").string(), &f);
    PRUEF(a && a->beats == 8 && a->frames == 180000);
  }
  schreibe(dir / "alt3", "{\"schema\":1,\"takte\":3,\"bpm\":128,\"frames\":270000,\"datei\":\"loop.f32\"}", 270000);
  PRUEF(fehler_von(dir / "alt3").find("takte") != std::string::npos);
  schreibe(dir / "frames", json(8, 90000), 90000);
  PRUEF(fehler_von(dir / "frames").find("frames passt nicht") != std::string::npos);
  schreibe(dir / "bpm", "{\"schema\":1,\"beats\":4,\"bpm\":120,\"frames\":90000,\"datei\":\"loop.f32\"}", 90000);
  PRUEF(fehler_von(dir / "bpm").find("bpm") != std::string::npos);
  schreibe(dir / "groesse", json(4, 90000), 89999);
  PRUEF(fehler_von(dir / "groesse").find("Groesse") != std::string::npos);
  schreibe(dir / "ohne", json(4, 90000), -1);
  PRUEF(fehler_von(dir / "ohne").find("loop.f32 fehlt") != std::string::npos);
  schreibe(dir / "nan", json(4, 90000), 90000, NAN);
  PRUEF(fehler_von(dir / "nan").find("NaN") != std::string::npos);
  PRUEF(fehler_von(dir / "gibt_es_nicht").find("loop.json: fehlt") != std::string::npos);
  PRUEF(cdj::loop_name_ok("c-143012-2t") && !cdj::loop_name_ok("../x") && !cdj::loop_name_ok("") &&
        !cdj::loop_name_ok("Gross") && !cdj::loop_name_ok("abcdefghijklmnopqrstuvwxyz0123456"));
  PRUEF(cdj::loop_beats_ok(1) && cdj::loop_beats_ok(32) && !cdj::loop_beats_ok(3) && !cdj::loop_beats_ok(64));
  // Plan Grid: versatz_frames gelesen; fehlt = 0; Betrag >= frames oder nicht ganzzahlig = Fehler
  schreibe(dir / "v1", R"({"schema":1,"name":"v","beats":4,"bpm":128,"frames":90000,"datei":"loop.f32","versatz_frames":-1200})", 90000);
  { std::string fe; auto lv = cdj::lade_loop((dir / "v1").string(), &fe); PRUEF(lv && lv->versatz == -1200); }
  schreibe(dir / "v2", R"({"schema":1,"name":"v","beats":4,"bpm":128,"frames":90000,"datei":"loop.f32"})", 90000);
  { std::string fe; auto lv = cdj::lade_loop((dir / "v2").string(), &fe); PRUEF(lv && lv->versatz == 0); }
  schreibe(dir / "v3", R"({"schema":1,"name":"v","beats":4,"bpm":128,"frames":90000,"datei":"loop.f32","versatz_frames":90000})", 90000);
  PRUEF(fehler_von(dir / "v3").find("versatz_frames") != std::string::npos);
  schreibe(dir / "v4", R"({"schema":1,"name":"v","beats":4,"bpm":128,"frames":90000,"datei":"loop.f32","versatz_frames":1.5})", 90000);
  PRUEF(fehler_von(dir / "v4").find("versatz_frames") != std::string::npos);
  {  // Plan MVP 2 Scheibe 2 Task 2: schreibe_loop, Rundlauf über lade_loop
    fs::create_directories(dir / "schreiben");
    cdj::Mitschnitt m;
    std::snprintf(m.name, sizeof m.name, "rec1");
    m.beats = 4;
    m.frames = 90000;
    m.daten.assign((size_t)m.frames * 2, 0.375f);
    m.daten[0] = 0.5f;
    std::string f;
    PRUEF(cdj::schreibe_loop((dir / "schreiben").string(), m, &f) && f.empty());
    PRUEF(!fs::exists(dir / "schreiben" / ".rec1.neu"));
    auto l = cdj::lade_loop((dir / "schreiben" / "rec1").string(), &f);
    PRUEF(l && f.empty() && l->beats == 4 && l->frames == 90000 && l->daten[0] == 0.5f && l->daten[3] == 0.375f);
    // Name schon vergeben: kein Schreiben, keine .neu-Leiche
    cdj::Mitschnitt m2 = m;
    PRUEF(!cdj::schreibe_loop((dir / "schreiben").string(), m2, &f) && f.find("gibt es schon") != std::string::npos);
    PRUEF(!fs::exists(dir / "schreiben" / ".rec1.neu"));
    // Review intern: daten passt nicht zu frames -> Fehler statt Überlesen
    cdj::Mitschnitt m3 = m;
    std::snprintf(m3.name, sizeof m3.name, "rec3");
    m3.daten.resize(10);
    PRUEF(!cdj::schreibe_loop((dir / "schreiben").string(), m3, &f) && f.find("daten") != std::string::npos);
    PRUEF(!fs::exists(dir / "schreiben" / ".rec3.neu") && !fs::exists(dir / "schreiben" / "rec3"));
    {  // Keylock Slice 4: schreibe_loop bekommt FERTIGE Daten. Früher (Plan Tempo-Folge) tastete es einen Mitschnitt bei 130 BPM
       // (88 616 Frames) selbst per umtasten auf 90 000 Frames um und prüfte die Abweichung gegen einen Sinus; das änderte die
       // Tonhöhe. Jetzt: ohne umgerechnet-Vermerk lehnt es ab (nichts Halbes auf der Platte), mit Vermerk schreibt es die
       // Daten unverändert (bitgleich) und vermerkt aufnahme_bpm; die Umrechnung selbst prüft test_netz_rec_keylock.
      cdj::Mitschnitt t{};
      std::snprintf(t.name, sizeof t.name, "tempo130");
      t.beats = 4;
      t.frames = 4 * cdj::LOOP_SPB;
      t.roh_frames = 88616;
      t.bpm = 130.0;
      t.daten.assign((size_t)cdj::mitschnitt_max_frames(4) * 2, 0.0f);
      for (int64_t i = 0; i < t.roh_frames; ++i)
        t.daten[(size_t)(2 * i)] = t.daten[(size_t)(2 * i + 1)] = (float)std::sin(2.0 * 3.14159265358979323846 * 800.0 * (double)i / 88616.0);
      std::string f2;
      PRUEF(!cdj::schreibe_loop((dir / "schreiben").string(), t, &f2) && f2.find("umgerechnet") != std::string::npos);  // roh, nicht umgerechnet
      PRUEF(!fs::exists(dir / "schreiben" / "tempo130") && !fs::exists(dir / "schreiben" / ".tempo130.neu"));
      std::vector<float> fertig((size_t)t.frames * 2);  // "fertige" Daten: Zählwerte, damit Bitgleichheit etwas beweist
      for (size_t i = 0; i < fertig.size(); ++i) fertig[i] = (float)i * 0.25f;
      t.daten = fertig;
      t.umgerechnet = true;
      f2.clear();
      PRUEF(cdj::schreibe_loop((dir / "schreiben").string(), t, &f2) && f2.empty());
      auto zurueck = cdj::lade_loop((dir / "schreiben" / "tempo130").string(), &f2);
      PRUEF(zurueck && zurueck->frames == 90000 && zurueck->beats == 4);
      PRUEF(zurueck && zurueck->daten.size() == fertig.size() && std::memcmp(zurueck->daten.data(), fertig.data(), fertig.size() * 4) == 0);
      std::ifstream js(dir / "schreiben" / "tempo130" / "loop.json");
      std::string text((std::istreambuf_iterator<char>(js)), std::istreambuf_iterator<char>());
      PRUEF(text.find("aufnahme_bpm") != std::string::npos);
      std::ifstream js1(dir / "schreiben" / "rec1" / "loop.json");  // Negativ-Kontrolle: bei 128 BPM steht es nicht da
      std::string text1((std::istreambuf_iterator<char>(js1)), std::istreambuf_iterator<char>());
      PRUEF(!text1.empty() && text1.find("aufnahme_bpm") == std::string::npos);
    }
  }
  fs::remove_all(dir);
  PRUEF_ENDE();
}
