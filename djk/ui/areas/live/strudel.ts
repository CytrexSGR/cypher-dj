// Pattern (strudel) requests and catalogue loops of the page server (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { alsAntwort } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { strudelGruppe, stromSpur, platzVonGruppe } from '../../project/model.ts';
import { beatsVon, importiereLoop, loopNameVon, findeImport, LoopImportFehler } from '../../loop_import.ts';
import { REPO, REPO_PFADE, strudelPakete } from '../../paths.ts';
import { abBeat } from '../../deck_operation.ts';
import { KatalogFehler, type Zeile } from '../../catalog.ts';
import { Mediathek } from '../../media_library.ts';
import { stromVonZiel } from '../../track.ts';
import { ALLE_STROEME } from '../../../contract/streams.ts';
import { STRUDEL_ZEITLIMIT_MS } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export function strudel(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse, intern: { versatz?: number; abBeat?: number } = {}): Promise<void> {
  const lauf = this.musterKette.then(() => this.strudelEins(d, a, intern));
  this.musterKette = lauf.catch(() => {});
  return lauf;
}
export async function strudelEins(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse, intern: { versatz?: number; abBeat?: number } = {}): Promise<void> {
  if (typeof d.text !== 'string') return this.json(a, 400, { fehler: 'kein_text' });
  const strom = Oberflaeche.strom(d.strom);
  if (strom === null) return this.json(a, 400, { fehler: 'strom' });
  if (d.bezeichnung !== undefined && d.bezeichnung !== null && !(typeof d.bezeichnung === 'string' && d.bezeichnung.length >= 1 && d.bezeichnung.length <= 60 && !/[\u0000-\u001f\u007f]/.test(d.bezeichnung))) return this.json(a, 400, { fehler: 'bezeichnung', text: 'bezeichnung: string of 1..60 characters, no control characters' });
  // Plan Hand T7 (Review M4): Cypher schreibt als cypher und ohne --als-andreas; djk-muster hält AUTO ein (rc 4)
  const von = this.quelle();
  if (von === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
  // container core M6: the pattern belongs to the strudel module of the live container; nothing is written without it
  const offen = this.proj.zugang.offen();
  if (!offen || offen.projekt.live !== true) return this.json(a, 409, { fehler: 'kein_liveprojekt', text: 'the strudel module sits in the live container' });
  const modul = strudelGruppe(offen.projekt);
  if (!modul || platzVonGruppe(offen.projekt, modul.id) === null) return this.json(a, 409, { fehler: 'kein_strudel_modul', text: 'no place holds the strudel module; place it with POST /plaetze' });
  const ordner = this.musterOrdner(strom);
  fs.mkdirSync(ordner, { recursive: true });   // Review F4: im Kindprozess scheitert das Schreiben in einen neuen Ordner
  const strudel = path.dirname(strudelPakete());
  const r = await new Promise<{ code: number | null; fehler: string; zeitlimit: boolean }>((fertig) => {
    let k: ReturnType<typeof spawn>;
    try {
    k = spawn(process.execPath, ['--max-old-space-size=512', '--permission', `--allow-fs-read=${path.join(REPO, 'djk')}`, `--allow-fs-read=${strudel}`,
      `--allow-fs-read=${ordner}`, `--allow-fs-write=${ordner}`, REPO_PFADE.djkMuster,
      '--ziel', path.join(ordner, 'strom1.js'), ...(von === 'cypher' ? ['--von', 'cypher'] : ['--von', 'andreas', '--als-andreas']),
      ...(Number.isInteger(intern.versatz) && intern.versatz !== 0 ? [`--versatz=${intern.versatz}`] : []),
      ...(typeof d.bezeichnung === 'string' ? [`--bezeichnung=${d.bezeichnung}`] : []), '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {   // a throwing spawn (bad argument) is a logged error, never an unhandled rejection
      const m = e instanceof Error ? e.message : String(e);
      this.opt.log?.({ typ: 'muster_spawn_fehler', text: m });
      return fertig({ code: 1, fehler: `Error: ${m}`, zeitlimit: false });
    }
    let fehler = '';
    let zeitlimit = false;
    const uhr = setTimeout(() => { zeitlimit = true; k.kill('SIGKILL'); }, STRUDEL_ZEITLIMIT_MS);
    k.stderr!.on('data', (b: Buffer) => { if (fehler.length < 4096) fehler += b.toString(); });
    k.on('error', (e) => { fehler += e.message; });
    k.on('close', (code) => { clearTimeout(uhr); fertig({ code, fehler, zeitlimit }); });
    k.stdin!.on('error', () => {});
    k.stdin!.end(d.text as string);
  });
  if (r.zeitlimit) return this.json(a, 400, { fehler: `Zeile 1: Zeitlimit ${STRUDEL_ZEITLIMIT_MS / 1000} s überschritten` });
  if (r.code === 4 && von === 'cypher') return this.json(a, 409, { fehler: 'auto_aus', text: 'AUTO is off: Andreas holds the pattern' });
  if (r.code === 2) {
    const zeile = r.fehler.split('\n').find((z) => z.startsWith('djk-muster: ')) ?? r.fehler;
    return this.json(a, 400, { fehler: zeile.replace(/^djk-muster: /, '').trim() || 'Zeile 1: unbekannter Fehler' });
  }
  if (r.code !== 0) {   // Review F3: die Fehlerzeile, nicht die letzte Zeile (das ist „Node.js v22…“)
    const zeilen = r.fehler.split('\n').map((z) => z.trim()).filter((z) => z && !/^Node\.js v/.test(z));
    const grund = zeilen.find((z) => /Error|ERR_|djk-muster:/.test(z)) ?? zeilen.pop() ?? `rc ${r.code}`;
    return this.json(a, 400, { fehler: `Zeile 1: Prüfung fehlgeschlagen (${grund.slice(0, 200)})` });
  }
  this.opt.log?.({ typ: 'muster', von, laenge: d.text.length });
  // the switch bar: a track move knows its beat; a direct pattern takes effect at the next bar the erzeuger can still reach
  this.musterAnkerTakt.set(strom, Math.floor((typeof intern.abBeat === 'number' ? intern.abBeat : this.abVon('takt')) / this.proTakt()) + 1);
  let spur: { id: string; neu: boolean };
  try { spur = await this.sorgeFuerStromSpur(strom, von); } catch (e) { const r = alsAntwort(e, this.bereichKontext()); return this.json(a, r.code, r.j); }
  this.json(a, 200, { ok: true, strom_spur: spur.id, ...(spur.neu ? { strom_spur_neu: true } : {}) });
}
// The stream that AUTO holds for a target: the alias and host forms of stromVonZiel, and a row `spur/<nr>/...` of a strom track of the open project
// (the direct form of the carve-out) holds the stream of that track, so the AUTO switch cannot be bypassed through the row.
export function stromVonZielOffen(this: Oberflaeche, ziel: string): number | null {
  const st = stromVonZiel(ziel);
  if (st !== null) return st;
  const m = /^spur\/([1-9]|[1-9][0-9]|1[01][0-9]|12[0-8])\//.exec(ziel);
  const o = m ? this.proj.zugang.offen() : null;
  const spur = m && o ? o.projekt.spuren.find((x) => x.nr === Number(m[1]) && x.art === 'strom') : undefined;
  return spur?.strom !== undefined && (ALLE_STROEME as readonly number[]).includes(spur.strom) ? spur.strom : null;
}
// The strom track of stream n in the strudel module: created on first use (one strom_spur_neu command), later calls leave the project alone.
export async function sorgeFuerStromSpur(this: Oberflaeche, strom: number, quelle: 'andreas' | 'cypher'): Promise<{ id: string; neu: boolean }> {
  const o = this.proj.zugang.offen();
  const da = o && stromSpur(o.projekt, strom);
  if (o && da) return { id: da.id, neu: false };
  if (!o) throw new ProjFehler(409, 'kein_liveprojekt');
  const r = await this.proj.sitzung.aendern({ rev: o.projekt.rev, label: `Strom track ${strom}`, befehle: [{ befehl: 'strom_spur_neu', strom }] }, quelle);
  if (r.code !== 200) throw new ProjFehler(r.code, String(r.j.fehler ?? 'intern'));
  const neu = this.proj.zugang.offen()?.projekt && stromSpur(this.proj.zugang.offen()!.projekt, strom);
  return { id: neu ? neu.id : '', neu: true };
}
// Browser S6: Loop aus der Mediathek in die Loop-Bibliothek (danach lädt die Seite ihn wie jeden Loop per POST /loop).
// Rechnen darf nur ein Import zur Zeit und nur mit nice 19 / ionice idle (loop_import.ts); dieselbe Quelle wird nicht doppelt angelegt.
// The import itself (also the catalogue source of a loop deck cell): the loop of a catalogue sound is in the library afterwards, an earlier import is reused.
export async function loopAusKatalogName(this: Oberflaeche, sha: string): Promise<{ name: string; beats: number; schonDa: boolean }> {
  const z = this.katalog.eintrag(sha);
  if (!z) throw new KatalogFehler(404, 'unbekannt');
  if (z.typ !== 'loop') throw new KatalogFehler(409, 'kein_loop');
  if (z.schutz === 'ableton') throw new KatalogFehler(409, 'nur_live');
  if (!z.pfad || !fs.existsSync(z.pfad)) throw new KatalogFehler(409, 'datei_fehlt');
  const beats = beatsVon(z);
  const dir = this.loopOrdner();
  const da = findeImport(dir, z.sha);
  if (da) return { ...da, schonDa: true };
  const t0 = Date.now();
  let naht: Record<string, unknown> = {};
  const name = await importiereLoop({ bericht: (x) => { naht = x; }, pfad: z.pfad, beats, bpm: z.bpm, name: loopNameVon(z.name ?? z.titel ?? 'loop', dir), dir, werkzeug: this.opt.loopWerkzeug,
    herkunft: { quelle: 'mediathek', sha: z.sha, pfad: z.pfad, bpm: z.bpm, takte: z.takte } });
  this.opt.log?.({ typ: 'loop_importiert', name, beats, sha: z.sha, ms: Date.now() - t0, ...naht });
  return { name, beats, schonDa: false };
}
// Loop deck {sha} source: a catalogue loop goes the way of POST /loops/aus-katalog, a one-shot is copied as it is (art 'einmal'); a track is kein_loop
export async function katalogFuerDeck(this: Oberflaeche, sha: string): Promise<{ name: string; einmal?: { datei: string; sha: string; frames: number } }> {
  const z = this.katalog.eintrag(sha);
  if (z?.typ !== 'oneshot') return this.loopAusKatalogName(sha);
  if (z.schutz === 'ableton') throw new KatalogFehler(409, 'nur_live');
  if (!z.pfad || !fs.existsSync(z.pfad)) throw new KatalogFehler(409, 'datei_fehlt');
  return { name: (z.name ?? z.titel ?? 'one-shot').toString().trim().slice(0, 64) || 'one-shot',
    einmal: { datei: z.pfad, sha: z.sha, frames: z.dauer_s !== null && z.dauer_s > 0 ? Math.ceil(z.dauer_s * 48000) : 0 } };
}
export async function loopAusKatalog(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  try {
    const r = await this.loopAusKatalogName(String(d.sha ?? ''));
    if (r.schonDa) return this.json(a, 200, { name: r.name, beats: r.beats, schon_da: true });
    this.json(a, 201, { name: r.name, beats: r.beats });
  } catch (e) {
    if (e instanceof LoopImportFehler) {
      if (e.code >= 500 || e.code === 422) this.opt.log?.({ typ: 'loop_import_fehler', fehler: e.fehler, text: e.text });
      return this.json(a, e.code, e.text ? { fehler: e.fehler, text: e.text } : { fehler: e.fehler });
    }
    this.katalogFehler(e, a);
  }
}
