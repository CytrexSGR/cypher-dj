// Scheibe 18: der Kern und sein Neustart-Zustand (SCHNITTSTELLEN.md §6.3, ADR 016 Entscheidung 4). Was der Callback
// je Zyklus ins Echtzeit-Fach schreibt und was ein neuer Kern daraus übernimmt: Generation, wirksame Karte, Grundkarte
// (Tempoplan), offene Befehle mit Stand (Tempo-Rampen, Prüfklick). Keine Allokation, keine Sperre, kein I/O.
// Scheibe 25: dazu alle Regler mit Wert oder Halter außerhalb der Vorgabe, Planteile mit Stand (Art 5), KI-Stopp,
// KI-Spur und Prüfklicks je Kanal. Das Stellwerk (Scheibe 11) hat keine Naht zum Wiederherstellen laufender Teile:
// der Kern setzt die Werte (setze_direkt) und reicht die Teile im zweiten Zyklus der Generation nach
// (kern_stellwerk.cpp teile_nachreichen); lineare Rampen laufen exakt auf ihrer Geraden weiter (Befund B2 im Plan).
#include <cmath>
#include <cstring>

#include "cypherdj/kern.h"
#include "cypherdj/zustand.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {

void segmente_schreiben(const Karte& k, cdj_z_segment* aus, int32_t& n) noexcept {
  n = k.anzahl();
  for (int i = 0; i < n; ++i) {
    const Segment& s = k.segment(i);
    aus[i] = cdj_z_segment{s.s0, s.b0, s.bpm0, s.k, s.dauer_s, 0};
  }
}

bool segmente_lesen(const cdj_z_segment* z, int32_t n, Karte& k) noexcept {
  if (n < 1 || n > MAX_SEGMENTE) return false;
  Segment s[MAX_SEGMENTE];
  for (int i = 0; i < n; ++i) s[i] = Segment{z[i].s0, z[i].b0, z[i].bpm0, z[i].k, z[i].dauer_s};
  return k.setze(s, n);
}

// Kopiert höchstens n − 1 Zeichen und schließt immer ab (gekürzt, wenn die Quelle länger ist).
void text(char* ziel, const char* quelle, size_t n) noexcept {
  size_t i = 0;
  if (quelle)
    for (; i + 1 < n && quelle[i]; ++i) ziel[i] = quelle[i];
  ziel[i] = '\0';
}

}  // namespace

void Kern::abbild(cdj_z_echtzeit& f) const noexcept {
  f.generation = generation_;
  segmente_schreiben(plan_.karte(), f.segmente, f.n_segmente);
  segmente_schreiben(plan_.basis(), f.grund, f.n_grund);
  int n = 0;
  const Karte& k = plan_.karte();
  for (int i = 0; i < plan_.eintraege() && n < CDJ_Z_BEFEHLE; ++i) {
    const RampeEintrag& e = plan_.eintrag(i);
    cdj_z_befehl& b = f.befehle[n++];
    b.id = e.id;
    std::memcpy(b.quelle, e.quelle, sizeof b.quelle);
    b.art = CDJ_Z_ART_RAMPE;
    b.stand = e.gestartet ? 2 : 1;  // §5.1 /q/stand: 1 wartet, 2 läuft
    b.verspaetet = e.verspaetet ? 1 : 0;
    b.gestartet = e.gestartet ? 1 : 0;
    b.ist_sample = std::llround(k.sample_at(e.start_beat));
    b.ist_beat = e.start_beat;
    b.d.rampe.start_beat = e.start_beat;
    b.d.rampe.ende_beat = e.ende_beat;
    b.d.rampe.ziel_bpm = e.ziel_bpm;
  }
  if (klick_.aktiv() && n < CDJ_Z_BEFEHLE) {
    cdj_z_befehl& b = f.befehle[n++];
    b.id = klick_id_;
    std::memcpy(b.quelle, klick_quelle_, sizeof b.quelle);
    b.art = CDJ_Z_ART_KLICK;
    b.stand = klick_quittung_offen_ ? 1 : 2;
    b.verspaetet = 0;
    b.gestartet = klick_quittung_offen_ ? 0 : 1;
    b.ist_sample = klick_seit_sample_;
    b.ist_beat = klick_seit_beat_;
    std::memset(b.d.klick.kanal, 0, sizeof b.d.klick.kanal);  // "" = master, wie Scheibe 18
  }
  // Scheibe 25: Prüfklicks je Kanal
  for (int kk = 0; kk < MIX_KANAELE && n < CDJ_Z_BEFEHLE; ++kk) {
    if (!kanal_klick_[kk].aktiv()) continue;
    const KlickZiel& q = kanal_klick_q_[kk];
    cdj_z_befehl& b = f.befehle[n++];
    b.id = q.id;
    std::memcpy(b.quelle, q.quelle, sizeof b.quelle);
    b.art = CDJ_Z_ART_KLICK;
    b.stand = q.quittung_offen ? 1 : 2;
    b.verspaetet = 0;
    b.gestartet = q.quittung_offen ? 0 : 1;
    b.ist_sample = q.seit_sample;
    b.ist_beat = q.seit_beat;
    text(b.d.klick.kanal, Mixer::kanal_name(kk), sizeof b.d.klick.kanal);
  }
  // Scheibe 25: Planteile mit Stand (§6.3 „ausstehende Befehle mit Stand“, /q/stand)
  for (int i = 0; i < TeilSchatten::MAX && n < CDJ_Z_BEFEHLE; ++i) {
    const SchattenTeil* t = schatten_.teil(i);
    if (!t->belegt || t->stand < 1) continue;
    cdj_z_befehl& b = f.befehle[n++];
    b.id = t->id;
    std::memset(b.quelle, 0, sizeof b.quelle);
    text(b.quelle, t->quelle, sizeof b.quelle);
    b.art = CDJ_Z_ART_TEIL;
    b.stand = t->stand;
    b.verspaetet = 0;
    b.gestartet = t->stand == 2 ? 1 : 0;
    b.ist_sample = t->stand == 2 ? t->ist_sample : std::llround(k.sample_at(t->ab_beat));
    b.ist_beat = t->stand == 2 ? t->ist_beat : t->ab_beat;
    cdj_z_teil& z = b.d.teil;
    std::memset(&z, 0, sizeof z);
    z.ab_beat = t->ab_beat;
    z.dauer_beats = t->dauer_beats;
    z.nach = t->nach;
    z.nr = t->nr;
    z.form = t->form;
    z.politik = t->politik;
    text(z.pfad, t->pfad, sizeof z.pfad);
    text(z.plan, t->plan, sizeof z.plan);
    text(z.gruppe, t->gruppe, sizeof z.gruppe);
    text(z.hoerschein, t->hoerschein, sizeof z.hoerschein);
  }
  n = decks_abbild(f, n);  // Scheibe 31: Decks und wartende Deck-Befehle
  f.n_befehle = n;
  // Scheibe 25: Regler mit Wert oder Halter außerhalb der Vorgabe (§6.3 „alle Regler mit Wert und Halter“)
  const sw::ReglerTabelle& tab = sw_->tabelle();
  int nr = 0;
  for (int r = 0; r < tab.anzahl() && nr < CDJ_Z_REGLER; ++r) {
    const sw::ReglerDef& d = tab.def(r);
    const sw::Halter& h = sw_->halter(r);
    const float w = sw_->wert(r);
    if (h.art == sw::HalterArt::frei && (d.transport || w == d.vorgabe)) continue;
    cdj_z_regler& z = f.regler[nr++];
    std::memset(&z, 0, sizeof z);
    text(z.pfad, d.pfad, sizeof z.pfad);
    sw::halter_text(h, z.halter, sizeof z.halter);
    z.wert = w;
  }
  f.n_regler = nr;
  f.ki_gestoppt = sw_->ki_gestoppt() ? 1 : 0;
  std::memcpy(f.ki_spur, ki_spur_, sizeof f.ki_spur);
  f.n_hoerscheine = 0;
}

bool Kern::wiederherstellen(const cdj_z_echtzeit& f) noexcept {
  if (f.n_befehle < 0 || f.n_befehle > CDJ_Z_BEFEHLE || f.generation < 0) return false;
  if (f.n_regler < 0 || f.n_regler > CDJ_Z_REGLER) return false;
  Karte karte, basis;
  if (!segmente_lesen(f.segmente, f.n_segmente, karte) || !segmente_lesen(f.grund, f.n_grund, basis)) return false;
  RampeEintrag e[MAX_WARTEND];
  int n = 0;
  const cdj_z_befehl* klick = nullptr;
  for (int i = 0; i < f.n_befehle; ++i) {
    const cdj_z_befehl& b = f.befehle[i];
    if (b.art == CDJ_Z_ART_KLICK) {
      if (!pruefmodus_) continue;  // Befund B7 aus 18: Prüfklick nur in einen Kern mit Prüfmodus
      if (b.d.klick.kanal[0] == '\0' || !std::strncmp(b.d.klick.kanal, "master", sizeof b.d.klick.kanal))
        klick = &b;
    } else if (b.art == CDJ_Z_ART_RAMPE && n < MAX_WARTEND) {
      RampeEintrag& r = e[n++];
      r.id = b.id;
      std::memcpy(r.quelle, b.quelle, sizeof r.quelle);
      r.quelle[sizeof r.quelle - 1] = '\0';
      r.start_beat = b.d.rampe.start_beat;
      r.ende_beat = b.d.rampe.ende_beat;
      r.ziel_bpm = b.d.rampe.ziel_bpm;
      r.verspaetet = b.verspaetet != 0;
      r.gestartet = b.gestartet != 0;
    }  // Teile weiter unten; unbekannte Art (eine spätere Scheibe schrieb sie): fällt weg
  }
  if (!plan_.wiederherstellen(basis, karte, e, n)) return false;
  if (klick) {
    klick_.an();
    klick_quittung_offen_ = klick->stand == 1;
    klick_id_ = klick->id;
    std::memcpy(klick_quelle_, klick->quelle, sizeof klick_quelle_);
    klick_quelle_[sizeof klick_quelle_ - 1] = '\0';
    klick_seit_sample_ = klick->ist_sample;
    klick_seit_beat_ = klick->ist_beat;
  }
  // Scheibe 25: Prüfklicks je Kanal
  for (int i = 0; i < f.n_befehle; ++i) {
    const cdj_z_befehl& b = f.befehle[i];
    if (b.art != CDJ_Z_ART_KLICK || !pruefmodus_) continue;  // B7
    char kanal[17] = {0};
    std::memcpy(kanal, b.d.klick.kanal, sizeof b.d.klick.kanal);
    const int kk = Mixer::kanal_index(kanal);
    if (kk < 0) continue;
    KlickZiel& q = kanal_klick_q_[kk];
    kanal_klick_[kk].an();
    q.quittung_offen = b.stand == 1;
    q.id = b.id;
    std::memcpy(q.quelle, b.quelle, sizeof q.quelle);
    q.quelle[sizeof q.quelle - 1] = '\0';
    q.seit_sample = b.ist_sample;
    q.seit_beat = b.ist_beat;
  }
  // Scheibe 25: Regler (Wert sofort, ohne Rampe und ohne Blende; Halter mensch im zweiten Zyklus als Berührung)
  const sw::ReglerTabelle& tab = sw_->tabelle();
  n_mensch_wieder_ = 0;
  for (int i = 0; i < f.n_regler; ++i) {
    const cdj_z_regler& z = f.regler[i];
    char pfad[49] = {0}, halter[41] = {0};
    std::memcpy(pfad, z.pfad, sizeof z.pfad);
    std::memcpy(halter, z.halter, sizeof z.halter);
    const int r = tab.suche(pfad);
    if (r < 0) continue;
    if (!tab.def(r).transport && std::isfinite(z.wert)) {
      sw_->setze_direkt(r, z.wert);
      mixer_->setze_sofort(r, z.wert);
    }
    if (!std::strcmp(halter, "mensch") && n_mensch_wieder_ < 64) mensch_wieder_[n_mensch_wieder_++] = (int16_t)r;
  }
  ki_stopp_wieder_ = f.ki_gestoppt != 0;
  std::memcpy(ki_spur_, f.ki_spur, sizeof ki_spur_);
  ki_spur_[sizeof ki_spur_ - 1] = '\0';
  // Scheibe 25: Planteile; laufende mit dem Schnappschuss (Wert und Beat am letzten Sample des geschriebenen Blocks)
  schatten_.leeren();
  const double b_s = karte.beat_at((double)(f.anker_sample + (int64_t)f.quantum - 1));
  for (int i = 0; i < f.n_befehle; ++i) {
    const cdj_z_befehl& b = f.befehle[i];
    if (b.art != CDJ_Z_ART_TEIL || (b.stand != 1 && b.stand != 2)) continue;
    SchattenTeil* t = schatten_.neu();
    if (!t) break;
    const cdj_z_teil& z = b.d.teil;
    t->id = b.id;
    text(t->quelle, b.quelle, sizeof t->quelle);
    text(t->plan, z.plan, sizeof t->plan);
    t->nr = z.nr;
    text(t->pfad, z.pfad, sizeof t->pfad);
    t->ab_beat = z.ab_beat;
    t->dauer_beats = z.dauer_beats;
    t->nach = z.nach;
    t->form = z.form;
    t->politik = z.politik;
    text(t->gruppe, z.gruppe, sizeof t->gruppe);
    text(t->hoerschein, z.hoerschein, sizeof t->hoerschein);
    t->stand = b.stand;
    t->wieder = b.stand;
    t->ist_sample = b.ist_sample;
    t->ist_beat = b.ist_beat;
    if (b.stand == 2) {
      const int r = tab.suche(t->pfad);
      t->w_s = r >= 0 ? sw_->wert(r) : 0.0f;  // eben aus dem Regler-Abschnitt gesetzt (oder Vorgabe)
      t->b_s = b_s;
    }
  }
  decks_wiederherstellen(f);  // Scheibe 31: Material wieder einblenden, dann decks_nachladen()
  generation_ = f.generation + 1;
  nachreichen_in_ = 2;  // zyklus(): im zweiten Zyklus dieser Generation (das Stellwerk steht dann auf dem Zyklus)
  return true;
}

void Kern::fortsetzen(int64_t sample) noexcept {
  sample_ = sample;
  Ereignis e{};
  e.art = Ereignis::NEUSTART;
  e.generation = generation_;
  e.sample = sample;
  melde(e);
}

// Gebremster Start: keine fortgesetzte Generation, also kein teile_nachreichen(); der Stopp wird hier gesetzt. Läuft in
// Betrieb::starte vor jack_activate, kein anderer Faden greift auf das Stellwerk zu.
void Kern::nur_ki_stopp_wiederherstellen(const cdj_z_echtzeit& f) {
  if (f.ki_gestoppt != 0) sw_->ki_stopp(0, sw::Quelle::andreas);
}

}  // namespace cdj
