// Stellwerk-RT: ein Zyklus. Startsamples wartender Teile mit der Tempo-Karte von jetzt, Prüfungen am Start,
// Prüfer je Zyklus, dann Strecke für Strecke zwischen Ereignissen (Start, Hand, Rückgabe): laufende Teile schreiben
// ihren Verlauf je Sample. Ruhige Zyklen ohne Rechnung.
#include <algorithm>
#include <cstring>

#include "formel.h"
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

// §4.3: Start am Ziel-Sample. w0 ist der Ist-Wert; ein Setzen desselben Reglers am selben Sample übergibt seinen Zielwert.
void Stellwerk::starte(int idx, int64_t sample, int i, double beat) {
  Teil& t = teil_[idx];
  ReglerZustand& z = reg_[t.regler];
  if (z.hr_an) {   // F18: ein Teil übernimmt vom Ist-Wert, die Hand-Schaltrampe endet hier
    z.hr_an = false;
    n_hand_rampen_--;
  }
  float w0 = z.wert;
  if (z.laufend >= 0) {   // Vorgänger am selben Regler (Setzen am selben Sample oder angrenzende Rampe): fertig
    Teil& v = teil_[z.laufend];
    if (v.setzen_modus && v.sA == sample) w0 = v.nach;           // Zielwert des Setzens (§4.3)
    else if (!v.angehalten) w0 = wert_von(v, sample, beat, nullptr);   // Ist-Wert am Ziel-Sample
    const int vi = z.laufend;
    setze_wert(t.regler, i, w0);
    // Übergabe am selben Sample: der Vorgänger ist fertig, der Halter geht ohne Umweg über frei an den neuen Teil
    quittung(v, Status::fertig, sample, Grund::kein);
    laufend_raus(vi);
    v.belegt = false;
  }
  start_parameter(t, w0, beat, sample);
  t.status = Status::gestartet;
  t.im_zyklus = false;
  laufend_rein(idx);
  setze_wert(t.regler, i, wert_von(t, sample, beat, nullptr));   // Wert am Start-Sample (Stumm-Regel: -60), für §5.7
  if (t.verspaetet) quittung(t, Status::verspaetet_ausgefuehrt, sample, Grund::kein);   // §16.1 Politik 1, Grund "" (Lesart i)
  else quittung(t, Status::gestartet, sample, Grund::kein);
  if (!setze_halter(t.regler, halter_fuer(t), sample)) melde_regler(t.regler, sample);   // §5.7: immer bei Teilstart
}

// Schreibt den Verlauf eines laufenden Teils über [i, j) und hält den Ist-Wert nach. Endet der Teil darin, bricht die
// Strecke an seinem letzten Sample ab (Rückgabe: dessen Index), sonst -1.
int Stellwerk::rechne_strecke(int idx, int i, int j) {
  const Teil& t = teil_[idx];
  const int r = t.regler;
  const int slot = slot_fuer(r, i);
  float* vl = nullptr;
  if (slot >= 0) {
    vl = verlauf_[slot];
    const float alt = verlauf_bis_[slot] > 0 ? vl[verlauf_bis_[slot] - 1] : reg_[r].wert;
    for (int k = verlauf_bis_[slot]; k < i; k++) vl[k] = alt;
  }
  const float end_wert = (tab_.def(r).db && t.nach <= STUMM_GRENZE) ? STUMM : t.nach;
  const bool s_kurve = t.setzen_modus || t.form == 1;   // Schaltrampe immer S-Kurve (Festlegung F2), Rampe nach Form
  float v = reg_[r].wert;
  bool fertig = false;
  int k = i;
  if (t.setzen_modus) {
    for (; k < j; k++) {
      const double u = formel::anteil_setzen(zyklus_s0_ + k, t.sA, t.schalt, &fertig);
      v = formel::wert(u, fertig, s_kurve, t.wA, t.ziel_intern, end_wert);
      if (vl) vl[k] = v;
      if (fertig) break;
    }
  } else {
    for (; k < j; k++) {
      const double u = formel::anteil_rampe(beats_[k], t.bA, t.ende_beat, &fertig);
      v = formel::wert(u, fertig, s_kurve, t.wA, t.ziel_intern, end_wert);
      if (vl) vl[k] = v;
      if (fertig) break;
    }
  }
  reg_[r].wert = v;
  if (slot >= 0) verlauf_bis_[slot] = fertig ? k + 1 : j;
  return fertig ? k : -1;
}

void Stellwerk::prozess(int64_t s0, int n) {
  if (n <= 0) return;
  if (n > BLOCK_MAX) n = BLOCK_MAX;
  if (s0 != jetzt_) z_.spruenge++;
  zyklus_s0_ = s0;
  zyklus_n_ = n;
  for (int k = 0; k < n_aend_; k++) reg_[aend_[k].regler].slot = -1;
  n_aend_ = 0;
  for (int i = 0; i <= n; i++) beats_[i] = uhr_.beat(s0 + i);
  const int64_t s_ende = s0 + n;

  // 1. Startsamples wartender Teile nach der Tempo-Karte, die jetzt gilt (Plan in Beats, §4.3)
  n_starts_ = 0;
  for (int j = 0; j < MAX_TEILE; j++) {
    Teil& t = teil_[j];
    if (!t.belegt || t.status != Status::angenommen) continue;
    t.im_zyklus = false;
    t.start_sample = t.verspaetet ? s0 : std::max(s0, sample_von(uhr_, t.ab_beat));
    if (t.start_sample < s_ende) starts_[n_starts_++] = static_cast<int16_t>(j);
  }
  std::sort(starts_, starts_ + n_starts_, [&](int16_t a, int16_t b) {
    const Teil& x = teil_[a];
    const Teil& y = teil_[b];
    if (x.start_sample != y.start_sample) return x.start_sample < y.start_sample;
    if (x.plan_seq != y.plan_seq) return x.plan_seq < y.plan_seq;
    if (x.nr != y.nr) return x.nr < y.nr;
    return x.seq < y.seq;
  });

  int n_hand_zyklus = 0;
  while (n_hand_zyklus < n_hand_ && hand_[n_hand_zyklus].sample < s_ende) n_hand_zyklus++;

  // 2. Prüfungen am Start (§4.3), am Anfang des Zyklus. Erst alle Kandidaten vormerken, damit der Prüfer den Zustand
  //    nach allen Teilen eines Samples sieht (§17 „Reihenfolge“), dann in Startfolge: Halter am Start-Sample, dann
  //    Prüfer (Scheibe 20: I1 bis I3). Ein abgelehnter Teil fällt mit seiner Gruppe aus der Vormerkung.
  for (int k = 0; k < n_starts_; k++) teil_[starts_[k]].im_zyklus = true;
  for (int k = 0; k < n_starts_; k++) {
    const int idx = starts_[k];
    Teil& t = teil_[idx];
    if (!t.belegt || t.status != Status::angenommen) continue;
    Grund g = Grund::kein;
    if (mensch_bei(t.regler, t.start_sample, n_hand_zyklus)) g = Grund::regler_beim_menschen;
    else if (!t.intern) g = pruefe_vor_start(idx);
    if (g != Grund::kein) {
      t.im_zyklus = false;
      eingriff_sample_ = s0;
      beenden_mit_gruppe(idx, Status::abgelehnt, g, t.start_sample, HalterArt::frei);
    }
  }

  // 3. Prüfer je Zyklus
  eingriff_sample_ = s0;
  pruefe_je_zyklus();

  // 4. Rückgabe an frei nach 32 Beats ohne Hand (§7.3 Punkt 4): Samples in diesem Zyklus
  struct Rueck {
    int16_t r;
    int64_t s;
  };
  Rueck rueck[MAX_REGLER];
  int n_rueck = 0;
  if (n_mensch_ > 0) {
    for (int r = 0; r < tab_.anzahl(); r++) {
      if (reg_[r].halter.art != HalterArt::mensch) continue;
      const int64_t rs = sample_von(uhr_, reg_[r].hand_beat + RUECKGABE_BEATS);
      if (rs < s_ende) rueck[n_rueck++] = Rueck{static_cast<int16_t>(r), std::max(rs, s0)};
    }
    std::sort(rueck, rueck + n_rueck, [](const Rueck& a, const Rueck& b) { return a.s < b.s; });
  }
  bool starts_ok = false;
  for (int k = 0; k < n_starts_; k++) starts_ok = starts_ok || (teil_[starts_[k]].belegt && teil_[starts_[k]].im_zyklus);
  const bool ruhig = n_laufende_ == 0 && !starts_ok && n_hand_zyklus == 0 && n_rueck == 0 && n_direkt_ == 0 &&
                     n_hand_rampen_ == 0;

  if (ruhig) {
    z_.zyklen_ruhig++;
  } else {
    z_.zyklen_voll++;
    if (n_direkt_ > 0) {
      for (int r = 0; r < tab_.anzahl(); r++) {
        if (!reg_[r].direkt) continue;
        reg_[r].direkt = false;
        setze_wert(r, 0, reg_[r].wert);
      }
      n_direkt_ = 0;
    }
    int ks = 0, kh = 0, kr = 0;
    int i = 0;
    while (i < n) {
      const int64_t s = s0 + i;
      const double b = beats_[i];
      // a) Hand an diesem Sample, vor den Starts: die Hand gewinnt am selben Sample (ADR 023 Punkt 2); ein Teil, den
      //    sie hier abbricht, startet nicht mehr. MIDI ist nie zu spät: Vergangenes wirkt am Zyklusanfang.
      while (kh < n_hand_zyklus && hand_[kh].sample <= s) {
        hand_anwenden(hand_[kh], s, i, b);
        kh++;
      }
      // b) Starts an diesem Sample, in Startfolge
      while (ks < n_starts_ && teil_[starts_[ks]].start_sample <= s) {
        const int idx = starts_[ks++];
        Teil& t = teil_[idx];
        if (t.belegt && t.status == Status::angenommen && t.im_zyklus) starte(idx, s, i, b);
      }
      // c) Rückgabe
      while (kr < n_rueck && rueck[kr].s <= s) {
        const int r = rueck[kr++].r;
        if (reg_[r].halter.art == HalterArt::mensch && sample_von(uhr_, reg_[r].hand_beat + RUECKGABE_BEATS) <= s) {
          Halter h;
          setze_halter(r, h, s);
        }
      }
      // d) Strecke bis zum nächsten Ereignis
      int64_t naechstes = s_ende;
      if (ks < n_starts_) naechstes = std::min(naechstes, teil_[starts_[ks]].start_sample);
      if (kh < n_hand_zyklus) naechstes = std::min(naechstes, hand_[kh].sample);
      if (kr < n_rueck) naechstes = std::min(naechstes, rueck[kr].s);
      const int j = static_cast<int>(std::max<int64_t>(naechstes - s0, i + 1));
      for (int q = 0; q < n_laufende_;) {
        const int idx = laufende_[q];
        if (teil_[idx].angehalten) {
          q++;
          continue;
        }
        const int e = rechne_strecke(idx, i, j);
        if (e >= 0) beenden(idx, Status::fertig, Grund::kein, s0 + e, HalterArt::frei);   // nimmt idx aus laufende_
        else q++;
      }
      if (n_hand_rampen_ > 0)   // F18: Schaltrampen der Hand (hand.cpp)
        for (int r = 0; r < tab_.anzahl(); r++)
          if (reg_[r].hr_an) rechne_hand_rampe(r, i, j);
      i = j;
    }
    // Hand-Warteschlange nachrücken
    if (n_hand_zyklus > 0) {
      std::memmove(hand_, hand_ + n_hand_zyklus, sizeof(Griff) * (n_hand_ - n_hand_zyklus));
      n_hand_ -= n_hand_zyklus;
    }
    // Verläufe bis zum Zyklusende auffüllen
    for (int k = 0; k < n_aend_; k++) {
      float* vl = verlauf_[k];
      const float letzt = verlauf_bis_[k] > 0 ? vl[verlauf_bis_[k] - 1] : reg_[aend_[k].regler].wert;
      for (int m = verlauf_bis_[k]; m < n; m++) vl[m] = letzt;
      verlauf_bis_[k] = n;
    }
  }
  melder_zyklusende(s_ende - 1);
  jetzt_ = s_ende;
}

// F18: Hand-Schaltrampe über [i, j), wie der Setzen-Zweig von rechne_strecke (S-Kurve, am Ende genau das Ziel).
void Stellwerk::rechne_hand_rampe(int r, int i, int j) {
  ReglerZustand& z = reg_[r];
  const int slot = slot_fuer(r, i);
  float* vl = nullptr;
  if (slot >= 0) {
    vl = verlauf_[slot];
    const float alt = verlauf_bis_[slot] > 0 ? vl[verlauf_bis_[slot] - 1] : z.wert;
    for (int k = verlauf_bis_[slot]; k < i; k++) vl[k] = alt;
  }
  bool fertig = false;
  float v = z.wert;
  int k = i;
  for (; k < j; k++) {
    const double u = formel::anteil_setzen(zyklus_s0_ + k, z.hr_sA, z.hr_schalt, &fertig);
    v = formel::wert(u, fertig, true, z.hr_von, z.hr_ziel, z.hr_ziel);
    if (vl) vl[k] = v;
    if (fertig) break;
  }
  z.wert = v;
  if (slot >= 0) verlauf_bis_[slot] = fertig ? k + 1 : j;
  if (fertig) {
    z.hr_an = false;
    n_hand_rampen_--;
  }
}

}  // namespace cypherdj::stellwerk
