// Paket 1.13 Warp, Slice 2 (AK15): Lebensdauer. Der Lade-Faden gibt einen abgelösten Schnappschuss erst frei, wenn das Warp-Werk ihn nicht mehr
// liest (WarpWerk::liest). Die Regel: ein Auftrag trägt Zeiger in den Schnappschuss, bis der Faden ihn übernommen hat; danach hält die Stimme ihr Audio
// (haelt), bis der Faden sie beendet, also auch zwischen zwei Blöcken und auch dann, wenn der Callback sie nicht beendet hat (ein Tausch mit anderer Quelle
// lässt die alte Stimme bis zur Überblendung weiterspielen). Das Audio jedes Schnappschusses liegt in eigenen Seiten (Kopf und Daten); „freigegeben“ heißt
// mprotect(PROT_NONE): ein Faden, der danach noch liest, stürzt ab (SIGSEGV), nicht erst bei einem späteren Zufall. Der Weg durch das echte Arrangement
// (Tausch mit anderer Quelle) steht in test_warp_werk_tausch_quelle.cpp.
//   1  Halt im Block     ein Faden bleibt im Block stehen (test_halte_block): liest() ist wahr, schon bevor der Callback die Stimme beendet; die Mutation
//                        HALTE_NACH_GELESEN (das Audio wird erst nach dem Übernehmen angemeldet) lässt dazwischen ein Fenster: rot
//   1b Stimme ohne gib   der Faden steht zwischen zwei Blöcken, der Callback hat nichts beendet: liest() bleibt wahr (die Mutation LIEST_OHNE_STIMME fragt nur
//                        Aufträge und Blöcke und wird rot); nach gib() wird es falsch; eine Stimme, die im Faden zu Ende ist (Clip-Ende), hält nichts mehr
//   2  Belastung         1000 Tausche mit drei Arbeitsfäden: der Callback (Hauptfaden) setzt für vier gewarpte Clips je Schnappschuss neue Stimmen an,
//                        beendet die des vorigen und reicht diesen an einen Lade-Faden-Ersatz, der ihn nur freigibt, wenn liest() false ist. Der Ersatz fragt
//                        gleich nach dem Tausch (die Fäden haben die Aufträge noch nicht übernommen) und in jedem Zyklus. Gezählt: wie oft liest() die
//                        Freigabe aufschob (die Prüfung greift: > 0) und wie viele Blöcke aus den Ringen kamen (die Stimmen rechnen wirklich; alle endlich).
// Mutation WARP_FREIGABE_OHNE_QUITTUNG: die Freigabe fragt nicht (der Test stürzt ab oder scheitert).
// Sanitizer: unter CYPHERDJ_SANITIZE (ASan) und CYPHERDJ_TSAN läuft dieselbe Datei ohne Befund (Task 4 des Plans).
#include <sys/mman.h>
#include <csignal>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <thread>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

namespace {

constexpr int64_t FPB125 = 23040;
constexpr int64_t SPB = arrtest::SPB;
constexpr int VIER = 4;

// Ein Audio in eigenen Seiten: Kopf (ArrAudio) und Daten; frei() sperrt sie so, dass jeder spätere Zugriff abstürzt
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
    float periode[480];   // eine Periode von 100 Hz · k, reihum wiederholt (billig genug für tausend Welten)
    for (int i = 0; i < 480; ++i) periode[i] = 0.4f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * (hz / 100.0) * i / 480.0));
    for (int64_t f = 0; f < frames; ++f) d[2 * f] = d[2 * f + 1] = periode[f % 480];
    s.a->daten = d;
    s.a->frames = frames;
    std::snprintf(s.a->sha256, sizeof s.a->sha256, "%064d", 0);
    return s;
  }
  void frei() {
    mprotect(basis, bytes, PROT_NONE);       // zuerst sperren: ab hier stürzt jeder Zugriff ab
    madvise(basis, bytes, MADV_DONTNEED);    // dann den Speicher hergeben
  }
};

struct Welt {   // ein Schnappschuss samt seinem Audio
  Seite audio[VIER];
  cdj::ArrSnapshot* snap = nullptr;
};

Welt* welt_bauen(int nr) {
  auto* w = new Welt();
  arrtest::Bau b(nr);
  for (int i = 0; i < VIER; ++i) {
    w->audio[i] = Seite::neu(9 * FPB125, 100.0 * (i + 1));   // ganze Vielfache von 100 Hz, damit die Periode passt
    b.spur(i + 1, cdj::ArrArt::audio).clip(i + 1, "c", 0.0, 8.0, w->audio[i].a).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  }
  w->snap = b.fertig();
  return w;
}

void welt_frei(Welt* w) {
  for (Seite& s : w->audio) s.frei();   // der Schnappschuss selbst bleibt (kleiner Speicher): der Test fasst ihn nach der Freigabe nicht mehr an
  delete w->snap;
  delete w;
}

}  // namespace

#ifdef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
// Im Fehlerfall stürzt der Faden an den gesperrten Seiten ab. ctest zählt einen Absturz durch Signal nicht als „erwartet rot“ (WILL_FAIL): darum fängt der Test das Signal und endet mit 139.
void absturz(int) {
  static const char m[] = "SIGSEGV: der Faden hat einen freigegebenen Schnappschuss gelesen (im Fehlerfall erwartet)\n";
  (void)!write(2, m, sizeof m - 1);
  _exit(139);
}
#endif

int main() {
#ifdef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
  std::signal(SIGSEGV, absturz);
#endif
  auto werk = cdj::warp_werk_neu({3});
  PRUEF(werk != nullptr);
  if (!werk) PRUEF_ENDE();
  {  // 1: die Stimme hält ihr Audio, auch wenn der Faden mitten im Block steht
    Welt* w0 = welt_bauen(0);
    const int p = werk->belege();
    cdj::WarpAnsatz a;
    a.clip = &w0->snap->spur[0].clips[0];
    a.s_h = 100000 + cdj::ARR_WARP_FRIST;
    a.s_ende = a.s_h + 8 * SPB;
    a.beat_versatz = -static_cast<double>(a.s_h) / static_cast<double>(SPB);
    a.karte = cdj::Karte(128.0, 0);
    PRUEF(!werk->liest(w0->snap));                                   // nichts im Gang
    werk->test_halte_block(true);
    werk->ansetzen(p, a);
    werk->takt(100000);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));      // der Auftrag ist übernommen, der Faden steht im Block
    PRUEF(werk->liest(w0->snap));                                    // ohne dass der Callback etwas beendet hätte: allein das Audio der Stimme hält ihn
    werk->gib(p);                                                    // der Callback beendet die Stimme: der Faden darf nach seinem Block nichts mehr lesen
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
#ifdef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
    welt_frei(w0);                                                   // Fehlerfall: ohne zu fragen; beim Weiterlaufen liest der Faden gesperrte Seiten
    werk->test_halte_block(false);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
#else
    PRUEF(werk->liest(w0->snap));                                    // der Faden steht noch im Block: das Audio ist angemeldet, bis er die Stimme beendet
    werk->test_halte_block(false);
    bool frei = false;
    for (int t = 0; t < 1000 && !frei; ++t) {
      werk->takt(100000);
      frei = !werk->liest(w0->snap);
      if (!frei) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    PRUEF(frei);                                                     // der Faden hat seinen Block beendet und die Stimme beendet (gib)
    welt_frei(w0);
#endif
  }
#ifndef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
  {  // 1b: eine Stimme ohne gib() liest weiter (Tausch mit anderer Quelle: die alte Stimme spielt bis zur Überblendung aus ihrem Ring und rechnet weiter)
    Welt* w1 = welt_bauen(0);
    const int p = werk->belege();
    cdj::WarpAnsatz a;
    a.clip = &w1->snap->spur[0].clips[0];
    a.s_h = 200000 + cdj::ARR_WARP_FRIST;
    a.s_ende = a.s_h + 8 * SPB;
    a.beat_versatz = -static_cast<double>(a.s_h) / static_cast<double>(SPB);
    a.karte = cdj::Karte(128.0, 0);
    werk->ansetzen(p, a);
    werk->takt(200000);
    long vorrat = 0;
    for (int t = 0; t < 3000 && vorrat < cdj::ARR_WARP_VORLAUF - cdj::ARR_WARP_FRIST - 512; ++t) {   // bis der Faden seinen Vorlauf geschrieben hat und zwischen zwei Blöcken steht
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      werk->takt(200000);
      vorrat = static_cast<long>(werk->ring(p).verfuegbar(a.s_h));
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    PRUEF(vorrat >= cdj::ARR_WARP_VORLAUF - cdj::ARR_WARP_FRIST - 512);
    PRUEF(werk->liest(w1->snap));                                    // kein Auftrag offen, kein Faden im Block, nichts beendet: die Stimme hält ihr Audio
    werk->gib(p);                                                    // der Callback beendet die Stimme (nach der Überblendung)
    bool frei = false;
    for (int t = 0; t < 1000 && !frei; ++t) {
      werk->takt(200000);
      frei = !werk->liest(w1->snap);
      if (!frei) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    PRUEF(frei);
    // eine Stimme, die im Faden zu Ende ist (Clip-Ende nach 512 Frames), hält ihr Audio nicht länger, auch ohne gib()
    const int q = werk->belege();
    cdj::WarpAnsatz b = a;
    b.s_h = 300000 + cdj::ARR_WARP_FRIST;
    b.s_ende = b.s_h + 512;
    werk->ansetzen(q, b);
    bool zu_ende = false;
    for (int t = 0; t < 3000 && !zu_ende; ++t) {
      werk->takt(300000);
      zu_ende = werk->ende_s(q) != INT64_MAX;
      if (!zu_ende) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    PRUEF(zu_ende);
    PRUEF(!werk->liest(w1->snap));
    werk->gib(q);
    welt_frei(w1);
  }
#endif
  std::vector<Welt*> wartend;      // abgelöst, aber noch nicht freigegeben
  int stimme[VIER];
  std::fill(stimme, stimme + VIER, -1);
  Welt* aktuell = nullptr;
  int64_t s_jetzt = 100000;
  long aufgeschoben = 0, freigegeben = 0, gelesen_bloecke = 0, nan_bloecke = 0;
  const auto versuche_frei = [&](bool alles) {
    for (size_t i = 0; i < wartend.size();) {
      bool darf = true;
#ifndef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
      darf = !werk->liest(wartend[i]->snap);
#endif
      if (!darf) {
        ++aufgeschoben;
        ++i;
        continue;
      }
      welt_frei(wartend[i]);
      wartend.erase(wartend.begin() + static_cast<long>(i));
      ++freigegeben;
    }
    (void)alles;
  };
  for (int i = 0; i < 1000; ++i) {
    // Zeit vergeht: ein Zyklus des Callbacks, die Fäden rechnen; danach versucht der Lade-Faden-Ersatz freizugeben, was nicht mehr gelesen wird
    s_jetzt += 256;
    werk->takt(s_jetzt);
    versuche_frei(false);
    Welt* neu = welt_bauen(i + 1);
    s_jetzt += 8192;   // der Callback ist ein Stück weitergelaufen: die Fäden rechnen die alten Stimmen voraus (32 Blöcke je Stimme), während gleich getauscht wird
    werk->takt(s_jetzt);
    std::this_thread::sleep_for(std::chrono::microseconds(300));
    const int64_t sh = s_jetzt + cdj::ARR_WARP_FRIST;   // Ziel-Sample aller vier Stimmen dieses Schnappschusses
    for (int k = 0; k < VIER; ++k) {   // der Tausch: die Stimmen des alten Schnappschusses enden, neue setzen an
      if (stimme[k] >= 0) werk->gib(stimme[k]);
      stimme[k] = werk->belege();
      PRUEF(stimme[k] >= 0);
      cdj::WarpAnsatz a;
      a.clip = &neu->snap->spur[k].clips[0];
      a.s_h = sh;
      a.s_ende = a.s_h + 8 * SPB;
      a.beat_versatz = -static_cast<double>(a.s_h) / static_cast<double>(SPB);
      a.karte = cdj::Karte(128.0, 0);
      werk->ansetzen(stimme[k], a);
    }
    if (aktuell) wartend.push_back(aktuell);   // abgelöst: der Callback meldet ihn (ARR_ALT) an den Lade-Faden
    aktuell = neu;
    versuche_frei(false);   // gleich nach dem Tausch: die Fäden haben die Aufträge noch nicht übernommen. Im Fehlerfall ohne zu fragen: ein Faden mitten im Block liest das gesperrte Audio
    for (int z = 0; z < 3; ++z) {   // aus den Ringen lesen, was da ist
      long pause_us = 1000;
#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
      if (z == 0 && i % 20 == 0) pause_us = 400000;   // unter einem Sanitizer braucht eine Stimme für ihren Vorlauf Zehntelsekunden; sonst überholt jeder Tausch den vorigen und kein Block entsteht
#endif
      std::this_thread::sleep_for(std::chrono::microseconds(pause_us));
      s_jetzt += 256;
      werk->takt(s_jetzt);
      for (int k = 0; k < VIER; ++k) {
        float l[256], r[256];
        if (werk->ring(stimme[k]).lies(sh + 256 * z, 256, l, r)) {
          ++gelesen_bloecke;
          for (int j = 0; j < 256; ++j)
            if (!std::isfinite(l[j]) || std::fabs(l[j]) > 2.0f) {
              ++nan_bloecke;
              break;
            }
        }
      }
    }
  }
  for (int k = 0; k < VIER; ++k) werk->gib(stimme[k]);
  for (int t = 0; t < 2000 && !wartend.empty(); ++t) {   // der Lade-Faden-Ersatz wartet, höchstens 2 s
    werk->takt(s_jetzt);
    versuche_frei(true);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  PRUEF(wartend.empty());
  werk->stoppe();
  welt_frei(aktuell);
  std::printf("1000 Tausche: %ld freigegeben, %ld Freigaben aufgeschoben (liest), %ld Blöcke aus den Ringen, %ld mit Unsinn\n", freigegeben,
              aufgeschoben, gelesen_bloecke, nan_bloecke);
  PRUEF(freigegeben == 999);   // 1000 Schnappschüsse, der letzte wird nach dem Stopp der Fäden freigegeben
#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
  PRUEF(gelesen_bloecke > 0);     // unter einem Sanitizer rechnen die Fäden zehnmal langsamer; geprüft wird hier, dass sie ohne Befund laufen
#else
  PRUEF(gelesen_bloecke > 100);
#endif
  PRUEF(nan_bloecke == 0);
#ifndef CYPHERDJ_MUTATION_WARP_FREIGABE_OHNE_QUITTUNG
  PRUEF(aufgeschoben >= 100);   // Positivkontrolle: die Prüfung greift bei jedem Tausch, nicht nur zufällig (gemessen 1 000 von 1 000; die erste Fassung fragte spät: 1)
#endif
  PRUEF_ENDE();
}
