#include "cypherdj/loopbox.h"

#include <algorithm>

namespace cdj {

const Loop* LoopBoxen::laden(int box, const Loop* l) {
  if (!gueltig(box)) return l;
  Box& b = b_[box - 1];
  const Loop* alt = b.loop;
  if (l != alt) {  // Keylock: die Variante gehört zum alten Loop, Pfad und Blende lesen aus ihm; alles geht in den Ring
    const Loop* var = b.variante;
    const Loop* pf = b.pfad;
    const Loop* ba = b.blende_alt;
    b.variante = nullptr;
    b.pfad = nullptr;
    b.blende_alt = nullptr;
    b.blende_pos = 0;
    b.loop = l;
    for (const Loop* q : {var, pf, ba})
      if (q != alt) gib_frei(b, q);  // der alte Loop selbst geht über den Rückgabewert zurück
  }
  b.versatz = l ? l->versatz : 0;
  if (!l) b.status = BoxStatus::leer;
  else if (b.status == BoxStatus::leer) b.status = BoxStatus::bereit;
  return alt == l ? nullptr : alt;
}

// Gehört v zu lp? Die Variante übernimmt den name des Originals, hat dieselben beats und frames' = llround(frames · 128 /
// T_r) (± 1 für die Rundung im Render), und ihr Puffer trägt genau 2 · frames' Werte: sonst läse spiele_frei daneben.
bool LoopBoxen::passt(const Loop& lp, const Loop& v) {
  if (&v == &lp || v.name != lp.name || v.beats != lp.beats || v.frames <= 0) return false;
  if (!(v.bpm > 0.0) || !std::isfinite(v.bpm)) return false;
  if ((int64_t)(v.daten.size()) != 2 * v.frames) return false;
  const double soll = std::round((double)lp.frames * LOOP_BPM / v.bpm);
  return std::fabs((double)v.frames - soll) <= 1.0;
}

const Loop* LoopBoxen::variante_setzen(int box, const Loop* v) {
  if (!gueltig(box)) return v;
  Box& b = b_[box - 1];
  if (!b.loop) return v;  // eine Variante gehört zu einem Loop
  if (v == b.variante) return nullptr;
  if (v && !passt(*b.loop, *v)) {  // Slice 2b F2/F9: fremde oder falsch gebaute Variante: nie gespielt, sofort zurück
    ++abgelehnt_;
    return v;
  }
  const Loop* alt = b.variante;
  b.variante = v;
  // Klingt die alte Variante gerade (Pfad oder Blende), liest der Callback noch aus ihr: sie geht erst nach der Blende
  // über abholen() zurück, sonst frei geben wäre ein Zugriff auf gelöschten Speicher.
  if (alt && (alt == b.pfad || alt == b.blende_alt)) return nullptr;
  return alt;
}

void LoopBoxen::gib_frei(Box& b, const Loop* q) {
  if (!q || q == b.loop || q == b.variante || q == b.pfad || q == b.blende_alt) return;  // wird noch gebraucht
  for (int i = 0; i < frei_n_; ++i)
    if (frei_[i] == q) return;  // schon im Ring (Pfad und Variante zeigten auf dasselbe): jeder Zeiger genau einmal
  if (frei_n_ < FREI_MAX) frei_[frei_n_++] = q;
  else ++frei_verloren_;  // Ring voll: der Kern holt nach jedem laden und Block ab, das darf nie eintreten
}

void LoopBoxen::pfad_verwerfen(Box& b) {
  const Loop* pf = b.pfad;
  const Loop* ba = b.blende_alt;
  b.pfad = nullptr;
  b.blende_alt = nullptr;
  b.blende_pos = 0;
  gib_frei(b, pf);
  gib_frei(b, ba);
}

const Loop* LoopBoxen::abholen() {
  if (frei_n_ == 0) return nullptr;
  const Loop* q = frei_[0];
  for (int i = 1; i < frei_n_; ++i) frei_[i - 1] = frei_[i];
  frei_[--frei_n_] = nullptr;
  return q;
}

int LoopBoxen::raster(int box, int64_t v) {
  if (!gueltig(box)) return 2;
  Box& b = b_[box - 1];
  if (!b.loop) return 1;
  if (v <= -b.loop->frames || v >= b.loop->frames) return 2;
  b.versatz = v;
  return 0;
}

bool LoopBoxen::start(int box, double beat0) {
  if (!gueltig(box) || !b_[box - 1].loop) return false;
  Box& b = b_[box - 1];
  if (b.status == BoxStatus::bereit) {
    b.status = BoxStatus::wartet;
    b.start_beat = naechste_eins(beat0);
  } else if (b.status == BoxStatus::endet) {
    b.status = BoxStatus::laeuft;  // Stopp zurückgenommen
  }
  return true;
}

bool LoopBoxen::stopp(int box, double beat0) {
  if (!gueltig(box) || !b_[box - 1].loop) return false;
  Box& b = b_[box - 1];
  if (b.status == BoxStatus::wartet) {
    b.status = BoxStatus::bereit;
  } else if (b.status == BoxStatus::laeuft) {
    b.status = BoxStatus::endet;
    b.stopp_beat = naechste_eins(beat0);
  }
  return true;
}

Mitschnitt* LoopBoxen::leeren() {
  for (Box& b : b_)
    if (b.loop) b.status = BoxStatus::bereit;
  Mitschnitt* m = mitschnitt_;  // MVP 2 Scheibe 2: ein laufender Mitschnitt gilt als abgebrochen
  mitschnitt_ = nullptr;
  return m;
}

double LoopBoxen::mitschnitt_ab_beat(double beat0, int beats) {
  const double lang = (double)beats;
  return std::ceil(beat0 / lang - 1e-9) * lang;
}

bool LoopBoxen::mitschnitt(Mitschnitt* m, double beat0, const Karte& k) {
  if (mitschnitt_) return false;  // ueberlappung: der Aufrufer meldet ab und gibt m unverändert zurück
  const double lang = (double)m->beats;
  m->ab_beat = mitschnitt_ab_beat(beat0, m->beats);
  m->ab_sample = std::llround(k.sample_at(m->ab_beat));
  // Plan Tempo-Folge: N Beats beim Tempo der Aufnahme; nie mehr, als der Puffer fasst
  m->roh_frames = std::min<int64_t>(std::llround(k.sample_at(m->ab_beat + lang)) - m->ab_sample, (int64_t)m->daten.size() / 2);
  m->bpm = k.bpm_at((double)m->ab_sample);
  m->gefuellt = 0;
  mitschnitt_ = m;
  return true;
}

BoxStatus LoopBoxen::status(int box) const { return gueltig(box) ? b_[box - 1].status : BoxStatus::leer; }

void LoopBoxen::spiele(const Box& b, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l, float* r) {
  const Loop& lp = *b.loop;
#ifdef CYPHERDJ_MUTATION_LOOP_AB_START
  int64_t pos = (von - b.start_sample) % lp.frames;  // Fehlerfall der Abnahme: Position ab dem Einsatz, nicht aus dem Beat
  (void)k;
#else
  const double lang = (double)lp.beats;
  double ph = std::fmod(k.beat_at((double)von), lang);
  if (ph < 0) ph += lang;
#ifdef CYPHERDJ_MUTATION_LOOP_SPB
  int64_t pos = std::llround(ph * (double)(LOOP_SPB + 1)) % lp.frames;  // Fehlerfall am Ziel: falsches Raster
#else
  int64_t pos = std::llround(ph * (double)LOOP_SPB) % lp.frames;
#endif
#endif
#ifndef CYPHERDJ_MUTATION_LOOP_OHNE_VERSATZ
  pos = ((pos + b.versatz) % lp.frames + lp.frames) % lp.frames;  // Plan Grid: Drehung um den Raster-Versatz
#endif
  const float* d = lp.daten.data();
  for (int64_t t = von; t < bis; ++t) {
    l[t - n0] = d[2 * pos];
    r[t - n0] = d[2 * pos + 1];
    if (++pos == lp.frames) pos = 0;
  }
}

// Plan Tempo-Folge (2026-09-30): weicht die Karte von 128 BPM ab, läuft der Lesekopf mit bpm/128 durch den Loop
// (Varispeed, ohne Tonhöhenerhalt; Keylock kommt mit dem Stretcher). Die Position kommt an beiden Rändern des
// Abschnitts aus dem Beat, dazwischen linear: so bleibt die Box phasenstarr und an den Blockgrenzen stetig, auch in
// einer Rampe. Gelesen wird mit Catmull-Rom über vier Frames, mit Umlauf am Loop-Ende. Keine Allokation.
void LoopBoxen::spiele_frei(const Loop& lp, double versatz, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l,
                            float* r) {
  const int64_t F = lp.frames;
  const double fr = (double)F;
#ifdef CYPHERDJ_MUTATION_LOOP_TEMPO_STARR
  double pos = std::fmod((double)von, fr);  // Fehlerfall der Abnahme: Position aus den Samples, das Tempo zählt nicht
  const double schritt = 1.0;
  (void)k;
#else
  const double lang = (double)lp.beats;
  const double spb = fr / lang;  // Frames je Beat dieses Loops: 22500 beim Original, frames'/beats bei einer Keylock-Variante
  const double b_von = k.beat_at((double)von);
  double ph = std::fmod(b_von, lang);
  if (ph < 0) ph += lang;
  double pos = ph * spb;
  const double schritt = (k.beat_at((double)bis) - b_von) * spb / (double)(bis - von);
#endif
  pos = std::fmod(pos + versatz, fr);
  if (pos < 0) pos += fr;
  const float* d = lp.daten.data();
  for (int64_t t = von; t < bis; ++t) {
    const int64_t i1 = std::min((int64_t)pos, F - 1);
    const float x = (float)(pos - (double)i1);
    const int64_t i0 = i1 == 0 ? F - 1 : i1 - 1;
    const int64_t i2 = i1 + 1 == F ? 0 : i1 + 1;
    const int64_t i3 = i2 + 1 == F ? 0 : i2 + 1;
    for (int c = 0; c < 2; ++c) {
      const float y0 = d[2 * i0 + c], y1 = d[2 * i1 + c], y2 = d[2 * i2 + c], y3 = d[2 * i3 + c];
      const float ka = 0.5f * (-y0 + 3.0f * y1 - 3.0f * y2 + y3);
      const float kb = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
      const float kc = 0.5f * (y2 - y0);
      (c ? r : l)[t - n0] = ((ka * x + kb) * x + kc) * x + y1;
    }
    pos += schritt;
    if (pos >= fr) pos -= fr;
  }
}

// Keylock: gilt die Variante der Box in diesem Block? Tempo an beiden Prüfstellen nah genug am Renderttempo, keine Rampe.
bool LoopBoxen::variante_gilt(const Box& b, double bpm0, double bpm1, bool ruhig) {
#ifdef CYPHERDJ_MUTATION_LOOP_VARIANTE_IGNORIERT
  (void)b; (void)bpm0; (void)bpm1; (void)ruhig;
  return false;  // Fehlerfall der Abnahme: die Variante wird nie benutzt, die Box bleibt im Varispeed
#else
  const Loop* v = b.variante;
  return v && ruhig && std::fabs(bpm0 - v->bpm) <= 0.05 &&
         std::fabs(bpm1 - v->bpm) <= 0.05;
#endif
}

// Einen Lesepfad in l/r schreiben: das Original (direkt bei 128 BPM ohne Rampe, sonst Varispeed) oder eine Variante
// (immer gebrochener Schritt über die Variante, Versatz auf ihr Raster umgerechnet).
void LoopBoxen::spiele_pfad(const Box& b, const Loop* q, bool direkt, const Karte& k, int64_t von, int64_t bis, int64_t n0,
                            float* l, float* r) {
  if (q == b.loop) {
    if (direkt) spiele(b, k, von, bis, n0, l, r);
    else spiele_frei(*q, (double)b.versatz, k, von, bis, n0, l, r);
    return;
  }
  const double spb2 = (double)q->frames / (double)q->beats;
  spiele_frei(*q, (double)b.versatz * spb2 / (double)LOOP_SPB, k, von, bis, n0, l, r);
}

int LoopBoxen::block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r,
                     BoxMeldung* meldungen, int max, Mitschnitt** fertig) {
  int nm = 0;
  auto melde = [&](int box, BoxStatus s, int64_t smp) {
    if (nm < max) meldungen[nm++] = BoxMeldung{box, s, smp};
  };
  const int64_t ende = n0 + n;
  // Direktweg (bitgenau) nur, wenn der ganze Block bei 128 BPM ohne Rampe liegt; sonst Varispeed (Plan Tempo-Folge).
  const bool tempo_ok = std::fabs(k.bpm_at((double)n0) - LOOP_BPM) < 1e-6 && k.k_at((double)n0) == 0.0 &&
                        std::fabs(k.bpm_at((double)(ende - 1)) - LOOP_BPM) < 1e-6 && k.k_at((double)(ende - 1)) == 0.0;
  const double bpm0 = k.bpm_at((double)n0), bpm1 = k.bpm_at((double)(ende - 1));
  const bool ruhig = k.k_at((double)n0) == 0.0 && k.k_at((double)(ende - 1)) == 0.0;
  for (int i = 0; i < LOOP_BOXEN; ++i) {
    Box& b = b_[i];
    const int box = i + 1;
    const bool spielt = b.status == BoxStatus::wartet || b.status == BoxStatus::laeuft || b.status == BoxStatus::endet;
    if (!b.loop || !spielt) {
      if (b.pfad || b.blende_alt) pfad_verwerfen(b);  // Keylock: eine stehende Box hat keinen Pfad mehr
      continue;
    }
    int64_t von = n0, bis = ende;
    if (b.status == BoxStatus::wartet) {
      int64_t s = std::llround(k.sample_at(b.start_beat));
      if (s < n0) {  // Einsatz liegt hinter uns (verschobene Karte): nicht sofort, sondern auf der nächsten Takt-Eins
        b.start_beat = naechste_eins(k.beat_at((double)n0));
        s = std::llround(k.sample_at(b.start_beat));
      }
      if (s >= ende) continue;
      von = std::max(n0, s);
      b.status = BoxStatus::laeuft;
      b.start_sample = von;
      melde(box, b.status, von);
    }
    bool zu_ende = false;
    if (b.status == BoxStatus::endet) {
      const int64_t s = std::llround(k.sample_at(b.stopp_beat));
      if (s < ende) {
        bis = std::max(von, s);
        zu_ende = true;
      }
    }
    std::fill(tmp_l_, tmp_l_ + n, 0.0f);
    std::fill(tmp_r_, tmp_r_ + n, 0.0f);
    if (bis > von) {
      // Keylock: welcher Lesepfad gilt in diesem Block? Die Variante nur, wenn ihr Tempo passt und die Karte an beiden
      // Rändern ohne Rampe liegt (dieselben Prüfstellen wie tempo_ok); sonst das Original (Direktweg oder Varispeed).
      const Loop* neu = b.loop;
      // Vorrang (Slice 2b F1): erst der Direktweg (tempo_ok: genau 128, ohne Rampe), dann die Variante, dann Varispeed.
      if (!tempo_ok && variante_gilt(b, bpm0, bpm1, ruhig)) neu = b.variante;
      if (!b.pfad) {
        b.pfad = neu;  // erster Block nach dem Einsatz: nichts, aus dem geblendet werden könnte
      } else if (neu != b.pfad && !b.blende_alt) {
        // Wechsel: aus dem alten Pfad ausblenden. Läuft schon eine Blende, wartet der Wunsch (Slice 2b F3): die Wahl wird
        // jeden Block neu getroffen, also kommt er nach deren Ende von selbst; ein Abbruch mittendrin wäre ein Sprung
        // von (1 − g) · |A − B|. Die Zeiger der beteiligten Pfade bleiben bis dahin gültig (pfad, blende_alt).
        b.blende_alt = b.pfad;
        b.pfad = neu;
        b.blende_pos = 0;
      }
      spiele_pfad(b, b.pfad, tempo_ok, k, von, bis, n0, tmp_l_, tmp_r_);
      if (b.blende_alt) {
        spiele_pfad(b, b.blende_alt, tempo_ok, k, von, bis, n0, alt_l_, alt_r_);
        for (int64_t t = von; t < bis; ++t) {
          const int64_t kk = (int64_t)b.blende_pos + (t - von);
          if (kk >= BLENDE_FRAMES) break;  // ab hier reiner neuer Pfad
          const float g = (float)kk / (float)BLENDE_FRAMES;  // linear: beide Pfade lesen dieselbe Stelle des Beats
          tmp_l_[t - n0] = alt_l_[t - n0] * (1.0f - g) + tmp_l_[t - n0] * g;
          tmp_r_[t - n0] = alt_r_[t - n0] * (1.0f - g) + tmp_r_[t - n0] * g;
        }
        b.blende_pos += (int)(bis - von);
        if (b.blende_pos >= BLENDE_FRAMES) {
          const Loop* fertig = b.blende_alt;
          b.blende_alt = nullptr;
          b.blende_pos = 0;
          gib_frei(b, fertig);
        }
      }
    }
    float* l = ein_l[LOOP_KANAL0 + i];
    float* r = ein_r[LOOP_KANAL0 + i];
    for (int t = 0; t < n; ++t) {
      l[t] += tmp_l_[t];
      r[t] += tmp_r_[t];
    }
    if (zu_ende) {
      pfad_verwerfen(b);
      b.status = BoxStatus::bereit;
      melde(box, b.status, bis);
    }
  }
  if (mitschnitt_ != nullptr) {  // MVP 2 Scheibe 2: erz/1 (Kanal MITSCHNITT_KANAL) vor Trim, ab ab_sample kopieren
    Mitschnitt& mt = *mitschnitt_;
    const int64_t ab = mt.ab_sample;
    // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 2) und Plan Tempo-Folge: das Tempo der Aufnahme muss fest bleiben.
    // Vor dem Einsatz dieselbe Karte (ab_beat am selben Sample), bis zum Ende dasselbe Tempo ohne Rampe; sonst wäre
    // die Datei versetzt oder verzerrt und gälte trotzdem als fertig.
    // Geprüft wird nur der Teil des Blocks, der in die Aufnahme fällt (Code-Review F1: eine Rampe, die auf dem End-Beat
    // beginnt, liegt im selben Block hinter dem letzten kopierten Sample und darf den fertigen Mitschnitt nicht kippen).
    const int64_t p0 = std::max(n0, ab), p1 = std::min(ende, ab + mt.roh_frames) - 1;
    const bool tempo_fest = p1 < p0 || (k.k_at((double)p0) == 0.0 && std::fabs(k.bpm_at((double)p0) - mt.bpm) < 1e-9 &&
                                        k.k_at((double)p1) == 0.0 && std::fabs(k.bpm_at((double)p1) - mt.bpm) < 1e-9);
    if (!tempo_fest || (mt.gefuellt == 0 && std::llround(k.sample_at(mt.ab_beat)) != ab)) {
      mt.abgebrochen = true;
      if (fertig) *fertig = mitschnitt_;
      mitschnitt_ = nullptr;
      return nm;
    }
    if (ab < ende) {
#ifdef CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG
      const int64_t von = n0;  // Fehlerfall der Abnahme: Einsatz am Blockanfang statt ab ab_sample
#else
      const int64_t von = std::max(n0, ab);
#endif
      // bis nie über das Ende des Puffers hinaus: von + Rest ist die Grenze des Wächters bei einem Fehlerfall wie der
      // Mutation oben (von zu früh würde sonst mehr als roh_frames − gefuellt Samples schreiben, ein Speicherüberlauf).
      const int64_t bis = std::min({ende, ab + mt.roh_frames, von + (mt.roh_frames - mt.gefuellt)});
      if (bis > von) {
        const float* el = ein_l[MITSCHNITT_KANAL];
        const float* er = ein_r[MITSCHNITT_KANAL];
        for (int64_t t = von; t < bis; ++t) {
          const int64_t p = mt.gefuellt + (t - von);
          mt.daten[(size_t)(2 * p)] = el[t - n0];
          mt.daten[(size_t)(2 * p + 1)] = er[t - n0];
        }
        mt.gefuellt += bis - von;
      }
      if (mt.gefuellt >= mt.roh_frames) {
        if (fertig) *fertig = mitschnitt_;
        mitschnitt_ = nullptr;
      }
    }
  }
  return nm;
}

}  // namespace cdj
