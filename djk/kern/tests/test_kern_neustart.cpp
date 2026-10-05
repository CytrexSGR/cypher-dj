// Scheibe 18: der ganze Neustartpfad ohne JACK (Kern, Betrieb, Zustandsdatei, Anker). Ein Bezugskern k0 läuft ohne
// Absturz; derselbe Ablauf läuft ein zweites Mal, wird nach Zyklus c "abgeschossen" (Objekte weg, Ring und
// Zustandsdatei bleiben), und ein neuer Kern setzt nach einer Pause von D Treiber-Frames fort. Verglichen wird in
// Treiber-Frames (Wanduhr des Graphen): jeder Klick-Einsatz des neuen Kerns muss auf einem Einsatz von k0 liegen, kein
// Einsatz darf fehlen, die Rampe endet am selben Sample, /e/neustart ist das erste Ereignis. Fehlerfälle am selben Fall:
// neuer Kern ohne Zustand (wie Scheibe 08, Klick danach neu eingeschaltet) und neuer Kern mit Zustand, aber ohne Anker.
// Zwei Lagen: Absturz in der laufenden Rampe (Beat 74, wie notbahn_rampe) und vor ihrem Start (Beat 40).
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "cypherdj/neustart.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

constexpr int N = 256;                    // Quantum
constexpr int64_t W_START = 1'000'000;    // Treiber-Frame des ersten Zyklus
constexpr int64_t ENDE = 4'000'000;       // Samples je Lauf (Rampe 64 -> 96 endet bei Sample 2 148 923)

struct Ring {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* k = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  Ring() {
    k->version = CDJ_RING_VERSION;
    k->rate = CDJ_RING_RATE;
    k->kanaele = CDJ_RING_KANAELE;
    k->cap = CDJ_RING_CAP;
    std::memcpy(k->magic, "CDJB", 4);
  }
};

struct Quittung {
  int64_t id;
  int32_t status;
  int64_t sample;
  double beat;
};

// Ein Kern samt Befehls- und Ereignisring, getaktet in Treiber-Frames W. Sammelt Klick-Einsätze (in W) und Ereignisse.
struct Lauf {
  Ring& ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern;
  std::unique_ptr<cdj::Betrieb> betrieb;
  int64_t W;
  std::vector<int64_t>* einsaetze;  // geteilt über Absturz und Neustart
  float* vorher;
  std::vector<Quittung> q;
  std::vector<cdj::Ereignis> neustart;
  int32_t uhr_generation = -1;
  int erstes_ereignis = 0;

  Lauf(Ring& r, int64_t w, std::vector<int64_t>* e, float* v) : ring(r), W(w), einsaetze(e), vorher(v) {
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->setze_pruefmodus(true);  // Scheibe 25, B7: Prüfklick überlebt den Neustart nur im Prüfmodus
  }
  void befehl(int art, int64_t id, int an = 1, double ab = 0, double ziel = 0, double dauer = 0) {
    cdj::Befehl b{};
    b.art = art;
    b.id = id;
    b.an = an;
    std::snprintf(b.quelle, sizeof b.quelle, "pruefstand");
    b.ab_beat = ab;
    b.ziel_bpm = ziel;
    b.dauer_beats = dauer;
    PRUEF(bef->schiebe(b));
  }
  void zyklus() {
    const uint64_t w0 = cdj_lade(&ring.k->w);
    const uint32_t F = (uint32_t)W;
    const int64_t mono = (int64_t)std::llround((double)W * 1e9 / 48000.0);
    if (betrieb) betrieb->zyklus_anfang(F, mono, *kern);
    kern->zyklus(N, mono);
    if (betrieb) betrieb->zyklus_ende(F, mono, N, *kern);
    const float* d = cdj_ring_daten_c(ring.k);
    for (int i = 0; i < N; ++i) {
      const float x = d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];
      if (x != 0.0f && *vorher == 0.0f) einsaetze->push_back(W + i);
      *vorher = x;
    }
    cdj::Ereignis e;
    while (ere->hole(e)) {
      if (e.art == cdj::Ereignis::QUITTUNG) q.push_back({e.id, e.status, e.sample, e.beat});
      if (e.art == cdj::Ereignis::NEUSTART) {
        neustart.push_back(e);
        if (erstes_ereignis == 0) erstes_ereignis = cdj::Ereignis::NEUSTART;
      }
      if (e.art == cdj::Ereignis::UHR) {
        uhr_generation = e.generation;
        if (erstes_ereignis == 0) erstes_ereignis = cdj::Ereignis::UHR;
      }
    }
    W += N;
  }
};

const Quittung* finde(const std::vector<Quittung>& q, int64_t id, int32_t status) {
  for (const auto& x : q)
    if (x.id == id && x.status == status) return &x;
  return nullptr;
}

int anzahl(const std::vector<Quittung>& q, int64_t id, int32_t status) {
  int n = 0;
  for (const auto& x : q) n += (x.id == id && x.status == status) ? 1 : 0;
  return n;
}

// Größte Entfernung eines Einsatzes in [von, bis) zum nächsten Einsatz des Bezugs, in Frames.
int64_t groesster_abstand(const std::vector<int64_t>& e, const std::set<int64_t>& bezug, int64_t von, int64_t bis) {
  int64_t m = 0;
  for (int64_t x : e) {
    if (x < von || x >= bis) continue;
    auto it = bezug.lower_bound(x);
    int64_t a = INT64_MAX;
    if (it != bezug.end()) a = std::min(a, *it - x);
    if (it != bezug.begin()) a = std::min(a, x - *std::prev(it));
    m = std::max(m, a);
  }
  return m;
}

int zaehle(const std::vector<int64_t>& e, int64_t von, int64_t bis) {
  return (int)std::count_if(e.begin(), e.end(), [&](int64_t x) { return x >= von && x < bis; });
}

void lage(const char* name, int64_t absturz_sample, int64_t pause, const std::string& pfad) {
  std::fprintf(stderr, "== Lage %s: Absturz bei Sample %lld, Pause %lld Frames\n", name, (long long)absturz_sample,
               (long long)pause);
  // Bezug k0: Klick an, Rampe 128 -> 132 ab Beat 64 über 32 Beats (notbahn_rampe), kein Absturz
  Ring r0;
  std::vector<int64_t> e0;
  float v0 = 0.0f;
  Lauf k0(r0, W_START, &e0, &v0);
  k0.befehl(cdj::Befehl::KLICK, 2);
  k0.befehl(cdj::Befehl::TEMPO_RAMPE, 3, 1, 64.0, 132.0, 32.0);
  while (k0.kern->sample() < ENDE) k0.zyklus();
  const std::set<int64_t> bezug(e0.begin(), e0.end());
  const Quittung* q0_start = finde(k0.q, 3, 2);
  const Quittung* q0_ende = finde(k0.q, 3, 3);
  PRUEF(q0_start && q0_start->sample == 1'440'000);  // §19.3 notbahn_rampe: Rampe beginnt bei Beat 64
  PRUEF(q0_ende != nullptr);
  PRUEF(e0.size() > 150);  // Positiv-Kontrolle: der Bezug klickt (4 000 000 Samples, 128 bis 132 BPM: 180 Schläge)
  std::fprintf(stderr, "   Bezug: %zu Einsätze, Rampe gestartet bei %lld, fertig bei %lld\n", e0.size(),
               (long long)(q0_start ? q0_start->sample : -1), (long long)(q0_ende ? q0_ende->sample : -1));

  // k1 läuft bis zum Absturz mit Zustandsdatei; Ring und Datei überleben ihn
  unlink(pfad.c_str());
  Ring r1;
  std::vector<int64_t> e1;
  float v1 = 0.0f;
  int64_t W_absturz = 0;
  cdj_z_echtzeit* fach = nullptr;
  auto fachkopie = std::make_unique<cdj_z_echtzeit>();
  {
    Lauf k1(r1, W_START, &e1, &v1);
    k1.betrieb.reset(new cdj::Betrieb());
    const cdj::Wiederaufnahme w = k1.betrieb->starte(pfad, *k1.kern);
    PRUEF(w.datei_ok && !w.fortgesetzt && w.generation == 0);
    k1.befehl(cdj::Befehl::KLICK, 2);
    k1.befehl(cdj::Befehl::TEMPO_RAMPE, 3, 1, 64.0, 132.0, 32.0);
    while (k1.kern->sample() < absturz_sample) k1.zyklus();
    W_absturz = k1.W;
    cdj::ZustandDatei blick;
    PRUEF(blick.oeffne(pfad) && !blick.neu());
    PRUEF(cdj::z_neuestes(blick.daten()->echtzeit, *fachkopie) >= 0);
    fach = fachkopie.get();
  }  // "kill -9": Kern, Betrieb und Ringe des Prozesses sind weg
  PRUEF(fach->n_befehle == 2);  // Rampe und Prüfklick
  PRUEF(fach->befehle[0].art == CDJ_Z_ART_RAMPE && fach->befehle[1].art == CDJ_Z_ART_KLICK);
  const bool laeuft = absturz_sample > 1'440'000;
  PRUEF(fach->befehle[0].stand == (laeuft ? 2 : 1));
  PRUEF(fach->befehle[1].stand == 2);

  const int64_t W_neu = W_absturz + pause;
  const int64_t pruef_von = W_neu + 96;       // ein Klick, der beim Absturz klang, ist abgeschnitten
  const int64_t pruef_bis = W_START + ENDE - N;

  // k2: neuer Kern mit Zustand und Anker (Scheibe 18)
  {
    std::vector<int64_t> e2;
    float v2 = 0.0f;
    Lauf k2(r1, W_neu, &e2, &v2);
    k2.betrieb.reset(new cdj::Betrieb());
    const cdj::Wiederaufnahme w = k2.betrieb->starte(pfad, *k2.kern);
    PRUEF(w.fortgesetzt && w.generation == 1 && w.n_befehle == 2);
    const uint64_t w_vorher = cdj_lade(&r1.k->w);
    k2.zyklus();
    PRUEF(cdj_lade(&r1.k->w) == w_vorher + N);  // §6.1: w monoton über den Neustart, kein Sprung zurück
    while (k2.W < W_START + ENDE) k2.zyklus();
    PRUEF(k2.erstes_ereignis == cdj::Ereignis::NEUSTART);  // §4.1: erste Nachricht der neuen Generation
    PRUEF(k2.neustart.size() == 1 && k2.neustart[0].generation == 1);
    PRUEF(k2.neustart[0].sample == W_neu - W_START);        // ohne Lücken: Kern-Sample = Treiber-Frames seit Start
    PRUEF(k2.uhr_generation == 1);
    PRUEF(k2.betrieb->fortsetzung().quelle == cdj::AnkerQuelle::frames);
    const int64_t abstand = groesster_abstand(e2, bezug, W_neu, pruef_bis);
    std::fprintf(stderr, "   mit Zustand: %zu Einsätze, größter Abstand zum Bezug %lld Frames\n", e2.size(),
                 (long long)abstand);
    PRUEF(abstand == 0);
    PRUEF(zaehle(e2, pruef_von, pruef_bis) == zaehle(e0, pruef_von, pruef_bis));  // keiner fehlt
    PRUEF(zaehle(e2, pruef_von, pruef_bis) > 100);
    const Quittung* q2_ende = finde(k2.q, 3, 3);
    PRUEF(q2_ende && q2_ende->sample == q0_ende->sample);  // Rampe endet am unveränderten Ende-Beat
    PRUEF_NAH(q2_ende ? q2_ende->beat : 0.0, q0_ende->beat, 1e-9);
    if (laeuft) {
      PRUEF(anzahl(k2.q, 3, 2) == 0);  // schon gestartet: kein zweites "gestartet"
    } else {
      const Quittung* q2_start = finde(k2.q, 3, 2);
      PRUEF(q2_start && q2_start->sample == q0_start->sample);
    }
    for (double b = 60.0; b <= 100.0; b += 0.25)
      PRUEF_NAH(k2.kern->karte().sample_at(b), k0.kern->karte().sample_at(b), 1e-6);
  }

  // Fehlerfall 1: neuer Kern ohne Zustand (wie Scheibe 08); Klick danach neu eingeschaltet wie im Prüf-Abonnenten
  {
    Ring r3;
    std::vector<int64_t> e3;
    float v3 = 0.0f;
    Lauf k3(r3, W_neu, &e3, &v3);
    k3.betrieb.reset(new cdj::Betrieb());
    const cdj::Wiederaufnahme w = k3.betrieb->starte(pfad, *k3.kern, true);
    PRUEF(!w.fortgesetzt && w.generation == 0);
    k3.befehl(cdj::Befehl::KLICK, 20);
    while (k3.W < W_START + ENDE) k3.zyklus();
    const int64_t abstand = groesster_abstand(e3, bezug, W_neu, pruef_bis);
    std::fprintf(stderr, "   ohne Zustand (Fehlerfall): %zu Einsätze, größter Abstand zum Bezug %lld Frames\n",
                 e3.size(), (long long)abstand);
    PRUEF(abstand > 1);
    PRUEF(k3.neustart.empty());
    PRUEF(finde(k3.q, 3, 3) == nullptr);  // die Rampe ist verloren
  }

  // Fehlerfall 2: Zustand übernommen, aber ohne Anker (kein fortsetzen: der Kern beginnt bei Sample 0)
  {
    std::vector<int64_t> e4;
    float v4 = 0.0f;
    Ring r4;
    Lauf k4(r4, W_neu, &e4, &v4);
    PRUEF(k4.kern->wiederherstellen(*fach));
    while (k4.W < W_START + ENDE) k4.zyklus();
    const int64_t abstand = groesster_abstand(e4, bezug, W_neu, pruef_bis);
    std::fprintf(stderr, "   Zustand ohne Anker (Fehlerfall): %zu Einsätze, größter Abstand zum Bezug %lld Frames\n",
                 e4.size(), (long long)abstand);
    PRUEF(abstand > 1);
  }
}

}  // namespace

int main() {
  const std::string ordner = "/dev/shm/cypherdj-test18k-" + std::to_string(getpid());
  const std::string pfad = ordner + "/zustand";
  lage("in der Rampe (Beat 74)", 1'663'895, 9'728, pfad);  // 203 ms Pause: Watchdog-Tod plus Neustart
  lage("vor der Rampe (Beat 40)", 900'000, 1'920, pfad);   // 40 ms Pause: kill -9 plus Neustart
  unlink(pfad.c_str());
  unlink((ordner + "/neustarts").c_str());  // legt Betrieb::starte neben die Zustandsdatei (F20)
  rmdir(ordner.c_str());
  PRUEF_ENDE();
}
