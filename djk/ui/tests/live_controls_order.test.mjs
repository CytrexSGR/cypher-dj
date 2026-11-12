// Review fix 2/3: in the live container the rows that make something louder (freed numbers reset to 0, unmute) and the mute of the Loop track
// go out only AFTER /k/arr/laden, so the old playback never plays unmuted at 0 dB and the stems sound before the Loop falls silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { baueModul } from '../project/live.ts';
import { aendereStand } from '../project/state.ts';
import { teileReglerLive } from '../project/controls_order.ts';

const aus = (z) => z.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden' || (g.adresse === '/k/teil' && /^(spur|grp)\//.test(g.felder.pfad)))
  .map((g) => g.adresse === '/k/arr/laden' ? 'LADEN' : `${g.felder.pfad}=${g.felder.nach}`);

test('clear: the reset rows of the freed numbers follow /k/arr/laden', async (t) => {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  const p = z.projekt(), g = z.gruppeVon(p, 'A'), nrG = g.nr, nrS = p.spuren.find((s) => s.ausgang?.id === g.id).nr;
  await z.aendern([{ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: -6 }]);
  z.protokoll.gesendet.length = 0;
  const r = await z.l.leere({ slot: 'A', takte: 0 }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = aus(z), laden = f.indexOf('LADEN');
  assert.ok(laden >= 0, f.join(' '));
  const reset = [`grp/${nrG}/fader=0`, `spur/${nrS}/fader=0`, `spur/${nrS}/mute=0`];
  for (const x of reset) { const i = f.lastIndexOf(x); assert.ok(i > laden, `${x} must come after LADEN: ${f.join(' ')}`); }
  assert.ok(f.slice(0, laden).includes(`grp/${nrG}/fader=-200`), 'the ramp row (quieter) is before the load');
});

test('stems arrive: Loop mute goes out after /k/arr/laden', async (t) => {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  const p = z.projekt(), top = z.gruppeVon(p, 'A'), loopSpur = p.spuren.find((s) => s.ausgang?.id === top.id);
  const clip = loopSpur.clips[0];
  const datei = { sha256: clip.quelle.sha256, pfad: clip.quelle.pfad_hinweis };
  const { slot: _s, ...herkunft } = top.modul;
  const neu = baueModul(p, 'A', { ...datei, beats: 4, frames: z.deck.frames }, { drums: datei }, herkunft);
  z.protokoll.gesendet.length = 0;
  const meta = { quelle: 'andreas', label: 'Stems module A' };
  await z.zugang.uebernimm(aendereStand(z.offen().verlauf, p, neu, meta, z.zugang.haken()), meta);
  const f = aus(z), laden = f.indexOf('LADEN');
  assert.ok(laden >= 0, f.join(' '));
  assert.ok(f.lastIndexOf(`spur/${loopSpur.nr}/mute=1`) > laden, `Loop mute after LADEN: ${f.join(' ')}`);
});

test('teileReglerLive: lower rows first, louder and mute of a sounding track after', () => {
  const alt = { spuren: [{ nr: 1, fader_db: -3, pan: 0, mute: false, solo: false }, { nr: 2, fader_db: 0, pan: 0, mute: true, solo: false }],
    gruppen: [{ nr: 1, fader_db: 0, pan: 0, mute: false, solo: false }] };
  const { vorher, nachher } = teileReglerLive(alt, [
    { pfad: 'spur/1/fader', wert: -9 }, { pfad: 'spur/1/mute', wert: 1 }, { pfad: 'spur/2/mute', wert: 0 },
    { pfad: 'grp/1/fader', wert: -200 }, { pfad: 'spur/7/mute', wert: 1 }, { pfad: 'pm/fader', wert: 3 }, { pfad: 'spur/3/pan', wert: 0.5 }]);
  assert.deepEqual(vorher.map((x) => x.pfad), ['spur/1/fader', 'grp/1/fader', 'spur/7/mute', 'pm/fader', 'spur/3/pan']);
  assert.deepEqual(nachher.map((x) => x.pfad), ['spur/1/mute', 'spur/2/mute']);
});

test('flat project: the order stays as it was, the reset rows of a removed track go out BEFORE /k/arr/laden', async (t) => {
  const { aufbau } = await import('./support/output_setup.mjs');
  const r = await aufbau(t, { mitKick: false });
  assert.notEqual(r.projekt().live, true);
  const nr = r.lead().nr;
  r.protokoll.gesendet.length = 0;
  await r.vorbei([{ befehl: 'spur_loeschen', spur_id: 's3' }]);
  const f = r.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden' || (g.adresse === '/k/teil' && /^spur\//.test(g.felder.pfad)))
    .map((g) => g.adresse === '/k/arr/laden' ? 'LADEN' : `${g.felder.pfad}=${g.felder.nach}`);
  const laden = f.indexOf('LADEN');
  assert.ok(laden > 0, f.join(' '));
  assert.ok(f.slice(0, laden).includes(`spur/${nr}/fader=0`), `reset before LADEN as before: ${f.join(' ')}`);
});
