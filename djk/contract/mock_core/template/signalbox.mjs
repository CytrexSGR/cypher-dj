// Stellwerk: Prototyp der Ausfuehrungsschicht (Dossier 09, Probe b).
//
// Aufgabe: Plaene der KI (in Takten und Schlaegen) sample-genau ausfuehren, zwischen Mensch und KI
// schlichten (die Hand hat Vorrang, sofort, je Regler), Plaene ganz oder teilweise abbrechen,
// Zustand je Takt und Ereignisse melden. Laeuft hier gegen eine simulierte Uhr (Sample-Zaehler);
// im echten System sitzt der Echtzeit-Teil (block()) im Deck-Kern, der Rest (einreichen()) davor.
//
// Leitsaetze, die der Code festhaelt:
//  1. Plaene leben in Schlaegen, nicht in Samples. Die Umrechnung passiert je Block mit der Tempokarte,
//     die in diesem Moment gilt. Zieht jemand das Tempo, bleiben Rampenenden und Schaltpunkte auf dem Takt.
//  2. Ein Ereignis wirkt an genau seinem Sample, auch mitten im Block (Block wird dort geteilt).
//  3. Die Hand gewinnt am selben Sample gegen jeden Plan. Abgebrochen wird nur, was an diesem Regler
//     haengt (und was mit ihm gekoppelt ist, Feld `gruppe`), nicht der ganze Plan.
//  4. Was ein Deck hoerbar macht, braucht einen gueltigen Hoerschein (A4). Geprueft bei Annahme und
//     noch einmal am Start-Sample.
//  5. Kein Sprung beim Uebernehmen: der Wert startet dort, wo er steht; Regler-Uebernahme
//     "skaliert", "pickup", "relativ" oder (zum Vergleich) "sprung".

export const HOERBAR = 0.05;          // Gain darunter gilt als unhoerbar (Annahme, spaeter aus LUFS)
export const MAX_SYNC_MS = 2.0;       // Hoerschein: Phasenfehler hoechstens
export const MAX_TEMPO_ABW = 0.005;   // Hoerschein gilt nur bei gleichem Tempo (+-0,5 %)

export class Uhr {
  constructor({ sr = 48000, bpm = 128, schlaegeProTakt = 4 } = {}) {
    this.sr = sr;
    this.spt = schlaegeProTakt;
    this.seg = [{ abSample: 0, abSchlag: 0, bpm }];
  }
  segBeiSample(s) {
    let g = this.seg[0];
    for (const x of this.seg) { if (x.abSample <= s) g = x; else break; }
    return g;
  }
  schlagBei(s) {
    const g = this.segBeiSample(s);
    return g.abSchlag + ((s - g.abSample) * g.bpm) / (60 * this.sr);
  }
  bpmBei(s) { return this.segBeiSample(s).bpm; }
  // kleinstes ganzzahliges Sample s mit schlagBei(s) >= schlag (nach der Tempokarte von jetzt)
  sampleBeiSchlag(schlag) {
    let g = this.seg[0];
    for (const x of this.seg) { if (x.abSchlag <= schlag) g = x; else break; }
    let s = Math.ceil(g.abSample + ((schlag - g.abSchlag) * 60 * this.sr) / g.bpm - 1e-7);
    while (this.schlagBei(s) < schlag - 1e-9) s++;
    while (s > 0 && this.schlagBei(s - 1) >= schlag - 1e-9) s--;
    return s;
  }
  setzeTempo(abSample, bpm) {
    const abSchlag = this.schlagBei(abSample);
    this.seg = this.seg.filter((g) => g.abSample < abSample);
    this.seg.push({ abSample, abSchlag, bpm });
  }
  position(s) {
    const b = this.schlagBei(s);
    return { takt: Math.floor(b / this.spt) + 1, schlag: Math.floor(b % this.spt) + 1, anteil: +(b % 1).toFixed(4) };
  }
}

export const schlagVon = (pos, spt = 4) => (pos.takt - 1) * spt + ((pos.schlag ?? 1) - 1) + (pos.anteil ?? 0);
const deckVon = (regler) => regler.split('.')[0];
const klemme = (x) => Math.max(0, Math.min(1, x));

export class Stellwerk {
  constructor({ uhr, regler, decks = {}, hoerscheine = {}, optionen = {} }) {
    this.uhr = uhr;
    this.opt = {
      vorlaufSchlaege: 1,          // Plan muss mindestens so weit vor seinem Start ankommen
      ruheTakte: 8,                // so lange ohne Handbewegung, dann gilt der Regler wieder als frei
      quantisierung: 'sample',     // 'sample' (Soll) | 'block' (Vergleich: naiv, wirkt erst an der Blockgrenze)
      schiedsrichter: true,        // false = Vergleich: Hand schreibt, Plan schreibt weiter (Kampf)
      abbruch: 'teil',             // 'teil' (Soll) | 'plan' (Vergleich: Hand bricht ganzen Plan ab)
      uebernahme: 'skaliert',      // 'skaliert' | 'pickup' | 'relativ' | 'sprung'
      einrastToleranz: 0.02,
      regeln: ['sub_nie_doppelt'],
      ...optionen,
    };
    this.r = {};
    for (const [name, w] of Object.entries(regler)) {
      this.r[name] = { wert: w, halter: 'frei', spur: null, physisch: w, eingerastet: true, letzteHand: null };
    }
    this.decks = decks;
    this.hoerscheine = hoerscheine;
    this.plaene = {};
    this.handQ = [];               // Handereignisse mit Sample-Zeitstempel (wie JACK-MIDI-Frames)
    this.ereignisse = [];
    this.seq = 0;
    this.jetzt = 0;                // naechstes zu rechnendes Sample
    this.beobachte = new Set();    // Samples, deren Werte festgehalten werden
    this.beobachtet = {};
    this.letzter = {};             // letzter geschriebener Wert je Regler (fuer Sprungmessung)
    this.maxSprung = {};
    this.stufen = [];              // Wertwechsel > 0,01 von einem Sample zum naechsten
  }

  melde(typ, sample, daten = {}) {
    const e = { seq: ++this.seq, typ, sample, ...this.uhr.position(sample), ...daten };
    this.ereignisse.push(e);
    return e;
  }

  // ---------- nicht-echtzeitseitig: Plan annehmen oder verriegeln ----------
  hoerscheinPruefen(plan, teil, abS) {
    const hs = plan.hoerschein && this.hoerscheine[plan.hoerschein];
    const deck = deckVon(teil.regler);
    if (!hs) return 'kein_hoerschein';
    if (hs.deck !== deck) return 'hoerschein_anderes_deck';
    if (this.decks[deck] && hs.material !== this.decks[deck].material) return 'hoerschein_anderes_material';
    if (hs.sync_fehler_ms > MAX_SYNC_MS) return 'hoerschein_nicht_sync';
    const bpmJetzt = this.uhr.bpmBei(this.jetzt);
    if (Math.abs(hs.bpm - bpmJetzt) / bpmJetzt > MAX_TEMPO_ABW) return 'hoerschein_anderes_tempo';
    if (hs.gueltig_bis_schlag < abS) return 'hoerschein_abgelaufen';
    return null;
  }

  machtHoerbar(teil, wertVorher) {
    return /\.gain$/.test(teil.regler) && teil.nach > HOERBAR && wertVorher < HOERBAR;
  }

  einreichen(plan) {
    const jetztS = this.uhr.schlagBei(this.jetzt);
    const gruende = [];
    const teile = plan.teile.map((t, i) => {
      const abS = schlagVon(t.ab, this.uhr.spt);
      const dauer = t.art === 'rampe' ? (t.dauer.takte ?? 0) * this.uhr.spt + (t.dauer.schlaege ?? 0) : 0;
      return { ...t, i, abS, bisS: abS + dauer, status: 'wartet' };
    });
    for (const t of teile) {
      const r = this.r[t.regler];
      if (!r) { gruende.push({ teil: t.i, grund: 'unbekannter_regler', regler: t.regler }); continue; }
      if (t.abS < jetztS + this.opt.vorlaufSchlaege) {
        gruende.push({ teil: t.i, grund: 'zu_spaet', ab_schlag: t.abS, fruehestens_schlag: +(jetztS + this.opt.vorlaufSchlaege).toFixed(3) });
      }
      if (r.halter === 'mensch') gruende.push({ teil: t.i, grund: 'regler_beim_menschen', regler: t.regler });
      for (const p of Object.values(this.plaene)) {
        for (const u of p.teile) {
          if (u.regler === t.regler && (u.status === 'wartet' || u.status === 'laeuft') && u.abS <= t.bisS && t.abS <= u.bisS) {
            gruende.push({ teil: t.i, grund: 'regler_verplant', regler: t.regler, von_plan: p.id });
          }
        }
      }
      if (this.machtHoerbar(t, this.wertVorher(teile, t))) {
        const g = this.hoerscheinPruefen(plan, t, t.abS);
        if (g) gruende.push({ teil: t.i, grund: g, regler: t.regler });
        t.brauchtHoerschein = true;
      }
    }
    if (this.opt.regeln.includes('sub_nie_doppelt')) {
      const k = this.subDoppelt(teile, jetztS);
      if (k !== null) gruende.push({ grund: 'sub_doppelt', ab_schlag: k });
    }
    if (gruende.length) {
      this.melde('plan_verriegelt', this.jetzt, { plan: plan.id, gruende });
      return { status: 'verriegelt', plan: plan.id, gruende };
    }
    this.plaene[plan.id] = { id: plan.id, von: plan.von ?? 'cypher', hoerschein: plan.hoerschein ?? null, teile, status: 'angenommen' };
    const start = Math.min(...teile.map((t) => t.abS));
    const e = this.melde('plan_angenommen', this.jetzt, { plan: plan.id, start_schlag: start, start_sample_nach_heutiger_tempokarte: this.uhr.sampleBeiSchlag(start) });
    return { status: 'angenommen', plan: plan.id, seq: e.seq, start_schlag: start };
  }

  wertVorher(teile, t) {
    // Wert des Reglers direkt vor dem Teil: aktueller Wert, veraendert durch fruehere Teile desselben Plans
    let w = this.r[t.regler].wert;
    for (const u of teile) if (u !== t && u.regler === t.regler && u.bisS <= t.abS) w = u.nach;
    return w;
  }

  subDoppelt(teile, abS) {
    const ende = Math.max(abS, ...teile.map((t) => t.bisS)) + 1;
    const decksMitBass = Object.keys(this.r).filter((n) => n.endsWith('.bass')).map(deckVon);
    for (let b = Math.ceil(abS); b <= ende; b++) {
      let n = 0;
      for (const d of decksMitBass) {
        const g = this.planWert(teile, `${d}.gain`, b), ba = this.planWert(teile, `${d}.bass`, b);
        if (g > HOERBAR && ba > 0.5) n++;
      }
      if (n >= 2) return b;
    }
    return null;
  }

  planWert(teile, regler, b) {
    if (!this.r[regler]) return 0;
    let w = this.r[regler].wert;
    for (const t of teile.filter((u) => u.regler === regler).sort((x, y) => x.abS - y.abS)) {
      if (b < t.abS) break;
      if (t.art === 'setze' || b >= t.bisS) w = t.nach;
      else w = w + (t.nach - w) * ((b - t.abS) / (t.bisS - t.abS));
    }
    return w;
  }

  // ---------- Hand: kommt mit Sample-Zeitstempel (JACK-MIDI-Frame) ----------
  hand(e) { this.handQ.push(e); this.handQ.sort((a, b) => a.sample - b.sample); }

  // ---------- echtzeitseitig: einen Block rechnen ----------
  imFenster(s, s0, s1, n) {
    if (this.opt.quantisierung === 'sample') return s >= s0 && s < s1 ? s : null;
    return s > s0 - n && s <= s0 ? s0 : null;     // naiv: erst an der naechsten Blockgrenze
  }

  block(n) {
    const s0 = this.jetzt, s1 = s0 + n;
    const punkte = [];
    for (const h of this.handQ) {
      const s = this.imFenster(h.sample, s0, s1, n);
      if (s !== null) punkte.push({ s, prio: 0, art: 'hand', e: h });
    }
    for (const p of Object.values(this.plaene)) {
      for (const t of p.teile) {
        if (t.status === 'wartet') {
          const s = this.imFenster(this.uhr.sampleBeiSchlag(t.abS), s0, s1, n);
          if (s !== null) punkte.push({ s, prio: 2, art: 'start', p, t });
        } else if (t.status === 'laeuft') {
          const s = this.imFenster(this.uhr.sampleBeiSchlag(t.bisS), s0, s1, n);
          if (s !== null) punkte.push({ s, prio: 1, art: 'ende', p, t });
        }
      }
    }
    for (const [name, r] of Object.entries(this.r)) {
      if (r.halter === 'mensch' && r.letzteHand !== null) {
        const sf = this.uhr.sampleBeiSchlag(this.uhr.schlagBei(r.letzteHand) + this.opt.ruheTakte * this.uhr.spt);
        if (sf >= s0 && sf < s1) punkte.push({ s: sf, prio: 3, art: 'ruhe', name, seit: r.letzteHand });
      }
    }
    const spt = this.uhr.spt;
    for (let b = Math.ceil(this.uhr.schlagBei(s0) / spt - 1e-12) * spt; ; b += spt) {
      const s = this.uhr.sampleBeiSchlag(b);
      if (s >= s1) break;
      if (s >= s0) punkte.push({ s, prio: 9, art: 'takt' });
    }
    punkte.sort((a, b) => a.s - b.s || a.prio - b.prio);
    let cur = s0;
    for (const pk of punkte) {
      this.schreibe(cur, pk.s);
      this.anwenden(pk);
      cur = pk.s;
    }
    this.schreibe(cur, s1);
    this.handQ = this.handQ.filter((h) => this.imFenster(h.sample, s0, s1, n) === null && h.sample >= s1 - (this.opt.quantisierung === 'block' ? n : 0));
    this.jetzt = s1;
  }

  rampenWert(sp, s) {
    const b = this.uhr.schlagBei(s);
    return sp.von + (sp.nach - sp.von) * Math.max(0, Math.min(1, (b - sp.abS) / (sp.bisS - sp.abS)));
  }

  schreibe(a, b) {
    if (b <= a) return;
    const block = this.opt.quantisierung === 'block';
    for (const [name, r] of Object.entries(this.r)) {
      const sp = r.spur;
      const halt = sp && block ? this.rampenWert(sp, a) : null;   // naiv: ein Wert je Block (Treppe)
      for (let s = a; s < b; s++) {
        const v = sp ? (block ? halt : this.rampenWert(sp, s)) : r.wert;
        const l = this.letzter[name];
        if (l !== undefined) {
          const d = Math.abs(v - l);
          if (d > (this.maxSprung[name]?.d ?? -1)) this.maxSprung[name] = { d, sample: s };
          if (d > 0.01) this.stufen.push({ regler: name, sample: s, von: +l.toFixed(4), nach: +v.toFixed(4) });
        }
        this.letzter[name] = v;
        if (this.beobachte.has(s)) (this.beobachtet[s] ??= {})[name] = v;
      }
      if (sp) r.wert = this.rampenWert(sp, b);  // Wert am naechsten Sample, falls dort etwas passiert
    }
  }

  anwenden(pk) {
    const { s } = pk;
    if (pk.art === 'takt') return this.meldeTakt(s);
    if (pk.art === 'hand') return this.handAnwenden(pk.e, s);
    if (pk.art === 'ruhe') {
      const r = this.r[pk.name];
      if (r.halter === 'mensch' && r.letzteHand === pk.seit) {
        r.halter = 'frei';
        this.melde('regler_frei', s, { regler: pk.name, grund: 'ruhefrist', ruhe_takte: this.opt.ruheTakte });
      }
      return;
    }
    const { p, t } = pk;
    const r = this.r[t.regler];
    // Im selben Block vorher abgebrochen oder verriegelt? Dann gilt der vorab gesammelte Punkt nicht mehr.
    if (pk.art === 'start' && t.status !== 'wartet') return;
    if (pk.art === 'ende' && t.status !== 'laeuft') return;
    if (pk.art === 'start') {
      // Zweitpruefung am Start-Sample
      let grund = null;
      if (r.halter === 'mensch' && this.opt.schiedsrichter) grund = 'regler_beim_menschen';
      else if (t.brauchtHoerschein) grund = this.hoerscheinPruefen(p, t, t.abS);
      if (grund) {
        const mit = p.teile.filter((u) => u === t || (t.gruppe && u.gruppe === t.gruppe && (u.status === 'wartet' || u.status === 'laeuft')));
        for (const u of mit) {
          if (u.status === 'laeuft') { const ru = this.r[u.regler]; ru.wert = this.rampenWert(ru.spur, s); ru.spur = null; ru.halter = 'frei'; }
          u.status = 'verriegelt';
        }
        this.melde('plan_teil_verriegelt', s, { plan: p.id, teile: mit.map((u) => u.i), regler: mit.map((u) => u.regler), grund });
        return this.planFertig(p, s);
      }
      if (t.art === 'setze') {
        r.wert = t.nach; r.spur = null;
        t.status = 'fertig';
        this.melde('plan_teil_fertig', s, { plan: p.id, teil: t.i, regler: t.regler, wert: t.nach });
        return this.planFertig(p, s);
      }
      if (Math.abs((t.von ?? r.wert) - r.wert) > 0.01) {
        this.melde('startwert_angepasst', s, { plan: p.id, teil: t.i, regler: t.regler, plan_von: t.von, ist: +r.wert.toFixed(4) });
      }
      r.spur = { abS: t.abS, bisS: t.bisS, von: r.wert, nach: t.nach, plan: p.id, teil: t.i };
      r.halter = `plan:${p.id}`;
      t.status = 'laeuft';
      this.melde('plan_teil_start', s, { plan: p.id, teil: t.i, regler: t.regler, von: +r.wert.toFixed(4), nach: t.nach });
      return;
    }
    if (pk.art === 'ende') {
      r.wert = t.nach; r.spur = null; r.halter = 'frei';
      t.status = 'fertig';
      this.melde('plan_teil_fertig', s, { plan: p.id, teil: t.i, regler: t.regler, wert: t.nach });
      return this.planFertig(p, s);
    }
  }

  planFertig(p, s) {
    if (p.teile.every((t) => t.status !== 'wartet' && t.status !== 'laeuft') && p.status === 'angenommen') {
      const alle = p.teile.every((t) => t.status === 'fertig');
      p.status = alle ? 'vollstaendig' : 'teilweise';
      this.melde('plan_ende', s, { plan: p.id, status: p.status, teile: p.teile.map((t) => ({ teil: t.i, regler: t.regler, status: t.status })) });
    }
  }

  brichAb(planId, regler, s, grund) {
    const p = this.plaene[planId];
    if (!p) return;
    const offen = (t) => t.status === 'wartet' || t.status === 'laeuft';
    let ziel;
    if (this.opt.abbruch === 'plan') ziel = p.teile.filter(offen);
    else {
      const direkt = p.teile.filter((t) => offen(t) && t.regler === regler);
      const gruppen = new Set(direkt.map((t) => t.gruppe).filter(Boolean));
      ziel = p.teile.filter((t) => offen(t) && (t.regler === regler || (t.gruppe && gruppen.has(t.gruppe))));
    }
    const werte = {};
    for (const t of ziel) {
      const r = this.r[t.regler];
      if (t.status === 'laeuft' && r.spur && r.spur.plan === planId) {
        r.wert = this.rampenWert(r.spur, s);
        r.spur = null;
        r.halter = t.regler === regler ? r.halter : 'frei';
      }
      werte[t.regler] = +r.wert.toFixed(6);
      t.status = 'abgebrochen';
    }
    this.melde('plan_teil_abgebrochen', s, { plan: planId, grund, ausloeser: regler, teile: ziel.map((t) => t.i), regler: ziel.map((t) => t.regler), werte });
    this.planFertig(p, s);
  }

  handAnwenden(e, s) {
    const r = this.r[e.regler];
    this.melde('hand', s, { regler: e.regler, art: e.art, wert: e.wert, delta: e.delta, sample_eingang: e.sample, verzug_samples: s - e.sample });
    if (e.art === 'freigabe') {
      r.halter = 'frei';
      this.melde('regler_frei', s, { regler: e.regler, grund: 'freigabe' });
      return;
    }
    if (this.opt.schiedsrichter) {
      // Jeder Plan mit offenen Teilen an diesem Regler (laufend ODER wartend) verliert sie sofort,
      // samt gekoppelten Teilen. So erfaehrt die KI es jetzt, nicht erst am Startpunkt.
      for (const p of Object.values(this.plaene)) {
        if (p.teile.some((t) => t.regler === e.regler && (t.status === 'wartet' || t.status === 'laeuft'))) {
          this.brichAb(p.id, e.regler, s, 'hand');
        }
      }
      if (r.halter !== 'mensch') {
        const vorher = r.halter;
        r.halter = 'mensch';
        r.eingerastet = this.opt.uebernahme === 'sprung' || this.opt.uebernahme === 'relativ';
        this.melde('regler_uebernommen', s, { regler: e.regler, von: vorher, wert: +r.wert.toFixed(6), modus: this.opt.uebernahme });
      }
    } else if (r.spur) {
      // naiv ohne Schiedsrichter: Hand schreibt einmal, die Spur laeuft weiter und ueberschreibt
      r.wert = e.wert;
      r.physisch = e.wert;
      return;
    }
    r.letzteHand = s;
    if (e.art === 'beruehrung') return;             // Touch-Sensor: halten ohne Wertaenderung
    const alt = r.physisch, neu = e.art === 'relativ' ? null : e.wert;
    const m = this.opt.uebernahme;
    if (e.art === 'relativ') {
      r.wert = klemme(r.wert + e.delta);
    } else if (m === 'sprung' || r.eingerastet) {
      r.wert = neu;
      r.eingerastet = true;
    } else if (m === 'pickup') {
      const gekreuzt = alt !== null && (alt - r.wert) * (neu - r.wert) <= 0;
      if (gekreuzt || Math.abs(neu - r.wert) <= this.opt.einrastToleranz) { r.wert = neu; r.eingerastet = true; }
    } else if (m === 'skaliert') {
      // Wert laeuft in Drehrichtung mit, so skaliert, dass Knopf und Wert gemeinsam am Anschlag ankommen
      if (alt !== null && neu > alt && alt < 1) r.wert = r.wert + (neu - alt) * (1 - r.wert) / (1 - alt);
      else if (alt !== null && neu < alt && alt > 0) r.wert = r.wert - (alt - neu) * r.wert / alt;
      if (Math.abs(neu - r.wert) <= 1e-3) r.eingerastet = true;
    }
    if (neu !== null) r.physisch = neu;
  }

  meldeTakt(s) {
    const regler = {};
    for (const [n, r] of Object.entries(this.r)) {
      const v = r.spur ? this.rampenWert(r.spur, s) : r.wert;
      regler[n] = { wert: +v.toFixed(4), halter: r.halter };
    }
    const plaene = {};
    for (const p of Object.values(this.plaene)) plaene[p.id] = { status: p.status, teile: p.teile.map((t) => t.status) };
    this.melde('takt', s, { bpm: this.uhr.bpmBei(s), regler, plaene });
  }
}
