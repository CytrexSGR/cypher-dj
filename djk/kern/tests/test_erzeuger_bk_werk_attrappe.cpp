// Baukasten S3b Task 2 (Review F2 N3): der Erzeuger mit Graph-Werk gegen eine Attrappe statt des Rust-Graphen. Das Programm
// linkt hall_ffi NICHT und definiert cypher_bk_* selbst: je Handle ein Eintrittszähler (zwei gleichzeitige Aufrufe am selben
// Handle zählen als Überlappung), ein Notenprotokoll und je gehaltene Note 0,5 am Ausgang ab ihrem Versatz. block() lässt
// sich an einem Handle festhalten (halt/los, im_rechnen meldet den Eintritt), so wird ein Faden verspätet.
// 4) verspaetet_kein_notenverlust  5) wechsel_bei_besetztem_platz  6) midi_offs_ohne_midi (B1)  7) fenster_kein_doppel (D8b)
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/graph_werk.h"
#include "pruef.h"

// ------------------------------------------------------------------------------------------------ Attrappe
struct CypherBk {
  std::atomic<int> drin{0};
  std::atomic<int> aufrufe{0};
  std::atomic<int> regler_aufrufe{0};  // S5r: Aufrufe von cypher_bk_regler (Task 3 prüft sie auf besetztem Platz)
  float regler_wert[8] = {0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f};
  std::atomic<bool> halt{false};   // nächster block() wartet auf los
  struct Ev { uint32_t versatz; uint8_t ton; bool an; };
  Ev offen_ev[256];                // vorgemerkt für den nächsten block()
  int n_ev = 0;
  bool klingt[128] = {};
  int an_zahl[128] = {}, aus_zahl[128] = {};
};

namespace {
std::atomic<int> g_ueberlappt{0};
std::atomic<bool> g_los{false}, g_im_rechnen{false};

struct Eintritt {
  CypherBk* h;
  explicit Eintritt(CypherBk* x) : h(x) {
    h->aufrufe.fetch_add(1);
    if (h->drin.fetch_add(1) != 0) g_ueberlappt.fetch_add(1);
  }
  ~Eintritt() { h->drin.fetch_sub(1); }
};

void merke(CypherBk* h, uint32_t v, uint8_t ton, bool an) {
  if (h->n_ev < 256) h->offen_ev[h->n_ev++] = CypherBk::Ev{v, ton, an};
  (an ? h->an_zahl : h->aus_zahl)[ton & 127]++;
}
}  // namespace

extern "C" {
CypherBk* cypher_bk_neu(const char*, double, char*, size_t) { return new CypherBk; }
void cypher_bk_frei(CypherBk* h) { delete h; }
int32_t cypher_bk_note_an(CypherBk* h, uint32_t v, uint8_t ton, float) { Eintritt e(h); merke(h, v, ton, true); return 0; }
int32_t cypher_bk_note_aus(CypherBk* h, uint32_t v, uint8_t ton) { Eintritt e(h); merke(h, v, ton, false); return 0; }
int32_t cypher_bk_alle_aus(CypherBk* h, uint32_t) { Eintritt e(h); return 0; }
int32_t cypher_bk_regler(CypherBk* h, uint32_t nr, float wert) {
  if (!h || nr < 1 || nr > 8) return -1;
  Eintritt e(h);
  h->regler_aufrufe.fetch_add(1);
  h->regler_wert[nr - 1] = wert;
  return 0;
}
int32_t cypher_bk_block(CypherBk* h, float* l, float* r, size_t n) {
  if (!h) { std::fill(l, l + n, 0.0f); std::fill(r, r + n, 0.0f); return 0; }
  Eintritt e(h);
  if (h->halt.exchange(false)) {
    g_im_rechnen.store(true);
    while (!g_los.load()) std::this_thread::sleep_for(std::chrono::microseconds(100));
  }
  for (size_t i = 0; i < n; ++i) {
    for (int k = 0; k < h->n_ev; ++k)
      if (h->offen_ev[k].versatz == i) h->klingt[h->offen_ev[k].ton & 127] = h->offen_ev[k].an;
    int z = 0;
    for (bool b : h->klingt) z += b;
    l[i] = r[i] = 0.5f * (float)z;
  }
  h->n_ev = 0;
  return 0;
}
uint32_t cypher_bk_latenz(const CypherBk*) { return 0; }
uint32_t cypher_bk_rettungen(const CypherBk*) { return 0; }
uint32_t cypher_bk_verloren(const CypherBk*) { return 0; }
uint32_t cypher_bk_panik(const CypherBk*) { return 0; }
}

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM bei 48 kHz
constexpr int ERZ2 = 5, ERZ3 = 6;
constexpr int ERZ_5 = 8, ERZ_6 = 9;   // S5r: Mixer-Kanäle von erz/5 und erz/6 (erz/4 nimmt der Kern nicht an)

void schlafe_ms(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }
void warte_im_rechnen() {
  for (int i = 0; i < 20000 && !g_im_rechnen.load(); ++i) std::this_thread::sleep_for(std::chrono::microseconds(100));
}

struct Welt {
  cdj::Karte karte{128.0, 0};
  std::unique_ptr<cdj::GraphWerk> werk;
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::MIX_KANAELE * N), pr = pl;
  float* l[cdj::MIX_KANAELE];
  float* r[cdj::MIX_KANAELE];
  std::vector<float> erz2, erz3;
  int64_t s = 0;
  explicit Welt(int faeden) {
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; }
    werk = cdj::graph_werk_neu({faeden});
    erz.setze_graph_werk(werk.get());
  }
  void ein(cdj::MidiAus* midi = nullptr) {
    std::fill(pl.begin(), pl.end(), 0.0f);
    std::fill(pr.begin(), pr.end(), 0.0f);
    if (midi) for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p) midi[p].leer();
    erz.block(karte, s, N, l, r, midi, s);
    erz2.insert(erz2.end(), l[ERZ2], l[ERZ2] + N);
    erz3.insert(erz3.end(), l[ERZ3], l[ERZ3] + N);
    s += N;
    schlafe_ms(1);
  }
  void bis(int64_t ende) { while (s < ende) ein(); }
};

cdj::ErzFenster fenster(int strom, std::initializer_list<cdj::ErzEv> evs) {
  cdj::ErzFenster f{};
  f.strom = strom;
  f.sendung = 1;
  f.ab_beat = 0.0;
  f.bis_beat = 64.0;
  for (const auto& e : evs) f.ev[f.n++] = e;
  return f;
}

cdj::ErzEv ev(double beat, int note, double dauer) {
  cdj::ErzEv e{beat, note, 1, 1.0f};
  e.dauer = dauer;
  return e;
}

double beat_von(int64_t smp) { return (double)smp / (double)SPB; }

void neu_lauf() { g_los.store(false); g_im_rechnen.store(false); }

}  // namespace

// S5r: Reglerwerte je Mixer-Kanal, je Zeile und Regler verschieden, keiner gleich 0,5 (dem Vorgabewert der Attrappe)
void regler_werte(float (*w)[8]) {
  for (int k = 0; k < cdj::MIX_KANAELE; ++k)
    for (int nr = 1; nr <= 8; ++nr) w[k][nr - 1] = 0.05f + 0.09f * (float)nr + 0.01f * (float)(k - 8) + 0.001f;
}
bool regler_gleich(const CypherBk* h, const float* soll) {
  for (int i = 0; i < 8; ++i) if (h->regler_wert[i] != soll[i]) return false;
  return true;
}

int main() {
  for (int faeden : {0, 1}) {  // S5r 8) regler_werk: Werte kommen am Handle des Stroms an, Gegenprobe erz/6, Änderung, Tausch (D5)
    neu_lauf();
    const int ue0 = g_ueberlappt.load();
    static float wert[cdj::MIX_KANAELE][8];
    regler_werte(wert);
    Welt w(faeden);
    w.erz.setze_bk_wert(wert);
    CypherBk* a = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);   // Strom 2 auf erz/5
    CypherBk* b = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);   // Strom 3 auf erz/6
    w.erz.setze_bk(2, a, ERZ_5);
    w.erz.setze_bk(3, b, ERZ_6);
    w.bis(6 * N);
    const bool a1 = regler_gleich(a, wert[ERZ_5]), b1 = regler_gleich(b, wert[ERZ_6]);
    wert[ERZ_5][0] = 1.0f;   // nur erz/5/bk/1 ändert sich
    w.bis(w.s + 6 * N);
    const bool a2 = a->regler_wert[0] == 1.0f && a->regler_wert[1] == wert[ERZ_5][1], b2 = regler_gleich(b, wert[ERZ_6]);
    wert[ERZ_5][0] = 0.9f;   // Tausch: der neue Graph bekommt den aktuellen Wert, nicht seinen Vorgabewert 0,5
    CypherBk* c = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, c, ERZ_5);
    w.bis(w.s + 30 * N);
    const bool c1 = regler_gleich(c, wert[ERZ_5]);
    std::printf("MESS regler_werk faeden=%d: a=%d b=%d nach_aenderung a=%d b=%d nach_tausch c=%d (c[0]=%.3f soll %.3f) aufrufe a=%d b=%d "
                "c=%d\n", faeden, a1, b1, a2, b2, c1, c->regler_wert[0], wert[ERZ_5][0], a->regler_aufrufe.load(),
                b->regler_aufrufe.load(), c->regler_aufrufe.load());
    PRUEF(a1);
    PRUEF(b1);   // Gegenprobe: erz/6 hat seine eigene Zeile, nicht die von erz/5
    PRUEF(a2);
    PRUEF(b2);   // erz/6 blieb unberührt
    PRUEF(c1);
    PRUEF(g_ueberlappt.load() - ue0 == 0);
    w.erz.setze_bk(2, nullptr, ERZ_5);
    w.erz.setze_bk(3, nullptr, ERZ_6);
    w.bis(w.s + 6 * N);
    CypherBk* f[8];
    int nf = 0;
    for (int k; (k = w.erz.bk_frei(f + nf, 8 - nf)) > 0;) nf += k;
    w.werk->stoppe();
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    PRUEF(nf == 3);
  }
  {  // S5r 9) regler_nie_besetzt: solange der Platz nicht FREI ist (VERSPAETET), ruft der Erzeuger cypher_bk_regler nicht
    neu_lauf();
    const int ue0 = g_ueberlappt.load();
    static float wert[cdj::MIX_KANAELE][8];
    regler_werte(wert);
    Welt w(1);
    w.erz.setze_bk_wert(wert);
    CypherBk* h = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, h, ERZ_5);
    w.erz.fenster(fenster(2, {ev(0.0, 48, 16.0)}), 0.0);
    w.bis(6 * N);
    const int vor = h->regler_aufrufe.load();
    PRUEF(vor > 0);               // Positivprobe: auf freiem Platz wird gemeldet
    h->halt.store(true);          // der Auftrag aus diesem Zyklus bleibt im Faden hängen
    w.ein();
    warte_im_rechnen();
    PRUEF(g_im_rechnen.load());
    const int beim_halt = h->regler_aufrufe.load();
    for (int i = 0; i < 3; ++i) w.ein();   // verspätet: Platz beim Faden
    const int waehrend = h->regler_aufrufe.load() - beim_halt;
    g_los.store(true);
    schlafe_ms(5);
    w.bis(w.s + 4 * N);
    const int danach = h->regler_aufrufe.load() - beim_halt;
    std::printf("MESS regler_besetzt: vor=%d waehrend_verspaetet=%d nach_los=%d verspaetet=%u ueberlappt=%d\n", vor, waehrend, danach,
                w.erz.bk_stand().verspaetet, g_ueberlappt.load() - ue0);
    PRUEF(w.erz.bk_stand().verspaetet >= 1);
    PRUEF(waehrend == 0);
    PRUEF(danach > 0);            // und danach wieder
    PRUEF(g_ueberlappt.load() - ue0 == 0);
    w.erz.setze_bk(2, nullptr, ERZ_5);
    w.bis(w.s + 3 * N);
    CypherBk* f[4];
    const int nf = w.erz.bk_frei(f, 4);
    w.werk->stoppe();
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    PRUEF(nf == 1);
  }
  {  // 4) verspaetet_kein_notenverlust
    neu_lauf();
    const int ue0 = g_ueberlappt.load();
    Welt w(1);
    CypherBk* h = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, h, ERZ2);
    constexpr int B = 8;   // Note A im Block B, bei Sample B·N + 10; Grundton C hält von Beginn an
    const int64_t smp_a = B * N + 10;
    const int64_t aus_a = std::llround(w.karte.sample_at(beat_von(smp_a) + 2.0));
    w.erz.fenster(fenster(2, {ev(0.0, 48, 16.0), ev(beat_von(smp_a), 57, 2.0)}), 0.0);
    w.bis((B - 2) * N);           // bis vor Zyklus B-2
    h->halt.store(true);          // der Auftrag aus Zyklus B-2 (für Block B-1) bleibt im Faden hängen
    w.ein();                      // Zyklus B-2: Auftrag für B-1 (Noten bis B·N, A liegt dahinter)
    warte_im_rechnen();
    PRUEF(g_im_rechnen.load());
    for (int i = 0; i < 3; ++i) w.ein();   // Zyklen B-1, B, B+1: verspätet
    g_los.store(true);
    schlafe_ms(5);
    w.bis(w.s + 4 * N);           // ab Zyklus B+2: Anlauf, A am Fensteranfang
    w.bis(aus_a + 2 * N);
    float gehalten = 0.0f;
    for (int64_t i = (B - 1) * N; i < (B + 2) * N; ++i) gehalten = std::max(gehalten, std::abs(w.erz2[i]));
    const int64_t a_ab = (B + 2) * N;
    const bool beide = w.erz2[a_ab] == 1.0f && w.erz2[aus_a - 1] == 1.0f;   // C + A
    const bool nach_off = w.erz2[aus_a] == 0.5f;                              // nur noch C
    const auto st = w.erz.bk_stand();
    const int an_a = h->an_zahl[57], aus_a_n = h->aus_zahl[57];
    const int ue = g_ueberlappt.load() - ue0;
    std::printf("MESS verspaetet: gehalten_spitze=%.2f vor=%.2f a_ab=%.2f a_vor_off=%.2f nach_off=%.2f note_an(A)=%d note_aus(A)=%d "
                "verspaetet=%u ueberlappt=%d\n", gehalten, w.erz2[(B - 2) * N + 5], w.erz2[a_ab], w.erz2[aus_a - 1], w.erz2[aus_a],
                an_a, aus_a_n, st.verspaetet, ue);
    PRUEF(w.erz2[(B - 2) * N + 5] == 0.5f);   // Positivprobe: C klingt vor dem Halt
    PRUEF(gehalten == 0.0f);                  // verspätete Blöcke: Stille
    PRUEF(st.verspaetet >= 1);
    PRUEF(an_a == 1);
    PRUEF(beide);
    PRUEF(aus_a_n == 1);
    PRUEF(nach_off);
    PRUEF(ue == 0);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 3 * N);
    CypherBk* f[4];
    const int nf = w.erz.bk_frei(f, 4);
    PRUEF(nf == 1);
    w.werk->stoppe();
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
  }
  {  // 5) wechsel_bei_besetztem_platz
    neu_lauf();
    const int ue0 = g_ueberlappt.load();
    Welt w(1);
    CypherBk* h1 = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    CypherBk* h2 = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, h1, ERZ2);
    const int64_t smp_n = 16 * N + 7;   // Note des neuen Graphen, lange nach dem Wechsel
    w.erz.fenster(fenster(2, {ev(0.0, 48, 32.0), ev(beat_von(smp_n), 60, 1.0)}), 0.0);
    w.bis(4 * N);
    h1->halt.store(true);
    w.ein();                  // Auftrag hängt im Faden
    warte_im_rechnen();
    PRUEF(g_im_rechnen.load());
    const int aufrufe_halt = h1->aufrufe.load();
    w.erz.setze_bk(2, h2, ERZ3);   // im selben Zyklus wie setze_strom auf einen anderen Kanal (M4)
    w.erz.setze_strom(2, nullptr, ERZ3);
    CypherBk* f[4];
    int frei_waehrend = 0;
    for (int i = 0; i < 3; ++i) { w.ein(); frei_waehrend += w.erz.bk_frei(f, 4); }
    const int aufrufe_waehrend = h1->aufrufe.load() - aufrufe_halt;
    const size_t T = w.erz2.size();   // Wechselblock: der erste nach los
    g_los.store(true);
    schlafe_ms(5);
    w.ein();
    const int frei_nach = w.erz.bk_frei(f, 4);
    CypherBk* zurueck = frei_nach == 1 ? f[0] : nullptr;
    w.bis(smp_n + 2 * N);
    double maxabw = 0.0;
    for (int i = 0; i < N; ++i) {
      const float soll = i < cdj::ERZ_AUSKLANG ? 0.5f * (1.0f - (float)(i + 1) / (float)cdj::ERZ_AUSKLANG) : 0.0f;
      maxabw = std::max(maxabw, (double)std::abs(w.erz2[T + i] - soll));
    }
    float alt_danach = 0.0f;
    for (size_t i = T + N; i < w.erz2.size(); ++i) alt_danach = std::max(alt_danach, std::abs(w.erz2[i]));
    const bool neu_klingt = w.erz3[smp_n] == 0.5f && w.erz3[smp_n - 1] == 0.0f;
    const int ue = g_ueberlappt.load() - ue0;
    std::printf("MESS wechsel_besetzt: aufrufe_am_alten_waehrend=%d frei_waehrend=%d frei_nach=%d (alter=%s) rampe_maxabw=%g "
                "alt_danach=%.2f neu_auf_erz3=%s ueberlappt=%d\n", aufrufe_waehrend, frei_waehrend, frei_nach,
                zurueck == h1 ? "ja" : "nein", maxabw, alt_danach, neu_klingt ? "ja" : "nein", ue);
    PRUEF(aufrufe_waehrend == 0);
    PRUEF(frei_waehrend == 0);
    PRUEF(frei_nach == 1 && zurueck == h1);
    PRUEF(maxabw < 1e-6);       // alter klingt auf dem ALTEN Kanal mit der Rampe aus
    PRUEF(alt_danach == 0.0f);
    PRUEF(neu_klingt);          // neuer auf dem neuen Kanal, am Sample
    PRUEF(ue == 0);
    w.erz.setze_bk(2, nullptr, ERZ3);
    w.bis(w.s + 3 * N);
    const int nf = w.erz.bk_frei(f, 4);
    w.werk->stoppe();
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    if (zurueck) cypher_bk_frei(zurueck);
    PRUEF(nf == 1);
  }
  {  // 6) midi_offs_ohne_midi (B1): offene MIDI-Note, Wechsel auf Graph, block ohne midi: das Off bleibt bis zum ersten midi
    neu_lauf();
    const int ue0 = g_ueberlappt.load();
    Welt w(1);
    static cdj::MidiAus midi[cdj::ERZ_MIDI_PORTS];
    w.erz.setze_strom(2, nullptr, ERZ2);
    w.erz.setze_midi(2, 1, 3);
    w.erz.fenster(fenster(2, {ev(0.0, 60, 8.0)}), 0.0);
    w.ein(midi);
    const bool an = midi[0].n == 1 && midi[0].ev[0].b[0] == 0x92;
    CypherBk* h = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, h, ERZ2);
    w.erz.setze_midi(2, 0, 1);   // Kern: Graph statt MIDI, offene Noten sofort aus auf ihrem alten Port/Kanal
    for (int i = 0; i < 3; ++i) w.ein(nullptr);
    w.ein(midi);
    bool off = false;
    for (int i = 0; i < midi[0].n; ++i) off = off || (midi[0].ev[i].b[0] == 0x82 && midi[0].ev[i].b[1] == 60);
    const int ue = g_ueberlappt.load() - ue0;
    std::printf("MESS midi_offs_ohne_midi: an=%s off_im_ersten_midi_block=%s ueberlappt=%d\n", an ? "ja" : "nein", off ? "ja" : "nein", ue);
    PRUEF(an);
    PRUEF(off);
    PRUEF(ue == 0);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 3 * N);
    CypherBk* f[4];
    const int nf = w.erz.bk_frei(f, 4);
    w.werk->stoppe();
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    PRUEF(nf == 1);
  }
  {  // 7) fenster_kein_doppel (D8b): A liegt im schon vergebenen Fenster [n0+n, n0+2n); ein neues fenster() mit A spielt sie nicht doppelt
    neu_lauf();
    Welt w(0);
    CypherBk* h = cypher_bk_neu(nullptr, 48000.0, nullptr, 0);
    w.erz.setze_bk(2, h, ERZ2);
    const int64_t smp_a = 3 * N + 10;
    w.erz.fenster(fenster(2, {ev(beat_von(smp_a), 57, 0.5)}), 0.0);
    w.bis(3 * N);   // Zyklus 2 (n0 = 2N) hat A für [3N, 4N) vergeben
    const cdj::ErzZaehler z = w.erz.fenster(fenster(2, {ev(beat_von(smp_a), 57, 0.5)}), w.karte.beat_at((double)w.s));
    w.bis(6 * N);
    std::printf("MESS fenster_kein_doppel: note_an(A)=%d zu_spaet=%d eingefuegt=%d\n", h->an_zahl[57], z.zu_spaet, z.eingefuegt);
    PRUEF(h->an_zahl[57] == 1);
    w.erz.setze_bk(2, nullptr, ERZ2);
    w.bis(w.s + 3 * N);
    CypherBk* f[4];
    const int nf = w.erz.bk_frei(f, 4);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    PRUEF(nf == 1);
  }
  PRUEF_ENDE();
}
