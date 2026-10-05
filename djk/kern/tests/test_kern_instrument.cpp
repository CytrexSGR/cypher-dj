// Studio S5.1 Task 2: /erz/strom mit midi:1:1 auf erz/2 → Note-On/Off erscheinen in midi_aus(1) am richtigen Sample;
// ein Rückweg (Wirt-Audio) auf erz/2 kommt nach dem Fader im /pegel an. Negativ: ohne Rückweg erz/2 still;
// midi:5:1 wird abgewiesen (Quittung 6).
#include "cypherdj/erzeuger.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

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
    const int64_t soll_on = std::llround(8.5 * SPB), soll_off = std::llround(9.5 * SPB);
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
  PRUEF_ENDE();
}
