// Plan MVP 2 Scheibe 2 Task 4: Mitschnitt (REC auf C) im Kern. Prüfklick Z1 auf erz/1 (Befehl::KLICK, an 1, pfad
// "erz/1") ab Beat 0; REC 1 Takt (Befehl::MITSCHNITT) bei Beat ≈ 2 setzt ab_beat auf 4 (nächstes Vielfaches von
// 4 · 1 Beats), ab_sample 90 000. Der Puffer muss bitgleich sein mit einem frischen cdj::Klick, der über
// [90 000, 180 000) in Blöcken zu 256 gerendert wird (wie kern35::N; erz/1 trägt in diesem Test nur den Klick, kein
// Strudel-Strom). Fehlerfall test_kern_mitschnitt_mutation (Einsatz am Blockanfang statt ab_sample) scheitert:
// Versatz 90 000 mod 256 = 144 Samples. Dazu Stop Cypher, Tempo ≠ 128 und Überlappung (§16.2 Gründe).
#include "cypherdj/klick.h"
#include "cypherdj/loop.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

static cdj::Mitschnitt* neuer_mitschnitt(int takte) {  // Scheibe 3: Länge in Beats = 4 · takte
  auto* mt = new cdj::Mitschnitt();
  std::snprintf(mt->name, sizeof mt->name, "rec1");
  mt->beats = 4 * takte;
  mt->frames = (int64_t)mt->beats * SPB;
  mt->daten.assign((size_t)mt->frames * 2, -999.0f);
  return mt;
}

int main() {
  Arbeitsbestand ab("test_kern_mitschnitt");
  {  // 1. bitgleich gegen einen frischen Klick
    Lauf x(ab.pfad, nullptr);
    auto k = x.neu(cdj::Befehl::KLICK, "pruefstand");
    k.an = 1;
    std::snprintf(k.pfad, sizeof k.pfad, "erz/1");
    x.sende(k);
    x.zyklen(2 * SPB);  // Beat ~2
    cdj::Mitschnitt* mt = neuer_mitschnitt(1);
    auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r.nr = 1;
    std::snprintf(r.pfad, sizeof r.pfad, "rec1");
    r.zeiger = mt;
    const int64_t rid = x.sende(r);
    x.zyklen(200000);
    PRUEF(x.quittung(rid, 1) != nullptr);
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    PRUEF(mev.size() == 1 && mev[0].status == 0 && mev[0].sample == 90000 && mev[0].beat == 4.0 &&
          mev[0].fassung == 4 && !std::strcmp(mev[0].pfad, "rec1") && mev[0].zeiger == mt);
    PRUEF(mt->gefuellt == mt->frames && mt->ab_sample == 90000 && mt->ab_beat == 4.0);

    // Referenz: frischer Klick, [90000, 180000) in Blöcken zu 256
    cdj::Karte karte(128.0, 0);
    cdj::Klick klick;
    klick.an();
    std::vector<float> soll((size_t)mt->frames * 2, 0.0f);
    std::vector<float> rl(N), rr(N);
    cdj::KlickEinsatz e[8];
    for (int64_t s = 0; s < 180000; s += N) {
      std::fill(rl.begin(), rl.end(), 0.0f);
      std::fill(rr.begin(), rr.end(), 0.0f);
      klick.block(karte, s, N, rl.data(), rr.data(), e, 8);
      if (s + N > 90000) {
        const int64_t von = std::max(s, (int64_t)90000);
        const int64_t bis = std::min(s + N, (int64_t)180000);
        for (int64_t t = von; t < bis; ++t) {
          soll[(size_t)(2 * (t - 90000))] = rl[(size_t)(t - s)];
          soll[(size_t)(2 * (t - 90000) + 1)] = rr[(size_t)(t - s)];
        }
      }
    }
    int falsch = 0;
    for (size_t i = 0; i < soll.size(); ++i)
      if (soll[i] != mt->daten[i]) ++falsch;
    std::printf("mitschnitt: gefuellt %lld (Soll %lld), ab_sample %lld, falsche Werte %d von %zu\n",
                (long long)mt->gefuellt, (long long)mt->frames, (long long)mt->ab_sample, falsch, soll.size());
    PRUEF(falsch == 0);
    delete mt;
  }
  {  // 2. (Plan Tempo-Folge) festes Tempo 130: angenommen. Kopiert werden 4 Beats bei 130 BPM: von llround(88 615,38)
     // bis llround(177 230,77) = 88 616 Frames (roh_frames); frames bleibt 90 000, das Ziel der Umrechnung (R3, Keylock Slice 4)
     // vor dem Schreiben. In einer laufenden Rampe: ausserhalb_bereich, der Puffer kommt als Ereignis zurück.
    Lauf x(ab.pfad, nullptr);
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = 130.0;
    x.sende(sn);
    x.zyklen(4 * N);
    cdj::Mitschnitt* mt = neuer_mitschnitt(1);
    mt->daten.assign((size_t)cdj::mitschnitt_max_frames(mt->beats) * 2, -999.0f);
    auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r.nr = 1;
    r.zeiger = mt;
    const int64_t rid = x.sende(r);
    x.zyklen(10 * 22154);
    PRUEF(x.quittung(rid, 1) != nullptr && x.quittung(rid, 6) == nullptr);
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    std::printf("mitschnitt 130: Ereignisse %zu, roh_frames %lld (Soll 88616), gefuellt %lld, frames %lld, bpm %.2f\n",
                mev.size(), (long long)mt->roh_frames, (long long)mt->gefuellt, (long long)mt->frames, mt->bpm);
    PRUEF(mev.size() == 1 && mev[0].status == 0 && mev[0].zeiger == mt);
    PRUEF(mt->roh_frames == 88616 && mt->gefuellt == 88616 && mt->frames == 4 * SPB && mt->bpm == 130.0);
    delete mt;
    Lauf y(ab.pfad, nullptr);  // Rampe 128 → 140 über 64 Beats läuft: REC abgelehnt
    auto rp = y.neu(cdj::Befehl::TEMPO_RAMPE, "andreas");
    rp.ab_beat = 1.0;
    rp.ziel_bpm = 140.0;
    rp.dauer_beats = 64.0;
    y.sende(rp);
    y.zyklen(2 * SPB);
    cdj::Mitschnitt* m2 = neuer_mitschnitt(1);
    m2->daten.assign((size_t)cdj::mitschnitt_max_frames(m2->beats) * 2, -999.0f);
    auto r2 = y.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r2.nr = 1;
    r2.zeiger = m2;
    const int64_t rid2 = y.sende(r2);
    y.zyklen(2 * SPB + 8 * N);
    const Q* q2 = y.quittung(rid2, 6);
    std::printf("mitschnitt in der Rampe: Quittung 6 %s\n", q2 ? q2->grund.c_str() : "(keine)");
    PRUEF(q2 && q2->grund == "ausserhalb_bereich");
    auto mev2 = y.alle(cdj::Ereignis::MITSCHNITT);
    PRUEF(mev2.size() == 1 && mev2[0].status == 1 && mev2[0].zeiger == m2);
    delete m2;
  }
  {  // 2b. (Keylock Slice 4, F3) eine WARTENDE Rampe, die erst nach dem Mitschnitt beginnt, verhindert REC nicht mehr. REC
     // 4 Beats bei Beat ≈ 2 nimmt Beat 4 bis 8 auf; abgelehnt wird nur, wenn eine Rampe vor Beat 8 beginnt (oder läuft).
     // Fälle: Rampe ab Beat 40 (Mitschnitt gilt), ab Beat 8,0 (auf dem End-Beat, gilt), ab Beat 7,5 (beginnt vor dem Ende:
     // abgelehnt), ab Beat 3 (beginnt vor dem Einsatz: abgelehnt). Jedes Mal die Quittung und das Ereignis des Kerns.
    struct Fall { double rampe_ab; bool gilt; const char* titel; };
    const Fall faelle[] = {{40.0, true, "Rampe ab Beat 40 wartet"}, {8.0, true, "Rampe ab End-Beat 8"},
                           {7.5, false, "Rampe ab Beat 7,5 (vor dem Ende)"}, {3.0, false, "Rampe ab Beat 3 (vor dem Einsatz)"}};
    for (const Fall& fl : faelle) {
      Lauf x(ab.pfad, nullptr);
      auto rp = x.neu(cdj::Befehl::TEMPO_RAMPE, "andreas");
      rp.ab_beat = fl.rampe_ab;
      rp.ziel_bpm = 140.0;
      rp.dauer_beats = 16.0;
      x.sende(rp);
      x.zyklen(2 * SPB);  // Beat 2: die Rampe wartet
      cdj::Mitschnitt* mt = neuer_mitschnitt(1);
      auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
      r.nr = 1;
      r.zeiger = mt;
      const int64_t rid = x.sende(r);
      x.zyklen(9 * SPB);  // bis Beat 9: der Mitschnitt (Beat 4 bis 8) ist vorbei, falls er gilt
      const Q* q1 = x.quittung(rid, 1);
      const Q* q6 = x.quittung(rid, 6);
      auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
      std::printf("2b %s: Quittung 1 %s, Quittung 6 %s, Ereignisse %zu Status %d, gefuellt %lld roh %lld bpm %.1f (Soll %s)\n", fl.titel,
                  q1 ? "ja" : "nein", q6 ? q6->grund.c_str() : "nein", mev.size(), mev.empty() ? -1 : mev[0].status,
                  (long long)mt->gefuellt, (long long)mt->roh_frames, mt->bpm, fl.gilt ? "gilt" : "abgelehnt");
      PRUEF(mev.size() == 1 && mev[0].zeiger == mt);
      if (fl.gilt) {
        PRUEF(q1 != nullptr && q6 == nullptr && mev[0].status == 0);
        PRUEF(!mt->abgebrochen && mt->roh_frames == 4 * SPB && mt->gefuellt == mt->roh_frames && mt->bpm == 128.0);
      } else {
        PRUEF(q1 == nullptr && q6 != nullptr && q6->grund == "ausserhalb_bereich" && mev[0].status == 1);
        PRUEF(mt->gefuellt == 0);
      }
      delete mt;
    }
  }
  {  // 3. Stop Cypher lehnt Quelle cypher ab; andreas darf; ein zweiter Mitschnitt während des ersten: ueberlappung
    Lauf x(ab.pfad, nullptr);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.zyklen(2 * N);
    cdj::Mitschnitt* mtc = neuer_mitschnitt(1);
    auto c = x.neu(cdj::Befehl::MITSCHNITT, "cypher");
    c.zeiger = mtc;
    const int64_t cid = x.sende(c);
    cdj::Mitschnitt* mta = neuer_mitschnitt(1);
    auto a = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    a.zeiger = mta;
    const int64_t aid = x.sende(a);
    cdj::Mitschnitt* mtb = neuer_mitschnitt(1);
    auto b = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    b.zeiger = mtb;
    const int64_t bid = x.sende(b);
    x.zyklen(4 * N);
    const Q* qc = x.quittung(cid, 6);
    const Q* qb = x.quittung(bid, 6);
    PRUEF(qc && qc->grund == "ki_gestoppt");
    PRUEF(x.quittung(aid, 1) != nullptr);
    PRUEF(qb && qb->grund == "ueberlappung");
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    PRUEF(mev.size() == 2 && mev[0].zeiger == mtc && mev[0].status == 1 && mev[1].zeiger == mtb && mev[1].status == 1);
    delete mtc;
    delete mtb;
    x.zyklen(400000);  // mta läuft frei zu Ende; die Freigabe übernimmt das Netz (hier: der Test)
    auto mev2 = x.alle(cdj::Ereignis::MITSCHNITT);
    PRUEF(mev2.size() == 3 && mev2[2].zeiger == mta && mev2[2].status == 0);
    delete mta;
  }
  {  // 4. (Plan-Review) 2 Takte, REC bei Beat ≈ 9: Einsatz auf dem nächsten Vielfachen von 4 · 2 = 8 Beats, also
     // Beat 16 (nicht die Takt-Eins 12), damit der Loop in der Box an derselben Stelle weiterläuft (Entscheidung 3)
    Lauf x(ab.pfad, nullptr);
    x.zyklen(9 * SPB);
    cdj::Mitschnitt* mt = neuer_mitschnitt(2);
    auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r.nr = 2;
    r.zeiger = mt;
    x.sende(r);
    x.zyklen(25 * SPB);  // zyklen() läuft bis zu einem absoluten Sample: Einsatz 360 000 + 180 000 < 562 500
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    std::printf("zwei takte: ab_beat %.1f (Soll 16.0) ab_sample %lld gefuellt %lld (Soll 180000)\n", mt->ab_beat,
                (long long)mt->ab_sample, (long long)mt->gefuellt);
    PRUEF(mt->ab_beat == 16.0 && mt->ab_sample == 16 * SPB);
    PRUEF(mev.size() == 1 && mev[0].status == 0 && mev[0].zeiger == mt && mt->gefuellt == 180000);
    delete mt;
  }
  {  // 5. (Plan-Review) /k/set/neu während eines laufenden Mitschnitts: abgebrochen, der Puffer kommt zurück
    Lauf x(ab.pfad, nullptr);
    x.zyklen(2 * SPB);
    cdj::Mitschnitt* mt = neuer_mitschnitt(1);
    auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r.nr = 1;
    r.zeiger = mt;
    x.sende(r);
    x.zyklen(5 * SPB);  // bis Beat 5 (absolut): der Mitschnitt läuft seit Beat 4
    PRUEF(mt->gefuellt > 0 && mt->gefuellt < mt->frames);
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = 128.0;
    x.sende(sn);
    x.zyklen(5 * SPB + 2 * N);  // der erste Zyklus verarbeitet SET_NEU (Zeitachse ab 0), danach weiter
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    std::printf("set_neu: Ereignisse %zu, status %d, gefuellt %lld\n", mev.size(), mev.empty() ? -1 : mev[0].status,
                (long long)mt->gefuellt);
    PRUEF(mev.size() == 1 && mev[0].status == 1 && mev[0].zeiger == mt);
    delete mt;
  }
  {  // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 1): endet ein Mitschnitt, während der Ereignisring voll ist, darf
     // /e/mitschnitt nicht verloren gehen (sonst Aufnahme weg und Puffer ohne Besitzer). Nach dem Leeren kommt es an.
    Lauf x(ab.pfad, nullptr);
    x.zyklen(2 * SPB);
    cdj::Mitschnitt* mt = neuer_mitschnitt(1);
    auto r = x.neu(cdj::Befehl::MITSCHNITT, "andreas");
    r.nr = mt->beats;
    std::snprintf(r.pfad, sizeof r.pfad, "rec1");
    r.zeiger = mt;
    const int64_t rid = x.sende(r);
    x.zyklen(3 * SPB);  // zyklen() läuft BIS zum Sample: angenommen, wartet auf Beat 4
    PRUEF(x.quittung(rid, 1) != nullptr);
    x.abholen = false;
    cdj::Ereignis leer{};
    leer.art = cdj::Ereignis::QUITTUNG;
    int voll = 0;
    while (x.ere->schiebe(leer)) ++voll;  // Ring randvoll
    const uint64_t verloren_vorher = x.kern->ereignisse_verloren();
    x.zyklen(200000);  // der Mitschnitt endet bei Sample 180 000, der Ring ist die ganze Zeit voll
    cdj::Ereignis e;
    int weg = 0;
    while (x.ere->hole(e)) ++weg;  // Platz schaffen (die Füller und was sonst kam)
    x.abholen = true;
    x.zyklen(200000 + 4 * N);
    auto mev = x.alle(cdj::Ereignis::MITSCHNITT);
    std::printf("ring_voll: gefuellt %d, danach geleert %d, verloren %llu -> %llu, MITSCHNITT danach %zu\n", voll, weg,
                (unsigned long long)verloren_vorher, (unsigned long long)x.kern->ereignisse_verloren(), mev.size());
    PRUEF(mev.size() == 1 && mev[0].status == 0 && mev[0].zeiger == mt && mt->gefuellt == mt->frames);
    delete mt;  // der Test ist hier das Netz und gibt frei
  }
  PRUEF_ENDE();
}
