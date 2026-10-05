// Scheibe 08: Tempo-Rampen im Callback ohne JACK. Pünktlich: nur Start (2) und Ende (3) an den Golden-Samples §1.3
// (Negativ-Kontrolle). Zu spät: Start am Blockanfang mit 5, Ende-Beat unverändert. Überlappung, Storno davor, Karte
// voll beim 65. Segment (02 NP N4) und die Gegenprobe: 100 Rampen nacheinander laufen nie voll.
#include <cmath>
#include <vector>

#include "cypherdj/tempoplan.h"
#include "pruef.h"

struct Meldung {
  int64_t id;
  int status;
  int64_t sample;
  double beat;
};

// Blöcke zu 256 von a bis ausschließlich b, wie der Callback: erst verwerfen, dann fällige melden
static void fahre(cdj::Tempoplan& p, int64_t a, int64_t b, std::vector<Meldung>& m) {
  for (int64_t n0 = a; n0 < b; n0 += 256) {
    p.verwerfe_vor(n0);
    p.faellige(n0, 256, [&](const cdj::RampeEintrag& e, int st, int64_t s, double bt) { m.push_back({e.id, st, s, bt}); });
  }
}

int main() {
  // 1) pünktlich: Rampe 128 -> 132 ab Beat 128 über 32 Beats, eingereicht bei Beat 96 (Sample 2 160 000)
  {
    cdj::Tempoplan p(128.0);
    std::vector<Meldung> m;
    fahre(p, 0, 2160000, m);
    PRUEF(p.rampe(2, "pruefstand", 128.0, 132.0, 32.0, 2160000) == cdj::Einsortiert::angenommen);
    PRUEF(p.wartend() == 1);
    // Golden-Werte §1.3, solange die Rampe noch in der Karte steht (danach verwirft verwerfe_vor sie)
    PRUEF_NAH(p.karte().sample_at(144.0), 3237188.004360675214, 1e-6);
    PRUEF_NAH(p.karte().sample_at(160.0), 3588923.076923076923, 1e-6);
    PRUEF_NAH(p.karte().sample_at(192.0), 4287104.895104895105, 1e-6);
    fahre(p, 2160000, 4400000, m);
    PRUEF(m.size() == 2);
    if (m.size() == 2) {
      PRUEF(m[0].status == 2 && m[0].sample == 2880000);
      PRUEF_NAH(m[0].beat, 128.0, 1e-9);
      PRUEF(m[1].status == 3 && m[1].sample == 3588923);
      PRUEF_NAH(m[1].beat, 160.0, 1e-5);
    }
    PRUEF_NAH(p.karte().sample_at(192.0), 4287104.895104895105, 1e-6);  // konstantes Segment bleibt
    PRUEF(p.karte().anzahl() == 1);  // Rampe und Anfangssegment verworfen (§1.3)
    PRUEF(p.eintraege() == 0 && p.wartend() == 0);
  }

  // 2) zu spät: dieselbe Rampe kommt erst 10 Blöcke nach ihrem Start-Sample an -> 5 am Blockanfang, Ende-Beat 160
  {
    cdj::Tempoplan p(128.0);
    std::vector<Meldung> m;
    const int64_t n0 = 2880000 + 10 * 256;
    fahre(p, 0, n0, m);
    PRUEF(p.rampe(2, "pruefstand", 128.0, 132.0, 32.0, n0) == cdj::Einsortiert::verspaetet);
    fahre(p, n0, 4400000, m);
    PRUEF(m.size() == 2);
    if (m.size() == 2) {
      PRUEF(m[0].status == 5 && m[0].sample == n0);
      PRUEF(m[1].status == 3);
      PRUEF_NAH(m[1].beat, 160.0, 2.5e-5);  // Ende-Beat unverändert (ganzzahliges Sample: bis 2,3e-5 Beats)
      PRUEF(m[1].sample == std::llround(p.karte().sample_at(160.0)));
    }
    PRUEF_NAH(p.karte().bpm_at(p.karte().sample_at(170.0)), 132.0, 1e-9);
  }

  // 3) so spät, dass das Ende schon vorbei ist: Rampe über 1 Beat ab dem Blockanfang (Mindestdauer, ADR 004)
  {
    cdj::Tempoplan p(128.0);
    std::vector<Meldung> m;
    const int64_t n0 = 100 * 22500;  // Beat 100
    fahre(p, 0, n0, m);
    PRUEF(p.rampe(3, "pruefstand", 10.0, 130.0, 1.0, n0) == cdj::Einsortiert::verspaetet);
    fahre(p, n0, n0 + 48000, m);
    PRUEF(m.size() == 2 && m[0].status == 5 && m[1].status == 3);
    if (m.size() == 2) PRUEF_NAH(m[1].beat, 101.0, 2.5e-5);
  }

  // 4) Überlappung: B schneidet A -> abgelehnt; C beginnt genau am Ende von A -> angenommen
  {
    cdj::Tempoplan p(128.0);
    PRUEF(p.rampe(1, "pruefstand", 64.0, 132.0, 32.0, 0) == cdj::Einsortiert::angenommen);
    PRUEF(p.rampe(2, "pruefstand", 80.0, 136.0, 32.0, 0) == cdj::Einsortiert::ueberlappung);
    PRUEF(p.rampe(3, "pruefstand", 96.0, 128.0, 4.0, 0) == cdj::Einsortiert::angenommen);
    PRUEF(p.eintraege() == 2);
  }

  // 5) Storno der früheren Rampe: die spätere gilt danach vom Tempo 128 aus (vom dann gültigen Tempo, §4.2)
  {
    cdj::Tempoplan p(128.0);
    PRUEF(p.rampe(2, "pruefstand", 64.0, 132.0, 32.0, 0) == cdj::Einsortiert::angenommen);
    PRUEF(p.rampe(4, "pruefstand", 128.0, 136.0, 32.0, 0) == cdj::Einsortiert::angenommen);
    PRUEF_NAH(p.karte().bpm_at(p.karte().sample_at(128.0) - 1.0), 132.0, 1e-9);  // vorher: B startet bei 132
    PRUEF(!p.storno(2, "cypher"));      // andere Quelle: nicht gefunden
    PRUEF(!p.storno(99, "pruefstand"));  // unbekannt
    PRUEF(p.storno(2, "pruefstand"));
    PRUEF(p.eintraege() == 1);
    PRUEF_NAH(p.karte().bpm_at(p.karte().sample_at(128.0) - 1.0), 128.0, 1e-9);
    PRUEF_NAH(p.karte().sample_at(128.0), 2880000.0, 1e-6);
    PRUEF_NAH(p.karte().sample_at(64.0), 1440000.0, 1e-6);
    // gestartete Rampe ist nicht mehr stornierbar
    std::vector<Meldung> m;
    fahre(p, 0, 2880000 + 256, m);
    PRUEF(m.size() == 1 && m[0].status == 2);
    PRUEF(!p.storno(4, "pruefstand"));
  }

  // 6) Karte voll: 62 Rampen zu je 1 Beat Stoß an Stoß ab Beat 8 belegen 64 Segmente; die 63. bräuchte das 65.
  {
    cdj::Tempoplan p(128.0);
    int ok = 0;
    for (int i = 0; i < 62; ++i)
      ok += p.rampe(10 + i, "pruefstand", 8.0 + i, (i % 2) ? 128.0 : 129.0, 1.0, 0) == cdj::Einsortiert::angenommen;
    PRUEF(ok == 62);
    PRUEF(p.karte().anzahl() == cdj::MAX_SEGMENTE);
    const double s_vorher = p.karte().sample_at(100.0);
    PRUEF(p.rampe(99, "pruefstand", 70.0, 129.0, 1.0, 0) == cdj::Einsortiert::karte_voll);
    PRUEF(p.karte().anzahl() == cdj::MAX_SEGMENTE);
    PRUEF(p.eintraege() == 62);
    PRUEF(p.karte().sample_at(100.0) == s_vorher);  // Karte unverändert
  }

  // 7) Gegenprobe zu 02 NP N4: 100 Rampen, jede erst nach dem Ende der vorigen eingereicht -> nie voll
  {
    cdj::Tempoplan p(128.0);
    std::vector<Meldung> m;
    int64_t n0 = 0;
    int ok = 0;
    for (int i = 0; i < 100; ++i) {
      const double ab = p.karte().beat_at((double)n0) + 2.0;
      ok += p.rampe(1000 + i, "pruefstand", ab, (i % 2) ? 128.0 : 130.0, 1.0, n0) == cdj::Einsortiert::angenommen;
      const int64_t bis = std::llround(p.karte().sample_at(ab + 1.0)) + 512;
      fahre(p, n0, bis, m);
      n0 = (bis + 255) / 256 * 256;  // nächster Blockanfang
      PRUEF(p.karte().anzahl() <= 3);
    }
    PRUEF(ok == 100);
    PRUEF(m.size() == 200);
  }
  PRUEF_ENDE();
}
