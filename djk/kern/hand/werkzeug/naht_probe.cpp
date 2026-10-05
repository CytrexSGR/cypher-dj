// Naht-Probe (Scheibe 19, Task 0): benutzt jedes Symbol des Stellwerks (Scheibe 11), auf das die Hand-Bibliothek und
// ihre Tests bauen. Übersetzt sie mit -fsyntax-only gegen die gelieferten Köpfe, trägt die Naht; scheitert sie, ist
// das ein Befund an Strang B (ROADMAP §8.10), keine Änderung am Stellwerk.
#include <cstdint>

#include "sim_uhr.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/stellwerk.h"
namespace stellwerk = cypherdj::stellwerk;   // Scheibe 11 baut jetzt gegen cypherdj::stellwerk, siehe Stand-Datei

int naht(stellwerk::Stellwerk& sw, const stellwerk::ReglerTabelle& tab) {
  // regler.h
  const int r = tab.suche("deck/1/fader");
  const stellwerk::ReglerDef& d = tab.def(r);
  bool b = d.transport || d.db;
  float f = d.min + d.max;
  stellwerk::Kurve k{stellwerk::KurvenTyp::linear, -26.0f, 6.0f, true};
  b = b || k.typ == stellwerk::KurvenTyp::fader_db || d.kurve.typ == stellwerk::KurvenTyp::schalter ||
      d.kurve.typ == stellwerk::KurvenTyp::stufen || k.kill_unter_min;
  f += stellwerk::ReglerTabelle::aus_x(k, 0.5f) + stellwerk::ReglerTabelle::zu_x(k, 0.0f) + k.min + k.max;
  // stellwerk.h: Griff und Hand
  stellwerk::Griff g{int64_t{0}, static_cast<int16_t>(r), stellwerk::GriffArt::absolut, 0.5f, &k};
  g.art = stellwerk::GriffArt::relativ;
  g.art = stellwerk::GriffArt::beruehrung;
  sw.hand(g);
  sw.setze_direkt(r, -15.0f);
  sw.teil(stellwerk::TeilBefehl{7, stellwerk::Quelle::cypher, "p", 0, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "", ""});
  sw.prozess(sw.jetzt(), 256);
  const stellwerk::Ereignis* e = nullptr;
  const int n = sw.ereignisse(&e);
  sw.ereignisse_leeren();
  b = b || (n > 0 && e[0].art == stellwerk::EreignisArt::quittung && e[0].status == stellwerk::Status::abgebrochen &&
            e[0].id == 7 && e[0].sample == 0);
  b = b || sw.halter(r).art == stellwerk::HalterArt::mensch;
  f += sw.wert(r) + static_cast<float>(sw.tabelle().anzahl());
  stellwerk::SimUhr uhr(128.0);
  f += static_cast<float>(uhr.beat(0));
  return b ? static_cast<int>(f) : 0;
}
