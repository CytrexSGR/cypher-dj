// Audit U27: a network error while a fader write re-reads /proj/aktuell (after rev_veraltet) must not leave the pump half done:
// the fader values queued meanwhile are still sent and live.schreiben is empty afterwards (else pruefeLive never reads again).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe, El } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const projekt = (rev) => ({
  live: true, rev, tempo_bpm: 128,
  gruppen: [
    { id: 'gA', name: 'Modul A', fader_db: 0, modul: { slot: 'A', titel: 'Loop', kuenstler: '', bpm: 128, tonart: '', laenge_beats: 16 } },
    { id: 'gD', name: 'Drums', ausgang: { id: 'gA' }, fader_db: 0 },
    { id: 'gE', name: 'Bass', ausgang: { id: 'gA' }, fader_db: 0 },
  ],
  spuren: [{ id: 'sD', art: 'audio', ausgang: { id: 'gD' }, fader_db: 0, clips: [] }, { id: 'sE', art: 'audio', ausgang: { id: 'gE' }, fader_db: 0, clips: [] }],
});
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };

test('audit U27: a failing re-read after rev_veraltet still sends the fader moved meanwhile and leaves nothing queued', async () => {
  let schreibe = 0;
  // the stand-in has `parent` but no `parentElement`, which sendeFader reads
  const hatPE = Object.getOwnPropertyDescriptor(El.prototype, 'parentElement');
  if (!hatPE) Object.defineProperty(El.prototype, 'parentElement', { get() { return this.parent; }, configurable: true });
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: { 'POST /proj/aendern': () => (++schreibe === 1 ? { code: 409, j: { fehler: 'rev_veraltet' } } : { code: 200, j: { rev: 5, projekt: projekt(5) } }) },
  });
  const echt = globalThis.fetch;
  globalThis.fetch = (url, opt) => (String(url) === '/proj/aktuell' ? Promise.reject(new Error('page server down')) : echt(url, opt));
  const fehler = [];
  const hoerer = (e) => fehler.push(e);
  process.on('unhandledRejection', hoerer);
  try {
    const m = await import('../public/live_view.js');
    m.bindeLive();
    m.live.projekt = projekt(3); m.live.rev = 3; m.live.stand = {};
    m.zeichneLive();
    const regler = [...document.querySelector('#live-panel').querySelectorAll('.live-regler')];
    const [r1, r2] = ['sD', 'sE'].map((id) => regler.find((r) => r.dataset.spurId === id));
    assert.ok(r1 && r2, 'two stem faders');
    r1.value = String(Number(r1.value) - 5); r1.dispatch('input');
    r2.value = String(Number(r2.value) - 5); r2.dispatch('input');   // while the first write is out
    await ruhe();
    await ruhe();
    assert.equal(fehler.length, 0, `no unhandled rejection: ${fehler.map((e) => e?.message)}`);
    assert.equal(m.live.schreiben.size, 0, 'nothing stays queued');
    const geschrieben = attrappe.anrufe.filter((a) => a.url === '/proj/aendern').flatMap((a) => a.koerper.befehle.map((b) => b.spur_id ?? b.id));
    assert.ok(geschrieben.includes('sE'), `the fader moved meanwhile was sent: ${geschrieben}`);
  } finally { if (!hatPE) delete El.prototype.parentElement; process.off('unhandledRejection', hoerer); globalThis.fetch = echt; }
});
