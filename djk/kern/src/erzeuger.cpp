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
      if (v.klang >= &alt->klang[0] && v.klang < &alt->klang[0] + KIT_KLAENGE) v.klang = nullptr;
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
  const double lo = std::max(f.ab_beat, jetzt_beat);
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

void Erzeuger::spiele(Stimme& v, int von, int bis, float* const* ein_l, float* const* ein_r) {
  if (!v.klang || v.kanal < 0) return;
  float* l = ein_l[v.kanal];
  float* r = ein_r[v.kanal];
  const float* d = v.klang->daten.data();
  const int64_t ende = v.ende;
  for (int t = von; t < bis && v.pos < ende; ++t, ++v.pos) {
    l[t] += d[2 * v.pos] * v.g;
    r[t] += d[2 * v.pos + 1] * v.g;
  }
  if (v.pos >= ende) v.klang = nullptr;
}

void Erzeuger::block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, MidiAus* midi,
                     int64_t zyklus_n0, ErzAusloeser* ausl) {
  if (ausl) ausl->n = 0;
  for (Stimme& v : sti_) spiele(v, 0, n, ein_l, ein_r);  // was schon klingt: der ganze Block
  for (Strom& s : st_) {
    int gespielt = 0;
    while (gespielt < s.n) {
      const ErzEv& e = s.ev[gespielt];
      const int64_t smp = std::llround(k.sample_at(e.beat));
      if (smp >= n0 + n) break;
      ++gespielt;
      if (s.midi_port > 0) {  // Studio S5: MIDI-Strom — Note-On am Sample, Off nach dauer
        if (!midi || s.kanal < 0) continue;
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
        const int64_t aus = std::max<int64_t>(std::llround(k.sample_at(e.beat + (e.dauer > 0.0 ? e.dauer : 0.25))), smp + 1);
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
      Stimme& v = sti_[naechste_];
      naechste_ = (naechste_ + 1) % ERZ_STIMMEN;  // alle belegt: reihum abgelöst
      v = Stimme{&kl, s.kanal, start, ende, e.velocity};
      spiele(v, von, n, ein_l, ein_r);
    }
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
    for (int i = 0; i < s.n_offen; ++i) s.offen[i].aus = INT64_MIN;  // Offs gehen im nächsten block() hinaus
  }
}

int Erzeuger::stimmen() const {
  int n = 0;
  for (const Stimme& v : sti_) n += v.klang != nullptr;
  return n;
}

}  // namespace cdj
