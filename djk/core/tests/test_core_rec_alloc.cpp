// 1.8 S2a.5 (L5): no allocation, no lock, no sleep in the kern cycle while the recording module takes: one internal track (erz/1) and one external
// track (ein_1, channel mode summe, the loop of D14) record at the same time, the arrangement plays. Counted only in kern->zyklus()
// (alloc_intercept.h, thread_local); the record thread (faden.durchgang) runs outside the window, like the real thread runs beside the callback.
// Positive control: a malloc inside a window is counted. Mutation CYPHERDJ_MUTATION_REC_ALLOC_IM_BLOCK (a new/delete pair in Aufnahme::block)
// must turn the test red (test_mutation, WILL_FAIL). Under ASan/TSan the guard is missing: "skipped", never "passed".
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <fstream>
#include <string>

#include "arr_run.h"
#include "cypherdj/recording_thread.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives (one translation unit per program)

bool g_waechter = false;
using k35::N;

static float sig(int64_t s) { return 0.0001f * static_cast<float>(s % 9973 + 1); }
static float rampe(int64_t s) { return static_cast<float>(s % 1000) / 1000.0f; }

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_rec_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_rec_alloc");
  const std::string ordner = ab.pfad + "/rec";
  PRUEF(std::system(("mkdir -p " + ordner).c_str()) == 0);
  cdj::AufnahmeFaden faden(ordner);
  x.erz_quelle[0] = sig;                                          // internal source erz/1
  x.ein_quelle[1] = rampe;                                        // external pair ein_1: L ramp, R half of it (summe = 0.75 * ramp, never zero)
  x.ein_quelle_r[1] = [](int64_t s) { return 0.5f * rampe(s); };
  const std::string a = x.ordner.audio('a', 200000, 0.25f);
  x.lauf(10 * N);
  x.laden(5, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 200000) + "]},"
                  "{\"nr\":6,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}");   // T7b: track 6 is an RB-338 track: the live notes of the armed MIDI track sound in the window
  x.lauf(12 * N);
  cdj::RecSpur* pi = cdj::RecSpur::neu(3, 11);   // internal
  cdj::RecSpur* pe = cdj::RecSpur::neu(4, 1);    // external, summe
  pe->modus = 3;
  faden.anmelden(pi);
  faden.anmelden(pe);
  const int64_t r1 = x.rec_spur(3, 1, 11, pi), r2 = x.rec_spur(4, 1, 1, pe);
  // 1.8 T7a: the MIDI recorder is armed in the same window (track 6, eingang 30): notes and a control change in every cycle are stamped, windowed and pushed in the callback
  cdj::RecMidi* pm = cdj::RecMidi::neu();
  faden.anmelden_midi(pm);
  cdj::Befehl bm = x.neu(cdj::Befehl::REC_SPUR, "andreas");
  bm.nr = 6; bm.an = 1; bm.deck = 30; bm.zeiger = pm;
  const int64_t r3 = x.sende(bm);
  x.lauf(16 * N);
  PRUEF(x.quittung(r1, 3) && x.quittung(r2, 3) && x.quittung(r3, 3) && x.kern->aufnahme().midi_scharf() == 1);
  const int64_t rs = x.rec_start(80, 0);
  x.start(0.0, 0);
  for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(rs, 2) != nullptr);   // the take runs: the window below sees the recording path, not an idle module

  std::vector<float> el(N), er(N), rl(N), rr(N);
  std::vector<float> pe_l[3], pe_r[3];
  for (int pp = 0; pp < 3; ++pp) {
    pe_l[pp].assign(N, 0.1f * static_cast<float>(pp + 2));
    pe_r[pp].assign(N, -0.05f * static_cast<float>(pp + 2));
  }
  AbfangZahlen summe;
  auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      for (int k = 0; k < N; ++k) {
        el[k] = rampe(n0 + k);
        er[k] = 0.5f * el[k];
        rl[k] = sig(n0 + k);
        rr[k] = -rl[k];
      }
      x.kern->ein(1, el.data(), er.data());
      for (int pp = 2; pp <= cdj::EIN_PAARE; ++pp) x.kern->ein(pp, pe_l[pp - 2].data(), pe_r[pp - 2].data());   // S3: pairs 2..4 carry other content
      x.kern->rueck(1, rl.data(), rr.data());
      abfang_an();
      {   // T7a: even cycles a note on (key by cycle), odd cycles its off, a control change in every cycle; three offsets inside the cycle
        const uint8_t ton = static_cast<uint8_t>(48 + (n0 / N / 2) % 24);
        const uint8_t on[3] = {0x90, ton, 100}, off[3] = {0x80, ton, 0}, cc[3] = {0xB0, 1, static_cast<uint8_t>((n0 / N) & 127)};
        x.kern->midi_ein(cc, 3, 3);
        x.kern->midi_ein((n0 / N) % 2 ? off : on, 3, 100);
      }
      x.kern->zyklus(N, n0 * 20833);
      summe += abfang_zahlen();
      cdj::Ereignis e;
      while (x.ere->hole(e)) {}
      faden.durchgang();   // outside the window
    }
  };
  zyklen(1500);   // 8 s: well past the ring size of 2.7 s, so a thread that did not keep up would show as gaps below
  abfang_an();
  void* pos = std::malloc(16);   // positive control: the guard counts a malloc inside a window
  const long positiv = abfang_aus();
  std::free(pos);
  x.stopp(0);
  zyklen(300);
  for (int i = 0; i < 20; ++i) faden.durchgang();
  std::printf("rec_alloc: %ld Allokationen, %ld frei, %ld Sperren, %ld Schlafen in 1800 Zyklen, Positiv-Kontrolle %ld\n", summe.alloc, summe.frei, summe.sperren,
              summe.schlafen, positiv);
  PRUEF(positiv >= 1);
  PRUEF(summe.alloc == 0 && summe.frei == 0 && summe.sperren == 0 && summe.schlafen == 0);
  // something really recorded: both takes are closed with frames, no gaps
  int gemeldet = 0;
  cdj::TakeMeldung tm{};
  int midi_gemeldet = 0;
  int64_t midi_frames = 0;
  int32_t midi_luecken = -1;
  while (faden.hole_meldung(tm)) {
    if (tm.kennung != 80) continue;
    if (tm.art == 1) { PRUEF(tm.spur == 0 && tm.status == 0); ++midi_gemeldet; midi_frames = tm.frames; midi_luecken = tm.luecken; continue; }
    PRUEF(tm.status == 0 && tm.luecken == 0 && tm.frames > 1500 * N);
    ++gemeldet;
  }
  PRUEF(gemeldet == 2);
  // T7a: the MIDI take of the same run is a real one: art 1, spur 0, two events per cycle (the note and the control change), none refused, the file exists
  for (int i = 0; i < 20; ++i) faden.durchgang();
  PRUEF(x.kern->arrangement().live_offene_noten() <= 1 && x.kern->arr_rb().verloren() == 0);   // T7b: the live path ran on the RB-338 track (one key at most is held between two cycles), the sink lost nothing
  PRUEF(midi_gemeldet == 1 && midi_frames > 2 * 1400 && midi_luecken == 0);
  // the external track holds the sum of the pair (0.75 * ramp), the internal one the tap: the window above covered real work, not idle tracks
  auto datei = [&](int spur) { std::ifstream f(ordner + "/aufnahme-" + std::to_string(spur) + "-80.f32", std::ios::binary); return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); };
  auto spitze = [&](const std::string& roh) { float m = 0.0f; for (size_t i = 0; i + 4 <= roh.size(); i += 4) { float v; std::memcpy(&v, roh.data() + i, 4); m = std::max(m, std::fabs(v)); } return m; };
  const float sp_ext = spitze(datei(4)), sp_int = spitze(datei(3));
  std::printf("rec_alloc: Spitze extern %.4f, intern %.4f\n", sp_ext, sp_int);
  PRUEF(sp_ext > 0.7f && sp_ext < 0.76f && sp_int > 0.5f);   // 0.75 * ramp (max 0.999) and the erz/1 tap (max about 0.9973)
  // 1.8 S3 (R10): the monitor of EIGHT external tracks in the same window (REC_MAX_ARM): track 1 (a clip plays on it: the clip scan of auto runs) and tracks 11..17, on the pairs
  // 1..4 in all four channel modes, monitor ein and auto alternating. The two tracks of the first part are disarmed and handed back; the take of kennung 81 records all eight.
  for (cdj::RecSpur* q : {pi, pe}) {
    const int64_t rd = x.rec_spur(q->spur, 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr);
  }
  cdj::RecSpur* acht[8];
  const int spuren[8] = {1, 11, 12, 13, 14, 15, 16, 17};
  for (int i = 0; i < 8; ++i) {
    acht[i] = cdj::RecSpur::neu(spuren[i], 1 + i % 4);
    acht[i]->modus = static_cast<int8_t>((i / 2) % 4);
    acht[i]->monitor.store(static_cast<int8_t>(i % 2 ? 2 : 1), std::memory_order_relaxed);
    faden.anmelden(acht[i]);
    const int64_t ra = x.rec_spur(spuren[i], 1, 1 + i % 4, acht[i]);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(ra, 3) != nullptr && x.quittung(ra, 6) == nullptr);
  }
  PRUEF(x.kern->aufnahme().scharf() == 8);
  const int64_t rs8 = x.rec_start(81, 0);
  x.start(0.0, 0);
  for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  PRUEF(x.quittung(rs8, 2) != nullptr);
  AbfangZahlen summe8;
  for (int i = 0; i < 800; ++i) {
    const int64_t n0 = x.kern->sample();
    for (int k = 0; k < N; ++k) {
      el[k] = rampe(n0 + k);
      er[k] = 0.5f * el[k];
    }
    x.kern->ein(1, el.data(), er.data());
    for (int pp = 2; pp <= cdj::EIN_PAARE; ++pp) x.kern->ein(pp, pe_l[pp - 2].data(), pe_r[pp - 2].data());
    abfang_an();
    x.kern->zyklus(N, n0 * 20833);
    summe8 += abfang_zahlen();
    cdj::Ereignis e;
    while (x.ere->hole(e)) {}
    faden.durchgang();
  }
  std::printf("rec_alloc S3: %ld Allokationen, %ld frei, %ld Sperren, %ld Schlafen in 800 Zyklen mit 8 abgehoerten Spuren\n", summe8.alloc, summe8.frei, summe8.sperren, summe8.schlafen);
  PRUEF(summe8.alloc == 0 && summe8.frei == 0 && summe8.sperren == 0 && summe8.schlafen == 0);
  x.stopp(0);
  for (int i = 0; i < 40; ++i) { x.lauf(x.kern->sample() + N); faden.durchgang(); }
  for (int i = 0; i < 20; ++i) faden.durchgang();
  int gemeldet8 = 0;
  while (faden.hole_meldung(tm)) {
    if (tm.kennung != 81 || tm.art != 0) continue;   // (the armed MIDI track makes an empty MIDI take of this run too, art 1)
    PRUEF(tm.status == 0 && tm.luecken == 0 && tm.frames > 700 * N);   // all eight takes are real
    ++gemeldet8;
  }
  PRUEF(gemeldet8 == 8);
  for (int i = 0; i < 8; ++i) {
    const int64_t rd = x.rec_spur(spuren[i], 0, 0, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rd, 3) != nullptr);
    faden.abmelden(acht[i]);
    cdj::RecSpur::frei(acht[i]);
  }
  {   // T7a: disarm the MIDI track, the recorder comes back through REC_ALT (the zyklen of this test drop the events, so it is released here)
    const int64_t rx = x.rec_spur(6, 0, 30, nullptr);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(rx, 3) != nullptr && x.kern->aufnahme().midi_scharf() == 0 && x.kern->aufnahme().midi_spur() == nullptr);
    faden.abmelden_midi(pm);
    cdj::RecMidi::frei(pm);
  }
  faden.abmelden(pi);
  faden.abmelden(pe);
  cdj::RecSpur::frei(pi);
  cdj::RecSpur::frei(pe);
  PRUEF_ENDE();
}
