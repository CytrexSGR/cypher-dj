// `analyse <quelle.f32> <aus.json> [--sha <hex>]`: own detector and segmenter, sidecar without `mono` (notes.md).
#include <cmath>

#include "detector.h"
#include "intern.h"

namespace cdj::noten {

int cliAnalyse(const Argumente& a) {
  const std::string& quelle = a.pos[0];
  const std::string& aus = a.pos[1];
  const auto sha = quellSha(quelle, a);
  if (const auto* f = std::get_if<Fehler>(&sha)) return endeFehler(*f);

  Fortschritt fortschritt(4);
  fortschritt.stufe(1, "laden", 0);
  auto audio = liesF32(quelle);
  if (auto* f = std::get_if<Fehler>(&audio)) return endeFehler(*f);
  const Stereo& stereo = std::get<Stereo>(audio);
  fortschritt.stufe(1, "laden", 100);

  Seitendatei s;
  s.quelle = std::get<std::string>(sha);
  const bool kurz = kurzeQuelle(stereo.frames());
  std::vector<float> mono;
  if (kurz) {
    // the short-source rule belongs to the commands: every frame unvoiced, no notes (erkenne itself would give the curve of the library)
    s.k.frames = stereo.frames();
    s.k.detektor = "pyin";
    s.k.kurve = std::string(DETEKTOR_VERSION) + "." + std::string(SEGMENTIERER_VERSION);
    s.k.f0_ct.assign(static_cast<size_t>(frameZahl(stereo.frames())), 0.0);
    s.k.konf.assign(static_cast<size_t>(frameZahl(stereo.frames())), 0.0);
  } else {
    mono = mitte(stereo);
    fortschritt.stufe(2, "tonhoehe", 0);
    s.k = erkenne(mono, SR, &fortschritt);
    if (abbruchAngefordert()) return endeFehler(Fehler{"abbruch", "interrupted"});
    // the sidecar holds the curve at its decimals; the notes are cut from that curve, as `segment` does from the file
    for (double& v : s.k.f0_ct) v = std::round(v * 100.0) / 100.0;
    for (double& v : s.k.konf) v = std::round(v * 1000.0) / 1000.0;
    fortschritt.stufe(2, "tonhoehe", 100);
  }

  fortschritt.stufe(3, "noten", 0);
  if (!kurz) {
    s.noten = segmentiere(s.k, mono, SR);
    if (abbruchAngefordert()) return endeFehler(Fehler{"abbruch", "interrupted"});
    kappeNoten(s.noten);
  }
  for (auto& n : s.noten) {   // the decimals of the sidecar (the writer rounds the same way)
    n.qa = rundeS(n.qa);
    n.qe = rundeS(n.qe);
    n.qton = rundeTon(n.qton);
    n.p = rundeTon(n.p);
  }
  s.stimmhaft_anteil = stimmhaftAnteil(s.k);
  fortschritt.stufe(3, "noten", 100);

  fortschritt.stufe(4, "schreiben", 0);
  if (auto f = schreibeSeitendatei(aus, s)) return endeFehler(*f);
  fortschritt.stufe(4, "schreiben", 100);

  nlohmann::ordered_json z;
  z["status"] = "ok";
  z["datei"] = aus;
  z["noten"] = s.noten.size();
  z["stimmhaft"] = std::round(s.stimmhaft_anteil * 1e4) / 1e4;
  z["sekunden"] = cpuSekunden();
  return endeOk(z);
}

}  // namespace cdj::noten
