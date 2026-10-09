// Buchführung der Decks im Kern (Scheibe 31, kern_deck.cpp): vier Decks im Direktweg, wartende Deck-Befehle
// (start, stopp) mit Ziel-Beat, offene Lade- und Entlade-Befehle, Regler-Indizes für offen und hörbar (§1.6), Frist-
// Meldungen (§5.9 /e/frist) und der Takt der Zustandsmeldung (§5.5, 50 Hz). Alles feste Felder: echtzeitfest.
#pragma once

#include <pthread.h>
#include <semaphore.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>

#include "cypherdj/deck.h"
#include "cypherdj/dehner.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/streck_quelle.h"
#include "cypherdj/stellwerk/regler.h"

namespace cdj {

constexpr int MAX_DECK_AKTIONEN = 64;
constexpr int DECK_ZUSTAND_ABSTAND = 960;  // §5.5: 50 Hz bei 48 kHz

struct DeckAktion {
  bool belegt = false;
  uint8_t art = 0;         // 1 start, 2 stopp; Hand (Scheibe 35): 3 Position setzen, 4 stopp und danach zum Cue-Punkt;
                           // Plan E9: 5 loop, 6 sprung, 7 hotcue; Welle 3: 8 basis_tausch (Material in tausch_m)
  uint8_t politik = 0;     // §16.1: 0 musik, 1 zustand, 2 raster (Plan E9)
  bool verschoben = false; // Plan E9: Politik 2 hat das Ziel auf den nächsten Rasterpunkt gelegt (Quittung 5)
  bool verspaetet = false; // Politik 1, Ziel-Sample beim Einsortieren schon vorbei: am Blockanfang ausführen
  int32_t deck = 0;        // 1 bis 4
  uint32_t seq = 0;        // Reihenfolge der Deck-Befehle (ein späteres Laden verwirft frühere Befehle)
  int64_t id = 0;
  int64_t spaet_sample = 0;  // verspaetet: Ausführungs-Sample
  double ab_beat = 0.0;
  double quell_beat = 0.0;
  double wert_beats = 0.0;   // Plan E9: loop laenge_beats, sprung delta_beats
  int32_t nr = 0;            // Plan E9: hotcue 1 bis 8
  char quelle[48] = {};
  char plan[32] = {};
  char gruppe[40] = {};
  char hoerschein[40] = {};
  // Scheibe 35: Deck-Taste der Hand (play, cue): wirkt am Sample ziel_sample, keine Quittung, nie im Neustart-Zustand
  bool hand = false;
  int64_t ziel_sample = 0;   // hand: Ausführungs-Sample (statt sample_at(ab_beat))
  int64_t ziel_frame = 0;    // hand: art 1 Startframe, art 3 neue Position
  bool loop_halten = false;  // hand: Play/Pause behalten den Loop (Plan E9, Review F2)
};

struct DeckRegler {  // Indizes in der Regler-Tabelle des Stellwerks, -1 wenn es ihn nicht gibt
  int16_t trim = -1, fader = -1, pfl = -1, ziel = -1, xseite = -1;
  int16_t stem[STEM_ANZAHL] = {-1, -1, -1, -1};
};

// Keylock Task 2.5 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4.1 Punkt 2; Übergabe-Vertrag 3, 12, 14, 18): die Fäden
// des Keylocks im Kern. Platz 0 der Vorbereiter (ein Faden für alle Decks, NICHT der Lade-Faden), 1 bis 4 der Arbeits-
// Thread je Deck, 5 der Wächter. Angelegt von Kern::keylock_faeden_starten (außerhalb des Callbacks), beendet von
// stoppe() (Kern::keylock_faeden_stoppen, ~Kern, spätestens ~DeckWerk: dieses Feld steht hinter den Dehnern und wird
// darum vor ihnen abgebaut). Der Callback weckt Vorbereiter und Arbeits-Threads je Zyklus über die Semaphoren
// (sem_post: wartefrei, keine Sperre; Vorlage M3 m3deck.cpp arbeiter, dort ebenso je Zyklus); jeder Faden wartet höchstens
// KEYLOCK_TAKT_MS und arbeitet dann auch ohne Wecken (Ende, Callback steht).
// Keylock Task 7 (Detailschnitt 7a 3.6): Quellen statt Decks. Quelle 0 bis 3 die Decks, 4 und 5 die Loop-Boxen; Platz 0
// der Vorbereiter, 1 bis KEYLOCK_QUELLEN die Arbeits-Threads (Deck 1 bis 4, Box 1 und 2), danach der Wächter.
constexpr int KEYLOCK_QUELLEN = DECKS + LOOP_BOXEN;
constexpr int KEYLOCK_FAEDEN = KEYLOCK_QUELLEN + 2;
constexpr int KEYLOCK_WAECHTER_FRIST_MS = 500;  // Fassung 4.1 Punkt 2: nicht quittiert binnen dieser Frist -> Meldung
constexpr int KEYLOCK_TAKT_MS = 20;             // längstes Warten ohne Wecken (Arbeits-Thread, Vorbereiter)
constexpr int KEYLOCK_WAECHTER_TAKT_MS = 50;
constexpr std::size_t KEYLOCK_STAPEL = 1u << 20;  // 1 MiB je Faden (mlockall MCL_CURRENT sperrt den Stapel ganz, M3: 8 MiB)
struct KeylockFaeden {
  pthread_t t[KEYLOCK_FAEDEN] = {};
  bool an[KEYLOCK_FAEDEN] = {};  // Faden angelegt (nur der startende/stoppende Faden)
  sem_t sem[KEYLOCK_FAEDEN];     // Wecker je Faden
  std::atomic<bool> laeuft{false}, stop{false};
  std::atomic<uint64_t> herz[KEYLOCK_FAEDEN] = {};  // Durchgänge je Faden
  std::atomic<bool> halte[KEYLOCK_QUELLEN] = {};    // nur Tests (Kern::keylock_test_halte): Arbeits-Thread quittiert nicht
#ifdef CYPHERDJ_MUTATION_KEYLOCK_FUELLE_NUR_LAUFEND
  std::atomic<bool> spielt[KEYLOCK_QUELLEN] = {};  // Fehlerfall: vom Callback je Zyklus gesetzt (Deck läuft im Keylock)
#endif
  std::atomic<uint64_t> waechter_meldungen{0}, prio_fehler{0};
  struct Start {
    void* werk;
    int platz;
  } start[KEYLOCK_FAEDEN] = {};
  KeylockFaeden() {
    for (sem_t& s : sem) sem_init(&s, 0, 0);
  }
  ~KeylockFaeden() {
    stoppe();
    for (sem_t& s : sem) sem_destroy(&s);
  }
  KeylockFaeden(const KeylockFaeden&) = delete;
  KeylockFaeden& operator=(const KeylockFaeden&) = delete;
  // Alle Fäden beenden und einsammeln (Join). Nicht im Callback.
  void stoppe() {
    stop.store(true, std::memory_order_release);
    laeuft.store(false, std::memory_order_release);
#ifndef CYPHERDJ_MUTATION_KEYLOCK_STOPP_OHNE_WECKEN
    for (sem_t& s : sem) sem_post(&s);
#endif
    for (int i = 0; i < KEYLOCK_FAEDEN; ++i)
      if (an[i]) {
        pthread_join(t[i], nullptr);
        an[i] = false;
      }
  }
};

struct DeckWerk {
  Deck deck[DECKS];
  DeckRegler reg[DECKS];
  int16_t bus_fader[4] = {-1, -1, -1, -1}, bus_xseite[4] = {-1, -1, -1, -1};
  int16_t xfader = -1, master_pegel = -1;
  int8_t stem_deck[cypherdj::stellwerk::MAX_REGLER];  // Regler-Index -> Deck 0..3 bei stem/*, sonst -1
  int8_t stem_nr[cypherdj::stellwerk::MAX_REGLER];    // Regler-Index -> Stem 0..3
  DeckAktion aktion[MAX_DECK_AKTIONEN];
  uint32_t seq = 0;
  // Scheibe 35: Cue-Punkt (Frame) und Vorschau je Deck; ohne gesetzten Cue-Punkt gilt erste_eins_quell_beat
  int64_t cue_f[DECKS] = {};
  bool cue_gesetzt[DECKS] = {};
  bool vorschau[DECKS] = {};          // Cue gedrückt am Cue-Punkt: das Deck spielt, bis die Taste loslässt
  uint32_t laden_seq[DECKS] = {};     // seq des zuletzt eingereihten Ladens je Deck
  int laden_offen[DECKS] = {};        // Lade-Aufträge beim Lader
  // Stopp-Rampe läuft: Quittung fertig am Ende (§4.4)
  bool stopp_offen[DECKS] = {};
  int64_t stopp_id[DECKS] = {}, stopp_ende[DECKS] = {};
  char stopp_quelle[DECKS][48] = {};
  // Entladen: Quittung fertig, sobald das Material zurückgegeben ist
  const Material* entladen_m[DECKS] = {};
  int64_t entladen_id[DECKS] = {};
  char entladen_quelle[DECKS][48] = {};
  // Rückgaben, die der volle Ring noch nicht nahm
  const Material* rueck_warte[8] = {};
  int n_rueck_warte = 0;
  // Frist (§5.9 /e/frist bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks): gemeldete Schwellen je Lauf
  uint8_t frist_gemeldet[DECKS] = {};
  bool leer_melden[DECKS] = {};       // nach dem Entladen einmal Status 0 melden
  double hotcue[DECKS][8];            // Plan E9: Quell-Beat je Platz 1..8, NaN leer; Laden leert
  // Welle 3 (§4.4 /k/deck/basis_tausch): geladene Fassung, die bei ihrem Ziel-Beat (DeckAktion art 8) getauscht wird.
  // Höchstens eine je Deck; ein neuerer Tausch, Laden oder Entladen gibt sie zurück.
  const Material* tausch_m[DECKS] = {};
  // Neustart (§6.3): Material der Decks, das vor dem Start wieder einzublenden ist
  struct Wieder {
    bool ja = false;
    char material_id[24] = {};
    double basis_bpm = 0.0;
    int32_t fassung = 0, mit_stems = 0;
    bool laeuft = false;
    double anker_master_beat = 0.0, anker_quell_beat = 0.0;
  } wieder[DECKS];
  // Keylock (Plan 2026-10-06-keylock-echtzeit.md, Task 2): je Deck ein Dehner und seine Post, angelegt nur mit
  // Kern::setze_keylock_vorgabe(true) (außerhalb des Callbacks). Die Decks halten Zeiger darauf.
  std::unique_ptr<DehnerBasis> dehner[KEYLOCK_QUELLEN];  // Task 7: 0 bis 3 Decks, 4 und 5 Loop-Boxen
  StreckPost post[KEYLOCK_QUELLEN];
  bool keylock_vorgabe = false;  // übernommen (nur der Callback schreibt)
  // Umbauplan Bungee S2: die Maschine der Dehner (Kern::setze_keylock_maschine, vor dem Bau gestellt). Bungee fährt ohne Fäden:
  // antrieb_sync (vor dem Release von keylock_stand = 1 geschrieben) heißt, der Callback treibt Post und Dehner am Zyklusende
  // selbst (Kern::keylock_antrieb), jeder Faden entfällt.
  DehnerMaschine maschine = DehnerMaschine::R3;
  bool bungee_fein = false;
  bool antrieb_sync = false;
  // Bungee S3: Messung des synchronen Antriebs (nur der Callback schreibt; gelesen erst nach dem Stopp, keylock_schluss_json).
  // Kosten = ganze Dauer von keylock_antrieb je Zyklus (alle Quellen, Ansätze eingeschlossen); Ansätze = wartende Ansätze, die ein
  // Zyklus übernimmt (größter Wert: 6, wenn Knopf oder Ereignisse alle Quellen im selben Zyklus ansetzen lassen).
  DehnerKosten antrieb_kosten;
  uint64_t antrieb_ansaetze_n = 0, antrieb_zyklen_mit_ansatz = 0;
  int antrieb_ansaetze_max = 0;
  // Nachprüfung m5: Übergabe von setze_keylock_vorgabe an den Callback ohne Wettlauf. 0 frei, 3 setze baut die Dehner,
  // 1 gestellt (der nächste zyklus() übernimmt), 2 lief (gesperrt). keylock_soll schreibt setze vor dem Release auf 1.
  std::atomic<int> keylock_stand{0};  // Task 2.5b: 4 angekündigt, keylock_bauen baut (Betrieb)
  bool keylock_soll = false;
  int64_t keylock_ab = -1;            // Task 2.5b: Kern-Sample, ab dem die Dehner hängen (nur der Callback schreibt)
  uint64_t keylock_gesperrt = 0;      // Task 2.5c: von keylock_bauen gesperrte Bytes (nur der bauende Faden schreibt)
  int keylock_sperr_fehler = 0;       // Task 2.5c: errno des ersten gescheiterten mlock, 0 ohne
  // Keylock Task 3 (Fassung 4): der globale Regler `keylock` (EIN Knopf für Decks, Loop-Boxen und Loop auf dem Deck). Nur
  // der Callback liest und schreibt. knopf = Stand am Ende des letzten Verlaufs; knopf_offen: Decks (Bit d), die den Wechsel
  // bei knopf_s noch nicht bekommen haben (decks_block führt ihn am Sample aus, wie einen Deck-Befehl).
  int16_t knopf_regler = -1;
  bool knopf = true;
  int64_t knopf_s = 0;
  uint8_t knopf_offen = 0;
  // Vertrag 4 (Prüfung m4): Laden und Entladen, die auf Platz in der Rückgabeliste des Decks warten (je Deck eins)
  LadeErgebnis lade_warte[DECKS] = {};
  bool lade_wartet[DECKS] = {};
  bool entladen_wartet[DECKS] = {};
  int64_t entladen_warte_id[DECKS] = {};
  char entladen_warte_quelle[DECKS][48] = {};
  // Keylock Task 2.5: hinter dehner und post (Abbau vor ihnen: die Fäden enden, bevor ihre Dehner gehen)
  KeylockFaeden faeden;
  DeckWerk() {
    for (int i = 0; i < cypherdj::stellwerk::MAX_REGLER; ++i) stem_deck[i] = stem_nr[i] = -1;
    for (auto& d : hotcue)
      for (double& h : d) h = NAN;
  }
};

}  // namespace cdj
