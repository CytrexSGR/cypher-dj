// The current value of a learned Baukasten knob in GET /lernen (areas/learn/value.ts): a track knob from the project, a live-channel knob from the kern's reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wertVon } from '../areas/learn/value.ts';

test('wertVon: track knob from the project (default 0.5, clamped), channel knob from the last report, other paths none', () => {
  const projekt = { spuren: [{ id: 's1', name: 'Lead', nr: 1, geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: { k3: 0.25, k4: 7, k5: 'x' } } },
    { id: 's2', name: 'Audio', nr: 2 }] };
  const ctx = { projekt: () => projekt };
  const gemeldet = new Map([['erz/5/bk/2', 0.75], ['spur/1/bk/3', 0.9]]);
  assert.equal(wertVon(ctx, 'spur/1/bk/3', gemeldet), 0.25, 'the project, not the core row');
  assert.equal(wertVon(ctx, 'spur/1/bk/4', gemeldet), 1);
  assert.equal(wertVon(ctx, 'spur/1/bk/5', gemeldet), 0.5, 'not a number: the default');
  assert.equal(wertVon(ctx, 'spur/1/bk/9', gemeldet), 0.5, 'an untouched knob');
  assert.equal(wertVon(ctx, 'spur/2/bk/3', gemeldet), undefined, 'no bk track on slot 2');
  assert.equal(wertVon({}, 'spur/1/bk/3', gemeldet), undefined, 'no project');
  assert.equal(wertVon(ctx, 'erz/5/bk/2', gemeldet), 0.75);
  assert.equal(wertVon(ctx, 'erz/5/bk/3', gemeldet), undefined, 'the kern has not reported it');
  assert.equal(wertVon(ctx, 'deck/1/filter', gemeldet), undefined);
});
