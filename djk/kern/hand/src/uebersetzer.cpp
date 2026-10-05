// Hand-Weg: MIDI -> Ausgabe (SCHNITTSTELLEN §7.2, §7.3 Punkt 1). Echtzeitfest.
#include <cmath>

#include "hand/uebersetzer.h"

namespace hand {

int32_t rasten(Kodierung k, uint8_t wert) {
  const int v = wert & 0x7F;
  switch (k) {
    case Kodierung::zweierkomplement: return v < 64 ? v : v - 128;
    case Kodierung::versatz64: return v - 64;
    case Kodierung::keine: return 0;
  }
  return 0;
}

int Uebersetzer::ereignis(const uint8_t* d, size_t groesse, int64_t zyklus_s0, uint32_t versatz, uint32_t n,
                          Ausgabe* aus) {
  z_.ereignisse++;
  if (!m_ || groesse < 3) {
    z_.ignoriert++;
    return 0;
  }
  const uint8_t status = d[0] & 0xF0;
  const int kanal = (d[0] & 0x0F) + 1;
  const int nr = d[1] & 0x7F;
  const uint8_t wert = d[2] & 0x7F;
  NachrichtTyp typ;
  bool druck;
  if (status == 0xB0) {
    typ = NachrichtTyp::cc;
    druck = wert >= 64;
  } else if (status == 0x90) {
    typ = NachrichtTyp::note;
    druck = wert > 0;   // Note-On mit Velocity 0 ist Note-Off
  } else if (status == 0x80) {
    typ = NachrichtTyp::note;
    druck = false;
  } else {
    z_.ignoriert++;
    return 0;
  }
  const int idx = suche(*m_, typ, kanal, nr);
  if (idx < 0) {
    z_.unbekannt++;
    return 0;
  }
  const Eintrag& e = m_->eintrag[idx];
  const uint32_t v = versatz < n ? versatz : (n > 0 ? n - 1 : 0);
  aus->eintrag = static_cast<int16_t>(idx);
  aus->sample = zyklus_s0 + static_cast<int64_t>(v);   // §7.3 Punkt 1: am Versatz, nicht am Blockanfang
  aus->x = 0.0f;
  aus->wert = 0;
  switch (e.art) {
    case Art::absolut:   // nur cc (Mapping-Prüfung)
      if (e.ziel_art == ZielArt::taste) {   // taste/autonomie: Stufe 0 bis 3 aus der Stellung
        aus->art = AusgabeArt::taste;
        aus->wert = static_cast<int32_t>(std::lround(wert * 3.0 / 127.0));
      } else {
        aus->art = AusgabeArt::regler_absolut;
        aus->x = static_cast<float>(wert / 127.0);
        aus->wert = wert;
      }
      break;
    case Art::relativ: {
      const int32_t r = rasten(e.kodierung, wert);
      if (r == 0) {
        z_.ignoriert++;
        return 0;
      }
      aus->wert = r;
      switch (e.ziel_art) {
        case ZielArt::regler:
          aus->art = AusgabeArt::regler_relativ;
          aus->x = static_cast<float>(r * SCHRITT_RELATIV);
          break;
        case ZielArt::deck: aus->art = AusgabeArt::deck; break;
        case ZielArt::tempo: aus->art = AusgabeArt::tempo; break;
        case ZielArt::taste: aus->art = AusgabeArt::taste; break;
      }
      break;
    }
    case Art::beruehrung:   // nur Regler (Mapping-Prüfung); Loslassen wirkt nicht
      if (!druck) {
        z_.ignoriert++;
        return 0;
      }
      aus->art = AusgabeArt::regler_beruehrung;
      aus->wert = 1;
      break;
    case Art::taste:
      if (e.ziel_art == ZielArt::regler) {   // Schalter: Druck schaltet um, Loslassen wirkt nicht
        if (!druck) {
          z_.ignoriert++;
          return 0;
        }
        aus->art = AusgabeArt::regler_umschalten;
        aus->wert = 1;
      } else {
        aus->art = e.ziel_art == ZielArt::deck ? AusgabeArt::deck : AusgabeArt::taste;
        aus->wert = druck ? 1 : 0;
      }
      break;
  }
  z_.ausgaben++;
  return 1;
}

const char* name(AusgabeArt a) {
  switch (a) {
    case AusgabeArt::regler_absolut: return "regler_absolut";
    case AusgabeArt::regler_relativ: return "regler_relativ";
    case AusgabeArt::regler_beruehrung: return "regler_beruehrung";
    case AusgabeArt::regler_umschalten: return "regler_umschalten";
    case AusgabeArt::deck: return "deck";
    case AusgabeArt::tempo: return "tempo";
    case AusgabeArt::taste: return "taste";
  }
  return "?";
}

}  // namespace hand
