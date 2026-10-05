// Kern-Attrappe, Maschine: simulierte Uhr, Befehlsannahme, Teile-Lebenslauf, Quittungen, Abonnenten.
// Fachlogik steckt in Modulen (regler, hand, decks, hoerschein, invarianten, frist, ki, erzeuger), die sich
// mit Befehlen, Teil-Arten und Haken anmelden. Mechanik je Block aus proben/09-ki-steuerung/stellwerk.mjs:
// Ereignispunkte im Block nach Sample und Vorrang sortieren (Hand vor Plan am selben Sample), Block an den
// Ereignissen teilen, Beats je Block mit der gerade gültigen Tempo-Karte in Samples umrechnen.

import { Karte, SR, llround, taktVon, phraseVon } from './uhr.mjs';
import { BEFEHLE, AUSGABEN, KERN_VERSION, PROTOKOLL, QUELLEN } from './vertrag.mjs';
import { dekodiere } from './osc.mjs';

export const BLOCK = 256;
export const VORGABE_CFG = {
  version: 1, start_bpm: 128.0, udp_port: 47100, arbeitsbestand: '/dev/shm/cypherdj/material', speicher_budget_mib: 3800,
  controller_geraet: '', ziel_lufs: -16.0, hoerbar_db: -26.0, tief_offen_db: -12.0, max_stretcher: 4, stretcher_threads: 2,
  limiter_dbtp: -1.0, pruefmodus: false, hand_osc: false, filter_guete: 0.707, // §2.1 wie konfig.schema.json (35 B-O, A27)
};
const ABO_FRIST = 5 * SR;          // §4.1: Abonnent nach 5 s Stille gestrichen
const MAX_ABOS = 8;
const OFFEN = new Set(['wartet', 'laeuft', 'halt']);

export class Kern {
  constructor({ cfg = {}, sende = () => {}, module = [], mutationen = [] } = {}) {
    this.cfg = { ...VORGABE_CFG, ...cfg };
    this.sendeFn = sende;
    this.uhr = new Karte(this.cfg.start_bpm);
    this.jetzt = 0;                 // erstes Sample des nächsten Blocks
    this.generation = 0;
    this.neustartSample = 0;
    this.anker = { sample: 0, mono_ns: 0n };
    this.abos = new Map();
    this.befehle = new Map();       // offene Befehle (Status 1, 2, 5) für /q/stand
    this.teile = [];
    this.sofortQ = [];
    this.setNeu = null;
    this.seq = 0;
    this.stempel = 0;
    this.mutation = new Set(mutationen);
    this.beobachte = new Set();
    this.beobachtet = new Map();
    this.gestartetBei = [];
    this.startQ = [];
    this.rest = [];
    this.blockEnde = 0;
    this.stat = { cb_us: [], aufwach_us: [], ausgelassen: 0 };
    this.handler = {};
    this.arten = {};
    this.module = [];
    for (const m of module) this.registriere(m);
    for (const m of this.module) m.init?.(this);
  }

  registriere(m) {
    this.module.push(m);
    Object.assign(this.handler, m.befehle ?? {});
    Object.assign(this.arten, m.arten ?? {});
  }

  // ---------- Ausgang ----------
  aus(adresse, werte, an = null) {
    const def = AUSGABEN[adresse];
    const ports = an === null ? [...this.abos.values()].map((a) => a.port) : [an];
    this.sendeFn({ adresse, typen: def.typen, werte, ports, s: this.stempel });
  }

  q(b, status, grund = '', s = this.stempel) {
    if (!b || b.intern) return;
    b.status = status;
    if (status === 1 || status === 2 || status === 5) this.befehle.set(b.key, b);
    else this.befehle.delete(b.key);
    if (status === 2 || status === 5) b.s_start = s;
    this.aus('/q', [b.id, b.quelle, status, BigInt(s), this.uhr.beat(s), grund]);
  }

  protokollfehler(adresse, grund, von) {
    this.aus('/e/protokollfehler', [adresse, grund]);
    const ports = new Set([...this.abos.values()].map((a) => a.port));
    if (von?.port && !ports.has(von.port)) this.aus('/e/protokollfehler', [adresse, grund], von.port);
  }

  // ---------- Eingang ----------
  empfange(buf, von = { port: 0 }) {
    let m;
    try {
      m = dekodiere(buf);
    } catch {
      return this.protokollfehler('', 'falsche_typen', von);
    }
    this.stempel = this.jetzt;
    if (m.bundle) {
      const h = this.handler['#bundle'];
      return h ? h(this, m, null, von) : this.protokollfehler('#bundle', 'protokoll', von);
    }
    this.nachricht(m, von);
  }

  nachricht(m, von) {
    const def = BEFEHLE[m.adresse];
    if (!def) return this.protokollfehler(m.adresse, 'unbekannte_adresse', von);
    if (def.typen !== m.typen) return this.protokollfehler(m.adresse, 'falsche_typen', von);
    const h = this.handler[m.adresse];
    if (!h) return this.protokollfehler(m.adresse, 'unbekannte_adresse', von);
    const a = {};
    def.felder.forEach((f, i) => { a[f] = m.werte[i]; });
    let b = null;
    if (def.felder[0] === 'id' && def.felder[1] === 'quelle') {
      b = { key: `${a.quelle}:${a.id}`, id: a.id, quelle: a.quelle, adresse: m.adresse, status: 0 };
      if (!QUELLEN.includes(a.quelle)) return this.q(b, 6, 'ausserhalb_bereich');
      if (a.quelle === 'cypher' && this.ki?.gestoppt) return this.q(b, 6, 'ki_gestoppt');
    }
    this.stempel = this.jetzt;
    h(this, a, b, von);
  }

  // Sofort-Befehl: angenommen jetzt, ausgeführt am Anfang des nächsten Zyklus (gestartet und fertig)
  // fertig: false für /k/storno (Vertrag §4.1: Storno quittiert [1, 2] ohne fertig, Andreas 2026-09-25)
  sofort(b, fn, { fertig = true } = {}) {
    this.q(b, 1);
    this.sofortQ.push(() => {
      const g = fn(this.stempel);
      if (g) return this.q(b, 6, g);
      this.q(b, 2);
      if (fertig) this.q(b, 3);
    });
  }

  // ---------- Teile ----------
  teilNeu(b, a, art, extra = {}) {
    return {
      b, art, quelle: a.quelle, plan: a.plan ?? '', teil: a.teil ?? 0, gruppe: a.gruppe ?? '', hoerschein: a.hoerschein ?? '',
      ab: a.ab_beat, dauer: a.dauer_beats ?? 0, politik: a.politik ?? 0, raster: a.raster_beats ?? 0,
      status: 'neu', seq: ++this.seq, ...extra,
    };
  }

  gruppeVon(t) {
    return t.gruppe ? `${t.plan || t.quelle}|${t.gruppe}` : null;
  }

  zielSample(t) {
    return t.s_fest ?? llround(this.uhr.sample(t.ab_eff));
  }

  einsortieren(t) {
    const h = this.arten[t.art];
    const g = h.pruefeEin?.(this, t);
    if (g) return this.q(t.b, 6, g);
    t.ab_eff = t.ab;
    t.dauer_eff = t.dauer;
    const sz = llround(this.uhr.sample(t.ab));
    if (sz < this.jetzt) {
      if (t.politik === 0) return this.q(t.b, 4, 'zu_spaet');
      t.spaet = true;
      if (t.politik === 2) {
        const r = t.raster;
        let b = Math.ceil(this.uhr.beat(this.jetzt) / r - 1e-9) * r;
        while (llround(this.uhr.sample(b)) < this.jetzt) b += r;
        t.ab_eff = b;
      } else {
        t.s_fest = this.jetzt;
        t.ab_eff = this.uhr.beat(this.jetzt);
        t.dauer_eff = Math.max(0, t.ab + t.dauer - t.ab_eff);
      }
    } else {
      this.q(t.b, 1);
    }
    t.status = 'wartet';
    this.teile.push(t);
  }

  starte(t, s) {
    if (t.status !== 'wartet') return;
    const h = this.arten[t.art];
    const g = h.pruefeStart?.(this, t, s);
    if (g === 'warten') return;
    if (g) {
      // Lesart b (Andreas 2026-09-25, §4.3 Feld 11): die übrigen wartenden Teile der Gruppe fallen mit, Quittung 7
      // mit dem Grund des abgelehnten Teils; ersetzt Festlegung F2 des Plans. Gestartete bleiben (Lesart c).
      const gk = this.gruppeVon(t);
      const mit = gk ? this.teile.filter((u) => u !== t && u.status === 'wartet' && this.gruppeVon(u) === gk) : [];
      this.entferne(t);
      t.status = 'abgelehnt';
      this.q(t.b, 6, g, s);
      for (const u of mit) this.abbrechen(u, s, g);
      return;
    }
    t.s_start = s;
    const erg = h.start(this, t, s);
    t.status = erg === 'fertig' ? 'fertig' : 'laeuft';
    this.gestartetBei.push(t);
    this.startQ.push(t);
    if (t.status === 'laeuft' && h.endeSample) {
      const se = h.endeSample(this, t);
      if (se !== null && se < this.blockEnde) this.einplanen({ s: Math.max(se, s), prio: 1, seq: t.seq, tu: () => this.beende(t, Math.max(se, s)) });
    }
  }

  beende(t, s) {
    if (t.status !== 'laeuft') return;
    this.arten[t.art].ende?.(this, t, s);
    t.status = 'fertig';
    this.entferne(t);
    const i = this.startQ.indexOf(t);
    if (i >= 0) { this.startQ.splice(i, 1); this.startQuittung(t, s); }
    this.q(t.b, 3, '', s);
  }

  abbrechen(t, s, grund, { rueck = false } = {}) {
    if (!OFFEN.has(t.status) && !(rueck && this.gestartetBei.includes(t))) return;
    const h = this.arten[t.art];
    if (rueck && this.gestartetBei.includes(t)) h.rueck?.(this, t, s);
    else if (t.status === 'laeuft' || t.status === 'halt') h.abbruch?.(this, t, s);
    const i = this.startQ.indexOf(t);
    if (i >= 0) this.startQ.splice(i, 1);
    t.status = 'abgebrochen';
    this.entferne(t);
    this.q(t.b, 7, grund, s);
  }

  gruppeAbbrechen(t, s, grund, opt = {}) {
    const gk = this.gruppeVon(t);
    const mit = gk ? this.teile.filter((u) => u !== t && OFFEN.has(u.status) && this.gruppeVon(u) === gk) : [];
    this.abbrechen(t, s, grund, opt);
    for (const u of mit) this.abbrechen(u, s, grund, { rueck: opt.rueck && this.gestartetBei.includes(u) });
    return [t, ...mit];
  }

  entferne(t) {
    const i = this.teile.indexOf(t);
    if (i >= 0) this.teile.splice(i, 1);
  }

  // Quittung beim Start: 2 gestartet, bei Verspätung 5 verspaetet_ausgefuehrt mit Grund "" (§5.1, §16.2;
  // Lesart i entschieden 2026-09-25: "" wie Kern 08; ersetzt Festlegung F4 des Plans)
  startQuittung(t, s) {
    if (t.spaet) this.q(t.b, 5, '', s);
    else this.q(t.b, 2, '', s);
  }

  offeneTeile() {
    return this.teile.filter((t) => OFFEN.has(t.status));
  }

  flushStartQ(s) {
    for (const t of this.startQ) {
      if (t.status === 'fertig') { this.startQuittung(t, s); this.q(t.b, 3, '', s); this.entferne(t); }
      else if (t.status === 'laeuft' || t.status === 'halt') this.startQuittung(t, s);
    }
    this.startQ = [];
  }

  // ---------- Block ----------
  einplanen(p) {
    let i = this.rest.length;
    while (i > 0 && (this.rest[i - 1].s > p.s || (this.rest[i - 1].s === p.s && this.rest[i - 1].prio > p.prio))) i--;
    this.rest.splice(i, 0, p);
  }

  monoBei(s) {
    return this.anker.mono_ns + BigInt(Math.round(((s - this.anker.sample) * 1e9) / SR));
  }

  block(n = BLOCK) {
    const t0 = process.hrtime.bigint();
    if (this.setNeu) {
      const { bpm, b } = this.setNeu;
      this.setNeu = null;
      this.anker = { sample: 0, mono_ns: this.monoBei(this.jetzt) };
      this.jetzt = 0;
      this.uhr = new Karte(bpm);
      this.generation = 0;
      this.stempel = 0;
      // Nachtrag Plan 13 (B6 c): /k/set/neu bricht offene Tempo-Rampen mit [7 abbruch] ab, wie Kern 08
      for (const t of this.teile.filter((u) => u.art === 'tempo')) this.abbrechen(t, 0, 'abbruch');
      this.q(b, 2, '', 0);
      this.q(b, 3, '', 0);
      for (const m of this.module) m.setNeu?.(this);
    }
    const s0 = this.jetzt;
    const s1 = s0 + n;
    this.blockEnde = s1;
    this.uhr.verwerfe(s0);
    const punkte = [];
    for (const fn of this.sofortQ.splice(0)) punkte.push({ s: s0, prio: -1, seq: 0, tu: fn });
    for (const t of this.teile) {
      if (t.status === 'wartet') {
        let s = this.zielSample(t);
        if (s < s0) {
          if (!t.i2warten && t.politik === 0 && !t.spaet) {        // verpasst (etwa nach einem Neustart)
            punkte.push({ s: s0, prio: 2, seq: t.seq, tu: () => { if (t.status === 'wartet') { t.status = 'verworfen'; this.entferne(t); this.q(t.b, 4, 'zu_spaet', s0); } } });
            continue;
          }
          if (!t.i2warten) t.spaet = true;
          s = s0;
        }
        if (s < s1) punkte.push({ s, prio: 2, seq: t.seq, tu: () => this.starte(t, s) });
      } else if (t.status === 'laeuft' && this.arten[t.art].endeSample) {
        let s = this.arten[t.art].endeSample(this, t);
        if (s !== null && s < s1) {
          if (s < s0) s = s0;
          punkte.push({ s, prio: 1, seq: t.seq, tu: () => this.beende(t, s) });
        }
      }
    }
    for (const m of this.module) if (m.punkte) punkte.push(...m.punkte(this, s0, s1));
    for (let b = 4 * Math.floor(this.uhr.beat(s0) / 4); ; b += 4) {
      const s = llround(this.uhr.sample(b));
      if (s >= s1) break;
      if (s >= s0) punkte.push({ s, prio: 9, seq: 0, tu: () => this.aus('/takt', [taktVon(b), phraseVon(b), BigInt(s), b, this.uhr.bpmBeiBeat(b)]) });
    }
    for (const s of this.beobachte) if (s >= s0 && s < s1) punkte.push({ s, prio: 99, seq: 0, tu: () => {} });
    punkte.sort((a, b) => a.s - b.s || a.prio - b.prio || a.seq - b.seq);
    this.rest = punkte;
    while (this.rest.length) {
      const s = this.rest[0].s;
      this.stempel = s;
      this.gestartetBei = [];
      this.startQ = [];
      while (this.rest.length && this.rest[0].s === s) this.rest.shift().tu();
      for (const m of this.module) m.nachSample?.(this, s);
      this.flushStartQ(s);
      if (this.beobachte.has(s)) this.beobachtet.set(s, this.schnappschuss(s));
    }
    this.stempel = s0;
    this.gestartetBei = [];
    for (const m of this.module) m.nachBlock?.(this, s0, s1);
    this.stempel = s0;
    this.ausgaben(s0, s1);
    for (const m of this.module) m.ausgaben?.(this, s0, s1);
    this.jetzt = s1;
    this.stat.cb_us.push(Number(process.hrtime.bigint() - t0) / 1000);
  }

  schnappschuss(s) {
    const w = {};
    for (const m of this.module) Object.assign(w, m.schnappschuss?.(this, s) ?? {});
    return w;
  }

  ausgaben(s0, s1) {
    this.aus('/uhr', [BigInt(s0), this.monoBei(s0), this.uhr.beat(s0), this.uhr.bpm(s0), this.uhr.kBei(s0)]);
    for (const [name, a] of this.abos) if (s0 - a.letzte > ABO_FRIST) this.abos.delete(name);
    if (Math.floor((s1 - 1) / 2400) !== Math.floor((s0 - 1) / 2400)) {
      const cb = this.stat.cb_us.splice(0);
      const aw = this.stat.aufwach_us.splice(0);
      const sortiert = [...cb].sort((x, y) => x - y);
      const p99 = sortiert.length ? sortiert[Math.min(sortiert.length - 1, Math.floor(sortiert.length * 0.99))] : 0;
      const wartend = [...this.befehle.values()].filter((b) => b.status === 1).length;
      this.aus('/zustand/kern', [this.generation, BLOCK, BigInt(s0), 0, this.stat.ausgelassen,
        Math.round(Math.max(0, ...cb)), Math.round(p99), Math.round(Math.max(0, ...aw)), 0, wartend, this.ki?.gestoppt ? 1 : 0]);
    }
  }
}

// ---------- Kern-eigene Befehle: Verbindung, Zeitachse, Tempo, Storno ----------
export const verbindung = {
  name: 'verbindung',
  befehle: {
    '/k/hallo': (K, a) => {
      if (a.protokoll !== PROTOKOLL) return K.aus('/e/protokollfehler', ['/k/hallo', 'protokoll'], a.port);
      const alt = K.abos.get(a.name);
      // wie Kern 08 (B6 g): der 9. Abonnent bekommt keine Antwort, nur eine Zeile auf stderr
      if (!alt && K.abos.size >= MAX_ABOS) { console.error(`mehr als ${MAX_ABOS} Abonnenten, ${a.name} abgewiesen`); return; }
      const neueGeneration = !alt || alt.gen !== K.generation;
      K.abos.set(a.name, { name: a.name, port: a.port, protokoll: a.protokoll, letzte: K.jetzt, gen: K.generation });
      K.aus('/k/willkommen', [PROTOKOLL, K.generation, BigInt(K.jetzt), K.uhr.beat(K.jetzt), K.uhr.bpm(K.jetzt), KERN_VERSION], a.port);
      if (neueGeneration && K.generation > 0) {
        K.aus('/e/neustart', [K.generation, BigInt(K.neustartSample)], a.port);
        for (const b of K.befehle.values()) {
          const s = b.status === 1 ? K.jetzt : b.s_start ?? K.jetzt;
          K.aus('/q/stand', [b.id, b.quelle, b.status === 5 ? 2 : b.status, BigInt(s), K.uhr.beat(s), ''], a.port);
        }
      }
    },
    '/k/tschuess': (K, a) => { K.abos.delete(a.name); },
    '/k/set/neu': (K, a, b) => {
      if (K.decks?.some((d) => d && [2, 3, 4, 5].includes(d.status))) return K.q(b, 6, 'deck_laeuft');
      if (!(a.start_bpm >= 60 && a.start_bpm <= 200)) return K.q(b, 6, 'ausserhalb_bereich');
      K.q(b, 1);
      K.setNeu = { bpm: a.start_bpm, b };
    },
    '/k/tempo/rampe': (K, a, b) => {
      K.einsortieren(K.teilNeu(b, { ...a, politik: 1 }, 'tempo', { ziel: a.ziel_bpm }));
    },
    '/k/storno': (K, a, b) => {
      const ziel = `${a.quelle}:${a.ziel_id}`;
      K.sofort(b, (s) => {
        const t = K.teile.find((u) => u.b?.key === ziel && u.status === 'wartet');
        if (!t) return 'zu_spaet';
        t.status = 'storniert';
        K.entferne(t);
        K.q(t.b, 8, '', s);
        return null;
      }, { fertig: false });
    },
  },
  arten: {
    tempo: {
      pruefeEin(K, t) {
        if (!(t.ziel >= 60 && t.ziel <= 200) || !(t.dauer >= 1)) return 'ausserhalb_bereich';
        if (K.decks?.some((d) => d && [2, 3, 4, 5].includes(d.status))) return 'kein_stretcher';
        const wartend = K.teile.filter((u) => u.art === 'tempo' && u.status === 'wartet').length;
        // wie Kern 08 (B6 d): überlappende Tempo-Rampe -> 6 ueberlappung
        // Bedingung wie ueberlappt() aus regler.mjs (Task 6), hier ausgeschrieben: kern.mjs entsteht in Task 4; vor karte_voll wie tempoplan.cpp
        if (K.teile.some((u) => u.art === 'tempo' && u.status === 'wartet' && t.ab < u.ab + u.dauer && u.ab < t.ab + t.dauer)) return 'ueberlappung';
        if (K.uhr.segmenteNachRampe(t.ab) + 2 * wartend > 64) return 'karte_voll';
        return null;
      },
      pruefeStart(K, t) {
        if (K.decks?.some((d) => d && [2, 3, 4, 5].includes(d.status))) return 'kein_stretcher';
        if (K.uhr.segmenteNachRampe(t.ab_eff) > 64) return 'karte_voll';
        return null;
      },
      start(K, t) {
        K.uhr.rampe(t.ab_eff, t.ziel, t.dauer_eff);
        return t.dauer_eff > 0 ? 'laeuft' : 'fertig';
      },
      endeSample(K, t) {
        return llround(K.uhr.sample(t.ab_eff + t.dauer_eff));
      },
    },
  },
};
