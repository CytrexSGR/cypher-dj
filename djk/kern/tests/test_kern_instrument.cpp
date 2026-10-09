// Studio S5.1 Task 2: /erz/strom mit midi:1:1 auf erz/2 → Note-On/Off erscheinen in midi_aus(1) am richtigen Sample;
// ein Rückweg (Wirt-Audio) auf erz/2 kommt nach dem Fader im /pegel an. Negativ: ohne Rückweg erz/2 still;
// midi:5:1 wird abgewiesen (Quittung 6).
#include "cypherdj/erzeuger.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

namespace {

// Glanz 2.7 Prüfung (R2, R3): Strom 2 als MIDI-Strom, ein Fenster mit Note 36 auf Beat 4 und 38 auf Beat 4,5 (je 0,25 Beat).
// Bis Sample S laufen Zyklen zu n_vor, dann kommt ein spätes Fenster (ab = jetzt) mit denselben Noten, danach Zyklen zu n_nach.
// Ergebnis: Note-On/Off-Samples und die Zähler der Quittung des späten Fensters (Prüfer-Probe probe_kern.cpp, K1/K2).
struct Spaet {
  std::vector<int64_t> on36, off36;
  int on38 = 0, zu_spaet = -1, eingefuegt = -1;
};
Spaet spaetes_fenster(const std::string& ab, int n_vor, int n_nach, int64_t S, int64_t bis, double dauer36 = 0.25) {
  Lauf x(ab, nullptr);
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 2;
  std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
  s.form = 1;
  s.politik = 1;
  s.zeiger = nullptr;
  x.sende(s);
  auto* f1 = new cdj::ErzFenster{};
  f1->strom = 2; f1->sendung = 1; f1->ab_beat = 0.0; f1->bis_beat = 16.0;
  cdj::ErzEv a{4.0, 36, 1, 1.0f}, b{4.5, 38, 1, 1.0f};
  a.dauer = dauer36;
  b.dauer = 0.25;
  f1->ev[f1->n++] = a;
  f1->ev[f1->n++] = b;
  auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c.zeiger = f1;
  x.sende(c);
  Spaet r;
  const auto sammeln = [&](int64_t z0) {
    const cdj::MidiAus& m = x.kern->midi_aus(1);
    for (int i = 0; i < m.n; ++i) {
      const int st = m.ev[i].b[0] & 0xf0, note = m.ev[i].b[1];
      if (st == 0x90 && note == 36) r.on36.push_back(z0 + m.ev[i].t);
      if (st == 0x80 && note == 36) r.off36.push_back(z0 + m.ev[i].t);
      if (st == 0x90 && note == 38) ++r.on38;
    }
    cdj::Ereignis e;
    while (x.ere->hole(e))
      if (e.art == cdj::Ereignis::ERZ_QUITTUNG && e.fassung == 2) { r.eingefuegt = e.erz_zahl[2]; r.zu_spaet = e.erz_zahl[3]; }
  };
  while (x.kern->sample() < S) { const int64_t z0 = x.kern->sample(); x.kern->zyklus(n_vor, z0 * 20833); sammeln(z0); }
  auto* f2 = new cdj::ErzFenster{*f1};
  f2->sendung = 2;
  f2->ab_beat = (double)x.kern->sample() / SPB;
  auto c2 = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
  c2.zeiger = f2;
  x.sende(c2);
  while (x.kern->sample() < bis) { const int64_t z0 = x.kern->sample(); x.kern->zyklus(n_nach, z0 * 20833); sammeln(z0); }
  delete f1;
  delete f2;
  return r;
}

void zeige(const char* name, const Spaet& r) {
  std::printf("%s: On36 %zu (Soll 1)", name, r.on36.size());
  for (auto t : r.on36) std::printf(" t=%lld", (long long)t);
  std::printf(", Off36");
  for (auto t : r.off36) std::printf(" t=%lld", (long long)t);
  std::printf(", On38 %d (Soll 1), zu_spaet %d, eingefuegt %d\n", r.on38, r.zu_spaet, r.eingefuegt);
}

}  // namespace

int main() {
  Arbeitsbestand ab("test_kern_instrument");
  {  // 1) MIDI am Sample
    Lauf x(ab.pfad, nullptr);
    auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
    s.nr = 2;
    std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
    s.form = 1;     // MIDI-Port (so legt netz_erz.cpp midi:1:1 ab)
    s.politik = 1;  // MIDI-Kanal
    s.zeiger = nullptr;
    x.sende(s);
    auto* f = new cdj::ErzFenster{};
    f->strom = 2; f->sendung = 1; f->ab_beat = 8.0; f->bis_beat = 12.0;
    cdj::ErzEv e{8.5, 36, 1, 1.0f};
    e.dauer = 1.0;
    f->ev[f->n++] = e;
    auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c.zeiger = f;
    x.sende(c);
    std::vector<std::pair<int64_t, int>> ons, offs;
    while (x.kern->sample() < 12 * SPB) {
      const int64_t z0 = x.kern->sample();
      x.kern->zyklus(N, z0 * 20833);
      const cdj::MidiAus& m = x.kern->midi_aus(1);
      for (int i = 0; i < m.n; ++i) {
        if ((m.ev[i].b[0] & 0xf0) == 0x90) ons.push_back({z0 + m.ev[i].t, m.ev[i].b[1]});
        if ((m.ev[i].b[0] & 0xf0) == 0x80) offs.push_back({z0 + m.ev[i].t, m.ev[i].b[1]});
      }
    }
    // Glanz 2.7 (F19): MIDI geht um den Wirt-Rundweg früher hinaus, ERZ_MIDI_RUNDWEG_ZYKLEN · N + ERZ_MIDI_VORHALT_REST = 2 · 256 + 25
    constexpr int64_t VORHALT = 2 * N + 25;
    const int64_t soll_on = std::llround(8.5 * SPB) - VORHALT, soll_off = std::llround(9.5 * SPB) - VORHALT;
    std::printf("instrument midi: ons %zu (erstes %lld, Soll %lld), offs %zu (erstes %lld, Soll %lld)\n", ons.size(),
                ons.empty() ? -1LL : (long long)ons[0].first, (long long)soll_on, offs.size(),
                offs.empty() ? -1LL : (long long)offs[0].first, (long long)soll_off);
    PRUEF(ons.size() == 1 && ons[0].first == soll_on && ons[0].second == 36);
    PRUEF(offs.size() == 1 && offs[0].first == soll_off);
    delete f;
  }
  {  // 2) Rückweg addiert in erz/2 (vor Trim, nach dem Fader gemessen); Negativ: ohne Rückweg −200
    static float wirt_l[8192], wirt_r[8192];
    for (int i = 0; i < 8192; ++i) wirt_l[i] = wirt_r[i] = (i % 64 < 32) ? 0.25f : -0.25f;  // Rechteck 750 Hz
    float mit = -999.0f, ohne = -999.0f;
    for (int lauf = 0; lauf < 2; ++lauf) {
      Lauf x(ab.pfad, nullptr);
      x.teil("erz/2/fader", 0.0f, 0.0, 0.0);
      if (lauf == 0) x.kern->rueck(2, wirt_l, wirt_r);
      x.zyklen(4 * SPB);
      float p = -999.0f;
      for (const auto& ev : x.alle(cdj::Ereignis::PEGEL, "erz/2")) p = std::max(p, ev.pegel[0]);
      (lauf == 0 ? mit : ohne) = p;
    }
    std::printf("instrument rueckweg: erz/2 mit %.1f dB, ohne %.1f dB\n", mit, ohne);
    PRUEF(mit > -20.0f && mit < 0.0f);
    PRUEF(ohne <= -100.0f);
  }
  {  // 3) Glanz 2.7 Prüfung R2: Doppelnoten-Schutz am Kern (ERZ_FENSTER mit MIDI-jetzt). Quantum 256, On 36 bei 90000 − 537 =
     // 89463 ist im Zyklus 89344..89600 hinaus; ein spätes Fenster bei s = 89600 (Beat 3,982) bringt Note 36 noch einmal.
    const Spaet k1 = spaetes_fenster(ab.pfad, 256, 256, 89600, 6 * SPB);
    zeige("K1 Quantum 256, spaetes Fenster bei 89600", k1);
    PRUEF(k1.on36.size() == 1 && k1.on36[0] == 90000 - 537);
    PRUEF(k1.on38 == 1 && k1.zu_spaet == 1 && k1.eingefuegt == 1);
  }
  {  // 4) Glanz 2.7 Prüfung R3: Quantum 1024 -> 256. Im letzten 1024er-Zyklus (87040..88064) ist On 36 bei 90000 − 2073 = 87927
     // schon hinaus; der erste 256er-Zyklus rechnet MIDI-jetzt nur mit s + 537 = 88601 < 90000. Das späte Fenster darf die Note
     // trotzdem nicht ein zweites Mal bringen (vorher: On bei 87927 und 89463).
    const Spaet k2 = spaetes_fenster(ab.pfad, 1024, 256, 88064, 6 * SPB);
    zeige("K2 Quantum 1024->256, spaetes Fenster bei 88064", k2);
    PRUEF(k2.on36.size() == 1 && k2.on36[0] == 90000 - 2073);
    PRUEF(k2.on38 == 1 && k2.zu_spaet == 1 && k2.eingefuegt == 1);
  }
  {  // 5) Glanz 2.7 Prüfung R3: Quantum 256 -> 1024 bei 88064 mit kurzer Note 36 (0,004 Beat = 90 Samples). On (87927) und Off
     // (90090 − 2073 = 88017) liegen beide vor dem Zyklusanfang und gingen am selben Sample hinaus (Länge 0 am Wirt). Soll: Off
     // mindestens ein Sample nach dem On.
    const Spaet k3 = spaetes_fenster(ab.pfad, 256, 1024, 88064, 6 * SPB, 0.004);
    zeige("K3 Quantum 256->1024 bei 88064, Note 36 kurz", k3);
    PRUEF(k3.on36.size() == 1 && k3.off36.size() == 1);
    if (k3.on36.size() == 1 && k3.off36.size() == 1) PRUEF(k3.on36[0] == 88064 && k3.off36[0] > k3.on36[0]);
  }
  {  // 6) Glanz 2.7 Prüfung R5: der Vorhalt folgt dem Quantum (2 · n + 25), nicht fest 537. Quantum 128 und 512, Note auf Beat 8,5.
    for (const int n : {128, 512}) {
      Lauf x(ab.pfad, nullptr);
      auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
      s.nr = 2;
      std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
      s.form = 1;
      s.politik = 1;
      s.zeiger = nullptr;
      x.sende(s);
      auto* f = new cdj::ErzFenster{};
      f->strom = 2; f->sendung = 1; f->ab_beat = 8.0; f->bis_beat = 12.0;
      cdj::ErzEv e{8.5, 36, 1, 1.0f};
      e.dauer = 1.0;
      f->ev[f->n++] = e;
      auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
      c.zeiger = f;
      x.sende(c);
      std::vector<int64_t> ons, offs;
      while (x.kern->sample() < 12 * SPB) {
        const int64_t z0 = x.kern->sample();
        x.kern->zyklus(n, z0 * 20833);
        const cdj::MidiAus& m = x.kern->midi_aus(1);
        for (int i = 0; i < m.n; ++i) {
          if ((m.ev[i].b[0] & 0xf0) == 0x90) ons.push_back(z0 + m.ev[i].t);
          if ((m.ev[i].b[0] & 0xf0) == 0x80) offs.push_back(z0 + m.ev[i].t);
        }
      }
      const int64_t vorhalt = 2 * n + 25, soll_on = std::llround(8.5 * SPB) - vorhalt, soll_off = std::llround(9.5 * SPB) - vorhalt;
      std::printf("instrument quantum %d: On %lld (Soll %lld), Off %lld (Soll %lld)\n", n, ons.empty() ? -1LL : (long long)ons[0],
                  (long long)soll_on, offs.empty() ? -1LL : (long long)offs[0], (long long)soll_off);
      PRUEF(ons.size() == 1 && ons[0] == soll_on);
      PRUEF(offs.size() == 1 && offs[0] == soll_off);
      delete f;
    }
  }
  {  // 7) Glanz 2.7 Re-Prüfung N1: /k/set/neu setzt gesendet_bis zurück (Erzeuger::leeren). 64 Beats alte Achse mit Note 50 auf
     // Beat 2, dann SET_NEU und 8 Noten auf Beat 1 bis 8 der neuen Achse: alle 8 klingen. Fehlerfall: gesendet_bis der alten Achse
     // (Beat ~64) bleibt stehen, die MIDI-Ströme schweigen, bis die neue Achse dort ankommt (Prüfer-Probe: 0 statt 8).
    Lauf x(ab.pfad, nullptr);
    auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
    s.nr = 2;
    std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
    s.form = 1;
    s.politik = 1;
    s.zeiger = nullptr;
    x.sende(s);
    auto* f1 = new cdj::ErzFenster{};
    f1->strom = 2; f1->sendung = 1; f1->ab_beat = 0.0; f1->bis_beat = 16.0;
    cdj::ErzEv a{2.0, 50, 1, 1.0f};
    a.dauer = 0.25;
    f1->ev[f1->n++] = a;
    auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c.zeiger = f1;
    x.sende(c);
    std::vector<int64_t> ons;
    const auto lauf = [&](int64_t bis) {
      while (x.kern->sample() < bis) {
        const int64_t z0 = x.kern->sample();
        x.kern->zyklus(N, z0 * 20833);
        const cdj::MidiAus& m = x.kern->midi_aus(1);
        for (int i = 0; i < m.n; ++i)
          if ((m.ev[i].b[0] & 0xf0) == 0x90 && m.ev[i].b[1] != 50) ons.push_back(z0 + m.ev[i].t);
      }
    };
    lauf(64 * SPB);
    auto sn = x.neu(cdj::Befehl::SET_NEU, "andreas");
    sn.bpm = 128.0;
    x.sende(sn);
    x.kern->zyklus(N, 0);  // SET_NEU einsortiert, danach beginnt die neue Achse bei Sample 0
    auto* f2 = new cdj::ErzFenster{};
    f2->strom = 2; f2->sendung = 2; f2->ab_beat = 1.0; f2->bis_beat = 16.0;
    for (int i = 0; i < 8; ++i) {
      cdj::ErzEv e{1.0 + i, 36 + i, 1, 1.0f};
      e.dauer = 0.25;
      f2->ev[f2->n++] = e;
    }
    auto c2 = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c2.zeiger = f2;
    x.sende(c2);
    lauf(10 * SPB);
    std::printf("set/neu nach 64 Beats, 8 Noten auf Beat 1..8: %zu Note-On (Soll 8)", ons.size());
    for (auto t : ons) std::printf(" %lld", (long long)t);
    std::printf("\n");
    PRUEF(ons.size() == 8);
    if (ons.size() == 8) PRUEF(ons[0] == SPB - 537 && ons[7] == 8 * SPB - 537);
    delete f1;
    delete f2;
  }
  {  // 8) Glanz 2.7 Re-Prüfung N2: Quantum 256 -> 1024 bei 87808, ein Ersatz-Fenster tauscht Note 36 auf Beat 3,93 (Sample 88425,
     // gesendet erst bis 88345) gegen Note 40. Die 36 ist noch nicht hinaus, also gilt der Ersatz: 40 klingt, 36 nicht. Fehlerfall:
     // "jetzt" aus Sample + neuem Vorhalt (87808 + 2073) statt aus dem Gesendeten, 40 zählt zu_spaet und die alte 36 klingt.
    Lauf x(ab.pfad, nullptr);
    auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
    s.nr = 2;
    std::snprintf(s.pfad, sizeof s.pfad, "erz/2");
    s.form = 1;
    s.politik = 1;
    s.zeiger = nullptr;
    x.sende(s);
    auto* f1 = new cdj::ErzFenster{};
    f1->strom = 2; f1->sendung = 1; f1->ab_beat = 0.0; f1->bis_beat = 16.0;
    cdj::ErzEv a{3.93, 36, 1, 1.0f};
    a.dauer = 0.1;
    f1->ev[f1->n++] = a;
    auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c.zeiger = f1;
    x.sende(c);
    int on36 = 0, on40 = 0, zu_spaet = -1, eingefuegt = -1;
    const auto lauf = [&](int n, int64_t bis) {
      while (x.kern->sample() < bis) {
        const int64_t z0 = x.kern->sample();
        x.kern->zyklus(n, z0 * 20833);
        const cdj::MidiAus& m = x.kern->midi_aus(1);
        for (int i = 0; i < m.n; ++i)
          if ((m.ev[i].b[0] & 0xf0) == 0x90) { on36 += m.ev[i].b[1] == 36; on40 += m.ev[i].b[1] == 40; }
        cdj::Ereignis e;
        while (x.ere->hole(e))
          if (e.art == cdj::Ereignis::ERZ_QUITTUNG && e.fassung == 2) { eingefuegt = e.erz_zahl[2]; zu_spaet = e.erz_zahl[3]; }
      }
    };
    lauf(256, 87808);
    auto* f2 = new cdj::ErzFenster{};
    f2->strom = 2; f2->sendung = 2; f2->ab_beat = 87808.0 / SPB; f2->bis_beat = 16.0;
    cdj::ErzEv b{3.93, 40, 1, 1.0f};
    b.dauer = 0.1;
    f2->ev[f2->n++] = b;
    auto c2 = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c2.zeiger = f2;
    x.sende(c2);
    lauf(1024, 5 * SPB);
    std::printf("quantum 256->1024, Ersatz 36 -> 40 (Sample 88425): On36 %d (Soll 0), On40 %d (Soll 1), eingefuegt %d, zu_spaet %d\n", on36,
                on40, eingefuegt, zu_spaet);
    PRUEF(on36 == 0 && on40 == 1 && eingefuegt == 1 && zu_spaet == 0);
    delete f1;
    delete f2;
  }
  PRUEF_ENDE();
}
