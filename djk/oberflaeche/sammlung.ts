// Sets (Spec 2026-10-03 §7, Plan sets-mit-tracks): je Set ein Ordner <ordner>/<slug>/set.json. Im Code „Sammlung", weil
// der Leitstand „set_id" für eine Session-Journal-ID benutzt. Schreiben atomar (Temp-Datei, rename).
import fs from 'node:fs';
import path from 'node:path';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MID = /^[0-9a-f]{16}$/;

export interface Posten { id: string; art: 'track'; material_id: string; notiz?: string }
export interface Sammlung { schema: 1; name: string; angelegt: string; notiz: string; posten: Posten[]; ablauf: null }
export interface Eintrag { slug: string; name: string; posten: number; fehler?: string }

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

  liste(): Eintrag[] {
    if (!fs.existsSync(this.ordner)) return [];
    const aus: Eintrag[] = [];
    for (const d of fs.readdirSync(this.ordner, { withFileTypes: true }).filter((x) => x.isDirectory() && SLUG.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(this.ordner, d.name, 'set.json');
      if (!fs.existsSync(p)) continue;
      try { const s = JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; aus.push({ slug: d.name, name: String(s.name), posten: s.posten.length }); }
      catch { aus.push({ slug: d.name, name: d.name, posten: 0, fehler: 'json_kaputt' }); }
    }
    return aus;
  }

  lies(slug: string): Sammlung {
    const p = this.datei(slug);
    if (!fs.existsSync(p)) throw new SammlungFehler(404, 'unbekannt');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; } catch { throw new SammlungFehler(409, 'json_kaputt'); }
  }

  lege(name: string, posten: Posten[] = []): string {
    const n = String(name ?? '').trim();
    if (n.length < 1 || n.length > 80) throw new SammlungFehler(400, 'name_ungueltig');
    const basis = slugVon(n);
    let slug = basis;
    for (let i = 2; fs.existsSync(path.join(this.ordner, slug)); i++) slug = `${basis.slice(0, 44)}-${i}`;
    this.schreibe(slug, { schema: 1, name: n, angelegt: new Date().toISOString(), notiz: '', posten, ablauf: null });
    return slug;
  }

  legeHinzu(slug: string, art: string, materialId: string, notiz?: string): { id: string; schon_drin: boolean } {
    if (art !== 'track') throw new SammlungFehler(400, 'art_unbekannt');
    if (!MID.test(materialId)) throw new SammlungFehler(400, 'material_id_ungueltig');
    const s = this.lies(slug);
    const da = s.posten.find((p) => p.art === 'track' && p.material_id === materialId);
    if (da) return { id: da.id, schon_drin: true };
    const id = `p${Math.max(0, ...s.posten.map((p) => Number(p.id.slice(1)) || 0)) + 1}`;
    s.posten.push({ id, art: 'track', material_id: materialId, ...(notiz ? { notiz: String(notiz).slice(0, 200) } : {}) });
    this.schreibe(slug, s);
    return { id, schon_drin: false };
  }

  entferne(slug: string, id: string): void {
    const s = this.lies(slug);
    const vorher = s.posten.length;
    s.posten = s.posten.filter((p) => p.id !== id);
    if (s.posten.length === vorher) throw new SammlungFehler(404, 'posten_unbekannt');
    this.schreibe(slug, s);
  }

  loesche(slug: string): void {
    const p = path.dirname(this.datei(slug));
    if (!fs.existsSync(p)) throw new SammlungFehler(404, 'unbekannt');
    const korb = path.join(this.ordner, '.papierkorb');
    fs.mkdirSync(korb, { recursive: true });
    fs.renameSync(p, path.join(korb, `${slug}-${Date.now()}`));
  }
}
