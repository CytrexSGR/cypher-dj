// DJ view places 3 and 4 (INTERFACES §4.10 /k/platz/kanal, §5.12 /e/platz/kanal), through the kern without JACK.
//   (a) pad 1 / pad 2 with inhalt 1..3: receipts 1, 2, 3, the event follows with the same pad and inhalt, the mixer holds it
//   (b) pad 3, inhalt 4, inhalt -1: receipt 6 ausserhalb_bereich, nothing reported, the mixer unchanged
//   (c) inhalt 0 puts the place back to nothing and reports it
//   (d) the cycle does not allocate while the place channel is switched
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/core.h"
#include "check.h"

static bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

constexpr int N = 256;

struct Q {
  int64_t id;
  int32_t status;
  std::string grund;
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern;
  std::vector<Q> q;
  std::vector<cdj::Ereignis> platz;
  int64_t id = 100;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
  }
  int64_t platz_kanal(int pad, int inhalt, const char* quelle = "andreas") {
    cdj::Befehl b{};
    b.art = cdj::Befehl::PLATZ_KANAL;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    b.deck = pad;
    b.nr = inhalt;
    PRUEF(bef->schiebe(b));
    return b.id;
  }
  void zyklen(int n) {
    for (int k = 0; k < n; ++k) {
      g_waechter = true;
      kern->zyklus(N, kern->sample() * 20833);
      g_waechter = false;
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.grund});
        if (e.art == cdj::Ereignis::PLATZ_KANAL) platz.push_back(e);
      }
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
};

int main() {
  {
    Lauf a;
    a.zyklen(4);
    PRUEF(a.kern->mixer().platz_kanal(0) == 0 && a.kern->mixer().platz_kanal(1) == 0);
    const int64_t c1 = a.platz_kanal(1, 1);
    const int64_t c2 = a.platz_kanal(2, 3, "cypher");
    a.zyklen(4);
    for (int64_t c : {c1, c2}) PRUEF(a.quittung(c, 1) && a.quittung(c, 2) && a.quittung(c, 3));   // (a)
    PRUEF(a.platz.size() == 2);
    PRUEF(a.platz[0].deck == 1 && a.platz[0].status == 1 && a.platz[1].deck == 2 && a.platz[1].status == 3);
    PRUEF(a.kern->mixer().platz_kanal(0) == 1 && a.kern->mixer().platz_kanal(1) == 3);
    // (b)
    const int64_t x1 = a.platz_kanal(3, 1), x2 = a.platz_kanal(1, 4), x3 = a.platz_kanal(2, -1), x4 = a.platz_kanal(0, 1);
    a.zyklen(4);
    for (int64_t c : {x1, x2, x3, x4}) {
      const Q* r = a.quittung(c, 6);
      PRUEF(r && r->grund == "ausserhalb_bereich");
      PRUEF(!a.quittung(c, 1));
    }
    PRUEF(a.platz.size() == 2 && a.kern->mixer().platz_kanal(0) == 1 && a.kern->mixer().platz_kanal(1) == 3);
    // (c)
    const int64_t n1 = a.platz_kanal(1, 0);
    a.zyklen(4);
    PRUEF(a.quittung(n1, 3));
    PRUEF(a.platz.size() == 3 && a.platz[2].deck == 1 && a.platz[2].status == 0 && a.kern->mixer().platz_kanal(0) == 0);
    // (d) switching and blending allocated nothing in any of the cycles above (the guard was on for every zyklus call)
    PRUEF(g_allokationen == 0);
    std::printf("Allokationen im Zyklus: %ld\n", g_allokationen);
  }
  PRUEF_ENDE();
}
