// Hand-Weg: Ausgabe -> stellwerk::Griff, /test/hand -> stellwerk::Griff. Echtzeitfest.
#include "hand/naht_stellwerk.h"

namespace hand {

bool zu_griff(const Ausgabe& a, const Mapping& m, float wert_jetzt, stellwerk::Griff* g) {
  if (a.eintrag < 0 || a.eintrag >= m.n_eintraege) return false;
  const Eintrag& e = m.eintrag[a.eintrag];
  if (e.ziel_art != ZielArt::regler) return false;
  g->sample = a.sample;
  g->regler = e.regler;
  g->kurve = e.eigene_kurve ? &e.kurve : nullptr;
  switch (a.art) {
    case AusgabeArt::regler_absolut:
      g->art = stellwerk::GriffArt::absolut;
      g->x = a.x;
      return true;
    case AusgabeArt::regler_relativ:
      g->art = stellwerk::GriffArt::relativ;
      g->x = a.x;
      return true;
    case AusgabeArt::regler_beruehrung:
      g->art = stellwerk::GriffArt::beruehrung;
      g->x = 0.0f;
      return true;
    case AusgabeArt::regler_umschalten:
      g->art = stellwerk::GriffArt::relativ;
      g->x = wert_jetzt >= 0.5f ? -1.0f : 1.0f;
      g->kurve = nullptr;
      return true;
    default:
      return false;
  }
}

bool test_hand_griff(const stellwerk::ReglerTabelle& tab, const char* pfad, float midi_roh, int64_t sample,
                     stellwerk::Griff* g) {
  const int r = tab.suche(pfad);
  if (r < 0 || tab.def(r).transport) return false;
  g->sample = sample;
  g->regler = static_cast<int16_t>(r);
  g->art = stellwerk::GriffArt::absolut;
  g->x = midi_roh;
  g->kurve = nullptr;
  return true;
}

}  // namespace hand
