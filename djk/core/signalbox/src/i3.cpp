#include "cypherdj/signalbox/i3.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace cypherdj::stellwerk {

namespace {

// Vergleich zweier fester Zeichenketten-Puffer: begrenzt auf `n` Bytes, nie über das Ende eines Puffers hinaus.
bool text_gleich(const char* a, const char* b, std::size_t n) {
  if (!a || !b) return false;
  return std::strncmp(a, b, n) == 0;
}

bool ist_deck_kanal(const char* kanal_name) { return kanal_name && std::strncmp(kanal_name, "deck/", 5) == 0; }

bool ist_erzeuger_kanal(const char* kanal_name) { return kanal_name && std::strncmp(kanal_name, "erz/", 4) == 0; }

bool ist_pad_kanal(const char* kanal_name) { return kanal_name && std::strncmp(kanal_name, "pad/", 4) == 0; }

bool ist_bus_kanal(const char* kanal_name) { return kanal_name && std::strncmp(kanal_name, "bus/", 4) == 0; }

}  // namespace

void HoerscheinRegister::setze(const Schein& s, double beat_jetzt) {
  int slot = -1;
  for (int i = 0; i < MAX; i++) {
    if (s_[i].belegt && text_gleich(s_[i].hs_id, s.hs_id, sizeof(s_[i].hs_id))) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    for (int i = 0; i < MAX; i++) {
      if (!s_[i].belegt) {
        slot = i;
        break;
      }
    }
  }
  if (slot < 0) {
    for (int i = 0; i < MAX; i++) {   // voll: abgelaufene zuerst verdrängen
      if (s_[i].gueltig_bis < beat_jetzt) {
        slot = i;
        break;
      }
    }
  }
  if (slot < 0) {
    slot = 0;   // sonst den ältesten gueltig_bis
    for (int i = 1; i < MAX; i++)
      if (s_[i].gueltig_bis < s_[slot].gueltig_bis) slot = i;
  }
  s_[slot] = s;
  s_[slot].belegt = true;
  // Defensive Nullterminierung: der Aufrufer könnte einen Puffer ohne Null liefern.
  s_[slot].hs_id[sizeof(s_[slot].hs_id) - 1] = '\0';
  s_[slot].kanal[sizeof(s_[slot].kanal) - 1] = '\0';
  s_[slot].inhalt.material_id[sizeof(s_[slot].inhalt.material_id) - 1] = '\0';
}

void HoerscheinRegister::weg(const char* hs_id) {
  if (!hs_id) return;
  for (int i = 0; i < MAX; i++) {
    if (s_[i].belegt && text_gleich(s_[i].hs_id, hs_id, sizeof(s_[i].hs_id))) {
      s_[i] = Schein{};
      return;
    }
  }
}

const Schein* HoerscheinRegister::finde(const char* hs_id) const {
  if (!hs_id) return nullptr;
  for (int i = 0; i < MAX; i++) {
    if (s_[i].belegt && text_gleich(s_[i].hs_id, hs_id, sizeof(s_[i].hs_id))) return &s_[i];
  }
  return nullptr;
}

Grund PrueferI3::vor_teilstart(const Sicht& s, const TeilSicht& t) {
  if (!an_) return Grund::kein;   // Vorgabe aus (Rev. 2, Review B3)

  const ReglerDef& d = s.tabelle().def(t.regler);
  // D1 K1 (Spec 2.3): die Spur-Regler des Arrangements (spur/*) sind kein Kanal-Fader; I3 nimmt sie aus wie erz und pad
  if (d.rolle == Rolle::spur_fader || d.rolle == Rolle::spur_pan || d.rolle == Rolle::spur_mute ||
      d.rolle == Rolle::spur_solo || d.rolle == Rolle::grp_fader || d.rolle == Rolle::grp_pan ||
      d.rolle == Rolle::grp_mute || d.rolle == Rolle::grp_solo || d.rolle == Rolle::pm_fader)
#ifdef CYPHERDJ_MUTATION_I3_SPUR_GESPERRT
    return t.quelle == Quelle::cypher ? Grund::kein_hoerschein : Grund::kein;   // Fehlerfall: Cypher braucht einen Schein
#else
    return Grund::kein;
#endif
  if (d.rolle != Rolle::fader && d.rolle != Rolle::trim) return Grund::kein;
  const int f = s.tabelle().regler_von(d.kanal, Rolle::fader);
  const int tr = s.tabelle().regler_von(d.kanal, Rolle::trim);
  // öffnet dieser Teil? (§1.6 `offen`: Trim plus Fader, dieselbe Startfolge-Logik wie probe_checker.h)
  const double vorher = s.pruefwert_vor(f, t) + s.pruefwert_vor(tr, t);
  const double nachher = (d.rolle == Rolle::fader ? t.nach : s.pruefwert_mit(f, t)) +
                          (d.rolle == Rolle::trim ? t.nach : s.pruefwert_mit(tr, t));
  if (vorher > -26 || nachher <= -26) return Grund::kein;   // öffnet nicht

  if (t.quelle == Quelle::andreas || t.intern) return Grund::kein;   // die Hand und Andreas' eigene Pläne (§17)

  // Andreas 2026-09-29: „ja sperre kann für strudel kanäle fallen“. Erzeuger-Kanäle erz/* öffnen ohne Hörschein: ihr
  // Inhalt ist Cyphers eigenes Muster. Der Kern hält hier nur Stop Cypher (ki_stopp); AUTO hält der Seiten-Server (409 auto_aus
  // für Cyphers /spur und /regler auf erz/<n>, Studio S6 F4), Stop Cypher dort inkl. Wirt und Muster. Deck-Kanäle bleiben gesperrt.
  const char* kanal_name = s.tabelle().kanal_name(d.kanal);
  if (ist_erzeuger_kanal(kanal_name)) return Grund::kein;
  // Strand 11 (Andreas 2026-11-26, "du solltest alles drehen können"): a bus carries no track of its own, only the sum of strips that are each
  // gated here already; its fader is free for Cypher like the master level. The page server holds the ramp rule (nur_rampe) for big raises.
  if (ist_bus_kanal(kanal_name)) return Grund::kein;

  // Andreas 2026-11-18 (SEQ deck): a channel that carries NO track sounds only what the SEQ deck of that place plays into the strip (ADR 038), Cyphers own patterns.
  // Container core K8 (D-V6): "carries a track" is asked of the player behind the strip: the container input must be `player` (art modul and leer are free,
  // whatever the player holds) and the player must hold a track. Stateless on purpose (no flag that could go stale). A load closes the strip again
  // (core_deck.cpp), so a track never meets an open fader here.
  const int pl = deck_.player(d.kanal);
  Inhalt akt{};
  const bool hat_inhalt = pl > 0 && deck_.inhalt(d.kanal, akt);
  if (pl == 0 && ist_deck_kanal(kanal_name)) return Grund::kein;   // a deck strip without a player (K8: art modul or leer)
  if (pl > 0 && !hat_inhalt) return Grund::kein;                   // a player strip with nothing loaded
  // Andreas 2026-10-05: pad/* wie erz/*; die Herkunftsprüfung (eigener Mitschnitt) liegt in der Seite. Seit K8 gilt das für die Streifen ohne Player;
  // trägt ein pad/<n> Streifen einen Player (Container C, D mit art player), gilt wie für jedes Deck der Hörschein.
  if (pl == 0 && ist_pad_kanal(kanal_name)) return Grund::kein;

  if (!t.hoerschein || !t.hoerschein[0]) return Grund::kein_hoerschein;
  const Schein* sch = reg_.finde(t.hoerschein);
  if (!sch) return Grund::kein_hoerschein;

  // K8 (C7): the key is the player name, not the container path (a pass for deck/3 holds on pad/1 while container C plays player 3)
  char schluessel[16];
  if (pl > 0) std::snprintf(schluessel, sizeof schluessel, "deck/%d", pl);
  else std::snprintf(schluessel, sizeof schluessel, "%s", kanal_name);
#ifdef CYPHERDJ_MUTATION_HOERSCHEIN_NACH_CONTAINERPFAD
  std::snprintf(schluessel, sizeof schluessel, "%s", kanal_name);   // error case: the pass is compared with the container path
#endif
  if (!text_gleich(sch->kanal, schluessel, sizeof(sch->kanal))) return Grund::hoerschein_anderer_kanal;

  if (!hat_inhalt || !text_gleich(akt.material_id, sch->inhalt.material_id, sizeof(akt.material_id)) ||
      akt.bpm_milli != sch->inhalt.bpm_milli || akt.fassung != sch->inhalt.fassung) {
    return Grund::hoerschein_anderer_inhalt;
  }

  if (std::fabs(s.uhr().bpm(t.start_sample) / sch->bpm - 1.0) > 0.005) return Grund::hoerschein_anderes_tempo;
  if (s.uhr().beat(t.start_sample) > sch->gueltig_bis + 1e-9) return Grund::hoerschein_abgelaufen;

  if (pl > 0) {
    const double p = deck_.quell_beat_bei(d.kanal, t.start_sample);
    if (!(p >= sch->quell_von - 1e-9 && p <= sch->quell_bis + 64.0 + 1e-9)) return Grund::hoerschein_anderer_abschnitt;
  }

  return Grund::kein;
}

}  // namespace cypherdj::stellwerk
