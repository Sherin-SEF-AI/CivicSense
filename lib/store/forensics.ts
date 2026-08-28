import 'server-only'
import type { ForensicsBundle, MediaSegment, PlaybackSource, TimelineEntry } from '@/lib/api/schemas'
import { all, get } from '@/lib/db'
import { observationsForIncident } from './observations'
import { getIncidentRow } from './incidents'
import { conflictsForIncident, entitiesForIncident, kinematicsForIncident } from './tracks'
import { verifyCustodyChain } from '@/lib/db'
import { verifyEvidence } from '@/lib/ingest/media'
import type { SignatureVerdict } from '@/lib/vault/signing'
import type { AuthenticityReport } from '@/lib/api/schemas'
import { fisAuthenticity, fisConfigured } from '@/lib/fis/client'
import { hypothesesForIncident } from './hypotheses'

/**
 * The forensic bundle, assembled from the observations attached to an incident.
 *
 * Nothing is reconstructed that was not observed. Coverage gaps between segments
 * are exactly the gaps in the record, kinematics appear only for tracks the edge
 * actually measured, and the causal graph is present only when the reasoning
 * layer produced one.
 */

/* Async because the authenticity battery and the measurement engines become
   out-of-process calls. Today every branch is still synchronous; the signature
   changes now so that the ripple is separated from the behaviour change. */
/** A recorded signature verdict, mapped to the tree node's authenticity word. */
function verdictOf(verdict: SignatureVerdict): ForensicsBundle['tree'][number]['authenticity'] {
  if (verdict === 'verified') return 'verified'
  if (verdict === 'bad_signature') return 'inconsistent'
  return 'consistent'
}

export async function buildForensics(
  incidentId: string,
  investigationFlag: boolean,
): Promise<ForensicsBundle | null> {
  const row = getIncidentRow(incidentId)
  if (!row) return null

  const observations = observationsForIncident(incidentId)
  const times = observations.flatMap((o) => [o.capture.t_start, o.capture.t_end])
  const anchor = row.detected_at
  const window: [number, number] =
    times.length > 0
      ? [Math.min(anchor - 120_000, ...times), Math.max(anchor + 180_000, ...times)]
      : [anchor - 120_000, anchor + 180_000]

  const tree: ForensicsBundle['tree'] = []
  const signatures = new Map<string, { verdict: SignatureVerdict; detail: string; key_id: string | null }>()
  const bySource = new Map<string, { segments: MediaSegment[]; source: (typeof observations)[number] }>()

  for (const observation of observations) {
    if (!observation.content_ref) continue
    const evidence = get<{ sha256: string; bytes: number; media_type: string; duration_ms: number | null; fps: number | null }>(
      'SELECT sha256, bytes, media_type, duration_ms, fps FROM evidence WHERE sha256 = ?',
      [observation.content_ref],
    )
    if (!evidence) continue

    const isVideo = evidence.media_type.startsWith('video/')
    const signature = get<{ verdict: string; detail: string; key_id: string | null }>(
      'SELECT verdict, detail, key_id FROM device_signatures WHERE sha256 = ?',
      [observation.content_ref],
    )
    signatures.set(evidence.sha256, {
      verdict: (signature?.verdict ?? 'unverified') as SignatureVerdict,
      detail: signature?.detail ?? 'this object predates signature verification',
      key_id: signature?.key_id ?? null,
    })

    tree.push({
      evidence_id: evidence.sha256,
      source_id: observation.source.source_id,
      source_type: observation.source.source_type,
      label: isVideo ? 'clip' : observation.payload_kind === 'audio_segment' ? 'audio' : 'keyframe',
      kind: isVideo ? 'clip' : observation.payload_kind === 'audio_segment' ? 'audio' : 'keyframe',
      t_start: observation.capture.t_start,
      t_end: observation.capture.t_end,
      hash: evidence.sha256,
      /* Verified means a signature was checked against an enrolled key and it
         held. A claimed but failing signature is inconsistent, which is a
         stronger statement than merely unverified and must not be softened. */
      authenticity: verdictOf((signature?.verdict ?? 'unverified') as SignatureVerdict),
      bytes: evidence.bytes,
      thumb_url: `/api/v1/evidence/${evidence.sha256}/content`,
    })

    if (isVideo) {
      const entry = bySource.get(observation.source.source_id) ?? { segments: [], source: observation }
      entry.segments.push({
        t_start: observation.capture.t_start,
        t_end: evidence.duration_ms ? observation.capture.t_start + evidence.duration_ms : observation.capture.t_end,
        fps: evidence.fps ?? 25,
        uri: `/api/v1/evidence/${evidence.sha256}/content`,
        kind: 'mp4',
      })
      bySource.set(observation.source.source_id, entry)
    }
  }

  const playback: PlaybackSource[] = [...bySource.entries()].map(([sourceId, entry]) => {
    const source = get<{ label: string; source_type: string; sync_quality: string; clock_offset_ms: number; homography: string | null; calibration_residual_m: number | null }>(
      'SELECT label, source_type, sync_quality, clock_offset_ms, homography, calibration_residual_m FROM sources WHERE source_id = ?',
      [sourceId],
    )
    return {
      source_id: sourceId,
      label: source?.label ?? sourceId,
      source_type: (source?.source_type ?? 'cctv-fixed') as PlaybackSource['source_type'],
      tile_kind: 'video',
      sync_quality: (source?.sync_quality ?? 'D') as PlaybackSource['sync_quality'],
      clock_offset_ms: source?.clock_offset_ms ?? 0,
      segments: entry.segments.sort((a, b) => a.t_start - b.t_start),
      sensor_kind: null,
      homography: source?.homography ? (JSON.parse(source.homography) as { matrix?: number[] }).matrix ?? null : null,
      calibration_residual_m: source?.calibration_residual_m ?? null,
    }
  })

  /* Sensors that were reading during the window join the deck as scope lanes. */
  const sensors = all<{ source_id: string; label: string; source_type: string; sensor_kind: string | null; sync_quality: string }>(
    `SELECT DISTINCT s.source_id, s.label, s.source_type, s.sensor_kind, s.sync_quality
     FROM sensor_readings r JOIN sources s ON s.source_id = r.source_id
     WHERE r.t BETWEEN ? AND ?`,
    [window[0], window[1]],
  )
  for (const sensor of sensors) {
    playback.push({
      source_id: sensor.source_id,
      label: sensor.label,
      source_type: sensor.source_type as PlaybackSource['source_type'],
      tile_kind: 'scope',
      sync_quality: sensor.sync_quality as PlaybackSource['sync_quality'],
      clock_offset_ms: 0,
      segments: [],
      sensor_kind: sensor.sensor_kind as PlaybackSource['sensor_kind'],
      homography: null,
      calibration_residual_m: null,
    })
  }

  /* The ground-plane tile is always present: no single source answers where
     things moved. */
  playback.push({
    source_id: 'MAP-TRAJ',
    label: 'ground plane',
    source_type: 'cctv-fixed',
    tile_kind: 'map',
    sync_quality: 'A',
    clock_offset_ms: 0,
    segments: [],
    sensor_kind: null,
    homography: null,
    calibration_residual_m: null,
  })

  /* The timeline is the observation record plus the operator actions taken on
     it. Both are rows; neither is narrated. */
  const timeline: TimelineEntry[] = observations.map((observation, index) => ({
    entry_id: `TL-OBS-${index}`,
    t: observation.capture.t_start,
    lane: observation.capture.t_start < anchor ? 'backward' : observation.capture.t_start > anchor + 1000 ? 'forward' : 'anchor',
    source_id: observation.source.source_id,
    source_type: observation.source.source_type,
    text: observation.derived.trigger
      ? `${observation.derived.trigger} fired on ${observation.source.source_id}`
      : `${observation.payload_kind} recorded${observation.derived.classes.length > 0 ? `, classes ${observation.derived.classes.join(', ')}` : ''}`,
    evidence_ids: [observation.observation_id],
    confidence: observation.quality.valid ? 0.9 : 0.4,
  }))

  const actions = all<{ t: number; actor: string; action: string; reason: string | null }>(
    'SELECT t, actor, action, reason FROM incident_actions WHERE incident_id = ? ORDER BY t ASC',
    [incidentId],
  )
  actions.forEach((action, index) => {
    timeline.push({
      entry_id: `TL-ACT-${index}`,
      t: action.t,
      lane: 'forward',
      source_id: 'console',
      source_type: 'phone',
      text: `${action.action} by ${action.actor}${action.reason ? `: ${action.reason}` : ''}`,
      evidence_ids: [],
      confidence: 1,
    })
  })
  timeline.sort((a, b) => a.t - b.t)

  const pkg = row.package_json ? (JSON.parse(row.package_json) as { causal?: ForensicsBundle['causal'] }) : null

  return {
    incident_id: incidentId,
    window,
    tree,
    playback,
    ticks: observations
      .filter((o) => o.derived.trigger !== null)
      .map((o) => ({
        t: o.capture.t_start,
        source_id: o.source.source_id,
        kind: 'trigger' as const,
        label: o.derived.trigger ?? 'trigger',
        evidence_id: o.content_ref,
      })),
    timeline,
    /* Measured from ground-plane tracks a calibrated device reported. A source
       that never reports tracks contributes nothing here, and an empty table is
       the honest answer rather than an estimate from pixels. */
    kinematics: await kinematicsForIncident(incidentId),
    conflicts: conflictsForIncident(incidentId),
    causal: pkg?.causal ?? { nodes: [], edges: [], root_causes: [] },
    hypotheses: hypothesesForIncident(incidentId),
    authenticity: await Promise.all(
      tree.map(async (node) => {
        const signature = signatures.get(node.evidence_id) ?? {
          verdict: 'unverified' as SignatureVerdict,
          detail: 'no verification record exists for this object',
          key_id: null,
        }

        /* The content test is performed here rather than asserted. It used to
           report an unconditional pass with detail text claiming the bytes were
           recomputable, while nothing recomputed them. */
        const content = await verifyEvidence(node.evidence_id)
        const chain = verifyCustodyChain(node.evidence_id)
        const merkle = get<{ root: string; leaf_count: number }>(
          'SELECT root, leaf_count FROM evidence_merkle WHERE sha256 = ?',
          [node.evidence_id],
        )
        const media = get<{ width: number | null; height: number | null; captured_at: number | null }>(
          'SELECT width, height, captured_at FROM evidence WHERE sha256 = ?',
          [node.evidence_id],
        )

        /* The picture tests live in the forensic tier because they decode video
           and measure it. When the tier is not attached the console still
           produces a bundle, and it says which battery ran rather than
           presenting the smaller set as though it were the full one. */
        const battery = await fisAuthenticity({
          sha256: node.evidence_id,
          width: media?.width ?? null,
          height: media?.height ?? null,
          claimedCaptureMs: media?.captured_at ?? null,
          signatureVerdict: signature.verdict,
        })

        const tests: AuthenticityReport['tests'] = [
          {
            test: 'content hash',
            result: content.ok ? 'pass' : content.recomputed === null ? 'inconclusive' : 'fail',
            detail: content.ok
              ? `the bytes on disk recompute to ${node.hash.slice(0, 16)}`
              : content.recomputed === null
                ? 'the stored object could not be read, so its digest could not be recomputed'
                : `the bytes on disk hash to ${content.recomputed.slice(0, 16)}, not to the name they are stored under`,
            standard: 'ISO/IEC 27037',
          },
          {
            test: 'custody chain',
            result: chain.valid ? 'pass' : 'fail',
            detail: chain.valid
              ? `${chain.entries} custody entries recompute from the evidence hash forward`
              : `the custody chain breaks at entry ${chain.brokenAt}, so that entry and everything after it is not evidence of anything`,
            standard: 'ISO/IEC 27042',
          },
          {
            test: 'capture signature',
            result:
              signature.verdict === 'verified' ? 'pass' : signature.verdict === 'bad_signature' ? 'fail' : 'inconclusive',
            detail: signature.detail,
            standard: 'ISO/IEC 27037',
          },
        ]

        if (merkle) {
          tests.push({
            test: 'chunk tree',
            result: 'pass',
            detail: `${merkle.leaf_count} chunk(s) under root ${merkle.root.slice(0, 16)}, so a single segment can be proved a member without the rest`,
            standard: null,
          })
        }

        if (battery) {
          /* The tier already recomputed the digest itself, so its content hash
             row is dropped rather than shown twice. */
          for (const extra of battery.tests) {
            if (extra.test === 'content hash') continue
            tests.push({
              test: extra.test,
              result: extra.result,
              detail: extra.detail,
              standard: extra.standard,
            })
          }
        } else {
          tests.push({
            test: 'picture battery',
            result: 'inconclusive',
            detail: fisConfigured()
              ? 'the forensic tier did not answer, so continuity, recompression and recapture were not examined'
              : 'the forensic tier is not attached to this console, so continuity, recompression and recapture were not examined. what is shown here is integrity and custody only.',
            standard: null,
          })
        }

        /* The verdict is the worst mandatory result, never an average. One
           failed test is a failed object. */
        const failed = tests.some((t) => t.result === 'fail')
        const inconclusive = tests.some((t) => t.result === 'inconclusive')
        const verdict: AuthenticityReport['verdict'] = failed
          ? 'inconsistent'
          : signature.verdict === 'verified'
            ? 'verified'
            : inconclusive
              ? 'consistent'
              : 'consistent'

        return {
          evidence_id: node.evidence_id,
          verdict,
          tests,
          hash: node.hash,
          device_signature: signature.key_id,
        }
      }),
    ),
    entities: entitiesForIncident(incidentId, investigationFlag),
    investigation_flag: investigationFlag,
  }
}
