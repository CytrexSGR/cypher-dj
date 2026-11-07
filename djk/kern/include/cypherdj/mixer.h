// Mixer des Kerns als Zuweisungstabelle (INTERFACES.md §1.5, §1.6; ADR 008 Entscheidung 1 bis 3; A17; ARCHITECTURE
// §13 Frage 5, Antwort „5 ok“: jeder Kanal auf den Master oder einen von vier Gruppenbussen, vier Sends je Kanal).
// Scheibe 25.
//
//   Quelle k (deck/1..4, erz/1..8, pad/1..2): Eingang → Kanalzug (cypherdj_dsp, Scheibe 04: Trim, LR8 mit Kill,
//   Filter, Abgriff, Fader, Sends) → Ziel aus <k>/ziel: 0 = Master mit dem Crossfader-Gewicht der Seite <k>/xseite,
//   1..4 = Eingang von bus/<n>. Ein Zielwechsel blendet über 10 ms (480 Samples, S-Kurve 3u² − 2u³).
//   Bus b (bus/1..4): Eingang (Summe seiner Quellen) → voller Kanalzug → Master mit dem Crossfader-Gewicht seiner Seite.
//   Sends 1..4 nach dem Fader in die Summen fx/1..4. Wirksam sind Send 2 and the sends with a graph: fx/2 ist der Hall,
//   fx/2/rueckweg führt ihn in die Master-Summe (K2 Slice 2); an effect graph on fx/3 or fx/4 (S6, setze_send_graph) processes
//   that bus and its output joins the master sum scaled by fx/3/rueckweg, fx/4/rueckweg; fx/1 hat keine Wirkung.
//   PFL: Abgriff nach Filter, vor dem Fader (ADR 008 Punkt 3) jedes Kanals mit <k>/pfl = 1 in die PFL-Summe.
//   Master: Summe + Master-Eingang (Prüfklick Z1, „in die Summe vor dem Limiter“) → master/pegel.
//   Cue: (PFL + master/pfl · Master) · 0,5·(1 − cue/mix) + Master · 0,5·(1 + cue/mix); bei cue/split links (L+R)/2 davon, rechts (L+R)/2 des
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

#include "cypherdj/komp.h"
#include <cstdint>
#include <memory>
#include <atomic>

#include <cypherdj/dsp/gate.h>
#include <cypherdj/dsp/kanal_limiter.h>
#include <cypherdj/dsp/multiband.h>
#include <cypherdj/dsp/spektrum.h>
#include <cypherdj/dsp/kanalzug.h>
#include <cypherdj/dsp/master_limiter.h>
#include <cypherdj/dsp/utility.h>

#include "cypherdj/beatfx.h"
#include "cypherdj/duck.h"
#include "cypherdj/hall.h"
#include "cypherdj/kleber.h"
#include "cypherdj/mixer_werkzeug.h"
#include "cypherdj/stimme.h"
#include "cypherdj/stellwerk/regler.h"

struct CypherBk;

namespace cdj {

constexpr int MIX_QUELLEN = 14;                    // deck/1..4 (0..3), erz/1..8 (4..11), pad/1..2 (12, 13)
constexpr int MIX_BUSSE = 4;                       // bus/1..4 (14..17)
constexpr int MIX_KANAELE = MIX_QUELLEN + MIX_BUSSE;
constexpr int MIX_BK_SEND_ZEILE = MIX_KANAELE;       // S14: knob matrix row of fx/3 (fx/4 = +1), after the 18 mixer channels
constexpr int MIX_BK_ZEILEN = MIX_KANAELE + 2;       // S14: rows of the knob matrix bk_wert_ (kern.h): 18 channels + fx/3 + fx/4
constexpr int MIX_BLOCK = cypherdj::dsp::kMaxFrames;  // größter Block je verarbeite() (1024)
constexpr int HALL_RUHE_MAX = 1 << 20;             // Sättigung des Stillezählers im Hall (mixer.cpp)
constexpr float KLEBER_AUS_DB = 60.0f;                   // master/kleber = 0: Schwelle des Summen-Kompressors unerreichbar hoch
constexpr int MIX_ZIEL_BLENDE = 480;               // §1.5 <k>/ziel: 10-ms-Blende bei 48 kHz
// Plan Mediathek-Browser S7: der Vorhör-Eingang des Browsers (djk/vorhoerer → rueck_erz_8_L/R). Nur-Cue: PFL fest an,
// kein Weg in Master, Bus, Sends oder Beat-FX — unabhängig von Fader, Ziel und Sends (Andreas' Bedingung: nie auf den Master).
constexpr const char* VORHOER_KANAL = "erz/8";
// D1 K1 (Spec 2.3): erz/4 ist für die Produktion reserviert; das Modul Arrangement speist die Summe seiner Spuren hier ein.
constexpr const char* ARR_KANAL = "erz/4";

// Was ein Regler des Stellwerks im Mixer bewirkt (die Zuweisungstabelle).
enum class MixRolle : uint8_t {
  ohne,       // nicht im Mixer: deck/<n>/transport (nur Halter)
  spaeter,    // gehört einer späteren Scheibe: stem/* (31), fx/* (47)
  kanalzug,   // Trim, EQ, Kill, Filter, Fader, Sends: der Kanalzug des Kanals
  ziel, xseite, pfl,                                     // je Kanal
  xfader, master_pegel, cue_mix, cue_pegel, cue_split,   // global
  duck_tiefe, duck_release,                              // K2 Sidechain: erz/2 und erz/3 unter dem Kick
  fx_rueckweg,                                           // K2 Slice 2: fx/<n>/rueckweg (nur fx/2 ist der Hall)
  master_kleber,                                         // K2 Slice 3: Schwelle des Summen-Klebers
  master_pfl,                                            // MASTER CUE: Master auf die PFL-Seite des Cue
  color_art, color_param,                                // SOUND COLOR FX (2026-10-11): Art und PARAMETER, global wie am XZ
  komp,                                                  // Kompressor je Quellkanal (2026-10-11): <k>/komp/<feld>
  werkzeug                                               // 1.15 A1b: mix-tool rows (gate, utility, multiband, limiter, spectrum source), slots only
};

struct MixZuweisung {
  MixRolle rolle = MixRolle::ohne;
  int8_t kanal = -1;                                     // Kanal-Index 0..17 oder -1 (global)
  cypherdj::dsp::Regler regler = cypherdj::dsp::Regler::anzahl;  // nur bei MixRolle::kanalzug
  int8_t fx = -1;                                        // nur bei MixRolle::fx_rueckweg: 0..3 für fx/1..4
  int8_t feld = -1;                                      // MixRolle::komp: 0 an, 1 schwelle … 6 mix, 7 sc; MixRolle::werkzeug: field inside the tool
  MixWerkzeug werkzeug = MixWerkzeug::gate;               // only for MixRolle::werkzeug: the tool, feld is the field inside the tool
};

class Mixer {
 public:
  explicit Mixer(const cypherdj::stellwerk::ReglerTabelle& tab);
  // Baukasten S3c: Effekt-Graph als Insert im Kanalzug von deck/1..4 (Index 0..3), nach dem Kompressor, vor dem
  // Beat-FX-Insert. Nur im Callback (Stellwerk) setzen. g null entfernt. Jeder Wechsel blendet MIX_GRAPH_BLENDE Samples
  // linear vom alten Weg (alter Graph oder trocken) auf den neuen; ein Wechsel in der Blende gibt den ältesten sofort
  // frei. Ein k außerhalb geht sofort in die Freigabe. Abgelöste Graphen holt der Kern mit bk_frei ab (Netz-Faden gibt frei).
  static constexpr int MIX_GRAPH_KANAELE = 4, MIX_GRAPH_BLENDE = 480, MIX_BK_FREI = 8;
  void setze_kanal_graph(int k, CypherBk* g) noexcept;
  // S6: effect graph on a send return. s = bus index (2 = fx/3, 3 = fx/4); any other s goes straight to the free list.
  void setze_send_graph(int s, CypherBk* g) noexcept;
  int bk_frei(CypherBk** aus, int max) noexcept;
  // S5r: Werte der Graph-Regler <kanal>/bk/1..8 (Zeile = Mixer-Kanal), vom Kern geführt; nullptr: keine Meldung (K10).
  // S14: the matrix has MIX_BK_ZEILEN rows: 0..17 the mixer channels, MIX_BK_SEND_ZEILE + s the send returns (fx/3, fx/4).
  void setze_bk_wert(const float (*w)[8]) noexcept { bk_wert_ = w; }
  uint32_t bk_verloren() const noexcept { return bk_verloren_; }
  ~Mixer();

  static int kanal_index(const char* name);   // "deck/2" -> 1, "bus/1" -> 14, sonst -1
  static const char* kanal_name(int k);        // 0..17, sonst ""

  const MixZuweisung& zuweisung(int regler) const { return zuw_[regler]; }
  int regler_anzahl() const { return n_regler_; }

  // Ohne Rampe und ohne Blende (Neustart-Zustand): nicht im Callback.
  void setze_sofort(int regler, float wert);
  // Scheibe 25: Güte des DJ-Filters in allen 18 Kanalzügen (kern.toml filter_guete, A27 Weg a); NaN verworfen, sonst
  // auf 0,5 bis 8 geklemmt (DjFilter::setze_guete). Nicht im Callback.
  void setze_filter_guete(double q);
  // Sleep state of silent strips (all 18, kanal()): a strip whose input block is exact zeros and whose every state holder is idle
  // skips its DSP and its route, bit-equal to running it (see Mixer::schlaf_schritt). setze_schlaf(false) is the reference switch
  // (default on; a plain flag the callback thread reads, set between blocks, not during one). schlaeft(k): strip k slept in its last
  // block. schlaf_bloecke(): strip-blocks skipped so far. schlaeft_[] is written and read by the callback thread only (like komp_aktiv);
  // schlaeft() is for that thread and for tests that drive verarbeite() themselves.
  void setze_schlaf(bool an) { schlaf_an_ = an; }
  bool schlaeft(int k) const { return k >= 0 && k < MIX_KANAELE && schlaeft_[k]; }
  uint64_t schlaf_bloecke() const { return schlaf_bloecke_.load(std::memory_order_relaxed); }
  // Absenkung des Kompressors von Quellkanal k (0..13) in dB, 0 wenn aus. Aus jedem Faden lesbar.
  // Läuft der Kompressor von Quellkanal k (komp/an 1 im letzten Block)? Nur im Callback-Faden lesen.
  bool komp_aktiv(int k) const { return k >= 0 && k < MIX_QUELLEN && komp_lief_[k]; }
  float komp_gr_db(int k) const { return (k >= 0 && k < MIX_QUELLEN) ? komp_gr_[k].load(std::memory_order_relaxed) : 0.0f; }
  // 1.15 A3: is the gate / utility object of channel k in use (called in the last block)? Callback thread only. False means the
  // channel runs the old path and the object is reset.
  bool gate_aktiv(int k) const { return k >= 0 && k < MIX_QUELLEN && gate_lief_[k]; }
  bool util_aktiv(int k) const { return k >= 0 && k < MIX_KANAELE && util_lief_[k]; }
  // 1.15 A4: multiband compressor of bus k (14..17). mb_objekt: the object exists (created in the constructor, buses only); mb_objekte: how
  // many exist; mb_aktiv: it ran in the last block; mb_blende: position of the 480-sample switching crossfade, 0 = dry, 480 = fully in.
  bool mb_objekt(int k) const { return k >= MIX_QUELLEN && k < MIX_KANAELE && mb_[k - MIX_QUELLEN]; }
  int mb_objekte() const {
    int n = 0;
    for (const auto& m : mb_) n += m != nullptr;
    for (const auto& m : mb2_) n += m != nullptr;
    return n;
  }
  bool mb_aktiv(int k) const { return k >= MIX_QUELLEN && k < MIX_KANAELE && mb_lief_[k - MIX_QUELLEN]; }
  // Crossover change by crossfade: a second object per bus (made in the constructor) takes the new crossovers and the dynamics of the active
  // one, both run on the same tap, and the output moves over 480 samples (S-curve). mb_grenze_*: the crossovers of the active object;
  // mb_blenden: crossfades started since the object was made; mb_grenzblende: one is running.
  double mb_grenze_tief_hz(int k) const { return mb_objekt(k) ? mb_akt(k - MIX_QUELLEN)->grenze_tief_hz() : 0.0; }
  double mb_grenze_hoch_hz(int k) const { return mb_objekt(k) ? mb_akt(k - MIX_QUELLEN)->grenze_hoch_hz() : 0.0; }
  unsigned mb_blenden(int k) const { return (k >= MIX_QUELLEN && k < MIX_KANAELE) ? mb_blenden_[k - MIX_QUELLEN] : 0u; }
  bool mb_grenzblende(int k) const { return k >= MIX_QUELLEN && k < MIX_KANAELE && mb_gb_an_[k - MIX_QUELLEN]; }
  // Automatic make-up of the multiband bands (dsp::MbBandEinstellung::aufholen_auto). On by default and not a controller row: a compressed band
  // keeps its level. Tests switch it off to read the reduction from the output level (the make-up would cancel it); call before the blocks run.
  void mb_ausgleich_automatisch(bool an) { mb_auto_ = an; }
  int mb_blende(int k) const { return (k >= MIX_QUELLEN && k < MIX_KANAELE) ? mb_pos_[k - MIX_QUELLEN] : 0; }
  // Test: does the slot of this controller still hold a per-sample course (set by verlauf(), cleared at the end of verarbeite())?
  bool verlauf_offen(int regler) const {
    const Wert* w = const_cast<Mixer*>(this)->wert_von(regler);
    return w && w->vl;
  }
  // Verlauf je Sample für den nächsten verarbeite()-Aufruf (Stellwerk-Aenderung, gültig bis dahin).
  void verlauf(int regler, const float* werte);

  // Eingänge für den nächsten verarbeite()-Aufruf; verarbeite() leert sie danach wieder. Aufrufer addieren (+=).
  // K2: Kick-Ereignis → Duck auf erz/2, erz/3; versatz = Samples ab dem Anfang des nächsten verarbeite()
  void duck_ausloesen(int64_t versatz) { duck_.ausloesen(versatz); }
  float* eingang_l(int k) { return ein_l_[k]; }
  float* eingang_r(int k) { return ein_r_[k]; }
  float* master_eingang_l() { return master_ein_l_; }
  float* master_eingang_r() { return master_ein_r_; }
  // D1 K1 (Spec 2.6): Eingänge des Metronoms. summe_eingang_*: in die Master-Summe nach der Master-FX, VOR Kleber,
  // master/pegel und Limiter (der Prüfklick master_eingang_* liegt dahinter). pfl_eingang_*: in die PFL-Summe vor ihrer
  // Verzögerung um den Limiter-Vorhalt, so hört der Cue den Klick zeitgleich mit dem Master. verarbeite() leert beide.
  float* summe_eingang_l() { return summe_ein_l_; }
  float* summe_eingang_r() { return summe_ein_r_; }
  float* pfl_eingang_l() { return pfl_ein_l_; }
  float* pfl_eingang_r() { return pfl_ein_r_; }
  // Voice channel (stimme.h): set before the first block (not in the callback). With eingang 0 (the default) the master
  // is bit-identical to a kern without it. stimme_eingang_*: the voice of the next verarbeite(), the kern copies the
  // input pair ein_<eingang> into it; verarbeite() clears it.
  void stimme_einstellen(const StimmEinstellung& e) { stimme_.einstellen(e); }
  const StimmDucker& stimme() const { return stimme_; }
  float* stimme_eingang_l() { return stimme_ein_l_; }
  float* stimme_eingang_r() { return stimme_ein_r_; }

  // Ein Block, 1 <= n <= MIX_BLOCK. Schreibt Master und Cue (überschreibt die Ziele).
  void verarbeite(int n, float* master_l, float* master_r, float* cue_l, float* cue_r);

  const cypherdj::dsp::Kanalzug& kanalzug(int k) const { return *kz_[k]; }
  float wert(int regler) const;   // letzter Wert eines Mixer-Reglers (nicht Kanalzug): für Tests
  int ziel_ist(int k) const { return ziel_ist_[k]; }
  void setze_nur_cue(int k) { if (k >= 0 && k < MIX_QUELLEN) nur_cue_[k] = true; }   // nicht im Callback
  bool nur_cue(int k) const { return k >= 0 && k < MIX_QUELLEN && nur_cue_[k]; }
  // Scheibe 25: Master-Limiter aus 14 am Ende des Masters (nach master/pegel), Decke limiter_dbtp (kern.toml §2.1).
  // Der Master ist um limiter_vorhalt() Samples verzögert; um genauso viel verzögert der Mixer die PFL-Summe, damit der
  // Cue den Master so hört wie der Saal (ADR 008 Punkt 3). Der Prüfklick master (Z1) geht am Limiter vorbei (F19).
  void setze_limiter_dbtp(double decke);   // nicht im Callback (legt den Limiter neu an)
  int limiter_vorhalt() const { return limiter_->vorhalt_samples(); }
  // 1.15 A5a (D8): the latency account. L = look-ahead of the four bus limiters in samples (0 = no limiter built, the old paths and
  // bit-identical output). With L > 0 every master-bound path is delayed by exactly L once: each bus by a stereo delay after its strip, the
  // sum of the direct sources, the hall return and the send-graph returns by one delay before the master FX (the buses are added behind it),
  // the metronome by its own delay, and the PFL by vh + L. ONLY WHILE THE CALLBACK IS STOPPED / BEFORE THE FIRST BLOCK (it is not real-time safe: a
  // change clears all delay lines and the PFL ring, which is an audible gap of up to vh + L). Clamped to 0..kMaxLatenz. The same value again is a no-op
  // (nothing is cleared, the audio goes on bit for bit).
  // Documented residuals: a bus's own sends are taken before its delay (they still arrive aligned with its dry part, the hall return is in
  // the delayed sum) and the test click master_eingang_* (behind the limiter by design) is now L samples earlier than any other path.
  static constexpr int KANAL_LATENZ_MAX = cypherdj::dsp::KanalLimiter::kMaxLatenz;
  void setze_kanal_latenz(int samples);
  int kanal_latenz() const { return kanal_latenz_; }
  static constexpr int pfl_ring_groesse() { return PFL_RING; }   // test: the ring is sized for the worst case kMaxVorhalt + 1 + kMaxLatenz
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
  const float* fx_r(int s) const { return fx_r_[s]; }   // right channel of the same send sums (S6 test)
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
  // 1.15 A5b: the channel limiter on bus/1..4. vorhalt_ms 0 (the default, kern.toml kanal_limiter_vorhalt_ms) builds nothing: L = 0, the
  // bit-identical old paths, the lim/* rows do nothing. 0.1 .. 20 builds the four KanalLimiter objects here (never in the callback) and sets the
  // latency account to their latency_samples() (+ 12 with echtspitze): the buses then run through the limiter (lim/an 1) or an equal-latency
  // delay (lim/an 0), crossfading between the two over 480 samples (D7). ONLY WHILE THE CALLBACK IS STOPPED / BEFORE THE FIRST BLOCK, like
  // setze_kanal_latenz (a changed latency clears the lines and the PFL ring).
  void setze_kanal_limiter(double vorhalt_ms, bool echtspitze);
  bool kanal_limiter_gebaut() const { return lim_[0] != nullptr; }
  // Gain reduction of the limiter of bus 0..3 (= bus/1..4) over the last block, positive dB. 0 when no limiter is built, lim/an is 0, or the bus
  // is out of range (no indexing). Callable from another thread (a relaxed atomic).
  float kanal_limiter_reduktion_db(int bus) const;
  // 1.15 A5c: is the limiter of channel k (a bus, 14..17) in use, i.e. built and it ran in the last block (lim/an on, or its crossfade out still open)?
  // Callback thread only, like gate_aktiv / mb_aktiv. Range rule: k outside the buses gives false before the bus index is computed (no indexing).
  bool kanal_limiter_aktiv(int k) const { return k >= MIX_QUELLEN && k < MIX_KANAELE && lim_[k - MIX_QUELLEN] != nullptr && lim_lief_[k - MIX_QUELLEN]; }

  // 1.15 A6: gain-reduction meters for /zustand/mix (D10). Positive dB (>= 0), 0 when the tool is off or not running. Callback thread only
  // (they read the DSP objects the same thread just ran, like komp_aktiv). Range contract: an index outside the tool's own range gives 0
  // and reads nothing.
  float gate_reduktion_db(int k) const {   // source channels 0..13 with a gate object (erz/8 has none); the gate must have run in the last block
#if defined(CYPHERDJ_MUTATION_MIX_GATE_OHNE_GUARD)   // error case: no range check (an out-of-bounds read for k >= 14; shown under CYPHERDJ_SANITIZE)
    if (!gate_lief_[k] || !gate_[k]) return 0.0f;
#elif defined(CYPHERDJ_MUTATION_MIX_GATE_OBERKANTE)   // error case: off by one at the upper edge (pad/2 reads 0)
    if (k < 0 || k >= MIX_QUELLEN - 1 || !gate_lief_[k] || !gate_[k]) return 0.0f;
#elif defined(CYPHERDJ_MUTATION_MIX_GATE_OHNE_LIEF)   // error case: the gate counts as reading although it does not run
    if (k < 0 || k >= MIX_QUELLEN || !gate_[k]) return 0.0f;
#else
    if (k < 0 || k >= MIX_QUELLEN || !gate_lief_[k] || !gate_[k]) return 0.0f;
#endif
    const float g = gate_[k]->gain_db();   // <= 0, kStummDb (-200) when closed completely
#ifdef CYPHERDJ_MUTATION_MIX_GATE_VORZEICHEN   // error case: negative reduction
    return g;
#else
    return g < 0.0f ? -g : 0.0f;   // NaN fails the comparison: 0
#endif
  }
  float mb_reduktion_db(int bus, int band) const {   // bus 0..3 (= channel 14..17), band 0..2 = low / mid / high
#ifdef CYPHERDJ_MUTATION_MIX_MB_OHNE_GUARD   // error case: no range check on bus and band (out-of-bounds reads; shown under CYPHERDJ_SANITIZE)
    if (!mb_lief_[bus] || !mb_akt(bus)) return 0.0f;
#elif defined(CYPHERDJ_MUTATION_MIX_MB_OBERKANTE)   // error case: off by one at the upper edge (bus/4 reads 0)
    if (bus < 0 || bus >= MIX_BUSSE - 1 || band < 0 || band > 2 || !mb_lief_[bus] || !mb_akt(bus)) return 0.0f;
#else
    if (bus < 0 || bus >= MIX_BUSSE || band < 0 || band > 2 || !mb_lief_[bus] || !mb_akt(bus)) return 0.0f;
#endif
#ifdef CYPHERDJ_MUTATION_MIX_MB_BAND_VERSCHOBEN   // error case: the band index is one too high (mid reads high)
    const int bb = band == 2 ? 2 : band + 1;
#else
    const int bb = band;
#endif
    const float g = mb_akt(bus)->aktuelle_absenkung_db(static_cast<cypherdj::dsp::Band>(bb));   // <= 0, a bypassed band shows 0
    return g < 0.0f ? -g : 0.0f;   // NaN fails the comparison: 0
  }

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
  Wert xfader_, master_pegel_, cue_mix_, cue_pegel_, cue_split_, duck_tiefe_, duck_release_, master_kleber_, master_pfl_;
  Wert color_art_, color_param_;   // SOUND COLOR FX: je Block in jeden Kanalzug (Art je Kanal wäre ein Regler je Kanal)
  Duck duck_;
  Wert fx_rueck_[4];                                     // fx/1..4/rueckweg (dB); effective: index 1 (hall), 2 and 3 (send graphs, S6)
  std::unique_ptr<Hall> hall_;                           // Cypher Hall: im Konstruktor angelegt, nie im Callback
  // Kompressor je Quellkanal (Plan 2026-10-11-effekt-sektion.md): zwischen verarbeite_vor und verarbeite_nach
  static constexpr int KOMP_FELDER = 8;                  // an, schwelle, ratio, attack, release, makeup, mix, sc
  std::unique_ptr<Komp> komp_[MIX_QUELLEN];              // im Konstruktor angelegt, nie im Callback
  Wert komp_w_[MIX_QUELLEN][KOMP_FELDER];
  // 1.15 A1b: slots of the mix-tool controllers (value and per-sample course like the compressor's); A3 reads the gate and utility
  // fields, the multiband and limiter fields follow with their tasks. [channel][wz_versatz(tool) + field], and the one global spectrum source.
  Wert wz_w_[MIX_KANAELE][WZ_FELDER_JE_KANAL];
  Wert wz_spektrum_kanal_;
  // 1.15 A3: gate (13 live source channels) and utility (those plus the 4 buses); an object exists only where the table has rows
  // for it, created in the constructor, never in the callback. *_lief_: the object ran in the last block and has not
  // been reset since (the bypass is "not called", with leeren() on the way back, D6).
  std::unique_ptr<cypherdj::dsp::Gate> gate_[MIX_QUELLEN];
  std::unique_ptr<cypherdj::dsp::Utility> util_[MIX_KANAELE];
  bool gate_lief_[MIX_QUELLEN] = {}, util_lief_[MIX_KANAELE] = {};
  float wz_wert(int k, int pos, int n) const;   // slot [k][pos] as the compressor reads it: w, or vl[n - 1] with a course
  bool util_gefordert(int k, int n, cypherdj::dsp::UtilityParameter& p) const;   // parameters from the slots; true if not all neutral
  void gate_block(int k, int n);
  // 1.15 A4: multiband compressor on the four buses; objects created in the constructor, never in the callback. mb_lief_: it ran in the last
  // block and has not been reset since; mb_pos_: position of the switching crossfade (0 = dry, MB_BLENDE = fully in). mb_gt_/mb_gh_: the
  // crossovers last handed to the object (coefficients are recomputed only on a change).
  static constexpr int MB_BLENDE_SAMPLES = 480;
  std::unique_ptr<cypherdj::dsp::MultibandKompressor> mb_[MIX_BUSSE], mb2_[MIX_BUSSE];   // mb2_: the second object for the crossover crossfade
  bool mb_wahl_[MIX_BUSSE] = {};         // which of the two is the active one: false mb_, true mb2_
  bool mb_gb_an_[MIX_BUSSE] = {};        // a crossover crossfade is running
  int mb_gpos_[MIX_BUSSE] = {};          // its position, 0..MB_BLENDE_SAMPLES
  int mb_gwarm_[MIX_BUSSE] = {};         // samples left of the warm-up: the new object runs on the live input with empty filters, unheard
  bool mb_gdyn_[MIX_BUSSE] = {};         // the dynamics of the active object were handed over (once, when the warm-up is over)
  static constexpr int MB_WARM_SAMPLES = 960;   // 20 ms: an empty Linkwitz-Riley 8 at 100 Hz has settled to about 1 percent
  static constexpr int MB_WARM_REST = 240;      // 5 ms: the least warm-up left after a small new target during the warm-up (turning a knob)
  static constexpr int MB_WARM_VERLAENGERUNG = 240;   // 5 ms above 100 Hz (25 ms = 1200 samples at 20 Hz, scaled like the warm-up): how far a warm-up may be extended beyond its base length by small targets
  static constexpr int MB_WARM_MAX = 4800;      // 100 ms: cap of the base warm-up for deep crossovers
  static constexpr float MB_WARM_SPRUNG = 0.10f; // a new target within this relative step of the lower crossover goes into the warming-up object in place
  static constexpr float MB_WARM_HZ = 100.0f;   // below this the warm-up grows as 1 / f
  static int mb_warm(float gt, float gh, int basis);
  int mb_gwarm_ges_[MIX_BUSSE] = {};             // samples the current warm-up has run since the last leeren()
  int mb_gbasis_[MIX_BUSSE] = {};                // the base length of this warm-up
  float mb_gat_[MIX_BUSSE] = {}, mb_gah_[MIX_BUSSE] = {};   // the anchor: the crossovers at the last leeren() of the second object
  unsigned mb_blenden_[MIX_BUSSE] = {};
  cypherdj::dsp::MultibandKompressor* mb_akt(int b) const { return mb_wahl_[b] ? mb2_[b].get() : mb_[b].get(); }
  cypherdj::dsp::MultibandKompressor* mb_ruhend(int b) const { return mb_wahl_[b] ? mb_[b].get() : mb2_[b].get(); }
  float mb_b_l_[MIX_BLOCK], mb_b_r_[MIX_BLOCK];   // output of the second object during a crossover crossfade
  bool mb_lief_[MIX_BUSSE] = {};
  int mb_pos_[MIX_BUSSE] = {};
  bool mb_auto_ = true;   // see mb_ausgleich_automatisch
  float mb_gt_[MIX_BUSSE] = {-1.0f, -1.0f, -1.0f, -1.0f}, mb_gh_[MIX_BUSSE] = {-1.0f, -1.0f, -1.0f, -1.0f};
  float mb_tr_l_[MIX_BLOCK], mb_tr_r_[MIX_BLOCK];   // the dry copy during a crossfade
  void mb_block(int k, int n, bool an, float* l, float* r);
  void util_block(int k, int n, const cypherdj::dsp::UtilityParameter& p, bool neutral);
  // 1.15 A5b: channel limiter on the buses (index k - MIX_QUELLEN, only behind k >= MIX_QUELLEN), created by setze_kanal_limiter, never in the
  // callback. The bus runs through bus_verz_ (delay L) always; with lim/an the limiter output crosses over from that delayed dry signal
  // (both have latency L, so the crossfade is time-aligned). lim_warm_: samples left of the warm-up (the limiter runs on the live input
  // unheard until its own delay is full), lim_pos_: crossfade position 0..LIM_BLENDE_SAMPLES (0 = dry, full = limiter), lim_lief_: it ran and
  // has not been reset since (the bypass is "not called", with leeren() on the way back, D6).
  static constexpr int LIM_BLENDE_SAMPLES = 480;
  std::unique_ptr<cypherdj::dsp::KanalLimiter> lim_[MIX_BUSSE];
  bool lim_lief_[MIX_BUSSE] = {};
  int lim_pos_[MIX_BUSSE] = {}, lim_warm_[MIX_BUSSE] = {};
  float lim_decke_[MIX_BUSSE] = {NAN, NAN, NAN, NAN}, lim_abkl_[MIX_BUSSE] = {NAN, NAN, NAN, NAN};   // last values handed to the object
  std::atomic<float> lim_red_[MIX_BUSSE] = {};
  float lim_ein_l_[MIX_BLOCK] = {}, lim_ein_r_[MIX_BLOCK] = {};   // the undelayed bus signal (limiter input)
  float lim_aus_l_[MIX_BLOCK] = {}, lim_aus_r_[MIX_BLOCK] = {};   // limiter output during a crossfade
  void lim_block(int k, int n, bool an, const float* ein_l, const float* ein_r, float* l, float* r);
  void lim_zuruecksetzen(int b) noexcept;
  bool komp_lief_[MIX_QUELLEN] = {};
  // Sleep state (see schlaf_schritt in mixer.cpp). stumm_[k]: the strip's tap and final output were exact zeros in its last awake block.
  bool schlaf_schritt(int k, int n, bool komp_an, bool gate_an, bool util_an, bool mb_laeuft, bool bk_an, int fzi);
  bool schlaf_an_ = true;
  bool schlaeft_[MIX_KANAELE] = {};   // callback thread only (written in kanal(), read by schlaeft())
  bool stumm_[MIX_KANAELE] = {};
  std::atomic<uint64_t> schlaf_bloecke_{0};
  std::atomic<float> komp_gr_[MIX_QUELLEN] = {};        // Absenkung in dB nach dem letzten Block (Anzeige)
  void komp_block(int k, int n);
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
  bool nur_cue_[MIX_KANAELE] = {};   // S7: MIX_KANAELE, nicht MIX_QUELLEN: kanal() läuft auch für die Busse 14..17
  int blende_von_[MIX_KANAELE] = {};
  int blende_rest_[MIX_KANAELE] = {};
  float ein_l_[MIX_KANAELE][MIX_BLOCK] = {};
  float ein_r_[MIX_KANAELE][MIX_BLOCK] = {};
  float master_ein_l_[MIX_BLOCK] = {}, master_ein_r_[MIX_BLOCK] = {};
  float summe_ein_l_[MIX_BLOCK] = {}, summe_ein_r_[MIX_BLOCK] = {};   // D1 K1: Metronom master
  float pfl_ein_l_[MIX_BLOCK] = {}, pfl_ein_r_[MIX_BLOCK] = {};       // D1 K1: Metronom cue
  float stimme_ein_l_[MIX_BLOCK] = {}, stimme_ein_r_[MIX_BLOCK] = {}; // voice channel (stimme.h)
  float stimme_mg_[MIX_BLOCK] = {};                                   // master/pegel per sample for the voice
  StimmDucker stimme_;
  float fx_l_[cypherdj::dsp::kAnzahlSends][MIX_BLOCK] = {}, fx_r_[cypherdj::dsp::kAnzahlSends][MIX_BLOCK] = {};
  float sum_l_[MIX_BLOCK] = {}, sum_r_[MIX_BLOCK] = {};
  float pfl_l_[MIX_BLOCK] = {}, pfl_r_[MIX_BLOCK] = {};
  std::unique_ptr<cypherdj::dsp::MasterLimiter> limiter_;
  // PFL delayed by the limiter look-ahead vh plus the latency account L (ring; vh + L <= kMaxVorhalt + kMaxLatenz)
#ifdef CYPHERDJ_MUTATION_LATENZ_PFL_RING_KLEIN   // error case: the ring keeps its old size, vh + L runs past its end
  static constexpr int PFL_RING = cypherdj::dsp::MasterLimiter::kMaxVorhalt + 1;
#else
#ifdef CYPHERDJ_MUTATION_LATENZ_PFL_RING_VH84   // error case: sized for the vh of the default limiter (84) instead of the worst case
  static constexpr int PFL_RING = 84 + 1 + KANAL_LATENZ_MAX;
#else
  static constexpr int PFL_RING = cypherdj::dsp::MasterLimiter::kMaxVorhalt + 1 + KANAL_LATENZ_MAX;
#endif
#endif
  float pfl_verz_[2][PFL_RING] = {};
  int pfl_verz_pos_ = 0;
  float aus_l_[MIX_BLOCK] = {}, aus_r_[MIX_BLOCK] = {};
  // 1.15 A5a: the latency account. A stereo delay line of up to KANAL_LATENZ_MAX samples (in place, one block at a time).
  struct Leitung {
    float l[KANAL_LATENZ_MAX + 1] = {}, r[KANAL_LATENZ_MAX + 1] = {};
    int pos = 0;
    void leeren() noexcept;
    void block(float* xl, float* xr, int n, int latenz) noexcept;   // 1 <= latenz <= KANAL_LATENZ_MAX
  };
  int kanal_latenz_ = 0;
  Leitung bus_verz_[MIX_BUSSE];            // after the strip of bus/1..4 (index k - MIX_QUELLEN, only for k >= MIX_QUELLEN)
  Leitung summe_verz_, metro_verz_;        // the non-bus part of the master sum; the metronome
  float bus_sum_l_[MIX_BLOCK] = {}, bus_sum_r_[MIX_BLOCK] = {};   // buses route here (not into sum_) while kanal_latenz_ > 0
  bool latenz_nan_ = false;                // a block in front of a delay line was not finite (cleared there): the F01 guard of verarbeite() acts on it
  static bool vor_leitung_endlich(float* l, float* r, int n) noexcept;
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
  CypherBk* bk_[MIX_GRAPH_KANAELE] = {};
  CypherBk* bk_alt_[MIX_GRAPH_KANAELE] = {};
  int bk_blende_[MIX_GRAPH_KANAELE] = {};        // verbleibende Samples der Blende, 0 = keine
  CypherBk* bk_frei_[MIX_BK_FREI] = {};
  const float (*bk_wert_)[8] = nullptr;
  void bk_regler_melden(CypherBk* g, int k) noexcept;
  int n_bk_frei_ = 0;
  uint32_t bk_verloren_ = 0;                     // Ablage voll: Graph verloren (Leck), darf nicht vorkommen
  float bk_ein_l_[MIX_BLOCK], bk_ein_r_[MIX_BLOCK], bk_alt_l_[MIX_BLOCK], bk_alt_r_[MIX_BLOCK];
  void bk_zur_freigabe(CypherBk* g) noexcept;
  void kanal_graph(int k, float* l, float* r, int n) noexcept;
  // One graph slot (deck insert or send return): current graph, the graph being blended out, blend samples left.
  struct GraphPlatz {
    CypherBk*& g;
    CypherBk*& alt;
    int& blende;
  };
  void graph_platz_setze(GraphPlatz p, CypherBk* neu) noexcept;   // switch + free logic shared by deck insert and send
  // Shared block logic: runs p.g on in -> out, blends from p.alt (or fallback) while p.blende > 0, frees the old graph
  // after the blend, clamps out to +-8 (NaN -> 0). in and out must not overlap (FFI). Decks pass a copy of the tap as
  // in and fallback (the dry path) and the tap itself as out; sends pass the bus, their own out buffer and a zero
  // fallback (a send return has no dry path). regler_zeile >= 0 reports the knob row of bk_wert_ (decks: their channel row,
  // send returns S14: MIX_BK_SEND_ZEILE + s = fx/3, fx/4 /bk/1..8), -1 none.
  struct GraphOptionen {
    bool takt = true;      // forward the clock to the graphs
    bool klemme = true;    // output clamp
  };
  void graph_platz_block(GraphPlatz p, const float* in_l, const float* in_r, float* out_l, float* out_r,
                         const float* fb_l, const float* fb_r, int regler_zeile, int n, GraphOptionen opt) noexcept;
  // S6 send slots: index s - 2 (bus 2 = fx/3, bus 3 = fx/4). Separate from the deck arrays on purpose (test_mixer_bk (f)).
  static constexpr int MIX_SENDS_GRAPH = 2;
  CypherBk* send_bk_[MIX_SENDS_GRAPH] = {};
  CypherBk* send_bk_alt_[MIX_SENDS_GRAPH] = {};
  int send_blende_[MIX_SENDS_GRAPH] = {};
  float send_aus_l_[MIX_SENDS_GRAPH][MIX_BLOCK] = {}, send_aus_r_[MIX_SENDS_GRAPH][MIX_BLOCK] = {};
  float send_null_[MIX_BLOCK] = {};   // zero fallback: the dry path of a send return is silence
  void send_rueckweg(int s, int n) noexcept;
  int routing_ = ROUTING_POST_FADER, routing_ziel_ = ROUTING_POST_FADER;   // Ohr T17
  bool routing_wechsel_ = false;                                            // Blende läuft (Einheiten pausiert)

  // ---- 1.15 A7b: spectrum path (D11, D12). One analyser with a selectable source. Audio thread: the selector row spektrum/kanal is read at
  // the start of every block, the selected tap is written with schreibe() (channel 1..18 right after kanal(k), 19 the master sum); a change
  // of the selector stores the source and the cut and bumps the generation. Network thread (SpektrumSender in netz.h): analysiere() and the
  // other analysis-side methods of spektrum(), after reading the generation. Across threads only the three atomics below and the two atomic
  // getters of the analyser (schreib_position(), verlorene_samples()) may be read; spektrum() itself belongs to the network thread.
 public:
  // const on purpose: the Kern hands out a const Mixer, and the network thread (the analysis side) needs the analyser itself. The thread rules
  // in dsp/spektrum.h apply: the audio thread only writes through the tap inside the Mixer, everything else is the network thread's.
  cypherdj::dsp::SpektrumAnalysator& spektrum() const { return *spek_; }
  // Seqlock (D12). spek_generation() is ODD while the audio thread writes source and cut, EVEN otherwise; a change of the selector steps it by 2.
  // A reader takes an even value, loads source and cut, and takes the generation again: only an unchanged even value proves the pair is whole.
  uint32_t spek_generation() const { return spek_gen_.load(std::memory_order_acquire); }
  int spek_quelle() const { return spek_quelle_.load(std::memory_order_acquire); }          // 0 off, 1..18 channel + 1, 19 master; read between two generation reads
  std::size_t spek_schnitt() const { return spek_schnitt_.load(std::memory_order_acquire); } // write position at that change; read between two generation reads
  // Test seam (null in operation), called by the audio thread inside a change while the generation is odd: stage 0 after the odd bump,
  // stage 1 between the stores of source and cut, stage 2 after both stores, before the even bump. Set it only while no block runs.
  using SpekFensterHaken = void (*)(void* ctx, int stufe);
  void setze_spek_fenster_haken(SpekFensterHaken h, void* ctx) { spek_fenster_haken_ = h; spek_fenster_ctx_ = ctx; }
  static constexpr int SPEK_MASTER = MIX_KANAELE + 1;   // selector value 19 = master sum

 private:
  std::unique_ptr<cypherdj::dsp::SpektrumAnalysator> spek_ = std::make_unique<cypherdj::dsp::SpektrumAnalysator>(
      cypherdj::dsp::kAbtastrate, SpektrumVorgabe());   // constructed with the mixer, never in the callback
  static cypherdj::dsp::SpektrumEinstellung SpektrumVorgabe();   // 3 bands per octave, centres 1000 Hz x 2^(i/3), i = -16 .. 12 (29 bands)
  std::atomic<uint32_t> spek_gen_{0};
  std::atomic<int> spek_quelle_{0};
  std::atomic<std::size_t> spek_schnitt_{0};
  SpekFensterHaken spek_fenster_haken_ = nullptr;
  void* spek_fenster_ctx_ = nullptr;
  int spek_ist_ = 0;                     // audio thread: the selector value of the last block
  void spek_blockanfang(int n) noexcept;                       // detects a change of spektrum/kanal (call first in verarbeite)
  void spek_abgriff(int k, int n) noexcept;                    // channel tap: right after kanal(k, n)
  void spek_master(int n) noexcept;                            // master tap: master_summe_l()/r() level (after master FX and metronome, before the Kleber), see mixer.cpp
};

// Crossfader-Gewicht einer Seite (xseite 0 = A, 1 = durch, 2 = B) bei Stellung x in −1..+1 (Mixxx additiv, Exponent 1).
inline float seitengewicht(int xseite, float x) {
  if (xseite == 0) return x > 0.0f ? 1.0f - x : 1.0f;
  if (xseite == 2) return x < 0.0f ? 1.0f + x : 1.0f;
  return 1.0f;
}

}  // namespace cdj
