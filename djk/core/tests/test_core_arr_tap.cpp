// 1.10 slice 7 (T5, /k/arr/abgriff): the tap in the kern, the sibling of test_kern_arr_freeze. Receipt 1 at acceptance, 2 at the onset sample (now + 2n + 25 + one cycle),
// 3 at the end of the window (no tail), /zustand/arr status 3; the job comes back exactly once as event ARR_ABGRIFF (0 done, 1 aborted, ARR_ABGRIFF_ABGELEHNT).
// Cases: 1 done (receipts, data in front of the fader for a track pre, post after it, one return), 2 abort by /k/arr/stopp (7 abbruch at the stop sample),
// 3 AI stop (the running tap of cypher aborts with ki_stopp, a new one of cypher is refused ki_gestoppt), 4 nicht_geladen, spur_bereich and ueberlappung with a freeze
// (a freeze and a tap never run together), 5 full event ring (the return waits in the kern and arrives when there is room), 6 behind a pending load (order kept),
// 7 tempo ramp (open ramp: tempo_rampe; a ramp during a running tap aborts it), 8 /k/set/neu aborts a running tap (7 abbruch at sample 0, status 1).
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_run.h"

bool g_waechter = false;

using k35::N;

namespace {

std::unique_ptr<cdj::ArrAbgriff> auftrag(int art, int nr, int punkt, double von, double bis) {
  auto f = std::make_unique<cdj::ArrAbgriff>();
  f->art = art;
  f->nr = nr;
  f->punkt = punkt;
  f->kennung = 3;
  f->von_beat = von;
  f->bis_beat = bis;
  f->kap = static_cast<int64_t>((bis - von) * 48000.0) + 2;
  f->daten.assign(static_cast<size_t>(f->kap) * 2, 0.0f);
  return f;
}

int64_t abgriff(arr35::Lauf& x, cdj::ArrAbgriff* f, const char* quelle = "andreas") {
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_ABGRIFF, quelle);
  b.nr = f->nr;
  b.zeiger = f;
  return x.sende(b);
}

std::vector<int32_t> rueck(const arr35::Lauf& x, const cdj::ArrAbgriff* f) {
  std::vector<int32_t> v;
  for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_ABGRIFF))
    if (e.zeiger == f) v.push_back(e.status);
  return v;
}

const std::string spur1(arr35::Lauf& x, const std::string& a) {
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "," + x.ordner.clip("c4", 4.0, 0.5, a, 4800) + "]}";
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_abgriff");
  {  // 1: done: receipts at the right samples, track pre in front of the fader, track post after it, return 1 missing (spur_bereich)
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff1");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.teil("spur/1/fader", -6.0f, 0.0, 0.0);
    x.lauf(10 * N);
    auto f = auftrag(0, 1, 0, 0.0, 4.0);
    const int64_t id = abgriff(x, f.get());
    x.lauf(10 * N + 4 * 22500 + 8 * N);
    const int64_t einsatz = 10 * N + 2 * N + 25 + N;
    PRUEF(x.quittung(id, 1) && x.quittung(id, 1)->sample == 10 * N);
    PRUEF(x.quittung(id, 2) && x.quittung(id, 2)->sample == einsatz);
    PRUEF(x.quittung(id, 3) && x.quittung(id, 3)->sample == einsatz + 4 * 22500);   // no tail
    PRUEF(f->start_s == einsatz && f->frames == 4 * 22500 && f->status == 0);
    PRUEF(f->daten[0] == 1.0f && f->daten[2 * 4 * 22500 - 2] == 0.0f);   // pre: in front of the fader (-6 dB would be 0.5)
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0});
    bool drei = false;
    for (const cdj::Ereignis& e : x.alle(cdj::Ereignis::ARR_ZUSTAND)) drei = drei || e.arr_status == 3;
    PRUEF(drei && x.kern->arrangement().status() == cdj::ArrStatus::steht);
    auto g = auftrag(0, 1, 1, 0.0, 4.0);   // post: after the fader and the pan law (centre -3 dB)
    const int64_t id2 = abgriff(x, g.get());
    x.lauf(x.kern->sample() + 4 * 22500 + 12 * N);
    PRUEF(x.quittung(id2, 3) && g->status == 0 && rueck(x, g.get()) == std::vector<int32_t>{0});
    PRUEF_NAH(g->daten[0], 0.5011872 * 0.70710678, 1e-5);
    auto h = auftrag(2, 1, 1, 0.0, 4.0);   // no return in the playback
    const int64_t id3 = abgriff(x, h.get());
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(id3, 6) && x.quittung(id3, 6)->grund == "spur_bereich" && rueck(x, h.get()) == std::vector<int32_t>{cdj::ARR_ABGRIFF_ABGELEHNT});
  }
  {  // 2: abort by /k/arr/stopp after one beat: receipt 7 abbruch at the stop sample, return status 1
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff2");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.lauf(10 * N);
    auto g = auftrag(0, 1, 1, 0.0, 4.0);
    const int64_t id2 = abgriff(x, g.get());
    x.lauf(x.kern->sample() + 22500);
    const int64_t st = x.stopp(0);
    x.lauf(x.kern->sample() + 4 * N);
    const k35::Q* q7 = x.quittung(id2, 7);
    PRUEF(q7 && q7->grund == "abbruch" && x.quittung(st, 3) && q7->sample == x.quittung(st, 3)->sample);
    PRUEF(!x.quittung(id2, 3) && rueck(x, g.get()) == std::vector<int32_t>{1} && g->status == 1);
  }
  {  // 3: AI stop: the running tap of cypher aborts with ki_stopp, a new one of cypher is refused
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff3");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.lauf(10 * N);
    auto f = auftrag(0, 1, 1, 0.0, 8.0);
    const int64_t id = abgriff(x, f.get(), "cypher");
    x.lauf(x.kern->sample() + 22500);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(id, 7) && x.quittung(id, 7)->grund == "ki_stopp" && rueck(x, f.get()) == std::vector<int32_t>{1});
    auto g = auftrag(0, 1, 1, 0.0, 8.0);
    const int64_t id2 = abgriff(x, g.get(), "cypher");
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(id2, 6) && x.quittung(id2, 6)->grund == "ki_gestoppt");
    PRUEF(rueck(x, g.get()) == std::vector<int32_t>{cdj::ARR_ABGRIFF_ABGELEHNT});
  }
  {  // 4: nicht_geladen; overlap with a freeze both ways
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff4");
    x.lauf(4 * N);
    auto f = auftrag(0, 1, 1, 0.0, 4.0);
    const int64_t id = abgriff(x, f.get());
    x.lauf(8 * N);
    PRUEF(x.quittung(id, 6) && x.quittung(id, 6)->grund == "nicht_geladen");
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{cdj::ARR_ABGRIFF_ABGELEHNT});
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.lauf(x.kern->sample() + 4 * N);
    auto fz = std::make_unique<cdj::ArrFreeze>();
    fz->spur = 1;
    fz->kennung = 1;
    fz->von_beat = 0.0;
    fz->bis_beat = 4.0;
    fz->kap = 6 * 48000 + 2;
    fz->daten.assign(static_cast<size_t>(fz->kap) * 2, 0.0f);
    cdj::Befehl bf = x.neu(cdj::Befehl::ARR_FREEZE, "andreas");
    bf.nr = 1;
    bf.zeiger = fz.get();
    x.sende(bf);
    x.lauf(x.kern->sample() + 2 * N);
    auto g = auftrag(0, 1, 1, 0.0, 4.0);
    const int64_t id2 = abgriff(x, g.get());
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(id2, 6) && x.quittung(id2, 6)->grund == "ueberlappung");
    x.stopp(0);
    x.lauf(x.kern->sample() + 4 * N);
    auto h = auftrag(0, 1, 1, 0.0, 4.0);
    const int64_t id3 = abgriff(x, h.get());
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(id3, 1));
    cdj::Befehl bf2 = x.neu(cdj::Befehl::ARR_FREEZE, "andreas");
    auto fz2 = std::make_unique<cdj::ArrFreeze>();
    fz2->spur = 1;
    fz2->kennung = 2;
    fz2->von_beat = 0.0;
    fz2->bis_beat = 4.0;
    fz2->kap = 6 * 48000 + 2;
    fz2->daten.assign(static_cast<size_t>(fz2->kap) * 2, 0.0f);
    bf2.nr = 1;
    bf2.zeiger = fz2.get();
    const int64_t idf = x.sende(bf2);
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(idf, 6) && x.quittung(idf, 6)->grund == "ueberlappung");
  }
  {  // 5: full event ring: the return waits in the kern and arrives when there is room (no leak)
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff5");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.lauf(4 * N);
    x.abholen = false;
    x.lauf(x.kern->sample() + 9000 * N);
    auto f = auftrag(0, 1, 1, 0.0, 1.0);
    abgriff(x, f.get());
    x.lauf(x.kern->sample() + 22500 + 8 * N);
    PRUEF(f->status == 0 && f->ende_s > 0);
    x.abholen = true;
    x.lauf(x.kern->sample() + 40 * N);
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0});
  }
  {  // 6: behind a pending load: a load that waits for room behind a return holds the tap back, it then runs on the new playback
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff6");
    const std::string a = x.ordner.impuls('a', 4800);
    const std::string sp = spur1(x, a);
    x.laden(1, sp);
    x.lauf(4 * N);
    x.abholen = false;
    x.lauf(x.kern->sample() + 9000 * N);
    x.laden(2, sp);
    x.lauf(x.kern->sample() + N);
    x.laden(3, sp);
    auto f = auftrag(0, 1, 1, 0.0, 1.0);
    const int64_t id = abgriff(x, f.get());
    x.lauf(x.kern->sample() + N);
    x.abholen = true;
    x.lauf(x.kern->sample() + 22500 + 40 * N);
    PRUEF(rueck(x, f.get()) == std::vector<int32_t>{0} && f->status == 0);
    PRUEF(x.quittung(id, 3) && !x.quittung(id, 7));
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 3);
  }
  {  // 7: tempo ramp: an open ramp refuses the tap (tempo_rampe); a ramp during a waiting or running tap aborts it (7 abbruch), the ramp itself stands
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff7");
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, spur1(x, a));
    x.lauf(10 * N);
    auto rampe = [&](const char* quelle) {
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
    const int64_t r1 = rampe("leitstand");
    x.lauf(x.kern->sample() + 2 * N);
    auto fa = auftrag(0, 1, 1, 0.0, 1.0);
    const int64_t ia = abgriff(x, fa.get());
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ia, 6) && x.quittung(ia, 6)->grund == "tempo_rampe" && !x.quittung(ia, 1));
    PRUEF(rueck(x, fa.get()) == std::vector<int32_t>{cdj::ARR_ABGRIFF_ABGELEHNT});
    PRUEF(bis_quittung(r1, 3));
    auto fc = auftrag(0, 1, 1, 0.0, 1.0);   // negative control: with the ramp over the tap runs
    const int64_t ic = abgriff(x, fc.get());
    PRUEF(bis_quittung(ic, 3) && !x.quittung(ic, 6));
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(rueck(x, fc.get()) == std::vector<int32_t>{0});
    auto fe = auftrag(0, 1, 1, 0.0, 8.0);
    const int64_t ie = abgriff(x, fe.get());
    PRUEF(bis_quittung(ie, 2));
    x.lauf(x.kern->sample() + 22500);
    const int64_t s_rampe = x.kern->sample();
    rampe("cypher");
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(x.quittung(ie, 7) && x.quittung(ie, 7)->grund == "abbruch" && x.quittung(ie, 7)->sample == s_rampe);
    PRUEF(!x.quittung(ie, 3) && rueck(x, fe.get()) == std::vector<int32_t>{1} && fe->ende_s == s_rampe);
  }
  {  // 8: /k/set/neu aborts a running tap at sample 0 of the new axis (7 abbruch, status 1, no 3, ende_s 0), the transport stands
    arr35::Lauf x(ab.pfad, "test_kern_arr_abgriff8");
    const std::string a = x.ordner.audio('b', 8 * 22500);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 8.0, a, 8 * 22500) + "]}");
    x.lauf(10 * N);
    auto set_neu = [&](double bpm) {
      cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
      b.bpm = bpm;
      return x.sende(b);
    };
    auto fa = auftrag(0, 1, 1, 0.0, 8.0);
    const int64_t ia = abgriff(x, fa.get());
    for (int i = 0; i < 40 && !x.quittung(ia, 2); ++i) x.lauf(x.kern->sample() + N);
    PRUEF(x.quittung(ia, 2) != nullptr);
    const int64_t einsatz = x.quittung(ia, 2) ? x.quittung(ia, 2)->sample : 0;
    x.lauf(einsatz + 22500);
    const int64_t sn = set_neu(100.0);
    const int64_t s_alt = x.kern->sample();
    x.lauf(s_alt + 2 * 22500);
    PRUEF(x.quittung(sn, 2));
    const k35::Q* q7 = x.quittung(ia, 7);
    PRUEF(q7 && q7->grund == "abbruch" && q7->sample == 0);
    PRUEF(!x.quittung(ia, 3) && rueck(x, fa.get()) == std::vector<int32_t>{1} && fa->status == 1 && fa->ende_s == 0);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht && !x.kern->arrangement().abgriff_laeuft());
  }
  PRUEF_ENDE();
}
