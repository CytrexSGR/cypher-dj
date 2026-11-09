// 1.12 S7 (M13): the Studio track band view (public/track_tape_view.js) in node, on a small purpose-built DOM fake: PLAY sends a loop,
// a finished edit of the own running loop goes to /spur/aendern once, STOP drops a waiting change, the "next loop" hint follows GET /spur.
// The fake knows exactly what the view uses (innerHTML of the band head is read for the class names of its controls).
import test from 'node:test';
import assert from 'node:assert/strict';

function el(tag) {
  const e = {
    tag, kinder: [], attr: {}, hidden: false, disabled: false, textContent: '', title: '', className: '', dataset: {}, klassen: new Set(), auf: {},
    clientWidth: tag === 'svg' ? 400 : 0, clientHeight: tag === 'svg' ? 100 : 0, clientLeft: 0, clientTop: 0, value: '',
    classList: {
      toggle: (k, an) => { const m = an === undefined ? !e.klassen.has(k) : !!an; if (m) e.klassen.add(k); else e.klassen.delete(k); return m; },
      contains: (k) => e.klassen.has(k), add: (k) => e.klassen.add(k),
    },
    setAttribute(n, v) { e.attr[n] = String(v); },
    append(...k) { e.kinder.push(...k); }, prepend(...k) { e.kinder.unshift(...k); }, replaceChildren(...k) { e.kinder = [...k]; },
    addEventListener(n, f) { (e.auf[n] ??= []).push(f); },
    feuere(n, ev = {}) { return Promise.all((e.auf[n] ?? []).map((f) => f({ preventDefault() {}, target: e, ...ev }))); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {},
    get children() { return e.kinder; },
    querySelector(sel) { return alle(e).find((x) => (sel.startsWith('.') ? x.klassen.has(sel.slice(1)) : x.tag === sel)) ?? null; },
    set innerHTML(html) {   // the band head: one element per tag with a class (or the select), in document order
      e.kinder = [];
      for (const m of html.matchAll(/<(select|button|span|div)([^>]*)>/g)) {
        const k = el(m[1]), c = /class="([^"]+)"/.exec(m[2]);
        if (c) for (const x of c[1].split(' ')) k.klassen.add(x);
        k.hidden = /\shidden(\s|$)/.test(m[2]);
        e.kinder.push(k);
      }
    },
  };
  return e;
}
const alle = (e) => e.kinder.flatMap((k) => [k, ...alle(k)]);

function seite() {
  const wurzel = el('div'), instanz = el('div');
  instanz.dataset.strom = '2';
  instanz.querySelector = (sel) => (sel === '.spurbaender' ? wurzel : null);
  const body = el('body'); body.klassen.add('studio');
  globalThis.document = {
    createElement: (t) => el(t), createElementNS: (_ns, t) => el(t), querySelectorAll: () => [instanz], body, hidden: false, addEventListener() {},
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  return wurzel;
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const antwort = (code, j) => ({ ok: code === 200, status: code, json: async () => j });

test('S7 loop view: PLAY loops the line; a drag of the running loop sends exactly one /spur/aendern after release; STOP drops a waiting one', async (t) => {
  const wurzel = seite();
  let liste = [];
  globalThis.fetch = async () => antwort(200, liste);
  const posts = [];
  const post = async (pfad, daten) => {
    posts.push({ pfad, daten });
    if (pfad === '/spur') return antwort(200, { ok: true, anker_beat: 16, anker_takt: 5 });
    if (pfad === '/spur/aendern') return antwort(200, { ok: true, ab_beat: 48, ab_takt: 13, uebernaechster: false });
    return antwort(200, { ok: true });
  };
  const uhren = [];
  const altInterval = globalThis.setInterval;
  globalThis.setInterval = (f, ms) => { const h = altInterval(f, ms); uhren.push(h); return h; };
  t.after(() => { for (const h of uhren) clearInterval(h); globalThis.setInterval = altInterval; });
  const { bindeSpurbaender } = await import('../public/track_tape_view.js');
  const [fader] = bindeSpurbaender(post, () => 20);
  const kopf = fader.b;   // the fake keeps the head's controls flat under the band
  const svg = fader.b.kinder.find((x) => x.tag === 'svg');
  const spielen = kopf.querySelector('.spielen'), halten = kopf.querySelector('.halten'), hinweis = kopf.querySelector('.naechste');
  assert.ok(spielen && halten && svg && hinweis, 'controls found');
  assert.equal(hinweis.hidden, true);
  // PLAY: stop (404 fine), then POST /spur with schleife_takte = length and the loop's moves
  await spielen.feuere('click');
  const play = posts.find((p) => p.pfad === '/spur');
  assert.equal(play.daten.spur.schleife_takte, 8);
  assert.ok(play.daten.spur.fahrten.every((f) => f.ab_takt <= 8), JSON.stringify(play.daten.spur.fahrten));
  assert.match(fader.b.querySelector('.meldung').textContent, /^looping from bar 5$/);
  // without a running loop in GET /spur a drag sends no change (negative control)
  const ziehe = async () => {
    await svg.feuere('pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 50 });
    for (const y of [55, 60, 70]) await svg.feuere('pointermove', { isPrimary: true, clientX: 200, clientY: y });
    await svg.feuere('pointerup', { isPrimary: true });
  };
  await ziehe(); await warte(400);
  assert.equal(posts.filter((p) => p.pfad === '/spur/aendern').length, 0, 'no change without a running loop');
  // the own loop runs (poll of GET /spur), with a waiting change: the hint shows
  liste = [{ name: 'band-2-fader', quelle: 'andreas', anker_beat: 16, ende_beat: 48, schleife_takte: 8, durchlauf: 0, naechste: true, fahrten: play.daten.spur.fahrten }];
  await warte(600);
  assert.equal(hinweis.hidden, false, 'next loop hint while a change waits');
  await ziehe();
  assert.equal(posts.filter((p) => p.pfad === '/spur/aendern').length, 0, 'not during the 300 ms of quiet');
  await warte(400);
  const ae = posts.filter((p) => p.pfad === '/spur/aendern');
  assert.equal(ae.length, 1, 'exactly one change per finished drag (not one per pointermove)');
  assert.equal(ae[0].daten.name, 'band-2-fader'); assert.equal(ae[0].daten.spur.schleife_takte, 8);
  assert.match(fader.b.querySelector('.meldung').textContent, /^change from bar 13$/);
  liste = [{ ...liste[0], naechste: false }];
  await warte(600);
  assert.equal(hinweis.hidden, true, 'the hint goes once the change is planned');
  // STOP right after a drag: the waiting change is not sent, the message stays "stopped"
  await ziehe();
  await halten.feuere('click');
  await warte(400);
  assert.equal(posts.filter((p) => p.pfad === '/spur/aendern').length, 1, 'no change after STOP');
  assert.equal(fader.b.querySelector('.meldung').textContent, 'stopped');
});

// Adversarial review (timing) 2: an edit while PLAY's POST /spur is on its way. The line sent with PLAY is the old one; the edit must reach the
// started loop as exactly one /spur/aendern after PLAY's answer (never dropped, never sent to the run PLAY is replacing).
test('S7 loop view review timing 2: an edit during a pending PLAY reaches the new loop as one /spur/aendern after the answer', async (t) => {
  const wurzel = seite();
  let liste = [];
  globalThis.fetch = async () => antwort(200, liste);
  const posts = [];
  let gibFrei = null;
  const post = async (pfad, daten) => {
    posts.push({ pfad, daten });
    if (pfad === '/spur') { await new Promise((r) => { gibFrei = r; }); return antwort(200, { ok: true, anker_beat: 16, anker_takt: 5 }); }
    if (pfad === '/spur/aendern') return antwort(200, { ok: true, ab_beat: 48, ab_takt: 13, uebernaechster: false });
    return antwort(200, { ok: true });
  };
  const uhren = [];
  const altInterval = globalThis.setInterval;
  globalThis.setInterval = (f, ms) => { const h = altInterval(f, ms); uhren.push(h); return h; };
  t.after(() => { for (const h of uhren) clearInterval(h); globalThis.setInterval = altInterval; });
  const { bindeSpurbaender } = await import('../public/track_tape_view.js?t2');
  const [fader] = bindeSpurbaender(post, () => 20);
  const svg = fader.b.kinder.find((x) => x.tag === 'svg');
  const spielen = fader.b.querySelector('.spielen');
  const ziehe = async () => {
    await svg.feuere('pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 50 });
    for (const y of [55, 60, 70]) await svg.feuere('pointermove', { isPrimary: true, clientX: 200, clientY: y });
    await svg.feuere('pointerup', { isPrimary: true });
  };
  // the own loop already runs (a re-PLAY replaces it)
  liste = [{ name: 'band-2-fader', quelle: 'andreas', anker_beat: 0, ende_beat: 32, schleife_takte: 8, durchlauf: 0, naechste: false, fahrten: [] }];
  await warte(600);
  const klick = spielen.feuere('click');
  await (async () => { for (let i = 0; i < 100 && !gibFrei; i++) await warte(10); })();
  assert.ok(gibFrei, 'POST /spur is pending');
  const gesendet = JSON.stringify(posts.find((p) => p.pfad === '/spur').daten.spur);
  await ziehe();
  await warte(400);
  assert.equal(posts.filter((p) => p.pfad === '/spur/aendern').length, 0, 'no change while PLAY is on its way (it would hit the run being replaced)');
  gibFrei(); await klick;
  await warte(400);
  const ae = posts.filter((p) => p.pfad === '/spur/aendern');
  assert.equal(ae.length, 1, `the edit made during PLAY reaches the new loop once: ${ae.length}`);
  assert.notEqual(JSON.stringify(ae[0].daten.spur), gesendet, 'it carries the edited line');
});
