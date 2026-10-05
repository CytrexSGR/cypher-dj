// Scheibe 25: KI-Stopp, KI-Spur, KI-Stufe, Abbruch und /k/set/neu im Kern, offline über Kern::zyklus.
//  1. Die Golden-Folge ki_stopp (SCHNITTSTELLEN §19.3, §4.7) ohne Läufer: alle cypher-Teile ab (Grund ki_stopp), die
//     KI-Spur (deck/3) über 4 Beats auf −200, weitere cypher-Teile abgelehnt (ki_gestoppt), leitstand geht weiter
//     (Negativ-Kontrolle), /k/ki/frei nur von andreas.
//  2. /k/ki/stufe: Quittung 1 und 3, der Kern merkt die Stufe (LEDs ab Scheibe 35); Stufe 4 lehnt das Netz ab.
//  3. /k/abbruch (§4.3): der laufende Teil hält am Ist-Wert, der wartende entfällt; Formfehler in der Liste → 6.
//  4. /k/set/neu: offene Teile der alten Zeitachse enden mit Quittung 7 abbruch (Festlegung dieser Scheibe).
#include <cstdio>

#include "kern25.h"
#include "pruef.h"

using B = cdj::Befehl;

int main() {
  Kern25 k;
  k.hand("deck/3/fader", 0.0f, 45'000);  // erster Wert: nur Stellung
  k.hand("deck/3/fader", 1.0f, 67'500);  // Anschlag oben: 0 dB, Halter mensch
  k.bis(90'000);
  k.einfach(B::KI_SPUR, 2, "leitstand", "deck/3,erz/1");
  k.bis(540'000);
  k.teil(3, "cypher", "c1", 0, "deck/3/eq/hoch", 40.0, 16.0, -20.0f, 0, 0, "", "");
  k.teil(4, "cypher", "c1", 1, "deck/1/eq/mitte", 52.0, 8.0, -10.0f, 0, 0, "", "");
  k.teil(5, "leitstand", "l1", 0, "deck/1/filter", 40.0, 16.0, 0.5f, 0, 0, "", "");
  k.bis(1'080'000);
  k.einfach(B::KI_STOPP, 6, "andreas");
  k.bis(1'260'000);
  k.teil(7, "cypher", "c2", 0, "deck/1/eq/tief", 64.0, 0.0, -6.0f, 0, 0, "", "");
  k.teil(8, "leitstand", "l2", 0, "deck/1/eq/hoch", 64.0, 0.0, -3.0f, 0, 0, "", "");
  k.bis(1'500'000);
  k.einfach(B::KI_FREI, 11, "cypher");  // nur andreas darf
  k.bis(1'530'000);
  k.einfach(B::KI_FREI, 9, "andreas");
  k.bis(1'620'000);
  k.teil(10, "cypher", "c3", 0, "deck/1/eq/tief", 80.0, 0.0, -6.0f, 0, 0, "", "");
  k.einfach(B::KI_STUFE, 12, "leitstand", "", "", 2);
  k.bis(1'850'000);

  const cdj::Ereignis* q;
  bool halter_mensch = false, halter_frei = false;
  for (const auto& e : k.ev)
    if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "deck/3/fader")) {
      if (!std::strcmp(e.text, "mensch") && e.sample == 67'500) halter_mensch = true;
      if (!std::strcmp(e.text, "frei") && e.sample >= 787'500 && e.sample < 788'012) halter_frei = true;
    }
  PRUEF(halter_mensch && halter_frei);  // §7.3 Punkte 3 und 4
  PRUEF((q = k.q(2, 3)) && k.q(2, 6) == nullptr);
  PRUEF((q = k.q(3, 7)) && !std::strcmp(q->grund, "ki_stopp") && q->sample == 1'080'064);
  PRUEF((q = k.q(4, 7)) && !std::strcmp(q->grund, "ki_stopp"));
  PRUEF((q = k.q(6, 3)));
  int ki1 = 0, ki0 = 0;
  for (const auto& e : k.ev)
    if (e.art == cdj::Ereignis::KI) (e.status ? ki1 : ki0)++;
  PRUEF(ki1 == 1 && ki0 == 1);
  PRUEF_NAH(k.wert_bei("deck/3/fader", 1'125'000), -30.0, 0.7);  // KI-Spur über 4 Beats, ab −60 interpoliert
  PRUEF(k.wert_bei("deck/3/fader", 1'172'400) == -200.0);
  PRUEF_NAH(k.wert_bei("deck/3/eq/hoch", 1'215'000), -10.028, 0.03);  // hält am Ist-Wert
  PRUEF(std::isnan(k.wert_bei("deck/1/eq/mitte", 1'305'000)));        // wartender Teil entfiel: nie gemeldet
  PRUEF((q = k.q(5, 3)) && q->sample == 1'260'000);                   // leitstand fährt zu Ende
  PRUEF((q = k.q(7, 6)) && !std::strcmp(q->grund, "ki_gestoppt"));
  PRUEF((q = k.q(8, 2)) && q->sample == 1'440'000);
  PRUEF((q = k.q(11, 6)) && !std::strcmp(q->grund, "nur_hand"));
  PRUEF((q = k.q(9, 3)));
  PRUEF((q = k.q(10, 2)) && q->sample == 1'800'000);
  PRUEF(k.q(12, 1) && k.q(12, 3) && k.kern->ki_stufe() == 2);
  PRUEF(!k.kern->ki_gestoppt());

  // 3. /k/abbruch
  k.teil(20, "leitstand", "a1", 0, "deck/4/eq/tief", 90.0, 8.0, -20.0f, 0, 0, "", "");
  k.teil(21, "leitstand", "a1", 1, "deck/4/eq/mitte", 96.0, 0.0, -10.0f, 0, 0, "", "");
  k.bis(2'070'000);  // Beat 92: Teil 20 bei −5 dB
  k.einfach(B::ABBRUCH, 22, "leitstand", "0,,2", "a1");
  k.einfach(B::ABBRUCH, 23, "leitstand", "*", "a1");
  k.bis(2'300'000);
  PRUEF((q = k.q(22, 6)) && !std::strcmp(q->grund, "ausserhalb_bereich"));
  PRUEF(k.q(23, 1) && k.q(23, 3));
  PRUEF((q = k.q(20, 7)) && !std::strcmp(q->grund, "abbruch"));
  PRUEF((q = k.q(21, 7)) && !std::strcmp(q->grund, "abbruch"));
  PRUEF_NAH(k.wert_bei("deck/4/eq/tief", 2'250'000), -5.0, 0.02);
  PRUEF(std::isnan(k.wert_bei("deck/4/eq/mitte", 2'250'000)));

  // 4. /k/set/neu beendet offene Teile der alten Zeitachse
  k.teil(30, "leitstand", "s1", 0, "deck/1/trim", 200.0, 4.0, 3.0f, 0, 0, "", "");
  k.bis(2'310'000);
  PRUEF(k.kern->wartend() == 1);
  cdj::Befehl neu = k.neu(B::SET_NEU, 31, "pruefstand");
  neu.bpm = 128.0;
  k.bef->schiebe(neu);
  k.zyklus(256);  // /k/set/neu: danach steht der Kern auf Sample 256 der neuen Zeitachse
  k.bis(10'000);
  PRUEF((q = k.q(30, 7)) && !std::strcmp(q->grund, "abbruch"));
  PRUEF(k.kern->wartend() == 0 && k.q(31, 2));
  PRUEF_ENDE();
}
