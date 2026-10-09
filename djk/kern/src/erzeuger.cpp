#include "cypherdj/erzeuger.h"

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstring>

namespace cdj {

const Kit* Erzeuger::setze_strom(int strom, const Kit* kit, int kanal) {
  if (strom < 1 || strom > ERZ_STROEME) return kit;
  Strom& s = st_[strom - 1];
  const Kit* alt = s.kit;
  if (alt && alt != kit)
    for (Stimme& v : sti_)
      if (v.klang >= &alt->klang[0] && v.klang < &alt->klang[0] + KIT_KLAENGE) {
#ifdef CYPHERDJ_MUTATION_KIT_TAUSCH_HART
        v.klang = nullptr;  // Fehlerfall der Abnahme: Stimmen des alten Kits enden hart
#else
        ausklingen(v);  // F11 (Glanz 2.4.1): Kopie, das alte Kit darf sofort zur Freigabe
#endif
      }
  s.kit = kit;
  s.kanal = (kanal >= 0 && kanal < MIX_KANAELE) ? kanal : -1;
  return alt == kit ? nullptr : alt;
}

void Erzeuger::setze_midi(int strom, int port, int midi_kanal) {
  if (strom < 1 || strom > ERZ_STROEME) return;
  Strom& s = st_[strom - 1];
  for (int i = 0; i < s.n_offen; ++i) s.offen[i].aus = INT64_MIN;  // sofort aus, auf ihrem alten Port/Kanal
  s.midi_port = (port >= 1 && port <= ERZ_MIDI_PORTS) ? port : 0;
  s.midi_kanal = std::clamp(midi_kanal, 1, 16);
}

void Erzeuger::noten_aus(Strom& s, int64_t bis, MidiAus* midi, int64_t n0, int64_t zyklus_n0) {
  int w = 0;
  for (int i = 0; i < s.n_offen; ++i) {
    const Strom::Offen& o = s.offen[i];
    if (o.aus < bis) {
      midi[o.port - 1].schreibe(std::max(o.aus, n0) - zyklus_n0, (uint8_t)(0x80 | o.kanal), o.note, 0);
    } else {
      s.offen[w++] = o;
    }
  }
  s.n_offen = w;
}

ErzZaehler Erzeuger::fenster(const ErzFenster& f, double jetzt_beat) {
  ErzZaehler z;
  if (f.strom < 1 || f.strom > ERZ_STROEME) return z;
  Strom& s = st_[f.strom - 1];
  // Glanz 2.7: für MIDI-Ströme ist bis gesendet_bis schon hinaus (Sample + Vorhalt des letzten block(), auch nach einem
  // Quantum-Wechsel exakt); dort darf ein Fenster nichts mehr ersetzen oder einfügen (Doppelnote, Prüfung R2/R3).
#ifdef CYPHERDJ_MUTATION_MIDI_FENSTER_OHNE_SCHUTZ
  const double jetzt_s = jetzt_beat;  // Fehlerfall Prüfung R2/R3: schon gesendete MIDI-Noten kommen doppelt
#else
  const double jetzt_s = s.midi_port > 0 ? std::max(jetzt_beat, s.gesendet_bis) : jetzt_beat;
#endif
  const double lo = std::max(f.ab_beat, jetzt_s);
  int w = 0;  // 1. noch nicht gespielte Ereignisse in [lo, bis) fallen weg
  for (int i = 0; i < s.n; ++i) {
    const ErzEv& e = s.ev[i];
    if (e.beat >= lo && e.beat < f.bis_beat) {
      ++z.verworfen;
      bool gleiches = false;
      for (int j = 0; j < f.n && !gleiches; ++j) gleiches = f.ev[j].muster == e.muster;
      if (!gleiches) ++z.verworfen_anderes_muster;
    } else {
      s.ev[w++] = e;
    }
  }
  s.n = w;
  for (int j = 0; j < f.n; ++j) {  // 2. einsetzen, sortiert; Vergangenes und Überlauf werden nicht gespielt
    const ErzEv& e = f.ev[j];
    if (e.beat < lo || s.n >= ERZ_SCHLANGE) {
      ++z.zu_spaet;
      continue;
    }
    int p = s.n;
    while (p > 0 && s.ev[p - 1].beat > e.beat) {
      s.ev[p] = s.ev[p - 1];
      --p;
    }
    s.ev[p] = e;
    ++s.n;
    ++z.eingefuegt;
  }
  return z;
}

// Glanz 2.5.1 (F46, F50): Gain am Frame p. Ohne Rampe genau v.g, damit bleibt d · g bitgleich zu früher.
float Erzeuger::huelle(const Stimme& v, int64_t p) {
#ifdef CYPHERDJ_MUTATION_ERZ_OHNE_RAMPE
  (void)p;
  return v.g;  // Fehlerfall der Abnahme: keine Rampe an begin/end
#else
  float g = v.g;
  const int64_t k = p - v.start, j = v.ende - 1 - p;
  if (k < v.ein) g *= (float)(k + 1) / (float)(v.ein + 1);
  if (j < v.aus) g *= (float)(j + 1) / (float)(v.aus + 1);
  return g;
#endif
}

void Erzeuger::spiele(Stimme& v, int von, int bis, float* const* ein_l, float* const* ein_r) {
  if (!v.klang || v.kanal < 0) return;
  float* l = ein_l[v.kanal];
  float* r = ein_r[v.kanal];
  const float* d = v.klang->daten.data();
  const int64_t ende = v.ende;
  for (int t = von; t < bis && v.pos < ende; ++t, ++v.pos) {
    const float g = huelle(v, v.pos);
    l[t] += d[2 * v.pos] * g;
    r[t] += d[2 * v.pos + 1] * g;
  }
  if (v.pos >= ende) v.klang = nullptr;
}

// F16/F11: Stimme endet jetzt, ihr Rest klingt aus einer Kopie über ERZ_AUSKLANG Frames aus (linear, erstes Sample
// ERZ_AUSKLANG/(ERZ_AUSKLANG+1)). Platz: ein freier (es gibt ERZ_AUSKLAENGE = 2 · ERZ_STIMMEN), als letzter Riegel bei Überlauf der mit dem kürzesten Rest. Läuft im Callback: nur feste
// Felder, keine Allokation (Erhebung-Prototyp: Schwanz-Kopie 5 us beim Kit-Tausch).
void Erzeuger::ausklingen(Stimme& v) {
  if (v.klang && v.kanal >= 0 && v.pos < v.ende) {
    Ausklang* a = &ak_[0];
#ifndef CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLATZ0  // Fehlerfall der Abnahme: jeder Ausklang auf Platz 0 überschreibt den vorigen
    for (Ausklang& x : ak_) {
      if (x.pos >= x.n) { a = &x; break; }
      if (x.n - x.pos < a->n - a->pos) a = &x;
    }
#endif
    const float* d = v.klang->daten.data();
    const int n = (int)std::min<int64_t>(ERZ_AUSKLANG, v.ende - v.pos);
    for (int i = 0; i < n; ++i) {
      const float g = huelle(v, v.pos + i) * (float)(ERZ_AUSKLANG - i) / (float)(ERZ_AUSKLANG + 1);
      a->d[2 * i] = d[2 * (v.pos + i)] * g;
      a->d[2 * i + 1] = d[2 * (v.pos + i) + 1] * g;
    }
    a->kanal = v.kanal;
    a->n = n;
    a->pos = 0;
  }
  v.klang = nullptr;
}

void Erzeuger::block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, MidiAus* midi,
                     int64_t zyklus_n0, ErzAusloeser* ausl) {
  if (ausl) ausl->n = 0;
  for (Ausklang& a : ak_) {  // F16/F11: zuerst die Ausklänge; ein in diesem Block belegter beginnt im nächsten
    if (a.pos >= a.n) continue;
    float* l = ein_l[a.kanal];
    float* r = ein_r[a.kanal];
    for (int t = 0; t < n && a.pos < a.n; ++t, ++a.pos) {
      l[t] += a.d[2 * a.pos];
      r[t] += a.d[2 * a.pos + 1];
    }
  }
  for (Stimme& v : sti_) spiele(v, 0, n, ein_l, ein_r);  // was schon klingt: der ganze Block
  for (Strom& s : st_) {
#ifdef CYPHERDJ_MUTATION_MIDI_OHNE_VORHALT
    const int64_t vor = 0;  // Fehlerfall F19: MIDI am Sample des Beats, kommt 545 Samples hinter dem Kit an
#else
    const int64_t vor = s.midi_port > 0 ? midi_vorhalt_ : 0;  // Glanz 2.7 (F19): Wirt-Rundweg vorhalten
#endif
    int gespielt = 0;
    while (gespielt < s.n) {
      const ErzEv& e = s.ev[gespielt];
      const int64_t smp = std::llround(k.sample_at(e.beat)) - vor;  // Kit-Ströme: vor = 0, Einsatz, von und Duck unverändert
      if (smp >= n0 + n) break;
      ++gespielt;
      if (s.midi_port > 0) {  // Studio S5: MIDI-Strom — Note-On am Sample (Glanz 2.7: minus Vorhalt), Off nach dauer
        if (!midi || s.kanal < 0 || e.note > 127) continue;  // F08: Noten ab 128 gibt es nur im Kit
        MidiAus& m = midi[s.midi_port - 1];
        const int64_t t = std::max(smp, n0) - zyklus_n0;
        const uint8_t note = (uint8_t)(e.note & 0x7f), ch = (uint8_t)(s.midi_kanal - 1);
        const uint8_t vel = (uint8_t)std::clamp((int)std::lround(e.velocity * 127.0f), 1, 127);
        for (int i = 0; i < s.n_offen; ++i)  // dieselbe Note klingt noch: erst aus, sonst beendet ihr Off die neue
          if (s.offen[i].note == note && s.offen[i].port == s.midi_port && s.offen[i].kanal == ch) {
            m.schreibe(t, (uint8_t)(0x80 | ch), note, 0);
            s.offen[i] = s.offen[--s.n_offen];
            break;
          }
        m.schreibe(t, (uint8_t)(0x90 | ch), note, vel);
        // Prüfung R3: Off mindestens ein Sample nach dem tatsächlichen On (max(smp, n0)). Wächst das Quantum, gehen Noten
        // zwischen alter und neuer Grenze am Blockanfang hinaus; ihr Off läge sonst auf demselben Sample (Länge 0 am Wirt).
#ifdef CYPHERDJ_MUTATION_MIDI_OFF_AM_ON
        const int64_t on_smp = smp;  // Fehlerfall R3: On und Off am selben Sample
#else
        const int64_t on_smp = std::max(smp, n0);
#endif
        const int64_t aus = std::max<int64_t>(std::llround(k.sample_at(e.beat + (e.dauer > 0.0 ? e.dauer : 0.25))) - vor, on_smp + 1);
        if (s.n_offen < ERZ_OFFEN) s.offen[s.n_offen++] = Strom::Offen{aus, note, (uint8_t)s.midi_port, ch};
        else m.schreibe(t, (uint8_t)(0x80 | ch), note, 0);  // kein Platz: sofort aus statt hängen
        continue;
      }
      if (!s.kit || s.kanal < 0) continue;  // Strom ohne Kit: das Ereignis verfällt still
      const KitKlang& kl = s.kit->klang[e.note & (KIT_KLAENGE - 1)];
      if (kl.frames <= 0) continue;         // Note ohne Klang im Kit
#ifdef CYPHERDJ_MUTATION_ERZ_BLOCKANFANG
      const int von = 0;  // Fehlerfall der Abnahme: Einsatz am Blockanfang statt am Sample
#else
      const int von = smp < n0 ? 0 : static_cast<int>(smp - n0);
#endif
      // Scheibe 3 (§4.8 begin/end): Ausschnitt [floor(begin · frames), floor(end · frames)), auf [0, 1] geklemmt
      const double b0 = std::clamp((double)e.begin, 0.0, 1.0), b1 = std::clamp((double)e.end, 0.0, 1.0);
#ifdef CYPHERDJ_MUTATION_ERZ_BEGIN_IGNORIERT
      const int64_t start = 0, ende = kl.frames;  // Fehlerfall am Ziel: Ausschnitt ignoriert
      (void)b0; (void)b1;
#else
      const int64_t start = (int64_t)std::floor(b0 * (double)kl.frames);
      const int64_t ende = (int64_t)std::floor(b1 * (double)kl.frames);
#endif
      if (ende <= start) continue;  // leerer Bereich: kein Ton
      if (ausl && kl.duck && ausl->n < ErzAusloeser::MAX) {  // K2 Task 1.2: der Klang steht fest und wird gespielt
#ifdef CYPHERDJ_MUTATION_DUCK_BLOCKANFANG
        ausl->sample[ausl->n++] = n0;  // Fehlerfall der Abnahme: Auslöser am Blockanfang statt am Sample
#else
        ausl->sample[ausl->n++] = smp < n0 ? n0 : smp;
#endif
      }
      Stimme* vp = nullptr;
#ifndef CYPHERDJ_MUTATION_ERZ_OHNE_FREIE  // Fehlerfall der Abnahme: die älteste wird geraubt, auch wenn Stimmen frei sind
      for (Stimme& x : sti_)  // F16 (Glanz 2.5.2): zuerst eine freie Stimme
        if (!x.klang) { vp = &x; break; }
#endif
      if (!vp) {  // alle belegt: die älteste klingt aus, statt hart zu enden
        vp = &sti_[0];
        for (Stimme& x : sti_)
#ifdef CYPHERDJ_MUTATION_ERZ_RAUB_JUENGSTE  // Fehlerfall der Abnahme: die jüngste Stimme wird geraubt
          if (x.nr > vp->nr) vp = &x;
#else
          if (x.nr < vp->nr) vp = &x;
#endif
        ausklingen(*vp);
      }
      Stimme& v = *vp;
      const float* kd = kl.daten.data();
      const auto laut = [kd](int64_t f) { return std::max(std::fabs(kd[2 * f]), std::fabs(kd[2 * f + 1])) > ERZ_KANTE; };
      const int64_t len = ende - start;
      v = Stimme{};
      v.klang = &kl; v.kanal = s.kanal; v.pos = start; v.start = start; v.ende = ende; v.g = e.velocity; v.nr = ++gezaehlt_;
      // F46: Einblende nur bei begin > 0 und lauter Kante (Anschläge am Klanganfang bleiben hart)
      v.ein = (start > 0 && laut(start)) ? (int)std::min<int64_t>(ERZ_EIN, len / 4) : 0;
      // F46 + F50 Kernseite: Ende des gespielten Bereichs, auch das Dateiende eines Mitschnitts
      v.aus = laut(ende - 1) ? (int)std::min<int64_t>(ERZ_AUS, len / 4) : 0;
      spiele(v, von, n, ein_l, ein_r);
    }
    // Prüfung R3: MIDI ist jetzt hinaus für alle Beats mit llround(sample_at(beat)) − vor < n0 + n, also
    // sample_at(beat) < n0 + n + vor − 0,5 (llround rundet die Hälfte nach oben)
    if (s.midi_port > 0) s.gesendet_bis = std::max(s.gesendet_bis, k.beat_at((double)(n0 + n + vor) - 0.5));
    if (gespielt > 0) {
      std::memmove(s.ev, s.ev + gespielt, sizeof(ErzEv) * (size_t)(s.n - gespielt));
      s.n -= gespielt;
    }
    if (midi) noten_aus(s, n0 + n, midi, n0, zyklus_n0);  // Studio S5: Offs, die in diesem Block fällig sind
  }
}

void Erzeuger::leeren() {
  for (Strom& s : st_) {
    s.n = 0;
#ifndef CYPHERDJ_MUTATION_LEEREN_OHNE_GESENDET  // Fehlerfall Re-Prüfung N1: MIDI schweigt nach /k/set/neu
    s.gesendet_bis = -HUGE_VAL;  // Prüfung R3: Beats der alten Zeitachse gelten nicht mehr
#endif
    for (int i = 0; i < s.n_offen; ++i) s.offen[i].aus = INT64_MIN;  // Offs gehen im nächsten block() hinaus
  }
}

int Erzeuger::stimmen() const {
  int n = 0;
  for (const Stimme& v : sti_) n += v.klang != nullptr;
  return n;
}

int Erzeuger::ausklaenge() const {
  int n = 0;
  for (const Ausklang& a : ak_) n += a.pos < a.n;
  return n;
}

}  // namespace cdj
