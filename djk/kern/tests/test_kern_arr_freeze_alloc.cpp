// Paket K3 (A10, L5): kein malloc im Kern-Zyklus während eines Freeze. Eine Wirt-Spur an einer Prüfsenke (Vorhalt
// 2n + 25) wird über 8 Beats plus Nachlauf eingefroren, mit Loop-Klammer (ausgesetzt), Fader-Rampe der Spur und
// Rückgabe des Auftrags als Ereignis; dann ein zweiter Freeze, der durch Stopp abbricht. Gezählt wird nur in
// kern->zyklus() (alloc_abfang.h); der Puffer entsteht vorher, wie im Arrangement-Lade-Faden (Spec 6.29). Fix L2: dazu
// free, blockierende Sperren und Schlafen; Positiv-Kontrolle abfang_gegenprobe(): je Art ein Aufruf, der Wächter zählt
// jeden.
// Spec 6.33: dazu ein Freeze, den eine offene Tempo-Rampe ablehnt (tempo_rampe), und einer, den eine Rampe abbricht.
// Fix 2/P1: bei vollem Ereignisring endet ein Freeze und ein zweiter wird abgelehnt (ueberlappung); beide Rückgaben warten
// in der Kette des Kerns (freeze_melden) und gehen im Fenster nach (freeze_nachreichen), beides unter dem Wächter.
// Fix 2/P3: /k/set/neu bricht einen laufenden und einen wartenden Freeze ab (Kern::einsortieren SET_NEU,
// Arrangement::freeze_abbrechen), beides im Fenster; vorher stand dieser Abbruch in keinem Wächter-Fenster.
#include <cmath>
#include <cstdlib>
#include <memory>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_arr_freeze_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_arr_freeze_alloc");
  arrtest::PruefSenke wirt(2 * N + 25);
  x.kern->setze_arr_senke_wirt(1, &wirt);
  std::string noten;
  for (int i = 0; i < 16; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.5) +
             ",\"laenge\":0.25,\"ton\":" + std::to_string(36 + i) + ",\"vel\":100}";
  x.laden(1, "{\"nr\":1,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten + "]}");
  x.loop(true, 0.0, 4.0);
  x.teil("spur/1/fader", -6.0f, 2.0, 4.0);
  auto auftrag = [] {
    auto f = std::make_unique<cdj::ArrFreeze>();
    f->spur = 1;
    f->kennung = 1;
    f->von_beat = 0.0;
    f->bis_beat = 8.0;
    f->kap = static_cast<int64_t>(10.0 * 48000.0) + 2;
    f->daten.assign(static_cast<size_t>(f->kap) * 2, 0.0f);
    return f;
  };
  auto f1 = auftrag(), f2 = auftrag(), f3 = auftrag(), f4 = auftrag(), f5 = auftrag(), f6 = auftrag(), f7 = auftrag(),
       f8 = auftrag();
  f5->bis_beat = 1.0;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_FREEZE);
  b.zeiger = f1.get();
  x.sende(b);
  x.lauf(4 * N);
  AbfangZahlen im_zyklus;
  int rueck = 0;
  bool abholen = true;
  auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      abfang_aus();
      im_zyklus += abfang_zahlen();
      cdj::Ereignis e;
      while (abholen && x.ere->hole(e)) rueck += e.art == cdj::Ereignis::ARR_FREEZE;
    }
  };
  zyklen(10 * 22500 / N + 20);   // 8 Beats plus Nachlauf
  cdj::Befehl c = x.neu(cdj::Befehl::ARR_FREEZE);
  c.zeiger = f2.get();
  x.sende(c);
  zyklen(100);
  x.stopp(0);
  zyklen(20);
  auto rampe = [&] {   // ab der übernächsten Takt-Eins, 4 Beats auf 120 BPM
    cdj::Befehl r = x.neu(cdj::Befehl::TEMPO_RAMPE);
    r.ab_beat = 4.0 * std::ceil(x.kern->karte().beat_at(static_cast<double>(x.kern->sample())) / 4.0) + 4.0;
    r.ziel_bpm = 120.0;
    r.dauer_beats = 4.0;
    x.sende(r);
  };
  rampe();
  zyklen(4);
  cdj::Befehl d = x.neu(cdj::Befehl::ARR_FREEZE);   // abgelehnt: tempo_rampe
  d.zeiger = f3.get();
  x.sende(d);
  zyklen(4);
  for (int i = 0; i < 4000 && x.kern->tempoplan_eintraege() > 0; ++i) zyklen(1);   // bis die Rampe vorbei ist
  cdj::Befehl e4 = x.neu(cdj::Befehl::ARR_FREEZE);
  e4.zeiger = f4.get();
  x.sende(e4);
  zyklen(100);   // läuft
  rampe();       // bricht ab
  zyklen(20);
  // Fix 2/P1: Ring voll (je Zyklus mindestens /uhr, 8192 Plätze), dann f5 (1 Beat) und dahinter f6 (abgelehnt)
  for (int i = 0; i < 4000 && x.kern->tempoplan_eintraege() > 0; ++i) zyklen(1);
  abholen = false;
  zyklen(9000);
  cdj::Befehl g5 = x.neu(cdj::Befehl::ARR_FREEZE);
  g5.zeiger = f5.get();
  x.sende(g5);
  zyklen(20);
  cdj::Befehl g6 = x.neu(cdj::Befehl::ARR_FREEZE);   // f5 läuft: ueberlappung
  g6.zeiger = f6.get();
  x.sende(g6);
  zyklen(3 * 22500 / N + 20);   // f5 endet bei vollem Ring
  int im_ring = 0;              // was im vollen Ring stand (außerhalb des Fensters geleert): keine der beiden Rückgaben
  {
    cdj::Ereignis e;
    while (x.ere->hole(e)) im_ring += e.art == cdj::Ereignis::ARR_FREEZE;
  }
  abholen = true;
  const int rueck_vor = rueck;
  zyklen(4);                    // freeze_nachreichen im Fenster
  const int nachgereicht = rueck - rueck_vor;
  // Fix 2/P3: /k/set/neu mitten im laufenden Freeze (f7), dann mitten im wartenden (f8, ein Zyklus nach der Annahme)
  auto set_neu = [&](double bpm) {
    cdj::Befehl n = x.neu(cdj::Befehl::SET_NEU);
    n.bpm = bpm;
    x.sende(n);
  };
  cdj::Befehl g7 = x.neu(cdj::Befehl::ARR_FREEZE);
  g7.zeiger = f7.get();
  x.sende(g7);
  zyklen(100);   // läuft (Einsatz nach 3n + 25)
  const bool f7_lief = x.kern->arrangement().freeze_laeuft() && f7->start_s > 0;
  set_neu(100.0);
  zyklen(20);
  cdj::Befehl g8 = x.neu(cdj::Befehl::ARR_FREEZE);
  g8.zeiger = f8.get();
  x.sende(g8);
  zyklen(1);     // angenommen, wartet auf den Einsatz
  const bool f8_wartete = x.kern->arrangement().freeze_laeuft();
  set_neu(128.0);
  zyklen(20);
  const AbfangZahlen positiv = abfang_gegenprobe();
  std::printf("freeze_alloc: im Zyklus %ld Allokationen, %ld free, %ld Sperren, %ld Schlafen | Gegenprobe %ld/%ld/%ld/%ld | "
              "Rückgaben %d, Status %d/%d/%d/%d, Noten %zu | voller Ring: im Ring %d, nachgereicht %d | set/neu: f7 %d "
              "(ende_s %lld), f8 %d (start_s %lld)\n",
              im_zyklus.alloc, im_zyklus.frei, im_zyklus.sperren, im_zyklus.schlafen, positiv.alloc, positiv.frei,
              positiv.sperren, positiv.schlafen, rueck, f1->status, f2->status, f4->status, f5->status, wirt.ev.size(),
              im_ring, nachgereicht, f7->status, static_cast<long long>(f7->ende_s), f8->status,
              static_cast<long long>(f8->start_s));
  PRUEF(positiv.alloc == 1 && positiv.frei == 1 && positiv.sperren == 4 && positiv.schlafen == 2);   // je Aufruf genau einmal
  PRUEF(im_zyklus.alloc == 0 && im_zyklus.frei == 0 && im_zyklus.sperren == 0 && im_zyklus.schlafen == 0);
  PRUEF(im_ring == 0 && nachgereicht == 2 && f5->status == 0 && f5->ende_s > 0);   // der Wartepfad lief
  PRUEF(f7_lief && f7->status == 1 && f7->ende_s == 0);       // abgebrochen am Sample 0 der neuen Achse
  PRUEF(f8_wartete && f8->status == 1 && f8->ende_s == 0);    // wartend abgebrochen, ohne Einsatz
  PRUEF(rueck == 8 && f1->status == 0 && f2->status == 1 && f4->status == 1 && f4->start_s > 0 && wirt.ev.size() > 20);
  PRUEF_ENDE();
}
