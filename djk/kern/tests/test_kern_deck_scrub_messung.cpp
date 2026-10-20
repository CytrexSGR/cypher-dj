// Hörbares Ziehen, Messung am Master (Beleg 1 bis 3 der Messung 2026-10-17-deck-scrub): ein Kick-Track wird gezogen, hin und her
// über die Bassdrum, dann gehalten und losgelassen; daneben dasselbe Material normal gespielt. Gemessen am Master (Mischer, Trim,
// Limiter), also so, wie es im Betrieb am Ausgang liegt:
//   Knackser    größter Schritt zwischen zwei Samples (D) gegenüber normalem Spielen; Überhöhung an den Zyklusgrenzen (256 Samples)
//               gegenüber den Nachbarsamples (R ≤ 1 heißt: an der Grenze nie größer als daneben)
//   rückwärts   Energie im Rückwärtsstück gegenüber dem normalen Spiel
//   Stillstand  Spitze, solange die Hand hält
// Mit CDJ_SCRUB_WAV=<Ordner> schreibt der Test scrub.wav und normal.wav (float32, stumm, nur Datei) und druckt die Zahlen.
// Fehlerfall: CYPHERDJ_MUTATION_SCRUB_OHNE_GLAETTUNG (die Position springt je Zyklus auf die Hand) muss R sprengen (WILL_FAIL).
#include <unistd.h>

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <new>
#include <string>
#include <vector>

#include "cypherdj/kern.h"
#include "cypherdj/wav.h"
#include "cypherdj/zustand.h"
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

static void klick(const std::string& args) {
  const std::string c = "python3 " + DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
}

struct Q {
  int64_t id;
  int32_t status;
  int64_t sample;
  std::string grund;
};

// Ein Kern mit Lader im selben Faden; master[s] ist Master links am Kern-Sample s.
struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  std::vector<float> master;
  std::vector<Q> q;
  std::vector<cdj::Ereignis> deck, geladen, frist, hotcues;
  int64_t id = 100;
  bool bewachen = false;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
    master.reserve(8'000'000);
  }
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
  int64_t laden(int deck, const char* mid, int stems = 0) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_LADEN);
    b.deck = deck;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid);
    b.bpm = 128.0;
    b.fassung = 1;
    b.mit_stems = stems;
    return sende(b);
  }
  int64_t start(int deck, double ab, double quell, int politik = 0, const char* quelle = "andreas") {
    cdj::Befehl b = neu(cdj::Befehl::DECK_START, quelle);
    b.deck = deck;
    b.ab_beat = ab;
    b.quell_beat = quell;
    b.politik = politik;
    return sende(b);
  }
  int64_t stopp(int deck, double ab) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_STOPP, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = 1;
    return sende(b);
  }
  int64_t fader(int deck, float db, double ab) {  // §4.3 Setzen mit Schaltrampe
    cdj::Befehl b = neu(cdj::Befehl::TEIL, "pruefstand");
    std::snprintf(b.pfad, sizeof b.pfad, "deck/%d/fader", deck);
    b.ab_beat = ab;
    b.wert = db;
    b.politik = 1;
    return sende(b);
  }
  int64_t sprung(int deck, double ab, double delta, int politik, double raster) {
    cdj::Befehl b = neu(cdj::Befehl::DECK_SPRUNG, "andreas");
    b.deck = deck;
    b.ab_beat = ab;
    b.politik = politik;
    b.raster_beats = raster;
    b.wert_beats = delta;
    return sende(b);
  }
  int64_t scrub(int deck, int phase, double delta_beats, const char* quelle = "andreas") {   // Hörbares Ziehen, ohne Quittung
    cdj::Befehl b = neu(cdj::Befehl::DECK_SCRUB, quelle);
    b.deck = deck;
    b.nr = phase;
    b.wert_beats = delta_beats;
    return sende(b);
  }
  void test_hand(const char* pfad, float midi_roh, int64_t sample) {   // /test/hand wie aus dem Netz (kern35.h)
    cdj::Befehl b = neu(cdj::Befehl::HAND, "andreas");
    b.id = 0;
    std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
    b.wert = midi_roh;
    b.sample = sample;
    sende(b);
  }
  const cdj::Ereignis* letzter_zustand(int deck) const {
    for (auto it = this->deck.rbegin(); it != this->deck.rend(); ++it)
      if (it->deck == deck) return &*it;
    return nullptr;
  }
  void zyklen(int64_t bis_sample) {
    while (kern->sample() < bis_sample) {
      const int64_t n0 = kern->sample();
      const uint64_t w0 = cdj_lade(&ring->w);
      g_waechter = bewachen;  // nur der Zyklus des Kerns, nicht der Lader und nicht dieses Protokoll
      kern->zyklus(N, n0 * 20833);
      g_waechter = false;
      lader.einmal(*lr);
      const float* d = cdj_ring_daten_c(ring);
      // Stand 25: der Master liegt um den Vorhalt des Master-Limiters hinter dem Kern-Sample (fester Versatz, bekannt)
      const int vh = kern->mixer().limiter_vorhalt();
      if ((int64_t)master.size() < n0 + N) master.resize(n0 + N);
      for (int i = 0; i < N; ++i)
        if (n0 + i - vh >= 0) master[n0 + i - vh] = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
      cdj::Ereignis e;
      while (ere->hole(e)) {
        if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.grund});
        if (e.art == cdj::Ereignis::DECK) deck.push_back(e);
        if (e.art == cdj::Ereignis::GELADEN) geladen.push_back(e);
        if (e.art == cdj::Ereignis::FRIST) frist.push_back(e);
        if (e.art == cdj::Ereignis::HOTCUE) hotcues.push_back(e);
      }
    }
  }
  const Q* quittung(int64_t i, int32_t st) const {
    for (const auto& x : q)
      if (x.id == i && x.status == st) return &x;
    return nullptr;
  }
  // Einsätze: erstes Sample über der Schwelle nach mindestens 1000 Samples darunter
  std::vector<int64_t> einsaetze(int64_t von, int64_t bis, float schwelle = 0.05f) const {
    std::vector<int64_t> e;
    int64_t still = 1000;
    for (int64_t s = von; s < bis && s < (int64_t)master.size(); ++s) {
      if (std::fabs(master[s]) > schwelle) {
        if (still >= 1000) e.push_back(s);
        still = 0;
      } else {
        ++still;
      }
    }
    return e;
  }
  float spitze(int64_t von, int64_t bis) const {
    float m = 0.0f;
    for (int64_t s = von; s < bis && s < (int64_t)master.size(); ++s) m = std::max(m, std::fabs(master[s]));
    return m;
  }
};




// Hand als Streckenfolge: (Dauer in Zyklen, Beats am Ende) stückweise linear, alle 3 Zyklen (768 Samples) eine Meldung
struct Stueck {
  int zyklen;
  double beats;
};

static std::vector<float> zieh_lauf(Lauf& L, const std::vector<Stueck>& hand, int64_t& s_griff, int64_t& s_los,
                                    std::vector<std::pair<int64_t, int64_t>>& stuecke_s) {
  s_griff = L.kern->sample();
  L.scrub(1, 1, 0.0);
  double von = 0.0;
  int z = 0;
  for (const Stueck& st : hand) {
    const int64_t a = L.kern->sample();
    for (int k = 0; k < st.zyklen; ++k, ++z) {
      if (z % 3 == 0) L.scrub(1, 2, von + (st.beats - von) * (double)k / (double)st.zyklen);
      L.zyklen(L.kern->sample() + N);
    }
    stuecke_s.push_back({a, L.kern->sample()});
    von = st.beats;
  }
  s_los = L.kern->sample();
  L.scrub(1, 0, von);
  L.zyklen(s_los + 48000);
  return L.master;
}

static double max_schritt(const std::vector<float>& m, int64_t a, int64_t b) {
  double d = 0.0;
  for (int64_t i = std::max<int64_t>(a, 1); i < b && i < (int64_t)m.size(); ++i) d = std::max(d, (double)std::fabs(m[i] - m[i - 1]));
  return d;
}

// Überhöhung an den Zyklusgrenzen: Schritt an der Grenze gegen das Doppelte des größten Nachbarschritts (±8 Samples). Der Limiter
// verzögert den Master um vorhalt Samples; gemessen liegt die Naht des Decks am Master bei k·256 + 1 (der Vorhalt zählt 85 statt 84),
// darum gelten beide Lagen k·256 und k·256 + 1, die größere Überhöhung zählt.
static double grenz_ueberhoehung(const std::vector<float>& m, int64_t a, int64_t b, int versatz = 0) {
  double w = 0.0;
  for (int64_t g = (a / N + 1) * N + versatz; g + 12 < b && g + 12 < (int64_t)m.size(); g += N)
    for (int64_t k = g; k <= g + 1; ++k) {
      double nachbar = 1e-4;
      for (int64_t i = k - 8; i < k + 8; ++i)
        if (i != k && i > 0) nachbar = std::max(nachbar, (double)std::fabs(m[i] - m[i - 1]));
      const double r = std::fabs((double)m[k] - (double)m[k - 1]) / (2.0 * nachbar);
      w = std::max(w, r);
    }
  return w;
}

static double effektiv(const std::vector<float>& m, int64_t a, int64_t b) {
  double s = 0.0;
  for (int64_t i = a; i < b && i < (int64_t)m.size(); ++i) s += (double)m[i] * m[i];
  return std::sqrt(s / std::max<int64_t>(1, b - a));
}

int main() {
  AB = "/dev/shm/test_kern_deck_scrub_messung_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id 5c5c000000000002 --beats 64 --kick");
  const char* wav_ordner = std::getenv("CDJ_SCRUB_WAV");

  // Bezug: das Deck spielt normal (Start Beat 8 aus Quell 0), Messfenster Beat 10 bis 22
  double d_normal = 0.0, rms_normal = 0.0;
  std::vector<float> normal;
  {
    Lauf r;
    r.zyklen(10 * N);
    r.laden(1, "5c5c000000000002");
    r.zyklen(20 * N);
    r.fader(1, 0.0f, 2.0);
    r.start(1, 8.0, 0.0);
    r.zyklen(24 * SPB);
    d_normal = max_schritt(r.master, 10 * SPB, 22 * SPB);
    rms_normal = effektiv(r.master, 10 * SPB, 22 * SPB);
    normal.assign(r.master.begin() + 8 * SPB, r.master.begin() + 20 * SPB);
    PRUEF(d_normal > 0.001 && rms_normal > 0.01);
  }

  // Ziehen am stehenden Deck. Start bei Quell 0,9 (Kick bei 1,0 liegt vor der Hand). Hand in Beats seit dem Griff:
  //   vor 0,6 in 90 Zyklen (0,48 s) → durch den Kick bei 1,0 vorwärts; halten 40 Zyklen; zurück −1,2 in 120 Zyklen (rückwärts durch den
  //   Kick, bis 0,3); wieder vor +1,0 in 80 Zyklen; halten 150 Zyklen (0,8 s, Stillstand); Los.
  const std::vector<Stueck> hand = {{90, 0.6}, {40, 0.6}, {120, -0.6}, {80, 0.4}, {150, 0.4}};
  int64_t s_griff = 0, s_los = 0;
  std::vector<std::pair<int64_t, int64_t>> st;
  Lauf a;
  a.zyklen(10 * N);
  a.laden(1, "5c5c000000000002");
  a.zyklen(20 * N);
  a.fader(1, 0.0f, 2.0);
  a.sprung(1, 3.0, 0.9, 1, 0.0);
  a.zyklen(6 * SPB);
  const int vh = a.kern->mixer().limiter_vorhalt();
  const std::vector<float> m = zieh_lauf(a, hand, s_griff, s_los, st);
  const int64_t von = s_griff, bis = s_los + 16000;
  const double d_scrub = max_schritt(m, von, bis);
  const double r_grenze = grenz_ueberhoehung(m, von, bis);
  double r_innen = 0.0;   // Gegenprobe: dieselbe Rechnung an jeder anderen Stelle im Zyklus (Versatz 2 bis 255), größter Wert
  for (int v = 2; v < N; ++v) r_innen = std::max(r_innen, grenz_ueberhoehung(m, von, bis, v));
  const double rms_vor = effektiv(m, st[0].first + 2000, st[0].second);
  const double rms_rueck = effektiv(m, st[2].first + 2400, st[2].second);
  const double still_spitze = [&] {
    double sp = 0.0;
    for (int64_t i = st[4].first + 9600; i < st[4].second && i < (int64_t)m.size(); ++i) sp = std::max(sp, (double)std::fabs(m[i]));
    return sp;
  }();
  const double vor_griff = [&] {
    double sp = 0.0;
    for (int64_t i = s_griff - 4 * N; i < s_griff; ++i) sp = std::max(sp, (double)std::fabs(m[i]));
    return sp;
  }();
  std::printf("MESSUNG vorhalt=%d\n", vh);
  std::printf("MESSUNG normal:  D=%.5f  RMS=%.5f\n", d_normal, rms_normal);
  std::printf("MESSUNG scrub:   D=%.5f  (D/Dnormal=%.2f)  R_grenze=%.3f  (R_innen=%.3f: größter Wert derselben Rechnung an allen anderen 254 Stellen im Zyklus)\n", d_scrub, d_scrub / d_normal, r_grenze, r_innen);
  std::printf("MESSUNG rms vorwaerts=%.5f rueckwaerts=%.5f (zu normal: %.2f / %.2f)  stillstand_spitze=%.3g  vor_griff_spitze=%.3g\n", rms_vor,
              rms_rueck, rms_vor / rms_normal, rms_rueck / rms_normal, still_spitze, vor_griff);
  PRUEF(r_grenze <= 1.0);                       // kein Sprung an den Zyklusgrenzen
  PRUEF(r_grenze <= 1.25 * r_innen);             // und die Naht ist nicht auffälliger als jede andere Stelle im Zyklus
  PRUEF(d_scrub <= 3.0 * d_normal);              // nie schärfer als das Material bei dreifachem Tempo hergibt
  PRUEF(rms_vor > 0.05 * rms_normal);            // vorwärts klingt es
  PRUEF(rms_rueck > 0.05 * rms_normal);          // rückwärts klingt es (Energie ≠ 0)
  PRUEF(still_spitze <= 1e-6);                   // Stillstand ist Stille
  PRUEF(vor_griff <= 1e-6);                      // Negativ-Kontrolle: vor dem Griff Stille
  if (wav_ordner) {
    fs::create_directories(wav_ordner);
    std::vector<float> w(m.begin() + std::max<int64_t>(0, s_griff - 2400), m.begin() + std::min<int64_t>(m.size(), s_los + 48000));
    std::string fehler;
    PRUEF(cdj::schreibe_wav_f32(std::string(wav_ordner) + "/scrub.wav", w, w, fehler));
    PRUEF(cdj::schreibe_wav_f32(std::string(wav_ordner) + "/normal.wav", normal, normal, fehler));
  }

  fs::remove_all(AB);
  PRUEF_ENDE();
}
