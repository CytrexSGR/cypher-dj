// D1 K1 Slice 5: Audio-Clip-Stimmen des Moduls Arrangement (arrangement.h). Fester Pool ARR_STIMMEN; eine Stimme liest
// das gesperrte Audio ihres Clips ab Frame offset_frames + (t − clip_s0). Gain = Clip-Gain · Ein-/Ausblende des Clips ·
// Kurz-Einblende (Einstieg mitten im Clip) · Kurzblende an der Naht (endet auf dem Naht-Sample) · Kurzblende beim
// Stopp (beginnt auf dem Stopp-Sample). Ein geänderter Clip blendet beim Tausch aus einer eigenen Kopie der nächsten
// ARR_NAHT Frames aus (Muster Erzeuger-Ausklang F11): das alte Audio darf danach sofort zur Freigabe.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {

constexpr double EPS = 1e-9;

bool gleich(const ArrClip& a, const ArrClip& b) {
  return a.start_beat == b.start_beat && a.laenge_beats == b.laenge_beats && a.audio == b.audio &&
         a.offset_frames == b.offset_frames && a.gain == b.gain && a.ein_beats == b.ein_beats &&
         a.aus_beats == b.aus_beats;
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

void Arrangement::stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_start, int64_t clip_s0,
                                 bool rampe) {
  Stimme* v = nullptr;
  for (Stimme& x : st_)
    if (!x.aktiv) {
      v = &x;
      break;
    }
  if (!v) {   // Pool voll: gezählt, der Clip bleibt still (kein Raub mitten im Arrangement)
    ++stimmen_verloren_;
    return;
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
  v->ab_aus = -1;
  v->ak_n = v->ak_pos = 0;
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
      for (const Stimme& v : st_) hat = hat || (v.aktiv && v.clip && v.spur == i && v.clip_id == c.id);
      if (hat) continue;
#ifdef CYPHERDJ_MUTATION_ARR_EINSTIEG_OHNE_RAMPE
      stimme_starten(k, c, i, a, s_c, false);   // Fehlerfall: harter Einstieg (Knack)
#else
      stimme_starten(k, c, i, a, s_c, true);
#endif
    }
  }
}

void Arrangement::stimme_ausklang(Stimme& v, int64_t s) {
  const ArrClip& c = *v.clip;
  for (int q = 0; q < ARR_NAHT; ++q) {
    const int64_t t = s + q;
    const int64_t pos = t - v.clip_s0;
    const int64_t f = c.offset_frames + pos;
    float l = 0.0f, r = 0.0f;
    if (t < v.ende && pos >= 0 && f < c.audio->frames && (v.ab_aus < 0 || t < v.ab_aus + ARR_NAHT)) {
      float g = c.gain * static_cast<float>(ARR_NAHT - q) / ARR_NAHT;
      if (pos < v.ein_n) g *= static_cast<float>(pos) / static_cast<float>(v.ein_n);
      if (v.ende - t < v.aus_n) g *= static_cast<float>(v.ende - t) / static_cast<float>(v.aus_n);
      if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < ARR_EIN) g *= static_cast<float>(t - v.ramp_ein_ab) / ARR_EIN;
      if (v.ab_aus >= 0 && t >= v.ab_aus) g *= static_cast<float>(ARR_NAHT - (t - v.ab_aus)) / ARR_NAHT;
      l = c.audio->daten[2 * f] * g;
      r = c.audio->daten[2 * f + 1] * g;
    }
    v.ak[2 * q] = l;
    v.ak[2 * q + 1] = r;
  }
  v.clip = nullptr;
  v.ak_n = ARR_NAHT;
  v.ak_pos = 0;
}

void Arrangement::stimmen_spielen(int64_t a, int64_t b, int64_t s0, int64_t naht) {
  for (Stimme& v : st_) {
    if (!v.aktiv) continue;
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
      if (v.ramp_ein_ab >= 0 && t - v.ramp_ein_ab < ARR_EIN) g *= static_cast<float>(t - v.ramp_ein_ab) / ARR_EIN;
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

void Arrangement::stimmen_tauschen(const ArrSnapshot* neu, int64_t s) {
  for (Stimme& v : st_) {
    if (!v.aktiv || !v.clip) continue;
    const ArrClip* c2 = (neu && neu->spur[v.spur].art == ArrArt::audio) ? finde_clip(neu->spur[v.spur], v.clip_id) : nullptr;
#ifdef CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_BINDUNG
    c2 = nullptr;   // Fehlerfall: jede Stimme blendet aus, auch eine unveränderte
#endif
    if (c2 && gleich(*v.clip, *c2)) v.clip = c2;   // spielt ohne Blende weiter, liest jetzt aus dem neuen Schnappschuss
    else stimme_ausklang(v, s);
  }
}

void Arrangement::stimmen_stopp(int64_t s) {
  for (Stimme& v : st_)
    if (v.aktiv && v.clip && (v.ab_aus < 0 || v.ab_aus > s)) v.ab_aus = s;
}

void Arrangement::stimmen_naht() {
  for (Stimme& v : st_)
    if (v.aktiv && v.clip) v.aktiv = false;   // ihre Kurzblende endete auf dem Naht-Sample
}

}  // namespace cdj
