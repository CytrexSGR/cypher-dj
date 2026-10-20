// D1 K1: Arrangement-Lade-Faden (arr_lader.h). Muster Lader::einmal/laufen (lader.cpp). Paket K3: Freeze-Aufträge
// anlegen, beendete schreiben und freigeben (arr_freeze_datei.cpp).
#include "cypherdj/arr_lader.h"

#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/arrangement.h"
#include "cypherdj/kern.h"

namespace cdj {

ArrLader::ArrLader(std::string ordner, SpeicherKonto* konto, int64_t arr_budget_bytes, bool sperren)
    : ordner_(std::move(ordner)), cache_(konto, arr_budget_bytes, sperren) {}

// Paket K3: beendeter Freeze. Fertig: Datei schreiben (status 0, sonst 2); abgebrochen: keine Datei (1); abgelehnt
// (Quittung 6 kam vom Kern): nur freigeben. Die Meldung geht an das Netz (/e/freeze), der Puffer wird hier frei.
void ArrLader::freeze_fertig(ArrLaderRinge& r, ArrFreeze* roh) {
  std::unique_ptr<ArrFreeze> f(roh);
  if (!f || f->status == ARR_FREEZE_ABGELEHNT) return;
  ArrFreezeMeldung m{f->spur, f->kennung, f->status == 0 ? 0 : 1, 0};
  if (f->status == 0) {
    std::string fehler;
    bool besteht = false;
    if (schreibe_freeze(ordner_, *f, fehler, &besteht)) {
      m.frames = f->frames;
      std::fprintf(stderr, "Arrangement: Freeze Spur %d Kennung %d geschrieben, %lld Frames\n", f->spur, f->kennung,
                   (long long)f->frames);
    } else {
      m.status = 2;
      std::fprintf(stderr, "Arrangement: Freeze nicht geschrieben (%s): %s\n", besteht ? "Datei besteht schon" : "Fehler",
                   fehler.c_str());
    }
  }
  for (int versuche = 0; !r.freeze_meldungen.schiebe(m); ++versuche) {   // höchstens ein Freeze läuft: kommt nicht vor
    if (versuche > 1000) {
      std::fprintf(stderr, "Arrangement: Meldering voll, /e/freeze Spur %d Kennung %d verloren\n", m.spur, m.kennung);
      break;
    }
    usleep(1000);
  }
}

bool ArrLader::einmal(ArrLaderRinge& r) {
  bool arbeit = false;
  ArrSnapshot* alt = nullptr;
  while (r.rueckgabe.hole(alt)) {
    gib_wiedergabe(alt, cache_);
    arbeit = true;
  }
  ArrFreeze* fz = nullptr;
  while (r.freeze_zurueck.hole(fz)) {   // Paket K3
    freeze_fertig(r, fz);
    arbeit = true;
  }
  if (wartet_) {   // K1-Fix 9: ein Ergebnis wartet auf Platz; erst danach ein neuer Auftrag
    if (!r.ergebnisse.schiebe(wartend_)) return arbeit;
    wartet_ = false;
    arbeit = true;
  }
  ArrAuftrag a;
  if (!r.auftraege.hole(a)) return arbeit;
  ArrErgebnis e{};
  e.auftrag = a;
  if (a.art == ArrAuftrag::FREEZE) {   // Paket K3 (Spec 6.29): Auftrag samt Puffer hier, nicht im Netz-Faden
    e.freeze = freeze_anlegen(a, e.grund, sizeof e.grund);
    if (!e.freeze)
      std::fprintf(stderr, "Arrangement: Freeze Spur %d abgelehnt (%s)\n", a.spur, e.grund);
  } else if (ArrLadeErgebnis l = lade_wiedergabe(ordner_, a.nr, cache_); l.snap) {
    e.snap = l.snap.release();
    std::fprintf(stderr, "Arrangement: Wiedergabe %lld geladen, %lld MiB Audio gesperrt\n", (long long)a.nr,
                 (long long)(cache_.gesperrt() >> 20));
  } else {
    std::snprintf(e.grund, sizeof e.grund, "%s", l.grund.c_str());
    std::fprintf(stderr, "Arrangement: Wiedergabe %lld abgelehnt (%s): %s\n", (long long)a.nr, l.grund.c_str(),
                 l.meldung.c_str());
  }
  for (int versuche = 0; !r.ergebnisse.schiebe(e); ++versuche) {   // das Netz leert je Runde; steht es, nach 1 s aufgeben
    if (versuche > 1000) {
      std::fprintf(stderr, "Arrangement: Ergebnisring voll, Wiedergabe %lld verworfen (zu_spaet)\n", (long long)a.nr);
      gib_wiedergabe(e.snap, cache_);
      delete e.freeze;   // Paket K3
      e.freeze = nullptr;
#ifndef CYPHERDJ_MUTATION_ARR_ERGEBNIS_VERWORFEN
      // die id endet trotzdem genau einmal: als Fehler zu_spaet (/q 4 im Netz), sobald der Ring Platz hat
      e.snap = nullptr;
      std::snprintf(e.grund, sizeof e.grund, "zu_spaet");
      wartend_ = e;
      wartet_ = true;
#endif
      break;
    }
    usleep(1000);
  }
  return true;
}

void ArrLader::laufen(ArrLaderRinge& r, const std::atomic<bool>& stop) {
  while (!stop.load(std::memory_order_relaxed))
    if (!einmal(r)) usleep(1000);
}

}  // namespace cdj
