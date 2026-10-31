// Paket 1.13 Warp, Slice 2 (AK15 durch das Arrangement): Tausch eines gewarpten Clips gegen denselben Clip mit anderer Quelle, mit Arbeitsfäden im Takt
// des Callbacks. Die alte Stimme des Werks spielt nach dem Tausch bis zur Überblendung (ARR_WARP_FRIST + ARR_NAHT Samples, rund 45 ms) aus ihrem Ring
// weiter und rechnet im Faden dazu aus dem ALTEN Audio, während der Kern den alten Schnappschuss sofort zurückgibt (tausche() liefert ihn). Der
// Lade-Faden-Ersatz hier gibt den alten Schnappschuss zurück, sobald WarpWerk::liest(alt) falsch ist, und zählt dabei die Referenzen wie der Cache (ArrAudio::ref);
// wird es 0, gibt er das Audio frei (mprotect PROT_NONE): liest ein Faden danach noch, stürzt er ab (SIGSEGV, Rückgabe 139), nicht erst bei einem späteren Zufall.
//   1  andere Quelle   1 kHz -> 1,5 kHz: liest() bleibt wahr, bis die alte Stimme ausgeblendet und im Werk beendet ist (frühestens s_t + ARR_WARP_FRIST +
//                      ARR_NAHT), wird dann falsch; kein Absturz; der neue Klang ist da (RMS), die alte Quelle ist freigegeben
//   2  gleiche Quelle  dasselbe Audio, nur der Gain anders: der neue Schnappschuss nennt das Audio weiter (ref 2), der Cache behielte es, liest() hält den alten
//                      Schnappschuss nicht auf (er geht sofort; sonst stauten sich bei jeder Änderung während des Spielens abgelöste Schnappschüsse in der Warteliste
//                      des Laders), nichts wird freigegeben, kein Absturz (Gegenprobe)
// Mutation WARP_LIEST_OHNE_STIMME (im Werk): liest() kennt nur offene Aufträge und Blöcke im Lauf, nicht die Stimme, die ihr Audio später noch liest: der Ersatz
// gibt das Audio zwischen zwei Blöcken der alten Stimme frei, der Faden stürzt ab (Rückgabe 139, gemessen vor der Regel in 5 von 5 Läufen).
#include <sys/mman.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#include <csignal>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <new>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int64_t FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle

// Ein Audio in eigenen Seiten (Kopf ArrAudio und Daten); frei() sperrt sie, jeder spätere Zugriff stürzt ab
struct Seite {
  char* basis = nullptr;
  size_t bytes = 0;
  cdj::ArrAudio* a = nullptr;
  static Seite neu(int64_t frames, double hz) {
    Seite s;
    const size_t kopf = static_cast<size_t>(sysconf(_SC_PAGESIZE));
    const size_t daten = static_cast<size_t>(frames) * 2 * sizeof(float);
    s.bytes = (kopf + daten + kopf - 1) / kopf * kopf;
    s.basis = static_cast<char*>(mmap(nullptr, s.bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0));
    s.a = ::new (static_cast<void*>(s.basis)) cdj::ArrAudio{};
    float* d = reinterpret_cast<float*>(s.basis + kopf);
    for (int64_t f = 0; f < frames; ++f) d[2 * f] = d[2 * f + 1] = 0.4f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(f) / 48000.0));
    s.a->daten = d;
    s.a->frames = frames;
    std::snprintf(s.a->sha256, sizeof s.a->sha256, "%064d", static_cast<int>(hz));
    return s;
  }
  void frei() {
    mprotect(basis, bytes, PROT_NONE);       // zuerst sperren: ab hier stürzt jeder Zugriff ab
    madvise(basis, bytes, MADV_DONTNEED);
  }
};

// ctest zählt einen Absturz durch Signal nicht als erwartetes Rot (WILL_FAIL): der Test fängt das Signal und endet mit 139
void absturz(int) {
  static const char m[] = "SIGSEGV: ein Faden des Werks hat ein freigegebenes Audio gelesen (im Fehlerfall erwartet)\n";
  (void)!write(2, m, sizeof m - 1);
  _exit(139);
}

double rms(const std::vector<float>& l, int64_t a, int64_t b) {
  double s = 0.0;
  int64_t n = 0;
  for (int64_t i = std::max<int64_t>(a, 0); i < b && i < static_cast<int64_t>(l.size()); ++i, ++n) s += static_cast<double>(l[static_cast<size_t>(i)]) * static_cast<double>(l[static_cast<size_t>(i)]);
  return n ? std::sqrt(s / static_cast<double>(n)) : 0.0;
}

void fall(bool gleich) {
  Treiber t;
  PRUEF(t.mit_werk(2));
  Seite pa = Seite::neu(34 * FPB125, 1000.0), pb = Seite::neu(34 * FPB125, 1500.0);
  const auto bauen = [&](cdj::ArrAudio* au, float gain) {
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, au, 0, gain).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    au->ref += 1;   // der Cache zählt die Schnappschüsse, die ein Audio nennen
    return b.fertig();
  };
  t.laden(bauen(pa.a, 1.0f));
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  timespec nx;
  clock_gettime(CLOCK_MONOTONIC, &nx);
  const auto zyklus = [&]() {   // ein Zyklus des Callbacks in Echtzeit (256 Samples = 5,333 ms): die Fäden rechnen daneben
    nx.tv_nsec += 5333333;
    if (nx.tv_nsec >= 1000000000L) {
      nx.tv_nsec -= 1000000000L;
      ++nx.tv_sec;
    }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &nx, nullptr);
    t.lauf(t.s + 256);
  };
  for (int i = 0; i < 150; ++i) zyklus();   // 0,8 s spielen: die Stimme läuft, ihr Ring ist voraus
  PRUEF(t.arr.werk_stimmen() == 1);
  const int64_t s_t = t.s;   // der Tausch geschieht am Anfang des nächsten Zyklus
  const cdj::ArrSnapshot* alt = t.arr.tausche(gleich ? bauen(pa.a, 0.5f) : bauen(pb.a, 1.0f), t.s, t.k);
  PRUEF(alt != nullptr);
  bool frei = false;
  int64_t frei_s = -1;
  for (int i = 0; i < 80; ++i) {   // 0,43 s
    zyklus();
    // Lade-Faden-Ersatz (wie ArrLader::einmal und gib_wiedergabe): sobald das Werk den alten Schnappschuss nicht mehr liest, gibt er ihn zurück; ein Audio, das
    // keiner mehr nennt, wird freigegeben
    if (!frei && !t.werk->liest(alt)) {
      frei = true;
      frei_s = t.s;
      for (cdj::ArrAudio* x : alt->audios)
        if (--x->ref <= 0 && x == pa.a) pa.frei();
    }
  }
  const double pegel = rms(t.l, t.s - 4800, t.s);
  std::printf("Tausch %s: liest(alt) falsch bei Sample %lld (+%lld nach dem Tausch; die alte Stimme läuft bis +%d), Stimmen im Werk %d, RMS am Ende %.3f\n",
              gleich ? "mit gleichem Audio" : "mit anderer Quelle", static_cast<long long>(frei_s), static_cast<long long>(frei_s - s_t),
              cdj::ARR_WARP_FRIST + cdj::ARR_NAHT, t.arr.werk_stimmen(), pegel);
  PRUEF(frei);
  if (gleich) {
    PRUEF(frei_s - s_t < cdj::ARR_WARP_FRIST);   // das Audio bleibt im Cache: der alte Schnappschuss geht, sobald die offenen Aufträge übernommen sind, lange vor dem Ende der alten Stimme
  } else {
    PRUEF(frei_s - s_t >= cdj::ARR_WARP_FRIST + cdj::ARR_NAHT);   // nicht früher: bis dahin liest die alte Stimme aus ihrem Audio
    PRUEF(frei_s - s_t <= cdj::ARR_WARP_FRIST + cdj::ARR_NAHT + 40 * 256);   // und nicht ewig (0,2 s Spielraum für belegte Maschinen)
  }
  PRUEF(t.arr.werk_stimmen() == 1);   // nur die neue Stimme ist übrig
  PRUEF(pegel > 0.1);                 // die neue Quelle klingt (Sinus mit 0,4 oder 0,2: RMS 0,28 oder 0,14)
  t.alt.push_back(alt);
}

}  // namespace

int main() {
  std::signal(SIGSEGV, absturz);
  fall(false);
  fall(true);
  PRUEF_ENDE();
}
