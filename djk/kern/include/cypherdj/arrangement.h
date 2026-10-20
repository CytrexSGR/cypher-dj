// D1 K1 (Spec D1 2.2, 2.3, 2.6): Modul Arrangement im Kern. Spielt einen Wiedergabe-Schnappschuss (arr_wiedergabe.h)
// sample-genau auf der einen Uhr. Projekt-Beat p = Kern-Beat − ursprung + start_beat; ein Ereignis auf Projekt-Beat p
// liegt auf llround(sample_at(p + ursprung − start_beat)) (Konvention des Kerns). Teile: Transport mit Start-Regel,
// Quantisierung und Loop-Klammer (arrangement.cpp), Audio-Clip-Stimmen (arr_stimmen.cpp), Spur-Mixer spur/1..8
// (arr_ausgang.cpp), Noten an Senken (arr_noten.cpp), Metronom (arr_metronom.cpp). Die Summe geht in den Eingang
// von erz/4. Echtzeit: außer Konstruktor und setze_*/sperre_* (vor dem Start) läuft alles im Callback: keine
// Allokation, keine Sperre, kein I/O.
#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/uhr.h"

namespace cdj {

constexpr int ARR_BLOCK = 1024;         // größter Teilblock (= MIX_BLOCK; Kern::audio teilt danach)
constexpr int ARR_STIMMEN = 64;         // gleichzeitig klingende Audio-Clips (fester Pool)
constexpr int ARR_NAHT = 96;            // Kurzblende an Naht, Stopp und Tausch (2 ms, wie ERZ_AUS)
constexpr int ARR_EIN = 32;             // Kurz-Einblende beim Einstieg mitten in einen Clip (wie ERZ_EIN)
constexpr int ARR_STUMM_BLENDE = 480;   // Mute und Solo: 10 ms
constexpr int ARR_OFFEN = 256;          // offene Noten (Off ausstehend), Liste fester Größe
constexpr int ARR_KLICK_LAENGE = 96;    // Metronom-Klick, Form wie der Prüfklick (klick.h)

// Wohin Noten gehen (Spec 2.4). K2 hängt die RB-FFI (intern) und die Wirt-Slots an, Tests eine Prüfsenke. Alle
// Methoden laufen im Callback: keine Allokation, keine Sperre, kein I/O.
class ArrSenke {
 public:
  virtual ~ArrSenke() = default;
  // Noten mit Ziel-Sample T kommen im Block an, der T − vorhalt() enthält (Wirt: Rundweg 2n + 25; intern: 0).
  virtual int64_t vorhalt() const noexcept = 0;
  virtual void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept = 0;
  virtual void alle_aus(int spur, int64_t ziel) noexcept = 0;            // Stopp: All-Notes-Off der Spur
  virtual void transport_start(int spur, int64_t ziel) noexcept = 0;     // K2: Zustand zurücksetzen (RB-FFI, Spec 2.4)
  // Audio der Spur für [s0, s0 + m) in den Spur-Eingang addieren (RB rendert, Wirt-Rückweg kopiert)
  virtual void block(int spur, int64_t s0, int m, float* l, float* r) noexcept = 0;
  // Fix F2 (Spec 6.28): die Spur spielt ab s nicht mehr auf dieser Senke (Tausch: andere Art, anderer Slot, leer).
  // andere_spur: eine weitere Spur der neuen Wiedergabe spielt dieselbe Senke. Vorgabe: All-Notes-Off der Spur, wenn
  // keine weitere sie spielt. true: die Senke braucht für diese Spur noch einen block() (Ausblende), das Modul ruft ihn
  // im nächsten Block einmal.
  virtual bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept {
    if (!andere_spur) alle_aus(spur, s);
    return false;
  }
};

enum class ArrStatus : int32_t { steht = 0, wartet = 1, spielt = 2, freeze = 3 };

// Paket K3 (Spec D1 2.5, 3.1 /k/arr/freeze): ein Freeze ist ein Echtzeit-Durchlauf ab von_beat nach der Start-Regel mit
// ausgesetzter Loop-Klammer; das Spur-Signal vor dem Fader geht ab dem Einsatz-Sample (bis − von + ARR_FREEZE_NACHLAUF)
// Beats lang in daten. Der Arrangement-Lade-Faden legt den Auftrag samt Puffer an (Spec 6.29; nie der Callback, nie der
// Netz-Faden), der Kern gibt ihn genau einmal als Ereignis ARR_FREEZE zurück (Fix 2/P1: auch bei vollem Ereignisring,
// die Rückgabe wartet im Kern); der Netz-Faden reicht ihn an den Lade-Faden, der schreibt die Datei und gibt frei.
constexpr double ARR_FREEZE_NACHLAUF = 2.0;      // Beats nach bis_beat (Spec 3.1)
constexpr double ARR_FREEZE_MAX_BEATS = 256.0;   // bis − von höchstens: Puffer für 60 BPM rund 99 MB
struct ArrFreeze {
  int spur = 0;                    // 1..8
  int32_t kennung = 0;             // Datei <arr_ordner>/freeze-<spur>-<kennung>.f32
  double von_beat = 0.0, bis_beat = 0.0;
  std::vector<float> daten;        // 2 · kap Werte, L und R verschränkt
  int64_t kap = 0;                 // Frames
  int64_t start_s = -1;            // Kern-Sample des Einsatzes (p = von_beat)
  int64_t frames = 0;              // Länge ab start_s: (bis − von + Nachlauf) Beats
  int64_t ende_s = -1;             // Kern-Sample, an dem der Durchlauf endete (fertig oder abgebrochen)
  int32_t status = 0;              // 0 fertig, 1 abgebrochen
  // Fix 2/P1: nur der Kern-Faden, solange die Rückgabe auf Platz im Ereignisring wartet (Kern::freeze_melden); der Auftrag
  // ist dann sein eigener Listenknoten, darum wartet jede Rückgabe ohne Obergrenze und ohne Allokation
  ArrFreeze* rueck_naechster = nullptr;
  int32_t rueck_status = 0;        // Status des wartenden Ereignisses ARR_FREEZE (0, 1 oder ARR_FREEZE_ABGELEHNT)
};

struct ArrZustand {                     // /zustand/arr (SCHNITTSTELLEN §5.13)
  int64_t nr;                          // −1 ohne Schnappschuss
  ArrStatus status;
  bool loop_an;
  double projekt_beat;
  int64_t ursprung_sample;              // Kern-Sample des Transport-Starts (p = start_beat im ersten Durchlauf), −1 ohne
  double start_beat;
  bool metronom_an;
};

class Arrangement {
 public:
  explicit Arrangement(const cypherdj::stellwerk::ReglerTabelle& tab);

  // ---- Senken (K2: RB-FFI für alle internen Spuren, je Wirt-Slot eine); nicht im Callback, vor dem Start
  void setze_senke_intern(ArrSenke* s) { senke_intern_ = s; }
  void setze_senke_wirt(int slot, ArrSenke* s) { if (slot >= 1 && slot <= ARR_WIRT_SLOTS) senke_wirt_[slot - 1] = s; }
  void sperre_metronom(bool ja) { metronom_gesperrt_ = ja; }   // Prüfmodus und Render: das Metronom klingt nie

  // ---- Befehle, im Callback am Blockanfang s
  // Tauscht den Schnappschuss und gibt den alten zurück (Freigabe im Netz-/Lade-Faden, nie im Callback).
  const ArrSnapshot* tausche(const ArrSnapshot* neu, int64_t s, const Karte& k);
  // Start nach der Start-Regel (Spec 2.2): Einsatz frühestens am ersten Quant-Punkt ≥ s + vorhalt + n. quant 0 sofort,
  // 1 nächster Kern-Beat, 2 Takt mit (Kern-Beat − start_beat) ≡ 0 mod 4. Ein laufender Transport endet bei s mit
  // Kurzblende. false: kein Schnappschuss geladen.
  bool start(double start_beat, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k);
  // Stopp: 0 sofort (bei s), 1 nächster Projekt-Beat, 2 nächster Projekt-Takt; liegt die Naht davor, an der Naht.
  void stopp(int quant, int64_t s, const Karte& k);
  // Loop-Klammer, am Blockanfang s; bis − von ≥ 1 prüft der Aufrufer
  void loop(bool an, double von, double bis, int64_t s, const Karte& k);
  void ki_stopp(int64_t s, const Karte& k);                  // beendet einen von cypher gestarteten Transport bei s
  void metronom(bool an, float pegel_db, int ziel);          // ziel 0 master (vor dem Limiter), 1 cue (PFL-Summe)

  // ---- Spur-Regler spur/<n>/{fader,pan,mute,solo}, Werte je Sample aus dem Stellwerk
  void setze_sofort(int regler, float wert);                 // Start, Neustart-Zustand (nicht während eines Blocks)
  void verlauf(int regler, const float* werte);              // gültig bis zum Ende des nächsten block()

  // ---- ein Teilblock [s0, s0 + m), m <= ARR_BLOCK. Addiert die Summe in aus_l/aus_r (Eingang erz/4, ab Slice 5),
  // das Metronom in metro_master_* (Master-Summe vor dem Limiter) oder metro_cue_* (PFL-Summe, ab Slice 7).
  void block(const Karte& k, int64_t s0, int m, float* aus_l, float* aus_r, float* metro_master_l,
             float* metro_master_r, float* metro_cue_l, float* metro_cue_r);

  // ---- Zustand (nur im Callback-Faden lesen)
  ArrZustand zustand(const Karte& k, int64_t s) const;
  const ArrSnapshot* snapshot() const { return snap_; }
  ArrStatus status() const { return status_; }
  double start_beat() const { return start_beat_; }
  bool von_cypher() const { return von_cypher_; }
  int64_t letzte_naht() const { return letzte_naht_; }       // Kern-Sample des letzten Wraps, −1: keiner
  bool spur_belegt(int i) const { return snap_ && snap_->spur[i].art != ArrArt::leer; }
  float spitze_lesen(int i) { const float v = spitze_[i]; spitze_[i] = 0.0f; return v; }   // nach dem Fader, linear
  float wert(int spur, int feld) const { return w_[spur][feld].w; }   // feld 0 fader (dB), 1 pan, 2 mute, 3 solo
  int stimmen() const;
  uint64_t stimmen_verloren() const { return stimmen_verloren_; }
  int offene_noten() const { return n_offen_; }
  uint64_t noten_verloren() const { return noten_verloren_; }
  // Ereignisse für Quittungen und /zustand/arr: Sample des letzten Einsatzes und Endes (−1: keiner); nach dem Lesen −1
  int64_t hole_gestartet() { const int64_t v = gestartet_bei_; gestartet_bei_ = -1; return v; }
  int64_t hole_gestoppt() { const int64_t v = gestoppt_bei_; gestoppt_bei_ = -1; return v; }
  bool hole_geaendert() { const bool v = geaendert_; geaendert_ = false; return v; }

  // ---- Freeze (arr_freeze.cpp, Paket K3), im Callback am Blockanfang s. Start wie start() ab f->von_beat, Loop-Klammer
  // ausgesetzt, Stopp am Ende des Nachlaufs. false mit grund: nicht_geladen, ueberlappung (Transport oder Freeze läuft),
  // spur_bereich (Spur leer), zu_gross (Puffer kleiner als die Länge). Stopp, Start, Tausch, KI-Stopp brechen ab, im Kern
  // dazu Tempo-Rampe (6.33) und /k/set/neu (freeze_abbrechen).
  bool freeze(ArrFreeze* f, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k,
              const char*& grund);
  bool freeze_laeuft() const { return freeze_ != nullptr; }
  // Fix L1 (/k/set/neu, nach dem Sprung der Zeitachse): ein wartender oder laufender Freeze endet sofort bei s (Status 1,
  // abholen mit hole_freeze_fertig), der Transport steht. Offene Noten der alten Achse fallen weg (ihr Off-Sample läge auf
  // der neuen in der Zukunft), jede Senke bekommt alle_aus bei s.
  void freeze_abbrechen(int64_t s, const Karte& k);
  // Einsatz-Sample eines Freeze (einmal, sonst −1) und der beendete Auftrag (einmal, sonst nullptr)
  int64_t hole_freeze_gestartet() { const int64_t v = freeze_gestartet_bei_; freeze_gestartet_bei_ = -1; return v; }
  ArrFreeze* hole_freeze_fertig() { ArrFreeze* f = freeze_fertig_; freeze_fertig_ = nullptr; return f; }

 private:
  double projekt_beat(const Karte& k, double s) const { return k.beat_at(s) - ursprung_ + start_beat_; }
  int64_t sample_von_p(const Karte& k, double p, double urs) const {
    return std::llround(k.sample_at(p + urs - start_beat_));
  }
  // Spec 2.2: die Klammer greift nur, wenn der Kopf bis von unten erreicht. Liegt der Kopf beim Start (start_beat) auf
  // oder hinter bis, oder beim Setzen der Klammer (loop) hinter bis (Naht-Sample < s; genau auf der Naht greift sie,
  // K1 Fix-2), läuft der Transport linear, bis ein neuer Start oder eine neue
  // Klammer vor dem Kopf kommt (Audio, Noten, Metronom und Naht fragen alle hier). So liegt die Naht nie hinter dem Kopf.
  bool klammer() const {
#ifdef CYPHERDJ_MUTATION_ARR_KLAMMER_OHNE_START
    return loop_an_;   // Fehlerfall: Start auf oder hinter bis springt sofort in die Klammer
#else
    return loop_an_ && klammer_vorn_;
#endif
  }
  int64_t naht_sample(const Karte& k) const;     // Sample der Naht (p = bis) des laufenden Durchlaufs, −1 ohne
  void beginne(const Karte& k, int64_t s);
  void beende(int64_t s);
  void wrap(const Karte& k, int64_t s);
  void segment(const Karte& k, int64_t a, int64_t b, int64_t s0);   // Teilblock ohne Transport-Ereignis

  // Audio-Clip-Stimmen (arr_stimmen.cpp)
  struct Stimme {
    bool aktiv = false;
    int spur = 0;
    uint64_t clip_id = 0;
    const ArrClip* clip = nullptr;   // nullptr: Ausklang aus eigener Kopie
    int64_t clip_s0 = 0;             // (bei Einstieg vergangenes) Kern-Sample des Clip-Anfangs
    int64_t ende = 0;                // Kern-Sample des Clip-Endes
    int64_t ein_n = 0, aus_n = 0;    // Ein- und Ausblende des Clips in Samples
    int64_t ramp_ein_ab = -1;        // Kurz-Einblende ab diesem Sample, −1: keine
    int64_t ab_aus = -1;             // Kurzblende (Stopp) beginnt hier, ARR_NAHT lang, −1: keine
    int ak_n = 0, ak_pos = 0;        // Ausklang
    float ak[2 * ARR_NAHT] = {};
  };
  void clips_starten(const Karte& k, int64_t a, int64_t b);
  void stimme_starten(const Karte& k, const ArrClip& c, int spur, int64_t s_start, int64_t clip_s0, bool rampe);
  void stimmen_einstieg(const Karte& k, int64_t a);
  void stimme_ausklang(Stimme& v, int64_t s);
  void stimmen_spielen(int64_t a, int64_t b, int64_t s0, int64_t naht);
  void stimmen_tauschen(const ArrSnapshot* neu, int64_t s);
  void stimmen_stopp(int64_t s);
  void stimmen_naht();

  // Spur-Mixer (arr_ausgang.cpp)
  struct Wert {
    float w = 0.0f;
    const float* vl = nullptr;
  };
  void regler_binden(const cypherdj::stellwerk::ReglerTabelle& tab);
  void mischen(int m, float* aus_l, float* aus_r);
  void verlaeufe_nachfuehren(int m);
  void ruhe(int m);                  // Block ohne Wiedergabe und ohne Klang (Slice 11)

  // Noten (arr_noten.cpp)
  struct Offen {
    uint64_t id;
    int spur;
    uint8_t ton;
    int64_t an, aus;                 // Ziel-Samples
    double ende_beat;                // Projekt-Beat des Endes (Vergleich beim Tausch)
    ArrSenke* senke;
  };
  ArrSenke* senke_fuer(const ArrSnapshot* s, int spur) const;
  void senken_wechsel(const ArrSnapshot* neu, int64_t s);   // Fix F2: Spuren, die ihre Senke verlassen (arrangement.cpp)
  void noten_block(const Karte& k, int64_t s0, int m);
  void noten_fenster(const Karte& k, int spur, ArrSenke* se, int64_t von, int64_t bis);
  void offen_aus_bis(int64_t ende);
  void alle_noten_aus(int64_t s);
  void noten_tauschen(const ArrSnapshot* neu, int64_t s);

  // Freeze (arr_freeze.cpp, Paket K3)
  void freeze_abgriff(int64_t s0, int m);
  void freeze_ende(int64_t s, int32_t status);

  // Metronom (arr_metronom.cpp)
  void klick_form_bauen();
  void metronom_segment(const Karte& k, int64_t a, int64_t b, int64_t s0);

  const ArrSnapshot* snap_ = nullptr;
  ArrStatus status_ = ArrStatus::steht;
  bool von_cypher_ = false;
  double start_beat_ = 0.0;
  double ursprung_ = 0.0;            // Kern-Beat mit p = start_beat; verschiebt sich je Naht um bis − von
  int64_t start_s_ = -1;             // Kern-Sample des Einsatzes (wartet, spielt)
  int64_t stopp_s_ = -1;             // geplanter Stopp, −1: keiner
  bool loop_an_ = false;
  bool klammer_vorn_ = false;        // bis lag beim Start oder beim Setzen der Klammer vor dem Kopf (klammer())
  double von_ = 0.0, bis_ = 0.0;
  int64_t letzte_naht_ = -1;
  int64_t gestartet_bei_ = -1, gestoppt_bei_ = -1;
  bool geaendert_ = false;

  bool einstieg_ = false;            // am nächsten Teilblock Clips ansetzen, die am laufenden Ort schon klingen müssten
  Stimme st_[ARR_STIMMEN];
  uint64_t stimmen_verloren_ = 0;
  Wert w_[ARR_SPUREN][4];            // je Spur 0 fader (dB), 1 pan, 2 mute, 3 solo
  int16_t regler_spur_[cypherdj::stellwerk::MAX_REGLER];
  int8_t regler_feld_[cypherdj::stellwerk::MAX_REGLER];
  float ms_gain_[ARR_SPUREN];        // Mute/Solo-Blende 0..1
  float spitze_[ARR_SPUREN] = {};
  float bus_l_[ARR_SPUREN][ARR_BLOCK] = {};
  float bus_r_[ARR_SPUREN][ARR_BLOCK] = {};

  ArrSenke* senke_intern_ = nullptr;
  ArrSenke* senke_wirt_[ARR_WIRT_SLOTS] = {};
  // Fix F2 und K2b-Rest (a): je Senke, die eine Spur beim Tausch verlassen hat, ein Eintrag (Senke, Spur); im nächsten
  // Block blendet jede dieser Senken die Spur einmal aus. Wechselt eine Spur in einem Zyklus mehrmals (zwei /k/arr/laden vor
  // demselben Block), bleibt jede verlassene Senke stehen, nicht nur die letzte. Feste Größe, keine Allokation; ein Paar
  // (Senke, Spur) steht höchstens einmal, darum reicht eine Spur je Senke (intern und die Wirt-Slots).
  struct ArrWeg {
    ArrSenke* senke;
    int spur;
  };
  static constexpr int ARR_WEG_MAX = ARR_SPUREN * (1 + ARR_WIRT_SLOTS);
  ArrWeg weg_[ARR_WEG_MAX] = {};
  int n_weg_ = 0;
  void weg_merken(ArrSenke* a, int spur);
  Offen offen_[ARR_OFFEN];
  int n_offen_ = 0;
  int64_t gesendet_bis_[ARR_SPUREN] = {};   // je Spur: Noten mit Ziel-Sample < gesendet_bis sind hinaus
  uint64_t noten_verloren_ = 0;

  bool metro_an_ = false;
  bool metronom_gesperrt_ = false;
  float metro_g_ = 0.25f;
  int metro_ziel_ = 0;
  float klick_form_[ARR_KLICK_LAENGE] = {};
  int klick_rest_ = 0;
  float klick_pegel_ = 0.0f;
  float* metro_l_ = nullptr;         // Ziel des laufenden Blocks (Master- oder PFL-Eingang des Mixers)
  float* metro_r_ = nullptr;

  ArrFreeze* freeze_ = nullptr;      // laufender Freeze (Paket K3)
  ArrFreeze* freeze_fertig_ = nullptr;
  int64_t freeze_gestartet_bei_ = -1;
  bool loop_gemerkt_ = false;        // Loop-Klammer des Nutzers, während eines Freeze ausgesetzt
  double start_gemerkt_ = 0.0;       // Fix L10: start_beat des Nutzers, während eines Freeze von_beat
  bool klammer_vorn_gemerkt_ = false;
};

}  // namespace cdj
