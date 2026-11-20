// Loop deck K2: the launcher of the arrangement. Cells (loops, one-shots) of a loop deck track play on their own voice pool, on the core beat,
// whether the transport runs or not. Callback thread: no allocation, no lock, no system call. A voice owns copies of what it plays; it keeps no
// pointer into the snapshot except the audio pointer (K4 lets that outlive the snapshot).
// K3: a loop cell with the warp works (modus 2, werk present) plays as keylock: one werk voice per loop pass (LPass), set up ARR_WARP_VORLAUF ahead,
// butt-joined at the pass end (a short cross-fade over SEAM samples hides the phase jump of two stretcher runs; the werk reads a loop pass around, WarpAnsatz::kreis);
// a pending start is prepared ahead (LSpur::vorab). A pass without a pass slot or werk slot plays as re-pitch (LStimme::fb_*, counted), never silence.
// Commands only record a pending launch; it takes effect in launch_block(), where the tempo map is at hand (T = llround(sample_at(ab_beat))).
#include <atomic>
#include <cmath>
#include <cstring>

#include "cypherdj/arrangement.h"
#include "cypherdj/warp_mapping.h"
#include "cypherdj/warp_factory.h"

namespace cdj {

namespace {
// K4: the audio hold. A pending start (its wartend_z) and every active voice (also a prepared one) holds its audio once: ArrAudio::halter, which the
// loader thread reads before it frees a cache entry (ArrAudioCache::gib). Wait-free, no cache access. When a hold passes from one owner to the next the
// new one is taken before the old one is let go, so the counter never dips to 0 in between.
void halt_nehmen(const ArrAudio* a) {
  if (a) std::atomic_ref<int32_t>(const_cast<ArrAudio*>(a)->halter).fetch_add(1, std::memory_order_seq_cst);
}
void halt_loesen(const ArrAudio* a) {
  if (a) std::atomic_ref<int32_t>(const_cast<ArrAudio*>(a)->halter).fetch_sub(1, std::memory_order_seq_cst);
}
// Length of the cross-fade at the seam of two consecutive keylock passes. Each pass is its own stretcher run, so its phase at the seam is not the one the pass before
// ended on (a stretched sine ends a pass at a different phase than the source has at the loop point): a hard butt join clicks. The next pass starts this long before
// the seam (it reads the loop around: WarpAnsatz::kreis) and the pass before fades out over its last SEAM samples.
constexpr int64_t SEAM = 96;

// Loop phase in beats inside the cell: x may sit a hair below a whole cell length from rounding (beat_at of a whole sample); that is the wrap.
double phase(double x, double beats) {
  double p = std::fmod(x, beats);
  if (p < 0.0) p += beats;
  if (beats - p < 1e-9) p = 0.0;
  return p;
}

// Catmull-Rom read of a loop cell: the neighbour frames wrap around the cell (a read at the seam sees the other end of the loop, not silence)
void lies_kreis(const float* d, int64_t n, double fr, float& l, float& r) {
  const int64_t i1 = static_cast<int64_t>(std::floor(fr));
  const float x = static_cast<float>(fr - static_cast<double>(i1));
  float a[4][2];
  for (int j = 0; j < 4; ++j) {
    int64_t i = (i1 - 1 + j) % n;
    if (i < 0) i += n;
    a[j][0] = d[2 * i];
    a[j][1] = d[2 * i + 1];
  }
  l = warp_catmull(a[0][0], a[1][0], a[2][0], a[3][0], x);
  r = warp_catmull(a[0][1], a[1][1], a[2][1], a[3][1], x);
}
}  // namespace

void Arrangement::launch_melden(int64_t id, int status, int64_t sample, double beat) {
  if (lm_n_ >= LAUNCH_MELDUNGEN) {   // full: the oldest receipt goes (counted, K5: launch_stand shows it)
    ++lm_verloren_;
    std::memmove(lm_, lm_ + 1, sizeof(LaunchMeldung) * (LAUNCH_MELDUNGEN - 1));
    --lm_n_;
  }
  lm_[lm_n_++] = LaunchMeldung{id, status, sample, beat, LaunchGrund::ok};
}

// ab_beat must be a plausible core beat: finite and within 1e9 beats of zero (about 130 000 hours at 128 BPM); beyond that llround of its sample overflows
static bool launch_beat_ok(double b) { return std::isfinite(b) && std::fabs(b) <= 1e9; }

// The deck track with this id in the current snapshot (it has cells), -1: none
static int launch_spur_suchen(const ArrSnapshot* snap, uint64_t kennung) {
  if (!snap || kennung == 0) return -1;
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (snap->spur[i].kennung == kennung && snap->spur[i].n_zellen > 0) return i;
  return -1;
}

LaunchGrund Arrangement::launch_start(uint64_t kennung, int zelle, double ab_beat, double versatz_beats, int64_t id, bool von_cypher) {
  if (!snap_) return LaunchGrund::nicht_geladen;
  const int idx = launch_spur_suchen(snap_, kennung);
  if (idx < 0) return LaunchGrund::spur_bereich;
  if (zelle < 1 || zelle > ARR_ZELLEN || !launch_beat_ok(ab_beat) || !std::isfinite(versatz_beats) || versatz_beats < 0.0)
    return LaunchGrund::ausserhalb_bereich;
  const ArrZelle& z = snap_->spur[idx].zellen[zelle - 1];
  if (z.art == ArrZellArt::leer || !z.audio) return LaunchGrund::zelle_leer;
  if (z.art == ArrZellArt::einmal ? versatz_beats != 0.0 : versatz_beats >= z.beats) return LaunchGrund::ausserhalb_bereich;
  LSpur* t = nullptr;
  for (LSpur& x : ls_)
    if (x.belegt && x.kennung == kennung) t = &x;
  if (!t)
    for (LSpur& x : ls_)
      if (!x.belegt) { t = &x; break; }
  if (!t) return LaunchGrund::spur_bereich;   // no room for another deck track
  if (!t->belegt) {
    t->belegt = true;
    t->kennung = kennung;
    std::memcpy(t->text, snap_->spur[idx].kennung_text, sizeof t->text);
  }
  launch_vorab_frei(*t);
  if (t->wartend >= 0) launch_melden(t->wartend_id, 7, -1, t->wartend_ab);   // replaced: abbruch
  halt_nehmen(z.audio);   // K4: from the acceptance on (the swap may come long before ab_beat); the replaced start's hold goes after
  if (t->wartend >= 1) halt_loesen(t->wartend_z.audio);
  t->wartend = zelle;
  t->wartend_ab = ab_beat;
  t->wartend_versatz = versatz_beats;
  t->wartend_id = id;
  t->wartend_cypher = von_cypher;
  t->wartend_spur = idx;
  t->wartend_z = z;
  ++launch_aend_;
  return LaunchGrund::ok;
}

LaunchGrund Arrangement::launch_stopp(uint64_t kennung, double ab_beat, int64_t id, bool von_cypher) {
  if (!snap_) return LaunchGrund::nicht_geladen;
  const int idx = launch_spur_suchen(snap_, kennung);
  LSpur* t = nullptr;
  for (LSpur& x : ls_)
    if (x.belegt && x.kennung == kennung) t = &x;
  bool stimme = false;
  if (t)
    for (const LStimme& v : t->v) stimme = stimme || v.aktiv;
  if (idx < 0 && !stimme) return LaunchGrund::spur_bereich;
  if (!launch_beat_ok(ab_beat)) return LaunchGrund::ausserhalb_bereich;
  if (!t) {
    for (LSpur& x : ls_)
      if (!x.belegt) { t = &x; break; }
    if (!t) return LaunchGrund::spur_bereich;
    t->belegt = true;
    t->kennung = kennung;
    std::memcpy(t->text, snap_->spur[idx].kennung_text, sizeof t->text);
  }
  launch_vorab_frei(*t);
  if (t->wartend >= 0) launch_melden(t->wartend_id, 7, -1, t->wartend_ab);
  if (t->wartend >= 1) halt_loesen(t->wartend_z.audio);   // K4: the replaced start lets go
  t->wartend = 0;
  t->wartend_ab = ab_beat;
  t->wartend_versatz = 0.0;
  t->wartend_id = id;
  t->wartend_cypher = von_cypher;
  t->wartend_spur = idx < 0 ? 0 : idx;
  ++launch_aend_;
  return LaunchGrund::ok;
}

// The pending launch of t takes effect in the block starting at s0 (its sample T lies before the end of the block).
void Arrangement::launch_anwenden(LSpur& t, const Karte& k, int64_t s0) {
  if (!snap_ && t.wartend >= 1) {   // K4: unloaded since the acceptance: the start is dropped (abbruch), it never plays; the playing voices own their copies and go on
    launch_vorab_frei(t);
    halt_loesen(t.wartend_z.audio);
    launch_melden(t.wartend_id, 7, -1, t.wartend_ab);
    t.wartend = -1;
    ++launch_aend_;
    return;
  }
  const int64_t T = static_cast<int64_t>(std::llround(k.sample_at(t.wartend_ab)));
  const bool spaet = T < s0;
  const int64_t teff = spaet ? s0 : T;
  const bool war_aktuell = [&] {
    for (const LStimme& v : t.v)
      if (v.aktiv && v.aktuell) return true;
    return false;
  }();
  for (LStimme& v : t.v)   // the playing voice fades out from the effect sample
    if (v.aktiv && v.aktuell) {
      v.aktuell = false;
      if (v.aus_ab < 0) v.aus_ab = teff;
      if (v.kl) launch_kl_aus(v, teff);
    }
  if (t.wartend >= 1) {
    LStimme* n = nullptr;
    const bool vorab = t.vorab >= 0;
    if (vorab) {
      n = &t.v[t.vorab];   // K3: prepared by launch_vorab, its passes stay
    } else {
      for (LStimme& v : t.v)
        if (!v.aktiv) { n = &v; break; }
      if (!n) {   // pool full (more fading tails than expected): the tail that ends first is taken over
        n = &t.v[0];
        for (LStimme& v : t.v)
          if (v.aus_ab >= 0 && (n->aus_ab < 0 || v.aus_ab < n->aus_ab)) n = &v;
        launch_frei(*n);
        halt_loesen(n->z.audio);
      }
      *n = LStimme{};
      halt_nehmen(t.wartend_z.audio);   // the voice's own hold (the pending start's goes below)
    }
    n->aktiv = true;
    n->aktuell = true;
    n->vorab = false;
    n->spur = t.wartend_spur;
    n->z = t.wartend_z;
    n->versatz = t.wartend_versatz;
    n->t0 = T;
    n->anker = k.beat_at(static_cast<double>(T));
    n->start = teff;
    n->ein_n = (war_aktuell || spaet) ? ARR_NAHT : 0;
    if (vorab) {
      for (int j : n->ps)
        if (j >= 0 && lp_[j].nr == 0) {
          lp_[j].s.ramp_ein_ab = n->ein_n > 0 ? teff : -1;
          lp_[j].s.ramp_n = ARR_NAHT;
        }
      if (n->fb_ende > n->fb_von && n->fb_nr0 == 0) n->fb_ein_ab = n->ein_n > 0 ? teff : -1;
      t.vorab = -1;
    }
    t.zelle = t.wartend;
    t.ab_beat = t.wartend_ab;
    t.versatz = t.wartend_versatz;
    // K5: a start that was accepted before a swap plays the audio of the acceptance; it is orphaned when that is not the cell's audio now
    t.verwaist = snap_ && t.wartend_spur >= 0 && t.wartend_spur < ARR_SPUREN && snap_->spur[t.wartend_spur].zellen[t.wartend - 1].audio != n->z.audio;
    halt_loesen(t.wartend_z.audio);   // the pending start is over, the voice holds on
  } else {
    t.zelle = 0;
    t.verwaist = false;
  }
  launch_melden(t.wartend_id, spaet ? 5 : 3, teff, spaet ? k.beat_at(static_cast<double>(s0)) : t.wartend_ab);
  t.wartend = -1;
  ++launch_aend_;
}

void Arrangement::launch_spielen(LStimme& v, const Karte& k, int64_t s0, int m, int64_t lo, int64_t hi) {
  const int64_t e = s0 + m;
  const bool einmal = v.z.art == ArrZellArt::einmal;
  int64_t ende = einmal ? v.t0 + v.z.frames : INT64_MAX;
  if (v.aus_ab >= 0 && v.aus_ab + ARR_NAHT < ende) ende = v.aus_ab + ARR_NAHT;
  int64_t von = v.start > s0 ? v.start : s0;
  if (lo > von) von = lo;
  int64_t bis = ende < e ? ende : e;
  if (hi < bis) bis = hi;
  const ArrAudio* au = v.z.audio;
  float* bl = bus_l_[v.spur];
  float* br = bus_r_[v.spur];
  for (int64_t t = von; t < bis; ++t) {
    double fr;
    if (einmal) {
      fr = static_cast<double>(t - v.t0);
    } else {
      const double p = phase(k.beat_at(static_cast<double>(t)) - v.anker + v.versatz, v.z.beats);
      fr = p * static_cast<double>(v.z.frames) / v.z.beats;
    }
    float l, r;
    if (einmal) warp_lies(au->daten, v.z.frames, fr, l, r);   // one-shot: outside the data is silence
    else lies_kreis(au->daten, v.z.frames, fr, l, r);
    float g = v.z.gain;
    if (v.ein_n > 0 && t - v.start < v.ein_n) g *= static_cast<float>(t - v.start) / static_cast<float>(v.ein_n);
    if (v.aus_ab >= 0 && t >= v.aus_ab) g *= 1.0f - static_cast<float>(t - v.aus_ab) / static_cast<float>(ARR_NAHT);
    bl[t - s0] += l * g;
    br[t - s0] += r * g;
  }
  if (!v.kl && ende <= e) {
    v.aktiv = false;
    halt_loesen(v.z.audio);   // K4
  }
}

// ---- K3: keylock voices

void Arrangement::launch_pass_frei(LStimme& v, int j) {
  const int pi = v.ps[j];
  if (pi < 0) return;
  LPass& p = lp_[pi];
  if (p.s.aktiv && p.s.werk >= 0 && werk_) werk_->gib(p.s.werk);
  p.s.aktiv = false;
  p.s.werk = -1;
  // The werk thread may still copy this pass's markers (p.c, p.w) while an order of its werk slot is open: the slot stays taken until launch_ernten sees the
  // order closed (otherwise the next launch_pass_vor would rewrite p.c under the thread's hands)
  p.warte = p.platz >= 0 && werk_ && werk_->offen(p.platz);
  if (!p.warte) p.belegt = false;
  v.ps[j] = -1;
}

void Arrangement::launch_ernten() {
  for (LPass& p : lp_)
    if (p.belegt && p.warte && !(werk_ && werk_->offen(p.platz))) {
      p.warte = false;
      p.belegt = false;
    }
}

void Arrangement::launch_frei(LStimme& v) {
  for (int j = 0; j < ARR_LAUNCH_PAESSE_JE; ++j) launch_pass_frei(v, j);
  v.fb_von = v.fb_ende = v.fb_ein_ab = v.fb_aus_ab = -1;
}

void Arrangement::launch_vorab_frei(LSpur& t) {
  if (t.vorab < 0) return;
  LStimme& v = t.v[t.vorab];
  launch_frei(v);
  v.aktiv = false;
  v.vorab = false;
  t.vorab = -1;
  halt_loesen(v.z.audio);   // K4
}

// The voice fades out from ab: every pass gets the fade (the re-pitch range reads LStimme::aus_ab).
void Arrangement::launch_kl_aus(LStimme& v, int64_t ab) {
  for (int pi : v.ps)
    if (pi >= 0 && (lp_[pi].s.ab_aus < 0 || lp_[pi].s.ab_aus > ab)) lp_[pi].s.ab_aus = ab;
}

int64_t Arrangement::launch_pass_von(const LStimme& v, const Karte& k, int64_t nr) const {
  return static_cast<int64_t>(std::llround(k.sample_at(v.q0 + static_cast<double>(nr) * v.z.beats)));
}

// Sets up pass nr of v, starting at sample von (before s0: the effect is now). The werk delivers from s_h = max(von, s0 + ARR_WARP_FRIST); a pass that sounds
// earlier than that plays from the cell as re-pitch until the ring fills (werk_stimme_spielen, counted in warp_spaet). zwingend: the pass sounds in this block
// already, so without a pass slot or werk slot it plays as re-pitch for good (launch_fb_pass, counted in warp_kein_platz); otherwise false: try again later.
bool Arrangement::launch_pass_vor(LStimme& v, const Karte& k, int64_t s0, int64_t nr, int64_t von, bool zwingend) {
  int j = -1;
  for (int i = 0; i < ARR_LAUNCH_PAESSE_JE && j < 0; ++i)
    if (v.ps[i] < 0) j = i;
  int pi = -1;
  for (int i = 0; i < ARR_LAUNCH_PAESSE && pi < 0; ++i)
    if (!lp_[i].belegt) pi = i;
  const int platz = (j >= 0 && pi >= 0 && werk_) ? werk_->belege() : -1;
  const double beats = v.z.beats;
  const double q = v.q0 + static_cast<double>(nr) * beats;
  const int64_t ende = launch_pass_von(v, k, nr + 1);   // the one formula of the pass edges: this end is the next pass's von, to the sample
  if (platz < 0) {
    if (!zwingend) return false;
    ++warp_kein_platz_;
    launch_fb_pass(v, s0, nr, von, ende);
    return true;
  }
  LPass& p = lp_[pi];
  p.belegt = true;
  p.warte = false;
  p.platz = platz;
  p.nr = nr;
  p.von = von;
  p.ende = ende;
  p.s = Stimme{};
  p.wb[0] = 0.0;
  p.wb[1] = beats;
  p.wf[0] = 0.0;
  p.wf[1] = static_cast<double>(v.z.frames);
  p.w = ArrWarp{};
  p.w.modus = ARR_WARP_COMPLEX;
  p.w.n = 2;
  p.w.beat = p.wb;
  p.w.frame = p.wf;
  p.c = ArrClip{};
  p.c.laenge_beats = beats;
  p.c.audio = v.z.audio;
  p.c.gain = v.z.gain;
  p.c.warp = &p.w;
  // Seam with the pass before (nr - 1, ends exactly at von): this pass starts SEAM early and fades in, that one fades out over its last SEAM samples. Too late for that
  // (the fade of the pass before would have started already): a hard join
  LPass* davor = nullptr;
  for (int i = 0; i < ARR_LAUNCH_PAESSE_JE; ++i)
    if (v.ps[i] >= 0 && lp_[v.ps[i]].nr == nr - 1 && lp_[v.ps[i]].s.aktiv && lp_[v.ps[i]].s.ab_aus < 0 && lp_[v.ps[i]].ende == von && von - SEAM >= s0) davor = &lp_[v.ps[i]];
  const int64_t lead = davor ? von - SEAM : von;   // first sounding sample
  p.von = lead;
  const int64_t ab = lead > s0 ? lead : s0;
  const int64_t s_h = lead >= s0 + ARR_WARP_FRIST ? lead : s0 + ARR_WARP_FRIST;
  Stimme& s = p.s;
  s.aktiv = true;
  s.spur = v.spur;
  s.clip = &p.c;
  s.clip_s0 = lead;   // the first sounding sample (werk_stimme_spielen: pos = t - clip_s0 must not be negative)
  s.ende = ende;
  s.ramp_ein_ab = -1;
  s.ab_aus = v.aus_ab;
  s.werk = platz;
  s.werk_ab = ab;
  s.gain = v.z.gain;
  s.gain_alt = v.z.gain;
  s.ramp_n = ARR_NAHT;
  s.beat_versatz = -q;
  if (davor) {
    davor->s.aus_n = SEAM;
    s.ramp_ein_ab = lead;
    s.ramp_n = SEAM;
  }
  if (v.fb_ende > v.fb_von && v.fb_ende == von && v.fb_aus_ab < 0) {   // the pass before was a re-pitch pass: it fades out as this one fades in
    const int64_t x = ab;
    v.fb_aus_ab = x;
    s.ramp_ein_ab = x;
  }
  WarpAnsatz a;
  a.clip = &p.c;
  a.s_h = s_h;
  a.s_ende = ende;
  a.beat_versatz = -q;
  a.kreis = true;   // a loop pass: the stretcher sees the other end of the loop at the seam, not silence
  if (!a.karte.setze(&k.segment(0), k.anzahl())) a.karte = k;
  werk_->ansetzen(platz, a);
  v.ps[j] = pi;
  v.nr_next = nr + 1;
  return true;
}

// Pass nr plays as re-pitch from the cell (lies_kreis) because there is no pass slot or werk slot: consecutive passes extend one range of the voice.
// A keylock pass before it (nr - 1, still to start its fade) fades out over ARR_NAHT up to von while the range fades in from von - ARR_NAHT (no gap, no hard join);
// a late pass has no time for that and joins hard.
void Arrangement::launch_fb_pass(LStimme& v, int64_t s0, int64_t nr, int64_t von, int64_t ende) {
  if (v.fb_ende > v.fb_von && v.fb_ende == von) {
    v.fb_ende = ende;
    v.fb_nr1 = nr;
  } else {
    int64_t ab = von, ein = -1;
    for (int i = 0; i < ARR_LAUNCH_PAESSE_JE; ++i) {
      if (v.ps[i] < 0) continue;
      LPass& q = lp_[v.ps[i]];
      if (q.nr == nr - 1 && q.s.aktiv && q.s.ab_aus < 0 && von - ARR_NAHT >= s0) {
        q.s.ab_aus = von - ARR_NAHT;
        ab = von - ARR_NAHT;
        ein = ab;
        break;
      }
    }
    v.fb_von = ab;
    v.fb_ende = ende;
    v.fb_ein_ab = ein;
    v.fb_aus_ab = -1;
    v.fb_nr0 = v.fb_nr1 = nr;
  }
  v.nr_next = nr + 1;
}

void Arrangement::launch_fb_spielen(LStimme& v, const Karte& k, int64_t s0, int m) {
  const int64_t e = s0 + m;
  int64_t ende = v.fb_aus_ab >= 0 ? v.fb_aus_ab + ARR_NAHT : v.fb_ende;
  if (v.aus_ab >= 0 && v.aus_ab + ARR_NAHT < ende) ende = v.aus_ab + ARR_NAHT;
  const int64_t von = v.fb_von > s0 ? v.fb_von : s0;
  const int64_t bis = ende < e ? ende : e;
  const ArrAudio* au = v.z.audio;
  float* bl = bus_l_[v.spur];
  float* br = bus_r_[v.spur];
  for (int64_t t = von; t < bis; ++t) {
    const double p = phase(k.beat_at(static_cast<double>(t)) - v.anker + v.versatz, v.z.beats);
    float l, r;
    lies_kreis(au->daten, v.z.frames, p * static_cast<double>(v.z.frames) / v.z.beats, l, r);
    float g = v.z.gain;
    if (v.fb_ein_ab >= 0 && t >= v.fb_ein_ab && t - v.fb_ein_ab < ARR_NAHT) g *= static_cast<float>(t - v.fb_ein_ab) / static_cast<float>(ARR_NAHT);
    if (v.fb_aus_ab >= 0 && t >= v.fb_aus_ab) g *= 1.0f - static_cast<float>(t - v.fb_aus_ab) / static_cast<float>(ARR_NAHT);
    if (v.aus_ab >= 0 && t >= v.aus_ab) g *= 1.0f - static_cast<float>(t - v.aus_ab) / static_cast<float>(ARR_NAHT);
    bl[t - s0] += l * g;
    br[t - s0] += r * g;
  }
  if (ende <= e) v.fb_von = v.fb_ende = v.fb_ein_ab = v.fb_aus_ab = -1;   // played out
}

// A pending start of a keylock cell: the voice is set up ahead (its first pass in the werk) once its sample lies within ARR_WARP_VORLAUF of the block end.
void Arrangement::launch_vorab(LSpur& t, const Karte& k, int64_t s0, int m, bool karte_neu) {
  if (t.wartend < 1 || !launch_kl_zelle(t.wartend_z)) return;
  if (karte_neu && t.vorab >= 0) {   // the prepared pass carries the old map: set it up again
    launch_frei(t.v[t.vorab]);
    t.v[t.vorab].nr_next = 0;
  }
  const int64_t T = static_cast<int64_t>(std::llround(k.sample_at(t.wartend_ab)));
  if (T >= s0 + m + ARR_WARP_VORLAUF) return;
  if (t.vorab < 0) {
    int idx = -1;
    for (int i = 0; i < ARR_LAUNCH_STIMMEN && idx < 0; ++i)
      if (!t.v[i].aktiv) idx = i;
    if (idx < 0) return;   // no free voice: the start takes the re-pitch path in launch_anwenden
    t.v[idx] = LStimme{};
    t.vorab = idx;
    LStimme& n = t.v[idx];
    n.aktiv = true;
    n.vorab = true;
    n.kl = true;
    n.spur = t.wartend_spur;
    n.z = t.wartend_z;
    n.versatz = t.wartend_versatz;
    halt_nehmen(n.z.audio);   // K4: the prepared voice holds its own, the pending start keeps its hold
  }
  LStimme& n = t.v[t.vorab];
  if (n.nr_next == 0) {   // first pass (also after a tempo change freed it): the effect sample and the phase origin come from the map at hand
    n.t0 = T;
    n.anker = k.beat_at(static_cast<double>(T));
    n.q0 = n.anker - n.versatz;
    launch_pass_vor(n, k, s0, 0, T, T < s0 + m);
  }
}

void Arrangement::launch_kl_block(LStimme& v, const Karte& k, int64_t s0, int m, bool karte_neu) {
  const int64_t e = s0 + m;
  if (karte_neu && v.aus_ab < 0) {   // new tempo map: passes that have not started are set up again, the sounding ones get a successor with the new map
    if (v.fb_ende > v.fb_von) {   // re-pitch passes follow the map by themselves: a range not yet sounding is set up again, a sounding one only moves its end
      if (v.fb_von >= s0) {
        if (v.fb_nr0 < v.nr_next) v.nr_next = v.fb_nr0;
        v.fb_von = v.fb_ende = v.fb_ein_ab = v.fb_aus_ab = -1;
      } else {
        v.fb_ende = launch_pass_von(v, k, v.fb_nr1 + 1);
        if (v.fb_aus_ab >= s0) v.fb_aus_ab = -1;
      }
    }
    for (int j = 0; j < ARR_LAUNCH_PAESSE_JE; ++j) {
      if (v.ps[j] < 0) continue;
      const LPass& p = lp_[v.ps[j]];
      if (p.von >= s0) {
        if (p.nr < v.nr_next) v.nr_next = p.nr;
        launch_pass_frei(v, j);
      }
    }
    for (int j = 0; j < ARR_LAUNCH_PAESSE_JE; ++j) {
      if (v.ps[j] < 0) continue;
      LPass& p = lp_[v.ps[j]];
      if (p.s.ab_aus >= s0) p.s.ab_aus = -1;   // a fade for a successor that is gone again
      if (p.s.aus_n > 0 && p.ende - p.s.aus_n >= s0) p.s.aus_n = 0;   // the seam fade of a pass whose next pass was freed: the next pass sets it again
    }
    const int64_t nr_next = v.nr_next;
    for (int j = 0; j < ARR_LAUNCH_PAESSE_JE; ++j) {
      if (v.ps[j] < 0) continue;
      LPass& p = lp_[v.ps[j]];
      if (p.s.ab_aus >= 0) continue;
      if (p.ende <= s0 + ARR_WARP_FRIST + ARR_NAHT) continue;   // plays out with the old map
      const int64_t nr = p.nr;
      const int64_t von = s0 + ARR_WARP_FRIST;
      p.s.ab_aus = von;
      if (launch_pass_vor(v, k, s0, nr, von, false)) {   // not zwingend: without a slot the old pass plays on with the old map, no re-pitch successor
        for (int i = 0; i < ARR_LAUNCH_PAESSE_JE; ++i)   // the successor is the pass just set up (the last slot taken)
          if (v.ps[i] >= 0 && lp_[v.ps[i]].nr == nr && v.ps[i] != v.ps[j] && lp_[v.ps[i]].von == von) {
            lp_[v.ps[i]].s.ramp_ein_ab = von;
            lp_[v.ps[i]].s.ramp_n = ARR_NAHT;
          }
      } else {
        p.s.ab_aus = -1;   // no slot for a successor: the old pass keeps playing
      }
    }
    v.nr_next = nr_next;
  }
  if (v.aus_ab < 0)   // the next passes ahead of time (a voice that fades out starts none)
    for (;;) {
      const int64_t von = launch_pass_von(v, k, v.nr_next);
      if (von >= e + ARR_WARP_VORLAUF) break;
      if (!launch_pass_vor(v, k, s0, v.nr_next, von, von < e)) break;
    }
  for (int j = 0; j < ARR_LAUNCH_PAESSE_JE; ++j) {
    if (v.ps[j] < 0) continue;
    LPass& p = lp_[v.ps[j]];
    werk_stimme_spielen(k, p.s, s0, e, s0, -1);
    if (!p.s.aktiv) launch_pass_frei(v, j);
  }
  if (v.fb_ende > v.fb_von) launch_fb_spielen(v, k, s0, m);
  if (v.aus_ab >= 0 && e >= v.aus_ab + ARR_NAHT) {
    launch_frei(v);
    v.aktiv = false;
    halt_loesen(v.z.audio);   // K4
  }
}

void Arrangement::launch_block(const Karte& k, int64_t s0, int m) {
  const uint32_t gen = karte_gen_ ? *karte_gen_ : 0;
  const bool karte_neu = karte_gen_ && gen != launch_gen_;
  launch_gen_ = gen;
  launch_ernten();
  for (LSpur& t : ls_) {
    if (!t.belegt) continue;
    launch_vorab(t, k, s0, m, karte_neu);
    if (t.wartend >= 0 && static_cast<int64_t>(std::llround(k.sample_at(t.wartend_ab))) < s0 + m) launch_anwenden(t, k, s0);
    bool klingt = false;
    for (LStimme& v : t.v) {
      if (!v.aktiv || v.vorab) continue;
      if (v.kl) {
        launch_kl_block(v, k, s0, m, karte_neu);
      } else {
        launch_spielen(v, k, s0, m);
        if (!v.aktiv && v.aktuell) {   // a one-shot ran out: the track is silent again
          v.aktuell = false;
          t.zelle = 0;
          ++launch_aend_;
        }
      }
      klingt = klingt || v.aktiv;
    }
    if (!klingt && t.wartend < 0 && t.zelle == 0) {   // nothing left of it: the slot is free again
      t.belegt = false;
      t.kennung = 0;
    }
  }
}

// ---- K5: swap, /k/set/neu, unload, KI stop

// Drops the pending launch of t (receipt 7) with its holds and its prepared voice; the playing voices fade over ARR_NAHT from s, or end at s (sofort).
void Arrangement::launch_spur_beenden(LSpur& t, int64_t s, bool sofort) {
  if (t.wartend >= 0) {
    launch_melden(t.wartend_id, 7, -1, t.wartend_ab);
    if (t.wartend >= 1) halt_loesen(t.wartend_z.audio);
    t.wartend = -1;
  }
  launch_vorab_frei(t);   // the prepared voice never played: gone, its hold released
  for (LStimme& v : t.v) {
    if (!v.aktiv) continue;
    v.aktuell = false;
    if (sofort) {
      launch_frei(v);
      v.aktiv = false;
      halt_loesen(v.z.audio);
    } else {
      if (v.aus_ab < 0 || v.aus_ab > s) v.aus_ab = s;
      if (v.kl) launch_kl_aus(v, s);
    }
  }
  t.zelle = 0;
  t.verwaist = false;
  ++launch_aend_;
}

void Arrangement::launch_alles_aus(int64_t s, bool sofort) {
  for (LSpur& t : ls_)
    if (t.belegt) launch_spur_beenden(t, s, sofort);
}

void Arrangement::launch_ki_stopp() {
  for (LSpur& t : ls_) {
    if (!t.belegt || t.wartend < 0 || !t.wartend_cypher) continue;
    launch_vorab_frei(t);
    launch_melden(t.wartend_id, 7, -1, t.wartend_ab);
    if (t.wartend >= 1) halt_loesen(t.wartend_z.audio);
    t.wartend = -1;
    ++launch_aend_;
  }
}

void Arrangement::launch_tauschen(const ArrSnapshot* neu, int64_t s) {
  if (!neu) {   // unload: nothing of the launcher outlives the snapshot
    launch_alles_aus(s, true);
    return;
  }
  for (LSpur& t : ls_) {
    if (!t.belegt) continue;
    int idx = -1;
    for (int i = 0; i < ARR_SPUREN && t.kennung != 0; ++i)
      if (neu->spur[i].kennung == t.kennung && neu->spur[i].n_zellen > 0) idx = i;   // as launch_spur_suchen: a track without cells is gone
    if (idx < 0) {   // the track is gone: its voices end at s (a tail would sound in a bus index that belongs to something else now), a pending launch is dropped
      launch_spur_beenden(t, s, true);
      continue;
    }
    for (LStimme& v : t.v) {   // the order of the tracks may have changed: the voices write into the bus of the new index
      if (!v.aktiv) continue;
      v.spur = idx;
      for (int pi : v.ps)
        if (pi >= 0) lp_[pi].s.spur = idx;
    }
    if (t.wartend >= 0) {
      t.wartend_spur = idx;
      if (t.wartend >= 1) {
        const ArrZelle& z = neu->spur[idx].zellen[t.wartend - 1];
        if (z.art == ArrZellArt::leer || !z.audio) {   // S2: an empty cell stops its track: the pending start becomes a pending stop at the same ab_beat
          launch_vorab_frei(t);
          halt_loesen(t.wartend_z.audio);
          t.wartend = 0;
          t.wartend_versatz = 0.0;
        }
      }
    }
    if (t.zelle > 0) {   // orphaned: the playing voice is not the audio of its cell index in the new snapshot (replaced, cleared or moved)
      const ArrZelle& z = neu->spur[idx].zellen[t.zelle - 1];
      const LStimme* cur = nullptr;
      for (const LStimme& v : t.v)
        if (v.aktiv && v.aktuell) cur = &v;
      t.verwaist = cur && (z.art == ArrZellArt::leer || z.audio != cur->z.audio);
    } else {
      t.verwaist = false;
    }
    ++launch_aend_;
  }
}

int Arrangement::launch_stimmen() const {
  int n = 0;
  for (const LSpur& t : ls_)
    for (const LStimme& v : t.v) n += v.aktiv ? 1 : 0;
  return n;
}

void Arrangement::test_launch_paesse_sperren() noexcept {
  for (LPass& p : lp_)
    if (!p.belegt) p.belegt = true;
}

bool Arrangement::launch_ruhig() const {
  for (const LSpur& t : ls_) {
    if (t.belegt && t.wartend >= 0) return false;
    for (const LStimme& v : t.v)
      if (v.aktiv) return false;
  }
  return true;
}

int Arrangement::launch_meldungen(LaunchMeldung* aus, int max) {
  const int n = lm_n_ < max ? lm_n_ : max;
  for (int i = 0; i < n; ++i) aus[i] = lm_[i];
  std::memmove(lm_, lm_ + n, sizeof(LaunchMeldung) * static_cast<size_t>(lm_n_ - n));
  lm_n_ -= n;
  return n;
}

int Arrangement::launch_stand(LaunchStand* aus, int max) const {
  int n = 0;
  auto fuellen = [&](const LSpur* t, uint64_t kennung, const char* text) {
    if (n >= max) return;
    LaunchStand& s = aus[n++];
    std::memset(&s, 0, sizeof s);
    s.kennung = kennung;
    std::memcpy(s.text, text, sizeof s.text);
    s.wartend = -1;
    if (t) {
      s.zelle = t->zelle;
      s.verwaist = t->verwaist;
      s.ab_beat = t->ab_beat;
      s.versatz_beats = t->versatz;
      s.wartend = t->wartend;
      s.wartend_ab = t->wartend >= 0 ? t->wartend_ab : 0.0;
    }
    s.meldungen_verloren = lm_verloren_;
  };
  auto slot = [&](uint64_t kennung) -> const LSpur* {
    for (const LSpur& t : ls_)
      if (t.belegt && t.kennung == kennung) return &t;
    return nullptr;
  };
  if (snap_)
    for (int i = 0; i < ARR_SPUREN; ++i) {
      const ArrSpur& sp = snap_->spur[i];
      if (sp.kennung == 0 || sp.n_zellen == 0) continue;
      fuellen(slot(sp.kennung), sp.kennung, sp.kennung_text);
    }
  for (const LSpur& t : ls_) {   // tracks that are no longer in the snapshot but still sound or wait
    if (!t.belegt) continue;
    bool da = false;
    if (snap_)
      for (int i = 0; i < ARR_SPUREN; ++i) da = da || (snap_->spur[i].kennung == t.kennung && snap_->spur[i].n_zellen > 0);
    if (!da) fuellen(&t, t.kennung, t.text);
  }
  return n;
}

}  // namespace cdj
