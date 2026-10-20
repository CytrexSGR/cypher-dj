// D1 S3: Aufruf von cypherdj-render (Paket K3, Spec 2.5, 6.20, 6.25) für POST /proj/export. Der Render läuft als eigener Prozess mit nice 19
// (zusätzlich zum setpriority im Programm), die Instanz geht über CYPHERDJ_INSTANZ mit, der Arbeitsordner ausdrücklich über --arr-ordner.
// Die Spur-Regler des Projekts gehen IMMER als Datei mit (--spur-regler, Spec 6.20); der Render nimmt sie nur, wenn er keinen Neustart-Zustand
// des Kerns findet, und meldet das als regler_quelle "projekt" (sonst "kern"). Kein Pfad im OSC (Spec 2.9): dies ist ein Prozessaufruf.
// Rückgaben wie render_main.cpp (K3 05a91adb, am Baum gelesen): 0 geschrieben, 2 Aufruf, 3 Konfiguration oder Zustand, 4 Wiedergabe oder Render,
// 5 Wirt-Spur nicht eingefroren, 6 Schreiben, 7 Speicher, 8 Ziel besteht (der Render ersetzt nie; S3 vergibt eigene Namen).
import { spawn } from 'node:child_process';
import type { Projekt } from './modell.ts';

export interface RenderAufruf {
  programm: string[];        // [Pfad zu cypherdj-render] oder im Test [node, render_attrappe.mjs]
  nr: number; von_beat: number; bis_beat: number; bpm: number;
  aus: string; arbeitsordner: string; spurRegler: string; instanz: string; zeitlimitMs: number;
  abbruch?: AbortSignal;     // Fix-Runde 2 S3, F4: der Server endet; tötet die Gruppe wie das Zeitlimit
}
export interface RenderAntwort { datei: string; frames: number; spitze_db: number; regler_quelle: 'kern' | 'projekt' }

const RC_TEXT: Record<number, [string, string]> = {
  2: ['Aufruf', 'the render refused its arguments'],
  3: ['Konfiguration oder Neustart-Zustand', 'the render could not read the configuration or the core state'],
  4: ['Wiedergabe oder Render', 'the render could not load or play the arrangement'],
  5: ['Wirt-Spur nicht eingefroren', 'a Surge track is not frozen'],
  6: ['Schreiben', 'the render could not write the WAV file'],
  7: ['Speicher', 'the render ran out of memory'],
  8: ['Ziel besteht', 'the export file already exists'],
  126: ['Programm nicht ausführbar', 'the render program cannot be run'],
  127: ['Programm fehlt', 'the render program is missing'],
};

// grund wie die übrigen Fehler der Ausgabe; text englisch (Spec 6.34), message (deutsch, mit stderr) geht als detail mit
export class RenderFehler extends Error {
  readonly grund = 'render_fehler';
  readonly rc: number | null;
  readonly text: string;
  constructor(meldung: string, rc: number | null = null, text = '') {
    super(`render_fehler: ${meldung}`);
    this.rc = rc;
    this.text = `the export render failed${text ? `: ${text}` : rc !== null && RC_TEXT[rc] ? `: ${RC_TEXT[rc][1]}` : ''}`;
  }
}

// Spur-Regler des Projekts im Format des Neustart-Fachs (Pfad → Wert, Einheiten wie der Kern: fader dB −200..+6, pan −1..1,
// mute/solo 0/1), dieselben Pfade wie befehle.ts reglerAenderungen.
export function reglerAusProjekt(p: Projekt): Record<string, number> {
  const r: Record<string, number> = {};
  for (const s of [...p.spuren].sort((a, b) => a.nr - b.nr)) {
    r[`spur/${s.nr}/fader`] = s.fader_db;
    r[`spur/${s.nr}/pan`] = s.pan;
    r[`spur/${s.nr}/mute`] = s.mute ? 1 : 0;
    r[`spur/${s.nr}/solo`] = s.solo ? 1 : 0;
  }
  return r;
}

export function renderArgumente(a: RenderAufruf): string[] {
  return ['--nr', String(a.nr), '--von-beat', String(a.von_beat), '--bis-beat', String(a.bis_beat), '--bpm', String(a.bpm),
    '--aus', a.aus, '--arr-ordner', a.arbeitsordner, '--spur-regler', a.spurRegler];
}

const AUS_MAX = 65536, ERR_MAX = 8192;

// Liest die letzte nicht leere stdout-Zeile als JSON und prüft die Felder, die S3 weiterreicht.
export function leseRenderAntwort(stdout: string): RenderAntwort {
  const zeile = stdout.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
  let j: Record<string, unknown>;
  try { j = JSON.parse(zeile) as Record<string, unknown>; } catch {
    throw new RenderFehler(`Ausgabe ist kein JSON: ${zeile.slice(0, 200)}`, 0, 'the render gave no readable answer');
  }
  if (typeof j.datei !== 'string' || !Number.isInteger(j.frames) || (j.frames as number) < 1 || typeof j.spitze_db !== 'number') {
    throw new RenderFehler(`Ausgabe ohne datei/frames/spitze_db: ${zeile.slice(0, 200)}`, 0, 'the render gave no readable answer');
  }
  if (j.regler_quelle !== 'kern' && j.regler_quelle !== 'projekt') {
    throw new RenderFehler(`Ausgabe ohne regler_quelle (K3-Nachtrag Spec 6.20 fehlt?): ${zeile.slice(0, 200)}`, 0,
      'the render did not say whose mixer it used');
  }
  return { datei: j.datei, frames: j.frames as number, spitze_db: j.spitze_db, regler_quelle: j.regler_quelle };
}

// Fix-Runde S3 R3: der Render läuft als eigene Prozessgruppe (detached). Das Zeitlimit tötet die ganze Gruppe (kill(-pid)), auch einen Enkel, der
// stdout offen hält, und entscheidet sofort, nicht erst bei close (das ohne Gruppen-Kill nie käme, solange der Enkel lebt). Entschieden wird einmal.
// Fix-Runde 2 S3, F4: als eigene Gruppe bekommt der Render Strg-C an den Server nicht mit; abbruch (Ausgabe.schliesse) tötet ihn wie das Zeitlimit.
const ABGEBROCHEN = (): RenderFehler => new RenderFehler('abgebrochen: der Server endet', null, 'the server is shutting down, the render was stopped');
export function rendere(a: RenderAufruf): Promise<RenderAntwort> {
  return new Promise((ok, fehl) => {
    if (a.abbruch?.aborted) { fehl(ABGEBROCHEN()); return; }
    const k = spawn('nice', ['-n', '19', ...a.programm, ...renderArgumente(a)], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CYPHERDJ_INSTANZ: a.instanz }, detached: true,
    });
    let aus = '', err = '', fertig = false;
    const ende = (f: () => void): void => {
      if (fertig) return;
      fertig = true; clearTimeout(uhr); a.abbruch?.removeEventListener('abort', abbrechen); f();
    };
    const toeteGruppe = (): void => {
      try { if (k.pid !== undefined) process.kill(-k.pid, 'SIGKILL'); } catch { /* Gruppe schon weg */ }
      try { k.kill('SIGKILL'); } catch { /* schon weg */ }
    };
    k.stdout.on('data', (b: Buffer) => { if (aus.length < AUS_MAX) aus += b.toString('utf8'); });
    k.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-ERR_MAX); });
    const uhr = setTimeout(() => ende(() => {
      toeteGruppe();
      k.stdout.destroy(); k.stderr.destroy();                              // nicht auf Daten eines Enkels warten
      fehl(new RenderFehler(`Zeitlimit ${a.zeitlimitMs} ms überschritten`, null, `no result within ${a.zeitlimitMs} ms`));
    }), a.zeitlimitMs);
    const abbrechen = (): void => ende(() => { toeteGruppe(); k.stdout.destroy(); k.stderr.destroy(); fehl(ABGEBROCHEN()); });
    a.abbruch?.addEventListener('abort', abbrechen, { once: true });
    k.once('error', (e) => ende(() => fehl(new RenderFehler(`Start: ${e.message}`, null, 'the render program could not be started'))));
    k.once('close', (rc) => ende(() => {
      const letzte = err.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
      if (rc !== 0) return fehl(new RenderFehler(`Rückgabe ${rc} (${RC_TEXT[rc ?? -1]?.[0] ?? 'unbekannt'}): ${letzte}`, rc));
      try { ok(leseRenderAntwort(aus)); } catch (e) { fehl(e); }
    }));
  });
}
