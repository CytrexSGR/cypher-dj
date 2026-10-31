// Paket 1.13 Warp, Slice 4 (Kern, AK8): BEATS im Callback. Einheit k beginnt auf ihrem Projekt-Sample und spielt die Quelle mit Faktor 1 ab ihrem Quell-Frame.
// Zwei Quellen zu 125 BPM (4 Beats = 92 160 Frames), Einheiten 1/16: Beat k/4, Frame k · 5760 (16 Einheiten). Projekttempo 100 (Platz 7200 Samples,
// Quelle 5760: Lücke 1440) und 150 (Platz 4800 < Quelle 5760: gekürzt).
//   Klick-Quelle:  auf jedem 1/16 ein Ein-Sample-Klick (Lage, D11).
//   Schlag-Quelle: auf jedem 1/16 ein Schlag mit Körper: Rauschen (fester Seed) · 0,8 · exp(−t/3 ms) + Sinus 180 Hz · 0,5 · exp(−t/40 ms), 5760 Frames lang;
//                  die zweite Hälfte hat Inhalt (Sinus-Körper), Lückenmodi und Hülle messen nicht in Stille (D11).
//   Sinus-Quelle:  Dauerton 1002,6 Hz, Spitze 0,5 (stationär: die Ableitung ist an jeder Stelle gleich, Fälle 6b, 9, 10).
// Fälle: 1 Einsatz ±1 · 2 Form (Korrelation) · 3 Lücke aus · 4 Lücke vor · 5 Lücke vor_zurueck · 6 Kürzen · 7 Hülle · 8 Transport-Start mitten in der Einheit ·
//        9 Tausch beim Spielen (AK11) · 10 Loop-Naht (AK11).
// Messwerte gehen als MESS-Zeilen nach stdout. Mutationen: ARR_BEATS_OHNE_KUERZBLENDE (Fall 6), ARR_BEATS_VARISPEED (Fall 1, 2), ARR_BEATS_LUECKE_SPIELT (Fall 3),
// ARR_BEATS_AUSKLANG_WARP (Fall 9).
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int64_t EINSATZ = V + 256;   // Start sofort bei Sample 0: Einsatz bei 793
static constexpr int64_t U = 5760;            // Quell-Frames je 1/16 der 125-BPM-Quellen
static constexpr int64_t N = 16 * U;          // 92 160 Frames, 4 Beats
static const double MITTE = 0.70710677;       // Pan Mitte (Gesetz −3 dB)
static const double PI = 3.14159265358979323846;

namespace {

std::unique_ptr<Audio> schlag_quelle() {
  auto x = std::make_unique<Audio>();
  x->d.assign(static_cast<size_t>(N) * 2, 0.0f);
  uint32_t seed = 12345u;
  for (int64_t k = 0; k < 16; ++k)
    for (int64_t j = 0; j < U; ++j) {
      seed = seed * 1664525u + 1013904223u;
      const double rausch = (static_cast<double>(seed >> 8) / 8388608.0) - 1.0;
      const double t = static_cast<double>(j) / 48000.0;
      const double v = rausch * 0.8 * std::exp(-t / 0.003) + std::sin(2.0 * PI * 180.0 * t) * 0.5 * std::exp(-t / 0.04);
      x->d[2 * static_cast<size_t>(k * U + j)] = x->d[2 * static_cast<size_t>(k * U + j) + 1] = static_cast<float>(v);
    }
  x->fuellen(N);
  return x;
}
std::unique_ptr<Audio> klick_quelle() { return Audio::klicks(N, U); }
std::unique_ptr<Audio> sinus_quelle() { return Audio::sinus(N, 1002.6, 0.5f); }

// Einsätze: Einheit k bei Beat k/4, Quell-Frame k · U
void einheiten(Bau& b, int loop, int huelle) {
  std::vector<double> eb, ef;
  for (int k = 0; k < 16; ++k) {
    eb.push_back(k * 0.25);
    ef.push_back(static_cast<double>(k * U));
  }
  b.warp({0.0, 4.0}, {0.0, static_cast<double>(N)}, 1).beats(eb, ef, loop, huelle);
}

struct Lauf {
  Treiber t;
  std::unique_ptr<Audio> q;
};

double spb(double bpm) { return 60.0 / bpm * 48000.0; }
int64_t soll(int k, double bpm) { return EINSATZ + std::llround(k * 0.25 * spb(bpm)); }

// Läuft eine Wiedergabe mit einem BEATS-Clip von Beat 0 an, bis zum Ende des Clips + Nachlauf
std::unique_ptr<Lauf> fahre(std::unique_ptr<Audio> q, double bpm, int loop, int huelle, int64_t extra = 2000) {
  auto l = std::make_unique<Lauf>();
  l->q = std::move(q);
  l->t.k.neu(bpm, 0);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l->q->a);
  einheiten(b, loop, huelle);
  l->t.laden(b.fertig());
  l->t.arr.start(0.0, 0, false, 0, V, 256, l->t.k);
  l->t.lauf(EINSATZ + std::llround(4 * spb(bpm)) + extra);
  return l;
}

int64_t spitze_bei(const std::vector<float>& l, int64_t mitte, int64_t radius) {
  int64_t best = mitte;
  for (int64_t i = std::max<int64_t>(0, mitte - radius); i <= mitte + radius && i < static_cast<int64_t>(l.size()); ++i)
    if (std::fabs(l[i]) > std::fabs(l[best])) best = i;
  return best;
}

// Pearson von a[a0 .. a0+n) (Ausgabe) und b[b0 .. b0+n) (Quelle, Kanal L); −2, wenn eine Seite keine Streuung hat
double pearson(const std::vector<float>& a, int64_t a0, const std::vector<float>& b, int64_t b0, int64_t n) {
  double ma = 0, mb = 0;
  for (int64_t i = 0; i < n; ++i) {
    ma += a[a0 + i];
    mb += b[b0 + i];
  }
  ma /= static_cast<double>(n);
  mb /= static_cast<double>(n);
  double sab = 0, saa = 0, sbb = 0;
  for (int64_t i = 0; i < n; ++i) {
    const double x = a[a0 + i] - ma, y = b[b0 + i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  if (saa < 1e-18 || sbb < 1e-18) return -2.0;
  return sab / std::sqrt(saa * sbb);
}

// Quelle Kanal L als Vektor
std::vector<float> kanal_l(const Audio& a) {
  std::vector<float> v(static_cast<size_t>(a.a.frames));
  for (int64_t i = 0; i < a.a.frames; ++i) v[i] = a.d[2 * static_cast<size_t>(i)];
  return v;
}

double groesste_diff(const std::vector<float>& x, int64_t von, int64_t bis, double skala = 1.0) {
  double g = 0.0;
  for (int64_t i = von + 1; i < bis; ++i) g = std::max(g, std::fabs(static_cast<double>(x[i]) - static_cast<double>(x[i - 1])) / skala);
  return g;
}

double rms(const std::vector<float>& x, int64_t von, int64_t bis) {
  double s = 0.0;
  for (int64_t i = von; i < bis; ++i) s += static_cast<double>(x[i]) * x[i];
  return std::sqrt(s / static_cast<double>(bis - von));
}

// Rampen-Quelle (Frame = Wert), Einheiten 1/16 mit Quell-Frame k · 5760. Das Tempo läuft von bpm0 auf bpm1 (rampe: dauer Beats ab ab_beat; ist dauer 0, ist bpm1 die Dauer in Beats
// einer Rampe 100 → 150 ab Beat 0). Gezählt werden Positionssprünge INNERHALB einer Einheit: zwei Samples bei Gain 1 (Wert ganzzahlig), deren Quellframes nicht um 1 wachsen und die
// nicht der Beginn einer Einheit sind. block: Teilblocklänge, pos: Sample, bei dem der Kern steht.
int positionssprung_zaehlen(double bpm0, double bpm1, double ab_beat, double dauer, int einheiten_zahl, int block, int64_t pos, const char* name) {
  const bool rampe_ab_null = dauer == 0.0 && ab_beat == 0.0;
  Treiber* tp = new Treiber();
  std::unique_ptr<Treiber> t(tp);
  auto q = std::make_unique<Audio>();
  const int64_t frames = einheiten_zahl * U;
  q->d.resize(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f) q->d[2 * f] = q->d[2 * f + 1] = static_cast<float>(f) + 0.3f;   // Bruchteil 0,3: nur ein Sample bei Gain 1 hat ihn (ein Fade-Wert trifft ihn selten)
  q->fuellen(frames);
  t->k.neu(bpm0, 0);
  if (rampe_ab_null) t->k.rampe(0.0, 150.0, bpm1); else t->k.rampe(ab_beat, bpm1, dauer);
  t->n = block;
  t->s = pos;
  const double beats = einheiten_zahl * 0.25;
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, beats, &q->a);
  std::vector<double> eb, ef;
  for (int k = 0; k < einheiten_zahl; ++k) {
    eb.push_back(k * 0.25);
    ef.push_back(static_cast<double>(k * U));
  }
  b.warp({0.0, beats}, {0.0, static_cast<double>(frames)}, 1).beats(eb, ef, 0, 100);
  t->laden(b.fertig());
  t->arr.start(0.0, 0, false, pos, V, block, t->k);
  t->lauf(pos + static_cast<int64_t>(std::ceil(beats * 48000.0 * 60.0 / 100.0)) + 4000);
  int sprung = 0, unit_start = 0, geprueft = 0;
  int64_t groesster_sprung = 0;
  const std::vector<float>& l = t->l;
  const auto gain1 = [&](size_t i) { const double v = l[i] / MITTE - 0.3; return v > 0.0 && std::fabs(v - std::round(v)) < 0.05; };
  const auto frame = [&](size_t i) { return std::llround(l[i] / MITTE - 0.3); };
  for (size_t i = 1; i + 1 < l.size(); ++i) {
    // drei Samples bei Gain 1 hintereinander, das dritte genau +1 hinter dem zweiten: dann ist das zweite gesichert Gain 1 und eine Lücke zum ersten ein echter Sprung
    if (gain1(i) && gain1(i + 1) && frame(i + 1) - frame(i) == 1 && frame(i) % U == 0) ++unit_start;   // Beginn einer Einheit (Frame k · 5760)
    if (!gain1(i - 1) || !gain1(i) || !gain1(i + 1) || frame(i + 1) - frame(i) != 1) continue;
    if (frame(i) % U == 0) continue;
    ++geprueft;
    if (frame(i) - frame(i - 1) != 1) {
      ++sprung;
      groesster_sprung = std::max<int64_t>(groesster_sprung, std::llabs(frame(i) - frame(i - 1) - 1));
      if (sprung <= 6 && std::getenv("W4_DBG")) std::printf("DBG %s i=%zu a=%lld c=%lld\n", name, i, (long long)frame(i - 1), (long long)frame(i));
    }
  }
  std::printf("MESS %s: %d Positionssprünge in %d geprüften Paaren (%d Einheitsbeginne), größter Sprung %lld Samples\n", name, sprung, geprueft, unit_start, (long long)groesster_sprung);
  if (geprueft < 1000 || unit_start < 10) {
    std::fprintf(stderr, "%s: zu wenig Messpunkte (%d, %d)\n", name, geprueft, unit_start);
    return 1000000;
  }
  return sprung;
}

}  // namespace

int main() {
  const double tempi[2] = {100.0, 150.0};
  {  // 1: Einsatz ±1 (Klick-Quelle), bei 100 und 150 BPM
    for (double bpm : tempi) {
      auto l = fahre(klick_quelle(), bpm, 0, 100);
      int64_t groesst = 0;
      int doppelt = 0;
      for (int k = 0; k < 16; ++k) {
        const int64_t s = soll(k, bpm);
        const int64_t ist = spitze_bei(l->t.l, s, 8);
        groesst = std::max<int64_t>(groesst, std::llabs(ist - s));
        if (std::fabs(l->t.l[ist] - MITTE) > 1e-3) {
          ++doppelt;
          std::fprintf(stderr, "Fall 1 (%g BPM) Einheit %d: Spitze %.4f statt %.4f\n", bpm, k, l->t.l[ist], MITTE);
        }
        int n = 0;   // der Klick klingt genau einmal in ±100 Samples
        for (int64_t i = s - 100; i <= s + 100; ++i) n += std::fabs(l->t.l[i]) > 1e-3 ? 1 : 0;
        if (n != 1) {
          ++doppelt;
          std::fprintf(stderr, "Fall 1 (%g BPM) Einheit %d: %d Treffer statt 1\n", bpm, k, n);
        }
      }
      std::printf("MESS Fall 1 bpm %g: größte Einsatzabweichung %lld Sample(s), Fehlstellen %d\n", bpm, (long long)groesst, doppelt);
      PRUEF(groesst <= 1);
      PRUEF(doppelt == 0);
    }
  }
  {  // 2: Form (Schlag-Quelle): die ersten 480 Samples ab dem Einsatz korrelieren ≥ 0,99 mit der Quelle (ganzzahlig gelesen, keine Einblende)
    auto q = schlag_quelle();
    const std::vector<float> src = kanal_l(*q);
    for (double bpm : tempi) {
      auto l = fahre(schlag_quelle(), bpm, 0, 100);
      double klein = 2.0;
      int64_t sh_max = 0;
      for (int k = 0; k < 16; ++k) {
        double best = -3.0;
        int64_t bsh = 0;
        for (int64_t sh = -1; sh <= 1; ++sh) {
          const double c = pearson(l->t.l, soll(k, bpm) + sh, src, k * U, 480);
          if (c > best) {
            best = c;
            bsh = sh;
          }
        }
        klein = std::min(klein, best);
        sh_max = std::max<int64_t>(sh_max, std::llabs(bsh));
        if (best < 0.99) std::fprintf(stderr, "Fall 2 (%g BPM) Einheit %d: Korrelation %.5f (Versatz %lld)\n", bpm, k, best, (long long)bsh);
      }
      std::printf("MESS Fall 2 bpm %g: kleinste Korrelation %.6f, größter Versatz der besten Ausrichtung %lld\n", bpm, klein, (long long)sh_max);
      PRUEF(klein >= 0.99);
      PRUEF(sh_max <= 1);
    }
  }
  {  // 3: Lücke aus (100 BPM): zwischen Quellende + 96 und Platzende ist die Ausgabe exakt 0; Positivkontrolle: davor klingt es
    auto l = fahre(schlag_quelle(), 100.0, 0, 100);
    int64_t nicht_null = 0, davor_stumm = 0;
    for (int k = 0; k < 16; ++k) {
      const int64_t s = soll(k, 100.0);
      for (int64_t i = s + U + 96; i < s + 7198; ++i) nicht_null += l->t.l[i] != 0.0f ? 1 : 0;
      davor_stumm += rms(l->t.l, s + 100, s + 3000) > 1e-3 ? 0 : 1;
    }
    std::printf("MESS Fall 3: Samples ≠ 0 in der Lücke %lld (soll 0), Einheiten ohne Klang davor %lld (soll 0)\n", (long long)nicht_null, (long long)davor_stumm);
    PRUEF(nicht_null == 0);
    PRUEF(davor_stumm == 0);
  }
  {  // 4: Lücke vor (100 BPM): die zweite Hälfte der Einheit läuft wiederholt; 200 Samples nach dem Umbruch + 96 gleich der Quelle (ab Frame U/2 + u)
    auto q = schlag_quelle();
    const std::vector<float> src = kanal_l(*q);
    auto l = fahre(schlag_quelle(), 100.0, 1, 100);
    double klein = 2.0;
    for (int k = 0; k < 16; ++k) {
      const int64_t s = soll(k, 100.0);
      PRUEF(rms(l->t.l, s + U + 96, s + 7198) > 1e-3);   // Positivkontrolle: die Lücke ist nicht leer
      double best = -3.0;
      for (int64_t sh = -1; sh <= 1; ++sh) best = std::max(best, pearson(l->t.l, s + sh + U + 96, src, k * U + U / 2 + 96, 200));
      klein = std::min(klein, best);
    }
    std::printf("MESS Fall 4: kleinste Korrelation der Lücke mit der zweiten Hälfte %.6f\n", klein);
    PRUEF(klein >= 0.99);
  }
  {  // 5: Lücke vor_zurueck (100 BPM): rückwärts, stetig
    auto q = schlag_quelle();
    const std::vector<float> src = kanal_l(*q);
    auto l = fahre(schlag_quelle(), 100.0, 2, 100);
    double klein = 2.0, ausgabe_diff = 0.0, quell_diff = 0.0;
    for (int k = 0; k < 16; ++k) quell_diff = std::max(quell_diff, groesste_diff(src, k * U + U / 2, (k + 1) * U));   // die zweite Hälfte, in der rückwärts gespielt wird
    for (int k = 0; k < 16; ++k) {
      const int64_t s = soll(k, 100.0);
      std::vector<float> rueck(1300);
      for (int u = 0; u < 1300; ++u) rueck[u] = src[k * U + std::min<int64_t>(U - u, U - 1)];
      double best = -3.0;
      for (int64_t sh = -1; sh <= 1; ++sh) best = std::max(best, pearson(l->t.l, s + sh + U, rueck, 0, 1300));
      klein = std::min(klein, best);
      ausgabe_diff = std::max(ausgabe_diff, groesste_diff(l->t.l, s + U - 100, s + U + 1300, MITTE));
    }
    std::printf("MESS Fall 5: kleinste Korrelation rückwärts %.6f, größte Differenz im Fenster %.6f (Quelle selbst %.6f)\n", klein, ausgabe_diff, quell_diff);
    PRUEF(klein >= 0.99);
    PRUEF(ausgabe_diff <= quell_diff + 1e-6);
  }
  {  // 6: Kürzen (150 BPM, Platz 4800 < Quelle 5760)
    // 6a (Plan): an jeder Einheitsgrenze ±200 Samples nicht steiler als der Referenzfall „Quelle mit linearer 96-Sample-Ausblende, dann die nächste Einheit“ · 1,05
    auto q = schlag_quelle();
    const std::vector<float> src = kanal_l(*q);
    auto l = fahre(schlag_quelle(), 150.0, 0, 100);
    double ours = 0.0, ref = 0.0;
    for (int k = 0; k < 15; ++k) {
      const int64_t s = soll(k + 1, 150.0);
      ours = std::max(ours, groesste_diff(l->t.l, s - 200, s + 200, MITTE));
      std::vector<float> r;
      for (int j = -200; j < 200; ++j) {
        if (j < 0) {
          const int64_t seit = 4800 + j;
          r.push_back(src[k * U + seit] * static_cast<float>(std::min(1.0, static_cast<double>(4800 - seit) / 96.0)));
        } else {
          r.push_back(src[(k + 1) * U + j]);
        }
      }
      ref = std::max(ref, groesste_diff(r, 0, static_cast<int64_t>(r.size())));
    }
    std::printf("MESS Fall 6a (Schlag, ±200 an der Grenze): größte Ableitung %.6f, Referenzfall %.6f\n", ours, ref);
    PRUEF(ours <= ref * 1.05 + 1e-6);
    // 6b: Dauerton (der Schnitt der Schlag-Quelle ist leise, 0,001: dort sieht 6a ihn nicht). Der Auslauf vor der nächsten Einheit = die Quelle · lineare Ausblende
    auto qs = sinus_quelle();
    const std::vector<float> ss = kanal_l(*qs);
    auto m = fahre(sinus_quelle(), 150.0, 0, 100);
    double ours_b = 0.0, ref_b = 0.0, abw = 0.0;
    for (int k = 0; k < 15; ++k) {
      const int64_t s = soll(k, 150.0);
      std::vector<float> r;
      for (int64_t seit = 4600; seit <= 4797; ++seit) {
        r.push_back(ss[k * U + seit] * static_cast<float>(std::min(1.0, static_cast<double>(4800 - seit) / 96.0)));
        abw = std::max(abw, std::fabs(m->t.l[s + seit] / MITTE - r.back()));
      }
      ref_b = std::max(ref_b, groesste_diff(r, 0, static_cast<int64_t>(r.size())));
      ours_b = std::max(ours_b, groesste_diff(m->t.l, s + 4600, s + 4798, MITTE));
    }
    std::printf("MESS Fall 6b (Dauerton, Auslauf): größte Ableitung %.6f, Referenzfall %.6f, größte Abweichung von Quelle·Ausblende %.6g\n", ours_b, ref_b, abw);
    PRUEF(ours_b <= ref_b * 1.05 + 1e-6);
    PRUEF(abw <= 1e-4);
  }
  {  // 7: Hülle 50 (100 BPM): die zweite Hälfte der Quelle ist deutlich leiser als bei Hülle 100
    auto voll = fahre(schlag_quelle(), 100.0, 0, 100);
    auto halb = fahre(schlag_quelle(), 100.0, 0, 50);
    double groesst = 0.0, kleinste_voll = 1e9;
    for (int k = 0; k < 15; ++k) {   // nicht die letzte Einheit: ihr Platz ist unbegrenzt (Plan T5, `platz = 1e18`), die Hülle wirkt dort nicht
      const int64_t s = soll(k, 100.0);
      const double rv = rms(voll->t.l, s + U / 2, s + U), rh = rms(halb->t.l, s + U / 2, s + U);
      kleinste_voll = std::min(kleinste_voll, rv);
      groesst = std::max(groesst, rh / rv);
    }
    std::printf("MESS Fall 7: größtes RMS-Verhältnis Hülle 50 / Hülle 100 in der zweiten Hälfte %.4f (RMS bei 100 mindestens %.5f)\n", groesst, kleinste_voll);
    PRUEF(kleinste_voll > 1e-3);
    PRUEF(groesst < 0.6);
  }
  {  // 8: Transport-Start mitten in Einheit 5 (Beat 1,35) gleicht dem durchlaufenden Fall am selben Projekt-Sample (Lücke vor, damit die Lücke mitgemessen wird)
    auto a = fahre(schlag_quelle(), 100.0, 1, 100);
    Lauf b;
    b.q = schlag_quelle();
    b.t.k.neu(100.0, 0);
    Bau bau;
    bau.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &b.q->a);
    einheiten(bau, 1, 100);
    b.t.laden(bau.fertig());
    b.t.arr.start(1.35, 0, false, 0, V, 256, b.t.k);
    b.t.lauf(EINSATZ + 20000);
    const int64_t versatz = std::llround(1.35 * spb(100.0));   // Sample des Starts im durchlaufenden Fall
    double groesst = 0.0, summe = 0.0;
    for (int64_t j = 40; j < 14000; ++j) {
      groesst = std::max(groesst, std::fabs(static_cast<double>(b.t.l[EINSATZ + j]) - static_cast<double>(a->t.l[EINSATZ + versatz + j])));
      summe += std::fabs(b.t.l[EINSATZ + j]);
    }
    std::printf("MESS Fall 8: größte Abweichung Start mitten in Einheit 5 gegen durchlaufend %.3g (Summe |l| %.1f)\n", groesst, summe);
    PRUEF(summe > 100.0);
    PRUEF(groesst <= 1e-5);
  }
  {  // 9: Tausch beim Spielen (AK11, BEATS-Teil): nur die Hülle ändert sich. Dauerton; Referenzfall: dieselbe Stelle als Stopp (die 96-Sample-Ausblende des Kerns)
    const int64_t bis = EINSATZ + std::llround(5 * 0.25 * spb(100.0)) + 2000;
    auto stimme = [&](bool tausch, bool stopp) {
      auto l = std::make_unique<Lauf>();
      l->q = sinus_quelle();
      l->t.k.neu(100.0, 0);
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l->q->a);
      einheiten(b, 0, 100);
      l->t.laden(b.fertig());
      l->t.arr.start(0.0, 0, false, 0, V, 256, l->t.k);
      l->t.lauf(bis);
      if (tausch) {
        Bau c(2);
        c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l->q->a);
        einheiten(c, 0, 99);
        l->t.laden(c.fertig());
      }
      if (stopp) l->t.arr.stopp(0, l->t.s, l->t.k);
      l->t.lauf(bis + 1200);
      return l;
    };
    auto t = stimme(true, false), u = stimme(false, true), o = stimme(false, false);
    const int64_t s = bis;   // t.s nach dem ersten Lauf ist ein Vielfaches des Blocks ≥ bis; die Fenster decken ihn mit
    const int64_t s0 = ((bis + 255) / 256) * 256;
    (void)s;
    const double d_tausch = groesste_diff(t->t.l, s0 - 3, s0 + 300, MITTE);
    const double d_stopp = groesste_diff(u->t.l, s0 - 3, s0 + 300, MITTE);
    const double d_ohne = groesste_diff(o->t.l, s0 - 3, s0 + 300, MITTE);
    std::printf("MESS Fall 9: größte Ableitung Tausch %.6f, Stopp-Referenz (2 ms) %.6f, ohne Eingriff %.6f\n", d_tausch, d_stopp, d_ohne);
    PRUEF(rms(o->t.l, s0, s0 + 300) > 0.05);   // Positivkontrolle: im Fenster klingt der Dauerton
    PRUEF(d_tausch <= d_stopp * 1.5 + 1e-5);   // alt blendet über 96 Samples aus, neu über 32 ein: zwei kohärente Kopien überlappen, gemessen 1,47 · Stopp-Fall
    // danach liegen die Einsätze weiter ±1 (Klick-Quelle, Tausch mitten in Einheit 5)
    auto k1 = std::make_unique<Lauf>();
    k1->q = klick_quelle();
    k1->t.k.neu(100.0, 0);
    Bau b1;
    b1.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &k1->q->a);
    einheiten(b1, 0, 100);
    k1->t.laden(b1.fertig());
    k1->t.arr.start(0.0, 0, false, 0, V, 256, k1->t.k);
    k1->t.lauf(bis);
    Bau b2(2);
    b2.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &k1->q->a);
    einheiten(b2, 0, 99);
    k1->t.laden(b2.fertig());
    k1->t.lauf(EINSATZ + 4 * 28800 + 2000);
    int64_t groesst = 0;
    for (int k = 6; k < 16; ++k) groesst = std::max<int64_t>(groesst, std::llabs(spitze_bei(k1->t.l, soll(k, 100.0), 8) - soll(k, 100.0)));
    std::printf("MESS Fall 9: größte Einsatzabweichung nach dem Tausch %lld\n", (long long)groesst);
    PRUEF(groesst <= 1);
    PRUEF(std::fabs(k1->t.l[soll(7, 100.0)] - MITTE) < 1e-3);
  }
  {  // 10: Loop-Naht (AK11, BEATS-Teil): Loop-Clip über 2 Kopien
    auto k2 = std::make_unique<Lauf>();
    k2->q = klick_quelle();
    k2->t.k.neu(100.0, 0);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &k2->q->a);
    einheiten(b, 1, 100);
    k2->t.laden(b.fertig());
    k2->t.arr.loop(true, 0.0, 4.0, k2->t.s, k2->t.k);
    k2->t.arr.start(0.0, 2, false, 0, V, 256, k2->t.k);
    k2->t.lauf(500000);
    const auto erste = k2->t.treffer(0, 500000, 1e-3f);
    PRUEF(!erste.empty());
    const int64_t e0 = erste.empty() ? 0 : erste[0];
    const int64_t naht = e0 + 115200;
    int64_t groesst = 0;
    for (int kopie = 0; kopie < 2; ++kopie)
      for (int k = 0; k < 16; ++k) {
        const int64_t s = e0 + kopie * 115200 + std::llround(k * 0.25 * spb(100.0));
        groesst = std::max<int64_t>(groesst, std::llabs(spitze_bei(k2->t.l, s, 8) - s));
        if (std::fabs(k2->t.l[spitze_bei(k2->t.l, s, 8)] - MITTE) >= 1e-3) {
          std::fprintf(stderr, "Fall 10 Kopie %d Einheit %d: Spitze %.4f bei %lld (soll %lld)\n", kopie, k, k2->t.l[spitze_bei(k2->t.l, s, 8)], (long long)spitze_bei(k2->t.l, s, 8), (long long)s);
          PRUEF(false);
        }
      }
    std::printf("MESS Fall 10: Einsatz der ersten Kopie bei %lld, größte Einsatzabweichung beider Kopien %lld\n", (long long)e0, (long long)groesst);
    PRUEF(groesst <= 1);
    // an der Naht keine Ableitung über dem 2-ms-Fall: Dauerton, Lücke vor (die letzte Einheit klingt bis zur Naht), Referenz: Spitze · Steigung + Spitze / 96
    auto sn = std::make_unique<Lauf>();
    sn->q = sinus_quelle();
    sn->t.k.neu(100.0, 0);
    Bau c;
    c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &sn->q->a);
    einheiten(c, 1, 100);
    sn->t.laden(c.fertig());
    sn->t.arr.loop(true, 0.0, 4.0, sn->t.s, sn->t.k);
    sn->t.arr.start(0.0, 2, false, 0, V, 256, sn->t.k);
    sn->t.lauf(500000);
    const auto ersteS = sn->t.treffer(0, 500000, 1e-3f);
    const int64_t n0 = ersteS.empty() ? 0 : ersteS[0];
    const double ref = (0.5 * 2.0 * PI * 1002.6 / 48000.0) + 0.5 / 96.0;
    const double d_naht = groesste_diff(sn->t.l, n0 + 115200 - 100, n0 + 115200 - 1, MITTE);
    std::printf("MESS Fall 10: größte Ableitung in den 96 Samples vor der Naht %.6f, 2-ms-Referenz (Steigung + Spitze/96) %.6f\n", d_naht, ref);
    PRUEF(rms(sn->t.l, n0 + 115200 - 100, n0 + 115200 - 1) > 0.01);   // Positivkontrolle: dort klingt etwas
    PRUEF(d_naht <= ref * 1.05);
    PRUEF(naht > 0);
  }
  // ---- Fälle 11 bis 14 (Nachzug zur Prüfung): die Einheit rechnet ihre Samples aus der Karte des Kerns, nicht aus einem Blockmittel
  {  // 11: Tempo-Rampe 100 → 150 über 8 Beats: innerhalb jeder Einheit läuft die Quellposition je Sample genau +1 (Rampen-Quelle: Frame = Wert)
    const int s = positionssprung_zaehlen(100.0, 8.0, 0.0, 0.0, 32, 256, 0, "Fall 11 (Rampe 100→150)");
    PRUEF(s == 0);
  }
  {  // 12: Tempo-Stufe mitten in Einheit 4 (Beat 1,125, in 0,01 Beat von 100 auf 150): kein Rücksprung der Quelle
    const int s = positionssprung_zaehlen(100.0, 150.0, 1.125, 0.01, 32, 256, 0, "Fall 12 (Stufe mitten in Einheit 4)");
    PRUEF(s == 0);
  }
  {  // 13: krummes Tempo 133,7 BPM: Einsatz ±1 (Klick-Quelle)
    auto l = fahre(klick_quelle(), 133.7, 0, 100);
    int64_t groesst = 0;
    for (int k = 0; k < 16; ++k) {
      const int64_t sl = soll(k, 133.7);
      groesst = std::max<int64_t>(groesst, std::llabs(spitze_bei(l->t.l, sl, 8) - sl));
      PRUEF(std::fabs(l->t.l[spitze_bei(l->t.l, sl, 8)] - MITTE) < 1e-3);
    }
    std::printf("MESS Fall 13: 133,7 BPM, größte Einsatzabweichung %lld\n", (long long)groesst);
    PRUEF(groesst <= 1);
  }
  {  // 14: große Position: der Kern steht bei Sample 1e8, Teilblöcke der Länge 1; Einsatz ±1 und keine Positionssprünge in der Rampen-Quelle (Rampe 100 → 150 über 8 Beats)
    const int s = positionssprung_zaehlen(100.0, 8.0, 0.0, 0.0, 32, 1, 100000000LL, "Fall 14 (Position 1e8, Blöcke 1)");
    PRUEF(s == 0);
    for (int64_t pos : {100000000LL, 100000000LL + 12345}) {
      Lauf l;
      l.q = klick_quelle();
      l.t.k.neu(100.0, 0);
      l.t.n = 1;
      l.t.s = pos;
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l.q->a);
      einheiten(b, 0, 100);
      l.t.laden(b.fertig());
      l.t.arr.start(0.0, 0, false, pos, V, 1, l.t.k);
      l.t.lauf(pos + 4 * 28800 + 3000);
      const auto erste = l.t.treffer(0, static_cast<int64_t>(l.t.l.size()), 1e-3f);
      PRUEF(!erste.empty());
      const int64_t e0 = erste.empty() ? 0 : erste[0];
      int64_t groesst = 0;
      for (int k = 0; k < 16; ++k) {
        const int64_t sl = e0 + k * 7200;
        groesst = std::max<int64_t>(groesst, std::llabs(spitze_bei(l.t.l, sl, 8) - sl));
      }
      std::printf("MESS Fall 14: Kern bei Sample %lld, Blöcke 1: Einsatz der ersten Einheit %lld nach dem Start, größte Einsatzabweichung %lld\n", (long long)pos, (long long)e0, (long long)groesst);
      PRUEF(groesst <= 1);
    }
  }
  {  // 15: die Blockgröße ist kein Parameter des Klangs, auch nicht in einer Tempo-Rampe (100 → 150 über 8 Beats, Lücke vor): Blöcke 1, 97, 256 gleich. Der Render kennt nur ein festes
     // Tempo (RenderAuftrag.bpm), der Vergleich Live gegen Render mit Rampe ist darum nicht möglich; die Blockunabhängigkeit ist, was beide gleich macht.
    std::vector<std::vector<float>> aus;
    for (int n : {1, 97, 256}) {
      Treiber t;
      auto q = schlag_quelle();
      t.k.neu(100.0, 0);
      t.k.rampe(0.0, 150.0, 8.0);
      t.n = n;
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a);
      einheiten(b, 1, 70);
      t.laden(b.fertig());
      t.arr.start(0.0, 0, false, 0, EINSATZ - n, n, t.k);   // Vorhalt so gewählt, dass der Einsatz bei jeder Blockgröße auf Sample 793 liegt (die Rampe hängt am Kern-Sample)
      t.lauf(EINSATZ + 4 * 24000 + 3000);
      aus.emplace_back(t.l.begin() + EINSATZ, t.l.begin() + EINSATZ + 4 * 24000);
    }
    double groesst = 0.0, summe = 0.0;
    for (size_t i = 0; i < aus[0].size(); ++i) {
      for (int k = 1; k < 3; ++k) groesst = std::max(groesst, std::fabs(static_cast<double>(aus[0][i]) - static_cast<double>(aus[k][i])));
      summe += std::fabs(aus[0][i]);
    }
    std::printf("MESS Fall 15: Rampe, größte Abweichung Blöcke 1/97/256 %.3g (Summe |l| %.1f)\n", groesst, summe);
    PRUEF(summe > 1000.0);
    PRUEF(groesst == 0.0);
  }
  {  // 16: warp_gleich vergleicht alle BEATS-Felder. Ein Tausch, der nur loop / nur huelle / nur einen Einheits-Frame / nur einen Einheits-Beat ändert (nicht die gerade klingende Einheit),
     // muss überblenden: alte Stimme 96 Samples aus, neue 32 ein, im Dauerton wächst die Summe über die Ausgabe ohne Tausch hinaus. Bindet die Stimme ohne Überblendung neu, ist die Ausgabe gleich.
    const int64_t bis = EINSATZ + std::llround(5 * 0.25 * spb(100.0)) + 2000;
    const int64_t s0 = ((bis + 255) / 256) * 256;
    auto stimme = [&](int variante) {   // 0 kein Tausch, 1 loop, 2 huelle, 3 Frame, 4 Beat, 5 eine Einheit weniger
      auto l = std::make_unique<Lauf>();
      l->q = sinus_quelle();
      l->t.k.neu(100.0, 0);
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l->q->a);
      einheiten(b, 0, 100);
      l->t.laden(b.fertig());
      l->t.arr.start(0.0, 0, false, 0, V, 256, l->t.k);
      l->t.lauf(bis);
      if (variante != 0) {
        Bau c(2);
        c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &l->q->a);
        std::vector<double> eb, ef;
        for (int k = 0; k < (variante == 5 ? 15 : 16); ++k) {
          eb.push_back(k * 0.25 + (variante == 4 && k == 12 ? 0.01 : 0.0));
          ef.push_back(static_cast<double>(k * U + (variante == 3 && k == 10 ? 1 : 0)));
        }
        c.warp({0.0, 4.0}, {0.0, static_cast<double>(N)}, 1).beats(eb, ef, variante == 1 ? 1 : 0, variante == 2 ? 99 : 100);
        l->t.laden(c.fertig());
      }
      l->t.lauf(bis + 600);
      return l;
    };
    auto ohne = stimme(0);
    double ueber[6] = {};
    for (int v = 1; v <= 5; ++v) {
      auto m = stimme(v);
      for (int64_t i = s0; i < s0 + 200; ++i) ueber[v] = std::max(ueber[v], std::fabs(static_cast<double>(m->t.l[i]) - static_cast<double>(ohne->t.l[i])));
    }
    std::printf("MESS Fall 16: größte Abweichung des Tauschs gegen keinen Tausch (Überblendung): loop %.4f, huelle %.4f, Einheits-Frame %.4f, Einheits-Beat %.4f, Einheitenzahl %.4f (huelle sieht Fall 9: dort wirkt die Hülle auf den Pegel auch ohne Überblendung)\n", ueber[1], ueber[2], ueber[3], ueber[4], ueber[5]);
    for (int v = 1; v <= 5; ++v) PRUEF(ueber[v] > 0.05);
  }
  PRUEF_ENDE();
}
