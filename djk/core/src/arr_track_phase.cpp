// Mehrkern slice 3.1: the sticky plan of the track phase (arr_track_phase.h).
#include "cypherdj/arr_track_phase.h"

#include <time.h>

#include "cypherdj/arrangement.h"

namespace cdj {

void ArrSpurPlan::baue(const ArrSenke* const* senken, int bahnen) noexcept {
  if (bahnen < 1) bahnen = 1;
  if (bahnen > BAHNEN) bahnen = BAHNEN;
  const bool behalten = gebaut_ && bahnen == bahnen_;   // the old lanes only mean something for the same lane count
  int8_t alt[ARR_SPUREN];
  for (int i = 0; i < ARR_SPUREN; ++i) alt[i] = behalten ? bahn_von_[i] : static_cast<int8_t>(-1);
  bahnen_ = bahnen;
  gebaut_ = true;
  for (int b = 0; b < BAHNEN; ++b) n_[b] = 0;
  n_rest_ = 0;
#ifdef CYPHERDJ_MUTATION_SPUR_PLAN_LAESST_SPUR_AUS
  bool ausgelassen = false;   // error case: the first track that could run on a lane is left out of every list
#endif
  for (int i = 0; i < ARR_SPUREN; ++i) {
    bahn_von_[i] = -1;
    const ArrSenke* s = senken[i];
    if (!s) continue;
    if (!s->parallel_faehig(i)) {
      rest_[n_rest_++] = i;
      continue;
    }
#ifdef CYPHERDJ_MUTATION_SPUR_PLAN_LAESST_SPUR_AUS
    if (!ausgelassen) {
      ausgelassen = true;
      continue;
    }
#endif
    int b = alt[i];
    if (b < 0 || b >= bahnen) {
      b = 0;
      for (int k = 1; k < bahnen; ++k)
        if (n_[k] < n_[b]) b = k;
    }
    liste_[b][n_[b]++] = i;
    bahn_von_[i] = static_cast<int8_t>(b);
  }
}

namespace {

// Seam spin: bounded by a wall-clock cap so a failing test ends red instead of hanging. Only ever reached with a SpurHaken attached.
std::atomic<bool> g_haken_aufgegeben{false};   // set once a wait hit the cap: every later seam wait returns at once, so a red test ends fast

template <class F>
void haken_warten(F&& bedingung) {
  timespec t0;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  while (!bedingung()) {
    if (g_haken_aufgegeben.load(std::memory_order_relaxed)) return;
    cpu_pause();
    timespec t1;
    clock_gettime(CLOCK_MONOTONIC, &t1);
    if ((t1.tv_sec - t0.tv_sec) * 1000000000LL + (t1.tv_nsec - t0.tv_nsec) > 3000000000LL) {
      g_haken_aufgegeben.store(true, std::memory_order_relaxed);
      return;
    }
  }
}

}  // namespace

void ArrSpurLauf::job(void* ctx, int lane) {
  ArrSpurLauf* self = static_cast<ArrSpurLauf*>(ctx);
  if (SpurHaken* h = self->haken_)
    if (h->halte_vor_claim_bahn.load() == lane) {
      h->drin.fetch_add(1);   // counts as held: the first unit of the caller can wait for it (a test must not race the worker's wake-up)
      haken_warten([&] { return h->frei.load(); });
    }
  self->bahn_laufen(lane);
}

// One lane: its own list from the front, then the other lists from the end. Every unit is claimed with one CAS; a unit seen as claimed is skipped, so
// after one full pass nothing is free (a unit never goes back to free).
void ArrSpurLauf::bahn_laufen(int lane) {
  const ArrSpurPlan& p = *plan_;
  for (int k = 0; k < p.n(lane); ++k)
    if (nimm(p.spur(lane, k))) einheit(lane, p.spur(lane, k));
  if (SpurHaken* h = haken_)   // seam: a worker steals only after every worker the test counts on computed a unit of its own list and the held unit is held (else a fast one empties the lists of the slow ones)
    if (lane >= 1) haken_warten([&] { return h->worker_fertig.load() >= h->warte_worker.load() && h->drin.load() >= h->warte_drin.load(); });
  for (int off = 1; off < p.bahnen(); ++off) {
    const int b = (lane + off) % p.bahnen();
    for (int k = p.n(b) - 1; k >= 0; --k)
      if (nimm(p.spur(b, k))) einheit(lane, p.spur(b, k));
  }
}

void ArrSpurLauf::einheit(int lane, int spur) {
  SpurHaken* h = haken_;
  if (h) {
    if (h->vor) h->vor(lane);
    if (lane == 0 && !erste_[0].exchange(true)) {   // the first unit of the caller waits until the test's workers are in place
      haken_warten([&] { return h->drin.load() >= h->warte_drin.load() && h->worker_fertig.load() >= h->warte_worker.load(); });
    }
    if (lane == h->halte_bahn.load() && !gehalten_.exchange(true)) {
      h->drin.fetch_add(1);
      haken_warten([&] { return h->frei.load(); });
    }
  }
  f_(ctx_, spur, arbeit_[lane]);
  zustand_[spur].store(2, std::memory_order_release);
  ++lane_n_[lane].n;
  if (h) {
    if (h->nach) h->nach(lane);
    if (lane >= 1 && !fertig0_[lane].exchange(true)) h->worker_fertig.fetch_add(1);
  }
}

namespace {
int64_t echt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
constexpr int64_t START_PLAUSIBEL_NS = 1000000000LL;   // a cycle stamp more than a second away (either way) is from another clock: unknown
}  // namespace

void ArrSpurLauf::setze_haken(SpurHaken* h) {
  haken_ = h;
  g_haken_aufgegeben.store(false, std::memory_order_relaxed);
}

int64_t ArrSpurLauf::jetzt() const {
  if (haken_) {
    const int64_t v = haken_->uhr_ns.load(std::memory_order_relaxed);
    if (v != 0) return v;
  }
  return test_.jetzt_ns != 0 ? test_.jetzt_ns : echt_ns();
}

bool ArrSpurLauf::spaet_dran(int64_t start_ns, int m) {
  if (start_ns == 0) return false;
  const int64_t d = jetzt() - start_ns;
  if (d <= -START_PLAUSIBEL_NS || d >= START_PLAUSIBEL_NS) return false;
  if (d < 0) return false;   // the sub-block starts ahead of its nominal start (a later sub-block of a split cycle): on time
  if (d * 100 < periode_ns(m) * SPAET_START_PROZENT) return false;
  ++z.seriell_spaet;
  return true;
}

int64_t ArrSpurLauf::grenze_echt(int64_t start_ns, int m, int64_t echt0) const {
  int64_t start_echt = echt0;
  if (start_ns != 0) {
    const int64_t d = jetzt() - start_ns;
    if (d > -START_PLAUSIBEL_NS && d < START_PLAUSIBEL_NS) start_echt = echt0 - d;   // d < 0: the nominal start is still ahead
  }
#ifdef CYPHERDJ_MUTATION_SPUR_GRENZE_AB_LAUF
  start_echt = echt0;   // error case: the limit is measured from the entry into laufen(), not from the start of the cycle
#endif
  return start_echt + (test_.grenze_ns != 0 ? test_.grenze_ns : periode_ns(m) * GRENZE_PROZENT / 100);
}

bool ArrSpurLauf::konto_pruefen(HallPool& pool, int modus) {
  if (pool.an(HallPool::SPUR)) {
    auto_aus_gesehen_ = false;
    return true;
  }
  if (modus != 2) return false;
  if (!auto_aus_gesehen_) {   // the first block that finds the account off: this is one switch-off
    auto_aus_gesehen_ = true;
    ++auto_aus_n_;
    auto_blocks_ = 0;
  }
  if (auto_blocks_ < AUTO_WARTE_BLOECKE) ++auto_blocks_;   // saturates: no overflow however long the account stays off
#ifndef CYPHERDJ_MUTATION_SPUR_AUTO_IMMER_NEU   // error case: the retry happens after every switch-off, the second one is not for good
  if (auto_aus_n_ >= 2) return false;
#endif
  if (auto_blocks_ < AUTO_WARTE_BLOECKE) return false;
  if (!pool.wieder_an(HallPool::SPUR)) return false;
  auto_aus_gesehen_ = false;
  ++z.auto_neu;
  return true;
}

void ArrSpurLauf::laufen(const ArrSpurPlan& plan, HallPool& pool, ArrArbeit* arbeit, Einheit f, void* ctx, Rest rest, void* rest_ctx, uint32_t mxcsr, int64_t start_ns, int m) {
  // the join of the last phase is complete, so no unit may still be claimed; then every planned unit is free again
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (zustand_[i].load(std::memory_order_relaxed) == 1) ++z.unfertig;
  for (int b = 0; b < plan.bahnen(); ++b)
    for (int k = 0; k < plan.n(b); ++k) zustand_[plan.spur(b, k)].store(0, std::memory_order_relaxed);
  plan_ = &plan;
  arbeit_ = arbeit;
  f_ = f;
  ctx_ = ctx;
  for (int b = 0; b < BAHNEN; ++b) {
    erste_[b].store(false, std::memory_order_relaxed);
    fertig0_[b].store(false, std::memory_order_relaxed);
  }
  gehalten_.store(false, std::memory_order_relaxed);
  if (SpurHaken* h = haken_) {
    h->drin.store(0, std::memory_order_relaxed);
    h->worker_fertig.store(0, std::memory_order_relaxed);
  }
#ifdef CYPHERDJ_MUTATION_SPUR_OHNE_MXCSR
  mxcsr = 0;   // error case: the workers keep their own FTZ|DAZ state, a subnormal result of the caller's path becomes 0
#endif
  // The hard wait limit on the real clock: start of the cycle (translated when a test moved the scheduler's clock) plus 75 percent of the period of m samples,
  // or, when the start is unknown, from now. The override is nanoseconds after that start.
  const int64_t echt0 = echt_ns();
  const int64_t grenze_ns = grenze_echt(start_ns, m, echt0);
#ifdef CYPHERDJ_MUTATION_SPUR_WARTE_AB_LAUF
  const int64_t t_eintritt = jetzt();   // error case: the join wait is measured from the entry, so the caller's own work counts as waiting
#endif
  const int n_w = (plan.bahnen() - 1 < pool.faeden()) ? plan.bahnen() - 1 : pool.faeden();
  bool gesandt[HallPool::MAX_W] = {};
  for (int w = 0; w < n_w; ++w) {
#ifdef CYPHERDJ_MUTATION_SPUR_ALLE_BAHN_1
    const int lane = 1;   // error case: every worker uses lane 1 (the probe bug)
#else
    const int lane = w + 1;
#endif
    gesandt[w] = pool.schicke(w, &ArrSpurLauf::job, this, lane, HallPool::SPUR, mxcsr);
  }
  const uint64_t n0 = lane_n_[0].n;
  bahn_laufen(0);   // the caller's own list, then whatever the workers have not claimed
  z.einheiten_caller += lane_n_[0].n - n0;
  rest(rest_ctx);   // the serial remainder overlaps with the workers
  // The join. A job that never started is taken back (nothing waits for an unstarted job); it counts late only when the worker missed its deadline. A job that
  // started is waited for, never abandoned: it holds a unit or is about to claim one. The wait after the caller ran dry is the stall signal below the hard limit.
  bool gestartet = false, gewartet = false;
  int64_t t_warte = 0;
  for (int w = 0; w < n_w; ++w) {
    if (!gesandt[w]) continue;
    const bool lief_noch = !pool.fertig(w);
    if (lief_noch && pool.hole_zurueck(w, pool.frist_um(w))) continue;
    gestartet = true;
    if (lief_noch && !gewartet) {
      gewartet = true;
      t_warte = jetzt();                                  // read first: a test moves its clock when it sees am_join
#ifdef CYPHERDJ_MUTATION_SPUR_WARTE_AB_LAUF
      t_warte = t_eintritt;
#endif
      if (haken_) haken_->am_join.fetch_add(1);
    }
#ifndef CYPHERDJ_MUTATION_SPUR_OHNE_JOIN   // error case: the caller does not wait for a started job and returns while a worker still computes
    pool.warte(w, grenze_ns);
#endif
  }
  if (gestartet) ++z.blocks_parallel;
  if (gewartet) {
    const int64_t wartezeit = jetzt() - t_warte;
    if (wartezeit > z.warte_max_ns) z.warte_max_ns = wartezeit;
    if (wartezeit > (test_.warte_spaet_ns != 0 ? test_.warte_spaet_ns : WARTE_SPAET_NS)) {
      ++z.warte_spaet;
      pool.spaet_melden(HallPool::SPUR);   // one late event of the track account: five in 64 blocks switch the track phases off
    }
  }
}

}  // namespace cdj
