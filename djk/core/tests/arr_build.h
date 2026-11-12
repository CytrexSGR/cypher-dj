// D1 K1: Prüfaufbau für das Modul Arrangement ohne Lader und ohne Kern. Schnappschüsse entstehen im Speicher (Bau),
// Audio liegt im Test (kein mmap): ein Impuls hat 1.0 auf Frame 0, so liegt sein Einsatz am Ausgang genau auf dem
// Sample, an dem der Clip einsetzt. Der Treiber fährt das Modul mit einer Karte bei 128 BPM (22 500 Samples je Beat)
// in Blöcken von n Samples und schreibt Summe und Metronom-Ausgänge mit (Index = Kern-Sample).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <initializer_list>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "cypherdj/arrangement.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_key.h"
#include "cypherdj/warp_factory.h"

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
  struct C { int spur; cdj::ArrClip c; std::vector<double> wb, wf; int wm = 0; double wp = 1.0; std::vector<double> eb, ef; int lp = 0, hu = 100; std::vector<cdj::ArrAutoPunkt> hk; };   // wb, wf: Warp-Marker des Clips (Paket 1.13), leer = ungewarpt; wm: Modus (0 repitch, 2 complex, 3 tones)
  struct N { int spur; cdj::ArrNote n; };
  std::vector<C> cs;
  std::vector<N> ns;
  struct L { int spur; std::vector<cdj::ArrAutoPunkt> p; uint8_t ziel = cdj::ARR_AUTO_FADER; uint8_t param = 0; bool relativ = false; };   // Automation: one lane of a track (default target fader)
  std::vector<L> ls;
  struct KL { int strip; int stufe, param, makro; std::vector<cdj::ArrAutoPunkt> p; };   // 1.12 slice 6: an insert-parameter or rack-macro lane of the strip with this chain index
  std::vector<KL> kls;
  explicit Bau(int64_t nr = 1) { s->nr = nr; }
  Bau& spur(int nr, cdj::ArrArt art, int slot = 0) {
    s->spur[nr - 1].nr = nr;
    s->spur[nr - 1].art = art;
    s->spur[nr - 1].slot = slot;
    return *this;
  }
  Bau& gruppe_ausgang(int g, int eltern) { s->gruppe_ausgang[g - 1] = static_cast<int8_t>(eltern); return *this; }   // nested groups: group g outputs into group `eltern` (0 = master)
  Bau& ausgang(int nr, int gruppe) { s->spur[nr - 1].ausgang = static_cast<int8_t>(gruppe); return *this; }   // 1.10: 0 master, 1..8 Gruppe
  // 1.10 slice 4a: the insert chain of a strip (tracks 1..32 by nr, groups by grp(g)); the stages in order, slot 0-based
  Bau& kette(int nr, std::initializer_list<cdj::ArrStufe> st) { return kette_streifen(nr - 1, st); }
  Bau& gruppen_kette(int g, std::initializer_list<cdj::ArrStufe> st) { return kette_streifen(cdj::ARR_SPUREN + g - 1, st); }
  Bau& ret_kette(int r, std::initializer_list<cdj::ArrStufe> st) { return kette_streifen(cdj::ARR_KETTE_RET0 + r - 1, st); }   // slice 4a T3
  Bau& pm_kette(std::initializer_list<cdj::ArrStufe> st) { return kette_streifen(cdj::ARR_KETTE_PM, st); }
  Bau& kette_streifen(int idx, std::initializer_list<cdj::ArrStufe> st) {
    cdj::ArrKette& k = s->kette[idx];
    k.n = 0;
    for (const cdj::ArrStufe& x : st) k.st[k.n++] = x;
    return *this;
  }
  // 1.10 slice 4c T15: the rack of a strip (0-based pool slot) with its mapping table; strip numbering as the chains
  Bau& rack(int nr, int slot, std::initializer_list<cdj::ArrMakroZiel> z) { return rack_streifen(nr - 1, slot, z); }
  Bau& rack_streifen(int idx, int slot, std::initializer_list<cdj::ArrMakroZiel> z) {
    cdj::ArrRack& r = s->rack[idx];
    r.slot = static_cast<int8_t>(slot);
    r.n = 0;
    for (const cdj::ArrMakroZiel& x : z) r.z[r.n++] = x;
    return *this;
  }
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
  // 1.12 slice 5 (U8a): hängt dem zuletzt hinzugefügten Clip eine Gain-Hüllkurve an: Punkte (Clip-Beat der Kopie, dB -200..0, Form 0 linear, 1 s, 2 Sprung), Beats nicht fallend
  Bau& hk(std::vector<cdj::ArrAutoPunkt> p) {
    cs.back().hk = std::move(p);
    return *this;
  }
  // Automation: a lane on track nr; points (beat, wert in the unit of the target, form 0 linear, 1 s, 2 jump), beats not falling. ziel is one of cdj::ARR_AUTO_*
  // (default fader), param the device parameter index for ARR_AUTO_GERAET. Several lanes per track keep the call order.
  Bau& lane(int nr, std::vector<cdj::ArrAutoPunkt> p, uint8_t ziel = cdj::ARR_AUTO_FADER, uint8_t param = 0, bool relativ = false) {
    ls.push_back({nr, std::move(p), ziel, param, relativ});
    return *this;
  }
  // 1.12 slice 6: a lane on stage `stufe` parameter `param` of the strip with chain index `strip` (track nr - 1, group ARR_SPUREN + g - 1, PM ARR_KETTE_PM, return ARR_KETTE_RET0 + r - 1)
  Bau& kette_lane(int strip, int stufe, int param, std::vector<cdj::ArrAutoPunkt> p) { kls.push_back({strip, stufe, param, -1, std::move(p)}); return *this; }
  // the same for macro `makro` (0..3) of the rack of that strip
  Bau& makro_lane(int strip, int makro, std::vector<cdj::ArrAutoPunkt> p) { kls.push_back({strip, 0, 0, makro, std::move(p)}); return *this; }
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
    size_t n_ap = 0;
    for (const L& l : ls) n_ap += l.p.size();
    for (const KL& l : kls) n_ap += l.p.size();
    s->auto_lane_liste.reserve(ls.size());   // Automation Slice 1: pointers into these vectors, they never grow afterwards
    s->auto_punkte.reserve(n_ap);
    size_t n_hk = 0;
    for (const C& c : cs) n_hk += c.hk.size();
    s->hk_punkte.reserve(n_hk);       // 1.12 slice 5: ArrClip::hk zeigt hinein, wie im Lader vorab reserviert
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
          if (!c.hk.empty()) {
            const size_t h0 = s->hk_punkte.size();
            s->hk_punkte.insert(s->hk_punkte.end(), c.hk.begin(), c.hk.end());
            x.hk = s->hk_punkte.data() + h0;
            x.hk_n = static_cast<int>(c.hk.size());
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
      for (const L& l : ls)
        if (l.spur == nr) {
          const size_t p0 = s->auto_punkte.size();
          s->auto_punkte.insert(s->auto_punkte.end(), l.p.begin(), l.p.end());
          cdj::ArrAutoLane al{};
          al.ziel = l.ziel;
          al.param = l.param;
          al.n = static_cast<int>(l.p.size());
          al.p = s->auto_punkte.data() + p0;
          al.relativ = l.relativ;
          s->auto_lane_liste.push_back(al);
          if (sp.n_auto == 0) sp.auto_lanes = s->auto_lane_liste.data() + (s->auto_lane_liste.size() - 1);
          ++sp.n_auto;
          ++s->n_auto_lanes;
        }
    }
    for (const KL& l : kls) {   // 1.12 slice 6: the insert and rack lanes behind the track lanes
      const size_t p0 = s->auto_punkte.size();
      s->auto_punkte.insert(s->auto_punkte.end(), l.p.begin(), l.p.end());
      cdj::ArrKettenLane kl{};
      kl.strip = static_cast<uint8_t>(l.strip);
      kl.makro = static_cast<int8_t>(l.makro);
      kl.stufe = static_cast<uint8_t>(l.stufe);
      kl.param = static_cast<uint8_t>(l.param);
      kl.n = static_cast<int>(l.p.size());
      kl.p = s->auto_punkte.data() + p0;
      s->klane[s->n_klanes++] = kl;
    }
    for (const C& c : cs)   // Slice 2: jedes genutzte Audio genau einmal (wie der Lader; das Warp-Werk fragt danach in liest())
      if (std::find(s->audios.begin(), s->audios.end(), c.c.audio) == s->audios.end()) s->audios.push_back(const_cast<cdj::ArrAudio*>(c.c.audio));
    cdj::arr_gruppen_rechnen(*s);   // nested groups: levels and order from gruppe_ausgang (the loader does this before the key check); a cycle leaves the flat defaults
    cdj::arr_schluessel_rechnen(*s);   // slice 5 U1: the track order over the post keys (the loader does this too); a cycle leaves the identity and is the loader's refusal
    cdj::arr_pdc_rechnen(*s);   // the loader does this once the routing is complete; a test that sets ret_da afterwards calls it again
    cdj::arr_schluessel_versatz(*s);   // slice 5 U2b: the key delays against the PDC table just computed (the loader does this too); a test that calls arr_pdc_rechnen again calls it again
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
  // On the heap: the Arrangement is about 2 MB since 16 groups (arr_ausgang per-group arrays), and tests keep several drivers in one frame (8 MB stack)
  std::unique_ptr<cdj::Arrangement> arr_heap{std::make_unique<cdj::Arrangement>(tab)};
  cdj::Arrangement& arr{*arr_heap};
  int n = 256;
  int64_t s = 0;
  std::vector<float> l, r, ml, mr, cl, cr;
  std::vector<float> pml, pmr;                // PM-Abgriff je Block (1.10)
  std::vector<const cdj::ArrSnapshot*> alt;   // abgelöste Schnappschüsse (am Ende freigegeben)
  std::vector<PruefSenke*> senken;            // bekommen vor jedem Block dessen Anfang
  std::unique_ptr<cdj::WarpWerk> werk;        // Slice 2: das Warp-Werk (mit_werk), vor den Schnappschüssen abgebaut
  uint32_t gen = 1;                           // Slice 2: Karten-Generation (mit_werk hängt sie ans Arrangement); wer die Karte ändert, erhöht sie
  std::function<void(int64_t)> vor_block;     // slice 5 U2b: called with the first sample of every block just before arr.block() (a test hands the DJ inputs here, Arrangement::dj_schluessel)
  // slice 5 U2b: DJ inputs as signals indexed by kern sample (0..3 = deck/1..4, 4 = erz/1; both channels equal). An empty signal is a nullptr (silent input). dj_sig_an = false: no call at all.
  std::vector<float> dj_sig[cdj::Arrangement::DJ_EINGAENGE];
  bool dj_sig_an = false;
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
      if (vor_block) vor_block(s);
      if (dj_sig_an) {
        const float* dl[cdj::Arrangement::DJ_EINGAENGE];
        for (int i = 0; i < cdj::Arrangement::DJ_EINGAENGE; ++i)
          dl[i] = !dj_sig[i].empty() && s + n <= static_cast<int64_t>(dj_sig[i].size()) ? dj_sig[i].data() + s : nullptr;
        arr.dj_schluessel(dl, dl);
      }
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
