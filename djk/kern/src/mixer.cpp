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
  auto ziel_l = [&](int z) { return z == 0 ? sum_l_ : ein_l_[MIX_QUELLEN + z - 1]; };
  auto ziel_r = [&](int z) { return z == 0 ? sum_r_ : ein_r_[MIX_QUELLEN + z - 1]; };
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

Mixer::~Mixer() {
  for (int k = 0; k < MIX_GRAPH_KANAELE; ++k) {
    cypher_bk_frei(bk_[k]);
    cypher_bk_frei(bk_alt_[k]);
  }
  for (int i = 0; i < n_bk_frei_; ++i) cypher_bk_frei(bk_frei_[i]);
}

void Mixer::bk_zur_freigabe(CypherBk* g) noexcept {
  if (!g) return;
  if (n_bk_frei_ < MIX_BK_FREI) bk_frei_[n_bk_frei_++] = g;
  else ++bk_verloren_;   // je Block geleert; lieber verlieren als im Callback freigeben
}

void Mixer::setze_kanal_graph(int k, CypherBk* g) noexcept {
  if (k < 0 || k >= MIX_GRAPH_KANAELE) { bk_zur_freigabe(g); return; }
  if (g == bk_[k]) return;
#ifndef CYPHERDJ_MUTATION_BK_KANAL_DOPPEL_ALT
  if (bk_blende_[k] == MIX_GRAPH_BLENDE) {
    // Der neue Weg hat noch kein Sample gerechnet (zweiter Wechsel vor demselben Block): er geht, der gehörte alte
    // Weg blendet weiter aus. Sonst würde der ungehörte Graph zum alten Weg und der gehörte bräche ohne Blende ab.
    bk_zur_freigabe(bk_[k]);
    bk_[k] = g;
    if (g == bk_alt_[k]) { bk_alt_[k] = nullptr; bk_blende_[k] = 0; }   // zurück auf den gehörten Weg
    return;
  }
#endif
  bk_zur_freigabe(bk_alt_[k]);   // D4: ein Wechsel in der Blende gibt den ältesten sofort frei
  bk_alt_[k] = bk_[k];           // null heißt: der alte Weg war trocken
  bk_[k] = g;
  bk_blende_[k] = MIX_GRAPH_BLENDE;
}

int Mixer::bk_frei(CypherBk** aus, int max) noexcept {
  const int n = std::min(n_bk_frei_, max);
  for (int i = 0; i < n; ++i) aus[i] = bk_frei_[i];
  for (int i = n; i < n_bk_frei_; ++i) bk_frei_[i - n] = bk_frei_[i];
  n_bk_frei_ -= n;
  return n;
}

// S5r: die Regler <kanal>/bk/1..8 an den Graphen des Kanals k melden (die FFI glättet). Nur der gehörte Graph bk_[k], nie bk_alt_.
// Ohne Werte-Zeiger (Tests ohne Kern) keine Meldung (K10).
void Mixer::bk_regler_melden(CypherBk* g, int k) noexcept {
#ifdef CYPHERDJ_MUTATION_BK_REGLER_NICHT_GEMELDET  // Fehlerfall S5r: der Kern meldet die Regler nie an den Graphen
  (void)g; (void)k;
  return;
#endif
  if (!bk_wert_ || !g || k < 0 || k >= MIX_KANAELE) return;
#ifdef CYPHERDJ_MUTATION_BK_REGLER_FALSCHER_KANAL  // Fehlerfall S5r: die Zeile des Nachbarkanals
  k = (k + 1) % MIX_KANAELE;
#endif
  for (int nr = 1; nr <= 8; ++nr) {
#ifdef CYPHERDJ_MUTATION_BK_REGLER_TAUSCH_05  // Fehlerfall S5r (D5): nur gemeldet, wenn sich der Wert ändert; ein getauschter Graph bleibt auf 0,5
    static float zuletzt[MIX_KANAELE][8];
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
  if (bk_[k]) {
    bk_regler_melden(bk_[k], k);
#ifndef CYPHERDJ_MUTATION_BK_KANAL_TAKT_AUS
    cypher_bk_takt(bk_[k], fx_beat0_, fx_bps_);
#endif
    cypher_bk_effekt(bk_[k], bk_ein_l_, bk_ein_r_, l, r, static_cast<size_t>(n));
  }
#ifdef CYPHERDJ_MUTATION_BK_KANAL_BLENDE_AUS
  bk_blende_[k] = 0;
#endif
  if (bk_blende_[k] > 0) {
    const float* al = bk_ein_l_;
    const float* ar = bk_ein_r_;
    if (bk_alt_[k]) {
#ifndef CYPHERDJ_MUTATION_BK_KANAL_TAKT_AUS
      cypher_bk_takt(bk_alt_[k], fx_beat0_, fx_bps_);
#endif
      cypher_bk_effekt(bk_alt_[k], bk_ein_l_, bk_ein_r_, bk_alt_l_, bk_alt_r_, static_cast<size_t>(n));
      al = bk_alt_l_;
      ar = bk_alt_r_;
    }
    for (int i = 0; i < n; ++i) {
      const int rest = bk_blende_[k] - i;
      const float w = rest > 0 ? static_cast<float>(rest) / MIX_GRAPH_BLENDE : 0.0f;   // Gewicht des alten Wegs
      l[i] = l[i] * (1.0f - w) + al[i] * w;
      r[i] = r[i] * (1.0f - w) + ar[i] * w;
    }
    bk_blende_[k] = std::max(0, bk_blende_[k] - n);
    if (bk_blende_[k] == 0) {
      bk_zur_freigabe(bk_alt_[k]);
      bk_alt_[k] = nullptr;
    }
  }
#ifndef CYPHERDJ_MUTATION_BK_KANAL_KLEMME_AUS
  for (int i = 0; i < n; ++i) {
    l[i] = std::isfinite(l[i]) ? std::clamp(l[i], -8.0f, 8.0f) : 0.0f;
    r[i] = std::isfinite(r[i]) ? std::clamp(r[i], -8.0f, 8.0f) : 0.0f;
  }
#endif
}

void Mixer::kanal(int k, int n) {
  // SOUND COLOR FX: globale Art und PARAMETER (Werte am Blockende wie duck/*), Echozeit aus dem Tempo der Uhr
  kz_[k]->setze_color(ganz(color_art_.w), color_param_.w, fx_bps_ > 0.0 ? 1.0 / fx_bps_ : 0.0);
#ifndef CYPHERDJ_MUTATION_NUR_CUE_AUS
  if (nur_cue_[k]) {   // S7 Vorhören: Kanalzug rechnen (Trim/EQ/Filter wirken auf den Abgriff), Abgriff in PFL, sonst nichts
    dsp::KanalzugAusgang aus;
    aus.haupt_l = aus_l_;
    aus.haupt_r = aus_r_;
    for (int s = 0; s < dsp::kAnzahlSends; ++s) { aus.send_l[s] = nullptr; aus.send_r[s] = nullptr; }   // kanalzug.cpp:117-119: nullptr = Send übersprungen
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
    return;   // kein route(): weder Master noch Bus; keine Spitze (Hüllen „nie belegt", kern_stellwerk.cpp:414)
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
  if (komp_an || bk_an || (fzi >= 0 && routing_ == ROUTING_INSERT)) {
    // Kompressor (2026-10-11), Baukasten-Graph (S3c, D3) und Insert-FX (Ohr T17) sitzen vor dem Fader auf dem Abgriff,
    // in dieser Reihenfolge; die Teilung vor/nach ist bitgleich zu verarbeite (test_kanalzug_teilung)
    kz_[k]->verarbeite_vor(ein_l_[k], ein_r_[k], n);
    if (komp_an) komp_block(k, n);
    if (bk_an) kanal_graph(k, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), n);
    if (fzi >= 0 && routing_ == ROUTING_INSERT) fx_kette(fzi, kz_[k]->abgriff_schreibbar(0), kz_[k]->abgriff_schreibbar(1), n);
    kz_[k]->verarbeite_nach(n, aus);
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
  if (k < 7 || k == 12 || k == 13) {  // /pegel: Spitze nach dem Fader, deck/1..4, erz/1..3 (Studio S1), pad/1..2 (MVP 2)
    float sp = spitze_[k];
    for (int i = 0; i < n; ++i) sp = std::max(sp, std::max(std::fabs(aus_l_[i]), std::fabs(aus_r_[i])));
    spitze_[k] = sp;
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
  fx_routing_fortschritt();    // Ohr T17: eine fertige Blende vollenden, bevor der erste Kanal rechnet
  std::memset(sum_l_, 0, b);   // Scheibe 25: der Master-Eingang (Prüfklick Z1) kommt erst hinter dem Limiter dazu
  std::memset(sum_r_, 0, b);
  std::memset(pfl_l_, 0, b);
  std::memset(pfl_r_, 0, b);
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
  for (int k = 0; k < MIX_QUELLEN; ++k) kanal(k, n);   // Quellen zuerst: sie füllen die Bus-Eingänge
  for (int k = MIX_QUELLEN; k < MIX_KANAELE; ++k) kanal(k, n);
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
#ifdef CYPHERDJ_MUTATION_FX_EINHEITEN_VERTAUSCHT
  for (int u = FX_EINHEITEN - 1; u >= 0; --u)
#else
  for (int u = 0; u < FX_EINHEITEN; ++u)   // Master-Summe vor master/pegel, seriell FX1 vor FX2
#endif
    if (fx_master_[u].klingt()) fx_master_[u].block(sum_l_, sum_r_, n, fx_beat0_, fx_bps_);

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
    if (!endlich) {
      std::memset(sum_l_, 0, b);
      std::memset(sum_r_, 0, b);
      std::memset(pfl_l_, 0, b);
      std::memset(pfl_r_, 0, b);
      for (auto& kz : kz_) kz->zustaende_leeren();
      for (auto& kp : komp_) kp->leeren();
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
  if (vh > 0) {
    const int cap = dsp::MasterLimiter::kMaxVorhalt + 1;
    for (int i = 0; i < n; ++i) {
      int lese = pfl_verz_pos_ - vh;
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
  for (Wert& w : fx_rueck_) nachfuehren(w);
}

}  // namespace cdj
