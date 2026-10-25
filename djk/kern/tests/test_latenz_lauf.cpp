// I08 Task 14 (Nachzug R1, R2): Ablauf des Messclients gegen ein Quellenmodell (Schleife mit Verzögerung L Samples, dazu Dauerpegel, Metronom, Stöße).
// Prüft: der Versatz innerhalb des Blocks (L kein Vielfaches des Quantums), die Ruheprüfung vor dem Impuls samt ihrem 100-ms-Fenster und ihrer Pause,
// die Leerversuche und die Streuungsgrenze (R2: kein Wert, wenn der Treffer nicht nachweislich vom Impuls kommt), die Impulsabstände, Gesamtfrist und Ausfall.
#include <atomic>
#include <chrono>
#include <cmath>
#include <functional>
#include <memory>
#include <thread>
#include <vector>

#include "../pruef/latenz_lauf.h"
#include "../pruef/latenz_stat.h"
#include "pruef.h"

namespace {
constexpr unsigned NF = 256, RATE = 48000;
constexpr int KLICK = 240;                           // 5 ms bei 48 kHz

// Die Quelle hinter dem Eingang: Dauerpegel, eine Schleife (Echo L Samples nach jedem Impuls, bei `wackel` > 0 jeder zweite um `wackel` später)
// und beliebige Störung von außen. Alles zusammen wird addiert.
struct Modell {
  int L = -1;                                        // < 0: keine Schleife
  int wackel = 0;
  float pegel = 0.0f;
  std::function<float(long)> stoer;
};

struct Lauf {
  std::vector<int> ergebnis;
  std::vector<long> impulse;                         // Frame jedes hinausgegangenen Impulses
  long bloecke = 0;
};

// Fährt den Ablauf, bis alle Versuche durch sind. L >= NF (das Echo kommt frühestens im nächsten Block, wie bei JACK).
Lauf fahre(LatenzLauf& l, const Modell& m) {
  Lauf r;
  std::vector<long> offen;                           // Frames, an denen ein Echo eintrifft
  for (long block = 0; block < 200000 && l.n.load() < l.versuche; ++block, ++r.bloecke) {
    const long f0 = block * NF;
    std::vector<float> ein(NF, m.pegel), aus(NF, 0.0f);
    for (unsigned i = 0; i < NF; ++i)
      if (m.stoer) ein[i] += m.stoer(f0 + i);
    for (std::size_t k = 0; k < offen.size();) {
      if (offen[k] >= f0 && offen[k] < f0 + static_cast<long>(NF)) { ein[offen[k] - f0] += 1.0f; offen.erase(offen.begin() + k); }
      else ++k;
    }
    l.block(ein.data(), aus.data(), NF, RATE);
    for (unsigned i = 0; i < NF; ++i)
      if (aus[i] != 0.0f) {
        if (m.L >= 0) offen.push_back(f0 + i + m.L + m.wackel * static_cast<long>(r.impulse.size() % 2));
        r.impulse.push_back(f0 + i);
      }
  }
  r.ergebnis.assign(l.ergebnis, l.ergebnis + l.n.load());
  return r;
}

// Der Client fährt ziel * 3 Versuche und verlangt ziel gültige Treffer.
LatenzErgebnis messe(const Modell& m, int ziel = 20) {
  LatenzLauf l;
  l.versuche = ziel * 3;
  fahre(l, m);
  return latenz_urteil(l, ziel, RATE);
}

Modell metronom(int bpm) { Modell m; const long p = static_cast<long>(RATE) * 60 / bpm; m.stoer = [p](long f) { return f % p < KLICK ? 0.5f : 0.0f; }; return m; }
Modell stoesse(int ms) { Modell m; const long p = static_cast<long>(RATE) * ms / 1000; m.stoer = [p](long f) { return f % p < KLICK ? 0.5f : 0.0f; }; return m; }

bool kein_wert(const LatenzErgebnis& e) { return !e.ok; }

// Läuft latenz_warten in einem Faden und wartet höchstens `grenze_ms`; hängt es, bleibt der Faden zurück (Mutation) und der Test scheitert.
bool warten_endet(LatenzWarte& aus, int n0, std::atomic<bool>* ausfall_flag, int frist_ms, int grenze_ms) {
  struct Zustand { std::atomic<int> n; std::atomic<bool> ausfall; std::atomic<bool> fertig{false}; LatenzWarte w = LatenzWarte::Fertig; };
  auto z = std::make_shared<Zustand>();
  z->n = n0;
  z->ausfall = ausfall_flag ? ausfall_flag->load() : false;
  std::thread([z, frist_ms] { z->w = latenz_warten(z->n, 5, z->ausfall, frist_ms, 10); z->fertig = true; }).detach();
  for (int t = 0; t < grenze_ms && !z->fertig; t += 10) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  if (!z->fertig) return false;
  aus = z->w;
  return true;
}

}  // namespace

int main() {
  // Versatz innerhalb des Blocks: 256 trifft auch die Mutante (Impuls bei i=0), 300, 1000, 1280 nicht (i=44, i=232, i=0 im vierten Block).
  for (int L : {256, 300, 1000, 1280}) {
    LatenzLauf l;
    l.versuche = 60;
    Modell m;
    m.L = L;
    const Lauf r = fahre(l, m);
    bool alle = r.ergebnis.size() == 60;
    for (int v : r.ergebnis) alle = alle && v == L;
    PRUEF(alle);
    const LatenzErgebnis e = latenz_urteil(l, 20, RATE);
    PRUEF(e.ok && e.streuung == 0.0 && e.mittel == L && e.min == L && e.max == L);
    PRUEF(r.impulse.size() == 60);
  }
  {  // Fehlerfall R1: Quelle dauerhaft auf 0,5, keine Schleife. Es darf kein Wert entstehen und kein Impuls hinausgehen.
    LatenzLauf l;
    l.versuche = 20;
    Modell m;
    m.pegel = 0.5f;
    const Lauf r = fahre(l, m);
    PRUEF(r.ergebnis.size() == 20);
    bool alle_leer = true;
    for (int v : r.ergebnis) alle_leer = alle_leer && v == -1;
    PRUEF(alle_leer);
    PRUEF(r.impulse.empty());
    const LatenzErgebnis e = latenz_urteil(l, 20, RATE);
    PRUEF(!e.ok && std::strcmp(e.grund, "keine_schleife") == 0);
    // Pause nach einem Unruhig-Versuch: je Mess- und Leerversuch mindestens eine halbe Sekunde. Ohne sie sind 20 Versuche nach wenigen Blöcken durch.
    PRUEF(r.bloecke >= 3700);
  }
  {  // Negativ-Kontrolle: stille Quelle ohne Schleife bleibt "keine_schleife", ohne dass die Ruheprüfung etwas verschluckt
    LatenzLauf l;
    l.versuche = 6;
    const Lauf r = fahre(l, Modell{});
    PRUEF(r.impulse.size() == 6);                    // hier wurde gesendet, nur nichts kam zurück
    bool alle_leer = true;
    for (int v : r.ergebnis) alle_leer = alle_leer && v == -1;
    PRUEF(alle_leer);
    const LatenzErgebnis e = latenz_urteil(l, 6, RATE);
    PRUEF(!e.ok && std::strcmp(e.grund, "keine_schleife") == 0);
  }

  // R2, Befund MAJOR: eine rhythmische Quelle ohne Schleife liefert keinen Wert (vorher ok:true, z. B. 90 BPM mittel=7936).
  for (int bpm : {90, 100, 140}) PRUEF(kein_wert(messe(metronom(bpm))));
  PRUEF(kein_wert(messe(stoesse(400))));
  PRUEF(kein_wert(messe(stoesse(666))));
  for (int ms = 1500; ms <= 4000; ms += 250) PRUEF(kein_wert(messe(stoesse(ms))));   // auch langsame Stöße (Treffer nur in manchen Fenstern)
  {  // Schleife L=600 plus Stöße alle 400 ms: kein Wert, jedenfalls kein verschobener
    Modell m = stoesse(400);
    m.L = 600;
    const LatenzErgebnis e = messe(m);
    PRUEF(!e.ok || std::fabs(e.mittel - 600.0) <= 1.0);
    PRUEF(!e.ok);                                    // der Leerversuch sieht die Stöße
  }
  {  // Schleife L=256 plus Metronom. Abweichung vom Auftragstext ("ok 256"): die Leerversuche sehen das Metronom, also kein Wert. Falsch darf er nie sein.
    Modell m = metronom(120);
    m.L = 256;
    const LatenzErgebnis e = messe(m);
    PRUEF(!e.ok || e.mittel == 256.0);
    PRUEF(!e.ok && std::strcmp(e.grund, "quelle_unruhig") == 0);
  }
  {  // Ein einziger Störer im ersten Leerfenster, sonst saubere Schleife: die Messversuche allein liefern 600 mit Streuung 0, nur der Leerversuch sieht ihn.
    Modell m;
    m.L = 600;
    m.stoer = [](long f) { return (f >= 10000 && f < 10000 + KLICK) ? 0.5f : 0.0f; };
    const LatenzErgebnis e = messe(m);
    PRUEF(!e.ok && std::strcmp(e.grund, "quelle_unruhig") == 0);
    Modell sauber;
    sauber.L = 600;                                  // Negativ-Kontrolle: dieselbe Schleife ohne Störer
    const LatenzErgebnis s = messe(sauber);
    PRUEF(s.ok && s.mittel == 600.0 && s.streuung == 0.0);
  }
  {  // Streuungsgrenze rate/1000 = 48 Samples: eine Schleife, die um 48 wackelt, gilt noch, um 49 nicht mehr
    Modell m;
    m.L = 600;
    m.wackel = 48;
    const LatenzErgebnis e48 = messe(m);
    PRUEF(e48.ok && e48.max - e48.min == 48);
    m.wackel = 49;
    const LatenzErgebnis e49 = messe(m);
    PRUEF(!e49.ok && std::strcmp(e49.grund, "quelle_unruhig") == 0);
  }
  {  // Impulsabstände sind pseudozufällig verschoben, aber bei jedem Lauf dieselben (fester Seed)
    LatenzLauf a, b;
    a.versuche = b.versuche = 12;
    a.leer_dran = b.leer_dran = false;
    const Lauf ra = fahre(a, Modell{}), rb = fahre(b, Modell{});
    PRUEF(ra.impulse == rb.impulse && ra.impulse.size() == 12);
    long kl = 1L << 40, gr = 0;
    for (std::size_t k = 1; k < ra.impulse.size(); ++k) {
      const long d = ra.impulse[k] - ra.impulse[k - 1];
      kl = std::min(kl, d);
      gr = std::max(gr, d);
    }
    PRUEF(gr - kl >= static_cast<long>(RATE) / 4);
  }

  // R2, Befund MINOR: das 100-ms-Fenster und die Pause nach einem Unruhig-Versuch. Ein Störer (5 ms) liegt kurz vor dem Versuch.
  {
    constexpr long F0 = 40 * NF + 100;               // reicht von Block 40 bis in Block 41
    const long letzter = (F0 + KLICK - 1) / NF;      // letzter lauter Block
    const long ende = (letzter + 1) * NF + RATE / 10;                 // laut_bis + 100 ms
    const long erster_frei = (ende + NF - 1) / NF * NF;               // erster Block, der wieder frei ist
    Modell m;
    m.stoer = [](long f) { return (f >= F0 && f < F0 + KLICK) ? 0.5f : 0.0f; };
    {  // (a) der Versuch fällt auf den letzten Block im Fenster: Unruhig-Versuch (-1), der Impuls kommt erst nach der Pause von 0,5 s
      LatenzLauf l;
      l.versuche = 3;
      l.leer_dran = false;
      l.pause_bis = static_cast<uint64_t>(erster_frei - NF);
      const Lauf r = fahre(l, m);
      PRUEF(r.ergebnis.size() == 3 && r.ergebnis[0] == -1);
      PRUEF(!r.impulse.empty() && r.impulse[0] >= erster_frei - static_cast<long>(NF) + static_cast<long>(RATE) / 2);
    }
    {  // (b) Negativ-Kontrolle: der Versuch fällt auf den ersten freien Block: der Impuls geht sofort hinaus, nicht später
      LatenzLauf l;
      l.versuche = 1;
      l.leer_dran = false;
      l.pause_bis = static_cast<uint64_t>(erster_frei);
      const Lauf r = fahre(l, m);
      PRUEF(!r.impulse.empty() && r.impulse[0] == erster_frei);
    }
  }

  {  // Frist: ruft der Treiber process nicht mehr auf, endet das Warten nach der Frist
    LatenzWarte w = LatenzWarte::Fertig;
    PRUEF(warten_endet(w, 0, nullptr, 200, 3000));
    PRUEF(w == LatenzWarte::Frist);
  }
  {  // Ausfall des Servers beendet das Warten lange vor der Frist
    LatenzWarte w = LatenzWarte::Fertig;
    std::atomic<bool> aus{true};
    PRUEF(warten_endet(w, 0, &aus, 60000, 1000));
    PRUEF(w == LatenzWarte::Ausfall);
  }
  {  // Negativ-Kontrolle: alle Versuche durch = Fertig, auch bei gesetztem Ausfall (der Wert ist dann gültig)
    LatenzWarte w = LatenzWarte::Frist;
    std::atomic<bool> aus{true};
    PRUEF(warten_endet(w, 5, &aus, 60000, 1000));
    PRUEF(w == LatenzWarte::Fertig);
  }
  PRUEF_ENDE();
}
