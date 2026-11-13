// check/rec_inserts.mjs (1.8 T1a): the option parsing of the proof scripts and the chain helper against a fake project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseInserts, kettenText, baueInserts, INSERT_POOL } from '../check/rec_inserts.mjs';

test('leseInserts: no option means no chain, a track number alone is refused', () => {
  assert.equal(leseInserts({}), null);
  assert.throws(() => leseInserts({ 'inserts-spur': '2' }), /needs --inserts/);
});
test('leseInserts: names from the pool, order kept, spaces trimmed, track default null', () => {
  assert.deepEqual(leseInserts({ inserts: 'eq, saett,lim' }), { namen: ['eq', 'saett', 'lim'], spur: null });
  assert.deepEqual(leseInserts({ inserts: 'komp', 'inserts-spur': '3' }), { namen: ['komp'], spur: 3 });
  for (const n of INSERT_POOL) assert.deepEqual(leseInserts({ inserts: n }).namen, [n]);
});
test('leseInserts: unknown name, empty entry, too long, bad track number all throw', () => {
  assert.throws(() => leseInserts({ inserts: 'eq,hall' }), /unknown insert hall/);
  assert.throws(() => leseInserts({ inserts: 'eq,,lim' }), /empty name/);
  assert.throws(() => leseInserts({ inserts: '' }), /empty name/);
  assert.throws(() => leseInserts({ inserts: 'eq,eq,eq,eq,eq,eq' }), /at most 5/);
  for (const s of ['0', '-1', 'x', '1.5']) assert.throws(() => leseInserts({ inserts: 'eq', 'inserts-spur': s }), /track number/);
});

// A fake z with just enough of the project: spur_neu and insert_setzen are applied to a list of tracks.
function fakeZ(spuren, { verschluckeInserts = false } = {}) {
  const zeilen = [];
  const z = {
    zeilen,
    aktuell: async () => ({ projekt: { spuren: structuredClone(spuren) } }),
    aendern: async (label, befehle) => {
      for (const b of befehle) {
        if (b.befehl === 'spur_neu') spuren.push({ id: `s${spuren.length + 1}`, name: b.name, inserts: [] });
        if (b.befehl === 'insert_setzen' && !verschluckeInserts) spuren.find((s) => s.id === b.strang_id).inserts.splice(b.pos, 0, { art: b.art });
      }
    },
    geladen: async () => {},
    info: (t) => zeilen.push(`INFO ${t}`),
    notiere: (kz, ok, text) => zeilen.push(`${ok ? 'OK' : 'FEHL'} ${kz}: ${text}`),
  };
  return z;
}
test('kettenText: names in chain order, none for an empty or missing chain', () => {
  assert.equal(kettenText({ inserts: [{ art: 'eq' }, { art: 'lim' }] }), 'eq,lim');
  assert.equal(kettenText({ inserts: [] }), 'none');
  assert.equal(kettenText({}), 'none');
});
test('baueInserts: default target is a new unarmed track, the armed one stays empty', async () => {
  const sp = [{ id: 's1', name: 'In', inserts: [] }];
  const z = fakeZ(sp);
  const r = await baueInserts(z, { namen: ['eq', 'saett', 'lim'], spur: null }, 's1', 'x');
  assert.equal(sp.length, 2);
  assert.deepEqual(r, { spurId: 's2', kette: ['eq', 'saett', 'lim'] });
  assert.equal(kettenText(sp[0]), 'none');
  assert.ok(z.zeilen.some((l) => l.startsWith('OK ')) && !z.zeilen.some((l) => l.startsWith('FEHL')));
});
test('baueInserts: first unarmed track is taken when there is one, explicit track number wins', async () => {
  const sp = [{ id: 's1', name: 'A', inserts: [] }, { id: 's2', name: 'B', inserts: [] }, { id: 's3', name: 'C', inserts: [] }];
  await baueInserts(fakeZ(sp), { namen: ['eq'], spur: null }, 's1', 'x');
  assert.deepEqual([sp[0], sp[1], sp[2]].map(kettenText), ['none', 'eq', 'none']);
  await baueInserts(fakeZ(sp), { namen: ['lim'], spur: 3 }, 's1', 'x');
  assert.equal(kettenText(sp[2]), 'lim');
  await assert.rejects(baueInserts(fakeZ(sp), { namen: ['lim'], spur: 9 }, 's1', 'x'), /has 3 track/);
});
test('baueInserts: a chain that did not arrive is a FEHL line (the check can fail)', async () => {
  const z = fakeZ([{ id: 's1', name: 'In', inserts: [] }], { verschluckeInserts: true });
  await baueInserts(z, { namen: ['eq'], spur: null }, 's1', 'x');
  assert.ok(z.zeilen.some((l) => l.startsWith('FEHL ')));
});
test('baueInserts: no option, nothing happens', async () => {
  const sp = [{ id: 's1', name: 'In', inserts: [] }];
  assert.equal(await baueInserts(fakeZ(sp), null, 's1', 'x'), null);
  assert.equal(sp.length, 1);
});
