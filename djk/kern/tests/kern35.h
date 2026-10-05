// Scheibe 35: Prüfaufbau für die Kern-Hand ohne JACK. Ein Kern mit Lader im selben Faden (wie test_kern_deck aus 31),
// MIDI-Bytes gehen wie aus dem Eingang hand_in über Kern::hand_midi() in den Zyklus, der sie enthält. Mitgeschrieben
// werden Master links und rechts am Ring (Index = Kern-Sample des Blocks, der sie schrieb; der Master liegt um den
// Vorhalt des Master-Limiters dahinter, seit 25 fest 84 Samples) und alle Ereignisse. Nur für Tests (allokiert außerhalb
// von zyklus()); g_waechter zählt Allokationen im Zyklus, wenn die Testdatei operator new ersetzt.
#pragma once

#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "hand/mapping.h"
#include "pruef.h"

extern bool g_waechter;

namespace k35 {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // Samples je Beat bei 128 BPM

inline std::string djk() { return CYPHERDJ_DJK; }

// Klick-Träger-Fassung (tests/hand/traeger_fassung.py) in den Arbeitsbestand ab
inline void traeger(const std::string& ab, const char* mid, const char* extra = "") {
  const std::string c = "python3 " + djk() + "/kern/tests/hand/traeger_fassung.py --ziel " + ab + " --beats 64 " +
                        "--material-id " + mid + " " + extra + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string quelle, grund;
};
struct Midi {
  int64_t s0;
  uint8_t d[3];
  uint32_t versatz;
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader;
  std::unique_ptr<cdj::Kern> kern;
  std::unique_ptr<hand::Mapping> mapping{new hand::Mapping()};
  std::vector<float> l, r;
  std::vector<Q> q;
  std::vector<cdj::Ereignis> ev;  // alle außer UHR und ZYKLUS
  std::vector<Midi> midi;
  int64_t id = 100;
  bool bewachen = false;
  bool abholen = true;  // MVP 2 Scheibe 3 (E4): false = Ereignisring nicht leeren (Probe „Ring voll“)
  int vh = 0;  // Vorhalt des Master-Limiters

  explicit Lauf(const std::string& ab, const char* mapping_datei = "konfig/controller/softcontroller.json")
      : lader(ab, 3800LL << 20) {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    kern->setze_pruefmodus(true);
    vh = kern->mixer().limiter_vorhalt();
    if (mapping_datei) {
      hand::Fehler f;
      const std::string p = mapping_datei[0] == '/' ? std::string(mapping_datei) : djk() + "/" + mapping_datei;
      const bool ok = hand::lade_datei(p.c_str(), kern->stellwerk().tabelle(), mapping.get(), &f);
      if (!ok) std::fprintf(stderr, "Mapping %s: %s\n", p.c_str(), f.text);
      PRUEF(ok);
      kern->setze_mapping(mapping.get());
    }
    l.reserve(6'000'000);
    r.reserve(6'000'000);
  }
  cdj::Befehl neu(int art, const char* quelle = "leitstand") {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  int64_t sende(const cdj::Befehl& b) {
    PRUEF(bef->schiebe(b));
    return b.id;
  }
  int64_t laden(int deck, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    return sende(b);
  }
  int64_t start(int deck, double ab, double quell = 0.0) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = quell;
    return sende(b);
  }
  int64_t stopp(int deck, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_STOPP, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = 1;
    return sende(b);
  }
  int64_t teil(const char* pfad, float nach, double ab, double dauer, const char* quelle = "pruefstand",
               const char* plan = "") {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    std::snprintf(b.plan, sizeof b.plan, "%s", plan);
    b.ab_beat = ab;
    b.dauer_beats = dauer;
    b.wert = nach;
    b.politik = 1;
    return sende(b);
  }
  // /test/hand ,sfh (§19.0) als Befehl HAND, wie ihn das Netz einreiht
  void test_hand(const char* pfad, float midi_roh, int64_t sample) {
    cdj::Befehl b = neu(cdj::Befehl::HAND, "andreas");
    b.id = 0;
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.wert = midi_roh;
    b.sample = sample;
    sende(b);
  }
  // MIDI im Zyklus, der Sample s enthält, am Versatz s − Zyklusanfang
  void midi_bei(int64_t s, uint8_t a, uint8_t b, uint8_t c) {
    PRUEF(s / N * N >= kern->sample());  // nur künftige Zyklen, sonst käme das Ereignis nie an
    midi.push_back({s / N * N, {a, b, c}, static_cast<uint32_t>(s % N)});
  }
  void zyklen(int64_t bis_sample) {
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      for (Midi& m : midi)
        if (m.s0 == n0) {
          kern->hand_midi(m.d, 3, m.versatz);
          m.s0 = -1;  // einmal (nach /k/set/neu beginnt die Zeitachse wieder bei 0)
        }
      const uint64_t w0 = cdj_lade(&ring->w);
      g_waechter = bewachen;
      kern->zyklus(N, n0 * 20833);
      g_waechter = false;
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      if ((int64_t)l.size() < n0 + N) {
        l.resize(n0 + N);
        r.resize(n0 + N);
      }
      for (int i = 0; i < N; ++i) {
        l[n0 + i] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + 0];
        r[n0 + i] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + 1];
      }
      cdj::Ereignis e;
      while (abholen && ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.quelle, e.grund});
        if (e.art != cdj::Ereignis::UHR && e.art != cdj::Ereignis::ZYKLUS) ev.push_back(e);
      }
    }
  }
  void vor(int64_t t) { zyklen(t - 2 * N); }  // bis kurz vor t: der Zyklus mit Sample t liegt noch vorn
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  std::vector<cdj::Ereignis> alle(int32_t art, const char* pfad = nullptr) const {
    std::vector<cdj::Ereignis> v;
    for (const auto& e : ev)
      if (e.art == art && (!pfad || !std::strcmp(e.pfad, pfad))) v.push_back(e);
    return v;
  }
  // Hülle des Trägers rechts am Ring-Index n (Kern-Sample des schreibenden Blocks)
  double huelle(int64_t n) const { return std::sqrt((double)r[n] * r[n] + (double)r[n + 1] * r[n + 1]); }
  // erstes Ring-Sample in [von, bis), an dem die Hülle sich um mehr als die Hälfte des Sprungs von alt nach neu bewegt
  int64_t sprung(int64_t von, int64_t bis, double alt, double neu) const {
    for (int64_t n = von; n < bis; ++n)
      if (std::fabs(huelle(n) - alt) > 0.5 * std::fabs(neu - alt)) return n;
    return -1;
  }
  // Klicks links in [von, bis) am Ring: Lage des Betragsmaximums in den 200 Samples nach dem ersten |x| > 0,05
  std::vector<int64_t> klicks(int64_t von, int64_t bis) const {
    std::vector<int64_t> k;
    for (int64_t n = von; n < bis && n < (int64_t)l.size(); ++n) {
      if (std::fabs(l[n]) <= 0.05f || (!k.empty() && n - k.back() < 1000)) continue;
      int64_t m = n;
      for (int64_t i = n; i < n + 200 && i < (int64_t)l.size(); ++i)
        if (std::fabs(l[i]) > std::fabs(l[m])) m = i;
      k.push_back(m);
      n += 1000;
    }
    return k;
  }
  double wert(const char* pfad) const { return kern->stellwerk().wert(kern->stellwerk().tabelle().suche(pfad)); }
};

inline double gain(double db) { return std::pow(10.0, db / 20.0); }

// Arbeitsbestand je Test unter /dev/shm (wie test_kern_deck), am Ende entfernt
struct Arbeitsbestand {
  std::string pfad;
  explicit Arbeitsbestand(const char* name) : pfad("/dev/shm/" + std::string(name) + "_" + std::to_string(getpid())) {
    std::filesystem::create_directories(pfad);
  }
  ~Arbeitsbestand() { std::filesystem::remove_all(pfad); }
};

}  // namespace k35
