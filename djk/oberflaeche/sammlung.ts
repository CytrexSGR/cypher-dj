// Sets (Spec 2026-10-03 §7, Plan sets-mit-tracks): je Set ein Ordner <ordner>/<slug>/set.json. Im Code „Sammlung", weil
// der Leitstand „set_id" für eine Session-Journal-ID benutzt. Schreiben atomar (Temp-Datei, rename).
import fs from 'node:fs';
import path from 'node:path';
import { nimmSperre, SperreBelegt } from './sperre.ts';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MID = /^[0-9a-f]{16}$/;

export type PostenArt = 'track' | 'loop' | 'oneshot' | 'muster';
export const POSTEN_ARTEN: readonly PostenArt[] = ['track', 'loop', 'oneshot', 'muster'];
export type ListenArt = 'set' | 'playlist' | 'looplist' | 'strudellist';
export const LISTEN_ARTEN: readonly ListenArt[] = ['set', 'playlist', 'looplist', 'strudellist'];
// Welche Posten eine Liste nimmt (Andreas 2026-10-10 abends); ein Set ist die gemischte Sammlung der Spec §7
export const ERLAUBT: Record<ListenArt, readonly PostenArt[]> = {
  set: ['track', 'loop', 'oneshot', 'muster'], playlist: ['track'], looplist: ['loop', 'oneshot'], strudellist: ['muster'],
};
// Muster-Referenz: <quelle>:<name> bzw. <quelle>:<datei>:<schlüssel> (muster_bibliothek.ts, Task 2b.3); nie ein Pfad
export const MUSTER_REF = /^(eigen:[a-z0-9][a-z0-9_-]{0,47}|track:[a-z0-9][a-z0-9_-]{0,47}:[A-Za-z0-9_]{1,48}|dirigent:[a-z0-9][a-z0-9_-]{0,47}:[a-z0-9][a-z0-9_-]{0,47})$/;
// Spec §7: Loops (und, als Erweiterung, Samples) tragen quelle 'mediathek'; Muster tragen ref statt material_id
export interface Posten { id: string; art: PostenArt; material_id?: string; ref?: string; quelle?: 'mediathek'; notiz?: string }
export interface Sammlung { schema: 1; art?: ListenArt; name: string; angelegt: string; notiz: string; posten: Posten[]; ablauf: null }
export interface Eintrag { slug: string; name: string; art: ListenArt; posten: number; fehler?: string }

export class SammlungFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}

export function slugVon(name: string): string {
  const s = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s === 'import' ? 'import-set' : (s || 'set');   // „import" ist die Route POST /sammlungen/import
}

export interface PostenAnsicht { status: string; dauer_s: number | null; bpm: number | null; camelot: string | null; genre: string | null }

export function uebersicht(posten: PostenAnsicht[]): Record<string, unknown> {
  const zaehle = (werte: (string | null)[]): Record<string, number> => {
    const z: Record<string, number> = {};
    for (const w of werte) if (w) z[w] = (z[w] ?? 0) + 1;
    return z;
  };
  const bpms = posten.map((p) => p.bpm).filter((b): b is number => b !== null).sort((a, b) => a - b);
  const mitte = bpms.length % 2 ? bpms[(bpms.length - 1) / 2] : (bpms[bpms.length / 2 - 1] + bpms[bpms.length / 2]) / 2;
  return {
    tracks: posten.length,
    dauer_s: Math.round(posten.reduce((s, p) => s + (p.dauer_s ?? 0), 0) * 10) / 10,
    bpm: bpms.length ? { min: bpms[0], max: bpms[bpms.length - 1], median: mitte } : null,
    camelot: zaehle(posten.map((p) => p.camelot)),
    genre: zaehle(posten.map((p) => p.genre)),
    status: zaehle(posten.map((p) => p.status)),
  };
}

export class Sammlungen {
  private readonly ordner: string;
  constructor(ordner: string) { this.ordner = ordner; }
  get ordnerPfad(): string { return this.ordner; }

  private datei(slug: string): string {
    if (!SLUG.test(slug)) throw new SammlungFehler(400, 'slug_ungueltig');
    return path.join(this.ordner, slug, 'set.json');
  }

  private schreibe(slug: string, s: Sammlung): void {
    const p = this.datei(slug);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1) + '\n');
    fs.renameSync(tmp, p);
  }

  // Lesen-ändern-Schreiben unter einer Sperre je Liste gegen fremde Prozesse (sperre.ts; gemessen im S2b-Review: ohne sie kamen 263 von
  // 400 Posten an). Nie blockierend: ist die Liste von einem lebenden Fremdprozess belegt, kommt sofort 409 liste_busy, und der Server
  // wiederholt asynchron. Im eigenen Prozess ist jede Änderung ein synchroner Abschnitt ohne await, also ohnehin nie verschränkt.
  private mitSperre<T>(slug: string, f: () => T): T {
    let frei: () => void;
    try { frei = nimmSperre(path.join(path.dirname(this.datei(slug)), '.sperre')); }
    catch (e) {
      if (e instanceof SperreBelegt) throw new SammlungFehler(409, 'liste_busy');
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new SammlungFehler(404, 'unbekannt');   // der Ordner der Liste fehlt
      throw e;
    }
    try { return f(); } finally { frei(); }
  }

  liste(art?: ListenArt | string): Eintrag[] {
    if (!fs.existsSync(this.ordner)) return [];
    const aus: Eintrag[] = [];
    for (const d of fs.readdirSync(this.ordner, { withFileTypes: true }).filter((x) => x.isDirectory() && SLUG.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(this.ordner, d.name, 'set.json');
      if (!fs.existsSync(p)) continue;
      try { const s = JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; aus.push({ slug: d.name, name: String(s.name), art: s.art ?? 'set', posten: s.posten.length }); }
      catch { aus.push({ slug: d.name, name: d.name, art: 'set', posten: 0, fehler: 'json_kaputt' }); }
    }
    return art ? aus.filter((e) => e.art === art) : aus;
  }

  lies(slug: string): Sammlung {
    const p = this.datei(slug);
    if (!fs.existsSync(p)) throw new SammlungFehler(404, 'unbekannt');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; } catch { throw new SammlungFehler(409, 'json_kaputt'); }
  }

  lege(name: string, posten: Posten[] = [], art: string = 'set'): string {
    if (!(LISTEN_ARTEN as readonly string[]).includes(art)) throw new SammlungFehler(400, 'art_unbekannt');
    const n = String(name ?? '').trim();
    if (n.length < 1 || n.length > 80) throw new SammlungFehler(400, 'name_ungueltig');
    const basis = slugVon(n);
    let slug = basis;
    // Ordner exklusiv anlegen (mkdir ohne recursive scheitert mit EEXIST): zwei Prozesse mit gleichem Namen bekommen verschiedene Slugs
    fs.mkdirSync(this.ordner, { recursive: true });
    for (let i = 2; ; i++) {
      try { fs.mkdirSync(path.join(this.ordner, slug)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      slug = `${basis.slice(0, 44)}-${i}`;
    }
    this.schreibe(slug, { schema: 1, art: art as ListenArt, name: n, angelegt: new Date().toISOString(), notiz: '', posten, ablauf: null });
    return slug;
  }

  legeHinzu(slug: string, art: string, ref: string, notiz?: string): { id: string; schon_drin: boolean } {
    if (!(POSTEN_ARTEN as readonly string[]).includes(art)) throw new SammlungFehler(400, 'art_unbekannt');
    if (art === 'muster' ? !MUSTER_REF.test(ref) : !MID.test(ref)) throw new SammlungFehler(400, art === 'muster' ? 'ref_ungueltig' : 'material_id_ungueltig');
    return this.mitSperre(slug, () => this.legeHinzuGesperrt(slug, art, ref, notiz));
  }

  private legeHinzuGesperrt(slug: string, art: string, ref: string, notiz?: string): { id: string; schon_drin: boolean } {
    const s = this.lies(slug);
    if (!ERLAUBT[s.art ?? 'set'].includes(art as PostenArt)) throw new SammlungFehler(400, 'art_passt_nicht_zur_liste');
    const schluessel = (p: Posten): string | undefined => (p.art === 'muster' ? p.ref : p.material_id);
    const da = s.posten.find((p) => p.art === art && schluessel(p) === ref);
    if (da) return { id: da.id, schon_drin: true };
    const id = `p${Math.max(0, ...s.posten.map((p) => Number(p.id.slice(1)) || 0)) + 1}`;
    s.posten.push({ id, art: art as PostenArt, ...(art === 'muster' ? { ref } : { material_id: ref }),
      ...(art === 'loop' || art === 'oneshot' ? { quelle: 'mediathek' as const } : {}), ...(notiz ? { notiz: String(notiz).slice(0, 200) } : {}) });
    this.schreibe(slug, s);
    return { id, schon_drin: false };
  }

  verschiebe(slug: string, id: string, nach: number): void {
    this.mitSperre(slug, () => {
      const s = this.lies(slug);
      const i = s.posten.findIndex((p) => p.id === id);
      if (i < 0) throw new SammlungFehler(404, 'posten_unbekannt');
      const [p] = s.posten.splice(i, 1);
      s.posten.splice(Math.max(0, Math.min(s.posten.length, Math.floor(Number(nach) || 0))), 0, p);
      this.schreibe(slug, s);
    });
  }

  benenne(slug: string, name: string): void {
    const n = String(name ?? '').trim();
    if (n.length < 1 || n.length > 80) throw new SammlungFehler(400, 'name_ungueltig');
    this.mitSperre(slug, () => { const s = this.lies(slug); s.name = n; this.schreibe(slug, s); });
  }

  entferne(slug: string, id: string): void {
    this.mitSperre(slug, () => {
      const s = this.lies(slug);
      const vorher = s.posten.length;
      s.posten = s.posten.filter((p) => p.id !== id);
      if (s.posten.length === vorher) throw new SammlungFehler(404, 'posten_unbekannt');
      this.schreibe(slug, s);
    });
  }

  loesche(slug: string): void {
    const p = path.dirname(this.datei(slug));
    if (!fs.existsSync(p)) throw new SammlungFehler(404, 'unbekannt');
    const korb = path.join(this.ordner, '.papierkorb');
    fs.mkdirSync(korb, { recursive: true });
    fs.renameSync(p, path.join(korb, `${slug}-${Date.now()}`));
  }
}
