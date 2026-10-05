// Scheibe 18: Karte::setze und Tempoplan::wiederherstellen. Ein Tempoplan mit einer laufenden und einer wartenden
// Rampe wird in einen frischen übertragen (Grundkarte, wirksame Karte, Einträge); beide liefern danach dieselben
// Quittungen am selben Sample und dieselbe Karte. Fehlerfall zum Vergleich: nur die wirksame Karte ohne Einträge
// übertragen (die wartende Rampe hat keinen Eintrag mehr): ihr Start und ihr Ende werden nicht gemeldet.
// Negativ-Kontrollen: ungültige Segmentzahl und mehr als 256 Einträge ändern nichts.
#include <vector>

#include "cypherdj/tempoplan.h"
#include "pruef.h"

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
};

static std::vector<Q> laufe(cdj::Tempoplan& p, int64_t von, int64_t bis) {
  std::vector<Q> q;
  for (int64_t n0 = von; n0 < bis; n0 += 256) {
    p.verwerfe_vor(n0);
    p.faellige(n0, 256, [&](const cdj::RampeEintrag& e, int32_t st, int64_t s, double) { q.push_back({e.id, st, s}); });
  }
  return q;
}

int main() {
  cdj::Tempoplan a(128.0);
  PRUEF(a.rampe(3, "leitstand", 64.0, 132.0, 32.0, 0) == cdj::Einsortiert::angenommen);   // läuft ab 1 440 000
  PRUEF(a.rampe(4, "leitstand", 128.0, 124.0, 8.0, 0) == cdj::Einsortiert::angenommen);   // wartet
  laufe(a, 0, 1'664'000);  // Absturz bei Beat 74: Rampe 3 gestartet, Rampe 4 wartet
  PRUEF(a.eintraege() == 2 && a.eintrag(0).gestartet && !a.eintrag(1).gestartet);

  // Übertragen in einen frischen Plan, wie der neue Kern aus dem Zustand
  std::vector<cdj::RampeEintrag> e;
  for (int i = 0; i < a.eintraege(); ++i) e.push_back(a.eintrag(i));
  cdj::Tempoplan b(128.0);
  PRUEF(b.wiederherstellen(a.basis(), a.karte(), e.data(), (int)e.size()));
  for (double beat = 60.0; beat <= 200.0; beat += 0.5) PRUEF_NAH(b.karte().sample_at(beat), a.karte().sample_at(beat), 0.0);
  const auto qa = laufe(a, 1'664'000, 4'500'000);
  const auto qb = laufe(b, 1'664'000, 4'500'000);
  PRUEF(qa.size() == 3);  // 3 fertig, 4 gestartet, 4 fertig
  PRUEF(qa.size() == qb.size());
  for (size_t i = 0; i < qa.size() && i < qb.size(); ++i)
    PRUEF(qa[i].id == qb[i].id && qa[i].status == qb[i].status && qa[i].sample == qb[i].sample);

  // Fehlerfall: nur die wirksame Karte, keine Einträge -> keine Quittungen für 3 und 4
  cdj::Tempoplan c(128.0);
  PRUEF(c.wiederherstellen(a.basis(), a.karte(), nullptr, 0));
  PRUEF(laufe(c, 1'664'000, 4'500'000).empty());

  // Negativ-Kontrollen: Karte::setze mit 0 oder 65 Segmenten, wiederherstellen mit 257 Einträgen
  cdj::Karte k(120.0, 0);
  cdj::Segment s[65] = {};
  PRUEF(!k.setze(s, 0) && !k.setze(s, 65));
  PRUEF(k.anzahl() == 1 && k.segment(0).bpm0 == 120.0);
  std::vector<cdj::RampeEintrag> zuviel(257);
  cdj::Tempoplan d(128.0);
  PRUEF(!d.wiederherstellen(a.basis(), a.karte(), zuviel.data(), 257));
  PRUEF(d.eintraege() == 0 && d.karte().anzahl() == 1);
  PRUEF_ENDE();
}
