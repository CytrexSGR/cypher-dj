// Paket 1.13 Warp, Slice 2: die Seite des Arrangements am Warp-Werk (warp_werk.h). Ein Clip im Modus COMPLEX oder TONES rechnet das Werk voraus;
// die Stimme im Callback liest nur ihren Ring (Kopie plus Gain). Hier steht, wann eine Stimme angesetzt wird (ARR_WARP_FRIST Samples vor dem Einsatz,
// auch für den Durchlauf nach der Naht), wie sie liest (Lücken blenden aus und ein, gezählt), wie sie beim Tausch und bei einer neuen Karten-
// Generation weiterspielt und wie sie endet. Echtzeit: keine Allokation, keine Sperre, kein Systemaufruf im Callback.
// Nachbesserung 4 (Prüfung 4, B1): die Invariante der Werk-Stimmen steht an EINER Stelle, werk_decken. Ein Ereignis, das neue Werk-Daten braucht (Tausch mit
// geänderten Warp-Daten, neue Karten-Generation), macht die gebundene Stimme zur Brücke (werk_abloesen): sie spielt den alten Stand aus ihrem Ring bis s +
// ARR_WARP_FRIST (oder gibt ihren Platz, wenn sie noch nicht klingt und der neue Stand an ihrem Einsatz nicht klingt). werk_decken sorgt in jedem Block dafür, dass
// jede Brücke, deren Clip nach ihrem Ende im gültigen Stand weiterklingt, eine Nachfolgerin hat, die dort mit Überblendung über ARR_NAHT einsetzt; folgt ein
// Ereignis, bevor die Übergabe fertig ist, verlängert die ältere Brücke statt einer zweiten (höchstens zwei Stimmen je Clip, die nicht ausblenden). Vorausblick
// und Einstieg überlassen jeden Clip mit Brücke werk_decken. Bei vollem Pool: neue Karte, die Brücke spielt weiter, bis ein Platz frei ist (Nachholen); Tausch,
// eine stumme Brücke gibt ihren Platz (Platztausch), eine klingende macht dem Clip ab dem Block als RE-PITCH Platz (warp_kein_platz).
// Nachbesserung 5 (Prüfung 5, opus F1 und fable M1: bei Platzdruck an einer gemeinsamen Clip-Grenze hielten Stimmen Plätze, die nie oder 313 Samples klangen, die
// gebrauchte Stimme bekam keinen, der Vorausblick gab still auf) EINE Regel, der Pool ist für Klang da, mit drei Seiten an drei Stellen:
//  (a) kein Platz ohne Klang: eine stumme Stimme, die der gültige Stand nie klingen lässt (Naht oder Stopp vor ihrem Einsatz, Clip hinter der Klammer), gibt ihren
//      Platz im selben Block (werk_decken, Punkt 0), nicht erst an der Naht;
//  (b) kein Einsatz wartet still: ist der Ring zum Einsatz leer (spät, gezählt), klingt der Clip aus dem Clip als RE-PITCH, bis der Ring liefert, und blendet dann
//      über ARR_NAHT über (werk_stimme_spielen); clips_starten setzt eine Stimme mit Einsatz jetzt und Ring ab a + Frist an, statt den Clip eine Frist schweigen zu lassen;
//  (c) Vorrang bei vollem Pool: der Vorausblick verdrängt für einen Einsatz eine stumme Nachfolgerin, die kürzer klingen würde als er (werk_verdraengen); ihre
//      Brücke holt nach (Karte) oder der Clip spielt RE-PITCH (Tausch), gezählt wie bisher. Vorher nahm die Nachfolgerin eines endenden Clips (313 Samples) den Platz
//      des Clips, der dort acht Beats klingen sollte.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
constexpr double EPS = 1e-9;

// W2-Kosten S4: die Karte eines Auftrags nur mit den benutzten Segmenten übernehmen (n_ von höchstens 64, im Betrieb 1 bis 3) statt der ganzen Karte (2 568 Byte). Jede Abfrage der
// Karte (beat_at, sample_at, bpm_at, k_at, index_*) liest nur Segmente unter n_; setze() übernimmt genau diese und n_. Ungültige Anzahl (nie): ganze Karte.
inline void karte_kurz(Karte& ziel, const Karte& quelle) {
  if (!ziel.setze(&quelle.segment(0), quelle.anzahl())) ziel = quelle;
}
}  // namespace

int Arrangement::werk_stimmen() const {
  int n = 0;
  for (const Stimme& v : st_) n += (v.aktiv && v.werk >= 0) ? 1 : 0;
  return n;
}

bool Arrangement::hat_stimme(int spur, uint64_t clip_id, int64_t clip_s0) const {
  for (const Stimme& v : st_)
    if (v.aktiv && v.clip && v.spur == spur && v.clip_id == clip_id && v.clip_s0 == clip_s0) return true;
  return false;
}

void Arrangement::werk_frei(Stimme& v) {
  if (v.werk >= 0 && werk_) werk_->gib(v.werk);
  v.werk = -1;
  v.aktiv = false;
  v.naechste = false;
  v.tausch_bruecke = false;
  v.gain_ab = -1;
}

// Eine Stimme im Werk ansetzen. s_h: erstes Sample, das das Werk liefert; clip_s0: (auch vergangenes) Einsatz-Sample des Clips, nach dem sich Ein- und
// Ausblende des Clips richten; urs: der Ursprung des Durchlaufs, zu dem die Stimme gehört. nullptr: kein Platz (Werk voll, fehlt) oder kein freier Stimmenplatz.
Arrangement::Stimme* Arrangement::werk_stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_h, int64_t clip_s0, bool rampe, int ramp_n,
                                                      double urs, bool naechste, int64_t ab) {
  if (!werk_) return nullptr;
  if (ab == INT64_MIN || ab > s_h) ab = s_h;
  Stimme* v = nullptr;
  for (Stimme& x : st_)
    if (!x.aktiv) {
      v = &x;
      break;
    }
  if (!v) {   // der Stimmen-Pool ist voll: gezählt wie bei den anderen Stimmen, der Clip bleibt still
    ++stimmen_verloren_;
    return nullptr;
  }
  const int platz = werk_->belege();
  if (platz < 0) return nullptr;
  v->aktiv = true;
  v->spur = spur;
  v->clip_id = c.id;
  v->clip = &c;
  v->clip_s0 = clip_s0;
  v->ende = sample_von_p(k, c.start_beat + c.laenge_beats, urs);
  v->ein_n = c.ein_beats > 0.0 ? sample_von_p(k, c.start_beat + c.ein_beats, urs) - clip_s0 : 0;
  v->aus_n = c.aus_beats > 0.0 ? v->ende - sample_von_p(k, c.start_beat + c.laenge_beats - c.aus_beats, urs) : 0;
  v->ramp_ein_ab = rampe ? s_h : -1;
  v->ab_aus = -1;
  v->p_off = start_beat_ - urs;
  v->ak_n = v->ak_pos = 0;
  v->werk = platz;
  v->werk_ab = ab;   // Nachbesserung 5: liegt der Einsatz vor dem Ringbeginn s_h, ist der Ring dort leer (spät) und der Clip klingt bis s_h als RE-PITCH (werk_stimme_spielen)
  v->gain = c.gain;
  v->gain_alt = c.gain;
  v->gain_ab = -1;
  v->ramp_n = ramp_n;
  v->beat_versatz = -urs + start_beat_ - c.start_beat;
  v->naechste = naechste;
  v->tausch_bruecke = false;
  v->luecke = false;
  v->gelesen = false;
  v->fade_ein = 0;
  v->nachfolgerin = false;
  v->spaet_deckung = false;
  WarpAnsatz a;
  a.clip = &c;
  a.s_h = s_h;
  a.s_ende = v->ende;
  a.beat_versatz = v->beat_versatz;
  karte_kurz(a.karte, k);
  werk_->ansetzen(platz, a);
  return v;
}

// Tausch (c2: der Clip im neuen Stand, nullptr: weg) oder neue Karte (c2 = v.clip, k die neue): die gebundene Werk-Stimme v liest den Schnappschuss nicht mehr.
//  - Klingt sie schon: Brücke bis s + ARR_WARP_FRIST, wenn der neue Stand wieder ein Clip des Werks ist (die Nachfolgerin setzt werk_decken an), sonst blendet sie ab s
//    über ARR_NAHT aus (der Clip ist weg oder spielt ab s als RE-PITCH oder ohne Warp, stimmen_einstieg).
//  - Klingt sie noch nicht (werk_ab ≥ s): Brücke, wenn sie vor s + Frist einsetzt und der neue Stand an ihrem Einsatz klingt (sie spielt dort den alten Stand bis zur
//    Frist); sonst gibt sie ihren Platz, und der neue Stand gilt ab seinem Einsatz (vorab angesetzt vom Vorausblick). Für Tausch und Karte dieselbe Regel: ein
//    verschobener Einsatz (Tausch, oder eine langsamere Rampe, Prüfung 4 R1) klingt nie an der alten Stelle an.
void Arrangement::werk_abloesen(const Karte& k, Stimme& v, const ArrClip* c2, int64_t s, bool tausch) {
  bool neu_werk = c2 && werk_clip(*c2) && werk_;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_REPITCH_DECKT   // Fehlerfall (Prüfer Fable r4): auch ohne Werk-Clip im neuen Stand spielt die alte Stimme bis zur Frist (unter RE-PITCH: doppelt)
  neu_werk = c2 != nullptr;
#endif
  // Nachbesserung 5: eine Stimme, die klingt, aber nur aus der Deckung (spät, ihr Ring hat noch nie geliefert), hat nichts, mit dem sie Brücke sein könnte; ohne Clip
  // (Brücke) verlöre sie auch die Deckung (Zufallsfolgen verdichtet, Seed 253: Stille bis zum ersten Ring-Block). Neue Karte: derselbe Platz wird mit der neuen Karte
  // neu angesetzt (Ring ab s + Frist), die Deckung läuft mit der Karte des Blocks weiter. Tausch: sie klingt aus ihrer eigenen Kopie aus (wie eine RE-PITCH-Stimme,
  // stimmen_tauschen) und gibt den Platz; den neuen Stand setzt stimmen_einstieg an (RE-PITCH bis zur Frist, weil der Clip eben noch klang).
  if (v.spaet_deckung && !v.gelesen && v.clip && v.werk_ab < s) {
    if (!tausch && neu_werk) {
      const double urs = start_beat_ - v.p_off;
      v.ende = sample_von_p(k, v.clip->start_beat + v.clip->laenge_beats, urs);
      v.aus_n = v.clip->aus_beats > 0.0 ? v.ende - sample_von_p(k, v.clip->start_beat + v.clip->laenge_beats - v.clip->aus_beats, urs) : 0;
      WarpAnsatz a;
      a.clip = v.clip;
      a.s_h = s + ARR_WARP_FRIST;
      a.s_ende = v.ende;
      a.beat_versatz = v.beat_versatz;
      karte_kurz(a.karte, k);
      werk_->ansetzen(v.werk, a);
      return;
    }
    stimme_ausklang(v, s, k);   // v.clip = nullptr, die Kopie trägt die nächsten ARR_NAHT Samples
    werk_->gib(v.werk);
    v.werk = -1;
    v.spaet_deckung = false;
    v.tausch_bruecke = false;
    return;
  }
  // Nachbesserung 5 (Prüfung 5, verdichteter Generator Seeds 821, 1076; dieselbe Klasse wie Langlauf-Seed 9601 für die Karte ohne Platz): eine klingende Stimme, deren
  // alter Inhalt vor s + Frist endet (der Clip wurde nach hinten verschoben oder die neue Karte dehnt ihn), kann den Clip nicht bis zur Frist tragen; als Brücke schwieg
  // der Clip von ihrem alten Ende bis zur Nachfolgerin. Sie klingt aus ihrer eigenen Kopie aus und gibt den Platz; den Clip setzt stimmen_einstieg neu an (RE-PITCH
  // bis zur Frist, weil er eben noch klang, dann das Werk).
  if (neu_werk && v.werk_ab < s && v.clip && v.ende < s + ARR_WARP_FRIST) {
    const double urs = start_beat_ - v.p_off;
    if (sample_von_p(k, c2->start_beat + c2->laenge_beats, urs) > v.ende + ARR_NAHT) {
      stimme_ausklang(v, s, k);
      werk_->gib(v.werk);
      v.werk = -1;
      v.spaet_deckung = false;
      v.tausch_bruecke = false;
      einstieg_ = true;
      return;
    }
  }
  v.clip = nullptr;
  v.tausch_bruecke = tausch;
  if (v.werk_ab >= s) {
    bool bruecke = neu_werk && v.werk_ab < s + ARR_WARP_FRIST;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_TAUSCH_FREI   // Fehlerfall (Prüfer Fable r4): beim Tausch gibt jede noch stumme Stimme ihren Platz, der neue Stand gilt sofort am Einsatz
    if (tausch) bruecke = false;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_DECKUNG_ORTLOS   // Fehlerfall: ein verschobener Clip klingt bis zur Frist an seinem alten Ort
    if (bruecke) {
      const double urs = start_beat_ - v.p_off;   // Ursprung des Durchlaufs der Stimme
      bruecke = sample_von_p(k, c2->start_beat, urs) <= v.werk_ab + 2 && v.werk_ab < sample_von_p(k, c2->start_beat + c2->laenge_beats, urs);
    }
#endif
    if (!bruecke) {
      werk_frei(v);
      return;
    }
  }
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_TAUSCH_HART   // Fehlerfall: die alte Stimme blendet sofort aus, bis zum Ersatz klafft eine Lücke von ARR_WARP_FRIST
  const int64_t ab = s;
#else
  const int64_t ab = neu_werk ? s + ARR_WARP_FRIST : s;
#endif
  if (v.ab_aus < 0 || v.ab_aus > ab) v.ab_aus = ab;
}

// Bis wohin spielt eine Brücke (gelöste Werk-Stimme) dieses Clips und Durchlaufs, die bei s noch nicht ausblendet? INT64_MIN: keine.
// Nachbesserung 5 (Prüfung 5, fable m2): −1 als „keine“ galt gegen einen Clip-Start vor Kern-Sample 0 als „≥ Start“, und der Platztausch setzte eine Nachfolgerin bei −1 an
int64_t Arrangement::werk_bruecke_bis(int spur, uint64_t clip_id, bool naechste, int64_t s) const {
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_BRUECKE_MINUS_EINS   // Fehlerfall (Prüfung 5, fable m2): „keine Brücke“ heißt −1 und liegt damit hinter einem negativen Clip-Start
  int64_t d = -1;
#else
  int64_t d = INT64_MIN;
#endif
  for (const Stimme& v : st_)
    if (v.aktiv && v.werk >= 0 && !v.clip && v.spur == spur && v.clip_id == clip_id && v.naechste == naechste && v.ab_aus > s && v.ab_aus > d) d = v.ab_aus;
  return d;
}

void Arrangement::werk_naechste_verwerfen() {
  for (Stimme& v : st_)
    if (v.aktiv && v.naechste) werk_frei(v);
}

namespace {
const ArrClip* clip_mit_id(const ArrSpur& sp, uint64_t id) {
  for (int i = 0; i < sp.n_clips; ++i)
    if (sp.clips[i].id == id) return &sp.clips[i];
  return nullptr;
}
}  // namespace

// DIE Stelle der Invariante (Plan, „Prüfung 4 und Nachbesserung 4“), je Block vor dem Vorausblick. Für jeden Clip des Werks gilt: an jedem Sample, an dem ihn der
// gültige Stand klingen lässt, klingt genau eine Stimme mit vollem Gewicht oder zwei in einer Überblendung über ARR_NAHT; der alte Stand gilt nach einem Ereignis
// höchstens bis s + ARR_WARP_FRIST (oder bis der Pool einen Platz hat). Eine Gruppe ist (Spur, Clip, Durchlauf); ihre Brücken spielen den alten Stand.
//  1. Kette kürzen: eine stumme Brücke, deren Vorgängerin bis zu ihrem Einsatz klingt, gibt ihren Platz, die Vorgängerin spielt bis zu ihrem Ende (das zweite
//     Ereignis im Fenster verlängert das Fenster, statt eine Stimme mehr zu binden; Prüfung 4 m10: höchstens zwei Stimmen je Clip, die nicht ausblenden).
//  2. Nachfolgerin: hat die Gruppe keine gebundene Stimme und lässt der gültige Stand den Clip schon an D (Ende der letzten Brücke) klingen, setzt sie dort mit
//     Überblendung an. Setzt der Clip erst nach D ein, tut das der Vorausblick; endet er (oder der Durchlauf) binnen ARR_NAHT nach D, ist nichts zu übergeben.
//  3. Kein Platz: neue Karte, die Brücke spielt weiter (bis s0 + m + Frist, der nächste Block versucht es wieder; reicht das bis zum Ende des Clips, gezählt),
//     solange ihr alter Inhalt so weit reicht (sonst wie beim Tausch, der klingt: RE-PITCH ab s0, gezählt); Tausch und die Brücke klingt noch nicht: sie gibt ihren Platz (Platztausch), der neue Stand setzt dort an, wo er beginnt; Tausch und sie klingt: der Clip
//     spielt ab s0 als RE-PITCH, die Brücken blenden dort aus (gezählt).
//  0. Nachbesserung 5 (Prüfung 5, fable M1): kein Platz ohne Klang. Eine Stimme des Werks, die noch nicht klingt (werk_ab ≥ s0) und die der gültige Stand nie klingen
//     lässt, gibt ihren Platz jetzt: die Naht des laufenden Durchlaufs liegt vor ihrem Einsatz (eine neue Klammer vor der Grenze; stimmen_naht hätte sie erst dort
//     freigegeben, der Vorausblick für den Durchlauf danach fand bis dahin keinen Platz und gab still auf), ein geplanter Stopp liegt vor ihrem Einsatz, oder ihr Clip
//     beginnt mit der Klammer auf oder hinter bis.
void Arrangement::werk_decken(const Karte& k, int64_t s0, int m) {
  if (status_ != ArrStatus::spielt && status_ != ArrStatus::wartet) return;
  auto gruppe = [](const Stimme& a, const Stimme& b) { return a.spur == b.spur && a.clip_id == b.clip_id && a.naechste == b.naechste; };
  // Nachbesserung 6 (Flanke 18 b, Plan-Seed 20868): eine Brücke, deren Ausblende genau bei s0 beginnt (ab_aus == s0), zählt noch. Ihr ab_aus kann auf die Naht gekürzt sein (ende = w,
  // Punkt 3: „bis zum Ende des Clips kein Platz“); kommt ein Loop-Ereignis auf dem Naht-Sample selbst, entfällt die Naht (arrangement.cpp, loop() setzt weder einstieg_ noch läuft
  // wrap()), die verworfene „nächste“ Stimme fehlt, und mit „>“ war die Brücke in diesem Block keine mehr: keine Nachfolgerin, der Clip schwieg bis zum nächsten Ereignis
  auto bruecke = [&](const Stimme& v) { return v.aktiv && v.werk >= 0 && !v.clip && v.ab_aus >= s0; };
  // W2-Kosten S3: ein Durchlauf für die Vorprüfungen. Punkt 0 wirkt nur auf Werk-Stimmen mit werk_ab ≥ s0 (vorab), Punkt 1, 2 und 3 nur auf Brücken (bruecke(v)); Punkt 0 gibt
  // Stimmen frei, macht aber nie eine zur Brücke. Gibt es zu Beginn keine Brücke, sind 1 bis 3 leer; gibt es keine vorab angesetzte Stimme (eine Brücke mit werk_ab ≥ s0 ist
  // auch eine), ist Punkt 0 leer, und naht_sample (reine Rechnung) entfällt. Die Reihenfolge der Freigaben bleibt: Punkt 0 vor 1 bis 3.
  bool vorab = false, bruecken = false;
  for (const Stimme& v : st_) {
    if (!v.aktiv || v.werk < 0) continue;
    vorab = vorab || v.werk_ab >= s0;
    bruecken = bruecken || (!v.clip && v.ab_aus >= s0);
  }
  if (!vorab && !bruecken) return;
  // 0. kein Platz ohne Klang
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_PLATZ_OHNE_KLANG   // Fehlerfall (Prüfung 5, fable M1): eine vorab angesetzte Stimme, die mit der neuen Klammer nie klingt, hält ihren Platz bis zur Naht
  if (vorab) {
    const int64_t w = naht_sample(k);
    for (Stimme& v : st_) {
      if (!v.aktiv || v.werk < 0 || v.werk_ab < s0) continue;
      bool nie = !v.naechste && w >= 0 && v.werk_ab >= w;
      nie = nie || (status_ == ArrStatus::spielt && stopp_s_ >= 0 && v.werk_ab >= stopp_s_);
      nie = nie || (klammer() && v.clip && v.clip->start_beat >= bis_);
      if (nie) werk_frei(v);
    }
  }
#endif
  if (!bruecken) return;
  // 1. Kette kürzen
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_KETTE_LANG   // Fehlerfall: jede Brücke behält ihren Platz, Ereignisse in Folge binden je Clip eine Stimme mehr
  for (Stimme& b : st_) {
    if (!bruecke(b) || b.werk_ab < s0) continue;
    for (Stimme& p : st_)
      if (&p != &b && bruecke(p) && gruppe(p, b) && p.werk_ab < b.werk_ab && p.ab_aus >= b.werk_ab - 2 && p.ab_aus <= b.werk_ab + 2) {
        p.ab_aus = std::max(p.ab_aus, b.ab_aus);
        p.tausch_bruecke = p.tausch_bruecke || b.tausch_bruecke;
        werk_frei(b);
        break;
      }
  }
#endif
  // 2. und 3. je Gruppe einmal, an der Brücke mit dem spätesten Ende
  for (Stimme& h : st_) {
    if (!bruecke(h)) continue;
    bool kopf = true, gedeckt = false;
    for (const Stimme& v : st_) {
      if (!v.aktiv || &v == &h || !gruppe(v, h)) continue;
      if (v.clip && !(v.werk < 0 && v.ab_aus >= 0 && v.ab_aus <= h.ab_aus)) gedeckt = true;   // gebunden: Nachfolgerin (Werk) oder RE-PITCH, die nicht vor der Brücke endet
      else if (bruecke(v) && (v.ab_aus > h.ab_aus || (v.ab_aus == h.ab_aus && &v < &h))) kopf = false;
    }
    if (!kopf || gedeckt) continue;
    const ArrSpur& sp = snap_->spur[h.spur];
    const ArrClip* c = sp.art == ArrArt::audio ? clip_mit_id(sp, h.clip_id) : nullptr;
    if (!c || !werk_clip(*c)) continue;   // werk_abloesen hat sie schon auf s gesetzt
    const double urs = start_beat_ - h.p_off;
    const int64_t s_c = sample_von_p(k, c->start_beat, urs);
    int64_t ende = sample_von_p(k, c->start_beat + c->laenge_beats, urs);
    int64_t s_h = s_c;   // wo der gültige Stand den Clip in diesem Durchlauf beginnen lässt
    if (h.naechste) {
      s_h = std::max(s_c, naht_sample(k));
    } else if (status_ == ArrStatus::wartet) {
      s_h = std::max(s_c, start_s_);
    } else if (klammer()) {
      const int64_t w = naht_sample(k);
      if (w >= 0 && w < ende) ende = w;
    }
    int64_t d = h.ab_aus;
    // Nachbesserung 5 (verdichteter Generator, Seed 1520: drei Tausche am selben Sample, der dritte verschiebt den Clip, der schon Brücke ist): endet der alte Inhalt der
    // Brücke vor ihrem Ende d, übergibt sie dort, wo er endet; die Nachfolgerin setzt dann mit kurzem Vorlauf an (spät, gedeckt), statt dass der Clip bis d schweigt
    if (h.ende < d + ARR_NAHT) d = std::max(s0, h.ende - ARR_NAHT);
    if (s_h > d) continue;                  // der Clip setzt erst nach der Brücke ein: der Vorausblick
    if (d + ARR_NAHT >= ende) continue;      // endet in der Ausblende der Brücke
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_DECKUNG   // Fehlerfall (Prüfung 3, M1): die Nachfolgerin setzt am Einsatz an, während die Brücke den alten Stand noch spielt (doppelt)
    if (Stimme* n = werk_stimme_starten(k, *c, h.spur, std::max(s_h, s0), s_c, s_h > s_c, ARR_EIN, urs, h.naechste)) { n->nachfolgerin = true; continue; }
#else
    if (Stimme* n = werk_stimme_starten(k, *c, h.spur, d, s_c, true, ARR_NAHT, urs, h.naechste)) {
      n->nachfolgerin = true;
      if (d < h.ab_aus)   // die Übergabe liegt vor dem geplanten Ende: die Brücken der Gruppe blenden dort aus
        for (Stimme& v : st_)
          if (bruecke(v) && gruppe(v, h) && v.ab_aus > d) v.ab_aus = d;
      continue;
    }
#endif
    if (!h.tausch_bruecke) {   // neue Karte: der Inhalt stimmt, nur das Raster ist alt
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_NACHHOLEN   // Fehlerfall: kein zweiter Versuch, die Brücke blendet an d aus, der Clip schweigt bis zu seinem Ende
      if (d < s0 + m) ++warp_kein_platz_;
#else
      const int64_t weiter = s0 + m + ARR_WARP_FRIST;
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_NACHHOLEN_UEBER_ENDE   // Fehlerfall (Langlauf, Seed 9601): die Brücke „spielt weiter“ über das Ende ihres alten Inhalts hinaus
      if (h.ende < (weiter + ARR_NAHT >= ende ? ende : weiter)) {
        // der alte Inhalt der Brücke endet vorher (der Clip wurde danach verschoben oder verlängert): sie kann nicht bis dorthin decken, der Clip spielt ab s0
        // als RE-PITCH wie beim Tausch (gezählt). Langlauf der Zufallsfolgen, Seed 9601: sonst schwieg der Clip ab dem alten Ende bis zu seinem neuen
        ++warp_kein_platz_;
        stimme_starten(k, *c, h.spur, s0, s_c, true, ARR_NAHT);   // Nachbesserung 6: die Einblende ergänzt die Ausblende der Brücke (beide über ARR_NAHT), sonst 2,01 für ein Fenster (Flanke 14)
        for (Stimme& v : st_)
          if (bruecke(v) && gruppe(v, h)) v.ab_aus = s0;
        continue;
      }
#endif
      if (weiter + ARR_NAHT >= ende) {   // bis zum Ende des Clips kein Platz: die Brücke spielt ihn mit dem alten Raster zu Ende
        h.ab_aus = std::max(d, ende);
        ++warp_kein_platz_;
      } else {
        h.ab_aus = std::max(d, weiter);
      }
#endif
      continue;
    }
    if (h.werk_ab >= s0) {   // Tausch, die Brücke klingt noch nicht: sie (und jede stumme ihrer Gruppe) gibt ihren Platz
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_PLATZTAUSCH   // Fehlerfall: ohne Platz wartet die Nachfolgerin, bis die Brücke endet (am Einsatz kein Platz: RE-PITCH)
      const Stimme kopie = h;
      for (Stimme& v : st_)
        if (bruecke(v) && gruppe(v, kopie) && v.werk_ab >= s0) werk_frei(v);
      const int64_t d2 = werk_bruecke_bis(kopie.spur, kopie.clip_id, kopie.naechste, s0);   // INT64_MIN: keine (m2: vorher −1, das lag hinter einem negativen Clip-Start)
      if (d2 >= s_h && d2 + ARR_NAHT < ende) {   // eine andere Brücke der Gruppe spielt bis d2: Nachfolgerin dort (verdrängbar, die Brücke lebt)
        if (Stimme* n = werk_stimme_starten(k, *c, kopie.spur, d2, s_c, true, ARR_NAHT, urs, kopie.naechste)) n->nachfolgerin = true;
      } else if (d2 < s_h && s_h >= s0) werk_stimme_starten(k, *c, kopie.spur, s_h, s_c, s_h > s_c, ARR_EIN, urs, kopie.naechste);   // Prüfung 4 R2: kurzer Vorlauf, spät (Nachbesserung 5: bis der Ring liefert RE-PITCH, nicht still); keine Brücke mehr, nicht verdrängbar
      else if (d2 < s_h) {
        // Nachbesserung 4: der Clip klingt schon (eine RE-PITCH-Stimme deckt ihn bis zur Brücke): das Werk setzt eine Frist nach jetzt ein, RE-PITCH deckt bis dorthin.
        // Nachbesserung 5: bekommt das Werk keine Stimme (der Clip oder der Durchlauf endet vor t + Naht, oder kein Platz), deckt RE-PITCH bis zum Ende, gezählt; vorher
        // endete die Deckung an ihrem alten Ziel und der Clip schwieg bis zur Naht (verdichteter Generator, Seed 2040: 35 ms)
        const int64_t t = s0 + ARR_WARP_FRIST;
        const bool werk = t + ARR_NAHT < ende && werk_stimme_starten(k, *c, kopie.spur, t, s_c, true, ARR_NAHT, urs, kopie.naechste) != nullptr;
        const int64_t bis = werk ? t : ende;
        if (!werk) ++warp_kein_platz_;
        bool deckt = false;
        for (Stimme& v : st_)
          if (v.aktiv && v.clip && v.werk < 0 && gruppe(v, kopie) && v.ab_aus > s0) {
            v.ab_aus = std::max(v.ab_aus, bis);
            deckt = true;
          }
        if (!deckt) {
          if (werk) ++warp_kein_platz_;
          if (Stimme* r = stimme_starten(k, *c, kopie.spur, s0, s_c, true, ARR_NAHT)) r->ab_aus = bis;
        }
      }
#endif
      continue;
    }
    // Tausch, die Brücke klingt: der Clip spielt ab s0 als RE-PITCH (Fall 13), die Brücken blenden dort aus
    ++warp_kein_platz_;
    stimme_starten(k, *c, h.spur, s0, s_c, true, ARR_NAHT);   // Nachbesserung 6: Einblende über ARR_NAHT gegen die Ausblende der Brücke (Seed 9110)
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_EINSTIEG_DOPPELT   // Fehlerfall (Prüfung 3, m2): die Brücke spielt bis zur Frist unter dem RE-PITCH weiter (doppelt)
    for (Stimme& v : st_)
      if (bruecke(v) && gruppe(v, h)) v.ab_aus = s0;
#endif
  }
}

// Spielt eine Werk-Stimme: Gains wie im RE-PITCH-Weg (Ein- und Ausblende des Clips, Einblende, Naht, Stopp); die Frames kommen aus dem Ring. Fehlen
// sie (der Faden ist zu spät oder steht), kommt Stille mit Blende (2 ms) aus dem, was da ist, und zurück; gezählt wird der Ausfall, nicht jeder Block.
// Nachbesserung 5 (Prüfung 5): fehlen sie, weil der Ring noch NIE geliefert hat (spät: der Platz wurde erst spät frei, oder der Einsatz ist jetzt und das Werk liefert
// erst ab a + Frist) oder weil er in der ersten Frist nach dem Einsatz noch stockt, klingt der Clip in der Lücke aus dem Clip als RE-PITCH (dieselbe Abbildung W(b), die der
// Faden rechnet; der Clip ist gebunden, sein Schnappschuss lebt) und blendet mit dem Ring über ARR_NAHT über. Ein Unterlauf später (der Ring hat geliefert und reißt ab)
// bleibt Stille mit Blende (Fall 4).
void Arrangement::werk_stimme_spielen(const Karte& karte, Stimme& v, int64_t a, int64_t b, int64_t s0, int64_t naht) {
  float* bl = bus_l_[v.spur];
  float* br = bus_r_[v.spur];
  const int64_t t0 = std::max(a, v.werk_ab);
  int64_t t1 = std::min(b, v.ende);
  if (v.ab_aus >= 0) t1 = std::min(t1, v.ab_aus + ARR_NAHT);
  const int64_t we = werk_->ende_s(v.werk);     // der Faden rechnet nicht weiter (Quelle zu Ende)
  const bool quelle_aus = we < t1;
  if (quelle_aus) t1 = we;
  if (t1 > t0) {
    const int n = static_cast<int>(t1 - t0);
    StreckRing& r = werk_->ring(v.werk);
    const int k = r.lies_bis(t0, n, wl_, wr_);   // W2-Kosten S2: ein Durchlauf statt verfuegbar + lies; liest die lückenlos bereiten Frames ab t0 (höchstens n), k = Zahl der gelesenen
    // jung: in der ersten Frist nach dem Einsatz füllt sich der Ring eines spät angesetzten Auftrags noch (mit Fäden liefert er die ersten Blöcke stockend: Ring, Lücke,
    // Ring); solche Lücken gehören zum späten Start (spät, gedeckt), erst danach ist eine Lücke ein Unterlauf (Stille mit Blende, Fall 4)
    const bool jung = t0 - v.werk_ab < ARR_WARP_FRIST;
    if (k < n) {
      if (!v.luecke) {
        if (v.gelesen && !jung) ++warp_unterlauf_;
        else ++warp_spaet_;
      }
      v.luecke = true;
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_SPAET_STILL   // Fehlerfall (Prüfung 5, opus F1 und fable M1): ein später Einsatz schweigt, bis der Ring liefert (Loch am Einsatz)
      if ((!v.gelesen || jung) && v.clip && v.clip->warp && v.clip->audio) v.spaet_deckung = true;
#endif
    } else if (v.luecke) {
      v.luecke = false;
      v.fade_ein = ARR_NAHT;
    }
    const bool deckung = v.spaet_deckung && v.clip && v.clip->warp && v.clip->audio;
    const int n_aus = deckung ? n : k;   // mit Deckung wird auch die Lücke [k, n) geschrieben
    const int m = std::min(k, ARR_NAHT);   // Auslauf vor einer Lücke: die letzten m gelieferten Frames blenden aus
    // Schnellpfad (W2-Kosten S1, bitgleich): greift im ganzen Block [t0, t1) keine Rampe und kein Ausblenden, alle n Frames liegen im Ring und es gibt keine Überblendung (fade_ein 0,
    // k == n: ring_g bleibt 1,0f, die Deckung wird nie gelesen), ist g = gain, und aus der Schleife unten wird bl[j] += (wl_[i] * 1,0f) * gain, die Multiplikation mit 1,0f ist exakt.
    // Jede Bedingung ist die Verneinung eines Zweigs der Schleife für das ungünstigste t des Blocks (t0 für Einblenden, t1 − 1 für Ausblenden); ein Zweig, der nur ein Mal
    // in t trifft, schickt den Block auf den langen Weg.
    const bool glatt = k == n && v.fade_ein == 0 && t0 - v.clip_s0 >= v.ein_n && v.ende - (t1 - 1) >= v.aus_n &&
                       (v.ramp_ein_ab < 0 || t0 - v.ramp_ein_ab >= v.ramp_n) && (naht < 0 || naht - (t1 - 1) >= ARR_NAHT) && (v.ab_aus < 0 || t1 <= v.ab_aus) &&
                       (v.gain_ab < 0 || t0 - v.gain_ab >= ARR_NAHT);
    if (glatt) {
      float* __restrict ol = bl + (t0 - s0);
      float* __restrict orr = br + (t0 - s0);
      const float* __restrict il = wl_;
      const float* __restrict ir = wr_;
      const float g = v.gain;
      for (int i = 0; i < n; ++i) {
        ol[i] += il[i] * g;
        orr[i] += ir[i] * g;
      }
    } else
    for (int i = 0; i < n_aus; ++i) {
      const int64_t t = t0 + i;
      float g = v.gain;
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_GAIN_SPRUNG   // Fehlerfall (Nachbesserung 4, R3): der neue Gain springt am Tausch-Sample (Knack)
      if (v.gain_ab >= 0 && t - v.gain_ab < ARR_NAHT) g = v.gain_alt + (v.gain - v.gain_alt) * static_cast<float>(std::max<int64_t>(t - v.gain_ab, 0)) / ARR_NAHT;
#endif
      const int64_t pos = t - v.clip_s0;
      if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
      if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
      if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < v.ramp_n) g *= static_cast<float>(t - v.ramp_ein_ab) / static_cast<float>(v.ramp_n);
      if (naht >= 0 && naht - t < ARR_NAHT) g *= static_cast<float>(naht - t) / ARR_NAHT;   // endet auf der Naht
      if (v.ab_aus >= 0 && t >= v.ab_aus) g *= static_cast<float>(ARR_NAHT - (t - v.ab_aus)) / ARR_NAHT;
      // Anteil des Rings (ring_g) und der Deckung (1 − ring_g): Einblende nach einer Lücke, Auslauf vor einer Lücke, in der Lücke nur die Deckung
      float ring_g = i < k ? 1.0f : 0.0f;
      if (i < k && v.fade_ein > 0) {
        ring_g *= static_cast<float>(ARR_NAHT - v.fade_ein) / ARR_NAHT;
        --v.fade_ein;
      }
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_BLENDE   // Fehlerfall: bricht der Ring ab, bricht der Klang hart ab (Sprung)
      if (i < k && k < n && i >= k - m) ring_g *= static_cast<float>(k - i) / static_cast<float>(m);
#endif
      float l = 0.0f, rr = 0.0f;
      if (i < k) {
        l = wl_[i] * ring_g;
        rr = wr_[i] * ring_g;
      }
      if (deckung && ring_g < 1.0f) {   // RE-PITCH aus dem Clip: Clip-Beat b = karte.beat_at(t) + beat_versatz, wie der Auftrag des Werks (WarpAnsatz)
        const ArrClip& c = *v.clip;
        const double fr = warp_frame(*c.warp, karte.beat_at(static_cast<double>(t)) + v.beat_versatz);
        if (fr >= 0.0 && fr < static_cast<double>(c.audio->frames)) {
          float dl, dr;
          warp_lies(c.audio->daten, c.audio->frames, fr, dl, dr);
          l += dl * (1.0f - ring_g);
          rr += dr * (1.0f - ring_g);
        }
      }
      bl[t - s0] += l * g;
      br[t - s0] += rr * g;
    }
    if (k > 0) v.gelesen = true;
    if (v.spaet_deckung && v.gelesen && !v.luecke && v.fade_ein == 0) v.spaet_deckung = false;   // der Ring liefert und die Überblendung ist durch
  }
  // Ende der Stimme: Clip-Ende, Quelle zu Ende, ausgeblendet
  if (b >= v.ende || (quelle_aus && b >= we) || (v.ab_aus >= 0 && b >= v.ab_aus + ARR_NAHT)) werk_frei(v);
}

// Einsätze der nächsten ARR_WARP_FRIST Samples vorab ansetzen: das Werk braucht die Zeit, um die ersten Körner zu rechnen. Drei Fälle, ein Ablauf:
//  1. ein Clip, der in [s0, Horizont) einsetzt (im laufenden Durchlauf)
//  2. beim wartenden Transport: der Clip, der am Start schon klingt, setzt bei start_s_ ein (Einblende wie stimmen_einstieg), und was danach einsetzt
//  3. kurz vor der Naht: der Durchlauf danach (Ursprung + bis − von): Clips ab von und die, die von überspannen
void Arrangement::warp_vorausblick(const Karte& k, int64_t s0, int m) {
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_VORAUSBLICK
  (void)k; (void)s0; (void)m;
  return;   // Fehlerfall: kein Einsatz wird vorab angesetzt, das Werk liefert erst ARR_WARP_FRIST nach dem Einsatz (spät, mit Einblende)
#endif
  const int64_t hor = s0 + m + ARR_WARP_FRIST;
  auto scan = [&](double urs, int64_t pass_s, int64_t lo, int64_t hi, bool naechste) {
    // Die Clips einer Spur liegen nach start_beat aufsteigend: im laufenden Durchlauf (pass_s == INT64_MIN) zählt nur, was in [lo, hi) einsetzt, die Clips davor
    // überspringt eine Suche im Beat (zwei Samples Rand), und beim ersten Clip ab hi endet die Spur. Ohne das rechnete jeder Block für jeden Clip der Datei zweimal
    // sample_von_p (4 096 Clips COMPLEX: Block-Median 64 µs statt 27 µs, kern_kosten_vorausblick).
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_VORFILTER   // Fehlerfall: die Suche überspringt einen Beat zu viel, die Clips, die gleich einsetzen, werden nicht vorab angesetzt
    const double p_lo = k.beat_at(static_cast<double>(lo) - 2.0) - urs + start_beat_ + 1.0;
#else
    const double p_lo = k.beat_at(static_cast<double>(lo) - 2.0) - urs + start_beat_;
#endif
    for (int i = 0; i < ARR_SPUREN; ++i) {
      const ArrSpur& sp = snap_->spur[i];
      if (sp.art != ArrArt::audio) continue;
      const ArrClip* ab = sp.clips;
      const ArrClip* ende = sp.clips + sp.n_clips;
      if (pass_s == INT64_MIN) ab = std::lower_bound(ab, ende, p_lo, [](const ArrClip& x, double p) { return x.start_beat < p; });
      for (const ArrClip* cp = ab; cp != ende; ++cp) {
        const ArrClip& c = *cp;
        if (klammer() && c.start_beat >= bis_) break;
        // Nachbesserung 3 (Prüfung 3, m1): mit Durchlauf-Anfang (Wartezustand, Durchlauf nach der Naht) zählen die Clips, die in [lo, hi) einsetzen, und die, die
        // den Anfang überspannen; ein Clip, der im Beat vor lo endet (zwei Samples Rand), fällt ohne sample_von_p heraus (4 096 Clips vor der Naht: 65 statt 30 µs)
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_NAHT_VORFILTER   // Fehlerfall: auch die Clips, die den Anfang des Durchlaufs überspannen, fallen heraus (setzen spät ein, mit Lücke)
        if (pass_s != INT64_MIN && c.start_beat < p_lo) continue;
#else
        if (pass_s != INT64_MIN && c.start_beat < p_lo && c.start_beat + c.laenge_beats <= p_lo) continue;
#endif
        const int64_t s_c = sample_von_p(k, c.start_beat, urs);
        if (s_c >= hi) break;                           // dieser und alle folgenden Clips setzen erst nach dem Horizont ein
        if (!werk_clip(c)) continue;
        const int64_t s_e = sample_von_p(k, c.start_beat + c.laenge_beats, urs);
        if (s_e <= pass_s) continue;                    // vor dem Durchlauf zu Ende
        const bool uebergreift = s_c < pass_s;           // klingt am Anfang des Durchlaufs schon: setzt dort mit Einblende ein
        const int64_t s_h = uebergreift ? pass_s : s_c;
        if (s_h < lo || s_h >= hi) continue;
        if (hat_stimme(i, c.id, s_c)) continue;
        if (werk_bruecke_bis(i, c.id, naechste, s0) >= s_h) continue;   // eine Brücke spielt den Clip bis über seinen Einsatz: werk_decken übergibt
        if (werk_stimme_starten(k, c, i, s_h, s_c, uebergreift, ARR_EIN, urs, naechste)) continue;
        // ohne Platz: der nächste Block versucht es erneut; bleibt der Pool bis zum Einsatz voll, nimmt clips_starten den Weg über RE-PITCH (gezählt).
        // Nachbesserung 5 (Prüfung 5, opus F1), Vorrang: hält eine stumme Nachfolgerin einer Brücke einen Platz für kürzeren Klang, als dieser Einsatz bringt (an einer
        // gemeinsamen Grenze: die Nachfolgerin des endenden Clips für seine letzten 313 Samples, der neue Clip für acht Beats), gibt sie ihn her; ihre Brücke holt im
        // nächsten werk_decken nach (Karte) oder der Clip spielt RE-PITCH (Tausch), gezählt in warp_kein_platz wie bei jedem Platzmangel
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_OHNE_VORRANG   // Fehlerfall (Prüfung 5, opus F1): die Nachfolgerin für 313 Samples behält den Platz, der neue Clip setzt spät ein
        if (Stimme* o = werk_verdraengen(s0 + m, s_e - s_h)) {
          werk_frei(*o);
          werk_stimme_starten(k, c, i, s_h, s_c, uebergreift, ARR_EIN, urs, naechste);
        }
#endif
      }
    }
  };
  if (status_ == ArrStatus::wartet) {
    scan(ursprung_, start_s_, s0, hor, false);
    return;
  }
  if (status_ != ArrStatus::spielt) return;
  scan(ursprung_, INT64_MIN, s0, hor, false);
  if (klammer()) {
    const int64_t w = naht_sample(k);
    if (w >= 0 && w < hor) scan(ursprung_ + (bis_ - von_), w, std::max(w, s0), hor, true);
  }
}

// Nachbesserung 5 (Vorrang): die stumme Nachfolgerin (von werk_decken für eine Brücke angesetzt, Einsatz erst nach diesem Block: werk_ab > grenze = s0 + m), die am
// kürzesten klingen würde, wenn das kürzer ist als dauer. Nur Nachfolgerinnen, deren Brücke noch lebt und bis zu ihrem Einsatz reicht (ab_aus ≥ werk_ab, und der alte
// Inhalt endet nicht vorher): die Brücke trägt den Clip weiter (Nachholen oder RE-PITCH ab dem nächsten Block, werk_decken Punkt 3). Eine Stimme ohne solche Brücke hätte
// nichts, das für sie einspringt (verdichteter Generator, Seed 141: die Brücke eines verschobenen Clips endete an seinem alten Ende vor dem Einsatz der Nachfolgerin). Setzt
// die Nachfolgerin schon in diesem Block ein, blendet ihre Brücke hier aus und endet vor dem nächsten werk_decken: dann bliebe ein Loch (Seed 294), darum nur Einsätze
// hinter dem Block. nullptr: keine.
Arrangement::Stimme* Arrangement::werk_verdraengen(int64_t grenze, int64_t dauer) {
  Stimme* o = nullptr;
  int64_t rest = dauer;
  for (Stimme& v : st_) {
    if (!v.aktiv || v.werk < 0 || !v.clip || !v.nachfolgerin || v.werk_ab <= grenze) continue;
    bool bruecke = false;
    for (const Stimme& b : st_)
      bruecke = bruecke || (b.aktiv && b.werk >= 0 && !b.clip && b.spur == v.spur && b.clip_id == v.clip_id && b.naechste == v.naechste && b.ab_aus + 2 >= v.werk_ab &&
                            b.ende > v.werk_ab);
    if (!bruecke) continue;
    const int64_t r = v.ende - v.werk_ab;
    if (r < rest) {
      rest = r;
      o = &v;
    }
  }
  return o;
}

// Klingt am Start (start_beat) ein Clip des Werks, oder setzt einer binnen kurzem ein? Dann wächst die Start-Regel um ARR_WARP_FRIST (Spec 5.3).
bool Arrangement::werk_am_start(double start_beat) const {
  if (!werk_ || !snap_ || !snap_werk_) return false;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const ArrSpur& sp = snap_->spur[i];
    if (sp.art != ArrArt::audio) continue;
    for (int j = 0; j < sp.n_clips; ++j) {
      const ArrClip& c = sp.clips[j];
      if (werk_clip(c) && c.start_beat <= start_beat + 0.25 && c.start_beat + c.laenge_beats > start_beat + EPS) return true;
    }
  }
  return false;
}

// Die Karte hat eine neue Generation (Rampe angenommen, Hand am Tempo, Storno, neue Zeitachse): die gebundenen Stimmen des Werks tragen die alte Karte und werden
// Brücken nach derselben Regel wie beim Tausch (werk_abloesen); die Nachfolgerin mit der neuen Karte setzt werk_decken an, im selben Block. Brücken bleiben, was
// sie sind (ihre Nachfolgerin trägt dann die neue Karte). Eine klingende Stimme, deren Clip vor s + Frist + ARR_NAHT endet, spielt mit der alten Karte zu Ende.
void Arrangement::warp_karte_neu(const Karte& k, int64_t s) {
  for (Stimme& v : st_) {
    if (!v.aktiv || v.werk < 0 || !v.clip) continue;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_KARTE_VOR_EINSATZ   // Fehlerfall (Nachbesserung 3): eine vorab angesetzte Stimme behält ihr Einsatz-Sample nach der alten Karte (verschiebt die
    if (v.werk_ab >= s) continue;                    // neue Karte den Einsatz, setzt der Vorausblick eine zweite an: der Clip klingt doppelt, bis zu seinem Ende)
#endif
    if (v.werk_ab < s && s + ARR_WARP_FRIST + ARR_NAHT >= v.ende) continue;
    werk_abloesen(k, v, v.clip, s, false);
  }
}

}  // namespace cdj
