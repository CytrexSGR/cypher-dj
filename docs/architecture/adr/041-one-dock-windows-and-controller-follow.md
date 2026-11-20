# ADR 041: one shared dock with a host object, one window opener, controller follow on existing rows

Status: decision 1 is built by the plan `docs/superpowers/plans/2026-11-19-one-dock-stage-1.md` (stage 1). Decisions 2 and 3 are decided here and built in stages 2 and 3.
Decided: in the spec `docs/superpowers/specs/2026-11-19-one-dock-design.md`, approved by the owner on 2026-11-19.
Supersedes: nothing. Decision 2 keeps the FOLLOW rule of the instrument window of 2026-11-18.
Spec: `docs/superpowers/specs/2026-11-19-one-dock-design.md`.

## Context

The owner wants one feeling across DJ, LIVE, STUDIO and PRODUCTION: the same card for everything that makes or shapes sound, the same gestures, the same place, the same strip language. Today STUDIO has a dock (`werkbank/dock.js`) and floating windows (`werkbank/window.js`), PRODUCTION has the fold panels GROUPS, RETURNS and INSERTS, and device windows are opened by several separate `window.open` calls. The controller follows the instrument in front but nothing else. Copying the STUDIO dock per view would give two codes that drift apart; a second addressing for windows or for the controller would do the same.

## Decision

1. **One shared dock with a host object per view.** The dock lives in one module, `djk/ui/public/dock/`, not as a copy per view. Dock code reads view state only through a host object that each view provides; nothing under `public/dock/` imports from `public/werkbank/` or `public/production/` state. The host fields (documented at the top of `dock/dock.js`, defaults filled by `hostMitVorgaben(host)`):
   - `ansicht` (`'werkbank'` or `'production'`, the source name for `fokus.melde`), `dockEl`, `flaecheEl` (dock root, window layer).
   - Project and commands: `projekt()`, `aendere(label, befehle, schluessel?, optionen?)`, `melde(text, fehler?)`, `frage(text)`, `holeGet(weg)`, `holeJson(weg, body)`.
   - Storage: `lies(k, v)`, `merke(k, v)`, `fensterSchluessel` (prefix of stored window places).
   - Track selection: `wahl { lies(), setze(spurId), beiWechsel(fn) }`.
   - Subscriptions: `beimProjekt(fn)`, `beimEreignis(fn)`, `beimBild(fn)`.
   - Strips and labels: `zuege(p)` (the TRACKS row), `kurz(p, strangId)` (short label), `zeilenTitel { spuren, gruppen, fx }`.
   - Menus and creation: `spurNeu?`, `spurNeuAus?`, `fxMenue(p, graphen)`, `plusOptionen`, `instrumentWechsel?`, `oeffneMenue(punkte, x, y)`.
   - Surfaces: `insertFaceOeffnen(strang, insert)`, `panelQuelle`, `stufenPopover(strang, insert, anker)`, `pluginFenster(insertId)`.
   - Stage state: `hostLage(insertId)`, `grLesung(insert, jetzt)`, `presetMarke(insertId)`, `kopfBeat()`.
   - `adapterCtx`, the view's ctx, handed only to the shared adapters in `production/` that already serve both views.
   - `spurFensterHaken?` (`offen`, `zu`, `wahl`), the hook with which STUDIO adds its sampler cut and kit host below the panel of a track window.
   - Four switches: `gruppen` (GROUPS row), `sends` (send knobs on cards), `mischer` (PAN, M, S and the card menu on group and return cards), `stufenFenster` (WINDOW ↗ for stages and strips, stage 2).

   Every host function is a closure that reads the view's ctx at call time. A view-specific need is a host field or a switch, never a branch on the view inside the dock.
2. **One address scheme and one opener for device and effect windows.** The address is `/#geraet=<target>` with `<target>` one of: a plain track id (as today), `ins:<stageId>`, `ret:<id>`, `grp:<id>`, `master`; later `fx:<n>`, `color` and `kanal:<path>`. Old addresses keep working. One opener, `oeffneGeraetFenster(target, melde)`, is the only place that calls `window.open` for a device or effect; the other openers of today (`#remix`, `#tablet`, `#controller`) share one helper for name, size and the blocked-pop-up message, and `#controller` keeps its own content. Window identity: the instrument window stays one window that follows the track in front (FOLLOW, decided 2026-11-18); effect windows are one per target, so a compressor and an EQ can stand side by side, and a second WINDOW ↗ on the same target focuses the existing window.
3. **Controller follow resolves a target to existing rows.** The controller focus takes a target (`{ziel}`) besides `{kanal}` and `{spur_id}`. The server derives the rows for it from the rows that already exist as static LEARN targets (`djk/ui/areas/controller/regler_info.ts`): a stage resolves to its pool row, a group or return to its strip rows. There is no second addressing. Without a saved mapping, controller knob n drives front knob n of the card in front. Mappings are saved per effect kind and one for "strip".

## Consequences

- STUDIO and PRODUCTION (later DJ and LIVE) show one card and one set of gestures; a fix or improvement to the card reaches every view.
- A view-specific need is a host field or a switch. The dock grows a field only when two views cannot share the behaviour.
- The guard tests of STUDIO pin the thin host files (`werkbank/dock.js`, `werkbank/window.js`, `werkbank/dock.css`), so the move in stage 1 shows as a failing test if STUDIO changes.
- Window targets and controller targets use one vocabulary, so stage 3 reuses the parser and formatter of stage 2.
- Follow depends on the static LEARN rows: a target without such rows (for example a host plugin whose process is missing) keeps the last controller assignment and shows no CTL badge.

## Amendment 2026-11-19: live hosts

A host may hand the dock generic cards (`modell`, `aktionen`, D2 of plan `docs/superpowers/plans/2026-11-19-one-dock-stage-5a.md`) instead of a project. The cards are built from the same building blocks (`dock/blocks.js`). DJ and LIVE use it for the EFFECTS tab, and their writes stay on the live senders without undo.
