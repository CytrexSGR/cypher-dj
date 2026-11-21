// Plan 2026-09-27 Task 4: Erzeuger im Kern. Ein Impuls-Kit auf Strom 1 mit Ereignissen auf Beat 8,5 und 9,5.
// Container core X1: a stream has no strip and no fader, so the onsets are read from the stream buffer (Quellpuffer strom_l[0], before any
// track, isolator or limiter): distance exactly SPB, offset to the target llround(b · SPB) in [0, 200). Beat 8,5 lies 18 samples, beat 9,5
// 246 samples behind a block start: the failure case test_kern_erzeuger_mutation (onset at the block start) changes the distance by 228 and
// fails. Plus the receipt as an event and /pegel strom/1; negative control: a window without events puts nothing into the stream buffer.
#include <cmath>
#include <cstdlib>
#include <memory>
#include <new>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/generator.h"
#include "cypherdj/quellpuffer.h"
#include "core35.h"

bool g_waechter = false;  // core35.h: zählt Allokationen in zyklus(), wenn Lauf::bewachen gesetzt ist
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

static void lauf(const std::string& ab, bool mit_ereignissen, std::vector<int64_t>* einsaetze, int* quittungen,
                 float* pegel_erz) {
  cdj::Kit kit = impuls();
  Lauf x(ab, nullptr);
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 1;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/1");
  s.zeiger = &kit;
  x.sende(s);
  auto* f = new cdj::ErzFenster{};
  f->strom = 1;
  f->sendung = 7;
  f->ab_beat = 8.0;
  f->bis_beat = 12.0;
  if (mit_ereignissen) {
    f->ev[f->n++] = cdj::ErzEv{8.5, 36, 1, 1.0f};
    f->ev[f->n++] = cdj::ErzEv{9.5, 36, 1, 1.0f};
  }
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  std::vector<float> strom;   // the stream buffer of stream 1 by absolute sample
  for (int64_t z = 0; z < 12 * SPB; z += N) {
    const int64_t n0 = x.kern->sample();
    x.zyklen(n0 + N);
    const cdj::Quellpuffer& qp = x.kern->quellpuffer();
    if (static_cast<int64_t>(strom.size()) < n0 + N) strom.resize(static_cast<size_t>(n0 + N), 0.0f);
    for (int i = 0; i < N; ++i) strom[static_cast<size_t>(n0 + i)] = qp.strom_l[0][i];
  }
  einsaetze->clear();
  for (int64_t n = 4 * SPB; n < static_cast<int64_t>(strom.size()); ++n) {   // the first |x| > 0.05 of an onset, then 1000 samples of rest
    if (std::fabs(strom[static_cast<size_t>(n)]) <= 0.05f) continue;
    einsaetze->push_back(n);
    n += 1000;
  }
  const auto q = x.alle(cdj::Ereignis::ERZ_QUITTUNG);
  *quittungen = (int)q.size();
  if (q.size() == 1 && mit_ereignissen) {
    PRUEF(q[0].zeiger == f && q[0].deck == 1 && q[0].fassung == 7);
    PRUEF(q[0].erz_zahl[2] == 2 && q[0].erz_zahl[3] == 0 && q[0].erz_zahl[4] == 0);  // eingefuegt, zu_spaet, ungehoert
  }
  delete f;
  *pegel_erz = -999.0f;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, "strom/1")) *pegel_erz = std::max(*pegel_erz, e.pegel[0]);
  PRUEF(x.alle(cdj::Ereignis::ERZ_ALT).empty());  // kein Tausch, also nichts freizugeben
}

// Glanz 2.4.1 (F11) am Kern-Weg (core.cpp:82): ERZ_STROM tauscht das Kit, während ein 2-s-Klang klingt. Im Zyklus
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

// Baukasten S3a Task 3 am Kern-Weg: ERZ_STROM mit form = -1 und einem Graphen; eine gehaltene Note klingt auf erz/1.
// Ein zweiter ERZ_STROM (Kit) löst den Graphen ab: im Zyklus keine Allokation, nach dem Ausklang genau ein
// Ereignis::ERZ_BK_ALT mit dem Graphen (Negativ-Kontrolle: vor dem Tausch keines).
static void bk_tausch(const std::string& ab) {
  const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";
  char fehler[256] = {};
  CypherBk* g = cypher_bk_neu(G, 48000.0, fehler, sizeof fehler);
  PRUEF(g != nullptr);
  cdj::Kit kit = impuls();
  Lauf x(ab, nullptr);
  x.bewachen = true;
  g_allokationen = 0;
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 1;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/1");
  s.form = -1;
  s.politik = 1;
  s.zeiger = g;
  x.sende(s);
  x.teil("erz/1/fader", 0.0f, 0.0, 0.0);  // wie lauf(): ohne Fader steht der Kanal auf -200 dB
  auto* f = new cdj::ErzFenster{};
  f->strom = 1; f->sendung = 1; f->ab_beat = 8.0; f->bis_beat = 12.0;
  cdj::ErzEv e{8.0, 57, 1, 1.0f};
  e.dauer = 4.0;
  f->ev[f->n++] = e;
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  x.zyklen(9 * SPB);
  float pegel = -999.0f;
  for (const auto& p : x.alle(cdj::Ereignis::PEGEL, "strom/1")) pegel = std::max(pegel, p.pegel[0]);
  const size_t vorher = x.alle(cdj::Ereignis::ERZ_BK_ALT).size();
  auto t = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  t.nr = 1;
  std::snprintf(t.pfad, sizeof t.pfad, "erz/1");
  t.zeiger = &kit;
  x.sende(t);
  x.zyklen(10 * SPB);
  const auto alt = x.alle(cdj::Ereignis::ERZ_BK_ALT);
  std::printf("S3a Kern-Weg: Pegel erz/1 %.2f dB, ERZ_BK_ALT vor dem Tausch %zu, danach %zu, Allokationen im Zyklus %ld\n",
              pegel, vorher, alt.size(), g_allokationen);
  PRUEF(pegel > -40.0f);
  PRUEF(vorher == 0);
  PRUEF(alt.size() == 1 && alt[0].zeiger == g);
  PRUEF(g_allokationen == 0);
  delete f;
  cypher_bk_frei(g);
}

int main() {
  Arbeitsbestand ab("test_kern_erzeuger");
  std::vector<int64_t> k;
  int q = 0;
  float p = 0;
  lauf(ab.pfad, true, &k, &q, &p);
  Lauf ref(ab.pfad, nullptr);
  const int vh = ref.vh;
  const int64_t soll1 = std::llround(8.5 * SPB);   // the stream buffer sits before the limiter lookahead (vh)
  (void)vh;
  const int64_t versatz = k.empty() ? -1 : k[0] - soll1;
  std::printf("erzeuger: Einsätze %zu, erster %lld (Soll ab %lld, Versatz %lld), Abstand %lld (Soll %lld), Quittungen %d, "
              "Pegel erz/1 %.2f dB\n", k.size(), k.empty() ? -1LL : (long long)k[0], (long long)soll1, (long long)versatz,
              k.size() > 1 ? (long long)(k[1] - k[0]) : -1LL, (long long)SPB, q, p);
  PRUEF(k.size() == 2 && k[1] - k[0] == SPB);
  PRUEF(versatz >= 0 && versatz < 200);
  PRUEF(q == 1);
  PRUEF(p > -20.0f && p <= -5.9f);  // Impuls 0,5 (−6,02 dB) nach dem Isolator, Fader 0 dB: kleiner, nie größer
  // negative control: a window without events leaves the stream buffer empty
  lauf(ab.pfad, false, &k, &q, &p);
  PRUEF(k.empty() && q == 1);
  tausch(ab.pfad);
  bk_tausch(ab.pfad);
  PRUEF_ENDE();
}
