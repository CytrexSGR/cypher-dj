// D1 K1 (Spec D1 2.1, 3.2): die Wiedergabe eines Arrangements als unveränderlicher Schnappschuss. Der Seiten-Server
// schreibt <arr_ordner>/wiedergabe-<nr>.json; lade_wiedergabe() liest und prüft sie, lädt das Audio über den Cache
// (mmap + MAP_POPULATE + mlock, geteilt über Schnappschüsse, geschlüsselt nach sha256 mit Referenzzähler) und baut
// den Schnappschuss. Der eine Lader für Kern (Lade-Faden, arr_lader.h) und Render (K3). Nicht im Callback: der
// Callback liest nur die fertigen Felder über const-Zeiger.
#pragma once

#include <sys/mman.h>
#include <unistd.h>

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/speicher_konto.h"
#include "cypherdj/warp_abbildung.h"

struct CypherBk;   // cypher_bk_ffi.h (global, extern "C" functions): a Baukasten graph instance

namespace cdj {

constexpr int ARR_SPUREN = 32;           // Spur-Slots spur/1..32 (Spec 2.3, E3); = SPUR_REGLER_SPUREN (static_assert)
constexpr int ARR_CLIPS_MAX = 4096;     // je Wiedergabe (Spec 3.2)
constexpr int ARR_NOTEN_MAX = 65536;    // je Wiedergabe (Spec 3.2)
constexpr int ARR_WIRT_SLOTS = 2;       // arr_midi_<s>, s = 1..2 (Spec 2.4)
constexpr int ARR_GRUPPEN = 8;          // Gruppen-Spuren grp/1..8 (1.10, F1: eigene Plätze neben den 32 Spuren); = GRP_REGLER_GRUPPEN (static_assert in arr_ausgang.cpp)
constexpr int ARR_RETURNS = 4;          // 1.10 Slice 3: return strips ret/1..4 (own places next to the 32 tracks and 8 groups); = RET_REGLER_RETURNS (static_assert in arr_returns.cpp)
constexpr int ARR_PARAMETER = 8;        // RB-338-Parameter je interner Spur (K2 liest sie)
constexpr int ARR_BK_MAX = 8;           // S20: Baukasten tracks per playback; = MAX_BK_SPUREN in modell.ts
constexpr double ARR_GAIN_DB_MIN = -96.0;    // Clip-Gain, ein Bereich mit S2 (Spec 6.27)
constexpr double ARR_GAIN_DB_MAX = 24.0;
constexpr int ARR_AUTO_PUNKTE_MAX = 65536;       // automation points per playback, all lanes (Automation Slice 1; = MAX_AUTO_PUNKTE in modell.ts)
constexpr int ARR_AUTO_LANE_PUNKTE_MAX = 8192;   // automation points per lane (= MAX_LANE_PUNKTE in modell.ts)
// Lane targets (automation slice 2). The reader maps the project's `ziel` strings onto these from one table (arr_wiedergabe.cpp).
constexpr uint8_t ARR_AUTO_FADER = 0;            // the track fader (dB)
constexpr uint8_t ARR_AUTO_PAN = 1;              // pan -1..1
constexpr uint8_t ARR_AUTO_MUTE = 2;             // mute 0 or 1, jump points only
constexpr uint8_t ARR_AUTO_SOLO = 3;             // solo 0 or 1, jump points only
constexpr uint8_t ARR_AUTO_GERAET = 4;           // a parameter of the internal device (RB-338), ArrAutoLane::param tells which, 0..1
// Device parameter names by ArrAutoLane::param: own 0..3 numbering, not the rb_dsp ID order; task 4 maps it to the ID string via this table.
constexpr int ARR_GERAET_PARAMS = 4;             // device lane parameters; every table and array of them is sized by this
constexpr const char* ARR_GERAET_PARAM_NAME[ARR_GERAET_PARAMS] = {"lautstaerke", "cutoff", "resonanz", "env_mod"};
constexpr int ARR_AUTO_LANES_JE_SPUR = 8;        // at most one lane per (ziel, param): 4 + 4 distinct targets
constexpr double ARR_BLENDE_TOLERANZ = 1e-9;  // ein_beats + aus_beats <= laenge_beats + Toleranz (wie S2, modell.ts)

// FNV-1a 64 über den ID-Text (Clip-ID, Noten-ID "<clip_id>/<noten_id>"); der Lader prüft Eindeutigkeit je Spur.
inline uint64_t arr_id(const char* t, size_t n) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < n; ++i) {
    h ^= static_cast<uint8_t>(t[i]);
    h *= 1099511628211ULL;
  }
  return h;
}
inline uint64_t arr_id(const std::string& t) { return arr_id(t.data(), t.size()); }


// Automation (ADR 032): one point of a lane. beat = project beat, wert = unit of the target (fader dB -200..6, pan -1..1,
// mute/solo 0 or 1, device 0..1), form = segment INTO this point (0 linear, 1 s-curve, 2 jump). 16 bytes.
struct ArrAutoPunkt {
  double beat;
  float wert;
  uint8_t form;
};
struct ArrAutoLane {
  uint8_t ziel;                     // ARR_AUTO_FADER, _PAN, _MUTE, _SOLO or _GERAET
  uint8_t param;                    // ARR_AUTO_GERAET: index into ARR_GERAET_PARAM_NAME (0..3); else 0
  int n;                            // points, at least 1, beats not falling (two at one beat are a jump)
  const ArrAutoPunkt* p;            // into ArrSnapshot::auto_punkte
};

struct ArrAudio;   // unten, nach den Seiten-Helfern (eigene Seiten)

struct ArrClip {
  uint64_t id;
  double start_beat, laenge_beats;   // absolute Projekt-Beats
  const ArrAudio* audio;
  int64_t offset_frames;
  float gain;                        // linear, aus gain_db
  double ein_beats, aus_beats;
  const ArrWarp* warp = nullptr;     // Paket 1.13: gewarpter Clip (Marker in ArrSnapshot::warps); nullptr: Quellposition = offset_frames + pos
};

struct ArrNote {
  uint64_t id;
  double beat, laenge;               // absolute Projekt-Beats
  uint8_t ton, vel;
};

enum class ArrArt : uint8_t { leer = 0, audio = 1, intern = 2, wirt = 3 };

struct ArrParameter {
  char name[16];
  float wert;                        // 0..1 normiert (Spec 2.4)
};

struct ArrSpur {
  int nr = 0;                        // 1..ARR_SPUREN (32); 0 = leer
  ArrArt art = ArrArt::leer;
  int8_t ausgang = 0;                // 1.10: 0 master, 1..ARR_GRUPPEN Gruppe (Wiedergabe /2); Tiefe 1
  int slot = 0;                      // wirt: 1..2
  char geraet[16] = {};              // intern: "rb338" or "bk"
  // S20, device bk: graph name (the file stem in the graph folder) and the instance. The instance belongs to the graph store of the
  // ArrAudioCache (reference counted by the snapshots, ArrSnapshot::bk_refs); the callback reads it only. bk_gen is unique per built
  // instance (never reused), so the sink tells "same instance" from "another instance at a reused address".
  char graph[33] = {};
  CypherBk* bk = nullptr;
  uint64_t bk_gen = 0;
  int n_param = 0;
  ArrParameter param[ARR_PARAMETER] = {};
  int n_clips = 0;
  const ArrClip* clips = nullptr;    // nach start_beat aufsteigend
  int n_noten = 0;
  const ArrNote* noten = nullptr;    // nach beat aufsteigend
  const uint64_t* noten_id = nullptr;    // IDs aufsteigend (Suche beim Tausch)
  const int32_t* noten_id_index = nullptr;
  int n_auto = 0;                    // Automation Slice 1: lanes of this track (none: 0)
  const ArrAutoLane* auto_lanes = nullptr;
};

// K1-Fix 8: Speicher in eigenen, anonym abgebildeten Seiten. Der Lade-Faden sperrt ihn nach dem Bau (mlock) und bucht ihn
// auf dem Konto; munmap beim Freigeben hebt die Sperre auf, ohne Nachbarn zu berühren (Sperren zählen unter Linux nicht
// mit: ein munlock auf einer geteilten Heap-Seite löste auch die Sperre aus mlockall). Nie im Callback.
// Inline, damit jede Übersetzungseinheit mit Schnappschüssen (auch Mutationsziele nur mit dem Modul) sie hat.
inline size_t arr_seiten(size_t bytes) noexcept {   // auf ganze Seiten gerundet
  static const size_t seite = static_cast<size_t>(sysconf(_SC_PAGESIZE));
  return (bytes + seite - 1) / seite * seite;
}
inline void* arr_seiten_neu(size_t bytes) {         // wirft std::bad_alloc
  void* p = mmap(nullptr, arr_seiten(bytes ? bytes : 1), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (p == MAP_FAILED) throw std::bad_alloc();
  return p;
}
inline void arr_seiten_frei(void* p, size_t bytes) noexcept {
  if (p) munmap(p, arr_seiten(bytes ? bytes : 1));
}

// Geladenes Audio: rohes f32, 48 kHz, Stereo verschränkt (Spec 2.8). Gehört dem Cache; der Callback liest daten und
// frames je Sample (über ArrClip::audio). K1-Fix-2 Punkt 3: darum liegt auch der Kopf in eigenen Seiten, vom Lade-Faden
// gesperrt (wenn der Cache sperrt) und auf dem Konto gebucht (arr_audio_kopf() Bytes je Audio), wie der Schnappschuss.
struct ArrAudio {
  char sha256[65];
  const float* daten;   // frames · 2 Werte
  int64_t frames;
  // nur der Cache (Lade-Faden):
  void* abbild;
  size_t bytes;
  int32_t ref;          // Zahl der Schnappschüsse, die es nutzen
  bool gesperrt;        // mlock gelungen
  static void* operator new(size_t n) { return arr_seiten_neu(n); }
  static void operator delete(void* p, size_t n) noexcept { arr_seiten_frei(p, n); }
};
inline int64_t arr_audio_kopf() noexcept { return static_cast<int64_t>(arr_seiten(sizeof(ArrAudio))); }

template <class T>
struct ArrSeiten {
  using value_type = T;
  ArrSeiten() noexcept = default;
  template <class U>
  ArrSeiten(const ArrSeiten<U>&) noexcept {}
  T* allocate(size_t n) { return static_cast<T*>(arr_seiten_neu(n * sizeof(T))); }
  void deallocate(T* p, size_t n) noexcept { arr_seiten_frei(p, n * sizeof(T)); }
  template <class U>
  bool operator==(const ArrSeiten<U>&) const noexcept { return true; }
};

struct ArrSnapshot {
  int64_t nr = 0;
  ArrSpur spur[ARR_SPUREN];          // Index nr − 1
  bool ret_da[ARR_RETURNS] = {};     // 1.10 Slice 3: which returns the playback knows (index nr − 1); the sends themselves are controls, not data
  // Besitz, nur Lade-Faden: Speicher hinter den Zeigern oben (eigene Seiten, gesperrt, K1-Fix 8)
  std::vector<ArrClip, ArrSeiten<ArrClip>> clips;
  std::vector<ArrNote, ArrSeiten<ArrNote>> noten;
  std::vector<uint64_t, ArrSeiten<uint64_t>> noten_id;
  std::vector<int32_t, ArrSeiten<int32_t>> noten_id_index;
  // Paket 1.13: Warp-Marker aller Clips, hintereinander (je Clip ein ArrWarp, dessen Zeiger in warp_beat und warp_frame zeigen)
  std::vector<ArrWarp, ArrSeiten<ArrWarp>> warps;
  std::vector<double, ArrSeiten<double>> warp_beat, warp_frame;
  // Automation Slice 1: lanes and their points (pointers in ArrSpur::auto_lanes / ArrAutoLane::p point into these vectors)
  int n_auto_lanes = 0;
  std::vector<ArrAutoLane, ArrSeiten<ArrAutoLane>> auto_lane_liste;
  std::vector<ArrAutoPunkt, ArrSeiten<ArrAutoPunkt>> auto_punkte;
  std::vector<ArrAudio*> audios;     // jedes genutzte Audio genau einmal (Referenz im Cache); der Callback liest es nie
  std::vector<int32_t> bk_refs;      // S20: slots of the graph store this snapshot holds a reference on (released by gib_wiedergabe)
  int64_t gesperrt_bytes = 0;        // Kopf und Felder: auf dem Konto gebucht (und gesperrt, wenn der Cache sperrt)
  static void* operator new(size_t n) { return arr_seiten_neu(n); }
  static void operator delete(void* p, size_t n) noexcept { arr_seiten_frei(p, n); }
};

// S20: the sink tells the store whether the callback still uses a graph instance (published with release order each block). The store
// frees an instance only when no snapshot holds it AND the sink does not use it; otherwise the free waits for the next loader pass
// (precedent WarpWerk::liest). noexcept, lock-free on the reading side.
class ArrBkLeser {
 public:
  virtual bool nutzt(const CypherBk* h) const noexcept = 0;

 protected:
  ~ArrBkLeser() = default;
};

// Audio-Cache des Lade-Fadens: sha256 -> ArrAudio. Zählt gegen das gemeinsame Konto (speicher_budget_mib, Deck-Lader
// eingeschlossen) und gegen den Teilbetrag arr_budget. Nur aus einem Faden benutzen.
class ArrAudioCache {
 public:
  ArrAudioCache(SpeicherKonto* konto, int64_t arr_budget_bytes, bool sperren = true)
      : konto_(konto), budget_(arr_budget_bytes), sperren_(sperren) {}
  ~ArrAudioCache();
  ArrAudioCache(const ArrAudioCache&) = delete;
  ArrAudioCache& operator=(const ArrAudioCache&) = delete;
  // Liefert das Audio mit ref + 1 (neu geladen oder aus dem Cache). nullptr mit grund "audio_fehlt", "format" oder
  // "zu_gross".
  ArrAudio* hole(const std::string& sha256, const std::string& datei, int64_t frames, std::string& grund,
                 std::string& meldung);
  void gib(ArrAudio* a);          // ref − 1; bei 0 munlock, munmap, Konto zurück
  // K1-Fix 8: Schnappschuss nach dem Bau buchen und (wenn der Cache sperrt) sperren; false mit grund "zu_gross"
  bool sperre(ArrSnapshot& s, std::string& grund, std::string& meldung);
  void entsperre(ArrSnapshot& s);   // vor dem Löschen: entsperren und zurückbuchen
  int64_t gesperrt() const { return gesperrt_; }
  int64_t budget() const { return budget_; }
  int eintraege() const { return static_cast<int>(audio_.size()); }

  // S20 graph store (same thread, same lifetime as the audio cache). The key is (track nr, graph name, hash of the file text): consecutive
  // snapshots with the same key share one instance, so editing a note or a knob rebuilds nothing and cuts no tail.
  void setze_bk_ordner(std::string ordner) { bk_ordner_ = std::move(ordner); }
  void setze_bk_leser(const ArrBkLeser* l) { bk_leser_ = l; }
  // Reads <bk_ordner>/<graph>.json, takes a reference on the instance for track nr (building it on a miss; never in the callback) and
  // returns its slot (>= 0, for ArrSnapshot::bk_refs) or -1 with grund "format" and meldung (the sample root is <bk_ordner>/samples).
  int32_t bk_hole(int nr, const std::string& graph, CypherBk** h, uint64_t* gen, std::string& grund, std::string& meldung);
  void bk_gib(int32_t slot);   // reference - 1; at 0 free the instance, or defer the free while the sink still uses it
  bool bk_nachholen();         // free deferred instances the sink has let go of; true = something was freed
  int bk_eintraege() const;    // live instances (with at least one reference)
  int bk_aufgeschoben() const { return static_cast<int>(bk_aufgeschoben_.size()); }

 private:
  struct BkEintrag {
    std::string schluessel;    // empty = free slot
    CypherBk* h = nullptr;
    uint64_t gen = 0;
    int32_t ref = 0;
  };
  std::string bk_ordner_;
  const ArrBkLeser* bk_leser_ = nullptr;
  std::vector<BkEintrag> bk_;
  std::vector<CypherBk*> bk_aufgeschoben_;   // reference count 0, but the sink still uses it
  uint64_t bk_zaehler_ = 0;
  SpeicherKonto* konto_;
  int64_t budget_;
  bool sperren_;
  int64_t gesperrt_ = 0;
  std::map<std::string, std::unique_ptr<ArrAudio>> audio_;
};

struct ArrLadeErgebnis {
  std::unique_ptr<ArrSnapshot> snap;   // nullptr bei Fehler
  std::string grund;                   // "", "datei_fehlt", "format", "audio_fehlt", "zu_gross", "spur_bereich"
  std::string meldung;                 // für stderr, mit Feld und Wert
};

// Pfad der Wiedergabe-Datei (Spec 2.9): <ordner>/wiedergabe-<nr>.json
std::string wiedergabe_pfad(const std::string& ordner, int64_t nr);

// Liest, prüft und lädt. Der eine Lader für Kern und Render (Spec 2.1). Allokiert, Systemaufrufe: nie im Callback.
ArrLadeErgebnis lade_wiedergabe(const std::string& ordner, int64_t nr, ArrAudioCache& cache);

// Gibt einen Schnappschuss frei (Referenzen im Cache zurück). Nur im Faden, der den Cache besitzt.
void gib_wiedergabe(ArrSnapshot* s, ArrAudioCache& cache);

}  // namespace cdj
