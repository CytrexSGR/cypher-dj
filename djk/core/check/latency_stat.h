// I08: Auswertung der Schleifenmessung (Samples Hinweg+Rückweg je Lauf). Einträge < 0 sind Fehlversuche (kein Impuls gefunden) und zählen nicht.
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

struct LatenzErgebnis {
  bool ok = false;
  const char* grund = "";   // keine_schleife (kein einziger Treffer), zu_wenige_laeufe
  int laeufe = 0;
  double mittel = 0.0, streuung = 0.0;
  int min = 0, max = 0;
};

inline LatenzErgebnis latenz_auswerten(const std::vector<int>& roh, int soll_laeufe) {
  LatenzErgebnis e;
  std::vector<int> d;
  for (int v : roh)
    if (v >= 0) d.push_back(v);
  e.laeufe = static_cast<int>(d.size());
  if (d.empty()) { e.grund = "keine_schleife"; return e; }
  if (e.laeufe < soll_laeufe) { e.grund = "zu_wenige_laeufe"; return e; }
  double s = 0.0;
  for (int v : d) s += v;
  e.mittel = s / d.size();
  double q = 0.0;
  for (int v : d) q += (v - e.mittel) * (v - e.mittel);
  e.streuung = std::sqrt(q / d.size());
  e.min = *std::min_element(d.begin(), d.end());
  e.max = *std::max_element(d.begin(), d.end());
  e.ok = true;
  return e;
}
