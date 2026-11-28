// POST /klang of the page server: the sound request and its blocks (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { abBeat } from '../../deck_operation.ts';
import { abRaster } from '../../hand_operation.ts';
import { beatZuMono, wirtRuf, SPUR_NAME } from '../../track.ts';
import { type Spur } from '../../track.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { RB338_PARAM_NAMEN } from '../../devices_parameter.ts';
import { KLANG_ERR_MAX, KLANG_GRUPPEN, KLANG_AUS_MAX } from '../../server_kopf.ts';
import type { Eintrag } from '../../server_kopf.ts';
import { instanz, REPO_PFADE, baukastenOrdnerVorgabe } from '../../paths.ts';
import type { Oberflaeche } from '../../server.ts';

// Task 3: Surge-Klänge. Die Python-Logik von djk-klang bleibt (kein Nachbau); der Server spawnt sie ohne Shell.
// fahre geht NICHT dorthin, sondern als Wirt-Befehl (Spur klang-<gruppe>), damit /abbruch und Stop Cypher es halten können.
export async function klang(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const aktion = d.aktion;
  const lesend = aktion === 'zeige' || aktion === 'liste';
  if (typeof aktion !== 'string' || !['lade', 'setze', 'fahre', 'zeige', 'speichere', 'hoere', 'liste', 'param', 'params', 'ist', 'fenster'].includes(aktion)) return this.json(a, 400, { fehler: 'aktion' });
  const gruppe = d.gruppe;
  if (aktion !== 'liste' && (typeof gruppe !== 'string' || !KLANG_GRUPPEN.includes(gruppe))) return this.json(a, 400, { fehler: 'gruppe', text: 'gruppe must be bass or melodie' });
  // Werte mit - vorne läsen djk-klang als Schalter (argparse): abweisen, bevor sie in argv landen
  const text = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 && x.length <= 200 && !x.startsWith('-') && !x.includes('\0') ? x : null);
  const zahl = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const bad = (was: string) => this.json(a, 400, { fehler: 'argument', text: `${was}: required, at most 200 characters, must not start with "-"` });
  const argv: string[] = [];
  if (aktion === 'lade' || aktion === 'speichere') {
    const n = text(d.name);
    if (n === null) return bad('name');
    if (aktion === 'speichere' && !SPUR_NAME.test(n)) return this.json(a, 400, { fehler: 'name', text: 'name must match [a-z0-9_-]{1,32}' });
    argv.push(n);
  } else if (aktion === 'setze') {
    const w = d.werte;
    if (typeof w !== 'object' || w === null || Array.isArray(w) || Object.keys(w).length === 0) return this.json(a, 400, { fehler: 'werte', text: 'werte: {NAME: number, ...}' });
    for (const [k, v] of Object.entries(w)) {
      if (text(k) === null || k.includes('=')) return bad(`werte.${k}`);
      if (zahl(v) === null) return this.json(a, 400, { fehler: 'werte', text: `werte.${k} must be a number` });
      argv.push(`${k}=${v}`);
    }
    if (d.ab !== undefined || d.ab_beat !== undefined) {   // timed set: no djk-klang spawn; the host reloads its state at the beat (host `setze`, spur klang-<gruppe>)
      const u = this.kern.uhr as unknown as { beat: number; bpm: number; mono_ns: number } | null;
      if (!u) return this.json(a, 409, { fehler: 'keine_uhr' });
      let abBeat: number;
      if (d.ab_beat !== undefined) {
        if (typeof d.ab_beat !== 'number' || !Number.isFinite(d.ab_beat)) return this.json(a, 400, { fehler: 'ab_beat', text: 'ab_beat: a core beat (number)' });
        abBeat = d.ab_beat;
      } else {
        if (typeof d.ab !== 'string' || abRaster(d.ab, this.proTakt()) === undefined) return this.json(a, 400, { fehler: 'ab', text: 'ab: jetzt, schlag, takt or phrase' });
        abBeat = this.abVon(d.ab);
      }
      if (this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
      const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'setze', werte: w, ab: beatZuMono(u, abBeat), spur: `klang-${gruppe}` });
      if (!r.ok) return this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
      return this.json(a, 200, { ok: true, ab_beat: abBeat, ab_takt: Math.floor(abBeat / this.proTakt()) + 1 });
    }
  } else if (aktion === 'zeige' || aktion === 'liste') {
    if (d.filter !== undefined) { const f = text(d.filter); if (f === null) return bad('filter'); argv.push(f); }
  } else if (aktion === 'hoere') {
    if (d.note !== undefined) {
      const n = zahl(d.note);
      if (n === null || !Number.isInteger(n) || n < 0 || n > 127) return this.json(a, 400, { fehler: 'note', text: 'note: integer 0..127' });
      argv.push(String(n));
      if (d.dauer !== undefined) { const s = zahl(d.dauer); if (s === null || s <= 0 || s > 10) return this.json(a, 400, { fehler: 'dauer', text: 'dauer: seconds, 0..10' }); argv.push(String(s)); }
    } else if (d.dauer !== undefined) return this.json(a, 400, { fehler: 'dauer', text: 'dauer needs note' });
  } else if (aktion === 'param') {   // Baukasten S2: ein Regler eines VST3-Wirts (ParamSteuerung), normiert 0..1, direkt an den Socket wie fahre
    const n = text(d.name), w = zahl(d.wert);
    // die 32 Knobs von Cypher Modular, nicht Volume oder andere Plugin-Parameter (Review F3); die sieben RB-338-Namen nur, wenn der Wirt dieser Gruppe der RB-338 ist
    const rbWirt = n !== null && RB338_PARAM_NAMEN.has(n) && (this.leseWirtMeldungen()[gruppe as string] as { art?: unknown } | null)?.art === 'vst3:rb338';
    if (n === null || !(rbWirt || /^Knob ([1-9]|[1-5][0-9]|6[0-4])$/.test(n))) return this.json(a, 400, { fehler: 'name', text: 'name: Knob 1..64 (or an RB-338 parameter on an RB-338 host)' });
    if (w === null || w < 0 || w > 1) return this.json(a, 400, { fehler: 'wert', text: 'wert: number 0..1 (normalized)' });
    if (this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
    const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'param', name: n, wert: w });
    return r.ok ? this.json(a, 200, { ok: true }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
  } else if (aktion === 'fenster') {   // plan 2026-11-11 task 9: show or hide the plug-in's own editor on the host's display (Andreas' button; not Cypher's)
    if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_andreas', text: 'the Surge window is Andreas\'s' });
    if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an', text: 'an: true or false' });
    const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'fenster', an: d.an });
    return r.ok ? this.json(a, 200, { ok: true, fenster: r.fenster === true, ...(typeof r.grund === 'string' ? { grund: r.grund } : {}) }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
  } else if (aktion === 'ist') {   // front panels: the display values a Surge host plays now (read-only like params: no klangSperre); {parameter: [name, ...]} 1..64 fahrbar names
    const namen = d.parameter;
    if (!Array.isArray(namen) || namen.length < 1 || namen.length > 64 || !namen.every((n) => typeof n === 'string')) return this.json(a, 400, { fehler: 'parameter', text: 'parameter: a list of 1..64 Surge parameter names' });
    const unbekannt = (namen as string[]).find((n) => !this.fahrbar.has(n));
    if (unbekannt !== undefined) return this.json(a, 400, { fehler: 'nicht_fahrbar', parameter: unbekannt, text: `${unbekannt} is not a continuous Surge parameter` });
    const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'ist', namen });
    return r.ok ? this.json(a, 200, { ok: true, werte: r.werte ?? {} }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
  } else if (aktion === 'params') {   // Baukasten S2: alle Regler mit Ist-Wert, dazu die Knob-Namen aus dem Graphen (lesend, ohne Riegel)
    const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'params' });
    if (!r.ok) return this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
    return this.json(a, 200, { ok: true, params: r.params ?? {}, namen: this.reglerNamen(gruppe as string) });
  } else {   // fahre
    const p = text(d.parameter), ziel = zahl(d.ziel), sek = zahl(d.sekunden), von = d.von === undefined ? undefined : zahl(d.von);
    if (p === null) return bad('parameter');
    if (ziel === null || sek === null || von === null) return this.json(a, 400, { fehler: 'werte', text: 'ziel, sekunden (and von) must be numbers' });
    if (sek < 0 || sek > 600) return this.json(a, 400, { fehler: 'sekunden', text: 'sekunden: 0..600' });
    if (!this.fahrbar.has(p)) return this.json(a, 400, { fehler: 'nicht_fahrbar', parameter: p, text: `${p} is not a continuous parameter; use setze (reloads, audible click)` });
    if (this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
    const befehl = { befehl: 'fahre', name: p, bis: ziel, dauer: sek, spur: `klang-${gruppe}`, form: 'linear', ...(von !== undefined ? { von } : {}) };
    const r = await wirtRuf(this.wirtSock(gruppe as string), befehl);
    return r.ok ? this.json(a, 200, { ok: true, ...(r.ersetzt ? { ersetzt: r.ersetzt } : {}) }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
  }
  if (!lesend && this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
  const inst = instanz();
  const cmd = this.opt.klangBefehl ?? REPO_PFADE.djkKlang;
  const voll = [...(inst ? ['--instanz', inst] : []), ...(aktion === 'liste' ? [] : [gruppe as string]), aktion, ...argv];
  const r = await new Promise<{ code: number | null; out: string; err: string; gekappt: boolean; fehler?: string }>((fertig) => {
    let out = '', err = '', gekappt = false, unten = false;
    const k = spawn(cmd, voll, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    k.stdout.on('data', (b: Buffer) => { if (out.length + b.length > KLANG_AUS_MAX) { gekappt = true; out += b.toString().slice(0, KLANG_AUS_MAX - out.length); } else out += b; });
    k.stderr.on('data', (b: Buffer) => { if (err.length < KLANG_ERR_MAX) err += b.toString().slice(0, KLANG_ERR_MAX - err.length); });
    k.on('error', (e) => { if (!unten) { unten = true; fertig({ code: null, out, err, gekappt, fehler: e.message }); } });
    k.on('close', (c) => { if (!unten) { unten = true; fertig({ code: c, out, err, gekappt }); } });
  });
  if (r.fehler !== undefined) return this.json(a, 500, { fehler: 'klang_start', text: r.fehler });
  if (r.code === 0) return this.json(a, 200, { ok: true, text: r.out, ...(r.gekappt ? { abgeschnitten: true } : {}) });
  const zeilen = r.err.split('\n').map((z) => z.trim()).filter((z) => z !== '');
  return this.json(a, 400, { fehler: zeilen.at(-1) ?? (r.code === null ? 'timeout' : `exit ${r.code}`), text: r.err });
}
// Baukasten S2: regler_namen aus baukasten-<gruppe>.json → {"Knob 1": "Cutoff", …}; ohne Datei, bei kaputtem JSON oder
// fremden Schlüsseln bleibt der Eintrag weg (der Wirt spielt dann ohnehin den eingebauten Graphen ohne Namen)
export function reglerNamen(this: Oberflaeche, gruppe: string): Record<string, string> {
  const namen: Record<string, string> = {};
  try {
    const g = JSON.parse(fs.readFileSync(path.join(this.opt.baukastenOrdner ?? baukastenOrdnerVorgabe(), `baukasten-${gruppe}.json`), 'utf8'));
    for (const [nr, name] of Object.entries(g?.regler_namen ?? {})) {
      if (/^([1-9]|[1-5][0-9]|6[0-4])$/.test(nr) && typeof name === 'string' && name.length > 0 && name.length <= 40) namen[`Knob ${nr}`] = name;
    }
  } catch { /* keine Datei oder kein JSON: keine Namen */ }
  return namen;
}
// Cyphers Riegel für schreibende Klang-Aktionen: Stop Cypher, AUTO des Stroms (bass 2, melodie 3)
export function klangSperre(this: Oberflaeche, gruppe: string): Record<string, unknown> | null {
  if (this.kiGestoppt) return { fehler: 'ki_gestoppt' };
  const strom = gruppe === 'bass' ? 2 : 3;
  if (!leseMusterStand(this.musterOrdner(strom)).autonom) return { fehler: 'auto_aus', strom, text: 'AUTO is off for this instance: Andreas holds it' };
  return null;
}
