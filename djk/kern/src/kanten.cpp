#include "cypherdj/kanten.h"

namespace cdj {

std::vector<Kante> fehlende_kanten(const std::vector<Kante>& soll, const KantenIst& ist) {
  std::vector<Kante> fehlt;
  for (const Kante& k : soll)
    if (ist.existiert(ist.ctx, k.quelle.c_str()) && ist.existiert(ist.ctx, k.ziel.c_str()) &&
        !ist.verbunden(ist.ctx, k.quelle.c_str(), k.ziel.c_str()))
      fehlt.push_back(k);
  return fehlt;
}

std::vector<Kante> lies_kanten(const std::string& text) {
  std::vector<Kante> aus;
  size_t von = 0;
  while (von <= text.size()) {
    size_t bis = text.find('\n', von);
    if (bis == std::string::npos) bis = text.size();
    std::string zeile = text.substr(von, bis - von);
    von = bis + 1;
    if (!zeile.empty() && zeile.back() == '\r') zeile.pop_back();
    const size_t tab = zeile.find('\t');
    if (tab == std::string::npos || tab == 0 || tab + 1 >= zeile.size()) continue;
    aus.push_back({zeile.substr(0, tab), zeile.substr(tab + 1)});
  }
  return aus;
}

static bool ziffern(const std::string& s) {
  if (s.empty()) return false;
  for (char c : s)
    if (c < '0' || c > '9') return false;
  return true;
}

std::vector<Kante> filtere_kanten(const std::vector<Kante>& kanten, const std::string& kern_praefix) {
  std::vector<Kante> ok;
  const std::string midi = kern_praefix + "midi_aus_", rueck = kern_praefix + "rueck_erz_";
  for (const Kante& k : kanten) {
    bool zu = false;
    // Riegel: die Gegenseite darf kein Port des Kerns sein, sonst verbände die Datei den Kern mit sich selbst
    // (master_L -> rueck_erz_2_L, midi_aus_1 -> hand_in). Der Kern verbindet nur nach außen.
    const bool quelle_kern = k.quelle.compare(0, kern_praefix.size(), kern_praefix) == 0;
    const bool ziel_kern = k.ziel.compare(0, kern_praefix.size(), kern_praefix) == 0;
    if (quelle_kern && ziel_kern) continue;
    if (k.quelle.compare(0, midi.size(), midi) == 0) zu = ziffern(k.quelle.substr(midi.size()));
    if (!zu && k.ziel.compare(0, rueck.size(), rueck) == 0) {
      const std::string rest = k.ziel.substr(rueck.size());  // N_L oder N_R
      zu = rest.size() >= 3 && (rest.back() == 'L' || rest.back() == 'R') && rest[rest.size() - 2] == '_' &&
           ziffern(rest.substr(0, rest.size() - 2));
    }
    if (zu) ok.push_back(k);
  }
  return ok;
}

std::vector<Kante> entdoppeln_begrenzen(const std::vector<Kante>& kanten, size_t max, size_t* verworfen) {
  std::vector<Kante> aus;
  for (const Kante& k : kanten) {
    bool schon = false;
    for (const Kante& a : aus) schon = schon || a == k;
    if (!schon && aus.size() < max) aus.push_back(k);
  }
  if (verworfen) *verworfen = kanten.size() - aus.size();
  return aus;
}

bool VerlustBuch::scheitern_melden(const Kante& k, int64_t jetzt_ns) {
  const auto it = fehl_.find(schluessel(k));
  if (it != fehl_.end() && jetzt_ns - it->second < 10'000'000'000LL) return false;
  fehl_[schluessel(k)] = jetzt_ns;
  return true;
}

void VerlustBuch::verbunden(const Kante& k) {
  offen_.erase(schluessel(k));
  fehl_.erase(schluessel(k));
}

void VerlustBuch::geheilte_abgleichen(const std::vector<Kante>& soll, const KantenIst& ist) {
  for (const Kante& k : soll)
    if (ist.verbunden(ist.ctx, k.quelle.c_str(), k.ziel.c_str())) verbunden(k);
}

std::vector<ZielEreignis> ZielUebergaenge::pruefe(const std::vector<Kante>& soll, const KantenIst& ist) {
  std::vector<ZielEreignis> ev;
  for (const Kante& k : soll) {
    const bool jetzt = ist.existiert(ist.ctx, k.ziel.c_str());
    const auto it = da_.find(k.ziel);
    const bool vorher = it == da_.end() ? true : it->second;
    if (vorher != jetzt) ev.push_back({k.ziel, jetzt});
    da_[k.ziel] = jetzt;
  }
  return ev;
}

int alle_aus_ereignisse(uint8_t out[][3], int max) {
  if (max < ALLE_AUS_N) return 0;
  for (int ch = 0; ch < 16; ++ch) {
    out[2 * ch][0] = (uint8_t)(0xB0 | ch);
    out[2 * ch][1] = 123;
    out[2 * ch][2] = 0;
    out[2 * ch + 1][0] = (uint8_t)(0xB0 | ch);
    out[2 * ch + 1][1] = 120;
    out[2 * ch + 1][2] = 0;
  }
  return ALLE_AUS_N;
}

}  // namespace cdj
