// Paket 1.13 Warp, Slice 2: das Warp-Werk allein (cypherdj/warp_werk.h), ohne Arrangement. Eine Quelle (Sinus 1 kHz, auf 125 BPM gebaut) läuft
// über einen Warp mit zwei Markern in ein 128er Projekt; der Test spielt den Callback nach (takt() am Zyklusende, Lesen aus dem Ring).
//   1  Pool           64 Plätze, der 65. liefert −1; gib() macht einen Platz sofort wieder frei
//   2  Ton            COMPLEX und TONES: Sinus 1 kHz klingt je 100-ms-Fenster auf ±2 ct (AK6/AK7, Tonhöhe bleibt trotz Dehnung 125 → 128)
//   3  Lage           die Stimme beginnt auf ihrem Ziel-Sample s_h: kein Frame davor, der erste Klick-Anstieg bei s_h + Latenz ≤ 16 Samples
//   4  Faden = Render synchrones Werk und Werk mit 2 Fäden liefern dieselben Frames, Bit für Bit (48 000 Frames): Live gleich Export
//   5  Epoche         ein neuer Auftrag auf demselben Platz verwirft den alten Ring; der alte Klang taucht nicht mehr auf
//   6  Ende           s_ende begrenzt die Stimme: ende_s() meldet es, dahinter liegt nichts im Ring
//   7  Halt           test_halte: nichts erscheint im Ring (Unterlauf wäre sichtbar), nach dem Loslassen erscheint es
//   8  Überholen      ein zweiter Auftrag auf demselben Platz (gib, belege, ansetzen, wie an einer Naht oder bei einer neuen Karte) kommt immer an,
//                     auch wenn der Faden den ersten gerade holt (D4: der neueste gewinnt, nie verlieren)
//   9  Ring voll      liest der Callback nicht, wartet der Faden auf den nächsten takt() und dreht nicht leer (er läuft auf Echtzeit-Priorität)
//   0  Speicher       das Werk (64 Plätze, je zwei Bungee-Instanzen, Ringe, Markerkopien) belegt höchstens 100 MiB (gemessen 59 MiB)
// Mutationen (WILL_FAIL, jede macht ihren Fall rot): WARP_SOLL_NACH_SCHREIBE (Fall 8; der Auftrag ist sichtbar, bevor `soll` ihn deckt), WARP_RING_VOLL_DREHT
// (Fall 9). Die Epochen des Rings (Fall 5 und 6) und Fall 4 sind die Gegenproben der übrigen Regeln.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

using namespace std::chrono_literals;
namespace {

constexpr int64_t FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle
constexpr int64_t SPB = arrtest::SPB;   // Samples je Beat bei 128 BPM

// Eine Quelle mit Warp: Clip-Beat 0 bis 8 liegt auf Quellframe 0 bis 8 · FPB125 (die Marker sind wie die der Ablage auf der Seite)
struct Quelle {
  std::unique_ptr<arrtest::Audio> audio;
  std::vector<double> beat{0.0, 8.0}, frame{0.0, 8.0 * static_cast<double>(FPB125)};
  cdj::ArrWarp warp;
  cdj::ArrClip clip{};
  Quelle(std::unique_ptr<arrtest::Audio> a, int modus) : audio(std::move(a)) {
    warp.modus = modus;
    warp.n = 2;
    warp.beat = beat.data();
    warp.frame = frame.data();
    clip.id = 1;
    clip.start_beat = 0.0;
    clip.laenge_beats = 8.0;
    clip.audio = &audio->a;
    clip.gain = 1.0f;
    clip.warp = &warp;
  }
};

// Auftrag für einen Clip, der auf Sample s_c einsetzt (Karte 128 BPM, Beat 0 auf Sample 0): Clip-Beat b(m) = m / SPB − s_c / SPB
cdj::WarpAnsatz auftrag(const Quelle& q, int64_t s_c, int64_t s_h) {
  cdj::WarpAnsatz a;
  a.clip = &q.clip;
  a.s_h = s_h;
  a.s_ende = s_c + 8 * SPB;
  a.beat_versatz = -static_cast<double>(s_c) / static_cast<double>(SPB);
  a.karte = cdj::Karte(128.0, 0);
  return a;
}

// Der Callback spielt nach: bis n Frames ab s_h lesen, jedes 256er Stück nach einem takt(); true, wenn alles kam (Fäden: bis zu 3 s warten)
bool lies(cdj::WarpWerk& w, int p, int64_t s_h, int64_t n, std::vector<float>& l, std::vector<float>& r) {
  l.assign(static_cast<size_t>(n), 0.0f);
  r.assign(static_cast<size_t>(n), 0.0f);
  const auto frist = std::chrono::steady_clock::now() + 3s;
  for (int64_t s = s_h; s < s_h + n; s += 256) {
    const int m = static_cast<int>(std::min<int64_t>(256, s_h + n - s));
    w.takt(s);
    while (!w.ring(p).lies(s, m, l.data() + (s - s_h), r.data() + (s - s_h))) {
      if (std::chrono::steady_clock::now() > frist) return false;
      std::this_thread::sleep_for(1ms);
      w.takt(s);
    }
  }
  return true;
}

// Frequenz über aufwärts gerichtete Nulldurchgänge in [a, b)
double frequenz(const std::vector<float>& l, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b && i + 1 < static_cast<int64_t>(l.size()); ++i) {
    const double x0 = l[static_cast<size_t>(i)], x1 = l[static_cast<size_t>(i) + 1];
    if (x0 < 0 && x1 >= 0) {
      const double t = static_cast<double>(i) + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

// größte Abweichung in ct über 100-ms-Fenster ab Frame von
double max_ct(const std::vector<float>& l, int64_t von, int64_t bis, double hz) {
  double m = 0.0;
  for (int64_t s = von; s + 4800 <= bis; s += 4800) {
    const double f = frequenz(l, s, s + 4800);
    if (f <= 0.0) return 1e9;
    m = std::max(m, std::fabs(1200.0 * std::log2(f / hz)));
  }
  return m;
}

long vmrss_kib() {
  std::ifstream f("/proc/self/status");
  std::string z;
  while (std::getline(f, z))
    if (z.compare(0, 6, "VmRSS:") == 0) return std::atol(z.c_str() + 6);
  return -1;
}

}  // namespace

int main() {
  const long rss0 = vmrss_kib();
  auto werk = cdj::warp_werk_neu({});
  PRUEF(werk != nullptr);
  if (!werk) PRUEF_ENDE();
  const long rss1 = vmrss_kib();
  std::printf("Fall 0: Werk belegt %.1f MiB (%d Plätze mit je zwei Bungee-Instanzen)\n", static_cast<double>(rss1 - rss0) / 1024.0, cdj::ARR_WARP_PLAETZE);
#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
  PRUEF(rss0 > 0 && rss1 - rss0 < 600 * 1024);   // ein Sanitizer verdoppelt bis verdreifacht den Speicher (gemessen unter TSan: 207 MiB)
#else
  PRUEF(rss0 > 0 && rss1 - rss0 < 100 * 1024);   // gemessen 59 MiB
#endif
  // ---- 1: Pool
  {
    int plaetze[cdj::ARR_WARP_PLAETZE + 1];
    for (int i = 0; i < cdj::ARR_WARP_PLAETZE; ++i) plaetze[i] = werk->belege();
    PRUEF(werk->belegt() == cdj::ARR_WARP_PLAETZE);
    bool alle_verschieden = true;
    for (int i = 0; i < cdj::ARR_WARP_PLAETZE; ++i)
      for (int j = 0; j < i; ++j) alle_verschieden = alle_verschieden && plaetze[i] != plaetze[j];
    PRUEF(alle_verschieden && plaetze[0] >= 0);
    PRUEF(werk->belege() == -1);                                       // der 65. Platz: Pool voll
    werk->gib(plaetze[7]);
    PRUEF(werk->belegt() == cdj::ARR_WARP_PLAETZE - 1);
    const int neu = werk->belege();
    PRUEF(neu == plaetze[7]);                                          // der freie Platz ist sofort wieder da
    for (int i = 0; i < cdj::ARR_WARP_PLAETZE; ++i) werk->gib(plaetze[i]);
    PRUEF(werk->belegt() == 0);
  }
  // ---- 2 und 3: Ton und Lage, COMPLEX und TONES
  const int64_t S_C = 10000;
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) {
    Quelle q(arrtest::Audio::sinus(9 * FPB125, 1000.0, 0.5f), modus);
    const int p = werk->belege();
    PRUEF(p >= 0);
    cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
    werk->ansetzen(p, a);
    std::vector<float> l, r;
    PRUEF(lies(*werk, p, S_C, 6 * SPB, l, r));
    const double ct = max_ct(l, 4800, 6 * SPB - 4800, 1000.0);   // das erste und das letzte Fenster sind Ein- und Ausschwingen
    std::printf("Fall 2 (%s): größte Abweichung %.2f ct über %lld Fenster\n", modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES", ct,
                static_cast<long long>((6 * SPB - 9600) / 4800));
    PRUEF(ct < 2.0);
    // Gegenprobe der Messung: dieselbe Quelle ungedehnt abgespielt (Varispeed 125/128) wäre 41 ct tief; die Messung sieht das
    std::vector<float> v(l.size());
    for (size_t i = 0; i < v.size(); ++i) v[i] = q.audio->d[2 * static_cast<size_t>(static_cast<double>(i) * 125.0 / 128.0)];
    PRUEF(max_ct(v, 4800, 6 * SPB - 4800, 1000.0) > 30.0);
    // 3: das erste Sample des Rings ist s_h; davor kein Frame
    PRUEF(!werk->ring(p).lies(S_C - 256, 256, l.data(), r.data()));
    PRUEF(werk->ende_s(p) == INT64_MAX);
    werk->gib(p);
  }
  // ---- 4: synchron gleich Fäden (Bit für Bit)
  {
    Quelle q(arrtest::Audio::klicks(9 * FPB125, 11520), cdj::ARR_WARP_COMPLEX);
    auto faeden = cdj::warp_werk_neu({2});
    PRUEF(faeden != nullptr);
    std::vector<float> l0, r0, l1, r1;
    {
      const int p = werk->belege();
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      werk->ansetzen(p, a);
      PRUEF(lies(*werk, p, S_C, 48000, l0, r0));
      werk->gib(p);
    }
    if (faeden) {
      const int p = faeden->belege();
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      faeden->ansetzen(p, a);
      PRUEF(lies(*faeden, p, S_C, 48000, l1, r1));
      faeden->gib(p);
      faeden->stoppe();
    }
    int ungleich = 0;
    float spitze = 0.0f;
    for (size_t i = 0; i < l0.size() && i < l1.size(); ++i) {
      ungleich += (l0[i] != l1[i]) + (r0[i] != r1[i]);
      spitze = std::max(spitze, std::fabs(l0[i]));
    }
    std::printf("Fall 4: %d abweichende Werte in 2 · 48000, Spitze %.3f\n", ungleich, spitze);
    PRUEF(ungleich == 0 && l0.size() == 48000 && l1.size() == 48000);
    PRUEF(spitze > 0.3f);   // die Klicks sind da: gleiche Stille wäre keine Gleichheit
  }
  // ---- 5: Epoche
  {
    Quelle q(arrtest::Audio::klicks(9 * FPB125, 11520), cdj::ARR_WARP_COMPLEX);
    const int p = werk->belege();
    cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
    werk->ansetzen(p, a);
    std::vector<float> l, r;
    PRUEF(lies(*werk, p, S_C, 4096, l, r));
    cdj::WarpAnsatz b = auftrag(q, 200000, 200000);   // anderer Einsatz: der Ring der alten Epoche (Samples ab 10 000 bis weit darüber) ist wertlos
    werk->ansetzen(p, b);
    werk->takt(200000);
    PRUEF(!werk->ring(p).lies(S_C + 4096, 256, l.data(), r.data()));   // nichts aus der alten Epoche
    PRUEF(lies(*werk, p, 200000, 4096, l, r));                          // die neue liefert
    float spitze = 0.0f;
    for (float x : l) spitze = std::max(spitze, std::fabs(x));
    PRUEF(spitze > 0.3f);
    // 6: Ende
    cdj::WarpAnsatz c = auftrag(q, 400000, 400000);
    c.s_ende = 400000 + 2048;                                           // das Clip-Ende nach 8 Blöcken
    werk->ansetzen(p, c);
    PRUEF(lies(*werk, p, 400000, 2048, l, r));
    werk->takt(400000 + 2048);
    PRUEF(werk->ende_s(p) == 400000 + 2048);
    PRUEF(!werk->ring(p).lies(400000 + 2048, 256, l.data(), r.data()));
    werk->gib(p);
  }
  // ---- 7: Halt
  {
    Quelle q(arrtest::Audio::klicks(9 * FPB125, 11520), cdj::ARR_WARP_COMPLEX);
    const int p = werk->belege();
    cdj::WarpAnsatz a = auftrag(q, 600000, 600000);
    werk->test_halte(true);
    werk->ansetzen(p, a);
    werk->takt(600000);
    std::vector<float> l(256), r(256);
    PRUEF(!werk->ring(p).lies(600000, 256, l.data(), r.data()));       // das Werk steht: nichts da
    werk->test_halte(false);
    werk->takt(600000);
    PRUEF(werk->ring(p).lies(600000, 256, l.data(), r.data()));        // losgelassen: da
    werk->gib(p);
  }
  // ---- 8: Überholen. gib() und ein neuer Auftrag auf demselben Platz, während der Faden den ersten holt (Pause 0 bis 8 µs nach dem Wecken: der Faden wacht gerade auf; bei 0 bis 60 µs trat der Verlust in 3 000 Versuchen nie auf): der zweite
  // Auftrag kommt immer an. Ein Faden, der ihn zwischen Veröffentlichen und `soll` holte, hielte ihn für überholt, verwürfe ihn und rechnete die Stimme nie.
  {
    auto eins = cdj::warp_werk_neu({1});
    PRUEF(eins != nullptr);
    if (eins) {
      Quelle q(arrtest::Audio::sinus(9 * FPB125, 1000.0, 0.5f), cdj::ARR_WARP_COMPLEX);
      std::mt19937 zufall(7);
      int p = eins->belege();
      int64_t s = 100000;
      int runden = 0, verloren = 0;
#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
      const int RUNDEN = 150;   // ein Sanitizer rechnet zehnmal langsamer
#else
      const int RUNDEN = 3000;
#endif
      for (; runden < RUNDEN && verloren == 0; ++runden) {
        s += 50000;
        cdj::WarpAnsatz a = auftrag(q, s + cdj::ARR_WARP_FRIST, s + cdj::ARR_WARP_FRIST);
        eins->ansetzen(p, a);
        eins->takt(s);   // den Faden wecken
        const auto bis = std::chrono::steady_clock::now() + std::chrono::nanoseconds(std::uniform_int_distribution<int>(0, 8000)(zufall));
        while (std::chrono::steady_clock::now() < bis) {
        }
        eins->gib(p);
        p = eins->belege();   // der niedrigste freie Platz: derselbe
        cdj::WarpAnsatz b = auftrag(q, s + 2 * cdj::ARR_WARP_FRIST, s + 2 * cdj::ARR_WARP_FRIST);
        eins->ansetzen(p, b);
        eins->takt(s);
        bool da = false;
        for (int t = 0; t < 150 && !da; ++t) {   // bis 150 ms
          std::this_thread::sleep_for(1ms);
          eins->takt(s);
          da = eins->ring(p).verfuegbar(b.s_h) > 0;
        }
        verloren += da ? 0 : 1;
      }
      const cdj::WarpZaehler z = eins->zaehler();
      std::printf("Fall 8: %d Runden, %d zweite Aufträge nie angekommen, Aufträge übernommen %llu, verworfen %llu\n", runden, verloren, static_cast<unsigned long long>(z.ansaetze),
                  static_cast<unsigned long long>(z.verworfen));
      PRUEF(verloren == 0);
      eins->stoppe();   // die Fäden vor der Quelle beenden: sie rechnen die letzte Stimme sonst aus freigegebenem Speicher
    }
  }
  // ---- 9: Ring voll. Der Callback liest nicht, aber sein Stand läuft weit voraus: der Faden füllt den Ring (16 384 Frames) und wartet dann auf takt() (oder
  // seine 5 ms), statt den Schreibversuch im Leerlauf zu wiederholen.
  {
    auto eins = cdj::warp_werk_neu({1});
    PRUEF(eins != nullptr);
    if (eins) {
      Quelle q(arrtest::Audio::sinus(9 * FPB125, 1000.0, 0.5f), cdj::ARR_WARP_COMPLEX);
      const int p = eins->belege();
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      eins->ansetzen(p, a);
      eins->takt(S_C + 1000000);   // der Callback „ist weit voraus“, liest aber nichts
      for (int t = 0; t < 8000 && eins->zaehler().bloecke < 60; ++t) std::this_thread::sleep_for(1ms);   // bis der Ring voll ist (unter einem Sanitizer Sekunden)
      std::this_thread::sleep_for(300ms);
      const cdj::WarpZaehler z = eins->zaehler();
      std::printf("Fall 9: 300 ms nach dem vollen Ring (ohne Leser) %llu Blöcke im Ring, %llu Schreibversuche am vollen Ring\n", static_cast<unsigned long long>(z.bloecke),
                  static_cast<unsigned long long>(z.ring_voll));
      PRUEF(z.bloecke >= 60);                    // der Ring ist voll (64 Blöcke zu 256 Frames)
      PRUEF(z.ring_voll >= 1 && z.ring_voll < 200);   // 300 ms / 5 ms Wartezeit = 60; ein drehender Faden zählte Millionen
      eins->stoppe();
    }
  }
  PRUEF_ENDE();
}
