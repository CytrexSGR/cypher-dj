// Scheibe 31: Decks im Kern ohne JACK (SCHNITTSTELLEN §4.4, §5.5, §5.9, §13.1, §16.1, §16.2). Der Lader läuft im
// selben Faden nach jedem Zyklus (lader.einmal), Material aus tests/deck/klick_fassung.py in einem eigenen
// Arbeitsbestand. Gemessen wird am Audio-Ring (Master links): jeder Klick der Fassung liegt auf dem Sample, das §13.1
// und §4.4 vorgeben, ohne Drift; dazu Quittungen, Gründe, /zustand/deck, /e/geladen, /e/frist, Stems gegen die
// Offline-Summe und keine Allokation im Zyklus. Fehlerfall: derselbe Test gegen die Mutation „Start am Blockanfang“.
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
  std::vector<cdj::Ereignis> deck, geladen, frist;
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

int main() {
  AB = "/dev/shm/test_kern_deck_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id c1c0000000000301 --beats 64 --erster-schlag-frame 1234");            // Klick, −16 LUFS
  klick("--material-id c1c0000000000302 --beats 64 --lufs -9.4");                          // Trim −6,6 dB
  klick("--material-id c1c0000000000303 --beats 8 --nan-bei 0");
  klick("--material-id c1c0000000000304 --beats 8 --falsche-pruefsumme");
  klick("--material-id c1c0000000000305 --beats 160");                                     // für die Frist
  klick("--material-id c1c0000000000306 --beats 16 --stems --summe-als c1c0000000000307"); // Stems, Offline-Summe

  // 1) Laden: Quittungen 1, 2, 3 und /e/geladen; Fader −200, Trim aus der Lautheit (§1.5)
  Lauf a;
  a.zyklen(10 * N);
  const int64_t l1 = a.laden(1, "c1c0000000000301");
  const int64_t l2 = a.laden(2, "c1c0000000000302");
  a.zyklen(20 * N);
  PRUEF(a.quittung(l1, 1) && a.quittung(l1, 2) && a.quittung(l1, 3) && a.quittung(l2, 3));
  PRUEF(a.geladen.size() == 2 && a.geladen[0].deck == 1 && !std::strcmp(a.geladen[0].material_id, "c1c0000000000301"));
  PRUEF(a.kern->deck(1).geladen() && !a.kern->deck(1).laeuft());
  const auto& tab = a.kern->stellwerk().tabelle();
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("deck/2/trim")), -6.6, 1e-5);
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("deck/1/trim")), 0.0, 0.0);
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("deck/1/fader")), -200.0, 0.0);

  // 2) Fader auf 0 dB ab Beat 4 (Deck steht): Negativ-Kontrolle geladen, nicht gestartet -> Master ≤ −120 dB
  a.fader(1, 0.0f, 4.0);
  const int64_t s1 = a.start(1, 8.0, 2.0);  // bei Beat 8 (Sample 180 000) erklingt Quell-Beat 2
  a.zyklen(8 * SPB - 2 * N);
  PRUEF(a.quittung(s1, 1) && !a.quittung(s1, 2));
  PRUEF(a.spitze(5 * SPB, 8 * SPB) <= 1e-6f);
  // 3) Start am Sample (§4.4): jeder Klick auf dem Raster §13.1, fester Versatz 0 gegen den Kern, keine Drift
  a.bewachen = true;
  a.zyklen(40 * SPB);
  a.bewachen = false;
  const Q* st = a.quittung(s1, 2);
  PRUEF(st && st->sample == 8 * SPB);
  std::vector<int64_t> e = a.einsaetze(8 * SPB - 100, 40 * SPB);
  PRUEF(e.size() == 32);
  bool raster = e.size() == 32;
  for (size_t k = 0; k < e.size() && raster; ++k) raster = e[k] == 8 * SPB + (int64_t)k * SPB;
  PRUEF(raster);
  PRUEF(a.spitze(10 * SPB, 10 * SPB + 96) > 1.5f * a.spitze(9 * SPB, 9 * SPB + 96));  // Quell-Beat 4: Takt-Eins lauter
  PRUEF(g_allokationen == 0);
  // /zustand/deck 50-mal je Sekunde, quell_beat am Blockanfang genau auf der Geraden
  int n_zustand = 0;
  bool gerade = true;
  for (const auto& z : a.deck)
    if (z.deck == 1 && z.sample >= 9 * SPB && z.sample < 9 * SPB + 48000) {
      ++n_zustand;
      gerade = gerade && z.status == 2 && std::fabs(z.quell_beat - (2.0 + (double)(z.sample - 8 * SPB) / SPB)) < 1e-9 &&
               z.faktor == 1.0 && z.vorlauf_ms > 10.6f && z.vorlauf_ms < 10.7f;
    }
  PRUEF(n_zustand == 50 && gerade);

  // 4) Tempo-Rampe bei laufendem Deck: kein_stretcher; neue Zeitachse: deck_laeuft
  cdj::Befehl r = a.neu(cdj::Befehl::TEMPO_RAMPE);
  r.ab_beat = 48.0;
  r.ziel_bpm = 130.0;
  r.dauer_beats = 8.0;
  const int64_t rid = a.sende(r);
  cdj::Befehl sn = a.neu(cdj::Befehl::SET_NEU);
  sn.bpm = 128.0;
  const int64_t snid = a.sende(sn);
  a.zyklen(40 * SPB + 4 * N);
  PRUEF(a.quittung(rid, 6) && a.quittung(rid, 6)->grund == "kein_stretcher");
  PRUEF(a.quittung(snid, 6) && a.quittung(snid, 6)->grund == "deck_laeuft");

  // 5) Stopp bei Beat 44: 10-ms-Rampe, fertig 480 Samples später; danach still, Deck geladen
  const int64_t sp = a.stopp(1, 44.0);
  a.zyklen(46 * SPB);
  PRUEF(a.quittung(sp, 2) && a.quittung(sp, 2)->sample == 44 * SPB);
  PRUEF(a.quittung(sp, 3) && a.quittung(sp, 3)->sample == 44 * SPB + 480);
  PRUEF(!a.kern->deck(1).laeuft() && a.kern->deck(1).geladen());
  PRUEF(a.einsaetze(44 * SPB + 1000, 46 * SPB).empty());

  // 6) zu spät: Politik 0 verworfen (4), Politik 1 phasentreu am Blockanfang (5); leeres Deck: nicht_geladen
  const int64_t z0 = a.start(1, 40.0, 0.0, 0);
  const int64_t z1 = a.start(1, 46.5, 0.0, 1);  // rechtzeitig: 1 und 2 am Sample von Beat 46,5
  a.zyklen(47 * SPB);
  const int64_t z1b = a.start(1, 46.9, 0.0, 1);  // eingereiht bei Beat 47: ab_beat vorbei, Politik 1
  const int64_t leer = a.start(3, 60.0, 0.0);
  a.zyklen(52 * SPB);
  PRUEF(a.quittung(z0, 4) && a.quittung(z0, 4)->grund == "zu_spaet" && !a.quittung(z0, 1));
  PRUEF(a.quittung(z1, 1) && a.quittung(z1, 2) && a.quittung(z1, 2)->sample == std::llround(46.5 * SPB));
  const Q* spaet = a.quittung(z1b, 5);
  PRUEF(spaet && !a.quittung(z1b, 1) && spaet->sample > std::llround(46.9 * SPB));
  // phasentreu (Festlegung F5): die Klicks nach dem späten Start liegen auf dem Raster, als wäre bei Beat 46,9
  // Quell-Beat 0 (Frame 1234, der erste Klick) erklungen
  std::vector<int64_t> e2 = a.einsaetze(48 * SPB, 52 * SPB);
  bool phase = e2.size() == 4;
  for (int64_t x : e2) phase = phase && (x - std::llround(46.9 * SPB)) % SPB == 0;
  PRUEF(phase);
  PRUEF(a.quittung(leer, 6) && a.quittung(leer, 6)->grund == "nicht_geladen");

  // 7) Fehlerfälle beim Laden: material_fehlt, pruefung (NaN, Prüfsumme, mit_stems), deck_hoerbar (Deck 1 offen)
  const int64_t f1 = a.laden(3, "f0000000000000ff");
  const int64_t f2 = a.laden(3, "c1c0000000000303");
  const int64_t f3 = a.laden(3, "c1c0000000000304");
  const int64_t f4 = a.laden(3, "c1c0000000000301", 1);
  const int64_t f5 = a.laden(1, "c1c0000000000302");
  a.zyklen(54 * SPB);
  PRUEF(a.quittung(f1, 1) && a.quittung(f1, 6) && a.quittung(f1, 6)->grund == "material_fehlt");
  PRUEF(a.quittung(f2, 6) && a.quittung(f2, 6)->grund == "pruefung");
  PRUEF(a.quittung(f3, 6) && a.quittung(f3, 6)->grund == "pruefung");
  PRUEF(a.quittung(f4, 6) && a.quittung(f4, 6)->grund == "pruefung");
  PRUEF(a.quittung(f5, 6) && a.quittung(f5, 6)->grund == "deck_hoerbar" && !a.quittung(f5, 1));
  PRUEF(!a.kern->deck(3).geladen());

  // 8) Entladen: 1, 2, 3; Speicher zurück (Freigabe nach Rückgabe)
  const int64_t vorher = a.lader.gesperrt();
  const int64_t en = a.sende([&] { cdj::Befehl b = a.neu(cdj::Befehl::DECK_ENTLADEN); b.deck = 2; return b; }());
  a.zyklen(55 * SPB);
  PRUEF(a.quittung(en, 1) && a.quittung(en, 2) && a.quittung(en, 3) && !a.kern->deck(2).geladen());
  PRUEF(a.lader.gesperrt() < vorher);
  bool leer_gemeldet = false;
  for (const auto& z : a.deck) leer_gemeldet = leer_gemeldet || (z.deck == 2 && z.status == 0);
  PRUEF(leer_gemeldet);

  // 8b) 2026-09-27 (Andreas am Digital-Out: „neuen track laden geht nicht über load a“): ein STEHENDES Deck lädt auch
  //     bei offenem Fader (gesperrt nur laufend und offen, §4.4); der Fader geht beim Laden auf −200. Deck 1 läuft hier
  //     noch mit offenem Fader (Fall 7 hat genau das abgelehnt), also erst stoppen.
  const int64_t st8 = a.stopp(1, 56.0);
  a.zyklen(57 * SPB);
  PRUEF(a.quittung(st8, 1) && !a.kern->deck(1).laeuft());
  PRUEF(a.kern->stellwerk().wert(tab.suche("deck/1/fader")) > -26.0);  // Fader weiter offen
  const int64_t f6 = a.laden(1, "c1c0000000000302");
  a.zyklen(59 * SPB);
  PRUEF(a.quittung(f6, 3) && !a.quittung(f6, 6));
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("deck/1/fader")), -200.0, 0.0);

  // 9) /e/frist bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks; Negativ-Kontrolle: Fader zu, keine
  Lauf f;
  f.laden(1, "c1c0000000000305");
  f.laden(2, "c1c0000000000305");
  f.fader(1, 0.0f, 2.0);
  f.start(1, 4.0, 0.0);  // Material 161 Beats: Ende bei Beat 165
  f.start(2, 4.0, 0.0);  // Deck 2 läuft mit Fader −200: nicht hörbar
  f.zyklen(170 * SPB);
  const double ende_beat = 4.0 + 161.0;
  bool frist_ok = f.frist.size() == 4;
  const double soll[4] = {128.0, 64.0, 32.0, 16.0};
  for (size_t i = 0; i < f.frist.size() && frist_ok; ++i)
    frist_ok = f.frist[i].deck == 1 && f.frist[i].beats_bis_ende == soll[i] &&
               f.frist[i].sample == std::llround((ende_beat - soll[i]) * SPB);
  PRUEF(frist_ok);

  // 10) Stems: vier Stems (mit_stems 1) und die Offline-Summe als Basis ergeben am Ring denselben Master, bitgleich;
  //     Positiv-Kontrolle: vocals stumm unterscheidet sich
  auto stems_lauf = [](const char* mid, int stems, bool vocals_stumm) {
    auto l = std::make_unique<Lauf>();
    l->laden(1, mid, stems);
    l->zyklen(4 * N);  // stem/* erst nach dem Tausch: vorher hat das Deck keine Stems (keine_stems, §1.5)
    l->fader(1, 0.0f, 2.0);
    if (vocals_stumm) {
      cdj::Befehl b = l->neu(cdj::Befehl::TEIL, "pruefstand");
      std::snprintf(b.pfad, sizeof b.pfad, "deck/1/stem/vocals");
      b.ab_beat = 2.0;
      b.wert = -200.0f;
      b.politik = 1;
      l->sende(b);
    }
    l->start(1, 4.0, 0.0);
    l->zyklen(20 * SPB);
    return l;
  };
  auto st1 = stems_lauf("c1c0000000000306", 1, false);
  auto st2 = stems_lauf("c1c0000000000307", 0, false);
  auto st3 = stems_lauf("c1c0000000000306", 1, true);
  float diff = 0.0f, diff_v = 0.0f, pegel = 0.0f;
  for (int64_t s = 4 * SPB; s < 20 * SPB; ++s) {
    diff = std::max(diff, std::fabs(st1->master[s] - st2->master[s]));
    diff_v = std::max(diff_v, std::fabs(st1->master[s] - st3->master[s]));
    pegel = std::max(pegel, std::fabs(st1->master[s]));
  }
  std::printf("Stems: Spitze %.4f, Differenz zur Offline-Summe %.3g, mit vocals stumm %.4f\n", pegel, diff, diff_v);
  PRUEF(pegel > 0.1f && diff == 0.0f && diff_v > 0.01f);
  // stem/* an einem Deck ohne Stems: keine_stems (§1.5)
  cdj::Befehl ks = st2->neu(cdj::Befehl::TEIL, "pruefstand");
  std::snprintf(ks.pfad, sizeof ks.pfad, "deck/1/stem/bass");
  ks.ab_beat = 21.0;
  ks.wert = -10.0f;
  ks.politik = 1;
  const int64_t ksid = st2->sende(ks);
  st2->zyklen(22 * SPB);
  PRUEF(st2->quittung(ksid, 6) && st2->quittung(ksid, 6)->grund == "keine_stems");

  fs::remove_all(AB);
  PRUEF_ENDE();
}
