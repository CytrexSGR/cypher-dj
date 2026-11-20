// 1.8 T7b: live notes in the real core. Track 2 is an internal RB-338 track, armed for MIDI (eingang 30, the bit in the module); notes through Kern::midi_ein sound on it at their
// stamp, with nothing recording, and every trigger closes the held key: disarm, end of the run, transport stop, a swap of the playback (the track gets no sink, another sink),
// midi_ein_1 going away. Each case: key held and audible, trigger, the track bus (PM tap) silent within 100 ms, the live table 0 (Arrangement::live_offene_noten).
//   K1 a note at a known offset in a cycle: silent before the stamp, audible from it, the table holds it
//   K2 retrigger: the same key again leaves one entry, the sound goes on; the off closes it
//   K3 disarm  K4 end of the run (the transport keeps playing; a key played after it sounds again)  K5 transport stop  K6 swap (two variants)  K7 midi_ein disconnect
//   K9 planned (quantized) transport stop inside a cycle, the live On stamped after the stop sample in the same cycle: the note sounds from its onset, stays held, the player's off ends it
//   K8 quantum 2048: a note at offset 1500 (second sub-block) is not lost (the stamp is clamped into the first sub-block), and the sink counts nothing lost
//   K10 /k/arr/note (sampler plan A1 task 7): one note on a project track with the transport standing and no arm: on, off (vel 0), spur 0 and 33 refused spur_bereich with
//       nothing reaching the sink, cypher after the AI stop refused ki_gestoppt (andreas still plays)
//   K11 /k/arr/stift (kraken patch field): a held note on a bk track whose graph has a matrix is silent until a pin arrives, with the transport standing; the pin sounds at once (receipts 1 and 3),
//       a refused pin (spur 0) changes nothing; the pin waits behind a queued ARR_LADEN exactly as ARR_NOTE (full event ring: the load waits for the return, the pin and the note behind it)
//       and sounds after the swap
// Mutations built against this test: LIVE_AUS_BEI_DISARM_FEHLT (K3). LIVE_NOTE_VERWORFEN and LIVE_ALLE_AUS_LEER have targets only against test_arr_live; here K1 and K4, K5, K7
// pin the same properties through the live table and the bus level, but no mutation binary of this test exists for them.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>

#include "arr_run.h"

bool g_waechter = false;
using k35::N;

namespace {

const char* RB = "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.6,\"resonanz\":0.3},\"noten\":[]}";

float spitze(const std::vector<float>& v, int64_t a, int64_t b) {
  float m = 0.0f;
  for (int64_t i = std::max<int64_t>(a, 0); i < b && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, std::fabs(v[i]));
  return m;
}

struct Rig {
  arr35::Lauf x;
  cdj::RecMidi* m = cdj::RecMidi::neu();
  bool adoptiert = false;
  Rig(const std::string& ab, const char* name, const char* spuren = RB) : x(ab, name) {
    x.laden(5, spuren);
    x.lauf(12 * N);
    arm();
  }
  void arm() {
    cdj::Befehl b = x.neu(cdj::Befehl::REC_SPUR, "andreas");
    b.nr = 2; b.an = 1; b.deck = 30; b.zeiger = m;
    const int64_t id = x.sende(b);
    x.lauf(x.kern->sample() + 3 * N);
    PRUEF(x.quittung(id, 3) != nullptr && x.kern->aufnahme().midi_maske() == (1u << 1));
    adoptiert = true;
  }
  int64_t disarm() {
    cdj::Befehl b = x.neu(cdj::Befehl::REC_SPUR, "andreas");
    b.nr = 2; b.an = 0; b.deck = 30; b.zeiger = nullptr;
    return x.sende(b);
  }
  // the first cycle start at least two cycles ahead
  int64_t voraus() const { return (x.kern->sample() / N + 2) * N; }
  void ein(int64_t s, uint8_t st, uint8_t ton, uint8_t vel) { x.midi_ein_bei(s, st, ton, vel); }
  int live() const { return x.kern->arrangement().live_offene_noten(); }
  void ende() {   // hand the recorder back and free it (the take of a run, if any, is closed as the thread would)
    if (adoptiert) {
      if (m->phase.load() == 2) m->phase.store(3, std::memory_order_release);
      if (x.kern->aufnahme().midi_spur() == m) {
        disarm();
        x.lauf(x.kern->sample() + 3 * N);
      }
    }
    cdj::RecMidi::frei(m);
  }
};

// key held and audible: returns the first sample of the cycle after the trigger window starts
void halten(Rig& r, uint8_t ton, int64_t& ziel) {
  const int64_t basis = r.voraus();
  ziel = basis + 100;
  r.ein(ziel, 0x90, ton, 100);
  r.x.lauf(basis + 4 * N);
  PRUEF(r.live() == 1);
  PRUEF(spitze(r.x.pm_l, ziel, basis + 4 * N) > 0.001f);   // above -60 dBFS
}

// after the trigger: the live table is 0 and the track bus is silent from 100 ms on (a window of 50 ms)
void still(Rig& r, int64_t t, const char* was) {
  r.x.lauf(t + 4800 + 2400 + N);
  const float sp = spitze(r.x.pm_l, t + 4800, t + 4800 + 2400);
  std::printf("%s: live table %d, bus peak in [t + 100 ms, t + 150 ms) %.3g\n", was, r.live(), sp);
  PRUEF(r.live() == 0);
  PRUEF(sp < 1e-4f);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_live");
  {  // K1: sample position, nothing else armed
    Rig r(ab.pfad, "test_kern_live_k1");
    const int64_t ziel = r.voraus() + 100;
    r.ein(ziel, 0x90, 40, 100);
    r.x.lauf(ziel + 4 * N);
    int64_t erster = -1;
    for (int64_t i = ziel - 2 * N; i < ziel + 4 * N && erster < 0; ++i)
      if (r.x.pm_l[i] != 0.0f) erster = i;
    std::printf("K1: stamp %lld, first sound %lld, peak in the cycle %.4f\n", static_cast<long long>(ziel), static_cast<long long>(erster),
                spitze(r.x.pm_l, ziel, (ziel / N + 1) * N));
    PRUEF(erster >= ziel && erster < ziel + 16);   // not before the stamp, and in the cycle that holds it
    PRUEF(spitze(r.x.pm_l, ziel, (ziel / N + 1) * N) > 0.001f);
    PRUEF(r.live() == 1 && r.x.kern->arrangement().offene_noten() == 0);
    PRUEF(r.x.kern->arr_rb().verloren() == 0);
    r.ein(r.voraus() + 7, 0x80, 40, 0);
    r.x.lauf(r.x.kern->sample() + 4 * N);
    PRUEF(r.live() == 0);
    r.ende();
  }
  {  // K2: retrigger
    Rig r(ab.pfad, "test_kern_live_k2");
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t z2 = r.voraus() + 50;
    r.ein(z2, 0x90, 40, 90);
    r.x.lauf(z2 + 4 * N);
    PRUEF(r.live() == 1 && spitze(r.x.pm_l, z2, z2 + 4 * N) > 0.001f);
    r.ein(r.voraus() + 3, 0x90, 40, 0);   // an On with velocity 0 is an off
    r.x.lauf(r.x.kern->sample() + 4 * N);
    PRUEF(r.live() == 0);
    r.ende();
  }
  {  // K3: disarm while a key is held
    Rig r(ab.pfad, "test_kern_live_k3");
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    const int64_t id = r.disarm();
    still(r, t, "K3 disarm");
    PRUEF(r.x.quittung(id, 3) != nullptr && r.x.kern->aufnahme().midi_maske() == 0u);
    r.adoptiert = false;   // the recorder went back through REC_ALT (fassung 1): ende() only frees it
    r.x.lauf(r.x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K4: end of the run; the transport keeps playing, a key played afterwards sounds again
    Rig r(ab.pfad, "test_kern_live_k4");
    const int64_t rr = r.x.rec_start(190, 0);
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 40 * N);
    PRUEF(r.x.quittung(rr, 2) != nullptr && r.x.quittung(sid, 2) != nullptr);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.rec_stopp();
    still(r, t, "K4 run end");
    PRUEF(r.x.quittung(rr, 3) != nullptr && r.x.kern->arrangement().status() == cdj::ArrStatus::spielt);
    const int64_t z2 = r.voraus() + 20;
    r.ein(z2, 0x90, 43, 100);   // not recording any more: the live path still plays
    r.x.lauf(z2 + 4 * N);
    PRUEF(r.live() == 1 && spitze(r.x.pm_l, z2, z2 + 4 * N) > 0.001f);
    r.x.stopp(0);
    r.x.lauf(r.x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K5: transport stop
    Rig r(ab.pfad, "test_kern_live_k5");
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 40 * N);
    PRUEF(r.x.quittung(sid, 2) != nullptr);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.stopp(0);
    still(r, t, "K5 transport stop");
    r.ende();
  }
  {  // K6: swap of the playback: track 2 loses its sink, track 2 gets the Wirt sink
    for (int variante = 0; variante < 2; ++variante) {
      Rig r(ab.pfad, variante ? "test_kern_live_k6b" : "test_kern_live_k6a");
      int64_t ziel = 0;
      halten(r, 40, ziel);
      const int64_t t = r.x.kern->sample();
      if (variante == 0) r.x.laden(6, "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}");   // track 2 is empty
      else r.x.laden(6, "{\"nr\":2,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");                             // track 2 is a Wirt track
      still(r, t, variante ? "K6 swap to the Wirt sink" : "K6 swap to an empty track");
      r.ende();
    }
  }
  {  // K7: midi_ein_1 goes away
    Rig r(ab.pfad, "test_kern_live_k7");
    r.x.kern->ein_verbunden(1u << 8);
    r.x.lauf(r.x.kern->sample() + 3 * N);
    int64_t ziel = 0;
    halten(r, 40, ziel);
    const int64_t t = r.x.kern->sample();
    r.x.kern->ein_verbunden(0);
    still(r, t, "K7 midi_ein disconnect");
    r.ende();
  }
  {  // K8: quantum 2048, a note in the second sub-block of the cycle
    Rig r(ab.pfad, "test_kern_live_k8");
    arr35::Lauf& x = r.x;
    std::vector<float> pm;
    const auto zyklus = [&](int n, int versatz, uint8_t st, uint8_t ton, uint8_t vel) {   // one cycle of n samples, one MIDI event at the offset (versatz < 0: none)
      const int64_t n0 = x.kern->sample();
      if (versatz >= 0) {
        const uint8_t d[3] = {st, ton, vel};
        x.kern->midi_ein(d, 3, static_cast<uint32_t>(versatz));
      }
      x.kern->zyklus(n, n0 * 20833);
      x.lader.einmal(*x.lr);
      pm.resize(static_cast<size_t>(n0 + n));
      for (int i = 0; i < n; ++i) pm[n0 + i] = x.kern->pm_abgriff_l()[i];
      cdj::Ereignis e;
      while (x.ere->hole(e)) {
        if (e.art != cdj::Ereignis::UHR && e.art != cdj::Ereignis::ZYKLUS) x.ev.push_back(e);
      }
      return n0;
    };
    while (x.kern->sample() % 2048 != 0) x.lauf(x.kern->sample() + N);
    for (int i = 0; i < 4; ++i) zyklus(2048, -1, 0, 0, 0);
    const int64_t n0 = zyklus(2048, 1500, 0x90, 40, 100);   // offset 1500: the second sub-block (1024 .. 2047)
    zyklus(2048, -1, 0, 0, 0);
    int64_t erster = -1;
    for (int64_t i = n0; i < n0 + 4096 && erster < 0; ++i)
      if (pm[i] != 0.0f) erster = i;
    std::printf("K8: quantum 2048, offset 1500 stamped at %lld, first sound %lld, peak %.4f, RB lost %llu\n", static_cast<long long>(n0 + 1023), static_cast<long long>(erster),
                spitze(pm, n0, n0 + 4096), static_cast<unsigned long long>(x.kern->arr_rb().verloren()));
    PRUEF(x.kern->arrangement().live_offene_noten() == 1);
    PRUEF(erster >= n0 + 1023 && erster < n0 + 1023 + 16);   // the clamped stamp: the last sample of the first sub-block, never earlier
    PRUEF(spitze(pm, n0, n0 + 4096) > 0.001f);                 // the note is not lost
    PRUEF(x.kern->arr_rb().verloren() == 0);
    zyklus(2048, 100, 0x80, 40, 0);
    PRUEF(x.kern->arrangement().live_offene_noten() == 0);
    x.lauf(x.kern->sample() + 3 * N);
    r.ende();
  }
  {  // K9: planned stop inside a cycle, live On after the stop sample in the same cycle (the review case: it used to ring on with the table at 0)
    Rig r(ab.pfad, "test_kern_live_k9");
    const int64_t sid = r.x.start(0.0, 0);
    r.x.lauf(r.x.kern->sample() + 100 * N);   // past the first beat: the stop falls on a later one, 225 samples into its cycle
    PRUEF(r.x.quittung(sid, 2) != nullptr);
    r.x.stopp(1);   // the next beat
    r.x.lauf(r.x.kern->sample() + 2 * N);
    const int64_t z = r.x.kern->arrangement().stopp_sample();
    const int64_t c = z / N * N;   // start of the cycle that holds the stop sample
    std::printf("K9: stop sample %lld, cycle start %lld, now %lld\n", static_cast<long long>(z), static_cast<long long>(c), static_cast<long long>(r.x.kern->sample()));
    PRUEF(z > 0 && z % N > 0 && z % N < N - 24 && c > r.x.kern->sample() + N);
    r.ein(z + 20, 0x90, 40, 100);
    r.x.lauf(c + 4 * N);
    PRUEF(r.x.kern->arrangement().status() == cdj::ArrStatus::steht);
    std::printf("K9: live table %d, peak after the onset %.4f\n", r.live(), spitze(r.x.pm_l, z + 20, c + 4 * N));
    PRUEF(r.live() == 1);                                       // held: its On came after the stop sample
    PRUEF(spitze(r.x.pm_l, z + 20, c + 4 * N) > 0.001f);        // and it sounds
    const int64_t t = r.voraus() + 7;
    r.ein(t, 0x80, 40, 0);
    r.x.lauf(t + N);
    PRUEF(r.live() == 0);
    still(r, t, "K9 planned stop");
    r.ende();
  }
  {  // K10: /k/arr/note plays one note on a project track while the transport stands, with no MIDI arm (the click-to-hear path of the sampler)
    const char* RB1 = "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.6,\"resonanz\":0.3},\"noten\":[]}";
    arr35::Lauf x(ab.pfad, "test_kern_live_k10");
    x.laden(5, RB1);
    x.lauf(12 * N);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht && x.kern->aufnahme().midi_maske() == 0u);   // transport stands, nothing armed
    const auto live = [&] { return x.kern->arrangement().live_offene_noten(); };
    const auto note = [&](int spur, int ton, int vel, const char* quelle) {   // /k/arr/note: nr = spur, politik = ton, fassung = vel
      cdj::Befehl b = x.neu(cdj::Befehl::ARR_NOTE, quelle);
      b.nr = spur; b.politik = ton; b.fassung = vel;
      return x.sende(b);
    };
    // on: the track sounds at the PM tap within the next cycles
    const int64_t t0 = x.kern->sample();
    const int64_t id1 = note(1, 60, 100, "andreas");
    x.lauf(t0 + 8 * N);
    const float an = spitze(x.pm_l, t0, t0 + 8 * N);
    std::printf("K10 on: ack 1 %d ack 3 %d, live table %d, peak in 8 cycles %.4f\n", x.quittung(id1, 1) != nullptr, x.quittung(id1, 3) != nullptr, live(), an);
    PRUEF(x.quittung(id1, 1) != nullptr && x.quittung(id1, 3) != nullptr);
    PRUEF(live() == 1 && an > 0.001f);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht && x.kern->arrangement().offene_noten() == 0);
    // off (vel 0): silent from 100 ms on, live table empty
    const int64_t t1 = x.kern->sample();
    const int64_t id2 = note(1, 60, 0, "andreas");
    x.lauf(t1 + 4800 + 2400 + N);
    const float aus = spitze(x.pm_l, t1 + 4800, t1 + 4800 + 2400);
    std::printf("K10 off: ack 3 %d, live table %d, peak in [t + 100 ms, t + 150 ms) %.3g\n", x.quittung(id2, 3) != nullptr, live(), aus);
    PRUEF(x.quittung(id2, 3) != nullptr && live() == 0 && aus < 1e-4f);
    // spur outside 1..32: refused spur_bereich, no note reaches the sink (silent bus, empty table, nothing lost)
    const int64_t t2 = x.kern->sample();
    const int64_t id0 = note(0, 60, 100, "andreas"), id33 = note(33, 60, 100, "andreas");
    x.lauf(t2 + 8 * N);
    const float still_ = spitze(x.pm_l, t2, t2 + 8 * N);
    std::printf("K10 spur 0 / 33: refused %d / %d, live table %d, peak %.3g\n", x.quittung(id0, 6) != nullptr, x.quittung(id33, 6) != nullptr, live(), still_);
    PRUEF(x.quittung(id0, 6) && x.quittung(id0, 6)->grund == "spur_bereich");
    PRUEF(x.quittung(id33, 6) && x.quittung(id33, 6)->grund == "spur_bereich");
    PRUEF(!x.quittung(id0, 1) && !x.quittung(id33, 1) && live() == 0 && still_ < 1e-4f && x.kern->arr_rb().verloren() == 0);
    // cypher: plays before the AI stop (negative control), refused ki_gestoppt after it, andreas still plays
    const int64_t t3 = x.kern->sample();
    const int64_t idc = note(1, 62, 100, "cypher");
    x.lauf(t3 + 4 * N);
    PRUEF(x.quittung(idc, 3) != nullptr && live() == 1);
    note(1, 62, 0, "cypher");
    x.lauf(x.kern->sample() + 4800 + 2400 + N);
    PRUEF(live() == 0);
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    x.lauf(x.kern->sample() + 4 * N);
    const int64_t t4 = x.kern->sample();
    const int64_t idk = note(1, 64, 100, "cypher");
    x.lauf(t4 + 8 * N);
    const float ki = spitze(x.pm_l, t4 + N, t4 + 8 * N);
    std::printf("K10 cypher after the AI stop: refused %d, live table %d, peak %.3g\n", x.quittung(idk, 6) != nullptr, live(), ki);
    PRUEF(x.quittung(idk, 6) && x.quittung(idk, 6)->grund == "ki_gestoppt" && !x.quittung(idk, 1));
    PRUEF(live() == 0 && ki < 1e-4f);
    const int64_t t5 = x.kern->sample();
    const int64_t ida = note(1, 64, 100, "andreas");   // Stop Cypher blocks cypher only
    x.lauf(t5 + 4 * N);
    PRUEF(x.quittung(ida, 3) != nullptr && live() == 1);
    note(1, 64, 0, "andreas");
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(live() == 0);
  }
  {  // K11: /k/arr/stift sets a pin of the matrix of a bk track (kraken patch field), with the transport standing
    arr35::Lauf x(ab.pfad, "test_kern_live_k11");
    const std::string bk = x.ordner.pfad + "/bk";
    std::filesystem::create_directories(bk);
    auto namen = [](const char* p) {
      std::string s = "[";
      for (int i = 0; i < 16; ++i) s += std::string(i ? "," : "") + "\"" + p + std::to_string(i) + "\"";
      return s + "]";
    };
    std::ofstream(bk + "/m.json") << R"({"format":"baukasten/2","name":"m","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"m","art":"matrix","zeilen":)" + namen("z") +
                                         R"(,"spalten":)" + namen("s") + R"(},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"m.e1"},{"von":"m.a1","nach":"o.x"}]})";
    x.cache.setze_bk_ordner(bk);
    x.cache.setze_bk_leser(x.kern->arr_bk_leser());
    const char* BK1 = "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"m\",\"noten\":[]}";
    x.laden(5, BK1);
    x.lauf(12 * N);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht && x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 5);
    const auto note = [&](int spur, int ton, int vel) {
      cdj::Befehl b = x.neu(cdj::Befehl::ARR_NOTE, "andreas");
      b.nr = spur; b.politik = ton; b.fassung = vel;
      return x.sende(b);
    };
    const auto stift = [&](int spur, int satz, int zeile, int spalte, float wert, const char* quelle = "andreas") {   // /k/arr/stift: nr = spur, form = satz, politik = zeile, fassung = spalte
      cdj::Befehl b = x.neu(cdj::Befehl::ARR_STIFT, quelle);
      b.nr = spur; b.form = satz; b.politik = zeile; b.fassung = spalte; b.wert = wert;
      return x.sende(b);
    };
    // a held note with no pin: silent (the graph has no default pin)
    const int64_t t0 = x.kern->sample();
    note(1, 57, 100);
    x.lauf(t0 + 8 * N);
    const float still0 = spitze(x.pm_l, t0, t0 + 8 * N);
    // a pin of a spur outside 1..32 is refused and changes nothing
    const int64_t t1 = x.kern->sample();
    const int64_t id0 = stift(0, 0, 0, 0, 1.0f);
    x.lauf(t1 + 8 * N);
    const float still1 = spitze(x.pm_l, t1, t1 + 8 * N);
    PRUEF(x.quittung(id0, 6) && x.quittung(id0, 6)->grund == "spur_bereich" && !x.quittung(id0, 1));
    // the pin of track 1: receipts 1 and 3, the held note sounds
    const int64_t t2 = x.kern->sample();
    const int64_t id1 = stift(1, 0, 0, 0, 1.0f);
    x.lauf(t2 + 8 * N);
    const float an = spitze(x.pm_l, t2 + N, t2 + 8 * N);
    std::printf("K11 no pin: peak %.3g / refused pin: peak %.3g; pin: ack 1 %d ack 3 %d, peak %.4f\n", still0, still1, x.quittung(id1, 1) != nullptr, x.quittung(id1, 3) != nullptr, an);
    PRUEF(still0 < 1e-4f && still1 < 1e-4f);
    PRUEF(x.quittung(id1, 1) != nullptr && x.quittung(id1, 3) != nullptr && an > 0.001f);
    PRUEF(x.kern->arrangement().status() == cdj::ArrStatus::steht);
    // the pin off again (wert 0): silent
    const int64_t t3 = x.kern->sample();
    stift(1, 0, 0, 0, 0.0f);
    x.lauf(t3 + 16 * N);
    const float aus = spitze(x.pm_l, t3 + 12 * N, t3 + 16 * N);   // the pin glides out (about 5 ms)
    PRUEF(aus < 1e-3f);
    note(1, 57, 0);
    x.lauf(x.kern->sample() + 4 * N);
    // behind a queued ARR_LADEN: the event ring is full, the load of 6 swaps the playback and leaves the return of 5 open, the load of 7 waits for that place; pin and note queue behind it
    x.abholen = false;
    while (x.kern->ereignisse_verloren() == 0) x.zyklen(x.kern->sample() + N);
    x.laden(6, BK1);
    x.zyklen(x.kern->sample() + 2 * N);
    const int64_t l7 = x.laden(7, BK1);
    x.zyklen(x.kern->sample() + 2 * N);
    const int64_t tw = x.kern->sample();
    const int64_t idw = stift(1, 0, 0, 0, 1.0f);
    const int64_t idn = note(1, 57, 100);
    x.zyklen(tw + 6 * N);
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 6);
    PRUEF(!x.quittung(idw, 1) && !x.quittung(idw, 3) && !x.quittung(l7, 3));   // still waiting behind the load
    x.abholen = true;
    const int64_t tr = x.kern->sample();
    x.lauf(tr + 12 * N);
    const float nach = spitze(x.pm_l, tr + 6 * N, tr + 12 * N);
    std::printf("K11 behind a queued load: waiting ack %d, after the release snapshot %lld, ack 1 %d ack 3 %d, peak %.4f\n", x.quittung(idw, 3) != nullptr,
                x.kern->arrangement().snapshot() ? static_cast<long long>(x.kern->arrangement().snapshot()->nr) : -1LL, x.quittung(idw, 1) != nullptr, x.quittung(idw, 3) != nullptr, nach);
    (void)idn;
    PRUEF(x.kern->arrangement().snapshot() && x.kern->arrangement().snapshot()->nr == 7);
    PRUEF(x.quittung(l7, 3) && x.quittung(idw, 1) && x.quittung(idw, 3) && nach > 0.001f);
  }
  PRUEF_ENDE();
}
