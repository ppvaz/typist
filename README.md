# Typist

An implementation-ready specification for a personal typing trainer that teaches QWERTY and one-hand Dvorak independently with either hand, based on the revised roadmap v1.2.

The target is **four acquired modes: 30 WPM, at least 98% accuracy, and no keyboard checking, repeated across three sessions**. Typist should guide today's practice, maintain earlier skills, expose recurring mistakes, and measure the cost of switching between hands and layouts. The suggested core program takes 20 weeks, with progress gates taking priority over dates.

**Status:** specification and visual design handoff. There is no training application or deployed service yet. The proposed application is a desktop web app that works offline and stores practice data locally.

## Read the specification

| Document | Purpose |
| --- | --- |
| [Product specification](SPEC.md) | Outcomes, scope, screens, and product requirements |
| [Training protocol](docs/training-protocol.md) | Curriculum, advancement, acquisition, scheduling, maintenance, and switching |
| [Input and layouts](docs/input-and-layouts.md) | Actual OS layouts, keyboard geometry, calibration, fingering, and input handling |
| [Measurement contract](docs/measurement.md) | Scoring formulas, benchmark eligibility, comparison rules, and worked examples |
| [Architecture and data](docs/architecture.md) | Components, state transitions, persistence, and data contracts |
| [Visual design system](design/README.md) | Original design canvas, light/dark tokens, screen previews, and implementation review |
| [Two-machine endgame](docs/dual-machine.md) | Optional coordinated practice on two machines, baselines, and dual efficiency |
| [Build plan and acceptance](docs/build-plan.md) | Ordered implementation milestones and observable acceptance scenarios |
| [Training defaults](config/training-defaults.json) | Machine-readable mode catalog and protocol parameters |
| [Sources and decisions](docs/sources-and-decisions.md) | Roadmap traceability, verified references, assumptions, and design decisions |
| [Revised roadmap](references/Ambidextrous_One-Hand_Touch_Typing_Roadmap_v1_2.pdf) | User-supplied source of truth, version 1.2, September 2026 |

## Core modes

| Layout | Left hand | Right hand | Method |
| --- | --- | --- | --- |
| QWERTY | QL | QR | One hand covers the ordinary full board |
| Dvorak | DL | DR | Separate left-handed and right-handed Dvorak layouts |

These are four skills backed by three logical layouts. Each mode keeps its own curriculum, fingering ledger, benchmark history, and maintenance schedule. Colemak, Workman, Half-QWERTY, and the dual-machine experiment are optional expansions after core completion.

The initial target assumes a physical US ANSI keyboard on Linux; onboarding must verify that assumption. Keyboard geometry and OS layout variants are explicit profiles so other setups can be added without mixing incompatible results. English prose is the reference benchmark; Portuguese and code are separate practice tracks.

Start implementation with [milestone 1](docs/build-plan.md#milestone-1-input-and-measurement). Build the input and measurement foundation before adaptive scheduling or progress charts.

## Visual reference

The supplied design establishes the warm neutral palette, serif headings, monospaced practice surface, tactile keycaps, and separate hand identities. The [design handoff](design/README.md) includes reusable tokens and [review notes](design/REVIEW.md) for implementation.

![Typist Today screen from the supplied visual design](design/previews/today.png)
