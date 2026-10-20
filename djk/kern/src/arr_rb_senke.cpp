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
  if (spur < 0 || spur >= ARR_SPUREN) return;
  schiebe(sp_[spur], Ev{ziel, static_cast<uint8_t>(an ? 0 : 1), ton, vel});
}

void ArrRbSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  schiebe(sp_[spur], Ev{ziel, 2, 0, 0});
}

void ArrRbSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  sp_[spur].start = ziel;   // wirkt im Block, der ziel enthält (die Stimme ruht danach bis zur ersten Note)
}

bool ArrRbSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN || !sp_[spur].h) return false;
  sp_[spur].weg = true;   // wirkt im nächsten block() dieser Spur (Ausblende, dann zurücksetzen)
  return true;
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
  cypher_rb_vorgaben(p.h);
#endif
  for (int i = 0; i < q.n_param; ++i) {
    if (cypher_rb_setze(p.h, q.param[i].name, q.param[i].wert) != 0) ++abgelehnt_;
    p.param[i] = q.param[i];
  }
#ifdef CYPHERDJ_MUTATION_ARR_RB_REIHENFOLGE
  cypher_rb_vorgaben(p.h);   // Fehlerfall: die Vorgaben überschreiben die Parameter der Wiedergabe
#endif
  p.n_param = q.n_param;
}

void ArrRbSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN || m <= 0 || m > ARR_BLOCK) return;
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
  if (p.weg && arr_.snapshot() && arr_.snapshot()->spur[spur].art == ArrArt::intern) {
    {
      cypherdj::dsp::DenormalSchutz schutz;
      cypher_rb_block(p.h, puf_l_, puf_r_, static_cast<size_t>(m));
    }
    for (int i = 0; i < m; ++i) {
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
      l[i] += g * puf_l_[i];
      r[i] += g * puf_r_[i];
    }
    cypher_rb_zuruecksetzen(p.h);
    p.weg = false;
    p.wach = false;
    p.still = 0;
    p.stumm = false;
    p.n_param = -1;   // die Parameter der zurückgekehrten Spur setzt der Block gleich unten
  }
#endif
  const bool start_hier = p.start >= 0 && p.start < s0 + m;
  const ArrSnapshot* snap = p.weg ? nullptr : arr_.snapshot();   // Fix F2: die Spur ist nicht mehr intern, keine Parameter
  if (const ArrSnapshot* s = snap) {
    const ArrSpur& q = s->spur[spur];
#ifdef CYPHERDJ_MUTATION_ARR_RB_TAUSCH_OHNE_PARAMETER
    if (start_hier || p.n_param < 0) parameter_setzen(p, q);   // Fehlerfall: Parameter nur beim Start
#else
    if (start_hier || !parameter_gleich(p, q)) parameter_setzen(p, q);
#endif
  }
  if (start_hier) {
#ifndef CYPHERDJ_MUTATION_ARR_RB_OHNE_ZURUECKSETZEN
    cypher_rb_zuruecksetzen(p.h);   // Phase, Filter, Hüllkurven, Glide; die Stimme ruht bis zur ersten Note
#endif
    if (cypher_rb_alle_aus(p.h, versatz(p.start)) != 0) ++verloren_;   // Spec 6.13: alle_aus am Einsatz, vor der ersten Note
    p.start = -1;
    p.wach = false;
    p.stumm = false;
  }
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
    cypher_rb_zuruecksetzen(p.h);
    p.weg = false;
    p.wach = false;
    p.still = 0;
    p.start = -1;
    p.stumm = false;
    p.n_param = -1;
    return;
  }
#ifdef CYPHERDJ_MUTATION_ARR_RB_RUHE_SOFORT
  const bool ruhe = p.wach && arr_.status() == ArrStatus::steht && p.start < 0;   // Fehlerfall: schneidet den Ausklang ab
#else
  const bool ruhe = p.wach && p.still >= ARR_RB_RUHE && arr_.status() == ArrStatus::steht && p.start < 0;
#endif
  if (ruhe) {   // Ausklang vorbei, Transport steht: zurücksetzen, die Stimme ruht (Ausgabe bleibt 0)
    cypher_rb_zuruecksetzen(p.h);
    p.wach = false;
    p.still = 0;
  }
}

}  // namespace cdj
