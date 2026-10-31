// Paket 1.13 Warp, Slice 2: das Warp-Werk (warp_werk.h). Ohne Bungee-Wissen: Pool, Aufträge (Dreifachpuffer je Platz), Ringe, Lebensdauer und
// Fäden stehen hier; die Rechnung einer Stimme steckt hinter WarpMaschine (warp_werk_bungee.cpp).
#include "cypherdj/warp_werk.h"

#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <time.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#include "cypherdj/dehner.h"       // DehnerKosten (Histogramm), EPOCHE_KEINE
#include "cypherdj/dreifach.h"
#include "cypherdj/warp_abbildung.h"
#include "cypherdj/warp_maschine.h"

#ifndef CYPHERDJ_BUNGEE
namespace cdj {
std::unique_ptr<WarpMaschine> warp_maschine_bungee_neu(bool) { return nullptr; }   // ohne Bungee gibt es kein Werk (warp_werk_neu liefert nullptr)
}  // namespace cdj
#endif

namespace cdj {
namespace {

constexpr int INTAKE_JE_RUNDE = 2;       // Aufträge, die ein Faden je Runde übernimmt (ein Ansatz kostet ~780 µs, die Ringe der anderen Stimmen tragen 171 ms)
constexpr int BLOECKE_JE_BESUCH = 8;     // Blöcke, die ein Faden je Besuch einer Stimme schreibt, bevor er zur nächsten geht
constexpr int WARTE_MS = 5;
constexpr int64_t QUELLE_NACHLAUF = 1024;   // Frames hinter dem Dateiende, bis die Quelle als erschöpft gilt (Bungee läuft über Nullen aus)

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

// Eine Stimme: Callback-Seite, Faden-Seite, Abbildung. Die Abbildung (WarpAbbild) liest die Kopie des Fadens, nie den Schnappschuss.
struct Stimme final : WarpAbbild {
  // ---- nur der Callback
  bool belegt = false;
  uint32_t epoche_cb = 0;
  // ---- Callback schreibt, Faden liest
  Dreifach<WarpAnsatz> post;
  std::atomic<uint32_t> soll{0};         // die Epoche, die gelten soll (0: keine); steht VOR dem Auftrag, den sie deckt (ansetzen)
  std::atomic<uint32_t> posts{0};        // Zahl der Aufträge, die der Callback gestellt hat
  std::atomic<uint32_t> gelesen{0};      // davon vom Faden übernommen (Kopie fertig); posts != gelesen heißt: ein Zeiger in einen Schnappschuss ist offen
  // ---- Faden schreibt, Lade-Faden liest
  std::atomic<const ArrAudio*> haelt{nullptr};   // das Audio, das diese Stimme liest oder noch lesen wird: vom Übernehmen des Auftrags bis zu ihrem Ende im Faden
  // ---- Faden schreibt, Callback liest
  std::atomic<int64_t> ende{INT64_MAX};
  std::atomic<uint32_t> ende_ep{0};      // die Epoche, zu der `ende` gehört
  std::unique_ptr<StreckRing> ring;
  // ---- nur der Faden
  bool aktiv = false;
  bool angesetzt = false;
  uint32_t epoche = 0;
  int64_t s_h = 0, s_ende = 0;
  int64_t geschrieben_bis = 0;           // nächstes Sample, das der Faden in den Ring schreibt
  double beat_versatz = 0.0;
  Karte karte;
  const ArrAudio* audio = nullptr;
  int64_t frames = 0;                    // Länge der Quelle, beim Übernehmen gelesen (das Audio selbst nur, solange haelt es hält)
  int modus = ARR_WARP_COMPLEX;
  std::vector<double> mb, mf;            // Marker (Kopie), je höchstens ARR_WARP_MARKER_MAX
  ArrWarp w;
  float pl[WARP_BLOCK], pr[WARP_BLOCK];  // ein fertiger Block, den der Ring noch nicht nahm
  bool block_da = false;
  std::unique_ptr<WarpMaschine> m[2];    // 0: Korn 512 (COMPLEX), 1: Korn 256 (TONES)

  double clipbeat(double s) const noexcept { return karte.beat_at(s) + beat_versatz; }
  double position(double s) const noexcept override { return warp_frame(w, clipbeat(s)); }
  double geschwindigkeit(double s) const noexcept override {
    return warp_steigung(w, clipbeat(s)) * karte.bpm_at(s) / 60.0 / RATE;
  }
  double tonhoehe() const noexcept override { return w.pitch; }
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    const float* d = audio->daten;
    const int64_t fr = audio->frames;
    for (int i = 0; i < n; ++i) {
      const int64_t f = ab + i;
      const bool innen = f >= 0 && f < fr;
      l[i] = innen ? d[2 * f] : 0.0f;
      r[i] = innen ? d[2 * f + 1] : 0.0f;
    }
  }
};

class WerkImpl final : public WarpWerk {
 public:
  explicit WerkImpl(int faeden) : faeden_(faeden) {
    // Die 128 Bungee-Maschinen nacheinander kosteten 83 ms im Startpfad, also in jedem Kern-Neustart (2026-10-29: Neustart
    // 190 statt 30 ms). Jeder Platz hat nur eigene Daten (pffft-Pläne ohne geteilten Zustand): parallel, vor allen Werk-Fäden.
    auto baue = [this](int von, int schritt) {
      for (int p = von; p < ARR_WARP_PLAETZE; p += schritt) {
        Stimme& st = st_[p];
        st.ring = std::make_unique<StreckRing>(12288);   // 16 384 Frames Fassungsvermögen: Vorlauf 8192 plus Reserve für ältere Epochen
        st.mb.assign(ARR_WARP_MARKER_MAX, 0.0);
        st.mf.assign(ARR_WARP_MARKER_MAX, 0.0);
        st.m[0] = warp_maschine_bungee_neu(false);
        st.m[1] = warp_maschine_bungee_neu(true);
      }
    };
    const int bauer = static_cast<int>(std::clamp(std::thread::hardware_concurrency(), 1u, 8u));
    std::vector<std::thread> b;
    for (int k = 1; k < bauer; ++k) b.emplace_back(baue, k, bauer);
    baue(0, bauer);
    for (auto& t : b) t.join();
    for (int p = 0; p < ARR_WARP_PLAETZE; ++p)
      if (!st_[p].m[0] || !st_[p].m[1]) {
        ok_ = false;
        faeden_ = 0;   // nichts zu stoppen
        return;
      }
    kosten_.resize(static_cast<std::size_t>(std::max(faeden_, 1)));
    for (int w = 0; w < faeden_; ++w) sem_init(&sem_[w], 0, 0);
    for (int w = 0; w < faeden_; ++w) t_[w] = std::thread([this, w] { faden(w); });
  }
  ~WerkImpl() override {
    stoppe();
    for (int w = 0; w < faeden_; ++w) sem_destroy(&sem_[w]);
  }
  bool ok() const { return ok_; }

  // ---------------------------------------------------------------- Callback
  int belege() noexcept override {
    for (int p = 0; p < ARR_WARP_PLAETZE; ++p)
      if (!st_[p].belegt) {
        st_[p].belegt = true;
        ++belegt_;
        return p;
      }
    return -1;
  }

  void ansetzen(int p, WarpAnsatz& a) noexcept override {
    Stimme& st = st_[p];
    ++st.epoche_cb;
    if (st.epoche_cb == EPOCHE_KEINE) st.epoche_cb = 1;
    a.epoche = st.epoche_cb;
    st.ring->setze_epoche(a.epoche);   // der Callback ist der Leser: ab jetzt gilt nur die neue Epoche
    st.ring->leeren();                 // was im Ring liegt, gehörte der alten
#if defined(CYPHERDJ_MUTATION_WARP_SOLL_NACH_SCHREIBE) || defined(CYPHERDJ_MUTATION_WARP_SOLL_NACH_SCHREIBE_ENG)
    // Fehlerfall: der Auftrag ist sichtbar, bevor soll ihn deckt. SCHREIBE: das Fenster steht weit offen (der Callback wartet, bis der Faden ihn gesehen hat): der Faden hält
    // den neuesten Auftrag für überholt und verwirft ihn, die Stimme rechnet nie. SCHREIBE_ENG: die Reihenfolge der ersten Fassung ohne Wartezeit, das Fenster ist wenige
    // Nanosekunden breit (kein Test: der Verlust tritt nur in einem Teil der Läufe auf; der Plan fährt ihn von Hand, Task 3 Step 6)
    st.post.schreibe(a);
    st.posts.fetch_add(1, std::memory_order_seq_cst);
#ifndef CYPHERDJ_MUTATION_WARP_SOLL_NACH_SCHREIBE_ENG
    for (int i = 0; i < 2000 && st.gelesen.load(std::memory_order_seq_cst) != st.posts.load(std::memory_order_seq_cst); ++i)
      std::this_thread::sleep_for(std::chrono::microseconds(10));
#endif
    st.soll.store(a.epoche, std::memory_order_seq_cst);
#else
    // Erst soll, dann der Auftrag: ein Faden, der ihn holt, findet seine Epoche gedeckt (sonst hielte er ihn für überholt und verwürfe ihn, D4); einen
    // älteren Auftrag, den er statt seiner holt, verwirft er zu Recht
    st.soll.store(a.epoche, std::memory_order_seq_cst);
    st.post.schreibe(a);
    st.posts.fetch_add(1, std::memory_order_seq_cst);
#endif
  }

  void gib(int p) noexcept override {
    Stimme& st = st_[p];
    if (!st.belegt) return;
    st.belegt = false;
    --belegt_;
    WarpAnsatz& pl = st.post.platz();
    pl.clip = nullptr;
    pl.epoche = 0;
    st.post.veroeffentliche();
    st.soll.store(0, std::memory_order_seq_cst);
    st.posts.fetch_add(1, std::memory_order_seq_cst);
  }

  StreckRing& ring(int p) noexcept override { return *st_[p].ring; }

  int64_t ende_s(int p) const noexcept override {
    const Stimme& st = st_[p];
    if (st.ende_ep.load(std::memory_order_acquire) != st.epoche_cb) return INT64_MAX;
    return st.ende.load(std::memory_order_relaxed);
  }

  void takt(int64_t s_jetzt) noexcept override {
    s_jetzt_.store(s_jetzt, std::memory_order_release);
    if (faeden_ == 0) {
      if (halte_.load(std::memory_order_relaxed)) return;
      int intakes = 0;
      for (int p = 0; p < ARR_WARP_PLAETZE; ++p) arbeite(st_[p], 0, 1 << 30, intakes, 1 << 30);
      return;
    }
    if (belegt_ == 0) return;   // nichts zu rechnen; Aufträge zum Beenden holen die Fäden bei ihrem nächsten Umlauf (WARTE_MS)
    for (int w = 0; w < faeden_; ++w) {   // wie keylock_wecken: wartefrei, höchstens ein Wecker steht an
      int v = 0;
      if (sem_getvalue(&sem_[w], &v) == 0 && v > 0) continue;
      sem_post(&sem_[w]);
    }
  }

  int belegt() const noexcept override { return belegt_; }

  // ---------------------------------------------------------------- Lade-Faden
  bool liest(const ArrSnapshot* s) const noexcept override {
    for (int p = 0; p < ARR_WARP_PLAETZE; ++p)
      if (st_[p].posts.load(std::memory_order_seq_cst) != st_[p].gelesen.load(std::memory_order_seq_cst)) return true;   // ein Auftrag trägt vielleicht Zeiger in s
#ifndef CYPHERDJ_MUTATION_WARP_LIEST_OHNE_STIMME   // Fehlerfall: nur gefragt, ob gerade gelesen wird; eine Stimme, die ihr Audio später noch liest, zählt nicht
    for (const ArrAudio* x : s->audios) {
      if (x->ref > 1) continue;   // ein anderer Schnappschuss nennt es noch (nur der Lade-Faden ändert ref, und nur er fragt): der Cache behält es, auch wenn s geht
      for (int p = 0; p < ARR_WARP_PLAETZE; ++p)
        if (st_[p].haelt.load(std::memory_order_seq_cst) == x) return true;   // eine Stimme liest es noch oder wieder: s darf nicht der letzte sein, der es nennt
    }
#endif
    return false;
  }

  // ---------------------------------------------------------------- Betrieb
  int faeden() const noexcept override { return faeden_; }

  int prioritaet(int jack_prio) override {
    if (jack_prio <= 0) return 0;
    sched_param sp{};
    sp.sched_priority = std::max(1, jack_prio - 6);   // unter den Keylock-Fäden (JACK − 5)
    int fehl = 0;
    for (int w = 0; w < faeden_; ++w) {
      const int r = pthread_setschedparam(t_[w].native_handle(), SCHED_FIFO, &sp);
      if (r != 0) {
        ++fehl;
        std::fprintf(stderr, "Warp-Werk: Faden %d ohne SCHED_FIFO %d (JACK %d): %s; läuft mit SCHED_OTHER weiter\n", w + 1, sp.sched_priority, jack_prio, std::strerror(r));
      }
    }
    if (faeden_ > fehl) std::fprintf(stderr, "Warp-Werk: %d Fäden SCHED_FIFO %d (JACK %d)\n", faeden_ - fehl, sp.sched_priority, jack_prio);
    return fehl;
  }

  void stoppe() override {
    if (stop_.exchange(true)) return;
    for (int w = 0; w < faeden_; ++w) sem_post(&sem_[w]);
    for (int w = 0; w < faeden_; ++w)
      if (t_[w].joinable()) t_[w].join();
  }

  WarpZaehler zaehler() const noexcept override {
    WarpZaehler z;
    z.ansaetze = ansaetze_.load(std::memory_order_relaxed);
    z.bloecke = bloecke_.load(std::memory_order_relaxed);
    z.ring_voll = ring_voll_.load(std::memory_order_relaxed);
    z.verworfen = verworfen_.load(std::memory_order_relaxed);
    return z;
  }

  std::string schluss_json() const override {
    std::string o = "{\"warp\":{\"faeden\":" + std::to_string(faeden_) + ",\"plaetze\":" + std::to_string(ARR_WARP_PLAETZE);
    const WarpZaehler z = zaehler();
    char b[512];
    std::snprintf(b, sizeof b, ",\"ansaetze\":%llu,\"bloecke\":%llu,\"ring_voll\":%llu,\"verworfen\":%llu,\"faden\":[", (unsigned long long)z.ansaetze,
                  (unsigned long long)z.bloecke, (unsigned long long)z.ring_voll, (unsigned long long)z.verworfen);
    o += b;
    for (int w = 0; w < faeden_; ++w) {
      const FadenKosten& k = kosten_[static_cast<std::size_t>(w)];
      std::snprintf(b, sizeof b,
                    "%s{\"nr\":%d,\"block_n\":%llu,\"block_p50_us\":%.0f,\"block_p99_us\":%.0f,\"block_p999_us\":%.0f,\"block_max_us\":%.1f,"
                    "\"ansatz_n\":%llu,\"ansatz_p50_us\":%.0f,\"ansatz_max_us\":%.1f,\"cpu_s\":%.3f}",
                    w ? "," : "", w + 1, (unsigned long long)k.block.n, k.block.quantil_us(0.5), k.block.quantil_us(0.99), k.block.quantil_us(0.999),
                    k.block.max_ns / 1e3, (unsigned long long)k.ansatz.n, k.ansatz.quantil_us(0.5), k.ansatz.max_ns / 1e3, k.cpu_s);
      o += b;
    }
    o += "]}}";
    return o;
  }

  void test_halte(bool an) noexcept override { halte_.store(an, std::memory_order_relaxed); }
  void test_halte_block(bool an) noexcept override { halte_block_.store(an, std::memory_order_relaxed); }

 private:
  struct FadenKosten {
    DehnerKosten block, ansatz;   // nur der Faden schreibt, gelesen wird nach stoppe()
    double cpu_s = 0.0;
  };

  // Eine Stimme bedienen: Auftrag übernehmen (höchstens intake_max je Runde), danach höchstens max_bloecke Blöcke schreiben. true: es gab Arbeit.
  bool arbeite(Stimme& st, int w, int max_bloecke, int& intakes, int intake_max) noexcept {
    bool tat = false;
    const uint32_t p0 = st.posts.load(std::memory_order_seq_cst);
    if (p0 != st.gelesen.load(std::memory_order_relaxed)) {
      if (intakes >= intake_max) return true;   // später; die Arbeit bleibt liegen
      const WarpAnsatz* a = nullptr;
      const int64_t t0 = jetzt_ns();
      if (st.post.hole(a)) {
        if (a->epoche == st.soll.load(std::memory_order_seq_cst) && a->clip) {
          uebernehmen(st, *a);
          ansaetze_.fetch_add(1, std::memory_order_relaxed);
          kosten_[static_cast<std::size_t>(w)].ansatz.rein(jetzt_ns() - t0);
        } else {
          beende(st);   // gestoppt oder überholt
          if (a->clip) verworfen_.fetch_add(1, std::memory_order_relaxed);
        }
      }
      st.gelesen.store(p0, std::memory_order_seq_cst);   // erst jetzt ist die Kopie der Marker fertig und das Audio angemeldet (haelt): der Auftrag trägt keinen Zeiger mehr
#ifdef CYPHERDJ_MUTATION_WARP_HALTE_NACH_GELESEN
      if (st.aktiv) {   // Fehlerfall: das Audio wird erst nach dem Übernehmen angemeldet; dazwischen hält nichts den Schnappschuss (test_halte_block zieht das Fenster auf)
        while (halte_block_.load(std::memory_order_relaxed) && !stop_.load(std::memory_order_relaxed)) std::this_thread::yield();
        st.haelt.store(st.audio, std::memory_order_seq_cst);
      }
#endif
      ++intakes;
      tat = true;
    }
    if (!st.aktiv) return tat;
    const int64_t s_jetzt = s_jetzt_.load(std::memory_order_acquire);
    for (int n = 0; n < max_bloecke; ++n) {
      if (!st.block_da) {
        if (st.geschrieben_bis >= st.s_ende || st.position(static_cast<double>(st.geschrieben_bis)) >= static_cast<double>(st.frames) + QUELLE_NACHLAUF) {
          st.ende.store(st.geschrieben_bis, std::memory_order_relaxed);
          st.ende_ep.store(st.epoche, std::memory_order_release);
          beende(st);   // Quelle oder Clip zu Ende: nichts mehr zu rechnen, das Audio ist frei
          return true;
        }
        if (st.geschrieben_bis - s_jetzt >= ARR_WARP_VORLAUF) break;   // weit genug voraus
        if (st.soll.load(std::memory_order_seq_cst) != st.epoche) {   // der Callback hat die Stimme beendet oder abgelöst: nicht mehr rechnen
          beende(st);
          return true;
        }
        while (halte_block_.load(std::memory_order_relaxed) && !stop_.load(std::memory_order_relaxed)) std::this_thread::yield();   // nur Tests (Lebensdauer)
        const int64_t t1 = jetzt_ns();
        if (!st.angesetzt) {
          const int64_t t2 = jetzt_ns();
          st.m[st.modus == ARR_WARP_TONES ? 1 : 0]->ansetzen(st, st.s_h);
          st.angesetzt = true;
          kosten_[static_cast<std::size_t>(w)].ansatz.rein(jetzt_ns() - t2);
        }
        st.m[st.modus == ARR_WARP_TONES ? 1 : 0]->block(st, st.pl, st.pr);
        kosten_[static_cast<std::size_t>(w)].block.rein(jetzt_ns() - t1);
        st.block_da = true;
      }
      if (!st.ring->schreibe(st.epoche, st.geschrieben_bis, WARP_BLOCK, st.pl, st.pr)) {
        ring_voll_.fetch_add(1, std::memory_order_relaxed);
#ifdef CYPHERDJ_MUTATION_WARP_RING_VOLL_DREHT
        return true;   // Fehlerfall: „es gab Arbeit“, der Faden wartet nicht und dreht auf Echtzeit-Priorität, bis der Callback liest
#else
        return tat;    // der Block bleibt liegen; der Faden wartet auf den nächsten takt() (der Callback räumt den Ring beim Lesen), er dreht nicht leer
#endif
      }
      st.block_da = false;
      st.geschrieben_bis += WARP_BLOCK;
      bloecke_.fetch_add(1, std::memory_order_relaxed);
      tat = true;
    }
    return tat;
  }

  // Die Stimme ist im Faden zu Ende: er liest ihr Audio nicht mehr, der Schnappschuss darf gehen
  static void beende(Stimme& st) noexcept {
    st.aktiv = false;
    st.haelt.store(nullptr, std::memory_order_seq_cst);
  }

  // Den Auftrag in die eigene Kopie nehmen (Marker, Karte) und das Audio anmelden (haelt); die Marker liest dieser Faden danach nie mehr aus dem
  // Schnappschuss, das Audio des Caches bis zum Ende der Stimme
  void uebernehmen(Stimme& st, const WarpAnsatz& a) noexcept {
    const ArrWarp& wq = *a.clip->warp;
    st.aktiv = true;
    st.angesetzt = false;
    st.block_da = false;
    st.epoche = a.epoche;
    st.s_h = a.s_h;
    st.s_ende = a.s_ende;
    st.geschrieben_bis = a.s_h;
    st.beat_versatz = a.beat_versatz;
    st.karte = a.karte;
    st.audio = a.clip->audio;
    st.frames = a.clip->audio->frames;
    st.modus = wq.modus;
    std::memcpy(st.mb.data(), wq.beat, static_cast<std::size_t>(wq.n) * sizeof(double));
    std::memcpy(st.mf.data(), wq.frame, static_cast<std::size_t>(wq.n) * sizeof(double));
    st.w.modus = wq.modus;
    st.w.n = wq.n;
#ifndef CYPHERDJ_MUTATION_WARP_PITCH_VERGESSEN   // Fehlerfall: die Stimme übernimmt pitch nicht, jede Transposition klingt wie pitch 1
    st.w.pitch = wq.pitch;
#else
    st.w.pitch = 1.0;
#endif
    st.w.beat = st.mb.data();
    st.w.frame = st.mf.data();
#ifndef CYPHERDJ_MUTATION_WARP_HALTE_NACH_GELESEN
    st.haelt.store(a.clip->audio, std::memory_order_seq_cst);   // zuletzt und vor gelesen.store (arbeite): liest(S) sieht den Auftrag oder das Audio, nie keins von beiden
#endif
  }

  void faden(int w) {
    char nm[16];
    std::snprintf(nm, sizeof nm, "warp-werk-%d", w % 100 + 1);
    pthread_setname_np(pthread_self(), nm);
    while (!stop_.load(std::memory_order_acquire)) {
      bool tat = false;
      int intakes = 0;
      if (!halte_.load(std::memory_order_relaxed))
        for (int p = w; p < ARR_WARP_PLAETZE; p += faeden_) tat = arbeite(st_[p], w, BLOECKE_JE_BESUCH, intakes, INTAKE_JE_RUNDE) || tat;
      if (!tat) warte(&sem_[w]);
    }
    timespec c;
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &c);
    kosten_[static_cast<std::size_t>(w)].cpu_s = static_cast<double>(c.tv_sec) + static_cast<double>(c.tv_nsec) / 1e9;
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
    while (sem_trywait(s) == 0) {
    }
  }

  int faeden_;
  bool ok_ = true;
  int belegt_ = 0;
  Stimme st_[ARR_WARP_PLAETZE];
  sem_t sem_[ARR_WARP_FAEDEN_MAX];
  std::thread t_[ARR_WARP_FAEDEN_MAX];
  std::vector<FadenKosten> kosten_;
  std::atomic<bool> stop_{false}, halte_{false}, halte_block_{false};
  std::atomic<int64_t> s_jetzt_{0};
  std::atomic<uint64_t> ansaetze_{0}, bloecke_{0}, ring_voll_{0}, verworfen_{0};
};

}  // namespace

std::unique_ptr<WarpWerk> warp_werk_neu(const WarpWerkOptionen& opt) {
  if (opt.faeden < 0 || opt.faeden > ARR_WARP_FAEDEN_MAX) return nullptr;
  auto w = std::make_unique<WerkImpl>(opt.faeden);
  if (!w->ok()) return nullptr;   // ohne Bungee
  return w;
}

}  // namespace cdj
