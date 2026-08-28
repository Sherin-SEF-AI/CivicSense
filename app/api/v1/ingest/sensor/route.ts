import type { NextRequest } from 'next/server'
import { badRequest, json } from '../../_lib/handler'
import { getSourceRow } from '@/lib/store/sources'
import { ingestSensorReading } from '@/lib/store/observations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sensor readings.
 *
 * Accepts a single reading or a batch, which is what an MQTT bridge or a
 * LoRaWAN gateway forwards.
 *
 *   curl -X POST http://localhost:3111/api/v1/ingest/sensor \
 *     -H 'content-type: application/json' \
 *     -d '{"source_id":"SEN-001","readings":[{"t":1730000000000,"value":58.2,"unit":"dB(A)"}]}'
 */
export async function POST(req: NextRequest) {
  let body: { source_id?: string; readings?: { t?: number; value?: number; unit?: string; valid?: boolean }[]; t?: number; value?: number; unit?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return badRequest('invalid_body')
  }

  const sourceId = body.source_id ?? ''
  const source = getSourceRow(sourceId)
  if (!source) return badRequest('unknown_source', sourceId)
  if (source.source_type !== 'sensor') return badRequest('not_a_sensor', sourceId)

  const readings = body.readings ?? (body.value !== undefined ? [{ t: body.t, value: body.value, unit: body.unit }] : [])
  if (readings.length === 0) return badRequest('no_readings')

  let accepted = 0
  for (const reading of readings) {
    if (reading.value === undefined || !Number.isFinite(reading.value)) continue
    ingestSensorReading(
      sourceId,
      Number(reading.t ?? Date.now()),
      Number(reading.value),
      reading.unit ?? '',
      reading.valid !== false,
    )
    accepted++
  }

  return json({ source_id: sourceId, accepted, rejected: readings.length - accepted }, 201)
}
