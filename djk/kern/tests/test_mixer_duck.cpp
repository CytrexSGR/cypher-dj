// K2 Task 1.5: der Mixer duckt erz/2 (Index 5) und erz/3 (Index 6) mit der Duck-Hüllkurve, erz/1 (Index 4) nie.
// Gelesen wird immer master_summe_l() (Summe vor master/pegel und Limiter): die Latenz des Limiters darf den
// Vergleich nicht verfälschen. Verglichen wird ein Mixer mit Auslöser (A) gegen einen identischen ohne (B), Block für
// Block im Gleichschritt: so fallen Kanalzug-Filter und Fader aus dem Verhältnis heraus.
//  (a) duck/tiefe = 0 (Vorgabe): der Auslöser ändert nichts, Master bitgleich zum Lauf ohne Auslöser
//  (b) duck/tiefe = −12, release 600, Auslöser 100: EXAKT äquivalent zu einem Mixer mit duck/tiefe 0, dessen erz/2-Eingang
//      von Hand mit einer eigenen cdj::Duck (gleiche Werte) multipliziert wird (memcmp über 48 Blöcke); Gegenproben:
//      −11,9 dB und Auslöser 101 weichen ab
//  (c) erz/1 wird nie geduckt
//  (d) duck/release 50 statt 600: nach 100 ms ist der Pegel bei 50 höher
//  (e) erz/3 wird wie erz/2 geduckt (exakt)
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/mixer.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) {
    for (const char* k : {"erz/1", "erz/2", "erz/3"}) setze((std::string(k) + "/fader").c_str(), 0.0f);
  }
  void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
  // ein Block: konstant 0,5 auf den gewählten Erzeugern (links = rechts); liefert die Master-Summe links
  const float* block(bool e1, bool e2, bool e3) {
    const bool an[3] = {e1, e2, e3};
    for (int j = 0; j < 3; ++j) {
      for (int i = 0; i < N; ++i) {
        m->eingang_l(4 + j)[i] = an[j] ? 0.5f : 0.0f;
        m->eingang_r(4 + j)[i] = an[j] ? 0.5f : 0.0f;
      }
    }
    m->verarbeite(N, ml, mr, cl, cr);
    return m->master_summe_l();
  }
};

// A (mit Auslöser) und B (ohne) im Gleichschritt, je Block der Master von beiden
struct Paar {
  Lauf a, b;
  std::vector<float> sa, sb;   // alle Master-Samples seit dem ersten Block
  void setze(const char* pfad, float w) { a.setze(pfad, w); b.setze(pfad, w); }
  void block(bool e1, bool e2, bool e3) {
    const float* x = a.block(e1, e2, e3);
    const float* y = b.block(e1, e2, e3);
    sa.insert(sa.end(), x, x + N);
    sb.insert(sb.end(), y, y + N);
  }
  double verhaeltnis(size_t i) const { return sb[i] != 0.0f ? sa[i] / sb[i] : 1.0; }
};

// Exakte Äquivalenz: Mixer T (duck/tiefe, duck/release, duck_ausloesen(versatz)) gegen Referenz R (duck/tiefe 0, der
// Eingang von Kanal `idx` (5 = erz/2, 6 = erz/3) wird von Hand mit cdj::Duck(−12, 600, Auslöser 100) multipliziert).
// Liefert die Zahl der Master-Samples (links), die sich unterscheiden, von 48 · 256; `tief` ist der kleinste Gain der
// Referenz (Positivkontrolle: der Duck war wirklich tief).
static int abweichung(int idx, float t_tiefe, int t_versatz, float* tief = nullptr) {
  Lauf t, r;
  t.setze("duck/tiefe", t_tiefe);
  t.setze("duck/release", 600.0f);
  t.m->duck_ausloesen(t_versatz);
  cdj::Duck d;
  d.setze(-12.0f, 600.0f);
  d.ausloesen(100);
  float g[N], minimum = 1.0f;
  int anders = 0;
  for (int k = 0; k < 48; ++k) {
    d.block(g, N);
    for (int i = 0; i < N; ++i) minimum = std::fmin(minimum, g[i]);
    const bool an[3] = {false, idx == 5, idx == 6};
    for (Lauf* l : {&t, &r}) {
      for (int j = 0; j < 3; ++j)
        for (int i = 0; i < N; ++i) {
          const float v = an[j] ? 0.5f : 0.0f;
          l->m->eingang_l(4 + j)[i] = v;
          l->m->eingang_r(4 + j)[i] = v;
        }
    }
    for (int i = 0; i < N; ++i) {   // Referenz: Handmultiplikation wie im Mixer (l und r)
      r.m->eingang_l(idx)[i] *= g[i];
      r.m->eingang_r(idx)[i] *= g[i];
    }
    t.m->verarbeite(N, t.ml, t.mr, t.cl, t.cr);
    r.m->verarbeite(N, r.ml, r.mr, r.cl, r.cr);
    for (int i = 0; i < N; ++i) anders += t.m->master_summe_l()[i] != r.m->master_summe_l()[i];
  }
  if (tief) *tief = minimum;
  return anders;
}

int main() {
  const double ZIEL12 = std::pow(10.0, -12.0 / 20.0);

  // (a) Vorgabe duck/tiefe = 0: Auslöser ändert nichts (bitgleich)
  {
    Paar p;
    for (int k = 0; k < 4; ++k) p.block(true, true, true);   // Einschwingen der Kanalzüge
    p.a.m->duck_ausloesen(100);
    for (int k = 0; k < 8; ++k) p.block(true, true, true);
    PRUEF(std::memcmp(p.sa.data(), p.sb.data(), sizeof(float) * p.sa.size()) == 0);
    PRUEF(p.sa.back() != 0.0f);   // Positivkontrolle: es floss überhaupt Signal
  }

  // (b) exakte Äquivalenz für erz/2, dazu die Gegenproben
  {
    float tief = 1.0f;
    PRUEF(abweichung(5, -12.0f, 100, &tief) == 0);
    PRUEF_NAH(tief, ZIEL12, 0.001);   // Positivkontrolle: die Referenz duckt wirklich auf −12 dB
    const int falsche_tiefe = abweichung(5, -11.9f, 100);
    const int falscher_versatz = abweichung(5, -12.0f, 101);
    std::printf("Gegenprobe: -11,9 dB weicht in %d, Versatz 101 in %d von %d Samples ab\n", falsche_tiefe,
                falscher_versatz, 48 * N);
    PRUEF(falsche_tiefe > 1000 && falscher_versatz > 1000);
    PRUEF(abweichung(5, -12.0f, 100) == 0);   // Negativkontrolle: gleiche Werte bleiben gleich
  }

  // (c) erz/1 nie geduckt: nur erz/1 füttern, Auslöser, Master bleibt konstant (bitgleich zu B)
  {
    Paar p;
    p.setze("duck/tiefe", -12.0f);
    for (int k = 0; k < 4; ++k) p.block(true, false, false);
    p.a.m->duck_ausloesen(100);
    for (int k = 0; k < 6; ++k) p.block(true, false, false);
    PRUEF(std::memcmp(p.sa.data(), p.sb.data(), sizeof(float) * p.sa.size()) == 0);
    PRUEF(p.sa.back() != 0.0f);
  }

  // (d) duck/release 50 gegen 600: nach 100 ms (4800 Samples ab Auslöser) ist der Pegel bei 50 höher
  {
    float pegel[2] = {};
    const float rel[2] = {50.0f, 600.0f};
    for (int v = 0; v < 2; ++v) {
      Paar p;
      p.setze("duck/tiefe", -12.0f);
      p.setze("duck/release", rel[v]);
      for (int k = 0; k < 4; ++k) p.block(false, true, false);
      p.a.m->duck_ausloesen(0);
      for (int k = 0; k < 20; ++k) p.block(false, true, false);   // 5120 Samples
      pegel[v] = static_cast<float>(p.verhaeltnis(4 * N + 4800));
    }
    PRUEF(pegel[0] > pegel[1] + 0.1f);
    PRUEF(pegel[0] > 0.99f);   // bei 50 ms Release ist er nach 100 ms längst zurück
  }

  // (e) erz/3 wie erz/2 (exakt), und erz/2-Referenz passt nicht auf erz/3-Signal
  {
    PRUEF(abweichung(6, -12.0f, 100) == 0);
    PRUEF(abweichung(6, -11.9f, 100) > 1000);
  }
  PRUEF_ENDE();
}
