// Presets on disk (package 1.16): one JSON file per preset, <wurzel>/<geraet>/<slug>.preset.json, for two roots:
//   werk   – factory presets, shipped read-only in the repository (djk/ui/presets/werk), never written here
//   nutzer – user presets, ~/.config/cypherdj[-<instanz>]/presets (paths.ts scheme), written only by this class
// Writes follow collection.ts: complete temp file, then rename (overwrite) or link (create, refuses an existing name atomically).
// Read-change-write runs under a lock per device folder (lock.ts) against FOREIGN processes; within one process every change is
// one synchronous section without await and needs no queue. A lock held by a live foreign process gives 409 preset_busy at once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nimmSperre, SperreBelegt } from '../lock.ts';
import { instanz } from '../paths.ts';
import { GERAET_IDS } from './devices.ts';
import { ladeVokabular, kanonisch, sha256, type Vokabular } from './vocabulary.ts';
import {
  DATEI_MAX, DATEINAME, ENDUNG, PresetFehler, pruefeDatei, pruefeEingabe, pruefeGeraet, pruefeHerkunft, pruefeName, pruefeSlug, slugVon, passt,
  sortiere, type Eintrag, type Filter, type Herkunft, type NeuEingabe, type Preset,
} from './model.ts';

export const WERK_VORGABE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'werk');
export function nutzerVorgabe(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj', 'presets'); }

// vok: the vocabulary descriptions are checked against (default presets/vokabular.json, loaded once per store)
export interface SpeicherOptionen { werk?: string; nutzer?: string; jetzt?: () => Date; vok?: Vokabular }
// hash: SHA-256 of the canonical JSON of the file as it is on disk (register.ts, DECISIONS.md P-R2)
export type Gelesen = Preset & { herkunft: Herkunft; slug: string; verworfen: string[]; hash: string };
export type Quelle = 'andreas' | 'cypher';

// 1.16 T1.4 (F4/F13): Cypher may overwrite, rename or delete an existing preset only when the file is readable AND marked as hers.
// An unreadable file (alt null after a 409 from lies) counts as unmarked, so it stays Andreas' to replace or delete.
export const cypherDarfNicht = (quelle: Quelle, alt: Gelesen | null): boolean => quelle === 'cypher' && !(alt !== null && alt.autor === 'cypher');

export class PresetSpeicher {
  readonly werk: string; readonly nutzer: string; readonly vok: Vokabular;
  private readonly jetzt: () => Date;
  constructor(opt: SpeicherOptionen = {}) {
    this.werk = opt.werk ?? WERK_VORGABE;
    this.nutzer = opt.nutzer ?? nutzerVorgabe();
    this.jetzt = opt.jetzt ?? (() => new Date());
    this.vok = opt.vok ?? ladeVokabular();
  }

  // The one place that turns request input into a path. Every part is checked against a whitelist or SLUG, so no "..", "/" or NUL
  // ever reaches path.join. Tests replace this method with a broken one to prove the traversal test has teeth.
  pfad(herkunft: Herkunft, geraet: string, slug: string): string {
    const h = pruefeHerkunft(herkunft), g = pruefeGeraet(geraet).id, s = pruefeSlug(slug);
    const basis = h === 'werk' ? this.werk : this.nutzer;   // not inside the join call: the export's folder renaming would rewrite the literal there
    return path.join(basis, g, `${s}${ENDUNG}`);
  }

  liste(f: Filter = {}): (Eintrag & { notiz: string })[] {
    const aus: (Eintrag & { notiz: string })[] = [];
    for (const herkunft of ['nutzer', 'werk'] as const) {
      if (f.herkunft && f.herkunft !== herkunft) continue;
      for (const geraet of GERAET_IDS) {
        if (f.geraet && f.geraet !== geraet) continue;
        const basis = herkunft === 'werk' ? this.werk : this.nutzer;
        const ordner = path.join(basis, geraet);
        let namen: fs.Dirent[];
        try { namen = fs.readdirSync(ordner, { withFileTypes: true }); } catch { continue; }
        for (const d of namen) {
          const m = DATEINAME.exec(d.name);
          if (!m || !d.isFile()) continue;   // temp files, the lock, symlinks, folders and names that are no slug are not presets
          const slug = m[1];
          try {
            const p = this.lies(herkunft, geraet, slug);
            aus.push({ herkunft, geraet, geraet_typ: p.geraet_typ, slug, name: p.name, tags: p.tags, geaendert: p.geaendert,
              beschreibung: p.beschreibung, familie: this.vok.familieVon.get(p.beschreibung.art) ?? null, notiz: p.notiz, ...(p.autor ? { autor: p.autor } : {}) });
          } catch (e) {
            // a damaged file is listed with its reason, never dropped and never repaired (like collection.ts json_kaputt)
            if (!(e instanceof PresetFehler)) throw e;
            aus.push({ herkunft, geraet, geraet_typ: null, slug, name: slug, tags: [], geaendert: null, beschreibung: null, familie: null, notiz: '', fehler: e.fehler });
          }
        }
      }
    }
    // a damaged file has no searchable content: it shows only when nothing is searched (passt() with its empty fields decides)
    return sortiere(aus.filter((e) => e.fehler !== undefined ? !f.q && !f.tag && passt(e, { ...f, geraet_typ: undefined }) : passt(e, f)));
  }

  lies(herkunft: Herkunft, geraet: string, slug: string): Gelesen {
    const p = this.pfad(herkunft, geraet, slug);
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { throw new PresetFehler(404, 'unbekannt'); }
    if (!st.isFile()) throw new PresetFehler(404, 'unbekannt');   // a symlink could point anywhere; we never follow one
    if (st.size > DATEI_MAX) throw new PresetFehler(409, 'zu_gross');
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new PresetFehler(409, 'json_kaputt'); }
    return { ...pruefeDatei(j, geraet, this.vok), herkunft, slug, hash: sha256(kanonisch(j)) };
  }

  // Save a new user preset. ueberschreiben: replace an existing preset of the same slug (keeps angelegt); erwartet: the geaendert
  // stamp the caller last saw, refused with 409 veraltet when the file changed since (another tab, another process).
  // quelle (1.16 F4/F13): a save by Cypher carries autor 'cypher'; a save by Andreas never does (his overwrite removes the mark).
  speichere(e: NeuEingabe, o: { ueberschreiben?: boolean; erwartet?: string; quelle?: Quelle } = {}): { slug: string; neu: boolean; preset: Preset } {
    const quelle = o.quelle ?? 'andreas';
    const roh = pruefeEingabe(e, this.vok);
    const slug = slugVon(roh.name);
    const p = this.pfad('nutzer', roh.geraet, slug);
    return this.mitSperre(roh.geraet, () => {
      const jetzt = this.zeit();
      const da = fs.existsSync(p);
      let alt: Gelesen | null = null;
      if (da) {
        if (!o.ueberschreiben) throw new PresetFehler(409, 'name_vergeben');
        try { alt = this.lies('nutzer', roh.geraet, slug); } catch (x) { if (!(x instanceof PresetFehler) || x.code !== 409) throw x; }   // a damaged file may be replaced
        if (cypherDarfNicht(quelle, alt)) throw new PresetFehler(403, 'nur_andreas_preset');   // ... but only by Andreas
      }
      if (o.erwartet !== undefined && (alt?.geaendert ?? null) !== o.erwartet) throw new PresetFehler(409, 'veraltet');
      const preset: Preset = { ...roh, ...(quelle === 'cypher' ? { autor: 'cypher' as const } : {}), angelegt: alt?.angelegt ?? jetzt, geaendert: jetzt };
      if (da) this.schreibe(p, preset); else this.legeAn(p, preset);
      return { slug, neu: !da, preset };
    });
  }

  benenne(geraet: string, slug: string, name: unknown, quelle: Quelle = 'andreas'): { slug: string } {
    const g = pruefeGeraet(geraet).id;
    const alt = this.pfad('nutzer', g, slug);
    const n = pruefeName(name);
    const neuSlug = slugVon(n);
    const neu = this.pfad('nutzer', g, neuSlug);
    return this.mitSperre(g, () => {
      const p = this.lies('nutzer', g, slug);   // a damaged file is refused for everyone (409), as before
      if (cypherDarfNicht(quelle, p)) throw new PresetFehler(403, 'nur_andreas_preset');
      const { verworfen: _v, herkunft: _h, slug: _s, hash: _x, autor: _a, ...rest } = p;
      // D27: the mark stays only when Cypher renames her own item; a rename by Andreas makes the preset his (the mark goes)
      const preset: Preset = { ...rest, ...(quelle === 'cypher' && p.autor === 'cypher' ? { autor: 'cypher' as const } : {}), name: n, geaendert: this.zeit() };
      if (neuSlug === slug) { this.schreibe(alt, preset); return { slug }; }
      this.legeAn(neu, preset);   // EEXIST → name_vergeben, the old file stays
      fs.rmSync(alt, { force: true });
      return { slug: neuSlug };
    });
  }

  // Delete moves the file into <nutzer>/.papierkorb (like collection.ts): a slip of the finger costs nothing
  loesche(geraet: string, slug: string, quelle: Quelle = 'andreas'): void {
    const g = pruefeGeraet(geraet).id;
    const p = this.pfad('nutzer', g, slug);
    this.mitSperre(g, () => {
      try { if (!fs.lstatSync(p).isFile()) throw new Error('kein file'); } catch { throw new PresetFehler(404, 'unbekannt'); }
      // 1.16 T1.4: read the file for the author mark; a damaged file (409) may still be deleted by Andreas, never by Cypher
      let alt: Gelesen | null = null;
      try { alt = this.lies('nutzer', g, slug); } catch (x) { if (!(x instanceof PresetFehler) || x.code !== 409) throw x; }
      if (cypherDarfNicht(quelle, alt)) throw new PresetFehler(403, 'nur_andreas_preset');
      const korb = path.join(this.nutzer, '.papierkorb');
      fs.mkdirSync(korb, { recursive: true });
      fs.renameSync(p, path.join(korb, `${g}-${slug}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.json`));
    });
  }

  private zeit(): string { return this.jetzt().toISOString(); }

  private mitSperre<T>(geraet: string, f: () => T): T {
    const ordner = path.join(this.nutzer, geraet);
    fs.mkdirSync(ordner, { recursive: true });
    let frei: () => void;
    try { frei = nimmSperre(path.join(ordner, '.sperre')); }
    catch (e) { if (e instanceof SperreBelegt) throw new PresetFehler(409, 'preset_busy'); throw e; }
    try { return f(); } finally { frei(); }
  }

  private temp(p: string, preset: Preset): string {
    const tmp = `${p}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeSync(fd, JSON.stringify(preset, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return tmp;
  }
  private schreibe(p: string, preset: Preset): void {
    const tmp = this.temp(p, preset);
    try { fs.renameSync(tmp, p); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  }
  private legeAn(p: string, preset: Preset): void {
    const tmp = this.temp(p, preset);
    try { fs.linkSync(tmp, p); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new PresetFehler(409, 'name_vergeben'); throw e; }
    finally { fs.rmSync(tmp, { force: true }); }
  }
}
