// Scheibe 31: die Decks im Neustart-Zustand (SCHNITTSTELLEN.md §6.3 „je Deck Material, Basis, läuft, Anker Master-Beat
// ↔ Quell-Beat“; ARCHITEKTUR §7 „blendet Material ein und setzt auf dem Raster fort“). decks_abbild() und
// decks_wiederherstellen() laufen im Echtzeit-Fach des Zustands (kern_zustand.cpp, Scheibe 18 und 25): keine Allokation,
// keine Sperre. decks_nachladen() läuft einmal vor jack_activate und blendet das Material über den Lader ein.
#include <cmath>
#include <cstdio>
#include <cstring>

#include "cypherdj/kern.h"
#include "cypherdj/zustand.h"

namespace cdj {

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  size_t i = 0;
  if (quelle)
    for (; i + 1 < n && quelle[i]; ++i) ziel[i] = quelle[i];
  ziel[i] = '\0';
}

}  // namespace

// §6.3: je Deck Material, Basis, Fassung, Stems, Status, Anker Master-Beat ↔ Quell-Beat; wartende start/stopp als Befehle.
int Kern::decks_abbild(cdj_z_echtzeit& f, int n) const noexcept {
  const DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    cdj_z_deck& z = f.decks[d];
    std::memset(&z, 0, sizeof z);
    const Deck& dk = w.deck[d];
    const Material* m = dk.material();
    z.schatten_quell_beat = NAN;
    for (double& h : z.hotcue) h = NAN;
    if (!m) continue;
    kopiere(z.material_id, m->material_id, sizeof z.material_id);
    z.fassung = m->fassung;
    z.mit_stems = m->mit_stems;
    z.basis_bpm = m->basis_bpm;
    z.status = dk.laeuft() ? 2 : 1;
    z.hoerweg = 0;
    if (dk.laeuft()) {
      z.anker_master_beat = k.beat_at(static_cast<double>(dk.anker_s()));
      z.anker_quell_beat = quell_beat_von(static_cast<double>(dk.anker_f()), dk.schlag0(), m->basis_bpm);
    } else {
      z.anker_master_beat = NAN;
      z.anker_quell_beat = quell_beat_von(static_cast<double>(dk.position()), dk.schlag0(), m->basis_bpm);
    }
  }
  f.n_decks = DECKS;
  for (const DeckAktion& a : w.aktion) {
    if (!a.belegt || a.hand || n >= CDJ_Z_BEFEHLE) continue;  // Hand-Tasten (Scheibe 35) überleben keinen Neustart
    if (a.art != 1 && a.art != 2) continue;  // Plan E9: loop, sprung, hotcue auch nicht (der Zustand kennt nur start/stopp)
    cdj_z_befehl& b = f.befehle[n++];
    std::memset(&b, 0, sizeof b);
    b.id = a.id;
    kopiere(b.quelle, a.quelle, sizeof b.quelle);
    b.art = a.art == 1 ? CDJ_Z_ART_DECK_START : CDJ_Z_ART_DECK_STOPP;
    b.stand = 1;  // §5.1 /q/stand: wartet (ausgeführte Deck-Befehle sind abgeschlossen)
    b.verspaetet = a.verspaetet ? 1 : 0;
    b.ist_sample = std::llround(k.sample_at(a.ab_beat));
    b.ist_beat = a.ab_beat;
    cdj_z_deck_teil& t = b.d.deck_teil;
    t.ab_beat = a.ab_beat;
    t.quell_beat = a.quell_beat;
    t.deck = a.deck;
    t.politik = a.politik;
    t.seq = a.seq;
    kopiere(t.plan, a.plan, sizeof t.plan);
    kopiere(t.gruppe, a.gruppe, sizeof t.gruppe);
    kopiere(t.hoerschein, a.hoerschein, sizeof t.hoerschein);
  }
  return n;
}

void Kern::decks_wiederherstellen(const cdj_z_echtzeit& f) noexcept {
  DeckWerk& w = *decks_;
  const int nd = f.n_decks < 0 ? 0 : (f.n_decks > DECKS ? DECKS : f.n_decks);
  for (int d = 0; d < nd; ++d) {
    const cdj_z_deck& z = f.decks[d];
    DeckWerk::Wieder& x = w.wieder[d];
    x = DeckWerk::Wieder{};
    char id[25] = {0};
    std::memcpy(id, z.material_id, sizeof z.material_id);
    if (!material_id_gueltig(id)) continue;
    x.ja = true;
    kopiere(x.material_id, id, sizeof x.material_id);
    x.basis_bpm = z.basis_bpm;
    x.fassung = z.fassung;
    x.mit_stems = z.mit_stems;
    x.laeuft = z.status >= 2 && std::isfinite(z.anker_master_beat);
    x.anker_master_beat = z.anker_master_beat;
    x.anker_quell_beat = z.anker_quell_beat;
  }
  for (int i = 0; i < f.n_befehle; ++i) {
    const cdj_z_befehl& b = f.befehle[i];
    if ((b.art != CDJ_Z_ART_DECK_START && b.art != CDJ_Z_ART_DECK_STOPP) || b.stand != 1) continue;
    const cdj_z_deck_teil& t = b.d.deck_teil;
    if (t.deck < 1 || t.deck > DECKS) continue;
    for (DeckAktion& a : w.aktion) {
      if (a.belegt) continue;
      a = DeckAktion{};
      a.belegt = true;
      a.art = b.art == CDJ_Z_ART_DECK_START ? 1 : 2;
      a.politik = static_cast<uint8_t>(t.politik);
      a.deck = t.deck;
      a.seq = t.seq;
      a.id = b.id;
      a.ab_beat = t.ab_beat;
      a.quell_beat = t.quell_beat;
      kopiere(a.quelle, b.quelle, sizeof a.quelle);
      kopiere(a.plan, t.plan, sizeof a.plan);
      kopiere(a.gruppe, t.gruppe, sizeof a.gruppe);
      kopiere(a.hoerschein, t.hoerschein, sizeof a.hoerschein);
      if (t.seq > w.seq) w.seq = t.seq;
      break;
    }
  }
}

// Nicht-Echtzeit, vor jack_activate: Material der Decks aus dem Zustand einblenden (ohne sha256: es lag schon geprüft
// im Arbeitsbestand; ARCHITEKTUR §7 „Kern wieder hörbar ≤ 250 ms samt Material“), Lesekopf auf den Anker.
int Kern::decks_nachladen(Lader& lader) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  LaderOptionen opt;
  opt.pruefsumme = false;
  int n = 0;
  for (int d = 0; d < DECKS; ++d) {
    DeckWerk::Wieder& x = w.wieder[d];
    if (!x.ja) continue;
    x.ja = false;
    LadeAuftrag a{};
    a.deck = d + 1;
    a.fassung = x.fassung;
    a.mit_stems = x.mit_stems;
    a.basis_bpm = x.basis_bpm;
    kopiere(a.material_id, x.material_id, sizeof a.material_id);
    LadeGrund g;
    std::string meldung;
    Material* m = lader.lade(a, g, meldung, opt);
    if (!m) {
      std::fprintf(stderr, "Neustart: Deck %d %s nicht wieder eingeblendet (%s): %s\n", d + 1, x.material_id,
                   grund_text(g), meldung.c_str());
      continue;
    }
    Deck& dk = w.deck[d];
    dk.lade(m, sample_);
    const DeckRegler& r = w.reg[d];
    for (int s = 0; s < STEM_ANZAHL; ++s) dk.stem_db(s, r.stem[s] >= 0 ? sw_->wert(r.stem[s]) : 0.0f);
    sw_->stems_geladen(d + 1, m->mit_stems != 0);
    const int64_t f = std::llround(frame_von(x.anker_quell_beat, dk.schlag0(), m->basis_bpm));
    if (x.laeuft) {
      dk.setze_lauf_beat(std::llround(k.sample_at(x.anker_master_beat)), x.anker_master_beat, f);  // Welle 3: Anker in Beats
    } else {
      dk.setze_position(f);
    }
    std::fprintf(stderr, "Neustart: Deck %d %s/%s_r%d wieder eingeblendet, %s\n", d + 1, x.material_id,
                 bpm_text(x.basis_bpm).c_str(), x.fassung, x.laeuft ? "läuft auf dem Anker weiter" : "steht");
    ++n;
  }
  return n;
}

}  // namespace cdj
