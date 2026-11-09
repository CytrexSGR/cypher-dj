// 1.15 "Mix tools" (A1b): how the Mixer finds the slot of a mix-tool controller row. The table of the rows is
// signalbox/tool_controls.h; the Mixer maps a row by the path after the channel ("gate/hold") to (tool, field), where the
// field is the position of the suffix among the rows of its tool (gate/an = 0 ... gate/sc = 8). The slots of one channel
// are the fields of the four per-channel tools one after the other; the spectrum source is one global slot.
#pragma once
#include <cstring>

#include "cypherdj/signalbox/tool_controls.h"

namespace cdj {

using MixWerkzeug = cypherdj::stellwerk::WzTool;

// Number of fields of a tool (rows of the table with this tool).
constexpr int wz_felder(MixWerkzeug t) {
  int n = 0;
  for (const auto& z : cypherdj::stellwerk::WERKZEUG_ZEILEN) n += z.tool == t;
  return n;
}
// First slot of a tool inside the slots of one channel (gate, utility, multiband, limiter in this order).
constexpr int wz_versatz(MixWerkzeug t) {
  int n = 0;
  for (int i = 0; i < static_cast<int>(t) && i < static_cast<int>(MixWerkzeug::spektrum); ++i) n += wz_felder(static_cast<MixWerkzeug>(i));
  return n;
}
constexpr int WZ_FELDER_JE_KANAL = wz_felder(MixWerkzeug::gate) + wz_felder(MixWerkzeug::utility) + wz_felder(MixWerkzeug::multiband) +
                                   wz_felder(MixWerkzeug::limiter);

// "gate/hold" -> (gate, 6). False if the suffix is not in the table. Not for the callback (string compare).
inline bool wz_suffix(const char* suffix, MixWerkzeug& tool, int& feld) {
  int pos[5] = {};
  for (const auto& z : cypherdj::stellwerk::WERKZEUG_ZEILEN) {
    const int t = static_cast<int>(z.tool);
    if (!std::strcmp(z.suffix, suffix)) {
      tool = z.tool;
      feld = pos[t];
      return true;
    }
    ++pos[t];
  }
  return false;
}

}  // namespace cdj
