// Scheibe 35, Task 8: /k/mapping im Netz-Faden. Das Netz liest <Ordner>/<geraet>.json mit hand::lade_datei gegen die Regler-
// Tabelle: gültig -> Befehl MAPPING mit dem geprüften Mapping im Befehlsring (die Quittungen 1, 2, 3 kommen vom Kern); kaputt
// (kaputt_ziel.json mit deck/1/fadr in Zeile 5, wie 19), fehlende Datei, Pfad im Gerätenamen -> /q Status 6 Grund pruefung,
// nichts im Ring, der Fehlertext mit Zeile im Protokoll (stderr); unbekannte Quelle -> ausserhalb_bereich.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "cypherdj/netz.h"
#include "hand/mapping.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static void mapping_senden(cdj::Netz& n, int64_t id, const char* quelle, const char* geraet) {
  cdj::osc::Schreiber s(v::k_mapping);
  s.h(id).s(quelle).s(geraet);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const std::string djk = CYPHERDJ_DJK;
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_mapping_" + std::to_string(getpid()));
  fs::create_directories(dir);
  fs::copy_file(djk + "/konfig/controller/softcontroller.json", dir / "softcontroller.json");
  fs::copy_file(djk + "/kern/tests/hand/mappings/mvp_voll.json", dir / "mvp_voll.json");
  fs::copy_file(djk + "/kern/tests/hand/mappings/kaputt_ziel.json", dir / "kaputt_ziel.json");
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
    // gültig: mvp_voll
    mapping_senden(netz, 41, "leitstand", "mvp_voll");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::MAPPING && b.id == 41 && b.zeiger != nullptr);
    if (b.zeiger) {
      const auto* m = static_cast<const hand::Mapping*>(b.zeiger);
      PRUEF(std::string(m->geraet) == "mvp_voll" && m->n_eintraege == 28);
      delete m;
    }
    // kaputt: kaputt_ziel mit dem Text und der Zeile im Protokoll (stderr in eine Datei umgelenkt)
    const std::string logdatei = (dir / "stderr.txt").string();
    fflush(stderr);
    const int alt_fd = dup(2);
    FILE* fr = freopen(logdatei.c_str(), "w", stderr);
    (void)fr;
    mapping_senden(netz, 42, "leitstand", "kaputt_ziel");
    fflush(stderr);
    dup2(alt_fd, 2);
    close(alt_fd);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 42 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    PRUEF(!bef->hole(b));
    std::ifstream in(logdatei);
    std::stringstream ss;
    ss << in.rdbuf();
    const std::string log = ss.str();
    std::printf("Protokoll: %s", log.c_str());
    PRUEF(log.find("kaputt_ziel.json: Zeile 5: unbekanntes_ziel: \"deck/1/fadr\"") != std::string::npos);
    // fehlende Datei, Pfad im Namen, unbekannte Quelle
    mapping_senden(netz, 43, "leitstand", "gibt_es_nicht");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 43 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    mapping_senden(netz, 44, "leitstand", "../softcontroller");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 44 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    mapping_senden(netz, 45, "niemand", "mvp_voll");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 45 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    // das zurückgegebene Mapping gibt das Netz frei (Leck- und Doppelfreigabe-Prüfung: ASan-Bau)
    cdj::Ereignis e{};
    e.art = cdj::Ereignis::MAPPING_ALT;
    e.zeiger = new hand::Mapping();
    PRUEF(ere->schiebe(e));
    netz.ereignisse_senden();
  }
  std::error_code ec;
  fs::remove_all(dir, ec);
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
