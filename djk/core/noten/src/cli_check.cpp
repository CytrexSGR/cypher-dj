// `pruefe <quelle.f32> <kurve.json>`: the monophonic check; rewrites the sidecar with `mono` and keeps every other field (notes.md).
#include "intern.h"
#include "teiltoene.h"

namespace cdj::noten {

int cliPruefe(const Argumente& a) {
  Fortschritt fortschritt(3);
  fortschritt.stufe(1, "laden", 0);
  auto audio = liesF32(a.pos[0]);
  if (auto* f = std::get_if<Fehler>(&audio)) return endeFehler(*f);
  auto datei = liesSeitendatei(a.pos[1]);
  if (auto* f = std::get_if<Fehler>(&datei)) return endeFehler(*f);
  const Stereo& stereo = std::get<Stereo>(audio);
  Seitendatei s = std::move(std::get<Seitendatei>(datei));
  if (s.k.frames != stereo.frames() || s.k.sr != SR || s.k.hop != HOP)
    return endeFehler(Fehler{"kurve_passt_nicht", "the curve has " + std::to_string(s.k.frames) + " frames (sr " + std::to_string(s.k.sr) + ", hop " +
                                                       std::to_string(s.k.hop) + "), the source has " + std::to_string(stereo.frames())});
  fortschritt.stufe(1, "laden", 100);

  fortschritt.stufe(2, "pruefen", 0);
  Mono m;
  m.hrr_db_schwelle = MONO_HRR_DB;
  m.periode_schwelle = MONO_PERIODE;
  if (!kurzeQuelle(stereo.frames())) {   // the short-source rule belongs to the command: a short source is not checked
    m = pruefeEinstimmig(stereo, s.k, &fortschritt);
    if (abbruchAngefordert()) return endeFehler(Fehler{"abbruch", "interrupted"});
  }
  s.mono = m;
  fortschritt.stufe(2, "pruefen", 100);

  fortschritt.stufe(3, "schreiben", 0);
  if (auto f = schreibeSeitendatei(a.pos[1], s)) return endeFehler(*f);
  fortschritt.stufe(3, "schreiben", 100);

  nlohmann::ordered_json z;
  z["status"] = "ok";
  z["mehrstimmig"] = m.mehrstimmig;
  z["anteil"] = m.anteil;
  z["sekunden"] = cpuSekunden();
  return endeOk(z);
}

}  // namespace cdj::noten
