// Package 1.9 U6: the instrument rack as a sink (arr_rack_sink.h).
#include "cypherdj/arr_rack_sink.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

namespace {

bool in_zone(const ArrGlied& g, uint8_t ton, uint8_t vel, int kette) noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ZONE_EXKLUSIV
  const bool ton_ok = ton >= g.ton_lo && ton < g.ton_hi;   // error case: the upper bound of the key zone is exclusive (a zone ending at 59 loses key 59)
#else
  const bool ton_ok = ton >= g.ton_lo && ton <= g.ton_hi;
#endif
  return ton_ok && vel >= g.vel_lo && vel <= g.vel_hi && kette >= g.kette_lo && kette <= g.kette_hi;
}

// is the member an internal one with a kit as device?
bool ist_kit(const ArrSnapshot* s, const ArrGlied& g) noexcept {
  if (!s || g.art == ArrArt::wirt) return false;
  const ArrSpur& d = s->platz(g.platz);
  return d.art == ArrArt::intern && std::strcmp(d.geraet, "kit") == 0;
}

}  // namespace

int64_t ArrRackSenke::vorhalt() const noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_RACK_OHNE_VORHALT
  return 0;   // error case: the Surge member gets its notes at the sample, they sound one round trip late
#else
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || s->rack_wirt <= 0) return 0;
  int64_t v = 0;
  for (const ArrSenke* w : wirt_)
    if (w) v = std::max(v, w->vorhalt());
  return v;
#endif
}

int ArrRackSenke::glieder(int spur) const {
  int n = 0;
  if (spur >= 0 && spur < ARR_SPUREN)
    for (const Rec& r : sp_[spur].rec) n += r.art != 0 ? 1 : 0;
  return n;
}

ArrRackSenke::Rec* ArrRackSenke::rec_fuer(Spur& p, const ArrGlied& g) noexcept {
  const int8_t art = g.art == ArrArt::wirt ? 2 : 1;
  const int8_t slot = art == 2 ? static_cast<int8_t>(g.slot) : 0;
  Rec* frei = nullptr;
  for (Rec& r : p.rec) {
    if (r.art == 0) {
      if (!frei) frei = &r;
      continue;
    }
    if (r.art == art && r.platz == g.platz && r.slot == slot) return &r;
  }
  if (!frei) {
    verloren_.erhoehe();
    return nullptr;
  }
  *frei = Rec{};
  frei->art = art;
  frei->platz = static_cast<int16_t>(g.platz);
  frei->slot = slot;
  frei->id = g.id;
  frei->kit = ist_kit(arr_.snapshot(), g);
  return frei;
}

void ArrRackSenke::sende(Spur& p, int spur, const Rec& r, int64_t ziel, uint8_t ton, uint8_t vel, uint8_t art) noexcept {
  if (r.art == 2) {   // Surge: at once, the Wirt sink sends it one round trip before the target sample
    ArrSenke* w = r.slot >= 1 && r.slot <= ARR_WIRT_SLOTS ? wirt_[r.slot - 1] : nullptr;
    if (!w) return;
    if (art == 0) w->note(spur, ziel, ton, vel, true);
    else if (art == 1) w->note(spur, ziel, ton, 0, false);
    else w->alle_aus(spur, ziel);
    return;
  }
  if (p.n >= ARR_RACK_WARTE) {   // counted, not reported (a lost note off would hang a note; the limit is far above a block's traffic)
    verloren_.erhoehe();
    return;
  }
  const ArrSnapshot* sn = arr_.snapshot();
  p.ev[p.n++] = Ev{ziel, r.platz, art, ton, vel, arr_.snapshot_generation(), sn && sn->spur[spur].art == ArrArt::rack && aktuell_in(&sn->spur[spur], r)};   // internal: held until the block that holds the target sample
}

void ArrRackSenke::faelliges_weitergeben(Spur& p, int64_t bis) noexcept {
  int w = 0;
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    if (e.ziel >= bis) {
      p.ev[w++] = e;
      continue;
    }
    if (!intern_) continue;
    for (Rec& r : p.rec)   // what the sink really holds on the slot (abgaenge() ends exactly these)
      if (r.art == 1 && r.platz == e.platz) {
        const uint64_t bit = 1ULL << (e.ton & 63);
        if (e.art == 0) r.geliefert[(e.ton & 127) >> 6] |= bit;
        else if (e.art == 1) r.geliefert[(e.ton & 127) >> 6] &= ~bit;
        else r.geliefert[0] = r.geliefert[1] = 0;
        break;
      }
    if (e.art == 0) intern_->note(e.platz, e.ziel, e.ton, e.vel, true);
    else if (e.art == 1) intern_->note(e.platz, e.ziel, e.ton, 0, false);
    else intern_->alle_aus(e.platz, e.ziel);
  }
  p.n = w;
}

void ArrRackSenke::note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  ton &= 0x7f;
  if (an) {
    const ArrSnapshot* s = arr_.snapshot();
    if (!s || s->spur[spur].art != ArrArt::rack) return;
    const ArrSpur& sp = s->spur[spur];
    for (int i = 0; i < sp.n_glieder; ++i) {
      const ArrGlied& g = sp.glied[i];
      if (!in_zone(g, ton, vel, sp.kette)) continue;
      Rec* r = rec_fuer(p, g);
      if (!r) continue;
      r->klingt[ton >> 6] |= 1ULL << (ton & 63);
      if (r->platz >= ARR_SPUREN && r->platz < ARR_SENKEN_PLAETZE) ++an_[r->platz - ARR_SPUREN];
      sende(p, spur, *r, ziel, ton, vel, 0);
    }
    return;
  }
  // note off: to the members that hold this note, by the record of the note on (not by the zones: a chain change in between must not strand it)
  for (Rec& r : p.rec) {
    if (r.art == 0) continue;
    const uint64_t bit = 1ULL << (ton & 63);
#ifdef CYPHERDJ_MUTATION_ARR_RACK_OFF_AN_ALLE
    r.klingt[ton >> 6] &= ~bit;   // error case: the off goes to every member, also to those that never got the note on
#else
    if (!(r.klingt[ton >> 6] & bit)) continue;
    r.klingt[ton >> 6] &= ~bit;
#endif
    sende(p, spur, r, ziel, ton, 0, 1);
  }
}

void ArrRackSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  faelliges_weitergeben(p, ziel);   // what falls before the stop still sounds, what comes after never starts
  p.n = 0;
  const ArrSnapshot* s = arr_.snapshot();
  if (s && s->spur[spur].art == ArrArt::rack)
    for (int i = 0; i < s->spur[spur].n_glieder; ++i) rec_fuer(p, s->spur[spur].glied[i]);   // every current member gets the stop, also one that never sounded
  for (Rec& r : p.rec) {
    if (r.art == 0) continue;
    r.klingt[0] = r.klingt[1] = 0;
    r.geliefert[0] = r.geliefert[1] = 0;
    if (r.art == 2) {
      if (ArrSenke* w = r.slot >= 1 && r.slot <= ARR_WIRT_SLOTS ? wirt_[r.slot - 1] : nullptr) w->alle_aus(spur, ziel);
    } else if (intern_) {
      intern_->alle_aus(r.platz, ziel);
    }
  }
}

void ArrRackSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  p.n = 0;   // events of the run before: gone, the start rule of the sinks begins from silence
  for (Rec& r : p.rec) r.klingt[0] = r.klingt[1] = r.geliefert[0] = r.geliefert[1] = 0;
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || s->spur[spur].art != ArrArt::rack) return;
  for (int i = 0; i < s->spur[spur].n_glieder; ++i) {
    const ArrGlied& g = s->spur[spur].glied[i];
    Rec* r = rec_fuer(p, g);
    if (!r) continue;
    if (r->art == 2) {
      if (ArrSenke* w = r->slot >= 1 && r->slot <= ARR_WIRT_SLOTS ? wirt_[r->slot - 1] : nullptr) w->transport_start(spur, ziel);
    } else if (intern_) {
      intern_->transport_start(r->platz, ziel);
    }
  }
}

bool ArrRackSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return false;
  Spur& p = sp_[spur];
  bool da = false;
  for (const Rec& r : p.rec) da = da || r.art != 0;
  p.weg = da;   // the next block() of this track fades the members out (the snapshot of that block says what became of them)
#ifndef CYPHERDJ_MUTATION_SPUR_RACK_WEG_QUEUE_BLEIBT   // the queue of a track that leaves stays (case 12 must go red)
  if (!da) p.n = 0;   // no record, no fade block follows: the queued events of members that are gone sound nowhere, and nothing may stay behind (see block_)
#endif
  return da;
}

// is a Surge slot played by a track or a member of the snapshot?
bool ArrRackSenke::slot_gespielt(const ArrSnapshot* snap, int slot, int) const noexcept {
  if (!snap) return false;
  for (const ArrSpur& t : snap->spur) {
    if (t.art == ArrArt::wirt && t.slot == slot) return true;
    if (t.art == ArrArt::rack)
      for (int i = 0; i < t.n_glieder; ++i)
        if (t.glied[i].art == ArrArt::wirt && t.glied[i].slot == slot) return true;
  }
  return false;
}

bool ArrRackSenke::aktuell_in(const ArrSpur* sp, const Rec& x) const noexcept {
  if (!sp) return false;
  for (int i = 0; i < sp->n_glieder; ++i) {
    const ArrGlied& g = sp->glied[i];
    const int8_t art = g.art == ArrArt::wirt ? 2 : 1;
    if (x.art == art && x.platz == g.platz && x.slot == (art == 2 ? static_cast<int8_t>(g.slot) : 0)) return true;
  }
  return false;
}

// The member slot numbers are handed out again by every snapshot, the sinks keep their voices per slot. A member that left and whose slot number now belongs to
// another member (of any track) is not faded by the dispatcher (the new owner takes the slot over), and its record was the only one that knew its notes:
// they are ended here, on the old slot, before the first event of the new owner (this runs at the first block of the new snapshot, before any queued event
// of any track is handed on). Events queued before the swap are the old owner's and go (their offs are replaced by the ones sent here); events queued after
// it are the new owner's and stay.
// A kit member also gets an all-off at any key count: the kit sink ignores offs, a one-shot would ring on into the bus of the new owner. A member that goes on under
// another slot number takes its queued events along even when nobody owns its old slot (the dispatcher fades that slot; the record stays for the fade block).
void ArrRackSenke::abgaenge(const ArrSnapshot* snap, int64_t s0) noexcept {
  for (int spur = 0; spur < ARR_SPUREN; ++spur) {
    Spur& p = sp_[spur];
    const ArrSpur* sp = snap && snap->spur[spur].art == ArrArt::rack ? &snap->spur[spur] : nullptr;
    for (Rec& x : p.rec) {
      if (x.art == 0 || aktuell_in(sp, x)) continue;
      if (x.art == 1) {
        const bool besetzt = snap && snap->platz(x.platz).art != ArrArt::leer;   // false: nobody owns the slot any more, the block fades and resets it
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_OHNE_OFF   // error case: the record is freed with its notes, they hang under the new owner
        if (!besetzt) continue;
#else
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_UMZUG_NUR_BESETZT
        if (!besetzt) continue;   // error case: a member that moved on takes its queued events along only when its old slot has a new owner (else its note on is lost)
#endif
        // the same member (id) under another slot number: its events that are still queued follow it (a note on queued for the old slot would otherwise
        // be lost, or sound on the slot of a stranger), whether or not another member took the old slot over; the queue is kept in order, an off whose on was
        // already delivered is replaced by the off below
        const ArrGlied* nach = nullptr;
        if (sp)
          for (int i = 0; i < sp->n_glieder && !nach; ++i)
            if (sp->glied[i].art != ArrArt::wirt && sp->glied[i].id == x.id && sp->glied[i].platz != x.platz) nach = &sp->glied[i];
        if (!besetzt && !nach) continue;   // nobody follows: its queue goes on as it was, the fade block ends the device
        Rec* rn = nach ? rec_fuer(p, *nach) : nullptr;
        uint64_t folgt[2] = {0, 0};   // keys whose on was moved and whose off was not queued yet
        const uint64_t gen = arr_.snapshot_generation();
        int w = 0;
        for (int i = 0; i < p.n; ++i) {
          Ev e = p.ev[i];
          if (e.platz != x.platz || (e.gen == gen && e.neu)) {
            p.ev[w++] = e;
            continue;
          }
          if (!rn) continue;
          const uint64_t bit = 1ULL << (e.ton & 63);
          const int k = (e.ton & 127) >> 6;
          if (e.art == 0) folgt[k] |= bit;
          else if (e.art == 1 && (folgt[k] & bit)) folgt[k] &= ~bit;
          else continue;
          e.platz = nach->platz;
          e.gen = gen;
          e.neu = true;
          p.ev[w++] = e;
        }
        p.n = w;
        if (rn) {
          rn->klingt[0] |= folgt[0];
          rn->klingt[1] |= folgt[1];
        }
        if (!besetzt) {   // the old slot is owned by nobody: the fade block of the dispatcher ends what sounds there; the record stays for that block
          x.klingt[0] = x.klingt[1] = 0;   // (its keys went to the successor above; a second off to the old slot is not needed)
          continue;
        }
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_NACH_KLINGT
        const uint64_t* halt = x.klingt;   // error case: the notes the member "holds" by the queue, not by the sink (an off still queued is lost, an on still queued gets an off)
#else
        const uint64_t* halt = x.geliefert;
#endif
        int n = 0;
        for (int k = 0; k < 2; ++k)
          for (uint64_t b = halt[k]; b; b &= b - 1) ++n;
        if (intern_ && n > ARR_RACK_ABGANG_EINZELN) {   // many keys: one all-off instead of a burst that could fill the queue of the sink
          intern_->alle_aus(x.platz, s0);
        } else if (intern_) {
          for (int ton = 0; ton < 128; ++ton)
            if (halt[ton >> 6] & (1ULL << (ton & 63))) intern_->note(x.platz, s0, static_cast<uint8_t>(ton), 0, false);
#ifndef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_KIT_NUR_OFFS   // error case: a kit leaver with few keys gets offs only, the kit ignores them and its one-shots ring into the new owner's bus
          if (x.kit) intern_->alle_aus(x.platz, s0);   // the kit sink ignores offs: its voices end by an all-off, at any key count (above 32 keys the all-off is already sent)
#endif
        }
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_AUS_FUER_ALLE
        if (intern_ && x.kit && sp)   // error case: the all-off goes to every member of the track, the voices of the members that stay are cut
          for (int i = 0; i < sp->n_glieder; ++i)
            if (sp->glied[i].art != ArrArt::wirt) intern_->alle_aus(sp->glied[i].platz, s0);
#endif
#endif
        x = Rec{};
        continue;
      }
      // Surge: the sink is addressed by track and Surge slot, the member slot number is only part of the identity of the record
#ifndef CYPHERDJ_MUTATION_ARR_RACK_SURGE_OHNE_UEBERNAHME   // error case: a Surge member with a new member slot starts a new record, the old one frees its notes
      if (sp)
        for (int i = 0; i < sp->n_glieder; ++i) {
          const ArrGlied& g = sp->glied[i];
          if (g.art != ArrArt::wirt || g.slot != x.slot) continue;
          bool vergeben = false;   // a current member of this identity that already has a record of its own is not a successor
          for (const Rec& y : p.rec) vergeben = vergeben || (y.art == 2 && y.platz == g.platz && y.slot == x.slot);
          if (vergeben) continue;
          if (Rec* r = rec_fuer(p, g)) {
            r->klingt[0] |= x.klingt[0];
            r->klingt[1] |= x.klingt[1];
            r->gain = x.gain;
            r->gain_da = x.gain_da;
            x = Rec{};
          }
          break;
        }
      if (x.art == 0) continue;
#endif
      if (slot_gespielt(snap, x.slot, spur)) {   // the Surge slot goes on under another member: the notes of this one end now
        if (ArrSenke* w = x.slot >= 1 && x.slot <= ARR_WIRT_SLOTS ? wirt_[x.slot - 1] : nullptr)
          for (int ton = 0; ton < 128; ++ton)
            if (x.klingt[ton >> 6] & (1ULL << (ton & 63))) w->note(spur, s0 + w->vorhalt(), static_cast<uint8_t>(ton), 0, false);
        x = Rec{};
      }
    }
  }
}

void ArrRackSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept { block_(spur, s0, m, l, r, sl_, sr_, nullptr); }

void ArrRackSenke::block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept {
  ++a.rack_einheiten;   // counted on the lane struct that ran the unit, also under the mutation
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_SCRATCH_GEMEINSAM
  block_(spur, s0, m, l, r, sl_, sr_, &a);   // error case: the member scratch ignores the lane, every lane renders its members into the sink's own pair
#else
  block_(spur, s0, m, l, r, a.rack_l, a.rack_r, &a);
#endif
}

// Does a record or a queued event of any track name a member slot that is not a current internal member of that same track? Surge records do not count here (they
// touch the Wirt sinks, which parallel_faehig keeps out through the member check and the Surge record check).
bool ArrRackSenke::sauber_(const ArrSnapshot* snap) const noexcept {
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_OHNE_SAUBER
  (void)snap;
  return true;   // error case: no scan, a stale record or event of one rack can hit the member slot of another rack that renders on another lane
#else
  for (int t = 0; t < ARR_SPUREN; ++t) {
    const Spur& p = sp_[t];
    const ArrSpur* st = snap->spur[t].art == ArrArt::rack ? &snap->spur[t] : nullptr;
    auto aktuell = [&](int platz) {
      if (!st) return false;
      for (int i = 0; i < st->n_glieder; ++i)
        if (st->glied[i].art == ArrArt::intern && st->glied[i].platz == platz) return true;
      return false;
    };
    for (const Rec& r : p.rec)
      if (r.art == 1 && !aktuell(r.platz)) return false;
    for (int i = 0; i < p.n; ++i)
      if (!aktuell(p.ev[i].platz)) return false;
  }
  return true;
#endif
}

bool ArrRackSenke::parallel_faehig(int spur) const noexcept {
  if (!intern_ || spur < 0 || spur >= ARR_SPUREN) return false;
  const ArrSnapshot* snap = arr_.snapshot();
  if (!snap || snap->spur[spur].art != ArrArt::rack) return false;
  const ArrSpur& sp = snap->spur[spur];
  const Spur& p = sp_[spur];
  if (sp.n_glieder < 1 || p.weg) return false;
#ifndef CYPHERDJ_MUTATION_SPUR_RACK_ABGANG_IN_BAHN
  if (abgaenge_faellig_()) return false;   // the first block of this snapshot has not run abgaenge() yet (vor_phase does, on the caller): a lane unit must not
#endif
  for (const Rec& r : p.rec)
    if (r.art == 2) return false;   // a Surge record (a member that left, or one the snapshot still has): block() would call the Wirt sink
  for (int i = 0; i < sp.n_glieder; ++i) {
    const ArrGlied& g = sp.glied[i];
    if (g.art != ArrArt::intern || g.platz < ARR_SPUREN || g.platz >= ARR_SENKEN_PLAETZE || !intern_->parallel_faehig(g.platz)) return false;
  }
  return sauber_(snap);   // last: the scan of all racks is the expensive part, a Surge or bk rack never gets there
}

// Caller, start of phase Q of every block, before any lane unit or serial track runs: the work of the first rack block of a new snapshot (abgaenge) that touches
// other tracks' records, queues and member slots. true: it ran, the plan is to be rebuilt (the records it freed make racks clean again).
bool ArrRackSenke::vor_phase(int64_t s0) noexcept {
#if defined(CYPHERDJ_MUTATION_SPUR_RACK_ABGANG_IN_BAHN) || defined(CYPHERDJ_MUTATION_ARR_RACK_ABGANG_NACH_NEU)
  (void)s0;
  return false;   // error case: no hook, the lazy call inside block() / block_bahn() runs it (after the queued events, or in a lane)
#else
  const ArrSnapshot* snap = arr_.snapshot();
  if (!snap || !abgaenge_faellig_()) return false;
#ifdef CYPHERDJ_MUTATION_ARR_RACK_SNAP_ZEIGER
  gesehen_zeiger_ = snap;
#else
  gesehen_ = arr_.snapshot_generation();
#endif
  abgaenge(snap, s0);
  return true;
#endif
}

void ArrRackSenke::glied_parameter(int spur, int glied, int param, float wert) noexcept {
  const ArrSnapshot* snap = arr_.snapshot();
  if (!snap || spur < 0 || spur >= ARR_SPUREN || glied < 0 || glied >= ARR_RACK_GLIEDER || !(wert == wert)) return;
  const ArrSpur& sp = snap->spur[spur];
  if (sp.art != ArrArt::rack || glied >= sp.n_glieder) return;
  const ArrGlied& g = sp.glied[glied];
  const bool gain = param == ARR_GLIED_PARAM_GAIN_DB;
  const ArrSpur* dev = g.platz >= ARR_SPUREN && g.platz < ARR_SENKEN_PLAETZE ? &snap->platz(g.platz) : nullptr;
  const bool intern = g.art == ArrArt::intern && dev && dev->art == ArrArt::intern;
  const bool rb = intern && std::strcmp(dev->geraet, "rb338") == 0;
  const bool bk = intern && std::strcmp(dev->geraet, "bk") == 0;
#ifdef CYPHERDJ_MUTATION_MAKRO_GLIED_ROW_GEWINNT
  {   // error case: a value the member's own snapshot holds wins over the macro (the gain of the snapshot only when it is not 0 dB)
    bool eigen = false;
    if (gain) eigen = g.gain != 1.0f;
    for (int i = 0; dev && !gain && i < dev->n_param; ++i) {
      const char* name = dev->param[i].name;
      if (rb && param >= 0 && param < ARR_GERAET_PARAMS && std::strncmp(name, ARR_GERAET_PARAM_NAME[param], sizeof dev->param[i].name) == 0) eigen = true;
      if (bk && param >= ARR_GLIED_PARAM_BK0 && param < ARR_GLIED_PARAM_BK0 + 8 && name[0] == 'k' && name[1] == '1' + (param - ARR_GLIED_PARAM_BK0)) eigen = true;
    }
    if (eigen) return;
  }
#endif
  if (gain) {
    if (!intern) return;   // a Surge member takes no macro target (the loader refuses it; a table made by hand is ignored here too)
    const float db = wert < static_cast<float>(ARR_GLIED_GAIN_DB_MIN) ? static_cast<float>(ARR_GLIED_GAIN_DB_MIN)
                                                                       : (wert > static_cast<float>(ARR_GLIED_GAIN_DB_MAX) ? static_cast<float>(ARR_GLIED_GAIN_DB_MAX) : wert);
    gain_ueber_[spur][glied] = static_cast<float>(std::pow(10.0, static_cast<double>(db) / 20.0));
    gain_ueber_da_[spur][glied] = true;
    return;
  }
  if (!intern || !intern_) return;
  const float w = wert < 0.0f ? 0.0f : (wert > 1.0f ? 1.0f : wert);
  if (rb && param >= 0 && param < ARR_GERAET_PARAMS)
    intern_->auto_parameter(g.platz, param, w);
  else if (bk && param >= ARR_GLIED_PARAM_BK0 && param < ARR_GLIED_PARAM_BK0 + 8)
    intern_->auto_parameter(g.platz, param - ARR_GLIED_PARAM_BK0, w);
}

bool ArrRackSenke::abgaenge_faellig_() const noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_RACK_SNAP_ZEIGER
  return arr_.snapshot() != gesehen_zeiger_;
#else
  return arr_.snapshot_generation() != gesehen_;
#endif
}

void ArrRackSenke::block_(int spur, int64_t s0, int m, float* l, float* r, float* sl, float* sr, ArrArbeit* a) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  const ArrSnapshot* snap = arr_.snapshot();
  // abgaenge() reads and rewrites the records and queues of EVERY track and sends offs to member slots of other racks: it must never run inside a lane unit. The
  // Arrangement runs it on the caller before phase Q (vor_phase); block() keeps the lazy call for callers without that hook (sink tests, the serial weg path), where
  // it finds nothing left to do after the hook. A lane unit (a != nullptr) never runs it: parallel_faehig() is false while one is due.
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_ABGANG_IN_BAHN
  const bool lazy = true;   // error case: the first lane unit of the new snapshot runs abgaenge() on its worker, beside the units of the other racks
#else
  const bool lazy = a == nullptr;
#endif
#ifdef CYPHERDJ_MUTATION_ARR_RACK_SNAP_ZEIGER
  const bool neu_gesehen = lazy && snap != gesehen_zeiger_;   // error case: a snapshot allocated at the address of the one seen last is taken for the same one
  auto gesehen_setzen = [&]() { gesehen_zeiger_ = snap; };
#else
  const uint64_t gen = arr_.snapshot_generation();
  const bool neu_gesehen = lazy && gen != gesehen_;
  auto gesehen_setzen = [&]() { gesehen_ = gen; };
#endif
#ifndef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_NACH_NEU   // error case: the old owner's offs come after the events of the new owner in the swap block
  if (neu_gesehen) {
    gesehen_setzen();
    abgaenge(snap, s0);
  }
#endif
  const ArrSpur* sp = snap && snap->spur[spur].art == ArrArt::rack ? &snap->spur[spur] : nullptr;
  for (Rec& x : p.rec) x.aktuell = false;
  Rec* je_glied[ARR_RACK_GLIEDER] = {};
  if (sp)
    for (int i = 0; i < sp->n_glieder; ++i) {
      je_glied[i] = rec_fuer(p, sp->glied[i]);
      if (je_glied[i]) {
        je_glied[i]->aktuell = true;
        je_glied[i]->kit = ist_kit(snap, sp->glied[i]);
      }
    }
  faelliges_weitergeben(p, s0 + m);   // internal events whose target sample lies in this block go to their sink now
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ABGANG_NACH_NEU
  if (neu_gesehen) {
    gesehen_setzen();
    abgaenge(snap, s0 + m);
  }
#endif
  // one member: render into the scratch buffers, add with the gain (a changed gain ramps over the block)
  auto addiere = [&](Rec& x, float g1, bool rampe) {
    std::fill(sl, sl + m, 0.0f);
    std::fill(sr, sr + m, 0.0f);
    if (x.art == 1) {
      if (intern_) {
        if (a) intern_->block_bahn(x.platz, s0, m, sl, sr, *a);
        else intern_->block(x.platz, s0, m, sl, sr);
      }
    } else if (ArrSenke* w = x.slot >= 1 && x.slot <= ARR_WIRT_SLOTS ? wirt_[x.slot - 1] : nullptr) {
      w->block(spur, s0, m, sl, sr);   // a Surge member: the rack is never a lane unit then, a == nullptr
    }
#ifdef CYPHERDJ_MUTATION_ARR_RACK_GAIN_SPRUNG
    const float g0 = g1;   // error case: a gain change is a step at the start of the block
#else
    const float g0 = rampe && x.gain_da ? x.gain : g1;
#endif
    if (g0 == g1) {
      for (int i = 0; i < m; ++i) {
        l[i] += sl[i] * g1;
        r[i] += sr[i] * g1;
      }
    } else {
      const float d = (g1 - g0) / static_cast<float>(m);
      for (int i = 0; i < m; ++i) {
        const float g = g0 + d * static_cast<float>(i + 1);   // the last sample reaches g1, the next block starts there
        l[i] += sl[i] * g;
        r[i] += sr[i] * g;
      }
    }
    x.gain = g1;
    x.gain_da = true;
  };
  if (sp)
    for (int i = 0; i < sp->n_glieder; ++i)
      if (je_glied[i]) addiere(*je_glied[i], gain_ueber_da_[spur][i] ? gain_ueber_[spur][i] : sp->glied[i].gain, true);   // T9: a gain target of this block replaces the snapshot gain
  for (bool& da : gain_ueber_da_[spur]) da = false;   // the targets are valid for this block only; the Arrangement reports them again before the next one
  // members that left (removed from the rack, or the track is no rack any more): the old device fades for one block, then the record is freed
  for (Rec& x : p.rec) {
    if (x.art == 0 || x.aktuell) continue;
    if (x.art == 1) {
      if (!(snap && snap->platz(x.platz).art != ArrArt::leer)) addiere(x, x.gain, false);   // a new member in that slot takes over by itself (abgaenge() ended the notes of the old one)
    } else if (!slot_gespielt(snap, x.slot, spur)) {
      if (ArrSenke* w = x.slot >= 1 && x.slot <= ARR_WIRT_SLOTS ? wirt_[x.slot - 1] : nullptr)
        if (w->spur_weg(spur, s0, false)) addiere(x, x.gain, false);
    }
    x = Rec{};
  }
  // The track is no rack any more: this is its fade block, the last call the sink gets for it (senke_fuer names another sink from now on). Events that wait for a target
  // beyond this block (the lead of a Surge member in the snapshot queues the internal members' events up to vorhalt() samples ahead) would stay in p.ev for good: nobody
  // delivers them, and sauber_ would see them as stale and keep every rack out of the lane lists. Their members are gone, they sound nowhere.
#ifndef CYPHERDJ_MUTATION_SPUR_RACK_WEG_QUEUE_BLEIBT
  if (!sp) p.n = 0;
#endif
  p.weg = false;
}

}  // namespace cdj
