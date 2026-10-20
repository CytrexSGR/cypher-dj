// PRODUCTION V2: Erweiterung der Projekt-Attrappe (pruef/proj_attrappe.mjs): Clip- und Notenbefehle über den echten S2-Kern
// (projekt/befehle.ts), Freeze und Export als Simulation (Spec 2.5, 3.4; Gründe nach der V2-Festlegung). Ports frei (0), kein Kern.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';

async function oben() {
  const stroeme = new Set();
  const srv = http.createServer((q, a) => {
    if (q.url === '/strom') { a.writeHead(200, { 'content-type': 'text/event-stream' }); a.write(`data: ${JSON.stringify({ a: '/uhr', f: { beat: 0, bpm: 120 } })}\n\n`); stroeme.add(a); q.on('close', () => stroeme.delete(a)); return; }
    a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { for (const a of stroeme) a.end(); srv.closeAllConnections(); srv.close(r); }) };
}
function lies(url) {
  const n = [], ac = new AbortController();
  fetch(url + 'strom', { signal: ac.signal }).then(async (r) => {
    const dec = new TextDecoder(); let rest = '';
    for await (const t of r.body) { rest += dec.decode(t); let i; while ((i = rest.indexOf('\n\n')) >= 0) { const m = rest.slice(0, i); rest = rest.slice(i + 2); if (m.startsWith('data: ')) n.push(JSON.parse(m.slice(6))); } }
  }).catch(() => {});
  return { n, zu: () => ac.abort() };
}
const post = async (url, weg, d) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };
const grund = async (at, weg, d) => { const r = await post(at.url, weg, d); return [r.status, r.j.fehler]; };
async function mitProjekt(at) {
  await post(at.url, '/proj/neu', { name: 'V2' });
  const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'Spuren', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }] });
  const [rb, surge] = a.j.projekt.spuren.map((s) => s.id);
  const b = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'Clips', befehle: [{ befehl: 'clip_neu', spur_id: rb, art: 'midi', start_beat: 0, laenge_beats: 4 }, { befehl: 'clip_neu', spur_id: surge, art: 'midi', start_beat: 0, laenge_beats: 6, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }] });
  return { rb, surge, p: b.j.projekt, rev: b.j.rev };
}

test('V2 Attrappe: Clip- und Notenbefehle rechnet S2 (IDs, Gründe, Teilen), ganze Änderung oder nichts', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url });
  try {
    const { p, rev } = await mitProjekt(at);
    const c = p.spuren[0].clips[0];
    assert.equal(c.art, 'midi'); assert.equal(c.name, 'MIDI', 'Name wie S2');
    const n = await post(at.url, '/proj/aendern', { rev, label: 'Add note', befehle: [{ befehl: 'noten_neu', clip_id: c.id, noten: [{ id: 'n2', beat: 0, laenge: 0.5, ton: 36, vel: 100 }, { id: 'n3', beat: 2, laenge: 1, ton: 38, vel: 90 }] }] });   // Spec 6.28/6.30: ein Noten-Zähler je Projekt, die Surge-Note hat n1
    assert.equal(n.status, 200);
    const t = await post(at.url, '/proj/aendern', { rev: n.j.rev, label: 'Split', befehle: [{ befehl: 'clip_teilen', clip_id: c.id, beat: 2.5 }] });
    const zweiter = t.j.projekt.spuren[0].clips[1];
    assert.deepEqual([zweiter.start_beat, zweiter.laenge_beats, zweiter.noten.map((x) => [x.beat, x.laenge])], [2.5, 1.5, [[0, 0.5]]], 'n3 angeschnitten: Rest im zweiten Clip');
    assert.deepEqual((await post(at.url, '/proj/aendern', { rev: t.j.rev, label: 'x', befehle: [{ befehl: 'noten_neu', clip_id: c.id, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 1, vel: 1 }] }] })).j.fehler, 'id_belegt');
    const ganz = await post(at.url, '/proj/aendern', { rev: t.j.rev, label: 'x', befehle: [{ befehl: 'clip_aendern', clip_id: c.id, start_beat: 8 }, { befehl: 'clip_teilen', clip_id: c.id, beat: 99 }] });
    assert.deepEqual([ganz.status, ganz.j.fehler], [409, 'beat_ausserhalb'], 'HTTP-Code wie der Server (bereiche/proj/abbildung.ts grundCode)');
    const jetzt = await (await fetch(at.url + 'proj/aktuell')).json();
    assert.equal(jetzt.projekt.spuren[0].clips[0].start_beat, 0, 'der erste Befehl des abgelehnten Pakets ist nicht gebucht');
    const d = await post(at.url, '/proj/aendern', { rev: t.j.rev, label: 'Dup', befehle: [{ befehl: 'clip_duplizieren', clip_id: zweiter.id }] });
    const ids = d.j.projekt.spuren.flatMap((s) => s.clips.map((x) => x.id));
    assert.equal(new Set(ids).size, ids.length, 'keine doppelte Clip-ID zwischen Attrappe (clip_neu) und S2 (Duplikat)');
    // Spec 6.17 Clip-Loop über S2: Schalter an, rechte Kante zieht, teilen lehnt ab; Audio-clip_neu (Attrappe selbst) reicht loop_beats durch
    const l = await post(at.url, '/proj/aendern', { rev: d.j.rev, label: 'Loop on', befehle: [{ befehl: 'clip_aendern', clip_id: c.id, loop_beats: 2.5 }] });
    assert.equal(l.status, 200);
    const z = await post(at.url, '/proj/aendern', { rev: l.j.rev, label: 'Trim clip', befehle: [{ befehl: 'clip_aendern', clip_id: c.id, laenge_beats: 10 }] });
    assert.deepEqual([z.j.projekt.spuren[0].clips[0].laenge_beats, z.j.projekt.spuren[0].clips[0].loop_beats], [10, 2.5]);
    const t2 = await post(at.url, '/proj/aendern', { rev: z.j.rev, label: 'Split clip', befehle: [{ befehl: 'clip_teilen', clip_id: c.id, beat: 4 }] });
    assert.deepEqual([t2.status, t2.j.fehler], [400, 'argument_ungueltig'], 'Loop-Clip: erst den Loop ausschalten');
    const sp = await post(at.url, '/proj/aendern', { rev: z.j.rev, label: 'Audio', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    const aid = sp.j.projekt.spuren.at(-1).id;
    const k = await post(at.url, '/proj/aendern', { rev: sp.j.rev, label: 'Add clip', befehle: [{ befehl: 'clip_neu', spur_id: aid, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64), loop_beats: 1 }] });
    assert.deepEqual([k.status, k.j.projekt.spuren.at(-1).clips[0].loop_beats], [200, 1]);
    const k2 = await post(at.url, '/proj/aendern', { rev: k.j.rev, label: 'x', befehle: [{ befehl: 'clip_neu', spur_id: aid, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64), loop_beats: 2 }] });
    assert.deepEqual([k2.status, k2.j.fehler], [400, 'argument_ungueltig'], 'Negativ-Kontrolle: loop_beats über der Länge wie S2');
  } finally { await at.stoppe(); await o.stoppe(); }
});

// D1 V2 Slice 3: Freeze und Export nach dem S3-Plan (d1-export-api, Plan 2026-10-15-d1-s3-export-api.md): Gründe und HTTP-Codes wie
// bereiche/proj/ausgabe.ts STATUS (400 Argument/Inhalt, 409 Zustand, 502 freeze_fehler/render_fehler), Freeze-Bereich wie projekt/freeze.ts
// freezeBereich (frühester bis spätester MIDI-Clip mit klingenden Noten, /e/freeze mit 2 Beats Nachlauf), Export-Antwort mit regler_quelle
// und Lautheit (Spec 6.20, R9), Dateiname <slug>-<JJJJMMTT-hhmmss>.wav. Freeze-Sperre (Spec 6.23, 6.32) nur während des Durchlaufs.
test('V2 Attrappe: Freeze meldet status 3 mit laufendem Beat und /e/freeze, bucht einen Verlaufseintrag, sperrt Laden, Transport und Undo; Unfreeze', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 400 });
  const s = lies(at.url);
  try {
    const { surge, rb, rev } = await mitProjekt(at);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: rb, an: true }), [400, 'keine_wirtspur']);
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: surge, an: true, x: 1 }), [400, 'argument_ungueltig']);
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: 's9', an: true }), [400, 'spur_unbekannt']);
    const fz0 = await post(at.url, '/proj/freeze', { spur_id: surge, an: false });
    assert.deepEqual([fz0.status, fz0.j.rev], [200, rev], 'an false auf eine nicht eingefrorene Spur: 200, unverändert (S3)');
    const laeuft = post(at.url, '/proj/freeze', { spur_id: surge, an: true });
    await new Promise((r) => setTimeout(r, 150));
    // während des Durchlaufs (Spec 6.23, 6.32): Wiedergabe-Änderung, Undo, Transport-Start, zweiter Freeze 409 beschaeftigt; Mixer geht
    assert.deepEqual(await grund(at, '/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'tempo_setzen', bpm: 130 }] }), [409, 'beschaeftigt']);
    assert.deepEqual(await grund(at, '/proj/undo', { rev }), [409, 'beschaeftigt'], 'Undo der Clip-Änderung ändert die Wiedergabe');
    assert.deepEqual(await grund(at, '/proj/transport', { aktion: 'start', beat: 0 }), [409, 'beschaeftigt']);
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: surge, an: true }), [409, 'beschaeftigt']);
    const mix = await post(at.url, '/proj/aendern', { rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: rb, fader_db: -3 }] });
    assert.equal(mix.status, 200, 'Negativ-Kontrolle: Mixer bleibt erlaubt');
    const f = await laeuft;
    assert.equal(f.status, 200);
    await new Promise((r) => setTimeout(r, 100));   // SSE-Leser nachkommen lassen
    const fz = f.j.projekt.spuren[1].freeze;
    assert.deepEqual([fz.datei, fz.kennung, fz.frames, fz.von_beat], ['freeze-2-1.f32', 1, 192000, 0], 'Arbeitsordner-Name (Spec 6.14), 6 Beats plus 2 Nachlauf bei 120 BPM');
    const arr = s.n.filter((x) => x.a === '/zustand/arr' && x.f.status === 3).map((x) => x.f.projekt_beat);
    assert.ok(arr.length >= 3 && arr.at(-1) > arr[0], `status 3 mit steigendem Beat: ${arr.map((x) => x.toFixed(2)).join(' ')}`);
    assert.ok(s.n.some((x) => x.a === '/e/freeze' && x.f.spur === 2 && x.f.status === 0 && x.f.kennung === 1 && x.f.frames === 192000));
    const verlauf = await (await fetch(at.url + 'proj/verlauf')).json();
    assert.equal(verlauf.at(-1).label, 'Freeze Surge');
    // V2 Fix F13: ein anderes Tempo verwürfe den Freeze (wie S2); die Wiedergabe-Änderung nach dem Freeze ist darum die Loop-Klammer
    const nach = await post(at.url, '/proj/aendern', { rev: f.j.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] });
    assert.equal(nach.status, 200, 'nach dem Freeze geht die Änderung durch');
    const u = await post(at.url, '/proj/freeze', { spur_id: surge, an: false });
    assert.equal(u.j.projekt.spuren[1].freeze, null);
    assert.equal((await (await fetch(at.url + 'proj/verlauf')).json()).at(-1).label, 'Unfreeze Surge');
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

test('V2 Attrappe: Freeze-Gründe nach S3 (spur_leer, zu_gross, deck_laeuft, transport_laeuft, freeze_fehler 502, veraltet)', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 100 });
  try {
    await post(at.url, '/proj/neu', { name: 'G' });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } }] });
    const sid = a.j.projekt.spuren[0].id;
    const b = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 5, laenge: 1, ton: 60, vel: 100 }] }] });
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: sid, an: true }), [400, 'spur_leer'], 'eine Note hinter dem Clip-Ende klingt nicht');
    const c = await post(at.url, '/proj/aendern', { rev: b.j.rev, label: 'Note', befehle: [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 300, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }, { befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: 8, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }] });
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: sid, an: true }), [400, 'zu_gross'], '8 bis 304: über 256 Beats');
    const lo = c.j.projekt.spuren[0].clips.find((x) => x.start_beat === 300).id;
    await post(at.url, '/proj/aendern', { rev: c.j.rev, label: 'Del', befehle: [{ befehl: 'clip_loeschen', clip_id: lo }] });
    await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: sid, an: true }), [409, 'transport_laeuft']);
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
    for (const [fehler, code] of [['deck_laeuft', 409], ['kein_kernstand', 409], ['freeze_fehler', 502], ['veraltet', 409]]) {
      await post(at.url, '/attrappe/ausgabe', { fehler });
      assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: sid, an: true }), [code, fehler]);
    }
    await post(at.url, '/attrappe/ausgabe', { fehler: null });
    const f = await post(at.url, '/proj/freeze', { spur_id: sid, an: true });
    assert.equal(f.status, 200, 'Negativ-Kontrolle: ohne Störung friert es ein');
    assert.deepEqual([f.j.projekt.spuren[0].freeze.von_beat, f.j.projekt.spuren[0].freeze.frames], [8, 4 * 0.5 * 48000 + 2 * 0.5 * 48000], 'Bereich 8..12 plus 2 Beats Nachlauf');
    const nochmal = await post(at.url, '/proj/freeze', { spur_id: sid, an: true });
    assert.deepEqual([nochmal.status, nochmal.j.rev], [200, f.j.rev], 'an true auf eine eingefrorene Spur: 200, unverändert');
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V2 Attrappe: Export friert vorher ein, antwortet nach S3; Gründe transport_laeuft, beschaeftigt, audio_fehlt, render_fehler 502, export_bereich', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 200, renderMs: 200, dekodierMs: 60000 });
  try {
    await mitProjekt(at);
    const laeuft = post(at.url, '/proj/export', {});
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await grund(at, '/proj/export', {}), [409, 'beschaeftigt'], 'ein Lauf zur Zeit');
    await new Promise((r) => setTimeout(r, 250));   // jetzt im Render: kein Durchlauf, keine Lade-Sperre (Spec 6.23 gilt dem Freeze)
    const imRender = await (await fetch(at.url + 'proj/aktuell')).json();
    const r = await post(at.url, '/proj/aendern', { rev: imRender.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 120 }] });
    assert.equal(r.status, 200, 'während des Renders sperrt die Attrappe das Laden nicht');
    assert.deepEqual(await grund(at, '/proj/freeze', { spur_id: imRender.projekt.spuren[1].id, an: false }), [409, 'beschaeftigt'], 'aber ein zweiter Lauf bleibt gesperrt');
    const e = await laeuft;
    assert.equal(e.status, 200);
    assert.match(e.j.datei, /\/export\/v2-\d{8}-\d{6}\.wav$/);
    assert.equal(e.j.frames, 32 * 0.5 * 48000, 'Loop-Klammer 0..32 bei 120 BPM');
    assert.equal(typeof e.j.spitze_db, 'number');
    assert.deepEqual([e.j.regler_quelle, typeof e.j.lufs_i, typeof e.j.lra, typeof e.j.true_peak_dbtp], ['kern', 'number', 'number', 'number'], 'Antwort wie S3 (6.20, R9)');
    const p = (await (await fetch(at.url + 'proj/aktuell')).json()).projekt;
    assert.ok(p.spuren[1].freeze, 'die Surge-Spur ist danach eingefroren');
    const e2 = await post(at.url, '/proj/export', {});
    assert.match(e2.j.datei, /\/export\/v2-\d{8}-\d{6}(-2)?\.wav$/);
    assert.notEqual(e2.j.datei, e.j.datei, 'ein zweiter Export überschreibt den ersten nie (gleiche Sekunde: -2)');
    await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    assert.deepEqual(await grund(at, '/proj/export', {}), [409, 'transport_laeuft']);
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
    await post(at.url, '/attrappe/ausgabe', { fehler: 'render_fehler' });
    assert.deepEqual(await grund(at, '/proj/export', {}), [502, 'render_fehler']);
    await post(at.url, '/attrappe/ausgabe', { fehler: null });
    assert.deepEqual(await grund(at, '/proj/export', { von_beat: 4, bis_beat: 4.5 }), [400, 'export_bereich'], 'Negativ-Kontrolle: unter 1 Beat');
    assert.deepEqual(await grund(at, '/proj/export', { von_beat: 0, bis_beat: 1025 }), [400, 'export_bereich'], 'über 1024 Beats');
    assert.deepEqual(await grund(at, '/proj/export', { von: 0 }), [400, 'argument_ungueltig']);
    const jetzt = (await (await fetch(at.url + 'proj/aktuell')).json()).projekt;
    const sp = await post(at.url, '/proj/aendern', { rev: jetzt.rev, label: 'Audio', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    await post(at.url, '/proj/aendern', { rev: sp.j.rev, label: 'Add clip', befehle: [{ befehl: 'clip_neu', spur_id: sp.j.projekt.spuren.at(-1).id, art: 'audio', start_beat: 40, laenge_beats: 4, sha256: 'b'.repeat(64) }] });
    assert.equal((await post(at.url, '/proj/export', {})).status, 200, 'Negativ-Kontrolle: undekodierter Clip außerhalb der Klammer stört nicht');
    assert.deepEqual(await grund(at, '/proj/export', { von_beat: 32, bis_beat: 48 }), [409, 'audio_fehlt']);
  } finally { await at.stoppe(); await o.stoppe(); }
});

// V2 Fix-Runde F12: die Attrappe liefert Texte wie der Server (bereiche/proj/sitzung.ts: Sperre beim Öffnen, Freeze-Sperre der Wiedergabe) und
// nach Spec 6.33 für eine offene Tempo-Rampe (der Kern lehnt den Freeze mit tempo_rampe ab, /proj/freeze antwortet 409 beschaeftigt).
test('V2 Attrappe F12: beschaeftigt und zu_gross tragen den Text des Servers', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 300 });
  try {
    const { surge, rb, rev } = await mitProjekt(at);
    const roh = (weg, d) => post(at.url, weg, d).then((r) => [r.status, r.j.fehler, r.j.text]);
    for (const [fehler, text] of [['oeffnet', 'a project is being opened; a freeze waits until it is open'], ['tempo_rampe', 'the core is still ramping the tempo; a freeze waits until the ramp is done']]) {
      await post(at.url, '/attrappe/ausgabe', { fehler });
      assert.deepEqual(await roh('/proj/freeze', { spur_id: surge, an: true }), [409, 'beschaeftigt', text], fehler);
      assert.equal((await (await fetch(at.url + 'proj/aktuell')).json()).projekt.spuren[1].freeze, null, `${fehler}: Projekt unverändert`);
    }
    await post(at.url, '/attrappe/ausgabe', { fehler: null });
    const laeuft = post(at.url, '/proj/freeze', { spur_id: surge, an: true });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await roh('/proj/freeze', { spur_id: surge, an: true }), [409, 'beschaeftigt', 'a freeze is running']);
    assert.deepEqual(await roh('/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'tempo_setzen', bpm: 130 }] }), [409, 'beschaeftigt', 'a freeze is running; changes to the playback wait until it is done']);
    assert.deepEqual(await roh('/proj/transport', { aktion: 'start', beat: 0 }), [409, 'beschaeftigt', 'a freeze is running; transport start waits until it is done']);
    assert.deepEqual(await roh('/proj/neu', { name: 'Neu' }), [409, 'beschaeftigt', 'a freeze is running; opening or creating a project waits until it is done']);
    assert.equal((await post(at.url, '/proj/aendern', { rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: rb, fader_db: -3 }] })).status, 200, 'Negativ-Kontrolle: Mixer geht');
    assert.equal((await laeuft).status, 200, 'Negativ-Kontrolle: der Freeze selbst geht durch');
  } finally { await at.stoppe(); await o.stoppe(); }
});

// V2 Fix-Runde F13: tempo_setzen verwirft Freezes wie S2 (projekt/befehle.ts verwerfeFreezes: anderes Tempo ändert die Länge der Freeze-Datei
// in Beats); die Attrappe nimmt dafür denselben S2-Weg wie die Clip- und Notenbefehle.
test('V2 Attrappe F13: Tempo verwirft den Freeze wie S2, gleiches Tempo und Mixer nicht', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 100 });
  try {
    const { surge, rb } = await mitProjekt(at);
    const f = await post(at.url, '/proj/freeze', { spur_id: surge, an: true });
    assert.ok(f.j.projekt.spuren[1].freeze, 'eingefroren');
    const gleich = await post(at.url, '/proj/aendern', { rev: f.j.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 120 }] });
    assert.ok(gleich.j.projekt.spuren[1].freeze, 'Negativ-Kontrolle: gleiches Tempo lässt den Freeze');
    const mix = await post(at.url, '/proj/aendern', { rev: gleich.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: rb, fader_db: -3 }] });
    assert.ok(mix.j.projekt.spuren[1].freeze, 'Negativ-Kontrolle: Mixer lässt den Freeze');
    const t = await post(at.url, '/proj/aendern', { rev: mix.j.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 130 }] });
    assert.deepEqual([t.status, t.j.projekt.tempo_bpm, t.j.projekt.spuren[1].freeze], [200, 130, null], 'anderes Tempo: Freeze verworfen wie S2');
    const u = await post(at.url, '/proj/undo', { rev: t.j.rev });
    assert.ok(u.j.projekt.spuren[1].freeze, 'Undo stellt den Freeze wieder her');
    assert.deepEqual(await grund(at, '/proj/aendern', { rev: u.j.rev, label: 'x', befehle: [{ befehl: 'tempo_setzen', bpm: 300 }] }), [409, 'tempo_bereich'], 'Grund wie S2, HTTP-Code wie der Server (abbildung.ts grundCode)');
  } finally { await at.stoppe(); await o.stoppe(); }
});

// V2 Fix-Runde F14 (Spec 6.34): GET /proj/aktuell trägt ausgabe_lauf, {art: 'freeze', spur_id} beim Freeze, {art: 'export'} beim Export, sonst null,
// genau in dieser Form; damit sieht eine Seite nach einem Reload mitten im Lauf, dass er läuft.
test('V2 Attrappe F14: /proj/aktuell trägt ausgabe_lauf während Freeze und Export, sonst null', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url, freezeMs: 300, renderMs: 200 });
  const aktuell = async () => (await (await fetch(at.url + 'proj/aktuell')).json()).ausgabe_lauf;
  try {
    const { surge } = await mitProjekt(at);
    assert.equal(await aktuell(), null, 'Negativ-Kontrolle: kein Lauf');
    const f = post(at.url, '/proj/freeze', { spur_id: surge, an: true });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await aktuell(), { art: 'freeze', spur_id: surge });
    await f;
    assert.equal(await aktuell(), null, 'nach dem Freeze');
    await post(at.url, '/proj/freeze', { spur_id: surge, an: false });
    const e = post(at.url, '/proj/export', {});
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await aktuell(), { art: 'export' }, 'Export: ohne spur_id, auch während des Vor-Freeze');
    await e;
    assert.equal(await aktuell(), null, 'nach dem Export');
    assert.equal(Object.hasOwn(await (await fetch(at.url + 'proj/aktuell')).json(), 'ausgabe_lauf'), true, 'das Feld steht immer da');
  } finally { await at.stoppe(); await o.stoppe(); }
});
