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
  for (int k = 0; k < tab_.kanaele(); k++)
    if (ki_spur_ & (1u << k)) ki_fader_ab(tab_.regler_von(k, Rolle::fader), s, b0, quelle);
  // D1 K1 (Spec 2.3): die Spur-Fader der KI-Spur über die eigene Liste ebenso
  for (int n = 0; n < SPUR_REGLER_SPUREN; n++)
#ifdef CYPHERDJ_MUTATION_KI_OHNE_SPUR_ARR
    if (false && (ki_spur_arr_ & (1u << n))) ki_fader_ab(spur_fader_[n], s, b0, quelle);   // Fehlerfall: Spuren bleiben laut
#else
    if (ki_spur_arr_ & (1u << n)) ki_fader_ab(spur_fader_[n], s, b0, quelle);
#endif
  Ereignis* e = neues_ereignis(EreignisArt::ki, s);
  if (e) {
    e->gestoppt = true;
    e->grund = Grund::ki_stopp;
  }
  quittung_befehl(id, quelle, Status::fertig, s, Grund::kein);
}

void Stellwerk::ki_fader_ab(int r, int64_t s, double b0, Quelle quelle) {
  if (r < 0) return;
  ReglerZustand& z = reg_[r];
  if (z.halter.art == HalterArt::mensch || z.wert <= STUMM_GRENZE) return;
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& t = teil_[j];
    if (t.belegt && t.regler == r) beenden_mit_gruppe(j, Status::abgebrochen, Grund::ki_stopp, s, HalterArt::frei);
  }
  const int idx = neuer_teil();
  if (idx < 0) {
    z_.teile_voll++;
    return;
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

// D1 Spec 6.15: zwei Listen, die sich nicht gegenseitig löschen. Einträge spur/<ziffern> (spur/2, spur/135; spur/0 =
// keine Spur) ersetzen nur die Spur-Liste (S2 trägt Cyphers Spuren ein), Kanal-Einträge nur die Kanal-Liste (Leitstand).
// Eine leere Liste leert die Kanal-Liste (Bestand), eine gemischte ersetzt beide.
void Stellwerk::ki_spur(int64_t id, Quelle quelle, const char* kanaele) {
  uint32_t neu = 0;
  uint8_t neu_arr = 0;   // D1 K1: spur/<n>, n = 1..8
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
    if (std::strncmp(name, "spur/", 5) == 0) {
      bool gut = n > 5;
      if (n == 6 && name[5] == '0') {   // spur/0: keine Spur
        spuren_da = true;
        continue;
      }
      for (int i = 5; i < n && gut; i++) {
        gut = name[i] >= '1' && name[i] < '1' + SPUR_REGLER_SPUREN;
        if (gut) neu_arr |= static_cast<uint8_t>(1u << (name[i] - '1'));
      }
      if (!gut) {
        quittung_befehl(id, quelle, Status::abgelehnt, jetzt_, Grund::unbekannter_regler);
        return;
      }
      spuren_da = true;
      continue;
    }
    const int k = tab_.kanal_suche(name);
    if (k < 0 || tab_.regler_von(k, Rolle::fader) < 0) {
      quittung_befehl(id, quelle, Status::abgelehnt, jetzt_, Grund::unbekannter_regler);
      return;
    }
    neu |= 1u << k;
    kanaele_da = true;
  }
  quittung_befehl(id, quelle, Status::angenommen, jetzt_, Grund::kein);
#ifdef CYPHERDJ_MUTATION_KI_SPUR_ERSETZT_ALLES
  kanaele_da = spuren_da = true;   // Fehlerfall: jede Liste ersetzt beide, S2 und Leitstand löschen sich gegenseitig
#endif
  if (kanaele_da || !spuren_da) ki_spur_ = neu;   // leer oder mit Kanälen: Kanal-Liste
  if (spuren_da) ki_spur_arr_ = neu_arr;
  quittung_befehl(id, quelle, Status::fertig, jetzt_, Grund::kein);
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
  if (ki_spur_arr_) {
    if (w) haenge(",");
    haenge("spur/");
    for (int s = 0; s < SPUR_REGLER_SPUREN; s++) {
      const char z[2] = {static_cast<char>('1' + s), 0};
      if (ki_spur_arr_ & (1u << s)) haenge(z);
    }
  }
  aus[w] = 0;
}

}  // namespace cypherdj::stellwerk
