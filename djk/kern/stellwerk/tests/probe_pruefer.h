// Probe-Prüfer für die Tests der Scheibe 11: zeigt, dass die Prüfer-Schnittstelle trägt, was Scheibe 20 braucht.
// Keine echte Invariante: I3a nur mit Kanal, Inhalt, Tempo und Frist (ohne Abschnitt), I1 und I2 nur für deck/1 und
// deck/2 ohne Deck-Zustand. Die echten Regeln baut Scheibe 20 in djk/kern/stellwerk/ hinter derselben Schnittstelle.
#pragma once
#include <cmath>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "cypherdj/stellwerk/stellwerk.h"

namespace probe {

using namespace cypherdj::stellwerk;

struct Schein {
  std::string kanal;
  double bpm;
  double gueltig_bis;
  std::string inhalt;   // leer: nicht geprüft
};

class ProbePruefer : public Pruefer {
 public:
  std::map<std::string, Schein> scheine;
  std::map<std::string, std::string> inhalt;   // Kanal -> was dort klingt (Deck-Modell der Probe)
  bool i1 = false, i1_start = false, i2 = false, hand_greift = false;
  std::vector<std::pair<int64_t, float>> hand_gesehen;
  std::vector<std::pair<int64_t, float>> vorschau_ende;   // (Sample, Vorschau) für `beobachtet`
  std::vector<std::string> gefallen;                       // "plan/gruppe/grund@sample" aus gruppe_gefallen
  int beobachtet = -1;
  std::string deckteil_gruppe;                             // eine Deck-Teil-Gruppe außerhalb der Tabelle (wie 20)
  bool deckteil_offen = false;

  Grund vor_teilstart(const Sicht& s, const TeilSicht& t) override {
    const ReglerDef& d = s.tabelle().def(t.regler);
    if (i1_start && tief_offen_am_start(s, t)) return Grund::invariante_sub_doppelt;
    if (d.rolle != Rolle::fader && d.rolle != Rolle::trim) return Grund::kein;
    const int f = s.tabelle().regler_von(d.kanal, Rolle::fader), tr = s.tabelle().regler_von(d.kanal, Rolle::trim);
    // öffnet dieser Teil? Vorher: Stand in der Startfolge ohne ihn; nachher: sein Zielwert am eigenen Regler (eine
    // Rampe öffnet im Lauf, nicht am Start-Sample), der andere Regler mit allen Teilen bis einschließlich ihm
    const double vorher = s.pruefwert_vor(f, t) + s.pruefwert_vor(tr, t);
    const double nachher = (d.rolle == Rolle::fader ? t.nach : s.pruefwert_mit(f, t)) +
                           (d.rolle == Rolle::trim ? t.nach : s.pruefwert_mit(tr, t));
    if (vorher > -26 || nachher <= -26) return Grund::kein;
    auto it = scheine.find(t.hoerschein);
    if (!t.hoerschein[0] || it == scheine.end()) return Grund::kein_hoerschein;
    if (it->second.kanal != s.tabelle().kanal_name(d.kanal)) return Grund::hoerschein_anderer_kanal;
    if (!it->second.inhalt.empty()) {
      const auto k = inhalt.find(it->second.kanal);
      if (k == inhalt.end() || it->second.inhalt != k->second) return Grund::hoerschein_anderer_inhalt;
    }
    if (std::fabs(s.uhr().bpm(t.start_sample) / it->second.bpm - 1) > 0.005) return Grund::hoerschein_anderes_tempo;
    if (s.uhr().beat(t.start_sample) > it->second.gueltig_bis + 1e-9) return Grund::hoerschein_abgelaufen;
    return Grund::kein;
  }

  void je_zyklus(const Sicht& s, Eingriff& e) override {
    const int64_t ende = s.zyklus_anfang() + s.zyklus_laenge() - 1;
    if (beobachtet >= 0) vorschau_ende.emplace_back(ende, s.vorschau(beobachtet, ende));
    TeilSicht t[MAX_TEILE];
    const int n = s.offene_teile(t, MAX_TEILE);
    if (i1) {   // zwei Kanäle "tief offen" am Zyklusende: der Planteil, der den zweiten öffnet, fällt
      for (int k = 0; k < 2; k++) {
        const int andere = 1 - k;
        if (!tief_offen(s, andere, ende, true) || tief_offen(s, k, 0, false) || !tief_offen(s, k, ende, true)) continue;
        for (int j = 0; j < n; j++) {
          if (t[j].intern || s.tabelle().def(t[j].regler).kanal != k) continue;
          e.melde_invariante(InvArt::sub_doppelt, t[j].plan, t[j].nr);
          e.abbrechen(t[j].index, Grund::invariante_sub_doppelt);
        }
      }
    }
    if (i2) {   // der letzte hörbare Kanal würde am Zyklusende unhörbar: seine Teile halten an; hörbar ein anderer: weiter
      int hoerbar_jetzt = 0, hoerbar_ende = 0;
      for (int k = 0; k < 2; k++) {
        hoerbar_jetzt += pegel(s, k, 0, false) > -26;
        hoerbar_ende += pegel(s, k, ende, true) > -26;
      }
      for (int j = 0; j < n; j++) {
        if (t[j].status != Status::gestartet || t[j].intern) continue;
        const int k = s.tabelle().def(t[j].regler).kanal;
        if (!t[j].angehalten && hoerbar_jetzt > 0 && hoerbar_ende == 0 && pegel(s, k, 0, false) > -26) {
          e.melde_invariante(InvArt::master_leer, t[j].plan, t[j].nr);
          e.anhalten(t[j].index);
        } else if (t[j].angehalten && pegel(s, 1 - k, 0, false) > -26) {
          e.fortsetzen(t[j].index);
        }
      }
    }
  }

  void nach_handgriff(const Sicht& s, Eingriff& e, int regler, int64_t sample) override {
    hand_gesehen.emplace_back(sample, s.wert(regler));
    if (!hand_greift) return;
    TeilSicht t[MAX_TEILE];
    const int n = s.offene_teile(t, MAX_TEILE);
    const int ziel = s.tabelle().suche("deck/2/eq/tief");
    for (int j = 0; j < n; j++)
      if (t[j].regler == ziel) e.abbrechen(t[j].index, Grund::invariante_sub_doppelt);
    if (deckteil_offen) e.gruppe_abbrechen("pD", deckteil_gruppe.c_str(), Grund::invariante_sub_doppelt);
  }

  void gruppe_gefallen(const Sicht& s, const char* plan, const char* gruppe, Grund g, int64_t sample) override {
    (void)s;
    gefallen.push_back(std::string(plan) + "/" + gruppe + "/" + name(g) + "@" + std::to_string(sample));
    if (deckteil_offen && std::string(plan) == "pD" && deckteil_gruppe == gruppe) deckteil_offen = false;
  }

 private:
  static double wert(const Sicht& s, int kanal, Rolle rolle, int64_t sample, bool vorschau) {
    const int r = s.tabelle().regler_von(kanal, rolle);
    return vorschau ? s.vorschau(r, sample) : s.wert(r);
  }
  static double pegel(const Sicht& s, int k, int64_t sample, bool v) {
    return wert(s, k, Rolle::fader, sample, v) + wert(s, k, Rolle::trim, sample, v);
  }
  static bool tief_offen(const Sicht& s, int k, int64_t sample, bool v) {
    return pegel(s, k, sample, v) > -26 && wert(s, k, Rolle::kill_tief, sample, v) == 0 && wert(s, k, Rolle::eq_tief, sample, v) > -12;
  }
  // I1 am Start-Sample nach ALLEN Teilen dieses Samples (§17 Reihenfolge): beide Decks tief offen?
  static bool tief_offen_am_start(const Sicht& s, const TeilSicht& t) {
    int n = 0;
    for (int k = 0; k < 2; k++) {
      auto w = [&](Rolle r) { return static_cast<double>(s.pruefwert(s.tabelle().regler_von(k, r), t.start_sample)); };
      n += (w(Rolle::fader) + w(Rolle::trim) > -26 && w(Rolle::kill_tief) == 0 && w(Rolle::eq_tief) > -12);
    }
    return n == 2;
  }
};

}  // namespace probe
