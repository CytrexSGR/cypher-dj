// K2 Task 2.2: der Mixer schließt den Rückweg fx/2 über den Hall: Send 2 aller Kanäle (nach dem Fader) → Hall →
// mal fx/2/rueckweg → Master-Summe. Gelesen wird master_summe_l() (vor master/pegel und Limiter).
//  (a) Vorgabe (alle Sends −200): Master bitgleich zum Mixer mit fx/2/rueckweg = −200 (der Hall liefert bei Stille 0)
//  (b) erz/2/send/2 = 0 dB, fx/2/rueckweg = 0 dB: Impuls in Block 0, danach Stille → Energie in Block 10..40;
//      ohne Send nicht (nur Filterreste < 1e-20)
//  (c) fx/2/rueckweg = −200 bei offenem Send: kein Nachhall am Master
//  (d) fx/1/rueckweg bleibt ohne Wirkung (nur fx/2 ist der Hall)
//  (e) Vorgabe, nur Stille am Eingang, 600 Blöcke: der Master bleibt EXAKT 0 (der Faust-Hall rauscht mit ~1e-20 auch
//      bei Stille; er darf bei geschlossenem Send nicht in die Summe)
//  (g) fx/2/rueckweg als Verlauf (vl): wirkt sample-genau und wird danach nachgeführt
//  (h) Send nur auf dem rechten Kanal weckt den Hall; der rechte Ausgang trägt Hall
//  (f) nach einem Nachhall, dessen Send wieder zu ist, läuft der Hall aus: später exakt 0 am Master-Anteil
#include <cmath>
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
  std::vector<float> summe;   // alle Master-Samples links
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) {
    for (const char* k : {"erz/1", "erz/2", "erz/3"}) setze((std::string(k) + "/fader").c_str(), 0.0f);
  }
  void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
  // ein Block auf erz/2: Impuls am ersten Sample (impuls) oder Stille; bei `dauer` konstant 0,3
  void block(bool impuls, bool dauer = false) {
    for (int i = 0; i < N; ++i) {
      const float v = dauer ? 0.3f : (impuls && i == 0 ? 0.5f : 0.0f);
      m->eingang_l(5)[i] = v;
      m->eingang_r(5)[i] = v;
    }
    m->verarbeite(N, ml, mr, cl, cr);
    summe.insert(summe.end(), m->master_summe_l(), m->master_summe_l() + N);
  }
  // Energie der Master-Samples links in Block a..b (einschließlich)
  double energie(int a, int b) const {
    double e = 0;
    for (int i = a * N; i < (b + 1) * N; ++i) e += static_cast<double>(summe[i]) * summe[i];
    return e;
  }
};

// Impuls in Block 0, dann Stille bis Block 40
static void impuls_lauf(Lauf& l) {
  l.block(true);
  for (int k = 1; k < 41; ++k) l.block(false);
}

int main() {
  // (a) Vorgabe: bitgleich zu rueckweg = −200, Signal fließt (Kanalzug klingt nach, Positivkontrolle)
  {
    Lauf a, b;
    b.setze("fx/2/rueckweg", -200.0f);
    for (int k = 0; k < 12; ++k) { a.block(k == 0, k > 0); b.block(k == 0, k > 0); }
    PRUEF(std::memcmp(a.summe.data(), b.summe.data(), sizeof(float) * a.summe.size()) == 0);
    PRUEF(a.summe.back() != 0.0f);
  }

  // (b) offener Send: Nachhall in Block 10..40; ohne Send nicht (nur Filterreste < 1e-20)
  double mit = 0, ohne = 0;
  {
    Lauf l;
    l.setze("erz/2/send/2", 0.0f);
    impuls_lauf(l);
    mit = l.energie(10, 40);
    Lauf s;
    impuls_lauf(s);
    ohne = s.energie(10, 40);
    std::printf("Nachhall-Energie Block 10..40: mit Send %g, ohne %g\n", mit, ohne);
    PRUEF(mit > 1e-6);
    PRUEF(ohne < 1e-20);   // nur das Auslaufen der Kanalzug-Filter (Denormal-Reste), kein Hall
  }

  // (c) Rückweg aus (−200) bei offenem Send: kein Nachhall
  {
    Lauf l;
    l.setze("erz/2/send/2", 0.0f);
    l.setze("fx/2/rueckweg", -200.0f);
    impuls_lauf(l);
    PRUEF(l.energie(10, 40) < mit * 1e-9);
  }

  // (d) fx/1/rueckweg −200 ändert nichts (bitgleich zum Lauf mit Vorgabe); Gegenprobe: fx/2/rueckweg −6 ändert
  {
    Lauf a, b, c;
    for (Lauf* l : {&a, &b, &c}) l->setze("erz/2/send/2", 0.0f);
    b.setze("fx/1/rueckweg", -200.0f);
    c.setze("fx/2/rueckweg", -6.0f);
    impuls_lauf(a);
    impuls_lauf(b);
    impuls_lauf(c);
    PRUEF(std::memcmp(a.summe.data(), b.summe.data(), sizeof(float) * a.summe.size()) == 0);
    PRUEF(std::memcmp(a.summe.data(), c.summe.data(), sizeof(float) * a.summe.size()) != 0);
    PRUEF(c.energie(10, 40) < a.energie(10, 40));
  }

  // (e) Stille, Vorgaben: Master exakt 0
  {
    Lauf l;
    for (int k = 0; k < 600; ++k) l.block(false);
    int nicht_null = 0;
    for (float v : l.summe) nicht_null += v != 0.0f;
    PRUEF(nicht_null == 0);
  }

  // (f) Impuls mit offenem Send, danach Stille bis Block 3000 (16 s): der Nachhall klingt ab und der Master wird 0
  {
    Lauf l;
    l.setze("erz/2/send/2", 0.0f);
    for (int k = 0; k < 3000; ++k) {
      if (k == 4) l.setze("erz/2/send/2", -200.0f);   // die Filterreste des Impulses sind bis dahin im Send
      l.block(k == 0);
    }
    std::printf("(f) Energie Block 10..40: %g, 500..600: %g\n", l.energie(10, 40), l.energie(500, 600));
    PRUEF(l.energie(500, 600) > 1e-10);   // der Nachhall klingt noch (Stand 1,8e-9): er bricht nicht bei −44 dBFS ab
    PRUEF(l.m->hall_ruhe() <= 65536 + 1024);   // der Stillezähler zählt nur, solange der Hall wach ist
    PRUEF(l.energie(10, 40) > 1e-6);   // Positivkontrolle: Nachhall stand
    int nicht_null = 0;
    for (int i = 2990 * N; i < 3000 * N; ++i) nicht_null += l.summe[i] != 0.0f;
    PRUEF(nicht_null == 0);
  }

  // (g), (h): erz/1 geht auf bus/1 (Ziel 1, Bus-Fader zu): in der Summe steht nur der Hall-Rückweg
  struct Nur {
    sw::ReglerTabelle tab;
    std::unique_ptr<cdj::Mixer> m;
    float ml[N], mr[N], cl[N], cr[N];
    unsigned z = 99;
    Nur() : m(std::make_unique<cdj::Mixer>(tab)) {
      setze("erz/1/fader", 0.0f);
      setze("erz/1/send/2", 0.0f);
      setze("erz/1/ziel", 1.0f);
    }
    void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
    // Rauschen auf erz/1; rechts nur, wenn mit_l falsch ist (links stumm)
    void block(bool mit_l = true) {
      for (int i = 0; i < N; ++i) {
        z = z * 1664525u + 1013904223u;
        const float v = ((z >> 9) / 8388608.0f - 1.0f) * 0.3f;
        m->eingang_l(4)[i] = mit_l ? v : 0.0f;
        m->eingang_r(4)[i] = v;
      }
      m->verarbeite(N, ml, mr, cl, cr);
    }
  };
  {   // (g) Verlauf: 0 dB bis Index 99, ab 100 −6 dB; B bleibt 0 dB, C steht ab Blockanfang auf −6 dB
    Nur a, b, c;
    for (int k = 0; k < 60; ++k) { a.block(); b.block(); c.block(); }
    PRUEF(std::memcmp(a.m->master_summe_l(), b.m->master_summe_l(), sizeof(float) * N) == 0);
    PRUEF(a.m->master_summe_l()[N - 1] != 0.0f);   // Positivkontrolle: in der Summe steht Hall
    float vl[N];
    for (int i = 0; i < N; ++i) vl[i] = i < 100 ? 0.0f : -6.0f;
    a.m->verlauf(a.tab.suche("fx/2/rueckweg"), vl);
    c.setze("fx/2/rueckweg", -6.0f);
    a.block(); b.block(); c.block();
    int falsch = 0;
    for (int i = 0; i < N; ++i) {
      const float* ref_l = i < 100 ? b.m->master_summe_l() : c.m->master_summe_l();
      const float* ref_r = i < 100 ? b.m->master_summe_r() : c.m->master_summe_r();
      falsch += a.m->master_summe_l()[i] != ref_l[i] || a.m->master_summe_r()[i] != ref_r[i];
    }
    PRUEF(falsch == 0);
    PRUEF(std::memcmp(b.m->master_summe_l(), c.m->master_summe_l(), sizeof(float) * N) != 0);   // die Stände unterscheiden sich
    a.block(); b.block(); c.block();   // Folgeblock ohne neuen Verlauf: nachgeführt auf −6 dB
    PRUEF(std::memcmp(a.m->master_summe_l(), c.m->master_summe_l(), sizeof(float) * N) == 0);
    PRUEF(std::memcmp(a.m->master_summe_l(), b.m->master_summe_l(), sizeof(float) * N) != 0);
    PRUEF(a.m->wert(a.tab.suche("fx/2/rueckweg")) == -6.0f);
  }
  {   // (h) Signal nur rechts: der Hall wacht auf, rechts steht Hall
    Nur r;
    double er = 0, el = 0;
    for (int k = 0; k < 30; ++k) {
      r.block(false);
      for (int i = 0; i < N; ++i) {
        er += static_cast<double>(r.m->master_summe_r()[i]) * r.m->master_summe_r()[i];
        el += static_cast<double>(r.m->master_summe_l()[i]) * r.m->master_summe_l()[i];
      }
    }
    std::printf("(h) nur rechts gespeist: Energie rechts %g, links %g\n", er, el);
    PRUEF(er > 1e-6);
  }
  PRUEF_ENDE();
}
