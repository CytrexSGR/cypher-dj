// Plan 2026-09-27 Task 2: Kit laden (ADR 024). Gutes Kit mit zwei Klängen; jede Prüfung einzeln verletzt.
#include <unistd.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "cypherdj/kit.h"
#include "pruef.h"

namespace fs = std::filesystem;

static void f32(const fs::path& p, std::vector<float> d) {
  std::ofstream o(p, std::ios::binary);
  o.write(reinterpret_cast<const char*>(d.data()), (std::streamsize)(d.size() * sizeof(float)));
}
static void text(const fs::path& p, const std::string& t) { std::ofstream(p) << t; }
static const cdj::KitKlang* bei(const cdj::Kit& k, int n) { return n < cdj::KIT_KLAENGE ? &k.klang[n] : nullptr; }
static std::string fehler_von(const fs::path& ordner) {
  std::string f;
  auto k = cdj::lade_kit(ordner.string(), &f);
  PRUEF(!k);
  return f;
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_kit_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  f32(dir / "gut/bd_0.f32", {0.5f, 0.5f, 0.25f, 0.25f});
  f32(dir / "gut/hh_0.f32", {0.1f, -0.1f});
  text(dir / "gut/kit.json", R"({"schema":1,"name":"gut","klaenge":[
    {"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2},
    {"note":5,"name":"hh:0","datei":"hh_0.f32","frames":1}]})");
  std::string f;
  auto k = cdj::lade_kit((dir / "gut").string(), &f);
  PRUEF(k && f.empty());
  if (k) {
    PRUEF(k->n == 2 && k->name == "gut");
    PRUEF(k->klang[0].frames == 2 && k->klang[0].daten.size() == 4 && k->klang[0].daten[2] == 0.25f);
    PRUEF(k->klang[5].frames == 1 && k->klang[5].daten[1] == -0.1f && k->klang[5].name == "hh:0");
    PRUEF(k->klang[1].frames == 0);  // Note ohne Klang
  }
  // Fehlerfälle, je ein Ordner
  auto fall = [&](const char* name, const std::string& json, bool mit_daten = true) {
    fs::create_directories(dir / name);
    if (mit_daten) f32(dir / name / "bd_0.f32", {0.5f, 0.5f, 0.25f, 0.25f});
    text(dir / name / "kit.json", json);
    const std::string t = fehler_von(dir / name);
    std::printf("%s: %s\n", name, t.c_str());
    return t;
  };
  const std::string ok1 = R"({"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2})";
  PRUEF(fall("schema", R"({"schema":2,"klaenge":[)" + ok1 + "]}").find("schema") != std::string::npos);
  PRUEF(fall("leer", R"({"schema":1,"klaenge":[]})").find("keine klaenge") != std::string::npos);
  PRUEF(fall("note", R"({"schema":1,"klaenge":[{"note":128,"name":"x","datei":"bd_0.f32","frames":2}]})").find("note 128") != std::string::npos);
  PRUEF(fall("doppelt", R"({"schema":1,"klaenge":[)" + ok1 + "," + ok1 + "]}").find("doppelt") != std::string::npos);
  PRUEF(fall("pfad", R"({"schema":1,"klaenge":[{"note":0,"name":"x","datei":"../gut/bd_0.f32","frames":2}]})").find("unzulaessig") != std::string::npos);
  PRUEF(fall("groesse", R"({"schema":1,"klaenge":[{"note":0,"name":"x","datei":"bd_0.f32","frames":3}]})").find("Groesse") != std::string::npos);
  PRUEF(fall("fehlt", R"({"schema":1,"klaenge":[)" + ok1 + "]}", false).find("fehlt") != std::string::npos);
  fs::create_directories(dir / "nan");
  f32(dir / "nan/bd_0.f32", {0.5f, NAN, 0.25f, 0.25f});
  text(dir / "nan/kit.json", R"({"schema":1,"klaenge":[)" + ok1 + "]}");
  PRUEF(fehler_von(dir / "nan").find("NaN") != std::string::npos);
  PRUEF(fehler_von(dir / "gibt_es_nicht").find("kit.json: fehlt") != std::string::npos);
  // MVP 2 Scheibe 3 (E2): zwei Kits zu einem verschmolzen (kit:<a>+<b>). "gut" hat Noten 0 und 5.
  {
    fs::create_directories(dir / "rec");
    f32(dir / "rec/rec0_0.f32", {0.75f, 0.75f, 0.5f, 0.5f, 0.25f, 0.25f});
    text(dir / "rec/kit.json", R"({"schema":1,"name":"rec","klaenge":[
      {"note":112,"name":"rec0:0","datei":"rec0_0.f32","frames":3}]})");
    std::string f2;
    auto m = cdj::lade_kits((dir / "gut").string(), (dir / "rec").string(), &f2);
    PRUEF(m && f2.empty());
    if (m) {
      PRUEF(m->n == 3 && m->name == "gut+rec");
      PRUEF(m->klang[0].frames == 2 && m->klang[5].name == "hh:0");
      PRUEF(bei(*m, 128 + 112) && bei(*m, 128 + 112)->frames == 3 && bei(*m, 128 + 112)->name == "rec0:0" && bei(*m, 128 + 112)->daten[4] == 0.25f);  // F08: Zusatz-Kit auf 128 + note
    }
    // zweites Kit fehlt ganz (erster Start, noch kein Mitschnitt übergeben): nur das erste, kein Fehler
    auto nur = cdj::lade_kits((dir / "gut").string(), (dir / "rec_fehlt").string(), &f2);
    PRUEF(nur && nur->n == 2 && nur->name == "gut");
    // F08 (Glanz 2.4.2): dieselbe Note in beiden ist kein Fehler mehr, b liegt auf 128 + note
    fs::create_directories(dir / "kollision");
    f32(dir / "kollision/x_0.f32", {0.1f, 0.1f});
    text(dir / "kollision/kit.json", R"({"schema":1,"klaenge":[{"note":5,"name":"x:0","datei":"x_0.f32","frames":1}]})");
    std::string f3;
    auto k2 = cdj::lade_kits((dir / "gut").string(), (dir / "kollision").string(), &f3);
    PRUEF(k2 && f3.empty());
    if (k2) PRUEF(k2->n == 3 && k2->klang[5].name == "hh:0" && bei(*k2, 128 + 5) && bei(*k2, 128 + 5)->name == "x:0");
    // F08 Fehlerfall am Bestand: 112 Klänge in a (wie battery) und 38 in b auf 73..110 (wie rec): 150 > 128
    auto kit_mit = [&](const std::string& name, int ab, int anzahl) {
      fs::create_directories(dir / name);
      std::string j = R"({"schema":1,"name":")" + name + R"(","klaenge":[)";
      for (int i = 0; i < anzahl; ++i) {
        const std::string d = name + std::to_string(i) + ".f32";
        f32(dir / name / d, {0.1f, 0.1f});
        j += (i ? "," : "") + std::string(R"({"note":)") + std::to_string(ab + i) + R"(,"name":")" + name +
             std::to_string(i) + R"(:0","datei":")" + d + R"(","frames":1})";
      }
      text(dir / name / "kit.json", j + "]}");
    };
    kit_mit("voll", 0, 112);
    kit_mit("zus", 73, 38);
    std::string f5;
    auto gross = cdj::lade_kits((dir / "voll").string(), (dir / "zus").string(), &f5);
    std::printf("F08: voll+zus %s %s\n", gross ? "geladen" : "abgelehnt:", f5.c_str());
    PRUEF(gross && f5.empty());
    if (gross) PRUEF(gross->n == 150 && gross->klang[73].name == "voll73:0" && bei(*gross, 128 + 73) &&
                     bei(*gross, 128 + 73)->name == "zus0:0" && bei(*gross, 128 + 110) && bei(*gross, 128 + 110)->name == "zus37:0");
    // zweites Kit vorhanden, aber kaputt → Fehler (nicht still ohne es weiter)
    std::string f4;
    PRUEF(!cdj::lade_kits((dir / "gut").string(), (dir / "schema").string(), &f4) && f4.find("schema") != std::string::npos);
  }
  fs::remove_all(dir);
  PRUEF_ENDE();
}
