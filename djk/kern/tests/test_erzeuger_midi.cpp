// Studio S5.1 Task 1: ein Strom mit MIDI-Ziel spielt kein Kit, sondern schreibt Note-On am Sample des Beats und Note-Off
// nach dauer (Beats) in den MIDI-Puffer seines Ports; Versatz relativ zum Zyklusanfang. Umhängen des Ports schickt
// offene Noten aus. Negativ-Kontrolle: Strom ohne MIDI → keine Ereignisse; ohne Puffer (midi = nullptr) → nichts.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "pruef.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM bei 48 kHz
constexpr int ERZ2 = 5;         // Mixer-Index erz/2
constexpr int NB = 1024;        // Glanz 2.7 Prüfung R3: Puffer für Zyklen bis Quantum 1024

struct Ev { int port; int64_t sample; uint8_t s, d1, d2; };

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * NB), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  cdj::MidiAus midi[cdj::ERZ_MIDI_PORTS];
  std::vector<Ev> evs;
  float max_erz2 = 0.0f;
  int64_t erstes_erz2 = -1;
  int64_t s = 0;
  Welt() { for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * NB]; r[k] = &pr[k * NB]; } }
  void bis(int64_t ende, bool mit_midi = true) {
    while (s < ende) {
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      for (auto& m : midi) m.leer();
      erz.block(karte, s, N, l, r, mit_midi ? midi : nullptr, s);  // Zyklus = ein Block
      for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p)
        for (int i = 0; i < midi[p].n; ++i) {
          const auto& e = midi[p].ev[i];
          evs.push_back({p + 1, s + (int64_t)e.t, e.b[0], e.b[1], e.b[2]});
        }
      for (int i = 0; i < N; ++i) { max_erz2 = std::max(max_erz2, std::abs(l[ERZ2][i])); if (erstes_erz2 < 0 && l[ERZ2][i] != 0.0f) erstes_erz2 = s + i; }
      s += N;
    }
  }
  // Glanz 2.7 Prüfung R3: ein Zyklus wie im Kern, Vorhalt aus dem Quantum n (2 · n + 25), dann ein block über n Samples
  void zyklus(int n) {
    erz.setze_midi_vorhalt((int64_t)cdj::ERZ_MIDI_RUNDWEG_ZYKLEN * n + cdj::ERZ_MIDI_VORHALT_REST);
    std::fill(pl.begin(), pl.end(), 0.0f);
    std::fill(pr.begin(), pr.end(), 0.0f);
    for (auto& m : midi) m.leer();
    erz.block(karte, s, n, l, r, midi, s);
    for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p)
      for (int i = 0; i < midi[p].n; ++i) {
        const auto& e = midi[p].ev[i];
        evs.push_back({p + 1, s + (int64_t)e.t, e.b[0], e.b[1], e.b[2]});
      }
    s += n;
  }
};

cdj::ErzFenster fenster2(double ab, double bis, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = 2;
  f.sendung = 1;
  f.ab_beat = ab;
  f.bis_beat = bis;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

cdj::ErzEv ev(double beat, int note, float vel, double dauer) {
  cdj::ErzEv e{beat, note, 1, vel};
  e.dauer = dauer;
  return e;
}

}  // namespace

int main() {
  cdj::Kit kit;  // ein Klang auf Note 36: darf bei MIDI-Ziel NICHT klingen
  kit.klang[36].frames = 1;
  kit.klang[36].daten = {1.0f, 1.0f};
  kit.n = 1;

  {  // 1) zwei Noten: On am Sample, Off nach dauer, Velocity 0..1 → 1..127, Kanal 1 (Status 0x90/0x80)
    Welt w;
    w.erz.setze_strom(2, &kit, ERZ2);
    w.erz.setze_midi(2, 1, 1);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5), ev(2.0, 39, 0.5f, 0.5)}), 0.0);
    w.bis(4 * SPB);
    std::printf("midi: %zu Ereignisse", w.evs.size());
    for (const auto& e : w.evs) std::printf(" [p%d %lld %02x %d %d]", e.port, (long long)e.sample, e.s, e.d1, e.d2);
    std::printf(", max erz/2 %.3f\n", w.max_erz2);
    PRUEF(w.evs.size() == 4);
    if (w.evs.size() == 4) {
      PRUEF(w.evs[0].port == 1 && w.evs[0].sample == SPB && w.evs[0].s == 0x90 && w.evs[0].d1 == 36 && w.evs[0].d2 == 127);
      PRUEF(w.evs[1].sample == SPB + SPB / 2 && w.evs[1].s == 0x80 && w.evs[1].d1 == 36);
      PRUEF(w.evs[2].sample == 2 * SPB && w.evs[2].s == 0x90 && w.evs[2].d1 == 39 && w.evs[2].d2 == 64);
      PRUEF(w.evs[3].sample == 2 * SPB + SPB / 2 && w.evs[3].s == 0x80 && w.evs[3].d1 == 39);
    }
    PRUEF(w.max_erz2 == 0.0f);  // das Kit schweigt, solange MIDI gilt
  }
  {  // 2) Port umhängen mitten in der Note: Off auf dem ALTEN Port im nächsten Block, Kanal 3 → Status 0x92
    Welt w;
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 3);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 40, 1.0f, 2.0)}), 0.0);
    w.bis(SPB + N);
    w.erz.setze_midi(2, 2, 3);
    w.bis(SPB + 3 * N);
    PRUEF(w.evs.size() == 2);
    if (w.evs.size() == 2) {
      PRUEF(w.evs[0].port == 1 && w.evs[0].s == 0x92 && w.evs[0].d1 == 40);
      PRUEF(w.evs[1].port == 1 && w.evs[1].s == 0x82 && w.evs[1].d1 == 40 && w.evs[1].sample < SPB + 3 * N);
    }
  }
  {  // 3) Negativ-Kontrollen: Strom ohne MIDI → keine MIDI-Ereignisse (Kit klingt); midi = nullptr → nichts, kein Absturz
    Welt w;
    w.erz.setze_strom(2, &kit, ERZ2);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    w.bis(2 * SPB);
    PRUEF(w.evs.empty() && w.max_erz2 > 0.5f);
    Welt v;
    v.erz.setze_strom(2, nullptr, ERZ2);
    v.erz.setze_midi(2, 1, 1);
    v.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    v.bis(2 * SPB, false);
    PRUEF(v.evs.empty());
  }
  {  // 4) Glanz 2.7 (F19): Vorhalt 537 = 2 · 256 + 25: On/Off 537 Samples vor dem Beat. Negativ-Kontrolle: ein Kit-Strom mit
     // demselben Vorhalt klingt weiter genau am Sample des Beats.
    Welt w;
    w.erz.setze_midi_vorhalt(537);
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 1);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    w.bis(2 * SPB);
    std::printf("midi vorhalt: %zu Ereignisse, On %lld (Soll %lld)\n", w.evs.size(), w.evs.empty() ? -1LL : (long long)w.evs[0].sample,
                (long long)(SPB - 537));
    PRUEF(w.evs.size() == 2);
    if (w.evs.size() == 2) {
      PRUEF(w.evs[0].sample == SPB - 537 && w.evs[0].s == 0x90);
      PRUEF(w.evs[1].sample == SPB + SPB / 2 - 537 && w.evs[1].s == 0x80);
    }
    Welt k;
    k.erz.setze_midi_vorhalt(537);
    k.erz.setze_strom(2, &kit, ERZ2);
    k.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.5)}), 0.0);
    k.bis(2 * SPB);
    std::printf("kit mit vorhalt: erstes erz/2-Sample %lld (Soll %lld)\n", (long long)k.erstes_erz2, (long long)SPB);
    PRUEF(k.evs.empty() && k.erstes_erz2 == SPB);
  }
  {  // 5) Glanz 2.7: für MIDI-Ströme liegt "jetzt" um den Vorhalt vorn (gesendet_bis). Ein Fenster, das die schon gesendete Note
     // (Beat 1) noch einmal bringt, spielt sie kein zweites Mal (zu_spaet); die Note dahinter (Beat 1,5) wird eingefügt.
    Welt w;
    w.erz.setze_midi_vorhalt(537);
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 1);
    w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.25)}), 0.0);
    w.bis(SPB - 256);  // s = 22272: das On (21963) ist hinaus, der Beat (22500) noch nicht
    const double jetzt = (double)w.s / SPB;
    const auto z = w.erz.fenster(fenster2(0.0, 8.0, {ev(1.0, 36, 1.0f, 0.25), ev(1.5, 38, 1.0f, 0.25)}), jetzt);
    w.bis(3 * SPB);
    int on36 = 0, on38 = 0;
    for (const auto& e : w.evs) {
      if (e.s == 0x90 && e.d1 == 36) ++on36;
      if (e.s == 0x90 && e.d1 == 38) ++on38;
    }
    std::printf("midi vorhalt fenster: On 36 %d (Soll 1), On 38 %d (Soll 1), zu_spaet %d (Soll 1), eingefuegt %d (Soll 1)\n", on36, on38,
                (int)z.zu_spaet, (int)z.eingefuegt);
    PRUEF(on36 == 1 && on38 == 1 && z.zu_spaet == 1 && z.eingefuegt == 1);
  }
  {  // 6) Glanz 2.7 Prüfung R3 (E3): Quantum 1024 -> 256 bei 88064. Gesendet ist bis 88064 + 2073, der erste 256er-Zyklus rechnet
     // MIDI-jetzt mit 88064 + 537. 40 Noten ab Beat 3,9 alle 112,5 Samples, ein spätes Fenster bringt alle noch einmal.
     // Soll: keine doppelt, keine fehlt (vorher 14 doppelt). Negativ-Kontrolle 6b: dasselbe ohne Quantumwechsel.
    for (int wechsel = 1; wechsel >= 0; --wechsel) {
      Welt w;
      w.erz.setze_strom(2, nullptr, ERZ2);
      w.erz.setze_midi(2, 1, 1);
      std::vector<cdj::ErzEv> v;
      for (int i = 0; i < 40; ++i) v.push_back(ev(3.9 + 0.005 * i, i, 1.0f, 0.004));
      cdj::ErzFenster f = fenster2(0.0, 16.0, {});
      for (const auto& e : v) f.ev[f.n++] = e;
      w.erz.fenster(f, 0.0);
      while (w.s < 88064) w.zyklus(wechsel ? 1024 : 256);
      w.erz.setze_midi_vorhalt(2 * 256 + 25);  // Kern: Zyklusanfang mit neuem Quantum, vor dem Einsortieren
      const double jetzt = w.karte.beat_at((double)w.s);
      f.ab_beat = jetzt;
      const auto z = w.erz.fenster(f, jetzt);
      while (w.s < 6 * SPB) w.zyklus(256);
      int on[40] = {}, doppelt = 0, fehlt = 0;
      for (const auto& e : w.evs)
        if (e.s == 0x90 && e.d1 < 40) ++on[e.d1];
      for (int i = 0; i < 40; ++i) { doppelt += on[i] > 1; fehlt += on[i] == 0; }
      std::printf("midi quantum %s: doppelt %d (Soll 0), fehlt %d (Soll 0), eingefuegt %d zu_spaet %d\n",
                  wechsel ? "1024->256" : "256 (Kontrolle)", doppelt, fehlt, (int)z.eingefuegt, (int)z.zu_spaet);
      PRUEF(doppelt == 0 && fehlt == 0);
    }
  }
  {  // 7) Glanz 2.7 Prüfung R3 (E4): Quantum 256 -> 1024 bei 87808. Noten zwischen alter und neuer Grenze gehen gesammelt am
     // Zyklusanfang hinaus; kurze Noten (90 Samples) hatten dort On und Off am selben Sample (vorher 13). Soll: jedes Off
     // mindestens ein Sample nach seinem On, keine Note verloren.
    Welt w;
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 1);
    cdj::ErzFenster f = fenster2(0.0, 16.0, {});
    for (int i = 0; i < 40; ++i) f.ev[f.n++] = ev(3.9 + 0.005 * i, i, 1.0f, 0.004);
    w.erz.fenster(f, 0.0);
    while (w.s < 87808) w.zyklus(256);
    const int64_t s1 = w.s;
    while (w.s < 6 * SPB) w.zyklus(1024);
    int64_t on_t[40], off_t[40];
    for (int i = 0; i < 40; ++i) on_t[i] = off_t[i] = -1;
    int am_anfang = 0, gleich = 0, falsch = 0;
    for (const auto& e : w.evs) {
      if (e.d1 >= 40) continue;
      if (e.s == 0x90) { on_t[e.d1] = e.sample; am_anfang += e.sample == s1; }
      if (e.s == 0x80) off_t[e.d1] = e.sample;
    }
    for (int i = 0; i < 40; ++i) {
      if (on_t[i] < 0 || off_t[i] < 0) ++falsch;
      else if (off_t[i] == on_t[i]) ++gleich;
      else if (off_t[i] < on_t[i]) ++falsch;
    }
    std::printf("midi quantum 256->1024: %d On am Zyklusanfang, On==Off %d (Soll 0), fehlend/Off vor On %d (Soll 0)\n", am_anfang, gleich,
                falsch);
    PRUEF(am_anfang > 0 && gleich == 0 && falsch == 0);
  }
  PRUEF_ENDE();
}
