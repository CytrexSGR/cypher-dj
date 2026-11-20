// The one window opener helper (public/window_open.js) and the device opener on top of it (device_open.js), stage 2 of the one dock work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fensterMass, oeffneFensterRoh, FENSTER_GESPERRT } from '../public/window_open.js';
import { oeffneGeraetFenster, geraetFensterSpur, geraetFensterName, geraetFensterMass } from '../public/device_open.js';
import { parseZiel } from '../public/dock/target.js';

const attrappe = (w = {}) => { const aufrufe = []; return { aufrufe, fenster: { open: (...a) => { aufrufe.push(a); return w; } } }; };

test('fensterMass: centred, capped by the screen, the corner never negative with klemme0', () => {
  assert.deepEqual(fensterMass({ availWidth: 2560, availHeight: 1400 }, 1500, 880), { B: 1500, H: 880, x: 530, y: 260 });
  assert.deepEqual(fensterMass({ availWidth: 1280, availHeight: 720 }, 1500, 880), { B: 1280, H: 720, x: 0, y: 0 });
  assert.deepEqual(fensterMass({ availWidth: 1000, availHeight: 700, availLeft: -1000 }, 800, 600), { B: 800, H: 600, x: -900, y: 50 });
  assert.equal(fensterMass({ availWidth: 1000, availHeight: 700, availLeft: -1000 }, 800, 600, true).x, 0);
  assert.deepEqual(fensterMass(undefined, 1500, 880), { B: 1500, H: 880, x: 210, y: 100 }, 'no screen object: 1920 x 1080');
});

test('oeffneFensterRoh: pop-up features, focus, resize and move on request, the blocked message', () => {
  let fokus = 0; const groesse = [], lage = [];
  const w = { focus() { fokus++; }, resizeTo: (...a) => groesse.push(a), moveTo: (...a) => lage.push(a) };
  const { aufrufe, fenster } = attrappe(w);
  const schirm = { availWidth: 2560, availHeight: 1400 };
  assert.equal(oeffneFensterRoh({ adresse: '/#remix', name: 'djk-remix', breite: 1100, hoehe: 880, fenster, schirm }), w);
  assert.deepEqual(aufrufe[0], ['/#remix', 'djk-remix', 'popup,width=1100,height=880,left=730,top=260']);
  assert.equal(fokus, 1);
  assert.equal(groesse.length, 0, 'no resize unless asked');
  oeffneFensterRoh({ adresse: '/#remix', name: 'djk-remix', breite: 1100, hoehe: 880, fenster, schirm, anpassen: true });
  assert.deepEqual([groesse, lage], [[[1100, 880]], [[730, 260]]]);
  const gemeldet = [];
  const blockiert = { open: () => null };
  assert.equal(oeffneFensterRoh({ adresse: '/x', name: 'n', breite: 1, hoehe: 1, fenster: blockiert, melde: (t, f) => gemeldet.push([t, f]), meldung: FENSTER_GESPERRT }), null);
  assert.deepEqual(gemeldet, [[FENSTER_GESPERRT, true]]);
  assert.equal(oeffneFensterRoh({ adresse: '/x', name: 'n', breite: 1, hoehe: 1, fenster: blockiert, melde: () => { throw new Error('no message wanted'); } }), null, 'without a message nothing is said');
  const ohneFokus = { open: () => ({ focus() { throw new Error('wm'); } }) };
  assert.ok(oeffneFensterRoh({ adresse: '/x', name: 'n', breite: 1, hoehe: 1, fenster: ohneFokus }), 'a window manager that refuses the focus does not fail the open');
});

test('device opener: a stage opens its own window with its own name and size; the instrument window is unchanged', () => {
  const { aufrufe, fenster } = attrappe({ focus() {} });
  const schirm = { availWidth: 2560, availHeight: 1400 };
  assert.ok(oeffneGeraetFenster('ins:i7', null, { fenster, schirm }));
  assert.deepEqual(aufrufe[0], ['/#geraet=ins%3Ai7', 'djk-geraet-ins_i7', 'popup,width=1100,height=760,left=730,top=320']);
  oeffneGeraetFenster('s3', null, { fenster, schirm });
  assert.deepEqual(aufrufe[1], ['/#geraet=s3', 'djk-geraet', 'popup,width=1500,height=880,left=530,top=260']);
  oeffneGeraetFenster(parseZiel('master'), null, { fenster, schirm });
  assert.equal(aufrufe[2][0], '/#geraet=master');
  assert.equal(aufrufe[2][1], 'djk-geraet-master');
  oeffneGeraetFenster('ret:r1', null, { fenster, schirm }); oeffneGeraetFenster('grp:r1', null, { fenster, schirm });
  assert.notEqual(aufrufe[3][1], aufrufe[4][1], 'a return and a group of the same id are two windows');
  oeffneGeraetFenster('ins:i7', null, { fenster, schirm });
  assert.equal(aufrufe[5][1], aufrufe[0][1], 'a second WINDOW ↗ on the same target names the same window: the browser focuses it');
});
test('device opener: unknown and reserved targets open nothing', () => {
  const { aufrufe, fenster } = attrappe({ focus() {} });
  for (const t of ['', 'fx:3', 'kanal:erz/2', 'color', 'ins:', 'x:y', null, undefined]) assert.equal(oeffneGeraetFenster(t, null, { fenster }), null, String(t));
  assert.equal(aufrufe.length, 0);
});
test('address: only the instrument window answers geraetFensterSpur, a stage address does not read as a track', () => {
  assert.equal(geraetFensterSpur('#geraet=s3'), 's3');
  assert.equal(geraetFensterSpur('#geraet=ins%3Ai7'), null);
  assert.equal(geraetFensterSpur('#geraet=master'), null);
  assert.equal(geraetFensterName('s12'), 'djk-geraet');
  assert.equal(geraetFensterName('ins:i7'), 'djk-geraet-ins_i7');
  assert.deepEqual(geraetFensterMass({ availWidth: 3000, availHeight: 2000, availLeft: 100, availTop: 20 }, 'ins'), { B: 1100, H: 760, x: 1050, y: 640 });
});

test('window.open is called in window_open.js only', () => {
  const treffer = [];
  const gehe = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') gehe(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      if (/\b(?:window|fenster|f)\.open\(/.test(fs.readFileSync(p, 'utf8').split('\n').filter((z) => !/^\s*(\/\/|\*)/.test(z)).join('\n'))) treffer.push(p.replace(/^.*\/public\//, ''));
    }
  };
  gehe(new URL('../public', import.meta.url).pathname);
  assert.ok(treffer.includes('window_open.js'));
  assert.deepEqual(treffer.filter((x) => x !== 'window_open.js'), [], `window.open outside the helper: ${treffer}`);
});
