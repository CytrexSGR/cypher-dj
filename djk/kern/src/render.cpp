// Paket K3 (Spec D1 2.5, 6.20, 6.24): Offline-Render (render.h). Treibt Kern::zyklus wie der Callback, liest den Master aus dem
// eigenen Ring wie die Notbahn und gibt abgelöste Schnappschüsse selbst frei. Allokiert: nur außerhalb jedes Callbacks.
#include "cypherdj/render.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>

#include <nlohmann/json.hpp>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/kern.h"
#include "cypherdj/lader.h"
#include "cypherdj/ring.h"
#include "cypherdj/stellwerk/regler.h"

namespace cdj {

namespace {

RenderErgebnis abbruch(const char* fehler, std::string meldung) {
  RenderErgebnis e;
  e.fehler = fehler;
  e.meldung = std::move(meldung);
  return e;
}

}  // namespace

// Mixer-Regler des Projekts: spur/<n>/…, grp/<n>/… und pm/fader (die Tabelle prüft Name, Bereich und Ganzzahligkeit)
static bool mixer_pfad(const std::string& p) { return p.compare(0, 5, "spur/") == 0 || p.compare(0, 4, "grp/") == 0 || p == "pm/fader"; }

RenderErgebnis rendere(const RenderAuftrag& a) {
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_OBERGRENZE
  const bool zu_lang = false;   // Fehlerfall L3: keine Obergrenze, 1e9 Beats laufen bis zum bad_alloc
#else
  const bool zu_lang = !(a.bis_beat - a.von_beat <= RENDER_MAX_BEATS);   // Fix L3
#endif
  if (!(a.von_beat >= 0.0) || !(a.bis_beat - a.von_beat >= 1.0) || zu_lang || !(a.bpm >= 60.0 && a.bpm <= 200.0) ||
      a.quantum < 16 || a.quantum > MAX_BLOCK || a.nr < 0)
    return abbruch("aufruf", "von >= 0, bis - von 1..2048 Beats, bpm 60..200, quantum 16..8192, nr >= 0");
  SpeicherKonto konto(a.speicher_budget_bytes);
  ArrAudioCache cache(&konto, a.arr_budget_bytes, false);
  ArrLadeErgebnis w = lade_wiedergabe(a.arr_ordner, a.nr, cache);
  if (!w.snap) return abbruch(w.grund.c_str(), w.meldung);
  auto weg = [&](const char* fehler, std::string meldung) {
    gib_wiedergabe(w.snap.release(), cache);
    return abbruch(fehler, std::move(meldung));
  };
  for (const ArrSpur& sp : w.snap->spur)
    if (sp.art == ArrArt::wirt)
      return weg("wirt_nicht_eingefroren", "Spur " + std::to_string(sp.nr) + " ist eine Wirt-Spur (erst einfrieren)");
  if (a.gegenprobe_spur != 0) {
    if (a.gegenprobe_spur < 1 || a.gegenprobe_spur > ARR_SPUREN)
      return weg("gegenprobe", "Spur 1.." + std::to_string(ARR_SPUREN));
    const ArrSpur& sp = w.snap->spur[a.gegenprobe_spur - 1];
    if (sp.art != ArrArt::audio || sp.n_clips == 0) return weg("gegenprobe", "Spur ohne Audio-Clips");
    for (int i = 0; i < sp.n_clips; ++i) {
      auto* c = const_cast<ArrClip*>(&sp.clips[i]);   // zeigt in w.snap->clips (veränderlich, noch nicht im Kern)
      if (c->warp) {   // Paket 1.13: ein gewarpter Clip liest nicht über offset_frames; alle Marker ein Frame weiter in der Quelle
#ifndef CYPHERDJ_MUTATION_RENDER_GEGENPROBE_WARP_BLIND   // Fehlerfall: die Gegenprobe fasst einen Warp nicht an, bleibt also gleich (blind)
        auto* wf = const_cast<double*>(c->warp->frame);   // zeigt in w.snap->warp_frame (ein Bereich je Clip)
        for (int j = 0; j < c->warp->n; ++j) wf[j] += 1.0;
#endif
        continue;
      }
      if (c->offset_frames + 1 >= c->audio->frames) return weg("gegenprobe", "Clip ohne Platz für 1 Frame");
      c->offset_frames += 1;
    }
  }
  auto ring_mem = std::make_unique<unsigned char[]>(CDJ_RING_BYTES);
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(ring_mem.get());
  std::memset(ring, 0, CDJ_RING_KOPF);
  ring->version = CDJ_RING_VERSION;
  ring->rate = CDJ_RING_RATE;
  ring->kanaele = CDJ_RING_KANAELE;
  ring->cap = CDJ_RING_CAP;
  std::memcpy(ring->magic, "CDJB", 4);
  auto bef = std::make_unique<Befehlsring>();
  auto ere = std::make_unique<Ereignisring>();
  auto lr = std::make_unique<LaderRinge>();
  auto kern = std::make_unique<Kern>(a.bpm, ring, bef.get(), ere.get());
  kern->verbinde_lader(lr.get());
  kern->setze_pruefmodus(false);
  kern->sperre_metronom(true);   // Spec 2.6: im Render immer aus
  kern->setze_filter_guete(a.filter_guete);
  kern->setze_limiter_dbtp(a.limiter_dbtp);
  if (a.senke_intern) kern->setze_arr_senke_intern(a.senke_intern);
  RenderErgebnis e;
  if (a.regler) {
    e.regler = kern->regler_uebernehmen(*a.regler);
    e.regler_quelle = "kern";
  } else if (a.regler_projekt) {   // Spec 6.20: wie ein frisch gestarteter Kern, erz/4 neutral, darüber das Projekt
#ifndef CYPHERDJ_MUTATION_RENDER_ERZ4_NICHT_NEUTRAL
    kern->regler_setzen("erz/4/fader", 0.0f);   // 2.3: Fader 0 dB; Trim, EQ, Kill, Filter, Komp, Ziel, xseite und Sends
#endif                                          // (−200) stehen schon auf der Vorgabe
    for (const SpurRegler& sr : a.spur_regler) {
      if (!mixer_pfad(sr.pfad) || !kern->regler_setzen(sr.pfad.c_str(), sr.wert)) {
        if (const ArrSnapshot* rest = kern->arrangement().snapshot()) gib_wiedergabe(const_cast<ArrSnapshot*>(rest), cache);
        gib_wiedergabe(w.snap.release(), cache);
        return abbruch("regler", sr.pfad + " = " + std::to_string(sr.wert) + " ist kein Mixer-Regler (spur, grp, pm/fader) in seinen Grenzen");
      }
      ++e.regler;
    }
    e.regler_quelle = "projekt";
  }
  e.vorhalt = kern->mixer().limiter_vorhalt();
  Befehl b{};
  b.art = Befehl::ARR_LADEN;
  b.id = 1;
  std::snprintf(b.quelle, sizeof b.quelle, "andreas");
  b.zeiger = w.snap.release();
  b.arr_nr = a.nr;
  bef->schiebe(b);
  Befehl s{};
  s.art = Befehl::ARR_START;
  s.id = 2;
  std::snprintf(s.quelle, sizeof s.quelle, "andreas");
  s.ab_beat = a.von_beat;
  s.politik = 0;
  bef->schiebe(s);
  const int n = a.quantum;
  const int64_t grenze = 4LL * n + 25;   // der Einsatz liegt bei 3n + 25 (Quittung 2 im vierten Zyklus)
  const bool pm = a.abgriff == RenderAbgriff::produktion;   // 1.10 Slice 2 (E2)
  e.abgriff = pm ? "produktion" : "set";
  int64_t ab = -1;                       // Kern-Sample des ersten Export-Werts (Master: plus Vorhalt; Abgriff: der Einsatz selbst)
  while (true) {
    const int64_t n0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring->w);
    kern->zyklus(n, n0 * 20833);
    Ereignis x;
    while (ere->hole(x)) {
      if (x.art == Ereignis::ARR_ALT)
        gib_wiedergabe(static_cast<ArrSnapshot*>(const_cast<void*>(x.zeiger)), cache);
      if (x.art != Ereignis::QUITTUNG) continue;
      if (x.status == 6) {
        e.fehler = "abgelehnt";
        e.meldung = std::string("Quittung 6, Grund ") + x.grund;
      }
      if (x.id == 2 && x.status == 2) e.start_sample = x.sample;
    }
    if (!e.fehler.empty()) break;
    if (e.start_sample < 0) {
      if (n0 > grenze) {
        e.fehler = "kein_einsatz";
        e.meldung = "keine Quittung 2 bis Sample " + std::to_string(n0);
        break;
      }
      continue;
    }
    if (ab < 0) {
      const Karte& k = kern->karte();
      const double urs = k.beat_at(static_cast<double>(e.start_sample));
      e.frames = std::llround(k.sample_at(urs + (a.bis_beat - a.von_beat))) - e.start_sample;
      e.phase = static_cast<int>(e.start_sample % n);
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_VORHALT
      ab = e.start_sample;   // Fehlerfall: Master ohne den Vorhalt des Limiters ausgerichtet
#else
      ab = pm ? e.start_sample : e.start_sample + e.vorhalt;   // der PM-Abgriff liegt um den Vorhalt vor dem Ring-Master
#endif
      e.l.assign(static_cast<size_t>(e.frames), 0.0f);
      e.r.assign(static_cast<size_t>(e.frames), 0.0f);
    }
    const float* d = cdj_ring_daten_c(ring);
    const float* pl = kern->pm_abgriff_l();
    const float* pr = kern->pm_abgriff_r();
    for (int i = 0; i < n; ++i) {
      const int64_t j = n0 + i - ab;
      if (j < 0 || j >= e.frames) continue;
      float l, r;
      if (pm) {
        l = pl[i];
        r = pr[i];
      } else {
        const uint64_t f = (w0 + static_cast<uint64_t>(i)) % CDJ_RING_CAP;
        l = d[f * 4 + 0];
        r = d[f * 4 + 1];
      }
      e.l[static_cast<size_t>(j)] = l;
      e.r[static_cast<size_t>(j)] = r;
      e.spitze = std::max(e.spitze, std::max(std::fabs(l), std::fabs(r)));
    }
    if (n0 + n >= ab + e.frames) break;
  }
  if (const ArrSnapshot* rest = kern->arrangement().snapshot()) gib_wiedergabe(const_cast<ArrSnapshot*>(rest), cache);
  e.limiter_db_max = std::max(0.0f, -kern->limiter_db_min());   // positive Zahl; max statt Vorzeichenwechsel, damit „griff nie ein“ +0 ist, nicht −0
  e.ueber_decke = e.spitze > static_cast<float>(std::pow(10.0, a.limiter_dbtp / 20.0));
  return e;
}

}  // namespace cdj

namespace cdj {

bool lies_spur_regler(const std::string& pfad, std::vector<SpurRegler>& aus, std::string& fehler) {
  aus.clear();
  std::ifstream f(pfad);
  if (!f) {
    fehler = pfad + ": fehlt oder nicht lesbar";
    return false;
  }
  nlohmann::json j;
  try {
    j = nlohmann::json::parse(f);
  } catch (const nlohmann::json::exception& x) {
    fehler = pfad + ": kein JSON (" + x.what() + ")";
    return false;
  }
  if (!j.is_object()) {
    fehler = pfad + ": kein JSON-Objekt Pfad -> Wert";
    return false;
  }
  const cypherdj::stellwerk::ReglerTabelle tab;
  for (auto it = j.begin(); it != j.end(); ++it) {
    const std::string& p = it.key();
    const int r = mixer_pfad(p) ? tab.suche(p.c_str()) : -1;
    if (r < 0) {
      fehler = pfad + ": " + p + " ist kein Mixer-Regler (spur/<1.." + std::to_string(ARR_SPUREN) + ">, grp/<1.." + std::to_string(ARR_GRUPPEN) +
               ">/{fader,pan,mute,solo}, pm/fader)";
      return false;
    }
    if (!it.value().is_number()) {
      fehler = pfad + ": " + p + " ist keine Zahl";
      return false;
    }
    const double v = it.value().get<double>();
    const cypherdj::stellwerk::ReglerDef& d = tab.def(r);
    if (!std::isfinite(v) || v < d.min || v > d.max || (d.ganzzahlig && v != std::floor(v))) {
      fehler = pfad + ": " + p + " = " + std::to_string(v) + " außerhalb " + std::to_string(d.min) + ".." +
               std::to_string(d.max) + (d.ganzzahlig ? " (ganzzahlig)" : "");
      return false;
    }
    aus.push_back({p, static_cast<float>(v)});
  }
  return true;
}

}  // namespace cdj
