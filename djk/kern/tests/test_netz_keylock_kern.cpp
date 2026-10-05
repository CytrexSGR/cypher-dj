// Keylock Slice 3, Ende-zu-Ende: das Netz (Render-Faden, echte R3) gegen einen echten Kern ohne JACK. Ein 1-Beat-Sinus
// (416 Hz = 195 Perioden je Loop bei 128 BPM) läuft in Box 1 bei 130 BPM. Ohne Variante liest die Box im Varispeed
// (Schritt 130/128, 416 · 1,015625 = 422,5 Hz am Master); mit der Variante des Netzes hält sie 416 Hz. Die Frequenz kommt
// aus den Nulldurchgängen des Masters. Fälle: V0 Render liefert nichts (Fehlerfall, bleibt Varispeed: zeigt, was der Test
// ohne Keylock messen würde), V1 echte R3 bei 130, C128 Negativ-Kontrolle bei 128 (Direktweg, kein Render).
// Slice 3b (F2): F2S Stopp Cypher weist das Laden eines anderen Loops ab; nach einem Tempowechsel muss die Box den alten Loop
// im Keylock halten (416 Hz bei 134 BPM), F2N Negativ-Kontrolle ohne Stopp: das Laden gelingt, die Box hält den neuen (832 Hz).
#include <chrono>
#include <cmath>
#include <fstream>
#include <thread>

#include "cypherdj/loop.h"
#include "cypherdj/netz.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;
namespace v = cypherdj::osc;
namespace fs = std::filesystem;
using Uhr = std::chrono::steady_clock;

static constexpr double PI = 3.14159265358979323846;
static constexpr double F_LOOP = 416.0;  // 195 ganze Perioden in 22500 Frames

static void sinus_anlegen(const std::string& ordner, const char* name = "sinus", double perioden = 195.0) {
  fs::create_directories(ordner + "/" + name);
  std::vector<float> d((size_t)SPB * 2);
  for (int64_t i = 0; i < SPB; ++i) {
    const float x = 0.3f * (float)std::sin(2 * PI * perioden * (double)i / (double)SPB);
    d[(size_t)(2 * i)] = x;
    d[(size_t)(2 * i + 1)] = x;
  }
  std::ofstream(ordner + "/" + name + "/loop.f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), (std::streamsize)(d.size() * 4));
  std::ofstream(ordner + "/" + name + "/loop.json") << R"({"schema":1,"name":")" << name << R"(","beats":1,"bpm":128,"frames":22500,"datei":"loop.f32"})";
}

// Frequenz der linken Master-Spur aus aufwärts gerichteten Nulldurchgängen in [a, b)
static double frequenz(const std::vector<float>& l, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b && i + 1 < (int64_t)l.size(); ++i) {
    const double x0 = l[(size_t)i], x1 = l[(size_t)i + 1];
    if (x0 < 0 && x1 >= 0) {
      const double t = (double)i + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

// Ein Durchlauf: Tempo bpm, Loop laden, 1,2 s Echtzeit Zyklen (der Kern läuft schneller als die Uhr; das Netz braucht die
// 250 ms Tempo-Ruhe und den Render in Echtzeit), Box starten, 14 Beats spielen, Frequenz im Master messen.
static double lauf(const char* titel, double bpm, const cdj::KeylockRenderFn& fn, int* keylock_zeilen_hinweis) {
  (void)keylock_zeilen_hinweis;
  Arbeitsbestand ab("test_netz_keylock_kern");
  sinus_anlegen(ab.pfad);
  Lauf x(ab.pfad, nullptr);
  x.abholen = false;  // das Netz leert den Ereignisring
  cdj::Netz netz(0, false, x.bef.get(), x.ere.get());
  netz.setze_loop_ordner(ab.pfad);
  cdj::KeylockOpt opt;
  opt.fn = fn;
  opt.niedrige_prio = false;  // SCHED_IDLE darf den Test auf einem ausgelasteten Rechner nicht aushungern (Priorität: test_netz_keylock (h))
  netz.setze_keylock(opt);
  auto zyklus = [&](int n) {
    for (int i = 0; i < n; ++i) {
      x.zyklen(x.kern->sample() + N);
      netz.ereignisse_senden();
    }
  };
  auto sn = x.neu(cdj::Befehl::SET_NEU);
  sn.bpm = bpm;
  x.sende(sn);
  zyklus(4);
  x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
  { cdj::osc::Schreiber s(v::k_loop_laden); s.h(7).s("andreas").i(1).s("sinus"); netz.paket(s.daten(), s.groesse()); }
  const auto t0 = Uhr::now();
  while (Uhr::now() - t0 < std::chrono::milliseconds(1200)) {
    zyklus(1);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  auto st = x.neu(cdj::Befehl::LOOP_START, "andreas");
  st.deck = 1;
  x.sende(st);
  const int64_t s_start = x.kern->sample();
  while (x.kern->sample() < s_start + 14 * 22500) zyklus(1);
  // Erstes hörbares Sample nach dem Start, danach eine halbe Sekunde einschwingen lassen, dann 2 s messen
  int64_t erst = -1;
  for (int64_t i = s_start; i < (int64_t)x.l.size(); ++i)
    if (std::fabs(x.l[(size_t)i]) > 0.05f) {
      erst = i;
      break;
    }
  const double f = erst < 0 ? 0.0 : frequenz(x.l, erst + 24000, erst + 24000 + 96000);
  std::printf("%s: Start bei Sample %lld, erster Ton %lld, Frequenz im Master %.2f Hz (Loop %.0f Hz, Varispeed %.2f Hz)\n", titel,
              (long long)s_start, (long long)erst, f, F_LOOP, F_LOOP * bpm / 128.0);
  // Aufräumen: ein Loop vom Stapel ersetzt den geladenen, das Netz gibt Loop und Variante über LOOP_ALT frei
  cdj::Loop ende;
  ende.name = "ende";
  ende.beats = 1;
  ende.frames = SPB;
  ende.daten.assign((size_t)SPB * 2, 0.0f);
  auto ld = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
  ld.deck = 1;
  ld.zeiger = &ende;
  x.sende(ld);
  zyklus(40);
  return f;
}

// F2: zuerst "sinus" (416 Hz) bei 130 BPM, mit Variante. Dann (stopp = true) Stopp Cypher und ein Laden von "sinus2" (832 Hz) mit
// Quelle cypher: der Kern weist es ab, "sinus" bleibt auf der Box. Dann Tempo 134. Ohne Rücknahme der Kopie rendert das Netz
// "sinus2", der Kern lehnt die Variante (anderer name) ab und "sinus" läuft im Varispeed (435,5 Hz). Mit stopp = false lädt der
// Kern "sinus2" (Negativ-Kontrolle), die Box hält dessen Keylock-Variante (832 Hz).
static double lauf_f2(const char* titel, bool stopp) {
  Arbeitsbestand ab("test_netz_keylock_kern");
  sinus_anlegen(ab.pfad);
  sinus_anlegen(ab.pfad, "sinus2", 390.0);
  Lauf x(ab.pfad, nullptr);
  x.abholen = false;
  cdj::Netz netz(0, false, x.bef.get(), x.ere.get());
  netz.setze_loop_ordner(ab.pfad);
  cdj::KeylockOpt opt;
  opt.niedrige_prio = false;
  netz.setze_keylock(opt);
  auto zyklus = [&](int n) {
    for (int i = 0; i < n; ++i) {
      x.zyklen(x.kern->sample() + N);
      netz.ereignisse_senden();
    }
  };
  auto echtzeit = [&](int ms) {
    const auto t0 = Uhr::now();
    while (Uhr::now() - t0 < std::chrono::milliseconds(ms)) {
      zyklus(1);
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  };
  auto tempo = [&](double bpm) {
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = bpm;
    x.sende(sn);
  };
  tempo(130.0);
  zyklus(4);
  x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
  { cdj::osc::Schreiber s(v::k_loop_laden); s.h(7).s("andreas").i(1).s("sinus"); netz.paket(s.daten(), s.groesse()); }
  echtzeit(1200);  // "sinus" mit Variante bei 130
  if (stopp) {
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    zyklus(4);
  }
  { cdj::osc::Schreiber s(v::k_loop_laden); s.h(8).s("cypher").i(1).s("sinus2"); netz.paket(s.daten(), s.groesse()); }
  echtzeit(400);
  tempo(134.0);
  echtzeit(1500);  // Tempo 134 fest, Render, Variante
  auto st = x.neu(cdj::Befehl::LOOP_START, "andreas");
  st.deck = 1;
  x.sende(st);
  const int64_t s_start = x.kern->sample();
  while (x.kern->sample() < s_start + 14 * 22500) zyklus(1);
  int64_t erst = -1;
  for (int64_t i = s_start; i < (int64_t)x.l.size(); ++i)
    if (std::fabs(x.l[(size_t)i]) > 0.05f) {
      erst = i;
      break;
    }
  const double f = erst < 0 ? 0.0 : frequenz(x.l, erst + 24000, erst + 24000 + 96000);
  std::printf("%s: Frequenz im Master %.2f Hz (Varispeed von sinus bei 134 BPM: %.2f Hz)\n", titel, f, F_LOOP * 134.0 / 128.0);
  cdj::Loop ende;
  ende.name = "ende";
  ende.beats = 1;
  ende.frames = SPB;
  ende.daten.assign((size_t)SPB * 2, 0.0f);
  auto ld = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
  ld.deck = 1;
  ld.zeiger = &ende;
  x.sende(ld);
  zyklus(40);
  return f;
}

int main() {
  // V0: Fehlerfall, der Render liefert nichts (Fehler gemeldet), die Box bleibt im Varispeed: 130/128 · 416 = 422,5 Hz
  const double f0 = lauf("V0 Varispeed (Render leer)", 130.0, [](const std::vector<float>&, double) { return std::vector<float>(); }, nullptr);
  PRUEF_NAH(f0, F_LOOP * 130.0 / 128.0, 1.0);
  // V1: echte R3: die Box spielt die Variante, die Tonhöhe bleibt 416 Hz
  const double f1 = lauf("V1 Keylock 130 (echte R3)", 130.0, nullptr, nullptr);
  PRUEF_NAH(f1, F_LOOP, 1.5);
  PRUEF(std::fabs(f1 - f0) > 4.0);  // der Unterschied ist da: 6,5 Hz
  // C128: Negativ-Kontrolle, Tempo 128: Direktweg, kein Render (der Haken würde zählen)
  int aufrufe = 0;
  const double f2 = lauf("C128 Tempo 128", 128.0,
                         [&](const std::vector<float>& d, double) {
                           ++aufrufe;
                           return std::vector<float>(d.size(), 0.0f);
                         },
                         nullptr);
  PRUEF_NAH(f2, F_LOOP, 1.0);
  PRUEF(aufrufe == 0);
  // F2S: der Kern weist das Laden ab, die Box hält "sinus" im Keylock bei 134 BPM: 416 Hz (nicht 435,5 Hz im Varispeed)
  const double fs = lauf_f2("F2S Stopp Cypher, Laden abgewiesen, Tempo 134", true);
  PRUEF_NAH(fs, F_LOOP, 1.5);
  // F2N: Negativ-Kontrolle, dasselbe ohne Stopp: das Laden gelingt, die Box hält "sinus2" im Keylock (832 Hz)
  const double fn = lauf_f2("F2N ohne Stopp, Laden gelingt, Tempo 134", false);
  PRUEF_NAH(fn, 2 * F_LOOP, 3.0);
  PRUEF_ENDE();
}
