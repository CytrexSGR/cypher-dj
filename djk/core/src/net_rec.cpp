// 1.8 Slice 1 (§4.12, §5.14): /k/rec/* im Netz-Faden. Prüft die Felder, legt den RecSpur an (Netz-Faden, nie der Callback), reiht den Befehl ein und
// gibt abgelöste RecSpur wieder frei (Ereignis REC_ALT). Die Meldung eines Takes (/e/aufnahme) kommt vom Aufnahme-Faden über seinen Ring.
#include <cstring>

#include "cypherdj/recording.h"
#include "cypherdj/net.h"

namespace cdj {

namespace v = cypherdj::osc;

static_assert(v::bereich::k_rec_spur::spur_max == ARR_SPUREN && v::bereich::e_aufnahme::spur_max == ARR_SPUREN,
              "Vertrag (osc.json rec spur) und ARR_SPUREN laufen auseinander");

bool Netz::rec_paket(const v::Adresse* a, const osc::Nachricht& m) {
  const bool spur = a->pfad == v::k_rec_spur.pfad, start = a->pfad == v::k_rec_start.pfad, stopp = a->pfad == v::k_rec_stopp.pfad;
  if (!spur && !start && !stopp) return false;
  Befehl b{};
  b.id = m.werte[0].h;
  std::strncpy(b.quelle, m.werte[1].s, sizeof b.quelle - 1);
  auto ab = [&](const char* grund) { quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund); return true; };
  bool quelle_gut = false;
  for (const auto& n : v::werte::quelle) quelle_gut = quelle_gut || n == b.quelle;
  if (!quelle_gut) return ab("ausserhalb_bereich");
  if (!stopp && !std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7; Anhalten bleibt erlaubt
  if (spur) {
    namespace f = v::feld::k_rec_spur;
    const int32_t nr = m.werte[f::spur].i, scharf = m.werte[f::scharf].i, eingang = m.werte[f::eingang].i;
    const int32_t modus = m.werte[f::modus].i, monitor = m.werte[f::monitor].i;   // 1.8 S0: carried; monitor is stored in the RecSpur (S3)
    const bool extern_ein = rec_extern(eingang);   // slice 2: ein_1..4 are taps (external pairs), the modus applies to them (D14)
    const bool midi = eingang == 30;               // 1.8 T7a: midi_ein_1 on an instrument track: a bit per track and one RecMidi, no tap, no modus (see below)
    if (nr < 1 || nr > ARR_SPUREN || (scharf != 0 && scharf != 1) ||
        !(eingang == 0 || rec_mixer_index(eingang) >= 0 || eingang == 20 || extern_ein || midi) || modus < 0 || modus > 3 || monitor < 0 || monitor > 2)
      return ab("ausserhalb_bereich");
    if (rec_mixer_index(eingang) >= 0 && modus != 0) return ab("ausserhalb_bereich");   // the channel mode only exists for ein_1..4
    if (scharf == 1 && eingang == 0) return ab("kein_eingang");
    if (scharf == 1 && eingang == 20) return ab("eingang_fehlt");   // master before the fader is not a tap yet (also with a modus)
    if (scharf == 1 && midi && modus != 0) return ab("ausserhalb_bereich");        // the channel mode only exists for ein_1..4
    if (!rec_faden_) return ab("datei_fehlt");
    b.art = Befehl::REC_SPUR;
    b.nr = nr; b.an = scharf; b.deck = eingang;
    b.form = modus; b.politik = monitor;   // 1.8 S0: Kanalmodus und Abhören (core.h)
    if (scharf == 1 && midi) {   // 1.8 T7a: a fresh recorder travels with every MIDI arm; the core adopts the first and hands every other one back (REC_ALT, fassung 1)
      RecMidi* p = RecMidi::neu();
      if (!p) return ab("zu_gross");
      rec_faden_->anmelden_midi(p);
      b.zeiger = p;
    } else if (scharf == 1) {
      RecSpur* p = RecSpur::neu(nr, eingang);
      if (!p) return ab("zu_gross");
#if !defined(CYPHERDJ_MUTATION_REC_MODUS_NICHT_GESPEICHERT) && !defined(CYPHERDJ_MUTATION_REC_PUBLIKATION_SCHWACH)
      p->modus = static_cast<int8_t>(modus);   // set here, in the net thread, before the pointer travels through the command queue
#endif
      p->monitor.store(static_cast<int8_t>(monitor), std::memory_order_relaxed);   // 1.8 S3 (D12): 0 aus, 1 auto, 2 ein; later changes are made in place by the callback
      rec_faden_->anmelden(p);
      b.zeiger = p;
    }
    if (!einreihen(b)) {   // einreihen hat zu_spaet gemeldet
      if (b.zeiger && midi) rec_midi_alt_frei(static_cast<RecMidi*>(const_cast<void*>(b.zeiger)));
      else if (b.zeiger) rec_alt_frei(static_cast<RecSpur*>(const_cast<void*>(b.zeiger)));
    }
#ifdef CYPHERDJ_MUTATION_REC_PUBLIKATION_SCHWACH
    else if (b.zeiger && !midi) static_cast<RecSpur*>(const_cast<void*>(b.zeiger))->modus = static_cast<int8_t>(modus);   // mutation: completed after the handoff, the callback may already read it
#endif
    return true;
  }
  if (start) {
    namespace f = v::feld::k_rec_start;
    b.art = Befehl::REC_START;
    b.nr = m.werte[f::kennung].i;
    b.fassung = m.werte[f::nachlauf_samples].i;
    b.versatz_f = m.werte[f::frist_samples].i;
    b.politik = m.werte[f::vorzaehler_takte].i;   // 1.8 S0/S4a.4: count-in in bars
    if (b.nr < 0 || b.fassung < 0 || b.fassung > 480000) return ab("ausserhalb_bereich");
    if (!(b.versatz_f == 0 || (b.versatz_f >= REC_FRIST_MIN && b.versatz_f <= REC_FRIST_MAX))) return ab("ausserhalb_bereich");   // frist_samples (M1)
    if (b.politik != 0 && b.politik != 1 && b.politik != 2 && b.politik != 4) return ab("ausserhalb_bereich");   // S4a.4: 0, 1, 2 and 4 bars exist; 3 and everything outside [0, 4] do not
    einreihen(b);
    return true;
  }
  b.art = Befehl::REC_STOPP;
  einreihen(b);
  return true;
}

void Netz::rec_alt_frei(RecSpur* p) {
  if (!p) return;
  if (rec_faden_) rec_faden_->abmelden(p);
  RecSpur::frei(p);
}

void Netz::rec_midi_alt_frei(RecMidi* p) {
  if (!p) return;
  if (rec_faden_) rec_faden_->abmelden_midi(p);
  RecMidi::frei(p);
}

void Netz::rec_melden(const TakeMeldung& t) {
  osc::Schreiber s(v::e_aufnahme);
  s.i(t.spur).i(t.kennung).i(t.status).h(t.status == 2 ? 0 : t.frames).h(t.start_s).i(t.luecken).i(t.art);   // art 0 audio; 1.8 T7a: art 1 midi (spur 0, frames = event count, luecken = refused events)
  an_alle(s);
}

void Netz::rec_zyklus() {
  if (!rec_faden_) return;
  TakeMeldung t;
  while (rec_faden_->hole_meldung(t)) rec_melden(t);
}

}  // namespace cdj
