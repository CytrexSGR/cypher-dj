// Studio S1 (Plan 2026-09-29-djk-studio-s1, Task 1): drei Ströme auf erz/1..3 mit demselben Impuls-Kit. Nur Strom 2
// bekommt Ereignisse → /pegel meldet strom/2 laut, strom/1 und strom/3 still (−200). Beat-FX-Zuweisung auf pad/1 und pad/2
// wird angenommen. Container core X1: a stream has no strip, so no click reaches the master without a track (the streams of
// an arrangement sound through their strom tracks, test_arr_strom_senke); the old fader negative control is gone with the fader rows.
#include "cypherdj/generator.h"
#include "core35.h"

bool g_waechter = false;

using namespace k35;

static cdj::Kit impuls() {
  cdj::Kit k;
  k.klang[36].frames = 1;
  k.klang[36].daten = {0.5f, 0.5f};
  k.n = 1;
  return k;
}

struct Ergebnis { std::vector<int64_t> einsaetze; float pegel[3]; bool fx2, fx3; };

static Ergebnis lauf(const std::string& ab, bool mit_ereignissen) {
  cdj::Kit kit = impuls();
  Lauf x(ab, nullptr);
  for (int s = 1; s <= 3; ++s) {
    auto b = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
    b.nr = s;
    std::snprintf(b.pfad, sizeof b.pfad, "erz/%d", s);
    b.zeiger = &kit;
    x.sende(b);
  }
  for (const char* k : {"pad/1", "pad/2"}) {   // container core K1: the beat FX takes containers, not the old erz channels
    auto z = x.neu(cdj::Befehl::FX_ZUWEISUNG, "andreas");
    z.deck = 1;
    std::snprintf(z.pfad, sizeof z.pfad, "%s", k);
    z.an = 1;
    x.sende(z);
  }
  auto* f = new cdj::ErzFenster{};
  f->strom = 2;
  f->sendung = 1;
  f->ab_beat = 8.0;
  f->bis_beat = 12.0;
  if (mit_ereignissen) {
    f->ev[f->n++] = cdj::ErzEv{8.5, 36, 1, 1.0f};
    f->ev[f->n++] = cdj::ErzEv{9.5, 36, 1, 1.0f};
  }
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f;
  x.sende(c);
  x.zyklen(12 * SPB);
  Ergebnis e{};
  e.einsaetze = x.klicks(4 * SPB, 12 * SPB);
  const char* namen[3] = {"strom/1", "strom/2", "strom/3"};
  for (int i = 0; i < 3; ++i) {
    e.pegel[i] = -999.0f;
    for (const auto& p : x.alle(cdj::Ereignis::PEGEL, namen[i])) e.pegel[i] = std::max(e.pegel[i], p.pegel[0]);
  }
  e.fx2 = x.kern->mixer().fx_zugewiesen(0, cdj::Mixer::kanal_index("pad/1"));
  e.fx3 = x.kern->mixer().fx_zugewiesen(0, cdj::Mixer::kanal_index("pad/2"));
  delete f;
  return e;
}

int main() {
  Arbeitsbestand ab("test_kern_drei_stroeme");
  const Ergebnis e = lauf(ab.pfad, true);
  std::printf("drei Ströme: Einsätze %zu, Pegel erz/1 %.1f erz/2 %.1f erz/3 %.1f, FX1 erz/2 %d erz/3 %d\n",
              e.einsaetze.size(), e.pegel[0], e.pegel[1], e.pegel[2], e.fx2, e.fx3);
  PRUEF(e.einsaetze.empty());   // no strip, no track: nothing reaches the master
  PRUEF(e.pegel[1] > -20.0f && e.pegel[1] <= -5.9f);   // Impuls 0,5 nach dem Isolator, wie test_kern_erzeuger
  PRUEF(e.pegel[0] == -200.0f && e.pegel[2] == -200.0f);  // gemeldet UND still: Kanaltrennung
  PRUEF(e.fx2 && e.fx3);
  const Ergebnis n = lauf(ab.pfad, false);            // negative control: without events stream 2 is silent too
  PRUEF(n.pegel[1] == -200.0f && n.einsaetze.empty());
  PRUEF_ENDE();
}
