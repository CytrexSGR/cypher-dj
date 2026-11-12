// S19: /k/mapping with geraet "lernen" in the network thread. The device name "lernen" is the reserved name of the learn
// table (slot 1): the net thread loads <controller folder>/lernen.json exactly like any other device file and hands it to
// the kern as Befehl MAPPING with nr 1; every other device name keeps nr 0. A broken lernen.json is refused with quittung 6
// pruefung and its line in the log, nothing reaches the ring.
// /k/lernen ,hsi in the network thread (case 16): Befehl LERNEN for the hand, 6 nur_hand for cypher, 6 ausserhalb_bereich for
// an outside 0/1; the kern event GELERNT leaves as /e/gelernt ,hiiiii.
// Failure case: test_netz_lernen_slot_mutation (always nr 0) and test_netz_lernen_gelernt_mutation (kanal and nr swapped) must fail.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "cypherdj/net.h"
#include "hand/mapping.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static void mapping_senden(cdj::Netz& n, int64_t id, const char* quelle, const char* geraet) {
  cdj::osc::Schreiber s(v::k_mapping);
  s.h(id).s(quelle).s(geraet);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const std::string djk = CYPHERDJ_DJK;
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_lernen_" + std::to_string(getpid()));
  fs::create_directories(dir);
  fs::copy_file(djk + "/config/controller/softcontroller.json", dir / "softcontroller.json");
  fs::copy_file(djk + "/core/tests/hand/mappings/lernen_bk.json", dir / "lernen.json");
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_controller_ordner(dir.string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    // 7a) geraet "lernen" -> slot 1
    mapping_senden(netz, 71, "andreas", "lernen");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::MAPPING && b.id == 71 && b.zeiger != nullptr);
    PRUEF(b.nr == 1);
    if (b.zeiger) {
      const auto* m = static_cast<const hand::Mapping*>(b.zeiger);
      PRUEF(std::string(m->geraet) == "lernen" && m->n_eintraege == 1);
      delete m;
    }
    // 7b) negative control: another device name stays on slot 0
    mapping_senden(netz, 72, "andreas", "softcontroller");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::MAPPING && b.id == 72 && b.zeiger != nullptr);
    PRUEF(b.nr == 0);
    if (b.zeiger) delete static_cast<const hand::Mapping*>(b.zeiger);
    // 7c) a broken lernen.json: quittung 6 pruefung, nothing in the ring, the line in the log
    fs::copy_file(djk + "/core/tests/hand/mappings/lernen_kaputt.json", dir / "lernen.json",
                  fs::copy_options::overwrite_existing);
    const std::string logdatei = (dir / "stderr.txt").string();
    fflush(stderr);
    const int alt_fd = dup(2);
    FILE* fr = freopen(logdatei.c_str(), "w", stderr);
    (void)fr;
    mapping_senden(netz, 73, "andreas", "lernen");
    fflush(stderr);
    dup2(alt_fd, 2);
    close(alt_fd);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 73 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    PRUEF(!bef->hole(b));
    std::ifstream in(logdatei);
    std::stringstream ss;
    ss << in.rdbuf();
    const std::string log = ss.str();
    std::printf("log: %s", log.c_str());
    PRUEF(log.find("lernen.json: Zeile 2: unbekanntes_ziel: \"erz/5/bk/65\"") != std::string::npos);
    // 16a) /k/lernen from the hand: Befehl LERNEN with id and an
    {
      cdj::osc::Schreiber s(v::k_lernen);
      s.h(501).s("andreas").i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::LERNEN && b.id == 501 && b.an == 1);
      cdj::osc::Schreiber s0(v::k_lernen);
      s0.h(502).s("andreas").i(0);
      netz.paket(s0.daten(), s0.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::LERNEN && b.id == 502 && b.an == 0);
    }
    // 16b) cypher may not learn: 6 nur_hand, nothing in the ring
    {
      cdj::osc::Schreiber s(v::k_lernen);
      s.h(503).s("cypher").i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 503 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "nur_hand"));
      PRUEF(!bef->hole(b));
    }
    // 16c) an outside 0/1: 6 ausserhalb_bereich
    {
      cdj::osc::Schreiber s(v::k_lernen);
      s.h(504).s("andreas").i(2);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 504 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      PRUEF(!bef->hole(b));
    }
    // 16d) the kern event GELERNT leaves as /e/gelernt ,hiiiii with exactly its values
    {
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::GELERNT;
      e.id = 7;
      e.deck = 1;       // quelle
      e.fassung = 3;    // kanal
      e.teil = 74;      // nr
      e.neu = 64;       // wert
      e.status = 0;     // belegt
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/gelernt", 300) && !std::strcmp(g.m.typen, "hiiiii"));
      PRUEF(g.m.werte[0].h == 7 && g.m.werte[1].i == 1 && g.m.werte[2].i == 3 && g.m.werte[3].i == 74 && g.m.werte[4].i == 64 &&
            g.m.werte[5].i == 0);
    }
  }
  std::error_code ec;
  fs::remove_all(dir, ec);
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
