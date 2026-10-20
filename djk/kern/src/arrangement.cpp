// D1 K1: Modul Arrangement, Transport und Blockschleife (arrangement.h). Der Block wird an jedem Transport-Ereignis
// geteilt (Einsatz, Stopp, Naht), damit es auf seinem Sample wirkt und nicht am Blockanfang.
#include "cypherdj/arrangement.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {
constexpr double EPS = 1e-9;
}  // namespace

Arrangement::Arrangement(const sw::ReglerTabelle& tab) {
  regler_binden(tab);
  klick_form_bauen();
}

int64_t Arrangement::naht_sample(const Karte& k) const {
  if (!klammer() || status_ != ArrStatus::spielt) return -1;
  return std::llround(k.sample_at(bis_ + ursprung_ - start_beat_));
}

ArrZustand Arrangement::zustand(const Karte& k, int64_t s) const {
  ArrZustand z{};
  z.nr = snap_ ? snap_->nr : -1;
  z.status = freeze_ ? ArrStatus::freeze : status_;   // Paket K3
  z.loop_an = freeze_ ? loop_gemerkt_ : loop_an_;
  z.projekt_beat = status_ == ArrStatus::spielt ? projekt_beat(k, static_cast<double>(s)) : start_beat_;
  z.ursprung_sample = start_s_;
  z.start_beat = freeze_ ? start_gemerkt_ : start_beat_;   // Fix L10: während eines Freeze der des Nutzers
  z.metronom_an = metro_an_ && !metronom_gesperrt_;
  return z;
}

const ArrSnapshot* Arrangement::tausche(const ArrSnapshot* neu, int64_t s, const Karte& k) {
  if (freeze_) stopp(0, s, k);   // Paket K3: eine neue Wiedergabe bricht den Freeze ab
  const ArrSnapshot* alt = snap_;
  stimmen_tauschen(neu, s);   // unverändert: neu binden; geändert oder weg: Ausklang aus eigener Kopie
  noten_tauschen(neu, s);     // offene Noten ohne Gegenstück: Off sofort
  senken_wechsel(neu, s);     // Spuren, die ihre Senke verlassen: Ausblende (RB), All Notes Off an den Slot (Wirt)
  snap_ = neu;
  if (status_ == ArrStatus::spielt) einstieg_ = true;   // neue oder geänderte Clips am laufenden Ort ansetzen
  geaendert_ = true;
  return alt;
}

// Fix F2 (Spec 6.28): verlässt eine Spur beim Tausch ihre Senke (andere Art, anderer Slot, leer), endet ihr Klang dort
// ohne Sprung: die RB-Spur blendet über einen Block aus und setzt zurück, ein Wirt-Slot, den keine Spur mehr spielt,
// bekommt All Notes Off und blendet seinen Rückweg aus. Spielt eine weitere Spur denselben Slot, bleibt er unberührt.
void Arrangement::senken_wechsel(const ArrSnapshot* neu, int64_t s) {
#ifdef CYPHERDJ_MUTATION_ARR_SPURWECHSEL_HART
  (void)neu;
  (void)s;
  return;   // Fehlerfall F2: der Ausklang bricht ab, die RB-Stimme friert ein, der Wirt-Slot bekommt kein CC 123
#endif
  for (int i = 0; i < ARR_SPUREN; ++i) {
    ArrSenke* a = senke_fuer(snap_, i);
    if (!a || a == senke_fuer(neu, i)) continue;
    bool andere = false;
    for (int j = 0; j < ARR_SPUREN; ++j) andere = andere || (j != i && senke_fuer(neu, j) == a);
    if (a->spur_weg(i, s, andere)) weg_merken(a, i);
  }
}

void Arrangement::weg_merken(ArrSenke* a, int spur) {
#ifdef CYPHERDJ_MUTATION_ARR_WEG_EIN_PLATZ
  for (int w = 0; w < n_weg_; ++w)   // Fehlerfall (Re-Review K2b): ein Platz je Spur, der zweite Tausch überschreibt den ersten
    if (weg_[w].spur == spur) {
      weg_[w].senke = a;
      return;
    }
#else
  for (int w = 0; w < n_weg_; ++w)
    if (weg_[w].senke == a && weg_[w].spur == spur) return;   // dieselbe Senke blendet dieselbe Spur nur einmal aus
#endif
  if (n_weg_ < ARR_WEG_MAX) weg_[n_weg_++] = ArrWeg{a, spur};
}

bool Arrangement::start(double start_beat, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n,
                        const Karte& k) {
  if (!snap_) return false;
  if (status_ != ArrStatus::steht) {   // läuft schon: endet hier mit Kurzblende, der neue Start folgt der Regel
    stopp(0, s, k);
    beende(s);
  }
  const int64_t frueh = s + vorhalt + n;   // Spec 2.2: frühestens jetzt + Vorhalt (2n + 25) + 1 Zyklus
  const double b_min = k.beat_at(static_cast<double>(frueh));
  double kb = b_min;
  if (quant == 1) kb = std::ceil(b_min - EPS);
  else if (quant == 2) kb = start_beat + 4.0 * std::ceil((b_min - start_beat) / 4.0 - EPS);
#ifdef CYPHERDJ_MUTATION_ARR_START_OHNE_VORHALT
  if (quant == 0) kb = k.beat_at(static_cast<double>(s));   // Fehlerfall: Einsatz am Blockanfang, ohne Vorhalt
#endif
  start_beat_ = start_beat;
  klammer_vorn_ = start_beat < bis_;   // Spec 2.2: Start auf oder hinter bis läuft linear
  ursprung_ = kb;
  start_s_ = std::llround(k.sample_at(kb));
#ifndef CYPHERDJ_MUTATION_ARR_START_OHNE_VORHALT
  if (start_s_ < frueh) start_s_ = frueh;   // Rundung von sample_at(beat_at(frueh)) darf nicht vor frueh fallen
#endif
  stopp_s_ = -1;
  status_ = ArrStatus::wartet;
  von_cypher_ = von_cypher;
  for (int i = 0; i < ARR_SPUREN; ++i) {   // Noten vor dem Einsatz gehen nie hinaus; Senken setzen zurück (K2: RB-FFI)
    gesendet_bis_[i] = start_s_;
    if (ArrSenke* se = senke_fuer(snap_, i)) se->transport_start(i, start_s_);
  }
  geaendert_ = true;
  return true;
}

void Arrangement::stopp(int quant, int64_t s, const Karte& k) {
  if (status_ == ArrStatus::steht) return;
  if (status_ == ArrStatus::wartet) {   // noch nicht eingesetzt: sofort aus
    if (freeze_) freeze_ende(s, 1);     // Paket K3: Freeze vor dem Einsatz abgebrochen
    status_ = ArrStatus::steht;
    stopp_s_ = -1;
    for (int i = 0; i < n_offen_; ++i) offen_[i].aus = offen_[i].an;   // vorab gesendete Noten: Off auf ihr On
    alle_noten_aus(s);
    gestoppt_bei_ = s;
    geaendert_ = true;
    return;
  }
  int64_t ziel = s;
  if (quant == 1 || quant == 2) {
    const double p = projekt_beat(k, static_cast<double>(s));
    const double pz = quant == 1 ? std::ceil(p - EPS) : 4.0 * std::ceil(p / 4.0 - EPS);
    ziel = sample_von_p(k, pz, ursprung_);
    const int64_t w = naht_sample(k);
    if (w >= s && pz >= bis_) ziel = w;   // die Naht kommt vorher: dort endet der Transport
    if (ziel < s) ziel = s;
  }
  stopp_s_ = ziel;
  for (int i = 0; i < n_offen_; ++i) offen_[i].aus = std::max(offen_[i].an, std::min(offen_[i].aus, ziel));
}

void Arrangement::loop(bool an, double von, double bis, int64_t s, const Karte& k) {
  (freeze_ ? loop_gemerkt_ : loop_an_) = an;   // Paket K3: während eines Freeze gilt sie erst danach
  von_ = von;
  bis_ = bis;
  // Spec 2.2: greift nur, wenn der Kopf bis noch von unten erreicht, also das Naht-Sample der Klammer ≥ s ist. Gleich s
  // heißt: dieser Zyklus beginnt auf der Naht (p == bis), block() wrappt an seinem Anfang. Verglichen wird im Sample, wie
  // in block(), nicht im Beat. Steht der Transport (oder wartet er), entscheidet start_beat; sonst linear.
#if defined(CYPHERDJ_MUTATION_ARR_KLAMMER_HINTER_KOPF)
  (void)s;
  (void)k;
  klammer_vorn_ = start_beat_ < bis_;   // Fehlerfall: nur nach start_beat gefragt, die Naht kann hinter dem Kopf liegen
#elif defined(CYPHERDJ_MUTATION_ARR_KLAMMER_NAHT_ZYKLUS)
  const double p = status_ == ArrStatus::spielt ? projekt_beat(k, static_cast<double>(s)) : start_beat_;
  klammer_vorn_ = p < bis_;   // Fehlerfall (K1 Fix 1): im Naht-Zyklus ist p == bis, die Klammer schaltet ab
#else
  if (status_ == ArrStatus::spielt)
    klammer_vorn_ = std::llround(k.sample_at(bis_ + ursprung_ - start_beat_)) >= s;
  else
    klammer_vorn_ = start_beat_ < bis_;
#endif
  geaendert_ = true;
}

void Arrangement::ki_stopp(int64_t s, const Karte& k) {
  if (von_cypher_ && status_ != ArrStatus::steht && stopp_s_ != s) stopp(0, s, k);
}

void Arrangement::beginne(const Karte& k, int64_t s) {
  (void)k;
  status_ = ArrStatus::spielt;
  einstieg_ = true;
  gestartet_bei_ = s;
  if (freeze_) freeze_gestartet_bei_ = s;   // Paket K3
  geaendert_ = true;
}

void Arrangement::beende(int64_t s) {
  if (freeze_ && s < freeze_->start_s + freeze_->frames) freeze_ende(s, 1);   // Paket K3: vor dem Ende abgebrochen
  status_ = ArrStatus::steht;
  stopp_s_ = -1;
  stimmen_stopp(s);   // Kurzblende ab s
  alle_noten_aus(s);  // offene Noten aus, Senken All-Notes-Off
  gestoppt_bei_ = s;
  geaendert_ = true;
}

void Arrangement::wrap(const Karte& k, int64_t s) {
  (void)k;
  ursprung_ += bis_ - von_;
  stimmen_naht();     // die Stimmen des alten Durchlaufs sind auf der Naht ausgeblendet
  einstieg_ = true;   // Clips, die von überspannen, setzen mit Kurz-Einblende ein
  letzte_naht_ = s;
  geaendert_ = true;
}

void Arrangement::segment(const Karte& k, int64_t a, int64_t b, int64_t s0) {
  int64_t naht = -1;
  if (status_ == ArrStatus::spielt && snap_) {
    if (einstieg_) {
      stimmen_einstieg(k, a);
      einstieg_ = false;
    }
    clips_starten(k, a, b);
    naht = naht_sample(k);
  }
  stimmen_spielen(a, b, s0, naht);
  metronom_segment(k, a, b, s0);
}

// Ruhe ohne Wiedergabe: nur die Regler nachführen; die Mute/Solo-Blende steht sofort auf ihrem Ziel (es klingt nichts)
void Arrangement::ruhe(int m) {
  auto ende = [&](int i, int f) { return w_[i][f].vl ? w_[i][f].vl[m - 1] : w_[i][f].w; };
  bool solo = false;
  for (int i = 0; i < ARR_SPUREN; ++i) solo = solo || ende(i, 3) >= 0.5f;
  for (int i = 0; i < ARR_SPUREN; ++i)
    ms_gain_[i] = (ende(i, 2) >= 0.5f || (solo && ende(i, 3) < 0.5f)) ? 0.0f : 1.0f;
  verlaeufe_nachfuehren(m);
}

void Arrangement::block(const Karte& k, int64_t s0, int m, float* aus_l, float* aus_r, float* metro_master_l,
                        float* metro_master_r, float* metro_cue_l, float* metro_cue_r) {
  if (m > ARR_BLOCK) m = ARR_BLOCK;
  const bool weg = n_weg_ > 0;   // Fix F2: eine Senke blendet eine Spur noch aus
  if (!snap_ && n_offen_ == 0 && klick_rest_ == 0 && stimmen() == 0 && !weg) {   // nichts geladen, nichts klingt:
    ruhe(m);                                                                      // DJ-Betrieb ohne Kosten (Slice 11)
    return;
  }
  for (int i = 0; i < ARR_SPUREN; ++i) {
    std::memset(bus_l_[i], 0, sizeof(float) * static_cast<size_t>(m));
    std::memset(bus_r_[i], 0, sizeof(float) * static_cast<size_t>(m));
  }
  metro_l_ = metro_ziel_ == 1 ? metro_cue_l : metro_master_l;
  metro_r_ = metro_ziel_ == 1 ? metro_cue_r : metro_master_r;
  noten_block(k, s0, m);   // Vorausblick: Noten mit Ziel in [s0 + Vorhalt, s0 + m + Vorhalt)
  int64_t a = s0;
  const int64_t e = s0 + m;
  while (a < e) {
    // Ereignisse genau bei a: Einsatz, Stopp, Naht
    if (status_ == ArrStatus::wartet && start_s_ <= a) beginne(k, a);
    if (status_ == ArrStatus::spielt && stopp_s_ >= 0 && stopp_s_ <= a) beende(a);
    if (status_ == ArrStatus::spielt && klammer()) {
      const int64_t w = naht_sample(k);
#ifdef CYPHERDJ_MUTATION_ARR_NAHT_BLOCKANFANG
      if (w >= a && w < e) wrap(k, a);   // Fehlerfall: Wrap am Blockanfang statt am Sample der Naht
#else
      if (w == a) wrap(k, a);
#endif
    }
    // Teilblock bis zum nächsten Ereignis
    int64_t b = e;
    if (status_ == ArrStatus::wartet && start_s_ > a && start_s_ < b) b = start_s_;
    if (status_ == ArrStatus::spielt) {
      if (stopp_s_ > a && stopp_s_ < b) b = stopp_s_;
      const int64_t w = naht_sample(k);
      if (w > a && w < b) b = w;
    }
    segment(k, a, b, s0);
    a = b;
  }
  for (int i = 0; i < ARR_SPUREN; ++i) {
    ArrSenke* se = senke_fuer(snap_, i);
    // Fix F2: jede verlassene Senke blendet die Spur in diesem Block aus; spielt die Spur wieder auf ihr, dort (K2b-Rest b)
    for (int w = 0; w < n_weg_; ++w)
      if (weg_[w].spur == i && weg_[w].senke != se) weg_[w].senke->block(i, s0, m, bus_l_[i], bus_r_[i]);
    if (se) se->block(i, s0, m, bus_l_[i], bus_r_[i]);
  }
  n_weg_ = 0;
  freeze_abgriff(s0, m);   // Paket K3: Spur-Signal vor dem Fader
  mischen(m, aus_l, aus_r);
  verlaeufe_nachfuehren(m);
}

}  // namespace cdj
