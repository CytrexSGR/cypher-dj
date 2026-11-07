// D1 K1 Slice 11 (A10): Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples) mit spielendem Arrangement, als
// Vergleich gegen die Lage ohne Arrangement im selben Lauf. Lagen, je N Zyklen nach 2 000 zum Einschwingen:
//   ohne   kein Arrangement geladen (wie kern_kosten31 „ohne“)
//   arr3   drei Spuren: Audio (Kick-Impulse je Beat, 0,1 s), intern und Wirt (je 16 Noten je Takt an Kostensenken ohne
//          Ton, Vorhalt 0 und 537), Loop-Klammer 8 Takte, Metronom an, Fader-Rampe über das Stellwerk
//   arr3rb wie arr3, aber mit den Senken des Kerns (D1 K2b): RB-338 für die interne Spur, Wirt-Slot 1 ohne Wirt
//          (MIDI in den Zyklus-Puffer, Rückweg ohne JACK-Puffer, Messpunkt A4 läuft mit)
//   hand   wie arr3 (Senken ohne Ton), dazu hält ein Mensch einen Regler (erz/3/fader): alle 500 Zyklen ein neuer Griff
//          (/test/hand), die Rückgabe nach 32 Beats kommt nie. Damit ist n_mensch_ > 0 und der Rueck-Pfad des
//          Stellwerks (Stapelfeld Rueck rueck[MAX_REGLER], ablauf.cpp) läuft in jedem Zyklus (E1, Deckel-Messung).
//   arr32  E3 Task 9: 32 belegte Spuren mit den Senken des Kerns: Spur 1 bis 24 RB-338 (je Beat vier Sechzehntel), Spur 25 bis
//          32 Audio (je ein durchlaufender Clip über die ganze Schleife), Loop-Klammer 8 Takte, Metronom an. Alle 32
//          Spur-Fader haben einen Verlauf (Start nach dem Einschwingen, Beat 24, über 240 Beats). Auf Spur 3 liegt ein
//          Solo-Verlauf: alle 4 Beats ein Solo für eine Sechzehntel (ein Schalter nimmt keine Rampe, das Stellwerk lehnt sie ab).
//          Der Solo-Verlauf besteht nur im Block der Schaltung (regler.cpp:152 schaltet ohne Schaltrampe): der Solo-Scan
//          (arr_ausgang.cpp, solo_vl) läuft in etwa 114 von 20 000 Zyklen. Der Median enthält ihn nicht; die Lage meldet die
//          Schalt-Blöcke getrennt (Zeile „arr32: Solo-Schaltblöcke“).
//   arr32rack  1.9 U6 (AK-R8): arr32 with the tracks 1..8 as racks of four internal members (three RB-338 and one kit; 8 x 4 = 32 member slots), one note per member and sixteenth. Self-check: 8 racks with 4 members, every member got its note ons, kit voices started, nothing lost (exit 2 otherwise). Gate AK-R8: p99,9 < 1067 us and max < 2667 us in 5 of 5 runs under the U1b T1.8 conditions.
//   arr32g 1.10 Task 15: wie arr32 (32 klingende Spuren, Spur-Rampen, Solo auf Spur 3), aber mit Wiedergabe /2: die 32 Spuren
//          laufen in 8 Gruppen zu je 4 Spuren (Spur sp in Gruppe (sp-1)%8+1), alle Gruppen in den PM. Dazu Rampen an den 8
//          Gruppen-Fadern (Ziel −1 − g%3 dB) und am PM-Fader (−2 dB), Beat 24 über 240 Beats. Selbstprüfung wie arr32, dazu
//          muss der Fader von Gruppe 1 und der PM-Fader am Ende unter 0 dB stehen (sonst Ende 2).
//   arr32ins, arr32ins_aus  1.10 slice 4a (T8): the arr32r project (32 tracks, 4 returns with a Hall each, 128 sends) plus the whole pool of 12 komp insert stages, spread like a dense
//          project: tracks 1, 2, 3 (one stage each), 5 (two), 25, 26; group 1 and 2 (tracks 1..4 and 5..8 are routed into them); returns 1 and 2; the PM. Two stages listen to a
//          sidechain key (slot 1 on track 3 keyed by track 1, slot 4 on track 5 keyed by track 2). The rows ins/komp/<n>/an are set to 1 (arr32ins) or 0 (arr32ins_aus: the same file, all 12
//          stages bypassed, the lane's own error case: its median must equal arr32r within noise, otherwise the lane measures the wrong thing; note that the file routes tracks 1..8 into
//          two groups, which the arr32r file does not, so a small constant offset from the two group strips is expected). Self-check (exit 2): 12 stages in the snapshot chains, all 12 stages
//          computed in the last block (arr32ins) or none (arr32ins_aus), NaN counter 0, no rejected part.
//          Slice 4b (T12): plus the whole pools of eq (1 instance, the "eq_mix" setting of kosten_ins: 2 cuts, 2 shelves, 4 bells, one band Mid; on track 6) and saett (1 instance, drive 12 dB;
//          on track 7), so 14 stages. The expected counts below are 14; the comparison with arr32ins_aus holds as before.
//          Master limiter plan (2026-11-06): plus lim 1 on the PM after komp 12 (an 1, ceiling -1 dB) in every lane that computes stages, bypassed in arr32ins_aus.
//   arr32ins_ol  master limiter plan: arr32ins with only the lim bypassed; arr32ins - arr32ins_ol (same pass, interleaved) is the price of the limiter.
//   arr32ins_k, arr32ins_ke, arr32ins_ks  slice 4b T12, the pool decision: the same file and rows as arr32ins, but the eq (_k, _ks) or the saett (_k, _ke) is switched off (`an` 0), so the lane
//          shape of slice 4a (_k), plus the eq only (_ke), plus the saett only (_ks). Measure them interleaved with arr32ins in one pass and read the paired differences.
//   arr32voll  1.10 slices 5 to 8, U0: the full-load lane. The arr32ins stages (12 komp, the eq, the saett: every pool full) plus four 4c racks with 16 mappings each (rack 1 on track 5: the two
//          komp stages, all 8 mappable parameters each; rack 2 on track 6: the eq, out, the q of band 1, the gain of all 8 bands and the frequency of the bands 3 to 8; rack 3 on track 25: two komp
//          stages; rack 4 on group 1: two komp stages), the 16 macro rows set to four different values, and the delay compensation active with a latency stage on a track (the eq, track 6)
//          AND on a group (the saett, group 1), so the largest path latency is eq + saett in series. Layout deviation from arr32ins (the pools are 1 eq + 1 saett and 12 komp, so the 64
//          mappings and the group latency need the stages regrouped): the saett sits on group 1 (not track 7), track 26 and group 2 have no chain, group 1 holds the komp 8 and 9 and the saett,
//          track 25 holds the komp 6 and 7. The 14 stages are the same 14 as in arr32ins. The eq is the only latency stage on a track; a latency stage on a return does not exist in the pool.
//          Self-check (exit 2): 14 stages in the chains, 14 computing, 4 racks, 64 mappings in the snapshot, 64 parameters driven by a macro in the last block with the value
//          von + m * (bis - von), the largest path latency equal to the eq latency plus the saett latency (non-zero), plus all checks of arr32ins. Error-case switches (the self-check must
//          turn red): KOSTEN_VOLL_OHNE_EQ=1 (the file without the eq stage and its rack), KOSTEN_VOLL_OHNE_RACKS=1 (no rack in the file, no macro rows), KOSTEN_VOLL_MAKRO_AUS=1 (the file
//          has the racks, but the macro rows are not set: the mapped parameters stay at `von`).
//          KOSTEN_VOLL_SCHLUESSEL=1 (slice 5 U2b, the key lane): ten stages get a structural key (deck 1 x2 and 2, erz 1 x2, track post x2, group post, group pre, return pre) on top of the two row keys of the file; the
//          delay compensation of the file makes the rings run. Self-check (exit 2): 10 keys in the snapshot, exactly 3 with a key ring (group 1 stages 8 and 9: a DJ key arrives at 0, the group strip starts at the track
//          alignment of 69 samples; return 2 keyed by group 2 pre: arrives at 69, the return input at 138) and 2 late (the two track post keys, arriving at 69 in front of a stage input at 0), the same counts in the running core
//          (last block, ArrInserts::strukturell / schluessel_verzug). Without the variable the lane is unchanged.
//   arr32au  Paket 1.13 Slice 2 (AK31): Grundlinie für arr32warp: 32 Audio-Spuren (4 Spuren je Quelle, 8 Töne), Loop-Klammer 16 Beats, ungewarpt, dazu die Keylock-Last
//   KOSTEN_WARP_PITCH=<Faktor>: arr32warp mit transponierten Clips (Slice 5); ohne: pitch 1
//   arr32warp wie arr32au, aber jede Spur ein COMPLEX-Clip auf 125-BPM-Quellen im 128er Kern, das Warp-Werk mit 4 Arbeitsfäden hängt am Kern. Keylock-Last (beide Lagen):
//          sechs Bungee-Dehner (4 Decks + 2 Boxen nachgebildet) rechnen im selben Faden nach jedem Zyklus und werden aus ihren Ringen gelesen, so teilen sie sich Kerne,
//          Caches und Speicherbandbreite mit dem Kern und dem Werk (die echten Decks und Boxen sind Sache der Zielabnahme). Gemeldet: Kern-Zyklus, Last und Summe
//          getrennt (p50/p99/p99,9/max), der Zuwachs der Summe gegen arr32au (Grenze 150 µs bei p99,9), Unterlauf, spät, kein Platz, CPU je Werk-Faden. Die Selbstprüfung
//          endet mit 2, wenn nicht 32 Stimmen im Werk klingen, die Last nicht läuft, der Zuwachs bei mindestens 20 000 Zyklen über 150 µs liegt (das Tor von AK31; darunter
//          ist p99,9 zu grob und der Zuwachs nur gemeldet; KOSTEN_TOR_ZYKLEN und KOSTEN_GRENZE_US stellen es für den Kontrolllauf um) oder KOSTEN_PRIO unter 7 liegt (dann liefen
//          die Fäden des Werks nicht unter dem Hauptfaden) oder in einem Tor-Lauf (mindestens 20 000 Zyklen) die Priorität nicht wirkt (KOSTEN_PRIO fehlt, SCHED_FIFO nicht gesetzt oder ein
//          Werk-Faden ohne Priorität: die Zahlen stammen dann aus SCHED_OTHER). KOSTEN_WARP_HALT=1: Kontrolllauf, das Werk steht nach 2 000 Zyklen; Unterlauf MUSS dann zählen (sonst misst die Lage nichts).
//   arr32fest, arr32lane, arr32lanet  Automation Slice 1 (task 8): the arr32 tracks WITHOUT the 32 stellwerk ramps. fest: fader fixed (baseline); lane: one
//          fader lane per track (triangle: 0 dB, 3..6 dB down at beat 16, 0 dB at beat 32, so every block lies in a ramp); lanet: lane plus a tempo map of
//          31 one-beat ramps (up to 63 segments). Self-check: all 32 tracks sound, the base value of every fader is still 0 dB, the level is under 0 dB,
//          lane: 32 lanes in the snapshot (otherwise exit 2).
//   arr32pan, arr32cut, arr32rb  Automation Slice 2, cost decomposition: pan = arr32fest plus a pan lane on all 32 tracks only (32 lanes); cut = arr32fest plus a
//          geraet.cutoff lane on the tracks 1..8 only (8 lanes); rb = the arr32fest file again under another number (no lanes). NOTE: arr32fest already has 24 internal
//          RB-338 tracks (1..24) and 8 audio tracks (25..32), so the tracks 1..8 of arr32auto are RB in the baseline too; arr32rb is therefore identical to arr32fest
//          and serves as the noise floor of a paired difference.
//   arr32ueber  Automation Slice 3 (task 6): arr32auto (same playback file, 72 lanes) with 8 lanes overridden through the core command ARR_AUTO (an 0, source andreas) after the
//          warm-up: the fader lanes of the tracks 1..4 and the pan lanes of the tracks 5..8. Self-check: the Arrangement reports exactly these 8 (of 4 x 32 fields) as
//          overridden (otherwise exit 2); arr32auto reports 0 (negative control, same check). The cost of overridden lanes against arr32auto; reported, gate 10 us on the median cycle.
//   arr32arm, arr32armgriff  1.12 S3 wave B: the arr32auto file (72 lanes) with all 32 tracks armed (ARR_ARM, mode latch) after the warm-up, so auto_punkte_melden loops over
//          the armed tracks every sub-block. arr32arm is idle (no grip: no point may be emitted); arr32armgriff adds one human grip (HAND on spur/1..4/fader) every 16 cycles so
//          points are really emitted. Self-check (exit 2 / fail): 32 armed before and after, AUTO_PUNKT events 0 (arm) / > 0 (armgriff). Reported, no gate.
//   arr32hk, arr32hk32, arr32fest32  1.12 slice 5 U8b (T8.6, AK22): clip gain envelopes. hk = the arr32fest layout plus a gain envelope (a linear ramp per 2 beats, 12 dB <-> 3 dB
//          down, 17 points) on each of the 8 audio clips (tracks 25..32); hk32 = 32 audio tracks (distinct files, a different pitch each) with the same envelope on every clip;
//          fest32 = the same 32 audio tracks WITHOUT the envelope (the baseline that isolates the cost of the envelope from the cost of 24 more audio tracks). hk is gated
//          per round against arr32fest; hk32 is reported against arr32fest (the literal AK22 figure) and against fest32. Self-check: the voices that carry an envelope are
//          counted (8 / 32 / 0 / 0 / 0 for hk, hk32, fest, fest32) and the held factor of each must have left 1.0 (otherwise exit 2).
//   arr32mod  1.12 slice 5 U9 (T9.4, AK22): arr32auto (72 lanes) plus a RELATIVE fader lane on all 32 tracks (the value stack: absolute lane + summand, clamped; 104 lanes; the
//          summand moves -10 .. -14 dB over 32 beats). Gated per round against arr32auto, the layout without the summands (p99.9 difference, AK22 as above); the median cycle
//          difference is reported next to it. Self-check (exit 2 / fail): 32 relative lanes in the snapshot (arr32auto: 0), and the last played fader value of all 32 tracks is
//          below -9.9 dB (the absolute lanes alone never go below -6.03 dB), so the stack really ran.
//   arr32steil  Automation Slice 2, worst case of the step hold: the arr32fest tracks with a fader lane and a pan lane on all 32 tracks, each a zigzag of 20 dB (pan: 1.6 units)
//          per 0.05 beat (641 points per lane, 64 lanes). The held value leaves its tolerance every 2 samples, so no hold window runs out; reported, no gate.
//          KOSTEN_OHNE_VORAUSSCHAU=1 switches the look-ahead of auto_block off (control run, same bits).
//   arr32auto, arr32solo  Automation Slice 2 (task 8, AK22): the arr32fest tracks (no stellwerk ramps) with 32 fader lanes (triangle as in arr32lane), 32 pan
//          lanes (a triangle around a per-track centre) and, on the tracks 1 to 8 (internal RB-338), a geraet.cutoff lane (0.2, 0.8, 0.2): 72 lanes, quantum 256.
//          arr32solo adds a solo lane (jump points, 1 for a sixteenth) on the tracks 1, 2, 4 and 5: 76 lanes; a solo lane keeps the per-sample solo loops on in
//          every block (reported, no gate). Baseline of the gate is arr32fest (decision E11), not arr32. Self-check: 72 (76) lanes in the snapshot, all
//          tracks sound, base values untouched (otherwise exit 2).
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs, dazu eine JSON-Zeile {"lage":…} für die Ablage. Kein Test: die
// Zahlen gehören in den Bericht (Grenze A10, Teil ohne JACK: arr3 p99,9 höchstens ohne p99,9 + 200 µs).
// Aufruf: kern_kosten_arr [zyklen [lagen]]   lagen: Komma-Liste, Vorgabe alle (ohne,arr3,arr3rb,hand); eine unbekannte
// Lage beendet das Programm mit 3 (sonst misst ein Tippfehler nichts und meldet Erfolg)
// Lage arr32 prüft sich selbst und endet mit 2, wenn: nach 100 Zyklen weniger als 32 Spuren klingen (Spitze je Spur
// > −120 dBFS), ein Teil abgelehnt wurde (Quittung 6), einer der 32 Fader am Ende keinen Verlauf hat (Wert 0 dB) oder die
// beobachteten Solo-Schaltungen von Spur 3 unter der erwarteten Zahl liegen (114, bei KOSTEN_ARR32_SOLO_EIN genau 1). KOSTEN_ARR32_STUMM=<nr>: Kontrolllauf, Spur <nr> wird stumm geschaltet, die
// Selbstprüfung muss anschlagen.
// Lage hand prüft sich selbst: sieht sie kein Halter-Ereignis „mensch“, endet das Programm mit 2 (sonst misst sie nichts).
// KOSTEN_HAND_RUECK=1: Kontrolllauf der Lage hand ohne neue Griffe, die Rückgabe nach 32 Beats muss als Halter „frei“
// kommen (zeigt, dass die Rückgabe-Schleife eine Rückgabe findet).
// KOSTEN_HASH=1: prints "HASH lane=<name> pm=<16 hex> out=<16 hex> blocks=<n>", FNV-1a over the production master and the master out of the warm-up and measured cycles (ctest: kosten_arr_hash).
// KOSTEN_SCHLAF=0: setze_schlaf(false) on the lane's mixer before the warm-up (the reference arm: silent strips are computed instead of skipped; the output is bit-equal either way). Any other value or unset:
// the default (sleep on). The lines of arr32r and of the ins lanes report schlaf_bloecke=<n>, the strip-blocks the mixer skipped.
// KOSTEN_ARR_PRIO=<n>: the lane thread runs SCHED_FIFO n (refused: exit 4). KOSTEN_PACE_US=<us>: sleep to the next period of that length after each cycle (needed with FIFO, else the RT
// throttle hits; an invalid value exits 4). Unlike KOSTEN_PRIO, which only the warp lanes read.
// KOSTEN_HALL_FAEDEN=<0..3> (mehrkern task 4): the Halls of the return strips compute on a HallPool of that many workers (0 or unset: no pool, the serial path of before). Return 0 stays
// with the lane thread, returns 1..3 go to worker r-1. Output bit-equal (ctest kosten_arr_hash_pool). KOSTEN_HALL_CPUS=<a,b,c>: pin worker i to cpu i. With KOSTEN_ARR_PRIO=<p> the workers run
// SCHED_FIFO p-1 (HallPool::prioritaet). KOSTEN_HALL_FRIST_US=<us>: the deadline of the pool (frist_us; default 25 % of a block). Under SCHED_OTHER the wake jitter makes the pool switch
// itself off after a few late events (by design, the target is SCHED_FIFO); a long deadline (ctest kosten_arr_hash_pool uses 1000000) keeps it on. The HASH line carries pool_jobs (Hall blocks computed on a worker): ctest demands > 0, so the hash is proven ON the workers; KOSTEN_HALL_POOL_UNBENUTZT=1 builds the pool without attaching it (pool_jobs=0, control). Per lane with returns, one line at the start (pool on/off, workers) and the Hall line at the end carries `spaet` and `zurueck` of the pool.
#include <sched.h>
#include <time.h>
#include <unistd.h>

#include <cerrno>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/dehner.h"
#include "cypherdj/hall_pool.h"
#include "cypherdj/kern.h"
#include "cypherdj/warp_werk.h"

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: voices that play a clip with a gain envelope, and of those the ones whose held factor has left 1.0 (the envelope really runs)
  static int hk_stimmen(const Arrangement& a) { int n = 0; for (const Arrangement::Stimme& v : a.st_) n += v.aktiv && v.clip && v.hk.punkte() > 0; return n; }
  static int hk_laufen(const Arrangement& a) { int n = 0; for (const Arrangement::Stimme& v : a.st_) n += v.aktiv && v.clip && v.hk.punkte() > 0 && v.hk_lin != 1.0f; return n; }
};
struct KernPruefZugang {   // friend of Kern (tests only, declared in kern.h): the mixer, non-const (Kern::mixer() is const)
  static Mixer& mixer(Kern& k) { return *k.mixer_; }
};
}  // namespace cdj

namespace {
constexpr double KLANG_ANTEIL_MIN = 0.9;   // arr32: kleinster Anteil klingender Pegel-Meldungen je Spur
}

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

// Senke ohne Ton: zählt nur (die RB-FFI und die Wirt-Slots hängt K2 an)
struct Kostensenke : cdj::ArrSenke {
  int64_t v;
  uint64_t n = 0;
  explicit Kostensenke(int64_t vorhalt) : v(vorhalt) {}
  int64_t vorhalt() const noexcept override { return v; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override { ++n; }
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
};

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::Kern> kern{new cdj::Kern(128.0, ring, bef.get(), ere.get())};
  int64_t id = 1;
  cdj::Befehl neu(int art) {
    cdj::Befehl b{};
    b.art = art;
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "andreas");
    return b;
  }
  void zyklus() {
    kern->zyklus(256, jetzt_ns());
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
};

static void bericht(const char* name, std::vector<double>& us) {
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, (size_t)(p * us.size()))]; };
  std::printf("%-5s Zyklen %zu: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", name, us.size(), q(0.5),
              q(0.99), q(0.999), us.back());
  std::printf("{\"lage\":\"%s\",\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f}\n", name,
              us.size(), q(0.5), q(0.99), q(0.999), us.back());
}


// ---- 1.13 Slice 2 (AK31): arr32au und arr32warp --------------------------------------------------------------------------
namespace {

constexpr int64_t WARP_FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle

// Das Band einer nachgebildeten Keylock-Quelle: ein Ton, Basis 128
struct LastQuelle : cdj::DehnerQuelle {
  float hz;
  explicit LastQuelle(float h) : hz(h) {}
  void band(int64_t ab, int n, float* l, float* r) const noexcept override {
    for (int i = 0; i < n; ++i) l[i] = r[i] = 0.2f * std::sin(6.2831853f * hz * static_cast<float>((ab + i) % 480000) / 48000.0f);
  }
  double basis_bpm() const noexcept override { return 128.0; }
};

struct Last {   // sechs Bungee-Dehner wie 4 Decks und 2 Boxen
  std::vector<std::unique_ptr<cdj::DehnerBasis>> d;
  std::vector<LastQuelle> q;
  std::vector<float> l, r;
  int64_t s = 0;
  Last() : l(256), r(256) {
    for (int i = 0; i < 6; ++i) q.emplace_back(180.0f + 40.0f * static_cast<float>(i));
  }
  bool baue(const cdj::Karte& k, int64_t s_h) {
    cdj::DehnerOptionen o;
    o.maschine = cdj::DehnerMaschine::Bungee;
    o.bungee_fein = false;
    for (int i = 0; i < 6; ++i) {
      d.push_back(cdj::dehner_neu(i + 1, o));
      if (!d.back()) return false;
    }
    s = s_h;
    for (int i = 0; i < 6; ++i) {
      cdj::AnsatzAuftrag a;
      a.quelle = &q[static_cast<size_t>(i)];
      a.s_h = s_h;
      a.anker = {k.beat_at(static_cast<double>(s_h)), 0.0};
      a.karte = k;
      a.generation = 1;
      d[static_cast<size_t>(i)]->ansetzen(a);
      cdj::KartenStand ks;
      ks.karte = k;
      ks.anker = a.anker;
      ks.generation = 1;
      d[static_cast<size_t>(i)]->karte_veroeffentlichen(ks);
      d[static_cast<size_t>(i)]->ring().setze_epoche(d[static_cast<size_t>(i)]->epoche());
    }
    return true;
  }
  // ein Zyklus: füllen und 256 Frames aus jedem Ring nehmen (wie der Callback einer Quelle); false: ein Ring war leer
  bool zyklus() {
    bool ok = true;
    for (auto& x : d) {
      x->fuelle_synchron();
      if (s >= 0 && x->ring().lies_bis(s, 256, l.data(), r.data()) != 256) ok = false;
    }
    s += 256;
    return ok;
  }
};

void bericht_zeile(const char* lage, const char* was, std::vector<double>& us) {
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, static_cast<size_t>(p * static_cast<double>(us.size())))]; };
  std::printf("%-9s %-6s Zyklen %zu: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", lage, was, us.size(), q(0.5), q(0.99), q(0.999), us.back());
  std::printf("{\"lage\":\"%s\",\"was\":\"%s\",\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f}\n", lage, was, us.size(), q(0.5), q(0.99),
              q(0.999), us.back());
}

double p999(std::vector<double> us) {
  std::sort(us.begin(), us.end());
  return us[std::min(us.size() - 1, static_cast<size_t>(0.999 * static_cast<double>(us.size())))];
}

// Rückgabe: 0 gut, 2 Selbstprüfung gescheitert; summe_p999 und cpu_je_faden werden gefüllt. tor: der Lauf ist ein Tor von AK31 (genug Zyklen); dann muss die Priorität wirken
int warp_lage(const char* lage, int n, bool tor, const std::string& ordner, cdj::SpeicherKonto& konto, cdj::ArrAudioCache& cache, double& summe_p999) {
  const bool warp = std::string(lage) == "arr32warp";
  const bool halt = std::getenv("KOSTEN_WARP_HALT") != nullptr;
  const char* pe = std::getenv("KOSTEN_WARP_PITCH");
  const std::string pitchfeld = (warp && pe) ? std::string(",\"pitch\":") + pe : std::string();
  const int nr = warp ? 4 : 5;
  {  // Wiedergabe /2: 32 Audio-Spuren, 4 Spuren je Quelle, ein Clip über die Klammer (16 Beats)
    std::string j = "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[";
    for (int sp = 1; sp <= 32; ++sp) {
      const std::string sha = std::string(63, 'e') + "0123456789abcdef"[(sp - 1) % 8];
      char c[700];
      std::snprintf(c, sizeof c,
                    "%s{\"nr\":%d,\"art\":\"audio\",\"clips\":[{\"id\":\"w%d\",\"start_beat\":0.0,\"laenge_beats\":16.0,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                    "\"frames\":%lld,\"offset_frames\":0,\"gain_db\":-12.0,\"ein_beats\":0.0,\"aus_beats\":0.0%s}]}",
                    sp > 1 ? "," : "", sp, sp, sha.c_str(), ordner.c_str(), sha.c_str(), static_cast<long long>(17 * WARP_FPB125),
                    warp ? (std::string(",\"warp\":{\"modus\":2") + pitchfeld + ",\"w\":[[0,0],[16," + std::to_string(16 * WARP_FPB125) + "]]}").c_str() : "");
      j += c;
    }
    j += "]}";
    std::ofstream(ordner + "/wiedergabe-" + std::to_string(nr) + ".json") << j;
  }
  Lauf l;
  std::unique_ptr<cdj::WarpWerk> werk;
  if (warp) {
    werk = cdj::warp_werk_neu({4});
    if (!werk) {
      std::fprintf(stderr, "kosten_arr: %s: kein Warp-Werk (ohne Bungee gebaut)\n", lage);
      return 2;
    }
    l.kern->setze_arr_warp_werk(werk.get());
  }
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, nr, cache);
  if (!e.snap) {
    std::fprintf(stderr, "kosten_arr: %s: %s\n", lage, e.meldung.c_str());
    return 2;
  }
  cdj::Befehl f = l.neu(cdj::Befehl::TEIL);   // erz/4 offen wie im Betrieb
  std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader");
  f.politik = 1;
  l.bef->schiebe(f);
  cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN);
  b.zeiger = e.snap.release();
  b.arr_nr = nr;
  l.bef->schiebe(b);
  cdj::Befehl lp = l.neu(cdj::Befehl::ARR_LOOP);
  lp.an = 1;
  lp.arr_von = 0.0;
  lp.arr_bis = 16.0;
  l.bef->schiebe(lp);
  cdj::Befehl st = l.neu(cdj::Befehl::ARR_START);
  l.bef->schiebe(st);
  // KOSTEN_PRIO=P: der Hauptfaden (Kern und Last) läuft mit SCHED_FIFO P, die Fäden des Werks mit P − 6 (wie im Betrieb: JACK-Priorität und JACK − 6); ohne die Variable
  // SCHED_OTHER. Auf einer Maschine mit Fremdlast (loadavg) streuen die Zahlen ohne Priorität um ein Vielfaches (gemessen im Plan, Task 9). Mit P unter 7 hebt das Werk
  // seine Fäden auf 1 an (max(1, P − 6)): sie liefen dann auf der Priorität des Hauptfadens und nicht darunter, die Lage misst nicht die Ordnung des Betriebs (rc 2).
  // Ein Tor (tor) braucht die Ordnung des Betriebs: ohne KOSTEN_PRIO, bei einem gescheiterten sched_setscheduler oder wenn ein Faden des Werks seine Priorität nicht bekam,
  // läuft die Lage unter SCHED_OTHER oder mit Fäden auf der Priorität des Hauptfadens, und ein bestandenes Tor wäre eine Messung aus einer anderen Lage (rc 2). Unter dem Tor
  // (wenige Zyklen) bleibt es bei einem Hinweis: dort misst ohnehin niemand eine Grenze.
  bool prio_falsch = false, prio_wirkt = false;
  if (const char* pr = std::getenv("KOSTEN_PRIO")) {
    sched_param sp{};
    sp.sched_priority = std::atoi(pr);
    const bool gesetzt = sched_setscheduler(0, SCHED_FIFO, &sp) == 0 && sched_getscheduler(0) == SCHED_FIFO;
    if (!gesetzt) std::fprintf(stderr, "kosten_arr: SCHED_FIFO %d nicht gesetzt: %s\n", sp.sched_priority, std::strerror(errno));
    const int fehl = werk ? werk->prioritaet(sp.sched_priority) : 0;
    prio_wirkt = gesetzt && fehl == 0;
    if (werk && sp.sched_priority < 7) {
      std::fprintf(stderr, "kosten_arr: %s: KOSTEN_PRIO %d unter 7: die Fäden des Werks laufen nicht unter dem Hauptfaden, die Lage misst nicht die Ordnung des Betriebs\n", lage,
                   sp.sched_priority);
      prio_falsch = true;
    }
  }
  if (!prio_wirkt) {
    std::fprintf(stderr, "kosten_arr: %s: keine Echtzeit-Priorität (KOSTEN_PRIO fehlt, SCHED_FIFO nicht gesetzt oder ein Werk-Faden ohne Priorität): die Zahlen stammen aus SCHED_OTHER%s\n", lage,
                 tor ? ", das Tor von AK31 gilt so nicht (rc 2)" : "");
    if (tor) prio_falsch = true;
  }
  Last last;
  int rc = prio_falsch ? 2 : 0;
  for (int i = 0; i < 6; ++i) l.zyklus();   // Laden, Einsatz (mit Werk 2 048 Samples später) und erste Stimmen
  if (!last.baue(l.kern->karte(), l.kern->sample() + 8192)) {
    std::fprintf(stderr, "kosten_arr: %s: keine Bungee-Dehner für die Last (ohne Bungee gebaut)\n", lage);
    return 2;
  }
  std::vector<double> us_kern, us_last, us_summe;
  us_kern.reserve(static_cast<size_t>(n));
  us_last.reserve(static_cast<size_t>(n));
  us_summe.reserve(static_cast<size_t>(n));
  uint64_t last_leer = 0;
  // Echtzeit-Takt: die Fäden des Werks rechnen in Wanduhrzeit, also läuft auch dieser Zyklus im Takt von 256 Samples (5,333 ms), nicht so schnell wie möglich;
  // sonst bekäme das Werk ein Sechstel der Zeit und meldete Ausfälle, die es im Betrieb nicht gibt (gemessen: 4 000 Zyklen ungetaktet, 16 Unterläufe)
  timespec naechster;
  clock_gettime(CLOCK_MONOTONIC, &naechster);
  for (int i = 0; i < 2000 + n; ++i) {
    naechster.tv_nsec += 5'333'333;
    if (naechster.tv_nsec >= 1'000'000'000) {
      naechster.tv_nsec -= 1'000'000'000;
      ++naechster.tv_sec;
    }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &naechster, nullptr);
    if (halt && i == 2000 && werk) werk->test_halte(true);
    const int64_t t0 = jetzt_ns();
    l.kern->zyklus(256, t0);
    const int64_t t1 = jetzt_ns();
    const bool ok = last.zyklus();
    const int64_t t2 = jetzt_ns();
    cdj::Ereignis ev;
    while (l.ere->hole(ev)) {
      if (ev.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(ev.zeiger)), cache);
    }
    if (i < 2000) continue;   // Einschwingen
    last_leer += ok ? 0 : 1;
    us_kern.push_back(static_cast<double>(t1 - t0) / 1000.0);
    us_last.push_back(static_cast<double>(t2 - t1) / 1000.0);
    us_summe.push_back(static_cast<double>(t2 - t0) / 1000.0);
  }
  const cdj::Arrangement& a = l.kern->arrangement();
  std::printf("%s: Stimmen im Werk %d, Unterlauf %llu, spät %llu, kein Platz %llu, Last-Ringe leer in %llu Zyklen\n", lage, a.werk_stimmen(),
              static_cast<unsigned long long>(a.warp_unterlauf()), static_cast<unsigned long long>(a.warp_spaet()), static_cast<unsigned long long>(a.warp_kein_platz()),
              static_cast<unsigned long long>(last_leer));
  bericht_zeile(lage, "kern", us_kern);
  bericht_zeile(lage, "last", us_last);
  summe_p999 = p999(us_summe);
  bericht_zeile(lage, "summe", us_summe);
  if (werk) {
    werk->stoppe();
    std::printf("%s\n", werk->schluss_json().c_str());
  }
  if (warp && !halt && a.werk_stimmen() != 32) {
    std::fprintf(stderr, "kosten_arr: %s: %d statt 32 Stimmen im Werk, die Lage misst nicht, was sie soll\n", lage, a.werk_stimmen());
    rc = 2;
  }
  if (last_leer > static_cast<uint64_t>(n) / 100) {
    std::fprintf(stderr, "kosten_arr: %s: die nachgebildeten Decks und Boxen blieben in %llu Zyklen ohne Ring-Inhalt, die Last ist keine\n", lage, static_cast<unsigned long long>(last_leer));
    rc = 2;
  }
  if (warp && halt && a.warp_unterlauf() == 0) {
    std::fprintf(stderr, "kosten_arr: %s: Kontrolllauf KOSTEN_WARP_HALT ohne Unterlauf, das Instrument sieht den Ausfall nicht\n", lage);
    rc = 2;
  }
  if (warp && !halt && (a.warp_unterlauf() != 0 || a.warp_kein_platz() != 0))
    std::fprintf(stderr, "kosten_arr: %s: Unterlauf %llu, kein Platz %llu (Ziel: 0)\n", lage, static_cast<unsigned long long>(a.warp_unterlauf()),
                 static_cast<unsigned long long>(a.warp_kein_platz()));
  return rc;
}

// ---- arr32voll (1.10 slices 5 to 8, U0): the eq_mix bands (shared with arr32ins) and the racks of the full-load lane
struct EqBand { int typ; float freq, gain, q; int steil, platz; };
constexpr EqBand EQ_MIX_BAENDER[8] = {{3, 40, 0, 0.7f, 1, 0}, {4, 18000, 0, 0.7f, 1, 0}, {1, 120, 3, 0.7f, 0, 0}, {2, 9000, 2, 0.7f, 0, 0},
                                       {0, 250, -3, 1.4f, 0, 0}, {0, 1000, 4, 1.0f, 0, 1}, {0, 3500, -2.5f, 2.0f, 0, 0}, {0, 7000, 3, 1.0f, 0, 0}};
constexpr float VOLL_MAKRO[4] = {0.25f, 0.5f, 0.75f, 1.0f};   // the macro rows rack/<k>/m1..m4 of every rack
struct VollZiel { int makro, stufe, param; float von, bis; };
struct VollRack { int streifen, slot; std::vector<VollZiel> z; };   // streifen: chain index (tracks 0.., groups 32..), slot: 1-based rack pool slot
// the four racks: 16 mappings each. A komp stage maps its parameters 1..8 (schwelle .. schp; 0 = an and 9 = sc cannot be mapped); the macro of parameter p is (p - 1) % 4.
std::vector<VollRack> voll_racks(bool mit_eq) {
  static const float KOMP_VB[8][2] = {{-40, -20}, {2, 8}, {0, 12}, {1, 30}, {60, 300}, {0, 6}, {0.7f, 1.0f}, {0, 120}};
  const auto zwei_komp = [](int streifen, int slot) {
    VollRack r{streifen, slot, {}};
    for (int st = 0; st < 2; ++st)
      for (int p = 1; p <= 8; ++p) r.z.push_back({(p - 1) % 4, st, p, KOMP_VB[p - 1][0], KOMP_VB[p - 1][1]});
    return r;
  };
  std::vector<VollRack> rs;
  rs.push_back(zwei_komp(4, 1));    // track 5: komp 4 and 5
  if (mit_eq) {
    VollRack e{5, 2, {}};           // track 6: the eq. Parameter index of band m (1..8): 3 + (m - 1) * 7 + (an 0, typ 1, freq 2, gain 3, q 4, steil 5, platz 6)
    e.z.push_back({0, 0, 1, -1.0f, 1.0f});   // out
    e.z.push_back({1, 0, 3 + 0 * 7 + 4, 0.5f, 1.5f});   // q of band 1 (propq is a switch in the project, the project refuses a macro on it)
    for (int m = 1; m <= 8; ++m) e.z.push_back({m % 4, 0, 3 + (m - 1) * 7 + 3, EQ_MIX_BAENDER[m - 1].gain - 2.0f, EQ_MIX_BAENDER[m - 1].gain + 2.0f});
    for (int m = 3; m <= 8; ++m) e.z.push_back({(m + 1) % 4, 0, 3 + (m - 1) * 7 + 2, EQ_MIX_BAENDER[m - 1].freq * 0.8f, EQ_MIX_BAENDER[m - 1].freq * 1.25f});
    rs.push_back(e);
  }
  rs.push_back(zwei_komp(24, 3));   // track 25: komp 6 and 7
  rs.push_back(zwei_komp(32, 4));   // group 1: komp 8 and 9 (then the saett)
  return rs;
}

}  // namespace

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  const std::string lagen = argc > 2 ? std::string(",") + argv[2] + "," : "";
  for (size_t a = 0; !lagen.empty() && a + 1 < lagen.size();) {   // jede genannte Lage muss es geben
    const size_t b = lagen.find(',', a + 1);
    const std::string eine = lagen.substr(a + 1, b - a - 1);
    if (!eine.empty() && eine != "ohne" && eine != "arr3" && eine != "arr3rb" && eine != "hand" && eine != "arr32" && eine != "arr32g" && eine != "arr32au" && eine != "arr32warp" &&
        eine != "arr32fest" && eine != "arr32lane" && eine != "arr32lanet" && eine != "arr32auto" && eine != "arr32ueber" && eine != "arr32arm" && eine != "arr32armgriff" && eine != "arr32solo" && eine != "arr32pan" && eine != "arr32cut" && eine != "arr32rb" && eine != "arr32steil" && eine != "arr32hk" && eine != "arr32hk32" && eine != "arr32fest32" && eine != "arr32mod" &&
        eine != "arr32r" && eine != "arr32r_setze" && eine != "arr32r_oeffnen" && eine != "arr32ins" && eine != "arr32ins_aus" && eine != "arr32ins_k" && eine != "arr32ins_ke" && eine != "arr32ins_ks" && eine != "arr32ins_ol" && eine != "arr32voll" && eine != "arr32kit" && eine != "arr32rack") {
      std::fprintf(stderr, "kosten_arr: unbekannte Lage \"%s\"\n", eine.c_str());
      return 3;
    }
    a = b;
  }
  // KOSTEN_ARR_PRIO=<n>: the lane thread (this one, which runs the cycles) gets SCHED_FIFO n. Refused: say so and exit 4 (a FIFO measurement that silently ran as
  // SCHED_OTHER would be a measurement of another condition). Not the same as KOSTEN_PRIO, which only the warp lanes read. Use it with KOSTEN_PACE_US, an unpaced FIFO loop
  // is CPU-bound and runs into the RT throttle.
  if (const char* ap = std::getenv("KOSTEN_ARR_PRIO")) {
    sched_param sp{};
    sp.sched_priority = std::atoi(ap);
    if (sched_setscheduler(0, SCHED_FIFO, &sp) != 0 || sched_getscheduler(0) != SCHED_FIFO) {
      std::fprintf(stderr, "kosten_arr: KOSTEN_ARR_PRIO %d: SCHED_FIFO refused: %s\n", sp.sched_priority, std::strerror(errno));
      return 4;
    }
    std::fprintf(stderr, "kosten_arr: lane thread SCHED_FIFO %d\n", sp.sched_priority);
  }
  // KOSTEN_PACE_US=<us>: after each cycle (outside the timed part) sleep until the next multiple of this period, counted from the start of the loop (a cycle that overran
  // skips to the next slot). 5333 is one block of 256 frames at 48 kHz.
  int64_t pace_ns = 0;
  if (const char* pu = std::getenv("KOSTEN_PACE_US")) {
    char* ende = nullptr;
    const long long us_pace = std::strtoll(pu, &ende, 10);
    if (ende == pu || *ende != '\0' || us_pace <= 0) {
      std::fprintf(stderr, "kosten_arr: KOSTEN_PACE_US \"%s\" is not a positive number of microseconds\n", pu);
      return 4;
    }
    pace_ns = us_pace * 1000;
  }
  int64_t pace_start = 0, pace_nr = 0;
  const auto pace = [&]() {
    if (pace_ns <= 0) return;
    const int64_t jetzt = jetzt_ns();
    if (pace_nr == 0) pace_start = jetzt;
    pace_nr = std::max(pace_nr + 1, (jetzt - pace_start) / pace_ns + 1);
    const int64_t ziel = pace_start + pace_nr * pace_ns;
    timespec ts;
    ts.tv_sec = ziel / 1000000000LL;
    ts.tv_nsec = ziel % 1000000000LL;
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, nullptr);
  };
  // KOSTEN_HASH=1: FNV-1a over the 32-bit words of the production master (pm_abgriff, left block then right block per cycle) and of the master out (audio ring, left then
  // right), over the 2000 warm-up cycles and the n measured ones (the probe's method: 2000 + 3000 = 5000 blocks for n = 3000), not over the setup cycles. Printed as "HASH lane=<name> pm=... out=... blocks=...".
  // Per cycle it hashes the left block, then the right block; that equals the probe (one mixer block per cycle) only while a cycle is a single mischen sub-block, which holds for arr32ins (256 <= MIX_BLOCK).
  // Computed after the timed part of each cycle, so the cost figures stay those of a run without it.
  const bool hash_an = std::getenv("KOSTEN_HASH") && std::string(std::getenv("KOSTEN_HASH")) == "1";
  const bool nur_rueck = std::getenv("KOSTEN_HAND_RUECK") != nullptr;
  const std::string ordner = "/dev/shm/kern_kosten_arr_" + std::to_string(getpid());
  std::filesystem::create_directories(ordner + "/audio");
  const std::string sha(64, 'c');
  const bool will32 = lagen.empty() || lagen.find(",arr32,") != std::string::npos || lagen.find(",arr32g,") != std::string::npos ||
                      lagen.find(",arr32fest,") != std::string::npos || lagen.find(",arr32lane,") != std::string::npos ||
                      lagen.find(",arr32lanet,") != std::string::npos || lagen.find(",arr32auto,") != std::string::npos || lagen.find(",arr32ueber,") != std::string::npos || lagen.find(",arr32arm,") != std::string::npos || lagen.find(",arr32armgriff,") != std::string::npos ||
                      lagen.find(",arr32solo,") != std::string::npos || lagen.find(",arr32pan,") != std::string::npos ||
                      lagen.find(",arr32cut,") != std::string::npos || lagen.find(",arr32rb,") != std::string::npos || lagen.find(",arr32steil,") != std::string::npos ||
                      lagen.find(",arr32hk,") != std::string::npos || lagen.find(",arr32hk32,") != std::string::npos || lagen.find(",arr32fest32,") != std::string::npos || lagen.find(",arr32mod,") != std::string::npos ||
                      lagen.find(",arr32r,") != std::string::npos || lagen.find(",arr32r_setze,") != std::string::npos ||
                      lagen.find(",arr32r_oeffnen,") != std::string::npos || lagen.find(",arr32ins,") != std::string::npos || lagen.find(",arr32ins_aus,") != std::string::npos ||
                      lagen.find(",arr32ins_k,") != std::string::npos || lagen.find(",arr32ins_ke,") != std::string::npos || lagen.find(",arr32ins_ks,") != std::string::npos || lagen.find(",arr32ins_ol,") != std::string::npos ||
                      lagen.find(",arr32voll,") != std::string::npos ||
                      lagen.find(",arr32kit,") != std::string::npos || lagen.find(",arr32rack,") != std::string::npos;
  struct Aufraeumen {   // Ende 1, 2 oder 3 und Normalende räumen gleich auf (arr32 legt 8 x 5,8 MB in /dev/shm ab)
    std::string d;
    ~Aufraeumen() { std::error_code ec; std::filesystem::remove_all(d, ec); }
  } aufraeumen{ordner};
  {
    std::vector<float> kick(2 * 4800, 0.0f);
    for (int i = 0; i < 4800; ++i) kick[2 * i] = kick[2 * i + 1] = 0.5f * (1.0f - i / 4800.0f);
    std::ofstream(ordner + "/audio/" + sha + ".f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(kick.data()), (std::streamsize)(kick.size() * sizeof(float)));
  }
  std::string clips, noten;
  for (int b = 0; b < 32; ++b) {
    char c[400];
    std::snprintf(c, sizeof c,
                  "%s{\"id\":\"k%d\",\"start_beat\":%d.0,\"laenge_beats\":0.2,\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\","
                  "\"frames\":4800,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}",
                  b ? "," : "", b, b, sha.c_str(), ordner.c_str(), sha.c_str());
    clips += c;
  }
  for (int i = 0; i < 128; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) +
             ",\"laenge\":0.2,\"ton\":" + std::to_string(36 + i % 24) + ",\"vel\":100}";
  std::ofstream(ordner + "/wiedergabe-1.json")
      << "{\"format\":\"cypherdj-arr/1\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" << clips
      << "]},{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" << noten
      << "]},{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" << noten << "]}]}";
  {   // arr32: 24 RB-338 (Spur 1 bis 24), 8 Audio (Spur 25 bis 32) mit je einem Clip über die ganze Schleife (32 Beats)
    constexpr int FRAMES32 = 720'000;   // 32 Beats bei 128 BPM und 48 kHz = 15 s
    // 8 verschiedene Dateien (der Cache ist nach sha geschlüsselt und hält je sha einen Puffer): je Spur eine eigene sha
    // und eine eigene Tonhöhe, sonst lesen 8 Spuren dieselben Adressen
    const auto sha32_von = [](int sp) { return std::string(63, 'd') + "0123456789abcdef"[sp - 25]; };
    // U8b: 32 audio tracks (hk32, fest32): 32 distinct files, 62 'f' and two hex digits, a different pitch each (the cache keys by sha, so each track reads its own addresses)
    const auto sha32a = [](int sp) { char h[3]; std::snprintf(h, sizeof h, "%02x", sp); return std::string(62, 'f') + h; };
    const bool will_a32 = lagen.find(",arr32hk32,") != std::string::npos || lagen.find(",arr32fest32,") != std::string::npos;
    for (int sp = 1; will_a32 && sp <= 32; ++sp) {
      std::vector<float> ton(2 * (size_t)FRAMES32);
      const float hz = 180.0f * (1.0f + 0.04f * (float)(sp - 1));
      for (int i = 0; i < FRAMES32; ++i) ton[2 * i] = ton[2 * i + 1] = 0.3f * std::sin(6.2831853f * hz * i / 48000.0f);
      std::ofstream(ordner + "/audio/" + sha32a(sp) + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(ton.data()), (std::streamsize)(ton.size() * sizeof(float)));
    }
    for (int sp = 25; will32 && sp <= 32; ++sp) {
      std::vector<float> ton(2 * (size_t)FRAMES32);
      const float hz = 220.0f * (1.0f + 0.05f * (float)(sp - 25));
      for (int i = 0; i < FRAMES32; ++i) ton[2 * i] = ton[2 * i + 1] = 0.3f * std::sin(6.2831853f * hz * i / 48000.0f);
      std::ofstream(ordner + "/audio/" + sha32_von(sp) + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(ton.data()), (std::streamsize)(ton.size() * sizeof(float)));
    }
    // 1.10 slice 4a (T8): the insert chains of arr32ins as `,"chain":[...]` per strip (index as ARR_KETTEN: tracks 0..31, groups 32.., PM 40, returns 41..); each slot 1..12 once
    const auto ins_kette = [](int streifen, bool voll) -> std::string {
      const bool ohne_eq = voll && std::getenv("KOSTEN_VOLL_OHNE_EQ") != nullptr, ohne_racks = voll && std::getenv("KOSTEN_VOLL_OHNE_RACKS") != nullptr;
      std::vector<int> sl;
      switch (streifen) {
        case 0: sl = {2}; break;
        case 1: sl = {3}; break;
        case 2: sl = {1}; break;
        case 4: sl = {4, 5}; break;
        case 5: sl = ohne_eq ? std::vector<int>{} : std::vector<int>{101}; break;  // slice 4b: the eq, slot 1 of its own pool (codes 101 = eq 1, 201 = saett 1, 301 = lim 1), on track 6
        case 6: sl = voll ? std::vector<int>{} : std::vector<int>{201}; break;     // the saett, slot 1, on track 7 (arr32voll: on group 1)
        case 7: if (cdj::ARR_INS_EQ >= 2 && !ohne_eq) sl = {102}; break;  // 2026-11-06: the second eq of the pool (eq 2), on track 8
        case 24: sl = voll ? std::vector<int>{6, 7} : std::vector<int>{6}; break;
        case 25: sl = voll ? std::vector<int>{} : std::vector<int>{7}; break;
        case 32: sl = voll ? std::vector<int>{8, 9, 201} : std::vector<int>{8}; break;   // group 1
        case 33: sl = voll ? std::vector<int>{} : std::vector<int>{9}; break;            // group 2
        case 40: sl = {12, 301}; break;  // PM: komp 12, then the master limiter lim 1 (code 301, master limiter plan 2026-11-06), last in the chain
        case 41: sl = {10}; break;  // return 1
        case 42: sl = {11}; break;  // return 2
        default: break;
      }
      if (sl.empty()) return "";
      // 1.10 slice 5 U2b: KOSTEN_VOLL_SCHLUESSEL=1 gives the stages of arr32voll a structural sidechain key of every kind that exists (the rows sc of the slots 1 and 4 of the arr32ins file stay: the row key).
      // The delay compensation of the file (eq on a track, saett on a group) makes the key rings run: every track strip starts 69 samples late, a deck or row key arrives at 0.
      const bool mit_key = voll && std::getenv("KOSTEN_VOLL_SCHLUESSEL") != nullptr;
      const auto key_von = [](int slot) -> std::string {
        switch (slot) {
          case 2: return "{\"q\":\"deck\",\"nr\":1}";                         // track 1: DJ deck
          case 3: return "{\"q\":\"erz\",\"nr\":1}";                          // track 2: DJ erz/1
          case 5: return "{\"q\":\"spur\",\"nr\":12,\"punkt\":\"post\"}";    // track 5: track post
          case 6: return "{\"q\":\"deck\",\"nr\":2}";                         // track 25
          case 7: return "{\"q\":\"spur\",\"nr\":13,\"punkt\":\"post\"}";    // track 25
          case 8: return "{\"q\":\"deck\",\"nr\":1}";                         // group 1: DJ deck (arrives at 0, the group strip starts at the track alignment: a ring)
          case 9: return "{\"q\":\"erz\",\"nr\":1}";                          // group 1: DJ erz/1 (a ring)
          case 10: return "{\"q\":\"grp\",\"nr\":1,\"punkt\":\"post\"}";     // return 1: group 1 post
          case 11: return "{\"q\":\"grp\",\"nr\":2,\"punkt\":\"pre\"}";      // return 2: group 2 pre
          case 12: return "{\"q\":\"ret\",\"nr\":1,\"punkt\":\"pre\"}";      // PM: return 1 pre
          default: return "";
        }
      };
      std::string c = ",\"chain\":[";
      for (size_t k = 0; k < sl.size(); ++k) {
        const std::string key = mit_key && sl[k] < 100 ? key_von(sl[k]) : "";
        c += (k ? "," : "") + std::string("{\"art\":\"") + (sl[k] >= 300 ? "lim" : sl[k] >= 200 ? "saett" : sl[k] >= 100 ? "eq" : "komp") + "\",\"slot\":" + std::to_string(sl[k] % 100) + (key.empty() ? "" : ",\"key\":" + key) + "}";
      }
      c += "]";
      if (voll && !ohne_racks)   // 1.10 slices 5 to 8, U0: the 4c rack of the strip, if it owns one (arr32voll)
        for (const VollRack& r : voll_racks(!ohne_eq)) {
          if (r.streifen != streifen) continue;
          c += ",\"rack\":{\"slot\":" + std::to_string(r.slot) + ",\"ziele\":[";
          for (size_t k = 0; k < r.z.size(); ++k) {
            char z[160];
            std::snprintf(z, sizeof z, "%s{\"makro\":%d,\"stufe\":%d,\"param\":%d,\"von\":%.4f,\"bis\":%.4f}", k ? "," : "", r.z[k].makro, r.z[k].stufe, r.z[k].param, (double)r.z[k].von, (double)r.z[k].bis);
            c += z;
          }
          c += "]}";
        }
      return c;
    };
    const auto bau32 = [&](int nr, bool mit_gruppen, bool mit_lane = false, int mit_ret = 0, int mit_auto = 0, bool mit_ins = false, bool voll = false, bool mit_kit = false, bool mit_rack = false) {   // mit_kit / mit_rack: 1.9 arr32kit / U6 arr32rack (merge 2026-11-07: numbers 19 and 20)   // mit_auto: 9 = arr32mod (arr32auto plus a relative fader lane on all 32 tracks), 6 = arr32hk (gain envelope on the 8 audio clips), 7 = arr32hk32 (32 audio tracks with the envelope), 8 = arr32fest32 (32 audio tracks, no envelope), 1 = slice 2 lanes (fader, pan, cutoff), 2 = plus solo lane, 3 = pan lane only, 4 = cutoff lane on tracks 1..8 only, 5 = steep fader and pan lanes on all tracks   // mit_ret: number of returns (1.10 slice 3, format /2)   // 1.10: nr 2 ohne Gruppen (/1), nr 3 mit 8 Gruppen zu je 4 Spuren (/2)
    std::string j = std::string("{\"format\":\"") + (mit_gruppen || mit_lane || mit_ret || mit_auto || mit_ins || mit_rack ? "cypherdj-arr/2" : "cypherdj-arr/1") + "\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[";
    for (int sp = 1; sp <= 32; ++sp) {
      j += (sp > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(sp);
      if (mit_gruppen) j += ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string((sp - 1) % 8 + 1) + "}";   // 8 Gruppen zu je 4 Spuren
      const bool a32spur = mit_auto == 7 || mit_auto == 8;
      if (mit_ins && sp <= 8) j += ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string((sp - 1) / 4 + 1) + "}";   // slice 4a: tracks 1..4 -> group 1, 5..8 -> group 2
      if (mit_ins) j += ins_kette(sp - 1, voll);
      if (mit_rack && sp <= 8) {   // 1.9 U6 arr32rack: tracks 1..8 are racks of four internal members (three RB-338 on 36..47, 48..59, 60..71 and kit_zwei on 0..1; the playback allows at most 8 kit uses, so one kit member per rack); each sixteenth plays one note per member, so every member plays as dense as a plain track
        j += ",\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
             "{\"id\":\"a\",\"art\":\"intern\",\"geraet\":\"rb338\",\"ton\":[36,47]},"
             "{\"id\":\"b\",\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.4},\"ton\":[48,59],\"gain_db\":-3.0},"
             "{\"id\":\"c\",\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.6},\"ton\":[60,71],\"gain_db\":-6.0},"
             "{\"id\":\"d\",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_zwei\",\"ton\":[0,1]}],\"noten\":[";
        for (int i = 0; i < 128; ++i) {
          const int t[4] = {36 + (i + sp) % 12, 48 + (i + sp) % 12, 60 + (i + sp) % 12, (i + sp) % 2};
          for (int m = 0; m < 4; ++m)
            j += ((i || m) ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "/" + std::to_string(m) + "\",\"beat\":" + std::to_string(i * 0.25) +
                 ",\"laenge\":0.2,\"ton\":" + std::to_string(t[m]) + ",\"vel\":100}";
        }
        j += "]";
      } else if (mit_kit && sp <= 8) {   // 1.9 arr32kit: tracks 1..8 play the test kit kit_zwei, 16 notes per bar (four sixteenths per beat, 32 beats), notes 0 and 1 alternate
        j += ",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_zwei\",\"noten\":[";
        for (int i = 0; i < 128; ++i)
          j += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) +
               ",\"laenge\":0.2,\"ton\":" + std::to_string((i + sp) % 2) + ",\"vel\":100}";
        j += "]";
      } else if (sp <= 24 && !a32spur) {
        j += ",\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[";
        for (int i = 0; i < 128; ++i)   // vier Sechzehntel je Beat, 32 Beats; Tonhöhe je Spur versetzt
          j += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) +
               ",\"laenge\":0.2,\"ton\":" + std::to_string(36 + (i + sp) % 24) + ",\"vel\":100}";
        j += "]";
      } else {
        char c[400];
        std::snprintf(c, sizeof c,
                      ",\"art\":\"audio\",\"clips\":[{\"id\":\"d%d\",\"start_beat\":0.0,\"laenge_beats\":32.0,\"sha256\":\"%s\","
                      "\"datei\":\"%s/audio/%s.f32\",\"frames\":%d,\"offset_frames\":0,\"gain_db\":-6.0,\"ein_beats\":0.0,"
                      "\"aus_beats\":0.0}",
                      sp, (a32spur ? sha32a(sp) : sha32_von(sp)).c_str(), ordner.c_str(), (a32spur ? sha32a(sp) : sha32_von(sp)).c_str(), FRAMES32);
        std::string cs = c;
        if (mit_auto == 6 || mit_auto == 7) {   // a linear ramp per 2 beats: 17 points over the 32 beats, 12 dB and 3 dB down in turn (the phase differs by track so the ramps are not in step)
          std::string hk = ",\"gain_hk\":[";
          for (int k = 0; k <= 16; ++k) {
            char z[64];
            std::snprintf(z, sizeof z, "%s[%d,%d,0]", k ? "," : "", 2 * k, ((k + sp) & 1) ? -3 : -12);
            hk += z;
          }
          cs.insert(cs.size() - 1, hk + "]");
        }
        j += cs;
        j += "]";
      }
      if (mit_auto >= 3 && mit_auto <= 5) {   // decomposition layouts: only the pan lane (3) or only the cutoff lane of the tracks 1..8 (4)
        char c[300];
        const double mitte = ((sp % 5) - 2) * 0.2;
        if (mit_auto == 3) {
          std::snprintf(c, sizeof c, ",\"auto\":[{\"ziel\":\"pan\",\"punkte\":[[0.0,%.2f,0],[16.0,%.2f,0],[32.0,%.2f,0]]}]", mitte - 0.3, mitte + 0.3, mitte - 0.3);
          j += c;
        } else if (sp <= 8) {
          j += ",\"auto\":[{\"ziel\":\"geraet.cutoff\",\"punkte\":[[0.0,0.2,0],[16.0,0.8,0],[32.0,0.2,0]]}]";
        }
      }
      if (mit_auto == 5) {   // arr32steil: a zigzag of 20 dB (fader) and 1.6 pan units (pan) per 0.05 beat on every track, 641 points per lane, 64 lanes: the hold of 16 samples is left every 2 samples
        j += ",\"auto\":[{\"ziel\":\"fader\",\"punkte\":[";
        for (int k = 0; k <= 640; ++k) {
          char c[64];
          std::snprintf(c, sizeof c, "%s[%.2f,%.1f,0]", k ? "," : "", k * 0.05, (k + sp) % 2 ? 0.0 : -20.0);
          j += c;
        }
        j += "]},{\"ziel\":\"pan\",\"punkte\":[";
        for (int k = 0; k <= 640; ++k) {
          char c[64];
          std::snprintf(c, sizeof c, "%s[%.2f,%.1f,0]", k ? "," : "", k * 0.05, (k + sp) % 2 ? 0.8 : -0.8);
          j += c;
        }
        j += "]}]";
      }
      if (mit_auto == 1 || mit_auto == 2 || mit_auto == 9) {   // Automation Slice 2 (AK22); 9 (U9, arr32mod): the same lanes plus a relative fader lane: fader and pan lane on every track, geraet.cutoff on the internal tracks 1..8, a solo lane on 4 tracks for mit_auto == 2
        char c[400];
        const double mitte = ((sp % 5) - 2) * 0.2;   // pan centre -0.4 .. 0.4, the triangle moves 0.3 around it
        std::snprintf(c, sizeof c,
                      ",\"auto\":[{\"ziel\":\"fader\",\"punkte\":[[0.0,0.0,0],[16.0,%.1f,0],[32.0,0.0,0]]},"
                      "{\"ziel\":\"pan\",\"punkte\":[[0.0,%.2f,0],[16.0,%.2f,0],[32.0,%.2f,0]]}",
                      -3.0 - (sp % 4), mitte - 0.3, mitte + 0.3, mitte - 0.3);
        j += c;
        if (sp <= 8) j += ",{\"ziel\":\"geraet.cutoff\",\"punkte\":[[0.0,0.2,0],[16.0,0.8,0],[32.0,0.2,0]]}";
        if (mit_auto == 9) j += ",{\"ziel\":\"fader\",\"relativ\":true,\"punkte\":[[0.0,-10.0,0],[16.0,-14.0,0],[32.0,-10.0,0]]}";   // 1.12 slice 5 U9: the summand, 32 more lanes
        if (mit_auto == 2 && (sp == 1 || sp == 2 || sp == 4 || sp == 5)) {
          const int b = sp == 1 ? 6 : sp == 2 ? 10 : sp == 4 ? 14 : 18;   // staggered, never on track 3 (its solo count belongs to the stellwerk parts)
          std::snprintf(c, sizeof c, ",{\"ziel\":\"solo\",\"punkte\":[[0.0,0,2],[%d.0,1,2],[%d.25,0,2]]}", b, b);
          j += c;
        }
        j += "]";
      }
      if (mit_lane) {   // Automation Slice 1: one fader lane per track, a triangle over the loop (0 dB, target, 0 dB): every block lies inside a ramp
        char c[200];
        std::snprintf(c, sizeof c, ",\"auto\":[{\"ziel\":\"fader\",\"punkte\":[[0.0,0.0,0],[16.0,%.1f,0],[32.0,0.0,0]]}]", -3.0 - (sp % 4));
        j += c;
      }
      j += "}";
    }
    j += "]";
    if (mit_gruppen) {
      j += ",\"gruppen\":[";
      for (int g = 1; g <= 8; ++g) j += (g > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(g) + ",\"ausgang\":{\"art\":\"master\"}}";
      j += "]";
    }
    if (mit_ins) {   // slice 4a: groups 1 and 2 with their chains, the PM chain
      j += ",\"gruppen\":[";
      for (int g = 1; g <= 2; ++g) j += (g > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(g) + ",\"ausgang\":{\"art\":\"master\"}" + ins_kette(31 + g, voll) + "}";
      j += "],\"pm\":{" + ins_kette(40, voll).substr(1) + "}";
    }
    if (mit_ret) {
      j += ",\"returns\":[";
      for (int r = 1; r <= 4 && r <= mit_ret; ++r) j += (r > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(r) + ",\"ausgang\":{\"art\":\"master\"}" + (mit_ins ? ins_kette(40 + r, voll) : std::string()) + "}";
      j += "]";
    }
    j += "}";
    return j;
    };
    if (will32) {
      std::ofstream(ordner + "/wiedergabe-2.json") << bau32(2, false);
      std::ofstream(ordner + "/wiedergabe-3.json") << bau32(3, true);
      std::ofstream(ordner + "/wiedergabe-4.json") << bau32(4, false, true);
      std::ofstream(ordner + "/wiedergabe-5.json") << bau32(5, false, false, 4);   // 1.10 slice 3: 32 tracks, 4 returns
      std::ofstream(ordner + "/wiedergabe-13.json") << bau32(13, false, false, 4, 0, true);   // 1.10 slice 4a: arr32r plus 12 komp stages (arr32ins and arr32ins_aus); slice 4b adds the eq and saett stage
      std::ofstream(ordner + "/wiedergabe-18.json") << bau32(18, false, false, 4, 0, true, true);   // 1.10 slices 5 to 8, U0: arr32voll = the arr32ins stages regrouped + 4 racks with 16 mappings each
      std::ofstream(ordner + "/wiedergabe-7.json") << bau32(7, false, false, 0, 1);   // slice 2: arr32auto
      std::ofstream(ordner + "/wiedergabe-8.json") << bau32(8, false, false, 0, 2);   // slice 2: arr32solo
      std::ofstream(ordner + "/wiedergabe-9.json") << bau32(9, false, false, 0, 3);    // arr32pan
      std::ofstream(ordner + "/wiedergabe-10.json") << bau32(10, false, false, 0, 4);  // arr32cut
      std::ofstream(ordner + "/wiedergabe-12.json") << bau32(12, false, false, 0, 5);  // arr32steil
      std::ofstream(ordner + "/wiedergabe-11.json") << bau32(11, false);               // arr32rb: the arr32fest file under another number
      std::ofstream(ordner + "/wiedergabe-14.json") << bau32(14, false, false, 0, 6);  // arr32hk
      std::ofstream(ordner + "/wiedergabe-15.json") << bau32(15, false, false, 0, 7);  // arr32hk32
      std::ofstream(ordner + "/wiedergabe-16.json") << bau32(16, false, false, 0, 8);  // arr32fest32
      std::ofstream(ordner + "/wiedergabe-17.json") << bau32(17, false, false, 0, 9);  // arr32mod (U9; numbers 14..17: 13 is the arr32ins file of slice 4)
      std::ofstream(ordner + "/wiedergabe-19.json") << bau32(19, false, false, 0, 0, false, false, true);          // 1.9 arr32kit: arr32 with the tracks 1..8 on a kit
      std::ofstream(ordner + "/wiedergabe-20.json") << bau32(20, false, false, 0, 0, false, false, false, true);   // 1.9 U6 arr32rack: arr32 with the tracks 1..8 as racks of 4 members
      std::ofstream(ordner + "/wiedergabe-6.json") << bau32(6, false, false, 2);   // the swap partner of arr32r_oeffnen: returns 3 and 4 are dropped
    }
  }
  cdj::SpeicherKonto konto(3800LL << 20);
  cdj::ArrAudioCache cache(&konto, 1024LL << 20, true);
  const bool will_au = lagen.find(",arr32au,") != std::string::npos, will_warp = lagen.find(",arr32warp,") != std::string::npos;
  if (will_au || will_warp) {   // Slice 2: acht Töne zu je 17 Quell-Beats (125 BPM), geteilt von vier Spuren
    for (int q = 0; q < 8; ++q) {
      std::vector<float> ton(2 * static_cast<size_t>(17 * WARP_FPB125));
      const float hz = 220.0f * (1.0f + 0.07f * static_cast<float>(q));
      for (size_t i = 0; i < ton.size() / 2; ++i) ton[2 * i] = ton[2 * i + 1] = 0.3f * std::sin(6.2831853f * hz * static_cast<float>(i) / 48000.0f);
      std::ofstream(ordner + "/audio/" + std::string(63, 'e') + "0123456789abcdef"[q] + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(ton.data()), static_cast<std::streamsize>(ton.size() * sizeof(float)));
    }
    double p_au = -1.0, p_warp = -1.0;
    int rc = 0;
    // Das Tor gilt ab KOSTEN_TOR_ZYKLEN (Vorgabe 20 000) Zyklen: darunter liegen nur wenige Zyklen jenseits von p99,9, der Zuwachs streut von −12 bis +382 µs (Plan, Task 8).
    // KOSTEN_GRENZE_US (Vorgabe 150, die Grenze von AK31) und KOSTEN_TOR_ZYKLEN gibt es für den Kontrolllauf des Tors.
    const char* e_tor = std::getenv("KOSTEN_TOR_ZYKLEN");
    const char* e_grenze = std::getenv("KOSTEN_GRENZE_US");
    const bool tor = n >= (e_tor ? std::atoi(e_tor) : 20'000);
    const double grenze = e_grenze ? std::atof(e_grenze) : 150.0;
    if (will_au) rc = std::max(rc, warp_lage("arr32au", n, tor, ordner, konto, cache, p_au));
    if (will_warp) rc = std::max(rc, warp_lage("arr32warp", n, tor, ordner, konto, cache, p_warp));
    if (p_au >= 0 && p_warp >= 0) {
      const double zuwachs = p_warp - p_au;
      std::printf("Zuwachs p99,9 (Kern + Last) arr32warp gegen arr32au: %.1f µs (Grenze %.0f µs%s)\n", zuwachs, grenze, tor ? "" : "; unter 20 000 Zyklen nur gemeldet, kein Tor");
      if (tor && zuwachs > grenze) {
        std::fprintf(stderr, "kosten_arr: AK31: der Zuwachs %.1f µs liegt über %.0f µs (p99,9, %d Zyklen)\n", zuwachs, grenze, n);
        rc = std::max(rc, 2);
      }
    }
    if (rc) return rc;
  }
  for (const char* lage : {"ohne", "arr3", "arr3rb", "hand", "arr32", "arr32g", "arr32fest", "arr32lane", "arr32lanet", "arr32auto", "arr32ueber", "arr32arm", "arr32armgriff", "arr32solo", "arr32pan", "arr32cut", "arr32rb", "arr32steil", "arr32hk", "arr32hk32", "arr32fest32", "arr32mod", "arr32r", "arr32r_setze", "arr32r_oeffnen", "arr32ins", "arr32ins_aus", "arr32ins_k", "arr32ins_ke", "arr32ins_ks", "arr32ins_ol", "arr32voll", "arr32kit", "arr32rack"}) {
    if (!lagen.empty() && lagen.find(std::string(",") + lage + ",") == std::string::npos) continue;
    Lauf l;
    if (const char* sc = std::getenv("KOSTEN_SCHLAF"); sc && std::string(sc) == "0") {   // reference arm: sleep off, right after the kern is built, so schlaf_bloecke counts nothing
      cdj::KernPruefZugang::mixer(*l.kern).setze_schlaf(false);
      std::fprintf(stderr, "kosten_arr: %s: KOSTEN_SCHLAF=0, mixer sleep is off\n", lage);
    }
    if (std::getenv("KOSTEN_OHNE_VORAUSSCHAU"))   // control run: every lane sample evaluated, as before the look-ahead in auto_block (same bits, higher cost)
      const_cast<cdj::Arrangement&>(l.kern->arrangement()).setze_auto_vorausschau(false);
    std::unique_ptr<cdj::HallPool> hall_pool;   // mehrkern task 4: outlives every cycle of this lane (the kern only holds the pointer)
    if (const char* hf = std::getenv("KOSTEN_HALL_FAEDEN"); hf && std::atoi(hf) > 0) {
      cdj::HallPoolEinstellung he;
      he.faeden = std::min(3, std::atoi(hf));
      if (const char* hu = std::getenv("KOSTEN_HALL_FRIST_US")) he.frist_us = std::atoi(hu);
      if (const char* hc = std::getenv("KOSTEN_HALL_CPUS")) std::sscanf(hc, "%d,%d,%d", &he.cpus[0], &he.cpus[1], &he.cpus[2]);
      hall_pool = std::make_unique<cdj::HallPool>(he);
      if (const char* ap = std::getenv("KOSTEN_ARR_PRIO")) hall_pool->prioritaet(std::atoi(ap));
      if (std::getenv("KOSTEN_HALL_POOL_UNBENUTZT"))   // control run: the pool exists and its workers run, but the kern never gets it (ctest kosten_arr_hash_pool_unbenutzt)
        std::fprintf(stderr, "kosten_arr: %s: KOSTEN_HALL_POOL_UNBENUTZT, the pool is built but not attached\n", lage);
      else
        l.kern->setze_hall_pool(hall_pool.get());
      std::fprintf(stderr, "kosten_arr: %s: HallPool on, %d workers (asked %d), cpus %d,%d,%d\n", lage, hall_pool->faeden(), he.faeden, he.cpus[0], he.cpus[1], he.cpus[2]);
    } else {
      std::fprintf(stderr, "kosten_arr: %s: HallPool off (serial Halls)\n", lage);
    }
    const bool hand = std::string(lage) == "hand";
    uint64_t halter_mensch = 0, halter_frei = 0, hand_ereignisse = 0;
    const bool g32 = std::string(lage) == "arr32g";   // 1.10: wie arr32, dazu 8 Gruppen und der PM
    const bool fest = std::string(lage) == "arr32fest", lane = std::string(lage) == "arr32lane", lanet = std::string(lage) == "arr32lanet";
    const bool ueber = std::string(lage) == "arr32ueber";   // slice 3: the arr32auto file with 8 lanes overridden by the hand
    const bool arm = std::string(lage) == "arr32arm", armgriff = std::string(lage) == "arr32armgriff", armiert = arm || armgriff;   // 1.12 S3 wave B: arr32auto with all 32 tracks armed (armgriff: plus grips on 4 faders)
    uint64_t auto_punkte = 0;   // AUTO_PUNKT events seen
    const bool aut = std::string(lage) == "arr32auto" || ueber || armiert, aut_solo = std::string(lage) == "arr32solo";   // slice 2
    const bool aut_pan = std::string(lage) == "arr32pan", aut_cut = std::string(lage) == "arr32cut", aut_rb = std::string(lage) == "arr32rb", aut_steil = std::string(lage) == "arr32steil";   // decomposition, steep lanes
    const bool hk = std::string(lage) == "arr32hk", hk32 = std::string(lage) == "arr32hk32", fest32 = std::string(lage) == "arr32fest32";   // U8b: clip gain envelopes
    const bool mod = std::string(lage) == "arr32mod";   // U9: arr32auto plus a relative fader lane on all 32 tracks (the value stack)
    const bool r32o_ = std::string(lage) == "arr32r_oeffnen";   // the stellwerk holds at most MAX_TEILE = 256 open parts: 41 fader ramps + 114 solo parts + 128 send ramps would exceed it, so this situation runs without the fader ramps
    const bool ohne_rampen = fest || lane || lanet || aut || aut_solo || aut_pan || aut_cut || aut_rb || aut_steil || hk || hk32 || fest32 || mod || r32o_;   // Automation Slice 1: no stellwerk fader ramps; fixed fader (fest) or one lane per track (lane, lanet)
    const bool kitl = std::string(lage) == "arr32kit";   // 1.9: arr32 with tracks 1..8 switched to the kit device
    const bool rackl = std::string(lage) == "arr32rack";   // 1.9 U6: arr32 with tracks 1..8 as racks of four internal members (8 x 4 = 32 member slots)
    const bool r32 = std::string(lage) == "arr32r", r32s = std::string(lage) == "arr32r_setze", r32o = std::string(lage) == "arr32r_oeffnen";
    // slice 4b T12 variants for the pool decision: _k = the 12 komp stages only (the slice 4a lane shape: eq and saett present but off), _ke = plus the eq, _ks = plus the saett
    const std::string lage_s = lage;
    const bool voll = lage_s == "arr32voll";   // 1.10 slices 5 to 8, U0: the full-load lane (all pools, 4 racks x 16 mappings, PDC on a track and a group)
    const bool eq_an = lage_s == "arr32ins" || lage_s == "arr32ins_ke" || lage_s == "arr32ins_ol" || voll, saett_an = lage_s == "arr32ins" || lage_s == "arr32ins_ks" || lage_s == "arr32ins_ol" || voll;
    const bool ins_an = lage_s == "arr32ins" || lage_s == "arr32ins_k" || lage_s == "arr32ins_ke" || lage_s == "arr32ins_ks" || lage_s == "arr32ins_ol" || voll, ins_aus = lage_s == "arr32ins_aus", ins_lage = ins_an || ins_aus;
    // master limiter plan (2026-11-06): lim 1 on the PM computes in every lane that computes stages (an 1, ceiling -1 dB); arr32ins_aus bypasses it with the rest,
    // arr32ins_ol is arr32ins with only the lim bypassed (the paired price of the limiter: arr32ins - arr32ins_ol in one interleaved pass)
    const bool lim_an = ins_an && lage_s != "arr32ins_ol";
    const int ins_erwartet = ins_an ? 12 + (eq_an ? cdj::ARR_INS_EQ : 0) + (saett_an ? 1 : 0) + (lim_an ? cdj::ARR_INS_LIM : 0) : 0;   // 1.10 slice 4a (T8)
    const bool ret_lage = r32 || r32s || r32o || ins_lage;   // 1.10 slice 3: 32 tracks, 4 returns with a Hall each, 128 sends; _setze moves a Hall control every block, _oeffnen swaps the playback every 500 blocks
    const bool a32 = std::string(lage) == "arr32" || g32 || ohne_rampen || ret_lage || kitl || rackl;
    const int arr_nr32 = rackl ? 20 : kitl ? 19 : voll ? 18 : ins_lage ? 13 : ret_lage ? 5 : g32 ? 3 : (lane || lanet) ? 4 : aut ? 7 : aut_solo ? 8 : aut_pan ? 9 : aut_cut ? 10 : aut_rb ? 11 : aut_steil ? 12 : hk ? 14 : hk32 ? 15 : fest32 ? 16 : mod ? 17 : 2;
    const int stumm_nr = std::getenv("KOSTEN_ARR32_STUMM") ? std::atoi(std::getenv("KOSTEN_ARR32_STUMM")) : 0;
    float spitze_db[33], zuletzt_db[33];   // arr32: höchste Spur-Spitze seit Zyklus 100 je Spur (dB)
    for (float& x : spitze_db) x = -1000.0f;
    for (float& x : zuletzt_db) x = -1000.0f;
    uint64_t meld_n[33] = {}, klang_n[33] = {};   // arr32: Pegel-Meldungen seit Zyklus 100 je Spur, davon klingende (> -120 dB)
    int zyk = 0;
    uint64_t solo_schaltungen = 0;       // arr32: Blöcke, in denen sich der Solo-Wert von Spur 3 änderte (= Blöcke mit solo_vl)
    float solo_vorher = 0.0f;
    std::vector<double> us_rampe;        // arr32r_oeffnen: the two blocks that carry the send ramps
    std::vector<double> us_solo;         // arr32: Dauer genau dieser Blöcke
    uint64_t quittung_status[8] = {};   // arr32: Quittungen der Teile je Status (6 = abgelehnt)
    auto leeren = [&] {
      cdj::Ereignis e;
      while (l.ere->hole(e)) {
        if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "erz/3/fader")) {
          if (!std::strcmp(e.text, "mensch")) ++halter_mensch;
          else if (!std::strcmp(e.text, "frei")) ++halter_frei;
        } else if (e.art == cdj::Ereignis::AUTO_PUNKT) {
          ++auto_punkte;
        } else if (e.art == cdj::Ereignis::HAND) {
          ++hand_ereignisse;
        } else if (e.art == cdj::Ereignis::ARR_ALT) {
          cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), cache);
        } else if (a32 && e.art == cdj::Ereignis::QUITTUNG) {
          if (e.status >= 0 && e.status < 8) ++quittung_status[e.status];
          if (e.status == 6) std::fprintf(stderr, "arr32: abgelehntes Teil id %lld, Grund \"%s\" / \"%s\"\n", (long long)e.id, e.text, e.pfad);
        } else if (a32 && e.art == cdj::Ereignis::PEGEL && zyk >= 100 && !std::strncmp(e.pfad, "spur/", 5)) {
          const int nr = std::atoi(e.pfad + 5);
          if (nr >= 1 && nr <= 32) {
            spitze_db[nr] = std::max(spitze_db[nr], e.pegel[0]);
            zuletzt_db[nr] = e.pegel[0];
            ++meld_n[nr];
            if (e.pegel[0] > -120.0f) ++klang_n[nr];
          }
        }
      }
    };
    const auto griff = [&](float x) {   // /test/hand wie aus dem Netz: ein Regler unter Menschenhand
      cdj::Befehl h = l.neu(cdj::Befehl::HAND);
      h.id = 0;
      std::snprintf(h.pfad, sizeof h.pfad, "erz/3/fader");
      h.wert = x;
      h.sample = l.kern->sample();
      l.bef->schiebe(h);
    };
    Kostensenke intern(0), wirt(2 * 256 + 25);
    const bool eigene = std::string(lage) == "arr3rb" || a32;   // D1 K2b: die Senken des Kerns (RB-338, Wirt-Slot 1 ohne Wirt)
    if (!eigene) {
      l.kern->setze_arr_senke_intern(&intern);
      l.kern->setze_arr_senke_wirt(1, &wirt);
    }
    cdj::Befehl f = l.neu(cdj::Befehl::TEIL);   // erz/4 offen wie im Betrieb (Spec 2.3)
    std::snprintf(f.pfad, sizeof f.pfad, "erz/4/fader");
    f.politik = 1;
    l.bef->schiebe(f);
    if (kitl || rackl) {   // 1.9: the kit store of the cache loads the repo test kits through lade_kit; the reader is the kit sink of this run's core
      cache.setze_kit_ordner(std::string(CYPHERDJ_DJK) + "/kern/tests/daten/kits");
      cache.setze_kit_lader(&cdj::lade_kit);
    }
    cache.setze_kit_leser(l.kern->arr_kit_leser());
    if (std::string(lage) != "ohne") {
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, a32 ? arr_nr32 : 1, cache);
      if (!e.snap) {
        std::fprintf(stderr, "kosten_arr: %s\n", e.meldung.c_str());
        return 1;
      }
      cdj::Befehl b = l.neu(cdj::Befehl::ARR_LADEN);
      b.zeiger = e.snap.release();
      b.arr_nr = a32 ? arr_nr32 : 1;
      l.bef->schiebe(b);
      cdj::Befehl lp = l.neu(cdj::Befehl::ARR_LOOP);
      lp.an = 1;
      lp.arr_von = 0.0;
      lp.arr_bis = 32.0;
      l.bef->schiebe(lp);
      cdj::Befehl m = l.neu(cdj::Befehl::ARR_METRONOM);
      m.an = 1;
      m.wert = -12.0f;
      l.bef->schiebe(m);
      cdj::Befehl s = l.neu(cdj::Befehl::ARR_START);
      l.bef->schiebe(s);
      if (!a32) {
        cdj::Befehl r = l.neu(cdj::Befehl::TEIL);   // Fader-Rampe: Verlauf je Sample ins Modul
        std::snprintf(r.pfad, sizeof r.pfad, "spur/1/fader");
        r.wert = -6.0f;
        r.ab_beat = 8.0;
        r.dauer_beats = 64.0;
        r.politik = 1;
        l.bef->schiebe(r);
      } else {
        // Zyklus 2000 liegt bei Beat 22,8 (128 BPM, 256 Samples je Zyklus, 48 kHz): die Rampen starten bei Beat 24 und
        // laufen über 240 Beats, das Messfenster von 20 000 Zyklen endet bei Beat 250
        for (int sp = 1; sp <= 32 && !ohne_rampen; ++sp) {
          cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
          std::snprintf(r.pfad, sizeof r.pfad, "spur/%d/fader", sp);
          r.wert = -3.0f - (float)(sp % 4);
          r.ab_beat = 24.0;
          r.dauer_beats = 240.0;
          r.politik = 1;
          l.bef->schiebe(r);
        }
        if (g32) {   // 1.10: dieselbe Rampenform an den 8 Gruppen-Fadern und am PM-Fader
          for (int g = 1; g <= 8; ++g) {
            cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
            std::snprintf(r.pfad, sizeof r.pfad, "grp/%d/fader", g);
            r.wert = -1.0f - (float)(g % 3);
            r.ab_beat = 24.0;
            r.dauer_beats = 240.0;
            r.politik = 1;
            l.bef->schiebe(r);
          }
          cdj::Befehl r = l.neu(cdj::Befehl::TEIL);
          std::snprintf(r.pfad, sizeof r.pfad, "pm/fader");
          r.wert = -2.0f;
          r.ab_beat = 24.0;
          r.dauer_beats = 240.0;
          r.politik = 1;
          l.bef->schiebe(r);
        }
        if (lanet) {   // a tempo map of up to 63 segments: 31 ramps of one beat (126 <-> 130 BPM), one every 7 beats from beat 24 (two segments each)
          for (int k = 0; k < 31; ++k) {
            cdj::Befehl tr = l.neu(cdj::Befehl::TEMPO_RAMPE);
            tr.ab_beat = 24.0 + 7.0 * k;
            tr.ziel_bpm = (k % 2) ? 126.0 : 130.0;
            tr.dauer_beats = 1.0;
            l.bef->schiebe(tr);
          }
        }
        // Solo-Verlauf auf Spur 3: ein Schalter nimmt keine Rampe (keine_rampe) und schaltet ohne Schaltrampe (regler.cpp:152,
        // schalt = 0: sofort, am Sample). Alle 4 Beats ein Solo für eine Sechzehntel (Beat 24 bis 24,25, 28 bis 28,25, …): ein
        // Verlauf besteht nur im Block der Schaltung, der Solo-Scan läuft also nur dort (114 Blöcke), die übrigen Spuren klingen
        // fast immer. KOSTEN_ARR32_SOLO_EIN: Kontrolle, ein Solo bleibt an.
        const bool solo_ein = std::getenv("KOSTEN_ARR32_SOLO_EIN") != nullptr;
        for (int k = 0; k < 57; ++k) {
          for (int an = 1; an >= 0; --an) {
            if (solo_ein && (k > 0 || !an)) continue;
            cdj::Befehl so = l.neu(cdj::Befehl::TEIL);
            std::snprintf(so.pfad, sizeof so.pfad, "spur/3/solo");
            so.wert = (float)an;
            so.ab_beat = 24.0 + 4.0 * k + (an ? 0.0 : 0.25);
            so.dauer_beats = 0.0;
            so.politik = 1;
            l.bef->schiebe(so);
          }
        }
        if (ret_lage) {   // every track sends to every return (128 sends, -10 dB); the Halls get input from the first block of the loop
          // slice 4a (T8): the rows of the 12 stages ride in the same cycles as the sends (one row per cycle next to the send), so the setup takes exactly as many cycles as in arr32r and
          // the solo window of the self-check is the same. The row an decides: 1 = running, 0 = bypassed in the row only (the chain flag in the file stays true).
          std::vector<std::pair<std::string, float>> ins_zeilen;
          for (int n = 1; ins_lage && n <= 12; ++n) {
            const std::string kopf = "ins/komp/" + std::to_string(n) + "/";
            ins_zeilen.push_back({kopf + "schwelle", -30.0f});
            ins_zeilen.push_back({kopf + "ratio", 4.0f});
            ins_zeilen.push_back({kopf + "mix", 1.0f});
            if (n == 1 || n == 4) ins_zeilen.push_back({kopf + "sc", n == 1 ? 1.0f : 2.0f});   // sidechain keys: slot 1 (bass, track 3) listens to track 1, slot 4 (track 5) to track 2
            ins_zeilen.push_back({kopf + "an", ins_an ? 1.0f : 0.0f});
          }
          if (ins_lage) {   // slice 4b: the eq (the "eq_mix" setting of kosten_ins) and the saett of the whole pool
            using B = EqBand;
            const EqBand(&baender)[8] = EQ_MIX_BAENDER;
            for (int e = 1; e <= cdj::ARR_INS_EQ; ++e) {   // every eq of the pool gets the same setting (2026-11-06: the pool has 2)
            for (int m = 1; m <= 8; ++m) {
              const std::string kopf = "ins/eq/" + std::to_string(e) + "/b" + std::to_string(m) + "/";
              const B& b = baender[m - 1];
              ins_zeilen.push_back({kopf + "typ", (float)b.typ});
              ins_zeilen.push_back({kopf + "freq", b.freq});
              ins_zeilen.push_back({kopf + "gain", b.gain});
              ins_zeilen.push_back({kopf + "q", b.q});
              ins_zeilen.push_back({kopf + "steil", (float)b.steil});
              ins_zeilen.push_back({kopf + "platz", (float)b.platz});
              ins_zeilen.push_back({kopf + "an", eq_an ? 1.0f : 0.0f});
            }
            ins_zeilen.push_back({"ins/eq/" + std::to_string(e) + "/an", eq_an ? 1.0f : 0.0f});
            }
            ins_zeilen.push_back({"ins/saett/1/drive", 12.0f});
            ins_zeilen.push_back({"ins/saett/1/an", saett_an ? 1.0f : 0.0f});
            ins_zeilen.push_back({"ins/lim/1/decke", -1.0f});   // master limiter plan: the default ceiling, the PM sum of this lane reaches it
            ins_zeilen.push_back({"ins/lim/1/an", lim_an ? 1.0f : 0.0f});
          }
          if (voll && !std::getenv("KOSTEN_VOLL_OHNE_RACKS") && !std::getenv("KOSTEN_VOLL_MAKRO_AUS"))   // 1.10 slices 5 to 8, U0: the 16 macro rows of the 4 racks (rack/<k>/m<n>)
            for (int k = 1; k <= 4; ++k)
              for (int nr = 1; nr <= 4; ++nr) ins_zeilen.push_back({"rack/" + std::to_string(k) + "/m" + std::to_string(nr), VOLL_MAKRO[nr - 1]});
          size_t ins_naechste = 0;
          for (int sp = 1; sp <= 32; ++sp)
            for (int r = 1; r <= 4; ++r) {
              // rows per setup cycle: 1 while they fit next to the 128 sends, 2 with the second eq (2026-11-06); extra cycles would shift the solo phase
              const size_t je_zyklus = (ins_zeilen.size() + 127) / 128;
              for (size_t z = 0; z < je_zyklus && ins_naechste < ins_zeilen.size(); ++z) {
                cdj::Befehl iz = l.neu(cdj::Befehl::TEIL);
                std::snprintf(iz.pfad, sizeof iz.pfad, "%s", ins_zeilen[ins_naechste].first.c_str());
                iz.wert = ins_zeilen[ins_naechste].second;
                iz.politik = 1;
                l.bef->schiebe(iz);
                ++ins_naechste;
              }
              cdj::Befehl sd = l.neu(cdj::Befehl::TEIL);
              std::snprintf(sd.pfad, sizeof sd.pfad, "spur/%d/send/%d", sp, r);
              sd.wert = -10.0f;
              sd.politik = 1;
              l.bef->schiebe(sd);
              l.zyklus();   // one command per cycle keeps the ring from overflowing
            }
        }
        if (stumm_nr >= 1 && stumm_nr <= 32) {   // Kontrolllauf der Selbstprüfung
          cdj::Befehl mu = l.neu(cdj::Befehl::TEIL);
          std::snprintf(mu.pfad, sizeof mu.pfad, "spur/%d/mute", stumm_nr);
          mu.wert = 1.0f;
          mu.politik = 1;
          l.bef->schiebe(mu);
        }
      }
    }
    if (hand) {
      griff(0.50f);   // erster Wert nur Stellung; der zweite übernimmt (§7.3 Punkt 1)
      l.zyklus();
      griff(0.55f);
    }
    uint64_t hash_pm = 1469598103934665603ULL, hash_out = 1469598103934665603ULL, hash_bloecke = 0;
    const auto hash_zyklus = [&](uint64_t ring_w0) {   // after a cycle: its production master and its master out
      const auto bits = [](float f) { uint32_t w; std::memcpy(&w, &f, 4); return static_cast<uint64_t>(w); };
      const float* ring_d = cdj_ring_daten_c(l.ring);
      for (int ch = 0; ch < 2; ++ch) {
        const float* pm = ch == 0 ? l.kern->pm_abgriff_l() : l.kern->pm_abgriff_r();
        for (int k = 0; k < 256; ++k) hash_pm = (hash_pm ^ bits(pm[k])) * 1099511628211ULL;
        for (int k = 0; k < 256; ++k) hash_out = (hash_out ^ bits(ring_d[((ring_w0 + static_cast<uint64_t>(k)) % CDJ_RING_CAP) * 4 + ch])) * 1099511628211ULL;
      }
      ++hash_bloecke;
    };
    for (int i = 0; i < 2000; ++i) {
      const uint64_t ring_w0 = hash_an ? cdj_lade(&l.ring->w) : 0;
      l.kern->zyklus(256, jetzt_ns());
      if (hash_an) hash_zyklus(ring_w0);
      zyk = i + 1;
      leeren();
      pace();
      if (hand && !nur_rueck && i % 500 == 499) griff(0.50f + 0.05f * ((i / 500) % 2));
    }
    if (ueber && !std::getenv("KOSTEN_UEBER_AUS")) {   // (KOSTEN_UEBER_AUS=1: control run, no grip, the self-check must fail) the grip of the hand on 8 fields, after the warm-up (the transport plays, so the core takes the override, D5)
      for (int k = 0; k < 8; ++k) {
        cdj::Befehl ub = l.neu(cdj::Befehl::ARR_AUTO);
        ub.nr = k % 4 + 1 + (k >= 4 ? 4 : 0);   // tracks 1..4 (fader), 5..8 (pan)
        ub.politik = k >= 4 ? 1 : 0;
        ub.an = 0;
        l.bef->schiebe(ub);
      }
      l.zyklus();
    }
    float arm_griff_x[5] = {};   // arr32armgriff: grip position of the faders 1..4 (the first message only sets the position, the next ones are grips)
    const auto arm_griff = [&](int k, float x) {
      cdj::Befehl h = l.neu(cdj::Befehl::HAND);
      h.id = 0;
      std::snprintf(h.pfad, sizeof h.pfad, "spur/%d/fader", k);
      h.wert = x;
      h.sample = l.kern->sample();
      l.bef->schiebe(h);
    };
    if (armiert) {   // all 32 tracks armed, mode 1 (latch), after the warm-up; spur 0 would disarm, so one command per track
      for (int k = 1; k <= 32; ++k) {
        cdj::Befehl ab = l.neu(cdj::Befehl::ARR_ARM);
        ab.nr = k;
        ab.an = 1;
        ab.politik = 1;
        l.bef->schiebe(ab);
      }
      if (armgriff)
        for (int k = 1; k <= 4; ++k) arm_griff(k, arm_griff_x[k] = 0.2f);
      l.zyklus();
      auto_punkte = 0;
      int n_arm = 0;
      for (int k = 1; k <= 32; ++k) n_arm += l.kern->auto_arm(k) == 1;
      std::fprintf(stderr, "%s: armed tracks %d (expected 32)\n", lage, n_arm);
      if (n_arm != 32) return 2;
    }
    std::vector<double> us;
    us.reserve(n);
    for (int i = 0; i < n; ++i) {
      if (armgriff && i % 16 == 0)   // one human grip per 16 cycles on each of 4 faders (a step of 0.004 as in test_kern_arr_arm)
        for (int k = 1; k <= 4; ++k) arm_griff(k, arm_griff_x[k] += 0.004f);
      if (hand && !nur_rueck && i % 500 == 0) griff(0.50f + 0.05f * ((i / 500) % 2));
      if (r32s && (i % 8 == 0 || std::getenv("KOSTEN_SETZE_JEDER"))) {   // plan F4: every 8th block (12.5 %) carries a changed Hall target, rotating over the returns; KOSTEN_SETZE_JEDER: every block (stress)
        cdj::Befehl hs = l.neu(cdj::Befehl::TEIL);
        std::snprintf(hs.pfad, sizeof hs.pfad, "ret/%d/hall/decay", i % 4 + 1);
        hs.wert = (i / 8) % 2 ? 0.3f : 0.7f;
        hs.politik = 1;
        l.bef->schiebe(hs);
      }
      const bool rampe_an = r32o && (i % 100 == 0 || i % 100 == 1);   // plan F8: every 100th block 128 send controls ramp (10 ms = 480 samples, two blocks) between -200 and -10 dB
      if (r32o && (i % 100 == 0 || i % 100 == 90)) {   // at 90 the sends jump back to -200 (a ramp cannot end there), at 0 they ramp up to -10 dB
        for (int sp = 1; sp <= 32; ++sp)
          for (int r = 1; r <= 4; ++r) {
            cdj::Befehl sd = l.neu(cdj::Befehl::TEIL);
            std::snprintf(sd.pfad, sizeof sd.pfad, "spur/%d/send/%d", sp, r);
            sd.wert = i % 100 == 0 ? -10.0f : -200.0f;
            sd.dauer_beats = i % 100 == 0 ? 480.0 / 48000.0 * 128.0 / 60.0 : 0.0;
            sd.ab_beat = l.kern->karte().beat_at((double)l.kern->sample()) + 0.02;   // a start in the past is refused
            sd.politik = 1;
            l.bef->schiebe(sd);
          }
      }
      const uint64_t ring_w0 = hash_an ? cdj_lade(&l.ring->w) : 0;
      const int64_t t0 = jetzt_ns();
      l.kern->zyklus(256, t0);
      us.push_back((jetzt_ns() - t0) / 1000.0);
      ++zyk;
      if (hash_an) hash_zyklus(ring_w0);
      if (rampe_an) us_rampe.push_back(us.back());
      if (a32) {   // nach der Messung des Zyklus: hat er einen Solo-Verlauf getragen (Wert am Blockende ≠ Wert davor)?
        const float so = l.kern->arrangement().wert(2, 3);
        if ((so >= 0.5f) != (solo_vorher >= 0.5f)) {
          ++solo_schaltungen;
          us_solo.push_back(us.back());
        }
        solo_vorher = so;
      }
      if (std::getenv("KOSTEN_SPUR") && us.back() > 1000.0)   // Diagnose: langsame Zyklen mit Lage im Projekt
        std::fprintf(stderr, "langsam: Zyklus %d, %.0f µs, Kern-Beat %.3f\n", i, us.back(),
                     l.kern->karte().beat_at((double)l.kern->sample()));
      leeren();
      pace();
    }
    if (hash_an) {   // before the lane self-checks: the control run (muted track) may fail them but must still print its hash
      // One line with everything ctest needs (no ordering between stdout and stderr to rely on): the Hall jobs computed on a pool worker (pool_berechnet)
      // against all Hall jobs (hall_berechnet), and the pool's own counters. 0 pool jobs = the pool was attached but never used (or there is none).
      unsigned long long pool_jobs = 0, hall_jobs = 0;
      const auto& rt_h = l.kern->arrangement().returns();
      for (int r = 0; r < cdj::ARR_RETURNS; ++r) {
        pool_jobs += rt_h.pool_berechnet(r);
        hall_jobs += rt_h.hall_berechnet(r);
      }
      std::printf("HASH lane=%s pm=%016llx out=%016llx blocks=%llu pool_jobs=%llu hall_jobs=%llu pool_spaet=%llu pool_zurueck=%llu pool_an=%d\n", lage,
                  (unsigned long long)hash_pm, (unsigned long long)hash_out, (unsigned long long)hash_bloecke, pool_jobs, hall_jobs,
                  (unsigned long long)(hall_pool ? hall_pool->spaet() : 0), (unsigned long long)(hall_pool ? hall_pool->zurueck() : 0), (int)(hall_pool && hall_pool->an()));
    }
    bericht(lage, us);
    if (r32o && !us_rampe.empty()) {
      std::sort(us_rampe.begin(), us_rampe.end());
      std::fprintf(stderr, "arr32r_oeffnen: ramp blocks %zu, median %.1f us, p99 %.1f us, max %.1f us\n", us_rampe.size(), us_rampe[us_rampe.size() / 2],
                   us_rampe[std::min(us_rampe.size() - 1, (size_t)(0.99 * (double)us_rampe.size()))], us_rampe.back());
    }
    if (ret_lage) {
      const auto& rt = l.kern->arrangement().returns();
      std::fprintf(stderr, "%s: Hall awake %d %d %d %d, setze %llu, max per block %llu, NaN %llu, schlaf_bloecke=%llu\n", lage, (int)rt.wach(0), (int)rt.wach(1), (int)rt.wach(2), (int)rt.wach(3),
                   (unsigned long long)rt.setze_gesamt(), (unsigned long long)rt.setze_max_je_block(), (unsigned long long)rt.nan_treffer(),
                   (unsigned long long)l.kern->mixer().schlaf_bloecke());
      std::fprintf(stderr, "%s: Hall pool %s, workers %d, spaet %llu, zurueck %llu, pool still on %d\n", lage, hall_pool ? "on" : "off", hall_pool ? hall_pool->faeden() : 0,
                   (unsigned long long)(hall_pool ? hall_pool->spaet() : 0), (unsigned long long)(hall_pool ? hall_pool->zurueck() : 0), (int)(hall_pool && hall_pool->an()));
      if (!rt.wach(0) || rt.setze_max_je_block() > 1 || (r32s && rt.setze_gesamt() < (unsigned long long)n / 10)) {
        std::fprintf(stderr, "kosten_arr: Lage %s: the Halls did not run or setze did not run often enough, it does not measure what it should\n", lage);
        return 2;
      }
    }
    if (ins_lage) {   // slice 4a self-check: all 12 chains are in the loaded file, and the stages run (ins) or do not (ins_aus)
      const cdj::ArrSnapshot* sn = l.kern->arrangement().snapshot();
      int stufen = 0, lief_n = 0;
      for (int i = 0; sn && i < cdj::ARR_KETTEN; ++i) stufen += sn->kette[i].n;
      float gr_max = 0.0f;
      for (int sl = 0; sl < cdj::ARR_INS_ALLE; ++sl) {   // slice 4b: the global slots of all three kinds
        lief_n += l.kern->arrangement().inserts().lief(sl);
        gr_max = std::max(gr_max, l.kern->arrangement().inserts().gr_db(sl));
      }
      const uint64_t nan = l.kern->arrangement().inserts().nan_zaehler();
      std::fprintf(stderr, "%s: stages in the snapshot chains %d (expected %d), stages computing in the last block %d (expected %d), largest gain reduction %.2f dB, NaN %llu (expected 0), schlaf_bloecke=%llu\n", lage,
                   stufen, 13 + cdj::ARR_INS_EQ + cdj::ARR_INS_LIM, lief_n, ins_erwartet, gr_max, (unsigned long long)nan, (unsigned long long)l.kern->mixer().schlaf_bloecke());
      std::fprintf(stderr, "%s: largest path latency of the delay compensation %d samples\n", lage, l.kern->arrangement().pdc_latenz());   // information for every insert lane (arr32voll asserts it below)
      if (stufen != 13 + cdj::ARR_INS_EQ + cdj::ARR_INS_LIM || lief_n != ins_erwartet || nan != 0 || (ins_an && gr_max <= 0.0f) || (ins_aus && gr_max != 0.0f)) {
        std::fprintf(stderr, "kosten_arr: Lage %s: the stage count or the stage state is not as asserted, it does not measure what it should\n", lage);
        return 2;
      }
      if (voll && std::getenv("KOSTEN_VOLL_SCHLUESSEL") != nullptr) {   // slice 5 U2b: the keys are in the snapshot, the rings run
        int keys = 0, ringe = 0, spaet = 0;
        for (int i = 0; sn && i < cdj::ARR_KETTEN; ++i)
          for (int q = 0; q < sn->kette[i].n; ++q) {
            keys += sn->kette[i].st[q].key.quelle != cdj::ARR_SCHL_KEINE;
            ringe += sn->kette[i].st[q].schl_verz > 0;
            spaet += sn->kette[i].st[q].schl_spaet > 0;
          }
        int hoert = 0, laeuft = 0;   // the running core, last block: stages listening to a structural key, stages whose key goes through a ring
        for (int sl = 0; sl < cdj::ARR_INS_KOMP; ++sl) {
          hoert += l.kern->arrangement().inserts().strukturell(sl);
          laeuft += l.kern->arrangement().inserts().strukturell(sl) && l.kern->arrangement().inserts().schluessel_verzug(sl) > 0;
        }
        std::fprintf(stderr, "%s: structural keys in the snapshot %d (expected 10), of them with a key ring %d (expected 3), late %d (expected 2); in the last block %d stages listen to a structural key (expected 10), %d of them through a ring (expected 3)\n", lage, keys, ringe, spaet, hoert, laeuft);
        if (keys != 10 || ringe != 3 || spaet != 2 || hoert != 10 || laeuft != 3) {
          std::fprintf(stderr, "kosten_arr: Lage %s: the keys or the key rings are not as asserted, it does not measure what it should\n", lage);
          return 2;
        }
      }
      if (voll) {   // 1.10 slices 5 to 8, U0: four racks with 16 mappings, every mapped parameter driven by its macro, the compensation active over a track AND a group
        const bool ohne_racks = std::getenv("KOSTEN_VOLL_OHNE_RACKS") != nullptr;
        int racks = 0, ziele = 0, getrieben = 0, wert_ok = 0, wert_soll = 0;
        for (int i = 0; sn && i < cdj::ARR_KETTEN; ++i)
          if (sn->rack[i].slot >= 0 && sn->rack[i].n > 0) {
            ++racks;
            ziele += sn->rack[i].n;
            for (int q = 0; q < sn->rack[i].n; ++q) {
              const cdj::ArrMakroZiel& z = sn->rack[i].z[q];
              const int g = cdj::ins_global(sn->kette[i].st[z.stufe].art, sn->kette[i].st[z.stufe].slot);
              const float soll = z.von + VOLL_MAKRO[z.makro] * (z.bis - z.von);
              ++wert_soll;
              const float ist = l.kern->arrangement().inserts().wirksam(g, z.param);
              if (g >= 0 && std::fabs(ist - soll) <= 1e-3f * std::max(1.0f, std::fabs(soll))) ++wert_ok;
              else if (std::getenv("KOSTEN_SPUR")) std::fprintf(stderr, "  mapping strip %d stage %d param %d: wanted %.4f got %.4f\n", i, z.stufe, z.param, (double)soll, (double)ist);
            }
          }
        for (int sl = 0; sl < cdj::ARR_INS_ALLE; ++sl)
          for (int q = 0; q < cdj::INS_PARAM_MAX; ++q) getrieben += l.kern->arrangement().inserts().makro_treibt(sl, q);
        const int pdc = l.kern->arrangement().pdc_latenz();
        const int pdc_soll = l.kern->arrangement().inserts().latenz(cdj::ins_global(cdj::ArrInsArt::eq, 0)) + l.kern->arrangement().inserts().latenz(cdj::ins_global(cdj::ArrInsArt::saett, 0)) +
                             l.kern->arrangement().inserts().latenz(cdj::ins_global(cdj::ArrInsArt::lim, 0));   // the master limiter on the PM sits on every path
        std::fprintf(stderr, "%s: racks %d (expected 4), mappings in the snapshot %d (expected 64), parameters driven by a macro %d (expected 64), driven values equal von + m * (bis - von): %d of %d, "
                     "largest path latency %d samples (expected eq + saett + lim = %d, non-zero)\n", lage, racks, ziele, getrieben, wert_ok, wert_soll, pdc, pdc_soll);
        if (racks != 4 || ziele != 64 || getrieben != 64 || wert_ok != 64 || pdc <= 0 || pdc != pdc_soll) {
          std::fprintf(stderr, "kosten_arr: Lage %s: the racks, the mappings or the delay compensation are not as asserted%s, it does not measure what it should\n", lage, ohne_racks ? " (KOSTEN_VOLL_OHNE_RACKS)" : "");
          return 2;
        }
      }
    }
    if (a32) {
      int klingen = 0;
      for (int sp = 1; sp <= 32; ++sp) {
        if (spitze_db[sp] > -120.0f) ++klingen;
        else std::fprintf(stderr, "kosten_arr: arr32 Spur %d klingt nicht (Spitze %.1f dB)\n", sp, spitze_db[sp]);
      }
      int zuletzt = 0;
      for (int sp = 1; sp <= 32; ++sp) zuletzt += zuletzt_db[sp] > -120.0f;
      std::fprintf(stderr, "arr32: Quittungen je Status 1..7: %llu %llu %llu %llu %llu %llu %llu (6 = abgelehnt)\n",
                   (unsigned long long)quittung_status[1], (unsigned long long)quittung_status[2],
                   (unsigned long long)quittung_status[3], (unsigned long long)quittung_status[4],
                   (unsigned long long)quittung_status[5], (unsigned long long)quittung_status[6],
                   (unsigned long long)quittung_status[7]);
      const bool solo_ein = std::getenv("KOSTEN_ARR32_SOLO_EIN") != nullptr;
      const double ende_beat = l.kern->karte().beat_at((double)l.kern->sample());
      // Alle 32 Fader müssen am Ende MITTEN in der Rampe stehen: linear von 0 dB (Beat 24) zum Ziel (−3 − sp%4 dB) über 240
      // Beats. Wer nur "unter 0 dB" prüft, übersieht eine zu kurze Rampe (schon am Ziel) und eine fehlende (kostet ~46 µs).
      int fader_mit_verlauf = 0;
      for (int sp = 1; sp <= 32 && ohne_rampen; ++sp) {   // fest / lane / lanet: the base value of every fader is still 0 dB (a lane never writes into it)
        const float ist = l.kern->arrangement().wert(sp - 1, 0);
        // arr32ueber: an overridden fader keeps the value the lane had at the grip (the hand course starts there): inside the lane range (0 down to -7 dB) and not 0
        const bool gegriffen = ueber && sp <= 4;
        const bool hand_fader = armgriff && sp <= 4;   // arr32armgriff: the hand drives the base value of faders 1..4 (any value), the level must still be under 0 dB
        if ((hand_fader || (gegriffen ? (ist < -0.001f && ist > -7.0f) : std::fabs(ist) <= 1e-6f)) && zuletzt_db[sp] < 0.0f) ++fader_mit_verlauf;   // and the level of the track is under 0 dB
        else std::fprintf(stderr, "kosten_arr: %s Spur %d: Grundwert %.4f dB, letzter Pegel %.1f dB\n", lage, sp, ist, zuletzt_db[sp]);
      }
      if (lane || lanet) {
        const cdj::ArrSnapshot* sn = l.kern->arrangement().snapshot();
        const int nl = sn ? sn->n_auto_lanes : -1;
        std::fprintf(stderr, "%s: Lanes im Snapshot %d (erwartet 32), Segmente der Tempokarte am Ende %d\n", lage, nl, l.kern->karte().anzahl());
        if (nl != 32) fader_mit_verlauf = -1;
      }
      if (aut || aut_solo || mod) {   // slice 3: how many of the 4 x 32 fields the Arrangement reports as overridden (arr32ueber: exactly the 8 set above, arr32auto and arr32solo: none)
        int ueber_n = 0, ueber_richtig = 0;
        for (int sp = 0; sp < 32; ++sp)
          for (int f = 0; f < 4; ++f)
            if (l.kern->arrangement().auto_uebersteuert(sp, f)) { ++ueber_n; ueber_richtig += ueber && ((sp < 4 && f == 0) || (sp >= 4 && sp < 8 && f == 1)); }
        std::fprintf(stderr, "%s: overridden fields %d (expected %d)\n", lage, ueber_n, ueber ? 8 : 0);
        if (!armgriff && (ueber_n != (ueber ? 8 : 0) || (ueber && ueber_richtig != 8))) fader_mit_verlauf = -1;   // armgriff: the 4 gripped faders are overridden by design
        if (armiert) {   // wave B: arm took effect (still 32 armed at the end); idle arm reports no point, the grips of armgriff must have emitted some
          int n_arm = 0;
          for (int k = 1; k <= 32; ++k) n_arm += l.kern->auto_arm(k) == 1;
          std::fprintf(stderr, "%s: armed tracks at the end %d (expected 32), AUTO_PUNKT events %llu (%s)\n", lage, n_arm, (unsigned long long)auto_punkte, armgriff ? "expected > 0" : "expected 0");
          if (n_arm != 32 || (armgriff ? auto_punkte == 0 : auto_punkte != 0)) fader_mit_verlauf = -1;
        }
      }
      if (aut || aut_solo || mod) {   // 32 fader + 32 pan + 8 cutoff (+ 4 solo) (+ 32 relative fader lanes)
        const cdj::ArrSnapshot* sn = l.kern->arrangement().snapshot();
        const int nl = sn ? sn->n_auto_lanes : -1, soll_l = mod ? 104 : aut ? 72 : 76;
        std::fprintf(stderr, "%s: Lanes im Snapshot %d (erwartet %d)\n", lage, nl, soll_l);
        if (nl != soll_l) fader_mit_verlauf = -1;
      }
      if (mod || aut) {   // U9: the relative lanes are in the snapshot (32 for arr32mod, none for arr32auto) and the stack really plays them: the abs lane alone never goes below -6.03 dB
                          // (triangle 0 .. -6), the stack with the relative lane (-10 .. -14) is always below -9.9 dB: the last played value of every fader tells which of the two ran
        const cdj::ArrSnapshot* sn = l.kern->arrangement().snapshot();
        int n_rel = 0;
        for (int sp = 0; sn && sp < 32; ++sp)
          for (int k = 0; k < sn->spur[sp].n_auto; ++k) n_rel += sn->spur[sp].auto_lanes[k].relativ ? 1 : 0;
        int tief = 0;
        for (int sp = 0; sp < 32; ++sp) tief += l.kern->arrangement().auto_letzter_wert(sp, 0) < -9.9f ? 1 : 0;
        std::fprintf(stderr, "%s: relative lanes %d (expected %d), faders whose last played value is below -9.9 dB: %d (expected %d)\n", lage, n_rel, mod ? 32 : 0, tief, mod ? 32 : 0);
        if (n_rel != (mod ? 32 : 0) || tief != (mod ? 32 : 0)) fader_mit_verlauf = -1;
      }
      if (hk || hk32 || fest32 || fest) {   // U8b: the voices that carry a clip envelope really run it (negative control: arr32fest and arr32fest32 carry none)
        const int soll_hk = hk ? 8 : hk32 ? 32 : 0;
        const int h_an = cdj::ArrPruefZugang::hk_stimmen(l.kern->arrangement()), h_lauf = cdj::ArrPruefZugang::hk_laufen(l.kern->arrangement());
        std::fprintf(stderr, "%s: voices with a clip envelope %d, with a running factor %d (expected %d)\n", lage, h_an, h_lauf, soll_hk);
        if (h_an != soll_hk || h_lauf != soll_hk) fader_mit_verlauf = -1;
      }
      if (aut_pan || aut_cut || aut_steil) {   // 32 pan lanes, 8 cutoff lanes, 64 steep lanes
        const cdj::ArrSnapshot* sn = l.kern->arrangement().snapshot();
        const int nl = sn ? sn->n_auto_lanes : -1, soll_l = aut_pan ? 32 : aut_steil ? 64 : 8;
        std::fprintf(stderr, "%s: Lanes im Snapshot %d (erwartet %d)\n", lage, nl, soll_l);
        if (nl != soll_l) fader_mit_verlauf = -1;
      }
      {   // positive proof that the device lanes really reached the sink: auto_parameter values reported, not only "rejected 0". Expected: the layouts with a cutoff lane
          // report at least one value per running block and lane (8 lanes), the layouts without one report none (negative control in the same binary).
        const uint64_t gemeldet = l.kern->arr_rb().parameter_gemeldet();
        const bool soll_cutoff = aut || aut_solo || aut_cut || mod;
        const uint64_t mindest = soll_cutoff ? 8ull * static_cast<uint64_t>(n) / 2 : 0;
        std::fprintf(stderr, "%s: auto_parameter gemeldet %llu (%s)\n", lage, (unsigned long long)gemeldet, soll_cutoff ? "erwartet mindestens ein Wert je Block und Lane" : "erwartet 0, keine Geraete-Lane");
        if (soll_cutoff ? gemeldet < mindest : gemeldet != 0) fader_mit_verlauf = -1;
      }
      for (int sp = 1; sp <= 32 && !ohne_rampen; ++sp) {
        const float ist = l.kern->arrangement().wert(sp - 1, 0);
        const float ziel = -3.0f - (float)(sp % 4);
        const float soll = ziel * (float)std::min(1.0, std::max(0.0, (ende_beat - 24.0) / 240.0));
        if (ist < -0.001f && std::fabs(ist - soll) <= 0.15f) ++fader_mit_verlauf;
        else std::fprintf(stderr, "kosten_arr: arr32 Fader Spur %d nicht mitten in der Rampe (%.2f dB, erwartet %.2f dB)\n", sp, ist, soll);
      }
      // Notendichte: jede Spur muss in den meisten Pegel-Meldungen klingen (RB-Spuren: 128 Noten je 32 Beats, Audio: Dauerton).
      // Die Spitze allein (> -120 dB irgendwann) genügt nicht: eine einzige Note je Schleife erfüllt sie auch.
      double anteil_min = 1.0;
      int anteil_spur = 0;
      int kit_klingen = 0;
      for (int sp = 1; sp <= 32; ++sp) {
        if ((kitl || rackl) && sp <= 8) {   // one-shots of 2 to 10 ms every sixteenth: no dense level, but every kit track must sound in some level messages
          kit_klingen += klang_n[sp] > 0;
          continue;
        }
        const double a = meld_n[sp] ? (double)klang_n[sp] / (double)meld_n[sp] : 0.0;
        if (a < anteil_min) { anteil_min = a; anteil_spur = sp; }
      }
      const bool dicht = solo_ein || anteil_min >= KLANG_ANTEIL_MIN;   // SOLO_EIN: absichtlich fast alles stumm
      if (!dicht)
        std::fprintf(stderr, "kosten_arr: arr32 Spur %d klingt nur in %.1f %% der Pegel-Meldungen (verlangt %.0f %%)\n", anteil_spur,
                     100.0 * anteil_min, 100.0 * KLANG_ANTEIL_MIN);
      uint64_t solo_soll = 0;   // Schaltungen, die mit einem Beat Abstand zum Fensterende fällig waren; ein Paar sind zwei
      for (int k = 0; k < 57; ++k) {
        if (24.0 + 4.0 * k <= ende_beat - 1.0 && (!solo_ein || k == 0)) ++solo_soll;
        if (24.0 + 4.0 * k + 0.25 <= ende_beat - 1.0 && !solo_ein) ++solo_soll;
      }
      const double med_solo = us_solo.empty() ? 0.0 : (std::sort(us_solo.begin(), us_solo.end()), us_solo[us_solo.size() / 2]);
      std::fprintf(stderr, "arr32: klingende Spuren %d von 32 (in der letzten Meldung %d, Spur 3: %.1f dB), Fader mit Verlauf %d von 32\n",
                   klingen, zuletzt, zuletzt_db[3], fader_mit_verlauf);
      std::fprintf(stderr, "arr32: kleinster Klang-Anteil der Pegel-Meldungen %.1f %% (Spur %d)\n", 100.0 * anteil_min, anteil_spur);
      std::fprintf(stderr, "arr32: Solo-Schaltblöcke %llu von %d Zyklen (erwartet mindestens %llu), Median dieser Blöcke %.1f µs, Maximum %.1f µs\n",
                   (unsigned long long)solo_schaltungen, n, (unsigned long long)solo_soll, med_solo,
                   us_solo.empty() ? 0.0 : us_solo.back());
      if (kitl) {   // self-check of arr32kit: 8 kit tracks sound, the kit sink really started their notes (4 per beat and track) and dropped none
        const double beats = static_cast<double>(l.kern->sample()) / 22500.0;
        const uint64_t soll = static_cast<uint64_t>(0.9 * 8.0 * 4.0 * (beats - 1.0));
        std::fprintf(stderr, "arr32kit: kit tracks sounding %d of 8, kit sink: tracks %d, note starts %llu (expected at least %llu), lost %llu\n", kit_klingen,
                     l.kern->arr_kit().spielend(), (unsigned long long)l.kern->arr_kit().einsaetze(), (unsigned long long)soll,
                     (unsigned long long)l.kern->arr_kit().verloren());
        if (kit_klingen != 8 || l.kern->arr_kit().spielend() != 8 || l.kern->arr_kit().einsaetze() < soll || l.kern->arr_kit().verloren() != 0) {
          std::fprintf(stderr, "kosten_arr: Lage arr32kit: the kit tracks do not play, it does not measure what it should\n");
          return 2;
        }
      } else if (rackl) {   // self-check of arr32rack: 8 racks of 4 members, every member got its notes (4 per beat), the kit members started voices, nothing lost
        const double beats = static_cast<double>(l.kern->sample()) / 22500.0;
        const uint64_t soll_an = static_cast<uint64_t>(0.9 * 4.0 * (beats - 1.0));
        int glieder_ok = 0, an_ok = 0;
        for (int sp = 1; sp <= 8; ++sp) glieder_ok += l.kern->arr_rack().glieder(sp - 1) == 4;
        for (int g = 0; g < 32; ++g) an_ok += l.kern->arr_rack().an(cdj::ARR_SPUREN + g) >= soll_an;
        const uint64_t soll_kit = static_cast<uint64_t>(0.9 * 8.0 * 1.0 * 4.0 * (beats - 1.0));
        std::fprintf(stderr, "arr32rack: rack tracks sounding %d of 8, racks with 4 members %d of 8, members that got at least %llu note ons %d of 32, kit voices %llu (expected at least %llu), lost: rack %llu, RB-338 %llu, kit %llu\n",
                     kit_klingen, glieder_ok, (unsigned long long)soll_an, an_ok, (unsigned long long)l.kern->arr_kit().einsaetze(), (unsigned long long)soll_kit,
                     (unsigned long long)l.kern->arr_rack().verloren(), (unsigned long long)l.kern->arr_rb().verloren(), (unsigned long long)l.kern->arr_kit().verloren());
        if (kit_klingen != 8 || glieder_ok != 8 || an_ok != 32 || l.kern->arr_kit().einsaetze() < soll_kit || l.kern->arr_rack().verloren() != 0 ||
            l.kern->arr_rb().verloren() != 0 || l.kern->arr_kit().verloren() != 0) {
          std::fprintf(stderr, "kosten_arr: Lage arr32rack: the racks do not play, it does not measure what it should\n");
          return 2;
        }
      } else if (l.kern->arr_kit().einsaetze() != 0) {   // negative control: no other lane starts a kit voice
        std::fprintf(stderr, "kosten_arr: Lage %s: the kit sink started %llu voices without a kit track\n", lage, (unsigned long long)l.kern->arr_kit().einsaetze());
        return 2;
      }
      if (!rackl) {   // negative control: no other lane routes a note to a rack member
        uint64_t rack_an = 0;
        for (int g = 0; g < cdj::ARR_GLIED_PLAETZE; ++g) rack_an += l.kern->arr_rack().an(cdj::ARR_SPUREN + g);
        if (rack_an != 0) {
          std::fprintf(stderr, "kosten_arr: Lage %s: the rack sink routed %llu notes without a rack track\n", lage, (unsigned long long)rack_an);
          return 2;
        }
      }
      if (g32 && (l.kern->arrangement().wert(cdj::ARR_SPUREN + 0, 0) >= -0.001f || l.kern->arrangement().wert(cdj::ARR_PM, 0) >= -0.001f)) {
        std::fprintf(stderr, "kosten_arr: arr32g: Gruppen-/PM-Rampe läuft nicht\n");   // Selbstprüfung 1.10: Gruppe 1 und PM müssen mitten in der Rampe stehen
        return 2;
      }
      if (klingen != 32 || !dicht || fader_mit_verlauf != 32 || quittung_status[6] != 0 || solo_schaltungen < solo_soll || solo_schaltungen > (solo_ein ? 1u : 114u)) {
        std::fprintf(stderr, "kosten_arr: Lage arr32 hat weniger als 32 klingende Spuren, nicht an allen Fadern eine laufende Rampe, zu dünne Noten, abgelehnte Teile oder zu wenige Solo-Schaltungen, sie misst nicht, was sie soll\n");
        return 2;
      }
    }
    if (hand) {
      std::fprintf(stderr, "%s: Halter mensch %llu, frei %llu, Hand-Ereignisse %llu\n", lage, (unsigned long long)halter_mensch,
                   (unsigned long long)halter_frei, (unsigned long long)hand_ereignisse);
      if (halter_mensch == 0 || (nur_rueck && halter_frei == 0)) {
        std::fprintf(stderr, "kosten_arr: Lage hand ohne Menschenhand bzw. ohne Rückgabe, sie misst den Rueck-Pfad nicht\n");
        return 2;
      }
    }
    if (eigene)
      std::fprintf(stderr, "%s: RB-338 verloren %llu, Parameter abgelehnt %llu\n", lage,
                   (unsigned long long)l.kern->arr_rb().verloren(), (unsigned long long)l.kern->arr_rb().parameter_abgelehnt());
    else
      std::fprintf(stderr, "%s: Noten intern %llu, Wirt %llu\n", lage, (unsigned long long)intern.n, (unsigned long long)wirt.n);
  }
  return 0;
}
