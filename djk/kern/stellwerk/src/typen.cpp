// Stellwerk-RT: Namen der Codes (§1.4, §5.1, §16.2) und Halter-Text (§5.7). Keine Regel, nur Tabellen.
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/typen.h"

namespace cypherdj::stellwerk {

const char* name(Quelle q) {
  switch (q) {
    case Quelle::andreas: return "andreas";
    case Quelle::cypher: return "cypher";
    case Quelle::leitstand: return "leitstand";
    case Quelle::erzeuger: return "erzeuger";
    case Quelle::werkstatt: return "werkstatt";
    case Quelle::pruefstand: return "pruefstand";
  }
  return "?";
}

const char* name(Status s) {
  switch (s) {
    case Status::angenommen: return "angenommen";
    case Status::gestartet: return "gestartet";
    case Status::fertig: return "fertig";
    case Status::verspaetet_verworfen: return "verspaetet_verworfen";
    case Status::verspaetet_ausgefuehrt: return "verspaetet_ausgefuehrt";
    case Status::abgelehnt: return "abgelehnt";
    case Status::abgebrochen: return "abgebrochen";
    case Status::storniert: return "storniert";
  }
  return "?";
}

const char* name(Grund g) {
  switch (g) {
    case Grund::kein: return "";
    case Grund::zu_spaet: return "zu_spaet";
    case Grund::regler_beim_menschen: return "regler_beim_menschen";
    case Grund::ueberlappung: return "ueberlappung";
    case Grund::nur_hand: return "nur_hand";
    case Grund::unbekannter_regler: return "unbekannter_regler";
    case Grund::ausserhalb_bereich: return "ausserhalb_bereich";
    case Grund::kein_hoerschein: return "kein_hoerschein";
    case Grund::hoerschein_anderer_kanal: return "hoerschein_anderer_kanal";
    case Grund::hoerschein_anderer_inhalt: return "hoerschein_anderer_inhalt";
    case Grund::hoerschein_anderes_tempo: return "hoerschein_anderes_tempo";
    case Grund::hoerschein_abgelaufen: return "hoerschein_abgelaufen";
    case Grund::hoerschein_anderer_abschnitt: return "hoerschein_anderer_abschnitt";
    case Grund::ziel_ungehoert: return "ziel_ungehoert";
    case Grund::keine_stems: return "keine_stems";
    case Grund::invariante_sub_doppelt: return "invariante_sub_doppelt";
    case Grund::invariante_master_leer: return "invariante_master_leer";
    case Grund::ki_gestoppt: return "ki_gestoppt";
    case Grund::hand: return "hand";
    case Grund::abbruch: return "abbruch";
    case Grund::ki_stopp: return "ki_stopp";
    case Grund::deck_beruehrt: return "deck_beruehrt";
  }
  return "?";
}

const char* name(InvArt a) {
  switch (a) {
    case InvArt::sub_doppelt: return "sub_doppelt";
    case InvArt::master_leer: return "master_leer";
    case InvArt::hoerschein: return "hoerschein";
  }
  return "?";
}

bool quelle_aus_text(const char* t, Quelle* aus) {
  static const Quelle alle[] = {Quelle::andreas, Quelle::cypher, Quelle::leitstand,
                                Quelle::erzeuger, Quelle::werkstatt, Quelle::pruefstand};
  for (Quelle q : alle) {
    if (std::strcmp(t, name(q)) == 0) {
      *aus = q;
      return true;
    }
  }
  return false;
}

int halter_text(const Halter& h, char* aus, int max) {
  switch (h.art) {
    case HalterArt::frei: return std::snprintf(aus, max, "frei");
    case HalterArt::mensch: return std::snprintf(aus, max, "mensch");
    case HalterArt::plan: return std::snprintf(aus, max, "plan:%s", h.plan);
    case HalterArt::quelle: return std::snprintf(aus, max, "%s", name(h.quelle));
  }
  return 0;
}

}  // namespace cypherdj::stellwerk
