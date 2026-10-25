// D1 K1 (Spec D1 2.1, 3.1; SCHNITTSTELLEN §4.11, §5.13): Arrangement im Netz-Faden. /k/arr/laden prüft nur die Anfrage
// und reiht einen Auftrag zum Arrangement-Lade-Faden (arr_lader.h); dessen Ergebnis geht als Befehl ARR_LADEN mit dem
// Schnappschuss in den Callback oder als /q Status 6 mit Grund zurück. start, stopp, loop und metronom gehen nach der
// Bereichsprüfung als Befehl durch. Im KI-Stopp lehnt cypher (außer stopp) vor der Bereichsprüfung ab (§4.7). Abgelöste Schnappschüsse (ARR_ALT) gehen an den Lade-Faden zur Freigabe zurück.
// /k/arr/freeze: Paket K3 (netz_arr_freeze.cpp).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>

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

bool Netz::arr_paket(const v::Adresse* a, const osc::Nachricht& m) {
  const bool laden = a->pfad == v::k_arr_laden.pfad, start = a->pfad == v::k_arr_start.pfad;
  const bool stopp = a->pfad == v::k_arr_stopp.pfad, loop = a->pfad == v::k_arr_loop.pfad;
  const bool metronom = a->pfad == v::k_arr_metronom.pfad;
  if (a->pfad == v::k_arr_freeze.pfad) return arr_freeze_paket(m);    // Paket K3
  if (!laden && !start && !stopp && !loop && !metronom) return false;
  Befehl b{};
  b.id = m.werte[0].h;
  kopiere(b.quelle, m.werte[1].s, sizeof b.quelle);
  auto ab = [&](const char* grund) {
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
#ifndef CYPHERDJ_MUTATION_ARR_KI_NACH_BEREICH
  // §4.7, D1 Spec 2.12/6.27 (K1-Fix-2 Punkt 2): im KI-Stopp lehnt jeder arr-Befehl von cypher außer /k/arr/stopp zuerst
  // ab, vor jeder Bereichsprüfung, wie die Attrappe. Stand des Netzes ist das letzte /e/ki; der Kern prüft noch einmal.
  if (!stopp && !std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");
#endif
  if (laden) {
    const int32_t nr = m.werte[v::feld::k_arr_laden::nr].i;
    if (nr < 0) return ab("ausserhalb_bereich");
#ifdef CYPHERDJ_MUTATION_ARR_KI_NACH_BEREICH
    if (!std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // Fehlerfall: erst der Bereich
#endif
    if (!arr_ringe_) {
      std::fprintf(stderr, "/k/arr/laden: kein Arrangement-Lader verbunden\n");
      return ab("datei_fehlt");
    }
    ArrAuftrag au{};
    au.id = b.id;
    std::memcpy(au.quelle, b.quelle, sizeof au.quelle);
    au.nr = nr;
    if (!arr_ringe_->auftraege.schiebe(au)) {
      quittung(b.id, b.quelle, 4, stand_sample_, stand_beat_, "zu_spaet");   // 16 Aufträge offen: der Lader hängt
      return true;
    }
#ifdef CYPHERDJ_MUTATION_ARR_NETZ_WARTET
    for (int i = 0; i < 10000 && arr_ringe_->ergebnisse.belegt() == 0; ++i) usleep(1000);   // Fehlerfall: Netz wartet aufs Laden
#endif
    return true;
  }
  if (start) {
    b.art = Befehl::ARR_START;
    b.ab_beat = m.werte[v::feld::k_arr_start::start_beat].d;
    b.politik = m.werte[v::feld::k_arr_start::quant].i;
    if (!(b.ab_beat >= 0.0) || !std::isfinite(b.ab_beat) || b.politik < 0 || b.politik > 2) return ab("ausserhalb_bereich");
  } else if (stopp) {
    b.art = Befehl::ARR_STOPP;
    b.politik = m.werte[v::feld::k_arr_stopp::quant].i;
    if (b.politik < 0 || b.politik > 2) return ab("ausserhalb_bereich");
  } else if (loop) {
    namespace f = v::feld::k_arr_loop;
    b.art = Befehl::ARR_LOOP;
    b.an = m.werte[f::an].i;
    b.arr_von = m.werte[f::von_beat].d;
    b.arr_bis = m.werte[f::bis_beat].d;
    if ((b.an != 0 && b.an != 1) || !std::isfinite(b.arr_von) || !std::isfinite(b.arr_bis) || b.arr_von < 0.0 ||
        b.arr_bis - b.arr_von < 1.0)
      return ab("ausserhalb_bereich");
  } else {
    namespace f = v::feld::k_arr_metronom;
    b.art = Befehl::ARR_METRONOM;
    b.an = m.werte[f::an].i;
    b.wert = m.werte[f::pegel_db].f;
    b.nr = m.werte[f::ziel].i;
    if ((b.an != 0 && b.an != 1) || !(b.wert >= -60.0f && b.wert <= 0.0f) || b.nr < 0 || b.nr > 1)
      return ab("ausserhalb_bereich");
  }
  einreihen(b);
  return true;
}

void Netz::arr_zurueck(ArrSnapshot* s) {
  if (!s || !arr_ringe_) return;
  for (int i = 0; i < 1000; ++i) {   // der Lade-Faden leert je Durchgang; steht er, nach 1 s melden (Leck statt Absturz)
    if (arr_ringe_->rueckgabe.schiebe(s)) return;
    usleep(1000);
  }
  std::fprintf(stderr, "Arrangement: Rückgabe-Ring voll, Wiedergabe %lld nicht freigegeben\n", (long long)s->nr);
}

void Netz::arr_zyklus() {
  if (!arr_ringe_) return;
  ArrErgebnis e;
  ArrFreezeMeldung fm;
  while (arr_ringe_->freeze_meldungen.hole(fm)) arr_freeze_melden(fm);   // Paket K3: /e/freeze
  while (arr_ringe_->ergebnisse.hole(e)) {
    if (e.auftrag.art == ArrAuftrag::FREEZE) {   // Paket K3: angelegter Freeze-Auftrag oder Ablehnung
      arr_freeze_ergebnis(e);
      continue;
    }
    if (!e.snap) {   // K1-Fix 9: zu_spaet (der Ergebnisring war voll) ist Status 4 wie ein voller Auftragsring
      quittung(e.auftrag.id, e.auftrag.quelle, std::strcmp(e.grund, "zu_spaet") ? 6 : 4, stand_sample_, stand_beat_, e.grund);
      continue;
    }
    Befehl b{};
    b.art = Befehl::ARR_LADEN;
    b.id = e.auftrag.id;
    std::memcpy(b.quelle, e.auftrag.quelle, sizeof b.quelle);
    b.arr_nr = e.auftrag.nr;
    b.zeiger = e.snap;
    if (!einreihen(b)) arr_zurueck(e.snap);   // einreihen hat zu_spaet gemeldet
  }
}

bool Netz::arr_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::ARR_ALT) {
    arr_zurueck(static_cast<ArrSnapshot*>(const_cast<void*>(e.zeiger)));
    return true;
  }
  if (e.art == Ereignis::ARR_FREEZE) {   // Paket K3: an den Lade-Faden (Datei, Freigabe), /e/freeze folgt von dort
    arr_freeze_ereignis(e);
    return true;
  }
  if (e.art != Ereignis::ARR_ZUSTAND) return false;
  osc::Schreiber s(v::zustand_arr);
  s.i(static_cast<int32_t>(e.arr_nr)).i(e.arr_status).i(e.arr_loop_an).d(e.arr_beat).h(e.arr_ursprung)
      .d(e.arr_start_beat).i(e.arr_metronom_an).f(e.arr_limiter_db);
  an_alle(s);
  return true;
}

}  // namespace cdj
