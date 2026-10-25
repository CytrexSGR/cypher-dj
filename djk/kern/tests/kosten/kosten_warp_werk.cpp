// Messprobe Arbeitsfaden-Last (Paket 1.13 Warp, vor Slice 2). Frage: trägt ein Warp-Werk aus N Bungee-Stimmen auf W Arbeitsfäden mit tiefem Vorlauf,
// ohne dass ein Ring leerläuft, und was kostet es den Callback daneben? Das Programm baut das Werk aus Spec 1.13 5.3 und 7.2 nach, OHNE Kern:
//   - N Bungee-Stimmen (Stretcher<Basic>, Korn 512 oder fein 256, Preroll wie dehner_bungee.cpp), Stimme i gehört Faden i mod W;
//   - je Stimme ein Ring mit Vorlauf (Vorgabe 8192 Frames = 171 ms), den der Arbeitsfaden bis zum Vorlauf füllt, 256 Frames je Block;
//   - ein VIRTUELLER Verbraucher: der Callback liest alle 256 Frames (5,333 ms) einen Block aus jedem Ring. Er ist keine Zeile Code, sondern die
//     Rechnung verbraucht = floor((jetzt − Start) / 5,333 ms) · 256; ein Unterlauf ist erzeugt − verbraucht < 0 (der Ring wäre leer gewesen).
//     So konkurriert der Verbraucher nicht mit dem echten Kern um Priorität, wenn die Probe neben einem Kern läuft;
//   - Quellen: acht je 60 s lange Musik-Stellvertreter (Sinus-Gemisch mit Kick-Hüllkurve bei 130 BPM und Rauschen), Geschwindigkeit je Stimme
//     langsam zwischen 0,92 und 1,08 schwankend (ein Warp, der dem Tempo folgt), Tonhöhe 1,0.
// Gemessen: Unterläufe (Zyklen, in denen ein Ring leer gewesen wäre), kleinste Reserve in Frames (nie unter 0 = gut), Dauer je Block (p50 p99 p99,9
// max, µs), CPU je Arbeitsfaden (CLOCK_THREAD_CPUTIME_ID) und als Anteil eines Kerns, Speicher (VmRSS) vor und nach dem Bau der Stimmen und daraus je
// Stimme, und mit --sturm-s die Zeit, bis nach einem Neuansatz ALLER Stimmen jeder Ring wieder 2048 Frames (ARR_WARP_FRIST, 43 ms) enthält.
// Instrument-Check: --last K startet K Busy-Fäden mit derselben Priorität; mit taskset auf EINEN Kern MÜSSEN dann Unterläufe erscheinen (sonst ist das
// Instrument blind). Kein Test, kein Kern, keine Datei; die Zahlen gehören in den Bericht.
// Aufruf: kern_kosten_warp_werk [--stimmen 32] [--faeden 4] [--fein 0|1] [--sek 60] [--prio 0] [--vorlauf 8192] [--sturm-s 0] [--last 0] [--last-prio P] [--json]
#include <bungee/Bungee.h>
#include <pthread.h>
#include <sched.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

namespace {

using Stretcher = Bungee::Stretcher<Bungee::Basic>;
constexpr int BLOCK = 256;
constexpr int64_t TAKT_NS = 5333333;            // 256 / 48000 s
constexpr int RING = 32768;                      // Frames je Stimme (Zweierpotenz, größer als jeder Vorlauf)
constexpr int FRIST = 2048;                      // ARR_WARP_FRIST
constexpr int64_t QUELLE_FRAMES = 60LL * 48000;
constexpr int NQUELLEN = 8;

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
long tid() { return syscall(SYS_gettid); }
long vmrss_kb() {
  std::ifstream f("/proc/self/status");
  std::string z;
  while (std::getline(f, z))
    if (z.compare(0, 6, "VmRSS:") == 0) return std::atol(z.c_str() + 6);
  return -1;
}
std::atomic<int> prio_fehler{0};   // Fäden, bei denen SCHED_FIFO nicht gesetzt werden konnte (die Auswertung wertet einen Lauf mit prio_fehler > 0 nicht)
void setze_prio(int p) {
  if (p <= 0) return;
  sched_param sp{};
  sp.sched_priority = p;
  const int rc = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);   // liefert den Fehlercode, setzt errno nicht
  if (rc != 0) {
    ++prio_fehler;
    std::fprintf(stderr, "SCHED_FIFO %d nicht gesetzt: %s\n", p, std::strerror(rc));
  }
}

struct Opt {
  int stimmen = 32, faeden = 4, fein = 0, sek = 60, prio = 0, vorlauf = 8192, sturm_s = 0, last = 0, last_prio = -1;
  bool json = false;
} opt;

// Eine Quelle: Stereo, planar nicht nötig; Bungee bekommt je Korn einen Ausschnitt in zwei Kanalfeldern
std::vector<std::vector<float>> quellen;
void quellen_bauen() {
  quellen.resize(NQUELLEN);
  for (int q = 0; q < NQUELLEN; ++q) {
    std::vector<float>& d = quellen[static_cast<size_t>(q)];
    d.resize(static_cast<size_t>(QUELLE_FRAMES) * 2);
    uint32_t z = 777u + static_cast<uint32_t>(q);
    const double grund = 55.0 * (1.0 + 0.17 * q);
    for (int64_t f = 0; f < QUELLE_FRAMES; ++f) {
      const double t = static_cast<double>(f) / 48000.0;
      const double beat = std::fmod(t * 130.0 / 60.0, 1.0);
      const double kick = std::exp(-beat * 9.0) * std::sin(2.0 * M_PI * 50.0 * t * (1.0 + 2.0 * std::exp(-beat * 20.0)));
      z = z * 1664525u + 1013904223u;
      const double rausch = (static_cast<double>(z >> 8) / 8388608.0 - 1.0) * 0.05 * std::exp(-std::fmod(beat * 2.0, 1.0) * 6.0);
      const double ton = 0.15 * std::sin(2.0 * M_PI * grund * t) + 0.1 * std::sin(2.0 * M_PI * grund * 2.01 * t) + 0.07 * std::sin(2.0 * M_PI * grund * 3.5 * t);
      d[static_cast<size_t>(2 * f)] = static_cast<float>(0.5 * kick + ton + rausch);
      d[static_cast<size_t>(2 * f + 1)] = static_cast<float>(0.5 * kick + 0.9 * ton - rausch);
    }
  }
}

struct Stimme {
  explicit Stimme(int nr, bool fein_)
      : nr(nr), st(Bungee::SampleRates{48000, 48000}, 2, fein_ ? -1 : 0), hop(fein_ ? 256 : 512) {
    stride = st.maxInputFrameCount();
    in.assign(2 * static_cast<size_t>(stride), 0.0f);
    fl.assign(4096, 0.0f);
    fr.assign(4096, 0.0f);
    ring_l.assign(RING, 0.0f);
    ring_r.assign(RING, 0.0f);
    quelle = quellen[static_cast<size_t>(nr % NQUELLEN)].data();
    // Warm laufen wie dehner_bungee.cpp: Speicher berühren, Seitenfehler gehören nicht in die Messung
    ansetzen(1000.0 * (nr + 1));
    for (int k = 0; k < 8; ++k) korn();
  }
  int nr;
  Stretcher st;
  int hop, stride = 0;
  std::vector<float> in, fl, fr, ring_l, ring_r;
  const float* quelle;
  int fifo_n = 0, korn_nr = 0;
  bool erstes = true;
  double pos = 0.0, speed = 1.0;
  Bungee::Request req{};
  // Ring: erzeugt zählt alle geschriebenen Frames (nur der Arbeitsfaden schreibt); ein Neuansatz setzt es auf den Stand des virtuellen
  // Verbrauchers, der Ring ist dann leer
  std::atomic<int64_t> erzeugt{0};    // Arbeitsfaden schreibt, der Beobachter (Hauptfaden) liest
  int64_t reserve_min = INT64_MAX;   // nur der Beobachter
  uint64_t unterlauf = 0, blocks = 0;
  int64_t letzter_unterlauf_zyklus = -1;
  // Start-Sturm: der Arbeitsfaden meldet, wann der Ring nach dem Neuansatz der Epoche sturm_fertig_ep wieder FRIST Frames hielt (erst die Zeit, dann die
  // Epoche, release); der Hauptfaden zählt nur Meldungen der laufenden Epoche (eine Meldung des vorigen Sturms gilt nicht)
  std::atomic<int64_t> sturm_fertig_ns{0};
  std::atomic<uint32_t> sturm_fertig_ep{0};
  bool sturm_offen = false;          // nur der Arbeitsfaden: der Neuansatz läuft, die Frist ist noch nicht erreicht
  uint32_t epoche = 0;
  std::atomic<bool> voll{false};   // der Ring hat seit dem Ansatz den Vorlauf einmal gehalten: erst dann zählt die Reserve (sonst misst sie den Anlauf nach einem Neuansatz)

  void ansetzen(double p) {
    pos = p;
    req = Bungee::Request{};
    req.position = pos;
    req.speed = speed;
    req.pitch = 1.0;
    req.reset = true;
    req.resampleMode = resampleMode_autoOut;
    st.preroll(req);
    fifo_n = 0;
    korn_nr = 0;
    erstes = true;
  }
  void korn() {
    const Bungee::InputChunk ch = st.specifyGrain(req);
    const int len = ch.end - ch.begin;
    float* l = in.data();
    float* r = in.data() + stride;
    for (int i = 0; i < len; ++i) {
      const int64_t f = static_cast<int64_t>(ch.begin) + i;
      const bool innen = f >= 0 && f < QUELLE_FRAMES;
      l[i] = innen ? quelle[2 * f] : 0.0f;
      r[i] = innen ? quelle[2 * f + 1] : 0.0f;
    }
    st.analyseGrain(in.data(), stride, 0, 0);
    Bungee::OutputChunk oc{};
    st.synthesiseGrain(oc);
    const int skip = korn_nr < 3 ? oc.frameCount : 0;
    ++korn_nr;
    const int n = oc.frameCount - skip;
    if (n > 0 && fifo_n + n <= 4096) {
      std::memcpy(fl.data() + fifo_n, oc.data + skip, static_cast<size_t>(n) * sizeof(float));
      std::memcpy(fr.data() + fifo_n, oc.data + oc.channelStride + skip, static_cast<size_t>(n) * sizeof(float));
      fifo_n += n;
    }
    req.reset = false;
    if (erstes) erstes = false; else pos += hop * speed;
    if (pos > QUELLE_FRAMES - 60000) pos = 120000.0;   // Ende der Quelle: weiter vorn, ohne reset (ein Sprung wie in einer Schleife)
    req.position = pos;
    req.speed = speed;
  }
  // Ein Block von BLOCK Frames in den Ring; gibt die Zeit zurück, die dabei in Bungee-Körnern lag (0: der Block kam aus der Fifo, ein Korn trägt zwei)
  int64_t block() {
    int64_t korn_ns = 0;
    while (fifo_n < BLOCK) {
      const int64_t t1 = jetzt_ns();
      korn();
      korn_ns += jetzt_ns() - t1;
    }
    const int64_t e0 = erzeugt.load(std::memory_order_relaxed);
    for (int i = 0; i < BLOCK; ++i) {
      ring_l[static_cast<size_t>((e0 + i) & (RING - 1))] = fl[static_cast<size_t>(i)];
      ring_r[static_cast<size_t>((e0 + i) & (RING - 1))] = fr[static_cast<size_t>(i)];
    }
    fifo_n -= BLOCK;
    std::memmove(fl.data(), fl.data() + BLOCK, static_cast<size_t>(fifo_n) * sizeof(float));
    std::memmove(fr.data(), fr.data() + BLOCK, static_cast<size_t>(fifo_n) * sizeof(float));
    erzeugt.store(e0 + BLOCK, std::memory_order_release);
    ++blocks;
    return korn_ns;
  }
};

struct Faden {
  pthread_t t{};
  std::atomic<long> tid{0};
  std::vector<uint32_t> hist = std::vector<uint32_t>(20001, 0);   // Dauer der Korn-Rechnung eines Blocks in µs (nur Blöcke mit Korn)
  uint64_t bloecke = 0;
  int64_t max_ns = 0;
  double cpu_s = 0.0;
  int nr = 0;
};

std::vector<std::unique_ptr<Stimme>> stimmen;
std::vector<Faden> faeden;
std::atomic<bool> stop{false};
std::atomic<uint32_t> sturm_epoche{0};
std::atomic<int64_t> sturm_anhebung_ns{0};   // der Hauptfaden schreibt die Zeit, dann hebt er die Epoche an (release); sie ist der Start jedes Sturms
int64_t t0_ns = 0;

int64_t verbraucht(int64_t jetzt) { return ((jetzt - t0_ns) / TAKT_NS) * BLOCK; }

// Hat der Ring nach einem Neuansatz die Frist erreicht? Dann die Zeit melden, danach die Epoche (Reihenfolge: der Leser prüft erst die Epoche)
void sturm_pruefen(Stimme& s, int64_t fill) {
  if (!s.sturm_offen || fill < FRIST) return;
  s.sturm_fertig_ns.store(jetzt_ns(), std::memory_order_relaxed);
  s.sturm_fertig_ep.store(s.epoche, std::memory_order_release);
  s.sturm_offen = false;
}

void* arbeiter(void* p) {
  Faden& me = *static_cast<Faden*>(p);
  me.tid = tid();
  char nm[16];
  std::snprintf(nm, sizeof nm, "warp-werk-%d", me.nr % 100 + 1);
  pthread_setname_np(pthread_self(), nm);
  setze_prio(opt.prio);
  while (!stop.load(std::memory_order_acquire)) {
    const int64_t jetzt = jetzt_ns();
    int64_t v = verbraucht(jetzt);
    const uint32_t ep = sturm_epoche.load(std::memory_order_acquire);
    bool gearbeitet = false;
    for (size_t i = static_cast<size_t>(me.nr); i < stimmen.size(); i += static_cast<size_t>(opt.faeden)) {
      Stimme& s = *stimmen[i];
      if (s.epoche != ep) {   // Neuansatz aller Stimmen (Start-Sturm): leerer Ring ab jetzt, Zeit bis FRIST Frames wieder da sind
        s.epoche = ep;
        s.ansetzen(100000.0 + 31000.0 * static_cast<double>((i * 7 + ep) % 40));
        s.voll.store(false, std::memory_order_release);
        s.erzeugt.store(v, std::memory_order_release);
        s.sturm_offen = true;
      }
      int64_t fill = s.erzeugt.load(std::memory_order_relaxed) - v;
      while (fill < opt.vorlauf && !stop.load(std::memory_order_relaxed)) {
        s.speed = 1.0 + 0.08 * std::sin(0.31 * static_cast<double>(s.blocks) * BLOCK / 48000.0 + static_cast<double>(i));
        const int64_t dt = s.block();
        ++me.bloecke;
        if (dt > 0) {
          ++me.hist[static_cast<size_t>(std::min<int64_t>(dt / 1000, 20000))];
          me.max_ns = std::max(me.max_ns, dt);
        }
        v = verbraucht(jetzt_ns());
        fill = s.erzeugt.load(std::memory_order_relaxed) - v;
        gearbeitet = true;
        sturm_pruefen(s, fill);
      }
      sturm_pruefen(s, fill);
      if (fill >= opt.vorlauf) s.voll.store(true, std::memory_order_release);
    }
    if (!gearbeitet) {
      timespec ts{0, 500000};   // 0,5 ms
      nanosleep(&ts, nullptr);
    }
  }
  timespec c;
  clock_gettime(CLOCK_THREAD_CPUTIME_ID, &c);
  me.cpu_s = static_cast<double>(c.tv_sec) + static_cast<double>(c.tv_nsec) / 1e9;
  return nullptr;
}

void* belaste(void*) {
  setze_prio(opt.last_prio > 0 ? opt.last_prio : opt.prio + 1);   // einen Schritt über den Arbeitsfäden: sie verhungern, wenn beide auf einem Kern liegen
  volatile uint64_t x = 0;
  while (!stop.load(std::memory_order_relaxed)) x = x + 1;
  return nullptr;
}

// Der Beobachter (Hauptfaden, ein Schritt über den Arbeitsfäden) ist der virtuelle Callback: er liest alle Ringe unabhängig von den Arbeitsfäden. Ein
// Arbeitsfaden, der verhungert, kann seinen eigenen Unterlauf nicht melden; darum zählt nicht er, sondern der Beobachter. Nach einem Neuansatz (voll
// falsch) zählt der Ring nicht, das misst der Sturm.
void beobachte() {
  const int64_t v = verbraucht(jetzt_ns());
  for (auto& sp : stimmen) {
    Stimme& s = *sp;
    if (!s.voll.load(std::memory_order_acquire)) continue;
    const int64_t fill = s.erzeugt.load(std::memory_order_acquire) - v;
    s.reserve_min = std::min(s.reserve_min, fill);
    if (fill < 0 && s.letzter_unterlauf_zyklus != v) {
      ++s.unterlauf;
      s.letzter_unterlauf_zyklus = v;
    }
  }
}

double quantil(const std::vector<uint64_t>& h, double p) {
  uint64_t n = 0;
  for (uint64_t c : h) n += c;
  if (n == 0) return 0.0;
  const uint64_t ziel = static_cast<uint64_t>(std::ceil(p * static_cast<double>(n)));
  uint64_t a = 0;
  for (size_t i = 0; i < h.size(); ++i) {
    a += h[i];
    if (a >= ziel) return static_cast<double>(i);
  }
  return static_cast<double>(h.size() - 1);
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    const auto zahl = [&](int& ziel) { if (i + 1 < argc) ziel = std::atoi(argv[++i]); };
    if (a == "--stimmen") zahl(opt.stimmen);
    else if (a == "--faeden") zahl(opt.faeden);
    else if (a == "--fein") zahl(opt.fein);
    else if (a == "--sek") zahl(opt.sek);
    else if (a == "--prio") zahl(opt.prio);
    else if (a == "--vorlauf") zahl(opt.vorlauf);
    else if (a == "--sturm-s") zahl(opt.sturm_s);
    else if (a == "--last") zahl(opt.last);
    else if (a == "--last-prio") zahl(opt.last_prio);
    else if (a == "--json") opt.json = true;
    else { std::fprintf(stderr, "unbekannt: %s\n", a.c_str()); return 3; }
  }
  if (opt.stimmen < 1 || opt.stimmen > 128 || opt.faeden < 1 || opt.faeden > 16 || opt.vorlauf < 1024 || opt.vorlauf > RING - 4096) {
    std::fprintf(stderr, "Aufruf: --stimmen 1..128 --faeden 1..16 --vorlauf 1024..%d\n", RING - 4096);
    return 3;
  }
  quellen_bauen();
  const long rss0 = vmrss_kb();
  for (int i = 0; i < opt.stimmen; ++i) stimmen.push_back(std::make_unique<Stimme>(i, opt.fein != 0));
  const long rss1 = vmrss_kb();
  faeden = std::vector<Faden>(static_cast<size_t>(opt.faeden));
  for (int i = 0; i < opt.faeden; ++i) faeden[static_cast<size_t>(i)].nr = i;
  // Eingeschwungener Zustand wie im Betrieb: jeder Ring hält den Vorlauf, bevor der virtuelle Verbraucher zu zählen beginnt
  for (auto& s : stimmen) {
    s->erzeugt.store(0);
    while (s->erzeugt.load() < opt.vorlauf) s->block();
    s->reserve_min = INT64_MAX;
    s->voll.store(true);
  }
  t0_ns = jetzt_ns();
  setze_prio(opt.prio > 0 ? opt.prio + 2 : 0);   // der Beobachter läuft über den Arbeitsfäden (und über den Last-Fäden der Instrument-Probe)
  std::vector<pthread_t> last;
  for (int i = 0; i < opt.faeden; ++i) pthread_create(&faeden[static_cast<size_t>(i)].t, nullptr, arbeiter, &faeden[static_cast<size_t>(i)]);
  for (int i = 0; i < opt.last; ++i) { pthread_t t; pthread_create(&t, nullptr, belaste, nullptr); last.push_back(t); }
  std::vector<double> sturm_ms;
  const int64_t ende = t0_ns + static_cast<int64_t>(opt.sek) * 1000000000LL;
  int64_t naechster_sturm = opt.sturm_s > 0 ? t0_ns + static_cast<int64_t>(opt.sturm_s) * 1000000000LL : INT64_MAX;
  while (jetzt_ns() < ende) {
    timespec ts{0, 1000000};   // 1 ms: feiner als der Takt des Verbrauchers (5,33 ms)
    nanosleep(&ts, nullptr);
    beobachte();
    if (jetzt_ns() >= naechster_sturm) {
      sturm_anhebung_ns.store(jetzt_ns(), std::memory_order_relaxed);
      const uint32_t ep = sturm_epoche.fetch_add(1, std::memory_order_release) + 1;
      naechster_sturm += static_cast<int64_t>(opt.sturm_s) * 1000000000LL;
      for (int k = 0; k < 1000; ++k) {   // eine Sekunde einsammeln, dabei weiter beobachten
        ts = {0, 1000000};
        nanosleep(&ts, nullptr);
        beobachte();
      }
      int64_t spaetest = 0;
      bool alle = true;
      const int64_t start = sturm_anhebung_ns.load(std::memory_order_relaxed);   // das Anheben der Epoche, nicht der Moment, in dem der Faden sie bemerkt
      for (auto& s : stimmen) {
        if (s->sturm_fertig_ep.load(std::memory_order_acquire) != ep) alle = false;
        else spaetest = std::max(spaetest, s->sturm_fertig_ns.load(std::memory_order_relaxed) - start);
      }
      sturm_ms.push_back(alle ? static_cast<double>(spaetest) / 1e6 : -1.0);   // −1: nach 1 s noch nicht alle bereit
    }
  }
  stop = true;
  for (auto& f : faeden) pthread_join(f.t, nullptr);
  for (pthread_t t : last) pthread_join(t, nullptr);
  const double wand = static_cast<double>(jetzt_ns() - t0_ns) / 1e9;
  std::vector<uint64_t> h(20001, 0);
  uint64_t bloecke = 0;
  int64_t max_ns = 0;
  double cpu = 0.0;
  for (auto& f : faeden) {
    for (size_t i = 0; i < h.size(); ++i) h[i] += f.hist[i];
    bloecke += f.bloecke;
    max_ns = std::max(max_ns, f.max_ns);
    cpu += f.cpu_s;
  }
  uint64_t unterlauf = 0;
  int64_t reserve = INT64_MAX;
  for (auto& s : stimmen) { unterlauf += s->unterlauf; reserve = std::min(reserve, s->reserve_min); }
  std::printf("Werk: %d Stimmen, %d Fäden, %s, Vorlauf %d Frames, Priorität %d (nicht gesetzt bei %d Fäden), %.1f s, Last-Fäden %d\n", opt.stimmen, opt.faeden,
              opt.fein ? "fein (Korn 256)" : "Standard (Korn 512)", opt.vorlauf, opt.prio, prio_fehler.load(), wand, opt.last);
  std::printf("Unterläufe %llu, kleinste Reserve %lld Frames (%.1f ms), Blöcke %llu\n", static_cast<unsigned long long>(unterlauf), static_cast<long long>(reserve),
              static_cast<double>(reserve) / 48.0, static_cast<unsigned long long>(bloecke));
  std::printf("Korn-Rechnung je Block (nur Blöcke, in denen ein Korn lief; ein Korn trägt zwei Blöcke): p50 %.0f µs, p99 %.0f µs, p99,9 %.0f µs, max %.0f µs\n", quantil(h, 0.5), quantil(h, 0.99), quantil(h, 0.999),
              static_cast<double>(max_ns) / 1000.0);
  std::printf("CPU der Arbeitsfäden %.2f s in %.1f s = %.3f Kerne (%.1f %% je Faden im Mittel); Speicher %.1f MiB für %d Stimmen = %.2f MiB je Stimme\n", cpu, wand,
              cpu / wand, 100.0 * cpu / wand / opt.faeden, static_cast<double>(rss1 - rss0) / 1024.0, opt.stimmen,
              static_cast<double>(rss1 - rss0) / 1024.0 / opt.stimmen);
  for (size_t i = 0; i < sturm_ms.size(); ++i) std::printf("Sturm %zu: %s\n", i + 1, sturm_ms[i] < 0 ? "nicht fertig nach 1 s" : (std::to_string(sturm_ms[i]) + " ms bis alle Ringe 2048 Frames halten").c_str());
  if (opt.json) {
    std::printf("{\"stimmen\":%d,\"faeden\":%d,\"fein\":%d,\"vorlauf\":%d,\"prio\":%d,\"prio_fehler\":%d,\"last\":%d,\"sek\":%.1f,\"unterlauf\":%llu,\"reserve_min_frames\":%lld,"
                "\"bloecke\":%llu,\"korn_p50_us\":%.0f,\"korn_p99_us\":%.0f,\"korn_p999_us\":%.0f,\"korn_max_us\":%.0f,\"cpu_kerne\":%.3f,\"mib_je_stimme\":%.2f,"
                "\"sturm_ms\":[",
                opt.stimmen, opt.faeden, opt.fein, opt.vorlauf, opt.prio, prio_fehler.load(), opt.last, wand, static_cast<unsigned long long>(unterlauf), static_cast<long long>(reserve),
                static_cast<unsigned long long>(bloecke), quantil(h, 0.5), quantil(h, 0.99), quantil(h, 0.999), static_cast<double>(max_ns) / 1000.0, cpu / wand,
                static_cast<double>(rss1 - rss0) / 1024.0 / opt.stimmen);
    for (size_t i = 0; i < sturm_ms.size(); ++i) std::printf("%s%.2f", i ? "," : "", sturm_ms[i]);
    std::printf("]}\n");
  }
  return unterlauf == 0 ? 0 : 1;
}
