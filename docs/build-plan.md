# Build plan and acceptance

This repository specifies the product, supplies its [visual design handoff](../design/README.md), and now contains the application built from the milestones below. The first usable release completes milestones 1–4. Optional expansion work follows independently. What was verified for each milestone, and what still needs a physical keyboard, is recorded in [the verification report](verification.md).

## Milestone 1: Input and measurement

Build the native-input adapter, layout registry, first-run calibration, strict append/tail-Backspace reducer, monotonic timing, frozen prompts, and trial records. Start with QWERTY but finish QL/QR/DL/DR calibration fixtures before declaring this milestone complete. Include a minimal practice/result screen and local trial saving so the measurement foundation is usable.

Use the extracted [design tokens](../design/tokens.css) and screen reference to build application components. The export's preview runtime and simulated counters/saving remain reference material; implement the domain contracts directly. Include the [handoff corrections](../design/REVIEW.md) in component behavior and responsive styling.

Deliver the full base/Shift/control mappings for the user's actual physical profile, with source/license attribution. Verify Dvorak-L and Dvorak-R against OS output, including the number row. Supply original reference content and a manifest.

Exit: the [measurement examples](measurement.md) pass automated checks; OS-native input on all three core layouts passes manual checks; an interrupted test cannot produce reference evidence. No charts are required to validate this milestone.

## Milestone 2: Guided acquisition

Add onboarding, the four-mode catalog and Q2 baseline, levels 0–7, fingering/zone setup, assistance modes, session templates, declarations, benchmark sets, and progression gates. Add the sequential 20-week outline and optional paired-hand planning.

Exit: a user can start from level 0, practice a selected hand across the full board, complete a benchmark set, and see exactly why advancement/acquisition did or did not occur. Three tests in one sitting never acquire a mode. Fixtures can demonstrate the entire progression; do not make the implementer wait 20 weeks to validate software behavior.

## Milestone 3: Maintenance and integration

Add adaptive drills, due maintenance inside the budget, immutable baseline comparisons, blocked/paired/randomized switching, the four-mode progress view, retention checks, monthly fixed-text comparisons, and the core completion event.

Exit: a synthetic history with a weak acquired mode produces the correct maintenance frequency and bounded daily plan; directional switching results retain timeouts and missing pairs; four stable acquired modes unlock the post-core area. Actual training remains on the core catalog until completion.

## Milestone 4: Offline reliability and personal-use release

Complete offline caching/update behavior, error recovery, persistence visibility, import/export, migration/restore handling, accessibility, and the manual compatibility matrix. Record dependency versions, build commands, and actual verification results in the implemented repository.

Verify the design review's implementation checks, including hand-scoped zone colors, live block counts, declaration defaults, contrast, reflow without assistance changes, and licensed local fonts.

Exit: the entire core daily loop works offline; full backup/restore preserves milestones and source evidence; a storage failure or second writer cannot silently lose or double-count work. This is the release gate for the core app.

## Milestone 5: Optional layout expansion

After core completion, add CL/CR and WL/WR as ordinary full-board layouts with independent hand ledgers and the same curriculum. Verify and attribute their maps; keep standard Colemak distinct from Colemak-DH and Workman distinct from its variants. Optional results occupy an expansion section rather than changing the four-mode completion denominator.

Half-QWERTY requires a separately verified mirror-modifier input path, including tap/hold timing, Space, modifiers, editing keys, and per-hand maps. Do not implement it as an automatic reinterpretation of QL/QR. If emulated within the app, identify that input path in every result; native and emulated evidence remain separate. Experimental Half-Colemak, Colemak-DH, and custom layouts remain later catalog additions with the same verification requirements.

Exit: expansion modes cannot overwrite core histories, and no optional layout is needed to finish the 20-week program.

## Milestone 6: Optional two-machine module

Implement the coordination service, two roles, matched solo baselines, D1–D5 tasks, shared timed intervals, per-side results, aggregate efficiency, stalls, and import-based cross-stream analysis in [the module specification](dual-machine.md). Preserve two separate locally saved output streams.

Exit: pass its two-device acceptance scenarios, including connection loss and clock uncertainty. D6 dictation/dual-composition experiments are a subsequent extension with explicit audio/quality measurement requirements.

## Acceptance matrix

| Case | Requirements | Given / action / expected outcome |
| --- | --- | --- |
| A01 · Independent modes | P01 | Acquire QL in a fixture; QR/DL/DR remain unacquired and retain independent lessons/ledgers |
| A02 · Correct layout | P01, P02 | Select DL with QWERTY active; calibration identifies output mismatches. With Dvorak-L active, `KeyQ` yields `;` and `KeyF` yields `d` |
| A03 · Correct hand scope | P03, P07 | Train QR; all alphabet positions are reachable in lessons and prompts use the configured right-hand ledger |
| A04 · Error history | P09 | Type `c`, `x`, Backspace, `a`, `t` against `cat`; attempt accuracy is 75%, not 100% |
| A05 · Timing boundary | P09 | Delay a timer callback and deliver input at/after 60,000 ms; those insertions never enter a reference result |
| A06 · No free pause | P02, P09 | Blur, pause, hide, reload, or sleep during a benchmark; preserve an interrupted record and require a new trial |
| A07 · Assistance honesty | P04, P12 | Reveal a keymap or leave glances unknown; no no-look milestone is granted. Restoring the hidden display does not erase the event |
| A08 · Repeatability | P04 | Complete three passing tests on one date; show one qualifying set. Award acquisition only after the required dated sets |
| A09 · Joint thresholds | P04, P09 | Use the independent-median counterexample from measurement.md; the set fails despite headline medians of 31 WPM/98% |
| A10 · Changing setup | P07, P10 | Edit a ledger/keyboard profile; old trials render with their original setup, and new results start a new comparison series |
| A11 · Adaptation | P06 | Provide three errors in only three opportunities; show insufficient samples rather than declaring a statistically settled weak key. With 20+ opportunities, use the defined ranking and seed |
| A12 · Plan budget | P05 | Queue three overdue modes with a 30-minute budget; schedule at most two modes, preserve warm-up/logging, and disclose deferred work |
| A13 · Maintenance thresholds | P05, P10 | Baseline 40/current 34 does not trigger the greater-than-15% rule; 33.9 does. Low accuracy independently triggers extra maintenance |
| A14 · Switching | P08, P09 | Error during a probe resets its streak, not its cue clock. OS menu preparation consumes latency. A 30-second timeout never appears as a successful latency |
| A15 · Comparisons | P09, P10 | Switch corpus, text type, correction policy, or scorer version; preserve labels/series. A monthly fixed passage does not satisfy rotating-corpus acquisition |
| A16 · Stable core | P04, P13 | Acquire QL/QR/DL/DR but leave one current set older than 14 days; request stability evidence before first core completion. Later decline preserves the awarded completion |
| A17 · Offline and recovery | P11 | Cache once, disconnect, complete a session, restart, and review saved results. Kill the page mid-run; recover an interrupted journal |
| A18 · Backup safety | P11 | Restore a valid backup; IDs/evidence survive. Reimport identical data without duplicates. Reject malformed/newer/conflicting data atomically |
| A19 · Composition and input | P02, P09 | Commit a composed `é` in custom practice; count one grapheme. Paste/autocorrect/unknown insertion provenance cannot earn a reference result |
| A20 · Accessible operation | P12 | Complete start/practice/end/review with keyboard controls, visible focus, 200% zoom, reduced motion, and a screen-reader-compatible input; no focus trap |
| A21 · Save failure/concurrency | P11 | Fill storage or fail a commit; show unsaved status and a recovery download. A second tab cannot write a competing active trial |
| A22 · Dual comparison | P13 | Solo 30+40 and synchronized dual 18+22 produce 57.14% efficiency; no ratio is shown for a missing, stale, or incompatible baseline |
| A23 · Two devices required | P13 | Two real machines join distinct roles, calibrate their layouts, and type different targets. Swapped manifests/roles or a lost side invalidate the combined run |
| A24 · Composition limits | P13 | In D5, the copy side has scored accuracy while the composition side has unvalidated production WPM and null accuracy; no copy-efficiency milestone is granted |

## Verification strategy

Automate the numerical/state/data invariants rather than UI snapshots that merely copy the implementation. Include property checks that repeatedly deleting/retyping already correct text cannot inflate output at the same elapsed time, correction never removes a historical attempt, late events cannot change a frozen result, seeded prompts are reproducible, and scheduling never exceeds its budget.

Use browser integration tests for the native text-event adapter, composition reconciliation, caret/control behavior, offline asset availability, import transactions, and recovery. Test blocked/paired/randomized state transitions with a controlled clock. Hardware tests must verify actual OS output; synthetic `KeyboardEvent` fixtures alone cannot certify a keymap.

The implementation release report must record the actual keyboard model/geometry, Linux desktop/session type, browser/version, selected OS layout variants, modifier strategy, and checks performed. The initial target is Chromium and Firefox on that Linux setup; other browser/OS/geometry combinations stay unverified until tested. The dual report additionally records two machines, network conditions, synchronization estimates, disconnection tests, and independent local saves.

The application's unit, browser and OS-keymap results, and the release report fields above, are recorded in [verification.md](verification.md).
