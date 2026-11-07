// 1.15 A7b: the spectrum path through the Mixer (selector spektrum/kanal, taps, source-change atomics of D12) and the SpektrumSender of
// the network thread (netz.h), single-threaded and deterministic. The two-thread stress under TSan is test_mixer_spektrum_stress.
//  (S1) selector 0: no ring write (schreib_position, verlorene_samples, rahmen, generation unchanged); the audio is bit-identical with the
//       tap on and off (the tap only reads)
//  (S2) 1 kHz full-scale sine reads 0 dB (+-0.5) in its band (index 16), 5 kHz in band 23, 100 Hz peaks in band 6, master tap (19) and a bus tap
//  (S3) the audio-thread call (block with tap, including the block of a switch) and analysiere() allocate nothing, take no lock (alloc_abfang.h)
//  (S4) source change, full path. erz/1 carries 1 kHz, erz/2 carries 5 kHz. (a) the consumer ticks normally, the switch comes 1000 samples after the
//       last tick; (b) the consumer stops for 16 800 samples (the ring is full and drops). After the switch: every frame is tagged erz/2, the 1 kHz
//       band stays below the clean reference (the same samples analysed from an empty analyser) + 0.5 dB, within 40 dB is never reached, the settled
//       frames carry the stale band <= -60 dB, rahmen restarts at the first frame of the new source, and in (b) the first erz/2 frame arrives at the
//       2nd tick after the switch (tick 1 cuts, tick 2 holds new data) with at least one hop of new samples. Positive control: before the switch the
//       frames peak at 1 kHz and are tagged erz/1.
//       Race tests (hook between the generation reads): a switch between the first read and the second one discards that tick's frames (stage 1);
//       a switch after the second read leaves the frames of the old source tagged with the old source (stage 2).
//  (S5) the encoded string has exactly 29 integers (asserted from anzahl_baender() and from the arithmetic 1000 x 2^(i/3), i = -16 .. 12) and
//       parses back to the levels within 0.1 dB
//  (S7) one tick analyses at most 32 frames (counted, always asserted); the median of 100 full-ring ticks is below 1 ms unless the 1-minute
//       load is above half the cores (then "not timed") or this is a sanitizer build; min, median, p95 and max are printed
//  (cadence) 40 calls of tick() at 2 ms spacing give at most 2 frames (the 40 ms rule)
//  (erz/8) the cue-only channel (early return of kanal()) is still tapped
//  (window) the audio thread's change is a seqlock (odd while written): a tick inside the change at any of its three stages serves nothing and takes nothing over; after it, the right source with the right cut
//  (race stage 0) a change between the generation read and the loads of source and cut is not served in that tick
// Mutations (registered in CMakeLists.txt, each turns this test red): SPEK_SCHNITT_NULL, SPEK_GEN_STUMM, SPEK_IMMER_SCHREIBEN, SPEK_TAP_VERSCHOBEN,
// SPEK_CUE_OHNE_ABGRIFF, SPEK_OHNE_UNGERADE (mixer.cpp); SPEKTRUM_NUR_LEEREN, SPEKTRUM_OHNE_G1, SPEKTRUM_ETIKETT_AKTUELL, SPEKTRUM_OHNE_TAKT, SPEKTRUM_OHNE_NEULESEN (netz.cpp).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <mutex>
#include <thread>
#include <string>
#include <vector>

#include "cypherdj/netz.h"
#include "mixer_wz_lauf.h"
#include "alloc_abfang.h"   // last: replaces malloc and relatives

using namespace wzt;
namespace dsp = cypherdj::dsp;

namespace {

constexpr int NB = 29, B100 = 6, B1K = 16, B5K = 23;   // band index of 1000 x 2^(i/3): i + 16
constexpr int64_t TICK_NS = cdj::SPEKTRUM_ABSTAND_NS;
constexpr int BLK = 240;                               // 8 blocks = 1920 samples = 40 ms
constexpr int BLOECKE = 8;

struct Parsed {
  std::string kanal;
  int rahmen = 0;
  float db[NB] = {};
  bool ok = false;
};

Parsed parse(const cdj::SpektrumRahmen& r) {
  Parsed p;
  p.kanal = r.kanal;
  p.rahmen = r.rahmen;
  int n = 0;
  const char* s = r.pegel.c_str();
  while (*s && n < NB + 1) {
    char* ende = nullptr;
    const long v = std::strtol(s, &ende, 10);
    if (ende == s) break;
    if (n < NB) p.db[n] = static_cast<float>(v) / 10.0f;
    ++n;
    s = ende;
    if (*s == ',') ++s;
  }
  p.ok = n == NB;
  return p;
}

int argmax(const float* d, int n) { return static_cast<int>(std::max_element(d, d + n) - d); }

// What the taps of two channels carried, per sample, so that a reference analyser can replay exactly the samples the Mixer fed.
struct Aufz {
  std::vector<float> l[2], r[2];
};

struct Szene {
  Lauf l;
  cdj::SpektrumSender snd;
  int64_t jetzt = 0;
  Aufz aufz;
  int kanal[2];
  double freq[2];
  double amp[2];
  Szene(int k0, double f0, int k1, double f1, double a = 1.0) : snd(*l.m), kanal{k0, k1}, freq{f0, f1}, amp{a, a} {}
  void waehle(int sel) { l.setze("spektrum/kanal", static_cast<float>(sel)); }
  void block(int n) {
    for (int c = 0; c < 2; ++c)
      if (kanal[c] >= 0) l.sinus(kanal[c], freq[c], amp[c], amp[c], n);
    l.verarbeite(n);
    for (int c = 0; c < 2; ++c) {
      if (kanal[c] < 0) continue;
      const float* al = l.m->kanalzug(kanal[c]).abgriff(0);
      const float* ar = l.m->kanalzug(kanal[c]).abgriff(1);
      aufz.l[c].insert(aufz.l[c].end(), al, al + n);
      aufz.r[c].insert(aufz.r[c].end(), ar, ar + n);
    }
  }
  void samples(int n_ges, int bl = BLK) {
    for (int done = 0; done < n_ges;) {
      const int n = std::min(bl, n_ges - done);
      block(n);
      done += n;
    }
  }
  std::vector<cdj::SpektrumRahmen> tick() {
    auto aus = snd.tick(jetzt);
    jetzt += TICK_NS;
    return aus;
  }
  // one period of 40 ms and its tick
  std::vector<cdj::SpektrumRahmen> periode() {
    samples(BLOECKE * BLK);
    return tick();
  }
};

dsp::SpektrumEinstellung einstellung() {
  dsp::SpektrumEinstellung e;
  e.baender_pro_oktave = 3;
  e.f_min_hz = 24.0f;
  e.f_max_hz = 16000.0f;
  return e;
}

// Reference: an empty analyser fed with the samples channel c carried from global sample t0 on, ticks of 1920 samples; returns the levels after each tick.
struct Ref {
  std::vector<std::vector<float>> db;
  std::vector<int> rahmen;
};
Ref referenz(const Szene& sz, int c, long t0, int ticks, int pro_tick = BLOECKE * BLK) {
  dsp::SpektrumAnalysator a(dsp::kAbtastrate, einstellung());
  Ref r;
  long t = t0;
  for (int k = 0; k < ticks; ++k) {
    for (int done = 0; done < pro_tick; done += BLK) {
      const int n = std::min(BLK, pro_tick - done);
      a.schreibe(sz.aufz.l[c].data() + t, sz.aufz.r[c].data() + t, n);
      t += n;
    }
    a.analysiere();
    r.db.emplace_back(a.pegel_db(), a.pegel_db() + a.anzahl_baender());
    r.rahmen.push_back(static_cast<int>(a.rahmen()));
  }
  return r;
}

// ---- S4 -------------------------------------------------------------------------------------------------------------------------------
struct S4Ergebnis {
  bool ok = true;
  int erster_erz2_tick = -1;   // ticks after the switch (1 = the first tick that saw the new generation)
};

S4Ergebnis s4(bool voll) {
  S4Ergebnis erg;
  const char* nm = voll ? "S4b" : "S4a";
  Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
  sz.waehle(ERZ1 + 1);
  // positive control: frames flow and peak at 1 kHz, tagged erz/1
  int vorher = 0;
  float db1k_vor = -999.0f;
  for (int i = 0; i < 20; ++i) {
    const auto f = sz.periode();
    for (const auto& r : f) {
      const Parsed p = parse(r);
      PRUEF(p.ok);
      PRUEF(p.kanal == "erz/1");
      if (i >= 12) {
        PRUEF(argmax(p.db, NB) == B1K);
        db1k_vor = p.db[B1K];
      }
      ++vorher;
    }
  }
  PRUEF(vorher >= 18);
  PRUEF_NAH(db1k_vor, 0.0, 0.5);
  std::printf("%s: before the switch %d frames tagged erz/1, peak band %d, level %.2f dB\n", nm, vorher, B1K, db1k_vor);

  if (voll) {
    // the consumer stops: 70 blocks of 240 = 16 800 samples against a ring of 16 384, the surplus is dropped and counted
    const long verloren0 = sz.l.m->spektrum().verlorene_samples();
    sz.samples(70 * BLK);
    const long verloren = sz.l.m->spektrum().verlorene_samples() - verloren0;
    std::printf("S4b: consumer stopped for 16800 samples, ring full, %ld samples dropped\n", verloren);
    PRUEF(verloren > 0);   // positive control: the ring really was full
  } else {
    sz.samples(1000, 250);   // 1000 stale samples of erz/1 in the ring, after the last tick
  }
  const std::size_t schnitt_erwartet = sz.l.m->spektrum().schreib_position();
  const long t_wechsel = sz.l.t;
  sz.waehle(ERZ2 + 1);

  std::vector<Parsed> nach;
  std::vector<int> tick_von;
  int rahmen_erz2_tick = -1;
  const int TICKS = 30;
  long t_tick1 = -1;   // global sample index at the first tick that sees the new generation
  long accepted_at_first_frame = -1;
  for (int i = 1; i <= TICKS; ++i) {
    sz.samples(BLOECKE * BLK);
    if (i == 1) t_tick1 = sz.l.t;
    const auto f = sz.tick();
    if (i == 1) {
      // the cut is the write position at the block start of the switch (the old source is everything before it)
      PRUEF(sz.snd.bediente_generation() == sz.l.m->spek_generation());
      PRUEF(sz.l.m->spek_schnitt() == schnitt_erwartet);
    }
    if (voll && i == 1) {
      std::printf("S4b: tick 1 after the switch returned %zu frame(s) (the cut freed the ring, nothing new in it)\n", f.size());
      PRUEF(f.empty());   // the ring held only stale samples (the new source was dropped while it was full): nothing may come out
    }
    for (const auto& r : f) {
      const Parsed p = parse(r);
      PRUEF(p.ok);
      PRUEF(p.kanal == "erz/2");   // never erz/1 after the switch
      if (rahmen_erz2_tick < 0) {
        rahmen_erz2_tick = i;
        accepted_at_first_frame = static_cast<long>(sz.l.m->spektrum().schreib_position() - schnitt_erwartet);
        std::printf("%s: first erz/2 frame at tick %d after the switch, rahmen %d, samples accepted since the cut %ld\n", nm, i, p.rahmen, accepted_at_first_frame);
      }
      nach.push_back(p);
      tick_von.push_back(i);
    }
  }
  erg.erster_erz2_tick = rahmen_erz2_tick;
  PRUEF(rahmen_erz2_tick >= 1);
  if (voll) PRUEF(rahmen_erz2_tick == 2);   // bound: tick 1 cuts, tick 2 holds 1920 new samples
  else PRUEF(rahmen_erz2_tick == 1);
  PRUEF(accepted_at_first_frame >= sz.l.m->spektrum().hop());   // the first frame needs at least one hop of new samples after the cut
  PRUEF(!nach.empty());
  if (nach.empty()) return erg;
  PRUEF(nach.front().rahmen >= 1 && nach.front().rahmen <= 4);   // restarted: 1920 samples / hop 512 = 3 frames in the tick

  // reference: an empty analyser, the samples erz/2 carried after the cut (variant a: from the switch, variant b: from the tick that cut)
  const long t0 = voll ? t_tick1 : t_wechsel;
  const int ticks_ref = voll ? TICKS - 1 : TICKS;
  const Ref ref = referenz(sz, 1, t0, ticks_ref);
  double max_ueber_ref = -999.0, max_rel = -999.0, settled_rel = -999.0;
  for (size_t j = 0; j < nach.size(); ++j) {
    const Parsed& p = nach[j];
    const int idx = voll ? tick_von[j] - 2 : tick_von[j] - 1;   // the reference tick that holds the same samples
    PRUEF(idx >= 0 && idx < static_cast<int>(ref.db.size()));
    if (idx < 0 || idx >= static_cast<int>(ref.db.size())) continue;
    PRUEF(p.rahmen == ref.rahmen[idx]);   // the same frames were counted
    const float rel = p.db[B1K] - p.db[B5K];
    max_rel = std::max<double>(max_rel, rel);
    max_ueber_ref = std::max<double>(max_ueber_ref, static_cast<double>(p.db[B1K]) - ref.db[idx][B1K]);
    PRUEF(rel <= -40.0f);   // the task's minimum: the 1 kHz band is never within 40 dB of the 5 kHz band
    if (tick_von[j] >= 28) settled_rel = std::max<double>(settled_rel, rel);
  }
  std::printf("%s: erz/2 frames %zu, 1 kHz band relative to 5 kHz: max %.2f dB; against the clean reference: max %+.2f dB; settled (tick >= 28): %.2f dB\n", nm,
              nach.size(), max_rel, max_ueber_ref, settled_rel);
  PRUEF(max_ueber_ref <= 0.5);       // A7a form, check 1: peak <= clean reference + 0.5 dB
  PRUEF(settled_rel <= -60.0);       // A7a form, check 2: settled frames carry the stale band <= -60 dB
  // negative control: the 5 kHz band of the frames equals the reference (the source really is erz/2, level and all)
  {
    const Parsed& p = nach.back();
    const int idx = voll ? tick_von.back() - 2 : tick_von.back() - 1;
    PRUEF_NAH(p.db[B5K], ref.db[idx][B5K], 0.1);
    PRUEF(argmax(p.db, NB) == B5K);
  }
  return erg;
}

// ---- race tests -------------------------------------------------------------------------------------------------------------------------
struct HakenCtx {
  Szene* sz = nullptr;
  int stufe = -1;     // stage at which to switch (0, 1 or 2), -1 never
  bool gefeuert = false;
  int ziel = ERZ2 + 1;   // the selector value the hook switches to
};
void haken(void* c, int stufe) {
  auto* h = static_cast<HakenCtx*>(c);
  if (h->stufe != stufe || h->gefeuert) return;
  h->gefeuert = true;
  h->sz->waehle(h->ziel);
  h->sz->samples(4 * BLK);   // the audio thread runs on: the selector change takes effect at the next block start, erz/2 samples enter the ring
}

// The writer's own window (seqlock, D12): the hook runs on the audio side inside a change, while the generation is odd, between the stores of
// source and cut. The reader ticks right there. Setting: change 1 (to erz/2) is not yet served, erz/2 samples are in the ring, change 2 (back to
// erz/1) is being written. Without the odd phase a reader sees change 1's generation with change 2's source and change 1's cut: a frame of erz/2
// samples tagged erz/1.
struct FensterCtx {
  Szene* sz = nullptr;
  int tick_ab = 0;                         // ticks at the stages >= this one (0: from the odd bump on)
  int ticks = 0, rahmen = 0, ungerade = 0;
  std::string falsches_etikett;            // the tag of a frame served inside the window, if any
  uint32_t bedient_vorher = 0;
};
void fenster_haken(void* c, int stufe) {
  auto* f = static_cast<FensterCtx*>(c);
  if (stufe < f->tick_ab) return;
  f->ungerade += (f->sz->l.m->spek_generation() & 1u) ? 1 : 0;
  const auto aus = f->sz->snd.tick(f->sz->jetzt + (f->ticks + 1) * TICK_NS);   // a fresh 40 ms slot each time
  ++f->ticks;
  f->rahmen += static_cast<int>(aus.size());
  if (!aus.empty()) f->falsches_etikett += aus[0].kanal + " ";
}

void fenster() {
  for (int stufe = 0; stufe <= 2; ++stufe) {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 12; ++i) sz.periode();
    FensterCtx h;
    h.sz = &sz;
    h.tick_ab = stufe;
    h.bedient_vorher = sz.snd.bediente_generation();
    sz.waehle(ERZ2 + 1);                       // change 1, not ticked yet
    sz.samples(BLOECKE * BLK);                 // erz/2 samples (5 kHz) are in the ring after its cut
    sz.l.m->setze_spek_fenster_haken(fenster_haken, &h);
    sz.waehle(ERZ1 + 1);                       // change 2 starts at the next block
    sz.samples(BLK);                           // ... and the hook ticks inside it, at stage >= tick_ab
    sz.l.m->setze_spek_fenster_haken(nullptr, nullptr);
    std::printf("window, ticks from stage %d: %d tick(s) inside the change, generation odd in %d of them, %d frame(s) served inside (%s), generation now %u\n", stufe,
                h.ticks, h.ungerade, h.rahmen, h.falsches_etikett.c_str(), sz.l.m->spek_generation());
    PRUEF(h.ticks == 3 - stufe);               // the hook was reached at every stage from tick_ab on
    PRUEF(h.ungerade == h.ticks);              // positive control: the window really was open (odd) in each of them
    PRUEF(h.rahmen == 0);                      // nothing is served inside the window (red without the odd phase)
    PRUEF(sz.snd.bediente_generation() == h.bedient_vorher);   // and nothing was taken over
    PRUEF((sz.l.m->spek_generation() & 1u) == 0);              // the window is closed
    // after the bump: correct, for erz/1 only; the 5 kHz samples of erz/2 lie before the cut of change 2
    sz.samples(BLOECKE * BLK);
    sz.jetzt += 4 * TICK_NS;   // past the slots the hook used
    const auto danach = sz.tick();
    PRUEF(danach.size() == 1);
    if (!danach.empty()) {
      const Parsed p = parse(danach[0]);
      PRUEF(p.kanal == "erz/1");
      std::printf("window: after the bump tag %s, rahmen %d, 5 kHz band %.1f dB below the 1 kHz band\n", p.kanal.c_str(), p.rahmen, p.db[B1K] - p.db[B5K]);
      PRUEF(argmax(p.db, NB) == B1K);
      PRUEF(p.db[B5K] <= p.db[B1K] - 30.0f);   // measured 39.5: the splatter of a sine that starts in a partly filled window; stale erz/2 samples would sit at about 0
    }
    PRUEF(sz.snd.bediente_generation() == sz.l.m->spek_generation());
  }
}

void rennen() {
  // stage 1: the switch lands between the first generation read and the second one
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 12; ++i) sz.periode();
    HakenCtx h{&sz, 1};
    sz.snd.setze_haken(haken, &h);
    // control: without an injection this tick returns one frame (so an empty result below means "discarded", not "nothing to say")
    sz.samples(BLOECKE * BLK);
    {
      HakenCtx aus{&sz, -1};
      sz.snd.setze_haken(haken, &aus);
      const auto kontrolle = sz.tick();
      PRUEF(kontrolle.size() == 1 && kontrolle[0].kanal == "erz/1");
    }
    sz.snd.setze_haken(haken, &h);
    sz.samples(BLOECKE * BLK);
    const auto verworfen = sz.tick();
    std::printf("race stage 1: switch between the two generation reads, tick returned %zu frame(s) (discarded: 0)\n", verworfen.size());
    PRUEF(h.gefeuert);
    PRUEF(verworfen.empty());
    // the next tick cuts and serves erz/2 only, nothing of the mixed tick
    sz.snd.setze_haken(nullptr, nullptr);
    sz.samples(BLOECKE * BLK);
    const auto danach = sz.tick();
    PRUEF(danach.size() == 1);
    if (!danach.empty()) {
      const Parsed p = parse(danach[0]);
      PRUEF(p.kanal == "erz/2");
      PRUEF(p.rahmen >= 1 && p.rahmen <= 4);
      PRUEF(argmax(p.db, NB) == B5K);
      PRUEF(p.db[B1K] - p.db[B5K] <= -40.0f);
    }
  }
  // stage 2: the switch lands after the second read; the frames were computed from erz/1 only and keep their tag
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 12; ++i) sz.periode();
    HakenCtx h{&sz, 2};
    sz.snd.setze_haken(haken, &h);
    sz.samples(BLOECKE * BLK);
    const auto f = sz.tick();
    PRUEF(h.gefeuert);
    PRUEF(f.size() == 1);
    if (!f.empty()) {
      const Parsed p = parse(f[0]);
      std::printf("race stage 2: switch after the second read, the frame stays tagged '%s' (peak band %d)\n", p.kanal.c_str(), argmax(p.db, NB));
      PRUEF(p.kanal == "erz/1");   // not the current selection
      PRUEF(argmax(p.db, NB) == B1K);
    }
    sz.snd.setze_haken(nullptr, nullptr);
    sz.samples(BLOECKE * BLK);
    const auto danach = sz.tick();
    PRUEF(danach.size() == 1 && parse(danach[0]).kanal == "erz/2");
  }
  // stage 0: a second change lands between the first generation read and the loads of source and cut (the D12 window): this generation is not served now
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 12; ++i) sz.periode();
    const uint32_t bedient_vorher = sz.snd.bediente_generation();
    sz.waehle(ERZ2 + 1);   // change 1: the tick below reads its generation
    sz.samples(BLOECKE * BLK);
    HakenCtx h{&sz, 0};    // hook: change 2 (back to erz/1) right after the generation read
    h.ziel = ERZ1 + 1;
    sz.snd.setze_haken(haken, &h);
    const auto f = sz.tick();
    std::printf("race stage 0: change between the generation read and the loads: %zu frame(s), served generation %u (before %u, now %u)\n", f.size(),
                sz.snd.bediente_generation(), bedient_vorher, sz.l.m->spek_generation());
    PRUEF(h.gefeuert);
    PRUEF(f.empty());
    PRUEF(sz.snd.bediente_generation() == bedient_vorher);   // not served: the next tick starts over (red without the re-read)
    sz.snd.setze_haken(nullptr, nullptr);
    sz.samples(BLOECKE * BLK);
    const auto danach = sz.tick();
    PRUEF(sz.snd.bediente_generation() == sz.l.m->spek_generation());
    PRUEF(danach.size() == 1);
    if (!danach.empty()) {
      const Parsed p = parse(danach[0]);
      PRUEF(p.kanal == "erz/1");   // the latest source
      PRUEF(argmax(p.db, NB) == B1K);
    }
  }
}

}  // namespace

int main() {
  // ---- S5: the band arithmetic and the encoding ----
  {
    int n = 0;
    double erste = 0.0, letzte = 0.0;
    for (int i = -16; i <= 12; ++i, ++n) {
      const double f = 1000.0 * std::pow(2.0, i / 3.0);
      if (n == 0) erste = f;
      letzte = f;
    }
    std::printf("S5: arithmetic: i = -16 .. 12 gives %d bands, %.2f Hz .. %.2f Hz\n", n, erste, letzte);
    PRUEF(n == NB);
    PRUEF_NAH(erste, 24.80, 0.01);
    PRUEF_NAH(letzte, 16000.0, 0.01);
    Lauf l;
    const auto& a = l.m->spektrum();
    PRUEF(a.anzahl_baender() == NB);
    PRUEF(a.anzahl_baender() == n);
    for (int b = 0; b < a.anzahl_baender(); ++b) PRUEF_NAH(a.band_mitte_hz(b), 1000.0 * std::pow(2.0, (b - 16) / 3.0), 0.01);
    // the encoder: exactly NB integers, no spaces, negative and rounding cases
    float db[NB];
    for (int b = 0; b < NB; ++b) db[b] = -200.0f + 7.77f * b;
    db[0] = -250.0f;
    db[1] = -0.04f;
    db[2] = -0.06f;
    const std::string s = cdj::SpektrumSender::kodiere(db, NB);
    int kommas = 0;
    for (char c : s) kommas += c == ',';
    PRUEF(kommas == NB - 1);
    PRUEF(s.find(' ') == std::string::npos);
    cdj::SpektrumRahmen r{"x", 1, s};
    const Parsed p = parse(r);
    PRUEF(p.ok);
    PRUEF_NAH(p.db[0], -200.0, 0.0001);   // floored
    PRUEF_NAH(p.db[1], 0.0, 0.0001);      // -0.04 dB rounds to 0 (no "-0")
    PRUEF_NAH(p.db[2], -0.1, 0.0001);
    for (int b = 3; b < NB; ++b) PRUEF_NAH(p.db[b], db[b], 0.1);
    std::printf("S5: string of %zu characters, %d integers, e.g. \"%.40s...\"\n", s.size(), kommas + 1, s.c_str());
  }

  // ---- S1: selector 0 ----
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    const auto& a = sz.l.m->spektrum();
    for (int i = 0; i < 20; ++i) sz.periode();   // twenty ticks, nothing selected
    std::printf("S1: selector 0, 20 periods: schreib_position %zu, verlorene %ld, rahmen %ld, generation %u\n", a.schreib_position(), a.verlorene_samples(), a.rahmen(),
                sz.l.m->spek_generation());
    PRUEF(a.schreib_position() == 0);
    PRUEF(a.verlorene_samples() == 0);
    PRUEF(a.rahmen() == 0);
    PRUEF(sz.l.m->spek_generation() == 0);
    PRUEF(sz.l.m->spek_quelle() == 0);
    PRUEF(sz.tick().empty());
    // the tap only reads: the same signal with the tap on gives bit-identical outputs (block by block)
    Szene aus(ERZ1, 1000.0, ERZ2, 5000.0), an(ERZ1, 1000.0, ERZ2, 5000.0);
    an.waehle(ERZ1 + 1);
    bool gleich_alle = true;
    for (int i = 0; i < 40; ++i) {
      aus.block(BLK);
      an.block(BLK);
      gleich_alle = gleich_alle && gleich(aus.l, an.l, BLK);
    }
    PRUEF(gleich_alle);
    PRUEF(an.l.m->spektrum().schreib_position() == 40u * BLK);   // positive control: the tap on wrote
    // and switching the selector back to 0 stops the writing
    const auto pos = an.l.m->spektrum().schreib_position();
    an.waehle(0);
    an.samples(5 * BLK);
    PRUEF(an.l.m->spektrum().schreib_position() == pos);
    PRUEF(an.l.m->spek_generation() == 4);   // two changes (on, off), two steps each: odd while written, even after
    std::printf("S1: tap on: %zu samples written, bit-identical to tap off in 40 blocks; back to 0: no further writes\n", pos);
  }

  // ---- S2: levels and bands ----
  {
    std::string fixture;   // SPEKTRUM_FIXTURE=<file>: the frames the sender produced for the probes, for the page tests (tests/fixtures/spektrum_rahmen.json)
    auto messe = [&fixture](int kanal, double f, int sel, double amp) {
      Szene sz(kanal, f, -1, 0.0, amp);
      sz.waehle(sel);
      Parsed p;
      cdj::SpektrumRahmen letzter;
      for (int i = 0; i < 30; ++i) {
        const auto fr = sz.periode();
        if (!fr.empty()) { p = parse(fr[0]); letzter = fr[0]; }
      }
      PRUEF(p.ok);
      if (std::getenv("SPEKTRUM_FIXTURE") && sel == ERZ1 + 1 && amp == 1.0) {
        char z[512];
        std::snprintf(z, sizeof z, "%s{\"hz\": %g, \"kanal\": \"%s\", \"rahmen\": %d, \"pegel\": \"%s\"}", fixture.empty() ? "" : ",\n  ", f, letzter.kanal.c_str(),
                      letzter.rahmen, letzter.pegel.c_str());
        fixture += z;
      }
      return p;
    };
    const Parsed k1 = messe(ERZ1, 1000.0, ERZ1 + 1, 1.0);
    std::printf("S2: 1 kHz amplitude 1 through erz/1: band %d reads %.2f dB, peak band %d\n", B1K, k1.db[B1K], argmax(k1.db, NB));
    PRUEF_NAH(k1.db[B1K], 0.0, 0.5);
    PRUEF(argmax(k1.db, NB) == B1K);
    const Parsed k5 = messe(ERZ1, 5000.0, ERZ1 + 1, 1.0);
    std::printf("S2: 5 kHz through erz/1: peak band %d, %.2f dB\n", argmax(k5.db, NB), k5.db[B5K]);
    PRUEF(argmax(k5.db, NB) == B5K);
    PRUEF_NAH(k5.db[B5K], 0.0, 0.5);
    const Parsed k100 = messe(ERZ1, 100.0, ERZ1 + 1, 1.0);
    std::printf("S2: 100 Hz through erz/1: peak band %d (centre %.1f Hz), %.2f dB\n", argmax(k100.db, NB), 1000.0 * std::pow(2.0, (B100 - 16) / 3.0), k100.db[B100]);
    PRUEF(argmax(k100.db, NB) == B100);
    if (const char* datei = std::getenv("SPEKTRUM_FIXTURE")) {
      if (FILE* fp = std::fopen(datei, "w")) {
        std::fprintf(fp, "[\n  %s\n]\n", fixture.c_str());
        std::fclose(fp);
      }
    }
    // the master tap (19) hears the sum: the 1 kHz on erz/1 arrives on the master at about the channel level; a bus tap hears its own input
    const Parsed ms = messe(ERZ1, 1000.0, cdj::Mixer::SPEK_MASTER, 0.5);
    std::printf("S2: master tap (19), 1 kHz amplitude 0.5 on erz/1: peak band %d, %.2f dB\n", argmax(ms.db, NB), ms.db[B1K]);
    PRUEF(argmax(ms.db, NB) == B1K);
    PRUEF(ms.db[B1K] > -12.0f && ms.db[B1K] < 0.0f);
    {
      Szene bus(BUS1, 5000.0, -1, 0.0, 1.0);
      bus.waehle(BUS1 + 1);
      Parsed p;
      for (int i = 0; i < 30; ++i) {
        const auto fr = bus.periode();
        if (!fr.empty()) p = parse(fr[0]);
      }
      std::printf("S2: bus/1 tap, 5 kHz on its input: tag %s, peak band %d\n", p.kanal.c_str(), argmax(p.db, NB));
      PRUEF(p.kanal == "bus/1" && argmax(p.db, NB) == B5K);
    }
    // negative control: a channel nobody selected is not heard (erz/2 carries 5 kHz, the tap is erz/1 with silence)
    {
      Szene sz(ERZ2, 5000.0, -1, 0.0, 1.0);
      sz.waehle(ERZ1 + 1);
      Parsed p;
      for (int i = 0; i < 20; ++i) {
        const auto fr = sz.periode();
        if (!fr.empty()) p = parse(fr[0]);
      }
      PRUEF(p.ok && p.kanal == "erz/1");
      PRUEF(p.db[B5K] <= -150.0f);
    }
  }

  // ---- S3: no allocation and no lock ----
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("S3 skipped (sanitizer build): allocation watcher not available\n");
  } else {
    {
      abfang_an();
      { std::vector<float> v(1000); v[1] = 1.0f; }
      std::mutex mu;
      mu.lock();
      mu.unlock();
      const AbfangZahlen pk = abfang_zahlen();
      abfang_aus();
      std::printf("S3: positive control: %ld allocations, %ld frees, %ld locks\n", pk.alloc, pk.frei, pk.sperren);
      PRUEF(pk.alloc >= 1 && pk.sperren >= 1);
    }
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    // prepare the input outside the window (the helper allocates); then count the audio-thread call alone
    std::vector<float> in[2];
    for (int c = 0; c < 2; ++c) in[c].resize(BLK);
    AbfangZahlen summe;
    long bloecke = 0;
    for (int sel : {ERZ1 + 1, ERZ2 + 1, BUS1 + 1, cdj::Mixer::SPEK_MASTER, 0, ERZ1 + 1}) {   // a switch every 20 blocks: the switching blocks are counted too
      sz.waehle(sel);
      for (int i = 0; i < 20; ++i) {
        for (int c = 0; c < 2; ++c) sz.l.sinus(sz.kanal[c], sz.freq[c], 1.0, 1.0, BLK);
        abfang_an();
        sz.l.m->verarbeite(BLK, sz.l.ml, sz.l.mr, sz.l.cl, sz.l.cr);
        summe += abfang_zahlen();
        abfang_aus();
        sz.l.t += BLK;
        ++bloecke;
      }
    }
    std::printf("S3: Mixer::verarbeite with the tap, %ld blocks (6 switches): %ld allocations, %ld frees, %ld locks, %ld sleeps\n", bloecke, summe.alloc, summe.frei,
                summe.sperren, summe.schlafen);
    PRUEF(summe.summe() == 0);
    // analysiere() on a filled ring (the consumer side)
    sz.waehle(ERZ1 + 1);
    sz.samples(10 * BLK);
    sz.snd.tick(sz.jetzt);
    sz.jetzt += TICK_NS;
    sz.samples(8 * BLK);
    auto& an = sz.l.m->spektrum();
    abfang_an();
    const int frames = an.analysiere();
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    std::printf("S3: analysiere(): %d frames: %ld allocations, %ld frees, %ld locks, %ld sleeps\n", frames, az.alloc, az.frei, az.sperren, az.schlafen);
    PRUEF(frames >= 3);
    PRUEF(az.summe() == 0);
  }

  // ---- S4 ----
  const S4Ergebnis a = s4(false);
  const S4Ergebnis b = s4(true);
  std::printf("S4: first erz/2 frame at tick %d (a) and tick %d (b) after the switch\n", a.erster_erz2_tick, b.erster_erz2_tick);
  rennen();
  fenster();

  // ---- cadence: the 2 ms loop calls tick() every 2 ms, a frame may leave only every 40 ms ----
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 12; ++i) sz.periode();   // warm: frames flow
    int mit_rahmen = 0;
    for (int i = 0; i < 40; ++i) {   // 40 calls x 2 ms = 80 ms, 96 samples of audio per call
      sz.samples(96, 96);
      if (!sz.snd.tick(sz.jetzt).empty()) ++mit_rahmen;
      sz.jetzt += 2'000'000;
    }
    std::printf("cadence: 40 calls at 2 ms spacing (80 ms): %d call(s) with a frame\n", mit_rahmen);
    PRUEF(mit_rahmen >= 1 && mit_rahmen <= 2);   // >= 1 is the positive control (frames do come); <= 2 is the 40 ms rule
  }

  // ---- erz/8: the cue-only channel returns early in kanal(); its tap must still feed the analyser ----
  {
    Szene sz(ERZ8, 1000.0, -1, 0.0);
    sz.l.m->setze_nur_cue(ERZ8);
    PRUEF(sz.l.m->nur_cue(ERZ8));
    sz.waehle(ERZ8 + 1);
    Parsed p;
    for (int i = 0; i < 20; ++i) {
      const auto f = sz.periode();
      if (!f.empty()) p = parse(f[0]);
    }
    std::printf("erz/8 (cue only): tag %s, peak band %d, %.2f dB\n", p.kanal.c_str(), argmax(p.db, NB), p.db[B1K]);
    PRUEF(p.ok && p.kanal == "erz/8");
    PRUEF(argmax(p.db, NB) == B1K);
  }

  // ---- S7: stall ----
  {
    Szene sz(ERZ1, 1000.0, ERZ2, 5000.0);
    sz.waehle(ERZ1 + 1);
    for (int i = 0; i < 4; ++i) sz.periode();
    std::vector<double> voll_us, leer_us;
    long max_rahmen = 0, min_rahmen = 1000;
    for (int rep = 0; rep < 100; ++rep) {
      sz.samples(70 * BLK);   // the consumer stalls: 16 800 samples, the ring is full
      const long r0 = sz.l.m->spektrum().rahmen();
      const auto t0 = std::chrono::steady_clock::now();
      const auto f = sz.tick();
      const auto t1 = std::chrono::steady_clock::now();
      const long analysiert = sz.l.m->spektrum().rahmen() - r0;   // frames this one tick computed
      max_rahmen = std::max(max_rahmen, analysiert);
      min_rahmen = std::min(min_rahmen, analysiert);
      voll_us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
      PRUEF(f.size() == 1);
      const auto t2 = std::chrono::steady_clock::now();
      sz.tick();   // inside the 40 ms: returns at once
      sz.jetzt += TICK_NS;
      const auto f2 = sz.tick();   // the ring is empty
      const auto t3 = std::chrono::steady_clock::now();
      leer_us.push_back(std::chrono::duration<double, std::micro>(t3 - t2).count());
      PRUEF(f2.empty());
    }
    std::sort(voll_us.begin(), voll_us.end());
    std::sort(leer_us.begin(), leer_us.end());
    std::printf("S7: frames analysed by one full-ring tick: min %ld, max %ld (ring 16384, hop 512: at most 32)\n", min_rahmen, max_rahmen);
    // structural, always: one tick analyses at most 32 frames, and it did the work (positive control: at least 28)
    PRUEF(max_rahmen <= 32);
    PRUEF(min_rahmen >= 28);
    double last = 0.0;
    if (FILE* lf = std::fopen("/proc/loadavg", "r")) {
      if (std::fscanf(lf, "%lf", &last) != 1) last = 0.0;
      std::fclose(lf);
    }
    const unsigned kerne = std::max(1u, std::thread::hardware_concurrency());
    std::printf("S7: tick with a full ring: min %.0f us, median %.0f us, p95 %.0f us, max %.0f us; empty ticks (2): median %.1f us; load %.2f on %u cores\n", voll_us[0],
                voll_us[50], voll_us[95], voll_us.back(), leer_us[50], last, kerne);
#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
    std::printf("S7 timing gate not timed (sanitizer build)\n");
#else
    if (last > 0.5 * kerne) {
      std::printf("S7 timing gate not timed, load %.2f\n", last);
    } else {
      PRUEF(voll_us[50] < 1000.0);   // the median of 100 stalls
      PRUEF(leer_us[50] < voll_us[50]);
    }
#endif
  }
  PRUEF_ENDE();
}
