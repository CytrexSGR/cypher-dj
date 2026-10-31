#include "cypherdj/erzeuger.h"

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstring>

#include <cypherdj/dsp/denormal.h>

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

void Erzeuger::bk_zur_freigabe(CypherBk* bk) {
  if (!bk) return;
  if (n_bk_frei_ < ERZ_BK_FREI) bk_frei_[n_bk_frei_++] = bk;
  else ++bk_stand_.voll;  // darf nicht vorkommen (je Block geleert); lieber verlieren als im Callback freigeben
}

void Erzeuger::setze_bk(int strom, CypherBk* bk, int kanal) {
  if (strom < 1 || strom > ERZ_STROEME) { bk_zur_freigabe(bk); return; }
  Strom& s = st_[strom - 1];
  if (werk_) {  // Baukasten S3b (D6): nur vormerken; der Wechsel geschieht in block(), wenn die Plätze frei sind
    if (s.bk_neu_gesetzt && s.bk_neu != bk && s.bk_neu != s.bk) bk_zur_freigabe(s.bk_neu);  // gehörte nie einem Platz (m5)
    if (bk == s.bk) { s.bk_neu = nullptr; s.bk_neu_gesetzt = false; return; }  // derselbe Graph: nichts wartet mehr
    s.bk_neu = bk;
    s.bk_neu_kanal = (kanal >= 0 && kanal < MIX_KANAELE) ? kanal : -1;
    s.bk_neu_gesetzt = true;
    return;
  }
  if (s.bk && s.bk != bk) {
    BkAus& a = bk_aus_[strom - 1];
#ifndef CYPHERDJ_MUTATION_BK_ZWEITER_WECHSEL_LECK
    bk_zur_freigabe(a.bk);  // ein noch ausklingender geht sofort
#endif
#ifdef CYPHERDJ_MUTATION_BK_HART
    bk_zur_freigabe(s.bk);  // Fehlerfall Baukasten S3a: der alte Graph endet hart statt auszuklingen
#elif defined(CYPHERDJ_MUTATION_BK_ALLE_AUS)
    cypher_bk_alle_aus(s.bk, 0);  // Fehlerfall Baukasten S3a: alle_aus setzt gate 0 am Sample 0 (Abbruch in einem Sample)
    a = BkAus{s.bk, s.kanal, 0};
#else
    a = BkAus{s.bk, s.kanal, 0};
#endif
    int w = 0;  // offene Noten des alten Graphen verfallen (port 0 = Graph)
    for (int i = 0; i < s.n_offen; ++i) if (s.offen[i].port != 0) s.offen[w++] = s.offen[i];
    s.n_offen = w;
  }
  s.bk = bk;
  if (bk) s.kanal = (kanal >= 0 && kanal < MIX_KANAELE) ? kanal : -1;
}

// Baukasten S3b: der neue Graph übernimmt den Strom; der alte ist schon im Ausklang-Platz oder war keiner.
void Erzeuger::bk_wechsel(Strom& s, CypherBk* bk, int kanal) {
  s.bk = bk;
  s.bk_kanal = bk ? kanal : -1;
  if (bk && kanal >= 0) s.kanal = kanal;  // wie S3a setze_bk
  s.bk_neu = nullptr;
  s.bk_neu_gesetzt = false;
}

int Erzeuger::bk_frei(CypherBk** aus, int max) {
  const int n = std::min(n_bk_frei_, max);
  for (int i = 0; i < n; ++i) aus[i] = bk_frei_[i];
  for (int i = n; i < n_bk_frei_; ++i) bk_frei_[i - n] = bk_frei_[i];
  n_bk_frei_ -= n;
  return n;
}

// Addiert q_l/q_r (bk_l_/bk_r_ oder ein Platz des Graph-Werks) in den Eingang von kanal: NaN/Inf als 0, Klemme ±8 (wie die Rückwege). Ab Sample ausblende_ab
// linear über ausblende_n Samples (Ausklang) und danach nichts; ausblende_n 0 = ohne Ausblende.
void Erzeuger::bk_addiere(const float* q_l, const float* q_r, int kanal, int n, float* const* ein_l, float* const* ein_r,
                          int ausblende_ab, int ausblende_n) {
  float* l = ein_l[kanal];
  float* r = ein_r[kanal];
  for (int i = 0; i < n; ++i) {
    float g = 1.0f;
    if (ausblende_n > 0) {
      const int p = ausblende_ab + i;
      if (p >= ausblende_n) break;
#ifdef CYPHERDJ_MUTATION_BK_FADE_KONSTANT
      g = 1.0f;  // Fehlerfall Baukasten S3a: der Ausklang bricht am Ende ab statt linear zu fallen
#else
      g = 1.0f - (float)(p + 1) / (float)ausblende_n;
#endif
    }
    const float a = q_l[i], c = q_r[i];
#ifdef CYPHERDJ_MUTATION_BK_OHNE_KLEMME
    l[i] += g * a;  // Fehlerfall Baukasten S3a: Zahlenvergiftung und Überpegel erreichen den Mixer
    r[i] += g * c;
#else
    const bool ok = std::isfinite(a) && std::isfinite(c);
    l[i] += ok ? g * std::clamp(a, -8.0f, 8.0f) : 0.0f;
    r[i] += ok ? g * std::clamp(c, -8.0f, 8.0f) : 0.0f;
#endif
  }
}

void Erzeuger::noten_aus(Strom& s, int64_t bis, MidiAus* midi, int64_t n0, int64_t zyklus_n0, OffsWahl wahl) {
  int w = 0;
  for (int i = 0; i < s.n_offen; ++i) {
    const Strom::Offen& o = s.offen[i];
    // D8: nur die gewählte Art; MIDI-Offs gehen nur mit Puffer hinaus und bleiben sonst stehen (B1)
    const bool faellig = o.aus < bis && (o.port == 0 ? wahl != OffsWahl::OHNE_GRAPH : (wahl != OffsWahl::NUR_GRAPH && midi));
    if (faellig) {
      if (o.port == 0) {
#ifdef CYPHERDJ_MUTATION_BK_OFF_BLOCKANFANG
        if (cypher_bk_note_aus(s.bk, 0, o.note) != 0) ++bk_stand_.verloren;  // Fehlerfall Baukasten S3a: Off am Blockanfang
#else
        if (cypher_bk_note_aus(s.bk, (uint32_t)(std::max(o.aus, n0) - n0), o.note) != 0) ++bk_stand_.verloren;
#endif
      }
      else midi[o.port - 1].schreibe(std::max(o.aus, n0) - zyklus_n0, (uint8_t)(0x80 | o.kanal), o.note, 0);
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
  // Baukasten S3b (D8b): ein Graph-Strom mit Werk hat das Fenster des nächsten Blocks schon vergeben
  const double jetzt_s = (s.midi_port > 0 || (s.bk && werk_)) ? std::max(jetzt_beat, s.gesendet_bis) : jetzt_beat;
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
  for (int i = 0; i < ERZ_STROEME; ++i) {  // Baukasten S3a: abgelöste Graphen klingen ERZ_AUSKLANG Frames linear aus
    BkAus& a = bk_aus_[i];
    if (!a.bk) continue;
    if (werk_) { bk_ausklang_werk(i, n0, n, ein_l, ein_r); continue; }  // S3b: aus dem Ausklang-Platz
    if (a.kanal >= 0) {
      cypherdj::dsp::DenormalSchutz schutz;
      if (cypher_bk_block(a.bk, bk_l_, bk_r_, (size_t)n) != 0) ++bk_stand_.panik;
      bk_addiere(bk_l_, bk_r_, a.kanal, n, ein_l, ein_r, a.pos, ERZ_AUSKLANG);
    }
    a.pos += n;
    if (a.pos >= ERZ_AUSKLANG || a.kanal < 0) { bk_zur_freigabe(a.bk); a = BkAus{}; }
  }
  for (Stimme& v : sti_) spiele(v, 0, n, ein_l, ein_r);  // was schon klingt: der ganze Block
  for (int si = 0; si < ERZ_STROEME; ++si) {
    Strom& s = st_[si];
    // Baukasten S3b: ein Strom ohne Graph übernimmt einen wartenden sofort, wenn seine Plätze frei sind (sonst nach dem Ausklang)
    if (werk_ && s.bk_neu_gesetzt && !s.bk && !bk_aus_[si].bk && werk_->frei(si) && werk_->frei(ERZ_STROEME + si))
      bk_wechsel(s, s.bk_neu, s.bk_neu_kanal);
    if (werk_ && s.bk) {  // Baukasten S3b: Graph-Strom mit Werk, die Ereignisse entnimmt bk_noten fensterweise (Review F2 N6)
      if (midi) noten_aus(s, n0 + n, midi, n0, zyklus_n0, OffsWahl::OHNE_GRAPH);  // offene MIDI-Noten eines früheren MIDI-Stroms
      bk_vorlauf(s, si, k, n0, n, ein_l, ein_r);
      continue;
    }
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
#ifdef CYPHERDJ_MUTATION_BK_KIT_SPIELT
      if (s.bk && false) {  // Fehlerfall Baukasten S3a: der Graph-Zweig greift nicht, das Kit spielt
#else
      if (s.bk) {  // Baukasten S3a: Note an den Graphen am Sample des Beats, ohne Vorhalt; Off nach dauer
#endif
        if (s.kanal < 0 || e.note < 0 || e.note > 127) continue;
#ifdef CYPHERDJ_MUTATION_BK_VORHALT
        const int64_t on = std::max(smp - 545, n0);  // Fehlerfall Baukasten S3a: Vorhalt wie beim MIDI-Strom
#else
        const int64_t on = std::max(smp, n0);
#endif
        const uint8_t note = (uint8_t)e.note;
        for (int i = 0; i < s.n_offen; ++i)  // dieselbe Note klingt noch: erst aus (am selben Sample vor dem An)
          if (s.offen[i].port == 0 && s.offen[i].note == note) {
            if (cypher_bk_note_aus(s.bk, (uint32_t)(on - n0), note) != 0) ++bk_stand_.verloren;
            s.offen[i] = s.offen[--s.n_offen];
            break;
          }
        if (cypher_bk_note_an(s.bk, (uint32_t)(on - n0), note, e.velocity) != 0) ++bk_stand_.verloren;
        const int64_t aus = std::max<int64_t>(std::llround(k.sample_at(e.beat + (e.dauer > 0.0 ? e.dauer : 0.25))), on + 1);
        if (s.n_offen < ERZ_OFFEN) s.offen[s.n_offen++] = Strom::Offen{aus, note, 0, 0};
        else if (cypher_bk_note_aus(s.bk, (uint32_t)(on - n0 + 1), note) != 0) ++bk_stand_.verloren;  // kein Platz: gleich wieder aus statt hängen
        continue;
      }
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
    if (werk_) {  // Baukasten S3b: Kit/MIDI-Strom (ein Graph-Strom kam oben nicht hierher)
      if (midi) noten_aus(s, n0 + n, midi, n0, zyklus_n0, OffsWahl::OHNE_GRAPH);
      continue;
    }
    if (midi || s.bk) noten_aus(s, n0 + n, midi, n0, zyklus_n0, OffsWahl::ALLE);  // Studio S5: Offs, die in diesem Block fällig sind
    if (s.bk && s.kanal >= 0) {  // Baukasten S3a: Graph rechnen, Noten dieses Blocks sind gemeldet
      cypherdj::dsp::DenormalSchutz schutz;
      if (cypher_bk_block(s.bk, bk_l_, bk_r_, (size_t)n) != 0) ++bk_stand_.panik;
      bk_addiere(bk_l_, bk_r_, s.kanal, n, ein_l, ein_r, 0, 0);
    }
  }
}

// Baukasten S3b: Graph-Ereignisse mit Sample < bis an den Graphen, am Sample des Beats ohne Vorhalt (wie S3a), Versatz relativ
// zu von; was vor von liegt (verspätet eingetroffen oder nach einem verspäteten Block liegen geblieben), am Fensteranfang.
// Nur auf freiem Platz: der Callback ist dann der einzige, der das Handle anfasst.
void Erzeuger::bk_noten(Strom& s, const Karte& k, int64_t von, int64_t bis) {
  int gespielt = 0;
  while (gespielt < s.n) {
    const ErzEv& e = s.ev[gespielt];
    const int64_t smp = std::llround(k.sample_at(e.beat));
    if (smp >= bis) break;
    ++gespielt;
    if (s.bk_kanal < 0 || e.note < 0 || e.note > 127) continue;
    const int64_t on = std::max(smp, von);
    const uint8_t note = (uint8_t)e.note;
    for (int i = 0; i < s.n_offen; ++i)  // dieselbe Note klingt noch: erst aus (am selben Sample vor dem An)
      if (s.offen[i].port == 0 && s.offen[i].note == note) {
        if (cypher_bk_note_aus(s.bk, (uint32_t)(on - von), note) != 0) ++bk_stand_.verloren;
        s.offen[i] = s.offen[--s.n_offen];
        break;
      }
    if (cypher_bk_note_an(s.bk, (uint32_t)(on - von), note, e.velocity) != 0) ++bk_stand_.verloren;
    const int64_t aus = std::max<int64_t>(std::llround(k.sample_at(e.beat + (e.dauer > 0.0 ? e.dauer : 0.25))), on + 1);
    if (s.n_offen < ERZ_OFFEN) s.offen[s.n_offen++] = Strom::Offen{aus, note, 0, 0};
    else if (cypher_bk_note_aus(s.bk, (uint32_t)(on - von + 1), note) != 0) ++bk_stand_.verloren;  // kein Platz: gleich wieder aus
  }
  if (gespielt > 0) {
    std::memmove(s.ev, s.ev + gespielt, sizeof(ErzEv) * (size_t)(s.n - gespielt));
    s.n -= gespielt;
  }
  noten_aus(s, bis, nullptr, von, 0, OffsWahl::NUR_GRAPH);
  // D8b: bis hierher ist vergeben; fenster() ersetzt davor nichts mehr (sonst klänge eine Note doppelt)
  s.gesendet_bis = std::max(s.gesendet_bis, k.beat_at((double)bis - 0.5));
}

// Baukasten S3b: abgelöster Graph des Stroms a im Ausklang-Platz ERZ_STROEME + a. Er bekommt keine Noten mehr, spielt seinen
// vorgerechneten Block mit der Rampe ab pos und rechnet den nächsten voraus, solange die Rampe nicht zu Ende ist.
void Erzeuger::bk_ausklang_werk(int a, int64_t n0, int n, float* const* ein_l, float* const* ein_r) {
  BkAus& x = bk_aus_[a];
  const int p = ERZ_STROEME + a;
  const Abholung h = werk_->abholen(p, n0, n);
  if (h == Abholung::VERSPAETET) { ++bk_stand_.verspaetet; return; }  // Stille, der Faden besitzt den Graphen noch
  if (h != Abholung::GUELTIG) werk_->anlauf(p, x.bk, n);              // verworfen oder leer: selbst rechnen
#ifndef CYPHERDJ_MUTATION_BK_WERK_AUSKLANG_STUMM  // Fehlerfall: der Ausklang-Platz rechnet, aber sein Block wird nie gemischt
  if (x.kanal >= 0) bk_addiere(werk_->l(p), werk_->r(p), x.kanal, n, ein_l, ein_r, x.pos, ERZ_AUSKLANG);
#endif
  x.pos += n;
  if (x.pos >= ERZ_AUSKLANG || x.kanal < 0) { bk_zur_freigabe(x.bk); x = BkAus{}; return; }
  werk_->auftrag(p, x.bk, n0 + n, n);
}

// Baukasten S3b: Graph-Strom mit Werk, Platz a (D1, D4, D5). Abholen, was ein Faden für diesen Block gerechnet hat (sonst
// selbst rechnen), dann ggf. wechseln, dann Noten für den nächsten Block und Auftrag.
void Erzeuger::bk_vorlauf(Strom& s, int a, const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r) {
  const Abholung h = werk_->abholen(a, n0, n);
  if (h == Abholung::VERSPAETET) {  // D4: Stille, Platz bleibt beim Faden, Noten bleiben liegen, kein Auftrag
    ++bk_stand_.verspaetet;
#ifdef CYPHERDJ_MUTATION_BK_WERK_SPAET_VERBRAUCHT  // Fehlerfall: die Ereignisse des übersprungenen Fensters gehen verloren
    int g = 0;
    while (g < s.n && std::llround(k.sample_at(s.ev[g].beat)) < n0 + 2 * n) ++g;
    std::memmove(s.ev, s.ev + g, sizeof(ErzEv) * (size_t)(s.n - g));
    s.n -= g;
#endif
#ifdef CYPHERDJ_MUTATION_BK_WERK_NOTEN_TROTZ_BESETZT  // Fehlerfall: Noten an ein Handle, an dem ein Faden rechnet
    bk_noten(s, k, n0 + n, n0 + 2 * n);
#endif
#ifdef CYPHERDJ_MUTATION_BK_WERK_WECHSEL_SOFORT  // Fehlerfall: der Wechsel wartet nicht auf den Platz, der alte geht frei
    if (s.bk_neu_gesetzt) { bk_zur_freigabe(s.bk); bk_wechsel(s, s.bk_neu, s.bk_neu_kanal); }
#endif
    return;
  }
  // D6: wechseln, wenn ein neuer wartet und der Ausklang-Platz frei ist (der aktive ist es nach dem Abholen)
  const bool wechsle = s.bk_neu_gesetzt && !bk_aus_[a].bk && werk_->frei(ERZ_STROEME + a);
  if (h != Abholung::GUELTIG) {  // D5 Anlauf: dieses Fenster selbst; wartet ein Wechsel, bekommt der alte keine Noten (m11)
    if (!s.bk_neu_gesetzt) bk_noten(s, k, n0, n0 + n);
    werk_->anlauf(a, s.bk, n);
  }
#ifdef CYPHERDJ_MUTATION_BK_WERK_RAMPE_SPAET  // Fehlerfall: der alte spielt den Wechselblock voll, die Rampe beginnt erst danach
  const int rampe = 0;
  if (s.bk_kanal >= 0) bk_addiere(werk_->l(a), werk_->r(a), s.bk_kanal, n, ein_l, ein_r, 0, 0);
#else
  const int rampe = n;
  if (s.bk_kanal >= 0) bk_addiere(werk_->l(a), werk_->r(a), s.bk_kanal, n, ein_l, ein_r, 0, wechsle ? ERZ_AUSKLANG : 0);
#endif
  if (wechsle) {  // der alte klingt im Ausklang-Platz weiter, seine offenen Noten verfallen (wie S3a)
    int w = 0;
    for (int i = 0; i < s.n_offen; ++i) if (s.offen[i].port != 0) s.offen[w++] = s.offen[i];
    s.n_offen = w;
    if (rampe >= ERZ_AUSKLANG || s.bk_kanal < 0) bk_zur_freigabe(s.bk);
    else {
      bk_aus_[a] = BkAus{s.bk, s.bk_kanal, rampe};
      werk_->auftrag(ERZ_STROEME + a, s.bk, n0 + n, n);
    }
    bk_wechsel(s, s.bk_neu, s.bk_neu_kanal);
    if (!s.bk) return;  // Graph ab: der Strom spielt ab dem nächsten Block Kit oder MIDI
  }
  if (s.bk_neu_gesetzt) return;  // ein Wechsel wartet (Ausklang-Platz besetzt): keine Noten an den alten (m11)
  bk_noten(s, k, n0 + n, n0 + 2 * n);
  werk_->auftrag(a, s.bk, n0 + n, n);
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
