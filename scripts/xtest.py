#!/usr/bin/env python3
"""Inject physical key presses into an X display with the XTest extension.

Reads one JSON command per line from stdin and answers with one JSON line.
Used by scripts/xkb-os-check.mjs against a private nested X server, so the
keymap under test is the server's real XKB keymap and nothing touches the
user's desktop session.

  {"op": "key", "keycode": 24, "down": true}
  {"op": "click", "x": 400, "y": 300}
  {"op": "quit"}
"""
import json
import sys

from Xlib import X, display
from Xlib.ext import xtest


def main() -> None:
    d = display.Display()
    root = d.screen().root
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        cmd = json.loads(line)
        op = cmd.get("op")
        if op == "quit":
            break
        if op == "key":
            xtest.fake_input(d, X.KeyPress if cmd["down"] else X.KeyRelease, int(cmd["keycode"]))
        elif op == "click":
            root.warp_pointer(int(cmd["x"]), int(cmd["y"]))
            d.sync()
            xtest.fake_input(d, X.ButtonPress, 1)
            xtest.fake_input(d, X.ButtonRelease, 1)
        d.sync()
        sys.stdout.write(json.dumps({"ok": True}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
