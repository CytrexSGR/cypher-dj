// Scheibe 19: Kurven gegen Tabellen (§7.2 kurve.typ linear und fader_db). Weg wie im Kern: MIDI-Wert -> Übersetzer
// (x = wert / 127) -> Kurve aus dem Mapping -> stellwerk::ReglerTabelle::aus_x. Die Sollwerte sind unabhängig mit
// Python gerechnet (x < 0,001 heißt unter -60 dB und damit stumm = -200 dB, §1.2).
#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "hand/mapping.h"
#include "hand/uebersetzer.h"
#include "pruef.h"

using namespace hand;
using stellwerk::ReglerTabelle;

namespace {

std::string datei(const char* name) {
  std::ifstream f(std::string(HAND_TESTDATEN) + "/" + name);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

const ReglerTabelle& tab() {
  static const ReglerTabelle t;
  return t;
}

// Wert am Regler für den CC-Wert v über den ganzen Weg
float ueber_midi(const Mapping& m, int eintrag, uint8_t v) {
  Uebersetzer u(&m);
  const Nachricht& n = m.eintrag[eintrag].nachricht;
  const uint8_t d[3] = {static_cast<uint8_t>(0xB0 | (n.kanal - 1)), n.nr, v};
  Ausgabe a{};
  if (u.ereignis(d, 3, 0, 0, 256, &a) != 1 || a.art != AusgabeArt::regler_absolut) return 999.0f;
  return ReglerTabelle::aus_x(m.eintrag[eintrag].kurve, a.x);
}

}  // namespace

FALL(fader_db_tabelle_ueber_midi) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(datei("beispiel_7_2.json").c_str(), tab(), m.get(), &f));
  const struct { uint8_t v; double db; } T[] = {{0, -200.0},   {1, -42.0761},  {2, -36.0555},  {8, -24.0143}, {32, -11.9731},
                                                {64, -5.9525}, {100, -2.0761}, {126, -0.0687}, {127, 0.0}};
  for (const auto& t : T) PRUEFE_NAH(ueber_midi(*m, 1, t.v), t.db, 1e-3);
}

FALL(fader_db_unter_minus_60_stumm) {
  // Stellungen, die 7 Bit nicht erreichen, aber /test/hand (midi_roh 0 bis 1) schon
  const stellwerk::Kurve k{stellwerk::KurvenTyp::fader_db, -200.0f, 0.0f, false};
  const struct { float x; double db; } T[] = {{0.0f, -200.0},    {0.0005f, -200.0}, {0.000999f, -200.0},
                                              {0.001f, -60.0},   {0.00101f, -59.9136}, {0.01f, -40.0},
                                              {0.1f, -20.0},     {0.5f, -6.0206},   {1.0f, 0.0}};
  for (const auto& t : T) PRUEFE_NAH(ReglerTabelle::aus_x(k, t.x), t.db, 1e-3);
  // die Standard-Kurve des Faders ist dieselbe
  const int r = tab().suche("deck/1/fader");
  PRUEFE(tab().def(r).kurve.typ == stellwerk::KurvenTyp::fader_db);
  PRUEFE_NAH(ReglerTabelle::aus_x(tab().def(r).kurve, 0.0005f), -200.0, 0);
}

FALL(linear_mit_und_ohne_kill_unter_min) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string mit = datei("beispiel_7_2.json");
  PRUEFE(lade(mit.c_str(), tab(), m.get(), &f));
  const struct { uint8_t v; double mit_kill, ohne_kill; } T[] = {
      {0, -200.0, -26.0}, {1, -25.748, -25.748}, {32, -17.937, -17.937}, {64, -9.874, -9.874}, {96, -1.811, -1.811}, {127, 6.0, 6.0}};
  // Der EQ-Eintrag ist relativ; für die Tabelle zählt die Kurve, darum direkt mit x = v / 127
  for (const auto& t : T) PRUEFE_NAH(ReglerTabelle::aus_x(m->eintrag[0].kurve, t.v / 127.0f), t.mit_kill, 1e-3);
  std::string ohne = mit;
  const size_t p = ohne.find(",\"kill_unter_min\":true");
  ohne.erase(p, std::strlen(",\"kill_unter_min\":true"));
  PRUEFE(lade(ohne.c_str(), tab(), m.get(), &f));
  PRUEFE(!m->eintrag[0].kurve.kill_unter_min);
  for (const auto& t : T) PRUEFE_NAH(ReglerTabelle::aus_x(m->eintrag[0].kurve, t.v / 127.0f), t.ohne_kill, 1e-3);
}

FALL(linear_crossfader_ueber_midi) {
  const char* text =
      "{\"version\":1,\"geraet\":\"x\",\"quelle_port\":\"q\",\"eintraege\":[\n"
      "{\"nachricht\":{\"typ\":\"cc\",\"kanal\":16,\"nr\":8},\"ziel\":\"xfader\",\"art\":\"absolut\",\"kurve\":{\"typ\":\"linear\",\"min\":-1,\"max\":1}}]}";
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(text, tab(), m.get(), &f));
  const struct { uint8_t v; double w; } T[] = {{0, -1.0}, {1, -0.98425}, {64, 0.00787}, {126, 0.98425}, {127, 1.0}};
  for (const auto& t : T) PRUEFE_NAH(ueber_midi(*m, 0, t.v), t.w, 1e-4);
}

FALL(fehlerfall_x_durch_128_statt_127_trifft_0_db_nicht) {
  // Vergleich: wer x = wert / 128 rechnet, erreicht am Anschlag nie 0 dB (Mutation M02 in der Matrix)
  const stellwerk::Kurve k{stellwerk::KurvenTyp::fader_db, -200.0f, 0.0f, false};
  PRUEFE(ReglerTabelle::aus_x(k, 127.0f / 128.0f) < -0.06f);
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 127.0f / 127.0f), 0.0, 0);
}

PRUEF_MAIN
