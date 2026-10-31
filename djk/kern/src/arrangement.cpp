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
  stimmen_tauschen(neu, s, k);   // unverändert: neu binden; geändert oder weg: Ausklang aus eigener Kopie
  noten_tauschen(neu, s);     // offene Noten ohne Gegenstück: Off sofort
  senken_wechsel(neu, s);     // Spuren, die ihre Senke verlassen: Ausblende (RB), All Notes Off an den Slot (Wirt)
  snap_ = neu;
  snap_werk_ = false;   // Slice 2: hat der neue Schnappschuss Clips des Warp-Werks (COMPLEX, TONES)?
  if (snap_)
    for (const ArrSpur& sp : snap_->spur)
      for (int j = 0; sp.art == ArrArt::audio && j < sp.n_clips; ++j) snap_werk_ = snap_werk_ || werk_clip(sp.clips[j]);
  for (bool& b : grp_belegt_) b = false;   // 1.10: Gruppen mit Mitgliedern (Pegel-Meldung)
  if (snap_)
    for (const ArrSpur& sp : snap_->spur)
      if (sp.art != ArrArt::leer && sp.ausgang > 0) grp_belegt_[sp.ausgang - 1] = true;
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
  int64_t frueh = s + vorhalt + n;   // Spec 2.2: frühestens jetzt + Vorhalt (2n + 25) + 1 Zyklus
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_START_OHNE_FRIST   // Fehlerfall: der Start gibt dem Werk keine Zeit, ein klingender Clip setzt spät und mit Einblende ein
  if (werk_am_start(start_beat)) frueh += ARR_WARP_FRIST;
#endif   // Slice 2: das Werk braucht die Zeit, um den klingenden Clip vor dem Einsatz zu rechnen
  if (karte_gen_) karte_gen_gesehen_ = *karte_gen_;
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
  beendet_s_ = -1;   // 1.8: neuer Lauf
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
    // Slice 2: vorab angesetzte Stimmen des Werks haben nie geklungen. Nachbesserung 5 (Prüfung 5, fable m6): eine Werk-Stimme, die schon in der Ausblende ist (ab_aus
    // gesetzt und erreicht, Einsatz davor), stammt vom vorigen Lauf (start() bei laufendem Transport: stopp, beende, dann der Stopp im selben Block); sie blendet zu Ende,
    // statt hart zu enden. Nur die Ausblende zählt, nicht werk_ab < s: der Stopp kann ein Ziel-Sample hinter einem noch ausstehenden Einsatz tragen (Zufallsfolgen, Seed 25).
    // Nachbesserung 6 (Flanke 18 a, verdichtete Seeds 6829, 8786, 10156, 11193): die Ausnahme hing an s, und ein Ziel hinter dem Ende einer Brücke dieses Laufs (karte_spaeter,
    // Tausch, Marker vor dem Einsatz: ab_aus = Ereignis + Frist) machte sie zur „Ausblendenden“, die nie geklungen hat und nach dem Stopp 400 bis 900 Samples voll klang.
    // Eine Stimme des vorigen Laufs setzt vor dem Einsatz dieses Laufs ein (werk_ab < start_s_), jede dieses Laufs danach (der Vorausblick setzt bei s_h ≥ start_s_, Brücken erben
    // werk_ab): daran, nicht am Ziel-Sample, hängt die Ausnahme
    for (Stimme& v : st_)
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_STOPP_WARTET_HART   // Fehlerfall (Prüfung 5, fable m6): der Stopp im Wartezustand schneidet auch die Ausblendenden hart ab (Knack)
      if (v.aktiv && v.werk >= 0) werk_frei(v);
#else
      if (v.aktiv && v.werk >= 0 && !(v.ab_aus >= 0 && v.ab_aus <= s && v.werk_ab < v.ab_aus && v.werk_ab < start_s_)) werk_frei(v);
#endif
    status_ = ArrStatus::steht;
    stopp_s_ = -1;
    for (int i = 0; i < n_offen_; ++i) offen_[i].aus = offen_[i].an;   // vorab gesendete Noten: Off auf ihr On
    alle_noten_aus(s);
    gestoppt_bei_ = s;
    beendet_s_ = s;   // 1.8
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
  werk_naechste_verwerfen();   // Slice 2: vorab für den Durchlauf nach der alten Naht angesetzt; das Vorausblick setzt sie mit der neuen Klammer neu an
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

// Entscheidung E-a (Andreas 2026-10-20: „was klingt, klingt weiter“, „du solltest dann nur nicht mehr eingreifen“; Cypher, 2026-10-20: ein Start nach dem
// Knopf wäre ein Eingriff nach dem Stopp): der KI-Stopp beendet einen LAUFENDEN Transport von cypher nicht mehr, Andreas übernimmt ihn (vorher D1 Spec 2.12,
// 6.37). Was noch nicht klingt, verwirft er wie bisher: einen wartenden Start von cypher (status wartet, Einsatz steht aus; Quittung 7 ki_stopp aus
// kern_arr.cpp) und ihren Freeze (ein Auftrag für sie, Spec 6.27, kein Klang).
void Arrangement::ki_stopp(int64_t s, const Karte& k) {
  if (von_cypher_ && status_ != ArrStatus::steht && stopp_s_ != s && (freeze_ || status_ == ArrStatus::wartet)) stopp(0, s, k);
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
  beendet_s_ = s;   // 1.8
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
  stimmen_spielen(k, a, b, s0, naht);
  metronom_segment(k, a, b, s0);
}

// Ruhe ohne Wiedergabe und ohne Klang: nur die Regler nachführen; die Mute/Solo-Blende steht sofort auf ihrem Ziel (es klingt nichts).
// Der PM-Abgriff ist Stille (1.10). Ziele bleiben, wie sie sind: ohne Schnappschuss gibt es keine neuen.
void Arrangement::ruhe(int m) {
  std::memset(pm_l_, 0, sizeof(float) * static_cast<size_t>(m));
  std::memset(pm_r_, 0, sizeof(float) * static_cast<size_t>(m));
  auto ende = [&](int i, int f) { return w_[i][f].vl ? w_[i][f].vl[m - 1] : w_[i][f].w; };
  bool solo = false;
  for (int i = 0; i < ARR_PM; ++i) solo = solo || ende(i, 3) >= 0.5f;
  bool msolo[ARR_GRUPPEN] = {};
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (ziel_[i] > 0 && ende(i, 3) >= 0.5f) msolo[ziel_[i] - 1] = true;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const bool gs = ziel_[i] > 0 && ende(ARR_SPUREN + ziel_[i] - 1, 3) >= 0.5f;
    ms_gain_[i] = (ende(i, 2) >= 0.5f || (solo && ende(i, 3) < 0.5f && !gs)) ? 0.0f : 1.0f;
  }
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    const int s = ARR_SPUREN + g;
    ms_gain_[s] = (ende(s, 2) >= 0.5f || (solo && ende(s, 3) < 0.5f && !msolo[g])) ? 0.0f : 1.0f;
  }
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
  const bool karte_neu = karte_gen_ && *karte_gen_ != karte_gen_gesehen_;   // Paket 1.13: eine neue Generation der Karte, seit dem letzten Block
  if (karte_neu) {
    karte_gen_gesehen_ = *karte_gen_;
    stimmen_karte_neu(k);   // Nachbesserung 4 (N2): RE-PITCH-Stimmen enden am Clip-Ende der neuen Karte
  }
  if (werk_ && snap_ && snap_werk_) {   // Slice 2: Stimmen des Warp-Werks ARR_WARP_FRIST Samples vor ihrem Einsatz ansetzen; eine neue Karte setzt sie neu an
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_KARTE_IGNORIERT   // Fehlerfall: die Stimmen behalten die alte Karte, nach einer Tempo-Rampe liegen sie neben dem Raster
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_KARTE_WARTET   // Fehlerfall (Nachbesserung 3): im Wartezustand behalten die vorab angesetzten Stimmen die alte Karte, bis zum Ende ihres Clips
    if (status_ == ArrStatus::spielt && karte_neu) warp_karte_neu(k, s0);
#else
    if ((status_ == ArrStatus::spielt || status_ == ArrStatus::wartet) && karte_neu) warp_karte_neu(k, s0);   // neue Generation: die gebundenen Stimmen werden Brücken
#endif
#endif
    werk_decken(k, s0, m);   // Nachbesserung 4: jede Brücke hat ihre Nachfolgerin (Tausch, Karte, Nachholen bei vollem Pool)
    warp_vorausblick(k, s0, m);
  }
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
  if (werk_) werk_->takt(s0 + m);   // Slice 2: Stand des Callbacks an das Warp-Werk (synchron: es füllt die Ringe jetzt)
}

}  // namespace cdj
