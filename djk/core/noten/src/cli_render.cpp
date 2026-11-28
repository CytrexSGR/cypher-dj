// `render <quelle.f32> <kurve.json> <auftrag.json> <aus.f32> [--vorher <f32> --nur <id,id,...> [--vorher-liste <auftrag.json>]]`: the render
// (notes.md). --vorher-liste is the order `vorher` was rendered from (same format); it lets an incremental render clear a moved note.
#include <set>

#include <algorithm>
#include <cmath>

#include "detector.h"
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
  std::vector<AudioNote> vorherListe;
  const bool mitListe = a.hat("vorher-liste");
  if (mitListe) {
    auto v = liesAuftrag(a.wert("vorher-liste"), s.k.kurve);
    if (auto* f = std::get_if<Fehler>(&v)) return endeFehler(*f);
    vorherListe = std::move(std::get<std::vector<AudioNote>>(v));
  }
  fortschritt.stufe(1, "laden", 100);

  Stereo aus;
  auto r = rendere(stereo, s.k, liste, teil ? &vorher : nullptr, teil ? &nur : nullptr, aus, &fortschritt, mitListe ? &vorherListe : nullptr);
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
  // measured pitch of the output over the middle of every edited note (median of the voiced detector frames) against its target
  nlohmann::ordered_json m = nlohmann::ordered_json::array();
  for (const auto& mi : std::get<RenderErgebnis>(r).mitten) {
    std::vector<float> mono(static_cast<size_t>(mi.s1 - mi.s0));
    for (size_t i = 0; i < mono.size(); ++i) mono[i] = 0.5f * (aus.l[static_cast<size_t>(mi.s0) + i] + aus.r[static_cast<size_t>(mi.s0) + i]);
    const Kurve mk = erkenne(mono, SR, nullptr);
    std::vector<double> v;
    const size_t rand = mk.f0_ct.size() > 8 ? 2 : 0;   // the frames at the edges of the cut reach outside it
    for (size_t j = rand; j + rand < mk.f0_ct.size(); ++j) if (mk.f0_ct[j] > 0.0) v.push_back(mk.f0_ct[j]);
    if (v.empty()) continue;
    std::sort(v.begin(), v.end());
    const double med = v.size() % 2 ? v[v.size() / 2] : 0.5 * (v[v.size() / 2 - 1] + v[v.size() / 2]);
    nlohmann::ordered_json e;
    e["id"] = mi.id;
    e["ton_ist"] = std::round(med * 10.0) / 1000.0;
    e["fehler_ct"] = std::round((med - mi.ziel * 100.0) * 10.0) / 10.0;
    m.push_back(e);
  }
  z["messung"] = m;
  z["sekunden"] = cpuSekunden();
  return endeOk(z);
}

}  // namespace cdj::noten
