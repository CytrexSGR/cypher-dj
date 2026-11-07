// D1 K2b: die RB-338 als Senke der internen Spuren (arr_rb_senke.h). Reihenfolge je Block: Parameter der Wiedergabe
// (bei Transport-Start immer, sonst nur bei Änderung), beim Einsatz zuruecksetzen und alle_aus, dann die gesammelten
// Ereignisse mit Versatz ab dem Blockanfang, dann der Block der FFI unter dem Denormal-Schutz.
#include "cypherdj/arr_rb_senke.h"

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
    ++verloren_;
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
void ArrRbSenke::protokoll(const Spur& p, const char* name, float wert) noexcept {
  Protokoll& e = protokoll_[protokoll_n_ % PROTOKOLL_N];
  e.spur = static_cast<int>(&p - sp_);
  std::strncpy(e.name, name, sizeof e.name - 1);
  e.name[sizeof e.name - 1] = '\0';
  e.wert = wert;
  ++protokoll_n_;
}

void ArrRbSenke::vorgaben_(Spur& p) noexcept {
  cypher_rb_vorgaben(p.h);
  protokoll(p, "<vorgaben>", 0.0f);
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

void ArrRbSenke::setze_(Spur& p, const char* name, float wert) noexcept {
  if (cypher_rb_setze(p.h, name, wert) != 0) ++abgelehnt_;
  protokoll(p, name, wert);
}

void ArrRbSenke::auto_parameter(int spur, int param, float wert) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || param < 0 || param >= ARR_GERAET_PARAMS) return;
#ifdef CYPHERDJ_MUTATION_ARR_RB_SPUR_NULL
  spur = 0;   // error case: every value is filed under track index 0
#endif
  Spur& p = sp_[spur];
  p.lane_wert[param] = wert;
  p.lane_da[param] = true;
  ++gemeldet_;
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
// Normalised defaults of the RB-338 (= RB_VORGABE_NORM in modell.ts; test_arr_rb_senke_auto case 6 checks them against cypher_rb_vorgaben)
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
void ArrRbSenke::lanes_anwenden(Spur& p, const ArrSnapshot* snap, int spur) noexcept {
  for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
    const char* name = ARR_GERAET_PARAM_NAME[g];
    if (p.lane_da[g]) {
      if (p.lane_wert[g] != p.angewendet[g]) {   // NaN (nothing applied) is unequal to every value
        setze_(p, name, p.lane_wert[g]);
        p.angewendet[g] = p.lane_wert[g];
      }
    } else if (p.lane_war[g]) {
      setze_(p, name, basiswert(snap, spur, g));
      p.angewendet[g] = NAN_WERT;
    }
    p.lane_war[g] = p.lane_da[g];
    p.lane_da[g] = false;
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
void ArrRbSenke::parameter_setzen(Spur& p, const ArrSpur& q) noexcept {
#ifndef CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE
  vorgaben_(p);
#endif
  for (int i = 0; i < q.n_param; ++i) {
    setze_(p, q.param[i].name, q.param[i].wert);
    p.param[i] = q.param[i];
  }
#ifdef CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE
  vorgaben_(p);   // Fehlerfall: die Vorgaben überschreiben die Parameter der Wiedergabe
#endif
  p.n_param = q.n_param;
}

void ArrRbSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
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
      cypher_rb_block(p.h, puf_l_, puf_r_, static_cast<size_t>(m));
    }
    for (int i = 0; i < m; ++i) {
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
      l[i] += g * puf_l_[i];
      r[i] += g * puf_r_[i];
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
  if (!p.weg) lanes_anwenden(p, snap, spur);   // error case: the lane value goes in BEFORE the defaults and base values, which then overwrite it
#endif
  if (const ArrSnapshot* s = snap) {
    const ArrSpur& q = s->platz(spur);
#ifdef CYPHERDJ_MUTATION_ARR_RB_TAUSCH_OHNE_PARAMETER
    if (start_hier || p.n_param < 0) parameter_setzen(p, q);   // Fehlerfall: Parameter nur beim Start
#else
    if (start_hier || !parameter_gleich(p, q)) parameter_setzen(p, q);
#endif
  }
  if (start_hier) {
#ifndef CYPHERDJ_MUTATION_ARR_RB_OHNE_ZURUECKSETZEN
    zuruecksetzen_(p);   // Phase, Filter, Hüllkurven, Glide; die Stimme ruht bis zur ersten Note
#endif
    if (cypher_rb_alle_aus(p.h, versatz(p.start)) != 0) ++verloren_;   // Spec 6.13: alle_aus am Einsatz, vor der ersten Note
    p.start = -1;
    p.wach = false;
    p.stumm = false;
  }
#ifndef CYPHERDJ_MUTATION_ARR_RB_LANE_VOR_VORGABE
  if (!p.weg) lanes_anwenden(p, snap, spur);   // E9: after the defaults, the base values and zuruecksetzen, before the notes
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
    if (rc != 0) ++verloren_;
  }
  p.n = 0;
  {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_rb_block(p.h, puf_l_, puf_r_, static_cast<size_t>(m));
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
    l[i] += g * puf_l_[i];
    r[i] += g * puf_r_[i];
    null = null && puf_l_[i] == 0.0f && puf_r_[i] == 0.0f;
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
