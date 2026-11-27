// `segment <quelle.f32> <roh.json> <aus.json> [--sha <hex>]`: notes from an external curve (notes.md). Sidecar with detektor "netz".
#include <cmath>

#include "intern.h"

namespace cdj::noten {

int cliSegment(const Argumente& a) {
  const std::string& quelle = a.pos[0];
  const std::string& rohPfad = a.pos[1];
  const std::string& aus = a.pos[2];
  const auto sha = quellSha(quelle, a);
  if (const auto* f = std::get_if<Fehler>(&sha)) return endeFehler(*f);

  Fortschritt fortschritt(3);
  fortschritt.stufe(1, "laden", 0);
  auto audio = liesF32(quelle);
  if (auto* f = std::get_if<Fehler>(&audio)) return endeFehler(*f);
  auto roh = liesRoh(rohPfad);
  if (auto* f = std::get_if<Fehler>(&roh)) return endeFehler(*f);
  const Stereo& stereo = std::get<Stereo>(audio);
  Kurve& kurve = std::get<Kurve>(roh);
  if (kurve.frames != stereo.frames())
    return endeFehler(Fehler{"kurve_passt_nicht", "the curve has " + std::to_string(kurve.frames) + " frames, the source has " + std::to_string(stereo.frames())});
  fortschritt.stufe(1, "laden", 100);

  fortschritt.stufe(2, "noten", 0);
  Seitendatei s;
  s.quelle = std::get<std::string>(sha);
  if (!kurzeQuelle(stereo.frames())) {   // the short-source rule belongs to the commands, not to segmentiere
    s.noten = segmentiere(kurve, mitte(stereo), SR);
    if (abbruchAngefordert()) return endeFehler(Fehler{"abbruch", "interrupted"});
    kappeNoten(s.noten);
  }
  for (auto& n : s.noten) {   // the decimals of the sidecar (the writer rounds the same way)
    n.qa = rundeS(n.qa);
    n.qe = rundeS(n.qe);
    n.qton = rundeTon(n.qton);
    n.p = rundeTon(n.p);
  }
  s.stimmhaft_anteil = stimmhaftAnteil(kurve);
  s.k = std::move(kurve);
  fortschritt.stufe(2, "noten", 100);

  fortschritt.stufe(3, "schreiben", 0);
  if (auto f = schreibeSeitendatei(aus, s)) return endeFehler(*f);
  fortschritt.stufe(3, "schreiben", 100);

  nlohmann::ordered_json z;
  z["status"] = "ok";
  z["datei"] = aus;
  z["noten"] = s.noten.size();
  z["stimmhaft"] = std::round(s.stimmhaft_anteil * 1e4) / 1e4;
  z["sekunden"] = cpuSekunden();
  return endeOk(z);
}

}  // namespace cdj::noten
