// D1 K1 (Spec D1 2.1, 3.1; INTERFACES §4.11, §5.13): Arrangement im Netz-Faden. /k/arr/laden prüft nur die Anfrage
// und reiht einen Auftrag zum Arrangement-Lade-Faden (arr_loader.h); dessen Ergebnis geht als Befehl ARR_LADEN mit dem
// Schnappschuss in den Callback oder als /q Status 6 mit Grund zurück. start, stopp, loop und metronom gehen nach der
// Bereichsprüfung als Befehl durch. Im KI-Stopp lehnt cypher (außer stopp) vor der Bereichsprüfung ab (§4.7). Abgelöste Schnappschüsse (ARR_ALT) gehen an den Lade-Faden zur Freigabe zurück.
// /k/arr/freeze: Paket K3 (net_arr_freeze.cpp).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "cypherdj/net.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

// 1.12 S3: the field names are the generated list v::werte::auto_ziel, the index is the field (Arrangement::AUTO_FELDER)
static_assert(v::werte::auto_ziel.size() == Arrangement::AUTO_FELDER, "one name per overridable field");

int auto_feld(const char* n) {
  for (size_t i = 0; i < v::werte::auto_ziel.size(); ++i)
    if (v::werte::auto_ziel[i] == n) return static_cast<int>(i);
  return -1;
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
  const bool metronom = a->pfad == v::k_arr_metronom.pfad, auto_ = a->pfad == v::k_arr_auto.pfad, arm = a->pfad == v::k_arr_arm.pfad;
  if (a->pfad == v::k_arr_freeze.pfad) return arr_freeze_paket(m);    // Paket K3
  if (a->pfad == v::k_arr_abgriff.pfad) return arr_abgriff_paket(m);  // 1.10 slice 7
  if (!laden && !start && !stopp && !loop && !metronom && !auto_ && !arm) return false;
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
  } else if (auto_) {   // 1.12 S3 (§4.11): the lane override. Order of the refusals: format, auto_ziel_unbekannt, format (spur 0 with an 0), nur_andreas
    namespace f = v::feld::k_arr_auto;
    b.art = Befehl::ARR_AUTO;
    b.nr = m.werte[f::spur].i;
    b.an = m.werte[f::an].i;
    b.politik = auto_feld(m.werte[f::ziel].s);
    if (b.nr < 0 || b.nr > ARR_SPUREN || (b.an != 0 && b.an != 1)) return ab("format");
    if (b.politik < 0) return ab("auto_ziel_unbekannt");
    if (b.nr == 0 && b.an == 0) return ab("format");
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT   // error case: the net thread lets cypher override
    if (b.an == 0 && !std::strcmp(b.quelle, "cypher")) return ab("nur_andreas");   // D9
#endif
  } else if (arm) {   // 1.12 S3 (§4.11 /k/arr/arm). Order of the refusals: format, nur_andreas (cypher in the AI stop is refused above, before any range check)
    namespace f = v::feld::k_arr_arm;
    b.art = Befehl::ARR_ARM;
    b.nr = m.werte[f::spur].i;
    b.an = m.werte[f::an].i;
    b.politik = m.werte[f::modus].i;
    if (b.nr < 0 || b.nr > ARR_SPUREN || (b.an != 0 && b.an != 1) || b.politik < 0 || b.politik > 2) return ab("format");
    if (b.nr == 0 && b.an == 1) return ab("format");   // spur 0 only disarms
#ifndef CYPHERDJ_MUTATION_ARR_ARM_CYPHER   // error case: any source may arm
    if (std::strcmp(b.quelle, "andreas")) return ab("nur_andreas");   // D11
#endif
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
  ArrAbgriffMeldung am;
  while (arr_ringe_->abgriff_meldungen.hole(am)) arr_abgriff_melden(am);   // 1.10 slice 7: /e/abgriff
  while (arr_ringe_->ergebnisse.hole(e)) {
    if (e.auftrag.art == ArrAuftrag::FREEZE) {   // Paket K3: angelegter Freeze-Auftrag oder Ablehnung
      arr_freeze_ergebnis(e);
      continue;
    }
    if (e.auftrag.art == ArrAuftrag::ABGRIFF) {   // 1.10 slice 7
      arr_abgriff_ergebnis(e);
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
  if (e.art == Ereignis::ARR_ABGRIFF) {   // 1.10 slice 7: to the load thread (file, free), /e/abgriff follows from there
    arr_abgriff_ereignis(e);
    return true;
  }
  if (e.art == Ereignis::AUTO_ZUSTAND) {   // 1.12 S3, §5.13 /e/auto: spur, ziel, zustand
    if (e.deck < 1 || e.deck > ARR_SPUREN || e.fassung < 0 || e.fassung >= Arrangement::AUTO_FELDER) return true;   // not a field of the contract: dropped, never mapped to another
    osc::Schreiber s(v::e_auto);
    s.i(e.deck).s(std::string(v::werte::auto_ziel[static_cast<size_t>(e.fassung)]).c_str()).i(e.status);   // deck is the OSC track already
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::AUTO_PUNKT) {   // 1.12 S3, §5.13 /e/auto_punkt: pfad, projekt_beat, wert
    osc::Schreiber s(v::e_auto_punkt);
    s.s(e.pfad).d(e.beat).f(e.wert);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::WARP_ZUSTAND) {   // 1.13 Slice 2, §5.13b
    osc::Schreiber s(v::zustand_warp);
    s.i(e.warp_stimmen).i(e.warp_unterlauf).i(e.warp_kein_platz).i(e.warp_spaet).i(e.warp_faeden);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::SPUR_ZUSTAND) {   // mehrkern slice 3.2 task 7, §5.13
    osc::Schreiber s(v::zustand_spur_pool);
    s.i(e.spur_an).i(e.spur_modus).i(e.spur_blocks_parallel).i(e.spur_einheiten_worker).i(e.spur_einheiten_caller).i(e.spur_seriell).i(e.spur_haengt).i(e.spur_spaet).i(e.spur_zurueck);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::HALL_ZUSTAND) {   // mehrkern Task 5, §5.13
    osc::Schreiber s(v::zustand_hall_pool);
    s.i(e.hall_an).i(e.hall_faeden).i(e.hall_spaet).i(e.hall_zurueck);
    an_alle(s);
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
