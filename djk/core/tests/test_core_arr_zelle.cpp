// Loop deck K6: /k/arr/zelle_start and /k/arr/zelle_stopp through the kern, with the receipts and the /zustand/zelle event (index 1.3). 128 BPM: 22 500 samples per beat, blocks of 256.
//   1  a start for a filled cell: /q 1 at once, the state shows it pending (wartend 1, wartend_ab), /q 3 at the effect with sample = T (the sample of ab_beat), then the state shows it
//      playing (wartend -1 with wartend_ab 0, ab_beat, versatz); the cell is audible (positive control)
//   2  a start for an empty cell: /q 6 zelle_leer, no 1, no state change (the state never shows that cell or a pending launch)
//   3  an unknown track id: 6 spur_bereich; the 33rd char: no such track either
//   4  no snapshot: 6 nicht_geladen
//   5  cypher under the AI stop: 6 ki_gestoppt (before any other check, also for a stop); andreas is not stopped; a pending launch of cypher is dropped with 7 abbruch, one of andreas stays
//   6  a pending launch replaced by a newer one: 7 abbruch for the old id, the new one takes effect (3)
//   7  /zustand/zelle on every change and again every 0.5 s (24 000 samples) while nothing changes
//   8  /k/set/neu ends the voice (silence within the seam fade) and drops a pending launch (7); an unload drops a pending launch too (7)
//   9  a pending stop: 3 at its sample, the state shows zelle 0 and the track falls silent
//  10  no allocation, lock or sleep in kern->zyklus() on the command path (accept, refuse, replace, effect, stop, events)
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "arr_run.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives (like test_kern_arr_alloc)

bool g_waechter = false;

using k35::N;
using k35::SPB;
using B = cdj::Befehl;
using E = cdj::Ereignis;

namespace {

constexpr int64_t FRAMES = 4 * SPB;   // a 4-beat cell

std::string zelle(arr35::Lauf& x, int index, const std::string& sha, const char* art, double beats) {
  const int modus = std::strcmp(art, "loop") == 0 ? 2 : 0;   // the loader: a loop has modus 2, a one-shot 0 (the kern of this test has no warp works: a loop then plays by re-pitch)
  char z[640];
  std::snprintf(z, sizeof z, "{\"index\":%d,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\",\"frames\":%lld,\"beats\":%.17g,\"art\":\"%s\",\"gain_db\":0,\"modus\":%d}", index, sha.c_str(),
                x.ordner.pfad.c_str(), sha.c_str(), static_cast<long long>(FRAMES), beats, art, modus);
  return z;
}

// a playback with one deck track "s1" (nr 1): cell 1 a loop of 4 beats, cell 3 a one-shot, cell 2 empty
std::string spuren(arr35::Lauf& x, const std::string& sha) {
  return "{\"nr\":1,\"art\":\"audio\",\"id\":\"s1\",\"zellen\":[" + zelle(x, 1, sha, "loop", 4.0) + "," + zelle(x, 3, sha, "einmal", 0.0) + "],\"clips\":[" +
         x.ordner.clip("c1", 0.0, 1.0, sha, FRAMES) + "]}";
}

int64_t start(arr35::Lauf& x, const char* quelle, const char* spur, int zelle_nr, double ab, double versatz = 0.0) {
  B b = x.neu(B::ARR_ZELLE_START, quelle);
  std::snprintf(b.pfad, sizeof b.pfad, "%s", spur);
  b.nr = zelle_nr;
  b.ab_beat = ab;
  b.wert_beats = versatz;
  return x.sende(b);
}

int64_t stopp(arr35::Lauf& x, const char* quelle, const char* spur, double ab) {
  B b = x.neu(B::ARR_ZELLE_STOPP, quelle);
  std::snprintf(b.pfad, sizeof b.pfad, "%s", spur);
  b.ab_beat = ab;
  return x.sende(b);
}

float spitze(const std::vector<float>& v, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, std::fabs(v[static_cast<size_t>(i)]));
  return m;
}

const cdj::Ereignis* letzter(const std::vector<E>& v, int64_t bis = INT64_MAX) {
  const E* r = nullptr;
  for (const E& e : v)
    if (e.sample < bis) r = &e;
  return r;
}

// the receipt of this id and status (its grund in `grund`), or null
const k35::Q* q(const arr35::Lauf& x, int64_t id, int status) { return x.quittung(id, status); }

bool hat_status(const arr35::Lauf& x, int64_t id, int status, const char* grund = "") {
  const k35::Q* r = q(x, id, status);
  return r && r->grund == grund;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_zelle");
  {  // 1, 7: accept, pending, effect, playing, repeats
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    const int64_t id = start(x, "andreas", "s1", 1, 8.0, 1.0);
    x.lauf(6 * N);
    PRUEF(hat_status(x, id, 1));
    PRUEF(!q(x, id, 3));
    const std::vector<E> z0 = x.alle(E::ZELLE_ZUSTAND, "s1");
    const E* w = letzter(z0);
    PRUEF(w != nullptr);
    if (w) {
      PRUEF(w->zelle_zelle == 0 && w->zelle_wartend == 1 && w->zelle_wartend_ab == 8.0 && w->zelle_verwaist == 0);
      std::printf("1: pending event zelle %d wartend %d wartend_ab %.3f\n", w->zelle_zelle, w->zelle_wartend, w->zelle_wartend_ab);
    }
    x.lauf(8 * SPB + 4 * N);   // past the effect
    const k35::Q* d = q(x, id, 3);
    PRUEF(d != nullptr);
    if (d) {
      std::printf("1: status 3 at sample %lld (T %lld), beat %.3f\n", static_cast<long long>(d->sample), static_cast<long long>(8 * SPB), d->beat);
      PRUEF(d->sample == 8 * SPB && d->beat == 8.0);
    }
    PRUEF(!q(x, id, 7));
    const std::vector<E> z1 = x.alle(E::ZELLE_ZUSTAND, "s1");
    const E* s = letzter(z1);
    PRUEF(s != nullptr);
    if (s) {
      std::printf("1: playing event zelle %d wartend %d wartend_ab %.3f ab_beat %.3f versatz %.3f\n", s->zelle_zelle, s->zelle_wartend, s->zelle_wartend_ab, s->zelle_ab_beat, s->zelle_versatz);
      PRUEF(s->zelle_zelle == 1 && s->zelle_wartend == -1 && s->zelle_wartend_ab == 0.0 && s->zelle_ab_beat == 8.0 && s->zelle_versatz == 1.0 && s->zelle_verwaist == 0);
      PRUEF(!std::strcmp(s->pfad, "s1"));
    }
    std::printf("1: peak after the effect %.5f, before %.7f\n", spitze(x.l, 8 * SPB + 300, 8 * SPB + 1000), spitze(x.l, 6 * SPB, 8 * SPB - 2048));
    PRUEF(spitze(x.l, 8 * SPB + 300, 8 * SPB + 1000) > 0.05f);   // audible
    PRUEF(spitze(x.l, 6 * SPB, 8 * SPB - 2048) < 1e-6f);          // silent before
    // 7: the state again every 0.5 s while nothing changes
    x.lauf(8 * SPB + 3 * 24000 + 2 * N);
    std::vector<int64_t> t;
    for (const E& e : x.alle(E::ZELLE_ZUSTAND, "s1"))
      if (e.sample > 8 * SPB + 2 * N) t.push_back(e.sample);
    std::printf("7: %zu repeats after the effect\n", t.size());
    PRUEF(t.size() >= 2);
    for (size_t i = 1; i < t.size(); ++i) PRUEF(t[i] - t[i - 1] >= 23000 && t[i] - t[i - 1] <= 25000);
    for (const E& e : x.alle(E::ZELLE_ZUSTAND, "s1"))
      if (e.sample > 8 * SPB + 2 * N) PRUEF(e.zelle_zelle == 1 && e.zelle_wartend == -1);
    // 9: a pending stop
    const int64_t sid = stopp(x, "andreas", "s1", 12.0);
    x.lauf(x.kern->sample() + 2 * N);
    PRUEF(hat_status(x, sid, 1));
    const E* sw = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(sw && sw->zelle_wartend == 0 && sw->zelle_wartend_ab == 12.0 && sw->zelle_zelle == 1);
    x.lauf(12 * SPB + 2 * N);
    const k35::Q* sd = q(x, sid, 3);
    PRUEF(sd && sd->sample == 12 * SPB);
    const E* sz = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(sz && sz->zelle_zelle == 0 && sz->zelle_wartend == -1 && sz->zelle_wartend_ab == 0.0);
    x.lauf(12 * SPB + 4000);
    std::printf("9: peak after the stop %.7f\n", spitze(x.l, 12 * SPB + 1000, 12 * SPB + 4000));
    PRUEF(spitze(x.l, 12 * SPB + 1000, 12 * SPB + 4000) < 1e-3f);
  }
  {  // 2, 3: refusals with a snapshot
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    const size_t vorher = x.alle(E::ZELLE_ZUSTAND, "s1").size();
    const int64_t leer = start(x, "andreas", "s1", 2, 8.0);
    const int64_t unbekannt = start(x, "andreas", "nope", 1, 8.0);
    const int64_t lang = start(x, "andreas", "s1s1s1s1s1s1s1s1s1s1s1s1s1s1s1s1s1", 1, 8.0);   // 34 chars, no such track (the net refuses 33 earlier; the kern answers the same)
    const int64_t bereich = start(x, "andreas", "s1", 9, 8.0);
    const int64_t negativ = start(x, "andreas", "s1", 1, 8.0, -1.0);
    const int64_t stopp_unbekannt = stopp(x, "andreas", "nope", 8.0);
    x.lauf(4 * N + 4 * N);
    PRUEF(hat_status(x, leer, 6, "zelle_leer") && !q(x, leer, 1));
    PRUEF(hat_status(x, unbekannt, 6, "spur_bereich"));
    PRUEF(hat_status(x, lang, 6, "spur_bereich"));
    PRUEF(hat_status(x, bereich, 6, "ausserhalb_bereich"));
    PRUEF(hat_status(x, negativ, 6, "ausserhalb_bereich"));
    PRUEF(hat_status(x, stopp_unbekannt, 6, "spur_bereich"));
    x.lauf(8 * SPB + 4 * N);
    for (const E& e : x.alle(E::ZELLE_ZUSTAND, "s1")) PRUEF(e.zelle_zelle == 0 && e.zelle_wartend == -1);   // nothing ever started or pended
    std::printf("2: refusals answered, %zu state events before, never a pending or playing state\n", vorher);
    PRUEF(spitze(x.l, 0, 8 * SPB + 4 * N) < 1e-6f);
  }
  {  // 4: no snapshot
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    x.lauf(4 * N);
    const int64_t id = start(x, "andreas", "s1", 1, 8.0);
    const int64_t sid = stopp(x, "andreas", "s1", 8.0);
    x.lauf(8 * N);
    PRUEF(hat_status(x, id, 6, "nicht_geladen"));
    PRUEF(hat_status(x, sid, 6, "nicht_geladen"));
    PRUEF(x.alle(E::ZELLE_ZUSTAND).empty());
  }
  {  // 5: AI stop
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    const int64_t c0 = start(x, "cypher", "s1", 1, 40.0);     // accepted before the stop, pending
    const int64_t a0 = start(x, "andreas", "s1", 1, 44.0);    // replaces it: 7 for c0 (a plain replacement, not the stop)
    x.lauf(8 * N);
    PRUEF(hat_status(x, c0, 1) && hat_status(x, c0, 7, "abbruch") && hat_status(x, a0, 1));
    const int64_t c1 = start(x, "cypher", "s1", 1, 48.0);     // replaces the one of andreas: the pending launch is now cypher's
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(hat_status(x, c1, 1) && hat_status(x, a0, 7, "abbruch"));
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(x.kern->sample() + 8 * N);
    PRUEF(hat_status(x, c1, 7, "abbruch"));   // dropped by the AI stop
    const E* w = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(w && w->zelle_wartend == -1);
    const int64_t c2 = start(x, "cypher", "s1", 1, 52.0);
    const int64_t c3 = stopp(x, "cypher", "s1", 52.0);
    const int64_t a1 = start(x, "andreas", "s1", 1, 56.0);
    x.lauf(x.kern->sample() + 8 * N);
    PRUEF(hat_status(x, c2, 6, "ki_gestoppt") && !q(x, c2, 1));
    PRUEF(hat_status(x, c3, 6, "ki_gestoppt"));
    PRUEF(hat_status(x, a1, 1) && !q(x, a1, 6));   // andreas is not stopped
    const E* w2 = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(w2 && w2->zelle_wartend == 1 && w2->zelle_wartend_ab == 56.0);   // only the launch of andreas pends
    // positive control for "andreas keeps pending": the stop dropped nothing of his
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(!q(x, a1, 7));
    std::printf("5: ki_gestoppt for cypher start and stop, abbruch for the pending launch of cypher, the launch of andreas stays\n");
  }
  {  // 6: replaced pending launch
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    const int64_t i1 = start(x, "andreas", "s1", 1, 8.0);
    x.lauf(4 * N + 4 * N);
    const int64_t i2 = start(x, "andreas", "s1", 3, 12.0);
    x.lauf(12 * SPB + 4 * N);
    PRUEF(hat_status(x, i1, 1) && hat_status(x, i1, 7, "abbruch") && !q(x, i1, 3));
    PRUEF(hat_status(x, i2, 1));
    const k35::Q* d = q(x, i2, 3);
    PRUEF(d && d->sample == 12 * SPB);
    const E* w = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(w && w->zelle_zelle == 3 && w->zelle_wartend == -1);
    std::printf("6: replaced launch got 7 abbruch, the new one 3 at %lld\n", static_cast<long long>(d ? d->sample : -1));
  }
  {  // 8: /k/set/neu and unload
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    const int64_t i1 = start(x, "andreas", "s1", 1, 4.0);
    x.lauf(4 * SPB + 4 * N);
    PRUEF(hat_status(x, i1, 3));
    const int64_t i2 = start(x, "andreas", "s1", 1, 40.0);   // pending when the new set comes
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(hat_status(x, i2, 1));
    const int64_t t0 = x.kern->sample();
    PRUEF(spitze(x.l, t0 - 2048, t0) > 0.05f);   // playing
    B nb = x.neu(B::SET_NEU);
    nb.bpm = 128.0;
    x.sende(nb);
    x.lauf(x.kern->sample() + 1);   // the cycle that takes it: the axis restarts at 0
    x.lauf(3000);
    PRUEF(hat_status(x, i2, 7, "abbruch"));
    PRUEF(!q(x, i2, 3));
    const E* w = letzter(x.alle(E::ZELLE_ZUSTAND, "s1"));
    PRUEF(w && w->zelle_zelle == 0 && w->zelle_wartend == -1);
    PRUEF(spitze(x.l, 1000, 3000) < 1e-3f);   // silent (below -60 dB; the master chain rings a little): the fade over ARR_NAHT and the limiter delay are over (the buffers are rewritten from sample 0)
    std::printf("8: set/neu: pending launch got 7 abbruch, track silent\n");
    // unload with a pending launch
    x.laden(2, spuren(x, a), "andreas", true);
    x.lauf(x.kern->sample() + 4 * N);
    const int64_t i3 = start(x, "andreas", "s1", 1, 60.0);
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(hat_status(x, i3, 1));
    B ul = x.neu(B::ARR_LADEN, "andreas");
    ul.zeiger = nullptr;
    ul.arr_nr = 0;
    x.sende(ul);
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(hat_status(x, i3, 7, "abbruch"));
    std::printf("8: unload: pending launch got 7 abbruch\n");
  }
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("10: skipped (sanitizer build): allocation guard not available\n");
  } else {  // 10: no allocation, lock or sleep in the cycle
    arr35::Lauf x(ab.pfad, "test_kern_arr_zelle_alloc");
    const std::string a = x.ordner.sinus('a', FRAMES, 441.0, 0.4f);
    x.laden(1, spuren(x, a), "andreas", true);
    x.lauf(4 * N);
    AbfangZahlen summe;
    long zyklen = 0, zustaende = 0, quittungen = 0;
    auto lauf = [&](int n) {
      for (int i = 0; i < n; ++i) {
        const int64_t n0 = x.kern->sample();
        abfang_an();
        x.kern->zyklus(N, n0 * 20833);
        abfang_aus();
        summe += abfang_zahlen();
        ++zyklen;
        cdj::Ereignis e;
        while (x.ere->hole(e)) {
          if (e.art == E::ZELLE_ZUSTAND) ++zustaende;
          if (e.art == E::QUITTUNG) ++quittungen;
          if (e.art == E::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
        }
      }
    };
    for (int round = 0; round < 3; ++round) {
      const double base = static_cast<double>((x.kern->sample() / SPB) + 2);
      start(x, "andreas", "s1", 1, base, 0.5);          // accept, pending
      lauf(8);
      start(x, "andreas", "s1", 3, base + 1.0);         // replace: 7
      start(x, "andreas", "nope", 1, base + 1.0);       // refuse
      start(x, "andreas", "s1", 2, base + 1.0);         // refuse: empty cell
      lauf(static_cast<int>(2 * SPB / N));              // effect (3) of the one-shot
      stopp(x, "andreas", "s1", static_cast<double>((x.kern->sample() / SPB) + 2));
      lauf(static_cast<int>(3 * SPB / N));              // the stop takes effect, the state goes to 0
    }
    lauf(200);
    abfang_an();
    void* p = std::malloc(16);
    const long positiv = abfang_aus();
    std::free(p);
    std::printf("10: %ld allocations, %ld frees, %ld locks, %ld sleeps in %ld cycles; %ld state events, %ld receipts; positive control %ld\n", summe.alloc, summe.frei, summe.sperren,
                summe.schlafen, zyklen, zustaende, quittungen, positiv);
    PRUEF(positiv >= 1);
    PRUEF(summe.summe() == 0);
    PRUEF(zustaende > 10 && quittungen > 15);   // it really ran
  }
  PRUEF_ENDE();
}
