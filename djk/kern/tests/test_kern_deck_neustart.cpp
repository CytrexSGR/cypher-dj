// Scheibe 31: Decks über einen Kern-Neustart (SCHNITTSTELLEN §6.3 „je Deck Material, Basis, läuft, Anker Master-Beat ↔
// Quell-Beat“, ARCHITEKTUR §7 „blendet Material ein und setzt auf dem Raster fort“). Aufbau wie test_kern_neustart
// (Scheibe 18): Bezug k0 ohne Absturz; k1 mit Zustandsdatei bis zum „kill -9“; k2 setzt nach 40 ms Pause aus dem
// Zustand fort und blendet das Material der Decks vorher wieder ein (decks_nachladen). Deck 1 läuft beim Absturz,
// Deck 2 hat einen wartenden Start (Beat 50,5). Verglichen werden Klick-Einsätze in Treiber-Frames: jeder Einsatz von
// k2 liegt auf einem Einsatz von k0, keiner fehlt. Fehlerfälle am selben Fall: ohne Zustand, und mit Zustand, aber ohne
// Wiedereinblenden des Materials.
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "cypherdj/neustart.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

namespace fs = std::filesystem;
constexpr int N = 256;
constexpr int64_t W_START = 1'000'000;
constexpr int64_t SPB = 22500;
constexpr int64_t ENDE = 60 * SPB;
std::string AB;

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

struct Lauf {
  Ring& ring;
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  std::unique_ptr<cdj::Betrieb> betrieb;
  int64_t W;
  std::vector<int64_t> einsaetze;  // in Treiber-Frames
  int64_t still = 1000;
  std::vector<std::pair<int64_t, int64_t>> gestartet;  // (id, Kern-Sample) der Quittungen 2
  int64_t id = 100;
  Lauf(Ring& r, int64_t w) : ring(r), W(w) {
    kern.reset(new cdj::Kern(128.0, ring.k, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
  }
  void befehl(cdj::Befehl b) {
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "andreas");
    PRUEF(bef->schiebe(b));
  }
  void aufbau() {  // beide Decks laden, Fader auf, Deck 1 startet bei Beat 8, Deck 2 wartet auf Beat 50,5
    for (int d = 1; d <= 2; ++d) {
      cdj::Befehl l{};
      l.art = cdj::Befehl::DECK_LADEN;
      l.deck = d;
      std::snprintf(l.material_id, sizeof l.material_id, "c1c0000000000401");
      l.bpm = 128.0;
      l.fassung = 1;
      befehl(l);
      cdj::Befehl f{};
      f.art = cdj::Befehl::TEIL;
      std::snprintf(f.pfad, sizeof f.pfad, "deck/%d/fader", d);
      f.ab_beat = 4.0;
      f.wert = 0.0f;
      f.politik = 1;
      befehl(f);
    }
    cdj::Befehl s{};
    s.art = cdj::Befehl::DECK_START;
    s.deck = 1;
    s.ab_beat = 8.0;
    s.quell_beat = 0.0;
    befehl(s);
    s.deck = 2;
    s.ab_beat = 50.5;
    befehl(s);
  }
  void zyklus() {
    const uint64_t w0 = cdj_lade(&ring.k->w);
    const uint32_t F = (uint32_t)W;
    const int64_t mono = (int64_t)std::llround((double)W * 1e9 / 48000.0);
    if (betrieb) betrieb->zyklus_anfang(F, mono, *kern);
    kern->zyklus(N, mono);
    if (betrieb) betrieb->zyklus_ende(F, mono, N, *kern);
    lader.einmal(*lr);
    const float* d = cdj_ring_daten_c(ring.k);
    for (int i = 0; i < N; ++i) {
      if (std::fabs(d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4]) > 0.05f) {
        if (still >= 1000) einsaetze.push_back(W + i);
        still = 0;
      } else {
        ++still;
      }
    }
    cdj::Ereignis e;
    while (ere->hole(e))
      if (e.art == cdj::Ereignis::QUITTUNG && e.status == 2) gestartet.push_back({e.id, e.sample});
    W += N;
  }
};

int zaehle(const std::vector<int64_t>& e, int64_t von, int64_t bis) {
  return (int)std::count_if(e.begin(), e.end(), [&](int64_t x) { return x >= von && x < bis; });
}

bool alle_im_bezug(const std::vector<int64_t>& e, const std::set<int64_t>& bezug, int64_t von, int64_t bis) {
  for (int64_t x : e)
    if (x >= von && x < bis && !bezug.count(x)) return false;
  return true;
}

}  // namespace

int main() {
  AB = "/dev/shm/test_kern_deck_neustart_" + std::to_string(getpid());
  fs::create_directories(AB);
  const std::string c = "python3 " + std::string(CYPHERDJ_DJK) + "/kern/tests/deck/klick_fassung.py --ziel " + AB +
                        " --material-id c1c0000000000401 --beats 64 > /dev/null";
  PRUEF(std::system(c.c_str()) == 0);
  const std::string pfad = AB + "/zustand";
  const int64_t absturz = 1'000'000;  // Beat 44,4: Deck 1 läuft seit Beat 8, Deck 2 wartet auf Beat 50,5
  const int64_t pause = 1'920;        // 40 ms: kill -9 plus Neustart

  // Bezug k0
  Ring r0;
  Lauf k0(r0, W_START);
  k0.aufbau();
  while (k0.kern->sample() < ENDE) k0.zyklus();
  const std::set<int64_t> bezug(k0.einsaetze.begin(), k0.einsaetze.end());
  PRUEF(k0.einsaetze.size() > 60);  // Positiv-Kontrolle: beide Decks klicken

  // k1 bis zum Absturz, mit Zustandsdatei
  Ring r1;
  int64_t W_absturz = 0;
  auto fach = std::make_unique<cdj_z_echtzeit>();
  {
    Lauf k1(r1, W_START);
    k1.betrieb.reset(new cdj::Betrieb());
    PRUEF(k1.betrieb->starte(pfad, *k1.kern).datei_ok);
    k1.aufbau();
    while (k1.kern->sample() < absturz) k1.zyklus();
    W_absturz = k1.W;
    cdj::ZustandDatei blick;
    PRUEF(blick.oeffne(pfad) && cdj::z_neuestes(blick.daten()->echtzeit, *fach) >= 0);
  }
  PRUEF(fach->n_decks == 4 && fach->decks[0].status == 2 && fach->decks[1].status == 1);
  PRUEF(!std::strcmp(fach->decks[0].material_id, "c1c0000000000401") && fach->decks[2].material_id[0] == '\0');
  int wartend = 0;
  for (int i = 0; i < fach->n_befehle; ++i)
    if (fach->befehle[i].art == CDJ_Z_ART_DECK_START && fach->befehle[i].stand == 1) ++wartend;
  PRUEF(wartend == 1);  // der Start von Deck 2 (§5.1 /q/stand: wartet)

  const int64_t W_neu = W_absturz + pause;
  const int64_t von = W_neu + 1000, bis = W_START + ENDE - N;

  // k2: Zustand, Material wieder eingeblendet, Anker
  {
    Lauf k2(r1, W_neu);
    k2.betrieb.reset(new cdj::Betrieb());
    const cdj::Wiederaufnahme w = k2.betrieb->starte(pfad, *k2.kern);
    PRUEF(w.fortgesetzt && w.generation == 1);
    PRUEF(k2.kern->decks_nachladen(k2.lader) == 2);
    PRUEF(k2.kern->deck(1).laeuft() && k2.kern->deck(2).geladen() && !k2.kern->deck(2).laeuft());
    while (k2.W < W_START + ENDE) k2.zyklus();
    std::fprintf(stderr, "mit Zustand und Material: %d Einsätze im Fenster, Bezug %d\n", zaehle(k2.einsaetze, von, bis),
                 zaehle(k0.einsaetze, von, bis));
    PRUEF(alle_im_bezug(k2.einsaetze, bezug, von, bis));
    PRUEF(zaehle(k2.einsaetze, von, bis) == zaehle(k0.einsaetze, von, bis) && zaehle(k0.einsaetze, von, bis) > 20);
    // der wartende Start von Deck 2 kommt am selben Kern-Sample wie im Bezug
    int64_t s0 = -1, s2 = -1;
    for (auto& g : k0.gestartet) if (g.second == std::llround(50.5 * SPB)) s0 = g.second;
    for (auto& g : k2.gestartet) if (g.second == std::llround(50.5 * SPB)) s2 = g.second;
    PRUEF(s0 > 0 && s2 == s0);
  }

  // Fehlerfall 1: ohne Zustand (wie Scheibe 08): die Decks sind leer, nach der Rückkehr kein Klick
  {
    Ring r3;
    Lauf k3(r3, W_neu);
    k3.betrieb.reset(new cdj::Betrieb());
    PRUEF(!k3.betrieb->starte(pfad, *k3.kern, true).fortgesetzt);
    while (k3.W < W_START + ENDE) k3.zyklus();
    std::fprintf(stderr, "ohne Zustand (Fehlerfall): %d Einsätze\n", zaehle(k3.einsaetze, von, bis));
    PRUEF(zaehle(k3.einsaetze, von, bis) == 0);
  }
  // Fehlerfall 2: Zustand übernommen, Material nicht wieder eingeblendet: Decks leer, Start von Deck 2 nicht_geladen
  {
    Ring r4;
    Lauf k4(r4, W_neu);
    k4.betrieb.reset(new cdj::Betrieb());
    PRUEF(k4.betrieb->starte(pfad, *k4.kern).fortgesetzt);
    while (k4.W < W_START + ENDE) k4.zyklus();
    std::fprintf(stderr, "ohne Wiedereinblenden (Fehlerfall): %d Einsätze\n", zaehle(k4.einsaetze, von, bis));
    PRUEF(zaehle(k4.einsaetze, von, bis) == 0);
  }
  fs::remove_all(AB);
  PRUEF_ENDE();
}
