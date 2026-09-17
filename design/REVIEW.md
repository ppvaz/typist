# Design handoff review

Reviewed on 17 September 2026 against roadmap v1.2 and the repository's product contracts. The export provides the intended visual direction and broad screen coverage. This review distinguishes reusable design decisions from demonstration behavior that needs implementation work.

## Keep in the implementation

- Warm paper surfaces, restrained keycap ridges, Newsreader display type, IBM Plex Sans UI text, and JetBrains Mono practice text.
- Explicit mode/layout/hand identity; slate/ochre supported by words and edge markers.
- Accuracy at least as prominent as speed, with speed optional during practice.
- Distinct correct, corrected, wrong, current, and upcoming character states.
- The four-mode progress matrix, separate historical and current skill states, error denominators, and the optional two-machine extension.
- Unknown/pending states, save-state messaging, and keyboard assistance clearly distinguished from physical glances.

## Normalizations included in this repository

| Finding | Resolution in extracted tokens |
| --- | --- |
| The JSON dark palette omits six colors present in the CSS: surface, sunken, secondary ink, disabled ink, rule, and strong rule | `tokens.json` now contains all 16 semantic colors in both themes, using the source CSS values |
| The light `--ink-3` swatch label says `.615 .010 62`, while its rendered swatch, CSS, JSON, and live palette use `.520 .012 62` | Keep `.520 .012 62` as the canonical token; the original canvas remains unchanged |
| Root-level zone tints refer to `--hand`, which is only assigned on descendant mode containers | Define zone tints on the hand containers so custom-property resolution uses the active hand |
| The JSON references font roles without supplying the families and omits several CSS type roles | Add the three family stacks plus heading, small, and code roles from the CSS handoff |
| `$schema: "typist-tokens/1"` names no supplied schema | Use an explicit custom `formatVersion` instead of claiming schema validation |

These are handoff corrections, not a visual redesign. The four original archive entries are retained byte-for-byte, with their hashes in [the manifest](manifest.json).

## Implementation gaps

### Responsive behavior

The canvas has a hard 1440 px minimum width. In the browser check, its document width was 1441 px at a 1280 px viewport. The written 1280×720 and 200% zoom behavior therefore still needs implementation and verification in the app.

Reflow must preserve the current assistance policy. The suggestion to switch automatically to anchors-only at 200% zoom must not reveal anchors in a no-assistance benchmark. Reflow or offer an explicit assistance change, record that change, and apply the measurement contract.

### Keyboard controls

The light practice footer advertises Space as pause. Space is also a scored typing character. While the text input is focused, Space must insert a space; pause should use its focused native button or an optional non-conflicting shortcut. The demo's actual handler only blurs on Escape, so the app also needs the explicit end/interruption transitions defined by the specification.

### Session-plan consistency

Today lists six blocks totaling 30 minutes, but its start control says five blocks, and the practice screen also refers to five. Derive the block count, current block, and minute total from the generated plan. The component-sheet excerpt shows four rows totaling 22 minutes beside a 30-minute total; label a partial excerpt or show the complete plan.

### Measurement and persistence

The demo increments elapsed time with an interval, accepts a short fixed prompt, starts from prefilled counters, and changes Save to Saved after a timeout. It does not implement monotonic deadlines, a complete native-input/composition adapter, immutable trials, benchmark qualification, or IndexedDB transactions. Use the domain engine and persistence requirements in [measurement](../docs/measurement.md) and [architecture](../docs/architecture.md).

Generate sample result fixtures from the scorer as well. For example, under a strict 60-second trial, correct-output WPM is `C_final / 5`; a three-trial median is therefore a multiple of 0.2. The detail table's 30.1 WPM cannot be the median of three such trials. The prototype's demonstration values should not become authoritative test fixtures.

### Declarations and assistance

The demonstration starts with zero glances and a confirmed hand. Real session declarations must begin unknown/unconfirmed and require the user to supply them. Store an exact nonnegative glance count; a `3+` label cannot be silently stored as exactly three. It may be offered as an explicitly bounded estimate that does not certify an exact count.

The dark header says “Map off · nothing recorded.” Replace it with a precise statement such as “No map assistance”; the absence of map assistance is itself recorded, and physical glances are still unknown until declared. Qualification messages must update when declarations change rather than remain a static eligible badge.

### Keyboard visualization

The demo deliberately includes only some Dvorak-L positions. A production profile requires complete, verified base/Shift/control mappings. Unverified positions can be shown honestly during setup but cannot supply a certified complete map.

The generated keyboard renderer also reuses a right-hand palette object for its DL board. Application key and zone colors must derive from the active hand scope, while fingers, zones, and anchor choices come from the active ledger. Do not reuse QR's example assignments across modes.

### Text contrast and sizing

Browser conversion of the source colors to sRGB produced these approximate contrast ratios against the light page background. These check the export's own 4.5:1 normal-text target; they are not a complete accessibility audit.

| Token / value | Measured ratio | Intended use |
| --- | --- | --- |
| `--ink` | 14.84:1 | Primary text |
| `--ink-2` | 6.85:1 | Secondary text |
| Canonical `--ink-3` (`.520 .012 62`) | 5.14:1 | Tertiary text |
| Incorrect swatch label (`.615 .010 62`) | 3.50:1 | Do not substitute for the canonical text token |
| `--ink-upcoming` | 3.70:1 | Large practice text; use stronger ink when reducing it to normal text size |
| `--pending` | 4.06:1 | Status marks/fills with readable neutral text; strengthen it if used as small text |

Retest actual text/background combinations in both themes, including alpha tints, hover/focus states, and user font-size settings. Disabled ink must not be used for readable guidance simply because that guidance is secondary. The practice face should disable programming ligatures so separately scored punctuation remains visually distinct.

### Offline operation and scenario boundaries

“Working offline” is sample UI copy in this canvas; the preview runtime and fonts require external resources. The application must implement asset/font caching and actual offline status before showing that claim.

Treat the six large frames as demonstrations of different states. The Today fixture has DL uncalibrated, while the focused dark frame shows a calibrated DL benchmark; both can be useful mockups without pretending they are one persisted session. User-facing screens should move protocol IDs, corpus revisions, and technical series signatures into details, retaining layout/setup information where it helps the user act.

## Implementation checks

1. At 1280×720 and 200% zoom, core controls remain reachable and no previously hidden keyboard assistance appears automatically.
2. In focused typing, Space inserts text; Tab exits; Escape ends or interrupts according to the block type.
3. The plan count, current block, and total duration agree with the same plan data.
4. A fresh review has unknown declarations; changing assistance/glances/hand confirmation updates eligibility and does not report Saved before commit.
5. Both themes expose every semantic color; nested left/right containers resolve different zone tints and ledger assignments.
6. Small status/help text uses sufficient contrast; practice ligatures remain disabled and typography scales accessibly.
7. All scoring, timing, correction, and sample-history values come from the tested domain engine.
8. Cached app assets and licensed local font files support the actual offline daily loop.

## Review verification

The original canvas loaded through its runtime in Chrome 153 with no uncaught JavaScript exceptions in the initial render. Today, light Practice, and dark Practice were captured at their original 1440×900 frame size. The import validates original file checksums, parses the JSON, and checks light/dark palette parity. Browser checks also cover extracted zone-token resolution.

This verifies the imported reference and token handoff. It does not certify a working typing application, every demo control, accessibility conformance, or physical-keyboard behavior.
