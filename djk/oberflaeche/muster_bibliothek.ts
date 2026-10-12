// Strudel-Muster für den Browser (Plan 2026-10-10-mediathek-browser, S2b). Drei Quellen:
//  eigen    — bibliothek/muster/<name>.js (+ .json), im Git; geschrieben nur über speichere() (SAVE am Strudel-Deck)
//  track    — sets/<ordner>/track.mjs, export const M { d_*|b_*|m_*: Ausdruck } (vorgeplante Tracks, 15/15 prüfbar)
//  dirigent — sets/*.json, Blöcke {name, bars, bpm, code|layers} des alten Dirigenten: NUR ansehen (gemessen 2026-10-10:
//             code 0/26 und stack(layers) 103/213 gehen durch djk-muster, 128/213 nutzen .bank() mit Web-Samples)
// ids sind <quelle>:… (sammlung.ts MUSTER_REF), nie Pfade. Laden in eine Instanz macht die Seite (Editor füllen, nicht senden).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MUSTER_REF } from './sammlung.ts';

export type Rolle = 'drums' | 'bass' | 'melodie';
export interface MusterEintrag { id: string; quelle: 'eigen' | 'track' | 'dirigent'; name: string; rolle: Rolle | null; bpm: number | null; takte: number | null; text: string; ladbar: boolean }
export class MusterFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}
const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const PRAEFIX: Record<string, Rolle> = { d: 'drums', b: 'bass', m: 'melodie' };
const liesJson = (p: string): unknown => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

export class MusterBibliothek {
  private readonly o: { eigen: string; sets: string };
  constructor(o: { eigen: string; sets: string }) { this.o = o; }

  async liste(): Promise<MusterEintrag[]> {
    const aus: MusterEintrag[] = [];
    if (fs.existsSync(this.o.eigen)) for (const f of fs.readdirSync(this.o.eigen).filter((x) => x.endsWith('.js')).sort()) {
      const name = f.slice(0, -3); if (!NAME.test(name)) continue;
      const meta = (liesJson(path.join(this.o.eigen, `${name}.json`)) ?? {}) as { rolle?: Rolle; bpm?: number };
      aus.push({ id: `eigen:${name}`, quelle: 'eigen', name, rolle: meta.rolle ?? null, bpm: meta.bpm ?? null, takte: null,
        text: fs.readFileSync(path.join(this.o.eigen, f), 'utf8').trim(), ladbar: true });
    }
    if (!fs.existsSync(this.o.sets)) return aus;
    for (const e of fs.readdirSync(this.o.sets, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && NAME.test(e.name) && fs.existsSync(path.join(this.o.sets, e.name, 'track.mjs'))) {
        const datei = path.join(this.o.sets, e.name, 'track.mjs');
        // eigene Dateien im Repo; mtime im URL, damit eine geänderte Datei neu geladen wird
        const m = await import(`${pathToFileURL(datei).href}?v=${fs.statSync(datei).mtimeMs}`).catch(() => null) as { M?: Record<string, unknown> } | null;
        for (const [k, v] of Object.entries(m?.M ?? {})) if (typeof v === 'string' && /^[A-Za-z0-9_]{1,48}$/.test(k))
          aus.push({ id: `track:${e.name}:${k}`, quelle: 'track', name: `${e.name} · ${k}`, rolle: PRAEFIX[k.split('_')[0]] && k.includes('_') ? PRAEFIX[k.split('_')[0]] : null,
            bpm: null, takte: null, text: v.trim(), ladbar: true });
      } else if (e.isFile() && e.name.endsWith('.json') && NAME.test(e.name.slice(0, -5))) {
        const datei = e.name.slice(0, -5);
        const j = liesJson(path.join(this.o.sets, e.name)) as { blocks?: { name?: string; bars?: number; bpm?: number; code?: string; layers?: string[] }[] } | null;
        // ids aus Datei + Blockname, nicht aus der Position (ein vorn eingefügter Block verschiebt sonst jede id). Gleicher Slug mehrfach
        // in einer Datei: alle bekommen -<6 Hex> vom Inhalt, gleicher Inhalt zusätzlich -<n> (Review S2b Befund 4).
        const hash = (t: string): string => createHash('sha1').update(t).digest('hex').slice(0, 6);
        const bloecke = (j?.blocks ?? []).map((b, i) => ({ b, i, text: typeof b.code === 'string' ? b.code.trim() : Array.isArray(b.layers) ? `stack(\n  ${b.layers.join(',\n  ')}\n)` : '' }))
          .filter((x) => x.text).map((x) => {
            const roh = typeof x.b.name === 'string' ? x.b.name : '';
            const slug = roh.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
            return { ...x, slug: slug || `block-${hash(x.text)}` };   // ohne Namen: aus dem Inhalt, nie aus der Position (Re-Review N6)
          });
        const je = new Map<string, number>();
        for (const x of bloecke) je.set(x.slug, (je.get(x.slug) ?? 0) + 1);
        const vergeben = new Map<string, number>();
        for (const x of bloecke) {
          let k = (je.get(x.slug) ?? 0) > 1 ? `${x.slug}-${hash(x.text)}` : x.slug;
          const n = vergeben.get(k) ?? 0; vergeben.set(k, n + 1);
          if (n > 0) { const suffix = `-${n + 1}`; k = `${k.slice(0, 48 - suffix.length)}${suffix}`; }   // höchstens 48 Zeichen, sonst weist MUSTER_REF die id ab
          aus.push({ id: `dirigent:${datei}:${k}`, quelle: 'dirigent', name: `${datei} · ${x.b.name || x.i}`, rolle: null,
            bpm: typeof x.b.bpm === 'number' ? x.b.bpm : null, takte: typeof x.b.bars === 'number' ? x.b.bars : null, text: x.text, ladbar: false });
        }
      }
    }
    return aus;
  }

  async eintrag(id: string): Promise<MusterEintrag | null> {
    if (!MUSTER_REF.test(id)) return null;
    return (await this.liste()).find((e) => e.id === id) ?? null;
  }

  speichere(o: { name: string; text: string; rolle: Rolle | null; strom: number; von: string; ueberschreiben?: boolean }): { name: string } {
    if (!NAME.test(o.name)) throw new MusterFehler(400, 'name_ungueltig');
    const text = String(o.text ?? '').trim();
    if (!text || text === 'silence') throw new MusterFehler(409, 'kein_muster');
    const js = path.join(this.o.eigen, `${o.name}.js`);
    fs.mkdirSync(this.o.eigen, { recursive: true });
    if (!o.ueberschreiben) {   // Name exklusiv belegen (O_EXCL), nicht erst prüfen und dann schreiben: zwei SAVE gleichzeitig verlieren sonst eins
      try { fs.closeSync(fs.openSync(js, 'wx')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new MusterFehler(409, 'name_vergeben'); throw e; }
    }
    for (const [ziel, inhalt] of [[`${js.slice(0, -3)}.json`, JSON.stringify({ rolle: o.rolle, strom: o.strom, von: o.von, gespeichert: new Date().toISOString() }, null, 1) + '\n'], [js, `${text}\n`]]) {
      const tmp = `${ziel}.${process.pid}.neu`; fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, ziel);
    }
    return { name: o.name };
  }
}
