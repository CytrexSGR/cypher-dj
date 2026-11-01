// Baukasten S16: the kern reports which graph sits on each graph-capable slot (INTERFACES section 4.10 /k/graph/frage,
// section 5.12 /e/graph). The net thread mirrors the graph names; the mirror changes only when the callback's quittung for
// the command arrives (status 1, 2, 3 or 5), every change goes out as /e/graph, and /k/graph/frage answers every slot.
// The commands are fed through Netz::paket, the callback's quittungen are pushed into the event ring by hand.
#include <arpa/inet.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/kit.h"
#include "cypherdj/mixer.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

namespace {

struct Msg {
  std::string adr, s0, s1;
  int64_t id = 0;
  int status = 0;
};

// Everything that arrived at the counterpart, in order, until the socket has been silent for `ms`.
std::vector<Msg> lies(Gegenstelle& g, int ms = 30) {
  std::vector<Msg> aus;
  for (;;) {
    pollfd pf{g.sock, POLLIN, 0};
    if (poll(&pf, 1, ms) <= 0) break;
    char buf[2048];
    const ssize_t n = recv(g.sock, buf, sizeof buf, 0);
    if (n <= 0) break;
    cdj::osc::Nachricht m;
    if (!cdj::osc::lesen(buf, static_cast<size_t>(n), m)) continue;
    Msg x;
    x.adr = m.adresse;
    if (x.adr == "/e/graph") {
      x.s0 = m.werte[0].s;
      x.s1 = m.werte[1].s;
    } else if (x.adr == "/q") {
      x.id = m.werte[0].h;
      x.s0 = m.werte[1].s;
      x.status = m.werte[2].i;
      x.s1 = m.werte[5].s;
    }
    aus.push_back(x);
  }
  return aus;
}

std::vector<std::pair<std::string, std::string>> graphen_aus(const std::vector<Msg>& l) {
  std::vector<std::pair<std::string, std::string>> r;
  for (const auto& m : l)
    if (m.adr == "/e/graph") r.emplace_back(m.s0, m.s1);
  return r;
}
std::vector<std::pair<std::string, std::string>> graphen(Gegenstelle& g) { return graphen_aus(lies(g)); }

void strom(cdj::Netz& n, int64_t id, const char* ziel, const char* kanal, int strom_nr) {
  cdj::osc::Schreiber s(v::erz_strom);
  s.h(id).s("erzeuger").i(strom_nr).s(ziel).s(kanal);
  n.paket(s.daten(), s.groesse());
}

void kanal_graph(cdj::Netz& n, int64_t id, const char* quelle, const char* kanal, const char* name) {
  cdj::osc::Schreiber s(v::k_kanal_graph);
  s.h(id).s(quelle).s(kanal).s(name);
  n.paket(s.daten(), s.groesse());
}

void frage(cdj::Netz& n, int64_t id, const char* quelle) {
  cdj::osc::Schreiber s(v::k_graph_frage);
  s.h(id).s(quelle);
  n.paket(s.daten(), s.groesse());
}

// The callback's quittung reaches the net thread through the event ring.
void quitt(cdj::Ereignisring* ere, cdj::Netz& n, int64_t id, const char* quelle, int status, const char* grund = "") {
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::QUITTUNG;
  e.id = id;
  std::strncpy(e.quelle, quelle, sizeof e.quelle - 1);
  e.status = status;
  std::strncpy(e.grund, grund, sizeof e.grund - 1);
  ere->schiebe(e);
  n.ereignisse_senden();
}

// Take the command the net thread queued and release what it owns (the callback is not running in this test).
bool hole_und_frei(cdj::Befehlsring* bef, cdj::Befehl& b) {
  b = cdj::Befehl{};
  if (!bef->hole(b)) return false;
  if (b.zeiger) {
    if (b.art == cdj::Befehl::KANAL_GRAPH || (b.art == cdj::Befehl::ERZ_STROM && b.form < 0))
      cypher_bk_frei(static_cast<CypherBk*>(const_cast<void*>(b.zeiger)));
    else if (b.art == cdj::Befehl::ERZ_STROM)
      delete static_cast<const cdj::Kit*>(b.zeiger);
  }
  return true;
}

int64_t naechste_id = 900;
std::map<std::string, std::string> stand(cdj::Netz& n, Gegenstelle& g) {
  frage(n, naechste_id++, "andreas");
  std::map<std::string, std::string> r;
  for (const auto& p : graphen(g)) r[p.first] = p.second;
  return r;
}

using Liste = std::vector<std::pair<std::string, std::string>>;

}  // namespace

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_graph_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  {
    const float d[4] = {0.5f, 0.5f, 0.25f, 0.25f};
    std::ofstream(dir / "gut/bd_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
    std::ofstream(dir / "gut/kit.json") << R"({"schema":1,"name":"gut","klaenge":[{"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2}]})";
  }
  fs::create_directories(dir / "bk");
  std::ofstream(dir / "bk/saege.json") << R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"o.x"}]})";
  fs::copy_file(dir / "bk/saege.json", dir / "bk/saege2.json");
  // an effect graph (node eingang, latency 0): the S3c example
  fs::copy_file(fs::path(CYPHERDJ_DJK) / "instrumente/baukasten_dsp/beispiele/fx-echo-achtel.json", dir / "bk/eff.json",
                fs::copy_options::overwrite_existing);

  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_kit_ordner(dir.string());
    netz.setze_bk_ordner((dir / "bk").string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
      lies(g);
    }

    // 1. frage on a fresh kern: one /e/graph per slot in graph_platz order, all empty, then quittung 1 and 3
    {
      frage(netz, 7, "andreas");
      const auto l = lies(g);
      const Liste gr = graphen_aus(l);
      PRUEF(gr.size() == 14);
      for (size_t i = 0; i < gr.size() && i < v::werte::graph_platz.size(); ++i)
        PRUEF(gr[i].first == v::werte::graph_platz[i] && gr[i].second.empty());
      int q1 = 0, q3 = 0;
      bool graph_vor_q = true, q1_vor_q3 = false;
      size_t graphen_gesehen = 0;
      for (const auto& m : l) {
        if (m.adr == "/e/graph") ++graphen_gesehen;
        if (m.adr == "/q" && m.id == 7 && m.s0 == "andreas") {
          graph_vor_q = graph_vor_q && graphen_gesehen == 14;
          if (m.status == 1) ++q1;
          if (m.status == 3) { ++q3; q1_vor_q3 = q1 == 1; }
        }
      }
      PRUEF(q1 == 1 && q3 == 1 && q1_vor_q3 && graph_vor_q);
    }

    // 2. pending until the quittung: nothing before it, exactly one /e/graph at quittung 1, none at quittung 3
    strom(netz, 101, "bk:saege", "erz/3", 3);
    PRUEF(hole_und_frei(bef, b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 101);
    PRUEF(graphen(g).empty());
    PRUEF(netz.graph_wartend() == 1);
    quitt(ere, netz, 101, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", "saege"}}));
    quitt(ere, netz, 101, "erzeuger", 3);
    PRUEF(graphen(g).empty());
    PRUEF(netz.graph_wartend() == 0);

    // 3. THE drift case: the erzeuger re-announces stream 3 as a kit target; the graph is gone in the kern
    strom(netz, 102, "kit:gut", "erz/3", 3);
    PRUEF(hole_und_frei(bef, b) && b.id == 102);
    quitt(ere, netz, 102, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", ""}}));
    PRUEF(stand(netz, g)["erz/3"] == "");

    // 4. negative control, harmless re-announce: another stream's kit target leaves erz/3 alone
    strom(netz, 103, "bk:saege", "erz/3", 3);
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 103, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", "saege"}}));
    strom(netz, 104, "kit:gut", "erz/1", 1);
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 104, "erzeuger", 1);
    PRUEF(graphen(g).empty());
    PRUEF(stand(netz, g)["erz/3"] == "saege");

    // 5. stream moves: stream 3 goes to erz/5 as a midi target; erz/3 empties, erz/5 reports nothing
    strom(netz, 105, "midi:1:1", "erz/5", 3);
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 105, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", ""}}));

    // 6. two streams on one channel: the slot shows the graph of the lowest-numbered stream that carries one
    strom(netz, 106, "bk:saege", "erz/3", 2);
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 106, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", "saege"}}));
    strom(netz, 150, "bk:saege2", "erz/3", 4);   // a higher stream with another graph: stream 2 still wins
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 150, "erzeuger", 1);
    PRUEF(graphen(g).empty());
    strom(netz, 107, "kit:gut", "erz/3", 3);   // stream 3 joins erz/3 without a graph
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 107, "erzeuger", 1);
    PRUEF(graphen(g).empty());
    strom(netz, 108, "kit:gut", "erz/2", 2);   // stream 2 leaves: stream 4's graph shows
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 108, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", "saege2"}}));
    strom(netz, 151, "midi:1:1", "erz/5", 4);   // stream 4 leaves too
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 151, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/3", ""}}));

    // 7. effect graph on a deck and a send return: refused in the callback changes nothing, accepted does
    kanal_graph(netz, 110, "cypher", "deck/1", "eff");
    PRUEF(hole_und_frei(bef, b) && b.art == cdj::Befehl::KANAL_GRAPH && b.id == 110);
    quitt(ere, netz, 110, "cypher", 6, "ki_gestoppt");
    PRUEF(graphen(g).empty());
    PRUEF(stand(netz, g)["deck/1"] == "");
    kanal_graph(netz, 111, "andreas", "deck/1", "eff");
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 111, "andreas", 1);
    quitt(ere, netz, 111, "andreas", 2);
    quitt(ere, netz, 111, "andreas", 3);
    PRUEF((graphen(g) == Liste{{"deck/1", "eff"}}));
    kanal_graph(netz, 112, "andreas", "deck/1", "");
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 112, "andreas", 1);
    PRUEF((graphen(g) == Liste{{"deck/1", ""}}));
    kanal_graph(netz, 113, "andreas", "fx/3", "eff");
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 113, "andreas", 1);
    PRUEF((graphen(g) == Liste{{"fx/3", "eff"}}));
    kanal_graph(netz, 114, "andreas", "fx/3", "");
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 114, "andreas", 1);
    PRUEF((graphen(g) == Liste{{"fx/3", ""}}));

    // 8. id collision guard: the same id from another quelle must not apply the entry
    strom(netz, 120, "bk:saege", "erz/2", 2);
    PRUEF(hole_und_frei(bef, b));
    quitt(ere, netz, 120, "andreas", 1);
    PRUEF(graphen(g).empty());
    quitt(ere, netz, 120, "erzeuger", 1);
    PRUEF((graphen(g) == Liste{{"erz/2", "saege"}}));

    // 9. a refusal answered by the net thread enqueues nothing: a forged quittung for it changes nothing
    strom(netz, 130, "bk:fehlt", "erz/3", 3);
    {
      const auto l = lies(g);
      bool q6 = false;
      for (const auto& m : l) q6 = q6 || (m.adr == "/q" && m.id == 130 && m.status == 6 && m.s1 == "pruefung");
      PRUEF(q6);
    }
    PRUEF(!hole_und_frei(bef, b));
    PRUEF(netz.graph_wartend() == 0);
    quitt(ere, netz, 130, "erzeuger", 1);
    PRUEF(graphen(g).empty());

    // 10. bound: 70 pending loads on deck/2, the queue keeps the newest 64; the evicted first one no longer applies
    for (int i = 0; i < 70; ++i) {
      kanal_graph(netz, 200 + i, "andreas", "deck/2", "eff");
      PRUEF(hole_und_frei(bef, b));
    }
    lies(g);
    PRUEF(netz.graph_wartend() == 64);
    quitt(ere, netz, 200, "andreas", 1);   // evicted: nothing to apply
    PRUEF(graphen(g).empty());
    PRUEF(netz.graph_wartend() == 64);
    quitt(ere, netz, 269, "andreas", 1);   // newest: applies
    PRUEF((graphen(g) == Liste{{"deck/2", "eff"}}));
    PRUEF(netz.graph_wartend() == 63);

    // 11. bad quelle on frage: quittung 6 ausserhalb_bereich and no /e/graph
    frage(netz, 140, "x");
    {
      const auto l = lies(g);
      PRUEF(graphen_aus(l).empty());
      bool q6 = false;
      for (const auto& m : l) q6 = q6 || (m.adr == "/q" && m.id == 140 && m.status == 6 && m.s1 == "ausserhalb_bereich");
      PRUEF(q6);
    }

    // 12. the slot table equals the kern's rule: the mixer channels that take a graph, plus the send returns fx/3, fx/4
    {
      const auto in_platz = [](const std::string& k) {
        for (const auto& p : v::werte::graph_platz)
          if (p == k) return true;
        return false;
      };
      PRUEF(v::werte::graph_platz.size() == 14);
      for (int k = 0; k < 18; ++k) {
        const bool soll = (k >= 0 && k <= 3) ||
                          (k >= 4 && k <= 13 && k != cdj::Mixer::kanal_index(cdj::VORHOER_KANAL) &&
                           k != cdj::Mixer::kanal_index(cdj::ARR_KANAL));
        if (in_platz(cdj::Mixer::kanal_name(k)) != soll) {
          std::fprintf(stderr, "slot table: channel %s expected %d\n", cdj::Mixer::kanal_name(k), soll);
          PRUEF(false);
        }
      }
      for (const auto& k : v::werte::graph_kanal) PRUEF(in_platz(std::string(k)));
    }
  }
  delete bef;
  delete ere;
  fs::remove_all(dir);
  PRUEF_ENDE();
}
