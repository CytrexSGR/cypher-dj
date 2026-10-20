// cypherdj-nulltest (Paket K3, Spec D1 A7): Vorbedingungen prüfen und Live gegen Render vergleichen.
//   cypherdj-nulltest --vorbedingung --bpm T [--zustand pfad] [--metronom-an 0|1] [--fx-master 0|1]
//     Neustart-Zustand des laufenden Kerns (nur lesend). --metronom-an: metronom_an aus dem letzten /zustand/arr;
//     --fx-master 1: eine FX-Einheit hängt an master (/e/fx/zuweisung) und ist an oder seit weniger als 5 s aus (/e/fx),
//     beides aus dem SSE-Anfangsbild (der Neustart-Zustand trägt keinen FX-Stand, der Export nimmt FX nicht mit).
//     Ausgabe {"vorbedingung":"erfuellt"|"verletzt","verstoesse":[…]}.
//     Rückgabe 0 erfüllt, 1 verletzt, 2 Aufruf (Fix L8: auch ein Wert, der keine Zahl ist, und eine ungültige
//     CYPHERDJ_INSTANZ, je mit Text), 3 Zustand fehlt.
//   cypherdj-nulltest --live <f32> --live-s0 S --grenze G --ursprung U --render <wav> --start-sample R --frames F
//                     --vorhalt V --quantum Q
//     live: Mitschnitt (cypherdj-mitschnitt: datei, s0, grenze); U: ursprung_sample aus /zustand/arr des Laufs; render:
//     WAV und Angaben aus der Ausgabe von cypherdj-render. Ausgabe {"urteil","ursache","rest_db","signal_db",
//     "verschoben_db","fenster","schlimmstes","phase_live","phase_render"}; urteil bestanden, rot oder ungueltig mit ursache. Rückgabe 0 bestanden, 1 rot, 2 Aufruf,
//     3 ungültig (auch: Blockphase live ≠ Render, Mitschnitt zu kurz).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "cypherdj/aufruf_zahl.h"
#include "cypherdj/instanz.h"
#include "cypherdj/json_text.h"
#include "cypherdj/nulltest.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/wav.h"
#include "cypherdj/zustand_datei.h"
#include "cypherdj/zustand_lesen.h"

namespace {

int hilfe() {
  std::fprintf(stderr, "Aufruf: cypherdj-nulltest --vorbedingung --bpm T [--zustand pfad] [--metronom-an 0|1] [--fx-master 0|1]\n"
                       "        cypherdj-nulltest --live f32 --live-s0 S --grenze G --ursprung U --render wav"
                       " --start-sample R --frames F --vorhalt V --quantum Q\n");
  return 2;
}

void ungueltig(const char* ursache, int pl, int pr) {
  std::printf("{\"urteil\":\"ungueltig\",\"ursache\":%s,\"phase_live\":%d,\"phase_render\":%d}\n",
              cdj::json_text(ursache).c_str(), pl, pr);
}

}  // namespace

int main(int argc, char** argv) {
  if (!cdj::instanz_gueltig("cypherdj-nulltest")) return 2;   // Fix L8: mit Hinweis
  bool vorbedingung = false;
  double bpm = 0.0;
  int metronom = 0, fx_master = 0, quantum = 0, vorhalt = -1;
  int64_t live_s0 = -1, grenze = -1, ursprung = -1, start = -1, frames = 0;
  std::string zustand, live, render;
  // Fix L8: jede Zahl streng (ganz verbraucht, endlich, im Bereich), sonst Rückgabe 2 mit dem Schalter
  auto falsch = [&](int i, const char* erwartet) { return cdj::wert_falsch("cypherdj-nulltest", argv[i - 1], argv[i], erwartet); };
  auto ganz = [&](int& i, int64_t min, int64_t max, int64_t& aus) { return cdj::lies_ganz(argv[++i], min, max, aus); };
  for (int i = 1; i < argc; ++i) {
    const bool w = i + 1 < argc;
    int64_t g = 0;
    if (!std::strcmp(argv[i], "--vorbedingung")) {
      vorbedingung = true;
    } else if (!std::strcmp(argv[i], "--bpm") && w) {
      if (!cdj::lies_zahl(argv[++i], bpm)) return falsch(i, "endliche Zahl");
    } else if (!std::strcmp(argv[i], "--zustand") && w) {
      zustand = argv[++i];
    } else if (!std::strcmp(argv[i], "--metronom-an") && w) {
      if (!ganz(i, 0, 1, g)) return falsch(i, "0 oder 1");
      metronom = static_cast<int>(g);
    } else if (!std::strcmp(argv[i], "--fx-master") && w) {
      if (!ganz(i, 0, 1, g)) return falsch(i, "0 oder 1");
      fx_master = static_cast<int>(g);
    } else if (!std::strcmp(argv[i], "--live") && w) {
      live = argv[++i];
    } else if (!std::strcmp(argv[i], "--live-s0") && w) {
      if (!ganz(i, 0, INT64_MAX, live_s0)) return falsch(i, "ganze Zahl >= 0");
    } else if (!std::strcmp(argv[i], "--grenze") && w) {
      if (!ganz(i, 0, INT64_MAX, grenze)) return falsch(i, "ganze Zahl >= 0");
    } else if (!std::strcmp(argv[i], "--ursprung") && w) {
      if (!ganz(i, 0, INT64_MAX, ursprung)) return falsch(i, "ganze Zahl >= 0");
    } else if (!std::strcmp(argv[i], "--render") && w) {
      render = argv[++i];
    } else if (!std::strcmp(argv[i], "--start-sample") && w) {
      if (!ganz(i, 0, INT64_MAX, start)) return falsch(i, "ganze Zahl >= 0");
    } else if (!std::strcmp(argv[i], "--frames") && w) {
      if (!ganz(i, 1, INT64_MAX, frames)) return falsch(i, "ganze Zahl >= 1");
    } else if (!std::strcmp(argv[i], "--vorhalt") && w) {
      if (!ganz(i, 0, 1 << 20, g)) return falsch(i, "ganze Zahl 0..1048576");
      vorhalt = static_cast<int>(g);
    } else if (!std::strcmp(argv[i], "--quantum") && w) {
      if (!ganz(i, 16, 8192, g)) return falsch(i, "ganze Zahl 16..8192");
      quantum = static_cast<int>(g);
    } else {
      return hilfe();
    }
  }
  if (vorbedingung) {
    if (!(bpm >= 60.0 && bpm <= 200.0)) return hilfe();
    std::string fehler;
    const auto f = cdj::lies_echtzeit_fach(zustand.empty() ? cdj::ZustandDatei::pfad_fuer(cdj_instanz()) : zustand, fehler);
    if (!f) {
      std::fprintf(stderr, "Neustart-Zustand: %s\n", fehler.c_str());
      return 3;
    }
    const cypherdj::stellwerk::ReglerTabelle tab;
    const std::vector<std::string> v = cdj::null_vorbedingungen(*f, tab, bpm, metronom != 0, fx_master != 0);
    std::printf("{\"vorbedingung\":\"%s\",\"verstoesse\":[", v.empty() ? "erfuellt" : "verletzt");
    for (size_t i = 0; i < v.size(); ++i) std::printf("%s%s", i ? "," : "", cdj::json_text(v[i]).c_str());   // Fix L7
    std::printf("]}\n");
    return v.empty() ? 0 : 1;
  }
  if (live.empty() || render.empty() || live_s0 < 0 || grenze < 0 || ursprung < 0 || start < 0 || frames <= 0 ||
      vorhalt < 0 || quantum < 16)
    return hilfe();
  const int pl = cdj::null_phase(ursprung, grenze, quantum), pr = cdj::null_phase(start, 0, quantum);
  if (pl != pr) {
    ungueltig("phase", pl, pr);
    return 3;
  }
  std::vector<float> ll, lr, rl, rr;
  std::ifstream f(live, std::ios::binary | std::ios::ate);
  if (!f) return hilfe();
  const std::streamsize bytes = f.tellg();
  f.seekg(0);
  std::vector<float> roh(static_cast<size_t>(bytes / 4));
  f.read(reinterpret_cast<char*>(roh.data()), static_cast<std::streamsize>(roh.size() * 4));
  for (size_t i = 0; i + 1 < roh.size(); i += 2) {
    ll.push_back(roh[i]);
    lr.push_back(roh[i + 1]);
  }
  std::string fehler;
  if (!cdj::lies_wav_f32(render, rl, rr, fehler)) {
    std::fprintf(stderr, "%s\n", fehler.c_str());
    return 2;
  }
  const long long ab = ursprung + vorhalt - live_s0;
  if (ab < 0 || ab >= static_cast<long long>(ll.size())) {
    ungueltig("mitschnitt_zu_kurz", pl, pr);
    return 3;
  }
  const cdj::NullErgebnis e =
      cdj::null_vergleich(ll.data() + ab, lr.data() + ab, static_cast<int64_t>(ll.size()) - ab, rl.data(), rr.data(),
                          static_cast<int64_t>(rl.size()), frames);
  std::printf("{\"urteil\":%s,\"ursache\":%s,\"rest_db\":%.2f,\"signal_db\":%.2f,\"verschoben_db\":%.2f,"
              "\"fenster\":%lld,\"schlimmstes\":%lld,\"phase_live\":%d,\"phase_render\":%d}\n",
              cdj::json_text(cdj::null_urteil_text(e.urteil)).c_str(), cdj::json_text(e.ursache).c_str(), e.rest_db,
              e.signal_db, e.verschoben_db,
              (long long)e.fenster, (long long)e.schlimmstes, pl, pr);
  return e.urteil == cdj::NullUrteil::bestanden ? 0 : e.urteil == cdj::NullUrteil::rot ? 1 : 3;
}
