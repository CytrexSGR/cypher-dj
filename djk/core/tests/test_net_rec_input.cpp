// S18 task 2: which `eingang` codes /k/rec/spur accepts. Valid codes reach the record-thread check (this fixture has no
// record thread, so they answer "datei_fehlt"); invalid ones are refused earlier with "ausserhalb_bereich".
// Codes (contract osc.json): 11..13 = erz/1..3, 15..17 = erz/5..7, 21, 22 = pad/1, pad/2, 20 = master (not tapped yet).
// 14 (erz/4, production), 18 (erz/8, cue) and everything else are refused.
// 1.8 S0: /k/rec/spur has seven fields (modus, monitor), /k/rec/start six (vorzaehler_takte), /zustand/rec and /e/aufnahme carry two more.
// The core parses all of them and refuses every non-default value with a reason until its slice: eingang 20 answers eingang_fehlt (eingang 30 is armed since 1.8 T7a),
// vorzaehler_takte outside 0, 1, 2, 4 answers ausserhalb_bereich (S4a.4); monitor is accepted and ignored by the core for internal sources (D11) and stored in the RecSpur (S3). S2a: eingang 1..4 are accepted with modus 0..3;
// a modus != 0 on an internal code answers ausserhalb_bereich.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>

#include "cypherdj/recording_thread.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

static void spur(cdj::Netz& n, int64_t id, int eingang, int scharf = 1, int modus = 0, int monitor = 1) {
  cdj::osc::Schreiber s(v::k_rec_spur);
  s.h(id).s("andreas").i(1).i(scharf).i(eingang).i(modus).i(monitor);
  n.paket(s.daten(), s.groesse());
}

static void start(cdj::Netz& n, int64_t id, int vorzaehler) {
  cdj::osc::Schreiber s(v::k_rec_start);
  s.h(id).s("andreas").i(1).i(0).i(0).i(vorzaehler);
  n.paket(s.daten(), s.groesse());
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  {
    cdj::Netz netz(0, false, bef, ere);
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    int64_t id = 100;
    auto antwort = [&](int eingang, const char* grund, int modus = 0, int monitor = 1) {
      spur(netz, ++id, eingang, 1, modus, monitor);
      const bool da = g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6;
      const bool ok = da && !std::strcmp(g.s(5), grund);
      if (!ok) std::printf("eingang %d: erwartet %s, bekommen %s\n", eingang, grund, da ? g.s(5) : "(keine Antwort)");
      PRUEF(ok);
    };
    for (int c : {11, 12, 13}) antwort(c, "datei_fehlt");   // control: the codes that always worked
    for (int c : {15, 16, 17, 21, 22}) antwort(c, "datei_fehlt");   // S18: erz/5..7, pad/1..2 pass the range check
    for (int c : {14, 18, 19, 23, 10, 24, -1, 99}) antwort(c, "ausserhalb_bereich");   // erz/4, erz/8 and strays
    antwort(20, "eingang_fehlt");   // master before the fader: valid code, no tap yet
    // 1.8 S0: the new fields. Non-default values are refused until their slice; the refusals and the accepted cases:
    antwort(1, "datei_fehlt");                // S2a: external pair ein_1 is accepted (this fixture has no record thread)
    antwort(4, "datei_fehlt");                // external pair ein_4
    antwort(30, "datei_fehlt");               // 1.8 T7a: midi_ein_1 on an instrument track is accepted (this fixture has no record thread)
    antwort(5, "ausserhalb_bereich");         // between the external pairs and erz/N
    antwort(31, "ausserhalb_bereich");        // above the new range [0, 30]
    antwort(1, "datei_fehlt", 1);             // S2a: every channel mode is accepted on an external pair
    antwort(2, "datei_fehlt", 2);
    antwort(3, "datei_fehlt", 3);
    antwort(1, "ausserhalb_bereich", 4);      // modus beyond [0, 3], also on an external pair
    antwort(1, "ausserhalb_bereich", -1);
    antwort(11, "ausserhalb_bereich", 1);     // S2a: a channel mode on an internal code is out of range (modus only means something for ein_1..4)
    antwort(11, "ausserhalb_bereich", 3);
    antwort(22, "ausserhalb_bereich", 2);
    antwort(20, "eingang_fehlt", 2);          // master keeps its reason (later): the code check comes first
    antwort(30, "ausserhalb_bereich", 1);     // T7a: the channel mode only exists for ein_1..4, also on a MIDI arm
    antwort(11, "ausserhalb_bereich", 4);     // modus beyond [0, 3]
    antwort(11, "ausserhalb_bereich", -1);
    antwort(11, "datei_fehlt", 0, 2);         // D11: monitor ein is accepted (and ignored) for an internal source
    antwort(11, "datei_fehlt", 0, 0);         // monitor aus
    antwort(11, "ausserhalb_bereich", 0, 3);  // monitor beyond [0, 2]
    antwort(11, "ausserhalb_bereich", 0, -1);
    // disarming with a code the core has no tap for yet is not an error of this check (scharf 0 never needs the tap): reaches the thread check
    spur(netz, ++id, 1, 0);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == id && !std::strcmp(g.s(5), "datei_fehlt"));
    // /k/rec/start: vorzaehler_takte is range-checked (1.8 S4a.4: 0, 1, 2 and 4 bars exist, 3 does not)
    for (int n : {3, 5, -1, 8}) {
      start(netz, ++id, n);
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    }
    // the values that exist are queued and the Befehl carries them (politik); 0 is the case of slice 1 (negative control: nothing is refused for it)
    for (int n : {0, 1, 2, 4}) {
      cdj::Befehl b{};
      while (bef->hole(b)) {}
      start(netz, ++id, n);
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::REC_START && b.id == id && b.politik == n && b.nr == 1);
    }
    // arming "none" with eingang 0 is still "kein_eingang"; disarming (scharf 0) with a code is not an error of this check
    spur(netz, ++id, 0, 1);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == id && !std::strcmp(g.s(5), "kein_eingang"));
  }
  delete bef;
  delete ere;

  // 1.8 S0 writer tests: the event ring and the record thread reach the wire with the new fields (net thread running)
  char vorlage[] = "/tmp/netz_rec_eXXXXXX";
  PRUEF(mkdtemp(vorlage) != nullptr);
  {
    auto* bef2 = new cdj::Befehlsring();
    auto* ere2 = new cdj::Ereignisring();
    cdj::AufnahmeFaden faden(vorlage);
    std::atomic<bool> stop{false};
    cdj::Netz netz(0, true, bef2, ere2);
    netz.verbinde_rec(&faden);
    PRUEF(netz.offen());
    std::thread nt([&] { netz.laufen(stop); });
    Gegenstelle g(netz.port());
    { cdj::osc::Schreiber s(v::k_hallo); s.s("pruefstand").i(g.port).i(1); g.sende(s); }
    PRUEF(g.warte("/k/willkommen", 500));
    // /zustand/rec: fassung -> ausgang_vorhalt, nframes -> quantum
    cdj::Ereignis e{};
    e.art = cdj::Ereignis::REC_ZUSTAND;
    e.sample = 1000; e.status = 3; e.id = 7; e.rec_scharf = 2; e.rec_luecken = 5; e.arr_beat = 8.5; e.rec_midi_scharf = 3;
    e.fassung = 333; e.nframes = 256;
    ere2->schiebe(e);
    PRUEF(g.warte("/zustand/rec", 500) && !std::strcmp(g.m.typen, "iiihdiii") && g.i(0) == 3 && g.i(1) == 7 && g.i(2) == 2 && g.h(3) == 5 &&
          g.d(4) == 8.5 && g.i(5) == 333 && g.i(6) == 256 && g.i(7) == 3);   // T7a: rec_midi_scharf is the last field
    // a second Ereignis with different values (the writer reads the fields, it does not repeat a constant)
    e.fassung = 84; e.nframes = 1024; e.rec_midi_scharf = 0;
    ere2->schiebe(e);
    PRUEF(g.warte("/zustand/rec", 500) && g.i(5) == 84 && g.i(6) == 1024 && g.i(7) == 0);
    // /e/aufnahme: one tiny take through the record thread, seven fields, art 0 (audio)
    cdj::RecSpur* p = cdj::RecSpur::neu(4, 11);
    faden.anmelden(p);
    p->kennung = 21;
    p->start_s = 1000;
    p->phase.store(1, std::memory_order_release);
    cdj::AufnahmeChunk c{};
    c.s0 = 1000;
    c.n = cdj::REC_CHUNK;
    for (int i = 0; i < c.n; ++i) { c.l[i] = 0.01f; c.r[i] = -0.01f; }
    PRUEF(p->ring.schiebe(c));
    p->ende_s = 1000 + cdj::REC_CHUNK;
    p->phase.store(2, std::memory_order_release);
    faden.durchgang();
    PRUEF(g.warte("/e/aufnahme", 1000) && !std::strcmp(g.m.typen, "iiihhii") && g.i(0) == 4 && g.i(1) == 21 && g.i(2) == 0 &&
          g.h(3) == cdj::REC_CHUNK && g.h(4) == 1000 && g.i(5) == 0 && g.i(6) == 0);
    faden.abmelden(p);
    cdj::RecSpur::frei(p);
    // 1.8 T7a: /e/aufnahme of a MIDI take: art 1, spur 0, frames = event count, luecken = refused events (through the record thread and the net thread)
    {
      cdj::RecMidi* mm = cdj::RecMidi::neu();
      faden.anmelden_midi(mm);
      mm->kennung = 51;
      mm->start_s = 2000;
      mm->phase.store(1, std::memory_order_release);
      cdj::MidiEinEreignis me{};
      me.sample = 2010; me.b[0] = 0x90; me.b[1] = 60; me.b[2] = 100; me.n = 3;
      PRUEF(mm->ring.schiebe(me));
      mm->abgelehnt.store(2, std::memory_order_relaxed);
      mm->ende_s = 2100;
      mm->phase.store(2, std::memory_order_release);
      faden.durchgang();
      PRUEF(g.warte("/e/aufnahme", 1000) && !std::strcmp(g.m.typen, "iiihhii") && g.i(0) == 0 && g.i(1) == 51 && g.i(2) == 1 && g.h(3) == 2 && g.h(4) == 2000 && g.i(5) == 2 && g.i(6) == 1);
      faden.abmelden_midi(mm);
      cdj::RecMidi::frei(mm);
    }
    // T7a: a MIDI arm over the wire carries a fresh RecMidi (registered with the record thread) and eingang 30 in deck; a MIDI disarm carries none
    {
      cdj::osc::Schreiber sm(v::k_rec_spur);
      sm.h(930).s("andreas").i(4).i(1).i(30).i(0).i(1);
      g.sende(sm);
      cdj::Befehl bm{};
      for (int i = 0; i < 100 && !bef2->hole(bm); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
      PRUEF(bm.art == cdj::Befehl::REC_SPUR && bm.id == 930 && bm.nr == 4 && bm.an == 1 && bm.deck == 30 && bm.zeiger != nullptr);
      if (bm.zeiger) { auto* qm = static_cast<cdj::RecMidi*>(const_cast<void*>(bm.zeiger)); faden.abmelden_midi(qm); cdj::RecMidi::frei(qm); }
      cdj::osc::Schreiber sd(v::k_rec_spur);
      sd.h(931).s("andreas").i(4).i(0).i(30).i(0).i(1);
      g.sende(sd);
      cdj::Befehl bd{};
      for (int i = 0; i < 100 && !bef2->hole(bd); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
      PRUEF(bd.art == cdj::Befehl::REC_SPUR && bd.id == 931 && bd.an == 0 && bd.deck == 30 && bd.zeiger == nullptr);
    }
    // the record thread is connected: /k/rec/spur with monitor 2 now reaches the ring and carries monitor in politik, modus in form
    cdj::osc::Schreiber s(v::k_rec_spur);
    s.h(900).s("andreas").i(2).i(1).i(11).i(0).i(2);
    g.sende(s);
    cdj::Befehl b{};
    for (int i = 0; i < 100 && !bef2->hole(b); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
    PRUEF(b.art == cdj::Befehl::REC_SPUR && b.id == 900 && b.nr == 2 && b.deck == 11 && b.form == 0 && b.politik == 2);
    PRUEF(b.zeiger != nullptr && static_cast<cdj::RecSpur*>(const_cast<void*>(b.zeiger))->eingang == 11 &&
          static_cast<cdj::RecSpur*>(const_cast<void*>(b.zeiger))->modus == 0);   // an internal track carries modus 0
    PRUEF(b.zeiger != nullptr && static_cast<cdj::RecSpur*>(const_cast<void*>(b.zeiger))->monitor.load() == 2);   // 1.8 S3 (D12): the monitor travels in the RecSpur (default 1, so 2 can only come from the message)
    if (b.zeiger) { auto* q = static_cast<cdj::RecSpur*>(const_cast<void*>(b.zeiger)); faden.abmelden(q); cdj::RecSpur::frei(q); }
    // S2a: an external pair is queued with its channel mode, in the Befehl (form) and in the RecSpur the net thread built
    for (int modus = 0; modus <= 3; ++modus) {
      cdj::osc::Schreiber sx(v::k_rec_spur);
      sx.h(910 + modus).s("andreas").i(3).i(1).i(2).i(modus).i(1);
      g.sende(sx);
      cdj::Befehl bx{};
      for (int i = 0; i < 100 && !bef2->hole(bx); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
      PRUEF(bx.art == cdj::Befehl::REC_SPUR && bx.id == 910 + modus && bx.nr == 3 && bx.deck == 2 && bx.form == modus && bx.politik == 1);
      auto* qx = static_cast<cdj::RecSpur*>(const_cast<void*>(bx.zeiger));
      PRUEF(qx != nullptr && qx->eingang == 2 && qx->modus == modus && qx->spur == 3);
      PRUEF(qx != nullptr && qx->monitor.load() == 1);
      if (qx) { faden.abmelden(qx); cdj::RecSpur::frei(qx); }
    }
    // negative control: disarming an external pair queues no RecSpur
    {
      cdj::osc::Schreiber sx(v::k_rec_spur);
      sx.h(920).s("andreas").i(3).i(0).i(2).i(2).i(1);
      g.sende(sx);
      cdj::Befehl bx{};
      for (int i = 0; i < 100 && !bef2->hole(bx); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(5));
      PRUEF(bx.art == cdj::Befehl::REC_SPUR && bx.id == 920 && bx.an == 0 && bx.zeiger == nullptr);
    }
    stop.store(true);
    nt.join();
    delete bef2;
    delete ere2;
  }
  PRUEF_ENDE();
}
