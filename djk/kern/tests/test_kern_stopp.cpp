// Scheibe 35, Task 6 (Plan 2026-09-26): Stopp-Taste ohne Leitstand, nur Unit-Test ohne JACK (der Ziel-Lauf ist B0b in
// Teil B). Die Softcontroller-Nachricht taste/stopp (Note 16/0) ruft Stellwerk::ki_stopp(0, andreas) am Anfang des Zyklus
// ihres Ereignisses (Plan 35 E6): der cypher-Teil fällt dort mit Quittung 7 Grund ki_stopp, /e/ki meldet gestoppt am
// Blockanfang, /e/taste stopp geht hinaus; das Loslassen ändert nichts. Negativ-Kontrolle: eine andere Taste (annehmen,
// Note 16/1) meldet /e/taste, ruft aber kein ki_stopp.
// Fehlerfall: derselbe Test gegen die Mutation „Stopp nur melden“ (test_kern_stopp_mutation, WILL_FAIL).
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

int main() {
  Arbeitsbestand ab("test_kern_stopp");
  Lauf x(ab.pfad, "konfig/controller/softcontroller.json");
  x.zyklen(4 * N);
  // ein cypher-Teil läuft: deck/2/fader von Beat 1 über 8 Beats auf −20 dB
  const int64_t teil = x.teil("deck/2/fader", -20.0f, 1.0, 8.0, "cypher", "plan_a");
  x.zyklen(2 * SPB);
  PRUEF(!x.kern->ki_gestoppt());
  PRUEF(x.quittung(teil, 2) != nullptr);  // gestartet
  // Negativ-Kontrolle: taste/annehmen (Note 16/1): /e/taste, kein ki_stopp
  const int64_t t_an = 2 * SPB + 6 * N + 33;
  x.midi_bei(t_an, 0x9F, 1, 127);
  x.midi_bei(t_an + 10, 0x8F, 1, 0);
  x.zyklen(3 * SPB);
  PRUEF(!x.kern->ki_gestoppt());
  PRUEF(x.alle(cdj::Ereignis::KI).empty());
  {
    const auto t = x.alle(cdj::Ereignis::TASTE);
    PRUEF(t.size() == 1 && std::string(t[0].pfad) == "annehmen" && t[0].status == 1 && t[0].sample == t_an);
  }
  // Stopp-Taste (Note 16/0) bei Versatz 33 im Zyklus ab 3 SPB + 8 N (der Zyklus beginnt bei einem Vielfachen von 256)
  const int64_t s = 3 * SPB + 9 * N + 33;
  const int64_t s0 = s / N * N;
  x.midi_bei(s, 0x9F, 0, 127);
  x.midi_bei(s + 10, 0x8F, 0, 0);  // Loslassen
  x.zyklen(3 * SPB + 12 * N);
  PRUEF(x.kern->ki_gestoppt());
  const auto ki = x.alle(cdj::Ereignis::KI);
  PRUEF(ki.size() == 1 && ki[0].status == 1 && std::string(ki[0].grund) == "ki_stopp");
  PRUEF(!ki.empty() && ki[0].sample == s0);  // wirkt ab dem Anfang des Zyklus des Ereignisses, nicht am Versatz
  const Q* q = x.quittung(teil, 7);
  PRUEF(q != nullptr && q->grund == "ki_stopp" && q->sample == s0);
  const auto t = x.alle(cdj::Ereignis::TASTE);
  PRUEF(t.size() == 2 && std::string(t[1].pfad) == "stopp" && t[1].status == 1 && t[1].sample == s);
  // Loslassen: weder zweites ki_stopp noch /e/taste
  x.zyklen(4 * SPB);
  PRUEF(x.alle(cdj::Ereignis::KI).size() == 1 && x.alle(cdj::Ereignis::TASTE).size() == 2);
  // ein folgender cypher-Befehl wird abgelehnt (§4.7), Andreas' Hand am selben Regler wirkt weiter
  const int64_t nach = x.teil("deck/2/fader", -5.0f, 6.0, 1.0, "cypher", "plan_b");
  x.zyklen(5 * SPB);
  const Q* ab_q = x.quittung(nach, 6);
  PRUEF(ab_q != nullptr && ab_q->grund == "ki_gestoppt");
  std::printf("stopp: Taste bei Sample %lld, ki_stopp am Zyklusanfang %lld, cypher-Teil Quittung 7 ki_stopp bei %lld, "
              "folgender cypher-Teil abgelehnt %s, /e/taste stopp und annehmen gemeldet\n",
              (long long)s, (long long)(ki.empty() ? -1 : ki[0].sample), (long long)(q ? q->sample : -1),
              ab_q ? ab_q->grund.c_str() : "?");
  // Zusatz 35: /test/hand taste/<name> (Annahme-Weg der Oberfläche) wirkt wie die Hardware-Taste: /e/taste name wert sample beat
  Lauf y(ab.pfad, "konfig/controller/softcontroller.json");
  y.zyklen(6 * N);
  y.test_hand("taste/annehmen", 1.0f, 7 * N + 5);
  y.test_hand("taste/annehmen", 0.0f, 7 * N + 50);  // Loslassen: nichts
  y.zyklen(9 * N);
  {
    const auto t = y.alle(cdj::Ereignis::TASTE);
    PRUEF(t.size() == 1 && std::string(t[0].pfad) == "annehmen" && t[0].status == 1 && t[0].sample == 7 * N + 5);
    PRUEF(!y.kern->ki_gestoppt());
    std::printf("test_hand: taste/annehmen -> /e/taste annehmen 1 bei Sample %lld, Loslassen ohne Meldung\n",
                t.empty() ? -1LL : (long long)t[0].sample);
  }
  y.test_hand("taste/stopp", 1.0f, 10 * N + 3);
  y.zyklen(12 * N);
  PRUEF(y.kern->ki_gestoppt());  // wie die Stopp-Taste des Controllers
  const auto tt = y.alle(cdj::Ereignis::TASTE);
  PRUEF(tt.size() == 2 && std::string(tt[1].pfad) == "stopp");
  PRUEF_ENDE();
}
