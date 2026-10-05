// Studio S6 (Spec docs/specs/2026-09-29-djk-automationsspuren-design.md): eine Automationsspur ist eine Liste von
// Fahrten auf dem Takt-Raster. Ziele: Kanalzug im Kern (/k/teil, Stellwerk), Surge-Parameter im Wirt (fahre mit
// Startzeit ab) und das Muster eines Stroms. Reine Funktionen bis auf wirtRuf (Unix-Socket, eine JSON-Zeile hin und zurück).
import net from 'node:net';
import { PFAD, OFFEN_DB, oeffnet } from './hand_bedienung.ts';

export const SPUR_NAME = /^[a-z0-9_-]{1,32}$/;
export const WIRT_ZIEL = /^wirt:(bass|melodie)\/([a-z][a-z0-9_]*)$/;
export const STROM_ZIEL = /^strom:([123])$/;
export const MAX_TAKT = 256;             // ab_takt höchstens 256: bei 128 BPM rund 8 Minuten ab Anker
export const MAX_TEILE = 200;            // Stellwerk hält 256 offene Teile (stellwerk/typen.h MAX_TEILE), Rest für Hand und Leitstand
export const MUSTER_VORLAUF_BEATS = 2;   // Muster so weit vor ihrer Takt-Eins schreiben (Planer: Wechsel ab dem nächsten Takt ≥ 0,25 Beat)

export interface Fahrt { ziel: string; ab_takt: number; takte?: number; nach?: number; von?: number; form?: string; muster?: string }
export interface Spur { name: string; fahrten: Fahrt[] }
export interface TeilPlan { pfad: string; ab_beat: number; dauer_beats: number; nach: number; form: 0 | 1; politik: 0 | 1 }
export interface WirtPlan { gruppe: string; name: string; ab_beat: number; dauer_beats: number; bis: number; von?: number; form: 'linear' | 's' }
export interface MusterPlan { strom: number; text: string; ab_beat: number }
export interface Geplant { teile: TeilPlan[]; wirt: WirtPlan[]; muster: MusterPlan[]; ende_beat: number }

// Strom (1..3), dessen Muster ein Ziel hält: erz/<n>/*, wirt:bass (Strom 2), wirt:melodie (Strom 3), strom:<n>; sonst null
export function stromVonZiel(ziel: string): number | null {
  const e = /^erz\/([1-3])\//.exec(ziel);
  if (e) return Number(e[1]);
  const w = WIRT_ZIEL.exec(ziel);
  if (w) return w[1] === 'bass' ? 2 : 3;
  const s = STROM_ZIEL.exec(ziel);
  return s ? Number(s[1]) : null;
}

const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// §17 I4 wie im Kern (stellwerk/src/einsortieren.cpp:17-26): Rampen [ab, ab+dauer), Setzen als Punkt; Setzen und Rampe am
// selben Beat nur, wenn das Setzen die kleinere Nummer (früher in der Liste) hat. Im Wirt ersetzt eine Fahrt jede, die an
// ihrem Start oder später beginnt (wirtsteuerung.py:90): dort überlappt ein Setzen am Rampen-Start immer.
function ueberlappt(x0: number, xd: number, xnr: number, a0: number, ad: number, anr: number, wirt: boolean): boolean {
  if (xd > 0 && ad > 0) return Math.max(x0, a0) < Math.min(x0 + xd, a0 + ad);
  if (xd === 0 && ad === 0) return x0 === a0;
  if (ad === 0) return a0 === x0 ? (wirt || anr > xnr) : x0 < a0 && a0 < x0 + xd;   // a: Setzen, x: Rampe
  return a0 === x0 ? (wirt || xnr > anr) : a0 < x0 && x0 < a0 + ad;                  // x: Setzen, a: Rampe
}

export function pruefeSpur(x: unknown, fahrbar: Set<string>): { spur: Spur } | { fehler: string } {
  if (!x || typeof x !== 'object') return { fehler: 'spur: object expected' };
  const s = x as Record<string, unknown>;
  if (typeof s.name !== 'string' || !SPUR_NAME.test(s.name)) return { fehler: 'name: [a-z0-9_-]{1,32}' };
  if (!Array.isArray(s.fahrten) || s.fahrten.length === 0) return { fehler: 'fahrten: non-empty list expected' };
  const belegt: Record<string, [number, number, number][]> = {};
  let teile = 0;
  for (const [i, roh] of s.fahrten.entries()) {
    const wo = `fahrten[${i}]`;
    if (!roh || typeof roh !== 'object' || typeof (roh as Fahrt).ziel !== 'string') return { fehler: `${wo}.ziel missing` };
    const f = roh as Fahrt;
    if (!Number.isInteger(f.ab_takt) || f.ab_takt < 1 || f.ab_takt > MAX_TAKT) return { fehler: `${wo}.ab_takt: integer 1..${MAX_TAKT}` };
    const strom = STROM_ZIEL.exec(f.ziel), wirt = WIRT_ZIEL.exec(f.ziel);
    let takte = 0;
    if (strom) {
      if (typeof f.muster !== 'string' || !f.muster.trim()) return { fehler: `${wo}.muster: pattern text expected` };
      if (f.takte !== undefined || f.nach !== undefined) return { fehler: `${wo}: a pattern entry has no takte/nach` };
    } else {
      if (!wirt && !PFAD.test(f.ziel)) return { fehler: `${wo}.ziel: channel path, wirt:<bass|melodie>/<parameter> or strom:<1-3>` };
      if (wirt && !fahrbar.has(wirt[2])) return { fehler: `${wo}.ziel: ${wirt[2]} is not a continuous Surge parameter` };
      takte = f.takte ?? 0;
      if (!zahl(takte) || takte < 0 || takte > 64) return { fehler: `${wo}.takte: 0..64` };
      if (!zahl(f.nach)) return { fehler: `${wo}.nach: number expected` };
      if (f.von !== undefined && (!wirt || !zahl(f.von))) return { fehler: `${wo}.von: number, only for wirt targets` };
      if (f.form !== undefined && f.form !== 's' && f.form !== 'linear') return { fehler: `${wo}.form: s or linear` };
      if (f.muster !== undefined) return { fehler: `${wo}.muster: only for strom targets` };
      if (!wirt && ++teile > MAX_TEILE) return { fehler: `fahrten: at most ${MAX_TEILE} channel moves` };
    }
    // Überlappung je Ziel: das Stellwerk lehnt sie ab (I4), im Wirt ersetzt eine spätere Fahrt die frühere
    const a = 4 * (f.ab_takt - 1), d = 4 * takte;
    for (const [c, cd, nr] of belegt[f.ziel] ?? []) {
      if (ueberlappt(a, d, i, c, cd, nr, !!wirt)) return { fehler: `${wo}: overlaps another move on ${f.ziel}` };
    }
    (belegt[f.ziel] ??= []).push([a, d, i]);
  }
  return { spur: { name: s.name, fahrten: s.fahrten as Fahrt[] } };
}

// Politik (§16.1): Ausblenden, Kill an, Fader zu = 1 zustand (zu spät heißt: nachholen); alles andere 0 musik (verwerfen)
function politikVon(pfad: string, nach: number): 0 | 1 {
  if (/\/(fader|trim)$/.test(pfad) && nach <= OFFEN_DB) return 1;
  if (/\/kill\//.test(pfad) && nach >= 1) return 1;
  return 0;
}

// Muster, die beim Kern-Beat `beat` geschrieben werden müssen: ab ihrem Zeitpunkt minus Vorlauf (F5: Beat, nicht Wanduhr,
// ein Tempowechsel nach dem Start verschiebt sonst den Zeitpunkt um Beats)
export function faelligeMuster(muster: MusterPlan[], beat: number): MusterPlan[] {
  return muster.filter((m) => beat >= m.ab_beat - MUSTER_VORLAUF_BEATS);
}

export function plane(spur: Spur, ankerBeat: number): Geplant {
  const g: Geplant = { teile: [], wirt: [], muster: [], ende_beat: ankerBeat };
  for (const f of spur.fahrten) {
    const ab = ankerBeat + 4 * (f.ab_takt - 1), dauer = 4 * (f.takte ?? 0);
    g.ende_beat = Math.max(g.ende_beat, ab + dauer);
    const strom = STROM_ZIEL.exec(f.ziel), wirt = WIRT_ZIEL.exec(f.ziel);
    if (strom) g.muster.push({ strom: Number(strom[1]), text: f.muster as string, ab_beat: ab });
    else if (wirt) g.wirt.push({ gruppe: wirt[1], name: wirt[2], ab_beat: ab, dauer_beats: dauer, bis: f.nach as number, form: f.form === 's' ? 's' : 'linear', ...(f.von !== undefined ? { von: f.von } : {}) });
    else g.teile.push({ pfad: f.ziel, ab_beat: ab, dauer_beats: dauer, nach: f.nach as number, form: f.form === 'linear' ? 0 : 1, politik: politikVon(f.ziel, f.nach as number) });
  }
  const frueh = (x: { ab_beat: number }, y: { ab_beat: number }) => x.ab_beat - y.ab_beat;
  g.teile.sort(frueh); g.wirt.sort(frueh); g.muster.sort(frueh);
  return g;
}

// Plan Hand D8 über die ganze Spur: Fader und Trim in Zeitfolge durchspielen; der erste Teil, der einen geschlossenen
// Kanal öffnet, wird genannt (null: keiner). Endwerte zählen (eine Rampe öffnet, wenn ihr Ziel offen ist).
export function oeffnetKanal(regler: Record<string, number>, teile: TeilPlan[]): string | null {
  const stand = { ...regler };
  for (const t of teile) {
    if (oeffnet(stand, t.pfad, t.nach)) return t.pfad;
    stand[t.pfad] = t.nach;
  }
  return null;
}

// Beat → CLOCK_MONOTONIC in Sekunden über die Gerade der Kern-Uhr (/uhr §5.2; konstantes Tempo bis dahin angenommen)
export function beatZuMono(u: { beat: number; mono_ns: number | bigint; bpm: number }, beat: number): number {
  return Number(u.mono_ns) / 1e9 + (beat - u.beat) * 60 / u.bpm;
}

export function wirtRuf(sock: string, befehl: Record<string, unknown>, ms = 3000): Promise<{ ok: boolean; fehler?: string; [k: string]: unknown }> {
  return new Promise((fertig) => {
    const c = net.createConnection(sock);
    let d = '';
    const uhr = setTimeout(() => { c.destroy(); fertig({ ok: false, fehler: 'timeout' }); }, ms);
    c.on('connect', () => c.write(JSON.stringify(befehl) + '\n'));
    c.on('data', (b) => {
      d += b;
      if (!d.endsWith('\n')) return;
      clearTimeout(uhr); c.end();
      try { fertig(JSON.parse(d)); } catch { fertig({ ok: false, fehler: 'no JSON answer' }); }
    });
    c.on('error', (e) => { clearTimeout(uhr); fertig({ ok: false, fehler: e.message }); });
  });
}
