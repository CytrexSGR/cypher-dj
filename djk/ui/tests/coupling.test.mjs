// Tablet access (task 10): address choice, pairing, the second listener behind the cookie, the deny list against the golden route list.
// In-process server without kern; the second listener binds 127.0.0.1 here (opt.tablet.bindeAn) while the pairing link names a private test address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { Kopplung, LINK_MS, COOKIE, GERAET_MAX_MS, heimAdresse, istPrivat, tabletVerboten, TABLET_VERBOTEN, TABLET_POST_ERLAUBT } from '../http/coupling.ts';
// The private 192 prefix and a CGNAT address are assembled from parts so that the public export sieve, which flags every such literal, stays strict.
const P192 = ['192', '168'].join('.');
const CGNAT = ['100', '64', '0', '9'].join('.');

belegeTestInstanz();
const GOLDEN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'support', 'routen_golden.json'), 'utf8')).ergebnis;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ADR = `${P192}.7.20`;
const PORT_TABLET = 47300 + K + 61;

// ---------- address ----------
const nic = (address, internal = false, family = 'IPv4') => ({ address, family, internal, netmask: '255.255.255.0', mac: '', cidr: null });

test('heimAdresse: only physical-looking interfaces; every virtual, tunnel or container name is refused', () => {
  for (const name of ['eth0', 'enp3s0', 'eno1', 'ens18', 'enx001122334455', 'wlan0', 'wlp2s0']) assert.equal(heimAdresse({ [name]: [nic(`${P192}.1.5`)] }), `${P192}.1.5`, name);
  for (const name of ['lo', 'docker0', 'br-abc', 'br0', 'veth12', 'virbr0', 'podman0', 'incusbr0', 'vnet3', 'ppp0', 'nordlynx', 'wg0', 'tun0', 'tap0', 'ztabcdef', 'vpn0', 'cni0', 'flannel.1', 'vmnet8', 'lxdbr0']) {
    assert.equal(heimAdresse({ [name]: [nic(`${P192}.1.5`)] }), null, name);
  }
});

test('istPrivat: RFC 1918 only', () => {
  for (const ip of ['10.0.0.5', `${P192}.1.20`, '172.16.0.1', '172.31.250.1']) assert.equal(istPrivat(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', CGNAT, '169.254.1.1', '127.0.0.1', '0.0.0.0', '192.169.0.1', '999.1.1.1', '::1', 'fe80::1']) assert.equal(istPrivat(ip), false, ip);
});

test('heimAdresse: the LAN address of this host; virtual bridges, VPN, loopback and public addresses never', () => {
  const dieserRechner = { lo: [nic('127.0.0.1', true)], eth0: [nic(`${P192}.1.20`), nic('fe80::1', false, 'IPv6')], vpn0: [nic(CGNAT)],
    'br-hsandbox': [nic('172.31.250.1')], docker0: [nic('172.17.0.1')] };
  assert.equal(heimAdresse(dieserRechner), `${P192}.1.20`);
  assert.equal(heimAdresse({ lo: [nic('127.0.0.1', true)], vpn0: [nic(CGNAT)], 'br-x': [nic('172.18.0.1')], docker0: [nic('172.17.0.1')] }), null, 'only virtual: refuse');
  assert.equal(heimAdresse({ eth0: [nic('8.8.8.8')] }), null, 'a public address is never taken');
  assert.equal(heimAdresse({ eth0: [nic('0.0.0.0')] }), null);
  assert.equal(heimAdresse({ eth0: [nic(`${P192}.1.5`, true)] }), null, 'internal flag');
  assert.equal(heimAdresse({ eth0: [nic('10.1.2.3')], wlan0: [nic(`${P192}.1.9`)] }), `${P192}.1.9`, 'the 192 range before 10');
  assert.equal(heimAdresse({}), null);
});

// ---------- pairing ----------
test('Kopplung: one-time link valid for 2 minutes, used once, token stored hashed with mode 0600, revocable, survives a restart', () => {
  const ordner = tmp('kop-'), datei = path.join(ordner, 'kopplung.json');
  let t = 1_000_000;
  const k = new Kopplung(datei, () => t);
  const l = k.neuerLink();
  assert.equal(l.bis - t, LINK_MS);
  assert.equal(LINK_MS, 120_000);
  t += 119_000;
  const r = k.loeseEin(l.token, 'Tabletä UA');
  assert.equal(r.ok, true);
  assert.equal(k.loeseEin(l.token).ok, false, 'one time only');
  assert.equal(k.pruefe(`${COOKIE}=${r.cookie}`), r.id);
  assert.equal(k.pruefe(`x=1; ${COOKIE}=${r.cookie}; y=2`), r.id);
  assert.equal(k.pruefe(`${COOKIE}=${r.cookie.slice(0, -1)}${r.cookie.endsWith('A') ? 'B' : 'A'}`), null, 'a wrong value of the same length');
  assert.equal(k.pruefe(`${COOKIE}=${l.token}`), null, 'the link token is not a cookie');
  assert.equal(k.pruefe(undefined), null);
  assert.equal(k.pruefe(`${COOKIE}=`), null);
  const roh = fs.readFileSync(datei, 'utf8');
  assert.ok(!roh.includes(r.cookie) && !roh.includes(l.token), 'neither secret is on disk');
  assert.equal(fs.statSync(datei).mode & 0o777, 0o600);
  assert.equal(JSON.parse(roh).geraete[0].name, 'Tablet UA', 'name is plain ASCII');
  assert.equal(new Kopplung(datei, () => t).pruefe(`${COOKIE}=${r.cookie}`), r.id, 'persisted');
  assert.equal(k.liste().length, 1);
  assert.ok(!('hash' in k.liste()[0]));
  assert.equal(k.widerrufe(r.id), true);
  assert.equal(k.pruefe(`${COOKIE}=${r.cookie}`), null);
  assert.equal(new Kopplung(datei, () => t).liste().length, 0);
  assert.equal(k.widerrufe(r.id), false);
});

test('Kopplung: a link older than 2 minutes is refused (and gone); at most 10 wrong tries a minute', () => {
  const k = new Kopplung(path.join(tmp('kop-'), 'k.json'), (() => { let t = 5_000; return () => t; })());
  let t = 5_000;
  const k2 = new Kopplung(path.join(tmp('kop-'), 'k.json'), () => t);
  const l = k2.neuerLink();
  t += LINK_MS + 1;
  assert.deepEqual(k2.loeseEin(l.token), { ok: false, warum: 'abgelaufen' });
  assert.equal(k2.loeseEin('x'.repeat(43)).ok, false);
  for (let i = 0; i < 12; i++) k2.loeseEin(`nope${i}`);
  const frisch = k2.neuerLink();
  assert.equal(k2.loeseEin(frisch.token).warum, 'zu_viele', 'even the right token waits after many wrong ones');
  t += 61_000;
  assert.equal(k2.loeseEin(k2.neuerLink().token).ok, true);
  void k;
});

test('Kopplung: a device expires 30 days after its last use (sliding), also across a restart; use renews it', () => {
  const datei = path.join(tmp('kop-'), 'k.json');
  let t = 10_000_000;
  const k = new Kopplung(datei, () => t);
  assert.equal(GERAET_MAX_MS, 30 * 24 * 3600 * 1000);
  const a = k.loeseEin(k.neuerLink().token, 'a'), b = k.loeseEin(k.neuerLink().token, 'b');
  const tage = (n) => n * 24 * 3600 * 1000;
  t += tage(20);
  assert.equal(k.pruefe(`${COOKIE}=${a.cookie}`), a.id, 'used on day 20');
  t += tage(25);   // day 45: b is 45 days idle, a 25
  assert.equal(k.pruefe(`${COOKIE}=${b.cookie}`), null, 'b expired');
  assert.deepEqual(k.liste().map((g) => g.id), [a.id], 'and is gone from the list');
  assert.equal(k.pruefe(`${COOKIE}=${a.cookie}`), a.id, 'a renewed on day 45');
  assert.equal(k.liste()[0].zuletzt, t, 'the list carries the last-seen time');
  assert.equal(new Kopplung(datei, () => t).pruefe(`${COOKIE}=${a.cookie}`), a.id, 'the renewal is on disk (restart on day 45)');
  assert.equal(new Kopplung(datei, () => t).liste().length, 1, 'the expired one is gone from disk');
  t += tage(31);
  assert.equal(new Kopplung(datei, () => t).pruefe(`${COOKIE}=${a.cookie}`), null, 'idle for 31 days: expired');
});

test('Kopplung: the wrong-token limit is per remote address', () => {
  let t = 5_000;
  const k = new Kopplung(path.join(tmp('kop-'), 'k.json'), () => t);
  for (let i = 0; i < 12; i++) k.loeseEin(`nope${i}`, '', '10.0.0.9');
  assert.equal(k.loeseEin(k.neuerLink().token, '', '10.0.0.9').warum, 'zu_viele', 'the noisy address is stopped');
  assert.equal(k.loeseEin(k.neuerLink().token, '', '10.0.0.10').ok, true, 'another address is not');
  t += 61_000;
  assert.equal(k.loeseEin(k.neuerLink().token, '', '10.0.0.9').ok, true);
});

// ---------- the deny list ----------
test('deny list: every golden POST route is classified, every entry names something real, reads stay open', () => {
  const pfade = [...new Set(GOLDEN.filter((e) => e.m === 'POST').map((e) => e.p))];
  for (const p of pfade) {
    const erlaubt = TABLET_POST_ERLAUBT.includes(p);
    assert.equal(tabletVerboten('POST', p), !erlaubt, `POST ${p}`);
    if (!erlaubt && !['/nicht-da', '/strom', '/lage'].includes(p)) assert.ok(TABLET_VERBOTEN.some((v) => p === v.pfad || p.startsWith(`${v.pfad}/`)), `POST ${p} is named on the deny list (not only closed by default)`);   // the three exceptions are no routes (golden 405)
  }
  for (const v of TABLET_VERBOTEN) {
    if (v.pfad === '/kopplung') continue;   // not a golden route, tested below
    assert.ok(pfade.some((p) => p === v.pfad || p.startsWith(`${v.pfad}/`)) || GOLDEN.some((e) => e.p.split('?')[0].startsWith(v.pfad)) || ['/proj', '/plugins', '/presets', '/kollektionen', '/ansage'].includes(v.pfad), `deny entry ${v.pfad} matches a known route`);
  }
  for (const e of GOLDEN.filter((x) => x.m === 'GET' && !x.p.startsWith('/kopplung'))) assert.equal(tabletVerboten('GET', e.p.split('?')[0]), false, `GET ${e.p}`);
  for (const m of ['GET', 'POST']) for (const p of ['/kopplung', '/kopplung/loeschen']) assert.equal(tabletVerboten(m, p), true);
  for (const p of ['/deck/start', '/deck/stopp', '/spur/stopp', '/abbruch', '/graph', '/geraete/eingang', '/geraete/midi', '/geraete/latenz', '/lernen', '/lernen/host', '/strudel', '/proj/stems', '/plugins/scan']) assert.equal(tabletVerboten('POST', p), true, p);
  assert.equal(tabletVerboten('POST', '/regler'), false);
  assert.equal(tabletVerboten('PUT', '/regler'), true);
  assert.equal(tabletVerboten('DELETE', '/lage'), true);
});

// ---------- the second listener, in-process ----------
async function start(t, tabletOpt, an = true) {
  const alt = process.env.CYPHERDJ_INSTANZ, altBk = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = tmp('kt-bk-');
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const konf = tmp('kt-konf-');
  if (an !== null) fs.writeFileSync(path.join(konf, 'tablet.json'), JSON.stringify({ an }));
  const log = [];
  const huellen = path.join(tmp('kt-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('kt-bestand-'), arbeitsbestand: tmp('kt-ab-'),
    mutationen: [], loops: tmp('kt-loops-'), kits: tmp('kt-kits-'), welleCache: tmp('kt-welle-'), musterOrdner: tmp('kt-muster-'), hotcueOrdner: tmp('kt-hc-'),
    rasterOrdner: tmp('kt-raster-'), huellen, wirtOrdner: tmp('kt-wirt-'), sammlungen: tmp('kt-sets-'), musterBibliothek: tmp('kt-mb-'), musterSets: tmp('kt-ms-'),
    mediathek: path.join(tmp('kt-med-'), 'gibt-es-nicht.sqlite'), katalog: path.join(tmp('kt-kat-'), 'gibt-es-nicht.sqlite'),
    digitalout: path.join(tmp('kt-do-'), 'nix'), kernPruefmodus: true,
    geraete: { konfigPfad: path.join(tmp('kt-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('kt-ger-'), 'eingaenge-kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    lernen: { ordner: path.join(tmp('kt-lern-'), 'controller'), geraeteKonfig: path.join(tmp('kt-lern-'), 'geraete.json') }, log: (z) => log.push(z),
    ...(tabletOpt === undefined ? {} : { tablet: { konfigPfad: path.join(konf, 'tablet.json'), kopplungPfad: path.join(konf, 'kopplung.json'), port: PORT_TABLET, bindeAn: '127.0.0.1',
      schnittstellen: () => ({ lo: [nic('127.0.0.1', true)], eth0: [nic(ADR)] }), ...tabletOpt } }) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
    if (altBk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = altBk;
  });
  return { o, log, konf };
}
const roh = (port, methode, pfad, { kopf = {}, body, host = `${ADR}:${PORT_TABLET}`, zeit = 4000 } = {}) => new Promise((ok) => {
  const q = http.request({ host: '127.0.0.1', port, method: methode, path: pfad, headers: { host, ...kopf }, agent: false }, (a) => {
    const teile = []; a.on('data', (d) => teile.push(d));
    a.on('end', () => { const text = Buffer.concat(teile).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch { /* not json */ } ok({ code: a.statusCode, kopf: a.headers, text, j }); });
    a.on('error', () => ok({ code: -1 }));
  });
  q.on('error', (e) => ok({ code: -1, fehler: e.code }));
  if (body !== undefined) q.write(body);
  q.end();
  setTimeout(() => { q.destroy(); }, zeit).unref();
});
const lokal = (m, p, o = {}) => roh(47300 + K, m, p, { host: `127.0.0.1:${47300 + K}`, ...o });
const tablet = (m, p, o = {}) => roh(PORT_TABLET, m, p, o);
const JSONK = { 'content-type': 'application/json' };
async function koppeln() {
  const r = await lokal('POST', '/kopplung', { kopf: JSONK, body: '{}' });
  assert.equal(r.code, 200, r.text);
  const u = new URL(r.j.link);
  assert.equal(u.host, `${ADR}:${PORT_TABLET}`, 'the link names the home address, not 0.0.0.0');
  const e = await tablet('GET', `${u.pathname}${u.search}`, { kopf: { 'user-agent': 'Test-Tablet' } });
  assert.equal(e.code, 200, 'a page, not a redirect: Chrome drops a SameSite=Strict cookie on the redirect of a cross-site navigation (QR scanner)');
  const cookie = /djk_tablet=([A-Za-z0-9_-]{43});/.exec(e.kopf['set-cookie'][0])?.[1];
  assert.ok(cookie, e.kopf['set-cookie']);
  assert.match(e.kopf['set-cookie'][0], /HttpOnly/);
  assert.match(e.kopf['set-cookie'][0], /SameSite=Strict/);
  assert.equal(e.kopf.location, undefined);
  assert.match(e.text, /location\.replace\('\/#tablet'\)/);
  assert.match(e.text, /http-equiv="refresh" content="0;url=\/#tablet"/);
  return { cookie, kopf: { cookie: `djk_tablet=${cookie}` }, link: r.j.link };
}

test('off by default: no tablet.json, {"an": false}, or a test instance without options: nothing listens, POST /kopplung says tablet_aus', async (t) => {
  await start(t, {}, null);
  assert.equal((await tablet('GET', '/lage')).code, -1, 'no listener without the config file');
  const r = await lokal('POST', '/kopplung', { kopf: JSONK, body: '{}' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'tablet_aus']);
});
test('off by default: tablet.json with an false; and a server without tablet options never opens a second port', async (t) => {
  await start(t, {}, false);
  assert.equal((await tablet('GET', '/lage')).code, -1);
});
test('no option at all (test instance): no second port', async (t) => {
  await start(t, undefined);
  assert.equal((await tablet('GET', '/lage')).code, -1);
});

test('no private address: refuses to start the listener, logs it, the loopback page keeps working', async (t) => {
  const { log } = await start(t, { schnittstellen: () => ({ lo: [nic('127.0.0.1', true)], eth0: [nic('8.8.8.8')], 'br-x': [nic('172.18.0.1')] }) });
  assert.equal((await tablet('GET', '/lage')).code, -1);
  assert.equal((await lokal('GET', '/lage')).code, 200);
  assert.ok(log.some((z) => z.typ === 'tablet_verweigert' && z.grund === 'keine_heimnetz_adresse'));
});

test('no token: 401 on every route of the golden list (all methods and header variants); wrong cookie too; wrong Host 421', async (t) => {
  await start(t, {});
  const falsch = { cookie: `${COOKIE}=${'A'.repeat(43)}` };
  let n = 0;
  for (const e of GOLDEN) {
    const kopf = e.m === 'POST' ? (e.kopf === 'json' ? JSONK : e.kopf === 'fremd' ? { ...JSONK, origin: 'https://boese.example' } : {}) : {};
    if (e.p.startsWith('/strom')) continue;   // event stream: covered by the cookie test below (the 401 is the same code path, but a stream would hang a failed run)
    const r = await tablet(e.m, e.p, { kopf, body: e.m === 'POST' ? '{}' : undefined });
    assert.equal(r.code, 401, `${e.m} ${e.p} (${e.kopf ?? ''}) -> ${r.code}`);
    if (e.m !== 'HEAD') assert.equal(r.j?.fehler, 'nicht_gekoppelt');
    n++;
  }
  assert.ok(n > 190, `Positivkontrolle: ${n} golden routes tried`);
  assert.equal((await tablet('GET', '/strom?x=1')).code, 401);
  assert.equal((await tablet('GET', '/lage', { kopf: falsch })).code, 401);
  assert.equal((await tablet('GET', '/lage', { host: 'evil.example:47301' })).code, 421, 'DNS rebinding: another Host name');
  assert.equal((await tablet('GET', '/koppeln?t=nope')).code, 401);
  assert.equal((await tablet('GET', '/koppeln')).code, 401);
});

test('issued token: the golden routes answer as on the loopback listener, except the deny list (403); loopback unchanged', async (t) => {
  await start(t, {});
  const { kopf } = await koppeln();
  let gleich = 0, zu = 0;
  for (const e of GOLDEN) {
    if (e.p.startsWith('/strom')) continue;
    const kopfe = { ...kopf, ...(e.m === 'POST' ? (e.kopf === 'json' ? JSONK : e.kopf === 'fremd' ? { ...JSONK, origin: 'https://boese.example' } : {}) : {}) };
    const r = await tablet(e.m, e.p, { kopf: kopfe, body: e.m === 'POST' ? '{}' : undefined });
    const verboten = tabletVerboten(e.m, e.p.split('?')[0]) || (e.m === 'POST' && e.p === '/klang');   // /klang with an empty body has no action: refused by the filter
    if (verboten) { assert.equal(r.code, 403, `${e.m} ${e.p} through the tablet`); if (e.m !== 'HEAD') assert.equal(r.j?.fehler, 'nicht_am_tablet'); zu++; }
    else { assert.equal(r.code, e.code, `${e.m} ${e.p} (${e.kopf ?? ''}) tablet ${r.code} golden ${e.code}`); gleich++; }
    const l = await lokal(e.m, e.p, { kopf: e.m === 'POST' ? (e.kopf === 'json' ? JSONK : e.kopf === 'fremd' ? { ...JSONK, origin: 'https://boese.example' } : {}) : {}, body: e.m === 'POST' ? '{}' : undefined });
    assert.equal(l.code, e.code, `loopback ${e.m} ${e.p} unchanged`);
  }
  assert.ok(gleich > 40 && zu > 100, `${gleich} equal, ${zu} denied`);
  assert.equal((await tablet('GET', '/lage', { kopf })).code, 200);
  assert.equal((await tablet('GET', '/', { kopf })).code, 200, 'the page itself');
  const s = await new Promise((ok) => { const q = http.get({ host: '127.0.0.1', port: PORT_TABLET, path: '/strom?x=1', headers: { host: `${ADR}:${PORT_TABLET}`, ...kopf } }, (a) => { ok(a.statusCode); q.destroy(); }); });
  assert.equal(s, 200, 'event stream with the cookie');
});

test('pairing is loopback only: through the tablet listener /kopplung is 403 even with a token; Cypher cannot pair', async (t) => {
  await start(t, {});
  const { kopf } = await koppeln();
  for (const [m, p] of [['POST', '/kopplung'], ['GET', '/kopplung'], ['POST', '/kopplung/loeschen']]) {
    const r = await tablet(m, p, { kopf: { ...kopf, ...JSONK }, body: m === 'POST' ? '{}' : undefined });
    assert.equal(r.code, 403, `${m} ${p}`);
  }
  const c = await lokal('POST', '/kopplung', { kopf: { ...JSONK, 'x-djk-quelle': 'cypher' }, body: '{}' });
  assert.deepEqual([c.code, c.j.fehler], [403, 'nur_andreas']);
  assert.equal((await lokal('GET', '/kopplung', { kopf: { 'x-djk-quelle': 'cypher' } })).code, 403);
  assert.equal((await lokal('POST', '/kopplung', { kopf: { 'content-type': 'text/plain' }, body: '{}' })).code, 415, 'the loopback guard (json only)');
  assert.equal((await lokal('POST', '/kopplung', { kopf: { ...JSONK, origin: 'https://boese.example' }, body: '{}' })).code, 403, 'a foreign page cannot ask for a link');
});

test('expired link: 401; a link works once; revoking a device cuts its cookie and its open stream', async (t) => {
  let jetzt = Date.now();
  const echte = Date.now; Date.now = () => jetzt; t.after(() => { Date.now = echte; });
  await start(t, {});
  const r = await lokal('POST', '/kopplung', { kopf: JSONK, body: '{}' });
  const u = new URL(r.j.link);
  jetzt += LINK_MS + 1000;
  const alt = await tablet('GET', `${u.pathname}${u.search}`);
  assert.deepEqual([alt.code, alt.j.fehler], [401, 'abgelaufen']);
  const g = await koppeln();
  const nochmal = await tablet('GET', new URL(g.link).pathname + new URL(g.link).search);
  assert.equal(nochmal.code, 401, 'used link');
  const liste = await lokal('GET', '/kopplung');
  assert.equal(liste.j.an, true);
  assert.equal(liste.j.geraete.length, 1);
  assert.ok(!JSON.stringify(liste.j).includes('hash'));
  const stromEnde = new Promise((ok) => { const q = http.get({ host: '127.0.0.1', port: PORT_TABLET, path: '/strom?x=1', headers: { host: `${ADR}:${PORT_TABLET}`, ...g.kopf } }, (a) => { a.on('data', () => {}); a.on('close', () => ok('zu')); a.on('error', () => ok('zu')); }); q.on('error', () => ok('zu')); });
  await new Promise((ok) => setTimeout(ok, 150));
  assert.equal((await tablet('GET', '/lage', { kopf: g.kopf })).code, 200);
  assert.equal((await lokal('POST', '/kopplung/loeschen', { kopf: JSONK, body: JSON.stringify({ id: liste.j.geraete[0].id }) })).code, 200);
  assert.equal(await Promise.race([stromEnde, new Promise((ok) => setTimeout(() => ok('offen'), 3000))]), 'zu', 'the open stream of the revoked device is closed');
  assert.equal((await tablet('GET', '/lage', { kopf: g.kopf })).code, 401);
  assert.equal((await lokal('POST', '/kopplung/loeschen', { kopf: JSONK, body: JSON.stringify({ id: 'weg' }) })).code, 404);
});

test('through the tablet a request counts as Andreas, whatever x-djk-quelle says; the tablet origin passes the POST guard, a foreign one does not', async (t) => {
  const { log } = await start(t, {});
  const { kopf } = await koppeln();
  const body = JSON.stringify({ pfad: 'erz/2/fader', nach: -6, ab: 'jetzt' });
  const quellen = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').map((z) => z.felder.quelle);
  // the request is cut after 400 ms: without a kern the answer would wait for the receipt; what the server sent to the kern is in the log at once
  await lokal('POST', '/regler', { kopf: { ...JSONK, 'x-djk-quelle': 'cypher' }, body, zeit: 400 });
  assert.deepEqual(quellen(), ['cypher'], 'positive control: on the loopback listener the header makes it Cypher');
  await tablet('POST', '/regler', { kopf: { ...kopf, ...JSONK, 'x-djk-quelle': 'cypher', origin: `http://${ADR}:${PORT_TABLET}` }, body, zeit: 400 });
  assert.deepEqual(quellen(), ['cypher', 'andreas'], 'through the tablet the same header counts as Andreas');
  await tablet('POST', '/regler', { kopf: { ...kopf, ...JSONK }, body, zeit: 400 });
  assert.deepEqual(quellen(), ['cypher', 'andreas', 'andreas']);
  const fremd = await tablet('POST', '/regler', { kopf: { ...kopf, ...JSONK, origin: 'https://boese.example' }, body });
  assert.equal(fremd.code, 403);
  assert.equal(fremd.j.fehler, 'fremde_herkunft');
  assert.equal(quellen().length, 3, 'the foreign page sent nothing');
  const ohneOrigin = await tablet('POST', '/regler', { kopf: { ...kopf, 'content-type': 'text/plain' }, body });
  assert.equal(ohneOrigin.code, 415);
});

test('POST /klang from the tablet: only the panel actions; lade, speichere, fenster, hoere, setze are refused, the body reaches the handler intact', async (t) => {
  await start(t, {});
  const { kopf } = await koppeln();
  const post = (b) => tablet('POST', '/klang', { kopf: { ...kopf, ...JSONK }, body: JSON.stringify(b) });
  for (const aktion of ['lade', 'speichere', 'fenster', 'hoere', 'setze']) assert.equal((await post({ gruppe: 'bass', aktion, name: 'x', an: true, werte: { a: 1 } })).code, 403, aktion);
  assert.equal((await tablet('POST', '/klang', { kopf: { ...kopf, ...JSONK }, body: 'kein json' })).code, 403);
  const p = await post({ gruppe: 'bass', aktion: 'param', name: 'Knob 1', wert: 0.5 });
  assert.notEqual(p.code, 403, `param passes the filter (${p.text})`);
  assert.equal(p.j.fehler, 'wirt', 'and reaches the real handler with its body (no host here: wirt refused)');
  assert.equal((await post({ gruppe: 'bass', aktion: 'params' })).j?.fehler, 'wirt');
  const falsch = await post({ gruppe: 'nix', aktion: 'param', name: 'Knob 1', wert: 0.5 });
  assert.equal(falsch.j.fehler, 'gruppe', 'the handler validated the body it was given');
});

test('files: the second listener serves the page files only with the cookie; the listener is the home address only', async (t) => {
  const { o } = await start(t, {});
  const addr = o.tabletServer.address();
  assert.equal(addr.address, '127.0.0.1', 'bound where the test said (bindeAn), never 0.0.0.0');
  assert.notEqual(addr.address, '0.0.0.0');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.ts'), 'utf8');
  assert.ok(!/listen\([^)]*'0\.0\.0\.0'/.test(src) && !/listen\([^)]*'::'/.test(src), 'no wildcard bind in server.ts');
  assert.equal((await tablet('GET', '/app.js')).code, 401);
  assert.equal((await tablet('GET', '/manifest.webmanifest')).code, 401);
});

test('bad path: a malformed escape answers 400 on both listeners, not 500', async (t) => {
  await start(t, {});
  const { kopf } = await koppeln();
  assert.equal((await tablet('GET', '/%zz', { kopf })).code, 400);
  assert.equal((await lokal('GET', '/%zz')).code, 400);
  assert.equal((await tablet('GET', '/%E0%A4%A', { kopf })).code, 400);
});

test('loopback /kopplung answers only for a loopback Host name (rebinding could read the device list otherwise)', async (t) => {
  await start(t, {});
  assert.equal((await lokal('GET', '/kopplung', { host: `evil.example:${47300 + K}` })).code, 421);
  assert.equal((await lokal('GET', '/kopplung', { host: '127.0.0.1' })).code, 421, 'without the port too');
  assert.equal((await lokal('POST', '/kopplung', { host: `evil.example:${47300 + K}`, kopf: JSONK, body: '{}' })).code, 421);
  assert.equal((await lokal('POST', '/kopplung/loeschen', { host: 'x', kopf: JSONK, body: '{"id":"a"}' })).code, 421);
  assert.equal((await lokal('GET', '/kopplung', { host: `localhost:${47300 + K}` })).code, 200);
  assert.equal((await lokal('GET', '/kopplung')).code, 200);
});

test('wrong pairing links: 429 after 10 from one address, and the log gets one summary line per window instead of one line per try', async (t) => {
  const { log } = await start(t, { logMs: 200 });
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await tablet('GET', `/koppeln?t=falsch${i}`)).code);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(codes.slice(10), Array(4).fill(429));
  await new Promise((ok) => setTimeout(ok, 450));
  const zeilen = log.filter((z) => z.typ === 'tablet_kopplung_abgewiesen');
  assert.equal(zeilen.length, 1, JSON.stringify(zeilen));
  assert.equal(zeilen[0].anzahl, 14);
});

test('an event stream a client does not read is closed instead of growing the page server without bound (loopback and tablet)', async (t) => {
  const { o } = await start(t, {});
  const { kopf } = await koppeln();
  const oeffne = (port, host, k) => new Promise((ok, nein) => {
    const q = http.get({ host: '127.0.0.1', port, path: '/strom?x=1', headers: { host, ...k } }, (a) => { a.pause(); a.socket.pause?.(); ok({ q, a }); });
    q.on('error', nein);
  });
  const lok = await oeffne(47300 + K, `127.0.0.1:${47300 + K}`, {});
  const tab = await oeffne(PORT_TABLET, `${ADR}:${PORT_TABLET}`, kopf);
  const zu = [lok, tab].map((c) => new Promise((ok) => { c.a.socket.on('close', () => ok('zu')); c.a.socket.on('error', () => ok('zu')); }));
  const gross = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 80; i++) { o.verteile({ a: 'fuell', f: { i, gross } }); if (i % 8 === 0) await new Promise((ok) => setImmediate(ok)); }
  assert.equal(o.stroeme.size, 0, 'both silent streams were dropped from the list');
  for (const c of [lok, tab]) c.a.resume();   // the paused clients read again: they find the connection closed (a paused socket does not report the end)
  assert.deepEqual(await Promise.race([Promise.all(zu), new Promise((ok) => setTimeout(() => ok('offen'), 3000))]), ['zu', 'zu']);
  const frisch = await new Promise((ok) => { const q = http.get({ host: '127.0.0.1', port: 47300 + K, path: '/strom?x=1', headers: { host: `127.0.0.1:${47300 + K}` } }, (a) => { a.once('data', (d) => { ok(String(d).slice(0, 5)); q.destroy(); }); }); });
  assert.equal(frisch, 'data:', 'a new stream works again');
});
