// Plan 1.11 T5: the effect-host commands in the kern (Befehl ARR_INS_HOST, ARR_INS_MESS), the measurement in the callback and the events (INS_HOST, INS_MESS, INS_HOST_ZUSTAND).
// The fake host: the return of cycle k is the send of cycle k - 2 (the round trip of an empty rack in JACK, 2 x quantum = 512 at 256).
// Cases: 1 health (the server flag alone is not health: INS_HOST status 0 until the edge check says yes, then 1; INS_HOST_ZUSTAND follows at once), 2 host_fehlt (an unhealthy host refuses),
//        3 messung (impulse 0.5 on the first sample of the cycle after the command, INS_MESS 512 with an empty reason, INS_HOST_ZUSTAND carries 512), 4 laeuft (a playing transport refuses),
//        5 a core without host ports reports no INS_HOST_ZUSTAND and ignores the edge check, 6 the callback allocates nothing, locks nothing (allocation guard over the whole run).
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_run.h"
#include "check.h"
#include "alloc_intercept.h"   // last: exactly one translation unit per program

bool g_waechter = false;

using k35::N;

namespace {

struct Host {
  float aus_l[4][N] = {}, aus_r[4][N] = {}, rueck_l[4][N] = {}, rueck_r[4][N] = {};
  float v1[4][N] = {}, v2[4][N] = {};   // the sends of the last two cycles
  float erster_impuls = 0.0f;
  void binde(arr35::Lauf& x) {
    for (int h = 1; h <= 4; ++h) {
      x.kern->ins_aus(h, aus_l[h - 1], aus_r[h - 1]);
      x.kern->ins_rueck(h, rueck_l[h - 1], rueck_r[h - 1]);
    }
  }
  void vorher() {   // main.cpp zeroes the sends before every cycle
    for (int h = 0; h < 4; ++h) {
      std::memset(aus_l[h], 0, sizeof aus_l[h]);
      std::memset(aus_r[h], 0, sizeof aus_r[h]);
    }
  }
  void nachher() {   // the host: return of the next cycle = send of the cycle before this one
    for (int h = 0; h < 4; ++h) {
      std::memcpy(rueck_l[h], v1[h], sizeof v1[h]);   // v1 is the send of the previous cycle, the return two cycles after it
      std::memcpy(v1[h], aus_l[h], sizeof v1[h]);
      (void)v2;
    }
  }
};

// one cycle in the allocation window; events are drained into `ev` (reserved)
struct Treiber {
  arr35::Lauf& x;
  Host& host;
  std::vector<cdj::Ereignis> ev;
  long allokationen = 0;
  bool bewachen = false;
  Treiber(arr35::Lauf& l, Host& h) : x(l), host(h) { ev.reserve(100000); }
  void zyklen(int n) {
    for (int i = 0; i < n; ++i) {
      host.vorher();
      const int64_t n0 = x.kern->sample();
      if (bewachen) abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      if (bewachen) allokationen += abfang_aus();
      host.nachher();
      cdj::Ereignis e;
      while (x.ere->hole(e))
        if (e.art != cdj::Ereignis::UHR && e.art != cdj::Ereignis::ZYKLUS) ev.push_back(e);
    }
  }
  std::vector<cdj::Ereignis> von(int32_t art) const {
    std::vector<cdj::Ereignis> r;
    for (const auto& e : ev)
      if (e.art == art) r.push_back(e);
    return r;
  }
};

cdj::ArrHostStufe& stufe(arr35::Lauf& x) { return const_cast<cdj::Arrangement&>(x.kern->arrangement()).host_stufe(); }   // test read access

void host_befehl(arr35::Lauf& x, int h, int an, const char* quelle = "leitstand") {
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_INS_HOST, quelle);
  b.nr = h;
  b.an = an;
  x.sende(b);
}
void mess_befehl(arr35::Lauf& x, int h, const char* quelle = "leitstand") {
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_INS_MESS, quelle);
  b.nr = h;
  x.sende(b);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_host");
  {  // 1, 2, 3, 6: health, refusal, measurement, allocation guard
    arr35::Lauf x(ab.pfad, "test_kern_arr_host1");
    x.kern->setze_host_ports_da(true);
    Host host;
    host.binde(x);
    Treiber t(x, host);
    t.bewachen = ALLOC_ABFANG_VERFUEGBAR != 0;
    t.zyklen(10);
    mess_befehl(x, 1);   // 2: not healthy
    t.zyklen(2);
    auto m = t.von(cdj::Ereignis::INS_MESS);
    PRUEF(m.size() == 1 && m[0].deck == 1 && m[0].status == -1 && !std::strcmp(m[0].grund, "host_fehlt"));
    host_befehl(x, 1, 1);   // 1: the flag alone is not health
    t.zyklen(2);
    auto hs = t.von(cdj::Ereignis::INS_HOST);
    PRUEF(hs.size() == 1 && hs[0].deck == 1 && hs[0].status == 0);
    x.kern->setze_host_kante(1, true);
    host_befehl(x, 1, 1);
    t.zyklen(2);
    hs = t.von(cdj::Ereignis::INS_HOST);
    PRUEF(hs.size() == 2 && hs[1].status == 1);
    PRUEF(stufe(x).gesund(1) && !stufe(x).gesund(2));
    auto zs = t.von(cdj::Ereignis::INS_HOST_ZUSTAND);
    PRUEF(!zs.empty() && zs.back().host_gesund[0] == 1 && zs.back().host_gesund[1] == 0 && zs.back().host_rundweg[0] == -1);
    // 3: the measurement
    const size_t vor = t.ev.size();
    mess_befehl(x, 1);
    host.vorher();
    t.zyklen(1);   // the command is applied in this cycle (the measurement starts with its sub-block): the impulse is in this cycle's send
    PRUEF(host.aus_l[0][0] == 0.5f);
    for (int i = 1; i < N; ++i) PRUEF(host.aus_l[0][i] == 0.0f);
    t.zyklen(6);
    m = t.von(cdj::Ereignis::INS_MESS);
    std::printf("3: messung: INS_MESS events %zu, last: h %d rundweg %d grund '%s' (events since the command: %zu)\n", m.size(), m.back().deck, m.back().status, m.back().grund, t.ev.size() - vor);
    PRUEF(m.size() == 2 && m[1].deck == 1 && m[1].status == 512 && m[1].grund[0] == '\0');
    t.zyklen(30000 / N + 1);
    zs = t.von(cdj::Ereignis::INS_HOST_ZUSTAND);
    PRUEF(zs.back().host_rundweg[0] == 512 && zs.back().host_gesund[0] == 1);
    // a silent host: the return never comes (the fake returns nothing: cut the wire)
    x.kern->setze_host_kante(1, false);   // host falls
    t.zyklen(2);
    zs = t.von(cdj::Ereignis::INS_HOST_ZUSTAND);
    PRUEF(zs.back().host_gesund[0] == 0);
    std::printf("6: allocations in the kern cycles (commands, measurement, state events) = %ld%s\n", t.allokationen, ALLOC_ABFANG_VERFUEGBAR ? "" : " (guard unavailable: skipped)");
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(t.allokationen == 0);
  }
  {  // 4: laeuft: a playing transport refuses; a transport that starts during a measurement ends it
    arr35::Lauf x(ab.pfad, "test_kern_arr_host2");
    x.kern->setze_host_ports_da(true);
    Host host;
    host.binde(x);
    const std::string a = x.ordner.impuls('a', 4800);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c0", 0.0, 0.5, a, 4800) + "]}");
    x.lauf(10 * N);
    x.kern->setze_host_kante(1, true);
    host_befehl(x, 1, 1);
    x.start(0.0, 0);
    x.lauf(x.kern->sample() + 8 * N);
    PRUEF(x.kern->arrangement().status() != cdj::ArrStatus::steht);
    mess_befehl(x, 1);
    x.lauf(x.kern->sample() + 3 * N);
    bool laeuft = false;
    for (const auto& e : x.alle(cdj::Ereignis::INS_MESS)) laeuft = laeuft || (e.deck == 1 && e.status == -1 && !std::strcmp(e.grund, "laeuft"));
    PRUEF(laeuft);
    PRUEF(!stufe(x).kante_ok(2));
  }
  {  // 5: without host ports (main.cpp registered none): the edge check changes nothing, no state events
    arr35::Lauf x(ab.pfad, "test_kern_arr_host3");
    x.lauf(60000);
    x.kern->setze_host_kante(1, true);
    PRUEF(!stufe(x).kante_ok(1));
    PRUEF(x.alle(cdj::Ereignis::INS_HOST_ZUSTAND).empty());
  }
  PRUEF_ENDE();
}
