// D1 K1: Prüfaufbau für das Modul Arrangement ohne Lader und ohne Kern. Schnappschüsse entstehen im Speicher (Bau),
// Audio liegt im Test (kein mmap): ein Impuls hat 1.0 auf Frame 0, so liegt sein Einsatz am Ausgang genau auf dem
// Sample, an dem der Clip einsetzt. Der Treiber fährt das Modul mit einer Karte bei 128 BPM (22 500 Samples je Beat)
// in Blöcken von n Samples und schreibt Summe und Metronom-Ausgänge mit (Index = Kern-Sample).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "cypherdj/arrangement.h"
#include "cypherdj/warp_werk.h"

namespace arrtest {

constexpr int64_t SPB = 22500;   // Samples je Beat bei 128 BPM

struct Audio {
  std::vector<float> d;
  cdj::ArrAudio a{};
  static std::unique_ptr<Audio> impuls(int64_t frames) {   // 1.0 auf Frame 0 (L und R), sonst 0
    auto x = std::make_unique<Audio>();
    x->d.assign(static_cast<size_t>(frames) * 2, 0.0f);
    x->d[0] = x->d[1] = 1.0f;
    x->fuellen(frames);
    return x;
  }
  static std::unique_ptr<Audio> gleich(int64_t frames, float wert = 0.5f) {   // konstanter Wert: misst Blenden
    auto x = std::make_unique<Audio>();
    x->d.assign(static_cast<size_t>(frames) * 2, wert);
    x->fuellen(frames);
    return x;
  }
  static std::unique_ptr<Audio> sinus(int64_t frames, double hz, float amp) {   // Sinus hz mit Spitze amp, L und R gleich (1.10 AK6)
    auto x = std::make_unique<Audio>();
    x->d.resize(static_cast<size_t>(frames) * 2);
    for (int64_t f = 0; f < frames; ++f)
      x->d[2 * f] = x->d[2 * f + 1] = amp * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(f) / 48000.0));
    x->fuellen(frames);
    return x;
  }
  static std::unique_ptr<Audio> rampe(int64_t frames) {   // Frame f trägt f (L) und −f (R): misst die Quellposition
    auto x = std::make_unique<Audio>();
    x->d.resize(static_cast<size_t>(frames) * 2);
    for (int64_t f = 0; f < frames; ++f) {
      x->d[2 * f] = static_cast<float>(f);
      x->d[2 * f + 1] = -static_cast<float>(f);
    }
    x->fuellen(frames);
    return x;
  }
  static std::unique_ptr<Audio> klicks(int64_t frames, int64_t abstand) {   // 1.0 auf Frame k · abstand, sonst 0 (Paket 1.13)
    auto x = std::make_unique<Audio>();
    x->d.assign(static_cast<size_t>(frames) * 2, 0.0f);
    for (int64_t f = 0; f < frames; f += abstand) x->d[2 * f] = x->d[2 * f + 1] = 1.0f;
    x->fuellen(frames);
    return x;
  }
  void fuellen(int64_t frames) {
    a.daten = d.data();
    a.frames = frames;
    std::snprintf(a.sha256, sizeof a.sha256, "%064d", 0);
  }
};

// Baut einen Schnappschuss; spur()/clip()/note() vor fertig(), danach zeigen die Zeiger in die Vektoren.
struct Bau {
  std::unique_ptr<cdj::ArrSnapshot> s{new cdj::ArrSnapshot()};
  struct C { int spur; cdj::ArrClip c; std::vector<double> wb, wf; int wm = 0; double wp = 1.0; std::vector<double> eb, ef; int lp = 0, hu = 100; };   // wb, wf: Warp-Marker des Clips (Paket 1.13), leer = ungewarpt; wm: Modus (0 repitch, 2 complex, 3 tones)
  struct N { int spur; cdj::ArrNote n; };
  std::vector<C> cs;
  std::vector<N> ns;
  explicit Bau(int64_t nr = 1) { s->nr = nr; }
  Bau& spur(int nr, cdj::ArrArt art, int slot = 0) {
    s->spur[nr - 1].nr = nr;
    s->spur[nr - 1].art = art;
    s->spur[nr - 1].slot = slot;
    return *this;
  }
  Bau& ausgang(int nr, int gruppe) { s->spur[nr - 1].ausgang = static_cast<int8_t>(gruppe); return *this; }   // 1.10: 0 master, 1..8 Gruppe
  Bau& clip(int nr, const char* id, double start, double laenge, const cdj::ArrAudio* a, int64_t offset = 0,
            float gain = 1.0f, double ein = 0.0, double aus = 0.0) {
    cs.push_back({nr, cdj::ArrClip{cdj::arr_id(id), start, laenge, a, offset, gain, ein, aus}});
    return *this;
  }
  // Paket 1.13: hängt dem zuletzt hinzugefügten Clip einen Warp an: Marker als Clip-Beat und Quell-Frame, beide streng steigend; modus 0 RE-PITCH,
  // 2 COMPLEX, 3 TONES (Slice 2)
  Bau& warp(std::vector<double> beat, std::vector<double> frame, int modus = 0, double pitch = 1.0) {
    cs.back().wb = std::move(beat);
    cs.back().wf = std::move(frame);
    cs.back().wm = modus;
    cs.back().wp = pitch;
    return *this;
  }
  // Slice 4: hängt dem Warp des zuletzt hinzugefügten Clips (warp(..., 1)) die BEATS-Einheiten an: Clip-Beat und Quell-Frame, beide streng steigend; loop 0 aus, 1 vor, 2 vor_zurueck; huelle 0..100
  Bau& beats(std::vector<double> beat, std::vector<double> frame, int loop = 0, int huelle = 100) {
    cs.back().eb = std::move(beat);
    cs.back().ef = std::move(frame);
    cs.back().lp = loop;
    cs.back().hu = huelle;
    return *this;
  }
  Bau& note(int nr, const char* id, double beat, double laenge, int ton, int vel = 100) {
    ns.push_back({nr, cdj::ArrNote{cdj::arr_id(id), beat, laenge, static_cast<uint8_t>(ton), static_cast<uint8_t>(vel)}});
    return *this;
  }
  cdj::ArrSnapshot* fertig() {
    s->clips.reserve(cs.size());
    s->noten.reserve(ns.size());
    s->noten_id.reserve(ns.size());
    s->noten_id_index.reserve(ns.size());
    size_t n_warps = 0, n_punkte = 0;
    for (const C& c : cs)
      if (!c.wb.empty()) {
        ++n_warps;
        n_punkte += c.wb.size() + c.eb.size();
      }
    s->warps.reserve(n_warps);        // die Zeiger der Clips zeigen in diese Vektoren, sie wachsen danach nie
    s->warp_beat.reserve(n_punkte);
    s->warp_frame.reserve(n_punkte);
    for (int nr = 1; nr <= cdj::ARR_SPUREN; ++nr) {
      cdj::ArrSpur& sp = s->spur[nr - 1];
      const size_t c0 = s->clips.size();
      for (const C& c : cs)
        if (c.spur == nr) {
          cdj::ArrClip x = c.c;
          if (!c.wb.empty()) {
            const size_t p0 = s->warp_beat.size();
            s->warp_beat.insert(s->warp_beat.end(), c.wb.begin(), c.wb.end());
            s->warp_frame.insert(s->warp_frame.end(), c.wf.begin(), c.wf.end());
            cdj::ArrWarp w;
            w.modus = c.wm;
            w.pitch = c.wp;
            w.n = static_cast<int32_t>(c.wb.size());
            w.beat = s->warp_beat.data() + p0;
            w.frame = s->warp_frame.data() + p0;
            if (!c.eb.empty()) {   // Slice 4: die Einheiten stehen hinter den Markern, wie im Lader
              const size_t e0 = s->warp_beat.size();
              s->warp_beat.insert(s->warp_beat.end(), c.eb.begin(), c.eb.end());
              s->warp_frame.insert(s->warp_frame.end(), c.ef.begin(), c.ef.end());
              w.e_n = static_cast<int32_t>(c.eb.size());
              w.e_beat = s->warp_beat.data() + e0;
              w.e_frame = s->warp_frame.data() + e0;
              w.loop = c.lp;
              w.huelle = c.hu;
            }
            s->warps.push_back(w);
            x.warp = &s->warps.back();
          }
          s->clips.push_back(x);
        }
      std::sort(s->clips.begin() + static_cast<long>(c0), s->clips.end(),
                [](const cdj::ArrClip& a, const cdj::ArrClip& b) { return a.start_beat < b.start_beat; });
      sp.n_clips = static_cast<int>(s->clips.size() - c0);
      sp.clips = sp.n_clips ? s->clips.data() + c0 : nullptr;
      const size_t n0 = s->noten.size();
      for (const N& n : ns)
        if (n.spur == nr) s->noten.push_back(n.n);
      std::sort(s->noten.begin() + static_cast<long>(n0), s->noten.end(),
                [](const cdj::ArrNote& a, const cdj::ArrNote& b) { return a.beat < b.beat; });
      sp.n_noten = static_cast<int>(s->noten.size() - n0);
      sp.noten = sp.n_noten ? s->noten.data() + n0 : nullptr;
      std::vector<std::pair<uint64_t, int32_t>> ix;
      for (int i = 0; i < sp.n_noten; ++i) ix.push_back({sp.noten[i].id, i});
      std::sort(ix.begin(), ix.end());
      const size_t i0 = s->noten_id.size();
      for (const auto& [id, i] : ix) {
        s->noten_id.push_back(id);
        s->noten_id_index.push_back(i);
      }
      sp.noten_id = sp.n_noten ? s->noten_id.data() + i0 : nullptr;
      sp.noten_id_index = sp.n_noten ? s->noten_id_index.data() + i0 : nullptr;
    }
    for (const C& c : cs)   // Slice 2: jedes genutzte Audio genau einmal (wie der Lader; das Warp-Werk fragt danach in liest())
      if (std::find(s->audios.begin(), s->audios.end(), c.c.audio) == s->audios.end()) s->audios.push_back(const_cast<cdj::ArrAudio*>(c.c.audio));
    return s.release();
  }
};

// Prüfsenke: schreibt jede Note mit dem Block mit, in dem sie ankam; im Block-Aufruf legt sie je Note-On einen Impuls
// 0,25 auf ihr Ziel-Sample in den Spur-Eingang (so ist der Einsatz am Ausgang sample-genau messbar).
struct PruefSenke : cdj::ArrSenke {
  struct Ev { int spur; int64_t ziel; int ton, vel; bool an; int64_t block_s0; };
  std::vector<Ev> ev;
  std::vector<std::pair<int, int64_t>> alle_aus_ev, start_ev;
  std::vector<int64_t> impulse;
  int64_t v = 0;
  int64_t block_s0 = -1;
  explicit PruefSenke(int64_t vorhalt = 0) : v(vorhalt) {
    ev.reserve(1 << 16);
    impulse.reserve(1 << 16);
    alle_aus_ev.reserve(1024);
    start_ev.reserve(1024);
  }
  int64_t vorhalt() const noexcept override { return v; }
  void note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept override {
    ev.push_back({spur, ziel, ton, vel, an, block_s0});
    if (an) impulse.push_back(ziel);
  }
  void alle_aus(int spur, int64_t ziel) noexcept override { alle_aus_ev.push_back({spur, ziel}); }
  void transport_start(int spur, int64_t ziel) noexcept override { start_ev.push_back({spur, ziel}); }
  void block(int, int64_t s0, int m, float* l, float* r) noexcept override {
    for (int64_t z : impulse)
      if (z >= s0 && z < s0 + m) {
        l[z - s0] += 0.25f;
        r[z - s0] += 0.25f;
      }
  }
  std::vector<Ev> ons() const {
    std::vector<Ev> o;
    for (const Ev& e : ev)
      if (e.an) o.push_back(e);
    return o;
  }
  std::vector<Ev> offs() const {
    std::vector<Ev> o;
    for (const Ev& e : ev)
      if (!e.an) o.push_back(e);
    return o;
  }
};

struct Treiber {
  cypherdj::stellwerk::ReglerTabelle tab;
  cdj::Karte k{128.0, 0};
  cdj::Arrangement arr{tab};
  int n = 256;
  int64_t s = 0;
  std::vector<float> l, r, ml, mr, cl, cr;
  std::vector<float> pml, pmr;                // PM-Abgriff je Block (1.10)
  std::vector<const cdj::ArrSnapshot*> alt;   // abgelöste Schnappschüsse (am Ende freigegeben)
  std::vector<PruefSenke*> senken;            // bekommen vor jedem Block dessen Anfang
  std::unique_ptr<cdj::WarpWerk> werk;        // Slice 2: das Warp-Werk (mit_werk), vor den Schnappschüssen abgebaut
  uint32_t gen = 1;                           // Slice 2: Karten-Generation (mit_werk hängt sie ans Arrangement); wer die Karte ändert, erhöht sie
  ~Treiber() {
    if (werk) werk->stoppe();
    for (const cdj::ArrSnapshot* x : alt) delete x;
    delete arr.snapshot();
  }
  // Slice 2: das Werk dazu; faeden 0 = synchron (deterministisch, wie der Render), sonst Arbeitsfäden. false: ohne Bungee gebaut.
  bool mit_werk(int faeden = 0) {
    werk = cdj::warp_werk_neu({faeden});
    if (!werk) return false;
    arr.setze_warp_werk(werk.get());
    arr.setze_karten_generation(&gen);
    return true;
  }
  void laden(cdj::ArrSnapshot* neu) {
    if (const cdj::ArrSnapshot* a = arr.tausche(neu, s, k)) alt.push_back(a);
  }
  void lauf(int64_t bis) {
    float b[6][cdj::ARR_BLOCK];
    while (s < bis) {
      for (auto& x : b) std::fill(x, x + n, 0.0f);
      for (PruefSenke* p : senken) p->block_s0 = s;
      arr.block(k, s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
      l.insert(l.end(), b[0], b[0] + n);
      r.insert(r.end(), b[1], b[1] + n);
      ml.insert(ml.end(), b[2], b[2] + n);
      mr.insert(mr.end(), b[3], b[3] + n);
      cl.insert(cl.end(), b[4], b[4] + n);
      cr.insert(cr.end(), b[5], b[5] + n);
      pml.insert(pml.end(), arr.pm_l(), arr.pm_l() + n);
      pmr.insert(pmr.end(), arr.pm_r(), arr.pm_r() + n);
      s += n;
    }
  }
  std::vector<int64_t> treffer(int64_t von, int64_t bis, float schwelle = 1e-6f) const {   // Samples mit |l| > schwelle
    std::vector<int64_t> t;
    for (int64_t i = von; i < bis && i < static_cast<int64_t>(l.size()); ++i)
      if (std::fabs(l[i]) > schwelle) t.push_back(i);
    return t;
  }
};

}  // namespace arrtest
