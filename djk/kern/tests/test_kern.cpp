// Kern-Zyklus ohne JACK: /uhr je Zyklus, /takt am Taktanfang, /k/set/neu setzt Beat 0 an den nächsten Zyklus,
// Prüfklick landet im Ring am Soll-Sample, Taktfelder und w im Ring-Kopf (SCHNITTSTELLEN §5.2, §5.3, §6.1).
#include <cstdlib>
#include <new>
#include <cstring>
#include <vector>

#include "cypherdj/kern.h"
#include "pruef.h"

// Allokations-Wächter (ADR 002): zählt jedes operator new, solange ein Zyklus läuft.
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

static cdj_ring_kopf* neuer_ring() {
  auto* r = (cdj_ring_kopf*)std::aligned_alloc(64, CDJ_RING_BYTES);
  std::memset(r, 0, CDJ_RING_BYTES);
  std::memcpy(r->magic, "CDJB", 4);
  r->version = CDJ_RING_VERSION; r->rate = CDJ_RING_RATE; r->kanaele = CDJ_RING_KANAELE; r->cap = CDJ_RING_CAP;
  return r;
}

static std::vector<cdj::Ereignis> abholen(cdj::Ereignisring* rb) {
  std::vector<cdj::Ereignis> v;
  cdj::Ereignis e;
  while (rb->hole(e)) v.push_back(e);
  return v;
}

static void sende(cdj::Befehlsring* rb, int32_t art, int64_t id, double bpm, int32_t an) {
  cdj::Befehl b{};
  b.art = art; b.id = id; b.bpm = bpm; b.an = an;
  std::strcpy(b.quelle, "pruefstand");
  rb->schiebe(b);
}

int main() {
  cdj_ring_kopf* ring = neuer_ring();
  ring->w = 1000;  // ein früherer Kern hat schon geschrieben: fortsetzen
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  auto* kern = new cdj::Kern(128.0, ring, bef, ere);
  const int N = 256;

  // 400 Zyklen bei 128: /uhr je Zyklus, /takt bei 0 und 90 000
  g_waechter = true;
  for (int z = 0; z < 400; ++z) kern->zyklus(N, 1000000LL * z);
  g_waechter = false;
  PRUEF(g_allokationen == 0);
  // Positiv-Kontrolle des Wächters: eine Allokation im bewachten Bereich wird gezählt
  g_waechter = true;
  int* probe = new int(1);
  g_waechter = false;
  PRUEF(g_allokationen == 1);
  delete probe;
  g_allokationen = 0;
  auto ev = abholen(ere);
  int uhr = 0, takt = 0;
  for (auto& e : ev) {
    if (e.art == cdj::Ereignis::UHR) {
      PRUEF(e.sample == (int64_t)uhr * N);
      PRUEF_NAH(e.beat, e.sample / 22500.0, 1e-9);
      PRUEF(e.bpm == 128.0);
      ++uhr;
    }
    if (e.art == cdj::Ereignis::TAKT) {
      PRUEF(e.sample == takt * 90000);
      PRUEF(e.takt == takt + 1);
      ++takt;
    }
  }
  PRUEF(uhr == 400);
  PRUEF(takt == 2);
  PRUEF(cdj_lade(&ring->w) == 1000u + 400u * N);
  PRUEF(cdj_lade(&ring->takt_frames) == 90000u);
  PRUEF(cdj_lade(&ring->takt_anfang_w) == 1000u + 90000u);

  // /k/set/neu 124: im nächsten Zyklus Sample 0, Beat 0, Takt 1; Quittung Status 2 mit ist_sample 0
  sende(bef, cdj::Befehl::SET_NEU, 7, 124.0, 0);
  const uint64_t w_neu = cdj_lade(&ring->w);
  kern->zyklus(N, 0);
  ev = abholen(ere);
  bool q = false, t1 = false;
  for (auto& e : ev) {
    if (e.art == cdj::Ereignis::QUITTUNG && e.id == 7) { q = (e.status == 2 && e.sample == 0 && e.beat == 0.0); }
    if (e.art == cdj::Ereignis::TAKT) t1 = (e.takt == 1 && e.sample == 0 && e.bpm == 124.0);
    if (e.art == cdj::Ereignis::UHR) PRUEF(e.sample == 0);
  }
  PRUEF(q);
  PRUEF(t1);
  PRUEF(cdj_lade(&ring->takt_anfang_w) == w_neu);
  PRUEF(cdj_lade(&ring->takt_frames) == 92903u);  // llround(4*60/124*48000) = 92903

  // Prüfklick an: erster Klick auf Beat 1 (nächster Schlag), liegt im Ring bei w_neu + llround(sample_at(1))
  sende(bef, cdj::Befehl::KLICK, 8, 0.0, 1);
  g_waechter = true;
  for (int z = 0; z < 200; ++z) kern->zyklus(N, 0);
  g_waechter = false;
  PRUEF(g_allokationen == 0);
  ev = abholen(ere);
  int64_t q_sample = -1;
  for (auto& e : ev)
    if (e.art == cdj::Ereignis::QUITTUNG && e.id == 8 && e.status == 2) q_sample = e.sample;
  const int64_t s1 = std::llround(1.0 * 60.0 / 124.0 * 48000.0);  // 23226
  PRUEF(q_sample == s1);
  const float* d = cdj_ring_daten_c(ring);
  const uint64_t f1 = (w_neu + (uint64_t)s1) % CDJ_RING_CAP;
  PRUEF(d[f1 * 4 + 0] == cdj::KLICK_PEGEL && d[f1 * 4 + 1] == cdj::KLICK_PEGEL);
  PRUEF(d[(f1 - 1) * 4 + 0] == 0.0f);
  PRUEF(d[f1 * 4 + 2] == 0.0f && d[f1 * 4 + 3] == 0.0f);  // Cue still
  delete kern;
  std::free(ring);
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
