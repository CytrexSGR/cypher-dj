// Sleep state of silent channel strips (Mixer::setze_schlaf, schlaf_schritt in mixer.cpp). Every test runs two identical mixers in
// lockstep, one with sleeping (default) and one with setze_schlaf(false), and compares the whole record with memcmp (no tolerance): master
// sum, cue, send sums fx/1..4, the peak hold of the strips (/pegel) and the gain-reduction meters.
//  (1) schlaf_bitgleich: 18 strips, 2 fed with a sine (one to the master, one to bus/1, which has a delay and a send into the hall), 16
//      silent, 3000 blocks: bit-equal, schlaf_bloecke() > 0, the reference never sleeps
//  (2) schlaf_echo_impuls: colour echo, a 10 ms impulse, the knob back to the middle, 125 bpm: the strip does not sleep while the echo
//      still sounds (the tail is longer than a block), bit-equal, sleeps eventually
//  (3) schlaf_regler: a sleeping strip gets EQ, fader, trim, send, kill and DJ-filter moves by setze_sofort (no Bahn runs: it may sleep on
//      and must sound right afterwards), then a colour move with NOISE out of its dead zone (awake in each of those blocks, it makes
//      noise), a compressor switch (awake), then a sine: bit-equal
//  (4) schlaf_wecken_mitte: the input arrives in the middle of a block: the whole block is computed, bit-equal
//  (5) schlaf_abgriff: PFL and spectrum of a sleeping strip read exact zeros (the tap buffer and the analyser are compared as well)
//  (6) schlaf_beatfx: a BeatFx echo on the strip (post fader and insert), input stops after an impulse: awake while it sounds, bit-equal
//  (7) schlaf_regler_verlauf: every knob moved by a per-sample course (Mixer::verlauf, the production path, starts a Bahn): awake in the
//      block of the move, bit-equal, asleep again afterwards. Also colour (all arts, out of the dead zone), PFL and target courses
//  (8) schlaf_holder_ziel: target course and open target crossfade (ziel_[k].vl, blende_rest_) keep the strip awake
//  (9) schlaf_holder_limiter: bus limiter switched on and off by course with a bus delay, the bus asleep in between
//  (10) schlaf_holder_beatfx: BeatFx echo with its input open, impulse, long silence, then a sine: the unit keeps the strip awake
//  (11) schlaf_grenzfaelle: varying block lengths, an input of -0.0f, NaN and Inf into a sleeping strip (the NaN guard reacts the same)
//  (12) schlaf_holder_gate_util_mb_bk: gate, utility, multiband and a graph on a strip that sleeps already: each switched on wakes it
//      (not asleep in any block while the holder is on), bit-equal, asleep again after it is switched off; the graph sounds from zero input
//  (13) schlaf_holder_bus_ring: a bus that was never fed, with a long delay, gets one block of NOISE colour (knob by setze_sofort, then back): the
//      noise sits in the delay ring while the output, the tap and every filter state are exactly zero. The ring check keeps the bus awake: bit-equal
//  Tests 9 and 10 compare block by block (the record is cleared after each comparison), so they stay linear.
// Mutation CYPHERDJ_MUTATION_SCHLAF_OHNE_RUHIG (no ruhig() / holder checks) must turn (2) or (3) red.
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[1024], mr[1024], cl[1024], cr[1024];
  std::vector<float> ausgabe;   // everything a test can read, per block
  int block_nr = 0;
  std::vector<std::vector<float>> verlaeufe;   // course buffers, alive until the block has run
  explicit Lauf(bool schlaf) : m(std::make_unique<cdj::Mixer>(tab)) {
    m->setze_schlaf(schlaf);
    m->fx_takt(0.0, 125.0 / 60.0 / 48000.0);
  }
  void setze(const char* pfad, float w) { m->setze_sofort(tab.suche(pfad), w); }
  // per-sample course of a knob over this block (the production path, Mixer::verlauf: starts a Bahn / sets a slot course)
  void verl(const char* pfad, float von, float bis) {
    verlaeufe.emplace_back(N);
    for (int i = 0; i < N; ++i) verlaeufe.back()[i] = von + (bis - von) * static_cast<float>(i) / (N - 1);
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->verlauf(r, verlaeufe.back().data());
  }
  void sinus(int k, int von = 0, float amp = 0.5f) {
    for (int i = von; i < N; ++i) {
      const float v = amp * static_cast<float>(std::sin(2.0 * PI * 440.0 * (block_nr * N + i) / 48000.0));
      m->eingang_l(k)[i] = v;
      m->eingang_r(k)[i] = 0.8f * v;
    }
  }
  void impuls(int k, int laenge, int ab) {   // DC step of `laenge` samples from sample `ab` of the whole run
    for (int i = 0; i < N; ++i) {
      const int t = block_nr * N + i;
      const float v = (t >= ab && t < ab + laenge) ? 0.5f : 0.0f;
      m->eingang_l(k)[i] = v;
      m->eingang_r(k)[i] = v;
    }
  }
  // runs the block with the inputs the caller has put in, then records every readable output
  void lauf() { lauf_n(N); }
  void lauf_n(int n) {
    m->verarbeite(n, ml, mr, cl, cr);
    auto an = [&](const float* p) { ausgabe.insert(ausgabe.end(), p, p + n); };
    an(ml); an(mr); an(cl); an(cr);
    an(m->master_summe_l()); an(m->master_summe_r());
    for (int s = 0; s < 4; ++s) { an(m->fx_l(s)); an(m->fx_r(s)); }
    for (int k = 0; k < 14; ++k) {
      ausgabe.push_back(m->spitze_lesen(k));
      ausgabe.push_back(m->komp_gr_db(k));
    }
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) {   // the taps as the readers see them, and the targets
      an(m->kanalzug(k).abgriff(0));
      ausgabe.push_back(static_cast<float>(m->ziel_ist(k)));
    }
    verlaeufe.clear();
    ++block_nr;
  }
  bool nicht_null_master() const {
    for (int i = 0; i < N; ++i)
      if (ml[i] != 0.0f || mr[i] != 0.0f) return true;
    return false;
  }
};

static bool gleich(const Lauf& a, const Lauf& b) {
  return a.ausgabe.size() == b.ausgabe.size() &&
         std::memcmp(a.ausgabe.data(), b.ausgabe.data(), sizeof(float) * a.ausgabe.size()) == 0;
}

static void beide(Lauf& a, Lauf& b, const char* pfad, float w) { a.setze(pfad, w); b.setze(pfad, w); }
static void beide_verl(Lauf& a, Lauf& b, const char* pfad, float von, float bis) { a.verl(pfad, von, bis); b.verl(pfad, von, bis); }

int main() {
  // (1) schlaf_bitgleich, without and with the bus delay (a bus owns a delay ring then)
  for (int latenz : {0, 480}) {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->m->setze_kanal_latenz(latenz);
      l->setze("erz/1/fader", 0.0f);
      l->setze("erz/2/fader", 0.0f);
      l->setze("erz/1/send/2", -6.0f);   // into the hall
      l->setze("erz/2/ziel", 1.0f);      // erz/2 goes to bus/1
      l->setze("bus/1/fader", 0.0f);
    }
    for (int k = 0; k < 3000; ++k) {
      for (Lauf* l : {&a, &b}) {
        if (k < 400) { l->sinus(4); l->sinus(5, 0, 0.3f); }   // then silence: after ~2100 blocks (the 20 Hz high-pass of the DJ filter) the sources and the bus fall asleep
        l->lauf();
      }
    }
    PRUEF(gleich(a, b));
    PRUEF(a.m->schlaf_bloecke() > 0);
    PRUEF(b.m->schlaf_bloecke() == 0);
    int schlaefer = 0;
    for (int k = 0; k < 18; ++k) schlaefer += a.m->schlaeft(k);
    PRUEF(schlaefer == 18);   // 16 silent from the start, the two fed ones and the bus once their filters have run out
    bool nicht_null = false;
    for (float v : a.ausgabe) nicht_null = nicht_null || v != 0.0f;
    PRUEF(nicht_null);   // positive control: there was sound
  }

  // (2) schlaf_echo_impuls
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("color/art", 2.0f);     // DUB ECHO
      l->setze("color/param", 0.0f);   // feedback 0.35
      l->setze("erz/3/fader", 0.0f);
      l->setze("erz/3/filter", 0.6f);  // knob out of the dead zone: the echo takes the input
    }
    int klingt = 0, geschlafen_bei_klang = 0;
    bool schlief_je = false;
    for (int k = 0; k < 2500; ++k) {
      if (k == 4) beide(a, b, "erz/3/filter", 0.0f);   // the knob back to the middle: the tail runs out
      for (Lauf* l : {&a, &b}) {
        l->impuls(6, 480, 0);   // 10 ms
        l->lauf();
      }
      if (b.nicht_null_master()) {
        ++klingt;
        if (a.m->schlaeft(6)) ++geschlafen_bei_klang;
      }
      schlief_je = schlief_je || a.m->schlaeft(6);
    }
    PRUEF(gleich(a, b));
    PRUEF(klingt > 50);   // positive control: the tail is much longer than one block
    PRUEF(geschlafen_bei_klang == 0);
    PRUEF(schlief_je);
    PRUEF(a.m->schlaeft(6));
    PRUEF(a.m->schlaf_bloecke() > 0);
  }

  // (3) schlaf_regler
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) l->setze("erz/3/fader", 0.0f);
    auto bloecke = [&](int anzahl, bool sine) {
      for (int k = 0; k < anzahl; ++k) {
        for (Lauf* l : {&a, &b}) {
          if (sine) l->sinus(6);
          l->lauf();
        }
      }
    };
    bloecke(300, false);
    PRUEF(a.m->schlaeft(6));                         // asleep before the moves
    // moves that leave nothing running on a silent strip: the strip may sleep on, and must sound right afterwards
    beide(a, b, "erz/3/eq/tief", 6.0f);
    bloecke(20, false);
    beide(a, b, "erz/3/fader", -6.0f);
    bloecke(20, false);
    beide(a, b, "erz/3/trim", 6.0f);
    beide(a, b, "erz/3/send/2", 0.0f);
    bloecke(20, false);
    beide(a, b, "erz/3/kill/mitte", 1.0f);
    bloecke(20, false);
    beide(a, b, "erz/3/kill/mitte", 0.0f);
    beide(a, b, "erz/3/filter", -0.5f);              // DJ filter (art FILTER) low-pass side
    bloecke(20, false);
    beide(a, b, "erz/3/filter", 0.0f);
    bloecke(20, false);
    // colour move: NOISE out of its dead zone makes sound from zero input, the strip must be awake and sound like the reference
    beide(a, b, "color/art", 4.0f);
    beide(a, b, "color/param", 1.0f);
    beide(a, b, "erz/3/filter", 0.8f);
    bool laut = false;
    for (int k = 0; k < 60; ++k) {
      for (Lauf* l : {&a, &b}) l->lauf();
      PRUEF(!a.m->schlaeft(6));
      laut = laut || b.nicht_null_master();
    }
    PRUEF(laut);   // positive control: noise came out
    beide(a, b, "erz/3/filter", 0.0f);
    bloecke(50, false);
    PRUEF(a.m->schlaeft(6));                         // the noise stopped, the strip sleeps again
    beide(a, b, "erz/3/komp/an", 1.0f);               // a compressor switch
    bloecke(10, false);
    PRUEF(!a.m->schlaeft(6));
    bloecke(100, true);                               // then a sine
    PRUEF(gleich(a, b));
    PRUEF(a.m->schlaf_bloecke() > 0);
  }

  // (4) schlaf_wecken_mitte
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("erz/3/fader", 0.0f);
      l->setze("erz/3/eq/hoch", -3.0f);
    }
    for (int k = 0; k < 300; ++k) {
      for (Lauf* l : {&a, &b}) {
        if (k == 250) l->sinus(6, N / 3);   // the input starts in the middle of the block
        l->lauf();
      }
      if (k == 249) PRUEF(a.m->schlaeft(6));
      if (k == 250) PRUEF(!a.m->schlaeft(6));
    }
    PRUEF(gleich(a, b));
    bool laut = false;
    for (float v : b.ausgabe) laut = laut || v != 0.0f;
    PRUEF(laut);
  }

  // (5) schlaf_abgriff: deck/1 (strip 0) with PFL and the spectrum tap, sine for 50 blocks, then silence
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("deck/1/fader", 0.0f);
      l->setze("deck/1/pfl", 1.0f);
      l->setze("spektrum/kanal", 1.0f);   // strip 0 + 1
    }
    bool analyse_gleich = true, abgriff_null = true, cue_null = true;
    int schlief = 0;
    constexpr int BL5 = 2800;   // the 20 Hz high-pass of the DJ filter needs about 2100 blocks (11 s) to run below the floor
    for (int k = 0; k < BL5; ++k) {
      for (Lauf* l : {&a, &b}) {
        if (k < 50) l->sinus(0);
        l->lauf();
      }
      if (k % 8 == 7) {
        a.m->spektrum().analysiere();
        b.m->spektrum().analysiere();
        const int nb = a.m->spektrum().anzahl_baender();
        analyse_gleich = analyse_gleich &&
            std::memcmp(a.m->spektrum().pegel_db(), b.m->spektrum().pegel_db(), sizeof(float) * nb) == 0 &&
            std::memcmp(a.m->spektrum().spitze_db(), b.m->spektrum().spitze_db(), sizeof(float) * nb) == 0;
      }
      if (a.m->schlaeft(0)) {
        ++schlief;
        for (int i = 0; i < N; ++i) {
          abgriff_null = abgriff_null && a.m->kanalzug(0).abgriff(0)[i] == 0.0f && a.m->kanalzug(0).abgriff(1)[i] == 0.0f;
          cue_null = cue_null && a.cl[i] == 0.0f && a.cr[i] == 0.0f;
        }
      }
    }
    PRUEF(gleich(a, b));
    PRUEF(analyse_gleich);
    PRUEF(schlief > 100);
    PRUEF(abgriff_null);
    PRUEF(cue_null);
    bool cue_hatte_ton = false;   // positive control: PFL carried sound while the sine ran (cue left is at 2*N in the record of a block)
    const size_t je_block = a.ausgabe.size() / BL5;
    for (int k = 0; k < 50; ++k)
      for (int i = 0; i < N; ++i) cue_hatte_ton = cue_hatte_ton || a.ausgabe[static_cast<size_t>(k) * je_block + 2 * N + i] != 0.0f;
    PRUEF(cue_hatte_ton);
  }
  // (6) schlaf_beatfx: a strip with a BeatFx echo (insert and post fader) whose input stops after an impulse: it does not sleep while
  // the unit sounds (klingt), bit-equal, and sleeps once the unit is out
  for (int routing : {0, 1}) {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("erz/3/fader", 0.0f);
      l->m->fx_routing_setze(routing);
      l->m->fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.5, 0.5f, 0.5f, 0.5, 0.5, true);
      l->m->fx_zuweisung_setze(0, 6, true);
    }
    int klingt_bloecke = 0, falsch = 0;
    bool schlief = false;
    for (int k = 0; k < 4000; ++k) {
      if (k == 4)
        for (Lauf* l : {&a, &b}) l->m->fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.5, 0.5f, 0.5f, 0.5, 0.5, false);   // input closed, tail rings
      for (Lauf* l : {&a, &b}) {
        l->impuls(6, 480, 0);
        l->lauf();
      }
      if (a.m->beatfx(0, 6).klingt()) {
        ++klingt_bloecke;
        falsch += a.m->schlaeft(6);
      }
      schlief = schlief || a.m->schlaeft(6);
    }
    PRUEF(gleich(a, b));
    PRUEF(klingt_bloecke > 100);
    PRUEF(falsch == 0);
    PRUEF(schlief);
  }
  // (7) schlaf_regler_verlauf: one fresh pair per knob, the strip asleep, the knob moved with a course in one block
  {
    struct Knopf { const char* pfad; float von, bis; };
    const Knopf knoepfe[] = {
        {"erz/3/trim", 0.0f, 6.0f},     {"erz/3/eq/tief", 0.0f, 6.0f},    {"erz/3/eq/mitte", 0.0f, -6.0f}, {"erz/3/eq/hoch", 0.0f, 6.0f},
        {"erz/3/fader", -10.0f, -3.0f}, {"erz/3/send/1", -10.0f, -3.0f},  {"erz/3/send/2", -10.0f, -3.0f}, {"erz/3/send/3", -10.0f, -3.0f},
        {"erz/3/send/4", -10.0f, -3.0f}, {"erz/3/kill/tief", 0.0f, 1.0f}, {"erz/3/kill/mitte", 0.0f, 1.0f}, {"erz/3/kill/hoch", 0.0f, 1.0f},
        {"erz/3/filter", 0.0f, -0.7f},  {"erz/3/filter", 0.0f, 0.7f}};
    for (const Knopf& kn : knoepfe) {
      Lauf a(true), b(false);
      for (Lauf* l : {&a, &b}) {
        l->setze("erz/3/fader", 0.0f);
        for (const char* sd : {"erz/3/send/1", "erz/3/send/2", "erz/3/send/3", "erz/3/send/4"}) l->setze(sd, -10.0f);
      }
      for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
      PRUEF(a.m->schlaeft(6));
      beide_verl(a, b, kn.pfad, kn.von, kn.bis);
      a.lauf(); b.lauf();
      if (a.m->schlaeft(6)) std::fprintf(stderr, "asleep in the block of the move: %s\n", kn.pfad);
      PRUEF(!a.m->schlaeft(6));                      // awake in the block of the move
      for (int k = 0; k < 5; ++k) { a.lauf(); b.lauf(); }
      PRUEF(a.m->schlaeft(6));                       // and asleep again afterwards (the course ended, the parked value is idle)
      for (int k = 0; k < 40; ++k) { a.sinus(6); b.sinus(6); a.lauf(); b.lauf(); }
      PRUEF(gleich(a, b));
      bool laut = false;
      for (float v : b.ausgabe) laut = laut || v != 0.0f;
      PRUEF(laut);
    }
    // colour: every art, the knob moved out of the dead zone by a course, then back; NOISE makes sound out of zero input
    for (int art = 1; art <= 5; ++art) {
      Lauf a(true), b(false);
      for (Lauf* l : {&a, &b}) {
        l->setze("erz/3/fader", 0.0f);
        l->setze("color/art", static_cast<float>(art));
        l->setze("color/param", art == 4 ? 1.0f : 0.0f);   // NOISE loud; the echo and hall tails short
      }
      for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
      PRUEF(a.m->schlaeft(6));
      beide_verl(a, b, "erz/3/filter", 0.0f, 0.8f);
      a.lauf(); b.lauf();
      PRUEF(!a.m->schlaeft(6));
      for (int k = 0; k < 30; ++k) { a.lauf(); b.lauf(); PRUEF(!a.m->schlaeft(6)); }   // the knob stays out: awake
      beide_verl(a, b, "erz/3/filter", 0.8f, 0.0f);
      for (int k = 0; k < 1500; ++k) { a.lauf(); b.lauf(); }
      PRUEF(gleich(a, b));
      if (!a.m->schlaeft(6)) std::fprintf(stderr, "colour art %d not asleep again\n", art);
      PRUEF(a.m->schlaeft(6));                       // tail out, knob in the dead zone: asleep again
      if (art == 4) {
        bool laut = false;
        for (float v : b.ausgabe) laut = laut || v != 0.0f;
        PRUEF(laut);                                 // NOISE sounded from zero input
      }
    }
    // PFL and target by course on a sleeping strip
    {
      Lauf a(true), b(false);
      for (Lauf* l : {&a, &b}) {
        l->setze("erz/3/fader", 0.0f);
        l->setze("bus/1/fader", 0.0f);
        l->setze("erz/3/send/2", -6.0f);
      }
      for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
      PRUEF(a.m->schlaeft(6));
      beide_verl(a, b, "erz/3/ziel", 0.0f, 1.0f);
      beide_verl(a, b, "erz/3/pfl", 0.0f, 1.0f);
      a.lauf(); b.lauf();
      PRUEF(!a.m->schlaeft(6));
      PRUEF(a.m->ziel_ist(6) == b.m->ziel_ist(6));
      PRUEF(a.m->ziel_ist(6) == 1);
      for (int k = 0; k < 40; ++k) { if (k >= 3) { a.sinus(6); b.sinus(6); } a.lauf(); b.lauf(); }
      PRUEF(gleich(a, b));
    }
  }

  // (8) schlaf_holder_ziel: the target changes by course; the crossfade (480 samples) is still open in the next block, which has silent
  // input; the sine comes one block later. A strip that slept in the open crossfade would start it again only at the sine.
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("erz/3/fader", 0.0f);
      l->setze("bus/1/fader", 0.0f);
    }
    for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
    PRUEF(a.m->schlaeft(6));
    beide_verl(a, b, "erz/3/ziel", 0.0f, 1.0f);
    a.lauf(); b.lauf();
    PRUEF(a.m->ziel_ist(6) == b.m->ziel_ist(6));     // the course is read in route(): a sleeping strip would not read it
    PRUEF(a.m->ziel_ist(6) == 1);
    a.lauf(); b.lauf();                              // crossfade still open (480 > 256), input silent
    PRUEF(!a.m->schlaeft(6));
    for (int k = 0; k < 40; ++k) { a.sinus(6); b.sinus(6); a.lauf(); b.lauf(); }
    PRUEF(gleich(a, b));
  }

  // (9) schlaf_holder_limiter: bus/1 with a limiter and a bus delay, fed by erz/2; the limiter is switched on and off by course while the
  // input is silent, and a sine arrives later. The bus must stay awake while its limiter runs, crossfades or warms up.
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->m->setze_kanal_limiter(5.0, true);
      l->setze("erz/2/fader", 0.0f);
      l->setze("erz/2/ziel", 1.0f);
      l->setze("bus/1/fader", 0.0f);
      l->setze("bus/1/lim/decke", -6.0f);
    }
    int diff_bei = -1;
    bool bus_schlief = false;
    for (int k = 0; k < 3700 && diff_bei < 0; ++k) {
      if (k == 100) beide_verl(a, b, "bus/1/lim/an", 0.0f, 1.0f);
      if (k == 700) beide_verl(a, b, "bus/1/lim/an", 1.0f, 0.0f);
      if (k == 3000) beide_verl(a, b, "bus/1/lim/an", 0.0f, 1.0f);
      if (k < 40 || (k >= 3500 && k < 3510)) { a.sinus(5, 0, 0.9f); b.sinus(5, 0, 0.9f); }
      a.lauf(); b.lauf();
      bus_schlief = bus_schlief || a.m->schlaeft(14);
      if (!gleich(a, b)) diff_bei = k;
      a.ausgabe.clear();
      b.ausgabe.clear();
    }
    PRUEF(diff_bei < 0);
    PRUEF(a.m->kanal_latenz() > 0);                  // the bus owns a delay ring
    PRUEF(bus_schlief);                              // it did sleep somewhere (between the switches)
  }

  // (10) schlaf_holder_beatfx: a BeatFx echo with its input OPEN on the strip, one impulse, silence for a long time, then a sine. The unit
  // sounds (klingt) all the time, so the strip stays awake; a strip that slept would leave the unit's own clock behind.
  for (int routing : {0, 1}) {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->setze("erz/3/fader", 0.0f);
      l->m->fx_routing_setze(routing);
      l->m->fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.5, 0.5f, 0.5f, 0.5, 0.5, true);
      l->m->fx_zuweisung_setze(0, 6, true);
    }
    int diff_bei = -1, schlief_bei_klang = 0;
    for (int k = 0; k < 4200 && diff_bei < 0; ++k) {
      for (Lauf* l : {&a, &b}) {
        if (k < 2) l->impuls(6, 480, 0);
        else if (k >= 4000 && k < 4040) l->sinus(6);
        l->lauf();
      }
      if (a.m->beatfx(0, 6).klingt()) schlief_bei_klang += a.m->schlaeft(6);
      if (!gleich(a, b)) diff_bei = k;
      a.ausgabe.clear();
      b.ausgabe.clear();
    }
    PRUEF(diff_bei < 0);
    PRUEF(schlief_bei_klang == 0);
  }
  // (12) schlaf_holder_gate_util_mb_bk: the mixer-side holders of schlaf_schritt (gate_an, util_an, mb_laeuft, bk_an). The strip sleeps
  // (silent from the start), the holder is switched on while the input stays silent: the strip must be awake in every block of that phase.
  // Then it is switched off (asleep again within a few blocks, the objects are reset) and a sine arrives: bit-equal to the run without
  // sleeping. Silence is the interesting case: with a sine the input check wakes the strip anyway.
  // Falling asleep needs no 2000 blocks here: a strip that never carried a signal has all filter states at zero.
  {
    static const char* KONST =   // a generator: constant 0.3 on both channels, independent of the input
        R"({"format":"baukasten/2","name":"konst","stimmen":1,"knoten":[{"id":"c","art":"konst","wert":0.3},{"id":"o","art":"ausgang"}],"kanten":[{"von":"c.aus","nach":"o.x"}]})";
    struct Fall { const char* name; int k; int latenz; };
    const Fall faelle[] = {
        {"gate", 6, 0}, {"util", 6, 0}, {"mb", 14, 0}, {"mb", 14, 480}, {"util", 14, 480}, {"bk", 0, 0},
    };
    for (const Fall& f : faelle) {
      Lauf a(true), b(false);
      const std::string kn = f.k < 4 ? "deck/" + std::to_string(f.k + 1) : f.k < 14 ? "erz/" + std::to_string(f.k - 3) : "bus/" + std::to_string(f.k - 13);
      for (Lauf* l : {&a, &b}) {
        l->m->setze_kanal_latenz(f.latenz);
        l->setze((kn + "/fader").c_str(), 0.0f);
      }
      if (f.k >= 14) for (Lauf* l : {&a, &b}) l->setze("erz/2/ziel", 1.0f);   // a bus is silent anyway; the target just makes it a real bus
      auto ein = [&](bool an) {
        const std::string p = kn + "/";
        if (!std::strcmp(f.name, "gate")) beide(a, b, (p + "gate/an").c_str(), an ? 1.0f : 0.0f);
        if (!std::strcmp(f.name, "util")) beide(a, b, (p + "util/tausch").c_str(), an ? 1.0f : 0.0f);
        if (!std::strcmp(f.name, "mb")) beide(a, b, (p + "mb/an").c_str(), an ? 1.0f : 0.0f);
        if (!std::strcmp(f.name, "bk")) {
          if (an) {
            CypherBk* g = cypher_bk_neu(KONST, 48000.0, nullptr, 0);
            PRUEF(g != nullptr);
            a.m->setze_kanal_graph(f.k, g);
            b.m->setze_kanal_graph(f.k, cypher_bk_neu(KONST, 48000.0, nullptr, 0));
          } else {
            a.m->setze_kanal_graph(f.k, nullptr);
            b.m->setze_kanal_graph(f.k, nullptr);
          }
        }
      };
      for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
      PRUEF(a.m->schlaeft(f.k));
      ein(true);
      for (int k = 0; k < 8; ++k) {
        a.lauf(); b.lauf();
        if (a.m->schlaeft(f.k)) std::fprintf(stderr, "holder %s (k=%d, latency %d): strip asleep in block %d with the holder on\n", f.name, f.k, f.latenz, k);
        PRUEF(!a.m->schlaeft(f.k));
      }
      if (!std::strcmp(f.name, "bk")) PRUEF(a.nicht_null_master());   // positive control: the graph sounds from zero input
      ein(false);
      for (int k = 0; k < 30; ++k) { a.lauf(); b.lauf(); }
      if (!a.m->schlaeft(f.k)) std::fprintf(stderr, "holder %s (k=%d, latency %d): not asleep again\n", f.name, f.k, f.latenz);
      PRUEF(a.m->schlaeft(f.k));
      for (int k = 0; k < 40; ++k) { a.sinus(f.k < 14 ? f.k : 5); b.sinus(f.k < 14 ? f.k : 5); a.lauf(); b.lauf(); }
      PRUEF(gleich(a, b));
    }
  }
  // (13) schlaf_holder_bus_ring: the bus delay ring is a holder of its own. NOISE colour makes sound from zero input behind the isolator, so a
  // bus that was never fed has zero filter states while the ring holds noise; the output is still zero for the whole latency (1200 > 4 blocks), so
  // stumm_ and ruhig() would both let it sleep and the noise in the ring would be lost.
  {
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) {
      l->m->setze_kanal_latenz(1200);
      l->setze("bus/1/fader", 0.0f);
      l->setze("color/art", 4.0f);     // NOISE
      l->setze("color/param", 1.0f);   // loud
    }
    for (int k = 0; k < 20; ++k) { a.lauf(); b.lauf(); }
    PRUEF(a.m->schlaeft(14));
    beide(a, b, "bus/1/filter", 0.8f);   // setze_sofort: this block already makes noise
    a.lauf(); b.lauf();
    beide(a, b, "bus/1/filter", 0.0f);   // back in the dead zone; the noise has not left the delay yet
    for (int k = 0; k < 40; ++k) { a.lauf(); b.lauf(); }
    PRUEF(gleich(a, b));
    bool laut = false;
    for (float v : b.ausgabe) laut = laut || v != 0.0f;
    PRUEF(laut);                         // positive control: the delayed noise did sound
    PRUEF(a.m->schlaeft(14));            // and the bus sleeps again once the ring is empty
  }
  // (11) schlaf_grenzfaelle
  {
    // varying block lengths: a sine burst, then silence until the strip sleeps, then a second burst
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) l->setze("erz/3/fader", 0.0f);
    const int ns[] = {256, 64, 1024, 100, 512, 33, 1, 977};
    for (int k = 0; k < 2200; ++k) {
      const int n = ns[k % 8];
      for (Lauf* l : {&a, &b}) {
        if (k < 40 || (k >= 2100 && k < 2120))
          for (int i = 0; i < n; ++i) {
            const float v = 0.5f * std::sin(0.05f * static_cast<float>(k * 1024 + i));
            l->m->eingang_l(6)[i] = v;
            l->m->eingang_r(6)[i] = v;
          }
        l->lauf_n(n);
      }
      if (k == 2099) PRUEF(a.m->schlaeft(6));
    }
    PRUEF(gleich(a, b));
    PRUEF(a.m->schlaf_bloecke() > 0);
  }
  {
    // -0.0f is an exact zero: the strip may sleep through it, the record stays equal
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) l->setze("erz/3/fader", 0.0f);
    for (int k = 0; k < 400; ++k)
      for (Lauf* l : {&a, &b}) {
        if (k >= 300 && k < 310)
          for (int i = 0; i < N; ++i) l->m->eingang_l(6)[i] = l->m->eingang_r(6)[i] = -0.0f;
        l->lauf();
      }
    PRUEF(gleich(a, b));
    PRUEF(a.m->schlaeft(6));
  }
  for (float schlecht : {NAN, INFINITY}) {
    // NaN / Inf into a sleeping strip: it wakes, the NaN guard of verarbeite() reacts the same with sleeping on and off
    Lauf a(true), b(false);
    for (Lauf* l : {&a, &b}) l->setze("erz/3/fader", 0.0f);
    for (int k = 0; k < 400; ++k) {
      if (k == 300) PRUEF(a.m->schlaeft(6));
      for (Lauf* l : {&a, &b}) {
        if (k == 300) l->m->eingang_l(6)[10] = schlecht;
        l->lauf();
      }
    }
    PRUEF(gleich(a, b));
    PRUEF(a.m->nan_treffer() == b.m->nan_treffer());
    if (std::isnan(schlecht)) PRUEF(a.m->nan_treffer() > 0);   // positive control: the guard did fire
  }
  PRUEF_ENDE();
}
