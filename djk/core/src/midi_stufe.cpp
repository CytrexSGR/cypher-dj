// Strand 7 task 1.1: the MIDI stage of an instrument track (midi_stufe.h). Per run the stage walks one time line up to `bis`: at every sample
// first the offs that are due, then the queued inputs (OFF before ON), then a step (an immediate one of D5, a grid point, a free step).
// Outputs are bookkept per pitch: the sink that got the ON, its ON sample and its pending off, so an OFF always reaches the sink of its ON.
// Task 3.1 adds the chain around the arp (D2): forme() makes chord and scale out of one input pitch, vel_form() and faellt_aus() act per output ON.
// Without arp every held input remembers the outputs it sounds (Gehalten::raus) and outputs shared by several inputs carry a count (raus_zahl_).
// Real-time code: fixed arrays only, no allocation, no lock, no I/O.
#include "cypherdj/midi_stufe.h"

#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {

constexpr int64_t NIE = INT64_MAX;   // "no such event in this run"

uint64_t mische(uint64_t x) noexcept {   // splitmix64 finaliser
  x += 0x9e3779b97f4a7c15ull;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ull;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebull;
  return x ^ (x >> 31);
}

// D6: the same seed, track and step number give the same value in live play and in a render
uint64_t zufall(uint32_t saat, int spur, uint64_t nr) noexcept {
  return mische(mische((static_cast<uint64_t>(saat) << 32) ^ static_cast<uint32_t>(spur)) ^ nr);
}

// salts that keep the draws of the stages apart (the random arp pattern uses zufall() itself)
constexpr uint64_t SALZ_VEL = 0x76656c6f63697479ull, SALZ_CHANCE = 0x6368616e63650000ull;

uint64_t wurf(uint32_t saat, int spur, uint64_t schluessel, uint64_t salz) noexcept { return mische(zufall(saat, spur, schluessel) ^ salz); }

bool in_maske(uint16_t maske, int ton) noexcept { return (maske >> (ton % 12)) & 1u; }

// a sorts after b: later sample, or the same sample with a an ON and b an OFF
template <class E>
bool spaeter(const E& a, const E& b) noexcept {
  return a.ziel > b.ziel || (a.ziel == b.ziel && a.an && !b.an);
}

}  // namespace

bool gleich(const ArrMidiParam& a, const ArrMidiParam& b) noexcept {
  if (a.an != b.an || a.akkord_n != b.akkord_n) return false;
  for (int i = 0; i < MIDI_AKKORD_MAX; ++i)
    if (a.akkord[i] != b.akkord[i]) return false;
  return a.skala_maske == b.skala_maske && a.skala_lane == b.skala_lane && a.arp == b.arp && a.muster == b.muster && a.sync == b.sync &&
         a.rate_beats == b.rate_beats && a.rate_hz == b.rate_hz && a.oktaven == b.oktaven && a.gate == b.gate && a.vel == b.vel &&
         a.vel_kurve == b.vel_kurve && a.vel_zufall == b.vel_zufall && a.vel_fest == b.vel_fest && a.chance == b.chance && a.saat == b.saat;
}

MidiStufe::MidiStufe() noexcept {
  for (int t = 0; t < 128; ++t) {
    raus_se_[t] = nullptr;
    raus_an_t_[t] = KEIN;
    raus_aus_t_[t] = KEIN;
    klingt_[t] = false;
    raus_zahl_[t] = 0;
  }
}

int MidiStufe::forme(uint8_t ton, uint16_t maske, uint8_t* raus) const noexcept {
  int roh[FORM_MAX];
  int n = 0;
  roh[n++] = ton;
  const int akk = p_.akkord_n > MIDI_AKKORD_MAX ? MIDI_AKKORD_MAX : p_.akkord_n;
  for (int i = 0; i < akk; ++i) {   // chord: the input stays, every interval is added; outside 0..127 dropped
    const int t = ton + p_.akkord[i];
    if (t >= 0 && t <= 127) roh[n++] = t;
  }
  const uint16_t m = (maske ? maske : p_.skala_maske) & 0x0fffu;
  int k = 0;
  for (int i = 0; i < n; ++i) {
    int t = roh[i];
    if (m && !in_maske(m, t)) {   // scale: the nearest pitch in the mask, a tie goes down
      for (int d = 1; d < 128; ++d) {
        if (t - d >= 0 && in_maske(m, t - d)) {
          t -= d;
          break;
        }
        if (t + d <= 127 && in_maske(m, t + d)) {
          t += d;
          break;
        }
      }
    }
    bool doppelt = false;
    for (int j = 0; j < k && !doppelt; ++j) doppelt = raus[j] == t;
    if (!doppelt) raus[k++] = static_cast<uint8_t>(t);
  }
  return k;
}

uint8_t MidiStufe::vel_form(uint8_t vel, uint64_t schluessel) const noexcept {
  if (!p_.vel) return vel;
  int v;
  if (p_.vel_fest > 0) {
    v = p_.vel_fest;
  } else {
    const double kurve = p_.vel_kurve < -1.0f ? -1.0 : (p_.vel_kurve > 1.0f ? 1.0 : static_cast<double>(p_.vel_kurve));
    v = kurve == 0.0 ? vel : static_cast<int>(std::llround(127.0 * std::pow(vel / 127.0, std::exp2(-2.0 * kurve))));
  }
  const int z = p_.vel_zufall > 64 ? 64 : p_.vel_zufall;
  if (z > 0) v += static_cast<int>(wurf(p_.saat, spur_, schluessel, SALZ_VEL) % static_cast<uint64_t>(2 * z + 1)) - z;
  return static_cast<uint8_t>(v < 1 ? 1 : (v > 127 ? 127 : v));
}

bool MidiStufe::faellt_aus(uint64_t schluessel) const noexcept {
  if (p_.chance >= 100) return false;
  return wurf(p_.saat, spur_, schluessel, SALZ_CHANCE) % 100u >= p_.chance;
}

void MidiStufe::eingang_an(int i, int64_t t) noexcept {
  Gehalten& g = geh_[i];
  if (faellt_aus(g.schluessel)) return;   // chance: no output, so its OFF ends nothing
  uint8_t o[FORM_MAX];
  const int n = forme(g.ton, g.maske, o);
  for (int j = 0; j < n; ++j) {
    const uint8_t ton = o[j];
    const uint64_t bit = 1ull << (ton & 63);
    const bool eigen = (g.raus[ton >> 6] & bit) != 0;
    const uint8_t zahl = raus_zahl_[ton];
    const uint8_t vel = vel_form(g.vel, g.schluessel * 0x100000001b3ull + ton);
    if (klingt_[ton]) raus_aus(t, ton);   // a re-ON of a sounding output: OFF then ON at the same sample
    raus_an(g.se, t, ton, vel);
    if (!klingt_[ton]) continue;
    raus_zahl_[ton] = eigen ? (zahl ? zahl : 1) : static_cast<uint8_t>(zahl < 255 ? zahl + 1 : 255);
    g.raus[ton >> 6] |= bit;
  }
}

void MidiStufe::eingang_aus(int i, int64_t t) noexcept {
  Gehalten& g = geh_[i];
  for (int w = 0; w < 2; ++w) {
    uint64_t b = g.raus[w];
    while (b) {
      const int ton = w * 64 + __builtin_ctzll(b);
      b &= b - 1;
      if (!klingt_[ton]) continue;
      if (raus_zahl_[ton] > 1) --raus_zahl_[ton];
      else raus_aus(t, static_cast<uint8_t>(ton));
    }
    g.raus[w] = 0;
  }
}

void MidiStufe::rate_folgen(const ArrMidiParam& neu) noexcept {
  if (!neu.an || !neu.arp || !neu.sync || neu.rate_beats <= 0.0 || neu.rate_beats == laenge_rate_) return;
  if (schritt_laenge_ > 0 && laenge_rate_ > 0.0) {   // same tempo: the new step is the old one times the rate ratio
    const int64_t l = static_cast<int64_t>(std::llround(static_cast<double>(schritt_laenge_) * neu.rate_beats / laenge_rate_));
    schritt_laenge_ = l < 1 ? 1 : l;
  } else {
    schritt_laenge_ = 0;
  }
  laenge_rate_ = neu.rate_beats;
  raster_letzt_ = KEIN;   // the last grid point belongs to the old grid (no D5 start on it, no length measured across the change)
  raster_benutzt_ = false;
}

void MidiStufe::setze_spur(int spur) noexcept { spur_ = spur; }

void MidiStufe::ein(ArrSenke* se, int64_t ziel, uint8_t ton, uint8_t vel, bool an, uint64_t schluessel, uint16_t maske) noexcept {
  const Ereignis e{ziel, se, schluessel, folge_++, static_cast<uint16_t>(maske & 0x0fffu), static_cast<uint8_t>(ton & 127), vel, an};
  if (an) ++ein_noten_;
  if (qn_ == MIDI_EIN_MAX) {   // full: an ON is lost, an OFF is applied at once so no note hangs
    if (an) ++verloren_;
    else anwenden(e);
    return;
  }
  einreihen(e);
}

void MidiStufe::einreihen(const Ereignis& e) noexcept {
  int i = qn_++;
  while (i > 0 && spaeter(q_[i - 1], e)) {
    q_[i] = q_[i - 1];
    --i;
  }
  q_[i] = e;
}

bool MidiStufe::halte(const Ereignis& e) noexcept {
  for (int i = 0; i < gn_; ++i)
    if (geh_[i].ton == e.ton) {   // the same pitch again: latest velocity and sink
      if (geh_[i].zahl < 255) ++geh_[i].zahl;
      geh_[i].vel = e.vel;
      geh_[i].se = e.se;
      geh_[i].schluessel = e.schluessel;
      geh_[i].maske = e.maske;
      return true;
    }
  if (gn_ == MIDI_GEHALTEN_MAX) {
    ++verloren_;
    return false;
  }
  geh_[gn_++] = Gehalten{e.se, e.schluessel, e.folge, e.ton, e.vel, 1, e.maske, {0, 0}};
  liste_alt_ = true;
  return true;
}

bool MidiStufe::lasse(uint8_t ton) noexcept {
  for (int i = 0; i < gn_; ++i)
    if (geh_[i].ton == ton) {
      if (--geh_[i].zahl == 0) {
        for (int j = i + 1; j < gn_; ++j) geh_[j - 1] = geh_[j];   // keeps the press order
        --gn_;
        liste_alt_ = true;
      }
      return true;
    }
  return false;
}

void MidiStufe::raus_an(ArrSenke* se, int64_t t, uint8_t ton, uint8_t vel) noexcept {
  if (!se) return;
  se->note(spur_, t, ton, vel, true);
  ++aus_noten_;
  if (!klingt_[ton]) ++n_klingt_;
  else if (raus_aus_t_[ton] == AM_NAECHSTEN) --n_am_naechsten_;
  klingt_[ton] = true;
  raus_se_[ton] = se;
  raus_an_t_[ton] = t;
  raus_aus_t_[ton] = KEIN;
}

void MidiStufe::raus_aus(int64_t t, uint8_t ton) noexcept {
  if (!klingt_[ton]) return;
  raus_se_[ton]->note(spur_, t, ton, 0, false);
  klingt_[ton] = false;
  raus_zahl_[ton] = 0;
  --n_klingt_;
  if (raus_aus_t_[ton] == AM_NAECHSTEN) --n_am_naechsten_;
  raus_aus_t_[ton] = KEIN;   // raus_an_t_ stays: tausch re-sends an ON not before it
}

int64_t MidiStufe::naechstes_aus() const noexcept {
  if (n_klingt_ == 0) return KEIN;
  int64_t m = NIE;
  for (int t = 0; t < 128; ++t)
    if (klingt_[t] && raus_aus_t_[t] != KEIN && raus_aus_t_[t] != AM_NAECHSTEN && raus_aus_t_[t] < m) m = raus_aus_t_[t];
  return m == NIE ? KEIN : m;
}

void MidiStufe::offene_am_raster(int64_t t) noexcept {
  if (n_am_naechsten_ == 0) return;
  for (int k = 0; k < 128; ++k)
    if (klingt_[k] && raus_aus_t_[k] == AM_NAECHSTEN) raus_aus(t, static_cast<uint8_t>(k));
}

// every sounding output off, in time order: at max(its ON, s), or earlier at its own pending off
void MidiStufe::alle_klingenden_aus(int64_t s) noexcept {
  while (n_klingt_ > 0) {
    int64_t m = NIE;
    for (int k = 0; k < 128; ++k) {
      if (!klingt_[k]) continue;
      int64_t t = raus_an_t_[k] > s ? raus_an_t_[k] : s;
      const int64_t a = raus_aus_t_[k];
      if (a != KEIN && a != AM_NAECHSTEN && a < t && a >= raus_an_t_[k]) t = a;
      if (t < m) m = t;
    }
    for (int k = 0; k < 128; ++k) {
      if (!klingt_[k]) continue;
      int64_t t = raus_an_t_[k] > s ? raus_an_t_[k] : s;
      const int64_t a = raus_aus_t_[k];
      if (a != KEIN && a != AM_NAECHSTEN && a < t && a >= raus_an_t_[k]) t = a;
      if (t == m) raus_aus(m, static_cast<uint8_t>(k));
    }
  }
  for (int i = 0; i < gn_; ++i) geh_[i].raus[0] = geh_[i].raus[1] = 0;
}

void MidiStufe::baue_liste() noexcept {
  liste_alt_ = false;
  ln_ = 0;
  if (gn_ == 0) return;
  const int okt = p_.oktaven < 1 ? 1 : (p_.oktaven > 4 ? 4 : p_.oktaven);
  uint8_t ord[MIDI_GEHALTEN_MAX];   // indices of geh_: press order, or by pitch
  for (int i = 0; i < gn_; ++i) ord[i] = static_cast<uint8_t>(i);
  const bool gespielt = p_.muster == ArpMuster::played;
  if (!gespielt)
    for (int i = 1; i < gn_; ++i)
      for (int j = i; j > 0 && geh_[ord[j - 1]].ton > geh_[ord[j]].ton; --j) {
        const uint8_t x = ord[j];
        ord[j] = ord[j - 1];
        ord[j - 1] = x;
      }
  uint8_t form[MIDI_GEHALTEN_MAX][FORM_MAX];   // chord and scale of every held input (before the arp, deduplicated below)
  int fn[MIDI_GEHALTEN_MAX];
  // slice 5: with skala_lane every input takes the lane's mask at this step (liste_maske_), so a held input moves with the lane on the first step after a change
  for (int i = 0; i < gn_; ++i) fn[i] = forme(geh_[ord[i]].ton, p_.skala_lane ? liste_maske_ : geh_[ord[i]].maske, form[i]);
  for (int o = 0; o < okt; ++o)
    for (int i = 0; i < gn_; ++i)
      for (int j = 0; j < fn[i]; ++j) {
        const int ton = form[i][j] + 12 * o;
        if (ton > 127 || ln_ == LISTE_MAX) continue;
        bool doppelt = false;   // the same pitch was put first (a lower octave, an earlier input) and stays
        for (int q = 0; q < ln_ && !doppelt; ++q) doppelt = liste_[q].ton == ton;
        if (doppelt) continue;
        liste_[ln_++] = Stufe{static_cast<uint8_t>(ton), ord[i]};
      }
  if (!gespielt)   // stable insertion sort by pitch
    for (int i = 1; i < ln_; ++i)
      for (int j = i; j > 0 && liste_[j - 1].ton > liste_[j].ton; --j) {
        const Stufe x = liste_[j];
        liste_[j] = liste_[j - 1];
        liste_[j - 1] = x;
      }
}

void MidiStufe::spiele(int64_t t, int i, int64_t laenge, uint64_t nr) noexcept {
  const uint8_t ton = liste_[i].ton;
  const Gehalten& g = geh_[liste_[i].quelle];
  if (klingt_[ton]) raus_aus(t, ton);   // the same pitch steps again: its OFF first
  raus_an(g.se, t, ton, vel_form(g.vel, nr * 0x100000001b3ull + ton));
  if (!klingt_[ton]) return;
  if (laenge > 0) {
    const int64_t d = static_cast<int64_t>(std::llround(static_cast<double>(p_.gate) * static_cast<double>(laenge)));
    raus_aus_t_[ton] = t + (d < 1 ? 1 : d);
  } else {   // step length not known yet (first grid point ever seen): the off goes at the next grid point
    raus_aus_t_[ton] = AM_NAECHSTEN;
    ++n_am_naechsten_;
  }
}

void MidiStufe::schritt(int64_t t, uint64_t nr, int64_t laenge, uint16_t maske) noexcept {
  if (p_.skala_lane && maske != liste_maske_) {   // slice 5: the lane changed its mask since the last step
    liste_maske_ = maske;
    liste_alt_ = true;
  }
  if (liste_alt_) baue_liste();
  const int n = ln_;
  if (n == 0) return;
  const bool still = faellt_aus(nr);   // chance per step: the pattern position moves on, nothing sounds
  if (p_.muster == ArpMuster::chord) {
    if (!still)
      for (int i = 0; i < n; ++i) spiele(t, i, laenge, nr);
    ++idx_;
    return;
  }
  if (p_.muster == ArpMuster::random) {
    if (!still) spiele(t, static_cast<int>(zufall(p_.saat, spur_, nr) % static_cast<uint64_t>(n)), laenge, nr);
    ++idx_;
    return;
  }
  const bool hin_her = p_.muster == ArpMuster::updown || p_.muster == ArpMuster::downup;
  const uint64_t len = hin_her ? (n < 2 ? 1u : static_cast<uint64_t>(2 * n - 2)) : static_cast<uint64_t>(n);
  const uint64_t k = idx_ % len;
  int i = static_cast<int>(k);
  if (hin_her && i >= n) i = 2 * n - 2 - i;   // no repeat at the turns
  if (p_.muster == ArpMuster::down || p_.muster == ArpMuster::downup) i = n - 1 - i;
  if (!still) spiele(t, i, laenge, nr);
  idx_ = k + 1;
}

void MidiStufe::anwenden(const Ereignis& e) noexcept {
  if (!e.an) {   // an OFF ends what its input sounds (any mode); an OFF of an unheld pitch goes on unchanged
    int i = 0;
    while (i < gn_ && geh_[i].ton != e.ton) ++i;
    if (i < gn_) {
      eingang_aus(i, e.ziel);
      lasse(e.ton);
    } else if (!arp_an() && klingt_[e.ton] && raus_zahl_[e.ton] == 0) {
      raus_aus(e.ziel, e.ton);   // a re-sent ON nobody owns (bookkeeping stays true)
    } else if (e.se) {
      e.se->note(spur_, e.ziel, e.ton, e.vel, false);   // its ON went past the stage
    }
    if (gn_ == 0) {
      sofort_ = false;
      frei_an_ = false;
    }
    return;
  }
  if (!arp_an()) {   // without arp: chord, scale, velocity, chance per input ON
    if (!halte(e)) {   // held set full (counted in verloren): the input goes on unchanged, its OFF ends it as an unowned output
      raus_an(e.se, e.ziel, e.ton, e.vel);
      return;
    }
    for (int i = 0; i < gn_; ++i)
      if (geh_[i].ton == e.ton) {
        eingang_an(i, e.ziel);
        break;
      }
    return;
  }
  {
    const bool leer = gn_ == 0;
    if (!halte(e)) return;
    if (!leer) return;
    idx_ = 0;
    if (p_.sync) {   // D5: up to 1/8 step after an unused grid point the phrase starts at once
      if (raster_letzt_ != KEIN && !raster_benutzt_ && schritt_laenge_ > 0 && e.ziel >= raster_letzt_ &&
          8 * (e.ziel - raster_letzt_) <= schritt_laenge_) {
        sofort_ = true;
        sofort_t_ = e.ziel;
        sofort_maske_ = e.maske;
      }
    } else {
      frei_an_ = true;
      frei_naechst_ = e.ziel;
    }
  }
}

void MidiStufe::lauf(const ArrMidiParam& p, const MidiRaster& r, int64_t bis) noexcept {
  if (!gleich(p_, p)) {
    rate_folgen(p);
    p_ = p;
    liste_alt_ = true;
  }
  int ri = 0;
  for (;;) {
    int64_t to = naechstes_aus();
    if (to == KEIN || to >= bis) to = NIE;
    const int64_t tq = (qn_ > 0 && q_[0].ziel < bis) ? q_[0].ziel : NIE;
    const int64_t ts = sofort_ ? sofort_t_ : NIE;
    const int64_t tr = (ri < r.n && ri < MIDI_RASTER_MAX && r.s[ri] < bis) ? r.s[ri] : NIE;
    const bool frei = frei_an_ && arp_an() && !p_.sync && gn_ > 0;
    const int64_t tf = (frei && frei_naechst_ < bis) ? frei_naechst_ : NIE;
    int64_t t = to;
    if (tq < t) t = tq;
    if (ts < t) t = ts;
    if (tr < t) t = tr;
    if (tf < t) t = tf;
    if (t == NIE) break;
    if (to == t) {   // 1. offs due at t
      for (int k = 0; k < 128; ++k)
        if (klingt_[k] && raus_aus_t_[k] == t) raus_aus(t, static_cast<uint8_t>(k));
      continue;
    }
    if (tq == t) {   // 2. all inputs at t (OFF before ON)
      while (qn_ > 0 && q_[0].ziel == t) {
        const Ereignis e = q_[0];
        for (int i = 1; i < qn_; ++i) q_[i - 1] = q_[i];
        --qn_;
        anwenden(e);
      }
      continue;
    }
    if (ts == t) {   // 3. the immediate step counts as the last grid point
      sofort_ = false;
      // a grid point at this very sample plays the step itself (4.): a transport start just after a clock point (D5 window) puts project step 0 on the
      // sample of the first input, and without this the phrase fired twice there (strand 7 task 3.3 saw 17 ONs for 16 steps)
      if (tr == t) continue;
      if (arp_an() && p_.sync && gn_ > 0) {
        schritt(t, raster_nr_, schritt_laenge_, sofort_maske_);
        raster_benutzt_ = true;
      }
      continue;
    }
    if (tr == t) {   // 4. a grid point
      const uint64_t nr = r.nr[ri];
      offene_am_raster(t);
      if (raster_letzt_ != KEIN && nr == raster_nr_ + 1 && t > raster_letzt_) {
        schritt_laenge_ = t - raster_letzt_;
        laenge_rate_ = p_.rate_beats;
      }
      raster_letzt_ = t;
      raster_nr_ = nr;
      raster_benutzt_ = false;
      if (arp_an() && p_.sync && gn_ > 0) {
        int64_t laenge = schritt_laenge_;
        if (ri + 1 < r.n && ri + 1 < MIDI_RASTER_MAX && r.nr[ri + 1] == nr + 1 && r.s[ri + 1] > t) laenge = r.s[ri + 1] - t;
        schritt(t, nr, laenge, r.maske[ri]);
        raster_benutzt_ = true;
      }
      ++ri;
      continue;
    }
    // 5. a free step (D4: rate in Hz from the first key of the phrase)
    const double hz = p_.rate_hz > 0.0 ? p_.rate_hz : 8.0;
    int64_t laenge = static_cast<int64_t>(std::llround(MIDI_SR / hz));
    if (laenge < 1) laenge = 1;
    schritt(t, frei_nr_++, laenge, r.maske_frei);
    frei_naechst_ = t + laenge;
  }
}

void MidiStufe::tausch(const ArrMidiParam& neu, int64_t s) noexcept {
  if (gleich(p_, neu)) return;
  alle_klingenden_aus(s);
  idx_ = 0;
  sofort_ = false;
  frei_an_ = false;
  rate_folgen(neu);
  p_ = neu;
  liste_alt_ = true;
  if (!p_.an) return;
  if (!arp_an()) {   // without arp from s on: the held inputs sound again through the new chord, scale, velocity and chance
    for (int i = 0; i < gn_; ++i) {
      uint8_t o[FORM_MAX];
      const int n = forme(geh_[i].ton, geh_[i].maske, o);
      int64_t t = s;   // not before an ON already sent to one of its pitches
      for (int j = 0; j < n; ++j)
        if (raus_an_t_[o[j]] != KEIN && raus_an_t_[o[j]] > t) t = raus_an_t_[o[j]];
      eingang_an(i, t);
    }
  } else if (!p_.sync && gn_ > 0) {
    frei_an_ = true;
    frei_naechst_ = s;
  }
}

void MidiStufe::alle_aus(int64_t s) noexcept {
  alle_klingenden_aus(s);
  for (int i = 0; i < qn_; ++i) {   // a queued OFF of a pitch the stage does not hold belongs to an ON that went past the stage
    const Ereignis& e = q_[i];
    if (e.an || !e.se) continue;
    bool gehalten = false;
    for (int j = 0; j < gn_ && !gehalten; ++j) gehalten = geh_[j].ton == e.ton;
    if (!gehalten) e.se->note(spur_, e.ziel, e.ton, e.vel, false);
  }
  qn_ = 0;
  gn_ = 0;
  ln_ = 0;
  liste_alt_ = true;
  idx_ = 0;
  sofort_ = false;
  frei_an_ = false;
}

bool MidiStufe::ruhig() const noexcept { return gn_ == 0 && qn_ == 0 && n_klingt_ == 0; }

}  // namespace cdj
