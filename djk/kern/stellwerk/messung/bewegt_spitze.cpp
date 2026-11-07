// stellwerk_bewegt_spitze: replays the control list of a project open (pfad TAB wert per line, written by pruef/abnahme_r8.mjs from the server's alleRegler) on the real
// Stellwerk the way kern_weg.ts sends it (packets of at most <paket> controls, each packet waits for the end status of all its parts before the next one goes), and reports
// the peak of moving controllers per cycle (aenderungen(), the ones with a course), MAX_BEWEGT, bewegt_voll, teile_voll and whether every control stands on its target.
// The core reports none of this over an interface, so this is how the open of the maximal project is checked against the ceiling MAX_BEWEGT (U0 of the 1.10 slices 5 to 8).
// Usage: stellwerk_bewegt_spitze <list.tsv> [paket (default 100)]    exit 0 = no ceiling hit and all on target, 1 = a ceiling was hit or a control is off, 2 = call error
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: stellwerk_bewegt_spitze <list.tsv> [paket]\n");
    return 2;
  }
  const size_t paket = argc > 2 ? static_cast<size_t>(std::atoi(argv[2])) : 100;
  std::vector<std::pair<std::string, float>> soll;
  {
    std::ifstream f(argv[1]);
    std::string z;
    while (std::getline(f, z)) {
      const size_t t = z.find('\t');
      if (t == std::string::npos) continue;
      soll.push_back({z.substr(0, t), std::strtof(z.c_str() + t + 1, nullptr)});
    }
  }
  if (soll.empty()) {
    std::fprintf(stderr, "stellwerk_bewegt_spitze: empty list\n");
    return 2;
  }
  SimUhr uhr(128.0);
  Stellwerk sw(uhr);
  const ReglerTabelle& tab = sw.tabelle();
  int unbekannt = 0;
  for (const auto& s : soll) unbekannt += tab.suche(s.first.c_str()) < 0;
  sw.prozess(0, 256);
  int64_t id = 100;
  int zyklen_ges = 0, spitze = 0, abgelehnt = 0;
  size_t paket_n = 0, groesstes = 0;
  for (size_t von = 0; von < soll.size(); von += paket) {
    const size_t bis = std::min(soll.size(), von + paket);
    groesstes = std::max(groesstes, bis - von);
    ++paket_n;
    const double ab = uhr.beat(sw.jetzt());
    std::set<int64_t> offen;
    for (size_t i = von; i < bis; ++i) {
      offen.insert(id);
      sw.teil(TeilBefehl{id++, Quelle::andreas, "", 0, soll[i].first.c_str(), ab, 0.0, soll[i].second, 0, 1, "", ""});
    }
    int zyklen = 0;
    while (!offen.empty() && zyklen < 40) {
      sw.prozess(sw.jetzt(), 256);
      ++zyklen;
      ++zyklen_ges;
      const Aenderung* a;
      spitze = std::max(spitze, sw.aenderungen(&a));
      const Ereignis* e;
      const int ne = sw.ereignisse(&e);
      for (int i = 0; i < ne; ++i) {
        if (e[i].art != EreignisArt::quittung) continue;
        const int s = static_cast<int>(e[i].status);
        if (s == 4 || s == 6 || s == 7 || s == 8) ++abgelehnt;
        if (s == 3 || s == 4 || s == 5 || s == 6 || s == 7 || s == 8) offen.erase(e[i].id);
      }
      sw.ereignisse_leeren();
    }
  }
  int falsch = 0;
  for (const auto& s : soll) {
    const int r = tab.suche(s.first.c_str());
    if (r < 0 || std::fabs(sw.wert(r) - s.second) > 1e-3) ++falsch;
  }
  std::printf("controls %zu, unknown paths %d, packets %zu (largest %zu), cycles %d, peak of moving controllers per cycle %d of MAX_BEWEGT %d, bewegt_voll %lld, teile_voll %lld, "
              "rejected %d, controls off target %d\n",
              soll.size(), unbekannt, paket_n, groesstes, zyklen_ges, spitze, MAX_BEWEGT, static_cast<long long>(sw.zaehler().bewegt_voll),
              static_cast<long long>(sw.zaehler().teile_voll), abgelehnt, falsch);
  return (sw.zaehler().bewegt_voll == 0 && sw.zaehler().teile_voll == 0 && abgelehnt == 0 && falsch == 0 && unbekannt == 0) ? 0 : 1;
}
