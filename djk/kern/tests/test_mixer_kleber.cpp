// K2 Task 3.3 (Umbau nach der Abnahme-Messung): master/kleber ist die SCHWELLE des Summen-Kompressors (2:1, Attack 30 ms,
// Release 200 ms, Detektor |L|+|R|): schwelle_db = 6 - 36 * master/kleber (0 = +6 = nie erreicht, 1/3 = -6, 1 = -30), voll
// nass, keine Parallelmischung. Der Kleber sitzt auf der Summe nach der Master-FX und dem Hall-Rückweg, vor master/pegel.
// Gelesen wird summe_nach_kleber_l()/_r() (geht in master/pegel und Limiter); master_summe_l()/_r() ist der Ohr-Abgriff
// und bleibt davor. Bezug ist der Lauf mit master/kleber = 0 (der Kanalzug ändert den Pegel).
//  (a) nie eingeschaltet (0, Vorgabe): übersprungen, bitgleich; Positivkontrolle: bei 1 weicht die Summe ab
//  (b) 1 gleich einem eigenen cdj::Kleber(-30 dB) auf der Summe von (a) (Sample für Sample, < 1e-6)
//  (c) 1/3 (Schwelle -6): derselbe Wert wie der bisherige feste Kompressor, Sinus 1,0 -> -5,31 dB ±0,2
//  (c2) Monotonie: Reduktion bei 0,25 < 0,5 < 0,75 < 1 für ein festes lautes Signal; ein leises (-20 dBFS Spitze) wird bei
//      0,9 um mehr als 1 dB gedrückt (der Entwurf mit fester Schwelle: 0)
//  (d) Verlauf: nur sein Wert am Blockende zählt (kein Sample-Genauigkeit mehr), gleich einem Sofort-Wert; nachgeführt
//  (e) Signal nur rechts (und nur links): der Kanal wird genauso behandelt; der stille bleibt exakt 0
//  (f) Ohr-Abgriff: master_summe_l/r() ist bei 1 bitgleich zu 0 (der Kleber wirkt danach), der Master-Ausgang (ml) und
//      summe_nach_kleber_l() unterscheiden sich
//  (g) Position: mit offenem erz/1/send/2 (Hall-Rückweg) ist die Summe nach Kleber gleich einem eigenen Kleber auf der
//      Summe bei 0 einschließlich Hall
//  (h) nach Signal und 200 Blöcken Stille ist der Kleber-Zustand sauber: das nächste Signal klebt wie frisch
//  (i) knackfrei aus: 1 -> 0 per setze_sofort (wie ein Handgriff): der Gain springt zwischen zwei Samples um höchstens
//      1e-3, erholt sich monoton auf 1, danach wird übersprungen (nk bitgleich sum)
//  (j) knackfrei ein: 0 -> 1 ohne Gain-Sprung über 1e-3
//  (k) 0 = aus auch bei heißer Summe (Sinus-Amplitude 1,5 auf beiden Kanälen): nach 1 → 0 endet der Nachlauf in ≤ 1 s,
//      danach ist die Summe nach Kleber bitgleich zum Abgriff (die Aus-Schwelle liegt unerreichbar hoch)
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kleber.h"
#include "cypherdj/mixer.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr int B = 200;
static float schwelle(float a) { return 6.0f - 36.0f * a; }

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  std::vector<float> sl, sr;   // Ohr-Abgriff master_summe_l/r (vor dem Kleber)
  std::vector<float> nl, nr;   // Summe nach Kleber (summe_nach_kleber_l/r), die in master/pegel geht
  std::vector<float> ol;       // Master-Ausgang links (ml)
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) { setze("erz/1/fader", 0.0f); }
  void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
  // Block k: Sinus 100 Hz mit Amplitude a auf erz/1, links und/oder rechts
  void block(int k, float a, bool links = true, bool rechts = true) {
    for (int i = 0; i < N; ++i) {
      const float v = a * std::sin(2.0f * 3.14159265f * 100.0f * float(k * N + i) / 48000.0f);
      m->eingang_l(4)[i] = links ? v : 0.0f;
      m->eingang_r(4)[i] = rechts ? v : 0.0f;
    }
    m->verarbeite(N, ml, mr, cl, cr);
    sl.insert(sl.end(), m->master_summe_l(), m->master_summe_l() + N);
    sr.insert(sr.end(), m->master_summe_r(), m->master_summe_r() + N);
    nl.insert(nl.end(), m->summe_nach_kleber_l(), m->summe_nach_kleber_l() + N);
    nr.insert(nr.end(), m->summe_nach_kleber_r(), m->summe_nach_kleber_r() + N);
    ol.insert(ol.end(), ml, ml + N);
  }
};

// RMS links über die letzten `z` Blöcke
static double rms(const std::vector<float>& s, int z) {
  double e = 0;
  const size_t von = s.size() - static_cast<size_t>(z) * N;
  for (size_t i = von; i < s.size(); ++i) e += static_cast<double>(s[i]) * s[i];
  return std::sqrt(e / (static_cast<double>(z) * N));
}
static double db(double a, double b) { return 20.0 * std::log10(a / b); }
static float spitze(const std::vector<float>& s) {
  float p = 0;
  for (float v : s) p = std::fmax(p, std::fabs(v));
  return p;
}

// Maximaler Abstand von zwei Vektoren
static double abstand(const std::vector<float>& a, const std::vector<float>& b, size_t von = 0) {
  double m = 0;
  for (size_t i = von; i < a.size() && i < b.size(); ++i) m = std::fmax(m, std::fabs(double(a[i]) - b[i]));
  return m;
}
// Kleber auf der Summe eines Bezugslaufs (a = 0): so muss der Mixer bei fester Schwelle klingen
static std::vector<float> kleber_auf(const std::vector<float>& l, const std::vector<float>& r, float schw, std::vector<float>* rr = nullptr) {
  cdj::Kleber k;
  k.setze_schwelle(schw);
  std::vector<float> a(l), b(r);
  k.block(a.data(), b.data(), static_cast<int>(a.size()));
  if (rr) *rr = b;
  return a;
}
// Gain nk/sum je Sample, wo |sum| groß genug ist; index < 0 sonst
struct Gain {
  std::vector<float> g;
  std::vector<size_t> i;
};
static Gain gain_von(const Lauf& l, size_t von, size_t bis) {
  Gain r;
  for (size_t k = von; k < bis; ++k)
    if (std::fabs(l.sl[k]) > 0.3f) {
      r.g.push_back(l.nl[k] / l.sl[k]);
      r.i.push_back(k);
    }
  return r;
}
static double groesster_schritt(const Gain& g) {   // nur Nachbar-Samples
  double m = 0;
  for (size_t k = 1; k < g.g.size(); ++k)
    if (g.i[k] == g.i[k - 1] + 1) m = std::fmax(m, std::fabs(double(g.g[k]) - g.g[k - 1]));
  return m;
}

int main() {
  // Eingangspegel so, dass die Summe (a = 0) ≈ 0 dBFS Spitze hat: am Kanalzug gemessen
  float amp = 1.0f;
  {
    Lauf k;
    for (int b = 0; b < 100; ++b) k.block(b, 1.0f);
    const float p = spitze(k.nl);
    PRUEF(p > 0.05f);
    amp = 1.0f / p;
  }
  
  auto lauf_mit = [&](float a, float pegel, int bloecke = B) {
    auto l = std::make_unique<Lauf>();
    l->setze("master/kleber", a);
    for (int b = 0; b < bloecke; ++b) l->block(b, pegel);
    return l;
  };
  auto n0 = lauf_mit(0.0f, amp);
  auto n1 = lauf_mit(1.0f, amp);
  PRUEF_NAH(spitze(n0->nl), 1.0f, 0.02f);

  {   // (a) nie eingeschaltet: bitgleich zu einem zweiten Mixer auf 0; Positivkontrolle: bei 1 weicht die Summe ab
    auto x = lauf_mit(0.0f, amp);
    PRUEF(std::memcmp(x->nl.data(), n0->nl.data(), sizeof(float) * x->nl.size()) == 0);
    PRUEF(std::memcmp(x->nl.data(), x->sl.data(), sizeof(float) * x->nl.size()) == 0);   // nach Kleber == Abgriff
    PRUEF(std::memcmp(x->nr.data(), x->sr.data(), sizeof(float) * x->nr.size()) == 0);
    PRUEF(std::memcmp(n1->nl.data(), n0->nl.data(), sizeof(float) * n1->nl.size()) != 0);
    PRUEF(n0->m->wert(n0->tab.suche("master/kleber")) == 0.0f);
  }
  {   // (b) 1: Schwelle -30, voll nass: gleich dem Kleber auf der Summe von (a)
    PRUEF(abstand(kleber_auf(n0->nl, n0->nr, -30.0f), n1->nl) < 1e-6);
    PRUEF(abstand(kleber_auf(n0->nl, n0->nr, -6.0f), n1->nl) > 0.05);   // Positivkontrolle: die Schwelle zählt
    PRUEF(db(rms(n1->nl, 20), rms(n0->nl, 20)) < -8.0);
  }
  {   // (c) 1/3: die Schwelle -6 des bisherigen festen Kompressors: Sinus 1,0 -> -5,31 dB ±0,2
    const float a = 1.0f / 3.0f;
    auto n = lauf_mit(a, amp);
    const double d = db(rms(n->nl, 20), rms(n0->nl, 20));
    PRUEF(d < -5.11 && d > -5.51);   // test_kleber.cpp: kleber_sim.py -6 -> -5,31 dB für L = R, Spitze 1,0
    PRUEF(abstand(kleber_auf(n0->nl, n0->nr, schwelle(a)), n->nl) < 1e-6);
  }
  {   // (c2) Monotonie und die leise Lage, in der der feste Kompressor nichts tat
    double d[4];
    const float as[4] = {0.25f, 0.5f, 0.75f, 1.0f};
    for (int k = 0; k < 4; ++k) d[k] = db(rms(lauf_mit(as[k], amp)->nl, 20), rms(n0->nl, 20));
    PRUEF(d[0] < 0.0 && d[0] > d[1] && d[1] > d[2] && d[2] > d[3]);
    const float leise = amp * 0.1f;   // -20 dBFS Spitze
    auto q0 = lauf_mit(0.0f, leise);
    const double dq = db(rms(lauf_mit(0.9f, leise)->nl, 20), rms(q0->nl, 20));
    PRUEF(dq < -1.0);
    PRUEF(std::fabs(db(rms(lauf_mit(0.0f, leise)->nl, 20), rms(q0->nl, 20))) == 0.0);   // bei 0 nichts
  }
  {   // (d) Verlauf: nur der Wert am Blockende zählt; gleich einem Sofort-Wert; danach nachgeführt
    // Der Kleber läuft vorher mit 0,05 (Schwelle +4,2: Hüllkurve steht, kaum Wirkung): ein frischer wäre im ersten Block
    // noch in der Anstiegszeit (30 ms) und änderte nichts.
    Lauf x, v, z, w;   // Sofort-Wert 1 / Verlauf 0 -> 1 mitten im Block / Verlauf mit Ende 0,05 / bleibt bei 0,05
    for (Lauf* l : {&x, &v, &z, &w}) l->setze("master/kleber", 0.05f);
    for (int b = 0; b < 60; ++b) { x.block(b, amp); v.block(b, amp); z.block(b, amp); w.block(b, amp); }
    x.setze("master/kleber", 1.0f);
    float vl[N], vz[N];
    for (int i = 0; i < N; ++i) { vl[i] = i < 100 ? 0.0f : 1.0f; vz[i] = i < 100 ? 1.0f : 0.05f; }
    v.m->verlauf(v.tab.suche("master/kleber"), vl);
    z.m->verlauf(z.tab.suche("master/kleber"), vz);
    x.block(60, amp);
    v.block(60, amp);
    z.block(60, amp);
    w.block(60, amp);
    PRUEF(std::memcmp(x.nl.data() + 60 * N, v.nl.data() + 60 * N, sizeof(float) * N) == 0);
    PRUEF(std::memcmp(x.nr.data() + 60 * N, v.nr.data() + 60 * N, sizeof(float) * N) == 0);   // rechts genauso
    PRUEF(std::memcmp(z.nl.data() + 60 * N, w.nl.data() + 60 * N, sizeof(float) * N) == 0);   // Ende 0,05: Verlauf vorher egal
    PRUEF(std::memcmp(z.nl.data() + 60 * N, x.nl.data() + 60 * N, sizeof(float) * N) != 0);
    PRUEF(std::memcmp(x.nl.data() + 60 * N, x.sl.data() + 60 * N, sizeof(float) * N) != 0);   // Positivkontrolle
    x.block(61, amp);
    v.block(61, amp);
    PRUEF(std::memcmp(x.nl.data() + 61 * N, v.nl.data() + 61 * N, sizeof(float) * N) == 0);   // nachgeführt auf 1
    PRUEF(v.m->wert(v.tab.suche("master/kleber")) == 1.0f);
  }
  {   // (e) nur rechts und nur links: gleich behandelt (Detektor |L| + |R|), der stille Kanal bleibt exakt 0
    Lauf rechts, links, r0;
    rechts.setze("master/kleber", 1.0f);
    links.setze("master/kleber", 1.0f);
    for (int b = 0; b < B; ++b) {
      rechts.block(b, amp, false, true);
      links.block(b, amp, true, false);
      r0.block(b, amp, false, true);
    }
    bool still = true;
    for (size_t i = 0; i < rechts.nl.size(); ++i) still = still && rechts.nl[i] == 0.0f && links.nr[i] == 0.0f;
    PRUEF(still);
    PRUEF(std::memcmp(rechts.nr.data(), links.nl.data(), sizeof(float) * rechts.nr.size()) == 0);   // spiegelbildlich
    std::vector<float> rr;
    kleber_auf(r0.nl, r0.nr, -30.0f, &rr);
    PRUEF(abstand(rr, rechts.nr) < 1e-6);
    PRUEF(db(rms(rechts.nr, 20), rms(r0.nr, 20)) < -1.0);   // Positivkontrolle: nur rechts wirkt er auch
  }
  {   // (f) der Ohr-Abgriff sieht den Kleber nicht
    PRUEF(std::memcmp(n1->sl.data(), n0->sl.data(), sizeof(float) * n1->sl.size()) == 0);
    PRUEF(std::memcmp(n1->sr.data(), n0->sr.data(), sizeof(float) * n1->sr.size()) == 0);
    PRUEF(std::memcmp(n1->nl.data(), n0->nl.data(), sizeof(float) * n1->nl.size()) != 0);   // die geklebte Summe schon
    PRUEF(std::memcmp(n1->ol.data(), n0->ol.data(), sizeof(float) * n1->ol.size()) != 0);   // und der Master-Ausgang
    PRUEF(rms(n1->ol, 20) < rms(n0->ol, 20));
  }
  {   // (g) Position nach dem Hall-Rückweg
    Lauf h0, h1;
    for (Lauf* h : {&h0, &h1}) {
      h->setze("erz/1/send/2", 0.0f);
      h->setze("fx/2/rueckweg", 0.0f);
    }
    h1.setze("master/kleber", 1.0f);
    for (int b = 0; b < B; ++b) { h0.block(b, amp); h1.block(b, amp); }
    PRUEF(abstand(kleber_auf(h0.nl, h0.nr, -30.0f), h1.nl) < 1e-6);
    PRUEF(std::memcmp(h0.nl.data(), n0->nl.data(), sizeof(float) * h0.nl.size()) != 0);   // Positivkontrolle: Hall in der Summe
  }
  {   // (h) Stille leert den Kleber: Bezug ist ein frischer Kleber auf der Summe von Anteil 0 (dort ab Block 220)
    Lauf s, r;
    s.setze("master/kleber", 1.0f);
    for (int b = 0; b < 240; ++b) {
      const float a = (b < 20 || b >= 220) ? amp : 0.0f;
      s.block(b, a);
      r.block(b, a);
    }
    bool null = true;   // Voraussetzung: am Ende der Stille ist die Summe exakt 0 (sonst gilt die Stille-Regel nicht)
    for (size_t i = 219 * N; i < 220 * N; ++i) null = null && r.nl[i] == 0.0f && r.nr[i] == 0.0f;
    PRUEF(null);
    const std::vector<float> l(r.nl.begin() + 220 * N, r.nl.end()), rr(r.nr.begin() + 220 * N, r.nr.end());
    const std::vector<float> ref = kleber_auf(l, rr, -30.0f);
    const std::vector<float> ist(s.nl.begin() + 220 * N, s.nl.end());
    PRUEF(abstand(ref, ist) == 0.0);
  }
  {   // (i) knackfrei aus: Handgriff 1 -> 0 (setze_sofort, kein Verlauf)
    Lauf k;
    k.setze("master/kleber", 1.0f);
    for (int b = 0; b < 150; ++b) k.block(b, amp);
    const Gain vor = gain_von(k, 100 * N, 150 * N);
    PRUEF(!vor.g.empty() && vor.g.back() < 0.8f);   // Positivkontrolle: er drückt
    k.setze("master/kleber", 0.0f);
    int fertig = -1;   // erster Block, ab dem bis zum Ende nk == sum
    for (int b = 150; b < 1100; ++b) {
      k.block(b, amp);
      const size_t o = static_cast<size_t>(b) * N;
      const bool gleich = std::memcmp(k.nl.data() + o, k.sl.data() + o, sizeof(float) * N) == 0 &&
                          std::memcmp(k.nr.data() + o, k.sr.data() + o, sizeof(float) * N) == 0;
      if (!gleich) fertig = -1;
      else if (fertig < 0) fertig = b;
    }
    PRUEF(fertig > 150 && fertig < 1000);   // er rechnet weiter, bis er abgeklungen ist, und dann nie wieder
    const Gain g = gain_von(k, 150 * N, static_cast<size_t>(fertig) * N);
    PRUEF(g.g.size() > 1000);
    // Schritt je Sample über den Handgriff hinweg (ab Block 149, noch mit Kleber) bis über das Ende des Abklingens
    const Gain ueber = gain_von(k, 149 * N, static_cast<size_t>(std::max(fertig, 160)) * N);
    PRUEF(groesster_schritt(ueber) <= 1e-3);
    double rueck = 0;   // monoton (nicht fallend) auf 1, bis auf das Rippeln der Hüllkurve im Takt der Sinusperiode
    for (size_t j = 1; j < g.g.size(); ++j) rueck = std::fmax(rueck, double(g.g[j - 1]) - g.g[j]);
    PRUEF(rueck <= 2e-4);
    PRUEF(!g.g.empty() && g.g.front() < 0.8f && g.g.back() > 0.999f);
  }
  {   // (j) knackfrei ein: 0 -> 1
    Lauf k;
    for (int b = 0; b < 50; ++b) k.block(b, amp);
    k.setze("master/kleber", 1.0f);
    for (int b = 50; b < 200; ++b) k.block(b, amp);
    const Gain g = gain_von(k, 50 * N, 200 * N);
    PRUEF(g.g.size() > 1000);
    PRUEF(groesster_schritt(g) <= 1e-3);
    PRUEF(g.g.back() < 0.8f);   // und er greift danach
  }
  {   // (k) heiße Summe: Amplitude 1,5 -> Detektor |L|+|R| bis +9,5 dB, über der alten Aus-Schwelle von +6
    Lauf k;
    k.setze("master/kleber", 1.0f);
    for (int b = 0; b < 150; ++b) k.block(b, amp * 1.5f);
    const Gain heiss = gain_von(k, 100 * N, 150 * N);
    PRUEF(!heiss.g.empty() && heiss.g.back() < 0.8f);   // Positivkontrolle: er drückt
    k.setze("master/kleber", 0.0f);
    int fertig = -1;
    for (int b = 150; b < 150 + 400; ++b) {
      k.block(b, amp * 1.5f);
      const size_t o = static_cast<size_t>(b) * N;
      const bool gleich = std::memcmp(k.nl.data() + o, k.sl.data() + o, sizeof(float) * N) == 0 &&
                          std::memcmp(k.nr.data() + o, k.sr.data() + o, sizeof(float) * N) == 0;
      if (!gleich) fertig = -1;
      else if (fertig < 0) fertig = b;
    }
    PRUEF(fertig > 150 && fertig <= 150 + 188);   // ≤ 1 s (188 Blöcke à 256 bei 48 kHz), und dann nie wieder anders
  }
  PRUEF_ENDE();
}
