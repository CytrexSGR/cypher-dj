// 1.8 Task 22: Modul Aufnahme. Einsatz und Ende kommen aus der Arrangement-Lage; der Abgriff ist bitgleich; Lücken-Zähler; Ablehnungen.
#include <cstring>
#include <vector>

#include "cypherdj/aufnahme.h"
#include "pruef.h"

using cdj::Aufnahme;
using cdj::ArrLage;
using cdj::AufnahmeMeldung;
using cdj::RecSpur;

static float sig_l(int64_t s) { return 0.0001f * static_cast<float>(s % 9973 + 1); }
static float sig_r(int64_t s) { return -sig_l(s) * 0.5f; }

// Treiber: ein Block [s0, s0+m) mit dem Signal auf allen drei Abgriffen; verschiedene Vielfache, damit Verwechseln auffällt (erz/2 = Faktor 2)
static void block(Aufnahme& a, int64_t s0, int m, const ArrLage& lage) {
  std::vector<float> l[3], r[3];
  const float* tl[3];
  const float* tr[3];
  for (int k = 0; k < 3; ++k) {
    l[k].resize(m);
    r[k].resize(m);
    for (int i = 0; i < m; ++i) { l[k][i] = sig_l(s0 + i) * (k + 1); r[k][i] = sig_r(s0 + i) * (k + 1); }
    tl[k] = l[k].data();
    tr[k] = r[k].data();
  }
  a.block(s0, m, lage, tl, tr);
}
// alle Chunks einer Spur einsammeln
static std::vector<cdj::AufnahmeChunk> leere(RecSpur* p) {
  std::vector<cdj::AufnahmeChunk> v;
  cdj::AufnahmeChunk c;
  while (p->ring.hole(c)) v.push_back(c);
  return v;
}

int main() {
  Aufnahme a;
  RecSpur* p1 = RecSpur::neu(1, 12);   // erz/2
  RecSpur* p2 = RecSpur::neu(5, 11);   // erz/1
  PRUEF(a.setze(1, p1) == nullptr && a.setze(5, p2) == nullptr && a.scharf() == 2);
  ArrLage steht{0, -1, -1, -1};
  {  // Ablehnungen
    Aufnahme leer;
    PRUEF(std::strcmp(leer.starte(1, 7, 0, false, 100, steht), "kein_eingang") == 0);
    PRUEF(std::strcmp(a.starte(1, 7, 0, false, 100, ArrLage{2, 50, -1, -1}), "ueberlappung") == 0);   // Transport läuft schon
  }
  PRUEF(a.starte(1, 7, 0, false, 100, steht) == nullptr && a.status() == 2);
  PRUEF(std::strcmp(a.starte(2, 8, 0, false, 100, steht), "aufnahme_laeuft") == 0);
  // 3 Blöcke, in denen das Arrangement wartet; kein Chunk
  block(a, 256, 256, ArrLage{1, 1000, -1, -1});
  block(a, 512, 256, ArrLage{1, 1000, -1, -1});
  PRUEF(leere(p1).empty() && leere(p2).empty() && a.status() == 2);
  // Einsatz bei 1000 im Block [768, 1024): der Take beginnt EXAKT bei 1000
  block(a, 768, 256, ArrLage{2, 1000, -1, -1});
  AufnahmeMeldung m{};
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::EINSATZ && m.id == 1 && m.sample == 1000);
  PRUEF(a.status() == 3 && p1->phase.load() == 1 && p1->start_s == 1000 && p1->kennung == 7);
  // weiter bis 3000, Stopp geplant bei 2500 (Quant), Ende des Arrangements bei 2500
  for (int64_t s = 1024; s < 3072; s += 256)   // das Arrangement stoppt bei 2500: bis dahin spielt es mit geplantem Stopp, danach steht es und hat bei 2500 geendet
    block(a, s, 256, s + 256 <= 2500 ? ArrLage{2, 1000, -1, 2500} : ArrLage{0, 1000, 2500, -1});
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ENDE && m.id == 1 && m.sample == 2500);
  PRUEF(a.status() == 0 && p1->phase.load() == 2 && p1->ende_s == 2500);
  PRUEF(!a.aendern_erlaubt());   // m1: der Callback ist fertig (status 0), der Faden hat die Datei noch nicht geschlossen (phase 2): kein Wechsel der Spuren
  // Inhalt: erste Sample 1000, letztes 2499, bitgleich; erz/2 (Faktor 2) auf p1, erz/1 (Faktor 1) auf p2
  const std::vector<cdj::AufnahmeChunk> c1 = leere(p1), c2 = leere(p2);
  int64_t frames = 0;
  bool gleich = !c1.empty() && c1.front().s0 == 1000;
  int64_t naechstes = 1000;
  for (const cdj::AufnahmeChunk& c : c1) {
    gleich = gleich && c.s0 == naechstes;
    for (int i = 0; i < c.n; ++i) gleich = gleich && c.l[i] == sig_l(c.s0 + i) * 2 && c.r[i] == sig_r(c.s0 + i) * 2;
    naechstes = c.s0 + c.n;
    frames += c.n;
  }
  PRUEF(gleich && frames == 1500 && naechstes == 2500);
  PRUEF(!c2.empty() && c2.front().l[0] == sig_l(1000) * 1);   // die zweite Spur hört einen anderen Abgriff
  // Negativ-Kontrolle: nichts außerhalb [1000, 2500) im Ring, und ein zweiter Block nach dem Ende schreibt nichts mehr
  block(a, 3072, 256, steht);
  PRUEF(leere(p1).empty());
  // Abbruch vor dem Einsatz: Stopp-Befehl (ABBRUCH, kein Chunk); Frist; Cypher-KI-Stopp nur für wartende Starts von cypher
  PRUEF(p1->phase.load() == 2);   // bleibt, bis der Faden 3 setzt
  p1->phase.store(3);
  p2->phase.store(3);
  PRUEF(a.aendern_erlaubt());   // Negativ-Kontrolle zu m1: der Faden ist fertig, jetzt geht es wieder
  PRUEF(a.starte(3, 9, 0, true, 5000, steht) == nullptr);
  a.ki_stopp(5100);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 3 && std::strcmp(m.grund, "ki_stopp") == 0 && a.status() == 0);
  PRUEF(a.starte(4, 10, 0, false, 6000, steht) == nullptr);
  a.ki_stopp(6100);   // wartender Start von Andreas bleibt
  PRUEF(a.status() == 2 && !a.hole_meldung(m));
  a.stopp(6200);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 4 && std::strcmp(m.grund, "abbruch") == 0 && a.status() == 0);
  // Frist: kein Transportstart innerhalb von 2 s (96000 Samples) beendet den wartenden Start
  PRUEF(a.starte(5, 11, 0, false, 10000, steht) == nullptr);
  block(a, 10256, 256, steht);   // noch innerhalb der Frist: bleibt
  PRUEF(a.status() == 2);
  block(a, 10000 + 96000, 256, steht);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 5 && a.status() == 0);
  // M1 (Nachbesserung 1): die Frist endet, sobald das Arrangement wartet. Frist 48000; das Arrangement wartet auf einen Einsatz weit dahinter (Quant)
  PRUEF(a.starte(7, 13, 0, false, 300000, steht, 48000) == nullptr);
  block(a, 300256, 256, ArrLage{1, 500000, -1, -1});                    // wartet: gesehen
  block(a, 300000 + 48000 + 256, 256, ArrLage{1, 500000, -1, -1});      // hinter der Frist, das Arrangement wartet noch
  PRUEF(a.status() == 2 && !a.hole_meldung(m));
  block(a, 499968, 256, ArrLage{2, 500000, -1, -1});                    // Einsatz bei 500000
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::EINSATZ && m.sample == 500000 && a.status() == 3);
  block(a, 500224, 256, ArrLage{0, 500000, 500256, -1});                // das Arrangement endet bei 500256
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ENDE && m.sample == 500256 && a.status() == 0);
  PRUEF(leere(p1).size() == 1 && leere(p2).size() == 1);                // 224 + 32 Frames, am Ende als EIN Chunk ausgeschoben
  p1->phase.store(3);
  p2->phase.store(3);
  // Negativ-Kontrolle: die kürzere Frist gilt, solange nichts wartet
  PRUEF(a.starte(8, 14, 0, false, 600000, steht, 48000) == nullptr);
  block(a, 600000 + 48000 - 256, 256, steht);
  PRUEF(a.status() == 2);
  block(a, 600000 + 48000, 256, steht);
  PRUEF(a.hole_meldung(m) && m.art == AufnahmeMeldung::ABBRUCH && m.id == 8 && std::strcmp(m.grund, "zu_spaet") == 0);
  {  // Review-Nachzug Teil B (MAJOR 1, Spec 1.8 F2 „ein Durchgang“): mit Loop-Klammer endet der Take am ERSTEN Wrap, nicht erst am Stopp
    PRUEF(a.starte(9, 15, 0, false, 700000, steht) == nullptr);
    block(a, 700000, 256, ArrLage{2, 700100, -1, -1, 500});   // Einsatz bei 700100; die Naht 500 stammt von einem früheren Lauf und liegt vor dem Einsatz: kein Ende
    PRUEF(a.status() == 3);
    for (int64_t s = 700256; s < 701024; s += 256) block(a, s, 256, ArrLage{2, 700100, -1, -1, 500});
    PRUEF(a.status() == 3);
    block(a, 701024, 256, ArrLage{2, 700100, -1, -1, 701200});   // der Wrap liegt im Block [701024, 701280) bei 701200
    PRUEF(a.status() == 0);
    AufnahmeMeldung nm{};
    bool ende = false;
    while (a.hole_meldung(nm)) ende = ende || (nm.art == AufnahmeMeldung::ENDE && nm.id == 9 && nm.sample == 701200);
    PRUEF(ende);
    PRUEF(p1->phase.load() == 2 && p1->ende_s == 701200);
    int64_t n = 0;
    for (const cdj::AufnahmeChunk& c : leere(p1)) n += c.n;
    PRUEF(n == 701200 - 700100);   // genau ein Durchgang: vom Einsatz bis zur Naht, je ±0
    leere(p2);
    p1->phase.store(3);
    p2->phase.store(3);
  }
  // Ring voll: die abgelehnten Chunks werden gezählt
  PRUEF(a.starte(6, 12, 0, false, 200000, steht) == nullptr);
  block(a, 200256, 256, ArrLage{2, 200256, -1, -1});
  for (int i = 0; i < 600; ++i) block(a, 200512 + i * 256, 256, ArrLage{2, 200256, -1, -1});   // 600 Chunks ohne Leser: 512 passen
  PRUEF(a.luecken() > 0 && a.luecken() == p1->abgelehnt.load() + p2->abgelehnt.load());
  {  // m4 (Nachbesserung 1): kleine Teilblöcke füllen den Ring nicht schneller. 2000 Blöcke zu 64 Frames = 128 000 Frames passen in 512 Chunks zu 256 (131 072 Frames)
    Aufnahme b;
    RecSpur* q = RecSpur::neu(2, 12);
    PRUEF(b.setze(2, q) == nullptr);
    PRUEF(b.starte(1, 1, 0, false, 0, steht) == nullptr);
    const std::vector<float> l(64, 0.5f), r(64, -0.5f);
    const float* tl[3] = {l.data(), l.data(), l.data()};
    const float* tr[3] = {r.data(), r.data(), r.data()};
    for (int i = 0; i < 2000; ++i) b.block(64 + i * 64, 64, ArrLage{2, 64, -1, -1}, tl, tr);
    PRUEF(b.luecken() == 0);
    for (int i = 2000; i < 2100; ++i) b.block(64 + i * 64, 64, ArrLage{2, 64, -1, -1}, tl, tr);
    PRUEF(b.luecken() > 0);   // Negativ-Kontrolle: der Ring ist endlich, der Test kann einen Verlust sehen
    RecSpur::frei(q);
  }
  RecSpur::frei(p1);
  RecSpur::frei(p2);
  PRUEF_ENDE();
}
