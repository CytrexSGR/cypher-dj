// MVP 2 (Spec docs/specs/2026-09-27-djk-mvp2-loops-design.md, ADR 025, SCHNITTSTELLEN §4.9, §5.11): Loop-Boxen im
// Netz-Faden. /k/loop/laden liest den Loop aus <loop_ordner>/<name>/ und reicht ihn als Zeiger an den Kern; start und
// stopp gehen als Befehl durch. Freigaben (abgelöster Loop) kommen als Ereignis zurück und passieren nur hier.
// Scheibe 2 (ADR 025 Folgeplan): /k/loop/rec legt einen Mitschnitt-Puffer an (das Netz prüft nur Form, nicht Tempo
// oder Überlappung: das entscheidet der Kern am Sample) und reicht ihn ebenso als Zeiger. Ist er voll, kommt er als
// Ereignis::MITSCHNITT zurück (status 0 fertig, 1 abgelehnt oder abgebrochen); nur bei 0 schreibt schreibe_loop ihn.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "cypherdj/loop.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

bool quelle_ok(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

}  // namespace

bool Netz::loop_paket(const v::Adresse* a, const osc::Nachricht& m) {
  const bool laden = a->pfad == v::k_loop_laden.pfad;
  const bool start = a->pfad == v::k_loop_start.pfad;
  const bool stopp = a->pfad == v::k_loop_stopp.pfad;
  const bool rec = a->pfad == v::k_loop_rec.pfad;
  const bool raster = a->pfad == v::k_loop_raster.pfad;
  if (a->pfad == v::k_fx.pfad) {  // AUFTRAG 2026-09-28 (§4.10): /k/fx ,hsiidddddi, Einheits-Parameter
    namespace f = v::feld::k_fx;
    Befehl b{};
    b.art = Befehl::FX;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    b.deck = m.werte[f::einheit].i;
    b.nr = m.werte[f::art].i;
    b.dauer_beats = m.werte[f::beats].d;
    b.wert = static_cast<float>(m.werte[f::wet].d);
    b.wert_beats = m.werte[f::param1].d;
    b.raster_beats = m.werte[f::param2].d;
    b.quell_beat = m.werte[f::param3].d;
    b.an = m.werte[f::an].i;
    bool beats_ok = false;
    for (double x : v::werte::fx_beats) beats_ok = beats_ok || x == b.dauer_beats;
    const double wet = m.werte[f::wet].d;
    const auto anteil = [](double x) { return x >= 0.0 && x <= 1.0; };
    if (!quelle_ok(b.quelle) || b.deck < 1 || b.deck > 2 || !beats_ok || b.nr < 1 || b.nr > 4 || !anteil(wet) ||
        !anteil(b.wert_beats) || !anteil(b.raster_beats) || !anteil(b.quell_beat) || (b.an != 0 && b.an != 1)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return true;
    }
    einreihen(b);
    return true;
  }
  if (a->pfad == v::k_fx_zuweisung.pfad) {  // /k/fx/zuweisung ,hsisi
    namespace f = v::feld::k_fx_zuweisung;
    Befehl b{};
    b.art = Befehl::FX_ZUWEISUNG;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    b.deck = m.werte[f::einheit].i;
    kopiere(b.pfad, m.werte[f::kanal].s, sizeof b.pfad);
    b.an = m.werte[f::an].i;
    bool kanal_ok = false;
    for (const auto& k : v::werte::fx_kanal) kanal_ok = kanal_ok || k == m.werte[f::kanal].s;
    if (!quelle_ok(b.quelle) || b.deck < 1 || b.deck > 2 || !kanal_ok || (b.an != 0 && b.an != 1)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return true;
    }
    einreihen(b);
    return true;
  }
  if (a->pfad == v::k_fx_routing.pfad) {  // Ohr T17: /k/fx/routing ,hsi
    namespace f = v::feld::k_fx_routing;
    Befehl b{};
    b.art = Befehl::FX_ROUTING;
    b.id = m.werte[f::id].h;
    kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
    b.an = m.werte[f::routing].i;
    if (!quelle_ok(b.quelle) || (b.an != 0 && b.an != 1)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return true;
    }
    einreihen(b);   // ob die Quelle schalten darf (cypher: nur_hand), entscheidet der Kern
    return true;
  }
  if (!laden && !start && !stopp && !rec && !raster) return false;
  if (rec) {  // /k/loop/rec: id, quelle, beats, name (§4.9) — kein Box-Feld, eigener Zweig
    Befehl b{};
    b.id = m.werte[v::feld::k_loop_rec::id].h;
    kopiere(b.quelle, m.werte[v::feld::k_loop_rec::quelle].s, sizeof b.quelle);
    const int beats = m.werte[v::feld::k_loop_rec::beats].i;
    const char* name = m.werte[v::feld::k_loop_rec::name].s;
    if (!quelle_ok(b.quelle) || !loop_beats_ok(beats) || !loop_name_ok(name)) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return true;
    }
    auto mt = std::make_unique<Mitschnitt>();
    kopiere(mt->name, name, sizeof mt->name);
    mt->beats = beats;
    mt->frames = (int64_t)beats * LOOP_SPB;
    mt->daten.resize((size_t)mitschnitt_max_frames(beats) * 2);  // Plan Tempo-Folge: reicht bis 60 BPM
    b.art = Befehl::MITSCHNITT;
    b.nr = beats;
    kopiere(b.pfad, name, sizeof b.pfad);
    b.zeiger = mt.get();
    if (einreihen(b)) mt.release();  // der Kern besitzt ihn jetzt; zurück kommt er als Ereignis::MITSCHNITT
    return true;
  }
  Befehl b{};  // alle übrigen /k/loop/* beginnen mit id, quelle, box (§4.9)

  b.id = m.werte[0].h;
  kopiere(b.quelle, m.werte[1].s, sizeof b.quelle);
  b.deck = m.werte[2].i;
  if (!quelle_ok(b.quelle) || b.deck < 1 || b.deck > LOOP_BOXEN) {
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
    return true;
  }
  if (raster) {  // Plan Grid (§4.9): Betrag gegen frames prüft der Kern (er kennt den geladenen Loop)
    b.art = Befehl::LOOP_RASTER;
    b.versatz_f = m.werte[v::feld::k_loop_raster::versatz_frames].i;
    einreihen(b);
    return true;
  }
  if (start || stopp) {
    b.art = start ? Befehl::LOOP_START : Befehl::LOOP_STOPP;
    einreihen(b);
    return true;
  }
  const char* name = m.werte[v::feld::k_loop_laden::name].s;
  if (!loop_name_ok(name)) {
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
    return true;
  }
  std::string fehler;
  std::unique_ptr<Loop> l = lade_loop(loop_ordner_ + "/" + name, &fehler);
  if (!l) {
    std::fprintf(stderr, "/k/loop/laden: %s\n", fehler.c_str());
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "pruefung");
    return true;
  }
  l->name = name;  // der Ordnername gilt, nicht das Feld in loop.json
  b.art = Befehl::LOOP_LADEN;
  kopiere(b.pfad, name, sizeof b.pfad);
  b.zeiger = l.get();
  // Keylock Slice 3: der Render-Faden liest nie den Zeiger, den der Kern besitzt (er könnte freigegeben sein), sondern eine
  // Kopie der Originaldaten. Sie entsteht vor dem Einreihen, danach gehört l dem Kern.
  auto quelle = std::make_shared<KeylockQuelle>();
  quelle->name = l->name;
  quelle->beats = l->beats;
  quelle->frames = l->frames;
  quelle->versatz = l->versatz;
  quelle->daten = l->daten;
  const int i = b.deck - 1;
  // Slice 3b (F2): Ob der Kern den Loop wirklich lädt, weiß das Netz erst später. Weist er ihn ab (Stopp Cypher), kommt derselbe
  // Zeiger über LOOP_ALT zurück (kern.cpp, LOOP_LADEN): keylock_alt() nimmt die Kopie dann zurück. Der Eintrag entsteht VOR dem
  // Einreihen (ein bad_alloc im push_back träfe sonst einen schon an den Kern gegebenen Loop) und geht bei Misserfolg wieder.
  kl_geladen_[i].push_back({l.get(), quelle});
  if (einreihen(b)) {
    l.release();  // der Kern besitzt ihn jetzt; zurück kommt er als LOOP_ALT
    kl_quelle_[i] = std::move(quelle);  // neuer Loop: Varianten des alten gelten nicht mehr
    kl_auftrag_quelle_[i].reset();
    keylock_zyklus();  // (b) Laden bei festem Tempo ≠ 128 löst sofort aus
  } else {
    kl_geladen_[i].pop_back();
  }
  return true;
}

// Keylock Slice 3: Tempo-Ruhe. Das Tempo gilt als fest, wenn es seit kl_ruhe Nanosekunden (steady_clock) unverändert ist.
static int64_t steady_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

void Netz::keylock_tempo(double bpm) {
  if (!(std::fabs(bpm - kl_bpm_) < 1e-9)) {  // Anker bleibt stehen, solange es nur um < 1e-9 kriecht
    kl_bpm_ = bpm;
    kl_seit_ns_ = steady_ns();
  }
}

void Netz::keylock_beenden() {
  kl_beendet_ = true;
  if (kl_) kl_->abbrechen();
}

// Der Render-Faden entsteht beim ersten Gebrauch. Scheitert das (bad_alloc, Thread-Mangel), bleibt Keylock aus: eine stderr-Zeile
// (vom Konstruktor des Fadens oder hier), die Boxen bleiben im Varispeed, nichts wird erneut versucht (Slice 3b, F5).
bool Netz::keylock_bereit() {
  if (kl_beendet_ || kl_aus_) return false;
  if (!kl_) {
    try {
      kl_ = std::make_unique<KeylockRender>(KEYLOCK_BOXEN, kl_opt_);
    } catch (const std::exception& x) {
      std::fprintf(stderr, "keylock: Render-Faden nicht anlegbar (%s), Keylock bleibt aus, die Boxen bleiben im Varispeed\n", x.what());
      kl_aus_ = true;
      return false;
    } catch (...) {
      std::fprintf(stderr, "keylock: Render-Faden nicht anlegbar, Keylock bleibt aus, die Boxen bleiben im Varispeed\n");
      kl_aus_ = true;
      return false;
    }
  }
  if (!kl_->bereit()) {  // die Zeile dazu kam aus dem Konstruktor
    kl_aus_ = true;
    return false;
  }
  return true;
}

// Ein Loop kam über LOOP_ALT zurück: abgewiesen (dann war es der aktuelle) oder abgelöst (ein neuerer steht hinter ihm). Er fällt
// aus der Liste; war er der aktuelle, folgt kl_quelle_ dem vorletzten, der Loop, den der Kern noch hat.
void Netz::keylock_alt(const void* zeiger) {
  for (int i = 0; i < KEYLOCK_BOXEN; ++i) {
    auto& li = kl_geladen_[i];
    for (auto it = li.begin(); it != li.end(); ++it) {
      if (it->zeiger != zeiger) continue;
      const bool aktuell = it->quelle == kl_quelle_[i];
      li.erase(it);
      if (aktuell) {
        kl_quelle_[i] = li.empty() ? nullptr : li.back().quelle;
        kl_auftrag_quelle_[i].reset();  // für den Loop, der bleibt, darf wieder gerendert werden
      }
      return;
    }
  }
}

void Netz::keylock_zyklus() {
  static_assert(KEYLOCK_BOXEN == LOOP_BOXEN, "Keylock: Boxen des Netzes und des Kerns");
  if (kl_beendet_) return;  // Slice 3b (F6): Shutdown, nichts mehr abholen, einreihen oder starten
  // 0. Slice 4: umgerechnete REC-Mitschnitte: Datei schreiben, dann /e/mitschnitt (Status 1 bei Fehler der Umrechnung oder des
  // Schreibens; die Kern-Quittung kam schon beim Start des Mitschnitts und bleibt unberührt)
  if (kl_) {
    KeylockRender::RecErgebnis r;
    while (kl_->rec_hole(r)) {
      int32_t status = r.fehler ? 1 : 0;
      if (status == 0) {
        std::string fehler;
        if (!schreibe_loop(loop_ordner_, *r.mt, &fehler)) {
          std::fprintf(stderr, "/k/loop/rec: %s\n", fehler.c_str());
          status = 1;
        }
      }
      osc::Schreiber s(v::e_mitschnitt);
      s.s(r.meldung.pfad).i(r.meldung.fassung).i(status).d(r.meldung.beat);
      an_alle(s);
      r = KeylockRender::RecErgebnis{};  // Mitschnitt freigeben
    }
  }
  // 1. fertige Varianten: nur einreihen, wenn Loop (Zeigergleichheit der Kopie) und Tempo noch zum Auftrag passen
  if (kl_) {
    KeylockRender::Ergebnis e;
    while (kl_->hole(e)) {
      const int i = e.box - 1;
      const bool gleich = kl_auftrag_quelle_[i] == e.quelle && std::fabs(kl_auftrag_bpm_[i] - e.bpm) < 1e-9;
      const bool passt = gleich && kl_quelle_[i] == e.quelle && std::fabs(kl_bpm_ - e.bpm) < 1e-9;
      if (e.fehler) {
        // Überholt: neues Tempo darf wieder rendern. Nur den eigenen Vermerk löschen (gleich), nicht den eines neueren Auftrags,
        // der schon läuft: sonst rendert derselbe Auftrag zweimal (Slice 3b, F3: Tempofolge 131 wirft, 135 → 131 135 135)
        if (!passt && gleich) kl_auftrag_quelle_[i].reset();
        continue;  // passt: der Versuch gilt als gemacht, kein Dauerlauf; die Box bleibt im Varispeed
      }
      if (!passt || !e.loop) {  // Loop oder Tempo haben gewechselt: verwerfen (e.loop wird freigegeben)
        if (gleich) kl_auftrag_quelle_[i].reset();
        continue;
      }
      Befehl b{};
      b.art = Befehl::LOOP_VARIANTE;
      b.id = 0;
      kopiere(b.quelle, "keylock", sizeof b.quelle);  // nicht "cypher": die Stopp-Taste gilt der KI, nicht dem Netz
      b.deck = e.box;
      b.zeiger = e.loop.get();
      if (einreihen(b, false)) {
        e.loop.release();  // der Kern besitzt sie jetzt; zurück kommt sie als LOOP_ALT
      } else {
        // Ring voll (Slice 3b, F4): die Variante wird freigegeben und NICHT neu gerechnet, bis sich Tempo oder Loop ändern (der
        // Vermerk bleibt stehen; vorher: Endlos-Render, je Versuch 100 ms im Netz-Faden und eine /q-Meldung an alle). Keine
        // /q-Meldung: Quelle "keylock" gehört nicht zum Vertrag. Eine Zeile im Journal.
        std::fprintf(stderr, "keylock: Box %d %.2f BPM: Befehlsring voll, Variante verworfen, kein neuer Render bis Tempo oder Loop wechseln\n",
                     e.box, e.bpm);
      }
    }
  }
  // 2. Auslöser: Tempo seit ≥ ruhe fest, weicht von 128 ab, Box hat einen Loop, noch kein Auftrag für genau dieses Tempo
  if (!(kl_bpm_ > 0.0) || std::fabs(kl_bpm_ - LOOP_BPM) <= 1e-6) return;
  if (steady_ns() - kl_seit_ns_ < kl_opt_.ruhe_ns) return;
  for (int i = 0; i < KEYLOCK_BOXEN; ++i) {
    if (!kl_quelle_[i]) continue;
    if (kl_auftrag_quelle_[i] == kl_quelle_[i] && std::fabs(kl_auftrag_bpm_[i] - kl_bpm_) < 1e-9) continue;
    if (!keylock_bereit()) return;  // Keylock aus (Faden nicht zu bauen oder Shutdown): die Box bleibt im Varispeed
    kl_auftrag_quelle_[i] = kl_quelle_[i];
    kl_auftrag_bpm_[i] = kl_bpm_;
    kl_->auftrag(i + 1, kl_quelle_[i], kl_bpm_);
  }
}

bool Netz::loop_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::LOOP_ALT) {
    keylock_alt(e.zeiger);  // Slice 3b (F2): vor dem delete, der Zeiger wird nur verglichen
    delete static_cast<const Loop*>(e.zeiger);
    return true;
  }
  if (e.art == Ereignis::MITSCHNITT) {  // Scheibe 2: fertig geschrieben, abgelehnt oder abgebrochen
    const auto* mt = static_cast<const Mitschnitt*>(e.zeiger);
    int32_t status = e.status;
    if (status == 0 && mt->roh_frames > 0 && mt->roh_frames != mt->frames) {
      // Keylock Slice 4: Tempo der Aufnahme ≠ 128: R3 im Render-Faden (Tonhöhe erhalten), die Datei entsteht erst nach dem
      // Ergebnis (keylock_zyklus: rec_hole), /e/mitschnitt kommt danach. Der Mitschnitt gehört jetzt dem Faden.
      if (keylock_bereit()) {
        RecMeldung meldung;
        kopiere(meldung.pfad, e.pfad, sizeof meldung.pfad);
        meldung.fassung = e.fassung;
        meldung.beat = e.beat;
        kl_->rec_auftrag(std::unique_ptr<Mitschnitt>(const_cast<Mitschnitt*>(mt)), meldung);
        return true;
      }
      // Slice 3b (F5): kein Render-Faden (nicht zu bauen oder Shutdown): der Mitschnitt lässt sich nicht auf das 128er-Raster
      // bringen und wird nicht roh geschrieben (falsche Länge und Tonhöhe): Status 1, keine Datei, eine Zeile
      std::fprintf(stderr, "keylock: REC %s: kein Render-Faden, Mitschnitt nicht umgerechnet, keine Datei\n", mt->name);
      status = 1;
    }
    if (status == 0) {
      std::string fehler;
      if (!schreibe_loop(loop_ordner_, *mt, &fehler)) {
        std::fprintf(stderr, "/k/loop/rec: %s\n", fehler.c_str());
        status = 1;
      }
    }
    osc::Schreiber s(v::e_mitschnitt);
    s.s(e.pfad).i(e.fassung).i(status).d(e.beat);
    an_alle(s);
    delete mt;
    return true;
  }
  if (e.art == Ereignis::FX) {  // AUFTRAG 2026-09-28, §5.12 /e/fx ,iidddddi, Einheits-Parameter
    osc::Schreiber s(v::e_fx);
    s.i(e.deck).i(e.fx_art).d(e.fx_beats).d(e.fx_wet).d(e.fx_param).d(e.beats_bis_ende).d(e.faktor).i(e.status);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::FX_ZUWEISUNG) {  // §5.12 /e/fx/zuweisung ,isi
    osc::Schreiber s(v::e_fx_zuweisung);
    s.i(e.deck).s(e.pfad).i(e.status);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::FX_ROUTING) {  // Ohr T17, §5.12 /e/fx/routing ,i
    fx_routing_stand_ = e.status;
    osc::Schreiber s(v::e_fx_routing);
    s.i(e.status);
    an_alle(s);
    return true;
  }
  if (e.art != Ereignis::LOOP) return false;

  osc::Schreiber s(v::e_loop);
  s.i(e.deck).i(e.status).s(e.pfad).i(e.fassung).i(e.fx_art).d(e.fx_beats).f(e.fx_wet);
  an_alle(s);
  return true;
}

}  // namespace cdj
