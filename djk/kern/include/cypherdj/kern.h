// Der Echtzeit-Teil des Kerns ohne JACK: ein Zyklus nimmt Befehle aus dem Befehlsring und sortiert sie ein, führt
// fällige Befehle am Ziel-Sample aus, führt die Uhr, klickt, schreibt den Audio-Ring (SCHNITTSTELLEN.md §6.1) und
// meldet /uhr, /takt und Quittungen als Ereignisse. Keine Allokation, keine Sperre, kein I/O in zyklus(): Befehle
// kommen und Ereignisse gehen über zwei lock-freie SPSC-Ringe (Scheibe 01, Befehle und Ringe erweitert in Scheibe 08).
// Scheibe 25: Planteile, Abbruch, KI-Stopp und der Prüf-Handeingang laufen über die Stellwerk-Bibliothek
// (djk/kern/stellwerk, Scheibe 11) sample-genau; der Mixer (mixer.h) rechnet die Kanalzüge (djk/kern/dsp, Scheibe 04),
// Master und Cue; der Prüfklick (ROADMAP Z1) geht in jeden Kanal aus §1.5.
// Scheibe 31: vier Decks im Direktweg (deck.h, deck_werk.h, kern_deck.cpp), Material über den Lader (lader.h) im eigenen
// Faden; Deck-Befehle am Sample ihres Ziel-Beats, /zustand/deck, /e/geladen, /e/frist.
// Scheibe 35 (Teil A): Kern-Hand. JACK-MIDI von hand_in kommt roh mit Versatz herein und wird im Zyklus über die
// Hand-Bibliothek (djk/kern/hand, Scheibe 19) übersetzt: Griffe am Sample ins Stellwerk, Play und Cue als Deck-Aktion
// am Sample, Tasten als /e/taste, die Stopp-Taste wie /k/ki/stopp (kern_hand.cpp).
#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/deck_werk.h"
#include "cypherdj/dsp/analyse_baender.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/huellen.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/hand_ein.h"
#include "cypherdj/kern_uhr.h"
#include "cypherdj/klick.h"
#include "cypherdj/mixer.h"
#include "cypherdj/ring.h"
#include "cypherdj/spsc_ring.h"
#include "cypherdj/stellwerk/i3.h"
#include "cypherdj/stellwerk/stellwerk.h"
#include "cypherdj/teile.h"
#include "cypherdj/tempoplan.h"
#include "cypherdj/uhr.h"

struct cdj_z_echtzeit;  // Scheibe 18: Neustart-Zustand, cypherdj/zustand.h

namespace cdj {

constexpr int MAX_BLOCK = 8192;
constexpr int KLICK_MASTER = MIX_KANAELE;  // Scheibe 25: Prüfklick-Ziele 0..17 = Mixer-Kanäle, 18 = master

struct Befehl {
  enum Art : int32_t {
    SET_NEU = 1, KLICK = 2, TEMPO_RAMPE = 3, STORNO = 4,
    TEIL = 5, ABBRUCH = 6, KI_STOPP = 7, KI_FREI = 8, KI_SPUR = 9, KI_STUFE = 10, HAND = 11,  // Scheibe 25
    DECK_LADEN = 12, DECK_ENTLADEN = 13, DECK_START = 14, DECK_STOPP = 15,                   // Scheibe 31
    MAPPING = 16,                                                                             // Scheibe 35: /k/mapping
    ERZ_STROM = 17, ERZ_FENSTER = 18,  // Plan 2026-09-27 (§4.8, ADR 024): nr = strom, pfad = kanal, zeiger = Kit*/ErzFenster*
    LOOP_LADEN = 19, LOOP_START = 20, LOOP_STOPP = 21,  // MVP 2 (§4.9, ADR 025): deck = box, pfad = name, zeiger = Loop*
    MITSCHNITT = 22,  // MVP 2 Scheibe 2 (§4.9 /k/loop/rec): nr = beats, pfad = name, zeiger = Mitschnitt*
    DECK_LOOP = 23, DECK_SPRUNG = 24, DECK_HOTCUE = 25, DECK_HOTCUE_SETZEN = 26,  // Plan E9 (§4.4): nr = Hotcue
    FX = 27,           // AUFTRAG 2026-09-28 (§4.10): deck = einheit (1,2), nr = art, dauer_beats = beats, wert = wet,
                       // wert_beats = param1 (DSP-wirksam), raster_beats = param2, quell_beat = param3 (beide
                       // reserviert; FX nutzt sonst weder Sprung-/Loop-Raster noch Start-Quellbeat), an = Einheit ON
    FX_ZUWEISUNG = 28,  // deck = einheit (1,2), pfad = kanal, an = zugewiesen (0/1)
    DECK_RASTER = 29,   // Plan Grid (§4.4 /k/deck/raster): deck, material_id, bpm = basis_bpm, fassung, versatz_f
    LOOP_RASTER = 30,   // Plan Grid (§4.9 /k/loop/raster): deck = box, versatz_f
    HOERSCHEIN = 31, HOERSCHEIN_WEG = 32,  // Ohr T12 (§4.5 /k/hoerschein, /k/hoerschein/weg)
    FX_ROUTING = 33,  // Ohr T17 (§4.10 /k/fx/routing): an = routing (0 Post Fader, 1 Insert); nur Andreas' Hand
    // 34, 35: frei (bis Task 7 die Befehle der Keylock-Varianten, ADR 027; die Box dehnt jetzt live mit dem Dehner)
    DECK_TAUSCH = 36  // Welle 3 (ADR 028, §4.4 /k/deck/basis_tausch): deck, bpm = basis_bpm, fassung, ab_beat
  };
  int32_t art;
  int32_t an;          // KLICK: 0 oder 1; KI_STUFE: Stufe 0 bis 3
  int64_t id;
  double bpm;          // SET_NEU: start_bpm; HOERSCHEIN: bpm_messung
  char quelle[48];
  double ab_beat;      // TEMPO_RAMPE, TEIL; HOERSCHEIN: gueltig_bis_beat
  double ziel_bpm;     // TEMPO_RAMPE
  double dauer_beats;  // TEMPO_RAMPE, TEIL
  int64_t ziel_id;     // STORNO
  // Scheibe 25
  int64_t sample;      // HAND: Sample, an dem der Griff wirkt
  float wert;          // TEIL: nach; HAND: midi_roh 0..1
  int32_t nr;          // TEIL: teil
  int32_t form;        // TEIL
  int32_t politik;     // TEIL
  char plan[48];       // TEIL, ABBRUCH
  char pfad[48];       // TEIL, HAND: Regler-Pfad; KLICK: Kanal ("" oder "master" = Master); HOERSCHEIN: kanal
  char gruppe[48];     // TEIL
  char hoerschein[48]; // TEIL, DECK_*: hs_id; HOERSCHEIN, HOERSCHEIN_WEG: hs_id des Scheins selbst
  char liste[128];     // ABBRUCH: teile ("*" oder "0,2,5"); KI_SPUR: kanaele
  // Scheibe 31 (§4.4): DECK_LADEN nimmt basis_bpm aus bpm; START und STOPP ab_beat, politik, plan, gruppe, hoerschein
  int32_t deck;          // DECK_*: 1 bis 4
  int32_t fassung;       // DECK_LADEN; HOERSCHEIN: aus inhalt
  int32_t mit_stems;     // DECK_LADEN
  double quell_beat;     // DECK_START
  char material_id[24];  // DECK_LADEN; HOERSCHEIN: aus inhalt
  // Plan E9 (§4.4, §16.1): DECK_LOOP laenge_beats bzw. DECK_SPRUNG delta_beats; raster_beats bei Politik 2.
  // DECK_HOTCUE_SETZEN trägt den Wert in quell_beat (NaN löscht), DECK_HOTCUE die Nummer in nr.
  double wert_beats;
  double raster_beats;
  int64_t versatz_f;     // Plan Grid: DECK_RASTER, LOOP_RASTER (Frames, absolut)
  // Scheibe 35: MAPPING trägt das im Netz-Faden geladene, geprüfte hand::Mapping (Besitz geht an den Kern, der es nach
  // dem Tausch als MAPPING_ALT zurückgibt)
  const void* zeiger;
  // Ohr T12 (§4.5, §16.2): HOERSCHEIN trägt die restlichen Felder, die das Stellwerk (Task 13/14) für I3a braucht.
  int32_t bpm_milli;       // HOERSCHEIN: aus inhalt (<material_id>/<bpm_milli>_r<fassung>)
  double quell_von;        // HOERSCHEIN
  double quell_bis;        // HOERSCHEIN
  char urteil[8];          // HOERSCHEIN: nur "ok" wird gesendet (§4.5)
  float sync_ms;           // HOERSCHEIN
  float pegel_diff_db;     // HOERSCHEIN
  float lufs_kurz;         // HOERSCHEIN
};

struct Ereignis {
  enum Art : int32_t {
    UHR = 1, TAKT = 2, QUITTUNG = 3, ZYKLUS = 4, LUECKE = 5, QUANTUM = 6, NEUSTART = 7,
    REGLER = 8, HAND = 9, HALTER = 10, KI = 11, INVARIANTE = 12,  // Scheibe 25, §5.7 bis §5.9
    DECK = 13, GELADEN = 14, FRIST = 15,                           // Scheibe 31, §5.5, §5.9
    TASTE = 16,                                                    // Scheibe 35, §5.8 /e/taste: pfad = Name, status = Wert
    MAPPING_ALT = 17,                                              // Scheibe 35: getauschtes Mapping zur Freigabe im Netz-Faden (zeiger)
    PEGEL = 18,                                                    // Scheibe 35, §5.6 /pegel: pfad = Kanal, pegel[7] wie die Felder
    ERZ_ALT = 19,       // Plan 2026-09-27: abgelöstes Kit zur Freigabe im Netz-Faden (zeiger)
    ERZ_QUITTUNG = 20,  // §4.8 /erz/quittung: deck = strom, fassung = sendung, erz_zahl, zeiger = verbrauchtes ErzFenster
    LOOP = 21,          // MVP 2, §5.11 /e/loop: deck = box, status, pfad = name, fassung = beats, fx_*
    LOOP_ALT = 22,      // MVP 2: abgelöster Loop zur Freigabe im Netz-Faden (zeiger)
    MITSCHNITT = 23,    // MVP 2 Scheibe 2, §5.11 /e/mitschnitt: status, beat = ab_beat, sample = ab_sample,
                        // fassung = beats, pfad = name, zeiger = Mitschnitt* (das Netz schreibt und gibt frei)
    HOTCUE = 24,        // Plan E9, §5.9 /e/hotcue: deck, material_id, status = nr, quell_beat, sample
    FX = 25,            // AUFTRAG 2026-09-28, §5.12 /e/fx: deck = einheit (1,2), fx_art, fx_beats, fx_wet,
                        // fx_param = param1, beats_bis_ende = param2, faktor = param3 (reserviert), status = an
    FX_ZUWEISUNG = 26,  // §5.12 /e/fx/zuweisung: deck = einheit (1,2), pfad = kanal, status = zugewiesen (0/1)
    RASTER = 27,        // Plan Grid, §5.9 /e/raster: deck, material_id, quell_beat, wert = Änderung in ms, sample
    FX_ROUTING = 28,    // Ohr T17, §5.12 /e/fx/routing: status = routing (0 Post Fader, 1 Insert)
    BOX = 29            // Keylock 7b.3, §5.5b /zustand/box: deck = box, status, keylock_unterlauf, keylock_aufgegeben,
                        // keylock_ring_voll, keylock_kein_platz (7c.3)
  };
  int32_t art;
  int32_t status;   // QUITTUNG: §5.1; KI: gestoppt 0/1
  int64_t id;       // QUITTUNG
  int64_t sample;   // UHR: Blockanfang; TAKT: Taktanfang; QUITTUNG: ist_sample; ZYKLUS, LUECKE, QUANTUM: Blockanfang
  int64_t mono_ns;  // UHR; ZYKLUS: Callback-Anfang
  int64_t takt;     // TAKT
  int64_t phrase;   // TAKT
  double beat;      // UHR, TAKT, QUITTUNG (ist_beat), REGLER, HAND, HALTER, INVARIANTE
  double bpm;       // UHR, TAKT
  double k;         // UHR: bpm_pro_s
  int32_t generation;  // UHR; NEUSTART (§5.9 /e/neustart: generation, sample = erstes Sample der Generation)
  int64_t verloren;    // UHR (Glanz 2.6): Ereignisse, die Kern::melde bisher verwarf (Ring voll); das Netz gleicht daran ab
  int32_t keylock_aus;  // UHR (Keylock Task 3): 1 = Regler keylock aus (0, die Null-Vorgabe, heißt an); das Netz meldet den
                        // Stand neuen Abonnenten (Task 3b)
  char quelle[48];  // QUITTUNG
  char grund[32];   // QUITTUNG: "" oder ein Code aus §16.2; KI: grund; INVARIANTE: art
  int32_t dauer_us, aufwach_us, nframes, wartend;  // ZYKLUS
  int64_t frame_luecken, ausgelassen;              // ZYKLUS: seit Generationsstart
  int32_t frames, zyklen;                          // LUECKE (§5.9 /e/luecke)
  int32_t alt, neu;                                // QUANTUM (§5.9 /e/quantum)
  // Scheibe 25
  char pfad[48];    // REGLER, HAND, HALTER
  char text[48];    // REGLER, HALTER: halter; INVARIANTE: plan
  float wert;       // REGLER, HAND
  int32_t teil;     // INVARIANTE
  // Scheibe 31: DECK (§5.5, status = Deck-Status, sample = Blockanfang), GELADEN und FRIST (§5.9)
  int32_t deck;
  int32_t fassung, mit_stems;
  char material_id[24];
  double basis_bpm, quell_beat, beats_bis_ende, faktor;
  float vorlauf_ms;
  int32_t hoerweg;          // DECK (§5.5): 0 direkt bzw. Varispeed, 1 Stretcher (Keylock: der Ring klingt mit)
  int32_t stretcher_fuell;  // DECK (§5.5): Arbeitsvorlauf in Blöcken (Keylock: Ring), −1 ohne Stretcher
  int32_t keylock_unterlauf, keylock_aufgegeben;  // DECK (§5.5, Keylock Task 3): Zähler des Decks seit dem Laden des Kerns
  int32_t keylock_ring_voll;                      // BOX (§5.5b, Keylock 7b.3): Abschnitte, die nicht in den Ring passten
  int32_t keylock_kein_platz;                     // BOX (§5.5b, Keylock 7c.3): Ansätze ohne freien Platz der Leihe
  const void* zeiger;  // MAPPING_ALT: das abgelöste hand::Mapping
  float pegel[7];      // PEGEL: spitze_db, echtspitze_dbtp, lufs_m, lufs_s, band_tief_db, band_mitte_db, band_hoch_db
  int32_t erz_zahl[5];  // ERZ_QUITTUNG: verworfen, verworfen_anderes_muster, eingefuegt, zu_spaet, ungehoert
  int32_t fx_art;       // LOOP (MVP 2): Beat-FX der Box (Scheibe 3), bis dahin 0
  double fx_beats;      // LOOP: Periode in Beats
  float fx_wet;         // LOOP: Anteil 0..1
  float fx_param;       // FX (Plan 3): param 0..1
};

using Befehlsring = SpscRing<Befehl, 256>;
using Ereignisring = SpscRing<Ereignis, 8192>;

class Kern {
 public:
  Kern(double start_bpm, cdj_ring_kopf* ring, Befehlsring* befehle, Ereignisring* ereignisse);
  ~Kern();
  // Ein Audioblock von n Samples; mono_ns = Blockanfang (CLOCK_MONOTONIC).
  void zyklus(int n, int64_t mono_ns);
  int64_t sample() const { return sample_; }
  int64_t rueck_unendlich() const { return rueck_unendlich_; }  // Audit F01: verworfene Rückweg-Samples
  int32_t generation() const { return generation_; }
  int wartend() const { return plan_.wartend() + schatten_.wartend(); }  // §5.4 befehle_wartend
  bool neue_zeitachse() const { return neue_zeitachse_; }  // /k/set/neu im letzten Zyklus
  const Karte& karte() const { return plan_.karte(); }
  uint64_t ereignisse_verloren() const { return verloren_; }

  // Scheibe 18, Neustart-Zustand (SCHNITTSTELLEN §6.3, kern_zustand.cpp). abbild() schreibt Generation, wirksame Karte,
  // Grundkarte und die offenen Befehle (Rampen, Prüfklick) in ein Echtzeit-Fach; den Anker schreibt der Aufrufer.
  // wiederherstellen() übernimmt ein Fach in einen frisch angelegten Kern, Generation + 1. Beide echtzeitfest.
  // Scheibe 25: dazu Regler mit Wert und Halter, Planteile mit Stand, KI-Stopp, KI-Spur und Prüfklicks je Kanal.
  void abbild(cdj_z_echtzeit& f) const noexcept;
  bool wiederherstellen(const cdj_z_echtzeit& f) noexcept;
  // Erster Zyklus einer fortgesetzten Generation, vor zyklus(): Kern-Sample auf den Anker setzen und /e/neustart als
  // erstes Ereignis dieser Generation melden (§4.1).
  void fortsetzen(int64_t sample) noexcept;
  // Prüfsignal auf dem Cue (pruef_cue.h); nur mit --pruefmodus und --pruef-cue.
  void setze_pruef_cue(bool an) { pruef_cue_ = an; }
  // Scheibe 25, Befund B7 aus 18: nur ein Kern im Prüfmodus übernimmt eingeschaltete Prüfklicks aus dem Neustart-Zustand.
  // Vorgabe aus (fail-safe); main.cpp setzt ihn vor dem Lesen des Zustands, die Offline-Tests (kern25.h) setzen an.
  void setze_pruefmodus(bool an) { pruefmodus_ = an; }
  // Scheibe 25: Güte des DJ-Filters aller 18 Kanalzüge (kern.toml filter_guete, A27 Weg a). Nicht im Callback.
  void setze_filter_guete(double q) { mixer_->setze_filter_guete(q); }
  // Scheibe 25: Decke des Master-Limiters (kern.toml limiter_dbtp, §2.1). Nicht im Callback.
  void setze_limiter_dbtp(double decke) { mixer_->setze_limiter_dbtp(decke); }

  // Scheibe 25: für Tests und Werkzeuge (nicht im Callback benutzen)
  const cypherdj::stellwerk::Stellwerk& stellwerk() const { return *sw_; }
  const Mixer& mixer() const { return *mixer_; }
  bool ki_gestoppt() const { return sw_->ki_gestoppt(); }
  // Gebremster Start (Absturzschleife, F20): nichts aus dem Fach übernehmen außer Andreas' Stop Cypher, der darf nie
  // still verloren gehen; nachgereicht im ersten Zyklus wie beim vollen Wiederherstellen.
  void nur_ki_stopp_wiederherstellen(const cdj_z_echtzeit& f);
  int ki_stufe() const { return ki_stufe_; }

  // Scheibe 31: Decks im Direktweg mit Lader (kern_deck.cpp). verbinde_lader und setze_deck_konfig vor dem Start.
  void verbinde_lader(LaderRinge* r) noexcept { lader_ = r; }
  // Ohr (§6.2): Hüllkurven-Ring am Mess-Abgriff (vor dem Fader). nullptr (Vorgabe): kein Schreiber, kein Fehler.
  void verbinde_huellen(cdj_huellen_kopf* h) noexcept { huellen_ = h; }
  void setze_deck_konfig(float ziel_lufs, float hoerbar_db) noexcept { ziel_lufs_ = ziel_lufs; hoerbar_db_ = hoerbar_db; }
  // Ohr T14 (§17 I3a, kern.toml hoerschein_pflicht, Vorgabe an): schaltet den Prüfer im Stellwerk. Nicht im Callback.
  void hoerschein_pflicht(bool an) noexcept { pruefer_i3_->schalte(an); }
  const Deck& deck(int n) const { return decks_->deck[n - 1]; }  // n = 1 bis 4
  const LoopBoxen& loopboxen() const { return *loops_; }  // Task 7: Diagnose und Tests (nur aus dem Callback-Faden lesen)
  bool ein_deck_laeuft() const noexcept;
  void tausch_frei(int d);  // Welle 3: wartende basis_tausch-Fassung zurück an den Lader
  bool deck_offen(int n) const noexcept;         // §1.6 offen(deck/n): Trim + Fader > hoerbar_db
  bool deck_laeuft_offen(int n) const noexcept;  // §4.4 Sperre für Laden und Entladen: läuft und offen (2026-09-27)
  bool deck_hoerbar(int n) const noexcept;  // §1.6 hörbar(deck/n): effektiver Pegel > hoerbar_db und läuft
  // Scheibe 31, Neustart (kern_deck_zustand.cpp): nach wiederherstellen() das Material der Decks aus dem Zustand
  // einblenden und die Decks auf ihren Anker setzen; einmal vor jack_activate. Rückgabe: wieder eingeblendete Decks.
  int decks_nachladen(Lader& lader);
  // Keylock (Plan 2026-10-06-keylock-echtzeit.md, Task 2, Vertrag 17): an legt je Deck einen Dehner an (Fabrik
  // dehner_neu; mit stub/dehner_stub.cpp nullptr, dann bleibt es Varispeed) und schaltet den Keylock der Decks ein. NUR
  // vor dem ersten zyklus() und nur einmal (Prüfung m5): die Dehner entstehen hier, an die Decks hängt sie der erste
  // zyklus() selbst; danach false, nichts geändert. Vorgabe aus: Betrieb und alle übrigen Tests fahren Varispeed (Klicks ±1 deterministisch), bis Task 3 den
  // Knopf bringt. Die Fäden des Dehners: keylock_vorbereiten() (Vorbereiter, alle Decks) und keylock_fuellen(n)
  // (Arbeits-Thread von Deck n); Task 2 ruft sie in den Tests synchron nach jedem zyklus().
  bool setze_keylock_vorgabe(bool an);
  // Umbauplan Bungee S2 (kern.toml `keylock_maschine`): R3 (Vorgabe) oder Bungee, bei Bungee fein = Korn 256 statt 512. Vor
  // setze_keylock_vorgabe / keylock_bauen; danach ohne Wirkung. Bungee fährt synchron im Callback (keylock_antrieb), ohne Fäden:
  // keylock_faeden_laufen() ist dann false. Ohne Bungee-Bau (CYPHERDJ_BUNGEE aus) liefert die Fabrik keinen Dehner, Keylock aus.
  void setze_keylock_maschine(DehnerMaschine m, bool fein = false) noexcept;
  bool keylock_vorgabe() const noexcept;
  void keylock_vorbereiten();
  void keylock_fuellen(int deck);
  // n = 1 bis 6 (1 bis 4 Decks, 5 und 6 Boxen); nullptr ohne Keylock. Diagnose, Tests und (seit 7b.3) boxen_zustand im Callback
  DehnerBasis* keylock_dehner(int deck) const noexcept;
  // Keylock Task 2.5 (Fassung 4.1 Punkt 2; Vertrag 3, 12, 14, 18): die Fäden im Kern, angelegt von keylock_bauen (unten):
  // ein Vorbereiter für alle Decks, je Deck mit Dehner ein Arbeits-Thread, ein Wächter. Laufen sie, sind
  // keylock_vorbereiten/keylock_fuellen ohne Wirkung. Der Arbeits-Thread füllt in JEDEM Takt, auch bei stehendem Deck und bei Keylock aus (Pflicht aus der
  // Nachprüfung N3: sonst quittiert er die Leer-Epoche nie und Laden/Entladen warten unbegrenzt). Der Wächter meldet
  // (stderr, Zähler) einen Arbeits-Thread, der eine vergebene Epoche nicht binnen KEYLOCK_WAECHTER_FRIST_MS quittiert, und
  // einen Vorbereiter, der so lange keinen Durchgang macht. Priorität: SCHED_OTHER, bis keylock_prioritaet(jack_prio)
  // (Vertrag 12) Vorbereiter und Arbeits-Threads auf SCHED_FIFO jack_prio − 5 setzt; jack_prio <= 0 (ohne JACK, Tests):
  // bleibt. Scheitert es (kein Recht), je Faden eine stderr-Zeile, Zähler keylock_prio_fehler(), Weiterlauf mit
  // SCHED_OTHER; Rückgabe: Zahl der gescheiterten Fäden. keylock_faeden_stoppen(): Join, auch aus ~Kern.
  // Task 2.5b: Betriebsweg. keylock_ankuendigen() vor dem ersten Zyklus (main.cpp: vor jack_activate, kostet nichts);
  // keylock_bauen(jack_prio) danach aus einem Nicht-Echtzeit-Faden (main.cpp: nach READY): baut die Dehner, startet die
  // Fäden, setzt die Priorität und stellt erst dann die Vorgabe (der nächste Zyklus hängt an, Decks im Lauf setzen neu
  // an). false: Keylock aus, ohne Dehner an den Decks (Faden nicht anlegbar oder Stub), mit stderr-Zeile.
  // keylock_ab(): Kern-Sample, ab dem die Dehner an den Decks hängen (−1: noch nicht; nur aus dem Callback-Faden lesen).
  bool keylock_ankuendigen();
  // Keylock Task 3: der Weg von main.cpp mit kern.toml `keylock`: false -> nichts angekündigt (Kern ohne Dehner, Rückgabe
  // false), true -> keylock_ankuendigen().
  bool keylock_nach_konfig(bool an) { return an && keylock_ankuendigen(); }
  // sperren (Task 2.5c, main.cpp: true): danach nur den neu angelegten Dehner-Speicher und die Stapel der Keylock-Fäden
  // per mlock sperren, nicht mlockall; gesperrte Bytes und ein Fehler (errno, 0 ohne) für Meldung und Tests.
  bool keylock_bauen(int jack_prio, bool sperren = false);
  uint64_t keylock_gesperrt() const noexcept;
  int keylock_sperr_fehler() const noexcept;
  int64_t keylock_ab() const noexcept;
  int keylock_prioritaet(int jack_prio);
  void keylock_faeden_stoppen();
  bool keylock_faeden_laufen() const noexcept;
  uint64_t keylock_prio_fehler() const noexcept;
  uint64_t keylock_waechter_meldungen() const noexcept;
  // Politik und Priorität eines Fadens (0 Vorbereiter, 1 bis 4 Arbeits-Thread Deck n, 5 Wächter); false: nicht angelegt
  bool keylock_faden_sched(int platz, int& politik, int& prio) const noexcept;
  void keylock_test_halte(int deck, bool an) noexcept;  // nur Tests: der Arbeits-Thread von Deck n setzt aus (Wächter-Probe)
  // Keylock Task 7 Step 1 (Gate G1): Zähler und Kosten aller Quellen als eine JSON-Zeile {"keylock":...} für die Schlusszeile
  // von main.cpp. Liest Zustand der Fäden ohne Atom (kosten_render): nur nach keylock_faeden_stoppen und ohne Callback.
  std::string keylock_schluss_json() const;
  // Keylock Task 3 (Fassung 4): Stand des globalen Reglers `keylock`, wie der Callback ihn zuletzt übernommen hat (Diagnose,
  // Tests; nur aus dem Callback-Faden lesen), und der Schalter der Loop-Boxen (folgt dem Regler).
  bool keylock_knopf() const noexcept;
  bool keylock_boxen() const noexcept;

  // Scheibe 35: Kern-Hand (kern_hand.cpp). hand_midi() im Callback vor zyklus() je Ereignis des Eingangs hand_in, höchstens
  // MAX_MIDI je Zyklus (mehr zählt hand_ueberlauf()); übersetzt wird erst in zyklus(), nach dem Einsortieren der
  // Befehle, mit dem Blockanfang als Sample (Plan 35 E1). setze_mapping() nur vor jack_activate (Start); später kommt ein
  // Mapping über /k/mapping. hand_neu_verbunden() aus einem anderen Faden: der Controller ist neu verbunden (§7.3 Punkt 2,
  // im nächsten Zyklus Stellwerk::stellung_vergessen()).
  static constexpr int MAX_MIDI = 256;
  void hand_midi(const uint8_t* daten, size_t groesse, uint32_t versatz) noexcept;
  // Studio S5: MIDI der Erzeuger-Ströme dieses Zyklus je Port (1..ERZ_MIDI_PORTS), gültig bis zum nächsten zyklus().
  const MidiAus& midi_aus(int port) const { return midi_aus_[std::clamp(port, 1, ERZ_MIDI_PORTS) - 1]; }
  // Studio S5: Rückweg eines Wirts auf erz/<erz> (1..8) für den NÄCHSTEN zyklus(); nullptr = keiner. Der Aufrufer
  // (main.cpp) setzt ihn vor jedem zyklus() mit den JACK-Puffern dieses Zyklus; n Samples ab Index 0 werden gelesen.
  void rueck(int erz, const float* l, const float* r) noexcept {
    if (erz >= 1 && erz <= 8) { rueck_l_[erz - 1] = l; rueck_r_[erz - 1] = r; }
  }
  void setze_mapping(const hand::Mapping* m) noexcept;
  const hand::Mapping* mapping() const noexcept { return mapping_; }
  void hand_neu_verbunden() noexcept { neu_verbunden_.store(true, std::memory_order_release); }
  uint64_t hand_ohne_wirkung() const noexcept { return hand_ohne_wirkung_; }  // Ereignisse ohne Wirkung im MVP
  uint64_t hand_ueberlauf() const noexcept { return hand_ueberlauf_; }        // über MAX_MIDI je Zyklus verworfen
  uint64_t hand_ereignisse() const noexcept { return hand_ereignisse_; }      // übersetzte Ereignisse mit Wirkung
  // Deck-Taste der Hand (play, cue) am Sample s, auch aus /test/hand deck/<n>/play|cue (Plan 35 E5): wert 1 Druck, 0
  // Loslassen. Rückgabe false: ohne Wirkung (Deck leer, Tempo ungleich Basis, Loslassen ohne Vorschau).
  bool hand_deck_taste(int deck, bool play, int32_t wert, int64_t s) noexcept;
  // Taste der Hand am Sample s (Controller und /test/hand taste/<name>): /e/taste, die Stopp-Taste wirkt wie /k/ki/stopp.
  bool hand_taste(hand::Taste t, int32_t wert, int64_t s) noexcept;
  int64_t cue_punkt(int deck) const noexcept { return cue_frame(deck - 1); }  // Frame; für Tests

 private:
  void melde(const Ereignis& e);
  void quittung(int64_t id, const char* quelle, int32_t status, int64_t s, double b, const char* grund = "");
  void einsortieren(const Befehl& c);
  struct KlickZiel {  // Scheibe 25: Prüfklick je Kanal (Z1); Index 0..17 Mixer-Kanal, KLICK_MASTER = master
    bool quittung_offen = false;
    int64_t id = 0;
    char quelle[48] = {};
    int64_t seit_sample = 0;
    double seit_beat = 0.0;
  };
  // Scheibe 25 (kern_stellwerk.cpp)
  void einsortieren25(const Befehl& c);
  void set_neu_teile_ab();
  void klick_befehl(const Befehl& c, double beat0);
  void audio(int64_t n0, int n);
  void huellen_block(int64_t s0, int m, const float* cue_l, const float* cue_r);  // Ohr (§6.2)
  void pegel_melden(int64_t n0, int n);
  void ereignisse_uebernehmen();
  void teile_nachreichen();
  // Scheibe 31 (kern_deck.cpp)
  void decks_anlegen();
  void einsortieren31(const Befehl& c);
  void decks_uebernehmen();
  void decks_zustand(int64_t n0, int n);
  void boxen_zustand(int64_t n0, int n);  // Keylock 7b.3: /zustand/box (§5.5b), Takt wie decks_zustand
  void decks_block(int64_t s0, int m);
  void decks_verlauf(int regler, const float* verlauf);
  void keylock_verlauf(int regler, const float* verlauf, int64_t s0, int m);  // Keylock Task 3: Regler keylock am Sample
  void decks_verlauf_ende(int m);
  void decks_frist(int64_t n0, int n);
  void decks_abbruch(const char* quelle, const char* plan);
  void decks_set_neu();
  void deck_ausfuehren(DeckAktion& a, int64_t s);
  void entladen_ausfuehren(int d, int64_t id, const char* quelle);  // Keylock Task 2b: sofort oder wartend (Vertrag 4)
  void keylock_uebernehmen() noexcept;  // Keylock Task 2d: gestellte Vorgabe im Callback an die Decks hängen
  void keylock_wecken() noexcept;       // Keylock Task 2.5: am Ende jedes Zyklus Vorbereiter und Arbeits-Threads wecken
  void keylock_antrieb() noexcept;      // Bungee S2: am Ende jedes Zyklus Post und Dehner aller Quellen selbst fahren (ohne Fäden)
  bool keylock_faeden_starten();        // Task 2.5b: nur noch aus keylock_bauen (erst Fäden, dann Vorgabe)
  struct KlBereichRoh {
    uintptr_t a, e;
  };
  void keylock_sperren(const std::vector<KlBereichRoh>& vorher);  // Task 2.5c
  float effektiv_db(int d) const noexcept;
  // Scheibe 31, Neustart (kern_deck_zustand.cpp): Decks und wartende Deck-Befehle ins Echtzeit-Fach und zurück
  int decks_abbild(cdj_z_echtzeit& f, int n) const noexcept;
  void decks_wiederherstellen(const cdj_z_echtzeit& f) noexcept;
  // Scheibe 35 (kern_hand.cpp)
  void hand_zyklus(int64_t n0, int n);
  bool hand_deck(int deck, hand::DeckAktion aktion, hand::Quant quant, int32_t wert, int64_t s);
  void hand_ausfuehren(DeckAktion& a, int64_t s);
  DeckAktion* hand_aktion_neu(int d, int art, int64_t s, int64_t f);
  int64_t cue_frame(int d) const noexcept;
  // Ohr T14: DeckModell für PrueferI3 (kern_stellwerk.cpp), bindet i3.h an die vier Decks von Scheibe 31. Eigene
  // ReglerTabelle (§1.5 fest verdrahtet, dieselbe wie jeder Lauf baut), damit sie vor sw_ existieren kann.
  class DeckModellImpl : public cypherdj::stellwerk::DeckModell {
   public:
    explicit DeckModellImpl(const std::unique_ptr<DeckWerk>& decks) : decks_(decks) {}
    bool inhalt(int kanal, cypherdj::stellwerk::Inhalt& aus) const override;
    double quell_beat_bei(int kanal, int64_t sample) const override;

   private:
    bool deck_nr_von_kanal(int kanal, int& deck_nr) const;
    cypherdj::stellwerk::ReglerTabelle tab_;
    const std::unique_ptr<DeckWerk>& decks_;
  };
  Tempoplan plan_;
  KernUhr uhr_{plan_};
  cypherdj::stellwerk::HoerscheinRegister hoerschein_reg_;  // Ohr T14
  std::unique_ptr<cypherdj::stellwerk::Stellwerk> sw_;
  std::unique_ptr<Mixer> mixer_;
  Klick klick_;
  cdj_ring_kopf* ring_;
  Befehlsring* befehle_;
  Ereignisring* ereignisse_;
  int64_t sample_ = 0;
  uint64_t w_ = 0;
  int32_t generation_ = 0;
  bool neue_zeitachse_ = false;
  uint64_t verloren_ = 0;
  // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 1): /e/mitschnitt ist die einzige Fertigmeldung und trägt den Puffer.
  // Passt es nicht in den Ring, wartet es hier und wird am Anfang jedes Zyklus zuerst versucht. Mehr als ein
  // Mitschnitt läuft nie (ueberlappung), 4 Plätze reichen für fertig + abgebrochen + Reserve.
  Ereignis mitschnitt_wartet_[4]{};
  int mitschnitt_wartend_ = 0;
  void mitschnitt_nachreichen();
  int64_t takt_letzt_ = -1;      // Sample des zuletzt begonnenen Takts (-1: noch keiner in dieser Zeitachse)
  int64_t takt_vorletzt_ = -1;   // Sample des Takts davor
  double takt_letzt_beat_ = 0.0;
  bool klick_quittung_offen_ = false;
  int64_t klick_id_ = 0;
  char klick_quelle_[48] = {0};
  int64_t klick_seit_sample_ = 0;  // Scheibe 18: Sample und Beat der letzten Klick-Quittung (für /q/stand)
  double klick_seit_beat_ = 0.0;
  bool pruef_cue_ = false;         // Scheibe 18
  bool pruefmodus_ = false;        // Scheibe 25, B7
  // Ohr (§6.2): Hüllkurven-Ring, ein Analysator je Kanal (auf dem Heap, vertrag_baender()), im Konstruktor angelegt.
  cdj_huellen_kopf* huellen_ = nullptr;
  static constexpr int HUELLEN_KANAELE = CDJ_HUELLEN_KANAELE;  // 16 Ring-Kanäle (§6.2), nicht MIX_KANAELE (18)
  std::unique_ptr<cypherdj::dsp::AnalyseBaender> huellen_an_[HUELLEN_KANAELE];
  int64_t huellen_naechstes_s0_ = -1;  // erwartetes nächstes s0; weicht ein Block ab (M1), werden alle 16 neu ausgerichtet
  static constexpr int HUELLEN_MAX_FENSTER = MIX_BLOCK / 48 + 1;  // MINOR 4: fest statt VLA
  cypherdj::dsp::HuellenWerte huellen_werte_[HUELLEN_KANAELE][HUELLEN_MAX_FENSTER];  // Puffer, nicht im Callback allokiert
  // Scheibe 25
  Klick kanal_klick_[MIX_KANAELE];
  // Plan 2026-09-27 (Strudel Stufe 1): Erzeuger-Schlange und Kit-Stimmen, Eingänge der Mixer-Kanäle
  std::unique_ptr<Erzeuger> erz_;
  float* erz_l_[MIX_KANAELE] = {};
  MidiAus midi_aus_[ERZ_MIDI_PORTS];
  int64_t zyklus_n0_ = 0;
  int64_t rueck_unendlich_ = 0;  // Audit F01: nicht endliche Samples am Wirt-Rückweg (verworfen)
  const float* rueck_l_[8] = {};
  const float* rueck_r_[8] = {};
  float* erz_r_[MIX_KANAELE] = {};
  // MVP 2 (ADR 025): Loop-Boxen in pad/1, pad/2; Eingänge wie erz_l_/erz_r_
  std::unique_ptr<LoopBoxen> loops_;
  void loops_frei(int64_t sample);  // Keylock: was die Boxen loswerden (LoopBoxen::abholen) als LOOP_ALT zurück
  void loop_melden(int box, int64_t sample, double beat);  // /e/loop (§5.11) aus dem Stand der Box
  // MVP 2 Scheibe 2: /e/mitschnitt (§5.11) aus dem Mitschnitt selbst (status 0 fertig, 1 abgelehnt oder abgebrochen)
  void mitschnitt_melden(const Mitschnitt* mt, int32_t status);
  KlickZiel kanal_klick_q_[MIX_KANAELE];
  TeilSchatten schatten_;
  HandSchlange hand_;
  int ki_stufe_ = 0;
  char ki_spur_[128] = {0};        // zuletzt vom Stellwerk angenommene KI-Spur (Quittung fertig)
  char ki_spur_neu_[128] = {0};
  int64_t ki_spur_id_ = 0;
  bool ki_stopp_wieder_ = false;   // Neustart: KI-Stopp nachreichen
  int16_t mensch_wieder_[64] = {};  // Neustart: Regler mit Halter mensch
  int n_mensch_wieder_ = 0;
  int nachreichen_in_ = 0;         // Neustart: im zweiten Zyklus der Generation Teile ins Stellwerk nachreichen
  float links_[MAX_BLOCK];
  float rechts_[MAX_BLOCK];
  float cue_l_[MAX_BLOCK];
  float cue_r_[MAX_BLOCK];
  // Scheibe 31
  std::unique_ptr<DeckWerk> decks_;
  LaderRinge* lader_ = nullptr;
  // Ohr T14: DeckModellImpl braucht die Referenz auf decks_ (oben), darum erst hier angelegt, aber vor sw_ im
  // Konstruktor gefüllt (Zuweisung im Rumpf, nicht in der Init-Liste: decks_ existiert als leerer unique_ptr schon).
  std::unique_ptr<DeckModellImpl> deck_modell_;
  std::unique_ptr<cypherdj::stellwerk::PrueferI3> pruefer_i3_;
  float ziel_lufs_ = -16.0f;
  float hoerbar_db_ = -26.0f;
  // Scheibe 35: MIDI eines Zyklus roh (Bytes und Versatz), übersetzt in hand_zyklus()
  struct MidiRoh {
    uint8_t d[3];
    uint8_t groesse;
    uint32_t versatz;
  };
  MidiRoh midi_[MAX_MIDI];
  int n_midi_ = 0;
  HandEin hand_ein_;
  const hand::Mapping* mapping_ = nullptr;
  uint64_t hand_ohne_wirkung_ = 0;
  uint64_t hand_ueberlauf_ = 0;
  uint64_t hand_ereignisse_ = 0;
  std::atomic<bool> neu_verbunden_{false};
};

}  // namespace cdj
