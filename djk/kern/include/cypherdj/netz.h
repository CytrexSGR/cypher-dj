// Nicht-Echtzeit-Faden des Kerns: nimmt OSC-Befehle über UDP an (SCHNITTSTELLEN.md §4.1, §4.2, ROADMAP Z1), prüft
// Form (Adresse und Typen gegen die erzeugte osc_adressen.h) und Bereiche, reicht sie über den Befehlsring in den
// Callback und schickt die Ereignisse des Callbacks als /uhr, /takt, /q, /e/luecke, /e/quantum und 20-mal je Sekunde
// /zustand/kern an alle Abonnenten (§5). Abonnenten: höchstens 8, gestrichen nach 5 s ohne /k/hallo (§4.1).
// Scheibe 01, erweitert in Scheibe 08.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "cypherdj/keylock_render.h"
#include "cypherdj/osc.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/telemetrie.h"
#include "cypherdj/zustand_datei.h"

namespace cdj {

constexpr int MAX_ABONNENTEN = 8;
constexpr int64_t ZUSTAND_ABSTAND_NS = 50'000'000LL;  // §5.4: 20 Hz
constexpr const char* KERN_VERSION = "0.5.0-djk31";

struct Abonnent {
  char name[48];
  int port;
  bool aktiv;
  int64_t zuletzt_ns;        // CLOCK_MONOTONIC des letzten /k/hallo
  int32_t protokoll;         // Scheibe 18: für den Neustart-Zustand (§6.3)
  int32_t hallo_generation;  // Scheibe 18: Generation seines letzten /k/hallo, -1: in dieser noch keins
};

class Netz {
 public:
  // port 0 bindet einen freien Port (Tests); port() nennt den gebundenen. frist_ns: Abonnent ohne /k/hallo so lange
  // wird gestrichen (§4.1: 5 s; Tests setzen weniger).
  Netz(int udp_port, bool pruefmodus, Befehlsring* befehle, Ereignisring* ereignisse,
       int64_t frist_ns = 5'000'000'000LL);
  ~Netz();
  bool offen() const { return sock_ >= 0; }
  int port() const { return port_; }
  void laufen(const std::atomic<bool>& stop);         // bis stop: empfangen, verarbeiten, Ereignisse senden
  void paket(const char* p, size_t n);                // ein empfangenes Paket verarbeiten (Uhr: jetzt)
  void paket(const char* p, size_t n, int64_t jetzt_ns);
  void ereignisse_senden();                           // Ereignisse des Callbacks an die Abonnenten
  void zustand_senden(int64_t jetzt_ns);              // /zustand/kern aus dem Fenster der letzten Sekunde
  void abonnenten_pruefen(int64_t jetzt_ns);          // streicht Abonnenten, deren letztes /k/hallo älter als frist_ns ist
  int abonnenten() const;
  // Scheibe 35, Befund B-O Weg 1 (kern.toml hand_osc): /test/hand auch ohne Prüfmodus annehmen (Hand-Weg der Oberfläche).
  // Alle anderen /test/*-Adressen bleiben an den Prüfmodus gebunden.
  void setze_hand_osc(bool an) { hand_osc_ = an; }
  // Scheibe 35 /k/mapping: Ordner der Mapping-Dateien (<Konfig>/controller), Nicht-Echtzeit-Faden liest und prüft sie
  void setze_controller_ordner(std::string ordner) { controller_ordner_ = std::move(ordner); }
  // Plan 2026-09-27 (ADR 024): Ordner der Kits (~/.config/cypherdj/kits), /erz/strom kit:<name> liest <ordner>/<name>/
  void setze_kit_ordner(std::string ordner) { kit_ordner_ = std::move(ordner); }
  // MVP 2 (ADR 025): Loop-Ordner (§4.9), /k/loop/laden liest <ordner>/<name>/
  void setze_loop_ordner(std::string ordner) { loop_ordner_ = std::move(ordner); }
  // Keylock Slice 3: Einstellungen des Render-Fadens (Test-Zugang: Render-Funktion, Ruhezeit des Tempos, Priorität). Vor dem
  // ersten Auftrag; der Faden entsteht erst mit ihm.
  void setze_keylock(const KeylockOpt& o) { kl_opt_ = o; }
  // Keylock Slice 3b (F6): Shutdown. Bricht einen laufenden Render ab und startet keinen weiteren (auch nicht aus
  // ereignisse_senden() nach dem Stopp des Netz-Fadens). laufen() ruft es am Ende selbst; Tests rufen es direkt.
  void keylock_beenden();

  // Scheibe 18, Abonnenten über einen Neustart (SCHNITTSTELLEN §4.1, §5.1, §5.9, §6.3). Beide vor dem Netz-Faden.
  // verbinde_zustand: Abonnenten bei jeder Änderung und jedem /k/hallo ins Abonnenten-Fach schreiben, /q/stand aus
  // dem neuesten Echtzeit-Fach lesen. nullptr: wie Scheibe 08 (kein Fach, kein /q/stand).
  void verbinde_zustand(cdj_z_datei* d, uint64_t letzter_abo_stand);
  // setze_abonnenten: gespeicherte Abonnenten übernehmen; ihre 5-s-Frist beginnt mit jetzt_ns neu.
  void setze_abonnenten(const cdj_z_abonnent* a, int n, int64_t jetzt_ns);
  int32_t generation() const { return stand_generation_; }
  // Scheibe 25: Verteilung der Callback-Dauer seit dem Start (für die Schlusszeile des Hauptprogramms)
  const Verteilung& verteilung() const { return verteilung_; }

 private:
  void an_alle(const osc::Schreiber& s);
  void an_port(int port, const osc::Schreiber& s);
  void protokollfehler(const char* adresse, const char* grund, int nur_port);
  void quittung(int64_t id, const char* quelle, int32_t status, int64_t s, double b, const char* grund);
  // melden = false (interne Befehle, Keylock-Variante): bei vollem Ring keine /q-Meldung und keine stderr-Zeile, das meldet der
  // Aufrufer; "keylock" ist keine der sechs Vertragsquellen (osc_adressen.h) und ein Abonnent kennt keine Befehlsnummer 0
  bool einreihen(const Befehl& b, bool melden = true);
  void hallo(const osc::Nachricht& m, int64_t jetzt_ns);
  void sende_neustart(int nur_port);  // Scheibe 18: /e/neustart an einen Port, 0 = an alle
  void sende_stand(int port);         // Scheibe 18: /q/stand je offenem Befehl
  void schreibe_abonnenten();         // Scheibe 18: Abonnenten-Fach
  // Scheibe 31 (netz_deck.cpp): /k/deck/laden, entladen, start, stopp annehmen (false: keine dieser Adressen) und
  // /zustand/deck, /e/geladen, /e/frist senden (false: kein Deck-Ereignis)
  bool deck_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  bool deck_ereignis(const Ereignis& e);
  // Plan 2026-09-27 (netz_erz.cpp): /erz/strom annehmen (false: keine Erzeuger-Adresse), Fenster-Bundles prüfen und
  // weiterreichen, /erz/quittung senden und Freigaben erledigen (false: kein Erzeuger-Ereignis)
  bool erz_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  void erz_bundle(const char* p, size_t n);
  bool erz_ereignis(const Ereignis& e);
  std::string kit_ordner_;
  // MVP 2 (netz_loop.cpp): /k/loop/* annehmen (false: keine Loop-Adresse), /e/loop senden, Freigaben
  bool loop_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  bool loop_ereignis(const Ereignis& e);
  std::string loop_ordner_;
  // Keylock Slice 3 (netz_loop.cpp): Render-Faden, Kopie der Originale je Box, Auslöser. Alles nur im Netz-Faden.
  static constexpr int KEYLOCK_BOXEN = 2;  // = LOOP_BOXEN (static_assert in netz_loop.cpp)
  void keylock_tempo(double bpm);    // aus /uhr: seit wann ist das Tempo unverändert?
  void keylock_zyklus();             // Ergebnisse abholen und einreihen, Aufträge auslösen
  bool keylock_bereit();             // Render-Faden da (beim ersten Gebrauch gebaut); false: Keylock aus (Slice 3b, F5)
  void keylock_alt(const void* zeiger);  // Slice 3b (F2): ein Loop kam über LOOP_ALT zurück (abgewiesen oder abgelöst)
  KeylockOpt kl_opt_;
  std::unique_ptr<KeylockRender> kl_;
  bool kl_aus_ = false;              // der Render-Faden ließ sich nicht bauen: nie wieder versuchen
  bool kl_beendet_ = false;          // Shutdown: nichts mehr auslösen oder einreihen
  // Slice 3b (F2): geladene Loops je Box in der Reihenfolge des Einreihens (Zeiger, Kopie). Der Kern nimmt ein Laden an oder
  // weist es ab (Stopp Cypher); abgewiesen kommt derselbe Zeiger über LOOP_ALT zurück, ein abgelöster Loop ebenso. Aktuell
  // ist der letzte Eintrag, der nicht zurückkam: kl_quelle_ folgt ihm.
  struct KlGeladen {
    const void* zeiger;
    std::shared_ptr<const KeylockQuelle> quelle;
  };
  std::vector<KlGeladen> kl_geladen_[KEYLOCK_BOXEN];
  std::shared_ptr<const KeylockQuelle> kl_quelle_[KEYLOCK_BOXEN];          // Original je Box (Kopie)
  std::shared_ptr<const KeylockQuelle> kl_auftrag_quelle_[KEYLOCK_BOXEN];  // zuletzt beauftragt (Quelle, Tempo) je Box
  double kl_auftrag_bpm_[KEYLOCK_BOXEN] = {0.0, 0.0};
  double kl_bpm_ = 0.0;      // Tempo, an dem die Ruhezeit hängt (Anker; ändert sich nur bei |Δ| >= 1e-9)
  int64_t kl_seit_ns_ = 0;   // steady_clock, seit wann kl_bpm_ gilt
  int sock_ = -1;
  int port_ = 0;
  bool pruefmodus_;
  bool hand_osc_ = false;
  std::string controller_ordner_;
  int64_t frist_ns_;
  Befehlsring* befehle_;
  Ereignisring* ereignisse_;
  Abonnent abo_[MAX_ABONNENTEN] = {};
  Zustandsfenster fenster_;
  int64_t stand_sample_ = 0;
  double stand_beat_ = 0.0;
  double stand_bpm_ = 0.0;
  int32_t stand_generation_ = 0;
  int64_t neustart_sample_ = 0;                    // Scheibe 18: erstes Sample der laufenden Generation
  int32_t fx_routing_stand_ = 0;                   // Ohr T17: zuletzt gemeldetes FX-Routing (0 Post Fader = Vorgabe des Kerns)
  cdj_z_datei* zustand_ = nullptr;                 // Scheibe 18
  FachSchreiber<cdj_z_abos> abo_schreiber_;        // Scheibe 18
  std::unique_ptr<cdj_z_befehl[]> stand_puffer_;   // Scheibe 18: CDJ_Z_BEFEHLE Einträge
  // Scheibe 25
  std::unique_ptr<cypherdj::stellwerk::ReglerTabelle> tabelle_;  // Pfade für /test/hand (dieselbe wie im Stellwerk)
  Verteilung verteilung_;
  int32_t ki_gestoppt_ = 0;                        // aus /e/ki, für /zustand/kern
};

}  // namespace cdj
