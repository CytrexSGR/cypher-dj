import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruefer, SCHEMA_JOURNAL, SCHEMA_KONFIG, SCHEMA_MCP, SCHEMA_WS } from '../src/vertrag.ts';

const zeit = { sample: 1800000, beat: 80, takt: 21, phrase: 3 };
const hallo = { v: 1, seq: 1, von: 'ansage', typ: 'hallo', zeit, daten: { rolle: 'ansage', name: 'zeile', protokoll: 1 } };

test('WS-Schema aus 09: hallo gültig; Fehlerfall unbekannte Rolle, fehlendes zeit, takt ohne Takt-Zustand', () => {
  const v = pruefer(SCHEMA_WS);
  assert.equal(v(hallo).ok, true, v(hallo).fehler);
  assert.equal(v({ ...hallo, daten: { ...hallo.daten, rolle: 'dj' } }).ok, false);
  const { zeit: _weg, ...ohneZeit } = hallo;
  assert.equal(v(ohneZeit).ok, false);
  assert.equal(v({ ...hallo, typ: 'takt', daten: {} }).ok, false);
});

test('Journal- und MCP-Schema aus 09 sind ladbar und unterscheiden gültig von ungültig', () => {
  const j = pruefer(SCHEMA_JOURNAL);
  const zeile = { sample: 0, beat: 0, takt: 1, mono_ns: 1, von: 'kern', typ: '/takt', daten: {} };
  assert.equal(j(zeile).ok, true, j(zeile).fehler);
  assert.equal(j({ ...zeile, von: 'dj' }).ok, false);
  const m = pruefer(SCHEMA_MCP, '#/$defs/mit_jetzt');
  assert.equal(m({ jetzt: { takt: 21, schlag: 1, beat: 80, seq: 3 } }).ok, true);
  assert.equal(m({}).ok, false);
});

test('Konfig-Schema aus 02: Vorgaben füllen nur mit mitVorgaben; eine Nachricht bleibt unverändert', () => {
  const mit = { version: 1 } as Record<string, unknown>;
  assert.equal(pruefer(SCHEMA_KONFIG, '#/$defs/leitstand.toml', true)(mit).ok, true);
  assert.equal(mit.ws_port, 47200);
  const ohne = { version: 1 } as Record<string, unknown>;
  assert.equal(pruefer(SCHEMA_KONFIG, '#/$defs/leitstand.toml')(ohne).ok, true);
  assert.equal('ws_port' in ohne, false);
  assert.equal(pruefer(SCHEMA_KONFIG, '#/$defs/leitstand.toml')({ version: 1, ws_prot: 1 }).ok, false);
});
