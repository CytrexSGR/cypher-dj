// Stellwerk-RT: Prüfer-Schnittstelle, die Naht zu Scheibe 20 (Invarianten I1 bis I3, Frist-Wächter, SCHNITTSTELLEN §17).
// Scheibe 11 ruft die Haken an den Stellen auf, die §17 nennt, und liefert eine leere Standard-Implementierung.
// Scheibe 20 leitet von Pruefer ab und füllt die Haken, ohne diese Datei zu ändern; was 20 darüber hinaus braucht
// (Hörschein-Register, Deck-Modell, Deck-Teile), hängt an ihrer abgeleiteten Klasse, nicht an dieser Datei.
//
// Aufrufzeitpunkte (alle im Echtzeit-Faden: keine Allokation, keine Sperre, kein I/O):
//   vor_teilstart    am Anfang des Zyklus, in dem ein Regler-Teil startet, für jeden startenden Teil in Startfolge
//                    (Sample, dann Plan, dann Nummer). Vor dem ersten Aufruf sind alle Startkandidaten des Zyklus
//                    vorgemerkt: pruefwert() zeigt den Zustand nach ALLEN Teilen eines Samples (§17 „Reihenfolge“,
//                    so ist ein Basstausch als Paar gültig), vorher() den Zustand unmittelbar davor, pruefwert_vor()
//                    und pruefwert_mit() den Stand in der Startfolge vor bzw. mit einem bestimmten Teil (wer
//                    öffnet: I1 „Schuld hat der Öffner“, I3a „ein Planteil, der … öffnet“). Rückgabe
//                    != Grund::kein: der Teil wird abgelehnt (Quittung 6 mit diesem Grund, ist_sample = sein
//                    Start-Sample), seine Gruppe fällt mit (Quittung 7, gleicher Grund) und ist ab dann aus der
//                    Vormerkung. Teile, die das Stellwerk selbst anlegt (KI-Stopp-Blende, TeilSicht::intern),
//                    werden nicht vorgelegt.
//   je_zyklus        am Anfang jedes Zyklus nach den Startprüfungen, vor dem ersten Sample. Eingriffe wirken ab dem
//                    ersten Sample des Zyklus.
//   nach_handgriff   nach jedem wirksamen Handgriff an seinem Sample (nicht nach einem ersten Wert, der nur die
//                    Stellung setzt). Eingriffe wirken ab diesem Sample. Die Hand selbst ist dann schon angewandt:
//                    ein Prüfer kann sie nie zurücknehmen (§17 „Die Hand wird nie blockiert“).
//   gruppe_gefallen  nachdem die Teile einer nicht leeren Gruppe beendet wurden (Hand, Prüfer, /k/abbruch, KI-Stopp,
//                    Ablehnung am Start). Für Deck-Teile, die 20 außerhalb der Regler-Tabelle führt (§4.4: sie fallen
//                    mit ihrer Gruppe). Kann aus einem Eingriff heraus kommen; darin kein Eingriff.
#pragma once
#include <cstdint>

#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"
#include "cypherdj/stellwerk/uhr.h"

namespace cypherdj::stellwerk {

struct TeilSicht {
  int index;             // stabil, solange der Teil offen ist; für Eingriff
  int64_t id;
  Quelle quelle;
  const char* plan;
  int32_t nr;
  const char* gruppe;
  const char* hoerschein;
  int16_t regler;
  double ab_beat, dauer_beats;
  float nach;
  uint8_t form, politik;
  Status status;         // angenommen oder gestartet
  bool angehalten;
  bool startet_in_diesem_zyklus;   // vorgemerkt (Startprüfung bestanden oder noch nicht dran)
  int start_rang;        // Platz in der Startfolge dieses Zyklus (0 …), -1 wenn nicht vorgemerkt
  bool intern;           // vom Stellwerk angelegt (KI-Stopp-Blende): Vorgabe für Prüfer wie die Hand, nie blockieren
  int64_t start_sample;  // bei angenommen: nach der Tempo-Karte dieses Zyklus
};

class Sicht {
 public:
  virtual ~Sicht() = default;
  virtual const Uhr& uhr() const = 0;
  virtual const ReglerTabelle& tabelle() const = 0;
  virtual int64_t zyklus_anfang() const = 0;
  virtual int zyklus_laenge() const = 0;
  virtual float wert(int regler) const = 0;                       // Ist-Wert jetzt
  virtual float vorschau(int regler, int64_t sample) const = 0;   // Wert an `sample` im laufenden Zyklus ohne weitere Hand
  virtual float pruefwert(int regler, int64_t sample) const = 0;  // wie vorschau, ein Setzen zählt mit seinem Zielwert (§4.3)
  virtual float vorher(int regler, int64_t sample) const = 0;     // Wert unmittelbar vor `sample` (nach allen früheren Samples)
  virtual float pruefwert_vor(int regler, const TeilSicht& teil) const = 0;   // am Start-Sample des Teils, ohne ihn
  virtual float pruefwert_mit(int regler, const TeilSicht& teil) const = 0;   // am Start-Sample des Teils, mit ihm
  virtual const Halter& halter(int regler) const = 0;
  virtual int offene_teile(TeilSicht* aus, int max) const = 0;    // kopiert höchstens max, gibt die Zahl zurück
  virtual bool ki_gestoppt() const = 0;
};

class Eingriff {
 public:
  virtual ~Eingriff() = default;
  virtual void abbrechen(int teil_index, Grund grund) = 0;   // Teil und Gruppe, Quittung 7, Wert bleibt am Ist-Wert
  virtual void anhalten(int teil_index) = 0;                 // Teil hält am Ist-Wert, bleibt gestartet (I2)
  virtual void fortsetzen(int teil_index) = 0;               // weiter mit unverändertem Ende-Beat; Ende vorbei: Schaltrampe
  virtual void gruppe_abbrechen(const char* plan, const char* gruppe, Grund grund) = 0;   // alle offenen Teile der Gruppe
  virtual void melde_invariante(InvArt art, const char* plan, int32_t teil_nr) = 0;       // /e/invariante (§5.9)
};

class Pruefer {
 public:
  virtual ~Pruefer() = default;
  virtual Grund vor_teilstart(const Sicht& sicht, const TeilSicht& teil) { (void)sicht; (void)teil; return Grund::kein; }
  virtual void je_zyklus(const Sicht& sicht, Eingriff& eingriff) { (void)sicht; (void)eingriff; }
  virtual void nach_handgriff(const Sicht& sicht, Eingriff& eingriff, int regler, int64_t sample) {
    (void)sicht; (void)eingriff; (void)regler; (void)sample;
  }
  virtual void gruppe_gefallen(const Sicht& sicht, const char* plan, const char* gruppe, Grund grund, int64_t sample) {
    (void)sicht; (void)plan; (void)gruppe; (void)grund; (void)sample;
  }
};

}  // namespace cypherdj::stellwerk
