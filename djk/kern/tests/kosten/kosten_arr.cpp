// D1 K1 Slice 11 (A10): Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples) mit spielendem Arrangement, als
// Vergleich gegen die Lage ohne Arrangement im selben Lauf. Lagen, je N Zyklen nach 2 000 zum Einschwingen:
//   ohne   kein Arrangement geladen (wie kern_kosten31 „ohne“)
//   arr3   drei Spuren: Audio (Kick-Impulse je Beat, 0,1 s), intern und Wirt (je 16 Noten je Takt an Kostensenken ohne
//          Ton, Vorhalt 0 und 537), Loop-Klammer 8 Takte, Metronom an, Fader-Rampe über das Stellwerk
//   arr3rb wie arr3, aber mit den Senken des Kerns (D1 K2b): RB-338 für die interne Spur, Wirt-Slot 1 ohne Wirt
//          (MIDI in den Zyklus-Puffer, Rückweg ohne JACK-Puffer, Messpunkt A4 läuft mit)
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs, dazu eine JSON-Zeile {"lage":…} für die Ablage. Kein Test: die
// Zahlen gehören in den Bericht (Grenze A10, Teil ohne JACK: arr3 p99,9 höchstens ohne p99,9 + 200 µs).
// Aufruf: kern_kosten_arr [zyklen]
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/kern.h"

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

// Senke ohne Ton: zählt nur (die RB-FFI und die Wirt-Slots hängt K2 an)
struct Kostensenke : cdj::ArrSenke {
  int64_t v;
  uint64_t n = 0;
  explicit Kostensenke(int64_t vorhalt) : v(vorhalt) {}
  int64_t vorhalt() const noexcept override { return v; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override { ++n; }
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern{new cdj::Kern(128.0, ring, bef.get(), ere.get())};
  int64_t id = 1;
  cdj::Befehl neu(int art) {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "andreas");
    return b;
  }
  void zyklus() {
    kern->zyklus(256, jetzt_ns());
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
};

static void bericht(const char* name, std::vector<double>& us) {
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, (size_t)(p * us.size()))]; };
  std::printf("%-5s Zyklen %zu: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", name, us.size(), q(0.5),
              q(0.99), q(0.999), us.back());
  std::printf("{\"lage\":\"%s\",\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f}\n", name,
              us.size(), q(0.5), q(0.99), q(0.999), us.back());
}

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  const std::string ordner = "/dev/shm/kern_kosten_arr_" + std::to_string(getpid());
  std::filesystem::create_directories(ordner + "/audio");
  const std::string sha(64, 'c');
  {
    std::vector<float> kick(2 * 4800, 0.0f);
    for (int i = 0; i < 4800; ++i) kick[2 * i] = kick[2 * i + 1] = 0.5f * (1.0f - i / 4800.0f);
    std::ofstream(ordner + "/audio/" + sha + ".f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(kick.data()), (std::streamsize)(kick.size() * sizeof(float)));
  }
  std::string clips, noten;
  for (int b = 0; b < 32; ++b) {
    char c[400];
    std::snprintf(c, sizeof c,
                  "%s{\"id\":\"k%d\",\"start_beat\":%d.0,\"laenge_beats\":0.2,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                  "\"frames\":4800,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}",
                  b ? "," : "", b, b, sha.c_str(), ordner.c_str(), sha.c_str());
    clips += c;
  }
  for (int i = 0; i < 128; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) +
             ",\"laenge\":0.2,\"ton\":" + std::to_string(36 + i % 24) + ",\"vel\":100}";
  std::ofstream(ordner + "/wiedergabe-1.json")
      << "{\"format\":\"cypherdj-arr/1\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" << clips
      << "]},{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" << noten
      << "]},{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" << noten << "]}]}";
  cdj::SpeicherKonto konto(3800LL << 20);
  cdj::ArrAudioCache cache(&konto, 1024LL << 20, true);
  for (const char* lage : {"ohne", "arr3", "arr3rb"}) {
    Lauf l;
    Kostensenke intern(0), wirt(2 * 256 + 25);
    const bool eigene = std::string(lage) == "arr3rb";   // D1 K2b: die Senken des Kerns (RB-338, Wirt-Slot 1 ohne Wirt)
    if (!eigene) {
      l.kern->setze_arr_senke_intern(&intern);
      l.kern->setze_arr_senke_wirt(1, &wirt);
    }
    cdj::Befehl f = l.neu(cdj::Befehl::TEIL);   // erz/4 offen wie im Betrieb (Spec 2.3)
    std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader");
    f.politik = 1;
    l.bef->schiebe(f);
    if (std::string(lage) != "ohne") {
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, 1, cache);
      if (!e.snap) {
        std::fprintf(stderr, "kosten_arr: %s\n", e.meldung.c_str());
        return 1;
      }
      cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN);
      b.zeiger = e.snap.release();
      b.arr_nr = 1;
      l.bef->schiebe(b);
      cdj::Befehl lp = l.neu(cdj::Befehl::ARR_LOOP);
      lp.an = 1;
      lp.arr_von = 0.0;
      lp.arr_bis = 32.0;
      l.bef->schiebe(lp);
      cdj::Befehl m = l.neu(cdj::Befehl::ARR_METRONOM);
      m.an = 1;
      m.wert = -12.0f;
      l.bef->schiebe(m);
      cdj::Befehl s = l.neu(cdj::Befehl::ARR_START);
      l.bef->schiebe(s);
      cdj::Befehl r = l.neu(cdj::Befehl::TEIL);   // Fader-Rampe: Verlauf je Sample ins Modul
      std::snprintf(r.pfad, sizeof r.pfad, "spur/1/fader");
      r.wert = -6.0f;
      r.ab_beat = 8.0;
      r.dauer_beats = 64.0;
      r.politik = 1;
      l.bef->schiebe(r);
    }
    for (int i = 0; i < 2000; ++i) l.zyklus();
    std::vector<double> us;
    us.reserve(n);
    for (int i = 0; i < n; ++i) {
      const int64_t t0 = jetzt_ns();
      l.kern->zyklus(256, t0);
      us.push_back((jetzt_ns() - t0) / 1000.0);
      if (std::getenv("KOSTEN_SPUR") && us.back() > 1000.0)   // Diagnose: langsame Zyklen mit Lage im Projekt
        std::fprintf(stderr, "langsam: Zyklus %d, %.0f µs, Kern-Beat %.3f\n", i, us.back(),
                     l.kern->karte().beat_at((double)l.kern->sample()));
      cdj::Ereignis e;
      while (l.ere->hole(e)) {}
    }
    bericht(lage, us);
    if (eigene)
      std::fprintf(stderr, "%s: RB-338 verloren %llu, Parameter abgelehnt %llu\n", lage,
                   (unsigned long long)l.kern->arr_rb().verloren(), (unsigned long long)l.kern->arr_rb().parameter_abgelehnt());
    else
      std::fprintf(stderr, "%s: Noten intern %llu, Wirt %llu\n", lage, (unsigned long long)intern.n, (unsigned long long)wirt.n);
  }
  std::filesystem::remove_all(ordner);
  return 0;
}
