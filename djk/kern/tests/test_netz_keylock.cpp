// Keylock Slice 3 (Plan 2026-09-30, Slice-Tabelle Zeile 3): Render-Faden des Netzes. Das Netz wird wie in test_netz_loop gegen
// die Ringe getrieben (kein Kern): /uhr-Ereignisse setzen das Tempo, /k/loop/laden legt die Originale ab, der Render läuft
// im Faden des Netzes (Haken statt R3 für die zeitkritischen Fälle, die echte R3 in (a) und (g)), und was der Faden baut,
// erscheint als Befehl::LOOP_VARIANTE im Befehlsring. Geprüft wird: (a) Variante bei festem Tempo ≠ 128, vom echten
// LoopBoxen angenommen, (b) zwei Tempowechsel während des Renders: nur der neueste zählt, (c) Tempo 128: kein Render,
// (d) Rampe: kein Auftrag, (e) Loop-Tausch während des Renders, (f) Stopp des Netzes mit laufendem Render, (g) Renderfehler,
// (h) Priorität des Fadens.
// Slice 3b (Befunde der Prüfung von Slice 3): (i) F3 Tempofolge mit Fehler des überholten Renders: kein doppelter Render,
// (j) F4 Befehlsring voll: ein Versuch, keine /q-Flut, (k) F5 Ausnahme beim Bau der Loop und beim Fadenstart, (l) F6 Stopp mit
// laufendem 32-Beat-Render und kein Render nach dem Shutdown, (n) F2 abgewiesenes Laden nimmt die Kopie zurück.
#include <fcntl.h>
#include <sched.h>
#include <sys/resource.h>
#include <sys/syscall.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

#include "cypherdj/loop.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/loop_stretch.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;
using Uhr = std::chrono::steady_clock;

static fs::path g_dir;

static void loop_anlegen(const char* name, int beats, float wert, bool ton = false) {
  fs::create_directories(g_dir / name);
  const int64_t frames = (int64_t)beats * cdj::LOOP_SPB;
  std::vector<float> x((size_t)frames * 2, wert);
  if (ton)  // Slice 3b: ein echtes Signal für die echte R3 (ein Gleichwert ist für sie ein Sonderfall)
    for (int64_t i = 0; i < frames; ++i) {
      const float s = 0.2f * (float)std::sin(2 * 3.14159265358979 * 416.0 * (double)i / 48000.0);
      x[(size_t)(2 * i)] = s;
      x[(size_t)(2 * i + 1)] = s;
    }
  std::ofstream(g_dir / name / "loop.f32", std::ios::binary).write(reinterpret_cast<const char*>(x.data()), (std::streamsize)(x.size() * 4));
  std::ofstream(g_dir / name / "loop.json")
      << R"({"schema":1,"name":")" << name << R"(","beats":)" << beats << R"(,"bpm":128,"frames":)" << frames << R"(,"datei":"loop.f32"})";
}

// stderr in eine Datei umleiten (Zeilen des Render-Fadens zählen); vor jedem PRUEF wieder beenden
struct Fang {
  int alt = -1;
  std::string pfad;
  void an() {
    pfad = (g_dir / "stderr.txt").string();
    std::fflush(stderr);
    alt = dup(2);
    const int fd = open(pfad.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    dup2(fd, 2);
    close(fd);
  }
  std::vector<std::string> ende() {
    std::fflush(stderr);
    dup2(alt, 2);
    close(alt);
    std::vector<std::string> z;
    std::ifstream f(pfad);
    for (std::string l; std::getline(f, l);)
      if (l.rfind("keylock:", 0) == 0) z.push_back(l);
    return z;
  }
};

struct Haken {  // Render-Funktion des Tests: zeichnet Aufrufe auf, kann warten, schlafen, werfen
  std::mutex m;
  std::condition_variable cv;
  int erlaubt = 1000000000;  // so viele Aufrufe dürfen noch durch; 0: der nächste wartet
  std::vector<double> bpms;
  std::atomic<int> drin{0};
  int schlaf_ms = 0;
  bool wirf = false;
  cdj::KeylockRenderFn fn() {
    return [this](const std::vector<float>& d, double bpm) {
      {
        std::unique_lock<std::mutex> lk(m);
        bpms.push_back(bpm);
        ++drin;
        cv.wait(lk, [&] { return erlaubt > 0; });
        --erlaubt;
      }
      if (schlaf_ms) std::this_thread::sleep_for(std::chrono::milliseconds(schlaf_ms));
      if (wirf) throw std::runtime_error("kaputt");
      const size_t F = d.size() / 2;
      const size_t n = (size_t)std::llround((double)F * 128.0 / bpm);
      return std::vector<float>(2 * n, 0.125f);
    };
  }
  void zu() { std::lock_guard<std::mutex> lk(m); erlaubt = 0; }
  void lass(int n) { { std::lock_guard<std::mutex> lk(m); erlaubt += n; } cv.notify_all(); }  // n Aufrufe durchlassen
  void auf() { lass(1000000); }
  size_t aufrufe() { std::lock_guard<std::mutex> lk(m); return bpms.size(); }
  std::vector<double> liste() { std::lock_guard<std::mutex> lk(m); return bpms; }
};

struct Stand {  // ein Netz mit eigenen Ringen
  cdj::Befehlsring* bef = new cdj::Befehlsring();
  cdj::Ereignisring* ere = new cdj::Ereignisring();
  std::unique_ptr<cdj::Netz> netz;
  int64_t s = 0;
  explicit Stand(const cdj::KeylockOpt& opt) {
    netz = std::make_unique<cdj::Netz>(0, false, bef, ere);
    netz->setze_loop_ordner(g_dir.string());
    netz->setze_keylock(opt);
  }
  ~Stand() {
    netz.reset();
    delete bef;
    delete ere;
  }
  void uhr(double bpm) {
    cdj::Ereignis e{};
    e.art = cdj::Ereignis::UHR;
    e.sample = s += 256;
    e.bpm = bpm;
    ere->schiebe(e);
  }
  // Der Kern schickt je Zyklus eine /uhr: ms lang je 2 ms eine, dazu das Netz laufen lassen
  void takte(double bpm, int ms) {
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(ms)) {
      uhr(bpm);
      netz->ereignisse_senden();
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
  }
  void laden(int box, const char* name, const char* quelle = "andreas") {
    cdj::osc::Schreiber sc(v::k_loop_laden);
    sc.h(1000 + box).s(quelle).i(box).s(name);
    netz->paket(sc.daten(), sc.groesse());
  }
  // Alle Befehle aus dem Ring. LOOP_LADEN: Kopie des Loops für den Test merken, Zeiger wie der Kern über LOOP_ALT zurück
  // (das Netz gibt frei). LOOP_VARIANTE: Zeiger bleibt in var, der Test gibt ihn später über LOOP_ALT zurück.
  std::vector<cdj::Befehl> alle() {
    std::vector<cdj::Befehl> v;
    cdj::Befehl b;
    while (bef->hole(b)) v.push_back(b);
    return v;
  }
  void zurueck(const void* p) {
    cdj::Ereignis a{};
    a.art = cdj::Ereignis::LOOP_ALT;
    a.zeiger = p;
    ere->schiebe(a);
  }
};

// Bis eine Variante im Ring erscheint (oder Zeitgrenze); sammelt alle Befehle
static std::vector<cdj::Befehl> warte_variante(Stand& st, double bpm, int ms, size_t anzahl = 1) {
  std::vector<cdj::Befehl> alle;
  const auto t0 = Uhr::now();
  size_t n = 0;
  while (Uhr::now() - t0 < std::chrono::milliseconds(ms) && n < anzahl) {
    st.takte(bpm, 4);
    for (const auto& b : st.alle()) {
      alle.push_back(b);
      if (b.art == cdj::Befehl::LOOP_VARIANTE) ++n;
    }
  }
  return alle;
}
static std::vector<const cdj::Loop*> varianten(const std::vector<cdj::Befehl>& v) {
  std::vector<const cdj::Loop*> r;
  for (const auto& b : v)
    if (b.art == cdj::Befehl::LOOP_VARIANTE) r.push_back(static_cast<const cdj::Loop*>(b.zeiger));
  return r;
}
static const cdj::Loop* lade_zeiger(const std::vector<cdj::Befehl>& v, int box) {
  for (const auto& b : v)
    if (b.art == cdj::Befehl::LOOP_LADEN && b.deck == box) return static_cast<const cdj::Loop*>(b.zeiger);
  return nullptr;
}
static int64_t frames_fuer(int beats, double bpm) { return std::llround((double)beats * cdj::LOOP_SPB * 128.0 / bpm); }

int main() {
  g_dir = fs::path("/dev/shm") / ("test_netz_keylock_" + std::to_string(getpid()));
  fs::create_directories(g_dir);
  loop_anlegen("eins", 1, 0.25f);
  loop_anlegen("zwei", 1, 0.5f);
  loop_anlegen("vier", 4, 0.25f);
  loop_anlegen("zweiunddreissig", 32, 0.0f, true);  // Slice 3b: 32 Beats, echte R3 rechnet rund zwei Sekunden daran

  {  // (a) Tempo fest auf 130, Loop auf der Box: nach dem Render kommt eine Variante (echte R3), vom echten LoopBoxen angenommen
    Fang fang;
    fang.an();
    cdj::KeylockOpt opt;
    opt.niedrige_prio = false;  // auf einem ausgelasteten Rechner darf der Test nicht am SCHED_IDLE hungern (siehe (h))
    Stand st(opt);
    st.laden(1, "eins");
    auto befehle = st.alle();
    const cdj::Loop* orig = lade_zeiger(befehle, 1);
    st.takte(130.0, 150);  // noch nicht 250 ms fest: keine Variante
    const auto fruh = st.alle();
    auto spaet = warte_variante(st, 130.0, 6000);
    const auto zeilen = fang.ende();
    const auto vs = varianten(spaet);
    PRUEF(orig != nullptr);
    PRUEF(varianten(fruh).empty());
    PRUEF(vs.size() == 1);
    if (vs.size() == 1 && orig) {
      const cdj::Loop* v1 = vs[0];
      PRUEF(v1->name == "eins" && v1->beats == 1 && v1->bpm == 130.0 && v1->frames == frames_fuer(1, 130.0));
      PRUEF(v1->daten.size() == (size_t)v1->frames * 2);
      for (const auto& b : spaet)
        if (b.art == cdj::Befehl::LOOP_VARIANTE) PRUEF(b.deck == 1 && std::strcmp(b.quelle, "cypher") != 0);
      // Kern-Vertrag (Slice 2b): die echte Box nimmt genau diese Variante an. Negativ-Kontrolle: anderer name wird abgelehnt.
      cdj::LoopBoxen lb;
      lb.laden(1, orig);
      PRUEF(lb.variante_setzen(1, v1) == nullptr);
      PRUEF(lb.variante(1) == v1 && lb.abgelehnt() == 0);
      cdj::Loop falsch = *v1;
      falsch.name = "anders";
      PRUEF(lb.variante_setzen(1, &falsch) == &falsch && lb.abgelehnt() == 1);
      lb.variante_setzen(1, nullptr);  // v1 zurück in den Ring der Box, dem Test gehört sie wieder
      while (lb.abholen()) {}
      st.zurueck(v1);
    }
    st.zurueck(orig);
    st.netz->ereignisse_senden();
    std::printf("(a) stderr: %zu Zeile(n)", zeilen.size());
    for (const auto& z : zeilen) std::printf(" [%s]", z.c_str());
    std::printf("\n");
    PRUEF(zeilen.size() == 1 && zeilen[0].rfind("keylock: Box 1 130.00 BPM fertig ", 0) == 0 &&
          zeilen[0].size() > 3 && zeilen[0].compare(zeilen[0].size() - 3, 3, " ms") == 0);
    // kein zweiter Render bei unverändertem Tempo
    st.takte(130.0, 500);
    PRUEF(st.alle().empty());
  }

  {  // (b) zwei Tempowechsel in kurzer Folge, während der erste Render läuft: nur der neueste Auftrag liefert eine Variante
    Haken h;
    h.zu();
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    Stand st(opt);
    st.laden(1, "eins");
    auto befehle = st.alle();
    const cdj::Loop* orig = lade_zeiger(befehle, 1);
    st.takte(130.0, 350);  // Auftrag A (130) startet und hängt im Haken
    for (int i = 0; i < 500 && h.drin.load() < 1; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    PRUEF(h.drin.load() == 1);
    st.takte(132.0, 350);  // Auftrag B (132) wartet hinter A
    st.takte(134.0, 350);  // Auftrag C (134) ersetzt B, bevor der gestartet ist
    h.lass(1);  // nur A fertig werden lassen: das Netz holt es ab und muss es verwerfen (Tempo 130 ≠ 134), bevor C rechnet
    st.takte(134.0, 300);
    PRUEF(varianten(st.alle()).empty());
    h.auf();
    auto spaet = warte_variante(st, 134.0, 5000);
    st.takte(134.0, 400);  // nichts Weiteres
    for (const auto& b : st.alle()) spaet.push_back(b);
    const auto vs = varianten(spaet);
    const auto liste = h.liste();
    std::printf("(b) Render-Aufrufe:");
    for (double x : liste) std::printf(" %.0f", x);
    std::printf(", Varianten im Ring: %zu\n", vs.size());
    PRUEF(liste.size() == 2 && liste[0] == 130.0 && liste[1] == 134.0);  // 132 wurde nie gerechnet
    PRUEF(vs.size() == 1);
    if (vs.size() == 1) {
      PRUEF(vs[0]->bpm == 134.0 && vs[0]->name == "eins" && vs[0]->frames == frames_fuer(1, 134.0));  // Tempo = das neue
      st.zurueck(vs[0]);
    }
    st.zurueck(orig);
    st.netz->ereignisse_senden();
  }

  {  // (c) Tempo 128: kein Render; Laden bei 128 unverändert (Negativ-Kontrolle)
    Haken h;
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    Stand st(opt);
    st.laden(1, "eins");
    st.takte(128.0, 600);
    st.takte(128.0000005, 400);  // |Δ| <= 1e-6: dasselbe Tempo
    const auto b = st.alle();
    PRUEF(h.aufrufe() == 0);
    PRUEF(b.size() == 1 && b[0].art == cdj::Befehl::LOOP_LADEN && b[0].deck == 1 && !std::strcmp(b[0].pfad, "eins"));
    PRUEF(varianten(b).empty());
    // Gegenprobe im selben Aufbau: Tempo 130 löst aus (der Haken wird gerufen), sonst wäre der Negativbefund blind. Der Loop geht
    // erst danach über LOOP_ALT zurück (Slice 3b: der Kern gibt einen Loop nur zurück, wenn er abgelöst oder abgewiesen wurde;
    // das Netz nimmt dann seine Kopie zurück, F2)
    st.takte(130.0, 700);
    PRUEF(h.aufrufe() == 1);
    for (const auto& x : st.alle()) st.zurueck(x.zeiger);
    st.zurueck(lade_zeiger(b, 1));
    st.netz->ereignisse_senden();
  }

  {  // (d) Rampe: das Tempo ändert sich in jedem Zyklus, kein Auftrag; nach der Rampe (fest) genau einer
    Haken h;
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    Stand st(opt);
    st.laden(1, "eins");
    auto b0 = st.alle();
    const cdj::Loop* orig = lade_zeiger(b0, 1);
    const auto t0 = Uhr::now();
    double bpm = 128.0;
    while (Uhr::now() - t0 < std::chrono::milliseconds(900)) {  // 900 ms Rampe, 2 ms je Zyklus: +0,02 BPM je Zyklus
      bpm += 0.02;
      st.uhr(bpm);
      st.netz->ereignisse_senden();
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    const size_t in_rampe = h.aufrufe();
    const auto im_ring = st.alle();
    PRUEF(in_rampe == 0);
    PRUEF(varianten(im_ring).empty());
    auto spaet = warte_variante(st, bpm, 5000);
    const auto vs = varianten(spaet);
    std::printf("(d) Aufrufe in der Rampe %zu (Soll 0), danach Varianten %zu bei %.2f\n", in_rampe, vs.size(), bpm);
    PRUEF(vs.size() == 1 && h.aufrufe() == 1);
    if (vs.size() == 1) {
      PRUEF(std::fabs(vs[0]->bpm - bpm) < 1e-9);
      st.zurueck(vs[0]);
    }
    st.zurueck(orig);
    st.netz->ereignisse_senden();
  }

  {  // (e) Loop-Tausch während des Renders: das Ergebnis des alten Loops wird verworfen, die Variante gehört dem neuen
    Haken h;
    h.zu();
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    Stand st(opt);
    st.laden(1, "eins");
    auto b0 = st.alle();
    const cdj::Loop* o1 = lade_zeiger(b0, 1);
    st.takte(130.0, 350);
    for (int i = 0; i < 500 && h.drin.load() < 1; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    PRUEF(h.drin.load() == 1);
    st.laden(1, "zwei");  // Tempo ist fest: Auftrag für den neuen Loop, der alte rechnet noch
    auto b1 = st.alle();
    const cdj::Loop* o2 = lade_zeiger(b1, 1);
    st.takte(130.0, 100);
    h.lass(1);  // nur der alte Render darf fertig werden: sein Ergebnis wird abgeholt und verworfen, bevor B rechnet
    st.takte(130.0, 300);
    PRUEF(varianten(st.alle()).empty());
    h.auf();
    auto spaet = warte_variante(st, 130.0, 5000);
    st.takte(130.0, 400);
    for (const auto& b : st.alle()) spaet.push_back(b);
    const auto vs = varianten(spaet);
    std::printf("(e) Varianten im Ring: %zu (Soll 1, name zwei), Render-Aufrufe %zu\n", vs.size(), h.aufrufe());
    PRUEF(vs.size() == 1 && h.aufrufe() == 2);
    if (vs.size() == 1) {
      PRUEF(vs[0]->name == "zwei");
      st.zurueck(vs[0]);
    }
    st.zurueck(o1);
    st.zurueck(o2);
    st.netz->ereignisse_senden();  // LSAN/ASAN: alles freigegeben, nichts doppelt
  }

  {  // (f) Stopp des Netzes mit laufendem Render: der Destruktor wartet diesen einen ab, startet keinen weiteren, hängt nicht
    Haken h;
    h.schlaf_ms = 400;
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    auto st = std::make_unique<Stand>(opt);
    st->laden(1, "eins");
    st->laden(2, "zwei");
    st->takte(130.0, 350);  // beide Aufträge gehen raus: Box 1 rechnet (400 ms), Box 2 wartet
    for (int i = 0; i < 500 && h.drin.load() < 1; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    PRUEF(h.drin.load() == 1);
    const auto t0 = Uhr::now();
    const auto bl = st->alle();  // die Originale gehören dem Kern-Ersatz hier: zurückgeben, bevor das Netz geht
    for (const auto& x : bl) st->zurueck(x.zeiger);
    st->netz->ereignisse_senden();
    st->netz.reset();  // Stopp
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(Uhr::now() - t0).count();
    std::printf("(f) Netz-Stopp mit laufendem Render: %lld ms (Render 400 ms), Render-Aufrufe %zu (Soll 1)\n", (long long)ms,
                h.aufrufe());
    PRUEF(ms < 1500);
    PRUEF(h.aufrufe() == 1);  // der wartende Auftrag der Box 2 startete nicht mehr
    // Negativ-Kontrolle: ohne laufenden Render ist der Stopp sofort
    auto st2 = std::make_unique<Stand>(opt);
    const auto t1 = Uhr::now();
    st2->netz.reset();
    PRUEF(std::chrono::duration_cast<std::chrono::milliseconds>(Uhr::now() - t1).count() < 100);
  }

  {  // (g) Renderfehler: Ausnahme, und leeres Ergebnis der echten Funktion bei bpm außerhalb [60, 200]: Box bleibt Varispeed,
     // genau eine stderr-Zeile, kein Dauerlauf
    {
      Fang fang;
      fang.an();
      Haken h;
      h.wirf = true;
      cdj::KeylockOpt opt;
      opt.fn = h.fn();
      opt.niedrige_prio = false;
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      st.takte(130.0, 1000);
      const auto b = st.alle();
      const auto zeilen = fang.ende();
      std::printf("(g) Ausnahme: Zeilen %zu, Render-Aufrufe %zu\n", zeilen.size(), h.aufrufe());
      PRUEF(zeilen.size() == 1 && zeilen[0].find("Render fehlgeschlagen") != std::string::npos);
      PRUEF(h.aufrufe() == 1 && varianten(b).empty());
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
    {
      Fang fang;
      fang.an();
      cdj::KeylockOpt opt;  // echte rendere_keylock: 30 BPM liegt außerhalb [60, 200], leer
      opt.niedrige_prio = false;
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      st.takte(30.0, 1000);
      const auto b = st.alle();
      const auto zeilen = fang.ende();
      std::printf("(g) bpm 30: Zeilen %zu\n", zeilen.size());
      PRUEF(zeilen.size() == 1 && zeilen[0].find("Render lieferte nichts") != std::string::npos);
      PRUEF(varianten(b).empty());
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
    {  // Negativ-Kontrolle: bei einem gültigen Tempo gibt es keine Fehlerzeile
      Fang fang;
      fang.an();
      Haken h;
      cdj::KeylockOpt opt;
      opt.fn = h.fn();
      opt.niedrige_prio = false;
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      auto b = warte_variante(st, 130.0, 5000);
      const auto zeilen = fang.ende();
      PRUEF(zeilen.size() == 1 && zeilen[0].find("fertig") != std::string::npos);
      for (const auto* x : varianten(b)) st.zurueck(x);
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
  }

  {  // (h) Priorität des Render-Fadens: SCHED_IDLE und nice 19; ohne niedrige_prio bleibt die Policy SCHED_OTHER
    for (int niedrig = 1; niedrig >= 0; --niedrig) {
      std::atomic<int> policy{-1}, nice{-99};
      cdj::KeylockOpt opt;
      opt.niedrige_prio = niedrig != 0;
      opt.fn = [&](const std::vector<float>& d, double bpm) {
        policy = sched_getscheduler(0);
        nice = getpriority(PRIO_PROCESS, (id_t)syscall(SYS_gettid));
        return std::vector<float>((size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm) * 2, 0.0f);
      };
      Fang fang;
      fang.an();
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      auto b = warte_variante(st, 130.0, 8000);
      const auto zeilen = fang.ende();
      std::printf("(h) niedrige_prio %d: Policy %d (SCHED_IDLE = %d), nice %d\n", niedrig, policy.load(), SCHED_IDLE, nice.load());
      if (niedrig) {
        PRUEF(policy.load() == SCHED_IDLE);
        // Slice 3b (F7): unter einem Prozess mit nice 19 erbt der Faden die 19 ohnehin, der Mutant ohne setpriority bliebe grün.
        // Dann wird nice nicht als geprüft ausgegeben (die Policy gilt weiter: SCHED_IDLE setzt nur der Faden selbst).
        if (getpriority(PRIO_PROCESS, 0) == 19) {
          std::printf("(h) nice des Fadens %d: NICHT PRUEFBAR, der Prozess läuft selbst unter nice 19 und der Faden erbt es\n", nice.load());
        } else {
          PRUEF(nice.load() == 19);
        }
      } else {
        PRUEF(policy.load() == SCHED_OTHER);  // nice erbt der Faden vom Prozess (ctest unter nice 19), darum nur die Policy
      }
      for (const auto* x : varianten(b)) st.zurueck(x);
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
  }

  {  // (i) F3: Tempofolge 131, 135. Der Render von 131 (400 ms) scheitert, während der Auftrag 135 schon wartet. Der Fehler darf
     // den Vermerk von 135 nicht löschen: sonst rendert 135 zweimal und zwei gleiche Varianten liegen im Ring (Prüfer:
     // "131 135 135 | 2 Varianten"; Kontrolle ohne Wurf: "131 135 | 1")
    for (int wirf = 1; wirf >= 0; --wirf) {
      Fang fang;
      fang.an();
      std::mutex mx;
      std::vector<double> aufrufe;
      cdj::KeylockOpt opt;
      opt.niedrige_prio = false;
      opt.fn = [&](const std::vector<float>& d, double bpm) {
        { std::lock_guard<std::mutex> lk(mx); aufrufe.push_back(bpm); }
        std::this_thread::sleep_for(std::chrono::milliseconds(bpm == 131.0 ? 400 : 100));
        if (bpm == 131.0 && wirf) throw std::runtime_error("kaputt");
        return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
      };
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      st.takte(131.0, 300);   // Auftrag 131 startet
      st.takte(135.0, 1800);  // Auftrag 135 nach 250 ms Ruhe, wartet hinter 131
      auto b = st.alle();
      fang.ende();
      const auto vs = varianten(b);
      std::vector<double> liste;
      { std::lock_guard<std::mutex> lk(mx); liste = aufrufe; }
      std::printf("(i) wirf=%d: Render-Aufrufe:", wirf);
      for (double x : liste) std::printf(" %.0f", x);
      std::printf(" | Varianten im Ring: %zu\n", vs.size());
      PRUEF(liste.size() == 2 && liste[0] == 131.0 && liste[1] == 135.0);
      PRUEF(vs.size() == 1);
      for (const auto* x : vs) st.zurueck(x);
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
  }

  {  // (j) F4: Befehlsring voll (der Callback liest nicht mehr). Vorher: Endlos-Render (19 in 3 s), je Versuch 100 ms im Netz-Faden
     // und ein /q id 0 quelle keylock status 4 an alle Abonnenten, obwohl "keylock" keine Vertragsquelle ist. Jetzt: ein Versuch,
     // die Variante wird verworfen, keine /q-Meldung, kein neuer Render, bis sich das Tempo ändert.
    Fang fang;
    fang.an();
    std::atomic<int> aufrufe{0};
    cdj::KeylockOpt opt;
    opt.niedrige_prio = false;
    opt.fn = [&](const std::vector<float>& d, double bpm) {
      ++aufrufe;
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
      return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
    };
    Stand st(opt);
    Gegenstelle g;
    {
      cdj::osc::Schreiber sc(v::k_hallo);
      sc.s("x").i(g.port).i(v::vertrag);
      st.netz->paket(sc.daten(), sc.groesse());
      PRUEF(g.warte("/k/willkommen", 500));
    }
    st.laden(1, "eins");
    auto b0 = st.alle();
    int gefuellt = 0;
    cdj::Befehl f{};
    f.art = cdj::Befehl::LOOP_STOPP;
    f.deck = 2;
    while (st.bef->schiebe(f)) ++gefuellt;
    auto q_zaehlen = [&](int& q4, int& q_keylock) {
      for (;;) {
        ssize_t r = recv(g.sock, g.buf, sizeof g.buf, MSG_DONTWAIT);
        if (r <= 0) break;
        if (cdj::osc::lesen(g.buf, (size_t)r, g.m) && !std::strcmp(g.m.adresse, "/q")) {
          if (g.m.werte[2].i == 4) ++q4;
          if (!std::strcmp(g.s(1), "keylock")) ++q_keylock;
        }
      }
    };
    int q4 = 0, qk = 0;
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(2000)) {
      st.takte(130.0, 20);
      q_zaehlen(q4, qk);
    }
    const int auf1 = aufrufe.load();
    const auto zeilen = fang.ende();
    std::printf("(j) Ring mit %d Befehlen voll, 2 s Tempo 130: Render-Aufrufe %d (Soll 1), /q status 4: %d, /q quelle keylock: %d (Soll 0), Zeilen %zu\n",
                gefuellt, auf1, q4, qk, zeilen.size());
    PRUEF(gefuellt > 0);
    PRUEF(auf1 == 1);
    PRUEF(q4 == 0 && qk == 0);
    int voll_zeilen = 0;
    for (const auto& z : zeilen) voll_zeilen += z.find("Befehlsring voll, Variante verworfen") != std::string::npos ? 1 : 0;
    PRUEF(zeilen.size() == 2 && voll_zeilen == 1);  // "fertig" und genau eine Zeile zum vollen Ring
    // Gegenprobe: der Ring wird frei, das Tempo wechselt: es wird wieder gerendert und die Variante kommt an
    (void)st.alle();
    auto spaet = warte_variante(st, 134.0, 5000);
    const auto vs = varianten(spaet);
    std::printf("(j) nach Tempowechsel auf 134: Render-Aufrufe %d (Soll 2), Varianten %zu (Soll 1)\n", aufrufe.load(), vs.size());
    PRUEF(aufrufe.load() == 2 && vs.size() == 1);
    for (const auto* x : vs) st.zurueck(x);
    st.zurueck(lade_zeiger(b0, 1));
    st.netz->ereignisse_senden();
  }

  {  // (k) F5: nicht nur die Render-Funktion, der ganze Auftrag steht im try. Eine Ausnahme beim Bau der Loop (std::bad_alloc) darf
     // den Kern nicht über std::terminate mitnehmen; scheitert der Fadenstart (std::system_error), bleibt Keylock aus.
    {
      Fang fang;
      fang.an();
      std::atomic<bool> wirf{true};
      cdj::KeylockOpt opt;
      opt.niedrige_prio = false;
      opt.fn = [](const std::vector<float>& d, double bpm) {
        return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
      };
      opt.haken_bau = [&] { if (wirf.load()) throw std::bad_alloc(); };
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      st.takte(130.0, 1000);
      auto b = st.alle();
      const auto zeilen = fang.ende();
      std::printf("(k) bad_alloc beim Bau: Zeilen %zu, Varianten %zu (Soll 0)\n", zeilen.size(), varianten(b).size());
      PRUEF(varianten(b).empty());
      PRUEF(zeilen.size() == 1 && zeilen[0].find("Render fehlgeschlagen") != std::string::npos);
      // Negativ-Kontrolle: derselbe Aufbau ohne Wurf liefert bei einem neuen Tempo eine Variante (der Faden lebt noch)
      wirf = false;
      auto spaet = warte_variante(st, 134.0, 5000);
      PRUEF(varianten(spaet).size() == 1);
      for (const auto* x : varianten(spaet)) st.zurueck(x);
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
    {
      Fang fang;
      fang.an();
      std::atomic<int> aufrufe{0};
      cdj::KeylockOpt opt;
      opt.niedrige_prio = false;
      opt.faden_start_wirft = true;
      opt.fn = [&](const std::vector<float>& d, double bpm) {
        ++aufrufe;
        return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
      };
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      st.takte(130.0, 700);
      st.takte(134.0, 700);  // ein zweites Tempo: kein zweiter Versuch, keine zweite Zeile
      auto b = st.alle();
      const auto zeilen = fang.ende();
      std::printf("(k) Fadenstart scheitert: Zeilen %zu (Soll 1), Render-Aufrufe %d (Soll 0), Varianten %zu (Soll 0)\n", zeilen.size(),
                  aufrufe.load(), varianten(b).size());
      PRUEF(zeilen.size() == 1 && zeilen[0].find("Render-Faden startet nicht") != std::string::npos);
      PRUEF(aufrufe.load() == 0 && varianten(b).empty());
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
  }

  {  // (l) F6: Stopp mit laufendem Render der echten R3 bei 32 Beats. Vorher wartete ~Netz den ganzen Render ab (R3 offline ließ sich
     // nicht abbrechen; der Dienst hat TimeoutStopSec=2s): jetzt bricht er zwischen zwei R3-Stücken ab. Erst ein voller Durchlauf als
     // Maß, wie lange der Render ohne Abbruch dauert.
    Fang fang;
    fang.an();
    cdj::KeylockOpt opt;
    opt.niedrige_prio = false;
    double voll_ms = 0;
    {
      Stand st(opt);
      st.laden(1, "zweiunddreissig");
      auto b0 = st.alle();
      const auto t0 = Uhr::now();
      auto b = warte_variante(st, 130.0, 60000);
      voll_ms = (double)std::chrono::duration_cast<std::chrono::milliseconds>(Uhr::now() - t0).count() - 250.0;  // minus Ruhezeit
      PRUEF(varianten(b).size() == 1);
      if (varianten(b).size() == 1) {
        PRUEF(varianten(b)[0]->frames == frames_fuer(32, 130.0));  // nicht leer, die Länge stimmt
        st.zurueck(varianten(b)[0]);
      }
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
    std::atomic<bool> gestartet{false};
    opt.haken_start = [&] { gestartet = true; };
    auto st = std::make_unique<Stand>(opt);
    st->laden(1, "zweiunddreissig");
    auto b0 = st->alle();
    for (int i = 0; i < 1500 && !gestartet.load(); ++i) st->takte(130.0, 4);  // bis der Render läuft (nach der Ruhezeit)
    PRUEF(gestartet.load());
    st->takte(130.0, 200);  // er rechnet schon 200 ms und braucht voll_ms
    const auto t1 = Uhr::now();
    st->zurueck(lade_zeiger(b0, 1));
    st->netz->ereignisse_senden();
    st->netz.reset();  // Stopp
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(Uhr::now() - t1).count();
    const auto zeilen = fang.ende();
    std::printf("(l) 32 Beats: voller Render %.0f ms; Netz-Stopp mit laufendem Render: %lld ms (Soll < 500)\n", voll_ms, (long long)ms);
    PRUEF(voll_ms > 700.0);  // sonst sagt der Test nichts (ein Render, der in 700 ms fertig ist, hätte vorher auch < 500 ms gedauert)
    PRUEF(ms < 500);
    // der abgebrochene Render meldet sich nicht als Fehler
    for (const auto& z : zeilen) PRUEF(z.find("fehlgeschlagen") == std::string::npos && z.find("lieferte nichts") == std::string::npos);
  }

  {  // (l2) F6: nach dem Shutdown startet kein Render mehr (main ruft nach dem join des Netz-Fadens noch ereignisse_senden)
    for (int beenden = 1; beenden >= 0; --beenden) {
      Haken h;
      cdj::KeylockOpt opt;
      opt.fn = h.fn();
      opt.niedrige_prio = false;
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      if (beenden) st.netz->keylock_beenden();
      st.takte(130.0, 800);
      std::printf("(l2) keylock_beenden %d: Render-Aufrufe %zu (Soll %d)\n", beenden, h.aufrufe(), beenden ? 0 : 1);
      PRUEF(h.aufrufe() == (beenden ? 0u : 1u));  // Negativ-Kontrolle im selben Aufbau: ohne Beenden startet der Render
      for (const auto& x : st.alle()) st.zurueck(x.zeiger);
      st.zurueck(lade_zeiger(b0, 1));
      st.netz->ereignisse_senden();
    }
    // wie in main: laufen() im Faden des Netzes, stop, join, danach noch Zyklen. Das Tempo war bei stop noch keine 250 ms fest.
    Haken h;
    cdj::KeylockOpt opt;
    opt.fn = h.fn();
    opt.niedrige_prio = false;
    Stand st(opt);
    st.laden(1, "eins");
    auto b0 = st.alle();
    std::atomic<bool> stop{false};
    std::thread t([&] { st.netz->laufen(stop); });
    for (int i = 0; i < 20; ++i) {  // 40 ms Tempo 130
      st.uhr(130.0);
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    stop = true;
    t.join();
    st.takte(130.0, 800);  // main: netz.ereignisse_senden() nach dem join: die 250 ms Ruhe vergehen, es darf nichts starten
    std::printf("(l2) nach laufen()-Ende: Render-Aufrufe %zu (Soll 0)\n", h.aufrufe());
    PRUEF(h.aufrufe() == 0);
    for (const auto& x : st.alle()) st.zurueck(x.zeiger);
    st.zurueck(lade_zeiger(b0, 1));
    st.netz->ereignisse_senden();
  }

  {  // (n) F2: das Netz tauschte seine Kopie, sobald einreihen() gelang, nicht erst wenn der Kern den Loop lädt. Weist der Kern ab
     // (Stopp Cypher), kommt der Loop über LOOP_ALT zurück. Vorher rendert das Netz dann den abgewiesenen Loop weiter und der
     // Kern lehnt die Variante still ab, die Box bleibt im Varispeed. Hier ohne Kern: die Abweisung wird über LOOP_ALT
     // nachgestellt (wie der Prüfer); mit echtem Kern: test_netz_keylock_kern. Der Render dauert 150 ms: die Abweisung kommt, wie
     // im Kern (derselbe Callback-Zyklus), bevor der erste Render des neuen Loops fertig ist.
    for (int weist_ab = 1; weist_ab >= 0; --weist_ab) {
      cdj::KeylockOpt opt;
      opt.niedrige_prio = false;
      opt.fn = [&](const std::vector<float>& d, double bpm) {
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
      };
      Stand st(opt);
      st.laden(1, "eins");
      auto b0 = st.alle();
      const cdj::Loop* o1 = lade_zeiger(b0, 1);
      auto v1 = warte_variante(st, 130.0, 5000);  // Variante von eins bei 130: der Kern hat eins und seine Variante
      PRUEF(varianten(v1).size() == 1);
      st.laden(1, "zwei", "cypher");  // Auftrag für zwei bei 130 geht sofort raus (Tempo fest)
      auto b1 = st.alle();
      const cdj::Loop* o2 = lade_zeiger(b1, 1);
      PRUEF(o2 != nullptr);
      if (weist_ab) st.zurueck(o2);  // der Kern weist ab: derselbe Zeiger kommt zurück, eins bleibt auf der Box
      else st.zurueck(o1);           // der Kern nimmt an: der alte Loop kommt zurück
      st.netz->ereignisse_senden();
      auto v2 = warte_variante(st, 130.0, 5000);
      const auto vs = varianten(v2);
      const std::string erwartet = weist_ab ? "eins" : "zwei";
      std::printf("(n) Kern weist ab: %d -> naechste Variante fuer: %s (Soll %s)\n", weist_ab,
                  vs.size() == 1 ? vs[0]->name.c_str() : "<keine>", erwartet.c_str());
      PRUEF(vs.size() == 1 && vs[0]->name == erwartet);
      st.takte(130.0, 500);  // nichts Weiteres
      for (const auto& x : st.alle())
        if (x.art == cdj::Befehl::LOOP_VARIANTE) PRUEF(false);
      for (const auto* x : varianten(v1)) st.zurueck(x);
      for (const auto* x : vs) st.zurueck(x);
      st.zurueck(weist_ab ? o1 : o2);
      st.netz->ereignisse_senden();
    }
  }

  fs::remove_all(g_dir);
  PRUEF_ENDE();
}
