# Verification report

This is the release report the [build plan](build-plan.md#verification-strategy) asks for: the environment that was tested, how to build and check the app, what the automated checks cover, and the physical-keyboard checks that only you can perform. Automated results are from 27 September 2026.

## Release status

| Milestone | Scope | Automated status | Still needs you |
| --- | --- | --- | --- |
| 1 · Input and measurement | Layout registry, calibration, scorer, timing, trial records | Passing | Calibrate on your physical keyboard (checklist below) |
| 2 · Guided acquisition | Onboarding, levels, ledgers, benchmark sets, gates | Passing | — |
| 3 · Maintenance and integration | Adaptive drills, maintenance, switching, core completion | Passing | — |
| 4 · Offline and personal-use release | Offline cache, recovery, backup/restore, accessibility | Passing | Manual compatibility checks below; this is the core release gate |
| 5 · Optional layout expansion | Colemak, Workman (native), Half-QWERTY (emulated) | Passing | Only if you use them |
| 6 · Optional two-machine module | Coordinator, D1–D5, baselines, efficiency, analysis | Passing with two isolated browsers on one host | One real two-computer run |

## Environment tested

| Item | Value |
| --- | --- |
| OS | Debian GNU/Linux 13 (trixie), kernel 6.12.107+deb13-amd64 |
| Desktop session | GNOME on Wayland (browsers under XWayland for the OS keymap harness) |
| XKB data | xkb-data 2.42-1, xkbcomp 1.4.7, evdev rules; Xephyr 21.1.16 for the nested keymap checks |
| Browsers | Google Chrome 154.0.8037.57; Mozilla Firefox 140.16.0esr |
| Node.js / npm | 22.23.2 / 10.9.8 |
| Physical keyboard | **Not yet recorded.** Onboarding asks; ANSI and ABNT2 are both supported and calibration confirms which one it is |
| OS input sources found on this machine | `br` (ABNT2 Portuguese) and IBus Mozc (Japanese). Neither is a training layout: add the ones below before practising |
| Training layouts | QWERTY: `us(intl)` (US international, dead keys), your choice at onboarding; plain `us` also supported. Dvorak: `us(dvorak-l)`, `us(dvorak-r)`. Optional: `us(colemak)`, `us(workman)` |
| Modifier strategy | Chosen at onboarding (default: hold Shift with the typing hand); recorded on every trial's setup snapshot |

## Build and check

```sh
npm ci
npm run verify            # content manifest check, typecheck (app, tests, node), unit tests, production build
npm run test:e2e          # browser tests in Chrome and Firefox (starts dev and preview servers)
npm run layouts:check     # layout tables still match the installed XKB data
npm run xkb:check -- --out docs/verification/xkb-os-check.json   # OS keymap harness (needs Xephyr, setxkbmap, python3)
npm run coordinator -- --http --port 8080                        # two-machine coordinator for local testing
```

`npm run build` writes `dist/` with a generated service worker that precaches the exact build, and `dist/licenses/` with the third-party notices (fonts under the SIL Open Font License; React, idb under MIT). Layout tables are extracted from xkeyboard-config (MIT/X11-style license, `licenses/xkeyboard-config.txt`).

### Dependency versions

Runtime: react 19.3.0, react-dom 19.3.0, idb 8.0.3, @fontsource/ibm-plex-sans 5.3.0, @fontsource/jetbrains-mono 5.3.0, @fontsource/newsreader 5.3.0; coordinator only: ws 8.22.0. Development: typescript 7.0.2, vite 8.3.0, @vitejs/plugin-react 6.1.1, vitest 5.0.1, @playwright/test 1.63.0, fake-indexeddb 6.2.5, fast-check 4.10.1, axe-core 4.13.0, @types/node 22.20.4. Exact trees are pinned in `package-lock.json`.

## Automated results

| Check | Command | Result |
| --- | --- | --- |
| Content manifest | `npm run content:check` | 5 corpora valid and up to date |
| Layout tables | `npm run layouts:check` | All six tables match xkb-data 2.42-1 |
| Typecheck | `npm run typecheck` | App, tests and Node configs pass |
| Unit and property tests | `npm test` | 255 tests in 16 files pass |
| Production build | `npm run build` | Passes; service worker and license notices generated |
| Browser tests, Chrome | `npm run test:e2e` | 26 of 26 pass, including a real 3 × 60-second benchmark set and six two-machine scenarios |
| Browser tests, Firefox | `npm run test:e2e` | 13 of 13 run pass; 13 Chrome-only tests are skipped |
| OS keymap harness | `npm run xkb:check` | 24 of 24 combinations verified: Chrome and Firefox × ANSI (`pc105`) and ABNT2 (`abnt2`) × `us(intl)`, `us(dvorak-l)`, `us(dvorak-r)`, `us`, `us(colemak)`, `us(workman)`. Each run calibrates every position and control and then types a full text under reference rules; see [the report](verification/xkb-os-check.json) |

Browser tests cover onboarding, calibration against emulated OS output (including dead keys and composition), the strict scorer in the real input surface, a real 3 × 60-second benchmark set, maintenance and switching fixtures, core completion, offline use of the production build, a killed page, backup/restore, storage failure, a second writer tab, accessibility, the expansion modes, and the two-machine module. Tests that emulate an OS layout through the Chrome DevTools protocol run in Chrome only, which is why part of the Firefox list is skipped; Firefox's own layout behaviour is covered by the OS keymap harness.

The first full browser run found one stale test expectation (onboarding now creates ledgers for all eleven modes) and one real defect: after a set earned the stage milestone, its result screen switched to the next gate instead of confirming the stage gate. Both were fixed and the affected specs re-run in both browsers.

In the full harness run, two combinations failed their first attempt and passed when rerun alone; both first attempts are kept in the report. Chrome/ANSI/Colemak lost every key after character 83 of 155 without any wrong character, consistent with the window losing focus inside the nested X server; the harness now fails any run whose text does not fully arrive, which the original pass criteria did not. Firefox/ABNT2/Dvorak-R stalled on the optional Caps Lock step (the harness now retries a stalled step once). Neither reflects a keymap difference, but they show the harness itself can drop synthetic events.


### Two-machine report

| Item | Result |
| --- | --- |
| Machines | Two isolated Chrome 154 browser contexts on one host (separate IndexedDB, focus and keyboards), each with its own profile, calibration and core-completion record; the real coordinator (`server/coordinator.mjs`) serving the production build |
| Network | Loopback. Clock estimates were about ±0–1 ms from 10 samples. A second test delays every coordinator message to one side by 250 ms: its estimate rose to ±125 ms and the run was labeled unsynchronized, as required |
| Runs | D1 QL/DR completed with separate outputs (4.0 and 2.8 WPM of deliberate partial typing) and synchronized evidence; D5 copy plus composition (production WPM, deletions, self-rated coherence, accuracy not measured, no efficiency) |
| Failure paths | Taken role rejected; manifest mismatch after a mode change blocks acknowledgement; stop on one side interrupts the other (`peer-stopped`); focus loss on one side stops both; a closed side makes the run incomplete while the survivor keeps its local record; unreachable coordinator leaves solo practice working |
| Local saves | Each side saves its own trial and side record before sending counters; the other side's counters arrive as a separate relay copy; side-file import adds the detailed stream, is idempotent, and rejects an altered manifest |
| Not yet done | A run on two physical computers over your own network (manual check M12) |

## Acceptance coverage

| Case | Where it is checked |
| --- | --- |
| A01 Independent modes | `tests/unit/evidence.test.ts` |
| A02 Correct layout | `tests/unit/calibration.test.ts`, `tests/unit/input.test.ts`, `e2e/input.spec.ts`; OS keymap harness |
| A03 Correct hand scope | `tests/unit/content.test.ts` |
| A04 Error history | `tests/unit/scoring.test.ts`, `e2e/input.spec.ts` |
| A05 Timing boundary | `tests/unit/scoring.test.ts` |
| A06 No free pause | `tests/unit/scoring.test.ts`, `tests/unit/evidence.test.ts`, `e2e/progression.spec.ts` |
| A07 Assistance honesty | `tests/unit/evidence.test.ts` |
| A08 Repeatability | `tests/unit/evidence.test.ts` |
| A09 Joint thresholds | `tests/unit/evidence.test.ts` |
| A10 Changing setup | `tests/unit/evidence.test.ts` |
| A11 Adaptation | `tests/unit/adaptive.test.ts` |
| A12 Plan budget | `tests/unit/planner.test.ts` (including a property check that plans never exceed the budget) |
| A13 Maintenance thresholds | `tests/unit/maintenance.test.ts`, `e2e/progression.spec.ts` |
| A14 Switching | `tests/unit/switching.test.ts`, `e2e/progression.spec.ts` |
| A15 Comparisons | `tests/unit/evidence.test.ts` |
| A16 Stable core | `tests/unit/evidence.test.ts`, `e2e/progression.spec.ts` |
| A17 Offline and recovery | `e2e/reliability.spec.ts` (production build, service worker, killed page) |
| A18 Backup safety | `tests/unit/backup.test.ts` (validation, checksums, newer/malformed data, idempotent merge, conflicts), `e2e/reliability.spec.ts` |
| A19 Composition and input | `tests/unit/input.test.ts`, `tests/unit/evidence.test.ts`, `e2e/input.spec.ts` |
| A20 Accessible operation | `e2e/accessibility.spec.ts` (axe WCAG 2.1 AA in light and dark themes, keyboard-only flow, 200% zoom, reduced motion) |
| A21 Save failure and concurrency | `tests/unit/storage.test.ts`, `e2e/reliability.spec.ts` |
| A22 Dual comparison | `tests/unit/dual.test.ts` (the 57.14% example, missing/stale/incompatible baselines) |
| A23 Two devices required | `tests/unit/coordinator.test.ts`, `tests/unit/dual.test.ts`, `e2e/dual.spec.ts` (two isolated browsers against the real coordinator) |
| A24 Composition limits | `tests/unit/dual.test.ts`, `e2e/dual.spec.ts` |

Property checks (`tests/unit/scoring.property.test.ts`, fast-check) cover the verification strategy's invariants: deleting and retyping correct text never raises output at the same elapsed time, corrections never remove a historical attempt, late events never change a frozen result, and seeded prompts are reproducible.

## What the automated checks cannot establish

- **Your physical keyboard.** Browser tests emulate what the OS delivers, and the OS keymap harness runs the real XKB keymaps inside a nested X server with synthetic key presses. Neither is your hardware, your GNOME input-source switching, or IBus on your desktop session.
- **Two real machines.** The two-machine tests use two isolated browser contexts on one host and a real coordinator; network latency was simulated for the clock-uncertainty case.
- **Other platforms.** Other browsers, operating systems, desktop sessions and keyboard geometries are unverified.

## Manual checklist

Record results in the last column (date, browser, pass/fail, notes). Every row is still open.

| # | Check | How | Result |
| --- | --- | --- | --- |
| M1 | Keyboard geometry | Onboarding's geometry question and detector: ANSI (one-row Enter, long left Shift) or ABNT2 (extra key beside left Shift, `/?` key beside right Shift). Note the keyboard model | Not yet run |
| M2 | Input sources present | GNOME Settings → Keyboard → Input Sources: add *English (US, intl., with dead keys)*, *English (Dvorak, left-handed)*, *English (Dvorak, right-handed)*. Note how you switch between them | Not yet run |
| M3 | QWERTY calibration | Setup → Calibrate `us(intl)` in Chrome and in Firefox; expect "Calibration passed" with no mismatches | Not yet run |
| M4 | Dead keys | In custom practice with `us(intl)`: `'` then `c` gives `ç`, `'` then Space gives `'`, `` ` `` then `a` gives `à`; the text `ação, café` scores 10 graphemes with none wrong | Not yet run |
| M5 | Dvorak-L calibration | Calibrate `us(dvorak-l)` in both browsers; `KeyQ` gives `;`, `KeyF` gives `d`, and the number row matches the on-screen map | Not yet run |
| M6 | Dvorak-R calibration | Calibrate `us(dvorak-r)` in both browsers; the number row and punctuation match the on-screen map | Not yet run |
| M7 | Wrong active layout | Select DL while `us(intl)` is active and type; the app flags the mismatch before any benchmark counts | Not yet run |
| M8 | Modifier strategy | Type capitals and symbols with your chosen Shift strategy in each mode; record it in Setup if it differs | Not yet run |
| M9 | One reference benchmark per core mode | Complete a 60-second benchmark in QL, QR, DL and DR; each result is *verified* | Not yet run |
| M10 | Offline daily loop | Open the production build once, go offline (or stop the server), reload, practise, and see the result saved | Not yet run |
| M11 | Backup round trip | Data → Download a backup; restore it in a fresh browser profile; milestones and trials are intact | Not yet run |
| M12 | Two real machines (optional) | Follow [two-machine setup](dual-machine-setup.md) with two computers; record the network, both clock estimates, a completed D1 run, and a disconnect | Not yet run |
