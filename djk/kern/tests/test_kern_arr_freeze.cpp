// Paket K3 (Spec D1 2.5, 2.12, 3.1 /k/arr/freeze): Freeze im Kern. Quittung 1 bei Annahme, 2 am Einsatz-Sample (jetzt +
// Vorhalt 2n + 25 + ein Zyklus), 3 am Ende des Nachlaufs, /zustand/arr Status 3; der Auftrag kommt genau einmal als
// Ereignis ARR_FREEZE zurück (0 fertig, 1 abgebrochen, ARR_FREEZE_ABGELEHNT). Abbruch durch Stopp (7 abbruch) und
// KI-Stopp (7 ki_stopp), Ablehnung nicht_geladen und ki_gestoppt (Quelle cypher), Rückgabe bei vollem Ereignisring.
// Mutation: ARR_FREEZE_VERLIERBAR (Fall 5 rot: die Rückgabe geht bei vollem Ring verloren). Fall 6: Reihenfolge hinter
// einem wartenden Laden (Mutation ARR_FREEZE_UEBERHOLT rot). Fall 7: Tempo-Rampe gegen Freeze (Spec 6.33). Fall 8:
// /k/set/neu bricht ab (Fix L1, Mutation ARR_FREEZE_SET_NEU_BLEIBT rot). Fall 9: fünf und zwölf wartende Freeze bei
// vollem Ereignisring (Fix 2/P1: jede Rückgabe wartet im Kern, auch die des laufenden, und kommt an, sobald Platz ist;
// Mutationen ARR_FREEZE_VERLIERBAR und ARR_FREEZE_RUECKGABE_VERWERFEN rot); Fix 3/Q2: die wartenden Rückgaben kommen in
// ihrer Reihenfolge an (Ablehnungen f2..fN in Sende-Reihenfolge, dann f1; Mutation ARR_FREEZE_LIFO rot).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;

namespace {

std::unique_ptr<cdj::ArrFreeze> auftrag(int spur, double von, double bis) {
  auto f = std::make_unique<cdj::ArrFreeze>();
  f->spur = spur;
  f->kennung = 3;
  f->von_beat = von;
  f->bis_beat = bis;
  f->kap = static_cast<int64_t>((bis - von + cdj::ARR_FREEZE_NACHLAUF) * 48000.0) + 2;
  f->daten.assign(static_cast<size_t>(f->kap) * 2, 0.0f);
  return f;
}

int64_t freeze(arr35::Lauf& x, cdj::ArrFreeze* f, const char* quelle = "andreas") {
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_FREEZE, quelle);
  b.nr = f->spur;
  b.zeiger = f;
  return x.sende(b);
}

// Rückgaben ARR_FREEZE für diesen Auftrag (zeiger) mit ihrem Status
std::vector<int32_t> rueck(const arr35::Lauf& x, const cdj::ArrFreeze* f) {
  std::vector<int32_t> v;
  for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_FREEZE))
    if (e.zeiger == f) v.push_back(e.status);
  return v;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_freeze");
  {  // 1: Freeze fertig: Quittungen, Daten vor dem Fader, Zustand 3, Rückgabe einmal mit Status 0
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze1");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "," +
                   x.ordner.clip("c4", 4.0, 0.5, a, 4800) + "]}");
    x.teil("spur/1/fader", -6.0f, 0.0, 0.0);
    x.lauf(10 * N);
    auto f = auftrag(1, 0.0, 4.0);
    const int64_t id = freeze(x, f.get());
    x.lauf(10 * N + 6 * 22500 + 8 * N);
    const int64_t einsatz = 10 * N + 2 * N + 25 + N;
    PRUEF(x.quittung(id, 1) && x.quittung(id, 1)->sample == 10 * N);
    PRUEF(x.quittung(id, 2) && x.quittung(id, 2)->sample == einsatz);
    PRUEF(x.quittung(id, 3) && x.quittung(id, 3)->sample == einsatz + 6 * 22500);
    PRUEF(f->start_s == einsatz && f->frames == 6 * 22500 && f->status == 0);
    PRUEF(f->daten[0] == 1.0f && f->daten[2 * 4 * 22500] == 1.0f);   // vor dem Fader (−6 dB)
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0});
    bool drei = false;
    for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_ZUSTAND)) drei = drei || e.arr_status == 3;
    PRUEF(drei && x.kern->arrangement().status() == cdj::ArrStatus::steht);
    PRUEF(arr35::Lauf::erster(x.l, 0, einsatz + x.vh + 10) == einsatz + x.vh);   // er klingt dabei
    // 2: Abbruch durch /k/arr/stopp nach einem Beat: Quittung 7 abbruch am Stopp-Sample, Rückgabe Status 1
    auto g = auftrag(1, 0.0, 4.0);
    const int64_t id2 = freeze(x, g.get());
    x.lauf(x.kern->sample() + 22500);
    const int64_t st = x.stopp(0);
    x.lauf(x.kern->sample() + 4 * N);
    const k35::Q* q7 = x.quittung(id2, 7);
    PRUEF(q7 && q7->grund == "abbruch" && x.quittung(st, 3) && q7->sample == x.quittung(st, 3)->sample);
    PRUEF(!x.quittung(id2, 3) && rueck(x, g.get()) == std::vector<int32_t>{1} && g->status == 1);
  }
  {  // 3: KI-Stopp: Cyphers laufender Freeze bricht mit ki_stopp ab, ein neuer von cypher wird abgelehnt
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze3");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}");
    x.lauf(10 * N);
    auto f = auftrag(1, 0.0, 8.0);
    const int64_t id = freeze(x, f.get(), "cypher");
    x.lauf(x.kern->sample() + 22500);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(id, 7) && x.quittung(id, 7)->grund == "ki_stopp" && rueck(x, f.get()) == std::vector<int32_t>{1});
    auto g = auftrag(1, 0.0, 8.0);
    const int64_t id2 = freeze(x, g.get(), "cypher");
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(id2, 6) && x.quittung(id2, 6)->grund == "ki_gestoppt");
    PRUEF(rueck(x, g.get()) == std::vector<int32_t>{cdj::ARR_FREEZE_ABGELEHNT});
  }
  {  // 4: nicht geladen: Quittung 6, Rückgabe abgelehnt (nur freigeben)
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze4");
    x.lauf(4 * N);
    auto f = auftrag(1, 0.0, 4.0);
    const int64_t id = freeze(x, f.get());
    x.lauf(8 * N);
    PRUEF(x.quittung(id, 6) && x.quittung(id, 6)->grund == "nicht_geladen");
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{cdj::ARR_FREEZE_ABGELEHNT});
  }
  {  // 5: voller Ereignisring: die Rückgabe wartet im Kern und kommt nach, sobald Platz ist (kein Leck)
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze5");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}");
    x.lauf(4 * N);
    x.abholen = false;   // ab jetzt füllt sich der Ring (je Zyklus mindestens /uhr): nach 9000 Zyklen ist er voll
    x.lauf(x.kern->sample() + 9000 * N);
    auto f = auftrag(1, 0.0, 1.0);
    freeze(x, f.get());
    x.lauf(x.kern->sample() + 3 * 22500 + 8 * N);   // der Freeze endet bei vollem Ring
    PRUEF(f->status == 0 && f->ende_s > 0);
    x.abholen = true;
    x.lauf(x.kern->sample() + 40 * N);
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0});
  }
  {  // 6: Reihenfolge (K1-Fix ARR_ALT-Platz): wartet ein Laden hinter einer Rückgabe, die der volle Ring nicht nahm, wartet
     // ein danach gesendeter Freeze dahinter und läuft auf der neuen Wiedergabe durch, statt vom nachgereichten Tausch
     // abgebrochen zu werden. Mutation ARR_FREEZE_UEBERHOLT (Freeze vorbei an arr_warte_) macht diesen Fall rot.
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze6");
    const std::string a = x.ordner.impuls('a', 4800);
    const std::string sp = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}";
    x.laden(1, sp);
    x.lauf(4 * N);
    x.abholen = false;
    x.lauf(x.kern->sample() + 9000 * N);   // Ring voll
    x.laden(2, sp);                         // Tausch: die Rückgabe von 1 findet keinen Platz
    x.lauf(x.kern->sample() + N);
    x.laden(3, sp);                         // wartet hinter der Rückgabe
    auto f = auftrag(1, 0.0, 1.0);
    const int64_t id = freeze(x, f.get());  // wartet dahinter
    x.lauf(x.kern->sample() + N);
    x.abholen = true;
    x.lauf(x.kern->sample() + 3 * 22500 + 40 * N);
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0} && f->status == 0);
    PRUEF(x.quittung(id, 3) && !x.quittung(id, 7));
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 3);
  }
  {  // 7: Spec 6.33, Tempo-Rampe gegen Freeze (der Kern entscheidet). (a) Rampe angenommen, Einsatz an der nächsten
     // Takt-Eins noch aus: Freeze 6 tempo_rampe; (b) Rampe läuft: 6 tempo_rampe; (c) nach ihrem Ende angenommen und fertig
     // (Negativ-Kontrolle: ohne offene Rampe läuft er durch); (d) Rampe während des wartenden und während des laufenden
     // Freeze, gleich von welcher Quelle: 7 abbruch, Rückgabe 1. Mutationen ARR_FREEZE_OHNE_RAMPENPRUEFUNG ((a) rot) und
     // ARR_FREEZE_RAMPE_OHNE_ABBRUCH ((d) rot).
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze7");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}");
    x.lauf(10 * N);
    auto rampe = [&](const char* quelle) {   // ab der nächsten Takt-Eins (mindestens 4 Beats voraus), 4 Beats auf 120 BPM
      const double b = x.kern->karte().beat_at(static_cast<double>(x.kern->sample()));
      cdj::Befehl r = x.neu(cdj::Befehl::TEMPO_RAMPE, quelle);
      r.ab_beat = 4.0 * std::ceil(b / 4.0) + 4.0;
      r.ziel_bpm = 120.0;
      r.dauer_beats = 4.0;
      return x.sende(r);
    };
    auto bis_quittung = [&](int64_t id, int32_t st) {
      for (int i = 0; i < 4000 && !x.quittung(id, st); ++i) x.lauf(x.kern->sample() + N);
      return x.quittung(id, st) != nullptr;
    };
    // (a)
    const int64_t r1 = rampe("leitstand");
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(r1, 1) && !x.quittung(r1, 2));
    auto fa = auftrag(1, 0.0, 1.0);
    const int64_t ia = freeze(x, fa.get());
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ia, 6) && x.quittung(ia, 6)->grund == "tempo_rampe" && !x.quittung(ia, 1));
    PRUEF(rueck(x, fa.get()) == std::vector<int32_t>{cdj::ARR_FREEZE_ABGELEHNT});
    // (b)
    PRUEF(bis_quittung(r1, 2));
    x.lauf(x.kern->sample() + 22500);
    PRUEF(!x.quittung(r1, 3));
    auto fb = auftrag(1, 0.0, 1.0);
    const int64_t ib = freeze(x, fb.get());
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ib, 6) && x.quittung(ib, 6)->grund == "tempo_rampe");
    PRUEF(rueck(x, fb.get()) == std::vector<int32_t>{cdj::ARR_FREEZE_ABGELEHNT});
    // (c)
    PRUEF(bis_quittung(r1, 3));
    auto fc = auftrag(1, 0.0, 1.0);
    const int64_t ic = freeze(x, fc.get());
    PRUEF(bis_quittung(ic, 3) && !x.quittung(ic, 6) && !x.quittung(ic, 7));
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(rueck(x, fc.get()) == std::vector<int32_t>{0} && fc->status == 0);
    // (d) wartend: die Rampe kommt im Zyklus nach der Annahme, vor dem Einsatz (jetzt + 2n + 25 + n)
    auto fd = auftrag(1, 0.0, 4.0);
    const int64_t id_ = freeze(x, fd.get());
    x.lauf(x.kern->sample() + N);
    PRUEF(x.quittung(id_, 1) && !x.quittung(id_, 2));
    const int64_t r2 = rampe("andreas");
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(id_, 7) && x.quittung(id_, 7)->grund == "abbruch" && !x.quittung(id_, 2));
    PRUEF(rueck(x, fd.get()) == std::vector<int32_t>{1} && fd->status == 1);
    PRUEF(x.quittung(r2, 1));   // die Rampe selbst gilt
    PRUEF(bis_quittung(r2, 3));
    // (d) laufend: Abbruch am Blockanfang des Zyklus, der die Rampe einsortiert
    auto fe = auftrag(1, 0.0, 8.0);
    const int64_t ie = freeze(x, fe.get());
    PRUEF(bis_quittung(ie, 2));
    x.lauf(x.kern->sample() + 22500);
    const int64_t s_rampe = x.kern->sample();
    rampe("cypher");
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ie, 7) && x.quittung(ie, 7)->grund == "abbruch" && x.quittung(ie, 7)->sample == s_rampe);
    PRUEF(!x.quittung(ie, 3) && rueck(x, fe.get()) == std::vector<int32_t>{1} && fe->ende_s == s_rampe);
  }
  {  // 8 (Fix L1): /k/set/neu bricht einen Freeze ab wie Start, Stopp, Laden und Rampe: Quittung 7 abbruch am Sample 0 der
     // neuen Zeitachse, Rückgabe 1, keine 3, ende_s 0, der Transport steht. (a) laufend: die Spur klingt auf der neuen
     // Achse nicht wieder auf, auch nicht, wenn diese das alte Einsatz-Sample überschreitet; (b) wartend: kein Einsatz.
     // (c) Negativ-Kontrolle: ein Freeze ohne /k/set/neu auf der neuen Achse läuft durch. Mutation
     // ARR_FREEZE_SET_NEU_BLEIBT ((a) und (b) rot; gemessen vor dem Fix: Quittung 3, Status 0, ende_s auf der neuen Achse).
    arr35::Lauf x(ab.pfad, "test_kern_arr_freeze8");
    const std::string a = x.ordner.audio('b', 8 * 22500);   // Gleichwert 0,25 über 8 Beats
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 8.0, a, 8 * 22500) + "]}");
    x.lauf(10 * N);
    auto set_neu = [&](double bpm) {
      cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
      b.bpm = bpm;
      return x.sende(b);
    };
    // (a) laufend, einen Beat nach dem Einsatz
    auto fa = auftrag(1, 0.0, 8.0);
    const int64_t ia = freeze(x, fa.get());
    for (int i = 0; i < 40 && !x.quittung(ia, 2); ++i) x.lauf(x.kern->sample() + N);
    PRUEF(x.quittung(ia, 2) != nullptr);
    const int64_t einsatz = x.quittung(ia, 2) ? x.quittung(ia, 2)->sample : 0;
    x.lauf(einsatz + 22500);
    PRUEF(arr35::Lauf::erster(x.l, einsatz + x.vh, einsatz + 22500) >= 0);   // vorher klang sie
    const int64_t sn = set_neu(100.0);
    const int64_t s_alt = x.kern->sample();
    // lauf() läuft auf der neuen Achse bis zum alten Sample weiter: über das alte Einsatz-Sample hinaus
    x.lauf(s_alt + 2 * 22500);
    PRUEF(x.quittung(sn, 2) && x.kern->sample() < s_alt + 2 * 22500 + 2 * N);
    const k35::Q* q7 = x.quittung(ia, 7);
    std::printf("Fall 8a: alt %lld, Einsatz %lld, q7 %s (Sample %lld), q3 %s, Status %d, ende_s %lld\n", (long long)s_alt,
                (long long)einsatz, q7 ? q7->grund.c_str() : "-", q7 ? (long long)q7->sample : -1LL,
                x.quittung(ia, 3) ? "ja" : "nein", fa->status, (long long)fa->ende_s);
    PRUEF(q7 && q7->grund == "abbruch" && q7->sample == 0);
    PRUEF(!x.quittung(ia, 3) && rueck(x, fa.get()) == std::vector<int32_t>{1} && fa->status == 1 && fa->ende_s == 0);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht && !x.kern->arrangement().freeze_laeuft());
    // Auf der neuen Achse klingt nur noch der Nachlauf des Master-Zugs auf den harten Schnitt (gemessen höchstens 0,0022,
    // bis Sample 7142); die Spur selbst (Gleichwert 0,25) darf nicht wieder anklingen, auch nicht ab dem alten Einsatz.
    float geist = 0.0f;
    for (int64_t i = 2 * N; i < s_alt + 2 * 22500; ++i) geist = std::max(geist, std::fabs(x.l[i]));
    std::printf("Fall 8a: Spitze auf der neuen Achse ab Sample %d: %.5f\n", 2 * N, geist);
    PRUEF(geist < 0.01f);   // kein Wiederaufklingen am alten Einsatz-Sample
    // (b) wartend: /k/set/neu im Zyklus nach der Annahme, vor dem Einsatz
    x.lauf(x.kern->sample() + 4 * N);
    auto fb = auftrag(1, 0.0, 4.0);
    const int64_t ib = freeze(x, fb.get());
    x.lauf(x.kern->sample() + N);
    PRUEF(x.quittung(ib, 1) && !x.quittung(ib, 2));
    set_neu(128.0);
    x.kern->zyklus(N, 0);   // ein Zyklus direkt am Kern (lauf() liefe auf der neuen Achse bis zum alten Sample)
    x.lauf(x.kern->sample() + 10 * 22500);
    PRUEF(x.quittung(ib, 7) && x.quittung(ib, 7)->grund == "abbruch" && x.quittung(ib, 7)->sample == 0);
    PRUEF(!x.quittung(ib, 2) && !x.quittung(ib, 3) && rueck(x, fb.get()) == std::vector<int32_t>{1});
    // (c) Negativ-Kontrolle: auf der neuen Achse läuft ein Freeze ohne /k/set/neu durch
    auto fc = auftrag(1, 0.0, 1.0);
    const int64_t ic = freeze(x, fc.get());
    x.lauf(x.kern->sample() + 3 * 22500 + 8 * N);
    PRUEF(x.quittung(ic, 3) && !x.quittung(ic, 7) && rueck(x, fc.get()) == std::vector<int32_t>{0} && fc->status == 0);
    PRUEF(fc->daten[0] == 0.25f);
  }
  {  // 9 (Fix L11, Fix 2/P1): wartende Freeze bei vollem Ereignisring. Sie warten hinter einem Laden, das auf den Platz
     // seiner Rückgabe wartet; wird ein Platz frei, reicht arr_nachreichen() alle in einem Zug nach: der erste läuft an, die
     // übrigen lehnt der Kern ab (ueberlappung). Ihre Rückgaben und die des laufenden, der bei weiter vollem Ring endet,
     // warten im Kern (verkettet über ArrFreeze::rueck_naechster, ohne Obergrenze) und kommen alle an, sobald das Netz
     // wieder abholt: keine geht verloren, kein Puffer bleibt liegen. Vor dem Fix (vier Plätze) kam f1 nie an
     // (gemessen fix1: „f1:keine f2..f5:abgelehnt“), sein Puffer (bis 99 MB) blieb belegt und /e/freeze blieb aus.
    // (a) fünf wie im Re-Review, (b) zwölf (mehr als die alten vier Plätze auch für Ablehnungen)
    for (const int anzahl : {5, 12}) {
      arr35::Lauf x(ab.pfad, anzahl == 5 ? "test_kern_arr_freeze9a" : "test_kern_arr_freeze9b");
      const std::string a = x.ordner.impuls('a', 4800);
      const std::string sp = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}";
      x.laden(1, sp);
      x.lauf(4 * N);
      x.abholen = false;
      x.lauf(x.kern->sample() + 9000 * N);   // Ring voll
      x.laden(2, sp);                         // die Rückgabe von 1 findet keinen Platz
      x.lauf(x.kern->sample() + N);
      x.laden(3, sp);                         // wartet hinter der Rückgabe
      std::vector<std::unique_ptr<cdj::ArrFreeze>> f;
      std::vector<int64_t> id;
      for (int i = 0; i < anzahl; ++i) {
        f.push_back(auftrag(1, 0.0, 1.0));
        id.push_back(freeze(x, f.back().get()));   // warten dahinter
      }
      x.lauf(x.kern->sample() + N);
      cdj::Ereignis e;
      PRUEF(x.ere->hole(e));                   // ein Platz frei: im nächsten Zyklus geht die Rückgabe von 1 hinaus
      x.lauf(x.kern->sample() + N);
      PRUEF(x.kern->arrangement().freeze_laeuft());   // der erste läuft (Quittung 1 ging im vollen Ring verloren)
      x.lauf(x.kern->sample() + 3 * 22500 + 8 * N);   // er endet bei weiter vollem Ring
      PRUEF(f[0]->status == 0 && f[0]->ende_s > 0 && !x.kern->arrangement().freeze_laeuft());
      PRUEF(rueck(x, f[0].get()).empty());   // noch nichts abgeholt: sie wartet im Kern
      x.abholen = true;
      x.lauf(x.kern->sample() + 40 * N);
      std::printf("Fall 9 (%d): Rückgaben", anzahl);
      for (int i = 0; i < anzahl; ++i) {
        const std::vector<int32_t> r = rueck(x, f[static_cast<size_t>(i)].get());
        std::printf(" f%d:%s", i + 1,
                    r.empty() ? "keine" : r[0] == cdj::ARR_FREEZE_ABGELEHNT ? "abgelehnt" : std::to_string(r[0]).c_str());
      }
      std::printf("\n");
      PRUEF(rueck(x, f[0].get()) == std::vector<int32_t>{0});   // die Rückgabe des fertigen Freeze kommt an
      // Fix 3/Q2 (kern.h freeze_kopf_, kern_arr.cpp freeze_melden): wartende Rückgaben behalten ihre Reihenfolge. Gemeldet
      // werden erst die Ablehnungen f2..fN (arr_nachreichen in Sende-Reihenfolge), dann f1 an seinem Ende; alle warten im
      // Kern und gehen in genau dieser Folge in den Ring.
      std::vector<int> folge, soll;
      for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_FREEZE))
        for (int i = 0; i < anzahl; ++i)
          if (e.zeiger == f[static_cast<size_t>(i)].get()) folge.push_back(i + 1);
      for (int i = 2; i <= anzahl; ++i) soll.push_back(i);
      soll.push_back(1);
      std::printf("Fall 9 (%d): Reihenfolge", anzahl);
      for (const int i : folge) std::printf(" f%d", i);
      std::printf("\n");
      PRUEF(folge == soll);
      for (int i = 1; i < anzahl; ++i)
        PRUEF(rueck(x, f[static_cast<size_t>(i)].get()) == std::vector<int32_t>{cdj::ARR_FREEZE_ABGELEHNT});
      PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 3);
      // danach läuft ein neuer Freeze wie sonst (nichts hängt im Kern)
      auto g = auftrag(1, 0.0, 1.0);
      const int64_t ig = freeze(x, g.get());
      x.lauf(x.kern->sample() + 3 * 22500 + 8 * N);
      PRUEF(x.quittung(ig, 3) && rueck(x, g.get()) == std::vector<int32_t>{0});
    }
  }
  PRUEF_ENDE();
}
