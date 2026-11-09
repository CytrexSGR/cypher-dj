// 1.10 slice 7 (T5, spec 5.7, /k/arr/abgriff): the real-time tap of any strip, the sibling of the freeze (arr_freeze.cpp, which is untouched). A tap is a transport
// run from von_beat by the start rule with the loop bracket suspended, exactly like the freeze; what differs is what is copied and for how long. The file holds the
// signal at ONE point of ONE strip (ArrAbgriff: art 0 track, 1 group, 2 return, 3 PM; punkt 0 pre, 1 post) for exactly bis - von beats, shifted by the path latency
// of that point (D7) so it starts on von_beat like the export (RenderErgebnis::pdc_latenz). The run ends `ankunft` samples after the range end.
// Threads: phase Q of the track phase is joined before block() calls abgriff_block(), mischen() runs serially on the callback thread right after. The tap is therefore
// written only by the callback thread; abg_s0_ is the carrier of the block start between block() and mischen(). No lock, no atomic. What the load thread shares is the
// ArrFreeze hand-over: the job pointer goes through the command ring, the finished job back through the event ring (release/acquire of the ring), the buffer is
// allocated, zero-filled and freed there.
// Real time: no allocation, no lock, no I/O. A tap that is not armed costs one pointer test per capture point (abg_ is null).
#include <algorithm>
#include <cmath>
#include <cstring>

#include "cypherdj/arr_key.h"
#include "cypherdj/arrangement.h"

namespace cdj {

int Arrangement::abgriff_ankunft(int art, int nr, int punkt) const {
  if (!snap_) return 0;
  if (art == 3) return punkt == 0 ? snap_->pdc.p_in : snap_->pdc.gesamt;   // the master: pre in front of the PM chain, post after it (the export tap)
  ArrSchluessel k;
  k.quelle = art == 0 ? ARR_SCHL_SPUR : art == 1 ? ARR_SCHL_GRP : ARR_SCHL_RET;
  k.nr = static_cast<uint8_t>(nr);
  k.punkt = punkt == 0 ? ARR_SCHL_PRE : ARR_SCHL_POST;
  return arr_schluessel_quelle_ankunft(*snap_, k);
}

bool Arrangement::abgriff(ArrAbgriff* a, int quant, bool von_cypher, int64_t s, int64_t vorhalt, int n, const Karte& k, const char*& grund) {
  if (!snap_) {
    grund = "nicht_geladen";
    return false;
  }
  if (status_ != ArrStatus::steht || freeze_ || freeze_fertig_ || abg_ || abg_fertig_) {
    grund = "ueberlappung";
    return false;
  }
  if (a->art < 0 || a->art > 3 || a->punkt < 0 || a->punkt > 1) {
    grund = "ausserhalb_bereich";
    return false;
  }
  bool da = false;
  switch (a->art) {
    case 0: da = a->nr >= 1 && a->nr <= ARR_SPUREN && snap_->spur[a->nr - 1].art != ArrArt::leer; break;
    case 1: da = a->nr >= 1 && a->nr <= ARR_GRUPPEN && grp_belegt_[a->nr - 1]; break;
    case 2: da = a->nr >= 1 && a->nr <= ARR_RETURNS && snap_->ret_da[a->nr - 1]; break;
    default: da = a->nr == 1; break;
  }
  if (!da) {
    grund = "spur_bereich";
    return false;
  }
  if (!(a->bis_beat - a->von_beat <= ARR_FREEZE_MAX_BEATS)) {
    grund = "zu_gross";
    return false;
  }
  start_gemerkt_ = start_beat_;   // the start beat and the bracket position of the user count again after the run (as the freeze, fix L10)
  klammer_vorn_gemerkt_ = klammer_vorn_;
  start(a->von_beat, quant, von_cypher, s, vorhalt, n, k);
  const int64_t ank = abgriff_ankunft(a->art, a->nr, a->punkt);
  const int64_t ende = std::llround(k.sample_at(ursprung_ + (a->bis_beat - a->von_beat)));   // the range end on the timeline
#ifdef CYPHERDJ_MUTATION_ABGRIFF_NACHLAUF
  const int64_t frames = std::llround(k.sample_at(ursprung_ + (a->bis_beat - a->von_beat) + ARR_FREEZE_NACHLAUF)) - start_s_;   // error case: the tail of the freeze is added to the length
#else
  const int64_t frames = ende - start_s_;   // the range length exactly, no tail
#endif
  if (frames > a->kap) {   // no tempo below 60 BPM exists; protection in case the buffer does not reach
    stopp(0, s, k);        // still waiting: off at once, nothing sounded
    start_beat_ = start_gemerkt_;
    klammer_vorn_ = klammer_vorn_gemerkt_;
    grund = "zu_gross";
    return false;
  }
#ifdef CYPHERDJ_MUTATION_ABGRIFF_OHNE_ANKUNFT
  a->start_s = start_s_;   // error case: the window is not shifted by the path latency, the file starts `ankunft` samples early
#else
  a->start_s = start_s_ + ank;
#endif
  a->frames = frames;
  a->ende_s = -1;
  a->status = 0;
  abg_ = a;
  abg_gestartet_bei_ = -1;
  loop_gemerkt_ = loop_an_;
  loop_an_ = false;   // linear from von_beat to the end of the run
  stopp_s_ = ende + ank;   // the transport ends where the window ends: the last captured frame is the range end as it arrives at the tapped point
  return true;
}

void Arrangement::abgriff_block(int64_t s0, int m) {
  if (!abg_) return;
  abg_s0_ = s0;
  abg_geerntet_ = false;
  if (abg_->art == 0 && abg_->punkt == 0) abg_ernte(bus_l_[abg_->nr - 1], bus_r_[abg_->nr - 1], m);   // track pre: the strip input, in front of chain, monitor, fader
}

// Copies the part of this block (s0 = abg_s0_) that lies inside the window [start_s, start_s + frames) into the buffer. The pointers are block buffers of m samples.
void Arrangement::abg_ernte(const float* l, const float* r, int m) {
  ArrAbgriff& f = *abg_;
  abg_geerntet_ = true;
  const int64_t a = std::max(abg_s0_, f.start_s), e = std::min(abg_s0_ + m, f.start_s + f.frames);
  float* d = f.daten.data();
  for (int64_t s = a; s < e; ++s) {
    const int64_t j = 2 * (s - f.start_s);
    d[j] = l[s - abg_s0_];
    d[j + 1] = r[s - abg_s0_];
  }
}

// End of mischen(): a strip that did not compute in this block (unused group, a return that does not exist yet) is silent, so its window part is written as silence;
// then the run ends when the window is complete (the transport stops at the same sample).
void Arrangement::abg_blockende(int m) {
  if (!abg_geerntet_) {
    std::memset(abg_l_, 0, sizeof(float) * static_cast<size_t>(m));
    std::memset(abg_r_, 0, sizeof(float) * static_cast<size_t>(m));
    abg_ernte(abg_l_, abg_r_, m);
  }
  if (abg_s0_ + m >= abg_->start_s + abg_->frames) abg_ende(abg_->start_s + abg_->frames, 0);
}

void Arrangement::abgriff_abbrechen(int64_t s, const Karte& k) {
  if (!abg_) return;
  n_offen_ = 0;   // as freeze_abbrechen: open notes belong to the old axis
  if (status_ == ArrStatus::wartet) stopp(0, s, k);
  else beende(s);
}

void Arrangement::abg_ende(int64_t s, int32_t status) {
  abg_->ende_s = s;
  abg_->status = status;
  abg_fertig_ = abg_;
  abg_ = nullptr;
  loop_an_ = loop_gemerkt_;
  start_beat_ = start_gemerkt_;
  klammer_vorn_ = klammer_vorn_gemerkt_;
  geaendert_ = true;
}

}  // namespace cdj
