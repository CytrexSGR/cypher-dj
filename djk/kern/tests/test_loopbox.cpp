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

// Keylock (Plan 2026-09-30): Variante von o für das Renderttempo tr, synthetisch (der Render kommt mit Slice 3).
// Dieselben beats, frames' = llround(frames · 128 / tr), bpm = tr; der Wert ist die eigene Position (L +i, R −i).
cdj::Loop variante_pos(const cdj::Loop& o, double tr) {
  cdj::Loop v;
  v.name = o.name;  // die Variante übernimmt den name des Originals (Slice 3 benennt sie so)
  v.beats = o.beats;
  v.frames = std::llround((double)o.frames * 128.0 / tr);
  v.bpm = tr;
  v.daten.resize((size_t)v.frames * 2);
  for (int64_t i = 0; i < v.frames; ++i) {
    v.daten[2 * i] = (float)i;
    v.daten[2 * i + 1] = -(float)i;
  }
  return v;
}

// Variante mit Konstante (Blenden-Test: Sprung sichtbar, wenn die Blende fehlt)
cdj::Loop variante_konst(const cdj::Loop& o, double tr, float w) {
  cdj::Loop v = variante_pos(o, tr);
  v.daten.assign((size_t)v.frames * 2, w);
  return v;
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
  {  // 2. Tausch im Lauf: der neue Loop gilt ab dem nächsten Block, die Box läuft weiter
    Welt w;
    const cdj::Loop sieben = konstant(7.0f);
    w.boxen.laden(1, &vier);
    w.boxen.start(1, w.jetzt());  // Beat 0: sofort
    w.bis(2 * SPB);
    PRUEF(w.boxen.laden(1, &sieben) == &vier && w.boxen.status(1) == cdj::BoxStatus::laeuft);
    const int64_t getauscht = w.s;  // bis() rendert bis zur Blockgrenze (45 056), nicht bis 2 · SPB
    w.bis(3 * SPB);
    PRUEF(w.aus_l[getauscht] == 7.0f && w.aus_l[getauscht - 1] == (float)(getauscht - 1));
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
      const double soll = std::fmod((b - std::floor(b)) * (double)SPB + 5000.0, (double)SPB);
      if (soll < 3.0 || soll > (double)SPB - 3.0) continue;
      ++geprueft;
      if (std::fabs((double)w.aus_l[t] - soll) > 0.05) ++falsch;
    }
    std::printf("umlauf130: geprüft %d, falsch %d\n", geprueft, falsch);
    PRUEF(geprueft > 3 * SPB && falsch == 0);
  }
  // ---- Keylock (Plan 2026-09-30, Slice 2): die Box spielt eine vorgerenderte Variante ----
  {  // K(a) 130 BPM, Variante bei T_r = 130: Lesekopf über die Variante, Schritt 1,000 (statt 1,0154 im Varispeed)
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    const double spb2 = (double)v130.frames / 16.0;
    // Fehlerfall vorher: ohne Variante liest die Box im Varispeed mit Schritt 130/128
    Welt ohne(130.0);
    ohne.boxen.laden(1, &vier);
    ohne.boxen.start(1, 0.0);
    ohne.bis(3 * SPB);
    const double schritt_ohne = ((double)ohne.aus_l[60000] - (double)ohne.aus_l[1000]) / 59000.0;
    // nachher: mit Variante
    Welt w(130.0);
    w.boxen.laden(1, &vier);
    PRUEF(w.boxen.variante_setzen(1, &v130) == nullptr && w.boxen.variante(1) == &v130);
    w.boxen.start(1, 0.0);
    w.bis(3 * SPB);
    const double schritt_mit = ((double)w.aus_l[60000] - (double)w.aus_l[1000]) / 59000.0;
    double groesste = 0.0;
    for (int64_t t = 0; t < 3 * SPB; ++t) {
      const double soll = w.karte.beat_at((double)t) * spb2;  // Position in Variantenframes, < 16 Beats, kein Umlauf
      groesste = std::max({groesste, std::fabs((double)w.aus_l[t] - soll), std::fabs((double)w.aus_r[t] + soll)});
    }
    std::printf("keylock130: Schritt ohne Variante %.5f (Varispeed 130/128 = %.5f), mit Variante %.5f, größte Abweichung von "
                "beat·spb' %.4f\n", schritt_ohne, 130.0 / 128.0, schritt_mit, groesste);
    PRUEF_NAH(schritt_ohne, 130.0 / 128.0, 1e-3);   // der Fehlerfall: das ist der schiefe Schritt
    PRUEF_NAH(schritt_mit, 1.0, 1e-3);              // Keylock: Schritt ≈ 1
    PRUEF(groesste < 0.05);
    // Negativ-Kontrolle: Variante bei 130,04 (innerhalb ±0,05) gilt, Schritt 130,04/130 · 1,0
    Welt n(130.04);
    n.boxen.laden(1, &vier);
    n.boxen.variante_setzen(1, &v130);
    n.boxen.start(1, 0.0);
    n.bis(3 * SPB);
    double gr2 = 0.0;
    for (int64_t t = 0; t < 3 * SPB; ++t)
      gr2 = std::max(gr2, std::fabs((double)n.aus_l[t] - n.karte.beat_at((double)t) * spb2));
    PRUEF(gr2 < 0.05);
  }
  {  // K(b) 128 BPM mit gesetzter Variante: Direktweg, BITGLEICH zum Lauf ohne Variante
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    Welt ohne, mit;
    ohne.boxen.laden(1, &vier);
    mit.boxen.laden(1, &vier);
    mit.boxen.variante_setzen(1, &v130);
    ohne.boxen.start(1, 0.0);
    mit.boxen.start(1, 0.0);
    ohne.bis(6 * SPB);
    mit.bis(6 * SPB);
    std::printf("keylock128: bitgleich L %d R %d (%zu Samples)\n", (int)gleich(ohne.aus_l, mit.aus_l),
                (int)gleich(ohne.aus_r, mit.aus_r), mit.aus_l.size());
    PRUEF(gleich(ohne.aus_l, mit.aus_l) && gleich(ohne.aus_r, mit.aus_r));
  }
  {  // K(c) |bpm − T_r| > 0,05 (130,2): Variante ungenutzt, gleich Varispeed ohne Variante (bitgleich)
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    Welt ohne(130.2), mit(130.2);
    ohne.boxen.laden(1, &vier);
    mit.boxen.laden(1, &vier);
    mit.boxen.variante_setzen(1, &v130);
    ohne.boxen.start(1, 0.0);
    mit.boxen.start(1, 0.0);
    ohne.bis(3 * SPB);
    mit.bis(3 * SPB);
    PRUEF(gleich(ohne.aus_l, mit.aus_l) && gleich(ohne.aus_r, mit.aus_r));
  }
  {  // K(c) Rampe 130 → 140 ab Beat 4: Variante nur vor der Rampe; danach (nach der Blende) gleich Varispeed ohne Variante
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    Welt ohne(130.0), mit(130.0);
    ohne.boxen.laden(1, &vier);
    mit.boxen.laden(1, &vier);
    mit.boxen.variante_setzen(1, &v130);
    ohne.boxen.start(1, 0.0);
    mit.boxen.start(1, 0.0);
    PRUEF(ohne.karte.rampe(4.0, 140.0, 8.0) && mit.karte.rampe(4.0, 140.0, 8.0));
    const int64_t ende = (int64_t)mit.karte.sample_at(13.0);
    ohne.bis(ende);
    mit.bis(ende);
    const int64_t r0 = (int64_t)mit.karte.sample_at(4.0) / N * N;  // Anfang des Blocks, in dem die Rampe beginnt
    int vor_falsch = 0, nach_falsch = 0;
    const double spb2 = (double)v130.frames / 16.0;
    for (int64_t t = 0; t < r0; ++t)  // vor der Rampe: Variante (Position in Variantenframes)
      if (std::fabs((double)mit.aus_l[t] - mit.karte.beat_at((double)t) * spb2) > 0.05) ++vor_falsch;
    for (int64_t t = r0 + 960 + N; t < ende; ++t)  // nach der Blende: Varispeed mit Original, wie ohne Variante
      if (mit.aus_l[t] != ohne.aus_l[t] || mit.aus_r[t] != ohne.aus_r[t]) ++nach_falsch;
    std::printf("keylock_rampe: vor der Rampe falsch %d, nach der Blende ungleich Varispeed %d\n", vor_falsch, nach_falsch);
    PRUEF(vor_falsch == 0 && nach_falsch == 0);
  }
  {  // K(d) Blende: Varispeed → Variante ohne Sprung (Original 1,0, Variante 0,2), nach 960 Frames reine Variante
    const cdj::Loop o = konstant(1.0f);
    const cdj::Loop v = variante_konst(o, 130.0, 0.2f);
    Welt w(130.0);
    w.boxen.laden(1, &o);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);
    const int64_t S = w.s;
    PRUEF(w.boxen.variante_setzen(1, &v) == nullptr);
    w.bis(S + 4096);
    double sprung = 0.0, letzter = w.aus_l[S - 1];
    for (int64_t t = S; t < S + 4096; ++t) {
      sprung = std::max(sprung, std::fabs((double)w.aus_l[t] - letzter));
      letzter = w.aus_l[t];
    }
    int nicht_rein = 0, nicht_alt = 0, nicht_mono = 0;
    for (int64_t t = S + 960; t < S + 4096; ++t)
      if (std::fabs((double)w.aus_l[t] - 0.2) > 1e-6) ++nicht_rein;
    for (int64_t t = 0; t < S; ++t)
      if (std::fabs((double)w.aus_l[t] - 1.0) > 1e-6) ++nicht_alt;
    for (int64_t t = S + 1; t < S + 960; ++t)
      if (w.aus_l[t] > w.aus_l[t - 1] + 1e-6f) ++nicht_mono;
    std::printf("keylock_blende: größter Sprung %.5f, nach 960 nicht rein %d, vorher nicht alt %d, nicht monoton %d, Mitte %.3f\n",
                sprung, nicht_rein, nicht_alt, nicht_mono, w.aus_l[S + 480]);
    PRUEF(sprung < 0.1 && nicht_rein == 0 && nicht_alt == 0 && nicht_mono == 0);
    PRUEF(w.aus_l[S + 480] > 0.5 && w.aus_l[S + 480] < 0.7);  // linear: Mitte 0,6 (0,5·1,0 + 0,5·0,2)
    // und zurück: Variante wird entfernt (klingt noch: geht erst nach der Blende zurück), gleiche Stetigkeit
    const int64_t S2 = w.s;
    PRUEF(w.boxen.variante_setzen(1, nullptr) == nullptr);  // klingt noch
    PRUEF(w.boxen.abholen() == nullptr);
    w.bis(S2 + 4096);
    sprung = 0.0;
    letzter = w.aus_l[S2 - 1];
    for (int64_t t = S2; t < S2 + 4096; ++t) {
      sprung = std::max(sprung, std::fabs((double)w.aus_l[t] - letzter));
      letzter = w.aus_l[t];
    }
    int nicht_alt2 = 0;
    for (int64_t t = S2 + 960; t < S2 + 4096; ++t)
      if (std::fabs((double)w.aus_l[t] - 1.0) > 1e-6) ++nicht_alt2;
    PRUEF(sprung < 0.1 && nicht_alt2 == 0);
    PRUEF(w.boxen.abholen() == &v && w.boxen.abholen() == nullptr);  // nach der Blende zurück, genau einmal
  }
  {  // K(e) laden mit gesetzter Variante: Variante über abholen() zurück, alter Loop wie bisher; nichts leckt
    auto* l1 = new cdj::Loop(rampe(4));
    auto* l2 = new cdj::Loop(rampe(4));
    auto* v1 = new cdj::Loop(variante_pos(*l1, 130.0));
    Welt w(130.0);
    PRUEF(w.boxen.laden(1, l1) == nullptr);
    PRUEF(w.boxen.variante_setzen(1, v1) == nullptr);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);  // spielt auf der Variante
    const cdj::Loop* alt = w.boxen.laden(1, l2);
    PRUEF(alt == l1);
    PRUEF(w.boxen.variante(1) == nullptr);  // gehörte zum alten Loop
    const cdj::Loop* fr = w.boxen.abholen();
    PRUEF(fr == v1 && w.boxen.abholen() == nullptr && w.boxen.abholen_verloren() == 0);
    w.bis(w.s + 2 * N);  // die Box spielt den neuen Loop ohne Absturz weiter (Zugriff auf gelöschte Variante = ASan)
    delete alt;
    delete fr;
    delete l2;  // die Box selbst besitzt nichts
    // Negativ-Kontrolle: laden ohne Variante gibt nichts über abholen() zurück; derselbe Zeiger behält die Variante
    auto* l3 = new cdj::Loop(rampe(4));
    auto* v3 = new cdj::Loop(variante_pos(*l3, 130.0));
    Welt x(130.0);
    x.boxen.laden(1, l3);
    x.boxen.laden(1, l3);
    PRUEF(x.boxen.abholen() == nullptr);
    x.boxen.variante_setzen(1, v3);
    PRUEF(x.boxen.laden(1, l3) == nullptr && x.boxen.variante(1) == v3 && x.boxen.abholen() == nullptr);
    PRUEF(x.boxen.laden(1, nullptr) == l3 && x.boxen.abholen() == v3);  // Loop weg: Variante weg
    delete l3;
    delete v3;
  }
  {  // K(f) variante_setzen: nullptr gibt die Variante zurück, Box spielt wie heute (bitgleich) weiter; Randfälle
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    Welt ohne, mit;
    ohne.boxen.laden(1, &vier);
    mit.boxen.laden(1, &vier);
    PRUEF(mit.boxen.variante_setzen(3, &v130) == &v130);  // ungültige Box: zurück
    PRUEF(mit.boxen.variante_setzen(2, &v130) == &v130);  // Box ohne Loop: zurück
    PRUEF(mit.boxen.variante_setzen(1, nullptr) == nullptr);  // keine da
    PRUEF(mit.boxen.variante_setzen(1, &v130) == nullptr);
    PRUEF(mit.boxen.variante_setzen(1, &v130) == nullptr && mit.boxen.variante(1) == &v130);  // dieselbe: nullptr
    ohne.boxen.start(1, 0.0);
    mit.boxen.start(1, 0.0);
    ohne.bis(2 * SPB);
    mit.bis(2 * SPB);
    PRUEF(mit.boxen.variante_setzen(1, nullptr) == &v130);  // 128 BPM: spielt Direktweg, nicht von der Variante
    PRUEF(mit.boxen.variante(1) == nullptr && mit.boxen.abholen() == nullptr);
    ohne.bis(4 * SPB);
    mit.bis(4 * SPB);
    PRUEF(gleich(ohne.aus_l, mit.aus_l) && gleich(ohne.aus_r, mit.aus_r));
  }
  {  // K(g) F1 (Slice 2b): bei genau 128 BPM hat der Direktweg Vorrang vor einer Variante mit T_r nahe 128
    // (tempo_ok zuerst, dann Variante, dann Varispeed). Variante mit ANDEREM Inhalt: sonst wäre der Fehlerfall unsichtbar.
    for (const double tr : {128.0, 127.97, 128.03}) {
      const cdj::Loop v = variante_konst(vier, tr, 0.5f);
      Welt ohne, mit;
      ohne.boxen.laden(1, &vier);
      mit.boxen.laden(1, &vier);
      PRUEF(mit.boxen.variante_setzen(1, &v) == nullptr && mit.boxen.variante(1) == &v);  // angenommen, nur nicht gespielt
      ohne.boxen.start(1, 0.0);
      mit.boxen.start(1, 0.0);
      ohne.bis(4 * SPB);
      mit.bis(4 * SPB);
      int64_t ungleich = 0;
      for (size_t t = 0; t < ohne.aus_l.size(); ++t) ungleich += ohne.aus_l[t] != mit.aus_l[t];
      std::printf("keylock128 nah: T_r %.2f: ungleiche Samples %lld von %zu\n", tr, (long long)ungleich, mit.aus_l.size());
      PRUEF(gleich(ohne.aus_l, mit.aus_l) && gleich(ohne.aus_r, mit.aus_r));  // memcmp
      PRUEF(std::memcmp(ohne.aus_l.data(), mit.aus_l.data(), ohne.aus_l.size() * sizeof(float)) == 0);
    }
    // Negativ-Kontrolle: bei 130 und Variante 130 bleibt die Variante aktiv (Schritt 1,000, nicht 130/128)
    const cdj::Loop v = variante_pos(vier, 130.0);
    Welt w(130.0);
    w.boxen.laden(1, &vier);
    w.boxen.variante_setzen(1, &v);
    w.boxen.start(1, 0.0);
    w.bis(3 * SPB);
    const double schritt = ((double)w.aus_l[60000] - (double)w.aus_l[1000]) / 59000.0;
    PRUEF_NAH(schritt, 1.0, 1e-3);
  }
  {  // K(h) F2 (Slice 2b): eine Variante, die nicht zum geladenen Loop gehört, wird nicht gespielt und kommt zurück
    cdj::Loop a = rampe(16), b = rampe(16);  // gleiche beats, anderer name
    a.name = "a";
    b.name = "b";
    const cdj::Loop vb = variante_konst(b, 130.0, -1.0f);
    const cdj::Loop va = variante_konst(a, 130.0, 0.25f);
    Welt ohne(130.0), mit(130.0);
    ohne.boxen.laden(1, &a);
    mit.boxen.laden(1, &a);
    PRUEF(mit.boxen.variante_setzen(1, &vb) == &vb);  // fremd: sofort zurück
    PRUEF(mit.boxen.variante(1) == nullptr && mit.boxen.abgelehnt() == 1 && mit.boxen.abholen() == nullptr);
    ohne.boxen.start(1, 0.0);
    mit.boxen.start(1, 0.0);
    ohne.bis(3 * SPB);
    mit.bis(3 * SPB);
    PRUEF(gleich(ohne.aus_l, mit.aus_l) && gleich(ohne.aus_r, mit.aus_r));  // vb wurde nicht gespielt
    // die bisherige Variante bleibt, wenn eine fremde abgelehnt wird
    PRUEF(mit.boxen.variante_setzen(1, &va) == nullptr && mit.boxen.variante(1) == &va);
    PRUEF(mit.boxen.variante_setzen(1, &vb) == &vb && mit.boxen.variante(1) == &va && mit.boxen.abgelehnt() == 2);
    // gleicher name, aber die Länge passt nicht zum Tempo der Variante (frames für 128 statt für 130)
    cdj::Loop falsch = variante_pos(a, 130.0);
    falsch.frames = a.frames;
    falsch.daten.resize((size_t)falsch.frames * 2);
    PRUEF(mit.boxen.variante_setzen(1, &falsch) == &falsch && mit.boxen.abgelehnt() == 3);
    // ±1 Frame Rundung ist erlaubt, ±2 nicht
    cdj::Loop pm1 = variante_pos(a, 130.0);
    pm1.frames += 1;
    pm1.daten.resize((size_t)pm1.frames * 2);
    cdj::Loop pm2 = variante_pos(a, 130.0);
    pm2.frames += 2;
    pm2.daten.resize((size_t)pm2.frames * 2);
    PRUEF(mit.boxen.variante_setzen(1, &pm1) == &va);  // angenommen, va geht zurück (klingt nicht: Box steht nicht)
    PRUEF(mit.boxen.variante_setzen(1, &pm2) == &pm2 && mit.boxen.variante(1) == &pm1);
    // F5: andere beats bei gleicher Länge (sonst nur die beats-Prüfung greift): abgelehnt, die Box spielt Varispeed wie ohne
    cdj::Loop b8 = variante_pos(a, 130.0);
    b8.beats = 8;
    const int vor = mit.boxen.abgelehnt();
    PRUEF(mit.boxen.variante_setzen(1, &b8) == &b8 && mit.boxen.abgelehnt() == vor + 1 && mit.boxen.variante(1) == &pm1);
    // bpm, das kein Tempo ist
    cdj::Loop nb = variante_pos(a, 130.0);
    nb.bpm = 0.0;
    PRUEF(mit.boxen.variante_setzen(1, &nb) == &nb);
    nb.bpm = std::nan("");
    PRUEF(mit.boxen.variante_setzen(1, &nb) == &nb);
    // Negativ-Kontrolle: die passende Variante (gleicher name) wird angenommen und gespielt
    Welt ok(130.0);
    ok.boxen.laden(1, &a);
    PRUEF(ok.boxen.variante_setzen(1, &va) == nullptr && ok.boxen.variante(1) == &va && ok.boxen.abgelehnt() == 0);
    ok.boxen.start(1, 0.0);
    ok.bis(3 * SPB);
    PRUEF_NAH(ok.aus_l[2 * SPB], 0.25, 1e-6);  // Variante klingt (Konstante 0,25)
  }
  {  // K(i) F9: Länge der Variante: daten.size() == 2 · frames und frames > 0, sonst abgelehnt wie F2
    const cdj::Loop gut = variante_pos(vier, 130.0);
    cdj::Loop kurz = gut;
    kurz.daten.resize(kurz.daten.size() - 2);
    cdj::Loop leer = gut;
    leer.frames = 0;
    leer.daten.clear();
    cdj::Loop lang = gut;
    lang.daten.resize(lang.daten.size() + 2);
    Welt w(130.0);
    w.boxen.laden(1, &vier);
    PRUEF(w.boxen.variante_setzen(1, &kurz) == &kurz && w.boxen.variante(1) == nullptr);
    PRUEF(w.boxen.variante_setzen(1, &leer) == &leer && w.boxen.variante(1) == nullptr);
    PRUEF(w.boxen.variante_setzen(1, &lang) == &lang && w.boxen.variante(1) == nullptr && w.boxen.abgelehnt() == 3);
    PRUEF(w.boxen.variante_setzen(1, &gut) == nullptr && w.boxen.variante(1) == &gut);  // Negativ-Kontrolle
  }
  {  // K(j) F5: Versatz der Box wird auf das Raster der Variante umgerechnet (v · frames'/beats / LOOP_SPB)
    const cdj::Loop v130 = variante_pos(vier, 130.0);
    const double spb2 = (double)v130.frames / 16.0;
    const double F = (double)v130.frames;
    for (const int64_t vers : {(int64_t)5000, (int64_t)-359999, (int64_t)0}) {
      Welt w(130.0);
      w.boxen.laden(1, &vier);
      w.boxen.variante_setzen(1, &v130);
      PRUEF(w.boxen.raster(1, vers) == 0);
      w.boxen.start(1, 0.0);
      w.bis(3 * SPB);
      double groesste = 0.0;
      int64_t geprueft = 0;
      for (int64_t t = 0; t < 3 * SPB; ++t) {
        double soll = std::fmod(w.karte.beat_at((double)t) * spb2 + (double)vers * spb2 / (double)SPB, F);
        if (soll < 0) soll += F;
        if (soll < 4.0 || soll > F - 4.0) continue;  // Umlauf: Catmull-Rom über die Naht ist kein Positionswert
        groesste = std::max(groesste, std::fabs((double)w.aus_l[t] - soll));
        ++geprueft;
      }
      std::printf("keylock_versatz %lld: geprüft %lld, größte Abweichung %.4f\n", (long long)vers, (long long)geprueft, groesste);
      PRUEF(geprueft > 2 * SPB && groesste < 0.1);
    }
  }
  {  // K(k) F3 (Slice 2b): ein Wechsel während einer laufenden Blende wartet deren Ende ab: kein Sprung, Zeiger genau einmal
    const cdj::Loop o = konstant(1.0f);
    const cdj::Loop v = variante_konst(o, 130.0, 0.2f);
    Welt w(130.0);
    w.boxen.laden(1, &o);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);
    const int64_t S = w.s;
    PRUEF(w.boxen.variante_setzen(1, &v) == nullptr);
    w.bis(S + N);  // ein Block in der Blende (Original → Variante)
    PRUEF(w.boxen.variante_setzen(1, nullptr) == nullptr);  // klingt noch
    w.bis(S + 8192);
    double sprung = 0.0;
    int64_t wo = 0;
    for (int64_t t = S; t < S + 8192; ++t) {
      const double d = std::fabs((double)w.aus_l[t] - (double)w.aus_l[t - 1]);
      if (d > sprung) { sprung = d; wo = t; }
    }
    std::printf("keylock_doppelwechsel: größter Sprung %.5f bei S+%lld, Ende %.3f\n", sprung, (long long)(wo - S),
                w.aus_l[S + 8191]);
    PRUEF(sprung < 0.1);
    PRUEF(std::fabs((double)w.aus_l[S + 8191] - 1.0) < 1e-6);  // am Ende wieder das Original
    PRUEF(w.boxen.abholen() == &v && w.boxen.abholen() == nullptr && w.boxen.abholen_verloren() == 0);
    // live über die Karte: Variante klingt, Rampe 130 → 130,03 über 0,02 Beats (Variante gilt an den Rändern wieder)
    Welt x(130.0);
    x.boxen.laden(1, &o);
    x.boxen.variante_setzen(1, &v);
    x.boxen.start(1, 0.0);
    x.bis(2 * SPB);
    const double b = x.karte.beat_at((double)x.s) + 0.5;
    PRUEF(x.karte.rampe(b, 130.03, 0.02));
    const int64_t r0 = std::llround(x.karte.sample_at(b));
    x.bis(r0 + 8192);
    double sp2 = 0.0;
    for (int64_t t = r0 - 2048; t < r0 + 8192; ++t) sp2 = std::max(sp2, std::fabs((double)x.aus_l[t] - (double)x.aus_l[t - 1]));
    std::printf("keylock_kurzrampe: größter Sprung %.5f\n", sp2);
    PRUEF(sp2 < 0.1);
    PRUEF(x.boxen.abholen() == nullptr && x.boxen.abholen_verloren() == 0);  // die Variante bleibt der Box
  }
  {  // K(l) F7/F5 Gegenprobe: der Stopp einer Box mit Variante verwirft Pfad und Blende, nichts leckt, Variante bleibt
    const cdj::Loop v = variante_pos(vier, 130.0);
    Welt w(130.0);
    w.boxen.laden(1, &vier);
    w.boxen.variante_setzen(1, &v);
    w.boxen.start(1, 0.0);
    w.bis(2 * SPB);
    w.boxen.stopp(1, w.jetzt());
    w.bis(6 * SPB);
    PRUEF(w.boxen.status(1) == cdj::BoxStatus::bereit && w.boxen.variante(1) == &v && w.boxen.abholen() == nullptr);
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
    for (int64_t s = 0; s < 2 * 90000; ++s) ok = ok && w.aus_l[s] == (float)((s + 5000) % 90000);
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
