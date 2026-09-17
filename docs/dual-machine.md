# Optional two-machine endgame

This module implements section 15 of roadmap v1.2 after the four-mode core is complete. The user types on two different physical machines, one hand per keyboard, with independent target texts and visible context cues. It has its own release milestone and does not delay the core daily trainer.

## Experience and progression

The left role uses QL or DL, and the right role uses QR or DR. Allow later acquired expansion modes on their corresponding sides. A useful initial preset is QL on the left machine and DR on the right; the user can choose another pair. Each screen shows its role, hand, layout, target, and local progress. Side colors/themes reinforce the labels but never replace them.

Record keyboard placement/angle/feel and screen arrangement for both sides. The app can guide role calibration; it cannot verify the user's hand or attention. Ordinary browser keyboard events do not give the app a dependable way to route two keyboards to two unfocused applications on one machine, so the supported experiment uses two machines with a focused client on each.

| Level | Left/right tasks | Measurement |
| --- | --- | --- |
| D1 | Same simple string on both | Correct-output WPM and accuracy per side |
| D2 | Different fixed strings, e.g. letters versus digits | Per-side scores, possible substitutions |
| D3 | Two repeated phrases or short paragraphs | Per-side scores, stalls |
| D4 | Different continuous copy texts | Matched copy-task efficiency |
| D5 | Copy on one side, free composition on the other | Copy accuracy plus separate production metrics |
| D6 | Two dictation or independent composition streams | Showcase experiment; separately versioned protocols |

Default to D1 after solo stability is restored. Progress through D1–D4 when the user reports the tasks are manageable and both copy sides maintain at least 98% accuracy in three completed dual trials. This is a configurable coaching rule, not a claim of validated divided-attention training. D5/D6 require explicit selection and have no automatic correctness gate for unconstrained composition.

D1–D5 are the first optional module's scope. D6 remains an experimental follow-up: independent composition uses local text editors, while simultaneous dictation additionally requires recorded/transcribed audio fixtures and audio-start alignment. Do not advertise dictation scoring until that input path is implemented and validated.

## Coordinating two devices

Use a small optional coordination server that serves the app over HTTPS and a same-origin WebSocket endpoint on the user's network. Setup documentation must explain certificate trust on both machines, endpoint configuration, and connectivity checks. The core offline app remains independent. No account system or cloud storage is required.

The first device creates a room and shows a join URL/QR code with a random, unguessable room token. The second joins and takes the vacant role; duplicate role assignment is rejected. Room state is ephemeral, expires after inactivity, and is deleted when the experiment ends. Do not log room tokens or typed text. The relay handles readiness, timing, status, and final counters, not keystroke capture from other applications.

1. Create a manifest containing run ID, role/mode/setup revisions, task IDs/hashes, shared duration, protocol/scorer version, solo baseline references, and randomized task seed.
2. Each client calibrates its native layout, loads its text, checks its assigned role, and acknowledges the exact manifest hash. Both must be ready before arming.
3. Estimate client-to-coordinator monotonic-clock offsets using at least eight ping exchanges. Retain the sample with the smallest round-trip time, its half-RTT uncertainty estimate, and sample age. Sample again if older than 30 seconds.
4. Schedule a common coordinator start at least five seconds in the future. Both clients acknowledge it before the countdown. Cancel before start if either fails to acknowledge.
5. Each client converts the scheduled start/end into its local monotonic timeline. Count output only inside that common 60-second interval, including idle time. The first keystroke must not start an independent clock.
6. Record actual start-cue rendering time, estimated offset/uncertainty, and any deadline lateness. If either clock uncertainty or observed start-cue lateness exceeds 100 ms, label the run unsynchronized and exclude it from coordinated efficiency milestones. This is a measured alignment tolerance, not proof of exact simultaneity.
7. Each side saves its own complete trial locally, then submits final counters and status. The combined run becomes complete only after both matching role results arrive. A disconnect preserves local work but marks the coordinated run incomplete, even if results are imported later.

Focus loss, hidden pages, sleep, layout inconsistency, or a pause during the shared interval invalidates coordinated comparison. Provide a stop action on either machine that notifies the other; neither side's timer freezes to gain recovery time. Record which side and reason ended the run.

Offline per-side export/import is available for analysis and recovery. Two files with matching run IDs still need their original synchronization evidence; manually matching unrelated files cannot establish overlapping work. Deduplicate role results by run/role IDs and reject conflicting manifests.

## Solo baselines

Before a dual comparison, collect three solo trials per participating hand/layout and use their median WPM. Use the same side's keyboard/setup, task class, prompt difficulty, correction policy, and duration as the dual trial. For the same-string preset, use the same string; for different copy texts, use each side's own matched text. Store baseline trial IDs and dates.

These baselines use a fixed cue-started 60-second protocol, `dual-solo-copy-60-v1`, including initial hesitation. The core benchmark starts on first input, so its results are informative context but cannot silently stand in for these matched baselines. Default baseline freshness is seven days; older or changed-setup baselines require refresh for a milestone comparison.

Collect a fresh normal two-hand QWERTY baseline under the same cue-started duration and copy-task class when evaluating the “combined throughput exceeds two-hand speed” target. Do not compare dual output with a historical personal best from another site.

## Copy-task metrics

For D1–D4, use the core scorer's correct-output and attempt-accuracy definitions, with a shared fixed interval rather than independent first-input timers.

```text
dualCombinedWpm = dualLeftWpm + dualRightWpm
dualEfficiency = dualCombinedWpm / (soloLeftMedianWpm + soloRightMedianWpm)
leftCostFraction = 1 - dualLeftWpm / soloLeftMedianWpm
rightCostFraction = 1 - dualRightWpm / soloRightMedianWpm
```

Efficiency is a ratio; display it as a percentage without capping it at 100%. If either required baseline is missing/nonpositive, unverified, stale, or incomparable, display efficiency as unavailable with the reason. Never divide by zero or fill a missing side with zero performance.

Example: solo left 30 WPM, solo right 40 WPM; coordinated dual left 18 and right 22 gives 40 combined WPM and `40 / 70 = 57.14%` efficiency. Against a matched two-hand baseline of 50 WPM, the throughput milestone is not met.

The optional throughput milestone requires three coordinated dual trials on distinct dates with both copy sides at least 98% accurate, zero declared glances, and combined WPM above the matched two-hand baseline. Show both side outputs and task classes: two separate documents remain two separate outputs. A high combined total must not conceal one side ceasing to work.

## Stalls, substitutions, and composition

A stall is a gap of at least two seconds without a committed insertion on one side during the common interval. Include leading/trailing gaps, report count and total duration, and use the union of both sides' intervals for “both stalled.” This is an observable pause measure, not an automatic diagnosis of an attention collapse. Ask for self-reported collapses/notes after the trial.

For copy tasks, optional cross-stream analysis imports both detailed trial files onto one machine. Compare a wrong insertion with the other stream's expected character at the estimated aligned time. Mark a candidate only when it differs from this side's target; repeated/shared characters and uncertain alignment remain ambiguous. Report candidate counts alongside user-confirmed substitutions. Detailed text/event files are not uploaded to the coordination relay.

Free composition has no known correct target. Report retained-character production WPM, deletions, and self-rated coherence separately; accuracy and correct-output WPM are null on that side. Do not sum verified copy WPM and unvalidated composition WPM into a copy-efficiency milestone. A future composition-efficiency protocol needs matched solo composition tasks and explicit quality assessment criteria.

## Optional release acceptance

- Two machines with QL/DR join one room, verify matching manifests, and record separate outputs within a shared interval.
- Delayed readiness, wrong roles, stale clocks, visibility loss, and a disconnected side produce explicit invalid/incomplete outcomes.
- A fixed example produces the 57.14% efficiency above; stale/missing baselines produce no ratio.
- Reimporting both result files is idempotent, and mismatched run/manifests cannot merge.
- D5 reports unknown composition accuracy honestly, while preserving copy-side scoring.
- Solo practice still works with the relay unavailable.
