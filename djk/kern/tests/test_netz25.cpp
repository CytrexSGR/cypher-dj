// Scheibe 25: Netz-Faden über echtes UDP auf Loopback. /k/teil, /k/abbruch, /k/ki/* und /test/hand landen mit allen
// Feldern im Befehlsring; Form- und Bereichsfehler: unbekannte Quelle, Stufe 4 und negative Teil-Nummer als /q 6
// ausserhalb_bereich, /test/hand mit unbekanntem Pfad oder midi_roh 1,5 als /e/protokollfehler, /test/hand ohne
// Prüfmodus als unbekannte_adresse (§19.0). Ereignisse aus dem Callback gehen als /e/regler ,sfshd, /e/hand ,sfhd,
// /e/halter ,sshd, /e/ki ,ish und /e/invariante ,ssihd hinaus, /zustand/kern trägt ki_gestoppt aus /e/ki.
// Ohr T12 (§4.5): /k/hoerschein zerlegt inhalt in material_id/bpm_milli/fassung, unlesbar -> /q 6 form (§16.2
// Formfehler); /k/hoerschein/weg trägt nur hs_id.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cstring>
#include <thread>

#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

static bool eins_im_ring(cdj::Befehlsring* rb, cdj::Befehl& b) {
  for (int t = 0; t < 200; ++t) {
    if (rb->hole(b)) return true;
    usleep(1000);
  }
  return false;
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, true, bef, ere);  // Prüfmodus an
  PRUEF(netz.offen());
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  { cdj::osc::Schreiber s(v::k_hallo); s.s("pruefstand").i(g.port).i(1); g.sende(s); }
  PRUEF(g.warte("/k/willkommen", 500));
  cdj::Befehl b{};

  // /k/teil mit allen zwölf Feldern
  { cdj::osc::Schreiber s(v::k_teil);
    s.h(40).s("cypher").s("p1").i(2).s("deck/2/fader").d(64.0).d(32.0).f(0.0f).i(1).i(0).s("b_rein").s("h2");
    g.sende(s); }
  PRUEF(eins_im_ring(bef, b));
  PRUEF(b.art == cdj::Befehl::TEIL && b.id == 40 && !std::strcmp(b.quelle, "cypher") && !std::strcmp(b.plan, "p1") &&
        b.nr == 2 && !std::strcmp(b.pfad, "deck/2/fader") && b.ab_beat == 64.0 && b.dauer_beats == 32.0 &&
        b.wert == 0.0f && b.form == 1 && b.politik == 0 && !std::strcmp(b.gruppe, "b_rein") &&
        !std::strcmp(b.hoerschein, "h2"));
  // unbekannte Quelle und negative Nummer: /q 6 ausserhalb_bereich, nichts im Ring
  { cdj::osc::Schreiber s(v::k_teil);
    s.h(41).s("jemand").s("p1").i(0).s("deck/2/fader").d(64.0).d(0.0).f(0.0f).i(0).i(0).s("").s(""); g.sende(s); }
  PRUEF(g.warte("/q", 500) && g.h(0) == 41 && g.i(2) == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
  { cdj::osc::Schreiber s(v::k_teil);
    s.h(42).s("leitstand").s("p1").i(-1).s("deck/2/fader").d(64.0).d(0.0).f(0.0f).i(0).i(0).s("").s(""); g.sende(s); }
  PRUEF(g.warte("/q", 500) && g.h(0) == 42 && g.i(2) == 6);
  PRUEF(!bef->hole(b));
  // Ohr T12: /k/hoerschein mit allen dreizehn Feldern, inhalt zerlegt in material_id/bpm_milli/fassung
  { cdj::osc::Schreiber s(v::k_hoerschein);
    s.h(50).s("leitstand").s("h1").s("deck/2").s("3fa1c09b2e7d4410/128000_r1").s("ok").d(128.001).d(120.0).d(64.0)
        .d(96.0).f(1.5f).f(0.2f).f(-14.0f);
    g.sende(s); }
  PRUEF(eins_im_ring(bef, b));
  PRUEF(b.art == cdj::Befehl::HOERSCHEIN && b.id == 50 && !std::strcmp(b.quelle, "leitstand") &&
        !std::strcmp(b.hoerschein, "h1") && !std::strcmp(b.pfad, "deck/2") &&
        !std::strcmp(b.material_id, "3fa1c09b2e7d4410") && b.bpm_milli == 128000 && b.fassung == 1 &&
        !std::strcmp(b.urteil, "ok") && b.bpm == 128.001 && b.ab_beat == 120.0 && b.quell_von == 64.0 &&
        b.quell_bis == 96.0 && b.sync_ms == 1.5f && b.pegel_diff_db == 0.2f && b.lufs_kurz == -14.0f);
  // unlesbarer inhalt: /q 6 form, nichts im Ring (§16.2 Formfehler)
  { cdj::osc::Schreiber s(v::k_hoerschein);
    s.h(51).s("leitstand").s("h2").s("deck/2").s("garbage").s("ok").d(0.0).d(0.0).d(0.0).d(0.0).f(0.0f).f(0.0f)
        .f(0.0f);
    g.sende(s); }
  PRUEF(g.warte("/q", 500) && g.h(0) == 51 && g.i(2) == 6 && !std::strcmp(g.s(5), "form"));
  PRUEF(!bef->hole(b));
  // unbekannte Quelle: /q 6 ausserhalb_bereich, nichts im Ring
  { cdj::osc::Schreiber s(v::k_hoerschein);
    s.h(52).s("jemand").s("h3").s("deck/2").s("3fa1c09b2e7d4410/128000_r1").s("ok").d(0.0).d(0.0).d(0.0).d(0.0)
        .f(0.0f).f(0.0f).f(0.0f);
    g.sende(s); }
  PRUEF(g.warte("/q", 500) && g.h(0) == 52 && g.i(2) == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
  PRUEF(!bef->hole(b));
  // /k/hoerschein/weg trägt nur hs_id
  { cdj::osc::Schreiber s(v::k_hoerschein_weg); s.h(53).s("leitstand").s("h1"); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::HOERSCHEIN_WEG && b.id == 53 &&
        !std::strcmp(b.quelle, "leitstand") && !std::strcmp(b.hoerschein, "h1"));
  // /k/abbruch, /k/ki/*
  { cdj::osc::Schreiber s(v::k_abbruch); s.h(43).s("leitstand").s("p1").s("0,2,5"); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::ABBRUCH && !std::strcmp(b.liste, "0,2,5") &&
        !std::strcmp(b.plan, "p1"));
  { cdj::osc::Schreiber s(v::k_ki_stopp); s.h(44).s("andreas"); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::KI_STOPP && b.id == 44);
  { cdj::osc::Schreiber s(v::k_ki_frei); s.h(45).s("andreas"); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::KI_FREI);
  { cdj::osc::Schreiber s(v::k_ki_spur); s.h(46).s("leitstand").s("deck/3,erz/1"); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::KI_SPUR && !std::strcmp(b.liste, "deck/3,erz/1"));
  { cdj::osc::Schreiber s(v::k_ki_stufe); s.h(47).s("leitstand").i(3); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::KI_STUFE && b.an == 3);
  { cdj::osc::Schreiber s(v::k_ki_stufe); s.h(48).s("leitstand").i(4); g.sende(s); }
  PRUEF(g.warte("/q", 500) && g.h(0) == 48 && g.i(2) == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
  // /test/hand (Prüfmodus): Befehl; unbekannter Pfad und midi_roh außerhalb 0..1 als Protokollfehler
  { cdj::osc::Schreiber s(v::test_hand); s.s("deck/2/fader").f(0.53125f).h(1'620'000); g.sende(s); }
  PRUEF(eins_im_ring(bef, b) && b.art == cdj::Befehl::HAND && !std::strcmp(b.pfad, "deck/2/fader") &&
        b.wert == 0.53125f && b.sample == 1'620'000);
  { cdj::osc::Schreiber s(v::test_hand); s.s("deck/2/gibt_es_nicht").f(0.5f).h(10); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500) && !std::strcmp(g.s(0), "/test/hand") &&
        !std::strcmp(g.s(1), "unbekannter_regler"));
  { cdj::osc::Schreiber s(v::test_hand); s.s("deck/2/fader").f(1.5f).h(10); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500) && !std::strcmp(g.s(1), "ausserhalb_bereich"));
  PRUEF(!bef->hole(b));

  // Ereignisse aus dem Callback
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::REGLER; e.sample = 1'440'000; e.beat = 64.0; e.wert = -15.0f;
  std::strcpy(e.pfad, "deck/2/fader"); std::strcpy(e.text, "plan:p1");
  ere->schiebe(e);
  PRUEF(g.warte("/e/regler", 500) && !std::strcmp(g.m.typen, "sfshd") && !std::strcmp(g.s(0), "deck/2/fader") &&
        g.f(1) == -15.0f && !std::strcmp(g.s(2), "plan:p1") && g.h(3) == 1'440'000 && g.d(4) == 64.0);
  e = cdj::Ereignis{}; e.art = cdj::Ereignis::HAND; e.sample = 1'620'000; e.beat = 72.0; e.wert = -9.9f;
  std::strcpy(e.pfad, "deck/2/fader");
  ere->schiebe(e);
  PRUEF(g.warte("/e/hand", 500) && !std::strcmp(g.m.typen, "sfhd") && g.h(2) == 1'620'000);
  e = cdj::Ereignis{}; e.art = cdj::Ereignis::HALTER; e.sample = 1'620'000; e.beat = 72.0;
  std::strcpy(e.pfad, "deck/2/fader"); std::strcpy(e.text, "mensch");
  ere->schiebe(e);
  PRUEF(g.warte("/e/halter", 500) && !std::strcmp(g.m.typen, "sshd") && !std::strcmp(g.s(1), "mensch"));
  e = cdj::Ereignis{}; e.art = cdj::Ereignis::INVARIANTE; e.sample = 5; e.beat = 0.0; e.teil = 3;
  std::strcpy(e.grund, "sub_doppelt"); std::strcpy(e.text, "p9");
  ere->schiebe(e);
  PRUEF(g.warte("/e/invariante", 500) && !std::strcmp(g.m.typen, "ssihd") && !std::strcmp(g.s(0), "sub_doppelt") &&
        g.i(2) == 3);
  e = cdj::Ereignis{}; e.art = cdj::Ereignis::KI; e.status = 1; e.sample = 1'080'064;
  std::strcpy(e.grund, "ki_stopp");
  ere->schiebe(e);
  PRUEF(g.warte("/e/ki", 500) && !std::strcmp(g.m.typen, "ish") && g.i(0) == 1 && !std::strcmp(g.s(1), "ki_stopp"));
  PRUEF(g.warte("/zustand/kern", 500) && g.warte("/zustand/kern", 500) && g.i(10) == 1);  // ki_gestoppt
  stop = true;
  faden.join();

  // Ohne Prüfmodus: /test/hand ist unbekannt (§19.0)
  cdj::Netz ohne(0, false, bef, ere);
  Gegenstelle g2(ohne.port());
  { cdj::osc::Schreiber s(v::k_hallo); s.s("x").i(g2.port).i(1); ohne.paket(s.daten(), s.groesse()); }
  PRUEF(g2.warte("/k/willkommen", 200));
  { cdj::osc::Schreiber s(v::test_hand); s.s("deck/2/fader").f(0.5f).h(10); ohne.paket(s.daten(), s.groesse()); }
  PRUEF(g2.warte("/e/protokollfehler", 200) && !std::strcmp(g2.s(1), "unbekannte_adresse"));
  PRUEF(!bef->hole(b));
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
