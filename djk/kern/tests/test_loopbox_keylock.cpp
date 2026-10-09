// Keylock in Echtzeit, Task 7 (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md, Detailschnitt 7a): die Loop-Box
// als Quelle des Dehners. Dehner synchron (wie test_dehner / test_deck_keylock): der Test spielt den Callback
// (LoopBoxen::block je 256er-Block), danach den Vorbereiter (StreckPost::takt) und den Arbeits-Thread (fuelle_synchron).
// Messgrößen: keylock_mess.h. Grenzen: Abschnitt 6 des Detailschnitts.
//
// Aufruf ohne Argument: alle Tests; mit Namen nur einer (z. B. `test_loopbox_keylock lebensdauer` für den TSan-Bau).
// `test_loopbox_keylock einmessen`: Abschnitt 0 (Step 2, druckt nur).
//   Abschnitt 0  einmessen     Klick-Loop über BoxBand, Dehner synchron: Lage Mittel, Streuung, max gegen rohes R3 bei 60 bis
//                              200 BPM, Versatz 0 und 5000 (Gate G2: Mittel ±3, je Klick ±12 gegen rohes R3)
//   L1 leser_ansetzen_ab       fernes s_h: der Ring bleibt liegen, kein Rechenaufwand vor dem Vorlauf (kosten_render().n)
//   L2 leser_aus_stille        erstes gewolltes Sample bei bereitem Ring klingt ohne Blende
//   L3 leser_leistung          Einfrieren mit gleich lauter Blende (cos/sin), Vorgabe linear unverändert
//   L4 leser_ring_lesen        ring_lesen liefert genau die Ring-Frames ab si (wie der nächste Block)
//   T1 basis_bitgleich  T2 tonhoehe_fest  T3 naht_wickeln  T4 einsatz_aus_stille  T5 lage  T6 laden_klingend
//   T7 set_neu_schwanz  T8 aus_ist_varispeed  T9 lebensdauer  T10 rampe_tonhoehe  T11 allokation  T12 unterlauf
//   T13 zwei_boxen  T14 leihe_voll  T15 laden_leihe  T16 einfrieren_in_bruecke  T17 dehner_spaet
//   T18 ereignis_in_vorlage (7c.2)  T14b raster_wartend (7c.3)  T19 basis_knopf_blende (7c.4)
//   T20 band_scan (Keylock 6a Fix-Runde 2: Start aus Stille nur mit voller Vorlage, wie das Deck)
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include <chrono>
#include <random>
#include <thread>

#include "keylock_mess.h"
#include "sprungmass.h"
#include "cypherdj/blende.h"
#include "cypherdj/dehner.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/streck_quelle.h"
#include "pruef.h"
// zuletzt: Rubber Band bindet mm_malloc.h (posix_memalign ohne noexcept), der Abfang definiert es danach
#include "alloc_abfang.h"

namespace {

using cdj::DehnerAnker;
using cdj::Karte;
using km::B;
using km::FPB;
using km::PI;

int test_fehler_vorher = 0;
void ergebnis(const char* name) {
  std::printf("TEST %s: %s\n", name, pruef_fehler == test_fehler_vorher ? "gruen" : "ROT");
  std::fflush(stdout);
  test_fehler_vorher = pruef_fehler;
}

// ------------------------------------------------------------------------------------------ Loops
// Klick-Loop: beats Beats, Klick (keylock_mess.h Vorlage, 144 Samples) am Anfang jedes Beats.
std::unique_ptr<cdj::Loop> klick_loop(int beats, const char* name = "klick") {
  auto l = std::make_unique<cdj::Loop>();
  l->name = name;
  l->beats = beats;
  l->frames = beats * cdj::LOOP_SPB;
  l->daten.assign((size_t)(2 * l->frames), 0.0f);
  const std::vector<float> tpl = km::klick_vorlage();
  for (int b = 0; b < beats; ++b)
    for (int i = 0; i < 144; ++i) {
      const size_t f = (size_t)(b * cdj::LOOP_SPB + i);
      l->daten[2 * f] = l->daten[2 * f + 1] = tpl[(size_t)i];
    }
  return l;
}

// Sinus-Loop mit ganzen Perioden: 416 Hz über einen Beat (22 500 Frames) sind 195 Perioden, 832 Hz 390.
std::unique_ptr<cdj::Loop> sinus_loop(int beats, double hz, const char* name = "sinus", float amp = 0.5f) {
  auto l = std::make_unique<cdj::Loop>();
  l->name = name;
  l->beats = beats;
  l->frames = beats * cdj::LOOP_SPB;
  l->daten.assign((size_t)(2 * l->frames), 0.0f);
  for (int64_t f = 0; f < l->frames; ++f)
    l->daten[(size_t)(2 * f)] = l->daten[(size_t)(2 * f + 1)] = (float)(amp * std::sin(2 * PI * hz * (double)f / 48000.0));
  return l;
}

// ------------------------------------------------------------------------------------------ Dehner allein (Abschnitt 0)
// Spielt den Callback wie test_dehner Lauf: Ausgabe je Kern-Sample, Faktorfolge je 43er-Fenster ab s_h.
struct DLauf {
  std::unique_ptr<cdj::DehnerBasis> d;
  std::vector<float> L;
  int64_t s_h = 0;
  int unterlauf = 0;
  std::vector<double> f;
  DLauf(const cdj::DehnerOptionen& o, int64_t laenge) : d(cdj::dehner_neu(1, o)), L((size_t)laenge, 0.0f) {}
  void block(int64_t b, const Karte& k) {
    cdj::KartenStand st;
    st.karte = k;
    st.generation = 1;
    st.s_jetzt = b;
    d->karte_veroeffentlichen(st);
    d->fuelle_synchron();
    const int64_t gb = d->geschrieben_bis();
    if (gb > s_h) {
      const size_t w = (size_t)((gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, d->faktor_gesetzt());
      f[w] = d->faktor_gesetzt();
    }
    cdj::StreckRing& r = d->ring();
    r.setze_epoche(d->epoche());
    float l[B], rr[B];
    const int64_t ab = r.bereit_ab(b);
    if (ab < 0 || ab >= b + B) {
      if (b + B > s_h) ++unterlauf;
      return;
    }
    const int n = (int)(b + B - ab);
    if (!r.lies(ab, n, l, rr)) {
      ++unterlauf;
      return;
    }
    for (int i = 0; i < n; ++i)
      if (ab + i < (int64_t)L.size()) L[(size_t)(ab + i)] = l[i];
  }
};

// Lage am Klick-Loop über BoxBand bei konstantem Tempo bpm und Versatz v: Ansatz bei Beat 4 (s_h), Klicks der Beats
// 6 bis 6 + n (Anker box_anker, Soll aus der Karte), (a) Mittel und Streuung gegen das Soll, (b) max gegen rohes R3.
struct Einmessung {
  km::Lage lage;
  double streuung = 0, min = 0, max = 0;
  int unterlauf = 0;
};
Einmessung einmessen(double bpm, int64_t versatz, int n = 64, bool versatz_anwenden = true) {
  static const std::unique_ptr<cdj::Loop> lp = klick_loop(4);
  cdj::BoxBand band;
  band.loop = lp.get();
  const Karte k(bpm, 0);
  const int64_t s_h = (int64_t)std::llround(k.sample_at(4.0));
  const DehnerAnker a = cdj::box_anker(k, s_h, lp->beats, lp->frames, versatz);
  cdj::DehnerOptionen o;
  o.versatz_anwenden = versatz_anwenden;
  DLauf l(o, (int64_t)k.sample_at(a.b + 6.0 + n + 4.0));
  l.s_h = s_h;
  cdj::AnsatzAuftrag x;
  x.quelle = &band;
  x.s_h = s_h;
  x.anker = a;
  x.karte = k;
  x.generation = 1;
  l.d->ansetzen(x);
  for (int64_t b = 0; b + B <= (int64_t)l.L.size(); b += B) l.block(b, k);
  Einmessung m;
  m.unterlauf = l.unterlauf;
  const int q0 = (int)std::ceil(6.0 - a.b) + 1;  // Klick q liegt bei Beat a.b + q − v/FPB (keylock_mess.h klick_lage)
  const int64_t p0 = km::band_start(k, a, s_h, l.f.at(0));
  m.lage = km::lage_messen(l.L, band, k, a, p0, l.f, s_h, q0, q0 + n, std::getenv("BOX_JE_KLICK") != nullptr);
  static const std::vector<float> tpl = km::klick_vorlage();
  double s2 = 0;
  m.min = 1e9;
  m.max = -1e9;
  int z = 0;
  for (int q = q0; q < q0 + n; ++q) {
    double e;
    if (!km::klick_lage(l.L, k, a, q, e, tpl, km::MITTE)) continue;
    s2 += (e - m.lage.mittel) * (e - m.lage.mittel);
    m.min = std::min(m.min, e);
    m.max = std::max(m.max, e);
    ++z;
  }
  m.streuung = z > 1 ? std::sqrt(s2 / (z - 1)) : NAN;
  return m;
}

// Gate G2, Verfahren dehner.h:34-46: Rohwerte (ohne Korrektur) bzw. Reste (mit Korrektur) an frei gewählten Tempi, Versatz 0.
// Aufruf: test_loopbox_keylock einmessen_roh 60,65,70 | einmessen_rest 60,65,70
void abschnitt0_punkte(const char* liste, bool roh) {
  for (const char* p = liste; *p;) {
    const double bpm = std::atof(p);
    const Einmessung m = einmessen(bpm, 0, 64, !roh);
    std::printf("  %s bpm %6.1f faktor %.6f: Mittel %+8.3f (Streuung %.2f, max roh %.2f, Klicks %d)\n", roh ? "roh " : "rest", bpm,
                bpm / 128.0, m.lage.mittel, m.streuung, m.lage.max_roh, m.lage.n);
    while (*p && *p != ',') ++p;
    if (*p) ++p;
  }
}

void abschnitt0_einmessen() {
  std::printf("ABSCHNITT 0: Klick-Loop (4 Beats) über BoxBand, Dehner synchron, 64 Klicks je Tempo; Gate G2: Mittel ±3, "
              "je Klick ±12 gegen rohes R3\n");
  int aus = 0;
  for (int64_t v : {(int64_t)0, (int64_t)5000})
    for (double bpm : {60.0, 75.0, 90.0, 96.0, 100.0, 110.0, 130.0, 135.0, 150.0, 170.0, 173.0, 180.0, 190.0, 200.0}) {
      const Einmessung m = einmessen(bpm, v);
      const bool g2 = m.lage.n == 64 && std::fabs(m.lage.mittel) <= 3.0 && m.lage.max_roh <= 12.0;
      aus += g2 ? 0 : 1;
      std::printf("  versatz %4lld bpm %6.1f: Klicks %2d, (a) Mittel %+7.2f, Streuung %6.2f, min %+7.2f, max %+7.2f, "
                  "(b) max |Box − rohes R3| %6.2f, Unterlauf %d  %s\n",
                  (long long)v, bpm, m.lage.n, m.lage.mittel, m.streuung, m.min, m.max, m.lage.max_roh, m.unterlauf,
                  g2 ? "G2 ok" : "G2 AUSSERHALB");
    }
  std::printf("ABSCHNITT 0: %d von 28 Punkten außerhalb G2\n", aus);
}


// ------------------------------------------------------------------------------------------ Leser allein (L1 bis L4)
// Ein Leser an einem Dehner mit Sinus-Loop über BoxBand, synchron gefahren; mischt in einen eigenen Strom.
struct LLauf {
  Karte k;
  uint32_t gen = 1;
  std::unique_ptr<cdj::DehnerBasis> d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::StreckLeser les;
  std::vector<float> L;
  int64_t s = 0;
  explicit LLauf(double bpm, int64_t laenge) : k(bpm, 0), L((size_t)laenge, 0.0f) { les.verbinde(d.get(), &post, &k, &gen); }
  // n Samples: block_anfang, mische (will, Varispeed-Weg = vari), dann Vorbereiter und Arbeits-Thread
  void teil(int n, bool will, float vari = 0.0f) {
    les.block_anfang(s, n);
    for (int i = 0; i < n; ++i) {
      float a = vari, b = vari;
      les.mische(i, s + i, will, 1.0f, false, 1.0f, false, a, b);
      if (s + i < (int64_t)L.size()) L[(size_t)(s + i)] = a;
    }
    s += n;
    post.takt(*d);
    d->fuelle_synchron();
  }
};

void test_leser_ansetzen_ab() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  cdj::BoxBand band;
  band.loop = lp.get();
  LLauf l(135.0, 0);
  const int64_t s_h = 40 * B;  // rund 213 ms nach dem Ansatz
  l.les.ansetzen_ab(0, s_h, &band, cdj::box_anker(l.k, 0, 1, lp->frames, 0));
  uint64_t n_vor = 0;
  int64_t voll_vor = 0;
  while (l.s < s_h - 8 * B) {
    l.teil(B, false);
    n_vor = l.d->kosten_render().n;
    voll_vor = (int64_t)l.d->ring().frames_belegt();
  }
  const uint64_t n_davor = n_vor;
  for (int j = 0; j < 4; ++j) l.teil(B, false);  // noch vor s_h − Vorlauf: kein Abschnitt mehr
  const uint64_t n_danach = l.d->kosten_render().n;
  while (l.s < s_h + 16 * B) l.teil(B, false);
  const uint64_t n_ende = l.d->kosten_render().n;
  std::printf("  L1: s_h %lld, gerechnete Abschnitte bis s_h − 8 Blöcke %llu, 4 Blöcke später %llu, bis s_h + 16 Blöcke %llu; "
              "Ring belegt vor s_h %lld Frames, s_h des Lesers %lld\n",
              (long long)s_h, (unsigned long long)n_davor, (unsigned long long)n_danach, (unsigned long long)n_ende,
              (long long)voll_vor, (long long)l.les.s_h());
  PRUEF(l.les.s_h() == s_h);
  PRUEF(n_danach == n_davor);   // fernes s_h: der Ring ist voll, der Füll-Faden rechnet nichts mehr
  PRUEF(voll_vor <= cdj::DEHNER_VORLAUF_FRAMES + cdj::DEHNER_BLOCK);
  PRUEF(n_ende > n_danach);     // danach rechnet er wieder (Positiv-Kontrolle)
  ergebnis("leser_ansetzen_ab");
}

void test_leser_aus_stille() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  cdj::BoxBand band;
  band.loop = lp.get();
  for (int art = 0; art < 2; ++art) {  // 0 mit aus_stille, 1 ohne (Bezug: Blende aus der Brücke)
    LLauf l(135.0, 60 * B);
    // Einsatz auf einer Blockgrenze nach dem Einschwingen (der Test gibt den Wunsch blockweise)
    const int64_t s_h = 20 * B, e = (s_h + cdj::STRECK_EINSCHWING) / B * B + 2 * B;
    l.les.ansetzen_ab(0, s_h, &band, cdj::box_anker(l.k, 0, 1, lp->frames, 0));
    if (art == 0) l.les.aus_stille();
    while (l.s < e) l.teil(B, false, 0.25f);
    l.teil(B, true, 0.25f);  // ab e gewollt: Ring (art 0) oder Blende 0,25 -> Ring (art 1)
    const bool hoer = l.les.ring_hoerbar(), blend = l.les.blendet();
    // Positiv: im ersten Sample nach e klingt bei art 0 der Ring, kein Anteil des Varispeed-Wegs (0,25) darin
    const float x0 = l.L[(size_t)e];
    std::printf("  L2 %s: erstes Sample %.5f, Ring hörbar %d, Blende läuft %d\n", art ? "ohne" : "mit", x0, (int)hoer,
                (int)blend);
    if (art == 0) PRUEF(hoer && !blend && std::fabs(x0 - 0.25f) > 0.01f);
    else PRUEF(!hoer && blend);
  }
  ergebnis("leser_aus_stille");
}

void test_leser_leistung() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  cdj::BoxBand band;
  band.loop = lp.get();
  double mitte[2];
  for (int art = 0; art < 2; ++art) {  // 0 linear (Vorgabe), 1 gleich laut
    LLauf l(135.0, 80 * B);
    l.les.ansetzen(0, &band, cdj::box_anker(l.k, 0, 1, lp->frames, 0));
    while (l.s < 40 * B) l.teil(B, true, 0.0f);
    PRUEF(l.les.ring_hoerbar());
    const int64_t s = l.s;
    l.les.block_anfang(s, B);
    PRUEF(l.les.einfrieren(s, 1.0f, 1.0f, nullptr, nullptr, 0, art == 1));
    // Blende ALT -> VARI mit VARI = 0: das Gewicht des Alten ist der Faktor auf dem eingefrorenen Ring bei j = 480
    float a = 0, b = 0;
    double r = 0;
    for (int i = 0; i < B; ++i) {
      a = b = 0.0f;
      l.les.mische(i, s + i, false, 1.0f, false, 1.0f, false, a, b);
      if (i >= 120 && i < 136) r = std::max(r, (double)std::fabs(a));
    }
    mitte[art] = r;
  }
  // bei j ≈ 128 von 960: linear 1 − 0,134 = 0,866, gleich laut cos(0,134 · π/2) = 0,978 (Hüllkurve der Sinus-Spitze 0,5)
  std::printf("  L3: Spitze um j = 128: linear %.4f, gleich laut %.4f (Verhältnis %.4f, Soll cos/(1−w) = 1,13)\n", mitte[0],
              mitte[1], mitte[1] / mitte[0]);
  PRUEF(mitte[1] / mitte[0] > 1.08 && mitte[1] / mitte[0] < 1.18);
  ergebnis("leser_leistung");
}

void test_leser_ring_lesen() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  cdj::BoxBand band;
  band.loop = lp.get();
  LLauf a(135.0, 80 * B), b(135.0, 80 * B);
  for (LLauf* l : {&a, &b}) l->les.ansetzen(0, &band, cdj::box_anker(l->k, 0, 1, lp->frames, 0));
  while (a.s < 40 * B) {
    a.teil(B, true);
    b.teil(B, true);
  }
  float rl[144], rr[144];
  const int n = a.les.ring_lesen(a.s, 144, rl, rr);
  b.teil(B, true);  // Bezug: derselbe Lauf liest den nächsten Block
  int ungleich = 0;
  for (int i = 0; i < n; ++i) ungleich += rl[i] != b.L[(size_t)(a.s + i)] ? 1 : 0;
  std::printf("  L4: ring_lesen %d Frames, %d ungleich zum nächsten Block\n", n, ungleich);
  PRUEF(n == 144 && ungleich == 0);
  ergebnis("leser_ring_lesen");
}

// ------------------------------------------------------------------------------------------ Box mit Dehner
// Beide Boxen, je mit eigenem Dehner (dehner: so viele Boxen bekommen einen, ab Box 1), synchron gefahren. Ausgabe links je
// Box und Kern-Sample (Index = Sample).
struct BoxLauf {
  Karte k;
  uint32_t gen = 1;
  std::unique_ptr<cdj::DehnerBasis> d[cdj::LOOP_BOXEN];
  cdj::StreckPost post[cdj::LOOP_BOXEN];
  std::unique_ptr<cdj::LoopBoxen> boxen = std::make_unique<cdj::LoopBoxen>();
  std::vector<float> L[cdj::LOOP_BOXEN];
  std::vector<float> R1;  // rechts von Box 1 (nur hoerprobe)
  int64_t s = 0;
  bool takt = true, fuelle = true;  // Vorbereiter bzw. Arbeits-Thread setzen aus, wenn false
  int hoer_bloecke[cdj::LOOP_BOXEN] = {}, bloecke = 0;
  int64_t hoer_ab[cdj::LOOP_BOXEN] = {-1, -1};  // erstes Sample eines Blocks, nach dem der Ring hörbar war
  struct Faktor {
    uint32_t e;
    int64_t gb;
    double f;
  };
  std::vector<Faktor> fk[cdj::LOOP_BOXEN];
  std::vector<float> ein_l, ein_r;
  float* el[cdj::MIX_KANAELE];
  float* er[cdj::MIX_KANAELE];
  BoxLauf(const Karte& karte, int64_t laenge, int dehner = 1)
      : k(karte), ein_l((size_t)cdj::MIX_KANAELE * cdj::MIX_BLOCK), ein_r((size_t)cdj::MIX_KANAELE * cdj::MIX_BLOCK) {
    for (auto& x : L) x.assign((size_t)laenge, 0.0f);
    for (int c = 0; c < cdj::MIX_KANAELE; ++c) {
      el[c] = ein_l.data() + (size_t)c * cdj::MIX_BLOCK;
      er[c] = ein_r.data() + (size_t)c * cdj::MIX_BLOCK;
    }
    boxen->setze_karte(&k, &gen);
    for (int i = 0; i < dehner; ++i) dehner_an(i + 1);
  }
  void dehner_an(int box) {
    d[box - 1] = cdj::dehner_neu(box);
    boxen->setze_keylock(box, d[box - 1].get(), &post[box - 1]);
  }
  const cdj::StreckLeser& les(int box = 1) const { return *boxen->keylock_leser(box); }
  void pumpe() {
    for (int i = 0; i < cdj::LOOP_BOXEN; ++i) {
      if (!d[i]) continue;
      if (takt) post[i].takt(*d[i]);
      if (!fuelle) continue;  // Arbeits-Thread echt (T9) oder angehalten: dessen Zustand nur synchron lesen (dehner.h)
      d[i]->fuelle_synchron();
      fk[i].push_back({d[i]->quittiert_e(), d[i]->geschrieben_bis(), d[i]->faktor_gesetzt()});
    }
  }
  void teil(int n) {
    std::fill(ein_l.begin(), ein_l.end(), 0.0f);
    std::fill(ein_r.begin(), ein_r.end(), 0.0f);
    cdj::BoxMeldung m[8];
    boxen->block(k, s, n, el, er, m, 8);
    for (int b = 0; b < cdj::LOOP_BOXEN; ++b) {
      for (int i = 0; i < n; ++i)
        if (s + i < (int64_t)L[b].size()) L[b][(size_t)(s + i)] = el[cdj::LOOP_KANAL0 + b][i];
      if (b == 0 && !R1.empty())
        for (int i = 0; i < n; ++i)
          if (s + i < (int64_t)R1.size()) R1[(size_t)(s + i)] = er[cdj::LOOP_KANAL0][i];
      if (d[b] && les(b + 1).ring_hoerbar()) {
        ++hoer_bloecke[b];
        if (hoer_ab[b] < 0) hoer_ab[b] = s + n;
      }
    }
    ++bloecke;
    s += n;
    pumpe();
  }
  void bis(int64_t ende) {
    while (s < ende) teil((int)std::min<int64_t>(B, ende - s));
  }
  int64_t sample(double beat) const { return std::llround(k.sample_at(beat)); }
  double beat() const { return k.beat_at((double)s); }
  std::vector<double> faktoren(int box, uint32_t e, int64_t s_h) const {
    std::vector<double> f;
    for (const Faktor& x : fk[box - 1]) {
      if (x.e != e || x.gb <= s_h) continue;
      const size_t w = (size_t)((x.gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, x.f);
      f[w] = x.f;
    }
    return f;
  }
};

// Tonhöhe je 100-ms-Fenster in [a, b): max |ct| gegen hz; Fenster über 2 ct; Null-Läufe (>= 32 exakte Nullen)
struct Ton {
  double max_ct = 0;
  int fenster = 0, ueber = 0, null_laeufe = 0;
  int64_t erstes_ueber = -1;
};
Ton ton_messen(const std::vector<float>& x, int64_t a, int64_t b, double hz) {
  Ton t;
  for (int64_t s = a; s + 4800 <= b; s += 4800) {
    const double f = km::freq(x, s, s + 4800);
    const double ct = f > 0 ? 1200.0 * std::log2(f / hz) : 9999.0;
    ++t.fenster;
    if (std::fabs(ct) > std::fabs(t.max_ct)) t.max_ct = ct;
    if (std::fabs(ct) > 2.0) {
      ++t.ueber;
      if (t.erstes_ueber < 0) t.erstes_ueber = s;
    }
  }
  int lauf = 0;
  for (int64_t s = a; s < b && s < (int64_t)x.size(); ++s) {
    if (x[(size_t)s] == 0.0f) {
      if (++lauf == 32) ++t.null_laeufe;
    } else {
      lauf = 0;
    }
  }
  return t;
}
void ton_drucken(const char* name, const Ton& t) {
  std::printf("  %s: %d Fenster, max %+.3f ct, über 2 ct %d (erstes bei %lld), Null-Läufe %d\n", name, t.fenster, t.max_ct,
              t.ueber, (long long)t.erstes_ueber, t.null_laeufe);
}

// Größte Abweichung im Fenster [s0, s0 + n) vom idealen Übergang (1 − w) · aus + w · ein, w = (j + 1) / n
template <class FA, class FB>
double blende_abweichung(const std::vector<float>& x, int64_t s0, int n, FA aus, FB ein) {
  double m = 0;
  for (int j = 0; j < n; ++j) {
    const double w = (double)(j + 1) / n;
    const double ideal = (1 - w) * aus((double)(s0 + j)) + w * ein((double)(s0 + j));
    m = std::max(m, std::fabs((double)x[(size_t)(s0 + j)] - ideal));
  }
  return m;
}
// An der Loop-Naht (Sample s_n): Sinus vor und nach dem Fenster eingepasst, Abweichung vom Übergang (wie test_deck_keylock)
double naht_abweichung(const std::vector<float>& x, int64_t s_n, double hz) {
  const int64_t a = s_n - 480;
  const km::Sinus vor = km::sinus_einpassen(x, a - 2000, a, hz);
  const km::Sinus nach = km::sinus_einpassen(x, a + 960, a + 960 + 2000, hz);
  return blende_abweichung(x, a, 960, vor, nach);
}

int64_t ungleich(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  int64_t n = 0;
  for (int64_t i = von; i < bis; ++i) n += a[(size_t)i] != b[(size_t)i] ? 1 : 0;
  return n;
}

// ------------------------------------------------------------------------------------------ T1
void test_basis_bitgleich() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  for (double bpm : {128.0, 130.0}) {
    const Karte k(bpm, 0);
    const int64_t n = (int64_t)k.sample_at(12.0);
    BoxLauf a(k, n, 1), b(k, n, 0);
    for (BoxLauf* l : {&a, &b}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->bis(B);
      l->boxen->start(1, l->beat(), l->s);
    }
    a.bis(n);
    b.bis(n);
    const int64_t u = ungleich(a.L[0], b.L[0], 0, n);
    std::printf("  T1 %.0f BPM: %lld von %lld Samples ungleich, Ring gelesen %llu, hörbar in %d Blöcken\n", bpm,
                (long long)u, (long long)n, (unsigned long long)a.les().gelesen(), a.hoer_bloecke[0]);
    if (bpm == 128.0) PRUEF(u == 0 && a.les().gelesen() > 0 && a.hoer_bloecke[0] == 0);
    else PRUEF(u > 0 && a.hoer_bloecke[0] > 0);  // Positiv-Kontrolle: außerhalb der Basis klingt der Ring
  }
  ergebnis("basis_bitgleich");
}

// ------------------------------------------------------------------------------------------ T2
void test_tonhoehe_fest() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  for (double bpm : {110.0, 130.0, 134.0, 135.0, 170.0}) {
    for (int aus = 0; aus < (bpm == 135.0 ? 2 : 1); ++aus) {
      const Karte k(bpm, 0);
      const int64_t n = (int64_t)k.sample_at(14.0);
      BoxLauf l(k, n, 1);
      l.boxen->laden(1, lp.get(), false, 0);
      if (aus) l.boxen->keylock(false, 0);  // Fehlerfall im selben Test: Schalter aus
      l.bis(l.sample(2.5) / B * B);
      l.boxen->start(1, l.beat(), l.s);
      l.bis(n);
      const int64_t e = l.sample(4.0);
      const Ton t = ton_messen(l.L[0], e, n, 416.0);
      char name[48];
      std::snprintf(name, sizeof name, "T2 %.0f BPM%s", bpm, aus ? " Schalter aus" : "");
      ton_drucken(name, t);
      if (aus) PRUEF(std::fabs(t.max_ct - 1200.0 * std::log2(135.0 / 128.0)) < 1.0);
      else PRUEF(t.fenster >= 30 && t.ueber == 0 && t.null_laeufe == 0);  // 10 Beats ab dem Einsatz: 35 Fenster bei 170 BPM
    }
  }
  ergebnis("tonhoehe_fest");
}

// ------------------------------------------------------------------------------------------ T3
void test_naht_wickeln() {
  const Karte k(132.0, 0);
  for (int beats : {1, 4}) {
    std::unique_ptr<cdj::Loop> lp = sinus_loop(beats, 416.0);
    const double e_beat = 4.0;
    const int durch = beats == 1 ? 6 : 3;
    const int64_t n = (int64_t)k.sample_at(e_beat + durch * beats + 1.5);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, lp.get(), false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(n);
    double naht = 0;
    for (int m = 1; m <= durch; ++m) naht = std::max(naht, naht_abweichung(l.L[0], l.sample(e_beat + m * beats), 416.0));
    const Ton t = ton_messen(l.L[0], l.sample(e_beat), n - 4800, 416.0);
    std::printf("  T3 Sinus %d Beat(s), %d Durchläufe: Naht max %.4f\n", beats, durch, naht);
    ton_drucken("T3 Ton", t);
    PRUEF(naht <= 0.02 && t.ueber == 0);
  }
  {  // Klick-Loop 4 Beats: Klick am Loop-Anfang je Durchlauf ±12 gegen das Soll, alle Klicks (a) ±3, (b) ±12 roh
    std::unique_ptr<cdj::Loop> lp = klick_loop(4);
    const int64_t n = (int64_t)k.sample_at(4.0 + 3 * 4 + 1.5);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, lp.get(), false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(n);
    static const std::vector<float> tpl = km::klick_vorlage();
    const DehnerAnker a = l.les().anker();
    double anf = 0;
    for (int m = 0; m < 3; ++m) {
      const int q = (int)std::llround(4.0 - a.b) + 4 * m;  // Quell-Beat des Loop-Anfangs im Durchlauf m
      double e = 999;
      PRUEF(km::klick_lage(l.L[0], k, a, q, e, tpl, km::MITTE));
      std::printf("  T3 Klick am Loop-Anfang, Durchlauf %d: %+.2f\n", m + 1, e);
      anf = std::max(anf, std::fabs(e));
    }
    const int64_t s_h = l.les().s_h();
    const std::vector<double> f = l.faktoren(1, l.les().epoche(), s_h);
    const int64_t p0 = km::band_start(k, a, s_h, f.at(0));
    cdj::BoxBand band;
    band.loop = lp.get();
    const int q0 = (int)std::llround(4.0 - a.b);
    const km::Lage m = km::lage_messen(l.L[0], band, k, a, p0, f, s_h, q0, q0 + 12);
    std::printf("  T3 Klick: %d Klicks, (a) Mittel %+.2f, (b) max |Box − rohes R3| %.2f, max |Lage| %.2f\n", m.n, m.mittel,
                m.max_roh, m.max_soll);
    // Hinweis der Hauptinstanz 08.10. (task-04/drums2): das absolute Mittel am Hann-Klick hängt an der Versatz-Tabelle, die
    // an echten Drums schlechter liegt; ausgewiesen, nicht gewertet. Gewertet wird je Klick gegen rohes R3.
    (void)anf;  // Klick am Loop-Anfang gegen das Soll: ausgewiesen (absolut, hängt an der Versatz-Tabelle)
    PRUEF(m.n == 12 && m.max_roh <= 12.0);
  }
  ergebnis("naht_wickeln");
}

// ------------------------------------------------------------------------------------------ T4
// Korrelation zweier Klickformen (144 Samples) an den Stellen a und b
double korrelation(const std::vector<float>& x, int64_t a, int64_t b) {
  double sab = 0, saa = 0, sbb = 0;
  for (int i = 0; i < 144; ++i) {
    const double u = x[(size_t)(a + i)], v = x[(size_t)(b + i)];
    sab += u * v;
    saa += u * u;
    sbb += v * v;
  }
  return saa > 0 && sbb > 0 ? sab / std::sqrt(saa * sbb) : 0.0;
}

void test_einsatz_aus_stille() {
  static const std::unique_ptr<cdj::Loop> sin1 = sinus_loop(1, 416.0);
  static const std::unique_ptr<cdj::Loop> klick = klick_loop(4);
  static const std::vector<float> tpl = km::klick_vorlage();
  // Klick a) bei 60 bis 130 BPM. Mit Versatz 0 (Keylock 4.6, für alle Quellen) liegt der Ring am Hann-Klick langsam früh (100
  // BPM rund −100, 80 BPM rund −220 Samples). Bis 7b.2 öffnete die Box erst beim Einsatz E und blendete die Kante 32 Samples
  // ein: der erste Klick war angeschnitten (100 BPM −11,2 dB, 80 BPM −25 dB; task-07-pruefung/qualitaet). Seit 7b.2 liefert
  // das Band vor dem Einsatz Stille und die Box hört den Ring schon ab E − BOX_VORLAGE, ohne Kanten-Einblende. Gewertet je
  // Tempo: erster Klick ±12 gegen rohes R3, Klickform Korrelation >= 0,985 gegen denselben Klick im nächsten Durchlauf,
  // Energie erster gegen eingeschwungenen Klick >= −1 dB.
  for (const double bpm_klick : {60.0, 70.0, 80.0, 90.0, 96.0, 100.0, 130.0}) {
  const Karte k(bpm_klick, 0);
  const bool werten = true;
  {  // a) Start bei Beat 8,5: Einsatz Beat 12 (3,5 Beats Vorlauf), erstes Fenster ab dem Einsatz ±2 ct; erster Klick
    for (int art = 0; art < 2; ++art) {
      const int64_t n = (int64_t)k.sample_at(18.0);
      BoxLauf l(k, n, 1);
      l.boxen->laden(1, art ? klick.get() : sin1.get(), false, 0);
      l.bis(l.sample(8.5) / B * B);
      l.boxen->start(1, l.beat(), l.s);
      // Vorlauf (7a 3.5 Punkt 1): bis kurz vor s_h = Einsatz − 1408 − BOX_VORLAGE rechnet der R3 nichts (der Ring liegt voll). Ohne
      // Vorlauf (s_h = Start + 4096) rechnete er die 3,5 Beats bis zum Einsatz durch; hörbar ist das nicht (der Ring wäre
      // auch dann zur Eins bereit, gemessen: Mutation BOX_OHNE_VORLAUF bleibt in allen Klangtests grün), es kostet Rechenzeit.
      l.bis(l.sample(12.0) - 4000);
      const uint64_t vor_e = l.d[0]->kosten_render().n;
      l.bis(n);
      const int64_t e = l.sample(12.0);
      std::printf("  T4a %s: R3-Abschnitte bis 4000 Samples vor dem Einsatz %llu\n", art ? "Klick" : "Sinus",
                  (unsigned long long)vor_e);
      PRUEF(vor_e <= 8);
      if (art == 0) {
        const double f = km::freq(l.L[0], e, e + 4800);
        const double ct = 1200.0 * std::log2(f / 416.0);
        std::printf("  T4a Sinus: s_h %lld, Einsatz %lld, erstes Fenster %+.3f ct, Ring hörbar ab Block %lld\n",
                    (long long)l.les().s_h(), (long long)e, ct, (long long)l.hoer_ab[0]);
        std::printf("  T4a Sinus %.0f BPM, 100-ms-Fenster ab E + j·1200:", bpm_klick);
        double ab50 = 0;  // größter Betrag der Fenster ab E + 2400
        for (int j = 0; j <= 8; ++j) {
          const double c = 1200.0 * std::log2(km::freq(l.L[0], e + j * 1200, e + j * 1200 + 4800) / 416.0);
          std::printf(" %+.2f", c);
          if (j >= 2) ab50 = std::max(ab50, std::fabs(c));
        }
        std::printf(" ct\n");
        // Keylock 7b.2: seit das Band vor dem Einsatz Stille liefert, ist der Einsatz für R3 ein harter Ton-Anfang. Gemessen
        // (task-07b/p2_nachher_t4.txt): das Fenster ab E liegt dann bis −4,50 ct (60 BPM), −2,15 (90), −1,12 (100), das ab
        // E + 1200 bis −1,79, ab E + 2400 höchstens 0,57; vorher (Loop-Schwanz als Vorlauf) ±0,7 ct, dafür war der erste Schlag
        // angeschnitten. Gewertet: ab E + 2400 (50 ms) ±2 ct; das erste Fenster ausgewiesen, Wache ±5 ct.
        PRUEF(ab50 <= 2.0 && std::fabs(ct) <= 5.0);
        // Vorlage ohne Loop-Schwanz: der 1-Beat-Sinus läuft am Loop-Ende voll weiter; vor dem Einsatz darf davon nichts klingen
        // (nur das Vorecho des Ton-Anfangs aus R3). Spitze je Viertel der Vorlage [E − 768, E) und vor ihr.
        double vor[5] = {};
        for (int j = 0; j < 5; ++j)
          for (int64_t t = e - 960 + j * 192; t < e - 960 + (j + 1) * 192; ++t)
            vor[j] = std::max(vor[j], (double)std::fabs(l.L[0][(size_t)t]));
        std::printf("  T4a Sinus %.0f BPM vor dem Einsatz, Spitze je 192 Samples ab E − 960: %.4f %.4f %.4f %.4f %.4f\n",
                    bpm_klick, vor[0], vor[1], vor[2], vor[3], vor[4]);
        PRUEF(vor[0] == 0.0 && vor[1] < 0.05);
        PRUEF(l.les().s_h() + cdj::STRECK_EINSCHWING <= e);
      } else {
        const DehnerAnker a = l.les().anker();
        const int q = (int)std::llround(12.0 - a.b);
        double e0 = 999, e1 = 999;
        PRUEF(km::klick_lage(l.L[0], k, a, q, e0, tpl, km::MITTE));
        PRUEF(km::klick_lage(l.L[0], k, a, q + 4, e1, tpl, km::MITTE));  // eingeschwungener Bezug: dieselbe Stelle, nächster Durchlauf
        const int64_t s0 = (int64_t)std::llround(k.sample_at(a.b + (q * FPB + km::MITTE - a.f) / FPB) - km::MITTE + e0);
        const int64_t s1 = (int64_t)std::llround(k.sample_at(a.b + ((q + 4) * FPB + km::MITTE - a.f) / FPB) - km::MITTE + e1);
        const double kor = korrelation(l.L[0], s0, s1);
        // Lage (b) wie T5: der erste Klick gegen rohes R3 mit derselben Faktorfolge (die Streuung des einzelnen Klicks um das
        // Soll liegt bei R3 selbst bis rund 60 Samples, dehner.h:45; Einmessen bei 100 BPM: −15 bis +13)
        const int64_t s_h = l.les().s_h();
        const std::vector<double> f = l.faktoren(1, l.les().epoche(), s_h);
        cdj::BoxBand band;
        band.loop = klick.get();
        const km::Lage m = km::lage_messen(l.L[0], band, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, q, q + 1);
        // Energie um das Soll des ersten Klicks gegen dieselbe Stelle im nächsten Durchlauf (±1000 Samples: bei 60 BPM liegt
        // der Ring rund 420 Samples früh)
        auto energie = [&](int qq) {
          const int64_t m0 = (int64_t)std::llround(k.sample_at(a.b + (qq * FPB + km::MITTE - a.f) / FPB));
          double e2 = 0;
          for (int64_t t = m0 - 1000; t < m0 + 1000; ++t) e2 += (double)l.L[0][(size_t)t] * l.L[0][(size_t)t];
          return e2;
        };
        const double en_db = 10.0 * std::log10(energie(q) / energie(q + 4));
        std::printf("  T4a Klick %.0f BPM: erster Klick %+.2f gegen das Soll, %.2f gegen rohes R3, Bezug (nächster Durchlauf) "
                    "%+.2f, Klickform Korrelation %.4f, Energie erster gegen eingeschwungenen %+.2f dB, Ring hörbar ab %lld "
                    "(Einsatz %lld)%s\n",
                    bpm_klick, e0, m.max_roh, e1, kor, en_db, (long long)l.hoer_ab[0], (long long)e,
                    werten ? "" : " (ausgewiesen, nicht gewertet)");
        if (werten) PRUEF(m.n == 1 && m.max_roh <= 12.0 && kor >= 0.985 && en_db >= -1.0);
      }
    }
  }
  }
  const Karte k(100.0, 0);
  for (int fall = 0; fall < 2; ++fall) {  // b) 50 ms vor der Eins, c) genau auf der Eins: Brücke, dann Ring
    const int64_t n = (int64_t)k.sample_at(16.0);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, sin1.get(), false, 0);
    const int64_t s_start = fall == 0 ? (l.sample(12.0) - 2400) / B * B : l.sample(12.0) / B * B;
    l.bis(s_start);
    const double b0 = fall == 0 ? l.beat() : 12.0;
    l.boxen->start(1, b0, l.s);
    l.bis(n);
    const int64_t s_h = l.les().s_h(), s_e = s_h + cdj::STRECK_EINSCHWING;
    // Blende Brücke (Varispeed, Sinus 416 · 100/128) -> Ring (eingepasst) über 960 ab s_e
    const km::Sinus vari = km::sinus_einpassen(l.L[0], s_e - 2000, s_e, 416.0 * 100.0 / 128.0);
    const km::Sinus ring = km::sinus_einpassen(l.L[0], s_e + 960, s_e + 960 + 2000, 416.0);
    const double bl = blende_abweichung(l.L[0], s_e, 960, vari, ring);
    const Ton t = ton_messen(l.L[0], s_e + 960, n, 416.0);
    std::printf("  T4%c (%s): s_h %lld, Einsatz %lld, Blende %.4f, verpasst %llu, aufgegeben %llu\n", fall ? 'c' : 'b',
                fall ? "auf der Eins" : "50 ms vor der Eins", (long long)s_h, (long long)l.sample(12.0), bl,
                (unsigned long long)l.les().verpasst_n(), (unsigned long long)l.les().aufgegeben_n());
    ton_drucken("T4 Ton nach der Blende", t);
    PRUEF(bl <= 0.02 && l.les().aufgegeben_n() == 0 && t.ueber == 0);
  }
  // d) Karte ändert sich nach dem Start (Einsatz rückt vor s_h + 1408): Brücke, nie ein Sprung. Keylock 7c.1 (Nachprüfung 7b
  // Q1): die Box setzt dann im Varispeed ein; vorher blieb der Start aus Stille gesetzt und der Ring sprang bei s_h + 1408
  // ohne Blende ein (104 BPM 0,9627 bei natürlich 0,027). Gemessen bis s_h + 1408 + 960 + 4800, Ziel 104, 110, 140 BPM.
  for (const double ziel : {104.0, 110.0, 140.0}) {
    Karte k2(100.0, 0);
    const int64_t n = (int64_t)k2.sample_at(20.0);
    BoxLauf l(k2, n, 1);
    l.boxen->laden(1, sin1.get(), false, 0);
    l.bis(l.sample(8.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(l.sample(9.0) / B * B);
    PRUEF(l.k.rampe(9.5, ziel, 1.0));  // Einsatz Beat 12 rückt in der Zeit nach vorn
    ++l.gen;
    l.bis(n);
    const int64_t e = std::llround(l.k.sample_at(12.0));
    const int64_t s_h = l.les().s_h();
    const int64_t bis = std::max<int64_t>(e + 9600, s_h + cdj::STRECK_EINSCHWING + cdj::STRECK_BLENDE + 4800);
    const sprung::Mass m = sprung::messe(l.L[0], e - 4800, bis);
    const double nat = sprung::natuerlich(416.0 * std::max(ziel, 128.0) / 128.0, 0.5);  // Ring 416 Hz, Brücke 416 · ziel/128
    std::printf("  T4d 100 -> %.0f: Einsatz %lld, s_h %lld (s_h + 1408 %s Einsatz), größter Sprung %.4f bei %lld bis %lld "
                "(natürlich %.4f), Ring hörbar ab %lld\n",
                ziel, (long long)e, (long long)s_h, s_h + cdj::STRECK_EINSCHWING <= e ? "<=" : ">", m.d1, (long long)m.ort1,
                (long long)bis, nat, (long long)l.hoer_ab[0]);
    PRUEF(m.d1 < 2.0 * nat && l.hoer_ab[0] > 0);
  }
  ergebnis("einsatz_aus_stille");
}

// ------------------------------------------------------------------------------------------ T14b (Keylock 7c.3)
// Raster in der wartenden Box, 4, 5 und 8 Mal je Block, während der Arbeits-Thread nicht quittiert (T14-Aufbau): Plan 7a 3.4
// „wartet: neuer Ansatz mit neuem Versatz, gleiches Band, keine Leihe“. Seit 7b.2 trug das Band still_bis (hängt am Versatz),
// jedes Raster nahm einen neuen Platz (Nachprüfung 7b Q2/N2: kein_platz 1/2/5, Ring nie hörbar). Gefordert: kein_platz 0,
// höchstens ein Platz verliehen, Ring zur Eins hörbar.
void test_raster_wartend() {
  static const std::unique_ptr<cdj::Loop> klick = klick_loop(4);
  for (const int anzahl : {4, 5, 8}) {
    const Karte k(110.0, 0);
    const int64_t n = (int64_t)k.sample_at(18.0);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, klick.get(), false, 0);
    l.bis(l.sample(4.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);  // Einsatz Beat 8
    l.bis(l.sample(5.0) / B * B);
    l.takt = l.fuelle = false;
    int verliehen = 0;
    for (int r = 0; r < anzahl; ++r) {
      PRUEF(l.boxen->raster(1, 100 * (r + 1), l.s) == 0);
      l.teil(B);
      verliehen = std::max(verliehen, l.boxen->keylock_verliehen(1));
    }
    l.takt = l.fuelle = true;
    l.bis(n);
    const int64_t e = l.sample(8.0);
    std::printf("  T14b %d Raster ohne Quittung: kein_platz %llu, höchstens %d Plätze verliehen, Ring hörbar ab %lld (Einsatz %lld)\n",
                anzahl, (unsigned long long)l.boxen->keylock_kein_platz(1), verliehen, (long long)l.hoer_ab[0], (long long)e);
    PRUEF(l.boxen->keylock_kein_platz(1) == 0 && verliehen <= 1 && l.hoer_ab[0] >= 0 && l.hoer_ab[0] <= e + B);
  }
  ergebnis("raster_wartend");
}

// ------------------------------------------------------------------------------------------ T19 (Keylock 7c.4)
// Entscheidung der Hauptinstanz 08.10. zu Nachprüfung 7b N4. Rampe 140 -> 128 (Ring bleibt auf der Basis, 7b.1), dann bei
// Beat 20 auf der Basis:
//  K  Knopf aus: (a) der Ring bleibt hörbar (kein Einbruch), und wenn das Tempo die Basis verlässt (Rampe ab Beat 24 auf 135),
//     spielt die Box den Varispeed-Weg (+92,2 ct am Ende).
//  R  Raster mit demselben Versatz (friert ein, Blende in den Direktweg): (b) gleich laut statt linear.
// Material Sinus 416 Hz und Rauschen. Maß: tiefstes 240er-RMS-Fenster in [Ereignis − 480, Ereignis + 1440) gegen den RMS von
// 4320 Samples davor. Gewertet: K beide Materialien und R Rauschen ≥ −1,5 dB; R Sinus ausgewiesen (Gegenphase, ADR 029).
std::unique_ptr<cdj::Loop> rausch_loop(int beats, const char* name = "rauschen") {
  auto l = std::make_unique<cdj::Loop>();
  l->name = name;
  l->beats = beats;
  l->frames = beats * cdj::LOOP_SPB;
  l->daten.assign((size_t)(2 * l->frames), 0.0f);
  std::mt19937 g(7);
  std::normal_distribution<float> nd(0.0f, 0.15f);
  for (int64_t f = 0; f < l->frames; ++f) l->daten[(size_t)(2 * f)] = l->daten[(size_t)(2 * f + 1)] = nd(g);
  return l;
}
double rms(const std::vector<float>& x, int64_t a, int64_t n) {
  double q = 0;
  for (int64_t i = a; i < a + n; ++i) q += (double)x[(size_t)i] * x[(size_t)i];
  return std::sqrt(q / (double)n);
}
double tiefstes_240(const std::vector<float>& x, int64_t s) {
  const double ref = rms(x, s - 4800, 4320);
  double tief = 1e9;
  for (int64_t p = s - 480; p + 240 <= s + 1440; p += 60) tief = std::min(tief, 20.0 * std::log10(rms(x, p, 240) / ref));
  return tief;
}
void test_basis_knopf_blende() {
  static const std::unique_ptr<cdj::Loop> sin1 = sinus_loop(1, 416.0);
  static const std::unique_ptr<cdj::Loop> rau = rausch_loop(1);
  for (int art = 0; art < 2; ++art) {
    for (int fall = 0; fall < 2; ++fall) {  // 0 Knopf aus, 1 Raster
      Karte k(140.0, 0);
      PRUEF(k.rampe(8.0, 128.0, 8.0));
      PRUEF(k.rampe(24.0, 135.0, 2.0));
      const int64_t n = (int64_t)k.sample_at(32.0);
      BoxLauf l(k, n, 1);
      l.boxen->laden(1, art ? rau.get() : sin1.get(), false, 0);
      l.bis(l.sample(2.5) / B * B);
      l.boxen->start(1, l.beat(), l.s);
      l.bis(l.sample(20.0) / B * B);
      const bool vorher = l.les().ring_hoerbar();
      const int64_t s_e = l.s;
      if (fall == 0) l.boxen->keylock(false, l.s);
      else PRUEF(l.boxen->raster(1, 0, l.s) == 0);
      l.bis(l.sample(23.0) / B * B);
      const bool danach = l.les().ring_hoerbar();
      l.bis(n);
      const double tief = tiefstes_240(l.L[0], s_e);
      double ct_ende = NAN;
      if (art == 0) ct_ende = 1200.0 * std::log2(km::freq(l.L[0], n - 9600, n - 4800) / 416.0);
      std::printf("  T19 %s, %s auf der Basis: Ring vorher %d, 3 Beats danach %d; tiefstes 240er-Fenster %+.2f dB; am Ende (135 "
                  "BPM) %+.2f ct\n",
                  art ? "Rauschen" : "Sinus 416", fall ? "Raster" : "Knopf aus", (int)vorher, (int)danach, tief, ct_ende);
      PRUEF(vorher);
      if (fall == 0) {
        PRUEF(danach && tief >= -1.5);  // (a)
        if (art == 0) PRUEF(std::fabs(ct_ende - 1200.0 * std::log2(135.0 / 128.0)) < 1.0);  // Knopf aus: Varispeed nach der Rampe
      } else if (art == 1) {
        PRUEF(!danach && tief >= -1.5);  // (b)
      }
    }
  }
  ergebnis("basis_knopf_blende");
}

// ------------------------------------------------------------------------------------------ T18 (Keylock 7c.2)
// Ereignis in der Vorlage [E − 768, E) einer wartenden Box (Start aus Stille, 60 BPM, Sinus 416 Hz: der Ring klingt dort schon
// voll): Stopp, Raster, Laden eines anderen Loops, Knopf aus, je bei E − 100 und E − 256 (auch zwischen zwei Blöcken).
// Gemessen: größter Nachbarsprung von 64 Samples vor dem Ereignis bis 2000 danach (deckt die Ausblende); Grenze 2 · natürlich
// (416 Hz, 0,5). Vorher (Stand 7b, Mutation BOX_VORLAGE_STUMM): stumm() ohne Blende, Sprung bis 0,4663 (Nachprüfung 7b N1).
void test_ereignis_in_vorlage() {
  static const std::unique_ptr<cdj::Loop> sin1 = sinus_loop(1, 416.0);
  static const std::unique_ptr<cdj::Loop> sin2 = sinus_loop(1, 832.0, "s832");
  const char* namen[] = {"", "Stopp", "Raster", "Laden", "Knopf aus"};
  const double nat = sprung::natuerlich(832.0, 0.5);  // nach dem Laden klingt 832 Hz
  for (const int64_t ab : {(int64_t)100, (int64_t)256}) {
    for (int art = 1; art <= 4; ++art) {
      const Karte k(60.0, 0);
      const int64_t n = (int64_t)k.sample_at(16.0);
      BoxLauf l(k, n, 1);
      l.boxen->laden(1, sin1.get(), false, 0);
      l.bis(l.sample(8.5) / B * B);
      l.boxen->start(1, l.beat(), l.s);
      const int64_t e = l.sample(12.0), s_ev = e - ab;
      l.bis(s_ev / B * B);
      if (l.s < s_ev) l.teil((int)(s_ev - l.s));
      const bool hoer = l.les().ring_hoerbar();
      const cdj::Loop* zurueck = nullptr;
      if (art == 1) l.boxen->stopp(1, l.beat(), l.s);
      if (art == 2) l.boxen->raster(1, 1000, l.s);
      if (art == 3) zurueck = l.boxen->laden(1, sin2.get(), false, l.s);
      if (art == 4) l.boxen->keylock(false, l.s);
      l.bis(n);
      double sp = 0;
      int64_t ort = -1;
      for (int64_t t = s_ev - 64; t < s_ev + 2000; ++t) {
        const double d = std::fabs((double)l.L[0][(size_t)t] - (double)l.L[0][(size_t)t - 1]);
        if (d > sp) sp = d, ort = t;
      }
      std::printf("  T18 %s bei E − %lld: Ring vorher hörbar %d, größter Nachbarsprung %.4f bei E%+lld (Grenze %.4f)\n",
                  namen[art], (long long)ab, (int)hoer, sp, (long long)(ort - e), 2.0 * nat);
      PRUEF(hoer && sp < 2.0 * nat);
      (void)zurueck;
      for (int j = 0; j < 40; ++j) {
        l.teil(B);
        while (l.boxen->abholen()) {
        }
      }
    }
  }
  ergebnis("ereignis_in_vorlage");
}

// ------------------------------------------------------------------------------------------ T5
km::Lage box_lage(const Karte& k, int64_t versatz, int n_klicks, double start_beat = 2.5) {
  static const std::unique_ptr<cdj::Loop> klick = klick_loop(4);
  const int64_t n = (int64_t)k.sample_at(4.0 + n_klicks + 2.0);
  BoxLauf l(k, n, 1);
  l.boxen->laden(1, klick.get(), false, 0);
  if (versatz) l.boxen->raster(1, versatz, 0);
  l.bis(l.sample(start_beat) / B * B);
  l.boxen->start(1, l.beat(), l.s);
  l.bis(n);
  // Soll-Anker unabhängig vom Leser: Durchlauf-Anfang und Versatz der Box (sonst sähe der Test einen falschen Anker nicht)
  DehnerAnker a = l.les().anker();
  a.f = (double)(((versatz % klick->frames) + klick->frames) % klick->frames);
  const int64_t s_h = l.les().s_h();
  const std::vector<double> f = l.faktoren(1, l.les().epoche(), s_h);
  const int64_t p0 = km::band_start(k, a, s_h, f.at(0));
  cdj::BoxBand band;
  band.loop = klick.get();
  const int q0 = (int)std::ceil(4.0 - a.b + 0.5);
  return km::lage_messen(l.L[0], band, k, a, p0, f, s_h, q0, q0 + n_klicks);
}

// Diagnose (kein Teil der Suite; mit CYPHERDJ_MUTATION_BOX_BASIS_RING_HOERBAR klingt der Ring auch bei 128): Lage der Klicks
// nach einer Rampe auf die Basis. Aufruf: test_loopbox_keylock lage_nach_rampe VON NACH
void diag_lage_nach_rampe(double von, double nach) {
  Karte k(von, 0);
  PRUEF(k.rampe(8.0, nach, 8.0));
  static const std::unique_ptr<cdj::Loop> klick = klick_loop(4);
  const int64_t n = (int64_t)k.sample_at(48.0);
  BoxLauf l(k, n, 1);
  l.boxen->laden(1, klick.get(), false, 0);
  l.bis(l.sample(2.5) / B * B);
  l.boxen->start(1, l.beat(), l.s);
  l.bis(n);
  const DehnerAnker a = l.les().anker();
  const int64_t s_h = l.les().s_h();
  const std::vector<double> f = l.faktoren(1, l.les().epoche(), s_h);
  cdj::BoxBand band;
  band.loop = klick.get();
  for (int q0 : {5, 18, 30}) {
    const km::Lage m = km::lage_messen(l.L[0], band, k, a, km::band_start(k, a, s_h, f.at(0)), f, s_h, q0, q0 + 12);
    std::printf("  Klicks %d bis %d: (a) Mittel %+.2f, (b) max roh %.2f, max |Lage| %.2f\n", q0, q0 + 11, m.mittel, m.max_roh,
                m.max_soll);
  }
}

void test_lage() {
  // Keylock 7b.7: Randwerte 60, 75, 190, 200 im Standardlauf (vorher nur mit BOX_LAGE_RAND). Seit rohes R3 wie der Dehner
  // gespeist wird (keylock_mess.h r3_roh), liegt die Box je Klick bei 0,00 gegen rohes R3 (hoch-bpm/t5_nachher.txt); Grenze
  // darum ±2 statt ±12 (Mutation DEHNER_BANDSTART_8, Bandstart 8 Frames daneben, wird damit bei jedem Tempo rot, auch 190).
  const std::vector<double> tempi = {60.0, 75.0, 100.0, 130.0, 170.0, 190.0, 200.0};
  for (int64_t v : {(int64_t)0, (int64_t)5000})
    for (double bpm : tempi) {
      // 64 Klicks wie beim Einmessen (dehner.h:38): bei 170 BPM streut der einzelne Klick um rund 20 Samples, über 32 Klicks
      // liegt der Standardfehler des Mittels schon bei rund 3,5 (erster Lauf: −3,83 bei 32, −1,88 bei 64 Klicks)
      const km::Lage m = box_lage(Karte(bpm, 0), v, 64);
      std::printf("  T5 %.0f BPM Versatz %lld: %d Klicks, (a) Mittel %+.2f, (b) max |Box − rohes R3| %.2f, max |Lage| %.2f\n",
                  bpm, (long long)v, m.n, m.mittel, m.max_roh, m.max_soll);
      // Mittel ausgewiesen, nicht gewertet (Versatz 0 für alle Quellen, Keylock 4.6 und Entscheidung der Hauptinstanz
      // 08.10.: das Hann-Mittel liegt dann bei 100 BPM um −90, bei 60 BPM um −385). Gewertet: je Klick gegen rohes R3, und
      // alle 64 Klicks gefunden (ein falscher Anker, Mutation BOX_ANKER_OHNE_VERSATZ, verschiebt um 5000 Samples aus dem
      // Suchfenster)
      PRUEF(m.n == 64 && m.max_roh <= 2.0);
    }
  {  // Rampe 128 -> 132 über 32 Beats ab Beat 8
    Karte k(128.0, 0);
    PRUEF(k.rampe(8.0, 132.0, 32.0));
    const km::Lage m = box_lage(k, 0, 40);
    std::printf("  T5 Rampe 128 -> 132: %d Klicks, (a) Mittel %+.2f, (b) max |Box − rohes R3| %.2f, max |Lage| %.2f\n", m.n,
                m.mittel, m.max_roh, m.max_soll);
    PRUEF(m.n == 40 && m.max_roh <= 2.0);  // Mittel ausgewiesen, nicht gewertet (siehe T3); ±2 seit 7b.7
  }
  ergebnis("lage");
}

// ------------------------------------------------------------------------------------------ T6
void test_laden_klingend() {
  static const std::unique_ptr<cdj::Loop> a416 = sinus_loop(1, 416.0, "a416");
  static const std::unique_ptr<cdj::Loop> b832 = sinus_loop(1, 832.0, "b832");
  const Karte k(135.0, 0);
  const int64_t n = (int64_t)k.sample_at(16.0);
  BoxLauf l(k, n, 1);
  l.boxen->laden(1, a416.get(), false, 0);
  l.bis(l.sample(2.5) / B * B);
  l.boxen->start(1, l.beat(), l.s);
  l.bis(l.sample(8.0) / B * B);
  PRUEF(l.les().ring_hoerbar());
  PRUEF(l.boxen->laden(1, b832.get(), false, l.s) == nullptr);
  const int64_t S = l.s;
  l.teil(B);  // der wartende Loop übernimmt in diesem Block
  l.bis(n);
  // gleich laut: Effektivwert in der Mitte der Blende wie davor (zwei unkorrelierte Sinus, linear −3 dB)
  auto rms = [&](int64_t a, int64_t b) {
    double q = 0;
    for (int64_t t = a; t < b; ++t) q += (double)l.L[0][(size_t)t] * l.L[0][(size_t)t];
    return std::sqrt(q / (double)(b - a));
  };
  const double vor = rms(S - 1200, S - 240), mitte = rms(S + 380, S + 580);
  const double db = 20.0 * std::log10(mitte / vor);
  const sprung::Mass sp = sprung::messe(l.L[0], S - 10, S + 960);
  const int64_t s_h = l.les().s_h();
  const Ton t = ton_messen(l.L[0], s_h + cdj::STRECK_EINSCHWING + 960, n, 832.0);
  std::printf("  T6: Übernahme bei %lld, Pegel Mitte gegen davor %+.2f dB, größter Sprung %.4f (natürlich %.4f), s_h %lld\n",
              (long long)S, db, sp.d1, sprung::natuerlich(832.0 * 135.0 / 128.0, 0.5), (long long)s_h);
  ton_drucken("T6 neuer Ton", t);
  PRUEF(std::fabs(db) <= 1.0);
  PRUEF(sp.d1 < 1.5 * sprung::natuerlich(832.0 * 135.0 / 128.0, 0.5));
  PRUEF(t.ueber == 0 && t.fenster >= 20);
  ergebnis("laden_klingend");
}

// ------------------------------------------------------------------------------------------ T7
void test_set_neu_schwanz() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  const Karte k(135.0, 0);
  const int64_t n = (int64_t)k.sample_at(12.0);
  {  // aus dem Ring: Schwanz = Ring-Ausgabe × Hülle (Bezug: derselbe Lauf ohne ausklingen)
    BoxLauf a(k, n, 1), b(k, n, 1);
    for (BoxLauf* l : {&a, &b}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->bis(l->sample(2.5) / B * B);
      l->boxen->start(1, l->beat(), l->s);
      l->bis(l->sample(8.0) / B * B);
    }
    PRUEF(a.les().ring_hoerbar() && !a.les().blendet());
    const int64_t S = a.s;
    a.boxen->ausklingen(a.k, S);
    (void)a.boxen->leeren(S);
    a.teil(B);
    b.teil(B);
    cdj::Blende h;
    h.ziel(0.0f, cdj::LOOPBOX_AUS);
    int ungl = 0;
    for (int t = 0; t < cdj::LOOPBOX_AUS; ++t) {
      const float g = h.schritt();
      ungl += a.L[0][(size_t)(S + t)] != b.L[0][(size_t)(S + t)] * g ? 1 : 0;
    }
    std::printf("  T7 Ring: %d von %d Schwanz-Samples ungleich Ring × Hülle, letztes %.6g\n", ungl, cdj::LOOPBOX_AUS,
                a.L[0][(size_t)(S + cdj::LOOPBOX_AUS - 1)]);
    PRUEF(ungl == 0 && a.L[0][(size_t)(S + cdj::LOOPBOX_AUS - 1)] == 0.0f);
  }
  {  // Rückfall: weniger als 144 Frames im Ring -> Varispeed-Pfad wie ohne Dehner (bitgleich)
    BoxLauf a(k, n, 1), c(k, n, 0);
    for (BoxLauf* l : {&a, &c}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->bis(l->sample(2.5) / B * B);
      l->boxen->start(1, l->beat(), l->s);
      l->bis(l->sample(8.0) / B * B);
    }
    a.fuelle = false;
    int64_t v = (int64_t)a.d[0]->ring().verfuegbar(a.s);
    while (v - 136 > cdj::STRECK_MAX_BLOCK) {  // höchstens ein Block von 1024 (StreckLeser liest nicht mehr je Block)
      a.teil(B);
      c.teil(B);
      v = (int64_t)a.d[0]->ring().verfuegbar(a.s);
    }
    const int m = (int)(v - 136);  // danach liegen 136 Frames vor: >= STRECK_KNAPP, < 144
    a.teil(m);
    c.teil(m);
    const bool hoer = a.les().ring_hoerbar();
    const int64_t S = a.s;
    for (BoxLauf* l : {&a, &c}) {
      l->boxen->ausklingen(l->k, S);
      (void)l->boxen->leeren(S);
      l->teil(B);
    }
    const int64_t u = ungleich(a.L[0], c.L[0], S, S + cdj::LOOPBOX_AUS);
    std::printf("  T7 Rückfall: im Ring %lld vor dem Block von %d, danach %lld, Ring hörbar %d, %lld ungleich zum Varispeed\n",
                (long long)v, m, (long long)a.d[0]->ring().verfuegbar(S), (int)hoer, (long long)u);
    PRUEF(hoer && u == 0);
  }
  ergebnis("set_neu_schwanz");
}

// ------------------------------------------------------------------------------------------ T8
void test_aus_ist_varispeed() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  const Karte k(135.0, 0);
  const int64_t n = (int64_t)k.sample_at(14.0);
  {  // aus vor dem Start: bitgleich zur Box ohne Dehner
    BoxLauf a(k, n, 1), b(k, n, 0);
    for (BoxLauf* l : {&a, &b}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->boxen->keylock(false, 0);
      l->bis(l->sample(2.5) / B * B);
      l->boxen->start(1, l->beat(), l->s);
      l->bis(n);
    }
    const int64_t u = ungleich(a.L[0], b.L[0], 0, n);
    std::printf("  T8 aus: %lld ungleich zur Box ohne Dehner\n", (long long)u);
    PRUEF(u == 0);
  }
  {  // an -> aus im Ring: Blende <= 0,02 auf den Varispeed-Weg, danach bitgleich
    BoxLauf a(k, n, 1), b(k, n, 0);
    for (BoxLauf* l : {&a, &b}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->bis(l->sample(2.5) / B * B);
      l->boxen->start(1, l->beat(), l->s);
      l->bis(l->sample(8.0) / B * B);
    }
    PRUEF(a.les().ring_hoerbar());
    const int64_t S = a.s;
    a.boxen->keylock(false, S);
    b.boxen->keylock(false, S);
    a.bis(n);
    b.bis(n);
    const km::Sinus ring = km::sinus_einpassen(a.L[0], S - 2000, S, 416.0);
    const std::vector<float>& v = b.L[0];
    const double bl = blende_abweichung(a.L[0], S, 960, ring, [&](double t) { return (double)v[(size_t)t]; });
    const int64_t u = ungleich(a.L[0], b.L[0], S + 960, n);
    std::printf("  T8 an -> aus: Blende %.4f, danach %lld ungleich zum Varispeed\n", bl, (long long)u);
    PRUEF(bl <= 0.02 && u == 0);
  }
  ergebnis("aus_ist_varispeed");
}

// ------------------------------------------------------------------------------------------ T9
// Echte Fäden (Vorbereiter und je Box ein Arbeits-Thread, wie im Kern), Ereignisse in Zufallsfolge; die Netz-Rolle löscht
// jeden zurückgegebenen Loop sofort, auf beiden Wegen (Rückgabewert von laden und abholen). Unter ASan: kein Fund.
void test_lebensdauer(int n_ereignisse) {
  Karte k0(135.0, 0);
  BoxLauf l(k0, 0, 2);
  l.takt = l.fuelle = false;  // das tun die Fäden
  std::atomic<bool> halt{false};
  std::thread vor([&] {
    while (!halt.load(std::memory_order_acquire)) {
      for (int i = 0; i < cdj::LOOP_BOXEN; ++i) l.post[i].takt(*l.d[i]);
      std::this_thread::sleep_for(std::chrono::microseconds(300));
    }
  });
  std::thread arb[cdj::LOOP_BOXEN];
  for (int i = 0; i < cdj::LOOP_BOXEN; ++i)
    arb[i] = std::thread([&, i] {
      while (!halt.load(std::memory_order_acquire)) {
        l.d[i]->fuelle_synchron();
        l.d[i]->fuelle_synchron();
        std::this_thread::sleep_for(std::chrono::microseconds(300));
      }
    });
  std::mt19937 rng(7);
  int erzeugt = 0, zurueck = 0, doppelt = 0;
  std::vector<cdj::Loop*> lebend;
  auto neu = [&]() {
    const int beats = 1 << (rng() % 3);
    cdj::Loop* x = (rng() % 2 ? sinus_loop(beats, 416.0) : klick_loop(beats)).release();
    ++erzeugt;
    lebend.push_back(x);
    return x;
  };
  auto weg = [&](const cdj::Loop* q) {  // Netz-Rolle: sofort löschen
    if (!q) return;
    auto it = std::find(lebend.begin(), lebend.end(), q);
    if (it == lebend.end()) {
      ++doppelt;
      return;
    }
    lebend.erase(it);
    delete q;
    ++zurueck;
  };
  int ereignisse = 0;
  while (ereignisse < n_ereignisse) {
    const int box = 1 + (int)(rng() % 2);
    switch (rng() % 9) {
      case 0:
      case 1: weg(l.boxen->laden(box, neu(), false, l.s)); break;
      case 2: weg(l.boxen->laden(box, nullptr, false, l.s)); break;
      case 3: l.boxen->start(box, l.beat(), l.s); break;
      case 4: l.boxen->stopp(box, l.beat(), l.s); break;
      case 5: l.boxen->raster(box, (int64_t)(rng() % 5000), l.s); break;
      case 6: {
        const double ziel = 100.0 + (double)(rng() % 80);
        l.k.rampe(l.beat() + 0.5, ziel, 1.0 + (double)(rng() % 4));
        if (l.k.anzahl() > 50) l.k.neu(ziel, l.s);
        ++l.gen;
        break;
      }
      case 7: l.boxen->keylock(rng() % 3 != 0, l.s); break;
      case 8:
        if (rng() % 4 == 0) {
          l.boxen->ausklingen(l.k, l.s);
          (void)l.boxen->leeren(l.s);
        }
        break;
    }
    while (const cdj::Loop* q = l.boxen->abholen()) weg(q);
    ++ereignisse;
    // meist kurz (Ereignisse dicht), jedes zehnte Mal 40 Blöcke Ruhe: der Ring muss auch wirklich klingen (Positiv-Kontrolle)
    const int bloecke = 1 + (int)(rng() % 6) + (ereignisse % 10 == 0 ? 40 : 0);
    for (int j = 0; j < bloecke; ++j) {
      l.teil(B);
      while (const cdj::Loop* q = l.boxen->abholen()) weg(q);
      std::this_thread::sleep_for(std::chrono::microseconds(200));
    }
  }
  for (int box = 1; box <= cdj::LOOP_BOXEN; ++box) weg(l.boxen->laden(box, nullptr, false, l.s));
  for (int j = 0; j < 4000 && !lebend.empty(); ++j) {  // bis alles quittiert ist
    l.teil(B);
    while (const cdj::Loop* q = l.boxen->abholen()) weg(q);
    std::this_thread::sleep_for(std::chrono::microseconds(500));
  }
  halt.store(true, std::memory_order_release);
  vor.join();
  for (auto& t : arb) t.join();
  std::printf("  T9: %d Ereignisse, %d Loops erzeugt, %d zurück, %d doppelt, %zu nicht zurück, frei_verloren %d, Ring hörbar "
              "%d + %d Blöcke, Unterläufe %llu + %llu, kein Platz %llu + %llu\n",
              ereignisse, erzeugt, zurueck, doppelt, lebend.size(), l.boxen->abholen_verloren(), l.hoer_bloecke[0],
              l.hoer_bloecke[1], (unsigned long long)l.les(1).unterlauf_n(), (unsigned long long)l.les(2).unterlauf_n(),
              (unsigned long long)l.boxen->keylock_kein_platz(1), (unsigned long long)l.boxen->keylock_kein_platz(2));
  PRUEF(zurueck == erzeugt && doppelt == 0 && lebend.empty());
  PRUEF(l.boxen->abholen_verloren() == 0);
  // Positiv: der Ring lief wirklich (unter Last, Fäden mit sleep, sind es 79 bis 414 Blöcke; ohne Ring 0)
#if !defined(__SANITIZE_THREAD__)  // unter TSan laufen die Fäden zu langsam, der Ring wird nie fertig: T9 deckt dort den Pfad mit
  // hörbarem Ring NICHT ab (gemessen 0 + 0 Blöcke, task-07b/tsan_box_lebensdauer.txt); TSan prüft nur die Leihe/Rückgabe
  PRUEF(l.hoer_bloecke[0] + l.hoer_bloecke[1] > 20);
#endif
  for (cdj::Loop* x : lebend) delete x;
  ergebnis("lebensdauer");
}

// ------------------------------------------------------------------------------------------ T10
// Kleinste Spitze je Periode (per Samples, gleitend um per/2) in [a, b): Pegeleinbruch eines stehenden Tons
double kleinste_spitze(const std::vector<float>& x, int64_t a, int64_t b, int per) {
  double tief = 1e9;
  for (int64_t p = a; p + per <= b && p + per <= (int64_t)x.size(); p += per / 2) {
    double sp = 0;
    for (int64_t i = p; i < p + per; ++i) sp = std::max(sp, (double)std::fabs(x[(size_t)i]));
    tief = std::min(tief, sp);
  }
  return tief;
}

void test_rampe_tonhoehe() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  struct Fall {
    double von, nach, dauer;
  } faelle[] = {{128.0, 132.0, 8.0}, {130.0, 140.0, 8.0}, {140.0, 128.0, 8.0}, {150.0, 128.0, 8.0}, {130.0, 128.0, 8.0}};
  for (const Fall& f : faelle) {
    Karte k(f.von, 0);
    PRUEF(k.rampe(8.0, f.nach, f.dauer));
    const int64_t n = (int64_t)k.sample_at(8.0 + f.dauer + 6.0);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, lp.get(), false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(n);
    char name[64];
    std::snprintf(name, sizeof name, "T10 Rampe %.0f -> %.0f", f.von, f.nach);
    // Keylock 7b.1 (Entscheidung der Hauptinstanz 08.10.): endet die Rampe auf der Basis, bleibt ein hörbarer Ring hörbar bis
    // zum nächsten Ereignis. Vorher blendete der Ring linear in den Direktweg; R3 hält die Phase eines stehenden Tons nicht
    // (Sinus 416 Hz um rund 150° verschoben), die Blende löschte teilweise aus (kleinste Spitze 0,2719 statt 0,5, ein Fenster
    // −13,99 ct). Gewertet wird jetzt jedes Fenster ab dem Einsatz, das Wechselfenster eingeschlossen.
    const Ton t = ton_messen(l.L[0], l.sample(4.0), n, 416.0);
    ton_drucken(name, t);
    // kein Sprung über den ganzen Lauf (auch am Übergang Direktweg -> Ring, wo die Box bei 128 BPM eingesetzt hat)
    const sprung::Mass m = sprung::messe(l.L[0], l.sample(4.0) + 64, n);
    const double nat = sprung::natuerlich(416.0 * std::max(f.von, f.nach) / 128.0, 0.5);
    std::printf("  %s: größter Sprung %.4f bei %lld (natürlich bis %.4f), Ring hörbar ab %lld\n", name, m.d1, (long long)m.ort1,
                nat, (long long)l.hoer_ab[0]);
    PRUEF(t.ueber == 0 && t.null_laeufe == 0 && t.fenster >= 60);
    PRUEF(m.d1 < 1.5 * nat);
    if (f.nach == 128.0) {  // Pegel um die Basis: kleinste Spitze je Periode vom Ende der Rampe bis zum Laufende
      const int64_t S = std::llround(k.sample_at(8.0 + f.dauer));
      const double tief = kleinste_spitze(l.L[0], S - 4800, n, 116);
      std::printf("  %s: ab Basis %lld: kleinste Spitze je Periode %.4f (Sinus 0,5; Grenze 0,48), Ring hörbar am Ende %d\n",
                  name, (long long)S, tief, (int)l.les().ring_hoerbar());
      if (const char* z = std::getenv("BOX_T10_DUMP")) {  // Diagnose: 19 200 Samples um die Basis, Pfad aus der Umgebung
        if (FILE* fd = std::fopen(z, "wb")) {
          std::fwrite(l.L[0].data() + (S - 9600), sizeof(float), 19200, fd);
          std::fclose(fd);
        }
      }
      PRUEF(tief >= 0.48 && l.les().ring_hoerbar());
    }
  }
  {  // Ereignis auf der Basis bei gehaltenem Ring (Raster mit demselben Versatz): danach Direktweg, bitgleich zur Box ohne Dehner
    Karte k(140.0, 0);
    PRUEF(k.rampe(8.0, 128.0, 8.0));
    const int64_t n = (int64_t)k.sample_at(28.0);
    BoxLauf a(k, n, 1), v(k, n, 0);
    for (BoxLauf* l : {&a, &v}) {
      l->boxen->laden(1, lp.get(), false, 0);
      l->bis(l->sample(2.5) / B * B);
      l->boxen->start(1, l->beat(), l->s);
      l->bis(l->sample(20.0) / B * B);
    }
    const bool vorher = a.les().ring_hoerbar();
    const int64_t s_e = a.s;
    PRUEF(a.boxen->raster(1, 0, a.s) == 0 && v.boxen->raster(1, 0, v.s) == 0);
    a.bis(n);
    v.bis(n);
    const int64_t u = ungleich(a.L[0], v.L[0], s_e + cdj::STRECK_BLENDE, n);
    const double tief = kleinste_spitze(a.L[0], s_e - 4800, s_e + 4800, 116);
    std::printf("  T10 Ereignis auf der Basis bei %lld: Ring vorher hörbar %d, danach %d; ab dem Ende der Blende %lld von %lld "
                "Samples ungleich zur Box ohne Dehner; kleinste Spitze um das Ereignis %.4f (ausgewiesen)\n",
                (long long)s_e, (int)vorher, (int)a.les().ring_hoerbar(), (long long)u, (long long)(n - s_e - cdj::STRECK_BLENDE),
                tief);
    PRUEF(vorher && !a.les().ring_hoerbar() && u == 0);
  }
  ergebnis("rampe_tonhoehe");
}

// ------------------------------------------------------------------------------------------ T11
void test_allokation() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("  T11: übersprungen (Sanitizer-Bau)\n");
    ergebnis("allokation");
    return;
  }
  const Karte k(135.0, 0);
  BoxLauf l(k, (int64_t)k.sample_at(12.0), 1);
  l.boxen->laden(1, lp.get(), false, 0);
  l.bis(l.sample(2.5) / B * B);
  l.boxen->start(1, l.beat(), l.s);
  l.bis(l.sample(6.0) / B * B);  // Rubber Band warm, Ring hörbar
  long block = 0, fuellen = 0;
  for (int j = 0; j < 200; ++j) {
    std::fill(l.ein_l.begin(), l.ein_l.end(), 0.0f);
    cdj::BoxMeldung m[8];
    abfang_an();
    l.boxen->block(l.k, l.s, B, l.el, l.er, m, 8);
    block += abfang_aus();
    l.s += B;
    l.post[0].takt(*l.d[0]);
    abfang_an();
    l.d[0]->fuelle_synchron();
    fuellen += abfang_aus();
  }
  abfang_an();
  void* p = std::malloc(16);
  const long pos = abfang_aus();
  std::free(p);
  // fremde Karte: Keylock für den Block aus, gezählt
  Karte fremd = l.k;
  const uint64_t f0 = l.boxen->keylock_fremd();
  std::fill(l.ein_l.begin(), l.ein_l.end(), 0.0f);
  cdj::BoxMeldung m[8];
  l.boxen->block(fremd, l.s, B, l.el, l.er, m, 8);
  const uint64_t f1 = l.boxen->keylock_fremd();
  std::printf("  T11: Allokationen block %ld, fuelle_synchron %ld (Positiv-Kontrolle malloc: %ld); fremde Karte gezählt %llu\n",
              block, fuellen, pos, (unsigned long long)(f1 - f0));
  PRUEF(block == 0 && fuellen == 0 && pos == 1 && l.les().ring_hoerbar() == false && f1 - f0 == 1);
  ergebnis("allokation");
}

// ------------------------------------------------------------------------------------------ T12
void test_unterlauf() {
  static const std::unique_ptr<cdj::Loop> lp = sinus_loop(1, 416.0);
  const Karte k(135.0, 0);
  const int64_t n = (int64_t)k.sample_at(16.0);
  BoxLauf a(k, n, 1), b(k, n, 0);
  for (BoxLauf* l : {&a, &b}) {
    l->boxen->laden(1, lp.get(), false, 0);
    l->bis(l->sample(2.5) / B * B);
    l->boxen->start(1, l->beat(), l->s);
    l->bis(l->sample(8.0) / B * B);
  }
  PRUEF(a.les().ring_hoerbar());
  a.fuelle = false;  // der Arbeits-Thread setzt aus, bis der Unterlauf da ist, und noch 4 Blöcke (der neue Ansatz liegt
                     // 4096 Samples voraus; länger als 8 Wanderungen der Frist ohne Ring hieße aufgegeben, Vertrag 5)
  int64_t S = -1;
  int danach = 0;
  while (a.s < a.sample(10.0)) {
    const uint64_t u0 = a.les().unterlauf_n();
    const int64_t s0 = a.s;
    a.teil(B);
    b.teil(B);
    if (S < 0 && a.les().unterlauf_n() > u0) S = s0;
    if (S >= 0 && ++danach == 4) a.fuelle = true;
  }
  a.fuelle = true;
  a.bis(n);
  b.bis(n);
  PRUEF(S > 0);
  // Blende über bis zu 960 Frames vom eingefrorenen Ring in den Varispeed-Weg; bitgleich erst ab ihrem Ende
  int64_t gleich_ab = -1;
  for (int64_t t = S; t < S + 2000; ++t)
    if (a.L[0][(size_t)t] == b.L[0][(size_t)t]) {
      bool rest = true;
      for (int64_t u = t; u < S + 4096; ++u)  // bis zum neuen Ansatz (danach Brücke, dann wieder Ring)
        if (a.L[0][(size_t)u] != b.L[0][(size_t)u]) {
          rest = false;
          break;
        }
      if (rest) {
        gleich_ab = t;
        break;
      }
    }
  const km::Sinus ring = km::sinus_einpassen(a.L[0], S - 2000, S, 416.0);
  const std::vector<float>& v = b.L[0];
  const int nb = gleich_ab > S ? (int)(gleich_ab - S) : 960;
  const double bl = blende_abweichung(a.L[0], S, nb, ring, [&](double t) { return (double)v[(size_t)t]; });
  std::printf("  T12: Unterlauf bei %lld, Zähler %llu, hart %llu, bitgleich zum Varispeed ab %lld (+%lld), Blende %.4f, "
              "Ring wieder hörbar ab %lld (hörbar am Ende %d)\n",
              (long long)S, (unsigned long long)a.les().unterlauf_n(), (unsigned long long)a.les().hart_n(),
              (long long)gleich_ab, (long long)(gleich_ab - S), bl, (long long)a.hoer_ab[0], (int)a.les().ring_hoerbar());
  PRUEF(a.les().unterlauf_n() == 1 && a.les().hart_n() == 0);
  PRUEF(gleich_ab > S && gleich_ab - S <= 960 && bl <= 0.02);
  PRUEF(a.les().ring_hoerbar());
  ergebnis("unterlauf");
}

// ------------------------------------------------------------------------------------------ T13
void test_zwei_boxen() {
  static const std::unique_ptr<cdj::Loop> x = sinus_loop(1, 416.0, "x"), y = klick_loop(4, "y"), z = sinus_loop(2, 832.0, "z");
  const Karte k(135.0, 0);
  const int64_t n = (int64_t)k.sample_at(20.0);
  BoxLauf a(k, n, 2), b(k, n, 2);
  for (BoxLauf* l : {&a, &b}) {
    l->boxen->laden(1, x.get(), false, 0);
    l->boxen->laden(2, y.get(), false, 0);
    l->bis(l->sample(2.5) / B * B);
    l->boxen->start(1, l->beat(), l->s);
    l->boxen->start(2, l->beat(), l->s);
  }
  a.bis(a.sample(8.0) / B * B);
  b.bis(b.sample(8.0) / B * B);
  // nur in a, nur Box 1: Laden, Raster, Stopp, Start
  PRUEF(a.boxen->laden(1, z.get(), false, a.s) == nullptr);
  a.bis(a.sample(10.0) / B * B);
  a.boxen->raster(1, 3000, a.s);
  a.bis(a.sample(12.0) / B * B);
  a.boxen->stopp(1, a.beat(), a.s);
  a.bis(a.sample(14.5) / B * B);
  a.boxen->start(1, a.beat(), a.s);
  a.bis(n);
  b.bis(n);
  const int64_t u = ungleich(a.L[1], b.L[1], 0, n), u1 = ungleich(a.L[0], b.L[0], 0, n);
  std::printf("  T13: Box 2 %lld ungleich, Box 1 %lld ungleich (Positiv: die Ereignisse wirken)\n", (long long)u,
              (long long)u1);
  PRUEF(u == 0 && u1 > 0);
  while (a.boxen->abholen()) {
  }
  ergebnis("zwei_boxen");
}

// ------------------------------------------------------------------------------------------ T14
void test_leihe_voll() {
  const Karte k(135.0, 0);
  std::unique_ptr<cdj::Loop> L[6];
  for (int i = 0; i < 6; ++i) {
    char nm[8];
    std::snprintf(nm, sizeof nm, "l%d", i);
    L[i] = sinus_loop(1, 416.0 * (1 + i % 2), nm);
  }
  for (int art = 0; art < 2; ++art) {  // 0 ohne Quittung, 1 Positiv-Kontrolle mit Quittung nach jedem Block
    BoxLauf l(k, (int64_t)k.sample_at(16.0), 1);
    l.boxen->laden(1, L[0].get(), false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(l.sample(8.0) / B * B);
    PRUEF(l.les().ring_hoerbar());
    if (art == 0) l.takt = l.fuelle = false;
    std::vector<const cdj::Loop*> raus;
    int max_warten = 0;
    int64_t abgeholt_bei[6] = {-1, -1, -1, -1, -1, -1};
    int ueber[6] = {};
    for (int i = 1; i <= 5; ++i) {
      PRUEF(l.boxen->laden(1, L[i].get(), false, l.s) == nullptr);
      // Übernahme im nächsten Block; läuft noch eine Ladeblende der Box (der Ring war nicht beteiligt), danach
      for (int j = 0; j < 12 && l.boxen->loop(1) != L[i].get(); ++j) l.teil(B);
      PRUEF(l.boxen->loop(1) == L[i].get());
      ueber[i] = l.bloecke;
      while (const cdj::Loop* q = l.boxen->abholen()) {
        raus.push_back(q);
        for (int j = 0; j < 6; ++j)
          if (q == L[j].get()) abgeholt_bei[j] = l.bloecke;
      }
    }
    for (int j = 0; j < 4; ++j) {
      l.teil(B);
      while (const cdj::Loop* q = l.boxen->abholen()) {
        raus.push_back(q);
        for (int m = 0; m < 6; ++m)
          if (q == L[m].get()) abgeholt_bei[m] = l.bloecke;
      }
    }
    const size_t raus_ohne = raus.size();
    if (art == 0) {
      l.takt = l.fuelle = true;
      for (int j = 0; j < 40; ++j) {
        l.teil(B);
        while (const cdj::Loop* q = l.boxen->abholen()) raus.push_back(q);
      }
    }
    for (int j = 1; j < 6; ++j)
      if (abgeholt_bei[j - 1] >= 0) max_warten = std::max(max_warten, (int)(abgeholt_bei[j - 1] - ueber[j]));
    int je[6] = {};
    for (const cdj::Loop* q : raus)
      for (int m = 0; m < 6; ++m)
        if (q == L[m].get()) ++je[m];
    std::printf("  T14 %s: kein Platz %llu, ohne Quittung abgeholt %zu, danach gesamt %zu (je Loop %d %d %d %d %d %d), "
                "frei_verloren %d, längstes Warten %d Blöcke\n",
                art ? "mit Quittung" : "ohne Quittung", (unsigned long long)l.boxen->keylock_kein_platz(1), raus_ohne,
                raus.size(), je[0], je[1], je[2], je[3], je[4], je[5], l.boxen->abholen_verloren(), max_warten);
    if (art == 0) {
      PRUEF(l.boxen->keylock_kein_platz(1) == 2);
      bool l0_3 = false;  // abgeholt, während nichts quittiert wurde: keiner der verliehenen L0 bis L3
      for (size_t i = 0; i < raus_ohne; ++i)
        for (int m = 0; m < 4; ++m) l0_3 = l0_3 || raus[i] == L[m].get();
      PRUEF(!l0_3);
      PRUEF(je[0] == 1 && je[1] == 1 && je[2] == 1 && je[3] == 1 && je[4] == 1 && je[5] == 0);
    } else {
      // spätestens nach der Ladeblende der Box (960 Frames, knapp 4 Blöcke: in der Brücke ist der Ring nicht beteiligt) und
      // einer Quittung (Planwert „2 Blöcke“ war ungemessen, [H])
      PRUEF(l.boxen->keylock_kein_platz(1) == 0 && max_warten <= 5);
    }
    PRUEF(l.boxen->abholen_verloren() == 0);
  }
  ergebnis("leihe_voll");
}

// ------------------------------------------------------------------------------------------ T15
// Netz-Rolle mit Heap-Loops: ein zurückgegebener Loop wird erst gelöscht, wenn er herauskommt; in der Zwischenzeit liest
// der Test ihn über einen zweiten Dehner weiter und prüft ihn gegen die Referenz (unter ASan zusätzlich kein Fund).
bool band_lesbar(const cdj::Loop* q, const std::vector<float>& ref) {
  cdj::BoxBand bb;
  bb.loop = q;
  std::vector<float> l(4096), r(4096);
  bb.band(0, 4096, l.data(), r.data());
  for (int i = 0; i < 4096; ++i)
    if (l[(size_t)i] != ref[(size_t)(2 * (i % q->frames))]) return false;
  return true;
}

void test_laden_leihe() {
  const Karte k(135.0, 0);
  auto lauf = [&](const char* name, int fall) {
    BoxLauf l(k, (int64_t)k.sample_at(12.0), 1);
    cdj::Loop* alt = sinus_loop(1, 416.0, "alt").release();
    cdj::Loop* neu = sinus_loop(1, 832.0, "neu").release();
    const std::vector<float> ref = alt->daten;
    l.boxen->laden(1, alt, false, 0);
    l.bis(l.sample(2.5) / B * B);
    const cdj::Loop* r = nullptr;
    if (fall == 0) {  // a) wartet, Ansatz mit Vorlauf, der Leser hat gelesen
      l.boxen->start(1, 8.0, l.s);
      for (int j = 0; j < 8; ++j) l.teil(B);
      PRUEF(l.boxen->status(1) == cdj::BoxStatus::wartet);
      l.takt = l.fuelle = false;
      r = l.boxen->laden(1, neu, false, l.s);
    } else if (fall == 1) {  // b) gerade nach zu_ende: bereit, Leer-Epoche nicht quittiert
      l.boxen->start(1, l.beat(), l.s);
      l.bis(l.sample(6.0) / B * B);
      l.boxen->stopp(1, l.beat(), l.s);
      while (l.boxen->status(1) != cdj::BoxStatus::bereit) {
        if (l.s + 2 * B >= l.sample(8.0)) l.takt = l.fuelle = false;
        l.teil(B);
      }
      l.takt = l.fuelle = false;
      r = l.boxen->laden(1, neu, false, l.s);
    } else {  // c) Entladen aus laeuft (2), wartet (3), bereit (4)
      if (fall == 2 || fall == 4) {
        l.boxen->start(1, l.beat(), l.s);
        l.bis(l.sample(6.0) / B * B);
      }
      if (fall == 3) {
        l.boxen->start(1, 8.0, l.s);
        for (int j = 0; j < 8; ++j) l.teil(B);
      }
      if (fall == 4) {  // wie b: die Leer-Epoche des Endes ist noch nicht quittiert
        l.boxen->stopp(1, l.beat(), l.s);
        while (l.boxen->status(1) != cdj::BoxStatus::bereit) {
          if (l.s + 2 * B >= l.sample(8.0)) l.takt = l.fuelle = false;
          l.teil(B);
        }
      }
      l.takt = l.fuelle = false;
      r = l.boxen->laden(1, nullptr, false, l.s);
    }
    // Keylock 7b.4 (Prüfung n1): was laden() oder abholen() herausgibt, gibt der Kern frei. Der Test spielt das nach, indem
    // er den herausgegebenen Loop sofort mit NaN überschreibt (Speicher bleibt gültig, kein UB). Liest danach etwas den alten
    // Loop (band_lesbar wie der Dehner über BoxBand), wird `lesbar` rot. `ohne_nan` (die Ausgabe der Box danach) ist eine
    // Wache: der Dehner liest das alte Band nach der neuen Epoche nicht mehr, sie wird auch unter der Mutation nicht rot. Vorher konnte `lesbar` nicht rot werden: niemand löschte `alt` vor abholen().
    auto freigeben = [&](const cdj::Loop* x) {
      auto* m = const_cast<cdj::Loop*>(x);
      std::fill(m->daten.begin(), m->daten.end(), std::numeric_limits<float>::quiet_NaN());
    };
    if (r) freigeben(r);
    bool zwischen = r == nullptr, lesbar = true;
    for (int j = 0; j < 6; ++j) {
      l.teil(B);
      if (const cdj::Loop* x = l.boxen->abholen()) {
        zwischen = false;
        freigeben(x);
      }
      lesbar = lesbar && band_lesbar(alt, ref);
    }
    l.takt = l.fuelle = true;
    int heraus = 0;
    const int64_t s_nach = l.s;
    std::vector<const cdj::Loop*> frei;
    for (int j = 0; j < 40; ++j) {
      l.teil(B);
      while (const cdj::Loop* x = l.boxen->abholen()) {
        if (x == alt) ++heraus;
        frei.push_back(x);
      }
    }
    bool ohne_nan = true;
    for (int64_t t = s_nach; t < l.s && t < (int64_t)l.L[0].size(); ++t) ohne_nan = ohne_nan && !std::isnan(l.L[0][(size_t)t]);
    for (const cdj::Loop* x : frei) delete x;
    if (r) delete r;
    std::printf("  T15%s: Rückgabe %s, ohne Quittung nichts heraus %d, alter Loop lesbar %d, Ausgabe danach ohne NaN %d, nach "
                "Quittung %d Mal heraus\n",
                name, r ? "der alte Loop" : "nullptr", (int)zwischen, (int)lesbar, (int)ohne_nan, heraus);
    PRUEF(r == nullptr);
    PRUEF(zwischen);
    PRUEF(lesbar);  // Mutation BOX_LADEN_DIREKT: der herausgegebene (überschriebene) Loop ist nicht mehr lesbar
    PRUEF(ohne_nan);  // Wache ohne gezeigten Fehlerweg: unter BOX_LADEN_DIREKT bleibt sie 1 (Nachprüfung 7b N6), rot wird `lesbar`
    PRUEF(heraus == 1);
    if (l.boxen->loop(1) == neu) {
      delete l.boxen->laden(1, nullptr, false, l.s);  // nicht verliehen: direkt zurück
      for (int j = 0; j < 40; ++j) {
        l.teil(B);
        while (const cdj::Loop* x = l.boxen->abholen()) delete x;
      }
    } else {
      delete neu;
    }
  };
  lauf("a (wartet)", 0);
  lauf("b (gerade zu Ende)", 1);
  lauf("c (Entladen aus laeuft)", 2);
  lauf("c (Entladen aus wartet)", 3);
  lauf("c (Entladen aus bereit)", 4);
  {  // d) Übernahme eines wartenden Loops (F13), danach Laden: der abgelöste kommt erst nach der Quittung
    BoxLauf l(k, (int64_t)k.sample_at(12.0), 1);
    cdj::Loop* a = sinus_loop(1, 416.0, "a").release();
    cdj::Loop* b = sinus_loop(1, 832.0, "b").release();
    cdj::Loop* c = sinus_loop(1, 624.0, "c").release();
    l.boxen->laden(1, a, false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(l.sample(7.0) / B * B);
    l.takt = l.fuelle = false;
    PRUEF(l.boxen->laden(1, b, false, l.s) == nullptr);
    l.teil(B);
    PRUEF(l.boxen->loop(1) == b);
    PRUEF(l.boxen->laden(1, c, false, l.s) == nullptr);
    l.teil(B);
    bool zwischen = true;
    for (int j = 0; j < 4; ++j) {
      l.teil(B);
      zwischen = zwischen && l.boxen->abholen() == nullptr;
    }
    l.takt = l.fuelle = true;
    int ha = 0, hb = 0;
    for (int j = 0; j < 40; ++j) {
      l.teil(B);
      while (const cdj::Loop* x = l.boxen->abholen()) {
        ha += x == a;
        hb += x == b;
        delete x;
      }
    }
    std::printf("  T15d: ohne Quittung nichts heraus %d, nach Quittung a %d, b %d\n", (int)zwischen, ha, hb);
    PRUEF(zwischen && ha == 1 && hb == 1);
    delete l.boxen->laden(1, nullptr, false, l.s);
    for (int j = 0; j < 40; ++j) {
      l.teil(B);
      while (const cdj::Loop* x = l.boxen->abholen()) delete x;
    }
  }
  {  // Negativ-Kontrolle: ohne Dehner gibt laden den Loop sofort zurück (Welle-2-Verhalten)
    BoxLauf l(k, 4 * B, 0);
    static const std::unique_ptr<cdj::Loop> a = sinus_loop(1, 416.0), b = sinus_loop(1, 832.0);
    l.boxen->laden(1, a.get(), false, 0);
    PRUEF(l.boxen->laden(1, b.get(), false, 0) == a.get());
  }
  ergebnis("laden_leihe");
}

// ------------------------------------------------------------------------------------------ T16
void test_einfrieren_in_bruecke() {
  static const std::unique_ptr<cdj::Loop> a = sinus_loop(1, 416.0, "a"), b = sinus_loop(1, 832.0, "b");
  const Karte k(135.0, 0);
  for (int fall = 0; fall < 3; ++fall) {
    const int64_t n = (int64_t)k.sample_at(14.0);
    BoxLauf l(k, n, 1);
    l.boxen->laden(1, a.get(), false, 0);
    l.bis(l.sample(4.0) / B * B);
    l.boxen->start(1, l.beat(), l.s);  // auf der Eins: Brücke, dann Blende Varispeed -> Ring
    while (!l.les().blendet() && l.s < n) l.teil(B);
    PRUEF(l.les().blendet());
    l.teil(B);  // mitten in der Blende
    const int64_t S = l.s;
    if (fall == 0) PRUEF(l.boxen->laden(1, b.get(), false, S) == nullptr);
    if (fall == 1) l.boxen->raster(1, 4000, S);
    if (fall == 2) l.boxen->keylock(false, S);
    l.bis(n);
    const sprung::Mass m = sprung::messe(l.L[0], S - 8, S + 1200);
    const double nat = sprung::natuerlich(832.0 * 135.0 / 128.0, 0.5);
    std::printf("  T16 %s: hart %llu, größter Sprung %.4f bei %lld (Ereignis %lld, natürlich bis %.4f)\n",
                fall == 0 ? "Laden" : fall == 1 ? "Raster" : "Schalter aus", (unsigned long long)l.les().hart_n(), m.d1,
                (long long)m.ort1, (long long)S, nat);
    PRUEF(l.les().hart_n() == 0 && m.d1 < 1.5 * nat);
    while (l.boxen->abholen()) {
    }
  }
  ergebnis("einfrieren_in_bruecke");
}

// ------------------------------------------------------------------------------------------ T17
void test_dehner_spaet() {
  static const std::unique_ptr<cdj::Loop> a = sinus_loop(1, 416.0);
  const Karte k(135.0, 0);
  {  // laufende Box: Ansatz am nächsten Blockanfang, Brücke, danach Ring
    const int64_t n = (int64_t)k.sample_at(14.0);
    BoxLauf l(k, n, 0);
    l.boxen->laden(1, a.get(), false, 0);
    l.bis(l.sample(2.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(l.sample(8.0) / B * B);
    const int64_t S = l.s;
    l.dehner_an(1);
    l.bis(n);
    const int64_t ab = l.les().s_h() < n ? l.les().s_h() + cdj::STRECK_EINSCHWING + 960 : n;  // ohne Ansatz: kein Fenster
    const Ton t = ton_messen(l.L[0], ab, n, 416.0);
    std::printf("  T17 laufend: angehängt bei %lld, Ansatz s_h %lld, Ring hörbar ab %lld\n", (long long)S,
                (long long)l.les().s_h(), (long long)l.hoer_ab[0]);
    ton_drucken("T17 Ton", t);
    PRUEF(l.hoer_ab[0] > S && l.les().s_h() == S + cdj::ANSATZ_FRIST && t.ueber == 0);
  }
  {  // wartende Box: Ansatz mit Vorlauf
    const int64_t n = (int64_t)k.sample_at(14.0);
    BoxLauf l(k, n, 0);
    l.boxen->laden(1, a.get(), false, 0);
    l.bis(l.sample(8.5) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    l.bis(l.sample(9.0) / B * B);
    l.dehner_an(1);
    l.bis(n);
    const int64_t e = l.sample(12.0);
    const double ct = 1200.0 * std::log2(km::freq(l.L[0], e, e + 4800) / 416.0);
    PRUEF(l.les().s_h() < n);
    std::printf("  T17 wartend: s_h %lld, Einsatz %lld, erstes Fenster %+.3f ct\n", (long long)l.les().s_h(), (long long)e,
                ct);
    PRUEF(l.les().s_h() + cdj::STRECK_EINSCHWING <= e && std::fabs(ct) <= 2.0);
  }
  ergebnis("dehner_spaet");
}

// ------------------------------------------------------------------------------------------ Hörprobe (Step 10, kein Test)
// Box 1 offline (Dehner synchron) als WAV (float32, Stereo, 48 kHz) für Andreas' Hörprobe; nichts geht an eine Ausgabe.
// Aufruf: test_loopbox_keylock hoerprobe ZIELORDNER LOOP_A LOOP_B (Ordner mit loop.json/loop.f32, nur gelesen)
void wav_schreiben(const std::string& pfad, const std::vector<float>& l, const std::vector<float>& r, int64_t von, int64_t bis) {
  FILE* f = std::fopen(pfad.c_str(), "wb");
  if (!f) return;
  const uint32_t n = (uint32_t)(bis - von), daten = n * 8;
  auto u32 = [&](uint32_t x) { std::fwrite(&x, 4, 1, f); };
  auto u16 = [&](uint16_t x) { std::fwrite(&x, 2, 1, f); };
  std::fwrite("RIFF", 1, 4, f);
  u32(36 + daten);
  std::fwrite("WAVEfmt ", 1, 8, f);
  u32(16);
  u16(3);  // IEEE float
  u16(2);
  u32(48000);
  u32(48000 * 8);
  u16(8);
  u16(32);
  std::fwrite("data", 1, 4, f);
  u32(daten);
  for (int64_t i = von; i < bis; ++i) {
    const float x[2] = {l[(size_t)i], r[(size_t)i]};
    std::fwrite(x, 4, 2, f);
  }
  std::fclose(f);
}

void hoerprobe(const std::string& ziel, const std::string& pa, const std::string& pb) {
  std::string fehler;
  std::unique_ptr<cdj::Loop> a = cdj::lade_loop(pa, &fehler), b = cdj::lade_loop(pb, &fehler);
  if (!a || !b) {
    std::printf("hoerprobe: %s\n", fehler.c_str());
    return;
  }
  struct Fall {
    const char* name;
    double bpm;
    int art;  // 0 fest, 1 fest Keylock aus, 2 Laden in klingende Box, 3 Start 50 ms vor der Eins, 4 Rampe 128 -> 140
  } faelle[] = {{"1_box_135_keylock_an", 135.0, 0},
                {"2_box_135_keylock_aus_varispeed", 135.0, 1},
                {"3_laden_klingend_135", 135.0, 2},
                {"4_start_50ms_vor_der_eins_135", 135.0, 3},
                {"5_rampe_128_140_keylock_an", 128.0, 4}};
  for (const Fall& f : faelle) {
    Karte k(f.bpm, 0);
    if (f.art == 4) k.rampe(8.0, 140.0, 8.0);
    const int64_t n = (int64_t)k.sample_at(24.0);
    BoxLauf l(k, n, 1);
    l.R1.assign((size_t)n, 0.0f);
    l.boxen->laden(1, a.get(), false, 0);
    if (f.art == 1) l.boxen->keylock(false, 0);
    const double start_beat = f.art == 3 ? 4.0 - 0.05 * f.bpm / 60.0 : 2.5;
    l.bis(l.sample(start_beat) / B * B);
    l.boxen->start(1, l.beat(), l.s);
    if (f.art == 2) {
      l.bis(l.sample(12.0) / B * B);
      (void)l.boxen->laden(1, b.get(), false, l.s);
    }
    l.bis(n);
    while (l.boxen->abholen()) {
    }
    const std::string p = ziel + "/" + f.name + ".wav";
    wav_schreiben(p, l.L[0], l.R1, l.sample(2.0), n);
    std::printf("hoerprobe: %s (%.1f s, Ring hörbar ab Sample %lld)\n", p.c_str(), (double)(n - l.sample(2.0)) / 48000.0,
                (long long)l.hoer_ab[0]);
  }
}


// ------------------------------------------------------------------------------------------ T20 (Keylock 6a Fix-Runde 2)
// Entscheid der Hauptinstanz 09.10. (wie das Deck, test_deck_geplant band_scan): Start aus Stille nur, wenn die volle Vorlage passt
// (s_h = E − STRECK_EINSCHWING − BOX_VORLAGE); darunter der frühe Ansatz ohne still. Vorlauf V vom Start-Befehl bis zum Einsatz E
// (Takt-Eins Beat 12) 5505 bis 6271 in 16er-Schritten, 60/80/100 BPM, Klick-Loop (4 Beats) und Sinus 416 Hz (1 Beat). Größter
// Nachbarsprung in [E − 900, E + 300) ≤ T18 (0,1089), kein Start aus Stille im Band. Stand 4c275c66 (still auch mit verkürzter
// Vorlage): 80 BPM Klick bis 0,4889 (~/messungen/2026-10-08-task6/6a/fix2/box_band.txt).
void test_band_scan() {
  static const std::unique_ptr<cdj::Loop> klick = klick_loop(4);
  static const std::unique_ptr<cdj::Loop> sin1 = sinus_loop(1, 416.0);
  for (const double bpm : {60.0, 80.0, 100.0})
    for (int art = 0; art < 2; ++art) {
      const Karte k(bpm, 0);
      const int64_t e = std::llround(k.sample_at(12.0));
      double mx = 0;
      int64_t vmx = 0, omx = 0;
      int n = 0, ueber = 0, still = 0;
      for (int64_t v = 5505; v <= 6271; v += 16) {
        BoxLauf l(k, e + 2000, 1);
        l.boxen->laden(1, art ? sin1.get() : klick.get(), false, 0);
        const int64_t s0 = e - v;
        l.bis(s0 / B * B);
        if (l.s < s0) l.teil((int)(s0 - l.s));
        l.boxen->start(1, l.k.beat_at((double)l.s), l.s);
        l.bis(e + 2000);
        if (l.les().s_h() + cdj::STRECK_EINSCHWING <= e && l.hoer_ab[0] >= 0 && l.hoer_ab[0] <= e) ++still;  // Ring vor dem Einsatz
        double sp = 0;
        int64_t o = 0;
        for (int64_t t = e - 900; t < e + 300; ++t) {
          const double d = std::fabs((double)l.L[0][(size_t)t] - (double)l.L[0][(size_t)t - 1]);
          if (d > sp) sp = d, o = t;
        }
        ++n;
        if (sp > 2.0 * sprung::natuerlich(832.0, 0.5)) ++ueber;
        if (sp > mx) mx = sp, vmx = v, omx = o - e;
      }
      std::printf("  T20 %3.0f BPM %-5s V 5505..6271/16 (%d Läufe): Ring vor dem Einsatz %d, größter Sprung %.4f bei V %lld (E%+lld), über T18 %d\n",
                  bpm, art ? "Sinus" : "Klick", n, still, mx, (long long)vmx, (long long)omx, ueber);
      PRUEF(ueber == 0 && still == 0);
    }
  ergebnis("band_scan");
}

}  // namespace

int main(int argc, char** argv) {
  const std::string nur = argc > 1 ? argv[1] : "";
  if (nur == "einmessen") {
    abschnitt0_einmessen();
    return 0;
  }
  if (nur == "hoerprobe" && argc > 4) {
    hoerprobe(argv[2], argv[3], argv[4]);
    return 0;
  }
  if (nur == "lage_nach_rampe" && argc > 3) {
    diag_lage_nach_rampe(std::atof(argv[2]), std::atof(argv[3]));
    return 0;
  }
  if ((nur == "einmessen_roh" || nur == "einmessen_rest") && argc > 2) {
    abschnitt0_punkte(argv[2], nur == "einmessen_roh");
    return 0;
  }
  struct T {
    const char* name;
    void (*f)();
  };
#if defined(__SANITIZE_THREAD__)
  constexpr int N9 = 300;
#else
  constexpr int N9 = 2000;
#endif
  static const T tests[] = {
      {"leser_ansetzen_ab", test_leser_ansetzen_ab}, {"leser_aus_stille", test_leser_aus_stille},
      {"leser_leistung", test_leser_leistung},       {"leser_ring_lesen", test_leser_ring_lesen},
      {"basis_bitgleich", test_basis_bitgleich},     {"tonhoehe_fest", test_tonhoehe_fest},
      {"naht_wickeln", test_naht_wickeln},           {"einsatz_aus_stille", test_einsatz_aus_stille},
      {"lage", test_lage},                           {"laden_klingend", test_laden_klingend},
      {"set_neu_schwanz", test_set_neu_schwanz},     {"aus_ist_varispeed", test_aus_ist_varispeed},
      {"lebensdauer", [] { test_lebensdauer(N9); }}, {"rampe_tonhoehe", test_rampe_tonhoehe},
      {"allokation", test_allokation},               {"unterlauf", test_unterlauf},
      {"zwei_boxen", test_zwei_boxen},               {"leihe_voll", test_leihe_voll},
      {"laden_leihe", test_laden_leihe},             {"einfrieren_in_bruecke", test_einfrieren_in_bruecke},
      {"dehner_spaet", test_dehner_spaet},           {"ereignis_in_vorlage", test_ereignis_in_vorlage},
      {"raster_wartend", test_raster_wartend},       {"basis_knopf_blende", test_basis_knopf_blende},
      {"band_scan", test_band_scan},
  };
  bool gefunden = nur.empty();
  for (const T& t : tests)
    if (nur.empty() || nur == t.name) {
      gefunden = true;
      t.f();
    }
  if (!gefunden) {
    std::printf("unbekannter Test %s\n", nur.c_str());
    return 2;
  }
  std::printf("%s\n", pruef_fehler == 0 ? "alle Pruefungen gruen" : "FEHLER");
  return pruef_fehler == 0 ? 0 : 1;
}
