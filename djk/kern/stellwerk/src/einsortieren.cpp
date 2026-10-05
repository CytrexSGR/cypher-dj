// Stellwerk-RT: Einsortieren von /k/teil (§4.3, §16.1, §17 I4) und /k/abbruch.
#include <cmath>
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

namespace {

// §17 I4, ausgelegt wie die Herleitung der Golden-Folgen (Scheibe 09, herleitung.py `i4_ueberlappt`): Rampen als
// [ab, ab + dauer), Setzen als Punkt. Zwei Setzen am selben Beat überlappen. Setzen und Rampe am selben Beat nur,
// wenn das Setzen zuerst angewandt wird (§17 „Reihenfolge nach Teil-Nummer“): im selben Plan die kleinere Nummer;
// gegen einen anderen Plan gilt der schon angenommene Teil als früher (Startfolge nach Plan, ablauf.cpp).
// Teile ohne Plan zählen je als eigener Plan (Festlegung F4).
bool ueberlappt(double x0, double xd, int32_t x_nr, double a0, double ad, int32_t a_nr) {
  if (xd > 0 && ad > 0) return (x0 > a0 ? x0 : a0) < (x0 + xd < a0 + ad ? x0 + xd : a0 + ad);
  if (xd == 0 && ad == 0) return x0 == a0;
  if (ad == 0) {   // neu: Setzen, schon da: Rampe
    if (a0 == x0) return a_nr > x_nr;
    return x0 < a0 && a0 < x0 + xd;
  }
  // neu: Rampe, schon da: Setzen
  if (a0 == x0) return x_nr > a_nr;
  return a0 < x0 && x0 < a0 + ad;
}

}  // namespace

void Stellwerk::teil(const TeilBefehl& b) {
  const int64_t jetzt = jetzt_;
  auto ablehnen = [&](Grund g) { quittung_befehl(b.id, b.quelle, Status::abgelehnt, jetzt, g); };
  if (b.quelle == Quelle::cypher && ki_gestoppt_) return ablehnen(Grund::ki_gestoppt);
  const int r = tab_.suche(b.pfad ? b.pfad : "");
  if (r < 0 || tab_.def(r).transport) return ablehnen(Grund::unbekannter_regler);
  const ReglerDef& d = tab_.def(r);
  if (d.nur_hand && b.quelle != Quelle::andreas) return ablehnen(Grund::nur_hand);
  if (d.deck > 0 && !stems_[d.deck]) return ablehnen(Grund::keine_stems);
  const bool form_ok = b.form == 0 || b.form == 1;
  const bool politik_ok = b.politik == 0 || b.politik == 1;   // §4.3 Feld 10: 2 ist hier nicht erlaubt
  const bool zahl_ok = std::isfinite(b.ab_beat) && std::isfinite(b.dauer_beats) && std::isfinite(b.nach) && b.dauer_beats >= 0;
  const bool bereich_ok = zahl_ok && b.nach >= d.min && b.nach <= d.max && (!d.ganzzahlig || b.nach == std::round(b.nach)) &&
                          (!d.keine_rampe || b.dauer_beats == 0.0);
  if (!form_ok || !politik_ok || !bereich_ok) return ablehnen(Grund::ausserhalb_bereich);
  const int64_t ziel = sample_von(uhr_, b.ab_beat);
  bool verspaetet = false;
  if (ziel < jetzt) {
    if (b.politik == 0) {   // §16.1: musik -> verworfen
      quittung_befehl(b.id, b.quelle, Status::verspaetet_verworfen, jetzt, Grund::zu_spaet);
      return;
    }
    verspaetet = true;      // zustand -> am nächsten Zyklus
  }
  // §17 I4: gegen jeden angenommenen (wartenden oder laufenden) Teil am selben Regler, auch im selben Plan
  const char* plan = b.plan ? b.plan : "";
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& x = teil_[j];
    if (!x.belegt || x.regler != r) continue;
    const bool gleicher_plan = plan[0] && std::strcmp(x.plan, plan) == 0;
    if (ueberlappt(x.ab_beat, x.dauer_beats, gleicher_plan ? x.nr : -1, b.ab_beat, b.dauer_beats, b.nr))
      return ablehnen(Grund::ueberlappung);
  }
  const int idx = neuer_teil();
  if (idx < 0) {
    z_.teile_voll++;
    return ablehnen(Grund::ausserhalb_bereich);
  }
  Teil& t = teil_[idx];
  t.status = Status::angenommen;
  t.id = b.id;
  t.quelle = b.quelle;
  std::snprintf(t.plan, TEXT, "%s", plan);
  std::snprintf(t.gruppe, TEXT, "%s", b.gruppe ? b.gruppe : "");
  std::snprintf(t.hoerschein, TEXT, "%s", b.hoerschein ? b.hoerschein : "");
  t.nr = b.nr;
  t.regler = static_cast<int16_t>(r);
  t.ab_beat = b.ab_beat;
  t.dauer_beats = b.dauer_beats;
  t.nach = b.nach;
  t.form = static_cast<uint8_t>(b.form);
  t.politik = static_cast<uint8_t>(b.politik);
  t.verspaetet = verspaetet;
  t.seq = ++seq_;
  t.plan_seq = t.seq;
  if (t.plan[0]) {
    for (int j = 0; j < MAX_TEILE; j++) {
      const Teil& x = teil_[j];
      if (j != idx && x.belegt && std::strcmp(x.plan, t.plan) == 0 && x.plan_seq < t.plan_seq) t.plan_seq = x.plan_seq;
    }
  }
  t.start_sample = verspaetet ? jetzt : ziel;
  quittung(t, Status::angenommen, jetzt, Grund::kein);
}

// /k/abbruch (§4.3): laufende Teile halten am Ist-Wert, wartende entfallen, je samt Gruppe (§4.4). Ohne Plan ("")
// nur Teile ohne Plan derselben Quelle (Festlegung F5).
void Stellwerk::abbruch(int64_t id, Quelle quelle, const char* plan, const int32_t* nrs, int anzahl) {
  const char* p = plan ? plan : "";
  quittung_befehl(id, quelle, Status::angenommen, jetzt_, Grund::kein);
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& t = teil_[j];
    if (!t.belegt || t.intern || std::strcmp(t.plan, p) != 0) continue;
    if (!p[0] && t.quelle != quelle) continue;
    bool gemeint = anzahl < 0;
    for (int k = 0; !gemeint && k < anzahl; k++) gemeint = nrs[k] == t.nr;
    if (gemeint) beenden_mit_gruppe(j, Status::abgebrochen, Grund::abbruch, jetzt_, HalterArt::frei);
  }
  quittung_befehl(id, quelle, Status::fertig, jetzt_, Grund::kein);
}

}  // namespace cypherdj::stellwerk
