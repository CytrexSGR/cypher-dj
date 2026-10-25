// Stellwerk-RT: KI-Stopp (§4.7, §7.3 Punkt 8, ADR 013). Wirkt im Kern, auch ohne Leitstand.
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::ki_stopp(int64_t id, Quelle quelle) {
  const int64_t s = jetzt_;
  quittung_befehl(id, quelle, Status::angenommen, s, Grund::kein);
  ki_gestoppt_ = true;
  // Entscheidung E-a (2026-10-20): der Stopp hält nur Cyphers Hand an. Alle Teile mit Quelle cypher enden samt Gruppe (Grund ki_stopp), ein
  // laufender Teil hält am Ist-Wert (wie /k/abbruch); kein Fader wird gesenkt, die KI-Kanal-Liste (ki_spur) senkt nichts mehr.
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& t = teil_[j];
    if (t.belegt && t.quelle == Quelle::cypher) beenden_mit_gruppe(j, Status::abgebrochen, Grund::ki_stopp, s, HalterArt::frei);
  }
  Ereignis* e = neues_ereignis(EreignisArt::ki, s);
  if (e) {
    e->gestoppt = true;
    e->grund = Grund::ki_stopp;
  }
  quittung_befehl(id, quelle, Status::fertig, s, Grund::kein);
}

void Stellwerk::ki_frei(int64_t id, Quelle quelle) {
  if (quelle != Quelle::andreas) {   // §4.7: /k/ki/frei nur andreas
    quittung_befehl(id, quelle, Status::abgelehnt, jetzt_, Grund::nur_hand);
    return;
  }
  quittung_befehl(id, quelle, Status::angenommen, jetzt_, Grund::kein);
  ki_gestoppt_ = false;
  Ereignis* e = neues_ereignis(EreignisArt::ki, jetzt_);
  if (e) e->gestoppt = false;
  quittung_befehl(id, quelle, Status::fertig, jetzt_, Grund::kein);
}

// E3 P1 (D1 Spec 6.15 davor): Spuren stehen in keiner KI-Liste mehr. Von den Spur-Einträgen gilt nur spur/0 (keine Spur, S2 sendet
// seit E-a nur das); jede andere Spur-Angabe (spur/1, spur/135, spur/10) wird wie ein unbekannter Kanal abgelehnt. Kanal-Einträge
// ersetzen die Kanal-Liste (Leitstand); eine leere Liste leert sie, spur/0 allein lässt sie stehen.
// Rückgabe: true, wenn die Liste angenommen wurde (der Kern merkt sich nur dann die Kennung für den Neustart-Zustand).
bool Stellwerk::ki_spur(int64_t id, Quelle quelle, const char* kanaele) {
  uint32_t neu = 0;
  bool kanaele_da = false, spuren_da = false;
  const char* p = kanaele ? kanaele : "";
  char name[16];
  while (*p) {
    int n = 0;
    while (*p && *p != ',' && n < static_cast<int>(sizeof name) - 1) name[n++] = *p++;
    name[n] = 0;
    while (*p && *p != ',') p++;
    if (*p == ',') p++;
    if (n == 0) continue;
    if (std::strcmp(name, "spur/0") == 0) {   // spur/0: keine Spur
      spuren_da = true;
      continue;
    }
    const int k = tab_.kanal_suche(name);   // auch spur/<n> endet hier: kein Kanal, abgelehnt
    if (k < 0 || tab_.regler_von(k, Rolle::fader) < 0) {
      quittung_befehl(id, quelle, Status::abgelehnt, jetzt_, Grund::unbekannter_regler);
      return false;
    }
    neu |= 1u << k;
    kanaele_da = true;
  }
  quittung_befehl(id, quelle, Status::angenommen, jetzt_, Grund::kein);
#ifdef CYPHERDJ_MUTATION_KI_SPUR_ERSETZT_ALLES
  kanaele_da = spuren_da = true;   // Fehlerfall: spur/0 allein leert die Kanal-Liste, S2 löscht die Kanäle des Leitstands
#endif
  if (kanaele_da || !spuren_da) ki_spur_ = neu;   // leer oder mit Kanälen: Kanal-Liste
  quittung_befehl(id, quelle, Status::fertig, jetzt_, Grund::kein);
  return true;
}

void Stellwerk::ki_spur_text(char* aus, size_t n) const {
  if (n == 0) return;
  size_t w = 0;
  auto haenge = [&](const char* t) {
    while (*t && w + 1 < n) aus[w++] = *t++;
  };
  for (int k = 0; k < tab_.kanaele(); k++) {
    if (!(ki_spur_ & (1u << k))) continue;
    if (w) haenge(",");
    haenge(tab_.kanal_name(k));
  }
  aus[w] = 0;
}

}  // namespace cypherdj::stellwerk
