// D1 K1 Slice 8: das Modul Arrangement im Kern (Spec D1 2.2, 2.3, 2.6, 3.1). Befehle /k/arr/* mit Quittungen (1, 3 beim
// Laden; 1 beim Annehmen, 2 am Einsatz-Sample, 3 am Stopp-Sample), Ablehnungen nicht_geladen und ausserhalb_bereich,
// Einsatz am Master-Ring auf Einsatz-Sample + Limiter-Vorhalt (erster Wert ungleich 0), Spur-Fader über /k/teil,
// /zustand/arr, /pegel spur/<n>, ARR_ALT beim zweiten Laden, Metronom vor dem Limiter (master) und im Cue, das
// Kern-Sample im Ring-Kopf (§6.1).
#include <algorithm>
#include <cmath>
#include <cstring>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;
using cdj::ArrStatus;

// Endquittungen einer id (Status ≥ 2: gestartet, fertig, abgelehnt, abgebrochen, …); jede id endet genau einmal
static int enden(const arr35::Lauf& x, int64_t id) {
  int n = 0;
  for (const k35::Q& q : x.q) n += (q.id == id && q.status >= 2) ? 1 : 0;
  return n;
}

static float spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, std::fabs(x[i]));
  return m;
}

int main() {
  {  // E3 S1: Pegelname spur/<n> mehrstellig (heute "spur/:" bei Index 9)
    char n[48];
    cdj::spur_pegel_name(0, n);  PRUEF(std::strcmp(n, "spur/1") == 0);
    cdj::spur_pegel_name(7, n);  PRUEF(std::strcmp(n, "spur/8") == 0);
    cdj::spur_pegel_name(9, n);  PRUEF(std::strcmp(n, "spur/10") == 0);
    cdj::spur_pegel_name(31, n); PRUEF(std::strcmp(n, "spur/32") == 0);
    cdj::spur_pegel_name(99, n); PRUEF(std::strcmp(n, "spur/100") == 0);
    cdj::spur_pegel_name(998, n); PRUEF(std::strcmp(n, "spur/999") == 0);
  }
  k35::Arbeitsbestand ab("test_kern_arr");
  {  // 1-6: Laden, Start sofort, Einsatz am Ring, Zustand, Pegel, Spur-Fader, Stopp, zweites Laden
    arr35::Lauf x(ab.pfad, "test_kern_arr");
    const std::string a = x.ordner.impuls('a', 48000);
    x.lauf(10 * N);
    const int64_t s_ohne = x.start(0.0, 0);   // noch nichts geladen
    x.lauf(11 * N);
    PRUEF(x.quittung(s_ohne, 6) && x.quittung(s_ohne, 6)->grund == "nicht_geladen");
    const int64_t l1 = x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 0.5, a, 48000) + "," +
                                      x.ordner.clip("c2", 1.0, 0.5, a, 48000) + "]}");
    x.lauf(12 * N);
    PRUEF(x.quittung(l1, 1) && x.quittung(l1, 3) && x.quittung(l1, 3)->sample == 11 * N);
    const int64_t s1 = x.start(0.0, 0);
    x.lauf(20 * N);
    const int64_t einsatz = 12 * N + 2 * N + 25 + N;   // jetzt + Vorhalt (2n + 25) + ein Zyklus
    PRUEF(x.quittung(s1, 1) && x.quittung(s1, 1)->sample == 12 * N);
    PRUEF(x.quittung(s1, 2) && x.quittung(s1, 2)->sample == einsatz);
    PRUEF(arr35::Lauf::erster(x.l, 0, 20 * N) == einsatz + x.vh);
    bool zustand = false;
    for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_ZUSTAND))
      zustand = zustand || (e.arr_nr == 5 && e.arr_status == 2 && e.arr_ursprung == einsatz && e.arr_start_beat == 0.0);
    PRUEF(zustand);
    PRUEF(!x.alle(cdj::Ereignis::PEGEL, "spur/1").empty() && x.alle(cdj::Ereignis::PEGEL, "spur/2").empty());
    // Spur-Fader über das Stellwerk: der Clip auf Beat 1 bleibt still
    x.teil("spur/1/fader", -200.0f, 0.0, 0.0);
    x.lauf(30000);
    const int64_t zweiter = einsatz + 22500 + x.vh;
    PRUEF(spitze(x.l, zweiter, zweiter + 2000) < 1e-4f);
    PRUEF(x.wert("spur/1/fader") == -200.0);
    // Stopp sofort: Quittung 1 und 3 am selben Sample
    const int64_t st = x.stopp(0);
    x.lauf(31 * 1024);
    const k35::Q* q3 = x.quittung(st, 3);
    PRUEF(x.quittung(st, 1) && q3 && q3->sample == x.quittung(st, 1)->sample);
    // zweites Laden: der erste Schnappschuss kommt als ARR_ALT zurück
    const size_t alt_vorher = x.alle(cdj::Ereignis::ARR_ALT).size();
    x.laden(6, "{\"nr\":2,\"art\":\"audio\",\"clips\":[]}");
    x.lauf(32 * 1024);
    PRUEF(x.alle(cdj::Ereignis::ARR_ALT).size() == alt_vorher + 1);
    // Bereich: Loop kürzer als ein Beat, Pegel unter −60 dB
    const int64_t lf = x.loop(true, 0.0, 0.5);
    const int64_t mf = x.metronom(true, -70.0f, 0);
    x.lauf(33 * 1024);
    PRUEF(x.quittung(lf, 6) && x.quittung(lf, 6)->grund == "ausserhalb_bereich");
    PRUEF(x.quittung(mf, 6) && x.quittung(mf, 6)->grund == "ausserhalb_bereich");
  }
  for (int ziel = 0; ziel < 2; ++ziel) {  // 7: Metronom −6 dB auf Projekt-Beat 2 (halber Pegel), master vor dem Limiter oder cue
    arr35::Lauf x(ab.pfad, "test_kern_arr_metro");
    x.lauf(4 * N);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[]}");
    x.metronom(true, -6.0f, ziel);
    x.start(2.0, 0);
    x.lauf(20 * N);
    const int64_t s = 4 * N + 2 * N + 25 + N;
    const double g = 0.5 * 0.50118723;
    if (ziel == 0) {
      PRUEF(arr35::Lauf::erster(x.l, 0, 20 * N) == s + x.vh);
      PRUEF_NAH(x.l[s + x.vh], g, 1e-4);
      PRUEF(arr35::Lauf::erster(x.cue_l, 0, 20 * N) == -1);   // cue/mix −1: der Cue hört nur PFL, nicht den Master
    } else {
      PRUEF(arr35::Lauf::erster(x.l, 0, 20 * N) == -1);   // nicht im Master
      PRUEF(arr35::Lauf::erster(x.cue_l, 0, 20 * N) == s + x.vh);   // PFL um den Limiter-Vorhalt verzögert
      PRUEF_NAH(x.cue_l[s + x.vh], g * 0.25118864, 1e-4);   // cue/pegel −12 dB
    }
  }
  {  // 9: Spur-Fader bis +6 dB (Spec 6.16): /k/teil nach +6 angenommen, der Pegel steigt um 6 dB; +6,5 abgelehnt
    arr35::Lauf x(ab.pfad, "test_kern_arr_plus6");
    const std::string a = x.ordner.audio('a', 4 * 48000, 0.1f);   // Gleichwert 0,1: weit unter dem Limiter
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, a, 4 * 48000) + "]}");
    x.start(0.0, 0);
    x.lauf(40 * N);
    const float vorher = spitze(x.l, 30 * N, 40 * N);
    const int64_t gut = x.teil("spur/1/fader", 6.0f, 0.0, 0.0);
    const int64_t zu_hoch = x.teil("spur/1/fader", 6.5f, 0.0, 0.0);
    x.lauf(60 * N);
    const float nachher = spitze(x.l, 50 * N, 60 * N);
    PRUEF(x.quittung(gut, 3) != nullptr);
    PRUEF(x.quittung(zu_hoch, 6) && x.quittung(zu_hoch, 6)->grund == "ausserhalb_bereich");
    PRUEF_NAH(x.wert("spur/1/fader"), 6.0, 1e-6);
    PRUEF(vorher > 0.01f);
    PRUEF_NAH(nachher / vorher, 1.9952623, 1e-3);   // 10^(6/20)
  }
  {  // 10: ARR_ALT bei vollem Ereignisring (Review MINOR 8.2): die Rückgabe wartet auf ihrem Platz und geht nach, sobald
     // der Ring Luft hat; ein weiteres Laden wartet, solange der Platz belegt ist. Kein Schnappschuss geht verloren, am
     // Ende ist nur das Audio des geladenen gesperrt.
    arr35::Lauf x(ab.pfad, "test_kern_arr_ring");
    const std::string a1 = x.ordner.audio('1', 4800), a2 = x.ordner.audio('2', 4800), a3 = x.ordner.audio('3', 4800);
    auto spur = [&](const std::string& a) {
      return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 4800) + "]}";
    };
    x.laden(1, spur(a1));
    x.lauf(4 * N);
    x.abholen = false;   // der Netz-Faden steht: niemand leert den Ereignisring
    while (x.kern->ereignisse_verloren() == 0) x.zyklen(x.kern->sample() + N);
    x.laden(2, spur(a2));   // löst Schnappschuss 1 ab, der Ring ist voll
    x.zyklen(x.kern->sample() + 2 * N);
    const int64_t l3 = x.laden(3, spur(a3));   // muss warten: der Platz hält noch Schnappschuss 1
    x.zyklen(x.kern->sample() + 2 * N);
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 2);
    x.abholen = true;
    x.lauf(x.kern->sample() + 8 * N);
    const auto alt = x.alle(cdj::Ereignis::ARR_ALT);
    PRUEF(alt.size() == 2);   // Schnappschuss 1 (nachgereicht) und 2 (vom wartenden Laden abgelöst)
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 3);
    PRUEF(x.quittung(l3, 1) && x.quittung(l3, 3));
    PRUEF(x.cache.eintraege() == 1);   // nur a3 (geladen); a1 und a2 sind zurück
  }
  {  // 12: K1-Fix 10: der Wartepuffer hinter einer ARR_ALT-Rückgabe ist voll (ein Laden, das auf den Platz wartet, und 15
     // Befehle dahinter: 16). Ein weiterer /k/arr/*-Befehl
     // wird abgelehnt (4 zu_spaet), nicht vorgezogen: das Metronom bleibt an, bis die wartenden Befehle der Reihe nach
     // laufen. Die Quittung 4 geht bei vollem Ring selbst verloren und zählt in ereignisse_verloren (/zustand/kern).
    arr35::Lauf x(ab.pfad, "test_kern_arr_ring");
    const std::string a1 = x.ordner.audio('1', 4800), a2 = x.ordner.audio('2', 4800), a3 = x.ordner.audio('3', 4800);
    auto spur = [&](const std::string& a) {
      return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 4800) + "]}";
    };
    x.laden(1, spur(a1));
    x.metronom(true, -12.0f, 0);
    x.lauf(4 * N);
    auto metronom_an = [&] { return x.kern->arrangement().zustand(x.kern->karte(), x.kern->sample()).metronom_an; };
    PRUEF(metronom_an());
    x.abholen = false;   // der Netz-Faden steht
    while (x.kern->ereignisse_verloren() == 0) x.zyklen(x.kern->sample() + N);
    x.laden(2, spur(a2));   // die Rückgabe von Schnappschuss 1 belegt den Platz
    x.zyklen(x.kern->sample() + N);
    std::vector<int64_t> warten{x.laden(3, spur(a3))};   // wartet auf den Platz; alles dahinter wartet mit
    for (int i = 0; i < 15; ++i) warten.push_back(x.metronom(true, -12.0f - i, 0));
    x.zyklen(x.kern->sample() + N);
    const uint64_t v0 = x.kern->ereignisse_verloren();
    const int64_t aus = x.metronom(false, -12.0f, 0);   // der 17.: Puffer voll
    x.zyklen(x.kern->sample() + N);
    PRUEF(metronom_an());                                // nicht vorgezogen
    PRUEF(x.kern->ereignisse_verloren() > v0);           // die Quittung 4 fand keinen Platz: gezählt
    x.abholen = true;
    x.lauf(x.kern->sample() + 8 * N);
    PRUEF(metronom_an());
    int fertig = 0;
    for (const int64_t id : warten) fertig += x.quittung(id, 3) ? 1 : 0;
    if (fertig != 16) std::printf("Fall 12: %d von 16 wartenden fertig\n", fertig);
    PRUEF(fertig == 16);                                 // die wartenden liefen alle, in ihrer Reihenfolge
    PRUEF(!x.quittung(aus, 1) && !x.quittung(aus, 3));   // der abgelehnte lief nie
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 3);
  }
  {  // 11: Quittungen wartender Starts (Review MINOR 8.2/10.2): ein zweiter Start, die Hand-Taste, /k/arr/stopp und der
     // KI-Stopp beenden einen wartenden Start mit 7 (abbruch, hand, ki_stopp); jede id endet genau einmal, ein späterer
     // Start der Hand gibt einer alten id keine 2
    const std::string sp = "{\"nr\":1,\"art\":\"audio\",\"clips\":[]}";
    {  // a: zwei Starts kurz nacheinander
      arr35::Lauf x(ab.pfad, "test_kern_arr_q");
      x.laden(1, sp);
      x.lauf(2 * N);
      const int64_t s1 = x.start(0.0, 0);
      x.lauf(3 * N);   // s1 wartet (Einsatz 2N + 2N + 25 + N)
      const int64_t s2 = x.start(0.0, 0);
      x.lauf(12 * N);
      PRUEF(x.quittung(s1, 1) && x.quittung(s1, 7) && x.quittung(s1, 7)->grund == "abbruch" && !x.quittung(s1, 2));
      PRUEF(x.quittung(s2, 1) && x.quittung(s2, 2));
      PRUEF(enden(x, s1) == 1 && enden(x, s2) == 1);
    }
    {  // b: die Hand-Taste stoppt einen wartenden Start, ihr nächster Start gibt der alten id keine 2
      arr35::Lauf x(ab.pfad, "test_kern_arr_q");
      x.laden(1, sp);
      x.lauf(2 * N);
      const int64_t s3 = x.start(0.0, 2);   // Takt: Einsatz bei 90 000
      x.lauf(20000);
      x.test_hand("arr/start_stopp", 1.0f, 20000);
      x.lauf(30000);
      PRUEF(x.kern->arrangement().status() == ArrStatus::steht);
      x.test_hand("arr/start_stopp", 1.0f, 30000);
      x.lauf(40000);
      PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
      PRUEF(x.quittung(s3, 7) && x.quittung(s3, 7)->grund == "hand" && !x.quittung(s3, 2));
      PRUEF(enden(x, s3) == 1);
    }
    {  // c: /k/arr/stopp auf einen wartenden Start
      arr35::Lauf x(ab.pfad, "test_kern_arr_q");
      x.laden(1, sp);
      x.lauf(2 * N);
      const int64_t s4 = x.start(0.0, 2);
      x.lauf(4 * N);
      const int64_t st = x.stopp(0);
      x.lauf(100000);
      PRUEF(x.quittung(s4, 7) && x.quittung(s4, 7)->grund == "abbruch" && !x.quittung(s4, 2));
      PRUEF(x.quittung(st, 1) && x.quittung(st, 3));
      PRUEF(enden(x, s4) == 1 && enden(x, st) == 1);
    }
    {  // d: KI-Stopp auf einen wartenden Start von Cypher
      arr35::Lauf x(ab.pfad, "test_kern_arr_q");
      x.laden(1, sp);
      x.lauf(2 * N);
      const int64_t s5 = x.start(0.0, 2, "cypher");
      x.lauf(4 * N);
      x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
      x.lauf(100000);
      PRUEF(x.quittung(s5, 7) && x.quittung(s5, 7)->grund == "ki_stopp" && !x.quittung(s5, 2));
      PRUEF(enden(x, s5) == 1);
    }
    {  // f: K1-Fix 7: zwei /k/arr/stopp mit Takt-Quant hintereinander. Der zweite ersetzt den ersten; der erste endet genau
       // einmal mit 7 (abbruch), der zweite mit 3 am Stopp-Sample. Gegenprobe: ein einzelner Stopp endet mit 3.
      for (const bool zwei : {true, false}) {
        arr35::Lauf x(ab.pfad, "test_kern_arr_q");
        x.laden(1, sp);
        x.lauf(2 * N);
        x.start(0.0, 0);
        x.lauf(20 * N);
        const int64_t a = x.stopp(2);
        x.lauf(22 * N);
        const int64_t b = zwei ? x.stopp(2) : -1;
        x.lauf(200000);
        PRUEF(x.kern->arrangement().status() == ArrStatus::steht);
        if (zwei) {
          if (enden(x, a) != 1 || enden(x, b) != 1)
            std::printf("Fall 11f: Stopp a endet %d-mal, Stopp b %d-mal\n", enden(x, a), enden(x, b));
          PRUEF(enden(x, a) == 1 && x.quittung(a, 7) && x.quittung(a, 7)->grund == "abbruch" && !x.quittung(a, 3));
          PRUEF(enden(x, b) == 1 && x.quittung(b, 3));
        } else {
          PRUEF(enden(x, a) == 1 && x.quittung(a, 3));
        }
      }
    }
    {  // e: Negativ-Kontrolle: ein laufender Start endet mit 2; ein neuer Start beendet ihn ohne weitere Quittung
      arr35::Lauf x(ab.pfad, "test_kern_arr_q");
      x.laden(1, sp);
      x.lauf(2 * N);
      const int64_t s6 = x.start(0.0, 0);
      x.lauf(10 * N);
      const int64_t s7 = x.start(0.0, 0);
      x.lauf(20 * N);
      PRUEF(x.quittung(s6, 2) && x.quittung(s7, 2) && enden(x, s6) == 1 && enden(x, s7) == 1);
    }
  }
  {  // 8: Kern-Sample im Ring-Kopf: Ring beginnt bei w = 7000, der Kern bei Sample 0
    auto mem = std::make_unique<unsigned char[]>(CDJ_RING_BYTES);
    auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
    std::memset(ring, 0, sizeof *ring);
    ring->w = 7000;
    auto bef = std::make_unique<cdj::Befehlsring>();
    auto ere = std::make_unique<cdj::Ereignisring>();
    auto kern = std::make_unique<cdj::Kern>(128.0, ring, bef.get(), ere.get());
    kern->zyklus(N, 0);
    kern->zyklus(N, 0);
    PRUEF(static_cast<int64_t>(cdj_lade(&ring->sample_minus_w)) == -7000);
    PRUEF(cdj_lade(&ring->w) == 7000 + 2 * N);
  }
  {  // 1.10 Slice 1: /pegel grp/<n> je Gruppe mit Mitgliedern und pm (Spitze nach Gruppen- bzw. PM-Fader)
    arr35::Lauf x(ab.pfad, "test_kern_arr_grp");
    const std::string a = x.ordner.audio('a', 200000, 0.25f);
    const std::string clip = x.ordner.clip("c1", 0.0, 4.0, a, 200000);
    x.lauf(10 * N);
    PRUEF(!x.alle(cdj::Ereignis::PEGEL, "master").empty());   // Positiv-Kontrolle: die Pegel laufen schon, nur ohne Wiedergabe kommt kein pm
    PRUEF(x.alle(cdj::Ereignis::PEGEL, "pm").empty());        // 1.10: ohne geladene Wiedergabe schweigt pm
    const int64_t l1 = x.laden2(7,
        "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip + "]},"
        "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + clip + "]}",
        "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}");
    x.lauf(12 * N);
    x.start(0.0, 0);
    x.lauf(80 * N);
    PRUEF(x.quittung(l1, 3));
    const auto g1 = x.alle(cdj::Ereignis::PEGEL, "grp/1"), pm = x.alle(cdj::Ereignis::PEGEL, "pm");
    PRUEF(!g1.empty() && !pm.empty());
    PRUEF(x.alle(cdj::Ereignis::PEGEL, "grp/2").empty());   // Negativ-Kontrolle: Gruppe 2 hat kein Mitglied
    if (!g1.empty() && !pm.empty()) {
      // Spur 0,25 in der Mitte: 0,25 · 0,7071 = 0,1768 (−15,05 dB); die Gruppe trägt eine Spur, der PM Gruppe plus Spur 2 = 0,3536 (−9,03 dB)
      PRUEF_NAH(g1.back().pegel[0], -15.05, 0.2);
      PRUEF_NAH(pm.back().pegel[0], -9.03, 0.2);
    }
  }
  PRUEF_ENDE();
}
