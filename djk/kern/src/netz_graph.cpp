// Baukasten S16 (INTERFACES section 4.10 /k/graph/frage, section 5.12 /e/graph): the net thread keeps a mirror of which
// graph sits on each graph-capable slot (osc.json graph_platz). The commands that change a graph (/k/kanal/graph, /erz/strom)
// are remembered as pending entries when the net thread queues them; the mirror changes only when the callback's quittung
// for that command arrives (status 1, 2, 3 or 5), so a refusal inside the callback (ki_gestoppt, ausserhalb_bereich) never
// shows. Every changed slot goes out as /e/graph; /k/graph/frage answers all slots. Net thread only, no realtime code.
//
// Mutation switches (each guards exactly one rule, see test_netz_graph_*_mutation in CMakeLists.txt):
//   CYPHERDJ_MUTATION_GRAPH_OHNE_QUITTUNG     a command applies at once instead of waiting for its quittung
//   CYPHERDJ_MUTATION_GRAPH_AUCH_AUF_6        a refusal (status 6) applies as well
//   CYPHERDJ_MUTATION_GRAPH_KIT_BLEIBT        a kit/midi announce does not clear the stream's graph
//   CYPHERDJ_MUTATION_GRAPH_FRAGE_NUR_BELEGT  /k/graph/frage skips empty slots
//   CYPHERDJ_MUTATION_GRAPH_OHNE_QUELLE       a quittung matches its pending entry by id alone
#include <cstring>
#include <string>
#include <vector>

#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

constexpr size_t GRAPH_WARTEND_MAX = 64;  // oldest entry is dropped beyond this
constexpr int GRAPH_STROEME = 16;

bool quelle_gueltig(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

}  // namespace

bool Netz::graph_paket(const v::Adresse* a, const osc::Nachricht& m) {
  if (a->pfad != v::k_graph_frage.pfad) return false;
  namespace f = v::feld::k_graph_frage;
  const int64_t id = m.werte[f::id].h;
  const char* quelle = m.werte[f::quelle].s;
  if (!quelle_gueltig(quelle)) {
    quittung(id, quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
    return true;
  }
  for (const auto& slot : v::werte::graph_platz) {
    const std::string name = graph_platz_name(std::string(slot));
#ifdef CYPHERDJ_MUTATION_GRAPH_FRAGE_NUR_BELEGT
    if (name.empty()) continue;  // fault case: empty slots are not reported
#endif
    sende_graph(std::string(slot).c_str(), name);
  }
  quittung(id, quelle, 1, stand_sample_, stand_beat_, "");
  quittung(id, quelle, 3, stand_sample_, stand_beat_, "");
  return true;
}

void Netz::graph_vormerken(int64_t id, const char* quelle, const char* kanal, const char* name, int strom) {
  GraphWartend w{id, quelle, kanal, name, strom};
#ifdef CYPHERDJ_MUTATION_GRAPH_OHNE_QUITTUNG
  graph_anwenden(w);  // fault case: applied before the callback has answered
#else
  graph_wartend_.push_back(std::move(w));
  while (graph_wartend_.size() > GRAPH_WARTEND_MAX) graph_wartend_.pop_front();
#endif
}

void Netz::graph_quittung(const Ereignis& e) {
  for (auto it = graph_wartend_.begin(); it != graph_wartend_.end(); ++it) {
#ifdef CYPHERDJ_MUTATION_GRAPH_OHNE_QUELLE
    if (it->id != e.id) continue;  // fault case: the id alone decides
#else
    if (it->id != e.id || it->quelle != e.quelle) continue;
#endif
    GraphWartend w = std::move(*it);
    graph_wartend_.erase(it);
    bool annehmen = e.status == 1 || e.status == 2 || e.status == 3 || e.status == 5;
#ifdef CYPHERDJ_MUTATION_GRAPH_AUCH_AUF_6
    annehmen = annehmen || e.status == 6;  // fault case: a refusal applies
#endif
#ifdef CYPHERDJ_MUTATION_GRAPH_KIT_BLEIBT
    if (w.name.empty() && w.strom > 0) annehmen = false;  // fault case: a kit/midi announce leaves the graph on the stream
#endif
    if (annehmen) graph_anwenden(w);
    return;
  }
}

void Netz::graph_anwenden(const GraphWartend& w) {
  std::vector<std::string> vorher;
  for (const auto& slot : v::werte::graph_platz) vorher.push_back(graph_platz_name(std::string(slot)));
  if (w.strom == 0) {  // insert slot (deck/1..4, fx/3, fx/4)
    if (w.name.empty()) graph_insert_.erase(w.kanal);
    else graph_insert_[w.kanal] = w.name;
  } else if (w.strom >= 1 && w.strom <= GRAPH_STROEME) {  // stream: channel and the graph it carries ("" = none)
    graph_strom_[w.strom - 1] = GraphStrom{w.kanal, w.name};
  }
  size_t i = 0;
  for (const auto& slot : v::werte::graph_platz) {
    const std::string nach = graph_platz_name(std::string(slot));
    if (nach != vorher[i]) sende_graph(std::string(slot).c_str(), nach);
    ++i;
  }
}

std::string Netz::graph_platz_name(const std::string& kanal) const {
  if (kanal.compare(0, 4, "erz/") == 0 || kanal.compare(0, 4, "pad/") == 0) {
    for (const auto& s : graph_strom_)  // lowest-numbered stream on this channel that carries a graph
      if (s.kanal == kanal && !s.name.empty()) return s.name;
    return "";
  }
  const auto it = graph_insert_.find(kanal);
  return it == graph_insert_.end() ? std::string() : it->second;
}

void Netz::sende_graph(const char* kanal, const std::string& name) {
  osc::Schreiber s(v::e_graph);
  s.s(kanal).s(name.c_str());
  an_alle(s);
}

}  // namespace cdj
