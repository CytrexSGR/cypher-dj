// D1 K1 Slice 5: Audio-Clip-Stimmen des Moduls Arrangement (arrangement.h). Fester Pool ARR_STIMMEN; eine Stimme liest
// das gesperrte Audio ihres Clips ab Frame offset_frames + (t − clip_s0). Gain = Clip-Gain · Ein-/Ausblende des Clips ·
// Kurz-Einblende (Einstieg mitten im Clip) · Kurzblende an der Naht (endet auf dem Naht-Sample) · Kurzblende beim
// Stopp (beginnt auf dem Stopp-Sample). Ein geänderter Clip blendet beim Tausch aus einer eigenen Kopie der nächsten
// ARR_NAHT Frames aus (Muster Erzeuger-Ausklang F11): das alte Audio darf danach sofort zur Freigabe.
// Paket 1.13 (Warp, Slice 1): hat der Clip einen Warp, ersetzt W(b) die Zeile „Quellframe = offset + pos“: Quellposition aus dem
// Projekt-Beat des Samples (Tempo-Karte), gelesen mit Catmull-Rom (RE-PITCH). Der ungewarpte Weg bleibt Zeile für Zeile der alte.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {

constexpr double EPS = 1e-9;

// Zwei Warps sind gleich, wenn Modus und alle Marker gleich sind (die Zeiger zeigen in verschiedene Schnappschüsse)
bool warp_gleich(const ArrWarp* a, const ArrWarp* b) {
  if (a == nullptr || b == nullptr) return a == b;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_TAUSCH_GLEICH
  return true;   // Fehlerfall: ein geänderter Warp gilt als unverändert, die Stimme bindet neu und springt ohne Blende auf die neue Abbildung
#else
  if (a->modus != b->modus || a->n != b->n) return false;
  // Slice 4: BEATS-Parameter sind Warp-Daten. Fehlerfälle (je ein Teil des Vergleichs fehlt): die Stimme bindet bei einer Änderung ohne Überblendung neu
#ifndef CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_ZAHL
  if (a->e_n != b->e_n) return false;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_LOOP
  if (a->loop != b->loop) return false;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_HUELLE
  if (a->huelle != b->huelle) return false;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_GLEICH_OHNE_EINHEITEN
  for (int i = 0; i < a->e_n && i < b->e_n; ++i)
    if (a->e_beat[i] != b->e_beat[i] || a->e_frame[i] != b->e_frame[i]) return false;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_PITCH_GLEICH   // Fehlerfall: eine geänderte Tonhöhe gilt als unverändert, die Stimme bleibt gebunden und der neue Wert kommt nie an
  if (a->pitch != b->pitch) return false;   // Slice 5: die Tonhöhe ist ein Warp-Datum; der Wechsel nimmt den Weg „Tausch mit geänderten Warp-Daten“ (Spec 5.3)
#endif
  for (int i = 0; i < a->n; ++i)
    if (a->beat[i] != b->beat[i] || a->frame[i] != b->frame[i]) return false;
  return true;
#endif
}

bool gleich(const ArrClip& a, const ArrClip& b) {
  return a.start_beat == b.start_beat && a.laenge_beats == b.laenge_beats && a.audio == b.audio &&
         a.offset_frames == b.offset_frames && a.gain == b.gain && a.ein_beats == b.ein_beats &&
         a.aus_beats == b.aus_beats && warp_gleich(a.warp, b.warp);
}

// Nachbesserung 4 (Prüfung 4, R3): der Gain ist kein Warp-Datum. Ein Werk-Clip, der sich nur im Gain ändert, braucht keine neue Stimme im Werk (der Callback liest den
// Ring und multipliziert den Gain selbst, Spec Z. 219 „Kopie plus Gain“): er bindet neu, der Gain gleitet über ARR_NAHT.
bool gleich_ausser_gain(const ArrClip& a, const ArrClip& b) {
  return a.start_beat == b.start_beat && a.laenge_beats == b.laenge_beats && a.audio == b.audio && a.offset_frames == b.offset_frames &&
         a.ein_beats == b.ein_beats && a.aus_beats == b.aus_beats && warp_gleich(a.warp, b.warp);
}

// Paket 1.13 Slice 4: BEATS (Spec 5.3, Plan D3 bis D6a). Quellframe f und Gain ge (ohne Clip-Gain, Ein-/Ausblenden und Naht) für das Sample, das `seit` Samples nach dem Beginn
// der Einheit i liegt; platz ist die Länge der Einheit in Samples (bis zum Beginn der nächsten). Beginn und Platz kommen aus der Karte des Kerns (Arrangement::beats_lage):
// ganze Samples, auch bei Tempowechsel innerhalb der Einheit exakt. Die Einheit spielt die Quelle mit Faktor 1 ab e_frame[i], Sample für Sample ohne Interpolation.
// cb (Clip-Beat des Samples) dient nur der Mutation VARISPEED. false: an dieser Stelle nichts zu spielen.
bool beats_quelle(const ArrWarp& w, int i, int64_t seit_i, int64_t platz_i, double cb, int64_t n, int64_t& f, float& ge) noexcept {
  const double seit = static_cast<double>(seit_i);
  const double platz = static_cast<double>(platz_i);
  const double quelle = (i + 1 < w.e_n ? w.e_frame[i + 1] : static_cast<double>(n)) - w.e_frame[i];
  if (seit < 0.0 || quelle <= 0.0) return false;
  double p = seit;
  ge = 1.0f;
  if (seit >= quelle) {
    const double h = quelle * 0.5;
    if (w.loop == 0) {
#ifdef CYPHERDJ_MUTATION_ARR_BEATS_LUECKE_SPIELT
      ge = 1.0f;   // Fehlerfall: nach dem Quellende klingt die Lücke weiter (die Quelle bleibt auf ihrem letzten Frame stehen)
#else
      ge = 0.0f;
#endif
    } else if (w.loop == 1) {   // vor: zweite Hälfte wiederholt, Dreiecks-Blende am Umbruch
      const double u = std::fmod(seit - quelle, h);
      p = h + u;
      const double rand = std::min(u, h - u);
      if (rand < ARR_NAHT) ge = static_cast<float>(rand / ARR_NAHT);
    } else {   // vor_zurueck: Ende, Mitte, Ende; stetig
      const double u = std::fmod(seit - quelle, quelle);
      p = u < h ? quelle - u : u;
    }
    p = std::min(p, quelle - 1.0);
  } else if (w.loop != 2 && platz > quelle && quelle - seit < ARR_NAHT) {
    ge = static_cast<float>((quelle - seit) / ARR_NAHT);   // aus und vor: Blende ans Quellende (vor setzt danach mit der Dreiecks-Blende ein)
  }
#ifndef CYPHERDJ_MUTATION_ARR_BEATS_OHNE_KUERZBLENDE   // Fehlerfall: eine gekürzte Einheit endet hart am Platzende
  if (platz - seit < ARR_NAHT) ge *= static_cast<float>(std::max(0.0, platz - seit) / ARR_NAHT);   // Kürzen (D6)
#endif
  if (w.huelle < 100) {
    const double lang = std::max<double>(ARR_NAHT, std::min(platz, 1e9) * w.huelle / 100.0);
    ge *= static_cast<float>(std::max(0.0, 1.0 - seit / lang));
  }
  f = static_cast<int64_t>(w.e_frame[i]) + static_cast<int64_t>(std::floor(p));
#ifdef CYPHERDJ_MUTATION_ARR_BEATS_VARISPEED   // Fehlerfall: die Einheit läuft wie RE-PITCH mit der Tempo-Abbildung (Geschwindigkeit statt Lage)
  f = static_cast<int64_t>(w.e_frame[i]) + static_cast<int64_t>(std::floor(warp_frame(w, cb) - w.e_frame[i]));
#endif
  (void)cb;
  return f >= 0 && f < n && ge != 0.0f;
}

const ArrClip* finde_clip(const ArrSpur& sp, uint64_t id) {
  for (int i = 0; i < sp.n_clips; ++i)
    if (sp.clips[i].id == id) return &sp.clips[i];
  return nullptr;
}

}  // namespace

int Arrangement::stimmen() const {
  int n = 0;
  for (const Stimme& v : st_) n += v.aktiv ? 1 : 0;
  return n;
}

int Arrangement::warp_stimmen() const {
  int n = 0;
  for (const Stimme& v : st_) n += (v.aktiv && ((v.clip && v.clip->warp) || v.werk >= 0)) ? 1 : 0;
  return n;
}

Arrangement::Stimme* Arrangement::stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_start, int64_t clip_s0,
                                                  bool rampe, int ramp_n) {
  Stimme* v = nullptr;
  for (Stimme& x : st_)
    if (!x.aktiv) {
      v = &x;
      break;
    }
  if (!v) {   // Pool voll: gezählt, der Clip bleibt still (kein Raub mitten im Arrangement)
    ++stimmen_verloren_;
    return nullptr;
  }
  v->aktiv = true;
  v->spur = spur;
  v->clip_id = c.id;
  v->clip = &c;
  v->clip_s0 = clip_s0;
  v->ende = sample_von_p(k, c.start_beat + c.laenge_beats, ursprung_);
  v->ein_n = c.ein_beats > 0.0 ? sample_von_p(k, c.start_beat + c.ein_beats, ursprung_) - clip_s0 : 0;
  v->aus_n = c.aus_beats > 0.0 ? v->ende - sample_von_p(k, c.start_beat + c.laenge_beats - c.aus_beats, ursprung_) : 0;
  v->ramp_ein_ab = rampe ? s_start : -1;
  v->ramp_n = ramp_n;   // Nachbesserung 6: der Platz kann eine Werk-Stimme getragen haben; die Einblende liest ab jetzt v.ramp_n (Vorgabe ARR_EIN: der ungewarpte Weg bleibt der alte)
  v->ab_aus = -1;
  v->p_off = start_beat_ - ursprung_;
  v->ak_n = v->ak_pos = 0;
  v->werk = -1;   // Slice 2: ein Clip des Werks ohne Platz spielt als RE-PITCH (stimme_warp_spielen)
  v->naechste = false;
  return v;
}

// Clips mit Einsatz-Sample in [a, b): Einsatz genau dort, ohne Kurz-Einblende
void Arrangement::clips_starten(const Karte& k, int64_t a, int64_t b) {
  const double p_lo = projekt_beat(k, static_cast<double>(a) - 0.5) - EPS;
  const double p_hi = projekt_beat(k, static_cast<double>(b) - 0.5) + EPS;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const ArrSpur& sp = snap_->spur[i];
    if (sp.art != ArrArt::audio) continue;
    for (int j = 0; j < sp.n_clips && sp.clips[j].start_beat < p_hi; ++j) {
      const ArrClip& c = sp.clips[j];
      if (c.start_beat < p_lo || (klammer() && c.start_beat >= bis_)) continue;
      const int64_t s = sample_von_p(k, c.start_beat, ursprung_);
      if (s < a || s >= b) continue;
      if (werk_clip(c)) {   // Slice 2: vorab angesetzt (Vorausblick), sonst spät: das Werk liefert erst ab a + ARR_WARP_FRIST
        if (hat_stimme(i, c.id, s)) continue;
        if (werk_bruecke_bis(i, c.id, false, a) >= s) continue;   // Nachbesserung 4: eine Brücke spielt den Einsatz (neue Karte ohne Platz: Nachholen in werk_decken)
        const int64_t s_h = std::max(s, a + ARR_WARP_FRIST);
        // Nachbesserung 5 (Prüfung 5, fable M1): die Stimme setzt bei s ein, ihr Ring beginnt bei s_h; bis dahin ist sie spät (gezählt) und klingt als RE-PITCH aus dem
        // Clip (werk_stimme_spielen), nicht still. Vorher schwieg der Clip eine Frist lang ohne Zähler (werk_ab = s_h, Einblende dort)
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_EINSATZ_OHNE_SPAET   // Fehlerfall (Prüfung 5, fable M1): der Clip schweigt bis a + Frist, ungezählt
        if (werk_stimme_starten(k, c, i, s_h, s, s_h > s, ARR_EIN, ursprung_, false)) continue;
#else
        if (werk_stimme_starten(k, c, i, s_h, s, false, ARR_EIN, ursprung_, false, s)) continue;
#endif
        ++warp_kein_platz_;   // kein Platz (Werk voll oder fehlt): RE-PITCH, im Takt, falsche Tonhöhe
        stimme_starten(k, c, i, s, s, false);
        continue;
      }
#ifdef CYPHERDJ_MUTATION_ARR_CLIP_BLOCKANFANG
      stimme_starten(k, c, i, a, a, false);   // Fehlerfall: Einsatz am Teilblock-Anfang statt am Sample
#else
      stimme_starten(k, c, i, s, s, false);
#endif
    }
  }
}

// Clips, die am Ort a schon begonnen haben und noch klingen müssten (Transport-Start mitten im Clip, Tausch, Naht),
// setzen bei a mit Kurz-Einblende ein; die Quellposition folgt aus ihrem (vergangenen) Einsatz-Sample.
void Arrangement::stimmen_einstieg(const Karte& k, int64_t a) {
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const ArrSpur& sp = snap_->spur[i];
    if (sp.art != ArrArt::audio) continue;
    for (int j = 0; j < sp.n_clips; ++j) {
      const ArrClip& c = sp.clips[j];
      if (klammer() && c.start_beat >= bis_) continue;
      const int64_t s_c = sample_von_p(k, c.start_beat, ursprung_);
      const int64_t s_e = sample_von_p(k, c.start_beat + c.laenge_beats, ursprung_);
      if (!(s_c < a && s_e > a)) continue;
      bool hat = false;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_EINSTIEG_NAECHSTE   // Fehlerfall (Nachbesserung 3): die für den Durchlauf nach der Naht angesetzte Stimme zählt mit, der Rest vor der Naht bleibt stumm
      for (const Stimme& v : st_) hat = hat || (v.aktiv && v.clip && v.spur == i && v.clip_id == c.id);
#else
      for (const Stimme& v : st_) hat = hat || (v.aktiv && v.clip && !v.naechste && v.spur == i && v.clip_id == c.id);   // die Stimme des nächsten Durchlaufs klingt erst ab der Naht
#endif
      if (hat) continue;
      if (werk_clip(c)) {   // Slice 2: das Werk braucht ARR_WARP_FRIST; der Clip setzt dort mit Überblendung ein (Warp an, ein neuer Clip am laufenden Ort)
        if (werk_bruecke_bis(i, c.id, false, a) >= 0) continue;   // Nachbesserung 4: eine Brücke spielt den Clip, werk_decken übergibt
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_EINSTIEG_STUMM   // Fehlerfall (Prüfung 3, m2): eine Nachfolgerin, die nie klingt, hält einen Platz bis zum Ende des Clips
        const int64_t w = naht_sample(k);   // in der Klammer endet der Durchlauf an der Naht; dahinter setzt der Vorausblick den nächsten an
        if (a + ARR_WARP_FRIST + ARR_NAHT >= (w >= 0 && w < s_e ? w : s_e)) {   // Clip oder Durchlauf endet vor der Frist: eine Stimme im Werk klänge nie
          stimme_starten(k, c, i, a, s_c, true);           // der Rest (kürzer als die Frist) als RE-PITCH, wie ohne Platz
          continue;
        }
#endif
        if (werk_stimme_starten(k, c, i, a + ARR_WARP_FRIST, s_c, true, ARR_NAHT, ursprung_, false)) {
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_EINSTIEG_LUECKE   // Fehlerfall (Nachbesserung 4): ein Clip, der eben noch klang (ohne Werk, als RE-PITCH ohne Platz), schweigt bis zur Frist
          // Nachbesserung 4 („was klingt, klingt weiter“): klang der Clip eben noch ohne Werk (ohne Warp, RE-PITCH mangels Platz; seine Stimme klingt gerade aus), spielt er
          // bis zur Frist als RE-PITCH und blendet dort in die Stimme des Werks über. Ein Klang, den es vorher nicht gab, setzt erst mit dem Werk ein (Flanke 4).
          bool klang = false;
          for (const Stimme& v : st_) klang = klang || (v.aktiv && !v.clip && v.werk < 0 && v.spur == i && v.clip_id == c.id && v.ak_pos < v.ak_n);
          if (klang)
            if (Stimme* r = stimme_starten(k, c, i, a, s_c, true, ARR_NAHT)) r->ab_aus = a + ARR_WARP_FRIST;   // Nachbesserung 6: sie blendet über ARR_NAHT in die Werk-Stimme über, die Einblende ebenso
#endif
          continue;
        }
        ++warp_kein_platz_;
      }
#ifdef CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE
      stimme_starten(k, c, i, a, s_c, false);   // Fehlerfall: harter Einstieg (Knack)
#else
      stimme_starten(k, c, i, a, s_c, true);
#endif
    }
  }
}

// Slice 4: die Einheit i des BEATS-Clips der Stimme v, in der das Sample t liegt, mit Beginn s0 und Beginn der nächsten s1 (Karte des Kerns). Einheit i beginnt am ersten Sample, dessen
// Clip-Beat >= e_beat[i] ist: beat_at(t) = Clip-Beat − p_off + start_beat des Clips, also t >= sample_at(e_beat[i] + start_beat − p_off). Ganze Samples, bei jedem Tempo (Rampe, Stufe)
// exakt und ohne Zustand (Live, Render, Start mitten in der Einheit gleich). i ist Merker über Aufrufe: nur bei einem Wechsel wird neu gerechnet. false: vor der ersten Einheit.
bool Arrangement::beats_lage(const Karte& k, const Stimme& v, int64_t t, int& i, int64_t& s0, int64_t& s1) const {
  const ArrClip& c = *v.clip;
  const ArrWarp& w = *c.warp;
  const auto su = [&](int j) { return static_cast<int64_t>(std::ceil(k.sample_at(w.e_beat[j] + c.start_beat - v.p_off) - 1e-6)); };
  if (i < 0) {
    i = beats_einheit(w, k.beat_at(static_cast<double>(t)) + v.p_off - c.start_beat);
    s0 = su(i);
    s1 = i + 1 < w.e_n ? su(i + 1) : BEATS_ENDLOS;
  }
  if (t >= s0 && t < s1) return true;
  while (i > 0 && t < s0) {
    --i;
    s1 = s0;
    s0 = su(i);
  }
  while (i + 1 < w.e_n && t >= s1) {
    ++i;
    s0 = s1;
    s1 = i + 1 < w.e_n ? su(i + 1) : BEATS_ENDLOS;
  }
  return t >= s0;
}

void Arrangement::stimme_ausklang(Stimme& v, int64_t s, const Karte& k) {
  const ArrClip& c = *v.clip;
#ifdef CYPHERDJ_MUTATION_ARR_WARP_AUSKLANG_URSPRUNG
  const double d_proj = 0.0;   // Fehlerfall: die Ausklang-Kopie rechnet mit Ursprung und Start von jetzt (Fall 12 rot, Fall 11 bleibt grün)
#else
  const double d_proj = v.p_off - (start_beat_ - ursprung_);   // wie im Spielweg: 0.0, solange sich Ursprung und Start seit dem Stimmenstart nicht verschoben haben
#endif
  int bi = -1;   // Slice 4: Merker der BEATS-Einheit und ihre Grenzen
  int64_t u0 = 0, u1 = 0;
  for (int q = 0; q < ARR_NAHT; ++q) {
    const int64_t t = s + q;
    const int64_t pos = t - v.clip_s0;
    const int64_t f = c.offset_frames + pos;
    // Paket 1.13: gewarpt kommt die Quellposition aus W(b) zum Projekt-Beat des Samples t (die Karte ist die von jetzt)
    const bool beats = c.warp && c.warp->modus == ARR_WARP_BEATS;   // Slice 4: BEATS liest Einheiten, nicht W(b)
    const double cbt = c.warp ? projekt_beat(k, static_cast<double>(t)) + d_proj - c.start_beat : 0.0;
    const double fr = c.warp && !beats ? warp_frame(*c.warp, cbt) : 0.0;
    int64_t bf = 0;
    float bge = 1.0f;
    bool lesbar = c.warp ? fr < static_cast<double>(c.audio->frames) : f < c.audio->frames;
    if (beats) {
#ifdef CYPHERDJ_MUTATION_ARR_BEATS_AUSKLANG_WARP
      lesbar = warp_frame(*c.warp, cbt) < static_cast<double>(c.audio->frames);   // Fehlerfall: der Ausklang liest BEATS wieder über W(b)
      bf = static_cast<int64_t>(std::floor(warp_frame(*c.warp, cbt)));
      bge = 1.0f;
      lesbar = lesbar && bf >= 0;
#else
      lesbar = beats_lage(k, v, t, bi, u0, u1) && beats_quelle(*c.warp, bi, t - u0, u1 - u0, cbt, c.audio->frames, bf, bge);
#endif
    }
    float l = 0.0f, r = 0.0f;
    if (t < v.ende && pos >= 0 && lesbar && (v.ab_aus < 0 || t < v.ab_aus + ARR_NAHT)) {
      float g = c.gain * static_cast<float>(ARR_NAHT - q) / ARR_NAHT * (beats ? bge : 1.0f);
      if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
      if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
      if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < v.ramp_n) g *= static_cast<float>(t - v.ramp_ein_ab) / static_cast<float>(v.ramp_n);
      if (v.ab_aus >= 0 && t >= v.ab_aus) g *= static_cast<float>(ARR_NAHT - (t - v.ab_aus)) / ARR_NAHT;
      if (beats) {
        l = c.audio->daten[2 * bf] * g;
        r = c.audio->daten[2 * bf + 1] * g;
      } else if (c.warp) {
        float wl, wr;
        warp_lies(c.audio->daten, c.audio->frames, fr, wl, wr);
        l = wl * g;
        r = wr * g;
      } else {
        l = c.audio->daten[2 * f] * g;
        r = c.audio->daten[2 * f + 1] * g;
      }
    }
    v.ak[2 * q] = l;
    v.ak[2 * q + 1] = r;
  }
  v.clip = nullptr;
  v.ak_n = ARR_NAHT;
  v.ak_pos = 0;
}

// Paket 1.13: eine gewarpte Stimme. Gains und Enden wie im ungewarpten Weg unten (Test: Warp mit Steigung 1 = ungewarpt); die
// Quellposition kommt aus W(b) zum Projekt-Beat wp_[t − a] und wird mit Catmull-Rom gelesen. Endet mit dem Clip oder der Datei.
void Arrangement::stimme_warp_spielen(Stimme& v, int64_t a, int64_t b, int64_t s0, int64_t naht) {
  const ArrClip& c = *v.clip;
  const ArrWarp& w = *c.warp;
  const float* d = c.audio->daten;
  const int64_t n = c.audio->frames;
  float* bl = bus_l_[v.spur];
  float* br = bus_r_[v.spur];
#ifdef CYPHERDJ_MUTATION_ARR_WARP_NEUSTART_URSPRUNG
  const double d_proj = 0.0;   // Fehlerfall: die Stimme rechnet mit Ursprung und Start von jetzt, die Ausblende eines Neustarts springt
#else
  const double d_proj = v.p_off - (start_beat_ - ursprung_);   // 0.0, solange sich Ursprung und Start seit dem Stimmenstart nicht verschoben haben
#endif
  for (int64_t t = a; t < b; ++t) {
    const int64_t pos = t - v.clip_s0;
    const double fr = warp_frame(w, wp_[t - a] + d_proj - c.start_beat);
#ifdef CYPHERDJ_MUTATION_ARR_WARP_OHNE_DATEIENDE
    if (t >= v.ende) {   // Fehlerfall: die Stimme lebt über das Dateiende hinaus bis zum Clip-Ende
#else
    if (t >= v.ende || fr >= static_cast<double>(n)) {
#endif
      v.aktiv = false;
      break;
    }
    if (pos < 0) continue;
    float g = c.gain;
    if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
    if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
    if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < v.ramp_n) g *= static_cast<float>(t - v.ramp_ein_ab) / static_cast<float>(v.ramp_n);
#ifdef CYPHERDJ_MUTATION_ARR_NAHT_HART
    (void)naht;   // Fehlerfall: harter Schnitt an der Naht
#else
    if (naht >= 0 && naht - t < ARR_NAHT) g *= static_cast<float>(naht - t) / ARR_NAHT;   // endet auf der Naht
#endif
    if (v.ab_aus >= 0 && t >= v.ab_aus) {
      const int64_t q = t - v.ab_aus;
      if (q >= ARR_NAHT) {
        v.aktiv = false;
        break;
      }
      g *= static_cast<float>(ARR_NAHT - q) / ARR_NAHT;
    }
    float l, r;
    warp_lies(d, n, fr, l, r);
    bl[t - s0] += l * g;
    br[t - s0] += r * g;
  }
}

// Slice 4: eine BEATS-Stimme. Gains und Enden wie stimme_warp_spielen; die Quellstelle und die Hüllen der Einheit kommen aus beats_quelle (bps: Beats je Sample im Teilblock).
void Arrangement::stimme_beats_spielen(const Karte& k, Stimme& v, int64_t a, int64_t b, int64_t s0b, int64_t naht) {
  const ArrClip& c = *v.clip;
  const ArrWarp& w = *c.warp;
  const float* d = c.audio->daten;
  const int64_t n = c.audio->frames;
  float* bl = bus_l_[v.spur];
  float* br = bus_r_[v.spur];
  int bi = -1;
  int64_t u0 = 0, u1 = 0;
  for (int64_t t = a; t < b; ++t) {
    if (t >= v.ende) {
      v.aktiv = false;
      break;
    }
    const int64_t pos = t - v.clip_s0;
    if (pos < 0) continue;
    int64_t f = 0;
    float ge = 1.0f;
    const bool da = beats_lage(k, v, t, bi, u0, u1) &&
                    beats_quelle(w, bi, t - u0, u1 - u0, k.beat_at(static_cast<double>(t)) + v.p_off - c.start_beat, n, f, ge);
    float g = c.gain * ge;
    if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
    if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
    if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < v.ramp_n) g *= static_cast<float>(t - v.ramp_ein_ab) / static_cast<float>(v.ramp_n);
    if (naht >= 0 && naht - t < ARR_NAHT) g *= static_cast<float>(naht - t) / ARR_NAHT;
    if (v.ab_aus >= 0 && t >= v.ab_aus) {
      const int64_t q = t - v.ab_aus;
      if (q >= ARR_NAHT) {
        v.aktiv = false;
        break;
      }
      g *= static_cast<float>(ARR_NAHT - q) / ARR_NAHT;
    }
    if (!da || g == 0.0f) continue;
    bl[t - s0b] += d[2 * f] * g;
    br[t - s0b] += d[2 * f + 1] * g;
  }
}

void Arrangement::stimmen_spielen(const Karte& k, int64_t a, int64_t b, int64_t s0, int64_t naht) {
  bool wp_da = false;   // wp_ ist für diesen Teilblock gefüllt (erst, wenn eine gewarpte Stimme klingt)
  for (Stimme& v : st_) {
    if (!v.aktiv) continue;
    if (v.werk >= 0) {   // Slice 2: aus dem Ring des Warp-Werks
      werk_stimme_spielen(k, v, a, b, s0, naht);
      continue;
    }
    float* bl = bus_l_[v.spur];
    float* br = bus_r_[v.spur];
    if (!v.clip) {   // Ausklang aus der eigenen Kopie
      for (int64_t t = a; t < b; ++t) {
        if (v.ak_pos >= v.ak_n) {
          v.aktiv = false;
          break;
        }
        bl[t - s0] += v.ak[2 * v.ak_pos];
        br[t - s0] += v.ak[2 * v.ak_pos + 1];
        ++v.ak_pos;
      }
      continue;
    }
    if (v.clip->warp) {
      if (!wp_da) {
        for (int64_t t = a; t < b; ++t)
#ifdef CYPHERDJ_MUTATION_ARR_WARP_BLOCKANFANG
          wp_[t - a] = projekt_beat(k, static_cast<double>(a));   // Fehlerfall: der Beat steht für den ganzen Teilblock auf seinem Anfang
#else
          wp_[t - a] = projekt_beat(k, static_cast<double>(t));
#endif
        wp_da = true;
      }
      if (v.clip->warp->modus == ARR_WARP_BEATS) {
        stimme_beats_spielen(k, v, a, b, s0, naht);
      } else {
        stimme_warp_spielen(v, a, b, s0, naht);
      }
      continue;
    }
    const ArrClip& c = *v.clip;
    const float* d = c.audio->daten;
    for (int64_t t = a; t < b; ++t) {
      const int64_t pos = t - v.clip_s0;
      const int64_t f = c.offset_frames + pos;
      if (t >= v.ende || f >= c.audio->frames) {
        v.aktiv = false;
        break;
      }
      if (pos < 0) continue;
      float g = c.gain;
      if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
      if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
      if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < v.ramp_n) g *= static_cast<float>(t - v.ramp_ein_ab) / static_cast<float>(v.ramp_n);
#ifdef CYPHERDJ_MUTATION_ARR_NAHT_HART
      (void)naht;   // Fehlerfall: harter Schnitt an der Naht
#else
      if (naht >= 0 && naht - t < ARR_NAHT) g *= static_cast<float>(naht - t) / ARR_NAHT;   // endet auf der Naht
#endif
      if (v.ab_aus >= 0 && t >= v.ab_aus) {
        const int64_t q = t - v.ab_aus;
        if (q >= ARR_NAHT) {
          v.aktiv = false;
          break;
        }
        g *= static_cast<float>(ARR_NAHT - q) / ARR_NAHT;
      }
      bl[t - s0] += d[2 * f] * g;
      br[t - s0] += d[2 * f + 1] * g;
    }
  }
}

void Arrangement::stimmen_tauschen(const ArrSnapshot* neu, int64_t s, const Karte& k) {
  for (Stimme& v : st_) {
    if (!v.aktiv) continue;
    if (!v.clip) {
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_BRUECKE_BLEIBT   // Fehlerfall (Nachbesserung 4): eine Brücke spielt den alten Stand bis zur Frist weiter, obwohl der Clip jetzt weg ist oder ohne Werk spielt
      // Nachbesserung 4: eine Brücke (Werk-Stimme aus einem früheren Ereignis) spielt den alten Stand nur, solange der Clip im neuen Stand einer des Werks ist
      if (v.werk >= 0 && v.ab_aus > s) {
        const ArrClip* c2 = (neu && neu->spur[v.spur].art == ArrArt::audio) ? finde_clip(neu->spur[v.spur], v.clip_id) : nullptr;
        if (!(c2 && werk_clip(*c2) && werk_)) {
          if (v.werk_ab >= s) werk_frei(v);
          else v.ab_aus = s;
        }
      }
#endif
      // Nachbesserung 6 (Flanke 18 c, verdichteter Seed 5212: ein Gain-Ereignis, während die Brücke ohne Platz bis zum Clip-Ende nachholt): auch eine Brücke übernimmt den neuen
      // Gain und gleitet dorthin wie eine gebundene Stimme (Nachbesserung 4, R3); der Gain gehört nicht zum alten Stand, den sie spielt.
      // Nur eine Brücke einer neuen Karte (tausch_bruecke == false: der Inhalt stimmt, nur das Raster ist alt) holt den aktuellen Clip nach. Eine Brücke eines Tausches spielt
      // alten Inhalt aus, der Gain des neuen Standes gilt für sie nicht (Plan-Seed 51969: nach „kuerzen“ hob das Gain-Ereignis sie 18 Fenster lang auf 0,930 statt 0,708)
      if (v.aktiv && v.werk >= 0 && !v.tausch_bruecke) {
        const ArrClip* c3 = (neu && neu->spur[v.spur].art == ArrArt::audio) ? finde_clip(neu->spur[v.spur], v.clip_id) : nullptr;
        if (c3 && c3->gain != v.gain) {
          const float g = (v.gain_ab >= 0 && s - v.gain_ab < ARR_NAHT) ? v.gain_alt + (v.gain - v.gain_alt) * static_cast<float>(std::max<int64_t>(s - v.gain_ab, 0)) / ARR_NAHT : v.gain;
          v.gain_alt = g;
          v.gain_ab = s;
          v.gain = c3->gain;
        }
      }
      continue;
    }
    const ArrClip* c2 = (neu && neu->spur[v.spur].art == ArrArt::audio) ? finde_clip(neu->spur[v.spur], v.clip_id) : nullptr;
#ifdef CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_BINDUNG
    c2 = nullptr;   // Fehlerfall: jede Stimme blendet aus, auch eine unveränderte
#endif
    if (c2 && gleich(*v.clip, *c2)) v.clip = c2;   // spielt ohne Blende weiter, liest jetzt aus dem neuen Schnappschuss
    else if (v.werk >= 0 && c2 && werk_clip(*c2) && gleich_ausser_gain(*v.clip, *c2)) {   // Nachbesserung 4 (R3): nur der Gain, neu binden, der Gain gleitet
      const float g = (v.gain_ab >= 0 && s - v.gain_ab < ARR_NAHT) ? v.gain_alt + (v.gain - v.gain_alt) * static_cast<float>(std::max<int64_t>(s - v.gain_ab, 0)) / ARR_NAHT : v.gain;
      v.gain_alt = g;
      v.gain_ab = s;
      v.gain = c2->gain;
      v.clip = c2;
    }
    else if (v.werk >= 0) werk_abloesen(k, v, c2, s, true);   // Slice 2, Nachbesserung 4: Brücke oder frei, die Nachfolgerin setzt werk_decken an
    else {
      // Nachbesserung 4: eine RE-PITCH-Stimme, die nur bis zu einer Werk-Stimme hält (ab_aus > s: Einstieg oder Platztausch), deckt den Clip bis dorthin. Ihren alten
      // Stand kann sie nicht weiterspielen (die Ausklang-Kopie hält ARR_NAHT): der neue Stand spielt ab s als RE-PITCH bis zu derselben Grenze (sonst Stille bis ab_aus)
      const int64_t bis = v.ab_aus;
      const int spur = v.spur;
      const double urs = start_beat_ - v.p_off;
      // nur, wenn der neue Stand den Clip an s klingen lässt: ein verschobener Clip, der erst später einsetzt, setzt der Vorausblick an (Langlauf der
      // Zufallsfolgen, Seed 22894: sonst hielt eine RE-PITCH-Stimme vor dem Einsatz den Clip besetzt, und er schwieg bis zu seinem Ende)
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_DECKT_VOR_EINSATZ   // Fehlerfall (Langlauf, Seed 22894): auch ein Clip, der erst später einsetzt, wird bis zur Werk-Stimme „gedeckt“
      const bool deckt = bis > s && v.clip->warp && c2 && werk_clip(*c2) && werk_;
#else
      const bool deckt = bis > s && v.clip->warp && c2 && werk_clip(*c2) && werk_ && sample_von_p(k, c2->start_beat, urs) <= s &&
                         s < sample_von_p(k, c2->start_beat + c2->laenge_beats, urs);
#endif
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_UNGEHOERT   // Fehlerfall: zwei Tausche am selben Sample, die erst eben (mit Einblende) gestartete Stimme klingt zusätzlich aus
      if (v.ramp_ein_ab >= s) v.aktiv = false;   // Nachbesserung 4: setzt erst jetzt ein (zweiter Tausch am selben Sample), hat nie geklungen
      else
#endif
        stimme_ausklang(v, s, k);
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_UEBERGANG_LOCH   // Fehlerfall: der Clip schweigt von s bis zur Werk-Stimme
      if (deckt) {
        Stimme* n = stimme_starten(k, *c2, spur, s, sample_von_p(k, c2->start_beat, urs), true, ARR_NAHT);   // Nachbesserung 6: ergänzt die Ausklang-Kopie (ARR_NAHT, linear), nicht 32
        if (n) n->ab_aus = bis;
      }
#else
      (void)deckt; (void)spur; (void)urs;
#endif
    }
  }
}

// Nachbesserung 4 (Nebenbefund N2): eine neue Karten-Generation verschiebt das End-Sample eines gewarpten Clips. Eine RE-PITCH-Stimme (Modus RE-PITCH, oder ein Clip
// des Werks ohne Platz) liest ihre Quellposition schon aus der Karte des Blocks, endete aber am End-Sample der alten Karte: hier rechnet sie es neu (Ausblende mit).
void Arrangement::stimmen_karte_neu(const Karte& k) {
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_ENDE_ALTE_KARTE   // Fehlerfall: die RE-PITCH-Stimme endet am End-Sample der alten Karte (doppelt oder Loch am Clip-Ende)
  for (Stimme& v : st_) {
    if (!v.aktiv || v.werk >= 0 || !v.clip || !v.clip->warp) continue;
    const ArrClip& c = *v.clip;
    const double urs = start_beat_ - v.p_off;
    v.ende = sample_von_p(k, c.start_beat + c.laenge_beats, urs);
    v.aus_n = c.aus_beats > 0.0 ? v.ende - sample_von_p(k, c.start_beat + c.laenge_beats - c.aus_beats, urs) : 0;
  }
#else
  (void)k;
#endif
}

void Arrangement::stimmen_stopp(int64_t s) {
  for (Stimme& v : st_) {
#ifdef CYPHERDJ_MUTATION_ARR_WARP_WERK_STOPP_VOR_EINSATZ   // Fehlerfall (Nachbesserung 3): eine Stimme, die erst nach dem Stopp einsetzt, spielt ein Stück ihrer Ausblende (ohne Einblende)
    if (v.aktiv && v.naechste) {
#else
    if (v.aktiv && v.werk >= 0 && (v.naechste || v.werk_ab >= s)) {   // Slice 2: eine vorab angesetzte Stimme (oder eine Nachfolgerin) hat nie geklungen
#endif
      werk_frei(v);
      continue;
    }
    if (v.aktiv && (v.clip || v.werk >= 0) && (v.ab_aus < 0 || v.ab_aus > s)) v.ab_aus = s;
  }
}

void Arrangement::stimmen_naht() {
  for (Stimme& v : st_) {
#ifndef CYPHERDJ_MUTATION_ARR_WARP_WERK_NAHT_ALLE   // Fehlerfall: die Naht beendet auch die vorab angesetzten Stimmen, der neue Durchlauf bleibt stumm
    if (v.aktiv && v.naechste) {   // Slice 2: die vorab angesetzte Stimme des neuen Durchlaufs wird jetzt die laufende
      v.naechste = false;
      continue;
    }
#endif
    if (v.aktiv && v.werk >= 0) werk_frei(v);
    else if (v.aktiv && v.clip) v.aktiv = false;   // ihre Kurzblende endete auf dem Naht-Sample
  }
}

}  // namespace cdj
