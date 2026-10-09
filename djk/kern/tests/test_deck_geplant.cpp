// Keylock Task 6, Stufe 6a (Plan docs/superpowers/plans/2026-10-06-keylock-echtzeit.md, Detailschnitt 6a Abschnitt 3.8):
// Start aus dem Stand, geplant. Dehner synchron wie test_deck_keylock (der Test spielt den Callback je 256er-Block, danach
// Vorbereiter und Arbeits-Thread). Messgrößen: keylock_mess.h, sprungmass.h.
//
// Aufruf ohne Argument: alle Tests; mit Namen nur einer.
//   6a-1 band_bitgleich   DeckBand::band (deck_lies herausgelöst, still_bis neu) und Deck::block mit Keylock bitgleich zum
//                         Stand vor 6a (Prüfsummen wie test_deck_keylock Test 34, aufgenommen am Stand 82106bec)
//   6a-1 band_still       still_bis: Quellframes davor Stille, ab dort bitgleich zum Band ohne still_bis; Kopie trägt den Wert
//   6a-3 start_stand, ohne_kerbe, rampe_wartezeit, ereignis_in_vorlage, raster_wartend (P4a bis P4e), negativ, faeden, kern (K6a)
//   Fix-Runde 1: stopp_dann_plan (F1/Q1), fruehansatz (F3), ziel_ohne_start und kern_abbruch (Q2/Q3), allokation (Q4);
//   negativ mit Vorlauf 4096/4097 (F3) und Faktor 52/128 (F4), ereignis_in_vorlage mit Grenze 0,0408 (F2)
//   Fix-Runde 2: band_scan (F3-R1), restzone (Q2-R1), knopf_vorlage (Doppel-1), rampe_bremst (Rampe-1), kern_hand_stopp und
//   ziel_ohne_start_tempi (Q2-1, Test-1, Q3-N1); allokation mit frühem Ansatz und Selbstfall (Test-2); negativ 59,5 BPM (F4-N1)
//   diag_ct BPM: Diagnose, nicht Teil der Suite
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <unistd.h>
#include <limits>
#include <memory>
#include <random>
#include <thread>
#include <atomic>
#include <chrono>
#include <vector>

#include "keylock_mess.h"
#include "sprungmass.h"
#include "cypherdj/deck.h"
#include "cypherdj/kern.h"
#include "hand/mapping.h"
#include "cypherdj/dehner.h"
#include "cypherdj/streck_quelle.h"
#include "pruef.h"
// zuletzt: Rubber Band bindet mm_malloc.h (posix_memalign ohne noexcept), der Abfang definiert es danach
#include "alloc_abfang.h"

namespace {

using cdj::DehnerAnker;
using cdj::Karte;
using km::B;

int test_fehler_vorher = 0;
void ergebnis(const char* name) {
  std::printf("TEST %s: %s\n", name, pruef_fehler == test_fehler_vorher ? "gruen" : "ROT");
  std::fflush(stdout);
  test_fehler_vorher = pruef_fehler;
}

uint64_t fnv(uint64_t h, const float* x, size_t n) {
  for (size_t i = 0; i < n; ++i) {
    uint32_t u;
    std::memcpy(&u, &x[i], 4);
    for (int k = 0; k < 4; ++k) h = (h ^ ((u >> (8 * k)) & 0xff)) * 1099511628211ull;
  }
  return h;
}
constexpr uint64_t FNV0 = 14695981039346656037ull;

// Rauschen in zwei Stems (Basis basis, frames Frames), Gewichte vom Deck; der zweite Stem leiser
struct MatRauschen {
  std::vector<float> d[2];
  cdj::Material m{};
  MatRauschen(double basis, int64_t frames, uint32_t saat = 3) {
    std::snprintf(m.material_id, sizeof m.material_id, "%s", "c1c0000000000641");
    m.basis_bpm = basis;
    m.fassung = 1;
    m.n_quellen = 2;
    m.mit_stems = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    std::mt19937 g(saat);
    std::normal_distribution<float> nd(0.0f, 0.2f);
    for (int k = 0; k < 2; ++k) {
      d[k].resize((size_t)(2 * frames));
      for (float& x : d[k]) x = nd(g) * (k ? 0.5f : 1.0f);
      m.quelle[k] = d[k].data();
    }
  }
};

// Ein Deck mit eigenem Dehner, synchron gefahren (wie test_deck_keylock DeckLauf). Ausgabe je Kern-Sample. Dazu der Planer des
// Kerns (kern_deck.cpp deck_planen) im Kleinen: ab plan.ab je Blockanfang kl_plane_start für den Start bei Master-Beat plan.b
// (Einsatz-Sample aus der Karte, je Block neu wie im Kern), bis das Deck läuft.
struct DeckLauf {
  Karte k;
  uint32_t gen = 1;
  std::unique_ptr<cdj::DehnerBasis> d;
  cdj::StreckPost post;
  cdj::Deck deck;
  std::vector<float> L, R;
  int64_t s = 0;
  bool takt = true;    // false: der Vorbereiter setzt aus
  bool fuelle = true;  // false: der Arbeits-Thread setzt aus (keine Quittung)
  struct Faktor {
    uint32_t e;
    int64_t gb;
    double f;
  };
  std::vector<Faktor> fk;
  struct Plan {
    bool an = false;
    int64_t ab = 0;  // ab diesem Sample planen (Vorlauf)
    double b = 0.0;  // Master-Beat des Einsatzes
    int64_t f = 0;   // Startframe
    uint64_t schluessel = 1;
  } plan;
  int64_t hoer_ab = -1;  // erstes Sample (Blockanfang), an dem der Ring hörbar war
  DeckLauf(const Karte& karte, int64_t laenge, bool mit_dehner = true) : k(karte), L((size_t)laenge, 0.0f), R((size_t)laenge, 0.0f) {
    deck.setze_karte(&k, &gen);
    if (mit_dehner) {
      d = cdj::dehner_neu(1);
      deck.setze_keylock(d.get(), &post);
    }
  }
  int64_t s_t() const { return std::llround(k.sample_at(plan.b)); }
  void pumpe() {
    if (!d) return;
    if (takt) post.takt(*d);
    if (fuelle) d->fuelle_synchron();
    fk.push_back({d->quittiert_e(), d->geschrieben_bis(), d->faktor_gesetzt()});
  }
  void teil(int n) {
    if (plan.an && s >= plan.ab && !deck.laeuft()) deck.kl_plane_start(s, s_t(), plan.b, plan.f, plan.schluessel);
    float l[1024] = {}, r[1024] = {};
    deck.block(s, n, l, r, 0);
    for (int i = 0; i < n; ++i)
      if (s + i < (int64_t)L.size()) {
        L[(size_t)(s + i)] = l[i];
        R[(size_t)(s + i)] = r[i];
      }
    if (hoer_ab < 0 && deck.keylock_ring_hoerbar()) hoer_ab = s;
    s += n;
    pumpe();
  }
  void bis(int64_t ende) {
    while (s < ende) teil((int)std::min<int64_t>(B, ende - s));
  }
  // bis genau zum Sample x (Teilblock, wie decks_block am Ziel einer Aktion)
  void genau(int64_t x) {
    bis(x / B * B);
    if (s < x) teil((int)(x - s));
  }
  // bis zum Einsatz (Blöcke wie im Kern am Sample geteilt), dort Deck::start mit dem Schlüssel des Plans
  void start_am_ziel() {
    const int64_t e = s_t();
    genau(e);
    deck.start(e, plan.f, false, plan.schluessel);
    plan.an = false;
  }
  // Faktorfolge je 43er-Fenster der Epoche e ab s_h (wie test_deck_keylock DeckLauf::faktoren)
  std::vector<double> faktoren(uint32_t e, int64_t s_h) const {
    std::vector<double> f;
    for (const Faktor& x : fk) {
      if (x.e != e || x.gb <= s_h) continue;
      const size_t w = (size_t)((x.gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, x.f);
      f[w] = x.f;
    }
    return f;
  }
};

// Sinus hz Hz (Amplitude amp) über frames Frames, Basis 128, erster Schlag Frame 0
struct MatSinus {
  std::vector<float> d;
  cdj::Material m{};
  MatSinus(double hz, int64_t frames, float amp = 0.5f, const char* id = "c1c0000000000642") {
    std::snprintf(m.material_id, sizeof m.material_id, "%s", id);
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.resize((size_t)(2 * frames));
    for (int64_t f = 0; f < frames; ++f)
      d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(amp * std::sin(2 * km::PI * hz * (double)f / 48000.0));
    m.quelle[0] = d.data();
  }
};

// ------------------------------------------------------------------------------------------ 6a-1 band_bitgleich
// Band über eine Folge von Lesestücken (Länge und Anfang wechselnd, auch vor 0 und hinter dem Ende), Prüfsumme über l und r.
uint64_t band_folge(const cdj::DeckBand& b, int64_t von, int64_t bis) {
  static const int laengen[] = {1, 7, 256, 1000, 4096, 333};
  std::vector<float> l(4096), r(4096);
  uint64_t h = FNV0;
  int j = 0;
  for (int64_t p = von; p < bis; ++j) {
    const int n = (int)std::min<int64_t>(laengen[j % 6], bis - p);
    b.band(p, n, l.data(), r.data());
    h = fnv(fnv(h, l.data(), (size_t)n), r.data(), (size_t)n);
    p += n;
  }
  return h;
}

void test_band_bitgleich() {
  // a) DeckBand::band: Basis 125,3 (gebrochene Beatlänge), zwei Stems mit Gewichten 0,7 / 0,3; ohne Loop, Loop 4 Beats
  //    (exakte Länge gebrochen), 1 Beat, 1/4 Beat, und Loop mit ganzzahliger Länge ohne loop_lx (Stand Task 5)
  static MatRauschen mr(125.3, 400000);
  std::atomic<float> g[cdj::STEM_ANZAHL] = {0.7f, 0.3f, 1.0f, 1.0f};
  const double fpb = cdj::FRAMES_JE_MINUTE / 125.3;
  struct Fall {
    int64_t a;
    int64_t l;
    double lx;
  } faelle[] = {{0, 0, 0.0},
                {60000, std::llround(4 * fpb), 4 * fpb},
                {60000, std::llround(fpb), fpb},
                {60000, std::llround(0.25 * fpb), 0.25 * fpb},
                {60000, 22500, 0.0}};
  uint64_t h[6] = {};
  for (int i = 0; i < 5; ++i) {
    cdj::DeckBand b;
    b.m = &mr.m;
    b.g = g;
    b.loop_a = faelle[i].a;
    b.loop_l = faelle[i].l;
    b.loop_lx = faelle[i].lx;
    h[i] = band_folge(b, -5000, faelle[i].l ? 60000 + 12 * faelle[i].l : 405000);
  }
  // b) Deck::block mit Keylock, Basis 128, Karte 132: Start aus dem Stand (heutiger Weg, Brücke), Loop 4 Beats an, Sprung im
  //    Loop, Loop aus, Stopp; Ausgabe links und rechts
  {
    static MatRauschen m2(128.0, 1200000, 5);
    const Karte k(132.0, 0);
    DeckLauf l(k, (int64_t)k.sample_at(40.0));
    l.deck.lade(&m2.m, 0);
    l.bis(1000 * B);
    l.deck.start(l.s, 50000);
    l.bis(l.s + 200 * B);
    l.deck.loop_an(l.s, l.deck.frame_bei(l.s), 4 * 22500);
    l.bis(l.s + 300 * B);
    l.deck.springe(l.s, 8 * 22500);
    l.bis(l.s + 200 * B);
    l.deck.loop_aus(l.s);
    l.bis(l.s + 100 * B);
    l.deck.stopp(l.s);
    l.bis((int64_t)l.L.size());
    h[5] = fnv(fnv(FNV0, l.L.data(), l.L.size()), l.R.data(), l.R.size());
  }
  // Stand 82106bec (vor 6a), mit diesem Test aufgenommen: ~/messungen/2026-10-08-task6/6a/6a1_bitgleich_vorher.txt
  static const uint64_t soll[6] = {0xcd4a784caac87644ull, 0x7e20f167aa59109eull, 0xcf7fd1b1cd4fbd9eull,
                                    0x4877daca28e8cde0ull, 0xa91f2f77039d1d93ull, 0xb96ae587ee55dea9ull};
  const char* namen[6] = {"ohne Loop", "Loop 4 Beat (gebrochen)", "Loop 1 Beat", "Loop 1/4 Beat", "Loop ganzzahlig ohne lx",
                          "Deck::block Keylock 132"};
  for (int i = 0; i < 6; ++i) {
    std::printf("  band_bitgleich %-26s %016llx (Soll %016llx)\n", namen[i], (unsigned long long)h[i],
                (unsigned long long)soll[i]);
    PRUEF(h[i] == soll[i]);
  }
  ergebnis("band_bitgleich");
}

#ifndef CYPHERDJ_PROBE_STAND_VORHER  // nur zum Aufnehmen der Prüfsummen am Stand vor 6a gesetzt (dort fehlt still_bis)
// ------------------------------------------------------------------------------------------ 6a-1 band_still
void test_band_still() {
  static MatRauschen mr(125.3, 400000);
  std::atomic<float> g[cdj::STEM_ANZAHL] = {0.7f, 0.3f, 1.0f, 1.0f};
  const double fpb = cdj::FRAMES_JE_MINUTE / 125.3;
  for (int fall = 0; fall < 2; ++fall) {
    cdj::DeckBand b;
    b.m = &mr.m;
    b.g = g;
    if (fall) {
      b.loop_a = 60000;
      b.loop_l = std::llround(4 * fpb);
      b.loop_lx = 4 * fpb;
    }
    PRUEF(b.still_bis.load() == std::numeric_limits<int64_t>::min());
    const int64_t sb = 61234 + fall * 200000;  // im Loop: hinter mehreren Nähten (ungewickelt)
    cdj::DeckBand c(b);
    c.still_bis.store(sb);
    cdj::DeckBand e;
    e = c;  // Zuweisung trägt den Wert
    PRUEF(e.still_bis.load() == sb && e.m == b.m && e.loop_l == b.loop_l && e.loop_lx == b.loop_lx);
    std::vector<float> l0(5000), r0(5000), l1(5000), r1(5000);
    int falsch_vor = 0, falsch_nach = 0;
    for (int64_t p = sb - 3000; p < sb + 3000; p += 977) {  // Stücke über die Grenze
      b.band(p, 5000, l0.data(), r0.data());
      e.band(p, 5000, l1.data(), r1.data());
      for (int i = 0; i < 5000; ++i) {
        if (p + i < sb) falsch_vor += (l1[(size_t)i] != 0.0f || r1[(size_t)i] != 0.0f) ? 1 : 0;
        else falsch_nach += (l1[(size_t)i] != l0[(size_t)i] || r1[(size_t)i] != r0[(size_t)i]) ? 1 : 0;
      }
    }
    std::printf("  band_still %s: still_bis %lld, vor der Grenze nicht still %d, ab der Grenze ungleich %d\n",
                fall ? "Loop 4 Beat" : "ohne Loop", (long long)sb, falsch_vor, falsch_nach);
    PRUEF(falsch_vor == 0 && falsch_nach == 0);
  }
  ergebnis("band_still");
}

// ------------------------------------------------------------------------------------------ 6a: gemeinsam
// PLAN_FENSTER(f) = PLAN_VORLAUF(f) + 1024, PLAN_VORLAUF(f) = ⌈3686 + 2176/f⌉ (Detailschnitt 3.2; M1 mit echten Fäden bestätigt)
int64_t plan_fenster(double bpm) { return (int64_t)std::ceil(3686.0 + 2176.0 / (bpm / 128.0)) + 1024; }

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
double rms(const std::vector<float>& x, int64_t a, int64_t n) {
  double q = 0;
  for (int64_t i = a; i < a + n; ++i) q += (double)x[(size_t)i] * x[(size_t)i];
  return std::sqrt(q / (double)n);
}
// Tonhöhe des Sinus (Sollfrequenz hz) in [a, a + n): kleinste Quadrate (keylock_mess.h sinus_einpassen, Suchbereich ±20 Hz um
// such), in Cent gegen hz. Passt kein Sinus im Suchbereich (Rest über 10 % des Pegels, etwa ein Ton weit außerhalb), 999.
double ct_fenster(const std::vector<float>& x, int64_t a, int64_t n, double hz, double such = 0.0) {
  const km::Sinus si = km::sinus_einpassen(x, a, a + n, such > 0.0 ? such : hz);
  const double pegel = std::sqrt(0.5 * (si.A * si.A + si.Bs * si.Bs));
  if (!(pegel > 0.0) || si.rest > 0.1 * pegel) return 999.0;
  return 1200.0 * std::log2(si.f / hz);
}
// Hann-gewichtete Amplitude eines Sinus hz in [a, a + n) (Probe der Prüfung 6a-2, qualitaet/probe_6a.cpp amp_bei)
double amp_bei(const std::vector<float>& x, int64_t a, int64_t n, double hz) {
  double re = 0, im = 0, sw = 0;
  const double w = 2 * km::PI * hz / 48000.0;
  for (int64_t i = 0; i < n; ++i) {
    const double h = 0.5 - 0.5 * std::cos(2 * km::PI * (double)i / (double)(n - 1));
    const double v = x[(size_t)(a + i)] * h;
    re += v * std::cos(w * (double)(a + i));
    im -= v * std::sin(w * (double)(a + i));
    sw += h;
  }
  return 2.0 * std::sqrt(re * re + im * im) / sw;
}
double spitze(const std::vector<float>& x, int64_t a, int64_t b) {
  double m = 0;
  for (int64_t t = a; t < b; ++t) m = std::max(m, (double)std::fabs(x[(size_t)t]));
  return m;
}
double sprung_max(const std::vector<float>& x, int64_t a, int64_t b, int64_t* wo = nullptr) {
  double m = 0;
  for (int64_t t = std::max<int64_t>(a, 1); t < b && t < (int64_t)x.size(); ++t) {
    const double d = std::fabs((double)x[(size_t)t] - (double)x[(size_t)t - 1]);
    if (d > m) {
      m = d;
      if (wo) *wo = t;
    }
  }
  return m;
}
// Tonhöhe über Nulldurchgänge (keylock_mess.h freq, ohne Suchbereich), in Cent gegen hz
double ct_null(const std::vector<float>& x, int64_t a, int64_t n, double hz) {
  const double f = km::freq(x, a, a + n);
  return f > 0.0 ? 1200.0 * std::log2(f / hz) : 999.0;
}

// ------------------------------------------------------------------------------------------ P4a geplant_start_stand
// Start aus dem Stand bei 60, 80, 100, 132 BPM, Vorlauf PLAN_FENSTER (der Kern plant ab da je Block). Klick: erster Klick nach
// dem Einsatz Lage ±12 gegen rohes R3 gleicher Speisung (Band still bis zum Startframe, Faktorfolge des Dehners), Klickform
// Korrelation ≥ 0,985 gegen denselben Klick 4 Beats später, Energie ≥ −1 dB (Grenzen von T4a der Box). Sinus 1000 Hz:
// jedes 10-ms-Fenster ab 50 ms nach dem Einsatz ±2 ct (40 Fenster), das 100-ms-Fenster ab dem Einsatz ±5 ct (Ausnahme 7.P4: dort
// liegt weniger als eine volle Periode Ton im ersten 10-ms-Fenster). Dazu: s_h = s_t − 2176, kein neuer Ansatz beim Start
// (Anfrage unverändert), geplant_ok 1, keine Unterläufe. Vorher (Stand 82106bec bzw. Mutation PLAN_START_AUS): Brücke im
// Varispeed bis s_t + 4096 + 1408 + 960.
void test_start_stand() {
  static km::MatProbe klick(80, 0);
  static MatSinus sinus(1000.0, 80 * 22500);
  for (const double bpm : {60.0, 80.0, 100.0, 132.0}) {
    const Karte k(bpm, 0);
    const double b_t = 8.0;
    const int64_t f0 = 4 * 22500;  // Quell-Beat 4: Klick bzw. Sinus bei Phase 0 (1875 Perioden)
    for (int art = 0; art < 2; ++art) {
      const int64_t e = std::llround(k.sample_at(b_t)), n = std::llround(k.sample_at(b_t + 9.0));
      DeckLauf l(k, n);
      l.deck.lade(art ? &sinus.m : &klick.m, 0);
      l.plan.an = true;
      l.plan.ab = (e - plan_fenster(bpm)) / B * B;
      l.plan.b = b_t;
      l.plan.f = f0;
      l.plan.schluessel = 7;
      l.genau(e);
      const uint32_t nr_vor = l.deck.keylock_anfrage();
      const bool vor = l.deck.keylock_vorlage();
      l.deck.start(e, f0, false, 7);
      l.plan.an = false;
      const uint32_t nr_start = l.deck.keylock_anfrage();
      l.bis(n);
      const int64_t s_h = l.deck.keylock_s_h();
      std::printf("  P4a %3.0f BPM %s: Einsatz %lld, s_h %lld (s_t − %lld), Ring in der Vorlage %d, hörbar ab Block %lld, geplant_ok "
                  "%llu, Anfrage vor/nach dem Start %u/%u, am Ende %u, Unterläufe %llu, hart %llu\n",
                  bpm, art ? "Sinus" : "Klick", (long long)e, (long long)s_h, (long long)(e - s_h), (int)vor,
                  (long long)l.hoer_ab, (unsigned long long)l.deck.keylock_geplant_ok(), nr_vor, nr_start,
                  l.deck.keylock_anfrage(), (unsigned long long)l.deck.keylock_unterlauf(),
                  (unsigned long long)l.deck.keylock_hart());
      PRUEF(s_h == e - cdj::STRECK_EINSCHWING - cdj::DECK_VORLAGE);
      PRUEF(l.deck.keylock_geplant_ok() == 1 && nr_vor == nr_start && nr_start == l.deck.keylock_anfrage());
      PRUEF(l.deck.keylock_unterlauf() == 0 && l.deck.keylock_hart() == 0);
      if (art == 0) {
        static const std::vector<float> tpl = km::klick_vorlage();
        const DehnerAnker a{b_t, (double)f0};
        const int q = 4;
        double e0 = 999, e1 = 999;
        PRUEF(km::klick_lage(l.L, k, a, q, e0, tpl, km::MITTE));
        PRUEF(km::klick_lage(l.L, k, a, q + 4, e1, tpl, km::MITTE));
        const int64_t s0 = std::llround(k.sample_at(a.b + (q * km::FPB + km::MITTE - a.f) / km::FPB) - km::MITTE + e0);
        const int64_t s1 = std::llround(k.sample_at(a.b + ((q + 4) * km::FPB + km::MITTE - a.f) / km::FPB) - km::MITTE + e1);
        const double kor = korrelation(l.L, s0, s1);
        const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
        PRUEF(!fs.empty());
        cdj::DeckBand ref;  // rohes R3, gleich gespeist: dasselbe Material, still bis zum Startframe
        ref.m = &klick.m;
        ref.still_bis.store(f0);
        const km::Lage m = fs.empty() ? km::Lage{} : km::lage_messen(l.L, ref, k, a, km::band_start(k, a, s_h, fs.at(0)), fs, s_h, q, q + 1);
        auto energie = [&](int qq) {
          const int64_t m0 = std::llround(k.sample_at(a.b + (qq * km::FPB + km::MITTE - a.f) / km::FPB));
          double e2 = 0;
          for (int64_t t = m0 - 1000; t < m0 + 1000; ++t) e2 += (double)l.L[(size_t)t] * l.L[(size_t)t];
          return e2;
        };
        const double en_db = 10.0 * std::log10(energie(q) / energie(q + 4));
        std::printf("  P4a %3.0f BPM Klick: erster Klick %+.2f gegen das Soll (Bezug 4 Beats später %+.2f), %.2f gegen rohes R3, "
                    "Korrelation %.4f, Energie %+.2f dB\n",
                    bpm, e0, e1, m.max_roh, kor, en_db);
        PRUEF(m.n == 1 && m.max_roh <= 12.0 && kor >= 0.985 && en_db >= -1.0);
      } else {
        const double ct100 = ct_null(l.L, e, 4800, 1000.0);
        // rohes R3 gleicher Speisung (Band still bis zum Startframe, Faktorfolge des Dehners) als Bezug je Fenster
        const DehnerAnker a{b_t, (double)f0};
        const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
        PRUEF(!fs.empty());
        cdj::DeckBand ref;
        ref.m = &sinus.m;
        ref.still_bis.store(f0);
        const std::vector<float> R = fs.empty() ? std::vector<float>(l.L.size(), 0.0f)
                                                : km::r3_roh(ref, km::band_start(k, a, s_h, fs.at(0)), fs, s_h, n);
        double ct10 = 0, roh10 = 0, diff10 = 0;
        int64_t wo = -1;
        for (int j = 0; j < 40; ++j) {
          const int64_t t = e + 2400 + j * 480;
          const double c = ct_fenster(l.L, t, 480, 1000.0), cr = ct_fenster(R, t, 480, 1000.0);
          if (std::fabs(c) > std::fabs(ct10)) ct10 = c, wo = t;
          roh10 = std::max(roh10, std::fabs(cr));
          diff10 = std::max(diff10, std::fabs(c - cr));
        }
        // Grenze 7.P4 (±2 ct je 10-ms-Fenster) gewertet ab 80 BPM; bei 60 BPM (Faktor 0,47) hält sie rohes R3 selbst nicht
        // (gemessen 08.10.: bis 4,64 ct, dieselben Fenster wie das Deck, diag_ct): dort gewertet gegen rohes R3 (±0,1 ct)
        const bool abs_gewertet = bpm >= 80.0;
        std::printf("  P4a %3.0f BPM Sinus: 100-ms-Fenster ab dem Einsatz %+.3f ct, 10-ms-Fenster ab E + 50 ms (40): max %+.3f ct "
                    "bei E%+lld, rohes R3 max %.3f ct, max |Deck − rohes R3| %.3f ct%s\n",
                    bpm, ct100, ct10, (long long)(wo - e), roh10, diff10, abs_gewertet ? "" : " (±2 ct ausgewiesen, nicht gewertet)");
        PRUEF(std::fabs(ct100) <= 5.0 && diff10 <= 0.1);
        if (abs_gewertet) PRUEF(std::fabs(ct10) <= 2.0);
      }
    }
  }
  ergebnis("geplant_start_stand");
}

// ------------------------------------------------------------------------------------------ P4b geplant_start_ohne_kerbe
// Bei 60 und 80 BPM klingt der Ring schon vor dem Einsatz (Vorlage). Sinus 1000 Hz: kleinster Pegel (RMS über 24 Samples =
// eine halbe Periode, phasenunabhängig) in [s_t − 48, s_t + 96) ≥ 0,5 × eingeschwungen. Abweichung vom Plan (1-ms-Fenster): ein
// 1-ms-Fenster über der 1-ms-Einblende hätte RMS 1/√3 = 0,577 > 0,5 und sähe die Kerbe nicht; 24 Samples sehen sie (0,29).
// Mutation PLAN_START_MIT_EIN (Einblende über den klingenden Ring) muss rot werden.
void test_start_ohne_kerbe() {
  static MatSinus sinus(1000.0, 80 * 22500);
  for (const double bpm : {60.0, 80.0}) {
    const Karte k(bpm, 0);
    const double b_t = 8.0;
    const int64_t f0 = 4 * 22500;
    const int64_t e = std::llround(k.sample_at(b_t)), n = std::llround(k.sample_at(b_t + 3.0));
    DeckLauf l(k, n);
    l.deck.lade(&sinus.m, 0);
    l.plan = {true, (e - plan_fenster(bpm)) / B * B, b_t, f0, 9};
    l.start_am_ziel();
    l.bis(n);
    const double ref = rms(l.L, e + 9600, 480);
    double tief = 1e9;
    int64_t wo = 0;
    for (int64_t t = e - 48; t < e + 96; ++t) {
      const double r = rms(l.L, t, 24);
      if (r < tief) tief = r, wo = t;
    }
    std::printf("  P4b %.0f BPM: Ring vor dem Einsatz hörbar ab Block %lld (Einsatz %lld), kleinster 24er-Pegel %.4f bei E%+lld, "
                "eingeschwungen %.4f, Verhältnis %.3f, geplant_ok %llu\n",
                bpm, (long long)l.hoer_ab, (long long)e, tief, (long long)(wo - e), ref, tief / ref,
                (unsigned long long)l.deck.keylock_geplant_ok());
    PRUEF(l.hoer_ab >= 0 && l.hoer_ab < e);
    PRUEF(tief >= 0.5 * ref);
  }
  ergebnis("geplant_start_ohne_kerbe");
}

// ------------------------------------------------------------------------------------------ P4c geplant_start_rampe_wartezeit
// 7c.1 am Deck: geplant bei 100 BPM (Einsatz Beat 12, Planung ab Beat 8,5), danach Rampe ab Beat 9,5 auf 104, 110, 140 über 1
// Beat: der Einsatz rückt vor s_h + 1408. Das Deck setzt dann im Varispeed ein, der Ring kommt über die Brücke. Sinus 416 Hz
// (Grenze der Box nach 7c.1, 0,05; Box dort 0,0273 bis 0,0298): größter Nachbarsprung in [E − 4800, max(E + 9600,
// s_h + 1408 + 960 + 4800)) ≤ 0,05. Mutation PLAN_START_STILL_NACH_UMZIEL (still_ bleibt): der Ring springt ohne Blende ein.
void test_start_rampe_wartezeit() {
  static MatSinus sinus(416.0, 40 * 22500);
  for (const double ziel : {104.0, 110.0, 140.0}) {
    Karte k(100.0, 0);
    const int64_t n = std::llround(k.sample_at(20.0));
    DeckLauf l(k, n);
    l.deck.lade(&sinus.m, 0);
    l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 11};
    l.bis(std::llround(k.sample_at(9.0)) / B * B);
    PRUEF(l.deck.keylock_plan_aktiv());
    PRUEF(l.k.rampe(9.5, ziel, 1.0));
    ++l.gen;
    l.start_am_ziel();
    l.bis(n);
    const int64_t e = std::llround(l.k.sample_at(12.0));
    const int64_t s_h = l.deck.keylock_s_h();
    const int64_t bis = std::max<int64_t>(e + 9600, s_h + cdj::STRECK_EINSCHWING + cdj::STRECK_BLENDE + 4800);
    const sprung::Mass m = sprung::messe(l.L, e - 4800, bis);
    const double nat = sprung::natuerlich(416.0 * std::max(ziel, 128.0) / 128.0, 0.5);
    std::printf("  P4c 100 -> %.0f: Einsatz %lld, s_h %lld (s_h + 1408 %s Einsatz), größter Sprung %.4f bei E%+lld (natürlich %.4f), "
                "Ring hörbar ab %lld, geplant_ok %llu\n",
                ziel, (long long)e, (long long)s_h, s_h + cdj::STRECK_EINSCHWING <= e ? "<=" : ">", m.d1, (long long)(m.ort1 - e),
                nat, (long long)l.hoer_ab, (unsigned long long)l.deck.keylock_geplant_ok());
    PRUEF(s_h + cdj::STRECK_EINSCHWING > e);  // der Fall, den der Test prüfen soll, liegt vor
    PRUEF(m.d1 <= 0.05 && l.hoer_ab > 0);
  }
  ergebnis("geplant_start_rampe_wartezeit");
}

// ------------------------------------------------------------------------------------------ P4d geplant_start_ereignis_in_vorlage
// 7c.2 am Deck: Ereignis in der Vorlage [E − 768, E) bei E − 100 und E − 256, 60 BPM, Sinus 416 Hz (der Ring klingt dort schon):
// Stopp (die Aktion fällt, kl_plan_verwerfen), Laden (Sinus 832 Hz; ein Laden verwirft den Start), Knopf aus (der Start kommt
// über den heutigen Weg), Neuanker (Raster: der Kern plant mit anderem Frame, zu kurz). Größter Nachbarsprung von 64 Samples vor
// dem Ereignis bis 2000 danach ≤ 1,5 · natürlich bei 416 Hz = 0,0408 (Fix-Runde 1 F2; vorher T18 0,1089, blind bei E − 256). Mutation PLAN_VORLAGE_STUMM (hart stumm, Box 0,4663).
void test_start_ereignis_in_vorlage() {
  static MatSinus s416(416.0, 40 * 22500);
  static MatSinus s832(832.0, 40 * 22500, 0.5f, "c1c0000000000643");
  const char* namen[] = {"", "Stopp", "Laden", "Knopf aus", "Neuanker"};
  // Fix-Runde 1 F2: Grenze 1,5 · natürlich bei 416 Hz (0,0408) statt T18 (0,1089): mit T18 sah der Fall E − 256 den harten
  // Schnitt nicht (Mutation 0,0461, ohne 0,0295). Nach dem Ereignis klingt höchstens 416 Hz (Laden verwirft den Start; Knopf aus und
  // Neuanker setzen im Varispeed mit 195 Hz ein).
  const double grenze = 1.5 * sprung::natuerlich(416.0, 0.5);
  for (const int64_t ab : {(int64_t)100, (int64_t)256}) {
    for (int art = 1; art <= 4; ++art) {
      const Karte k(60.0, 0);
      const int64_t n = std::llround(k.sample_at(16.0));
      DeckLauf l(k, n);
      l.deck.lade(&s416.m, 0);
      l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 13};
      const int64_t e = l.s_t(), s_ev = e - ab;
      l.genau(s_ev);
      const bool hoer = l.deck.keylock_ring_hoerbar() && l.deck.keylock_vorlage();
      if (art == 1) {
        l.deck.kl_plan_verwerfen(s_ev);
        l.plan.an = false;
      }
      if (art == 2) {
        l.deck.lade(&s832.m, s_ev);
        l.plan.an = false;
      }
      if (art == 3) l.deck.keylock(s_ev, false);
      if (art == 4) l.plan.f += 1000;  // der Kern plant am nächsten Blockanfang (hier s_ev) mit dem neuen Frame
      if (l.plan.an) l.start_am_ziel();
      l.bis(n);
      double sp = 0;
      int64_t ort = -1;
      for (int64_t t = s_ev - 64; t < s_ev + 2000; ++t) {
        const double d = std::fabs((double)l.L[(size_t)t] - (double)l.L[(size_t)t - 1]);
        if (d > sp) sp = d, ort = t;
      }
      std::printf("  P4d %-9s bei E − %lld: Ring vorher hörbar %d, größter Nachbarsprung %.4f bei E%+lld (Grenze %.4f), "
                  "geplant ok/verworfen %llu/%llu, läuft am Ende %d\n",
                  namen[art], (long long)ab, (int)hoer, sp, (long long)(ort - e), grenze,
                  (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_geplant_verworfen(),
                  (int)l.deck.laeuft());
      PRUEF(hoer && sp <= grenze);
      PRUEF(l.deck.keylock_geplant_ok() == 0);
    }
  }
  ergebnis("geplant_start_ereignis_in_vorlage");
}

// ------------------------------------------------------------------------------------------ P4e geplant_start_raster_wartend
// 7c.3 am Deck: 4, 5, 8 Neuanker (Raster, je Block ein anderer Startframe) im wartenden Deck, während Vorbereiter und
// Arbeits-Thread aussetzen (keine Quittung, die Leihe gibt nichts frei): dasselbe Band, kein_platz 0, höchstens ein Platz
// verliehen, Ring zum Einsatz hörbar, der Start trägt (geplant_ok 1). Mutation PLAN_RASTER_NEUER_PLATZ (je Neuanker ein Platz).
void test_start_raster_wartend() {
  static km::MatProbe klick(64, 0);
  for (const int anzahl : {4, 5, 8}) {
    const Karte k(110.0, 0);
    const int64_t n = std::llround(k.sample_at(14.0));
    DeckLauf l(k, n);
    l.deck.lade(&klick.m, 0);
    l.plan = {true, std::llround(k.sample_at(4.5)) / B * B, 8.0, 4 * 22500, 17};
    l.bis(std::llround(k.sample_at(5.0)) / B * B);
    l.takt = l.fuelle = false;
    int verliehen = l.deck.keylock_verliehen();
    for (int r = 0; r < anzahl; ++r) {
      l.plan.f = 4 * 22500 + 100 * (r + 1);
      l.teil(B);
      verliehen = std::max(verliehen, l.deck.keylock_verliehen());
    }
    l.takt = l.fuelle = true;
    l.start_am_ziel();
    l.bis(n);
    const int64_t e = std::llround(k.sample_at(8.0));
    std::printf("  P4e %d Neuanker ohne Quittung: kein_platz %llu, höchstens %d Plätze verliehen, Ring hörbar ab %lld (Einsatz %lld), "
                "geplant_ok %llu\n",
                anzahl, (unsigned long long)l.deck.keylock_kein_platz(), verliehen, (long long)l.hoer_ab, (long long)e,
                (unsigned long long)l.deck.keylock_geplant_ok());
    PRUEF(l.deck.keylock_kein_platz() == 0 && verliehen <= 1 && l.hoer_ab >= 0 && l.hoer_ab <= e + B);
    PRUEF(l.deck.keylock_geplant_ok() == 1);
  }
  ergebnis("geplant_start_raster_wartend");
}

// ------------------------------------------------------------------------------------------ Negativ-Kontrollen
// Ein Planer, der nicht planen darf, ändert nichts: Ausgabe bitgleich zum Lauf ohne Planer (Start ohne Schlüssel, heutiger Weg).
//  a) Basis 128 (Direktweg, 2.3 Punkt 2)  b) ohne Keylock (kein Dehner) bei 132  c) Vorlauf 6271 < DECK_START_VORLAUF bei 132
//  d) Gegenprobe: Vorlauf 6272 plant (geplant_ok 1) und weicht ab
void test_negativ() {
  static km::MatProbe klick(48, 0);
  struct Fall {
    const char* name;
    double bpm;
    bool dehner;
    int64_t vorlauf;
  } faelle[] = {{"Basis 128", 128.0, true, 20000},
                {"ohne Keylock 132", 132.0, false, 20000},
                {"Vorlauf 4096 bei 132", 132.0, true, 4096},        // Fix-Runde 1 F3: darunter (s_h nicht vor s_t) kein Plan
                {"Faktor 52/128", 52.0, true, 20000},               // Fix-Runde 1 F4: unter DECK_START_F_MIN kein Plan
                {"Faktor 59,5/128", 59.5, true, 20000},             // Fix-Runde 2 F4-N1: knapp unter der Grenze
                {"Vorlauf 4097 bei 132", 132.0, true, 4097},        // Gegenprobe: früher Ansatz ohne still (F3)
                {"Vorlauf 6272 bei 132", 132.0, true, 6272}};       // Gegenprobe: Plan mit still
  for (const Fall& c : faelle) {
    const Karte k(c.bpm, 0);
    const double b_t = 6.0;
    const int64_t e = std::llround(k.sample_at(b_t)), n = std::llround(k.sample_at(b_t + 6.0));
    std::vector<float> aus[2];
    uint64_t ok = 0, kurz = 0;
    for (int geplant = 0; geplant < 2; ++geplant) {
      DeckLauf l(k, n, c.dehner);
      l.deck.lade(&klick.m, 0);
      if (geplant) {
        l.genau(e - c.vorlauf);  // erster Planungsaufruf genau beim Vorlauf
        l.plan = {true, e - c.vorlauf, b_t, 2 * 22500, 21};
        l.start_am_ziel();
      } else {
        l.genau(e - c.vorlauf);
        l.genau(e);
        l.deck.start(e, 2 * 22500);
      }
      l.bis(n);
      aus[geplant] = l.L;
      if (geplant) {
        ok = l.deck.keylock_geplant_ok();
        kurz = l.deck.keylock_geplant_zu_kurz();
      }
    }
    int64_t ungleich = 0;
    for (size_t i = 0; i < aus[0].size(); ++i) ungleich += aus[0][i] != aus[1][i] ? 1 : 0;
    std::printf("  negativ %-22s: geplant_ok %llu, zu_kurz %llu, ungleich %lld von %zu Samples\n", c.name, (unsigned long long)ok,
                (unsigned long long)kurz, (long long)ungleich, aus[0].size());
    if (c.vorlauf > 4096 && c.bpm == 132.0 && c.dehner) {
      PRUEF(ok == 1 && ungleich > 0);  // Gegenprobe: der Fall, der treffen muss, trifft
    } else {
      PRUEF(ok == 0 && ungleich == 0);
      if (c.vorlauf == 4096) PRUEF(kurz == 1);
    }
  }
  ergebnis("geplant_negativ");
}

// ------------------------------------------------------------------------------------------ geplant_faeden (TSan)
// Vorbereiter und Arbeits-Thread echt (wie test_deck_keylock Test 9), 2000 (TSan 300) Zyklen auf einem Deck bei 132: planen,
// Neuanker (still_bis atomar am selben Band, der Dehner liest es zugleich), Start, Spielen, Stopp, Verwerfen, Laden. Gewertet:
// kein Befund (TSan), geplant_ok > 0, am Ende nach Quittung nichts mehr verliehen.
void test_faeden() {
  static km::MatProbe m1(64, 0, "c1c0000000000644"), m2(64, 1, "c1c0000000000645");
  const Karte k(132.0, 0);
  uint32_t gen = 1;
  auto d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::Deck deck;
  deck.setze_karte(&k, &gen);
  deck.setze_keylock(d.get(), &post);
  std::atomic<bool> halt{false};
  std::thread vorbereiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      post.takt(*d);
      std::this_thread::sleep_for(std::chrono::microseconds(700));
    }
  });
  std::thread arbeiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      d->fuelle_synchron();
      std::this_thread::sleep_for(std::chrono::microseconds(300));
    }
  });
#if defined(__SANITIZE_THREAD__)
  const int N = 300, TAKT_US = 3000;
#else
  const int N = 2000, TAKT_US = 200;
#endif
  std::mt19937 z(20261008);
  int64_t s = 0;
  float l[B], r[B];
  auto block = [&] {
    deck.block(s, B, l, r, 0);
    s += B;
    std::this_thread::sleep_for(std::chrono::microseconds(TAKT_US));
  };
  deck.lade(&m1.m, 0);
  uint64_t schl = 100;
  int starts = 0;
  for (int i = 0; i < N; ++i) {
    const int64_t e = s + cdj::DECK_START_VORLAUF + (int64_t)(z() % 12000);
    int64_t f = (int64_t)(z() % 20) * 22500;
    ++schl;
    const int was = (int)(z() % 4);
    while (s + B <= e) {
      deck.kl_plane_start(s, e, k.beat_at((double)e), f, schl);
      if (was == 1 && z() % 4 == 0) f += 100;  // Neuanker im Warten
      if (was == 2 && e - s < 3000) {
        deck.kl_plan_verwerfen(s);
        break;
      }
      block();
    }
    if (was == 3) deck.lade(z() % 2 ? &m1.m : &m2.m, s);
    if (was != 2 && was != 3) {
      const int rest = (int)(e - s);
      if (rest > 0) {
        deck.block(s, rest, l, r, 0);
        s += rest;
      }
      deck.start(s, f, false, schl);
      ++starts;
      for (int j = (int)(z() % 8); j > 0; --j) block();
      deck.stopp(s);
      for (int j = 0; j < 4; ++j) block();
    }
    while (deck.rueckgabe()) {
    }
  }
  for (int j = 0; j < 200; ++j) block();
  halt.store(true, std::memory_order_release);
  vorbereiter.join();
  arbeiter.join();
  std::printf("  geplant_faeden: %d Zyklen, %d Starts, geplant ok %llu, verworfen %llu, zu kurz %llu, kein_platz %llu, verliehen am "
              "Ende %d, Unterläufe %llu\n",
              N, starts, (unsigned long long)deck.keylock_geplant_ok(), (unsigned long long)deck.keylock_geplant_verworfen(),
              (unsigned long long)deck.keylock_geplant_zu_kurz(), (unsigned long long)deck.keylock_kein_platz(),
              deck.keylock_verliehen(), (unsigned long long)deck.keylock_unterlauf());
  PRUEF(deck.keylock_geplant_ok() > 0);
  PRUEF(deck.keylock_kein_platz() == 0);
  ergebnis("geplant_faeden");
}
#endif

// ------------------------------------------------------------------------------------------ Fix-Runde 1
// F1/Q1 stopp_dann_plan: das Deck spielt, Stopp, die Rampe endet (kl_offen_ = LEER); im ersten Block danach plant der Kern den
// Start mit Vorlauf 6372 bzw. 20000 (132 BPM, Sinus 1000 Hz). Der offene LEER-Auftrag darf den eben gebauten Plan nicht
// zurücknehmen: geplant_ok 1, verworfen 0, s_h = s_t − 2176, 100-ms-Fenster ab dem Einsatz ±5 ct (die Brücke spielte +53,3 ct).
// Gegenprobe frisch geladen (ohne Stopp), gleicher Vorlauf.
void test_stopp_dann_plan() {
  static MatSinus sinus(1000.0, 200 * 22500);
  const Karte k(132.0, 0);
  for (const int64_t v : {(int64_t)6372, (int64_t)20000})
    for (int stopp = 0; stopp < 2; ++stopp) {
      const int64_t n = std::llround(k.sample_at(40.0));
      DeckLauf l(k, n);
      l.deck.lade(&sinus.m, 0);
      l.bis(100 * B);
      if (stopp) {
        l.deck.start(l.s, 22500);
        l.bis(l.s + 400 * B);
        l.deck.stopp(l.s);
        while (l.deck.laeuft()) l.teil(B);  // der Block, in dem die Rampe endet
      } else {
        l.bis(l.s + 400 * B);
      }
      const int64_t n0 = l.s, st = n0 + v;
      l.plan = {true, n0, k.beat_at((double)st), 30 * 22500, 41};
      const int64_t e = l.s_t();
      const uint64_t ok0 = l.deck.keylock_geplant_ok(), verw0 = l.deck.keylock_geplant_verworfen();
      l.start_am_ziel();
      l.bis(e + 24000);
      const uint64_t ok = l.deck.keylock_geplant_ok() - ok0, verw = l.deck.keylock_geplant_verworfen() - verw0;
      const double ct100 = ct_null(l.L, e, 4800, 1000.0);
      std::printf("  stopp_dann_plan %s, Vorlauf %lld: geplant ok %llu, verworfen %llu, zu_kurz %llu, s_h − s_t %+lld, 100 ms ab dem "
                  "Einsatz %+.2f ct\n",
                  stopp ? "nach Stopp  " : "frisch      ", (long long)(e - n0), (unsigned long long)ok, (unsigned long long)verw,
                  (unsigned long long)l.deck.keylock_geplant_zu_kurz(), (long long)(l.deck.keylock_s_h() - e), ct100);
      PRUEF(ok == 1 && verw == 0 && l.deck.keylock_s_h() == e - 2176 && std::fabs(ct100) <= 5.0);
    }
  ergebnis("stopp_dann_plan");
}

// F3 fruehansatz: Vorlauf unter 6272, aber über ANSATZ_FRIST (s_h vor s_t): der Start bekommt den frühen Ansatz wie die Box
// (s_h = n0 + 4096, ohne Start aus Stille bei V < 5504), die Brücke wird kürzer. 132 BPM, Sinus 1000 Hz: Fehlklang-Dauer =
// Ende des letzten 10-ms-Fensters (480er, lückenlos ab E) mit |ct| > 2 (Bezug 1000 Hz, kleinste Quadrate ±20 Hz; ein Fenster,
// in das kein Sinus nahe 1000 Hz passt, zählt als Fehlklang). Gerechnet max(0, 5504 − V) + 960 Samples; gewertet ≤ dieser Wert +
// 480 (ein Fenster) und kürzer als der heutige Weg (Ansatz am Ereignis: 4096 + 1408 + 960 = 6464). Der Plan trägt (geplant_ok 1).
int64_t fehlklang_bis(const std::vector<float>& x, int64_t e, int64_t bis) {
  int64_t ende = 0;
  for (int64_t t = e; t + 480 <= bis; t += 480)
    if (std::fabs(ct_fenster(x, t, 480, 1000.0)) > 2.0) ende = t + 480 - e;
  return ende;
}
void test_fruehansatz() {
  static MatSinus sinus(1000.0, 200 * 22500);
  const Karte k(132.0, 0);
  for (const int64_t v : {(int64_t)4544, (int64_t)5500}) {
    int64_t dauer[2] = {0, 0};
    uint64_t ok = 0;
    for (int geplant = 0; geplant < 2; ++geplant) {
      const int64_t n = std::llround(k.sample_at(20.0));
      DeckLauf l(k, n);
      l.deck.lade(&sinus.m, 0);
      const int64_t e = std::llround(k.sample_at(8.0));
      l.genau(e - v);
      if (geplant) {
        l.plan = {true, e - v, 8.0, 4 * 22500, 51};
        l.start_am_ziel();
      } else {
        l.genau(e);
        l.deck.start(e, 4 * 22500);
      }
      l.bis(n);
      dauer[geplant] = fehlklang_bis(l.L, e, e + 12000);
      if (geplant) ok = l.deck.keylock_geplant_ok();
    }
    const int64_t soll = std::max<int64_t>(0, 5504 - v) + 960;
    std::printf("  fruehansatz 132 BPM, Vorlauf %lld: Fehlklang bis E + %lld Samples (gerechnet %lld), heutiger Weg E + %lld; geplant_ok "
                "%llu\n",
                (long long)v, (long long)dauer[1], (long long)soll, (long long)dauer[0], (unsigned long long)ok);
    PRUEF(ok == 1 && dauer[1] <= soll + 480 && dauer[1] < dauer[0]);
  }
  ergebnis("fruehansatz");
}

// Q3 ziel_ohne_start (Deck, Schutz für zu_spaet und Abweisung am Ziel): ein geplanter Start, dessen Aktion am Ziel nicht ausgeführt
// wird (KI-Stopp mitten im Zyklus, nicht geladen): erreicht ein Block das Ziel und das Deck steht, fällt der Plan dort selbst
// (Deck::block). 60 BPM, Klick (Ring klingt in der Vorlage): danach kein Plan aktiv, größter Nachbarsprung in [E − 64, E + 2000)
// ≤ 0,1089 (T18), Spitze ab E + DECK_VORLAGE_AUS 0 (Stand vor 6a: 0).
void test_ziel_ohne_start() {
  static km::MatProbe klick(64, 0, "c1c0000000000648");
  const Karte k(60.0, 0);
  const int64_t n = std::llround(k.sample_at(16.0));
  DeckLauf l(k, n);
  l.deck.lade(&klick.m, 0);
  l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 61};
  const int64_t e = l.s_t();
  l.genau(e);
  const bool vor = l.deck.keylock_vorlage();
  l.plan.an = false;  // die Aktion wird am Ziel nicht ausgeführt
  l.bis(n);
  double sp = 0, nach = 0;
  for (int64_t t = e - 64; t < e + 2000; ++t) sp = std::max(sp, std::fabs((double)l.L[(size_t)t] - (double)l.L[(size_t)t - 1]));
  for (int64_t t = e + 128; t < e + 9600; ++t) nach = std::max(nach, (double)std::fabs(l.L[(size_t)t]));
  std::printf("  ziel_ohne_start 60 BPM: Vorlage hörbar %d, Plan danach aktiv %d, größter Nachbarsprung %.4f, Spitze ab E + 128 %.4f, "
              "verworfen %llu\n",
              (int)vor, (int)l.deck.keylock_plan_aktiv(), sp, nach, (unsigned long long)l.deck.keylock_geplant_verworfen());
  PRUEF(vor && !l.deck.keylock_plan_aktiv() && sp <= 2.0 * sprung::natuerlich(832.0, 0.5) && nach <= 0.01);
  ergebnis("ziel_ohne_start");
}

// Q4 allokation (Probe probe_allokation der Qualitätsprüfung übernommen): Callback-Seite des geplanten Starts unter dem Abfang
// (kl_plane_start je Block, Vorlage in Deck::block, Neuanker mit kl_vorlage_aus, Start ohne Ansatz, kl_plan_verwerfen), 0
// Allokationen; Positiv-Kontrolle: ein malloc im selben Fenster wird gezählt.
void test_allokation() {
  static km::MatProbe klick(64, 0, "c1c0000000000649");
  const Karte k(60.0, 0);
  const int64_t n = std::llround(k.sample_at(20.0));
  long gesamt = 0;
  // 0: Start trägt; 1: Neuanker in der Vorlage (zu kurz), dann verwerfen; 2 (Fix-Runde 2): früher Ansatz ohne still (V 4544),
  // Start trägt; 3 (Fix-Runde 2): Ziel ohne Start, Selbstfall in Deck::block
  for (int fall = 0; fall < 4; ++fall) {
    DeckLauf l(k, n);
    l.deck.lade(&klick.m, 0);
    const int64_t e_soll = std::llround(k.sample_at(12.0));
    l.plan = {true, fall == 2 ? e_soll - 4544 : std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 71};
    const int64_t e = l.s_t();
    if (fall == 2) l.genau(l.plan.ab);
    else l.bis(l.plan.ab - B);
    bool vor = false;
    while (l.s + B <= e) {
      if (fall == 1 && l.s >= e - 600 && l.plan.f == 4 * 22500) l.plan.f += 1000;
      const int nb = (int)std::min<int64_t>(B, e - l.s);
      float lb[1024] = {}, rb[1024] = {};
      abfang_an();
      if (l.plan.an && !l.deck.laeuft()) l.deck.kl_plane_start(l.s, l.s_t(), l.plan.b, l.plan.f, l.plan.schluessel);
      l.deck.block(l.s, nb, lb, rb, 0);
      gesamt += abfang_aus();
      vor = vor || l.deck.keylock_vorlage();
      l.s += nb;
      l.pumpe();
    }
    float lb[1024] = {}, rb[1024] = {};
    abfang_an();
    if (l.s < e) l.deck.block(l.s, (int)(e - l.s), lb, rb, 0);
    if (fall == 0 || fall == 2) l.deck.start(e, l.plan.f, false, l.plan.schluessel);
    else if (fall == 1) l.deck.kl_plan_verwerfen(e);
    const bool aktiv_vor_block = l.deck.keylock_plan_aktiv();
    l.deck.block(e, B, lb, rb, 0);  // Fall 3: Selbstfall hier
    gesamt += abfang_aus();
    std::printf("  allokation Fall %d: geplant ok/verworfen/ohne still %llu/%llu/%llu, Vorlage hörbar %d, Plan vor/nach dem Block am Ziel %d/%d\n",
                fall, (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_geplant_verworfen(),
                (unsigned long long)l.deck.keylock_geplant_ohne_still(), (int)vor, (int)aktiv_vor_block, (int)l.deck.keylock_plan_aktiv());
    if (fall == 2) PRUEF(!vor && l.deck.keylock_geplant_ohne_still() == 1);
    else PRUEF(vor);
    if (fall == 3) PRUEF(aktiv_vor_block && !l.deck.keylock_plan_aktiv());
  }
  abfang_an();
  void* volatile p = std::malloc(64);
  const long pk = abfang_aus();
  std::free(p);
  std::printf("  allokation: geplanter Start %ld Allokationen (Abfang verfügbar %d), Positiv-Kontrolle malloc %ld\n", gesamt,
              (int)ALLOC_ABFANG_VERFUEGBAR, pk);
  if (ALLOC_ABFANG_VERFUEGBAR) {
    PRUEF(gesamt == 0 && pk >= 1);
  } else {
    std::printf("  allokation: übersprungen (Sanitizer)\n");
  }
  ergebnis("geplant_allokation");
}

// ------------------------------------------------------------------------------------------ Fix-Runde 2
// F3-R1 band_scan: Vorlauf V im Band 5505 bis 6271 (16er-Schritte, 48 Läufe), 60, 80, 100 BPM, Klick und Sinus 1000 Hz. Start aus
// Stille nur mit voller Vorlage (V ≥ 6272); darunter der frühe Ansatz ohne still. Größter Nachbarsprung in [E − 900, E + 300) ≤ T18
// (0,1089). Unter der Regel von e0968ef9 (still ab s_h + 1408 ≤ s_t, verkürzte Vorlage) setzt der Ring nach dem Beginn des
// R3-Vorlaufs hart ein (Prüfung 6a-2 F3-R1: 80 BPM Klick bis 0,4889).
void test_band_scan() {
  static km::MatProbe klick(64, 0, "c1c0000000000657");
  static MatSinus sinus(1000.0, 64 * 22500, 0.5f, "c1c0000000000658");
  for (const double bpm : {60.0, 80.0, 100.0})
    for (int art = 0; art < 2; ++art) {
      const Karte k(bpm, 0);
      const int64_t e = std::llround(k.sample_at(8.0));
      double mx = 0;
      int64_t vmx = 0, omx = 0;
      int n = 0, ueber = 0, still = 0, ohne_still = 0;
      for (int64_t v = 5505; v <= 6271; v += 16) {
        DeckLauf l(k, e + 2000);
        l.deck.lade(art ? &sinus.m : &klick.m, 0);
        l.genau(e - v);
        l.plan = {true, e - v, 8.0, 4 * 22500, 77};
        l.start_am_ziel();
        l.bis(e + 2000);
        if (l.deck.keylock_vorlage()) ++still;  // der Ring klang in der Vorlage (Start aus Stille)
        ohne_still += (int)l.deck.keylock_geplant_ohne_still();
        int64_t o = 0;
        const double sp = sprung_max(l.L, e - 900, e + 300, &o);
        ++n;
        if (sp > 2.0 * sprung::natuerlich(832.0, 0.5)) ++ueber;
        if (sp > mx) mx = sp, vmx = v, omx = o - e;
      }
      std::printf("  band_scan %3.0f BPM %-5s V 5505..6271/16 (%d Läufe): Vorlage hörbar %d, früher Ansatz ohne still %d, größter Sprung %.4f bei V "
                  "%lld (E%+lld), über T18 %d\n",
                  bpm, art ? "Sinus" : "Klick", n, still, ohne_still, mx, (long long)vmx, (long long)omx, ueber);
      PRUEF(ueber == 0 && still == 0 && ohne_still == n);
    }
  ergebnis("band_scan");
}

// Q2-R1 restzone: ein Abbruch kurz vor dem Einsatz trifft Signal, das schon im Ring liegt; die 128er Ausblende trägt es (Grenze wie
// 3.7 Zone 3, Preis, ausgewiesen). 100 und 132 BPM, Klick, Abbruch (kl_plan_verwerfen) bei E − 1, 20, 60, 100, 127, 160, 200, 256, 400.
// Fenster ab dem Eingriff bis E + 4800, Spitze gegen die Eins des getragenen Starts. Gemessene Grenze (09.10.): die Zone ist höchstens
// RESTZONE_BREITE Samples breit (ab dort ≤ 0,01 absolut; vor 6a 0); in ihr bis zur vollen Eins (100 BPM E − 1: 99 %), ausgewiesen.
// Ab Eingriff + 128 (nach der Ausblende) immer ≤ 0,01.
constexpr int64_t RESTZONE_BREITE = 200;
constexpr double RESTZONE_MAX = 1.0;  // physikalische Grenze: in der Zone kann die ganze Eins schon im Ring liegen
void test_restzone() {
  static km::MatProbe klick(64, 0, "c1c0000000000659");
  for (const double bpm : {100.0, 132.0}) {
    const Karte k(bpm, 0);
    double eins = 0;
    {  // Bezug: der Start trägt
      DeckLauf l(k, std::llround(k.sample_at(16.0)));
      l.deck.lade(&klick.m, 0);
      l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 63};
      const int64_t e = l.s_t();
      l.start_am_ziel();
      l.bis((int64_t)l.L.size());
      eins = spitze(l.L, e - 1000, e + 1000);
    }
    for (const int64_t ab : {(int64_t)1, (int64_t)20, (int64_t)60, (int64_t)100, (int64_t)127, (int64_t)160, (int64_t)200, (int64_t)256,
                             (int64_t)400}) {
      DeckLauf l(k, std::llround(k.sample_at(16.0)));
      l.deck.lade(&klick.m, 0);
      l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 63};
      const int64_t e = l.s_t(), s_ev = e - ab;
      l.genau(s_ev);
      l.deck.kl_plan_verwerfen(s_ev);
      l.plan.an = false;
      l.bis((int64_t)l.L.size());
      const double sp = spitze(l.L, s_ev, e + 4800), sp128 = spitze(l.L, s_ev + 128, e + 4800);
      const bool zone = ab < RESTZONE_BREITE;
      std::printf("  restzone %3.0f BPM Abbruch E − %3lld: Spitze ab Eingriff %.4f (%.0f %% der Eins %.4f), ab Eingriff + 128 %.4f%s\n", bpm,
                  (long long)ab, sp, 100.0 * sp / eins, eins, sp128, zone ? "  [Zone]" : "");
      PRUEF(sp128 <= 0.01);
      PRUEF(zone ? sp <= RESTZONE_MAX * eins + 1e-6 : sp <= 0.01);
    }
  }
  ergebnis("restzone");
}

// Doppel-1 knopf_vorlage: Knopf aus in der Vorlage (60 BPM, Sinus 416 Hz, E − 100 und E − 256), der Start kommt am Ziel über den
// heutigen Weg (Varispeed 195 Hz). Der Keylock-Anteil (416 Hz) in [E, E + 480) fällt auf das Niveau vor 6a: ≤ 0,03 (vor 6a 0,012;
// 9f78da53/e0968ef9 0,271 bzw. 0,202 mit der 960er Ausblende).
void test_knopf_vorlage() {
  static MatSinus s416(416.0, 40 * 22500, 0.5f, "c1c0000000000660");
  const Karte k(60.0, 0);
  for (const int64_t ab : {(int64_t)100, (int64_t)256})
    for (int mit_plan = 0; mit_plan < 2; ++mit_plan) {
      const int64_t n = std::llround(k.sample_at(16.0));
      DeckLauf l(k, n);
      l.deck.lade(&s416.m, 0);
      l.plan = {mit_plan == 1, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 13};
      const int64_t e = l.s_t(), s_ev = e - ab;
      l.genau(s_ev);
      const bool vor = l.deck.keylock_vorlage();
      l.deck.keylock(s_ev, false);
      l.genau(e);
      l.deck.start(e, l.plan.f, false, mit_plan ? l.plan.schluessel : 0);
      l.plan.an = false;
      l.bis(n);
      const double a416 = amp_bei(l.L, e, 480, 416.0), a195 = amp_bei(l.L, e, 480, 195.0);
      std::printf("  knopf_vorlage E − %3lld %s: Vorlage %d, [E, E + 480): 416 Hz %.4f, 195 Hz %.4f\n", (long long)ab,
                  mit_plan ? "mit Plan" : "vor 6a  ", (int)vor, a416, a195);
      if (mit_plan) PRUEF(vor && a416 <= 0.03);
    }
  ergebnis("knopf_vorlage");
}

// Rampe-1 rampe_bremst: ein geplanter Start (mit und ohne still) wartet bei 132 BPM, dann bremst eine Rampe bis kurz vor dem Einsatz auf
// 115, 105, 100. Gemessen: Einsatz (erstes |L| > 0,25 ab E − 2000), kleinster 24er-Pegel ab E + 48 gegen eingeschwungen, dazu das
// Deck gegen rohes R3 gleicher Speisung (gleiche Faktorfolge, gleicher Band-Start): stimmt das Deck Sample für Sample mit rohem R3
// überein bzw. liegt sein Einsatz ±12 bei dem des rohen R3 (Messgröße b), liegt der Verzug in R3 selbst (Latenz bei wechselndem
// Faktor), nicht in Anker oder Beat-Rechnung. Gewertet als gemessene Grenze (Fix-Runde 2, Preis): Einsatz ≤ E + RAMPE_VERZUG_MAX;
// für den Plan mit still Einsatz ±12 gegen rohes R3 (max |Δ| ausgewiesen).
constexpr int64_t RAMPE_VERZUG_MAX = 128;
void test_rampe_bremst() {
  static MatSinus s1000(1000.0, 200 * 22500, 0.5f, "c1c0000000000661");
  for (const double ziel : {115.0, 105.0, 100.0})
    for (const int64_t v : {(int64_t)4544, (int64_t)8000, (int64_t)20000}) {
      Karte k(132.0, 0);
      const int64_t n = std::llround(k.sample_at(26.0));
      DeckLauf l(k, n);
      l.deck.lade(&s1000.m, 0);
      const int64_t e0 = std::llround(k.sample_at(12.0));
      l.genau(e0 - v);
      l.plan = {true, e0 - v, 12.0, 4 * 22500, 92};
      l.teil(B);
      const double b0 = l.k.beat_at((double)l.s) + 0.01;
      PRUEF(l.k.rampe(b0, ziel, 11.98 - b0));
      ++l.gen;
      l.start_am_ziel();
      l.bis(n);
      const int64_t e = std::llround(l.k.sample_at(12.0));
      int64_t on = -1;
      for (int64_t t = e - 2000; t < e + 8000; ++t)
        if (std::fabs(l.L[(size_t)t]) > 0.25) {
          on = t - e;
          break;
        }
      const double ref = rms(l.L, e + 30000, 480);
      double tief = 1e9;
      for (int64_t t = e + 48; t < e + 8000; ++t) tief = std::min(tief, rms(l.L, t, 24));
      // rohes R3 gleicher Speisung (nur für den Plan mit still: dort klingt ab dem Einsatz allein der Ring)
      const bool mit_still = v >= cdj::DECK_START_VORLAUF;
      double dmax = -1;
      int64_t on_roh = -99999;
      if (mit_still) {
        const int64_t s_h = l.deck.keylock_s_h();
        const DehnerAnker a{12.0, (double)(4 * 22500)};
        const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
        cdj::DeckBand ref_b;
        ref_b.m = &s1000.m;
        ref_b.still_bis.store(4 * 22500);
        // Band-Start mit der Karte nach der Rampe: eine neue Karte vor s_h erneuert den Ansatz (Vorbereiter, neue Epoche)
        const std::vector<float> R = fs.empty() ? std::vector<float>() : km::r3_roh(ref_b, km::band_start(l.k, a, s_h, fs.at(0)), fs, s_h, n);
        dmax = 0;
        if (!R.empty()) {
          for (int64_t t = e - 900; t < e + 8000; ++t) dmax = std::max(dmax, (double)std::fabs(l.L[(size_t)t] - R[(size_t)t]));
          for (int64_t t = e - 2000; t < e + 8000; ++t)
            if (std::fabs(R[(size_t)t]) > 0.25) {
              on_roh = t - e;
              break;
            }
        }
      }
      std::printf("  rampe_bremst 132 -> %3.0f V %5lld (%s): geplant ok %llu, Einsatz bei E%+lld (rohes R3 gleicher Speisung %s), kleinster "
                  "24er ab E+48 %.3f, Deck gegen rohes R3 max |Δ| %s\n",
                  ziel, (long long)v, mit_still ? "mit still" : "früh, ohne still", (unsigned long long)l.deck.keylock_geplant_ok(),
                  (long long)on, on_roh == -99999 ? "-" : ("E" + std::string(on_roh >= 0 ? "+" : "") + std::to_string(on_roh)).c_str(),
                  tief / ref, dmax < 0 ? "-" : std::to_string(dmax).c_str());
      PRUEF(l.deck.keylock_geplant_ok() == 1 && on >= 0 && on <= RAMPE_VERZUG_MAX);
      if (mit_still) PRUEF(on_roh != -99999 && std::llabs(on - on_roh) <= 12);  // der Verzug liegt in R3 (Lage wie Messgröße b)
    }
  ergebnis("rampe_bremst");
}

// ziel_ohne_start bei 100 und 132 BPM (Fix-Runde 2 Q2-1): Ziel erreicht ohne Start, Fenster ab E (in der 128er Ausblende). Der Plan
// fällt am Ziel; die Spitze in [E, E + 128) ist die Restzone (ausgewiesen, ≤ RESTZONE_MAX der Eins), ab E + 128 ≤ 0,01.
void test_ziel_ohne_start_tempi() {
  static km::MatProbe klick(64, 0, "c1c0000000000663");
  for (const double bpm : {100.0, 132.0}) {
    const Karte k(bpm, 0);
    const int64_t n = std::llround(k.sample_at(16.0));
    double eins = 0;
    {
      DeckLauf l(k, n);
      l.deck.lade(&klick.m, 0);
      l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 64};
      const int64_t e = l.s_t();
      l.start_am_ziel();
      l.bis(n);
      eins = spitze(l.L, e - 1000, e + 1000);
    }
    DeckLauf l(k, n);
    l.deck.lade(&klick.m, 0);
    l.plan = {true, std::llround(k.sample_at(8.5)) / B * B, 12.0, 4 * 22500, 64};
    const int64_t e = l.s_t();
    l.genau(e);
    l.plan.an = false;
    l.bis(n);
    const double sp0 = spitze(l.L, e, e + 128), sp1 = spitze(l.L, e + 128, e + 4800);
    std::printf("  ziel_ohne_start %3.0f BPM: Plan danach %d, Spitze [E, E + 128) %.4f (%.0f %% der Eins %.4f), ab E + 128 %.4f [Restzone]\n",
                bpm, (int)l.deck.keylock_plan_aktiv(), sp0, 100.0 * sp0 / eins, eins, sp1);
    PRUEF(!l.deck.keylock_plan_aktiv() && sp0 <= RESTZONE_MAX * eins + 1e-6 && sp1 <= 0.01);
  }
  ergebnis("ziel_ohne_start_tempi");
}

// ------------------------------------------------------------------------------------------ K6a kern_start_geplant
// Der Planer im Kern (kern_deck.cpp deck_planen, decks_block): Kern ohne JACK, Dehner synchron (keylock_vorbereiten,
// keylock_fuellen je Zyklus wie test_deck_keylock Test 8), Material klick_fassung.py --sinus-links 1000 (links Sinus, rechts
// Klicks), Karte auf 132. /k/deck/start bei Beat 8 (quell_beat 4), Befehl rund 1,5 Beats vorher: Deck 1 plant (s_h =
// s_t − 2176), setzt ohne neuen Ansatz ein (geplant_ok 1), Master links im 100-ms-Fenster ab dem Einsatz ±5 ct und je 10-ms-
// Fenster ab 50 ms ±2 ct (die Brücke spielte +53,3 ct). Gegenprobe im selben Kern: zweiter Start (nach Stopp) mit rund 57 ms
// Vorlauf (unter ANSATZ_FRIST): zu_kurz, Ansatz s + 4096 (heutiger Weg, Brücke +53 ct im ersten Fenster).
namespace kt {
struct KRing {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* k = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  KRing() {
    k->version = CDJ_RING_VERSION;
    k->rate = CDJ_RING_RATE;
    k->kanaele = CDJ_RING_KANAELE;
    k->cap = CDJ_RING_CAP;
    std::memcpy(k->magic, "CDJB", 4);
  }
};
struct KLauf {
  KRing ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader;
  std::unique_ptr<cdj::Kern> kern;
  int64_t W = 0, id = 100;
  std::vector<float> master, master_r;  // Master links, rechts
  std::unique_ptr<hand::Mapping> mapping{new hand::Mapping()};
  KLauf(const std::string& ab, bool mit_hand = false) : lader(ab, 3800LL << 20) {
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    kern->setze_keylock_vorgabe(true);
    if (mit_hand) {  // Mapping mvp_voll.json (Stopp-Taste Kanal 16 Note 0), wie test_kern_deck_hand
      hand::Fehler f;
      const std::string p = std::string(CYPHERDJ_DJK) + "/kern/tests/hand/mappings/mvp_voll.json";
      const bool ok = hand::lade_datei(p.c_str(), kern->stellwerk().tabelle(), mapping.get(), &f);
      if (!ok) std::fprintf(stderr, "Mapping %s: %s\n", p.c_str(), f.text);
      PRUEF(ok);
      kern->setze_mapping(mapping.get());
    }
  }
  // MIDI für den nächsten Zyklus (Versatz 0), wie aus hand_in
  void midi_jetzt(uint8_t a, uint8_t b, uint8_t c) {
    const uint8_t d[3] = {a, b, c};
    kern->hand_midi(d, 3, 0);
  }
  void befehl(cdj::Befehl b) {
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "pruefstand");
    PRUEF(bef->schiebe(b));
  }
  void zyklus() {
    const uint64_t w0 = cdj_lade(&ring.k->w);
    const int64_t mono = (int64_t)std::llround((double)W * 1e9 / 48000.0);
    kern->zyklus(B, mono);
    lader.einmal(*lr);
    kern->keylock_vorbereiten();
    kern->keylock_fuellen(1);
    const int64_t n0 = kern->sample() - B;
    const float* x = cdj_ring_daten_c(ring.k);
    const int vh = kern->mixer().limiter_vorhalt();
    if ((int64_t)master.size() < n0 + B) {
      master.resize((size_t)(n0 + B), 0.0f);
      master_r.resize((size_t)(n0 + B), 0.0f);
    }
    for (int i = 0; i < B; ++i)
      if (n0 + i - vh >= 0) {
        master[(size_t)(n0 + i - vh)] = x[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
        master_r[(size_t)(n0 + i - vh)] = x[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4 + 1];
      }
    cdj::Ereignis e;
    while (ere->hole(e)) {
    }
    W += B;
  }
  void bis(int64_t s) {
    while (kern->sample() < s) zyklus();
  }
};
}  // namespace kt

void test_kern_start_geplant() {
  namespace fs = std::filesystem;
  const std::string ab = "/dev/shm/test_deck_geplant_" + std::to_string(getpid());
  fs::create_directories(ab);
  const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab +
                        " --material-id c1c0000000000646 --beats 96 --sinus-links 1000 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  {
    kt::KLauf k(ab);
    cdj::Befehl l{};
    l.art = cdj::Befehl::DECK_LADEN;
    l.deck = 1;
    std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000646");
    l.bpm = 128.0;
    l.fassung = 1;
    k.befehl(l);
    cdj::Befehl r{};
    r.art = cdj::Befehl::TEMPO_RAMPE;
    r.ab_beat = 0.25;
    r.ziel_bpm = 132.0;
    r.dauer_beats = 0.5;
    k.befehl(r);
    cdj::Befehl fd{};  // Fader auf (wie test_deck_keylock Test 8)
    fd.art = cdj::Befehl::TEIL;
    std::snprintf(fd.pfad, sizeof fd.pfad, "deck/1/fader");
    fd.ab_beat = 0.5;
    fd.wert = 0.0f;
    fd.politik = 1;
    k.befehl(fd);
    const Karte k132(132.0, 0);
    auto start = [&](double ab_beat, double quell) {
      cdj::Befehl st{};
      st.art = cdj::Befehl::DECK_START;
      st.deck = 1;
      st.ab_beat = ab_beat;
      st.quell_beat = quell;
      k.befehl(st);
    };
    auto stopp = [&](double ab_beat) {
      cdj::Befehl st{};
      st.art = cdj::Befehl::DECK_STOPP;
      st.deck = 1;
      st.ab_beat = ab_beat;
      st.politik = 1;
      k.befehl(st);
    };
    const cdj::Karte& karte = k.kern->karte();
    k.bis(std::llround(karte.sample_at(6.5)));
    start(8.0, 4.0);
    const int64_t e1 = std::llround(karte.sample_at(8.0));
    k.bis(e1 - B);
    const cdj::Deck& dk = k.kern->deck(1);
    const bool plan1 = dk.keylock_plan_aktiv();
    const int64_t sh1 = dk.keylock_s_h();
    k.bis(e1 + 24000);
    const uint64_t ok1 = dk.keylock_geplant_ok();
    // zweiter Start mit 100 ms Vorlauf (unter 6272): heutiger Weg
    stopp(std::ceil(karte.beat_at((double)k.kern->sample())) + 1.0);
    k.bis(std::llround(karte.sample_at(std::ceil(karte.beat_at((double)k.kern->sample())) + 3.0)));
    const double b2 = std::ceil(karte.beat_at((double)k.kern->sample())) + 2.0;
    k.bis(std::llround(karte.sample_at(b2)) - 3000);
    start(b2, 20.0);  // gilt im nächsten Zyklus: Vorlauf 3000 − 256 (≤ ANSATZ_FRIST: heutiger Weg, Fix-Runde 1 F3)
    const int64_t e2 = std::llround(karte.sample_at(b2));
    k.bis(e2 + B);
    const int64_t sh2 = dk.keylock_s_h();
    k.bis(e2 + 24000);
    // Kleinste Quadrate statt Nulldurchgänge: rechts liegen Klicks, R3 rechnet die Kanäle zusammen (test_kern_keylock_faeden Ton)
    const double ct1 = ct_fenster(k.master, e1, 4800, 1000.0), ct2 = ct_fenster(k.master, e2, 4800, 1000.0, 1031.25);
    double ct10 = 0;
    for (int j = 0; j < 30; ++j) ct10 = std::max(ct10, std::fabs(ct_fenster(k.master, e1 + 2400 + j * 480, 480, 1000.0)));
    std::printf("  K6a Kern 132: Start 1 (Vorlauf %lld): geplant %d, s_h %lld (s_t − %lld), geplant_ok %llu, 100 ms ab dem Einsatz "
                "%+.2f ct, 10-ms-Fenster ab 50 ms max %.3f ct; Start 2 (Vorlauf rund 2750): s_h %lld (s_t − %lld), zu_kurz %llu, "
                "geplant_ok %llu, 100 ms ab dem Einsatz %+.2f ct\n",
                (long long)(e1 - std::llround(karte.sample_at(6.5))), (int)plan1, (long long)sh1, (long long)(e1 - sh1),
                (unsigned long long)ok1, ct1, ct10, (long long)sh2, (long long)(sh2 - e2),
                (unsigned long long)dk.keylock_geplant_zu_kurz(), (unsigned long long)dk.keylock_geplant_ok(), ct2);
    PRUEF(plan1 && sh1 == e1 - cdj::STRECK_EINSCHWING - cdj::DECK_VORLAGE && ok1 == 1);
    const double pegel1 = rms(k.master, e1 + 2400, 4800), pegel2 = rms(k.master, e2 + 2400, 4800);
    std::printf("  K6a Pegel Master links nach Einsatz 1/2: %.4f / %.4f (Instrument sieht Ton)\n", pegel1, pegel2);
    PRUEF(pegel1 > 0.05 && pegel2 > 0.05);
    PRUEF(std::fabs(ct1) <= 5.0 && ct10 <= 2.0);
    // Gegenprobe: zu kurz geplant -> Ansatz am Ereignis, die Brücke klingt (Varispeed +53,3 ct)
    PRUEF(dk.keylock_geplant_zu_kurz() == 1 && dk.keylock_geplant_ok() == 1 && sh2 > e2);
    PRUEF(std::fabs(ct2 - 1200.0 * std::log2(132.0 / 128.0)) < 3.0);
    (void)k132;
  }
  fs::remove_all(ab);
  ergebnis("kern_start_geplant");
}

// Q2/Q3 kern_abbruch: der Kern-Planer nimmt einen geplanten Start zurück, wenn seine Aktion fällt (deck_planen, /k/abbruch und
// KI-Stopp; der KI-Stopp streicht die wartenden Aktionen von "cypher" am Zyklusanfang). Material klick_fassung.py --sinus-links
// 1000 (links Sinus, rechts Klicks), 60 und 132 BPM, Start bei Beat 8, Eingriff am letzten Zyklusanfang vor E − 500, E − 250, E − 20 (in der
// Vorlage) und vor E − 3000 (im Wartefenster). Gewertet: danach kein Plan aktiv; Master links größter Nachbarsprung in [Eingriff − 64,
// Eingriff + 2000) ≤ 0,1089 (T18); Master rechts (Klick der Eins) Spitze ab Eingriff + DECK_VORLAGE_AUS (128) bis E + 4800 ≤ 0,01
// (Stand vor 6a: 0; 9f78da53 bei 60 BPM 0,19 bzw. 0,27: der Einsatz des abgebrochenen Starts klang in der 960er Ausblende).
void test_kern_abbruch() {
  namespace fs = std::filesystem;
  const std::string ab = "/dev/shm/test_deck_geplant_ab_" + std::to_string(getpid());
  fs::create_directories(ab);
  const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab +
                        " --material-id c1c0000000000647 --beats 96 --sinus-links 1000 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  for (const double bpm : {60.0, 132.0})
    for (const int64_t lage : {(int64_t)500, (int64_t)250, (int64_t)20, (int64_t)3000}) {
      double sp_ohne = 0;  // derselbe Lauf ohne Eingriff: größter Nachbarsprung im selben Fenster
      for (int art = 0; art <= 2; ++art) {  // 0 ohne Eingriff (Bezug), 1 /k/abbruch, 2 KI-Stopp
        kt::KLauf k(ab);
        auto bef = [&](cdj::Befehl b, const char* quelle) {
          b.id = ++k.id;
          std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
          PRUEF(k.bef->schiebe(b));
        };
        cdj::Befehl l{};
        l.art = cdj::Befehl::DECK_LADEN;
        l.deck = 1;
        std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000647");
        l.bpm = 128.0;
        l.fassung = 1;
        bef(l, "pruefstand");
        cdj::Befehl r{};
        r.art = cdj::Befehl::TEMPO_RAMPE;
        r.ab_beat = 0.25;
        r.ziel_bpm = bpm;
        r.dauer_beats = 0.5;
        bef(r, "pruefstand");
        cdj::Befehl fd{};
        fd.art = cdj::Befehl::TEIL;
        std::snprintf(fd.pfad, sizeof fd.pfad, "deck/1/fader");
        fd.ab_beat = 0.5;
        fd.wert = 0.0f;
        fd.politik = 1;
        bef(fd, "pruefstand");
        const cdj::Karte& karte = k.kern->karte();
        k.bis(std::llround(karte.sample_at(6.5)));
        const char* q = art == 2 ? "cypher" : "pruefstand";
        cdj::Befehl st{};
        st.art = cdj::Befehl::DECK_START;
        st.deck = 1;
        st.ab_beat = 8.0;
        st.quell_beat = 4.0;
        std::snprintf(st.plan, sizeof st.plan, "p6a");
        bef(st, q);
        const int64_t e = std::llround(karte.sample_at(8.0));
        while (k.kern->sample() + B <= e - lage) k.zyklus();  // Eingriff am letzten Zyklusanfang vor E − lage
        const cdj::Deck& dk = k.kern->deck(1);
        const bool plan_vor = dk.keylock_plan_aktiv(), vor = dk.keylock_vorlage();
        const int64_t s_ev = k.kern->sample();  // der Befehl wirkt am Anfang des nächsten Zyklus
        if (art == 0) {
        } else if (art == 1) {
          cdj::Befehl a{};
          a.art = cdj::Befehl::ABBRUCH;
          std::snprintf(a.plan, sizeof a.plan, "p6a");
          std::snprintf(a.liste, sizeof a.liste, "*");
          bef(a, q);
        } else {
          cdj::Befehl a{};
          a.art = cdj::Befehl::KI_STOPP;
          bef(a, "pruefstand");
        }
        k.zyklus();
        const bool plan_nach = dk.keylock_plan_aktiv();
        k.bis(e + 6000);
        double sp = 0, nach = 0, en = 0, sp_vor = 0;
        int64_t sp_ort = 0;
        for (int64_t t = s_ev - 64; t < s_ev + 2000; ++t) {
          const double d = std::fabs((double)k.master[(size_t)t] - (double)k.master[(size_t)t - 1]);
          if (d > sp) sp = d, sp_ort = t;
        }
        // Bezug: größter Nachbarsprung in der Vorlage vor dem Eingriff (der Ring klingt dort ungestört)
        for (int64_t t = e - 768; t < s_ev; ++t)
          sp_vor = std::max(sp_vor, std::fabs((double)k.master[(size_t)t] - (double)k.master[(size_t)t - 1]));
        for (int64_t t = s_ev + 128; t < e + 4800; ++t) {
          nach = std::max(nach, (double)std::fabs(k.master_r[(size_t)t]));
          en += (double)k.master_r[(size_t)t] * k.master_r[(size_t)t];
        }
        double vorher = 0;  // rechts in der Vorlage bis zum Eingriff (der schon gehörte Teil)
        for (int64_t t = e - 768; t < s_ev; ++t) vorher = std::max(vorher, (double)std::fabs(k.master_r[(size_t)t]));
        std::printf("  kern_abbruch %3.0f BPM %-8s Eingriff E%+5lld: Plan vorher %d (Vorlage hörbar %d), nachher %d; links größter "
                    "Sprung %.4f bei Eingriff%+lld (in der Vorlage davor %.4f); rechts Spitze bis zum Eingriff %.4f, ab Eingriff + 128 %.4f (Energie %.5f); läuft %d\n",
                    bpm, art == 0 ? "ohne" : art == 1 ? "Abbruch" : "KI-Stopp", (long long)(s_ev - e), (int)plan_vor, (int)vor, (int)plan_nach, sp,
                    (long long)(sp_ort - s_ev), sp_vor, vorher, nach, en, (int)dk.laeuft());
        if (art == 0) {
          sp_ohne = sp;
          continue;
        }
        PRUEF(plan_vor && !plan_nach && !dk.laeuft());
        PRUEF(sp <= std::max(2.0 * sprung::natuerlich(832.0, 0.5), sp_ohne) && nach <= 0.01);
      }
    }
  fs::remove_all(ab);
  ergebnis("kern_abbruch");
}

// Q2-1/Test-1/Q3-N1 kern_hand_stopp: ein geplanter Start von "cypher" am Kern (100 und 132 BPM, Klick rechts); die Stopp-Taste der Hand
// (MIDI, Mapping mvp_voll.json, Kanal 16 Note 0) im Zyklus, in dem der Einsatz liegt, bzw. im Zyklus davor. hand_zyklus läuft nach
// decks_uebernehmen, die Aktion wird in diesem Zyklus nicht gestrichen. Gewertet: danach kein Plan aktiv, das Deck läuft nicht;
// Klick rechts ab dem Zyklusanfang des Stopps bis E + 4800 ≤ 0,01, wenn der Eingriff mindestens RESTZONE_BREITE vor E liegt, sonst
// Restzone (ausgewiesen, so wie sie am Kern noch erreichbar ist: der Stopp wirkt am Zyklusanfang, also bis zu 255 Samples vor E). e0968ef9: der Plan blieb bis E, die Ausblende ab E trug den Einsatz (Prüfung: 100 BPM 0,504).
void test_kern_hand_stopp() {
  namespace fs = std::filesystem;
  const std::string ab = "/dev/shm/test_deck_geplant_hs_" + std::to_string(getpid());
  fs::create_directories(ab);
  const std::string c = "/usr/bin/python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + ab +
                        " --material-id c1c0000000000662 --beats 96 --sinus-links 1000 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  for (const double bpm : {100.0, 132.0})
    for (const int64_t off : {(int64_t)40, (int64_t)150, (int64_t)300, (int64_t)500}) {  // Einsatz − Zyklusanfang des Stopps
      double eins = 0;  // Bezug aus dem Lauf ohne Stopp
      for (int stopp = 0; stopp < 2; ++stopp) {
        kt::KLauf k(ab, true);
        auto bef = [&](cdj::Befehl b, const char* quelle) {
          b.id = ++k.id;
          std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
          PRUEF(k.bef->schiebe(b));
        };
        cdj::Befehl l{};
        l.art = cdj::Befehl::DECK_LADEN;
        l.deck = 1;
        std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000662");
        l.bpm = 128.0;
        l.fassung = 1;
        bef(l, "pruefstand");
        cdj::Befehl r{};
        r.art = cdj::Befehl::TEMPO_RAMPE;
        r.ab_beat = 0.25;
        r.ziel_bpm = bpm;
        r.dauer_beats = 0.5;
        bef(r, "pruefstand");
        cdj::Befehl fd{};
        fd.art = cdj::Befehl::TEIL;
        std::snprintf(fd.pfad, sizeof fd.pfad, "deck/1/fader");
        fd.ab_beat = 0.5;
        fd.wert = 0.0f;
        fd.politik = 1;
        bef(fd, "pruefstand");
        const cdj::Karte& karte = k.kern->karte();
        k.bis(std::llround(karte.sample_at(4.0)));
        // Einsatz so legen, dass er off Samples hinter einem Zyklusanfang liegt
        const int64_t n_stopp = (std::llround(karte.sample_at(8.0)) / B) * B;
        const double b_e = karte.beat_at((double)(n_stopp + off) + 0.25);  // + 0,25: llround(sample_at) trifft n_stopp + off
        cdj::Befehl st{};
        st.art = cdj::Befehl::DECK_START;
        st.deck = 1;
        st.ab_beat = b_e;
        st.quell_beat = 4.0;
        bef(st, "cypher");
        const int64_t e = std::llround(karte.sample_at(b_e));
        k.bis(n_stopp);
        const cdj::Deck& dk = k.kern->deck(1);
        const bool plan_vor = dk.keylock_plan_aktiv();
        if (stopp) k.midi_jetzt(0x9F, 0, 127);  // Stopp-Taste der Hand im Zyklus ab n_stopp
        k.zyklus();
        k.midi_jetzt(0x8F, 0, 0);
        const bool plan_nach = dk.keylock_plan_aktiv();
        k.bis(e + 6000);
        const double sp = spitze(k.master_r, n_stopp, e + 4800);
        if (!stopp) eins = spitze(k.master_r, e - 1000, e + 1000);
        std::printf("  kern_hand_stopp %3.0f BPM %s, E − Zyklusanfang %3lld: Plan vorher %d, nach dem Zyklus %d, läuft %d; rechts Spitze ab "
                    "Zyklusanfang %.4f (%.0f %% der Eins %.4f)%s\n",
                    bpm, stopp ? "Stopp-Taste" : "ohne       ", (long long)(e - n_stopp), (int)plan_vor, (int)plan_nach, (int)dk.laeuft(),
                    sp, eins > 0 ? 100.0 * sp / eins : 0.0, eins, stopp && e - n_stopp < RESTZONE_BREITE ? "  [Restzone]" : "");
        PRUEF(plan_vor);
        if (stopp) {
          PRUEF(!plan_nach && !dk.laeuft());
          PRUEF(e - n_stopp >= RESTZONE_BREITE ? sp <= 0.01 : sp <= RESTZONE_MAX * eins + 1e-6);
        } else {
          PRUEF(dk.laeuft() && eins > 0.1);  // Gegenprobe: ohne Stopp klingt der Einsatz
        }
      }
    }
  fs::remove_all(ab);
  ergebnis("kern_hand_stopp");
}


// ================================================================================================== Keylock 6b (W3), Step 5
// Plan Task 6, Detailschnitt 3.3 und 3.6: das PlanBand (DeckBand mit Wechsel) und der zweite Freigabeweg der StreckLeihe.

// Bezug für ein PlanBand, Frame für Frame aus deck_lies gerechnet (die Rechnung aus 3.3, unabhängig von DeckBand::band):
// p < p_sw − x alt, p >= p_sw neu, dazwischen alt · (1 − w) + neu · w mit w = (p − (p_sw − x) + 1) / x.
void plan_bezug(const cdj::DeckBand& b, const float* gw, int64_t p, float& l, float& r) {
  float al, ar, nl, nr;
  cdj::deck_lies(b.m, gw, b.off, b.loop_a, b.loop_l, b.loop_lx, p, 1, &al, &ar);
  cdj::deck_lies(b.m, gw, b.off_neu, b.loop2_a, b.loop2_l, b.loop2_lx, p, 1, &nl, &nr);
  if (b.p_sw == INT64_MAX || p < b.p_sw - b.x) {
    l = al, r = ar;
  } else if (p >= b.p_sw) {
    l = nl, r = nr;
  } else {
    const float w = (float)(p - (b.p_sw - b.x) + 1) / (float)b.x;
    l = nl * w + al * (1.0f - w);
    r = nr * w + ar * (1.0f - w);
  }
  if (p < b.still_bis.load()) l = r = 0.0f;
}

// ------------------------------------------------------------------------------------------ W3 band_wechsel (Step 5)
// DeckBand::band mit Wechsel gegen den Bezug, in Lesestücken wechselnder Länge über die Blende und das Ziel hinweg (zustandslos,
// zwei Fäden lesen dieselben Stellen in anderen Stücken). Fälle: Sprung vorwärts mit Blende 128 (Basis 125,3, Stems 0,7 / 0,3),
// Sprung rückwärts, Sprung mit Versatz alt ≠ 0 (zweiter Plan nach einem ersten), Loop an (x = 0, loop2), Blende 1. Grenze: 0
// Frames ungleich. Gegenprobe: das Band ist ab p_sw wirklich anders als ohne Wechsel (sonst wäre der Vergleich blind).
void test_band_wechsel() {
  static MatRauschen mr(125.3, 600000);
  std::atomic<float> g[cdj::STEM_ANZAHL] = {0.7f, 0.3f, 1.0f, 1.0f};
  const float gw[cdj::STEM_ANZAHL] = {0.7f, 0.3f, 1.0f, 1.0f};
  const double fpb = cdj::FRAMES_JE_MINUTE / 125.3;
  struct Fall {
    const char* name;
    int64_t off, p_sw, off_neu;
    int x;
    int64_t l2a, l2l;
    double l2x;
  } faelle[] = {{"Sprung +4 Beat, Blende 128", 0, 150000, std::llround(4 * fpb), 128, 0, 0, 0.0},
                {"Sprung -2 Beat, Blende 128", 0, 150000, -std::llround(2 * fpb), 128, 0, 0, 0.0},
                {"zweiter Plan, off 3000", 3000, 170000, 3000 + 77777, 128, 0, 0, 0.0},
                {"Loop an 4 Beat, x 0", 0, 150000, 0, 0, 152000, std::llround(4 * fpb), 4 * fpb},
                {"Blende 1", 0, 150000, 5000, 1, 0, 0, 0.0}};
  static const int laengen[] = {1, 7, 256, 1000, 4096, 333, 127, 129};
  bool gesamt_ok = true;
  for (const Fall& fa : faelle) {
    cdj::DeckBand b;
    b.m = &mr.m;
    b.g = g;
    b.off = fa.off;
    b.p_sw = fa.p_sw;
    b.off_neu = fa.off_neu;
    b.x = fa.x;
    b.loop2_a = fa.l2a;
    b.loop2_l = fa.l2l;
    b.loop2_lx = fa.l2x;
    int64_t ungleich = 0, anders = 0;
    std::vector<float> l(4096), r(4096);
    for (int versatz = 0; versatz < 3; ++versatz) {
      const int64_t von = fa.p_sw - 9000 + versatz * 37, bis = fa.p_sw + 4 * std::llround(4 * fpb) + 9000;
      int j = versatz;
      for (int64_t p = von; p < bis; ++j) {
        const int n = (int)std::min<int64_t>(laengen[j % 8], bis - p);
        b.band(p, n, l.data(), r.data());
        for (int i = 0; i < n; ++i) {
          float bl, br, ol, orr;
          plan_bezug(b, gw, p + i, bl, br);
          cdj::deck_lies(&mr.m, gw, fa.off, 0, 0, 0.0, p + i, 1, &ol, &orr);
          ungleich += (l[(size_t)i] != bl || r[(size_t)i] != br) ? 1 : 0;
          anders += (p + i >= fa.p_sw && (bl != ol || br != orr)) ? 1 : 0;
        }
        p += n;
      }
    }
    std::printf("  band_wechsel %-28s ungleich zum Bezug %lld, ab p_sw anders als ohne Wechsel %lld\n", fa.name, (long long)ungleich,
                (long long)anders);
    PRUEF(ungleich == 0);
    PRUEF(anders > 0);  // Loop an: anders erst ab der ersten Naht (liegt im Fenster)
    gesamt_ok = gesamt_ok && ungleich == 0;
  }
  // Ohne Wechsel (p_sw = INT64_MAX, off = 0) ist das Band das gewöhnliche: dieselbe Folge wie DeckBand ohne die neuen Felder
  // gesetzt (Vorgabewerte) — die Prüfsummen des Stands vor 6a stehen in band_bitgleich.
  ergebnis("band_wechsel");
}

// ------------------------------------------------------------------------------------------ W3 leihe_wechsel (Step 5)
// StreckLeihe, zweiter Freigabeweg (Plan 3.6 mit Entscheid der Hauptinstanz: (T) über wechsel_bestaetigt() >= wnr). Fälle:
//  a) abgeben_wechsel(A, 5): pflege mit 2 Argumenten (Box, alter Aufrufer) gibt nie frei; bestätigt 4 nicht, 5 frei.
//  b) Überlauf: wnr 0xFFFFFFFF, bestätigt 1 (nach dem Überlauf) frei; bestätigt 0xFFFFFFFE nicht.
//  c) beide Wege für denselben Platz: der Epochenweg gibt frei, auch wenn bestätigt nie kommt.
//  d) Negativ-Kontrolle: ein Platz ohne Abgabe bleibt bei beliebigen Zahlen belegt; abgeben_wechsel auf ein fremdes Band ändert nichts.
void test_leihe_wechsel() {
  using L8 = cdj::StreckLeihe<cdj::DeckBand, 8>;
  const uint64_t ant = (uint64_t(7) << 32) | 3u;  // Antwort: Auftrag 7, Epoche 3
  {  // a
    L8 l;
    cdj::DeckBand* a = l.nimm();
    l.abgeben_wechsel(a, 5);
    l.pflege(ant, 3);
    const int nach2 = l.belegt();
    l.pflege(ant, 3, 4);
    const int nach4 = l.belegt();
    l.pflege(ant, 3, 5);
    const int nach5 = l.belegt();
    std::printf("  leihe_wechsel a: belegt nach pflege(2 Arg.) %d, bestätigt 4 %d, bestätigt 5 %d\n", nach2, nach4, nach5);
    PRUEF(nach2 == 1 && nach4 == 1 && nach5 == 0);
  }
  {  // b
    L8 l;
    cdj::DeckBand* a = l.nimm();
    l.abgeben_wechsel(a, 0xFFFFFFFFu);
    l.pflege(ant, 3, 0xFFFFFFFEu);
    const int vor = l.belegt();
    l.pflege(ant, 3, 1);
    std::printf("  leihe_wechsel b (Überlauf): belegt bei bestätigt 0xFFFFFFFE %d, bei 1 %d\n", vor, l.belegt());
    PRUEF(vor == 1 && l.belegt() == 0);
  }
  {  // c
    L8 l;
    cdj::DeckBand* a = l.nimm();
    l.abgeben_wechsel(a, 9);
    l.abgeben(a, 7);  // Epochenweg: frei, wenn Antwort für 7 da und ihre Epoche quittiert
    l.pflege(ant, 2, 1);
    const int vor = l.belegt();
    l.pflege(ant, 3, 1);
    std::printf("  leihe_wechsel c (beide Wege): belegt vor der Quittung %d, nach %d\n", vor, l.belegt());
    PRUEF(vor == 1 && l.belegt() == 0);
  }
  {  // d
    L8 l;
    cdj::DeckBand* a = l.nimm();
    cdj::DeckBand fremd;
    l.abgeben_wechsel(&fremd, 1);
    for (uint32_t b : {0u, 1u, 5u, 0xFFFFFFFFu}) l.pflege(ant, 3, b);
    std::printf("  leihe_wechsel d (Negativ): belegt %d (Soll 1)\n", l.belegt());
    PRUEF(l.belegt() == 1 && a != nullptr);
  }
  ergebnis("leihe_wechsel");
}

// ------------------------------------------------------------------------------------------ W3 leihe_gen (Step 5, Prüfbau)
// Generationszähler (Plan 3.6): nimm macht den Platz ungerade, Freigabe gerade; band() auf einem freien Platz zählt
// deck_band_gen_verletzt. Positiv: Lesung nach Freigabe +1; Negativ: Lesung verliehen +0, Band außerhalb der Leihe +0.
void test_leihe_gen() {
#ifdef CYPHERDJ_PRUEF_GEN
  static MatRauschen mr(128.0, 10000);
  using L8 = cdj::StreckLeihe<cdj::DeckBand, 8>;
  L8 l;
  cdj::DeckBand* a = l.nimm();
  a->m = &mr.m;
  float x[16], y[16];
  const uint64_t v0 = cdj::deck_band_gen_verletzt();
  a->band(0, 16, x, y);
  const uint64_t v1 = cdj::deck_band_gen_verletzt();
  cdj::DeckBand frei;
  frei.m = &mr.m;
  frei.band(0, 16, x, y);
  const uint64_t v2 = cdj::deck_band_gen_verletzt();
  const uint32_t g_verliehen = a->pruef_gen.load();
  l.abgeben_wechsel(a, 1);
  l.pflege(0, 0, 1);
  const uint32_t g_frei = a->pruef_gen.load();
  a->band(0, 16, x, y);
  const uint64_t v3 = cdj::deck_band_gen_verletzt();
  std::printf("  leihe_gen: Generation verliehen %u, frei %u; verletzt +%llu verliehen, +%llu außerhalb, +%llu nach Freigabe\n", g_verliehen,
              g_frei, (unsigned long long)(v1 - v0), (unsigned long long)(v2 - v1), (unsigned long long)(v3 - v2));
  PRUEF(l.belegt() == 0 && (g_verliehen & 1u) == 1 && g_frei != 0 && (g_frei & 1u) == 0);
  PRUEF(v1 == v0 && v2 == v1 && v3 == v2 + 1);
#else
  std::printf("  leihe_gen: nur im Prüfbau (CYPHERDJ_PRUEF_GEN), hier nicht gebaut\n");
#endif
  ergebnis("leihe_gen");
}

// ================================================================================================== Keylock 6b (W3), Step 6
// Plan Task 6, Detailschnitt 3.4 bis 3.7 auf Deck-Ebene (ohne den Planer des Kerns, Step 7): das laufende Deck im Ring, der Test
// plant je Blockanfang wie der Kern (kl_plane ab plan.ab, s_t aus der Karte, f_neu aus frame_bei), führt am Ziel aus (genau am
// Sample) und misst. Dehner synchron (Vorbereiter, dann Arbeits-Thread nach jedem Block), wie DeckLauf.
// Grenzen „vor p_gleich_bis bitgleich“: W2 hat gemessen, dass R3 eine Abweichung des Neubands rund 2,8k Samples VOR p_gleich_bis
// wirken lässt (W1b, Grenze −4096). Fenster vor dem Ziel liegen darum entweder vor s_t − 128 − 4096 oder prüfen ein Material, in dem
// Alt und Neu gleich sind (kohärenter Sprung, P1).

int64_t plan_vorlauf6b(double bpm, double basis = 128.0) { return (int64_t)std::ceil(3686.0 + 2176.0 / (bpm / basis)); }

// Sinus 1000 Hz mit Pegelmarke je Quell-Beat: Pegel 0,25 + 0,05 · (k mod 7) im Beat k (Basis 128, 22500 Frames je Beat)
double marke_pegel(int64_t k) { return 0.25 + 0.05 * (double)(k % 7); }
struct MatMarke {
  std::vector<float> d;
  cdj::Material m{};
  MatMarke(int64_t frames, const char* id = "c1c0000000000650") {
    std::snprintf(m.material_id, sizeof m.material_id, "%s", id);
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = 1;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    d.resize((size_t)(2 * frames));
    for (int64_t f = 0; f < frames; ++f)
      d[(size_t)(2 * f)] = d[(size_t)(2 * f + 1)] = (float)(marke_pegel(f / 22500) * std::sin(2 * km::PI * 1000.0 * (double)f / 48000.0));
    m.quelle[0] = d.data();
  }
};
// Klick je Quell-Beat erst ab Beat q0 (davor Stille): ein Sprung, der nicht geschieht, hat dort keinen Klick
struct MatKlickAb {
  km::MatProbe p;
  MatKlickAb(double beats, int64_t q0, const char* id) : p(beats, 0, id) {
    std::fill(p.d.begin(), p.d.begin() + (ptrdiff_t)std::min<int64_t>((int64_t)p.d.size(), 2 * q0 * 22500), 0.0f);
  }
};

struct WLauf {
  Karte k;
  uint32_t gen = 1;
  std::unique_ptr<cdj::DehnerBasis> d;
  cdj::StreckPost post;
  cdj::Deck deck;
  std::vector<float> L, R;
  int64_t s = 0;
  bool takt = true, fuelle = true;
  std::vector<DeckLauf::Faktor> fk;
  struct Plan {
    bool an = false;
    int64_t ab = 0;
    cdj::Deck::KlAktion a;
    int64_t d = 0;           // Sprung: f_neu = frame_bei(s_t) + d (wie deck_ziel)
    bool f_fest = false;     // Hotcue, Start: f_neu fest
  } plan;
  int64_t geplant_ab = -1;   // erster Blockanfang mit stehendem Plan
  uint32_t anfrage_plan = 0; // Anfrage des Lesers beim Planen
  int belegt_max = 0;
  WLauf(const Karte& karte, int64_t laenge) : k(karte), L((size_t)laenge, 0.0f), R((size_t)laenge, 0.0f) {
    deck.setze_karte(&k, &gen);
    d = cdj::dehner_neu(1);
    deck.setze_keylock(d.get(), &post);
  }
  int64_t s_t() const { return std::llround(k.sample_at(plan.a.ab_beat)); }
  void pumpe() {
    if (takt) post.takt(*d);
    if (fuelle) d->fuelle_synchron();
    fk.push_back({d->quittiert_e(), d->geschrieben_bis(), d->faktor_gesetzt()});
  }
  void planen() {
    if (!plan.an || s < plan.ab) return;
    plan.a.s_t = s_t();
    // f_neu am Ziel-BEAT (wie deck_ziel rechnen soll), nicht am gerundeten Ziel-Sample: Kopf des Decks bei ab_beat + d (Basis 128)
    if (!plan.f_fest && plan.a.art != cdj::Deck::KL_LOOP_AN)
      plan.a.f_neu = std::llround((double)deck.anker_f() + (plan.a.ab_beat - deck.anker_b()) * 22500.0) + plan.d;
    if (deck.kl_plane(s, plan.a) && geplant_ab < 0) {
      geplant_ab = s;
      anfrage_plan = deck.keylock_anfrage();
    }
  }
  void teil(int n) {
    planen();
    float l[1024] = {}, r[1024] = {};
    deck.block(s, n, l, r, 0);
    for (int i = 0; i < n; ++i)
      if (s + i < (int64_t)L.size()) {
        L[(size_t)(s + i)] = l[i];
        R[(size_t)(s + i)] = r[i];
      }
    belegt_max = std::max(belegt_max, deck.keylock_verliehen());
    s += n;
    pumpe();
  }
  void bis(int64_t ende) {
    while (s < ende) teil((int)std::min<int64_t>(B, ende - s));
  }
  void genau(int64_t x) {
    bis(x / B * B);
    if (s < x) teil((int)(x - s));
  }
  // Am Ziel ausführen, wie deck_ausfuehren (Plan 2.1): Sprung um plan.d, Hotcue/Start auf f_neu, Loop an; mit Schlüssel
  void ziel(int64_t d_anders = INT64_MIN) {
    const int64_t e = s_t();
    genau(e);
    const uint64_t id = plan.a.id;
    const double b = plan.a.ab_beat;
    switch (plan.a.art) {
      case cdj::Deck::KL_SPRUNG: deck.springe(e, d_anders != INT64_MIN ? d_anders : plan.d, id, b); break;
      case cdj::Deck::KL_HOTCUE: deck.setze_kopf(e, plan.a.f_neu, id, b); break;
      case cdj::Deck::KL_START: deck.start(e, plan.a.f_neu, false, id, b); break;
      case cdj::Deck::KL_LOOP_AN: deck.loop_an(e, plan.a.loop_a, plan.a.loop_l, plan.a.loop_lx, id, b); break;
    }
    plan.an = false;
  }
  std::vector<double> faktoren(uint32_t e, int64_t s_h) const {
    std::vector<double> f;
    for (const DeckLauf::Faktor& x : fk) {
      if (x.e != e || x.gb <= s_h) continue;
      const size_t w = (size_t)((x.gb - 1 - s_h) / cdj::DEHNER_REGEL_TAKT);
      if (f.size() <= w) f.resize(w + 1, x.f);
      f[w] = x.f;
    }
    return f;
  }
};

// Ein laufendes Deck im Ring: Start bei s = 0 auf Frame 0 (Quell-Beat = Master-Beat bei Basis 128 und Anker 0), Sprung um d Frames
// am Ziel-Beat b_t, geplant ab s_t − vorlauf (blockgenau, wie der Kern je Blockanfang); vorlauf < 0: ohne Plan (heutiger Weg).
struct Fall6b {
  double bpm = 132.0;
  double b_t = 8.0;
  int art = cdj::Deck::KL_SPRUNG;
  int64_t d = 4 * 22500;
  int64_t f_neu = 0;
  int64_t vorlauf = -1;  // −1: plan_fenster(bpm)
  bool planen = true;
  uint64_t id = 41;
};
void w_aufsetzen(WLauf& l, const cdj::Material* m, const Fall6b& f) {
  l.deck.lade(m, 0);
  l.deck.start(0, 0);
  if (!f.planen) return;
  l.plan.an = true;
  l.plan.a.id = f.id;
  l.plan.a.art = f.art;
  l.plan.a.ab_beat = f.b_t;
  l.plan.d = f.d;
  l.plan.f_fest = f.art == cdj::Deck::KL_HOTCUE || f.art == cdj::Deck::KL_START;
  l.plan.a.f_neu = f.f_neu;
  const int64_t e = std::llround(l.k.sample_at(f.b_t));
  l.plan.ab = std::max<int64_t>(0, (e - (f.vorlauf >= 0 ? f.vorlauf : plan_fenster(f.bpm))) / B * B);
}
int64_t ungleich(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis, int64_t* erst = nullptr) {
  int64_t n = 0;
  if (erst) *erst = -1;
  for (int64_t i = std::max<int64_t>(0, von); i < bis && i < (int64_t)a.size() && i < (int64_t)b.size(); ++i)
    if (a[(size_t)i] != b[(size_t)i]) {
      if (erst && *erst < 0) *erst = i;
      ++n;
    }
  return n;
}
// größter |ct| je 10-ms-Fenster (480, lückenlos) in [a, b) gegen hz; wo: Anfang des schlechtesten Fensters
double ct_max(const std::vector<float>& x, int64_t a, int64_t b, double hz, int64_t* wo = nullptr) {
  double m = 0;
  for (int64_t t = a; t + 480 <= b; t += 480) {
    const double c = ct_fenster(x, t, 480, hz);
    if (std::fabs(c) > std::fabs(m)) {
      m = c;
      if (wo) *wo = t;
    }
  }
  return m;
}
// kleinste Periodenspitze (48 Samples, Schritt 24) in [a, b)
double spitze_min(const std::vector<float>& x, int64_t a, int64_t b) {
  double mn = 1e9;
  for (int64_t t = a; t + 48 <= b; t += 24) {
    double mx = 0;
    for (int i = 0; i < 48; ++i) mx = std::max(mx, (double)std::fabs(x[(size_t)(t + i)]));
    mn = std::min(mn, mx);
  }
  return mn;
}
// größter Rest-RMS nach Einpassen eines 1000-Hz-Sinus (feste Frequenz) in 96er-Fenstern, Schritt 48 (pruefung/exp_hart.cpp)
double rest_rms(const std::vector<float>& y, int64_t a, int64_t b) {
  double m = 0;
  const double w = 2 * km::PI * 1000.0 / 48000.0;
  for (int64_t t = a; t + 96 <= b; t += 48) {
    double cc = 0, ss = 0, cs = 0, xc = 0, xs = 0;
    for (int64_t i = t; i < t + 96; ++i) {
      const double c = std::cos(w * (double)i), si = std::sin(w * (double)i), v = y[(size_t)i];
      cc += c * c, ss += si * si, cs += c * si, xc += v * c, xs += v * si;
    }
    const double det = cc * ss - cs * cs, C = (xc * ss - xs * cs) / det, S = (xs * cc - xc * cs) / det;
    double e = 0;
    for (int64_t i = t; i < t + 96; ++i) {
      const double dd = (double)y[(size_t)i] - (C * std::cos(w * (double)i) + S * std::sin(w * (double)i));
      e += dd * dd;
    }
    m = std::max(m, std::sqrt(e / 96.0));
  }
  return m;
}

// ------------------------------------------------------------------------------------------ P1 geplant_sprung_sinus
// Sinus 1000 Hz, 132 BPM, Deck im Ring seit 3,5 s, Sprung +4 Beats (1875 Perioden, kohärent), Vorlauf PLAN_FENSTER. Jedes
// 10-ms-Fenster von s_t − 2000 bis s_t + 3000 1000 Hz ±2 ct; kleinste Periodenspitze in [s_t − 1000, s_t + 2500) ≥ 0,45; Anfrage beim
// Planen = am Ende (kein neuer Ansatz); hart 0, Unterlauf 0, geplant_ok 1, Deck-Frame nach dem Ziel = f_neu. Blind für fehlenden
// Sprung, fehlende Blende, späte Annahme (der R3 bekommt dieselbe Eingabe); rot für die Brücke (Stand ohne Plan, PLAN_AUSFUEHRUNG_FRIERT).
// Negativ-Kontrolle: derselbe Lauf ohne Ereignis besteht dieselben Grenzen, und P1 ist dazu (fast) bitgleich.
void test_sprung_sinus() {
  static MatSinus sinus(1000.0, 200 * 22500);
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(12.0));
  WLauf l(k, n), o(k, n);
  Fall6b f;
  w_aufsetzen(l, &sinus.m, f);
  Fall6b ohne = f;
  ohne.planen = false;
  w_aufsetzen(o, &sinus.m, ohne);
  l.ziel();
  const int64_t f_nach = l.deck.frame_bei(e + 1000);
  l.bis(n);
  o.bis(n);
  int64_t wo = -1;
  const double ct = ct_max(l.L, e - 2000, e + 3000, 1000.0, &wo), ct_o = ct_max(o.L, e - 2000, e + 3000, 1000.0);
  const double sp = spitze_min(l.L, e - 1000, e + 2500), sp_o = spitze_min(o.L, e - 1000, e + 2500);
  int64_t erst = -1;
  const int64_t ug = ungleich(l.L, o.L, 0, n, &erst);
  std::printf("  P1 Sprung +4 Beat Sinus: geplant ab s_t − %lld, max |ct| %.3f (Fenster bei s_t%+lld), Spitze %.4f; ohne Ereignis %.3f ct, "
              "%.4f; ungleich zum Lauf ohne Ereignis %lld (erstes bei s_t%+lld); Anfrage Plan/Ende %u/%u, geplant_ok %llu, hart %llu, "
              "Unterlauf %llu, Frame nach dem Ziel %lld (Soll %lld)\n",
              (long long)(e - l.geplant_ab), ct, (long long)(wo - e), sp, ct_o, sp_o, (long long)ug, (long long)(erst - e), l.anfrage_plan,
              l.deck.keylock_anfrage(), (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_hart(),
              (unsigned long long)l.deck.keylock_unterlauf(), (long long)f_nach, (long long)(o.deck.frame_bei(e + 1000) + f.d));
  PRUEF(l.geplant_ab >= 0 && std::fabs(ct) <= 2.0 && sp >= 0.45);
  PRUEF(l.anfrage_plan == l.deck.keylock_anfrage() && l.deck.keylock_geplant_ok() == 1);
  PRUEF(l.deck.keylock_hart() == 0 && l.deck.keylock_unterlauf() == 0);
  PRUEF(f_nach == o.deck.frame_bei(e + 1000) + f.d);
  PRUEF(std::fabs(ct_o) <= 2.0 && sp_o >= 0.45);  // Negativ-Kontrolle
  ergebnis("geplant_sprung_sinus");
}

// ------------------------------------------------------------------------------------------ P1m geplant_sprung_marke
// Wie P1 mit Pegelmarke (Sinus 1000 Hz, Pegel je Quell-Beat 0,25 + 0,05 · (k mod 7)), Sprung +4 Beats von Beat 8 auf 12: Pegel in
// [s_t + 1500, s_t + 3500) = Pegel von Beat 12 (0,50) ±0,5 dB, nicht der von Beat 8 (0,30); Ton ±2 ct je 10-ms-Fenster in
// [s_t + 608, s_t + 5000). Mutation PLAN_OHNE_SPRUNG rot (P1 bleibt dabei grün: das weist die Blindheit von P1 aus).
// Negativ-Kontrolle: ohne Ereignis liegt der Pegel dort bei Beat 8 (0,30), das Maß trennt.
void test_sprung_marke() {
  static MatMarke mk(200 * 22500);
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(12.0));
  WLauf l(k, n), o(k, n);
  Fall6b f;
  w_aufsetzen(l, &mk.m, f);
  Fall6b ohne = f;
  ohne.planen = false;
  w_aufsetzen(o, &mk.m, ohne);
  l.ziel();
  l.bis(n);
  o.bis(n);
  const double soll = marke_pegel(12), alt = marke_pegel(8);
  const double p = amp_bei(l.L, e + 1500, 2000, 1000.0), p_o = amp_bei(o.L, e + 1500, 2000, 1000.0);
  const double db = 20 * std::log10(p / soll), db_o = 20 * std::log10(p_o / alt);
  int64_t wo = -1;
  const double ct = ct_max(l.L, e + 608, e + 5000, 1000.0, &wo);
  std::printf("  P1m Pegelmarke: Pegel nach dem Ziel %.4f (Soll Beat 12 %.2f: %+.2f dB; alter Beat 8 %.2f), ohne Ereignis %.4f (%+.2f dB "
              "gegen Beat 8), max |ct| ab s_t + 608 %.3f, geplant_ok %llu\n",
              p, soll, db, alt, p_o, db_o, ct, (unsigned long long)l.deck.keylock_geplant_ok());
  PRUEF(std::fabs(db) <= 0.5 && std::fabs(ct) <= 2.0 && l.deck.keylock_geplant_ok() == 1);
  PRUEF(std::fabs(db_o) <= 0.5);  // Negativ-Kontrolle
  ergebnis("geplant_sprung_marke");
}

// ------------------------------------------------------------------------------------------ P2 geplant_sprung_gegenphase
// Sprung um 4 Beats + 12 Frames (Quelle 90° versetzt) und + 24 (180°). Grenzen (Plan 7.P2): Spitze in [s_t − 1000, s_t + 2500) ≥ 0,8 ×
// Spitze des idealen Quellschnitts mit 128 Blende; ct ab s_t + 608 ≤ 2; Rest-RMS in 96er-Fenstern [s_t − 300, s_t + 800) ≤ 1,3 × Rest-RMS
// des idealen Quellschnitts (dasselbe PlanBand mit x = 128 direkt, ein Frame je Sample wie pruefung/exp_hart.cpp). Mutation
// PLAN_OHNE_BLENDE (x = 0) rot über den Rest-RMS (4.5: harter Schnitt 2,0 × bzw. 1,9 ×).
void test_sprung_gegenphase() {
  static MatSinus sinus(1000.0, 200 * 22500);
  const Karte k(132.0, 0);
  const double b_t = std::getenv("P2_BEAT") ? std::atof(std::getenv("P2_BEAT")) : 8.0;  // Diagnose: Alter der Epoche
  const int64_t e = std::llround(k.sample_at(b_t)), n = std::llround(k.sample_at(b_t + 4.0));
  for (const int64_t dp : {(int64_t)12, (int64_t)24}) {
    WLauf l(k, n);
    Fall6b f;
    f.b_t = b_t;
    f.d = 4 * 22500 + dp;
    w_aufsetzen(l, &sinus.m, f);
    l.ziel();
    l.bis(n);
    const cdj::DeckBand* nb = l.deck.keylock_band();
    PRUEF(nb && nb->plan());
    if (!nb || !nb->plan()) continue;
    cdj::DeckBand ideal(*nb);
    ideal.x = 128;  // Bezug: idealer Quellschnitt mit 128 Blende, auch wenn das Deck (Mutation) ohne blendet
    ideal.g = nullptr;
    std::vector<float> I((size_t)n, 0.0f);
    for (int64_t i = e - 4000; i < e + 4000; ++i) {
      float a, b;
      ideal.band(nb->p_sw + (i - e), 1, &a, &b);
      I[(size_t)i] = a;
    }
    // rohes R3 gleicher Speisung (Kopie des PlanBands, wie es das Deck hat; Faktorfolge der Epoche ab s_h)
    const int64_t s_h = l.deck.keylock_s_h();
    const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
    cdj::DeckBand roh(*nb);
    roh.g = nullptr;
    const std::vector<float> RR = fs.empty() ? std::vector<float>((size_t)n, 0.0f)
                                             : km::r3_roh(roh, km::band_start(k, l.deck.keylock_anker(), s_h, fs.at(0)), fs, s_h, n);
    const double sp = spitze_min(l.L, e - 1000, e + 2500), sp_i = spitze_min(I, e - 1000, e + 2500), sp_r = spitze_min(RR, e - 1000, e + 2500);
    const double ct = ct_max(l.L, e + 608, e + 3000, 1000.0);
    if (std::getenv("P2_DUMP")) {  // Diagnose: Hüllkurve (Periodenspitze je 48) um das Ziel: Deck, ideal, rohes R3 gleicher Speisung
      for (int64_t t = e - 3000; t + 48 <= e + 2500; t += 48) {
        double mx = 0, mi = 0, mr = 0;
        for (int i = 0; i < 48; ++i)
          mx = std::max(mx, (double)std::fabs(l.L[(size_t)(t + i)])), mi = std::max(mi, (double)std::fabs(I[(size_t)(t + i)])),
          mr = std::max(mr, (double)std::fabs(RR[(size_t)(t + i)]));
        std::printf("    P2dump %3.0f %+6lld %.4f %.4f %.4f\n", 360.0 * (double)dp / 48.0, (long long)(t - e), mx, mi, mr);
      }
    }
    const double rr = rest_rms(l.L, e - 300, e + 800), ri = rest_rms(I, e - 300, e + 800);
    std::printf("  P2 %3.0f° (Beat %.0f): Spitze %.4f (rohes R3 %.4f: %.3f; ideal %.4f: %.3f, ausgewiesen), max |ct| ab s_t + 608 %.3f, "
                "Rest-RMS %.4f (ideal %.4f, Verhältnis %.3f), Blende des Bandes %d, geplant_ok %llu\n",
                360.0 * (double)dp / 48.0, b_t, sp, sp_r, sp / sp_r, sp_i, sp / sp_i, ct, rr, ri, rr / ri, nb->x,
                (unsigned long long)l.deck.keylock_geplant_ok());
    // Abweichung vom Plan (begründet, step6/p2_alter.txt): die Spitze gegen den idealen Quellschnitt (0,8 ×) hält R3 selbst nicht; sie
    // hängt am Alter der Epoche (90°: 0,18 bis 1,02 über 11 Ziel-Beats, rohes R3 gleicher Speisung bricht genauso ein). Gewertet: das
    // Deck fügt dem R3 nichts hinzu (Spitze ≥ 0,95 × rohes R3), Rest-RMS ≤ 1,3 × ideal (Plan), ct ≤ 2 (Plan).
    PRUEF(!fs.empty() && sp >= 0.95 * sp_r && std::fabs(ct) <= 2.0 && rr <= 1.3 * ri && l.deck.keylock_geplant_ok() == 1);
  }
  ergebnis("geplant_sprung_gegenphase");
}

// ------------------------------------------------------------------------------------------ P3 geplant_hotcue_klick (+ P3u)
// Klickmaterial mit Klicks erst ab Quell-Beat 16 (davor Stille), 132 BPM, Hotcue am Beat 8 phasentreu auf Quell-Beat 20, Vorlauf
// PLAN_FENSTER. Erster Klick nach s_t (Quell-Beat 20): Lage ±12 gegen das Soll und gegen rohes R3 gleicher Speisung (Kopie des
// PlanBands, Faktorfolge der Epoche ab s_h); Spitze ≥ 0,9 × Klick 4 Beats später (eingeschwungen). Mutation PLAN_OHNE_SPRUNG rot (am
// Ziel ist Stille). P3u: danach ein erzwungener Unterlauf (Arbeits-Thread 8 Blöcke aus) eine halbe Beat-Länge nach dem Ziel: der
// Neuansatz mit PlanBand und Anker der Epoche landet richtig, Klick von Quell-Beat 26 (6 Beats nach dem Ziel) ±12 gegen das Soll;
// Mutation PLAN_ANKER_ALT rot (40 ms daneben).
void test_hotcue_klick() {
  static MatKlickAb kl(80, 16, "c1c0000000000651");
  const Karte k(132.0, 0);
  static const std::vector<float> tpl = km::klick_vorlage();
  for (int unterlauf = 0; unterlauf < 2; ++unterlauf) {
    const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(16.0));
    WLauf l(k, n);
    Fall6b f;
    f.art = cdj::Deck::KL_HOTCUE;
    f.f_neu = 20 * 22500;
    w_aufsetzen(l, &kl.p.m, f);
    l.ziel();
    if (unterlauf) {
      l.bis(e + 11000);
      l.fuelle = false;
      l.bis(e + 11000 + 8 * B);
      l.fuelle = true;
    }
    l.bis(n);
    const cdj::DeckBand* nb = l.deck.keylock_band();
    const DehnerAnker a = l.deck.keylock_anker();
    PRUEF(nb && nb->plan());
    if (!nb || !nb->plan()) {
      ergebnis(unterlauf ? "geplant_hotcue_unterlauf" : "geplant_hotcue_klick");
      continue;
    }
    const DehnerAnker av{8.0, 20 * 22500.0};  // Soll unabhängig vom Band: Quell-Beat 20 am Master-Beat 8 (Hotcue-Ziel)
    if (!unterlauf) {
      const int64_t s_h = l.deck.keylock_s_h();
      const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
      cdj::DeckBand ref(*nb);
      ref.g = nullptr;
      double e0 = 999, e4 = 999;
      PRUEF(km::klick_lage(l.L, k, av, 20, e0, tpl, km::MITTE) && km::klick_lage(l.L, k, av, 24, e4, tpl, km::MITTE));
      const km::Lage m = fs.empty() ? km::Lage{} : km::lage_messen(l.L, ref, k, av, km::band_start(k, a, s_h, fs.at(0)), fs, s_h, 20, 21);
      const int64_t m20 = std::llround(k.sample_at(8.0)), m24 = std::llround(k.sample_at(12.0));
      const double sp0 = spitze(l.L, m20 - 200, m20 + 400), sp4 = spitze(l.L, m24 - 200, m24 + 400);
      std::printf("  P3 Hotcue Klick: erster Klick nach dem Ziel %+.2f gegen das Soll (4 Beats später %+.2f), %.2f gegen rohes R3 (n %d), "
                  "Spitze %.4f gegen %.4f (%.3f), geplant_ok %llu\n",
                  e0, e4, m.max_roh, m.n, sp0, sp4, sp0 / sp4, (unsigned long long)l.deck.keylock_geplant_ok());
      PRUEF(std::fabs(e0) <= 12.0 && m.n == 1 && m.max_roh <= 12.0 && sp0 >= 0.9 * sp4 && l.deck.keylock_geplant_ok() == 1);
      ergebnis("geplant_hotcue_klick");
    } else {
      double e6 = 999;
      const bool da = km::klick_lage(l.L, k, av, 26, e6, tpl, km::MITTE);
      std::printf("  P3u Unterlauf nach dem Ziel: Unterläufe %llu, Anfrage Plan/Ende %u/%u, Klick Quell-Beat 26 %+.2f gegen das Soll\n",
                  (unsigned long long)l.deck.keylock_unterlauf(), l.anfrage_plan, l.deck.keylock_anfrage(), e6);
      PRUEF(l.deck.keylock_unterlauf() >= 1 && l.deck.keylock_anfrage() != l.anfrage_plan);  // der Fall liegt vor
      PRUEF(da && std::fabs(e6) <= 12.0);
      ergebnis("geplant_hotcue_unterlauf");
    }
  }
}

// ------------------------------------------------------------------------------------------ P5 geplant_loop_an
// Loop 4 Beats ab Beat 8 bei 132 BPM im Ring, drei Durchläufe. Sinus 1000 Hz (4 Beats = 1875 Perioden, kohärente Naht): jedes
// 10-ms-Fenster von s_t − 2000 bis zum Ende der drei Durchläufe ±2 ct (keine Brücke); größte Abweichung zum Lauf ohne Loop ≤ 0,02 (die
// Naht-Blende ist bei kohärentem Material unsichtbar; Bandtausch ohne Naht-Eingriff). Klickmaterial: Klick am Loop-Anfang je Durchlauf
// ±12 gegen das Soll. Anfrage unverändert, geplant_ok 1. Mutation PLAN_LOOP_LEER (kein Plan für Loop an) rot.
// Nicht hier: der kurze Loop (Z_LOOP_KURZ entscheidet der Planer des Kerns, Step 7).
void test_loop_an() {
  static MatSinus sinus(1000.0, 200 * 22500);
  static km::MatProbe klick(80, 0, "c1c0000000000652");
  const Karte k(132.0, 0);
  static const std::vector<float> tpl = km::klick_vorlage();
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(21.0));
  for (int art = 0; art < 2; ++art) {
    WLauf l(k, n), o(k, n);
    Fall6b f;
    f.art = cdj::Deck::KL_LOOP_AN;
    w_aufsetzen(l, art ? &klick.m : &sinus.m, f);
    l.plan.a.loop_a = 8 * 22500;
    l.plan.a.loop_l = 4 * 22500;
    l.plan.a.loop_lx = 4.0 * 22500;
    Fall6b ohne = f;
    ohne.planen = false;
    w_aufsetzen(o, art ? &klick.m : &sinus.m, ohne);
    l.ziel();
    l.bis(n);
    o.bis(n);
    const int64_t ende = std::llround(k.sample_at(20.0));
    if (!art) {
      int64_t wo = -1;
      const double ct = ct_max(l.L, e - 2000, ende, 1000.0, &wo);
      double dmax = 0;
      for (int64_t t = e; t < ende; ++t) dmax = std::max(dmax, (double)std::fabs(l.L[(size_t)t] - o.L[(size_t)t]));
      std::printf("  P5 Loop an Sinus: max |ct| %.3f (bei s_t%+lld), größte Abweichung zum Lauf ohne Loop %.3g, Durchlauf %lld, geplant_ok "
                  "%llu, Anfrage Plan/Ende %u/%u\n",
                  ct, (long long)(wo - e), dmax, (long long)l.deck.loop_durchlauf(), (unsigned long long)l.deck.keylock_geplant_ok(),
                  l.anfrage_plan, l.deck.keylock_anfrage());
      PRUEF(std::fabs(ct) <= 2.0 && dmax <= 0.02 && l.deck.loop_durchlauf() >= 3 && l.deck.keylock_geplant_ok() == 1);
      PRUEF(l.anfrage_plan == l.deck.keylock_anfrage());
    } else {
      double mx = 0;
      bool alle = true;
      for (int j = 0; j < 3; ++j) {
        double ej = 999;
        const bool da = km::klick_lage(l.L, k, DehnerAnker{8.0 + 4 * j, 8 * 22500.0}, 8, ej, tpl, km::MITTE);
        alle = alle && da;
        mx = std::max(mx, std::fabs(ej));
      }
      std::printf("  P5 Loop an Klick: Klick am Loop-Anfang je Durchlauf größte |Lage| %.2f gegen das Soll, geplant_ok %llu\n", mx,
                  (unsigned long long)l.deck.keylock_geplant_ok());
      PRUEF(alle && mx <= 12.0 && l.deck.keylock_geplant_ok() == 1);
    }
  }
  ergebnis("geplant_loop_an");
}

// ------------------------------------------------------------------------------------------ P8 geplant_abbruch_spaet
// Pegelmarke, Sprung +4 Beats geplant, dann kl_plan_verwerfen (Abbruch nach der Planung, 3.7), die Aktion entfällt (kein Ereignis am
// Ziel). Zone 1 (Auftrag ungelesen: Arbeits-Thread setzt einen Block aus, 100 nach der Planung), Zone 2 (100, 600, 1200 nach der
// Planung): Gegenwechsel angenommen, der Sprung klingt nie (Pegel nach dem Ziel = Beat 8), kein Varispeed-Abschnitt (±2 ct je
// 10-ms-Fenster von der Planung bis s_t + 6000), Ausgabe bitgleich zum Lauf ohne Aktion. Zone 3 (s_t − 3000, − 2000, − 1100):
// Gegenwechsel verfehlt, der Sprung lag im R3: Brücke (abbruch_bruecke 1), der Sprung klingt nicht (Pegel Beat 8 ±0,5 dB im Ring nach
// der Brücke, Frame ungesprungen), Ton nicht gewertet. s_t − 500 und − 200: zu nah (das Urteil des Threads kommt einen Block später,
// dann liegen weniger als 128 saubere Frames vor dem Sprung), der Sprung wird gespielt (abbruch_gespielt 1, Pegel Beat 12, Frame
// gesprungen). Abweichung vom Plan (3.7 „etwa 1100 Frames“): das Einfrieren in Zone 3 nimmt nur die Frames vor dem Sprung, darum
// wird erst unter rund 128 + 128/f Frames gespielt, bei − 1100 noch die Brücke. Mutation PLAN_ABBRUCH_IGNORIERT rot in Zone 1/2 (der Sprung klingt), PLAN_RUECKWECHSEL_AUS rot in Zone 2
// (Brücke: Ton und bitgleich).
void test_abbruch_spaet() {
  static MatMarke mk(200 * 22500, "c1c0000000000653");
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(11.0));
  WLauf o(k, n);
  Fall6b ohne;
  ohne.planen = false;
  w_aufsetzen(o, &mk.m, ohne);
  o.bis(n);
  struct A {
    const char* zone;
    int64_t nach_plan;  // >= 0: so viele Samples nach der Planung
    int64_t vor_ziel;   // > 0: so viele vor dem Ziel
    bool ungelesen;
  } faelle[] = {{"1", 100, 0, true},   {"2", 100, 0, false},  {"2", 600, 0, false}, {"2", 1200, 0, false},
                {"3", -1, 3000, false}, {"3", -1, 2000, false}, {"3", -1, 1100, false}, {"3g", -1, 500, false},
                {"3g", -1, 200, false}};
  for (const A& fa : faelle) {
    WLauf l(k, n);
    Fall6b f;
    w_aufsetzen(l, &mk.m, f);
    l.bis(l.plan.ab);
    if (fa.ungelesen) l.fuelle = false;  // Zone 1: der Thread liest den Auftrag nicht, bevor der Gegenwechsel kommt
    l.teil(B);                           // der erste Block plant
    const int64_t sp = l.geplant_ab;
    const int64_t s_ab = fa.nach_plan >= 0 ? sp + fa.nach_plan : e - fa.vor_ziel;
    l.genau(s_ab);
    l.fuelle = true;
    const uint64_t ueb_vor = l.d->wechsel_ueberschrieben();
    l.deck.kl_plan_verwerfen(s_ab);
    l.plan.an = false;
    l.bis(n);
    // Pegel im Ring: Zone 1/2 und gespielt gleich nach dem Ziel; Zone 3 nach der Brücke (Ansatz + 4096 + 1408 + 960, ein Block Entscheid)
    const bool z3 = !std::strcmp(fa.zone, "3");
    const double p = amp_bei(l.L, z3 ? s_ab + 7500 : e + 1500, 2000, 1000.0);
    const double db8 = 20 * std::log10(p / marke_pegel(8)), db12 = 20 * std::log10(p / marke_pegel(12));
    int64_t wo = -1;
    const double ct = ct_max(l.L, sp, e + 6000, 1000.0, &wo);
    int64_t erst = -1;
    const int64_t ug = ungleich(l.L, o.L, 0, n, &erst);
    std::printf("  P8 Zone %-2s Abbruch bei %s%lld: zurück/Brücke/gespielt/frei %llu/%llu/%llu/%llu, überschrieben +%llu, Pegel nach dem "
                "Ziel %+.2f dB gegen Beat 8 (%+.2f gegen Beat 12), max |ct| %.2f (bei s_t%+lld), ungleich zum Lauf ohne Aktion %lld (erstes "
                "s_t%+lld), Frame s_t + 1000 %lld (ohne %lld)\n",
                fa.zone, fa.nach_plan >= 0 ? "Plan +" : "s_t − ", (long long)(fa.nach_plan >= 0 ? fa.nach_plan : fa.vor_ziel),
                (unsigned long long)l.deck.keylock_abbruch_zurueck(), (unsigned long long)l.deck.keylock_abbruch_bruecke(),
                (unsigned long long)l.deck.keylock_abbruch_gespielt(), (unsigned long long)l.deck.keylock_abbruch_frei(),
                (unsigned long long)(l.d->wechsel_ueberschrieben() - ueb_vor), db8, db12, ct, (long long)(wo - e), (long long)ug,
                (long long)(erst - e), (long long)l.deck.frame_bei(e + 1000), (long long)o.deck.frame_bei(e + 1000));
    PRUEF(sp >= 0);
    // Zählregel (Fix-Runde W3 S3): jede geplante Aktion zählt genau einmal, ok + verworfen + gespielt = 1; „gespielt“ nur dort, auf beiden
    // Wegen (direkt und über den Gegenwechsel), am Deck und am Leser gleich
    const cdj::StreckLeser& le = l.deck.keylock_leser();
    const uint64_t summe = l.deck.keylock_geplant_ok() + l.deck.keylock_geplant_verworfen() + l.deck.keylock_abbruch_gespielt();
    const uint64_t summe_l = le.geplant_ok_n() + le.geplant_verworfen_n() + l.deck.keylock_abbruch_gespielt();
    std::printf("    Zählung: ok %llu, verworfen %llu, gespielt %llu (Summe %llu); Leser ok %llu, verworfen %llu (Summe mit gespielt %llu)\n",
                (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_geplant_verworfen(),
                (unsigned long long)l.deck.keylock_abbruch_gespielt(), (unsigned long long)summe, (unsigned long long)le.geplant_ok_n(),
                (unsigned long long)le.geplant_verworfen_n(), (unsigned long long)summe_l);
    PRUEF(summe == 1 && summe_l == 1);
    if (fa.zone[0] == '1' || fa.zone[0] == '2') {
      PRUEF(l.deck.keylock_abbruch_zurueck() == 1 && std::fabs(db8) <= 0.5 && std::fabs(ct) <= 2.0 && ug == 0);
      if (fa.ungelesen) PRUEF(l.d->wechsel_ueberschrieben() > ueb_vor);
    } else if (z3) {
      PRUEF(l.deck.keylock_abbruch_bruecke() == 1 && std::fabs(db8) <= 0.5 && l.deck.frame_bei(e + 1000) == o.deck.frame_bei(e + 1000));
    } else {
      PRUEF(l.deck.keylock_abbruch_gespielt() == 1 && std::fabs(db12) <= 0.5 && l.deck.frame_bei(e + 1000) == o.deck.frame_bei(e + 1000) + f.d);
    }
    PRUEF(l.deck.keylock_verliehen() <= 2);
  }
  ergebnis("geplant_abbruch_spaet");
}

// ------------------------------------------------------------------------------------------ P9 geplant_karte_neu
// Klick ab Quell-Beat 16, Sprung am Beat 8 auf Quell-Beat 20 (+12 Beats). (a) Rampe 132 → 140 von Beat 7,75 bis 8 schon in der Karte bei
// der Planung (sie wirkt zwischen Planung und Ziel): der Sprung landet am Beat, Klick von Quell-Beat 20 ±12 gegen das Soll der Karte;
// Mutation PLAN_P_SW_AUS_SAMPLE (p_sw aus dem Ziel-Sample, linear mit dem Tempo bei der Planung) rot. (b) Rampe 132 → 136 ab Beat 7,8 erst
// NACH der Planung angenommen: das Ziel-Sample wandert, der Plan trägt (Identität der Aktion, nicht s == s_t), Klick ±12 gegen das
// Soll der neuen Karte, geplant_ok 1.
void test_karte_neu() {
  static MatKlickAb kl(80, 16, "c1c0000000000654");
  static const std::vector<float> tpl = km::klick_vorlage();
  for (int fall = 0; fall < 2; ++fall) {
    Karte k(132.0, 0);
    if (fall == 0) PRUEF(k.rampe(7.75, 140.0, 0.25));
    const int64_t n = std::llround(k.sample_at(14.0));
    WLauf l(k, n);
    Fall6b f;
    f.d = 12 * 22500;
    w_aufsetzen(l, &kl.p.m, f);
    l.plan.ab = (std::llround(l.k.sample_at(8.0)) - plan_fenster(132.0)) / B * B;
    if (fall == 1) {
      l.bis(l.plan.ab + 2 * B);
      PRUEF(l.deck.keylock_wplan_aktiv());
      PRUEF(l.k.rampe(7.8, 136.0, 1.0));
      ++l.gen;
    }
    const int64_t e_alt = std::llround(Karte(132.0, 0).sample_at(8.0));
    l.ziel();
    l.bis(n);
    const cdj::DeckBand* nb = l.deck.keylock_band();
    const DehnerAnker a = l.deck.keylock_anker();
    (void)a;
    double e0 = 999;  // Soll unabhängig vom Band: Quell-Beat 20 (Frame 20 · 22500) erklingt am Master-Beat 8
    const bool da = nb && nb->plan() && km::klick_lage(l.L, l.k, DehnerAnker{8.0, 20 * 22500.0}, 20, e0, tpl, km::MITTE);
    std::printf("  P9 %s: Ziel-Sample %lld (ohne Rampe %lld), Klick Quell-Beat 20 %+.2f gegen das Soll der Karte, geplant_ok %llu\n",
                fall ? "Rampe nach der Planung" : "Rampe vor dem Ziel in der Karte", (long long)std::llround(l.k.sample_at(8.0)),
                (long long)e_alt, e0, (unsigned long long)l.deck.keylock_geplant_ok());
    PRUEF(da && std::fabs(e0) <= 12.0 && l.deck.keylock_geplant_ok() == 1);
  }
  ergebnis("geplant_karte_neu");
}

// ------------------------------------------------------------------------------------------ P10 geplant_ereignis_dazwischen
// Pegelmarke, Sprung +4 Beats geplant, dann 300 Samples nach der Planung ein sofortiges Ereignis: Stopp (die Aktion entfällt), Laden
// (anderes Material, die Aktion entfällt), Raster (+2000 Frames, die Aktion bleibt und läuft am Ziel über den heutigen Weg), Knopf aus
// (die Aktion bleibt). Ausgabe bitgleich zum selben Ablauf ohne Plan (das Ereignis liegt vor s_t − 128 − 4096: der R3 hatte nichts vom
// Sprung), geplant_ok 0. Mutation PLAN_OHNE_PRUEFUNG: Raster und Knopf aus bleiben bitgleich (der Plan fällt schon mit dem Ereignis);
// P17 zeigt sie.
void test_ereignis_dazwischen() {
  static MatMarke mk(200 * 22500, "c1c0000000000655");
  static MatSinus anders(700.0, 200 * 22500, 0.4f, "c1c0000000000656");
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(11.0));
  const char* namen[] = {"Stopp", "Laden", "Raster", "Knopf aus"};
  for (int ev = 0; ev < 4; ++ev) {
    std::vector<float> aus[2];
    uint64_t ok[2] = {}, verw[2] = {};
    for (int mit = 0; mit < 2; ++mit) {
      WLauf l(k, n);
      Fall6b f;
      f.planen = true;
      w_aufsetzen(l, &mk.m, f);
      if (!mit) l.plan.an = false;  // ohne Plan: derselbe Ablauf, der Planer schweigt
      l.bis(l.plan.ab + B);
      const int64_t s_ev = l.plan.ab + 300;
      l.genau(s_ev);
      if (ev == 0) l.deck.stopp(s_ev);
      if (ev == 1) l.deck.lade(&anders.m, s_ev);
      if (ev == 2) l.deck.setze_raster(s_ev, 2000);
      if (ev == 3) l.deck.keylock(s_ev, false);
      const bool bleibt = ev >= 2;
      l.plan.an = false;
      if (bleibt) l.ziel();
      l.bis(n);
      aus[mit] = l.L;
      ok[mit] = l.deck.keylock_geplant_ok();
      verw[mit] = l.deck.keylock_geplant_verworfen();
    }
    int64_t erst = -1;
    const int64_t ug = ungleich(aus[0], aus[1], 0, n, &erst);
    std::printf("  P10 %-9s: ungleich zum Ablauf ohne Plan %lld (erstes s_t%+lld), geplant_ok %llu, verworfen %llu (ohne Plan %llu)\n",
                namen[ev], (long long)ug, (long long)(erst - e), (unsigned long long)ok[1], (unsigned long long)verw[1],
                (unsigned long long)verw[0]);
    PRUEF(ug == 0 && ok[1] == 0);
  }
  ergebnis("geplant_ereignis_dazwischen");
}

// ------------------------------------------------------------------------------------------ P11 geplant_dehner_verfehlt
// Der Dehner nimmt nicht an: Vorlauf 3000 (die Einspeisung ist schon an p_gleich_bis vorbei, wechsel_verfehlt). Am Ziel der heutige Weg
// (Brücke), kein Fehlklang außer dem heutigen: Ausgabe bitgleich zum Lauf ohne Plan mit demselben Sprung; der Plan fällt (verworfen 1,
// verfehlt = Nummer). Negativ-Kontrolle: derselbe Lauf mit vollem Vorlauf trägt (geplant_ok 1).
void test_dehner_verfehlt() {
  static MatMarke mk(200 * 22500, "c1c0000000000657");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(11.0));
  std::vector<float> aus[3];
  uint64_t ok[3] = {}, verw[3] = {};
  uint32_t wnr = 0, verf = 0;
  for (int fall = 0; fall < 3; ++fall) {  // 0 ohne Plan, 1 Vorlauf 3000, 2 voller Vorlauf
    WLauf l(k, n);
    Fall6b f;
    f.planen = fall > 0;
    f.vorlauf = fall == 1 ? 3000 : -1;
    w_aufsetzen(l, &mk.m, f);
    if (fall == 0) {
      l.plan.a.ab_beat = 8.0;
      l.plan.a.art = cdj::Deck::KL_SPRUNG;
      l.plan.d = f.d;
    }
    l.ziel();
    l.bis(n);
    aus[fall] = l.L;
    ok[fall] = l.deck.keylock_geplant_ok();
    verw[fall] = l.deck.keylock_geplant_verworfen();
    if (fall == 1) {
      wnr = l.deck.keylock_wplan_wnr();
      verf = l.d->wechsel_verfehlt();
    }
  }
  int64_t erst = -1;
  const int64_t ug = ungleich(aus[0], aus[1], 0, n, &erst);
  std::printf("  P11 Vorlauf 3000: verfehlt %u (Wechsel %u), geplant_ok %llu, verworfen %llu, ungleich zum Lauf ohne Plan %lld; voller "
              "Vorlauf geplant_ok %llu\n",
              verf, wnr, (unsigned long long)ok[1], (unsigned long long)verw[1], (long long)ug, (unsigned long long)ok[2]);
  PRUEF(wnr != 0 && verf == wnr && ok[1] == 0 && verw[1] == 1 && ug == 0);
  PRUEF(ok[2] == 1);  // Negativ-Kontrolle
  ergebnis("geplant_dehner_verfehlt");
}

// ------------------------------------------------------------------------------------------ P13 geplant_folge
// 20 Hotcues, einer je Beat (Beat 8 bis 27), phasentreu um Vielfache von 4 Beats vor und zurück (kohärent: 4 Beats = 1875 Perioden), je mit
// Vorlauf PLAN_FENSTER geplant (der nächste nach der Ausführung des vorigen). geplant_ok 20, Leihe nach jedem Blockanfang ≤ 3 belegt
// (größter Wert über den Lauf), ±2 ct je 10-ms-Fenster über alle 20, kein_platz 0. Mutation PLAN_LEIHE_ALT_BLEIBT rot (die Leihe läuft voll).
void test_folge() {
  static MatSinus sinus(1000.0, 200 * 22500, 0.5f, "c1c0000000000658");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(29.0));
  WLauf l(k, n);
  Fall6b f;
  f.planen = false;
  w_aufsetzen(l, &sinus.m, f);
  for (int i = 0; i < 20; ++i) {
    const double b = 8.0 + i;
    l.plan.an = true;
    l.plan.a = cdj::Deck::KlAktion{};
    l.plan.a.id = 100 + (uint64_t)i;
    l.plan.a.art = cdj::Deck::KL_HOTCUE;
    l.plan.a.ab_beat = b;
    l.plan.d = (int64_t)(4 * (1 + (i * 7) % 5) - (i % 2 ? 24 : 0)) * 22500;  // 4 bis 20 Beats vor, 4 bis 20 zurück: 1875 Perioden je 4
    l.plan.f_fest = false;  // f_neu = frame_bei(s_t) + d, als Hotcue (setze_kopf) ausgeführt
    l.plan.ab = (std::llround(k.sample_at(b)) - plan_fenster(132.0)) / B * B;
    l.ziel();
    if (std::getenv("P13_DUMP")) {  // Diagnose: Unstetigkeit im Band am Ziel = f_neu − d − (p_sw + off alt)
      const cdj::DeckBand* nb = l.deck.keylock_band();
      if (nb && nb->plan()) std::printf("    P13dump Beat %.0f: Sprung im Band − d = %lld Frames\n", b, (long long)(nb->off_neu - nb->off - l.plan.d));
    }
  }
  l.bis(n);
  int64_t wo = -1;
  const double ct = ct_max(l.L, std::llround(k.sample_at(7.5)), std::llround(k.sample_at(28.0)), 1000.0, &wo);
  std::printf("  P13 Folge 20 Hotcues: geplant_ok %llu, verworfen %llu, Leihe belegt höchstens %d, kein_platz %llu, max |ct| %.3f (bei Beat "
              "%.2f), Unterläufe %llu\n",
              (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_geplant_verworfen(), l.belegt_max,
              (unsigned long long)l.deck.keylock_kein_platz(), ct, k.beat_at((double)wo), (unsigned long long)l.deck.keylock_unterlauf());
  PRUEF(l.deck.keylock_geplant_ok() == 20 && l.belegt_max <= 3 && l.deck.keylock_kein_platz() == 0 && std::fabs(ct) <= 2.0);
  ergebnis("geplant_folge");
}

// ------------------------------------------------------------------------------------------ P15 geplant_allokation (6b)
// kl_plane je Block, Deck::block mit PlanBand-Lesungen im (synchronen) Dehner, Ausführung am Ziel, Abbruch mit Gegenwechsel: 0
// Allokationen; Positiv-Kontrolle malloc.
void test_allokation6b() {
  static MatSinus sinus(1000.0, 200 * 22500, 0.5f, "c1c0000000000659");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(10.0));
  long gesamt = 0;
  for (int fall = 0; fall < 2; ++fall) {
    WLauf l(k, n);
    Fall6b f;
    w_aufsetzen(l, &sinus.m, f);
    l.bis(l.plan.ab - B);
    const int64_t e = l.s_t();
    while (l.s + B <= e) {
      float lb[1024] = {}, rb[1024] = {};
      abfang_an();
      l.planen();
      if (fall == 1 && l.geplant_ab >= 0 && l.s >= l.geplant_ab + 600) {
        l.deck.kl_plan_verwerfen(l.s);
        l.plan.an = false;
      }
      l.deck.block(l.s, B, lb, rb, 0);
      l.post.takt(*l.d);
      l.d->fuelle_synchron();
      gesamt += abfang_aus();
      l.s += B;
    }
    float lb[1024] = {}, rb[1024] = {};
    abfang_an();
    if (l.s < e) l.deck.block(l.s, (int)(e - l.s), lb, rb, 0);
    if (fall == 0) l.deck.springe(e, l.plan.d, l.plan.a.id, l.plan.a.ab_beat);
    l.deck.block(e, B, lb, rb, 0);
    l.d->fuelle_synchron();
    gesamt += abfang_aus();
    std::printf("  allokation6b Fall %d: geplant_ok %llu, zurück %llu\n", fall, (unsigned long long)l.deck.keylock_geplant_ok(),
                (unsigned long long)l.deck.keylock_abbruch_zurueck());
    PRUEF(fall == 0 ? l.deck.keylock_geplant_ok() == 1 : l.deck.keylock_abbruch_zurueck() == 1);
  }
  abfang_an();
  void* volatile p = std::malloc(64);
  const long pk = abfang_aus();
  std::free(p);
  std::printf("  allokation6b: %ld Allokationen (Abfang verfügbar %d), Positiv-Kontrolle malloc %ld\n", gesamt, (int)ALLOC_ABFANG_VERFUEGBAR, pk);
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(gesamt == 0 && pk >= 1);
  ergebnis("geplant_allokation6b");
}

// ------------------------------------------------------------------------------------------ P17 geplant_ziel_weicht_ab
// (a) Am Ziel kommt derselbe Schlüssel mit anderem Sprung (+8 statt +4 Beats, f_neu ≠ Plan): der Plan trägt nicht, heutiger Weg;
//     zu hören ist nie der geplante Ort: Pegel in [s_t + 7500, s_t + 9500) (Ring nach der Brücke) = Beat 16 (0,35), nicht Beat 12 (0,50).
// (b) Ein sofortiger Sprung (+1 Beat) nach der Planung ändert den Kopf: der Plan fällt (neue Anfrage), am Ziel heutiger Weg mit dem
//     dann gültigen Ziel (Beat 9 + 4 = 13, 0,55); bitgleich zum Ablauf ohne Plan.
// Mutation PLAN_OHNE_PRUEFUNG (kl_plan_traegt prüft f_neu und Anfrage nicht) rot in (a).
void test_ziel_weicht_ab() {
  static MatMarke mk(200 * 22500, "c1c0000000000660");
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(11.0));
  {
    WLauf l(k, n);
    Fall6b f;
    w_aufsetzen(l, &mk.m, f);
    l.ziel(8 * 22500);
    l.bis(n);
    const double p = amp_bei(l.L, e + 7500, 2000, 1000.0);  // im Ring nach der Brücke
    std::printf("  P17a anderes Ziel: Pegel %.4f (Beat 16 %.2f: %+.2f dB; geplant Beat 12 %.2f: %+.2f dB), geplant_ok %llu, verworfen %llu\n", p,
                marke_pegel(16), 20 * std::log10(p / marke_pegel(16)), marke_pegel(12), 20 * std::log10(p / marke_pegel(12)),
                (unsigned long long)l.deck.keylock_geplant_ok(), (unsigned long long)l.deck.keylock_geplant_verworfen());
    PRUEF(std::fabs(20 * std::log10(p / marke_pegel(16))) <= 1.0 && l.deck.keylock_geplant_ok() == 0);
  }
  {
    std::vector<float> aus[2];
    for (int mit = 0; mit < 2; ++mit) {
      WLauf l(k, n);
      Fall6b f;
      w_aufsetzen(l, &mk.m, f);
      if (!mit) l.plan.an = false;
      l.genau(l.plan.ab + 2 * B);
      l.deck.springe(l.s, 22500);
      l.plan.an = false;
      l.ziel();
      l.bis(n);
      aus[mit] = l.L;
      if (mit) {
        const double p = amp_bei(l.L, e + 7500, 2000, 1000.0);  // im Ring nach der Brücke
        std::printf("  P17b Kopf geändert: Pegel %.4f (Beat 13 %.2f: %+.2f dB), geplant_ok %llu\n", p, marke_pegel(13),
                    20 * std::log10(p / marke_pegel(13)), (unsigned long long)l.deck.keylock_geplant_ok());
        PRUEF(std::fabs(20 * std::log10(p / marke_pegel(13))) <= 1.0 && l.deck.keylock_geplant_ok() == 0);
      }
    }
    const int64_t ug = ungleich(aus[0], aus[1], 0, n);
    std::printf("  P17b ungleich zum Ablauf ohne Plan %lld\n", (long long)ug);
    PRUEF(ug == 0);
  }
  ergebnis("geplant_ziel_weicht_ab");
}

// ------------------------------------------------------------------------------------------ P20 geplant_platz_generation
// Lebensdauer (Plan 3.6), echte Fäden (Vorbereiter, Arbeits-Thread), 2000 Ereignisse (TSan 300) in Zufallsfolge: geplanter Sprung
// oder Hotcue mit Ausführung, geplant und abgebrochen (verwerfen) zu zufälliger Zeit, geplant mit Neuansatz im Fenster zwischen
// Annahme und Ziel (der Arbeits-Thread setzt aus: Unterlauf), sofortige Ereignisse (Sprung, Raster, Knopf aus/an, Laden). Prüfbau
// (CYPHERDJ_PRUEF_GEN): Lesungen auf freien Plätzen (deck_band_gen_verletzt) 0 und der Leser hält nie einen freigegebenen Platz
// (keylock_leser_gen_verletzt) 0. Ohne Prüfbau nur Zähler. Mutation PLAN_LEIHE_FRUEH_FREI (Altband mit der Annahme frei) muss rot werden.
void test_platz_generation() {
  static MatMarke m1(400 * 22500, "c1c0000000000661");
  static MatSinus m2(700.0, 400 * 22500, 0.4f, "c1c0000000000662");
  const Karte k(132.0, 0);
  uint32_t gen = 1;
  auto d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::Deck deck;
  deck.setze_karte(&k, &gen);
  deck.setze_keylock(d.get(), &post);
  std::atomic<bool> halt{false}, pause{false};
  std::thread vorbereiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      post.takt(*d);
      std::this_thread::sleep_for(std::chrono::microseconds(700));
    }
  });
  std::thread arbeiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      if (!pause.load(std::memory_order_acquire)) d->fuelle_synchron();
      std::this_thread::sleep_for(std::chrono::microseconds(300));
    }
  });
#if defined(__SANITIZE_THREAD__)
  const int N = 300, TAKT_US = 3000;
#else
  const int N = 2000, TAKT_US = 400;
#endif
  std::mt19937 z(20261009);
  int64_t s = 0;
  float l[1024], r[1024];
  int belegt_max = 0;
  auto block = [&](int nb = B) {
    deck.block(s, nb, l, r, 0);
    belegt_max = std::max(belegt_max, deck.keylock_verliehen());
    s += nb;
    std::this_thread::sleep_for(std::chrono::microseconds(TAKT_US));
  };
  deck.lade(&m1.m, 0);
  deck.start(0, 0);
  for (int j = 0; j < 60; ++j) block();
  uint64_t id = 1000;
  int n_plan = 0, n_ab = 0, n_neu = 0, n_sofort = 0, n_trug = 0, ziel_plan = 0;
  for (int i = 0; i < N; ++i) {
    const int was = (int)(z() % 5);
    if (!deck.laeuft()) {
      deck.start(s, (int64_t)(z() % 100) * 22500);
      for (int j = 0; j < 30; ++j) block();
    }
    if (!deck.keylock_an()) deck.keylock(s, true);
    if (was <= 2) {  // geplant: 0 ausführen, 1 abbrechen, 2 Neuansatz im Fenster
      ++n_plan;
      const double b = std::ceil(k.beat_at((double)(s + 7000 + (int64_t)(z() % 6000))));
      const int64_t e = std::llround(k.sample_at(b));
      cdj::Deck::KlAktion a;
      a.id = ++id;
      a.ab_beat = b;
      a.art = z() % 2 ? cdj::Deck::KL_SPRUNG : cdj::Deck::KL_HOTCUE;
      const int64_t dd = ((int64_t)(z() % 9) - 4) * 22500 + (int64_t)(z() % 48);
      const int64_t ab_abbruch = e - (int64_t)(z() % 6000);
      bool abgebrochen = false, neuansatz = false;
      int pause_rest = 0;
      while (s + B <= e) {
        a.s_t = e;
        a.f_neu = a.art == cdj::Deck::KL_SPRUNG ? deck.frame_bei(e) + dd : std::max<int64_t>(0, deck.frame_bei(e) + dd);
        if (!abgebrochen) deck.kl_plane(s, a);
        if (was == 1 && !abgebrochen && s >= ab_abbruch) {
          deck.kl_plan_verwerfen(s);
          abgebrochen = true;
        }
        if (was == 2 && !neuansatz && deck.keylock_wplan_aktiv() && d->wechsel_gelesen() == deck.keylock_wplan_wnr()) {
          pause.store(true, std::memory_order_release);  // Neuansatz im Fenster: Unterlauf
          neuansatz = true;
          pause_rest = 10;
        }
        if (pause_rest > 0 && --pause_rest == 0) pause.store(false, std::memory_order_release);
        block();
      }
      pause.store(false, std::memory_order_release);
      if (s < e) block((int)(e - s));
      if (!abgebrochen) {
        ++ziel_plan;
        const uint64_t ok0 = deck.keylock_geplant_ok();
        if (a.art == cdj::Deck::KL_SPRUNG) deck.springe(e, dd, a.id, a.ab_beat);
        else deck.setze_kopf(e, a.f_neu, a.id, a.ab_beat);
        n_trug += deck.keylock_geplant_ok() > ok0 ? 1 : 0;
      } else {
        ++n_ab;
      }
      n_neu += neuansatz ? 1 : 0;
    } else if (was == 3) {  // sofort: Sprung, Raster, Knopf aus und an
      ++n_sofort;
      const int w = (int)(z() % 3);
      if (w == 0) deck.springe(s, ((int64_t)(z() % 5) - 2) * 22500);
      if (w == 1) deck.setze_raster(s, (int64_t)(z() % 4000) - 2000);
      if (w == 2) {
        deck.keylock(s, false);
        for (int j = 0; j < 4; ++j) block();
        deck.keylock(s, true);
      }
    } else {  // Laden: das andere Material, Start
      ++n_sofort;
      if (deck.rueck_frei()) {
        deck.lade(z() % 2 ? &m1.m : &m2.m, s);
        deck.start(s, (int64_t)(z() % 100) * 22500);
      }
    }
    for (int j = (int)(z() % 6); j >= 0; --j) block();
    while (deck.rueckgabe()) {
    }
  }
  for (int j = 0; j < 200; ++j) block();
  halt.store(true, std::memory_order_release);
  vorbereiter.join();
  arbeiter.join();
#ifdef CYPHERDJ_PRUEF_GEN
  const uint64_t gv = cdj::deck_band_gen_verletzt(), lv = deck.keylock_leser_gen_verletzt();
#else
  const uint64_t gv = 0, lv = 0;
#endif
  std::printf("  P20 Lebensdauer: %d Ereignisse, geplant %d (am Ziel %d, getragen %d, abgebrochen %d, mit Neuansatz %d), sofort %d; "
              "geplant_ok %llu, verworfen %llu, zurück/Brücke/gespielt/frei %llu/%llu/%llu/%llu, kein_platz %llu, Unterläufe %llu, verliehen "
              "am Ende %d, kl_plane abgelehnt %llu; gen_verletzt %llu, Leser hält Freies %llu%s\n",
              N, n_plan, ziel_plan, n_trug, n_ab, n_neu, n_sofort, (unsigned long long)deck.keylock_geplant_ok(),
              (unsigned long long)deck.keylock_geplant_verworfen(), (unsigned long long)deck.keylock_abbruch_zurueck(),
              (unsigned long long)deck.keylock_abbruch_bruecke(), (unsigned long long)deck.keylock_abbruch_gespielt(),
              (unsigned long long)deck.keylock_abbruch_frei(), (unsigned long long)deck.keylock_kein_platz(),
              (unsigned long long)deck.keylock_unterlauf(), deck.keylock_verliehen(), (unsigned long long)deck.keylock_plan_abgelehnt(),
              (unsigned long long)gv, (unsigned long long)lv,
#ifdef CYPHERDJ_PRUEF_GEN
              ""
#else
              " (ohne Prüfbau nicht gezählt)"
#endif
  );
  std::printf("  P20 kl_plane abgelehnt je Prüfung:");
  for (int g = 0; g < 13; ++g) std::printf(" %d:%llu", g, (unsigned long long)deck.keylock_plan_grund(g));
  std::printf("\n");
  PRUEF(gv == 0 && lv == 0);
  PRUEF(n_trug > 0 && n_neu > 0 && deck.keylock_kein_platz() == 0);
  // Inhalt der Plätze (Fund platz_wieder): ein wieder genommener Platz mit den Feldern eines alten PlanBands lässt Kopf des Decks und
  // Kopf des Bandes auseinanderlaufen (kl_plane Prüfung 10). Die Generation sieht das nicht (Lebensdauer stimmt, Inhalt nicht).
  // Gemessen 09.10.: mit Fix 165 von 24897 Ablehnungen, ohne (PLAN_PLATZ_ALT) 67215 von 88650.
  PRUEF(deck.keylock_plan_grund(10) * 20 < deck.keylock_plan_abgelehnt());
  // Leckprüfung (Fix-Runde W3 S4): am Ende nur das Band der Epoche, nie kein_platz. Das Höchste zugleich wird ausgewiesen, nicht gewertet:
  // die „höchstens 3“ aus 3.6 gelten für den glücklichen Pfad (P13); mit sofortigen Ereignissen warten zusätzlich Bänder auf dem
  // Epochenweg auf die Quittung (gemessen 09.10.: 4).
  std::printf("  P20 Leihe: höchstens %d zugleich verliehen, am Ende %d\n", belegt_max, deck.keylock_verliehen());
  // und die Leihe nie voll (gemessen 09.10.: 4 im Fix-Stand, 8 = voll mit PLAN_LEIHE_ALT_BLEIBT, das am Ende sonst unsichtbar bleibt)
  PRUEF(deck.keylock_verliehen() <= 1 && deck.keylock_kein_platz() == 0 && belegt_max < cdj::DECK_KEYLOCK_BAENDER);
  PRUEF(deck.keylock_abbruch_zurueck() + deck.keylock_abbruch_bruecke() + deck.keylock_abbruch_gespielt() + deck.keylock_abbruch_frei() > 0);
  ergebnis("geplant_platz_generation");
}

// ------------------------------------------------------------------------------------------ W3 frei_veraltet (Fund aus P20)
// Ablauf, der in P20 das Band der Epoche zu früh freigab: geplanter Sprung (Altband A auf dem zweiten Weg, Eintrag in kl_frei_), A wird
// mit der Bestätigung frei, ein sofortiger Sprung nimmt denselben Platz als neues Band der Epoche (Anfrage neu). Danach muss das Band der
// Epoche verliehen bleiben, solange es Band der Epoche ist (über 40 Blöcke), und ein zweiter geplanter Sprung trägt mit dem richtigen
// Ziel (Pegelmarke Beat 16 + 4 = 20, 0,55). Vorher (Stand vor dem Fix): der veraltete Eintrag gab den neuen Platz frei.
void test_frei_veraltet() {
  static MatMarke mk(200 * 22500, "c1c0000000000663");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(16.0));
  WLauf l(k, n);
  Fall6b f;
  w_aufsetzen(l, &mk.m, f);
  l.bis(l.plan.ab - B);
  l.takt = false;                               // der Vorbereiter holt die Annahme noch nicht ab: A bleibt auf dem zweiten Weg
  l.ziel();                                     // Plan 1 an Beat 8: Sprung auf 12
  const uint64_t ok1 = l.deck.keylock_geplant_ok();
  l.bis(l.s + 4 * B);
  l.post.takt(*l.d);                            // jetzt bestätigt der Vorbereiter
  l.takt = true;
  while (l.deck.rueckgabe()) {                  // rueckgabe pflegt die Leihe zwischen zwei Blöcken (wie der Kern): A wird frei
  }
  l.deck.springe(l.s, 22500);                   // sofort: neuer Ansatz, nimmt den ersten freien Platz (A)
  const cdj::DeckBand* a = l.deck.keylock_band();
  int frei_als_band = 0;
  for (int j = 0; j < 40; ++j) {
    l.teil(B);
    const cdj::DeckBand* b = l.deck.keylock_band();
    if (!l.deck.keylock_leihe().verliehen([b](const cdj::DeckBand& x) { return &x == b; })) ++frei_als_band;
  }
  // Plan 2 an Beat 14: der Kopf liegt dann bei Quell-Beat 14 + 4 + 1 = 19, Sprung +4 auf 23 (Pegel 0,25 + 0,05 · 2 = 0,35)
  l.plan.an = true;
  l.plan.a.id = 77;
  l.plan.a.ab_beat = 14.0;
  l.plan.d = 4 * 22500;
  l.plan.ab = (std::llround(k.sample_at(14.0)) - plan_fenster(132.0)) / B * B;
  l.ziel();
  l.bis(n);
  const double p = amp_bei(l.L, std::llround(k.sample_at(14.0)) + 1500, 2000, 1000.0);
  std::printf("  frei_veraltet: Band der Epoche nach dem sofortigen Sprung %s ein früherer Platz, Blöcke mit freigegebenem Band der Epoche %d "
              "(Soll 0), geplant_ok %llu, Pegel nach Plan 2 %.4f (Beat 23 %.2f: %+.2f dB)\n",
              a ? "ist" : "ist kein", frei_als_band, (unsigned long long)l.deck.keylock_geplant_ok(), p, marke_pegel(23),
              20 * std::log10(p / marke_pegel(23)));
  PRUEF(ok1 == 1);  // der Fall liegt vor: Plan 1 trug, A ging auf den zweiten Weg
  PRUEF(frei_als_band == 0 && l.deck.keylock_geplant_ok() == 2 && std::fabs(20 * std::log10(p / marke_pegel(23))) <= 0.5);
  ergebnis("frei_veraltet");
}

// ------------------------------------------------------------------------------------------ W3 platz_wieder (Fund aus P20)
// Ein Platz der Leihe, der ein PlanBand war, kommt frei und wird von einem gewöhnlichen Ansatz (sofortiges Ereignis) oder einem
// geplanten Start (6a) wieder genommen: er darf keinen Wechsel (off, p_sw, off_neu) des alten Plans tragen. Sechs Runden: geplanter
// Sprung (+4 Beats, ausgeführt), 30 Blöcke, rueckgabe, sofortiger Sprung (+1 Beat). Nach jedem sofortigen Sprung: das Band der Epoche
// ist kein PlanBand; Pegelmarke im Ring nach der Brücke = Pegel des Quell-Beats, den das Deck meldet (kein verborgener Sprung).
void test_platz_wieder() {
  static MatMarke mk(400 * 22500, "c1c0000000000664");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(70.0));
  WLauf l(k, n);
  Fall6b f;
  f.planen = false;
  w_aufsetzen(l, &mk.m, f);
  int plan_band = 0, pegel_falsch = 0, runden = 0;
  for (int r = 0; r < 6; ++r) {
    for (int j = 0; j < 3; ++j) {  // drei geplante Sprünge in Folge: mehrere freie Plätze, die PlanBänder waren, vor dem ersten gewöhnlichen
      const double b = 8.0 + 9.0 * r + 2.0 * j;
      l.plan.an = true;
      l.plan.a = cdj::Deck::KlAktion{};
      l.plan.a.id = 200 + (uint64_t)(10 * r + j);
      l.plan.a.art = cdj::Deck::KL_SPRUNG;
      l.plan.a.ab_beat = b;
      l.plan.d = 4 * 22500;
      l.plan.f_fest = false;
      l.plan.ab = (std::llround(k.sample_at(b)) - plan_fenster(132.0)) / B * B;
      l.ziel();
    }
    l.bis(l.s + 30 * B);
    while (l.deck.rueckgabe()) {
    }
    l.deck.springe(l.s, 22500);
    const int64_t s_sofort = l.s;
    const bool pb = l.deck.keylock_band() && l.deck.keylock_band()->plan();
    plan_band += pb ? 1 : 0;
    l.bis(s_sofort + 7500 + 2000);
    const int64_t q = l.deck.frame_bei(s_sofort + 8500) / 22500;  // Quell-Beat, den das Deck dort meldet
    const double p = amp_bei(l.L, s_sofort + 7500, 2000, 1000.0);
    const bool falsch = std::fabs(20 * std::log10(p / marke_pegel(q))) > 0.5;
    pegel_falsch += falsch ? 1 : 0;
    ++runden;
    std::printf("  platz_wieder Runde %d: Band nach dem sofortigen Sprung ist PlanBand %d, Pegel %.4f (Quell-Beat %lld: %.2f)\n", r, (int)pb, p,
                (long long)q, marke_pegel(q));
  }
  std::printf("  platz_wieder: %d Runden, PlanBand als Band eines gewöhnlichen Ansatzes %d, Pegel falsch %d, geplant_ok %llu\n", runden,
              plan_band, pegel_falsch, (unsigned long long)l.deck.keylock_geplant_ok());
  PRUEF(plan_band == 0 && pegel_falsch == 0 && l.deck.keylock_geplant_ok() == 18);
  ergebnis("platz_wieder");
}

// ------------------------------------------------------------------------------------------ W3 sprung_vor_anfang (Fund aus P20)
// Geplanter Sprung vor den Materialanfang (Beat 8, −10 Beats: Frame −45000; das Deck spielt dort Stille wie heute): das Deck übernimmt den
// Kopf (Frame nach dem Ziel = f_neu + Weg), danach trägt ein zweiter geplanter Sprung (Kopf des Decks = Kopf des Bandes). Vorher
// (Stand vor dem Fix) behielt das Deck seinen alten Kopf, weil f < 0 als „Kopf bleibt“ galt; der zweite Plan wurde abgelehnt.
void test_sprung_vor_anfang() {
  static MatMarke mk(200 * 22500, "c1c0000000000665");
  const Karte k(132.0, 0);
  const int64_t n = std::llround(k.sample_at(16.0));
  WLauf l(k, n);
  Fall6b f;
  f.d = -10 * 22500;
  w_aufsetzen(l, &mk.m, f);
  l.ziel();
  const int64_t e = std::llround(k.sample_at(8.0));
  l.bis(e + 2000);
  const int64_t ist = l.deck.frame_bei(e + 1000), soll = 8 * 22500 - 10 * 22500 + std::llround(1000 * 132.0 / 128.0);
  l.plan.an = true;
  l.plan.a.id = 78;
  l.plan.a.ab_beat = 13.0;  // Kopf dort bei Quell-Beat 3; +4 Beats auf 7
  l.plan.d = 4 * 22500;
  l.plan.ab = (std::llround(k.sample_at(13.0)) - plan_fenster(132.0)) / B * B;
  l.ziel();
  l.bis(n);
  const double p = amp_bei(l.L, std::llround(k.sample_at(13.0)) + 1500, 2000, 1000.0);
  std::printf("  sprung_vor_anfang: Frame s_t + 1000 %lld (Soll %lld), geplant_ok %llu (Soll 2), Pegel nach Plan 2 %.4f (Beat 7 %.2f)\n",
              (long long)ist, (long long)soll, (unsigned long long)l.deck.keylock_geplant_ok(), p, marke_pegel(7));
  PRUEF(std::llabs(ist - soll) <= 1 && l.deck.keylock_geplant_ok() == 2 && std::fabs(20 * std::log10(p / marke_pegel(7))) <= 0.5);
  ergebnis("sprung_vor_anfang");
}

// ------------------------------------------------------------------------------------------ P10/P17a ereignis_fenster (Fix-Runde W3, S1/F1)
// Ein Ereignis, das den angenommenen Plan nicht trägt, kurz vor dem Ziel: s_t − 0, 50, 124, 200, 250, 300, bei 100, 132, 150 BPM, Sinus
// 1000 Hz 0,5, geplanter Sprung +4 Beats + 7 Frames (nicht kohärent). Arten: Loop an, Knopf aus, sofortiger Sprung, Raster, Laden + Start,
// am Ziel ein anderes Ziel mit demselben Schlüssel (P17a, nur s_t − 0), Stopp bei s_t − v und die geplante Aktion am Ziel (nur v > 0).
// Grenze (Entscheid der Hauptinstanz 09.10.): größter Nachbarsprung in [Ereignis − 64, Ziel + 2000) ≤ 1,5 × derselbe Ablauf ohne Plan
// (Prüfung: ohne Plan 0,06 bis 0,08). Vorher (37fc3db4) schaltete kl_einfrieren den Ring hart stumm (0,23 bis 0,73).
// Nach dem Ereignis: Loop an hat den Loop, Knopf aus den Keylock aus (die Aufrufer werten kl_einfrieren nicht aus).
void test_ereignis_fenster() {
  static MatSinus sinus(1000.0, 200 * 22500, 0.5f, "c1c0000000000666");
  static MatSinus anders(700.0, 200 * 22500, 0.4f, "c1c0000000000667");
  const char* namen[] = {"Loop an", "Knopf aus", "Sprung sofort", "Raster", "Laden+Start", "P17a anderes Ziel", "Stopp, Aktion am Ziel"};
  int faelle = 0, rot = 0, zustand_falsch = 0;
  double schlimmst = 0;
  uint64_t ausblende = 0;
  for (const double bpm : {100.0, 132.0, 150.0}) {
    const Karte k(bpm, 0);
    const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(11.0));
    for (int art = 0; art < 7; ++art)
      for (const int64_t v : {(int64_t)0, (int64_t)50, (int64_t)124, (int64_t)200, (int64_t)250, (int64_t)300}) {
        if (art == 5 && v != 0) continue;
        if (art == 6 && v == 0) continue;
        double sm[2] = {};
        bool ok_zustand = true;
        for (int mit = 0; mit < 2; ++mit) {
          WLauf l(k, n);
          Fall6b f;
          f.bpm = bpm;
          f.d = 4 * 22500 + 7;
          w_aufsetzen(l, &sinus.m, f);
          if (!mit) l.plan.an = false;
          const int64_t sx = e - v;
          l.genau(sx);
          const uint64_t id = mit ? l.plan.a.id : 0;
          const double b = mit ? l.plan.a.ab_beat : NAN;
          switch (art) {
            case 0: l.deck.loop_an(sx, l.deck.frame_bei(sx) + 3000, 22500, 0.0); break;
            case 1: l.deck.keylock(sx, false); break;
            case 2: l.deck.springe(sx, 22500 + 3); break;
            case 3: l.deck.setze_raster(sx, 1500); break;
            case 4: l.deck.lade(&anders.m, sx), l.deck.start(sx, 30 * 22500); break;
            case 5: l.deck.springe(e, 8 * 22500 + 7, id, b); break;
            case 6: l.deck.stopp(sx); break;
          }
          l.plan.an = false;
          if (art == 6) {
            l.genau(e);
            l.deck.springe(e, f.d, id, b);
          }
          if (mit && art == 0) ok_zustand = l.deck.loop_aktiv();
          if (mit && art == 1) ok_zustand = !l.deck.keylock_an();
          l.bis(n);
          sm[mit] = sprung_max(l.L, sx - 64, e + 2000);
          if (mit) ausblende += l.deck.keylock_abbruch_ausblende();
        }
        ++faelle;
        const bool gut = sm[1] <= 1.5 * sm[0];
        rot += gut ? 0 : 1;
        zustand_falsch += ok_zustand ? 0 : 1;
        schlimmst = std::max(schlimmst, sm[1] / sm[0]);
        std::printf("  ereignis_fenster %3.0f BPM %-22s s_t − %3lld: Nachbarsprung mit Plan %.4f, ohne %.4f (%.2f ×)%s\n", bpm, namen[art],
                    (long long)v, sm[1], sm[0], sm[1] / sm[0], gut ? "" : "  ZU HOCH");
      }
  }
  std::printf("  ereignis_fenster: %d Fälle, über 1,5 × %d, größtes Verhältnis %.2f, Zustand falsch %d, Ausblende mit Sprungstück %llu\n", faelle,
              rot, schlimmst, zustand_falsch, (unsigned long long)ausblende);
  PRUEF(rot == 0 && zustand_falsch == 0 && ausblende > 0);
  ergebnis("ereignis_fenster");
}

// ------------------------------------------------------------------------------------------ P11b geplant_dehner_haelt (Fix-Runde W3, S2)
// P11 wie im Plan: der Arbeits-Thread hält (fuelle aus), (a) ab dem Block nach der Planung bis zum Ziel: der Wechsel wird nie gelesen,
// der Ring läuft leer (Unterlauf, Neuansatz), am Ziel der heutige Weg. Ausgabe bitgleich zum Ablauf ohne Plan mit demselben Halt,
// geplant_verworfen 1, geplant_ok 0. (b) Halt ab s_t − 1536 bis zum Ziel (der Wechsel ist angenommen): nicht bitgleich (R3-Vorgriff,
// ausgewiesen), Nachbarsprung in [s_t − 6000, s_t + 8000) ≤ 1,5 × ohne Plan. Negativ-Kontrolle: ohne Halt trägt derselbe Plan (ok 1).
// Übernommen aus der Probe probe_halt der Prüfung (pruef-w3/spec).
void test_dehner_haelt() {
  static MatMarke mk(200 * 22500, "c1c0000000000668");
  const Karte k(132.0, 0);
  const int64_t e = std::llround(k.sample_at(8.0)), n = std::llround(k.sample_at(11.0));
  for (int fall = 0; fall < 3; ++fall) {  // 0 Halt ab Planung, 1 Halt ab s_t − 1536, 2 ohne Halt
    std::vector<float> aus[2];
    uint64_t ok[2] = {}, verw[2] = {};
    for (int mit = 0; mit < 2; ++mit) {
      WLauf l(k, n);
      Fall6b f;
      w_aufsetzen(l, &mk.m, f);
      if (!mit) l.plan.an = false;
      l.bis(l.plan.ab + B);
      if (fall < 2) {
        l.bis(fall == 0 ? l.plan.ab + B : (e - 1536) / B * B);
        l.fuelle = false;
      }
      l.genau(e);
      l.fuelle = true;
      l.deck.springe(e, f.d, mit ? l.plan.a.id : 0, mit ? l.plan.a.ab_beat : NAN);
      l.plan.an = false;
      l.bis(n);
      aus[mit] = l.L;
      ok[mit] = l.deck.keylock_geplant_ok();
      verw[mit] = l.deck.keylock_geplant_verworfen();
    }
    int64_t erst = -1;
    const int64_t ug = ungleich(aus[0], aus[1], 0, n, &erst);
    const double sm1 = sprung_max(aus[1], e - 6000, e + 8000), sm0 = sprung_max(aus[0], e - 6000, e + 8000);
    std::printf("  P11b %s: ungleich zum Ablauf ohne Plan %lld (erstes s_t%+lld), geplant_ok %llu, verworfen %llu, Nachbarsprung mit %.4f ohne %.4f\n",
                fall == 0 ? "Halt ab Planung   " : fall == 1 ? "Halt ab s_t − 1536" : "ohne Halt         ", (long long)ug,
                (long long)(erst - e), (unsigned long long)ok[1], (unsigned long long)verw[1], sm1, sm0);
    if (fall == 0) PRUEF(ug == 0 && ok[1] == 0 && verw[1] == 1);
    if (fall == 1) PRUEF(ok[1] == 0 && verw[1] == 1 && sm1 <= 1.5 * sm0);
    if (fall == 2) PRUEF(ok[1] == 1);
  }
  ergebnis("geplant_dehner_haelt");
}

// ------------------------------------------------------------------------------------------ P20x geplant_platz_fenster (Fix-Runde W3, S4b)
// Übernommen aus der Probe P20x der Qualitätsprüfung (pruef-w3/qualitaet/proben/probe_p20x.cpp): P20 erweitert um Ereignisse IM Planfenster
// (sofortiger Sprung, Raster, Knopf, Loop an, Laden, Stopp + Start, Abbruch; auch in den letzten 300 Samples) und um Loop-an- und Start-Pläne,
// echte Fäden, 2000 Ereignisse (TSan 300).
void test_platz_fenster() {
#if defined(__SANITIZE_THREAD__)
  const int N = 300, TAKT_US = 3000;
#else
  const int N = 2000, TAKT_US = 400;
#endif
  const uint32_t saat = 20261009u;
  static MatMarke m1(400 * 22500, "c1c0000000000791");
  static MatSinus m2(700.0, 400 * 22500, 0.4f, "c1c0000000000792");
  const Karte k(132.0, 0);
  uint32_t gen = 1;
  auto d = cdj::dehner_neu(1);
  cdj::StreckPost post;
  cdj::Deck deck;
  deck.setze_karte(&k, &gen);
  deck.setze_keylock(d.get(), &post);
  std::atomic<bool> halt{false}, pause{false};
  std::thread vorbereiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      post.takt(*d);
      std::this_thread::sleep_for(std::chrono::microseconds(700));
    }
  });
  std::thread arbeiter([&] {
    while (!halt.load(std::memory_order_acquire)) {
      if (!pause.load(std::memory_order_acquire)) d->fuelle_synchron();
      std::this_thread::sleep_for(std::chrono::microseconds(300));
    }
  });
  std::mt19937 z(saat);
  int64_t s = 0;
  float l[1024], r[1024];
  auto block = [&](int nb = B) {
    deck.block(s, nb, l, r, 0);
    s += nb;
    std::this_thread::sleep_for(std::chrono::microseconds(TAKT_US));
  };
  deck.lade(&m1.m, 0);
  deck.start(0, 0);
  for (int j = 0; j < 60; ++j) block();
  uint64_t id = 1000;
  int n_plan = 0, n_drin = 0, n_trug = 0, n_loop = 0, n_start = 0;
  int drin_art[8] = {};
  int belegt_max = 0;
  for (int i = 0; i < N; ++i) {
    if (!deck.laeuft()) {
      deck.start(s, (int64_t)(z() % 100) * 22500);
      for (int j = 0; j < 30; ++j) block();
    }
    if (!deck.keylock_an()) deck.keylock(s, true);
    if (deck.loop_aktiv()) deck.loop_aus(s);
    for (int j = 0; j < 12; ++j) block();
    ++n_plan;
    const double b = std::ceil(k.beat_at((double)(s + 7000 + (int64_t)(z() % 6000))));
    const int64_t e = std::llround(k.sample_at(b));
    cdj::Deck::KlAktion a;
    a.id = ++id;
    a.ab_beat = b;
    const int wa = (int)(z() % 4);
    a.art = wa == 0 ? cdj::Deck::KL_SPRUNG : wa == 1 ? cdj::Deck::KL_HOTCUE : wa == 2 ? cdj::Deck::KL_LOOP_AN : cdj::Deck::KL_START;
    n_loop += a.art == cdj::Deck::KL_LOOP_AN;
    n_start += a.art == cdj::Deck::KL_START;
    const int64_t dd = ((int64_t)(z() % 9) - 4) * 22500 + (int64_t)(z() % 48);
    // Ereignis im Fenster: 0 keins; sonst bei zufälliger Zeit zwischen Planung und Ziel (auch in den letzten 300 Samples)
    const int drin = (int)(z() % 8);
    const int64_t t_drin = e - (int64_t)(z() % 2) * (int64_t)(z() % 300) - (int64_t)(1 - (z() % 2)) * (int64_t)(z() % 6000) - 1;
    bool getan = false;
    int64_t la = 0, ll = 0;
    while (s + B <= e) {
      a.s_t = e;
      if (a.art == cdj::Deck::KL_LOOP_AN) {
        if (!getan && ll == 0) {
          la = deck.frame_bei(e) + 2000 + (int64_t)(z() % 4000);
          ll = 2 * 22500;
        }
        a.loop_a = la, a.loop_l = ll, a.loop_lx = 0.0, a.f_neu = 0;
      } else {
        a.loop_l = 0;
        a.f_neu = a.art == cdj::Deck::KL_SPRUNG ? deck.frame_bei(e) + dd : std::max<int64_t>(0, deck.frame_bei(e) + dd);
      }
      if (!getan) deck.kl_plane(s, a);
      if (drin && !getan && s + B > t_drin) {
        ++n_drin;
        ++drin_art[drin];
        switch (drin) {
          case 1: deck.springe(s, 22500); break;
          case 2: deck.setze_raster(s, (int64_t)(z() % 4000) - 2000); break;
          case 3: deck.keylock(s, false); block(); deck.keylock(s, true); break;
          case 4: deck.loop_an(s, deck.frame_bei(s) + 3000, 22500, 0.0); break;
          case 5: if (deck.rueck_frei()) deck.lade(z() % 2 ? &m1.m : &m2.m, s), deck.start(s, (int64_t)(z() % 100) * 22500); break;
          case 6: deck.stopp(s); block(); block(); block(); deck.start(s, (int64_t)(z() % 100) * 22500); break;
          case 7: deck.kl_plan_verwerfen(s); break;
        }
        getan = true;
      }
      block();
      belegt_max = std::max(belegt_max, deck.keylock_verliehen());
    }
    if (s < e) block((int)(e - s));
    if (!getan || drin == 0) {
      const uint64_t ok0 = deck.keylock_geplant_ok();
      switch (a.art) {
        case cdj::Deck::KL_SPRUNG: deck.springe(e, dd, a.id, a.ab_beat); break;
        case cdj::Deck::KL_HOTCUE: deck.setze_kopf(e, a.f_neu, a.id, a.ab_beat); break;
        case cdj::Deck::KL_START: deck.start(e, a.f_neu, false, a.id, a.ab_beat); break;
        case cdj::Deck::KL_LOOP_AN: deck.loop_an(e, a.loop_a, a.loop_l, 0.0, a.id, a.ab_beat); break;
      }
      n_trug += deck.keylock_geplant_ok() > ok0 ? 1 : 0;
    }
    for (int j = (int)(z() % 6); j >= 0; --j) block();
    while (deck.rueckgabe()) {
    }
  }
  for (int j = 0; j < 200; ++j) block();
  halt.store(true, std::memory_order_release);
  vorbereiter.join();
  arbeiter.join();
#ifdef CYPHERDJ_PRUEF_GEN
  const unsigned long long gv = cdj::deck_band_gen_verletzt(), lv = deck.keylock_leser_gen_verletzt();
#else
  const unsigned long long gv = 0, lv = 0;
#endif
  std::printf("  P20x: %d Pläne (Loop an %d, Start %d), Ereignis im Fenster %d (springe %d raster %d knopf %d loop_an %d lade %d stopp %d "
              "verwerfen %d), getragen %d; geplant_ok %llu verworfen %llu zurück/Brücke/gespielt/frei %llu/%llu/%llu/%llu kein_platz %llu "
              "Unterläufe %llu hart %llu, verliehen max %d am Ende %d; gen_verletzt %llu Leser hält Freies %llu%s\n",
              n_plan, n_loop, n_start, n_drin, drin_art[1], drin_art[2], drin_art[3], drin_art[4], drin_art[5], drin_art[6], drin_art[7],
              n_trug, (unsigned long long)deck.keylock_geplant_ok(), (unsigned long long)deck.keylock_geplant_verworfen(),
              (unsigned long long)deck.keylock_abbruch_zurueck(), (unsigned long long)deck.keylock_abbruch_bruecke(),
              (unsigned long long)deck.keylock_abbruch_gespielt(), (unsigned long long)deck.keylock_abbruch_frei(),
              (unsigned long long)deck.keylock_kein_platz(), (unsigned long long)deck.keylock_unterlauf(),
              (unsigned long long)deck.keylock_hart(), belegt_max, deck.keylock_verliehen(), gv, lv,
#ifdef CYPHERDJ_PRUEF_GEN
              ""
#else
              " (ohne Prüfbau nicht gezählt)"
#endif
  );
  std::printf("  P20x Ablehnungen je Prüfung:");
  for (int g = 0; g < 13; ++g) std::printf(" %d:%llu", g, (unsigned long long)deck.keylock_plan_grund(g));
  std::printf("\n");
  // Grenzen: keine Lesung auf freien Plätzen, der Leser hält nie einen freigegebenen Platz, Kopf des Decks = Kopf des Bandes (Prüfung 10),
  // höchstens 3 Plätze zugleich, am Ende nur das Band der Epoche, kein Leerlauf der Leihe
  PRUEF(gv == 0 && lv == 0 && deck.keylock_plan_grund(10) * 20 <= deck.keylock_plan_abgelehnt());
  PRUEF(deck.keylock_verliehen() <= 1 && deck.keylock_kein_platz() == 0 && belegt_max < cdj::DECK_KEYLOCK_BAENDER && n_drin > 0 && n_trug > 0);
  ergebnis("geplant_platz_fenster");
}

// Diagnose (kein Teil der Suite): Tonhöhe je 10-ms-Fenster nach dem geplanten Einsatz gegen rohes R3 gleicher Speisung.
// Aufruf: test_deck_geplant diag_ct BPM
void diag_ct(double bpm) {
  static MatSinus sinus(1000.0, 200 * 22500);
  const Karte k(bpm, 0);
  const double b_t = 8.0;
  const int64_t f0 = 4 * 22500;
  const int64_t e = std::llround(k.sample_at(b_t)), n = std::llround(k.sample_at(b_t + 12.0));
  DeckLauf l(k, n);
  l.deck.lade(&sinus.m, 0);
  l.plan = {true, (e - plan_fenster(bpm)) / B * B, b_t, f0, 7};
  l.start_am_ziel();
  l.bis(n);
  const int64_t s_h = l.deck.keylock_s_h();
  const DehnerAnker a{b_t, (double)f0};
  const std::vector<double> fs = l.faktoren(l.deck.keylock_epoche(), s_h);
  cdj::DeckBand ref;
  ref.m = &sinus.m;
  ref.still_bis.store(f0);
  const std::vector<float> R = km::r3_roh(ref, km::band_start(k, a, s_h, fs.at(0)), fs, s_h, n);
  double md = 0, mr = 0, mdiff = 0;
  for (int64_t t = e + 2400; t + 480 <= n - 4800; t += 480) {
    const double cd = ct_fenster(l.L, t, 480, 1000.0), cr = ct_fenster(R, t, 480, 1000.0);
    md = std::max(md, std::fabs(cd));
    mr = std::max(mr, std::fabs(cr));
    mdiff = std::max(mdiff, std::fabs(cd - cr));
    if (std::fabs(cd) > 1.5 || std::fabs(cr) > 1.5) std::printf("    E%+7lld: Deck %+.3f ct, rohes R3 %+.3f ct\n", (long long)(t - e), cd, cr);
  }
  int64_t ungleich = 0;
  int64_t erst = -1, letzt = -1;
  double gross = 0;
  for (int64_t t = e; t < n; ++t)
    if (l.L[(size_t)t] != R[(size_t)t]) {
      ++ungleich;
      if (erst < 0) erst = t;
      letzt = t;
      gross = std::max(gross, (double)std::fabs(l.L[(size_t)t] - R[(size_t)t]));
    }
  std::printf("  diag_ct ungleich von E%+lld bis E%+lld, größte Abweichung %.3g\n", (long long)(erst - e), (long long)(letzt - e), gross);
  std::printf("  diag_ct %.0f BPM: 10-ms-Fenster ab E + 50 ms bis Ende: max |Deck| %.3f ct, max |rohes R3| %.3f ct, max |Differenz| %.3f "
              "ct; Samples ab E ungleich zu rohem R3: %lld von %lld\n",
              bpm, md, mr, mdiff, (long long)ungleich, (long long)(n - e));
}

}  // namespace

int main(int argc, char** argv) {
  struct T {
    const char* name;
    void (*f)();
  };
  const T tests[] = {{"band_bitgleich", test_band_bitgleich},
#ifndef CYPHERDJ_PROBE_STAND_VORHER
                     {"band_still", test_band_still},
                     {"start_stand", test_start_stand},
                     {"ohne_kerbe", test_start_ohne_kerbe},
                     {"rampe_wartezeit", test_start_rampe_wartezeit},
                     {"ereignis_in_vorlage", test_start_ereignis_in_vorlage},
                     {"raster_wartend", test_start_raster_wartend},
                     {"negativ", test_negativ},
                     {"faeden", test_faeden},
                     {"kern", test_kern_start_geplant},
                     {"stopp_dann_plan", test_stopp_dann_plan},
                     {"fruehansatz", test_fruehansatz},
                     {"ziel_ohne_start", test_ziel_ohne_start},
                     {"allokation", test_allokation},
                     {"kern_abbruch", test_kern_abbruch},
                     {"band_scan", test_band_scan},
                     {"restzone", test_restzone},
                     {"knopf_vorlage", test_knopf_vorlage},
                     {"rampe_bremst", test_rampe_bremst},
                     {"kern_hand_stopp", test_kern_hand_stopp},
                     {"ziel_ohne_start_tempi", test_ziel_ohne_start_tempi},
#endif
                     {"band_wechsel", test_band_wechsel},
                     {"leihe_wechsel", test_leihe_wechsel},
                     {"leihe_gen", test_leihe_gen},
                     {"sprung_sinus", test_sprung_sinus},
                     {"sprung_marke", test_sprung_marke},
                     {"sprung_gegenphase", test_sprung_gegenphase},
                     {"hotcue_klick", test_hotcue_klick},
                     {"loop_an", test_loop_an},
                     {"abbruch_spaet", test_abbruch_spaet},
                     {"karte_neu", test_karte_neu},
                     {"ereignis_dazwischen", test_ereignis_dazwischen},
                     {"dehner_verfehlt", test_dehner_verfehlt},
                     {"dehner_haelt", test_dehner_haelt},
                     {"folge", test_folge},
                     {"allokation6b", test_allokation6b},
                     {"ziel_weicht_ab", test_ziel_weicht_ab},
                     {"platz_generation", test_platz_generation},
                     {"platz_fenster", test_platz_fenster},
                     {"frei_veraltet", test_frei_veraltet},
                     {"platz_wieder", test_platz_wieder},
                     {"sprung_vor_anfang", test_sprung_vor_anfang},
                     {"ereignis_fenster", test_ereignis_fenster},
  };
  if (argc >= 3 && !std::strcmp(argv[1], "diag_ct")) {
    diag_ct(std::atof(argv[2]));
    return 0;
  }
  for (const T& t : tests)
    if (argc < 2 || !std::strcmp(argv[1], t.name)) t.f();
  PRUEF_ENDE();
}
