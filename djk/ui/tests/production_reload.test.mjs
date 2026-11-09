// 1.12 S3 task 9 fixup 2: the retry of a hand value waits for the NEWEST applied load, so it never resends with a revision it already knows is stale.
// The real neuerSchreiber and neuerLader are wired like in production.js; the server answers 409 once because a take took revision 5 -> 6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerSchreiber } from '../public/production/writer.js';
import { neuerLader, neuerNachlader } from '../public/production/load.js';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function lauf(getMs) {
  const srv = { rev: 6, posts: [], gets: 0 };           // the server is already at 6 (the take); the page believes 5
  const holeJson = async (weg, koerper) => {
    await schlaf(2);
    srv.posts.push({ rev: koerper.rev, status: koerper.rev === srv.rev ? 200 : 409 });
    if (koerper.rev !== srv.rev) return { status: 409, j: { fehler: 'rev_veraltet' } };
    srv.rev++;
    return { status: 200, j: { rev: srv.rev, projekt: { rev: srv.rev } } };
  };
  let s;
  const lade = neuerLader({ hole: async () => { srv.gets++; const rev = srv.rev; await schlaf(getMs); return { status: 200, j: { slug: 'a', projekt: { rev } } }; },
    uebernimm: (slug, p) => { s.setze(slug, p.rev); }, leere: () => {}, beiWeg: () => {}, beiDa: () => {} });
  const nach = neuerNachlader(lade, 30);
  s = neuerSchreiber({ holeJson, beiProjekt: () => {}, beiFehler: () => {}, beiWiederhole: async () => { nach.starte(); await nach.fertig(); }, beiFremdeRev: () => nach.plane() });
  s.setze('a', 5);
  const ok = s.aendere('Volume', [{ befehl: 'x' }], 'k', { wiederhole: true });
  nach.plane();                                          // the SSE event of the take also plans a load, 30 ms later
  const erg = await ok;
  await schlaf(getMs + 60);                              // let the planned load finish too
  return { erg, posts: srv.posts };
}

for (const ms of [10, 100]) {
  test(`nachladen: GET ${ms} ms -> exactly one 409, then the write with the new revision`, async () => {
    const { erg, posts } = await lauf(ms);
    assert.equal(erg, true);
    assert.deepEqual(posts.map((p) => [p.rev, p.status]), [[5, 409], [6, 200]], `posts ${JSON.stringify(posts)}`);
  });
}

test('nachladen: fertig() waits for the successor of an overtaken load; an idle loader answers at once', async () => {
  const lade = neuerLader({ hole: async () => { await schlaf(40); return { status: 200, j: { slug: 'a', projekt: { rev: 1 } } }; }, uebernimm: () => {}, leere: () => {}, beiWeg: () => {}, beiDa: () => {} });
  const n = neuerNachlader(lade, 10);
  const t0 = Date.now();
  const a = n.starte();
  n.plane();                                             // starts a second load at 10 ms: the first is overtaken
  assert.equal(await a, 'ueberholt');
  assert.equal(await n.fertig(), 'uebernehmen');
  assert.ok(Date.now() - t0 >= 45, 'it waited for the second load');
  assert.equal(await neuerNachlader(lade).fertig(), 'keine', 'nothing was ever started');
});
