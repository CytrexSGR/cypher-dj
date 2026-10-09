// Stellwerk-RT: Zustand, Ausgaben, Halter, Beenden samt Gruppe, Rampenformel, Verläufe.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "formel.h"
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

namespace {
void kopiere(char* ziel, const char* quelle) {
  std::snprintf(ziel, TEXT, "%s", quelle ? quelle : "");
}
}  // namespace

Stellwerk::Stellwerk(const Uhr& uhr, Pruefer* pruefer) : uhr_(uhr), pruefer_(pruefer ? pruefer : &leer_pruefer_) {
  for (int r = 0; r < MAX_REGLER; r++) {
    ReglerZustand& z = reg_[r];
    z = ReglerZustand{};
    z.wert = r < tab_.anzahl() ? tab_.def(r).vorgabe : 0.0f;
    z.laufend = -1;
    z.slot = -1;
    z.hand_beat = -1e18;
    z.gemeldet = z.wert;
    z.gemeldet_sample = INT64_MIN / 2;
    z.hand_gemeldet_sample = INT64_MIN / 2;
  }
  for (Teil& t : teil_) t.belegt = false;
  std::memset(verlauf_, 0, sizeof verlauf_);   // Seiten jetzt anfassen, nicht im ersten Callback
  std::memset(ereignis_, 0, sizeof ereignis_);
}

void Stellwerk::setze_direkt(int r, float wert) {
  if (r < 0 || r >= tab_.anzahl()) return;
  ReglerZustand& z = reg_[r];
  if (z.hr_an) {   // F18: ein direktes Setzen (Laden, Neustart-Zustand) beendet eine Hand-Schaltrampe
    z.hr_an = false;
    n_hand_rampen_--;
  }
  if (z.wert == wert) return;
  z.wert = wert;
  if (!z.direkt) {
    z.direkt = true;
    n_direkt_++;
  }
}

void Stellwerk::stems_geladen(int deck, bool ja) {
  if (deck >= 1 && deck <= 4) stems_[deck] = ja;
}

void Stellwerk::stellung_vergessen() {
  for (int r = 0; r < tab_.anzahl(); r++) reg_[r].phys_bekannt = false;
}

Ereignis* Stellwerk::neues_ereignis(EreignisArt art, int64_t sample) {
  if (n_ereignis_ >= MAX_EREIGNISSE) {
    z_.ereignisse_verloren++;
    return nullptr;
  }
  Ereignis* e = &ereignis_[n_ereignis_++];
  e->art = art;
  e->sample = sample;
  e->id = 0;
  e->quelle = Quelle::andreas;
  e->status = Status::angenommen;
  e->grund = Grund::kein;
  e->regler = -1;
  e->wert = 0;
  e->halter[0] = 0;
  e->gestoppt = false;
  e->inv = InvArt::sub_doppelt;
  e->plan[0] = 0;
  e->teil = 0;
  return e;
}

void Stellwerk::quittung_befehl(int64_t id, Quelle q, Status st, int64_t sample, Grund g) {
  if (id == 0) return;   // Stopp-Taste und interne Teile: kein Befehl, keine Quittung
  Ereignis* e = neues_ereignis(EreignisArt::quittung, sample);
  if (!e) return;
  e->id = id;
  e->quelle = q;
  e->status = st;
  e->grund = g;
}

void Stellwerk::quittung(const Teil& t, Status st, int64_t sample, Grund g) {
  if (t.intern) return;
  quittung_befehl(t.id, t.quelle, st, sample, g);
}

void Stellwerk::melde_regler(int r, int64_t sample) {
  ReglerZustand& z = reg_[r];
  Ereignis* e = neues_ereignis(EreignisArt::regler, sample);
  if (!e) return;
  e->regler = static_cast<int16_t>(r);
  e->wert = fest(z);
  halter_text(z.halter, e->halter, TEXT);
  z.gemeldet = fest(z);
  z.gemeldet_sample = sample;
}

bool Stellwerk::setze_halter(int r, const Halter& h, int64_t sample) {
  ReglerZustand& z = reg_[r];
  const bool gleich = z.halter.art == h.art && z.halter.quelle == h.quelle && std::strcmp(z.halter.plan, h.plan) == 0;
  if (gleich) return false;
  if (z.halter.art == HalterArt::mensch) n_mensch_--;
  if (h.art == HalterArt::mensch) n_mensch_++;
  z.halter = h;
  Ereignis* e = neues_ereignis(EreignisArt::halter, sample);
  if (e) {
    e->regler = static_cast<int16_t>(r);
    halter_text(h, e->halter, TEXT);
  }
  if (!tab_.def(r).transport) melde_regler(r, sample);   // §5.7: immer bei Halterwechsel (transport ist kein Regler)
  return true;
}

Halter Stellwerk::halter_fuer(const Teil& t) const {
  Halter h;
  if (t.plan[0]) {
    h.art = HalterArt::plan;
    kopiere(h.plan, t.plan);
  } else {
    h.art = HalterArt::quelle;
    h.quelle = t.quelle;
  }
  return h;
}

bool Stellwerk::haelt(const Halter& h, const Teil& t) const {
  if (t.plan[0]) return h.art == HalterArt::plan && std::strcmp(h.plan, t.plan) == 0;
  return h.art == HalterArt::quelle && h.quelle == t.quelle;
}

int Stellwerk::neuer_teil() {
  for (int i = 0; i < MAX_TEILE; i++) {
    if (!teil_[i].belegt) {
      teil_[i] = Teil{};
      teil_[i].belegt = true;
      return i;
    }
  }
  return -1;
}

void Stellwerk::laufend_rein(int idx) {
  laufende_[n_laufende_++] = static_cast<int16_t>(idx);
  reg_[teil_[idx].regler].laufend = static_cast<int16_t>(idx);
}

void Stellwerk::laufend_raus(int idx) {
  for (int j = 0; j < n_laufende_; j++) {
    if (laufende_[j] == idx) {
      laufende_[j] = laufende_[--n_laufende_];
      break;
    }
  }
  ReglerZustand& z = reg_[teil_[idx].regler];
  if (z.laufend == idx) z.laufend = -1;
}

// Beendet einen offenen Teil. Ein laufender Teil hält am Ist-Wert (der Wert des Reglers bleibt, wie er ist).
void Stellwerk::beenden(int idx, Status st, Grund g, int64_t sample, HalterArt halter_neu) {
  Teil& t = teil_[idx];
  if (!t.belegt) return;
  const bool lief = t.status == Status::gestartet;
  quittung(t, st, sample, g);
  if (lief) {
    laufend_raus(idx);
    bool gemeldet = false;
    if (haelt(reg_[t.regler].halter, t)) {
      Halter h;
      h.art = halter_neu;
      gemeldet = setze_halter(t.regler, h, sample);
    }
    if (!gemeldet) melde_regler(t.regler, sample);   // §5.7: immer bei Teilende
  }
  t.belegt = false;
}

// Alle Teile eines Plans mit gleicher (nicht leerer) Gruppe fallen gemeinsam (§4.3 Feld 11); danach erfährt es der
// Prüfer (Deck-Teile, die Scheibe 20 außerhalb der Regler-Tabelle führt, fallen mit, §4.4).
void Stellwerk::beenden_mit_gruppe(int idx, Status st, Grund g, int64_t sample, HalterArt halter_neu) {
  Teil& t = teil_[idx];
  if (!t.belegt) return;
  int16_t mit[MAX_TEILE];
  int n = 0;
  char plan[TEXT], gruppe[TEXT];
  kopiere(plan, t.plan);
  kopiere(gruppe, t.gruppe);
  if (gruppe[0]) {
    for (int j = 0; j < MAX_TEILE; j++) {
      const Teil& u = teil_[j];
      if (j != idx && u.belegt && std::strcmp(u.plan, plan) == 0 && std::strcmp(u.gruppe, gruppe) == 0)
        mit[n++] = static_cast<int16_t>(j);
    }
  }
  beenden(idx, st, g, sample, halter_neu);
  const Status st_mit = st == Status::abgelehnt ? Status::abgebrochen : st;
  for (int j = 0; j < n; j++) beenden(mit[j], st_mit, g, sample, HalterArt::frei);
  if (gruppe[0]) melde_gruppe_gefallen(plan, gruppe, g, sample);
}

// §4.3: w0 = Ist-Wert (oder Zielwert eines Setzens am selben Sample). §1.2: Rampen von oder nach stumm laufen über
// -60 dB, aber nie lauter als ihre beiden Enden (Festlegung F3, wie Scheibe 04 F3): stumm -> -80 steht sofort auf -80,
// -80 -> stumm bleibt bei -80 und ist am Ende stumm, stumm -> stumm bleibt stumm.
void Stellwerk::start_parameter(Teil& t, float w0, double beat, int64_t sample) const {
  const ReglerDef& d = tab_.def(t.regler);
  if (d.db && w0 <= STUMM_GRENZE && t.nach > STUMM_GRENZE) w0 = std::min(STUMM_RAMPE, t.nach);
  t.ziel_intern = (d.db && t.nach <= STUMM_GRENZE) ? std::min(STUMM_RAMPE, w0) : t.nach;
  t.wA = w0;
  t.bA = beat;
  t.ende_beat = t.ab_beat + t.dauer_beats;
  t.sA = sample;
  t.setzen_modus = t.dauer_beats == 0.0 || (t.verspaetet && beat >= t.ende_beat);
  t.schalt = t.setzen_modus ? d.schalt_samples : 0;
}

float Stellwerk::wert_von(const Teil& t, int64_t sample, double beat, bool* fertig) const {
  bool f = false;
  const double u = t.setzen_modus ? formel::anteil_setzen(sample, t.sA, t.schalt, &f) : formel::anteil_rampe(beat, t.bA, t.ende_beat, &f);
  if (fertig) *fertig = f;
  const float end_wert = (tab_.def(t.regler).db && t.nach <= STUMM_GRENZE) ? STUMM : t.nach;
  return formel::wert(u, f, t.setzen_modus || t.form == 1, t.wA, t.ziel_intern, end_wert);   // Schaltrampe: S (F2)
}

double Stellwerk::beat_bei(int64_t sample) const {
  const int64_t i = sample - zyklus_s0_;
  if (i >= 0 && i <= zyklus_n_) return beats_[i];
  return uhr_.beat(sample);
}

// Verlaufs-Slot für Regler r ab Sample-Index i; die Samples davor tragen den alten Wert.
int Stellwerk::slot_fuer(int r, int i) {
  ReglerZustand& z = reg_[r];
  if (z.slot >= 0) return z.slot;
  if (n_aend_ >= MAX_BEWEGT) {
    z_.bewegt_voll++;
    return -1;
  }
  const int s = n_aend_++;
  z.slot = static_cast<int16_t>(s);
  aend_[s].regler = static_cast<int16_t>(r);
  aend_[s].verlauf = verlauf_[s];
  for (int k = 0; k < i; k++) verlauf_[s][k] = z.wert;
  verlauf_bis_[s] = i;
  return s;
}

void Stellwerk::setze_wert(int r, int i, float v) {
  const int s = slot_fuer(r, i);
  if (s >= 0) {
    float* vl = verlauf_[s];
    const float alt = verlauf_bis_[s] > 0 ? vl[verlauf_bis_[s] - 1] : reg_[r].wert;
    for (int k = verlauf_bis_[s]; k < i; k++) vl[k] = alt;
    vl[i] = v;
    verlauf_bis_[s] = i + 1;
  }
  reg_[r].wert = v;
}

}  // namespace cypherdj::stellwerk
