// Baukasten S3b Task 1: das Graph-Werk (graph_werk.h). Automat mit Stub (Stehlen, Verspätung, Besitz, Überlappungszähler),
// Bitgleichheit gegen cypher_bk_block mit echtem Graph (synchron und mit Fäden), Allokationswächter, Mikromessung.
// Aufruf ohne Argument: Fälle 1 bis 6 und 8, dazu ein kurzer Rauchlauf der Mikromessung (ohne Schwelle).
// Aufruf `mikro`: Fall 7 voll (10 000 Zyklen, Halt-Schwelle); gehört unter flock (echtzeit_schloss.sh).
#include <sys/resource.h>
#include <unistd.h>
#include <time.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/graph_werk.h"
#include "pruef.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte

using namespace cdj;

namespace {

constexpr int N = 256;

const char* GA = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.001,"d":0.1,"s":1,"r":1.0},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"s.aus","nach":"v.a"},{"von":"e.aus","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!h) std::fprintf(stderr, "cypher_bk_neu: %s\n", f);
  PRUEF(h != nullptr);
  return h;
}

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

// ---------------------------------------------------------------- Stub
struct H {
  std::atomic<int> drin{0};
  std::atomic<bool> halt{false};        // der Stub hält an `los`
  std::atomic<bool> im_rechnen{false};  // Handshake: der Faden ist im Stub
  std::atomic<long> aufrufe{0};         // Rechenzähler des Stubs
  volatile long zaehl = 0;              // nur der Besitzer; volatile: Zugriffe bleiben für TSan erhalten
  uint32_t rng = 12345;
  int spin_us = 0;
};
std::atomic<long> ueberlappt{0};
std::atomic<bool> los{false};

CypherBk* bk(H* h) { return reinterpret_cast<CypherBk*>(h); }

void betritt(H* h) {
  if (h->drin.fetch_add(1) != 0) ueberlappt.fetch_add(1);
}
void verlasse(H* h) { h->drin.fetch_sub(1); }

int32_t stub_rechne(CypherBk* b, float* l, float* r, size_t n) {
  H* h = reinterpret_cast<H*>(b);
  betritt(h);
  h->aufrufe.fetch_add(1);
  h->im_rechnen.store(true);
  if (h->halt.load()) {
    while (!los.load()) std::this_thread::yield();
  }
  if (h->spin_us > 0) {
    h->rng = h->rng * 1664525u + 1013904223u;
    const int64_t bis = jetzt_ns() + static_cast<int64_t>(h->rng >> 8) % (h->spin_us * 1000LL);
    while (jetzt_ns() < bis) {
    }
  }
  for (size_t i = 0; i < n; ++i) {
    const long z = h->zaehl;
    h->zaehl = z + 1;
    l[i] = r[i] = static_cast<float>(z);
  }
  verlasse(h);
  return 0;
}

int32_t stub_panik(CypherBk*, float* l, float* r, size_t n) {
  for (size_t i = 0; i < n; ++i) l[i] = r[i] = 0.0f;
  return -1;
}

// Weiche: das echte Handle rechnet cypher_bk_block, alle anderen (H) der Stub
std::atomic<CypherBk*> g_echt{nullptr};
int32_t weiche_rechne(CypherBk* b, float* l, float* r, size_t n) {
  if (b == g_echt.load()) return cypher_bk_block(b, l, r, n);
  return stub_rechne(b, l, r, n);
}

// Test-Naht für prioritaet(): jeder Faden scheitert (EPERM)
int prio_scheitert(unsigned long, int) { return 1; }

// Der Callback fasst das Handle an (wie cypher_bk_note_*): auch das darf nie mit dem Rechner überlappen
void note(H* h) {
  betritt(h);
  const long z = h->zaehl;   // volatile: Lesen und Schreiben bleiben bestehen, TSan sieht den Zugriff auf das Handle
  h->zaehl = z;
  verlasse(h);
}

bool warte_bis(std::atomic<bool>& f, int ms) {
  const int64_t bis = jetzt_ns() + ms * 1000000LL;
  while (!f.load() && jetzt_ns() < bis) std::this_thread::yield();
  return f.load();
}

// ---------------------------------------------------------------- Noten für die Bitgleich-Fälle
// v: Tonversatz (verschiedene Noten je Platz). Rückgabe: Zahl der abgewiesenen Aufrufe (müssen 0 sein)
int noten_fuer_block(CypherBk* h, int k, int v = 0) {
  int fehl = 0;
  if (k % 8 == 0) fehl += cypher_bk_note_an(h, 17, static_cast<uint8_t>(40 + v + k % 12), 0.7f) != 0;
  if (k % 8 == 5) fehl += cypher_bk_note_aus(h, 90, static_cast<uint8_t>(40 + v + (k - 5) % 12)) != 0;
  if (k % 31 == 3) fehl += cypher_bk_note_an(h, 201, static_cast<uint8_t>(60 + v + k % 7), 0.5f) != 0;
  return fehl;
}

float spitze(const float* x, int n) {
  float m = 0;
  for (int i = 0; i < n; ++i) m = std::max(m, std::fabs(x[i]));
  return m;
}
constexpr float PEGEL_40DB = 0.01f;   // −40 dBFS

// Fall 1: faeden 0, auftrag + sofort abholen, gegen Referenz mit cypher_bk_block
void fall_synchron_bitgleich() {
  auto w = graph_werk_neu({0, nullptr});
  CypherBk* a = graph(GA);
  CypherBk* ref = graph(GA);
  std::vector<float> rl(N), rr(N);
  int ungleich = 0, nicht_gueltig = 0, noten_fehl = 0;
  float pegel = 0;
  for (int k = 0; k < 200; ++k) {
    noten_fehl += noten_fuer_block(a, k);
    noten_fehl += noten_fuer_block(ref, k);
    PRUEF(w->auftrag(0, a, k * (int64_t)N, N));
    if (w->abholen(0, k * (int64_t)N, N) != Abholung::GUELTIG) ++nicht_gueltig;
    cypher_bk_block(ref, rl.data(), rr.data(), N);
    pegel = std::max(pegel, spitze(w->l(0), N));
    if (std::memcmp(w->l(0), rl.data(), N * sizeof(float)) || std::memcmp(w->r(0), rr.data(), N * sizeof(float))) ++ungleich;
  }
  PRUEF(noten_fehl == 0);
  PRUEF(pegel > PEGEL_40DB);   // Positivprobe: der Graph klingt, "bitgleich" ist nicht zweimal Stille
  PRUEF(w->zaehler().auftraege == 200);
  PRUEF(w->zaehler().anlauf == 0);
  PRUEF(nicht_gueltig == 0);
  PRUEF(ungleich == 0);
  PRUEF(w->zaehler().verspaetet == 0);
  std::printf("MESS synchron_bitgleich: 200 Bloecke, ungleich=%d nicht_gueltig=%d spitze=%.3f\n", ungleich, nicht_gueltig, pegel);
  w.reset();
  cypher_bk_frei(a);
  cypher_bk_frei(ref);
}

// Fall 2: faeden 2, Vorlauf-Rhythmus (Auftrag Zyklus t, Abholen t+1), Plätze 0 und 16
void fall_faeden_bitgleich() {
  auto w = graph_werk_neu({2, nullptr});
  const int P[2] = {0, 16};
  const int V[2] = {0, 7};   // verschiedene Töne je Platz: eine Vertauschung der Plätze fiele auf
  CypherBk* a[2] = {graph(GA), graph(GA)};
  CypherBk* ref[2] = {graph(GA), graph(GA)};
  std::vector<float> rl(N), rr(N);
  int ungleich = 0, nicht_gueltig = 0, noten_fehl = 0, plaetze_gleich = 0;
  float pegel[2] = {0, 0};
  const int ZYKLEN = 200;
  for (int i = 0; i < 2; ++i) {   // Block 0: Anlauf, die Referenz rechnet ihn ebenso
    noten_fehl += noten_fuer_block(a[i], 0, V[i]);
    w->anlauf(P[i], a[i], N);
  }
  for (int i = 0; i < 2; ++i) {
    noten_fehl += noten_fuer_block(ref[i], 0, V[i]);
    cypher_bk_block(ref[i], rl.data(), rr.data(), N);
    if (std::memcmp(w->l(P[i]), rl.data(), N * sizeof(float)) || std::memcmp(w->r(P[i]), rr.data(), N * sizeof(float))) ++ungleich;
  }
  for (int t = 0; t < ZYKLEN; ++t) {
    for (int i = 0; i < 2; ++i) {
      noten_fehl += noten_fuer_block(a[i], t + 1, V[i]);
      PRUEF(w->auftrag(P[i], a[i], (t + 1) * (int64_t)N, N));
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));   // den Fäden Zeit geben (sonst stiehlt abholen); die Frist unten fängt Verdrängung ab
    for (int i = 0; i < 2; ++i) {
      Abholung ab = Abholung::VERSPAETET;
      const int64_t frist = jetzt_ns() + 2000000000LL;
      while (ab == Abholung::VERSPAETET && jetzt_ns() < frist) {
        ab = w->abholen(P[i], (t + 1) * (int64_t)N, N);
        if (ab == Abholung::VERSPAETET) std::this_thread::yield();
      }
      if (ab != Abholung::GUELTIG) {
        ++nicht_gueltig;
        continue;
      }
      noten_fehl += noten_fuer_block(ref[i], t + 1, V[i]);
      cypher_bk_block(ref[i], rl.data(), rr.data(), N);
      pegel[i] = std::max(pegel[i], spitze(w->l(P[i]), N));
      if (std::memcmp(w->l(P[i]), rl.data(), N * sizeof(float)) || std::memcmp(w->r(P[i]), rr.data(), N * sizeof(float))) ++ungleich;
    }
    if (nicht_gueltig) break;
    if (!std::memcmp(w->l(P[0]), w->l(P[1]), N * sizeof(float)) && spitze(w->l(P[0]), N) > 0.0f) ++plaetze_gleich;   // beide klingen, aber gleich: Übersprechen
  }
  PRUEF(noten_fehl == 0);
  PRUEF(pegel[0] > PEGEL_40DB && pegel[1] > PEGEL_40DB);
  PRUEF(plaetze_gleich == 0);
  PRUEF(nicht_gueltig == 0);
  PRUEF(ungleich == 0);
  PRUEF(w->zaehler().gestohlen < 2u * ZYKLEN / 10);   // Positivprobe: die Fäden haben gerechnet, nicht der Callback per Stehlen
  PRUEF(w->zaehler().anlauf == 2);
  PRUEF(w->zaehler().auftraege == 2u * ZYKLEN);
  std::printf("MESS faeden_bitgleich: %d Bloecke je Platz, ungleich=%d nicht_gueltig=%d verspaetet=%llu gestohlen=%llu spitze=%.3f/%.3f\n", ZYKLEN, ungleich,
              nicht_gueltig, (unsigned long long)w->zaehler().verspaetet, (unsigned long long)w->zaehler().gestohlen, pegel[0], pegel[1]);
  w.reset();
  for (int i = 0; i < 2; ++i) {
    cypher_bk_frei(a[i]);
    cypher_bk_frei(ref[i]);
  }
}

// Fall 3, 3b und 4: ein Faden hängt an Platz 0 (Stub hält), Platz 1 wird gestohlen, Platz 0 ist verspätet und bleibt besetzt
void fall_stehlen_und_verspaetet() {
  ueberlappt = 0;
  los = false;
  H h0, h1;
  h0.halt = true;
  auto w = graph_werk_neu({1, &stub_rechne});
  PRUEF(w->auftrag(0, bk(&h0), 1000, N));
  PRUEF(warte_bis(h0.im_rechnen, 2000));
  PRUEF(w->auftrag(1, bk(&h1), 1000, N));
  // Fall 3
  const Abholung a1 = w->abholen(1, 1000, N);
  PRUEF(a1 == Abholung::GUELTIG);
  PRUEF(w->zaehler().gestohlen == 1);
  PRUEF(w->frei(1));
  PRUEF(w->l(1)[0] == 0.0f && w->l(1)[N - 1] == static_cast<float>(N - 1));
  // Fall 4
  const Abholung a0 = w->abholen(0, 1000, N);
  PRUEF(a0 == Abholung::VERSPAETET);
  PRUEF(w->zaehler().verspaetet == 1);
  PRUEF(!w->frei(0));
  PRUEF(w->zaehler().haengt == 0);   // erst ein Zyklus verspätet
  PRUEF(!w->auftrag(0, bk(&h0), 1000 + N, N));
  PRUEF(w->abholen(0, 1000, N) == Abholung::VERSPAETET);   // zwei Zyklen hintereinander
  PRUEF(w->zaehler().haengt == 1);
  PRUEF(w->zaehler().verspaetet == 2);
  PRUEF(w->zaehler().auftraege == 2);   // auf den besetzten Platz zählt kein Auftrag
  los = true;
  Abholung a = Abholung::VERSPAETET;
  const int64_t bis = jetzt_ns() + 2000000000LL;
  while (a == Abholung::VERSPAETET && jetzt_ns() < bis) {
    std::this_thread::yield();
    a = w->abholen(0, 1000 + N, N);
  }
  PRUEF(a == Abholung::VERWORFEN);
  PRUEF(w->zaehler().verworfen == 1);
  PRUEF(w->frei(0));
  PRUEF(ueberlappt.load() == 0);
  los = false;   // Fall 3b: ein AUFTRAG, den noch kein Faden angefangen hat und der nicht zum erwarteten s oder n passt, wird verworfen, ohne zu rechnen
  H h2, h3;
  h0.halt = true;
  h0.im_rechnen = false;
  PRUEF(w->auftrag(0, bk(&h0), 2000, N));
  PRUEF(warte_bis(h0.im_rechnen, 2000));   // der einzige Faden hängt wieder in Platz 0
  PRUEF(w->auftrag(2, bk(&h2), 3000, N));
  PRUEF(w->auftrag(3, bk(&h3), 3000, N));
  const uint64_t verw0 = w->zaehler().verworfen;
  PRUEF(w->abholen(2, 3000 + N, N) == Abholung::VERWORFEN);   // falsches s
  PRUEF(w->abholen(3, 3000, N / 2) == Abholung::VERWORFEN);   // falsches n
  PRUEF(h2.aufrufe.load() == 0 && h3.aufrufe.load() == 0);    // nicht gerechnet (die Mutation rechnet: dann 1)
  PRUEF(w->zaehler().verworfen == verw0 + 2);
  PRUEF(w->frei(2) && w->frei(3));
  std::printf("MESS stehlen: gestohlen=%llu verspaetet>=1 verworfen=%llu\n", (unsigned long long)w->zaehler().gestohlen,
              (unsigned long long)w->zaehler().verworfen);
  los = true;
  w.reset();
}

// Fall 5: Überlappungszähler. 50 000 Zyklen über 8 Plätze, zufälliger Schlaf zwischen Auftrag und Abholen
void fall_ueberlappung() {
  ueberlappt = 0;
  los = true;
  H h[8];
  for (int i = 0; i < 8; ++i) {
    h[i].spin_us = 300;
    h[i].rng = 777u + static_cast<uint32_t>(i);
  }
  auto w = graph_werk_neu({2, &stub_rechne});
  int64_t s[8] = {};
  uint32_t rng = 99;
  long gueltig = 0, spaet = 0;
  int zyklen = 50000;   // CYPHERDJ_GW_ZYKLEN kürzt (ctest und die Mutationsläufe: 5000)
  if (const char* e = std::getenv("CYPHERDJ_GW_ZYKLEN")) zyklen = std::max(1, std::atoi(e));
  for (int it = 0; it < zyklen; ++it) {
    for (int p = 0; p < 8; ++p) {
      if (w->frei(p)) note(&h[p]);
      if (w->auftrag(p, bk(&h[p]), s[p] + N, N)) s[p] += N;   // ein Platz, der besetzt ist, nimmt nichts an
    }
    rng = rng * 1664525u + 1013904223u;
    const int us = static_cast<int>((rng >> 8) % 200);
    if (us > 0) std::this_thread::sleep_for(std::chrono::microseconds(us));
    for (int p = 0; p < 8; ++p) {
      const Abholung a = w->abholen(p, s[p], N);
      if (a == Abholung::GUELTIG) ++gueltig;
      else if (a == Abholung::VERSPAETET) ++spaet;
    }
  }
  los = true;
  w.reset();
  PRUEF(ueberlappt.load() == 0);
  PRUEF(gueltig > 0);
  std::printf("MESS ueberlappung: %d Zyklen, ueberlappt=%ld gueltig=%ld verspaetet=%ld\n", zyklen, ueberlappt.load(), gueltig, spaet);
}

// Fall 6: auftrag, abholen, anlauf allokieren nicht (und sperren und schlafen nicht)
void fall_ohne_allokation() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("graph_werk: Allokationswaechter fehlt (Sanitizer-Bau), Fall 6 uebersprungen\n");
    return;
  }
  ueberlappt = 0;
  los = true;
  H h[4];
  auto w = graph_werk_neu({2, &stub_rechne});
  int64_t s[4] = {};
  long stehlen_oder_gueltig = 0, nicht_gueltig = 0;
  abfang_an();
  for (int it = 0; it < 200; ++it) {
    for (int p = 0; p < 4; ++p) {
      w->anlauf(p, bk(&h[p]), N);
      if (w->auftrag(p, bk(&h[p]), s[p] + N, N)) s[p] += N;
    }
    for (int p = 0; p < 4; ++p) {
      Abholung a = Abholung::VERSPAETET;
      const int64_t frist = jetzt_ns() + 2000000000LL;   // Frist in Zeit, nicht in Versuchen: der Faden kann verdrängt sein
      while (a == Abholung::VERSPAETET && jetzt_ns() < frist) {
        a = w->abholen(p, s[p], N);
        if (a == Abholung::VERSPAETET) std::this_thread::yield();
      }
      if (a == Abholung::GUELTIG) ++stehlen_oder_gueltig;
      else ++nicht_gueltig;
    }
  }
  const AbfangZahlen z = abfang_zahlen();
  abfang_aus();
  PRUEF(nicht_gueltig == 0);   // erst dann ist anlauf == 800 gesichert: jeder Platz war vor dem nächsten anlauf FREI
  PRUEF(stehlen_oder_gueltig > 0);
  PRUEF(w->zaehler().anlauf == 800 && w->zaehler().auftraege > 0);
  PRUEF(z.summe() == 0);
  std::printf("MESS ohne_allokation: alloc=%ld frei=%ld sperren=%ld schlafen=%ld gueltig=%ld\n", z.alloc, z.frei, z.sperren, z.schlafen, stehlen_oder_gueltig);
  // Positiv-Kontrolle: der Wächter sieht eine Allokation im selben Fenster
  abfang_an();
  volatile char* p = new char[64];
  delete[] p;
  const AbfangZahlen z2 = abfang_zahlen();
  abfang_aus();
  PRUEF(z2.alloc > 0);
  w.reset();
}

// ---------------------------------------------------------------- Fall 7: Mikromessung (steht vor Fall 8, damit die Datei in Nummern-Reihenfolge liest)
std::atomic<int64_t> t_eintritt{0}, t_austritt{0};
int32_t messe_rechne(CypherBk* b, float* l, float* r, size_t n) {
  t_eintritt.store(jetzt_ns(), std::memory_order_relaxed);
  const int32_t rc = cypher_bk_block(b, l, r, n);
  t_austritt.store(jetzt_ns(), std::memory_order_relaxed);
  return rc;
}

double quantil(std::vector<double>& v, double q) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  size_t i = static_cast<size_t>(q * (v.size() - 1) + 0.5);
  return v[std::min(i, v.size() - 1)];
}

void fall_mikro(int zyklen, bool schwelle) {
  std::ifstream in(std::string(CYPHERDJ_DJK) + "/instrumente/baukasten_dsp/beispiele/juno-pad.json");
  PRUEF(in.good());
  std::stringstream ss;
  ss << in.rdbuf();
  const std::string json = ss.str();
  CypherBk* g = graph(json.c_str());
  if (!g) return;
  auto w = graph_werk_neu({2, &messe_rechne});
  const int64_t PERIODE_NS = 5333333;   // 256 Frames bei 48 kHz
  std::vector<double> bis_rechnet, bis_fertig;
  bis_rechnet.reserve(zyklen);
  bis_fertig.reserve(zyklen);
  int64_t s = 0, t_auf = 0;
  long nicht_gueltig = 0;
  const int64_t t0 = jetzt_ns();
  for (int k = 0; k < zyklen; ++k) {
    struct timespec ziel;
    const int64_t z = t0 + (int64_t)k * PERIODE_NS;
    ziel.tv_sec = z / 1000000000LL;
    ziel.tv_nsec = z % 1000000000LL;
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ziel, nullptr);
    if (k > 0) {
      if (w->abholen(0, s, N) == Abholung::GUELTIG) {
        bis_rechnet.push_back((t_eintritt.load(std::memory_order_relaxed) - t_auf) / 1e3);
        bis_fertig.push_back((t_austritt.load(std::memory_order_relaxed) - t_auf) / 1e3);
      } else {
        ++nicht_gueltig;
      }
    } else {
      for (int i = 0; i < 8; ++i) cypher_bk_note_an(g, 0, static_cast<uint8_t>(48 + 4 * i), 0.8f);   // acht Noten gehalten
    }
    if (w->frei(0)) {
      s += N;
      t_auf = jetzt_ns();
      w->auftrag(0, g, s, N);
    }
  }
  const GraphZaehler gz = w->zaehler();
  w.reset();
  cypher_bk_frei(g);
  const double r50 = quantil(bis_rechnet, 0.5), r99 = quantil(bis_rechnet, 0.99), r999 = quantil(bis_rechnet, 0.999);
  const double f50 = quantil(bis_fertig, 0.5), f99 = quantil(bis_fertig, 0.99), f999 = quantil(bis_fertig, 0.999);
  const double fmax = quantil(bis_fertig, 1.0);
  std::printf("MESS mikro (SCHED_OTHER, 2 Faeden, juno-pad 8 Noten, %d Zyklen, n=%zu): bis RECHNET us p50=%.0f p99=%.0f p99,9=%.0f | "
              "bis FERTIG us p50=%.0f p99=%.0f p99,9=%.0f max=%.0f | nicht_gueltig=%ld verspaetet=%llu gestohlen=%llu\n",
              zyklen, bis_fertig.size(), r50, r99, r999, f50, f99, f999, fmax, nicht_gueltig, (unsigned long long)gz.verspaetet,
              (unsigned long long)gz.gestohlen);
  PRUEF(!bis_fertig.empty());
  if (schwelle && f999 > 2667.0) {
    std::printf("HALT-SCHWELLE GERISSEN: FERTIG p99,9 %.0f us > 2667 us (halbe Periode)\n", f999);
    PRUEF(false);
  }
}

// Fall 8: Rückfall auf synchron, Platzgrenzen, Abholen-Ecken, panik
void fall_rueckfall() {
  {
    H h;
    auto w = graph_werk_neu({2, &stub_rechne});
    PRUEF(w->faeden() == 2);
    PRUEF(w->prioritaet(0) == 2);   // keine JACK-Priorität: alle Fäden ohne SCHED_FIFO, Werk synchron
    PRUEF(w->faeden() == 0);
    PRUEF(w->auftrag(0, bk(&h), 0, N));
    PRUEF(w->abholen(0, 0, N) == Abholung::GUELTIG);
    PRUEF(w->zaehler().gestohlen == 0);   // synchron gerechnet, nicht gestohlen
  }
  {   // SCHED_FIFO scheitert (Test-Naht), während der Callback läuft; danach rechnet das Werk synchron und bitgleich
    ueberlappt = 0;
    los = true;
    auto w = graph_werk_neu({2, &weiche_rechne, &prio_scheitert});
    H h[2];
    std::atomic<bool> ende{false};
    std::atomic<long> zyklen{0}, gueltig{0}, andere{0};
    std::thread cb([&] {   // der "Callback": Plätze 1 und 2, Auftrag t, Abholen t+1; läuft, bis der Test den Rückfall belegt hat
      int64_t s[2] = {};
      while (!ende.load()) {
        for (int i = 0; i < 2; ++i)
          if (w->auftrag(1 + i, bk(&h[i]), s[i] + N, N)) s[i] += N;
        for (int i = 0; i < 2; ++i) {
          Abholung a = w->abholen(1 + i, s[i], N);
          if (a == Abholung::GUELTIG) gueltig.fetch_add(1);
          else if (a != Abholung::VERSPAETET) andere.fetch_add(1);
        }
        zyklen.fetch_add(1);
        std::this_thread::yield();
      }
    });
    auto warte_zyklen = [&](long mehr) {   // bis der Callback `mehr` weitere Zyklen gefahren hat (Frist 5 s)
      const long ziel = zyklen.load() + mehr;
      const int64_t frist = jetzt_ns() + 5000000000LL;
      while (zyklen.load() < ziel && jetzt_ns() < frist) std::this_thread::yield();
      return zyklen.load() >= ziel;
    };
    PRUEF(warte_zyklen(200));   // der Callback läuft nachweislich
    PRUEF(w->faeden() == 2);
    const int fehl = w->prioritaet(60);   // der Rückfall greift unter dem laufenden Callback
    PRUEF(fehl == 2);
    PRUEF(w->faeden() == 0);
    const long gueltig_vor = gueltig.load();
    PRUEF(warte_zyklen(200));   // und läuft nach dem Rückfall weiter (synchron)
    PRUEF(gueltig.load() > gueltig_vor);
    ende = true;
    cb.join();
    PRUEF(ueberlappt.load() == 0);
    PRUEF(gueltig_vor > 0);
    PRUEF(andere.load() == 0);
    // synchron weiter, bitgleich gegen cypher_bk_block
    CypherBk* g = graph(GA);
    CypherBk* ref = graph(GA);
    g_echt = g;
    std::vector<float> rl(N), rr(N);
    int ungleich = 0, nicht_gueltig = 0;
    float pegel = 0;
    for (int k = 0; k < 100; ++k) {
      noten_fuer_block(g, k);
      noten_fuer_block(ref, k);
      PRUEF(w->auftrag(5, g, k * (int64_t)N, N));
      if (w->abholen(5, k * (int64_t)N, N) != Abholung::GUELTIG) ++nicht_gueltig;
      cypher_bk_block(ref, rl.data(), rr.data(), N);
      pegel = std::max(pegel, spitze(w->l(5), N));
      if (std::memcmp(w->l(5), rl.data(), N * sizeof(float)) || std::memcmp(w->r(5), rr.data(), N * sizeof(float))) ++ungleich;
    }
    PRUEF(nicht_gueltig == 0 && ungleich == 0);
    PRUEF(pegel > PEGEL_40DB);
    std::printf("MESS rueckfall_prio_scheitert: faeden()=%d gueltig_waehrend=%ld ungleich=%d spitze=%.3f\n", w->faeden(), gueltig.load(), ungleich, pegel);
    w.reset();
    cypher_bk_frei(g);
    cypher_bk_frei(ref);
  }
  {   // echte Priorität: ohne RT-Recht synchron, mit: Fäden bleiben
    H h;
    auto w = graph_werk_neu({2, &stub_rechne});
    const int fehl = w->prioritaet(60);
    std::printf("MESS rueckfall: prioritaet(60) -> %d ohne SCHED_FIFO, faeden()=%d\n", fehl, w->faeden());
    PRUEF(w->faeden() == (fehl > 0 ? 0 : 2));
    PRUEF(w->auftrag(0, bk(&h), 0, N));
    Abholung a = Abholung::VERSPAETET;
    const int64_t bis = jetzt_ns() + 2000000000LL;
    while (a == Abholung::VERSPAETET && jetzt_ns() < bis) a = w->abholen(0, 0, N);
    PRUEF(a == Abholung::GUELTIG);
  }
  {
    H h;
    auto w = graph_werk_neu({2, &stub_rechne});
    w->stoppe();
    w->stoppe();   // idempotent
    PRUEF(w->faeden() == 0);
    PRUEF(w->auftrag(0, bk(&h), 0, N));
    PRUEF(w->abholen(0, 0, N) == Abholung::GUELTIG);
  }
  {   // Ecken von abholen: FERTIG mit falschem n wird verworfen, ein freier gültiger Platz meldet LEER
    H h;
    auto w = graph_werk_neu({0, &stub_rechne});
    PRUEF(w->abholen(4, 0, N) == Abholung::LEER);   // nie beauftragt
    PRUEF(w->auftrag(4, bk(&h), 500, N));           // synchron: der Platz steht auf FERTIG
    PRUEF(w->abholen(4, 500, N / 2) == Abholung::VERWORFEN);   // richtiges s, falsches n
    PRUEF(w->zaehler().verworfen == 1);
    PRUEF(w->frei(4));
    PRUEF(w->abholen(4, 500, N) == Abholung::LEER);   // und danach wieder leer
    PRUEF(w->auftrag(4, bk(&h), 500, N));
    PRUEF(w->abholen(4, 500, N) == Abholung::GUELTIG);
    PRUEF(w->abholen(4, 500, N) == Abholung::LEER);   // schon abgeholt
  }
  {   // Plätze außerhalb 0..31 tun nichts, ohne Modulo auf einen anderen Platz
    H h;
    auto w = graph_werk_neu({0, &stub_rechne});
    const int schlecht[] = {-1, GW_PLAETZE, GW_PLAETZE + 1, 1000};
    for (int p : schlecht) {
      PRUEF(!w->auftrag(p, bk(&h), 0, N));
      PRUEF(w->abholen(p, 0, N) == Abholung::LEER);
      PRUEF(!w->frei(p));
      PRUEF(w->l(p) == nullptr && w->r(p) == nullptr);
      w->anlauf(p, bk(&h), N);
    }
    PRUEF(h.aufrufe.load() == 0);
    PRUEF(w->zaehler().auftraege == 0 && w->zaehler().anlauf == 0);
    PRUEF(w->frei(0) && w->frei(GW_PLAETZE - 1));   // gültige Ränder bleiben
    PRUEF(w->auftrag(GW_PLAETZE - 1, bk(&h), 0, N));
    PRUEF(h.aufrufe.load() == 1);
  }
  {   // panik: ein Rust-Panic (rc < 0) wird gezählt, im Anlauf wie im Auftrag
    H h;
    auto w = graph_werk_neu({0, &stub_panik});
    w->anlauf(0, bk(&h), N);
    PRUEF(w->zaehler().panik == 1);
    PRUEF(w->auftrag(1, bk(&h), 0, N));
    PRUEF(w->zaehler().panik == 2);
  }
}

}  // namespace

// Prüfung R1: startet ein Faden nicht (std::thread wirft), rechnet das Werk synchron statt std::terminate. Die Naht ist
// RLIMIT_NPROC unter der Zahl der laufenden Prozesse des Nutzers (gilt nicht für root: dann übersprungen).
void fall_fadenstart_scheitert() {
  rlimit alt{};
  PRUEF(getrlimit(RLIMIT_NPROC, &alt) == 0);
  if (geteuid() == 0) { std::printf("MESS fadenstart: als root übersprungen\n"); return; }
  rlimit eng = alt;
  eng.rlim_cur = 1;
  PRUEF(setrlimit(RLIMIT_NPROC, &eng) == 0);
  auto w = graph_werk_neu({2, &stub_rechne});
  PRUEF(setrlimit(RLIMIT_NPROC, &alt) == 0);
  PRUEF(w->faeden() == 0);   // Positivkontrolle faeden() == 2 ohne Grenze: fall_rueckfall
  H h;
  PRUEF(w->auftrag(0, bk(&h), 0, N));
  PRUEF(w->abholen(0, 0, N) == Abholung::GUELTIG);
  std::printf("MESS fadenstart: faeden %d nach gescheitertem Start\n", w->faeden());
}

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "mikro") == 0) {
    fall_mikro(10000, true);
    PRUEF_ENDE();
  }
  fall_synchron_bitgleich();
  fall_faeden_bitgleich();
  fall_stehlen_und_verspaetet();
  fall_ueberlappung();
  fall_ohne_allokation();
  fall_rueckfall();
  fall_fadenstart_scheitert();
  fall_mikro(300, false);   // Rauchlauf, keine Schwelle
  PRUEF_ENDE();
}
