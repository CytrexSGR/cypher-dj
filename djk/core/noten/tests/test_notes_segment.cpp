// Segmenter port `segmentiere` against the golden vectors (tests/daten/gold): the curve and the audio of every item go in, the gold notes
// must come out: same count, each time within one frame (256 samples), each pitch within 2 cents, each level within 0.01.
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"
#include "synth.h"

using namespace cdj::noten;

int main() {
  const std::string gold = std::string(NOTEN_DATEN) + "/gold/";
  auto text = liesText(gold + "gold.json");
  if (std::holds_alternative<Fehler>(text)) { std::fprintf(stderr, "gold.json: %s\n", std::get<Fehler>(text).text.c_str()); return 1; }
  const auto index = nlohmann::json::parse(std::get<std::string>(text));
  const double eps = 1e-9;
  const double tolZeit = 256.0 / 48000.0 + eps;
  size_t geprueft = 0;
  for (const auto& item : index["items"]) {
    const std::string name = item["name"];
    auto k = liesSeitendatei(gold + name + ".kurve.json");
    if (std::holds_alternative<Fehler>(k)) {
      std::fprintf(stderr, "%s: %s: %s\n", name.c_str(), std::get<Fehler>(k).code.c_str(), std::get<Fehler>(k).text.c_str());
      PRUEF(false);
      continue;
    }
    const Seitendatei& s = std::get<Seitendatei>(k);
    const std::vector<float> audio = liesS16(gold + name + ".s16");
    PRUEF(static_cast<int64_t>(audio.size()) == s.k.frames);
    PRUEF(static_cast<int64_t>(audio.size()) == item["frames"].get<int64_t>());
    const std::vector<NoteQ> n = segmentiere(s.k, audio, 48000);
    std::printf("%-28s gold %2zu notes, port %2zu notes", name.c_str(), s.noten.size(), n.size());
    if (n.size() != s.noten.size()) {
      std::printf("  MISMATCH\n");
      PRUEF(n.size() == s.noten.size());
      continue;
    }
    double mqa = 0, mqe = 0, mt = 0, mp = 0;
    for (size_t i = 0; i < n.size(); ++i) {
      mqa = std::max(mqa, std::fabs(n[i].qa - s.noten[i].qa));
      mqe = std::max(mqe, std::fabs(n[i].qe - s.noten[i].qe));
      mt = std::max(mt, std::fabs(n[i].qton - s.noten[i].qton) * 100.0);
      mp = std::max(mp, std::fabs(n[i].p - s.noten[i].p));
    }
    std::printf("  max deviation: onset %.6f s, end %.6f s, pitch %.4f ct, level %.5f\n", mqa, mqe, mt, mp);
    PRUEF(mqa <= tolZeit);
    PRUEF(mqe <= tolZeit);
    PRUEF(mt <= 2.0);
    PRUEF(mp <= 0.01);
    ++geprueft;
  }
  PRUEF(geprueft == index["items"].size());

  // silence and noise: no notes (their gold curves are unvoiced)
  for (const char* name : {"stille", "rauschen"}) {
    auto k = liesSeitendatei(gold + name + ".kurve.json");
    if (std::holds_alternative<Fehler>(k)) { PRUEF(false); continue; }
    PRUEF(segmentiere(std::get<Seitendatei>(k).k, liesS16(gold + name + ".s16"), 48000).empty());
  }

  // `kurz`: the library port gives the gold notes (the commands apply the short-source rule, kurz.erwartet.json)
  {
    auto k = liesSeitendatei(gold + "kurz.kurve.json");
    PRUEF(!std::holds_alternative<Fehler>(k));
    if (!std::holds_alternative<Fehler>(k)) {
      const Seitendatei& s = std::get<Seitendatei>(k);
      PRUEF(s.noten.size() == 1);
      PRUEF(segmentiere(s.k, liesS16(gold + "kurz.s16"), 48000).size() == 1);
    }
  }

  // an empty curve, a curve without a voiced frame
  {
    Kurve leer;
    PRUEF(segmentiere(leer, {}, 48000).empty());
    Kurve stumm;
    stumm.frames = 4800;
    stumm.f0_ct.assign(static_cast<size_t>(frameZahl(4800)), 0.0);
    stumm.konf.assign(stumm.f0_ct.size(), 0.0);
    PRUEF(segmentiere(stumm, synth::stille(0.1), 48000).empty());
  }
  // more than MAX_NOTEN notes: the later ones are dropped and one line on stderr says how many
  {
    std::vector<NoteQ> viele(static_cast<size_t>(MAX_NOTEN) + 4);
    const std::string datei = "noten_segment_stderr_" + std::to_string(getpid()) + ".txt";
    std::fflush(stderr);
    const int alt = dup(2);
    std::FILE* f = std::fopen(datei.c_str(), "w");
    dup2(fileno(f), 2);
    kappeNoten(viele);
    std::fflush(stderr);
    dup2(alt, 2);
    close(alt);
    std::fclose(f);
    PRUEF(viele.size() == static_cast<size_t>(MAX_NOTEN));
    auto z = liesText(datei);
    std::remove(datei.c_str());
    PRUEF(std::holds_alternative<std::string>(z));
    if (std::holds_alternative<std::string>(z)) {
      const std::string& zeile = std::get<std::string>(z);
      PRUEF(zeile.find("4 of 4100 notes dropped") != std::string::npos);
      PRUEF(std::count(zeile.begin(), zeile.end(), '\n') == 1);
    }
    std::vector<NoteQ> wenige(10);
    kappeNoten(wenige);
    PRUEF(wenige.size() == 10);
  }
  PRUEF(stimmhaftAnteil(Kurve{}) == 0.0);
  {
    Kurve k;
    k.f0_ct = {0, 6900, 6900, 0};
    PRUEF_NAH(stimmhaftAnteil(k), 0.5, 1e-12);
  }
  PRUEF_ENDE();
}
