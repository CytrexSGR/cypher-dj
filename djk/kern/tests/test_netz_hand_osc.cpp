// Scheibe 35, Befund B-O Weg 1 (kern.toml hand_osc): /test/hand am echten Kern ohne Prüfmodus. Netz ohne Prüfmodus und
// ohne hand_osc weist /test/hand ab (/e/protokollfehler unbekannte_adresse, nichts im Befehlsring); mit hand_osc = true
// (setze_hand_osc, ohne Prüfmodus) nimmt es Regler und deck/<n>/play|cue an, lehnt andere Pfade als unbekannter_regler
// ab, und die übrigen /test/*-Adressen (/test/klick) bleiben am Prüfmodus.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>

#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

static void hallo(cdj::Netz& n, Gegenstelle& g) {
  cdj::osc::Schreiber s(v::k_hallo);
  s.s("x").i(g.port).i(1);
  n.paket(s.daten(), s.groesse());
  PRUEF(g.warte("/k/willkommen", 200));
}
static void sende_hand(cdj::Netz& n, const char* pfad, float roh, int64_t sample) {
  cdj::osc::Schreiber s(v::test_hand);
  s.s(pfad).f(roh).h(sample);
  n.paket(s.daten(), s.groesse());
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {  // Negativ-Kontrolle: weder Prüfmodus noch hand_osc
    cdj::Netz ohne(0, false, bef, ere);
    Gegenstelle g;
    hallo(ohne, g);
    sende_hand(ohne, "deck/1/play", 1.0f, 10);
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannte_adresse"));
    sende_hand(ohne, "deck/2/fader", 0.5f, 10);
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannte_adresse"));
    PRUEF(!bef->hole(b));
  }
  {  // hand_osc ohne Prüfmodus
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_hand_osc(true);
    Gegenstelle g;
    hallo(netz, g);
    sende_hand(netz, "deck/1/play", 1.0f, 10);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::HAND && !std::strcmp(b.pfad, "deck/1/play") && b.wert == 1.0f && b.sample == 10);
    sende_hand(netz, "deck/2/cue", 0.0f, 20);
    PRUEF(bef->hole(b) && !std::strcmp(b.pfad, "deck/2/cue") && b.wert == 0.0f && b.sample == 20);
    sende_hand(netz, "deck/2/fader", 0.5f, 30);
    PRUEF(bef->hole(b) && !std::strcmp(b.pfad, "deck/2/fader"));
    sende_hand(netz, "deck/1/hotcue/1", 1.0f, 40);  // keine Deck-Taste des MVP
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannter_regler"));
    // Zusatz 35: taste/<name> (Annahme-Weg der Oberfläche): Namen aus §5.8 ohne Encoder-Werte angenommen, sonst unbekannt
    sende_hand(netz, "taste/annehmen", 1.0f, 50);
    PRUEF(bef->hole(b) && !std::strcmp(b.pfad, "taste/annehmen") && b.wert == 1.0f && b.sample == 50);
    sende_hand(netz, "taste/stopp", 0.0f, 51);
    PRUEF(bef->hole(b) && !std::strcmp(b.pfad, "taste/stopp"));
    sende_hand(netz, "taste/gibt_es_nicht", 1.0f, 52);  // Negativ-Kontrolle: unbekannter Tastenname bleibt abgewiesen
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannter_regler"));
    sende_hand(netz, "taste/autonomie", 1.0f, 53);      // Encoder-Wert: nicht über /test/hand
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannter_regler"));
    sende_hand(netz, "taste/annehmen", 1.5f, 54);
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    sende_hand(netz, "deck/5/play", 1.0f, 40);
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannter_regler"));
    sende_hand(netz, "deck/1/play", 1.5f, 40);
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "ausserhalb_bereich"));
    {  // /test/klick bleibt am Prüfmodus
      cdj::osc::Schreiber s(v::test_klick);
      s.h(1).s("pruefstand").s("master").i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannte_adresse"));
    }
    PRUEF(!bef->hole(b));
    {  // Scheibe 35 Task 6: Ereignis TASTE geht als /e/taste ,sihd hinaus (name, wert, sample, beat)
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::TASTE;
      e.sample = 1'234'567;
      e.beat = 54.87;
      e.status = 1;
      std::strcpy(e.pfad, "stopp");
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/taste", 300) && !std::strcmp(g.m.typen, "sihd") && !std::strcmp(g.s(0), "stopp") &&
            g.m.werte[1].i == 1 && g.m.werte[2].h == 1'234'567 && g.m.werte[3].d == 54.87);
    }
  }
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
