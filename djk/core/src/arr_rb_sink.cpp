// D1 K2b: die RB-338 als Senke der internen Spuren (arr_rb_sink.h). Reihenfolge je Block: Parameter der Wiedergabe
// (bei Transport-Start immer, sonst nur bei Änderung), beim Einsatz zuruecksetzen und alle_aus, dann die gesammelten
// Ereignisse mit Versatz ab dem Blockanfang, dann der Block der FFI unter dem Denormal-Schutz.
#include "cypherdj/arr_rb_sink.h"

#include <cstring>

#include <cypherdj/dsp/denormal.h>

namespace cdj {

ArrRbSenke::ArrRbSenke(const Arrangement& arr, double fs) : arr_(arr) {
  bereit_ = true;
  for (Spur& p : sp_) {
    p.h = cypher_rb_neu(fs);
    bereit_ = bereit_ && p.h != nullptr;
  }
}

ArrRbSenke::~ArrRbSenke() {
  for (Spur& p : sp_) cypher_rb_frei(p.h);
}

int ArrRbSenke::ruhend() const {
  int n = 0;
  for (const Spur& p : sp_) n += p.h && !p.wach ? 1 : 0;
  return n;
}

void ArrRbSenke::schiebe(Spur& p, const Ev& e) noexcept {
  if (p.n >= ARR_RB_WARTE) {   // mehr als die FFI bis zum nächsten Block annimmt: gezählt, nicht gemeldet
    verloren_.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  p.ev[p.n++] = e;
}

void ArrRbSenke::note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  schiebe(sp_[spur], Ev{ziel, static_cast<uint8_t>(an ? 0 : 1), ton, vel});
}

void ArrRbSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  schiebe(sp_[spur], Ev{ziel, 2, 0, 0});
}

void ArrRbSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  sp_[spur].start = ziel;   // wirkt im Block, der ziel enthält (die Stimme ruht danach bis zur ersten Note)
}

bool ArrRbSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].h) return false;
  sp_[spur].weg = true;   // wirkt im nächsten block() dieser Spur (Ausblende, dann zurücksetzen)
  return true;
}

// Test seam: a fixed ring, no snprintf (real time); the name is cut at 15 characters
void ArrRbSenke::protokoll(int bahn, const Spur& p, const char* name, float wert) noexcept {
#ifdef CYPHERDJ_MUTATION_SPUR_PROTOKOLL_GEMEINSAM
  bahn = 0;   // error case: every lane writes ring 0, units on different lanes share slots and the index
#endif
  ProtokollBahn& b = protokoll_b_[bahn < 0 ? 0 : (bahn >= ARR_ARBEIT_BAHNEN ? ARR_ARBEIT_BAHNEN - 1 : bahn)];
  const uint64_t seq = protokoll_n_.fetch_add(1, std::memory_order_relaxed);   // global order; the slot belongs to this lane's ring
  Protokoll& e = b.e[b.n++ % PROTOKOLL_N];
  e.seq = seq;
  e.spur = static_cast<int>(&p - sp_);
  std::strncpy(e.name, name, sizeof e.name - 1);
  e.name[sizeof e.name - 1] = '\0';
  e.wert = wert;
}

void ArrRbSenke::vorgaben_(Spur& p, int bahn) noexcept {
  cypher_rb_vorgaben(p.h);
  protokoll(bahn, p, "<vorgaben>", 0.0f);
  for (float& a : p.angewendet) a = NAN_WERT;   // every parameter is on its default, no lane value holds any more
}

void ArrRbSenke::zuruecksetzen_(Spur& p) noexcept {
  cypher_rb_zuruecksetzen(p.h);
  for (float& a : p.angewendet) a = NAN_WERT;
}

// auch_gemeldet false: the value auto_parameter reported for THIS block stays (it runs before block(), also in a block that ends a double swap)
void ArrRbSenke::lanes_vergessen(Spur& p, bool auch_gemeldet) noexcept {
  for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
    p.lane_war[g] = false;
    if (auch_gemeldet) p.lane_da[g] = false;
    p.angewendet[g] = NAN_WERT;
  }
}

void ArrRbSenke::setze_(Spur& p, const char* name, float wert, int bahn) noexcept {
  if (cypher_rb_setze(p.h, name, wert) != 0) abgelehnt_.fetch_add(1, std::memory_order_relaxed);
  protokoll(bahn, p, name, wert);
}

void ArrRbSenke::auto_parameter(int spur, int param, float wert) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || param < 0 || param >= ARR_GERAET_PARAMS) return;
#ifdef CYPHERDJ_MUTATION_ARR_RB_SPUR_NULL
  spur = 0;   // error case: every value is filed under track index 0
#endif
  Spur& p = sp_[spur];
  p.lane_wert[param] = wert;
  p.lane_da[param] = true;
  gemeldet_.fetch_add(1, std::memory_order_relaxed);
}

// 1.12 slice 5 (D9): a relative lane without an absolute one. The sink knows the base value, so it forms the stack: base + summand, clamped, then the same path as a lane value.
void ArrRbSenke::auto_parameter_summand(int spur, int param, float delta) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN || param < 0 || param >= ARR_GERAET_PARAMS) return;
  const float summe = basiswert(arr_.snapshot(), spur, param) + delta;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME   // error case: the stack is not clamped
  auto_parameter(spur, param, summe);
#else
  auto_parameter(spur, param, summe < 0.0f ? 0.0f : (summe > 1.0f ? 1.0f : summe));
#endif
}

namespace {
// Normalised defaults of the RB-338 (= RB_VORGABE_NORM in model.ts; test_arr_rb_senke_auto case 6 checks them against cypher_rb_vorgaben)
constexpr float RB_VORGABE_NORM[ARR_GERAET_PARAMS] = {0.71034f, 0.62565f, 0.3f, 0.4f};
}  // namespace

float ArrRbSenke::basiswert(const ArrSnapshot* snap, int spur, int param) noexcept {
  float basis = RB_VORGABE_NORM[param];
  if (snap) {
    const ArrSpur& q = snap->platz(spur);
    for (int i = 0; i < q.n_param; ++i)
      if (std::strncmp(q.param[i].name, ARR_GERAET_PARAM_NAME[param], sizeof q.param[i].name) == 0) basis = q.param[i].wert;
  }
  return basis;
}

// E9. Per parameter: a reported value that differs from the applied one is set; a lane that fell away (reported in the block before, not in this one)
// puts the base value back once. Then the flags move on: war = da, da = false.
void ArrRbSenke::lanes_anwenden(Spur& p, const ArrSnapshot* snap, int spur, int bahn) noexcept {
  for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
    const char* name = ARR_GERAET_PARAM_NAME[g];
    if (p.lane_da[g]) {
      if (p.lane_wert[g] != p.angewendet[g]) {   // NaN (nothing applied) is unequal to every value
        setze_(p, name, p.lane_wert[g], bahn);
#ifdef CYPHERDJ_MUTATION_ARR_RB_LIVE_SPRUNG
        if (p.angewendet[g] == p.angewendet[g]) zuruecksetzen_(p);   // error case: a value that moves during the playback locks the smoothers (and resets the instrument) at once
#endif
        p.angewendet[g] = p.lane_wert[g];
      }
    } else if (p.lane_war[g]) {
      setze_(p, name, basiswert(snap, spur, g), bahn);
      p.angewendet[g] = NAN_WERT;
    }
    p.lane_war[g] = p.lane_da[g];
    p.lane_da[g] = false;
  }
}

// 1.9 U8 T9 (fix round 2): zuruecksetzen_ locks the smoothers on their target, so a value that reaches the instrument only AFTER it (lanes_anwenden) would glide there from the
// stored value of the snapshot. At a transport start the values reported for this block (a rack macro on a member, a device lane) are set first: the instrument then starts on them,
// as a plain track whose snapshot holds that value. The flags stay (lanes_anwenden moves them on); the caller marks the values as applied after zuruecksetzen_.
void ArrRbSenke::lanes_vorab_(Spur& p, int bahn) noexcept {
  for (int g = 0; g < ARR_GERAET_PARAMS; ++g)
    if (p.lane_da[g]) {
#ifdef CYPHERDJ_MUTATION_ARR_RB_START_VORAB_EIGEN
      setze_(p, ARR_GERAET_PARAM_NAME[g], basiswert(nullptr, 0, g), bahn);   // error case: the instrument locks on the default value, the reported one glides in afterwards
#else
      setze_(p, ARR_GERAET_PARAM_NAME[g], p.lane_wert[g], bahn);
#endif
    }
}

bool ArrRbSenke::parameter_gleich(const Spur& p, const ArrSpur& q) const noexcept {
  if (p.n_param != q.n_param) return false;
  for (int i = 0; i < q.n_param; ++i)
    if (p.param[i].wert != q.param[i].wert || std::strncmp(p.param[i].name, q.param[i].name, sizeof p.param[i].name) != 0)
      return false;
  return true;
}

// Spec 2.4: vorgaben, dann setze je Parameter der Wiedergabe (wirksam ab dem nächsten cypher_rb_block)
void ArrRbSenke::parameter_setzen(Spur& p, const ArrSpur& q, int bahn) noexcept {
#ifndef CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE
  vorgaben_(p, bahn);
#endif
  for (int i = 0; i < q.n_param; ++i) {
    setze_(p, q.param[i].name, q.param[i].wert, bahn);
    p.param[i] = q.param[i];
  }
#ifdef CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE
  vorgaben_(p, bahn);   // Fehlerfall: die Vorgaben überschreiben die Parameter der Wiedergabe
#endif
  p.n_param = q.n_param;
}

void ArrRbSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept { block_bahn(spur, s0, m, l, r, arbeit0_); }

bool ArrRbSenke::parallel_faehig(int spur) const noexcept {
  if (!bereit_ || spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].h) return false;
  const ArrSnapshot* s = arr_.snapshot();
  return s && s->platz(spur).art == ArrArt::intern && std::strcmp(s->platz(spur).geraet, "bk") != 0;
}

void ArrRbSenke::block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a_lane) noexcept {
#ifdef CYPHERDJ_MUTATION_SPUR_SCRATCH_GEMEINSAM
  ArrArbeit& a = arbeit0_;   // error case: the scratch ignores the lane, every lane renders into the lane-0 buffer
  (void)a_lane;
#else
  ArrArbeit& a = a_lane;
#endif
  float* const puf_l = a.rb_l;
  float* const puf_r = a.rb_r;
  ++a_lane.einheiten;   // counted on the caller's lane struct, also under the mutation
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  if (!p.h) return;
  auto versatz = [&](int64_t ziel) -> uint32_t {
#ifdef CYPHERDJ_MUTATION_ARR_RB_VERSATZ_NULL
    (void)ziel;
    return 0;   // Fehlerfall: jedes Ereignis am Blockanfang statt an seinem Sample
#else
    return ziel > s0 ? static_cast<uint32_t>(ziel - s0) : 0u;
#endif
  };
#ifndef CYPHERDJ_MUTATION_ARR_RB_ZURUECK_VERLOREN
  // K2b-Rest (b): kehrt die Spur im selben Zyklus zur RB zurück (intern -> leer -> intern, zwei Tausche vor diesem Block),
  // blendet nur der alte Ausklang aus: er wird ohne die Ereignisse der zurückgekehrten Spur gerechnet und linear auf 0
  // geblendet, dann setzt die Senke zurück, und die Spur spielt in diesem Block normal (zweiter Rechenschritt nur hier).
  // Vorher lief die neue Spur durch den Zweig weg und ging mit ihrem ersten Block ganz verloren (Energie 0 statt 23,05).
#ifdef CYPHERDJ_MUTATION_ARR_RB_BK_ALS_RUECKKEHR
  const bool rueckkehr = true;   // error case (S20): a bk track after the swap counts as a return to the RB
#else
  const bool rueckkehr = arr_.snapshot() && std::strcmp(arr_.snapshot()->platz(spur).geraet, "bk") != 0;   // S20: a bk track is no return to the RB
#endif
  if (p.weg && arr_.snapshot() && arr_.snapshot()->platz(spur).art == ArrArt::intern && rueckkehr) {
    {
      cypherdj::dsp::DenormalSchutz schutz;
      cypher_rb_block(p.h, puf_l, puf_r, static_cast<size_t>(m));
    }
    for (int i = 0; i < m; ++i) {
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
      l[i] += g * puf_l[i];
      r[i] += g * puf_r[i];
    }
    zuruecksetzen_(p);
    p.weg = false;
    p.wach = false;
    p.still = 0;
    p.stumm = false;
    p.n_param = -1;   // die Parameter der zurückgekehrten Spur setzt der Block gleich unten
    lanes_vergessen(p, false);   // the lane value of this block (reported before block()) stays for the returned track
  }
#endif
  const bool start_hier = p.start >= 0 && p.start < s0 + m;
  const ArrSnapshot* snap = p.weg ? nullptr : arr_.snapshot();   // Fix F2: die Spur ist nicht mehr intern, keine Parameter
#ifdef CYPHERDJ_MUTATION_ARR_RB_LANE_VOR_VORGABE
  if (!p.weg) lanes_anwenden(p, snap, spur, a_lane.bahn);   // error case: the lane value goes in BEFORE the defaults and base values, which then overwrite it
#endif
  if (const ArrSnapshot* s = snap) {
    const ArrSpur& q = s->platz(spur);
#ifdef CYPHERDJ_MUTATION_ARR_RB_TAUSCH_OHNE_PARAMETER
    if (start_hier || p.n_param < 0) parameter_setzen(p, q, a_lane.bahn);   // Fehlerfall: Parameter nur beim Start
#else
    if (start_hier || !parameter_gleich(p, q)) parameter_setzen(p, q, a_lane.bahn);
#endif
  }
  if (start_hier) {
#ifndef CYPHERDJ_MUTATION_ARR_RB_START_GLEITET
    const bool vorab = !p.weg;
#else
    const bool vorab = false;
#endif
    if (vorab) lanes_vorab_(p, a_lane.bahn);   // before the smoothers lock on their target: the instrument starts on the reported value
#ifndef CYPHERDJ_MUTATION_ARR_RB_OHNE_ZURUECKSETZEN
    zuruecksetzen_(p);   // Phase, Filter, Hüllkurven, Glide; die Stimme ruht bis zur ersten Note
#endif
#ifndef CYPHERDJ_MUTATION_ARR_RB_START_VORAB_EIGEN
    if (vorab)   // zuruecksetzen_ forgot what was applied: the reported values are on the instrument, lanes_anwenden must not set them a second time
      for (int g = 0; g < ARR_GERAET_PARAMS; ++g)
        if (p.lane_da[g]) p.angewendet[g] = p.lane_wert[g];
#endif
    if (cypher_rb_alle_aus(p.h, versatz(p.start)) != 0) verloren_.fetch_add(1, std::memory_order_relaxed);   // Spec 6.13: alle_aus am Einsatz, vor der ersten Note
    p.start = -1;
    p.wach = false;
    p.stumm = false;
  }
#ifndef CYPHERDJ_MUTATION_ARR_RB_LANE_VOR_VORGABE
  if (!p.weg) lanes_anwenden(p, snap, spur, a_lane.bahn);   // E9: after the defaults, the base values and zuruecksetzen, before the notes
#endif
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    int32_t rc = 0;
    if (e.art == 0) {
      rc = cypher_rb_note_an(p.h, versatz(e.ziel), e.ton, e.vel);
      p.wach = p.wach || rc == 0;
    } else if (e.art == 1) {
      rc = cypher_rb_note_aus(p.h, versatz(e.ziel), e.ton);
    } else {
      rc = cypher_rb_alle_aus(p.h, versatz(e.ziel));
    }
    if (rc != 0) verloren_.fetch_add(1, std::memory_order_relaxed);
  }
  p.n = 0;
  {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_rb_block(p.h, puf_l, puf_r, static_cast<size_t>(m));
  }
  // Spec 6.28: Kurzblende vor dem Zurücksetzen. Liegt der Einsatz im nächsten Block (gleiche Größe wie dieser; so treibt
  // der Kern das Modul, ein Zyklus je Block), blendet dieser Block linear auf 0 aus; danach bleibt die Spur bis zum Block
  // des Einsatzes stumm (falls der nächste Block kürzer ausfällt). Die Stimme rechnet weiter, nur ihre Ausgabe fällt weg.
  int blende = 0;   // 0 voll, 1 Ausblende in diesem Block, 2 stumm
#ifndef CYPHERDJ_MUTATION_ARR_RB_OHNE_BLENDE
  if (p.start >= s0 + m) {
    if (p.stumm) {
      blende = 2;
    } else if (p.start < s0 + 2 * static_cast<int64_t>(m)) {
      blende = 1;
      p.stumm = true;
    }
  }
#endif
  if (p.weg && blende == 0) blende = 1;   // Fix F2: Spurwechsel, dieser Block blendet aus (stumm bleibt stumm)
  bool null = true;
  for (int i = 0; i < m; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_RB_BLENDE_HART
    const float g = blende == 0 ? 1.0f : 0.0f;   // Fehlerfall F3: harter Schnitt am Anfang des Blendblocks
#else
    const float g = blende == 0 ? 1.0f : blende == 1 ? static_cast<float>(m - 1 - i) / static_cast<float>(m) : 0.0f;
#endif
    l[i] += g * puf_l[i];
    r[i] += g * puf_r[i];
    null = null && puf_l[i] == 0.0f && puf_r[i] == 0.0f;
  }
  p.still = null ? p.still + m : 0;
  if (p.weg) {   // Fix F2: ausgeblendet; zurücksetzen, die Stimme ruht, die Parameter setzt der nächste interne Block neu
    zuruecksetzen_(p);
    p.weg = false;
    p.wach = false;
    p.still = 0;
    p.start = -1;
    p.stumm = false;
    p.n_param = -1;
    lanes_vergessen(p, true);
    return;
  }
#ifdef CYPHERDJ_MUTATION_ARR_RB_RUHE_SOFORT
  const bool ruhe = p.wach && arr_.status() == ArrStatus::steht && p.start < 0;   // Fehlerfall: schneidet den Ausklang ab
#else
  const bool ruhe = p.wach && p.still >= ARR_RB_RUHE && arr_.status() == ArrStatus::steht && p.start < 0;
#endif
  if (ruhe) {   // Ausklang vorbei, Transport steht: zurücksetzen, die Stimme ruht (Ausgabe bleibt 0)
    zuruecksetzen_(p);
    p.wach = false;
    p.still = 0;
  }
}

}  // namespace cdj
