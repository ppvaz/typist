# Measurement contract

All formulas here are versioned Typist conventions. They are not a promise that another typing site uses the same WPM or accuracy definition. Show metric definitions in the result details and export their protocol version.

## Text and editing model

Reference text is a frozen sequence of NFC-normalized graphemes. English reference text contains printable ASCII plus spaces, including case and punctuation. Spaces and punctuation each count as one character. Practice code can include newlines; tabs are normalized to spaces when the exercise is created, and that normalized prompt is frozen.

The benchmark buffer starts empty. Each inserted grapheme is compared with the target at the current buffer length and appended, whether right or wrong. The cursor advances after a wrong character; no automatic stop-on-error occurs. Backspace removes the last buffered grapheme. It does not erase the historical attempt or error. Other editing policies are practice-only and produce different protocol IDs.

This strict positional model makes a missed character cause later mismatches until the user corrects the buffer. The UI must make that behavior apparent. Do not silently realign words or use edit distance for the reference WPM. Feed enough frozen text for the entire trial; premature exhaustion is an invalid trial, never a fast completion.

## Per-trial metrics

Let `T` be measured active seconds, `A` all committed insertion attempts (including retries), `C_attempt` insertion attempts matching their target at insertion time, `C_final` positions correct in the final buffer, and `E_final` incorrect positions remaining in that buffer.

```text
WPM              = (C_final / 5) / (T / 60)
Raw WPM          = (A / 5) / (T / 60)
Attempt accuracy = 100 * C_attempt / A
Residual errors  = E_final
Correction count = number of graphemes removed by Backspace
```

Deleting and retyping correct text can increase raw WPM, but cannot inflate final correct-output WPM. Backspaces/modifier presses do not count as insertion attempts. Retain wrong attempts even after correction. Count attempted Backspaces separately from removed characters when the buffer is empty.

Before any insertion, WPM/raw WPM/accuracy are `null`. In a completed, nonempty timed trial, zero correct output means WPM 0. Accuracy is undefined when `A = 0`; never present 100% for no work. Store unrounded values and compare gates against them; round WPM to one decimal and accuracy to two decimals only for display.

Use exact counter ratios or decimal arithmetic at threshold boundaries. For example, a 98% accuracy gate can compare `100 * C_attempt >= 98 * A`, and the maintenance trigger compares `100 * current < 85 * baseline`. Binary floating-point noise must not turn a decline from 40 to 34 WPM into a greater-than-15% loss.

| Worked case | Expected result |
| --- | --- |
| 60 seconds, A=200, C_attempt=196, C_final=190 | WPM 38; raw 40; accuracy 98% |
| Target `cat`, events `c`, `x`, Backspace, `a`, `t`; T=60 | A=4; C_attempt=3; C_final=3; WPM 0.6; raw 0.8; accuracy 75%; one correction |
| Target begins `abc`, events `a`, `a`; T=60 | A=2; C_attempt=1; C_final=1; WPM 0.2; accuracy 50%; one residual error |
| Target `a`, repeatedly type `a` then delete it; end empty | C_final=0 and WPM 0, regardless of raw WPM |
| Calculated accuracy 97.995% displayed as 98.00% | Fails a 98% gate because comparison uses the unrounded value |

Physical glances are self-reported integers ≥0 or unknown. Onscreen keymap/finger assistance is observed automatically. Hand confirmation and unrecorded assistance are separate declarations. Fatigue and effort are ordinal self-ratings 0–5; do not average them into an invented health score.

## Timing

An ordinary benchmark becomes armed after calibration and countdown. Its first committed insertion, including a wrong one, establishes `t0`. Use a monotonic clock. Include events with `0 <= eventTime - t0 < 60000 ms`; finish at exactly 60 seconds. Inactivity after the first insertion consumes time. A delayed render/timer callback must not admit late characters.

Untimed practice uses active duration excluding explicit pauses, and reports its duration convention. Its WPM is practice feedback, not benchmark evidence. Sleep, navigation, reload, pause, blur, or tab hiding after benchmark start make the trial interrupted. Preserve the partial record but require a fresh trial for a reference score. A zero-input armed trial may be canceled without generating a benchmark.

## Benchmark sets and eligibility

The reference protocol is `english-prose-60-v1`: three 60-second native-layout prose trials, same mode and setup, normal tail Backspace, one-minute rests between trials, no stop-on-error, and no adaptive text. Use a frozen corpus version and store each passage ID, hash, and selection seed. Accuracy-first word tests, code, quotations, and custom text are separate protocols.

Create a complete set from three technically valid trials in one practice session. Structurally eligible sets use the reference protocol and have completed hand/assistance/glance declarations. Positive glance counts or recorded help can still produce a measurable set, but they fail its no-look qualification. Unknown declarations leave the set pending. Wrong-hand confirmation excludes the set from that mode's reference evidence.

Assistance revealed during a test is recorded as an observation that fails qualification; it does not retroactively change the frozen hidden-keymap policy to make the run pass. An interrupted or otherwise invalid trial remains in history; a replacement gets a new ID. The first three valid trials with complete declarations form the set, so a user cannot choose the best three scores afterward. A set containing a known no-look failure still counts as that day's first eligible set.

Report medians of each metric independently, but evaluate gates with the joint-pass rule in the [training protocol](training-protocol.md). Example: trials at `(32 WPM, 96%)`, `(31 WPM, 99%)`, `(29 WPM, 98%)` have medians 31 WPM and 98%, yet only one trial jointly reaches 30/98; the set fails acquisition qualification.

The configuration signature for longitudinal comparison includes protocol/scorer version, mode, exact layout revision, geometry, setup revision, fingering revision, native/emulated input, modifier strategy, corpus/version/language/text class, duration, and correction/assistance policy. Date and random passage choice within the same corpus do not create new series.

For the monthly cross-mode comparison, intentionally vary mode/layout/ledger while holding hardware, chair/desk, modifier strategy, duration, correction policy, language, and the fixed passage constant. Record per-hand keyboard offset rather than pretending both hands have the same physical placement. Show any deviations alongside the matrix. The monthly fixed-passage protocol does not feed the ordinary rotating-corpus acquisition gate.

External manually entered results retain their original metric definitions and source. They can appear in notes and separate charts, but do not satisfy reference gates. A full Typist backup with validated versions and evidence may restore its original milestones.

## Errors and interference

Store both expected character and produced character, target position, actual physical code where known, modifier state, and trial-relative timestamp. Aggregate errors by expected character and by physical target position separately; `KeyF` is a position, not necessarily `f`.

An expected-position error rate is wrong insertion attempts divided by all insertion opportunities for that position. Show the denominator. A layout-intrusion annotation records the candidate source layout, matching alternative position, and ambiguity; it never asserts the user's intention. Unknown physical codes stay unknown. Hand errors and finger errors require user notes.

## Switch latency

Start the latency timer when the next mode cue is painted. The OS switch and hand movement occur after that cue and remain in the interval. The first target character starts a ten-character streak; every wrong insertion or Backspace resets it. Complete the probe at the tenth consecutive correct insertion. Count spaces/punctuation as characters under the same target model.

Example: cue at 0 seconds, error at 3 seconds, tenth correct insertion of the next uninterrupted streak at 8.4 seconds gives latency 8.4 seconds, not 5.4. A “ready” action may restore focus but cannot reset the clock. Probe characters never feed an acquisition benchmark.

Timeout at 30 seconds records `timeout` and a 30-second lower bound, not a fictitious successful 30-second result. Report median successful latency plus successful count / attempts and timeout/interruption counts. With no completions, median is null. With fewer than five successful probes, mark the estimate preliminary.

OS input menus may move focus during the preparation portion of a probe. Allow that preparation time while the page remains visible; the timer keeps running. Once the first target insertion occurs, blur interrupts the probe. Hiding the page, device sleep, or an unobservable interval invalidates it even during preparation. Count these interruptions in the outcome table.

Pair `QL → QR` is a hand-only switch; `QL → DL` is layout-only; `DL → DR` changes both hand and logical layout. Preserve directions. Never claim all pairs are fluent from an aggregate median that hides an untested pair.

After a successful latency probe, a separately cued 30–60 second practice segment may begin with a fresh timer. This is deliberately a different measurement; do not subtract the preparation cost from the recorded switch latency.

## Reference examples for implementation

| Condition | Expected interpretation |
| --- | --- |
| Three passing tests today | One passing session, not acquisition |
| Three qualifying dated sessions for DL | DL acquisition; DR remains independent |
| 30 WPM/99%, physical glances unknown | Pending qualification, no inferred zero |
| 35 WPM/99%, hidden map revealed mid-test | Measurable assisted result; no no-look pass |
| Acquisition baseline 40 WPM, current rolling mean 34 | Exactly 15% loss; no speed-triggered maintenance increase |
| Baseline 40, current 33.9 | 15.25% loss; increase maintenance |
| One-week retention check at exactly 15% loss | Fails the stricter roadmap retention target of less than 15% |
| New keyboard or ledger revision | New comparison series; old milestones preserved |
| Combined dual-machine output | Use [dual-machine measurements](dual-machine.md), never the sum of unrelated historical bests |
