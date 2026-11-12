// 1.10 slice 3 (P11): opening a project sets up to 379 controls (before slice 4; 1591 with the 1178 insert rows (arr-fx slices 1 and 2, arr-bk 520) and the 48 rack rows (slice 4c); 686 before arr-fx). The stellwerk holds at most MAX_TEILE = 256 open parts, so the controls go out in packets
// of at most 100 and each packet is waited for until its END status. The stub models the limit (tests/support/proj_context.mjs, teileMax).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefKontext, sitzung } from './support/proj_context.mjs';
import { alleRegler } from '../areas/proj/mapping.ts';
import { REGLER_PAKET } from '../areas/proj/core_path.ts';

const MAX_TEILE = 256;

// a project at the maximum with moved values everywhere: 32 tracks (faders moved), 4 returns, 64 sends, 8 groups
async function maxProjekt(s) {
  const befehle = [];
  for (let i = 0; i < 32; i++) befehle.push({ befehl: 'spur_neu', art: 'audio' });
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'tracks', befehle }, 'andreas');
  const b2 = [];
  for (let g = 0; g < 8; g++) b2.push({ befehl: 'gruppenspur_neu', mitglieder: [`s${g * 4 + 1}`, `s${g * 4 + 2}`] });
  for (let r = 0; r < 4; r++) b2.push({ befehl: 'return_neu' });
  for (let i = 1; i <= 32; i++) b2.push({ befehl: 'spur_aendern', spur_id: `s${i}`, fader_db: -1 - (i % 5), solo: i % 3 === 0 });
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'groups', befehle: b2 }, 'andreas');
  const b3 = [];
  for (let i = 1; i <= 16; i++) for (let r = 1; r <= 4; r++) b3.push({ befehl: 'send_setzen', strang_id: `s${i}`, return_id: `r${r}`, db: -10 });
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'sends', befehle: b3 }, 'andreas');
}

async function oeffneMax(t, opt = {}, kont = {}) {
  const k = pruefKontext({ teileMax: MAX_TEILE, ...kont });
  const { s } = sitzung(t, opt, k);
  await s.neu('Max', 'andreas');
  k.mitModell = false;                                              // the set-up edits are not under test
  await maxProjekt(s);
  k.mitModell = true;
  k.leere(); k.offen.clear(); k.teileVoll = 0; k.voll.clear();
  const t0 = Date.now();
  const r = await s.oeffnen('max', 'andreas');
  return { k, s, r, ms: Date.now() - t0 };
}

test('slice 3 open at the maximum: all controls go out in packets, none meets a full stellwerk, every one ends with status 3', async (t) => {
  const { k, r } = await oeffneMax(t);
  const soll = alleRegler(r.j.projekt).length;
  assert.equal(soll, 365 + 1178 + 48, '365 mixer controls plus the 1178 pooled insert rows (120 komp, 8 x 59 eq, 4 x 4 saett, 2 x 3 lim, 4 host, 8 x 5 utility, 8 x 65 bk) plus the 48 rack rows');
  assert.equal(k.teile(/^(spur|grp|pm|ret)\//).length, soll - 1178 - 48, 'every mixer control was sent');
  assert.equal(k.teile(/^ins\//).length, 1178, 'and every insert row');
  assert.equal(k.teile(/^rack\//).length, 48, 'and every rack macro row');
  assert.equal(k.teileVoll, 0, 'the stellwerk never overflowed');
  assert.equal(r.j.kern.regler_fehler.length, 0);
  assert.equal(r.j.kern.regler_nicht_gesendet, 0);
  assert.equal(r.j.kern.regler, soll + 24, 'with the 24 erz/4 controls');
  assert.equal(k.teile().length, soll + 24);
  assert.ok(k.offen.size === 0, `no slot stays open (${k.offen.size})`);
  assert.ok(REGLER_PAKET <= 100);
});

test('slice 3 open: the single-slot model (before) overflows without packets; negative controls: packet size 300 and no end-status wait are red', async (t) => {
  const ohnePakete = await oeffneMax(t, { kernWeg: { paket: 100000 } });
  assert.ok(ohnePakete.k.teileVoll > 0, `without packets the stellwerk is full (${ohnePakete.k.teileVoll} refused)`);
  assert.ok(ohnePakete.r.j.kern.regler_fehler.length > 0, 'and the open reports the refused controls');
  const gross = await oeffneMax(t, { kernWeg: { paket: 300 } });
  assert.ok(gross.k.teileVoll > 0, `packet size 300 (mutation) overflows too (${gross.k.teileVoll} refused)`);
  const ohneEnde = await oeffneMax(t, { kernWeg: { bisEnde: false } });
  assert.ok(ohneEnde.k.teileVoll > 0, `waiting only for the first status leaves the slots open (${ohneEnde.k.teileVoll} refused)`);
});

test('slice 3 open: 41 fader ramps, 114 solo parts and 128 send ramps (283 parts) arrive complete, unlimited packets do not', async (t) => {
  const kont = {};
  const { k, r } = await oeffneMax(t, {}, kont);
  // 283 > MAX_TEILE: the project at the maximum moves 41 faders, 114 solos and 128 sends away from their defaults
  const bewegt = alleRegler(r.j.projekt).filter((x) => /\/fader$/.test(x.pfad) && x.wert !== 0).length
    + alleRegler(r.j.projekt).filter((x) => /\/solo$/.test(x.pfad) && x.wert !== 0).length + alleRegler(r.j.projekt).filter((x) => /\/send\//.test(x.pfad) && x.wert > -200).length;
  assert.ok(bewegt > 0);
  assert.equal(k.teileVoll, 0);
  assert.equal(k.teile(/^(spur|grp|pm|ret)\//).length, 365);
  const unbegrenzt = await oeffneMax(t, { kernWeg: { paket: 1e9 } });
  assert.ok(unbegrenzt.k.teile(/^(spur|grp|pm|ret)\//).length >= 365 && unbegrenzt.k.teileVoll > 0, 'negative control: unlimited packets are refused in part');
});

test('slice 3 open abort: a rejected control in packet 2 stops the open, packets 3 and 4 are not sent; the second open heals', async (t) => {
  const k = pruefKontext({ teileMax: MAX_TEILE });
  const { s } = sitzung(t, { arrFristMs: 30 }, k);
  await s.neu('Ab', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const reihenfolge = alleRegler(s.aktuell().j.projekt);
  const ziel = reihenfolge[150].pfad;                                 // packet 2 holds the controls 100..199
  let ablehnen = true;
  k.regel = (adr, f) => (adr === '/k/teil' && f.pfad === ziel && ablehnen ? { status: 6, grund: 'teile_voll' } : { status: 3, grund: '' });
  k.leere(); k.offen.clear();
  const r = await s.oeffnen('ab', 'andreas');
  const gesendet = k.teile().length;
  assert.equal(gesendet, 200, `packets 1 and 2 only (${gesendet})`);
  assert.deepEqual(r.j.kern.regler_fehler.map((x) => x.pfad), [ziel]);
  assert.equal(r.j.kern.regler_nicht_gesendet, 1615 - 200, 'the open names how many were not sent');
  ablehnen = false;
  k.leere(); k.offen.clear();
  const r2 = await s.oeffnen('ab', 'andreas');
  assert.equal(k.teile().length, 1615, 'the second open sets all');
  assert.equal(r2.j.kern.regler_nicht_gesendet, 0);
  assert.equal(r2.j.kern.regler_fehler.length, 0);
});

test('slice 3 open without a core: the open ends within twice the time limit, not once per packet (no answer in packet 1 stops it)', async (t) => {
  const k = pruefKontext({ teileMax: MAX_TEILE });
  const { s } = sitzung(t, { arrFristMs: 30 }, k);
  await s.neu('Kein', 'andreas');
  k.regel = () => null;
  k.leere();
  const t0 = Date.now();
  const r = await s.oeffnen('kein', 'andreas');
  const ms = Date.now() - t0;
  assert.equal(r.j.kern.regler_fehler.length, 0);
  assert.equal(r.j.kern.regler_ohne_kern, 100, 'only packet 1 was tried');
  assert.equal(r.j.kern.regler_nicht_gesendet, 1615 - 100);
  assert.ok(ms < 200, `the open took ${ms} ms`);
});
