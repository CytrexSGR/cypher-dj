// Stellwerk-RT: Sicht und Eingriff für den Prüfer (Naht zu Scheibe 20), Vorschau auf den laufenden Zyklus.
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

class SichtImpl final : public Sicht, public Eingriff {
 public:
  explicit SichtImpl(Stellwerk& sw) : sw_(sw) {}

  const Uhr& uhr() const override { return sw_.uhr_; }
  const ReglerTabelle& tabelle() const override { return sw_.tab_; }
  int64_t zyklus_anfang() const override { return sw_.zyklus_s0_; }
  int zyklus_laenge() const override { return sw_.zyklus_n_; }
  float wert(int r) const override { return sw_.reg_[r].wert; }
  const Halter& halter(int r) const override { return sw_.reg_[r].halter; }
  bool ki_gestoppt() const override { return sw_.ki_gestoppt_; }
  float vorschau(int r, int64_t s) const override { return rechne(r, s, false, MAX_TEILE); }
  float pruefwert(int r, int64_t s) const override { return rechne(r, s, true, MAX_TEILE); }
  float vorher(int r, int64_t s) const override {
    return s <= sw_.zyklus_s0_ ? sw_.reg_[r].wert : rechne(r, s - 1, true, MAX_TEILE);
  }
  float pruefwert_vor(int r, const TeilSicht& t) const override {
    return t.start_rang < 0 ? pruefwert(r, t.start_sample) : rechne(r, t.start_sample, true, t.start_rang);
  }
  float pruefwert_mit(int r, const TeilSicht& t) const override {
    return t.start_rang < 0 ? pruefwert(r, t.start_sample) : rechne(r, t.start_sample, true, t.start_rang + 1);
  }

  int offene_teile(TeilSicht* aus, int max) const override {
    int n = 0;
    for (int j = 0; j < MAX_TEILE && n < max; j++) {
      if (sw_.teil_[j].belegt) aus[n++] = sicht_von(j);
    }
    return n;
  }

  TeilSicht sicht_von(int j) const {
    const Stellwerk::Teil& t = sw_.teil_[j];
    TeilSicht ts;
    ts.index = j;
    ts.id = t.id;
    ts.quelle = t.quelle;
    ts.plan = t.plan;
    ts.nr = t.nr;
    ts.gruppe = t.gruppe;
    ts.hoerschein = t.hoerschein;
    ts.regler = t.regler;
    ts.ab_beat = t.ab_beat;
    ts.dauer_beats = t.dauer_beats;
    ts.nach = t.nach;
    ts.form = t.form;
    ts.politik = t.politik;
    ts.status = t.status;
    ts.angehalten = t.angehalten;
    ts.startet_in_diesem_zyklus = t.im_zyklus;
    ts.start_rang = -1;
    if (t.im_zyklus)
      for (int k = 0; k < sw_.n_starts_; k++)
        if (sw_.starts_[k] == j) ts.start_rang = k;
    ts.intern = t.intern;
    ts.start_sample = t.start_sample;
    return ts;
  }

  void abbrechen(int j, Grund g) override {
    if (j < 0 || j >= MAX_TEILE || !sw_.teil_[j].belegt) return;
    sw_.teil_[j].im_zyklus = false;
    sw_.beenden_mit_gruppe(j, Status::abgebrochen, g, sw_.eingriff_sample_, HalterArt::frei);
  }
  void anhalten(int j) override {
    if (j < 0 || j >= MAX_TEILE || !sw_.teil_[j].belegt || sw_.teil_[j].status != Status::gestartet) return;
    sw_.teil_[j].angehalten = true;
  }
  void fortsetzen(int j) override {
    if (j < 0 || j >= MAX_TEILE || !sw_.teil_[j].belegt || !sw_.teil_[j].angehalten) return;
    Stellwerk::Teil& t = sw_.teil_[j];
    t.angehalten = false;
    const int64_t s = sw_.eingriff_sample_;
    const bool v = t.verspaetet;
    t.verspaetet = true;   // Ende vorbei: Schaltrampe (§17 I2), sonst Restrampe bis zum unveränderten Ende-Beat
    sw_.start_parameter(t, sw_.reg_[t.regler].wert, sw_.beat_bei(s), s);
    t.verspaetet = v;
  }
  void gruppe_abbrechen(const char* plan, const char* gruppe, Grund g) override {
    if (!plan || !gruppe || !gruppe[0]) return;
    for (int j = 0; j < MAX_TEILE; j++) {
      const Stellwerk::Teil& t = sw_.teil_[j];
      if (t.belegt && std::strcmp(t.plan, plan) == 0 && std::strcmp(t.gruppe, gruppe) == 0) {
        abbrechen(j, g);   // beendet die ganze Gruppe und meldet gruppe_gefallen
        return;
      }
    }
    sw_.melde_gruppe_gefallen(plan, gruppe, g, sw_.eingriff_sample_);   // nur Deck-Teile übrig: trotzdem melden
  }
  void melde_invariante(InvArt art, const char* plan, int32_t teil_nr) override {
    Ereignis* e = sw_.neues_ereignis(EreignisArt::invariante, sw_.eingriff_sample_);
    if (!e) return;
    e->inv = art;
    std::snprintf(e->plan, TEXT, "%s", plan ? plan : "");
    e->teil = teil_nr;
  }

 private:
  // Wert an s: laufender Teil, dann die vorgemerkten Starts dieses Zyklus am selben Regler in Startfolge bis vor den
  // Rang `bis_rang` (§4.3: eine Rampe beginnt beim Ist-Wert, bei einem Setzen am selben Sample bei dessen Zielwert).
  float rechne(int r, int64_t s, bool setzen_ziel, int bis_rang) const {
    const Stellwerk::ReglerZustand& z = sw_.reg_[r];
    Stellwerk::Teil a, b;
    const Stellwerk::Teil* fahrer = nullptr;
    if (z.laufend >= 0 && !sw_.teil_[z.laufend].angehalten) {
      a = sw_.teil_[z.laufend];
      fahrer = &a;
    }
    for (int k = 0; k < sw_.n_starts_ && k < bis_rang; k++) {
      const Stellwerk::Teil& t = sw_.teil_[sw_.starts_[k]];
      if (t.start_sample > s) break;
      if (!t.belegt || t.regler != r || !t.im_zyklus || t.status != Status::angenommen) continue;
      float w0 = z.wert;
      if (fahrer) {
        if (fahrer->setzen_modus && fahrer->sA == t.start_sample) w0 = fahrer->nach;
        else w0 = sw_.wert_von(*fahrer, t.start_sample, sw_.beat_bei(t.start_sample), nullptr);
      }
      Stellwerk::Teil& neu = (fahrer == &a) ? b : a;
      neu = t;
      sw_.start_parameter(neu, w0, sw_.beat_bei(t.start_sample), t.start_sample);
      fahrer = &neu;
    }
    if (!fahrer) return z.wert;
    if (setzen_ziel && fahrer->setzen_modus) return fahrer->nach;
    return sw_.wert_von(*fahrer, s, sw_.beat_bei(s), nullptr);
  }

  Stellwerk& sw_;
};

Grund Stellwerk::pruefe_vor_start(int idx) {
  eingriff_sample_ = zyklus_s0_;
  SichtImpl s(*this);
  return pruefer_->vor_teilstart(s, s.sicht_von(idx));
}

void Stellwerk::pruefe_je_zyklus() {
  eingriff_sample_ = zyklus_s0_;
  SichtImpl s(*this);
  pruefer_->je_zyklus(s, s);
}

void Stellwerk::pruefe_nach_hand(int r, int64_t sample) {
  eingriff_sample_ = sample;
  SichtImpl s(*this);
  pruefer_->nach_handgriff(s, s, r, sample);
}

void Stellwerk::melde_gruppe_gefallen(const char* plan, const char* gruppe, Grund g, int64_t sample) {
  SichtImpl s(*this);
  pruefer_->gruppe_gefallen(s, plan, gruppe, g, sample);
}

}  // namespace cypherdj::stellwerk
