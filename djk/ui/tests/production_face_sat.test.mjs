// PRODUCTION: the saturator face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_comp.test.mjs). The pure maths is
// in face_sat.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { poolVoll } from './support/inserts_scenario.mjs';
import { starteSeite } from '../check/page_mock.mjs';
import { saettAusgang, saettTitel, klippText } from '../public/face/sat.js';
import { plusEintraege, masterClipZustand, KLIPPER_WERTE, MASTER_VOLL_TEXT } from '../public/dock/plus.js';
import { insGrAufnehmen, insGrLesungArt, MAX_SAETT } from '../public/production/inserts.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, one saturator on Kick (stage i1); `werte`: [[insert, param, value]]
function projekt(werte = []) {
  let p = neuesProjekt('Face page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett' }]);
  for (const [insert_id, param, wert] of werte) p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id, param, wert }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
async function seite(t, p, opt = { hoehe: 1080 }) {
  const s = await starteSeite(opt);
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const FACE = '.p-face';
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const knopf = (param) => `${FACE} [data-id="c-r1-${param}"] .fp-knopf`;
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('[data-w="karte-teil"][data-teil="${id}"]').click()`);
const entferne = async (s, id = 'i1') => {   // the chip menu entry Remove (the event stops at the chip: the card's own menu handler would replace the chip menu, a dock quirk outside this test)
  await s.w(`(() => { const c = document.querySelector('[data-w="karte-teil"][data-teil="${id}"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); })()`);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.trim() === 'Remove').click()`);
};
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const taste = (s, param, key) => s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf(param))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
const WERTE = [['i1', 'drive', 24], ['i1', 'out', -3], ['i1', 'mix', 0.8]];

test('saturator face opens from the stage chip, lies inside the window (1280x900, 1920x1080), has four knobs showing the stage and writes nothing on open', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s = await seite(t, projekt(WERTE), { breite: b, hoehe: h });
    assert.equal(await zaehle(s, FACE), 0, 'closed by default');
    const vorher = (await aend(s)).length;
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 1);
    const m = await lage(s);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, `${b}x${h}: ${JSON.stringify(m)}`);
    assert.ok(m.sh <= m.ch + 1, `${b}x${h}: no inner scroll`);
    assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'SATURATOR');
    assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Drive', 'Output', 'Mix', 'Ceiling']);
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-drive"] .fp-wert').textContent`), '24.0 dB');
    assert.equal((await aend(s)).length, vorher, 'opening writes nothing');
    assert.match(await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`), /^M[\d.]+,[\d.]+ L/);
  }
});

test('a Drive knob key sends insert_param_setzen drive with the label "Drive saturator on Kick"; the curve moves', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  const kurve0 = await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`);
  await taste(s, 'drive', 'ArrowUp');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.drive > 12), 'drive in the project');
  const v = (await s.projekt()).spuren[0].inserts[0].werte.drive;
  const text = `${v.toFixed(1)} dB`;
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-drive"] .fp-wert').textContent`), text);
  assert.notEqual(await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`), kurve0, 'the curve moved with the knob');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await fetch(`${s.url}proj/verlauf`).then((r) => r.json())).at(-1).label, 'Drive saturator on Kick');
});

test('failure case: the stage is removed under the open face: the face closes within 500 ms and no insert_param_setzen follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  assert.equal(await zaehle(s, FACE), 1);
  await entferne(s);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 500), 'the face is gone');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_entfernen']);
  const n = (await aend(s)).length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
});

test('track head opener: the FACE button shows for a track with a saturator and opens the saturator face', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(), { breite: 1280, hoehe: 900 });
  const kopf = (id) => `.p-kopf[data-spur="${id}"] .p-face-auf`;
  assert.equal(await s.w(`!!document.querySelector(${JSON.stringify(kopf('s1'))})`), true);
  assert.equal(await s.w(`!!document.querySelector(${JSON.stringify(kopf('s2'))})`), false, 'no opener on a track without a face-capable stage');
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'SATURATOR');
});

// ---- strand 5 slice 1: the Cypher Clipper ----------------------------------------------------------------------------------------------------
const CLIPPER = { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett', werte: { kurve: 2, drive: 0, out: 0, decke: -0.3, mix: 1 } };

test('clip curves: Hard at drive 12 and ceiling -6 is flat at 0.501 * out above |x| > 0.126; Soft ends flat at the ceiling; Tanh at ceiling 0 is the old curve', () => {
  const hart = { drive: 12, out: 0, mix: 1, kurve: 2, decke: -6 };
  for (const x of [0.13, 0.2, 0.5, 1]) assert.ok(Math.abs(saettAusgang(x, hart) - 0.501) < 1e-3, `x ${x}`);
  assert.ok(Math.abs(saettAusgang(0.1, hart) - 0.1 * 10 ** (12 / 20)) < 1e-9, 'linear below the knee');
  assert.ok(Math.abs(saettAusgang(-1, hart) + 0.501) < 1e-3, 'odd');
  assert.ok(Math.abs(saettAusgang(1, { ...hart, out: -6 }) - 0.501 * 0.501) < 1e-3, 'out scales the flat part');
  const weich = { drive: 12, out: 0, mix: 1, kurve: 1, decke: -6 };
  assert.ok(Math.abs(saettAusgang(1, weich) - 0.501) < 1e-3);
  const u = 0.05 * 10 ** (12 / 20) / 10 ** (-6 / 20);   // inside the soft knee: 1.5u - 0.5u^3 of the ceiling
  assert.ok(Math.abs(saettAusgang(0.05, weich) - 10 ** (-6 / 20) * (1.5 * u - 0.5 * u ** 3)) < 1e-9);
  for (const x of [0.1, 0.5, 1]) assert.equal(saettAusgang(x, { drive: 12, out: -6, mix: 1 }), saettAusgang(x, { drive: 12, out: -6, mix: 1, kurve: 0, decke: 0 }), 'default is tanh at 0 dB');
  assert.ok(Math.abs(saettAusgang(1, { ...hart, decke: -99 }) - saettAusgang(1, { ...hart, decke: -24 })) < 1e-12, 'a ceiling out of range clamps');
  assert.equal(saettTitel(0), 'Cypher Saturation'); assert.equal(saettTitel(1), 'Cypher Clipper'); assert.equal(saettTitel(2), 'Cypher Clipper');
  assert.equal(klippText(3.24), 'clip 3.2 dB'); assert.equal(klippText(null), 'clip -');
});

test('the saturator reports its clip amount on ins/saett/<n> into the gr store, apart from the compressor slots', () => {
  const g = {};
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/saett/2', gr_db: 4.5 }, 1000), true);
  assert.equal(insGrLesungArt(g, 'saett', 2, 1100), 4.5);
  assert.equal(insGrLesungArt(g, 'saett', 2, 1500), null, '500 ms rule');
  assert.equal(g[2], undefined, 'the compressor slot 2 is untouched');
  assert.equal(insGrAufnehmen(g, { kanal: `ins/saett/${MAX_SAETT + 1}`, gr_db: 1 }, 1000), false);
});

test('the Clipper menu entry sends insert_setzen saett with kurve 2 (Hard), ceiling -0.3 dB; the pool and a full strip grey it', () => {
  let p = lauf(neuesProjekt('Clip entry'), [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }]);
  const e = plusEintraege(p, 's1', [], {}).find((x) => x.text === 'Clipper');
  assert.deepEqual(e.befehl, CLIPPER); assert.deepEqual(CLIPPER.werte, KLIPPER_WERTE); assert.equal(e.label, 'Add Clipper to Kick');
  assert.deepEqual(plusEintraege(p, 's1', [], {}).slice(3, 5).map((x) => x.text), ['Saturator', 'Clipper']);
  const q = lauf(p, [{ befehl: 'insert_setzen', ...CLIPPER }]);
  const ins = q.spuren[0].inserts[0];
  assert.deepEqual([ins.art, ins.werte.kurve, ins.werte.decke, ins.werte.drive, ins.werte.out], ['saett', 2, -0.3, 0, 0], 'the project takes the command as sent');
  const voll = poolVoll('saett', MAX_SAETT).projekt;   // the whole pool (32) spread over strips of five; the master chain is empty
  const v = plusEintraege(voll, 'master', [], {}).find((x) => x.text === 'Clipper');
  assert.equal(v.befehl, null); assert.equal(v.grund, 'No free saturator');
});

test('the CLIP button of the master: the clipper goes before the first limiter, else to the end; lit with a clipper; disabled with five stages', () => {
  const master = (inserts) => { let p = neuesProjekt('Master'); for (const [i, art] of inserts.entries()) p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 'master', pos: i, art }]); return p; };
  let z = masterClipZustand(master(['eq', 'lim']));
  assert.equal(z.insert, null); assert.deepEqual([z.befehl.strang_id, z.befehl.pos, z.befehl.art], ['master', 1, 'saett']); assert.deepEqual(z.befehl.werte, KLIPPER_WERTE);
  z = masterClipZustand(master(['eq', 'komp']));
  assert.equal(z.befehl.pos, 2, 'no limiter: at the end');
  const p = lauf(master(['eq', 'lim']), [masterClipZustand(master(['eq', 'lim'])).befehl]);
  assert.deepEqual(p.master.inserts.map((i) => i.art), ['eq', 'saett', 'lim'], 'the stage sits before the limiter');
  z = masterClipZustand(p);
  assert.equal(z.insert.art, 'saett'); assert.equal(z.befehl, null);
  assert.equal(masterClipZustand(lauf(master(['eq', 'lim']), [{ befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'saett' }])).befehl.pos, 2, 'a plain Tanh saturator is not a clipper');
  z = masterClipZustand(master(['eq', 'komp', 'utility', 'gate', 'mb']));
  assert.equal(z.befehl, null); assert.equal(z.grund, MASTER_VOLL_TEXT); assert.equal(MASTER_VOLL_TEXT, 'The master chain has five stages');
});

test('page: a Clipper stage shows the title Cypher Clipper and the CURVE selector; changing it sends insert_param_setzen kurve; the CLIP button is on the master card', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt([['i1', 'kurve', 2], ['i1', 'decke', -6]]));
  await oeffneKlick(s);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-saett-titel').textContent`), 'Cypher Clipper');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-saett-wahl').value`), '2');
  assert.match(await s.w(`document.querySelector('.p-face .fa-saett-klipp').textContent`), /^clip -$/);
  await s.w(`(() => { const w = document.querySelector('.p-face .fa-saett-wahl'); w.value = '1'; w.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.kurve === 1), 'kurve in the project');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-saett-titel').textContent`), 'Cypher Clipper');
  assert.equal(await s.w(`document.querySelector('[data-w="karte-clip"]')?.getAttribute('aria-pressed') ?? 'none'`), 'false', 'the CLIP button shows on the master card, not lit');
});
