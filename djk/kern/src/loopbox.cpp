#include "cypherdj/loopbox.h"

#include <algorithm>

namespace cdj {

void BoxBand::band(int64_t ab, int n, float* l, float* r) const noexcept {
  const int64_t F = loop ? loop->frames : 0;
  if (F <= 0) {
    std::fill(l, l + n, 0.0f);
    std::fill(r, r + n, 0.0f);
    return;
  }
  const float* d = loop->daten.data();
#ifdef CYPHERDJ_MUTATION_BOX_BAND_OHNE_WICKELN
  for (int i = 0; i < n; ++i) {  // Fehlerfall (7a Mutation): hinter dem Loop-Ende Stille statt Umlauf
    const int64_t p = ab + i;
    const bool drin = p >= 0 && p < F;
    l[i] = drin ? d[2 * p] : 0.0f;
    r[i] = drin ? d[2 * p + 1] : 0.0f;
  }
#else
  int64_t p = ((ab % F) + F) % F;
  for (int i = 0; i < n; ++i) {
    l[i] = d[2 * p];
    r[i] = d[2 * p + 1];
    if (++p == F) p = 0;
  }
#endif
  const int64_t sb = still_bis.load(std::memory_order_relaxed);
  if (ab < sb) {  // Keylock 7b.2: vor dem Einsatz Stille (Start aus Stille)
    const int64_t k = std::min<int64_t>(n, sb - ab);
    std::fill(l, l + k, 0.0f);
    std::fill(r, r + k, 0.0f);
  }
}

DehnerAnker box_anker(const Karte& k, int64_t s, int beats, int64_t frames, int64_t versatz) noexcept {
  DehnerAnker a;
  const double lang = beats > 0 ? static_cast<double>(beats) : 1.0;
  a.b = std::floor(k.beat_at(static_cast<double>(s)) / lang) * lang;
#ifdef CYPHERDJ_MUTATION_BOX_ANKER_OHNE_VERSATZ
  (void)frames;
  (void)versatz;
  a.f = 0.0;  // Fehlerfall (7a Mutation): der Raster-Versatz fehlt im Anker
#else
  a.f = frames > 0 ? static_cast<double>(((versatz % frames) + frames) % frames) : 0.0;
#endif
  return a;
}

const Loop* LoopBoxen::laden(int box, const Loop* l, bool von_cypher, int64_t s) {
  if (!gueltig(box)) return l;
  const int i = box - 1;
  Box& b = b_[i];
  if (l && l == b.wartend) return nullptr;  // F13: wartet schon
  if (b.wartend) {  // F13: ein noch wartender Loop wurde nie gespielt: zurück über abholen()
    const Loop* w = b.wartend;
    b.wartend = nullptr;
    b.wartend_cypher = false;
    gib_frei(b, w);
  }
  const Loop* alt = b.loop;
#ifndef CYPHERDJ_MUTATION_LOOP_LADEN_HART
  // F13 (Audit 2026-10-01): klingt die Box, tauscht laden() nicht hart (vorher b.loop = l mitten im Lesepfad, Sprung bis
  // 0,6). Der neue Loop wartet in b.wartend, block() übernimmt ihn mit Blende; der alte geht danach über abholen().
  if (l && alt && l != alt && (b.status == BoxStatus::laeuft || b.status == BoxStatus::endet)) {
    b.wartend = l;
    b.wartend_cypher = von_cypher;
    return nullptr;
  }
#endif
  if (l != alt) {  // Pfad und Blende lesen aus dem alten Loop (oder einem davor): alles außer ihm geht in den Ring
    const Loop* pf = b.pfad;
    const Loop* ba = b.blende_alt;
    b.pfad = nullptr;
    b.blende_alt = nullptr;
    b.blende_pos = 0;
    b.loop = l;
    for (const Loop* q : {pf, ba})
      if (q != alt) gib_frei(b, q);  // der alte Loop selbst geht über den Rückgabewert (oder heraus) zurück
  }
  b.versatz = l ? l->versatz : 0;
  if (!l) b.status = BoxStatus::leer;
  else if (b.status == BoxStatus::leer) b.status = BoxStatus::bereit;
  if (kl_bereit(i) && l != alt) {  // Task 7 (7a 3.4): Entladen in jedem Status Leer-Epoche, wartende Box neu mit Vorlauf
    if (!l) {
      if (!b.ring_vor) kl_[i].les.stumm();  // 7c.2: klingt die Vorlage, blendet kl_leer sie aus
      kl_leer(i, s);
    } else if (b.status == BoxStatus::wartet) {
      kl_ereignis(i, s);
    }
  }
  return alt == l ? nullptr : heraus(i, alt);
}

// Task 7 (7a 3.3, R-B1): die einzige Stelle, die entscheidet, ob ein abgelöster Loop als Rückgabewert hinausgeht oder (der
// Dehner kann ihn noch lesen) über den Freigabe-Ring, den abholen() erst nach der Quittung leert.
const Loop* LoopBoxen::heraus(int i, const Loop* q) {
#ifdef CYPHERDJ_MUTATION_BOX_LADEN_DIREKT
  (void)i;
  return q;  // Fehlerfall (7a Mutation, Stand HEAD): auch ein verliehener Loop geht sofort hinaus
#else
  if (!q || !verliehen(q)) return q;
  gib_frei(b_[i], q);
  return nullptr;
#endif
}

bool LoopBoxen::verliehen(const Loop* q) const noexcept {
  for (const Kl& x : kl_)
    if (x.leihe.verliehen([q](const BoxBand& bb) { return bb.loop == q; })) return true;
  return false;
}

void LoopBoxen::gib_frei(Box& b, const Loop* q) {
  if (!q || q == b.loop || q == b.pfad || q == b.blende_alt) return;  // wird noch gebraucht
  for (int i = 0; i < frei_n_; ++i)
    if (frei_[i] == q) return;  // schon im Ring: jeder Zeiger genau einmal
  if (frei_n_ < FREI_MAX) frei_[frei_n_++] = q;
  else ++frei_verloren_;  // Ring voll: der Kern holt nach jedem laden und Block ab, das darf nie eintreten
}

void LoopBoxen::pfad_verwerfen(Box& b) {
  const Loop* pf = b.pfad;
  const Loop* ba = b.blende_alt;
  b.pfad = nullptr;
  b.blende_alt = nullptr;
  b.blende_pos = 0;
  b.blende_leistung = false;
  gib_frei(b, pf);
  gib_frei(b, ba);
}

// F13: der wartende Loop übernimmt. blenden: der bisherige Pfad klingt über LOOPBOX_LADEN_BLENDE gleich laut aus; sonst (Box
// steht) ohne Blende. Der alte Loop geht über den Ring zurück, sobald nichts mehr aus ihm liest.
void LoopBoxen::uebernehmen(Box& b, bool blenden) {
  const Loop* alt = b.loop;
  if (blenden && b.pfad) {
    b.blende_alt = b.pfad;
    b.blende_versatz = b.versatz;
    b.blende_pos = 0;
    b.blende_leistung = true;
    b.pfad = nullptr;  // block() wählt den neuen Pfad wie im ersten Block nach einem Einsatz
  } else {
    pfad_verwerfen(b);
  }
  b.loop = b.wartend;
  b.versatz = b.loop->versatz;
  b.wartend = nullptr;
  b.wartend_cypher = false;
  gib_frei(b, alt);
}

void LoopBoxen::cypher_wartende_verwerfen() {
  for (Box& b : b_) {
    if (!b.wartend || !b.wartend_cypher) continue;
    const Loop* w = b.wartend;
    b.wartend = nullptr;
    b.wartend_cypher = false;
    gib_frei(b, w);
  }
}

// Task 7 (7a 3.3 Punkt 2): heraus kommt der erste Zeiger, den keine Leihe mehr trägt (die Reihenfolge der Quittungen ist
// nicht die des Einreihens). Ohne Dehner trägt keine Leihe etwas: wie bisher der älteste.
const Loop* LoopBoxen::abholen() {
  for (int i = 0; i < LOOP_BOXEN; ++i)
    if (kl_bereit(i)) kl_[i].leihe.pflege(kl_[i].post->antwort(), kl_[i].d->quittiert_e());
  for (int j = 0; j < frei_n_; ++j) {
    const Loop* q = frei_[j];
#ifndef CYPHERDJ_MUTATION_BOX_LEIHE_OHNE_WARTEN
    if (verliehen(q)) continue;
#endif
    for (int m = j + 1; m < frei_n_; ++m) frei_[m - 1] = frei_[m];
    frei_[--frei_n_] = nullptr;
    return q;
  }
  return nullptr;
}

int LoopBoxen::raster(int box, int64_t v, int64_t s) {
  if (!gueltig(box)) return 2;
  const int i = box - 1;
  Box& b = b_[i];
  if (!b.loop) return 1;
  if (v <= -b.loop->frames || v >= b.loop->frames) return 2;
  // Task 7 (7a 3.4, Raster je Status): was im Ring klingt, friert mit dem alten Versatz ein; dann Ansatz mit dem neuen
  // Versatz im Anker (klingend: Brücke; im Direktweg und wartend: nichts hörbar); stehend nur der Versatz.
  const bool klingt = b.status == BoxStatus::laeuft || b.status == BoxStatus::endet;
  if (kl_bereit(i) && klingt) kl_einfrieren(i, s, false);
  b.versatz = v;
  if (kl_bereit(i) && (klingt || b.status == BoxStatus::wartet)) kl_ereignis(i, s);
  return 0;
}

bool LoopBoxen::start(int box, double beat0, int64_t s) {
  if (!gueltig(box) || !b_[box - 1].loop) return false;
  Box& b = b_[box - 1];
  if (b.status == BoxStatus::bereit) {
    b.status = BoxStatus::wartet;
    b.start_beat = naechste_eins(beat0);
    if (kl_bereit(box - 1)) kl_ereignis(box - 1, s);  // Task 7: Ansatz mit Vorlauf (Ring zur Eins eingeschwungen)
  } else if (b.status == BoxStatus::endet) {
    b.status = BoxStatus::laeuft;  // Stopp zurückgenommen
    if (b.aus_laeuft) b.huelle.ziel(1.0f, LOOPBOX_AUS);  // F15: die Stopp-Rampe lief schon: vom Ist-Wert zurück auf 1
    b.aus_ab = -1;
    b.aus_ende = -1;
    b.aus_laeuft = false;
  }
  return true;
}

bool LoopBoxen::stopp(int box, double beat0, int64_t s) {
  if (!gueltig(box) || !b_[box - 1].loop) return false;
  Box& b = b_[box - 1];
  if (b.status == BoxStatus::wartet) {
    b.status = BoxStatus::bereit;
    if (kl_bereit(box - 1)) {  // Task 7: der Ansatz mit Vorlauf wird zurückgenommen, der R3 ruht
      if (!b.ring_vor) kl_[box - 1].les.stumm();  // 7c.2: klingt die Vorlage, blendet kl_leer sie aus
      kl_leer(box - 1, s);
    }
  } else if (b.status == BoxStatus::laeuft) {
    b.status = BoxStatus::endet;
    b.stopp_beat = naechste_eins(beat0);
  }
  return true;
}

Mitschnitt* LoopBoxen::leeren(int64_t s) {
  for (int i = 0; i < LOOP_BOXEN; ++i)
    if (kl_bereit(i)) {  // Task 7: neue Zeitachse, der Ring der alten wird verworfen
      kl_[i].les.stumm();
      kl_leer(i, s);
    }
  for (Box& b : b_) {
    if (b.loop) b.status = BoxStatus::bereit;
    b.huelle = Blende();  // F15: neue Zeitachse, keine halbe Hülle mitnehmen (der Ausklang kommt aus ausklingen())
    b.aus_ab = -1;
    b.aus_ende = -1;
    b.aus_laeuft = false;
  }
  Mitschnitt* m = mitschnitt_;  // MVP 2 Scheibe 2: ein laufender Mitschnitt gilt als abgebrochen
  mitschnitt_ = nullptr;
  return m;
}

void LoopBoxen::ausklingen(const Karte& k, int64_t s) {
  const int64_t e = s + LOOPBOX_AUS - 1;
  const bool tempo_ok = std::fabs(k.bpm_at((double)s) - LOOP_BPM) < 1e-6 && k.k_at((double)s) == 0.0 &&
                        std::fabs(k.bpm_at((double)e) - LOOP_BPM) < 1e-6 && k.k_at((double)e) == 0.0;
  for (int i = 0; i < LOOP_BOXEN; ++i) {
    Box& b = b_[i];
    b.schwanz_rest = 0;
    b.schwanz_pos = 0;
#ifndef CYPHERDJ_MUTATION_LOOP_OHNE_HUELLE
    const bool klingt = b.loop && b.pfad && (b.status == BoxStatus::laeuft || b.status == BoxStatus::endet);
    if (!klingt) continue;
    // Task 7 (7a 3.5 Schwanz): klingt die Box im Ring (ohne laufende Keylock-Blende), kommen die 144 Frames aus dem Ring;
    // liegen weniger vor, rechnet sie wie bisher den eigenen Pfad (Rückfall).
    bool aus_ring = false;
#ifndef CYPHERDJ_MUTATION_BOX_SCHWANZ_VARI
    if (kl_bereit(i) && kl_[i].les.ring_hoerbar() && !kl_[i].les.blendet())
      aus_ring = kl_[i].les.ring_lesen(s, LOOPBOX_AUS, b.schwanz_l, b.schwanz_r) == LOOPBOX_AUS;
#endif
    if (!aus_ring) spiele_pfad(b, b.pfad, tempo_ok, b.versatz, k, s, s + LOOPBOX_AUS, s, b.schwanz_l, b.schwanz_r);
    if (b.blende_alt && !aus_ring) {  // Prüfung 2.3 Befund 4: eine laufende Pfad- oder Ladeblende läuft im Schwanz weiter
      spiele_pfad(b, b.blende_alt, tempo_ok, b.blende_versatz, k, s, s + LOOPBOX_AUS, s, alt_l_, alt_r_);
      for (int t = 0; t < LOOPBOX_AUS; ++t) {
        const int kk = b.blende_pos + t;
        if (kk >= LOOPBOX_LADEN_BLENDE) break;
        const float u = (float)kk / (float)LOOPBOX_LADEN_BLENDE;
        float ga = 1.0f - u, gn = u;
        if (b.blende_leistung) gleich_laut(u, ga, gn);
        b.schwanz_l[t] = alt_l_[t] * ga + b.schwanz_l[t] * gn;
        b.schwanz_r[t] = alt_r_[t] * ga + b.schwanz_r[t] * gn;
      }
    }
    Blende h = b.huelle;
    h.ziel(0.0f, LOOPBOX_AUS);
    for (int t = 0; t < LOOPBOX_AUS; ++t) {
      const float g = h.schritt();
      b.schwanz_l[t] *= g;
      b.schwanz_r[t] *= g;
    }
    b.schwanz_rest = LOOPBOX_AUS;
#else
    (void)tempo_ok;
#endif
  }
}

void LoopBoxen::schwanz_mischen(Box& b, int n, float* l, float* r) {
  const int m = std::min(n, b.schwanz_rest);
  for (int t = 0; t < m; ++t) {
    l[t] += b.schwanz_l[b.schwanz_pos + t];
    r[t] += b.schwanz_r[b.schwanz_pos + t];
  }
  b.schwanz_pos += m;
  b.schwanz_rest -= m;
}

double LoopBoxen::mitschnitt_ab_beat(double beat0, int beats) {
  const double lang = (double)beats;
  return std::ceil(beat0 / lang - 1e-9) * lang;
}

bool LoopBoxen::mitschnitt(Mitschnitt* m, double beat0, const Karte& k) {
  if (mitschnitt_) return false;  // ueberlappung: der Aufrufer meldet ab und gibt m unverändert zurück
  const double lang = (double)m->beats;
  m->ab_beat = mitschnitt_ab_beat(beat0, m->beats);
  m->ab_sample = std::llround(k.sample_at(m->ab_beat));
  // Plan Tempo-Folge: N Beats beim Tempo der Aufnahme; nie mehr, als der Puffer fasst
  m->roh_frames = std::min<int64_t>(std::llround(k.sample_at(m->ab_beat + lang)) - m->ab_sample, (int64_t)m->daten.size() / 2);
  m->bpm = k.bpm_at((double)m->ab_sample);
  m->gefuellt = 0;
  mitschnitt_ = m;
  return true;
}

// ------------------------------------------------------------------------------------------------ Keylock Task 7
void LoopBoxen::setze_karte(const Karte* k, const uint32_t* generation) noexcept {
  kl_k_ = k;
  kl_gen_ = generation;
  for (Kl& q : kl_)
    if (q.d) q.les.verbinde(q.d, q.post, kl_k_, kl_gen_);
}

void LoopBoxen::setze_keylock(int box, DehnerBasis* d, StreckPost* post) noexcept {
  if (!gueltig(box)) return;
  Kl& q = kl_[box - 1];
  q.d = d;
  q.post = post;
  q.les.verbinde(d, post, kl_k_, kl_gen_);
  // Task 2.5b-Muster (7a 3.4 „Dehner werden im Betrieb angehängt“): eine schon spielende Box setzt am nächsten Blockanfang an
#ifndef CYPHERDJ_MUTATION_BOX_SPAET_OHNE_ANSATZ
  const BoxStatus st = b_[box - 1].status;
  if (d && b_[box - 1].loop && (st == BoxStatus::wartet || st == BoxStatus::laeuft || st == BoxStatus::endet)) q.offen = true;
#endif
}

void LoopBoxen::keylock_getrennt() noexcept {
  for (Kl& q : kl_) {
    q.les.stumm();
    q.les.verbinde(nullptr, nullptr, kl_k_, kl_gen_);
    q.d = nullptr;
    q.post = nullptr;
    q.band = nullptr;
    q.offen = false;
    q.halten = false;
    q.leihe = StreckLeihe<BoxBand, BOX_KEYLOCK_BAENDER>();
  }
}

void LoopBoxen::keylock(bool an, int64_t s) noexcept {
  if (an == keylock_) return;
  keylock_ = an;
#ifdef CYPHERDJ_MUTATION_BOX_KEYLOCK_AUS_IGNORIERT
  (void)s;
  return;  // Fehlerfall (7a Mutation): der Ring folgt dem Schalter nicht
#else
  // Keylock 7c.4 (a, Entscheidung der Hauptinstanz 08.10.): Knopf aus auf der Basis bei hörbarem Ring: der Ring bleibt hörbar
  // (bei Faktor 1 klingt er wie der Direktweg); er geht erst beim nächsten Ereignis bzw. wenn das Tempo die Basis verlässt
  // (dann normal in den Varispeed-Weg). Knopf wieder an: der gehaltene Ring läuft einfach weiter.
  const bool basis = kl_k_ && std::fabs(kl_k_->bpm_at((double)s) - LOOP_BPM) < 1e-6 && kl_k_->k_at((double)s) == 0.0;
  bool gehalten[LOOP_BOXEN] = {};
  for (int i = 0; i < LOOP_BOXEN; ++i) {
    if (!kl_bereit(i)) continue;
    if (!an) {
#ifndef CYPHERDJ_MUTATION_KEYLOCK_AUS_BASIS_EINFRIEREN
      if (basis && kl_[i].les.ring_hoerbar() && !kl_[i].les.blendet()) {
        kl_[i].halten = true;
        continue;
      }
#endif
      kl_einfrieren(i, s, false);
      kl_leer(i, s);
    } else if (kl_[i].halten) {
      kl_[i].halten = false;
      gehalten[i] = true;
    }
  }
  kl_an_ = an;
  if (an)
    for (int i = 0; i < LOOP_BOXEN; ++i)
      if (kl_bereit(i) && !gehalten[i]) kl_ereignis(i, s);
#endif
}

void LoopBoxen::kl_ereignis(int i, int64_t s) noexcept {
  const Box& b = b_[i];
  kl_[i].halten = false;  // 7c.4: ein Ereignis beendet den gehaltenen Ring (es friert vorher ein)
  if (!kl_an_ || !b.loop) {
    kl_leer(i, s);
  } else if (b.status == BoxStatus::wartet) {
    kl_ansetzen(i, s, true);
  } else if (b.status == BoxStatus::laeuft || b.status == BoxStatus::endet) {
    kl_ansetzen(i, s, false);
  } else {
    kl_leer(i, s);
  }
}

// Ansatz mit dem Band des geladenen Loops. Wechselte der Loop, nimmt das neue Band einen neuen Platz der Leihe und das alte
// wird mit der Nummer dieses Auftrags abgegeben (wie Deck::kl_anfordern). vorlauf: wartende Box, s_h kurz vor dem Einsatz
// (7a 3.5 Punkt 1), Start aus Stille nur, wenn der Ring dann bereit sein kann.
void LoopBoxen::kl_ansetzen(int i, int64_t s, bool vorlauf) noexcept {
  Kl& q = kl_[i];
  Box& b = b_[i];
  if (b.ring_vor) kl_vorlage_aus(i, s);  // Keylock 7c.2: Ereignis in der Vorlage (laden, raster in der wartenden Box)
  const DehnerAnker a = box_anker(*kl_k_, s, b.loop->beats, b.loop->frames, b.versatz);
  // Vorlauf (wartende Box, 7a 3.5 Punkt 1): s_h kurz vor dem Einsatz e; Start aus Stille, wenn der Ring dann bereit sein kann
  int64_t e = 0, s_h = 0, still_bis = INT64_MIN;
  bool still = false;
  if (vorlauf) {
    e = std::llround(kl_k_->sample_at(b.start_beat));
#ifdef CYPHERDJ_MUTATION_BOX_OHNE_VORLAUF
    s_h = s + ANSATZ_FRIST;  // Fehlerfall (7a Mutation): Ansatz wie bei jedem Ereignis, Ring zur Eins nicht bereit
#elif defined(CYPHERDJ_MUTATION_BOX_START_OHNE_VORLAGE)
    s_h = std::max<int64_t>(s + ANSATZ_FRIST, e - STRECK_EINSCHWING - DEHNER_BLOCK);  // Fehlerfall: Stand Task 7
#else
    s_h = std::max<int64_t>(s + ANSATZ_FRIST, e - STRECK_EINSCHWING - BOX_VORLAGE);
#endif
#ifndef CYPHERDJ_MUTATION_BOX_START_MIT_BRUECKE
#if defined(CYPHERDJ_MUTATION_BOX_START_OHNE_VORLAGE) || defined(CYPHERDJ_MUTATION_BOX_OHNE_VORLAUF) || \
    defined(CYPHERDJ_MUTATION_BOX_STILL_KURZE_VORLAGE)
    still = s_h + STRECK_EINSCHWING <= e;  // Stand vor Keylock 6a Fix-Runde 2 (auch mit verkürzter Vorlage; in diesen Fehlerfällen)
#else
    // Keylock 6a Fix-Runde 2 (Entscheid der Hauptinstanz 09.10., wie Deck::kl_plane_start): Start aus Stille nur mit voller Vorlage.
    // Mit verkürzter Vorlage (Vorlauf 5504 bis 6271) setzte der Ring nach dem Beginn des R3-Vorlaufs hart ein (80 BPM Klick 0,4889,
    // test_loopbox_keylock T20); darunter der frühe Ansatz ohne still (Einsatz im Varispeed, Brücke).
    still = s_h == e - STRECK_EINSCHWING - BOX_VORLAGE;
#endif
#endif
#ifndef CYPHERDJ_MUTATION_BOX_START_OHNE_VORLAGE
    // Keylock 7b.2: Quellframe des Einsatzes (kopf(e) im Dehner, ungewickelt); davor liefert das Band Stille
    if (still) still_bis = std::llround(a.f + (b.start_beat - a.b) * (double)LOOP_SPB);  // LOOP_SPB = Frames je Beat bei LOOP_BPM
#endif
  }
  BoxBand* alt = nullptr;
#ifdef CYPHERDJ_MUTATION_BOX_RASTER_NEUER_PLATZ
  if (q.band && (q.band->loop != b.loop || q.band->still_bis.load(std::memory_order_relaxed) != still_bis)) {  // Fehlerfall: Stand 7b
#else
  if (q.band && q.band->loop != b.loop) {  // anderer Loop: neuer Platz (der Dehner liest das alte Band)
#endif
    alt = q.band;
    q.band = nullptr;
  }
  if (!q.band) {
    q.band = q.leihe.nimm();
    if (!q.band) {  // alle Plätze verliehen: Varispeed für diesen Loop (nichts zu leihen)
      ++q.kein_platz;
      const uint32_t nr = q.les.leer(s);
      if (alt) q.leihe.abgeben(alt, nr);
      return;
    }
    q.band->loop = b.loop;
  }
  q.band->still_bis.store(still_bis, std::memory_order_relaxed);  // 7c.3: gleiches Band, auch wenn nur der Versatz wechselt
  uint32_t nr;
  if (vorlauf) {
    nr = q.les.ansetzen_ab(s, s_h, q.band, a);
    if (still) q.les.aus_stille();
  } else {
    nr = q.les.ansetzen(s, q.band, a);
  }
  if (alt) q.leihe.abgeben(alt, nr);
}

// Keylock 7c.2 (Nachprüfung 7b N1): ein Ereignis in der Vorlage [E − BOX_VORLAGE, E) schaltete den schon hörbaren Ring mit
// stumm() hart ab (60 BPM, Stopp bei E − 100: Sprung 0,4663). Jetzt friert der Leser ein, was klingt (ist es schon
// eingefroren, etwa vom Knopf, bleibt diese Blende), und block() spielt die Ausblende gegen Stille (vor_aus).
void LoopBoxen::kl_vorlage_aus(int i, int64_t s) noexcept {
  Kl& q = kl_[i];
  Box& b = b_[i];
  b.ring_vor = false;
#ifdef CYPHERDJ_MUTATION_BOX_VORLAGE_STUMM
  (void)s;
  q.les.stumm();  // Fehlerfall (Stand 7b): hart aus
#else
  if (q.les.blendet() || kl_einfrieren(i, s, false)) b.vor_aus = true;
  else q.les.stumm();  // weniger als STRECK_ALT_MIN Frames im Ring: nichts zum Ausblenden
#endif
}

void LoopBoxen::kl_leer(int i, int64_t s) noexcept {
  Kl& q = kl_[i];
  if (b_[i].ring_vor) kl_vorlage_aus(i, s);  // Keylock 7c.2: Stopp, Entladen oder Schalter in der Vorlage
  if (q.les.ist_leer() && !q.band) return;  // schon leer
  const uint32_t nr = q.les.leer(s);
  if (q.band) {
    q.leihe.abgeben(q.band, nr);
    q.band = nullptr;
  }
}

// Vertrag 8 (wie Deck::kl_einfrieren): ist der Ring am Hörbaren beteiligt, friert der Leser ein, was klingt, und blendet es
// gegen den Varispeed-Weg aus; den alten Varispeed-Weg (für eine laufende Blende Varispeed -> Ring) liefert vari_vorab.
// Gains: keine (die Hülle der Box wirkt danach auf die Summe). Vor der Änderung von Loop oder Versatz aufrufen.
bool LoopBoxen::kl_einfrieren(int i, int64_t s, bool leistung) noexcept {
  Kl& q = kl_[i];
  if (!kl_bereit(i) || !q.les.ring_beteiligt()) return false;
#ifdef CYPHERDJ_MUTATION_BOX_LADEN_LINEAR
  leistung = false;  // Fehlerfall (7a Mutation): Ladeblende linear statt gleich laut
#endif
#ifdef CYPHERDJ_MUTATION_BOX_EINFRIEREN_OHNE_VARI
  return q.les.einfrieren(s, 1.0f, 1.0f, nullptr, nullptr, 0, leistung);  // Fehlerfall: ohne den alten Varispeed-Weg
#else
  if (q.les.braucht_vari()) {
    float vl[STRECK_BLENDE], vr[STRECK_BLENDE];
    vari_vorab(i + 1, s, STRECK_BLENDE, vl, vr);
    return q.les.einfrieren(s, 1.0f, 1.0f, vl, vr, STRECK_BLENDE, leistung);
  }
  return q.les.einfrieren(s, 1.0f, 1.0f, nullptr, nullptr, 0, leistung);
#endif
}

void LoopBoxen::vari_vorab(int box, int64_t s, int n, float* l, float* r) const noexcept {
  std::fill(l, l + n, 0.0f);
  std::fill(r, r + n, 0.0f);
  if (!gueltig(box) || !kl_k_ || n <= 0) return;
  const Box& b = b_[box - 1];
  if (!b.loop || !(b.status == BoxStatus::laeuft || b.status == BoxStatus::endet)) return;
  const Karte& k = *kl_k_;
  const int64_t e = s + n - 1;
  const bool tempo_ok = std::fabs(k.bpm_at((double)s) - LOOP_BPM) < 1e-6 && k.k_at((double)s) == 0.0 &&
                        std::fabs(k.bpm_at((double)e) - LOOP_BPM) < 1e-6 && k.k_at((double)e) == 0.0;
  spiele_pfad(b, b.loop, tempo_ok, b.versatz, k, s, s + n, s, l, r);
}

BoxStatus LoopBoxen::status(int box) const { return gueltig(box) ? b_[box - 1].status : BoxStatus::leer; }

void LoopBoxen::spiele(const Box& b, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l, float* r) {
  const Loop& lp = *b.loop;
#ifdef CYPHERDJ_MUTATION_LOOP_AB_START
  int64_t pos = (von - b.start_sample) % lp.frames;  // Fehlerfall der Abnahme: Position ab dem Einsatz, nicht aus dem Beat
  (void)k;
#else
  const double lang = (double)lp.beats;
  double ph = std::fmod(k.beat_at((double)von), lang);
  if (ph < 0) ph += lang;
#ifdef CYPHERDJ_MUTATION_LOOP_SPB
  int64_t pos = std::llround(ph * (double)(LOOP_SPB + 1)) % lp.frames;  // Fehlerfall am Ziel: falsches Raster
#else
  int64_t pos = std::llround(ph * (double)LOOP_SPB) % lp.frames;
#endif
#endif
#ifndef CYPHERDJ_MUTATION_LOOP_OHNE_VERSATZ
  pos = ((pos + b.versatz) % lp.frames + lp.frames) % lp.frames;  // Plan Grid: Drehung um den Raster-Versatz
#endif
  const float* d = lp.daten.data();
  for (int64_t t = von; t < bis; ++t) {
    l[t - n0] = d[2 * pos];
    r[t - n0] = d[2 * pos + 1];
    if (++pos == lp.frames) pos = 0;
  }
}

// Plan Tempo-Folge (2026-09-30): weicht die Karte von 128 BPM ab, läuft der Lesekopf mit bpm/128 durch den Loop
// (Varispeed, ohne Tonhöhenerhalt; Keylock kommt mit dem Stretcher). Die Position kommt an beiden Rändern des
// Abschnitts aus dem Beat, dazwischen linear: so bleibt die Box phasenstarr und an den Blockgrenzen stetig, auch in
// einer Rampe. Gelesen wird mit Catmull-Rom über vier Frames, mit Umlauf am Loop-Ende. Keine Allokation.
void LoopBoxen::spiele_frei(const Loop& lp, double versatz, const Karte& k, int64_t von, int64_t bis, int64_t n0, float* l,
                            float* r) {
  const int64_t F = lp.frames;
  const double fr = (double)F;
#ifdef CYPHERDJ_MUTATION_LOOP_TEMPO_STARR
  double pos = std::fmod((double)von, fr);  // Fehlerfall der Abnahme: Position aus den Samples, das Tempo zählt nicht
  const double schritt = 1.0;
  (void)k;
#else
  const double lang = (double)lp.beats;
  const double spb = fr / lang;  // Frames je Beat dieses Loops (22500)
  const double b_von = k.beat_at((double)von);
  double ph = std::fmod(b_von, lang);
  if (ph < 0) ph += lang;
  double pos = ph * spb;
  const double schritt = (k.beat_at((double)bis) - b_von) * spb / (double)(bis - von);
#endif
  pos = std::fmod(pos + versatz, fr);
  if (pos < 0) pos += fr;
  const float* d = lp.daten.data();
  for (int64_t t = von; t < bis; ++t) {
    const int64_t i1 = std::min((int64_t)pos, F - 1);
    const float x = (float)(pos - (double)i1);
    const int64_t i0 = i1 == 0 ? F - 1 : i1 - 1;
    const int64_t i2 = i1 + 1 == F ? 0 : i1 + 1;
    const int64_t i3 = i2 + 1 == F ? 0 : i2 + 1;
    for (int c = 0; c < 2; ++c) {
      const float y0 = d[2 * i0 + c], y1 = d[2 * i1 + c], y2 = d[2 * i2 + c], y3 = d[2 * i3 + c];
      const float ka = 0.5f * (-y0 + 3.0f * y1 - 3.0f * y2 + y3);
      const float kb = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
      const float kc = 0.5f * (y2 - y0);
      (c ? r : l)[t - n0] = ((ka * x + kb) * x + kc) * x + y1;
    }
    pos += schritt;
    if (pos >= fr) pos -= fr;
  }
}

// Einen Lesepfad in l/r schreiben: der geladene Loop (direkt bei 128 BPM ohne Rampe, sonst Varispeed) oder (F13) ein
// abgelöster, der ausblendet (gebrochener Schritt, Versatz auf sein Raster umgerechnet).
void LoopBoxen::spiele_pfad(const Box& b, const Loop* q, bool direkt, int64_t versatz, const Karte& k, int64_t von,
                            int64_t bis, int64_t n0, float* l, float* r) {
  if (q == b.loop) {
    if (direkt) spiele(b, k, von, bis, n0, l, r);
    else spiele_frei(*q, (double)versatz, k, von, bis, n0, l, r);
    return;
  }
  // (F13) ein abgelöster Loop, der ausblendet: gebrochener Schritt, Versatz auf sein Raster umgerechnet
  const double spb2 = (double)q->frames / (double)q->beats;
  spiele_frei(*q, (double)versatz * spb2 / (double)LOOP_SPB, k, von, bis, n0, l, r);
}

int LoopBoxen::block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r,
                     BoxMeldung* meldungen, int max, Mitschnitt** fertig) {
  int nm = 0;
  auto melde = [&](int box, BoxStatus s, int64_t smp) {
    if (nm < max) meldungen[nm++] = BoxMeldung{box, s, smp};
  };
  const int64_t ende = n0 + n;
  // Direktweg (bitgenau) nur, wenn der ganze Block bei 128 BPM ohne Rampe liegt; sonst Varispeed (Plan Tempo-Folge).
  const bool tempo_ok = std::fabs(k.bpm_at((double)n0) - LOOP_BPM) < 1e-6 && k.k_at((double)n0) == 0.0 &&
                        std::fabs(k.bpm_at((double)(ende - 1)) - LOOP_BPM) < 1e-6 && k.k_at((double)(ende - 1)) == 0.0;
#ifdef CYPHERDJ_MUTATION_BOX_KARTE_FREMD
  const bool karte_ok = true;  // Fehlerfall (7a Mutation): eine fremde Karte wird nicht bemerkt
#else
  const bool karte_ok = &k == kl_k_;
#endif
  bool kl_irgendwo = false;
  for (int i = 0; i < LOOP_BOXEN; ++i) kl_irgendwo = kl_irgendwo || kl_bereit(i);
  if (kl_irgendwo && !karte_ok) ++kl_fremd_;  // Task 7 (T11): Keylock für diesen Block aus
  for (int i = 0; i < LOOP_BOXEN; ++i) {
    Box& b = b_[i];
    const int box = i + 1;
    float* l = ein_l[LOOP_KANAL0 + i];
    float* r = ein_r[LOOP_KANAL0 + i];
    schwanz_mischen(b, n, l, r);  // F15: Ausklang nach /k/set/neu (ausklingen), auch wenn die Box schon steht
    // Task 7 (7a 3.4): Keylock am Blockanfang, auch für stehende Boxen (der Ring wird in jedem Block verbraucht, Vertrag 1):
    // offener Ansatz, Leihe, dann der Leser (Antwort, Stand, Ring); droht ein Unterlauf, friert ein, was klingt.
    const bool kl = kl_bereit(i);
    if (kl) {
      Kl& q = kl_[i];
      if (q.offen) {
        q.offen = false;
        kl_ereignis(i, n0);
      }
      q.leihe.pflege(q.post->antwort(), q.d->quittiert_e());
      q.les.basis(tempo_ok && karte_ok);  // 7c.4 (b): auf der Basis blendet das Einfrieren gleich laut
      if (q.les.block_anfang(n0, n)) {
        kl_einfrieren(i, n0, false);
        q.les.unterlauf(n0);
      }
    }
    const bool spielt = b.status == BoxStatus::wartet || b.status == BoxStatus::laeuft || b.status == BoxStatus::endet;
    if (b.wartend && !spielt) {  // F13: die Box steht inzwischen: sofort, ohne Blende
      uebernehmen(b, false);
      melde(box, b.status, n0);  // Prüfung 2.3 Befund 3: /e/loop nennt den neuen Loop auch nach stiller Übernahme
    }
    // Keylock 7c.2: der eingefrorene Ring der Vorlage blendet gegen Stille aus, für sich, neben dem Pfad der Box (setzt sie
    // derweil ein, kommt ihr Pfad mit der gewohnten Kante, der Leser mischt erst nach dem Ende dieser Blende wieder mit)
    int64_t vor_bis = n0;
    if (kl && b.vor_aus) {
      for (int64_t t = n0; t < ende && kl_[i].les.blendet(); ++t, ++vor_bis) {
        float a = 0.0f, c = 0.0f;
        kl_[i].les.mische((int)(t - n0), t, false, 1.0f, false, 1.0f, false, a, c);
        l[t - n0] += a;
        r[t - n0] += c;
      }
      if (!kl_[i].les.blendet()) b.vor_aus = false;
    }
    if (!b.loop || !spielt) {
      if (b.pfad || b.blende_alt) pfad_verwerfen(b);  // Keylock: eine stehende Box hat keinen Pfad mehr
      continue;
    }
    int64_t von = n0, bis = ende;
    bool eingesetzt = false;
    if (b.status == BoxStatus::wartet) {
      int64_t s = std::llround(k.sample_at(b.start_beat));
      if (s < n0) {  // Einsatz liegt hinter uns (verschobene Karte): nicht sofort, sondern auf der nächsten Takt-Eins
        b.start_beat = naechste_eins(k.beat_at((double)n0));
        s = std::llround(k.sample_at(b.start_beat));
      }
#ifndef CYPHERDJ_MUTATION_BOX_START_OHNE_VORLAGE
      // Keylock 7b.2: Start aus Stille mit bereitem Ring: die Box hört ihn schon ab s − BOX_VORLAGE (das Band liefert vor dem
      // Einsatz Stille, der Leser bleibt vor s_h + STRECK_EINSCHWING still). Außerhalb der Basis wie will unten.
      if (kl && kl_an_ && karte_ok && !tempo_ok && !b.vor_aus && s - BOX_VORLAGE < ende &&
          (b.ring_vor || kl_[i].les.still_bereit())) {
        Kl& q = kl_[i];
        const int64_t v0 = std::max<int64_t>(n0, s - BOX_VORLAGE), v1 = std::min<int64_t>(ende, s);
        for (int64_t t = v0; t < v1; ++t) {
          float a = 0.0f, c = 0.0f;
          q.les.mische((int)(t - n0), t, true, 1.0f, false, 1.0f, false, a, c);
          l[t - n0] += a;
          r[t - n0] += c;
        }
        b.ring_vor = q.les.ring_hoerbar();
      }
#endif
      if (s >= ende) continue;
      von = std::max(n0, s);
      b.status = BoxStatus::laeuft;
      b.start_sample = von;
      eingesetzt = true;
      melde(box, b.status, von);
    }
    bool zu_ende = false;
    int64_t s_stopp = 0;
    if (b.status == BoxStatus::endet) {
      s_stopp = std::llround(k.sample_at(b.stopp_beat));
      // F15: die Stopp-Rampe beginnt LOOPBOX_AUS Samples vor dem Stoppsample; kam der Stopp später, ab hier (kürzer).
      // Je Block neu, solange sie nicht läuft (eine Tempo-Rampe verschiebt das Stoppsample).
      if (!b.aus_laeuft) {
        b.aus_ab = std::max(s_stopp - LOOPBOX_AUS, n0);
#ifndef CYPHERDJ_MUTATION_LOOP_OHNE_HUELLE
        // Prüfung 2.3 Befund 5: mindestens LOOPBOX_AUS_MIN Samples Rampe; bleibt bis zur Eins weniger (bis 0 bei einer
        // Eins auf dem Blockanfang), endet die Box kurz nach der Eins statt mit einem Sprung auf ihr.
        b.aus_ende = std::max(s_stopp, b.aus_ab + LOOPBOX_AUS_MIN);
#else
        b.aus_ende = s_stopp;
#endif
      }
      s_stopp = b.aus_ende;  // ab hier: Ende der Ausblende (Stoppsample oder kurz danach)
      if (s_stopp < ende) {
        bis = std::max(von, s_stopp);
        zu_ende = true;
      }
    }
    if (b.wartend && !b.blende_alt) {
      // F13: der wartende Loop übernimmt im nächsten Block (Task 7: kein Warten auf eine Variante mehr). Klingt der Ring,
      // friert der Leser ihn ein und blendet gleich laut in den neuen Loop (die Box blendet dann nicht selbst); danach
      // Ansatz mit dem neuen Band (Brücke bis s_h + 1408 + 960, 7a 3.4).
      const bool eingefroren = kl && kl_einfrieren(i, n0, true);
      uebernehmen(b, !eingefroren);
      if (kl) kl_ereignis(i, n0);
      melde(box, b.status, n0);  // /e/loop nennt jetzt den neuen Loop
    }
    std::fill(tmp_l_, tmp_l_ + n, 0.0f);
    std::fill(tmp_r_, tmp_r_ + n, 0.0f);
    if (bis > von) {
      if (!b.pfad) b.pfad = b.loop;  // erster Block nach dem Einsatz oder nach einer Übernahme
      spiele_pfad(b, b.pfad, tempo_ok, b.versatz, k, von, bis, n0, tmp_l_, tmp_r_);
      if (b.blende_alt) {
        spiele_pfad(b, b.blende_alt, tempo_ok, b.blende_versatz, k, von, bis, n0, alt_l_, alt_r_);
        for (int64_t t = von; t < bis; ++t) {
          const int64_t kk = (int64_t)b.blende_pos + (t - von);
          if (kk >= LOOPBOX_LADEN_BLENDE) break;  // ab hier reiner neuer Pfad
          const float u = (float)kk / (float)LOOPBOX_LADEN_BLENDE;
          float ga = 1.0f - u, gn = u;
          if (b.blende_leistung) gleich_laut(u, ga, gn);  // F13: zwei verschiedene Loops: gleich laut (F81)
          tmp_l_[t - n0] = alt_l_[t - n0] * ga + tmp_l_[t - n0] * gn;
          tmp_r_[t - n0] = alt_r_[t - n0] * ga + tmp_r_[t - n0] * gn;
        }
        b.blende_pos += (int)(bis - von);
        if (b.blende_pos >= LOOPBOX_LADEN_BLENDE) {
          const Loop* fertig = b.blende_alt;
          b.blende_alt = nullptr;
          b.blende_pos = 0;
          b.blende_leistung = false;
          gib_frei(b, fertig);
        }
      }
      if (kl) {  // Task 7 (7a 3.4): der Leser mischt den Ring über den eigenen Weg der Box, vor der Hülle (F15 wirkt auf die Summe)
#ifdef CYPHERDJ_MUTATION_BOX_BASIS_RING_HOERBAR
        const bool will = kl_an_ && karte_ok;  // Fehlerfall (7a Mutation): auch bei 128 BPM klingt der Ring
#else
        // Keylock 7b.1: auf der Basis bleibt ein klingender Ring hörbar bis zum nächsten Ereignis (streck_quelle.h basis_halten)
        const bool will = karte_ok && (kl_an_ ? (!tempo_ok || kl_[i].les.basis_halten())
                                              : (kl_[i].halten && tempo_ok && kl_[i].les.basis_halten()));  // 7c.4 (a)
#endif
        Kl& q = kl_[i];
        if (eingesetzt && !will) q.les.aus_stille(false);  // setzt hörbar ohne Ring ein: ein späterer Ring braucht die Blende
#ifndef CYPHERDJ_MUTATION_BOX_STILL_NACH_UMZIEL
        // Keylock 7c.1 (Nachprüfung 7b Q1): rückt der Einsatz vor s_h + STRECK_EINSCHWING (Rampe in der Wartezeit), setzt die
        // Box im Varispeed ein; der Ring kommt danach über die Brücke, nicht als Start aus Stille (der spränge ohne Blende).
        if (eingesetzt && will && !q.les.ring_hoerbar() && q.les.s_h() + STRECK_EINSCHWING > von) q.les.aus_stille(false);
#endif
        for (int64_t t = std::max(von, vor_bis); t < bis && !b.vor_aus; ++t)  // 7c.2: nicht in der Ausblende der Vorlage
          q.les.mische((int)(t - n0), t, will, 1.0f, false, 1.0f, false, tmp_l_[t - n0], tmp_r_[t - n0]);
        if (q.halten && !q.les.ring_beteiligt()) {  // 7c.4 (a): der gehaltene Ring ist aus (Tempo verlässt die Basis)
          q.halten = false;
          kl_leer(i, bis);
        }
      }
#ifndef CYPHERDJ_MUTATION_LOOP_OHNE_HUELLE
      // F15 (Audit 2026-10-01): Hülle der Box. Einsatz nur mit Kante (erster Wert über LOOPBOX_KANTE), sonst bleibt sie
      // offen (bitgleich). Stopp: ab aus_ab auf genau 0 am Stoppsample. Ruhend keine Rechnung.
      if (eingesetzt) {
        const float x0 = std::max(std::fabs(tmp_l_[von - n0]), std::fabs(tmp_r_[von - n0]));
        b.huelle = Blende();
        // Keylock 7b.2: klingt der Ring schon vor dem Einsatz, kommt der Einsatz aus Stille (Band) und braucht keine Kante
        const bool aus_ring = b.ring_vor && kl && kl_[i].les.ring_hoerbar();
        b.ring_vor = false;
        if (x0 > LOOPBOX_KANTE && !aus_ring) {
          b.huelle = Blende(0.0f);
          b.huelle.ziel(1.0f, LOOPBOX_EIN);
        }
      }
      if (!b.huelle.offen() || b.status == BoxStatus::endet) {
        for (int64_t t = von; t < bis; ++t) {
          if (b.status == BoxStatus::endet && !b.aus_laeuft && t >= b.aus_ab) {
            b.huelle.ziel(0.0f, (int)std::max<int64_t>(s_stopp - t, 1));
            b.aus_laeuft = true;
          }
          if (b.huelle.offen()) continue;
          const float g = b.huelle.schritt();
          tmp_l_[t - n0] *= g;
          tmp_r_[t - n0] *= g;
        }
      }
#endif
    }
    for (int t = 0; t < n; ++t) {
      l[t] += tmp_l_[t];
      r[t] += tmp_r_[t];
    }
    if (zu_ende) {
      if (kl) {  // Task 7: die Box steht, der Ring ist mit ihr aus; Leer-Epoche ab dem Stoppsample
        kl_[i].les.stumm();
        kl_leer(i, bis);
      }
      pfad_verwerfen(b);
      b.huelle = Blende();
      b.aus_ab = -1;
      b.aus_ende = -1;
      b.aus_laeuft = false;
      b.status = BoxStatus::bereit;
      melde(box, b.status, bis);
    }
  }
  if (mitschnitt_ != nullptr) {  // MVP 2 Scheibe 2: erz/1 (Kanal MITSCHNITT_KANAL) vor Trim, ab ab_sample kopieren
    Mitschnitt& mt = *mitschnitt_;
    const int64_t ab = mt.ab_sample;
    // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 2) und Plan Tempo-Folge: das Tempo der Aufnahme muss fest bleiben.
    // Vor dem Einsatz dieselbe Karte (ab_beat am selben Sample), bis zum Ende dasselbe Tempo ohne Rampe; sonst wäre
    // die Datei versetzt oder verzerrt und gälte trotzdem als fertig.
    // Geprüft wird nur der Teil des Blocks, der in die Aufnahme fällt (Code-Review F1: eine Rampe, die auf dem End-Beat
    // beginnt, liegt im selben Block hinter dem letzten kopierten Sample und darf den fertigen Mitschnitt nicht kippen).
    const int64_t p0 = std::max(n0, ab), p1 = std::min(ende, ab + mt.roh_frames) - 1;
    const bool tempo_fest = p1 < p0 || (k.k_at((double)p0) == 0.0 && std::fabs(k.bpm_at((double)p0) - mt.bpm) < 1e-9 &&
                                        k.k_at((double)p1) == 0.0 && std::fabs(k.bpm_at((double)p1) - mt.bpm) < 1e-9);
    if (!tempo_fest || (mt.gefuellt == 0 && std::llround(k.sample_at(mt.ab_beat)) != ab)) {
      mt.abgebrochen = true;
      if (fertig) *fertig = mitschnitt_;
      mitschnitt_ = nullptr;
      return nm;
    }
    if (ab < ende) {
#ifdef CYPHERDJ_MUTATION_MITSCHNITT_BLOCKANFANG
      const int64_t von = n0;  // Fehlerfall der Abnahme: Einsatz am Blockanfang statt ab ab_sample
#else
      const int64_t von = std::max(n0, ab);
#endif
      // bis nie über das Ende des Puffers hinaus: von + Rest ist die Grenze des Wächters bei einem Fehlerfall wie der
      // Mutation oben (von zu früh würde sonst mehr als roh_frames − gefuellt Samples schreiben, ein Speicherüberlauf).
      const int64_t bis = std::min({ende, ab + mt.roh_frames, von + (mt.roh_frames - mt.gefuellt)});
      if (bis > von) {
        const float* el = ein_l[MITSCHNITT_KANAL];
        const float* er = ein_r[MITSCHNITT_KANAL];
        for (int64_t t = von; t < bis; ++t) {
          const int64_t p = mt.gefuellt + (t - von);
          mt.daten[(size_t)(2 * p)] = el[t - n0];
          mt.daten[(size_t)(2 * p + 1)] = er[t - n0];
        }
        mt.gefuellt += bis - von;
      }
      if (mt.gefuellt >= mt.roh_frames) {
        if (fertig) *fertig = mitschnitt_;
        mitschnitt_ = nullptr;
      }
    }
  }
  return nm;
}

}  // namespace cdj
