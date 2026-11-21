// D1 K1 Slice 6: Noten des Moduls Arrangement an Senken (Spec D1 2.2). Jede Note mit Ziel-Sample T geht im Block
// hinaus, der T − vorhalt() der Senke enthält (Wirt: Rundweg 2n, intern: 0); der Vorausblick rechnet über die
// Loop-Klammer und schickt die Noten des nächsten Durchlaufs rechtzeitig. Offene Noten (On gesendet, Off ausstehend)
// stehen in einer Liste fester Größe unabhängig vom Schnappschuss; ihr Off-Ziel ist an Naht und Stopp gekappt. Beim
// Tausch geht das Off einer Note sofort hinaus, wenn sie fehlt, ein anderes Ende, einen anderen Ton oder eine andere
// Senke hat.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {

constexpr double EPS = 1e-9;

const ArrNote* finde_note(const ArrSpur& sp, uint64_t id) {
  int lo = 0, hi = sp.n_noten - 1;
  while (lo <= hi) {
    const int mi = (lo + hi) / 2;
    if (sp.noten_id[mi] == id) return &sp.noten[sp.noten_id_index[mi]];
    if (sp.noten_id[mi] < id) lo = mi + 1;
    else hi = mi - 1;
  }
  return nullptr;
}

int erste_note_ab(const ArrSpur& sp, double b) {   // erster Index mit beat >= b
  int lo = 0, hi = sp.n_noten;
  while (lo < hi) {
    const int mi = (lo + hi) / 2;
    if (sp.noten[mi].beat < b) lo = mi + 1;
    else hi = mi;
  }
  return lo;
}

// Tracker task 16: what a bend or pegel list says at project beat b: the value in force (a running glide interpolated), the value the glide is heading for and the beats it still needs
// (0: none). Only events strictly before b count (an event at b itself is sent by the window at its own sample). A glide starts from the value in force at its own beat, which
// is the target of the previous event unless that one is still gliding there: the walk back covers exactly such a chain of overlapping glides.
struct FxStand {
  float wert, ziel;
  double rest;
};

FxStand fx_stand(const ArrFxPunkt* e, int n, double b, float neutral) {
  int lo = 0, hi = n;
  while (lo < hi) {   // first index with beat >= b - EPS
    const int mi = (lo + hi) / 2;
    if (e[mi].beat < b - EPS) lo = mi + 1;
    else hi = mi;
  }
  const int k = lo - 1;
  if (k < 0) return {neutral, neutral, 0.0};
  int j0 = k;
  while (j0 > 0 && e[j0 - 1].gleit > 0.0f && e[j0 - 1].beat + static_cast<double>(e[j0 - 1].gleit) > e[j0].beat) --j0;
  float v = j0 == 0 ? neutral : e[j0 - 1].wert;
  for (int j = j0; j < k; ++j) v += (e[j].wert - v) * static_cast<float>((e[j + 1].beat - e[j].beat) / static_cast<double>(e[j].gleit));
  const ArrFxPunkt& l = e[k];
  const double ende = l.beat + static_cast<double>(l.gleit);
  if (l.gleit > 0.0f && ende > b + EPS) return {v + (l.wert - v) * static_cast<float>((b - l.beat) / static_cast<double>(l.gleit)), l.wert, ende - b};
  return {l.wert, l.wert, 0.0};
}

int erster_fx_ab(const ArrFxPunkt* e, int n, double b) {   // first index with beat >= b
  int lo = 0, hi = n;
  while (lo < hi) {
    const int mi = (lo + hi) / 2;
    if (e[mi].beat < b) lo = mi + 1;
    else hi = mi;
  }
  return lo;
}

}  // namespace

ArrSenke* Arrangement::senke_fuer(const ArrSnapshot* s, int spur) const {
  if (!s) return nullptr;
  const ArrSpur& sp = s->spur[spur];
  if (sp.art == ArrArt::intern) return senke_intern_;
  if (sp.art == ArrArt::rack) return senke_rack_;   // 1.9 U6
  if (sp.art == ArrArt::strom) return senke_strom_;   // container core K7
  if (sp.art == ArrArt::wirt && sp.slot >= 1 && sp.slot <= ARR_WIRT_SLOTS) return senke_wirt_[sp.slot - 1];
  return nullptr;
}

void Arrangement::offen_aus_bis(int64_t ende) {
  int w = 0;
  for (int i = 0; i < n_offen_; ++i) {
    const Offen& o = offen_[i];
    if (o.aus - o.senke->vorhalt() < ende) {
      o.senke->note(o.spur, o.aus, o.ton, 0, false);
      continue;
    }
    offen_[w++] = o;
  }
  n_offen_ = w;
}

void Arrangement::noten_fenster(const Karte& k, int spur, ArrSenke* se, int64_t von, int64_t bis) {
  const ArrSpur& sp = snap_->spur[spur];
  if (sp.n_noten == 0) return;
  double kb_lo = k.beat_at(static_cast<double>(von) - 0.5);
  const double kb_hi = k.beat_at(static_cast<double>(bis) - 0.5);
  double urs = ursprung_;
#ifndef CYPHERDJ_MUTATION_ARR_FENSTER_LINEAR
  // Spec 2.2, §4.11: das Fenster liegt um den Vorhalt vor dem Kopf und kann schon hinter der Naht beginnen (die letzten
  // Blöcke vor dem Wrap); dann gehört es zum nächsten Durchlauf. bis − von ≥ 1 Beat ist länger als jeder Vorhalt, die
  // Schleife läuft höchstens einmal (Deckel 4 gegen Endlosschleifen bei kaputter Karte).
  for (int n = 0; n < 4 && klammer() && kb_lo - urs + start_beat_ >= bis_ + EPS; ++n) urs += bis_ - von_;
#endif
  for (int durchlauf = 0; durchlauf < 2; ++durchlauf) {
    const double p_a = kb_lo - urs + start_beat_;
    const double p_b = kb_hi - urs + start_beat_;
    const bool klammer = this->klammer() && p_a < bis_ + EPS;
    const double p_ende = klammer ? std::min(p_b + EPS, bis_) : p_b + EPS;
    for (int i = erste_note_ab(sp, p_a - EPS); i < sp.n_noten && sp.noten[i].beat < p_ende; ++i) {
      const ArrNote& n = sp.noten[i];
      const int64_t an = std::llround(k.sample_at(n.beat + urs - start_beat_));
      if (an < von || an >= bis || an < start_s_ || (stopp_s_ >= 0 && an >= stopp_s_)) continue;
      int64_t aus = std::llround(k.sample_at(n.beat + n.laenge + urs - start_beat_));
      if (klammer && n.beat + n.laenge > bis_) aus = std::llround(k.sample_at(bis_ + urs - start_beat_));   // Naht
      if (stopp_s_ >= 0) aus = std::min(aus, stopp_s_);
      aus = std::max(aus, an);
      if (note_stumm(spur, se, an)) {   // the track is muted at this sample: no voice is started, the sink falls silent and rests (the off of an earlier note still comes)
        ++noten_stumm_;
        continue;
      }
      if (n_offen_ >= ARR_OFFEN) {   // Liste voll: lieber keine Note als eine hängende
        ++noten_verloren_;
        continue;
      }
      offen_[n_offen_++] = Offen{n.id, spur, n.ton, an, aus, n.beat + n.laenge, se};
      // sampler A2 (E8.3): a latched device knob takes the lane value of THIS note's beat, not the value of the block's last sample: the sink puts it at the note's sample, before the note.
      // Only tracks with a mask pay for it (ctz over the set bits, one stateless lane read each); a track without a latched knob takes no step here.
      for (uint64_t m = sp.bk_rastet; m != 0 && sp.n_auto > 0; m &= m - 1) {
        const int param = __builtin_ctzll(m);
        float wert = 0.0f;
        bool relativ = false;
        if (arr_geraet_lane_wert(sp, param, n.beat, &wert, &relativ)) se->note_regler(spur, an, param, wert, relativ);
      }
      se->note(spur, an, n.ton, n.vel, true);
    }
    if (!klammer || p_b <= bis_) break;
    kb_lo = bis_ + urs - start_beat_;   // der nächste Durchlauf beginnt auf der Naht mit p = von
    urs += bis_ - von_;
  }
}

// Tracker task 16: the bend and pegel events of a bk track in the window [von, bis), on the very structure of noten_fenster (the loop seam included), each at the sample of its beat with
// its glide length in samples from the beat map. Besides the events of the list the window carries the STATE of the list at the two places where the play position jumps: the transport
// entry (start_s_: the instance was just reset to neutral, the value in force at start_beat_ goes in, a running glide as a jump to its current value plus a glide to its target) and the
// loop seam (the new pass begins at von_: the value in force there, the same way, always sent because the instance holds what the end of the old pass left). Neutral at the entry is
// not sent (the reset did it). A track without events returns at once.
void Arrangement::fx_fenster(const Karte& k, int spur, ArrSenke* se, int64_t von, int64_t bis) {
  const ArrSpur& sp = snap_->spur[spur];
  if (sp.n_bend == 0 && sp.n_pegel == 0) return;
  const struct Liste {
    const ArrFxPunkt* e;
    int n;
    bool pegel;
    float neutral;
  } listen[2] = {{sp.bend, sp.n_bend, false, 0.0f}, {sp.pegel, sp.n_pegel, true, 1.0f}};
  auto frei = [&](int64_t an) { return an >= von && an < bis && an >= start_s_ && !(stopp_s_ >= 0 && an >= stopp_s_); };
  // the state of both lists at project beat p, as events at sample `ziel` of the pass with origin `urs`; immer: also when the value is neutral and nothing glides
  auto stand = [&](double p, int64_t ziel, double urs, bool immer) {
    for (const Liste& li : listen) {
      if (li.n == 0) continue;
      const FxStand st = fx_stand(li.e, li.n, p, li.neutral);
      int64_t gl = 0;
      if (st.rest > 0.0) gl = std::llround(k.sample_at(p + st.rest + urs - start_beat_)) - ziel;
      if (immer || st.wert != li.neutral || gl > 0) se->fx(spur, ziel, li.pegel, gl > 0 ? st.wert : st.ziel, 0);
      if (gl > 0) se->fx(spur, ziel, li.pegel, st.ziel, gl);
    }
  };
  if (start_s_ >= von && start_s_ < bis && frei(start_s_)) stand(start_beat_, start_s_, ursprung_, false);
  double kb_lo = k.beat_at(static_cast<double>(von) - 0.5);
  const double kb_hi = k.beat_at(static_cast<double>(bis) - 0.5);
  double urs = ursprung_;
  for (int n = 0; n < 4 && klammer() && kb_lo - urs + start_beat_ >= bis_ + EPS; ++n) urs += bis_ - von_;
  for (int durchlauf = 0; durchlauf < 2; ++durchlauf) {
    const double p_a = kb_lo - urs + start_beat_;
    const double p_b = kb_hi - urs + start_beat_;
    const bool klammer = this->klammer() && p_a < bis_ + EPS;
    const double p_ende = klammer ? std::min(p_b + EPS, bis_) : p_b + EPS;
    if (durchlauf == 1) {   // the seam: the new pass begins at von_ on the sample of the seam
      const int64_t naht = std::llround(k.sample_at(kb_lo));
      if (frei(naht)) stand(von_, naht, urs, true);
    }
    for (const Liste& li : listen)
      for (int i = erster_fx_ab(li.e, li.n, p_a - EPS); i < li.n && li.e[i].beat < p_ende; ++i) {
        const ArrFxPunkt& x = li.e[i];
        const int64_t an = std::llround(k.sample_at(x.beat + urs - start_beat_));
        if (!frei(an)) continue;
        const int64_t gl = x.gleit > 0.0f ? std::llround(k.sample_at(x.beat + static_cast<double>(x.gleit) + urs - start_beat_)) - an : 0;
        se->fx(spur, an, li.pegel, x.wert, gl > 0 ? gl : 0);
      }
    if (!klammer || p_b <= bis_) break;
    kb_lo = bis_ + urs - start_beat_;
    urs += bis_ - von_;
  }
}

// Variant a of 2026-11-21: true = the note-on at sample `an` of track `spur` is not sent because the track's own mute is on at that very sample. The core hands the mute
// course of this block to the Arrangement before block() (Kern audio(): verlauf, then block), so a scene that unmutes on the bar keeps the note on that bar. Only where
// that course is the whole truth: an internal sink without look-ahead (vorhalt 0: the note lies in this block), no mute lane (auto_block replaces the course after
// this point), no track PFL (the cue hears the track in front of the mute), no freeze, tap or export run (they render the track whatever the mixer says).
bool Arrangement::note_stumm(int spur, const ArrSenke* se, int64_t an) const {
#ifdef CYPHERDJ_MUTATION_ARR_STUMM_NOTEN_GEHEN
  (void)spur; (void)se; (void)an;
  return false;   // error case: a muted pattern gets every note and computes at full cost (test_arr_stumm_ruhe must go red)
#endif
  if (!stumm_ruhe_ || !snap_ || sonderlauf() || !se || se->vorhalt() != 0) return false;
  if (spur < 0 || spur >= ARR_SPUREN || snap_->spur[spur].art != ArrArt::intern || auto_lane_da(spur, 2)) return false;
  const Wert& cu = w_[spur][ARR_F_CUE];
  if (cu.vl || cu.w >= 0.5f) return false;
  const int64_t t = an - noten_s0_;
  if (t < 0 || t >= noten_m_) return false;
  const Wert& mu = w_[spur][2];
  return (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
}

void Arrangement::noten_block(const Karte& k, int64_t s0, int m) {
  noten_s0_ = s0;
  noten_m_ = m;
  offen_aus_bis(s0 + m);   // fällige Offs zuerst, vor den Ons desselben Samples
  if (!snap_ || (status_ != ArrStatus::wartet && status_ != ArrStatus::spielt)) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    ArrSenke* se = senke_fuer(snap_, i);
    if (!se) continue;
#ifdef CYPHERDJ_MUTATION_ARR_OHNE_VORAUSBLICK
    const int64_t v = 0;   // Fehlerfall: Noten erst im Block ihres Samples, der Wirt-Rundweg fehlt
#else
    const int64_t v = se->vorhalt();
#endif
    // Grenze (Review K2b F6): steigt das Quantum, wächst der Vorhalt der Wirt-Senke (2n) und von springt über
    // gesendet_bis hinaus. Note-Ein im übersprungenen Fenster [gesendet_bis, s0 + v) fallen weg (Probe 256 -> 512: 598
    // statt 600 gesendet); node.lock-quantum verhindert den Fall im Betrieb. Sinkt das Quantum, geht nichts verloren, die
    // schon gesendeten Noten kommen um die Differenz der Vorhalte zu früh (Probe 512 -> 256: höchstens 512 Samples).
    const int64_t von = std::max(s0 + v, gesendet_bis_[i]), bis = s0 + m + v;
    if (bis > von) {
      noten_fenster(k, i, se, von, bis);
      fx_fenster(k, i, se, von, bis);   // tracker task 16: the bend and pegel events of the same window
    }
    gesendet_bis_[i] = std::max(gesendet_bis_[i], bis);
  }
  offen_aus_bis(s0 + m);   // Offs kurzer Noten, die in diesem Block an- und ausgehen
}

// 1.8 T7b: live notes (header). The On goes to the sink of the track now, the entry keeps that sink for the Off.
void Arrangement::live_note(int spur0, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur0 < 0 || spur0 >= ARR_SPUREN) return;
  ton &= 0x7f;
  ArrSenke*& h = live_[spur0][ton];
  if (an) {
#ifdef CYPHERDJ_MUTATION_LIVE_NOTE_VERWORFEN
    (void)ziel;
    (void)vel;
    return;   // error case: the live note is never sent, the key is silent
#endif
    ArrSenke* se = senke_fuer(snap_, spur0);
    if (!se) return;   // an empty track or none loaded: nothing to play, nothing to hold
    if (h) {   // retrigger: the old note ends at the new onset
      h->note(spur0, ziel, ton, 0, false);
      h = nullptr;
      --n_live_;
    }
    h = se;
    live_an_[spur0][ton] = ziel;
    ++n_live_;
    se->note(spur0, ziel, ton, vel == 0 ? 1 : vel, true);
    return;
  }
  if (!h) return;   // an off with no on (a key held before the arm, a track without a sink)
#ifdef CYPHERDJ_MUTATION_LIVE_AUS_NEUE_SENKE
  ArrSenke* ziel_senke = senke_fuer(snap_, spur0);   // error case: the off goes to the sink of the track now, not to the one that got the on
  if (ziel_senke) ziel_senke->note(spur0, ziel, ton, 0, false);
#else
  h->note(spur0, ziel, ton, 0, false);
#endif
  h = nullptr;
  --n_live_;
}

// kraken patch field: the pin goes to the sink of the track now, stamped with the generation of the snapshot it was sent against (header).
void Arrangement::live_stift(int spur0, int satz, int zeile, int spalte, float wert) noexcept {
  if (spur0 < 0 || spur0 >= ARR_SPUREN) return;
  ArrSenke* se = senke_fuer(snap_, spur0);
  if (!se) return;
  se->stift(spur0, satz, zeile, spalte, wert, snap_gen_);
}

void Arrangement::live_spur_aus(int spur0, int64_t ziel) noexcept {
  if (spur0 < 0 || spur0 >= ARR_SPUREN) return;
#ifdef CYPHERDJ_MUTATION_LIVE_ALLE_AUS_LEER
  (void)ziel;
  return;   // error case: nothing is closed, the keys stay held in the table and on the sink (a hanging note)
#endif
  for (int ton = 0; ton < 128; ++ton) {
    ArrSenke*& h = live_[spur0][ton];
    if (!h) continue;
    h->note(spur0, ziel, static_cast<uint8_t>(ton), 0, false);
    h = nullptr;
    --n_live_;
  }
}

void Arrangement::live_alle_aus(int64_t ziel) noexcept {
  if (n_live_ == 0) return;
  for (int i = 0; i < ARR_SPUREN; ++i) live_spur_aus(i, ziel);
}

// A swap: a held key whose track gets another sink (or none) ends on the sink that got the On, at the same sample and by the same rule as noten_tauschen (a track
// that stays on its sink keeps its keys: a rack changing its members ends what a member held by its own record, ArrRackSenke::abgaenge).
void Arrangement::live_tauschen(const ArrSnapshot* neu, int64_t s) {
  if (n_live_ == 0) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    ArrSenke* nach = senke_fuer(neu, i);
    for (int ton = 0; ton < 128; ++ton) {
      ArrSenke*& h = live_[i][ton];
      if (!h || h == nach) continue;
#ifdef CYPHERDJ_MUTATION_LIVE_AUS_NEUE_SENKE
      if (nach) nach->note(i, s + nach->vorhalt(), static_cast<uint8_t>(ton), 0, false);   // error case: the off goes to the new sink, the old one keeps the note
#else
      h->note(i, s + h->vorhalt(), static_cast<uint8_t>(ton), 0, false);
#endif
      h = nullptr;
      --n_live_;
    }
  }
}

// 1.8 T7b review fix: the transport stop (also a planned one, carried out at its own sample inside a block) closes the live keys that began at or before s. A key whose On is
// stamped AFTER s was queued by midi_ein_stempeln before Arrangement::block ran: closing it here would put its Off before its On in the sink (a hanging note, and the player's
// own Off would then be dropped for want of an entry). It stays held; the all-off of the sinks at s precedes its On, so it sounds from its onset on and the player's Off ends it.
void Arrangement::live_aus_bis(int64_t s) noexcept {
  if (n_live_ == 0) return;
#ifdef CYPHERDJ_MUTATION_LIVE_ALLE_AUS_LEER
  return;   // error case: nothing is closed, the keys stay held in the table and on the sink (a hanging note)
#endif
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int ton = 0; ton < 128; ++ton) {
      ArrSenke*& h = live_[i][ton];
      if (!h || live_an_[i][ton] > s) continue;
      h->note(i, s, static_cast<uint8_t>(ton), 0, false);
      h = nullptr;
      --n_live_;
    }
}

void Arrangement::alle_noten_aus(int64_t s) {
  live_aus_bis(s);   // 1.8 T7b: transport stop and every other all-off close the held live keys first (their offs precede the all-off of the sinks)
  for (int i = 0; i < n_offen_; ++i) {
    const Offen& o = offen_[i];
    o.senke->note(o.spur, std::max(o.an, std::min(o.aus, s)), o.ton, 0, false);
  }
  n_offen_ = 0;
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (ArrSenke* se = senke_fuer(snap_, i)) se->alle_aus(i, s);
}

void Arrangement::noten_tauschen(const ArrSnapshot* neu, int64_t s) {
  int w = 0;
  for (int i = 0; i < n_offen_; ++i) {
    const Offen& o = offen_[i];
    const ArrNote* n2 = neu ? finde_note(neu->spur[o.spur], o.id) : nullptr;
    const bool bleibt = n2 && senke_fuer(neu, o.spur) == o.senke && n2->ton == o.ton &&
                        std::fabs(n2->beat + n2->laenge - o.ende_beat) < EPS;
#ifdef CYPHERDJ_MUTATION_ARR_TAUSCH_OHNE_NOTE_AUS
    if (!bleibt) continue;   // Fehlerfall: die Note fällt aus der Liste, ihr Off geht nie hinaus (hängender Ton)
#endif
    if (bleibt) {
      offen_[w++] = o;
      continue;
    }
    o.senke->note(o.spur, std::max(o.an, s + o.senke->vorhalt()), o.ton, 0, false);
  }
  n_offen_ = w;
}

}  // namespace cdj
