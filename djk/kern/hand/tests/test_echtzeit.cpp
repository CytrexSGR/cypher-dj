// Scheibe 19: Allokationswächter (ADR 002). malloc, calloc, realloc und free werden in diesem Testprogramm ersetzt und
// zählen, solange `echtzeit` gesetzt ist. Unter dem Wächter läuft alles, was der Kern (35) im Callback aus dieser
// Bibliothek ruft: Uebersetzer::ereignis, zu_griff, led_nachricht, suche. Erwartung 0; Positiv-Kontrolle: new zählt.
#include <cstddef>
#include <cstdint>
#include <memory>

#include "hand/led.h"
#include "hand/mapping.h"
#include "hand/naht_stellwerk.h"
#include "hand/uebersetzer.h"
#include "pruef.h"

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

using namespace hand;

namespace {
const char* const MAPPING = R"({"version":1,"geraet":"t","quelle_port":"q","ziel_port":"z","eintraege":[
  {"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"deck/1/fader","art":"absolut","kurve":{"typ":"fader_db","min":-200,"max":0}},
  {"nachricht":{"typ":"cc","kanal":1,"nr":20},"ziel":"deck/1/eq/tief","art":"relativ","kodierung":"zweierkomplement"},
  {"nachricht":{"typ":"note","kanal":1,"nr":36},"ziel":"deck/1/kill/tief","art":"taste"},
  {"nachricht":{"typ":"note","kanal":1,"nr":44},"ziel":"deck/1/play","art":"taste"},
  {"nachricht":{"typ":"note","kanal":16,"nr":0},"ziel":"taste/stopp","art":"taste"}],
 "leds":[{"name":"vorschlag","nachricht":{"typ":"note","kanal":16,"nr":10},"werte":{"aus":0,"an":127,"blinkt":64}}]})";
}  // namespace

FALL(null_allokationen_im_echtzeit_pfad) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(MAPPING, stellwerk::ReglerTabelle(), m.get(), &f));
  Uebersetzer u(m.get());
  uint32_t zufall = 12345;
  long ausgaben = 0, griffe = 0;
  echtzeit = true;
  zahl = 0;
  for (int i = 0; i < 100000; i++) {
    zufall = zufall * 1664525u + 1013904223u;
    const uint8_t st[] = {0xB0, 0x90, 0x80, 0xE0, 0xBF, 0x9F};
    const uint8_t d[3] = {st[(zufall >> 8) % 6], static_cast<uint8_t>((zufall >> 16) % 50), static_cast<uint8_t>((zufall >> 24) & 0x7F)};
    Ausgabe a{};
    if (u.ereignis(d, 3, i * 256, (zufall >> 4) % 256, 256, &a)) {
      ausgaben++;
      stellwerk::Griff g{};
      griffe += zu_griff(a, *m, 0.0f, &g);
    }
    uint8_t b[3];
    led_nachricht(*m, "vorschlag", i % 4, b);
  }
  const long im_pfad = zahl;
  // Positiv-Kontrolle: der Wächter sieht eine Allokation
  int* volatile x = new int(1);
  delete x;
  const long mit_new = zahl;
  echtzeit = false;
  PRUEFE_GLEICH(im_pfad, 0);
  PRUEFE(mit_new >= 1);
  PRUEFE(ausgaben > 1000 && griffe > 500);   // der Pfad ist wirklich gelaufen
  std::printf("  100000 Ereignisse, %ld Ausgaben, %ld Griffe, %ld Allokationen, Kontrolle new: %ld\n", ausgaben, griffe,
              im_pfad, mit_new);
}

FALL(vergleich_laden_allokiert_und_gehoert_nicht_in_den_callback) {
  // Der Wächter sieht den Nicht-Echtzeit-Pfad: lade() allokiert (JSON-Baum, Texte). Darum lädt der Kern (35) das
  // Mapping im Nicht-Echtzeit-Faden und reicht nur den Zeiger in den Callback (§4.7 /k/mapping).
  auto m = std::make_unique<Mapping>();
  Fehler f;
  echtzeit = true;
  zahl = 0;
  const bool ok = lade(MAPPING, stellwerk::ReglerTabelle(), m.get(), &f);
  const long beim_laden = zahl;
  echtzeit = false;
  PRUEFE(ok);
  PRUEFE(beim_laden > 10);
  std::printf("  lade(): %ld Allokationen\n", beim_laden);
}

PRUEF_MAIN
