// Ohr (Plan 2026-09-28): liest den Hüllkurven-Ring §6.2 und rechnet daraus Messung, Überdeckung und EQ-Vorschlag.
// Reine Funktionen (M5, Review): der Server (server.ts) verdrahtet nur, feste Uhr in den Tests. OhrLeser hält den
// Zustand des inkrementellen Lesens; alles andere hier ist zustandslos.
import fs from 'node:fs';

export const BAENDER = ['sub', 'tief', 'tiefmitte', 'mitte', 'praesenz', 'hoch'] as const;
export type Band = (typeof BAENDER)[number];
export const K = { deck1: 0, deck2: 1, erz1: 4, pad1: 12, pad2: 13, master: 14, cue: 15 } as const;

export interface Satz {
  sample: number;
  beat: number;
  quell: number; // NaN außer Decks
  band: number[]; // 6 Werte, RMS linear
  k: number; // K-gewichtete Leistung (BS.1770)
  spitze: number; // Betragsmaximum
}

const KOPF_BYTES = 64;
const SATZ_BYTES = 64;
const KANAELE_IM_RING = 16;
const MAGIC = 'CDJH';
const VERSION = 1;
const RATE_HZ = 1000;

interface Kopf {
  cap: number;
  w: bigint;
}

function liesKopf(fd: number): Kopf | null {
  const buf = Buffer.alloc(KOPF_BYTES);
  const n = fs.readSync(fd, buf, 0, KOPF_BYTES, 0);
  if (n < KOPF_BYTES) return null;
  if (buf.toString('ascii', 0, 4) !== MAGIC) return null;
  const version = buf.readUInt32LE(4);
  const rate = buf.readUInt32LE(8);
  const kanaele = buf.readUInt32LE(12);
  const cap = buf.readUInt32LE(16);
  if (version !== VERSION || rate !== RATE_HZ || kanaele !== KANAELE_IM_RING) return null;
  const w = buf.readBigUInt64LE(32);
  return { cap, w };
}

function liesSatz(buf: Buffer, off: number): Satz {
  return {
    sample: Number(buf.readBigInt64LE(off)),
    beat: buf.readDoubleLE(off + 8),
    quell: buf.readDoubleLE(off + 16),
    band: [
      buf.readFloatLE(off + 24),
      buf.readFloatLE(off + 28),
      buf.readFloatLE(off + 32),
      buf.readFloatLE(off + 36),
      buf.readFloatLE(off + 40),
      buf.readFloatLE(off + 44),
    ],
    k: buf.readFloatLE(off + 48),
    spitze: buf.readFloatLE(off + 52),
  };
}

// Liest den Hüllkurven-Ring fortlaufend: je lies() nur die neuen Datensätze seit dem letzten Aufruf, hält die
// letzten `halte` je Kanal im Speicher (älteste raus). §6.2: Verwerf-Abstand cap − 1024.
export class OhrLeser {
  private pfad: string;
  private kanaele: number[];
  private halte: number;
  private wAlt = 0n;
  private puffer = new Map<number, Satz[]>();

  constructor(pfad: string, kanaele: number[], halte = 16384) {
    this.pfad = pfad;
    this.kanaele = kanaele;
    this.halte = halte;
    for (const k of kanaele) this.puffer.set(k, []);
  }

  // hoechstens: read at most this many of the newest records (a one-shot reader for the oscilloscope does not need the whole ring)
  lies(hoechstens?: number): number {
    let fd: number;
    try {
      fd = fs.openSync(this.pfad, 'r');
    } catch {
      return 0;
    }
    try {
      const kopf = liesKopf(fd);
      if (!kopf) return 0;
      const wNeu = kopf.w;
      if (wNeu <= this.wAlt) {
        this.wAlt = wNeu; // ein Neustart des Schreibers (w kleiner als bekannt) fängt sauber neu an
        return 0;
      }
      let vonR = this.wAlt;
      const spanne = wNeu - vonR;
      const cap = BigInt(kopf.cap);
      if (spanne > cap - 1024n) vonR = wNeu - cap + 1024n; // §6.2: zu alt, ab hier lesen
      if (hoechstens !== undefined && wNeu - vonR > BigInt(hoechstens)) vonR = wNeu - BigInt(hoechstens);
      const anzahl = Number(wNeu - vonR);

      // Zusammenhängende Zeilen (16 Kanäle × 64 Byte) in höchstens zwei Aufrufen lesen (Ringende geteilt).
      const zeilenBytes = KANAELE_IM_RING * SATZ_BYTES;
      const zeileVon = Number(vonR % cap);
      const gesamt = Buffer.alloc(anzahl * zeilenBytes);
      const biscap = kopf.cap - zeileVon;
      if (anzahl <= biscap) {
        fs.readSync(fd, gesamt, 0, anzahl * zeilenBytes, KOPF_BYTES + zeileVon * zeilenBytes);
      } else {
        fs.readSync(fd, gesamt, 0, biscap * zeilenBytes, KOPF_BYTES + zeileVon * zeilenBytes);
        fs.readSync(fd, gesamt, biscap * zeilenBytes, (anzahl - biscap) * zeilenBytes, KOPF_BYTES);
      }
      for (let i = 0; i < anzahl; ++i) {
        for (const kanal of this.kanaele) {
          const off = i * zeilenBytes + kanal * SATZ_BYTES;
          const arr = this.puffer.get(kanal)!;
          arr.push(liesSatz(gesamt, off));
          if (arr.length > this.halte) arr.splice(0, arr.length - this.halte);
        }
      }
      this.wAlt = wNeu;
      return anzahl;
    } finally {
      fs.closeSync(fd);
    }
  }

  // everything held for one channel, oldest first
  alle(kanal: number): Satz[] {
    return this.puffer.get(kanal) ?? [];
  }

  saetze(kanal: number, vonBeat: number, bisBeat: number): Satz[] {
    const arr = this.puffer.get(kanal) ?? [];
    return arr.filter((s) => s.beat >= vonBeat && s.beat < bisBeat);
  }
}

export interface Messung {
  baender_db: number[];
  lufs: number;
  spitze_db: number; // über das Fenster
}

function db10(x: number): number {
  return x > 0 ? 10 * Math.log10(x) : -200;
}
function db20(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -200;
}

export function miss(s: Satz[]): Messung {
  const baender_db: number[] = [];
  for (let b = 0; b < 6; ++b) {
    let summe = 0;
    for (const x of s) summe += x.band[b] * x.band[b];
    baender_db.push(db10(s.length ? summe / s.length : 0));
  }
  let summeK = 0;
  for (const x of s) summeK += x.k;
  const lufs = s.length ? -0.691 + db10(summeK / s.length) : -200;
  let spitze = 0;
  for (const x of s) spitze = Math.max(spitze, x.spitze);
  return { baender_db, lufs, spitze_db: db20(spitze) };
}

// Dossier 08 §3.3.2 / :98: M_b = Σ_t 4ab/(a+b) / Σ_t(a+b) über Sechzehntel (Math.floor(beat·4)), a/b = mittlere
// Bandleistung je Sechzehntel; nur Sechzehntel, wo beide Kanäle Sätze haben; Summe 0 → 0.
export function ueberdeckung(a: Satz[], b: Satz[]): Record<Band, number> {
  const bucket = (s: Satz[]): Map<number, { summe: number[]; n: number }> => {
    const m = new Map<number, { summe: number[]; n: number }>();
    for (const x of s) {
      const key = Math.floor(x.beat * 4);
      let e = m.get(key);
      if (!e) {
        e = { summe: [0, 0, 0, 0, 0, 0], n: 0 };
        m.set(key, e);
      }
      for (let i = 0; i < 6; ++i) e.summe[i] += x.band[i] * x.band[i];
      e.n += 1;
    }
    return m;
  };
  const ma = bucket(a);
  const mb = bucket(b);
  const res = {} as Record<Band, number>;
  for (let bi = 0; bi < 6; ++bi) {
    let num = 0;
    let den = 0;
    for (const [key, ea] of ma) {
      const eb = mb.get(key);
      if (!eb) continue;
      const av = ea.summe[bi] / ea.n;
      const bv = eb.summe[bi] / eb.n;
      const summe = av + bv;
      if (summe <= 0) continue;
      num += (4 * av * bv) / summe;
      den += summe;
    }
    res[BAENDER[bi]] = den > 0 ? num / den : 0;
  }
  return res;
}

export interface Vergleich {
  neu: Messung;
  laufend: Messung;
  pegel_diff_db: number;
  ueberdeckung: Record<Band, number>;
  summe: { lufs_schaetzung: number; spitze_obergrenze_db: number; clip_anteil: number };
  laufend_baender_db: number[];
  eq_vorschlag: { tief: number; mitte: number; hoch: number };
  bass_tausch: boolean;
}

function leistung(db: number): number {
  return Math.pow(10, db / 10);
}
function runde05(x: number): number {
  return Math.round(x * 2) / 2;
}
function klemme(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export interface DeckLage {
  deck: number;
  geladen: boolean;
  laeuft: boolean;
  offen: boolean;
}
export type HoerAntwort =
  | {
      code: 200;
      j: {
        deck: number;
        takte: number;
        gemessen_von_beat: number;
        gemessen_bis_beat: number;
        laeuft: boolean;
        offen: boolean;
        vergleich: Vergleich;
        // Ohr T8 (Plan Rev. 4): vom Server nachträglich angehängt (M5, reine Funktion `sync` hier, Server verdrahtet
        // nur). `validiert: false` fest, bis Slice 2b ein stabiles Verfahren liefert (Befund Slice 2: instabil an
        // Mischungen, ~/messungen/2026-09-28-ohr-slice2/anschlag_echt.json) — geht nicht ins Urteil (Task 9).
        sync?: { sync_ms: number; deck_gegen_deck_ms: number; n: number; validiert: false };
        // Ohr T10: vom Server angehängt (M5: Logik hier, Server verdrahtet nur), letzter Hörschein dieses Decks.
        hoerschein?: Hoerschein | null;
      };
    }
  | { code: 409; j: { fehler: 'kein_kernstand' | 'zu_wenig_gehoert'; saetze?: number; erwartet?: number } };

// GET /hoeren (Task 5): Fenster [uhrBeat − 4·takte, uhrBeat); erwartete Sätze = 4·takte·60/bpm·1000 (Rate 1 kHz);
// weniger als 90 % davon im Fenster → 409 zu_wenig_gehoert. Reine Funktion (M5): fester uhrBeat/bpm als Parameter.
export function hoerAntwort(l: OhrLeser, d: DeckLage, uhrBeat: number, bpm: number, takte: number): HoerAntwort {
  if (!d.geladen) return { code: 409, j: { fehler: 'kein_kernstand' } };
  const kanalDeck = d.deck - 1;
  const von = uhrBeat - 4 * takte;
  const bis = uhrBeat;
  const erwartet = (4 * takte * 60) / bpm * 1000;
  const saetzeDeck = l.saetze(kanalDeck, von, bis);
  const saetzeMaster = l.saetze(K.master, von, bis);
  const gemessen = Math.min(saetzeDeck.length, saetzeMaster.length);
  if (gemessen < 0.9 * erwartet) {
    return { code: 409, j: { fehler: 'zu_wenig_gehoert', saetze: gemessen, erwartet } };
  }
  return {
    code: 200,
    j: {
      deck: d.deck,
      takte,
      gemessen_von_beat: von,
      gemessen_bis_beat: bis,
      laeuft: d.laeuft,
      offen: d.offen,
      vergleich: vergleiche(saetzeDeck, saetzeMaster),
    },
  };
}

export function vergleiche(neu: Satz[], laufend: Satz[]): Vergleich {
  const mNeu = miss(neu);
  const mLaufend = miss(laufend);
  const pegel_diff_db = mNeu.lufs - mLaufend.lufs;
  const ue = ueberdeckung(neu, laufend);

  // Summenspitze je Fenster (Review M2): Sätze über `sample` paaren, je 1-ms-Fenster statt Maximum plus Maximum.
  const laufendSpitzeBySample = new Map<number, number>();
  for (const s of laufend) laufendSpitzeBySample.set(s.sample, s.spitze);
  let maxPt = 0;
  let clip = 0;
  let paare = 0;
  for (const s of neu) {
    const sl = laufendSpitzeBySample.get(s.sample);
    if (sl === undefined) continue;
    const pt = s.spitze + sl;
    maxPt = Math.max(maxPt, pt);
    if (pt > 1.0) clip += 1;
    paare += 1;
  }
  const summe = {
    lufs_schaetzung: db10(leistung(mNeu.lufs) + leistung(mLaufend.lufs)),
    spitze_obergrenze_db: db20(maxPt),
    clip_anteil: paare > 0 ? clip / paare : 0,
  };

  // EQ-Gruppen: tief = sub+tief, mitte = tiefmitte+mitte, hoch = praesenz+hoch (Leistungen addiert, dann dB).
  const gruppe = (db: Messung, i0: number, i1: number) => db10(leistung(db.baender_db[i0]) + leistung(db.baender_db[i1]));
  const neu_tief = gruppe(mNeu, 0, 1), neu_mitte = gruppe(mNeu, 2, 3), neu_hoch = gruppe(mNeu, 4, 5);
  const l_tief = gruppe(mLaufend, 0, 1), l_mitte = gruppe(mLaufend, 2, 3), l_hoch = gruppe(mLaufend, 4, 5);
  const d_tief = neu_tief - l_tief, d_mitte = neu_mitte - l_mitte, d_hoch = neu_hoch - l_hoch;
  const sorted = [d_tief, d_mitte, d_hoch].slice().sort((a, b) => a - b);
  const median = sorted[1];
  const vorschlag = (d: number) => {
    const abw = d - median;
    return Math.abs(abw) < 2 ? 0 : runde05(klemme(-abw, -12, 6));
  };
  const eq_vorschlag = { tief: vorschlag(d_tief), mitte: vorschlag(d_mitte), hoch: vorschlag(d_hoch) };

  return {
    neu: mNeu,
    laufend: mLaufend,
    pegel_diff_db,
    ueberdeckung: ue,
    summe,
    laufend_baender_db: mLaufend.baender_db,
    eq_vorschlag,
    bass_tausch: ue.sub > 0.3,
  };
}

// Ohr T7 (Plan Rev. 2, Review B1): Anschlag-Phase über den log-Fluss aller sechs Bänder, ohne Glättung. Das
// Tief-Band-Maß mit Glättung trifft an echten Kicks 9,6 bis 56,4 ms statt 0 (Review-Beleg); dieses Verfahren
// traf in der Gegenprobe 0,6 bis 0,85 ms. Gesetzte Schwellen (gesetzt 2026-09-28, ungemessen): Viertelfenster
// 0,125 Beat, Mindestanschlag 20 % des größten im Fenster und ≥ 6 (dB-Summe).
const VIERTELFENSTER_BEAT = 0.125; // gesetzt 2026-09-28, ungemessen
const ANSCHLAG_MIN_ANTEIL = 0.2; // gesetzt 2026-09-28, ungemessen
const ANSCHLAG_MIN_DB = 6; // gesetzt 2026-09-28, ungemessen

export interface Anschlag { anschlag_ms: number; n: number }

function median(xs: number[]): number {
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function anschlagPhase(s: Satz[], bpm: number): Anschlag {
  if (s.length < 2) return { anschlag_ms: NaN, n: 0 };
  // Schritt 1+2: Anschlagstärke o_t = Σ_b max(0, L_{t,b} − L_{t−1,b}) über den log-Fluss je Band, ohne Glättung.
  const o = new Array<number>(s.length).fill(0);
  for (let t = 1; t < s.length; ++t) {
    let ot = 0;
    for (let b = 0; b < 6; ++b) {
      const lt = 10 * Math.log10(s[t].band[b] * s[t].band[b] + 1e-12);
      const lt1 = 10 * Math.log10(s[t - 1].band[b] * s[t - 1].band[b] + 1e-12);
      ot += Math.max(0, lt - lt1);
    }
    o[t] = ot;
  }
  // Schritt 3: Phase in Beats, nur Sätze im Viertelfenster um den Schlag zählen.
  type Kandidat = { o: number; phiMs: number; schlag: number };
  const kandidaten: Kandidat[] = [];
  for (let t = 1; t < s.length; ++t) {
    const phi = s[t].beat - Math.round(s[t].beat);
    if (Math.abs(phi) >= VIERTELFENSTER_BEAT) continue;
    kandidaten.push({ o: o[t], phiMs: (phi * 60000) / bpm, schlag: Math.round(s[t].beat) });
  }
  if (kandidaten.length === 0) return { anschlag_ms: NaN, n: 0 };
  const maxO = Math.max(...kandidaten.map((k) => k.o));
  // Schritt 4: je Schlag der Satz mit größtem o_t, wenn er die Schwelle erreicht.
  const jeSchlag = new Map<number, Kandidat>();
  for (const k of kandidaten) {
    if (k.o < ANSCHLAG_MIN_ANTEIL * maxO || k.o < ANSCHLAG_MIN_DB) continue;
    const bisher = jeSchlag.get(k.schlag);
    if (!bisher || k.o > bisher.o) jeSchlag.set(k.schlag, k);
  }
  const treffer = [...jeSchlag.values()];
  if (treffer.length === 0) return { anschlag_ms: NaN, n: 0 };
  // Schritt 5: Median über die gefundenen Schläge.
  return { anschlag_ms: median(treffer.map((k) => k.phiMs)), n: treffer.length };
}

// Sync gegen das Raster (sync_ms, aus dem Beat-Feld von `neu` selbst) und gegen ein laufendes Deck
// (deck_gegen_deck_ms = neu − partner), NaN ohne Partner. n = Anschläge von `neu`.
export function sync(neu: Satz[], partner: Satz[] | null, bpm: number): { sync_ms: number; deck_gegen_deck_ms: number; n: number } {
  const aNeu = anschlagPhase(neu, bpm);
  if (!partner) return { sync_ms: aNeu.anschlag_ms, deck_gegen_deck_ms: NaN, n: aNeu.n };
  const aPartner = anschlagPhase(partner, bpm);
  const deck_gegen_deck_ms = Number.isNaN(aNeu.anschlag_ms) || Number.isNaN(aPartner.anschlag_ms)
    ? NaN : aNeu.anschlag_ms - aPartner.anschlag_ms;
  return { sync_ms: aNeu.anschlag_ms, deck_gegen_deck_ms, n: aNeu.n };
}

// Ohr T9 (Plan Rev. 4): Urteil aus dem Vergleich (reine Funktion). Sync geht NICHT ins Urteil: Slice 2b hat noch
// kein stabiles Verfahren geliefert (Befund Slice 2, anschlagPhase instabil an Mischungen). Die „Später"-Regeln aus
// dem Plan (s.n < 8 -> unsicher/keine_anschlaege, |deck_gegen_deck_ms| > 8 -> nicht_sync/gegen_deck, |sync_ms| > 8 ->
// Grund raster_versatz mit Grid-Vorschlag) sind bewusst NICHT gebaut; stattdessen nur der Grund
// `sync_unvalidiert:<sync_ms gerundet>`, ohne Urteilswirkung (Auftrag: „s.n < 8 ist kein unsicher“).
export type Urteil = 'ok' | 'zu_laut' | 'zu_leise' | 'nicht_sync' | 'unsicher';

export interface Hoerschein {
  hs_id: string; kanal: string; inhalt: string; deck: number; bpm: number;
  gemessen_von_beat: number; gemessen_bis_beat: number; gueltig_bis_beat: number;
  quell_von: number; quell_bis: number; erneuerung: number;
  sync_ms: number; deck_gegen_deck_ms: number; lufs_kurz: number; pegel_diff_db: number;
  baender_db: number[]; urteil: Urteil; gruende: string[];
  laufend_baender_db: number[]; ueberdeckung: Record<Band, number>;
  summe_spitze_db: number; clip_anteil: number; eq_vorschlag: { tief: number; mitte: number; hoch: number };
}

// takte_am_stueck: ununterbrochen gemessene Takte (Sprung im Quell-Beat bricht ab). Reihenfolge der Regeln (erste
// trifft): takte_am_stueck < 4 -> unsicher (zu_kurz); v.summe.clip_anteil > 0,01 -> zu_laut (summe_clippt);
// pegel_diff_db > 3 -> zu_laut; < −3 -> zu_leise; sonst ok. Reasons für die Pegel-Regeln haben im Plan-Text keinen
// eigenen Namen in Klammern; hier gewählt: der Urteilsname selbst (`zu_laut`/`zu_leise`), analog zu `summe_clippt`
// als eigenständigem Fall. Zusätzliche gruende ohne Urteilswirkung: sync_unvalidiert:<ms> (wenn sync_ms endlich),
// bass_tausch (wenn v.bass_tausch).
export function urteile(
  v: Vergleich,
  s: { sync_ms: number; deck_gegen_deck_ms: number; n: number },
  takte_am_stueck: number,
): { urteil: Urteil; gruende: string[] } {
  let urteil: Urteil;
  const gruende: string[] = [];
  if (takte_am_stueck < 4) {
    urteil = 'unsicher';
    gruende.push('zu_kurz');
  } else if (v.summe.clip_anteil > 0.01) {
    urteil = 'zu_laut';
    gruende.push('summe_clippt');
  } else if (v.pegel_diff_db > 3) {
    urteil = 'zu_laut';
    gruende.push('zu_laut');
  } else if (v.pegel_diff_db < -3) {
    urteil = 'zu_leise';
    gruende.push('zu_leise');
  } else {
    urteil = 'ok';
  }
  if (Number.isFinite(s.sync_ms)) gruende.push(`sync_unvalidiert:${Math.round(s.sync_ms)}`);
  if (v.bass_tausch) gruende.push('bass_tausch');
  return { urteil, gruende };
}

// Ohr T10: Hörschein je Takt, Befehle an den Kern (§4.5), Öffnen-Prüfung für den Server.
export interface Aktion {
  adresse: '/k/hoerschein' | '/k/hoerschein/weg';
  felder: Record<string, unknown>;
}
export interface DeckStand {
  deck: number;
  laeuft: boolean;
  inhalt: string; // §4.5: <material_id>/<basis_bpm·1000>_r<fassung>, '' wenn nichts geladen
  bpm: number; // Basis-Tempo der Fassung (Quell-Bpm); Vergleichs-Bpm der Uhr kommt separat in takt()
}

const MINDESTFENSTER_TAKTE = 4; // gesetzt 2026-09-28, ungemessen (Plan-Kopf)
const QUELL_SPRUNG_TOLERANZ_BEAT = 0.1;
// gesetzt 2026-09-28, ungemessen (Befund Durchstich Instanz i, Task 11): deckt die 1-ms-Quantisierung an beiden
// Fenstergrenzen ab (rund 0,001 Takt bei 128 BPM); 0,05 Takt = 200 ms Luft, weit unter dem, was ein echter Sprung kostet.
const TAKTE_TOLERANZ = 0.05;

function materialIdVon(inhalt: string): string {
  const i = inhalt.indexOf('/');
  return i < 0 ? inhalt : inhalt.slice(0, i);
}

// Läuft die Quellposition im Fenster ohne Sprung durch (§9 Kommentar Task 10)? Liefert den Beat, ab dem der
// längste ununterbrochene Lauf bis zum Fensterende beginnt, sowie die Quellwerte an Anfang/Ende dieses Laufs.
function laengsterLauf(saetze: Satz[], quellBpm: number, masterBpm: number): { vonBeat: number; quellVon: number; quellBis: number } | null {
  if (saetze.length === 0) return null;
  let startIdx = 0;
  for (let i = 1; i < saetze.length; ++i) {
    const dBeat = saetze[i].beat - saetze[i - 1].beat;
    const dQuell = saetze[i].quell - saetze[i - 1].quell;
    const erwartet = dBeat * (quellBpm / masterBpm);
    if (Math.abs(dQuell - erwartet) > QUELL_SPRUNG_TOLERANZ_BEAT) startIdx = i; // Sprung: der Lauf beginnt hier neu
  }
  return { vonBeat: saetze[startIdx].beat, quellVon: saetze[startIdx].quell, quellBis: saetze[saetze.length - 1].quell };
}

// Je neuer Takt der Master-Uhr aufrufen (Beat überschreitet ein Vielfaches von 4). Reine Berechnung aus dem Ring
// (kein cross-Takt-Gedächtnis für die Kontinuität nötig: das 4-Takt-Fenster selbst trägt den Beleg für
// takte_am_stueck). Zustand hält nur, welcher Schein je Kanal zuletzt ausgestellt wurde (für gueltig()/letzter()
// und um /k/hoerschein/weg zu erkennen).
export class Hoerscheinstelle {
  // Öffentlich (Review-Entscheidung des Umsetzers, nicht im Plan-Text benannt): Oberflaeche.hoerscheine ist eine
  // Referenz auf genau dieses Objekt, damit ein Test direkt hineinschreiben kann (server.test.mjs Fall g) und
  // Hoerscheinstelle.gueltig() denselben Stand sieht.
  readonly scheine: Record<string, Hoerschein> = {};
  private erneuerung = new Map<string, number>();

  takt(l: OhrLeser, uhrBeat: number, bpm: number, decks: DeckStand[], partnerOffen: (deck: number) => boolean): Aktion[] {
    const aktionen: Aktion[] = [];
    for (const d of decks) {
      if (!d.laeuft) continue;
      const kanal = `deck/${d.deck}`;
      const von = uhrBeat - 4 * MINDESTFENSTER_TAKTE;
      const bis = uhrBeat;
      const kanalIdx = d.deck - 1; // Ring-Layout §6.2: deck/1 = Kanal 0, deck/2 = Kanal 1
      const saetzeDeck = l.saetze(kanalIdx, von, bis);
      const saetzeMaster = l.saetze(K.master, von, bis);
      const lauf = laengsterLauf(saetzeDeck, d.bpm, bpm);
      // Gegen die tatsächlich vorhandenen Sätze rechnen (nicht gegen das nominale `bis`): saetze() liefert
      // beat < bis, der letzte Satz liegt also immer ein Quäntchen VOR bis, und der erste Satz mit beat ≥ von
      // liegt ein Quäntchen NACH von (1-kHz-Raster, 1 ms Quantisierung an beiden Fenstergrenzen). Ohne
      // Toleranz fällt takte_am_stueck dadurch selbst bei einem lückenlosen Fenster knapp unter 4 (Befund
      // Durchstich Instanz i: 'zu_kurz' in jedem Takt, obwohl quell_von/quell_bis den vollen Fenster-Beleg
      // zeigen; ~/messungen/2026-09-28-ohr-slice3/durchstich.txt). TAKTE_TOLERANZ deckt das ab, ohne einen
      // echten Sprung (der Beträge in Beats, nicht in Millisekunden kostet) zu verdecken.
      const roh = lauf && saetzeDeck.length > 0 ? (saetzeDeck[saetzeDeck.length - 1].beat - lauf.vonBeat) / 4 : 0;
      const takteAmStueck = roh + TAKTE_TOLERANZ;
      const v = vergleiche(saetzeDeck, saetzeMaster);
      const partnerNr = d.deck === 1 ? 2 : 1;
      const partnerDeck = decks.find((x) => x.deck === partnerNr);
      const saetzePartner = partnerDeck?.laeuft && partnerOffen(partnerNr) ? l.saetze(partnerNr - 1, von, bis) : null;
      const s = sync(saetzeDeck, saetzePartner, bpm);
      const { urteil, gruende } = urteile(v, s, takteAmStueck);

      const materialId = d.inhalt ? materialIdVon(d.inhalt) : 'ohne';
      const hsId = `ohr-${d.deck}-${materialId}`;
      const alt = this.scheine[kanal];
      const neuInhalt = alt?.inhalt !== d.inhalt;
      const erneuerungNr = neuInhalt ? 0 : (this.erneuerung.get(kanal) ?? 0) + 1;
      this.erneuerung.set(kanal, erneuerungNr);

      const schein: Hoerschein = {
        hs_id: hsId, kanal, inhalt: d.inhalt, deck: d.deck, bpm: d.bpm,
        gemessen_von_beat: von, gemessen_bis_beat: bis, gueltig_bis_beat: bis + 64,
        quell_von: lauf?.quellVon ?? NaN, quell_bis: lauf?.quellBis ?? NaN, erneuerung: erneuerungNr,
        sync_ms: s.sync_ms, deck_gegen_deck_ms: s.deck_gegen_deck_ms, lufs_kurz: v.neu.lufs, pegel_diff_db: v.pegel_diff_db,
        baender_db: v.neu.baender_db, urteil, gruende,
        laufend_baender_db: v.laufend_baender_db, ueberdeckung: v.ueberdeckung,
        summe_spitze_db: v.summe.spitze_obergrenze_db, clip_anteil: v.summe.clip_anteil, eq_vorschlag: v.eq_vorschlag,
      };
      const warOk = alt?.urteil === 'ok';
      this.scheine[kanal] = schein;

      if (urteil === 'ok') {
        // §4.5 Feldreihenfolge: id, quelle, hs_id, kanal, inhalt, urteil, bpm_messung, gueltig_bis_beat, quell_von,
        // quell_bis, sync_ms, pegel_diff_db, lufs_kurz. id/quelle setzt der Server (Aktion trägt sie ohne).
        aktionen.push({
          adresse: '/k/hoerschein',
          felder: {
            hs_id: schein.hs_id, kanal: schein.kanal, inhalt: schein.inhalt, urteil: schein.urteil,
            bpm_messung: bpm, gueltig_bis_beat: schein.gueltig_bis_beat, quell_von: schein.quell_von,
            quell_bis: schein.quell_bis, sync_ms: schein.sync_ms, pegel_diff_db: schein.pegel_diff_db,
            lufs_kurz: schein.lufs_kurz,
          },
        });
      } else if (warOk) {
        aktionen.push({ adresse: '/k/hoerschein/weg', felder: { hs_id: schein.hs_id } });
      }
    }
    return aktionen;
  }

  letzter(deck: number): Hoerschein | null {
    return this.scheine[`deck/${deck}`] ?? null;
  }

  gueltig(kanal: string, inhalt: string, uhrBeat: number): Hoerschein | null {
    const s = this.scheine[kanal];
    if (!s || s.urteil !== 'ok' || s.inhalt !== inhalt || uhrBeat > s.gueltig_bis_beat) return null;
    return s;
  }
}

// ---- Oscilloscope: condenses the 1 ms envelope records of one channel (Hand tool `oszilloskop`, GET /oszi) ----
// This is the envelope ring (peak, band RMS per 48-sample window), not samples: a true sample jump is invisible here.
// Channels the kern writes into the ring (core_signalbox.cpp huellen_block: ring index = mixer order, erz/5..8 never, then pad/1, pad/2, master, cue).
export const OSZI_KANAELE: Record<string, number> = {
  'deck/1': 0, 'deck/2': 1, 'deck/3': 2, 'deck/4': 3, 'erz/1': 4, 'erz/2': 5, 'erz/3': 6, 'erz/4': 7,
  'pad/1': 12, 'pad/2': 13, master: 14, cue: 15,
};
export const OSZI_PUNKTE_MAX = 600;
export const OSZI_BODEN_DB = -200;                // silence, finite on purpose (no -Infinity in JSON)
export const OSZI_EINSATZ_SCHWELLE_DB = 6;        // onset: block level rises this far over the quietest of the blocks before
export const OSZI_KLICK_SCHWELLE_DB = 20;         // click suspect: one ms peak exceeds both neighbours by more than this
const OSZI_BLOCK_MS = 10;                         // onset detection works on the median peak of 10 ms blocks
const OSZI_VORLAUF_BLOECKE = 5;
const OSZI_PAUSE_MS = 100;                        // no second onset within this time
const OSZI_HOERBAR_DB = -70;                      // blocks below this never start an onset; click needs the peak above it
const OSZI_PUMP_HOERBAR_DB = -60;                 // beats whose low band stays below this do not count for the pump depth

export interface OsziOpt {
  sek: number;                    // window length in seconds
  bpm: number | null;             // tempo for the pump depth, null or <= 0: no pump depth
  einsatzSchwelleDb?: number;
  klickSchwelleDb?: number;
}

export interface OsziAntwort {
  n: number;
  angefragt_ms: number;
  verfuegbar_ms: number;
  vollstaendig: boolean;
  ms_je_punkt: number;
  huellkurve_min_db: number[];    // per point: lowest peak in dB inside the point's span
  huellkurve_max_db: number[];    // highest peak, so short peaks survive the condensing
  spitze_db: number;
  spitze_t_ms: number;            // <= 0, relative to the window end
  rms_db: number;                 // power sum of the 6 band RMS values, averaged over the window
  einsaetze: { t_ms: number; db: number }[];
  pumptiefe_db: number | null;
  klick_verdacht: number[];       // ms relative to the window end
}

const rund1 = (x: number): number => Math.round(x * 10) / 10;
const dbAmp = (x: number): number => (x > 0 ? Math.max(OSZI_BODEN_DB, 20 * Math.log10(x)) : OSZI_BODEN_DB);

export function oszi(saetze: Satz[], opt: OsziOpt): OsziAntwort {
  const angefragt = Math.round(opt.sek * 1000);
  const s = saetze.length > angefragt ? saetze.slice(saetze.length - angefragt) : saetze;
  const n = s.length;
  const ende = n - 1;
  const rel = (i: number): number => i - ende;   // one record per ms
  const einsatzSchwelle = opt.einsatzSchwelleDb ?? OSZI_EINSATZ_SCHWELLE_DB;
  const klickFaktor = 10 ** ((opt.klickSchwelleDb ?? OSZI_KLICK_SCHWELLE_DB) / 20);
  const sp = s.map((x) => (Number.isFinite(x.spitze) && x.spitze > 0 ? x.spitze : 0));

  // envelope: at most OSZI_PUNKTE_MAX points, min and max of the peak per point
  const punkte = Math.min(OSZI_PUNKTE_MAX, n);
  const min_db: number[] = [];
  const max_db: number[] = [];
  for (let p = 0; p < punkte; ++p) {
    const von = Math.floor((p * n) / punkte);
    const bis = Math.floor(((p + 1) * n) / punkte);
    let lo = Infinity;
    let hi = 0;
    for (let i = von; i < bis; ++i) {
      lo = Math.min(lo, sp[i]);
      hi = Math.max(hi, sp[i]);
    }
    min_db.push(rund1(dbAmp(lo === Infinity ? 0 : lo)));
    max_db.push(rund1(dbAmp(hi)));
  }

  // peak and RMS
  let iMax = -1;
  let spMax = 0;
  let leistung = 0;
  for (let i = 0; i < n; ++i) {
    if (sp[i] > spMax) { spMax = sp[i]; iMax = i; }
    let l = 0;
    for (const b of s[i].band) if (Number.isFinite(b)) l += b * b;
    leistung += l;
  }
  const rms = n ? Math.sqrt(leistung / n) : 0;

  // onsets: median peak of 10 ms blocks against the quietest of the blocks before
  const einsaetze: { t_ms: number; db: number }[] = [];
  const bloecke: number[] = [];
  for (let b = 0; (b + 1) * OSZI_BLOCK_MS <= n; ++b) {
    const w = sp.slice(b * OSZI_BLOCK_MS, (b + 1) * OSZI_BLOCK_MS).sort((x, y) => x - y);
    bloecke.push(dbAmp((w[OSZI_BLOCK_MS / 2 - 1] + w[OSZI_BLOCK_MS / 2]) / 2));
  }
  let sperreBis = -1;
  for (let b = OSZI_VORLAUF_BLOECKE; b < bloecke.length; ++b) {
    const t = b * OSZI_BLOCK_MS;
    if (t < sperreBis || bloecke[b] < OSZI_HOERBAR_DB) continue;
    const vorher = Math.min(...bloecke.slice(b - OSZI_VORLAUF_BLOECKE, b));
    const anstieg = bloecke[b] - Math.max(vorher, -90);
    if (anstieg >= einsatzSchwelle) {
      einsaetze.push({ t_ms: rel(t), db: rund1(anstieg) });
      sperreBis = t + OSZI_PAUSE_MS;
    }
  }

  // pump depth: per whole beat (counted back from the window end) max/min of the smoothed low-band envelope, averaged
  let pumptiefe: number | null = null;
  if (opt.bpm && opt.bpm > 0 && Number.isFinite(opt.bpm)) {
    const takt = 60000 / opt.bpm;
    const schlaege = Math.floor(n / takt);
    if (schlaege >= 1) {
      const glatt = 5;
      const tief = s.map((x) => Math.hypot(x.band[0] || 0, x.band[1] || 0));
      const tiefDb: number[] = [];
      for (let i = 0; i + glatt <= n; ++i) {
        let m = 0;
        for (let k = 0; k < glatt; ++k) m += tief[i + k];
        tiefDb.push(dbAmp(m / glatt));
      }
      let summe = 0;
      let zaehl = 0;
      for (let j = 0; j < schlaege; ++j) {
        const bis = Math.round(n - j * takt);
        const von = Math.round(n - (j + 1) * takt);
        let hi = OSZI_BODEN_DB;
        let lo = Infinity;
        for (let i = von; i < Math.min(bis, tiefDb.length); ++i) {
          hi = Math.max(hi, tiefDb[i]);
          lo = Math.min(lo, tiefDb[i]);
        }
        if (lo === Infinity || hi < OSZI_PUMP_HOERBAR_DB) continue;
        summe += hi - Math.max(lo, -90);
        zaehl += 1;
      }
      pumptiefe = zaehl ? rund1(summe / zaehl) : 0;
    }
  }

  // click suspects: one ms whose peak exceeds both neighbours by more than the threshold
  const klick: number[] = [];
  const hoerbar = 10 ** (OSZI_HOERBAR_DB / 20);
  for (let i = 1; i < n - 1; ++i) {
    if (sp[i] > hoerbar && sp[i] > klickFaktor * sp[i - 1] && sp[i] > klickFaktor * sp[i + 1]) klick.push(rel(i));
  }

  return {
    n,
    angefragt_ms: angefragt,
    verfuegbar_ms: n,
    vollstaendig: n >= angefragt,
    ms_je_punkt: punkte ? Math.round((n / punkte) * 10) / 10 : 0,
    huellkurve_min_db: min_db,
    huellkurve_max_db: max_db,
    spitze_db: rund1(dbAmp(spMax)),
    spitze_t_ms: iMax >= 0 ? rel(iMax) : 0,
    rms_db: rund1(dbAmp(rms)),
    einsaetze,
    pumptiefe_db: pumptiefe,
    klick_verdacht: klick,
  };
}
