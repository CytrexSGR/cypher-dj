// Baukasten S3b Task 1: das Graph-Werk (graph_werk.h). Plätze mit Zustandsautomat FREI -> AUFTRAG -> RECHNET -> FERTIG -> FREI,
// Fäden nach dem Muster von warp_werk.cpp (sem_t je Faden, Wartezeit 5 ms, SCHED_FIFO unter JACK).
#include "cypherdj/graph_werk.h"

#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <time.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <system_error>
#include <thread>

#include <cypherdj/dsp/denormal.h>

namespace cdj {
namespace {

constexpr int WARTE_MS = 5;
constexpr int JACK_ABSTAND = 7;   // SCHED_FIFO JACK − 7: unter Warp (−6) und Keylock (−5)

enum Zustand : int { FREI = 0, AUFTRAG = 1, RECHNET = 2, FERTIG = 3 };

struct alignas(64) Platz {
  std::atomic<int> zustand{FREI};
  CypherBk* bk = nullptr;      // vom Callback vor AUFTRAG gesetzt, danach nur der Rechner
  int64_t s = 0;
  int n = 0;
  bool war_rechnet = false;    // nur der Callback: der Platz war im Vorzyklus schon verspätet
  alignas(64) float l[MIX_BLOCK];
  alignas(64) float r[MIX_BLOCK];
};

int echte_prio(unsigned long faden, int prio) {
  sched_param sp{};
  sp.sched_priority = prio;
  return pthread_setschedparam(static_cast<pthread_t>(faden), SCHED_FIFO, &sp);
}

class WerkImpl final : public GraphWerk {
 public:
  explicit WerkImpl(const GraphWerkOptionen& o)
      : faeden_(std::clamp(o.faeden, 0, GW_FAEDEN_MAX)), rechne_(o.rechne ? o.rechne : &cypher_bk_block), prio_(o.prio_setzen ? o.prio_setzen : &echte_prio), plaetze_(new Platz[GW_PLAETZE]) {
    for (int i = 0; i < GW_PLAETZE; ++i) {   // Seiten vorwärmen (keine Seitenfehler im Callback)
      std::memset(plaetze_[i].l, 0, sizeof plaetze_[i].l);
      std::memset(plaetze_[i].r, 0, sizeof plaetze_[i].r);
    }
    synchron_.store(faeden_ == 0, std::memory_order_release);
    for (int w = 0; w < faeden_; ++w) sem_init(&sem_[w], 0, 0);
    try {
      for (int w = 0; w < faeden_; ++w) t_[w] = std::thread([this, w] { faden(w); });
    } catch (const std::system_error& e) {   // Prüfung R1: ein Faden startet nicht → synchron statt std::terminate
      std::fprintf(stderr, "Graph-Werk: Faden startet nicht (%s), rechne synchron\n", e.what());
      stoppe();   // synchron_ zuerst, dann gestartete Fäden wecken und joinen; faeden() meldet 0
    }
  }
  ~WerkImpl() override {
    stoppe();
    for (int w = 0; w < faeden_; ++w) sem_destroy(&sem_[w]);
  }

  // ---------------------------------------------------------------- Callback
  bool frei(int platz) const noexcept override { return gueltig(platz) && pl(platz).zustand.load(std::memory_order_acquire) == FREI; }

  bool auftrag(int platz, CypherBk* bk, int64_t s, int n) noexcept override {
    if (!gueltig(platz)) return false;
    Platz& p = pl(platz);
#ifndef CYPHERDJ_MUTATION_GW_AUFTRAG_BESETZT   // Fehlerfall: auftrag fragt FREI nicht und überschreibt einen Platz, an dem ein Faden rechnet
    if (p.zustand.load(std::memory_order_acquire) != FREI) return false;
#endif
    if (n <= 0 || n > MIX_BLOCK) return false;
    p.bk = bk;
    p.s = s;
    p.n = n;
    p.war_rechnet = false;
    auftraege_.fetch_add(1, std::memory_order_relaxed);
    if (synchron_.load(std::memory_order_acquire)) {
      p.zustand.store(RECHNET, std::memory_order_relaxed);   // synchron: kein Faden greift auf den Platz
      rechne_platz(p);
      return true;
    }
    p.zustand.store(AUFTRAG, std::memory_order_seq_cst);   // vor dem Wecken; ein trotzdem verpasster Wecker kostet höchstens WARTE_MS, der Callback stiehlt sonst
    for (int w = 0; w < faeden_; ++w) {                     // wartefrei, höchstens ein Wecker steht an
      int v = 0;
      if (sem_getvalue(&sem_[w], &v) == 0 && v > 0) continue;
      sem_post(&sem_[w]);
    }
    return true;
  }

  Abholung abholen(int platz, int64_t s, int n) noexcept override {
    if (!gueltig(platz)) return Abholung::LEER;
    Platz& p = pl(platz);
    for (;;) {
      int z = p.zustand.load(std::memory_order_acquire);
      switch (z) {
        case AUFTRAG: {
#ifdef CYPHERDJ_MUTATION_GW_OHNE_STEHLEN   // Fehlerfall: ein Auftrag, den kein Faden angefangen hat, gilt als verspätet statt vom Callback gerechnet
          verspaetet_.fetch_add(1, std::memory_order_relaxed);
          return Abholung::VERSPAETET;
#else
          int e = AUFTRAG;
          if (!p.zustand.compare_exchange_strong(e, RECHNET, std::memory_order_acq_rel, std::memory_order_acquire)) continue;   // ein Faden war schneller: neu lesen
#ifndef CYPHERDJ_MUTATION_GW_VERWERFEN_RECHNET   // Fehlerfall: auch ein Block für ein anderes s/n wird noch gerechnet (Rechenkosten, Graphzustand)
          if (p.s != s || p.n != n) {   // nicht der erwartete Block: gar nicht erst rechnen
            p.zustand.store(FREI, std::memory_order_release);
            verworfen_.fetch_add(1, std::memory_order_relaxed);
            return Abholung::VERWORFEN;
          }
#endif
          gestohlen_.fetch_add(1, std::memory_order_relaxed);
          rechne_platz(p);
          continue;   // jetzt FERTIG
#endif
        }
        case RECHNET:
          verspaetet_.fetch_add(1, std::memory_order_relaxed);
          if (p.war_rechnet) haengt_.fetch_add(1, std::memory_order_relaxed);
          p.war_rechnet = true;
#ifdef CYPHERDJ_MUTATION_GW_SPAET_GUELTIG   // Fehlerfall: ein Puffer, der noch geschrieben wird, gilt als gültig
          return Abholung::GUELTIG;
#else
          return Abholung::VERSPAETET;
#endif
        case FERTIG: {
          p.war_rechnet = false;
#ifndef CYPHERDJ_MUTATION_GW_FALSCHES_S   // Fehlerfall: s und n werden nicht geprüft
          if (p.s != s || p.n != n) {
            p.zustand.store(FREI, std::memory_order_release);
            verworfen_.fetch_add(1, std::memory_order_relaxed);
            return Abholung::VERWORFEN;
          }
#endif
          p.zustand.store(FREI, std::memory_order_release);
          return Abholung::GUELTIG;
        }
        default:
          return Abholung::LEER;
      }
    }
  }

  void anlauf(int platz, CypherBk* bk, int n) noexcept override {
    if (!gueltig(platz)) return;
    Platz& p = pl(platz);
    if (p.zustand.load(std::memory_order_acquire) != FREI || n <= 0 || n > MIX_BLOCK) return;
    anlauf_.fetch_add(1, std::memory_order_relaxed);
    cypherdj::dsp::DenormalSchutz schutz;
    if (rechne_(bk, p.l, p.r, static_cast<size_t>(n)) < 0) panik_.fetch_add(1, std::memory_order_relaxed);
  }

  const float* l(int platz) const noexcept override { return gueltig(platz) ? pl(platz).l : nullptr; }
  const float* r(int platz) const noexcept override { return gueltig(platz) ? pl(platz).r : nullptr; }

  // ---------------------------------------------------------------- Betrieb
  int faeden() const noexcept override { return synchron_.load(std::memory_order_acquire) ? 0 : faeden_; }

  int prioritaet(int jack_prio) override {
    if (faeden_ == 0 || synchron_.load(std::memory_order_acquire)) return 0;
    if (jack_prio <= 0) {
      std::fprintf(stderr, "Graph-Werk: keine JACK-Priorität bekannt (%d): rechnet synchron im Callback\n", jack_prio);
      const int n = faeden_;
      rueckfall();
      return n;
    }
    sched_param sp{};
    sp.sched_priority = std::max(1, jack_prio - JACK_ABSTAND);
    int fehl = 0;
    for (int w = 0; w < faeden_; ++w) {
      const int r = prio_(static_cast<unsigned long>(t_[w].native_handle()), sp.sched_priority);
      if (r != 0) {
        ++fehl;
        std::fprintf(stderr, "Graph-Werk: Faden %d ohne SCHED_FIFO %d (JACK %d): %s\n", w + 1, sp.sched_priority, jack_prio, std::strerror(r));
      }
    }
    if (fehl > 0) {
      std::fprintf(stderr, "Graph-Werk: %d von %d Fäden ohne SCHED_FIFO: rechnet synchron im Callback\n", fehl, faeden_);
#ifndef CYPHERDJ_MUTATION_GW_KEIN_RUECKFALL   // Fehlerfall: das Werk meldet den Fehler, bleibt aber bei den Fäden ohne Echtzeit-Recht
      rueckfall();
#endif
    } else {
      std::fprintf(stderr, "Graph-Werk: %d Fäden SCHED_FIFO %d (JACK %d)\n", faeden_, sp.sched_priority, jack_prio);
    }
    return fehl;
  }

  void stoppe() override {
    synchron_.store(true, std::memory_order_seq_cst);   // zuerst: der Callback rechnet ab jetzt selbst; erst dann gehen die Fäden
    if (stop_.exchange(true)) return;
    for (int w = 0; w < faeden_; ++w) sem_post(&sem_[w]);
    for (int w = 0; w < faeden_; ++w)
      if (t_[w].joinable()) t_[w].join();
  }

  GraphZaehler zaehler() const noexcept override {
    GraphZaehler z;
    z.auftraege = auftraege_.load(std::memory_order_relaxed);
    z.gestohlen = gestohlen_.load(std::memory_order_relaxed);
    z.anlauf = anlauf_.load(std::memory_order_relaxed);
    z.verspaetet = verspaetet_.load(std::memory_order_relaxed);
    z.verworfen = verworfen_.load(std::memory_order_relaxed);
    z.haengt = haengt_.load(std::memory_order_relaxed);
    z.panik = panik_.load(std::memory_order_relaxed);
    return z;
  }

 private:
  static bool gueltig(int platz) noexcept { return platz >= 0 && platz < GW_PLAETZE; }
  Platz& pl(int platz) noexcept { return plaetze_[platz]; }   // nur nach gueltig()
  const Platz& pl(int platz) const noexcept { return plaetze_[platz]; }

  void rueckfall() { stoppe(); }   // synchron_ zuerst (in stoppe), dann die Fäden

  // Der Platz steht auf RECHNET und gehört dem Aufrufer.
  void rechne_platz(Platz& p) noexcept {
    {
      cypherdj::dsp::DenormalSchutz schutz;   // D11: FTZ/DAZ je Rechnung
      if (rechne_(p.bk, p.l, p.r, static_cast<size_t>(p.n)) < 0) panik_.fetch_add(1, std::memory_order_relaxed);
    }
    p.zustand.store(FERTIG, std::memory_order_release);
  }

  bool nimm(int platz) noexcept {
    Platz& p = plaetze_[platz];
    if (p.zustand.load(std::memory_order_relaxed) != AUFTRAG) return false;
    int e = AUFTRAG;
    if (!p.zustand.compare_exchange_strong(e, RECHNET, std::memory_order_acq_rel, std::memory_order_relaxed)) return false;
    rechne_platz(p);
    return true;
  }

  void faden(int w) {
    char nm[16];
    std::snprintf(nm, sizeof nm, "graph-werk-%d", w % 100 + 1);
    pthread_setname_np(pthread_self(), nm);
    while (!stop_.load(std::memory_order_acquire)) {
      while (sem_trywait(&sem_[w]) == 0) {   // Wecker vor dem Suchen leeren: ein Auftrag nach der Suche weckt wieder
      }
      bool tat = false;
      for (int p = w; p < GW_PLAETZE; p += faeden_) tat = nimm(p) || tat;   // zuerst die eigenen Plätze
      for (int p = 0; p < GW_PLAETZE; ++p)
        if (p % faeden_ != w) tat = nimm(p) || tat;                          // dann helfen
      if (!tat) warte(&sem_[w]);
    }
  }

  static void warte(sem_t* s) {
    timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    t.tv_nsec += static_cast<long>(WARTE_MS) * 1000000L;
    while (t.tv_nsec >= 1000000000L) {
      t.tv_nsec -= 1000000000L;
      ++t.tv_sec;
    }
    while (sem_clockwait(s, CLOCK_MONOTONIC, &t) != 0 && errno == EINTR) {
    }
  }

  int faeden_;
  GraphRechne rechne_;
  GraphPrioSetzer prio_;
  std::unique_ptr<Platz[]> plaetze_;
  std::atomic<bool> synchron_{false};   // der Konstruktor setzt es nach faeden_
  std::atomic<bool> stop_{false};
  sem_t sem_[GW_FAEDEN_MAX];
  std::thread t_[GW_FAEDEN_MAX];
  std::atomic<uint64_t> auftraege_{0}, gestohlen_{0}, anlauf_{0}, verspaetet_{0}, verworfen_{0}, haengt_{0}, panik_{0};
};

}  // namespace

std::unique_ptr<GraphWerk> graph_werk_neu(const GraphWerkOptionen& o) { return std::make_unique<WerkImpl>(o); }

}  // namespace cdj
