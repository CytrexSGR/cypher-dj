import path from 'node:path';
import { type Projekt, alleZellen } from '../../project/model.ts';
import type { DekodierEreignis } from '../../project/decode.ts';
import { Katalog, type Zeile } from '../../catalog.ts';
import { alleAudioClips } from '../../project/commands.ts';
import type { TempoQuelle } from '../../project/warp.ts';
import { deckleDekodiert } from '../../project/cache_deckel.ts';
import { loeseQuelle } from '../../project/source_path.ts';
import { type Hinweis, type Offen, alleZellQuellen } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

/** The shas of the audio clips and of the loop deck cells of the open project (the decode cap never removes them). */
export function offeneShas(this: ProjSitzung): Set<string> {
  const aus = new Set<string>();
  if (this.offen) {
    for (const c of alleAudioClips(this.offen.projekt)) aus.add(c.quelle.sha256);
    for (const z of alleZellen(this.offen.projekt)) aus.add(z.sha256);
  }
  return aus;
}

export function deckelDekodiert(this: ProjSitzung, frisch: string | null): void {
  deckleDekodiert({ arbeitsordner: this.arbeitsordner, projekte: this.projekte, offeneShas: () => this.offeneShas(), frisch,
    log: (z) => this.ctx.log(z), gemeldet: this.deckelGemeldet, sperre: this.deckelSperre });
}

// Pfad einer Quelle: über den Katalog (Spec 2.9: sha ist die Identität, der Pfad nur Hinweis); ohne Katalog-Treffer der Hinweis, wenn da.
export function quellPfad(this: ProjSitzung, sha: string, hinweis: string, slug: string | null = this.offen?.slug ?? null): string | null {
  let katalogPfad: string | null = null;
  if (this.katalog) {
    try {
      const z = this.katalog.eintrag(sha);
      if (z && z.schutz !== 'ableton' && z.pfad) katalogPfad = z.pfad;
    } catch { /* Katalog fehlt oder ist kaputt: Hinweis versuchen */ }
  }
  return loeseQuelle({ sha256: sha, hinweis, projektOrdner: slug !== null ? path.resolve(this.projekte.wurzelPfad, slug) : null, katalogPfad });
}

/** ANALYZE slice 2: the file and the title of a catalogue entry (null: no catalogue, unknown sha, protected entry). */
export function katalogQuelle(this: ProjSitzung, sha: string): { pfad: string; name?: string } | null {
  if (!this.katalog) return null;
  try {
    const z = this.katalog.eintrag(sha);
    if (!z || z.schutz === 'ableton' || !z.pfad) return null;
    const name = z.titel ?? z.name;
    return { pfad: z.pfad, ...(name ? { name } : {}) };
  } catch { return null; }
}

// storage layout A5: a removable source is copied into the project folder in the background; once after open, once after a change that
// adds or replaces an audio clip. The collector drops a second report for the same folder while one waits.
export function meldeEinsammeln(this: ProjSitzung, o: Offen): void {
  // fixed slug: a project switch while the job waits must not change the lookup
  const projektOrdner = path.resolve(this.projekte.wurzelPfad, o.slug);
  this.einsammler?.melde({ projekt: o.projekt, projektOrdner, quellPfad: (s, h) => this.quellPfad(s, h, o.slug) });
}

// Welle der Seite (S6 Task 14): Pfad einer sha, die ein Audio-Clip des offenen Projekts trägt (Stems, Takes). Der Pfad kommt aus dem
// Projekt, nie aus der Anfrage; eine sha ohne Clip im offenen Projekt gibt null.
export function projektQuellPfad(this: ProjSitzung, sha: string): string | null {
  const o = this.offen;
  if (!o) return null;
  for (const c of alleAudioClips(o.projekt)) if (c.quelle.sha256 === sha) return this.quellPfad(sha, c.quelle.pfad_hinweis);   // take clips too (R9)
  const zellHinweis = alleZellQuellen(o.projekt).get(sha);   // a loop deck cell: its project-relative file
  return zellHinweis === undefined ? null : this.quellPfad(sha, zellHinweis);
}

// Setzt dekodiert aller Audio-Clips (ohne rev, Spec 6.6) und fordert fehlende Dekodierungen an. fehlerNeu: auch Fehlgeschlagene neu versuchen.
// Rückgabe: die shas, deren Zustand sich geändert hat (Haupt- und Take-Clips); ob das die Wiedergabe betrifft, sagt betrifftWiedergabe.
export function gleicheDekodiertAb(this: ProjSitzung, p: Projekt, fehlerNeu: boolean, slug: string | null = this.offen?.slug ?? null): Set<string> {
  const geaendert = new Set<string>();
  for (const c of alleAudioClips(p)) {
    let z = this.zustandVon(c.quelle.sha256);
    if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
      const pfad = this.quellPfad(c.quelle.sha256, c.quelle.pfad_hinweis, slug);
      z = pfad ? this.cache.fordereAn(c.quelle.sha256, pfad) : 'fehler';
    }
    if (z === 'fertig') this.cache.beruehre(c.quelle.sha256);   // a project uses this decode: the size cap removes the unused ones first
    if (c.dekodiert !== z) { c.dekodiert = z; geaendert.add(c.quelle.sha256); }
  }
  // loop deck cells: decoded like clip sources. A cell carries no state field, so the last seen state per sha is kept here
  const zellShas = alleZellQuellen(p);
  for (const sha of this.zellZustand.keys()) if (!zellShas.has(sha)) this.zellZustand.delete(sha);   // no cell carries it any more
  for (const [sha, hinweis] of zellShas) {
    let z = this.zustandVon(sha);
    if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
      const pfad = this.quellPfad(sha, hinweis, slug);
      z = pfad ? this.cache.fordereAn(sha, pfad) : 'fehler';
    }
    if (z === 'fertig') this.cache.beruehre(sha);
    if (this.zellZustand.get(sha) !== z) { this.zellZustand.set(sha, z); geaendert.add(sha); }
  }
  return geaendert;
}

// 1.14 comping: the one place that decides whether a changed decode state reaches the playback. Today only main clips are played, so a take-only
// sha changes nothing there, unless a track is auditioning that take.
export function betrifftWiedergabe(this: ProjSitzung, p: Projekt, geaenderteShas: Iterable<string>): boolean {
  const shas = new Set(geaenderteShas);
  if (shas.size === 0) return false;
  for (const sha of alleZellQuellen(p).keys()) if (shas.has(sha)) return true;   // a loop deck cell is played from its decode
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio' && shas.has(c.quelle.sha256)) return true;
  // 1.14: a take clip counts when a track auditions that take
  for (const [spurId, takeId] of this.offen?.vorhoeren ?? []) {
    const take = p.spuren.find((s) => s.id === spurId)?.takes?.find((x) => x.id === takeId);
    if (take?.clips.some((c) => c.art === 'audio' && shas.has(c.quelle.sha256))) return true;
  }
  return false;
}

export function dekodiertEreignis(this: ProjSitzung, e: DekodierEreignis): void {
  void this.seriell(async () => {
    const o = this.offen;
    if (!o) return;
    for (const c of alleAudioClips(o.projekt)) {
      if (c.quelle.sha256 !== e.sha || c.dekodiert === e.zustand) continue;
      c.dekodiert = e.zustand;
      this.ctx.verteile({ a: 'proj', f: { clip_id: c.id, dekodiert: e.zustand } });   // ohne neue rev (Festlegung V1)
    }
    if (alleZellQuellen(o.projekt).has(e.sha)) this.zellZustand.set(e.sha, e.zustand);
    if (e.zustand === 'fertig' && this.betrifftWiedergabe(o.projekt, [e.sha])) await this.ladeOderMerke('andreas');
  }).catch((x) => this.ctx.log({ typ: 'proj_dekodier_fehler', sha: e.sha, fehler: (x as Error).message }));
}

// --- ändern -----------------------------------------------------------------------------------------------------------
// source resolution of a command list: see session_sources.ts
export function tempoQuelleFuer(this: ProjSitzung, z: Zeile, sha: string): TempoQuelle {
  return this.quellen.tempoQuelleFuer(z, sha);
}
