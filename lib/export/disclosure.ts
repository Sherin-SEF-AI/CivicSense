import type { ForensicsBundle, IntelligencePackage } from '@/lib/api/schemas'
import { fmtDateTime, fmtScore } from '@/lib/format'

/**
 * The disclosure bundle.
 *
 * This is the version that leaves the organisation, so it is built by removal
 * rather than by decoration. Person actors are reduced to a count, plate hashes
 * travel without the plates, entity dossiers are dropped entirely, and any
 * statute counsel has not verified for the deployment is marked as inadmissible
 * on the face of the document rather than quietly omitted.
 *
 * Every removal is listed in the redaction log at the end. A recipient who is
 * told what was taken out can ask for it; a recipient who is not told cannot.
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface Certificate {
  issued_by: string
  role: string
  device_particulars: string
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#111;font:12.5px/1.5 system-ui,-apple-system,sans-serif}
.mono{font-family:ui-monospace,"IBM Plex Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:900px;margin:0 auto;padding:32px}
h1{font-size:19px;margin:0 0 2px}
h2{font-size:12px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.07em;color:#555;font-weight:600;border-bottom:1px solid #ddd;padding-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#666;font-weight:600;padding:4px 8px 4px 0}
td{padding:4px 8px 4px 0;border-top:1px solid #e6e6e6;vertical-align:top}
.hash{font-size:10.5px;color:#555;word-break:break-all}
.redacted{background:#111;color:#111;padding:0 4px;user-select:none}
.flag{border-left:3px solid #b54708;background:#fffaf0;padding:8px 10px;margin:8px 0;font-size:12px}
.log li{margin-bottom:4px;color:#444}
.cert td{border:none;padding:3px 12px 3px 0}
.sig{margin-top:24px;border-top:1px solid #111;width:280px;padding-top:4px;font-size:11px;color:#555}
@media print{.wrap{padding:0}}
`

export function renderDisclosureBundle(
  pkg: IntelligencePackage,
  bundle: ForensicsBundle | null,
  certificate: Certificate | null,
): string {
  const incident = pkg.incident
  const redactions: string[] = []

  /* People are not disclosed. The count is, because the number of people
     present is part of what happened and hiding it would misrepresent it. */
  const people = pkg.scene.actors.filter((a) => a.kind === 'person')
  const disclosable = pkg.scene.actors.filter((a) => a.kind !== 'person')
  if (people.length > 0) {
    redactions.push(`${people.length} person actor${people.length === 1 ? '' : 's'} removed, descriptors withheld`)
  }
  if (bundle && bundle.entities.length > 0) {
    redactions.push(`${bundle.entities.length} entity dossier${bundle.entities.length === 1 ? '' : 's'} removed in full`)
  }

  const unverified = pkg.legal.filter((l) => !l.counsel_verified)
  if (unverified.length > 0) {
    redactions.push(
      `${unverified.length} statute selection${unverified.length === 1 ? '' : 's'} marked inadmissible, counsel verification pending`,
    )
  }
  if (pkg.guard.redactions.length > 0) {
    redactions.push(`${pkg.guard.redactions.length} field${pkg.guard.redactions.length === 1 ? '' : 's'} redacted by the policy guard`)
  }

  const actors = disclosable
    .map(
      (a) =>
        `<tr><td class="mono">${escape(a.ref)}</td><td class="mono">${escape(a.kind)}</td><td>${escape(a.descriptor)}</td></tr>`,
    )
    .join('')

  const evidence = (bundle?.tree ?? [])
    .map(
      (n) =>
        `<tr><td class="mono">${escape(n.source_id)}</td><td class="mono">${escape(n.kind)}</td>` +
        `<td class="mono">${fmtDateTime(n.t_start)}</td><td class="mono">${escape(n.authenticity)}</td>` +
        `<td class="hash mono">${escape(n.hash)}</td></tr>`,
    )
    .join('')

  const legal = pkg.legal
    .map(
      (l) =>
        `<tr><td class="mono">${escape(l.statute)} s.${escape(l.section)}</td><td>${escape(l.title)}<br>${escape(l.justification)}</td>` +
        `<td class="mono">${l.counsel_verified ? 'verified' : 'NOT ADMISSIBLE'}</td>` +
        `<td class="mono">${fmtScore(l.confidence)}</td></tr>`,
    )
    .join('')

  const kinematics = (bundle?.kinematics ?? [])
    .map(
      (k) =>
        `<tr><td class="mono">${escape(k.track_id)}</td><td>${escape(k.descriptor)}</td>` +
        `<td class="mono">${k.peak_speed.value.toFixed(1)} km/h [${k.peak_speed.lo.toFixed(1)} to ${k.peak_speed.hi.toFixed(1)}]</td>` +
        `<td class="mono">${escape(k.measurement_grade)}</td></tr>`,
    )
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escape(incident.incident_id)} disclosure bundle</title><style>${STYLE}</style></head>
<body><div class="wrap">

<h1>${escape(incident.title)}</h1>
<p class="mono">${escape(incident.incident_id)} · ${escape(incident.domain)} · ${escape(incident.priority)} · detected ${fmtDateTime(incident.detected_at)}</p>
<p>${escape(incident.zone_label)}. Position ${incident.position.lat.toFixed(5)}, ${incident.position.lon.toFixed(5)}.</p>

<div class="flag">
This is a disclosure copy. Material has been removed. The redaction log at the end of this document
lists what was taken out and why, so that the recipient can apply for it separately. The evidence
hashes below are unaltered and can be recomputed from the objects they identify.
</div>

<h2>What was assessed</h2>
<p>${escape(pkg.scene.summary)}</p>
<p>${
    pkg.scene.trigger_agreement
      ? 'The scene assessment agreed with the trigger reported by the capturing device.'
      : '<strong>The scene assessment did not agree with the trigger reported by the capturing device.</strong> Nothing in this document should be read as establishing the reported violation.'
  }</p>
${
  pkg.scene.violation_assessment
    ? `<p>Violation assessment: ${escape(pkg.scene.violation_assessment.text)} (confidence ${fmtScore(pkg.scene.violation_assessment.confidence)})</p>`
    : '<p>No violation assessment was produced.</p>'
}
<p>Context disposition: ${escape(pkg.context.disposition)}. Normalcy for this place and hour: ${fmtScore(pkg.context.normalcy)}.</p>

<h2>Actors disclosed</h2>
${
  actors === ''
    ? '<p>No disclosable actors. Any people present are covered by the redaction log.</p>'
    : `<table><thead><tr><th>ref</th><th>kind</th><th>descriptor</th></tr></thead><tbody>${actors}</tbody></table>`
}
${people.length > 0 ? `<p><span class="redacted">${'x'.repeat(24)}</span> ${people.length} person actor${people.length === 1 ? '' : 's'} withheld</p>` : ''}

<h2>Statutes</h2>
${
  legal === ''
    ? '<p>No statute was selected for this incident.</p>'
    : `<table><thead><tr><th>provision</th><th>basis</th><th>status</th><th>confidence</th></tr></thead><tbody>${legal}</tbody></table>`
}

${
  kinematics === ''
    ? ''
    : `<h2>Measurements</h2><table><thead><tr><th>track</th><th>subject</th><th>peak speed</th><th>grade</th></tr></thead><tbody>${kinematics}</tbody></table>
<p class="hash">A figure marked indicative carries an uncertainty too wide to support a claim about speed.</p>`
}

<h2>Evidence manifest</h2>
${
  evidence === ''
    ? '<p>No evidence objects are attached to this incident.</p>'
    : `<table><thead><tr><th>source</th><th>kind</th><th>captured</th><th>authenticity</th><th>sha-256</th></tr></thead><tbody>${evidence}</tbody></table>`
}

<h2>What this record is worth</h2>
<table><tbody>
<tr><td>coverage of the incident window</td><td class="mono">${fmtScore(pkg.quality.coverage)}</td></tr>
<tr><td>clock synchronisation grade</td><td class="mono">${escape(pkg.quality.sync_grade)}</td></tr>
<tr><td>calibration uncertainty</td><td class="mono">${pkg.quality.calibration_uncertainty_m.toFixed(2)} m</td></tr>
<tr><td>citation validity</td><td class="mono">${fmtScore(pkg.quality.citation_validity)}</td></tr>
</tbody></table>

<h2>Certificate under section 63, Bharatiya Sakshya Adhiniyam 2023</h2>
${
  certificate
    ? `<table class="cert"><tbody>
<tr><td>Issued by</td><td class="mono">${escape(certificate.issued_by)}</td></tr>
<tr><td>Position held</td><td class="mono">${escape(certificate.role)}</td></tr>
<tr><td>Particulars of the device</td><td class="mono">${escape(certificate.device_particulars)}</td></tr>
<tr><td>Date of issue</td><td class="mono">${fmtDateTime(Date.now())}</td></tr>
</tbody></table>
<p>The electronic record described above was produced by a computer output device in regular use. The
information was fed into it in the ordinary course of the activities described, the device was
operating properly throughout the material period, and the information reproduced here is derived
from that fed into it in the ordinary course.</p>
<div class="sig">Signature</div>`
    : `<div class="flag">No certificate has been issued for this bundle. Without one the electronic record
carried here is not admissible under section 63. Issue the certificate from the case screen before
serving this document.</div>`
}

<h2>Redaction log</h2>
${
  redactions.length === 0
    ? '<p>Nothing was removed from this bundle.</p>'
    : `<ul class="log">${redactions.map((r) => `<li>${escape(r)}</li>`).join('')}</ul>`
}
<p class="hash mono">exported ${fmtDateTime(Date.now())} · policy guard ${escape(pkg.guard.verdict)} · policy ${escape(pkg.guard.policy_version)}</p>

</div></body></html>`
}
