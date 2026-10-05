// Keylock Slice 4 (Plan 2026-09-30, Slice-Tabelle Zeile 4): REC bei Tempo T ≠ 128 bewahrt die Tonhöhe. Bisher tastete
// schreibe_loop den Mitschnitt mit umtasten() (Resampling) auf das 128er-Raster um; das ändert die Tonhöhe um
// 12·log2(T/128) Halbton, hob sich nur mit dem Varispeed der Box auf und bliebe mit Keylock schief (135 BPM: −92 ct).
// Jetzt rechnet der Render-Faden des Netzes mit R3 (Zeitverhältnis, Tonhöhe 1,0), das Netz legt die Datei erst danach an.
// Das Netz läuft gegen einen echten Kern ohne JACK (wie test_netz_keylock_kern); der Mitschnitt kommt als Ereignis in den
// Ring (was der Kern bei fertigem Mitschnitt täte, Beweis des Kerns: test_kern_mitschnitt), ein Ton 130,81 Hz wird
// "aufgenommen".
//  (a) 135 BPM, 4 Beats: Datei genau 90 000 Frames, Frequenz der Datei 130,81 Hz ± 3 ct; Wiedergabe bei 135 (Loop laden,
//      Variante, Master) ebenfalls ± 3 ct. Vorher (umtasten): −92 ct an der Datei und in der Wiedergabe.
//  (b) 128 BPM: Datei bitgleich mit dem Puffer, kein R3-Aufruf (Haken zählt 0). Gegenprobe im selben Aufbau: 135 ruft ihn.
//  (c) Länge exakt bei 130, 140, 100 BPM; außerhalb des Bereichs (rendere_rec direkt und im Netz) abgelehnt.
//  (e) Fehler der Umrechnung (leer, Ausnahme, falsche Länge): keine Datei, keine .neu-Leiche, genau eine stderr-Zeile,
//      /e/mitschnitt Status 1. Und: während die Umrechnung läuft, blockiert das Netz nicht (Haken hält sie fest).
// Slice 3c (Prüfung 3b/4, F-D, F-E):
//  (g) /e/mitschnitt trägt im asynchronen Pfad (135 BPM, spät vom Netz-Faden gesendet) dieselben Felder wie im synchronen
//      (128 BPM): Name, Fassung, Status, Beat. Die Seite beendet ihren REC-Knopf über den Namen (app.js: f.name === recAktiv).
//  (h) Reihenfolge der Aufträge im Render-Faden: REC vor Varianten (Entscheidung Slice 4: auf REC wartet jemand, eine Variante
//      ist Zusatz). Ein Variantenauftrag und ein REC warten hinter einem laufenden Render; nach der Freigabe kommt REC zuerst.
#include <fcntl.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "cypherdj/loop.h"
#include "cypherdj/loop_stretch.h"
#include "cypherdj/netz.h"
#include "cypherdj/uhr.h"
#include "gegenstelle.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;
namespace v = cypherdj::osc;
namespace fs = std::filesystem;
using Uhr = std::chrono::steady_clock;

static constexpr double PI = 3.14159265358979323846;
static constexpr double F_TON = 130.81;  // C3, kein ganzzahliges Vielfaches der Loop-Länge: der Fall, der bei R3 am empfindlichsten ist

static double cent(double f, double soll) { return 1200.0 * std::log2(f / soll); }

// Frequenz aus aufwärts gerichteten Nulldurchgängen in [a, b) der linken Spur
static double frequenz(const float* l, int64_t schritt, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b; ++i) {
    const double x0 = l[i * schritt], x1 = l[(i + 1) * schritt];
    if (x0 < 0 && x1 >= 0) {
      const double t = (double)i + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

// Wie der Kern: 4 Beats beim Tempo bpm kopieren (LoopBoxen::mitschnitt): Länge = llround(sample_at(ab + beats)) − ab_sample
static cdj::Mitschnitt* neuer_mitschnitt(const char* name, int beats, double bpm, double ton) {
  auto* mt = new cdj::Mitschnitt();
  std::snprintf(mt->name, sizeof mt->name, "%s", name);
  mt->beats = beats;
  mt->frames = (int64_t)beats * cdj::LOOP_SPB;
  mt->daten.assign((size_t)cdj::mitschnitt_max_frames(beats) * 2, -999.0f);
  cdj::Karte k(bpm, 0);
  mt->ab_beat = 0.0;
  mt->ab_sample = 0;
  mt->roh_frames = std::min<int64_t>(std::llround(k.sample_at((double)beats)), (int64_t)mt->daten.size() / 2);
  mt->bpm = bpm;
  mt->gefuellt = mt->roh_frames;
  for (int64_t i = 0; i < mt->roh_frames; ++i) {
    const float x = 0.3f * (float)std::sin(2 * PI * ton * (double)i / 48000.0);
    mt->daten[(size_t)(2 * i)] = x;
    mt->daten[(size_t)(2 * i + 1)] = x;
  }
  return mt;
}

static std::vector<float> lese_f32(const fs::path& p) {
  std::ifstream f(p, std::ios::binary);
  f.seekg(0, std::ios::end);
  const std::streamoff n = f.tellg();
  f.seekg(0);
  std::vector<float> d((size_t)n / 4);
  f.read(reinterpret_cast<char*>(d.data()), n);
  return d;
}

// stderr in eine Datei umleiten, danach die "keylock:"-Zeilen zählen
struct Fang {
  int alt = -1;
  std::string pfad;
  void an(const fs::path& d) {
    pfad = (d / "stderr.txt").string();
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

struct Meldung {  // /e/mitschnitt Feld für Feld (Name, Fassung, Status, Beat)
  std::string name;
  int32_t fassung = -1;
  int32_t status = -1;
  double beat = -1.0;
};

// Ein Loop-Ordner (Gleichwert) für LOOP_LADEN über OSC
static void loop_anlegen(const fs::path& ordner, const char* name, int beats, float wert) {
  fs::create_directories(ordner / name);
  const int64_t frames = (int64_t)beats * cdj::LOOP_SPB;
  std::vector<float> x((size_t)frames * 2, wert);
  std::ofstream(ordner / name / "loop.f32", std::ios::binary).write(reinterpret_cast<const char*>(x.data()), (std::streamsize)(x.size() * 4));
  std::ofstream(ordner / name / "loop.json")
      << R"({"schema":1,"name":")" << name << R"(","beats":)" << beats << R"(,"bpm":128,"frames":)" << frames << R"(,"datei":"loop.f32"})";
}

struct Aufbau {
  Arbeitsbestand ab;
  Lauf x;
  cdj::Netz netz;
  Gegenstelle g;
  explicit Aufbau(const char* titel, double bpm, const cdj::KeylockOpt& opt)
      : ab(titel), x(ab.pfad, nullptr), netz(0, false, x.bef.get(), x.ere.get()) {
    x.abholen = false;  // das Netz leert den Ereignisring
    netz.setze_loop_ordner(ab.pfad);
    cdj::KeylockOpt o = opt;
    o.niedrige_prio = false;  // SCHED_IDLE darf den Test auf einem ausgelasteten Rechner nicht aushungern
    netz.setze_keylock(o);
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = bpm;
    x.sende(sn);
    zyklus(4);
  }
  void zyklus(int n) {
    for (int i = 0; i < n; ++i) {
      x.zyklen(x.kern->sample() + N);
      netz.ereignisse_senden();
    }
  }
  // Mitschnitt fertig melden (was der Kern bei fertigem Mitschnitt tut); mt gehört danach dem Netz
  void melde(cdj::Mitschnitt* mt, double beat = 4.0) {
    cdj::Ereignis f{};
    f.art = cdj::Ereignis::MITSCHNITT;
    f.status = 0;
    f.beat = beat;
    f.fassung = mt->beats;
    std::snprintf(f.pfad, sizeof f.pfad, "%s", mt->name);
    f.zeiger = mt;
    PRUEF(x.ere->schiebe(f));
    netz.ereignisse_senden();
  }
  // auf /e/mitschnitt warten; das Netz weiter treiben (die Ergebnisse des Render-Fadens holt ereignisse_senden ab)
  bool warte_ereignis(int ms, int32_t* status, Meldung* mel = nullptr) {
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(ms)) {
      zyklus(1);
      if (g.warte("/e/mitschnitt", 1)) {
        *status = g.m.werte[2].i;
        if (mel) {
          mel->name = g.s(0);
          mel->fassung = g.m.werte[1].i;
          mel->status = g.m.werte[2].i;
          mel->beat = g.m.werte[3].d;
        }
        return true;
      }
    }
    return false;
  }
};

struct Haken {  // REC-Funktion des Tests: zählt, kann warten, werfen, Falsches liefern
  std::mutex m;
  std::condition_variable cv;
  std::atomic<int> aufrufe{0};
  bool halten = false;
  int art = 0;  // 0 echt (rendere_rec), 1 leer, 2 Ausnahme, 3 falsche Länge
  cdj::RecRenderFn fn() {
    return [this](const float* d, int64_t roh, int64_t frames) -> std::vector<float> {
      ++aufrufe;
      {
        std::unique_lock<std::mutex> lk(m);
        cv.wait(lk, [&] { return !halten; });
      }
      if (art == 1) return {};
      if (art == 2) throw std::runtime_error("kaputt");
      if (art == 3) return std::vector<float>((size_t)frames, 0.0f);  // halb so viele Werte wie nötig
      return cdj::rendere_rec(d, roh, frames);
    };
  }
  void frei() {
    { std::lock_guard<std::mutex> lk(m); halten = false; }
    cv.notify_all();
  }
};

int main() {
  {  // (a) 135 BPM: Datei und Wiedergabe
    Haken h;
    cdj::KeylockOpt opt;
    opt.rec_fn = h.fn();
    Aufbau a("test_netz_rec_keylock_a", 135.0, opt);
    a.melde(neuer_mitschnitt("rec135", 4, 135.0, F_TON));
    int32_t st = -1;
    PRUEF(a.warte_ereignis(15000, &st) && st == 0);
    const fs::path datei = fs::path(a.ab.pfad) / "rec135" / "loop.f32";
    PRUEF(fs::exists(datei));
    const std::vector<float> d = lese_f32(datei);
    std::printf("(a) Datei rec135: %zu Frames (Soll 90000), %d R3-Aufrufe\n", d.size() / 2, h.aufrufe.load());
    PRUEF(d.size() == 2 * 90000);
    const double ff = d.size() == 2 * 90000 ? frequenz(d.data(), 2, 10000, 80000) : 0.0;
    std::printf("(a) Frequenz der Datei %.3f Hz = %+.1f ct gegen %.2f Hz (Soll |ct| <= 3; mit umtasten: -92)\n", ff, cent(ff, F_TON), F_TON);
    PRUEF(ff > 0 && std::fabs(cent(ff, F_TON)) <= 3.0);
    // Wiedergabe bei 135: Loop laden, die Keylock-Variante (R3 bei 135) rechnet der Render-Faden, Box starten
    a.x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
    { cdj::osc::Schreiber s(v::k_loop_laden); s.h(7).s("andreas").i(1).s("rec135"); a.netz.paket(s.daten(), s.groesse()); }
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(1200)) {
      a.zyklus(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    auto st2 = a.x.neu(cdj::Befehl::LOOP_START, "andreas");
    st2.deck = 1;
    a.x.sende(st2);
    const int64_t s_start = a.x.kern->sample();
    while (a.x.kern->sample() < s_start + 16 * 22500) a.zyklus(1);
    int64_t erst = -1;
    for (int64_t i = s_start; i < (int64_t)a.x.l.size(); ++i)
      if (std::fabs(a.x.l[(size_t)i]) > 0.05f) {
        erst = i;
        break;
      }
    // Fenster innerhalb eines Durchlaufs (1,78 s): die Naht eines Tons, der nicht zur Loop-Länge passt, knackt und zählt sonst mit
    const double fm = erst < 0 ? 0.0 : frequenz(a.x.l.data(), 1, erst + 12000, erst + 72000);
    std::printf("(a) Wiedergabe bei 135 BPM: Frequenz im Master %.3f Hz = %+.1f ct (Soll |ct| <= 3; Varispeed-Mitschnitt: -92)\n", fm, cent(fm, F_TON));
    PRUEF(fm > 0 && std::fabs(cent(fm, F_TON)) <= 3.0);
    // Aufräumen: ein Loop vom Stapel ersetzt den geladenen, das Netz gibt Loop und Variante frei
    cdj::Loop ende;
    ende.name = "ende";
    ende.beats = 1;
    ende.frames = SPB;
    ende.daten.assign((size_t)SPB * 2, 0.0f);
    auto ld = a.x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    ld.deck = 1;
    ld.zeiger = &ende;
    a.x.sende(ld);
    a.zyklus(40);
  }
  {  // (b) 128 BPM: bitgleich, kein R3; Gegenprobe 135 ruft ihn
    Haken h;
    cdj::KeylockOpt opt;
    opt.rec_fn = h.fn();
    Aufbau a("test_netz_rec_keylock_b", 128.0, opt);
    cdj::Mitschnitt* mt = neuer_mitschnitt("rec128", 4, 128.0, F_TON);
    const std::vector<float> soll(mt->daten.begin(), mt->daten.begin() + 2 * 90000);
    PRUEF(mt->roh_frames == 90000);
    a.melde(mt);
    int32_t st = -1;
    PRUEF(a.warte_ereignis(5000, &st) && st == 0);
    const std::vector<float> d = lese_f32(fs::path(a.ab.pfad) / "rec128" / "loop.f32");
    std::printf("(b) 128 BPM: %zu Frames, memcmp %d, R3-Aufrufe %d (Soll 0)\n", d.size() / 2,
                d.size() == soll.size() ? std::memcmp(d.data(), soll.data(), soll.size() * 4) : -1, h.aufrufe.load());
    PRUEF(d.size() == soll.size() && std::memcmp(d.data(), soll.data(), soll.size() * 4) == 0);
    PRUEF(h.aufrufe == 0);
    std::ifstream js(fs::path(a.ab.pfad) / "rec128" / "loop.json");
    const std::string text((std::istreambuf_iterator<char>(js)), std::istreambuf_iterator<char>());
    PRUEF(!text.empty() && text.find("aufnahme_bpm") == std::string::npos);
    a.melde(neuer_mitschnitt("rec135b", 4, 135.0, F_TON));  // Gegenprobe: derselbe Haken zählt jetzt
    PRUEF(a.warte_ereignis(15000, &st) && st == 0);
    std::printf("(b) Gegenprobe 135 BPM: R3-Aufrufe %d (Soll 1)\n", h.aufrufe.load());
    PRUEF(h.aufrufe == 1);
  }
  {  // (c) Länge und Tonhöhe bei 130, 140, 100 BPM
    for (double bpm : {130.0, 140.0, 100.0}) {
      Aufbau a("test_netz_rec_keylock_c", bpm, cdj::KeylockOpt{});
      char name[32];
      std::snprintf(name, sizeof name, "rec%d", (int)bpm);
      cdj::Mitschnitt* mt = neuer_mitschnitt(name, 4, bpm, F_TON);
      const int64_t roh = mt->roh_frames;
      a.melde(mt);
      int32_t st = -1;
      PRUEF(a.warte_ereignis(15000, &st) && st == 0);
      const std::vector<float> d = lese_f32(fs::path(a.ab.pfad) / name / "loop.f32");
      const double ff = d.size() == 2 * 90000 ? frequenz(d.data(), 2, 10000, 80000) : 0.0;
      std::printf("(c) %.0f BPM: roh %lld -> %zu Frames (Soll 90000), %.3f Hz = %+.1f ct\n", bpm, (long long)roh, d.size() / 2, ff, cent(ff, F_TON));
      PRUEF(d.size() == 2 * 90000);
      PRUEF(ff > 0 && std::fabs(cent(ff, F_TON)) <= 3.0);
      std::ifstream js(fs::path(a.ab.pfad) / name / "loop.json");
      const std::string text((std::istreambuf_iterator<char>(js)), std::istreambuf_iterator<char>());
      PRUEF(text.find("aufnahme_bpm") != std::string::npos);
    }
    // außerhalb [60, 200]: rendere_rec lehnt ab (wie rendere_keylock); Negativ-Kontrolle: die Grenzen selbst gehen
    std::vector<float> ein((size_t)2 * 200000, 0.1f);
    const int64_t R = 90000;
    const int64_t roh_t[] = {50000, 57000, 57600, 100000, 192000, 195000, 200000};  // T = 128·90000/roh
    const bool soll[] = {false, false, true, true, true, false, false};             // 230,4 228,1 | 200,0 115,2 60,0 | 59,1 57,6
    int rot = 0;
    for (int i = 0; i < 7; ++i) {
      const bool ok = !cdj::rendere_rec(ein.data(), roh_t[i], R).empty();
      if (ok != soll[i]) ++rot;
    }
    std::printf("(c) rendere_rec Bereich [60,200]: Abweichungen vom Soll %d (Soll 0)\n", rot);
    PRUEF(rot == 0);
    PRUEF(cdj::rendere_rec(nullptr, 90000, 90000).empty() && cdj::rendere_rec(ein.data(), 0, 90000).empty() &&
          cdj::rendere_rec(ein.data(), 90000, 0).empty());
  }
  {  // (c2) im Netz: T = 230 abgelehnt (Status 1, keine Datei), Negativ-Kontrolle T = 200 geht
    Fang f;
    Aufbau a("test_netz_rec_keylock_c2", 128.0, cdj::KeylockOpt{});
    f.an(a.ab.pfad);
    a.melde(neuer_mitschnitt("rec230", 4, 230.0, F_TON));
    int32_t st = -1;
    const bool da = a.warte_ereignis(15000, &st);
    const auto z = f.ende();
    std::printf("(c2) 230 BPM: Ereignis %d Status %d (Soll 1), Datei da %d (Soll 0), stderr-Zeilen %zu (Soll 1)\n", (int)da, st,
                (int)fs::exists(fs::path(a.ab.pfad) / "rec230"), z.size());
    PRUEF(da && st == 1 && !fs::exists(fs::path(a.ab.pfad) / "rec230") && z.size() == 1);
    a.melde(neuer_mitschnitt("rec200", 4, 200.0, F_TON));
    PRUEF(a.warte_ereignis(15000, &st) && st == 0 && fs::exists(fs::path(a.ab.pfad) / "rec200" / "loop.f32"));
  }
  {  // (e) Fehler der Umrechnung: leer, Ausnahme, falsche Länge
    const char* titel[] = {"leer", "Ausnahme", "falsche Laenge"};
    for (int art = 1; art <= 3; ++art) {
      Haken h;
      h.art = art;
      cdj::KeylockOpt opt;
      opt.rec_fn = h.fn();
      Fang f;
      Aufbau a("test_netz_rec_keylock_e", 135.0, opt);
      f.an(a.ab.pfad);
      a.melde(neuer_mitschnitt("rece", 4, 135.0, F_TON));
      int32_t st = -1;
      const bool da = a.warte_ereignis(15000, &st);
      const auto z = f.ende();
      const bool leiche = fs::exists(fs::path(a.ab.pfad) / ".rece.neu");
      std::printf("(e) %s: Ereignis %d Status %d (Soll 1), Ordner da %d, .neu da %d (Soll 0 0), stderr-Zeilen %zu (Soll 1): %s\n", titel[art - 1],
                  (int)da, st, (int)fs::exists(fs::path(a.ab.pfad) / "rece"), (int)leiche, z.size(), z.empty() ? "-" : z[0].c_str());
      PRUEF(da && st == 1 && !fs::exists(fs::path(a.ab.pfad) / "rece") && !leiche && z.size() == 1 && h.aufrufe == 1);
    }
  }
  {  // (e2) das Netz blockiert nicht, solange die Umrechnung läuft: ereignisse_senden und /uhr kommen weiter
    Haken h;
    h.halten = true;
    cdj::KeylockOpt opt;
    opt.rec_fn = h.fn();
    Aufbau a("test_netz_rec_keylock_e2", 135.0, opt);
    a.melde(neuer_mitschnitt("rechalt", 4, 135.0, F_TON));
    const auto t0 = Uhr::now();
    for (int i = 0; i < 50; ++i) a.zyklus(1);
    const long long ms = (long long)std::chrono::duration_cast<std::chrono::milliseconds>(Uhr::now() - t0).count();
    int32_t st = -1;
    std::printf("(e2) 50 Netz-Zyklen bei angehaltener Umrechnung: %lld ms, Datei da %d (Soll 0), Aufrufe %d\n", ms,
                (int)fs::exists(fs::path(a.ab.pfad) / "rechalt"), h.aufrufe.load());
    PRUEF(ms < 1000 && !fs::exists(fs::path(a.ab.pfad) / "rechalt"));
    PRUEF(!a.g.warte("/e/mitschnitt", 50));  // solange nichts gerechnet ist, gibt es auch kein /e/mitschnitt
    h.frei();
    PRUEF(a.warte_ereignis(15000, &st) && st == 0 && fs::exists(fs::path(a.ab.pfad) / "rechalt" / "loop.f32"));
  }
  {  // (g) F-D: /e/mitschnitt im asynchronen Pfad (135 BPM) trägt dieselben Felder wie im synchronen (128 BPM)
    constexpr double BEAT = 6.75;  // weder 0 noch der Standardwert 4 der anderen Blöcke
    Meldung sync, async;
    int32_t st = -1;
    {
      Aufbau a("test_netz_rec_keylock_g1", 128.0, cdj::KeylockOpt{});
      a.melde(neuer_mitschnitt("sync128", 4, 128.0, F_TON), BEAT);
      PRUEF(a.warte_ereignis(5000, &st, &sync) && st == 0);
    }
    {
      Aufbau a("test_netz_rec_keylock_g2", 135.0, cdj::KeylockOpt{});
      a.melde(neuer_mitschnitt("async135", 4, 135.0, F_TON), BEAT);
      PRUEF(a.warte_ereignis(15000, &st, &async) && st == 0);
    }
    std::printf("(g) synchron  (128): name=%s fassung=%d status=%d beat=%.2f\n", sync.name.c_str(), sync.fassung, sync.status, sync.beat);
    std::printf("(g) asynchron (135): name=%s fassung=%d status=%d beat=%.2f\n", async.name.c_str(), async.fassung, async.status, async.beat);
    PRUEF(sync.name == "sync128" && sync.fassung == 4 && sync.status == 0 && sync.beat == BEAT);
    PRUEF(async.name == "async135" && async.fassung == 4 && async.status == 0 && async.beat == BEAT);
    // Feld für Feld gleich (bis auf den Namen, der je Pfad ein anderer ist)
    PRUEF(async.fassung == sync.fassung && async.status == sync.status && async.beat == sync.beat);
  }
  {  // (h) F-E: REC-Aufträge vor Varianten. Der Render-Faden hängt in der Variante von Box 1; dahinter warten die Variante
     // von Box 2 (zuerst eingereiht) und ein REC (danach). Nach der Freigabe muss der REC vor der Variante von Box 2 rechnen.
    std::mutex m;
    std::condition_variable cv;
    std::vector<std::string> reihe;  // Reihenfolge der Render-Aufrufe
    bool halten = true;              // nur der erste Variantenrender wartet
    int varianten = 0;
    cdj::KeylockOpt opt;
    opt.fn = [&](const std::vector<float>& d, double bpm) {
      std::unique_lock<std::mutex> lk(m);
      const int nr = varianten++;
      reihe.push_back("V" + std::to_string(nr));
      if (nr == 0) cv.wait(lk, [&] { return !halten; });
      return std::vector<float>(2 * (size_t)std::llround((double)(d.size() / 2) * 128.0 / bpm), 0.125f);
    };
    opt.rec_fn = [&](const float*, int64_t, int64_t frames) {
      std::lock_guard<std::mutex> lk(m);
      reihe.push_back("R");
      return std::vector<float>((size_t)frames * 2, 0.0f);
    };
    opt.ruhe_ns = 50'000'000LL;
    Aufbau a("test_netz_rec_keylock_h", 135.0, opt);
    loop_anlegen(a.ab.pfad, "eins", 1, 0.25f);
    loop_anlegen(a.ab.pfad, "zwei", 1, 0.5f);
    auto warte = [&](size_t n, int ms) {
      const auto t0 = Uhr::now();
      while (Uhr::now() - t0 < std::chrono::milliseconds(ms)) {
        a.zyklus(1);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
        std::lock_guard<std::mutex> lk(m);
        if (reihe.size() >= n) return true;
      }
      return false;
    };
    auto laden = [&](int box, const char* name, int h) {
      cdj::osc::Schreiber s(v::k_loop_laden);
      s.h(h).s("andreas").i(box).s(name);
      a.netz.paket(s.daten(), s.groesse());
    };
    laden(1, "eins", 7);
    PRUEF(warte(1, 5000));  // Render der Variante von Box 1 läuft und hängt
    laden(2, "zwei", 8);
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(400)) {  // der Auftrag für Box 2 steht hinter dem hängenden Render
      a.zyklus(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    a.melde(neuer_mitschnitt("rech", 4, 135.0, F_TON));  // REC kommt nach dem Variantenauftrag
    for (int i = 0; i < 100; ++i) {
      a.zyklus(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    {
      std::lock_guard<std::mutex> lk(m);
      PRUEF(reihe.size() == 1);  // nichts ist an dem hängenden Render vorbeigekommen
      halten = false;
    }
    cv.notify_all();
    PRUEF(warte(3, 15000));
    int32_t st = -1;
    PRUEF(a.warte_ereignis(15000, &st) && st == 0);
    std::string folge;
    {
      std::lock_guard<std::mutex> lk(m);
      for (const auto& x : reihe) folge += x + " ";
    }
    std::printf("(h) Reihenfolge der Render-Aufrufe: %s(Soll: V0 R V1)\n", folge.c_str());
    PRUEF(folge == "V0 R V1 ");
    // Aufräumen wie in (a): je ein Loop vom Stapel ersetzt die geladenen, das Netz gibt Loops und Varianten frei
    cdj::Loop ende[2];
    for (int i = 0; i < 2; ++i) {
      ende[i].name = "ende";
      ende[i].beats = 1;
      ende[i].frames = SPB;
      ende[i].daten.assign((size_t)SPB * 2, 0.0f);
      auto ld = a.x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
      ld.deck = i + 1;
      ld.zeiger = &ende[i];
      a.x.sende(ld);
    }
    a.zyklus(40);
  }
  {  // (f) Slice 3b (F5): der Render-Faden startet nicht (std::system_error): der Mitschnitt lässt sich nicht umrechnen und wird nicht
     // roh geschrieben (falsche Länge und Tonhöhe): Status 1, keine Datei, der Kern läuft weiter (kein std::terminate).
     // Negativ-Kontrolle im selben Aufbau ohne Fehlstart: (a) bis (e).
    Fang f;
    cdj::KeylockOpt opt;
    opt.faden_start_wirft = true;
    Aufbau a("test_netz_rec_keylock_f", 135.0, opt);
    f.an(a.ab.pfad);
    a.melde(neuer_mitschnitt("recf", 4, 135.0, F_TON));
    int32_t st = -1;
    const bool da = a.warte_ereignis(3000, &st);
    const auto z = f.ende();
    const bool leiche = fs::exists(fs::path(a.ab.pfad) / ".recf.neu");
    std::printf("(f) Faden startet nicht: Ereignis %d Status %d (Soll 1), Ordner da %d, .neu da %d (Soll 0 0), stderr-Zeilen %zu (Soll 2)\n", (int)da, st,
                (int)fs::exists(fs::path(a.ab.pfad) / "recf"), (int)leiche, z.size());
    PRUEF(da && st == 1 && !fs::exists(fs::path(a.ab.pfad) / "recf") && !leiche && z.size() == 2);
    PRUEF(z.size() == 2 && z[0].find("Render-Faden startet nicht") != std::string::npos && z[1].find("kein Render-Faden") != std::string::npos);
  }
  PRUEF_ENDE();
}
