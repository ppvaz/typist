# Two-machine setup

The [two-machine module](dual-machine.md) needs a small coordinator on your own network. It serves the built app over HTTPS and relays readiness, timing, status and final counters between two machines through a same-origin WebSocket at `/dual/ws`. It never receives typed text or keystroke streams, keeps rooms only in memory, deletes them after 30 minutes without activity, and does not log room tokens. The core trainer does not need it: solo practice works offline without it.

## 1. Build the app and pick the host

On the machine that will run the coordinator (either typing machine, or a third one):

```sh
npm ci
npm run build          # writes dist/
```

Note its LAN address, for example `192.168.1.20` (`ip -4 addr`).

## 2. Create a certificate both machines trust

Browsers only run the service worker, IndexedDB persistence prompts and a secure WebSocket on a trusted HTTPS origin. [mkcert](https://github.com/FiloSottile/mkcert) makes a private certificate authority for this:

```sh
mkcert -install                                  # trusts the local CA on this machine
mkcert 192.168.1.20 typist.local localhost       # writes 192.168.1.20+2.pem and 192.168.1.20+2-key.pem
mkcert -CAROOT                                   # the folder holding rootCA.pem
```

Copy `rootCA.pem` (never `rootCA-key.pem`) to the second machine and trust it there:

- **System (Debian/Ubuntu):** `sudo cp rootCA.pem /usr/local/share/ca-certificates/typist-mkcert.crt && sudo update-ca-certificates`
- **Chrome/Chromium on Linux** (uses its own NSS store): `certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n typist-mkcert -i rootCA.pem` (package `libnss3-tools`)
- **Firefox:** Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import `rootCA.pem`, and tick "Trust this CA to identify websites".

## 3. Start the coordinator

```sh
node server/coordinator.mjs --port 8443 --cert 192.168.1.20+2.pem --key 192.168.1.20+2-key.pem
# or: npm run coordinator -- --port 8443 --cert … --key …
```

It listens on all interfaces by default (`--host` to change it) and serves `dist/` (`--dist` to change it). Allow the port through a firewall if one is active, for example `sudo ufw allow 8443/tcp`.

For a quick test on one computer, `node server/coordinator.mjs --http --port 8080` serves plain HTTP on `127.0.0.1` only; two separate browser profiles can then play the two machines.

## 4. Open the same origin on both machines

Open `https://192.168.1.20:8443/` on both machines. There must be no certificate warning. The Two machines screen's coordinator address defaults to that origin's `/dual/ws`, so nothing else needs configuring.

Browser data belongs to an origin. A profile you use elsewhere (another port, host name or `npm run preview`) is not visible at this address. On each machine, restore your latest backup (Data → Restore) so the module sees your core completion, then **calibrate that machine's own keyboard and layout** there. Each machine keeps its own local results.

## 5. Connectivity check

1. On the left machine, open Two machines, choose its mode, and select **Create a room**.
2. Open the join link it shows on the right machine (or type the room code) and select **Join as the right machine**.
3. Both machines list each other as connected, with a clock estimate such as `clock ±3 ms (10 samples)`. On a normal home network this is a few milliseconds. Above 100 ms, runs are labeled unsynchronized and never count toward coordinated milestones; use a wired connection or move closer to the access point.
4. Propose a D1 run on the left machine, acknowledge it on both, and select **Ready to start** on both. Both start together five seconds later.

If a machine disconnects, the other keeps its local work and marks the run incomplete. Either machine can stop both. To compare streams afterwards, export a side file from one machine's run list and import it on the other (Cross-stream analysis).
