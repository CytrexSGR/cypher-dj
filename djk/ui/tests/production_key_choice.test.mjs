// 1.10 slice 6 T2: the key choice of the compressor popover and Duck by Kick. Pure parts (key_choice.js) run in node; the page parts drive the real
// page against the project stub (which answers GET /proj/routing?optionen= with the real routingMatrix). Without google-chrome the page tests skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { routingMatrix } from '../project/routing_matrix.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { schluesselGruppen, schluesselBefehl, schluesselWert, duckBefehl, duckKicks } from '../public/production/key_choice.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

// Kick, Bass, Lead, Pad; group Music (s2, s3); return Hall; a compressor on s2 (stage i1)
function projekt(extra = []) {
  let p = neuesProjekt('Key page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' },
    { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }, ...extra]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const optionen = (p, id = 'i1') => routingMatrix(p, id).straenge.flatMap((s) => s.stufen).find((x) => x.insert_id === id).optionen;

test('picker_sendet_sc: a track pre key is the row key `sc`, own is sc 0', () => {
  assert.deepEqual(schluesselBefehl('i1', 'spur:1:pre'), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 1 });
  assert.deepEqual(schluesselBefehl('i1', 'spur:4:pre'), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 4 });
});
test('picker_sendet_key: every other source is the structural key', () => {
  const k = (wert, quelle, nr, punkt) => assert.deepEqual(schluesselBefehl('i1', wert), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle, nr, punkt } });
  k('spur:1:post', 'spur', 1, 'post'); k('grp:1:pre', 'grp', 1, 'pre'); k('grp:1:post', 'grp', 1, 'post'); k('ret:1:post', 'ret', 1, 'post');
  k('deck:2', 'deck', 2, 'post'); k('erz:1', 'erz', 1, 'post');
  assert.throws(() => schluesselBefehl('i1', 'bogus:1'), /key/, 'error case: an unknown choice is not sent');
  assert.throws(() => schluesselBefehl('i1', 'spur:x:pre'), /key/);
});
test('own_entfernt_beides: own sends sc 0 (the server drops a key with it)', () => {
  assert.deepEqual(schluesselBefehl('i1', 'own'), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 0 });
});
test('gesperrter_eintrag_traegt_text: a refused option is disabled and its tooltip is the server text', () => {
  const p = projekt(), g = schluesselGruppen(optionen(p), p);
  assert.deepEqual(g.map((x) => x.titel), ['Tracks', 'Groups', 'Returns', 'DJ']);
  const alle = g.flatMap((x) => x.eintraege), roh = optionen(p);
  const eigen = alle.find((e) => e.wert === 'spur:2:pre');   // the track's own signal as a pre key: sidechain_zyklus
  assert.equal(eigen.gesperrt, true);
  assert.equal(eigen.text, roh.find((o) => o.quelle === 'spur' && o.nr === 2 && o.punkt === 'pre').text);
  assert.ok(eigen.text.length > 0);
  const frei = alle.find((e) => e.wert === 'spur:1:pre');
  assert.equal(frei.gesperrt, false); assert.equal(frei.text, undefined, 'negative control: an allowed entry has no text');
  assert.equal(alle.filter((e) => e.gesperrt).length, roh.filter((o) => !o.erlaubt).length);
  assert.equal(g[0].eintraege[0].wert, 'own', 'own signal heads the tracks');
  assert.match(alle.find((e) => e.wert === 'spur:1:pre').label, /Kick/);
  assert.ok(g[3].eintraege.some((e) => e.wert === 'deck:1') && g[3].eintraege.some((e) => e.wert === 'erz:1'));
});
test('stufe_mit_struktur_schluessel_zeigt_quelle: the value of a stage with key is its source, not own', () => {
  assert.equal(schluesselWert({ id: 'i1' }), 'own');
  assert.equal(schluesselWert({ id: 'i1', sc: 3 }), 'spur:3:pre');
  assert.equal(schluesselWert({ id: 'i1', key: { quelle: 'grp', nr: 1, punkt: 'post' } }), 'grp:1:post');
  assert.equal(schluesselWert({ id: 'i1', key: { quelle: 'deck', nr: 2, punkt: 'post' } }), 'deck:2');
  assert.equal(schluesselWert({ id: 'i1', key: { quelle: 'erz', nr: 1, punkt: 'post' } }), 'erz:1');
});
test('duck_menue_sendet_befehl: kick choice lists the other tracks, one duck_durch_kick', () => {
  const p = projekt();
  assert.deepEqual(duckKicks(p, 's1').map((k) => k.id), ['s2', 's3', 's4']);
  assert.deepEqual(duckKicks(p, 's3').map((k) => k.id), ['s1', 's2', 's4'], 'never the target itself');
  assert.deepEqual(duckBefehl('s3', 's1'), { befehl: 'duck_durch_kick', spur_id: 's3', kick_id: 's1' });
  assert.throws(() => duckBefehl('s1', 's1'), /kick/, 'error case: a track cannot duck by itself');
});
test('every visible string is English', () => {
  const t = fs.readFileSync(new URL('../public/production/key_choice.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /\b(Eigen|Spur|Gruppe|Schl[uü]ssel|Wahl)\b/);
});

const wahl = (s, wert) => s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc'); e.value = ${JSON.stringify(wert)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne(); await s.saat(p);
  return s;
}
const optWerte = (s) => s.w(`[...document.querySelectorAll('.p-ins-popover[data-insert="i1"] .p-ins-sc option')].map((o) => o.value)`);

test('page: the popover loads the options, a group key is stored, the select shows it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.ok(await s.bis(async () => (await optWerte(s)).includes('spur:1:post')), 'options arrived');
  assert.equal(await s.w(`document.querySelectorAll('.p-ins-popover[data-insert="i1"] .p-ins-sc optgroup').length`), 4);
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc option[value="spur:2:pre"]').disabled`), true);
  await wahl(s, 'spur:1:post');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[1].inserts[0].key?.quelle === 'spur'), 'key written');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc').value`)) === 'spur:1:post'));
  await wahl(s, 'own');
  assert.ok(await s.bis(async () => { const i = (await s.projekt()).spuren[1].inserts[0]; return !i.key && !i.sc; }), 'own removes the key');
});
test('page: a stage with a structural key shows its source (not own signal)', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const p = projekt([{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'spur', nr: 1, punkt: 'post' } }]);
  assert.equal(p.spuren[1].inserts[0].key?.quelle, 'spur', 'precondition');
  const s = await seite(t, p);
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc').value`)) === 'spur:1:post'));
  assert.doesNotMatch(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc').selectedOptions[0].textContent`), /own signal/i);
});
test('page: a failing options fetch disables the select with the reason, nothing is written', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await s.post('/attrappe/rohantwort', { weg: '/proj/routing', code: 400, koerper: { fehler: 'argument_ungueltig' } });
  const vorher = (await s.projekt()).rev;
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.ok(await s.bis(() => s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc').disabled`)), 'select disabled');
  assert.match(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-sc').closest('label').querySelector('output').textContent`), /\S/);
  await warte(200);
  assert.equal((await s.projekt()).rev, vorher, 'no write');
});
test('page: Duck by Kick sends one duck_durch_kick and the stage appears', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s3"] .p-duck') !== null`), true);
  assert.equal(await s.w(`[...document.querySelectorAll('.p-kette[data-strang="s3"] .p-duck option')].map((o) => o.value).join()`), ',s1,s2,s4');
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="master"] .p-duck')`), null, 'only tracks can duck');
  await s.w(`(() => { const e = document.querySelector('.p-kette[data-strang="s3"] .p-duck'); e.value = 's1'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[2].inserts?.[0]?.sc === 1), 'compressor keyed by Kick');
  const log = await (await fetch(s.url + 'attrappe/log')).json();
  const aenderungen = log.filter((x) => x.weg === '/proj/aendern' && JSON.stringify(x.koerper).includes('duck_durch_kick'));
  assert.equal(aenderungen.length, 1, 'one request');
});
