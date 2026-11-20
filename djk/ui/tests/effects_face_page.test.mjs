// EFFECTS: the channel compressor face in a real page (headless Chrome against the project stub, check/page_mock.mjs). (1) The real page entry loads
// without an uncaught error: an import cycle read at module load ("Cannot access 'FX_KANAELE' before initialization", 2026-11-15) leaves the whole page without decks,
// and no stand-in shows it. (2) The face opens from the COMP chip of the live dock card, lies inside the window, shows the GR the chip reports, sends the existing /regler body,
// and the screenshots of the open face are taken (the stub does not serve /regler, so the test answers it in the page). Without google-chrome the tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const AUS = path.join(os.homedir(), 'messungen/2026-11-15-backlog/device-faces');
const sse = (s, a, f) => s.post('/attrappe/sse', { a, f });
const WERTE = { 'erz/1/komp/an': 1, 'erz/1/komp/schwelle': -26, 'erz/1/komp/ratio': 6, 'erz/1/komp/attack': 4, 'erz/1/komp/release': 220, 'erz/1/komp/makeup': 4, 'erz/1/komp/mix': 0.8, 'erz/1/komp/sc': 6 };

async function seite(t, opt, produktion = true) {
  const s = await starteSeite(opt);
  t.after(() => s.stoppe());
  if (produktion) await s.oeffne();
  else { await s.b.oeffne(s.url); await warte(1500); }   // the first view of the page, where the EFFECTS field is
  return s;
}

test('the page entry loads without an uncaught error (no import cycle read at module load)', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  const fehler = s.b.konsole.filter((k) => k.typ === 'exception' || /before initialization|is not defined|Cannot read/.test(k.text ?? ''));
  assert.deepEqual(fehler, [], 'no uncaught error in the console');
  assert.ok(await s.w(`!!document.querySelector('#live-dock')`), 'EFFECTS holds the live dock');
  assert.ok(await s.w(`document.querySelectorAll('.deck, #deck-a, [data-deck]').length`) >= 1, 'the decks exist');
});

for (const [breite, hoehe] of [[1280, 900], [1920, 1080]]) {
  test(`the face opens from the COMP chip, lies inside ${breite}x${hoehe}, follows the strip, sends the existing body; screenshot`, { skip: !CHROME && 'no google-chrome' }, async (t) => {
    const s = await seite(t, { breite, hoehe }, false);
    await s.b.klick('[data-bereich="effekte"]');
    await warte(300);
    for (const [pfad, wert] of Object.entries(WERTE)) await sse(s, '/e/regler', { pfad, wert });
    const gr = setInterval(() => sse(s, '/zustand/komp', { kanal: 'erz/1', gr_db: 9.4 }).catch(() => {}), 100);
    t.after(() => clearInterval(gr));
    // the stub does not serve /regler: the page answers it, every other URL goes through
    await s.w(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).endsWith('/regler') ? Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) : f(u, o); })()`);
    await s.w(`document.querySelector('#live-dock [data-strang="erz/1"] [data-teil="komp"]').click()`);
    await warte(500);
    assert.equal(await s.w(`document.querySelectorAll('.p-face').length`), 1);
    const m = await s.w(`(() => { const r = document.querySelector('.p-face').getBoundingClientRect(); const f = document.querySelector('.p-face'); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, JSON.stringify(m));
    assert.ok(m.sh <= m.ch + 1, `no inner scroll: ${m.sh} > ${m.ch}`);
    assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Threshold', 'Ratio', 'Attack', 'Release', 'Makeup', 'Mix']);
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-schwelle"] .fp-wert').textContent`), '-26.0 dB', 'the knobs show the strip');
    assert.equal(await s.w(`document.querySelector('.p-face .fa-komp-schluessel-wahl').value`), '6', 'the key select shows the strip');
    const grChip = await s.w(`document.querySelector('#live-dock [data-strang="erz/1"] [data-teil="komp"]').title`);
    assert.match(grChip, /GR 9\.4 dB/, 'the chip title carries the GR');
    assert.match(await s.w(`document.querySelector('.p-face .fa-meter-wert, .p-face [class*="meter"] [class*="wert"]')?.textContent ?? document.querySelector('.p-face').textContent`), /9\.4/, 'the face shows the number of the strip');
    // a knob move reaches window.djkGesendet through the existing sender
    await s.b.klick('.p-face [data-id="c-r1-schwelle"] .fp-knopf');   // focus
    await s.w(`document.querySelector('.p-face [data-id="c-r1-schwelle"] .fp-knopf').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    await warte(300);
    const e = await s.w(`window.djkGesendet.filter((x) => 'erz/1/komp/schwelle' in x).at(-1) ?? null`);
    assert.ok(e, 'a write for erz/1/komp/schwelle');
    assert.equal(e.code, 200);
    assert.ok(e['erz/1/komp/schwelle'] > -26, `the moved value: ${e['erz/1/komp/schwelle']}`);
    fs.mkdirSync(AUS, { recursive: true });
    await s.b.bild(path.join(AUS, `t3-${breite}.png`));
  });
}
