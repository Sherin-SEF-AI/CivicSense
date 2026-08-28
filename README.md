# CivicSense

Contextual civic intelligence for a city.

CivicSense ingests fixed CCTV, patrol vehicle cameras, bodycams, phone reports, IoT sensors and
vehicle telemetry, fuses them into incidents, reasons over them with a multi-model pipeline, and
produces evidence-grade intelligence packages, forensic reconstructions and early warnings for city
departments.

A detection is never the product. The product is the answer to seven questions about a civic
situation: what is happening, why, what led to it, what happens next if nobody acts, how serious it
is in this specific place at this specific time, who must act with what evidence, and whether every
one of those answers can be proven from evidence an auditor can inspect.

---

## What is real here

This repository is a working system, not a demonstration of one.

- **The map is the real city.** Roads, water bodies, parks and ward boundaries are extracted from
  OpenStreetMap. 7,017 major roads, 7,085 minor roads, 1,369 water bodies and 547 real BBMP ward
  boundaries for the Bengaluru pilot area. Nothing is drawn by hand.
- **The store is a real database.** SQLite with write-ahead logging. Every incident, observation,
  action and evidence object is a row. Nothing resets, and there is no seeded content.
- **The evidence chain is real.** Uploaded bytes are hashed with SHA-256 on arrival, the file on disk
  is named by that hash, metadata is read from the file with ffprobe rather than taken from the
  uploader, and every read appends a custody entry. Verification recomputes the hash from the bytes.
- **The reasoning is real.** The understanding tier makes actual calls to actual models with strict
  JSON schemas, and records the tokens, latency and cost of every call. Without an API key it reports
  itself unavailable and the console says so.
- **The audit log is real.** Hash chained. `GET /api/v1/admin` returns a verification of the whole
  chain, and the acceptance suite asserts it holds after every test.

And what is not, and cannot be:

- **There is no camera footage, no sensor data and no incident history in this repository.** Those
  come from devices deployed in a city. The application starts empty and fills as real sources are
  connected. An empty deployment showing nothing is the correct state, not a broken one.

---

## Running it

Requirements: Node 20 or later. ffmpeg is optional and used for reading media metadata on ingest and
for the acceptance tests that need video.

```bash
npm install
npm run bootstrap    # imports the real ward boundaries and the deployment configuration
npm run dev
```

The console comes up on `http://localhost:3111` with the real Bengaluru basemap, 547 real wards, and
no sources, no incidents and no evidence. Register a source to begin.

### Connecting a source

From the sources screen, or directly:

```bash
curl -X POST http://localhost:3111/api/v1/sources \
  -H 'content-type: application/json' \
  -d '{
    "source_id": "CAM-001",
    "source_type": "cctv-fixed",
    "label": "Victoria Road, north approach",
    "lat": 12.97160, "lon": 77.59460,
    "heading_deg": 90, "fov_deg": 60, "range_m": 80,
    "stream_url": "rtsp://camera.local/stream1", "stream_kind": "rtsp",
    "sync_quality": "B"
  }'
```

The source is registered as down. It contributes nothing until it reports.

### Sending an observation

This is the endpoint an edge agent posts to. The `payload` part is the observation, the optional
`media` part is the bytes that back it.

```bash
curl -X POST http://localhost:3111/api/v1/ingest/observation \
  -F 'payload={"source_id":"CAM-001","t_start":1730000000000,"payload_kind":"keyframe",
                "classes":["motorcycle","person"],"trigger":"class:no_helmet",
                "situation_key":"no-helmet","affected":2}' \
  -F 'media=@frame.jpg'
```

The response carries the observation id, the SHA-256 of the bytes, and the incident the trigger
formed or joined. A `situation_key` is what turns an observation into an incident; without one the
observation is recorded and contributes corroboration later.

Sensors push readings, singly or in batches:

```bash
curl -X POST http://localhost:3111/api/v1/ingest/sensor \
  -H 'content-type: application/json' \
  -d '{"source_id":"SEN-001","readings":[{"t":1730000000000,"value":58.2,"unit":"dB(A)"}]}'
```

### Enabling the understanding tier

```bash
export GROQ_API_KEY=...
```

With a key set, the scene, context, legal selection and policy audit stages run against the real
models. Without one, incidents still form, severity is still computed, and the package screen says
plainly that no assessment exists rather than showing a fabricated one.

### Checks

```bash
npm run typecheck      # tsc, zero errors expected
npm run lint           # eslint, zero warnings expected
npm run audit:design   # design language rules, see below
npm run e2e            # acceptance suite, needs Google Chrome
npm run verify         # all four
npm run build
```

### Rebuilding the basemap

The extracted GeoJSON is committed, so this is not needed for a normal checkout. To rebuild from a
different area or a newer extract:

```bash
curl -o extract.osm.pbf https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
node --max-old-space-size=8192 scripts/extract-osm.mjs extract.osm.pbf
npm run bootstrap
```

Basemap data is © OpenStreetMap contributors, licensed under the ODbL.

---

## The screens

| Screen | Route | What an operator does there |
|---|---|---|
| Operations | `/ops` | Watch the live map and incident feed, triage in seconds, acknowledge, dispatch, escalate |
| Forensics | `/forensics` | Pick an incident, then replay every source in sync, measure, verify authenticity, export |
| Incident package | `/incident/[id]` | Read the dossier: evidence, timeline, causal graph, statutes, model trace, admissibility |
| Evidence | `/evidence` | Search the ingested corpus with the parsed query shown before it runs |
| Cases | `/cases` | Link incidents and evidence, apply legal hold, build disclosure bundles with per-recipient redaction |
| Predict | `/predict` | Risk surface computed from incident density, warnings from sensor trends, measured outcomes |
| Sources | `/sources` | Register devices, watch fleet health, run calibration checks, see coverage gaps |
| Analytics | `/analytics` | Department performance from verified closures, bias audit, model operations and spend |
| Query | `/query` | Ask in natural language, see the tool calls above the answer, every claim cited |
| Admin | `/admin` | Zones, departments, playbooks, budgets, users, hash-chained audit |

---

## Architecture

```
app/api/v1/*     the backend: ingest, query, mutate
  |  HTTP + schema validation at the boundary
lib/db/          SQLite store and the hash-chained audit
lib/store/       repositories: sources, observations, incidents, cases, analytics, prediction
lib/reasoning/   the understanding tier over the Groq gateway
lib/api/         typed client, one module per resource
components/      glyphs, primitives, data, map, timeline, forensics, layout
app/(app)/*      the ten operator screens
```

Zod schemas are the single source of truth. Types are inferred from them and never written by hand,
so a contract change breaks the build rather than drifting silently.

### How an incident forms

1. An edge agent posts an observation. The bytes are hashed and stored; ffprobe reads the real
   metadata; a custody entry is written.
2. If the observation carries a `situation_key`, deterministic fusion looks for an open incident in
   the same H3 neighbourhood, inside a window widened by the worse of the two sync qualities, in the
   same domain. It joins that incident or creates one. No model is involved in deciding two things
   are the same event.
3. Severity is computed in code from the situation catalogue, the zone weight profile, the hour, and
   the counts the sources actually reported. The interval widens when corroboration is thin.
4. If the understanding tier is configured, it runs: scene assessment over the frames, context
   assessment, legal selection restricted to the statutes counsel cleared for that situation, and a
   policy audit before anything is dispatched. Claims citing observations that do not resolve are
   dropped, and the package reports the citation validity rate.

### Things worth knowing

**React renders structure, imperative controllers render motion.** Anything changing faster than
about 4Hz never touches React state. The forensics master clock, the timeline playhead and the map
all run outside the render tree.

**The master clock is virtual.** Not a designated video element, because any candidate master can hit
a coverage gap, stall on buffering, or have its rate clamped, and then every other tile freezes with
it. It re-anchors against `performance.now()` rather than integrating a delta, so a throttled tab
cannot accumulate error into a jump.

**Video tiles are corrected in three bands.** Inside tolerance nothing happens. Small drift is
absorbed by trimming playback rate at 4Hz, which is inaudible. Large drift is one seek with a
suppression window. A source needing repeated hard seeks is quarantined and labelled rather than
fought.

**The map draws every marker as one symbol layer.** Acknowledgement, hover and selection go through
feature state, which never re-tiles. The critical blink is two paint-property writes per second on an
expression the GPU re-evaluates.

**The timeline splits by change frequency.** Lane content is canvas because it is static under
playback. The playhead is a single DOM node moved by transform, because it is the only thing moving
at 60Hz and it should not force a canvas repaint.

**MapLibre 6 and bundlers.** MapLibre derives its worker URL from `import.meta.url`, which under a
bundler is a hashed chunk path. The worker 404s, every source stalls, and the map renders only its
background with no error anywhere. `scripts/sync-map-worker.mjs` copies the worker to a stable path
and the URL is pinned before any map is constructed.

---

## Design language: Operational Materialism

The interface is a calibrated instrument, closer to an avionics console than to an analytics page.

- **Matte surfaces.** No gradients, no glass, no shadows except a hairline and one overlay shadow.
  Elevation is a border and a background step.
- **Earned color.** Achromatic by default. Color appears only where it encodes state, and priority is
  always double encoded, a hue plus a glyph or a label.
- **Monospace data.** Every number, identifier, hash, timestamp, coordinate and score is IBM Plex
  Mono with tabular figures. Prose is Inter.
- **Binary motion.** Instant, or one 120ms linear step. There is exactly one motion token. The only
  continuous motion is timeline scrubbing, chart streaming, map panning, and a 1Hz blink reserved for
  unacknowledged critical items, which stops under `prefers-reduced-motion`.
- **Terse voice.** Labels read like instrument markings. Empty states state a fact and the one action
  that changes it.

**CS Glyphs**: seventy-two custom glyphs on a 16 by 16 grid, 1.5px stroke, square caps, angles
restricted to 0, 45 and 90 degrees. The restriction is the style. No icon library is installed and a
lint rule prevents one being added. Gallery at `/dev/glyphs`; every primitive in every state at
`/dev/components`.

`npm run audit:design` enforces this: one motion duration and no easing curves, no raw hex outside
the two token files, no em-dashes in operator copy, monospace on every numeric readout.

---

## Privacy and evidence handling

- No face recognition anywhere in the product, and the scene prompt forbids describing facial
  features or speculating about identity.
- Person search is refused by the server unless the active case carries an authorised investigation
  flag. The interface also hides it, but the refusal is server side.
- Setting an investigation flag requires the administrator capability and is written to the audit log.
- Department users are scoped to their own queue in the query, not in the client.
- Every hash chip opens custody. Verification recomputes the hash from the stored bytes rather than
  displaying a badge that asserts it.
- Every evidence read appends a custody entry with the stated purpose.
- Exported bundles state coverage gaps rather than interpolating across them.

Standards referenced in the admissibility checklist: ISO/IEC 27037 for preservation, ISO/IEC 27042
for analysis and interpretation, ISO/IEC 27043 for investigation workflow, ASTM E2825 and SWGDE for
image processing and authentication, and the Bharatiya Sakshya Adhiniyam 2023 Section 63 for
electronic records. All require counsel confirmation for the deployment state before a court-bound
package is issued.

---

## Acceptance

The criteria are executable rather than aspirational. `e2e/` creates its own data through the real
ingest endpoint and asserts:

- a registered source lands in the real ward its coordinates fall inside
- uploaded bytes are hashed, served back, and recompute to the same hash; identical bytes deduplicate
- a trigger forms an incident, and a second source in the same H3 neighbourhood corroborates it
  rather than creating a second incident
- sensor readings return as min and max buckets with the statutory limit attached
- an operator goes from the feed to an acknowledged and dispatched incident in under five seconds
  using only the keyboard
- synchronized tiles play in lockstep with frame-accurate stepping, against clips the suite renders
- a hash chip opens custody and verification recomputes the chain
- an incident with no assessment says so rather than inventing one
- the map holds its frame budget while panning
- the audit chain still verifies after all of it
- no route logs a console error

## Stack

Next.js 15 App Router, TypeScript strict, Tailwind CSS v4, SQLite via better-sqlite3, TanStack Query,
Zustand, MapLibre GL JS, uPlot, HLS.js, Zod, h3-js. No component kit: every component is custom and
built on the tokens in `styles/tokens.css`.

## License

Proprietary. All rights reserved. Basemap data © OpenStreetMap contributors (ODbL).
