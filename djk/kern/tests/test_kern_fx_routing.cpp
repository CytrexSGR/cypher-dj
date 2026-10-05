// Ohr Task 17 (Slice 5, SCHNITTSTELLEN §4.10 /k/fx/routing, §5.12 /e/fx/routing): Beat-FX als Insert (vor dem Fader) oder
// Post Fader (nach dem Fader, Vorgabe), ohne JACK. Rahmen wie test_kern_fx.cpp (Klick-Material, Master und Cue am
// Kern-Sample).
//   Fall 1 (a bis c): Deck 2 mit Klick-Material, Fader zu, PFL an, FX1 Echo ½ Beat Wet 0,5 an deck/2.
//     (a) post_fader: Energie im Cue im Echo-Fenster gleich der ohne FX (Differenz unter 1 dB),
//     (b) insert: dieselbe Messung mindestens 6 dB mehr (das Echo ist im PFL),
//     (c) Hüllkurven-Ring von deck/2 zeigt das Echo-Fenster bei insert, bei post_fader nicht,
//     und zurück auf post_fader: wieder wie (a).
//   Fall 2 (d): Umschalten bei laufendem Deck und offenem Fader (Träger 200 Hz, Echo Wet 1): der größte Sample-Sprung im
//     Umschaltfenster höchstens 1,5 mal der im Fenster gleicher Länge davor, in beide Richtungen. Die Mutation
//     CYPHERDJ_MUTATION_FX_ROUTING_HART (Weg ohne Gleiten tauschen, Leitung sofort leer) macht diesen Fall rot.
//   Fall 3 (e): Quelle cypher bekommt 6 nur_hand, Wert 2 bekommt 6 ausserhalb_bereich; andreas bekommt 1, 2, 3 und das
//     Ereignis. (Die Vorgabe 0 nach /e/neustart meldet das Netz: test_netz_neustart.)
#include <unistd.h>

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/huellen.h"
#include "cypherdj/kern.h"
#include "pruef.h"

static bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

namespace fs = std::filesystem;
static const std::string DJK = CYPHERDJ_DJK;
static std::string AB;
constexpr int N = 256;
constexpr int64_t SPB = 22500;  // Samples je Beat bei 128

static void material(const std::string& skript, const std::string& args) {
  const std::string c = "python3 " + DJK + "/kern/tests/" + skript + " --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

// Ein Kern mit Lader im selben Faden; Master (l, r) und Cue (cl) am Kern-Sample s der Ausgabe (Limiter-Vorhalt
// herausgerechnet, der Cue trägt denselben Vorhalt), dazu der Hüllkurven-Ring.
struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  cdj_huellen_kopf* huellen = nullptr;
  std::vector<float> l, r, cue;
  std::vector<Q> q;
  std::vector<cdj::Ereignis> routing;
  int64_t id = 100;
  bool bewachen = false;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    huellen = (cdj_huellen_kopf*)std::aligned_alloc(64, CDJ_HUELLEN_BYTES);
    cdj_huellen_init(huellen);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    kern->verbinde_huellen(huellen);
    l.reserve(2'000'000);
    r.reserve(2'000'000);
    cue.reserve(2'000'000);
  }
  ~Lauf() { std::free(huellen); }
  cdj::Befehl neu(int art, const char* quelle = "leitstand") {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    return b;
  }
  int64_t sende(const cdj::Befehl& b) {
    PRUEF(bef->schiebe(b));
    return b.id;
  }
  void laden(int deck, const char* mid) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    sende(b);
  }
  void start(int deck, double ab, double quell) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = quell;
    sende(b);
  }
  void regler(const char* pfad, float w, double ab, const char* quelle) {  // §4.3 Setzen mit Schaltrampe
    cdj::Befehl b = neu(cdj::Befehl::TEIL, quelle);
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.ab_beat = ab;
    b.wert = w;
    b.politik = 1;
    sende(b);
  }
  void fx(int einheit, int art, double beats, float wet, float param1, int an) {
    cdj::Befehl b = neu(cdj::Befehl::FX, "andreas");
    b.deck = einheit;
    b.nr = art;
    b.dauer_beats = beats;
    b.wert = wet;
    b.wert_beats = param1;
    b.raster_beats = 0.5;
    b.quell_beat = 0.5;
    b.an = an;
    sende(b);
  }
  void zuweisung(int einheit, const char* kanal, int an) {
    cdj::Befehl b = neu(cdj::Befehl::FX_ZUWEISUNG, "andreas");
    b.deck = einheit;
    std::snprintf(b.pfad, sizeof b.pfad, "%s", kanal);
    b.an = an;
    sende(b);
  }
  int64_t fx_routing(int wert, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::FX_ROUTING, quelle);
    b.an = wert;
    return sende(b);
  }
  void zyklen(int64_t bis_sample) {
    const int vh = kern->mixer().limiter_vorhalt();
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      g_waechter = bewachen;  // nur der Zyklus des Kerns, nicht der Lader und nicht dieses Protokoll
      kern->zyklus(N, n0 * 20833);
      g_waechter = false;
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      if ((int64_t)l.size() < n0 + N) {
        l.resize(n0 + N);
        r.resize(n0 + N);
        cue.resize(n0 + N);
      }
      for (int i = 0; i < N; ++i)
        if (n0 + i - vh >= 0) {
          const uint64_t z = ((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4;
          l[n0 + i - vh] = d[z + 0];
          r[n0 + i - vh] = d[z + 1];
          cue[n0 + i - vh] = d[z + 2];
        }
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.grund});
        if (e.art == cdj::Ereignis::FX_ROUTING) routing.push_back(e);
      }
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  static double energie(const std::vector<float>& x, int64_t von, int64_t bis) {
    double s = 0.0;
    for (int64_t i = von; i < bis && i < (int64_t)x.size(); ++i) s += (double)x[i] * x[i];
    return s;
  }
  // Energie im Cue in den Echo-Fenstern (Klick bei Beat b, Echo ½ Beat später) der Beats von bis (einschließlich)
  double echo_energie(int von, int bis) const {
    double s = 0.0;
    for (int b = von; b <= bis; ++b) s += energie(cue, (int64_t)b * SPB + SPB / 2 - 50, (int64_t)b * SPB + SPB / 2 + 250);
    return s;
  }
  double klick_energie(int von, int bis) const {
    double s = 0.0;
    for (int b = von; b <= bis; ++b) s += energie(cue, (int64_t)b * SPB - 50, (int64_t)b * SPB + 250);
    return s;
  }
  // größter Betrag der Spitze im Ring von deck/2 (Kanal 1) in den Echo- oder Klick-Fenstern der Beats von bis, gelesen
  // über die Datensätze r_von bis r_bis
  float ring_spitze(uint64_t r_von, uint64_t r_bis, int von, int bis, bool echo) const {
    float m = 0.0f;
    for (uint64_t z = r_von; z < r_bis; ++z) {
      const cdj_huellen_satz* s = cdj_huellen_ort(huellen, z, 1);
      for (int b = von; b <= bis; ++b) {
        const int64_t a = (int64_t)b * SPB + (echo ? SPB / 2 : 0);
        if (s->sample >= a && s->sample < a + 300) m = std::max(m, s->spitze);
      }
    }
    return m;
  }
  // größter Sprung |y[i] − y[i−1]| für i in [von, bis); ort = Lage des größten Sprungs
  static float groesster_sprung(const std::vector<float>& y, int64_t von, int64_t bis, int64_t* ort = nullptr) {
    float m = 0.0f;
    for (int64_t i = std::max<int64_t>(von, 1); i < bis && i < (int64_t)y.size(); ++i)
      if (std::fabs(y[i] - y[i - 1]) > m) {
        m = std::fabs(y[i] - y[i - 1]);
        if (ort) *ort = i;
      }
    return m;
  }
};

static double db(double e, double boden) { return 10.0 * std::log10(std::max(e, boden)); }

int main() {
  AB = "/dev/shm/test_kern_fx_routing_" + std::to_string(::getpid());
  fs::create_directories(AB);
  material("deck/klick_fassung.py", "--material-id f0f0000000000002 --beats 64");
  material("hand/traeger_fassung.py", "--material-id f0f0000000000003 --beats 64 --freq 200 --ohne-klick --traeger 0.25");

  // ---------------------------------------------------------------- Fall 1: (a) bis (c), Deck 2 hinter geschlossenem Fader
  {
    Lauf a;
    a.zyklen(10 * N);
    a.laden(2, "f0f0000000000002");
    a.zyklen(20 * N);
    a.regler("deck/2/pfl", 1.0f, 2.0, "andreas");   // PFL ist Andreas' Hand (nur_hand); Fader bleibt −200
    a.start(2, 8.0, 0.0);
    // Phase 0: ohne FX (Beat 8 bis 16)
    const uint64_t r0 = cdj_lade(&a.huellen->w);
    a.zyklen(16 * SPB);
    const uint64_t r1 = cdj_lade(&a.huellen->w);
    const double klick0 = a.klick_energie(12, 15);
    const double e0 = a.echo_energie(12, 15);
    const double boden = klick0 * 1e-6;   // −60 dB unter dem Klick: darunter ist es Stille
    PRUEF(klick0 > 1e-4);                                         // Positiv-Kontrolle: der Cue hört das Deck (PFL an, Fader zu)
    PRUEF(a.energie(a.l, 12 * SPB, 15 * SPB) < 1e-12);            // und der Master nicht (Fader zu)
    const float ring_klick = a.ring_spitze(r0, r1, 12, 15, false);
    PRUEF(ring_klick > 0.01f);                                    // Ring hinter geschlossenem Fader sichtbar

    // Phase 1: FX1 Echo ½ Beat, Wet 0,5, ohne Rückkopplung, an deck/2, Weg Post Fader (Vorgabe)
    a.fx(1, 1, 0.5, 0.5f, 0.0f, 1);
    a.zuweisung(1, "deck/2", 1);
    const uint64_t r2 = cdj_lade(&a.huellen->w);
    a.zyklen(26 * SPB);
    const uint64_t r3 = cdj_lade(&a.huellen->w);
    const double ea = a.echo_energie(20, 23);
    const float ring_post = a.ring_spitze(r2, r3, 20, 23, true);
    std::printf("(a) post_fader: Echo-Fenster %.1f dB, ohne FX %.1f dB, Klick %.1f dB; Ring-Spitze %.5f (Klick %.5f)\n",
                db(ea, boden), db(e0, boden), db(klick0, boden), ring_post, ring_klick);
    PRUEF(std::fabs(db(ea, boden) - db(e0, boden)) < 1.0);        // (a)
    PRUEF(ring_post < 0.01f * ring_klick);                        // (c) bei post_fader nicht im Ring

    // Phase 2: insert ab Beat 26
    const int64_t z2 = a.fx_routing(1);
    const uint64_t r4 = cdj_lade(&a.huellen->w);
    a.zyklen(36 * SPB);
    const uint64_t r5 = cdj_lade(&a.huellen->w);
    const double eb = a.echo_energie(28, 31);
    const float ring_insert = a.ring_spitze(r4, r5, 28, 31, true);
    std::printf("(b) insert: Echo-Fenster %.1f dB (%.1f dB mehr als post_fader); Ring-Spitze %.5f\n", db(eb, boden),
                db(eb, boden) - db(ea, boden), ring_insert);
    PRUEF(a.quittung(z2, 1) && a.quittung(z2, 2) && a.quittung(z2, 3));
    PRUEF(db(eb, boden) - db(ea, boden) >= 6.0);                  // (b)
    PRUEF(ring_insert > 0.3f * ring_klick);                       // (c) bei insert im Ring: Wet 0,5 heißt etwa die halbe Spitze
    PRUEF(!a.routing.empty() && a.routing.back().status == 1);

    // Phase 3: zurück auf post_fader ab Beat 36: wieder wie (a)
    a.fx_routing(0);
    a.zyklen(46 * SPB);
    const double ec = a.echo_energie(40, 43);
    std::printf("zurück post_fader: Echo-Fenster %.1f dB\n", db(ec, boden));
    PRUEF(std::fabs(db(ec, boden) - db(e0, boden)) < 1.0);
    PRUEF(a.routing.size() == 2 && a.routing.back().status == 0);
  }

  // ---------------------------------------------------------------- Fall 2: (d) Umschalten bei laufendem Deck, Fader offen
  {
    Lauf a;
    a.zyklen(10 * N);
    a.laden(1, "f0f0000000000003");
    a.zyklen(20 * N);
    a.regler("deck/1/fader", 0.0f, 2.0, "pruefstand");
    a.start(1, 8.0, 0.0);
    a.zyklen(10 * SPB);
    a.fx(1, 1, 0.5, 1.0f, 0.0f, 1);
    a.zuweisung(1, "deck/1", 1);
    constexpr int64_t FENSTER = 1500;
    float sprung_vor[2], sprung_nach[2];
    int64_t t_wechsel[2];
    for (int richtung = 0; richtung < 2; ++richtung) {           // 0: post → insert bei Beat 16, 1: insert → post bei Beat 24
      a.zyklen((richtung == 0 ? 16 : 24) * SPB);
      a.bewachen = true;
      const int64_t id = a.fx_routing(richtung == 0 ? 1 : 0);
      a.zyklen((richtung == 0 ? 16 : 24) * SPB + 4 * N);
      a.bewachen = false;
      const Q* q2 = a.quittung(id, 2);
      PRUEF(q2 != nullptr);
      t_wechsel[richtung] = q2 ? q2->sample : 0;
      a.zyklen(t_wechsel[richtung] + FENSTER + 2 * N);
      // Der Wechsel wirkt ab dem Blockanfang T (Quittung 2), im Ring um den Limiter-Vorhalt (84) versetzt; das Umschaltfenster
      // beginnt deshalb VORLAUF vor T und das Vergleichsfenster endet davor: der Sprung eines harten Wechsels liegt sicher im ersten.
      constexpr int64_t VORLAUF = 200;
      const int64_t t = t_wechsel[richtung];
      int64_t ort = 0;
      sprung_vor[richtung] = Lauf::groesster_sprung(a.r, t - VORLAUF - FENSTER, t - VORLAUF);
      sprung_nach[richtung] = Lauf::groesster_sprung(a.r, t - VORLAUF, t - VORLAUF + FENSTER, &ort);
      std::printf("(d) %s: Sprung davor %.6f, im Umschaltfenster %.6f (Verhältnis %.3f) bei T%+lld, Wechsel bei Sample %lld\n",
                  richtung == 0 ? "post → insert" : "insert → post", sprung_vor[richtung], sprung_nach[richtung],
                  sprung_nach[richtung] / sprung_vor[richtung], (long long)(ort - t), (long long)t);
      PRUEF(sprung_vor[richtung] > 0.01f);                        // Positiv-Kontrolle: das Signal läuft, das Echo ist da
      PRUEF(sprung_nach[richtung] <= 1.5f * sprung_vor[richtung]);
    }
    PRUEF(g_allokationen == 0);                                   // das Umschalten allokiert nicht
    std::printf("Allokationen im Zyklus: %ld\n", g_allokationen);
  }

  // ---------------------------------------------------------------- Fall 3: (e) wer darf, Bereich, Neustart
  {
    Lauf a;
    a.zyklen(10 * N);
    const int64_t c1 = a.fx_routing(1, "cypher");
    const int64_t c2 = a.fx_routing(2, "andreas");
    const int64_t c3 = a.fx_routing(-1, "leitstand");
    a.zyklen(20 * N);
    const Q* q1 = a.quittung(c1, 6);
    PRUEF(q1 && q1->grund == "nur_hand");                                         // (e)
    PRUEF(!a.quittung(c1, 1) && !a.quittung(c1, 2) && !a.quittung(c1, 3));
    const Q* q2 = a.quittung(c2, 6);
    PRUEF(q2 && q2->grund == "ausserhalb_bereich");
    const Q* q3 = a.quittung(c3, 6);
    PRUEF(q3 && q3->grund == "ausserhalb_bereich");
    PRUEF(a.routing.empty());                                                     // nichts gemeldet, nichts geändert
    PRUEF(a.kern->mixer().fx_routing() == 0);
    const int64_t c4 = a.fx_routing(1, "andreas");                                // Negativ-Kontrolle: Andreas darf
    a.zyklen(30 * N);
    PRUEF(a.quittung(c4, 1) && a.quittung(c4, 2) && a.quittung(c4, 3));
    PRUEF(a.routing.size() == 1 && a.routing[0].status == 1);
    a.fx_routing(1, "andreas");                                                   // derselbe Wert noch einmal: wieder gemeldet
    a.zyklen(40 * N);
    PRUEF(a.routing.size() == 2 && a.routing[1].status == 1);
  }
  fs::remove_all(AB);
  PRUEF_ENDE();
}
