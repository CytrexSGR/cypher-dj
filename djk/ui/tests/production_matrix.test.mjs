// 1.10 slice 6 T4: the matrix view (matrix.js). Pure parts (rows, cell commands, number parsing) run in node; the page parts drive the real page against
// the project stub (which answers GET /proj/routing with the real routingMatrix). Without google-chrome the page tests skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { routingMatrix } from '../project/routing_matrix.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { matrixZeilen, zellenBefehl, sendZahl, NICHT_DA_TEXT } from '../public/production/matrix.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

// Kick, Bass, Lead, Pad; group Music (s2, s3); returns Hall (r1) and Plate (r2); send Kick to Hall -6 dB; a compressor on s2 (stage i1)
function projekt(extra = []) {
  let p = neuesProjekt('Matrix page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Plate' },
    { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }, ...extra]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}

test('matrixZeilen: rows are tracks, groups, returns, master; columns Master + groups, one send per return, one key entry per stage', () => {
  const m = routingMatrix(projekt());
  const z = matrixZeilen(m);
  assert.deepEqual(z.map((r) => r.id), ['s1', 's2', 's3', 's4', 'g1', 'r1', 'r2', 'master']);
  assert.deepEqual(z.map((r) => r.art), ['spur', 'spur', 'spur', 'spur', 'gruppe', 'return', 'return', 'pm']);
  const kick = z[0], bass = z[1], musik = z[4];
  assert.deepEqual(kick.ziele.map((c) => c.ziel), ['master', 'g1']);
  assert.deepEqual(kick.ziele.map((c) => c.aktiv), [true, false]);
  assert.deepEqual(bass.ziele.map((c) => c.aktiv), [false, true], 'Bass feeds the group');
  assert.deepEqual(kick.sends.map((c) => [c.return_id, c.db]), [['r1', -6], ['r2', -200]], 'a missing send is off (-200)');
  assert.deepEqual(musik.ziele.map((c) => [c.ziel, c.erlaubt]), [['master', true], ['g1', false]], 'a group cannot feed itself');
  assert.equal(musik.ziele[1].text.length > 0, true);
  assert.deepEqual(z[5].ziele, []); assert.deepEqual(z[5].sends, []); assert.deepEqual(z[7].sends, []);
  assert.deepEqual(bass.stufen.map((s) => s.insert_id), ['i1']);
  assert.equal(bass.stufen[0].wert, 'own'); assert.match(bass.stufen[0].label, /own signal/i);
  assert.deepEqual(kick.stufen, [], 'no compressor, no key entry');
});
test('matrixZeilen: a stage with a key shows its source; the return rows carry pre', () => {
  const p = projekt([{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'spur', nr: 1, punkt: 'post' } }, { befehl: 'return_aendern', return_id: 'r2', pre: true }]);
  const z = matrixZeilen(routingMatrix(p));
  assert.equal(z[1].stufen[0].wert, 'spur:1:post'); assert.match(z[1].stufen[0].label, /Kick/);
  assert.deepEqual(z.filter((r) => r.art === 'return').map((r) => r.pre), [false, true]);
});
test('zellenBefehl: target, send, pre/post and key cells make the one command each', () => {
  const z = matrixZeilen(routingMatrix(projekt()));
  const kick = z[0];
  assert.deepEqual(zellenBefehl(kick.ziele[1]), { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g1' } });
  assert.deepEqual(z[1].ziele[0] && zellenBefehl(z[1].ziele[0]), { befehl: 'ziel_setzen', strang_id: 's2', ausgang: 'master' });
  assert.deepEqual(zellenBefehl(kick.sends[0], -200), { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -200 });
  assert.deepEqual(zellenBefehl(kick.sends[1], 0), { befehl: 'send_setzen', strang_id: 's1', return_id: 'r2', db: 0 });
  assert.deepEqual(zellenBefehl({ typ: 'pre', return_id: 'r1', pre: false }, true), { befehl: 'return_aendern', return_id: 'r1', pre: true });
  assert.deepEqual(zellenBefehl(z[1].stufen[0], 'grp:1:post'), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'grp', nr: 1, punkt: 'post' } });
});
test('zellenBefehl: a refused cell (group to itself, group to group) is null and says why; the active target is null too', () => {
  const z = matrixZeilen(routingMatrix(projekt()));
  const selbst = z[4].ziele[1];
  assert.equal(selbst.erlaubt, false);
  assert.equal(zellenBefehl(selbst), null, 'error case: no command for a refused cell');
  assert.match(selbst.text, /itself/);
  assert.equal(zellenBefehl(z[0].ziele[0]), null, 'the active target changes nothing');
});
test('every cell equals what the command does (the cell is the server answer, the page adds no rule)', () => {
  const p = projekt();
  for (const r of matrixZeilen(routingMatrix(p))) for (const c of r.ziele) {
    const b = zellenBefehl({ ...c, aktiv: false, erlaubt: true });
    let fehl = null;
    try { lauf(JSON.parse(JSON.stringify(p)), [b]); } catch (e) { fehl = e.grund ?? String(e); }
    assert.equal(fehl === null, c.erlaubt, `${r.id} -> ${c.ziel}: ${fehl}`);
  }
});
test('sendZahl: typed send levels', () => {
  assert.equal(sendZahl('-6'), -6); assert.equal(sendZahl(' -6.5 dB '), -6.5); assert.equal(sendZahl('+3'), 3); assert.equal(sendZahl('0'), 0);
  assert.equal(sendZahl('off'), -200); assert.equal(sendZahl('-inf'), -200); assert.equal(sendZahl('-80'), -200, 'below the fader floor is off');
  assert.equal(sendZahl('12'), 6, 'clamped to the fader maximum');
  assert.equal(sendZahl('abc'), null, 'error case: not a number'); assert.equal(sendZahl(''), null);
});
test('every visible string is English', () => {
  const t = fs.readFileSync(new URL('../public/production/matrix.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /\b(Spur|Gruppe|Schl[uü]ssel|Wahl|nicht|Fehler)\b/);
  assert.equal(NICHT_DA_TEXT, 'Routing unavailable');
});

// ---- the page --------------------------------------------------------------------------------------------------------------------------
const zeit = async (s) => (await (await fetch(`${s.url}attrappe/log`)).json());
const anfragen = async (s, ab = 0) => (await zeit(s)).slice(ab).filter((e) => e.methode === 'POST' && e.weg === '/proj/aendern');
const routingGets = async (s, ab = 0) => (await zeit(s)).slice(ab).filter((e) => e.methode === 'GET' && e.weg === '/proj/routing');
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne(); await s.saat(p);
  return s;
}
const sicht = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
async function klick(s, sel) { await sicht(s, sel); await warte(30); await s.b.klick(sel); }
async function doppelklick(s, sel) {
  await sicht(s, sel); await warte(30);
  const m = await s.b.mitte(sel);
  await s.b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  for (const n of [1, 2]) { await s.b.maus('mousePressed', m.x, m.y, { clickCount: n }); await s.b.maus('mouseReleased', m.x, m.y, { clickCount: n }); }
}
const oeffne = async (s) => { await sicht(s, '[data-p="matrix"] > summary'); await s.b.klick('[data-p="matrix"] > summary'); assert.ok(await s.bis(async () => (await s.w(`document.querySelectorAll('.p-mx-zeile').length`)) > 0), 'the matrix arrived'); };
const text = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const KLEIN = { skip: !CHROME && 'no google-chrome' };

test('page: the matrix lists every strip, the columns and the send levels', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  assert.equal(await s.w(`document.querySelector('[data-p="matrix"]').open`), false, 'closed by default');
  await oeffne(s);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-mx-zeile')].map((e) => e.dataset.strang)`), ['s1', 's2', 's3', 's4', 'g1', 'r1', 'r2', 'master']);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-mx-kopf-ziel')].map((e) => e.textContent)`), ['Master', 'Music']);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-mx-kopf-ret .p-mx-retname')].map((e) => e.textContent)`), ['R1 Hall', 'R2 Plate']);
  assert.equal(await text(s, '.p-mx-send[data-strang="s1"][data-ret="r1"]'), '-6.0');
  assert.equal(await text(s, '.p-mx-send[data-strang="s1"][data-ret="r2"]'), 'off');
  assert.equal(await s.w(`document.querySelector('.p-mx-ziel[data-strang="s1"][data-ziel="master"]').classList.contains('aktiv')`), true);
  assert.equal(await s.w(`document.querySelector('.p-mx-ziel[data-strang="s2"][data-ziel="g1"]').classList.contains('aktiv')`), true);
  assert.match(await text(s, '.p-mx-zeile[data-strang="s2"] .p-mx-key'), /own signal/i);
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-zeile[data-strang="s1"] .p-mx-key').length`), 0, 'no compressor, no key entry');
});
test('page: a target click sends ziel_setzen, one undo step takes it back', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  const n = (await zeit(s)).length;
  await klick(s, '.p-mx-ziel[data-strang="s1"][data-ziel="g1"]');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].ausgang?.id === 'g1'), 'target written');
  const a = await anfragen(s, n);
  assert.equal(a.length, 1); assert.deepEqual(a[0].koerper.befehle, [{ befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g1' } }]);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-mx-ziel[data-strang="s1"][data-ziel="g1"]').classList.contains('aktiv')`)) === true), 'the matrix follows');
  assert.ok(await s.bis(async () => !(await s.w(`document.querySelector('[data-p="undo"]').disabled`))), 'undo enabled');
  await klick(s, '[data-p="undo"]');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].ausgang === undefined), 'one undo step');
});
test('page: a refused cell is greyed, its click sends nothing and shows the reason', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  const sel = '.p-mx-ziel[data-strang="g1"][data-ziel="g1"]';
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(sel)}).classList.contains('gesperrt')`), true);
  assert.equal(await s.w(`document.querySelector('.p-mx-ziel[data-strang="s1"][data-ziel="g1"]').classList.contains('gesperrt')`), false, 'negative control: an allowed cell is not greyed');
  const n = (await zeit(s)).length;
  await klick(s, sel); await warte(500);
  assert.equal((await anfragen(s, n)).length, 0, 'no request');
  assert.match(await text(s, '[data-p="meldung"]'), /itself/);
  assert.match(await s.w(`document.querySelector(${JSON.stringify(sel)}).title`), /itself/);
});
test('page: a send click toggles 0 dB and off, a double click edits the number', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  const k = '.p-mx-send[data-strang="s1"][data-ret="r2"]';
  await klick(s, k);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].sends?.some((x) => x.id === 'r2' && x.db === 0)), 'off -> 0 dB');
  await klick(s, k);
  assert.ok(await s.bis(async () => !(await s.projekt()).spuren[0].sends?.some((x) => x.id === 'r2')), '0 dB -> off');
  const n = (await zeit(s)).length;
  await doppelklick(s, k); await warte(500);
  assert.equal((await anfragen(s, n)).length, 0, 'a double click sends nothing by itself (the single click waits)');
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-sendfeld').length`), 1, 'an input opened');
  await s.w(`(() => { const e = document.querySelector('.p-mx-sendfeld'); e.value = '-12'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].sends?.some((x) => x.id === 'r2' && x.db === -12)), 'typed -12 dB');
  // error case: a typed text that is no number sends nothing and keeps the level
  const m = (await zeit(s)).length;
  await doppelklick(s, k); await warte(400);
  await s.w(`(() => { const e = document.querySelector('.p-mx-sendfeld'); e.value = 'loud'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await warte(400);
  assert.equal((await anfragen(s, m)).length, 0);
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-sendfeld').length`), 0, 'the field closed');
  assert.match(await text(s, '[data-p="meldung"]'), /number/i);
});
test('page: the PRE/POST toggle of a return header', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  assert.equal(await text(s, '.p-mx-pre[data-ret="r1"]'), 'POST');
  await klick(s, '.p-mx-pre[data-ret="r1"]');
  assert.ok(await s.bis(async () => (await s.projekt()).returns[0].pre === true), 'pre written');
  assert.ok(await s.bis(async () => (await text(s, '.p-mx-pre[data-ret="r1"]')) === 'PRE'));
});
test('page: the key cell opens the menu with disabled entries and reasons, a choice sets the key', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  await klick(s, '.p-mx-zeile[data-strang="s2"] .p-mx-key');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelectorAll('.p-mx-keysel option').length`)) > 5), 'options arrived');
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-keysel optgroup').length`), 4);
  assert.equal(await s.w(`document.querySelector('.p-mx-keysel option[value="spur:2:pre"]').disabled`), true, 'the own track as pre key is refused');
  assert.ok((await s.w(`document.querySelector('.p-mx-keysel option[value="spur:2:pre"]').title`)).length > 0, 'with the reason');
  await s.w(`(() => { const e = document.querySelector('.p-mx-keysel'); e.value = 'spur:1:post'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[1].inserts[0].key?.quelle === 'spur'), 'key written');
  assert.ok(await s.bis(async () => /Kick/.test((await text(s, '.p-mx-zeile[data-strang="s2"] .p-mx-key')) ?? '')), 'the cell shows the source');
});
test('page: stale matrix (409 with a reason): the toast shows the server text and a refetch follows', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  await fetch(`${s.url}attrappe/rohantwort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weg: '/proj/aendern', code: 409, koerper: { fehler: 'ziel_unbekannt' } }) });
  const n = (await zeit(s)).length;
  await klick(s, '.p-mx-ziel[data-strang="s1"][data-ziel="g1"]');
  assert.ok(await s.bis(async () => /does not exist/.test((await text(s, '[data-p="meldung"]')) ?? '')), 'the server reason is shown');
  assert.ok(await s.bis(async () => (await routingGets(s, n)).length >= 1), 'a refetch follows');
  assert.equal((await s.projekt()).spuren[0].ausgang, undefined, 'nothing changed');
});
test('page: ten project changes in 100 ms make one matrix fetch; a closed view fetches nothing', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  const n0 = (await zeit(s)).length;
  await s.post('/proj/aendern', { rev: 1, label: 'closed', befehle: [{ befehl: 'master_aendern', fader_db: -1 }] });
  await warte(600);
  assert.equal((await routingGets(s, n0)).length, 0, 'closed: no fetch');
  await oeffne(s); await warte(400);
  const n = (await zeit(s)).length;
  const rev = (await s.projekt()).rev;
  for (let i = 0; i < 10; i++) await s.post('/proj/aendern', { rev: rev + i, label: `x${i}`, befehle: [{ befehl: 'master_aendern', fader_db: -2 - i }] });
  await warte(900);
  assert.equal((await s.projekt()).rev, rev + 10, 'precondition: ten changes');
  assert.equal((await routingGets(s, n)).length, 1, `fetches ${(await routingGets(s, n)).length}`);
});
test('page: GET /proj/routing offline says "Routing unavailable" and does not throw', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await fetch(`${s.url}attrappe/rohantwort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weg: '/proj/routing', code: 503, koerper: null }) });
  await sicht(s, '[data-p="matrix"] > summary'); await s.b.klick('[data-p="matrix"] > summary');
  assert.ok(await s.bis(async () => (await text(s, '.p-mx-status')) === 'Routing unavailable'), 'says so');
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-zeile').length`), 0);
});

test('page: a slow double click (400 ms between the clicks) sends no toggle and opens the field; a single click sends exactly one request', KLEIN, async (t) => {
  const s = await seite(t, projekt());
  await oeffne(s);
  const k = '.p-mx-send[data-strang="s1"][data-ret="r2"]';
  await sicht(s, k); await warte(30);
  const m = await s.b.mitte(k), n = (await zeit(s)).length;
  await s.b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await s.b.maus('mousePressed', m.x, m.y, { clickCount: 1 }); await s.b.maus('mouseReleased', m.x, m.y, { clickCount: 1 });
  await warte(400);
  await s.b.maus('mousePressed', m.x, m.y, { clickCount: 2 }); await s.b.maus('mouseReleased', m.x, m.y, { clickCount: 2 });
  await warte(900);
  assert.equal((await anfragen(s, n)).length, 0, 'no toggle request');
  assert.equal(await s.w(`document.querySelectorAll('.p-mx-sendfeld').length`), 1, 'the field is open');
  await s.w(`document.querySelector('.p-mx-sendfeld').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await warte(300);
  assert.deepEqual((await s.projekt()).spuren[0].sends.map((x) => x.id), ['r1'], 'Escape leaves the send as it was');
  const n2 = (await zeit(s)).length;
  await klick(s, k); await warte(1200);
  assert.equal((await anfragen(s, n2)).length, 1, 'a single click: exactly one request');
});
