// Paket 1.13 Warp, Slice 1: die Abbildung W(b) des Kerns (cypherdj/warp_abbildung.h) gegen die gemeinsame Referenzdatei
// vertrag/warp_referenz.json (1000 Fälle, exakt gerechnet von vertrag/erzeuge_warp_referenz.py; TS und JS prüfen dieselbe Datei in
// oberflaeche/tests/warp_abbildung.test.mjs). Der Kern rechnet in Frames: die Quellsekunden der Datei mal 48 000, relative Toleranz 1e-12.
// Dazu die Gegenprobe der Messung: ein Warp mit absichtlich falscher Steigung fällt an derselben Datei durch.
// Paket 1.13 Slice 2: warp_steigung (W', Frames je Beat; das Warp-Werk braucht sie für die Geschwindigkeit) gegen den Differenzenquotienten
// derselben 1000 Fälle, wo die Stelle mitten in einem Segment liegt; die Modus-Konstanten und arr_warp_werk_modus.
#include <algorithm>
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
  int faelle = 0, falsch = 0, grob_daneben = 0, steigung_geprueft = 0, steigung_falsch = 0, steigung_gerade_falsch = 0;
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
    const double h = 1e-4;   // Beats; beide Nachbarn im selben Segment, sonst wäre der Differenzenquotient keine Steigung
    if (cdj::warp_segment(w, b - h) == cdj::warp_segment(w, b + h)) {
      const double diff = (cdj::warp_frame(w, b + h) - cdj::warp_frame(w, b - h)) / (2.0 * h);
      const double st = cdj::warp_steigung(w, b);
      ++steigung_geprueft;
      if (std::fabs(diff - st) > 1e-6 * std::fabs(st)) ++steigung_falsch;
      const double gerade_st = (frame.back() - frame.front()) / (beat.back() - beat.front());   // Gegenprobe: die Steigung der Geraden
      if (std::fabs(diff - gerade_st) > 1e-6 * std::fabs(st)) ++steigung_gerade_falsch;
    }
  }
  std::printf("Steigung: %d geprüft, %d falsch, die Gerade wäre bei %d daneben\n", steigung_geprueft, steigung_falsch, steigung_gerade_falsch);
  PRUEF(steigung_geprueft > 800);
  PRUEF(steigung_falsch == 0);
  PRUEF(steigung_gerade_falsch > 300);
  {  // Slice 3a (Task 4): große Marker-Sätze (100, 865, 2321, 4096) aus warp_referenz_viele.json
    std::ifstream g(std::string(CYPHERDJ_DJK) + "/vertrag/warp_referenz_viele.json");
    PRUEF(static_cast<bool>(g));
    const nlohmann::json v = nlohmann::json::parse(g);
    int gesamt = 0, daneben = 0;
    size_t groesster = 0;
    for (const nlohmann::json& satz : v.at("saetze")) {
      std::vector<double> beat, frame;
      for (const nlohmann::json& m : satz.at("marker")) {
        frame.push_back(m.at(0).get<double>() * 48000.0);
        beat.push_back(m.at(1).get<double>());
      }
      groesster = std::max(groesster, beat.size());
      cdj::ArrWarp w;
      w.n = static_cast<int32_t>(beat.size());
      w.beat = beat.data();
      w.frame = frame.data();
      for (const nlohmann::json& fall : satz.at("faelle")) {
        const double soll = fall.at("quell_s").get<double>() * 48000.0;
        const double ist = cdj::warp_frame(w, fall.at("beat").get<double>());
        if (std::fabs(ist - soll) > tol * std::max(1.0, std::fabs(soll))) ++daneben;
        ++gesamt;
      }
    }
    std::printf("große Sätze: %d Fälle, %d falsch, größter Satz %zu Marker\n", gesamt, daneben, groesster);
    PRUEF(gesamt == 160 && daneben == 0 && groesster == 4096);
  }
  PRUEF(cdj::arr_warp_werk_modus(cdj::ARR_WARP_COMPLEX) && cdj::arr_warp_werk_modus(cdj::ARR_WARP_TONES));
  PRUEF(!cdj::arr_warp_werk_modus(cdj::ARR_WARP_REPITCH) && !cdj::arr_warp_werk_modus(cdj::ARR_WARP_BEATS) && !cdj::arr_warp_werk_modus(4));
  std::printf("%d Fälle, %d falsch, die Gerade wäre bei %d daneben\n", faelle, falsch, grob_daneben);
  PRUEF(faelle == 1000);
  PRUEF(falsch == 0);
  PRUEF(grob_daneben > 300);
  PRUEF_ENDE();
}
