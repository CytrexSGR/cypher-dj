// Umbauplan 2026-10-09-bungee-umbau, S1: der Dehner mit Bungee (src/dehner_bungee.cpp) offline, ohne JACK. Wie test_dehner
// spielt der Test den Callback (Karte veröffentlichen, fuelle_synchron, Ring je Block lesen), Bungee läuft dabei im selben
// Faden. Gebaut nur mit -DCYPHERDJ_BUNGEE=ON.
// Tests:
//   1 bungee_ring_gleich_referenz   Ring-Ausgabe BITGLEICH zu einem Offline-Lauf desselben Algorithmus (hoerprobe-Art,
//                                   ein Stretcher, std::vector): konstant 135, Rampe 128 -> 135, Vorwärts- und Rückwärtssprung
//                                   (zweiter Ansatz); Lesen in Blöcken zu 256 und 1024; Standard und fein
//   2 bungee_lage                   Klick-Lage gegen die Karte (Median |Δ| <= 2 ms); Fehlerfall KORN_EINS_SPAET liegt bei 11 ms
//   3 bungee_allokation             0 Allokationen in fuelle_synchron UND ansetzen (Neustart, Sprünge, Rampe); Positiv-Kontrolle
//   4 bungee_epochen                Epoche/Quittung, Leer-Epoche, wechsel() = verfehlt, Erneuerung vor s_h
//   5 bungee_kosten                 fuelle_synchron je Aufruf über 60 s Audio: p99,9 <= 1 ms (nur bei Last < 8 aussagekräftig)
// Fehlerfälle (CMake test_mutation, WILL_FAIL): CYPHERDJ_MUTATION_BUNGEE_KORN_EINS_SPAET (Test 1 und 2 rot),
// CYPHERDJ_MUTATION_BUNGEE_OHNE_RESET (Test 1 rot: der Sprung wird nicht neu angesetzt).
#include <algorithm>
#include <bungee/Bungee.h>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "alloc_abfang.h"
#include "cypherdj/dehner.h"
#include "cypherdj/fassung.h"
#include "cypherdj/uhr.h"
#include "keylock_mess.h"
#include "pruef.h"

namespace {

using cdj::DehnerAnker;
using cdj::DehnerBasis;
using cdj::DehnerOptionen;
using cdj::Karte;
using km::B;
using km::FPB;

// Material, Basis 128, erster Schlag Frame 0. art 0: Klick je Quell-Beat; art 1: Klick + Ton 330 Hz + Rauschen (Musik-Ersatz)
struct Quelle : cdj::DehnerQuelle {
  std::vector<float> d;
  int64_t frames;
  Quelle(double sekunden, int art) : frames(static_cast<int64_t>(sekunden * 48000.0)) {
    d.assign(static_cast<std::size_t>(frames), 0.0f);
    const std::vector<float> tpl = km::klick_vorlage();
    for (int64_t q = 0; static_cast<double>(q) * FPB + 144 < static_cast<double>(frames); ++q)
      for (int i = 0; i < 144; ++i) d[static_cast<std::size_t>(static_cast<int64_t>(q * FPB) + i)] = tpl[static_cast<std::size_t>(i)];
    if (art == 1) {
      uint32_t z = 12345;
      for (int64_t f = 0; f < frames; ++f) {
        z = z * 1664525u + 1013904223u;
        const float rausch = (static_cast<float>(z >> 8) / 16777216.0f - 0.5f) * 0.1f;
        d[static_cast<std::size_t>(f)] += static_cast<float>(0.2 * std::sin(2 * km::PI * 330.0 * static_cast<double>(f) / 48000.0)) + rausch;
      }
    }
  }
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) {
      const int64_t f = ab + i;
      const float v = (f >= 0 && f < frames) ? d[static_cast<std::size_t>(f)] : 0.0f;
      l[i] = v;
      r[i] = v * 0.75f;  // zwei verschiedene Kanäle
    }
  }
  double basis_bpm() const noexcept override { return 128.0; }
};

cdj::AnsatzAuftrag auftrag(const cdj::DehnerQuelle* m, int64_t s_h, DehnerAnker a, const Karte& k, uint32_t g) {
  cdj::AnsatzAuftrag x;
  x.quelle = m;
  x.s_h = s_h;
  x.anker = a;
  x.karte = k;
  x.generation = g;
  return x;
}

// ---- Referenz: derselbe Algorithmus offline, ein Stretcher, alles in std::vector (wie hoerprobe.cpp BungeeDeck)
void referenz(const cdj::DehnerQuelle& q, const Karte& karte, DehnerAnker an, int64_t s_h, int64_t n, bool fein,
              std::vector<float>& L, std::vector<float>& R) {
  using St = Bungee::Stretcher<Bungee::Basic>;
  const int hop = fein ? 256 : 512;
  const double fpb = cdj::FRAMES_JE_MINUTE / q.basis_bpm();
  auto kopf = [&](double s) { return an.f + (karte.beat_at(s) - an.b) * fpb; };
  auto speed = [&](double s) { return karte.bpm_at(s) / q.basis_bpm(); };
  St st(Bungee::SampleRates{48000, 48000}, 2, fein ? -1 : 0);
  const int stride = st.maxInputFrameCount();
  std::vector<float> in(2 * static_cast<std::size_t>(stride));
  const double p_start = kopf(static_cast<double>(s_h));
  Bungee::Request req{};
  req.position = p_start;
  req.speed = speed(static_cast<double>(s_h));
  req.pitch = 1.0;
  req.reset = true;
  req.resampleMode = resampleMode_autoOut;
  st.preroll(req);
  bool gestartet = false;
  int64_t gout = 0;
  bool erstes = true;
  L.clear();
  R.clear();
  while (static_cast<int64_t>(L.size()) < n) {
    const Bungee::InputChunk ch = st.specifyGrain(req);
    q.band(ch.begin, ch.end - ch.begin, in.data(), in.data() + stride);
    st.analyseGrain(in.data(), stride, 0, 0);
    Bungee::OutputChunk oc{};
    st.synthesiseGrain(oc);
    int skip = 0;
    if (!gestartet) {
      const double p0 = oc.request[0] ? oc.request[0]->position : NAN, p1 = oc.request[1] ? oc.request[1]->position : NAN;
      if (std::isnan(p0) || std::isnan(p1) || p1 <= p_start) {
        skip = oc.frameCount;
      } else {
        if (p0 < p_start) skip = static_cast<int>(std::lround((p_start - p0) / (p1 - p0) * oc.frameCount));
        gestartet = true;
      }
    }
    for (int i = skip; i < oc.frameCount; ++i) {
      L.push_back(oc.data[i]);
      R.push_back(oc.data[oc.channelStride + i]);
    }
    req.reset = false;
    if (erstes) erstes = false;
    else gout += hop;
    const double m = static_cast<double>(s_h + gout);
    req.position = kopf(m);
    req.speed = speed(m);
  }
}

// ---- Der Callback: Ring-Ausgabe je Kern-Sample (Index = Sample; nicht gelieferte bleiben NaN)
struct Lauf {
  std::unique_ptr<DehnerBasis> d;
  std::vector<float> L, R;
  int unterlauf = 0;
  int blk;
  Lauf(const DehnerOptionen& o, int64_t laenge, int block)
      : d(cdj::dehner_neu(1, o)),
        L(static_cast<std::size_t>(laenge), NAN),
        R(static_cast<std::size_t>(laenge), NAN),
        blk(block) {}
  // Ein Zyklus ab Sample b: Karte veröffentlichen, Ansatz (falls einer ansteht), Ring füllen, Ring lesen
  void block(int64_t b, const Karte& k, uint32_t gen, const cdj::AnsatzAuftrag* neu = nullptr) {
    cdj::KartenStand st;
    st.karte = k;
    st.generation = gen;
    st.s_jetzt = b;
    d->karte_veroeffentlichen(st);
    if (neu) d->ansetzen(*neu);
    d->fuelle_synchron();
    cdj::StreckRing& r = d->ring();
    r.setze_epoche(d->epoche());
    std::vector<float> l(static_cast<std::size_t>(blk)), rr(static_cast<std::size_t>(blk));
    const int64_t ab = r.bereit_ab(b);
    if (ab < 0 || ab >= b + blk) return;
    const int n = static_cast<int>(b + blk - ab);
    if (!r.lies(ab, n, l.data(), rr.data())) {
      ++unterlauf;
      return;
    }
    for (int i = 0; i < n; ++i)
      if (ab + i < static_cast<int64_t>(L.size())) {
        L[static_cast<std::size_t>(ab + i)] = l[static_cast<std::size_t>(i)];
        R[static_cast<std::size_t>(ab + i)] = rr[static_cast<std::size_t>(i)];
      }
  }
};

DehnerOptionen optionen(bool fein, int block) {
  DehnerOptionen o;
  o.maschine = cdj::DehnerMaschine::Bungee;
  o.bungee_fein = fein;
  o.quantum = block;
  return o;
}

// Zahl der Frames in [a, b), die nicht bitgleich zur Referenz (r, versetzt: Referenz-Frame 0 = Sample s0) sind
int64_t abweichung(const Lauf& l, const std::vector<float>& rl, const std::vector<float>& rr, int64_t s0, int64_t a, int64_t b) {
  int64_t n = 0;
  for (int64_t s = a; s < b; ++s) {
    const std::size_t i = static_cast<std::size_t>(s - s0);
    if (i >= rl.size()) break;
    const float x = l.L[static_cast<std::size_t>(s)], y = l.R[static_cast<std::size_t>(s)];
    if (std::memcmp(&x, &rl[i], 4) != 0 || std::memcmp(&y, &rr[i], 4) != 0) {
      if (n == 0) std::fprintf(stderr, "   erste Abweichung bei Sample %lld: ring %g, referenz %g\n", static_cast<long long>(s), x, rl[i]);
      ++n;
    }
  }
  return n;
}

// ---- 1 Ring == Referenz
void test_referenz() {
  std::printf("-- 1 bungee_ring_gleich_referenz\n");
  const Quelle q(60.0, 1);
  struct Fall {
    const char* name;
    int rampe;  // 0 konstant 135, 1 Rampe 128 -> 135 ab Beat 6 über 8 Beats, 2 konstant mit Vorwärtssprung, 3 Rückwärtssprung
  };
  const Fall faelle[] = {{"konstant 135", 0}, {"Rampe 128->135", 1}, {"Sprung vorwaerts", 2}, {"Sprung rueckwaerts", 3}};
  for (const bool fein : {false, true}) {
    for (const int blk : {256, 1024}) {
      for (const Fall& f : faelle) {
        Karte k(f.rampe == 1 ? 128.0 : 135.0, 0);
        if (f.rampe == 1) k.rampe(6.0, 135.0, 8.0);
        const DehnerAnker an1{0.0, 0.0};
        const int64_t s_h1 = 1000;  // mitten im Block
        const int64_t laenge = 288 * 1024;  // ~6,1 s, ganze Blöcke zu 256 und 1024
        Lauf l(optionen(fein, blk), laenge, blk);
        // zweiter Ansatz bei Block b2: Anker um +/- 16 Beats verschoben, s_h2 = b2 + 4096
        const bool zwei = f.rampe >= 2;
        const int64_t b2 = 144 * 1024;
        const int64_t s_h2 = b2 + 4096;
        const DehnerAnker an2{0.0, (f.rampe == 2 ? +16.0 : -4.0) * FPB};  // vorwärts: 16 Beats weiter, rückwärts: 4 Beats zurück (auf dem Stück bleibend)
        const cdj::AnsatzAuftrag a1 = auftrag(&q, s_h1, an1, k, 1);
        const cdj::AnsatzAuftrag a2 = auftrag(&q, s_h2, an2, k, 1);
        l.d->ansetzen(a1);
        for (int64_t b = 0; b + blk <= laenge; b += blk) l.block(b, k, 1, (zwei && b == b2) ? &a2 : nullptr);
        PRUEF(l.unterlauf == 0);
        std::vector<float> rl, rr;
        const int64_t ende1 = zwei ? b2 : laenge;
        referenz(q, k, an1, s_h1, ende1 - s_h1, fein, rl, rr);
        const int64_t ab1 = abweichung(l, rl, rr, s_h1, s_h1, ende1);
        int64_t ab2 = 0;
        if (zwei) {
          referenz(q, k, an2, s_h2, laenge - s_h2, fein, rl, rr);
          ab2 = abweichung(l, rl, rr, s_h2, s_h2, laenge);
        }
        std::printf("   %s Block %d %-18s: abweichende Frames Ansatz 1: %lld, Ansatz 2: %lld (von %lld)\n", fein ? "fein    " : "Standard", blk,
                    f.name, static_cast<long long>(ab1), static_cast<long long>(ab2), static_cast<long long>(laenge - s_h1));
        PRUEF(ab1 == 0);
        PRUEF(ab2 == 0);
        // Mindestens etwas geliefert (die Referenz-Gleichheit darf nicht an leeren Vektoren hängen)
        PRUEF(!std::isnan(l.L[static_cast<std::size_t>(s_h1 + 1000)]));
        if (zwei) PRUEF(!std::isnan(l.L[static_cast<std::size_t>(s_h2 + 1000)]));
      }
    }
  }
}

// ---- 2 Lage der Klicks gegen die Karte
void test_lage() {
  std::printf("-- 2 bungee_lage\n");
  const Quelle q(60.0, 0);
  const std::vector<float> tpl = km::klick_vorlage();
  for (const bool fein : {false, true}) {
    Karte k(135.0, 0);
    const DehnerAnker an{0.0, 0.0};
    const int64_t laenge = 20 * 48000;
    Lauf l(optionen(fein, 256), laenge, 256);
    l.d->ansetzen(auftrag(&q, 4096, an, k, 1));
    for (int64_t b = 0; b + 256 <= laenge; b += 256) l.block(b, k, 1);
    std::vector<float> x(l.L.size());
    for (std::size_t i = 0; i < x.size(); ++i) x[i] = std::isnan(l.L[i]) ? 0.0f : l.L[i];
    std::vector<double> e;
    for (int qn = 4; qn < 40; ++qn) {
      double v;
      if (km::klick_lage(x, k, an, qn, v, tpl, km::MITTE)) e.push_back(std::fabs(v));
    }
    PRUEF(e.size() >= 30);
    std::sort(e.begin(), e.end());
    const double med = e[e.size() / 2], mx = e.back();
    std::printf("   %s: %zu Klicks, Median |Δ| %.1f Samples (%.2f ms), max %.1f (%.2f ms)\n", fein ? "fein    " : "Standard", e.size(), med,
                med / 48.0, mx, mx / 48.0);
    PRUEF(med <= 96.0);  // 2 ms
  }
}

// ---- 3 Allokation
void test_allokation() {
  std::printf("-- 3 bungee_allokation\n");
#if !ALLOC_ABFANG_VERFUEGBAR
  std::printf("   uebersprungen (Sanitizer-Bau, kein Allokations-Abfang)\n");
  return;
#endif
  const Quelle q(60.0, 1);
  for (const bool fein : {false, true}) {
    Karte k(128.0, 0);
    k.rampe(40.0, 136.0, 16.0);
    std::unique_ptr<DehnerBasis> d = cdj::dehner_neu(1, optionen(fein, 256));
    PRUEF(d != nullptr);
    // Positiv-Kontrolle: der Abfang zählt, wenn etwas allokiert
    abfang_an();
    { void* p = std::malloc(1000); asm volatile("" ::"r"(p) : "memory"); std::free(p); }
    PRUEF(abfang_aus() >= 1);
    long a_ansetzen = 0, a_fuelle = 0;
    uint32_t gen = 1;
    int64_t b = 0;
    const double sprung[] = {0.0, 64.0, -32.0, 200.0, 8.0};  // Beats Anker-Versatz je Ansatz
    for (int ansatz = 0; ansatz < 5; ++ansatz) {
      cdj::KartenStand st;
      st.karte = k;
      st.generation = gen;
      st.s_jetzt = b;
      d->karte_veroeffentlichen(st);
      const DehnerAnker an{0.0, sprung[ansatz] * FPB + 8.0 * FPB};
      const cdj::AnsatzAuftrag a = auftrag(&q, b + 4096, an, k, gen);
      abfang_an();
      d->ansetzen(a);
      a_ansetzen += abfang_aus();
      for (int i = 0; i < 400; ++i, b += 256) {  // 2,1 s
        st.s_jetzt = b;
        d->karte_veroeffentlichen(st);
        abfang_an();
        d->fuelle_synchron();
        a_fuelle += abfang_aus();
        cdj::StreckRing& r = d->ring();
        r.setze_epoche(d->epoche());
        float l[256], rr[256];
        const int64_t ab = r.bereit_ab(b);
        if (ab >= 0 && ab < b + 256) r.lies(ab, static_cast<int>(b + 256 - ab), l, rr);
      }
    }
    std::printf("   %s: Allokationen in ansetzen %ld, in fuelle_synchron %ld (5 Ansaetze, Rampe)\n", fein ? "fein    " : "Standard", a_ansetzen,
                a_fuelle);
    PRUEF(a_ansetzen == 0);
    PRUEF(a_fuelle == 0);
  }
}

// ---- 4 Epochen, Quittung, Leer-Epoche, wechsel, Erneuerung
void test_epochen() {
  std::printf("-- 4 bungee_epochen\n");
  const Quelle q(30.0, 1);
  Karte k(135.0, 0);
  std::unique_ptr<DehnerBasis> d = cdj::dehner_neu(1, optionen(false, 256));
  PRUEF(d->epoche() == cdj::EPOCHE_KEINE);
  PRUEF(d->quittiert_e() == cdj::EPOCHE_KEINE);
  const uint32_t e1 = d->ansetzen(auftrag(&q, 5000, {0.0, 0.0}, k, 1));
  PRUEF(e1 == 1 && d->epoche() == 1);
  PRUEF(d->quittiert_e() == cdj::EPOCHE_KEINE);  // erst fuelle_synchron übernimmt
  d->fuelle_synchron();
  PRUEF(d->quittiert_e() == 1);
  PRUEF(d->geschrieben_bis() > 5000);
  const uint32_t e2 = d->ansetzen(auftrag(&q, 9000, {0.0, 0.0}, k, 1));
  const uint32_t e3 = d->ansetzen(auftrag(&q, 9500, {0.0, 0.0}, k, 1));  // ersetzt den wartenden
  PRUEF(e2 == 2 && e3 == 3);
  d->fuelle_synchron();
  PRUEF(d->quittiert_e() == 3);
  const uint32_t e4 = d->ansetzen(auftrag(nullptr, 20000, {0.0, 0.0}, k, 1));  // Leer-Epoche
  d->fuelle_synchron();
  PRUEF(e4 == 4 && d->quittiert_e() == 4 && d->geschrieben_bis() == -1);
  // wechsel(): verfehlt, Nummern ab 1
  cdj::WechselAuftrag w;
  w.epoche = d->epoche();
  w.neu = &q;
  PRUEF(d->wechsel(w) == 1);
  PRUEF(d->wechsel(w) == 2);
  PRUEF(d->wechsel_verfehlt() == 2 && d->wechsel_n_verfehlt() == 2 && d->wechsel_gelesen() == 0 && d->wechsel_n_angenommen() == 0);
  // Erneuerung: neue Generation vor s_h setzt neu an, hinter s_h nicht
  const uint32_t e5 = d->ansetzen(auftrag(&q, 40000, {0.0, 0.0}, k, 5));
  cdj::KartenStand st;
  st.karte = k;
  st.generation = 6;
  st.s_jetzt = 30000;
  d->vorbereiter_schritt(st);
  PRUEF(d->epoche() == e5 + 1 && d->ansatz_erneuert() == 1);
  d->vorbereiter_schritt(st);  // gleiche Generation: nichts
  PRUEF(d->epoche() == e5 + 1);
  st.generation = 7;
  st.s_jetzt = 50000;  // hinter s_h
  d->vorbereiter_schritt(st);
  PRUEF(d->epoche() == e5 + 1 && d->ansatz_erneuert() == 1);
}

// ---- 5 Kosten von fuelle_synchron über 60 s
void test_kosten() {
  std::printf("-- 5 bungee_kosten\n");
  const Quelle q(80.0, 1);
  for (const bool fein : {false, true}) {
    Karte k(128.0, 0);
    k.rampe(20.0, 135.0, 16.0);
    const int64_t laenge = 60 * 48000;
    Lauf l(optionen(fein, 256), laenge, 256);
    l.d->ansetzen(auftrag(&q, 4096, {0.0, 0.0}, k, 1));
    for (int64_t b = 0; b + 256 <= laenge; b += 256) l.block(b, k, 1);
    const cdj::DehnerKosten& c = l.d->kosten_render();
    std::printf("   %s: %llu Aufrufe mit Arbeit, p50 %.0f us, p99 %.0f us, p99,9 %.0f us, max %.0f us\n", fein ? "fein    " : "Standard",
                static_cast<unsigned long long>(c.n), c.quantil_us(0.5), c.quantil_us(0.99), c.quantil_us(0.999), c.max_ns / 1e3);
    PRUEF(l.unterlauf == 0);
    PRUEF(c.quantil_us(0.999) <= 1000.0);
  }
}

}  // namespace

int main(int argc, char** argv) {
  const std::string was = argc > 1 ? argv[1] : "alle";
  if (was == "alle" || was == "referenz") test_referenz();
  if (was == "alle" || was == "lage") test_lage();
  if (was == "alle" || was == "allokation") test_allokation();
  if (was == "alle" || was == "epochen") test_epochen();
  if (was == "alle" || was == "kosten") test_kosten();
  PRUEF_ENDE();
}
