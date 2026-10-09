// Plan MVP 2 Task 3: Loop-Boxen ohne Kern (ADR 025). Ein 4-Takt-Loop trägt als Wert seine eigene Position (links +pos,
// rechts −pos), so zeigt jedes Ausgangs-Sample, wo die Box im Loop steht. Soll: Position = s mod 360 000 (Beat 0 auf
// Sample 0, 128 BPM). Start bei Beat 5 setzt auf Beat 8 ein, mitten im Loop (Takt 3 von 4). Fehlerfall
// test_loopbox_mutation (Position ab dem Einsatz statt aus dem Beat) beginnt bei 0 und scheitert.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "cypherdj/loopbox.h"
#include "pruef.h"
#include "sprungmass.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;
constexpr int L1 = 12;  // Mixer-Index pad/1

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::LoopBoxen boxen;
  std::vector<float> puffer_l = std::vector<float>(cdj::MIX_KANAELE * N), puffer_r = puffer_l;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  std::vector<float> aus_l, aus_r;
  std::vector<cdj::BoxMeldung> meldungen;
  int64_t s = 0;
  explicit Welt(double bpm = 128.0) : karte(bpm, 0) {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &puffer_l[k * N]; r[k] = &puffer_r[k * N]; }
  }
  void bis(int64_t ende) {
    while (s < ende) {
      std::fill(puffer_l.begin(), puffer_l.end(), 0.0f);
      std::fill(puffer_r.begin(), puffer_r.end(), 0.0f);
      cdj::BoxMeldung m[8];
      const int nm = boxen.block(karte, s, N, l, r, m, 8);
      meldungen.insert(meldungen.end(), m, m + nm);
      aus_l.insert(aus_l.end(), l[L1], l[L1] + N);
      aus_r.insert(aus_r.end(), r[L1], r[L1] + N);
      s += N;
    }
  }
  double jetzt() const { return karte.beat_at((double)s); }
  // Prüfung 2.3: Blöcke höchstens n Samples, genau bis ende (bis() rundet auf die Blockgrenze auf)
  void bis_genau(int64_t ende, int n) {
    while (s < ende) {
      const int m = (int)std::min<int64_t>(n, ende - s);
      std::fill(puffer_l.begin(), puffer_l.end(), 0.0f);
      std::fill(puffer_r.begin(), puffer_r.end(), 0.0f);
      cdj::BoxMeldung mm[8];
      const int nm = boxen.block(karte, s, m, l, r, mm, 8);
      meldungen.insert(meldungen.end(), mm, mm + nm);
      aus_l.insert(aus_l.end(), l[L1], l[L1] + m);
      aus_r.insert(aus_r.end(), r[L1], r[L1] + m);
      s += m;
    }
  }
};

cdj::Loop rampe(int beats) {
  cdj::Loop lp;
  lp.name = "rampe";
  lp.beats = beats;
  lp.frames = (int64_t)beats * SPB;
  lp.daten.resize((size_t)lp.frames * 2);
  for (int64_t i = 0; i < lp.frames; ++i) {
    lp.daten[2 * i] = (float)i;
    lp.daten[2 * i + 1] = -(float)i;
  }
  return lp;
}

cdj::Loop konstant(float w) {
  cdj::Loop lp;
  lp.name = "konstant";
  lp.beats = 4;
  lp.frames = 4 * SPB;
  lp.daten.assign((size_t)lp.frames * 2, w);
  return lp;
}

bool gleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

int main() {
  const cdj::Loop vier = rampe(16);
  {  // 1. Einsatz an der Takt-Eins, Position aus dem Beat, Stopp an der Takt-Eins
    Welt w;
    PRUEF(w.boxen.laden(1, &vier) == nullptr && w.boxen.status(1) == cdj::BoxStatus::bereit);
    w.bis(5 * SPB);
    PRUEF(w.boxen.start(1, w.jetzt()) && w.boxen.status(1) == cdj::BoxStatus::wartet);
    w.bis(13 * SPB + 11 * N);
    PRUEF(w.boxen.stopp(1, w.jetzt()) && w.boxen.status(1) == cdj::BoxStatus::endet);
    w.bis(18 * SPB);
    const int64_t ein = 8 * SPB, aus = 16 * SPB;
    int falsch = 0;
    for (int64_t t = 0; t < 18 * SPB; ++t) {
      if ((t >= ein && t < ein + cdj::LOOPBOX_EIN) || (t >= aus - cdj::LOOPBOX_AUS && t < aus)) continue;  // F15: Hülle
      const float soll = (t >= ein && t < aus) ? (float)(t % 360000) : 0.0f;
      if (w.aus_l[t] != soll || w.aus_r[t] != -soll) ++falsch;
    }
    std::printf("einsatz: Sample %lld Wert %.0f (Soll 180000), vor dem Einsatz %.0f, falsche Samples %d\n",
                (long long)ein, w.aus_l[ein], w.aus_l[ein - 1], falsch);
    PRUEF(falsch == 0);
    PRUEF(w.boxen.status(1) == cdj::BoxStatus::bereit);
    PRUEF(w.meldungen.size() == 2 && w.meldungen[0].status == cdj::BoxStatus::laeuft && w.meldungen[0].sample == ein &&
          w.meldungen[1].status == cdj::BoxStatus::bereit && w.meldungen[1].sample == aus);
  }
  {  // 2. (F13, Welle 2) Tausch im Lauf: kein harter Wechsel. laden() gibt nichts sofort zurück, der alte Loop blendet über
     // LOOPBOX_LADEN_BLENDE (960) Frames gleich laut (sin/cos) in den neuen, danach rein der neue; der alte kommt genau einmal über abholen().
     // Konstant 1 -> konstant −1: hart wäre ein Sprung von 2,0 (Erhebung loop_tausch: 0,3645, sonde: 0,5959).
    Welt w;
    const cdj::Loop plus = konstant(1.0f), minus = konstant(-1.0f);
    w.boxen.laden(1, &plus);
    w.boxen.start(1, w.jetzt());
    w.bis(2 * SPB);
    PRUEF(w.boxen.laden(1, &minus) == nullptr && w.boxen.status(1) == cdj::BoxStatus::laeuft);
    const int64_t S = w.s;
    w.bis(S + 4096);
    const sprung::Mass m = sprung::messe(w.aus_l, S - 10, S + 4096);
    int nicht_neu = 0;
    for (int64_t t = S + cdj::LOOPBOX_LADEN_BLENDE; t < S + 4096; ++t)
      if (w.aus_l[t] != -1.0f) ++nicht_neu;
    std::printf("f13_laden: größter Sprung %.5f bei %lld, Mitte %.5f, nach 960 nicht rein %d\n", m.d1, (long long)m.ort1,
                w.aus_l[S + 480], nicht_neu);
    PRUEF(m.d1 < 0.01);
    PRUEF(nicht_neu == 0 && w.aus_l[S - 1] == 1.0f && std::fabs(w.aus_l[S + 480]) < 0.01f);  // sin/cos: Mitte 0
    PRUEF(w.boxen.loop(1) == &minus && w.boxen.abholen() == &plus && w.boxen.abholen() == nullptr);
    // Negativ-Kontrolle: Laden in eine stehende Box tauscht sofort und gibt den alten zurück (wie bisher)
    Welt x;
    x.boxen.laden(1, &plus);
    PRUEF(x.boxen.laden(1, &minus) == &plus && x.boxen.loop(1) == &minus && x.boxen.abholen() == nullptr);
  }
  {  // 3. Stopp einer wartenden Box: sofort bereit, kein Einsatz; Start einer endenden Box: läuft weiter
    Welt w;
    w.boxen.laden(2, &vier);
    w.bis(SPB);
    w.boxen.start(2, w.jetzt());
    w.boxen.stopp(2, w.jetzt());
    PRUEF(w.boxen.status(2) == cdj::BoxStatus::bereit);
    w.bis(6 * SPB);
    PRUEF(w.meldungen.empty());
    w.boxen.start(2, w.jetzt());  // wartet auf Beat 8
    w.bis(9 * SPB);
    w.boxen.stopp(2, w.jetzt());
    w.boxen.start(2, w.jetzt());
    PRUEF(w.boxen.status(2) == cdj::BoxStatus::laeuft);
  }
  {  // F15 (Welle 2): Einsatz und Stopp mit Hülle. Konstant 0,5: ohne Hülle springt der Ausgang am Einsatz 0 -> 0,5 und am
     // Stopp 0,5 -> 0. Soll: Einblende LOOPBOX_EIN, Ausblende LOOPBOX_AUS bis genau 0 am letzten Sample vor dem
     // Stoppsample, dazwischen bitgenau 0,5.
    const cdj::Loop halb = konstant(0.5f);
    Welt w;
    w.boxen.laden(1, &halb);
    w.bis(SPB);
    w.boxen.start(1, w.jetzt());  // Einsatz auf Beat 4
    w.bis(5 * SPB + 3 * N);
    w.boxen.stopp(1, w.jetzt());  // Stopp auf Beat 8
    w.bis(9 * SPB);
    const int64_t ein = 4 * SPB, aus = 8 * SPB;
    const sprung::Mass m = sprung::messe(w.aus_l, ein - 10, aus + 10);
    int innen_falsch = 0;
    for (int64_t t = ein + cdj::LOOPBOX_EIN; t < aus - cdj::LOOPBOX_AUS; ++t)
      if (w.aus_l[t] != 0.5f) ++innen_falsch;
    const double grenze = std::max(0.5 / cdj::LOOPBOX_EIN, 0.5 / cdj::LOOPBOX_AUS);
    std::printf("f15_huelle: größter Sprung %.5f bei %lld (Grenze %.5f), Einsatz %.6f, letzter Wert vor dem Stopp %.6f, innen falsch %d\n",
                m.d1, (long long)m.ort1, grenze, w.aus_l[ein], w.aus_l[aus - 1], innen_falsch);
    PRUEF(m.d1 <= grenze + 1e-6);
    PRUEF(w.aus_l[ein - 1] == 0.0f && w.aus_l[ein] > 0.0f && w.aus_l[ein] <= 0.5f / cdj::LOOPBOX_EIN + 1e-7f);
    PRUEF(w.aus_l[aus - 1] == 0.0f && w.aus_l[aus] == 0.0f && innen_falsch == 0);
  }
  {  // F15: Stopp spät angefordert (32 Samples vor der Eins, kürzer als LOOPBOX_AUS): kürzere Rampe ab der Anforderung,
     // kein Sprung (Entscheidung zu Flanke 3 der Erhebung)
    const cdj::Loop halb = konstant(0.5f);
    Welt w;
    w.boxen.laden(1, &halb);
    w.boxen.start(1, 0.0);
    w.bis(8 * SPB - 32);  // 179 968 = 703 · 256, Blockanfang
    w.boxen.stopp(1, w.jetzt());
    w.bis(9 * SPB);
    const sprung::Mass m = sprung::messe(w.aus_l, 8 * SPB - 300, 8 * SPB + 10);
    std::printf("f15_spaet: größter Sprung %.5f (Grenze %.5f), letzter Wert %.6f\n", m.d1, 0.5 / 32, w.aus_l[8 * SPB - 1]);
    PRUEF(m.d1 <= 0.5 / 32 + 1e-6 && w.aus_l[8 * SPB - 1] == 0.0f);
  }
  {  // F15, Prüfung 2.3 Befund 5: Stopp kommt erst d Samples vor der Eins (d = 0: Eins auf dem Blockanfang). Vorher Rampe d
     // Samples, bei d = 0 keine (Sprung 0,5). Jetzt mindestens LOOPBOX_AUS_MIN Samples ab der Anforderung: der Stopp endet
     // dann bis zu LOOPBOX_AUS_MIN − d Samples nach der Eins, ohne Sprung > 0,5/LOOPBOX_AUS_MIN. Gegenprobe d = 32, 144.
    const cdj::Loop halb = konstant(0.5f);
    for (int d : {0, 1, 8, 32, 144}) {
      Welt w;
      w.boxen.laden(1, &halb);
      w.boxen.start(1, 0.0);
      const int64_t E = 64 * SPB;  // 1 440 000 = 5625 · 256: Eins auf einem Blockanfang
      w.bis_genau(E - d, 1);
      w.boxen.stopp(1, w.jetzt());
      w.bis_genau(E + 4 * N, N);
      const int64_t ende = E - d + std::max(d, cdj::LOOPBOX_AUS_MIN);  // Ende der Ausblende (Stoppsample oder später)
      const sprung::Mass m = sprung::messe(w.aus_l, E - 400, E + 4 * N);
      int laut_danach = 0;
      for (int64_t t = ende - 1; t < E + 4 * N; ++t)
        if (w.aus_l[t] != 0.0f) ++laut_danach;
      const double grenze = 0.5 / std::max(std::min(std::max(d, cdj::LOOPBOX_AUS_MIN), cdj::LOOPBOX_AUS), 1);
      std::printf("f15_spaet_eins d=%3d: größter Sprung %.5f (Grenze %.5f), Ende der Ausblende %lld (Eins %lld), danach laut %d\n", d,
                  m.d1, grenze, (long long)ende, (long long)E, laut_danach);
      PRUEF(m.d1 <= grenze + 1e-6 && laut_danach == 0 && w.boxen.status(1) == cdj::BoxStatus::bereit);
      PRUEF(!w.meldungen.empty() && w.meldungen.back().status == cdj::BoxStatus::bereit && w.meldungen.back().sample == ende);
    }
  }
  {  // F15: Stopp zurückgenommen, während die Rampe schon läuft: vom Ist-Wert wieder auf (blende.h), die Box läuft weiter
    const cdj::Loop halb = konstant(0.5f);
    Welt w;
    w.boxen.laden(1, &halb);
    w.boxen.start(1, 0.0);
    w.bis(8 * SPB - 288);  // 179 712: die Rampe beginnt in diesem Block bei 179 856
    w.boxen.stopp(1, w.jetzt());
    w.bis(8 * SPB - 32);
    w.boxen.start(1, w.jetzt());
    w.bis(8 * SPB + 2000);
    const sprung::Mass m = sprung::messe(w.aus_l, 8 * SPB - 400, 8 * SPB + 2000);
    PRUEF(m.d1 <= 0.5 / cdj::LOOPBOX_AUS + 1e-6 && w.aus_l[8 * SPB - 33] < 0.5f);
    PRUEF(w.aus_l[8 * SPB + 1500] == 0.5f && w.boxen.status(1) == cdj::BoxStatus::laeuft);
  }
  {  // F15 Negativ-Kontrolle: Einsatz unter LOOPBOX_KANTE (−66 dBFS) bleibt hart und bitgleich wie vor Welle 2
    const cdj::Loop leise = konstant(0.0005f);
    Welt w;
    w.boxen.laden(1, &leise);
    w.bis(SPB);
    w.boxen.start(1, w.jetzt());
    w.bis(5 * SPB);
    PRUEF(w.aus_l[4 * SPB - 1] == 0.0f && w.aus_l[4 * SPB] == 0.0005f && w.aus_l[4 * SPB + 1] == 0.0005f);
  }
  {  // F15 x F13, Prüfung 2.3 Befund 4: /k/set/neu 512 Samples in einer Ladeblende (+0,5 -> −0,5, gleich laut). Der Schwanz
     // nimmt beide Quellen der Blende mit (vorher nur den neuen Pfad: Sprung 0,46068). Gegenprobe ohne Blende: 0,00347.
    const cdj::Loop plus = konstant(0.5f), minus = konstant(-0.5f);
    for (int vor : {0, 512}) {
      Welt w;
      w.boxen.laden(1, &plus);
      w.boxen.start(1, 0.0);
      w.bis(2 * SPB);
      if (vor > 0) {
        w.boxen.laden(1, &minus);
        w.bis(w.s + vor);
      }
      const int64_t S = w.s;
      w.boxen.ausklingen(w.karte, S);
      (void)w.boxen.leeren();
      const cdj::Karte neu(128.0, 0);
      std::vector<float> y(w.aus_l.end() - 10, w.aus_l.end());
      for (int64_t t = 0; t < 4 * N; t += N) {
        std::fill(w.puffer_l.begin(), w.puffer_l.end(), 0.0f);
        std::fill(w.puffer_r.begin(), w.puffer_r.end(), 0.0f);
        cdj::BoxMeldung m[8];
        w.boxen.block(neu, t, N, w.l, w.r, m, 8);
        y.insert(y.end(), w.l[L1], w.l[L1] + N);
      }
      const sprung::Mass m = sprung::messe(y, 2, (int64_t)y.size());
      std::printf("f15_set_neu_in_blende vor=%d: letztes altes %.4f, erstes neues %.4f, größter Sprung %.5f (Grenze %.5f)\n", vor,
                  y[9], y[10], m.d1, 0.5 / cdj::LOOPBOX_AUS);
      PRUEF(m.d1 <= 0.5 / cdj::LOOPBOX_AUS + 1e-4);
      PRUEF(y[10 + cdj::LOOPBOX_AUS - 1] == 0.0f);
      while (w.boxen.abholen()) {
      }
    }
  }
  {  // F15 /k/set/neu (Welle 2): ausklingen() vor leeren() blendet eine klingende Box über LOOPBOX_AUS auf 0 aus, statt sie
     // am Blockrand abzuschneiden (vorher: 0,5 -> 0 in einem Sample). Danach ist die Box still (bereit).
    const cdj::Loop halb = konstant(0.5f);
    Welt w;
    w.boxen.laden(1, &halb);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);
    w.boxen.ausklingen(w.karte, w.s);
    (void)w.boxen.leeren();
    const cdj::Karte neu(128.0, 0);
    std::vector<float> nach;
    for (int64_t s = 0; s < 4 * N; s += N) {
      std::fill(w.puffer_l.begin(), w.puffer_l.end(), 0.0f);
      std::fill(w.puffer_r.begin(), w.puffer_r.end(), 0.0f);
      cdj::BoxMeldung m[8];
      w.boxen.block(neu, s, N, w.l, w.r, m, 8);
      nach.insert(nach.end(), w.l[L1], w.l[L1] + N);
    }
    std::vector<float> y(w.aus_l.end() - 10, w.aus_l.end());
    y.insert(y.end(), nach.begin(), nach.end());
    const sprung::Mass m = sprung::messe(y, 2, (int64_t)y.size());
    int nachher_laut = 0;
    for (size_t t = cdj::LOOPBOX_AUS; t < nach.size(); ++t)
      if (nach[t] != 0.0f) ++nachher_laut;
    std::printf("f15_set_neu: größter Sprung %.5f (Grenze %.5f), erstes Sample %.5f, letztes des Schwanzes %.6f\n", m.d1,
                0.5 / cdj::LOOPBOX_AUS, nach[0], nach[cdj::LOOPBOX_AUS - 1]);
    PRUEF(m.d1 <= 0.5 / cdj::LOOPBOX_AUS + 1e-6);
    PRUEF(nach[cdj::LOOPBOX_AUS - 1] == 0.0f && nachher_laut == 0 && w.boxen.status(1) == cdj::BoxStatus::bereit);
    // Negativ-Kontrolle: ausklingen bei stehender Box ist wirkungslos
    Welt x;
    x.boxen.laden(1, &halb);
    x.boxen.ausklingen(x.karte, 0);
    (void)x.boxen.leeren();
    x.bis(4 * N);
    PRUEF(std::all_of(x.aus_l.begin(), x.aus_l.end(), [](float v) { return v == 0.0f; }));
  }
  {  // 4. (Plan Tempo-Folge) Tempo 130: die Box spielt, Position = (Beat mod beats) · SPB, also schneller als die
     // Samples. Der Rampen-Loop trägt seine Position als Wert; Catmull-Rom ist auf einer Geraden exakt.
     // Negativ-Kontrolle leere Box: start false, still.
    Welt w(130.0);
    w.boxen.laden(1, &vier);
    w.boxen.start(1, 0.0);
    w.bis(3 * SPB);
    PRUEF(w.boxen.status(1) == cdj::BoxStatus::laeuft);
    int falsch = 0;
    double groesste = 0.0;
    for (int64_t t = 0; t < 3 * SPB; ++t) {
      const double soll = w.karte.beat_at((double)t) * (double)SPB;  // < 16 Beats, kein Umlauf
      const double ab = std::fabs((double)w.aus_l[t] - soll);
      groesste = std::max(groesste, ab);
      if (ab > 0.05 || std::fabs((double)w.aus_r[t] + soll) > 0.05) ++falsch;
    }
    std::printf("tempo130: Wert bei Sample 60000 %.2f (Soll %.2f, bei 128 BPM wären es 60000), größte Abweichung %.4f, falsch %d\n",
                w.aus_l[60000], w.karte.beat_at(60000.0) * (double)SPB, groesste, falsch);
    PRUEF(falsch == 0);
    for (const auto& m : w.meldungen) PRUEF(m.status != cdj::BoxStatus::tempo);
    PRUEF(!w.boxen.start(2, 0.0) && !w.boxen.stopp(2, 0.0) && w.boxen.status(2) == cdj::BoxStatus::leer);
    PRUEF(w.boxen.laden(3, &vier) == &vier);  // ungültige Box: der Loop geht zurück
  }
  {  // 5. (Plan Tempo-Folge) Rampe 128 → 140 ab Beat 4 über 8 Beats bei laufender Box: vor der Rampe bitgenau der
     // Direktweg, in und nach der Rampe folgt die Position dem Beat (je Block linear, Fehler < 0,1 Frame).
    Welt w;
    w.boxen.laden(1, &vier);
    w.boxen.start(1, 0.0);
    PRUEF(w.karte.rampe(4.0, 140.0, 8.0));
    const int64_t ende = (int64_t)w.karte.sample_at(15.0);
    w.bis(ende);
    int falsch_vor = 0, falsch_nach = 0;
    for (int64_t t = 0; t < 4 * SPB; ++t)
      if (w.aus_l[t] != (float)t) ++falsch_vor;
    for (int64_t t = 4 * SPB; t < ende; ++t)
      if (std::fabs((double)w.aus_l[t] - w.karte.beat_at((double)t) * (double)SPB) > 0.1) ++falsch_nach;
    std::printf("rampe: falsch vor %d, in/nach %d, Tempo am Ende %.2f\n", falsch_vor, falsch_nach,
                w.karte.bpm_at((double)ende));
    PRUEF(falsch_vor == 0 && falsch_nach == 0);
  }
  {  // 5b. (Plan Tempo-Folge) Umlauf und Versatz bei 130: 1-Beat-Rampe, versatz 5000. Außerhalb von ±3 Frames um den
     // Umlauf gilt Wert = ((Beat mod 1) · SPB + 5000) mod SPB.
    cdj::Loop eins = rampe(1);
    eins.versatz = 5000;
    Welt w(130.0);
    w.boxen.laden(1, &eins);
    w.boxen.start(1, 0.0);
    w.bis(4 * SPB);
    int falsch = 0, geprueft = 0;
    for (int64_t t = 0; t < 4 * SPB; ++t) {
      const double b = w.karte.beat_at((double)t);
      if (t < cdj::LOOPBOX_EIN) continue;  // F15: Einsatz bei Wert 5000
      const double soll = std::fmod((b - std::floor(b)) * (double)SPB + 5000.0, (double)SPB);
      if (soll < 3.0 || soll > (double)SPB - 3.0) continue;
      ++geprueft;
      if (std::fabs((double)w.aus_l[t] - soll) > 0.05) ++falsch;
    }
    std::printf("umlauf130: geprüft %d, falsch %d\n", geprueft, falsch);
    PRUEF(geprueft > 3 * SPB && falsch == 0);
  }
  // ---- Keylock (Plan 2026-09-30, Slice 2): die Box spielt eine vorgerenderte Variante ----
  {  // F13 x Stopp Cypher (§4.7): ein von cypher geladener, noch wartender Loop wird beim Stopp verworfen (nie hörbar), ein
     // von andreas geladener nicht (Negativ-Kontrolle). Task 7: ohne Varianten übernimmt ein wartender Loop im nächsten Block;
     // der Stopp muss ihn darum im selben Block verwerfen, in dem er geladen wurde (wie der Kern es vor block() tut).
    cdj::Loop a = konstant(1.0f);
    a.name = "a";
    cdj::Loop b = konstant(-1.0f);
    b.name = "b";
    Welt w(130.0);
    w.boxen.laden(1, &a);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);
    PRUEF(w.boxen.laden(1, &b, true) == nullptr);
    w.boxen.cypher_wartende_verwerfen();
    PRUEF(w.boxen.abholen() == &b && w.boxen.abholen() == nullptr);
    w.bis(w.s + 4 * N);
    PRUEF(w.boxen.loop(1) == &a && w.aus_l[w.s - 1] == 1.0f);
    Welt x(130.0);
    x.boxen.laden(1, &a);
    x.boxen.start(1, 0.0);
    x.bis(2 * SPB);
    PRUEF(x.boxen.laden(1, &b) == nullptr);  // andreas
    x.boxen.cypher_wartende_verwerfen();
    PRUEF(x.boxen.abholen() == nullptr);
    x.bis(x.s + 2 * N + cdj::LOOPBOX_LADEN_BLENDE + N);
    PRUEF(x.boxen.loop(1) == &b && x.aus_l[x.s - 1] == -1.0f);
    PRUEF(x.boxen.abholen() == &a);
  }

  {  // 6. (Plan MVP 2 Scheibe 2) Mitschnitt: erz/1 (Kanal 4) vor Trim wird ab dem nächsten Vielfachen von 4·takte
     // kopiert; Überlappung schlägt fehl; leeren() gibt einen laufenden Mitschnitt als abgebrochen zurück.
    Welt w;
    w.bis(3 * SPB);
    cdj::Mitschnitt mt{};
    mt.beats = 4;
    mt.frames = 4 * SPB;
    mt.daten.assign((size_t)mt.frames * 2, -999.0f);
    const double beat_bei_rec = w.jetzt();
    PRUEF(w.boxen.mitschnitt(&mt, beat_bei_rec, w.karte));
    const double soll_ab_beat = std::ceil(beat_bei_rec / 4.0 - 1e-9) * 4.0;
    PRUEF(mt.ab_beat == soll_ab_beat && mt.ab_sample == (int64_t)std::llround(w.karte.sample_at(soll_ab_beat)));
    cdj::Mitschnitt* fertig = nullptr;
    int64_t s = w.s;
    while (!fertig) {
      std::fill(w.puffer_l.begin(), w.puffer_l.end(), 0.0f);
      std::fill(w.puffer_r.begin(), w.puffer_r.end(), 0.0f);
      for (int i = 0; i < N; ++i) {
        w.l[cdj::MITSCHNITT_KANAL][i] = (float)(s + i);
        w.r[cdj::MITSCHNITT_KANAL][i] = -(float)(s + i);
      }
      cdj::BoxMeldung m[8];
      w.boxen.block(w.karte, s, N, w.l, w.r, m, 8, &fertig);
      s += N;
    }
    PRUEF(fertig == &mt && mt.gefuellt == mt.frames);
    int falsch = 0;
    for (int64_t i = 0; i < mt.frames; ++i) {
      const float soll = (float)(mt.ab_sample + i);
      if (mt.daten[(size_t)(2 * i)] != soll || mt.daten[(size_t)(2 * i + 1)] != -soll) ++falsch;
    }
    std::printf("mitschnitt: ab_beat %.1f (Soll %.1f) ab_sample %lld gefuellt %lld falsche Werte %d von %lld\n",
                mt.ab_beat, soll_ab_beat, (long long)mt.ab_sample, (long long)mt.gefuellt, falsch,
                (long long)mt.frames);
    PRUEF(falsch == 0);
    cdj::Mitschnitt mt2{}, mt3{};
    mt2.beats = mt3.beats = 4;
    mt2.frames = mt3.frames = 4 * SPB;
    mt2.daten.assign((size_t)mt2.frames * 2, 0.0f);
    mt3.daten.assign((size_t)mt3.frames * 2, 0.0f);
    PRUEF(w.boxen.mitschnitt(&mt2, w.karte.beat_at((double)s), w.karte));   // mt ist fertig: frei
    PRUEF(!w.boxen.mitschnitt(&mt3, w.karte.beat_at((double)s), w.karte));  // mt2 läuft noch: ueberlappung
    cdj::Mitschnitt* abgebrochen = w.boxen.leeren();
    PRUEF(abgebrochen == &mt2 && w.boxen.leeren() == nullptr);
  }
  {  // 7. (MVP 2 Scheibe 3, E3) 1-Beat-Loop: phasenstarr, Position = (Beat mod 1) · SPB; Mitschnitt 1 Beat setzt auf
     // dem nächsten Beat ein, nicht auf der Takt-Eins.
    const cdj::Loop eins = rampe(1);
    Welt w;
    w.boxen.laden(1, &eins);
    w.bis(5 * SPB);
    w.boxen.start(1, w.jetzt());
    w.bis(12 * SPB);
    int falsch = 0;
    for (int64_t t = 8 * SPB; t < 12 * SPB; ++t)
      if (w.aus_l[t] != (float)(t % SPB)) ++falsch;
    std::printf("ein_beat: falsche Samples %d von %lld\n", falsch, (long long)(4 * SPB));
    PRUEF(falsch == 0);
    cdj::Mitschnitt mt{};
    mt.beats = 1;
    mt.frames = SPB;
    mt.daten.assign((size_t)mt.frames * 2, 0.0f);
    const double b0 = w.karte.beat_at((double)(w.s + 100));  // 100 Samples nach einem Blockanfang, mitten im Beat
    PRUEF(w.boxen.mitschnitt(&mt, b0, w.karte));
    PRUEF(mt.ab_beat == std::ceil(b0 - 1e-9) && mt.ab_beat - b0 < 1.0);
  }
  {  // 8. (MVP 2 Scheibe 3, E4, Review Scheibe 2 Fund 2) Tempowechsel, während der Mitschnitt auf seinen Einsatz wartet:
     // abbrechen (abgebrochen, nichts kopiert) statt einer versetzten Datei, die als fertig gilt.
    for (int wechsel = 0; wechsel < 2; ++wechsel) {  // 0: Negativ-Kontrolle ohne Wechsel
      Welt w;
      w.bis(3 * SPB);
      cdj::Mitschnitt mt{};
      mt.beats = 4;
      mt.frames = 4 * SPB;
      mt.daten.assign((size_t)mt.frames * 2, 0.0f);
      PRUEF(w.boxen.mitschnitt(&mt, w.jetzt(), w.karte) && mt.ab_beat == 4.0);
      if (wechsel) w.karte = cdj::Karte(120.0, 0);
      cdj::Mitschnitt* fertig = nullptr;
      int64_t s = w.s;
      for (int i = 0; i < 2000 && !fertig; ++i, s += N) {
        cdj::BoxMeldung m[8];
        w.boxen.block(w.karte, s, N, w.l, w.r, m, 8, &fertig);
      }
      std::printf("tempo_waehrend_wait %d: fertig %d abgebrochen %d gefuellt %lld\n", wechsel, fertig == &mt,
                  (int)mt.abgebrochen, (long long)mt.gefuellt);
      PRUEF(fertig == &mt);
      PRUEF(mt.abgebrochen == (wechsel == 1));
      PRUEF(wechsel ? mt.gefuellt == 0 : mt.gefuellt == mt.frames);
    }
  }
  {  // 8b. (Plan Tempo-Folge) Tempowechsel WÄHREND der Aufnahme: abgebrochen statt einer verzerrten Datei
    Welt w;
    w.bis(3 * SPB);
    cdj::Mitschnitt mt{};
    mt.beats = 4;
    mt.frames = 4 * SPB;
    mt.daten.assign((size_t)cdj::mitschnitt_max_frames(4) * 2, 0.0f);
    PRUEF(w.boxen.mitschnitt(&mt, w.jetzt(), w.karte) && mt.roh_frames == 4 * SPB && mt.bpm == 128.0);
    cdj::Mitschnitt* fertig = nullptr;
    int64_t s = w.s;
    for (int i = 0; i < 4000 && !fertig; ++i, s += N) {
      if (mt.gefuellt > 0 && mt.gefuellt < 2 * N + 1) w.karte = cdj::Karte(120.0, 0);
      cdj::BoxMeldung m[8];
      w.boxen.block(w.karte, s, N, w.l, w.r, m, 8, &fertig);
    }
    std::printf("tempo_waehrend_rec: fertig %d abgebrochen %d gefuellt %lld von %lld\n", fertig == &mt,
                (int)mt.abgebrochen, (long long)mt.gefuellt, (long long)mt.roh_frames);
    PRUEF(fertig == &mt && mt.abgebrochen && mt.gefuellt > 0 && mt.gefuellt < mt.roh_frames);
  }
  {  // 8c. (Plan Tempo-Folge) Mitschnitt bei 130 BPM: 4 Beats sind 88 616 Frames, Wert = Sample (wie Fall 6)
    Welt w(130.0);
    w.bis(3 * SPB);
    cdj::Mitschnitt mt{};
    mt.beats = 4;
    mt.frames = 4 * SPB;
    mt.daten.assign((size_t)cdj::mitschnitt_max_frames(4) * 2, -999.0f);
    PRUEF(w.boxen.mitschnitt(&mt, w.jetzt(), w.karte));
    cdj::Mitschnitt* fertig = nullptr;
    int64_t s = w.s;
    while (!fertig) {
      for (int i = 0; i < N; ++i) {
        w.l[cdj::MITSCHNITT_KANAL][i] = (float)(s + i);
        w.r[cdj::MITSCHNITT_KANAL][i] = -(float)(s + i);
      }
      cdj::BoxMeldung m[8];
      w.boxen.block(w.karte, s, N, w.l, w.r, m, 8, &fertig);
      s += N;
    }
    int falsch = 0;
    for (int64_t i = 0; i < mt.roh_frames; ++i)
      if (mt.daten[(size_t)(2 * i)] != (float)(mt.ab_sample + i)) ++falsch;
    std::printf("mitschnitt130: ab_beat %.1f ab_sample %lld roh_frames %lld gefuellt %lld bpm %.1f falsch %d, danach unberührt %d\n",
                mt.ab_beat, (long long)mt.ab_sample, (long long)mt.roh_frames, (long long)mt.gefuellt, mt.bpm, falsch,
                (int)(mt.daten[(size_t)(2 * mt.roh_frames)] == -999.0f));
    PRUEF(fertig == &mt && !mt.abgebrochen && mt.roh_frames == mt.gefuellt && mt.bpm == 130.0 && falsch == 0);
    PRUEF(mt.roh_frames == std::llround(w.karte.sample_at(mt.ab_beat + 4.0)) - mt.ab_sample && mt.roh_frames < 4 * SPB);
    PRUEF(mt.daten[(size_t)(2 * mt.roh_frames)] == -999.0f);  // Negativ-Kontrolle: kein Frame zu viel
  }
  {  // 8d. (Code-Review F1) Eine Rampe, die genau auf dem End-Beat der Aufnahme beginnt (Andreas stellt das Tempo,
     // während REC läuft: /tempo startet auf der nächsten Eins), darf den fertigen Mitschnitt nicht abbrechen.
    Welt w(130.0);
    w.bis(3 * SPB);
    cdj::Mitschnitt mt{};
    mt.beats = 4;
    mt.frames = 4 * SPB;
    mt.daten.assign((size_t)cdj::mitschnitt_max_frames(4) * 2, 0.0f);
    PRUEF(w.boxen.mitschnitt(&mt, w.jetzt(), w.karte) && mt.ab_beat == 4.0);
    PRUEF(w.karte.rampe(8.0, 140.0, 4.0));
    cdj::Mitschnitt* fertig = nullptr;
    int64_t s = w.s;
    for (int i = 0; i < 4000 && !fertig; ++i, s += N) {
      cdj::BoxMeldung m[8];
      w.boxen.block(w.karte, s, N, w.l, w.r, m, 8, &fertig);
    }
    std::printf("rampe_am_ende: fertig %d abgebrochen %d gefuellt %lld von %lld\n", fertig == &mt, (int)mt.abgebrochen,
                (long long)mt.gefuellt, (long long)mt.roh_frames);
    PRUEF(fertig == &mt && !mt.abgebrochen && mt.gefuellt == mt.roh_frames);
  }
  // Plan Grid: Versatz dreht den Loop. Rampe 4 Beats, versatz 5000: Box spielt (s + 5000) mod 90 000.
  {
    Welt w;
    cdj::Loop lp = rampe(4);
    lp.versatz = 5000;
    w.boxen.laden(1, &lp);
    w.boxen.start(1, 0.0);
    w.bis(2 * 90000);
    bool ok = true;
    for (int64_t s = cdj::LOOPBOX_EIN; s < 2 * 90000; ++s) ok = ok && w.aus_l[s] == (float)((s + 5000) % 90000);
    PRUEF(ok);
    // live ab dem nächsten Block (Review F2: bis() läuft in 256er-Blöcken, w.s steht auf 180 224, nicht 180 000)
    const int64_t ab = w.s;
    PRUEF(w.boxen.raster(1, -2000) == 0);
    w.bis(ab + 90000);
    ok = true;
    for (int64_t s = ab; s < ab + 90000; ++s) ok = ok && w.aus_l[s] == (float)(((s - 2000) % 90000 + 90000) % 90000);
    PRUEF(ok);
    PRUEF(w.boxen.raster(1, 90000) == 2);
    PRUEF(w.boxen.raster(2, 0) == 1);
    w.boxen.laden(1, &lp);
    PRUEF(w.boxen.versatz(1) == 5000);
  }
  PRUEF_ENDE();
}
