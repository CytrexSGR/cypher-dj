// Plan MVP 2 Task 4: Loop-Boxen im Kern. Ein 4-Takt-Loop mit einem Impuls (0,5) auf Frame 0 in L1 (pad/1, Fader 0 dB).
// Start bei Beat 5 setzt auf Beat 8 ein; phasenstarr steht die Box dort in Takt 3 ihres Loops, der Impuls kommt also
// auf Beat 16 und 32 (nicht auf 8 und 24). Der Isolator verschmiert den Impuls (kanalzug.cpp Schritt 3), darum:
// Abstand am Master genau 16 · SPB, Versatz zur Sollstelle 16 · SPB + Vorhalt in [0, 200). Fehlerfall
// test_kern_loop_mutation (Position ab dem Einsatz) legt den Impuls auf Beat 8 und scheitert. Dazu /e/loop-Folge,
// /pegel pad/1, Stop Cypher lehnt cypher-Befehle ab. Negativ-Kontrolle: Fader −200 → kein Impuls am Master.
#include "cypherdj/loopbox.h"
#include "kern35.h"

bool g_waechter = false;

using namespace k35;

static cdj::Loop impuls() {
  cdj::Loop l;
  l.name = "impuls";
  l.beats = 16;
  l.frames = 16 * SPB;
  l.daten.assign((size_t)l.frames * 2, 0.0f);
  l.daten[0] = l.daten[1] = 0.5f;
  return l;
}

// Keylock: Variante von o für das Renderttempo tr (name wie das Original, frames' = llround(frames · 128 / tr)).
static cdj::Loop variante_von(const cdj::Loop& o, double tr) {
  cdj::Loop v = o;
  v.bpm = tr;
  v.frames = std::llround((double)o.frames * 128.0 / tr);
  v.daten.assign((size_t)v.frames * 2, 0.0f);
  return v;
}

static void lauf(const std::string& ab, float fader_db, std::vector<int64_t>* k, std::vector<cdj::Ereignis>* loop_ev,
                 float* pegel) {
  cdj::Loop lp = impuls();
  Lauf x(ab, nullptr);
  auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
  b.deck = 1;
  b.zeiger = &lp;
  x.sende(b);
  x.teil("pad/1/fader", fader_db, 0.0, 0.0);
  x.zyklen(5 * SPB);
  auto s = x.neu(cdj::Befehl::LOOP_START, "andreas");
  s.deck = 1;
  const int64_t sid = x.sende(s);
  x.zyklen(34 * SPB);
  *k = x.klicks(0, 34 * SPB);
  *loop_ev = x.alle(cdj::Ereignis::LOOP);
  PRUEF(x.quittung(sid, 1) != nullptr);
  PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).empty());  // kein Tausch, nichts freizugeben
  *pegel = -999.0f;
  for (const auto& e : x.alle(cdj::Ereignis::PEGEL, "pad/1")) *pegel = std::max(*pegel, e.pegel[0]);
}

int main() {
  Arbeitsbestand ab("test_kern_loop");
  std::vector<int64_t> k;
  std::vector<cdj::Ereignis> ev;
  float p = 0;
  lauf(ab.pfad, 0.0f, &k, &ev, &p);
  Lauf ref(ab.pfad, nullptr);
  const int64_t soll = 16 * SPB + ref.vh;
  const int64_t versatz = k.empty() ? -1 : k[0] - soll;
  std::printf("loop: Einsätze %zu, erster %lld (Soll ab %lld, Versatz %lld), Abstand %lld (Soll %lld), Pegel pad/1 %.2f dB\n",
              k.size(), k.empty() ? -1LL : (long long)k[0], (long long)soll, (long long)versatz,
              k.size() > 1 ? (long long)(k[1] - k[0]) : -1LL, (long long)(16 * SPB), p);
  PRUEF(k.size() == 2 && k[1] - k[0] == 16 * SPB);
  PRUEF(versatz >= 0 && versatz < 200);
  PRUEF(p > -20.0f && p <= -5.9f);
  // /e/loop: bereit (Laden), wartet (Start), läuft am Sample von Beat 8
  PRUEF(ev.size() == 3 && ev[0].status == 1 && ev[1].status == 2 && ev[2].status == 3 && ev[2].sample == 8 * SPB &&
        ev[2].deck == 1 && ev[2].fassung == 16 && !std::strcmp(ev[2].pfad, "impuls"));
  // Negativ-Kontrolle: Fader unten → kein Impuls am Master
  lauf(ab.pfad, -200.0f, &k, &ev, &p);
  PRUEF(k.empty());
  {  // Stop Cypher: cypher darf nicht starten, andreas schon; leere Box: nicht_geladen
    cdj::Loop lp = impuls();
    Lauf x(ab.pfad, nullptr);
    auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b.deck = 1;
    b.zeiger = &lp;
    x.sende(b);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.zyklen(2 * N);
    auto c = x.neu(cdj::Befehl::LOOP_START, "cypher");
    c.deck = 1;
    const int64_t cid = x.sende(c);
    auto a = x.neu(cdj::Befehl::LOOP_START, "andreas");
    a.deck = 1;
    const int64_t aid = x.sende(a);
    auto leer = x.neu(cdj::Befehl::LOOP_START, "andreas");
    leer.deck = 2;
    const int64_t lid = x.sende(leer);
    x.zyklen(4 * N);
    const Q* qc = x.quittung(cid, 6);
    const Q* ql = x.quittung(lid, 6);
    PRUEF(qc && qc->grund == "ki_gestoppt");
    PRUEF(x.quittung(aid, 1) != nullptr);
    PRUEF(ql && ql->grund == "nicht_geladen");
  }
  {  // Plan Grid (§4.9 /k/loop/raster): Versatz 1 Beat vor dem Start → der Impuls (Frame 0) kommt 1 Beat früher (Beat 15
     // statt 16); Quittungen 1 und 3; leere Box 2: nicht_geladen; Betrag = frames: ausserhalb_bereich
    cdj::Loop lp = impuls();
    Lauf x(ab.pfad, nullptr);
    auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b.deck = 1;
    b.zeiger = &lp;
    x.sende(b);
    x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
    x.zyklen(2 * SPB);
    auto r = x.neu(cdj::Befehl::LOOP_RASTER, "andreas");
    r.deck = 1;
    r.versatz_f = SPB;
    const int64_t rid = x.sende(r);
    auto r2 = x.neu(cdj::Befehl::LOOP_RASTER, "andreas");
    r2.deck = 2;
    const int64_t rid2 = x.sende(r2);
    auto r3 = x.neu(cdj::Befehl::LOOP_RASTER, "andreas");
    r3.deck = 1;
    r3.versatz_f = 16 * SPB;
    const int64_t rid3 = x.sende(r3);
    x.zyklen(5 * SPB);
    auto st = x.neu(cdj::Befehl::LOOP_START, "andreas");
    st.deck = 1;
    x.sende(st);
    x.zyklen(34 * SPB);
    const auto kv = x.klicks(0, 34 * SPB);
    std::printf("loop raster: Einsätze %zu, erster %lld (Soll ab %lld)\n", kv.size(), kv.empty() ? -1LL : (long long)kv[0],
                (long long)(soll - SPB));
    PRUEF(kv.size() == 2 && kv[0] - (soll - SPB) >= 0 && kv[0] - (soll - SPB) < 200 && kv[1] - kv[0] == 16 * SPB);
    PRUEF(x.quittung(rid, 1) && x.quittung(rid, 3));
    PRUEF(x.quittung(rid2, 6) && x.quittung(rid2, 6)->grund == "nicht_geladen");
    PRUEF(x.quittung(rid3, 6) && x.quittung(rid3, 6)->grund == "ausserhalb_bereich");
  }
  {  // Plan Tempo-Folge: bei 130 BPM spielt die Box im Master-Tempo. Burst (8 Frames 0,5) am Anfang eines
     // 16-Beat-Loops: zwei Durchläufe liegen 16 Beats bei 130 BPM auseinander = 354 461,5 Samples (nicht 360 000).
    cdj::Loop lp = impuls();
    for (int i = 0; i < 16; ++i) lp.daten[(size_t)i] = 0.5f;
    Lauf x(ab.pfad, nullptr);
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = 130.0;
    x.sende(sn);
    x.zyklen(4 * N);
    auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b.deck = 1;
    b.zeiger = &lp;
    x.sende(b);
    x.teil("pad/1/fader", 0.0f, 0.0, 0.0);
    x.zyklen(2 * SPB);
    auto st = x.neu(cdj::Befehl::LOOP_START, "andreas");
    st.deck = 1;
    x.sende(st);
    const int64_t bis = 40 * 22154;  // 40 Beats bei 130 BPM: Bursts auf Beat 16 und 32, Beat 48 liegt dahinter
    x.zyklen(bis);
    const auto kv = x.klicks(0, bis);
    std::printf("loop 130: Einsätze %zu, Abstand %lld (Soll 354462 ±3; 128er-Raster wäre 360000)\n", kv.size(),
                kv.size() > 1 ? (long long)(kv[1] - kv[0]) : -1LL);
    PRUEF(kv.size() == 2 && std::llabs((kv[1] - kv[0]) - 354462) <= 3);
    for (const auto& e : x.alle(cdj::Ereignis::LOOP)) PRUEF(e.status != 5);
  }
  {  // Keylock (Plan 2026-09-30, Slice 2): Befehl::LOOP_VARIANTE. Die abgelöste Variante geht wie ein alter Loop als
     // LOOP_ALT zurück, ebenso die Variante beim Laden eines neuen Loops und eine für eine leere Box. Jeder Zeiger genau einmal.
    cdj::Loop lp = impuls();
    cdj::Loop lp2 = impuls();
    const cdj::Loop v1 = variante_von(lp, 130.0), v2 = variante_von(lp, 130.0), v3 = variante_von(lp, 130.0);
    Lauf x(ab.pfad, nullptr);
    auto var = [&](int box, const cdj::Loop* v) {
      auto c = x.neu(cdj::Befehl::LOOP_VARIANTE, "andreas");
      c.deck = box;
      c.zeiger = v;
      x.sende(c);
    };
    var(2, &v3);  // Box 2 leer: die Variante kommt zurück
    auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b.deck = 1;
    b.zeiger = &lp;
    x.sende(b);
    var(1, &v1);
    x.zyklen(2 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == 1 && x.alle(cdj::Ereignis::LOOP_ALT)[0].zeiger == &v3);
    var(1, &v2);  // ersetzt v1: v1 zurück (Box steht, nichts klingt)
    x.zyklen(4 * N);  // zyklen() zählt absolut
    auto al = x.alle(cdj::Ereignis::LOOP_ALT);
    PRUEF(al.size() == 2 && al[1].zeiger == &v1);
    auto b2 = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b2.deck = 1;
    b2.zeiger = &lp2;
    x.sende(b2);  // neuer Loop: der alte (lp) und die Variante v2 zurück
    x.zyklen(6 * N);
    al = x.alle(cdj::Ereignis::LOOP_ALT);
    bool lp_da = false, v2_da = false;
    for (const auto& e : al) {
      lp_da = lp_da || e.zeiger == &lp;
      v2_da = v2_da || e.zeiger == &v2;
    }
    std::printf("loop variante: LOOP_ALT %zu (v3, v1, lp, v2), lp %d, v2 %d\n", al.size(), (int)lp_da, (int)v2_da);
    PRUEF(al.size() == 4 && lp_da && v2_da);
    // Negativ-Kontrolle: Variante nullptr auf Box ohne Variante gibt nichts zurück
    var(1, nullptr);
    x.zyklen(8 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == 4);
  }
  {  // F4 (Slice 2b): die Box läuft bei 130 BPM auf v1; v2 ersetzt sie, v1 klingt noch (Blende). Erst nach der Blende geht v1
     // aus block() über den Ring: dafür braucht der Kern loops_frei(s0) nach dem Block, genau einmal.
    const cdj::Loop lp = impuls();
    const cdj::Loop v1 = variante_von(lp, 130.0), v2 = variante_von(lp, 130.0);
    Lauf x(ab.pfad, nullptr);
    auto sn = x.neu(cdj::Befehl::SET_NEU);
    sn.bpm = 130.0;
    x.sende(sn);
    x.zyklen(4 * N);
    cdj::Loop lpk = lp;
    auto b = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b.deck = 1;
    b.zeiger = &lpk;
    x.sende(b);
    auto v = x.neu(cdj::Befehl::LOOP_VARIANTE, "andreas");
    v.deck = 1;
    v.zeiger = &v1;
    x.sende(v);
    x.zyklen(2 * SPB);
    auto st = x.neu(cdj::Befehl::LOOP_START, "andreas");
    st.deck = 1;
    x.sende(st);
    x.zyklen(6 * SPB);  // Einsatz auf Beat 4 (Sample ≈ 88 600), die Box spielt v1
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).empty());
    v.id = ++x.id;
    v.zeiger = &v2;
    x.sende(v);
    x.zyklen(x.kern->sample() + N);  // ein Block: die Blende läuft, v1 klingt noch
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).empty());
    x.zyklen(x.kern->sample() + 10 * N);  // Blende (960 Frames) vorbei
    const auto al = x.alle(cdj::Ereignis::LOOP_ALT);
    std::printf("loop variante spaet: LOOP_ALT %zu (Soll 1: v1)\n", al.size());
    PRUEF(al.size() == 1 && al[0].zeiger == &v1);
    x.zyklen(x.kern->sample() + 10 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == 1);  // genau einmal
    // F4 zweiter Abholpunkt: laden eines neuen Loops, während v2 klingt: die Variante kommt in DERSELBEN Meldung wie der alte
    // Loop, also vor der Quittung des Ladens (loops_frei(sample_) im Befehl), nicht erst mit dem Block danach.
    cdj::Loop lp2 = impuls();
    auto b2 = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b2.deck = 1;
    b2.zeiger = &lp2;
    const int64_t lid = x.sende(b2);
    x.zyklen(x.kern->sample() + 4 * N);
    int i_v2 = -1, i_lp = -1, i_q = -1;
    for (int i = 0; i < (int)x.ev.size(); ++i) {
      const auto& e = x.ev[i];
      if (e.art == cdj::Ereignis::LOOP_ALT && e.zeiger == &v2) i_v2 = i;
      if (e.art == cdj::Ereignis::LOOP_ALT && e.zeiger == &lpk) i_lp = i;
      if (e.art == cdj::Ereignis::QUITTUNG && e.id == lid && e.status == 1) i_q = i;
    }
    std::printf("loop variante laden: Reihenfolge lp %d, v2 %d, Quittung %d\n", i_lp, i_v2, i_q);
    PRUEF(i_v2 >= 0 && i_lp >= 0 && i_q >= 0 && i_lp < i_v2 && i_v2 < i_q);
    // Negativ-Kontrolle: laden ohne klingende Variante meldet keine Variante
    const size_t n_alt = x.alle(cdj::Ereignis::LOOP_ALT).size();
    cdj::Loop lp3 = impuls();
    auto b3 = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    b3.deck = 1;
    b3.zeiger = &lp3;
    x.sende(b3);
    x.zyklen(x.kern->sample() + 4 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == n_alt + 1);  // nur lp2
  }
  {  // F2 (Slice 2b): Variante eines anderen Loops: nicht angenommen, kommt als LOOP_ALT zurück; die passende wird angenommen
    cdj::Loop a = impuls(), bb = impuls();
    a.name = "a";
    bb.name = "b";
    const cdj::Loop vb = variante_von(bb, 130.0), va = variante_von(a, 130.0);
    Lauf x(ab.pfad, nullptr);
    auto l = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    l.deck = 1;
    l.zeiger = &a;
    x.sende(l);
    auto v = x.neu(cdj::Befehl::LOOP_VARIANTE, "andreas");
    v.deck = 1;
    v.zeiger = &vb;
    x.sende(v);
    x.zyklen(2 * N);
    auto al = x.alle(cdj::Ereignis::LOOP_ALT);
    PRUEF(al.size() == 1 && al[0].zeiger == &vb);
    v.id = ++x.id;
    v.zeiger = &va;
    x.sende(v);
    x.zyklen(4 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == 1);  // va angenommen: nichts kommt zurück
  }
  {  // F7 (Slice 2b): Stopp-Taste: die Variante einer cypher-Quelle geht ungenutzt zurück, die Box behält keine
    cdj::Loop a = impuls();
    const cdj::Loop v = variante_von(a, 130.0), w = variante_von(a, 130.0);
    Lauf x(ab.pfad, nullptr);
    auto l = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    l.deck = 1;
    l.zeiger = &a;
    x.sende(l);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.zyklen(2 * N);
    auto c = x.neu(cdj::Befehl::LOOP_VARIANTE, "cypher");
    c.deck = 1;
    c.zeiger = &v;
    x.sende(c);
    x.zyklen(4 * N);
    auto al = x.alle(cdj::Ereignis::LOOP_ALT);
    PRUEF(al.size() == 1 && al[0].zeiger == &v);
    // Negativ-Kontrolle: andreas darf trotz Stopp, die Variante wird angenommen (nichts kommt zurück) und bleibt der Box
    auto m = x.neu(cdj::Befehl::LOOP_VARIANTE, "andreas");
    m.deck = 1;
    m.zeiger = &w;
    x.sende(m);
    x.zyklen(6 * N);
    PRUEF(x.alle(cdj::Ereignis::LOOP_ALT).size() == 1);
    // die Box behielt v nicht: ein neuer Loop gibt nur a und w zurück, v nicht ein zweites Mal
    cdj::Loop a2 = impuls();
    auto l2 = x.neu(cdj::Befehl::LOOP_LADEN, "andreas");
    l2.deck = 1;
    l2.zeiger = &a2;
    x.sende(l2);
    x.zyklen(8 * N);
    int n_v = 0, n_w = 0;
    for (const auto& e : x.alle(cdj::Ereignis::LOOP_ALT)) {
      n_v += e.zeiger == &v;
      n_w += e.zeiger == &w;
    }
    PRUEF(n_v == 1 && n_w == 1);
  }
  PRUEF_ENDE();
}
