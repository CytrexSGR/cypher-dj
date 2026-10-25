// 1.8 Task 24: der Take-Weg im Kern. AK4: Rohsignal bitgleich zum Quellsignal; AK5: erstes Sample auf dem Einsatz-Sample des Arrangements, Ende auf dem Stopp-Sample,
// je ±0; AK6: ein Stall des Fadens über 2,73 s wird gezählt und gemeldet, die Datei bleibt zeitrichtig; Ablehnungen kein_eingang und ueberlappung.
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>

#include "arr_lauf.h"
#include "cypherdj/aufnahme_faden.h"

bool g_waechter = false;
using k35::N;

static std::string lies(const std::string& p) { std::ifstream f(p, std::ios::binary); return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); }
static float sig(int64_t s) { return 0.0001f * static_cast<float>(s % 9973 + 1); }   // nie 0

int main() {
  k35::Arbeitsbestand ab("test_kern_rec");
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
  const int64_t s2 = x.start(0.0, 0);
  x.lauf(x.kern->sample() + 20 * N);
  PRUEF(x.quittung(s2, 2) != nullptr);
  const int64_t r2 = x.rec_start(8, 0);
  x.lauf(x.kern->sample() + 3 * N);
  PRUEF(x.quittung(r2, 6) && x.quittung(r2, 6)->grund == "ueberlappung");
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
  faden.abmelden(p);
  cdj::RecSpur::frei(p);
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
  faden.abmelden(p3);
  cdj::RecSpur::frei(p3);
  PRUEF_ENDE();
}
