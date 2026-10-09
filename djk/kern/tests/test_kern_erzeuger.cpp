// Plan 2026-09-27 Task 4: Erzeuger im Kern. Ein Impuls-Kit auf erz/1 (Fader 0 dB) mit Ereignissen auf Beat 8,5 und 9,5.
// Der Isolator im Kanalzug läuft immer mit und verschmiert den Impuls (kanalzug.cpp Schritt 3); beide Einsätze gehen
// durch dieselbe Kette, darum: Abstand am Master-Ring genau SPB, Versatz zur Sollstelle llround(b · SPB) + Vorhalt
// fest in [0, 200). Beat 8,5 liegt 18 Samples, Beat 9,5 246 Samples hinter einem Blockanfang: der Fehlerfall
// test_kern_erzeuger_mutation (Einsatz am Blockanfang) ändert den Abstand um 228 und scheitert. Dazu Quittung als
// Ereignis, /pegel erz/1; Negativ-Kontrolle: Fader −200 → kein Einsatz am Master.
#include <cstdlib>
#include <memory>
#include <new>

#include "cypherdj/erzeuger.h"
#include "kern35.h"

bool g_waechter = false;  // kern35.h: zählt Allokationen in zyklus(), wenn Lauf::bewachen gesetzt ist
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

using namespace k35;

static cdj::Kit impuls() {
  cdj::Kit k;
  k.klang[36].frames = 1;
  k.klang[36].daten = {0.5f, 0.5f};
  k.n = 1;
  return k;
}

static void lauf(const std::string& ab, float fader_db, std::vector<int64_t>* einsaetze, int* quittungen,
                 float* pegel_erz) {
  cdj::Kit kit = impuls();
  Lauf x(ab, nullptr);
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 1;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/1");
  s.zeiger = &kit;
  x.sende(s);
  x.teil("erz/1/fader", fader_db, 0.0, 0.0);
  auto* f = new cdj::ErzFenster{};
  f->strom = 1;
  f->sendung = 7;
  f->ab_beat = 8.0;
  f->bis_beat = 12.0;
  f->ev[f->n++] = cdj::ErzEv{8.5, 36, 1, 1.0f};
  f->ev[f->n++] = cdj::ErzEv{9.5, 36, 1, 1.0f};
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  x.zyklen(12 * SPB);
  *einsaetze = x.klicks(4 * SPB, 12 * SPB);
  const auto q = x.alle(cdj::Ereignis::ERZ_QUITTUNG);
  *quittungen = (int)q.size();
  if (q.size() == 1) {
    PRUEF(q[0].zeiger == f && q[0].deck == 1 && q[0].fassung == 7);
    PRUEF(q[0].erz_zahl[2] == 2 && q[0].erz_zahl[3] == 0 && q[0].erz_zahl[4] == 0);  // eingefuegt, zu_spaet, ungehoert
  }
  delete f;
  *pegel_erz = -999.0f;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, "erz/1")) *pegel_erz = std::max(*pegel_erz, e.pegel[0]);
  PRUEF(x.alle(cdj::Ereignis::ERZ_ALT).empty());  // kein Tausch, also nichts freizugeben
}

// Glanz 2.4.1 (F11) am Kern-Weg (kern.cpp:82): ERZ_STROM tauscht das Kit, während ein 2-s-Klang klingt. Im Zyklus
// keine Allokation, genau ein ERZ_ALT mit dem alten Kit.
static void tausch(const std::string& ab) {
  auto a = std::make_unique<cdj::Kit>(), b = std::make_unique<cdj::Kit>();
  for (cdj::Kit* k : {a.get(), b.get()}) {
    k->klang[36].frames = 96000;
    k->klang[36].daten.assign(2 * 96000, 0.5f);
    k->n = 1;
  }
  Lauf x(ab, nullptr);
  x.bewachen = true;
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 1;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/1");
  s.zeiger = a.get();
  x.sende(s);
  auto* f = new cdj::ErzFenster{};
  f->strom = 1; f->sendung = 1; f->ab_beat = 8.0; f->bis_beat = 12.0;
  f->ev[f->n++] = cdj::ErzEv{8.0, 36, 1, 1.0f};
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  x.zyklen(9 * SPB);
  auto t = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  t.nr = 1;
  std::snprintf(t.pfad, sizeof t.pfad, "erz/1");
  t.zeiger = b.get();
  x.sende(t);
  x.zyklen(10 * SPB);
  const auto alt = x.alle(cdj::Ereignis::ERZ_ALT);
  std::printf("F11 Kern-Weg: Allokationen im Zyklus %ld, ERZ_ALT %zu\n", g_allokationen, alt.size());
  PRUEF(g_allokationen == 0);
  PRUEF(alt.size() == 1 && alt[0].zeiger == a.get());
  delete f;
}

int main() {
  Arbeitsbestand ab("test_kern_erzeuger");
  std::vector<int64_t> k;
  int q = 0;
  float p = 0;
  lauf(ab.pfad, 0.0f, &k, &q, &p);
  Lauf ref(ab.pfad, nullptr);
  const int vh = ref.vh;
  const int64_t soll1 = std::llround(8.5 * SPB) + vh;
  const int64_t versatz = k.empty() ? -1 : k[0] - soll1;
  std::printf("erzeuger: Einsätze %zu, erster %lld (Soll ab %lld, Versatz %lld), Abstand %lld (Soll %lld), Quittungen %d, "
              "Pegel erz/1 %.2f dB\n", k.size(), k.empty() ? -1LL : (long long)k[0], (long long)soll1, (long long)versatz,
              k.size() > 1 ? (long long)(k[1] - k[0]) : -1LL, (long long)SPB, q, p);
  PRUEF(k.size() == 2 && k[1] - k[0] == SPB);
  PRUEF(versatz >= 0 && versatz < 200);
  PRUEF(q == 1);
  PRUEF(p > -20.0f && p <= -5.9f);  // Impuls 0,5 (−6,02 dB) nach dem Isolator, Fader 0 dB: kleiner, nie größer
  // Negativ-Kontrolle: Fader unten → kein Einsatz
  lauf(ab.pfad, -200.0f, &k, &q, &p);
  PRUEF(k.empty() && q == 1);
  tausch(ab.pfad);
  PRUEF_ENDE();
}
