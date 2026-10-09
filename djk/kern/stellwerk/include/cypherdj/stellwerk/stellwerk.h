// Stellwerk-RT (Scheibe 11): führt Planteile in Beats sample-genau aus, schlichtet zwischen Hand und Plan,
// bricht Teile samt Gruppe ab, prüft Überlappung (I4), Verspätung und den KI-Stopp, führt die Deck-Halter.
// Ohne JACK, ohne OSC: der Kern (Scheibe 25) ruft die Befehle im Callback vor prozess() auf und holt danach
// Verläufe und Ereignisse ab. Innerhalb eines Samples gilt: Hand zuerst (ein Teil, den ein Griff abbricht, startet nicht
// mehr), dann Starts in Startfolge (Sample, Plan, Nummer), dann Rückgabe an frei.
//
// Öffentliche Kopfdatei = Naht zu Scheibe 25 (Kern) und, über pruefer.h, zu Scheibe 20. Spätere Scheiben ändern
// sie nur additiv (ROADMAP §3). Echtzeit-Regel: alle Methoden außer dem Konstruktor sind frei von Allokation,
// Sperre und I/O; das Objekt ist groß (976 952 Bytes, gemessen mit sizeof) und gehört auf den Heap.
#pragma once
#include <cstdint>

#include "cypherdj/stellwerk/pruefer.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"
#include "cypherdj/stellwerk/uhr.h"

namespace cypherdj::stellwerk {

// /k/teil ,hssisddfiiss (§4.3). Zeichenketten werden kopiert (höchstens 47 Bytes).
struct TeilBefehl {
  int64_t id;
  Quelle quelle;
  const char* plan;        // "" ohne Plan
  int32_t nr;
  const char* pfad;
  double ab_beat;
  double dauer_beats;      // 0 = setzen mit Schaltrampe
  float nach;
  int32_t form;            // 0 linear, 1 S-Kurve
  int32_t politik;         // 0 musik, 1 zustand
  const char* gruppe;      // "" ohne Kopplung
  const char* hoerschein;  // "" oder hs_id (geprüft erst in Scheibe 20)
};

// Ein Griff der Hand (§7.3). Der Kern (Scheibe 35) macht ihn aus JACK-MIDI, der Prüfeingang aus /test/hand (§19.0).
enum class GriffArt : uint8_t { absolut, relativ, beruehrung, freigabe };
struct Griff {
  int64_t sample;        // Sample, an dem der Griff wirkt
  int16_t regler;        // Index in der Regler-Tabelle
  GriffArt art;
  float x;               // absolut: Stellung 0..1 (midi_roh); relativ: Änderung in Stellungs-Einheiten
  const Kurve* kurve;    // nullptr = Standard-Kurve des Reglers; sonst gültig bis nach dem prozess(), der den Griff anwendet
};

// Verlauf eines Reglers im letzten Zyklus: verlauf[i] ist der Wert am Sample s0 + i.
struct Aenderung {
  int16_t regler;
  const float* verlauf;
};

struct Zaehler {
  int64_t ereignisse_verloren = 0;  // Ausgabepuffer voll
  int64_t hand_verloren = 0;        // Griff-Warteschlange voll
  int64_t teile_voll = 0;           // Teil abgelehnt, weil MAX_TEILE offen sind
  int64_t bewegt_voll = 0;          // mehr als MAX_BEWEGT Regler in einem Zyklus bewegt
  int64_t zyklen_ruhig = 0;         // Zyklen ohne Bewegung (schneller Pfad)
  int64_t zyklen_voll = 0;          // Zyklen mit Rechnung je Sample
  int64_t spruenge = 0;             // prozess() mit s0 != jetzt()
};

class Stellwerk {
 public:
  explicit Stellwerk(const Uhr& uhr, Pruefer* pruefer = nullptr);   // nullptr: leere Standard-Implementierung
  Stellwerk(const Stellwerk&) = delete;
  Stellwerk& operator=(const Stellwerk&) = delete;

  // ---- Befehle: wirken ab jetzt() (Anfang des nächsten Zyklus) ----
  void teil(const TeilBefehl& b);
  void abbruch(int64_t id, Quelle quelle, const char* plan, const int32_t* nrs, int anzahl);   // anzahl < 0: "*"
  void ki_stopp(int64_t id, Quelle quelle);          // id 0: Stopp-Taste, ohne Quittung (§7.3 Punkt 8)
  void ki_frei(int64_t id, Quelle quelle);           // id 0: Freigabe plus Stopp, ohne Quittung
  void ki_spur(int64_t id, Quelle quelle, const char* kanaele);   // "deck/3,deck/4,erz/1"
  void hand(const Griff& g);
  void deck_taste(int deck, int64_t sample);         // Transport-Taste: Deck-Halter mensch für 32 Beats (§7.3 Punkt 5)
  bool deck_beruehrt(int deck) const;                // §4.4: cypher-Deck-Befehl dann abgelehnt (deck_beruehrt)
  void stellung_vergessen();                         // Controller neu verbunden (§7.3 Punkt 2)
  void stems_geladen(int deck, bool ja);             // §1.5: stem/* nur bei Deck mit Stems
  void setze_direkt(int regler, float wert);         // Laden, Anfangszustand: ohne Teil, ohne Quittung

  // ---- ein Zyklus [s0, s0 + n), n <= BLOCK_MAX ----
  void prozess(int64_t s0, int n);

  // ---- Ausgaben ----
  int aenderungen(const Aenderung** aus) const { *aus = aend_; return n_aend_; }
  float wert(int regler) const { return reg_[regler].wert; }
  // F18 (Welle 2): Wert nach außen (Neustart-Zustand, Tasten-Umschalter, /e/regler, Prüfer-Sicht). Läuft eine
  // Hand-Schaltrampe (kill/*), ihr Ziel 0/1; sonst der Wert. Der Verlauf je Sample (aenderungen) trägt die Rampe.
  float wert_fest(int regler) const { return fest(reg_[regler]); }
  const Halter& halter(int regler) const { return reg_[regler].halter; }
  bool ki_gestoppt() const { return ki_gestoppt_; }
  int ereignisse(const Ereignis** aus) const { *aus = ereignis_; return n_ereignis_; }
  void ereignisse_leeren() { n_ereignis_ = 0; }
  int64_t jetzt() const { return jetzt_; }
  const ReglerTabelle& tabelle() const { return tab_; }
  const Uhr& uhr() const { return uhr_; }
  const Zaehler& zaehler() const { return z_; }

 private:
  friend class SichtImpl;

  struct Teil {
    bool belegt;
    Status status;            // angenommen oder gestartet
    int64_t id;
    Quelle quelle;
    char plan[TEXT];
    char gruppe[TEXT];
    char hoerschein[TEXT];
    int32_t nr;
    int16_t regler;
    double ab_beat, dauer_beats;
    float nach;
    uint8_t form, politik;
    bool verspaetet;          // Politik 1, Ziel-Sample beim Einsortieren schon vorbei
    bool intern;              // vom Stellwerk selbst angelegt (KI-Stopp), ohne Quittung
    bool angehalten;          // I2 über Eingriff::anhalten
    bool im_zyklus;           // Startkandidat dieses Zyklus (vorgemerkt), startet bei start_sample
    uint32_t seq, plan_seq;
    int64_t start_sample;
    // beim Start gesetzt
    bool setzen_modus;
    float wA, ziel_intern;
    double bA, ende_beat;
    int32_t schalt;
    int64_t sA;
  };

  struct ReglerZustand {
    float wert;
    Halter halter;
    float phys, anker, rel_summe;
    bool phys_bekannt;
    double hand_beat;
    int16_t laufend;          // Index des laufenden Teils oder -1
    int16_t slot;             // Verlaufs-Slot in diesem Zyklus oder -1
    bool direkt;              // durch setze_direkt geändert, erscheint im nächsten Verlauf
    float gemeldet;
    int64_t gemeldet_sample;
    bool ausstehend;
    float hand_wert;
    int64_t hand_sample, hand_gemeldet_sample;
    bool hand_ausstehend;
    // F18 (Welle 2): Schaltrampe eines Hand-Griffs an einem Schalter (kill/*), S-Kurve hr_von -> hr_ziel ab hr_sA
    bool hr_an;
    float hr_von, hr_ziel;
    int64_t hr_sA;
    int32_t hr_schalt;
  };
  static float fest(const ReglerZustand& z) { return z.hr_an ? z.hr_ziel : z.wert; }

  // kern.cpp
  Ereignis* neues_ereignis(EreignisArt art, int64_t sample);
  void quittung(const Teil& t, Status st, int64_t sample, Grund g);
  void quittung_befehl(int64_t id, Quelle q, Status st, int64_t sample, Grund g);
  void melde_regler(int r, int64_t sample);
  bool setze_halter(int r, const Halter& h, int64_t sample);   // true: Halter hat gewechselt
  Halter halter_fuer(const Teil& t) const;
  bool haelt(const Halter& h, const Teil& t) const;
  int neuer_teil();
  void laufend_rein(int idx);
  void laufend_raus(int idx);
  void beenden(int idx, Status st, Grund g, int64_t sample, HalterArt halter_neu);
  void beenden_mit_gruppe(int idx, Status st, Grund g, int64_t sample, HalterArt halter_neu);
  void start_parameter(Teil& t, float w0, double beat, int64_t sample) const;
  float wert_von(const Teil& t, int64_t sample, double beat, bool* fertig) const;
  double beat_bei(int64_t sample) const;
  int slot_fuer(int r, int i);
  void setze_wert(int r, int i, float v);
  // hand.cpp
  void hand_anwenden(const Griff& g, int64_t sample, int i, double beat);
  void uebernehmen(int r, int64_t sample);
  bool mensch_bei(int r, int64_t sample, int n_hand_zyklus) const;
  // melder.cpp
  void melde_hand(int r, int64_t sample);
  void melder_zyklusende(int64_t s_letzt);
  // sicht.cpp
  Grund pruefe_vor_start(int idx);
  void pruefe_je_zyklus();
  void pruefe_nach_hand(int r, int64_t sample);
  void melde_gruppe_gefallen(const char* plan, const char* gruppe, Grund g, int64_t sample);
  // ablauf.cpp
  void starte(int idx, int64_t sample, int i, double beat);
  int rechne_strecke(int idx, int i, int j);   // Verlauf des Teils über [i, j); Rückgabe: Index des Endes oder -1
  void rechne_hand_rampe(int r, int i, int j);   // F18: Schaltrampe der Hand über [i, j)

  const Uhr& uhr_;
  Pruefer leer_pruefer_;
  Pruefer* pruefer_;
  ReglerTabelle tab_;
  ReglerZustand reg_[MAX_REGLER];
  Teil teil_[MAX_TEILE];
  int16_t laufende_[MAX_TEILE];
  int n_laufende_ = 0;
  int16_t starts_[MAX_TEILE];
  int n_starts_ = 0;
  Griff hand_[MAX_HAND];
  int n_hand_ = 0;
  Ereignis ereignis_[MAX_EREIGNISSE];
  int n_ereignis_ = 0;
  float verlauf_[MAX_BEWEGT][BLOCK_MAX];
  int verlauf_bis_[MAX_BEWEGT];
  Aenderung aend_[MAX_BEWEGT];
  int n_aend_ = 0;
  double beats_[BLOCK_MAX + 1];
  int16_t ausstehend_regler_[MAX_REGLER];
  int n_ausstehend_regler_ = 0;
  int16_t ausstehend_hand_[MAX_REGLER];
  int n_ausstehend_hand_ = 0;
  int n_mensch_ = 0;
  int n_direkt_ = 0;
  int n_hand_rampen_ = 0;   // F18: Regler mit laufender Hand-Schaltrampe
  bool ki_gestoppt_ = false;
  uint32_t ki_spur_ = 0;      // Bit k = Kanal k gehört zur KI-Spur
  bool stems_[5] = {};
  int64_t jetzt_ = 0;
  int64_t zyklus_s0_ = 0;
  int zyklus_n_ = 0;
  int64_t eingriff_sample_ = 0;
  uint32_t seq_ = 0;
  Zaehler z_;
};

}  // namespace cypherdj::stellwerk
