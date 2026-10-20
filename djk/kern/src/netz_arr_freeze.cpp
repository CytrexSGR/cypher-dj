// Paket K3 (Spec D1 2.5, 3.1, 6.14, 6.25, 6.27, 6.29; SCHNITTSTELLEN §4.11, §5.13): Freeze im Netz-Faden. /k/arr/freeze
// prüft die Felder (im KI-Stopp lehnt cypher zuerst ab, vor jeder Bereichsprüfung, §4.7) und reiht einen Auftrag zum
// Arrangement-Lade-Faden; der legt ihn samt Puffer an (arr_lader.h), sein Ergebnis geht als Befehl ARR_FREEZE in den
// Kern. Ob und wann er läuft, entscheidet der Kern am Sample. Zurück kommt er als Ereignis ARR_FREEZE und geht an den
// Lade-Faden: der schreibt bei Status 0 die Datei <arr_ordner>/freeze-<spur>-<kennung>.f32 (nie ersetzend) und gibt den
// Puffer frei; seine Meldung wird /e/freeze (0 fertig, 1 abgebrochen, 2 Datei nicht geschrieben). Ein abgelehnter Auftrag
// (Quittung 6 kam vom Kern) wird nur freigegeben. Der Netz-Faden legt keinen Puffer an und schreibt keine Datei: bei 256
// Beats stünden sonst /uhr und jede OSC-Antwort 27 bis 100 ms still (Spec 6.29, test_netz_arr_freeze_uhr).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

bool quelle_ok(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

}  // namespace

bool Netz::arr_freeze_paket(const osc::Nachricht& m) {
  namespace f = v::feld::k_arr_freeze;
  ArrAuftrag a{};
  a.art = ArrAuftrag::FREEZE;
  a.id = m.werte[f::id].h;
  kopiere(a.quelle, m.werte[f::quelle].s, sizeof a.quelle);
  a.spur = m.werte[f::spur].i;
  a.kennung = m.werte[f::kennung].i;
  a.von_beat = m.werte[f::von_beat].d;
  a.bis_beat = m.werte[f::bis_beat].d;
  auto ab = [&](const char* grund) {
    quittung(a.id, a.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  if (!quelle_ok(a.quelle)) return ab("ausserhalb_bereich");
  if (!std::strcmp(a.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7, Spec 6.27; der Kern prüft noch einmal
  const double von = a.von_beat, bis = a.bis_beat;
  if (a.spur < 1 || a.spur > ARR_SPUREN || !std::isfinite(von) || !std::isfinite(bis) || von < 0.0 || !(bis - von >= 1.0) ||
      bis - von > ARR_FREEZE_MAX_BEATS || a.kennung < 0)
    return ab("ausserhalb_bereich");
  if (arr_ordner_.empty() || !arr_ringe_) {
    std::fprintf(stderr, "/k/arr/freeze: kein Arbeitsordner oder kein Arrangement-Lader\n");
    return ab("datei_fehlt");
  }
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_ANLEGEN_IM_NETZ
  // Fehlerfall (Spec 6.29, Fix L4 getrennt vom Schreiben): der Netz-Faden legt den Puffer selbst an (bei 256 Beats rund
  // 99 MB) und reiht ihn sofort ein; die Rückgabe geht wie sonst an den Lade-Faden
  char grund[32] = {};
  ArrFreeze* fz = freeze_anlegen(a, grund, sizeof grund);
  if (!fz) return ab(grund);
  Befehl b{};
  b.art = Befehl::ARR_FREEZE;
  b.id = a.id;
  std::memcpy(b.quelle, a.quelle, sizeof b.quelle);
  b.nr = a.spur;
  b.zeiger = fz;
  if (!einreihen(b)) delete fz;
  return true;
#else
  if (!arr_ringe_->auftraege.schiebe(a))
    quittung(a.id, a.quelle, 4, stand_sample_, stand_beat_, "zu_spaet");   // 16 Aufträge offen: der Lader hängt
  return true;
#endif
}

void Netz::arr_freeze_ergebnis(const ArrErgebnis& e) {
  if (!e.freeze) {   // nicht anlegbar (zu_gross) oder Ergebnisring zu lange voll (zu_spaet, /q 4)
    quittung(e.auftrag.id, e.auftrag.quelle, std::strcmp(e.grund, "zu_spaet") ? 6 : 4, stand_sample_, stand_beat_, e.grund);
    return;
  }
  Befehl b{};
  b.art = Befehl::ARR_FREEZE;
  b.id = e.auftrag.id;
  std::memcpy(b.quelle, e.auftrag.quelle, sizeof b.quelle);
  b.nr = e.auftrag.spur;
  b.zeiger = e.freeze;
  if (!einreihen(b)) {   // einreihen hat zu_spaet gemeldet; der Auftrag geht zur Freigabe zurück
    e.freeze->status = ARR_FREEZE_ABGELEHNT;
    arr_freeze_zurueck(e.freeze);
  }
}

void Netz::arr_freeze_ereignis(const Ereignis& e) {
  auto* f = static_cast<ArrFreeze*>(const_cast<void*>(e.zeiger));
  if (!f) return;
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_SCHREIBEN_IM_NETZ
  // Fehlerfall (Spec 6.29, Fix L4 getrennt vom Anlegen): der Netz-Faden schreibt die Datei selbst und gibt den Puffer frei
  // (bei 256 Beats und 60 BPM rund 99 MB); angelegt hat ihn wie sonst der Lade-Faden
  std::unique_ptr<ArrFreeze> eigen(f);
  if (e.status == ARR_FREEZE_ABGELEHNT) return;
  ArrFreezeMeldung m{f->spur, f->kennung, e.status == 0 ? 0 : 1, 0};
  std::string fehler;
  if (e.status == 0) {
    if (schreibe_freeze(arr_ordner_, *f, fehler)) m.frames = f->frames;
    else m.status = 2;
  }
  arr_freeze_melden(m);
#else
  f->status = e.status;   // 0 fertig, 1 abgebrochen, ARR_FREEZE_ABGELEHNT: der Lade-Faden schreibt oder gibt nur frei
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_ABBRUCH_SCHREIBT
  if (f->status == 1) f->status = 0;   // Fehlerfall: auch ein abgebrochener Freeze wird Datei
#endif
  arr_freeze_zurueck(f);
#endif
}

void Netz::arr_freeze_zurueck(ArrFreeze* f) {
  if (!arr_ringe_) {   // ohne Lade-Faden (nur Tests ohne verbinde_arr): hier freigeben
    delete f;
    return;
  }
  for (int i = 0; i < 1000; ++i) {   // der Lade-Faden leert je Durchgang; steht er, nach 1 s melden (Leck statt Absturz)
    if (arr_ringe_->freeze_zurueck.schiebe(f)) return;
    usleep(1000);
  }
  std::fprintf(stderr, "Arrangement: Rückgabe-Ring voll, Freeze Spur %d Kennung %d nicht freigegeben\n", f->spur,
               f->kennung);
}

void Netz::arr_freeze_melden(const ArrFreezeMeldung& m) {
  osc::Schreiber s(v::e_freeze);
  s.i(m.spur).i(m.kennung).i(m.status).h(m.status == 0 ? m.frames : 0);
  an_alle(s);
}

}  // namespace cdj
