// Effekt-Sektion Schritt 1 (Plan 2026-10-11-effekt-sektion.md): Kompressor je Quellkanal im Mixer, nach EQ/Filter, vor dem
// Fader. Gelesen wird master_summe_l() (vor master/pegel und Limiter) und der Cue-Ausgang (PFL).
//  (a) komp/an 0: bitgleich zu einem Mixer, dessen Kompressor nie lief; nach an → aus wieder bitgleich (Zustand geleert)
//  (b) komp/an 1, T −20, R 4 auf einem 0-dBFS-Sinus in deck/2: Master-Spitze −15 dBFS ±0,3, Anzeige ≈ 15 dB
//  (c) pad/1 bleibt unberührt, wenn nur deck/2 komprimiert
//  (d) vor dem Fader: mit deck/2/fader −200 und PFL an hört der Cue den komprimierten Abgriff (15 dB leiser als ohne)
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/mixer.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  long t = 0;
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) {
    for (const char* k : {"deck/2", "pad/1"}) setze((std::string(k) + "/fader").c_str(), 0.0f);
  }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  // ein Block: 1-kHz-Sinus mit Amplitude a auf erz/<kanal> (index kanal); liefert Master-Summe links
  const float* block(int kanal, float a) {
    for (int j = 1; j <= 2; ++j)
      for (int i = 0; i < N; ++i) {
        const float x = (j == kanal) ? static_cast<float>(a * std::sin(2.0 * PI * 1000.0 * (t + i) / 48000.0)) : 0.0f;
        m->eingang_l(j)[i] = x;
        m->eingang_r(j)[i] = x;
      }
    t += N;
    m->verarbeite(N, ml, mr, cl, cr);
    return m->master_summe_l();
  }
};

static double spitze_db(const float* x, int n) {
  float p = 0.0f;
  for (int i = 0; i < n; ++i) p = std::fmax(p, std::fabs(x[i]));
  return 20.0 * std::log10(std::fmax(p, 1e-9f));
}

int main() {
  // (a) aus = bitgleich; an → aus wieder bitgleich
  {
    Lauf a, b;
    int anders = 0;
    for (int k = 0; k < 40; ++k) {
      if (k == 10) b.setze("deck/2/komp/an", 1.0f);
      if (k == 20) b.setze("deck/2/komp/an", 0.0f);
      const float* x = a.block(1, 0.9f);
      const float* y = b.block(1, 0.9f);
      if (k < 10 || k >= 21) anders += std::memcmp(x, y, sizeof(float) * N) != 0;
      if (k == 15) PRUEF(std::memcmp(x, y, sizeof(float) * N) != 0);   // Positivkontrolle: an wirkt
    }
    PRUEF(anders == 0);
    PRUEF(b.m->komp_gr_db(1) == 0.0f);
  }
  // (b) Kennlinie im Kern
  {
    Lauf a;
    a.setze("deck/2/komp/an", 1.0f);
    a.setze("deck/2/komp/schwelle", -20.0f);
    a.setze("deck/2/komp/ratio", 4.0f);
    std::vector<float> letzte;
    for (int k = 0; k < 400; ++k) {
      const float* x = a.block(1, 1.0f);
      if (k >= 380) letzte.insert(letzte.end(), x, x + N);
    }
    PRUEF_NAH(spitze_db(letzte.data(), static_cast<int>(letzte.size())), -15.0, 0.3);
    PRUEF_NAH(a.m->komp_gr_db(1), 15.0, 0.3);
  }
  // (c) pad/1 unberührt
  {
    Lauf a, b;
    b.setze("deck/2/komp/an", 1.0f);
    b.setze("deck/2/komp/schwelle", -40.0f);
    int anders = 0;
    for (int k = 0; k < 40; ++k) anders += std::memcmp(a.block(2, 0.9f), b.block(2, 0.9f), sizeof(float) * N) != 0;
    PRUEF(anders == 0);
  }
  // (d) vor dem Fader: PFL hört den Kompressor
  {
    Lauf aus, an;
    for (Lauf* l : {&aus, &an}) {
      l->setze("deck/2/fader", -200.0f);
      l->setze("deck/2/pfl", 1.0f);
    }
    an.setze("deck/2/komp/an", 1.0f);
    an.setze("deck/2/komp/schwelle", -20.0f);
    an.setze("deck/2/komp/ratio", 4.0f);
    std::vector<float> ca, cb;
    for (int k = 0; k < 400; ++k) {
      aus.block(1, 1.0f);
      an.block(1, 1.0f);
      if (k >= 380) {
        ca.insert(ca.end(), aus.cl, aus.cl + N);
        cb.insert(cb.end(), an.cl, an.cl + N);
      }
    }
    const double d = spitze_db(cb.data(), static_cast<int>(cb.size())) - spitze_db(ca.data(), static_cast<int>(ca.size()));
    PRUEF(spitze_db(ca.data(), static_cast<int>(ca.size())) > -60.0);   // Positivkontrolle: der Cue hört überhaupt
    PRUEF_NAH(d, -15.0, 0.3);
  }
  // (f) T9 (device faces): the input and output peak of the channel compressor, read and reset (komp_ein_db / komp_aus_db)
  {
    Lauf a;
    a.setze("deck/2/komp/an", 1.0f);
    a.setze("deck/2/komp/schwelle", -20.0f);
    a.setze("deck/2/komp/ratio", 4.0f);
    for (int k = 0; k < 400; ++k) {
      a.block(1, 1.0f);
      if (k < 399) { a.m->komp_ein_db(1); a.m->komp_aus_db(1); }   // reading in between resets: only the last block counts below
    }
    const float ein = a.m->komp_ein_db(1), aus = a.m->komp_aus_db(1);
    std::printf("(f) channel compressor deck/2: in %.3f dBFS, out %.3f dBFS\n", static_cast<double>(ein), static_cast<double>(aus));
    PRUEF_NAH(ein, 0.0, 0.2);
    PRUEF_NAH(ein - aus, 15.0, 0.3);   // the static reduction of (b)
    PRUEF(a.m->komp_ein_db(1) == -200.0f && a.m->komp_aus_db(1) == -200.0f);   // read and reset: nothing ran since, so the second reading is silence
    PRUEF(a.m->komp_ein_db(2) == -200.0f);   // pad/1 never ran a compressor: -200, no NaN or -inf
    PRUEF(a.m->komp_ein_db(-1) == -200.0f && a.m->komp_aus_db(99) == -200.0f);   // out of range: -200
    for (int k = 0; k < 40; ++k) { a.block(1, 0.0f); if (k < 39) { a.m->komp_ein_db(1); a.m->komp_aus_db(1); } }   // silence into the running compressor (its output may still carry the tail in the first blocks)
    PRUEF(a.m->komp_ein_db(1) == -200.0f && a.m->komp_aus_db(1) == -200.0f);
    a.setze("deck/2/komp/an", 0.0f);   // bypass: the stage no longer runs, so nothing is reported for it and no stale peak waits
    a.block(1, 1.0f);
    PRUEF(!a.m->komp_aktiv(1));
    PRUEF(a.m->komp_ein_db(1) == -200.0f && a.m->komp_aus_db(1) == -200.0f);
  }
  // (e) Sidechain: pad/1 hört mit komp/sc 2 auf den Eingang von deck/2 (Kick-Stöße, deck/2 zugezogen). Unter der Kick taucht
  // pad/1 ab, dazwischen nicht; mit komp/sc 0 (eigenes Signal, Dauerton unter der Schwelle) pumpt nichts.
  for (int sc : {2, 0}) {
    Lauf a;
    a.setze("deck/2/fader", -200.0f);
    a.setze("pad/1/komp/an", 1.0f);
    a.setze("pad/1/komp/schwelle", -30.0f);
    a.setze("pad/1/komp/ratio", 8.0f);
    a.setze("pad/1/komp/attack", 1.0f);
    a.setze("pad/1/komp/release", 150.0f);
    a.setze("pad/1/komp/sc", static_cast<float>(sc));
    std::vector<float> m;
    long t = 0;
    for (int k = 0; k < 400; ++k) {
      for (int i = 0; i < N; ++i, ++t) {
        const float kick = (t % 24000) < 2400 ? 0.9f * static_cast<float>(std::sin(2.0 * PI * 60.0 * t / 48000.0)) : 0.0f;
        const float ton = 0.05f * static_cast<float>(std::sin(2.0 * PI * 1000.0 * t / 48000.0));   // −26 dBFS: drückt sich mit eigenem Schlüssel gleichmäßig selbst
        a.m->eingang_l(1)[i] = a.m->eingang_r(1)[i] = kick;
        a.m->eingang_l(2)[i] = a.m->eingang_r(2)[i] = ton;
      }
      a.m->verarbeite(N, a.ml, a.mr, a.cl, a.cr);
      m.insert(m.end(), a.m->master_summe_l(), a.m->master_summe_l() + N);
    }
    // vierte Kick ab Sample 72000: kurz danach gegen kurz vor der nächsten
    const double unter = spitze_db(m.data() + 72000 + 960, 960), vor = spitze_db(m.data() + 72000 + 24000 - 1920, 960);
    std::printf("sc %d: unter der Kick %.2f dBFS, vor der nächsten %.2f dBFS\n", sc, unter, vor);
    if (sc == 2) {
      PRUEF(unter < vor - 6.0);
      // erholt: nach ~410 ms (2,7 Release-Zeitkonstanten) bleiben von ~20 dB rechnerisch ~1,3 dB
      PRUEF(vor > 20.0 * std::log10(0.05) - 2.0);
    } else {
      PRUEF_NAH(unter, vor, 0.2);   // Gegenprobe: ohne Schlüssel kein Pumpen
    }
  }
  PRUEF_ENDE();
}
