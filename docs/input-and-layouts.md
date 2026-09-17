# Input, layouts, and fingering

## Three independent concepts

| Concept | Example | Responsibility |
| --- | --- | --- |
| Physical geometry | US ANSI, ISO, ABNT2 | Key positions, shape, available keys, tactile anchors |
| Logical layout variant | XKB `us(dvorak-l)` | Characters/actions produced at each physical position and modifier layer |
| Mode and fingering | DL with ledger revision 3 | Active hand, preferred fingers/zones, training state |

QL and QR share the same QWERTY character map and have separate ledgers. DL and DR use two distinct Dvorak maps. Do not derive either from standard two-hand Dvorak or generate one by merely mirroring the other.

XKB includes explicit `dvorak-l` and `dvorak-r` definitions, and Apple documents both one-hand variants. These establish layout availability, not a universal fingering prescription. [XKB reference fixture](https://github.com/xkbcommon/libxkbcommon/blob/87dcf301265c969ee601b372fca511aeae66dfac/test/data/symbols/us), [Apple Dvorak guide](https://support.apple.com/guide/mac-help/mh27976/mac).

## Initial platform contract

Ship and manually verify the core experience on Linux with US ANSI geometry and the actual desktop's three OS input sources: ordinary US QWERTY, Dvorak left-handed, and Dvorak right-handed. Record desktop/session type and browser versions in implementation validation. Do not prescribe an X11 command as a universal Wayland setup procedure.

Keep Windows/macOS variants and ISO/ABNT2 geometries explicit in the catalog as future verified profiles. On another geometry, allow text-only practice after character checks, with unverified positions clearly identified; do not silently display an ANSI finger diagram or certify physical-key statistics. If the user's actual keyboard differs from the initial assumption, implementing and verifying that profile becomes part of the first release.

The browser's `KeyboardEvent.code` identifies a physical key position; it is not the produced character and does not identify the user's hand or finger. The standard distinguishes geometry-specific positions such as `IntlBackslash` and `IntlRo`. [W3C code specification](https://www.w3.org/TR/2025/REC-uievents-code-20250422/).

## Layout registry

A layout record must contain a stable ID, human name, OS variant, geometry compatibility, source/revision, base and Shift mappings, special actions, and verified calibration fixtures. Resolve inherited XKB mappings before shipping a table; omitted positions in a diagram must not become unmapped keys. Treat AltGr/dead keys as explicit variant capabilities.

The PDF's partial diagrams are explanatory references. Build-time fixtures must cover every printable position present on the supported geometry, Space, Enter, Backspace, both Shifts, and Caps Lock behavior. Any imported upstream code/data must retain its upstream license notices.

Representative expected outputs on the initial US profiles:

| Physical code | QWERTY | Dvorak-L | Dvorak-R |
| --- | --- | --- | --- |
| `KeyQ` | q | ; | 5 |
| `KeyF` | f | d | a |
| `KeyJ` | j | e | t |
| `Digit4` | 4 | p | 4 |
| `Digit5` | 5 | f | j |
| `Shift` + `Digit1` | ! | { | ! |

These values were checked against the installed XKB definitions and the roadmap. They are test specimens, not complete production layout files. Store logical letters independently of the physical QWERTY-style code names.

## Native OS input

Reference practice uses the actual OS-selected layout. Selecting DL in Typist changes the training context and prompts the user to select the corresponding input source; it does not remap OS input. Never translate QWERTY characters into Dvorak characters inside a native benchmark. Any future in-app emulation must be a separately labeled protocol without silently granting native milestones.

First use of a profile walks through all supported printable keys in base and Shift layers, plus editing controls. On subsequent mode switches, run a short probe covering `KeyQ`, `KeyF`, `KeyJ`, `Digit5`, and one shifted symbol. Calibration uses a visual keyboard with physical positions highlighted and does not count as practice evidence. Moving between QL and QR requires a hand confirmation but no different OS layout.

Before ordinary benchmarks, calibration occurs outside the timed interval. Before a scored switch sequence, calibrate all participating layouts once; do not insert untimed calibration after each cue. Mark calibration stale after a setup edit, browser restart, keyboard change, or detected mapping inconsistency. A restart requires the short probe; changes to the physical map require full calibration.

A received character that matches the mapping of the actual pressed code but differs from the target is a typing error. A character that disagrees with the configured mapping of its own code is a possible setup mismatch. After three consecutive unambiguous mapping disagreements, interrupt reference measurement and offer recalibration. Do not label normal motor errors as OS-layout failures.

## Event pipeline

Use a real accessible text input/textarea as the native entry surface. `keydown`/`keyup` provide physical position, modifiers, repeats, and timing metadata. Committed text mutations provide scoring input. A printable key must not be counted once on keydown and again on input.

Input events distinguish insertion, replacement, deletion, paste, and composition. Composition updates may be non-cancelable, so the implementation must reconcile committed text rather than assume every mutation can be prevented. [W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/).

The application-specific adapter must:

- Normalize committed text to NFC and count grapheme clusters. In ordinary practice, a composed `é` counts once, not once per composition update. Attribute its physical position only when the event association is unambiguous; otherwise store `null`.
- Associate each committed edit with at most one applicable event record or an explicit multi-key composition. Keep an incrementing sequence number; timestamps alone are not unique IDs.
- Apply the [append-and-tail-Backspace scoring model](measurement.md). In benchmark input, preserve the caret at the tail and reject arbitrary selection edits. Tab still leaves the input; Escape ends the trial. Do not trap focus or consume OS layout-switch shortcuts.
- Allow Shift and OS Sticky Keys. Persist modifier strategy in the setup. Accept the actual committed character without imposing a second Shift transformation. Respect OS remapped editing actions, rather than guessing solely from physical codes.
- Record auto-repeat attempts normally if text is committed; do not silently remove elapsed work. A repeated Backspace deletes one tail grapheme per committed deletion and never increases insertion counts.
- Detect paste/drop, replacement/autocorrect, undo/redo, dictation, and unsupported multi-character insertion in reference tests. Reject when possible and mark the trial invalid even when rejection succeeds. Unknown event provenance makes a trial unverified, not certified. This is an honest personal measurement tool, not an anti-cheat system.
- Allow composition in custom-text practice. The reference English corpus uses printable ASCII and spaces; unexpected composition invalidates that reference trial. A later Portuguese benchmark requires its own corpus/protocol and validation.
- Capture events only while the Typist input is focused and the exercise state accepts them. The app must never observe global typing, settings fields, or another application.

Focus/visibility changes have different effects during practice, benchmarks, and switch preparation; implement the explicit state rules in [architecture](architecture.md).

## Fingering and spatial practice

The initial Dvorak home prompts are:

| Mode | Physical positions left to right | Fingers left to right |
| --- | --- | --- |
| DL | `KeyF` D, `KeyG` T, `KeyH` H, `KeyJ` E | Little, ring, middle, index |
| DR | `KeyF` A, `KeyG` E, `KeyH` H, `KeyJ` T | Index, middle, ring, little |

Space uses the thumb. These home-position prompts come from the dedicated tutor; remaining finger assignments need a verified instructional source or explicit user configuration. [OneHandTyper home instructions](https://onehandtyper.com/).

For QL/QR, offer left/center/right zones and tactile anchors at physical `KeyF`/`KeyJ`. Prompt whole-hand relocation instead of stretching from a fixed home row. A zone is a named set of physical positions with an anchor and optional resting window. Overlapping zones are allowed, but each trained key has one preferred zone/finger entry in the active ledger; documented alternatives must be intentional.

Ledger fields are mode, geometry/setup ID, physical code, preferred zone, finger, modifier strategy, optional alternative, notes, revision, effective date, and suggested freeze-until date. Seed a checklist for T/G/B, Y/H/N, Backspace, Enter, both Shifts, brackets/backslash, and punctuation; leave unsupported finger recommendations unset. The app can highlight the position without pretending to know a canonical one-hand QWERTY finger.

Suggest freezing a comfortable mapping for 14 days. Editing earlier is always possible, particularly for discomfort; ask for an optional reason and create a new revision. Never mutate old sessions. Diagram colors and finger prompts must come from the recorded ledger and active hand. “Actual hand used,” “glanced,” and “comfortable” remain user declarations.
