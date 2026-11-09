// 1.10 Slice 3: the Cypher Hall of the return strips (arr_returns.h). Wake and sleep follow the old send-2 hall of the mixer (mixer.cpp): a Hall computes
// only when the input fed it (or while its tail rings), and sleeps when the input was quiet for longer than the longest feedback line and the tail is
// below 1e-9 (-180 dBFS). Hall objects live from the constructor on; nothing allocates in the callback.
#include "cypherdj/arr_returns.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>

#include "cypherdj/reverb_pool.h"
#include "cypherdj/signalbox/controls.h"

namespace cdj {

static_assert(ARR_RETURNS == cypherdj::stellwerk::RET_REGLER_RETURNS, "return slots and return controls must be the same number");

CypherHallEinstellung arr_hall_einstellung(const float x[ARR_HALL_PARAM]) {
  auto k = [](float v) { return static_cast<double>(std::min(1.0f, std::max(0.0f, v))); };
  CypherHallEinstellung e = cypher_hall_vorgabe();
  e.pre_ms = 250.0 * k(x[0]);
  e.decay_s = 0.1 * std::pow(300.0, k(x[1]));
  e.groesse_ms = 5.0 + 195.0 * k(x[2]);
  e.tief_faktor = 0.25 * std::pow(16.0, k(x[3]));
  e.highcut_hz = 1000.0 * std::pow(22.0, k(x[4]));
  e.fahne_db = -24.0 + 36.0 * k(x[5]);
  e.frueh = 0.5;
  e.hoch_faktor = 0.6;
  e.lowcut_hz = 80.0;
  e.duck = 0.0;
  e.freeze = 0;
  e.rahmen = 1;   // 1024: task 1 gate G1 (2048 failed the median gate of arr32g plus four Halls)
  return e;
}

ArrReturns::ArrReturns(bool mit_hall) {
  for (int r = 0; r < ARR_RETURNS; ++r) {
    hall_[r] = mit_hall ? new Hall(48000) : nullptr;
    an_g_[r] = 1.0f;
    for (float& v : angew_[r]) v = std::nanf("");   // nothing applied yet: the first hall_sofort() always applies
    seit_[r] = ARR_HALL_RUHE_MAX;
    ruhig_[r] = ARR_HALL_RUHE_MAX;
  }
}

ArrReturns::~ArrReturns() {
#ifdef CYPHERDJ_MUTATION_HALL_OHNE_JOIN
  for (int w = 0; w < HallPool::MAX_W; ++w)
    if (offen_[w] && pool_ && !pool_->hole_zurueck(w)) pool_->warte(w);   // error case only: the pool may not be destroyed with a job outstanding (the test must end red, not hang)
#endif
  for (Hall* h : hall_) delete h;
}

void ArrReturns::anwenden(int r) {
  if (hall_[r]) hall_[r]->setze(arr_hall_einstellung(ziel_[r]));
  std::memcpy(angew_[r], ziel_[r], sizeof angew_[r]);
  seit_[r] = 0;
  ++setze_n_;
  ++setze_block_;
  setze_max_ = std::max(setze_max_, setze_block_);
}

void ArrReturns::hall_sofort(const float (*x)[ARR_HALL_PARAM]) {
  for (int r = 0; r < ARR_RETURNS; ++r) {
    std::memcpy(ziel_[r], x[r], sizeof ziel_[r]);
    if (std::memcmp(ziel_[r], angew_[r], sizeof angew_[r]) != 0) anwenden(r);
  }
  setze_block_ = 0;   // these setze ran outside the callback: they do not count for the per-block maximum
  setze_max_ = 0;
}

void ArrReturns::hall_vorlauf(int m, const float (*x)[ARR_HALL_PARAM], const bool* an, const bool* rechnet) {
  setze_block_ = 0;
#ifdef CYPHERDJ_MUTATION_ARR_RET_ALLOC
  {
    std::vector<float>* v = new std::vector<float>(64);   // error case: an allocation in the return loop of every block
    asm volatile("" : : "r"(v->data()) : "memory");
    delete v;
  }
#endif
  bool wollen[ARR_RETURNS] = {};
  for (int r = 0; r < ARR_RETURNS; ++r) {
    laeuft_[r] = false;
    speist_[r] = false;
    if (seit_[r] < ARR_HALL_RUHE_MAX) ++seit_[r];
    if (std::memcmp(x[r], ziel_[r], sizeof ziel_[r]) != 0) {
      std::memcpy(ziel_[r], x[r], sizeof ziel_[r]);
      ruhig_[r] = 0;
    } else if (ruhig_[r] < ARR_HALL_RUHE_MAX) {
      ++ruhig_[r];
    }
    if (!rechnet[r]) continue;
    wollen[r] = an[r] || an_g_[r] > 0.0f;
    bool s = false;
    for (int i = 0; i < m && !s; ++i) s = ein_l_[r][i] != 0.0f || ein_r_[r][i] != 0.0f;
    speist_[r] = s;
  }
  const auto ausstehend = [&](int r) { return std::memcmp(ziel_[r], angew_[r], sizeof ziel_[r]) != 0; };
  bool kredit = true;   // P8 c: at most one setze per block over all returns
  // 1. returns that wake with a pending target: applied at once (no debounce, P8 a); no credit left = the Hall runs one block on its old setting
  for (int r = 0; r < ARR_RETURNS; ++r) {
    if (!wollen[r] || wach_[r] || !speist_[r] || !ausstehend(r)) continue;
#ifdef CYPHERDJ_MUTATION_ARR_HALL_ERSTE_ENTPRELLT
    if (ruhig_[r] < 1 || seit_[r] < HALL_SETZE_BLOECKE) {   // error case: the debounce also holds for the first application
      ++start_alt_;
      continue;
    }
#endif
#ifndef CYPHERDJ_MUTATION_ARR_HALL_KEIN_KREDIT
    if (!kredit) {
      ++start_alt_;
      continue;
    }
#endif
    anwenden(r);
    kredit = false;
  }
  // 2. awake Halls: debounced (one still block, at most every HALL_SETZE_BLOECKE blocks), in the order 1 to 4
  for (int r = 0; r < ARR_RETURNS; ++r) {
    if (!wollen[r] || !wach_[r] || !ausstehend(r)) continue;
#ifndef CYPHERDJ_MUTATION_ARR_HALL_SETZE_JEDEN_BLOCK
    if (ruhig_[r] < 1 || seit_[r] < HALL_SETZE_BLOECKE) continue;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_HALL_KEIN_KREDIT
    if (!kredit) continue;
#endif
    anwenden(r);
    kredit = false;
  }
  for (int r = 0; r < ARR_RETURNS; ++r) laeuft_[r] = hall_[r] && wollen[r] && (wach_[r] || speist_[r]);   // without a Hall (test seam) never wet
}

void ArrReturns::hall_block(int r, int m) {
  const size_t bytes = sizeof(float) * static_cast<size_t>(m);
  if (!hall_[r]) {   // test seam without Halls: no wet signal (hall_laeuft is false, so the arrangement does not call this)
    std::memset(nass_l_[r], 0, bytes);
    std::memset(nass_r_[r], 0, bytes);
    return;
  }
#ifdef CYPHERDJ_MUTATION_ARR_HALL_TOT
  std::memset(nass_l_[r], 0, bytes);   // error case: the Hall never computes
  std::memset(nass_r_[r], 0, bytes);
  return;
#endif
  if (speist_[r]) {
    wach_[r] = true;
    ruhe_[r] = 0;
  }
#ifdef CYPHERDJ_MUTATION_ARR_HALL_OHNE_AUSKLANG
  if (!speist_[r]) {   // error case: the tail is cut as soon as the input stops
    hall_[r]->leeren();
    wach_[r] = false;
    std::memset(nass_l_[r], 0, bytes);
    std::memset(nass_r_[r], 0, bytes);
    return;
  }
#endif
  hall_[r]->block(ein_l_[r], ein_r_[r], nass_l_[r], nass_r_[r], m);
  ++hall_n_[r];
#ifdef CYPHERDJ_MUTATION_ARR_HALL_ZUFALL_UHR
  {   // error case: the result depends on the clock (as a random state seeded from the clock would)
    const float f = 1.0f + 1e-6f * static_cast<float>(std::chrono::steady_clock::now().time_since_epoch().count() % 1000) / 1000.0f;
    for (int i = 0; i < m; ++i) {
      nass_l_[r][i] *= f;
      nass_r_[r][i] *= f;
    }
  }
#endif
  if (!speist_[r] && ruhe_[r] < ARR_HALL_RUHE_MAX) ruhe_[r] += m;   // counted only while awake, saturated
  float spitze = 0.0f;
  bool endlich = true;
  for (int i = 0; i < m; ++i) {
    endlich = endlich && std::isfinite(nass_l_[r][i]) && std::isfinite(nass_r_[r][i]);
    spitze = std::fmax(spitze, std::fmax(std::fabs(nass_l_[r][i]), std::fabs(nass_r_[r][i])));
  }
  if (!endlich) {   // NaN or Inf from the input or the state: this block silent, state to zero, counted (as the mixer's guard, audit F01)
    hall_[r]->leeren();
    wach_[r] = false;
    ruhe_[r] = 0;
    std::memset(nass_l_[r], 0, bytes);
    std::memset(nass_r_[r], 0, bytes);
    ++nan_r_[r];
    return;
  }
  if (ruhe_[r] > ARR_HALL_RUHE_SAMPLES && spitze < 1e-9f) {
    wach_[r] = false;
    ruhe_[r] = 0;
  }
}

void ArrReturns::job(void* ctx, int r) {
  ArrReturns* self = static_cast<ArrReturns*>(ctx);
#if defined(__x86_64__) || defined(__i386__)
  self->csr_[r] = _mm_getcsr();   // what the job really runs under (the caller's, handed over by the pool): the test reads it
#endif
  self->hall_block(r, self->m_job_);
  ++self->pool_n_[r];
}

void ArrReturns::hall_parallel(int m) {
  static_assert(ARR_RETURNS - 1 <= HallPool::MAX_W, "returns 1..n-1 map to the workers, return 0 stays with the caller");
  for (bool& b : vorab_) b = false;
  if (!pool_) return;
#ifdef CYPHERDJ_MUTATION_HALL_OHNE_JOIN
  static_assert(sizeof(offen_) / sizeof(offen_[0]) >= HallPool::MAX_W, "offen_ covers every worker");
  for (int w = 0; w < HallPool::MAX_W; ++w)
    if (offen_[w]) {   // the jobs of the last block are collected only now (a held worker's job is dropped, not waited for: the test must end red, not hang)
      if (!pool_->hole_zurueck(w)) pool_->warte(w);
      offen_[w] = false;
    }
#endif
  // block_anfang() runs once per block in Arrangement::block (mehrkern 3.1), before phase Q; all workers are frei here (every job of the last block was joined)
  bool lauf[ARR_RETURNS];   // the set of running Halls, read once: laeuft_ is not read again in this call
  int n = 0;
  for (int r = 0; r < ARR_RETURNS; ++r) {
    lauf[r] = laeuft_[r];
    n += lauf[r] ? 1 : 0;
  }
  if (n < 2) return;   // one Hall alone: nothing to share, the strip loop computes it
  m_job_ = m;
  uint32_t mxcsr = 0;   // the caller's MXCSR, read once per phase: the workers run the Hall jobs under it (the callback has no FTZ/DAZ, the Halls wrap their DSP in DenormalSchutz)
#if defined(__x86_64__) || defined(__i386__)
#ifdef CYPHERDJ_MUTATION_HALL_OHNE_MXCSR
  mxcsr = 0;   // error case: no hand-over, the workers keep their own FTZ|DAZ
#else
  mxcsr = _mm_getcsr();
#endif
#endif
  bool gesandt[HallPool::MAX_W] = {};
  for (int r = 1; r < ARR_RETURNS; ++r)
    if (lauf[r] && r - 1 < pool_->faeden()) gesandt[r - 1] = pool_->schicke(r - 1, &ArrReturns::job, this, r, HallPool::HALL, mxcsr);
  for (int r = 0; r < ARR_RETURNS; ++r)
    if (lauf[r] && (r == 0 || !gesandt[r - 1])) hall_block(r, m);   // the caller's share: return 0 and every Hall the pool did not take
#ifndef CYPHERDJ_MUTATION_HALL_OHNE_JOIN
  for (int w = 0; w < HallPool::MAX_W; ++w) {
    if (!gesandt[w]) continue;
    if (!pool_->fertig(w)) {
      while (pool_->bereit(w) && !pool_->frist_um(w)) cpu_pause();   // the worker may still be waking: give it until the deadline
      if (pool_->hole_zurueck(w)) {   // still not started after the deadline: it is ours (the worker never starts it, the pool counts it late)
        hall_block(w + 1, m);
        continue;
      }
    }
    pool_->warte(w);   // started or done: wait for the end, the job is never abandoned
  }
#else
  for (int w = 0; w < HallPool::MAX_W; ++w) offen_[w] = gesandt[w];   // error case: no wait
#endif
  for (int r = 0; r < ARR_RETURNS; ++r) vorab_[r] = lauf[r];
}

void ArrReturns::schlafen(int r) {
  if (wach_[r] && hall_[r]) hall_[r]->leeren();
  wach_[r] = false;
  ruhe_[r] = 0;
}

}  // namespace cdj
