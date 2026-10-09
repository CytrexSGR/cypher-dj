// Scheibe 31: die Decks im Kern (SCHNITTSTELLEN.md §4.4, §5.5, §5.9, §6.3, §6.4, §13.1, §13.2, §16.1, §16.2).
// Befehle /k/deck/laden, entladen, start, stopp werden am Blockanfang einsortiert; Laden geht über einen Ring an den
// Lade-Faden (lader.h) und kommt als eingeblendetes, geprüftes Material zurück; start und stopp wirken am Sample ihres
// Ziel-Beats, auch mitten im Block (der Kern teilt den Block dort). Das Deck liest im Direktweg ohne Stretcher (ADR 020);
// eine Tempo-Änderung bei laufendem Deck wird abgelehnt (kein_stretcher), bis Scheibe 50 den Stretcher-Weg baut.
// Keine Allokation, keine Sperre, kein I/O im Callback. Die Decks im Neustart-Zustand: kern_deck_zustand.cpp.
#include <errno.h>
#include <pthread.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sched.h>
#include <semaphore.h>
#include <time.h>

#include <algorithm>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstring>

#include <cypherdj/dsp/werte.h>

#include "cypherdj/kern.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;
namespace dsp = cypherdj::dsp;

namespace {

constexpr double FRIST_BEATS[4] = {128.0, 64.0, 32.0, 16.0};  // §5.9 /e/frist

void kopiere(char* ziel, const char* quelle, size_t n) {
  size_t i = 0;
  if (quelle)
    for (; i + 1 < n && quelle[i]; ++i) ziel[i] = quelle[i];
  ziel[i] = '\0';
}

bool ist_cypher(const char* q) { return !std::strcmp(q, "cypher"); }

}  // namespace

// §5.9: nach jedem neuen Lesekopf (start, Plan E9: sprung, hotcue) gelten nur die Schwellen als vorbei, die der Rest
// schon unterschreitet; die übrigen werden gemeldet, wenn sie fallen (Plan-Review E9 Befund 3).
static void frist_neu(DeckWerk& w, int d, int64_t s) {
  const double rest = w.deck[d].beats_bis_ende_bei(s);
  w.frist_gemeldet[d] = 0;
  for (int i = 0; i < 4; ++i)
    if (rest <= FRIST_BEATS[i]) w.frist_gemeldet[d] |= static_cast<uint8_t>(1u << i);
}

void Kern::decks_anlegen() {
  decks_ = std::make_unique<DeckWerk>();
  DeckWerk& w = *decks_;
  // Welle 3: Lesekopf am Beat der Kern-Uhr (Adresse fest, tempoplan.h); Keylock: mit dem Zähler der Karte (Vertrag 10)
  for (Deck& dk : w.deck) dk.setze_karte(&plan_.karte(), plan_.generation_zeiger());
  loops_->setze_karte(&plan_.karte(), plan_.generation_zeiger());  // Task 7: dieselbe Karte wie block() (T11)
  const sw::ReglerTabelle& tab = sw_->tabelle();
  char p[64];
  auto such = [&](const char* fmt, int n, const char* rest) {
    std::snprintf(p, sizeof p, fmt, n, rest);
    return static_cast<int16_t>(tab.suche(p));
  };
  for (int d = 0; d < DECKS; ++d) {
    DeckRegler& r = w.reg[d];
    r.trim = such("deck/%d/%s", d + 1, "trim");
    r.fader = such("deck/%d/%s", d + 1, "fader");
    r.pfl = such("deck/%d/%s", d + 1, "pfl");
    r.ziel = such("deck/%d/%s", d + 1, "ziel");
    r.xseite = such("deck/%d/%s", d + 1, "xseite");
    for (int k = 0; k < STEM_ANZAHL; ++k) {
      char rest[16];
      std::snprintf(rest, sizeof rest, "stem/%s", STEM_NAMEN[k]);
      r.stem[k] = such("deck/%d/%s", d + 1, rest);
      if (r.stem[k] >= 0 && r.stem[k] < cypherdj::stellwerk::MAX_REGLER) {
        w.stem_deck[r.stem[k]] = static_cast<int8_t>(d);
        w.stem_nr[r.stem[k]] = static_cast<int8_t>(k);
      }
    }
  }
  for (int b = 0; b < 4; ++b) {
    w.bus_fader[b] = such("bus/%d/%s", b + 1, "fader");
    w.bus_xseite[b] = such("bus/%d/%s", b + 1, "xseite");
  }
  w.xfader = static_cast<int16_t>(tab.suche("xfader"));
  w.master_pegel = static_cast<int16_t>(tab.suche("master/pegel"));
  w.knopf_regler = static_cast<int16_t>(tab.suche("keylock"));  // Keylock Task 3
}

namespace {
DehnerOptionen dehner_optionen(const DeckWerk& w) {
  DehnerOptionen o;
  o.maschine = w.maschine;
  o.bungee_fein = w.bungee_fein;
  return o;
}
}  // namespace

void Kern::setze_keylock_maschine(DehnerMaschine m, bool fein) noexcept {
  decks_->maschine = m;
  decks_->bungee_fein = fein;
}

// Prüfung m5 (Nachprüfung): legt die Dehner an (Allokation, nicht im Callback) und STELLT sie nur bereit; an die Decks
// hängt sie der nächste zyklus() selbst (keylock_uebernehmen), so fasst kein anderer Faden die Decks an. Gilt nur vor dem
// ersten zyklus(): danach, oder während ein anderer Aufruf baut, false und nichts geändert (zur Laufzeit: Deck::keylock,
// Task 3). Läuft der erste Zyklus, während hier gebaut wird, übernimmt ihn der darauf folgende.
bool Kern::setze_keylock_vorgabe(bool an) {
  DeckWerk& w = *decks_;
  int frei = 0;
  if (!w.keylock_stand.compare_exchange_strong(frei, 3, std::memory_order_acq_rel)) {
    std::fprintf(stderr, "Kern: setze_keylock_vorgabe abgelehnt (nur einmal und vor dem Start)\n");
    return false;
  }
  w.keylock_soll = an;
  if (an)
    for (int d = 0; d < KEYLOCK_QUELLEN; ++d)  // Task 7: auch die Loop-Boxen (Quelle 5 und 6)
      if (!w.dehner[d]) w.dehner[d] = dehner_neu(d + 1, dehner_optionen(w));
  w.antrieb_sync = w.maschine == DehnerMaschine::Bungee;
  w.keylock_stand.store(1, std::memory_order_release);
  return true;
}

// Im Callback, am Anfang von zyklus(): eine gestellte Vorgabe an die Decks hängen; sonst ab jetzt sperren. Stand 4
// (keylock_ankuendigen, Betrieb): bleibt offen, bis keylock_bauen 1 (Dehner und Fäden fertig) oder 2 (aus) stellt.
void Kern::keylock_uebernehmen() noexcept {
  DeckWerk& w = *decks_;
  int st = w.keylock_stand.load(std::memory_order_acquire);
  if (st == 0 && w.keylock_stand.compare_exchange_strong(st, 2, std::memory_order_acq_rel)) return;  // nie gestellt: sperren
  if (st != 1) return;  // 2 schon übernommen; 3 setze baut gerade, 4 keylock_bauen baut: in einem späteren Zyklus
  const bool an = w.keylock_soll;
  for (int d = 0; d < DECKS; ++d) {
    if (an && w.dehner[d]) w.deck[d].setze_keylock(w.dehner[d].get(), &w.post[d]);
#ifdef CYPHERDJ_MUTATION_KEYLOCK_UEBERNEHMEN_OHNE_KNOPF
    w.deck[d].keylock(sample_, an);  // Fehlerfall: das späte Anhängen übersieht einen Knopf, der schon aus steht
#else
    w.deck[d].keylock(sample_, an && w.knopf);  // Keylock Task 3: der Regler keylock gilt auch für das späte Anhängen
#endif
  }
  for (int b = 0; b < LOOP_BOXEN; ++b)  // Task 7 (7a 3.6): die Boxen am Dehner ihrer Quelle; eine spielende setzt neu an
    if (an && w.dehner[DECKS + b]) loops_->setze_keylock(b + 1, w.dehner[DECKS + b].get(), &w.post[DECKS + b]);  // (der Schalter der Boxen steht schon: keylock_verlauf setzt ihn auch ohne Dehner, Task 3)
  w.keylock_vorgabe = an;
  if (an) w.keylock_ab = sample_;
  w.keylock_stand.store(2, std::memory_order_release);
}

// Task 2.5b (Prüfung F2): im Betrieb entstehen die Dehner NICHT im Startpfad (4 Dehner kosten 263 bis 273 ms, gemessen,
// task-025-pruefung/qualitaet/p_zeit.txt; das wäre Stille nach jedem Start und Neustart). keylock_ankuendigen() vor dem
// ersten Zyklus hält den Platz offen (Stand 4), die Decks spielen bis dahin Varispeed; keylock_bauen() baut danach in
// einem Nicht-Echtzeit-Faden. Prüfung F1: erst Dehner und Fäden, dann die Vorgabe; ist ein Faden nicht anlegbar, gibt es
// KEINEN Dehner an den Decks (Keylock wirklich aus, Laden und Entladen quittieren wie ohne Keylock).
bool Kern::keylock_ankuendigen() {
  int frei = 0;
  if (decks_->keylock_stand.compare_exchange_strong(frei, 4, std::memory_order_acq_rel)) return true;
  std::fprintf(stderr, "Kern: keylock_ankuendigen abgelehnt (nur einmal und vor dem Start)\n");
  return false;
}

// Task 2.5c (Nachprüfung 2.5b): nur den Speicher sperren, den der Bau anlegt, statt mlockall(MCL_CURRENT) (das sperrte
// Stapel fremder Fäden und Arena-Reserven, +74 828 KiB VmLck, und nahm dem mlock des Laders das Budget). Rubber Band legt
// seine Puffer selbst an (malloc, posix_memalign), ihre Adressen kennt nur es; darum: anonyme rw-Bereiche, die der Bau
// neu angelegt oder vergrößert hat (Vergleich von /proc/self/maps vorher und nachher), davon nur die residenten Seiten
// (mincore: was der Bau samt warm() berührt hat), dazu die Stapel der Keylock-Fäden ganz (KEYLOCK_STAPEL je Faden).
namespace {
struct KlBereich {
  uintptr_t a, e;
};
std::vector<KlBereich> kl_anon_rw() {  // rw, ohne Datei (inode 0), ohne Pfad oder [heap]; PROT_NONE-Reserven nicht
  std::vector<KlBereich> v;
  FILE* f = std::fopen("/proc/self/maps", "r");
  if (!f) return v;
  char z[512];
  while (std::fgets(z, sizeof z, f)) {
    unsigned long a = 0, e = 0, off = 0, ino = 0;
    char perm[8] = "", dev[16] = "", pfad[256] = "";
    if (std::sscanf(z, "%lx-%lx %7s %lx %15s %lu %255s", &a, &e, perm, &off, dev, &ino, pfad) < 6) continue;
    if (perm[0] != 'r' || perm[1] != 'w' || ino != 0) continue;
    if (pfad[0] && std::strcmp(pfad, "[heap]") != 0) continue;
    v.push_back({static_cast<uintptr_t>(a), static_cast<uintptr_t>(e)});
  }
  std::fclose(f);
  return v;
}
// residente Seiten in [a, e) sperren; Rückgabe gesperrte Bytes, der erste Fehler in fehler (errno)
uint64_t kl_sperre_resident(uintptr_t a, uintptr_t e, int& fehler) {
  const uintptr_t seite = static_cast<uintptr_t>(sysconf(_SC_PAGESIZE));
  const size_t n = (e - a) / seite;
  std::vector<unsigned char> res(n);
  if (n == 0 || mincore(reinterpret_cast<void*>(a), e - a, res.data()) != 0) return 0;
  uint64_t summe = 0;
  for (size_t i = 0; i < n;) {
    if (!(res[i] & 1)) {
      ++i;
      continue;
    }
    size_t j = i;
    while (j < n && (res[j] & 1)) ++j;
    if (mlock(reinterpret_cast<void*>(a + i * seite), (j - i) * seite) == 0) summe += (j - i) * seite;
    else if (!fehler) fehler = errno;
    i = j;
  }
  return summe;
}
}  // namespace

void Kern::keylock_sperren(const std::vector<KlBereichRoh>& vorher) {
  DeckWerk& w = *decks_;
  int fehler = 0;
  uint64_t summe = 0;
  for (const KlBereich& b : kl_anon_rw()) {
    uintptr_t a = b.a;  // die Teile von b, die vorher kein Bereich deckte (vorher ist nach a sortiert)
    for (const KlBereichRoh& v : vorher) {
      if (v.e <= a || v.a >= b.e) continue;
      if (v.a > a) summe += kl_sperre_resident(a, v.a, fehler);
      a = std::max(a, v.e);
      if (a >= b.e) break;
    }
    if (a < b.e) summe += kl_sperre_resident(a, b.e, fehler);
  }
  KeylockFaeden& f = w.faeden;
  for (int i = 0; i < KEYLOCK_FAEDEN; ++i) {  // Stapel der Keylock-Fäden ganz: Echtzeit-Fäden ohne Seitenfehler
    if (!f.an[i]) continue;
    pthread_attr_t at;
    void* p = nullptr;
    size_t g = 0;
    if (pthread_getattr_np(f.t[i], &at) != 0) continue;
    if (pthread_attr_getstack(&at, &p, &g) == 0) {
      if (mlock(p, g) == 0) summe += g;
      else if (!fehler) fehler = errno;
    }
    pthread_attr_destroy(&at);
  }
  w.keylock_gesperrt = summe;
  w.keylock_sperr_fehler = fehler;
  if (fehler)
    std::fprintf(stderr, "Keylock: Dehner-Speicher nicht ganz sperrbar (%s), %llu KiB gesperrt; der Keylock läuft, ungesperrte "
                         "Seiten können im Arbeits-Thread Seitenfehler kosten (RLIMIT_MEMLOCK prüfen)\n",
                 std::strerror(fehler), static_cast<unsigned long long>(summe >> 10));
  else
    std::fprintf(stderr, "Keylock: %llu KiB gesperrt (Dehner und Stapel der Keylock-Fäden)\n",
                 static_cast<unsigned long long>(summe >> 10));
}

uint64_t Kern::keylock_gesperrt() const noexcept { return decks_->keylock_gesperrt; }
int Kern::keylock_sperr_fehler() const noexcept { return decks_->keylock_sperr_fehler; }

bool Kern::keylock_bauen(int jack_prio, bool sperren) {
  DeckWerk& w = *decks_;
  if (w.keylock_stand.load(std::memory_order_acquire) != 4) {
    std::fprintf(stderr, "Kern: keylock_bauen ohne keylock_ankuendigen, Keylock bleibt aus\n");
    return false;
  }
  std::vector<KlBereichRoh> vorher;
  if (sperren) {
    for (const KlBereich& b : kl_anon_rw()) vorher.push_back({b.a, b.e});
    std::sort(vorher.begin(), vorher.end(), [](const KlBereichRoh& x, const KlBereichRoh& y) { return x.a < y.a; });
  }
  for (int d = 0; d < KEYLOCK_QUELLEN; ++d) w.dehner[d] = dehner_neu(d + 1, dehner_optionen(w));  // liest bis Stand 1 niemand (Fäden noch nicht da)
  bool ein_dehner = false;
  for (const auto& dh : w.dehner) ein_dehner = ein_dehner || dh != nullptr;
  const bool synchron = w.maschine == DehnerMaschine::Bungee;  // Bungee: der Callback fährt alles selbst, kein Faden
#ifdef CYPHERDJ_MUTATION_KEYLOCK_VORGABE_VOR_FAEDEN
  const bool faeden = (keylock_faeden_starten(), true);  // Fehlerfall (Stand 2.5): Vorgabe auch ohne Fäden
#else
  const bool faeden = ein_dehner && (synchron || keylock_faeden_starten());
#endif
  if (!faeden) {
    decks_->faeden.stoppe();
    for (auto& dh : w.dehner) dh.reset();  // kein Faden liest mehr, kein Deck hält sie
    w.keylock_soll = false;
    w.keylock_stand.store(2, std::memory_order_release);
    std::fprintf(stderr, ein_dehner ? "Keylock aus: Fäden nicht anlegbar, Dehner abgebaut, die Decks spielen Varispeed\n"
                                    : "Keylock aus: kein Dehner (ohne Rubber Band gebaut), die Decks spielen Varispeed\n");
    return false;
  }
  if (jack_prio > 0) keylock_prioritaet(jack_prio);
  if (sperren) keylock_sperren(vorher);  // vor dem Anhängen: der Callback liest den Ring erst danach
  w.keylock_soll = true;
  w.antrieb_sync = synchron;
  w.keylock_stand.store(1, std::memory_order_release);  // der nächste Zyklus hängt die Dehner an (keylock_uebernehmen)
  return true;
}

int64_t Kern::keylock_ab() const noexcept { return decks_->keylock_ab; }

bool Kern::keylock_vorgabe() const noexcept { return decks_->keylock_vorgabe; }

void Kern::keylock_vorbereiten() {
  DeckWerk& w = *decks_;
  if (w.faeden.laeuft.load(std::memory_order_acquire)) return;  // Task 2.5: dann tut es der Vorbereiter-Faden
  for (int d = 0; d < KEYLOCK_QUELLEN; ++d)
    if (w.dehner[d]) w.post[d].takt(*w.dehner[d]);
}

void Kern::keylock_fuellen(int deck) {
  DeckWerk& w = *decks_;
  if (w.faeden.laeuft.load(std::memory_order_acquire)) return;  // Task 2.5: dann tut es der Arbeits-Thread
  if (deck >= 1 && deck <= KEYLOCK_QUELLEN && w.dehner[deck - 1]) w.dehner[deck - 1]->fuelle_synchron();
}

// ------------------------------------------------------------------------------------------------ Keylock Task 2.5
// Die Fäden (deck_werk.h KeylockFaeden; Vorlage M3 m3deck.cpp arbeiter und lade_faden): jeder wartet auf seinen Wecker
// (der Callback weckt je Zyklus, keylock_wecken) höchstens KEYLOCK_TAKT_MS und arbeitet dann. Kein Faden fasst ein Deck
// an: der Vorbereiter nur Post und Dehner (StreckPost::takt), der Arbeits-Thread nur seinen Dehner (fuelle_synchron), der
// Wächter nur die Atome des Dehners und die Herzschläge.
namespace {

int64_t kl_jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

// Warten auf den Wecker, höchstens ms; danach den Wecker leeren (mehrfach geweckt = einmal arbeiten).
void kl_warte(sem_t* s, int ms) {
#ifdef CYPHERDJ_MUTATION_KEYLOCK_STOPP_OHNE_WECKEN
  (void)ms;  // Fehlerfall: ohne Frist, und stoppe() weckt nicht: ohne Callback wartet der Faden für immer
  while (sem_wait(s) != 0 && errno == EINTR) {
  }
#else
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);  // Prüfung F3: monoton, ein Sprung der Wanduhr verlängert das Warten nicht
  t.tv_nsec += static_cast<long>(ms) * 1000000L;
  while (t.tv_nsec >= 1000000000L) {
    t.tv_nsec -= 1000000000L;
    ++t.tv_sec;
  }
  while (sem_clockwait(s, CLOCK_MONOTONIC, &t) != 0 && errno == EINTR) {
  }
#endif
  while (sem_trywait(s) == 0) {
  }
}

// Wecken aus dem Callback: wartefrei (sem_getvalue liest nur, sem_post blockiert nie); höchstens ein Wecker steht an.
inline void kl_wecke(sem_t* s) noexcept {
  int v = 0;
  if (sem_getvalue(s, &v) == 0 && v > 0) return;
  sem_post(s);
}

void kl_vorbereiter(DeckWerk& w) {
  KeylockFaeden& f = w.faeden;
  while (!f.stop.load(std::memory_order_acquire)) {
    kl_warte(&f.sem[0], KEYLOCK_TAKT_MS);
    if (f.stop.load(std::memory_order_acquire)) break;
    for (int d = 0; d < KEYLOCK_QUELLEN; ++d) {
      if (!w.dehner[d]) continue;
      const uint64_t vor = w.post[d].antwort();
      w.post[d].takt(*w.dehner[d]);
      if (w.post[d].antwort() != vor) kl_wecke(&f.sem[1 + d]);  // neuer Ansatz: der Arbeits-Thread übernimmt sofort
    }
    f.herz[0].fetch_add(1, std::memory_order_relaxed);
  }
}

// Fassung 4.1 Punkt 2 (Pflicht, Nachprüfung N3): fuelle_synchron in JEDEM Takt, auch wenn das Deck steht, leer ist oder
// der Keylock aus ist. Nur so übernimmt und quittiert der Thread die Leer-Epoche (Vertrag 4, 18); der R3 ruht dabei
// trotzdem (die Leer-Epoche hat kein Band, fuelle kehrt nach dem Übernehmen zurück).
void kl_arbeiter(DeckWerk& w, int d) {
  KeylockFaeden& f = w.faeden;
  DehnerBasis& dh = *w.dehner[d];
  while (!f.stop.load(std::memory_order_acquire)) {
    kl_warte(&f.sem[1 + d], KEYLOCK_TAKT_MS);
    if (f.stop.load(std::memory_order_acquire)) break;
    if (f.halte[d].load(std::memory_order_acquire)) continue;  // nur Tests (keylock_test_halte)
#ifdef CYPHERDJ_MUTATION_KEYLOCK_FADEN_HAELT
    if (d == 0 && f.herz[1].load(std::memory_order_relaxed) >= 200) continue;  // Fehlerfall: Deck 1 hält nach rund 1 s an
#endif
#ifdef CYPHERDJ_MUTATION_KEYLOCK_FUELLE_NUR_LAUFEND
    if (!f.spielt[d].load(std::memory_order_relaxed)) continue;  // Fehlerfall: Pflicht verletzt, im Stand kein fuelle
#endif
    dh.fuelle_synchron();
    dh.fuelle_synchron();  // bricht die erste bei wartendem Ansatz ab (dehner.cpp), übernimmt ihn die zweite gleich
    f.herz[1 + d].fetch_add(1, std::memory_order_relaxed);
  }
}

// Wächter (Fassung 4.1 Punkt 2): ein Arbeits-Thread, der eine vergebene Epoche nicht binnen der Frist quittiert (die Uhr
// läuft ab der letzten Änderung von quittiert_e, nicht ab der letzten Vergabe: neue Ereignisse verlängern sie nicht), und
// ein Vorbereiter ohne Durchgang binnen der Frist. Je Fall eine stderr-Zeile und ein Zähler, eine Entwarnung, wenn er
// wieder läuft. Der Wächter selbst bleibt SCHED_OTHER und ist der einzige Faden des Keylocks, der schreibt (stderr).
void kl_waechter(DeckWerk& w) {
  KeylockFaeden& f = w.faeden;
  constexpr int64_t FRIST = static_cast<int64_t>(KEYLOCK_WAECHTER_FRIST_MS) * 1000000LL;
  struct Offen {
    bool offen = false, gemeldet = false;
    uint32_t q = EPOCHE_KEINE;
    int64_t seit = 0;
  } o[KEYLOCK_QUELLEN];
  uint64_t herz_vor = f.herz[0].load(std::memory_order_relaxed);
  int64_t herz_seit = kl_jetzt_ns();
  bool vor_gemeldet = false;
  while (!f.stop.load(std::memory_order_acquire)) {
    kl_warte(&f.sem[KEYLOCK_FAEDEN - 1], KEYLOCK_WAECHTER_TAKT_MS);
    if (f.stop.load(std::memory_order_acquire)) break;
    f.herz[KEYLOCK_FAEDEN - 1].fetch_add(1, std::memory_order_relaxed);
#ifndef CYPHERDJ_MUTATION_KEYLOCK_OHNE_WAECHTER
    const int64_t jetzt = kl_jetzt_ns();
    for (int d = 0; d < KEYLOCK_QUELLEN; ++d) {
      const DehnerBasis* dh = w.dehner[d].get();
      if (!dh) continue;
      const uint32_t e = dh->epoche(), q = dh->quittiert_e();
      Offen& x = o[d];
      if (e != q) {
        if (!x.offen || x.q != q) {
          x.offen = true;
          x.gemeldet = false;
          x.q = q;
          x.seit = jetzt;
        } else if (!x.gemeldet && jetzt - x.seit > FRIST) {
          x.gemeldet = true;
          f.waechter_meldungen.fetch_add(1, std::memory_order_relaxed);
          std::fprintf(stderr,
                       "Keylock-Wächter: Arbeits-Thread %s %d quittiert seit %lld ms nicht (Epoche %u vergeben, %u "
                       "quittiert); %s\n",
                       d < DECKS ? "Deck" : "Box", d < DECKS ? d + 1 : d + 1 - DECKS, static_cast<long long>((jetzt - x.seit) / 1000000LL), e, q,
                       d < DECKS ? "Laden und Entladen dieser Quelle warten"
                                 : "abgelöste Loops dieser Box kommen erst nach der Quittung zurück");  // E-m9: Boxen warten nicht
        }
      } else {
        if (x.gemeldet)
          std::fprintf(stderr, "Keylock-Wächter: Arbeits-Thread %s %d quittiert wieder (Epoche %u) nach %lld ms\n",
                       d < DECKS ? "Deck" : "Box", d < DECKS ? d + 1 : d + 1 - DECKS, q, static_cast<long long>((jetzt - x.seit) / 1000000LL));
        x.offen = x.gemeldet = false;
      }
    }
    const uint64_t h = f.herz[0].load(std::memory_order_relaxed);
    if (h != herz_vor) {
      if (vor_gemeldet) std::fprintf(stderr, "Keylock-Wächter: Vorbereiter läuft wieder\n");
      herz_vor = h;
      herz_seit = jetzt;
      vor_gemeldet = false;
    } else if (!vor_gemeldet && jetzt - herz_seit > FRIST) {
      vor_gemeldet = true;
      f.waechter_meldungen.fetch_add(1, std::memory_order_relaxed);
      std::fprintf(stderr, "Keylock-Wächter: Vorbereiter seit %lld ms ohne Durchgang; Ansätze aller Decks warten\n",
                   static_cast<long long>((jetzt - herz_seit) / 1000000LL));
    }
#endif
  }
}

void* kl_faden(void* p) {
  const KeylockFaeden::Start& s = *static_cast<const KeylockFaeden::Start*>(p);
  DeckWerk& w = *static_cast<DeckWerk*>(s.werk);
  char name[32];  // Namen bis 15 Zeichen (pthread_setname_np)
  if (s.platz == 0) {
    std::snprintf(name, sizeof name, "kl-vorbereiter");
    pthread_setname_np(pthread_self(), name);
    kl_vorbereiter(w);
  } else if (s.platz <= KEYLOCK_QUELLEN) {
    std::snprintf(name, sizeof name, "kl-arbeit-%d", s.platz);
    pthread_setname_np(pthread_self(), name);
    kl_arbeiter(w, s.platz - 1);
  } else {
    std::snprintf(name, sizeof name, "kl-waechter");
    pthread_setname_np(pthread_self(), name);
    kl_waechter(w);
  }
  return nullptr;
}

const char* kl_name(int platz, char* b, size_t n) {
  if (platz == 0) std::snprintf(b, n, "Vorbereiter");
  else if (platz <= DECKS) std::snprintf(b, n, "Arbeits-Thread Deck %d", platz);
  else if (platz <= KEYLOCK_QUELLEN) std::snprintf(b, n, "Arbeits-Thread Box %d", platz - DECKS);
  else std::snprintf(b, n, "Wächter");
  return b;
}

}  // namespace

bool Kern::keylock_faeden_starten() {
  DeckWerk& w = *decks_;
  KeylockFaeden& f = w.faeden;
  if (f.laeuft.load(std::memory_order_acquire)) return true;
  bool ein_dehner = false;
  for (const auto& dh : w.dehner) ein_dehner = ein_dehner || dh != nullptr;
  if (!ein_dehner) return false;  // Keylock aus oder Stub: nichts zu fahren
  f.stop.store(false, std::memory_order_release);
  pthread_attr_t at;
  pthread_attr_init(&at);
  pthread_attr_setstacksize(&at, KEYLOCK_STAPEL);
  bool ok = true;
  for (int i = 0; i < KEYLOCK_FAEDEN && ok; ++i) {
    if (i >= 1 && i <= KEYLOCK_QUELLEN && !w.dehner[i - 1]) continue;
    f.start[i] = {&w, i};
    const int r = pthread_create(&f.t[i], &at, kl_faden, &f.start[i]);
    if (r != 0) {
      char b[48];
      std::fprintf(stderr, "Keylock: %s nicht anlegbar (%s), keine Keylock-Fäden\n", kl_name(i, b, sizeof b), std::strerror(r));
      ok = false;
    } else {
      f.an[i] = true;
    }
  }
  pthread_attr_destroy(&at);
  if (!ok) {
    f.stoppe();
    return false;
  }
  f.laeuft.store(true, std::memory_order_release);
  return true;
}

// Vertrag 12: SCHED_FIFO mit JACK-Priorität − 5 für Vorbereiter und Arbeits-Threads (der Wächter bleibt SCHED_OTHER).
int Kern::keylock_prioritaet(int jack_prio) {
  KeylockFaeden& f = decks_->faeden;
  if (!f.laeuft.load(std::memory_order_acquire) || jack_prio <= 0) return 0;
  sched_param sp{};
  sp.sched_priority = std::max(1, jack_prio - 5);
  int fehl = 0, gesetzt = 0;
  for (int i = 0; i <= KEYLOCK_QUELLEN; ++i) {
    if (!f.an[i]) continue;
    const int r = pthread_setschedparam(f.t[i], SCHED_FIFO, &sp);
#ifdef CYPHERDJ_MUTATION_KEYLOCK_PRIO_STILL
    (void)r;  // Fehlerfall: das Scheitern wird verschluckt
    continue;
#endif
    if (r != 0) {
      ++fehl;
      char b[48];
      std::fprintf(stderr, "Keylock: %s ohne SCHED_FIFO %d (JACK %d): %s; läuft mit SCHED_OTHER weiter\n",
                   kl_name(i, b, sizeof b), sp.sched_priority, jack_prio, std::strerror(r));
    } else {
      ++gesetzt;
    }
  }
  f.prio_fehler.fetch_add(static_cast<uint64_t>(fehl), std::memory_order_relaxed);
  if (gesetzt)
    std::fprintf(stderr, "Keylock: %d Fäden (Vorbereiter, Arbeits-Threads) SCHED_FIFO %d (JACK %d)\n", gesetzt,
                 sp.sched_priority, jack_prio);
  return fehl;
}

void Kern::keylock_faeden_stoppen() {
  if (decks_) decks_->faeden.stoppe();
  if (loops_) loops_->keylock_getrennt();  // Task 7 (K1): kein Faden liest mehr, die Loops der Boxen sind abholbar
}

bool Kern::keylock_faeden_laufen() const noexcept { return decks_->faeden.laeuft.load(std::memory_order_acquire); }
uint64_t Kern::keylock_prio_fehler() const noexcept {
  return decks_->faeden.prio_fehler.load(std::memory_order_relaxed);
}
uint64_t Kern::keylock_waechter_meldungen() const noexcept {
  return decks_->faeden.waechter_meldungen.load(std::memory_order_relaxed);
}

bool Kern::keylock_faden_sched(int platz, int& politik, int& prio) const noexcept {
  const KeylockFaeden& f = decks_->faeden;
  if (platz < 0 || platz >= KEYLOCK_FAEDEN || !f.an[platz]) return false;
  sched_param sp{};
  if (pthread_getschedparam(f.t[platz], &politik, &sp) != 0) return false;
  prio = sp.sched_priority;
  return true;
}

void Kern::keylock_test_halte(int deck, bool an) noexcept {
  if (deck >= 1 && deck <= KEYLOCK_QUELLEN) decks_->faeden.halte[deck - 1].store(an, std::memory_order_release);
}

// Im Callback am Ende jedes Zyklus (kern.cpp): Vorbereiter und Arbeits-Threads wecken (wartefrei, keine Allokation).
void Kern::keylock_wecken() noexcept {
  KeylockFaeden& f = decks_->faeden;
  if (!f.laeuft.load(std::memory_order_acquire)) return;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_FUELLE_NUR_LAUFEND
  for (int d = 0; d < DECKS; ++d)
    f.spielt[d].store(decks_->deck[d].laeuft() && decks_->deck[d].keylock_an(), std::memory_order_relaxed);
#endif
  for (int i = 0; i <= KEYLOCK_QUELLEN; ++i) kl_wecke(&f.sem[i]);  // ohne Blick auf an[] (schreibt nur der startende Faden)
}

// Bungee S2: statt der Fäden fährt der Callback Post (ansetzen, Erneuerung) und Dehner (fuelle_synchron) aller Quellen am Ende
// jedes Zyklus selbst, in derselben Reihenfolge wie Vorbereiter und Arbeits-Thread (takt, dann füllen). Gelesen wird nur, was der
// Callback selbst gesetzt hat (keylock_vorgabe, nach dem Acquire von keylock_stand in keylock_uebernehmen).
static int64_t antrieb_ns() noexcept {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000 + t.tv_nsec;
}

void Kern::keylock_antrieb() noexcept {
  DeckWerk& w = *decks_;
  if (!w.keylock_vorgabe || !w.antrieb_sync) return;
#ifdef CYPHERDJ_MUTATION_KEIN_ANTRIEB
  return;  // Fehlerfall: niemand treibt die Dehner, der Ring wird nie hörbar
#endif
  const int64_t t0 = antrieb_ns();
  int ansaetze = 0, angeboten = 0;  // übernommen / wartend angeboten (Kontrolle des Sturms: 6 im selben Zyklus)
  // Bungee S3: ein Ansatz kostet den ganzen Vorlauf auf einmal (reset, Preroll, Ring leer). Der Knopf keylock setzt alle sechs
  // Quellen im selben Zyklus an (gemessen 4674 µs, s3b-sturm-bungee-20261009-165216). Darum höchstens ANSATZ_JE_ZYKLUS Ansätze
  // je Zyklus; die übrigen bleiben wartend und kommen im nächsten Zyklus (ANSATZ_FRIST deckt 16 Zyklen).
  constexpr int ANSATZ_JE_ZYKLUS = 2;
  for (int d = 0; d < KEYLOCK_QUELLEN; ++d) {
    if (!w.dehner[d]) continue;
    w.post[d].takt(*w.dehner[d]);
    if (w.dehner[d]->ansatz_wartet()) {
      ++angeboten;
#ifndef CYPHERDJ_MUTATION_KEIN_ANSATZ_LIMIT
      if (ansaetze >= ANSATZ_JE_ZYKLUS) continue;
#endif
      ++ansaetze;
    }
    w.dehner[d]->fuelle_synchron();
  }
  if (ansaetze) {
    ++w.antrieb_zyklen_mit_ansatz;
    w.antrieb_ansaetze_n += static_cast<uint64_t>(ansaetze);
  }
  if (angeboten > w.antrieb_ansaetze_max) w.antrieb_ansaetze_max = angeboten;
  w.antrieb_kosten.rein(antrieb_ns() - t0);
}

std::string Kern::keylock_schluss_json() const {
  const DeckWerk& w = *decks_;
  std::string o = "{\"keylock\":{\"quellen\":[";
  char b[512];
  for (int q = 0; q < KEYLOCK_QUELLEN; ++q) {
    const DehnerBasis* d = w.dehner[q].get();
    if (!d) {
      std::snprintf(b, sizeof b, "%snull", q ? "," : "");
    } else {
      const DehnerKosten& k = d->kosten_render();
      std::snprintf(b, sizeof b,
                    "%s{\"q\":%d,\"render_n\":%llu,\"render_p50_us\":%.0f,\"render_p99_us\":%.0f,\"render_p999_us\":%.0f,\"render_max_us\":%.1f,"
                    "\"ring_voll\":%llu,\"epoche\":%u,\"quittiert\":%u,\"herz\":%llu}",
                    q ? "," : "", q + 1, (unsigned long long)k.n, k.quantil_us(0.5), k.quantil_us(0.99), k.quantil_us(0.999), k.max_ns / 1e3,
                    (unsigned long long)d->ring_voll(), d->epoche(), d->quittiert_e(),
                    (unsigned long long)w.faeden.herz[1 + q].load(std::memory_order_relaxed));
    }
    o += b;
  }
  o += "],\"leser\":[";
  for (int q = 0; q < KEYLOCK_QUELLEN; ++q) {
    const StreckLeser* l = q < DECKS ? &w.deck[q].keylock_leser() : loops_->keylock_leser(q - DECKS + 1);
    std::snprintf(b, sizeof b,
                  "%s{\"q\":%d,\"unterlauf\":%llu,\"hart\":%llu,\"verpasst\":%llu,\"aufgegeben\":%llu,\"gelesen\":%llu,"
                  "\"kurz\":%llu}",
                  q ? "," : "", q + 1, (unsigned long long)l->unterlauf_n(), (unsigned long long)l->hart_n(),
                  (unsigned long long)l->verpasst_n(), (unsigned long long)l->aufgegeben_n(),
                  (unsigned long long)l->gelesen(), (unsigned long long)l->kurz_n());
    o += b;
  }
  // Bungee S3: der Antrieb je Zyklus (alle Quellen zusammen) und die Ansätze je Zyklus
  const DehnerKosten& ak = w.antrieb_kosten;
  std::snprintf(b, sizeof b,
                "],\"antrieb\":{\"n\":%llu,\"p50_us\":%.0f,\"p99_us\":%.0f,\"p999_us\":%.0f,\"max_us\":%.1f,"
                "\"ansaetze_n\":%llu,\"zyklen_mit_ansatz\":%llu,\"ansaetze_max_zyklus\":%d}",
                (unsigned long long)ak.n, ak.quantil_us(0.5), ak.quantil_us(0.99), ak.quantil_us(0.999), ak.max_ns / 1e3,
                (unsigned long long)w.antrieb_ansaetze_n, (unsigned long long)w.antrieb_zyklen_mit_ansatz,
                w.antrieb_ansaetze_max);
  o += b;
  std::snprintf(b, sizeof b, ",\"waechter\":%llu,\"prio_fehler\":%llu}}",
                (unsigned long long)w.faeden.waechter_meldungen.load(std::memory_order_relaxed),
                (unsigned long long)w.faeden.prio_fehler.load(std::memory_order_relaxed));
  o += b;
  return o;
}

DehnerBasis* Kern::keylock_dehner(int deck) const noexcept {
  return deck >= 1 && deck <= KEYLOCK_QUELLEN ? decks_->dehner[deck - 1].get() : nullptr;
}

bool Kern::ein_deck_laeuft() const noexcept {
  for (int d = 0; d < DECKS; ++d)
    if (decks_->deck[d].laeuft()) return true;
  return false;
}

// §1.6: Kanalpegel = Trim + Fader; effektiv mit Bus oder Crossfader-Seite und master/pegel.
float Kern::effektiv_db(int d) const noexcept {
  const DeckWerk& w = *decks_;
  const DeckRegler& r = w.reg[d];
  auto wert = [&](int16_t i, float vorgabe) { return i >= 0 ? sw_->wert(i) : vorgabe; };
  float p = dsp::kanalpegel_db(wert(r.trim, 0.0f), wert(r.fader, -200.0f));
  if (dsp::ist_stumm(p)) return dsp::kStummDb;
  const int ziel = static_cast<int>(std::lround(wert(r.ziel, 0.0f)));
  int seite;
  if (ziel >= 1 && ziel <= 4) {
    p += wert(w.bus_fader[ziel - 1], 0.0f);
    seite = static_cast<int>(std::lround(wert(w.bus_xseite[ziel - 1], 1.0f)));
  } else {
    seite = static_cast<int>(std::lround(wert(r.xseite, 1.0f)));
  }
  const float g = seitengewicht(seite, wert(w.xfader, 0.0f));
  if (!(g > 0.0f)) return dsp::kStummDb;
  return p + 20.0f * std::log10(g) + wert(w.master_pegel, 0.0f);
}

bool Kern::deck_offen(int n) const noexcept {
  const DeckRegler& r = decks_->reg[n - 1];
  const float trim = r.trim >= 0 ? sw_->wert(r.trim) : 0.0f;
  const float fader = r.fader >= 0 ? sw_->wert(r.fader) : -200.0f;
  return dsp::kanalpegel_db(trim, fader) > hoerbar_db_;
}

// §4.4 (2026-09-27): Laden und Entladen sind gesperrt, solange das Deck läuft UND sein Kanal offen ist. Ein stehendes
// Deck ist stumm und lädt auch bei offenem Fader; das Laden setzt den Fader ohnehin auf −200.
bool Kern::deck_laeuft_offen(int n) const noexcept { return decks_->deck[n - 1].laeuft() && deck_offen(n); }

bool Kern::deck_hoerbar(int n) const noexcept {
  return decks_->deck[n - 1].laeuft() && effektiv_db(n - 1) > hoerbar_db_;
}

void Kern::einsortieren31(const Befehl& c) {
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  DeckWerk& w = *decks_;
  const int d = c.deck - 1;
  auto ab = [&](const char* grund) { quittung(c.id, c.quelle, 6, sample_, beat0, grund); };
  if (d < 0 || d >= DECKS) return ab("unbekanntes_deck");  // prüft schon das Netz
  if (ist_cypher(c.quelle)) {  // §4.4, §4.7: Stopp-Taste und Deck-Halter
    if (sw_->ki_gestoppt()) return ab("ki_gestoppt");
    if (sw_->deck_beruehrt(c.deck)) return ab("deck_beruehrt");
  }
  Deck& dk = w.deck[d];
  if (c.art == Befehl::DECK_LADEN) {
    if (deck_laeuft_offen(c.deck)) return ab("deck_hoerbar");
    if (!lader_) return ab("material_fehlt");
    LadeAuftrag a{};
    a.id = c.id;
    kopiere(a.quelle, c.quelle, sizeof a.quelle);
    a.deck = c.deck;
    a.fassung = c.fassung;
    a.mit_stems = c.mit_stems;
    a.basis_bpm = c.bpm;
    kopiere(a.material_id, c.material_id, sizeof a.material_id);
    a.seq = ++w.seq;
    if (!lader_->auftraege.schiebe(a)) {  // Lader hängt: genau oder gemeldet (§16.1)
      quittung(c.id, c.quelle, 4, sample_, beat0, "zu_spaet");
      return;
    }
    w.laden_seq[d] = a.seq;
    ++w.laden_offen[d];
    quittung(c.id, c.quelle, 1, sample_, beat0);
    return;
  }
  if (c.art == Befehl::DECK_TAUSCH) {  // Welle 3 (ADR 028, §4.4): Fassung derselben Musik laden, Tausch bei ab_beat
    if (!dk.geladen()) return ab("nicht_geladen");
    if (!lader_) return ab("material_fehlt");
    if (!std::isfinite(c.ab_beat)) return ab("ausserhalb_bereich");
    LadeAuftrag a{};
    a.id = c.id;
    kopiere(a.quelle, c.quelle, sizeof a.quelle);
    a.deck = c.deck;
    a.fassung = c.fassung;
    a.mit_stems = dk.material()->mit_stems;  // §4.4: gleiche mit_stems wie geladen
    a.basis_bpm = c.bpm;
    kopiere(a.material_id, dk.material()->material_id, sizeof a.material_id);
    a.seq = ++w.seq;
    a.tausch = true;
    a.ab_beat = c.ab_beat;
    if (!lader_->auftraege.schiebe(a)) {
      quittung(c.id, c.quelle, 4, sample_, beat0, "zu_spaet");
      return;
    }
    quittung(c.id, c.quelle, 1, sample_, beat0);
    return;
  }
  if (c.art == Befehl::DECK_ENTLADEN) {
    if (deck_laeuft_offen(c.deck)) return ab("deck_hoerbar");
    if (!dk.geladen()) return ab("nicht_geladen");
    quittung(c.id, c.quelle, 1, sample_, beat0);
    if (w.lade_wartet[d]) {  // ein wartendes Laden davor fällt: es würde gleich wieder entladen (nie im Deck: zurück)
      w.lade_wartet[d] = false;
      if (w.laden_offen[d] > 0) --w.laden_offen[d];
      quittung(w.lade_warte[d].auftrag.id, w.lade_warte[d].auftrag.quelle, 7, sample_, beat0, "abbruch");
      if (w.n_rueck_warte < 8) w.rueck_warte[w.n_rueck_warte++] = w.lade_warte[d].material;
    }
    // Vertrag 4 (Prüfung m4): hat das Deck keinen Platz für die Rückgabe, wartet das Entladen auf die Quittung des Dehners
    if (!dk.rueck_frei() || w.entladen_wartet[d]) {
#ifndef CYPHERDJ_MUTATION_KEYLOCK_ENTLADEN_STILL
      if (w.entladen_wartet[d])  // Nachprüfung N2: ein noch wartendes Entladen davor fällt, dieses tritt an seine Stelle
        quittung(w.entladen_warte_id[d], w.entladen_warte_quelle[d], 7, sample_, beat0, "abbruch");
#endif
      w.entladen_wartet[d] = true;
      w.entladen_warte_id[d] = c.id;
      kopiere(w.entladen_warte_quelle[d], c.quelle, sizeof w.entladen_warte_quelle[d]);
      return;
    }
    entladen_ausfuehren(d, c.id, c.quelle);
    return;
  }
  if (c.art == Befehl::DECK_RASTER) {  // Plan Grid (§4.4): sofort, absolut; andere Fassung geladen → nicht_geladen
    const Material* m = dk.material();
    if (!m || std::strcmp(m->material_id, c.material_id) != 0 || m->fassung != c.fassung || m->basis_bpm != c.bpm)
      return ab("nicht_geladen");
    const int64_t alt = dk.raster_versatz();
    quittung(c.id, c.quelle, 1, sample_, beat0);
    dk.setze_raster(sample_, c.versatz_f);
    if (w.cue_gesetzt[d]) w.cue_f[d] += c.versatz_f - alt;  // D1: der gesetzte Cue-Punkt wandert mit
    frist_neu(w, d, sample_);  // Review F11: das Materialende rückt mit dem Ton
    Ereignis x{};
    x.art = Ereignis::RASTER;
    x.deck = c.deck;
    kopiere(x.material_id, m->material_id, sizeof x.material_id);
    x.quell_beat = dk.quell_beat_bei(sample_);
    x.wert = static_cast<float>(static_cast<double>(c.versatz_f - alt) / 48.0);
    x.sample = sample_;
    x.beat = beat0;
    melde(x);
    quittung(c.id, c.quelle, 2, sample_, beat0);
    quittung(c.id, c.quelle, 3, sample_, beat0);
    return;
  }
  if (c.art == Befehl::DECK_HOTCUE_SETZEN) {  // Plan E9 (§4.4): sofort, ohne Ziel-Beat; /e/hotcue
    if (!dk.geladen()) return ab("nicht_geladen");
    if (c.nr < 1 || c.nr > 8) return ab("ausserhalb_bereich");
    w.hotcue[d][c.nr - 1] = c.quell_beat;  // NaN löscht
    quittung(c.id, c.quelle, 1, sample_, beat0);
    Ereignis h{};
    h.art = Ereignis::HOTCUE;
    h.deck = c.deck;
    kopiere(h.material_id, dk.material()->material_id, sizeof h.material_id);
    h.status = c.nr;
    h.quell_beat = c.quell_beat;
    h.sample = sample_;
    h.beat = beat0;
    melde(h);
    quittung(c.id, c.quelle, 2, sample_, beat0);
    quittung(c.id, c.quelle, 3, sample_, beat0);
    return;
  }
  // start, stopp (§4.4 Deck-Teile; Politik §16.1: start 0, stopp 1); Plan E9: loop, sprung, hotcue (Politik 0, 1, 2)
  if (!dk.geladen() && w.laden_offen[d] == 0) return ab("nicht_geladen");
  double ab_beat = c.ab_beat;
  int64_t s = std::llround(plan_.karte().sample_at(ab_beat));
  if (s < sample_ && c.politik == 2 && c.raster_beats > 0.0) {  // raster > 0 prüft schon das Netz; hier gegen Endlosschleife  // §16.1 raster (Plan E9): nächster erreichbarer Rasterpunkt der Größe raster_beats
    ab_beat = c.raster_beats * std::ceil(beat0 / c.raster_beats - 1e-9);
    while ((s = std::llround(plan_.karte().sample_at(ab_beat))) < sample_) ab_beat += c.raster_beats;
  }
  const bool spaet = s < sample_;
  if (spaet && c.politik == 0) {
    quittung(c.id, c.quelle, 4, sample_, beat0, "zu_spaet");
    return;
  }
  DeckAktion* a = nullptr;
  for (DeckAktion& x : w.aktion)
    if (!x.belegt) {
      a = &x;
      break;
    }
  if (!a) return ab("ausserhalb_bereich");  // mehr als 64 wartende Deck-Befehle
  *a = DeckAktion{};
  a->belegt = true;
  a->art = c.art == Befehl::DECK_START ? 1 : c.art == Befehl::DECK_STOPP ? 2 : c.art == Befehl::DECK_LOOP ? 5
         : c.art == Befehl::DECK_SPRUNG ? 6 : 7;
  a->verschoben = ab_beat != c.ab_beat;
  a->wert_beats = c.wert_beats;
  a->nr = c.nr;
  a->politik = static_cast<uint8_t>(c.politik);
  a->verspaetet = spaet;
  a->spaet_sample = sample_;
  a->deck = c.deck;
  a->seq = ++w.seq;
  a->id = c.id;
  a->ab_beat = ab_beat;
  a->quell_beat = c.quell_beat;
  kopiere(a->quelle, c.quelle, sizeof a->quelle);
  kopiere(a->plan, c.plan, sizeof a->plan);
  kopiere(a->gruppe, c.gruppe, sizeof a->gruppe);
  kopiere(a->hoerschein, c.hoerschein, sizeof a->hoerschein);
  if (!spaet) quittung(c.id, c.quelle, 1, sample_, beat0);  // zu spät mit Politik 1: nur Quittung 5 am Start
}

// Entladen ausführen: sofort aus einsortieren31 oder wartend aus decks_uebernehmen (Vertrag 4, Prüfung m4)
void Kern::entladen_ausfuehren(int d, int64_t id, const char* quelle) {
  DeckWerk& w = *decks_;
  Deck& dk = w.deck[d];
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  for (DeckAktion& a : w.aktion)
    if (a.belegt && a.deck == d + 1) {
      if (!a.hand) quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
      a.belegt = false;
    }
  if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, sample_, beat0);
  w.stopp_offen[d] = false;
  tausch_frei(d);  // Welle 3: ein wartender Tausch fällt mit
  w.entladen_m[d] = dk.material();
  w.entladen_id[d] = id;
  kopiere(w.entladen_quelle[d], quelle, sizeof w.entladen_quelle[d]);
  dk.entlade(sample_);
  sw_->stems_geladen(d + 1, false);
  w.leer_melden[d] = true;
  quittung(id, quelle, 2, sample_, beat0);  // fertig, sobald das Material zurück ist (decks_uebernehmen)
}

void Kern::decks_uebernehmen() {
  DeckWerk& w = *decks_;
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  auto zurueck = [&](const Material* m) {  // Freigabe erst nach Rückgabe (ADR 015)
    if (!m) return;
    if (lader_ && lader_->rueckgabe.schiebe(const_cast<Material*>(m))) return;
    if (w.n_rueck_warte < 8) w.rueck_warte[w.n_rueck_warte++] = m;
  };
  // 1) Rückgaben: zuerst die wartenden, dann was die Decks abgelöst haben
  int n = w.n_rueck_warte;
  w.n_rueck_warte = 0;
  for (int i = 0; i < n; ++i) zurueck(w.rueck_warte[i]);
  for (int d = 0; d < DECKS; ++d)
    while (const Material* m = w.deck[d].rueckgabe()) {
      zurueck(m);
      if (m == w.entladen_m[d]) {
        quittung(w.entladen_id[d], w.entladen_quelle[d], 3, sample_, beat0);
        w.entladen_m[d] = nullptr;
      }
    }
  // 1b) Vertrag 4 (Prüfung m4): wartendes Entladen, sobald das Deck Platz für die Rückgabe hat
  for (int d = 0; d < DECKS; ++d)
    if (w.entladen_wartet[d] && w.deck[d].rueck_frei()) {
      w.entladen_wartet[d] = false;
      if (w.deck[d].geladen()) entladen_ausfuehren(d, w.entladen_warte_id[d], w.entladen_warte_quelle[d]);
    }
  // 2) Lade-Ergebnisse (§4.4): Tausch am Blockanfang, Fader −200, PFL 0, Trim aus der Lautheit, Stems 0 dB. Ein Laden, für
  // dessen Rückgabe das Deck keinen Platz hat, wartet (Vertrag 4: Quittung 1 sofort, Ausführung nach der Quittung des
  // Dehners) und kommt zuerst dran, sobald Platz ist.
  LadeErgebnis e;
  int geparkt = 0;
  for (;;) {
    bool aus_park = false;
    for (; geparkt < DECKS && !aus_park; ++geparkt)
      if (w.lade_wartet[geparkt] && w.deck[geparkt].rueck_frei() && !w.entladen_wartet[geparkt]) {
        e = w.lade_warte[geparkt];
        w.lade_wartet[geparkt] = false;
        aus_park = true;
      }
    if (!aus_park && !(lader_ && lader_->ergebnisse.hole(e))) break;
    const LadeAuftrag& a = e.auftrag;
    const int d = a.deck - 1;
    if (e.grund != LadeGrund::ok || !e.material) {
      if (!a.tausch && w.laden_offen[d] > 0) --w.laden_offen[d];
      quittung(a.id, a.quelle, 6, sample_, beat0, grund_text(e.grund));
      continue;
    }
    if (!a.tausch && (!w.deck[d].rueck_frei() || w.entladen_wartet[d] || (w.lade_wartet[d] && !aus_park))) {
      if (w.lade_wartet[d]) {  // ein noch älteres wartendes Laden fällt (es war nie im Deck: sofort zurück)
        const LadeErgebnis& alt = w.lade_warte[d];
        if (w.laden_offen[d] > 0) --w.laden_offen[d];
        quittung(alt.auftrag.id, alt.auftrag.quelle, 7, sample_, beat0, "abbruch");
        zurueck(alt.material);
      }
      w.lade_warte[d] = e;
      w.lade_wartet[d] = true;
      continue;
    }
    if (!a.tausch && w.laden_offen[d] > 0) --w.laden_offen[d];
    if (a.tausch) {  // Welle 3: Fassung für basis_tausch ist da; das Deck muss noch dieselbe Musik tragen
      const Material* jetzt = w.deck[d].material();
      if (!jetzt || std::strcmp(jetzt->material_id, a.material_id) != 0 || a.seq < w.laden_seq[d]) {
        quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
        zurueck(e.material);
        continue;
      }
      DeckAktion* x = nullptr;
      for (DeckAktion& y : w.aktion) {
        if (y.belegt && y.deck == a.deck && y.art == 8) {  // ein neuerer Tausch ersetzt den wartenden
          quittung(y.id, y.quelle, 7, sample_, beat0, "abbruch");
          y.belegt = false;
        }
        if (!y.belegt && !x) x = &y;
      }
      if (w.tausch_m[d]) zurueck(w.tausch_m[d]);
      w.tausch_m[d] = nullptr;
      if (!x) {
        quittung(a.id, a.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        zurueck(e.material);
        continue;
      }
      w.tausch_m[d] = e.material;
      *x = DeckAktion{};
      x->belegt = true;
      x->art = 8;
      x->politik = 1;  // liegt der Ziel-Beat schon zurück: am nächsten Blockanfang (Status 5)
      x->deck = a.deck;
      x->seq = ++w.seq;
      x->id = a.id;
      x->ab_beat = a.ab_beat;
      kopiere(x->quelle, a.quelle, sizeof x->quelle);
      const int64_t ziel = std::llround(plan_.karte().sample_at(a.ab_beat));
      x->verspaetet = ziel < sample_;
      x->spaet_sample = sample_;
      continue;
    }
    if (w.tausch_m[d]) {  // Welle 3: neues Material verwirft einen wartenden Tausch (seine Aktion fällt unten über seq)
      zurueck(w.tausch_m[d]);
      w.tausch_m[d] = nullptr;
    }
    if (deck_laeuft_offen(a.deck)) {  // inzwischen laufend und offen: nie ungefragt tauschen (§4.4 deck_hoerbar)
      quittung(a.id, a.quelle, 6, sample_, beat0, "deck_hoerbar");
      zurueck(e.material);
      continue;
    }
    for (DeckAktion& x : w.aktion)  // Befehle an dieses Deck aus der Zeit vor diesem Laden fallen (Festlegung F6)
      if (x.belegt && x.deck == a.deck && x.seq < a.seq) {
        if (!x.hand) quittung(x.id, x.quelle, 7, sample_, beat0, "abbruch");
        x.belegt = false;
      }
    if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, sample_, beat0);
    w.stopp_offen[d] = false;
    Deck& dk = w.deck[d];
    dk.lade(e.material, sample_);
    for (double& hc : w.hotcue[d]) hc = NAN;  // Plan E9: Hotcues gehören zum geladenen Material
    w.cue_gesetzt[d] = false;  // Scheibe 35: Cue-Punkt = erste Takt-Eins, das Deck steht dort (Plan 35 Task 5)
    w.vorschau[d] = false;
    dk.setze_position(cue_frame(d));
    const DeckRegler& r = w.reg[d];
    for (int k = 0; k < STEM_ANZAHL; ++k) {
      if (r.stem[k] >= 0) sw_->setze_direkt(r.stem[k], 0.0f);
      dk.stem_db(k, 0.0f);
    }
    if (r.fader >= 0) sw_->setze_direkt(r.fader, dsp::kStummDb);
    if (r.pfl >= 0) sw_->setze_direkt(r.pfl, 0.0f);
    if (r.trim >= 0)
      sw_->setze_direkt(r.trim, dsp::trim_aus_lufs(ziel_lufs_, static_cast<float>(e.material->lufs_integriert)));
    // §5.7: die drei Werte nach dem Laden immer melden, auch wenn einer schon so stand (das Stellwerk meldet nur
    // Änderungen); so sieht jeder Abonnent Fader −200, PFL 0 und den Trim der neuen Fassung (Golden-Folge laden)
    for (int16_t rr : {r.fader, r.pfl, r.trim}) {
      if (rr < 0) continue;
      Ereignis x{};
      x.art = Ereignis::REGLER;
      x.sample = sample_;
      x.beat = beat0;
      kopiere(x.pfad, sw_->tabelle().def(rr).pfad, sizeof x.pfad);
      x.wert = sw_->wert(rr);
      sw::halter_text(sw_->halter(rr), x.text, sizeof x.text);
      melde(x);
    }
    sw_->stems_geladen(a.deck, e.material->mit_stems != 0);
    w.frist_gemeldet[d] = 0;
    w.leer_melden[d] = false;
    quittung(a.id, a.quelle, 2, sample_, beat0);  // §4.4: gestartet beim Tausch, fertig
    quittung(a.id, a.quelle, 3, sample_, beat0);
    Ereignis g{};
    g.art = Ereignis::GELADEN;
    g.deck = a.deck;
    kopiere(g.material_id, e.material->material_id, sizeof g.material_id);
    g.basis_bpm = e.material->basis_bpm;
    g.fassung = e.material->fassung;
    g.mit_stems = e.material->mit_stems;
    g.sample = sample_;
    g.beat = beat0;
    melde(g);
  }
  // 3) Stopp-Taste (§4.7, auch ohne Leitstand über das Stellwerk): wartende Deck-Befehle von Cypher fallen
  if (sw_->ki_gestoppt())
    for (DeckAktion& x : w.aktion)
      if (x.belegt && ist_cypher(x.quelle)) {
        quittung(x.id, x.quelle, 7, sample_, beat0, "ki_stopp");
        if (x.art == 8) tausch_frei(x.deck - 1);  // Welle 3: Fassung des Tauschs zurück
        x.belegt = false;
      }
}

// §5.5: je geladenem Deck 50-mal je Sekunde (in dem Zyklus, der ein Vielfaches von 960 Samples enthält), Zustand am
// Blockanfang n0, direkt nach /uhr desselben Zyklus. Nach dem Entladen einmal Status 0.
void Kern::decks_zustand(int64_t n0, int n) {
  const int64_t naechstes = (n0 + DECK_ZUSTAND_ABSTAND - 1) / DECK_ZUSTAND_ABSTAND * DECK_ZUSTAND_ABSTAND;
  if (naechstes >= n0 + n) return;
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    const Deck& dk = w.deck[d];
    const Material* m = dk.material();
    if (!m && !w.leer_melden[d]) continue;
    Ereignis e{};
    e.art = Ereignis::DECK;
    e.deck = d + 1;
    e.sample = n0;
    e.beat = k.beat_at(static_cast<double>(n0));
    e.status = !m ? 0 : dk.laeuft() ? (dk.loop_aktiv() ? 3 : 2) : 1;  // Plan E9: 3 Loop (§5.5)
    if (m) {
      kopiere(e.material_id, m->material_id, sizeof e.material_id);
      e.basis_bpm = m->basis_bpm;
      e.fassung = m->fassung;
      e.mit_stems = m->mit_stems;
      e.quell_beat = dk.quell_beat_bei(n0);
      e.beats_bis_ende = dk.beats_bis_ende_bei(n0);
      e.faktor = k.bpm_at(static_cast<double>(n0)) / m->basis_bpm;
    }
    e.vorlauf_ms = 2.0f * static_cast<float>(n) / 48.0f;  // §3: Deck-Befehl im Direktweg 2 Zyklen
    e.hoerweg = dk.keylock_hoerweg();  // Keylock Task 2b: Felder, die §5.5 schon vorsieht
    e.stretcher_fuell = dk.keylock_vorlauf_bloecke();
    // Keylock Task 3 (Fassung 4.1 Punkt 3): Zähler des Decks (Vertrag 2 und 5), auf int32 begrenzt
#ifdef CYPHERDJ_MUTATION_KEYLOCK_ZAEHLER_VERTAUSCHT
    e.keylock_unterlauf = static_cast<int32_t>(std::min<uint64_t>(dk.keylock_aufgegeben(), INT32_MAX));  // Fehlerfall
    e.keylock_aufgegeben = static_cast<int32_t>(std::min<uint64_t>(dk.keylock_unterlauf(), INT32_MAX));
#else
    e.keylock_unterlauf = static_cast<int32_t>(std::min<uint64_t>(dk.keylock_unterlauf(), INT32_MAX));
    e.keylock_aufgegeben = static_cast<int32_t>(std::min<uint64_t>(dk.keylock_aufgegeben(), INT32_MAX));
#endif
    melde(e);
    w.leer_melden[d] = false;
  }
}

// Keylock 7b.3 (§5.5b): je Box mit Loop im Takt von /zustand/deck die Zähler ihres Lesers und Dehners (0 ohne Dehner).
void Kern::boxen_zustand(int64_t n0, int n) {
  const int64_t naechstes = (n0 + DECK_ZUSTAND_ABSTAND - 1) / DECK_ZUSTAND_ABSTAND * DECK_ZUSTAND_ABSTAND;
  if (naechstes >= n0 + n || !loops_) return;
  for (int b = 1; b <= LOOP_BOXEN; ++b) {
    if (!loops_->loop(b)) continue;
    Ereignis e{};
    e.art = Ereignis::BOX;
    e.deck = b;
    e.sample = n0;
    e.status = static_cast<int32_t>(loops_->status(b));
    if (loops_->keylock_bereit(b)) {
      const StreckLeser& l = *loops_->keylock_leser(b);
      const DehnerBasis* d = keylock_dehner(DECKS + b);
#ifdef CYPHERDJ_MUTATION_BOX_ZAEHLER_VERTAUSCHT
      e.keylock_unterlauf = static_cast<int32_t>(std::min<uint64_t>(l.aufgegeben_n(), INT32_MAX));  // Fehlerfall
      e.keylock_aufgegeben = static_cast<int32_t>(std::min<uint64_t>(l.unterlauf_n(), INT32_MAX));
#else
      e.keylock_unterlauf = static_cast<int32_t>(std::min<uint64_t>(l.unterlauf_n(), INT32_MAX));
      e.keylock_aufgegeben = static_cast<int32_t>(std::min<uint64_t>(l.aufgegeben_n(), INT32_MAX));
#endif
      e.keylock_ring_voll = d ? static_cast<int32_t>(std::min<uint64_t>(d->ring_voll(), INT32_MAX)) : 0;
      e.keylock_kein_platz = static_cast<int32_t>(std::min<uint64_t>(loops_->keylock_kein_platz(b), INT32_MAX));
    }
    melde(e);
  }
}

// Keylock 6a (Plan Task 6, Detailschnitt 3.8): eine Rechnung für Plan und Ausführung des Starts. Frame, das bei der Aktion
// erklingt (hand: ziel_frame; sonst quell_beat in Frames der Fassung auf dem Deck, wie deck_ausfuehren), und der Master-Beat des
// Einsatzes (Anker des Plans: ab_beat, bei der Hand der Beat ihres Ziel-Samples).
static int64_t start_frame(const DeckAktion& a, const Deck& dk) noexcept {
  if (a.hand) return a.ziel_frame;
  const Material* m = dk.material();
  return m ? std::llround(frame_von(a.quell_beat, dk.schlag0(), m->basis_bpm)) : 0;
}

// Keylock 6a: am Blockanfang s0 je Deck die früheste fällige Aktion (Auswahl wie decks_block). Ist sie ein Start (art 1, nicht
// verspätet) auf einem stehenden Deck, plant das Deck ihn (Deck::kl_plane_start entscheidet Vorlauf, Basis, Loop, Keylock);
// sonst fällt ein alter Plan (die Aktion wurde gestrichen, ein anderes Ereignis kommt vorher). Nur Vorplanung: ausgeführt wird
// weiter in decks_block am Sample.
static void deck_planen(DeckWerk& w, const Karte& k, int d, int64_t s0, bool ki_gestoppt) noexcept {
  Deck& dk = w.deck[d];
  if (!dk.keylock_plan_aktiv() && (dk.laeuft() || !dk.geladen() || !dk.keylock_an())) return;
  const DeckAktion* nx = nullptr;
  int64_t sn = 0;
  for (const DeckAktion& a : w.aktion) {
    if (!a.belegt || a.deck != d + 1) continue;
    const int64_t s = a.hand ? a.ziel_sample : a.verspaetet ? a.spaet_sample : std::llround(k.sample_at(a.ab_beat));
    if (!nx || s < sn || (s == sn && a.seq < nx->seq)) {
      nx = &a;
      sn = s;
    }
  }
#ifndef CYPHERDJ_MUTATION_PLAN_KI_STOPP_SPAET
  // Fix-Runde 2 Q2-1: die Stopp-Taste der Hand wirkt im selben Zyklus (hand_zyklus nach decks_uebernehmen streicht die Aktion erst im
  // nächsten); deck_ausfuehren wiese den Start von "cypher" am Ziel ab. Der Plan fällt darum schon hier, am Blockanfang, vor dem Mischen.
  if (nx && ki_gestoppt && ist_cypher(nx->quelle)) nx = nullptr;
#else
  (void)ki_gestoppt;
#endif
  if (nx && nx->art == 1 && !nx->verspaetet) {
    const double b = nx->hand ? k.beat_at(static_cast<double>(nx->ziel_sample)) : nx->ab_beat;
    dk.kl_plane_start(s0, sn, b, start_frame(*nx, dk), nx->seq);
    return;
  }
#ifndef CYPHERDJ_MUTATION_PLAN_KERN_OHNE_VERWERFEN
  if (dk.keylock_plan_aktiv()) dk.kl_plan_verwerfen(s0);  // die Aktion fiel (/k/abbruch, KI-Stopp, Laden, Transport-Taste)
#endif
  // Fällt der Start erst am Ziel (KI-Stopp mitten im Zyklus, Abweisung in deck_ausfuehren, zu spät), verwirft Deck::block den
  // Plan am Ziel selbst (Fix-Runde 1 Q3; vorher zwei eigene Zeilen in decks_block).
}

void Kern::deck_ausfuehren(DeckAktion& a, int64_t s) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  const double b = k.beat_at(static_cast<double>(s));
  const int d = a.deck - 1;
  Deck& dk = w.deck[d];
  if (a.hand) return hand_ausfuehren(a, s);  // Scheibe 35: Deck-Taste der Hand, ohne Quittung
  const int ok = (a.verspaetet || a.verschoben) ? 5 : 2;
  if (ist_cypher(a.quelle) && sw_->ki_gestoppt()) return quittung(a.id, a.quelle, 7, s, b, "ki_stopp");
  if (!dk.geladen()) return quittung(a.id, a.quelle, 6, s, b, "nicht_geladen");
  if (a.art == 8) {  // Welle 3 (§4.4 basis_tausch): dieselbe Musik, andere Fassung, am selben Quell-Beat
    const Material* neu = w.tausch_m[d];
    w.tausch_m[d] = nullptr;
    if (!neu) return quittung(a.id, a.quelle, 7, s, b, "abbruch");
    const Material* alt = dk.material();
    if (w.cue_gesetzt[d]) {  // Cue-Punkt in Frames der alten Fassung: auf die neue umrechnen
      const double q = quell_beat_von(static_cast<double>(w.cue_f[d]), dk.schlag0(), alt->basis_bpm);
      w.cue_f[d] = std::llround(frame_von(q, neu->erster_schlag_frame, neu->basis_bpm));
    }
    dk.tausche(s, neu);
    sw_->stems_geladen(a.deck, neu->mit_stems != 0);
    frist_neu(w, d, s);
    quittung(a.id, a.quelle, ok, s, b);
    quittung(a.id, a.quelle, 3, s, b);
    return;
  }
  const Material* m = dk.material();
  const double fpb = FRAMES_JE_MINUTE / m->basis_bpm;  // Frames je Quell-Beat
  if (a.art == 6) {  // Plan E9 sprung (§4.4; Attrappe decks.mjs 'sprung': im Loop wandert der Loop mit)
    const int64_t d_f = std::llround(a.wert_beats * fpb);
    // Audit F09: der mitwandernde Loop muss im Material bleiben, sonst läuft das Deck mit Status 3 endlos still
    // Loop-Drift: mit dem längsten Durchlauf (ceil der exakten Länge), der kann ein Frame länger sein als loop_laenge()
    if (dk.loop_aktiv() && (dk.loop_anfang() + d_f < 0 || dk.loop_anfang() + d_f + dk.loop_laenge_max() > m->frames))
      return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");
    dk.springe(s, d_f);
    frist_neu(w, d, s);
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 7) {  // Plan E9 hotcue, phasentreu (§4.4: ziel = hc + wrap(phase(p) − phase(hc))); beendet einen Loop
    const double hc = w.hotcue[d][a.nr - 1];
    if (std::isnan(hc)) return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");
    // stehend genau auf den Hotcue (Traktor; Review E9 F7: 13,3 wurde zu 40,3), laufend phasentreu zum Master
    const double p = dk.quell_beat_bei(s);
    const double x = (p - std::floor(p)) - (hc - std::floor(hc));
    const double ziel = dk.laeuft() ? hc + (x - std::floor(x + 0.5)) : hc;
    dk.loop_aus(s);
    dk.setze_kopf(s, std::llround(frame_von(ziel, dk.schlag0(), m->basis_bpm)));
    frist_neu(w, d, s);
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 5) {  // Plan E9 loop (§4.4): ab der Quellposition bei ab_beat, Länge in Quell-Beats; 0 = aus
    if (a.wert_beats > 0.0) {
      // Loop-Drift: die exakte Länge L_beats · fpb geht mit, die Nähte liegen bei round(j · l_x) statt j · round(l_x) (bei
      // krummem fpb lief der Loop sonst gegen das Beat-Raster weg); im Material muss der längste Durchlauf ceil(l_x) liegen
      const double l_x = a.wert_beats * fpb;
      const int64_t a_f = dk.frame_bei(s), l_f = std::llround(l_x);
#ifdef CYPHERDJ_MUTATION_KERN_LOOP_GRENZE_LF
      if (a_f < 0 || a_f + l_f > m->frames)  // Fehlerfall der Prüfung (F5): gerundete statt längste Länge
#else
      if (a_f < 0 || a_f + static_cast<int64_t>(std::ceil(l_x)) > m->frames)
#endif
        return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");  // Audit F09
#ifdef CYPHERDJ_MUTATION_KERN_LOOP_OHNE_LX
      dk.loop_an(s, a_f, l_f);  // Fehlerfall der Prüfung (F2): ohne exakte Länge, test_kern_loop_drift rot
#else
      dk.loop_an(s, a_f, l_f, l_x);
#endif
    }
    else {
      dk.loop_aus(s);
      frist_neu(w, d, s);
    }
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 1) {  // start: bei ab_beat erklingt quell_beat (§4.4)
    // Welle 3 (ADR 028): Start bei jedem Tempo, das Deck folgt im Varispeed (bis Welle 2 hier kein_stretcher)
    int64_t f = start_frame(a, dk);  // Keylock 6a: dieselbe Rechnung wie der Plan (deck_planen)
    if (a.verspaetet) f += s - std::llround(k.sample_at(a.ab_beat));  // phasentreu (Festlegung F5)
    dk.start(s, f, false, a.seq);
    if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, s, b);  // Start beendet die Stopp-Rampe
    w.stopp_offen[d] = false;
    frist_neu(w, d, s);  // nur Übergänge melden
    quittung(a.id, a.quelle, ok, s, b);
    return;
  }
  const int64_t ende = dk.stopp(s);  // stopp: 10-ms-Rampe, fertig an ihrem Ende
  quittung(a.id, a.quelle, ok, s, b);
  if (ende > s) {
    w.stopp_offen[d] = true;
    w.stopp_id[d] = a.id;
    kopiere(w.stopp_quelle[d], a.quelle, sizeof w.stopp_quelle[d]);
    w.stopp_ende[d] = ende;
  } else {
    quittung(a.id, a.quelle, 3, s, b);  // stand schon
  }
}

// Ein Teilblock [s0, s0 + m): je Deck bis zum nächsten fälligen Befehl lesen, ihn am Sample ausführen, weiterlesen.
void Kern::decks_block(int64_t s0, int m) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    Deck& dk = w.deck[d];
    float* l = mixer_->eingang_l(d);
    float* r = mixer_->eingang_r(d);
    deck_planen(w, k, d, s0, sw_->ki_gestoppt());  // Keylock 6a: geplanter Start aus dem Stand
    int off = 0;
    for (;;) {
      DeckAktion* nx = nullptr;
      int64_t sn = 0;
      for (DeckAktion& a : w.aktion) {
        if (!a.belegt || a.deck != d + 1) continue;
        const int64_t s = a.hand ? a.ziel_sample
                                 : a.verspaetet ? a.spaet_sample : std::llround(k.sample_at(a.ab_beat));
        if (s >= s0 + m) continue;
        if (!nx || s < sn || (s == sn && a.seq < nx->seq)) {
          nx = &a;
          sn = s;
        }
      }
      if (w.knopf_offen & (1u << d)) {  // Keylock Task 3: der Regler keylock am Sample, vor einem späteren Befehl
        const int64_t ks = std::max(w.knopf_s, s0 + off);
        if (ks < s0 + m && (!nx || ks <= sn)) {
          const int bis = static_cast<int>(ks - s0);
          if (bis > off) {
            dk.block(s0 + off, bis - off, l + off, r + off, off);
            off = bis;
          }
          dk.keylock(ks, w.knopf);
          w.knopf_offen = static_cast<uint8_t>(w.knopf_offen & ~(1u << d));
          continue;
        }
      }
      if (!nx) break;
      if (sn < s0 + off) {  // Ziel schon vorbei, ohne dass es beim Einsortieren so war (Neustart): §16.1
        if (nx->politik == 0) {
          quittung(nx->id, nx->quelle, 4, s0 + off, k.beat_at(static_cast<double>(s0 + off)), "zu_spaet");
          nx->belegt = false;
          continue;
        }
        nx->verspaetet = true;
        sn = s0 + off;
      }
#ifdef CYPHERDJ_MUTATION_START_BLOCKANFANG
      if (nx->art == 1) sn = s0;  // Fehlerfall der Abnahme: Start am Blockanfang statt am Sample des Ziel-Beats
#endif
      const int bis = static_cast<int>(sn - s0);
      if (bis > off) {
        dk.block(s0 + off, bis - off, l + off, r + off, off);
        off = bis;
      }
      if (nx->art == 8 && !nx->hand && !dk.rueck_frei()) {  // Vertrag 4 (Prüfung m4): der Tausch wartet auf Platz
        nx->verspaetet = true;
        nx->spaet_sample = s0 + m;
        continue;
      }
      deck_ausfuehren(*nx, sn);
      nx->belegt = false;
    }
    if (off < m) dk.block(s0 + off, m - off, l + off, r + off, off);
    if (w.stopp_offen[d] && !dk.laeuft()) {
      const int64_t e = w.stopp_ende[d];
      quittung(w.stopp_id[d], w.stopp_quelle[d], 3, e, k.beat_at(static_cast<double>(e)));
      w.stopp_offen[d] = false;
    }
  }
}

// Keylock Task 3 (Fassung 4: EIN Knopf für alle Quellen). Der Verlauf des Reglers keylock (Schalter, nur Setzen) über
// [s0, s0 + m): wechselt der Stand, gilt der neue ab dem ersten Sample mit dem neuen Wert. Die Decks bekommen ihn in
// decks_block am Sample (Deck::keylock: aus -> was klang, blendet in den Varispeed; an -> Ansatz, Ring ab s_h), die
// Loop-Boxen ab diesem Block (LoopBoxen::keylock: aus -> was im Ring klingt, blendet in den Varispeed; an -> Ansatz). Ein Hin und
// Zurück im selben Block ändert nichts.
void Kern::keylock_verlauf(int regler, const float* verlauf, int64_t s0, int m) {
  DeckWerk& w = *decks_;
  if (regler != w.knopf_regler || regler < 0 || !verlauf || m <= 0) return;
  const bool ende = verlauf[m - 1] >= 0.5f;
  if (ende == w.knopf) return;
  int j = 0;
  while (j < m - 1 && (verlauf[j] >= 0.5f) != ende) ++j;
  w.knopf = ende;
  w.knopf_s = s0 + j;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_KNOPF_NUR_BOXEN
  w.knopf_offen = 0;  // Fehlerfall: der Knopf erreicht die Decks nicht
#else
  w.knopf_offen = static_cast<uint8_t>((1u << DECKS) - 1u);
#endif
#ifndef CYPHERDJ_MUTATION_KEYLOCK_KNOPF_OHNE_BOXEN
  loops_->keylock(ende, s0);  // Task 7: mit Dehner am Blockanfang (der Leser kennt den Ring dieses Blocks)
#endif
}

bool Kern::keylock_knopf() const noexcept { return decks_->knopf; }
bool Kern::keylock_boxen() const noexcept { return loops_->keylock(); }

void Kern::decks_verlauf(int regler, const float* verlauf) {
  DeckWerk& w = *decks_;
  if (regler < 0 || regler >= cypherdj::stellwerk::MAX_REGLER || w.stem_deck[regler] < 0) return;
  w.deck[w.stem_deck[regler]].stem_verlauf(w.stem_nr[regler], verlauf);
}

void Kern::decks_verlauf_ende(int m) {
  for (int d = 0; d < DECKS; ++d) decks_->deck[d].verlauf_ende(m);
}

// §5.9 /e/frist: bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks, am Sample des Übergangs.
void Kern::decks_frist(int64_t n0, int n) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    const Deck& dk = w.deck[d];
    const Material* m = dk.material();
    if (!m || !dk.laeuft() || dk.loop_aktiv() || w.frist_gemeldet[d] == 0x0f) continue;  // im Loop kein Ende (Plan E9)
    const bool hoerbar = deck_hoerbar(d + 1);
    for (int i = 0; i < 4; ++i) {
      if (w.frist_gemeldet[d] & (1u << i)) continue;
      const double f_schwelle = static_cast<double>(m->frames) - FRIST_BEATS[i] * FRAMES_JE_MINUTE / m->basis_bpm;
      // Welle 3: über den Beat-Anker (Quell-Beat = Master-Beat, auch im Varispeed); bei Faktor 1 gleich dem Sample-Weg
      const int64_t s = dk.direkt() ? dk.anker_s() + std::llround(f_schwelle - static_cast<double>(dk.anker_f()))
                                    : std::llround(k.sample_at(dk.anker_b() + (f_schwelle - static_cast<double>(dk.anker_f())) *
                                                                                 m->basis_bpm / FRAMES_JE_MINUTE));
      if (s >= n0 + n) continue;
      w.frist_gemeldet[d] |= static_cast<uint8_t>(1u << i);
      if (!hoerbar || s < n0) continue;  // Übergang lag vor diesem Block (Neustart): nicht nachmelden  // nur hörbare Decks melden (§5.9); die Schwelle gilt trotzdem als vorbei
      Ereignis e{};
      e.art = Ereignis::FRIST;
      e.deck = d + 1;
      e.beats_bis_ende = FRIST_BEATS[i];
      e.sample = s;
      e.beat = k.beat_at(static_cast<double>(s));
      melde(e);
    }
  }
}

void Kern::decks_abbruch(const char* quelle, const char* plan) {
  if (!plan || !plan[0]) return;
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  for (DeckAktion& a : decks_->aktion)
    if (a.belegt && !std::strcmp(a.plan, plan) && !std::strcmp(a.quelle, quelle)) {
      quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
      a.belegt = false;
    }
}

// Welle 3: Fassung eines wartenden Tauschs zurück an den Lader (über die Warteliste der Rückgaben, im nächsten Zyklus)
void Kern::tausch_frei(int d) {
  DeckWerk& w = *decks_;
  if (!w.tausch_m[d]) return;
  if (w.n_rueck_warte < 8) w.rueck_warte[w.n_rueck_warte++] = w.tausch_m[d];
  w.tausch_m[d] = nullptr;
}

void Kern::decks_set_neu() {
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  for (DeckAktion& a : decks_->aktion)
    if (a.belegt) {
      if (!a.hand) quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
      a.belegt = false;
    }
  for (int d = 0; d < DECKS; ++d) tausch_frei(d);
  for (int d = 0; d < DECKS; ++d) {
    decks_->frist_gemeldet[d] = 0;
    decks_->vorschau[d] = false;
  }
}

// Ohr T14 (§17 I3a): DeckModell-Adapter für PrueferI3 (stellwerk/i3.h). `kanal` ist der Kanal-Index der
// ReglerTabelle (d.kanal in i3.cpp), nicht die Deck-Nummer; tab_ ist eine eigene, aber baugleiche Tabelle (§1.5 fest
// verdrahtet), damit dieses Objekt schon vor dem Stellwerk selbst existieren kann (kern.cpp: erst Prüfer, dann
// Stellwerk). Kein I/O, keine Allokation: nur Feldzugriffe auf das schon geladene Material.
bool Kern::DeckModellImpl::deck_nr_von_kanal(int kanal, int& deck_nr) const {
  if (kanal < 0 || kanal >= tab_.kanaele()) return false;
  const char* name = tab_.kanal_name(kanal);
  if (!name || std::strncmp(name, "deck/", 5) != 0 || !name[5] || name[6]) return false;
  if (name[5] < '1' || name[5] > '4') return false;
  deck_nr = name[5] - '0';
  return true;
}

bool Kern::DeckModellImpl::inhalt(int kanal, cypherdj::stellwerk::Inhalt& aus) const {
  int deck_nr = 0;
  if (!deck_nr_von_kanal(kanal, deck_nr) || !decks_) return false;
  const Deck& dk = decks_->deck[deck_nr - 1];
  const Material* m = dk.material();
  if (!m) return false;
  kopiere(aus.material_id, m->material_id, sizeof aus.material_id);
  aus.bpm_milli = static_cast<int32_t>(std::llround(m->basis_bpm * 1000.0));
  aus.fassung = m->fassung;
  return true;
}

double Kern::DeckModellImpl::quell_beat_bei(int kanal, int64_t sample) const {
  int deck_nr = 0;
  if (!deck_nr_von_kanal(kanal, deck_nr) || !decks_) return std::nan("");
  const Deck& dk = decks_->deck[deck_nr - 1];
  if (!dk.geladen()) return std::nan("");
  return dk.quell_beat_bei(sample);
}

}  // namespace cdj

