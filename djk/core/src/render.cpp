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

#include "cypherdj/arr_playback.h"
#include "cypherdj/core.h"
#include "cypherdj/loader.h"
#include "cypherdj/ring.h"
#include "cypherdj/signalbox/controls.h"
#include "cypherdj/warp_factory.h"

namespace cdj {

namespace {

RenderErgebnis abbruch(const char* fehler, std::string meldung) {
  RenderErgebnis e;
  e.fehler = fehler;
  e.meldung = std::move(meldung);
  return e;
}

}  // namespace

// Mixer controls of the project: spur/<n>/… (also the sends), grp/<n>/… (also the sends), ret/<r>/… (return fader, pan, mute, solo, hall) and pm/fader
// (the table checks name, range and integer-ness); 1.10 slice 4a: and ins/… (the insert stages ins/komp/<n>/…, the table knows which exist)
constexpr int64_t RENDER_EINSCHWINGEN = 48000;   // samples the stages run on silence before the transport starts (a second: the EQ smoothing has converged to double precision)

static bool mixer_pfad(const std::string& p) {
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_INS
  const bool ins = false;   // error case: an insert row is no mixer control of the render, the export has no inserts
#else
  const bool ins = p.compare(0, 4, "ins/") == 0;
#endif
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_RACK_PFAD
  const bool rack = false;   // error case: a rack macro row is no mixer control of the render, the export refuses it with `regler`
#else
  const bool rack = p.compare(0, 5, "rack/") == 0;   // 1.10 slice 4c: the macro rows rack/<k>/m<n>, the table knows which exist
#endif
  return p.compare(0, 5, "spur/") == 0 || p.compare(0, 4, "grp/") == 0 || p.compare(0, 4, "ret/") == 0 || ins || rack || p == "pm/fader";
}

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
#ifndef CYPHERDJ_MUTATION_RENDER_OHNE_BK_ORDNER
  cache.setze_bk_ordner(a.bk_ordner);   // S20: graphs of the bk tracks, read by the loader (never in the callback)
#endif
#ifndef CYPHERDJ_MUTATION_RENDER_OHNE_KIT_ORDNER
  cache.setze_kit_ordner(a.kit_ordner);   // 1.9: kits of the kit tracks, read by the loader (never in the callback)
  cache.setze_kit_lader(&lade_kit);
#endif
  ArrLadeErgebnis w = lade_wiedergabe(a.arr_ordner, a.nr, cache);
  if (!w.snap) return abbruch(w.grund.c_str(), w.meldung);
  auto weg = [&](const char* fehler, std::string meldung) {
    gib_wiedergabe(w.snap.release(), cache);
    return abbruch(fehler, std::move(meldung));
  };
  for (const ArrSpur& sp : w.snap->spur) {
    if (sp.art == ArrArt::wirt)
      return weg("wirt_nicht_eingefroren", "Spur " + std::to_string(sp.nr) + " ist eine Wirt-Spur (erst einfrieren)");
#ifndef CYPHERDJ_MUTATION_RENDER_RACK_OHNE_SURGE_PRUEFUNG   // error case (1.9 U6): a rack track with a Surge member is not refused, the render would play it silent
    if (sp.art == ArrArt::rack)   // 1.9 U6: a rack with a Surge member is a Wirt track in disguise: the render has no host to play it
      for (int i = 0; i < sp.n_glieder; ++i)
        if (sp.glied[i].art == ArrArt::wirt)
          return weg("wirt_nicht_eingefroren", "Spur " + std::to_string(sp.nr) + " ist ein Rack mit Surge-Glied (erst einfrieren)");
#endif
  }
  if (a.gegenprobe_spur != 0) {
    if (a.gegenprobe_spur < 1 || a.gegenprobe_spur > ARR_SPUREN)
      return weg("gegenprobe", "Spur 1.." + std::to_string(ARR_SPUREN));
    const ArrSpur& sp = w.snap->spur[a.gegenprobe_spur - 1];
    if (sp.art != ArrArt::audio || sp.n_clips == 0) return weg("gegenprobe", "Spur ohne Audio-Clips");
    for (int i = 0; i < sp.n_clips; ++i) {
      auto* c = const_cast<ArrClip*>(&sp.clips[i]);   // zeigt in w.snap->clips (veränderlich, noch nicht im Kern)
      if (c->warp) {   // Paket 1.13: ein gewarpter Clip liest nicht über offset_frames; alle Marker ein Frame weiter in der Quelle (BEATS: auch die Einheiten)
#ifndef CYPHERDJ_MUTATION_RENDER_GEGENPROBE_WARP_BLIND   // Fehlerfall: die Gegenprobe fasst einen Warp nicht an, bleibt also gleich (blind)
        auto* wf = const_cast<double*>(c->warp->frame);   // zeigt in w.snap->warp_frame (ein Bereich je Clip)
        for (int j = 0; j < c->warp->n; ++j) wf[j] += 1.0;
#endif
#ifndef CYPHERDJ_MUTATION_RENDER_GEGENPROBE_BEATS_BLIND   // Fehlerfall (Slice 4): die Gegenprobe fasst die Einheiten eines BEATS-Clips nicht an (BEATS liest sie, nicht die Marker): blind
        if (c->warp->modus == ARR_WARP_BEATS) {
          auto* ef = const_cast<double*>(c->warp->e_frame);   // zeigt in w.snap->warp_frame hinter den Markern des Clips
          for (int j = 0; j < c->warp->e_n; ++j) ef[j] += 1.0;
        }
#endif
        continue;
      }
      if (c->offset_frames + 1 >= c->audio->frames) return weg("gegenprobe", "Clip ohne Platz für 1 Frame");
      c->offset_frames += 1;
    }
  }
  if (a.gegenprobe_auto) {
    if (w.snap->n_auto_lanes == 0) return weg("gegenprobe", "keine Lane");
#ifndef CYPHERDJ_MUTATION_RENDER_GEGENPROBE_AUTO_BLIND   // error case (Automation Slice 1): the counter-check does not touch a lane, so it stays equal (blind)
    const double schritt = a.bpm / 60.0 / 48000.0;   // beats of one sample at the constant tempo of the render
    for (ArrAutoPunkt& pt : w.snap->auto_punkte) pt.beat += schritt;   // the points are in w.snap (not yet in the core), changeable like warp_frame
#endif
  }
  // 1.13 Slice 2: gewarpte Clips in COMPLEX oder TONES rechnet das Warp-Werk, im Render synchron (kein Faden): takt() füllt die Ringe im Zyklus, derselbe Strom wie
  // live (Spec 5.3 „Render“). Es entsteht vor dem Kern und stirbt nach ihm.
  std::unique_ptr<WarpWerk> werk;
  {
    bool braucht = false;
    for (const ArrSpur& sp : w.snap->spur)
      for (int i = 0; sp.art == ArrArt::audio && i < sp.n_clips; ++i) braucht = braucht || (sp.clips[i].warp && arr_warp_werk_modus(sp.clips[i].warp->modus));
    if (braucht) {
      werk = warp_werk_neu({});
      if (!werk) return weg("warp_maschine_fehlt", "die Wiedergabe enthält COMPLEX oder TONES, dieser Bau hat kein Bungee");
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
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_SCHRITT_NUR_LIVE
  kern->setze_arr_auto_schritt(1);   // error case (Automation Slice 1): the render evaluates every sample, the live run holds 16
#endif
  kern->setze_filter_guete(a.filter_guete);
  kern->setze_limiter_dbtp(a.limiter_dbtp);
  kern->setze_kanal_limiter(a.kanal_limiter_vorhalt_ms, a.kanal_limiter_echtspitze);   // 1.15 A5b: built like live, so the export has the same latency account
  if (a.senke_intern) kern->setze_arr_senke_intern(a.senke_intern);
  cache.setze_kit_leser(kern->arr_kit_leser());   // 1.9: the store frees a Kit only when the kit sink no longer plays it
  cache.setze_bk_leser(kern->arr_bk_leser());   // S20: the store frees a graph instance only when the bk sink no longer plays it
  if (werk) kern->setze_arr_warp_werk(werk.get());
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
        return abbruch("regler", sr.pfad + " = " + std::to_string(sr.wert) + " ist kein Mixer-Regler (spur, grp, ret, ins, pm/fader) in seinen Grenzen");
      }
      ++e.regler;
    }
    e.regler_quelle = "projekt";
  }
  // 1.10 T9 (AK24): the render-only key mask (arr_output.cpp). The ids are checked before the kern runs: a malformed one is the caller's error, a strip that does not
  // exist is ignored (it has no key to feed).
  for (const std::string& id : a.nur_schluessel) {
    const size_t sl = id.find('/');
    const size_t dp = id.find(':');
    const std::string art = id.substr(0, sl);
    const std::string num = sl == std::string::npos ? "" : id.substr(sl + 1, dp == std::string::npos ? std::string::npos : dp - sl - 1);
    const std::string suf = dp == std::string::npos ? "" : id.substr(dp + 1);
    int n = 0;
    bool ok = !num.empty() && num.size() <= 4 && (suf.empty() || suf == "ziel" || suf == "sends") && (art == "spur" || art == "grp" || art == "ret");
    for (char c : num) ok = ok && c >= '0' && c <= '9';
    if (ok) n = std::stoi(num);
    if (!ok) {
      if (const ArrSnapshot* rest = kern->arrangement().snapshot()) gib_wiedergabe(const_cast<ArrSnapshot*>(rest), cache);
      gib_wiedergabe(w.snap.release(), cache);
      return abbruch("aufruf", "nur_schluessel: " + id + " is not spur/<n>, grp/<n> or ret/<n> with an optional :ziel or :sends");
    }
    const int max = art == "spur" ? ARR_SPUREN : art == "grp" ? ARR_GRUPPEN : ARR_RETURNS;
    if (n < 1 || n > max) continue;   // a source that does not exist
    const int streifen = art == "spur" ? n - 1 : art == "grp" ? ARR_SPUREN + n - 1 : ARR_RET0 + n - 1;
    kern->setze_arr_nur_schluessel(streifen, suf != "ziel", suf != "sends");   // bare: both off; ":ziel" keeps the target; ":sends" keeps the sends
  }
  if (a.trocken_aus) kern->setze_arr_trocken_aus();   // 1.10 T10: the wet signal only (arr_output.cpp); the flag is the render's alone
#ifndef CYPHERDJ_MUTATION_ARR_RENDER_OHNE_HALL_SOFORT
  kern->hall_sofort();   // 1.10 slice 3 (P8 a): the return Halls start on the controls of the project, as playback does, before block 0
#endif
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_KANAL_LATENZ   // error case (1.15 A5b): the export is aligned with the master limiter's look-ahead only
  e.vorhalt = kern->mixer().limiter_vorhalt();
#else
  e.vorhalt = kern->mixer().limiter_vorhalt() + kern->mixer().kanal_latenz();   // the whole mix is L samples later when the bus limiters are built (D8)
#endif
  // 1.10 slice 4b T14 (AK-S4-10): a project with insert stages is loaded some blocks before the transport starts, and the module smoothing of an EQ band (about 15 ms per time
  // constant) is still running when the music begins; how far depends on the quantum (3 blocks of 128 are shorter than 3 blocks of 256). The start waits for the smoothing to
  // settle: the stages run on silence for RENDER_EINSCHWINGEN samples first, so the file does not depend on the quantum. A project without a stage starts at once, as before.
  bool mit_stufen = false;
  for (const ArrKette& k : w.snap->kette) mit_stufen = mit_stufen || k.n > 0;
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_EINSCHWINGEN
  mit_stufen = false;   // error case: the transport starts a few blocks after the load whatever the stages are
#endif
  const int64_t vorlauf_samples = mit_stufen ? RENDER_EINSCHWINGEN : 0;
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
  const int n = a.quantum;
  const int64_t vorlauf_zyklen = (vorlauf_samples + n - 1) / n;   // cycles between the load and the start command
  int64_t zyklen = 0;
  const int64_t grenze = vorlauf_zyklen * n + 4LL * n + 25 + (werk ? ARR_WARP_FRIST : 0);   // der Einsatz liegt bei 3n + 25 (Quittung 2 im vierten Zyklus), mit Warp-Werk um ARR_WARP_FRIST später (Start-Regel)
  const bool pm = a.abgriff == RenderAbgriff::produktion;   // 1.10 Slice 2 (E2)
  e.abgriff = pm ? "produktion" : "set";
  int64_t ab = -1;                       // Kern-Sample des ersten Export-Werts (Master: plus Vorhalt; Abgriff: der Einsatz selbst)
  while (true) {
    if (zyklen == vorlauf_zyklen) bef->schiebe(s);   // with no stage this is before the first cycle, as the start always was
    ++zyklen;
    const int64_t n0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring->w);
    kern->zyklus(n, n0 * 20833);
    Ereignis x;
    while (ere->hole(x)) {
      if (x.art == Ereignis::ARR_ALT) {
        gib_wiedergabe(static_cast<ArrSnapshot*>(const_cast<void*>(x.zeiger)), cache);
        cache.kit_nachholen();   // 1.9: the same for Kits
        cache.bk_nachholen();   // S20: free graph instances whose last snapshot just went and that the sink has let go of
      }
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
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_PDC_VORHALT
      e.pdc_latenz = 0;   // error case: the export does not skip the latency of the insert chains, the music sits that many samples late in the file
#else
      e.pdc_latenz = kern->arrangement().pdc_latenz();   // 1.10 slice 4b T13: the production sounds the largest path latency after the transport; the file starts there
#endif
#ifdef CYPHERDJ_MUTATION_RENDER_OHNE_VORHALT
      ab = e.start_sample + e.pdc_latenz;   // Fehlerfall: Master ohne den Vorhalt des Limiters ausgerichtet
#else
      ab = (pm ? e.start_sample : e.start_sample + e.vorhalt) + e.pdc_latenz;   // der PM-Abgriff liegt um den Vorhalt vor dem Ring-Master
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
  e.hall_start_alt = kern->arrangement().returns().start_alt();
  for (int r = 0; r < ARR_RETURNS; ++r) e.hall_decay[r] = kern->arrangement().returns().angewendet(r)[1];
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
               ">/{fader,pan,mute,solo,send/<r>}, ret/<r>/…, ins/{komp,eq,saett,lim}/<n>/…, pm/fader)";
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
