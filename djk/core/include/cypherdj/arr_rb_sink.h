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
// Automation slice 2 (E9, `geraet` lanes): before block() of a track the core reports per lane and block one value (auto_parameter: the lane at the
// last running sample of the block). block() hands it to cypher_rb_setze AFTER the defaults/base values and only when it changed (every parameter_setzen and
// every zuruecksetzen forgets the applied value). During the playback that is after zuruecksetzen too; at a TRANSPORT START the value of the start block goes in BEFORE
// zuruecksetzen (lanes_vorab_, 1.9 T9 fix 2: zuruecksetzen locks the smoothers on their target, so the track starts on the lane value instead of gliding to it from the stored one).
// When the value stays away after a block that had one (lane deleted, swap
// without it, stop) the sink sets the BASE value once: the playback's parameter value, else the RB default. The FFI glides 20 ms behind the lane and has
// no getter; the lag is measured (test_arr_rb_senke_auto), not corrected.
// Echtzeit: außer Konstruktor und Destruktor keine Allokation, keine Sperre, kein I/O.
#pragma once

#include <atomic>
#include <cstdint>
#include <limits>

#include "cypherdj/arrangement.h"
#include "cypherdj/cypher_rb_ffi.h"

namespace cdj {

struct ArrRbPruefZugang;   // tests only: reads the set log of the sink

constexpr int ARR_RB_WARTE = 256;   // Ereignisse je Spur bis zum nächsten Block (wie RB_MAX_EREIGNISSE der FFI)
constexpr int64_t ARR_RB_RUHE = 48000;   // 1 s exakte Stille bei stehendem Transport, dann zurücksetzen (Stimme ruht)

class ArrRbSenke final : public ArrSenke {
 public:
  explicit ArrRbSenke(const Arrangement& arr, double fs = 48000.0);
  ~ArrRbSenke() override;
  ArrRbSenke(const ArrRbSenke&) = delete;
  ArrRbSenke& operator=(const ArrRbSenke&) = delete;

  int64_t vorhalt() const noexcept override { return 0; }
  void auto_parameter(int spur, int param, float wert) noexcept override;
  void auto_parameter_summand(int spur, int param, float delta) noexcept override;   // 1.12 slice 5: base value (playback value, else RB default) + delta, clamped to 0..1
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override;
  void alle_aus(int spur, int64_t ziel) noexcept override;
  void transport_start(int spur, int64_t ziel) noexcept override;
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override;   // = block_bahn on the own lane-0 struct
  // Mehrkern slice 3.1: touches only the track's own slot, the atomic counters and the scratch of `a`; another track may run on another lane meanwhile
  void block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept override;
  bool leer(int spur) const noexcept override { return spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].h; }   // no handle: block_bahn returns at once
  bool parallel_faehig(int spur) const noexcept override;   // a loaded, ready internal rb338 track
  bool spur_weg(int spur, int64_t s, bool andere_spur) noexcept override;   // Fix F2: Ausblende, dann zurücksetzen

  bool bereit() const { return bereit_; }                        // alle Instanzen angelegt
  uint64_t verloren() const { return verloren_.load(std::memory_order_relaxed); }                // Ereignisse über ARR_RB_WARTE oder von der FFI abgelehnt
  uint64_t parameter_gemeldet() const { return gemeldet_.load(std::memory_order_relaxed); }      // values the core reported through auto_parameter (cost layouts: positive proof that the lanes arrive)
  uint64_t parameter_abgelehnt() const { return abgelehnt_.load(std::memory_order_relaxed); }    // unbekannte ID oder NaN (der Server prüft vorher)
  int ruhend() const;                                            // Spuren, deren Stimme ruht (seit Zurücksetzen ohne Note)

 private:
  friend struct ArrRbPruefZugang;
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
    // `geraet` lanes (E9) per parameter 0..3 (ARR_GERAET_PARAM_NAME); angewendet NaN: no lane value is in the FFI
    float lane_wert[ARR_GERAET_PARAMS] = {};
    bool lane_da[ARR_GERAET_PARAMS] = {};    // reported in this block
    bool lane_war[ARR_GERAET_PARAMS] = {};   // reported in the block before
    static_assert(ARR_GERAET_PARAMS == 4, "the initialiser below lists four values");
    float angewendet[ARR_GERAET_PARAMS] = {NAN_WERT, NAN_WERT, NAN_WERT, NAN_WERT};
  };
  // Test seam: the last PROTOKOLL_N calls per lane to cypher_rb_setze (and cypher_rb_vorgaben as the name "<vorgaben>"), fixed rings, no allocation.
  // One ring per lane (mehrkern slice 3.2): a lane writes only its own ring and advances only its own index, so units on different lanes never share a
  // slot. `seq` is the global sequence number (an atomic counter, claimed with fetch_add) that gives the merged order.
  struct Protokoll {
    int spur;
    char name[16];
    float wert;
    uint64_t seq = ~0ull;   // ~0: never written
  };
  static constexpr int PROTOKOLL_N = 64;
  static constexpr float NAN_WERT = std::numeric_limits<float>::quiet_NaN();
  void schiebe(Spur& p, const Ev& e) noexcept;
  void protokoll(int bahn, const Spur& p, const char* name, float wert) noexcept;
  void vorgaben_(Spur& p, int bahn) noexcept;        // cypher_rb_vorgaben, logged; forgets the applied lane values
  void zuruecksetzen_(Spur& p) noexcept;   // cypher_rb_zuruecksetzen; forgets the applied lane values
  void setze_(Spur& p, const char* name, float wert, int bahn) noexcept;   // cypher_rb_setze, logged, rc != 0 counts abgelehnt_
  void lanes_anwenden(Spur& p, const ArrSnapshot* snap, int spur, int bahn) noexcept;   // E9, in block() after base values and zuruecksetzen
  void lanes_vorab_(Spur& p, int bahn) noexcept;   // 1.9 U8 T9: at a transport start, the values reported for this block go in BEFORE zuruecksetzen_ locks the smoothers on their target (no glide from the stored value)
  void lanes_vergessen(Spur& p, bool auch_gemeldet) noexcept;   // the track left the sink: forget the previous block and the applied values; auch_gemeldet also the value of this block
  static float basiswert(const ArrSnapshot* snap, int spur, int param) noexcept;   // base value of a lane parameter: the playback's value, else the RB default
  void parameter_setzen(Spur& p, const ArrSpur& quelle, int bahn) noexcept;
  bool parameter_gleich(const Spur& p, const ArrSpur& quelle) const noexcept;

  const Arrangement& arr_;
  Spur sp_[ARR_SENKEN_PLAETZE];
  bool bereit_ = false;
  // relaxed atomics: units of different tracks count at the same time (mehrkern slice 3.1)
  std::atomic<uint64_t> verloren_{0};
  std::atomic<uint64_t> abgelehnt_{0};
  std::atomic<uint64_t> gemeldet_{0};
  struct alignas(64) ProtokollBahn {
    Protokoll e[PROTOKOLL_N] = {};
    uint64_t n = 0;   // written by its lane only
  };
  ProtokollBahn protokoll_b_[ARR_ARBEIT_BAHNEN];
  std::atomic<uint64_t> protokoll_n_{0};   // global sequence number = number of entries written; claimed with fetch_add by every lane
  // Test seam, read by the tests (friend ArrRbPruefZugang) on the thread that drives the blocks, only while no block runs (after the join of the pool,
  // which orders the lane writes before the read; there is no other reader: /lage and the logging do not read the log). Entry i of the merged order is
  // the one with seq == i in one of the lane rings (the merge order is the sequence number); nullptr when the ring of its lane has wrapped over it.
  const Protokoll* protokoll_lies(uint64_t i) const noexcept {
    for (const ProtokollBahn& b : protokoll_b_)
      for (const Protokoll& e : b.e)
        if (e.seq == i) return &e;
    return nullptr;
  }
  ArrArbeit arbeit0_;                      // lane 0 struct of block()
};

}  // namespace cdj
