// D1 K1 Slice 11 (A10): Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples) mit spielendem Arrangement, als
// Vergleich gegen die Lage ohne Arrangement im selben Lauf. Lagen, je N Zyklen nach 2 000 zum Einschwingen:
//   ohne   kein Arrangement geladen (wie kern_kosten31 „ohne“)
//   arr3   drei Spuren: Audio (Kick-Impulse je Beat, 0,1 s), intern und Wirt (je 16 Noten je Takt an Kostensenken ohne
//          Ton, Vorhalt 0 und 537), Loop-Klammer 8 Takte, Metronom an, Fader-Rampe über das Stellwerk
//   arr3rb wie arr3, aber mit den Senken des Kerns (D1 K2b): RB-338 für die interne Spur, Wirt-Slot 1 ohne Wirt
//          (MIDI in den Zyklus-Puffer, Rückweg ohne JACK-Puffer, Messpunkt A4 läuft mit)
//   hand   wie arr3 (Senken ohne Ton), dazu hält ein Mensch einen Regler (erz/3/fader): alle 500 Zyklen ein neuer Griff
//          (/test/hand), die Rückgabe nach 32 Beats kommt nie. Damit ist n_mensch_ > 0 und der Rueck-Pfad des
//          Stellwerks (Stapelfeld Rueck rueck[MAX_REGLER], ablauf.cpp) läuft in jedem Zyklus (E1, Deckel-Messung).
//   arr32  E3 Task 9: 32 belegte Spuren mit den Senken des Kerns: Spur 1 bis 24 RB-338 (je Beat vier Sechzehntel), Spur 25 bis
//          32 Audio (je ein durchlaufender Clip über die ganze Schleife), Loop-Klammer 8 Takte, Metronom an. Alle 32
//          Spur-Fader haben einen Verlauf (Start nach dem Einschwingen, Beat 24, über 240 Beats). Auf Spur 3 liegt ein
//          Solo-Verlauf: alle 4 Beats ein Solo für eine Sechzehntel (ein Schalter nimmt keine Rampe, das Stellwerk lehnt sie ab).
//          Der Solo-Verlauf besteht nur im Block der Schaltung (regler.cpp:152 schaltet ohne Schaltrampe): der Solo-Scan
//          (arr_ausgang.cpp, solo_vl) läuft in etwa 114 von 20 000 Zyklen. Der Median enthält ihn nicht; die Lage meldet die
//          Schalt-Blöcke getrennt (Zeile „arr32: Solo-Schaltblöcke“).
//   arr32g 1.10 Task 15: wie arr32 (32 klingende Spuren, Spur-Rampen, Solo auf Spur 3), aber mit Wiedergabe /2: die 32 Spuren
//          laufen in 8 Gruppen zu je 4 Spuren (Spur sp in Gruppe (sp-1)%8+1), alle Gruppen in den PM. Dazu Rampen an den 8
//          Gruppen-Fadern (Ziel −1 − g%3 dB) und am PM-Fader (−2 dB), Beat 24 über 240 Beats. Selbstprüfung wie arr32, dazu
//          muss der Fader von Gruppe 1 und der PM-Fader am Ende unter 0 dB stehen (sonst Ende 2).
//   arr32au  Paket 1.13 Slice 2 (AK31): Grundlinie für arr32warp: 32 Audio-Spuren (4 Spuren je Quelle, 8 Töne), Loop-Klammer 16 Beats, ungewarpt, dazu die Keylock-Last
//   KOSTEN_WARP_PITCH=<Faktor>: arr32warp mit transponierten Clips (Slice 5); ohne: pitch 1
//   arr32warp wie arr32au, aber jede Spur ein COMPLEX-Clip auf 125-BPM-Quellen im 128er Kern, das Warp-Werk mit 4 Arbeitsfäden hängt am Kern. Keylock-Last (beide Lagen):
//          sechs Bungee-Dehner (4 Decks + 2 Boxen nachgebildet) rechnen im selben Faden nach jedem Zyklus und werden aus ihren Ringen gelesen, so teilen sie sich Kerne,
//          Caches und Speicherbandbreite mit dem Kern und dem Werk (die echten Decks und Boxen sind Sache der Zielabnahme). Gemeldet: Kern-Zyklus, Last und Summe
//          getrennt (p50/p99/p99,9/max), der Zuwachs der Summe gegen arr32au (Grenze 150 µs bei p99,9), Unterlauf, spät, kein Platz, CPU je Werk-Faden. Die Selbstprüfung
//          endet mit 2, wenn nicht 32 Stimmen im Werk klingen, die Last nicht läuft, der Zuwachs bei mindestens 20 000 Zyklen über 150 µs liegt (das Tor von AK31; darunter
//          ist p99,9 zu grob und der Zuwachs nur gemeldet; KOSTEN_TOR_ZYKLEN und KOSTEN_GRENZE_US stellen es für den Kontrolllauf um) oder KOSTEN_PRIO unter 7 liegt (dann liefen
//          die Fäden des Werks nicht unter dem Hauptfaden) oder in einem Tor-Lauf (mindestens 20 000 Zyklen) die Priorität nicht wirkt (KOSTEN_PRIO fehlt, SCHED_FIFO nicht gesetzt oder ein
//          Werk-Faden ohne Priorität: die Zahlen stammen dann aus SCHED_OTHER). KOSTEN_WARP_HALT=1: Kontrolllauf, das Werk steht nach 2 000 Zyklen; Unterlauf MUSS dann zählen (sonst misst die Lage nichts).
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs, dazu eine JSON-Zeile {"lage":…} für die Ablage. Kein Test: die
// Zahlen gehören in den Bericht (Grenze A10, Teil ohne JACK: arr3 p99,9 höchstens ohne p99,9 + 200 µs).
// Aufruf: kern_kosten_arr [zyklen [lagen]]   lagen: Komma-Liste, Vorgabe alle (ohne,arr3,arr3rb,hand); eine unbekannte
// Lage beendet das Programm mit 3 (sonst misst ein Tippfehler nichts und meldet Erfolg)
// Lage arr32 prüft sich selbst und endet mit 2, wenn: nach 100 Zyklen weniger als 32 Spuren klingen (Spitze je Spur
// > −120 dBFS), ein Teil abgelehnt wurde (Quittung 6), einer der 32 Fader am Ende keinen Verlauf hat (Wert 0 dB) oder die
// beobachteten Solo-Schaltungen von Spur 3 unter der erwarteten Zahl liegen (114, bei KOSTEN_ARR32_SOLO_EIN genau 1). KOSTEN_ARR32_STUMM=<nr>: Kontrolllauf, Spur <nr> wird stumm geschaltet, die
// Selbstprüfung muss anschlagen.
// Lage hand prüft sich selbst: sieht sie kein Halter-Ereignis „mensch“, endet das Programm mit 2 (sonst misst sie nichts).
// KOSTEN_HAND_RUECK=1: Kontrolllauf der Lage hand ohne neue Griffe, die Rückgabe nach 32 Beats muss als Halter „frei“
// kommen (zeigt, dass die Rückgabe-Schleife eine Rückgabe findet).
#include <sched.h>
#include <time.h>
#include <unistd.h>

#include <cerrno>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/dehner.h"
#include "cypherdj/kern.h"
#include "cypherdj/warp_werk.h"

namespace {
constexpr double KLANG_ANTEIL_MIN = 0.9;   // arr32: kleinster Anteil klingender Pegel-Meldungen je Spur
}

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


// ---- 1.13 Slice 2 (AK31): arr32au und arr32warp --------------------------------------------------------------------------
namespace {

constexpr int64_t WARP_FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle

// Das Band einer nachgebildeten Keylock-Quelle: ein Ton, Basis 128
struct LastQuelle : cdj::DehnerQuelle {
  float hz;
  explicit LastQuelle(float h) : hz(h) {}
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) l[i] = r[i] = 0.2f * std::sin(6.2831853f * hz * static_cast<float>((ab + i) % 480000) / 48000.0f);
  }
  double basis_bpm() const noexcept override { return 128.0; }
};

struct Last {   // sechs Bungee-Dehner wie 4 Decks und 2 Boxen
  std::vector<std::unique_ptr<cdj::DehnerBasis>> d;
  std::vector<LastQuelle> q;
  std::vector<float> l, r;
  int64_t s = 0;
  Last() : l(256), r(256) {
    for (int i = 0; i < 6; ++i) q.emplace_back(180.0f + 40.0f * static_cast<float>(i));
  }
  bool baue(const cdj::Karte& k, int64_t s_h) {
    cdj::DehnerOptionen o;
    o.maschine = cdj::DehnerMaschine::Bungee;
    o.bungee_fein = false;
    for (int i = 0; i < 6; ++i) {
      d.push_back(cdj::dehner_neu(i + 1, o));
      if (!d.back()) return false;
    }
    s = s_h;
    for (int i = 0; i < 6; ++i) {
      cdj::AnsatzAuftrag a;
      a.quelle = &q[static_cast<size_t>(i)];
      a.s_h = s_h;
      a.anker = {k.beat_at(static_cast<double>(s_h)), 0.0};
      a.karte = k;
      a.generation = 1;
      d[static_cast<size_t>(i)]->ansetzen(a);
      cdj::KartenStand ks;
      ks.karte = k;
      ks.anker = a.anker;
      ks.generation = 1;
      d[static_cast<size_t>(i)]->karte_veroeffentlichen(ks);
      d[static_cast<size_t>(i)]->ring().setze_epoche(d[static_cast<size_t>(i)]->epoche());
    }
    return true;
  }
  // ein Zyklus: füllen und 256 Frames aus jedem Ring nehmen (wie der Callback einer Quelle); false: ein Ring war leer
  bool zyklus() {
    bool ok = true;
    for (auto& x : d) {
      x->fuelle_synchron();
      if (s >= 0 && x->ring().lies_bis(s, 256, l.data(), r.data()) != 256) ok = false;
    }
    s += 256;
    return ok;
  }
};

void bericht_zeile(const char* lage, const char* was, std::vector<double>& us) {
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, static_cast<size_t>(p * static_cast<double>(us.size())))]; };
  std::printf("%-9s %-6s Zyklen %zu: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", lage, was, us.size(), q(0.5), q(0.99), q(0.999), us.back());
  std::printf("{\"lage\":\"%s\",\"was\":\"%s\",\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f}\n", lage, was, us.size(), q(0.5), q(0.99),
              q(0.999), us.back());
}

double p999(std::vector<double> us) {
  std::sort(us.begin(), us.end());
  return us[std::min(us.size() - 1, static_cast<size_t>(0.999 * static_cast<double>(us.size())))];
}

// Rückgabe: 0 gut, 2 Selbstprüfung gescheitert; summe_p999 und cpu_je_faden werden gefüllt. tor: der Lauf ist ein Tor von AK31 (genug Zyklen); dann muss die Priorität wirken
int warp_lage(const char* lage, int n, bool tor, const std::string& ordner, cdj::SpeicherKonto& konto, cdj::ArrAudioCache& cache, double& summe_p999) {
  const bool warp = std::string(lage) == "arr32warp";
  const bool halt = std::getenv("KOSTEN_WARP_HALT") != nullptr;
  const char* pe = std::getenv("KOSTEN_WARP_PITCH");
  const std::string pitchfeld = (warp && pe) ? std::string(",\"pitch\":") + pe : std::string();
  const int nr = warp ? 4 : 5;
  {  // Wiedergabe /2: 32 Audio-Spuren, 4 Spuren je Quelle, ein Clip über die Klammer (16 Beats)
    std::string j = "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[";
    for (int sp = 1; sp <= 32; ++sp) {
      const std::string sha = std::string(63, 'e') + "0123456789abcdef"[(sp - 1) % 8];
      char c[700];
      std::snprintf(c, sizeof c,
                    "%s{\"nr\":%d,\"art\":\"audio\",\"clips\":[{\"id\":\"w%d\",\"start_beat\":0.0,\"laenge_beats\":16.0,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                    "\"frames\":%lld,\"offset_frames\":0,\"gain_db\":-12.0,\"ein_beats\":0.0,\"aus_beats\":0.0%s}]}",
                    sp > 1 ? "," : "", sp, sp, sha.c_str(), ordner.c_str(), sha.c_str(), static_cast<long long>(17 * WARP_FPB125),
                    warp ? (std::string(",\"warp\":{\"modus\":2") + pitchfeld + ",\"w\":[[0,0],[16," + std::to_string(16 * WARP_FPB125) + "]]}").c_str() : "");
      j += c;
    }
    j += "]}";
    std::ofstream(ordner + "/wiedergabe-" + std::to_string(nr) + ".json") << j;
  }
  Lauf l;
  std::unique_ptr<cdj::WarpWerk> werk;
  if (warp) {
    werk = cdj::warp_werk_neu({4});
    if (!werk) {
      std::fprintf(stderr, "kosten_arr: %s: kein Warp-Werk (ohne Bungee gebaut)\n", lage);
      return 2;
    }
    l.kern->setze_arr_warp_werk(werk.get());
  }
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, nr, cache);
  if (!e.snap) {
    std::fprintf(stderr, "kosten_arr: %s: %s\n", lage, e.meldung.c_str());
    return 2;
  }
  cdj::Befehl f = l.neu(cdj::Befehl::TEIL);   // erz/4 offen wie im Betrieb
  std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader");
  f.politik = 1;
  l.bef->schiebe(f);
  cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN);
  b.zeiger = e.snap.release();
  b.arr_nr = nr;
  l.bef->schiebe(b);
  cdj::Befehl lp = l.neu(cdj::Befehl::ARR_LOOP);
  lp.an = 1;
  lp.arr_von = 0.0;
  lp.arr_bis = 16.0;
  l.bef->schiebe(lp);
  cdj::Befehl st = l.neu(cdj::Befehl::ARR_START);
  l.bef->schiebe(st);
  // KOSTEN_PRIO=P: der Hauptfaden (Kern und Last) läuft mit SCHED_FIFO P, die Fäden des Werks mit P − 6 (wie im Betrieb: JACK-Priorität und JACK − 6); ohne die Variable
  // SCHED_OTHER. Auf einer Maschine mit Fremdlast (loadavg) streuen die Zahlen ohne Priorität um ein Vielfaches (gemessen im Plan, Task 9). Mit P unter 7 hebt das Werk
  // seine Fäden auf 1 an (max(1, P − 6)): sie liefen dann auf der Priorität des Hauptfadens und nicht darunter, die Lage misst nicht die Ordnung des Betriebs (rc 2).
  // Ein Tor (tor) braucht die Ordnung des Betriebs: ohne KOSTEN_PRIO, bei einem gescheiterten sched_setscheduler oder wenn ein Faden des Werks seine Priorität nicht bekam,
  // läuft die Lage unter SCHED_OTHER oder mit Fäden auf der Priorität des Hauptfadens, und ein bestandenes Tor wäre eine Messung aus einer anderen Lage (rc 2). Unter dem Tor
  // (wenige Zyklen) bleibt es bei einem Hinweis: dort misst ohnehin niemand eine Grenze.
  bool prio_falsch = false, prio_wirkt = false;
  if (const char* pr = std::getenv("KOSTEN_PRIO")) {
    sched_param sp{};
    sp.sched_priority = std::atoi(pr);
    const bool gesetzt = sched_setscheduler(0, SCHED_FIFO, &sp) == 0 && sched_getscheduler(0) == SCHED_FIFO;
    if (!gesetzt) std::fprintf(stderr, "kosten_arr: SCHED_FIFO %d nicht gesetzt: %s\n", sp.sched_priority, std::strerror(errno));
    const int fehl = werk ? werk->prioritaet(sp.sched_priority) : 0;
    prio_wirkt = gesetzt && fehl == 0;
    if (werk && sp.sched_priority < 7) {
      std::fprintf(stderr, "kosten_arr: %s: KOSTEN_PRIO %d unter 7: die Fäden des Werks laufen nicht unter dem Hauptfaden, die Lage misst nicht die Ordnung des Betriebs\n", lage,
                   sp.sched_priority);
      prio_falsch = true;
    }
  }
  if (!prio_wirkt) {
    std::fprintf(stderr, "kosten_arr: %s: keine Echtzeit-Priorität (KOSTEN_PRIO fehlt, SCHED_FIFO nicht gesetzt oder ein Werk-Faden ohne Priorität): die Zahlen stammen aus SCHED_OTHER%s\n", lage,
                 tor ? ", das Tor von AK31 gilt so nicht (rc 2)" : "");
    if (tor) prio_falsch = true;
  }
  Last last;
  int rc = prio_falsch ? 2 : 0;
  for (int i = 0; i < 6; ++i) l.zyklus();   // Laden, Einsatz (mit Werk 2 048 Samples später) und erste Stimmen
  if (!last.baue(l.kern->karte(), l.kern->sample() + 8192)) {
    std::fprintf(stderr, "kosten_arr: %s: keine Bungee-Dehner für die Last (ohne Bungee gebaut)\n", lage);
    return 2;
  }
  std::vector<double> us_kern, us_last, us_summe;
  us_kern.reserve(static_cast<size_t>(n));
  us_last.reserve(static_cast<size_t>(n));
  us_summe.reserve(static_cast<size_t>(n));
  uint64_t last_leer = 0;
  // Echtzeit-Takt: die Fäden des Werks rechnen in Wanduhrzeit, also läuft auch dieser Zyklus im Takt von 256 Samples (5,333 ms), nicht so schnell wie möglich;
  // sonst bekäme das Werk ein Sechstel der Zeit und meldete Ausfälle, die es im Betrieb nicht gibt (gemessen: 4 000 Zyklen ungetaktet, 16 Unterläufe)
  timespec naechster;
  clock_gettime(CLOCK_MONOTONIC, &naechster);
  for (int i = 0; i < 2000 + n; ++i) {
    naechster.tv_nsec += 5'333'333;
    if (naechster.tv_nsec >= 1'000'000'000) {
      naechster.tv_nsec -= 1'000'000'000;
      ++naechster.tv_sec;
    }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &naechster, nullptr);
    if (halt && i == 2000 && werk) werk->test_halte(true);
    const int64_t t0 = jetzt_ns();
    l.kern->zyklus(256, t0);
    const int64_t t1 = jetzt_ns();
    const bool ok = last.zyklus();
    const int64_t t2 = jetzt_ns();
    cdj::Ereignis ev;
    while (l.ere->hole(ev)) {
      if (ev.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(ev.zeiger)), cache);
    }
    if (i < 2000) continue;   // Einschwingen
    last_leer += ok ? 0 : 1;
    us_kern.push_back(static_cast<double>(t1 - t0) / 1000.0);
    us_last.push_back(static_cast<double>(t2 - t1) / 1000.0);
    us_summe.push_back(static_cast<double>(t2 - t0) / 1000.0);
  }
  const cdj::Arrangement& a = l.kern->arrangement();
  std::printf("%s: Stimmen im Werk %d, Unterlauf %llu, spät %llu, kein Platz %llu, Last-Ringe leer in %llu Zyklen\n", lage, a.werk_stimmen(),
              static_cast<unsigned long long>(a.warp_unterlauf()), static_cast<unsigned long long>(a.warp_spaet()), static_cast<unsigned long long>(a.warp_kein_platz()),
              static_cast<unsigned long long>(last_leer));
  bericht_zeile(lage, "kern", us_kern);
  bericht_zeile(lage, "last", us_last);
  summe_p999 = p999(us_summe);
  bericht_zeile(lage, "summe", us_summe);
  if (werk) {
    werk->stoppe();
    std::printf("%s\n", werk->schluss_json().c_str());
  }
  if (warp && !halt && a.werk_stimmen() != 32) {
    std::fprintf(stderr, "kosten_arr: %s: %d statt 32 Stimmen im Werk, die Lage misst nicht, was sie soll\n", lage, a.werk_stimmen());
    rc = 2;
  }
  if (last_leer > static_cast<uint64_t>(n) / 100) {
    std::fprintf(stderr, "kosten_arr: %s: die nachgebildeten Decks und Boxen blieben in %llu Zyklen ohne Ring-Inhalt, die Last ist keine\n", lage, static_cast<unsigned long long>(last_leer));
    rc = 2;
  }
  if (warp && halt && a.warp_unterlauf() == 0) {
    std::fprintf(stderr, "kosten_arr: %s: Kontrolllauf KOSTEN_WARP_HALT ohne Unterlauf, das Instrument sieht den Ausfall nicht\n", lage);
    rc = 2;
  }
  if (warp && !halt && (a.warp_unterlauf() != 0 || a.warp_kein_platz() != 0))
    std::fprintf(stderr, "kosten_arr: %s: Unterlauf %llu, kein Platz %llu (Ziel: 0)\n", lage, static_cast<unsigned long long>(a.warp_unterlauf()),
                 static_cast<unsigned long long>(a.warp_kein_platz()));
  return rc;
}

}  // namespace

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  const std::string lagen = argc > 2 ? std::string(",") + argv[2] + "," : "";
  for (size_t a = 0; !lagen.empty() && a + 1 < lagen.size();) {   // jede genannte Lage muss es geben
    const size_t b = lagen.find(',', a + 1);
    const std::string eine = lagen.substr(a + 1, b - a - 1);
    if (!eine.empty() && eine != "ohne" && eine != "arr3" && eine != "arr3rb" && eine != "hand" && eine != "arr32" && eine != "arr32g" && eine != "arr32au" && eine != "arr32warp") {
      std::fprintf(stderr, "kosten_arr: unbekannte Lage \"%s\"\n", eine.c_str());
      return 3;
    }
    a = b;
  }
  const bool nur_rueck = std::getenv("KOSTEN_HAND_RUECK") != nullptr;
  const std::string ordner = "/dev/shm/kern_kosten_arr_" + std::to_string(getpid());
  std::filesystem::create_directories(ordner + "/audio");
  const std::string sha(64, 'c');
  const bool will32 = lagen.empty() || lagen.find(",arr32,") != std::string::npos || lagen.find(",arr32g,") != std::string::npos;
  struct Aufraeumen {   // Ende 1, 2 oder 3 und Normalende räumen gleich auf (arr32 legt 8 x 5,8 MB in /dev/shm ab)
    std::string d;
    ~Aufraeumen() { std::error_code ec; std::filesystem::remove_all(d, ec); }
  } aufraeumen{ordner};
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
  {   // arr32: 24 RB-338 (Spur 1 bis 24), 8 Audio (Spur 25 bis 32) mit je einem Clip über die ganze Schleife (32 Beats)
    constexpr int FRAMES32 = 720'000;   // 32 Beats bei 128 BPM und 48 kHz = 15 s
    // 8 verschiedene Dateien (der Cache ist nach sha geschlüsselt und hält je sha einen Puffer): je Spur eine eigene sha
    // und eine eigene Tonhöhe, sonst lesen 8 Spuren dieselben Adressen
    const auto sha32_von = [](int sp) { return std::string(63, 'd') + "0123456789abcdef"[sp - 25]; };
    for (int sp = 25; will32 && sp <= 32; ++sp) {
      std::vector<float> ton(2 * (size_t)FRAMES32);
      const float hz = 220.0f * (1.0f + 0.05f * (float)(sp - 25));
      for (int i = 0; i < FRAMES32; ++i) ton[2 * i] = ton[2 * i + 1] = 0.3f * std::sin(6.2831853f * hz * i / 48000.0f);
      std::ofstream(ordner + "/audio/" + sha32_von(sp) + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(ton.data()), (std::streamsize)(ton.size() * sizeof(float)));
    }
    const auto bau32 = [&](int nr, bool mit_gruppen) {   // 1.10: nr 2 ohne Gruppen (/1), nr 3 mit 8 Gruppen zu je 4 Spuren (/2)
    std::string j = std::string("{\"format\":\"") + (mit_gruppen ? "cypherdj-arr/2" : "cypherdj-arr/1") + "\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[";
    for (int sp = 1; sp <= 32; ++sp) {
      j += (sp > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(sp);
      if (mit_gruppen) j += ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string((sp - 1) % 8 + 1) + "}";   // 8 Gruppen zu je 4 Spuren
      if (sp <= 24) {
        j += ",\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[";
        for (int i = 0; i < 128; ++i)   // vier Sechzehntel je Beat, 32 Beats; Tonhöhe je Spur versetzt
          j += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) +
               ",\"laenge\":0.2,\"ton\":" + std::to_string(36 + (i + sp) % 24) + ",\"vel\":100}";
        j += "]";
      } else {
        char c[400];
        std::snprintf(c, sizeof c,
                      ",\"art\":\"audio\",\"clips\":[{\"id\":\"d%d\",\"start_beat\":0.0,\"laenge_beats\":32.0,\"sha256\":\"%s\","
                      "\"datei\":\"%s/audio/%s.f32\",\"frames\":%d,\"offset_frames\":0,\"gain_db\":-6.0,\"ein_beats\":0.0,"
                      "\"aus_beats\":0.0}",
                      sp, sha32_von(sp).c_str(), ordner.c_str(), sha32_von(sp).c_str(), FRAMES32);
        j += c;
        j += "]";
      }
      j += "}";
    }
    j += "]";
    if (mit_gruppen) {
      j += ",\"gruppen\":[";
      for (int g = 1; g <= 8; ++g) j += (g > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(g) + ",\"ausgang\":{\"art\":\"master\"}}";
      j += "]";
    }
    j += "}";
    return j;
    };
    if (will32) {
      std::ofstream(ordner + "/wiedergabe-2.json") << bau32(2, false);
      std::ofstream(ordner + "/wiedergabe-3.json") << bau32(3, true);
    }
  }
  cdj::SpeicherKonto konto(3800LL << 20);
  cdj::ArrAudioCache cache(&konto, 1024LL << 20, true);
  const bool will_au = lagen.find(",arr32au,") != std::string::npos, will_warp = lagen.find(",arr32warp,") != std::string::npos;
  if (will_au || will_warp) {   // Slice 2: acht Töne zu je 17 Quell-Beats (125 BPM), geteilt von vier Spuren
    for (int q = 0; q < 8; ++q) {
      std::vector<float> ton(2 * static_cast<size_t>(17 * WARP_FPB125));
      const float hz = 220.0f * (1.0f + 0.07f * static_cast<float>(q));
      for (size_t i = 0; i < ton.size() / 2; ++i) ton[2 * i] = ton[2 * i + 1] = 0.3f * std::sin(6.2831853f * hz * static_cast<float>(i) / 48000.0f);
      std::ofstream(ordner + "/audio/" + std::string(63, 'e') + "0123456789abcdef"[q] + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(ton.data()), static_cast<std::streamsize>(ton.size() * sizeof(float)));
    }
    double p_au = -1.0, p_warp = -1.0;
    int rc = 0;
    // Das Tor gilt ab KOSTEN_TOR_ZYKLEN (Vorgabe 20 000) Zyklen: darunter liegen nur wenige Zyklen jenseits von p99,9, der Zuwachs streut von −12 bis +382 µs (Plan, Task 8).
    // KOSTEN_GRENZE_US (Vorgabe 150, die Grenze von AK31) und KOSTEN_TOR_ZYKLEN gibt es für den Kontrolllauf des Tors.
    const char* e_tor = std::getenv("KOSTEN_TOR_ZYKLEN");
    const char* e_grenze = std::getenv("KOSTEN_GRENZE_US");
    const bool tor = n >= (e_tor ? std::atoi(e_tor) : 20'000);
    const double grenze = e_grenze ? std::atof(e_grenze) : 150.0;
    if (will_au) rc = std::max(rc, warp_lage("arr32au", n, tor, ordner, konto, cache, p_au));
    if (will_warp) rc = std::max(rc, warp_lage("arr32warp", n, tor, ordner, konto, cache, p_warp));
    if (p_au >= 0 && p_warp >= 0) {
      const double zuwachs = p_warp - p_au;
      std::printf("Zuwachs p99,9 (Kern + Last) arr32warp gegen arr32au: %.1f µs (Grenze %.0f µs%s)\n", zuwachs, grenze, tor ? "" : "; unter 20 000 Zyklen nur gemeldet, kein Tor");
      if (tor && zuwachs > grenze) {
        std::fprintf(stderr, "kosten_arr: AK31: der Zuwachs %.1f µs liegt über %.0f µs (p99,9, %d Zyklen)\n", zuwachs, grenze, n);
        rc = std::max(rc, 2);
      }
    }
    if (rc) return rc;
  }
  for (const char* lage : {"ohne", "arr3", "arr3rb", "hand", "arr32", "arr32g"}) {
    if (!lagen.empty() && lagen.find(std::string(",") + lage + ",") == std::string::npos) continue;
    Lauf l;
    const bool hand = std::string(lage) == "hand";
    uint64_t halter_mensch = 0, halter_frei = 0, hand_ereignisse = 0;
    const bool g32 = std::string(lage) == "arr32g";   // 1.10: wie arr32, dazu 8 Gruppen und der PM
    const bool a32 = std::string(lage) == "arr32" || g32;
    const int stumm_nr = std::getenv("KOSTEN_ARR32_STUMM") ? std::atoi(std::getenv("KOSTEN_ARR32_STUMM")) : 0;
    float spitze_db[33], zuletzt_db[33];   // arr32: höchste Spur-Spitze seit Zyklus 100 je Spur (dB)
    for (float& x : spitze_db) x = -1000.0f;
    for (float& x : zuletzt_db) x = -1000.0f;
    uint64_t meld_n[33] = {}, klang_n[33] = {};   // arr32: Pegel-Meldungen seit Zyklus 100 je Spur, davon klingende (> -120 dB)
    int zyk = 0;
    uint64_t solo_schaltungen = 0;       // arr32: Blöcke, in denen sich der Solo-Wert von Spur 3 änderte (= Blöcke mit solo_vl)
    float solo_vorher = 0.0f;
    std::vector<double> us_solo;         // arr32: Dauer genau dieser Blöcke
    uint64_t quittung_status[8] = {};   // arr32: Quittungen der Teile je Status (6 = abgelehnt)
    auto leeren = [&] {
      cdj::Ereignis e;
      while (l.ere->hole(e)) {
        if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "erz/3/fader")) {
          if (!std::strcmp(e.text, "mensch")) ++halter_mensch;
          else if (!std::strcmp(e.text, "frei")) ++halter_frei;
        } else if (e.art == cdj::Ereignis::HAND) {
          ++hand_ereignisse;
        } else if (a32 && e.art == cdj::Ereignis::QUITTUNG) {
          if (e.status >= 0 && e.status < 8) ++quittung_status[e.status];
          if (e.status == 6) std::fprintf(stderr, "arr32: abgelehntes Teil id %lld, Grund \"%s\" / \"%s\"\n", (long long)e.id, e.text, e.pfad);
        } else if (a32 && e.art == cdj::Ereignis::PEGEL && zyk >= 100 && !std::strncmp(e.pfad, "spur/", 5)) {
          const int nr = std::atoi(e.pfad + 5);
          if (nr >= 1 && nr <= 32) {
            spitze_db[nr] = std::max(spitze_db[nr], e.pegel[0]);
            zuletzt_db[nr] = e.pegel[0];
            ++meld_n[nr];
            if (e.pegel[0] > -120.0f) ++klang_n[nr];
          }
        }
      }
    };
    const auto griff = [&](float x) {   // /test/hand wie aus dem Netz: ein Regler unter Menschenhand
      cdj::Befehl h = l.neu(cdj::Befehl::HAND);
      h.id = 0;
      std::snprintf(h.pfad, sizeof h.pfad, "erz/3/fader");
      h.wert = x;
      h.sample = l.kern->sample();
      l.bef->schiebe(h);
    };
    Kostensenke intern(0), wirt(2 * 256 + 25);
    const bool eigene = std::string(lage) == "arr3rb" || a32;   // D1 K2b: die Senken des Kerns (RB-338, Wirt-Slot 1 ohne Wirt)
    if (!eigene) {
      l.kern->setze_arr_senke_intern(&intern);
      l.kern->setze_arr_senke_wirt(1, &wirt);
    }
    cdj::Befehl f = l.neu(cdj::Befehl::TEIL);   // erz/4 offen wie im Betrieb (Spec 2.3)
    std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader");
    f.politik = 1;
    l.bef->schiebe(f);
    if (std::string(lage) != "ohne") {
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, a32 ? (g32 ? 3 : 2) : 1, cache);
      if (!e.snap) {
        std::fprintf(stderr, "kosten_arr: %s\n", e.meldung.c_str());
        return 1;
      }
      cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN);
      b.zeiger = e.snap.release();
      b.arr_nr = a32 ? (g32 ? 3 : 2) : 1;
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
      if (!a32) {
        cdj::Befehl r = l.neu(cdj::Befehl::TEIL);   // Fader-Rampe: Verlauf je Sample ins Modul
        std::snprintf(r.pfad, sizeof r.pfad, "spur/1/fader");
        r.wert = -6.0f;
        r.ab_beat = 8.0;
        r.dauer_beats = 64.0;
        r.politik = 1;
        l.bef->schiebe(r);
      } else {
        // Zyklus 2000 liegt bei Beat 22,8 (128 BPM, 256 Samples je Zyklus, 48 kHz): die Rampen starten bei Beat 24 und
        // laufen über 240 Beats, das Messfenster von 20 000 Zyklen endet bei Beat 250
        for (int sp = 1; sp <= 32; ++sp) {
          cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
          std::snprintf(r.pfad, sizeof r.pfad, "spur/%d/fader", sp);
          r.wert = -3.0f - (float)(sp % 4);
          r.ab_beat = 24.0;
          r.dauer_beats = 240.0;
          r.politik = 1;
          l.bef->schiebe(r);
        }
        if (g32) {   // 1.10: dieselbe Rampenform an den 8 Gruppen-Fadern und am PM-Fader
          for (int g = 1; g <= 8; ++g) {
            cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
            std::snprintf(r.pfad, sizeof r.pfad, "grp/%d/fader", g);
            r.wert = -1.0f - (float)(g % 3);
            r.ab_beat = 24.0;
            r.dauer_beats = 240.0;
            r.politik = 1;
            l.bef->schiebe(r);
          }
          cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
          std::snprintf(r.pfad, sizeof r.pfad, "pm/fader");
          r.wert = -2.0f;
          r.ab_beat = 24.0;
          r.dauer_beats = 240.0;
          r.politik = 1;
          l.bef->schiebe(r);
        }
        // Solo-Verlauf auf Spur 3: ein Schalter nimmt keine Rampe (keine_rampe) und schaltet ohne Schaltrampe (regler.cpp:152,
        // schalt = 0: sofort, am Sample). Alle 4 Beats ein Solo für eine Sechzehntel (Beat 24 bis 24,25, 28 bis 28,25, …): ein
        // Verlauf besteht nur im Block der Schaltung, der Solo-Scan läuft also nur dort (114 Blöcke), die übrigen Spuren klingen
        // fast immer. KOSTEN_ARR32_SOLO_EIN: Kontrolle, ein Solo bleibt an.
        const bool solo_ein = std::getenv("KOSTEN_ARR32_SOLO_EIN") != nullptr;
        for (int k = 0; k < 57; ++k) {
          for (int an = 1; an >= 0; --an) {
            if (solo_ein && (k > 0 || !an)) continue;
            cdj::Befehl so = l.neu(cdj::Befehl::TEIL);
            std::snprintf(so.pfad, sizeof so.pfad, "spur/3/solo");
            so.wert = (float)an;
            so.ab_beat = 24.0 + 4.0 * k + (an ? 0.0 : 0.25);
            so.dauer_beats = 0.0;
            so.politik = 1;
            l.bef->schiebe(so);
          }
        }
        if (stumm_nr >= 1 && stumm_nr <= 32) {   // Kontrolllauf der Selbstprüfung
          cdj::Befehl mu = l.neu(cdj::Befehl::TEIL);
          std::snprintf(mu.pfad, sizeof mu.pfad, "spur/%d/mute", stumm_nr);
          mu.wert = 1.0f;
          mu.politik = 1;
          l.bef->schiebe(mu);
        }
      }
    }
    if (hand) {
      griff(0.50f);   // erster Wert nur Stellung; der zweite übernimmt (§7.3 Punkt 1)
      l.zyklus();
      griff(0.55f);
    }
    for (int i = 0; i < 2000; ++i) {
      l.kern->zyklus(256, jetzt_ns());
      zyk = i + 1;
      leeren();
      if (hand && !nur_rueck && i % 500 == 499) griff(0.50f + 0.05f * ((i / 500) % 2));
    }
    std::vector<double> us;
    us.reserve(n);
    for (int i = 0; i < n; ++i) {
      if (hand && !nur_rueck && i % 500 == 0) griff(0.50f + 0.05f * ((i / 500) % 2));
      const int64_t t0 = jetzt_ns();
      l.kern->zyklus(256, t0);
      us.push_back((jetzt_ns() - t0) / 1000.0);
      ++zyk;
      if (a32) {   // nach der Messung des Zyklus: hat er einen Solo-Verlauf getragen (Wert am Blockende ≠ Wert davor)?
        const float so = l.kern->arrangement().wert(2, 3);
        if ((so >= 0.5f) != (solo_vorher >= 0.5f)) {
          ++solo_schaltungen;
          us_solo.push_back(us.back());
        }
        solo_vorher = so;
      }
      if (std::getenv("KOSTEN_SPUR") && us.back() > 1000.0)   // Diagnose: langsame Zyklen mit Lage im Projekt
        std::fprintf(stderr, "langsam: Zyklus %d, %.0f µs, Kern-Beat %.3f\n", i, us.back(),
                     l.kern->karte().beat_at((double)l.kern->sample()));
      leeren();
    }
    bericht(lage, us);
    if (a32) {
      int klingen = 0;
      for (int sp = 1; sp <= 32; ++sp) {
        if (spitze_db[sp] > -120.0f) ++klingen;
        else std::fprintf(stderr, "kosten_arr: arr32 Spur %d klingt nicht (Spitze %.1f dB)\n", sp, spitze_db[sp]);
      }
      int zuletzt = 0;
      for (int sp = 1; sp <= 32; ++sp) zuletzt += zuletzt_db[sp] > -120.0f;
      std::fprintf(stderr, "arr32: Quittungen je Status 1..7: %llu %llu %llu %llu %llu %llu %llu (6 = abgelehnt)\n",
                   (unsigned long long)quittung_status[1], (unsigned long long)quittung_status[2],
                   (unsigned long long)quittung_status[3], (unsigned long long)quittung_status[4],
                   (unsigned long long)quittung_status[5], (unsigned long long)quittung_status[6],
                   (unsigned long long)quittung_status[7]);
      const bool solo_ein = std::getenv("KOSTEN_ARR32_SOLO_EIN") != nullptr;
      const double ende_beat = l.kern->karte().beat_at((double)l.kern->sample());
      // Alle 32 Fader müssen am Ende MITTEN in der Rampe stehen: linear von 0 dB (Beat 24) zum Ziel (−3 − sp%4 dB) über 240
      // Beats. Wer nur "unter 0 dB" prüft, übersieht eine zu kurze Rampe (schon am Ziel) und eine fehlende (kostet ~46 µs).
      int fader_mit_verlauf = 0;
      for (int sp = 1; sp <= 32; ++sp) {
        const float ist = l.kern->arrangement().wert(sp - 1, 0);
        const float ziel = -3.0f - (float)(sp % 4);
        const float soll = ziel * (float)std::min(1.0, std::max(0.0, (ende_beat - 24.0) / 240.0));
        if (ist < -0.001f && std::fabs(ist - soll) <= 0.15f) ++fader_mit_verlauf;
        else std::fprintf(stderr, "kosten_arr: arr32 Fader Spur %d nicht mitten in der Rampe (%.2f dB, erwartet %.2f dB)\n", sp, ist, soll);
      }
      // Notendichte: jede Spur muss in den meisten Pegel-Meldungen klingen (RB-Spuren: 128 Noten je 32 Beats, Audio: Dauerton).
      // Die Spitze allein (> -120 dB irgendwann) genügt nicht: eine einzige Note je Schleife erfüllt sie auch.
      double anteil_min = 1.0;
      int anteil_spur = 0;
      for (int sp = 1; sp <= 32; ++sp) {
        const double a = meld_n[sp] ? (double)klang_n[sp] / (double)meld_n[sp] : 0.0;
        if (a < anteil_min) { anteil_min = a; anteil_spur = sp; }
      }
      const bool dicht = solo_ein || anteil_min >= KLANG_ANTEIL_MIN;   // SOLO_EIN: absichtlich fast alles stumm
      if (!dicht)
        std::fprintf(stderr, "kosten_arr: arr32 Spur %d klingt nur in %.1f %% der Pegel-Meldungen (verlangt %.0f %%)\n", anteil_spur,
                     100.0 * anteil_min, 100.0 * KLANG_ANTEIL_MIN);
      uint64_t solo_soll = 0;   // Schaltungen, die mit einem Beat Abstand zum Fensterende fällig waren; ein Paar sind zwei
      for (int k = 0; k < 57; ++k) {
        if (24.0 + 4.0 * k <= ende_beat - 1.0 && (!solo_ein || k == 0)) ++solo_soll;
        if (24.0 + 4.0 * k + 0.25 <= ende_beat - 1.0 && !solo_ein) ++solo_soll;
      }
      const double med_solo = us_solo.empty() ? 0.0 : (std::sort(us_solo.begin(), us_solo.end()), us_solo[us_solo.size() / 2]);
      std::fprintf(stderr, "arr32: klingende Spuren %d von 32 (in der letzten Meldung %d, Spur 3: %.1f dB), Fader mit Verlauf %d von 32\n",
                   klingen, zuletzt, zuletzt_db[3], fader_mit_verlauf);
      std::fprintf(stderr, "arr32: kleinster Klang-Anteil der Pegel-Meldungen %.1f %% (Spur %d)\n", 100.0 * anteil_min, anteil_spur);
      std::fprintf(stderr, "arr32: Solo-Schaltblöcke %llu von %d Zyklen (erwartet mindestens %llu), Median dieser Blöcke %.1f µs, Maximum %.1f µs\n",
                   (unsigned long long)solo_schaltungen, n, (unsigned long long)solo_soll, med_solo,
                   us_solo.empty() ? 0.0 : us_solo.back());
      if (g32 && (l.kern->arrangement().wert(cdj::ARR_SPUREN + 0, 0) >= -0.001f || l.kern->arrangement().wert(cdj::ARR_PM, 0) >= -0.001f)) {
        std::fprintf(stderr, "kosten_arr: arr32g: Gruppen-/PM-Rampe läuft nicht\n");   // Selbstprüfung 1.10: Gruppe 1 und PM müssen mitten in der Rampe stehen
        return 2;
      }
      if (klingen != 32 || !dicht || fader_mit_verlauf != 32 || quittung_status[6] != 0 || solo_schaltungen < solo_soll || solo_schaltungen > (solo_ein ? 1u : 114u)) {
        std::fprintf(stderr, "kosten_arr: Lage arr32 hat weniger als 32 klingende Spuren, nicht an allen Fadern eine laufende Rampe, zu dünne Noten, abgelehnte Teile oder zu wenige Solo-Schaltungen, sie misst nicht, was sie soll\n");
        return 2;
      }
    }
    if (hand) {
      std::fprintf(stderr, "%s: Halter mensch %llu, frei %llu, Hand-Ereignisse %llu\n", lage, (unsigned long long)halter_mensch,
                   (unsigned long long)halter_frei, (unsigned long long)hand_ereignisse);
      if (halter_mensch == 0 || (nur_rueck && halter_frei == 0)) {
        std::fprintf(stderr, "kosten_arr: Lage hand ohne Menschenhand bzw. ohne Rückgabe, sie misst den Rueck-Pfad nicht\n");
        return 2;
      }
    }
    if (eigene)
      std::fprintf(stderr, "%s: RB-338 verloren %llu, Parameter abgelehnt %llu\n", lage,
                   (unsigned long long)l.kern->arr_rb().verloren(), (unsigned long long)l.kern->arr_rb().parameter_abgelehnt());
    else
      std::fprintf(stderr, "%s: Noten intern %llu, Wirt %llu\n", lage, (unsigned long long)intern.n, (unsigned long long)wirt.n);
  }
  return 0;
}
