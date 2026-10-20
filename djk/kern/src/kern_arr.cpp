// D1 K1 (Spec D1 2.1, 2.2, 2.12, 3.1, 6.27): das Modul Arrangement im Kern. Befehle /k/arr/* (§4.11) am Blockanfang, Quittungen
// 2 und 3 an Einsatz und Ende (am Sample), /zustand/arr (§5.13) mit 50 Hz beim Spielen und 2 Hz sonst, abgelöste und
// abgelehnte Schnappschüsse als ARR_ALT zurück an den Netz-Faden (Freigabe im Lade-Faden). Keine Allokation, keine
// Sperre, kein I/O.
#include <cmath>
#include <cstring>

#include "cypherdj/kern.h"

namespace cdj {

namespace {

bool ist_cypher(const char* q) { return !std::strcmp(q, "cypher"); }

}  // namespace

void Kern::arr_alt_melden(const ArrSnapshot* s) {
  if (!s) return;
  Ereignis x{};
  x.art = Ereignis::ARR_ALT;
  x.sample = sample_;
  x.zeiger = s;
#ifdef CYPHERDJ_MUTATION_ARR_ALT_OHNE_PLATZ
  melde(x);   // Fehlerfall: bei vollem Ring verloren, Audio bleibt gesperrt
#else
  if (arr_alt_offen_ || !ereignisse_->schiebe(x)) {   // der Platz ist frei (arr_befehl_wartet hält Laden zurück)
    if (!arr_alt_offen_) arr_alt_offen_ = s;
    else ++verloren_;   // abgelehntes Laden bei vollem Wartepuffer (Fix 10): gezählt, /zustand/kern ereignisse_verloren
  }
#endif
}

// Am Zyklusanfang vor den neuen Befehlen: die wartende Rückgabe erneut, dann die wartenden /k/arr/*-Befehle, bis ein
// Laden wieder auf den Platz warten muss
void Kern::arr_nachreichen() {
  if (arr_alt_offen_) {
    Ereignis x{};
    x.art = Ereignis::ARR_ALT;
    x.sample = sample_;
    x.zeiger = arr_alt_offen_;
    if (!ereignisse_->schiebe(x)) return;
    arr_alt_offen_ = nullptr;
  }
  const double beat0 = plan_.karte().beat_at((double)sample_);
  int i = 0;
  for (; i < arr_warte_n_; ++i) {
    if (arr_warte_[i].art == Befehl::ARR_LADEN && arr_alt_offen_) break;
    if (arr_warte_[i].art == Befehl::ARR_FREEZE) einsortieren_freeze(arr_warte_[i], beat0);   // Paket K3
    else einsortieren_arr(arr_warte_[i], beat0);
  }
  for (int j = i; j < arr_warte_n_; ++j) arr_warte_[j - i] = arr_warte_[j];
  arr_warte_n_ -= i;
}

bool Kern::arr_befehl_wartet(const Befehl& c) {
#ifdef CYPHERDJ_MUTATION_ARR_ALT_OHNE_PLATZ
  (void)c;
  return false;
#else
  if (arr_warte_n_ == 0 && !(c.art == Befehl::ARR_LADEN && arr_alt_offen_)) return false;
#ifndef CYPHERDJ_MUTATION_ARR_WARTE_VORZIEHEN
  if (arr_warte_n_ == ARR_WARTE) {   // K1-Fix 10: voll: abgelehnt, nicht vorgezogen (die Reihenfolge bleibt)
    quittung(c.id, c.quelle, 4, sample_, plan_.karte().beat_at((double)sample_), "zu_spaet");
    if (c.art == Befehl::ARR_LADEN) arr_alt_melden(static_cast<const ArrSnapshot*>(c.zeiger));   // zurück oder gezählt
    if (c.art == Befehl::ARR_FREEZE && c.zeiger)   // Paket K3: der Auftrag geht zur Freigabe zurück
      freeze_melden(static_cast<ArrFreeze*>(const_cast<void*>(c.zeiger)), ARR_FREEZE_ABGELEHNT);
    return true;
  }
#else
  if (arr_warte_n_ == ARR_WARTE) return false;   // Fehlerfall: voll: sofort ausführen (überholt die wartenden)
#endif
  arr_warte_[arr_warte_n_++] = c;
  return true;
#endif
}

void Kern::einsortieren_arr(const Befehl& c, double beat0) {
  const Karte& k = plan_.karte();
  auto ab = [&](const char* grund) { quittung(c.id, c.quelle, 6, sample_, beat0, grund); };
  switch (c.art) {
    case Befehl::ARR_LADEN: {
      const auto* neu = static_cast<const ArrSnapshot*>(c.zeiger);
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) {   // Spec 2.12
        arr_alt_melden(neu);
        return ab("ki_gestoppt");
      }
      arr_alt_melden(arr_->tausche(neu, sample_, k));
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    }
    case Befehl::ARR_START: {
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");
      if (!(c.ab_beat >= 0.0) || !std::isfinite(c.ab_beat) || c.politik < 0 || c.politik > 2)
        return ab("ausserhalb_bereich");   // das Netz prüft schon; hier auch am Netz vorbei
      const int64_t vorhalt = (int64_t)ERZ_MIDI_RUNDWEG_ZYKLEN * zyklus_n_ + ERZ_MIDI_VORHALT_REST;
      if (!arr_->start(c.ab_beat, c.politik, ist_cypher(c.quelle), sample_, vorhalt, zyklus_n_, k))
        return ab("nicht_geladen");
      if (const int64_t s = arr_->hole_gestoppt(); s >= 0 && arr_stopp_id_) {   // ein laufender endete hier
        quittung(arr_stopp_id_, arr_stopp_quelle_, 3, s, beat0);
        arr_stopp_id_ = 0;
      }
#ifndef CYPHERDJ_MUTATION_ARR_START_ID_UEBERSCHRIEBEN
      arr_start_abbrechen(sample_, beat0, "abbruch");   // ein noch wartender Start endet hier ohne Einsatz
#endif
      arr_start_id_ = c.id;
      std::memcpy(arr_start_quelle_, c.quelle, sizeof arr_start_quelle_);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      return;
    }
    case Befehl::ARR_STOPP:   // Spec 6.27: auch von cypher während des KI-Stopps (Anhalten ist die sichere Richtung)
      if (c.politik < 0 || c.politik > 2) return ab("ausserhalb_bereich");
      quittung(c.id, c.quelle, 1, sample_, beat0);
      if (arr_->status() == ArrStatus::steht) {   // nichts zu stoppen: sofort fertig
        quittung(c.id, c.quelle, 3, sample_, beat0);
        return;
      }
      arr_->stopp(c.politik, sample_, k);
#ifndef CYPHERDJ_MUTATION_ARR_STOPP_ID_UEBERSCHRIEBEN
      if (arr_stopp_id_) quittung(arr_stopp_id_, arr_stopp_quelle_, 7, sample_, beat0, "abbruch");   // ersetzt: endet hier
#endif
      arr_stopp_id_ = c.id;
      std::memcpy(arr_stopp_quelle_, c.quelle, sizeof arr_stopp_quelle_);
      if (const int64_t s = arr_->hole_gestoppt(); s >= 0) {   // vor dem Einsatz gestoppt: schon jetzt
        quittung(c.id, c.quelle, 3, s, beat0);
        arr_stopp_id_ = 0;
        arr_start_abbrechen(s, beat0, "abbruch");
      }
      return;
    case Befehl::ARR_LOOP:
#ifndef CYPHERDJ_MUTATION_ARR_KI_NUR_LADEN_START
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");   // Spec 6.27, §4.7
#endif
      if (!std::isfinite(c.arr_von) || !std::isfinite(c.arr_bis) || c.arr_von < 0.0 || c.arr_bis - c.arr_von < 1.0 ||
          (c.an != 0 && c.an != 1))
        return ab("ausserhalb_bereich");
      arr_->loop(c.an == 1, c.arr_von, c.arr_bis, sample_, k);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    case Befehl::ARR_METRONOM:
#ifndef CYPHERDJ_MUTATION_ARR_KI_NUR_LADEN_START
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");   // Spec 6.27, §4.7
#endif
      if (!(c.wert >= -60.0f && c.wert <= 0.0f) || c.nr < 0 || c.nr > 1 || (c.an != 0 && c.an != 1))
        return ab("ausserhalb_bereich");
      arr_->metronom(c.an == 1, c.wert, c.nr);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    default:
      return;
  }
}

bool Kern::dj_laeuft() const noexcept {
  if (ein_deck_laeuft()) return true;
  for (int b = 1; b <= LOOP_BOXEN; ++b) {
    const BoxStatus st = loops_->status(b);
    if (st == BoxStatus::wartet || st == BoxStatus::laeuft || st == BoxStatus::endet) return true;
  }
  for (int s = 1; s <= ERZ_STROEME; ++s)
    if (erz_->offen(s) > 0) return true;
  return false;
}

bool Kern::arr_hand_start_stopp(int64_t s) noexcept {
  const Karte& k = plan_.karte();
  bool wirkung = false;
  if (arr_->status() != ArrStatus::steht) {
    arr_->stopp(0, s, k);
    if (arr_->status() == ArrStatus::steht) arr_start_abbrechen(s, k.beat_at((double)s), "hand");   // wartete noch
    wirkung = true;
  } else if (arr_->snapshot()) {
    const int64_t vorhalt = (int64_t)ERZ_MIDI_RUNDWEG_ZYKLEN * zyklus_n_ + ERZ_MIDI_VORHALT_REST;
#ifdef CYPHERDJ_MUTATION_ARR_HAND_IMMER_SOFORT
    wirkung = arr_->start(arr_->start_beat(), 0, false, s, vorhalt, zyklus_n_, k);   // Fehlerfall: ohne DJ-Quant
#else
    wirkung = arr_->start(arr_->start_beat(), dj_laeuft() ? 2 : 0, false, s, vorhalt, zyklus_n_, k);
#endif
  }
  Ereignis x{};
  x.art = Ereignis::HAND;
  x.sample = s;
  x.beat = k.beat_at((double)s);
  x.wert = 1.0f;
  std::memcpy(x.pfad, "arr/start_stopp", sizeof "arr/start_stopp");
  melde(x);
  return wirkung;
}

void Kern::arr_start_abbrechen(int64_t s, double b, const char* grund) {
  if (!arr_start_id_) return;
  quittung(arr_start_id_, arr_start_quelle_, 7, s, b, grund);
  arr_start_id_ = 0;
}

// Paket K3 (Spec 2.5, 2.12, 3.1): /k/arr/freeze. Quant wie die Hand-Zielart (Kern wählt: 2, wenn DJ-Teil läuft, sonst 0).
void Kern::einsortieren_freeze(const Befehl& c, double beat0) {
  auto* f = static_cast<ArrFreeze*>(const_cast<void*>(c.zeiger));
  if (!f) return quittung(c.id, c.quelle, 6, sample_, beat0, "form");
  auto ab = [&](const char* grund) {
    quittung(c.id, c.quelle, 6, sample_, beat0, grund);
    freeze_melden(f, ARR_FREEZE_ABGELEHNT);
  };
  if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");   // Spec 2.12
#ifndef CYPHERDJ_MUTATION_ARR_FREEZE_OHNE_RAMPENPRUEFUNG
  // Spec 6.33: eine offene Tempo-Rampe (angenommen, Einsatz an der nächsten Takt-Eins noch aus, oder laufend) veränderte
  // die Datei. Der Tempo-Plan hält jeden Eintrag bis zu seinem Ende; nur der Kern weiß das verlässlich.
  if (plan_.eintraege() > 0) return ab("tempo_rampe");
#endif
  const int64_t vorhalt = (int64_t)ERZ_MIDI_RUNDWEG_ZYKLEN * zyklus_n_ + ERZ_MIDI_VORHALT_REST;
  const char* grund = "";
  if (!arr_->freeze(f, dj_laeuft() ? 2 : 0, ist_cypher(c.quelle), sample_, vorhalt, zyklus_n_, plan_.karte(), grund))
    return ab(grund);
  arr_freeze_id_ = c.id;
  std::memcpy(arr_freeze_quelle_, c.quelle, sizeof arr_freeze_quelle_);
  quittung(c.id, c.quelle, 1, sample_, beat0);
}

// Nach arr_->block() eines Teilblocks: Freeze-Einsatz (2), Ende (3) oder Abbruch (7, Grund ki_stopp oder abbruch)
void Kern::arr_freeze_quittungen(const Karte& k) {
  if (const int64_t s = arr_->hole_freeze_gestartet(); s >= 0 && arr_freeze_id_)
    quittung(arr_freeze_id_, arr_freeze_quelle_, 2, s, k.beat_at((double)s));
  ArrFreeze* f = arr_->hole_freeze_fertig();
  if (!f) return;
  const double b = k.beat_at((double)f->ende_s);
  if (f->status == 0) quittung(arr_freeze_id_, arr_freeze_quelle_, 3, f->ende_s, b);
  else
    quittung(arr_freeze_id_, arr_freeze_quelle_, 7, f->ende_s, b,
             sw_->ki_gestoppt() && arr_->von_cypher() ? "ki_stopp" : "abbruch");
  arr_freeze_id_ = 0;
  freeze_melden(f, f->status);
}

namespace {

bool schiebe_freeze(Ereignisring& r, ArrFreeze* f, int32_t status, int64_t s) {
  Ereignis x{};
  x.art = Ereignis::ARR_FREEZE;
  x.status = status;
  x.sample = s;
  x.zeiger = f;
  return r.schiebe(x);
}

}  // namespace

// Fix 2/P1: jede Rückgabe kommt an. Findet sie keinen Platz im Ring, hängt sie sich als eigener Knoten an die Kette der
// wartenden (rueck_naechster im Auftrag selbst: keine Allokation, keine Obergrenze, keine Sperre); freeze_nachreichen()
// schiebt sie am nächsten Zyklusanfang und vor jeder neuen Rückgabe in ihrer Reihenfolge nach (Fix 3/Q2: geprüft in
// test_kern_arr_freeze Fall 9, Mutation ARR_FREEZE_LIFO rot). Vorher hatte der Kern vier
// Plätze: bei vollem Ring und mehr Rückgaben zählte der Rest als verloren, auch die des laufenden Freeze (Fall 9, bis
// 99 MB Puffer belegt, kein /e/freeze).
void Kern::freeze_melden(ArrFreeze* f, int32_t status) {
  freeze_nachreichen();   // Reihenfolge: Wartendes zuerst
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_VERLIERBAR
  if (!schiebe_freeze(*ereignisse_, f, status, sample_)) ++verloren_;   // Fehlerfall: bei vollem Ring verloren (Leck)
  return;
#endif
  if (!freeze_kopf_ && schiebe_freeze(*ereignisse_, f, status, sample_)) return;
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_RUECKGABE_VERWERFEN
  if (freeze_wartend_ >= 4) {   // Fehlerfall (Stand fix1): vier Plätze, die nächste Rückgabe geht verloren
    ++verloren_;
    return;
  }
#endif
  f->rueck_status = status;
#ifdef CYPHERDJ_MUTATION_ARR_FREEZE_LIFO
  f->rueck_naechster = freeze_kopf_;   // Fehlerfall (Re-Review Fix 2, M2): vorn eingehängt, die jüngste geht zuerst hinaus
  freeze_kopf_ = f;
  if (!freeze_schwanz_) freeze_schwanz_ = f;
  ++freeze_wartend_;
  return;
#endif
  f->rueck_naechster = nullptr;
  if (freeze_schwanz_) freeze_schwanz_->rueck_naechster = f;
  else freeze_kopf_ = f;
  freeze_schwanz_ = f;
  ++freeze_wartend_;
}

void Kern::freeze_nachreichen() {
  while (freeze_kopf_) {
    ArrFreeze* f = freeze_kopf_;
    ArrFreeze* n = f->rueck_naechster;   // vor dem Schieben lesen: danach gehört der Auftrag dem Netz (es gibt ihn frei)
    if (!schiebe_freeze(*ereignisse_, f, f->rueck_status, sample_)) return;
    freeze_kopf_ = n;
    if (!n) freeze_schwanz_ = nullptr;
    --freeze_wartend_;
  }
}

// Nach arr_->block() eines Teilblocks: Quittung 2 am Einsatz-Sample, Quittung 3 am Stopp-Sample. Endete ein noch
// wartender Start (KI-Stopp eines von Cypher gestarteten), bekommt er 7.
void Kern::arr_quittungen(const Karte& k) {
  if (const int64_t s = arr_->hole_gestartet(); s >= 0 && arr_start_id_) {
    quittung(arr_start_id_, arr_start_quelle_, 2, s, k.beat_at((double)s));
    arr_start_id_ = 0;
  }
  if (const int64_t s = arr_->hole_gestoppt(); s >= 0) {
    if (arr_stopp_id_) quittung(arr_stopp_id_, arr_stopp_quelle_, 3, s, k.beat_at((double)s));
    arr_stopp_id_ = 0;
#ifndef CYPHERDJ_MUTATION_ARR_START_ID_UEBERSCHRIEBEN
    arr_start_abbrechen(s, k.beat_at((double)s), sw_->ki_gestoppt() && arr_->von_cypher() ? "ki_stopp" : "abbruch");
#endif
  }
}

// §5.13 /zustand/arr: 50 Hz (je 960 Samples), solange er wartet oder spielt, sonst 2 Hz (24 000), dazu bei jeder Änderung
void Kern::arr_zustand(int64_t n0, int n) {
  const ArrStatus st = arr_->status();
  const int64_t abstand = (st == ArrStatus::wartet || st == ArrStatus::spielt) ? 960 : 24000;
  const bool takt = (n0 + abstand - 1) / abstand * abstand < n0 + n;
  if (!arr_->hole_geaendert() && !takt) return;
  const ArrZustand z = arr_->zustand(plan_.karte(), n0);
  Ereignis e{};
  e.art = Ereignis::ARR_ZUSTAND;
  e.sample = n0;
  e.arr_nr = z.nr;
  e.arr_status = static_cast<int32_t>(z.status);
  e.arr_loop_an = z.loop_an ? 1 : 0;
  e.arr_beat = z.projekt_beat;
  e.arr_ursprung = z.ursprung_sample;
  e.arr_start_beat = z.start_beat;
  e.arr_metronom_an = z.metronom_an ? 1 : 0;
  melde(e);
}

}  // namespace cdj
