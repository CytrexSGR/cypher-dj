// Plan studio-taktart T3: the live loop region and the SEQ pattern bar maths follow the project meter n/4 (region 16 bars = 16n beats; the stored
// 64-beat content stays valid). With 4/4 nothing changes: see taktart_4_seq.test.mjs (golden recorded on the unchanged code).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { alsAntwort } from '../areas/proj/area.ts';
import { SeqBereich } from '../areas/live/seq.ts';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { seqFolgen, seqGruppe } from '../project/seq.ts';
import { baueModul } from '../project/live.ts';
import { leseFolgeText, folgeBefehle, schreibeFolgeText, laengeTextTakt } from '../project/seq_text.ts';

const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'kick' }, { ton: 38, name: 'snare' }, { ton: 42, name: 'hat' }] };
const info = () => INFO_KIT;
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const mitTakt = (n) => { const p = neuesProjekt('x'); p.live = true; return lauf(p, { befehl: 'taktart_setzen', taktart: [n, 4] }); };
const deck = (n) => lauf(mitTakt(n), { befehl: 'seq_anlegen', platz: 2 });
const kit = { art: 'intern', name: 'kit', kit: '909' };
const clipVon = (p, L) => { const s = p.spuren[0]; return lauf(lauf(p, { befehl: 'clip_loeschen', clip_id: s.clips[0].id }),
  { befehl: 'clip_neu', spur_id: s.id, art: 'midi', start_beat: 0, laenge_beats: L, name: 'c' }); };

test('3/4 project: a new pattern clip gets laenge_beats 48; 4/4 and 12/4: 64 and 192', () => {
  for (const [n, soll] of [[3, 48], [4, 64], [12, 192]]) {
    const p0 = deck(n);
    const p = lauf(p0, { befehl: 'seq_folge_neu', gruppe_id: seqGruppe(p0, 2).id, name: 'P', geraet: kit });
    assert.equal(p.spuren[0].clips[0].laenge_beats, soll, `${n}/4`);
  }
});

test('3/4: an existing 64-beat clip and a 48-beat clip are editierbar, a 50-beat clip is not (no migration)', () => {
  const p0 = deck(3);
  const p1 = lauf(p0, { befehl: 'seq_folge_neu', gruppe_id: seqGruppe(p0, 2).id, name: 'P', geraet: kit });
  const ed = (L) => { const q = clipVon(p1, L); return seqFolgen(q, seqGruppe(q, 2))[0].editierbar; };
  assert.deepEqual([ed(64), ed(48), ed(50)], [true, true, false]);
});

test('4/4: only 64 is editierbar (48 is not); 12/4: 192 and 64', () => {
  const mk = (n) => { const p0 = deck(n); return lauf(p0, { befehl: 'seq_folge_neu', gruppe_id: seqGruppe(p0, 2).id, name: 'P', geraet: kit }); };
  const ed = (p, L) => { const q = clipVon(p, L); return seqFolgen(q, seqGruppe(q, 2))[0].editierbar; };
  assert.deepEqual([ed(mk(4), 64), ed(mk(4), 48)], [true, false]);
  assert.deepEqual([ed(mk(12), 192), ed(mk(12), 64), ed(mk(12), 48)], [true, true, false]);
});

test('seq_text: a bar is the beats per bar; 3/4: 2bar is 6 beats and 6 beats are written back as 2bar; default is 4', () => {
  const f3 = leseFolgeText('folge x kit:909 2bar', 3);
  assert.ok(Array.isArray(f3), JSON.stringify(f3));
  assert.equal(f3[0].kopf.beats, 6);
  assert.equal(leseFolgeText('folge x kit:909 2bar')[0].kopf.beats, 8);
  assert.equal(leseFolgeText('folge x kit:909 3/4bar', 3)[0].kopf.beats, 2.25);
  assert.equal(laengeTextTakt(6, 3), '2bar');
  assert.equal(laengeTextTakt(1.5, 3), '1/2bar');
  assert.equal(laengeTextTakt(6, 4), '6b');
  assert.equal(laengeTextTakt(8, 4), '2bar');
});

test('seq_text 12/4: a 192-beat pattern is accepted, 3/4 and 4/4 refuse beyond 64 beats', () => {
  assert.ok(Array.isArray(leseFolgeText('folge x kit:909 16bar', 12)));
  assert.ok(!Array.isArray(leseFolgeText('folge x kit:909 17bar', 12)));
  assert.ok(Array.isArray(leseFolgeText('folge x kit:909 21bar', 3)), '63 beats');
  assert.ok(!Array.isArray(leseFolgeText('folge x kit:909 22bar', 3)), '66 beats');
  assert.ok(!Array.isArray(leseFolgeText('folge x kit:909 17bar')));
});

test('seq_text round trip in 3/4: a text with bar units plans, applies and reads back as the same text; the new clip is 48 beats', () => {
  const p0 = deck(3);
  const gid = seqGruppe(p0, 2).id;
  const text = 'folge drums  kit:909  2bar\nnoten kick 36   1/16  x..x..x..x.. | x..x..x..x..\nkurve pan         sinus .2 .8 je 1bar';
  const folgen = leseFolgeText(text, 3);
  assert.ok(Array.isArray(folgen), JSON.stringify(folgen));
  const b = folgeBefehle(p0, gid, folgen, { stumm: false, geraetInfo: info });
  const p1 = lauf(p0, ...b);
  assert.equal(p1.spuren[0].clips[0].laenge_beats, 48);
  assert.equal(p1.spuren[0].clips[0].loop_beats, 6);
  const s = p1.spuren[0];
  const zurueck = schreibeFolgeText(s, s.clips[0], info(), 3);
  assert.match(zurueck, /^folge drums {2}kit:909 {2}2bar\n/);
  assert.match(zurueck, /je 1bar/);
  assert.deepEqual(folgeBefehle(p1, gid, leseFolgeText(zurueck, 3), { stumm: false, geraetInfo: info }), []);
});

async function aufbau(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-taktart-seq-'));
  const kitO = path.join(tmp, 'kits'), bkO = path.join(tmp, 'bk');
  fs.mkdirSync(bkO); fs.mkdirSync(path.join(kitO, '909'), { recursive: true });
  fs.writeFileSync(path.join(kitO, '909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'kick', datei: 'k.wav' }] }));
  const vorher = { bk: process.env.CYPHERDJ_BK_ORDNER, kit: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.CYPHERDJ_BK_ORDNER = bkO; process.env.CYPHERDJ_KIT_ORDNER = kitO;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher.bk], ['CYPHERDJ_KIT_ORDNER', vorher.kit]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const z = await liveAufbau(t);
  const seq = new SeqBereich(z.ctx, z.zugang, { deckLaeuft: () => false, geraetInfo: info, kanalOffen: () => false });
  return { z, seq };
}

test('route 3/4: the clip_neu guard takes 48 and 64 beats and refuses 50 and 32; the pattern text route reads bars of 3', async (t) => {
  const { z, seq } = await aufbau(t);
  await z.aendern([{ befehl: 'taktart_setzen', taktart: [3, 4] }]);
  await seq.anlege({ platz: 2 }, 'andreas');
  const ok = async (f) => { try { return await f(); } catch (e) { assert.fail(JSON.stringify(alsAntwort(e, z.ctx).j)); } };
  await ok(() => seq.folge({ platz: 2, name: 'Drums', geraet: 'kit:909', loop_beats: 3 }, 'andreas'));
  const spur = () => z.projekt().spuren.find((s) => s.name === 'Drums');
  assert.equal(spur().clips[0].laenge_beats, 48);
  const versuch = async (L) => {
    try { return (await seq.befehle({ platz: 2, befehle: [{ befehl: 'clip_neu', spur_id: spur().id, art: 'midi', start_beat: 0, laenge_beats: L }] }, 'andreas')).code; }
    catch (e) { const a = alsAntwort(e, z.ctx); assert.match(a.j.text, /pattern clip/); return a.code; }
  };
  const r = await ok(() => seq.text({ platz: 2, text: 'folge Drums  kit:909  2bar\nnoten kick 36  1/16  x..x..x..x.. | x..x..x..x..' }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(spur().clips[0].loop_beats, 6, '2bar in 3/4');
  assert.equal(await versuch(50), 400);
  assert.equal(await versuch(32), 400);
  assert.equal(await versuch(48), 200);
  assert.equal(await versuch(64), 200);
});

test('live loop: a module built in a 3/4 project fills 48 beats, in 4/4 64', () => {
  const D = { sha256: 'e'.repeat(64), pfad: '/x/e.wav' };
  const herkunft = { quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
    tonart: '8A', datum: '2026-11-12' };
  const laenge = (p) => p.spuren.find((s) => s.name === 'Loop').clips.at(-1).laenge_beats;
  const loop = { ...D, beats: 16, frames: 16 * 24000 };
  const m = (n) => baueModul(mitTakt(n), 'A', loop, {}, herkunft);
  assert.deepEqual([laenge(m(3)), laenge(m(4)), laenge(m(12))], [48, 64, 192]);
});
