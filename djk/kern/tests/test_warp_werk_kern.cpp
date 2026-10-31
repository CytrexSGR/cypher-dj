// Paket 1.13 Warp, Slice 2: das Warp-Werk im echten Kern ohne JACK (arr35::Lauf, synchrones Werk, Kern::setze_arr_warp_werk). Eine Wiedergabe /2 mit vier gewarpten
// Clips (zwei COMPLEX, einer TONES, einer RE-PITCH) wird geladen und gespielt; der Kern meldet /zustand/warp (Ereignis WARP_ZUSTAND).
//   1  Zähler        nach dem Einsatz meldet der Kern drei Stimmen im Werk (RE-PITCH ist keine), Unterlauf 0, kein_platz 0, spät 0, Fäden 0
//   2  Ausfall       test_halte: nach dem Leerlaufen der Ringe (8 192 Samples) meldet er Unterlauf > 0; nach dem Loslassen bleibt die Zahl stehen (ein Ereignis, kein Dauerzähler)
//   3  Ohne Werk     derselbe Lauf ohne Werk: keine Meldung /zustand/warp, die drei Clips spielen als RE-PITCH und das Arrangement zählt kein_platz 3 (Negativ-Kontrolle zu 1)
//   4  Tausch        eine zweite Wiedergabe (anderer Warp) löst die erste ab; die abgelöste wird erst freigegeben, wenn das Werk sie nicht mehr liest (Lauf::frei), das Konto
//                    ist danach 0 (Lebensdauer im Kern: ARR_ALT -> Freigabe)
//   5  Karte         eine Tempo-Rampe über den Befehl /k/tempo/rampe erhöht die Karten-Generation des Tempoplans; das Arrangement setzt die drei Stimmen des Werks neu an
//                    (Zahl der Aufträge im Werk wächst um drei), ohne Rampe bleibt sie gleich (Negativ-Kontrolle)
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

using k35::N;

namespace {

constexpr int64_t FPB125 = 23040;

std::string sinus_datei(const arrdatei::Ordner& o, char z, int64_t frames, double hz) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f)
    d[static_cast<size_t>(2 * f)] = d[static_cast<size_t>(2 * f) + 1] = 0.2f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(f) / 48000.0));
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

std::string spuren_json(arr35::Lauf& x, const std::string& a, int64_t frames, double ende2) {
  const std::vector<std::pair<double, double>> m = {{0.0, 0.0}, {ende2, ende2 * static_cast<double>(FPB125)}};
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip_warp("c1", 0.0, 8.0, a, frames, m, 0.0, 2) + "]}," +
         "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + x.ordner.clip_warp("c2", 0.0, 8.0, a, frames, m, 0.0, 2) + "]}," +
         "{\"nr\":3,\"art\":\"audio\",\"clips\":[" + x.ordner.clip_warp("c3", 0.0, 8.0, a, frames, m, 0.0, 3) + "]}," +
         "{\"nr\":4,\"art\":\"audio\",\"clips\":[" + x.ordner.clip_warp("c4", 0.0, 8.0, a, frames, m, 0.0, 0) + "]}";
}

// der letzte WARP_ZUSTAND unter den Ereignissen, -1 ohne
int letzter(const arr35::Lauf& x) {
  for (int i = static_cast<int>(x.ev.size()) - 1; i >= 0; --i)
    if (x.ev[static_cast<size_t>(i)].art == cdj::Ereignis::WARP_ZUSTAND) return i;
  return -1;
}

int zaehle(const arr35::Lauf& x) {
  int n = 0;
  for (const cdj::Ereignis& e : x.ev) n += e.art == cdj::Ereignis::WARP_ZUSTAND;
  return n;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_warp_werk_kern");
  const int64_t F = 12 * FPB125;
  // ---- 1 und 2
  {
    arr35::Lauf x(ab.pfad, "test_warp_werk_kern_1");
    auto werk = cdj::warp_werk_neu({});
    PRUEF(werk != nullptr);
    x.kern->setze_arr_warp_werk(werk.get());
    const std::string a = sinus_datei(x.ordner, 'a', F, 1000.0);
    x.laden(1, spuren_json(x, a, F, 8.0), "andreas", true);
    x.start(0.0, 0);
    x.lauf(x.kern->sample() + 40 * N);   // Einsatz bei Sample 3n + 25 + ARR_WARP_FRIST, danach Klang
    int i = letzter(x);
    PRUEF(i >= 0);
    if (i >= 0) {
      const cdj::Ereignis& e = x.ev[static_cast<size_t>(i)];
      std::printf("Fall 1: /zustand/warp stimmen %d, unterlauf %d, kein_platz %d, spaet %d, faeden %d (%d Meldungen)\n", e.warp_stimmen, e.warp_unterlauf, e.warp_kein_platz,
                  e.warp_spaet, e.warp_faeden, zaehle(x));
      PRUEF(e.warp_stimmen == 3 && e.warp_unterlauf == 0 && e.warp_kein_platz == 0 && e.warp_spaet == 0 && e.warp_faeden == 0);
    }
    float spitze = 0.0f;
    for (size_t s = static_cast<size_t>(10 * N); s < x.l.size(); ++s) spitze = std::max(spitze, std::fabs(x.l[s]));
    PRUEF(spitze > 0.1f);   // es klingt
    // 2: das Werk steht
    werk->test_halte(true);
    x.lauf(x.kern->sample() + 60 * N);   // 15 360 Samples: der Ring (8 192 Frames) ist leer
    i = letzter(x);
    PRUEF(i >= 0);
    int unterlauf = 0;
    if (i >= 0) unterlauf = x.ev[static_cast<size_t>(i)].warp_unterlauf;
    std::printf("Fall 2: nach dem Halt des Werks Unterlauf %d\n", unterlauf);
    PRUEF(unterlauf == 3);   // drei Stimmen, je ein Ausfall
    werk->test_halte(false);
    x.lauf(x.kern->sample() + 20 * N);
    i = letzter(x);
    PRUEF(i >= 0 && x.ev[static_cast<size_t>(i)].warp_unterlauf == 3);
    PRUEF(x.ev[static_cast<size_t>(i)].warp_stimmen == 3);
    x.stopp(0);
    x.lauf(x.kern->sample() + 20 * N);
    werk->stoppe();
  }
  // ---- 3: ohne Werk
  {
    arr35::Lauf x(ab.pfad, "test_warp_werk_kern_3");
    const std::string a = sinus_datei(x.ordner, 'b', F, 1000.0);
    x.laden(1, spuren_json(x, a, F, 8.0), "andreas", true);
    x.start(0.0, 0);
    x.lauf(x.kern->sample() + 40 * N);
    std::printf("Fall 3 (ohne Werk): %d Meldungen /zustand/warp, kein_platz %llu, Stimmen im Werk %d\n", zaehle(x), static_cast<unsigned long long>(x.kern->arrangement().warp_kein_platz()),
                x.kern->arrangement().werk_stimmen());
    PRUEF(zaehle(x) == 0);
    PRUEF(x.kern->arrangement().warp_kein_platz() == 3 && x.kern->arrangement().werk_stimmen() == 0);
    float spitze = 0.0f;
    for (size_t s = static_cast<size_t>(10 * N); s < x.l.size(); ++s) spitze = std::max(spitze, std::fabs(x.l[s]));
    PRUEF(spitze > 0.1f);   // RE-PITCH klingt trotzdem
    x.stopp(0);
    x.lauf(x.kern->sample() + 20 * N);
  }
  // ---- 4: Tausch, Freigabe
  {
    arr35::Lauf x(ab.pfad, "test_warp_werk_kern_4");
    auto werk = cdj::warp_werk_neu({});
    x.kern->setze_arr_warp_werk(werk.get());
    const std::string a = sinus_datei(x.ordner, 'c', F, 1000.0);
    x.laden(1, spuren_json(x, a, F, 8.0), "andreas", true);
    x.start(0.0, 0);
    x.lauf(x.kern->sample() + 30 * N);
    x.laden(2, spuren_json(x, a, F, 8.1), "andreas", true);   // anderer Warp: die Stimmen der ersten Wiedergabe lösen sich ab
    x.lauf(x.kern->sample() + 60 * N);
    int arr_alt = 0;
    for (const cdj::Ereignis& e : x.ev) arr_alt += e.art == cdj::Ereignis::ARR_ALT;
    std::printf("Fall 4: %d abgelöste Wiedergaben gemeldet, Stimmen im Werk %d\n", arr_alt, x.kern->arrangement().werk_stimmen());
    PRUEF(arr_alt == 1 && x.kern->arrangement().werk_stimmen() == 3);
    x.stopp(0);
    x.lauf(x.kern->sample() + 20 * N);
    werk->stoppe();
  }
  // ---- 5: neue Karten-Generation
  for (int mit_rampe = 0; mit_rampe < 2; ++mit_rampe) {
    arr35::Lauf x(ab.pfad, "test_warp_werk_kern_5");
    auto werk = cdj::warp_werk_neu({});
    x.kern->setze_arr_warp_werk(werk.get());
    const std::string a = sinus_datei(x.ordner, 'd', F, 1000.0);
    x.laden(1, spuren_json(x, a, F, 8.0), "andreas", true);
    x.start(0.0, 0);
    x.lauf(x.kern->sample() + 40 * N);
    const uint64_t vorher = werk->zaehler().ansaetze;
    if (mit_rampe) {
      cdj::Befehl r = x.neu(cdj::Befehl::TEMPO_RAMPE);
      r.ab_beat = std::ceil(x.kern->karte().beat_at(static_cast<double>(x.kern->sample()))) + 2.0;
      r.ziel_bpm = 126.0;
      r.dauer_beats = 2.0;
      x.sende(r);
    }
    x.lauf(x.kern->sample() + 40 * N);
    const uint64_t nachher = werk->zaehler().ansaetze;
    std::printf("Fall 5 (%s): Aufträge im Werk vorher %llu, nachher %llu\n", mit_rampe ? "mit Rampe" : "ohne Rampe", static_cast<unsigned long long>(vorher), static_cast<unsigned long long>(nachher));
    PRUEF(mit_rampe ? nachher == vorher + 3 : nachher == vorher);
    x.stopp(0);
    x.lauf(x.kern->sample() + 20 * N);
    werk->stoppe();
  }
  PRUEF_ENDE();
}
