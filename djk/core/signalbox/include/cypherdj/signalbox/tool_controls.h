// 1.15 "Mix tools" (A1b): the one flat table of the 345 tool rows of the controller table, INTERFACES section 1.5.
// Source of the numbers: docs/architecture/INTERFACES.md section 1.5 (the 345 mix-tool rows). Defaults equal the library defaults, ranges its clamps
// (gate.h, utility.h, multiband.h, channel_limiter.h). The Stellwerk loops in controls.cpp create the rows from it, the Mixer
// (mixer.cpp) maps them from it (matched on the path after the channel). One row per line, so a script can parse it.
//
// Channel sets: gate on the 13 live source channels, utility on those plus bus/1..4 (17), multiband and channel
// limiter on bus/1..4, spectrum one global row. erz/8 gets no row: it is cue only and returns before every insert.
// Not exposed on purpose: utility gain_db (trim and fader exist), per-band solo (monitoring tool), limiter vorhalt_ms and
// echtspitze (fixed after construction, kern.toml kanal_limiter_vorhalt_ms / kanal_limiter_echtspitze).
// How a bypassed tool is handled and when the parameters are read belong to the Mixer wiring, not to this table.
#pragma once
#include <cstdint>

#include "cypherdj/signalbox/controls.h"

namespace cypherdj::stellwerk {

enum class WzTool : uint8_t { gate, utility, multiband, limiter, spektrum };
// Which channels carry the row: the 13 live sources (deck/1..4, erz/1..7, pad/1..2), the 13 sources plus the 4 buses, the 4
// buses, or none (one global row without a channel).
enum class WzKanalart : uint8_t { quellen, quellen_busse, busse, global };

struct WerkzeugZeile {
  WzTool tool;
  const char* suffix;   // path after the channel: "gate/an"; the global row carries its whole path
  float min, max, vorgabe;
  KurvenTyp kurve;      // schalter for switches, stufen for steps, linear otherwise
  int ms;               // switching ramp in milliseconds, 0 for switches and steps
  bool ganz;            // switch or steps: integer value, no ramp (like komp/*)
  WzKanalart kanalart;
};

inline constexpr const char* WERKZEUG_QUELLEN[] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3",
                                                   "erz/4",  "erz/5",  "erz/6",  "erz/7",  "pad/1", "pad/2"};
inline constexpr const char* WERKZEUG_BUSSE[] = {"bus/1", "bus/2", "bus/3", "bus/4"};
inline constexpr int WERKZEUG_N_QUELLEN = sizeof WERKZEUG_QUELLEN / sizeof WERKZEUG_QUELLEN[0];
inline constexpr int WERKZEUG_N_BUSSE = sizeof WERKZEUG_BUSSE / sizeof WERKZEUG_BUSSE[0];

// One row per line: {tool, suffix, min, max, default, curve, ramp ms, integer, channels}
inline constexpr WerkzeugZeile WERKZEUG_ZEILEN[] = {
    {WzTool::gate, "gate/an", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::quellen},
    {WzTool::gate, "gate/schwelle", -90, 0, -40, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/hysterese", 0, 24, 4, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/ratio", 1, 100, 100, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/bereich", -120, 0, -80, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/attack", 0.1f, 500, 1, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/hold", 0, 2000, 20, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/release", 1, 5000, 100, KurvenTyp::linear, 10, false, WzKanalart::quellen},
    {WzTool::gate, "gate/sc", 0, 14, 0, KurvenTyp::stufen, 0, true, WzKanalart::quellen},
    {WzTool::utility, "util/balance", -1, 1, 0, KurvenTyp::linear, 10, false, WzKanalart::quellen_busse},
    {WzTool::utility, "util/breite", 0, 200, 100, KurvenTyp::linear, 10, false, WzKanalart::quellen_busse},
    {WzTool::utility, "util/bassmono", 0, 500, 0, KurvenTyp::linear, 10, false, WzKanalart::quellen_busse},
    {WzTool::utility, "util/phase_l", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::quellen_busse},
    {WzTool::utility, "util/phase_r", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::quellen_busse},
    {WzTool::utility, "util/tausch", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::quellen_busse},
    {WzTool::utility, "util/dc", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::quellen_busse},
    {WzTool::multiband, "mb/an", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::busse},
    {WzTool::multiband, "mb/grenze_tief", 20, 20000, 200, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/grenze_hoch", 20, 20000, 2000, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/schwelle", -60, 0, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/ratio", 1, 20, 1, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/attack", 0.1f, 500, 10, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/release", 1, 5000, 100, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/knie", 0, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/makeup", -24, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/tief/umgehen", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/schwelle", -60, 0, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/ratio", 1, 20, 1, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/attack", 0.1f, 500, 10, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/release", 1, 5000, 100, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/knie", 0, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/makeup", -24, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/mitte/umgehen", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/schwelle", -60, 0, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/ratio", 1, 20, 1, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/attack", 0.1f, 500, 10, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/release", 1, 5000, 100, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/knie", 0, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/makeup", -24, 24, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::multiband, "mb/hoch/umgehen", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::busse},
    {WzTool::limiter, "lim/an", 0, 1, 0, KurvenTyp::schalter, 0, true, WzKanalart::busse},
    {WzTool::limiter, "lim/decke", -60, 0, -0.3f, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::limiter, "lim/abklingen", 1, 2000, 80, KurvenTyp::linear, 10, false, WzKanalart::busse},
    {WzTool::spektrum, "spektrum/kanal", 0, 19, 0, KurvenTyp::stufen, 0, true, WzKanalart::global},
};
inline constexpr int WERKZEUG_N_ZEILEN = sizeof WERKZEUG_ZEILEN / sizeof WERKZEUG_ZEILEN[0];

// Rows of the controller table the table above produces (channels per row summed): 345.
constexpr int werkzeug_zaehlen() {
  int n = 0;
  for (const WerkzeugZeile& z : WERKZEUG_ZEILEN) {
    switch (z.kanalart) {
      case WzKanalart::quellen: n += WERKZEUG_N_QUELLEN; break;
      case WzKanalart::quellen_busse: n += WERKZEUG_N_QUELLEN + WERKZEUG_N_BUSSE; break;
      case WzKanalart::busse: n += WERKZEUG_N_BUSSE; break;
      case WzKanalart::global: n += 1; break;
    }
  }
  return n;
}
inline constexpr int WERKZEUG_REGLER = werkzeug_zaehlen();

}  // namespace cypherdj::stellwerk
