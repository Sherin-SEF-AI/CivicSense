import type { ForensicsBundle, IntelligencePackage } from '@/lib/api/schemas'
import { fmtDateTime, fmtScore, fmtTime, fmtUsd } from '@/lib/format'

/**
 * The offline package.
 *
 * A single HTML file that opens with no platform, no network and no scripts from
 * anywhere: images are inlined as data URIs and every hash is printed in full so
 * a third party can recompute them against the originals they were given. This
 * is the artefact that goes to an investigator, an insurer or a court, so it
 * states plainly what is original, what is derived, and what was not observed.
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function inlineImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const STYLE = `
:root{--bg:#08090b;--panel:#0e1013;--card:#14171b;--line:#1f242b;--line2:#2a313a;
--ink:#e8eaed;--ink1:#adb4bd;--ink2:#979ca3;--ink3:#83878c;
--critical:#f85149;--high:#db6d28;--medium:#d29922;--ok:#3fb950;--live:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.4 system-ui,-apple-system,sans-serif}
.mono,code,td.n,th.n{font-family:ui-monospace,"IBM Plex Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1080px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink2);font-weight:500}
.meta{font-size:11px;color:var(--ink2)}
.card{border:1px solid var(--line);background:var(--panel);border-radius:4px;padding:12px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink2);font-weight:500;padding:4px 8px 4px 0}
td{padding:4px 8px 4px 0;border-top:1px solid var(--line);vertical-align:top;color:var(--ink1)}
.hash{font-size:11px;color:var(--ink2);word-break:break-all}
.reel{display:flex;gap:8px;flex-wrap:wrap}
.reel figure{margin:0;width:300px}
.reel img{width:100%;border:1px solid var(--line);border-radius:2px;display:block}
figcaption{font-size:11px;color:var(--ink2);padding-top:4px}
.claim{border-bottom:1px solid var(--line);padding:6px 0}
.chip{display:inline-block;border:1px solid var(--line);border-radius:2px;padding:0 4px;font-size:11px;color:var(--ink2);margin-right:4px}
.note{font-size:11px;color:var(--ink2);border-left:2px solid var(--medium);padding-left:8px;margin:8px 0}
.gap{color:var(--medium)}
`

/**
 * What the server recorded when it produced this file.
 *
 * A bundle that says who took it out and whether every object still verified at
 * that moment is a different artefact from one that does not. Absent when the
 * bundle is rendered outside an export, which is now only in tests.
 */
export interface ExportAttestation {
  manifestHash: string
  exportedBy: string
  objects: { sha256: string; bytes: number; content_ok: boolean; chain_ok: boolean }[]
}

export function renderOfflineBundle(
  pkg: IntelligencePackage,
  bundle: ForensicsBundle,
  images: Map<string, string>,
  attestation: ExportAttestation | null = null,
): string {
  const incident = pkg.incident
  const [windowStart, windowEnd] = bundle.window

  const reel = pkg.board
    .map((tile) => {
      const src = images.get(tile.full_url)
      const img = src
        ? `<img src="${src}" alt="${escape(tile.label)}">`
        : `<div style="height:150px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--ink3);font-size:11px">image not embedded</div>`
      return `<figure>${img}<figcaption class="mono">${escape(tile.source_id)} · ${escape(tile.kind)} · ${fmtTime(tile.t)}<br>${escape(tile.observation_id)}</figcaption></figure>`
    })
    .join('')

  const timeline = bundle.timeline
    .map(
      (e) => `<tr><td class="mono n" style="white-space:nowrap">${fmtTime(e.t)}</td>
<td class="mono n">${escape(e.lane)}</td>
<td class="mono n">${escape(e.source_id)}</td>
<td>${escape(e.text)}<br>${e.evidence_ids.map((id) => `<span class="chip mono">${escape(id)}</span>`).join('')}</td>
<td class="mono n" style="text-align:right">${fmtScore(e.confidence)}</td></tr>`,
    )
    .join('')

  const evidence = bundle.tree
    .map(
      (n) => `<tr><td class="mono n">${escape(n.evidence_id)}</td>
<td class="mono n">${escape(n.source_id)}</td>
<td class="mono n">${escape(n.kind)}</td>
<td class="mono n">${fmtTime(n.t_start)}${n.t_end !== n.t_start ? ` to ${fmtTime(n.t_end)}` : ''}</td>
<td class="mono n" style="color:${n.authenticity === 'inconsistent' ? 'var(--critical)' : n.authenticity === 'verified' ? 'var(--ok)' : 'var(--ink1)'}">${escape(n.authenticity)}</td>
<td class="hash mono">${escape(n.hash)}</td></tr>`,
    )
    .join('')

  const kinematics = bundle.kinematics
    .map(
      (k) => `<tr><td class="mono n">${escape(k.track_id)}</td><td>${escape(k.descriptor)}</td>
<td class="mono n" style="text-align:right">${k.peak_speed.value.toFixed(1)} [${k.peak_speed.lo.toFixed(1)}-${k.peak_speed.hi.toFixed(1)}] km/h</td>
<td class="mono n">${escape(k.measurement_grade)}</td>
<td class="mono n">${k.validated_against_can ? 'validated against CAN' : 'not validated'}</td></tr>`,
    )
    .join('')

  const conflicts = bundle.conflicts
    .map(
      (c) => `<tr><td class="mono n">${escape(c.pair.join(' / '))}</td>
<td class="mono n">${c.ttc_s ? `${c.ttc_s.value.toFixed(1)} [${c.ttc_s.lo.toFixed(1)}-${c.ttc_s.hi.toFixed(1)}] s` : '--'}</td>
<td class="mono n">${c.pet_s ? `${c.pet_s.value.toFixed(1)} s` : '--'}</td>
<td class="mono n">${escape(c.severity)}</td></tr>`,
    )
    .join('')

  const legal = pkg.legal
    .map(
      (l) => `<tr><td class="mono n">${escape(l.statute)}</td><td class="mono n">${escape(l.section)}</td>
<td>${escape(l.title)}${l.counsel_verified ? '' : ' <span class="gap mono">(reference only, counsel verification pending)</span>'}<br><span class="hash mono">${escape(l.source_reference)}</span></td>
<td class="mono n" style="text-align:right">${fmtScore(l.confidence)}</td></tr>`,
    )
    .join('')

  const trace = pkg.model_trace
    .map(
      (r) => `<tr><td class="mono n">${escape(r.role)}</td><td class="mono n">${escape(r.model)}</td>
<td class="mono n">${escape(r.tier)}</td><td class="mono n" style="text-align:right">${r.tokens_in}/${r.tokens_out}</td>
<td class="mono n" style="text-align:right">${r.latency_ms}</td><td class="mono n" style="text-align:right">${fmtUsd(r.cost_usd, 4)}</td></tr>`,
    )
    .join('')

  const admissibility = pkg.quality.admissibility
    .map(
      (a) => `<tr><td>${escape(a.label)}</td><td class="mono n">${escape(a.state)}</td>
<td class="mono n">${escape(a.standard)}</td><td>${escape(a.note)}</td></tr>`,
    )
    .join('')

  const claims = [
    ...(pkg.scene.violation_assessment ? [pkg.scene.violation_assessment] : []),
    ...pkg.scene.hazards,
    ...pkg.context.contributing_factors,
    pkg.context.what_happens_next,
  ]
    .map(
      (c) =>
        `<div class="claim">${escape(c.text)}<br>${c.evidence_ids.map((id) => `<span class="chip mono">${escape(id)}</span>`).join('')}<span class="mono" style="float:right;color:var(--ink3)">conf ${fmtScore(c.confidence)}</span></div>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>CivicSense package ${escape(incident.incident_id)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${STYLE}</style></head>
<body><div class="wrap">

<h1>${escape(incident.title)}</h1>
<p class="meta mono">${escape(incident.incident_id)} · ${fmtDateTime(incident.detected_at)} · ${escape(incident.zone_id)} ${escape(incident.zone_label)} · ${incident.position.lat.toFixed(5)}, ${incident.position.lon.toFixed(5)}</p>
<p class="meta mono">priority ${escape(incident.priority)} · composite severity ${fmtScore(pkg.severity.score, 3)} [${fmtScore(incident.css.lo, 3)}-${fmtScore(incident.css.hi, 3)}] · sync grade ${escape(incident.sync_quality)} · coverage ${(pkg.quality.coverage * 100).toFixed(0)}%</p>

<div class="note">This is an exported record. It opens without the CivicSense platform and contains no scripts. Images
below are the originals as captured; no annotated or enhanced derivative appears in this file. Every hash is printed in
full so it can be recomputed against the originals independently. Gaps in observation are stated rather than
interpolated.</div>

<h2>Executive summary</h2>
<div class="card">${escape(pkg.scene.summary)}<br><br>${escape(pkg.context.what_happens_next.text)}</div>

<h2>Cited claims</h2>
<div class="card">${claims}</div>

<h2>Visual evidence</h2>
<div class="reel">${reel}</div>

<h2>Reconstructed timeline</h2>
<p class="meta mono">window ${fmtDateTime(windowStart)} to ${fmtDateTime(windowEnd)}</p>
<table><thead><tr><th>time</th><th>lane</th><th>source</th><th>entry</th><th style="text-align:right">conf</th></tr></thead><tbody>${timeline}</tbody></table>

<h2>Evidence register and hashes</h2>
<table><thead><tr><th>evidence</th><th>source</th><th>kind</th><th>window</th><th>authenticity</th><th>sha-256</th></tr></thead><tbody>${evidence}</tbody></table>

${
  kinematics
    ? `<h2>Kinematics</h2>
<p class="meta">Speeds are reported as intervals derived from the calibrated homography, timestamp jitter and box jitter. An estimate wider than the configured tolerance is labelled indicative, not measured.</p>
<table><thead><tr><th>track</th><th>entity</th><th style="text-align:right">peak speed</th><th>grade</th><th>ground truth</th></tr></thead><tbody>${kinematics}</tbody></table>`
    : ''
}

${
  conflicts
    ? `<h2>Surrogate safety measures</h2>
<table><thead><tr><th>pair</th><th>TTC</th><th>PET</th><th>severity</th></tr></thead><tbody>${conflicts}</tbody></table>`
    : ''
}

${
  legal
    ? `<h2>Statutes selected</h2>
<p class="meta">Selected from the curated, counsel-reviewed reference. No section is generated by a model.</p>
<table><thead><tr><th>statute</th><th>section</th><th>title</th><th style="text-align:right">conf</th></tr></thead><tbody>${legal}</tbody></table>`
    : ''
}

<h2>Admissibility checklist</h2>
<table><thead><tr><th>item</th><th>state</th><th>standard</th><th>note</th></tr></thead><tbody>${admissibility}</tbody></table>

<h2>Model trace</h2>
<table><thead><tr><th>role</th><th>model</th><th>tier</th><th style="text-align:right">tokens</th><th style="text-align:right">ms</th><th style="text-align:right">cost</th></tr></thead><tbody>${trace}</tbody></table>

<h2>Certificate</h2>
<div class="card meta">
Electronic record certificate under Section 63 of the Bharatiya Sakshya Adhiniyam 2023 is generated separately per
recipient and requires the deployment state's counsel-confirmed format. This export records the particulars it depends
on: content-addressed storage with a SHA-256 chain per incident, signed manifests, and a custody log for every access.
</div>

${
  attestation === null
    ? ''
    : `<h2>Export record</h2>
<p class="meta">Every object below was re-verified at the moment this file was produced: the stored bytes were
re-hashed, and the custody chain was recomputed from the evidence hash forward. A failure here is stated rather than
suppressed, because an export that hides a damaged object is worse than one that reports it.</p>
<table><thead><tr><th>object</th><th style="text-align:right">bytes</th><th>content</th><th>custody chain</th></tr></thead><tbody>${attestation.objects
        .map(
          (o) => `<tr><td class="hash mono">${escape(o.sha256)}</td>
<td class="mono n" style="text-align:right">${o.bytes.toLocaleString()}</td>
<td class="mono n" style="color:${o.content_ok ? 'var(--ok)' : 'var(--critical)'}">${o.content_ok ? 'rehashes' : 'MISMATCH'}</td>
<td class="mono n" style="color:${o.chain_ok ? 'var(--ok)' : 'var(--critical)'}">${o.chain_ok ? 'recomputes' : 'BROKEN'}</td></tr>`,
        )
        .join('')}</tbody></table>
<p class="meta mono">manifest sha-256 ${escape(attestation.manifestHash)}<br>exported by ${escape(attestation.exportedBy)}</p>`
}

<p class="meta mono">exported ${fmtDateTime(Date.now())} · guard ${escape(pkg.guard.verdict)} · policy ${escape(pkg.guard.policy_version)}</p>
</div></body></html>`
}

export async function buildOfflineBundleAsync(
  pkg: IntelligencePackage,
  bundle: ForensicsBundle,
): Promise<string> {
  const images = new Map<string, string>()
  await Promise.all(
    pkg.board.map(async (tile) => {
      const data = await inlineImage(tile.full_url)
      if (data) images.set(tile.full_url, data)
    }),
  )
  return renderOfflineBundle(pkg, bundle, images)
}

/** Synchronous variant used where images are already resolved or not required. */
export function buildOfflineBundle(pkg: IntelligencePackage, bundle: ForensicsBundle): string {
  return renderOfflineBundle(pkg, bundle, new Map())
}

export function downloadText(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
