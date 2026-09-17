# Training protocol

This document operationalizes roadmap v1.2. Numerical rules that the roadmap leaves open are product defaults, recorded in [sources and decisions](sources-and-decisions.md). The [JSON defaults](../config/training-defaults.json) mirror these rules; measurements follow the [measurement contract](measurement.md).

## Modes and roadmap

| Suggested weeks | Primary | Maintenance | Stage advancement |
| --- | --- | --- | --- |
| 1–4 | QL | Optional Q2 baseline | 20 WPM, 97%, no looking |
| 5–8 | QR | QL twice weekly until acquired | 20 WPM, 97%, no looking |
| 9–12 | DL | QL and QR | 20 WPM, 97%, no looking |
| 13–16 | DR | DL, QL, and QR | 20 WPM, 97%, no looking |
| 17–20 | Core integration | All four | All four acquired and currently stable |

The dates are estimates, never automatic advancement triggers. A user can practice any core mode or select another primary mode. Manual stage advancement is logged as a plan override and confers no skill milestone. Optional layouts and the dual-machine module are offered only after core completion.

An optional paired-hand schedule alternates QL/QR across days, then DL/DR; it retains separate evidence and the same completion gate. Sequential training is the default. During integration, the primary mode is the unacquired mode furthest below its acquisition target, with ties resolved by least recent practice; if all are acquired, use the oldest outstanding stability check.

## Curriculum

Each mode has its own level, introduced key set, exercise history, and fingering version.

| Level | Exercises | Recommended evidence to move beyond the level |
| --- | --- | --- |
| 0 · Spatial map | Find letters, identify anchors, relocate between zones | Find all 26 letters correctly twice each in a shuffled assessment with no map assistance or physical glances; untimed |
| 1 · Home and anchors | Home positions, Space, Backspace, Enter, Shift | At least 95% attempt accuracy over 100 target insertions, plus a completed control-key exercise and comfort confirmation |
| 2 · Rows | Add top row, bottom row, then remaining number/symbol positions | At least 95% over 100 insertions covering every newly introduced printable key at least twice |
| 3 · Words | Common words and bigrams using learned keys | At least 10 WPM and 96% in two 60-second word drills; 15 WPM is a stretch target |
| 4 · Prose | Sentences, case, punctuation; later code | Stage gate: a qualifying benchmark set at 20 WPM and 97%, no looking |
| 5 · Acquired | Mixed prose and maintenance | Acquisition: three qualifying sessions at 30 WPM and 98%, no looking |
| 6 · Strong | More fluent prose; harder punctuation | Three qualifying sessions at 45 WPM and 98.5%, no looking |
| 7 · Showcase | 60+ WPM, 99%, or a named personal target | Three qualifying sessions at the configured target; a custom target is labeled separately |

For levels 1–3, assessments use the current mode/setup/ledger and may have assistance; retain the assistance label. Levels 0–3 are teaching recommendations, so the user can revisit or skip lessons. Benchmark gates and acquisition claims remain evidence-based.

Introduce **physical rows**, not the rows implied by letter names. One-hand Dvorak places letters on the number row, so its curriculum must include that row early enough to cover the complete alphabet. A core mode teaches its entire board, never only keys conventionally assigned to that hand in two-handed typing.

## Gates and evidence

A benchmark set is three eligible 60-second English prose trials from one session, under one frozen comparison configuration. Store median WPM and median accuracy, but require at least two of the three individual trials to meet **both** the speed and accuracy threshold. This prevents independent medians from manufacturing a joint pass. All three require zero physical glances, no keymap/finger assistance, and confirmation of the designated hand.

Stage advancement requires one such set at 20 WPM/97%. For acquisition and advanced milestones, first select the first complete eligible set for each local date within the same comparison configuration. The latest three of those daily reference sets must pass their respective thresholds. Use the session's recorded timezone/date; changing today's timezone cannot relabel history. A later low result remains visible and affects current stability, although only one set per mode/date contributes to the acquisition sequence. Invalid attempts are retained but do not count as eligible sets.

The three-date rule and two-of-three joint pass are repeatability defaults added by this specification. Three tests in one sitting never become three acquisition sessions. Other settings create a named custom protocol whose achievements do not substitute for the reference protocol.

Acquisition is a historical event with immutable supporting trial IDs. Current stability is separate: the latest eligible set for each core mode must pass 30 WPM/98% with no looking and be no more than 14 days old. Core completion is reached when all four modes have acquired milestones and satisfy this stability check. Store that completion event; later rustiness triggers maintenance without erasing achievement or re-locking expansions. Recommend restoring stability before a dual-machine trial.

Retention and switching are separate checklist items. A retention check compares the first eligible benchmark after at least seven days without practice in that mode with its acquisition baseline. Report speed loss; the roadmap's retention target is **less than 15% loss**, with accuracy at least 98%. An ordinary weekly session does not prove retention after a break if the mode was practiced in between.

## Sessions and scheduling

| Block | Standard session | Deep session |
| --- | --- | --- |
| Warm-up and relocation | 3 min | 5 min |
| Weak keys/zones | 7 min | 10 min |
| Words/bigrams | 10 min | 10 min |
| Timed prose or code | 7 min | 10 min |
| Switching | Included on switching days | 5 min |
| Logging / benchmark and notes | 3 min logging | 5 min benchmark and notes |
| Total | 30 min | 45 min |

These reproduce the roadmap's block budgets. “Untimed words” means there is no per-word deadline; the session block still has a suggested end. A benchmark set uses three minutes of tests plus two one-minute rests. Move notes outside that five-minute block by reducing another block; never omit them to satisfy a timer.

On Friday, move the benchmark to after a light warm-up, before demanding drills. For a standard 30-minute Friday, allocate 3 minutes warm-up, 5 benchmark, 7 weak keys, 7 light words, 5 switching, and 3 logging. If switching is not yet appropriate, replace it with light practice. If fatigue is already high, offer a fresh benchmark session another day.

The default cadence is Monday accuracy, Tuesday weak keys, Wednesday primary plus maintenance, Thursday prose/code, Friday benchmark plus switching. Saturday is optional and Sunday is off or easy maintenance. A user can change practice days and shorten a session without generating catch-up debt.

The planner first reserves warm-up and logging, then inserts due maintenance by reducing primary word/prose blocks. Never append maintenance beyond the chosen budget. Prefer one maintenance mode per day and at most two modes total in a standard session. Use other selected weekdays when Wednesday is full. If demand exceeds the available budget, show what was deferred and why.

## Maintenance

Before acquisition, previously advanced modes receive two five-minute slots per week. After acquisition, schedule one 5–10 minute slot per week; an eight-minute slot can contain a light warm-up and a complete benchmark set. A slot without a benchmark still counts as practice but cannot invent measurement evidence.

Define the baseline as the arithmetic mean of the three session-median WPM values supporting acquisition, within the same comparison configuration. Define current performance as the arithmetic mean of the latest three comparable session-median WPM values. If `1 - current / baseline > 0.15`, raise maintenance to two slots weekly. Accuracy below 98% on the latest eligible set also triggers two slots. If baseline is zero or fewer than three comparable sets exist, show “Insufficient evidence.”

Return to one slot when the latest three comparable sets are within 15% of baseline and each has median accuracy at least 98%. Prioritize regressing modes, then overdue modes by days overdue, then least recently practiced. Missing practice does not itself establish measured decline. The acquisition baseline is frozen; recomputing it from recent weak results would hide decline.

Setup/ledger changes begin a new series; offer three reference sets to establish a new maintenance baseline, while preserving the original milestone. Baselines from different setups must never be averaged together.

## Adaptive drills

Use the latest 500 insertion attempts from at most five completed blocks in the same mode, setup, and ledger version. Count opportunities for each expected character/position. Rank error rate only after at least 20 opportunities; show counts alongside rates. With sparse data, rotate introduced keys for coverage and show “Learning your weak spots.”

Choose up to three weak targets. Use 60% target-heavy material, 30% mixed known material, and 10% coverage review, measured by generated character slots. Sample deterministically from a stored seed. Build real words when possible; fall back to clearly labeled artificial sequences when the allowed alphabet cannot form enough words. Do not introduce an unlearned character just to satisfy a word generator.

Offer relocation drills between configured zones, anchor returns, repeated-finger sequences from the ledger, common bigrams, correction keys, numbers, and punctuation. A finger assignment describes the user's plan; the tool cannot verify actual finger use. Use correct-to-correct event intervals to suggest slow bigrams only with at least ten samples, excluding pauses and switch preparation.

For an error, compare the received physical position with the position that would produce the expected character in the previous mode. If uniquely consistent with that previous map, mark “possible previous-layout intrusion.” Preserve competing explanations and raw counts. Same-layout hand switches cannot be identified as wrong-hand events from characters alone.

## Switching

1. **Blocked:** stay in a mode for 10–20 minutes, then display the next cue with a deliberate 5–10 second reset. This is available while learning and is usually unscored.
2. **Paired:** alternate two acquired modes every 2–5 minutes. Keep both mode names visible and collect directional latency probes between blocks.
3. **Randomized:** after paired practice, cue acquired modes before 30–60 second trials. Select uniformly from the eligible pool, excluding immediate repeats; record the seed and actual order. Default pool contains only QL/QR/DL/DR. Optional layouts join only after core completion and their own acquisition.

Suggested readiness for randomized practice is five successful paired probes in each direction, with median latency below ten seconds and no reported glances. This is a coaching recommendation, not another acquisition gate.

Latency starts when the new cue is visibly presented and ends on ten consecutive correct target insertions without correction. Wrong insertions and any Backspace reset the streak. Native OS-switching time and hand repositioning remain inside the latency. The [measurement contract](measurement.md) defines timeouts, focus loss, and aggregation. Targets are below ten seconds for familiar pairs and eventually below five; they are observations, not guaranteed outcomes.
