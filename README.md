# CivicSense

Web client for a contextual civic intelligence platform.

CivicSense ingests fixed CCTV, patrol vehicle cameras, bodycams, USB cameras, phone reports, IoT
sensors and vehicle telemetry, fuses them into incidents, reasons over them with a multi-model
pipeline, and produces evidence-grade intelligence packages, forensic reconstructions and proactive
early warnings for city departments.

This repository is the operator-facing application: control room operations, the forensic
investigation workspace, evidence search, case management, prediction, source fleet management,
analytics, natural language query and administration.

A detection is never the product. The product is the answer to seven questions about a civic
situation: what is happening, why, what led to it, what happens next if nobody acts, how serious it
is in this specific place at this specific time, who must act with what evidence, and whether every
one of those answers can be proven from evidence an auditor can inspect.

---

## What it does today

| Screen | Route | What an operator does there |
|---|---|---|
| Operations | `/ops` | Watch the live map and incident feed, triage in seconds, acknowledge, dispatch, escalate |
| Incident package | `/incident/[id]` | Read the full dossier: evidence reel, reconstructed timeline, causal graph, statutes, model trace, admissibility |
| Forensics | `/forensics/[id]` | Replay every source in sync, measure, verify authenticity, export a court bundle |
| Evidence | `/evidence` | Natural language search over the evidence corpus with the parsed query shown before it runs |
| Cases | `/cases`, `/case/[id]` | Link incidents and evidence, apply legal hold, build disclosure bundles with per-recipient redaction |
| Predict | `/predict` | Risk surface by horizon, warnings board, cascade zones, ranked interventions, measured outcomes |
| Sources | `/sources` | Fleet health, calibration age, trust, coverage map with uncovered-gap shading |
| Analytics | `/analytics` | Department performance, bias audit, model operations and spend |
| Query | `/query` | Ask in natural language, see the tool-call trace above the answer, every claim cited |
| Admin | `/admin` | Zones, departments, playbooks, budgets, users, hash-chained audit log |

Four claims a detector product cannot make, and which this client is built to show:

1. Every incident is reconstructable across sources on one timeline.
2. Speeds and conflicts are measured with stated uncertainty, validated against vehicle ground truth.
3. Every piece of evidence carries an authenticity verdict and a custody record.
4. Every resolution is verified by the system rather than self-reported.

---

## Running it

Requirements: Node 20 or later, and ffmpeg only if you want to regenerate the sample media.

```bash
npm install
npm run dev
```

The app comes up on `http://localhost:3111` against a fixture backend, with no external service and
no API key. Everything is local: the basemap, the evidence media and the data.

```bash
npm run typecheck      # tsc, zero errors expected
npm run lint           # eslint, zero warnings expected
npm run audit:design   # design language rules, see below
npm run e2e            # acceptance suite, needs Google Chrome installed
npm run verify         # all four
npm run build          # production build
npm run check:bundle   # asserts a live build contains no fixture code
```

### The acceptance suite

The criteria in the brief are executable rather than aspirational. `e2e/` asserts
that an operator can go from the feed to an acknowledged and dispatched incident
in under five seconds using only the keyboard, that four sources hold lockstep
with frame-accurate stepping, that a hash chip opens custody and verification
recomputes the chain, that an incident exports a standalone offline bundle, that
the map holds its frame budget while panning with the full incident set, and that
no route logs a console error.

`npm run audit:design` enforces the design language itself: one motion duration
and no easing curves, no raw hex outside the two token files, no em-dashes in
operator copy, and monospace on every numeric readout.

### Regenerating the generated assets

Both outputs are committed, so neither is needed for a normal checkout.

```bash
npm run geo      # schematic Bengaluru basemap GeoJSON
npm run media    # synthetic evidence clips and keyframes, needs ffmpeg
```

---

## Fixture mode and the real backend

`NEXT_PUBLIC_DATA_MODE=fixtures` mounts a real mock server at `app/api/v1`, including a real
server-sent events stream. The client always speaks HTTP through one typed, schema-validated
client, so it has no fixture awareness at all. Pointing it at the real backend is a base URL change:

```
NEXT_PUBLIC_DATA_MODE=live
NEXT_PUBLIC_API_BASE=https://api.example.org/v1
```

In a live build the fixture routes answer 404 and the fixture modules are dropped from the bundle,
guarded by `import 'server-only'`, a folded build-time constant, and a lint rule that stops fixture
imports leaking outside `app/api/v1` and `lib/fixtures`.

The fixture world is deterministic. One seed builds roughly 119 sources and 2,000 incidents across
the twelve civic domains, placed along real Bengaluru corridors and distributed over a diurnal
Poisson process, so the feed has commute peaks and a small-hours lull rather than uniform noise.
Entity N is generated from its own sub-seed, so it is identical regardless of pagination or
generation order, which makes a bug report reproducible by id. Sensor series are pure functions of
time rather than stored points, so any window at any resolution costs only what it returns.

---

## Design language: Operational Materialism

The interface is a calibrated instrument, closer to an avionics console than to an analytics page.

- **Matte surfaces.** No gradients, no glass, no shadows except a single hairline and one overlay
  shadow. Elevation is a border and a background step.
- **Earned color.** The interface is achromatic by default. Color appears only where it encodes
  state. Priority is always double encoded, a hue plus a glyph or a label, never a hue alone.
- **Monospace data.** Every number, identifier, hash, timestamp, coordinate and score is IBM Plex
  Mono with tabular figures. Prose is Inter.
- **Binary motion.** State changes are instant or one 120ms linear step. There is exactly one motion
  token and no second duration. The only continuous motion permitted is timeline scrubbing, chart
  streaming, map panning, and a 1Hz blink reserved for unacknowledged critical items, which stops
  under `prefers-reduced-motion`.
- **Terse voice.** Labels read like instrument markings. Empty states state a fact and the one action
  that changes it.

### Dev surfaces

`/dev/glyphs` shows every glyph at three optical sizes. `/dev/components` shows
every primitive in every state that matters, including the ones that are hard to
reach in the product: an SLA inside its last five per cent, an inconsistent
authenticity verdict, a citation that does not resolve. Both return 404 in a live
build.

### CS Glyphs

Seventy-two custom glyphs on a 16 by 16 grid, 1.5px stroke, square caps and joins, angles restricted
to 0, 45 and 90 degrees. The restriction is the style: everything looks drafted rather than drawn.
Curves are absent, so chamfers stand in for rounding and diamonds stand in for dots. No icon library
is installed, and a lint rule prevents one being added. The gallery is at `/dev/glyphs`.

---

## Architecture

```
app/api/v1/*     fixture server: route handlers over a seeded world, real SSE
  |  HTTP + schema validation at the boundary
lib/api/         typed client, one module per resource
lib/stores/      selection, transport, filters, density
components/      glyphs, primitives, data, map, timeline, forensics, layout
app/(app)/*      the ten operator screens
```

Zod schemas are the single source of truth. Types are inferred from them and never written by hand,
and the fixtures are generated from those same types, so a contract change breaks the build instead
of drifting silently.

### Things worth knowing

**React renders structure, imperative controllers render motion.** Anything that changes faster than
about 4Hz never touches React state. The forensics master clock, the timeline playhead and the map
all run outside the render tree and write to the DOM, a canvas, or a paint property directly.

**The master clock is virtual.** It is not a designated video element, because any candidate master
can hit a coverage gap, stall on buffering, or have its playback rate clamped, and then every other
tile freezes with it. The clock re-anchors against `performance.now()` rather than integrating a
delta, so a throttled background tab cannot accumulate error into a jump.

**Video tiles are corrected in three bands.** Inside tolerance nothing happens. A small drift is
absorbed by nudging playback rate at 4Hz, which is inaudible. A large drift is a single seek with a
suppression window afterwards. A source that needs repeated hard seeks is quarantined and labelled
rather than fought.

**The map draws two thousand markers as one symbol layer.** Everything that can be a native style
layer with a data-driven expression is one. Acknowledgement, hover and selection go through feature
state, which never re-tiles. The critical blink is two paint-property writes per second on an
expression the GPU re-evaluates. Trail fade is a line gradient over line progress, so it costs no
JavaScript at all.

**The timeline splits by change frequency, not by content.** Lane content is canvas because it is
static under playback. The playhead is a single DOM node moved by transform, because it is the only
thing that moves at 60Hz and it should not force a canvas repaint.

**The stream never floods the cache.** One connection multiplexes every event type. Single entity
updates are patched in place, list invalidations coalesce on a 250ms trailing timer, and anything
above 2Hz bypasses the query cache entirely.

**MapLibre 6 and bundlers.** MapLibre derives its worker URL from `import.meta.url`, which under a
bundler is a hashed chunk path. The worker then returns 404, every source stalls, and the map renders
only its background with no error anywhere. `scripts/sync-map-worker.mjs` copies the worker to a
stable public path and the worker URL is pinned before any map is constructed.

---

## Privacy and evidence handling

The client enforces what the platform promises, rather than assuming the backend will.

- No face recognition anywhere in the product.
- Person search controls render locked unless the active case carries an authorised investigation
  flag, and the server refuses the query independently.
- Plates are shown hashed outside a confirmed violation.
- Bodycam material is treated as its own access domain.
- Annotated and enhanced views are always labelled as derived, and the original is one click away.
- Every hash chip opens custody, and the verify action recomputes the chain in front of the user
  rather than displaying a badge that asserts it.
- Exported bundles state coverage gaps rather than interpolating across them.

Standards referenced in the admissibility checklist: ISO/IEC 27037 for preservation, ISO/IEC 27042
for analysis and interpretation, ISO/IEC 27043 for investigation workflow, ASTM E2825 and SWGDE for
image processing and authentication, and the Bharatiya Sakshya Adhiniyam 2023 Section 63 for
electronic records. All of them require counsel confirmation for the deployment state before a
court-bound package is issued.

---

## Stack

Next.js 15 App Router, TypeScript in strict mode, Tailwind CSS v4, TanStack Query v5, Zustand,
MapLibre GL JS, uPlot, HLS.js, Zod. No component kit: every component is custom and built on the
token system in `styles/tokens.css`.

## Quality gates

Zero TypeScript errors, zero lint warnings, zero console errors. Lists over fifty rows are
virtualized. The map holds sixty frames per second with two thousand markers through clustering.
Every interactive element has a visible focus state, and every action is reachable from the keyboard.

## License

Proprietary. All rights reserved.
