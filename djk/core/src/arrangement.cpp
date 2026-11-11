// D1 K1: Modul Arrangement, Transport und Blockschleife (arrangement.h). Der Block wird an jedem Transport-Ereignis
// geteilt (Einsatz, Stopp, Naht), damit es auf seinem Sample wirkt und nicht am Blockanfang.
#include "cypherdj/arrangement.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "cypherdj/reverb_pool.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {
constexpr double EPS = 1e-9;
}  // namespace

Arrangement::Arrangement(const sw::ReglerTabelle& tab, bool mit_hall) : ret_(mit_hall) {
  regler_binden(tab);
  klick_form_bauen();
  for (auto& je_spur : blende_s_)
    for (int64_t& b : je_spur) b = INT64_MIN;
  for (auto& je_spur : blende_s2_)
    for (int64_t& b : je_spur) b = INT64_MIN;
  spur_arbeit_ = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  for (int b = 0; b < ARR_ARBEIT_BAHNEN; ++b) spur_arbeit_[b].bahn = b;
}

int64_t Arrangement::naht_sample(const Karte& k) const {
  if (!klammer() || status_ != ArrStatus::spielt) return -1;
  return std::llround(k.sample_at(bis_ + ursprung_ - start_beat_));
}

double Arrangement::projekt_beat_bei(const Karte& k, int64_t s) const {
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_LINEAR   // error case: the tempo of the grip is taken as constant from the start of the transport
  return static_cast<double>(s - start_s_) * (k.beat_at(static_cast<double>(s)) - k.beat_at(static_cast<double>(s - 1))) + start_beat_;
#else
  double urs = ursprung_;
#ifndef CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_OHNE_NAHT   // error case: the origin of the pass that is about to end is used behind the seam too
  const int64_t w = naht_sample(k);
  if (w >= 0 && s >= w) urs += bis_ - von_;
#endif
  return k.beat_at(static_cast<double>(s)) - urs + start_beat_;
#endif
}

int64_t Arrangement::sample_bei_projekt_beat(const Karte& k, double p, int64_t s_ref) const {
  double urs = ursprung_;
  const int64_t w = naht_sample(k);
  if (w >= 0 && s_ref != INT64_MIN && s_ref >= w) urs += bis_ - von_;   // the pass that runs at s_ref is already the next one
  return sample_von_p(k, p, urs);
}

int64_t Arrangement::naht_bei(const Karte& k, int64_t s_ref) const {
  const int64_t w = naht_sample(k);
  if (w < 0 || s_ref == INT64_MIN || s_ref < w) return w;
  return std::llround(k.sample_at(bis_ + ursprung_ + (bis_ - von_) - start_beat_));   // the seam of the pass after the one that ends at w
}

ArrZustand Arrangement::zustand(const Karte& k, int64_t s) const {
  ArrZustand z{};
  z.nr = snap_ ? snap_->nr : -1;
  z.status = sonderlauf() ? ArrStatus::freeze : status_;   // Paket K3
  z.loop_an = sonderlauf() ? loop_gemerkt_ : loop_an_;
  z.projekt_beat = status_ == ArrStatus::spielt ? projekt_beat(k, static_cast<double>(s)) : start_beat_;
  z.ursprung_sample = start_s_;
  z.start_beat = sonderlauf() ? start_gemerkt_ : start_beat_;   // Fix L10: während eines Freeze der des Nutzers
  z.metronom_an = metro_an_ && !metronom_gesperrt_;
  return z;
}

const ArrSnapshot* Arrangement::tausche(const ArrSnapshot* neu, int64_t s, const Karte& k) {
  if (sonderlauf()) stopp(0, s, k);   // Paket K3: eine neue Wiedergabe bricht den Freeze ab (1.10 slice 7: und den Abgriff)
  const ArrSnapshot* alt = snap_;
  auto_tausch(neu, s);   // Automation Slice 1: needs the old snapshot (snap_), so before it is replaced
  stimmen_tauschen(neu, s, k);   // unverändert: neu binden; geändert oder weg: Ausklang aus eigener Kopie
  noten_tauschen(neu, s);     // offene Noten ohne Gegenstück: Off sofort
  live_tauschen(neu, s);      // 1.8 T7b: held live keys of a track that changes its sink: Off to the sink that got the On
  senken_wechsel(neu, s);     // Spuren, die ihre Senke verlassen: Ausblende (RB), All Notes Off an den Slot (Wirt)
  snap_ = neu;
  ++snap_gen_;
  if (!alt)   // first snapshot: the pre/post flag of the returns stands at once, a later flip blends (review echtzeit-1)
    for (int r = 0; r < ARR_RETURNS; ++r) ret_pre_w_[r] = (neu && neu->ret_pre[r]) ? 1.0f : 0.0f;
  ins_.tausche(neu ? neu->kette : nullptr);   // 1.10 slice 4a: the stages keep, enter or leave by slot identity
  spur_plan_bauen();   // mehrkern slice 3.1: after the swap the sinks see the new snapshot (innen) and the old zuletzt_: exactly what the transition predicate needs
  snap_werk_ = false;   // Slice 2: hat der neue Schnappschuss Clips des Warp-Werks (COMPLEX, TONES)?
  if (snap_)
    for (const ArrSpur& sp : snap_->spur)
      for (int j = 0; sp.art == ArrArt::audio && j < sp.n_clips; ++j) snap_werk_ = snap_werk_ || werk_clip(sp.clips[j]);
#ifdef CYPHERDJ_MUTATION_ARR_HALL_STATE_IM_SNAPSHOT
  for (int r = 0; r < ARR_RETURNS; ++r) ret_.schlafen(r);   // error case: the Hall state is reset on every swap (it would live in the snapshot)
#endif
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
                        const Karte& k, int vorzaehl_beats) {
  if (!snap_) return false;
#ifdef CYPHERDJ_MUTATION_VORZAEHL_IMMER_EINS
  if (vorzaehl_beats <= 0) vorzaehl_beats = 1;   // mutation (S4a.1): one count-in beat also when 0 is passed
#endif
  if (vorzaehl_beats < 0) vorzaehl_beats = 0;
  if (status_ != ArrStatus::steht) {   // läuft schon: endet hier mit Kurzblende, der neue Start folgt der Regel
    stopp(0, s, k);
    beende(s);
  }
  int64_t frueh = s + vorhalt + n;   // Spec 2.2: frühestens jetzt + Vorhalt (2n) + 1 Zyklus
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
  ursprung_ = kb + static_cast<double>(vorzaehl_beats);   // 1.8 S4a (D7): the count-in sits between the first quant point and the entry (+ 0.0 changes nothing)
  vorzaehl_n_ = vorzaehl_beats;
  vorzaehl_kb_ = kb;
  start_s_ = std::llround(k.sample_at(ursprung_));
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
    if (abg_) abg_ende(s, 1);           // 1.10 slice 7: the tap too
    if (exp_) export_ende(s, 1, "abbruch");   // plan 1.11 T12: the export run too
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
    vorzaehl_n_ = 0;   // 1.8 S4a: a stopped wait has no count-in left
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
  (sonderlauf() ? loop_gemerkt_ : loop_an_) = an;   // Paket K3: während eines Freeze gilt sie erst danach
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
// core_arr.cpp) und ihren Freeze (ein Auftrag für sie, Spec 6.27, kein Klang).
void Arrangement::ki_stopp(int64_t s, const Karte& k) {
  if (von_cypher_ && status_ != ArrStatus::steht && stopp_s_ != s && (freeze_ || abg_ || exp_ || status_ == ArrStatus::wartet)) stopp(0, s, k);
}

void Arrangement::beginne(const Karte& k, int64_t s) {
  (void)k;
  vorzaehl_n_ = 0;   // the count-in is over
  status_ = ArrStatus::spielt;
  auto_beginn();
  einstieg_ = true;
  gestartet_bei_ = s;
  if (freeze_) freeze_gestartet_bei_ = s;   // Paket K3
  if (abg_) abg_gestartet_bei_ = s;   // 1.10 slice 7: the onset of the run (receipt 2); the window starts `ankunft` samples later
  if (exp_) exp_gestartet_bei_ = s;   // plan 1.11 T12: the same for the export run
  geaendert_ = true;
}

void Arrangement::beende(int64_t s) {
  if (freeze_ && s < freeze_->start_s + freeze_->frames) freeze_ende(s, 1);   // Paket K3: vor dem Ende abgebrochen
  if (abg_ && s < abg_->start_s + abg_->frames) abg_ende(s, 1);   // 1.10 slice 7: the tap
  if (exp_ && s < exp_->start_s + exp_->frames) export_ende(s, 1, "abbruch");   // plan 1.11 T12
  if (status_ == ArrStatus::spielt) auto_stopp(s);   // Automation Slice 1: the lane ends here, the fader blends to the base value
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
    auto_segment(k, a, b, s0);   // Automation Slice 1: only with a lane in the snapshot
  }
  stimmen_spielen(k, a, b, s0, naht);
  metronom_segment(k, a, b, s0);
}

// Ruhe ohne Wiedergabe und ohne Klang: nur die Regler nachführen; die Mute/Solo-Blende steht sofort auf ihrem Ziel (es klingt nichts).
// Der PM-Abgriff ist Stille (1.10). Ziele bleiben, wie sie sind: ohne Schnappschuss gibt es keine neuen.
void Arrangement::ruhe(int m) {
  ++ruhe_n_;
  ins_.ruhe();   // 1.10 slice 4a: nothing plays, no stage keeps state
  std::memset(pm_l_, 0, sizeof(float) * static_cast<size_t>(m));
  std::memset(pm_r_, 0, sizeof(float) * static_cast<size_t>(m));
  auto ende = [&](int i, int f) { return w_[i][f].vl ? w_[i][f].vl[m - 1] : w_[i][f].w; };
  bool solo = false;
  for (int i = 0; i < ARR_PM; ++i) solo = solo || ende(i, 3) >= 0.5f;   // returns never exist here (ruhe() runs without a playback), so they never count
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
  for (int r = 0; r < ARR_RETURNS; ++r) ms_gain_[ARR_RET0 + r] = ende(ARR_RET0 + r, 2) >= 0.5f ? 0.0f : 1.0f;
  for (int i = 0; i < ARR_SPUREN; ++i) {   // Automation Slice 1: nothing is loaded, no lane and no blend
    for (int f = 0; f < AUTO_FELDER; ++f) {
      blende_n_[i][f] = 0;
      blende_s_[i][f] = INT64_MIN;
      blende_s2_[i][f] = INT64_MIN;
      auto_war_[i][f] = false;
    }
  }
  verlaeufe_nachfuehren(m);
}

void Arrangement::dj_schluessel(const float* const* l, const float* const* r) {
  for (int i = 0; i < DJ_EINGAENGE; ++i) {
    dj_l_[i] = l ? l[i] : nullptr;
    dj_r_[i] = r ? r[i] : nullptr;
  }
}

int Arrangement::spur_bahnen() const {
  if (spur_bahnen_soll_ > 0) return spur_bahnen_soll_;
  if (!spur_pool_) return 1;
  const int n = spur_pool_->faeden() + 1;
  return n > ARR_ARBEIT_BAHNEN ? ARR_ARBEIT_BAHNEN : n;
}

void Arrangement::spur_plan_bauen() {
  const ArrSenke* senken[ARR_SPUREN];
  for (int i = 0; i < ARR_SPUREN; ++i) senken[i] = senke_fuer(snap_, i);
  spur_plan_.baue(senken, spur_bahnen());
  spur_plan_gueltig_ = true;
}

// 1.9 U8 T9 (E12): the member macro targets of every rack track. Caller thread, once per block before phase Q and before any block() (so a lane unit only READS what is written here,
// the vor_phase rule of arr_rack_sink.h), whether the transport runs, waits or stands: the live monitor of a rack must follow its macros too. The macro value is the one
// makros_planen() would use in this block (ArrInserts::makro_wert, the value at the end of the block); the table is its own (ArrRack::g), the insert macro path is not touched.
// A rack track without member targets costs one read of ng per track. The sink decides what a target does to its member (ArrRackSenke::glied_parameter).
void Arrangement::glied_makros_(int64_t s0, int m) {
  (void)s0;
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const ArrRack& r = snap_->rack[i];
    if (r.slot < 0 || r.ng == 0 || snap_->spur[i].art != ArrArt::rack) continue;
    ArrSenke* se = senke_fuer(snap_, i);
    if (!se) continue;
    for (int j = 0; j < r.ng && j < ARR_MAKRO_ZIELE; ++j) {
      const ArrGliedZiel& z = r.g[j];
      if (z.makro >= ARR_MAKROS) continue;
      const float mv = ins_.makro_wert(r.slot, z.makro, m);
#ifdef CYPHERDJ_MUTATION_MAKRO_GLIED_FALSCHES_GLIED
      const int glied = z.glied + 1;   // error case: the member index is off by one
#else
      const int glied = z.glied;
#endif
      se->glied_parameter(i, glied, z.param, z.von + mv * (z.bis - z.von));
    }
  }
}

// Member slots (>= ARR_SPUREN, 1.9 racks) are not plan units: the plan covers the tracks only. A member is rendered by its rack track's sink inside
// that sink's block() or block_bahn(): a rack track whose members are all internal and lane-capable and whose sink is clean (ArrRackSenke::parallel_faehig) is one
// unit of a lane list with all its members, every other rack track is a rest track and renders its members in block() on the caller, as on main.
// Phase Q, serial. A block in which a sink fades a track out (n_weg_ > 0) runs the whole phase in the old order, one sink after the other,
// and the plan is rebuilt at the start of the next block. Otherwise: the lane lists in lane order on the lane-0 struct, then the serial
// remainder (bk, Wirt, racks that are not lane-capable, tracks in a device-change transition) in track order. The tracks write their own bus only, so the bus content is
// the same as the old loop. A track of the remainder that has become able to run on a lane (transition over, sink ready, rack clean again) clears the flag in spur_nach_join().
void Arrangement::spur_quelle(int64_t s0, int m) {
  if (snap_ && senke_rack_ && senke_rack_->vor_phase(s0)) spur_plan_gueltig_ = false;   // caller, before any unit: the rack sink's work that touches other tracks' state
  if (n_weg_ > 0 || !snap_) {
    if (n_weg_ > 0) ++spur_lauf_.z.seriell_weg;
    for (int i = 0; i < ARR_SPUREN; ++i) {
      ArrSenke* se = senke_fuer(snap_, i);
      // Fix F2: jede verlassene Senke blendet die Spur in diesem Block aus; spielt die Spur wieder auf ihr, dort (K2b-Rest b)
      for (int w = 0; w < n_weg_; ++w)
        if (weg_[w].spur == i && weg_[w].senke != se) weg_[w].senke->block(i, s0, m, bus_l_[i], bus_r_[i]);
      if (se) se->block(i, s0, m, bus_l_[i], bus_r_[i]);
    }
    spur_plan_gueltig_ = false;
    return;
  }
  const int modus = spur_modus_.load(std::memory_order_acquire);
  if (modus != spur_modus_gesehen_) {   // the mode changed (possibly from another thread): the plan is rebuilt here, on the callback
    spur_modus_gesehen_ = modus;
    spur_plan_gueltig_ = false;
    spur_lauf_.auto_neu_beginnen();   // a mode change starts the story of automatic retries afresh
  }
  if (!spur_plan_gueltig_) spur_plan_bauen();
  q_s0_ = s0;   // the block position of this phase: the remainder and the units read it (also the workers, after schicke)
  q_m_ = m;
  if (spur_seriell_weil(m)) {
    ArrArbeit& a0 = spur_arbeit_[0];
    for (int b = 0; b < spur_plan_.bahnen(); ++b)
      for (int k = 0; k < spur_plan_.n(b); ++k) spur_einheit_ausfuehren(spur_plan_.spur(b, k), s0, m, a0);
    spur_rest_lauf();
    spur_nach_join();
    return;
  }
  uint32_t mxcsr = 0;
#if defined(__x86_64__) || defined(__i386__)
  mxcsr = _mm_getcsr();   // the callback has no FTZ/DAZ; the workers run the units under this value
#endif
  spur_lauf_.laufen(spur_plan_, *spur_pool_, spur_arbeit_.get(), &Arrangement::spur_einheit, this, &Arrangement::spur_rest, this, mxcsr, zyklus_start_ns_, m);
  spur_nach_join();   // laufen() returns only when every started job is FERTIG (warte reports a missed limit but never returns before): no unit runs any more
}

// The reason the phase stays on the caller, counted; false = fork. The order of the reasons is the order of the checks.
bool Arrangement::spur_seriell_weil(int m) {
  ArrSpurLauf::Zaehler& z = spur_lauf_.z;
  if (spur_modus_gesehen_ == 0) {
    ++z.seriell_aus;
    return true;
  }
  HallPool* p = spur_pool_;
  if (!p || p->faeden() < 1 || !p->fifo()) {   // no pool, or its workers do not run SCHED_FIFO (no track phase under SCHED_OTHER)
    ++z.seriell_fifo;
    return true;
  }
  if (!spur_lauf_.konto_pruefen(*p, spur_modus_gesehen_)) {   // the track account switched itself off (mode auto: after a pause it may be switched on once)
    ++z.seriell_aus;
    return true;
  }
  if (spur_plan_.bahnen() < 2) {
    ++z.seriell_plan;
    return true;
  }
  int live = 0;   // a live unit is a lane-capable track whose sink computes it in this block (loaded, ready, not empty): mute, solo and gain act in mischen and change nothing about the work
  for (int b = 0; b < spur_plan_.bahnen(); ++b)
    for (int k = 0; k < spur_plan_.n(b); ++k) {
      const int i = spur_plan_.spur(b, k);
#ifdef CYPHERDJ_MUTATION_SPUR_LIVE_NACH_GAIN
      live += ms_gain_[i] > 0.0f ? 1 : 0;   // error case: the old criterion, a muted or not soloed track is not counted although it costs the same
#else
      const ArrSenke* se = senke_fuer(snap_, i);
      live += se && !se->leer(i) ? 1 : 0;
#endif
    }
  const int min_last = spur_test_.min_last >= 0 ? spur_test_.min_last : SPUR_MIN_LAST;
  if (live * m < min_last) {
    ++z.seriell_wenig;
    return true;
  }
  if (spur_lauf_.spaet_dran(zyklus_start_ns_, m)) return true;   // the sub-block starts past 50 percent of its period (measured from the cycle stamp): no fork
  return false;
}

void Arrangement::spur_einheit_ausfuehren(int spur, int64_t s0, int m, ArrArbeit& a) {
  if (ArrSenke* se = senke_fuer(snap_, spur)) se->block_bahn(spur, s0, m, bus_l_[spur], bus_r_[spur], a);
}

void Arrangement::spur_einheit(void* ctx, int spur, ArrArbeit& a) {
  Arrangement* self = static_cast<Arrangement*>(ctx);
  self->spur_einheit_ausfuehren(spur, self->q_s0_, self->q_m_, a);
}

void Arrangement::spur_rest(void* ctx) { static_cast<Arrangement*>(ctx)->spur_rest_lauf(); }

// The serial remainder (bk, Wirt, a rack that is not lane-capable, tracks in a device-change transition) in track order, on the caller. It overlaps with the workers:
// it touches nothing but its own tracks and their member slots. Whether a rest track may go back to a lane is asked in spur_nach_join(), after the join.
void Arrangement::spur_rest_lauf() {
  for (int k = 0; k < spur_plan_.n_rest(); ++k) {
    const int i = spur_plan_.rest(k);
    ArrSenke* se = senke_fuer(snap_, i);
    if (!se) continue;
    se->block(i, q_s0_, q_m_, bus_l_[i], bus_r_[i]);
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_REST_EINZELN
    if (se->parallel_faehig(i)) spur_plan_gueltig_ = false;   // error case: asked right after the track's own block, while a rack later in the order still holds the dirt: a clean rack stays in the remainder for good
#endif
  }
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_SAUBER_IM_REST
  for (int i = 0; i < ARR_SPUREN; ++i)   // error case: the cleanliness scan of the rack sink runs here, while the workers render the racks it reads (only a TSan build sees the race)
    if (const ArrSenke* se = senke_fuer(snap_, i))
      (void)se->parallel_faehig(i);
#endif
}

// After every rest track ran and every lane unit is done (the join, or the serial path): a rest track that has become lane-capable drops the plan, which is rebuilt at the
// start of the next block. The question of a rack reads the state of ALL racks (cleanliness), so it is asked here, on the caller, when no unit runs, and only once the whole
// remainder ran (a rack that waits behind a dirty one in the track order must not be judged before the dirty one cleaned up).
void Arrangement::spur_nach_join() {
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_REST_EINZELN
  return;   // error case: only the per-track check inside spur_rest_lauf exists
#endif
  for (int k = 0; k < spur_plan_.n_rest(); ++k) {
    const int i = spur_plan_.rest(k);
    const ArrSenke* se = senke_fuer(snap_, i);
    if (se && se->parallel_faehig(i)) {
      spur_plan_gueltig_ = false;
      return;
    }
  }
}

void Arrangement::block(const Karte& k, int64_t s0, int m, float* aus_l, float* aus_r, float* metro_master_l,
                        float* metro_master_r, float* metro_cue_l, float* metro_cue_r) {
  if (m > ARR_BLOCK) m = ARR_BLOCK;
  pdc_.neuer_block();   // 1.10 slice 4b T13: the delay places not asked in a block lose their history, also across the quiet path
  const bool weg = n_weg_ > 0;   // Fix F2: eine Senke blendet eine Spur noch aus
#ifdef CYPHERDJ_MUTATION_ARR_RUHE_SCHNEIDET_AB
  const bool ret_blendet = false;   // error case: an unloaded playback cuts a return strip off instead of fading it out
#else
  const bool ret_blendet = ret_.blendet();   // 1.10 slice 3 (P15): a return strip still fades, no quiet path yet
#endif
  if (!snap_ && n_offen_ == 0 && klick_rest_ == 0 && stimmen() == 0 && !weg && !ret_blendet) {   // nichts geladen, nichts klingt:
    monitor_loeschen();   // 1.8 S3: the sources are valid for one block only
    ruhe(m);                                                                      // DJ-Betrieb ohne Kosten (Slice 11)
    for (int i = 0; i < DJ_EINGAENGE; ++i) dj_l_[i] = dj_r_[i] = nullptr;         // slice 5 U2b: the pointers of dj_schluessel() are good for one block
    return;
  }
  if (spur_pool_) spur_pool_->block_anfang();   // mehrkern slice 3.1: once per block with work, after the quiet path (the lateness window counts blocks that did pool work); phases Q and H share this block clock
  auto_von_ = auto_bis_ = 0;   // Automation Slice 1: a new block, no lane sample yet
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
  auto_geraet();   // Automation slice 2 (E9): the `geraet` lane values go to the sinks before their block()
  auto_kette();    // 1.12 slice 6: the insert-parameter and rack-macro lane values go to ArrInserts, read by makros_planen() and the chains in mischen()
  glied_makros_(s0, m);   // 1.9 U8 T9 (E12): the macro values of the member targets of the rack tracks, on the caller before phase Q (stopped transport included)
  spur_quelle(s0, m);
  n_weg_ = 0;
  freeze_abgriff(s0, m);   // Paket K3: Spur-Signal vor dem Fader
  abgriff_block(s0, m);    // 1.10 slice 7: block start for mischen() and the tap of a track pre
  export_block(s0, m);     // plan 1.11 T12: block start for the export run (the capture sits at the end of mischen())
  monitor_planen(k, s0, m);   // 1.8 S3 (R10): which external inputs sound; mischen() adds them after the chain and the PDC delay of their track (T1), the freeze tap above never sees them
#ifdef CYPHERDJ_MUTATION_MONITOR_VOR_KETTE
  for (int i = 0; i < ARR_SPUREN; ++i)   // error case (1.8 T1): the monitor sits in the track bus before the insert chain and the PDC delay, as before slice 3b-lite
    if (mon_[i].klingt) { monitor_spur_addieren(i, m, bus_l_[i], bus_r_[i]); mon_[i].klingt = false; }
#endif
  auto_block(s0, m);       // Automation Slice 1: the lane (or its blend) replaces the fader course of a track for this block
  // arr-bk slice 3: beat and tempo for the Baukasten insert stages, once per block (the beat of the project while it plays, so a loop jump is followed; the tempo of the map at the block start)
  ins_.takt(status_ == ArrStatus::spielt ? projekt_beat(k, static_cast<double>(s0)) : k.beat_at(static_cast<double>(s0)), k.bpm_at(static_cast<double>(s0)) / 60.0 / 48000.0);
  mischen(m, aus_l, aus_r);
  monitor_loeschen();   // 1.8 S3: the sources are valid for one block only
  for (int i = 0; i < DJ_EINGAENGE; ++i) dj_l_[i] = dj_r_[i] = nullptr;   // slice 5 U2b: the pointers of dj_schluessel() are good for one block; the next block without a call has a silent DJ key
  verlaeufe_nachfuehren(m);
  auto_ueber_abschluss(s0 + m);   // 1.12 S3: an override change inside this block has passed
  if (werk_) werk_->takt(s0 + m);   // Slice 2: Stand des Callbacks an das Warp-Werk (synchron: es füllt die Ringe jetzt)
}

}  // namespace cdj
