// Eigenes JSON-Patch für das Projekt (Spec 3.3 und 6.6): add, remove, replace und move; Pfade über IDs, nie über Array-Indizes.
//   /spuren/s2/clips/c2/noten/n1/ton
// Listen mit Objekten, die eine `id` tragen (spuren, clips, noten), werden über die ID angesprochen. Die Position in so einer Liste
// steht nicht im Pfad, sondern im Feld `index` einer add- oder move-Operation (und wird beim Umkehren eines remove mitgeführt).
// Eine geänderte Reihenfolge ist eine move-Operation auf dem Element der ID-Liste ({op:'move', pfad:'/spuren/s3', index:0}), kein
// Ersatz der Liste mit ihrem Inhalt.
// Abgeleitete Felder (`dekodiert`, Spec 6.6) tragen Patches nie in ihrem echten Zustand: Werte in Patches haben dafür 'nein', und ein
// Unterschied allein im abgeleiteten Feld ist kein Unterschied. Nach Undo/Redo gleicht der Server sie neu ab (befehle.ts).
// `rev` und `wiedergabe_rev` gehören nicht in Patches: sie zählt der Verlauf (jeder Eintrag erhöht rev um 1).
import { istObjekt } from './modell.ts';

export interface Op { op: 'add' | 'remove' | 'replace' | 'move'; pfad: string; wert?: unknown; index?: number }
export type Patch = Op[];

export class PatchFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text: string) { super(`${grund}: ${text}`); this.grund = grund; }
}

const GESPERRT = new Set(['__proto__', 'constructor', 'prototype']);
const OHNE = new Set(['rev', 'wiedergabe_rev']);
const ABGELEITET = new Set(['dekodiert']);
// ID-Zähler (Spec 6.26) steigen nur: der Unterschied zweier Stände erzeugt für sie nie eine Operation, Undo und Redo lassen sie also stehen.
// In den Werten eines add (ein ganzer Clip) bleiben sie, wie sie waren.
const ZAEHLER = new Set(['naechste_id', 'naechste_noten_id']);
const OPS = new Set<string>(['add', 'remove', 'replace', 'move']);

// Kopie eines Werts für einen Patch: abgeleitete Felder neutral ('nein'), sonst unverändert.
function neutral<T>(x: T): T {
  if (Array.isArray(x)) return x.map(neutral) as unknown as T;
  if (x !== null && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as object)) o[k] = ABGELEITET.has(k) ? 'nein' : neutral(v);
    return o as T;
  }
  return x;
}

function segmente(pfad: string): string[] {
  if (typeof pfad !== 'string' || !pfad.startsWith('/') || pfad.length < 2) throw new PatchFehler('pfad_ungueltig', `Pfad ${JSON.stringify(pfad)}`);
  const s = pfad.slice(1).split('/');
  if (s.some((x) => x === '' || GESPERRT.has(x))) throw new PatchFehler('pfad_ungueltig', `Pfad ${JSON.stringify(pfad)}`);
  return s;
}
const hatId = (x: unknown): x is { id: string } => istObjekt(x) && typeof x.id === 'string';
const eigen = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function gehe(wurzel: unknown, segs: string[], pfad: string): unknown {
  let cur = wurzel;
  for (const s of segs) {
    if (Array.isArray(cur)) cur = cur.find((e) => hatId(e) && e.id === s);
    else if (istObjekt(cur) && eigen(cur, s)) cur = cur[s];
    else cur = undefined;
    if (cur === undefined) throw new PatchFehler('pfad_unbekannt', pfad);
  }
  return cur;
}

// ID-Mengen der Listen, die ein Aufruf von wende/kehreUm anfasst (Schlüssel: die Liste selbst). Große Patches (20000 add-Operationen in
// dieselbe Notenliste) prüfen so in O(1), ob eine ID schon da ist, statt die Liste je Operation zu durchsuchen.
type IdMengen = Map<unknown[], Set<string>>;
function idsVon(mengen: IdMengen, liste: unknown[]): Set<string> {
  let m = mengen.get(liste);
  if (m === undefined) { m = new Set(); for (const e of liste) if (hatId(e)) m.add(e.id); mengen.set(liste, m); }
  return m;
}

// Wendet eine einzelne Operation an und liefert die Umkehr-Operation (gegen den Stand VOR der Operation).
function einzeln(wurzel: unknown, o: Op, mengen: IdMengen): Op {
  if (!istObjekt(o) || !OPS.has(o.op)) throw new PatchFehler('op_unbekannt', JSON.stringify(o)?.slice(0, 80));
  const segs = segmente(o.pfad);
  const letzter = segs[segs.length - 1];
  const eltern = gehe(wurzel, segs.slice(0, -1), o.pfad);
  if (Array.isArray(eltern)) {
    const ids = idsVon(mengen, eltern);
    if (o.op === 'add') {
      if (ids.has(letzter)) throw new PatchFehler('existiert_schon', o.pfad);
      if (!hatId(o.wert) || o.wert.id !== letzter) throw new PatchFehler('id_passt_nicht', `${o.pfad}: Wert braucht id ${letzter}`);
      const idx = o.index === undefined ? eltern.length : o.index;
      if (!Number.isInteger(idx) || idx < 0 || idx > eltern.length) throw new PatchFehler('index_bereich', `${o.pfad}: index ${o.index}`);
      eltern.splice(idx, 0, structuredClone(o.wert)); ids.add(letzter);
      return { op: 'remove', pfad: o.pfad };
    }
    if (!ids.has(letzter)) throw new PatchFehler('pfad_unbekannt', o.pfad);
    const i = eltern.findLastIndex((e) => hatId(e) && e.id === letzter);        // von hinten: frisch Angehängtes ist sofort gefunden
    const alt = eltern[i];
    if (o.op === 'move') {
      if (!Number.isInteger(o.index) || (o.index as number) < 0 || (o.index as number) >= eltern.length) {
        throw new PatchFehler('index_bereich', `${o.pfad}: index ${o.index}`);
      }
      eltern.splice(i, 1); eltern.splice(o.index as number, 0, alt);
      return { op: 'move', pfad: o.pfad, index: i };
    }
    if (o.op === 'remove') { eltern.splice(i, 1); ids.delete(letzter); return { op: 'add', pfad: o.pfad, wert: neutral(alt), index: i }; }
    if (!hatId(o.wert) || o.wert.id !== letzter) throw new PatchFehler('id_passt_nicht', `${o.pfad}: Wert braucht id ${letzter}`);
    eltern[i] = structuredClone(o.wert);
    return { op: 'replace', pfad: o.pfad, wert: neutral(alt) };
  }
  if (!istObjekt(eltern) || o.op === 'move') throw new PatchFehler('pfad_unbekannt', o.pfad);
  const da = eigen(eltern, letzter);
  if (o.op === 'add') {
    if (da) throw new PatchFehler('existiert_schon', o.pfad);
    eltern[letzter] = structuredClone(o.wert);
    return { op: 'remove', pfad: o.pfad };
  }
  if (!da) throw new PatchFehler('pfad_unbekannt', o.pfad);
  const alt = eltern[letzter];
  if (o.op === 'remove') { delete eltern[letzter]; return { op: 'add', pfad: o.pfad, wert: neutral(alt) }; }
  eltern[letzter] = structuredClone(o.wert);
  return { op: 'replace', pfad: o.pfad, wert: neutral(alt) };
}

// --- Läufe auf einer Liste (S2-Integration Slice 1) -------------------------------------------------------------------
// Die vordere Hälfte einer Notenliste löschen ergibt k remove-Operationen auf dieselbe Liste, ihr Undo k add-Operationen. Einzeln
// angewendet sucht jede ihre Stelle (findLastIndex) und verschiebt den Rest: quadratisch (gemessen 15.10., 20 000 Noten: Redo 1125 ms).
// Ein Lauf aus mindestens LAUF_MIN aufeinanderfolgenden remove- bzw. add-Operationen mit demselben Elternpfad geht darum in einem
// Durchgang. Ergebnis und Umkehr-Operationen sind dieselben wie bei der Einzelanwendung (Test: Fuzz gegen den Einzelweg).
export const LAUF_MIN = 8;
const elternPfad = (pfad: unknown): string | null => {
  if (typeof pfad !== 'string') return null;
  const k = pfad.lastIndexOf('/');
  return k > 0 ? pfad.slice(0, k) : null;
};
function laufEnde(ops: Patch, i: number): number {
  const o = ops[i] as unknown;
  if (!istObjekt(o) || (o.op !== 'remove' && o.op !== 'add')) return i + 1;
  const ep = elternPfad(o.pfad);
  if (ep === null) return i + 1;
  let j = i + 1;
  while (j < ops.length && istObjekt(ops[j]) && ops[j].op === o.op && elternPfad(ops[j].pfad) === ep) j++;
  return j;
}

// Fenwick-Baum: wie viele der schon entfernten Elemente lagen vor Position p (für den Index der Umkehr wie im Einzelweg)
class Zaehler {
  private readonly b: Int32Array;
  constructor(n: number) { this.b = new Int32Array(n + 1); }
  plus(p: number): void { for (let i = p + 1; i < this.b.length; i += i & -i) this.b[i] += 1; }
  vor(p: number): number { let s = 0; for (let i = p; i > 0; i -= i & -i) s += this.b[i]; return s; }
}

function loescheLauf(wurzel: unknown, lauf: Op[], mengen: IdMengen): Op[] {
  const segs = segmente(lauf[0].pfad);
  const eltern = gehe(wurzel, segs.slice(0, -1), lauf[0].pfad);
  if (!Array.isArray(eltern)) return lauf.map((o) => einzeln(wurzel, o, mengen));    // Objekt-Felder: Einzelweg
  const ids = idsVon(mengen, eltern);
  const pos = new Map<string, number>();
  eltern.forEach((e, k) => { if (hatId(e)) pos.set(e.id, k); });                   // doppelte IDs: die letzte gewinnt, wie findLastIndex
  const weg = new Zaehler(eltern.length), raus = new Uint8Array(eltern.length), umkehr: Op[] = [];
  for (const o of lauf) {
    const id = segmente(o.pfad).at(-1) as string;
    const k = pos.get(id);
    if (!ids.has(id) || k === undefined || raus[k]) throw new PatchFehler('pfad_unbekannt', o.pfad);
    umkehr.push({ op: 'add', pfad: o.pfad, wert: neutral(eltern[k]), index: k - weg.vor(k) });
    weg.plus(k); raus[k] = 1; ids.delete(id);
  }
  let w = 0;
  for (let k = 0; k < eltern.length; k++) if (!raus[k]) eltern[w++] = eltern[k];
  eltern.length = w;
  return umkehr;
}

function fuegeLaufEin(wurzel: unknown, lauf: Op[], mengen: IdMengen): Op[] {
  const segs = segmente(lauf[0].pfad);
  const eltern = gehe(wurzel, segs.slice(0, -1), lauf[0].pfad);
  if (!Array.isArray(eltern)) return lauf.map((o) => einzeln(wurzel, o, mengen));
  const idxs: number[] = [];
  let laenge = eltern.length, letzter = -1;
  for (const o of lauf) {                                                           // nur streng steigende Indizes gehen im Durchgang
    const idx = o.index === undefined ? laenge : o.index;
    if (!Number.isInteger(idx) || idx <= letzter) return lauf.map((x) => einzeln(wurzel, x, mengen));
    idxs.push(idx); letzter = idx; laenge++;
  }
  const ids = idsVon(mengen, eltern), umkehr: Op[] = [];
  lauf.forEach((o, j) => {
    const id = segmente(o.pfad).at(-1) as string;
    if (ids.has(id)) throw new PatchFehler('existiert_schon', o.pfad);
    if (!hatId(o.wert) || o.wert.id !== id) throw new PatchFehler('id_passt_nicht', `${o.pfad}: Wert braucht id ${id}`);
    if (idxs[j] < 0 || idxs[j] > eltern.length + j) throw new PatchFehler('index_bereich', `${o.pfad}: index ${o.index}`);
    ids.add(id); umkehr.push({ op: 'remove', pfad: o.pfad });
  });
  const aus = new Array(eltern.length + lauf.length);
  let alt = 0, a = 0;
  for (let p = 0; p < aus.length; p++) aus[p] = a < idxs.length && idxs[a] === p ? structuredClone(lauf[a++].wert) : eltern[alt++];
  for (let p = 0; p < aus.length; p++) eltern[p] = aus[p];
  return umkehr;
}

function wendeAlle(wurzel: unknown, ops: Patch, umkehr: Patch | null): void {
  const mengen: IdMengen = new Map();
  for (let i = 0; i < ops.length;) {
    const ende = laufEnde(ops, i);
    if (ende - i >= LAUF_MIN) {
      const lauf = ops.slice(i, ende);
      const u = lauf[0].op === 'remove' ? loescheLauf(wurzel, lauf, mengen) : fuegeLaufEin(wurzel, lauf, mengen);
      if (umkehr) for (const x of u) umkehr.push(structuredClone(x));
      i = ende;
    } else {
      for (; i < ende; i++) { const u = einzeln(wurzel, ops[i], mengen); if (umkehr) umkehr.push(structuredClone(u)); }
    }
  }
}

// Gibt einen neuen Stand zurück; bei einem Fehler bleibt die Eingabe unberührt (gearbeitet wird auf einer Kopie).
export function wende<T>(projekt: T, ops: Patch): T {
  const kopie = structuredClone(projekt);
  wendeAlle(kopie, ops, null);
  return kopie;
}

// Umkehr-Patch zu `ops`, gebildet gegen den Stand `vorProjekt`, auf den `ops` angewendet werden soll. Reihenfolge umgekehrt.
export function kehreUm<T>(ops: Patch, vorProjekt: T): Patch {
  const kopie = structuredClone(vorProjekt), umkehr: Patch = [];
  wendeAlle(kopie, ops, umkehr);
  return umkehr.reverse();
}

// Nur für den Vergleichstest (Fuzz): der Einzelweg ohne Läufe
export function wendeEinzeln<T>(projekt: T, ops: Patch): { stand: T; umkehr: Patch } {
  const kopie = structuredClone(projekt), mengen: IdMengen = new Map(), umkehr: Patch = [];
  for (const o of ops) umkehr.push(structuredClone(einzeln(kopie, o, mengen)));
  return { stand: kopie, umkehr: umkehr.reverse() };
}
// --- Patch aus zwei Ständen ------------------------------------------------------------------------------------------
function gleich(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => gleich(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => eigen(b as object, k) && gleich((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const idListe = (x: unknown): x is { id: string }[] => Array.isArray(x) && x.every(hatId);

// Moves, die die ID-Folge `jetzt` in `soll` überführen (beide mit denselben IDs). Wenige Moves: Elemente der längsten gemeinsamen
// aufsteigenden Folge bleiben liegen, jedes andere wird hinter seinen Vorgänger in `soll` gesetzt. Zur Sicherheit gegengeprüft, im
// Zweifel (oder bei sehr langen Listen) der einfache Weg: je falschem Platz ein Move auf genau diesen Platz.
function ordnung(jetzt: string[], soll: string[]): { id: string; index: number }[] {
  if (jetzt.every((id, k) => id === soll[k])) return [];
  const einfach = (): { id: string; index: number }[] => {
    const cur = [...jetzt], zuege: { id: string; index: number }[] = [];
    for (let k = 0; k < soll.length; k++) {
      if (cur[k] === soll[k]) continue;
      cur.splice(cur.indexOf(soll[k]), 1); cur.splice(k, 0, soll[k]); zuege.push({ id: soll[k], index: k });
    }
    return zuege;
  };
  if (soll.length > 512) return einfach();
  const pos = new Map(jetzt.map((id, k) => [id, k] as const));
  const arr = soll.map((id) => pos.get(id) as number);
  const laenge = arr.map(() => 1), von = arr.map(() => -1);
  let best = 0;
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < i; j++) if (arr[j] < arr[i] && laenge[j] + 1 > laenge[i]) { laenge[i] = laenge[j] + 1; von[i] = j; }
    if (laenge[i] > laenge[best]) best = i;
  }
  const bleibt = new Set<string>();
  for (let i = best; i >= 0; i = von[i]) bleibt.add(soll[i]);
  const cur = [...jetzt], zuege: { id: string; index: number }[] = [];
  for (let k = 0; k < soll.length; k++) {
    if (bleibt.has(soll[k])) continue;
    cur.splice(cur.indexOf(soll[k]), 1);
    const index = k === 0 ? 0 : cur.indexOf(soll[k - 1]) + 1;
    cur.splice(index, 0, soll[k]); zuege.push({ id: soll[k], index });
  }
  return cur.every((id, k) => id === soll[k]) ? zuege : einfach();
}

function unter(a: unknown, b: unknown, pfad: string, aus: Patch): void {
  if (gleich(a, b)) return;
  if (istObjekt(a) && istObjekt(b)) {
    for (const k of Object.keys(a)) if (!eigen(b, k) && !ZAEHLER.has(k)) aus.push({ op: 'remove', pfad: `${pfad}/${k}` });
    for (const k of Object.keys(a)) if (eigen(b, k) && !ABGELEITET.has(k) && !ZAEHLER.has(k)) unter(a[k], b[k], `${pfad}/${k}`, aus);
    for (const k of Object.keys(b)) if (!eigen(a, k) && !ZAEHLER.has(k)) aus.push({ op: 'add', pfad: `${pfad}/${k}`, wert: neutral(b[k]) });
    return;
  }
  if (idListe(a) && idListe(b)) {
    const ia = a.map((e) => e.id), ib = b.map((e) => e.id);
    const inA = new Set(ia), inB = new Map(b.map((e) => [e.id, e] as const));
    if (inA.size !== ia.length || inB.size !== ib.length) {
      aus.push({ op: 'replace', pfad, wert: neutral(b) });          // doppelte IDs: ganze Liste (so ein Projekt ist ohnehin ungültig)
      return;
    }
    for (let k = a.length - 1; k >= 0; k--) if (!inB.has(a[k].id)) aus.push({ op: 'remove', pfad: `${pfad}/${a[k].id}` });   // von hinten: billig zu wenden
    for (const e of a) { const g = inB.get(e.id); if (g !== undefined) unter(e, g, `${pfad}/${e.id}`, aus); }
    // Reihenfolge der gemeinsamen Elemente: move-Operationen auf der ID (Spec 6.6), nie die Liste mit Inhalt
    for (const m of ordnung(ia.filter((i) => inB.has(i)), ib.filter((i) => inA.has(i)))) aus.push({ op: 'move', pfad: `${pfad}/${m.id}`, index: m.index });
    b.forEach((e, idx) => { if (!inA.has(e.id)) aus.push({ op: 'add', pfad: `${pfad}/${e.id}`, wert: neutral(e), index: idx }); });
    return;
  }
  aus.push({ op: 'replace', pfad, wert: neutral(b) });
}

// Patch, der `alt` in `neu` überführt. `rev` und `wiedergabe_rev` der Wurzel zählen nicht.
export function unterschied<T extends object>(alt: T, neu: T): Patch {
  const ohne = (x: T): Record<string, unknown> => Object.fromEntries(Object.entries(x).filter(([k]) => !OHNE.has(k)));
  const aus: Patch = [];
  unter(ohne(alt), ohne(neu), '', aus);
  return aus;
}
