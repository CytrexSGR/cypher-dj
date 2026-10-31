// Paket 1.13 Warp, Slice 2 (AK31, Echtzeit-Regeln): kein malloc, free, keine Sperre und kein Schlafen im Kern-Zyklus mit spielenden Clips des Warp-Werks
// (alloc_abfang.h, thread_local; nur in kern->zyklus()). Acht gewarpte Spuren (vier COMPLEX, vier TONES), Loop-Klammer mit Nähten (der Durchlauf danach
// wird vorab angesetzt), ein Tausch der Wiedergabe mitten im Lauf (die Stimmen lösen sich ab), eine Tempo-Rampe (neue Karten-Generation: Stimmen neu ansetzen),
// ein Ausfall des Werks (Unterlauf mit Blende). Zwei Läufe:
//   synchron   das Werk füllt seine Ringe im Zyklus selbst (takt()): Callback UND Werk-Code stehen im Fenster, beides muss 0 sein (Spec: „0 Allokationen in
//              Callback und Werk nach dem Start“)
//   Fäden      zwei Arbeitsfäden: im Fenster steht nur der Callback (Aufträge stellen, Ringe lesen, Fäden wecken)
// Positiv-Kontrolle: ein malloc im Fenster wird gezählt. Unter ASan/TSan fehlt der Abfang: dann „übersprungen“, nie „bestanden“.
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <thread>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "cypherdj/warp_werk.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte

bool g_waechter = false;

using k35::N;

namespace {

constexpr int64_t FPB125 = 23040;

std::string sinus_datei(const arrdatei::Ordner& o, char z, int64_t frames, double hz) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f)
    d[static_cast<size_t>(2 * f)] = d[static_cast<size_t>(2 * f) + 1] = 0.1f * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(f) / 48000.0));
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

AbfangZahlen lauf(int faeden, const char* name) {
  const int n_mark = std::getenv("ALLOC_MARKER") ? std::max(2, std::atoi(std::getenv("ALLOC_MARKER"))) : 2;
  k35::Arbeitsbestand ab(name);
  arr35::Lauf x(ab.pfad, name);
  auto werk = cdj::warp_werk_neu({faeden});
  PRUEF(werk != nullptr);
  x.kern->setze_arr_warp_werk(werk.get());
  const int64_t F = 10 * FPB125;
  const std::string a = sinus_datei(x.ordner, 'a', F, 500.0), b = sinus_datei(x.ordner, 'b', F, 700.0);
  const auto spuren = [&](double ende2) {
    std::string s;
    for (int sp = 1; sp <= 8; ++sp) {
      std::vector<std::pair<double, double>> m;   // Slice 3a: ALLOC_MARKER Marker (Vorgabe 2) gleichmäßig auf der Geraden 0..ende2 Beats; bei 2 dieselben zwei wie vorher
      for (int i = 0; i < n_mark; ++i) {
        const double b = ende2 * i / (n_mark - 1);
        m.push_back({b, b * static_cast<double>(FPB125)});
      }
      s += (sp > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(sp) + ",\"art\":\"audio\",\"clips\":[" +
           x.ordner.clip_warp(("w" + std::to_string(sp)).c_str(), 0.0, 8.0, sp % 2 ? a : b, F, m, 0.0, sp <= 4 ? 2 : 3,
                                  sp % 3 == 0 ? 1.4983070768766815 : sp % 3 == 1 ? 0.7071067811865476 : 1.0) + "]}";   // Slice 5: +7 st, -6 st, 1 (der Neuabtast-Weg im Fenster)
    }
    return s;
  };
  x.laden(1, spuren(8.0), "andreas", true);
  x.loop(true, 0.0, 8.0);
  x.metronom(true, -12.0f, 0);
  x.start(0.0, 0);
  x.lauf(x.kern->sample() + 20 * N);
  AbfangZahlen summe;
  long zyklen_gezaehlt = 0;
  const auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      abfang_aus();
      summe += abfang_zahlen();
      ++zyklen_gezaehlt;
      cdj::Ereignis e;
      while (x.ere->hole(e))
        if (e.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
      if (faeden) std::this_thread::sleep_for(std::chrono::microseconds(600));   // die Fäden kommen mit
    }
  };
  zyklen(1500);                          // > 1 Durchlauf der Klammer (8 Beats = 180 000 Samples = 703 Zyklen): zwei Nähte
  x.laden(2, spuren(8.2), "andreas", true);   // Tausch: andere Marker, die Stimmen lösen sich ab
  zyklen(500);
  x.teil("spur/1/fader", -3.0f, 0.0, 0.0);
  {  // Tempo-Rampe der Karte (ab dem übernächsten Beat, 2 Beats auf 126 BPM): neue Karten-Generation, die Stimmen setzen neu an
    cdj::Befehl r = x.neu(cdj::Befehl::TEMPO_RAMPE);
    r.ab_beat = std::ceil(x.kern->karte().beat_at(static_cast<double>(x.kern->sample()))) + 2.0;
    r.ziel_bpm = 126.0;
    r.dauer_beats = 2.0;
    x.sende(r);
  }
  zyklen(300);
  werk->test_halte(true);                // Ausfall: die Ringe laufen leer (Unterlauf, Blende)
  zyklen(400);
  werk->test_halte(false);
  zyklen(300);
  x.stopp(0);
  zyklen(100);
  std::printf("arr_warp_alloc (%s): %ld Zyklen im Fenster: Allokationen %ld, free %ld, Sperren %ld, Schlafen %ld; Werk-Stimmen %d, Unterlauf %llu, spät %llu\n",
              faeden ? "Fäden" : "synchron", zyklen_gezaehlt, summe.alloc, summe.frei, summe.sperren, summe.schlafen, x.kern->arrangement().werk_stimmen(),
              static_cast<unsigned long long>(x.kern->arrangement().warp_unterlauf()), static_cast<unsigned long long>(x.kern->arrangement().warp_spaet()));
  PRUEF(x.kern->arrangement().warp_unterlauf() > 0);   // der Ausfall wurde bemerkt: der Lauf hat die Fehlerwege wirklich durchlaufen
  werk->stoppe();
  return summe;
}

// Slice 4: vier BEATS-Spuren (Lücke aus, vor, vor_zurueck, Hülle 70) im selben Zyklus-Fenster: Lauf, Loop-Nähte, Tausch (Hülle ändert sich: Ausklang-Kopie), Tempo-Rampe, Stopp.
// BEATS braucht kein Werk; das Fenster muss still bleiben (die Einheiten kommen fertig aus der Datei, die Karte wird nur gelesen).
AbfangZahlen lauf_beats(const char* name) {
  k35::Arbeitsbestand ab(name);
  arr35::Lauf x(ab.pfad, name);
  const int64_t F = 10 * FPB125;
  const std::string a = sinus_datei(x.ordner, 'a', F, 500.0);
  const auto spuren = [&](int huelle) {
    std::string s;
    for (int sp = 1; sp <= 4; ++sp) {
      std::string c = x.ordner.clip_warp(("b" + std::to_string(sp)).c_str(), 0.0, 8.0, a, F, {{0.0, 0.0}, {8.0, 8.0 * static_cast<double>(FPB125)}});
      std::string e = ",\"e\":[";
      for (int k = 0; k < 32; ++k) e += (k ? "," : "") + std::string("[") + std::to_string(k * 0.25) + "," + std::to_string(k * (FPB125 / 4)) + "]";
      e += "],\"loop\":" + std::to_string(sp % 3) + ",\"huelle\":" + std::to_string(sp == 4 ? huelle : 100);
      const size_t m = c.find("\"modus\":0");
      PRUEF(m != std::string::npos);
      c.replace(m, 9, "\"modus\":1" + e);
      s += (sp > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(sp) + ",\"art\":\"audio\",\"clips\":[" + c + "]}";
    }
    return s;
  };
  x.laden(1, spuren(70), "andreas", true);
  x.loop(true, 0.0, 8.0);
  x.start(0.0, 0);
  x.lauf(x.kern->sample() + 20 * N);
  AbfangZahlen summe;
  long zyklen_gezaehlt = 0;
  const auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      abfang_aus();
      summe += abfang_zahlen();
      ++zyklen_gezaehlt;
      cdj::Ereignis e;
      while (x.ere->hole(e))
        if (e.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
    }
  };
  zyklen(1500);                        // > 1 Durchlauf der Klammer: zwei Nähte
  PRUEF(x.kern->arrangement().stimmen() >= 4 && x.kern->arrangement().warp_stimmen() >= 4);   // die vier BEATS-Stimmen klingen wirklich (sonst misst das Fenster Stille)
  x.laden(2, spuren(60), "andreas", true);   // Tausch: Hülle der Spur 4 ändert sich, die Stimme blendet aus einer Kopie aus
  zyklen(500);
  {
    cdj::Befehl r = x.neu(cdj::Befehl::TEMPO_RAMPE);
    r.ab_beat = std::ceil(x.kern->karte().beat_at(static_cast<double>(x.kern->sample()))) + 2.0;
    r.ziel_bpm = 126.0;
    r.dauer_beats = 2.0;
    x.sende(r);
  }
  zyklen(500);
  x.stopp(0);
  zyklen(100);
  std::printf("arr_warp_alloc (BEATS): %ld Zyklen im Fenster: Allokationen %ld, free %ld, Sperren %ld, Schlafen %ld; Stimmen %d\n", zyklen_gezaehlt, summe.alloc, summe.frei, summe.sperren,
              summe.schlafen, x.kern->arrangement().stimmen());
  PRUEF(zyklen_gezaehlt == 2600);
  return summe;
}

}  // namespace

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  const AbfangZahlen s0 = lauf(0, "test_kern_arr_warp_alloc_s");
  const AbfangZahlen s2 = lauf(2, "test_kern_arr_warp_alloc_f");
  const AbfangZahlen sb = lauf_beats("test_kern_arr_warp_alloc_b");
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  std::printf("Positiv-Kontrolle: %ld\n", positiv);
  PRUEF(positiv >= 1);
  PRUEF(s0.alloc == 0 && s0.sperren == 0 && s0.schlafen == 0);   // synchron: Callback und Werk
  PRUEF(s2.alloc == 0 && s2.sperren == 0 && s2.schlafen == 0);   // Fäden: der Callback
  PRUEF(sb.alloc == 0 && sb.frei == 0 && sb.sperren == 0 && sb.schlafen == 0);   // Slice 4: BEATS
  PRUEF_ENDE();
}
