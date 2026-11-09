// 1.10 slice 4c T15: the rack macros of the arrangement mixer (spec D13, Q4; AK-S4-16).
// A 1 kHz sine of 0.5 on track 1, a chain of up to two stages (compressor slot 0, EQ slot 0) and a rack in the pool slot 0 whose four macros drive parameters of the stages. The macro rows are
// rack/<k>/m1..m4; a mapping turns the macro value m into `von + m * (bis - von)` in the real unit of the parameter. The parameter indices are those of the contract (komp: schwelle = 1, ratio = 2;
// eq: b1/gain = 3 + 3 = 6, b1/freq = 5).
// Cases: 1 makro_endpunkte (m = 0 gives von, m = 1 gives bis, a half way value in between, for one komp and one eq parameter; audible: the EQ gain macro raises the sine by 12 dB, the threshold
// macro lowers it), 2 makro_ueberschreibt_regler (writing the row of a mapped parameter changes nothing, neither the value nor the output bit for bit; an unmapped row still acts),
// 3 makro_blockweit (a macro move, as a value or as a course, acts in the next block and not in the one before), 4 makro_limit (the loader: 16 mappings load, the 17th, a second rack on one
// strip, a rack slot used twice, a stage not in the chain, the stage switch or the key as target, a double target, a bad macro number are refused with a reason),
// 5 makro_weg (a swap without the rack, or without the mapping, hands the parameter back to its own row in the next block), 6 makro_ohne_rack (macro rows without a rack in the snapshot do nothing:
// bit-equal output), 7 makro_zwei_racks (two strips, two racks, independent), 8 makro_pool (the pool constants equal the table rows), 9 keine_allokation (2000 blocks, macros moving every block,
// two swaps; positive control).
// Mutations (CMakeLists.txt): MAKRO_VERTAUSCHT (1), MAKRO_ROW_GEWINNT (2), MAKRO_LIMIT_17 (4).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrMakroZiel;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static std::string rk(int k, int n) { return "rack/" + std::to_string(k) + "/m" + std::to_string(n); }
static void laden_start(Treiber& t, cdj::ArrSnapshot* s) {
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
}
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  laden_start(t, s);
  t.lauf(bis);
}
static double db(double x) { return 20.0 * std::log10(x); }
static double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis; ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
static bool gleich_bits(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  return std::memcmp(a.data() + von, b.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}

static const ArrStufe KOMP{ArrInsArt::komp, 0, true};
static const ArrStufe EQ{ArrInsArt::eq, 0, true};
static constexpr int P_SCHWELLE = 1, P_RATIO = 2, P_B1_GAIN = 6, P_B1_FREQ = 5;
static const int G_KOMP = cdj::ins_global(ArrInsArt::komp, 0), G_EQ = cdj::ins_global(ArrInsArt::eq, 0);
static ArrMakroZiel ziel(int makro, int stufe, int param, float von, float bis) {
  ArrMakroZiel z;
  z.makro = static_cast<uint8_t>(makro);
  z.stufe = static_cast<uint8_t>(stufe);
  z.param = static_cast<uint8_t>(param);
  z.von = von;
  z.bis = bis;
  return z;
}
// track 1: komp (stage 0) and eq (stage 1) in a chain, a rack in slot 0: macro 1 -> komp schwelle -60..0, macro 2 -> eq b1/gain 0..12
static cdj::ArrSnapshot* beide(const cdj::ArrAudio* a, bool mit_rack = true, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  b.kette(1, {KOMP, EQ});
  if (mit_rack) b.rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f), ziel(1, 1, P_B1_GAIN, 0.0f, 12.0f)});
  return b.fertig();
}
// one stage alone (for the audible checks): the eq with the macro on the gain, or the komp with the macro on the threshold
static cdj::ArrSnapshot* eine(const cdj::ArrAudio* a, bool eq, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  if (eq) b.kette(1, {EQ}).rack(1, 0, {ziel(0, 0, P_B1_GAIN, 0.0f, 12.0f)});
  else b.kette(1, {KOMP}).rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
  return b.fertig();
}
static void stufen_an(Treiber& t) {
  setze(t, "ins/komp/1/an", 1.0f);
  setze(t, "ins/komp/1/ratio", 20.0f);
  setze(t, "ins/eq/1/an", 1.0f);
  setze(t, "ins/eq/1/b1/an", 1.0f);
  setze(t, "ins/eq/1/b1/typ", 0.0f);
  setze(t, "ins/eq/1/b1/freq", 1000.0f);
  setze(t, "ins/eq/1/b1/q", 4.0f);
}
static constexpr int64_t VON = 93000, BIS = 117000;   // 24000 samples: 500 periods of 1 kHz

int main() {
  auto s1k = Audio::sinus(400000, 1000.0, 0.5f);

  {  // 1 makro_endpunkte
    TR(t)
    stufen_an(t);
    setze(t, "ins/eq/1/b1/gain", -9.0f);   // the row of the mapped parameter holds something else: the macro drives it
    setze(t, rk(1, 1), 0.0f);
    setze(t, rk(1, 2), 0.0f);
    spiele(t, beide(&s1k->a), 60000);
    const float k0 = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), e0 = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    setze(t, rk(1, 1), 1.0f);
    setze(t, rk(1, 2), 1.0f);
    t.lauf(t.s + 256);
    const float k1 = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), e1 = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    setze(t, rk(1, 1), 0.5f);
    setze(t, rk(1, 2), 0.25f);
    t.lauf(t.s + 256);
    const float km = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), em = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    std::printf("1: komp schwelle m=0 %.3f, m=1 %.3f, m=.5 %.3f; eq b1/gain m=0 %.3f, m=1 %.3f, m=.25 %.3f\n", k0, k1, km, e0, e1, em);
    PRUEF_NAH(k0, -60.0, 1e-4);   // m = 0 gives von
    PRUEF_NAH(k1, 0.0, 1e-4);     // m = 1 gives bis
    PRUEF_NAH(km, -30.0, 1e-4);
    PRUEF_NAH(e0, 0.0, 1e-4);
    PRUEF_NAH(e1, 12.0, 1e-4);
    PRUEF_NAH(em, 3.0, 1e-4);
    PRUEF(t.arr.inserts().makro_treibt(G_KOMP, P_SCHWELLE) && t.arr.inserts().makro_treibt(G_EQ, P_B1_GAIN));
    PRUEF(!t.arr.inserts().makro_treibt(G_KOMP, P_RATIO));   // negative control: a parameter that is not mapped is not driven
    // audible: the EQ gain macro raises the sine by 12 dB between m = 0 and m = 1; the threshold macro lowers it (ratio 20 on a -6 dBFS sine: threshold -60 against 0)
    TR(e_aus) TR(e_an) TR(k_aus) TR(k_an)
    stufen_an(e_aus); setze(e_aus, rk(1, 1), 0.0f); spiele(e_aus, eine(&s1k->a, true), 120000);
    stufen_an(e_an); setze(e_an, rk(1, 1), 1.0f); spiele(e_an, eine(&s1k->a, true), 120000);
    stufen_an(k_aus); setze(k_aus, rk(1, 1), 0.0f); spiele(k_aus, eine(&s1k->a, false), 120000);
    stufen_an(k_an); setze(k_an, rk(1, 1), 1.0f); spiele(k_an, eine(&s1k->a, false), 120000);
    const double ge = db(rms(e_an.pml, VON, BIS) / rms(e_aus.pml, VON, BIS));
    const double gk = db(rms(k_an.pml, VON, BIS) / rms(k_aus.pml, VON, BIS));
    std::printf("1: audible: eq gain macro 0 -> 1 = %.3f dB; threshold macro 0 -> 1 = %.3f dB\n", ge, gk);
    PRUEF(rms(e_aus.pml, VON, BIS) > 0.1);   // the signal is there (positive control)
    PRUEF_NAH(ge, 12.0, 0.2);
    PRUEF(gk > 6.0);
  }

  {  // 2 makro_ueberschreibt_regler
    TR(a) TR(b)
    stufen_an(a); stufen_an(b);
    setze(a, rk(1, 1), 0.5f); setze(a, rk(1, 2), 0.5f);
    setze(b, rk(1, 1), 0.5f); setze(b, rk(1, 2), 0.5f);
    spiele(a, beide(&s1k->a), 120000);
    // b: the rows of both mapped parameters are written to other values before and during the run
    setze(b, "ins/komp/1/schwelle", -5.0f);
    setze(b, "ins/eq/1/b1/gain", -9.0f);
    laden_start(b, beide(&s1k->a));
    b.lauf(60000);
    setze(b, "ins/komp/1/schwelle", -12.0f);
    setze(b, "ins/eq/1/b1/gain", 7.0f);
    b.lauf(120000);
    std::printf("2: written rows: komp schwelle %.3f (macro -30), eq gain %.3f (macro 6)\n", b.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), b.arr.inserts().wirksam(G_EQ, P_B1_GAIN));
    PRUEF_NAH(b.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-4);
    PRUEF_NAH(b.arr.inserts().wirksam(G_EQ, P_B1_GAIN), 6.0, 1e-4);
    PRUEF(rms(a.pml, VON, BIS) > 0.01);
    PRUEF(gleich_bits(a.pml, b.pml, 0, 120000));   // not a bit differs from the run that never wrote those rows
    // negative control: the row of a parameter that is NOT mapped (ratio) still acts
    TR(c)
    stufen_an(c);
    setze(c, rk(1, 1), 0.5f);
    spiele(c, beide(&s1k->a), 60000);
    setze(c, "ins/komp/1/ratio", 3.0f);
    c.lauf(c.s + 256);
    PRUEF_NAH(c.arr.inserts().wirksam(G_KOMP, P_RATIO), 3.0, 1e-4);
  }

  {  // 3 makro_blockweit
    TR(t)
    stufen_an(t);
    setze(t, rk(1, 1), 0.0f);
    spiele(t, beide(&s1k->a), 60000);
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -60.0, 1e-4);
    setze(t, rk(1, 1), 1.0f);   // between two blocks
    t.lauf(t.s + 256);          // the next block
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), 0.0, 1e-4);
    // as a course: the value at the end of the block is the one the block gets (like every parameter of the stages)
    static float verlauf[256];
    for (int i = 0; i < 256; ++i) verlauf[i] = static_cast<float>(i) / 255.0f * 0.5f;   // 0 .. 0.5
    t.arr.verlauf(reg(t, rk(1, 1)), verlauf);
    t.lauf(t.s + 256);
    std::printf("3: course ending at 0.5: schwelle %.3f\n", t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE));
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-3);
    t.lauf(t.s + 256);   // the course ended in its base value (nachfuehren): the macro stays at 0.5
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-3);
  }

  {  // 4 makro_limit: the loader
    arrdatei::Ordner o("test_arr_rack");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto z = [](int makro, int stufe, int param, const char* von = "0", const char* bis = "1") {
      return "{\"makro\":" + std::to_string(makro) + ",\"stufe\":" + std::to_string(stufe) + ",\"param\":" + std::to_string(param) + ",\"von\":" + von + ",\"bis\":" + bis + "}";
    };
    auto liste = [](const std::vector<std::string>& v) {
      std::string s;
      for (size_t i = 0; i < v.size(); ++i) s += (i ? "," : "") + v[i];
      return s;
    };
    const std::string kette = ",\"chain\":[{\"art\":\"komp\",\"slot\":1},{\"art\":\"eq\",\"slot\":1}]";
    auto rack = [](int slot, const std::string& ziele) { return ",\"rack\":{\"slot\":" + std::to_string(slot) + ",\"ziele\":[" + ziele + "]}"; };
    auto spur = [&](const std::string& extra) {
      return "{\"nr\":1,\"art\":\"audio\"" + extra + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}";
    };
    auto spur2 = [&](const std::string& extra) {
      return "{\"nr\":2,\"art\":\"audio\"" + extra + ",\"clips\":[" + o.clip("c2", 0.0, 1.0, a, 48000) + "]}";
    };
    auto grund = [&](int64_t nr, const std::string& spuren) {
      o.wiedergabe2_ret(nr, spuren, "", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    // sixteen mappings load and arrive as written
    std::vector<std::string> sechzehn;
    for (int i = 0; i < cdj::ARR_MAKRO_ZIELE; ++i) sechzehn.push_back(z(i % 4, 0, 1 + (i % 8), "-60", "0"));
    // the same target twice is refused, so sixteen distinct targets: komp 1..8 on stage 0, eq b1/freq, b1/gain, b1/q, b2/freq, b2/gain, b2/q, b3/gain, b3/q on stage 1
    sechzehn.clear();
    for (int p = 1; p <= 8; ++p) sechzehn.push_back(z(p % 4, 0, p));
    const int eq_p[8] = {1, 5, 6, 7, 12, 13, 14, 20};
    for (int p : eq_p) sechzehn.push_back(z(p % 4, 1, p));
    PRUEF(static_cast<int>(sechzehn.size()) == cdj::ARR_MAKRO_ZIELE);
    PRUEF(grund(80, spur(kette + rack(1, liste(sechzehn)))) == "+snap");
    {
      o.wiedergabe2_ret(81, spur(kette + rack(3, z(2, 1, 6, "0", "12") + "," + z(0, 0, 1, "-60", "0"))), "", "");
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 81, cache);
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrRack& r = e.snap->rack[0];
        PRUEF(r.slot == 2 && r.n == 2);
        PRUEF(r.z[0].makro == 2 && r.z[0].stufe == 1 && r.z[0].param == 6 && r.z[0].von == 0.0f && r.z[0].bis == 12.0f);
        PRUEF(r.z[1].makro == 0 && r.z[1].stufe == 0 && r.z[1].param == 1 && r.z[1].von == -60.0f && r.z[1].bis == 0.0f);
        PRUEF(e.snap->rack[1].slot == -1 && e.snap->rack[1].n == 0);   // negative control: a strip without a rack stays without
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // the 17th mapping is refused (every other of its entries is valid; the 16 above loaded)
    std::vector<std::string> siebzehn = sechzehn;
    siebzehn.push_back(z(1, 1, 21));
    PRUEF(grund(82, spur(kette + rack(1, liste(siebzehn)))) == "format");
    // other refusals, each next to a valid sibling
    PRUEF(grund(83, spur(kette + rack(0, z(0, 0, 1)))) == "format");                      // rack slot 0
    PRUEF(grund(84, spur(kette + rack(cdj::ARR_RACKS + 1, z(0, 0, 1)))) == "format");     // one beyond the pool
    PRUEF(grund(85, spur(kette + rack(cdj::ARR_RACKS, z(0, 0, 1)))) == "+snap");          // the last slot is fine
    PRUEF(grund(86, spur(kette + rack(1, z(4, 0, 1)))) == "format");                      // macro number 4 (0..3)
    PRUEF(grund(87, spur(kette + rack(1, z(0, 2, 1)))) == "format");                      // stage 2 is not in the chain of two
    PRUEF(grund(88, spur(kette + rack(1, z(0, 0, 0)))) == "format");                      // the stage switch an
    PRUEF(grund(89, spur(kette + rack(1, z(0, 0, 9)))) == "format");                      // the compressor key sc
    PRUEF(grund(90, spur(kette + rack(1, z(0, 0, 10)))) == "format");                     // beyond the parameters of the compressor
    PRUEF(grund(91, spur(kette + rack(1, z(0, 1, 58)))) == "+snap");                      // the last eq parameter is fine
    PRUEF(grund(92, spur(kette + rack(1, z(0, 1, 59)))) == "format");                     // one beyond the eq
    PRUEF(grund(93, spur(kette + rack(1, z(0, 0, 1) + "," + z(1, 0, 1)))) == "format");   // the same target twice
    PRUEF(grund(94, spur(kette + rack(1, z(0, 0, 1) + "," + z(1, 0, 2)))) == "+snap");    // two different targets of one macro / two macros are fine
    PRUEF(grund(95, spur(kette + rack(1, z(0, 0, 1, "0", "nan")))) == "format");          // not a number
    PRUEF(grund(96, spur(rack(1, z(0, 0, 1)))) == "format");                              // a rack without a chain has nothing to map
    PRUEF(grund(97, spur(kette + rack(1, z(0, 0, 1))) + "," + spur2(kette.substr(0, 0) + ",\"chain\":[{\"art\":\"komp\",\"slot\":2}]" + rack(1, z(0, 0, 1)))) == "format");   // rack slot 1 on two strips
    PRUEF(grund(98, spur(kette + rack(1, z(0, 0, 1))) + "," + spur2(",\"chain\":[{\"art\":\"komp\",\"slot\":2}]" + rack(2, z(0, 0, 1)))) == "+snap");   // two racks, two slots
    PRUEF(grund(99, spur(kette + ",\"rack\":{\"slot\":1}")) == "format");                 // no `ziele`
    PRUEF(grund(100, spur(kette + rack(1, ""))) == "+snap");                              // an empty table is a rack with no mapping
  }

  {  // 5 makro_weg
    TR(t) TR(ref)
    stufen_an(t); stufen_an(ref);
    setze(t, rk(1, 1), 1.0f); setze(t, "ins/komp/1/schwelle", -5.0f);
    setze(ref, "ins/komp/1/schwelle", -5.0f);
    laden_start(t, beide(&s1k->a, true, 1));
    t.lauf(60000);
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), 0.0, 1e-4);   // the macro drives (bis = 0)
    t.laden(beide(&s1k->a, false, 2));   // the swap loses the rack
    t.lauf(t.s + 256);
    std::printf("5: after the swap without the rack: schwelle %.3f (row -5)\n", t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE));
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -5.0, 1e-4);
    PRUEF(!t.arr.inserts().makro_treibt(G_KOMP, P_SCHWELLE));
    // the swap keeps the rack but drops one mapping: the other still drives (negative control)
    TR(u)
    stufen_an(u);
    setze(u, rk(1, 1), 1.0f); setze(u, rk(1, 2), 1.0f);
    setze(u, "ins/komp/1/schwelle", -5.0f); setze(u, "ins/eq/1/b1/gain", -3.0f);
    laden_start(u, beide(&s1k->a, true, 1));
    u.lauf(60000);
    Bau b(2);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &s1k->a);
    b.kette(1, {KOMP, EQ}).rack(1, 0, {ziel(1, 1, P_B1_GAIN, 0.0f, 12.0f)});
    u.laden(b.fertig());
    u.lauf(u.s + 256);
    PRUEF_NAH(u.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -5.0, 1e-4);   // handed back
    PRUEF_NAH(u.arr.inserts().wirksam(G_EQ, P_B1_GAIN), 12.0, 1e-4);      // still driven
  }

  {  // 6 makro_ohne_rack
    TR(a) TR(b)
    stufen_an(a); stufen_an(b);
    setze(b, rk(1, 1), 1.0f); setze(b, rk(1, 2), 1.0f);   // the macro rows move, no rack in the snapshot
    setze(a, "ins/komp/1/schwelle", -30.0f); setze(b, "ins/komp/1/schwelle", -30.0f);
    spiele(a, beide(&s1k->a, false), 120000);
    spiele(b, beide(&s1k->a, false), 120000);
    PRUEF(rms(a.pml, VON, BIS) > 0.01);
    PRUEF(gleich_bits(a.pml, b.pml, 0, 120000));
    PRUEF_NAH(b.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-4);
    PRUEF(!b.arr.inserts().makro_treibt(G_KOMP, P_SCHWELLE));
  }

  {  // 7 makro_zwei_racks: tracks 1 and 2, racks in the pool slots 0 and 5, each drives the eq / komp of its own strip only
    TR(t)
    stufen_an(t);
    setze(t, "ins/komp/2/an", 1.0f);
    setze(t, rk(1, 1), 1.0f);
    setze(t, rk(6, 1), 0.25f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &s1k->a);
    b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, &s1k->a);
    b.kette(1, {KOMP}).rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
    b.kette(2, {ArrStufe{ArrInsArt::komp, 1, true}}).rack(2, 5, {ziel(0, 0, P_SCHWELLE, -40.0f, 0.0f)});
    spiele(t, b.fertig(), 60000);
    const int g2 = cdj::ins_global(ArrInsArt::komp, 1);
    std::printf("7: track 1 rack 1 -> %.3f, track 2 rack 6 -> %.3f\n", t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), t.arr.inserts().wirksam(g2, P_SCHWELLE));
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), 0.0, 1e-4);
    PRUEF_NAH(t.arr.inserts().wirksam(g2, P_SCHWELLE), -30.0, 1e-4);
  }

  {  // 8 makro_pool: the rack pool of the core equals the rows of the table (the contract says 12 racks of 4 macros)
    TR(t)
    PRUEF(t.tab.suche(rk(cdj::ARR_RACKS, cdj::ARR_MAKROS).c_str()) >= 0);
    PRUEF(t.tab.suche(rk(cdj::ARR_RACKS + 1, 1).c_str()) < 0);
    PRUEF(t.tab.suche(rk(1, cdj::ARR_MAKROS + 1).c_str()) < 0);
    PRUEF(t.tab.suche(rk(1, 0).c_str()) < 0);
    const int r = t.tab.suche("rack/7/m3");
    PRUEF(r >= 0);
    if (r >= 0) {
      PRUEF_NAH(t.tab.def(r).min, 0.0, 0.0);
      PRUEF_NAH(t.tab.def(r).max, 1.0, 0.0);
      PRUEF_NAH(t.tab.def(r).vorgabe, 0.0, 0.0);
    }
  }

  {  // 10 keine_knackser: a macro sweep is as click-free as the knob of the parameter itself
    // The same sweep twice on the same material: (X) through the macro rows, (Y) through the own rows of the parameters (the knob that is accepted today). Metric: the
    // largest second difference of the PM tap after the start-up, d2[n] = y[n] - 2 y[n-1] + y[n-2]. A smooth change of level or threshold keeps it near that of a
    // steady signal at the same level; a click makes it jump. The instrument is checked against a click it must see (the same signal with one hard x4 step).
    const float m1[9] = {0.0f, 0.5f, 1.0f, 0.5f, 0.0f, 1.0f, 0.25f, 1.0f, 0.0f};   // threshold -60..0 (steps of 30 dB!)
    const float m2[9] = {0.0f, 1.0f, 0.25f, 1.0f, 0.0f, 0.75f, 1.0f, 0.0f, 1.0f};   // eq gain 0..12 dB (steps of up to 12 dB!)
    auto d2max = [](const std::vector<float>& y, int64_t von, int64_t bis) {
      double m = 0.0;
      for (int64_t i = von + 2; i < bis; ++i) m = std::max(m, std::fabs(static_cast<double>(y[i]) - 2.0 * y[i - 1] + y[i - 2]));
      return m;
    };
    TR(x) TR(y)
    stufen_an(x); stufen_an(y);
    laden_start(x, beide(&s1k->a, true, 1));
    laden_start(y, beide(&s1k->a, false, 2));
    x.lauf(70000); y.lauf(70000);   // past the two-beat count-in (45000 samples) and the start-up of the stages
    const int64_t START = x.s;
    PRUEF(START == y.s);
    for (int i = 0; i < 9; ++i) {
      setze(x, rk(1, 1), m1[i]); setze(x, rk(1, 2), m2[i]);
      setze(y, "ins/komp/1/schwelle", -60.0f + 60.0f * m1[i]); setze(y, "ins/eq/1/b1/gain", 12.0f * m2[i]);
      x.lauf(x.s + 4800); y.lauf(y.s + 4800);   // 100 ms per step: a hard drag
    }
    const int64_t ENDE = x.s;
    // the steady reference: macro 2 and 1 held at 1 (full gain, threshold 0) for the same length
    TR(f)
    stufen_an(f);
    setze(f, rk(1, 1), 1.0f); setze(f, rk(1, 2), 1.0f);
    laden_start(f, beide(&s1k->a));
    f.lauf(ENDE);
    const double dx = d2max(x.pml, START, ENDE), dy = d2max(y.pml, START, ENDE), df = d2max(f.pml, START, ENDE);
    // the instrument sees a click: one hard x4 level step in the reference, in the middle of the run
    std::vector<float> klick = f.pml;
    for (int64_t i = START + 30000; i < ENDE; ++i) klick[i] *= 4.0f;
    const double dk = d2max(klick, START, ENDE);
    std::printf("10: max second difference: macro sweep %.5f, own-row sweep %.5f, steady full level %.5f, steady with a x4 click %.5f\n", dx, dy, df, dk);
    double diffmax = 0.0, ymax = 0.0;
    for (int64_t i = START; i < ENDE; ++i) { diffmax = std::max(diffmax, static_cast<double>(std::fabs(x.pml[i] - y.pml[i]))); ymax = std::max(ymax, static_cast<double>(std::fabs(y.pml[i]))); }
    std::printf("10: largest sample difference between the macro sweep and the own-row sweep %.5f (peak %.4f)\n", diffmax, ymax);
    // the sweep really did something: a run with both macros held at 0 differs from it (otherwise "equal to the own row" would be two silent runs agreeing)
    TR(n0)
    stufen_an(n0);
    laden_start(n0, beide(&s1k->a));
    n0.lauf(ENDE);
    double gegen_null = 0.0;
    for (int64_t i = START; i < ENDE; ++i) gegen_null = std::max(gegen_null, static_cast<double>(std::fabs(x.pml[i] - n0.pml[i])));
    std::printf("10: largest sample difference between the macro sweep and macros held at 0: %.5f\n", gegen_null);
    PRUEF(gegen_null > 0.05);
    PRUEF(diffmax < 1e-4);               // the macro path gives the signal of the own-row knob (same linear map, same 10 ms ramp)
    PRUEF(df > 0.0 && rms(x.pml, START, ENDE) > 0.01);
    PRUEF(dk > 3.0 * df);                // the metric sees a click
    PRUEF(dx <= 1.15 * df + 1e-6);       // no click in the macro sweep: nothing above what the steady signal at full level reaches
    PRUEF(dx <= 1.25 * dy + 1e-6);       // and not worse than the own-row knob
  }

  {  // 11 kosten_ohne_rack: a playback without any rack adds a loop over the strips per block, nothing measurable
    // The lane gate of the plan is 1500 us per block of 32 strips with chains; the check here is the call itself on a snapshot with chains but no rack.
    cdj::ArrSnapshot* s = beide(&s1k->a, false, 1);
    cdj::ArrInserts ins;
    constexpr int N = 200000;
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) ins.makros_planen(s->kette, s->rack, 256);
    const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count() / N;
    std::printf("11: makros_planen without a rack: %.1f ns per block (%d calls)\n", ns, N);
    PRUEF(ns < 5000.0);   // generous: 5 us is 0.3 % of the 1500 us lane gate; the measured value is far below
    // for comparison: the same call with a rack of two mappings (the stages are not owned by a strip here, so the mappings are skipped: informational only)
    cdj::ArrSnapshot* r = beide(&s1k->a, true, 2);
    const auto t1 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) ins.makros_planen(r->kette, r->rack, 256);
    const double ns_rack = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t1).count() / N;
    std::printf("11: makros_planen with a rack of two mappings: %.1f ns per block\n", ns_rack);
    delete s;
    delete r;
  }

  {  // 12 naht: the very request the page writes for a project with a rack (data/wiedergabe_rack.json, kept current by ui/tests/seam_core_playback.test.mjs)
    std::string text;
    {
      std::FILE* f = std::fopen((std::string(CYPHERDJ_DJK) + "/core/tests/data/wiedergabe_rack.json").c_str(), "rb");
      PRUEF(f != nullptr);
      if (f) {
        char b[4096];
        size_t n;
        while ((n = std::fread(b, 1, sizeof b, f)) > 0) text.append(b, n);
        std::fclose(f);
      }
    }
    PRUEF(text.size() > 100);   // an empty read would make the checks below pass for the wrong reason
    arrdatei::Ordner o("test_arr_rack_naht");
    o.sinus('c', 400000, 1000.0, 0.5f);
    for (size_t at; (at = text.find("@AUDIO@")) != std::string::npos;) text.replace(at, 7, o.pfad + "/audio");
    o.roh(1, text);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 1, cache);
    std::printf("12: load grund='%s' snap=%d\n", e.grund.c_str(), e.snap ? 1 : 0);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrRack& r = e.snap->rack[0];
      PRUEF(r.slot == 0 && r.n == 1);
      PRUEF(r.z[0].makro == 0 && r.z[0].stufe == 0 && r.z[0].param == 1 && r.z[0].von == 0.0f && r.z[0].bis == -60.0f);
      PRUEF(e.snap->rack[1].slot == -1 && e.snap->rack[1].n == 0);   // negative control: a strip without a rack stays without
      std::printf("12: rack of track 1: slot %d, %d mapping(s), macro %d -> stage %d param %d, %g .. %g\n", r.slot, r.n, r.z[0].makro, r.z[0].stufe, r.z[0].param, r.z[0].von, r.z[0].bis);
    }
  }

  {  // 9 keine_allokation
    TR(t)
    stufen_an(t);
    cdj::ArrSnapshot* s0 = beide(&s1k->a, true, 1);
    cdj::ArrSnapshot* s1 = beide(&s1k->a, false, 2);
    cdj::ArrSnapshot* s2 = beide(&s1k->a, true, 3);
    laden_start(t, s0);
    t.lauf(20000);
    float b[6][cdj::ARR_BLOCK];
    int64_t s = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(4);   // the vector itself must not allocate inside the window
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 700) alt.push_back(t.arr.tausche(s1, s, t.k));
      if (blk == 1300) alt.push_back(t.arr.tausche(s2, s, t.k));
      t.arr.setze_sofort(t.tab.suche(rk(1, 1).c_str()), static_cast<float>(blk % 17) / 16.0f);
      t.arr.setze_sofort(t.tab.suche(rk(1, 2).c_str()), static_cast<float>(blk % 13) / 12.0f);
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      s += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("9: allocations in 2000 blocks = %ld\n", im_fenster);
    PRUEF(im_fenster == 0);
    PRUEF(t.arr.inserts().lief(G_KOMP) && t.arr.inserts().lief(G_EQ));   // the stages ran, 0 allocations of an empty run prove nothing
    PRUEF(t.arr.inserts().makro_treibt(G_KOMP, P_SCHWELLE));
    for (const cdj::ArrSnapshot* x : alt) delete x;
    abfang_an();
    { cdj::ArrInserts zweites; }
    const long bau_zaehlt = abfang_aus();
    PRUEF(bau_zaehlt > 0);   // positive control: the watcher counts
  }

  PRUEF_ENDE();
}
