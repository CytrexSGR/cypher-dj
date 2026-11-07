// Stellwerk-RT: Hand-Schiedsrichter (§7.3 Punkte 1 bis 5, ADR 014, ADR 023 Punkt 2).
// Erster Wert nur Stellung, Totzone 3/128 gegen den Übernahmepunkt, solange ein Teil am Regler offen ist,
// Übernahme skaliert (absolut) oder relativ (Encoder) ohne Sprung, Berührung übernimmt sofort, Freigabe gibt zurück.
// Deck-Halter: eine Transport-Taste setzt deck/<n>/transport auf mensch; nach 32 Beats ohne Taste wieder frei.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

// The pickup at a point where the step is certain to be applied. The mutation PICKUP_VOR_VERWURF moves it (see hand_anwenden).
#ifdef CYPHERDJ_MUTATION_STELLWERK_PICKUP_VOR_VERWURF
#define PICKUP_ANGEWENDET(r) ((void)0)
#else
#define PICKUP_ANGEWENDET(r) pickup(r)
#endif

void Stellwerk::hand(const Griff& g) {
  if (g.regler < 0 || g.regler >= tab_.anzahl()) return;
  if (n_hand_ >= MAX_HAND) {
    z_.hand_verloren++;
    return;
  }
  int k = n_hand_++;
  while (k > 0 && hand_[k - 1].sample > g.sample) {   // stabil nach Sample sortiert
    hand_[k] = hand_[k - 1];
    k--;
  }
  hand_[k] = g;
}

bool Stellwerk::griff_im_zyklus(int r, int64_t& sample) const {
  if (r < 0 || r >= MAX_REGLER || !reg_[r].griff) return false;
  sample = reg_[r].griff_sample;
  return true;
}

bool Stellwerk::griff_letzter_im_zyklus(int r, int64_t& sample) const {
  if (r < 0 || r >= MAX_REGLER || !reg_[r].griff) return false;
  sample = reg_[r].griff_letzt;
  return true;
}

void Stellwerk::pickup(int r) {
  if (!pickup_ || r < 0 || r >= tab_.anzahl()) return;
  float lane;
  if (pickup_->lane_wert(r, lane)) setze_direkt(r, lane);
}

void Stellwerk::markiere_griff(int r, int64_t sample, bool halter_gewechselt) {
#ifdef CYPHERDJ_MUTATION_STELLWERK_GRIFF_NUR_HALTERWECHSEL
  if (!halter_gewechselt) return;   // error case of the plan: a grip is only a change of the holder, so a second grip goes unseen
#else
  (void)halter_gewechselt;
#endif
  ReglerZustand& z = reg_[r];
#ifdef CYPHERDJ_MUTATION_STELLWERK_GRIFF_LETZTER_ERSTER
  if (!z.griff) z.griff_letzt = sample;   // error case: the last-grip sample stays with the first grip
#else
  z.griff_letzt = sample;   // grips come in sample order: the last call of a cycle is the last grip
#endif
#ifndef CYPHERDJ_MUTATION_STELLWERK_GRIFF_SAMPLE_LETZTER
  if (z.griff) return;   // the first grip of the cycle keeps its sample
#else
  if (z.griff) { z.griff_sample = sample; return; }   // error case: the last grip wins
#endif
  z.griff = true;
  z.griff_sample = sample;
  griff_r_[n_griff_++] = static_cast<int16_t>(r);
}

void Stellwerk::deck_taste(int deck, int64_t sample) {
  if (deck < 1 || deck > 4) return;
  char pfad[24];
  std::snprintf(pfad, sizeof pfad, "deck/%d/transport", deck);
  const int r = tab_.suche(pfad);
  if (r >= 0) hand(Griff{sample, static_cast<int16_t>(r), GriffArt::beruehrung, 0.0f, nullptr});
}

bool Stellwerk::deck_beruehrt(int deck) const {
  if (deck < 1 || deck > 4) return false;
  char pfad[24];
  std::snprintf(pfad, sizeof pfad, "deck/%d/transport", deck);
  const int r = tab_.suche(pfad);
  return r >= 0 && reg_[r].halter.art == HalterArt::mensch;
}

// Hält der Mensch Regler r am Sample s? Berücksichtigt Rückgabe nach 32 Beats und eine Freigabe in diesem Zyklus.
bool Stellwerk::mensch_bei(int r, int64_t s, int n_hand_zyklus) const {
  const ReglerZustand& z = reg_[r];
  if (z.halter.art != HalterArt::mensch) return false;
  if (sample_von(uhr_, z.hand_beat + RUECKGABE_BEATS) <= s) return false;
  for (int k = 0; k < n_hand_zyklus; k++)
    if (hand_[k].regler == r && hand_[k].art == GriffArt::freigabe && hand_[k].sample <= s) return false;
  return true;
}

bool pfad_in_liste(const char* liste, const char* pfad) {
  const char* p = liste ? liste : "";
  while (*p) {
    const char* e = p;
    while (*e && *e != ',') e++;
    const size_t n = static_cast<size_t>(e - p);
    if (n == 1 && *p == '*') return true;
    if (n > 0 && p[n - 1] == '/') { if (std::strncmp(pfad, p, n) == 0) return true; }
    else if (n > 0 && std::strlen(pfad) == n && std::strncmp(pfad, p, n) == 0) return true;
    p = *e ? e + 1 : e;
  }
  return false;
}

// /k/hand/frei: the same step as the release gesture (hand_anwenden, freigabe), for every regulator of the list that the human holds.
int Stellwerk::hand_frei(const char* pfade, int64_t sample) {
  int n = 0;
  for (int r = 0; r < tab_.anzahl(); r++) {
    if (reg_[r].halter.art != HalterArt::mensch || !pfad_in_liste(pfade, tab_.def(r).pfad)) continue;
    Halter h;
    if (setze_halter(r, h, sample)) n++;
  }
  return n;
}

// Alle offenen Teile am Regler (laufend und wartend, aus jedem Plan) samt Gruppe ab, Halter mensch am selben Sample.
void Stellwerk::uebernehmen(int r, int64_t sample) {
  for (int j = 0; j < MAX_TEILE; j++) {
    const Teil& t = teil_[j];
    if (t.belegt && t.regler == r) beenden_mit_gruppe(j, Status::abgebrochen, Grund::hand, sample, HalterArt::mensch);
  }
  Halter h;
  h.art = HalterArt::mensch;
  setze_halter(r, h, sample);
}

void Stellwerk::hand_anwenden(const Griff& g, int64_t sample, int i, double beat) {
  const int r = g.regler;
  ReglerZustand& z = reg_[r];
  const ReglerDef& d = tab_.def(r);
  const Kurve& k = g.kurve ? *g.kurve : d.kurve;
#ifdef CYPHERDJ_MUTATION_STELLWERK_PICKUP_VOR_VERWURF
  pickup(r);   // error case: the pickup runs before the discard checks, also for a dead-zone step and a release
#endif
  if (g.art == GriffArt::freigabe) {   // §7.3 Punkt 4: Freigabe-Geste
    if (z.halter.art == HalterArt::mensch) {
      Halter h;
      setze_halter(r, h, sample);
    }
    return;
  }
  if (d.transport) {   // §7.3 Punkt 5: Deck-Halter, kein Wert
    Halter h;
    h.art = HalterArt::mensch;
    setze_halter(r, h, sample);
    z.hand_beat = beat;
    pruefe_nach_hand(r, sample);
    return;
  }
  bool offen = false;
  for (int j = 0; j < MAX_TEILE && !offen; j++) offen = teil_[j].belegt && teil_[j].regler == r;
  const bool plan_haelt = offen && z.halter.art != HalterArt::mensch;
  if (!plan_haelt) z.rel_summe = 0;

  const bool halter_war_mensch = z.halter.art == HalterArt::mensch;
  if (g.art == GriffArt::beruehrung) {   // Berührungssensor: Halterwechsel ohne Wert
    PICKUP_ANGEWENDET(r);   // a touch is always applied
    if (plan_haelt) uebernehmen(r, sample);
    else if (z.halter.art != HalterArt::mensch) {
      Halter h;
      h.art = HalterArt::mensch;
      setze_halter(r, h, sample);
    }
    markiere_griff(r, sample, !halter_war_mensch);
    z.hand_beat = beat;
    pruefe_nach_hand(r, sample);
    return;
  }

  float neu;
  if (g.art == GriffArt::absolut) {
    const float p = std::min(1.0f, std::max(0.0f, g.x));
    if (!z.phys_bekannt) {   // §7.3 Punkt 2: erster Wert setzt nur die Stellung
      z.phys = p;
      z.anker = p;
      z.phys_bekannt = true;
      return;
    }
#ifndef CYPHERDJ_MUTATION_STELLWERK_RESEND_GRIFF
    // 1.12 S3 (AK11 "bewegt"): exactly the known physical position again is a resend without movement. No grip, no pickup, no value, and also
    // no holder change, no hand_beat and no melde_hand: a resend neither takes the regulator over nor extends the 32 beats of the human holder.
    if (p == z.phys) return;
#endif
    if (plan_haelt) {        // §7.3 Punkt 3: Totzone gegen den Übernahmepunkt
      if (std::fabs(p - z.anker) <= TOTZONE + 1e-9) {
#ifdef CYPHERDJ_MUTATION_STELLWERK_GRIFF_IN_TOTZONE
        markiere_griff(r, sample, true);   // error case: a discarded dead-zone step raises the signal
#endif
        z.phys = p;
        return;
      }
      uebernehmen(r, sample);
    }
    PICKUP_ANGEWENDET(r);   // the step is certain to be applied from here on; z.wert below starts from the lane value
    // Übernahme skaliert: Wert folgt in Drehrichtung, Knopf und Wert treffen sich am Anschlag
    double u = ReglerTabelle::zu_x(k, z.wert);
    const double basis = z.phys;
    if (std::fabs(u - basis) < 1.0 / 256) u = p;
    else if (p > basis) u = u + (p - basis) * (1.0 - u) / (1.0 - basis);
    else if (p < basis) u = u - (basis - p) * u / basis;
    neu = ReglerTabelle::aus_x(k, static_cast<float>(u));
    z.phys = p;
    z.anker = p;
  } else {   // relativ: Encoder, Totzone über die aufsummierte Drehung
    if (plan_haelt) {
      z.rel_summe += g.x;
      if (std::fabs(z.rel_summe) <= TOTZONE + 1e-9) return;
      uebernehmen(r, sample);
    }
    PICKUP_ANGEWENDET(r);
    z.rel_summe = 0;
    const double u = ReglerTabelle::zu_x(k, z.wert) + g.x;
    neu = ReglerTabelle::aus_x(k, static_cast<float>(std::min(1.0, std::max(0.0, u))));
  }
  neu = std::min(d.max, std::max(d.min, neu));
  z.hand_beat = beat;
  if (d.ganzzahlig && d.schalt_samples > 0) {
    // F18 (Audit 2026-10-01): ein Schalter mit Schaltrampe (kill/*, 5 ms, §1.5) springt nicht, sondern läuft die
    // Schaltrampe als S-Kurve vom Ist-Wert (dieselbe Formel wie ein Setzen, formel.h). Ein Griff mitten in der Rampe
    // beginnt beim Ist-Wert. Am Griff-Sample steht noch der Ist-Wert (wie ein Teil am Start-Sample, ablauf.cpp:32).
    if (!z.hr_an) {
      z.hr_an = true;
      n_hand_rampen_++;
    }
    z.hr_von = z.wert;
    z.hr_ziel = neu;
    z.hr_sA = sample;
    z.hr_schalt = d.schalt_samples;
    setze_wert(r, i, z.wert);
  } else {
    setze_wert(r, i, neu);
  }
  if (z.halter.art != HalterArt::mensch) {
    Halter h;
    h.art = HalterArt::mensch;
    setze_halter(r, h, sample);
  }
  markiere_griff(r, sample, !halter_war_mensch);
  melde_hand(r, sample);
  pruefe_nach_hand(r, sample);
}

}  // namespace cypherdj::stellwerk
