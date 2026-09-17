# Typist product specification

Version 1.0 · 17 September 2026 · based on roadmap v1.2 · specification, ready for implementation

## Purpose

Turn the supplied ambidextrous typing roadmap into a daily practice system. A general typing test measures a run; this tool must also answer: which mode needs attention today, which movements are failing, whether improvement survives correction costs, and whether earlier skills remain available after learning another layout.

The primary user is one person learning the four core modes QL, QR, DL, and DR on a normal physical keyboard. The application must support slow acquisition from the first spatial drills through useful prose typing and deliberate switching. Dominance is a profile field, not a reason to combine hands into one score.

## Outcomes and evidence

| Outcome | Evidence shown to the user |
| --- | --- |
| Acquire each core mode | Three qualifying benchmark sessions, with dates, trial results, and no-look declarations |
| Type accurately before seeking speed | Attempt accuracy beside WPM everywhere; explicit failed gate reasons |
| Locate keys without looking | Self-reported physical glances plus automatic recording of onscreen keymap assistance |
| Use a repeatable one-hand technique | Separate, versioned fingering ledgers; relocation and finger drills |
| Preserve learned modes | Due maintenance, comparable rolling results, and a visible retention check |
| Switch deliberately | Directional mode-pair latency, completion rate, and recorded intrusion errors |
| Keep practice sustainable | Editable time budget, fatigue and effort logs, easy stopping and rescheduling |
| Reproduce the experiment | Frozen benchmark settings, corpus versions, setup snapshots, and exports |
| Explore the optional two-machine endgame | Matched solo baselines, coordinated dual trials, throughput per side, and dual efficiency |

Core completion means four historical acquisition milestones with recent comparable evidence for each. A combined average must never conceal an unacquired mode. Integration additionally reports retention and switching separately; acquiring all four does not automatically prove either. Optional layouts and two-machine training become available after that completion gate; neither is required to finish the core program.

## Scope and defaults

The first complete release includes all four core modes, levels 0–7, the sequential roadmap, 30- and 45-minute session templates, adaptive weak-key drills, maintenance, three switching stages, three-test benchmarks, monthly comparisons, a fingering ledger, local persistence, and import/export.

Use a desktop web application with offline operation after initial loading. Default to Linux and US ANSI only as an initial setup hypothesis; the first-run calibration establishes the actual profile. The architecture must separate physical geometry, logical layout, and fingering. Other geometries remain explicitly unverified until their maps and input behavior pass the same checks.

English prose is the canonical benchmark track. Include an original English word/prose corpus, basic numbers and punctuation, and small original code exercises. Custom English or Portuguese text is allowed in practice with composition-aware input; it cannot silently change a reference benchmark. UI copy starts in English, with strings isolated for later translation.

The initial release has no account system, cloud synchronization, leaderboards, OS remapping driver, global keyboard capture, camera-based hand or gaze detection, or medical/cognitive-benefit scoring. Colemak, Workman, Half-QWERTY, experimental Half-Colemak, Colemak-DH, and two-hand alternative-layout baselines belong to later expansion. A two-hand QWERTY baseline is included at onboarding, outside the four-mode acquisition count. The [two-machine module](docs/dual-machine.md) is specified as a later release, including a small coordination service separate from the core offline app.

## Main workflows

### First use

1. Ask for dominant hand, keyboard geometry/model, OS, preferred practice days, time budget, and start date. Default to five weekdays and 30 minutes; offer 45 minutes.
2. Explain the four modes with the distinction between ordinary full-board QWERTY and the two dedicated Dvorak variants.
3. Create a keyboard/setup profile. Record keyboard offset, chair/desk notes, modifier strategy, and any hardware or OS remaps.
4. Guide installation/selection of the intended OS input source. Run calibration for QWERTY now; calibrate the other two layouts before first use.
5. Offer a two-hand QWERTY baseline, with a skip action. Store it as `Q2`, never as QL or QR.
6. Start QL level 0 by default. Allow another primary mode or an existing-skill assessment without claiming prior acquisition.

### Today

Show one clear primary action: **Start today's session**. Display primary mode, current level, planned minutes, maintenance due, and the next unmet gate. The generated plan is editable before starting.

The default 20-week outline is a forecast. Unmet gates extend a stage; missed days move planned work forward without accumulating extra workload. Show the next recommended activity rather than an overdue streak penalty.

If historical data are absent, show calibration and spatial practice. If practice has been interrupted, offer the unfinished untimed block and disclose that any interrupted benchmark needs a fresh trial.

### Practice

Keep the active mode label large and persistent, for example `DL · Dvorak Left-Handed · Left hand`. Show target text, current character, elapsed/remaining time, and the current exercise goal. Speed may be hidden in learning sessions; accuracy feedback remains available.

Offer three assistance levels: full keymap with configured fingers/zones, anchors only, and no keymap. Track assistance usage automatically. Distinguish a physical keyboard glance from reading an onscreen keymap. Early assisted practice is useful, but both kinds of assistance prevent no-look benchmark qualification.

The user can pause untimed practice, end any block, or shorten the plan. Leaving an active benchmark interrupts it instead of providing free thinking time. During a block, do not silently switch its layout, fingering version, text policy, or correction policy.

After a block, show one actionable observation supported by enough data, such as “`KeyY` was missed 7 of 28 attempts in QL; practice the center-to-right movement.” Use tentative wording for inferred layout interference. Never state which finger or hand was actually used from keyboard events alone.

### Review and log

For every benchmark trial, require a physical-glance count or “unknown,” confirmation of the stated hand, and whether unrecorded assistance was used. For a session, collect fatigue before/after, effort 0–5, and an optional one-sentence note. Missing declarations leave evidence pending; do not default them to zero or false.

Show results immediately in memory, but mark them saved only after the local transaction succeeds. Explain a failed gate using its actual missing conditions. Offer the next session suggestion and export without making the user fill a long form.

### Progress

The overview is a four-card or four-row matrix. Each mode shows level, historical milestone, latest comparable median WPM/accuracy, glance status, maintenance due, and date of last evidence. Unmeasured values render as “No evidence,” not zero.

A mode detail view provides WPM and accuracy trends, a table alternative to charts, key/position errors, bigram hesitation, assistance use, fatigue, setup changes, and the fingering ledger. Chart series are separated by benchmark configuration. The user can compare different setups side by side, with visible labels.

Switching has its own directional matrix. `QL → DL` and `DL → QL` are different entries. Separate hand-only switches, layout-only switches, and changes of both. Display successful-trial median, sample size, and timeout/interruption rate together.

The monthly view repeats the same fixed passage in each acquired mode, records any missing modes, and can be spread across several days with dates shown. It never extrapolates missing results.

## Functional requirements

| ID | Requirement | Detailed contract |
| --- | --- | --- |
| P01 | Four independent core modes and distinct layout variants | [Input and layouts](docs/input-and-layouts.md) |
| P02 | Calibrated OS-native typing and explicit mode cues | [Input and layouts](docs/input-and-layouts.md) |
| P03 | Spatial, anchor, row, word, prose, and advanced curricula | [Training protocol](docs/training-protocol.md) |
| P04 | Advancement and acquisition with auditable evidence | [Training protocol](docs/training-protocol.md) |
| P05 | Daily plans and maintenance inside the time budget | [Training protocol](docs/training-protocol.md) |
| P06 | Adaptive position, key, bigram, and relocation drills | [Training protocol](docs/training-protocol.md) |
| P07 | Fingering ledger with revision history | [Input and layouts](docs/input-and-layouts.md) |
| P08 | Blocked, paired, and randomized switching | [Training protocol](docs/training-protocol.md) |
| P09 | Reproducible benchmark and switch measurements | [Measurement contract](docs/measurement.md) |
| P10 | Progress, retention, monthly matrix, and baselines | [Measurement contract](docs/measurement.md) |
| P11 | Local storage, offline use, recovery, and backup | [Architecture](docs/architecture.md) |
| P12 | Keyboard-accessible UI and honest assistance reporting | This document and [build acceptance](docs/build-plan.md) |
| P13 | Post-core layouts and coordinated two-machine practice | [Two-machine module](docs/dual-machine.md) and [build plan](docs/build-plan.md) |

## Interaction and quality requirements

Use the supplied [visual design system](design/README.md) for typography, palettes, hand identity, component appearance, and screen composition. Its original canvas is preserved alongside normalized tokens. Apply the [design review](design/REVIEW.md) when building responsive layouts, keyboard controls, and live result states; the behavioral and measurement contracts in this specification govern the application.

- Every control works by keyboard and pointer, including mode selection, recovery, and logging. Use native controls, visible focus, readable labels, adjustable type size, and an escape path from the typing area. Shortcuts must be optional and remappable because a comfortable position changes with each mode.
- Do not convey errors or progress solely through color. Respect reduced motion. Provide result announcements and an accessible text entry field; do not overwhelm screen-reader users with per-keystroke announcements. Prompt narration or other typing assistance must be recorded when it affects benchmark comparability.
- Practice must remain usable at 1280×720 and 200% zoom with reflow. Smaller screens may review progress, but the tested training target is a desktop with a physical keyboard.
- No network request is required to start, complete, or review a cached session. Assets and corpora are versioned and cached locally. Optional reference links are clearly external.
- Bundle the design's font files with their licenses for offline use. Disable programming ligatures in scored practice text so each displayed character remains distinct.
- Input feedback should paint within 50 ms at the 95th percentile on the recorded reference machine. Measurement uses event timing, not render timing. A 10,000-trial local history should open a filtered progress view within one second on that machine.
- All acquisition labels must show their supporting sessions and protocol version. A setting change does not rewrite past results or invent equivalent evidence.
- Preserve the roadmap's instruction to stop or reduce practice when discomfort appears. Logging high fatigue suggests rest or a shorter session; fatigue never grants progress, and stopping never creates a penalty.

## Release completion

The core tool is ready for personal use when a clean profile can proceed through calibration, practice, benchmarking, evidence-based progression, maintenance, switching, and backup/restore for every core mode. The [build plan](docs/build-plan.md) supplies the acceptance cases and a separate release gate for the optional endgame. Success is a functioning daily learning loop with trustworthy measurements; finishing the software is distinct from the user completing 20 weeks of training.
