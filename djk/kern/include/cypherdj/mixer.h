// Mixer des Kerns als Zuweisungstabelle (SCHNITTSTELLEN.md §1.5, §1.6; ADR 008 Entscheidung 1 bis 3; A17; ARCHITEKTUR
// §13 Frage 5, Antwort „5 ok“: jeder Kanal auf den Master oder einen von vier Gruppenbussen, vier Sends je Kanal).
// Scheibe 25.
//
//   Quelle k (deck/1..4, erz/1..8, pad/1..2): Eingang → Kanalzug (cypherdj_dsp, Scheibe 04: Trim, LR8 mit Kill,
//   Filter, Abgriff, Fader, Sends) → Ziel aus <k>/ziel: 0 = Master mit dem Crossfader-Gewicht der Seite <k>/xseite,
//   1..4 = Eingang von bus/<n>. Ein Zielwechsel blendet über 10 ms (480 Samples, S-Kurve 3u² − 2u³).
//   Bus b (bus/1..4): Eingang (Summe seiner Quellen) → voller Kanalzug → Master mit dem Crossfader-Gewicht seiner Seite.
//   Sends 1..4 nach dem Fader in die Summen fx/1..4. Wirksam ist nur Send 2: fx/2 ist der Hall, fx/2/rueckweg führt ihn
//   in die Master-Summe (K2 Slice 2); die Rückwege fx/1, fx/3, fx/4 sind ohne Wirkung (Plugin-Wirte: Scheibe 8).
//   PFL: Abgriff nach Filter, vor dem Fader (ADR 008 Punkt 3) jedes Kanals mit <k>/pfl = 1 in die PFL-Summe.
//   Master: Summe + Master-Eingang (Prüfklick Z1, „in die Summe vor dem Limiter“) → master/pegel.
//   Cue: PFL · 0,5·(1 − cue/mix) + Master · 0,5·(1 + cue/mix); bei cue/split links (L+R)/2 davon, rechts (L+R)/2 des
//   Masters (Mixxx enginemixer.cpp Z. 394 f. und 830 bis 840, Dossier 04 §3.1); dann cue/pegel. Limiter mit Vorhalt
//   und derselbe Vorhalt im Cue kommen mit Scheibe 43.
//   Crossfader: Mixxx „additiv“ mit Exponent 1 (enginexfader.cpp, kTransformDefault): Seite A = 1 − max(0, x),
//   Seite B = 1 − max(0, −x), „durch“ = 1 (Dossier 04 §3.4).
//
// Werte kommen je Sample aus dem Stellwerk (Scheibe 11) über verlauf(); ohne Verlauf gilt der letzte Wert. Die Vorgaben
// nimmt der Mixer aus der Regler-Tabelle des Stellwerks (eine Quelle der Wahrheit für §1.5).
// Echtzeit: verlauf(), eingang_*(), master_eingang_*() und verarbeite() allokieren nicht, sperren nicht, werfen nicht.
// Konstruktor und setze_sofort() nur außerhalb des Callbacks (Start, Neustart-Zustand).
#pragma once

#include <cstdint>
#include <memory>

#include <cypherdj/dsp/kanalzug.h>
#include <cypherdj/dsp/master_limiter.h>

#include "cypherdj/beatfx.h"
#include "cypherdj/duck.h"
#include "cypherdj/hall.h"
#include "cypherdj/kleber.h"
#include "cypherdj/stellwerk/regler.h"

namespace cdj {

constexpr int MIX_QUELLEN = 14;                    // deck/1..4 (0..3), erz/1..8 (4..11), pad/1..2 (12, 13)
constexpr int MIX_BUSSE = 4;                       // bus/1..4 (14..17)
constexpr int MIX_KANAELE = MIX_QUELLEN + MIX_BUSSE;
constexpr int MIX_BLOCK = cypherdj::dsp::kMaxFrames;  // größter Block je verarbeite() (1024)
constexpr int HALL_RUHE_MAX = 1 << 20;             // Sättigung des Stillezählers im Hall (mixer.cpp)
constexpr float KLEBER_AUS_DB = 60.0f;                   // master/kleber = 0: Schwelle des Summen-Kompressors unerreichbar hoch
constexpr int MIX_ZIEL_BLENDE = 480;               // §1.5 <k>/ziel: 10-ms-Blende bei 48 kHz

// Was ein Regler des Stellwerks im Mixer bewirkt (die Zuweisungstabelle).
enum class MixRolle : uint8_t {
  ohne,       // nicht im Mixer: deck/<n>/transport (nur Halter)
  spaeter,    // gehört einer späteren Scheibe: stem/* (31), fx/* (47)
  kanalzug,   // Trim, EQ, Kill, Filter, Fader, Sends: der Kanalzug des Kanals
  ziel, xseite, pfl,                                     // je Kanal
  xfader, master_pegel, cue_mix, cue_pegel, cue_split,   // global
  duck_tiefe, duck_release,                              // K2 Sidechain: erz/2 und erz/3 unter dem Kick
  fx_rueckweg,                                           // K2 Slice 2: fx/<n>/rueckweg (nur fx/2 ist der Hall)
  master_kleber                                          // K2 Slice 3: Schwelle des Summen-Klebers
};

struct MixZuweisung {
  MixRolle rolle = MixRolle::ohne;
  int8_t kanal = -1;                                     // Kanal-Index 0..17 oder -1 (global)
  cypherdj::dsp::Regler regler = cypherdj::dsp::Regler::anzahl;  // nur bei MixRolle::kanalzug
  int8_t fx = -1;                                        // nur bei MixRolle::fx_rueckweg: 0..3 für fx/1..4
};

class Mixer {
 public:
  explicit Mixer(const cypherdj::stellwerk::ReglerTabelle& tab);

  static int kanal_index(const char* name);   // "deck/2" -> 1, "bus/1" -> 14, sonst -1
  static const char* kanal_name(int k);        // 0..17, sonst ""

  const MixZuweisung& zuweisung(int regler) const { return zuw_[regler]; }
  int regler_anzahl() const { return n_regler_; }

  // Ohne Rampe und ohne Blende (Neustart-Zustand): nicht im Callback.
  void setze_sofort(int regler, float wert);
  // Scheibe 25: Güte des DJ-Filters in allen 18 Kanalzügen (kern.toml filter_guete, A27 Weg a); NaN verworfen, sonst
  // auf 0,5 bis 8 geklemmt (DjFilter::setze_guete). Nicht im Callback.
  void setze_filter_guete(double q);
  // Verlauf je Sample für den nächsten verarbeite()-Aufruf (Stellwerk-Aenderung, gültig bis dahin).
  void verlauf(int regler, const float* werte);

  // Eingänge für den nächsten verarbeite()-Aufruf; verarbeite() leert sie danach wieder. Aufrufer addieren (+=).
  // K2: Kick-Ereignis → Duck auf erz/2, erz/3; versatz = Samples ab dem Anfang des nächsten verarbeite()
  void duck_ausloesen(int64_t versatz) { duck_.ausloesen(versatz); }
  float* eingang_l(int k) { return ein_l_[k]; }
  float* eingang_r(int k) { return ein_r_[k]; }
  float* master_eingang_l() { return master_ein_l_; }
  float* master_eingang_r() { return master_ein_r_; }

  // Ein Block, 1 <= n <= MIX_BLOCK. Schreibt Master und Cue (überschreibt die Ziele).
  void verarbeite(int n, float* master_l, float* master_r, float* cue_l, float* cue_r);

  const cypherdj::dsp::Kanalzug& kanalzug(int k) const { return *kz_[k]; }
  float wert(int regler) const;   // letzter Wert eines Mixer-Reglers (nicht Kanalzug): für Tests
  int ziel_ist(int k) const { return ziel_ist_[k]; }
  // Scheibe 25: Master-Limiter aus 14 am Ende des Masters (nach master/pegel), Decke limiter_dbtp (kern.toml §2.1).
  // Der Master ist um limiter_vorhalt() Samples verzögert; um genauso viel verzögert der Mixer die PFL-Summe, damit der
  // Cue den Master so hört wie der Saal (ADR 008 Punkt 3). Der Prüfklick master (Z1) geht am Limiter vorbei (F19).
  void setze_limiter_dbtp(double decke);   // nicht im Callback (legt den Limiter neu an)
  int limiter_vorhalt() const { return limiter_->vorhalt_samples(); }
  float limiter_absenkung_db() { return limiter_->groesste_absenkung_db(); }  // seit dem letzten Aufruf, <= 0
  // Scheibe 35 (Vorgriff aus 43, §5.6 /pegel): Abtast-Spitze in linear seit dem letzten Aufruf, je Deck nach dem Fader
  // (Kanal 0..3), master (PEGEL_MASTER, nach Limiter und Prüfklick, wie im Ring) und cue (PEGEL_CUE); setzt auf 0 zurück.
  static constexpr int PEGEL_MASTER = MIX_KANAELE, PEGEL_CUE = MIX_KANAELE + 1;
  float spitze_lesen(int k) { const float v = spitze_[k]; spitze_[k] = 0.0f; return v; }
  // AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten (einheit 0 = FX1, 1 = FX2). Je Einheit eine Instanz je zuweisbarem
  // Kanal (deck/1, deck/2, erz/1..3, pad/1, pad/2) und eine für die Master-Summe (kanal = FX_MASTER, vor master/pegel). Zuweisung ist unabhängig je Kanal und
  // Einheit, mehrere Kanäle dürfen an derselben Einheit hängen; an einem Kanal mit beiden Zuweisungen läuft FX1 vor
  // FX2 (seriell, wie an der S8). Nur param1 wirkt im DSP (an BeatFx::setze weitergereicht); param2/param3 werden
  // gespeichert und gemeldet, aber nicht verarbeitet (S8-Vertragskompatibilität).
  static constexpr int FX_EINHEITEN = 2;
  static constexpr int FX_ZIELE = 7;   // deck/1, deck/2, erz/1, erz/2, erz/3, pad/1, pad/2 (Studio S1)
  static constexpr int FX_ZIEL_KANAL[FX_ZIELE] = {0, 1, 4, 5, 6, 12, 13};
  static constexpr int FX_MASTER = -2, FX_KEIN = -1;
  static int fx_ziel_index(int kanal) noexcept;   // Mixer-Kanalindex -> 0..6, sonst -1
  void fx_einheit_setze(int einheit, int art, double beats, float wet, float param1, double param2, double param3,
                        bool an) noexcept;
  void fx_zuweisung_setze(int einheit, int kanal, bool an) noexcept;
  bool fx_zugewiesen(int einheit, int kanal) const noexcept;      // für Tests
  const BeatFx& beatfx(int einheit, int kanal) const noexcept;    // für Tests
  void fx_takt(double beat0, double bps) noexcept { fx_beat0_ = beat0; fx_bps_ = bps; }
  int hall_ruhe() const { return hall_ruhe_; }
  // Audit F01: Blöcke, in denen Summe oder PFL nicht endlich war (Zustände geleert, Block still)
  int64_t nan_treffer() const { return nan_treffer_; }           // Test: Stillezähler des Halls (nur wach gezählt, gesättigt)
  const float* fx_l(int s) const { return fx_l_[s]; }   // Send-Summe fx/1..4 des letzten Blocks (0..3)
  // Ohr (§6.2): Master-Summe des letzten Blocks vor master/pegel und Limiter (gleiche Stufe wie ein Kanal bei Fader 0).
  const float* master_summe_l() const { return sum_l_; }
  // K2 Slice 3: die Summe, die in master/pegel und Limiter geht: nach dem Kleber (Test). Der Ohr-Abgriff bleibt davor.
  const float* summe_nach_kleber_l() const { return nk_pl_; }
  const float* summe_nach_kleber_r() const { return nk_pr_; }
  const float* master_summe_r() const { return sum_r_; }
  // Ohr T17 (§4.10 /k/fx/routing): wo der Beat-FX in den Kanalzügen sitzt, für beide Einheiten und alle Kanäle.
  // POST_FADER (Vorgabe): nach dem Fader, PFL und Mess-Abgriff hören ihn nicht. INSERT: vor dem Fader (Kanalzug geteilt,
  // FX1 vor FX2 auf dem Abgriff), PFL und Hüllkurven-Ring hören ihn. Master-FX bleibt, wie er ist. Der Wechsel ist eine
  // Blende: alle Kanal-Einheiten gleiten Wet und Eingang auf 0 (BeatFx::pause), am Nullpunkt wird der Weg getauscht (die
  // Leitungen sind dann geleert) und sie gleiten zurück (BeatFx::weiter). fx_routing_setze am Blockanfang, nicht allokierend.
  static constexpr int ROUTING_POST_FADER = 0, ROUTING_INSERT = 1;
  void fx_routing_setze(int routing) noexcept;
  int fx_routing() const noexcept { return routing_; }              // der Weg, der gerade klingt
  int fx_routing_ziel() const noexcept { return routing_ziel_; }    // der gewünschte
  bool fx_routing_wechselt() const noexcept { return routing_wechsel_; }

 private:
  struct Wert {
    float w = 0.0f;
    const float* vl = nullptr;
  };
  Wert* wert_von(int regler);
  void kanal(int k, int n);
  void fx_kette(int fzi, float* l, float* r, int n) noexcept;   // FX1 vor FX2 seriell auf [n] Samples, in place
  void fx_routing_fortschritt() noexcept;                       // Blockanfang: Wechsel vollenden, wenn alle bei 0 sind
  void route(int k, int n, const float* l, const float* r);

  const cypherdj::stellwerk::ReglerTabelle& tab_;
  int n_regler_ = 0;
  MixZuweisung zuw_[cypherdj::stellwerk::MAX_REGLER];
  std::unique_ptr<cypherdj::dsp::Kanalzug> kz_[MIX_KANAELE];
  Wert ziel_[MIX_KANAELE], xseite_[MIX_KANAELE], pfl_[MIX_KANAELE];
  Wert xfader_, master_pegel_, cue_mix_, cue_pegel_, cue_split_, duck_tiefe_, duck_release_, master_kleber_;
  Duck duck_;
  Wert fx_rueck_[4];                                     // fx/1..4/rueckweg (dB); wirksam ist nur Index 1
  std::unique_ptr<Hall> hall_;                           // ~860 KB: im Konstruktor, nie im Callback
  float hall_l_[MIX_BLOCK] = {}, hall_r_[MIX_BLOCK] = {};
  int hall_ruhe_ = 0;                                    // Samples seit dem letzten Block mit Send-Signal
  bool hall_wach_ = false;                               // Hall rechnet erst, wenn ein Send ihn gespeist hat
  float duck_gain_[MIX_BLOCK] = {};
  std::unique_ptr<Kleber> kleber_;                       // K2 Slice 3: Summen-Kleber, im Konstruktor angelegt
  float nk_l_[MIX_BLOCK] = {}, nk_r_[MIX_BLOCK] = {};   // Summe nach Kleber (voll nass): ab hier master/pegel
  const float* nk_pl_ = sum_l_;                         // zeigt auf nk_l_, solange der Kleber rechnet, sonst auf sum_l_ (ohne Kopie)
  const float* nk_pr_ = sum_r_;
  bool kleber_lief_ = false;
  int64_t nan_treffer_ = 0;                              // Audit F01                             // hat seit dem letzten Leeren gerechnet
  int ziel_ist_[MIX_KANAELE] = {};
  int blende_von_[MIX_KANAELE] = {};
  int blende_rest_[MIX_KANAELE] = {};
  float ein_l_[MIX_KANAELE][MIX_BLOCK] = {};
  float ein_r_[MIX_KANAELE][MIX_BLOCK] = {};
  float master_ein_l_[MIX_BLOCK] = {}, master_ein_r_[MIX_BLOCK] = {};
  float fx_l_[cypherdj::dsp::kAnzahlSends][MIX_BLOCK] = {}, fx_r_[cypherdj::dsp::kAnzahlSends][MIX_BLOCK] = {};
  float sum_l_[MIX_BLOCK] = {}, sum_r_[MIX_BLOCK] = {};
  float pfl_l_[MIX_BLOCK] = {}, pfl_r_[MIX_BLOCK] = {};
  std::unique_ptr<cypherdj::dsp::MasterLimiter> limiter_;
  float pfl_verz_[2][cypherdj::dsp::MasterLimiter::kMaxVorhalt + 1] = {};  // PFL um den Vorhalt verzögert (Ring)
  int pfl_verz_pos_ = 0;
  float aus_l_[MIX_BLOCK] = {}, aus_r_[MIX_BLOCK] = {};
  float spitze_[MIX_KANAELE + 2] = {};
  BeatFx fx_kanal_[FX_EINHEITEN][FX_ZIELE];       // Leitungen im BeatFx-Konstruktor, nie im Callback angelegt
  BeatFx fx_master_[FX_EINHEITEN];                // die Summe vor master/pegel
  bool fx_zuw_[FX_EINHEITEN][FX_ZIELE] = {};
  bool fx_master_zuw_[FX_EINHEITEN] = {};
  int32_t fx_art_[FX_EINHEITEN] = {};
  double fx_beats_[FX_EINHEITEN] = {1.0, 1.0};
  float fx_wet_[FX_EINHEITEN] = {};
  float fx_param1_[FX_EINHEITEN] = {0.5f, 0.5f};
  double fx_param2_[FX_EINHEITEN] = {0.5, 0.5}, fx_param3_[FX_EINHEITEN] = {0.5, 0.5};   // reserviert, ungenutzt
  bool fx_an_[FX_EINHEITEN] = {};
  double fx_beat0_ = 0.0, fx_bps_ = 128.0 / 60.0 / 48000.0;
  int routing_ = ROUTING_POST_FADER, routing_ziel_ = ROUTING_POST_FADER;   // Ohr T17
  bool routing_wechsel_ = false;                                            // Blende läuft (Einheiten pausiert)
};

// Crossfader-Gewicht einer Seite (xseite 0 = A, 1 = durch, 2 = B) bei Stellung x in −1..+1 (Mixxx additiv, Exponent 1).
inline float seitengewicht(int xseite, float x) {
  if (xseite == 0) return x > 0.0f ? 1.0f - x : 1.0f;
  if (xseite == 2) return x < 0.0f ? 1.0f + x : 1.0f;
  return 1.0f;
}

}  // namespace cdj
