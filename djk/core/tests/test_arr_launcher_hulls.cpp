// Session view S1b, K5: cell envelopes evaluated on the cell position (not on the transport) override the track filter and sends, and the voice gain.
// 128 BPM: 22 500 samples per beat; the cell is a 4-beat loop (90 000 frames) of a constant 0.5; blocks of 256. The field target is read through
// Arrangement::feld_ziel (the value the strip mixes with at the end of the last block: the envelope while a cell plays it, else the knob).
//   1  filter -1 -> 1 over the cell, launched at beat 8: knob at beat 7.9, -1 at the launch, about 0 at beat 10, restarts at beat 12 (loops with the cell)
//   2  another cell without an envelope launched at beat 16: the knob value (0.25) is back at once and stays
//   3  stop of the track at beat 16: the knob value is back from the stop on
//   4  send.hall envelope moves the send field of return 0; a gain envelope at -200 dB silences the voice, at 0 dB the bus is bit-equal to the run without
//   5  two tracks with an envelope on the same field index do not touch each other
//   6  transport stopped and running give the same values
//   7  einmal: the envelope runs on the play position without a loop and holds its last value while the audio sounds; after the audio ends the knob is back
//   8  a knob move while the envelope plays is stored and shows when the cell stops; the envelope does not move the knob
//   9  launches at beat 9 and 10, and one with an offset (versatz): the envelope value follows the cell position, not the transport
//  10  the mixed ramp (the per-sample strip value) has no step at the onset and at the release
//  11  gain envelope: a sawtooth (-40 -> 0 dB) has no hard step at the loop wrap on the re-pitch, the re-pitch fallback and the keylock path; also with the wrap on a block boundary
//  12  einmal on a 110 BPM cell played at 128 BPM: the envelope follows the audio position (frames), not the transport beats
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

bool g_waechter = false;

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: the value the strip mixes with per sample of the last block (the ramp row while a cell envelope rules the field, else the knob)
  static void strip(const Arrangement& a, int sp, int f, int m, float* out) {
    const Arrangement::ZellUeber& u = a.zell_ueber_[sp][f];
    for (int i = 0; i < m; ++i) out[i] = u.da && u.zeile >= 0 ? a.zell_buf_[u.zeile][i] : a.w_[sp][f].w;
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;

static const uint64_t ID1 = cdj::arr_id("s1");
static const uint64_t ID2 = cdj::arr_id("s2");
static constexpr int64_t CELL = 4 * SPB;
static constexpr int64_t BLK = 256;

static ArrZelle zelle(Audio& a, ArrZellArt art = ArrZellArt::loop) {
  ArrZelle z;
  z.art = art;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = art == ArrZellArt::loop ? 4.0 : 0.0;
  z.gain = 1.0f;
  z.modus = 0;
  return z;
}
static void huelle(ArrZelle& z, int art, int feld, std::vector<ArrAutoPunkt> p) {
  cdj::ZellHuelle& h = z.huellen[z.n_huellen++];
  h.art = static_cast<uint8_t>(art);
  h.feld = static_cast<uint8_t>(feld);
  h.n = static_cast<int>(p.size());
  for (size_t i = 0; i < p.size(); ++i) h.p[i] = p[i];
}

struct Lauf {
  Treiber t;
  std::vector<float> bus;
  int tr_feld = -1;        // >= 0: record the strip value of (track 1, this field) per sample in tr
  std::vector<float> tr;
  // the cells: track 1 cells[0..] ; with zwei, track 2 gets cells2
  explicit Lauf(const std::vector<ArrZelle>& cells, const std::vector<ArrZelle>& cells2 = {}, bool werk = false) {
    if (werk) PRUEF(t.mit_werk(0));   // the synchronous warp work (keylock cells)
    Bau bau;
    bau.spur(1, ArrArt::audio);
    if (!cells2.empty()) bau.spur(2, ArrArt::audio);
    cdj::ArrSnapshot* s = bau.fertig();
    const std::vector<ArrZelle>* cs[2] = {&cells, &cells2};
    const uint64_t ids[2] = {ID1, ID2};
    const char* txt[2] = {"s1", "s2"};
    for (int i = 0; i < 2; ++i) {
      if (cs[i]->empty()) continue;
      cdj::ArrSpur& sp = s->spur[i];
      sp.kennung = ids[i];
      std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "%s", txt[i]);
      for (size_t c = 0; c < cs[i]->size(); ++c) sp.zellen[c] = (*cs[i])[c];
      sp.n_zellen = static_cast<int>(cs[i]->size());
    }
    t.laden(s);
  }
  void setze(const char* pfad, float w) {
    const int r = t.tab.suche(pfad);
    PRUEF(r >= 0);
    t.arr.setze_sofort(r, w);
  }
  void start(uint64_t id, int zelle_nr, double beat, double versatz = 0.0) { PRUEF(t.arr.launch_start(id, zelle_nr, beat, versatz, 1, false) == LaunchGrund::ok); }
  void stopp(uint64_t id, double beat) { PRUEF(t.arr.launch_stopp(id, beat, 1, false) == LaunchGrund::ok); }
  float ziel(int spur0, int feld) const { return t.arr.feld_ziel(spur0, feld); }
  // run until the end of the block that contains sample `ziel_s` and return the target of (spur, feld) after it
  float bei(int64_t ziel_s, int spur0, int feld) {
    while (t.s <= ziel_s) {
      t.lauf(t.s + t.n);
      bus.insert(bus.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
      if (tr_feld >= 0) {
        float row[cdj::ARR_BLOCK];
        cdj::ArrPruefZugang::strip(t.arr, 0, tr_feld, t.n, row);
        tr.insert(tr.end(), row, row + t.n);
      }
    }
    return ziel(spur0, feld);
  }
};

static std::vector<ArrAutoPunkt> rampe(double a, double b) { return {{0.0, static_cast<float>(a), 0}, {4.0, static_cast<float>(b), 0}}; }
static bool nahe(float a, float b, float tol) { return std::fabs(a - b) <= tol; }

int main() {
  auto au = Audio::gleich(CELL, 0.5f);
  auto au1 = Audio::gleich(CELL, 0.5f);
  const int64_t B8 = 8 * SPB, B10 = 10 * SPB, B12 = 12 * SPB, B16 = 16 * SPB;
  {  // 1 + 2 + 3 + 8: the filter envelope, the takeover and the stop
    ArrZelle z1 = zelle(*au);
    huelle(z1, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
    ArrZelle z2 = zelle(*au1);   // no envelope
    Lauf x({z1, z2});
    x.setze("spur/1/filter", 0.25f);
    x.start(ID1, 1, 8.0);
    PRUEF(nahe(x.bei(B8 - 2 * BLK, 0, cdj::ARR_F_FILTER), 0.25f, 1e-6f));   // before the launch: the knob
    const float am_start = x.bei(B8 + BLK, 0, cdj::ARR_F_FILTER);
    const float mitte = x.bei(B10, 0, cdj::ARR_F_FILTER);
    const float vor_wrap = x.bei(B12 - BLK, 0, cdj::ARR_F_FILTER);
    const float nach_wrap = x.bei(B12 + BLK, 0, cdj::ARR_F_FILTER);
    std::printf("1: filter target: launch %.4f, beat 10 %.4f, before the wrap %.4f, after the wrap %.4f\n", am_start, mitte, vor_wrap, nach_wrap);
    PRUEF(nahe(am_start, -1.0f, 0.03f));
    PRUEF(nahe(mitte, 0.0f, 0.03f));
    PRUEF(vor_wrap > 0.95f);
    PRUEF(nahe(nach_wrap, -1.0f, 0.03f));   // restarts with the cell
    // 8: a knob move while the envelope plays is stored, the envelope is not touched by it
    const float vorher = x.bei(B12 + 40 * BLK, 0, cdj::ARR_F_FILTER);
    x.setze("spur/1/filter", -0.75f);
    const float nachher = x.bei(B12 + 41 * BLK, 0, cdj::ARR_F_FILTER);
    PRUEF(nahe(nachher - vorher, 2.0f * static_cast<float>(BLK) / static_cast<float>(CELL), 0.01f));   // still the envelope
    // 2: cell 2 (no envelope) launched at beat 16: the knob is back at once, and stays
    x.start(ID1, 2, 16.0);
    PRUEF(x.bei(B16 - 2 * BLK, 0, cdj::ARR_F_FILTER) > -1.0f);   // still the envelope before the launch
    const float da = x.bei(B16 + 2 * BLK, 0, cdj::ARR_F_FILTER);
    const float spaeter = x.bei(B16 + 30 * BLK, 0, cdj::ARR_F_FILTER);
    std::printf("2: cell without envelope from beat 16: %.4f then %.4f (knob -0.75)\n", da, spaeter);
    PRUEF(nahe(da, -0.75f, 1e-6f));
    PRUEF(nahe(spaeter, -0.75f, 1e-6f));
    // 3: the envelope cell again, then a stop at beat 24: the knob is back from the stop on
    x.start(ID1, 1, 20.0);
    PRUEF(x.bei(22 * SPB, 0, cdj::ARR_F_FILTER) > -0.75f + 0.1f);
    x.stopp(ID1, 24.0);
    const float vor_stopp = x.bei(24 * SPB - BLK, 0, cdj::ARR_F_FILTER);
    const float nach_stopp = x.bei(24 * SPB + 2 * BLK, 0, cdj::ARR_F_FILTER);
    const float lange_nach = x.bei(24 * SPB + 40 * BLK, 0, cdj::ARR_F_FILTER);
    std::printf("3: stop at beat 24: before %.4f, after %.4f, later %.4f\n", vor_stopp, nach_stopp, lange_nach);
    PRUEF(nahe(nach_stopp, -0.75f, 1e-6f) && nahe(lange_nach, -0.75f, 1e-6f));
  }
  {  // 4: send.hall envelope, gain envelope
    ArrZelle z1 = zelle(*au);
    huelle(z1, 0, cdj::arr_f_send(0), {{0.0, -60.0f, 0}, {4.0, -6.0f, 0}});
    Lauf x({z1});
    x.setze("spur/1/send/1", -20.0f);
    x.start(ID1, 1, 8.0);
    const float s0 = x.bei(B8 + BLK, 0, cdj::arr_f_send(0));
    const float s1 = x.bei(B10, 0, cdj::arr_f_send(0));
    std::printf("4: send.hall: launch %.2f dB, beat 10 %.2f dB (knob -20)\n", s0, s1);
    PRUEF(nahe(s0, -60.0f, 1.0f));
    PRUEF(nahe(s1, -33.0f, 1.0f));
    PRUEF(nahe(x.ziel(0, cdj::arr_f_send(1)), x.t.arr.feld_ziel(1, cdj::arr_f_send(1)), 1e-6f));   // return 2 of track 1 is untouched: the default knob, as on an idle track
  }
  {  // 4b: gain envelope at -200 dB silences, at 0 dB bit-equal
    ArrZelle zr = zelle(*au);   // reference: no envelope
    ArrZelle z0 = zelle(*au), zs = zelle(*au);
    huelle(z0, 2, 0, {{0.0, 0.0f, 0}, {4.0, 0.0f, 0}});
    huelle(zs, 2, 0, {{0.0, -200.0f, 0}, {4.0, -200.0f, 0}});
    Lauf ref({zr}), l0({z0}), ls({zs});
    for (Lauf* l : {&ref, &l0, &ls}) l->start(ID1, 1, 8.0);
    for (Lauf* l : {&ref, &l0, &ls}) l->bei(B12, 0, 0);
    const size_t a = static_cast<size_t>(B8 + 2 * BLK), b = static_cast<size_t>(B12);
    float spitze_ref = 0.0f, spitze_stumm = 0.0f;
    bool gleich0 = true;
    for (size_t i = a; i < b; ++i) {
      spitze_ref = std::max(spitze_ref, std::fabs(ref.bus[i]));
      spitze_stumm = std::max(spitze_stumm, std::fabs(ls.bus[i]));
      gleich0 = gleich0 && std::memcmp(&ref.bus[i], &l0.bus[i], sizeof(float)) == 0;
    }
    std::printf("4b: gain envelope: reference peak %.4f, at -200 dB %.6f, at 0 dB bit-equal: %d\n", spitze_ref, spitze_stumm, gleich0);
    PRUEF(spitze_ref > 0.4f);
    PRUEF(spitze_stumm < 1e-6f);
    PRUEF(gleich0);
  }
  {  // 4c: keylock cell (modus 2, one werk voice per pass): the gain envelope rides on the werk voice
    ArrZelle zr = zelle(*au), zs = zelle(*au), zv = zelle(*au);
    zr.modus = zs.modus = zv.modus = 2;
    huelle(zs, 2, 0, {{0.0, -200.0f, 0}, {4.0, -200.0f, 0}});
    huelle(zv, 2, 0, {{0.0, -40.0f, 0}, {4.0, 0.0f, 0}});
    Lauf ref({zr}, {}, true), ls({zs}, {}, true), lv({zv}, {}, true);
    for (Lauf* l : {&ref, &ls, &lv}) l->start(ID1, 1, 8.0);
    for (Lauf* l : {&ref, &ls, &lv}) l->bei(B12 - BLK, 0, 0);
    auto spitze = [](const Lauf& l, int64_t a, int64_t b) {
      float p = 0.0f;
      for (int64_t i = a; i < b; ++i) p = std::max(p, std::fabs(l.bus[static_cast<size_t>(i)]));
      return p;
    };
    const float p_ref = spitze(ref, B8 + 2 * SPB, B12 - 2 * BLK), p_stumm = spitze(ls, B8 + SPB, B12 - 2 * BLK);
    const float p_frueh = spitze(lv, B8 + SPB / 2, B8 + SPB), p_spaet = spitze(lv, B12 - SPB, B12 - 2 * BLK);
    std::printf("4c: keylock gain envelope: reference peak %.4f, at -200 dB %.6f; ramp -40 -> 0 dB: beat 8.5-9 %.4f, last beat %.4f\n", p_ref, p_stumm, p_frueh, p_spaet);
    PRUEF(p_ref > 0.3f);
    PRUEF(p_stumm < 1e-4f);
    PRUEF(p_frueh < 0.1f * p_ref);
    PRUEF(p_spaet > 0.6f * p_ref);
  }
  {  // 5: two tracks with an envelope on the same field index
    ArrZelle za = zelle(*au), zb = zelle(*au1);
    huelle(zb, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
    Lauf x({za}, {zb});
    x.setze("spur/1/filter", 0.3f);
    x.start(ID1, 1, 8.0);
    x.start(ID2, 1, 8.0);
    const float t1 = x.bei(B10, 0, cdj::ARR_F_FILTER), t2 = x.bei(B10, 1, cdj::ARR_F_FILTER);
    std::printf("5: track 1 (no envelope) %.4f, track 2 (envelope) %.4f\n", t1, t2);
    PRUEF(nahe(t1, 0.3f, 1e-6f));
    PRUEF(nahe(t2, 0.0f, 0.03f));
  }
  {  // 6: transport stopped and running give the same values
    ArrZelle z1 = zelle(*au);
    huelle(z1, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
    Lauf st({z1}), la({z1});
    la.t.arr.start(0.0, 0, false, 0, 537, 256, la.t.k);
    st.start(ID1, 1, 8.0);
    la.start(ID1, 1, 8.0);
    bool gleich = true;
    for (int64_t pos : {B8 + BLK, B10, B12 - BLK, B12 + BLK, B12 + 3 * SPB}) gleich = gleich && st.bei(pos, 0, cdj::ARR_F_FILTER) == la.bei(pos, 0, cdj::ARR_F_FILTER);
    std::printf("6: stopped and running transport give the same values: %d\n", gleich);
    PRUEF(gleich);
  }
  {  // 7: einmal: no loop, the last value holds while the audio sounds; the knob is back after it
    auto ein = Audio::gleich(4 * SPB, 0.5f);
    ArrZelle z = zelle(*ein, ArrZellArt::einmal);
    z.huell_beats = 4.0;   // the cell length of the audio: frames per cell beat = the transport's here
    huelle(z, 0, cdj::ARR_F_FILTER, {{0.0, -1.0f, 0}, {2.0, 1.0f, 0}});
    Lauf x({z});
    x.setze("spur/1/filter", 0.25f);
    x.start(ID1, 1, 8.0);
    const float eins = x.bei(9 * SPB, 0, cdj::ARR_F_FILTER);       // position 1 beat: 0
    const float halt = x.bei(11 * SPB, 0, cdj::ARR_F_FILTER);      // position 3 beats: past the last point, held
    const float ende = x.bei(12 * SPB + 4 * BLK, 0, cdj::ARR_F_FILTER);   // the audio is over
    std::printf("7: einmal: beat 9 %.4f, beat 11 %.4f (held), after the audio %.4f (knob 0.25)\n", eins, halt, ende);
    PRUEF(nahe(eins, 0.0f, 0.03f));
    PRUEF(nahe(halt, 1.0f, 1e-3f));
    PRUEF(nahe(ende, 0.25f, 1e-6f));
  }
  {  // 9: launches off the 4-beat grid, and with an offset: the envelope follows the cell position, not the transport
    struct Fall { double ab, versatz, messen; float soll; };   // value at the end of the block holding beat `messen`
    const Fall faelle[] = {
        {9.0, 0.0, 9.0 + 2.0, 0.0f},     // position 2 of 4: 0 (the transport phase would be 3: 0.5)
        {10.0, 0.0, 11.0, -0.5f},        // position 1: -0.5 (transport: 3, 0.5)
        {8.0, 1.0, 8.0 + 2.5, 0.75f},   // starts at position 1: 3.5 beats in: 0.75 (without the offset: 0.25)
        {8.0, 1.0, 8.0 + 3.5, -0.75f},   // position 4.5 wraps to 0.5: -0.75
    };
    for (const Fall& f : faelle) {
      ArrZelle z1 = zelle(*au);
      huelle(z1, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
      Lauf x({z1});
      x.setze("spur/1/filter", 0.25f);
      x.start(ID1, 1, f.ab, f.versatz);
      const float am_start = x.bei(static_cast<int64_t>(f.ab * SPB) + BLK, 0, cdj::ARR_F_FILTER);
      const float wert = x.bei(static_cast<int64_t>(f.messen * SPB), 0, cdj::ARR_F_FILTER);
      const float start_soll = -1.0f + static_cast<float>(f.versatz) / 2.0f;
      std::printf("9: launch beat %.1f offset %.1f: at the launch %.4f (want %.4f), at beat %.1f %.4f (want %.4f)\n", f.ab, f.versatz, am_start, start_soll, f.messen, wert, f.soll);
      PRUEF(nahe(am_start, start_soll, 0.03f));
      PRUEF(nahe(wert, f.soll, 0.03f));
    }
  }
  {  // 10: the mixed ramp has no step at the onset and at the release (the largest step between two samples of the strip value)
    ArrZelle z1 = zelle(*au);
    huelle(z1, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
    Lauf x({z1});
    x.tr_feld = cdj::ARR_F_FILTER;
    x.setze("spur/1/filter", 0.25f);
    x.start(ID1, 1, 9.0);
    x.bei(10 * SPB, 0, cdj::ARR_F_FILTER);   // the start is in effect (a stop given before would replace the waiting start)
    x.stopp(ID1, 16.5);
    x.bei(18 * SPB, 0, cdj::ARR_F_FILTER);
    auto groesster = [&](int64_t a, int64_t b) {
      float g = 0.0f;
      for (int64_t i = a; i + 1 < b; ++i) g = std::max(g, std::fabs(x.tr[static_cast<size_t>(i + 1)] - x.tr[static_cast<size_t>(i)]));
      return g;
    };
    const float g_ein = groesster(9 * SPB - 2 * BLK, 9 * SPB + 3 * BLK);
    const float g_aus = groesster(static_cast<int64_t>(16.5 * SPB) - 2 * BLK, static_cast<int64_t>(16.5 * SPB) + 4 * BLK);
    std::printf("10: largest step of the strip value: onset %.5f (knob 0.25 -> -1), release %.5f (about 0.75 -> knob 0.25)\n", g_ein, g_aus);
    PRUEF(g_ein < 0.01f);
    PRUEF(g_aus < 0.01f);
    PRUEF(std::fabs(x.tr[static_cast<size_t>(9 * SPB + 3 * BLK)] + 1.0f) < 0.05f);   // and the envelope did arrive
  }
  {  // 11: gain sawtooth -40 -> 0 dB at the loop wrap (beat 12, mid-block): re-pitch, re-pitch fallback (every pass slot taken) and keylock
    auto schritt = [](const Lauf& l, int64_t a, int64_t b) {
      float g = 0.0f;
      for (int64_t i = a; i + 1 < b; ++i) g = std::max(g, std::fabs(l.bus[static_cast<size_t>(i + 1)] - l.bus[static_cast<size_t>(i)]));
      return g;
    };
    auto saege = [&](int modus) {
      ArrZelle z = zelle(*au);
      z.modus = static_cast<int8_t>(modus);
      huelle(z, 2, 0, {{0.0, -40.0f, 0}, {4.0, 0.0f, 0}});
      return z;
    };
    ArrZelle zr = saege(0), zk = saege(2), zf = saege(2);
    ArrZelle zf0 = zelle(*au);
    zf0.modus = 2;   // reference of the fallback: no envelope
    Lauf rp({zr}, {}, true), kl({zk}, {}, true), fb({zf}, {}, true), fb0({zf0}, {}, true);
    fb.t.arr.test_launch_paesse_sperren();
    fb0.t.arr.test_launch_paesse_sperren();
    for (Lauf* l : {&rp, &kl, &fb, &fb0}) l->start(ID1, 1, 8.0);
    for (Lauf* l : {&rp, &kl, &fb, &fb0}) l->bei(B12 + 4 * BLK, 0, 0);
    const int64_t a = B12 - 300, b = B12 + 500;
    const float s_rp = schritt(rp, a, b), s_kl = schritt(kl, a, b), s_fb = schritt(fb, a, b);
    float p_fb = 0.0f, p_fb0 = 0.0f;
    for (int64_t i = B8 + SPB / 2; i < B8 + SPB; ++i) {
      p_fb = std::max(p_fb, std::fabs(fb.bus[static_cast<size_t>(i)]));
      p_fb0 = std::max(p_fb0, std::fabs(fb0.bus[static_cast<size_t>(i)]));
    }
    std::printf("11: largest sample step at the wrap: re-pitch %.5f, fallback %.5f, keylock %.5f; fallback peak beat 8.5-9 %.4f (without envelope %.4f)\n", s_rp, s_fb, s_kl, p_fb, p_fb0);
    PRUEF(p_fb0 > 0.3f);
    PRUEF(p_fb < 0.1f * p_fb0);   // the gain envelope rides on the fallback too
    PRUEF(s_rp < 1.5f * s_kl);
    PRUEF(s_fb < 1.5f * s_kl);
    PRUEF(s_rp < 0.02f && s_fb < 0.02f);
    {  // the glide ends: ARR_NAHT (96) samples after the jump the gain is the envelope value again (no lasting damping), and it takes at least ~80 samples (ARR_NAHT pinned)
      Lauf r0({zelle(*au)}, {}, true);
      r0.start(ID1, 1, 8.0);
      r0.bei(B12 + 4 * BLK, 0, 0);
      auto env_gain = [&](int64_t i) { return std::pow(10.0, (-40.0 + 40.0 * static_cast<double>(i - B12) / static_cast<double>(4 * SPB)) / 20.0); };
      for (Lauf* l : {&rp, &fb}) {
        const bool kein_klang = l == &fb;
        const Lauf& ref = kein_klang ? fb0 : r0;   // the fallback has its own reference (keylock modus, no envelope)
        int64_t letzte_abw = -1;
        double schlimmste = 0.0;
        int n = 0;
        for (int64_t i = B12; i < B12 + 600; ++i) {
          const double r = ref.bus[static_cast<size_t>(i)];
          if (std::fabs(r) < 0.1) continue;   // the ratio only where the reference is well above zero
          const double g = l->bus[static_cast<size_t>(i)] / r, soll = env_gain(i);
          const double abw = std::fabs(g - soll) / soll;
          if (abw > 0.05) letzte_abw = i - B12;
          if (i >= B12 + 96) { schlimmste = std::max(schlimmste, abw); ++n; }
        }
        std::printf("11: %s: gain meets the envelope %lld samples after the jump (%d samples checked after 96, worst deviation %.4f)\n", kein_klang ? "fallback" : "re-pitch",
                    static_cast<long long>(letzte_abw + 1), n, schlimmste);
        PRUEF(n > 20);
        PRUEF(schlimmste < 0.05);                        // 96 samples after the jump: on the envelope again
        PRUEF(letzte_abw + 1 >= 80);                     // the glide is not shorter than ARR_NAHT allows (80 with a margin)
      }
    }
    // the wrap on a block boundary: the cell launched at beat 64 wraps at beat 128 = sample 2 880 000 = block 11250 (the glide state outlives the block)
    ArrZelle zb = saege(0);
    Lauf rb({zb});
    rb.start(ID1, 1, 64.0);
    const int64_t W = 128 * SPB;
    PRUEF(W % BLK == 0);
    rb.bei(W + 4 * BLK, 0, 0);
    const float s_blk = schritt(rb, W - 300, W + 500);
    std::printf("11: wrap on a block boundary: largest sample step %.5f\n", s_blk);
    PRUEF(s_blk < 1.5f * s_kl);
  }
  {  // 12: einmal: a 110 BPM cell (8 cell beats) played at 128 BPM: the envelope runs on the audio position (frames), the audio on its native rate
    const int64_t frames = static_cast<int64_t>(std::llround(8.0 * 60.0 * 48000.0 / 110.0));
    auto ein = Audio::gleich(frames, 0.5f);
    ArrZelle z = zelle(*ein, ArrZellArt::einmal);
    z.huell_beats = 8.0;
    huelle(z, 0, cdj::ARR_F_FILTER, {{0.0, -1.0f, 0}, {8.0, 1.0f, 0}});
    Lauf x({z});
    x.setze("spur/1/filter", 0.25f);
    x.start(ID1, 1, 8.0);
    const int64_t T = B8, halb = frames / 2;   // 4 cell beats in: 0 (the transport beats would give 4.65 of 8: 0.16)
    const float mitte = x.bei(T + halb, 0, cdj::ARR_F_FILTER);
    const float spaet = x.bei(T + 3 * frames / 4, 0, cdj::ARR_F_FILTER);   // 6 cell beats: 0.5 (transport: 0.74)
    std::printf("12: einmal 110 BPM cell at 128 BPM: half way %.4f (want 0), three quarters %.4f (want 0.5)\n", mitte, spaet);
    PRUEF(nahe(mitte, 0.0f, 0.03f));
    PRUEF(nahe(spaet, 0.5f, 0.03f));
  }
  {  // cost per block (printed, no bound): 4 envelopes (filter, two sends, gain) against none, 256-sample blocks, one playing cell
    ArrZelle zr = zelle(*au), ze = zelle(*au);
    huelle(ze, 0, cdj::ARR_F_FILTER, rampe(-1.0, 1.0));
    huelle(ze, 0, cdj::arr_f_send(0), {{0.0, -60.0f, 0}, {4.0, -6.0f, 0}});
    huelle(ze, 0, cdj::arr_f_send(1), {{0.0, -60.0f, 0}, {4.0, -6.0f, 0}});
    huelle(ze, 2, 0, {{0.0, -12.0f, 0}, {2.0, 0.0f, 0}, {4.0, -12.0f, 0}});
    double us[2] = {};
    for (int rep = 0; rep < 3; ++rep)
      for (int k = 0; k < 2; ++k) {
        Lauf x({k ? ze : zr});
        x.start(ID1, 1, 0.0);
        const auto t0 = std::chrono::steady_clock::now();
        x.t.lauf(8 * CELL);
        const double d = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count() / static_cast<double>(8 * CELL / BLK);
        us[k] = rep == 0 ? d : std::min(us[k], d);
      }
    std::printf("cost per 256-sample block: without envelopes %.2f us, with 4 envelopes %.2f us (whole Arrangement::block incl. mixing)\n", us[0], us[1]);
  }
  PRUEF_ENDE();
}
