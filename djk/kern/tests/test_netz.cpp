// Netz-Faden über echtes UDP auf Loopback: Anmeldung, Quittungen, Prüfmodus, Protokollfehler, Ereignisse an Abonnenten.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cstring>
#include <string>
#include <thread>

#include "cypherdj/kern.h"
#include "cypherdj/netz.h"
#include "pruef.h"

struct Gegenstelle {
  int sock;
  int port;
  int kern_port;
  char buf[2048];
  cdj::osc::Nachricht m;
  explicit Gegenstelle(int kp) : kern_port(kp) {
    sock = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind(sock, (sockaddr*)&a, sizeof a);
    socklen_t l = sizeof a;
    getsockname(sock, (sockaddr*)&a, &l);
    port = ntohs(a.sin_port);
  }
  ~Gegenstelle() { close(sock); }
  void sende(const cdj::osc::Schreiber& s) {
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)kern_port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sendto(sock, s.daten(), s.groesse(), 0, (sockaddr*)&a, sizeof a);
  }
  // wartet bis zu ms auf eine Nachricht mit dieser Adresse (andere werden übersprungen); sonst ist m leer
  bool warte(const char* adresse, int ms) {
    for (int t = 0; t < ms; ++t) {
      pollfd pf{sock, POLLIN, 0};
      if (poll(&pf, 1, 1) > 0) {
        ssize_t r = recv(sock, buf, sizeof buf, 0);
        if (r > 0 && cdj::osc::lesen(buf, (size_t)r, m) && !std::strcmp(m.adresse, adresse)) return true;
      }
    }
    m.anzahl = 0;
    m.typen = "";
    return false;
  }
  // Werte der letzten Nachricht; außerhalb der Nachricht ein Wert, der keine Prüfung besteht
  const char* s(int i) const { return (i < m.anzahl && m.werte[i].typ == 's') ? m.werte[i].s : "<fehlt>"; }
  int32_t i(int k) const { return (k < m.anzahl && m.werte[k].typ == 'i') ? m.werte[k].i : -999; }
  int64_t h(int k) const { return (k < m.anzahl && m.werte[k].typ == 'h') ? m.werte[k].h : -999; }
  double d(int k) const { return (k < m.anzahl && m.werte[k].typ == 'd') ? m.werte[k].d : -999.0; }
};

static int befehle_im_ring(cdj::Befehlsring* rb, cdj::Befehl* letzter) {
  int n = 0;
  while (rb->hole(*letzter)) ++n;
  return n;
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, true, bef, ere);
  PRUEF(netz.offen());
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  cdj::Befehl b{};

  // 1) Anmeldung
  { cdj::osc::Schreiber s("/k/hallo", "sii"); s.s("pruefstand").i(g.port).i(1); g.sende(s); }
  PRUEF(g.warte("/k/willkommen", 500));
  PRUEF(!std::strcmp(g.m.typen, "iihdds") && g.i(0) == 1 && !std::strcmp(g.s(5), cdj::KERN_VERSION));

  // 2) /k/set/neu: Befehl im Ring; die Quittung angenommen kommt seit Scheibe 08 aus dem Callback (Einsortieren)
  { cdj::osc::Schreiber s("/k/set/neu", "hsd"); s.h(7).s("pruefstand").d(128.0); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  PRUEF(befehle_im_ring(bef, &b) == 1 && b.art == cdj::Befehl::SET_NEU && b.bpm == 128.0);

  // 3) /k/set/neu außerhalb 60 bis 200: abgelehnt, nichts im Ring
  { cdj::osc::Schreiber s("/k/set/neu", "hsd"); s.h(8).s("pruefstand").d(300.0); g.sende(s); }
  PRUEF(g.warte("/q", 500));
  PRUEF(g.h(0) == 8 && g.i(2) == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
  PRUEF(befehle_im_ring(bef, &b) == 0);

  // 4) /test/klick master an: Befehl im Ring (Quittung angenommen aus dem Callback, Scheibe 08)
  { cdj::osc::Schreiber s("/test/klick", "hssi"); s.h(9).s("pruefstand").s("master").i(1); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  PRUEF(befehle_im_ring(bef, &b) == 1 && b.art == cdj::Befehl::KLICK && b.an == 1);

  // 5) Scheibe 25: ein Kanal aus §1.5 geht in den Ring (Kanal in pfad), ein unbekannter wird abgelehnt
  { cdj::osc::Schreiber s("/test/klick", "hssi"); s.h(10).s("pruefstand").s("deck/1").i(1); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  PRUEF(befehle_im_ring(bef, &b) == 1 && b.art == cdj::Befehl::KLICK && !std::strcmp(b.pfad, "deck/1"));
  { cdj::osc::Schreiber s("/test/klick", "hssi"); s.h(13).s("pruefstand").s("deck/9").i(1); g.sende(s); }
  PRUEF(g.warte("/q", 500));
  PRUEF(g.i(2) == 6 && !std::strcmp(g.s(5), "unbekannter_regler"));

  // 6) falsche Typen und 7) unbekannte Adresse
  { cdj::osc::Schreiber s("/test/klick", "hsi"); s.h(11).s("pruefstand").i(1); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/test/klick") && !std::strcmp(g.s(1), "falsche_typen"));
  { cdj::osc::Schreiber s("/k/gibt_es_nicht", "h"); s.h(12); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/k/gibt_es_nicht") && !std::strcmp(g.s(1), "unbekannte_adresse"));

  // 8) Ereignisse aus dem Callback: /uhr, /takt, /q
  cdj::Ereignis u{};
  u.art = cdj::Ereignis::UHR; u.sample = 22500; u.mono_ns = 123; u.beat = 1.0; u.bpm = 128.0;
  ere->schiebe(u);
  PRUEF(g.warte("/uhr", 500));
  PRUEF(!std::strcmp(g.m.typen, "hhddd") && g.h(0) == 22500 && g.h(1) == 123 && g.d(3) == 128.0);
  cdj::Ereignis t{};
  t.art = cdj::Ereignis::TAKT; t.takt = 2; t.phrase = 1; t.sample = 90000; t.beat = 4.0; t.bpm = 128.0;
  ere->schiebe(t);
  PRUEF(g.warte("/takt", 500));
  PRUEF(!std::strcmp(g.m.typen, "iihdd") && g.i(0) == 2 && g.h(2) == 90000);

  // 9) abmelden: danach kommt nichts mehr
  { cdj::osc::Schreiber s("/k/tschuess", "s"); s.s("pruefstand"); g.sende(s); }
  std::this_thread::sleep_for(std::chrono::milliseconds(20));
  ere->schiebe(u);
  PRUEF(!g.warte("/uhr", 100));

  // 10) falsches Protokoll: Protokollfehler an den Port des Anmelders
  { cdj::osc::Schreiber s("/k/hallo", "sii"); s.s("alt").i(g.port).i(2); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/k/hallo") && !std::strcmp(g.s(1), "protokoll"));
  stop = true;
  faden.join();

  // 11) ohne Prüfmodus: /test/klick ist Protokollfehler, nichts im Ring
  std::atomic<bool> stop2{false};
  cdj::Netz ohne(0, false, bef, ere);
  std::thread f2([&] { ohne.laufen(stop2); });
  Gegenstelle g2(ohne.port());
  { cdj::osc::Schreiber s("/k/hallo", "sii"); s.s("pruefstand").i(g2.port).i(1); g2.sende(s); }
  PRUEF(g2.warte("/k/willkommen", 500));
  { cdj::osc::Schreiber s("/test/klick", "hssi"); s.h(13).s("pruefstand").s("master").i(1); g2.sende(s); }
  PRUEF(g2.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g2.s(0), "/test/klick") && !std::strcmp(g2.s(1), "unbekannte_adresse"));
  PRUEF(befehle_im_ring(bef, &b) == 0);
  stop2 = true;
  f2.join();

  // 12) Herzschlag §4.1 (Frist hier 200 ms statt 5 s): wer schweigt, wird gestrichen; wer alle 50 ms /k/hallo
  //     schickt, bleibt (Negativ-Kontrolle im selben Lauf)
  std::atomic<bool> stop3{false};
  cdj::Netz kurz(0, true, bef, ere, 200'000'000LL);
  std::thread f3([&] { kurz.laufen(stop3); });
  Gegenstelle still(kurz.port()), treu(kurz.port());
  { cdj::osc::Schreiber s("/k/hallo", "sii"); s.s("still").i(still.port).i(1); still.sende(s); }
  PRUEF(still.warte("/k/willkommen", 500));
  for (int k = 0; k < 8; ++k) {  // 8 x 50 ms = 400 ms, doppelt so lang wie die Frist
    { cdj::osc::Schreiber s("/k/hallo", "sii"); s.s("treu").i(treu.port).i(1); treu.sende(s); }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  ere->schiebe(u);
  PRUEF(treu.warte("/uhr", 500));
  PRUEF(!still.warte("/uhr", 100));
  stop3 = true;
  f3.join();
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
