# Journey: let an agent play the studio

An AI agent can play Cypher DJ through the same controls you have: it loads and mixes tracks, builds arrangements, moves faders
and filters, and changes the tempo. This page takes you from nothing to an agent that plays eight bars while you stay in
charge: how to connect it, what it can and cannot do, how you take a control back, and how Stop Cypher works.

## 1. Connect the agent

The studio ships an MCP server, `djk/hand/hand.ts`. It talks to the studio page you already have open, over HTTP, and speaks
MCP over standard input and output. It needs Node.js and the studio running (the page answers on port 47300 by default).

**Claude Code**, one line:

    claude mcp add --scope user djk-hand -- node /path/to/cypher-dj/djk/hand/hand.ts --seite http://127.0.0.1:47300

Replace `/path/to/cypher-dj` with your checkout. Restart the session; the tools appear as `djk-hand`.

**Any other MCP client**, the generic form:

```json
{
  "mcpServers": {
    "djk-hand": {
      "command": "node",
      "args": ["/path/to/cypher-dj/djk/hand/hand.ts", "--seite", "http://127.0.0.1:47300"]
    }
  }
}
```

`--seite` is the address of the studio page. A second studio instance on another port gets its own entry with its own
`--seite`. If the studio is not running, every tool answers that the page cannot be reached: start the studio, not the agent.

The server lists about a hundred tools, and the tour below checks that it lists as many as the code has. The full list with
every argument is `djk/hand/AUFRUF.md`.

## 2. What the agent can do

Every call the agent makes carries the source `cypher`. Within that:

- Read the state: `lage` (clock, tempo, decks, mixer values, Stop Cypher flag), `pegel` (levels), `studio`, `proj_lage`.
- Play: load tracks into the decks, start and stop them, set loops and hot cues, move mixer controls, also as a ramp over
  bars (`regler`), set the tempo (`tempo`), use the effects and the Strudel streams.
- Build: create a project (`proj_neu`), add tracks (`proj_aendern`), write a pattern into a clip (`proj_muster`), start the
  transport (`proj_transport`), freeze, bounce and export.

A short example of eight bars: create a project, add a kit track, write `s("bd*4, ~ hh ~ hh")` as an eight bar clip on it
and start the transport. The agent does this with five tool calls (`proj_neu`, `proj_aendern`, `proj_lage` to read the
track id, `proj_muster`, `proj_transport`), and the master level rises at once.

## 3. What the agent cannot do

These limits are in the studio, not in the agent's good manners. A refused call comes back as an error with a reason, and
nothing changes.

- It cannot press Stop Cypher. Only you can.
- It cannot open a closed channel on its own: opening a deck fader needs a valid hearing check. You open the fader, then the
  agent can move it.
- It cannot move the master level or switch the effect routing. Those are yours.
- It cannot stop a transport you started; it stops only its own.
- It cannot touch a stream while AUTO is off for it: AUTO off means you hold that stream.
- It cannot touch a control you are holding (see the next section).

## 4. Take a control over

Taking over means grabbing the control on the page: put your hand on the fader or knob and move it. Nothing else is needed.

- If the agent is in the middle of a ramp over several bars on that control, the ramp stops at once and the control stays
  where you put it, for the rest of the time the ramp would have run.
- For the next 32 beats (eight bars) the control is yours: a call of the agent that writes to it is refused. After that the
  agent may write to it again. Moving the control again starts the 32 beats anew.
- The first movement of a control after the studio started only sets the position of your hand. The control is taken over when
  it moves a little further.

The agent should read `lage` before it writes and leave alone what you touched a moment ago. For a stream you want to keep for
yourself, switch AUTO off and the agent is refused for as long as it is off.

## 5. Stop Cypher

The **Stop Cypher** button in the top bar is the brake. While it is pressed:

- the agent's calls that move a control and that set the tempo are refused (these are the two the tour checks; the button
  also holds back loading and planning);
- your own controls keep working;
- reading still works, so the agent can see what happened (`lage` shows the stop);
- music that already plays keeps playing: Stop Cypher stops the agent, not the transport. Stop the transport yourself if you
  want silence.

While it is pressed the button turns into **Release**. Press that to let the agent act again; its next write call goes through.

## 6. The tour that checks this page

`djk/tools/tour/j5.py` walks this journey against a real test instance, with the registration command above, and checks:

1. the server starts with that command and answers the MCP handshake;
2. it lists as many tools as the code has;
3. the agent builds an eight bar clip through tool calls;
4. the master level is above -60 dBFS in every one of the eight bars, one reading per bar at the project tempo;
5. you grab a filter the agent is ramping: the ramp stops, the agent is refused for the hold and may write again after it;
   a fader and the tempo are taken over by your hand as well;
6. Stop Cypher: the agent cannot press it, its control and tempo calls are refused afterwards, your own controls pass, and the
   release clears it.

Run it with `python3 djk/tools/tour/j5.py --instanz b`; it starts the instance, writes `bericht.md` and `bericht.json` and
stops the instance again. It skips the sound step when the live studio is playing music.
