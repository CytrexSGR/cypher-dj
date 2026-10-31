# ADR 013: AI layer (roles, choice instead of plan, move cadence, autonomy)

- **Status:** provisional, measurement M15 outstanding; player changed to Sonnet wave (addendum 2026-09-25)
- **Date:** 2026-09-23
- **Requirements carried:** A1, A3, A4, A7, A13, A15, A16, A24
- **Related to:** ADR 012, 014, 023

*Conflict of interest, disclosed: this decision regulates my own room for maneuver. That is why every level of my freedom lies on a switch in Andreas' hand, and the default is small.*

## Context

An LLM move takes seconds (09 check a, a2); the LLM wrote a coupling in 0 of 105 plans, which at runtime produced 15 bars of doubled sub (09 NP K1); a choice instead of a plan cost 1.307 to 1.437 s as a text answer (NP K7). A16 says literally: "What stays art: which track, which play style, which moment."
09 question 1 asks how much Cypher may do on its own; without a view channel "proposing" cannot be implemented (09 NP "What is missing").

## Decision

1. **Roles:**
   - **Player:** Claude Sonnet in a warm session per set (`claude -p --input-format stream-json
     --output-format stream-json`), lean role prompt only with music and set context, `MAX_THINKING_TOKENS=0`,
     without hooks and foreign MCP servers, one warm-up move before the set. Driven by `cypherdj-spieler` (Node), tools
     via `cypherdj-mcp`.
   - **Splitter** (from slice 6): second, separate Sonnet session in the workshop (A13).
   - **Main instance** (Opus with memory) only before and after the set: role prompt, learning model, summary,
     commission A/B pairs. Opus not for moves; Haiku not for free plans.
2. **Choice instead of plan:** Cypher answers with `waehle{material_id, spielart, start_takt, hoerschein, absicht}` from
   candidates that the planner has prepared. The control desk lets the planner expand the play style into plan parts,
   assigns couplings, checks the prediction against the sub limit (low-band limits until M20 only warning, ADR 012) and only then
   submits. `plan_einreichen` (free plan in the one plan form) remains the exception for unusual cases.
3. **Move bar:** the control desk calls, not Cypher. Occasions: at the latest 8 bars before the earliest start of a deployment;
   `material_fertig`; listening check; hand grab in a Cypher plan; lock; rejected or expired proposal;
   deadline under 32 bars; Andreas' key "Cypher, proposal"; his call (one typed line). Only one move
   at a time; every request carries a response deadline in beats; too late means discarded. In quiet phrases
   nobody asks. State condensed per bar, no stream below the bar to the LLM.
4. **Autonomy levels** on a switch on the controller, **default level 1**:
   0 listen (Cypher only analyzes and logs) · 1 propose (**positive list:** every choice and every plan becomes a
   proposal, whether it opens a channel or only changes EQ, stem, send, hot cue, jump or loop on an already
   audible deck; alone only loading, pre-listening, generating, aborting own plans, and a plan that exclusively
   makes channels of the own track quieter) · 2 own track (Cypher plays released channels behind a fader that only
   Andreas holds; everything else still as proposal) · 3 transitions alone. Enforced in the control desk; wording and
   golden sequence `autonomie_1_eq`: `INTERFACES.md` §10. Reason for the positive list: A4 "Nothing reaches the master
   unchecked"; an EQ at +6 dB on Andreas' running deck opens no channel and is still playing in without him.
5. **Cypher stop** (key on the controller, acts in the core even without the control desk): all parts with source `cypher` off, channels
   of the AI track to −200 dB within one bar, other controls stay where they are, further Cypher commands rejected until "release".
   *Overtaken by package 1.18, decision E-a (Andreas, 2026-10-20):* the stop no longer lowers any channel; running parts of Cypher hold
   at the current value, a running transport keeps running and belongs to Andreas (D1 SPEC addenda 39 and 40).
6. **Visibility before any surface:** LEDs on the controller (proposal open, plan running, fallback active), an
   **announcement line** in the terminal (one sentence with bar: what Cypher intends next), the key "Hear Cypher",
   the play sheet as text. No speech output (No sound without a question).
7. **MCP tools:** `lage`, `warte`, `waehle`, `plan_einreichen`, `plan_abbrechen`, `laden`, `vorhoeren`, `bestand`,
   `passung`, `erzeuge`, `spielzettel` (from slice 7), `markieren` (forms: `INTERFACES.md` §10). Tools instead of
   resource subscriptions.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| LLM writes plan parts (09) | 0 of 105 plans couple; play style rules violated from the prompt, checker blind; tool route 4.5 to 8.7 s to the plan | 09 NP K1, K6, K9 |
| cold `claude -p` per move | p50 22.9 s, p95 33.7 s (12 to 18 bars) | 09 check a |
| `--effort low` instead of `MAX_THINKING_TOKENS=0` | does not reliably switch off thinking (52 to 693 thinking tokens in follow-up moves) | 09 NP K6 |
| Haiku as player | fast without thinking (2.2 to 2.5 s), but breaks bass rules | 09 NP K8 |
| Opus 5.5 for moves | thinking not switchable ("except on Opus 5.5 and the Fable models") | 09 NP K6 |
| resource subscriptions instead of `warte` | optional in MCP, route into the model unchecked | 09 §3.5 |
| full autonomy from the start | trust must be earned; Andreas keeps the hand | 09 §6 question 1, R10 in the draft "KI" |

## Consequences

- Form errors cost a move, never a sound: the control desk checks every answer.
- The choice as a tool call is unmeasured; calculated 2.5 to 3.5 s (text 1.3 to 1.4 s plus 1 to 2 s for the second model call after the tool result, 09 NP K6). **Decisive is the response deadline of the contract: 4 bars (7.5 s at 128)** from the move to `antwort_bis_beat`; the remaining 4 bars of the 8-bar lead belong to Andreas' acceptance and the lead time of the parts (`INTERFACES.md` §3). Measured are: free plan via the tool 4.5 to 8.7 s, warm text moves with schema up to 14.5 s, the choice only as text 1.3 to 1.4 s (n = 5, context at most 7 410 tokens, `llm_x_wahl_sonnet_low_ergebnis.json` field `cache_gelesen`). Move plus repair move fit only if the tool choice holds the calculated 2.5 to 3.5 s; that is open.
- If the deadline is tight, the move request for "safe" moves up to F−28 (12 bars before S), the response deadline stays S − 4 bars.
- Costs over a set are unmeasured: at 260 000 tokens of context every move reads this amount from the cache (09 NP "What is missing"). M15 first measures 30 minutes.
- Form reliability at large context is measured only for text (0 of 5 valid at 259 266 tokens); the 10 valid tool calls ran at 7 to 23 thousand tokens (`llm_x_mcp_*_ergebnis.json`, `cache_gelesen`).

## Evidence

09 §3.2, §3.4, §3.5, check a, a2, b, c; NP K1, K6 (tool route; `MAX_THINKING_TOKENS=0`: warm text follow-up moves 3.564
to 4.455 s), K7 (choice 1.307 to 1.437 s, 33 to 42 tokens, 5 of 5 valid), K8, K9, K11, "What is missing"; raw data
`proben/09-ki-steuerung/nachpruefung/llm_x_wahl_sonnet_low_ergebnis.json` (`init_tools` empty),
`llm_x_mcp_sonnet_low_ergebnis.json`; 08 NP K1; research §5 (takeover by playing, proposal and acceptance,
visible plan, own AI track).

## Overturned if

M15 (choice as a tool call, context ≥ 100 000 tokens as late as in the set) shows that **p95(move) + p95(repair move)
exceeds the contract deadline of 4 bars**, or form errors in the choice via the tool (then choice as text with
`--json-schema`, move request earlier, or without a repair move); the costs of a set are not sustainable (decision
Andreas).

## Addendum 2026-09-25: the player is a Sonnet wave

`(A, 2026-09-25: "I assume we spin with a Sonnet wave. That works better than Opus anyway. You think much longer.")`

Decision 1 is changed: the player is no longer a lean, memoryless Sonnet session, but a **Cypher wave on Sonnet** with boot, memory and Andreas' taste. **Opus remains possible as player** `(A, 2026-09-25: "don't rule Opus out completely. maybe sometimes with Opus too. then I decide about the budget anyway")`: the default is Sonnet, Opus is a choice per set, which Andreas decides together with the budget. Known price for this: thinking cannot be switched off on Opus 5.5 (09 NP K6), so a move takes longer; whether it fits the deadline is unmeasured.
Experience base: the set hall140 on 2026-09-21 was played on Sonnet.

What is newly open as a result, and what M15 must measure, instead of the previous lean session:

- **Context:** boot and Boden (the shared base text) already push the context up before the first move. The time to the choice must be measured at exactly this size.
- **Hooks:** a wave carries the PreToolUse and PostToolUse hooks (DJ machine: 50). Every `waehle` call runs through them. Their run time counts toward the 4-bar deadline. To be clarified: for the duration of the set, a hook profile without the hooks that have nothing to do with the set.
- **Thinking:** `MAX_THINKING_TOKENS=0` also applies to the wave (Sonnet permits it, Opus 5.5 does not, 09 NP K6).

M15 is shrunk for this: a short run with about 20 moves in the wave configuration (about 3 USD instead of 20). A second short run with Opus in the same configuration measures whether Opus holds the deadline; costs calculated in advance, run on Andreas' word. The 30-minute measurement follows once the player is built (slice 61).

## Addendum 2026-09-26: fallback F−28 armed (M15 measured)

Short run M15 (`messungen/M15-wahl-werkzeug/laeufe/kurz-welle-20260926-1005`, status 03): choice as tool call 20 of 20
valid, 0 form errors, repair with a capable announcement 0 missed, 0.09 USD per move. The time depends on the API: on
25.09. in the evening move p95 3.4 s, on 26.09. in the morning 9.9 s (first API response 3.0 to 8.7 s instead of 1.1 to 1.9 s). The
4-bar deadline (7.5 s) therefore does not hold reliably. The fallback planned above now applies always: `zug_vorlauf_takte`
= 12, response deadline stays S − 4 bars, the response window is 8 bars (15 s at 128). One move fits at p95 with room to spare; a
repair in the same move fits at the median (5.5 + 4.4 s), but not in the worst measured case (9.9 + 9.0 s), then the
deadline watchdog takes over as for any missing answer.

## Addendum 2026-09-26 evening: planning ahead of real time (A29)

`(A, 2026-09-26)` "we always have to be ahead of real time in our planning … if we need 2 minutes to set up the precise sequence, we have to talk at least 3 minutes before. Fallback is looping the current sound anyway, always … we are actually developing musical journeys".

Direction changed: the AI layer works in two horizons.
1. **Journey** (strategic, minutes ahead): dramaturgy, next tracks, kind of transitions, announcements (A28). Horizon
   at least 1.5 × build time of the next sequence. The workshop renders what the journey needs before it is needed.
2. **Move** (tactical, as before, `zug_vorlauf_takte` = 12): places a long-planned sequence on the grid, repairs
   locks.
Fallback is normal operation, not an error: loop the current bar or phrase (deadline watchdog, slices 13/20) or
repeat a sequence until the next sequence is ready. The API response time (M15: p95 9.9 s) therefore only affects the move,
never the journey. Immediate live reaction is explicitly secondary.
