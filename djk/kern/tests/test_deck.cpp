// Deck im Direktweg (deck.h, SCHNITTSTELLEN §4.4, §5.5, §13.1): liest bitgenau am Soll-Lesekopf, Start mitten im Block,
// 128-Frame-Blende auf laufendem Deck, Stopp mit 10-ms-Rampe, Ende des Materials, Stems mit Pegeln, Rückgabe erst nach
// der Blende. Material im Speicher: Frame f trägt links f und rechts −f (float exakt bis 2^24). Scheibe 31.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>

#include <cypherdj/dsp/werte.h>

#include "cypherdj/deck.h"
#include "pruef.h"
#include "sprungmass.h"

static bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

struct Probe {
  std::vector<float> d[cdj::STEM_ANZAHL];
  cdj::Material m{};
  Probe(int64_t frames, int n_quellen, float (*wert)(int k, int64_t f, int kanal)) {
    std::snprintf(m.material_id, sizeof m.material_id, "c1c0000000000201");
    m.basis_bpm = 128.0;
    m.fassung = 1;
    m.n_quellen = n_quellen;
    m.mit_stems = n_quellen == 4;
    m.frames = frames;
    m.erster_schlag_frame = 0;
    for (int k = 0; k < n_quellen; ++k) {
      d[k].resize(2 * frames);
      for (int64_t f = 0; f < frames; ++f) {
        d[k][2 * f] = wert(k, f, 0);
        d[k][2 * f + 1] = wert(k, f, 1);
      }
      m.quelle[k] = d[k].data();
    }
  }
};

static float rampe(int, int64_t f, int kanal) { return kanal == 0 ? (float)f : -(float)f; }
static float sinus100(int, int64_t f, int) { return (float)(0.5 * std::sin(2.0 * M_PI * 100.0 * (double)f / 48000.0)); }

int main() {
  Probe p(200000, 1, rampe);
  std::vector<float> l(4096), r(4096);
  auto leer = [&] { std::fill(l.begin(), l.end(), 0.0f); std::fill(r.begin(), r.end(), 0.0f); };

  // 1) Negativ-Kontrolle: geladen, nicht gestartet -> der Block bleibt bitgleich 0
  cdj::Deck d;
  d.lade(&p.m, 0);
  leer();
  g_waechter = true;
  d.block(0, 2048, l.data(), r.data(), 0);
  g_waechter = false;
  bool still = true;
  for (int i = 0; i < 2048; ++i) still = still && l[i] == 0.0f && r[i] == 0.0f;
  PRUEF(still && !d.laeuft() && d.geladen());
  PRUEF_NAH(d.quell_beat_bei(0), 0.0, 0.0);

  // 2) Start mitten im Block (der Kern teilt am Ziel-Sample): ab Sample 1000 erklingt Frame 500. F10 (Welle 2): aus dem
  // Stand blendet das Deck über DECK_START_EIN Frames ein (Gain (k+1)/N wie blende.h), danach bitgenau.
  leer();
  g_waechter = true;
  d.block(0, 1000, l.data(), r.data(), 0);
  d.start(1000, 500);
  d.block(1000, 3096, l.data() + 1000, r.data() + 1000, 1000);
  g_waechter = false;
  bool genau = true, ein = true;
  for (int i = 0; i < 4096; ++i) {
    const float soll = i < 1000 ? 0.0f : (float)(500 + i - 1000);
    if (i >= 1000 && i < 1000 + cdj::DECK_START_EIN) {
      const float g = (float)(i - 1000 + 1) / (float)cdj::DECK_START_EIN;
      ein = ein && std::fabs(l[i] - soll * g) <= 1e-5f * soll && std::fabs(r[i] + soll * g) <= 1e-5f * soll;
      continue;
    }
    genau = genau && l[i] == soll && r[i] == -soll;
  }
  PRUEF(genau);
  PRUEF(ein);
  PRUEF(g_allokationen == 0);
  PRUEF(d.laeuft() && d.frame_bei(4096) == 3596);
  PRUEF_NAH(d.quell_beat_bei(1000), 500.0 / 22500.0, 1e-12);
  PRUEF_NAH(d.beats_bis_ende_bei(1000), (200000.0 - 500.0) / 22500.0, 1e-12);
  // 2b) F10 Fehlerfall am Sinus (Erhebung deck_probe P1: 0,5000, x76,4): Start aus dem Stand auf der Spitze (Frame 120 eines
  // 100-Hz-Sinus, 0,5). Soll: größter Sprung <= 0,5/DECK_START_EIN + natürlich, danach bitgenau das Material.
  {
    Probe ps(48000, 1, sinus100);
    cdj::Deck dsin;
    dsin.lade(&ps.m, 0);
    std::vector<float> yl(4096, 0.0f), yr(4096, 0.0f);
    dsin.block(0, 1000, yl.data(), yr.data(), 0);
    dsin.start(1000, 120);
    dsin.block(1000, 3096, yl.data() + 1000, yr.data() + 1000, 1000);
    const sprung::Mass m = sprung::messe(yl, 900, 1300);
    const double grenze = 0.5 / cdj::DECK_START_EIN + sprung::natuerlich(100.0, 0.5);
    std::printf("F10 Start aus dem Stand: größter Sprung %.5f bei %lld (Grenze %.5f)\n", m.d1, (long long)m.ort1, grenze);
    PRUEF(m.d1 <= grenze + 1e-6);
    bool danach = true;
    for (int i = 1000 + cdj::DECK_START_EIN; i < 4096; ++i) danach = danach && yl[i] == sinus100(0, 120 + i - 1000, 0);
    PRUEF(danach);
  }
  // 2c) F10 x F27: zweiter Kopfwechsel in der Einblende (Start auf schon laufendem Deck 20 Samples nach dem Start aus dem
  // Stand, Spitze -> Tal). Der alte Kopf blendet vom Ist-Gain der Einblende aus, nicht von 1 (sonst Sprung ~0,28).
  {
    Probe ps(48000, 1, sinus100);
    cdj::Deck d2;
    d2.lade(&ps.m, 0);
    std::vector<float> yl(4096, 0.0f), yr(4096, 0.0f);
    d2.start(1000, 120);
    d2.block(1000, 20, yl.data() + 1000, yr.data() + 1000, 0);
    d2.start(1020, 360);  // Tal (−0,5), Deck läuft: 128-Frame-Blende
    d2.block(1020, 3076, yl.data() + 1020, yr.data() + 1020, 0);
    const sprung::Mass m = sprung::messe(yl, 900, 1400);
    const double grenze = 0.5 / cdj::DECK_START_EIN + 1.0 / cdj::DECK_BLENDE + sprung::natuerlich(100.0, 0.5);
    std::printf("F10 zweiter Start in der Einblende: größter Sprung %.5f bei %lld (Grenze %.5f)\n", m.d1, (long long)m.ort1, grenze);
    PRUEF(m.d1 <= grenze + 1e-6);
  }

  // 3) Start auf laufendem Deck: 128-Frame-Blende vom alten Lesekopf, danach bitgenau die neue Stelle
  leer();
  d.block(4096, 100, l.data(), r.data(), 0);
  d.start(4096 + 100, 50000);
  d.block(4096 + 100, 400, l.data() + 100, r.data() + 100, 100);
  bool blende = true;
  for (int k = 0; k < 128; ++k) {
    const float w = (float)(k + 1) / 128.0f;
    const float alt = (float)(3596 + 100 + k), neu = (float)(50000 + k);
    blende = blende && std::fabs(l[100 + k] - (neu * w + alt * (1.0f - w))) <= 0.02f;  // float bei 50 000
  }
  PRUEF(blende);
  PRUEF(l[100 + 128] == 50128.0f && l[499] == (float)(50000 + 399));

  // 4) Stopp: 10-ms-Rampe (480 Samples), danach Stille, Position bleibt am Ende der Rampe
  leer();
  const int64_t s_stopp = 4096 + 500;
  const int64_t ende = d.stopp(s_stopp);
  PRUEF(ende == s_stopp + 480);
  d.block(s_stopp, 1000, l.data(), r.data(), 0);
  PRUEF(l[0] == (float)(50400) * (479.0f / 480.0f));
  PRUEF(l[479] == 0.0f && l[480] == 0.0f && l[999] == 0.0f && !d.laeuft());
  PRUEF(d.position() == 50400 + 480);

  // 5) Ende des Materials: läuft bis zum letzten Frame, dann steht es (§1.6: zu Ende gelaufen = nicht hörbar)
  leer();
  d.start(10000, 199990);
  d.block(10000, 100, l.data(), r.data(), 0);
  PRUEF(std::fabs(l[9] - 199999.0f * 10.0f / (float)cdj::DECK_START_EIN) <= 0.05f && l[10] == 0.0f && !d.laeuft() &&
        d.position() == 200000);
  PRUEF_NAH(d.beats_bis_ende_bei(10100), 0.0, 0.0);

  // 6) Stems: Summe ((drums + bass) + vocals) + other, 0 dB bitgleich; vocals stumm; Verlauf je Sample
  auto stemwert = [](int k, int64_t f, int kanal) -> float {
    const float basis[4] = {0.1f, 0.01f, 0.3f, 0.0007f};
    return basis[k] * (float)((f % 7) + 1) * (kanal ? -1.0f : 1.0f);
  };
  Probe st(1000, 4, stemwert);
  cdj::Deck ds;
  ds.lade(&st.m, 0);
  ds.start(0, 0);
  leer();
  ds.block(0, 100, l.data(), r.data(), 0);
  bool summe = true;
  for (int f = 0; f < 100; ++f) {
    if (f < cdj::DECK_START_EIN) continue;  // F10: Einblende
    float soll = ((stemwert(0, f, 0) + stemwert(1, f, 0)) + stemwert(2, f, 0)) + stemwert(3, f, 0);
    summe = summe && l[f] == soll;
  }
  PRUEF(summe);
  ds.stem_db(2, -200.0f);  // vocals stumm (§1.2: ≤ −120 ist stumm, linear exakt 0)
  leer();
  ds.block(100, 100, l.data(), r.data(), 0);
  bool ohne_vocals = true;
  for (int i = 0; i < 100; ++i) {
    const int f = 100 + i;
    if (f < cdj::DECK_START_EIN) continue;
    ohne_vocals = ohne_vocals && l[i] == ((stemwert(0, f, 0) + stemwert(1, f, 0)) + 0.0f) + stemwert(3, f, 0);
  }
  PRUEF(ohne_vocals);
  std::vector<float> vl(100, -6.0f);  // Verlauf: drums −6 dB je Sample
  ds.stem_db(2, 0.0f);
  ds.stem_verlauf(0, vl.data());
  leer();
  ds.block(200, 100, l.data(), r.data(), 0);
  const float g6 = (float)cypherdj::dsp::db_zu_linear(-6.0);
  PRUEF(l[0] == ((stemwert(0, 200, 0) * g6 + stemwert(1, 200, 0)) + stemwert(2, 200, 0)) + stemwert(3, 200, 0));
  ds.verlauf_ende(100);
  leer();
  ds.block(300, 1, l.data(), r.data(), 0);  // nach dem Verlauf gilt sein letzter Wert
  PRUEF(l[0] == ((stemwert(0, 300, 0) * g6 + stemwert(1, 300, 0)) + stemwert(2, 300, 0)) + stemwert(3, 300, 0));

  // 7) Laden auf laufendem Deck: das alte Material blendet 128 Frames aus, erst danach kommt es zurück (einmal)
  Probe q(200000, 1, rampe);
  cdj::Deck dl;
  dl.lade(&p.m, 0);
  dl.start(0, 1000);
  leer();
  dl.block(0, 256, l.data(), r.data(), 0);
  PRUEF(dl.rueckgabe() == nullptr);
  dl.lade(&q.m, 256);
  PRUEF(dl.rueckgabe() == nullptr);  // noch in der Blende
  leer();
  dl.block(256, 100, l.data(), r.data(), 0);
  PRUEF(dl.rueckgabe() == nullptr);
  PRUEF(std::fabs(l[0] - (float)(1256) * (127.0f / 128.0f)) <= 1e-2f);  // alt, ausblendend
  dl.block(356, 100, l.data(), r.data(), 0);
  PRUEF(dl.rueckgabe() == &p.m);
  PRUEF(dl.rueckgabe() == nullptr);
  PRUEF(dl.geladen() && !dl.laeuft() && dl.material() == &q.m);
  // Laden auf stehendem Deck: sofort zurück
  dl.lade(&p.m, 1000);
  PRUEF(dl.rueckgabe() == &q.m);

  // 8) Langlauf in 256er-Blöcken: nach 150 000 Samples genau Frame 149 999 (Drift 0; die Mutation
  //    CYPHERDJ_MUTATION_DECK_DRIFT liest 1e-5 zu schnell und liegt dort 1,5 Frames daneben)
  cdj::Deck dd;
  dd.lade(&p.m, 0);
  dd.start(0, 0);
  bool ohne_drift = true;
  for (int64_t s = 0; s < 150000; s += 250) {
    leer();
    dd.block(s, 250, l.data(), r.data(), 0);
    ohne_drift = ohne_drift && l[0] == (float)s && l[249] == (float)(s + 249);
  }
  PRUEF(ohne_drift);

  // 9) Plan E9 T2: springe. Steht: Position + delta, begrenzt auf [0, frames], kein Ton. Läuft: ab s liest der Kopf
  //    frame_bei(s) + delta, nach der 128-Frame-Blende bitgenau (die Rampe zeigt den gelesenen Frame).
  cdj::Deck dj;
  dj.lade(&p.m, 0);
  dj.setze_position(1000);
  dj.springe(0, 500);
  PRUEF(dj.position() == 1500 && !dj.laeuft());
  dj.springe(0, -10'000'000);
  PRUEF(dj.position() == 0);
  dj.springe(0, 10'000'000);
  PRUEF(dj.position() == 200000);
  dj.start(0, 2000);
  leer();
  dj.block(0, 100, l.data(), r.data(), 0);
  g_waechter = true;
  dj.springe(100, 22500);
  PRUEF(dj.frame_bei(100) == 2000 + 100 + 22500 && dj.frame_bei(200) == 2000 + 200 + 22500);
  leer();
  dj.block(100, 1000, l.data(), r.data(), 0);
  g_waechter = false;
  PRUEF(l[0] != (float)(2000 + 100 + 22500));   // Negativ: im ersten Frame mischt die Blende noch den alten Kopf
  bool nach_blende = true;
  for (int i = cdj::DECK_BLENDE; i < 1000; ++i) nach_blende = nach_blende && l[i] == (float)(2000 + 100 + i + 22500);
  PRUEF(nach_blende);

  // 10) Plan E9 T11: Loop-Naht. Loop [10 000, 10 000 + 3 000) auf laufendem Deck: der Kopf kehrt an der Naht auf 10 000
  //     zurück (128-Frame-Blende), wiederholt sich, das Materialende wird nie erreicht; loop_aus: linear weiter.
  cdj::Deck dl2;
  dl2.lade(&p.m, 0);
  dl2.start(0, 9000);
  dl2.loop_an(0, 10000, 3000);
  PRUEF(dl2.loop_aktiv());
  std::vector<float> ll(20000), rr(20000);
  g_waechter = true;
  for (int s = 0; s < 20000; s += 256) dl2.block(s, std::min(256, 20000 - s), ll.data() + s, rr.data() + s, 0);
  g_waechter = false;
  // Naht 1 bei Sample 4000 (Frame 13 000 → 10 000), Naht 2 bei 7000, …: die Blende liegt in den 128 Samples VOR jeder
  // Naht (neuer Kopf ab 10 000 − 128), an der Naht selbst und danach liest der Kopf exakt 10 000 + x.
  bool im_loop = true;
  for (int s = 4000; s < 20000; ++s) {
    const int x = (s - 4000) % 3000;
    if (x >= 3000 - cdj::DECK_BLENDE) continue;   // Blende vor der nächsten Naht
    im_loop = im_loop && ll[s] == (float)(10000 + x);
  }
  PRUEF(im_loop);
  PRUEF(ll[4000] == 10000.0f);                          // an der Naht voll der Loop-Anfang (Transient bleibt)
  PRUEF(ll[3871] == 12871.0f);                          // vor der Blende linear
  PRUEF(ll[3900] > 9872.5f && ll[3900] < 12899.5f && ll[3900] != 12900.0f);   // in der Blende gemischt
  PRUEF(dl2.beats_bis_ende_bei(20000) == INFINITY);    // Attrappe: d.loop ? Infinity
  // Sprung im Loop verschiebt den Loop mit (Attrappe decks.mjs 'sprung': ls + delta)
  dl2.springe(20000, 500);
  std::vector<float> l3(8000), r3(8000);
  for (int s = 0; s < 8000; s += 256) dl2.block(20000 + s, std::min(256, 8000 - s), l3.data() + s, r3.data() + s, 0);
  float mx = 0.0f, mn = 1e9f;
  for (int i = 3000; i < 8000; ++i) { mx = std::max(mx, l3[i]); mn = std::min(mn, l3[i]); }
  PRUEF(mn >= 10500.0f - cdj::DECK_BLENDE - 1.0f && mx <= 13500.0f);   // Fenster jetzt [10 500, 13 500), Blende davor
  // loop_aus: der Kopf läuft von der Stelle linear weiter, über die alte Naht hinaus
  dl2.loop_aus(0);  // Keylock Task 2: mit Sample (ohne Dehner ohne Wirkung)
  PRUEF(!dl2.loop_aktiv());
  std::vector<float> l4(8000), r4(8000);
  for (int s = 0; s < 8000; s += 256) dl2.block(28000 + s, std::min(256, 8000 - s), l4.data() + s, r4.data() + s, 0);
  bool linear = true;
  for (int i = 1; i < 8000; ++i) linear = linear && l4[i] == l4[i - 1] + 1.0f;
  PRUEF(linear && l4[7999] > 13500.0f);
  // Laden löscht den Loop
  dl2.loop_an(0, 10000, 3000);
  dl2.lade(&p.m, 36000);
  PRUEF(!dl2.loop_aktiv());

  // 11) Plan-Review E9 Befund 1/2: eine Stopp-Rampe über die Naht hält das Deck an (vorher lief es weiter), Stopp und
  //     Start beenden den Loop (Attrappe decks.mjs stoppeDeck/starteDeck), ein Sprung in der Rampe hebt den Stopp nicht auf.
  cdj::Deck dz;
  dz.lade(&p.m, 0);
  dz.start(0, 9000);
  dz.loop_an(0, 10000, 3000);   // Kopf bei Sample s liest 9000 + s: Frame 13 000 (Naht) bei Sample 4000
  std::vector<float> l5(6000), r5(6000);
  for (int s = 0; s < 3900; s += 256) dz.block(s, std::min(256, 3900 - s), l5.data() + s, r5.data() + s, 0);
  const int64_t ende_z = dz.stopp(3900);   // Rampe 3900 … 4380 überquert die Naht bei 4000
  PRUEF(ende_z == 3900 + cdj::DECK_STOPP_RAMPE);
  PRUEF(!dz.loop_aktiv());                // Stopp beendet den Loop (die Rampe läuft linear aus)
  for (int s = 3900; s < 6000; s += 256) dz.block(s, std::min(256, 6000 - s), l5.data() + s, r5.data() + s, 0);
  PRUEF(!dz.laeuft());
  PRUEF(l5[5000] == 0.0f && l5[5999] == 0.0f);
  // Start beendet einen Loop
  dz.loop_an(0, 10000, 3000);
  dz.start(6000, 20000);
  PRUEF(!dz.loop_aktiv());
  // Sprung in der Stopp-Rampe: der Stopp bleibt
  dz.stopp(6100);
  dz.springe(6200, 1000);
  std::vector<float> l6(2000), r6(2000);
  for (int s = 0; s < 2000; s += 256) dz.block(6000 + s, std::min(256, 2000 - s), l6.data() + s, r6.data() + s, 0);
  PRUEF(!dz.laeuft());

  // 12) Echtzeit: keine Allokation in block()
  PRUEF(g_allokationen == 0);
  // 12) Plan Grid T2: setze_raster. Steht: Position rückt um die Änderung, der Quell-Beat bleibt, schlag0 = Anker + v.
  //     Läuft: ab s liest der Kopf frame_bei(s) + Änderung (nach der Blende bitgenau). Laden setzt 0.
  cdj::Deck dg;
  dg.lade(&p.m, 0);
  const int64_t e0 = p.m.erster_schlag_frame;
  PRUEF(dg.schlag0() == e0 && dg.raster_versatz() == 0);
  dg.setze_position(e0 + 22500);
  const double q_vor = dg.quell_beat_bei(0);
  dg.setze_raster(0, 240);
  PRUEF(dg.schlag0() == e0 + 240 && dg.raster_versatz() == 240);
  PRUEF(dg.position() == e0 + 22500 + 240 && dg.quell_beat_bei(0) == q_vor);
  dg.setze_raster(0, -48);
  PRUEF(dg.position() == e0 + 22500 - 48 && dg.quell_beat_bei(0) == q_vor);
  dg.start(0, 5000);
  leer();
  dg.block(0, 100, l.data(), r.data(), 0);
  g_waechter = true;
  dg.setze_raster(100, 452);
  PRUEF(dg.frame_bei(100) == 5000 + 100 + 500);
  leer();
  dg.block(100, 1000, l.data(), r.data(), 0);
  g_waechter = false;
  bool nach = true;
  for (int i = cdj::DECK_BLENDE; i < 1000; ++i) nach = nach && l[i] == (float)(5000 + 100 + i + 500);
  PRUEF(nach);
  dg.lade(&p.m, 2000);
  PRUEF(dg.raster_versatz() == 0 && dg.schlag0() == e0);

  PRUEF_ENDE();
}
