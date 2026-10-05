// Scheibe 31: die Decks im Kern (SCHNITTSTELLEN.md §4.4, §5.5, §5.9, §6.3, §6.4, §13.1, §13.2, §16.1, §16.2).
// Befehle /k/deck/laden, entladen, start, stopp werden am Blockanfang einsortiert; Laden geht über einen Ring an den
// Lade-Faden (lader.h) und kommt als eingeblendetes, geprüftes Material zurück; start und stopp wirken am Sample ihres
// Ziel-Beats, auch mitten im Block (der Kern teilt den Block dort). Das Deck liest im Direktweg ohne Stretcher (ADR 020);
// eine Tempo-Änderung bei laufendem Deck wird abgelehnt (kein_stretcher), bis Scheibe 50 den Stretcher-Weg baut.
// Keine Allokation, keine Sperre, kein I/O im Callback. Die Decks im Neustart-Zustand: kern_deck_zustand.cpp.
#include <cmath>
#include <cstdio>
#include <cstring>

#include <cypherdj/dsp/werte.h>

#include "cypherdj/kern.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;
namespace dsp = cypherdj::dsp;

namespace {

constexpr double TEMPO_GLEICH = 1e-6;          // §4.4: direkt, solange |bpm/basis_bpm − 1| < 10⁻⁶
constexpr double FRIST_BEATS[4] = {128.0, 64.0, 32.0, 16.0};  // §5.9 /e/frist

void kopiere(char* ziel, const char* quelle, size_t n) {
  size_t i = 0;
  if (quelle)
    for (; i + 1 < n && quelle[i]; ++i) ziel[i] = quelle[i];
  ziel[i] = '\0';
}

bool ist_cypher(const char* q) { return !std::strcmp(q, "cypher"); }

}  // namespace

// §5.9: nach jedem neuen Lesekopf (start, Plan E9: sprung, hotcue) gelten nur die Schwellen als vorbei, die der Rest
// schon unterschreitet; die übrigen werden gemeldet, wenn sie fallen (Plan-Review E9 Befund 3).
static void frist_neu(DeckWerk& w, int d, int64_t s) {
  const double rest = w.deck[d].beats_bis_ende_bei(s);
  w.frist_gemeldet[d] = 0;
  for (int i = 0; i < 4; ++i)
    if (rest <= FRIST_BEATS[i]) w.frist_gemeldet[d] |= static_cast<uint8_t>(1u << i);
}

void Kern::decks_anlegen() {
  decks_ = std::make_unique<DeckWerk>();
  DeckWerk& w = *decks_;
  const sw::ReglerTabelle& tab = sw_->tabelle();
  char p[64];
  auto such = [&](const char* fmt, int n, const char* rest) {
    std::snprintf(p, sizeof p, fmt, n, rest);
    return static_cast<int16_t>(tab.suche(p));
  };
  for (int d = 0; d < DECKS; ++d) {
    DeckRegler& r = w.reg[d];
    r.trim = such("deck/%d/%s", d + 1, "trim");
    r.fader = such("deck/%d/%s", d + 1, "fader");
    r.pfl = such("deck/%d/%s", d + 1, "pfl");
    r.ziel = such("deck/%d/%s", d + 1, "ziel");
    r.xseite = such("deck/%d/%s", d + 1, "xseite");
    for (int k = 0; k < STEM_ANZAHL; ++k) {
      char rest[16];
      std::snprintf(rest, sizeof rest, "stem/%s", STEM_NAMEN[k]);
      r.stem[k] = such("deck/%d/%s", d + 1, rest);
      if (r.stem[k] >= 0 && r.stem[k] < cypherdj::stellwerk::MAX_REGLER) {
        w.stem_deck[r.stem[k]] = static_cast<int8_t>(d);
        w.stem_nr[r.stem[k]] = static_cast<int8_t>(k);
      }
    }
  }
  for (int b = 0; b < 4; ++b) {
    w.bus_fader[b] = such("bus/%d/%s", b + 1, "fader");
    w.bus_xseite[b] = such("bus/%d/%s", b + 1, "xseite");
  }
  w.xfader = static_cast<int16_t>(tab.suche("xfader"));
  w.master_pegel = static_cast<int16_t>(tab.suche("master/pegel"));
}

bool Kern::ein_deck_laeuft() const noexcept {
  for (int d = 0; d < DECKS; ++d)
    if (decks_->deck[d].laeuft()) return true;
  return false;
}

// §1.6: Kanalpegel = Trim + Fader; effektiv mit Bus oder Crossfader-Seite und master/pegel.
float Kern::effektiv_db(int d) const noexcept {
  const DeckWerk& w = *decks_;
  const DeckRegler& r = w.reg[d];
  auto wert = [&](int16_t i, float vorgabe) { return i >= 0 ? sw_->wert(i) : vorgabe; };
  float p = dsp::kanalpegel_db(wert(r.trim, 0.0f), wert(r.fader, -200.0f));
  if (dsp::ist_stumm(p)) return dsp::kStummDb;
  const int ziel = static_cast<int>(std::lround(wert(r.ziel, 0.0f)));
  int seite;
  if (ziel >= 1 && ziel <= 4) {
    p += wert(w.bus_fader[ziel - 1], 0.0f);
    seite = static_cast<int>(std::lround(wert(w.bus_xseite[ziel - 1], 1.0f)));
  } else {
    seite = static_cast<int>(std::lround(wert(r.xseite, 1.0f)));
  }
  const float g = seitengewicht(seite, wert(w.xfader, 0.0f));
  if (!(g > 0.0f)) return dsp::kStummDb;
  return p + 20.0f * std::log10(g) + wert(w.master_pegel, 0.0f);
}

bool Kern::deck_offen(int n) const noexcept {
  const DeckRegler& r = decks_->reg[n - 1];
  const float trim = r.trim >= 0 ? sw_->wert(r.trim) : 0.0f;
  const float fader = r.fader >= 0 ? sw_->wert(r.fader) : -200.0f;
  return dsp::kanalpegel_db(trim, fader) > hoerbar_db_;
}

// §4.4 (2026-09-27): Laden und Entladen sind gesperrt, solange das Deck läuft UND sein Kanal offen ist. Ein stehendes
// Deck ist stumm und lädt auch bei offenem Fader; das Laden setzt den Fader ohnehin auf −200.
bool Kern::deck_laeuft_offen(int n) const noexcept { return decks_->deck[n - 1].laeuft() && deck_offen(n); }

bool Kern::deck_hoerbar(int n) const noexcept {
  return decks_->deck[n - 1].laeuft() && effektiv_db(n - 1) > hoerbar_db_;
}

void Kern::einsortieren31(const Befehl& c) {
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  DeckWerk& w = *decks_;
  const int d = c.deck - 1;
  auto ab = [&](const char* grund) { quittung(c.id, c.quelle, 6, sample_, beat0, grund); };
  if (d < 0 || d >= DECKS) return ab("unbekanntes_deck");  // prüft schon das Netz
  if (ist_cypher(c.quelle)) {  // §4.4, §4.7: Stopp-Taste und Deck-Halter
    if (sw_->ki_gestoppt()) return ab("ki_gestoppt");
    if (sw_->deck_beruehrt(c.deck)) return ab("deck_beruehrt");
  }
  Deck& dk = w.deck[d];
  if (c.art == Befehl::DECK_LADEN) {
    if (deck_laeuft_offen(c.deck)) return ab("deck_hoerbar");
    if (!lader_) return ab("material_fehlt");
    LadeAuftrag a{};
    a.id = c.id;
    kopiere(a.quelle, c.quelle, sizeof a.quelle);
    a.deck = c.deck;
    a.fassung = c.fassung;
    a.mit_stems = c.mit_stems;
    a.basis_bpm = c.bpm;
    kopiere(a.material_id, c.material_id, sizeof a.material_id);
    a.seq = ++w.seq;
    if (!lader_->auftraege.schiebe(a)) {  // Lader hängt: genau oder gemeldet (§16.1)
      quittung(c.id, c.quelle, 4, sample_, beat0, "zu_spaet");
      return;
    }
    w.laden_seq[d] = a.seq;
    ++w.laden_offen[d];
    quittung(c.id, c.quelle, 1, sample_, beat0);
    return;
  }
  if (c.art == Befehl::DECK_ENTLADEN) {
    if (deck_laeuft_offen(c.deck)) return ab("deck_hoerbar");
    if (!dk.geladen()) return ab("nicht_geladen");
    quittung(c.id, c.quelle, 1, sample_, beat0);
    for (DeckAktion& a : w.aktion)
      if (a.belegt && a.deck == c.deck) {
        if (!a.hand) quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
        a.belegt = false;
      }
    if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, sample_, beat0);
    w.stopp_offen[d] = false;
    w.entladen_m[d] = dk.material();
    w.entladen_id[d] = c.id;
    kopiere(w.entladen_quelle[d], c.quelle, sizeof w.entladen_quelle[d]);
    dk.entlade(sample_);
    sw_->stems_geladen(c.deck, false);
    w.leer_melden[d] = true;
    quittung(c.id, c.quelle, 2, sample_, beat0);  // fertig, sobald das Material zurück ist (decks_uebernehmen)
    return;
  }
  if (c.art == Befehl::DECK_RASTER) {  // Plan Grid (§4.4): sofort, absolut; andere Fassung geladen → nicht_geladen
    const Material* m = dk.material();
    if (!m || std::strcmp(m->material_id, c.material_id) != 0 || m->fassung != c.fassung || m->basis_bpm != c.bpm)
      return ab("nicht_geladen");
    const int64_t alt = dk.raster_versatz();
    quittung(c.id, c.quelle, 1, sample_, beat0);
    dk.setze_raster(sample_, c.versatz_f);
    if (w.cue_gesetzt[d]) w.cue_f[d] += c.versatz_f - alt;  // D1: der gesetzte Cue-Punkt wandert mit
    frist_neu(w, d, sample_);  // Review F11: das Materialende rückt mit dem Ton
    Ereignis x{};
    x.art = Ereignis::RASTER;
    x.deck = c.deck;
    kopiere(x.material_id, m->material_id, sizeof x.material_id);
    x.quell_beat = dk.quell_beat_bei(sample_);
    x.wert = static_cast<float>(static_cast<double>(c.versatz_f - alt) / 48.0);
    x.sample = sample_;
    x.beat = beat0;
    melde(x);
    quittung(c.id, c.quelle, 2, sample_, beat0);
    quittung(c.id, c.quelle, 3, sample_, beat0);
    return;
  }
  if (c.art == Befehl::DECK_HOTCUE_SETZEN) {  // Plan E9 (§4.4): sofort, ohne Ziel-Beat; /e/hotcue
    if (!dk.geladen()) return ab("nicht_geladen");
    if (c.nr < 1 || c.nr > 8) return ab("ausserhalb_bereich");
    w.hotcue[d][c.nr - 1] = c.quell_beat;  // NaN löscht
    quittung(c.id, c.quelle, 1, sample_, beat0);
    Ereignis h{};
    h.art = Ereignis::HOTCUE;
    h.deck = c.deck;
    kopiere(h.material_id, dk.material()->material_id, sizeof h.material_id);
    h.status = c.nr;
    h.quell_beat = c.quell_beat;
    h.sample = sample_;
    h.beat = beat0;
    melde(h);
    quittung(c.id, c.quelle, 2, sample_, beat0);
    quittung(c.id, c.quelle, 3, sample_, beat0);
    return;
  }
  // start, stopp (§4.4 Deck-Teile; Politik §16.1: start 0, stopp 1); Plan E9: loop, sprung, hotcue (Politik 0, 1, 2)
  if (!dk.geladen() && w.laden_offen[d] == 0) return ab("nicht_geladen");
  double ab_beat = c.ab_beat;
  int64_t s = std::llround(plan_.karte().sample_at(ab_beat));
  if (s < sample_ && c.politik == 2 && c.raster_beats > 0.0) {  // raster > 0 prüft schon das Netz; hier gegen Endlosschleife  // §16.1 raster (Plan E9): nächster erreichbarer Rasterpunkt der Größe raster_beats
    ab_beat = c.raster_beats * std::ceil(beat0 / c.raster_beats - 1e-9);
    while ((s = std::llround(plan_.karte().sample_at(ab_beat))) < sample_) ab_beat += c.raster_beats;
  }
  const bool spaet = s < sample_;
  if (spaet && c.politik == 0) {
    quittung(c.id, c.quelle, 4, sample_, beat0, "zu_spaet");
    return;
  }
  DeckAktion* a = nullptr;
  for (DeckAktion& x : w.aktion)
    if (!x.belegt) {
      a = &x;
      break;
    }
  if (!a) return ab("ausserhalb_bereich");  // mehr als 64 wartende Deck-Befehle
  *a = DeckAktion{};
  a->belegt = true;
  a->art = c.art == Befehl::DECK_START ? 1 : c.art == Befehl::DECK_STOPP ? 2 : c.art == Befehl::DECK_LOOP ? 5
         : c.art == Befehl::DECK_SPRUNG ? 6 : 7;
  a->verschoben = ab_beat != c.ab_beat;
  a->wert_beats = c.wert_beats;
  a->nr = c.nr;
  a->politik = static_cast<uint8_t>(c.politik);
  a->verspaetet = spaet;
  a->spaet_sample = sample_;
  a->deck = c.deck;
  a->seq = ++w.seq;
  a->id = c.id;
  a->ab_beat = ab_beat;
  a->quell_beat = c.quell_beat;
  kopiere(a->quelle, c.quelle, sizeof a->quelle);
  kopiere(a->plan, c.plan, sizeof a->plan);
  kopiere(a->gruppe, c.gruppe, sizeof a->gruppe);
  kopiere(a->hoerschein, c.hoerschein, sizeof a->hoerschein);
  if (!spaet) quittung(c.id, c.quelle, 1, sample_, beat0);  // zu spät mit Politik 1: nur Quittung 5 am Start
}

void Kern::decks_uebernehmen() {
  DeckWerk& w = *decks_;
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  auto zurueck = [&](const Material* m) {  // Freigabe erst nach Rückgabe (ADR 015)
    if (!m) return;
    if (lader_ && lader_->rueckgabe.schiebe(const_cast<Material*>(m))) return;
    if (w.n_rueck_warte < 8) w.rueck_warte[w.n_rueck_warte++] = m;
  };
  // 1) Rückgaben: zuerst die wartenden, dann was die Decks abgelöst haben
  int n = w.n_rueck_warte;
  w.n_rueck_warte = 0;
  for (int i = 0; i < n; ++i) zurueck(w.rueck_warte[i]);
  for (int d = 0; d < DECKS; ++d)
    while (const Material* m = w.deck[d].rueckgabe()) {
      zurueck(m);
      if (m == w.entladen_m[d]) {
        quittung(w.entladen_id[d], w.entladen_quelle[d], 3, sample_, beat0);
        w.entladen_m[d] = nullptr;
      }
    }
  // 2) Lade-Ergebnisse (§4.4): Tausch am Blockanfang, Fader −200, PFL 0, Trim aus der Lautheit, Stems 0 dB
  LadeErgebnis e;
  while (lader_ && lader_->ergebnisse.hole(e)) {
    const LadeAuftrag& a = e.auftrag;
    const int d = a.deck - 1;
    if (w.laden_offen[d] > 0) --w.laden_offen[d];
    if (e.grund != LadeGrund::ok || !e.material) {
      quittung(a.id, a.quelle, 6, sample_, beat0, grund_text(e.grund));
      continue;
    }
    if (deck_laeuft_offen(a.deck)) {  // inzwischen laufend und offen: nie ungefragt tauschen (§4.4 deck_hoerbar)
      quittung(a.id, a.quelle, 6, sample_, beat0, "deck_hoerbar");
      zurueck(e.material);
      continue;
    }
    for (DeckAktion& x : w.aktion)  // Befehle an dieses Deck aus der Zeit vor diesem Laden fallen (Festlegung F6)
      if (x.belegt && x.deck == a.deck && x.seq < a.seq) {
        if (!x.hand) quittung(x.id, x.quelle, 7, sample_, beat0, "abbruch");
        x.belegt = false;
      }
    if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, sample_, beat0);
    w.stopp_offen[d] = false;
    Deck& dk = w.deck[d];
    dk.lade(e.material, sample_);
    for (double& hc : w.hotcue[d]) hc = NAN;  // Plan E9: Hotcues gehören zum geladenen Material
    w.cue_gesetzt[d] = false;  // Scheibe 35: Cue-Punkt = erste Takt-Eins, das Deck steht dort (Plan 35 Task 5)
    w.vorschau[d] = false;
    dk.setze_position(cue_frame(d));
    const DeckRegler& r = w.reg[d];
    for (int k = 0; k < STEM_ANZAHL; ++k) {
      if (r.stem[k] >= 0) sw_->setze_direkt(r.stem[k], 0.0f);
      dk.stem_db(k, 0.0f);
    }
    if (r.fader >= 0) sw_->setze_direkt(r.fader, dsp::kStummDb);
    if (r.pfl >= 0) sw_->setze_direkt(r.pfl, 0.0f);
    if (r.trim >= 0)
      sw_->setze_direkt(r.trim, dsp::trim_aus_lufs(ziel_lufs_, static_cast<float>(e.material->lufs_integriert)));
    // §5.7: die drei Werte nach dem Laden immer melden, auch wenn einer schon so stand (das Stellwerk meldet nur
    // Änderungen); so sieht jeder Abonnent Fader −200, PFL 0 und den Trim der neuen Fassung (Golden-Folge laden)
    for (int16_t rr : {r.fader, r.pfl, r.trim}) {
      if (rr < 0) continue;
      Ereignis x{};
      x.art = Ereignis::REGLER;
      x.sample = sample_;
      x.beat = beat0;
      kopiere(x.pfad, sw_->tabelle().def(rr).pfad, sizeof x.pfad);
      x.wert = sw_->wert(rr);
      sw::halter_text(sw_->halter(rr), x.text, sizeof x.text);
      melde(x);
    }
    sw_->stems_geladen(a.deck, e.material->mit_stems != 0);
    w.frist_gemeldet[d] = 0;
    w.leer_melden[d] = false;
    quittung(a.id, a.quelle, 2, sample_, beat0);  // §4.4: gestartet beim Tausch, fertig
    quittung(a.id, a.quelle, 3, sample_, beat0);
    Ereignis g{};
    g.art = Ereignis::GELADEN;
    g.deck = a.deck;
    kopiere(g.material_id, e.material->material_id, sizeof g.material_id);
    g.basis_bpm = e.material->basis_bpm;
    g.fassung = e.material->fassung;
    g.mit_stems = e.material->mit_stems;
    g.sample = sample_;
    g.beat = beat0;
    melde(g);
  }
  // 3) Stopp-Taste (§4.7, auch ohne Leitstand über das Stellwerk): wartende Deck-Befehle von Cypher fallen
  if (sw_->ki_gestoppt())
    for (DeckAktion& x : w.aktion)
      if (x.belegt && ist_cypher(x.quelle)) {
        quittung(x.id, x.quelle, 7, sample_, beat0, "ki_stopp");
        x.belegt = false;
      }
}

// §5.5: je geladenem Deck 50-mal je Sekunde (in dem Zyklus, der ein Vielfaches von 960 Samples enthält), Zustand am
// Blockanfang n0, direkt nach /uhr desselben Zyklus. Nach dem Entladen einmal Status 0.
void Kern::decks_zustand(int64_t n0, int n) {
  const int64_t naechstes = (n0 + DECK_ZUSTAND_ABSTAND - 1) / DECK_ZUSTAND_ABSTAND * DECK_ZUSTAND_ABSTAND;
  if (naechstes >= n0 + n) return;
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    const Deck& dk = w.deck[d];
    const Material* m = dk.material();
    if (!m && !w.leer_melden[d]) continue;
    Ereignis e{};
    e.art = Ereignis::DECK;
    e.deck = d + 1;
    e.sample = n0;
    e.beat = k.beat_at(static_cast<double>(n0));
    e.status = !m ? 0 : dk.laeuft() ? (dk.loop_aktiv() ? 3 : 2) : 1;  // Plan E9: 3 Loop (§5.5)
    if (m) {
      kopiere(e.material_id, m->material_id, sizeof e.material_id);
      e.basis_bpm = m->basis_bpm;
      e.fassung = m->fassung;
      e.mit_stems = m->mit_stems;
      e.quell_beat = dk.quell_beat_bei(n0);
      e.beats_bis_ende = dk.beats_bis_ende_bei(n0);
      e.faktor = k.bpm_at(static_cast<double>(n0)) / m->basis_bpm;
    }
    e.vorlauf_ms = 2.0f * static_cast<float>(n) / 48.0f;  // §3: Deck-Befehl im Direktweg 2 Zyklen
    melde(e);
    w.leer_melden[d] = false;
  }
}

void Kern::deck_ausfuehren(DeckAktion& a, int64_t s) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  const double b = k.beat_at(static_cast<double>(s));
  const int d = a.deck - 1;
  Deck& dk = w.deck[d];
  if (a.hand) return hand_ausfuehren(a, s);  // Scheibe 35: Deck-Taste der Hand, ohne Quittung
  const int ok = (a.verspaetet || a.verschoben) ? 5 : 2;
  if (ist_cypher(a.quelle) && sw_->ki_gestoppt()) return quittung(a.id, a.quelle, 7, s, b, "ki_stopp");
  if (!dk.geladen()) return quittung(a.id, a.quelle, 6, s, b, "nicht_geladen");
  const Material* m = dk.material();
  const double fpb = FRAMES_JE_MINUTE / m->basis_bpm;  // Frames je Quell-Beat
  if (a.art == 6) {  // Plan E9 sprung (§4.4; Attrappe decks.mjs 'sprung': im Loop wandert der Loop mit)
    const int64_t d_f = std::llround(a.wert_beats * fpb);
    // Audit F09: der mitwandernde Loop muss im Material bleiben, sonst läuft das Deck mit Status 3 endlos still
    if (dk.loop_aktiv() && (dk.loop_anfang() + d_f < 0 || dk.loop_anfang() + d_f + dk.loop_laenge() > m->frames))
      return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");
    dk.springe(s, d_f);
    frist_neu(w, d, s);
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 7) {  // Plan E9 hotcue, phasentreu (§4.4: ziel = hc + wrap(phase(p) − phase(hc))); beendet einen Loop
    const double hc = w.hotcue[d][a.nr - 1];
    if (std::isnan(hc)) return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");
    // stehend genau auf den Hotcue (Traktor; Review E9 F7: 13,3 wurde zu 40,3), laufend phasentreu zum Master
    const double p = dk.quell_beat_bei(s);
    const double x = (p - std::floor(p)) - (hc - std::floor(hc));
    const double ziel = dk.laeuft() ? hc + (x - std::floor(x + 0.5)) : hc;
    dk.loop_aus();
    dk.setze_kopf(s, std::llround(frame_von(ziel, dk.schlag0(), m->basis_bpm)));
    frist_neu(w, d, s);
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 5) {  // Plan E9 loop (§4.4): ab der Quellposition bei ab_beat, Länge in Quell-Beats; 0 = aus
    if (a.wert_beats > 0.0) {
      const int64_t a_f = dk.frame_bei(s), l_f = std::llround(a.wert_beats * fpb);
      if (a_f < 0 || a_f + l_f > m->frames) return quittung(a.id, a.quelle, 6, s, b, "ausserhalb_bereich");  // Audit F09
      dk.loop_an(a_f, l_f);
    }
    else {
      dk.loop_aus();
      frist_neu(w, d, s);
    }
    return quittung(a.id, a.quelle, ok, s, b);
  }
  if (a.art == 1) {  // start: bei ab_beat erklingt quell_beat (§4.4)
    if (std::fabs(k.bpm_at(static_cast<double>(s)) / m->basis_bpm - 1.0) >= TEMPO_GLEICH || plan_.eintraege() > 0)
      return quittung(a.id, a.quelle, 6, s, b, "kein_stretcher");
    int64_t f = std::llround(frame_von(a.quell_beat, dk.schlag0(), m->basis_bpm));
    if (a.verspaetet) f += s - std::llround(k.sample_at(a.ab_beat));  // phasentreu (Festlegung F5)
    dk.start(s, f);
    if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, s, b);  // Start beendet die Stopp-Rampe
    w.stopp_offen[d] = false;
    frist_neu(w, d, s);  // nur Übergänge melden
    quittung(a.id, a.quelle, ok, s, b);
    return;
  }
  const int64_t ende = dk.stopp(s);  // stopp: 10-ms-Rampe, fertig an ihrem Ende
  quittung(a.id, a.quelle, ok, s, b);
  if (ende > s) {
    w.stopp_offen[d] = true;
    w.stopp_id[d] = a.id;
    kopiere(w.stopp_quelle[d], a.quelle, sizeof w.stopp_quelle[d]);
    w.stopp_ende[d] = ende;
  } else {
    quittung(a.id, a.quelle, 3, s, b);  // stand schon
  }
}

// Ein Teilblock [s0, s0 + m): je Deck bis zum nächsten fälligen Befehl lesen, ihn am Sample ausführen, weiterlesen.
void Kern::decks_block(int64_t s0, int m) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    Deck& dk = w.deck[d];
    float* l = mixer_->eingang_l(d);
    float* r = mixer_->eingang_r(d);
    int off = 0;
    for (;;) {
      DeckAktion* nx = nullptr;
      int64_t sn = 0;
      for (DeckAktion& a : w.aktion) {
        if (!a.belegt || a.deck != d + 1) continue;
        const int64_t s = a.hand ? a.ziel_sample
                                 : a.verspaetet ? a.spaet_sample : std::llround(k.sample_at(a.ab_beat));
        if (s >= s0 + m) continue;
        if (!nx || s < sn || (s == sn && a.seq < nx->seq)) {
          nx = &a;
          sn = s;
        }
      }
      if (!nx) break;
      if (sn < s0 + off) {  // Ziel schon vorbei, ohne dass es beim Einsortieren so war (Neustart): §16.1
        if (nx->politik == 0) {
          quittung(nx->id, nx->quelle, 4, s0 + off, k.beat_at(static_cast<double>(s0 + off)), "zu_spaet");
          nx->belegt = false;
          continue;
        }
        nx->verspaetet = true;
        sn = s0 + off;
      }
#ifdef CYPHERDJ_MUTATION_START_BLOCKANFANG
      if (nx->art == 1) sn = s0;  // Fehlerfall der Abnahme: Start am Blockanfang statt am Sample des Ziel-Beats
#endif
      const int bis = static_cast<int>(sn - s0);
      if (bis > off) {
        dk.block(s0 + off, bis - off, l + off, r + off, off);
        off = bis;
      }
      deck_ausfuehren(*nx, sn);
      nx->belegt = false;
    }
    if (off < m) dk.block(s0 + off, m - off, l + off, r + off, off);
    if (w.stopp_offen[d] && !dk.laeuft()) {
      const int64_t e = w.stopp_ende[d];
      quittung(w.stopp_id[d], w.stopp_quelle[d], 3, e, k.beat_at(static_cast<double>(e)));
      w.stopp_offen[d] = false;
    }
  }
}

void Kern::decks_verlauf(int regler, const float* verlauf) {
  DeckWerk& w = *decks_;
  if (regler < 0 || regler >= cypherdj::stellwerk::MAX_REGLER || w.stem_deck[regler] < 0) return;
  w.deck[w.stem_deck[regler]].stem_verlauf(w.stem_nr[regler], verlauf);
}

void Kern::decks_verlauf_ende(int m) {
  for (int d = 0; d < DECKS; ++d) decks_->deck[d].verlauf_ende(m);
}

// §5.9 /e/frist: bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks, am Sample des Übergangs.
void Kern::decks_frist(int64_t n0, int n) {
  DeckWerk& w = *decks_;
  const Karte& k = plan_.karte();
  for (int d = 0; d < DECKS; ++d) {
    const Deck& dk = w.deck[d];
    const Material* m = dk.material();
    if (!m || !dk.laeuft() || dk.loop_aktiv() || w.frist_gemeldet[d] == 0x0f) continue;  // im Loop kein Ende (Plan E9)
    const bool hoerbar = deck_hoerbar(d + 1);
    for (int i = 0; i < 4; ++i) {
      if (w.frist_gemeldet[d] & (1u << i)) continue;
      const double f_schwelle = static_cast<double>(m->frames) - FRIST_BEATS[i] * FRAMES_JE_MINUTE / m->basis_bpm;
      const int64_t s = dk.anker_s() + std::llround(f_schwelle - static_cast<double>(dk.anker_f()));
      if (s >= n0 + n) continue;
      w.frist_gemeldet[d] |= static_cast<uint8_t>(1u << i);
      if (!hoerbar || s < n0) continue;  // Übergang lag vor diesem Block (Neustart): nicht nachmelden  // nur hörbare Decks melden (§5.9); die Schwelle gilt trotzdem als vorbei
      Ereignis e{};
      e.art = Ereignis::FRIST;
      e.deck = d + 1;
      e.beats_bis_ende = FRIST_BEATS[i];
      e.sample = s;
      e.beat = k.beat_at(static_cast<double>(s));
      melde(e);
    }
  }
}

void Kern::decks_abbruch(const char* quelle, const char* plan) {
  if (!plan || !plan[0]) return;
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  for (DeckAktion& a : decks_->aktion)
    if (a.belegt && !std::strcmp(a.plan, plan) && !std::strcmp(a.quelle, quelle)) {
      quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
      a.belegt = false;
    }
}

void Kern::decks_set_neu() {
  const double beat0 = plan_.karte().beat_at(static_cast<double>(sample_));
  for (DeckAktion& a : decks_->aktion)
    if (a.belegt) {
      if (!a.hand) quittung(a.id, a.quelle, 7, sample_, beat0, "abbruch");
      a.belegt = false;
    }
  for (int d = 0; d < DECKS; ++d) {
    decks_->frist_gemeldet[d] = 0;
    decks_->vorschau[d] = false;
  }
}

// Ohr T14 (§17 I3a): DeckModell-Adapter für PrueferI3 (stellwerk/i3.h). `kanal` ist der Kanal-Index der
// ReglerTabelle (d.kanal in i3.cpp), nicht die Deck-Nummer; tab_ ist eine eigene, aber baugleiche Tabelle (§1.5 fest
// verdrahtet), damit dieses Objekt schon vor dem Stellwerk selbst existieren kann (kern.cpp: erst Prüfer, dann
// Stellwerk). Kein I/O, keine Allokation: nur Feldzugriffe auf das schon geladene Material.
bool Kern::DeckModellImpl::deck_nr_von_kanal(int kanal, int& deck_nr) const {
  if (kanal < 0 || kanal >= tab_.kanaele()) return false;
  const char* name = tab_.kanal_name(kanal);
  if (!name || std::strncmp(name, "deck/", 5) != 0 || !name[5] || name[6]) return false;
  if (name[5] < '1' || name[5] > '4') return false;
  deck_nr = name[5] - '0';
  return true;
}

bool Kern::DeckModellImpl::inhalt(int kanal, cypherdj::stellwerk::Inhalt& aus) const {
  int deck_nr = 0;
  if (!deck_nr_von_kanal(kanal, deck_nr) || !decks_) return false;
  const Deck& dk = decks_->deck[deck_nr - 1];
  const Material* m = dk.material();
  if (!m) return false;
  kopiere(aus.material_id, m->material_id, sizeof aus.material_id);
  aus.bpm_milli = static_cast<int32_t>(std::llround(m->basis_bpm * 1000.0));
  aus.fassung = m->fassung;
  return true;
}

double Kern::DeckModellImpl::quell_beat_bei(int kanal, int64_t sample) const {
  int deck_nr = 0;
  if (!deck_nr_von_kanal(kanal, deck_nr) || !decks_) return std::nan("");
  const Deck& dk = decks_->deck[deck_nr - 1];
  if (!dk.geladen()) return std::nan("");
  return dk.quell_beat_bei(sample);
}

}  // namespace cdj
