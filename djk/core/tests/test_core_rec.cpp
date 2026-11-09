// 1.8 Task 24: der Take-Weg im Kern. AK4: Rohsignal bitgleich zum Quellsignal; AK5: erstes Sample auf dem Einsatz-Sample des Arrangements, Ende auf dem Stopp-Sample,
// je ±0; AK6: ein Stall des Fadens über 2,73 s wird gezählt und gemeldet, die Datei bleibt zeitrichtig; Ablehnungen kein_eingang und ueberlappung.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <iterator>
#include <string>

#include "arr_run.h"
#include "cypherdj/recording_thread.h"
#include "cypherdj/eq.h"

bool g_waechter = false;
using k35::N;

static std::string lies(const std::string& p) { std::ifstream f(p, std::ios::binary); return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); }
static float sig(int64_t s) { return 0.0001f * static_cast<float>(s % 9973 + 1); }   // nie 0

int main() {
  k35::Arbeitsbestand ab("test_kern_rec");
  cdj::Loop pad_loop;   // S18: loop of box 1 (pad/1); declared before the run, the kern keeps the pointer
  arr35::Lauf x(ab.pfad, "test_kern_rec");
  const std::string ordner = ab.pfad + "/rec";
  PRUEF(std::system(("mkdir -p " + ordner).c_str()) == 0);
  cdj::AufnahmeFaden faden(ordner);
  x.erz_quelle[0] = sig;   // erz/1: links sig, rechts −sig
  const std::string a = x.ordner.impuls('a', 48000);
  x.lauf(10 * N);
  x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 0.5, a, 48000) + "]}");
  x.lauf(12 * N);
  // Ablehnung ohne scharfe Spur
  const int64_t r0 = x.rec_start(6, 0);
  x.lauf(14 * N);
  PRUEF(x.quittung(r0, 6) && x.quittung(r0, 6)->grund == "kein_eingang");
  // Spur 3 scharf auf erz/1, Start, Transportstart im selben Zyklus
  cdj::RecSpur* p = cdj::RecSpur::neu(3, 11);
  faden.anmelden(p);
  const int64_t rs = x.rec_spur(3, 1, 11, p);
  x.lauf(16 * N);
  PRUEF(x.quittung(rs, 3));
  const int64_t r1 = x.rec_start(7, 0);
  const int64_t s1 = x.start(0.0, 0);
  for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(r1, 1) && x.quittung(r1, 2));
  const int64_t e0 = x.quittung(r1, 2) ? x.quittung(r1, 2)->sample : -1;
  PRUEF(x.quittung(s1, 2) && x.quittung(s1, 2)->sample == e0);   // AK5: dasselbe Sample wie der Einsatz des Arrangements
  // Stopp (sofort), dann das Ende abwarten
  const int64_t st = x.stopp(0);
  for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(r1, 3) && x.quittung(st, 3));
  const int64_t e1 = x.quittung(r1, 3) ? x.quittung(r1, 3)->sample : -1;
  PRUEF(x.quittung(st, 3) && x.quittung(st, 3)->sample == e1);   // AK5: Ende des Takes = Stopp-Sample des Arrangements
  cdj::TakeMeldung tm{};
  PRUEF(faden.hole_meldung(tm) && tm.spur == 3 && tm.kennung == 7 && tm.status == 0 && tm.luecken == 0);
  PRUEF(tm.start_s == e0 && tm.frames == e1 - e0);   // AK5: erstes Sample am Einsatz, Länge bis zum Stopp, je ±0
  // AK4: bitgleich zum Quellsignal ab dem Einsatz
  const std::string roh = lies(ordner + "/aufnahme-3-7.f32");
  PRUEF(static_cast<int64_t>(roh.size()) == tm.frames * 8 && tm.frames > 0);
  bool gleich = !roh.empty();
  for (int64_t i = 0; i < tm.frames && gleich; ++i) {
    float l, r;
    std::memcpy(&l, roh.data() + i * 8, 4);
    std::memcpy(&r, roh.data() + i * 8 + 4, 4);
    gleich = l == sig(e0 + i) && r == -sig(e0 + i);
  }
  PRUEF(gleich);
  // Negativ-Kontrolle zu AK4: um ein Sample verschoben wäre es nicht gleich (die Prüfung kann also etwas sehen)
  float l0;
  std::memcpy(&l0, roh.data(), 4);
  PRUEF(l0 == sig(e0) && l0 != sig(e0 + 1));
  // Ablehnung ueberlappung: der Transport läuft, der Start wird verweigert
  // 1.8 S4a.3 (D8): a RUNNING transport no longer refuses (the take begins on the next bar, see the block at the end); a transport that still WAITS for its Einsatz does
  const int64_t s2 = x.start(0.0, 0);
  const int64_t r2 = x.rec_start(8, 0);   // same cycle, behind the start command: the arrangement waits
  x.lauf(x.kern->sample() + 3 * N);
  PRUEF(x.quittung(r2, 6) && x.quittung(r2, 6)->grund == "ueberlappung");
  x.lauf(x.kern->sample() + 20 * N);
  PRUEF(x.quittung(s2, 2) != nullptr);
  x.stopp(0);
  x.lauf(x.kern->sample() + 3 * N);
  // AK6: der Faden bekommt 3,7 s lang keinen Durchgang: Lücken > 0, Meldung Status 1, die Datei hat trotzdem die richtige Länge
  while (faden.hole_meldung(tm)) {}
  const int64_t r3 = x.rec_start(9, 0);
  x.start(0.0, 0);
  x.lauf(x.kern->sample() + 4 * N);
  for (int i = 0; i < 700; ++i) x.lauf(x.kern->sample() + N);
  x.stopp(0);
  x.lauf(x.kern->sample() + 3 * N);
  // m1 (Nachbesserung 1): der Take ist im Kern zu Ende, der Faden hat die Datei noch nicht geschlossen (phase 2): ein Wechsel der Spur wird abgelehnt, nicht still verschluckt
  const int64_t rw = x.rec_spur(3, 0, 0, nullptr);
  x.lauf(x.kern->sample() + 3 * N);
  PRUEF(x.quittung(rw, 6) && x.quittung(rw, 6)->grund == "aufnahme_laeuft");
  for (int i = 0; i < 20; ++i) faden.durchgang();
  PRUEF(x.quittung(r3, 3) != nullptr);
  PRUEF(faden.hole_meldung(tm) && tm.kennung == 9 && tm.status == 1 && tm.luecken >= 1);
  PRUEF(static_cast<int64_t>(lies(ordner + "/aufnahme-3-9.f32").size()) == tm.frames * 8);
  // Negativ-Kontrolle zu m1: nach dem Schließen im Faden geht der Wechsel; eine neue Spur 3 löst die alte ab (REC_ALT, die Hülle gibt nichts frei)
  cdj::RecSpur* p3 = cdj::RecSpur::neu(3, 11);
  faden.anmelden(p3);
  const int64_t rw2 = x.rec_spur(3, 1, 11, p3);
  x.lauf(x.kern->sample() + 3 * N);
  PRUEF(x.quittung(rw2, 3) != nullptr);
  // 1.8 S3 (D12): the same input in the same mode is a monitor change and goes in place: the armed p stays live, the unused p3 is handed back (the swap of an other input or mode
  // is covered in the S3.1 block below)
  PRUEF(x.kern->aufnahme().spur(3) == p);
  faden.abmelden(p3);
  cdj::RecSpur::frei(p3);
  // M1 (Nachbesserung 1): die Frist endet, sobald das Arrangement wartet. Quant 2 legt den Einsatz auf ein Raster mit Ursprung start_beat; je nach Ursprung liegt er 0 bis 4 Beats
  // hinter dem Start. Vier Ursprünge (0 bis 3) lassen mindestens einen weit hinter der Frist (1 s) landen: dort darf der Take nicht abbrechen.
  int weit = 0;
  for (int sb = 0; sb < 4; ++sb) {
    const int64_t t0 = x.kern->sample();
    const int64_t rr = x.rec_start(20 + sb, 0, 48000);
    x.start(static_cast<double>(sb), 2);
    for (int i = 0; i < 900 && !x.quittung(rr, 2) && !x.quittung(rr, 7); ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(rr, 2) != nullptr && x.quittung(rr, 7) == nullptr);
    if (x.quittung(rr, 2) && x.quittung(rr, 2)->sample - t0 > 48000) ++weit;
    x.stopp(0);
    for (int i = 0; i < 10; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    for (int i = 0; i < 20; ++i) faden.durchgang();
    while (faden.hole_meldung(tm)) {}
  }
  PRUEF(weit >= 1);   // der Fall, der treffen musste: ein Einsatz hinter der Frist, ohne Abbruch
  // Negativ-Kontrolle: ohne Transportstart läuft die Frist ab
  const int64_t rz = x.rec_start(30, 0, 48000);
  for (int i = 0; i < 300; ++i) x.lauf(x.kern->sample() + N);   // 76 800 Samples ohne Transport
  PRUEF(x.quittung(rz, 7) && x.quittung(rz, 7)->grund == "zu_spaet");
  // m2 (Nachbesserung 1): /zustand/rec trägt den Projekt-Beat des Arrangements (Start bei Beat 8), nicht den Kern-Beat
  const int64_t rb = x.rec_start(40, 0);
  x.start(8.0, 0);
  for (int i = 0; i < 60; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(rb, 2) != nullptr);
  int n3 = 0;
  double kleinster = 1e9, groesster = -1.0;
  for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::REC_ZUSTAND)) {
    if (e.status != 3 || e.id != 40) continue;
    ++n3;
    kleinster = e.arr_beat < kleinster ? e.arr_beat : kleinster;
    groesster = e.arr_beat > groesster ? e.arr_beat : groesster;
  }
  PRUEF(n3 >= 1 && kleinster >= 8.0 && groesster < 9.0);   // 60 Zyklen sind 0,32 s, unter einem Beat; der Kern-Beat läge weit darüber
  // 1.8 S0 (D9): /zustand/rec carries the output delay of the core (limiter look-ahead + channel latency) and the cycle size
  {
    const int erwartet = x.kern->mixer().limiter_vorhalt() + x.kern->mixer().kanal_latenz();
    PRUEF(erwartet > 0);   // a zero would not tell the report from a missing one
    int n_ausgang = 0;
    for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::REC_ZUSTAND)) {
      ++n_ausgang;
      PRUEF(e.fassung == erwartet && e.nframes == N);
    }
    PRUEF(n_ausgang >= 1);
  }
  // 1.8 T2: with an EQ insert on track 1 the playback in force has a delay compensation (track 2 is delayed by the EQ latency); /zustand/rec reports it inside the output delay.
  // Reports before the load do not count (they are the plain limiter + channel value, checked above); every report after the load carries the compensation.
  {
    arr35::Lauf y(ab.pfad, "test_kern_rec_pdc");
    const int l_eq = cdj::EqNativ().latenz();
    PRUEF(l_eq > 0);   // positive control: the stage has a latency to report
    const std::string au = y.ordner.audio('b', 200000, 0.25f);
    const auto spur = [&](int nr, const std::string& kette) {
      return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + y.ordner.clip(("p" + std::to_string(nr)).c_str(), 0.0, 8.0, au, 200000) + "]" +
             (kette.empty() ? "" : ",\"chain\":[" + kette + "]") + "}";
    };
    y.ordner.roh(7, "{\"format\":\"cypherdj-arr/2\",\"nr\":7,\"spuren\":[" + spur(1, "{\"art\":\"eq\",\"slot\":1}") + "," + spur(2, "") + "]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(y.ordner.pfad, 7, y.cache);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      cdj::Befehl b = y.neu(cdj::Befehl::ARR_LADEN, "andreas");
      b.zeiger = e.snap.release();
      b.arr_nr = 7;
      y.sende(b);
    }
    y.lauf(3 * 24000 + 4 * N);
    PRUEF(y.kern->arrangement().pdc_latenz() == l_eq);
    const int erwartet = y.kern->mixer().limiter_vorhalt() + y.kern->mixer().kanal_latenz() + l_eq;
    int n_nach = 0;
    for (const cdj::Ereignis& e2 : y.alle(cdj::Ereignis::REC_ZUSTAND)) {
      if (e2.sample < 2 * N) continue;   // the first cycles may still run before the load
      ++n_nach;
      if (e2.fassung != erwartet) std::printf("rec T2: report at %lld: fassung %d, expected %d\n", static_cast<long long>(e2.sample), static_cast<int>(e2.fassung), erwartet);
      PRUEF(e2.fassung == erwartet);
    }
    PRUEF(n_nach >= 2);
    std::printf("rec T2: %d reports with the eq insert, ausgang_vorhalt %d (limiter %d + channel %d + pdc %d)\n", n_nach, erwartet, y.kern->mixer().limiter_vorhalt(),
                y.kern->mixer().kanal_latenz(), l_eq);
  }
  x.stopp(0);
  x.lauf(x.kern->sample() + 3 * N);
  for (int i = 0; i < 20; ++i) faden.durchgang();
  // Review-Nachzug Teil B (MAJOR 1): mit Loop-Klammer 0..2 Beats (45 000 Samples bei 128 BPM) endet der Take am ersten Wrap (Spec 1.8 F2, „ein Durchgang“), nicht am Stopp.
  // Vorher (Probe der Gesamtreview): 6,38 Durchgänge in einer Datei und keine Quittung 3 vor dem Stopp.
  {
    const int64_t lp = x.loop(true, 0.0, 2.0);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(lp, 3) != nullptr || x.quittung(lp, 1) != nullptr);
    while (faden.hole_meldung(tm)) {}
    const int64_t rl = x.rec_start(50, 0);
    x.start(0.0, 0);
    for (int i = 0; i < 800 && !x.quittung(rl, 3); ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }   // 4,3 s: gut vier Durchgänge, wenn nichts endet
    PRUEF(x.quittung(rl, 2) != nullptr);
    PRUEF(x.quittung(rl, 3) != nullptr);                       // Ende ohne Stopp
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::spielt);   // das Arrangement läuft weiter, nur der Take ist zu Ende
    const int64_t le0 = x.quittung(rl, 2) ? x.quittung(rl, 2)->sample : -1, le1 = x.quittung(rl, 3) ? x.quittung(rl, 3)->sample : -1;
    PRUEF(le1 > le0 && le1 - le0 <= 45000 && le1 - le0 > 40000);   // ein Durchgang, kein Vielfaches
    for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    for (int i = 0; i < 20; ++i) faden.durchgang();
    PRUEF(faden.hole_meldung(tm) && tm.kennung == 50 && tm.start_s == le0 && tm.frames == le1 - le0);
    x.stopp(0);
    x.lauf(x.kern->sample() + 3 * N);
    x.loop(false, 0.0, 2.0);
    x.lauf(x.kern->sample() + 3 * N);
  }
  // 1.8 S2a.5: external pairs through the whole core. Pair 1: L = (s mod 1000) / 1000, R = -L; pair 2: a different ramp, R = -L. Three tracks in ONE take:
  //   track 8  on ein_1, stereo   -> L and R bit identical to the pair-1 ramp from the Einsatz to the end (AK4 pattern for an external source)
  //   track 9  on ein_2, stereo   -> bit identical to the pair-2 ramp (each track holds its own pair)
  //   track 10 on ein_1, rechts   -> both channels hold the R of pair 1 (the mode reaches the take)
  // The tracks are disarmed again at the end (S18 below arms its own and frees them).
  {
    auto rampe1 = [](int64_t s) { return static_cast<float>(s % 1000) / 1000.0f; };
    auto rampe2 = [](int64_t s) { return -0.25f + static_cast<float>(s % 1531) * 0.0003f; };
    x.ein_quelle[1] = rampe1;
    x.ein_quelle_r[1] = [&](int64_t s) { return -rampe1(s); };
    x.ein_quelle[2] = rampe2;
    x.ein_quelle_r[2] = [&](int64_t s) { return -rampe2(s); };
    const int spuren[3] = {8, 9, 10}, codes[3] = {1, 2, 1}, modi[3] = {0, 0, 2};
    cdj::RecSpur* pe[3];
    for (int i = 0; i < 3; ++i) {
      pe[i] = cdj::RecSpur::neu(spuren[i], codes[i]);
      pe[i]->modus = static_cast<int8_t>(modi[i]);
      faden.anmelden(pe[i]);
      const int64_t ra = x.rec_spur(spuren[i], 1, codes[i], pe[i]);
      x.lauf(x.kern->sample() + 3 * N);
      PRUEF(x.quittung(ra, 3) != nullptr);
    }
    while (faden.hole_meldung(tm)) {}
    const int64_t r70 = x.rec_start(70, 0);
    x.start(0.0, 0);
    for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(r70, 2) != nullptr);
    const int64_t bis = x.kern->sample() + 8 * 4 * k35::SPB;   // 8 bars at 128 BPM
    while (x.kern->sample() < bis) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    x.stopp(0);
    for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    for (int i = 0; i < 20; ++i) faden.durchgang();
    int64_t start_s[11] = {}, frames[11] = {};
    int gemeldet = 0;
    while (faden.hole_meldung(tm)) {
      if (tm.kennung != 70 || tm.spur < 8 || tm.spur > 10) continue;
      PRUEF(tm.status == 0 && tm.luecken == 0);
      start_s[tm.spur] = tm.start_s;
      frames[tm.spur] = tm.frames;
      ++gemeldet;
    }
    PRUEF(gemeldet == 3);
    PRUEF(frames[8] >= 8 * 4 * k35::SPB && frames[8] < 8 * 4 * k35::SPB + 80 * N);   // 8 bars plus the lead-in of the loop above (the stop comes after it)
    PRUEF(start_s[8] == start_s[9] && start_s[9] == start_s[10] && frames[8] == frames[9] && frames[9] == frames[10]);
    // compare the raw file with a reference built from the source function; shift = reference shifted by that many samples
    auto vergleich = [&](int spur, const std::function<float(int64_t)>& qL, const std::function<float(int64_t)>& qR, int64_t shift) {
      const std::string roh = lies(ordner + "/aufnahme-" + std::to_string(spur) + "-70.f32");
      if (static_cast<int64_t>(roh.size()) != frames[spur] * 8 || frames[spur] <= 0) return int64_t(-1);
      int64_t fehl = 0;
      for (int64_t i = 0; i < frames[spur]; ++i) {
        float l, r;
        std::memcpy(&l, roh.data() + i * 8, 4);
        std::memcpy(&r, roh.data() + i * 8 + 4, 4);
        fehl += (l != qL(start_s[spur] + i + shift)) + (r != qR(start_s[spur] + i + shift));
      }
      return fehl;
    };
    auto neg1 = [&](int64_t s) { return -rampe1(s); };
    auto neg2 = [&](int64_t s) { return -rampe2(s); };
    PRUEF(vergleich(8, rampe1, neg1, 0) == 0);        // pair 1: bit identical, L and R each
    PRUEF(vergleich(8, rampe1, neg1, 1) > 1000);      // counter-check: a reference shifted by one sample mismatches (the test can see a difference)
    PRUEF(vergleich(9, rampe2, neg2, 0) == 0);        // pair 2 on its own track
    PRUEF(vergleich(9, rampe1, neg1, 0) > 1000);      // negative control: track 9 does NOT hold pair 1
    PRUEF(vergleich(10, neg1, neg1, 0) == 0);         // rechts: R of pair 1 on both channels
    PRUEF(vergleich(10, rampe1, neg1, 0) > 1000);     // negative control: not the stereo content
    std::printf("rec S2a: frames %lld, Einsatz %lld\n", (long long)frames[8], (long long)start_s[8]);
    for (int i = 0; i < 3; ++i) {   // disarm: the thread has closed the files, the change goes through
      const int64_t rd = x.rec_spur(spuren[i], 0, 0, nullptr);
      x.lauf(x.kern->sample() + 3 * N);
      PRUEF(x.quittung(rd, 3) != nullptr);
      faden.abmelden(pe[i]);
      cdj::RecSpur::frei(pe[i]);
    }
    x.ein_quelle[1] = nullptr;
    x.ein_quelle_r[1] = nullptr;
    x.ein_quelle[2] = nullptr;
    x.ein_quelle_r[2] = nullptr;
  }
  // 1.8 S2a.4 end to end (review minor): an external track keeps recording past a real loop seam by the tail (D10). Loop bracket 0..2 beats (45 000 samples), nachlauf 4800,
  // track 11 on ein_1. The raw file holds the pass plus exactly the tail, bit identical across the seam. Negative control: the tail is 4800, not 0 (a take that ended at
  // the seam would be shorter by the tail).
  {
    auto rampe1 = [](int64_t s) { return static_cast<float>(s % 1000) / 1000.0f; };
    x.ein_quelle[1] = rampe1;
    x.ein_quelle_r[1] = [&](int64_t s) { return -rampe1(s); };
    const int NACH = 4800;
    cdj::RecSpur* pn = cdj::RecSpur::neu(11, 1);
    faden.anmelden(pn);
    const int64_t ra = x.rec_spur(11, 1, 1, pn);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr);
    x.loop(true, 0.0, 2.0);
    x.lauf(x.kern->sample() + 3 * N);
    while (faden.hole_meldung(tm)) {}
    const int64_t rn = x.rec_start(80, NACH);
    x.start(0.0, 0);
    for (int i = 0; i < 800 && !x.quittung(rn, 3); ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(rn, 2) != nullptr);
    PRUEF(x.quittung(rn, 3) != nullptr);                       // the take ended on its own, after the seam plus the tail
    for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    for (int i = 0; i < 20; ++i) faden.durchgang();
    bool da = false;
    while (faden.hole_meldung(tm)) {
      if (tm.kennung != 80 || tm.spur != 11) continue;
      da = true;
      PRUEF(tm.status == 0 && tm.luecken == 0);
      const int64_t durchgang = tm.frames - NACH;
      std::printf("rec S2a tail: frames %lld, pass %lld, Einsatz %lld\n", (long long)tm.frames, (long long)durchgang, (long long)tm.start_s);
      PRUEF(durchgang == 45000);                                  // exactly one pass of the bracket (2 beats at 128 BPM) plus the tail of 4800
      const std::string roh = lies(ordner + "/aufnahme-11-80.f32");
      PRUEF(static_cast<int64_t>(roh.size()) == tm.frames * 8);
      int64_t fehl = 0, verschoben = 0;
      for (int64_t i = 0; i < tm.frames && static_cast<size_t>(i) * 8 + 8 <= roh.size(); ++i) {
        float l, r;
        std::memcpy(&l, roh.data() + i * 8, 4);
        std::memcpy(&r, roh.data() + i * 8 + 4, 4);
        fehl += (l != rampe1(tm.start_s + i)) + (r != -rampe1(tm.start_s + i));
        verschoben += (l != rampe1(tm.start_s + i + 1));
      }
      PRUEF(fehl == 0);                                        // bit exact over the whole file, the tail past the seam included
      PRUEF(verschoben > 1000);                                // counter-check: a reference shifted by one sample mismatches
    }
    PRUEF(da);
    x.stopp(0);
    x.lauf(x.kern->sample() + 3 * N);
    x.loop(false, 0.0, 2.0);
    x.lauf(x.kern->sample() + 3 * N);
    const int64_t rd = x.rec_spur(11, 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr);
    faden.abmelden(pn);
    cdj::RecSpur::frei(pn);
    x.ein_quelle[1] = nullptr;
    x.ein_quelle_r[1] = nullptr;
  }
  // 1.8 S3.1 (D12): a change of the monitor of an armed track is made in place, in the callback, also while recording and while the thread still closes the last file.
  // Track 3 is armed on erz/1 (p, monitor auto = 1). Cases: (1) recording, same input and mode, monitor 2 -> accepted, SAME pointer, take without a gap;
  // (2) recording, other input -> aufnahme_laeuft, pointer and monitor unchanged; (3) recording, unarmed track 5 -> aufnahme_laeuft, slot stays empty;
  // (1b) take over, thread has not closed the file yet (phase 2) -> monitor 0 still accepted; (4) transport stopped: same message accepted in place, a different
  // mode swaps as today (new pointer).
  {
    size_t basis = 0;   // only events after the last command count: freed RecSpur addresses are reused by malloc
    auto alt_zahl = [&](const cdj::RecSpur* q) {   // how often the callback handed this RecSpur back through REC_ALT since 'basis'
      int n = 0;
      for (size_t i = basis; i < x.ev.size(); ++i) n += x.ev[i].art == cdj::Ereignis::REC_ALT && x.ev[i].zeiger == q ? 1 : 0;
      return n;
    };
    auto frisch = [&](int spur, int eingang, int modus, int monitor) {
      cdj::RecSpur* q = cdj::RecSpur::neu(spur, eingang);
      q->modus = static_cast<int8_t>(modus);
      q->monitor.store(static_cast<int8_t>(monitor), std::memory_order_relaxed);
      faden.anmelden(q);
      return q;
    };
    auto weg = [&](cdj::RecSpur* q) { faden.abmelden(q); cdj::RecSpur::frei(q); };
    PRUEF(x.kern->aufnahme().spur(3) == p && x.kern->aufnahme().spur(5) == nullptr);
    PRUEF(p->monitor.load() == 1);   // default auto
    while (faden.hole_meldung(tm)) {}
    const int64_t r90 = x.rec_start(90, 0);
    x.start(0.0, 0);
    for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(r90, 2) != nullptr);
    PRUEF(x.kern->aufnahme().status() == 3);
    // (1) recording, same input and mode, monitor 2
    cdj::RecSpur* m1 = frisch(3, 11, 0, 2);
    basis = x.ev.size();
    const int64_t q1 = x.rec_spur(3, 1, 11, m1);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q1, 1) != nullptr && x.quittung(q1, 3) != nullptr && x.quittung(q1, 6) == nullptr);
    PRUEF(x.kern->aufnahme().spur(3) == p);       // the same live RecSpur, no swap
    PRUEF(p->monitor.load() == 2);                // the new value is in it
    PRUEF(alt_zahl(m1) == 1 && alt_zahl(p) == 0);   // the unused one went back to the net thread, the live one did not
    PRUEF(x.kern->aufnahme().status() == 3);       // still recording
    // (2) recording, other input: the old path
    cdj::RecSpur* m2 = frisch(3, 12, 0, 0);
    basis = x.ev.size();
    const int64_t q2 = x.rec_spur(3, 1, 12, m2);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q2, 6) && x.quittung(q2, 6)->grund == "aufnahme_laeuft");
    PRUEF(x.kern->aufnahme().spur(3) == p && p->monitor.load() == 2 && p->eingang == 11);
    // (3) recording, track 5 is not armed: a monitor-shaped message must not arm it
    cdj::RecSpur* m3 = frisch(5, 11, 0, 2);
    basis = x.ev.size();
    const int64_t q3 = x.rec_spur(5, 1, 11, m3);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q3, 6) && x.quittung(q3, 6)->grund == "aufnahme_laeuft");
    PRUEF(x.kern->aufnahme().spur(5) == nullptr);
    // stop; the take ends in the callback, the thread has not closed the file yet
    x.stopp(0);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.kern->aufnahme().status() == 0 && p->phase.load() == 2);
    // (1b) ... monitor 0 still goes in place (the arm/disarm path would refuse: aufnahme_laeuft, case m1 above)
    cdj::RecSpur* m4 = frisch(3, 11, 0, 0);
    basis = x.ev.size();
    const int64_t q4 = x.rec_spur(3, 1, 11, m4);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q4, 3) != nullptr && x.quittung(q4, 6) == nullptr);
    PRUEF(x.kern->aufnahme().spur(3) == p && p->monitor.load() == 0 && alt_zahl(m4) == 1);
    for (int i = 0; i < 20; ++i) faden.durchgang();
    // the take continued without a gap and is bit identical to the source from the Einsatz to the end
    bool da = false;
    while (faden.hole_meldung(tm)) {
      if (tm.kennung != 90 || tm.spur != 3) continue;
      da = true;
      PRUEF(tm.status == 0 && tm.luecken == 0 && tm.frames > 0);
      const std::string roh = lies(ordner + "/aufnahme-3-90.f32");
      PRUEF(static_cast<int64_t>(roh.size()) == tm.frames * 8);
      int64_t fehl = 0;
      for (int64_t i = 0; i < tm.frames; ++i) {
        float l, r;
        std::memcpy(&l, roh.data() + i * 8, 4);
        std::memcpy(&r, roh.data() + i * 8 + 4, 4);
        fehl += (l != sig(tm.start_s + i)) + (r != -sig(tm.start_s + i));
      }
      PRUEF(fehl == 0);
    }
    PRUEF(da);
    // (4) transport stopped, thread closed: the same message is accepted in place, no swap
    cdj::RecSpur* m5 = frisch(3, 11, 0, 2);
    basis = x.ev.size();
    const int64_t q5 = x.rec_spur(3, 1, 11, m5);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q5, 3) != nullptr);
    PRUEF(x.kern->aufnahme().spur(3) == p && p->monitor.load() == 2 && alt_zahl(m5) == 1);
    // negative control: another mode swaps as today (new pointer, the old one goes back), on an external input
    cdj::RecSpur* e1 = frisch(12, 1, 0, 1);
    basis = x.ev.size();
    const int64_t q6 = x.rec_spur(12, 1, 1, e1);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q6, 3) != nullptr && x.kern->aufnahme().spur(12) == e1 && e1->monitor.load() == 1);
    cdj::RecSpur* e2 = frisch(12, 1, 1, 2);   // other mode (links): the old path, e1 is replaced
    basis = x.ev.size();
    const int64_t q7 = x.rec_spur(12, 1, 1, e2);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q7, 3) != nullptr);
    PRUEF(x.kern->aufnahme().spur(12) == e2 && alt_zahl(e1) == 1 && alt_zahl(e2) == 0);
    // clean up: disarm track 12, free every helper (the harness frees what REC_ALT hands back)
    basis = x.ev.size();
    const int64_t q8 = x.rec_spur(12, 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(q8, 3) != nullptr && x.kern->aufnahme().spur(12) == nullptr);
    p->monitor.store(1, std::memory_order_relaxed);
    for (cdj::RecSpur* q : {m1, m2, m3, m4, m5, e1, e2}) weg(q);
  }
  // 1.8 S3.3 (AK16): the monitor follows fader and monitor mode of the track, the recording does not. Track 13 on ein_1 (ramp, period 1000), four takes under the same input:
  //   (a) fader -200 dB, monitor aus   (b) fader 0 dB, monitor ein   (c) fader 0 dB, monitor aus   (d) fader -200 dB, monitor ein
  // The raw files are bit identical in all four (the tap sits before the monitor and before the fader). The production master (pm, the arrangement sum) carries the input
  // only in (b): silent in (a), (c), (d), loud in (b) - the case that must hit. The window starts behind the clip of track 1 (one impulse in the first half beat).
  {
    auto rampe1 = [](int64_t s) { return static_cast<float>(s % 1000) / 1000.0f; };
    x.ein_quelle[1] = rampe1;
    x.ein_quelle_r[1] = [&](int64_t s) { return -rampe1(s); };
    cdj::RecSpur* pm = cdj::RecSpur::neu(13, 1);
    pm->monitor.store(0, std::memory_order_relaxed);
    faden.anmelden(pm);
    const int64_t ra = x.rec_spur(13, 1, 1, pm);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr);
    struct Fall { float fader; int monitor; bool laut; };
    const Fall faelle[4] = {{-200.0f, 0, false}, {0.0f, 2, true}, {0.0f, 0, false}, {-200.0f, 2, false}};
    std::string dateien[4];
    int64_t einsatz[4] = {}, laenge[4] = {};
    float pm_spitze[4] = {};
    std::vector<cdj::RecSpur*> nebenbei;
    for (int f = 0; f < 4; ++f) {
      x.teil("spur/13/fader", faelle[f].fader, 0.0, 0.0);
      cdj::RecSpur* mm = cdj::RecSpur::neu(13, 1);   // same input and mode: only the monitor changes, in place (S3.1)
      mm->monitor.store(static_cast<int8_t>(faelle[f].monitor), std::memory_order_relaxed);
      faden.anmelden(mm);
      const int64_t rm = x.rec_spur(13, 1, 1, mm);
      x.lauf(x.kern->sample() + 3 * N);
      PRUEF(x.quittung(rm, 3) != nullptr && x.kern->aufnahme().spur(13) == pm && pm->monitor.load() == faelle[f].monitor);
      nebenbei.push_back(mm);
      while (faden.hole_meldung(tm)) {}
      const int kenn = 100 + f;
      const int64_t rr = x.rec_start(kenn, 0);
      x.start(0.0, 0);
      for (int i = 0; i < 200; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
      PRUEF(x.quittung(rr, 2) != nullptr);
      x.stopp(0);
      for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
      for (int i = 0; i < 20; ++i) faden.durchgang();
      bool da = false;
      while (faden.hole_meldung(tm)) {
        if (tm.kennung != kenn || tm.spur != 13) continue;
        da = true;
        PRUEF(tm.status == 0 && tm.luecken == 0 && tm.frames > 20000);
        einsatz[f] = tm.start_s;
        laenge[f] = tm.frames;
        dateien[f] = lies(ordner + "/aufnahme-13-" + std::to_string(kenn) + ".f32");
        PRUEF(static_cast<int64_t>(dateien[f].size()) == tm.frames * 8);
        // bit identical to the source from the Einsatz on (not to a shifted one)
        int64_t fehl = 0;
        for (int64_t i = 0; i < tm.frames; ++i) {
          float l, r;
          std::memcpy(&l, dateien[f].data() + i * 8, 4);
          std::memcpy(&r, dateien[f].data() + i * 8 + 4, 4);
          fehl += (l != rampe1(tm.start_s + i)) + (r != -rampe1(tm.start_s + i));
        }
        PRUEF(fehl == 0);
        // production master peak in the window behind the clip of track 1
        float sp = 0.0f;
        for (int64_t i = tm.start_s + 20000; i < tm.start_s + tm.frames && i < static_cast<int64_t>(x.pm_l.size()); ++i) sp = std::max(sp, std::fabs(x.pm_l[i]));
        pm_spitze[f] = sp;
      }
      PRUEF(da);
      std::printf("rec S3.3: (%c) fader %.0f monitor %d: pm peak %.5f, frames %lld\n", 'a' + f, faelle[f].fader, faelle[f].monitor, pm_spitze[f], (long long)laenge[f]);
      if (faelle[f].laut) PRUEF(pm_spitze[f] > 0.1f);   // the case that must hit: the monitor sounds
      else PRUEF(pm_spitze[f] == 0.0f);                 // silent: not a single sample of the input reaches the arrangement sum
    }
    // direct comparison of the files: the same ramp, so (a) shifted by the phase difference of the Einsatz equals (b)
    {
      const int64_t d = ((einsatz[1] - einsatz[0]) % 1000 + 1000) % 1000;   // frame i of (b) = source(einsatz[1] + i) = frame i + d of (a), mod the period of the ramp
      const int64_t n = std::min(laenge[0] - d, laenge[1]);
      PRUEF(n > 10000);
      PRUEF(std::memcmp(dateien[0].data() + d * 8, dateien[1].data(), static_cast<size_t>(n) * 8) == 0);   // (a) and (b) hold the same bits
      PRUEF(std::memcmp(dateien[0].data() + ((d + 1) % 1000) * 8, dateien[1].data(), static_cast<size_t>(n - 1000) * 8) != 0);   // counter-check: one sample off differs
    }
    x.teil("spur/13/fader", 0.0f, 0.0, 0.0);
    const int64_t rd = x.rec_spur(13, 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr && x.kern->aufnahme().spur(13) == nullptr);
    faden.abmelden(pm);
    cdj::RecSpur::frei(pm);
    for (cdj::RecSpur* q : nebenbei) { faden.abmelden(q); cdj::RecSpur::frei(q); }
    x.ein_quelle[1] = nullptr;
    x.ein_quelle_r[1] = nullptr;
  }
  // S18: the tap also sees erz/5..7 (codes 15..17) and pad/1..2 (codes 21, 22). One take, four armed tracks:
  //   track 4 code 16 (erz/6, source sig)         -> bit identical to sig (like AK4)
  //   track 5 code 15 (erz/5, no source)          -> all zeros (negative control: the tap can see a difference)
  //   track 6 code 21 (pad/1, loop box 1 plays)   -> not all zeros
  //   track 7 code 22 (pad/2, empty box 2)        -> all zeros
  {
    pad_loop.name = "konstant";
    pad_loop.beats = 16;
    pad_loop.frames = 16 * k35::SPB;
    pad_loop.daten.assign(static_cast<size_t>(pad_loop.frames) * 2, 0.3f);
    cdj::Befehl lb = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    lb.deck = 1;
    lb.zeiger = &pad_loop;
    x.sende(lb);
    x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
    x.lauf(x.kern->sample() + 3 * N);
    cdj::Befehl ls = x.neu(cdj::Befehl::LOOP_START, "andreas");
    ls.deck = 1;
    x.sende(ls);
    x.lauf(x.kern->sample() + 40 * k35::SPB);   // the loop starts on its phrase boundary; 40 beats are enough
    x.erz_quelle[5] = sig;   // erz/6 only
    const int spuren[4] = {4, 5, 6, 7};
    const int codes[4] = {16, 15, 21, 22};
    cdj::RecSpur* ps[4];
    for (int i = 0; i < 4; ++i) {
      ps[i] = cdj::RecSpur::neu(spuren[i], codes[i]);
      faden.anmelden(ps[i]);
      const int64_t ra = x.rec_spur(spuren[i], 1, codes[i], ps[i]);
      x.lauf(x.kern->sample() + 3 * N);
      PRUEF(x.quittung(ra, 3) != nullptr);
    }
    while (faden.hole_meldung(tm)) {}
    const int64_t r60 = x.rec_start(60, 0);
    x.start(0.0, 0);
    for (int i = 0; i < 300; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(r60, 2) != nullptr);
    x.stopp(0);
    for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    for (int i = 0; i < 20; ++i) faden.durchgang();
    int64_t start_s[8] = {}, frames[8] = {};
    int gemeldet = 0;
    while (faden.hole_meldung(tm)) {
      if (tm.kennung != 60 || tm.spur < 4 || tm.spur > 7) continue;
      PRUEF(tm.status == 0 && tm.luecken == 0);
      start_s[tm.spur] = tm.start_s;
      frames[tm.spur] = tm.frames;
      ++gemeldet;
    }
    PRUEF(gemeldet == 4);
    auto datei = [&](int spur) { return lies(ordner + "/aufnahme-" + std::to_string(spur) + "-60.f32"); };
    auto spitze = [&](const std::string& roh) {
      float m = 0.0f;
      for (size_t i = 0; i + 4 <= roh.size(); i += 4) {
        float v;
        std::memcpy(&v, roh.data() + i, 4);
        m = std::max(m, std::fabs(v));
      }
      return m;
    };
    // track 4: bit identical to the erz/6 source
    {
      const std::string roh = datei(4);
      PRUEF(frames[4] > 0 && static_cast<int64_t>(roh.size()) == frames[4] * 8);
      bool gleich = !roh.empty();
      for (int64_t i = 0; i < frames[4] && gleich; ++i) {
        float l, r;
        std::memcpy(&l, roh.data() + i * 8, 4);
        std::memcpy(&r, roh.data() + i * 8 + 4, 4);
        gleich = l == sig(start_s[4] + i) && r == -sig(start_s[4] + i);
      }
      PRUEF(gleich);
    }
    const float sp5 = spitze(datei(5)), sp6 = spitze(datei(6)), sp7 = spitze(datei(7));
    std::printf("rec S18: Spitze erz/5 %.5f, pad/1 %.5f, pad/2 %.5f; Frames %lld %lld %lld %lld\n", sp5, sp6, sp7,
                (long long)frames[4], (long long)frames[5], (long long)frames[6], (long long)frames[7]);
    PRUEF(frames[5] > 0 && static_cast<int64_t>(datei(5).size()) == frames[5] * 8 && sp5 == 0.0f);   // erz/5: no source, all zeros
    PRUEF(frames[6] > 0 && static_cast<int64_t>(datei(6).size()) == frames[6] * 8 && sp6 > 0.01f);   // pad/1: the loop is in the take
    PRUEF(frames[7] > 0 && static_cast<int64_t>(datei(7).size()) == frames[7] * 8 && sp7 == 0.0f);   // pad/2: empty box, all zeros
    for (int i = 0; i < 4; ++i) {   // S4a: disarm in the core BEFORE the memory goes (the later blocks look at every armed slot)
      const int64_t rd = x.rec_spur(spuren[i], 0, 0, nullptr);
      x.lauf(x.kern->sample() + 3 * N);
      PRUEF(x.quittung(rd, 3) != nullptr && x.kern->aufnahme().spur(spuren[i]) == nullptr);
      faden.abmelden(ps[i]);
      cdj::RecSpur::frei(ps[i]);
    }
  }
  // 1.8 S4a.3 (D8, AK21 core part): the take begins on the next project bar INSIDE a running transport; the transport is not touched. 128 BPM (22 500 samples per beat), track 3
  // is armed on erz/1 (source sig). E is the Einsatz of the arrangement (project beat 0); the command is sent at a cycle start T (a multiple of N).
  //   A  transport playing, command at beat 5.3         -> take at beat 8, quittung 2 carries the PROJECT beat 8.0, the take ends with /k/rec/stopp, the transport keeps playing
  //   B  command in the cycle that holds the bar (7.99) -> beat 12 (never a start in the past)
  //   C  loop 0..8, command at beat 7.5                 -> the take begins ON the seam (beat 0.0), a seam on the start sample does not end it, it ends at the next seam: 8 beats +-0
  //   D  loop 0..8, command in the cycle that holds the seam -> counted from the next pass: beat 4 of the second pass
  //   N  negative control: a start from a stopped transport (slice 1 path) is unchanged: take at the Einsatz of the arrangement, quittung 2 carries the project beat of that start
  {
    const int64_t SPB = 22500;
    x.stopp(0);
    x.lauf(x.kern->sample() + 3 * N);
    x.loop(false, 0.0, 8.0);
    x.lauf(x.kern->sample() + 3 * N);
    while (faden.hole_meldung(tm)) {}
    auto lauf_bis = [&](int64_t t) { while (x.kern->sample() < t) { x.lauf(x.kern->sample() + N); faden.durchgang(); } };
    auto aus = [&](int64_t t) { lauf_bis(t); for (int i = 0; i < 30; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); } for (int i = 0; i < 30; ++i) faden.durchgang(); };
    // the take of the given kennung on track 3: bit identical to sig, returns its frames (0: none), start_s via tm
    auto pruefe_take = [&](int kennung, int64_t start, int64_t frames_soll) {
      bool da = false;
      while (faden.hole_meldung(tm)) {
        if (tm.kennung != kennung || tm.spur != 3) continue;
        da = true;
        PRUEF(tm.status == 0 && tm.luecken == 0);
        PRUEF(tm.start_s == start);
        PRUEF(frames_soll < 0 || tm.frames == frames_soll);
        const std::string roh = lies(ordner + "/aufnahme-3-" + std::to_string(kennung) + ".f32");
        PRUEF(static_cast<int64_t>(roh.size()) == tm.frames * 8 && tm.frames > 0);
        int64_t fehl = 0;
        for (int64_t i = 0; i < tm.frames && static_cast<size_t>(i) * 8 + 8 <= roh.size(); ++i) {
          float l, r;
          std::memcpy(&l, roh.data() + i * 8, 4);
          std::memcpy(&r, roh.data() + i * 8 + 4, 4);
          fehl += (l != sig(tm.start_s + i)) + (r != -sig(tm.start_s + i));
        }
        PRUEF(fehl == 0);
      }
      PRUEF(da);
    };
    {  // A
      const int64_t sid = x.start(0.0, 0);
      x.lauf(x.kern->sample() + 4 * N);
      PRUEF(x.quittung(sid, 2) != nullptr);
      const int64_t E = x.quittung(sid, 2) ? x.quittung(sid, 2)->sample : -1;
      lauf_bis((E + static_cast<int64_t>(5.3 * SPB)) / N * N + N);
      const int64_t ra = x.rec_start(170, 0);
      lauf_bis(E + 9 * SPB);
      PRUEF(x.quittung(ra, 1) != nullptr && x.quittung(ra, 6) == nullptr);
      PRUEF(x.quittung(ra, 2) != nullptr);
      if (x.quittung(ra, 2)) {
        PRUEF(x.quittung(ra, 2)->sample == E + 8 * SPB);              // on the bar, +-0
        PRUEF(std::fabs(x.quittung(ra, 2)->beat - 8.0) < 1e-6);        // the project beat, not the core beat
      }
      x.rec_stopp();
      lauf_bis(x.kern->sample() + 2 * N);
      PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::spielt);   // only the recording ended
      PRUEF(x.quittung(ra, 3) != nullptr);
      aus(x.kern->sample());
      pruefe_take(170, E + 8 * SPB, -1);
      x.stopp(0);
      aus(x.kern->sample() + 3 * N);
    }
    {  // B
      const int64_t sid = x.start(0.0, 0);
      x.lauf(x.kern->sample() + 4 * N);
      const int64_t E = x.quittung(sid, 2) ? x.quittung(sid, 2)->sample : -1;
      const int64_t T = (E + 8 * SPB - 1) / N * N;   // the cycle [T, T + N) holds the bar and T + N lies behind it (E = 793 + k * N is not on the grid)
      PRUEF(T + N > E + 8 * SPB && T < E + 8 * SPB);
      lauf_bis(T);
      const size_t zb = x.ev.size();
      const int64_t rb2 = x.rec_start(171, 0, 0, "andreas", 4);   // a count-in is ignored inside a running transport (D7)
      lauf_bis(E + 13 * SPB);
      PRUEF(x.quittung(rb2, 2) != nullptr && x.quittung(rb2, 2)->sample == E + 12 * SPB);   // beat 12, not the bar that is already running
      if (x.quittung(rb2, 2)) PRUEF(std::fabs(x.quittung(rb2, 2)->beat - 12.0) < 1e-6);
      x.rec_stopp();
      aus(x.kern->sample() + 2 * N);
      for (size_t i = zb; i < x.ev.size(); ++i) PRUEF(!(x.ev[i].art == cdj::Ereignis::REC_ZUSTAND && x.ev[i].id == 171 && x.ev[i].status == 1));   // never "counts in"
      pruefe_take(171, E + 12 * SPB, -1);
      x.stopp(0);
      aus(x.kern->sample() + 3 * N);
    }
    {  // C and D
      x.loop(true, 0.0, 8.0);
      x.lauf(x.kern->sample() + 3 * N);
      for (int fall = 0; fall < 2; ++fall) {
        const int kennung = 172 + fall;
        const int64_t sid = x.start(0.0, 0);
        x.lauf(x.kern->sample() + 4 * N);
        const int64_t E = x.quittung(sid, 2) ? x.quittung(sid, 2)->sample : -1;
        const int64_t T = fall == 0 ? (E + static_cast<int64_t>(7.5 * SPB)) / N * N : (E + 8 * SPB - 1) / N * N;   // C: beat 7.5; D: the cycle that holds the seam
        lauf_bis(T);
        const int64_t rc = x.rec_start(kennung, 0);
        for (int i = 0; i < 1500 && !x.quittung(rc, 3); ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
        PRUEF(x.quittung(rc, 2) != nullptr && x.quittung(rc, 3) != nullptr);
        const int64_t start = fall == 0 ? E + 8 * SPB : E + 12 * SPB;   // C: the seam; D: beat 4 of the second pass
        if (x.quittung(rc, 2) && x.quittung(rc, 3)) {
          PRUEF(x.quittung(rc, 2)->sample == start);
          PRUEF(std::fabs(x.quittung(rc, 2)->beat - (fall == 0 ? 0.0 : 4.0)) < 1e-6);
          PRUEF(x.quittung(rc, 3)->sample == E + 16 * SPB);          // the following seam: C one whole pass, D the rest of it
        }
        PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::spielt);
        aus(x.kern->sample());
        pruefe_take(kennung, start, fall == 0 ? 8 * SPB : 4 * SPB);
        x.stopp(0);
        aus(x.kern->sample() + 3 * N);
      }
      x.loop(false, 0.0, 8.0);
      x.lauf(x.kern->sample() + 3 * N);
    }
    {  // K: 1.8 S4a.4 (AK18 core part): count-in of one bar with the internal source. The arrangement waits 4 beats behind its first quant point with status 1 in /zustand/rec, the
       // metronome (switch off) clicks 4 times, the take begins AT the entry, its first frame is the source at the entry (no frame of the count-in window), bit identical onwards.
      const size_t z0 = x.ev.size();
      x.metronom(false, 0.0f, 1);   // switch off, level 0 dB, target cue: the clicks are read from the PFL sum, where the source of the track is not
      x.lauf(x.kern->sample() + 3 * N);
      const int64_t rk = x.rec_start(175, 0, 0, "andreas", 1);
      const int64_t sid = x.start(0.0, 0);
      aus(x.kern->sample() + 40 * SPB / N * N / 2);
      PRUEF(x.quittung(rk, 1) != nullptr && x.quittung(sid, 2) != nullptr && x.quittung(rk, 2) != nullptr);
      const int64_t entry = x.quittung(sid, 2) ? x.quittung(sid, 2)->sample : -1;
      if (x.quittung(rk, 2)) PRUEF(x.quittung(rk, 2)->sample == entry);
      int vor = 0, nach = 0, falsch = 0;
      for (size_t i = z0; i < x.ev.size(); ++i) {
        const cdj::Ereignis& e = x.ev[i];
        if (e.art != cdj::Ereignis::REC_ZUSTAND || e.id != 175) continue;
        if (e.status == 1) { ++vor; falsch += e.sample >= entry; }
        if (e.status == 3) { ++nach; falsch += e.sample < entry; }
      }
      PRUEF(vor >= 1 && nach >= 1 && falsch == 0);               // status 1 only while the count-in runs, status 3 only after the entry
      std::vector<int64_t> kl;   // clicks in the cue sum: the first sample above 0.05, 1000 samples apart
      for (int64_t n = entry - 4 * SPB - 2000; n < entry + 2 * SPB && n < static_cast<int64_t>(x.cue_l.size()); ++n)
        if (std::fabs(x.cue_l[n]) > 0.05f && (kl.empty() || n - kl.back() > 1000)) kl.push_back(n);
      PRUEF(kl.size() == 4);                                       // four count-in clicks with the switch off, none after the entry
      for (int i = 0; i < 4 && i < static_cast<int>(kl.size()); ++i) PRUEF(kl[i] == entry - (4 - i) * SPB + x.vh);   // on the core beats entry - 4 .. entry - 1, +-0 (the sums run the look-ahead vh behind the timeline)
      x.rec_stopp();
      x.stopp(0);
      aus(x.kern->sample() + 3 * N);
      x.metronom(false, -12.0f, 0);
      x.lauf(x.kern->sample() + 3 * N);
      pruefe_take(175, entry, -1);
      PRUEF(std::fabs(sig(entry) - sig(entry - SPB)) > 1e-7f);     // the source differs inside the count-in window: a take that began early would not be bit identical
    }
    {  // N
      const int64_t rn = x.rec_start(174, 0);
      const int64_t sid = x.start(8.0, 0);
      aus(x.kern->sample() + 60 * N);
      PRUEF(x.quittung(rn, 2) != nullptr && x.quittung(sid, 2) != nullptr);
      if (x.quittung(rn, 2) && x.quittung(sid, 2)) {
        PRUEF(x.quittung(rn, 2)->sample == x.quittung(sid, 2)->sample);   // the Einsatz of the arrangement, as in slice 1
        PRUEF(std::fabs(x.quittung(rn, 2)->beat - 8.0) < 1e-6);            // start_beat 8: the project beat of the start (the core beat is below 1)
      }
      x.stopp(0);
      aus(x.kern->sample() + 3 * N);
      while (faden.hole_meldung(tm)) {}
    }
  }
  // ---- 1.8 T7a (AK22 core part): the MIDI recorder in the real core. eingang 30 on track 2 (a bit, not a RecSpur), notes through Kern::midi_ein, stamps exactly cycle start +
  // offset, a mixed run (the audio track 3 is still armed) and an instrument-only run (nothing but the MIDI bit armed), rec_midi_scharf in /zustand/rec, the take file.
  {
    const auto midi_alt = [&](size_t von, const void* zeiger) {   // REC_ALT with fassung 1 (a RecMidi) for this pointer since event index von
      int n = 0;
      for (size_t i = von; i < x.ev.size(); ++i) n += x.ev[i].art == cdj::Ereignis::REC_ALT && x.ev[i].fassung == 1 && x.ev[i].zeiger == zeiger;
      return n;
    };
    const auto midi_arm = [&](int spur, int an, cdj::RecMidi* m) {
      cdj::Befehl b = x.neu(cdj::Befehl::REC_SPUR, "andreas");
      b.nr = spur; b.an = an; b.deck = 30; b.zeiger = m;
      return x.sende(b);
    };
    const auto lies_midi = [&](int kennung) {   // 12-byte records: i64 sample, u8 status, d1, d2, pad (little endian)
      struct R { int64_t s; int st, d1, d2, pad; };
      std::vector<R> v;
      const std::string roh = lies(ordner + "/midi-" + std::to_string(kennung) + ".bin");
      PRUEF(roh.size() % 12 == 0);
      for (size_t o = 0; o + 12 <= roh.size(); o += 12) {
        R r{};
        std::memcpy(&r.s, roh.data() + o, 8);
        r.st = static_cast<uint8_t>(roh[o + 8]); r.d1 = static_cast<uint8_t>(roh[o + 9]); r.d2 = static_cast<uint8_t>(roh[o + 10]); r.pad = static_cast<uint8_t>(roh[o + 11]);
        v.push_back(r);
      }
      return v;
    };
    const size_t z0 = x.ev.size();
    cdj::RecMidi* m = cdj::RecMidi::neu();
    cdj::RecMidi* m2 = cdj::RecMidi::neu();
    const int64_t ra = midi_arm(2, 1, m), rb = midi_arm(5, 1, m2);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr && x.quittung(rb, 3) != nullptr);
    PRUEF(x.kern->aufnahme().midi_maske() == ((1u << 1) | (1u << 4)) && x.kern->aufnahme().midi_spur() == m);
    PRUEF(midi_alt(z0, m2) == 1 && midi_alt(z0, m) == 0);   // the second RecMidi comes straight back, the first is adopted; no new event number (fassung 1 tags REC_ALT)
    x.lauf(x.kern->sample() + 30000);   // /zustand/rec at 2 Hz
    int gemeldet_z = 0;
    for (size_t i = z0; i < x.ev.size(); ++i)
      if (x.ev[i].art == cdj::Ereignis::REC_ZUSTAND) { ++gemeldet_z; PRUEF(x.ev[i].rec_midi_scharf == 2 && x.ev[i].rec_scharf == 1); }   // audio: track 3 (p) only
    PRUEF(gemeldet_z >= 1);
    const int64_t rb2 = midi_arm(5, 0, nullptr);   // disarm track 5: bit gone, track 2 keeps the recorder
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rb2, 3) != nullptr && x.kern->aufnahme().midi_maske() == (1u << 1) && x.kern->aufnahme().midi_spur() == m && midi_alt(z0, m) == 0);
    faden.anmelden(p);   // already registered: harmless
    cdj::RecMidi::frei(m2);
    // mixed run: audio track 3 plus MIDI track 2; 16 notes at known cycle offsets (the first at offset 0, the second at the last sample of its cycle)
    const int64_t rm = x.rec_start(180, 0);
    const int64_t sm = x.start(0.0, 0);
    for (int i = 0; i < 10; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(rm, 2) != nullptr && x.quittung(sm, 2) != nullptr);
    const int64_t E = x.quittung(rm, 2) ? x.quittung(rm, 2)->sample : -1;
    PRUEF(m->phase.load() == 1 && m->start_s == E && m->kennung == 180);
    const int64_t basis = (x.kern->sample() / N + 3) * N;
    std::vector<int64_t> soll;
    for (int i = 0; i < 16; ++i) {
      const int off = i == 0 ? 0 : i == 1 ? N - 1 : (i * 97) % N;
      const int64_t s = basis + 2 * i * N + off;
      x.midi_ein_bei(s, 0x90, static_cast<uint8_t>(40 + i), static_cast<uint8_t>(100 - i));
      x.midi_ein_bei(s + N, 0x80, static_cast<uint8_t>(40 + i), 0);
      soll.push_back(s);
    }
    x.lauf(basis + 36 * N);
    for (int i = 0; i < 4; ++i) faden.durchgang();
    x.rec_stopp();
    for (int i = 0; i < 6; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(rm, 3) != nullptr);
    const int64_t Z = x.quittung(rm, 3) ? x.quittung(rm, 3)->sample : -1;
    PRUEF(m->phase.load() == 2 && m->ende_s == Z);
    {   // the ring holds exactly the 32 events, on cycle start + offset, nothing else (no thread reads this recorder: it is not registered with the faden)
      std::vector<cdj::MidiEinEreignis> ring;
      cdj::MidiEinEreignis e;
      while (m->ring.hole(e)) ring.push_back(e);
      PRUEF(ring.size() == 32 && m->abgelehnt.load() == 0);
      for (size_t i = 0; i < ring.size() && i < 32; ++i) {
        const int64_t erwartet = soll[i / 2] + (i % 2 ? N : 0);
        PRUEF(ring[i].sample == erwartet);
        PRUEF(ring[i].b[0] == (i % 2 ? 0x80 : 0x90) && ring[i].b[1] == 40 + i / 2 && ring[i].n == 3);
      }
    }
    m->phase.store(3, std::memory_order_release);   // the take is closed (the thread would do it)
    for (int i = 0; i < 20; ++i) faden.durchgang();
    cdj::TakeMeldung tm3{};
    int audio3 = 0;
    while (faden.hole_meldung(tm3)) audio3 += tm3.kennung == 180 && tm3.spur == 3 && tm3.art == 0;
    PRUEF(audio3 == 1);   // the audio take of the mixed run is reported once, as art 0
    x.stopp(0);
    x.lauf(x.kern->sample() + 3 * N);

    // instrument-only run: the audio track is disarmed, only the MIDI bit is armed. No kein_eingang, status 3 in /zustand/rec, the take file, /e/aufnahme art 1 spur 0.
    const int64_t rd = x.rec_spur(3, 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr && x.kern->aufnahme().scharf() == 0 && x.kern->aufnahme().midi_scharf() == 1);
    faden.anmelden_midi(m);
    const size_t z1 = x.ev.size();
    const int64_t ri = x.rec_start(181, 0);
    const int64_t si = x.start(0.0, 0);
    for (int i = 0; i < 10; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(ri, 1) != nullptr && x.quittung(ri, 6) == nullptr && x.quittung(ri, 2) != nullptr && x.quittung(si, 2) != nullptr);
    const int64_t E2 = x.quittung(ri, 2) ? x.quittung(ri, 2)->sample : -1;
    PRUEF(x.quittung(si, 2) && x.quittung(si, 2)->sample == E2);
    const int64_t basis2 = (x.kern->sample() / N + 3) * N;
    x.midi_ein_bei(basis2 + 5, 0x90, 60, 100);
    x.midi_ein_bei(basis2 + N + 7, 0xB0, 1, 64);
    x.midi_ein_bei(basis2 + 2 * N + 9, 0x90, 64, 90);      // note 64 stays open: the take closes it
    x.midi_ein_bei(basis2 + 3 * N + 11, 0x80, 60, 0);
    x.midi_ein_bei(basis2 + 4 * N, 0x90, 60, 80);          // pitch 60 again after its off: open at the end together with 64
    for (int i = 0; i < 12; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    bool status3 = false;
    for (size_t i = z1; i < x.ev.size(); ++i) status3 = status3 || (x.ev[i].art == cdj::Ereignis::REC_ZUSTAND && x.ev[i].status == 3 && x.ev[i].rec_scharf == 0 && x.ev[i].rec_midi_scharf == 1);
    PRUEF(status3);
    const int64_t stop2 = x.stopp(0);
    for (int i = 0; i < 12; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(ri, 3) != nullptr && x.quittung(stop2, 3) != nullptr);
    const int64_t Z2 = x.quittung(ri, 3) ? x.quittung(ri, 3)->sample : -1;
    for (int i = 0; i < 4; ++i) faden.durchgang();
    cdj::TakeMeldung tm4{};
    int midi4 = 0;
    while (faden.hole_meldung(tm4)) {
      if (tm4.kennung != 181) continue;
      PRUEF(tm4.art == 1 && tm4.spur == 0 && tm4.status == 0 && tm4.start_s == E2 && tm4.luecken == 0 && tm4.frames == 7);   // 5 events + the closing offs of 64 and 60
      ++midi4;
    }
    PRUEF(midi4 == 1);
    const auto rec = lies_midi(181);
    PRUEF(rec.size() == 7);
    if (rec.size() == 7) {
      PRUEF(rec[0].s == basis2 + 5 && rec[0].st == 0x90 && rec[0].d1 == 60 && rec[0].d2 == 100 && rec[0].pad == 0);
      PRUEF(rec[1].s == basis2 + N + 7 && rec[1].st == 0xB0 && rec[1].d1 == 1 && rec[1].d2 == 64);
      PRUEF(rec[2].s == basis2 + 2 * N + 9 && rec[2].st == 0x90 && rec[2].d1 == 64);
      PRUEF(rec[3].s == basis2 + 3 * N + 11 && rec[3].st == 0x80 && rec[3].d1 == 60);
      PRUEF(rec[4].s == basis2 + 4 * N && rec[4].st == 0x90 && rec[4].d1 == 60 && rec[4].d2 == 80);
      PRUEF(rec[5].s == Z2 && rec[5].st == 0x80 && rec[5].d1 == 60 && rec[5].d2 == 0);   // closed at ende_s, by pitch
      PRUEF(rec[6].s == Z2 && rec[6].st == 0x80 && rec[6].d1 == 64 && rec[6].d2 == 0);
    }
    PRUEF(lies(ordner + "/midi-181.json").find("\"status\":\"fertig\"") != std::string::npos);
    // disarm: the last bit gone hands the RecMidi back (REC_ALT fassung 1), the module has none any more
    const size_t z2 = x.ev.size();
    const int64_t rx = midi_arm(2, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rx, 3) != nullptr && x.kern->aufnahme().midi_maske() == 0u && x.kern->aufnahme().midi_spur() == nullptr && midi_alt(z2, m) == 1);
    faden.abmelden_midi(m);
    cdj::RecMidi::frei(m);
    // nothing armed at all: kein_eingang again (the first check of this file, now after the MIDI runs)
    const int64_t rk = x.rec_start(182, 0);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rk, 6) && x.quittung(rk, 6)->grund == "kein_eingang");
  }
  {  // 1.8 T9 (AK26): a tempo ramp is refused with tempo_rampe while a recording waits or runs; once it is over the same ramp is accepted (negative control)
    auto rampe = [&]() {   // far in the future: accepted, but never reached in this test
      cdj::Befehl rb = x.neu(cdj::Befehl::TEMPO_RAMPE, "andreas");
      rb.ab_beat = 4096.0; rb.ziel_bpm = 90.0; rb.dauer_beats = 8.0;
      return x.sende(rb);
    };
    const int64_t ra = x.rec_spur(3, 1, 11, p);   // the audio track 3 is armed again (the blocks above handed it back)
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr);
    const int64_t rn = x.rec_start(190, 0, 48000);   // the start waits for the transport (status 2)
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rn, 1) != nullptr && x.kern->aufnahme().status() == 2);
    const int64_t i1 = rampe();
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(i1, 6) != nullptr && x.quittung(i1, 6)->grund == "tempo_rampe" && x.quittung(i1, 1) == nullptr);
    const int64_t rt = x.start(0.0, 0);   // the run is on (status 3): still refused
    for (int i = 0; i < 10; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.quittung(rt, 2) != nullptr && x.kern->aufnahme().status() == 3);
    const int64_t i2 = rampe();
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(i2, 6) != nullptr && x.quittung(i2, 6)->grund == "tempo_rampe" && x.quittung(i2, 1) == nullptr);
    x.stopp(0);
    for (int i = 0; i < 20; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
    PRUEF(x.kern->aufnahme().status() == 0);
    while (faden.hole_meldung(tm)) {}
    const int64_t i3 = rampe();   // negative control: no recording, the ramp is taken
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(i3, 1) != nullptr && x.quittung(i3, 6) == nullptr);
    const int64_t rb2 = x.rec_spur(3, 0, 0, nullptr);   // hand the track back as the blocks above do
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rb2, 3) != nullptr && x.kern->aufnahme().spur(3) == nullptr);
  }
  faden.abmelden(p);
  cdj::RecSpur::frei(p);
  PRUEF_ENDE();
}
