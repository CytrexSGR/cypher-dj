#!/usr/bin/env python3
"""Minimal obs-websocket v5 client for djk-demo (no auth: the demo profile switches it off and binds to localhost).

Usage: obs_ws.py <RequestType> [json data]   -> prints the response data as JSON, exit 1 on a failed request
       OBS_WS_PORT (default 4455)
"""
import asyncio
import json
import os
import sys

import websockets


async def anfrage(typ, daten):
    url = f"ws://127.0.0.1:{os.environ.get('OBS_WS_PORT', '4455')}"
    async with websockets.connect(url, subprotocols=["obswebsocket.json"], open_timeout=3) as ws:
        hallo = json.loads(await ws.recv())
        if hallo.get("op") != 0:
            raise RuntimeError(f"no Hello: {hallo}")
        if hallo["d"].get("authentication"):
            raise RuntimeError("obs-websocket asks for a password; the demo profile runs without one")
        await ws.send(json.dumps({"op": 1, "d": {"rpcVersion": 1, "eventSubscriptions": 0}}))
        ident = json.loads(await ws.recv())
        if ident.get("op") != 2:
            raise RuntimeError(f"not identified: {ident}")
        await ws.send(json.dumps({"op": 6, "d": {"requestType": typ, "requestId": "1", "requestData": daten}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("op") == 7 and m["d"].get("requestId") == "1":
                return m["d"]


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    daten = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    try:
        d = asyncio.run(anfrage(sys.argv[1], daten))
    except Exception as e:  # noqa: BLE001 - one line for the shell
        print(f"obs_ws: {e}", file=sys.stderr)
        return 1
    print(json.dumps(d.get("responseData", {}), ensure_ascii=False))
    st = d.get("requestStatus", {})
    if not st.get("result"):
        print(f"obs_ws: {sys.argv[1]} failed: {st.get('code')} {st.get('comment', '')}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
