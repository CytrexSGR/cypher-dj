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

  if (g.art == GriffArt::beruehrung) {   // Berührungssensor: Halterwechsel ohne Wert
    if (plan_haelt) uebernehmen(r, sample);
    else if (z.halter.art != HalterArt::mensch) {
      Halter h;
      h.art = HalterArt::mensch;
      setze_halter(r, h, sample);
    }
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
    if (plan_haelt) {        // §7.3 Punkt 3: Totzone gegen den Übernahmepunkt
      if (std::fabs(p - z.anker) <= TOTZONE + 1e-9) {
        z.phys = p;
        return;
      }
      uebernehmen(r, sample);
    }
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
    z.rel_summe = 0;
    const double u = ReglerTabelle::zu_x(k, z.wert) + g.x;
    neu = ReglerTabelle::aus_x(k, static_cast<float>(std::min(1.0, std::max(0.0, u))));
  }
  neu = std::min(d.max, std::max(d.min, neu));
  z.hand_beat = beat;
  setze_wert(r, i, neu);
  if (z.halter.art != HalterArt::mensch) {
    Halter h;
    h.art = HalterArt::mensch;
    setze_halter(r, h, sample);
  }
  melde_hand(r, sample);
  pruefe_nach_hand(r, sample);
}

}  // namespace cypherdj::stellwerk
