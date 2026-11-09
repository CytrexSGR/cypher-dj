// 1.8 Task 23: Aufnahme-Faden. Ein Durchgang leert die Ringe in Take-Dateien, schließt bei phase 2, schreibt die Begleitdatei und meldet genau einmal.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "cypherdj/recording_thread.h"
#include "check.h"

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
  // 1.8 T7a: the MIDI take. File layout byte-exact: 12-byte little endian records (i64 sample, u8 status, d1, d2, pad), no header; retrigger closes the old note at the new
  // onset, a stray off (held before the start) is dropped, the note still open at ende_s is closed there with the channel of its on; the sidecar and the report (art 1, spur 0).
  {
    cdj::AufnahmeFaden fm(d);
    cdj::RecMidi* m = cdj::RecMidi::neu();
    fm.anmelden_midi(m);
    const auto ev = [](int64_t s, uint8_t st, uint8_t a, uint8_t b) { cdj::MidiEinEreignis e{}; e.sample = s; e.b[0] = st; e.b[1] = a; e.b[2] = b; e.n = 3; return e; };
    m->kennung = 41;
    m->start_s = 1000;
    m->phase.store(1, std::memory_order_release);
    fm.durchgang();
    PRUEF(!fm.hole_meldung(tm));
    PRUEF(m->ring.schiebe(ev(1000, 0x90, 60, 100)) && m->ring.schiebe(ev(1010, 0xB0, 1, 64)) && m->ring.schiebe(ev(1020, 0x90, 60, 90)));
    fm.durchgang();                                    // drains in phase 1, does not close
    { cdj::MidiEinEreignis rest; PRUEF(!m->ring.hole(rest) && m->phase.load() == 1); }
    PRUEF(!fm.hole_meldung(tm));
    PRUEF(m->ring.schiebe(ev(1030, 0x92, 64, 80)) && m->ring.schiebe(ev(1040, 0x80, 62, 0)) && m->ring.schiebe(ev(1050, 0x80, 60, 64)));
    m->ende_s = 1100;
    m->phase.store(2, std::memory_order_release);
    fm.durchgang();
    PRUEF(fm.hole_meldung(tm));
    PRUEF(tm.spur == 0 && tm.art == 1 && tm.kennung == 41 && tm.status == 0 && tm.frames == 7 && tm.start_s == 1000 && tm.luecken == 0);
    PRUEF(!fm.hole_meldung(tm) && m->phase.load() == 3);
    std::string soll;
    const auto satz = [&](int64_t s, int st, int a, int b) {
      char r[12] = {};
      std::memcpy(r, &s, 8);
      r[8] = static_cast<char>(st); r[9] = static_cast<char>(a); r[10] = static_cast<char>(b); r[11] = 0;
      soll.append(r, 12);
    };
    satz(1000, 0x90, 60, 100);
    satz(1010, 0xB0, 1, 64);
    satz(1020, 0x80, 60, 0);     // retrigger: the old note ends at the new onset, before the new note on
    satz(1020, 0x90, 60, 90);
    satz(1030, 0x92, 64, 80);
    satz(1050, 0x80, 60, 64);    // (the off of 62 at 1040 was dropped)
    satz(1100, 0x82, 64, 0);     // closed at ende_s, channel 3 of the on
    const std::string bin = lies(d + "/midi-41.bin");
    PRUEF(bin.size() == 7 * 12);
    PRUEF(bin == soll);
    PRUEF(lies(d + "/midi-41.json") == "{\"art\":\"midi\",\"spur\":0,\"kennung\":41,\"eingang\":30,\"start_sample\":1000,\"ende_sample\":1100,\"ereignisse\":7,\"abgelehnt\":0,\"status\":\"fertig\"}\n");
    fm.durchgang();
    PRUEF(!fm.hole_meldung(tm));                       // phase 3: nothing more
    // refused events: status 1, count in luecken
    m->kennung = 42;
    m->start_s = 0;
    m->abgelehnt.store(3, std::memory_order_relaxed);
    m->phase.store(1, std::memory_order_release);
    PRUEF(m->ring.schiebe(ev(5, 0x90, 70, 100)));
    m->ende_s = 50;
    m->phase.store(2, std::memory_order_release);
    fm.durchgang();
    PRUEF(fm.hole_meldung(tm) && tm.kennung == 42 && tm.status == 1 && tm.luecken == 3 && tm.frames == 2 && tm.art == 1);   // on + the closing off
    PRUEF(lies(d + "/midi-42.json").find("\"status\":\"luecken\"") != std::string::npos);
    // a note on with velocity 0 is a note off
    m->kennung = 43;
    m->abgelehnt.store(0, std::memory_order_relaxed);
    m->phase.store(1, std::memory_order_release);
    PRUEF(m->ring.schiebe(ev(5, 0x90, 70, 100)) && m->ring.schiebe(ev(9, 0x90, 70, 0)));
    m->ende_s = 50;
    m->phase.store(2, std::memory_order_release);
    fm.durchgang();
    PRUEF(fm.hole_meldung(tm) && tm.kennung == 43 && tm.frames == 2);
    PRUEF(lies(d + "/midi-43.bin").size() == 24 && static_cast<uint8_t>(lies(d + "/midi-43.bin")[12 + 8]) == 0x90);   // the raw off is kept, nothing is closed at the end
    // an existing file is never replaced: status 3, the old .bin and .json stay
    { std::ofstream(d + "/midi-44.bin") << "ALTDATEN"; std::ofstream(d + "/midi-44.json") << "ALTJSON"; }
    m->kennung = 44;
    m->phase.store(1, std::memory_order_release);
    PRUEF(m->ring.schiebe(ev(5, 0x90, 70, 100)));
    m->ende_s = 50;
    m->phase.store(2, std::memory_order_release);
    fm.durchgang();
    PRUEF(fm.hole_meldung(tm) && tm.kennung == 44 && tm.status == 3 && tm.art == 1);
    PRUEF(lies(d + "/midi-44.bin") == "ALTDATEN" && lies(d + "/midi-44.json") == "ALTJSON");
    // abmelden in the middle of a take: what is in the ring still goes into the file, the sidecar says abgebrochen, no closing offs
    m->kennung = 45;
    m->phase.store(1, std::memory_order_release);
    PRUEF(m->ring.schiebe(ev(5, 0x90, 70, 100)));
    fm.durchgang();
    PRUEF(m->ring.schiebe(ev(6, 0xB0, 1, 2)));
    fm.abmelden_midi(m);
    PRUEF(lies(d + "/midi-45.bin").size() == 24 && lies(d + "/midi-45.json").find("\"status\":\"abgebrochen\"") != std::string::npos);
    cdj::RecMidi::frei(m);
  }
  std::system((std::string("rm -rf ") + d).c_str());
  PRUEF_ENDE();
}
