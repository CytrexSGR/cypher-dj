// D1 K2b (Spec 2.4, 6.10, 6.13): die RB-338 als Senke der internen Instrument-Spuren des Arrangements. Je Spur-Slot eine
// eigene Instanz der RB-FFI (cypher_rb_ffi.h), angelegt im Konstruktor (nicht im Callback). Noten kommen mit ihrem
// Ziel-Sample (Vorhalt 0) und gehen im Block-Aufruf mit Versatz an die FFI; die Ausgabe landet im Spur-Eingang und
// läuft durch den Spur-Mixer. Transport-Start: im Block, der das Einsatz-Sample enthält, vorgaben -> setze je Parameter
// der Wiedergabe -> zuruecksetzen -> alle_aus am Einsatz; danach die Noten des Laufs. Die Stimme ruht bis zur ersten
// Note (6.10), darum ist die Ausgabe ab dem Einsatz unabhängig von der Blockphase (A3). Ein Tausch der Wiedergabe mit
// anderen Parametern setzt sie im nächsten Block neu (vorgaben -> setze, geglättet wie das Plugin, ohne zuruecksetzen).
// Ruhe: steht der Transport und war die Ausgabe einer Spur 1 s lang exakt 0, setzt die Senke sie zurück; danach ruht die
// Stimme (gemessen 0,5 statt 15 µs je Block nach dem Ausklang), die Ausgabe bleibt dieselbe (0).
// Kurzblende (Spec 6.28): liegt ein ausstehender Einsatz im nächsten Block, blendet die Senke die Ausgabe dieses Blocks
// linear auf 0 aus und bleibt bis zum Block des Einsatzes stumm; so endet ein klingender Ausklang beim Neustart ohne
// Sprung am Schnitt (zuruecksetzen am Blockanfang). Ab dem Einsatz ändert sich nichts (A3 bitgleich).
// Grenze (Review K2b F4): "liegt im nächsten Block" rechnet mit einem nächsten Block derselben Größe wie dieser. Das hält im
// Live-Kern (Kern::audio teilt den Zyklus in gleich große MIX_BLOCK-Teilblöcke, das Quantum ist mit node.lock-quantum
// fest) und im Render (festes Quantum). Wird der nächste Block kürzer, bleibt die Spur bis zum Einsatz-Block stumm (kein
// Sprung); wird er länger (Quantum steigt zwischen Befehl und Einsatz), fällt die Blende aus und der Schnitt am Anfang des
// Einsatz-Blocks ist hart wie ohne Kurzblende. Kein Umbau: im Betrieb tritt der Fall nicht auf.
// Spurwechsel (Fix F2): verlässt eine klingende Spur die Senke per Tausch (wird leer, Wirt-Spur), blendet der nächste
// Block (das Modul ruft ihn einmal, spur_weg) linear auf 0 aus, ohne die Parameter der neuen Spur, danach setzt die Senke
// die Spur zurück; die Stimme ruht, ein späteres Zurückladen spielt keinen alten Ausklang weiter.
// Echtzeit: außer Konstruktor und Destruktor keine Allokation, keine Sperre, kein I/O.
#pragma once

#include <cstdint>

#include "cypherdj/arrangement.h"
#include "cypherdj/cypher_rb_ffi.h"

namespace cdj {

constexpr int ARR_RB_WARTE = 256;   // Ereignisse je Spur bis zum nächsten Block (wie RB_MAX_EREIGNISSE der FFI)
constexpr int64_t ARR_RB_RUHE = 48000;   // 1 s exakte Stille bei stehendem Transport, dann zurücksetzen (Stimme ruht)

class ArrRbSenke final : public ArrSenke {
 public:
  explicit ArrRbSenke(const Arrangement& arr, double fs = 48000.0);
  ~ArrRbSenke() override;
  ArrRbSenke(const ArrRbSenke&) = delete;
  ArrRbSenke& operator=(const ArrRbSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // Fix F2: Ausblende, dann zurücksetzen

  bool bereit() const { return bereit_; }                        // alle Instanzen angelegt
  uint64_t verloren() const { return verloren_; }                // Ereignisse über ARR_RB_WARTE oder von der FFI abgelehnt
  uint64_t parameter_abgelehnt() const { return abgelehnt_; }    // unbekannte ID oder NaN (der Server prüft vorher)
  int ruhend() const;                                            // Spuren, deren Stimme ruht (seit Zurücksetzen ohne Note)

 private:
  struct Ev {
    int64_t ziel;
    uint8_t art;   // 0 Note-Ein, 1 Note-Aus, 2 alle aus
    uint8_t ton, vel;
  };
  struct Spur {
    CypherRb* h = nullptr;
    Ev ev[ARR_RB_WARTE];
    int n = 0;
    int64_t start = -1;                     // Einsatz-Sample eines ausstehenden Transport-Starts, −1: keiner
    ArrParameter param[ARR_PARAMETER] = {}; // zuletzt gesetzte Parameter (Vergleich mit der Wiedergabe je Block, nach
    int n_param = -1;                       // Inhalt: ein neuer Schnappschuss kann die Adresse des alten haben); −1: nie
    bool wach = false;                      // seit dem letzten Zurücksetzen ein Note-Ein gemeldet
    int64_t still = 0;                      // Samples exakter Stille am Ausgang in Folge
    bool stumm = false;                     // Kurzblende vorbei, stumm bis zum Block des Einsatzes
    bool weg = false;                       // Fix F2: die Spur hat die Senke verlassen, nächster Block blendet aus
  };
  void schiebe(Spur& p, const Ev& e) noexcept;
  void parameter_setzen(Spur& p, const ArrSpur& quelle) noexcept;
  bool parameter_gleich(const Spur& p, const ArrSpur& quelle) const noexcept;

  const Arrangement& arr_;
  Spur sp_[ARR_SPUREN];
  bool bereit_ = false;
  uint64_t verloren_ = 0;
  uint64_t abgelehnt_ = 0;
  float puf_l_[ARR_BLOCK] = {};
  float puf_r_[ARR_BLOCK] = {};
};

}  // namespace cdj
