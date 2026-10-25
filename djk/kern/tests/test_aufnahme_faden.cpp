// 1.8 Task 23: Aufnahme-Faden. Ein Durchgang leert die Ringe in Take-Dateien, schließt bei phase 2, schreibt die Begleitdatei und meldet genau einmal.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "cypherdj/aufnahme_faden.h"
#include "pruef.h"

static cdj::AufnahmeChunk chunk(int64_t s0) {
  cdj::AufnahmeChunk c{};
  c.s0 = s0;
  c.n = cdj::REC_CHUNK;
  for (int i = 0; i < c.n; ++i) { c.l[i] = 0.001f * static_cast<float>((s0 + i) % 977 + 1); c.r[i] = -c.l[i]; }
  return c;
}
static std::string lies(const std::string& p) { std::ifstream f(p, std::ios::binary); return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); }

int main() {
  char vorlage[] = "/tmp/faden_sXXXXXX";
  PRUEF(mkdtemp(vorlage) != nullptr);
  const std::string d = vorlage;
  cdj::AufnahmeFaden fa(d);
  cdj::RecSpur* p = cdj::RecSpur::neu(4, 11);
  fa.anmelden(p);
  p->kennung = 21;
  p->start_s = 1000;
  p->phase.store(1, std::memory_order_release);
  fa.durchgang();
  cdj::TakeMeldung tm{};
  PRUEF(!fa.hole_meldung(tm));                       // nimmt noch auf: keine Meldung
  for (int i = 0; i < 4; ++i) PRUEF(p->ring.schiebe(chunk(1000 + i * 256)));
  fa.durchgang();                                    // schreibt, schließt noch nicht
  PRUEF(!fa.hole_meldung(tm) && p->phase.load() == 1);
  { cdj::AufnahmeChunk rest; PRUEF(!p->ring.hole(rest)); }   // das laufende Leeren in Phase 1: der Ring ist nach dem Durchgang leer (Review T23, sonst Lücken nach 2,73 s)
  PRUEF(p->ring.schiebe(chunk(1000 + 4 * 256)));
  p->ende_s = 1000 + 5 * 256;
  p->phase.store(2, std::memory_order_release);
  fa.durchgang();
  PRUEF(fa.hole_meldung(tm));
  PRUEF(tm.spur == 4 && tm.kennung == 21 && tm.status == 0 && tm.frames == 1280 && tm.start_s == 1000 && tm.luecken == 0);
  PRUEF(!fa.hole_meldung(tm));                       // genau einmal
  PRUEF(p->phase.load() == 3);
  const std::string roh = lies(d + "/aufnahme-4-21.f32");
  PRUEF(roh.size() == 1280 * 8);
  const std::string js = lies(d + "/aufnahme-4-21.json");
  PRUEF(js.find("\"status\":\"fertig\"") != std::string::npos && js.find("\"frames\":1280") != std::string::npos);
  fa.durchgang();
  PRUEF(!fa.hole_meldung(tm));                       // phase 3: nichts mehr
  // Lücke: der Faden hängt (kein Durchgang), der Ring läuft über; danach Meldung mit Status 1 und Lücken > 0, die Datei ist trotzdem zeitrichtig lang
  p->kennung = 22;
  p->start_s = 0;
  p->phase.store(1, std::memory_order_release);
  int geschoben = 0;
  for (int i = 0; i < 563; ++i) geschoben += p->ring.schiebe(chunk(i * 256)) ? 1 : 0;   // 3 s Stall
  PRUEF(geschoben == 512);
  p->ende_s = 563 * 256;
  p->phase.store(2, std::memory_order_release);
  fa.durchgang();
  PRUEF(fa.hole_meldung(tm) && tm.kennung == 22 && tm.status == 1 && tm.luecken >= 1 && tm.frames == 563 * 256);
  PRUEF(lies(d + "/aufnahme-4-22.f32").size() == 563u * 256u * 8u);
  // Abmelden: nach abmelden() fasst der Faden die Spur nicht mehr an
  fa.abmelden(p);
  cdj::RecSpur::frei(p);
  fa.durchgang();
  // Öffnungsfehler ohne einen Frame (Review T23, MINOR 1): der Take endet mit Status 3, nicht als „fertig“ ohne Datei
  {
    cdj::AufnahmeFaden fb(d + "/gibt-es-nicht");
    cdj::RecSpur* q = cdj::RecSpur::neu(5, 12);
    fb.anmelden(q);
    q->kennung = 31;
    q->start_s = 0;
    q->phase.store(1, std::memory_order_release);
    q->ende_s = 0;
    q->phase.store(2, std::memory_order_release);
    fb.durchgang();
    PRUEF(fb.hole_meldung(tm) && tm.kennung == 31 && tm.status == 3 && tm.frames == 0);
    fb.abmelden(q);
    cdj::RecSpur::frei(q);
  }
  // Vorhandene Take-Datei (Review T23, MINOR 2): weder .f32 noch .json des alten Takes werden angefasst, der neue endet mit Status 3
  {
    { std::ofstream(d + "/aufnahme-6-32.f32") << "ALTDATEN"; std::ofstream(d + "/aufnahme-6-32.json") << "ALTJSON"; }
    cdj::AufnahmeFaden fc(d);
    cdj::RecSpur* q = cdj::RecSpur::neu(6, 13);
    fc.anmelden(q);
    q->kennung = 32;
    q->start_s = 0;
    q->phase.store(1, std::memory_order_release);
    PRUEF(q->ring.schiebe(chunk(0)));
    q->ende_s = 256;
    q->phase.store(2, std::memory_order_release);
    fc.durchgang();
    PRUEF(fc.hole_meldung(tm) && tm.kennung == 32 && tm.status == 3);
    PRUEF(lies(d + "/aufnahme-6-32.f32") == "ALTDATEN" && lies(d + "/aufnahme-6-32.json") == "ALTJSON");
    fc.abmelden(q);
    cdj::RecSpur::frei(q);
  }
  // Abmelden mitten im Take (Review T23, MINOR 3): Ring und Puffer kommen noch in die Datei, die Begleitdatei sagt „abgebrochen“
  {
    cdj::AufnahmeFaden fd_(d);
    cdj::RecSpur* q = cdj::RecSpur::neu(7, 14);
    fd_.anmelden(q);
    q->kennung = 33;
    q->start_s = 0;
    q->phase.store(1, std::memory_order_release);
    for (int i = 0; i < 3; ++i) PRUEF(q->ring.schiebe(chunk(i * 256)));
    fd_.durchgang();
    PRUEF(q->ring.schiebe(chunk(3 * 256)));   // noch im Ring
    fd_.abmelden(q);
    cdj::RecSpur::frei(q);
    PRUEF(lies(d + "/aufnahme-7-33.f32").size() == 4u * 256u * 8u);
    PRUEF(lies(d + "/aufnahme-7-33.json").find("\"status\":\"abgebrochen\"") != std::string::npos);
  }
  // Kern-Ende mitten im Take (Review T23, MINOR 3): der Destruktor des Fadens schreibt den Puffer
  {
    cdj::RecSpur* q = cdj::RecSpur::neu(8, 15);
    {
      cdj::AufnahmeFaden fe(d);
      fe.anmelden(q);
      q->kennung = 34;
      q->start_s = 0;
      q->phase.store(1, std::memory_order_release);
      for (int i = 0; i < 3; ++i) PRUEF(q->ring.schiebe(chunk(i * 256)));
      fe.durchgang();                           // der erste Durchgang synct (letzter_sync_ms_ = 0) ...
      PRUEF(q->ring.schiebe(chunk(3 * 256)));
      fe.durchgang();                           // ... dieser nicht mehr (unter 1 s): der Chunk liegt nur im Puffer
    }
    PRUEF(lies(d + "/aufnahme-8-34.f32").size() == 4u * 256u * 8u);
    PRUEF(lies(d + "/aufnahme-8-34.json").find("\"status\":\"abgebrochen\"") != std::string::npos);
    cdj::RecSpur::frei(q);
  }
  std::system((std::string("rm -rf ") + d).c_str());
  PRUEF_ENDE();
}
