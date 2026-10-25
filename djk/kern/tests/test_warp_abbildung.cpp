// Paket 1.13 Warp, Slice 1: die Abbildung W(b) des Kerns (cypherdj/warp_abbildung.h) gegen die gemeinsame Referenzdatei
// vertrag/warp_referenz.json (1000 Fälle, exakt gerechnet von vertrag/erzeuge_warp_referenz.py; TS und JS prüfen dieselbe Datei in
// oberflaeche/tests/warp_abbildung.test.mjs). Der Kern rechnet in Frames: die Quellsekunden der Datei mal 48 000, relative Toleranz 1e-12.
// Dazu die Gegenprobe der Messung: ein Warp mit absichtlich falscher Steigung fällt an derselben Datei durch.
#include <cmath>
#include <fstream>
#include <vector>

#include <nlohmann/json.hpp>

#include "cypherdj/warp_abbildung.h"
#include "pruef.h"

int main() {
  const std::string datei = std::string(CYPHERDJ_DJK) + "/vertrag/warp_referenz.json";
  std::ifstream f(datei);
  PRUEF(static_cast<bool>(f));
  const nlohmann::json j = nlohmann::json::parse(f);
  const double tol = j.at("toleranz_relativ").get<double>();
  int faelle = 0, falsch = 0, grob_daneben = 0;
  for (const nlohmann::json& fall : j.at("faelle")) {
    std::vector<double> beat, frame;
    for (const nlohmann::json& m : fall.at("marker")) {
      frame.push_back(m.at(0).get<double>() * 48000.0);
      beat.push_back(m.at(1).get<double>());
    }
    cdj::ArrWarp w;
    w.n = static_cast<int32_t>(beat.size());
    w.beat = beat.data();
    w.frame = frame.data();
    const double b = fall.at("beat").get<double>();
    const double soll = fall.at("quell_s").get<double>() * 48000.0;
    const double ist = cdj::warp_frame(w, b);
    if (std::fabs(ist - soll) > tol * std::max(1.0, std::fabs(soll))) ++falsch;
    // Gegenprobe: dieselben Marker, aber die Gerade zwischen erstem und letztem (ein Segment) ist an vielen Fällen daneben
    const double gerade = frame.front() + (b - beat.front()) * (frame.back() - frame.front()) / (beat.back() - beat.front());
    if (std::fabs(gerade - soll) > tol * std::max(1.0, std::fabs(soll))) ++grob_daneben;
    ++faelle;
  }
  std::printf("%d Fälle, %d falsch, die Gerade wäre bei %d daneben\n", faelle, falsch, grob_daneben);
  PRUEF(faelle == 1000);
  PRUEF(falsch == 0);
  PRUEF(grob_daneben > 300);
  PRUEF_ENDE();
}
