import type { ForensicsBundle, IntelligencePackage } from '@/lib/api/schemas'
import { renderPdf, type Line } from './pdf'
import { fmtDateTime, fmtScore } from '@/lib/format'

/**
 * The summary export.
 *
 * One page or a few, meant to be read by someone who will never open the
 * console. Everything on it carries its own qualifier: a claim shows its
 * confidence, a statute shows whether counsel has verified it, a measurement
 * shows whether it is measured or indicative, and the coverage figure says how
 * much of the window the record actually covers.
 *
 * What it deliberately does not do is round any of that away to read better.
 */
export function summaryPdf(pkg: IntelligencePackage, bundle: ForensicsBundle | null): Uint8Array {
  const incident = pkg.incident
  const lines: Line[] = []

  const add = (style: Line['style'], text: string) => lines.push({ style, text })

  add('title', incident.title)
  add('mono', `${incident.incident_id} · ${incident.domain} · ${incident.priority}`)
  add('rule', '')

  add('body', `Detected ${fmtDateTime(incident.detected_at)} at ${incident.zone_label}.`)
  add('body', `Position ${incident.position.lat.toFixed(5)}, ${incident.position.lon.toFixed(5)}.`)
  add(
    'body',
    `Severity ${fmtScore(incident.css.value)} with the interval ${fmtScore(incident.css.lo)} to ${fmtScore(incident.css.hi)}. ` +
      `Corroborated by ${incident.source_count} source${incident.source_count === 1 ? '' : 's'}.`,
  )
  add('gap', '')

  add('heading', 'What the scene assessment found')
  add('body', pkg.scene.summary)
  add(
    'body',
    pkg.scene.trigger_agreement
      ? 'The assessment agreed with the trigger the edge device reported.'
      : 'The assessment did not agree with the trigger the edge device reported. Nothing below should be read as confirming the reported violation.',
  )
  if (pkg.scene.violation_assessment) {
    add(
      'body',
      `Violation assessment: ${pkg.scene.violation_assessment.text} (confidence ${fmtScore(pkg.scene.violation_assessment.confidence)})`,
    )
  } else {
    add('body', 'No violation assessment was produced for this incident.')
  }
  for (const hazard of pkg.scene.hazards) {
    add('body', `Hazard: ${hazard.text} (confidence ${fmtScore(hazard.confidence)})`)
  }
  add('gap', '')

  add('heading', 'Context')
  add('body', `Normalcy for this place and hour: ${fmtScore(pkg.context.normalcy)}.`)
  add('body', `Disposition: ${pkg.context.disposition}.`)
  if (pkg.context.needs_human_review) add('body', 'This package is flagged as needing human review before any action.')
  if (pkg.context.permitted_activity) add('body', 'The activity may be permitted at this location.')
  for (const factor of pkg.context.contributing_factors) {
    add('body', `Contributing factor: ${factor.text} (confidence ${fmtScore(factor.confidence)})`)
  }
  if (pkg.context.causal_chain.length > 0) {
    add('body', `Causal chain as stated: ${pkg.context.causal_chain.join(' then ')}.`)
  }
  add('gap', '')

  add('heading', 'Severity components')
  for (const component of pkg.severity.components) {
    add(
      'mono',
      `${component.label.padEnd(26).slice(0, 26)} raw ${component.raw.toFixed(2)}  weight ${component.weight.toFixed(2)}  contributes ${component.contribution.toFixed(3)}`,
    )
  }
  add('small', `Zone profile applied: ${pkg.severity.zone_profile}.`)
  add('gap', '')

  add('heading', 'Statutes selected')
  if (pkg.legal.length === 0) {
    add('body', 'No statute was selected for this incident.')
  } else {
    for (const item of pkg.legal) {
      add('mono', `${item.statute} section ${item.section}`)
      add('body', `${item.title}. ${item.justification}`)
      add(
        'small',
        item.counsel_verified
          ? `Counsel verified. Confidence ${fmtScore(item.confidence)}. Reference ${item.source_reference}.`
          : `NOT VERIFIED BY COUNSEL for this deployment. Reference only, and not admissible support. Confidence ${fmtScore(item.confidence)}.`,
      )
    }
  }
  add('gap', '')

  if (pkg.routing) {
    add('heading', 'Routing')
    add('body', `${pkg.routing.department_label}: ${pkg.routing.action_line}`)
    add('small', `Response time allowed: ${Math.round(pkg.routing.sla_seconds / 60)} minutes.`)
    add('gap', '')
  }

  if (bundle && bundle.kinematics.length > 0) {
    add('heading', 'Measured kinematics')
    for (const track of bundle.kinematics) {
      add(
        'mono',
        `${track.track_id} peak ${track.peak_speed.value.toFixed(1)} km/h [${track.peak_speed.lo.toFixed(1)} to ${track.peak_speed.hi.toFixed(1)}] ${track.measurement_grade}`,
      )
      if (track.measurement_grade === 'indicative') {
        add('small', 'Indicative only. The uncertainty on this figure is too wide to support a claim about speed.')
      }
    }
    add('gap', '')
  }

  if (bundle && bundle.conflicts.length > 0) {
    add('heading', 'Conflict metrics')
    for (const conflict of bundle.conflicts) {
      add(
        'mono',
        `${conflict.pair.join(' and ')} ttc ${conflict.ttc_s ? `${conflict.ttc_s.value.toFixed(1)} s` : 'not computable'} severity ${conflict.severity}`,
      )
    }
    add('gap', '')
  }

  add('heading', 'What this package is worth')
  add(
    'mono',
    `coverage ${fmtScore(pkg.quality.coverage)}  sync grade ${pkg.quality.sync_grade}  calibration ${pkg.quality.calibration_uncertainty_m.toFixed(2)} m`,
  )
  add('mono', `identity confidence ${fmtScore(pkg.quality.identity_confidence)}  citation validity ${fmtScore(pkg.quality.citation_validity)}`)
  add(
    'mono',
    `authenticity verified ${pkg.quality.authenticity.verified}  consistent ${pkg.quality.authenticity.consistent}  inconsistent ${pkg.quality.authenticity.inconsistent}  unverifiable ${pkg.quality.authenticity.unverifiable}`,
  )
  add('small', `Policy guard verdict: ${pkg.guard.verdict}, policy ${pkg.guard.policy_version}.`)
  for (const finding of pkg.guard.findings) add('small', `Guard finding: ${finding.rule}. ${finding.detail}`)
  add('gap', '')

  add('heading', 'Evidence cited')
  if (bundle) {
    for (const node of bundle.tree) {
      add('mono', `${node.kind} ${node.source_id} ${fmtDateTime(node.t_start)} ${node.authenticity}`)
      add('small', `sha-256 ${node.hash}`)
    }
  } else {
    add('body', 'The forensic bundle was not available when this summary was produced.')
  }
  add('gap', '')

  add('heading', 'Models used')
  for (const row of pkg.model_trace) {
    add('mono', `${row.role.padEnd(10).slice(0, 10)} ${row.model} ${row.tokens_in} in ${row.tokens_out} out ${row.latency_ms} ms`)
  }
  add('rule', '')
  add(
    'small',
    'Produced by CivicSense. This summary is a derived document. The evidence hashes above are the authoritative record and can be recomputed from the stored objects.',
  )

  return renderPdf(lines, `${incident.incident_id} summary`)
}
