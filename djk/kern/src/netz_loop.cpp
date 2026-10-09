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
  if (einreihen(b)) l.release();  // der Kern besitzt ihn jetzt; zurück kommt er als LOOP_ALT (Task 7: ohne Varianten-Render)
  return true;
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
      kl_ = std::make_unique<KeylockRender>(kl_opt_);
    } catch (const std::exception& x) {
      std::fprintf(stderr, "keylock: Render-Faden nicht anlegbar (%s), REC bei T != 128 wird nicht umgerechnet\n", x.what());
      kl_aus_ = true;
      return false;
    } catch (...) {
      std::fprintf(stderr, "keylock: Render-Faden nicht anlegbar, REC bei T != 128 wird nicht umgerechnet\n");
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

// Keylock Slice 4: umgerechnete REC-Mitschnitte (Task 7: der einzige Auftrag des Render-Fadens) abholen, Datei schreiben, dann
// /e/mitschnitt (Status 1 bei Fehler der Umrechnung oder des Schreibens; die Kern-Quittung kam schon beim Start des Mitschnitts).
void Netz::keylock_zyklus() {
  if (kl_beendet_ || !kl_) return;  // Slice 3b (F6): Shutdown, nichts mehr abholen
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

bool Netz::loop_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::BOX) {  // Keylock 7b.3, §5.5b /zustand/box ,iiiiii (7c.3: kein_platz)
    osc::Schreiber s(v::zustand_box);
    s.i(e.deck).i(e.status).i(e.keylock_unterlauf).i(e.keylock_aufgegeben).i(e.keylock_ring_voll).i(e.keylock_kein_platz);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::LOOP_ALT) {
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
