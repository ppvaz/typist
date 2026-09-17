# Sources, traceability, and decisions

## Source of truth

The user supplied **Ambidextrous One-Hand Touch Typing Roadmap v1.2**, September 2026, on 17 September 2026. This revised 12-page PDF supersedes the earlier v1.0 draft for this specification.

- Repository copy: [roadmap v1.2](../references/Ambidextrous_One-Hand_Touch_Typing_Roadmap_v1_2.pdf).
- Original filename: `Ambidextrous_One-Hand_Touch_Typing_Roadmap_v1_2.pdf`.
- SHA-256: `30d1a8209ccc65033d625e4d7ff4bffbc84e33a97148cf78c785f9b03fa567fe`.
- Source supplied from the user's Downloads directory; only the revised roadmap is included as the project reference.

Version 1.2 defines four core modes, a 20-week suggested program, post-completion optional layouts, and an optional dual-machine split-task endgame. These choices govern the repository's scope and defaults.

## Roadmap traceability

| Roadmap section / PDF pages | Specification location | Interpretation |
| --- | --- | --- |
| 1–2 · Mission and modes, p. 3 | [Product spec](../SPEC.md), [defaults](../config/training-defaults.json) | QL/QR/DL/DR only in the core; separate left/right Dvorak maps |
| 3 · Standardization, pp. 3–4 | [Input and layouts](input-and-layouts.md) | Established variants distinguished from experimental technique |
| 4–5 · Setup and technique, pp. 4–5 | [Input and layouts](input-and-layouts.md) | Native OS selection, zones, anchors, editable ledgers, comfort notes |
| 6 · Roadmap, pp. 5–6 | [Training protocol](training-protocol.md) | Five suggested four-week stages; gates override dates |
| 7 · Sessions, p. 6 | [Training protocol](training-protocol.md) | 30/45-minute templates and five-day cadence |
| 8 · Curriculum, p. 7 | [Training protocol](training-protocol.md) | Independent levels 0–7 and advancement/acquisition distinction |
| 9 · Switching, pp. 7–8 | [Measurement](measurement.md) | Blocked, paired, random; cue-to-ten-correct latency |
| 10 · Logging and benchmarks, p. 8 | [Measurement](measurement.md), [architecture](architecture.md) | Three 60-second trials, medians, glances, fatigue, effort, errors |
| 11 · Brain-health framing, pp. 8–9 | [Product spec](../SPEC.md) | A skill-learning tool; no medical or intelligence outcome claims |
| 12–13 · Tools and maps, pp. 9–10 | [Input and layouts](input-and-layouts.md) | External references and profile verification, no dependency on external tutors |
| 14 · Checklists, pp. 10–11 | [Training protocol](training-protocol.md) | Acquisition, retention, switching, monthly four-mode matrix |
| 15 · Split-task endgame, p. 11 | [Dual-machine module](dual-machine.md) | Separate roles, solo baselines, difficulty ladder, combined throughput/efficiency |

## Supporting technical references

The roadmap defines the desired training behavior. The following primary/publisher documentation supports specific implementation facts; it does not validate the schedule, speed targets, or training outcomes.

| Reference | What was checked / where used |
| --- | --- |
| [Apple Dvorak guide](https://support.apple.com/guide/mac-help/mh27976/mac) | Separate one-hand input sources; linked near the availability statement in input-and-layouts.md |
| [Pinned libxkbcommon XKB fixture](https://github.com/xkbcommon/libxkbcommon/blob/87dcf301265c969ee601b372fca511aeae66dfac/test/data/symbols/us) | Explicit `dvorak-l`/`dvorak-r` map definitions; source is a pinned test fixture, so the installed OS still needs calibration |
| [OneHandTyper](https://onehandtyper.com/) | DL D/T/H/E and DR A/E/H/T home positions and finger order |
| [W3C physical key codes, 2025 Recommendation](https://www.w3.org/TR/2025/REC-uievents-code-20250422/) | Physical-position codes and geometry-specific keys |
| [W3C UI Events](https://www.w3.org/TR/uievents/) | Keyboard and composition event model; input adapter background |
| [W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/) | Committed edits, paste/replacement/deletion, and non-cancelable composition |
| [MDN persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) | Persistence may be granted or denied; backup remains necessary |
| [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) | Offline caching and secure-context deployment requirements |
| [Colemak FAQ](https://colemak.com/FAQ) | Experimental Half-Colemak mention; optional expansion background |
| [Workman project](https://workmanlayout.org/) | Optional Workman layout source and background |

The supporting web documents were inspected during the initial drafting session on 7 September 2026. The revised roadmap was inspected on 17 September. Stable reference revisions are pinned where available; implementation must validate current OS/browser behavior rather than assume a moving webpage is a test result.

Local mapping cross-check: `/usr/share/X11/xkb/symbols/us`, package `xkb-data 2.42-1`, SHA-256 `ef0b555f6fddb71699673c89f2390122db44751397fc07024c840d582983ee0c`. This is provenance for the specification's representative map checks, not a requirement to install that package version.

## Product decisions added to make the roadmap implementable

| Decision | Reason / effect |
| --- | --- |
| Local desktop web app | Supports daily practice, detailed input measurement, offline use, and portable backups without requiring an account |
| Linux / US ANSI initial assumption | Matches the available development environment and the PDF's physical reference; the user's actual keyboard remains to be established by onboarding |
| Native OS layout for reference evidence | Follows the roadmap and makes the practiced output usable outside the trainer |
| No looking at the stage gate in every core mode | Applies the roadmap's common end goal consistently, including Dvorak stages whose table abbreviates the gate |
| Three distinct dates for repeatability | Prevents three adjacent tests from becoming “three sessions”; a stricter operational definition than the PDF explicitly gives |
| Two of three trials jointly pass speed/accuracy | Prevents medians of different trials from falsely establishing a combined threshold |
| First complete eligible set per date | Keeps acquisition evidence reproducible; later results remain visible and influence current stability |
| Four current passing sets within 14 days for core completion | Gives “stable core modes” an explicit meaning before optional experimentation |
| Strict positional scoring and attempt accuracy | Preserves correction cost and corrected mistakes; avoids pretending another site's scoring is identical |
| 30-second switch timeout | Gives stalled probes a finite outcome without hiding failures from latency summaries |
| Fixed acquisition baseline for maintenance | Makes the rolling decline rule reproducible and prevents a falling baseline from hiding rustiness |
| Minimum sample counts and seeded drill generation | Avoids overstating weak-key evidence and allows exercises to be reproduced |
| Fingering recommendations remain configurable | Full-board one-hand QWERTY lacks a single canonical assignment in the roadmap |
| Separate cue-started dual baselines and shared duration | Makes efficiency use matched timing and coordinated measurement intervals |
| 100 ms estimated dual alignment tolerance | A product measurement threshold, to be validated on two machines; no claim of perfect simultaneity |
| D6 as later experimental extension | Two dictation streams add audio alignment and quality assessment beyond the first optional module |

The software should explain the user-facing effects of these choices. Internal IDs, clock synchronization mechanics, and implementation versions belong in details/exports rather than interrupting ordinary practice.

## Assumptions and implementation checks

Proceed with one personal profile, English UI/reference prose, desktop hardware, and no hosted service for core use. Actual keyboard geometry, OS input variants, modifier strategy, and browser compatibility must be captured during onboarding and verified before the implementation's first personal-use release. Portuguese custom practice is supported separately; a Portuguese reference benchmark is future work.

The 20-week program, gates, and maintenance parameters are hobby-project defaults from the roadmap or explicit product choices above. They are not clinical protocols. The tool measures typing and self-reported experience; it does not infer neurological improvement, gaze, hand use, or mental attention directly.

## Source handling

Keep the user-provided roadmap as reference material in this repository, published publicly at the user's request. No repository-wide open-source license is assigned by this specification. Future copied third-party implementation/data assets must preserve their own licenses and attribution. The spec does not bundle external tutorial text, downloaded software, or unrelated files from Downloads.
