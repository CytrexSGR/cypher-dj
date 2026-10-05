// Stellwerk-RT: KI-Stopp (§4.7, §7.3 Punkt 8, ADR 013). Wirkt im Kern, auch ohne Leitstand.
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::ki_stopp(int64_t id, Quelle quelle) {
  const int64_t s = jetzt_;
  quittung_befehl(id, quelle, Status::angenommen, s, Grund::kein);
  ki_gestoppt_ = true;
  // alle Teile mit Quelle cypher ab, samt Gruppe (Grund ki_stopp)
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& t = teil_[j];
    if (t.belegt && t.quelle == Quelle::cypher) beenden_mit_gruppe(j, Status::abgebrochen, Grund::ki_stopp, s, HalterArt::frei);
  }
  // Kanäle der KI-Spur über 4 Beats auf -200 (Festlegung: ein Fader, den Andreas hält, bleibt bei ihm)
  const double b0 = uhr_.beat(s);
  for (int k = 0; k < tab_.kanaele(); k++) {
    if (!(ki_spur_ & (1u << k))) continue;
    const int r = tab_.regler_von(k, Rolle::fader);
    if (r < 0) continue;
    ReglerZustand& z = reg_[r];
    if (z.halter.art == HalterArt::mensch || z.wert <= STUMM_GRENZE) continue;
    for (int j = 0; j < MAX_TEILE; j++) {
      const Teil& t = teil_[j];
      if (t.belegt && t.regler == r) beenden_mit_gruppe(j, Status::abgebrochen, Grund::ki_stopp, s, HalterArt::frei);
    }
    const int idx = neuer_teil();
    if (idx < 0) {
      z_.teile_voll++;
      continue;
    }
    Teil& t = teil_[idx];
    t.status = Status::angenommen;
    t.id = 0;
    t.quelle = quelle;
    t.nr = 0;
    t.regler = static_cast<int16_t>(r);
    t.ab_beat = b0;
    t.dauer_beats = KI_STOPP_BEATS;
    t.nach = STUMM;
    t.politik = 1;
    t.intern = true;
    t.seq = ++seq_;
    t.plan_seq = t.seq;
    t.start_sample = s;
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

void Stellwerk::ki_spur(int64_t id, Quelle quelle, const char* kanaele) {
  uint32_t neu = 0;
  const char* p = kanaele ? kanaele : "";
  char name[16];
  while (*p) {
    int n = 0;
    while (*p && *p != ',' && n < static_cast<int>(sizeof name) - 1) name[n++] = *p++;
    name[n] = 0;
    while (*p && *p != ',') p++;
    if (*p == ',') p++;
    if (n == 0) continue;
    const int k = tab_.kanal_suche(name);
    if (k < 0 || tab_.regler_von(k, Rolle::fader) < 0) {
      quittung_befehl(id, quelle, Status::abgelehnt, jetzt_, Grund::unbekannter_regler);
      return;
    }
    neu |= 1u << k;
  }
  quittung_befehl(id, quelle, Status::angenommen, jetzt_, Grund::kein);
  ki_spur_ = neu;
  quittung_befehl(id, quelle, Status::fertig, jetzt_, Grund::kein);
}

}  // namespace cypherdj::stellwerk
