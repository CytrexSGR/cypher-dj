// Source text of the page code that used to be the single file public/app.js: app.js (the entry point) plus the modules split off it.
// Page tests that assert on the code as text read it through liesApp(), so an assertion keeps its meaning wherever the code sits.
// Page tests that run the page import public/app.js itself (the modules load through its imports).
import fs from 'node:fs';

const PUBLIC = new URL('../../public/', import.meta.url);

// app.js first, then the split-off modules; the order only decides where a text search starts.
export const APP_DATEIEN = [
  'app.js', 'page_state.js', 'controls_view.js', 'deck_view.js', 'deck_griffe.js', 'output_view.js', 'loop_rec_view.js',
  'tempo_view.js', 'color_view.js', 'beat_fx_view.js', 'live_view.js', 'slots_view.js', 'remix_window.js',
  'live_kanaele.js', 'effects_gemeinsam.js', 'effects_view.js', 'learn_view.js', 'graphs_view.js', 'effects_bindung.js', 'prelisten_view.js',
  'browse_table.js', 'browse_detail.js', 'library_view.js', 'seitenrahmen.js', 'instanzen.js', 'stream.js', 'loopdeck/view.js', 'loopdeck/model.js', 'loopdeck/menue.js', 'loopdeck/sets.js', 'loopdeck/drag.js',
];

// The `export ` prefix the split added to shared declarations is module plumbing, not page logic: it is stripped, so the text reads as before the split.
export const liesApp = () => APP_DATEIEN.map((n) => fs.readFileSync(new URL(n, PUBLIC), 'utf8')).join('\n').replace(/^export (?=(async function|function|const|let|class)\b)/gm, '');
