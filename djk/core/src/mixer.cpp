// Mixer als Zuweisungstabelle (mixer.h). Scheibe 25.
#include "cypherdj/mixer.h"
#include "cypherdj/cypher_bk_ffi.h"
#include <cypherdj/dsp/denormal.h>

#include <cmath>
#include <cstdio>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

namespace sw = cypherdj::stellwerk;
namespace dsp = cypherdj::dsp;

namespace {

const char* const KANAL_NAMEN[MIX_KANAELE] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2",
                                              "erz/3",  "erz/4",  "erz/5",  "erz/6",  "erz/7", "erz/8",
                                              "pad/1",  "pad/2",  "bus/1",  "bus/2",  "bus/3", "bus/4"};

// 1.15 A3: where the gate and utility fields sit inside the slots of one channel, and which field is which (the order of the rows in
// signalbox/tool_controls.h). Constants, so the callback does not walk the table. Pinned by their effect in test_mixer_wz_felder
// (hold/attack, phase_r/dc, balance) and test_mixer_gate/test_mixer_utility (the others), and by test_mixer_werkzeug (the row order).
constexpr int V_GATE = wz_versatz(MixWerkzeug::gate), V_UTIL = wz_versatz(MixWerkzeug::utility);
#ifdef CYPHERDJ_MUTATION_WZ_HOLD_ATTACK_VERTAUSCHT   // error case: the fields hold and attack swapped
constexpr int G_AN = 0, G_SCHWELLE = 1, G_HYSTERESE = 2, G_RATIO = 3, G_BEREICH = 4, G_ATTACK = 6, G_HOLD = 5, G_RELEASE = 7, G_SC = 8;
#else
constexpr int G_AN = 0, G_SCHWELLE = 1, G_HYSTERESE = 2, G_RATIO = 3, G_BEREICH = 4, G_ATTACK = 5, G_HOLD = 6, G_RELEASE = 7, G_SC = 8;
#endif
#ifdef CYPHERDJ_MUTATION_WZ_PHASER_DC_VERTAUSCHT   // error case: the fields phase_r and dc swapped
constexpr int U_BALANCE = 0, U_BREITE = 1, U_BASSMONO = 2, U_PHASE_L = 3, U_PHASE_R = 6, U_TAUSCH = 5, U_DC = 4;
#else
constexpr int U_BALANCE = 0, U_BREITE = 1, U_BASSMONO = 2, U_PHASE_L = 3, U_PHASE_R = 4, U_TAUSCH = 5, U_DC = 6;
#endif

// 1.15 A4: where the multiband fields sit inside its slots (the order of the rows in signalbox/tool_controls.h): mb/an, mb/grenze_tief,
// mb/grenze_hoch, then three bands of seven (schwelle, ratio, attack, release, knie, makeup, umgehen). Pinned by effect in
// test_mixer_wz_felder (attack/release, tief/hoch, knie) and test_mixer_multiband (the rest).
constexpr int V_MB = wz_versatz(MixWerkzeug::multiband);
#ifdef CYPHERDJ_MUTATION_MB_GRENZEN_VERTAUSCHT   // error case: the crossover fields tief and hoch swapped
constexpr int M_AN = 0, M_TIEF = 2, M_HOCH = 1, M_BAND0 = 3, M_BAND_FELDER = 7;
#else
constexpr int M_AN = 0, M_TIEF = 1, M_HOCH = 2, M_BAND0 = 3, M_BAND_FELDER = 7;
#endif
#ifdef CYPHERDJ_MUTATION_MB_ATTACK_RELEASE_VERTAUSCHT   // error case: the band fields attack and release swapped
constexpr int MF_SCHWELLE = 0, MF_RATIO = 1, MF_ATTACK = 3, MF_RELEASE = 2, MF_KNIE = 4, MF_MAKEUP = 5, MF_UMGEHEN = 6;
#else
constexpr int MF_SCHWELLE = 0, MF_RATIO = 1, MF_ATTACK = 2, MF_RELEASE = 3, MF_KNIE = 4, MF_MAKEUP = 5, MF_UMGEHEN = 6;
#endif

// 1.15 A5b: the limiter fields inside its slots (lim/an, lim/decke, lim/abklingen in the order of the rows in signalbox/tool_controls.h)
constexpr int V_LIM = wz_versatz(MixWerkzeug::limiter);
constexpr int LM_AN = 0, LM_DECKE = 1, LM_ABKLINGEN = 2;

inline float s_kurve(float u) { return u * u * (3.0f - 2.0f * u); }
inline int ganz(float w) { return static_cast<int>(std::lround(w)); }
inline float lin(float db) { return static_cast<float>(dsp::db_zu_linear(db)); }

// Addiert a·g (g je Sample oder konstant) auf z.
inline void addiere(float* z, const float* a, int n, float g) {
  if (g == 1.0f) {
    for (int i = 0; i < n; ++i) z[i] += a[i];
  } else if (g != 0.0f) {
    for (int i = 0; i < n; ++i) z[i] += a[i] * g;
  }
}

}  // namespace

int Mixer::kanal_index(const char* name) {
  if (!name) return -1;
  for (int k = 0; k < MIX_KANAELE; ++k)
    if (!std::strcmp(name, KANAL_NAMEN[k])) return k;
  return -1;
}

const char* Mixer::kanal_name(int k) { return (k >= 0 && k < MIX_KANAELE) ? KANAL_NAMEN[k] : ""; }

Mixer::Mixer(const sw::ReglerTabelle& tab) : tab_(tab), n_regler_(tab.anzahl()) {
  hall_ = std::make_unique<Hall>();
  for (auto& kp : komp_) kp = std::make_unique<Komp>();
  kleber_ = std::make_unique<Kleber>();
  limiter_ = std::make_unique<dsp::MasterLimiter>();  // Vorgabe: Decke −1 dBTP (limiter_dbtp)
  for (int k = 0; k < MIX_KANAELE; ++k) {
    kz_[k] = std::make_unique<dsp::Kanalzug>();
    kz_[k]->zuruecksetzen();
  }
  for (int r = 0; r < n_regler_; ++r) {
    const sw::ReglerDef& d = tab.def(r);
    MixZuweisung& z = zuw_[r];
    int k = -1;
    const char* rest = d.pfad;
    if (d.kanal >= 0) {
      k = kanal_index(tab.kanal_name(d.kanal));
      rest = d.pfad + std::strlen(tab.kanal_name(d.kanal)) + 1;   // "deck/2/eq/tief" -> "eq/tief"
    }
    z.kanal = static_cast<int8_t>(k);
    if (d.transport) {
      z.rolle = MixRolle::ohne;
      continue;
    }
    if (k >= 0) {
      if (const auto dr = dsp::regler_aus_pfad(rest)) {
        z.rolle = MixRolle::kanalzug;
        z.regler = *dr;
      } else if (d.rolle == sw::Rolle::ziel) {
        z.rolle = MixRolle::ziel;
      } else if (d.rolle == sw::Rolle::xseite) {
        z.rolle = MixRolle::xseite;
      } else if (d.rolle == sw::Rolle::pfl) {
        z.rolle = MixRolle::pfl;
      } else if (d.rolle == sw::Rolle::werkzeug) {   // 1.15 A1b: matched on the path after the channel, like the pattern above
        MixWerkzeug t = MixWerkzeug::gate;
        int f = 0;
        if (wz_suffix(rest, t, f)) {
          z.rolle = MixRolle::werkzeug;
          z.werkzeug = t;
          z.feld = static_cast<int8_t>(f);
          // 1.15 A3: the tool objects exist where the table has rows for them (gate: 13 sources, utility: those and the 4 buses)
          if (t == MixWerkzeug::gate && k < MIX_QUELLEN && !gate_[k]) gate_[k] = std::make_unique<dsp::Gate>();
          if (t == MixWerkzeug::utility && !util_[k]) util_[k] = std::make_unique<dsp::Utility>();
          // 1.15 A4: the multiband exists on the buses only (the table has its rows nowhere else); built here, in the constructor
          if (t == MixWerkzeug::multiband && k >= MIX_QUELLEN && !mb_[k - MIX_QUELLEN]) {
            mb_[k - MIX_QUELLEN] = std::make_unique<dsp::MultibandKompressor>();
            mb2_[k - MIX_QUELLEN] = std::make_unique<dsp::MultibandKompressor>();   // the second object for the crossover crossfade
          }
        } else {
          z.rolle = MixRolle::spaeter;   // a row the suffix table does not know: the mapping test turns red on it
        }
      } else if (d.rolle >= sw::Rolle::komp_an && d.rolle <= sw::Rolle::komp_sc && k < MIX_QUELLEN) {
        z.rolle = MixRolle::komp;
        z.feld = static_cast<int8_t>(static_cast<int>(d.rolle) - static_cast<int>(sw::Rolle::komp_an));
      } else {
        z.rolle = MixRolle::spaeter;   // stem/* (Scheibe 31)
      }
    } else {
      switch (d.rolle) {
        case sw::Rolle::xfader: z.rolle = MixRolle::xfader; break;
        case sw::Rolle::master_pegel: z.rolle = MixRolle::master_pegel; break;
        case sw::Rolle::cue_mix: z.rolle = MixRolle::cue_mix; break;
        case sw::Rolle::cue_pegel: z.rolle = MixRolle::cue_pegel; break;
        case sw::Rolle::cue_split: z.rolle = MixRolle::cue_split; break;
        case sw::Rolle::duck_tiefe: z.rolle = MixRolle::duck_tiefe; break;
        case sw::Rolle::duck_release: z.rolle = MixRolle::duck_release; break;
        case sw::Rolle::master_kleber: z.rolle = MixRolle::master_kleber; break;
        case sw::Rolle::master_pfl: z.rolle = MixRolle::master_pfl; break;
        case sw::Rolle::color_art: z.rolle = MixRolle::color_art; break;
        case sw::Rolle::color_param: z.rolle = MixRolle::color_param; break;
        case sw::Rolle::spektrum_kanal:   // 1.15 A1b: the one global spectrum source, a slot only
          z.rolle = MixRolle::werkzeug;
          z.werkzeug = MixWerkzeug::spektrum;
          z.feld = 0;
          break;
        case sw::Rolle::fx_rueckweg:   // "fx/<n>/rueckweg"
          z.rolle = MixRolle::fx_rueckweg;
          z.fx = static_cast<int8_t>(std::min(3, std::max(0, d.pfad[3] - '1')));   // Pfad fx/<1..4>/rueckweg
          break;
        default: z.rolle = MixRolle::spaeter; break;   // fx/notenwert, fx/rueckkopplung (Scheibe 47)
      }
    }
    setze_sofort(r, d.vorgabe);   // Vorgaben aus §1.5 über die Tabelle des Stellwerks
  }
  for (int k = 0; k < MIX_KANAELE; ++k) ziel_ist_[k] = ganz(ziel_[k].w);
}

Mixer::Wert* Mixer::wert_von(int regler) {
  const MixZuweisung& z = zuw_[regler];
  switch (z.rolle) {
    case MixRolle::ziel: return &ziel_[z.kanal];
    case MixRolle::xseite: return &xseite_[z.kanal];
    case MixRolle::pfl: return &pfl_[z.kanal];
    case MixRolle::xfader: return &xfader_;
    case MixRolle::master_pegel: return &master_pegel_;
    case MixRolle::cue_mix: return &cue_mix_;
    case MixRolle::cue_pegel: return &cue_pegel_;
    case MixRolle::cue_split: return &cue_split_;
    case MixRolle::duck_tiefe: return &duck_tiefe_;
    case MixRolle::duck_release: return &duck_release_;
    case MixRolle::master_kleber: return &master_kleber_;
    case MixRolle::master_pfl: return &master_pfl_;
    case MixRolle::color_art: return &color_art_;
    case MixRolle::color_param: return &color_param_;
    case MixRolle::komp: return &komp_w_[z.kanal][z.feld];
    case MixRolle::werkzeug:
      return z.werkzeug == MixWerkzeug::spektrum ? &wz_spektrum_kanal_ : &wz_w_[z.kanal][wz_versatz(z.werkzeug) + z.feld];
    case MixRolle::fx_rueckweg: return &fx_rueck_[z.fx];
    default: return nullptr;
  }
}

float Mixer::wert(int regler) const {
  const Wert* w = const_cast<Mixer*>(this)->wert_von(regler);
  return w ? w->w : NAN;
}

void Mixer::setze_limiter_dbtp(double decke) {
  dsp::LimiterEinstellung e;
  e.decke_dbtp = static_cast<float>(decke);
  limiter_ = std::make_unique<dsp::MasterLimiter>(e);
  std::memset(pfl_verz_, 0, sizeof pfl_verz_);
  pfl_verz_pos_ = 0;
}

// 1.15 A5a: delay line of the latency account. Reads L samples back, then writes; in place. L >= 1 (the caller skips L = 0).
void Mixer::Leitung::leeren() noexcept {
  std::memset(l, 0, sizeof l);
  std::memset(r, 0, sizeof r);
  pos = 0;
}

void Mixer::Leitung::block(float* xl, float* xr, int n, int latenz) noexcept {
  constexpr int CAP = KANAL_LATENZ_MAX + 1;
  for (int i = 0; i < n; ++i) {
#ifdef CYPHERDJ_MUTATION_LATENZ_RING_PLUS_EINS   // error case: the read position is one sample too late, i.e. a delay of L - 1
    int lese = pos - latenz + 1;
#else
    int lese = pos - latenz;
#endif
    if (lese < 0) lese += CAP;
    const float a = l[lese], b = r[lese];
    l[pos] = xl[i];
    r[pos] = xr[i];
    xl[i] = a;
    xr[i] = b;
    if (++pos == CAP) pos = 0;
  }
}

// In front of a delay line: a block that is not finite is cleared (it must not enter the line, where it would come out L samples later
// and keep the master silent for another L). The caller flags the F01 guard of verarbeite() with it.
bool Mixer::vor_leitung_endlich(float* l, float* r, int n) noexcept {
#ifdef CYPHERDJ_MUTATION_LATENZ_F01_ERST_NACH_RING   // error case: no check in front of the lines, a NaN is found when it comes out
  (void)l; (void)r; (void)n;
  return true;
#endif
  bool endlich = true;
  for (int i = 0; i < n; ++i) endlich = endlich && std::isfinite(l[i]) && std::isfinite(r[i]);
  if (!endlich) {
    std::memset(l, 0, sizeof(float) * static_cast<size_t>(n));
    std::memset(r, 0, sizeof(float) * static_cast<size_t>(n));
  }
  return endlich;
}

void Mixer::setze_kanal_latenz(int samples) {
#ifdef CYPHERDJ_MUTATION_LATENZ_KLEMME_AUS   // error case: no clamp, a value outside 0..kMaxLatenz is taken as it is
  const int neu = samples;
#else
  const int neu = std::min(std::max(samples, 0), KANAL_LATENZ_MAX);
#endif
#ifndef CYPHERDJ_MUTATION_LATENZ_GLEICHER_WERT_LEERT   // error case: the same value clears the lines and the PFL ring again
  if (neu == kanal_latenz_) return;   // no-op: the lines hold audio in flight
#endif
  kanal_latenz_ = neu;
  for (auto& v : bus_verz_) v.leeren();
  summe_verz_.leeren();
  metro_verz_.leeren();
  std::memset(pfl_verz_, 0, sizeof pfl_verz_);
  pfl_verz_pos_ = 0;
}

// 1.15 A5b: the channel limiter. Built here, once, while the callback is stopped; L comes from the limiter object (the four are identical).
void Mixer::setze_kanal_limiter(double vorhalt_ms, bool echtspitze) {
  for (int b = 0; b < MIX_BUSSE; ++b) {
    lim_[b].reset();
    lim_lief_[b] = false;
    lim_pos_[b] = lim_warm_[b] = 0;
    lim_decke_[b] = lim_abkl_[b] = NAN;
    lim_red_[b].store(0.0f, std::memory_order_relaxed);
  }
  if (!(vorhalt_ms > 0.0)) {   // 0 (the default): nothing built, L = 0, the old paths
    setze_kanal_latenz(0);
    return;
  }
  dsp::KanalLimiterEinstellung e;
  e.vorhalt_ms = static_cast<float>(vorhalt_ms);
  e.echtspitze = echtspitze;
  for (auto& l : lim_) l = std::make_unique<dsp::KanalLimiter>(dsp::kAbtastrate, e);
#ifdef CYPHERDJ_MUTATION_LIM_L_OHNE_ECHTSPITZE   // error case: L is computed without the true-peak interpolator delay (12 samples)
  setze_kanal_latenz(lim_[0]->latenz_samples() - (echtspitze ? dsp::KanalLimiter::kInterpVerzug : 0));
#else
  setze_kanal_latenz(lim_[0]->latenz_samples());
#endif
}

float Mixer::kanal_limiter_reduktion_db(int bus) const {
#ifndef CYPHERDJ_MUTATION_LIM_GETTER_OHNE_GUARD   // error case (manual UBSan/ASan demonstration only): the index is not checked
  if (bus < 0 || bus >= MIX_BUSSE) return 0.0f;
#endif
  return lim_red_[bus].load(std::memory_order_relaxed);
}

void Mixer::lim_zuruecksetzen(int b) noexcept {
  if (lim_[b]) lim_[b]->leeren();
  lim_lief_[b] = false;
  lim_pos_[b] = lim_warm_[b] = 0;
  lim_red_[b].store(0.0f, std::memory_order_relaxed);
}

// Limiter of bus k after its delay line: (ein_l, ein_r) is the undelayed bus signal, (l, r) the delayed one (the dry signal of the crossfade).
// The object is called while the switch is on or the crossfade (480 samples, S-curve, D7) is still open; when the fade-out ends it is reset and not
// called any more (D6). After a start it runs unheard for L samples (its own delay must fill first, else the crossfade would fade in silence).
void Mixer::lim_block(int k, int n, bool an, const float* ein_l, const float* ein_r, float* l, float* r) {
  const int b = k - MIX_QUELLEN;
#ifdef CYPHERDJ_MUTATION_LIM_GETEILT   // error case: every bus uses the limiter of bus/1 (the state and the ceiling are shared)
  dsp::KanalLimiter* lim = lim_[0].get();
#else
  dsp::KanalLimiter* lim = lim_[b].get();
#endif
  if (!lim_lief_[b]) {
    lim_lief_[b] = true;
#ifdef CYPHERDJ_MUTATION_LIM_WARM_OHNE   // error case: no warm-up, the crossfade starts at once while the limiter's own delay is still empty
    lim_warm_[b] = 0;
#elif defined(CYPHERDJ_MUTATION_LIM_WARM_HALB)   // error case: the warm-up is half of what the limiter's own delay needs
    lim_warm_[b] = kanal_latenz_ / 2;
#elif defined(CYPHERDJ_MUTATION_LIM_FENSTER_LANG)   // error case: the unheard start is a crossfade length longer than the limiter needs (the overshoot window grows)
    lim_warm_[b] = kanal_latenz_ + LIM_BLENDE_SAMPLES;
#else
    lim_warm_[b] = kanal_latenz_;
#endif
    lim_pos_[b] = 0;
  }
  const float decke = wz_wert(k, V_LIM + LM_DECKE, n), abkl = wz_wert(k, V_LIM + LM_ABKLINGEN, n);
#ifdef CYPHERDJ_MUTATION_LIM_DECKE_EINMAL   // error case: ceiling and release are handed over once, a later change never arrives
  if (std::isnan(lim_decke_[b])) {
#else
  if (decke != lim_decke_[b]) {
#endif
    lim->setze_decke_db(decke);
    lim_decke_[b] = decke;
  }
#ifdef CYPHERDJ_MUTATION_LIM_DECKE_EINMAL
  if (std::isnan(lim_abkl_[b])) {
#else
  if (abkl != lim_abkl_[b]) {
#endif
    lim->setze_abklingen_ms(abkl);
    lim_abkl_[b] = abkl;
  }
#ifdef CYPHERDJ_MUTATION_LIM_BLENDE_NULL   // error case: no crossfade (length 0), the switch is a step
  constexpr int BL = 0;
#else
  constexpr int BL = LIM_BLENDE_SAMPLES;
#endif
  int& pos = lim_pos_[b];
  int& warm = lim_warm_[b];
  if (an && warm == 0 && pos == BL && BL > 0) {
    lim->verarbeite(ein_l, ein_r, l, r, n);   // fully in: straight into the bus output
  } else {
    lim->verarbeite(ein_l, ein_r, lim_aus_l_, lim_aus_r_, n);
    for (int i = 0; i < n; ++i) {
      float w;
      if (warm > 0) {
        --warm;
        w = 0.0f;
      } else if (BL == 0) {
        w = an ? 1.0f : 0.0f;
        pos = an ? 1 : 0;
      } else {
        if (an) {
          if (pos < BL) ++pos;
        } else if (pos > 0) {
          --pos;
        }
        w = s_kurve(static_cast<float>(pos) / static_cast<float>(BL));
      }
      if (w >= 1.0f) {
        l[i] = lim_aus_l_[i];
        r[i] = lim_aus_r_[i];
      } else {
        l[i] += w * (lim_aus_l_[i] - l[i]);
        r[i] += w * (lim_aus_r_[i] - r[i]);
      }
    }
  }
#ifdef CYPHERDJ_MUTATION_LIM_RED_BEI_AUS   // error case: the reduction is reported although lim/an is 0
  lim_red_[b].store(-lim->groesste_absenkung_db(), std::memory_order_relaxed);
#else
  const float red = -lim->groesste_absenkung_db();   // since the last call = this block; resets
#ifdef CYPHERDJ_MUTATION_LIM_RED_WARM   // error case: a reduction is reported while the limiter is still in its unheard warm-up
  lim_red_[b].store(an ? red : 0.0f, std::memory_order_relaxed);
#else
  lim_red_[b].store(an && warm == 0 ? red : 0.0f, std::memory_order_relaxed);   // not audible yet (warm-up) counts as 0
#endif
#endif
  if (!an && pos == 0) {   // switched off and faded out (or never heard): reset, not called any more
#ifdef CYPHERDJ_MUTATION_LIM_AUS_OHNE_LEEREN   // error case: the object keeps its gain reduction and its delay through the switch-off (D6)
    lim_lief_[b] = false;
    lim_pos_[b] = lim_warm_[b] = 0;
#else
    lim_zuruecksetzen(b);
#endif
  }
}

void Mixer::setze_filter_guete(double q) {
  for (auto& kz : kz_) kz->setze_filter_guete(q);
}

void Mixer::setze_sofort(int regler, float wert) {
  if (regler < 0 || regler >= n_regler_) return;
  const MixZuweisung& z = zuw_[regler];
  if (z.rolle == MixRolle::kanalzug) {
#ifndef CYPHERDJ_MUTATION_NUR_CUE_AUS
    if (nur_cue_[z.kanal]) return;   // Review-Kern m2: Gehörschutz, Trim/EQ/Filter von erz/8 bleiben neutral
#endif
    kz_[z.kanal]->setze_sofort(z.regler, wert);
    return;
  }
  Wert* w = wert_von(regler);
  if (!w) return;
  w->w = wert;
  w->vl = nullptr;
  if (z.rolle == MixRolle::ziel) {
    ziel_ist_[z.kanal] = ganz(wert);
    blende_rest_[z.kanal] = 0;
  }
}

void Mixer::verlauf(int regler, const float* werte) {
  if (regler < 0 || regler >= n_regler_ || !werte) return;
  const MixZuweisung& z = zuw_[regler];
  if (z.rolle == MixRolle::kanalzug) {
#ifndef CYPHERDJ_MUTATION_NUR_CUE_AUS
    if (nur_cue_[z.kanal]) return;   // Review-Kern m2 (s. setze_sofort)
#endif
    kz_[z.kanal]->verlauf(z.regler, werte);
    return;
  }
  if (Wert* w = wert_von(regler)) w->vl = werte;
}

// Addiert den Ausgang (nach dem Fader) von Kanal k auf sein Ziel: Master mit Crossfader-Gewicht oder Eingang eines
// Busses. Busse gehen immer auf den Master. Ein Zielwechsel blendet über MIX_ZIEL_BLENDE Samples.
void Mixer::route(int k, int n, const float* l, const float* r) {
  const bool bus = k >= MIX_QUELLEN;
  const float* zvl = bus ? nullptr : ziel_[k].vl;
  const float* xsvl = xseite_[k].vl;
  const float* xfvl = xfader_.vl;
  // 1.15 A5a: with the latency account a bus joins the master in bus_sum_ (already delayed by its own line); sources and the buses'
  // inputs keep their targets. bus_sum_ is only cleared and read while kanal_latenz_ > 0.
  const bool in_bus_sum = bus && kanal_latenz_ > 0;
  float* const bsl = in_bus_sum ? bus_sum_l_ : sum_l_;
  float* const bsr = in_bus_sum ? bus_sum_r_ : sum_r_;
  auto ziel_l = [&](int z) { return z == 0 ? bsl : ein_l_[MIX_QUELLEN + z - 1]; };
  auto ziel_r = [&](int z) { return z == 0 ? bsr : ein_r_[MIX_QUELLEN + z - 1]; };
  if (!zvl && !xsvl && !xfvl && blende_rest_[k] == 0) {   // ruhig: ein Ziel, ein Gewicht für den ganzen Block
    const int z = bus ? 0 : ziel_ist_[k];
    const float g = z == 0 ? seitengewicht(ganz(xseite_[k].w), xfader_.w) : 1.0f;
    addiere(ziel_l(z), l, n, g);
    addiere(ziel_r(z), r, n, g);
    return;
  }
  for (int i = 0; i < n; ++i) {
    if (zvl) {
      int zi = ganz(zvl[i]);
      zi = zi < 0 ? 0 : (zi > MIX_BUSSE ? MIX_BUSSE : zi);
      if (zi != ziel_ist_[k]) {
        blende_von_[k] = ziel_ist_[k];
        ziel_ist_[k] = zi;
        blende_rest_[k] = MIX_ZIEL_BLENDE;
      }
    }
    float w_neu = 1.0f, w_alt = 0.0f;
    if (blende_rest_[k] > 0) {
      w_neu = s_kurve(1.0f - static_cast<float>(blende_rest_[k]) / MIX_ZIEL_BLENDE);
      w_alt = 1.0f - w_neu;
      --blende_rest_[k];
    }
    const int xs = ganz(xsvl ? xsvl[i] : xseite_[k].w);
    const float gs = seitengewicht(xs, xfvl ? xfvl[i] : xfader_.w);
    const int z = bus ? 0 : ziel_ist_[k];
    const float gn = w_neu * (z == 0 ? gs : 1.0f);
    ziel_l(z)[i] += l[i] * gn;
    ziel_r(z)[i] += r[i] * gn;
    if (w_alt > 0.0f) {
      const int za = blende_von_[k];
      const float ga = w_alt * (za == 0 ? gs : 1.0f);
      ziel_l(za)[i] += l[i] * ga;
      ziel_r(za)[i] += r[i] * ga;
    }
  }
}

// Kompressor des Quellkanals k auf dem Abgriff (nach EQ/Filter, vor dem Fader); Werte am Blockende wie duck/*, das Knie
// fest 6 dB, kein Sidechain im Kern
void Mixer::komp_block(int k, int n) {
  const Wert* w = komp_w_[k];
  CypherKompEinstellung e{w[1].w, w[2].w, 6.0, w[3].w, w[4].w, w[5].w, w[6].w, 0.0};
  komp_[k]->setze(e);
  // Sidechain (komp/sc): Schlüssel ist der Eingang des Quellkanals (vor Trim und EQ); er liegt für alle Kanäle schon vor,
  // ehe die Kanalschleife läuft, also ohne Verzug, gleich in welcher Reihenfolge die Kanäle gerechnet werden
  const int sc = ganz(w[7].w) - 1;
  if (sc >= 0 && sc < MIX_QUELLEN && sc != k)
    komp_[k]->block_sc(kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), ein_l_[sc], ein_r_[sc], n);
  else
    komp_[k]->block(kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), n);
  komp_lief_[k] = true;
  komp_gr_[k].store(komp_[k]->gr_db(), std::memory_order_relaxed);
}

// 1.15 A3: a mix-tool slot (D9): the value w, and with a per-sample course its last sample vl[n-1] (the value this block ends on).
// The compressor (komp_block) reads only w, which the previous block's nachfuehren has set to its own vl[n-1]: the tools read one
// block earlier on a ramp.
float Mixer::wz_wert(int k, int pos, int n) const {
  const Wert& w = wz_w_[k][pos];
#ifdef CYPHERDJ_MUTATION_WZ_WERT_NUR_W   // error case: the value at the start of the block, a per-sample course ignored
  (void)n;
  return w.w;
#else
  return w.vl ? w.vl[n - 1] : w.w;
#endif
}

// Utility parameters of channel k from the slots. True if any of them is not neutral (the object must run).
bool Mixer::util_gefordert(int k, int n, dsp::UtilityParameter& p) const {
  p.balance = wz_wert(k, V_UTIL + U_BALANCE, n);
  p.breite_prozent = wz_wert(k, V_UTIL + U_BREITE, n);
  p.bass_mono_hz = wz_wert(k, V_UTIL + U_BASSMONO, n);
  p.phase_umkehren_l = ganz(wz_wert(k, V_UTIL + U_PHASE_L, n)) == 1;
  p.phase_umkehren_r = ganz(wz_wert(k, V_UTIL + U_PHASE_R, n)) == 1;
  p.seiten_tauschen = ganz(wz_wert(k, V_UTIL + U_TAUSCH, n)) == 1;
  p.dc_sperre = ganz(wz_wert(k, V_UTIL + U_DC, n)) == 1;
  return p.balance != 0.0f || p.breite_prozent != 100.0f || p.bass_mono_hz != 0.0f || p.phase_umkehren_l || p.phase_umkehren_r ||
         p.seiten_tauschen || p.dc_sperre;
}

// Utility of channel k on the tap (after trim/EQ/kill/filter/colour, before the gate). It ramps inside the object (D7). Once the
// parameters are neutral again and its ramps are over it is reset and not called any more (D6).
void Mixer::util_block(int k, int n, const dsp::UtilityParameter& p, bool neutral) {
  util_[k]->setze(p);
  float* l = kz_[k]->abgriff_schreibbar(0);
  float* r = kz_[k]->abgriff_schreibbar(1);
  util_[k]->verarbeite(l, r, l, r, n);
  util_lief_[k] = true;
#ifndef CYPHERDJ_MUTATION_UTIL_IMMER
  if (neutral && !util_[k]->faehrt()) {
    util_[k]->leeren();
    util_lief_[k] = false;
  }
#else
  (void)neutral;
#endif
}

// Gate of source channel k on the tap, after the utility and before the compressor. Sidechain (gate/sc) as komp/sc: the INPUT of
// the source channel sc - 1 (before trim and EQ, there for all channels before the channel loop runs); 0 or the own index: the
// own signal.
void Mixer::gate_block(int k, int n) {
#ifdef CYPHERDJ_MUTATION_GATE_LEEREN_VOR_SETZE   // error case (the A3 fix round 1): leeren_offen() takes the hold time of the PREVIOUS setze()
  if (!gate_lief_[k]) gate_[k]->leeren_offen();
#endif
  dsp::GateParameter p;
  p.schwelle_db = wz_wert(k, V_GATE + G_SCHWELLE, n);
  p.hysterese_db = wz_wert(k, V_GATE + G_HYSTERESE, n);
  p.ratio = wz_wert(k, V_GATE + G_RATIO, n);
  p.bereich_db = wz_wert(k, V_GATE + G_BEREICH, n);
  p.attack_ms = wz_wert(k, V_GATE + G_ATTACK, n);
  p.hold_ms = wz_wert(k, V_GATE + G_HOLD, n);
  p.release_ms = wz_wert(k, V_GATE + G_RELEASE, n);
  gate_[k]->setze(p);
  // Switched on (or reset by the F01 guard): starts OPEN, so a running signal sees no step and it closes the regular way. AFTER setze(),
  // because leeren_offen() starts the hold with the hold time the gate holds now.
#ifdef CYPHERDJ_MUTATION_GATE_START_ZU   // error case (the A3 first version): the gate starts closed (leeren) and fades in
  if (!gate_lief_[k]) gate_[k]->leeren();
#elif !defined(CYPHERDJ_MUTATION_GATE_LEEREN_VOR_SETZE)
  if (!gate_lief_[k]) gate_[k]->leeren_offen();
#endif
  float* l = kz_[k]->abgriff_schreibbar(0);
  float* r = kz_[k]->abgriff_schreibbar(1);
  const int sc = ganz(wz_wert(k, V_GATE + G_SC, n)) - 1;
  const float* scl = nullptr;
  const float* scr = nullptr;
#ifdef CYPHERDJ_MUTATION_GATE_SC_EIGEN   // error case: the key is the own input, whatever gate/sc says
  if (sc >= 0) {
    scl = ein_l_[k];
    scr = ein_r_[k];
  }
#else
  if (sc >= 0 && sc < MIX_QUELLEN && sc != k) {
    scl = ein_l_[sc];
    scr = ein_r_[sc];
  }
#endif
  gate_[k]->verarbeite(l, r, l, r, n, scl, scr);
  gate_lief_[k] = true;
}

// Multiband of bus k on the tap (l, r), after the utility and the compressor, before the graph and the fader. The object is called while the
// switch is on or the crossfade (D7, 480 samples, S-curve, dry -> processed) is still open; when the fade-out ends it is reset and not called
// any more (D6). Parameters as the compressor reads them (D9: the slot value, with a course its last sample).
// Warm-up length for the crossovers (gt, gh): `basis` samples at 100 Hz and above; an empty Linkwitz-Riley 8 settles in time proportional to
// 1 / f, so below 100 Hz it grows in proportion (basis * 100 / f), at most MB_WARM_MAX.
int Mixer::mb_warm(float gt, float gh, int basis) {
  const float f = std::fmin(gt, gh);
  const float faktor = f < MB_WARM_HZ ? MB_WARM_HZ / std::fmax(f, 1.0f) : 1.0f;
  return std::min(MB_WARM_MAX, static_cast<int>(static_cast<float>(basis) * faktor));
}

void Mixer::mb_block(int k, int n, bool an, float* l, float* r) {
  const int b = k - MIX_QUELLEN;
  // The library counts a non-finite input sample as 0 and so would swallow a NaN that the stages before it (EQ, filter states) hold for
  // good: the sum would stay finite, the F01 guard would never fire and the bus would stay silent. A non-finite tap passes untouched, the
  // guard sees it and resets everything including this object.
#ifndef CYPHERDJ_MUTATION_MB_NAN_VERSCHLUCKT   // error case: the multiband swallows a NaN of its input
  for (int i = 0; i < n; ++i)
    if (!std::isfinite(l[i]) || !std::isfinite(r[i])) return;
#endif
  dsp::MultibandKompressor* A = mb_akt(b);
  dsp::MultibandKompressor* B = mb_ruhend(b);
  const float gt = wz_wert(k, V_MB + M_TIEF, n), gh = wz_wert(k, V_MB + M_HOCH, n);
  if (!mb_lief_[b]) {   // starting from a reset: the crossovers go in at once, there is nothing running to cross over from
    A->setze_grenzen(gt, gh);
    mb_gt_[b] = gt;
    mb_gh_[b] = gh;
    mb_gb_an_[b] = false;
    mb_gpos_[b] = 0;
  } else if (!mb_gb_an_[b] && (gt != mb_gt_[b] || gh != mb_gh_[b])) {
    // A crossover moved under a running signal. Coefficients switched at once with the states kept step and overshoot (measured: 1.47 from
    // a 0.5 sine), so the idle object gets the new crossovers, empty filters and the dynamics of the active one, and the output crosses over.
    // The newest target is simply read again when a crossfade is over (no queue, no restart of a running one).
#ifdef CYPHERDJ_MUTATION_MB_GRENZE_SOFORT   // error case (the old behaviour): the crossovers switch at once, no crossfade
    A->setze_grenzen(gt, gh);
    mb_gt_[b] = gt;
    mb_gh_[b] = gh;
#else
    B->leeren();
    B->setze_grenzen(gt, gh);
    mb_gb_an_[b] = true;
    mb_gpos_[b] = 0;
    mb_gwarm_[b] = mb_warm(gt, gh, MB_WARM_SAMPLES);   // first the new object warms up unheard (empty filters would overshoot), then the output crosses over
    mb_gbasis_[b] = mb_gwarm_[b];
    mb_gwarm_ges_[b] = 0;
    mb_gat_[b] = gt;   // the anchor: the crossovers at this leeren(); small or big is always measured against it
    mb_gah_[b] = gh;
    mb_gdyn_[b] = false;
    mb_gt_[b] = gt;   // what the object that becomes active has
    mb_gh_[b] = gh;
    ++mb_blenden_[b];
#endif
  } else if (mb_gb_an_[b] && mb_gwarm_[b] > 0 && (gt != mb_gt_[b] || gh != mb_gh_[b])) {
    // Still warming up (nothing heard yet): a newer target, e.g. the next step of a knob being turned. The ANCHOR is the pair of crossovers at the
    // last leeren() of the second object (mb_gat_/mb_gah_).
    // - Small (BOTH crossovers within MB_WARM_SPRUNG, 10 percent, of the anchor): it goes into the object in place. The filter state stays, the
    //   unheard coefficient switch settles in the rest of the warm-up, and the warm-up is NOT restarted: with an update every 1..3 blocks a
    //   restart would never let it end (measured 2026-11-03: the active crossover stayed at 480 Hz for 2 s, target 20 kHz). It is extended
    //   (to a least rest of MB_WARM_REST samples) only while it has run no longer than its base length + MB_WARM_VERLAENGERUNG samples (scaled for deep crossovers like the warm-up itself); after that
    //   it ends, the output crosses over, and the target stays pending.
    // - Big: the object is NOT touched, the target is only kept pending, like one that arrives during the crossfade. Old states under far
    //   different coefficients ring as long as empty ones need to settle (peak 1.38x the twin's at 200 -> 20 Hz when done in place), and
    //   a restart inside the warm-up could never end under steady big steps. After the crossfade a new cycle starts: leeren(), full warm-up.
    // Measuring against the anchor (not against the last target) keeps a chain of small steps from adding up to a big one (tief 400 -> 20 in steps of
    // x0.90: 10 percent each, 20x in all).
    const float gs = MB_WARM_SPRUNG;
#if defined(CYPHERDJ_MUTATION_MB_KLASSE_NUR_TIEF)   // error case: only the lower of the two crossovers decides, so every move of the upper one is small
    const float uf = std::fmin(gt, gh), af = std::fmin(mb_gat_[b], mb_gah_[b]);
    const bool klein = std::fabs(uf - af) <= gs * af;
#elif defined(CYPHERDJ_MUTATION_MB_VERGLEICH_LETZTES_ZIEL)   // error case: compared with the last target, so small steps add up
    const bool klein = std::fabs(gt - mb_gt_[b]) <= gs * mb_gt_[b] && std::fabs(gh - mb_gh_[b]) <= gs * mb_gh_[b];
#else
    const bool klein = std::fabs(gt - mb_gat_[b]) <= gs * mb_gat_[b] && std::fabs(gh - mb_gah_[b]) <= gs * mb_gah_[b];
#endif
#if defined(CYPHERDJ_MUTATION_MB_WARM_NEU_START)   // error case (the old behaviour): every new target empties the filters and restarts the warm-up
    (void)klein;
    B->leeren();
    B->setze_grenzen(gt, gh);
    mb_gwarm_[b] = MB_WARM_SAMPLES;
    mb_gt_[b] = gt;
    mb_gh_[b] = gh;
#elif defined(CYPHERDJ_MUTATION_MB_GROSS_ANGEWENDET)   // error case: a big step is applied in the warm-up (restart with the new anchor) instead of kept pending
    if (klein) {
      B->setze_grenzen(gt, gh);
      mb_gwarm_[b] = std::max(mb_gwarm_[b], std::min(mb_warm(gt, gh, MB_WARM_REST), std::max(mb_gbasis_[b] + mb_warm(gt, gh, MB_WARM_VERLAENGERUNG) - mb_gwarm_ges_[b], 0)));
    } else {
      B->leeren();
      B->setze_grenzen(gt, gh);
      mb_gat_[b] = gt;
      mb_gah_[b] = gh;
      mb_gwarm_[b] = mb_gbasis_[b] = mb_warm(gt, gh, MB_WARM_SAMPLES);
      mb_gwarm_ges_[b] = 0;
    }
    mb_gt_[b] = gt;
    mb_gh_[b] = gh;
#else
    if (klein) {
      B->setze_grenzen(gt, gh);
      const int platz = std::max(mb_gbasis_[b] + mb_warm(gt, gh, MB_WARM_VERLAENGERUNG) - mb_gwarm_ges_[b], 0);
      mb_gwarm_[b] = std::max(mb_gwarm_[b], std::min(mb_warm(gt, gh, MB_WARM_REST), platz));
      mb_gt_[b] = gt;
      mb_gh_[b] = gh;
    }
#endif
  }
  const bool gblende = mb_gb_an_[b];
  if (gblende && mb_gwarm_[b] == 0 && !mb_gdyn_[b]) {   // the crossfade starts with this block: now the dynamics of the active object go over
#if defined(CYPHERDJ_MUTATION_MB_DYNAMIK_NICHT_KOPIERT)   // error case: the reduction of the new object settles in again from zero
#elif defined(CYPHERDJ_MUTATION_MB_DYNAMIK_NUR_RAMPEN)   // error case: only the settings and gain ramps are taken over, not the detectors
    B->uebernehme_rampen(*A);
#else
    B->uebernehme_dynamik(*A);
#endif
    mb_gdyn_[b] = true;
  }
  for (int bi = 0; bi < dsp::MultibandKompressor::kBaender; ++bi) {
#ifdef CYPHERDJ_MUTATION_MB_BAENDER_VERTAUSCHT   // error case: the bands in the wrong order (the tief slots drive the hoch band and vice versa)
    const int pos = V_MB + M_BAND0 + M_BAND_FELDER * (dsp::MultibandKompressor::kBaender - 1 - bi);
#else
    const int pos = V_MB + M_BAND0 + M_BAND_FELDER * bi;
#endif
    dsp::MbBandEinstellung e;
    e.schwelle_db = wz_wert(k, pos + MF_SCHWELLE, n);
    e.verhaeltnis = wz_wert(k, pos + MF_RATIO, n);
    e.anstieg_ms = wz_wert(k, pos + MF_ATTACK, n);
    e.abklingen_ms = wz_wert(k, pos + MF_RELEASE, n);
    e.knie_db = wz_wert(k, pos + MF_KNIE, n);
    e.aufholen_db = wz_wert(k, pos + MF_MAKEUP, n);
#ifdef CYPHERDJ_MUTATION_MB_AUSGLEICH_AUS   // error case: the Mixer never switches the automatic make-up on, a compressed bus gets quieter
    e.aufholen_auto = false;
#else
    e.aufholen_auto = mb_auto_;
#endif
    e.umgehen = ganz(wz_wert(k, pos + MF_UMGEHEN, n)) == 1;
#ifdef CYPHERDJ_MUTATION_MB_MAKEUP_BEI_UMGEHEN   // error case: "bypass" as ratio 1, so the makeup of the band is still applied
    if (e.umgehen) {
      e.umgehen = false;
      e.verhaeltnis = 1.0f;
    }
#endif
    A->setze_band(static_cast<dsp::Band>(bi), e);
    if (gblende) B->setze_band(static_cast<dsp::Band>(bi), e);
  }
#ifdef CYPHERDJ_MUTATION_MB_BLENDE_NULL   // error case: no crossfade (length 0), the switch is a step
  constexpr int BL = 0;
#else
  constexpr int BL = MB_BLENDE_SAMPLES;
#endif
  int& pos = mb_pos_[b];
  if (an && pos == BL && !gblende) {
    A->verarbeite(l, r, l, r, n);   // fully in, no crossover crossfade: in place, no copy
  } else {
    std::memcpy(mb_tr_l_, l, sizeof(float) * static_cast<size_t>(n));
    std::memcpy(mb_tr_r_, r, sizeof(float) * static_cast<size_t>(n));
    A->verarbeite(mb_tr_l_, mb_tr_r_, l, r, n);   // l, r now hold the processed signal; the dry one is in mb_tr_
    if (gblende) B->verarbeite(mb_tr_l_, mb_tr_r_, mb_b_l_, mb_b_r_, n);
    int& gp = mb_gpos_[b];
    const bool warm = gblende && mb_gwarm_[b] > 0;   // warming up: B runs but is not heard
    if (warm) {
      mb_gwarm_[b] = mb_gwarm_[b] > n ? mb_gwarm_[b] - n : 0;
      mb_gwarm_ges_[b] += n;
    }
    for (int i = 0; i < n; ++i) {
      if (gblende && !warm) {
        if (gp < MB_BLENDE_SAMPLES) ++gp;
        const float gw = s_kurve(static_cast<float>(gp) / static_cast<float>(MB_BLENDE_SAMPLES));
        l[i] += gw * (mb_b_l_[i] - l[i]);
        r[i] += gw * (mb_b_r_[i] - r[i]);
      }
      float w;
      if (BL == 0) {
        w = an ? 1.0f : 0.0f;
      } else {
        if (an) {
          if (pos < BL) ++pos;
        } else if (pos > 0) {
          --pos;
        }
        w = s_kurve(static_cast<float>(pos) / static_cast<float>(BL));
      }
      l[i] = mb_tr_l_[i] + w * (l[i] - mb_tr_l_[i]);
      r[i] = mb_tr_r_[i] + w * (r[i] - mb_tr_r_[i]);
    }
    if (BL == 0) pos = an ? BL : 0;
    if (gblende && !warm && gp >= MB_BLENDE_SAMPLES) {   // the crossfade is over: the second object is the active one from the next block on
      mb_wahl_[b] = !mb_wahl_[b];
      mb_gb_an_[b] = false;
      gp = 0;
#ifdef CYPHERDJ_MUTATION_MB_VORMERKEN_VERLOREN   // error case: the crossovers that arrived during the crossfade count as reached
      mb_gt_[b] = gt;
      mb_gh_[b] = gh;
#endif
    }
  }
  mb_lief_[b] = true;
#ifndef CYPHERDJ_MUTATION_MB_KEIN_RESET   // error case: the multiband keeps its filter and envelope state when it is switched off
  if (!an && pos == 0) {
    mb_akt(b)->leeren();
    mb_ruhend(b)->leeren();
    mb_gb_an_[b] = false;
    mb_gpos_[b] = 0;
    mb_gwarm_[b] = 0;
    mb_lief_[b] = false;
  }
#endif
}

Mixer::~Mixer() {
  for (int k = 0; k < MIX_GRAPH_KANAELE; ++k) {
    cypher_bk_frei(bk_[k]);
    cypher_bk_frei(bk_alt_[k]);
  }
  for (int s = 0; s < MIX_SENDS_GRAPH; ++s) {
    cypher_bk_frei(send_bk_[s]);
    cypher_bk_frei(send_bk_alt_[s]);
  }
  cypher_bk_frei(master_bk_);
  cypher_bk_frei(master_bk_alt_);
  for (int i = 0; i < n_bk_frei_; ++i) cypher_bk_frei(bk_frei_[i]);
}

void Mixer::bk_zur_freigabe(CypherBk* g) noexcept {
  if (!g) return;
  if (n_bk_frei_ < MIX_BK_FREI) bk_frei_[n_bk_frei_++] = g;
  else ++bk_verloren_;   // je Block geleert; lieber verlieren als im Callback freigeben
}

void Mixer::setze_kanal_graph(int k, CypherBk* g) noexcept {
  if (k < 0 || k >= MIX_GRAPH_KANAELE) { bk_zur_freigabe(g); return; }
  graph_platz_setze({bk_[k], bk_alt_[k], bk_blende_[k]}, g);
}

void Mixer::setze_send_graph(int s, CypherBk* g) noexcept {
  if (s < 2 || s >= 2 + MIX_SENDS_GRAPH) { bk_zur_freigabe(g); return; }
  const int i = s - 2;
  graph_platz_setze({send_bk_[i], send_bk_alt_[i], send_blende_[i]}, g);
}

void Mixer::setze_master_graph(CypherBk* g) noexcept {
  graph_platz_setze({master_bk_, master_bk_alt_, master_blende_}, g);
}

// Switch logic of one graph slot, shared by the deck insert and the send returns (D9).
void Mixer::graph_platz_setze(GraphPlatz p, CypherBk* g) noexcept {
  if (g == p.g) return;
#ifndef CYPHERDJ_MUTATION_BK_KANAL_DOPPEL_ALT
  if (p.blende == MIX_GRAPH_BLENDE) {
    // Der neue Weg hat noch kein Sample gerechnet (zweiter Wechsel vor demselben Block): er geht, der gehörte alte
    // Weg blendet weiter aus. Sonst würde der ungehörte Graph zum alten Weg und der gehörte bräche ohne Blende ab.
    bk_zur_freigabe(p.g);
    p.g = g;
    if (g == p.alt) { p.alt = nullptr; p.blende = 0; }   // zurück auf den gehörten Weg
    return;
  }
#endif
  bk_zur_freigabe(p.alt);   // D4: ein Wechsel in der Blende gibt den ältesten sofort frei
  p.alt = p.g;              // null heißt: der alte Weg war trocken
  p.g = g;
  p.blende = MIX_GRAPH_BLENDE;
}

int Mixer::bk_frei(CypherBk** aus, int max) noexcept {
  const int n = std::min(n_bk_frei_, max);
  for (int i = 0; i < n; ++i) aus[i] = bk_frei_[i];
  for (int i = n; i < n_bk_frei_; ++i) bk_frei_[i - n] = bk_frei_[i];
  n_bk_frei_ -= n;
  return n;
}

// S5r: die Regler <kanal>/bk/1..32 an den Graphen des Kanals k melden (die FFI glättet). Nur der gehörte Graph bk_[k], nie bk_alt_.
// Ohne Werte-Zeiger (Tests ohne Kern) keine Meldung (K10).
void Mixer::bk_regler_melden(CypherBk* g, int k) noexcept {
#ifdef CYPHERDJ_MUTATION_BK_REGLER_NICHT_GEMELDET  // Fehlerfall S5r: der Kern meldet die Regler nie an den Graphen
  (void)g; (void)k;
  return;
#endif
#ifdef CYPHERDJ_MUTATION_BK_SEND_WAECHTER_ALT   // failure case S14: the guard of S5r, rows 18 and 19 (send returns) are dropped
  if (!bk_wert_ || !g || k < 0 || k >= MIX_KANAELE) return;
#else
  if (!bk_wert_ || !g || k < 0 || k >= MIX_BK_ZEILEN) return;   // S14: rows 18, 19 are the send returns
#endif
#ifdef CYPHERDJ_MUTATION_BK_REGLER_FALSCHER_KANAL  // Fehlerfall S5r: die Zeile des Nachbarkanals
  k = (k + 1) % MIX_BK_ZEILEN;
#endif
  for (int nr = 1; nr <= cypherdj::stellwerk::BK_REGLER_N; ++nr) {
#ifdef CYPHERDJ_MUTATION_BK_REGLER_TAUSCH_05  // Fehlerfall S5r (D5): nur gemeldet, wenn sich der Wert ändert; ein getauschter Graph bleibt auf 0,5
    static float zuletzt[MIX_BK_ZEILEN][cypherdj::stellwerk::BK_REGLER_N];
    if (bk_wert_[k][nr - 1] == zuletzt[k][nr - 1]) continue;
    zuletzt[k][nr - 1] = bk_wert_[k][nr - 1];
#endif
    cypher_bk_regler(g, static_cast<uint32_t>(nr), bk_wert_[k][nr - 1]);
  }
}

// Insert auf dem Abgriff l/r (in place): neuer Weg, während der Blende gemischt mit dem alten. Ausgang geklemmt (±8, NaN 0).
void Mixer::kanal_graph(int k, float* l, float* r, int n) noexcept {
  std::memcpy(bk_ein_l_, l, sizeof(float) * n);
  std::memcpy(bk_ein_r_, r, sizeof(float) * n);
  cypherdj::dsp::DenormalSchutz ds;
  GraphOptionen opt;
#ifdef CYPHERDJ_MUTATION_BK_KANAL_TAKT_AUS
  opt.takt = false;
#endif
#ifdef CYPHERDJ_MUTATION_BK_KANAL_BLENDE_AUS
  bk_blende_[k] = 0;
#endif
#ifdef CYPHERDJ_MUTATION_BK_KANAL_KLEMME_AUS
  opt.klemme = false;
#endif
  // in = copy of the tap, out = the tap itself; the copy is also the dry fallback (removed graph / blend from dry)
  graph_platz_block({bk_[k], bk_alt_[k], bk_blende_[k]}, bk_ein_l_, bk_ein_r_, l, r, bk_ein_l_, bk_ein_r_, k, n, opt);
}

// Shared block logic of one graph slot (deck insert, send return). See mixer.h.
void Mixer::graph_platz_block(GraphPlatz p, const float* in_l, const float* in_r, float* out_l, float* out_r,
                              const float* fb_l, const float* fb_r, int regler_zeile, int n, GraphOptionen opt) noexcept {
  const size_t nn = static_cast<size_t>(n);
  if (p.g) {
    if (regler_zeile >= 0) bk_regler_melden(p.g, regler_zeile);
    if (opt.takt) cypher_bk_takt(p.g, fx_beat0_, fx_bps_);
    cypher_bk_effekt(p.g, in_l, in_r, out_l, out_r, nn);
  } else if (out_l != fb_l) {   // no graph (removed, blending out): the new path is the fallback
    std::memcpy(out_l, fb_l, sizeof(float) * nn);
    std::memcpy(out_r, fb_r, sizeof(float) * nn);
  }
  if (p.blende > 0) {
    const float* al = fb_l;
    const float* ar = fb_r;
    if (p.alt) {
      if (opt.takt) cypher_bk_takt(p.alt, fx_beat0_, fx_bps_);
      cypher_bk_effekt(p.alt, in_l, in_r, bk_alt_l_, bk_alt_r_, nn);
      al = bk_alt_l_;
      ar = bk_alt_r_;
    }
    for (int i = 0; i < n; ++i) {
      const int rest = p.blende - i;
      const float w = rest > 0 ? static_cast<float>(rest) / MIX_GRAPH_BLENDE : 0.0f;   // Gewicht des alten Wegs
      out_l[i] = out_l[i] * (1.0f - w) + al[i] * w;
      out_r[i] = out_r[i] * (1.0f - w) + ar[i] * w;
    }
    p.blende = std::max(0, p.blende - n);
    if (p.blende == 0) {
      bk_zur_freigabe(p.alt);
      p.alt = nullptr;
    }
  }
  if (opt.klemme) {
    for (int i = 0; i < n; ++i) {
      out_l[i] = std::isfinite(out_l[i]) ? std::clamp(out_l[i], -8.0f, 8.0f) : 0.0f;
      out_r[i] = std::isfinite(out_r[i]) ? std::clamp(out_r[i], -8.0f, 8.0f) : 0.0f;
    }
  }
}

// Master insert on the sum l/r (in place): like the deck insert (dry copy as input and fallback), reports the knob row master/bk/*.
// Nothing runs while no graph is set and no blend is pending, so the sum stays untouched bit for bit.
void Mixer::master_graph(float* l, float* r, int n) noexcept {
  if (!master_bk_ && master_blende_ == 0) return;
  std::memcpy(master_bk_ein_l_, l, sizeof(float) * n);
  std::memcpy(master_bk_ein_r_, r, sizeof(float) * n);
  cypherdj::dsp::DenormalSchutz ds;
  GraphOptionen opt;
  graph_platz_block({master_bk_, master_bk_alt_, master_blende_}, master_bk_ein_l_, master_bk_ein_r_, l, r, master_bk_ein_l_, master_bk_ein_r_,
                    MIX_BK_MASTER_ZEILE, n, opt);
}

// S6: return of the effect graph on send bus 2 + s (fx/3, fx/4). S14: it reports its own knob row (fx/<n>/bk/1..32). The graph processes the summed send bus, runs every
// block while a graph is set or blending (no wake gate: an echo tail must survive a silent send, D5), and its output is
// added to the master sum scaled by fx/<n>/rueckweg (same gain expression as the hall). The bus itself is never written.
void Mixer::send_rueckweg(int s, int n) noexcept {
  if (!send_bk_[s] && send_blende_[s] == 0) return;
  int bus = s + 2;
#ifdef CYPHERDJ_MUTATION_BK_SEND_BUS_VERTAUSCHT
  const int in_bus = 5 - bus;   // fx/3 <-> fx/4
#else
  const int in_bus = bus;
#endif
#ifdef CYPHERDJ_MUTATION_BK_SEND_GATE_WIE_HALL
  {
    bool speist = false;
    for (int i = 0; i < n && !speist; ++i) speist = fx_l_[in_bus][i] != 0.0f || fx_r_[in_bus][i] != 0.0f;
    if (!speist) return;
  }
#endif
  cypherdj::dsp::DenormalSchutz ds;
  GraphOptionen opt;
#ifdef CYPHERDJ_MUTATION_BK_SEND_BLENDE_AUS
  send_blende_[s] = 0;
#endif
#ifdef CYPHERDJ_MUTATION_BK_SEND_KLEMME_AUS
  opt.klemme = false;
#endif
#if defined(CYPHERDJ_MUTATION_BK_SEND_NUTZT_DECK_REGLER)
  const int zeile = bus;                           // failure case: fx/3 would hear deck/3/bk/*, fx/4 deck/4/bk/*
#elif defined(CYPHERDJ_MUTATION_BK_SEND_ZEILE_VERTAUSCHT)
  const int zeile = MIX_BK_SEND_ZEILE + 1 - s;     // failure case: fx/3 <-> fx/4 knobs swapped
#elif defined(CYPHERDJ_MUTATION_BK_SEND_OHNE_REGLER)
  const int zeile = -1;                            // failure case: the S6 behaviour, knobs stuck at 0.5
#else
  const int zeile = MIX_BK_SEND_ZEILE + s;         // S14: fx/3 -> row 18 (fx/3/bk/*), fx/4 -> row 19 (fx/4/bk/*)
#endif
  graph_platz_block({send_bk_[s], send_bk_alt_[s], send_blende_[s]}, fx_l_[in_bus], fx_r_[in_bus], send_aus_l_[s],
                    send_aus_r_[s], send_null_, send_null_, zeile, n, opt);
#ifndef CYPHERDJ_MUTATION_BK_SEND_RUECKGABE_AUS
  const Wert& rw = fx_rueck_[bus];
  for (int i = 0; i < n; ++i) {
#if defined(CYPHERDJ_MUTATION_BK_SEND_RUECKWEG_IGNORIERT)
    const float g = 1.0f;
#elif defined(CYPHERDJ_MUTATION_BK_SEND_RUECKWEG_W)
    const float g = lin(rw.w);
#else
    const float g = lin(rw.vl ? rw.vl[i] : rw.w);
#endif
    sum_l_[i] += send_aus_l_[s][i] * g;
    sum_r_[i] += send_aus_r_[s][i] * g;
  }
#endif
}

// ---- 1.15 A7b: spectrum path (D11, D12). The one place of this code; the call sites are one line each (verarbeite: block start, after
// kanal(k, n), after the F01 check).
// Bands: 3 per octave, centres 1000 Hz x 2^(i/3) for i = -16 .. 12, i.e. 24.8 Hz .. 16 kHz, 29 bands (asserted in test_mixer_spektrum).
cypherdj::dsp::SpektrumEinstellung Mixer::SpektrumVorgabe() {
  cypherdj::dsp::SpektrumEinstellung e;
  e.baender_pro_oktave = 3;
  e.f_min_hz = 24.0f;      // the lowest centre at or above this is 24.80 Hz (i = -16); i = -17 is 19.7 Hz
  e.f_max_hz = 16000.0f;   // 1000 x 2^4 exactly (i = 12)
  return e;
}

// Audio thread, first thing in a block: the selector is read like every other slot (the value at the end of the block when a course is
// set, D9). A change stores the new source and the write position of the analyser (everything written before it belongs to the old source),
// as a seqlock (D12): the generation goes odd BEFORE the stores and even AFTER them. The stores are release stores, so the odd value is
// visible to anyone who sees a new value; the network thread takes an even generation (acquire), loads source and cut (acquire), takes
// the generation again and uses the pair only if it is unchanged.
void Mixer::spek_blockanfang(int n) noexcept {
  const float w = wz_spektrum_kanal_.vl ? wz_spektrum_kanal_.vl[n - 1] : wz_spektrum_kanal_.w;
  int sel = ganz(w);
  if (sel < 0 || sel > SPEK_MASTER) sel = 0;
  if (sel == spek_ist_) return;
  spek_ist_ = sel;
#ifndef CYPHERDJ_MUTATION_SPEK_OHNE_UNGERADE   // error case: no odd phase (one bump after the stores): a reader between the stores sees the old generation
  spek_gen_.fetch_add(1, std::memory_order_relaxed);   // odd: a change is being written; ordered before the stores by their release
#endif
  if (spek_fenster_haken_) spek_fenster_haken_(spek_fenster_ctx_, 0);
  spek_quelle_.store(sel, std::memory_order_release);
  if (spek_fenster_haken_) spek_fenster_haken_(spek_fenster_ctx_, 1);
#ifdef CYPHERDJ_MUTATION_SPEK_SCHNITT_NULL   // error case: the cut is 0, nothing of the old source is dropped
  spek_schnitt_.store(0, std::memory_order_release);
#else
  spek_schnitt_.store(spek_->schreib_position(), std::memory_order_release);
#endif
  if (spek_fenster_haken_) spek_fenster_haken_(spek_fenster_ctx_, 2);
#ifndef CYPHERDJ_MUTATION_SPEK_GEN_STUMM   // error case: the generation is not bumped, the network thread never sees a change
#ifdef CYPHERDJ_MUTATION_SPEK_OHNE_UNGERADE
  spek_gen_.fetch_add(2, std::memory_order_release);   // the old code: one step per change, the same count as odd + even
#else
  spek_gen_.fetch_add(1, std::memory_order_release);   // even again: source and cut belong together
#endif
#endif
}

void Mixer::spek_abgriff(int k, int n) noexcept {
#ifdef CYPHERDJ_MUTATION_SPEK_CUE_OHNE_ABGRIFF   // error case: the cue-only channel (erz/8, early return of kanal()) is not tapped
  if (nur_cue_[k]) return;
#endif
#ifdef CYPHERDJ_MUTATION_SPEK_IMMER_SCHREIBEN   // error case: the tap writes also while the selector is 0
  if (spek_ist_ == 0 && k != 0) return;
#elif defined(CYPHERDJ_MUTATION_SPEK_TAP_VERSCHOBEN)   // error case: the neighbour channel is tapped
  if (spek_ist_ != k) return;
#else
  if (spek_ist_ != k + 1) return;
#endif
  spek_->schreibe(kz_[k]->abgriff(0), kz_[k]->abgriff(1), n);
}

void Mixer::spek_master(int n) noexcept {
  if (spek_ist_ != SPEK_MASTER) return;
  spek_->schreibe(sum_l_, sum_r_, n);
}

// Sleep rule of a silent strip. Called in kanal() after the wiring switches of the block are known. NOT a pure query: it keeps the sleep
// state (on falling asleep it zeroes the whole tap buffer once and sets schlaeft_[k]; the caller clears schlaeft_[k] when it runs the
// strip). True = the strip skips its DSP,
// its route and its meters for this block, and the output is bit-equal to running it. All of these must hold at the start of the block:
//  - the input block of the strip is exact zeros;
//  - the strip's last awake block left its tap and its final output exact zeros (stumm_), so PFL, spectrum and the envelope readers of
//    core_signalbox.cpp (they read the tap) see silence; on falling asleep the whole tap buffer is zeroed once (a shorter earlier block
//    could have left stale samples behind the first n);
//  - Kanalzug::ruhig(): no Bahn runs (a knob move by a course, ramp or setze starts one, or flips a switch the wiring below checks, so a
//    moved strip is awake in that block and no smoother has to advance while asleep; setze_sofort starts no Bahn and needs none: it sets
//    the value at once, and with zero input and zero states every gain gives exact zeros), the colour fx makes nothing out of zero, and
//    the isolator / DJ filter states are exactly zero;
//  - the mixer-side holders are idle: compressor, gate, utility, multiband (also its crossfade position and object), graph generator
//    (also its blend), the bus limiter (also its crossfade and warm-up), the BeatFx units of the strip (klingt() is also the condition
//    under which fx_kette() calls them at all), the bus delay ring holds zeros, no target crossfade is open and no per-sample target
//    course (route() would start a crossfade from it);
//  - no meter that decays: the compressor gain reduction, the gate and the limiter are off and reset, which is their rest value; the
//    peak hold of /pegel takes max(peak, 0) so zero changes nothing.
// Kept awake on purpose: strips in nur_cue_ (their own early path in kanal()), strips with a per-sample course on a knob (the Bahn runs).
bool Mixer::schlaf_schritt(int k, int n, bool komp_an, bool gate_an, bool util_an, bool mb_laeuft, bool bk_an, int fzi) {
  if (!schlaf_an_) return false;
  const float* el = ein_l_[k];
  const float* er = ein_r_[k];
  for (int i = 0; i < n; ++i)
    if (!(el[i] == 0.0f && er[i] == 0.0f)) return false;
  if (!schlaeft_[k] && !stumm_[k]) return false;
#ifndef CYPHERDJ_MUTATION_SCHLAF_OHNE_RUHIG   // error case: no ruhig() and no holder checks, only the zero input decides
  if (!kz_[k]->ruhig()) return false;
  if (komp_an || gate_an || util_an || mb_laeuft || bk_an) return false;
  // komp_lief_, gate_lief_ and util_lief_ need no check of their own: kanal() has just reset compressor and gate when they are off
  // (their *_lief_ is false then), and util_an already contains util_lief_.
  if (blende_rest_[k] != 0) return false;
  if (k < MIX_QUELLEN && ziel_[k].vl) return false;
  if (fzi >= 0)
    for (int u = 0; u < FX_EINHEITEN; ++u)
      if (fx_kanal_[u][fzi].klingt()) return false;
  if (k >= MIX_QUELLEN) {
    const int b = k - MIX_QUELLEN;
    if (mb_lief_[b] || mb_pos_[b] != 0) return false;
    if (lim_[b] && (ganz(wz_wert(k, V_LIM + LM_AN, n)) == 1 || lim_lief_[b] || lim_pos_[b] != 0 || lim_warm_[b] != 0)) return false;
    // The bus delay ring is a holder of its own, NOT covered by ruhig(): the ring is written after the whole strip (colour fx, fader, ...) and is up
    // to KANAL_LATENZ_MAX = 2062 samples long. NOISE colour makes sound from zero input behind the isolator, so on a bus that was never fed the
    // filter states stay exactly zero while the ring holds noise; the output stays zero for the whole latency, so stumm_ and ruhig() are both
    // true and without this check the bus would sleep and the noise in the ring would be lost (test_mixer_schlaf case 13 turns red, see
    // ~/messungen/2026-11-06-mehrkern-s1-s2/final-fix/halter-mutanten-3.txt; the first note there, "equivalent", was wrong).
    if (kanal_latenz_ > 0 && !schlaeft_[k]) {   // asleep already: the ring was zero then and nothing writes to it
      const Leitung& v = bus_verz_[b];
      for (int i = 0; i <= KANAL_LATENZ_MAX; ++i)
        if (!(v.l[i] == 0.0f && v.r[i] == 0.0f)) return false;
    }
  }
#else
  (void)komp_an; (void)gate_an; (void)util_an; (void)mb_laeuft; (void)bk_an; (void)fzi;
#endif
  if (!schlaeft_[k]) {   // falling asleep: the tap reads silence from now on
    for (int c = 0; c < 2; ++c) std::memset(kz_[k]->abgriff_schreibbar(c), 0, sizeof(float) * dsp::kMaxFrames);
    schlaeft_[k] = true;
  }
  return true;
}

void Mixer::kanal(int k, int n) {
  // SOUND COLOR FX: globale Art und PARAMETER (Werte am Blockende wie duck/*), Echozeit aus dem Tempo der Uhr
  kz_[k]->setze_color(ganz(color_art_.w), color_param_.w, fx_bps_ > 0.0 ? 1.0 / fx_bps_ : 0.0);
#ifdef CYPHERDJ_MUTATION_LIM_VOR_FADER   // error case (1.15 A5b): the limiter runs on the strip input, so in front of the fader and the sends
  if (k >= MIX_QUELLEN && lim_[k - MIX_QUELLEN] && ganz(wz_wert(k, V_LIM + LM_AN, n)) == 1) {
    lim_[k - MIX_QUELLEN]->setze_decke_db(wz_wert(k, V_LIM + LM_DECKE, n));
    lim_[k - MIX_QUELLEN]->setze_abklingen_ms(wz_wert(k, V_LIM + LM_ABKLINGEN, n));
    lim_[k - MIX_QUELLEN]->verarbeite(ein_l_[k], ein_r_[k], ein_l_[k], ein_r_[k], n);
  }
#endif
#ifndef CYPHERDJ_MUTATION_NUR_CUE_AUS
  if (nur_cue_[k]) {   // S7 Vorhören: Kanalzug rechnen (Trim/EQ/Filter wirken auf den Abgriff), Abgriff in PFL, sonst nichts
    schlaeft_[k] = stumm_[k] = false;   // never sleeps (own early path): the sleep state is cleared in case it was set before
    dsp::KanalzugAusgang aus;
    aus.haupt_l = aus_l_;
    aus.haupt_r = aus_r_;
    for (int s = 0; s < dsp::kAnzahlSends; ++s) { aus.send_l[s] = nullptr; aus.send_r[s] = nullptr; }   // channel_strip.cpp:117-119: nullptr = Send übersprungen
    kz_[k]->verarbeite(ein_l_[k], ein_r_[k], n, aus);
    // Review-Kern m4: ein NaN aus diesem Kanal bleibt bei ihm. Es käme sonst in die PFL-Summe, und die F01-Wache
    // (verarbeite) leerte Hall, Kleber, Beat-FX und alle Kanalzüge: der Master stünde einen Block still.
    bool endlich = true;
    for (int i = 0; i < n; ++i)
      endlich = endlich && std::isfinite(kz_[k]->abgriff(0)[i]) && std::isfinite(kz_[k]->abgriff(1)[i]);
    if (!endlich) {
      kz_[k]->zustaende_leeren();
      ++nan_treffer_;
      return;
    }
    addiere(pfl_l_, kz_[k]->abgriff(0), n, 1.0f);
    addiere(pfl_r_, kz_[k]->abgriff(1), n, 1.0f);
    return;   // kein route(): weder Master noch Bus; keine Spitze (Hüllen „nie belegt", core_signalbox.cpp:414)
  }
#endif
  dsp::KanalzugAusgang aus;
  aus.haupt_l = aus_l_;
  aus.haupt_r = aus_r_;
  for (int s = 0; s < dsp::kAnzahlSends; ++s) {
    aus.send_l[s] = fx_l_[s];
    aus.send_r[s] = fx_r_[s];
  }
  const int fzi = fx_ziel_index(k);
  const bool komp_an = k < MIX_QUELLEN && ganz(komp_w_[k][0].w) == 1;
  if (k < MIX_QUELLEN && !komp_an && komp_lief_[k]) {   // ausgeschaltet: nächstes Einschalten beginnt ohne alte Absenkung
    komp_[k]->leeren();
    komp_lief_[k] = false;
    komp_gr_[k].store(0.0f, std::memory_order_relaxed);
  }
  const bool bk_an = k < MIX_GRAPH_KANAELE && (bk_[k] || bk_blende_[k] > 0);
  // 1.15 A3: gate (sources) and utility (sources and buses). Bypass = the object is not called, and it is reset on the way back (D6):
  // the gate on gate/an 0, the utility once its values are neutral and its ramps are over.
#ifdef CYPHERDJ_MUTATION_GATE_OHNE_GUARD   // error case (the A3 first version): gate_[k] read for the buses too, i.e. util_[k - 14]
  const bool gate_hat = gate_[k] != nullptr;
#else
  const bool gate_hat = k < MIX_QUELLEN && gate_[k];   // kanal() also runs for the buses 14..17: gate_[] has MIX_QUELLEN elements
#endif
  const bool gate_an = gate_hat && ganz(wz_wert(k, V_GATE + G_AN, n)) == 1;
#ifndef CYPHERDJ_MUTATION_GATE_KEIN_RESET   // error case: the gate keeps its state when switched off
  if (gate_hat && !gate_an && gate_lief_[k]) {
    gate_[k]->leeren();
    gate_lief_[k] = false;
  }
#endif
  dsp::UtilityParameter up;
  const bool util_nicht_neutral = util_[k] && util_gefordert(k, n, up);
#ifdef CYPHERDJ_MUTATION_UTIL_IMMER   // error case: the utility is called although all its values are neutral
  const bool util_an = util_[k] != nullptr;
#else
  const bool util_an = util_nicht_neutral || (util_[k] && util_lief_[k]);
#endif
  // 1.15 A4: multiband on the buses (k = 14..17); the guard keeps a source index away from mb_[] (k - MIX_QUELLEN would be negative)
#ifdef CYPHERDJ_MUTATION_MB_OHNE_GUARD   // error case: mb_[] read for the sources too (manual UBSan demonstration only, not a registered test)
  const bool mb_hat = mb_[k - MIX_QUELLEN] != nullptr;
#else
  const bool mb_hat = k >= MIX_QUELLEN && mb_[k - MIX_QUELLEN];
#endif
  const bool mb_an = mb_hat && ganz(wz_wert(k, V_MB + M_AN, n)) == 1;
  const bool mb_laeuft = mb_hat && (mb_an || mb_pos_[k - MIX_QUELLEN] > 0);
  if (schlaf_schritt(k, n, komp_an, gate_an, util_an, mb_laeuft, bk_an, fzi)) {
    // Silent strip, every holder idle: tap, PFL, spectrum, sends, peak, route would all add exact zeros (schlaf_schritt).
    schlaf_bloecke_.store(schlaf_bloecke_.load(std::memory_order_relaxed) + 1, std::memory_order_relaxed);   // one writer
    return;
  }
  schlaeft_[k] = false;
  if (komp_an || bk_an || gate_an || util_an || mb_laeuft || (fzi >= 0 && routing_ == ROUTING_INSERT)) {
    // Utility, Gate (1.15 A3, D1), Kompressor (2026-10-11), Baukasten-Graph (S3c, D3) und Insert-FX (Ohr T17) sitzen vor dem Fader
    // auf dem Abgriff, in dieser Reihenfolge; die Teilung vor/nach ist bitgleich zu verarbeite (test_kanalzug_teilung)
    kz_[k]->verarbeite_vor(ein_l_[k], ein_r_[k], n);
#ifdef CYPHERDJ_MUTATION_UTIL_NACH_GATE   // error case: the utility behind the gate
    if (gate_an) gate_block(k, n);
    if (util_an) util_block(k, n, up, !util_nicht_neutral);
    if (komp_an) komp_block(k, n);
#elif defined(CYPHERDJ_MUTATION_GATE_NACH_KOMP)   // error case: the gate behind the compressor
    if (util_an) util_block(k, n, up, !util_nicht_neutral);
    if (komp_an) komp_block(k, n);
    if (gate_an) gate_block(k, n);
#elif defined(CYPHERDJ_MUTATION_MB_VOR_UTIL)   // error case: the multiband in front of the utility
    if (mb_laeuft) mb_block(k, n, mb_an, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1));
    if (util_an) util_block(k, n, up, !util_nicht_neutral);
    if (gate_an) gate_block(k, n);
    if (komp_an) komp_block(k, n);
#else
    if (util_an) util_block(k, n, up, !util_nicht_neutral);
    if (gate_an) gate_block(k, n);
    if (komp_an) komp_block(k, n);
#endif
#if !defined(CYPHERDJ_MUTATION_MB_VOR_UTIL) && !defined(CYPHERDJ_MUTATION_MB_NACH_FADER)
    if (mb_laeuft) mb_block(k, n, mb_an, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1));
#endif
    if (bk_an) kanal_graph(k, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), n);
    if (fzi >= 0 && routing_ == ROUTING_INSERT) fx_kette(fzi, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), n);
    kz_[k]->verarbeite_nach(n, aus);
#ifdef CYPHERDJ_MUTATION_MB_NACH_FADER   // error case: the multiband behind the fader (the tap and the cue do not hear it)
    if (mb_laeuft) mb_block(k, n, mb_an, aus_l_, aus_r_);
#endif
    if (fzi >= 0 && routing_ != ROUTING_INSERT) fx_kette(fzi, aus_l_, aus_r_, n);   // Post Fader wie unten
  } else {
    kz_[k]->verarbeite(ein_l_[k], ein_r_[k], n, aus);
    if (fzi >= 0) fx_kette(fzi, aus_l_, aus_r_, n);   // AUFTRAG 2026-09-28: Post Fader, nach dem Fader
  }
  const float* al = kz_[k]->abgriff(0);
  const float* ar = kz_[k]->abgriff(1);
  if (const float* pvl = pfl_[k].vl) {
    for (int i = 0; i < n; ++i)
      if (pvl[i] >= 0.5f) {
        pfl_l_[i] += al[i];
        pfl_r_[i] += ar[i];
      }
  } else if (pfl_[k].w >= 0.5f) {
    addiere(pfl_l_, al, n, 1.0f);
    addiere(pfl_r_, ar, n, 1.0f);
  }
#ifdef CYPHERDJ_MUTATION_PEGEL_OHNE_ERZ567
  if (k < 7 || k == 12 || k == 13) {
#else
  if (k < 7 || (k >= 8 && k <= 10) || k == 12 || k == 13) {  // /pegel: Spitze nach dem Fader, deck/1..4, erz/1..3 (Studio S1), erz/5..7 (S18), pad/1..2 (MVP 2)
#endif
    float sp = spitze_[k];
    for (int i = 0; i < n; ++i) sp = std::max(sp, std::max(std::fabs(aus_l_[i]), std::fabs(aus_r_[i])));
    spitze_[k] = sp;
  }
  // 1.15 A5a (D8 a): a bus runs through a delay of L after its whole strip (after verarbeite_nach, its sends were taken before). A
  // non-finite sample is caught here, before it enters the line (it would come out L samples later and keep the master silent for
  // another L): the block is cleared and the F01 guard of verarbeite() does the rest. Only buses own a line: k - MIX_QUELLEN is
  // in range only behind the k >= MIX_QUELLEN test.
  if (kanal_latenz_ > 0 && k >= MIX_QUELLEN) {
    if (!vor_leitung_endlich(aus_l_, aus_r_, n)) latenz_nan_ = true;
    const int b = k - MIX_QUELLEN;
    // 1.15 A5b (D1, D7): the channel limiter sits behind the fader and the sends (they were taken in verarbeite_nach), in front of route. The bus
    // always runs through its delay of L, so lim/an 0 is a pure delay and the limiter's crossfade is time-aligned (both sides have latency L).
    const bool lim_hat = lim_[b] != nullptr;
    const bool lim_an = lim_hat && ganz(wz_wert(k, V_LIM + LM_AN, n)) == 1;
    const bool lim_laeuft = lim_hat && (lim_an || lim_lief_[b]);
    if (lim_laeuft) {
      std::memcpy(lim_ein_l_, aus_l_, sizeof(float) * static_cast<size_t>(n));
      std::memcpy(lim_ein_r_, aus_r_, sizeof(float) * static_cast<size_t>(n));
    }
#ifdef CYPHERDJ_MUTATION_LIM_AUS_OHNE_VERZOEGERUNG   // error case: lim/an 0 bypasses without the delay, so the bus is L samples early
    if (ganz(wz_wert(k, V_LIM + LM_AN, n)) == 1)
#endif
    bus_verz_[b].block(aus_l_, aus_r_, n, kanal_latenz_);
#ifndef CYPHERDJ_MUTATION_LIM_VOR_FADER   // error case: the limiter sits in front of the strip (so in front of the fader and the sends), see the top of kanal()
    if (lim_laeuft) lim_block(k, n, lim_an, lim_ein_l_, lim_ein_r_, aus_l_, aus_r_);
#endif
  }
  {   // sleep bookkeeping: did this awake block leave the tap and the final output exact zeros?
    bool still = true;
    const float* tl = kz_[k]->abgriff(0);
    const float* tr = kz_[k]->abgriff(1);
    for (int i = 0; i < n && still; ++i)
      still = tl[i] == 0.0f && tr[i] == 0.0f && aus_l_[i] == 0.0f && aus_r_[i] == 0.0f;
    stumm_[k] = still;
  }
  route(k, n, aus_l_, aus_r_);
}

// FX1 (u = 0) vor FX2 (u = 1), seriell, auf dem Signal in place
void Mixer::fx_kette(int fzi, float* l, float* r, int n) noexcept {
#ifdef CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT   // Fehlerfall Slice 2 Task 1: FX2 vor FX1
  for (int u = FX_EINHEITEN - 1; u >= 0; --u)
#else
  for (int u = 0; u < FX_EINHEITEN; ++u)
#endif
    if (fx_kanal_[u][fzi].klingt()) fx_kanal_[u][fzi].block(l, r, n, fx_beat0_, fx_bps_);
}

void Mixer::fx_routing_setze(int routing) noexcept {
  routing = routing == ROUTING_INSERT ? ROUTING_INSERT : ROUTING_POST_FADER;
#ifdef CYPHERDJ_MUTATION_FX_ROUTING_HART   // Fehlerfall: Weg sofort getauscht, Leitungen sofort leer, kein Gleiten
  routing_ = routing_ziel_ = routing;
  for (int u = 0; u < FX_EINHEITEN; ++u)
    for (int i = 0; i < FX_ZIELE; ++i) fx_kanal_[u][i].leeren();
  return;
#endif
  if (routing == routing_ziel_) return;
  routing_ziel_ = routing;
  if (routing_wechsel_) return;   // die Blende läuft schon, sie endet auf dem neuen Ziel
  routing_wechsel_ = true;
  for (int u = 0; u < FX_EINHEITEN; ++u)
    for (int i = 0; i < FX_ZIELE; ++i) fx_kanal_[u][i].pause();   // gleiten auf 0; jede Einheit klingt weiter, bis sie 0 hat
}

void Mixer::fx_routing_fortschritt() noexcept {
  if (!routing_wechsel_) return;
  for (int u = 0; u < FX_EINHEITEN; ++u)
    for (int i = 0; i < FX_ZIELE; ++i)
      if (!fx_kanal_[u][i].pausiert()) return;
  routing_ = routing_ziel_;   // alle bei 0 und geleert: hier ist der Weg neutral (g·x auf beiden Wegen)
  routing_wechsel_ = false;
  for (int u = 0; u < FX_EINHEITEN; ++u)
    for (int i = 0; i < FX_ZIELE; ++i) fx_kanal_[u][i].weiter();   // zurück auf ihr gesetztes Wet
}

int Mixer::fx_ziel_index(int kanal) noexcept {
  for (int i = 0; i < FX_ZIELE; ++i)
    if (FX_ZIEL_KANAL[i] == kanal) return i;
  return -1;
}

void Mixer::fx_einheit_setze(int einheit, int art, double beats, float wet, float param1, double param2,
                             double param3, bool an) noexcept {
  fx_art_[einheit] = art;
  fx_beats_[einheit] = beats;
  fx_wet_[einheit] = wet;
  fx_param1_[einheit] = param1;
  fx_param2_[einheit] = param2;   // reserviert, nicht an BeatFx weitergereicht
  fx_param3_[einheit] = param3;   // reserviert, nicht an BeatFx weitergereicht
  fx_an_[einheit] = an;
  for (int i = 0; i < FX_ZIELE; ++i) fx_kanal_[einheit][i].setze(art, beats, wet, param1, an && fx_zuw_[einheit][i]);
  fx_master_[einheit].setze(art, beats, wet, param1, an && fx_master_zuw_[einheit]);
}

// Zuweisung ab schließt nur den Eingang der Instanz: die Fahne klingt aus (Andreas 2026-09-28).
void Mixer::fx_zuweisung_setze(int einheit, int kanal, bool an) noexcept {
  if (kanal == FX_MASTER) {
    fx_master_zuw_[einheit] = an;
    fx_master_[einheit].setze(fx_art_[einheit], fx_beats_[einheit], fx_wet_[einheit], fx_param1_[einheit],
                              an && fx_an_[einheit]);
    return;
  }
  const int i = fx_ziel_index(kanal);
  if (i < 0) return;   // der Kern hat schon geprüft; ohne Wirkung statt eines ungültigen Zugriffs
  fx_zuw_[einheit][i] = an;
  fx_kanal_[einheit][i].setze(fx_art_[einheit], fx_beats_[einheit], fx_wet_[einheit], fx_param1_[einheit],
                              an && fx_an_[einheit]);
}

bool Mixer::fx_zugewiesen(int einheit, int kanal) const noexcept {
  if (kanal == FX_MASTER) return fx_master_zuw_[einheit];
  const int i = fx_ziel_index(kanal);
  return i >= 0 && fx_zuw_[einheit][i];
}

const BeatFx& Mixer::beatfx(int einheit, int kanal) const noexcept {
  if (kanal == FX_MASTER) return fx_master_[einheit];
  const int i = fx_ziel_index(kanal);
  return fx_kanal_[einheit][i < 0 ? 0 : i];
}

void Mixer::verarbeite(int n, float* ml, float* mr, float* cl, float* cr) {
  if (n < 1) return;
  if (n > MIX_BLOCK) n = MIX_BLOCK;
  const size_t b = sizeof(float) * static_cast<size_t>(n);
  spek_blockanfang(n);   // 1.15 A7b: spectrum selector, first thing in a block
  fx_routing_fortschritt();    // Ohr T17: eine fertige Blende vollenden, bevor der erste Kanal rechnet
  std::memset(sum_l_, 0, b);   // Scheibe 25: der Master-Eingang (Prüfklick Z1) kommt erst hinter dem Limiter dazu
  std::memset(sum_r_, 0, b);
  std::memset(pfl_l_, 0, b);
  std::memset(pfl_r_, 0, b);
  if (kanal_latenz_ > 0) {
    std::memset(bus_sum_l_, 0, b);
    std::memset(bus_sum_r_, 0, b);
  }
  for (int s = 0; s < dsp::kAnzahlSends; ++s) {
    std::memset(fx_l_[s], 0, b);
    std::memset(fx_r_[s], 0, b);
  }
  duck_.setze(duck_tiefe_.w, duck_release_.w);   // K2: Werte je Block (Rampen der Tiefe kommen über .w am Blockende)
  if (!duck_.ruhig()) {   // läuft auch nach dem Zurückdrehen auf 0 dB zu Ende (Erholung, endet am Boden 1e-4 in duck.h)
    duck_.block(duck_gain_, n);
#ifndef CYPHERDJ_MUTATION_DUCK_AUS
    for (int k : {5, 6}) {   // erz/2, erz/3: die MIDI-Ströme Bass und Melodie (Studio-Aufbau S1/S5)
      float* l = ein_l_[k];
      float* r = ein_r_[k];
      for (int i = 0; i < n; ++i) { l[i] *= duck_gain_[i]; r[i] *= duck_gain_[i]; }
    }
#endif
  }
  for (int k = 0; k < MIX_QUELLEN; ++k) { kanal(k, n); spek_abgriff(k, n); }   // Quellen zuerst: sie füllen die Bus-Eingänge; 1.15 A7b: spectrum tap right after the channel
  for (int k = MIX_QUELLEN; k < MIX_KANAELE; ++k) { kanal(k, n); spek_abgriff(k, n); }
#ifdef CYPHERDJ_MUTATION_LATENZ_MERGE_VOR_HALL   // error case: the merge sits in front of the hall and the send returns, so these arrive undelayed
  if (kanal_latenz_ > 0) {
    if (!vor_leitung_endlich(sum_l_, sum_r_, n)) latenz_nan_ = true;
    summe_verz_.block(sum_l_, sum_r_, n, kanal_latenz_);
  }
#endif
  // K2 Slice 2: Rückweg fx/2 = Hall. Send 2 aller Kanäle (nach dem Fader) → Hall → mal fx/2/rueckweg → Summe.
  // Der Hall (bis 2026-10-11 Faust zita, rauschte bei Stille mit ~1e-20) darf erst rechnen und in die Summe, wenn
  // ein Send ihn gespeist hat (Vorgaben: Master bitgleich zu vorher), und läuft weiter, bis der Eingang länger still
  // war als seine längste Rückkopplungsleitung (32768 Samples, daher 65536 mit Reserve) UND der Nachhall unter 1e-9
  // (−180 dBFS) liegt (sonst bräche ein laufender Nachhall ab).
  {
    const Wert& rw = fx_rueck_[1];
#ifndef CYPHERDJ_MUTATION_HALL_TOT
    bool speist = false;
    for (int i = 0; i < n && !speist; ++i) speist = fx_l_[1][i] != 0.0f || fx_r_[1][i] != 0.0f;
    if (speist) {
      hall_wach_ = true;
      hall_ruhe_ = 0;
    }
    if (hall_wach_) {
      hall_->block(fx_l_[1], fx_r_[1], hall_l_, hall_r_, n);
      if (!speist && hall_ruhe_ < HALL_RUHE_MAX) hall_ruhe_ += n;   // nur im Wachen gezählt, dazu gesättigt (kein int-Überlauf)
      float spitze = 0.0f;
      for (int i = 0; i < n; ++i) {
        const float g = lin(rw.vl ? rw.vl[i] : rw.w);
        sum_l_[i] += hall_l_[i] * g;
        sum_r_[i] += hall_r_[i] * g;
        spitze = std::fmax(spitze, std::fmax(std::fabs(hall_l_[i]), std::fabs(hall_r_[i])));
      }
      if (hall_ruhe_ > 65536 && spitze < 1e-9f) {
        hall_wach_ = false;
        hall_ruhe_ = 0;
      }
    }
#endif
  }
#ifndef CYPHERDJ_MUTATION_LATENZ_SEND_NACH_MERGE   // error case: the send-graph returns join after the merge, i.e. undelayed
  for (int s = 0; s < MIX_SENDS_GRAPH; ++s) send_rueckweg(s, n);   // S6: fx/3, fx/4 returns, after the hall, before the master FX
#endif
  // 1.15 A5a (D8 b): the merge. Everything in sum_ so far (direct sources, hall return, send-graph returns) is delayed by L and the
  // buses (already delayed) are added, just before the master FX; the ear tap master_summe_l() reads after it.
  if (kanal_latenz_ > 0) {
#ifndef CYPHERDJ_MUTATION_LATENZ_MERGE_VOR_HALL   // error case: the sum is delayed before the hall return joins it (see the loop over the channels)
    if (!vor_leitung_endlich(sum_l_, sum_r_, n)) latenz_nan_ = true;
    summe_verz_.block(sum_l_, sum_r_, n, kanal_latenz_);
#endif
#ifndef CYPHERDJ_MUTATION_LATENZ_BUS_SUM_UEBERSPRUNGEN   // error case: bus_sum_ is not added, the buses never reach the master
    addiere(sum_l_, bus_sum_l_, n, 1.0f);
    addiere(sum_r_, bus_sum_r_, n, 1.0f);
#endif
  }
#ifdef CYPHERDJ_MUTATION_LATENZ_SEND_NACH_MERGE
  for (int s = 0; s < MIX_SENDS_GRAPH; ++s) send_rueckweg(s, n);
#endif
  master_graph(sum_l_, sum_r_, n);   // master insert graph: on the sum, after the latency merge, before the master FX
#ifdef CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT
  for (int u = FX_EINHEITEN - 1; u >= 0; --u)
#else
  for (int u = 0; u < FX_EINHEITEN; ++u)   // Master-Summe vor master/pegel, seriell FX1 vor FX2
#endif
    if (fx_master_[u].klingt()) fx_master_[u].block(sum_l_, sum_r_, n, fx_beat0_, fx_bps_);

#ifndef CYPHERDJ_MUTATION_LATENZ_METRO_OHNE   // error case: the metronome click is not delayed by L
  if (kanal_latenz_ > 0) {   // 1.15 A5a (D8 c): own delay of L
#ifndef CYPHERDJ_MUTATION_LATENZ_METRO_OHNE_PRUEFUNG   // error case: a NaN in the metronome input enters its line and comes out L samples later
    if (!vor_leitung_endlich(summe_ein_l_, summe_ein_r_, n)) latenz_nan_ = true;
#endif
    metro_verz_.block(summe_ein_l_, summe_ein_r_, n, kanal_latenz_);
  }
#endif
  addiere(sum_l_, summe_ein_l_, n, 1.0f);   // D1 K1: Metronom, Ziel master, vor Kleber und Limiter
  addiere(sum_r_, summe_ein_r_, n, 1.0f);
  addiere(pfl_l_, pfl_ein_l_, n, 1.0f);     // D1 K1: Metronom, Ziel cue
  addiere(pfl_r_, pfl_ein_r_, n, 1.0f);

  // Audit F01 (zweite Linie): ein NaN/Inf aus irgendeiner Quelle oder aus einem Zustand (SVF, Rückkopplung, Faust)
  // bliebe in den Filterzuständen und machte Master und Cue bis zum Neustart still. Ist die Summe oder PFL nicht
  // endlich: dieser Block still, alle Zustände leer, gezählt. Selten; das Leeren der Beat-FX-Leitungen ist dann teuer
  // (F45), aber ein Block Aufwand schlägt einen stillen Abend.
  {
    bool endlich = true;
    for (int i = 0; i < n; ++i)
      endlich = endlich && std::isfinite(sum_l_[i]) && std::isfinite(sum_r_[i]) && std::isfinite(pfl_l_[i]) &&
                std::isfinite(pfl_r_[i]);
    endlich = endlich && !latenz_nan_;   // 1.15 A5a: a bus strip was not finite (caught in front of its delay line)
    latenz_nan_ = false;
    if (!endlich) {
      std::memset(sum_l_, 0, b);
      std::memset(sum_r_, 0, b);
      std::memset(pfl_l_, 0, b);
      std::memset(pfl_r_, 0, b);
#ifndef CYPHERDJ_MUTATION_LATENZ_F01_OHNE_RINGE   // error case: impulses in flight in the delay lines survive the guard
      for (auto& v : bus_verz_) v.leeren();
      summe_verz_.leeren();
      metro_verz_.leeren();
#endif
#ifndef CYPHERDJ_MUTATION_LATENZ_F01_OHNE_PFL_RING   // error case: the cue goes on playing up to vh + L samples of old material while the master is silent
#ifdef CYPHERDJ_MUTATION_LATENZ_F01_PFL_RING_AUCH_L0   // error case: the PFL ring is cleared at L = 0 too (not bit-identical to before the account)
      {
#else
      if (kanal_latenz_ > 0) {   // at L = 0 the PFL ring stays as it was (bit-identical to before the account)
#endif
        std::memset(pfl_verz_, 0, sizeof pfl_verz_);
        pfl_verz_pos_ = 0;
      }
#endif
      for (auto& kz : kz_) kz->zustaende_leeren();
      for (auto& kp : komp_) kp->leeren();
#ifndef CYPHERDJ_MUTATION_LIM_F01_OHNE   // error case: the limiters keep their gain reduction through the reset
      for (int b = 0; b < MIX_BUSSE; ++b) lim_zuruecksetzen(b);   // 1.15 A5b
#endif
#ifndef CYPHERDJ_MUTATION_F01_OHNE_WERKZEUGE   // error case: a NaN stays in the IIR states of the utility
      for (auto& u : util_) if (u) u->leeren();    // 1.15 A3: a NaN may sit in an IIR state of the tools
#endif
#ifndef CYPHERDJ_MUTATION_F01_OHNE_GATE   // error case: the gate keeps its state through the reset (closed stays closed, the open one is not restarted)
      for (int k = 0; k < MIX_QUELLEN; ++k)
        if (gate_[k]) {
          gate_[k]->leeren();
          gate_lief_[k] = false;   // the next gate_block() restarts it OPEN, as after switching on
        }
#endif
#ifndef CYPHERDJ_MUTATION_MB_F01_OHNE   // error case: the multiband keeps its envelope and its fade through the reset
      for (int b = 0; b < MIX_BUSSE; ++b)
        if (mb_[b]) {   // 1.15 A4: a NaN may sit in the filter states; fresh state, the crossfade starts again (D7, 480 samples)
          mb_[b]->leeren();
#ifndef CYPHERDJ_MUTATION_MB_F01_NUR_ERSTES   // error case: only the first object is reset, the second one (when it is the active one) keeps its reduction
          mb2_[b]->leeren();
#endif
          mb_lief_[b] = false;
          mb_pos_[b] = 0;
          mb_gb_an_[b] = false;
          mb_gpos_[b] = 0;
          mb_gwarm_[b] = 0;
          mb_gwarm_ges_[b] = 0;
          mb_gbasis_[b] = 0;
        }
#endif
      hall_->leeren();
      hall_wach_ = false;
      hall_ruhe_ = 0;
      kleber_->leeren();
      kleber_lief_ = false;
      for (int u = 0; u < FX_EINHEITEN; ++u) {
        fx_master_[u].leeren();
        for (int i = 0; i < FX_ZIELE; ++i) fx_kanal_[u][i].leeren();
      }
      ++nan_treffer_;
    }
  }

  spek_master(n);   // 1.15 A7b: spectrum tap 19, the master sum (the level of the ear tap master_summe_l())

  // K2 Slice 3: Summen-Kompressor 2:1 ("Kleber") auf der Summe nach der Master-FX und dem Hall-Rückweg, vor master/pegel.
  // master/kleber a ist seine SCHWELLE: schwelle_db = 6 − 36·a auf dem Detektor |L|+|R| (a = 0: +60 dB, unerreichbar, auch bei heißer Summe: |L|+|R| reicht bis +12 dB; Faust
  // glättet die Schwelle mit si.smoo, ein Verlauf braucht keine Sample-Genauigkeit: es zählt sein Wert am Blockende).
  // Voll nass. sum_ selbst bleibt unangetastet: master_summe_l()/r() ist der Ohr-Abgriff (Kanal 14, „gleiche Stufe wie
  // ein Kanal bei Fader 0“) und sieht den Kleber nicht, sonst kippte das Hörschein-Urteil (±3 dB).
  // Nie eingeschaltet (a = 0, Kleber leer): übersprungen, master/pegel liest direkt sum_ (bitgleich, ohne Kopie;
  // test_mixer, test_limiter25). Ausschalten ohne Knack: bei a = 0 rechnet der Kleber mit Schwelle +60 weiter, bis über
  // einen ganzen Block |aus − ein| ≤ 1e-6·|ein| gilt (die Schwelle gleitet hoch, der Gain erholt sich über den Release);
  // erst dann wird er geleert und übersprungen. Auch bei Eingang exakt 0 wird er geleert (Subnormale: 6 statt 0,8 µs je
  // Block; der Ausgang ist dann exakt 0).
  const float a_kleber = master_kleber_.vl ? master_kleber_.vl[n - 1] : master_kleber_.w;
  const float* sl = sum_l_;
  const float* sr = sum_r_;
#ifdef CYPHERDJ_MUTATION_KLEBER_SOFORT_AUS
  const bool kleber_rechnet = a_kleber > 0.0f;   // Fehlerfall: bei 0 sofort überspringen (Gain-Stufe beim Handgriff)
#else
  const bool kleber_rechnet = a_kleber > 0.0f || kleber_lief_;
#endif
  if (kleber_rechnet) {
#ifndef CYPHERDJ_MUTATION_KLEBER_AUS
    kleber_->setze_schwelle(a_kleber > 0.0f ? 6.0f - 36.0f * a_kleber : KLEBER_AUS_DB);
    std::memcpy(nk_l_, sum_l_, b);
    std::memcpy(nk_r_, sum_r_, b);
    kleber_->block(nk_l_, nk_r_, n);
    float ein_max = 0.0f, diff = 0.0f;
    for (int i = 0; i < n; ++i) {
      ein_max = std::fmax(ein_max, std::fmax(std::fabs(sum_l_[i]), std::fabs(sum_r_[i])));
      diff = std::fmax(diff, std::fmax(std::fabs(nk_l_[i] - sum_l_[i]), std::fabs(nk_r_[i] - sum_r_[i])));
    }
    sl = nk_l_;
    sr = nk_r_;
    kleber_lief_ = true;
    if (ein_max == 0.0f || (a_kleber <= 0.0f && diff <= 1e-6f * ein_max)) {
      kleber_->leeren();
      kleber_lief_ = false;
    }
#ifdef CYPHERDJ_MUTATION_KLEBER_IN_SUMME
    std::memcpy(sum_l_, nk_l_, b);   // Fehlerfall der Review-Fixups: in place auf dem Ohr-Abgriff
    std::memcpy(sum_r_, nk_r_, b);
#endif
#endif
  }
  nk_pl_ = sl;
  nk_pr_ = sr;

  // Master: Summe nach Kleber · master/pegel
  if (const float* v = master_pegel_.vl) {
    for (int i = 0; i < n; ++i) {
      const float g = lin(v[i]);
      ml[i] = sl[i] * g;
      mr[i] = sr[i] * g;
    }
  } else {
    const float g = lin(master_pegel_.w);
    for (int i = 0; i < n; ++i) {
      ml[i] = sl[i] * g;
      mr[i] = sr[i] * g;
    }
  }
  // Voice channel (voice.h): music ducked, voice added, both in front of the master limiter, so the limiter ceiling holds
  // for the sum. Off (stimme_eingang 0, the default): skipped, the master stays bit-identical.
#ifdef CYPHERDJ_MUTATION_STIMME_IMMER_AN
  {   // error case: the voice path runs on input pair 4 even with stimme_eingang 0
#else
  if (stimme_.an()) {
#endif
    for (int i = 0; i < n; ++i) stimme_mg_[i] = lin(master_pegel_.vl ? master_pegel_.vl[i] : master_pegel_.w);
    stimme_.block(stimme_ein_l_, stimme_ein_r_, ml, mr, stimme_mg_, n);
  }
  // Master-Limiter (Scheibe 14) am Ende des Masters; dahinter der Prüfklick master mit master/pegel, wie vorher in der
  // Summe (bitgleich, solange nur er klingt: (0 + k)·g = k·g), aber ohne Vorhalt (F19)
#ifndef CYPHERDJ_MUTATION_OHNE_LIMITER
  limiter_->verarbeite(ml, mr, n);
  const int vh = limiter_->vorhalt_samples();
#else
  const int vh = 0;  // Fehlerfall der Abnahme: Master ohne Limiter
#endif
  for (int i = 0; i < n; ++i) {
    const float g = lin(master_pegel_.vl ? master_pegel_.vl[i] : master_pegel_.w);
    ml[i] += master_ein_l_[i] * g;
    mr[i] += master_ein_r_[i] * g;
  }
  // PFL um denselben Vorhalt verzögern (ADR 008 Punkt 3: der Cue hört den Master so, wie der Saal ihn hört)
#ifdef CYPHERDJ_MUTATION_LATENZ_PFL_OHNE_L   // error case: the cue is delayed by vh only, the master by vh + L
  const int pfl_verz = vh;
#else
  const int pfl_verz = vh + kanal_latenz_;   // 1.15 A5a (D8 d): the PFL delay is the master's, look-ahead plus latency account
#endif
  if (pfl_verz > 0) {
    const int cap = PFL_RING;
    for (int i = 0; i < n; ++i) {
      int lese = pfl_verz_pos_ - pfl_verz;
      if (lese < 0) lese += cap;
      const float l = pfl_verz_[0][lese], r = pfl_verz_[1][lese];
      pfl_verz_[0][pfl_verz_pos_] = pfl_l_[i];
      pfl_verz_[1][pfl_verz_pos_] = pfl_r_[i];
      pfl_l_[i] = l;
      pfl_r_[i] = r;
      if (++pfl_verz_pos_ == cap) pfl_verz_pos_ = 0;
    }
  }
  // Cue: PFL gegen Master (cue/mix), Split, cue/pegel
  for (int i = 0; i < n; ++i) {
    const float mix = cue_mix_.vl ? cue_mix_.vl[i] : cue_mix_.w;
    const float g_pfl = 0.5f * (1.0f - mix), g_main = 0.5f * (1.0f + mix);
    const float mc = (master_pfl_.vl ? master_pfl_.vl[i] : master_pfl_.w) >= 0.5f ? 1.0f : 0.0f;   // MASTER CUE
    float hl = (pfl_l_[i] + mc * ml[i]) * g_pfl + ml[i] * g_main;
    float hr = (pfl_r_[i] + mc * mr[i]) * g_pfl + mr[i] * g_main;
    if ((cue_split_.vl ? cue_split_.vl[i] : cue_split_.w) >= 0.5f) {
      const float kopf = 0.5f * (hl + hr);
      hr = 0.5f * (ml[i] + mr[i]);
      hl = kopf;
    }
    const float g = lin(cue_pegel_.vl ? cue_pegel_.vl[i] : cue_pegel_.w);
    cl[i] = hl * g;
    cr[i] = hr * g;
  }

  {  // /pegel: Spitzen von Master (wie im Ring) und Cue
    float sm = spitze_[PEGEL_MASTER], sc = spitze_[PEGEL_CUE];
    for (int i = 0; i < n; ++i) {
      sm = std::max(sm, std::max(std::fabs(ml[i]), std::fabs(mr[i])));
      sc = std::max(sc, std::max(std::fabs(cl[i]), std::fabs(cr[i])));
    }
    spitze_[PEGEL_MASTER] = sm;
    spitze_[PEGEL_CUE] = sc;
  }
  // Eingänge leeren, Werte mit Verlauf auf ihren letzten Wert setzen
  for (int k = 0; k < MIX_KANAELE; ++k) {
    std::memset(ein_l_[k], 0, b);
    std::memset(ein_r_[k], 0, b);
  }
  std::memset(master_ein_l_, 0, b);
  std::memset(summe_ein_l_, 0, b);   // D1 K1
  std::memset(summe_ein_r_, 0, b);
  std::memset(pfl_ein_l_, 0, b);
  std::memset(pfl_ein_r_, 0, b);
  std::memset(master_ein_r_, 0, b);
  std::memset(stimme_ein_l_, 0, b);
  std::memset(stimme_ein_r_, 0, b);
  auto nachfuehren = [n](Wert& w) {
    if (w.vl) {
      w.w = w.vl[n - 1];
      w.vl = nullptr;
    }
  };
  for (int k = 0; k < MIX_KANAELE; ++k) {
    nachfuehren(ziel_[k]);
    nachfuehren(xseite_[k]);
    nachfuehren(pfl_[k]);
  }
  nachfuehren(xfader_);
  nachfuehren(master_pegel_);
  nachfuehren(cue_mix_);
  nachfuehren(cue_pegel_);
  nachfuehren(cue_split_);
  nachfuehren(duck_tiefe_);
  nachfuehren(duck_release_);
  nachfuehren(master_kleber_);
  nachfuehren(master_pfl_);
  nachfuehren(color_art_);
  nachfuehren(color_param_);
  for (auto& kw : komp_w_)
    for (Wert& w : kw) nachfuehren(w);
#ifndef CYPHERDJ_MUTATION_WZ_OHNE_NACHFUEHREN   // error case: the mix-tool slots keep their course pointer and their old value
  for (auto& kw : wz_w_)    // 1.15 A3 (review obligation A1b): the mix-tool slots are carried on like the compressor's
    for (Wert& w : kw) nachfuehren(w);
  nachfuehren(wz_spektrum_kanal_);
#endif
  for (Wert& w : fx_rueck_) nachfuehren(w);
}

}  // namespace cdj
