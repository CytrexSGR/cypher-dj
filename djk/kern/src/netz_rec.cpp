// 1.8 Slice 1 (§4.12, §5.14): /k/rec/* im Netz-Faden. Prüft die Felder, legt den RecSpur an (Netz-Faden, nie der Callback), reiht den Befehl ein und
// gibt abgelöste RecSpur wieder frei (Ereignis REC_ALT). Die Meldung eines Takes (/e/aufnahme) kommt vom Aufnahme-Faden über seinen Ring.
#include <cstring>

#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

static_assert(v::bereich::k_rec_spur::spur_max == ARR_SPUREN && v::bereich::e_aufnahme::spur_max == ARR_SPUREN,
              "Vertrag (osc.json rec spur) und ARR_SPUREN laufen auseinander");

bool Netz::rec_paket(const v::Adresse* a, const osc::Nachricht& m) {
  const bool spur = a->pfad == v::k_rec_spur.pfad, start = a->pfad == v::k_rec_start.pfad, stopp = a->pfad == v::k_rec_stopp.pfad;
  if (!spur && !start && !stopp) return false;
  Befehl b{};
  b.id = m.werte[0].h;
  std::strncpy(b.quelle, m.werte[1].s, sizeof b.quelle - 1);
  auto ab = [&](const char* grund) { quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund); return true; };
  bool quelle_gut = false;
  for (const auto& n : v::werte::quelle) quelle_gut = quelle_gut || n == b.quelle;
  if (!quelle_gut) return ab("ausserhalb_bereich");
  if (!stopp && !std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7; Anhalten bleibt erlaubt
  if (spur) {
    namespace f = v::feld::k_rec_spur;
    const int32_t nr = m.werte[f::spur].i, scharf = m.werte[f::scharf].i, eingang = m.werte[f::eingang].i;
    if (nr < 1 || nr > ARR_SPUREN || (scharf != 0 && scharf != 1) || !(eingang == 0 || (eingang >= 11 && eingang <= 13) || eingang == 20))
      return ab("ausserhalb_bereich");
    if (scharf == 1 && eingang == 0) return ab("kein_eingang");
    if (scharf == 1 && eingang == 20) return ab("eingang_fehlt");   // Master vor dem Fader ist noch kein Abgriff
    if (!rec_faden_) return ab("datei_fehlt");
    b.art = Befehl::REC_SPUR;
    b.nr = nr; b.an = scharf; b.deck = eingang;
    if (scharf == 1) {
      RecSpur* p = RecSpur::neu(nr, eingang);
      if (!p) return ab("zu_gross");
      rec_faden_->anmelden(p);
      b.zeiger = p;
    }
    if (!einreihen(b)) {   // einreihen hat zu_spaet gemeldet
      if (b.zeiger) rec_alt_frei(static_cast<RecSpur*>(const_cast<void*>(b.zeiger)));
    }
    return true;
  }
  if (start) {
    namespace f = v::feld::k_rec_start;
    b.art = Befehl::REC_START;
    b.nr = m.werte[f::kennung].i;
    b.fassung = m.werte[f::nachlauf_samples].i;
    b.versatz_f = m.werte[f::frist_samples].i;
    if (b.nr < 0 || b.fassung < 0 || b.fassung > 480000) return ab("ausserhalb_bereich");
    if (!(b.versatz_f == 0 || (b.versatz_f >= REC_FRIST_MIN && b.versatz_f <= REC_FRIST_MAX))) return ab("ausserhalb_bereich");   // frist_samples (M1)
    einreihen(b);
    return true;
  }
  b.art = Befehl::REC_STOPP;
  einreihen(b);
  return true;
}

void Netz::rec_alt_frei(RecSpur* p) {
  if (!p) return;
  if (rec_faden_) rec_faden_->abmelden(p);
  RecSpur::frei(p);
}

void Netz::rec_melden(const TakeMeldung& t) {
  osc::Schreiber s(v::e_aufnahme);
  s.i(t.spur).i(t.kennung).i(t.status).h(t.status == 2 ? 0 : t.frames).h(t.start_s).i(t.luecken);
  an_alle(s);
}

void Netz::rec_zyklus() {
  if (!rec_faden_) return;
  TakeMeldung t;
  while (rec_faden_->hole_meldung(t)) rec_melden(t);
}

}  // namespace cdj
