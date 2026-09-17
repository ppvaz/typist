repo: ppvaz/typist
branch: main

## Last sync

date: 2026-09-17T21:58:31Z

### Updated in this project

- Read the full specification set (SPEC.md, training protocol, measurement contract, input/layouts, dual-machine, training-defaults.json).
- Built the Typist visual design system: direction, tokens for light + dark, and a component sheet.
- Added high-fidelity 1440×900 screens for Today, Practice (live typing), focused dark practice, Session review, Progress overview and mode detail.
- Added calibration, fingering ledger and two-machine previews plus an implementation handoff (CSS variables + JSON tokens).

Note: the repository is specification-only — there is no application code or UI to recreate. Every screen is derived from the written contracts, and all sample data satisfies the gates in `config/training-defaults.json`.

## Screen map

| Project screen | Repo files it was built from |
| --- | --- |
| 01 Direction · 02 Tokens | SPEC.md (interaction and quality requirements) |
| 03 Component sheet | SPEC.md, docs/measurement.md, docs/input-and-layouts.md |
| 04.1 Today | SPEC.md (Today), docs/training-protocol.md (sessions, maintenance), config/training-defaults.json |
| 04.2 Practice · live | SPEC.md (Practice), docs/measurement.md (per-trial metrics, editing model), docs/input-and-layouts.md (event pipeline, zones, anchors) |
| 04.3 Practice · focused dark | SPEC.md (assistance levels), docs/measurement.md (timing, benchmark eligibility) |
| 04.5 Session review | SPEC.md (Review and log), docs/training-protocol.md (gates and evidence), docs/measurement.md (joint-pass rule) |
| 04.6 Progress overview | SPEC.md (Progress), docs/measurement.md (switch latency), docs/training-protocol.md (core completion) |
| 04.7 Progress · mode detail | docs/measurement.md (errors and interference, configuration signature), docs/training-protocol.md (adaptive drills) |
| 05.1 Calibration | docs/input-and-layouts.md (native OS input, layout registry, representative outputs) |
| 05.2 Fingering ledger | docs/input-and-layouts.md (fingering and spatial practice) |
| 05.3 Two-machine preview | docs/dual-machine.md (solo baselines, copy-task metrics, coordination) |
| 06 Handoff | SPEC.md (interaction and quality requirements), docs/architecture.md |
