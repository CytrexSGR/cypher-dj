// `render <quelle.f32> <kurve.json> <auftrag.json> <aus.f32> [--vorher <f32> --nur <id,id,...>]`: the pitch render (notes.md).
#include <set>

#include "intern.h"
#include "render.h"

namespace cdj::noten {

int cliRender(const Argumente& a) {
  Fortschritt fortschritt(3);
  fortschritt.stufe(1, "laden", 0);
  auto audio = liesF32(a.pos[0]);
  if (auto* f = std::get_if<Fehler>(&audio)) return endeFehler(*f);
  auto datei = liesSeitendatei(a.pos[1]);
  if (auto* f = std::get_if<Fehler>(&datei)) return endeFehler(*f);
  const Stereo& stereo = std::get<Stereo>(audio);
  const Seitendatei& s = std::get<Seitendatei>(datei);
  auto auftrag = liesAuftrag(a.pos[2], s.k.kurve);
  if (auto* f = std::get_if<Fehler>(&auftrag)) return endeFehler(*f);
  const std::vector<AudioNote>& liste = std::get<std::vector<AudioNote>>(auftrag);

  Stereo vorher;
  std::set<std::string> nur;
  const bool teil = a.hat("vorher");
  if (teil) {
    auto v = liesF32(a.wert("vorher"));
    if (auto* f = std::get_if<Fehler>(&v)) return endeFehler(*f);
    vorher = std::move(std::get<Stereo>(v));
    const std::string ids = a.wert("nur");
    size_t p = 0;
    while (p <= ids.size()) {
      size_t q = ids.find(',', p);
      if (q == std::string::npos) q = ids.size();
      if (q > p) nur.insert(ids.substr(p, q - p));
      p = q + 1;
    }
    if (nur.empty()) return endeFehler(Fehler{"argument", "--nur names no note id"});
  }
  fortschritt.stufe(1, "laden", 100);

  Stereo aus;
  auto r = rendere(stereo, s.k, liste, teil ? &vorher : nullptr, teil ? &nur : nullptr, aus, &fortschritt);
  if (auto* f = std::get_if<Fehler>(&r)) return endeFehler(*f);
  if (abbruchAngefordert()) return endeFehler(Fehler{"abbruch", "interrupted"});
  fortschritt.stufe(2, "rendern", 100);

  fortschritt.stufe(3, "schreiben", 0);
  if (auto f = schreibeF32(a.pos[3], aus)) return endeFehler(*f);
  fortschritt.stufe(3, "schreiben", 100);

  nlohmann::ordered_json z;
  z["status"] = "ok";
  z["datei"] = a.pos[3];
  nlohmann::ordered_json b = nlohmann::ordered_json::array();
  for (const auto& r0 : std::get<RenderErgebnis>(r).bereiche) b.push_back(nlohmann::ordered_json::array({r0.first, r0.second}));
  z["bereiche"] = b;
  z["sekunden"] = cpuSekunden();
  return endeOk(z);
}

}  // namespace cdj::noten
