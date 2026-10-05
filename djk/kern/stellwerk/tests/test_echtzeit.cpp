// Scheibe 11, Task 14: Allokationswächter (ADR 002). malloc, calloc, realloc und free werden in diesem Testprogramm
// ersetzt und zählen, solange `echtzeit` gesetzt ist. Alles, was der Kern im Callback aufruft (teil, abbruch, hand,
// deck_taste, ki_*, prozess, Ausgaben abholen) und alle Prüfer-Haken samt Sicht und Eingriff laufen unter dem Wächter.
// Erwartung: 0 Aufrufe. Positiv-Kontrolle: new zählt; Fehlerfall: ein Prüfer, der allokiert, wird gezählt.
#include <cstddef>
#include <memory>

#include "pruef.h"
#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

extern "C" {
void* __libc_malloc(size_t);
void __libc_free(void*);
void* __libc_calloc(size_t, size_t);
void* __libc_realloc(void*, size_t);
}

namespace {
volatile bool echtzeit = false;
volatile long zahl = 0;
}  // namespace

extern "C" void* malloc(size_t n) {
  if (echtzeit) zahl = zahl + 1;
  return __libc_malloc(n);
}
extern "C" void free(void* p) {
  if (echtzeit && p) zahl = zahl + 1;
  __libc_free(p);
}
extern "C" void* calloc(size_t a, size_t b) {
  if (echtzeit) zahl = zahl + 1;
  return __libc_calloc(a, b);
}
extern "C" void* realloc(void* p, size_t n) {
  if (echtzeit) zahl = zahl + 1;
  return __libc_realloc(p, n);
}

using namespace cypherdj::stellwerk;

namespace {
// Ein Prüfer, der jede Sicht- und Eingriff-Art benutzt, wie 20 es tun wird, ohne selbst zu allokieren.
class VollPruefer : public Pruefer {
 public:
  bool allokiere = false;   // Fehlerfall: ein Prüfer mit new im Haken
  long aufrufe = 0;
  Grund vor_teilstart(const Sicht& s, const TeilSicht& t) override {
    aufrufe++;
    volatile float v = s.pruefwert_vor(t.regler, t) + s.pruefwert_mit(t.regler, t) + s.vorher(t.regler, t.start_sample);
    (void)v;
    if (allokiere) {
      int* volatile x = new int(1);
      delete x;
    }
    return Grund::kein;
  }
  void je_zyklus(const Sicht& s, Eingriff& e) override {
    aufrufe++;
    const int n = s.offene_teile(teile_, MAX_TEILE);
    const int64_t ende = s.zyklus_anfang() + s.zyklus_laenge() - 1;
    for (int j = 0; j < n; j++) {
      volatile float v = s.vorschau(teile_[j].regler, ende) + s.pruefwert(teile_[j].regler, ende);
      (void)v;
    }
    if (n > 0 && (s.zyklus_anfang() / 256) % 997 == 0) {   // selten eingreifen: anhalten, fortsetzen, melden
      e.anhalten(teile_[0].index);
      e.fortsetzen(teile_[0].index);
      e.melde_invariante(InvArt::master_leer, teile_[0].plan, teile_[0].nr);
    }
  }
  void nach_handgriff(const Sicht& s, Eingriff& e, int regler, int64_t sample) override {
    aufrufe++;
    volatile float v = s.wert(regler);
    (void)v;
    (void)sample;
    e.gruppe_abbrechen("gibt_es_nicht", "g", Grund::hand);   // läuft ins Leere, meldet gruppe_gefallen
  }
  void gruppe_gefallen(const Sicht&, const char*, const char*, Grund, int64_t) override { aufrufe++; }

 private:
  TeilSicht teile_[MAX_TEILE];
};

long dauerlauf(Pruefer* p, int zyklen) {
  SimUhr uhr(128.0);
  auto sw = std::make_unique<Stellwerk>(uhr, p);
  const ReglerTabelle& t = sw->tabelle();
  int regler[64];
  int n = 0;
  for (int r = 0; r < t.anzahl() && n < 64; r++)
    if (!t.def(r).nur_hand && !t.def(r).keine_rampe && t.def(r).deck == 0) regler[n++] = r;
  PRUEFE_GLEICH(n, 64);
  sw->ki_spur(1, Quelle::leitstand, "erz/5,erz/6");
  const int hand1 = t.suche("erz/7/eq/mitte"), hand2 = t.suche("erz/8/eq/mitte");
  zahl = 0;
  int64_t id = 10;
  int welle = 0;
  for (int z = 0; z < zyklen; z++) {
    const int64_t s0 = static_cast<int64_t>(z) * 256;
    echtzeit = true;
    // eine Welle je 32 Beats (2812,5 Zyklen): 64 Rampen, angrenzend an die vorige Welle
    const double beat = uhr.beat(s0);
    if (beat + 8 >= 32.0 * welle + 16) {
      const double ab = 32.0 * welle + 16;
      char plan[16] = "w";
      plan[1] = static_cast<char>('a' + welle % 26);
      for (int k = 0; k < 64; k++) {
        const ReglerDef& d = t.def(regler[k]);
        const float ziel = (welle % 2) ? d.min + 0.25f * (d.max - d.min) : d.max;
        sw->teil(TeilBefehl{id++, Quelle::cypher, plan, k, d.pfad, ab, 32, d.db ? (welle % 2 ? -30.0f : 0.0f) : ziel,
                            k % 2, 0, (k % 4 == 0) ? "g" : "", ""});
      }
      welle++;
    }
    if (z % 7 == 0) {
      sw->hand(Griff{s0 + 13, static_cast<int16_t>(hand1), GriffArt::absolut, 0.8f + 0.001f * (z % 5), nullptr});
      sw->hand(Griff{s0 + 97, static_cast<int16_t>(hand2), GriffArt::relativ, (z % 2) ? 0.01f : -0.01f, nullptr});
    }
    if (z % 5000 == 17) sw->deck_taste(1 + (z / 5000) % 4, s0 + 50);
    if (z == 20000) sw->ki_stopp(id++, Quelle::andreas);
    if (z == 20500) sw->ki_frei(id++, Quelle::andreas);
    if (z == 30000) sw->abbruch(id++, Quelle::leitstand, "wk", nullptr, -1);
    sw->prozess(s0, 256);
    const Aenderung* a;
    volatile int na = sw->aenderungen(&a);
    (void)na;
    const Ereignis* e;
    volatile int ne = sw->ereignisse(&e);
    (void)ne;
    volatile bool bd = sw->deck_beruehrt(1);
    (void)bd;
    sw->ereignisse_leeren();
    echtzeit = false;
  }
  PRUEFE_GLEICH(sw->zaehler().ereignisse_verloren, 0);
  PRUEFE_GLEICH(sw->zaehler().bewegt_voll, 0);
  PRUEFE_GLEICH(sw->zaehler().teile_voll, 0);
  if (zyklen >= 60000) {   // der lange Lauf muss wirklich gerechnet haben (Positiv-Gegenprobe zur 0)
    PRUEFE(welle >= 9);
    PRUEFE(sw->zaehler().zyklen_voll > 50000);
  }
  return zahl;
}
}  // namespace

FALL(waechter_zaehlt_positiv_kontrolle) {
  zahl = 0;
  echtzeit = true;
  int* volatile p = new int(3);
  delete p;
  echtzeit = false;
  PRUEFE(zahl >= 2);
}

FALL(dauerlauf_64_regler_hand_ki_0_allokationen) { PRUEFE_GLEICH(dauerlauf(nullptr, 60000), 0); }   // 320 s Musik

FALL(dauerlauf_mit_vollem_pruefer_0_allokationen) {
  VollPruefer p;
  PRUEFE_GLEICH(dauerlauf(&p, 60000), 0);
  PRUEFE(p.aufrufe > 60000);
}

FALL(fehlerfall_allokierender_pruefer_wird_gezaehlt) {
  VollPruefer p;
  p.allokiere = true;
  PRUEFE(dauerlauf(&p, 6000) > 0);
}

PRUEF_MAIN
