// Scheibe 25: Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples), als Vergleichsmessung zur Messung im
// Callback (tests/target/kosten25.sh). Drei Lagen, je 20 000 Zyklen nach 2 000 zum Einschwingen:
//   leer   alle Kanäle auf Vorgabe (Fader −200), kein Klick: nur Stellwerk, 18 Kanalzüge, Master und Cue
//   16     16 belegte Kanäle: Prüfklick in deck/1..4, erz/1..8, pad/1..2, bus/1..2, Fader 0 dB (Busse per Hand)
//   16+    wie 16, dazu je Zyklus eine laufende Rampe an 16 Fadern (Stellwerk rechnet je Sample)
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs. Kein Test: die Zahlen gehören in den Bericht, unter flock und mit
// Fremdlast (ROADMAP §8.5). Aufruf: kern_kosten25 [zyklen] [layoutdatei]
// Plan A (A10): plus four tool lagen "wz-aus", "wz-lim", "wz-typ", "wz-voll" from target/werkzeug_layouts.txt (the same file as
// cost25_sender.py and cost25.sh, parsed with the same strict grammar): like "16", plus the layout's rows as /k/teil (quelle andreas, as
// the hand's server path sends them). "angenommen X/Y" counts the rows the kern started (receipt status 2, 3 or 5, no 4/6/7/8); X != Y
// makes the program exit 1. A broken layout file exits 4. The konfig lines of a layout (kanal_limiter_*) only apply to the kern program;
// offline there is no config path in Kern25 and no limiter object on this base, so the lagen measure the rows on the mixer as it is.
#include <time.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <regex>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "../core25.h"

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

static const char* const QUELLEN[16] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/4",
                                        "erz/5",  "erz/6",  "erz/7",  "erz/8",  "pad/1", "pad/2", "bus/1", "bus/2"};

static void messe(const char* name, int lage, int n) {
  Kern25 k;
  char pfad[48];
  if (lage >= 1) {
    for (int i = 0; i < 16; ++i) {
      k.klick(100 + i, QUELLEN[i], 1);
      std::snprintf(pfad, sizeof pfad, "%s/fader", QUELLEN[i]);
      if (i < 14) {
        k.teil(200 + i, "leitstand", "k", i, pfad, 1.0, 0.0, 0.0f, 0, 1, "", "");
      } else {  // bus/<n>/fader nur Hand (§1.5): erster Wert Stellung, zweiter wirkt
        k.hand(pfad, 0.99f, 10'000);
        k.hand(pfad, 1.0f, 20'000);
      }
    }
  }
  k.bis(2'000 * 256);
  if (lage == 2) {
    for (int i = 0; i < 16; ++i) {
      std::snprintf(pfad, sizeof pfad, "%s/eq/tief", QUELLEN[i]);
      k.teil(300 + i, "leitstand", "r", i, pfad, 30.0, 1'000.0, -20.0f, 1, 1, "", "");
    }
  }
  std::vector<double> d;
  d.reserve((size_t)n);
  cdj::Ereignis e;
  for (int z = 0; z < n; ++z) {
    const int64_t t0 = jetzt_ns();
    k.kern->zyklus(256, 0);
    d.push_back((jetzt_ns() - t0) / 1000.0);
    while (k.ere->hole(e)) {}
  }
  std::sort(d.begin(), d.end());
  auto q = [&](double p) { return d[std::min(d.size() - 1, (size_t)(p * (double)d.size()))]; };
  std::printf("%-6s Zyklen %d: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", name, n, q(0.5),
              q(0.99), q(0.999), d.back());
}

// Strict layout grammar, shared with cost25.sh and cost25_sender.py (header of werkzeug_layouts.txt): '#' comment, blank lines,
// 'layout NAME', 'konfig KEY VALUE', 'zeile PATH NUMBER'. Anything else (unknown keyword, wrong token count, malformed or non-numeric value,
// a line before the first layout, duplicate layout/key/path, a shipped layout with the wrong row count) returns false with a message.
using Zeilen = std::vector<std::pair<std::string, float>>;

static bool lies_layouts(const std::string& datei, std::vector<std::pair<std::string, Zeilen>>& alle, std::string& fehler) {
  static const std::regex RE_NAME("[A-Za-z0-9_-]+"), RE_KEY("[a-z][a-z0-9_]*"), RE_WERT("[A-Za-z0-9._+-]+"),
      RE_PFAD("[a-z0-9_]+(/[a-z0-9_]+)*"), RE_ZAHL("-?[0-9]+(\\.[0-9]+)?");
  std::ifstream f(datei);
  if (!f) {
    fehler = "cannot read " + datei;
    return false;
  }
  std::vector<std::vector<std::string>> keys;  // konfig keys per layout (duplicate check)
  std::string z;
  int nr = 0;
  while (std::getline(f, z)) {
    ++nr;
    const std::string roh = z;
    z = z.substr(0, z.find('#'));
    std::vector<std::string> t;  // tokens split on space and tab only (like awk and Python); \r, \v, \f stay in the token and fail its pattern
    for (size_t b = 0; b < z.size();) {
      if (z[b] == ' ' || z[b] == '\t') {
        ++b;
        continue;
      }
      size_t e = b;
      while (e < z.size() && z[e] != ' ' && z[e] != '\t') ++e;
      t.push_back(z.substr(b, e - b));
      b = e;
    }
    if (t.empty()) continue;
    auto fehl = [&](const char* text) {
      fehler = datei + ":" + std::to_string(nr) + ": " + text + ": " + roh;
      return false;
    };
    if (t[0] == "layout") {
      if (t.size() != 2 || !std::regex_match(t[1], RE_NAME)) return fehl("layout needs exactly one name");
      for (const auto& a : alle)
        if (a.first == t[1]) return fehl("duplicate layout");
      alle.emplace_back(t[1], Zeilen{});
      keys.emplace_back();
    } else if (t[0] == "konfig" || t[0] == "zeile") {
      if (alle.empty()) return fehl("konfig/zeile before the first layout");
      if (t.size() != 3) return fehl("konfig/zeile needs exactly two values");
      if (t[0] == "konfig") {
        if (!std::regex_match(t[1], RE_KEY) || !std::regex_match(t[2], RE_WERT)) return fehl("malformed konfig key or value");
        for (const auto& k : keys.back())
          if (k == t[1]) return fehl("duplicate konfig key");
        keys.back().push_back(t[1]);
      } else {
        if (!std::regex_match(t[1], RE_PFAD) || !std::regex_match(t[2], RE_ZAHL)) return fehl("malformed path or non-numeric value");
        for (const auto& p : alle.back().second)
          if (p.first == t[1]) return fehl("duplicate path");
        alle.back().second.emplace_back(t[1], std::strtof(t[2].c_str(), nullptr));
      }
    } else {
      return fehl("unknown keyword");
    }
  }
  static const std::pair<const char*, size_t> SOLL[4] = {{"aus", 0}, {"limiter-gebaut", 4}, {"typisch", 19}, {"voll", 76}};  // pinned row counts
  for (const auto& a : alle)
    for (const auto& s : SOLL)
      if (a.first == s.first && a.second.size() != s.second) {
        fehler = "layout " + a.first + " has " + std::to_string(a.second.size()) + " rows, expected " + std::to_string(s.second);
        return false;
      }
  return true;
}

// Lage "16" plus the layout rows: quelle "andreas", form 1 (S curve), politik 0, dauer 0, as the hand's server path sends them.
// Returns the number of rows the kern did not start.
static int messe_werkzeug(const char* name, const Zeilen& zeilen, int n) {
  Kern25 k;
  char pfad[48];
  for (int i = 0; i < 16; ++i) {
    k.klick(100 + i, QUELLEN[i], 1);
    std::snprintf(pfad, sizeof pfad, "%s/fader", QUELLEN[i]);
    if (i < 14) {
      k.teil(200 + i, "leitstand", "k", i, pfad, 1.0, 0.0, 0.0f, 0, 1, "", "");
    } else {
      k.hand(pfad, 0.99f, 10'000);
      k.hand(pfad, 1.0f, 20'000);
    }
  }
  for (size_t i = 0; i < zeilen.size(); ++i)
    k.teil(1000 + (int64_t)i, "andreas", "wz", (int)i, zeilen[i].first.c_str(), 1.0, 0.0, zeilen[i].second, 1, 0, "", "");
  k.bis(2'000 * 256);
  int angenommen = 0;
  for (size_t i = 0; i < zeilen.size(); ++i) {
    const int64_t id = 1000 + (int64_t)i;
    const bool gesetzt = k.q(id, 2) || k.q(id, 3) || k.q(id, 5);
    const bool abgelehnt = k.q(id, 4) || k.q(id, 6) || k.q(id, 7) || k.q(id, 8);
    angenommen += (gesetzt && !abgelehnt) ? 1 : 0;
  }
  std::vector<double> d;
  d.reserve((size_t)n);
  cdj::Ereignis e;
  for (int z = 0; z < n; ++z) {
    const int64_t t0 = jetzt_ns();
    k.kern->zyklus(256, 0);
    d.push_back((jetzt_ns() - t0) / 1000.0);
    while (k.ere->hole(e)) {}
  }
  std::sort(d.begin(), d.end());
  auto q = [&](double p) { return d[std::min(d.size() - 1, (size_t)(p * (double)d.size()))]; };
  std::printf("%-6s Zyklen %d: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs, angenommen %d/%zu\n", name, n, q(0.5),
              q(0.99), q(0.999), d.back(), angenommen, zeilen.size());
  return (int)zeilen.size() - angenommen;
}

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  messe("leer", 0, n);
  messe("16", 1, n);
  messe("16+", 2, n);
  const std::string datei = argc > 2 ? argv[2] : (std::string(__FILE__).substr(0, std::string(__FILE__).rfind("/cost/")) + "/target/werkzeug_layouts.txt");
  static const char* const WZ[4][2] = {{"wz-aus", "aus"}, {"wz-lim", "limiter-gebaut"}, {"wz-typ", "typisch"}, {"wz-voll", "voll"}};
  std::vector<std::pair<std::string, Zeilen>> alle;
  std::string fehler;
  if (!lies_layouts(datei, alle, fehler)) {
    std::fprintf(stderr, "werkzeug_layouts: %s\n", fehler.c_str());
    return 4;
  }
  int nicht_gesetzt = 0;
  for (const auto& l : WZ) {
    const Zeilen* zeilen = nullptr;
    for (const auto& a : alle)
      if (a.first == l[1]) zeilen = &a.second;
    if (!zeilen) {
      std::fprintf(stderr, "layout %s not in %s\n", l[1], datei.c_str());
      return 4;
    }
    nicht_gesetzt += messe_werkzeug(l[0], *zeilen, n);
  }
  if (nicht_gesetzt) std::fprintf(stderr, "POSITIVPROBE GERISSEN: %d layout rows were not started by the kern\n", nicht_gesetzt);
  return nicht_gesetzt ? 1 : 0;
}
