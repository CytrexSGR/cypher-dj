// Scheibe 18: Kern::abbild, Kern::wiederherstellen, Kern::fortsetzen ohne Datei und ohne Betrieb. Ein Kern mit Prüfklick
// und laufender Rampe schreibt sein Echtzeit-Fach; ein frischer Kern übernimmt es (Generation + 1, dieselbe Karte,
// dieselben offenen Befehle) und meldet /e/neustart als erstes Ereignis. Negativ-Kontrolle: ein kaputtes Fach
// (0 Segmente) wird abgelehnt und ändert nichts. Fehlerfall zum Vergleich: ein frischer Kern ohne Übernahme hat eine
// andere Karte (keine Rampe) und keinen Klick.
#include <cstring>
#include <memory>

#include "cypherdj/kern.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

struct Aufbau {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern;
  Aufbau() {
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->setze_pruefmodus(true);  // Scheibe 25, B7: Prüfklick überlebt den Neustart nur im Prüfmodus
  }
  void befehl(int art, int64_t id, double ab = 0, double ziel = 0, double dauer = 0) {
    cdj::Befehl b{};
    b.art = art;
    b.id = id;
    b.an = 1;
    std::strcpy(b.quelle, "pruefstand");
    b.ab_beat = ab;
    b.ziel_bpm = ziel;
    b.dauer_beats = dauer;
    bef->schiebe(b);
  }
  void leere() {
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
};

int main() {
  Aufbau a;
  a.befehl(cdj::Befehl::KLICK, 2);
  a.befehl(cdj::Befehl::TEMPO_RAMPE, 3, 64.0, 132.0, 32.0);
  while (a.kern->sample() < 1'663'895) {  // Beat 74, in der Rampe (notbahn_rampe)
    a.kern->zyklus(256, 0);
    a.leere();
  }
  auto f = std::make_unique<cdj_z_echtzeit>();
  std::memset(f.get(), 0, sizeof *f);
  a.kern->abbild(*f);
  PRUEF(f->generation == 0);
  PRUEF(f->n_segmente == a.kern->karte().anzahl() && f->n_segmente >= 2);
  PRUEF(f->n_grund >= 2);
  PRUEF(f->n_befehle == 2);
  PRUEF(f->befehle[0].art == CDJ_Z_ART_RAMPE && f->befehle[0].id == 3 && f->befehle[0].stand == 2);
  PRUEF(f->befehle[0].ist_sample == 1'440'000 && f->befehle[0].ist_beat == 64.0);
  PRUEF(f->befehle[0].d.rampe.ende_beat == 96.0 && f->befehle[0].d.rampe.ziel_bpm == 132.0);
  PRUEF(f->befehle[1].art == CDJ_Z_ART_KLICK && f->befehle[1].id == 2 && f->befehle[1].stand == 2);
  PRUEF(!std::strcmp(f->befehle[1].quelle, "pruefstand"));

  // Übernahme in einen frischen Kern
  Aufbau b;
  PRUEF(b.kern->wiederherstellen(*f));
  PRUEF(b.kern->generation() == 1);
  PRUEF(b.kern->wartend() == 0);  // die Rampe läuft schon
  for (double beat = 60.0; beat <= 120.0; beat += 0.5)
    PRUEF_NAH(b.kern->karte().sample_at(beat), a.kern->karte().sample_at(beat), 0.0);
  auto g = std::make_unique<cdj_z_echtzeit>();
  std::memset(g.get(), 0, sizeof *g);
  b.kern->abbild(*g);
  PRUEF(g->generation == 1 && g->n_befehle == 2 && g->befehle[1].stand == 2);
  b.kern->fortsetzen(1'665'536);
  cdj::Ereignis e;
  PRUEF(b.ere->hole(e) && e.art == cdj::Ereignis::NEUSTART && e.generation == 1 && e.sample == 1'665'536);
  b.kern->zyklus(256, 0);
  PRUEF(b.ere->hole(e) && e.art == cdj::Ereignis::UHR && e.generation == 1 && e.sample == 1'665'536);

  // Negativ-Kontrolle: kaputtes Fach (0 Segmente) abgelehnt, Kern unverändert
  Aufbau c;
  f->n_segmente = 0;
  PRUEF(!c.kern->wiederherstellen(*f));
  PRUEF(c.kern->generation() == 0 && c.kern->karte().anzahl() == 1);

  // Fehlerfall zum Vergleich: ohne Übernahme keine Rampe in der Karte, kein Klick im Fach
  auto h = std::make_unique<cdj_z_echtzeit>();
  std::memset(h.get(), 0, sizeof *h);
  c.kern->abbild(*h);
  PRUEF(h->n_befehle == 0);
  PRUEF(c.kern->karte().sample_at(96.0) != a.kern->karte().sample_at(96.0));
  PRUEF_ENDE();
}
