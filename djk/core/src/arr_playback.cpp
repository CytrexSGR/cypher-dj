// D1 K1: Wiedergabe lesen, prüfen, Audio laden (arr_playback.h). Muster: rendition.cpp (nlohmann, Feldprüfung mit
// Namen), loader.cpp (mmap + MAP_POPULATE + mlock, Budget vor dem Einblenden).
#include "cypherdj/arr_playback.h"
#include "cypherdj/arrangement.h"   // S1b K2: ARR_F_FILTER and arr_f_send (header-only constants) for the cell envelope fields
#include "cypherdj/warp_factory.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/pult_table.h"
#include "cypherdj/arr_key.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/generator.h"

#include "cypherdj/cypher_bk_ffi.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iterator>
#include <new>
#include <set>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace cdj {

namespace {

using json = nlohmann::json;

// Fehler mit Grund-Code (Spec 3.1) und Meldung
struct Abbruch : std::runtime_error {
  std::string grund;
  Abbruch(std::string g, const std::string& m) : std::runtime_error(m), grund(std::move(g)) {}
};

[[noreturn]] void format(const std::string& m) { throw Abbruch("format", m); }

// The one table of lane targets (automation slice 2): project string -> core target, device parameter index, range and form rule. The ranges
// repeat ZIEL_BEREICH in model.ts. nur_sprung: only jump points (form 2) with the value 0 or 1 (mute, solo).
// 1.12 slice 5 (D7, D9): rel_min/rel_max is the range of a RELATIVE lane of that target (a summand: dB for the fader, pan units, device units); for mute and solo
// nur_sprung also means "no relative lane".
struct AutoZiel {
  const char* name;
  uint8_t ziel, param;
  double min, max;
  bool nur_sprung;
  double rel_min, rel_max;
  uint8_t geraet;   // ARR_AUTO_GERAET only: 1 = the RB-338 (param 0..3, ARR_GERAET_PARAM_NAME), 2 = the Baukasten device (param 0..63 = k1..k64)
};
constexpr AutoZiel AUTO_ZIELE[] = {
    {"fader", ARR_AUTO_FADER, 0, -200.0, 6.0, false, -60.0, 6.0, 0},
    {"pan", ARR_AUTO_PAN, 0, -1.0, 1.0, false, -2.0, 2.0, 0},
    {"mute", ARR_AUTO_MUTE, 0, 0.0, 1.0, true, 0.0, 0.0, 0},
    {"solo", ARR_AUTO_SOLO, 0, 0.0, 1.0, true, 0.0, 0.0, 0},
    {"geraet.lautstaerke", ARR_AUTO_GERAET, 0, 0.0, 1.0, false, -1.0, 1.0, 1},   // param = index into the device parameter names
    {"geraet.cutoff", ARR_AUTO_GERAET, 1, 0.0, 1.0, false, -1.0, 1.0, 1},
    {"geraet.resonanz", ARR_AUTO_GERAET, 2, 0.0, 1.0, false, -1.0, 1.0, 1},
    {"geraet.env_mod", ARR_AUTO_GERAET, 3, 0.0, 1.0, false, -1.0, 1.0, 1},
    // 1.12 slice 7: the Baukasten knobs of a bk track (param = knob index 0..63); the bk sink takes them through auto_parameter and smooths over 20 ms
    {"geraet.k1", ARR_AUTO_GERAET, 0, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k2", ARR_AUTO_GERAET, 1, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k3", ARR_AUTO_GERAET, 2, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k4", ARR_AUTO_GERAET, 3, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k5", ARR_AUTO_GERAET, 4, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k6", ARR_AUTO_GERAET, 5, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k7", ARR_AUTO_GERAET, 6, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k8", ARR_AUTO_GERAET, 7, 0.0, 1.0, false, -1.0, 1.0, 2},
    // 32-knob widening: k9..k32 appended (the order of the entries above does not change)
    {"geraet.k9", ARR_AUTO_GERAET, 8, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k10", ARR_AUTO_GERAET, 9, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k11", ARR_AUTO_GERAET, 10, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k12", ARR_AUTO_GERAET, 11, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k13", ARR_AUTO_GERAET, 12, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k14", ARR_AUTO_GERAET, 13, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k15", ARR_AUTO_GERAET, 14, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k16", ARR_AUTO_GERAET, 15, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k17", ARR_AUTO_GERAET, 16, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k18", ARR_AUTO_GERAET, 17, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k19", ARR_AUTO_GERAET, 18, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k20", ARR_AUTO_GERAET, 19, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k21", ARR_AUTO_GERAET, 20, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k22", ARR_AUTO_GERAET, 21, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k23", ARR_AUTO_GERAET, 22, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k24", ARR_AUTO_GERAET, 23, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k25", ARR_AUTO_GERAET, 24, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k26", ARR_AUTO_GERAET, 25, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k27", ARR_AUTO_GERAET, 26, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k28", ARR_AUTO_GERAET, 27, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k29", ARR_AUTO_GERAET, 28, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k30", ARR_AUTO_GERAET, 29, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k31", ARR_AUTO_GERAET, 30, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k32", ARR_AUTO_GERAET, 31, 0.0, 1.0, false, -1.0, 1.0, 2},
    // 64-knob widening: k33..k64 appended (the order of the entries above does not change)
    {"geraet.k33", ARR_AUTO_GERAET, 32, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k34", ARR_AUTO_GERAET, 33, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k35", ARR_AUTO_GERAET, 34, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k36", ARR_AUTO_GERAET, 35, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k37", ARR_AUTO_GERAET, 36, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k38", ARR_AUTO_GERAET, 37, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k39", ARR_AUTO_GERAET, 38, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k40", ARR_AUTO_GERAET, 39, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k41", ARR_AUTO_GERAET, 40, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k42", ARR_AUTO_GERAET, 41, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k43", ARR_AUTO_GERAET, 42, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k44", ARR_AUTO_GERAET, 43, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k45", ARR_AUTO_GERAET, 44, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k46", ARR_AUTO_GERAET, 45, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k47", ARR_AUTO_GERAET, 46, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k48", ARR_AUTO_GERAET, 47, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k49", ARR_AUTO_GERAET, 48, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k50", ARR_AUTO_GERAET, 49, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k51", ARR_AUTO_GERAET, 50, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k52", ARR_AUTO_GERAET, 51, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k53", ARR_AUTO_GERAET, 52, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k54", ARR_AUTO_GERAET, 53, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k55", ARR_AUTO_GERAET, 54, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k56", ARR_AUTO_GERAET, 55, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k57", ARR_AUTO_GERAET, 56, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k58", ARR_AUTO_GERAET, 57, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k59", ARR_AUTO_GERAET, 58, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k60", ARR_AUTO_GERAET, 59, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k61", ARR_AUTO_GERAET, 60, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k62", ARR_AUTO_GERAET, 61, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k63", ARR_AUTO_GERAET, 62, 0.0, 1.0, false, -1.0, 1.0, 2},
    {"geraet.k64", ARR_AUTO_GERAET, 63, 0.0, 1.0, false, -1.0, 1.0, 2},
    // send automation: the send of the track into return 1..8 (param = return - 1), dB like send_setzen (-200..6); absolute only (the reader refuses a relative lane), appended last
    {"send.1", ARR_AUTO_SEND, 0, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.2", ARR_AUTO_SEND, 1, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.3", ARR_AUTO_SEND, 2, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.4", ARR_AUTO_SEND, 3, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.5", ARR_AUTO_SEND, 4, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.6", ARR_AUTO_SEND, 5, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.7", ARR_AUTO_SEND, 6, -200.0, 6.0, false, 0.0, 0.0, 0},
    {"send.8", ARR_AUTO_SEND, 7, -200.0, 6.0, false, 0.0, 0.0, 0},
};
static_assert(2 * sizeof(AUTO_ZIELE) / sizeof(AUTO_ZIELE[0]) == ARR_AUTO_LANES_JE_SPUR, "one absolute and one relative lane per target and track: 2 x 80");

constexpr bool gleich(const char* a, const char* b) {
  while (*a && *a == *b) ++a, ++b;
  return *a == *b;
}
constexpr bool geraet_namen_gebunden() {   // every RB-338 geraet.* entry carries the name ARR_GERAET_PARAM_NAME[param] after the prefix; every bk entry is "k" + (param + 1)
  for (const AutoZiel& z : AUTO_ZIELE) {
    if (z.ziel == ARR_AUTO_GERAET && z.geraet == 1 && !(z.param < ARR_GERAET_PARAMS && gleich(z.name + 7, ARR_GERAET_PARAM_NAME[z.param]))) return false;
    if (z.ziel == ARR_AUTO_GERAET && z.geraet == 2) {   // "k" + decimal (param + 1): one digit up to k9, two digits from k10
      if (!(z.param < ARR_GERAET_LANE_PARAMS && z.name[7] == 'k')) return false;
      const int n = z.param + 1;
      if (n < 10 ? !(z.name[8] == '0' + n && z.name[9] == 0) : !(z.name[8] == '0' + n / 10 && z.name[9] == '0' + n % 10 && z.name[10] == 0)) return false;
    }
    if (z.ziel == ARR_AUTO_GERAET && z.geraet == 0) return false;
  }
  return true;
}
static_assert(geraet_namen_gebunden(), "AUTO_ZIELE geraet.* entries must match ARR_GERAET_PARAM_NAME");

const json& feld(const json& o, const char* name, const std::string& wo) {
  if (!o.is_object() || !o.contains(name)) format(wo + name + " fehlt");
  return o.at(name);
}
double zahl(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_number()) format(wo + name + " ist keine Zahl");
  const double d = w.get<double>();
  if (!std::isfinite(d)) format(wo + name + " nicht endlich");
  return d;
}
int64_t ganz(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_number_integer()) format(wo + name + " ist keine ganze Zahl");
  return w.get<int64_t>();
}
std::string text(const json& o, const char* name, const std::string& wo) {
  const json& w = feld(o, name, wo);
  if (!w.is_string()) format(wo + name + " ist kein Text");
  return w.get<std::string>();
}

// Session view S1b K2 (index 2.2): the keys `rueckwaerts`, `blende`, `scheiben`, `pitch` and `huellen` of one cell into z.karte, z.pitch and z.huellen.
// Every violation is `zellen_ungueltig` and the snapshot is not loaded. `beats` is the cell length of the entry (a one-shot carries it for the slice table
// and the envelope range although ArrZelle::beats stays 0 there). Beats become source frames linearly (frames / beats).
void zelle_erweitern(const json& zj, const std::string& wz, ArrZelle& z, double beats, bool loop, int64_t frames, int64_t modus) {
  const auto ung = [&](const std::string& m) { throw Abbruch("zellen_ungueltig", wz + m); };
  const auto flag = [&](const char* name) {
    if (!zj.contains(name)) return false;
    const json& w = zj.at(name);
    if (w.is_boolean()) return w.get<bool>();
    if (w.is_number_integer() && (w.get<int64_t>() == 0 || w.get<int64_t>() == 1)) return w.get<int64_t>() == 1;
    ung(std::string(name) + " must be 0 or 1");
    return false;
  };
  const auto zahl_in = [&](const json& w, const std::string& was) {
    if (!w.is_number() || !std::isfinite(w.get<double>())) ung(was + " is not a finite number");
    return w.get<double>();
  };
  ZellKarte& k = z.karte;
  k = ZellKarte{};
  k.frames = frames;
  k.kreis = loop;
  k.rueck = flag("rueckwaerts");
  k.blende = flag("blende");
  if (zj.contains("scheiben")) {
    const json& sj = zj.at("scheiben");
    if (!sj.is_array() || sj.empty()) ung("scheiben must be a non-empty list of [start, source slot]");
    if (sj.size() > static_cast<size_t>(ZELL_SCHEIBEN_MAX)) ung("scheiben: more than " + std::to_string(ZELL_SCHEIBEN_MAX) + " slots");
    if (!(beats > 0.0)) ung("scheiben need the cell length in beats (beats > 0)");
    const int n = static_cast<int>(sj.size());
    double letzter = -1.0;
    for (int i = 0; i < n; ++i) {
      const json& e = sj[static_cast<size_t>(i)];
      const std::string wi = "scheiben[" + std::to_string(i) + "] ";
      if (!e.is_array() || e.size() != 2) ung(wi + "is not a pair [start, source slot]");
      const double start = zahl_in(e[0], wi + "start");
      if (!e[1].is_number_integer() || e[1].get<int64_t>() < 0 || e[1].get<int64_t>() >= n) ung(wi + "source slot outside 0 to " + std::to_string(n - 1));
      if (i == 0 ? start != 0.0 : !(start > letzter)) ung(wi + (i == 0 ? "first start must be 0" : "starts must rise"));
      if (!(start < beats)) ung(wi + "start beyond the cell length");
      letzter = start;
      k.g[i] = static_cast<double>(std::llround(start * static_cast<double>(frames) / beats));
      k.s[i] = static_cast<uint8_t>(e[1].get<int64_t>());
    }
    k.g[n] = static_cast<double>(frames);
    for (int i = 0; i < n; ++i)   // every slot is a played slot and a source slot: none shorter than 2 * ARR_NAHT (it would overlap the crossfade of its neighbour)
      if (k.g[i + 1] - k.g[i] < static_cast<double>(ZELL_SLOT_MIN)) ung("scheiben[" + std::to_string(i) + "] shorter than " + std::to_string(ZELL_SLOT_MIN) + " frames");
    k.n = n;
  }
  z.pitch = 1.0;
  if (zj.contains("pitch")) {
    if (!loop || modus != 2) ung("pitch needs a loop cell with keylock (modus 2)");
    const double p = zahl_in(zj.at("pitch"), "pitch");
    if (!(p >= 0.25 - 1e-9 && p <= 4.0 + 1e-9)) ung("pitch outside 24 semitones (0.25 to 4)");
    z.pitch = p;
  }
  z.n_huellen = 0;
  if (zj.contains("huellen")) {
    const json& hj = zj.at("huellen");
    if (!hj.is_array()) ung("huellen is not a list");
    if (hj.size() > static_cast<size_t>(ZELL_HUELLEN_MAX)) ung("huellen: more than " + std::to_string(ZELL_HUELLEN_MAX) + " envelopes");
    for (size_t hi = 0; hi < hj.size(); ++hi) {
      const json& h = hj[hi];
      const std::string wh = "huellen[" + std::to_string(hi) + "] ";
      if (!h.is_object() || !h.contains("art") || !h.at("art").is_string()) ung(wh + "has no art");
      const std::string art = h.at("art").get<std::string>();
      ZellHuelle& hu = z.huellen[hi];
      hu = ZellHuelle{};
      float lo = -200.0f, hi_w = 0.0f;   // gain and sends: dB
      if (art == "gain") {
        hu.art = 2;
      } else if (art == "feld") {
        hu.art = 0;
        if (!h.contains("feld") || !h.at("feld").is_number_integer()) ung(wh + "feld is missing or not an integer");
        const int64_t f = h.at("feld").get<int64_t>();
        bool ok = f == ARR_F_FILTER;
        for (int r = 0; r < ARR_RETURNS; ++r) ok = ok || f == arr_f_send(r);
        if (!ok) ung(wh + "feld is neither the track filter nor a send");
        hu.feld = static_cast<uint8_t>(f);
        if (f == ARR_F_FILTER) { lo = -1.0f; hi_w = 1.0f; }
      } else {
        ung(wh + "art " + art + " unknown (feld or gain)");
      }
      if (!h.contains("punkte") || !h.at("punkte").is_array() || h.at("punkte").empty()) ung(wh + "needs 1 to " + std::to_string(ZELL_PUNKTE_MAX) + " points");
      const json& pj = h.at("punkte");
      if (pj.size() > static_cast<size_t>(ZELL_PUNKTE_MAX)) ung(wh + "more than " + std::to_string(ZELL_PUNKTE_MAX) + " points");
      double vorher = 0.0;
      for (size_t pi = 0; pi < pj.size(); ++pi) {
        const json& p = pj[pi];
        const std::string wp = wh + "punkte[" + std::to_string(pi) + "] ";
        if (!p.is_array() || p.size() != 3) ung(wp + "is not [beat, value, form]");
        const double b = zahl_in(p[0], wp + "beat");
        const double w = zahl_in(p[1], wp + "value");
        if (b < 0.0 || b < vorher || (beats > 0.0 && !(b < beats))) ung(wp + "beat must be rising and inside the cell");
        if (!(w >= lo && w <= hi_w)) ung(wp + "value outside " + std::to_string(lo) + " to " + std::to_string(hi_w));
        if (!p[2].is_number_integer() || p[2].get<int64_t>() < 0 || p[2].get<int64_t>() > 2) ung(wp + "form must be 0, 1 or 2");
        if (pi > 1 && b == vorher && b == hu.p[pi - 2].beat) ung(wp + "three points at one beat");
        vorher = b;
        hu.p[pi] = ArrAutoPunkt{b, static_cast<float>(w), static_cast<uint8_t>(p[2].get<int64_t>())};
      }
      hu.n = static_cast<int>(pj.size());
      for (size_t o = 0; o < hi; ++o)   // one envelope per target (index 2.1)
        if (z.huellen[o].art == hu.art && z.huellen[o].feld == hu.feld) ung(wh + "second envelope for the same target");
      ++z.n_huellen;
    }
  }
}

// D1 Spec 6.14: lexikalisch normalisiert, ohne abschließenden Schrägstrich (Symlinks löst sie nicht auf)
std::string normal(const std::string& p) {
  std::string n = std::filesystem::path(p).lexically_normal().string();
  while (n.size() > 1 && n.back() == '/') n.pop_back();
  return n;
}

// Index des ersten nicht endlichen Werts, −1: alle endlich. Bitweise (Exponent alle Einsen), damit der Vergleich ohne
// Gleitkomma-Ausnahmen und vektorisiert läuft; je 1024 Werte ein Ausstieg.
int64_t erstes_unendliches(const float* x, int64_t n) {
  for (int64_t a = 0; a < n; a += 1024) {
    const int64_t e = std::min<int64_t>(n, a + 1024);
    uint32_t schlecht = 0;
    for (int64_t i = a; i < e; ++i) {
      uint32_t u;
      std::memcpy(&u, x + i, sizeof u);
      schlecht |= static_cast<uint32_t>((u & 0x7f800000u) == 0x7f800000u);
    }
    if (schlecht)
      for (int64_t i = a; i < e; ++i)
        if (!std::isfinite(x[i])) return i;
  }
  return -1;
}

// 1.10 slice 4a/4b: the insert chain of a strip, `chain: [{art: "komp" | "eq" | "saett" | "lim" | "utility" | "bk" | "gate" | "mb" | "trans" | "bild" | "host", slot: 1..pool of the kind, an: bool, latenz: samples (host only)}, ...]` (at most ARR_KETTE stages,
// optional; an defaults to true). A slot belongs to one stage of the whole playback (the pool is shared): slot_belegt (ARR_INS_ALLE entries, global index) marks the used ones.
bool bk_name_ok(const std::string& n);   // defined below with the graph rules
void lese_kette(const json& o, const std::string& wo, ArrKette& k, bool* slot_belegt, ArrAudioCache& cache, ArrSnapshot& snap) {
  const bool host_da = cache.host_da();
  if (!o.contains("chain")) return;
  const json& ch = o.at("chain");
  if (!ch.is_array()) format(wo + "chain ist keine Liste");
  if (ch.size() > static_cast<size_t>(ARR_KETTE)) format(wo + "chain: kette_voll (more than " + std::to_string(ARR_KETTE) + " stages)");
  for (size_t j = 0; j < ch.size(); ++j) {
    const json& x = ch[j];
    const std::string wx = wo + "chain[" + std::to_string(j) + "].";
    const std::string art = text(x, "art", wx);
    ArrInsArt a = ArrInsArt::leer;
    int pool = 0, versatz = 0;
    if (art == "komp") { a = ArrInsArt::komp; pool = ARR_INS_KOMP; versatz = 0; }
    else if (art == "eq") { a = ArrInsArt::eq; pool = ARR_INS_EQ; versatz = ARR_INS_KOMP; }
    else if (art == "saett") { a = ArrInsArt::saett; pool = ARR_INS_SAETT; versatz = ARR_INS_KOMP + ARR_INS_EQ; }
    else if (art == "lim") { a = ArrInsArt::lim; pool = ARR_INS_LIM; versatz = INS_G_LIM0; }
    else if (art == "utility") { a = ArrInsArt::utility; pool = ARR_INS_UTIL; versatz = INS_G_UTIL0; }   // arr-fx slice 1
    else if (art == "bk") { a = ArrInsArt::bk; pool = ARR_INS_BK; versatz = INS_G_BK0; }   // arr-bk slice 3
    else if (art == "gate") { a = ArrInsArt::gate; pool = ARR_INS_GATE; versatz = INS_G_GATE0; }   // strand 1 slice 4
    else if (art == "mb") { a = ArrInsArt::mb; pool = ARR_INS_MB; versatz = INS_G_MB0; }
    else if (art == "trans") { a = ArrInsArt::trans; pool = ARR_INS_TRANS; versatz = INS_G_TRANS0; }   // strand 5 slice 3
    else if (art == "bild") { a = ArrInsArt::bild; pool = ARR_INS_BILD; versatz = INS_G_BILD0; }
    else if (art == "host") { a = ArrInsArt::host; pool = ARR_INS_HOST; versatz = INS_G_HOST0; }   // plan 1.11 T4
    else format(wx + "art " + art + " unbekannt (art_unbekannt; komp, eq, saett, lim, utility, bk, gate, mb, trans, bild, host)");
    const int64_t sl = ganz(x, "slot", wx);
    if (sl < 1 || sl > pool) format(wx + "slot außerhalb 1 bis " + std::to_string(pool) + " (" + art + (a == ArrInsArt::host ? "; ungueltig: host h is pool instance ins/host/h)" : ")"));
    if (slot_belegt[versatz + sl - 1]) format(wx + "slot " + art + "/" + std::to_string(sl) + " doppelt");
    slot_belegt[versatz + sl - 1] = true;
    bool an = true;
    if (x.contains("an")) {
      if (!x.at("an").is_boolean()) format(wx + "an ist kein Wahrheitswert");
      an = x.at("an").get<bool>();
    }
    ArrSchluessel key;
    if (x.contains("key")) {   // 1.10 slice 5: the structural sidechain key {q: "spur" | "grp" | "ret" | "pm", nr, punkt: "pre" | "post"}; a compressor, (strand 2 task 3.3) a host stage and (strand 5 slice 4) an EQ stage have a key
      const json& kj = x.at("key");                       // which strip may listen to which source is the table of arr_schluessel_pruefe(), called once all strips are read
      const std::string wk = wx + "key.";
      if (!kj.is_object()) format(wk + "key ist kein Objekt");
      if (a != ArrInsArt::komp && a != ArrInsArt::host && a != ArrInsArt::eq) format(wk + "only a komp, eq or host stage has a sidechain key (" + art + ")");
      const std::string q = text(kj, "q", wk);
      int nmax = 0;
      bool dj = false, strom = false;
      if (q == "spur") { key.quelle = ARR_SCHL_SPUR; nmax = ARR_SPUREN; }
      else if (q == "grp") { key.quelle = ARR_SCHL_GRP; nmax = ARR_GRUPPEN; }
      else if (q == "ret") { key.quelle = ARR_SCHL_RET; nmax = ARR_RETURNS; }
      else if (q == "pm") key.quelle = ARR_SCHL_PM;   // refused by the table (sidechain_zyklus); the number means nothing
      else if (q == "deck" || q == "erz" || q == "pad") dj = true;   // slice 5 U2b: the DJ inputs; the generated list says which are allowed
      else if (q == "strom") dj = strom = true;   // K4 (D-V3): the stream distributors 1..16; like a DJ input (no pre and post), but every number is a key
      else format(wk + "q " + q + " unbekannt (spur, grp, ret, pm, deck, erz, pad, strom)");
      if (dj) {
        const int64_t kn = ganz(kj, "nr", wk);
        if (strom) {
          if (kn < 1 || kn > ARR_SCHLUESSEL - 4) format(wk + "nr außerhalb 1 bis " + std::to_string(ARR_SCHLUESSEL - 4) + " (strom)");
        } else if (const uint8_t ant = arr_schluessel_dj_urteil(q, kn); ant != SCHL_JA) {   // erz/2..8, pad/1..2: not available in the block; erz/4: the arrangement's own output
          format(wk + q + "/" + std::to_string(kn) + " cannot be a key (" + SCHL_GRUND[ant] + ")");
        }
        key.quelle = q == "deck" ? ARR_SCHL_DECK : ARR_SCHL_ERZ;
        key.nr = static_cast<uint8_t>(kn);
        key.punkt = ARR_SCHL_POST;   // a DJ input has no pre and post; punkt may be left out, "pre" and "post" are both accepted and mean the same
        if (kj.contains("punkt")) {
          const std::string punkt = text(kj, "punkt", wk);
          if (punkt != "pre" && punkt != "post") format(wk + "punkt " + punkt + " unbekannt (pre, post)");
        }
      } else {
        if (nmax > 0) {
          const int64_t kn = ganz(kj, "nr", wk);
          if (kn < 1 || kn > nmax) format(wk + "nr außerhalb 1 bis " + std::to_string(nmax) + " (" + q + ")");
          key.nr = static_cast<uint8_t>(kn);
        }
        const std::string punkt = text(kj, "punkt", wk);
        if (punkt != "pre" && punkt != "post") format(wk + "punkt " + punkt + " unbekannt (pre, post)");
        key.punkt = punkt == "pre" ? ARR_SCHL_PRE : ARR_SCHL_POST;
        for (const auto& z : SCHL_NUR_ZEILE)   // the generated list of sources that exist only as the row sc (today: track pre; the pair has one writer)
          if (static_cast<int>(key.quelle) - 1 == z[0] && key.punkt == z[1])
            format(wk + "punkt " + punkt + " of " + q + " is the row sc, not a key (the pair has one writer)");
      }
    }
    ArrStufe stufe{a, static_cast<uint8_t>(sl - 1), an, key};
    if (a == ArrInsArt::host) {   // plan 1.11 T4 (D4): the latency of a host stage is structure, `latenz` in samples (the round trip through the host process); a value the rings cannot hold is pdc_zu_lang
      if (!host_da) throw Abbruch("format", wx + "host_fehlt: the effect-host ports of this core are not there (a stage of art host cannot play)");
      const int64_t lz = x.contains("latenz") ? ganz(x, "latenz", wx) : 0;
      if (lz < 0 || lz > 65535) format(wx + "latenz " + std::to_string(lz) + " outside 0 to 65535 samples");
      stufe.latenz = static_cast<uint16_t>(lz);   // 8192 and more is refused by arr_pdc_rechnen (pdc_zu_lang)
    } else if (a == ArrInsArt::bk) {   // arr-bk slice 3: a Baukasten effect graph; built here (loader thread), handed to the callback inside the snapshot
      if (x.contains("latenz")) format(wx + "latenz is measured from the graph (a stage of art bk takes no latenz)");
      const std::string gr = text(x, "graph", wx);
      if (!bk_name_ok(gr)) format(wx + "graph \"" + gr + "\": name must be 1 to 32 characters of [a-z0-9_-]");
      std::snprintf(stufe.graph, sizeof stufe.graph, "%s", gr.c_str());
      std::string grund, meldung;
      int lat = 0;
      const int32_t ref = cache.bk_hole(ARR_BK_INSERT_NR + INS_G_BK0 + static_cast<int>(sl - 1), gr, &stufe.bk, &stufe.bk_gen, grund, meldung, true, INS_LAT_MAX, &lat);
      if (ref < 0 && grund == "bk_graph_fehlt") {   // the graph file is gone (a project from another machine, a graph deleted from the folder): the stage plays dry, the playback loads
        std::fprintf(stderr, "arr: %s%s; the stage passes the signal through (dry)\n", wx.c_str(), meldung.c_str());
        stufe.bk = nullptr;
        stufe.bk_gen = 0;
        lat = 0;
      } else {
        if (ref < 0) throw Abbruch(grund, wx + meldung);
        snap.bk_refs.push_back(ref);
      }
      stufe.latenz = static_cast<uint16_t>(lat);   // the delay compensation counts it like a host stage (arr_pdc.h)
    } else {
      if (x.contains("graph")) format(wx + "graph belongs to a stage of art bk (" + art + ")");
      if (x.contains("latenz")) format(wx + "latenz belongs to a stage of art host (" + art + ")");
    }
    k.st[k.n++] = stufe;
  }
}

// 1.10 slice 4c T15: the rack of a strip, `rack: {slot: 1..ARR_RACKS, ziele: [{makro: 0..3, stufe: position in the chain of the strip, param: parameter index of the stage kind, von, bis}, ...]}`
// (optional; only on a strip with a chain; at most ARR_MAKRO_ZIELE targets). A rack slot belongs to one strip of the whole playback; a target (stufe, param) is driven by one macro only
// (one writer per parameter, spec D13). The stage switch (index 0) and the compressor key cannot be mapped. Every refusal names the field and the rule (reason `format`).
int ins_param_zahl(ArrInsArt a) {
  return a == ArrInsArt::komp ? INS_KOMP_PARAM : a == ArrInsArt::eq ? INS_EQ_PARAM : a == ArrInsArt::lim ? INS_LIM_PARAM : a == ArrInsArt::host ? INS_HOST_PARAM : a == ArrInsArt::utility ? INS_UTIL_PARAM : a == ArrInsArt::bk ? INS_BK_PARAM : a == ArrInsArt::gate ? INS_GATE_PARAM : a == ArrInsArt::mb ? INS_MB_PARAM : a == ArrInsArt::trans ? INS_TRANS_PARAM : a == ArrInsArt::bild ? INS_BILD_PARAM : INS_SAETT_PARAM;
}
// 1.9 U8 T9 (spec E12): an entry with `glied` (a member index) instead of `stufe` is a macro target on a member of an instrument rack. It exists only on a rack track strip
// (`roh` != nullptr): there lese_rack only remembers the position of such an entry in `roh`, because the members of the track are parsed after it (lese_glied_ziele fills
// ArrRack::g from the remembered positions once they are). On every other strip (group, return, PM, a plain track) such an entry is refused. A rack track needs no chain
// for its rack (rack_ohne_kette does not apply): its targets are the members.
struct GliedRoh {
  int n = 0;
  size_t pos[ARR_MAKRO_ZIELE];
};
void lese_rack(const json& o, const std::string& wo, const ArrKette& k, ArrRack& r, bool* rack_belegt, GliedRoh* roh = nullptr, bool rack_spur = false) {
  if (!o.contains("rack")) return;
  const json& rj = o.at("rack");
  const std::string wr = wo + "rack.";
  if (!rj.is_object()) format(wr + "rack ist kein Objekt");
  if (k.n == 0 && !rack_spur) format(wr + "rack_ohne_kette (a rack maps parameters of the stages of the chain; the strip has none)");
  const int64_t sl = ganz(rj, "slot", wr);
  if (sl < 1 || sl > ARR_RACKS) format(wr + "slot außerhalb 1 bis " + std::to_string(ARR_RACKS));
  if (rack_belegt[sl - 1]) format(wr + "slot " + std::to_string(sl) + " doppelt");
  rack_belegt[sl - 1] = true;
  const json& zl = feld(rj, "ziele", wr);
  if (!zl.is_array()) format(wr + "ziele ist keine Liste");
#ifdef CYPHERDJ_MUTATION_MAKRO_LIMIT_17
  const size_t grenze = zl.size() > static_cast<size_t>(ARR_MAKRO_ZIELE) ? static_cast<size_t>(ARR_MAKRO_ZIELE) : zl.size();   // error case: the 17th and later targets are silently cut
#else
  if (zl.size() > static_cast<size_t>(ARR_MAKRO_ZIELE)) format(wr + "ziele: makro_voll (more than " + std::to_string(ARR_MAKRO_ZIELE) + " targets)");
  const size_t grenze = zl.size();
#endif
  bool belegt[ARR_KETTE][INS_PARAM_MAX] = {};
  r.slot = static_cast<int8_t>(sl - 1);
  r.n = 0;
  for (size_t j = 0; j < grenze; ++j) {
    const json& x = zl[j];
    const std::string wx = wr + "ziele[" + std::to_string(j) + "].";
    if (!x.is_object()) format(wx + "kein Objekt");
    if (x.contains("glied")) {   // a member target: remembered here, checked and filled after the members are parsed
      if (!roh) format(wx + "glied: member targets exist only on a rack track strip");
      if (x.contains("stufe")) format(wx + "glied and stufe in one target (an insert target names a stufe, a member target a glied)");
      roh->pos[roh->n++] = j;
      continue;
    }
    const int64_t mk = ganz(x, "makro", wx), st = ganz(x, "stufe", wx), pa = ganz(x, "param", wx);
    if (mk < 0 || mk >= ARR_MAKROS) format(wx + "makro außerhalb 0 bis " + std::to_string(ARR_MAKROS - 1));
    if (st < 0 || st >= k.n) format(wx + "stufe " + std::to_string(st) + " ist nicht in der Kette (" + std::to_string(k.n) + " Stufen)");
    const ArrInsArt art = k.st[st].art;
    if (pa < 0 || pa >= ins_param_zahl(art)) format(wx + "param " + std::to_string(pa) + " außerhalb der Parameter der Stufe");
    if (pa == 0) format(wx + "param 0 (an) kann nicht gemappt werden");
    if (art == ArrInsArt::komp && pa == INS_KOMP_SC) format(wx + "param 9 (sc, der Schlüssel) kann nicht gemappt werden");
    if (art == ArrInsArt::eq && pa == INS_EQ_SC) format(wx + "param 85 (sc, der Schlüssel) kann nicht gemappt werden");   // strand 5 slice 4
    if (belegt[st][pa]) format(wx + "ziel (stufe " + std::to_string(st) + ", param " + std::to_string(pa) + ") doppelt (ein Parameter hat eine Quelle)");
    belegt[st][pa] = true;
    ArrMakroZiel z;
    z.makro = static_cast<uint8_t>(mk);
    z.stufe = static_cast<uint8_t>(st);
    z.param = static_cast<uint8_t>(pa);
    z.von = static_cast<float>(zahl(x, "von", wx));
    z.bis = static_cast<float>(zahl(x, "bis", wx));
    if (!std::isfinite(z.von) || !std::isfinite(z.bis)) format(wx + "von/bis nicht als float darstellbar");
    r.z[r.n++] = z;
  }
}

// After the members of the rack track `sp` are parsed: the remembered member targets of `o.rack.ziele` become ArrRack::g. A target names a member index below n_glieder
// (and so below ARR_RACK_GLIEDER); a Surge member takes none (makro_ziel_wirt); the parameter index must exist for the device of the member (0..3 RB-338, 8..15 and 17..72 a Baukasten
// graph, 16 the gain of any internal member; a kit takes only 16); von/bis are 0..1 for a device parameter and a knob, -60..+12 dB for the gain; one (member, parameter) has one
// source. The count over n + ng is the limit of the whole table (checked on the list size before this runs).
void lese_glied_ziele(const json& o, const std::string& wo, const ArrSnapshot& snap, const ArrSpur& sp, const GliedRoh& roh, ArrRack& r) {
  if (roh.n == 0) return;
  const json& zl = o.at("rack").at("ziele");
  const std::string wr = wo + "rack.";
  bool belegt[ARR_RACK_GLIEDER][ARR_GLIED_PARAM_N] = {};
  r.ng = 0;
  for (int i = 0; i < roh.n; ++i) {
    const json& x = zl[roh.pos[i]];
    const std::string wx = wr + "ziele[" + std::to_string(roh.pos[i]) + "].";
    const int64_t mk = ganz(x, "makro", wx), gi = ganz(x, "glied", wx), pa = ganz(x, "param", wx);
    if (mk < 0 || mk >= ARR_MAKROS) format(wx + "makro außerhalb 0 bis " + std::to_string(ARR_MAKROS - 1));
    if (gi < 0 || gi >= sp.n_glieder || gi >= ARR_RACK_GLIEDER)
      format(wx + "glied " + std::to_string(gi) + " is not a member of the rack (" + std::to_string(sp.n_glieder) + " members)");
    const ArrGlied& g = sp.glied[gi];
    if (g.art == ArrArt::wirt) format(wx + "glied " + std::to_string(gi) + " is a Surge member: makro_ziel_wirt (a Surge member takes no macro target)");
    const ArrSpur& dev = snap.glied_spur[g.platz - ARR_SPUREN];
    const bool ist_rb = std::strcmp(dev.geraet, "rb338") == 0, ist_bk = std::strcmp(dev.geraet, "bk") == 0;
    const bool gain = pa == ARR_GLIED_PARAM_GAIN_DB;
    const bool erlaubt = gain || (ist_rb && pa >= 0 && pa < ARR_GERAET_PARAMS) || (ist_bk && arr_glied_bk_knopf(static_cast<int>(pa)) >= 0);
    if (!erlaubt)
      format(wx + "param " + std::to_string(pa) + " is not allowed for the " + (ist_rb ? "RB-338" : ist_bk ? "Baukasten" : "kit") + " member " + std::to_string(gi) +
             " (RB-338 0 to 3, Baukasten 8 to 15 and 17 to 72, gain 16)");
    if (belegt[gi][pa]) format(wx + "ziel (glied " + std::to_string(gi) + ", param " + std::to_string(pa) + ") doppelt (ein Parameter hat eine Quelle)");
    belegt[gi][pa] = true;
    ArrGliedZiel z;
    z.makro = static_cast<uint8_t>(mk);
    z.glied = static_cast<uint8_t>(gi);
    z.param = static_cast<uint8_t>(pa);
    const double von = zahl(x, "von", wx), bis = zahl(x, "bis", wx);
    if (!std::isfinite(von) || !std::isfinite(bis)) format(wx + "von/bis nicht als float darstellbar");
    const double lo = gain ? ARR_GLIED_GAIN_DB_MIN : 0.0, hi = gain ? ARR_GLIED_GAIN_DB_MAX : 1.0;
    if (von < lo || von > hi || bis < lo || bis > hi) format(wx + "von/bis outside " + (gain ? "-60 to +12 (dB)" : "0 to 1"));
    z.von = static_cast<float>(von);
    z.bis = static_cast<float>(bis);
    r.g[r.ng++] = z;
  }
}

// The `punkte` of an `auto` lane of a track or of a return fader lane: [[beat, wert, form], ...], the checks and the texts as they always were. The points go to the
// end of snap.auto_punkte (reserved in the prescan), the lane gets its target fields, count and pointer. `wl` is the prefix of the lane's texts, `zname` the target name.
void lese_auto_punkte(const json& l, const std::string& wl, const AutoZiel& az, const std::string& zname, bool relativ, ArrSnapshot& snap, ArrAutoLane& lane) {
  const json& pl = feld(l, "punkte", wl);
  if (!pl.is_array() || pl.empty()) format(wl + "punkte is not a non-empty list");
  const size_t p0 = snap.auto_punkte.size();
  for (size_t pi = 0; pi < pl.size(); ++pi) {
    const json& q = pl[pi];
    const std::string wq = wl + "punkte[" + std::to_string(pi) + "]";
    if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, wert, form]");
    if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number_integer()) format(wq + " has a non-number");
    ArrAutoPunkt x{};
    x.beat = q[0].get<double>();
    const double w = q[1].get<double>();
    const int64_t fm = q[2].get<int64_t>();
    if (!std::isfinite(x.beat) || x.beat < 0.0) format(wq + " beat negative or not finite");
    if (relativ ? !(w >= az.rel_min && w <= az.rel_max) : !(w >= az.min && w <= az.max))
      format(wq + " wert outside the " + (relativ ? "relative " : "") + "range of " + zname);
    if (fm < 0 || fm > 2) format(wq + " form outside 0 to 2");
    if (az.nur_sprung && (fm != 2 || (w != 0.0 && w != 1.0))) format(wq + " " + zname + " takes only 0 or 1 with form 2 (jump)");
    x.wert = static_cast<float>(w);
    x.form = static_cast<uint8_t>(fm);
    if (pi > 0 && x.beat < snap.auto_punkte.back().beat) format(wq + " beats fall");
    if (pi > 1 && x.beat == snap.auto_punkte[snap.auto_punkte.size() - 1].beat && x.beat == snap.auto_punkte[snap.auto_punkte.size() - 2].beat)
      format(wq + " three points at one beat");
    snap.auto_punkte.push_back(x);
  }
  lane.ziel = az.ziel;
  lane.param = az.param;
  lane.n = static_cast<int>(pl.size());
  lane.p = snap.auto_punkte.data() + p0;
  lane.relativ = relativ;
}

// The fader lane of a return, `returns[].auto` (only /3): a list of at most one lane, target fader, absolute. Everything else on a return is refused, the master has no such list at all.
void lese_ret_auto(const json& r, const std::string& wr, int ri, ArrSnapshot& snap) {
  if (!r.contains("auto")) return;
  const json& al = r.at("auto");
  if (!al.is_array()) format(wr + "auto is not a list");
  if (al.size() > 1) format(wr + "auto: one fader lane per return");
  for (size_t li = 0; li < al.size(); ++li) {
    const json& l = al[li];
    const std::string wl = wr + "auto[" + std::to_string(li) + "].";
    if (!l.is_object()) format(wl + "not an object");
    const std::string zname = text(l, "ziel", wl);
    if (zname != "fader") format(wl + "ziel " + zname + ": a return takes a fader lane only");
    if (l.contains("relativ")) {
      if (!l.at("relativ").is_boolean()) format(wl + "relativ is not a boolean");
      if (l.at("relativ").get<bool>()) format(wl + "a return fader lane is absolute (no relative lane)");
    }
    lese_auto_punkte(l, wl, AUTO_ZIELE[0], zname, false, snap, snap.ret_fader[ri]);
    snap.ret_fader_da[ri] = true;
    ++snap.n_auto_lanes;
  }
}

// 1.12 slice 6: the insert-parameter and rack-macro lanes of a strip, `chain_auto: [{stufe, param, punkte} | {makro, punkte}, ...]` (any strip with a chain, only /2). `stufe`/`param` as in a rack
// target (the position in the chain of the strip, the parameter index of the stage kind: not the stage switch 0, not the compressor key 9, and not on a host stage: its plugin keeps its own
// parameters); `makro` 0..3 drives a macro of the strip's rack (the strip must have one). `punkte` are [beat, wert, form] triples like an `auto` lane; a stage lane value is in the real unit of the
// parameter (finite; ArrInserts clamps it to the row's range), a macro lane value is 0..1. One lane per (stufe, param) and one per macro on a strip; a (stufe, param) that a rack target maps
// is refused (one writer per parameter, spec D13); at most ARR_KLANES_MAX lanes in all strips. The points go behind those of the track lanes into the reserved snapshot vector.
void lese_kette_auto(const json& o, const std::string& wo, int strip, ArrSnapshot& snap) {
  if (!o.contains("chain_auto")) return;
  const json& al = o.at("chain_auto");
  if (!al.is_array()) format(wo + "chain_auto is not a list");
  const ArrKette& k = snap.kette[strip];
  const ArrRack& rk = snap.rack[strip];
  const size_t l0 = static_cast<size_t>(snap.n_klanes);
  for (size_t li = 0; li < al.size(); ++li) {
    const json& l = al[li];
    const std::string wl = wo + "chain_auto[" + std::to_string(li) + "].";
    if (!l.is_object()) format(wl + "not an object");
    if (snap.n_klanes >= ARR_KLANES_MAX) throw Abbruch("zu_gross", "more than " + std::to_string(ARR_KLANES_MAX) + " insert and rack lanes in all strips");
    ArrKettenLane lane{};
    lane.strip = static_cast<uint8_t>(strip);
    if (l.contains("makro")) {
      if (l.contains("stufe") || l.contains("param")) format(wl + "makro and stufe/param in one lane (a stage lane names stufe and param, a macro lane makro)");
      const int64_t mk = ganz(l, "makro", wl);
      if (mk < 0 || mk >= ARR_MAKROS) format(wl + "makro outside 0 to " + std::to_string(ARR_MAKROS - 1));
      if (rk.slot < 0) format(wl + "makro: the strip has no rack");
      for (size_t q = l0; q < static_cast<size_t>(snap.n_klanes); ++q)
        if (snap.klane[q].strip == strip && snap.klane[q].makro == mk) format(wl + "makro " + std::to_string(mk) + " twice on one strip");
      lane.makro = static_cast<int8_t>(mk);
    } else {
      const int64_t st = ganz(l, "stufe", wl), pa = ganz(l, "param", wl);
      if (st < 0 || st >= k.n) format(wl + "stufe " + std::to_string(st) + " is not in the chain (" + std::to_string(k.n) + " stages)");
      const ArrInsArt art = k.st[st].art;
      if (art == ArrInsArt::host) format(wl + "a host stage has no lane parameter (the plugin keeps its parameters)");
      if (pa < 0 || pa >= ins_param_zahl(art)) format(wl + "param " + std::to_string(pa) + " outside the parameters of the stage");
      if (pa == 0) format(wl + "param 0 (an) cannot be automated");
      if (art == ArrInsArt::komp && pa == INS_KOMP_SC) format(wl + "param 9 (sc, the key) cannot be automated");
      if (art == ArrInsArt::eq && pa == INS_EQ_SC) format(wl + "param 85 (sc, the key) cannot be automated");   // strand 5 slice 4
      for (size_t q = l0; q < static_cast<size_t>(snap.n_klanes); ++q)
        if (snap.klane[q].strip == strip && snap.klane[q].makro < 0 && snap.klane[q].stufe == st && snap.klane[q].param == pa)
          format(wl + "ziel (stufe " + std::to_string(st) + ", param " + std::to_string(pa) + ") twice on one strip");
      for (int q = 0; q < rk.n; ++q)
        if (rk.z[q].stufe == st && rk.z[q].param == pa)
          format(wl + "ziel (stufe " + std::to_string(st) + ", param " + std::to_string(pa) + ") is mapped by a rack macro (one writer per parameter)");
      lane.stufe = static_cast<uint8_t>(st);
      lane.param = static_cast<uint8_t>(pa);
    }
    const json& pl = feld(l, "punkte", wl);
    if (!pl.is_array() || pl.empty()) format(wl + "punkte is not a non-empty list");
    const size_t p0 = snap.auto_punkte.size();
    for (size_t pi = 0; pi < pl.size(); ++pi) {
      const json& q = pl[pi];
      const std::string wq = wl + "punkte[" + std::to_string(pi) + "]";
      if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, wert, form]");
      if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number_integer()) format(wq + " has a non-number");
      ArrAutoPunkt x{};
      x.beat = q[0].get<double>();
      const double w = q[1].get<double>();
      const int64_t fm = q[2].get<int64_t>();
      if (!std::isfinite(x.beat) || x.beat < 0.0) format(wq + " beat negative or not finite");
      if (!std::isfinite(w) || (lane.makro >= 0 && (w < 0.0 || w > 1.0))) format(wq + " wert " + (lane.makro >= 0 ? "outside 0 to 1" : "not finite"));
      if (!std::isfinite(static_cast<float>(w))) format(wq + " wert not representable as a float");
      if (fm < 0 || fm > 2) format(wq + " form outside 0 to 2");
      x.wert = static_cast<float>(w);
      x.form = static_cast<uint8_t>(fm);
      if (pi > 0 && x.beat < snap.auto_punkte.back().beat) format(wq + " beats fall");
      if (pi > 1 && x.beat == snap.auto_punkte[snap.auto_punkte.size() - 1].beat && x.beat == snap.auto_punkte[snap.auto_punkte.size() - 2].beat)
        format(wq + " three points at one beat");
      snap.auto_punkte.push_back(x);
    }
    lane.n = static_cast<int>(pl.size());
    lane.p = snap.auto_punkte.data() + p0;
    snap.klane[snap.n_klanes++] = lane;
  }
}

// Strand 6 (plan 2026-11-27, formats of section 2): the top-level `mod` list, only /3 and /4. [{nr, art, form, takt | hz, phase?, glatt_ms?, saat, ziele: [{spur | ret, ziel, tiefe, uni?}]}].
// nr 1..ARR_MODS unique; art lfo or folger (slice 3: quelle 1..128 of a track in the playback, angriff_ms 0.1..500, abfall_ms 1..5000, empfindlich_db -24..24, the LFO fields refused);
// lfo: form 0..4; exactly one of takt [1/64, 256] and hz [0.01, 40]; phase [0, 1) (default 0); glatt_ms [0, 500] (default 1); saat a u32. 1..ARR_MOD_ZIELE
// targets: `spur` 1..128 of a track in the playback with ziel fader (depth -24..24 dB), pan (-1..1) or a geraet.* name of AUTO_ZIELE that the track's device carries (-1..1); `ret` 1..8 of an
// existing return, ziel fader only (-24..24 dB). The same target twice in one modulator is refused; several modulators on one target add up (D9). The distinct fader/pan targets of all
// modulators get the buffer indices 0..ARR_MOD_FELDER - 1 in snap.mod_feld (more: zu_gross). Fader slot = track index, a return = ARR_SPUREN + r (the slots of slot_lane in arr_auto.cpp).
// Slice 4 (task 4.1): `spur` also takes send.<r> (r a return in the playback, -24..24 dB); a chain target {kette: spur|grp|ret|pm, nr, stufe, param} or {kette, nr, makro} (pm: nr 1)
// follows the rules of lese_kette_auto: the stage in the strip's chain, not a host stage, not param 0, not the compressor key, not a parameter a rack macro maps; a macro needs the rack.
// Depth -1..1 (a stage: fraction of the row range; a macro: macro units).
// `ziele` may be empty (0..ARR_MOD_ZIELE): a modulator whose targets are all plugin.* still runs and reports (Kern::mod_zustand), the server plays its targets.
void lese_mod(const json& j, ArrSnapshot& snap) {
  const json& ml = j.at("mod");
  if (!ml.is_array()) format("mod is not a list");
  if (ml.size() > static_cast<size_t>(ARR_MODS)) throw Abbruch("zu_gross", "mod: more than " + std::to_string(ARR_MODS) + " modulators");
  bool nr_da[ARR_MODS] = {};
  for (size_t mi = 0; mi < ml.size(); ++mi) {
    const json& o = ml[mi];
    const std::string wm = "mod[" + std::to_string(mi) + "].";
    if (!o.is_object()) format(wm + "not an object");
    ArrMod md{};
    const int64_t nr = ganz(o, "nr", wm);
    if (nr < 1 || nr > ARR_MODS) format(wm + "nr outside 1 to " + std::to_string(ARR_MODS));
    if (nr_da[nr - 1]) format(wm + "nr " + std::to_string(nr) + " twice");
    nr_da[nr - 1] = true;
    md.nr = static_cast<uint8_t>(nr);
    const std::string art = text(o, "art", wm);
    if (art != "lfo" && art != "folger") format(wm + "art " + art + " unknown (lfo, folger)");
    md.art = art == "lfo" ? 0 : 1;
    // the fields of the other kind are refused, as the project model refuses them (MOD_FELDER_NUR in model.ts)
    static const char* const NUR_FOLGER[] = {"quelle", "angriff_ms", "abfall_ms", "empfindlich_db"};
    static const char* const NUR_LFO[] = {"form", "takt", "hz", "phase", "saat"};
    for (const char* k : NUR_FOLGER)
      if (md.art == 0 && o.contains(k)) format(wm + k + " belongs to art folger");
    for (const char* k : NUR_LFO)
      if (md.art == 1 && o.contains(k)) format(wm + k + " belongs to art lfo");
    if (md.art == 1) {   // slice 3 (D12): the envelope follower, source = a track of the playback
      const int64_t q = ganz(o, "quelle", wm);
      if (q < 1 || q > ARR_SPUREN) format(wm + "quelle outside 1 to " + std::to_string(ARR_SPUREN));
      if (snap.spur[q - 1].nr == 0) format(wm + "quelle " + std::to_string(q) + " is not in the playback");
      md.quelle = static_cast<int16_t>(q - 1);
      const auto bereich = [&](const char* k, double lo, double hi, float& ziel) {
        if (!o.contains(k)) return;   // absent: the default of the formats section
        const double v = zahl(o, k, wm);
        if (!(v >= lo && v <= hi)) format(wm + k + " outside " + nlohmann::json(lo).dump() + " to " + nlohmann::json(hi).dump());
        ziel = static_cast<float>(v);
      };
      bereich("angriff_ms", 0.1, 500.0, md.angriff_ms);
      bereich("abfall_ms", 1.0, 5000.0, md.abfall_ms);
      bereich("empfindlich_db", -24.0, 24.0, md.empfindlich_db);
    } else {
      const int64_t form = ganz(o, "form", wm);
      if (form < 0 || form > 4) format(wm + "form outside 0 to 4");
      md.form = static_cast<uint8_t>(form);
      const bool mit_takt = o.contains("takt"), mit_hz = o.contains("hz");
      if (mit_takt == mit_hz) format(wm + "takt or hz: exactly one of them");
      if (mit_takt) {
        md.takt = zahl(o, "takt", wm);
        if (!(md.takt >= 1.0 / 64.0 && md.takt <= 256.0)) format(wm + "takt outside 1/64 to 256");
      } else {
        md.frei = true;
        md.hz = zahl(o, "hz", wm);
        if (!(md.hz >= 0.01 && md.hz <= 40.0)) format(wm + "hz outside 0.01 to 40");
      }
      if (o.contains("phase")) {
        md.phase = zahl(o, "phase", wm);
        if (!(md.phase >= 0.0 && md.phase < 1.0)) format(wm + "phase outside [0, 1)");
      }
      const int64_t saat = ganz(o, "saat", wm);
      if (saat < 0 || saat > 0xffffffffLL) format(wm + "saat is not an unsigned 32-bit integer");
      md.saat = static_cast<uint32_t>(saat);
    }
    if (o.contains("glatt_ms")) {
      const double g = zahl(o, "glatt_ms", wm);
      if (!(g >= 0.0 && g <= 500.0)) format(wm + "glatt_ms outside 0 to 500");
      md.glatt_ms = static_cast<float>(g);
    }
    const json& zl = feld(o, "ziele", wm);
    // an empty list: every target of the modulator is a plugin.* (played by the page server from /zustand/mod); it runs and reports, it applies nothing in the core
    if (!zl.is_array() || zl.size() > static_cast<size_t>(ARR_MOD_ZIELE)) format(wm + "ziele is not a list of 0 to " + std::to_string(ARR_MOD_ZIELE) + " targets");
    for (size_t zi = 0; zi < zl.size(); ++zi) {
      const json& zo = zl[zi];
      const std::string wz = wm + "ziele[" + std::to_string(zi) + "].";
      if (!zo.is_object()) format(wz + "not an object");
      const bool mit_kette = zo.contains("kette");
      const bool mit_spur = zo.contains("spur"), mit_ret = zo.contains("ret");
      if (mit_kette ? (mit_spur || mit_ret || zo.contains("ziel")) : mit_spur == mit_ret)
        format(wz + "spur, ret or kette: exactly one of them (a chain target names no ziel)");
      const std::string zname = mit_kette ? std::string("kette") : text(zo, "ziel", wz);
      const double tiefe = zahl(zo, "tiefe", wz);
      ArrModZiel z{};
      if (zo.contains("uni")) {
        if (!zo.at("uni").is_boolean()) format(wz + "uni is not a boolean");
        z.uni = zo.at("uni").get<bool>();
      }
      if (md.art == 1) z.uni = true;   // D6: a follower is unipolar on every target (its course runs as 2 * out - 1, so the offset is tiefe * out)
      double t_min = -1.0, t_max = 1.0;
      if (mit_kette) {   // slice 4: a stage parameter or a rack macro of a strip's chain, the rules of lese_kette_auto (the chains and racks are read already)
        const std::string ka = text(zo, "kette", wz);
        const int64_t kn = ganz(zo, "nr", wz);
        int strip = -1;
        if (ka == "spur") {
          if (kn < 1 || kn > ARR_SPUREN || snap.spur[kn - 1].nr == 0) format(wz + "kette spur " + std::to_string(kn) + " is not in the playback");
          strip = static_cast<int>(kn) - 1;
        } else if (ka == "grp") {
          if (kn < 1 || kn > ARR_GRUPPEN) format(wz + "kette grp nr outside 1 to " + std::to_string(ARR_GRUPPEN));
          strip = ARR_SPUREN + static_cast<int>(kn) - 1;
        } else if (ka == "ret") {
          if (kn < 1 || kn > ARR_RETURNS || !snap.ret_da[kn - 1]) format(wz + "kette ret " + std::to_string(kn) + " is not in the playback");
          strip = ARR_KETTE_RET0 + static_cast<int>(kn) - 1;
        } else if (ka == "pm") {
          if (kn != 1) format(wz + "kette pm takes nr 1");
          strip = ARR_KETTE_PM;
        } else {
          format(wz + "kette " + ka + " unknown (spur, grp, ret, pm)");
        }
        const ArrKette& k = snap.kette[strip];
        const ArrRack& rk = snap.rack[strip];
        z.slot = static_cast<int16_t>(strip);
        if (zo.contains("makro")) {
          if (zo.contains("stufe") || zo.contains("param")) format(wz + "makro and stufe/param in one target");
          const int64_t mk = ganz(zo, "makro", wz);
          if (mk < 0 || mk >= ARR_MAKROS) format(wz + "makro outside 0 to " + std::to_string(ARR_MAKROS - 1));
          if (rk.slot < 0) format(wz + "makro: the strip has no rack");
          z.art = 4;
          z.param = static_cast<uint8_t>(mk);
        } else {
          const int64_t st = ganz(zo, "stufe", wz), pa = ganz(zo, "param", wz);
          if (st < 0 || st >= k.n) format(wz + "stufe " + std::to_string(st) + " is not in the chain (" + std::to_string(k.n) + " stages)");
          const ArrInsArt art = k.st[st].art;
          if (art == ArrInsArt::host) format(wz + "a host stage takes no modulator in the core (a plugin target is played by the server)");
          if (pa < 0 || pa >= ins_param_zahl(art)) format(wz + "param " + std::to_string(pa) + " outside the parameters of the stage");
          if (pa == 0) format(wz + "param 0 (an) cannot be modulated");
          if (art == ArrInsArt::komp && pa == 9) format(wz + "param 9 (sc, the key) cannot be modulated");
          if (art == ArrInsArt::eq && pa == INS_EQ_SC) format(wz + "param 85 (sc, the key) cannot be modulated");   // strand 5 slice 4
          for (int q = 0; q < rk.n; ++q)
            if (rk.z[q].stufe == st && rk.z[q].param == pa)
              format(wz + "(stufe " + std::to_string(st) + ", param " + std::to_string(pa) + ") is mapped by a rack macro (modulate the macro)");
          z.art = 3;
          z.stufe = static_cast<uint8_t>(st);
          z.param = static_cast<uint8_t>(pa);
        }
      } else if (mit_spur) {
        const int64_t sn = ganz(zo, "spur", wz);
        if (sn < 1 || sn > ARR_SPUREN) format(wz + "spur outside 1 to " + std::to_string(ARR_SPUREN));
        const ArrSpur& sp = snap.spur[sn - 1];
        if (sp.nr == 0) format(wz + "spur " + std::to_string(sn) + " is not in the playback");
        const AutoZiel* az = nullptr;
        for (const AutoZiel& a : AUTO_ZIELE)
          if (zname == a.name) az = &a;
        if (!az || !(az->ziel == ARR_AUTO_FADER || az->ziel == ARR_AUTO_PAN || az->ziel == ARR_AUTO_GERAET || az->ziel == ARR_AUTO_SEND))
          format(wz + "ziel " + zname + " is no modulator target (fader, pan, send.*, geraet.*)");
        if (az->geraet == 1 && !(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "rb338") == 0)) format(wz + "ziel " + zname + " only on an RB-338 track");
        if (az->geraet == 2 && !(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "bk") == 0)) format(wz + "ziel " + zname + " only on a Baukasten (bk) track");
        z.slot = static_cast<int16_t>(sn - 1);
        if (az->ziel == ARR_AUTO_GERAET) {
          z.art = 1;
          z.param = az->param;
        } else if (az->ziel == ARR_AUTO_SEND) {   // slice 4: send.<r>, r a return in the playback, depth in dB
          if (!snap.ret_da[az->param]) format(wz + "ziel " + zname + ": return " + std::to_string(az->param + 1) + " is not in the playback");
          z.art = 2;
          z.param = az->param;
          t_min = -24.0, t_max = 24.0;
        } else {
          z.art = 0;
          z.feld = az->ziel;   // ARR_AUTO_FADER 0, ARR_AUTO_PAN 1 (= the mixer field)
          if (az->ziel == ARR_AUTO_FADER) t_min = -24.0, t_max = 24.0;
        }
      } else {
        const int64_t rn = ganz(zo, "ret", wz);
        if (rn < 1 || rn > ARR_RETURNS) format(wz + "ret outside 1 to " + std::to_string(ARR_RETURNS));
        if (!snap.ret_da[rn - 1]) format(wz + "ret " + std::to_string(rn) + " is not in the playback");
        if (zname != "fader") format(wz + "ziel " + zname + ": a return takes a fader modulator only");
        z.art = 0;
        z.slot = static_cast<int16_t>(ARR_SPUREN + rn - 1);
        z.feld = ARR_AUTO_FADER;
        t_min = -24.0, t_max = 24.0;
      }
      if (!(tiefe >= t_min && tiefe <= t_max)) format(wz + "tiefe outside the range of " + zname);
      z.tiefe = static_cast<float>(tiefe);
      for (int q = 0; q < md.n; ++q)
        if (md.z[q].art == z.art && md.z[q].slot == z.slot && (z.art == 0 ? md.z[q].feld == z.feld : md.z[q].param == z.param) && (z.art != 3 || md.z[q].stufe == z.stufe))
          format(wz + "ziel " + zname + " twice in one modulator");
      if (z.art == 0) {   // the buffer of the (slot, field) pair, shared by every modulator on it
        int b = 0;
        while (b < snap.n_mod_felder && !(snap.mod_feld[b].slot == z.slot && snap.mod_feld[b].feld == z.feld)) ++b;
        if (b == snap.n_mod_felder) {
          if (b >= ARR_MOD_FELDER) throw Abbruch("zu_gross", wz + "more than " + std::to_string(ARR_MOD_FELDER) + " distinct fader and pan targets in all modulators");
          snap.mod_feld[b].slot = z.slot;
          snap.mod_feld[b].feld = z.feld;
          ++snap.n_mod_felder;
        }
        z.puffer = static_cast<int8_t>(b);
      }
      md.z[md.n++] = z;
    }
    snap.mod[snap.n_mod++] = md;
  }
}

// S20: the graph name rule = GRAPH_NAME in ui/graphs.ts = BK_GRAPH_NAME in model.ts = kit_name_ok in net_erz.cpp
bool bk_name_ok(const std::string& n) {
  if (n.empty() || n.size() > 32) return false;
  for (char c : n)
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  return true;
}
// k1..k64, no leading zero (k01 is not a knob)
bool bk_knopf_ok(const std::string& k) {
  if (k.size() < 2 || k.size() > 3 || k[0] != 'k') return false;
  for (size_t i = 1; i < k.size(); ++i)
    if (k[i] < '0' || k[i] > '9') return false;
  if (k[1] == '0') return false;
  const int n = std::atoi(k.c_str() + 1);
  return n >= 1 && n <= BK_KNOEPFE;
}

bool hex64(const std::string& s) {
  if (s.size() != 64) return false;
  for (char c : s)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}

// Strand 7 task 1.2 (plan 2026-11-27 strang7-midi, section 3.2): the playback key `midi` of an instrument track into ArrMidiParam. wm is the field path
// of the object ("spuren[3].midi"); every refusal is `format` and names the field. Every member is optional, at least one stage (akkord, skala, arp,
// velocity, chance) must be there; unknown members are refused, inside a stage too.
void midi_nur(const json& o, const std::string& wm, std::initializer_list<const char*> erlaubt) {
  for (auto it = o.begin(); it != o.end(); ++it) {
    bool ok = false;
    for (const char* e : erlaubt) ok = ok || it.key() == e;
    if (!ok) format(wm + "." + it.key() + ": unknown member");
  }
}
const json& midi_objekt(const json& o, const char* name, const std::string& wm) {
  const json& x = o.at(name);
  if (!x.is_object()) format(wm + "." + name + ": not an object");
  return x;
}
int64_t midi_ganz(const json& o, const char* name, const std::string& wm, int64_t lo, int64_t hi) {
  const json& w = o.at(name);
  if (!w.is_number_integer()) format(wm + "." + name + ": not an integer");
  if (w.is_number_unsigned() && w.get<uint64_t>() > static_cast<uint64_t>(hi)) format(wm + "." + name + ": outside " + std::to_string(lo) + " to " + std::to_string(hi));
  const int64_t v = w.get<int64_t>();
  if (v < lo || v > hi) format(wm + "." + name + ": outside " + std::to_string(lo) + " to " + std::to_string(hi));
  return v;
}
double midi_zahl(const json& o, const char* name, const std::string& wm, double lo, double hi, const char* bereich) {
  const json& w = o.at(name);
  if (!w.is_number()) format(wm + "." + name + ": not a number");
  const double v = w.get<double>();
  if (!(v >= lo && v <= hi)) format(wm + "." + name + ": outside " + bereich);
  return v;
}
void lese_midi(const json& m, const std::string& wm, ArrMidiParam& p) {
  if (!m.is_object()) format(wm + ": not an object");
  midi_nur(m, wm, {"akkord", "skala", "arp", "velocity", "chance", "saat"});
  if (!m.contains("akkord") && !m.contains("skala") && !m.contains("arp") && !m.contains("velocity") && !m.contains("chance"))
    format(wm + ": no stage (akkord, skala, arp, velocity or chance)");
  ArrMidiParam q{};
  if (m.contains("akkord")) {
    const std::string wa = wm + ".akkord";
    const json& a = m.at("akkord");
    if (!a.is_array()) format(wa + ": not a list");
    if (a.empty() || a.size() > static_cast<size_t>(MIDI_AKKORD_MAX)) format(wa + ": needs 1 to " + std::to_string(MIDI_AKKORD_MAX) + " intervals");
    for (size_t i = 0; i < a.size(); ++i) {
      const std::string wi = wa + "[" + std::to_string(i) + "]";
      if (!a[i].is_number_integer()) format(wi + ": not an integer");
      const int64_t v = a[i].get<int64_t>();
      if (v < -24 || v > 24 || v == 0) format(wi + ": must be -24 to 24 and not 0");
      for (int k = 0; k < q.akkord_n; ++k)
        if (q.akkord[k] == v) format(wi + ": interval " + std::to_string(v) + " twice");
      q.akkord[q.akkord_n++] = static_cast<int8_t>(v);
    }
  }
  if (m.contains("skala")) {
    const std::string ws = wm + ".skala";
    const json& s = midi_objekt(m, "skala", wm);
    midi_nur(s, ws, {"maske", "lane"});
    if (!s.contains("maske")) format(ws + ".maske: missing");
    q.skala_maske = static_cast<uint16_t>(midi_ganz(s, "maske", ws, 1, 4095));
    if (s.contains("lane")) {
      if (!s.at("lane").is_boolean()) format(ws + ".lane: not a boolean");
      q.skala_lane = s.at("lane").get<bool>();
    }
  }
  if (m.contains("arp")) {
    const std::string wa = wm + ".arp";
    const json& a = midi_objekt(m, "arp", wm);
    midi_nur(a, wa, {"muster", "rate", "hz", "oktaven", "gate"});
    q.arp = true;
    if (!a.contains("muster") || !a.at("muster").is_string()) format(wa + ".muster: missing or not a text");
    static const char* const MUSTER[] = {"up", "down", "updown", "downup", "played", "random", "chord"};
    const std::string mu = a.at("muster").get<std::string>();
    int mi = -1;
    for (int i = 0; i < 7; ++i)
      if (mu == MUSTER[i]) mi = i;
    if (mi < 0) format(wa + ".muster " + mu + " unknown (up, down, updown, downup, played, random, chord)");
    q.muster = static_cast<ArpMuster>(mi);
    if (a.contains("rate") == a.contains("hz")) format(wa + ": needs exactly one of rate (beats) and hz");
    if (a.contains("rate")) {
      // the sync rates 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32 in beats; the value is snapped to the exact one (the page writes 2/3 as a decimal)
      static const double RATEN[] = {2.0, 1.0, 2.0 / 3.0, 0.5, 1.0 / 3.0, 0.25, 1.0 / 6.0, 0.125};
      if (!a.at("rate").is_number()) format(wa + ".rate: not a number");
      const double r = a.at("rate").get<double>();
      int ri = -1;
      for (int i = 0; i < 8; ++i)
        if (std::fabs(r - RATEN[i]) <= 1e-6) ri = i;
      if (ri < 0) format(wa + ".rate: must be one of 2, 1, 2/3, 0.5, 1/3, 0.25, 1/6, 0.125 beats");
      q.sync = true;
      q.rate_beats = RATEN[ri];
    } else {
      q.sync = false;
      q.rate_hz = midi_zahl(a, "hz", wa, 0.5, 40.0, "0.5 to 40");
    }
    if (a.contains("oktaven")) q.oktaven = static_cast<uint8_t>(midi_ganz(a, "oktaven", wa, 1, 4));
    if (a.contains("gate")) q.gate = static_cast<float>(midi_zahl(a, "gate", wa, 0.05, 1.0, "0.05 to 1"));
  }
  if (m.contains("velocity")) {
    const std::string wv = wm + ".velocity";
    const json& v = midi_objekt(m, "velocity", wm);
    midi_nur(v, wv, {"kurve", "zufall", "fest"});
    q.vel = true;
    if (v.contains("kurve")) q.vel_kurve = static_cast<float>(midi_zahl(v, "kurve", wv, -1.0, 1.0, "-1 to 1"));
    if (v.contains("zufall")) q.vel_zufall = static_cast<uint8_t>(midi_ganz(v, "zufall", wv, 0, 64));
    if (v.contains("fest")) q.vel_fest = static_cast<uint8_t>(midi_ganz(v, "fest", wv, 0, 127));
  }
  if (m.contains("chance")) q.chance = static_cast<uint8_t>(midi_ganz(m, "chance", wm, 0, 100));
  if (m.contains("saat")) q.saat = static_cast<uint32_t>(midi_ganz(m, "saat", wm, 0, 4294967295LL));
  q.an = true;
  p = q;
}

}  // namespace

namespace {
// Die Bereiche eines Schnappschusses, die der Callback liest: Kopf und die vier Felder (je eigene Seiten)
template <class F>
void je_bereich(ArrSnapshot& s, F f) {
  f(static_cast<void*>(&s), arr_seiten(sizeof(ArrSnapshot)));
  if (s.clips.capacity()) f(static_cast<void*>(s.clips.data()), arr_seiten(s.clips.capacity() * sizeof(ArrClip)));
  if (s.noten.capacity()) f(static_cast<void*>(s.noten.data()), arr_seiten(s.noten.capacity() * sizeof(ArrNote)));
  if (s.noten_id.capacity())
    f(static_cast<void*>(s.noten_id.data()), arr_seiten(s.noten_id.capacity() * sizeof(uint64_t)));
  if (s.noten_id_index.capacity())
    f(static_cast<void*>(s.noten_id_index.data()), arr_seiten(s.noten_id_index.capacity() * sizeof(int32_t)));
  if (s.stifte.capacity()) f(static_cast<void*>(s.stifte.data()), arr_seiten(s.stifte.capacity() * sizeof(ArrStift)));   // kraken patch field
  if (s.fx_punkte.capacity()) f(static_cast<void*>(s.fx_punkte.data()), arr_seiten(s.fx_punkte.capacity() * sizeof(ArrFxPunkt)));   // tracker task 16
  if (s.warps.capacity()) f(static_cast<void*>(s.warps.data()), arr_seiten(s.warps.capacity() * sizeof(ArrWarp)));   // Paket 1.13
  if (s.warp_beat.capacity()) f(static_cast<void*>(s.warp_beat.data()), arr_seiten(s.warp_beat.capacity() * sizeof(double)));
  if (s.warp_frame.capacity()) f(static_cast<void*>(s.warp_frame.data()), arr_seiten(s.warp_frame.capacity() * sizeof(double)));
  if (s.auto_lane_liste.capacity())   // Automation Slice 1
    f(static_cast<void*>(s.auto_lane_liste.data()), arr_seiten(s.auto_lane_liste.capacity() * sizeof(ArrAutoLane)));
  if (s.auto_punkte.capacity()) f(static_cast<void*>(s.auto_punkte.data()), arr_seiten(s.auto_punkte.capacity() * sizeof(ArrAutoPunkt)));
#ifndef CYPHERDJ_MUTATION_ARR_HK_NICHT_GEBUCHT   // error case: the gain envelope points are neither booked nor locked (pageable, past the account)
  if (s.hk_punkte.capacity())   // 1.12 slice 5 (D8): the gain envelopes of the clips
    f(static_cast<void*>(s.hk_punkte.data()), arr_seiten(s.hk_punkte.capacity() * sizeof(ArrAutoPunkt)));
#endif
}
}  // namespace

bool ArrAudioCache::sperre(ArrSnapshot& s, std::string& grund, std::string& meldung) {
#ifdef CYPHERDJ_MUTATION_ARR_SCHNAPPSCHUSS_OFFEN
  (void)s;
  (void)grund;
  (void)meldung;
  return true;   // Fehlerfall: weder gesperrt noch gebucht (auslagerbar, am Konto vorbei)
#else
  int64_t b = 0;
  je_bereich(s, [&](void*, size_t n) { b += static_cast<int64_t>(n); });
  if (konto_ && !konto_->belaste(b)) {
    grund = "zu_gross";
    meldung = "speicher_budget (Schnappschuss): " + std::to_string((konto_->gesperrt() + b) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return false;
  }
  if (sperren_) {
    int e = 0;
    je_bereich(s, [&](void* p, size_t n) {
      if (!e && mlock(p, n) != 0) e = errno;
    });
    if (e) {
      je_bereich(s, [&](void* p, size_t n) { munlock(p, n); });
      if (konto_) konto_->entlaste(b);
      grund = "zu_gross";
      meldung = std::string("Schnappschuss: mlock ") + std::strerror(e);
      return false;
    }
  }
  s.gesperrt_bytes = b;
  return true;
#endif
}

void ArrAudioCache::entsperre(ArrSnapshot& s) {
  if (!s.gesperrt_bytes) return;
  if (sperren_) je_bereich(s, [&](void* p, size_t n) { munlock(p, n); });
  if (konto_) konto_->entlaste(s.gesperrt_bytes);
  s.gesperrt_bytes = 0;
}

std::string wiedergabe_pfad(const std::string& ordner, int64_t nr) {
  return ordner + "/wiedergabe-" + std::to_string(nr) + ".json";
}

ArrAudioCache::~ArrAudioCache() {
  // S20: free every instance without asking the sink: the cache outlives the kern only in the render, where the kern is gone first, and
  // in the kern the loader thread (and so this cache) ends after the callback has stopped
  for (BkEintrag& e : bk_)
    if (e.h) cypher_bk_frei(e.h);
  for (CypherBk* h : bk_aufgeschoben_) cypher_bk_frei(h);
  for (KitEintrag& e : kit_)   // 1.9: the same for the kit store, with unlock and unbooking
    if (e.k) kit_freigeben(std::move(e));
  for (KitEintrag& e : kit_aufgeschoben_) kit_freigeben(std::move(e));
  for (auto& [sha, a] : audio_) {
    if (a->gesperrt) munlock(a->abbild, a->bytes);
    munmap(a->abbild, a->bytes);
    if (konto_) konto_->entlaste(static_cast<int64_t>(a->bytes) + arr_audio_kopf());   // Daten und Kopf
  }
}

constexpr int64_t ARR_ZELLE_FRAMES_MAX = 2880000;   // loop deck cell: 60 s at 48 kHz

ArrAudio* ArrAudioCache::hole(const std::string& sha256, const std::string& datei, int64_t frames, std::string& grund,
                              std::string& meldung) {
  auto it = audio_.find(sha256);
  if (it != audio_.end()) {
    if (it->second->frames != frames) {
      grund = "format";
      meldung = datei + ": frames " + std::to_string(frames) + ", geladen " + std::to_string(it->second->frames);
      return nullptr;
    }
#ifndef CYPHERDJ_MUTATION_ARR_CACHE_OHNE_REF
    ++it->second->ref;   // Fehlerfall ohne: ein geteiltes Audio fiele mit dem ersten Schnappschuss
#endif
    return it->second.get();
  }
  // audit U32: frames * 8 must not wrap size_t (frames = 2^61 + n would match a tiny file, and the finite scan and the callback
  // would then run far past the mapping); INT64_MAX / 8 also keeps the bytes in int64_t for the budget below
  if (frames < 1 || frames > INT64_MAX / (2 * static_cast<int64_t>(sizeof(float)))) {
    grund = "format";
    meldung = datei + ": frames out of range: " + std::to_string(frames);
    return nullptr;
  }
  const int fd = open(datei.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    grund = "audio_fehlt";
    meldung = datei + ": " + std::strerror(errno);
    return nullptr;
  }
  struct stat st {};
  const size_t bytes = static_cast<size_t>(frames) * 2 * sizeof(float);
  if (fstat(fd, &st) != 0 || static_cast<size_t>(st.st_size) != bytes) {
    close(fd);
    grund = "format";
    meldung = datei + ": Größe " + std::to_string(st.st_size) + " statt frames · 8 = " + std::to_string(bytes);
    return nullptr;
  }
  const int64_t b = static_cast<int64_t>(bytes);
  if (gesperrt_ + b > budget_) {
    close(fd);
    grund = "zu_gross";
    meldung = "arr_budget: " + std::to_string((gesperrt_ + b) >> 20) + " MiB > " + std::to_string(budget_ >> 20) + " MiB";
    return nullptr;
  }
  const int64_t kb = b + arr_audio_kopf();   // K1-Fix-2 Punkt 3: auf dem Konto Daten und Kopf (eigene Seiten)
#ifdef CYPHERDJ_MUTATION_ARR_OHNE_KONTO
  if (false) {   // Fehlerfall: am gemeinsamen Konto vorbei (Decks und Arrangement verdrängen sich mit ENOMEM)
#else
  if (konto_ && !konto_->belaste(kb)) {
#endif
    close(fd);
    grund = "zu_gross";
    meldung = "speicher_budget: " + std::to_string((konto_->gesperrt() + kb) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return nullptr;
  }
  void* p = mmap(nullptr, bytes, PROT_READ, MAP_SHARED | (sperren_ ? MAP_POPULATE : 0), fd, 0);
  close(fd);
  if (p == MAP_FAILED) {
    if (konto_) konto_->entlaste(kb);
    grund = "zu_gross";
    meldung = datei + ": mmap " + std::strerror(errno);
    return nullptr;
  }
  bool gesperrt = false;
  if (sperren_) {
    if (mlock(p, bytes) != 0) {
      const int e = errno;
      munmap(p, bytes);
      if (konto_) konto_->entlaste(kb);
      grund = "zu_gross";
      meldung = datei + ": mlock " + std::strerror(e);
      return nullptr;
    }
    gesperrt = true;
  }
  // K1-Fix 5: NaN oder Inf im Audio wie im Deck-Lader (§13.2) abgelehnt, Grund format. Anders als dort die ganze Datei,
  // nicht 4096 Stichproben: Arrangement-Audio ist durch arr_budget begrenzt, und ein einziges NaN legt den Mix lahm.
#ifndef CYPHERDJ_MUTATION_ARR_OHNE_ENDLICH
  if (const int64_t bei = erstes_unendliches(static_cast<const float*>(p), frames * 2); bei >= 0) {
    if (gesperrt) munlock(p, bytes);
    munmap(p, bytes);
    if (konto_) konto_->entlaste(kb);
    grund = "format";
    meldung = datei + ": NaN oder Inf bei Frame " + std::to_string(bei / 2);
    return nullptr;
  }
#endif
  // K1-Fix-2 Punkt 3: der Kopf, den der Callback je Sample liest, in eigenen Seiten und gesperrt (der Kern sperrt beim
  // Start nur MCL_CURRENT; später angelegter Heap wäre auslagerbar)
  std::unique_ptr<ArrAudio> a;
  int kopf_fehler = 0;
  try {
    a = std::make_unique<ArrAudio>();
  } catch (const std::bad_alloc&) {
    kopf_fehler = ENOMEM;
  }
#ifndef CYPHERDJ_MUTATION_ARR_AUDIO_KOPF_OFFEN
  if (a && sperren_ && mlock(a.get(), static_cast<size_t>(arr_audio_kopf())) != 0) kopf_fehler = errno;
#endif
  if (kopf_fehler) {
    if (gesperrt) munlock(p, bytes);
    munmap(p, bytes);
    if (konto_) konto_->entlaste(kb);
    grund = "zu_gross";
    meldung = datei + ": Kopf " + std::strerror(kopf_fehler);
    return nullptr;
  }
  std::snprintf(a->sha256, sizeof a->sha256, "%s", sha256.c_str());
  a->daten = static_cast<const float*>(p);
  a->frames = frames;
  a->abbild = p;
  a->bytes = bytes;
  a->ref = 1;
  a->gesperrt = gesperrt;
  gesperrt_ += b;
  ArrAudio* roh = a.get();
  audio_.emplace(sha256, std::move(a));
  return roh;
}

bool ArrAudioCache::audio_gehalten(const ArrAudio* a, const WarpWerk* w) const {
  if (std::atomic_ref<int32_t>(const_cast<ArrAudio*>(a)->halter).load(std::memory_order_seq_cst) > 0) return true;
  return w && w->haelt(a);
}

void ArrAudioCache::audio_freigeben(ArrAudio* a) {
  auto it = audio_.find(a->sha256);
  if (it == audio_.end()) return;
  if (a->gesperrt) munlock(a->abbild, a->bytes);
  munmap(a->abbild, a->bytes);
  if (konto_) konto_->entlaste(static_cast<int64_t>(a->bytes) + arr_audio_kopf());   // Daten und Kopf
  gesperrt_ -= static_cast<int64_t>(a->bytes);
  audio_.erase(it);   // gibt den Kopf frei (munmap seiner Seiten hebt die Sperre auf)
}

void ArrAudioCache::gib(ArrAudio* a) {
  if (!a || --a->ref > 0) return;
  if (audio_.find(a->sha256) == audio_.end()) return;
#ifndef CYPHERDJ_MUTATION_ARR_AUDIO_OHNE_HALT
  if (audio_gehalten(a, werk_)) {   // K4: a launcher voice plays it on: the entry outlives the snapshot
    if (std::find(audio_aufgeschoben_.begin(), audio_aufgeschoben_.end(), a) == audio_aufgeschoben_.end()) audio_aufgeschoben_.push_back(a);
    return;
  }
#endif
  audio_freigeben(a);
}

int ArrAudioCache::audio_nachholen(const WarpWerk* w) {
  if (!w) w = werk_;
  int frei = 0;
  for (size_t i = 0; i < audio_aufgeschoben_.size();) {
    ArrAudio* a = audio_aufgeschoben_[i];
    if (a->ref > 0) {   // a later snapshot named it again (hole): it is live
      audio_aufgeschoben_.erase(audio_aufgeschoben_.begin() + static_cast<std::ptrdiff_t>(i));
      continue;
    }
    if (audio_gehalten(a, w)) {
      ++i;
      continue;
    }
    audio_aufgeschoben_.erase(audio_aufgeschoben_.begin() + static_cast<std::ptrdiff_t>(i));
    audio_freigeben(a);
    ++frei;
  }
  return frei;
}

// ---- S20: graph store -------------------------------------------------------------------------------------------------
namespace {
constexpr size_t BK_DATEI_MAX = 4u << 20;   // a graph file larger than this is refused (a real graph is a few KiB)
}

int32_t ArrAudioCache::bk_hole(int nr, const std::string& graph, CypherBk** h, uint64_t* gen, std::string& grund,
                               std::string& meldung, bool effekt, int lat_max, int* lat) {
  grund = "format";
  // arr-bk: for an insert stage (effekt) a graph file that is not there is its own reason: the loader plays the stage dry instead of refusing the whole playback
  const char* const fehlt = effekt ? "bk_graph_fehlt" : "format";
  if (bk_ordner_.empty()) {
    grund = fehlt;
    meldung = "graph " + graph + ": no graph folder set";
    return -1;
  }
  const std::string pfad = bk_ordner_ + "/" + graph + ".json";
  std::ifstream f(pfad, std::ios::binary);
  if (!f) {
    grund = fehlt;
    meldung = "graph " + graph + ": " + pfad + " cannot be read";
    return -1;
  }
  const std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  if (text.size() > BK_DATEI_MAX) {
    meldung = "graph " + graph + ": file larger than " + std::to_string(BK_DATEI_MAX >> 20) + " MiB";
    return -1;
  }
#ifdef CYPHERDJ_MUTATION_ARR_BK_OHNE_TEILEN
  const std::string schluessel = std::to_string(nr) + "|" + graph + "|" + std::to_string(arr_id(text)) + "|" + std::to_string(++bk_zaehler_);   // fault: never shared
  --bk_zaehler_;
#else
  const std::string schluessel = std::to_string(nr) + "|" + graph + "|" + std::to_string(arr_id(text));
#endif
  for (size_t i = 0; i < bk_.size(); ++i) {
    if (bk_[i].schluessel != schluessel) continue;
    ++bk_[i].ref;
    *h = bk_[i].h;
    *gen = bk_[i].gen;
    if (lat) *lat = bk_[i].lat;
    return static_cast<int32_t>(i);
  }
  char fehler[256] = {};
  const std::string wurzel = bk_ordner_ + "/samples";
  CypherBk* b = cypher_bk_neu_wurzel(text.c_str(), 48000.0, wurzel.c_str(), fehler, sizeof fehler);
  if (!b) {
    meldung = "graph " + graph + ": " + fehler;
    return -1;
  }
  if (effekt) {   // arr-bk slice 3: an insert stage needs an effect graph; its latency goes into the delay compensation (up to the dry ring of the stage)
    if (!cypher_bk_hat_eingang(b)) {
      cypher_bk_frei(b);
      meldung = "graph " + graph + " is an instrument graph (it has no input node), an effect graph is expected";
      return -1;
    }
    const uint32_t l = cypher_bk_latenz(b);
    if (l > static_cast<uint32_t>(lat_max)) {
      cypher_bk_frei(b);
      meldung = "graph " + graph + " has a latency of " + std::to_string(l) + " samples (an insert stage takes at most " + std::to_string(lat_max) + ")";
      return -1;
    }
    if (lat) *lat = static_cast<int>(l);
  } else {
#ifndef CYPHERDJ_MUTATION_ARR_BK_EFFEKT_OFFEN
    if (cypher_bk_hat_eingang(b)) {
      cypher_bk_frei(b);
      meldung = "graph " + graph + " is an effect graph, an instrument is expected";
      return -1;
    }
#endif
    const uint32_t l = cypher_bk_latenz(b);   // the latency joins the delay compensation of the strip (arr_pdc.h), like a stage at the head of the chain
    if (l > static_cast<uint32_t>(ARR_BK_INSTR_LAT_MAX)) {
      cypher_bk_frei(b);
      meldung = "graph " + graph + " has a latency of " + std::to_string(l) + " samples (an instrument graph on a project track takes at most " + std::to_string(ARR_BK_INSTR_LAT_MAX) + ")";
      return -1;
    }
    if (lat) *lat = static_cast<int>(l);
  }
  size_t slot = 0;
  while (slot < bk_.size() && !bk_[slot].schluessel.empty()) ++slot;
  if (slot == bk_.size()) bk_.emplace_back();
  bk_[slot].schluessel = schluessel;
  bk_[slot].h = b;
  bk_[slot].gen = ++bk_zaehler_;
  bk_[slot].ref = 1;
  bk_[slot].lat = lat ? *lat : 0;
  *h = b;
  *gen = bk_[slot].gen;
  return static_cast<int32_t>(slot);
}

void ArrAudioCache::bk_gib(int32_t slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= bk_.size() || bk_[slot].schluessel.empty()) return;
  BkEintrag& e = bk_[slot];
  if (--e.ref > 0) return;
  CypherBk* h = e.h;
  e.schluessel.clear();
  e.h = nullptr;
  e.ref = 0;
#ifdef CYPHERDJ_MUTATION_ARR_BK_FREI_OHNE_LESER
  cypher_bk_frei(h);   // fault: freed although the sink may still fade this instance
  return;
#else
  if (bk_leser_ && bk_leser_->nutzt(h)) {
    bk_aufgeschoben_.push_back(h);   // the sink fades it for one more block: freed in a later pass
    return;
  }
  cypher_bk_frei(h);
#endif
}

bool ArrAudioCache::bk_nachholen() {
  bool arbeit = false;
  for (size_t i = 0; i < bk_aufgeschoben_.size();) {
    if (bk_leser_ && bk_leser_->nutzt(bk_aufgeschoben_[i])) {
      ++i;
      continue;
    }
    cypher_bk_frei(bk_aufgeschoben_[i]);
    bk_aufgeschoben_[i] = bk_aufgeschoben_.back();
    bk_aufgeschoben_.pop_back();
    arbeit = true;
  }
  return arbeit;
}

int ArrAudioCache::bk_eintraege() const {
  int n = 0;
  for (const BkEintrag& e : bk_) n += e.h != nullptr;
  return n;
}

// ---- 1.9: kit store ----------------------------------------------------------------------------------------------------
namespace {
// Lock the pages a range touches. The unlock below takes only the pages the range owns completely: Linux locks do not count, so a
// munlock on a boundary page that a heap neighbour shares would also drop the neighbour's lock (the core's mlockall at start, or another
// kit). A sound smaller than a page therefore stays locked after its Kit is freed; that is a few KiB of resident memory, not a risk.
void kit_bereich_sperren(const void* p, size_t n, size_t* seite_aus, int* e) {
  const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  const uintptr_t a = reinterpret_cast<uintptr_t>(p) & ~(seite - 1);
  const uintptr_t z = (reinterpret_cast<uintptr_t>(p) + n + seite - 1) & ~(seite - 1);
  *seite_aus = z - a;
  if (mlock(reinterpret_cast<void*>(a), z - a) != 0) *e = errno;
}
void kit_bereich_entsperren(const void* p, size_t n) {
  const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  const uintptr_t a = (reinterpret_cast<uintptr_t>(p) + seite - 1) & ~(seite - 1);
  const uintptr_t z = (reinterpret_cast<uintptr_t>(p) + n) & ~(seite - 1);
  if (z > a) munlock(reinterpret_cast<void*>(a), z - a);
}
int64_t kit_bytes(const Kit& k) {
  int64_t b = 0;
  for (const KitKlang& kl : k.klang) b += kl.frames * 2 * static_cast<int64_t>(sizeof(float));
  return b;
}
}  // namespace

void ArrAudioCache::kit_freigeben(KitEintrag&& e) {
  if (!e.k) return;
  if (sperren_)
    for (const KitKlang& kl : e.k->klang)
      if (!kl.daten.empty()) kit_bereich_entsperren(kl.daten.data(), kl.daten.size() * sizeof(float));
  if (konto_) konto_->entlaste(e.bytes);
  e.k.reset();
  e.bytes = 0;
}

int32_t ArrAudioCache::kit_hole(const std::string& name, const Kit** k, uint64_t* gen, std::string& grund, std::string& meldung) {
  grund = "format";
  if (!bk_name_ok(name)) {   // the parser has checked it already; this is the last line before a path is built from the name
    meldung = "kit_hole: invalid kit name";
    return -1;
  }
  if (!kit_lader_) {
    meldung = "kit " + name + ": no kit loader";
    return -1;
  }
  const std::string ordner = kit_ordner_ + "/" + name;
  struct stat st {};
  if (kit_ordner_.empty() || stat((ordner + "/kit.json").c_str(), &st) != 0) {
    meldung = "kit " + name + ": folder " + ordner + " has no readable kit.json";
    return -1;
  }
#ifdef CYPHERDJ_MUTATION_ARR_KIT_OHNE_TEILEN
  const std::string schluessel = name + "|" + std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec) + "|" +
                                 std::to_string(st.st_size) + "|" + std::to_string(kit_zaehler_ + 1);   // fault: never shared
#else
  const std::string schluessel =
      name + "|" + std::to_string(st.st_mtim.tv_sec) + "." + std::to_string(st.st_mtim.tv_nsec) + "|" + std::to_string(st.st_size);
#endif
  for (size_t i = 0; i < kit_.size(); ++i) {
    if (kit_[i].schluessel != schluessel) continue;
    ++kit_[i].ref;
    *k = kit_[i].k.get();
    *gen = kit_[i].gen;
    return static_cast<int32_t>(i);
  }
  std::string fehler;
  std::unique_ptr<Kit> neu = kit_lader_(ordner, &fehler);
  if (!neu) {
    meldung = "kit " + name + ": " + fehler;
    return -1;
  }
  const int64_t bytes = kit_bytes(*neu);
  if (konto_ && !konto_->belaste(bytes)) {
    grund = "zu_gross";
    meldung = "speicher_budget (kit " + name + "): " + std::to_string((konto_->gesperrt() + bytes) >> 20) + " MiB > " +
              std::to_string(konto_->budget() >> 20) + " MiB";
    return -1;
  }
  if (sperren_) {
    int e = 0;
    for (const KitKlang& kl : neu->klang) {
      size_t n = 0;
      if (!kl.daten.empty() && !e) kit_bereich_sperren(kl.daten.data(), kl.daten.size() * sizeof(float), &n, &e);
    }
    if (e) {
      for (const KitKlang& kl : neu->klang)
        if (!kl.daten.empty()) kit_bereich_entsperren(kl.daten.data(), kl.daten.size() * sizeof(float));
      if (konto_) konto_->entlaste(bytes);
      grund = "zu_gross";
      meldung = "kit " + name + ": mlock " + std::strerror(e);
      return -1;
    }
  }
  size_t slot = 0;
  while (slot < kit_.size() && !kit_[slot].schluessel.empty()) ++slot;
  if (slot == kit_.size()) kit_.emplace_back();
  kit_[slot].schluessel = schluessel;
  kit_[slot].k = std::move(neu);
  kit_[slot].gen = ++kit_zaehler_;
  kit_[slot].ref = 1;
  kit_[slot].bytes = bytes;
  *k = kit_[slot].k.get();
  *gen = kit_[slot].gen;
  return static_cast<int32_t>(slot);
}

void ArrAudioCache::kit_gib(int32_t slot) {
  if (slot < 0 || static_cast<size_t>(slot) >= kit_.size() || kit_[slot].schluessel.empty()) return;
  KitEintrag& e = kit_[slot];
  if (--e.ref > 0) return;
  KitEintrag frei = std::move(e);
  e.schluessel.clear();
  e.ref = 0;
  e.bytes = 0;
#ifdef CYPHERDJ_MUTATION_ARR_KIT_FREI_OHNE_LESER
  kit_freigeben(std::move(frei));   // fault: freed although the sink may still play a sound of this Kit
  return;
#else
  if (kit_leser_ && kit_leser_->nutzt(frei.k.get())) {
    kit_aufgeschoben_.push_back(std::move(frei));   // the sink plays it for one more block: freed in a later pass
    return;
  }
  kit_freigeben(std::move(frei));
#endif
}

bool ArrAudioCache::kit_nachholen() {
  bool arbeit = false;
  for (size_t i = 0; i < kit_aufgeschoben_.size();) {
    if (kit_leser_ && kit_leser_->nutzt(kit_aufgeschoben_[i].k.get())) {
      ++i;
      continue;
    }
    kit_freigeben(std::move(kit_aufgeschoben_[i]));
    if (i + 1 != kit_aufgeschoben_.size()) kit_aufgeschoben_[i] = std::move(kit_aufgeschoben_.back());
    kit_aufgeschoben_.pop_back();
    arbeit = true;
  }
  return arbeit;
}

int ArrAudioCache::kit_eintraege() const {
  int n = 0;
  for (const KitEintrag& e : kit_) n += e.k != nullptr;
  return n;
}

void gib_wiedergabe(ArrSnapshot* s, ArrAudioCache& cache) {
  if (!s) return;
  cache.entsperre(*s);
  for (ArrAudio* a : s->audios) cache.gib(a);
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_REF
  for (int32_t sl : s->bk_refs) cache.bk_gib(sl);
#endif
#ifndef CYPHERDJ_MUTATION_ARR_KIT_OHNE_REF
  for (int32_t sl : s->kit_refs) cache.kit_gib(sl);   // 1.9: kit references
#endif
  delete s;
}

ArrLadeErgebnis lade_wiedergabe(const std::string& ordner, int64_t nummer, ArrAudioCache& cache) {
  ArrLadeErgebnis erg;
  const std::string pfad = wiedergabe_pfad(ordner, nummer);
  const std::string erlaubt = normal(ordner) + "/";   // Spec 6.14: Audio nur darunter (audio/<sha>.f32, freeze-*.f32)
  std::ifstream f(pfad);
  if (!f) {
    erg.grund = "datei_fehlt";
    erg.meldung = pfad + " fehlt";
    return erg;
  }
  auto snap = std::make_unique<ArrSnapshot>();
  {   // kraken patch field: the serial of this snapshot, unique per snapshot the loader builds, never 0 (a snapshot of a test keeps 0)
    static std::atomic<uint64_t> folge_zaehler{0};
    snap->folge = folge_zaehler.fetch_add(1, std::memory_order_relaxed) + 1;
  }
  std::vector<ArrAudio*> geholt;  // bei Abbruch zurückgeben
  try {
    json j;
    try {
      j = json::parse(f);
    } catch (const json::parse_error& e) {
      format(std::string("kein JSON: ") + e.what());
    }
    const std::string fmt = text(j, "format", "");
    const bool v4 = fmt == "cypherdj-arr/4";   // K5: /4 = /3 plus the track source `quelle` (read by K7), DJ outputs 1..4 = containers A..D and the live invariants (below)
    const bool v3 = fmt == "cypherdj-arr/3" || v4;   // /3 = /2 plus `returns[].auto` (the fader lane of a return); a core without it refuses the format
    const bool v2 = fmt == "cypherdj-arr/2" || v3;
    if (fmt != "cypherdj-arr/1" && !v2) format("format ist weder cypherdj-arr/1 noch cypherdj-arr/2 noch cypherdj-arr/3 noch cypherdj-arr/4");
    // Spec 3.2, 6.1: Schlüssel "nr" (Wiedergabe-Nummer der Instanz, wie S2 sie schreibt), gleich der Nummer im Dateinamen
    if (ganz(j, "nr", "") != nummer) format("nr in der Datei weicht von " + std::to_string(nummer) + " ab");
    const json& spuren = feld(j, "spuren", "");
    if (!spuren.is_array()) format("spuren ist keine Liste");
    if (spuren.size() > static_cast<size_t>(ARR_SPUREN))
      throw Abbruch("spur_bereich", "mehr als " + std::to_string(ARR_SPUREN) + " Spuren");
    snap->nr = nummer;
    // 1.10: Gruppen (nur /2). ausgang einer Gruppe: master (fehlt = master) oder eine andere Gruppe der Liste (nested groups); jede Nummer 1..ARR_GRUPPEN höchstens einmal.
    // DJ view places (decision 5): the head flag of the live container; a DJ output of a group needs it (below)
    bool live = false;
    if (j.contains("live")) {
      if (!j.at("live").is_boolean()) format("live ist kein bool");
      live = j.at("live").get<bool>();
    }
    snap->live = live;
    bool dj_da[PULT_CONTAINER + 1] = {};   // the DJ output numbers 1..4 given to a group (K5: containers A..D), each at most once
    bool gruppe_da[ARR_GRUPPEN + 1] = {};
    bool rack_belegt[ARR_RACKS] = {};      // 1.10 slice 4c: rack pool slots used by a strip
    bool ins_belegt[ARR_INS_ALLE] = {};   // 1.10 slice 4a/4b: pool slots (global index) used by a stage
    if (j.contains("gruppen")) {
      if (!v2) format("gruppen gibt es erst in cypherdj-arr/2");
      const json& gl = j.at("gruppen");
      if (!gl.is_array()) format("gruppen ist keine Liste");
      for (size_t gi = 0; gi < gl.size(); ++gi) {
        const json& g = gl[gi];
        const std::string wg = "gruppen[" + std::to_string(gi) + "].";
        const int64_t gn = ganz(g, "nr", wg);
        if (gn < 1 || gn > ARR_GRUPPEN) format(wg + "nr außerhalb 1 bis " + std::to_string(ARR_GRUPPEN));
        if (gruppe_da[gn]) format(wg + "nr doppelt");
        gruppe_da[gn] = true;
        const json& ag = feld(g, "ausgang", wg);
        const std::string g_art = text(ag, "art", wg + "ausgang.");
        if (g_art == "gruppe") {   // nested groups: the parent group; self and cycles are refused below (arr_gruppen_rechnen), a missing parent after the loop
          const int64_t pn = ganz(ag, "nr", wg + "ausgang.");
          if (pn < 1 || pn > ARR_GRUPPEN) format(wg + "ausgang.nr außerhalb 1 bis " + std::to_string(ARR_GRUPPEN));
          if (pn == gn) format(wg + "ausgang: eine Gruppe kann nicht in sich selbst ausgeben");
          snap->gruppe_ausgang[gn - 1] = static_cast<int8_t>(pn);
        } else if (g_art == "dj") {   // DJ view places (decision 5): only a group of the live container; a nested group has `gruppe` as its output, so a DJ output is always a top group
#ifndef CYPHERDJ_MUTATION_ARR_DJ_OHNE_LIVE   // error case: the head flag is not required
          if (!live) format(wg + "ausgang.art dj nur im Live-Projekt (Kopf live fehlt)");
#endif
          const int64_t dn = ganz(ag, "nr", wg + "ausgang.");
          if (dn < 1 || dn > PULT_CONTAINER) format(wg + "ausgang.nr outside 1 to " + std::to_string(PULT_CONTAINER) + " (DJ output)");
          if (dj_da[dn]) {
            const std::string m = wg + "ausgang: DJ output " + std::to_string(dn) + " doppelt";   // "doppelt" stays in the text for the old callers
            if (v4) throw Abbruch("dj_doppelt", m);   // K5 (V C9): its own reason in /4, `format` before
            format(m);
          }
          dj_da[dn] = true;
          snap->gruppe_dj[gn - 1] = static_cast<uint8_t>(dn);
        } else if (g_art != "master") {
          format(wg + "ausgang.art " + g_art + " unbekannt (master, gruppe oder dj)");
        }
        lese_kette(g, wg, snap->kette[ARR_SPUREN + gn - 1], ins_belegt, cache, *snap);
        lese_rack(g, wg, snap->kette[ARR_SPUREN + gn - 1], snap->rack[ARR_SPUREN + gn - 1], rack_belegt);   // 1.10 slice 4c T15
      }
      for (int gi = 0; gi < ARR_GRUPPEN; ++gi)
        if (snap->gruppe_ausgang[gi] > 0 && !gruppe_da[snap->gruppe_ausgang[gi]])
          format("gruppen[nr " + std::to_string(gi + 1) + "].ausgang.nr " + std::to_string(snap->gruppe_ausgang[gi]) + " steht nicht in gruppen");
    }
    // 1.10 slice 4a T3: the chain of the production master, `pm: {chain: [...]}` (only /2), before the PM fader.
    if (j.contains("pm")) {
      if (!v2) format("pm gibt es erst in cypherdj-arr/2");
      if (!j.at("pm").is_object()) format("pm ist kein Objekt");
      lese_kette(j.at("pm"), "pm.", snap->kette[ARR_KETTE_PM], ins_belegt, cache, *snap);
      lese_rack(j.at("pm"), "pm.", snap->kette[ARR_KETTE_PM], snap->rack[ARR_KETTE_PM], rack_belegt);
    }
    // Strand 7 task 5.2: the production harmony lane, `harmonie: [[beat, maske], ...]` (only /2..): beats finite, >= 0, strictly ascending; masks integers 1..4095;
    // 1..ARR_HARMONIE_MAX entries. Every refusal is `format` and names the entry.
    if (j.contains("harmonie")) {
      if (!v2) format("harmonie exists only in cypherdj-arr/2");
      const json& hl = j.at("harmonie");
      if (!hl.is_array()) format("harmonie: not a list");
      if (hl.empty()) format("harmonie: empty list (the key is absent without a lane)");
      if (hl.size() > static_cast<size_t>(ARR_HARMONIE_MAX)) format("harmonie: more than " + std::to_string(ARR_HARMONIE_MAX) + " entries");
      for (size_t hi = 0; hi < hl.size(); ++hi) {
        const json& e = hl[hi];
        const std::string wh = "harmonie[" + std::to_string(hi) + "]";
        if (!e.is_array() || e.size() != 2) format(wh + ": [beat, maske] expected");
        if (!e[0].is_number()) format(wh + ".beat: not a number");
        const double b = e[0].get<double>();
        if (!std::isfinite(b) || b < 0.0) format(wh + ".beat: finite and >= 0 expected");
        if (hi > 0 && !(b > snap->harmonie_beat[hi - 1])) format(wh + ".beat: beats strictly ascending expected");
        if (!e[1].is_number_integer()) format(wh + ".maske: not an integer");
        if (e[1].is_number_unsigned() ? (e[1].get<uint64_t>() < 1u || e[1].get<uint64_t>() > 4095u) : (e[1].get<int64_t>() < 1 || e[1].get<int64_t>() > 4095))
          format(wh + ".maske: outside 1 to 4095");
        snap->harmonie_beat[hi] = b;
        snap->harmonie_maske[hi] = static_cast<uint16_t>(e[1].get<int64_t>());
      }
      snap->n_harmonie = static_cast<int>(hl.size());
    }
    // 1.10 Slice 3: returns (only /2). The core needs only WHICH returns exist; the sends are controls, not data (spec 5.1).
    // nr 1..ARR_RETURNS at most once, the output is master or (live container only) dj with nr 1..6 (returns do not feed returns or groups).
    if (j.contains("returns")) {
      if (!v2) format("returns gibt es erst in cypherdj-arr/2");
      const json& rl = j.at("returns");
      if (!rl.is_array()) format("returns ist keine Liste");
      for (size_t ri = 0; ri < rl.size(); ++ri) {
        const json& r = rl[ri];
        const std::string wr = "returns[" + std::to_string(ri) + "].";
        const int64_t rn = ganz(r, "nr", wr);
        if (rn < 1 || rn > ARR_RETURNS) format(wr + "nr außerhalb 1 bis " + std::to_string(ARR_RETURNS));
        if (snap->ret_da[rn - 1]) format(wr + "nr doppelt");
        snap->ret_da[rn - 1] = true;
        if (r.contains("pre")) {   // 1.10 slice 4a: the sends into this return are taken before the fader and pan of their source
          if (!r.at("pre").is_boolean()) format(wr + "pre ist kein Wahrheitswert");
          snap->ret_pre[rn - 1] = r.at("pre").get<bool>();
        }
        if (r.contains("auto") && !v3) format(wr + "auto exists only in cypherdj-arr/3");   // an older loader would drop the lane silently: here it is refused
        const json& ar = feld(r, "ausgang", wr);
        const std::string r_art = text(ar, "art", wr + "ausgang.");
        if (r_art == "dj") {   // loop deck channel strip KZ3: a return of the live container can sound in a DJ channel pair; several returns may name the same channel (a deck's HALL and DELAY)
          if (!live) format(wr + "ausgang.art dj only in a live project (head flag live missing)");
          const int64_t dn = ganz(ar, "nr", wr + "ausgang.");
          if (dn < 1 || dn > PULT_CONTAINER) format(wr + "ausgang.nr outside 1 to " + std::to_string(PULT_CONTAINER) + " (DJ output)");
          snap->ret_dj[rn - 1] = static_cast<uint8_t>(dn);
        } else if (r_art != "master") {
          format(wr + "ausgang: a return sends to master or dj only (not " + r_art + ")");
        }
        lese_kette(r, wr, snap->kette[ARR_KETTE_RET0 + rn - 1], ins_belegt, cache, *snap);
        lese_rack(r, wr, snap->kette[ARR_KETTE_RET0 + rn - 1], snap->rack[ARR_KETTE_RET0 + rn - 1], rack_belegt);   // 1.10 slice 4c T15
      }
    }
    // The master takes no volume curve (owner decision): no `auto` on the production master, on a group, or on a `master` object. Only a return carries a fader lane.
    if (j.contains("pm") && j.at("pm").is_object() && j.at("pm").contains("auto")) format("pm.auto: the master takes no volume curve");
    if (j.contains("master") && j.at("master").is_object() && j.at("master").contains("auto")) format("master.auto: the master takes no volume curve");
    if (j.contains("gruppen") && j.at("gruppen").is_array())
      for (const json& g : j.at("gruppen"))
        if (g.is_object() && g.contains("auto")) format("gruppen[nr " + std::to_string(g.contains("nr") && g.at("nr").is_number_integer() ? g.at("nr").get<int64_t>() : 0) + "].auto: a group takes no fader lane");
    // Zählen, dann reservieren: die Zeiger in ArrSpur zeigen in die Vektoren, die danach nie wachsen
    size_t n_clips = 0, n_noten = 0, n_warps = 0, n_punkte = 0, n_lanes = 0, n_auto_p = 0, n_hk_p = 0, n_fx = 0;
    for (const json& s : spuren) {
      if (s.contains("clips") && s.at("clips").is_array()) {
        n_clips += s.at("clips").size();
        for (const json& c : s.at("clips")) {   // Paket 1.13: Warps und Marker zählen, bevor reserviert wird (die Zeiger bleiben gültig)
          if (c.is_object() && c.contains("gain_hk") && c.at("gain_hk").is_array()) n_hk_p += c.at("gain_hk").size();   // 1.12 slice 5: the hk points, own vector
          if (c.is_object() && c.contains("warp") && c.at("warp").is_object() && c.at("warp").contains("w") && c.at("warp").at("w").is_array()) {
            ++n_warps;
            n_punkte += c.at("warp").at("w").size();
            if (c.at("warp").contains("e") && c.at("warp").at("e").is_array()) n_punkte += c.at("warp").at("e").size();   // Slice 4: die Einheiten liegen hinter den Markern
          }
        }
      }
      if (s.contains("noten") && s.at("noten").is_array()) n_noten += s.at("noten").size();
      for (const char* fx_name : {"bend", "pegel"})   // tracker task 16: the events of both lists share one budget (the checks follow in the track loop)
        if (s.contains(fx_name) && s.at(fx_name).is_array()) n_fx += s.at(fx_name).size();
      if (s.contains("auto") && s.at("auto").is_array()) {   // Automation Slice 1: count lanes and points (the checks follow in the track loop)
        n_lanes += s.at("auto").size();
        for (const json& l : s.at("auto")) {
          if (!(l.is_object() && l.contains("punkte") && l.at("punkte").is_array())) continue;
          if (l.at("punkte").size() > static_cast<size_t>(ARR_AUTO_LANE_PUNKTE_MAX))
            throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_LANE_PUNKTE_MAX) + " points in one automation lane");
          n_auto_p += l.at("punkte").size();
        }
      }
    }
    // 1.12 slice 6: the points of the insert and rack lanes (chain_auto of every strip) share the vector and the budget
    auto zaehle_kette_auto = [&](const json& o) {
      if (!(o.is_object() && o.contains("chain_auto") && o.at("chain_auto").is_array())) return;
      for (const json& l : o.at("chain_auto")) {
        if (!(l.is_object() && l.contains("punkte") && l.at("punkte").is_array())) continue;
        if (l.at("punkte").size() > static_cast<size_t>(ARR_AUTO_LANE_PUNKTE_MAX))
          throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_LANE_PUNKTE_MAX) + " points in one automation lane");
        n_auto_p += l.at("punkte").size();
      }
    };
    if (j.contains("returns") && j.at("returns").is_array())   // the points of the return fader lanes (/3) share the vector and the budget
      for (const json& r : j.at("returns")) {
        if (!(r.is_object() && r.contains("auto") && r.at("auto").is_array())) continue;
        for (const json& l : r.at("auto")) {
          if (!(l.is_object() && l.contains("punkte") && l.at("punkte").is_array())) continue;
          if (l.at("punkte").size() > static_cast<size_t>(ARR_AUTO_LANE_PUNKTE_MAX))
            throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_LANE_PUNKTE_MAX) + " points in one automation lane");
          n_auto_p += l.at("punkte").size();
        }
      }
    for (const json& s : spuren) zaehle_kette_auto(s);
    if (j.contains("gruppen") && j.at("gruppen").is_array()) for (const json& g : j.at("gruppen")) zaehle_kette_auto(g);
    if (j.contains("returns") && j.at("returns").is_array()) for (const json& r : j.at("returns")) zaehle_kette_auto(r);
    if (j.contains("pm")) zaehle_kette_auto(j.at("pm"));
    if (n_auto_p > static_cast<size_t>(ARR_AUTO_PUNKTE_MAX))
      throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_PUNKTE_MAX) + " automation points in all lanes");
    // 1.12 slice 5: the gain envelopes count against the same budget as the lanes (one number for the server's roll-out, D7)
    if (n_auto_p + n_hk_p > static_cast<size_t>(ARR_AUTO_PUNKTE_MAX))
      throw Abbruch("zu_gross", "more than " + std::to_string(ARR_AUTO_PUNKTE_MAX) + " automation and gain envelope points in all");
    if (n_clips > static_cast<size_t>(ARR_CLIPS_MAX)) throw Abbruch("zu_gross", "mehr als 4096 Clips");
    if (n_noten > static_cast<size_t>(ARR_NOTEN_MAX)) throw Abbruch("zu_gross", "mehr als 65536 Noten");
    if (n_fx > static_cast<size_t>(ARR_FX_PUNKTE_MAX)) throw Abbruch("zu_gross", "mehr als " + std::to_string(ARR_FX_PUNKTE_MAX) + " bend/pegel");
#ifndef CYPHERDJ_MUTATION_ARR_WARP_OHNE_GESAMT   // Fehlerfall: die Gesamtgrenze der Marker aller Clips fehlt (Slice 3a, Task 15)
    if (n_punkte > static_cast<size_t>(ARR_WARP_PUNKTE_MAX))
      throw Abbruch("zu_gross", "mehr als " + std::to_string(ARR_WARP_PUNKTE_MAX) + " Warp-Marker in allen Clips");
#endif
    snap->clips.reserve(n_clips);
    snap->noten.reserve(n_noten);
    snap->noten_id.reserve(n_noten);
    snap->noten_id_index.reserve(n_noten);
    snap->fx_punkte.reserve(n_fx);   // before any push_back: ArrSpur::bend and ::pegel point into it
    snap->warps.reserve(n_warps);
    snap->warp_beat.reserve(n_punkte);
    snap->warp_frame.reserve(n_punkte);
    snap->auto_lane_liste.reserve(n_lanes);
    snap->auto_punkte.reserve(n_auto_p);
    snap->hk_punkte.reserve(n_hk_p);   // before any push_back: ArrClip::hk points into this vector
    std::map<std::string, ArrAudio*> je_sha;  // jedes Audio einmal je Schnappschuss
    int n_bk = 0;                              // S20: bk tracks of this playback (at most ARR_BK_MAX)
    int n_kit = 0;                             // 1.9: kit tracks of this playback (at most ARR_KIT_MAX)
    std::set<int> nr_gesehen;
    std::set<int> strom_gesehen;   // container core K7: the streams read by strom tracks (at most one track each)
    std::set<std::string> kennungen;   // loop deck: the track ids of this playback (unique)
    // 1.9 U6: the device of a track or of a rack member (the one code for both): art "intern" with geraet rb338, bk or kit, or art "wirt" with a
    // slot. glied: the object is a rack member (its device goes to snap->glied_spur, a graph instance is keyed by its member slot, a Surge slot
    // must not be used by another member or track, a rack does not nest). The checks and the texts are those of a track.
    std::set<int> wirt_slot_spur, wirt_slot_glied;   // Surge slots in use by tracks / by rack members
    auto geraet_lesen = [&](const json& s, const std::string& wo, ArrSpur& sp, int bk_nr, bool glied) {
      const std::string art = text(s, "art", wo);
      if (art == "intern") {
        sp.art = ArrArt::intern;
        const std::string g = text(s, "geraet", wo);
        if (glied && g == "rack") format(wo + "geraet rack: a rack does not nest");
        if (g != "rb338" && g != "bk" && g != "kit") format(wo + "geraet " + g + " unbekannt (rb338, bk oder kit)");
        std::snprintf(sp.geraet, sizeof sp.geraet, "%s", g.c_str());
        const bool ist_bk = g == "bk";
        const bool ist_kit = g == "kit";
        if (!ist_kit && s.contains("kit")) format(wo + "kit gibt es nur bei geraet kit");
        if (ist_kit) {   // 1.9: a kit track names a kit folder; it has no graph and no device parameter (the kit is the whole device)
          if (++n_kit > ARR_KIT_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_KIT_MAX) + " kit tracks");
          const std::string kn = text(s, "kit", wo);
#ifndef CYPHERDJ_MUTATION_ARR_KIT_NAME_UNGEPRUEFT
          if (!bk_name_ok(kn)) format(wo + "kit \"" + kn + "\": name must be 1 to 32 characters of [a-z0-9_-]");
#endif
          if (s.contains("parameter")) format(wo + "parameter gibt es nicht bei geraet kit");
          std::snprintf(sp.kit, sizeof sp.kit, "%s", kn.c_str());
        }
        if (ist_bk) {   // S20: a Baukasten graph; built here (loader thread), handed to the callback inside the snapshot
          if (++n_bk > ARR_BK_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_BK_MAX) + " bk tracks");
          const std::string gr = text(s, "graph", wo);
          if (!bk_name_ok(gr)) format(wo + "graph \"" + gr + "\": name must be 1 to 32 characters of [a-z0-9_-]");
          std::snprintf(sp.graph, sizeof sp.graph, "%s", gr.c_str());
        } else if (s.contains("graph")) {
          format(wo + "graph gibt es nur bei geraet bk");
        }
        if (s.contains("parameter")) {
          const json& p = s.at("parameter");
          if (!p.is_object()) format(wo + "parameter ist kein Objekt");
          for (auto it = p.begin(); it != p.end(); ++it) {
            if (ist_bk && !bk_knopf_ok(it.key())) format(wo + "parameter." + it.key() + ": a bk track knows k1 to k64");
            if (sp.n_param >= ARR_PARAMETER) format(wo + "mehr als " + std::to_string(ARR_PARAMETER) + " parameter");
            if (it.key().empty() || it.key().size() >= sizeof sp.param[0].name) format(wo + "parameter-Name zu lang");
            if (!it.value().is_number()) format(wo + "parameter." + it.key() + " ist keine Zahl");
            const double w = it.value().get<double>();
            if (!(w >= 0.0 && w <= 1.0)) format(wo + "parameter." + it.key() + " außerhalb 0 bis 1");
            std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", it.key().c_str());
            sp.param[sp.n_param++].wert = static_cast<float>(w);
          }
        }
        if (s.contains("stifte")) {   // kraken patch field: the pins of the track, [satz, zeile, spalte, wert] sorted strictly ascending by position, at most 512, wert finite in -1..1 and not 0
          if (!ist_bk || glied) format(wo + "stifte gibt es nur bei geraet bk auf einer Spur");
          const json& l = s.at("stifte");
          if (!l.is_array()) format(wo + "stifte ist keine Liste");
          if (l.size() > 512) format(wo + "stifte: more than 512 pins");
          sp.stift_von = static_cast<int32_t>(snap->stifte.size());
          int32_t letzte = -1;
          for (size_t i = 0; i < l.size(); ++i) {
            const json& e = l[i];
            const std::string w2 = wo + "stifte[" + std::to_string(i) + "]: ";
            if (!e.is_array() || e.size() != 4) format(w2 + "expected [satz, zeile, spalte, wert]");
            for (int c = 0; c < 4; ++c)
              if (!e[c].is_number()) format(w2 + "not a number");
            const double d0 = e[0].get<double>(), d1 = e[1].get<double>(), d2 = e[2].get<double>(), wv = e[3].get<double>();
            if (d0 != std::floor(d0) || d1 != std::floor(d1) || d2 != std::floor(d2)) format(w2 + "satz, zeile and spalte must be integers");
            if (!(d0 >= 0 && d0 <= 1 && d1 >= 0 && d1 <= 15 && d2 >= 0 && d2 <= 15)) format(w2 + "satz 0 to 1, zeile and spalte 0 to 15");
            if (!(wv >= -1.0 && wv <= 1.0) || wv == 0.0) format(w2 + "wert must be in -1 to 1 and not 0");
            const int32_t pos = static_cast<int32_t>(d0) * 256 + static_cast<int32_t>(d1) * 16 + static_cast<int32_t>(d2);
            if (pos <= letzte) format(w2 + "pins must be sorted by (satz, zeile, spalte) without a repeated position");
            letzte = pos;
            snap->stifte.push_back(ArrStift{static_cast<uint8_t>(d0), static_cast<uint8_t>(d1), static_cast<uint8_t>(d2), static_cast<float>(wv)});
          }
          sp.stift_n = static_cast<int32_t>(l.size());
          sp.stifte_da = true;
        }
        if (ist_bk) {   // all of the track's checks passed up to here: only now build or share the instance
          std::string grund, meldung;
          const int32_t slot = cache.bk_hole(bk_nr, sp.graph, &sp.bk, &sp.bk_gen, grund, meldung, false, 0, &sp.bk_latenz);
          if (slot < 0) throw Abbruch(grund, wo + meldung);
          snap->bk_refs.push_back(slot);
          sp.bk_rastet = cypher_bk_rastende(sp.bk);   // sampler A2: the knobs the core evaluates at each note's own beat
        }
        if (ist_kit) {   // same rule as bk: only now take (or load) the shared Kit
          std::string grund, meldung;
          const int32_t slot = cache.kit_hole(sp.kit, &sp.kit_ptr, &sp.kit_gen, grund, meldung);
          if (slot < 0) throw Abbruch(grund, wo + meldung);
          snap->kit_refs.push_back(slot);
        }
      } else if (art == "wirt") {
        sp.art = ArrArt::wirt;
        const int64_t slot = ganz(s, "slot", wo);
        if (slot < 1 || slot > ARR_WIRT_SLOTS) throw Abbruch("spur_bereich", wo + "slot außerhalb 1 bis 2");
        sp.slot = static_cast<int>(slot);
        // a Surge slot is one host: a rack member must not share it with another member or a track (two tracks of one slot stay legal, the sink
        // knows "another track plays the slot")
#ifndef CYPHERDJ_MUTATION_ARR_RACK_SLOT_DOPPELT
        const int sl = static_cast<int>(slot);
        if (glied ? (wirt_slot_glied.count(sl) || wirt_slot_spur.count(sl)) : wirt_slot_glied.count(sl))
          format(wo + "slot " + std::to_string(slot) + " is used twice (a Surge slot belongs to one rack member or track)");
        (glied ? wirt_slot_glied : wirt_slot_spur).insert(sl);
#endif
      } else {
        format(wo + "art " + art + " unbekannt");
      }
    };
    int n_rack = 0, n_platz = 0;   // rack tracks and member slots handed out so far
    for (size_t si = 0; si < spuren.size(); ++si) {
      const json& s = spuren[si];
      const std::string wo = "spuren[" + std::to_string(si) + "].";
      const int64_t nr = ganz(s, "nr", wo);
      if (nr < 1 || nr > ARR_SPUREN)
        throw Abbruch("spur_bereich", wo + "nr " + std::to_string(nr) + " außerhalb 1 bis " + std::to_string(ARR_SPUREN));
      if (!nr_gesehen.insert(static_cast<int>(nr)).second) throw Abbruch("spur_bereich", wo + "nr doppelt");
      ArrSpur& sp = snap->spur[nr - 1];
      sp.nr = static_cast<int>(nr);
      if (s.contains("rack") && !v2) format(wo + "rack gibt es erst in cypherdj-arr/2");
      if (s.contains("chain") && !v2) format(wo + "chain gibt es erst in cypherdj-arr/2");   // like ausgang below
      lese_kette(s, wo, snap->kette[nr - 1], ins_belegt, cache, *snap);
      GliedRoh glied_roh;   // 1.9 U8 T9: the member targets of this strip, checked after its members are parsed
      const bool ist_rack_spur = s.contains("art") && s.at("art").is_string() && s.at("art").get<std::string>() == "intern" && s.contains("geraet") &&
                                 s.at("geraet").is_string() && s.at("geraet").get<std::string>() == "rack";
      lese_rack(s, wo, snap->kette[nr - 1], snap->rack[nr - 1], rack_belegt, ist_rack_spur ? &glied_roh : nullptr, ist_rack_spur);   // 1.10 slice 4c T15
      if (s.contains("stumm_start")) {   // initial mute: the swap starts the track muted (Arrangement::tausche, Kern ARR_LADEN)
        if (!v2) format(wo + "stumm_start gibt es erst in cypherdj-arr/2");
        if (!s.at("stumm_start").is_boolean()) format(wo + "stumm_start is not a boolean");
        sp.stumm_start = s.at("stumm_start").get<bool>();
      }
      if (s.contains("ausgang")) {   // 1.10: master (Vorgabe) oder eine Gruppe aus der Liste; nur in /2
        if (!v2) format(wo + "ausgang gibt es erst in cypherdj-arr/2");
        const json& ag = s.at("ausgang");
        const std::string a_art = text(ag, "art", wo + "ausgang.");
        if (a_art == "gruppe") {
          const int64_t gn = ganz(ag, "nr", wo + "ausgang.");
          if (gn < 1 || gn > ARR_GRUPPEN) format(wo + "ausgang.nr außerhalb 1 bis " + std::to_string(ARR_GRUPPEN));
          if (!gruppe_da[gn]) format(wo + "ausgang.nr " + std::to_string(gn) + " steht nicht in gruppen");
          sp.ausgang = static_cast<int8_t>(gn);
        } else if (a_art != "master") {
          format(wo + "ausgang.art " + a_art + " unbekannt (master oder gruppe)");
        }
      }
      const std::string art = text(s, "art", wo);
      if (s.contains("quelle")) {   // container core K7: a track that reads an Erzeuger stream. The decision key is quelle.art, the track `art` is "intern" (what M writes)
        if (!v4) format(wo + "quelle gibt es erst in cypherdj-arr/4");
        const json& q = s.at("quelle");
        if (!q.is_object()) format(wo + "quelle is not an object");
        const std::string qart = text(q, "art", wo + "quelle.");
        if (qart != "strom") format(wo + "quelle.art " + qart + " unbekannt (strom)");
        if (art != "intern") format(wo + "a track with quelle has art intern");
        const int64_t sn = ganz(q, "strom", wo + "quelle.");
        if (sn < 1 || sn > ERZ_STROEME) format(wo + "quelle.strom außerhalb 1 bis " + std::to_string(ERZ_STROEME));
        if (!strom_gesehen.insert(static_cast<int>(sn)).second) format(wo + "quelle.strom " + std::to_string(sn) + " is read by another track (one track per stream)");
        for (const char* nein : {"geraet", "clips", "noten", "graph", "kit", "parameter", "slot"})
          if (s.contains(nein)) format(wo + std::string(nein) + " gibt es nicht bei einem Track mit quelle");
        sp.art = ArrArt::strom;
        sp.strom = static_cast<int8_t>(sn);
      } else if (art == "audio") {
        sp.art = ArrArt::audio;
      } else if (art == "intern" && text(s, "geraet", wo) == "rack") {   // 1.9 U6: an instrument rack (spec E9, E10)
        if (!v2) format(wo + "geraet rack gibt es erst in cypherdj-arr/2");
        sp.art = ArrArt::rack;
        std::snprintf(sp.geraet, sizeof sp.geraet, "rack");
        if (++n_rack > ARR_RACK_MAX) throw Abbruch("zu_gross", wo + "more than " + std::to_string(ARR_RACK_MAX) + " racks");
        for (const char* nein : {"parameter", "graph", "kit"})
          if (s.contains(nein)) format(wo + nein + " gibt es nicht bei geraet rack (die Glieder tragen die Geräte)");
        const int64_t kette = ganz(s, "kette", wo);
        if (kette < 0 || kette > 127) format(wo + "kette außerhalb 0 bis 127");
        sp.kette = static_cast<int>(kette);
        const json& gl = feld(s, "glieder", wo);
        if (!gl.is_array()) format(wo + "glieder ist keine Liste");
        if (gl.empty() || gl.size() > static_cast<size_t>(ARR_RACK_GLIEDER))
          format(wo + "glieder hat " + std::to_string(gl.size()) + " Einträge, erlaubt sind 1 bis " + std::to_string(ARR_RACK_GLIEDER));
        std::set<uint64_t> glied_ids;
        for (size_t gi = 0; gi < gl.size(); ++gi) {
          const json& g = gl[gi];
          const std::string wg = wo + "glieder[" + std::to_string(gi) + "].";
          if (!g.is_object()) format(wg + "kein Objekt");
          if (n_platz >= ARR_GLIED_PLAETZE) throw Abbruch("zu_gross", wg + "more than " + std::to_string(ARR_GLIED_PLAETZE) + " rack members");
          for (const char* nein : {"noten", "clips", "auto", "bend", "pegel"})
            if (g.contains(nein)) format(wg + nein + " gibt es nicht bei einem Glied (die Noten liegen auf der Rack-Spur)");
          ArrGlied& gd = sp.glied[gi];
          const std::string gid = text(g, "id", wg);
          if (gid.empty()) format(wg + "id leer");
          gd.id = arr_id(gid);
          if (!glied_ids.insert(gd.id).second) format(wg + "id doppelt: " + gid);
          gd.platz = ARR_SPUREN + n_platz++;
          ArrSpur& dev = snap->glied_spur[gd.platz - ARR_SPUREN];
          dev.nr = gd.platz + 1;
          geraet_lesen(g, wg, dev, gd.platz + 1, true);   // the device; a graph instance is keyed by the member slot
          gd.art = dev.art;
          gd.slot = dev.slot;
          if (dev.art == ArrArt::wirt) ++snap->rack_wirt;
          // zones: inclusive ranges, absent = the whole range; gain_db absent = 0
          auto zone = [&](const char* name, int lo_min, int hi_max, uint8_t& lo, uint8_t& hi) {
            if (!g.contains(name)) return;
            const json& z = g.at(name);
            if (!z.is_array() || z.size() != 2 || !z[0].is_number_integer() || !z[1].is_number_integer())
              format(wg + name + " ist kein Paar [von, bis] ganzer Zahlen");
            const int64_t a = z[0].get<int64_t>(), b = z[1].get<int64_t>();
#ifndef CYPHERDJ_MUTATION_ARR_RACK_ZONE_UNGEPRUEFT   // error case: an inverted or out-of-range zone is taken as it is
            if (a < lo_min || b > hi_max || a > b)
              format(wg + name + " [" + std::to_string(a) + ", " + std::to_string(b) + "]: needs " + std::to_string(lo_min) + " <= von <= bis <= " +
                     std::to_string(hi_max));
#endif
            lo = static_cast<uint8_t>(a);
            hi = static_cast<uint8_t>(b);
          };
          zone("ton", 0, 127, gd.ton_lo, gd.ton_hi);
          zone("vel", 1, 127, gd.vel_lo, gd.vel_hi);
          zone("kette", 0, 127, gd.kette_lo, gd.kette_hi);
          if (g.contains("gain_db")) {
            const double gdb = zahl(g, "gain_db", wg);
            if (gdb < ARR_GLIED_GAIN_DB_MIN || gdb > ARR_GLIED_GAIN_DB_MAX) format(wg + "gain_db außerhalb −60 bis +12");
            gd.gain = static_cast<float>(std::pow(10.0, gdb / 20.0));
          }
          ++sp.n_glieder;
        }
        lese_glied_ziele(s, wo, *snap, sp, glied_roh, snap->rack[nr - 1]);   // 1.9 U8 T9: needs the members above
      } else {
        geraet_lesen(s, wo, sp, static_cast<int>(nr), false);   // intern or wirt, or the refusal of an unknown art
      }
      if (s.contains("midi")) {   // strand 7: the MIDI stage (plan 2026-11-27 strang7-midi 3.2); only instrument tracks (D9), only /2../4 (D8)
        if (!v2) format(wo + "midi exists only in cypherdj-arr/2");
        if (sp.art != ArrArt::intern && sp.art != ArrArt::rack && sp.art != ArrArt::wirt) format(wo + "midi exists only on an instrument track (intern, rack or wirt)");
        lese_midi(s.at("midi"), wo + "midi", sp.midi);
      }
      if ((s.contains("id") || s.contains("zellen")) && sp.art != ArrArt::audio) format(wo + "id and zellen exist only on an audio track");
      if (s.contains("id") || s.contains("zellen")) {   // loop deck K1: the track id and the cells
        if (!v2) format(wo + "id and zellen exist only in cypherdj-arr/2");
        if (s.contains("id")) {
          const std::string kid = text(s, "id", wo);
          bool ok = !kid.empty() && kid.size() <= 32 && std::isalpha(static_cast<unsigned char>(kid[0]));
          for (const char ch : kid) ok = ok && (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-');
          if (!ok) format(wo + "id must match [A-Za-z][A-Za-z0-9_-]{0,31}");
          if (!kennungen.insert(kid).second) format(wo + "id doppelt: " + kid);
          sp.kennung = arr_id(kid);
          std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "%s", kid.c_str());
        }
        if (s.contains("zellen")) {
          const json& zl = s.at("zellen");
          if (!zl.is_array()) format(wo + "zellen is not a list");
          if (zl.size() > static_cast<size_t>(ARR_ZELLEN)) format(wo + "zellen: more than " + std::to_string(ARR_ZELLEN) + " cells");
          for (size_t zi = 0; zi < zl.size(); ++zi) {
            const json& zj = zl[zi];
            const std::string wz = wo + "zellen[" + std::to_string(zi) + "].";
            if (!zj.is_object()) format(wz + "is not an object");
            const int64_t index = ganz(zj, "index", wz);
            if (index < 1 || index > ARR_ZELLEN) format(wz + "index outside 1 to " + std::to_string(ARR_ZELLEN));
            ArrZelle& z = sp.zellen[index - 1];
            if (z.art != ArrZellArt::leer) format(wz + "index twice: " + std::to_string(index));
            const std::string zart = text(zj, "art", wz);
            const double beats = zahl(zj, "beats", wz);
            const int64_t modus = ganz(zj, "modus", wz);
            if (zart == "loop") {
              if (!(beats > 0.0)) format(wz + "a loop needs beats > 0");
              if (modus != 2 && modus != 0) format(wz + "a loop needs modus 2 (keylock) or 0 (keylock off)");
            } else if (zart == "einmal") {
              if (modus != 0) format(wz + "an einmal cell needs modus 0");
            } else {
              format(wz + "art " + zart + " unknown (loop or einmal)");
            }
            const std::string sha = text(zj, "sha256", wz);
            if (!hex64(sha)) format(wz + "sha256 nicht 64 Hex-Zeichen");
            const std::string datei = normal(text(zj, "datei", wz));
            if (datei.size() <= erlaubt.size() || datei.compare(0, erlaubt.size(), erlaubt) != 0)
              format(wz + "datei liegt nicht unterhalb des Arbeitsordners " + erlaubt + ": " + datei);
            const int64_t frames = ganz(zj, "frames", wz);
            if (frames < 1 || frames > ARR_ZELLE_FRAMES_MAX) format(wz + "frames outside 1 to " + std::to_string(ARR_ZELLE_FRAMES_MAX));
            const double gain_db = zahl(zj, "gain_db", wz);
            if (gain_db < -60.0 || gain_db > 12.0) format(wz + "gain_db outside -60 to +12");
            zelle_erweitern(zj, wz, z, beats, zart == "loop", frames, modus);   // S1b K2: before cache.hole, a refused cell maps and locks nothing
            ArrAudio*& a = je_sha[sha];
            if (!a) {
              std::string grund, meldung;
              a = cache.hole(sha, datei, frames, grund, meldung);
              if (!a) throw Abbruch(grund, wz + meldung);
              geholt.push_back(a);
            } else if (a->frames != frames) {
              format(wz + "frames weicht für dasselbe sha256 ab");
            }
            z.art = zart == "loop" ? ArrZellArt::loop : ArrZellArt::einmal;
            z.audio = a;
            z.frames = frames;
            z.beats = zart == "loop" ? beats : 0.0;
            z.huell_beats = beats;
            z.gain = static_cast<float>(std::pow(10.0, gain_db / 20.0));
            z.modus = static_cast<int8_t>(modus);
            ++sp.n_zellen;
          }
        }
      }
      if (sp.art == ArrArt::audio) {
        const json& clips = feld(s, "clips", wo);
        if (!clips.is_array()) format(wo + "clips ist keine Liste");
        const size_t c0 = snap->clips.size();
        std::set<uint64_t> ids;
        for (size_t ci = 0; ci < clips.size(); ++ci) {
          const json& c = clips[ci];
          const std::string wc = wo + "clips[" + std::to_string(ci) + "].";
          ArrClip x{};
          const std::string id = text(c, "id", wc);
          if (id.empty()) format(wc + "id leer");
          x.id = arr_id(id);
          if (!ids.insert(x.id).second) format(wc + "id doppelt: " + id);
          x.start_beat = zahl(c, "start_beat", wc);
          x.laenge_beats = zahl(c, "laenge_beats", wc);
          if (x.start_beat < 0.0) format(wc + "start_beat negativ");
          if (!(x.laenge_beats > 0.0)) format(wc + "laenge_beats nicht positiv");
          const std::string sha = text(c, "sha256", wc);
          if (!hex64(sha)) format(wc + "sha256 nicht 64 Hex-Zeichen");
          const std::string datei = normal(text(c, "datei", wc));
#ifdef CYPHERDJ_MUTATION_ARR_ORDNER_ROH
          const std::string roh = ordner + "/";   // Fehlerfall: Ordner ungeprüft angehängt (ein / am Ende lehnt alles ab)
          if (datei.compare(0, roh.size(), roh) != 0) format(wc + "datei liegt nicht im Arbeitsordner: " + datei);
#else
          if (datei.size() <= erlaubt.size() || datei.compare(0, erlaubt.size(), erlaubt) != 0)
            format(wc + "datei liegt nicht unterhalb des Arbeitsordners " + erlaubt + ": " + datei);
#endif
          const int64_t frames = ganz(c, "frames", wc);
          if (frames < 1) format(wc + "frames < 1");
          x.offset_frames = ganz(c, "offset_frames", wc);
          if (x.offset_frames < 0 || x.offset_frames >= frames) format(wc + "offset_frames außerhalb [0, frames)");
          // Spec 6.27: ein Wertebereich mit S2 (model.ts): gain_db −96..+24; Blenden ≥ 0 und zusammen höchstens
          // laenge_beats, mit S2s Toleranz 1e-9 (0,1 + 0,2 auf 0,3 Beats ist gültig)
          const double gain_db = zahl(c, "gain_db", wc);
#ifdef CYPHERDJ_MUTATION_ARR_GAIN_ALT
          if (gain_db < -200.0 || gain_db > 24.0) format(wc + "gain_db außerhalb −200 bis +24");   // Fehlerfall: alt
#else
          if (gain_db < ARR_GAIN_DB_MIN || gain_db > ARR_GAIN_DB_MAX) format(wc + "gain_db außerhalb −96 bis +24");
#endif
          x.gain = static_cast<float>(std::pow(10.0, gain_db / 20.0));
          if (c.contains("gain_hk")) {   // 1.12 slice 5 (D8): the gain envelope of this loop copy [copy beat, dB, formcode], the point checks of a lane, range -200..0
#ifndef CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG   // error case: /1 takes it, and no value is checked (a rising dB value or falling beats play)
            if (!v2) format(wc + "gain_hk exists only in cypherdj-arr/2");
#endif
            const json& hl = c.at("gain_hk");
            if (!hl.is_array() || hl.empty()) format(wc + "gain_hk is not a non-empty list");
            const size_t h0 = snap->hk_punkte.size();
            for (size_t hi = 0; hi < hl.size(); ++hi) {
              const json& q = hl[hi];
              const std::string wq = wc + "gain_hk[" + std::to_string(hi) + "]";
              if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, wert, form]");
              if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number_integer()) format(wq + " has a non-number");
              ArrAutoPunkt p{};
              p.beat = q[0].get<double>();
              const double w = q[1].get<double>();
              const int64_t fm = q[2].get<int64_t>();
#ifndef CYPHERDJ_MUTATION_ARR_HK_OHNE_PRUEFUNG
              if (!std::isfinite(p.beat) || p.beat < 0.0) format(wq + " beat negative or not finite");
              if (!(w >= ARR_HK_DB_MIN && w <= ARR_HK_DB_MAX)) format(wq + " wert outside -200 to 0 dB");
              if (fm < 0 || fm > 2) format(wq + " form outside 0 to 2");
              if (hi > 0 && p.beat < snap->hk_punkte.back().beat) format(wq + " beats fall");
              if (hi > 1 && p.beat == snap->hk_punkte[snap->hk_punkte.size() - 1].beat && p.beat == snap->hk_punkte[snap->hk_punkte.size() - 2].beat)
                format(wq + " three points at one beat");
#endif
              p.wert = static_cast<float>(w);
              p.form = static_cast<uint8_t>(fm);
              snap->hk_punkte.push_back(p);
            }
            x.hk = snap->hk_punkte.data() + h0;
            x.hk_n = static_cast<int>(hl.size());
          }
          x.ein_beats = zahl(c, "ein_beats", wc);
          x.aus_beats = zahl(c, "aus_beats", wc);
#ifdef CYPHERDJ_MUTATION_ARR_GAIN_ALT
          const double toleranz = 0.0;
#else
          const double toleranz = ARR_BLENDE_TOLERANZ;
#endif
          if (x.ein_beats < 0.0 || x.aus_beats < 0.0 || x.ein_beats + x.aus_beats > x.laenge_beats + toleranz)
            format(wc + "ein_beats/aus_beats negativ oder zusammen länger als der Clip");
          ArrAudio*& a = je_sha[sha];
          if (!a) {
            std::string grund, meldung;
            a = cache.hole(sha, datei, frames, grund, meldung);
            if (!a) throw Abbruch(grund, wc + meldung);
            geholt.push_back(a);
          } else if (a->frames != frames) {
            format(wc + "frames weicht für dasselbe sha256 ab");
          }
          x.audio = a;
#ifndef CYPHERDJ_MUTATION_ARR_WARP_IN_V1
          if (c.contains("warp") && !v2) format(wc + "warp gibt es erst in cypherdj-arr/2");   // auch null, wie ausgang (Fehlerfall: auch /1 nimmt einen Warp)
#endif
          if (c.contains("warp") && !c.at("warp").is_null()) {   // Paket 1.13
            const std::string ww = wc + "warp.";
            const json& wj = c.at("warp");
            if (!wj.is_object()) format(wc + "warp ist kein Objekt");
            const int64_t modus = ganz(wj, "modus", ww);
            if (modus != ARR_WARP_REPITCH && modus != ARR_WARP_BEATS && !arr_warp_werk_modus(static_cast<int32_t>(modus)))
              format(ww + "modus " + std::to_string(modus) + " ist nicht gebaut (0 repitch, 1 beats, 2 complex, 3 tones)");
            if (modus != ARR_WARP_BEATS && (wj.contains("e") || wj.contains("loop") || wj.contains("huelle")))
              format(ww + "e, loop und huelle gibt es nur bei modus 1 (beats)");
            // Paket 1.13 Slice 2: complex und tones rechnet Bungee im Warp-Werk. Ein Kern ohne Bungee lehnt sie beim Laden ab, statt still
            // RE-PITCH zu spielen (falsche Tonhöhe, im Takt): die vorige Wiedergabe spielt weiter, der Seiten-Server meldet den Grund.
#if !defined(CYPHERDJ_BUNGEE) || defined(CYPHERDJ_TEST_OHNE_MASCHINE)
#ifndef CYPHERDJ_MUTATION_ARR_WARP_MASCHINE_STILL   // Fehlerfall: der Lader nimmt den Modus ohne Maschine an und spielt ihn als RE-PITCH
            if (arr_warp_werk_modus(static_cast<int32_t>(modus)))
              throw Abbruch("warp_maschine_fehlt", ww + "modus " + std::to_string(modus) + " braucht einen Kern mit Bungee (CYPHERDJ_BUNGEE)");
#endif
#endif
            double pitch = 1.0;   // Slice 5: fehlt = 1
            if (wj.contains("pitch")) {
              pitch = zahl(wj, "pitch", ww);   // Text, null, nicht endlich: format
#ifndef CYPHERDJ_MUTATION_ARR_WARP_PITCH_OHNE_GRENZE   // Fehlerfall: jedes positive pitch gilt (Bungee bekäme ein Korn über seinem Puffer)
              if (!(pitch >= ARR_WARP_PITCH_MIN * (1.0 - 1e-9) && pitch <= ARR_WARP_PITCH_MAX * (1.0 + 1e-9)))
                format(ww + "pitch " + std::to_string(pitch) + " außerhalb " + std::to_string(ARR_WARP_PITCH_MIN) + " bis " + std::to_string(ARR_WARP_PITCH_MAX));
#else
              if (!(pitch > 0.0)) format(ww + "pitch nicht positiv");
#endif
              if (modus == ARR_WARP_REPITCH && pitch != 1.0) format(ww + "pitch bei repitch: RE-PITCH folgt dem Tempo");
              if (modus == ARR_WARP_BEATS && pitch != 1.0) format(ww + "pitch bei beats: BEATS nimmt keine Tonhöhe (D6b)");
            }
            const json& wl = feld(wj, "w", ww);
            if (!wl.is_array()) format(ww + "w ist keine Liste");
#ifdef CYPHERDJ_MUTATION_ARR_WARP_OHNE_GRENZE   // Fehlerfall: ein Marker und mehr als 4096 gelten als gültig
            if (wl.empty())
#else
            if (wl.size() < 2 || wl.size() > static_cast<size_t>(ARR_WARP_MARKER_MAX))
#endif
              format(ww + "w hat " + std::to_string(wl.size()) + " Marker, erlaubt sind 2 bis " + std::to_string(ARR_WARP_MARKER_MAX));
            const size_t p0 = snap->warp_beat.size();
            for (size_t mi = 0; mi < wl.size(); ++mi) {
              const json& m = wl[mi];
              const std::string wm = ww + "w[" + std::to_string(mi) + "]";
              if (!m.is_array() || m.size() != 2 || !m[0].is_number() || !m[1].is_number()) format(wm + " ist kein Paar [beat, frame]");
              const double b = m[0].get<double>(), fr = m[1].get<double>();
              if (!std::isfinite(b) || !std::isfinite(fr)) format(wm + " nicht endlich");
              if (std::fabs(b) > 1e6) format(wm + " beat außerhalb ±1e6");
              if (fr < 0.0 || fr > 1.1e12) format(wm + " frame außerhalb 0 bis 1,1e12");
#ifndef CYPHERDJ_MUTATION_ARR_WARP_OHNE_STEIGEND   // Fehlerfall: fallende Marker laden (W(b) wäre nicht mehr eindeutig)
              if (mi > 0 && !(b > snap->warp_beat.back())) format(wm + " beat nicht streng steigend");
              if (mi > 0 && !(fr > snap->warp_frame.back())) format(wm + " frame nicht streng steigend");
#endif
              snap->warp_beat.push_back(b);
              snap->warp_frame.push_back(fr);
            }
            ArrWarp w;
            w.modus = static_cast<int32_t>(modus);
            w.pitch = pitch;
            w.n = static_cast<int32_t>(wl.size());
            w.beat = snap->warp_beat.data() + p0;
            w.frame = snap->warp_frame.data() + p0;
            if (modus == ARR_WARP_BEATS) {   // Slice 4: Einheiten [Clip-Beat, Quell-Frame] hinter den Markern, dazu loop und huelle
              const int64_t lp = ganz(wj, "loop", ww), hu = ganz(wj, "huelle", ww);
              if (lp < 0 || lp > 2) format(ww + "loop " + std::to_string(lp) + " außerhalb 0 bis 2");
              if (hu < 0 || hu > 100) format(ww + "huelle " + std::to_string(hu) + " außerhalb 0 bis 100");
              const json& el = feld(wj, "e", ww);
              if (!el.is_array()) format(ww + "e ist keine Liste");
              if (el.empty() || el.size() > static_cast<size_t>(ARR_BEATS_EINHEITEN_MAX))
                format(ww + "e hat " + std::to_string(el.size()) + " Einheiten, erlaubt sind 1 bis " + std::to_string(ARR_BEATS_EINHEITEN_MAX));
              const size_t e0 = snap->warp_beat.size();
              for (size_t ei = 0; ei < el.size(); ++ei) {
                const json& m = el[ei];
                const std::string we = ww + "e[" + std::to_string(ei) + "]";
                if (!m.is_array() || m.size() != 2 || !m[0].is_number() || !m[1].is_number()) format(we + " ist kein Paar [beat, frame]");
                const double b = m[0].get<double>(), fr = m[1].get<double>();
                if (!std::isfinite(b) || !std::isfinite(fr)) format(we + " nicht endlich");
                if (std::fabs(b) > 1e6) format(we + " beat außerhalb ±1e6");
                if (fr < 0.0 || fr > 1.1e12) format(we + " frame außerhalb 0 bis 1,1e12");
#ifndef CYPHERDJ_MUTATION_ARR_BEATS_OHNE_STEIGEND   // Fehlerfall: fallende Einheiten laden (beats_einheit fände die falsche)
                if (ei > 0 && !(b > snap->warp_beat.back())) format(we + " beat nicht streng steigend");
                if (ei > 0 && !(fr > snap->warp_frame.back())) format(we + " frame nicht streng steigend");
#endif
                snap->warp_beat.push_back(b);
                snap->warp_frame.push_back(fr);
              }
              w.e_n = static_cast<int32_t>(el.size());
              w.e_beat = snap->warp_beat.data() + e0;
              w.e_frame = snap->warp_frame.data() + e0;
              w.loop = static_cast<int32_t>(lp);
              w.huelle = static_cast<int32_t>(hu);
            }
            snap->warps.push_back(w);
            x.warp = &snap->warps.back();
          }
          snap->clips.push_back(x);
        }
        std::sort(snap->clips.begin() + static_cast<long>(c0), snap->clips.end(),
                  [](const ArrClip& a, const ArrClip& b) { return a.start_beat < b.start_beat; });
        sp.n_clips = static_cast<int>(snap->clips.size() - c0);
        sp.clips = sp.n_clips ? snap->clips.data() + c0 : nullptr;
      } else if (sp.art != ArrArt::strom) {   // container core K7: a strom track has neither clips nor notes
        const json& noten = feld(s, "noten", wo);
        if (!noten.is_array()) format(wo + "noten ist keine Liste");
        const size_t n0 = snap->noten.size();
        for (size_t ni = 0; ni < noten.size(); ++ni) {
          const json& n = noten[ni];
          const std::string wn = wo + "noten[" + std::to_string(ni) + "].";
          ArrNote x{};
          const std::string id = text(n, "id", wn);
          if (id.empty()) format(wn + "id leer");
          x.id = arr_id(id);
          x.beat = zahl(n, "beat", wn);
          x.laenge = zahl(n, "laenge", wn);
          if (x.beat < 0.0) format(wn + "beat negativ");
          if (!(x.laenge > 0.0)) format(wn + "laenge nicht positiv");
          const int64_t ton = ganz(n, "ton", wn), vel = ganz(n, "vel", wn);
          if (ton < 0 || ton > 127) format(wn + "ton außerhalb 0 bis 127");
          if (vel < 1 || vel > 127) format(wn + "vel außerhalb 1 bis 127");
          x.ton = static_cast<uint8_t>(ton);
          x.vel = static_cast<uint8_t>(vel);
          snap->noten.push_back(x);
        }
        std::sort(snap->noten.begin() + static_cast<long>(n0), snap->noten.end(),
                  [](const ArrNote& a, const ArrNote& b) { return a.beat < b.beat || (a.beat == b.beat && a.ton < b.ton); });
        sp.n_noten = static_cast<int>(snap->noten.size() - n0);
        sp.noten = sp.n_noten ? snap->noten.data() + n0 : nullptr;
        // ID-Index: aufsteigend, je Spur eindeutig
        std::vector<std::pair<uint64_t, int32_t>> ix;
        for (int i = 0; i < sp.n_noten; ++i) ix.push_back({sp.noten[i].id, i});
        std::sort(ix.begin(), ix.end());
        for (size_t i = 1; i < ix.size(); ++i)
          if (ix[i].first == ix[i - 1].first) format(wo + "Noten-ID doppelt");
        const size_t i0 = snap->noten_id.size();
        for (const auto& [id, i] : ix) {
          snap->noten_id.push_back(id);
          snap->noten_id_index.push_back(i);
        }
        sp.noten_id = sp.n_noten ? snap->noten_id.data() + i0 : nullptr;
        sp.noten_id_index = sp.n_noten ? snap->noten_id_index.data() + i0 : nullptr;
      }
      for (const char* fx_name : {"bend", "pegel"}) {   // tracker task 16: pitch and level events of a bk track, [[beat, value, glide in beats], ...] sorted by beat, only in /2 and /3
        if (!s.contains(fx_name)) continue;
        const std::string wf = wo + fx_name;
        if (!v2) format(wf + " exists only in cypherdj-arr/2");
        if (!(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "bk") == 0)) format(wf + " exists only on a bk track");
        const json& fl = s.at(fx_name);
        if (!fl.is_array()) format(wf + " is not a list");
        const bool ist_pegel = fx_name[0] == 'p';
        const size_t f0 = snap->fx_punkte.size();
        for (size_t fi = 0; fi < fl.size(); ++fi) {
          const json& q = fl[fi];
          const std::string wq = wf + "[" + std::to_string(fi) + "]";
          if (!q.is_array() || q.size() != 3) format(wq + " is not [beat, value, glide]");
          if (!q[0].is_number() || !q[1].is_number() || !q[2].is_number()) format(wq + " has a non-number");
          ArrFxPunkt x{};
          x.beat = q[0].get<double>();
          const double w = q[1].get<double>(), g = q[2].get<double>();
          if (!std::isfinite(x.beat) || x.beat < 0.0) format(wq + " beat negative or not finite");
          if (!std::isfinite(w)) format(wq + " value not finite");
          if (ist_pegel && w < 0.0) format(wq + " pegel below 0");
          if (!std::isfinite(g) || g < 0.0) format(wq + " glide negative or not finite");
          x.wert = static_cast<float>(w);
          x.gleit = static_cast<float>(g);
          if (fi > 0 && x.beat < snap->fx_punkte.back().beat) format(wq + " beats fall");
          snap->fx_punkte.push_back(x);
        }
        const int fn = static_cast<int>(fl.size());
        const ArrFxPunkt* fp = fn ? snap->fx_punkte.data() + f0 : nullptr;
        if (ist_pegel) {
          sp.n_pegel = fn;
          sp.pegel = fp;
        } else {
          sp.n_bend = fn;
          sp.bend = fp;
        }
      }
      if (s.contains("auto")) {   // Automation Slice 1: lanes of this track, only in /2; one lane per (target, parameter), see AUTO_ZIELE
        if (!v2) format(wo + "auto exists only in cypherdj-arr/2");
        const json& al = s.at("auto");
        if (!al.is_array()) format(wo + "auto is not a list");
        const size_t l0 = snap->auto_lane_liste.size();
        for (size_t li = 0; li < al.size(); ++li) {
          const json& l = al[li];
          const std::string wl = wo + "auto[" + std::to_string(li) + "].";
          const std::string zname = text(l, "ziel", wl);
          const AutoZiel* az = nullptr;
          for (const AutoZiel& z : AUTO_ZIELE)
            if (zname == z.name) az = &z;
          if (!az) format(wl + "ziel " + zname + " unknown");
          if (az->geraet == 1 && !(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "rb338") == 0))   // the four parameters are the RB-338's
            format(wl + "ziel " + zname + " only on an RB-338 track");
          if (az->geraet == 2 && !(sp.art == ArrArt::intern && std::strcmp(sp.geraet, "bk") == 0))   // 1.12 slice 7: the knobs are the Baukasten device's
            format(wl + "ziel " + zname + " only on a Baukasten (bk) track");
          bool relativ = false;   // 1.12 slice 5: a summand lane of the value stack; absent or false: an absolute lane (only in /2, like `auto` itself)
          if (l.contains("relativ")) {
            if (!l.at("relativ").is_boolean()) format(wl + "relativ is not a boolean");
            relativ = l.at("relativ").get<bool>();
          }
          if (relativ && az->nur_sprung) format(wl + "ziel " + zname + " takes no relative lane");
          if (az->ziel == ARR_AUTO_SEND) {   // a send lane automates an existing return of the playback, absolute only
            if (relativ) format(wl + "ziel " + zname + " takes no relative lane");
            if (!snap->ret_da[az->param]) format(wl + "ziel " + zname + ": the playback has no return " + std::to_string(az->param + 1));
          }
          for (size_t k = l0; k < snap->auto_lane_liste.size(); ++k)
#ifdef CYPHERDJ_MUTATION_ARR_REL_OHNE_EINDEUTIG   // error case: the uniqueness check ignores the flag, an absolute and a relative lane of one target count as "twice"
            if (snap->auto_lane_liste[k].ziel == az->ziel && snap->auto_lane_liste[k].param == az->param)
#else
            if (snap->auto_lane_liste[k].ziel == az->ziel && snap->auto_lane_liste[k].param == az->param && snap->auto_lane_liste[k].relativ == relativ)
#endif
              format(wl + "ziel " + zname + (relativ ? " relative twice on one track" : " twice on one track"));
          ArrAutoLane lane{};
          lese_auto_punkte(l, wl, *az, zname, relativ, *snap, lane);
          snap->auto_lane_liste.push_back(lane);
        }
        sp.n_auto = static_cast<int>(snap->auto_lane_liste.size() - l0);
        sp.auto_lanes = sp.n_auto ? snap->auto_lane_liste.data() + l0 : nullptr;
        snap->n_auto_lanes += sp.n_auto;
      }
      if (s.contains("chain_auto") && !v2) format(wo + "chain_auto exists only in cypherdj-arr/2");
      lese_kette_auto(s, wo, nr - 1, *snap);   // 1.12 slice 6: the insert-parameter and rack-macro lanes of this track
    }
    // 1.12 slice 6: the same for groups, the returns and the PM (their chains and racks are parsed above; the points go into the vector reserved above)
    if (j.contains("gruppen"))
      for (const json& g : j.at("gruppen")) lese_kette_auto(g, "gruppen[nr " + std::to_string(g.at("nr").get<int64_t>()) + "].", ARR_SPUREN + static_cast<int>(g.at("nr").get<int64_t>()) - 1, *snap);
    if (j.contains("pm")) lese_kette_auto(j.at("pm"), "pm.", ARR_KETTE_PM, *snap);
    if (j.contains("returns"))
      for (const json& r : j.at("returns")) lese_ret_auto(r, "returns[nr " + std::to_string(r.at("nr").get<int64_t>()) + "].", static_cast<int>(r.at("nr").get<int64_t>()) - 1, *snap);
    if (j.contains("returns"))
      for (const json& r : j.at("returns")) lese_kette_auto(r, "returns[nr " + std::to_string(r.at("nr").get<int64_t>()) + "].", ARR_KETTE_RET0 + static_cast<int>(r.at("nr").get<int64_t>()) - 1, *snap);
    if (j.contains("mod")) {   // strand 6: the modulators (the tracks and returns are known now)
      if (!v3) format("mod exists only in cypherdj-arr/3");
      lese_mod(j, *snap);
    }
    // nested groups: the level and the order of every group, a cycle is refused (the server refuses it at the command too). Before the key check: the key rules read the levels.
    if (std::string m; !arr_gruppen_rechnen(*snap, &m)) format(m);
    snap->send_maske = v4 && live;
    if (v4 && live) {   // K5: the live invariants (spec 7). Every track and every return belongs to a container: a track reaches a top group with a DJ output (never the PM), a return leads into a DJ output.
      // (send_ausser_modul is not checked here: the sends are rows, not data, D-K3; mischen() masks them structurally.)
      for (int t = 0; t < ARR_SPUREN; ++t) {
        const ArrSpur& sp = snap->spur[t];
        if (sp.nr == 0) continue;   // a gap: the slot is not in the file
        int g = sp.ausgang;
        if (g == 0) throw Abbruch("live_ohne_container", "spuren[nr " + std::to_string(sp.nr) + "]: a track of a live project must lead into a group with a DJ output, not into the production master");
        while (snap->gruppe_ausgang[g - 1] > 0) g = snap->gruppe_ausgang[g - 1];   // arr_gruppen_rechnen has refused cycles
        if (snap->gruppe_dj[g - 1] == 0)
          throw Abbruch("live_ohne_container", "spuren[nr " + std::to_string(sp.nr) + "]: its top group " + std::to_string(g) + " has no DJ output");
      }
      for (int r = 0; r < ARR_RETURNS; ++r)
        if (snap->ret_da[r] && snap->ret_dj[r] == 0)
          throw Abbruch("live_ohne_container", "returns[nr " + std::to_string(r + 1) + "]: a return of a live project must lead into a DJ output");
    }
    // 1.10 slice 5 U2a: every structural key against the table of docs/interfaces/schluessel_regeln.json (a source computed after the consumer, a strip keyed by itself, the PM)
    if (std::string m; !arr_schluessel_pruefe(*snap, &m)) format(m);
    // 1.10 slice 5 U1: the order the tracks run in when a stage listens to the post of another track; a track keyed by itself or a cycle is refused
    if (std::string m; !arr_schluessel_rechnen(*snap, &m)) format(m);
    // 1.10 slice 4b T13: the delays that align every path at the sums (spec 2.4); the routing and all chains are known now
    if (!arr_pdc_rechnen(*snap)) throw Abbruch("zu_gross", "pdc_zu_lang: the latency of the insert chains needs a delay longer than " + std::to_string(ARR_PDC_RING - 1) + " samples");
    // 1.10 slice 5 U2b (plan E9): the delay of every key against the input of its stage, from the arrival times of the table just computed; a key that needs a longer delay than the ring holds is refused
    if (std::string m; !arr_schluessel_versatz(*snap, &m)) format(m);
  } catch (const Abbruch& a) {
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = a.grund;
    erg.meldung = pfad + ": " + a.what();
    return erg;
  } catch (const std::exception& e) {
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = "format";
    erg.meldung = pfad + ": " + e.what();
    return erg;
  }
  if (std::string g, m; !cache.sperre(*snap, g, m)) {   // K1-Fix 8: Kopf und Felder gesperrt und gebucht
    for (int32_t sl : snap->bk_refs) cache.bk_gib(sl);   // S20: graph references taken so far
#ifndef CYPHERDJ_MUTATION_ARR_KIT_FEHLER_OHNE_GIB
    for (int32_t sl : snap->kit_refs) cache.kit_gib(sl);   // 1.9: kit references taken so far
#endif
    for (ArrAudio* x : geholt) cache.gib(x);
    erg.grund = g;
    erg.meldung = pfad + ": " + m;
    return erg;
  }
  snap->audios = geholt;
  erg.snap = std::move(snap);
  return erg;
}

}  // namespace cdj
