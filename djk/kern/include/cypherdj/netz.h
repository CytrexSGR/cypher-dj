// Nicht-Echtzeit-Faden des Kerns: nimmt OSC-Befehle über UDP an (INTERFACES.md §4.1, §4.2, ROADMAP Z1), prüft
// Form (Adresse und Typen gegen die erzeugte osc_adressen.h) und Bereiche, reicht sie über den Befehlsring in den
// Callback und schickt die Ereignisse des Callbacks als /uhr, /takt, /q, /e/luecke, /e/quantum und 20-mal je Sekunde
// /zustand/kern an alle Abonnenten (§5). Abonnenten: höchstens 8, gestrichen nach 5 s ohne /k/hallo (§4.1).
// Scheibe 01, erweitert in Scheibe 08.
#pragma once
#include <map>
#include <string>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/arr_lader.h"
#include "cypherdj/aufnahme_faden.h"
#include "cypherdj/kern.h"
#include "cypherdj/keylock_render.h"
#include "cypherdj/osc.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/telemetrie.h"
#include "cypherdj/zustand_datei.h"

namespace cdj {

constexpr int MAX_ABONNENTEN = 8;
constexpr int64_t SPEKTRUM_ABSTAND_NS = 40'000'000LL;  // 1.15 A7b, §5.5e: 25 Hz
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

// 1.15 A7b (D11, D12): the analysis side of the spectrum path, on the network thread. tick(jetzt_ns) is called by the 2 ms loop; every 40 ms it
// follows the source change of the Mixer (generation read before and after analysiere(), cut with verwerfe_bis()), calls analysiere() and returns
// the frame to send (0 or 1: the levels after the frames the ring held, numbered since the last cut). Frames are tagged with the source read
// together with the generation they belong to, never with the current selection. Testable without a socket.
struct SpektrumRahmen {
  std::string kanal;    // "deck/1" ... "bus/4" or "master"
  int32_t rahmen = 0;   // frames computed since the last source change
  std::string pegel;    // 29 integers in 0.1 dB, comma separated
};
class SpektrumSender {
 public:
  explicit SpektrumSender(const Mixer& m) : mixer_(m) {}
  std::vector<SpektrumRahmen> tick(int64_t jetzt_ns);
  // The text of the contract: round(10 x db) per band, floor -2000 (silence), comma separated, no spaces.
  static std::string kodiere(const float* db, int n);
  // Name of a selector value: 1..18 the mixer channel, 19 "master", else "".
  static const char* quelle_name(int sel);
  // Test seam (null in operation): called with stage 0 right after the first generation read (before source and cut are loaded), stage 1 after the generation was read (before analysiere), 2 after the second read (before tagging).
  using Haken = void (*)(void* ctx, int stufe);
  void setze_haken(Haken h, void* ctx) { haken_ = h; haken_ctx_ = ctx; }
  uint32_t bediente_generation() const { return bedient_; }

 private:
  const Mixer& mixer_;
  uint32_t bedient_ = 0;     // generation whose cut was applied
  int quelle_ = 0;           // the source belonging to bedient_
  bool hat_ticks_ = false;
  int64_t letzter_ns_ = 0;
  Haken haken_ = nullptr;
  void* haken_ctx_ = nullptr;
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
  size_t graph_wartend() const { return graph_wartend_.size(); }  // S16 tests: pending graph entries
  // Scheibe 35, Befund B-O Weg 1 (kern.toml hand_osc): /test/hand auch ohne Prüfmodus annehmen (Hand-Weg der Oberfläche).
  // Alle anderen /test/*-Adressen bleiben an den Prüfmodus gebunden.
  void setze_hand_osc(bool an) { hand_osc_ = an; }
  // Scheibe 35 /k/mapping: Ordner der Mapping-Dateien (<Konfig>/controller), Nicht-Echtzeit-Faden liest und prüft sie
  void setze_controller_ordner(std::string ordner) { controller_ordner_ = std::move(ordner); }
  // Plan 2026-09-27 (ADR 024): Ordner der Kits (~/.config/cypherdj/kits), /erz/strom kit:<name> liest <ordner>/<name>/
  void setze_kit_ordner(std::string ordner) { kit_ordner_ = std::move(ordner); }
  void setze_bk_ordner(std::string ordner) { bk_ordner_ = std::move(ordner); }  // Baukasten S3a
  // MVP 2 (ADR 025): Loop-Ordner (§4.9), /k/loop/laden liest <ordner>/<name>/
  void setze_loop_ordner(std::string ordner) { loop_ordner_ = std::move(ordner); }
  // D1 K1 (Spec 2.1): Ringe zum Arrangement-Lade-Faden; vor dem Netz-Faden. nullptr: /k/arr/laden mit datei_fehlt.
  void verbinde_arr(ArrLaderRinge* r) { arr_ringe_ = r; }
  void verbinde_rec(AufnahmeFaden* f) { rec_faden_ = f; }   // 1.8: der Aufnahme-Faden (main.cpp), Besitz bleibt dort
  void verbinde_spektrum(SpektrumSender* s) { spektrum_ = s; }   // 1.15 A7b: /zustand/spektrum from the 2 ms loop; the owner stays in main.cpp
  void spektrum_senden(int64_t jetzt_ns);                        // 1.15 A7b: one tick of the sender, every frame as /zustand/spektrum
  // Paket K3 (Spec 2.9, 6.14): Arbeitsordner der Instanz, derselbe wie der des Arrangement-Lade-Fadens (der schreibt dort
  // freeze-<spur>-<kennung>.f32). Vor dem Netz-Faden. Leer: /k/arr/freeze mit datei_fehlt abgelehnt.
  void setze_arr_ordner(std::string ordner) { arr_ordner_ = std::move(ordner); }
  // Keylock Slice 4: Einstellungen des Render-Fadens der REC-Umrechnung (Test-Zugang: Render-Funktion, Priorität). Vor dem
  // ersten Auftrag; der Faden entsteht erst mit ihm.
  void setze_keylock(const KeylockOpt& o) { kl_opt_ = o; }
  // 1.15 A5c: the channel limiter state for /e/kanal_limiter (first /k/hallo of a generation). A plain setter, called once from main.cpp right
  // after Kern::setze_kanal_limiter and before the net thread starts: the values are fixed after start, so no atomic is needed.
  void setze_kanal_limiter(bool gebaut, int latenz_samples) { kl_lim_gebaut_ = gebaut; kl_lim_latenz_ = latenz_samples; }
  // Keylock Slice 3b (F6): Shutdown. Bricht einen laufenden Render ab und startet keinen weiteren (auch nicht aus
  // ereignisse_senden() nach dem Stopp des Netz-Fadens). laufen() ruft es am Ende selbst; Tests rufen es direkt.
  void keylock_beenden();
  // Scheibe 18, Abonnenten über einen Neustart (INTERFACES §4.1, §5.1, §5.9, §6.3). Beide vor dem Netz-Faden.
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
  std::string bk_ordner_;  // Baukasten S3a
  // S12 task 1: per stream (1..16) the last ACCEPTED non-graph target (kit:/midi:) and its kanal, net thread only. `bk:`
  // with an empty name replays it, so an instrument graph can be taken off again. Graph targets are never stored.
  std::string erz_vorher_ziel_[16];
  std::string erz_vorher_kanal_[16];
  // S16 (netz_graph.cpp): which graph sits on each graph-capable slot (osc.json graph_platz), net thread only. Changed only when
  // the callback's quittung for the command arrives (1, 2, 3, 5), published as /e/graph; /k/graph/frage answers every slot.
  bool graph_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);  // /k/graph/frage (false: other address)
  void graph_vormerken(int64_t id, const char* quelle, const char* kanal, const char* name, int strom);
  void graph_quittung(const Ereignis& e);
  std::string graph_platz_name(const std::string& kanal) const;
  void sende_graph(const char* kanal, const std::string& name);
  struct GraphWartend { int64_t id; std::string quelle, kanal, name; int strom; };
  void graph_anwenden(const GraphWartend& w);  // apply one confirmed entry to the mirror, send every changed slot
  std::deque<GraphWartend> graph_wartend_;
  std::map<std::string, std::string> graph_insert_;     // deck/1..4, fx/3, fx/4 -> name
  struct GraphStrom { std::string kanal, name; };
  GraphStrom graph_strom_[16];                          // stream n-1 -> channel and graph it carries ("" none)
  // MVP 2 (netz_loop.cpp): /k/loop/* annehmen (false: keine Loop-Adresse), /e/loop senden, Freigaben
  bool loop_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  bool loop_ereignis(const Ereignis& e);
  std::string loop_ordner_;
  // D1 K1 (netz_arr.cpp): /k/arr/* annehmen (false: keine dieser Adressen), Ergebnisse des Lade-Fadens weiterreichen,
  // /zustand/arr senden, abgelöste Schnappschüsse zurück an den Lade-Faden
  bool arr_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  bool arr_ereignis(const Ereignis& e);
  void arr_zyklus();
  void arr_zurueck(ArrSnapshot* s);
  ArrLaderRinge* arr_ringe_ = nullptr;
  // 1.8 (netz_rec.cpp): /k/rec/* annehmen (false: keine dieser Adressen), abgelöste RecSpur freigeben, Take-Meldungen des Aufnahme-Fadens als /e/aufnahme senden
  bool rec_paket(const cypherdj::osc::Adresse* a, const osc::Nachricht& m);
  void rec_zyklus();
  void rec_alt_frei(RecSpur* p);
  void rec_melden(const TakeMeldung& m);
  AufnahmeFaden* rec_faden_ = nullptr;
  SpektrumSender* spektrum_ = nullptr;   // 1.15 A7b
  // Paket K3 (netz_arr_freeze.cpp, Spec 6.29): /k/arr/freeze prüfen und als Auftrag zum Lade-Faden reihen; dessen
  // Ergebnis als Befehl ARR_FREEZE in den Kern; Ereignis ARR_FREEZE zurück an den Lade-Faden; seine Meldung als /e/freeze.
  // Der Netz-Faden legt keinen Puffer an und schreibt keine Datei.
  bool arr_freeze_paket(const osc::Nachricht& m);
  void arr_freeze_ergebnis(const ArrErgebnis& e);
  void arr_freeze_ereignis(const Ereignis& e);
  void arr_freeze_zurueck(ArrFreeze* f);
  void arr_freeze_melden(const ArrFreezeMeldung& m);
  std::string arr_ordner_;
  // Keylock Slice 4 (netz_loop.cpp): Render-Faden der REC-Umrechnung (Task 7: die Keylock-Varianten der Boxen sind
  // ausgebaut, die Box dehnt live mit dem Dehner). Alles nur im Netz-Faden.
  void keylock_zyklus();             // umgerechnete Mitschnitte abholen, Datei schreiben, /e/mitschnitt
  bool keylock_bereit();             // Render-Faden da (beim ersten Gebrauch gebaut); false: nicht anlegbar (Slice 3b, F5)
  KeylockOpt kl_opt_;
  std::unique_ptr<KeylockRender> kl_;
  bool kl_aus_ = false;              // der Render-Faden ließ sich nicht bauen: nie wieder versuchen
  bool kl_beendet_ = false;          // Shutdown: nichts mehr auslösen oder einreihen
  // Keylock Task 3b: Stand des Reglers keylock aus der letzten /uhr (Ereignis::keylock_aus) für neue Abonnenten (/e/regler)
  bool kl_knopf_aus_ = false;
  // Effekt-Sektion (2026-10-11): letzter Stand jedes gemeldeten Reglers und jeder Box. Der Kern meldet beides nur bei Änderung;
  // ein neuer Abonnent (die Seite nach ihrem Neustart) wüsste sonst nicht, dass ein Kompressor an ist oder welcher Loop in
  // welcher Box läuft (die Loop-Automation plante dann nicht mehr). Nur im Netz-Faden.
  std::map<std::string, std::pair<float, std::string>> regler_stand_;
  struct LoopStand { bool da = false; int32_t status = 0, beats = 0, fx_art = 0; std::string name; double fx_beats = 0; float fx_wet = 0; };
  LoopStand loop_stand_[3];
  bool kl_lim_gebaut_ = false;     // 1.15 A5c: set once before the net thread runs
  int kl_lim_latenz_ = 0;
  bool kl_knopf_bekannt_ = false;  // mindestens eine /uhr gesehen (sonst bekommt ein neuer Abonnent nichts)
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
  int64_t ereignisse_verloren_ = 0;                // aus dem /uhr-Ereignis (Kern::verloren_), für /zustand/kern (D1 K1 Fix 10)
};

}  // namespace cdj
