// Negativ-Kontrolle des hörbaren Ziehens (Beleg 2): zwei Decks spielen eine feste Folge (Start, Sprung, Hotcue, Loop, Tempo-Rampe
// ins Varispeed, Stopp, neuer Start) ohne ein einziges Ziehen; ausgegeben wird die FNV-1a-Summe über die Bitmuster des Masters
// (links und rechts) und die Zahl der Samples. Dieselbe Datei gegen den Stand VOR dem Ziehen und danach gebaut: gleiche Summe
// heißt bitgleich. Kern ohne JACK und ohne Keylock-Fäden, darum deterministisch. Aufruf: kern_deck_bitdump
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"

namespace fs = std::filesystem;
static std::string AB;
constexpr int N = 256;
constexpr int64_t SPB = 22500;

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  int64_t id = 100;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
  }
  cdj::Befehl neu(int art, const char* quelle = "andreas") {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  void sende(const cdj::Befehl& b) { bef->schiebe(b); }
  void laden(int deck, const char* mid, int stems = 0) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN, "leitstand");
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    b.mit_stems = stems;
    sende(b);
  }
  void fader(int deck) {
    cdj::Befehl b = neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    b.ab_beat = 2.0;
    b.wert = 0.0f;
    b.politik = 1;
    sende(b);
  }
  void start(int deck, double ab, double q) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START);
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = q;
    sende(b);
  }
  void stopp(int deck, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_STOPP);
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = 1;
    sende(b);
  }
  void teil(int art, int deck, double ab, double wert_beats, int nr = 0) {
    cdj::Befehl b = neu(art);
    b.deck = deck;
    b.ab_beat = ab;
    b.wert_beats = wert_beats;
    b.nr = nr;
    b.politik = 1;
    sende(b);
  }
  void hotcue_setzen(int deck, int nr, double q) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_HOTCUE_SETZEN);
    b.deck = deck;
    b.nr = nr;
    b.quell_beat = q;
    sende(b);
  }
  void zyklen(int64_t bis) {
    cdj::Ereignis e;
    while (kern->sample() < bis) {
      kern->zyklus(N, kern->sample() * 20833);
      lader.einmal(*lr);
      while (ere->hole(e)) {}
    }
  }
  void tempo(double ab, double ziel, double dauer) {
    cdj::Befehl b = neu(cdj::Befehl::TEMPO_RAMPE);
    b.ab_beat = ab;
    b.ziel_bpm = ziel;
    b.dauer_beats = dauer;
    sende(b);
  }
};

int main() {
  AB = "/dev/shm/kern_deck_bitdump_" + std::to_string(::getpid());
  fs::create_directories(AB);
  const std::string k = std::string("python3 ") + CYPHERDJ_DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB;
  int rc = std::system((k + " --material-id 5c5c0000000000a1 --beats 96 --sinus-links 440 > /dev/null").c_str());
  rc |= std::system((k + " --material-id 5c5c0000000000a2 --beats 96 --stems > /dev/null").c_str());
  if (rc != 0) return 2;
  Lauf l;
  l.zyklen(10 * N);
  l.laden(1, "5c5c0000000000a1");
  l.laden(2, "5c5c0000000000a2", 1);
  l.zyklen(30 * N);
  l.fader(1);
  l.fader(2);
  l.hotcue_setzen(1, 1, 20.0);
  l.start(1, 4.0, 0.0);
  l.start(2, 6.0, 8.0);
  l.teil(cdj::Befehl::DECK_SPRUNG, 1, 20.0, 4.0);
  l.teil(cdj::Befehl::DECK_LOOP, 2, 24.0, 2.0);
  l.teil(cdj::Befehl::DECK_LOOP, 2, 30.0, 0.0);
  l.teil(cdj::Befehl::DECK_HOTCUE, 1, 34.0, 0.0, 1);
  l.tempo(32.0, 132.0, 8.0);
  l.stopp(1, 44.0);
  l.start(1, 48.0, 3.3);
  l.teil(cdj::Befehl::DECK_SPRUNG, 2, 52.0, -3.0);
  const int64_t bis = 64 * SPB;
  uint64_t h = 1469598103934665603ULL;
  int64_t n = 0;
  float spitze = 0.0f;
  while (l.kern->sample() < bis) {
    const int64_t n0 = l.kern->sample();
    const uint64_t w0 = cdj_lade(&l.ring->w);
    l.kern->zyklus(N, n0 * 20833);
    l.lader.einmal(*l.lr);
    const float* d = cdj_ring_daten_c(l.ring);
    for (int i = 0; i < N; ++i)
      for (int c = 0; c < 2; ++c) {
        uint32_t bits;
        std::memcpy(&bits, &d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + c], 4);
        for (int by = 0; by < 4; ++by) h = (h ^ ((bits >> (8 * by)) & 0xff)) * 1099511628211ULL;
        ++n;
        spitze = std::max(spitze, std::fabs(d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + c]));
      }
    cdj::Ereignis e;
    while (l.ere->hole(e)) {}
  }
  std::printf("kern_deck_bitdump: %lld Werte, Spitze %.6f, FNV-1a %016llx\n", (long long)n, spitze, (unsigned long long)h);
  fs::remove_all(AB);
  return 0;
}
