// D1 K1 (Spec D1 2.1, 2.2, 2.12, 3.1, 6.27): das Modul Arrangement im Kern. Befehle /k/arr/* (§4.11) am Blockanfang, Quittungen
// 2 und 3 an Einsatz und Ende (am Sample), /zustand/arr (§5.13) mit 50 Hz beim Spielen und 2 Hz sonst, abgelöste und
// abgelehnte Schnappschüsse als ARR_ALT zurück an den Netz-Faden (Freigabe im Lade-Faden). Keine Allokation, keine
// Sperre, kein I/O.
#include <algorithm>
#include <cmath>
#include <cstring>

#include "cypherdj/reverb_pool.h"
#include "cypherdj/core.h"

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
    else if (arr_warte_[i].art == Befehl::ARR_ABGRIFF) einsortieren_abgriff(arr_warte_[i], beat0);   // 1.10 slice 7
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
    if (c.art == Befehl::ARR_ABGRIFF && c.zeiger)   // 1.10 slice 7
      abgriff_melden(static_cast<ArrAbgriff*>(const_cast<void*>(c.zeiger)), ARR_ABGRIFF_ABGELEHNT);
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
      // 1.8 S4a.4 (D7): a recording that waits for its Einsatz brings its count-in: the entry moves 4 * bars core beats behind the first quant point. Any other start (a recording that
      // runs, no recording, the arrangement already waits) has none.
#ifdef CYPHERDJ_MUTATION_REC_VORZAEHLER_NICHT_GEREICHT
      const int vorzaehl_beats = 0;   // mutation (S4a.4): the count-in of the run never reaches Arrangement::start
#else
      const int vorzaehl_beats = aufnahme_.status() == 2 && arr_->status() == ArrStatus::steht ? 4 * aufnahme_.vorzaehler() : 0;
#endif
      if (!arr_->start(c.ab_beat, c.politik, ist_cypher(c.quelle), sample_, vorhalt, zyklus_n_, k, vorzaehl_beats))
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
    case Befehl::ARR_AUTO: {   // 1.12 S3 (§4.11 /k/arr/auto); the net thread checks the same, this is the backstop and the filter of D5 (in the Arrangement)
      const bool cy = ist_cypher(c.quelle);
      if (cy && sw_->ki_gestoppt()) return ab("ki_gestoppt");
      if (c.nr < 0 || c.nr > ARR_SPUREN || (c.an != 0 && c.an != 1)) return ab("format");
      if (c.politik < 0 || c.politik >= Arrangement::AUTO_FELDER) return ab("auto_ziel_unbekannt");
      if (c.nr == 0 && c.an == 0) return ab("format");
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_CYPHER_UEBERSTEUERT   // error case: cypher may override
      if (cy && c.an == 0) return ab("nur_andreas");   // D9
#endif
      quittung(c.id, c.quelle, 1, sample_, beat0);
      if (c.nr == 0) arr_->auto_alle_freigeben(sample_);
      else auto_uebersteuern(auto_spur_index(c.nr), c.politik, c.an == 0);   // false (no lane, stopped, no change) is no refusal: acknowledged, nothing happens (D5)
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    }
    case Befehl::ARR_ARM: {   // 1.12 S3 (D11, §4.11 /k/arr/arm); the net thread checks the same, this is the backstop
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");
      if (c.nr < 0 || c.nr > ARR_SPUREN || (c.an != 0 && c.an != 1) || c.politik < 0 || c.politik > 2) return ab("format");
      if (c.nr == 0 && c.an == 1) return ab("format");   // spur 0 only disarms
#ifndef CYPHERDJ_MUTATION_ARR_ARM_CYPHER   // error case: any source may arm
      if (std::strcmp(c.quelle, "andreas")) return ab("nur_andreas");   // D11: only Andreas arms
#endif
      quittung(c.id, c.quelle, 1, sample_, beat0);
      const int von = c.nr == 0 ? 0 : auto_spur_index(c.nr), bis = c.nr == 0 ? ARR_SPUREN : von + 1;
      for (int i = von; i < bis; ++i) {
        const int8_t neu = c.an == 1 ? static_cast<int8_t>(c.politik + 1) : static_cast<int8_t>(0);
        if (!auto_arm_[i] != !neu) auto_armiert_ += neu ? 1 : -1;
        auto_arm_[i] = neu;
        if (c.an == 0) {   // disarmed: a held point is stale and goes; the rate window stays, so a quick re-arm cannot send inside 960 samples (an arm that repeats the mode changes nothing)
#ifdef CYPHERDJ_MUTATION_ARR_ARM_AUS_FENSTER_NEU   // error case: the disarm forgets the window too
          for (AutoPunkt& p : auto_punkt_[i]) p = AutoPunkt{};
#elif !defined(CYPHERDJ_MUTATION_ARR_ARM_AUS_BEHAELT)   // error case: the held point stays and comes out at the next arm
          for (AutoPunkt& p : auto_punkt_[i]) p.aus = false;
#endif
        }
      }
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    }
    default:
      return;
  }
}

// 1.12 S3 (D8, D6): /e/auto. The ring of the Arrangement has ONE reader, this callback thread. Events the ring dropped (auto_ereignis_verloren rose) or this function could not push
// (event ring full) leave the reader behind. Then the queued events are discarded (the full state supersedes them) and every field that has a lane or was last reported as 1
// is reported with the truth (auto_uebersteuert, valid in this thread only). A field is reported until pushed; a full event ring continues the re-report in the next cycle.
void Kern::auto_melden(int64_t n0) {
  auto push = [&](int64_t sample, int spur, int feld, int zustand) {
    Ereignis x{};
    x.art = Ereignis::AUTO_ZUSTAND;
    x.sample = sample;
    x.deck = auto_spur_osc(spur);
    x.fassung = feld;
    x.status = zustand;
    if (!ereignisse_->schiebe(x)) return false;
    auto_gemeldet_[spur][feld] = zustand != 0;
    return true;
  };
  ArrAutoEreignis a;
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_OHNE_ABGLEICH   // error case: lost events are never re-reported
  const uint32_t verloren = arr_->auto_ereignis_verloren();
  if (verloren != auto_verloren_gesehen_) {
    auto_verloren_gesehen_ = verloren;
    auto_abgleich_ = 0;
    while (arr_->auto_ereignis_holen(a)) {
    }
  }
#endif
  while (auto_abgleich_ < 0 && arr_->auto_ereignis_holen(a)) {
    if (a.spur < 0 || a.spur >= ARR_SPUREN || a.feld < 0 || a.feld >= Arrangement::AUTO_FELDER) continue;
    if (!push(a.sample, a.spur, a.feld, a.zustand)) {   // the event ring is full: this one is lost
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_OHNE_ABGLEICH
      auto_abgleich_ = 0;
      while (arr_->auto_ereignis_holen(a)) {
      }
#endif
      break;
    }
  }
  if (auto_abgleich_ < 0) return;
  for (; auto_abgleich_ < ARR_SPUREN * Arrangement::AUTO_FELDER; ++auto_abgleich_) {
    const int spur = auto_abgleich_ / Arrangement::AUTO_FELDER, feld = auto_abgleich_ % Arrangement::AUTO_FELDER;
    const bool ist = arr_->auto_uebersteuert(spur, feld);
    if (!ist && !auto_gemeldet_[spur][feld] && !arr_->auto_lane_da(spur, feld)) continue;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_ABGLEICH_VERGISST   // error case: a full event ring ends the re-report, the rest is forgotten
    if (!push(n0, spur, feld, ist ? 1 : 0)) { auto_abgleich_ = -1; return; }
#else
    if (!push(n0, spur, feld, ist ? 1 : 0)) return;   // continue in the next cycle
#endif
  }
  auto_abgleich_ = -1;
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
  arr_abgriff_quittungen(k);   // 1.10 slice 7: the tap's receipts ride on the call sites of the freeze's (core_signalbox.cpp stays untouched)
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

// 1.10 slice 7 (/k/arr/abgriff): the sibling of einsortieren_freeze. Same quant rule, same refusals (ki_gestoppt, tempo_rampe, then those of Arrangement::abgriff).
void Kern::einsortieren_abgriff(const Befehl& c, double beat0) {
  auto* f = static_cast<ArrAbgriff*>(const_cast<void*>(c.zeiger));
  if (!f) return quittung(c.id, c.quelle, 6, sample_, beat0, "form");
  auto ab = [&](const char* grund) {
    quittung(c.id, c.quelle, 6, sample_, beat0, grund);
    abgriff_melden(f, ARR_ABGRIFF_ABGELEHNT);
  };
  if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");
  if (plan_.eintraege() > 0) return ab("tempo_rampe");   // an open tempo ramp moves the grid under the run (spec 6.33)
  const int64_t vorhalt = (int64_t)ERZ_MIDI_RUNDWEG_ZYKLEN * zyklus_n_ + ERZ_MIDI_VORHALT_REST;
  const char* grund = "";
  if (!arr_->abgriff(f, dj_laeuft() ? 2 : 0, ist_cypher(c.quelle), sample_, vorhalt, zyklus_n_, plan_.karte(), grund)) return ab(grund);
  arr_abgriff_id_ = c.id;
  std::memcpy(arr_abgriff_quelle_, c.quelle, sizeof arr_abgriff_quelle_);
  quittung(c.id, c.quelle, 1, sample_, beat0);
}

void Kern::arr_abgriff_quittungen(const Karte& k) {
  if (const int64_t s = arr_->hole_abgriff_gestartet(); s >= 0 && arr_abgriff_id_)
    quittung(arr_abgriff_id_, arr_abgriff_quelle_, 2, s, k.beat_at((double)s));
  ArrAbgriff* f = arr_->hole_abgriff_fertig();
  if (!f) return;
  const double b = k.beat_at((double)f->ende_s);
  if (f->status == 0) quittung(arr_abgriff_id_, arr_abgriff_quelle_, 3, f->ende_s, b);
  else
    quittung(arr_abgriff_id_, arr_abgriff_quelle_, 7, f->ende_s, b, sw_->ki_gestoppt() && arr_->von_cypher() ? "ki_stopp" : "abbruch");
  arr_abgriff_id_ = 0;
  abgriff_melden(f, f->status);
}

namespace {

bool schiebe_abgriff(Ereignisring& r, ArrAbgriff* f, int32_t status, int64_t s) {
  Ereignis x{};
  x.art = Ereignis::ARR_ABGRIFF;
  x.status = status;
  x.sample = s;
  x.zeiger = f;
  return r.schiebe(x);
}

}  // namespace

// Every return arrives (as the freeze, fix 2/P1): without room in the ring the job hangs itself on a chain through its own rueck_naechster (no allocation, no upper bound,
// no lock) and abgriff_nachreichen() pushes it in order at the next cycle start and before any new return.
void Kern::abgriff_melden(ArrAbgriff* f, int32_t status) {
  abgriff_nachreichen();   // order: what waits first
  if (!abgriff_kopf_ && schiebe_abgriff(*ereignisse_, f, status, sample_)) return;
  f->rueck_status = status;
  f->rueck_naechster = nullptr;
  if (abgriff_schwanz_) abgriff_schwanz_->rueck_naechster = f;
  else abgriff_kopf_ = f;
  abgriff_schwanz_ = f;
  ++abgriff_wartend_;
}

void Kern::abgriff_nachreichen() {
  while (abgriff_kopf_) {
    ArrAbgriff* f = abgriff_kopf_;
    ArrAbgriff* n = f->rueck_naechster;   // read before pushing: afterwards the job belongs to the net thread
    if (!schiebe_abgriff(*ereignisse_, f, f->rueck_status, sample_)) return;
    abgriff_kopf_ = n;
    if (!n) abgriff_schwanz_ = nullptr;
    --abgriff_wartend_;
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

// 1.10 Slice 2 (E2, P12): Absenkung des Set-Limiters nach jedem Mischer-Block lesen. Das Lesen setzt zurück (mixer.h).
void Kern::limiter_beobachten(int64_t s0, int m) {
  const float a = mixer_->limiter_absenkung_db();   // seit dem letzten Aufruf, <= 0
  if (a < limiter_db_min_) limiter_db_min_ = a;
  if (a < LIMITER_LAMPE_DB) {
    limiter_halte_db_ = s0 <= limiter_halte_bis_ ? std::min(limiter_halte_db_, a) : a;
    limiter_halte_bis_ = s0 + m + LIMITER_HALTE;
  } else if (s0 >= limiter_halte_bis_) {
    limiter_halte_db_ = 0.0f;
  }
  const bool an = limiter_halte_db_ < LIMITER_LAMPE_DB;
  if (an != limiter_lampe_) {
    limiter_lampe_ = an;
    limiter_wechsel_ = true;   // die Lampe wechselt sofort hinaus, nicht erst im 2-Hz-Takt
  }
}

// §5.13 /zustand/arr: 50 Hz (je 960 Samples), solange er wartet oder spielt, sonst 2 Hz (24 000), dazu bei jeder Änderung
void Kern::arr_zustand(int64_t n0, int n) {
  const ArrStatus st = arr_->status();
  const int64_t abstand = (st == ArrStatus::wartet || st == ArrStatus::spielt) ? 960 : 24000;
  const bool takt = (n0 + abstand - 1) / abstand * abstand < n0 + n;
  if (!arr_->hole_geaendert() && !takt && !limiter_wechsel_) return;
  limiter_wechsel_ = false;
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
  e.arr_limiter_db = limiter_halte_db_;
  melde(e);
}

// 1.13 Slice 2 (§5.13b): Zähler des Warp-Werks im Arrangement. Gemeldet wird bei jeder Änderung und sonst mit 2 Hz, solange ein Werk hängt.
void Kern::warp_zustand(int64_t n0, int n) {
  const WarpWerk* w = arr_->warp_werk();
  if (!w) return;
  const auto sat = [](uint64_t x) { return static_cast<int32_t>(x > 0x7fffffffu ? 0x7fffffffu : x); };
  const int32_t v[4] = {arr_->werk_stimmen(), sat(arr_->warp_unterlauf()), sat(arr_->warp_kein_platz()), sat(arr_->warp_spaet())};
  const bool geaendert = std::memcmp(v, warp_gemeldet_, sizeof v) != 0;
  const bool takt = (n0 + 24000 - 1) / 24000 * 24000 < n0 + n;
  if (!geaendert && !takt) return;
  std::memcpy(warp_gemeldet_, v, sizeof v);
  Ereignis e{};
  e.art = Ereignis::WARP_ZUSTAND;
  e.sample = n0;
  e.warp_stimmen = v[0];
  e.warp_unterlauf = v[1];
  e.warp_kein_platz = v[2];
  e.warp_spaet = v[3];
  e.warp_faeden = w->faeden();
  melde(e);
}

// mehrkern Task 5 (§5.13): state of the Hall pool. Reported on every change and otherwise at 2 Hz (also without a pool: 0 0 0 0, so a late subscriber hears it too). A pool that switched itself off keeps
// reporting (an 0 with its counters), so the page and the end-of-run line can see it. The reads are relaxed atomics of the pool; nothing here allocates or locks.
void Kern::hall_zustand(int64_t n0, int n) {
  const HallPool* p = hall_pool_;   // without a pool the kern still says an 0, faeden 0 (hall_faeden 0, no free core, no threads), so /lage can tell it from an old kern
  const auto sat = [](uint64_t x) { return static_cast<int32_t>(x > 0x7fffffffu ? 0x7fffffffu : x); };
  const int32_t v[4] = {p && p->an() ? 1 : 0, p ? p->faeden() : 0, p ? sat(p->spaet()) : 0, p ? sat(p->zurueck()) : 0};
  const bool geaendert = std::memcmp(v, hall_gemeldet_, sizeof v) != 0;
  const bool takt = (n0 + 24000 - 1) / 24000 * 24000 < n0 + n;
  if (!geaendert && !takt) return;
  std::memcpy(hall_gemeldet_, v, sizeof v);
  Ereignis e{};
  e.art = Ereignis::HALL_ZUSTAND;
  e.sample = n0;
  e.hall_an = v[0];
  e.hall_faeden = v[1];
  e.hall_spaet = v[2];
  e.hall_zurueck = v[3];
  melde(e);
}

// mehrkern slice 3.2 task 7 (§5.13): state of the track phases. Same rhythm as the Hall pool: a message on every change of an, modus, haengt, spaet and otherwise at 2 Hz (also
// without a pool). The running counters (blocks_parallel, einheiten_*, seriell_summe) change every block, and zurueck changes whenever a track job that no worker had started is
// taken back, which is normal and not late: none of them causes a message of its own, they ride along with the beat only. Without a pool the counters of the tracks
// that run serially still count (seriell_summe grows per block that has tracks), the pool-side values are 0.
// Runs on the callback thread, the thread that owns the scheduler's plain counters; the pool's counters are relaxed atomics. Nothing here allocates or locks.
void Kern::spur_zustand(int64_t n0, int n) {
  const HallPool* p = hall_pool_;
  const int modus = p ? arr_->spur_pool_modus() : 0;   // without a pool the mode is aus whatever was asked for
  const auto sat = [](uint64_t x) { return static_cast<int32_t>(x > 0x7fffffffu ? 0x7fffffffu : x); };
  const HallPool::Konto K = HallPool::SPUR;
  // an: the track phases can fork right now (mode on, a pool with workers that run SCHED_FIFO, the track account not switched off)
  const int32_t v[4] = {p && modus != 0 && p->faeden() > 0 && p->fifo() && p->an(K) ? 1 : 0, modus, p ? sat(p->haengt(K)) : 0, p ? sat(p->spaet(K)) : 0};
  const int32_t zurueck = p ? sat(p->zurueck(K)) : 0;   // beat only (see above)
  const bool geaendert = std::memcmp(v, spur_gemeldet_, sizeof v) != 0;
  const bool takt = (n0 + 24000 - 1) / 24000 * 24000 < n0 + n;
  if (!geaendert && !takt) return;
  std::memcpy(spur_gemeldet_, v, sizeof v);
  const ArrSpurLauf& sl = arr_->spur_lauf();
  const ArrSpurLauf::Zaehler& z = sl.z;
  Ereignis e{};
  e.art = Ereignis::SPUR_ZUSTAND;
  e.sample = n0;
  e.spur_an = v[0];
  e.spur_modus = v[1];
  e.spur_haengt = v[2];
  e.spur_spaet = v[3];
  e.spur_zurueck = zurueck;
  const uint64_t a = spur_test_aufschlag_;   // TESTS ONLY (0 in the product): lets a ctest cross 2^31 without running for days
  e.spur_blocks_parallel = spur_zaehler31(z.blocks_parallel + a);
  e.spur_einheiten_worker = spur_zaehler31(sl.einheiten_worker() + a);
  e.spur_einheiten_caller = spur_zaehler31(z.einheiten_caller + a);
  e.spur_seriell = spur_zaehler31(z.seriell_weg + z.seriell_wenig + z.seriell_fifo + z.seriell_plan + z.seriell_aus + z.seriell_spaet + a);
  melde(e);
}

// ---- 1.8 Aufnahme -------------------------------------------------------------------------------------------------------
ArrLage Kern::rec_arr_lage() const {
  return ArrLage{static_cast<int>(arr_->status()), arr_->einsatz_sample(), arr_->beendet_sample(), arr_->stopp_sample(), arr_->letzte_naht()};
}

void Kern::rec_alt_melden(RecSpur* p) {   // der abgelöste oder abgelehnte RecSpur geht zur Freigabe an den Netz-Faden (nie im Callback freigeben)
  if (!p) return;
#ifdef CYPHERDJ_MUTATION_REC_ALT_NICHT_ZURUECK
  return;   // mutation: the unused or replaced RecSpur is never handed back, the net thread never frees it
#endif
  Ereignis x{};
  x.art = Ereignis::REC_ALT;
  x.sample = sample_;
  x.zeiger = p;
  if (!ereignisse_->schiebe(x)) ++verloren_;   // gezählt (/zustand/kern ereignisse_verloren): ein Leck von 1 MB statt eines Absturzes
}

void Kern::rec_midi_alt_melden(RecMidi* p) {   // 1.8 T7a: the RecMidi that was not adopted, or the last one after the last MIDI bit went, goes back to the net thread
  if (!p) return;
#ifdef CYPHERDJ_MUTATION_REC_ALT_NICHT_ZURUECK
  return;
#endif
  Ereignis x{};
  x.art = Ereignis::REC_ALT;
  x.fassung = 1;   // the tag: zeiger is a RecMidi*, no new event number (D21)
  x.sample = sample_;
  x.zeiger = p;
  if (!ereignisse_->schiebe(x)) ++verloren_;
}

void Kern::einsortieren_rec(const Befehl& c, double beat0) {
  auto ab = [&](const char* grund) { quittung(c.id, c.quelle, 6, sample_, beat0, grund); };
  switch (c.art) {
    case Befehl::REC_SPUR: {
      if (c.deck == 30 && c.an == 1) {   // 1.8 T7a: eingang 30 = midi_ein_1 on an instrument track, a bit in the module, the RecMidi comes with the command
        RecMidi* neu_m = static_cast<RecMidi*>(const_cast<void*>(c.zeiger));
        if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) { rec_midi_alt_melden(neu_m); return ab("ki_gestoppt"); }
        if (c.nr < 1 || c.nr > ARR_SPUREN || !neu_m) { rec_midi_alt_melden(neu_m); return ab(c.nr < 1 || c.nr > ARR_SPUREN ? "spur_bereich" : "datei_fehlt"); }
        const bool schon = (aufnahme_.midi_maske() >> (c.nr - 1)) & 1u;
        if (!schon && !aufnahme_.aendern_erlaubt()) { rec_midi_alt_melden(neu_m); return ab("aufnahme_laeuft"); }
        if (!schon) {   // a track has ONE input: an audio arm of this track goes (handed back), the MIDI bit is set
          rec_alt_melden(aufnahme_.setze(c.nr, nullptr));
          rec_midi_alt_melden(aufnahme_.setze_midi(c.nr, true, neu_m));
        } else {
          rec_midi_alt_melden(neu_m);   // already armed: nothing changes, the new recorder is not needed
        }
        quittung(c.id, c.quelle, 1, sample_, beat0);
        quittung(c.id, c.quelle, 3, sample_, beat0);
        return;
      }
      RecSpur* neu = static_cast<RecSpur*>(const_cast<void*>(c.zeiger));
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) { rec_alt_melden(neu); return ab("ki_gestoppt"); }
      if (c.nr < 1 || c.nr > ARR_SPUREN) { rec_alt_melden(neu); return ab("spur_bereich"); }
      // 1.8 S3 (D12): the same input in the same mode only changes the monitor. That is done in place, in the callback, at any time (also while recording and while the
      // thread closes the last file); the armed set does not change, so neither aendern_erlaubt() nor zu_viele_scharf apply. The unused new RecSpur goes back to the net thread.
#ifndef CYPHERDJ_MUTATION_REC_MONITOR_NICHT_VOR_ORT
      if (neu) {
        if (const RecSpur* live = aufnahme_.spur(c.nr); live && live->eingang == neu->eingang && live->modus == neu->modus) {
          const_cast<RecSpur*>(live)->monitor.store(neu->monitor.load(std::memory_order_relaxed), std::memory_order_relaxed);
          rec_alt_melden(neu);
          quittung(c.id, c.quelle, 1, sample_, beat0);
          quittung(c.id, c.quelle, 3, sample_, beat0);
          return;
        }
      }
#endif
      if (!aufnahme_.aendern_erlaubt()) { rec_alt_melden(neu); return ab("aufnahme_laeuft"); }   // auch solange der Faden die Datei des letzten Takes noch schließt (m1)
      if (neu && aufnahme_.scharf_ohne(c.nr) >= REC_MAX_ARM) { rec_alt_melden(neu); return ab("zu_viele_scharf"); }
      rec_alt_melden(aufnahme_.setze(c.nr, neu));
#ifndef CYPHERDJ_MUTATION_LIVE_AUS_BEI_DISARM_FEHLT
      arr_->live_spur_aus(c.nr - 1, sample_);   // 1.8 T7b: the bit goes, a key held on this track gets its off now (the take is not running: aendern_erlaubt above)
#endif
      rec_midi_alt_melden(aufnahme_.setze_midi(c.nr, false, nullptr));   // 1.8 T7a: one input per track, an audio arm or a disarm clears the MIDI bit of the track
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    }
    case Befehl::REC_START: {
      if (ist_cypher(c.quelle) && sw_->ki_gestoppt()) return ab("ki_gestoppt");
      if (c.nr < 0 || c.fassung < 0 || c.fassung > 480000) return ab("ausserhalb_bereich");
      if (!(c.versatz_f == 0 || (c.versatz_f >= REC_FRIST_MIN && c.versatz_f <= REC_FRIST_MAX))) return ab("ausserhalb_bereich");   // frist_samples (M1)
      // 1.8 S4a.3 (D8): with a running transport the take begins at the next project bar (4/4, project beat = 0 mod 4), at least one cycle ahead; with the loop bracket on and the
      // bar at or behind the seam, at the seam that ends the running pass (the take then runs one whole pass). The transport is not touched. Without a running transport
      // the slice 1 path stays (the einsatz of the arrangement), and the count-in of the run is kept for the transport start that follows (D7).
      int64_t ab_sample = -1;
      if (arr_->status() == ArrStatus::spielt) {
        const Karte& k = plan_.karte();
        const int64_t frueh = sample_ + zyklus_n_;
        const double p0 = arr_->projekt_beat_bei(k, frueh);
        const double p = 4.0 * std::ceil(p0 / 4.0);
        ab_sample = arr_->sample_bei_projekt_beat(k, p, frueh);
        if (const int64_t w = arr_->naht_bei(k, frueh); w >= 0 && ab_sample >= w) ab_sample = w;
#ifdef CYPHERDJ_MUTATION_REC_LAUFEND_SOFORT
        ab_sample = frueh;   // mutation: no wait for the bar, the take begins in the next cycle
#endif
        if (ab_sample < frueh) ab_sample = frueh;   // rounding at the bar itself: never a start in the past
      }
      if (const char* g = aufnahme_.starte(c.id, c.nr, c.fassung, ist_cypher(c.quelle), sample_, rec_arr_lage(), c.versatz_f, ab_sample, c.politik)) return ab(g);
      rec_id_ = c.id;
      std::strncpy(rec_quelle_, c.quelle, sizeof rec_quelle_ - 1);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      return;
    }
    case Befehl::REC_STOPP:
      quittung(c.id, c.quelle, 1, sample_, beat0);
      aufnahme_.stopp(sample_);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      return;
    default: return;
  }
}

void Kern::rec_meldungen(const Karte& k) {   // Quittungen des Start-Befehls: 2 am Einsatz, 3 am Ende, 7 Abbruch
  AufnahmeMeldung m;
  while (aufnahme_.hole_meldung(m)) {
    double beat = k.beat_at(static_cast<double>(m.sample));
    // 1.8 S4a.3 (D8): the receipt 2 of a take carries the PROJECT beat of its start while the arrangement plays (today's value is the core beat)
    if (m.art == AufnahmeMeldung::EINSATZ && arr_->status() == ArrStatus::spielt) beat = arr_->projekt_beat_bei(k, m.sample);
    quittung(rec_id_, rec_quelle_, m.art, m.sample, beat, m.grund);
  }
}

void Kern::rec_zustand_melden(int64_t n0, int n) {   // /zustand/rec: 10 Hz beim Aufnehmen, 2 Hz sonst
  const int64_t abstand = aufnahme_.status() == 0 ? 24000 : 4800;
  if ((n0 + abstand - 1) / abstand * abstand >= n0 + n) return;
  Ereignis z{};
  z.art = Ereignis::REC_ZUSTAND;
  z.sample = n0;
  z.status = aufnahme_.status() == 2 && arr_->zaehlt_ein() ? 1 : aufnahme_.status();   // 1.8 S4a.4: 1 counts in (the arrangement waits behind a count-in)
  z.id = aufnahme_.kennung();
  z.rec_scharf = aufnahme_.scharf();
  z.rec_midi_scharf = aufnahme_.midi_scharf();   // 1.8 T7a: eingang 30, next to the audio count
  z.rec_luecken = static_cast<int64_t>(aufnahme_.luecken());
#ifdef CYPHERDJ_MUTATION_REC_VORHALT_NULL
  z.fassung = 0;   // Fehlerfall (1.8 S0): der Ausgangsvorhalt fehlt im Bericht
#elif defined(CYPHERDJ_MUTATION_REC_VORHALT_OHNE_PDC)
  z.fassung = mixer_->limiter_vorhalt() + mixer_->kanal_latenz();   // error case (1.8 T2): the delay compensation of the insert chains is left out of the report
#else
  // 1.8 S0 (D9): what the core delays its master against the timeline. 1.8 T2: plus the delay compensation of the playback in force (pdc_latenz), because the music
  // sounds that many samples after the transport (the export skips exactly that much); a take recorded against the sounding music has to be shifted by it too.
  z.fassung = mixer_->limiter_vorhalt() + mixer_->kanal_latenz() + arr_->pdc_latenz();
#endif
  z.nframes = n;   // 1.8 S0: Zyklusgröße des Callbacks (quantum)
#ifdef CYPHERDJ_MUTATION_REC_ARR_BEAT_KERN
  z.arr_beat = arr_->status() == ArrStatus::spielt ? plan_.karte().beat_at(static_cast<double>(n0)) : 0.0;   // Fehlerfall (m2): der Kern-Beat statt des Projekt-Beats
#else
  z.arr_beat = arr_->status() == ArrStatus::spielt ? arr_->zustand(plan_.karte(), n0).projekt_beat : 0.0;     // Projekt-Beat wie /zustand/arr (m2)
#endif
  melde(z);
}

}  // namespace cdj
