#include "cypherdj/stellwerk/i3.h"

#include <cmath>
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
  if (d.rolle != Rolle::fader && d.rolle != Rolle::trim) return Grund::kein;
  const int f = s.tabelle().regler_von(d.kanal, Rolle::fader);
  const int tr = s.tabelle().regler_von(d.kanal, Rolle::trim);
  // öffnet dieser Teil? (§1.6 `offen`: Trim plus Fader, dieselbe Startfolge-Logik wie probe_pruefer.h)
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
  // Andreas 2026-10-05: pad/* wie erz/*; die Herkunftsprüfung (eigener Mitschnitt) liegt in der Seite.
  if (ist_pad_kanal(kanal_name)) return Grund::kein;

  if (!t.hoerschein || !t.hoerschein[0]) return Grund::kein_hoerschein;
  const Schein* sch = reg_.finde(t.hoerschein);
  if (!sch) return Grund::kein_hoerschein;

  if (!text_gleich(sch->kanal, kanal_name, sizeof(sch->kanal))) return Grund::hoerschein_anderer_kanal;

  Inhalt akt{};
  const bool hat_inhalt = deck_.inhalt(d.kanal, akt);
  if (!hat_inhalt || !text_gleich(akt.material_id, sch->inhalt.material_id, sizeof(akt.material_id)) ||
      akt.bpm_milli != sch->inhalt.bpm_milli || akt.fassung != sch->inhalt.fassung) {
    return Grund::hoerschein_anderer_inhalt;
  }

  if (std::fabs(s.uhr().bpm(t.start_sample) / sch->bpm - 1.0) > 0.005) return Grund::hoerschein_anderes_tempo;
  if (s.uhr().beat(t.start_sample) > sch->gueltig_bis + 1e-9) return Grund::hoerschein_abgelaufen;

  if (ist_deck_kanal(kanal_name)) {
    const double p = deck_.quell_beat_bei(d.kanal, t.start_sample);
    if (!(p >= sch->quell_von - 1e-9 && p <= sch->quell_bis + 64.0 + 1e-9)) return Grund::hoerschein_anderer_abschnitt;
  }

  return Grund::kein;
}

}  // namespace cypherdj::stellwerk
