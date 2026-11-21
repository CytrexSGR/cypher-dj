// Container core K2: the Baukasten knobs of a stream live in the rows strom/<n>/bk/<k> (control table, 8192 rows). A write to
// strom/5/bk/3 reaches the graph of stream 5 as knob 3 and no other stream; the old erz/<n>/bk/<k> rows no longer reach the Erzeuger;
// after a restart (restore + continue) the stored value is reported as a REGLER event again.
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/state.h"
#include "core25.h"
#include "core35.h"

bool g_waechter = false;  // core35.h: allocation guard, unused here

using k35::Lauf;
using k35::SPB;

namespace {

// saw x gate x knob 3 (0..1) -> output; the knob scales the level linearly
const char* GR3 = R"({"format":"baukasten/2","name":"r","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"r","art":"regler","nr":3,"min":0,"max":1},{"id":"w","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"w.a"},{"von":"r.aus","nach":"w.b"},{"von":"w.aus","nach":"o.x"}]})";

CypherBk* graph() {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(GR3, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}

void strom(Lauf& x, int nr, CypherBk* g) {
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = nr;
  s.form = -1;
  s.politik = 1;
  s.zeiger = g;
  x.sende(s);
  char p[32];
  std::snprintf(p, sizeof p, "erz/%d/fader", nr);
  x.teil(p, 0.0f, 0.0, 0.0);
}

void note(Lauf& x, int nr) {
  auto* f = new cdj::ErzFenster{};
  f->strom = nr;
  f->sendung = 1;
  f->ab_beat = 8.0;
  f->bis_beat = 12.0;
  cdj::ErzEv e{8.0, 57, 1, 1.0f};
  e.dauer = 4.0;
  f->ev[f->n++] = e;
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
}

float spitze(const Lauf& x, const char* kanal) {
  float p = -999.0f;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, kanal)) p = std::max(p, e.pegel[0]);
  return p;
}

// streams 5 and 6 play the same graph; `pfad` is written before the notes; returns the peaks of erz/5 and erz/6 in dB
void lauf(const std::string& ab, const char* pfad, float wert, float* p5, float* p6) {
  Lauf x(ab, nullptr);
  strom(x, 5, graph());
  strom(x, 6, graph());
  x.teil(pfad, wert, 0.0, 0.0);
  note(x, 5);
  note(x, 6);
  x.zyklen(10 * SPB);
  *p5 = spitze(x, "strom/5");
  *p6 = spitze(x, "strom/6");
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_strom_bk");
  float a5 = 0, a6 = 0, b5 = 0, b6 = 0, c5 = 0, c6 = 0;
  lauf(ab.pfad, "strom/1/bk/1", 0.5f, &a5, &a6);   // reference: knob 3 stays at its default 0.5 on both streams
  lauf(ab.pfad, "strom/5/bk/3", 0.7f, &b5, &b6);
  lauf(ab.pfad, "erz/5/bk/3", 0.7f, &c5, &c6);     // old row: must change nothing
  std::printf("reference %.2f / %.2f dB, strom/5/bk/3=0.7: %.2f / %.2f dB, erz/5/bk/3=0.7: %.2f / %.2f dB\n", a5, a6, b5, b6, c5, c6);
  PRUEF(a5 > -40.0f && a6 > -40.0f);
  PRUEF(std::fabs(a5 - a6) < 0.05f);
  PRUEF(std::fabs((b5 - a5) - 2.92f) < 0.3f);   // 20 log10(0.7 / 0.5)
  PRUEF(std::fabs(b6 - a6) < 0.05f);            // no other stream
  PRUEF(std::fabs(c5 - a5) < 0.05f && std::fabs(c6 - a6) < 0.05f);

  {  // after a restart the value is reported again
    Kern25 a;
    a.teil(1, "cypher", "p", 0, "strom/5/bk/3", 4.0, 0.0, 0.7f, 0, 0, "", "");
    a.bis(200'000);
    const auto& tab = a.kern->stellwerk().tabelle();
    PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("strom/5/bk/3")), 0.7, 1e-6);
    auto f = std::make_unique<cdj_z_echtzeit>();
    std::memset(f.get(), 0, sizeof *f);
    a.kern->abbild(*f);
    f->anker_sample = a.kern->sample() - 256;
    f->quantum = 256;
    Kern25 b;
    PRUEF(b.kern->wiederherstellen(*f));
    b.kern->fortsetzen(204'096);
    b.bis(220'000);
    const cdj::Ereignis* r = nullptr;
    for (const auto& e : b.ev)
      if (e.art == cdj::Ereignis::REGLER && !std::strcmp(e.pfad, "strom/5/bk/3")) r = &e;
    std::printf("strom/5/bk/3 reported after restart: %s\n", r ? "yes" : "no");
    PRUEF(r && std::fabs(r->wert - 0.7f) < 1e-6f && !std::strcmp(r->text, "frei"));
  }
  PRUEF_ENDE();
}
