// Plan 1.11 T12 (INTERFACES §4.11 /k/arr/export_lauf): the real-time export of the production master, see arr_export_run.h. Two halves.
// Arrangement::export_lauf and friends (callback): a transport run from von_beat by the start rule with the loop bracket suspended, exactly the pattern of arr_freeze.cpp and
//    arr_tap.cpp (both untouched). The PM post point (pm_l_/pm_r_ after chain and PM fader, without the metronome) is copied from the sample `start_s_ + pdc.gesamt` on, the
//    window is the range length exactly, the transport ends where the window ends. Real time: no allocation, no lock, no I/O; the ring push is a copy and a release store.
// The writer thread (ArrExportSchreiber) lives in arr_export_writer.cpp: it needs take_writer.cpp, which the many targets that link ARR_QUELLEN do not all carry.
#include <algorithm>
#include <cmath>
#include <cstring>

#include "cypherdj/arr_export_run.h"
#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
void setze_grund(char* ziel, const char* g) {
  std::strncpy(ziel, g, sizeof(ArrExportLauf::grund) - 1);
  ziel[sizeof(ArrExportLauf::grund) - 1] = '\0';
}
}  // namespace

void ArrExportLauf::verwerfen(const char* g) {
  status = 2;
  setze_grund(grund, g);
  phase.store(1, std::memory_order_release);
}

// ---- callback half ----

bool Arrangement::export_lauf(ArrExportLauf* a, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k, const char*& grund) {
  if (!snap_) {
    grund = "nicht_geladen";
    return false;
  }
  if (status_ != ArrStatus::steht || freeze_ || freeze_fertig_ || abg_ || abg_fertig_ || exp_ || exp_fertig_da_) {
    grund = "belegt";
    return false;
  }
  if (!(a->bis_beat - a->von_beat >= 1.0) || !(a->bis_beat - a->von_beat <= ARR_EXPORT_MAX_BEATS)) {
    grund = a->bis_beat - a->von_beat >= 1.0 ? "zu_gross" : "ausserhalb_bereich";
    return false;
  }
  start_gemerkt_ = start_beat_;   // the start beat and the bracket position of the user count again after the run (as the freeze, fix L10)
  klammer_vorn_gemerkt_ = klammer_vorn_;
  start(a->von_beat, quant, von_cypher, s, vorhalt, n, k);
  const int64_t ank = abgriff_ankunft(3, 0, 1);   // the PM post point: pdc.gesamt, the same shift as the tap
  const int64_t ende = std::llround(k.sample_at(ursprung_ + (a->bis_beat - a->von_beat)));   // the range end on the timeline
  const int64_t frames = ende - start_s_;
  if (frames > ARR_EXPORT_MAX_FRAMES) {   // 3600 s at the project tempo
    stopp(0, s, k);                       // still waiting: off at once, nothing sounded
    start_beat_ = start_gemerkt_;
    klammer_vorn_ = klammer_vorn_gemerkt_;
    grund = "zu_gross";
    return false;
  }
#ifdef CYPHERDJ_MUTATION_HOST_EXPORT_OHNE_VERSATZ
  a->start_s = start_s_;   // error case: the window is not shifted by the path latency, the file starts `ank` samples early (a click is late by that much)
#else
  a->start_s = start_s_ + ank;
#endif
  a->frames = frames;
  a->ende_s = -1;
  a->status = 0;
  a->ungesund = 0;
  a->stage.n = 0;
  exp_ = a;
  exp_gestartet_bei_ = -1;
  exp_host_maske_ = 0;   // the host stages the project has switched on (the flag of the stage; the row an is read per block)
  for (int i = 0; i < ARR_KETTEN; ++i)
    for (int j = 0; j < snap_->kette[i].n; ++j) {
      const ArrStufe& st = snap_->kette[i].st[j];
      if (st.art == ArrInsArt::host && st.an && st.slot < ARR_INS_HOST) exp_host_maske_ |= 1u << st.slot;
    }
  loop_gemerkt_ = loop_an_;
  loop_an_ = false;   // linear from von_beat to the end of the run
  stopp_s_ = ende + ank;   // the transport ends where the window ends
  return true;
}

void Arrangement::export_block(int64_t s0, int m) {
  if (!exp_) return;
  exp_s0_ = s0;
  (void)m;
}

// Copies the part of this block that lies inside the window out of the PM post buffers into chunks of 256 frames and pushes full chunks. Runs at the end of mischen().
void Arrangement::export_blockende(int m) {
  ArrExportLauf& f = *exp_;
  const int64_t ende = f.start_s + f.frames;
  const int64_t a = std::max(exp_s0_, f.start_s), e = std::min(exp_s0_ + m, ende);
  if (a < e) {
    bool trocken = false;   // an active host stage on the dry path in a block of the window
    for (int h = 1; h <= ARR_INS_HOST; ++h)
      if (((exp_host_maske_ >> (h - 1)) & 1u) && ins_.host_zeile_an(h) && !ins_.host().gesund(h)) trocken = true;
    if (trocken) ++f.ungesund;
    AufnahmeChunk& c = f.stage;
    for (int64_t s = a; s < e;) {
      if (c.n == 0) c.s0 = s;
      const int64_t n = std::min<int64_t>(e - s, REC_CHUNK - c.n);
      std::memcpy(c.l + c.n, pm_l_ + (s - exp_s0_), sizeof(float) * static_cast<size_t>(n));
      std::memcpy(c.r + c.n, pm_r_ + (s - exp_s0_), sizeof(float) * static_cast<size_t>(n));
      c.n += static_cast<int32_t>(n);
      s += n;
      if (c.n == REC_CHUNK || s == ende) {   // a full chunk, or the last frames of the window
        if (!f.ring.schiebe(c)) {            // the writer fell behind: no chunk may be lost silently
          f.ueberlauf.store(1, std::memory_order_release);
          if (status_ != ArrStatus::steht) stopp_s_ = exp_s0_ + m;   // the transport of the run ends with it, at the start of the next block
          export_ende(exp_s0_ + m, 1, "schreiber_ueberlauf");
          return;
        }
        c.n = 0;
      }
    }
  }
  if (f.schreiber_fehler.load(std::memory_order_acquire) != 0) {   // the writer cannot write: end the run now
    if (status_ != ArrStatus::steht) stopp_s_ = exp_s0_ + m;
    export_ende(exp_s0_ + m, 1, f.schreiber_fehler.load(std::memory_order_relaxed) == 1 ? "datei_fehlt" : "kein_platz");
    return;
  }
  if (exp_s0_ + m >= ende) export_ende(ende, 0, "");
}

void Arrangement::export_abbrechen(int64_t s, const Karte& k) {
  if (!exp_) return;
  n_offen_ = 0;   // as freeze_abbrechen: open notes belong to the old axis
  if (status_ == ArrStatus::wartet) stopp(0, s, k);
  else beende(s);
}

void Arrangement::export_ende(int64_t s, int32_t status, const char* grund) {
  ArrExportLauf* f = exp_;
  f->ende_s = s;
  f->status = status;
  setze_grund(f->grund, grund);
  exp_ = nullptr;
  exp_fertig_da_ = true;
  exp_fertig_status_ = status;
  exp_fertig_ende_ = s;
  loop_an_ = loop_gemerkt_;
  start_beat_ = start_gemerkt_;
  klammer_vorn_ = klammer_vorn_gemerkt_;
  geaendert_ = true;
  f->phase.store(1, std::memory_order_release);   // the last access: from here the job belongs to the writer thread (it may free it)
}

}  // namespace cdj
