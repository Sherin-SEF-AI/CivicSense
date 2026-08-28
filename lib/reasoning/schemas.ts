import 'server-only'

/**
 * JSON schemas handed to the model.
 *
 * Strict mode requires every property to be listed as required and additional
 * properties to be forbidden, so an optional field is expressed as a nullable
 * union rather than an absent key. That is what turns the response into a
 * contract the code can rely on instead of a shape it has to defend against.
 */

const claim = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'evidence_ids', 'confidence'],
  properties: {
    text: { type: 'string' },
    evidence_ids: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
}

export const SCENE_SCHEMA = {
  name: 'scene_understanding',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'actors', 'violation_assessment', 'hazards', 'intent_hypotheses', 'trigger_agreement'],
    properties: {
      summary: { type: 'string' },
      actors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'kind', 'descriptor', 'evidence_ids'],
          properties: {
            ref: { type: 'string' },
            kind: { type: 'string', enum: ['vehicle', 'person', 'animal', 'object'] },
            /* Behaviour and appearance only. Identity is out of scope for this
               platform and the prompt says so as well. */
            descriptor: { type: 'string' },
            evidence_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      violation_assessment: { anyOf: [claim, { type: 'null' }] },
      hazards: { type: 'array', items: claim },
      intent_hypotheses: { type: 'array', items: claim },
      trigger_agreement: { type: 'boolean' },
    },
  },
} as const

export const CONTEXT_SCHEMA = {
  name: 'context_assessment',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'normalcy',
      'contributing_factors',
      'causal_chain',
      'what_happens_next',
      'permitted_activity',
      'disposition',
      'needs_human_review',
      'amplifiers',
    ],
    properties: {
      normalcy: { type: 'number', minimum: 0, maximum: 1 },
      contributing_factors: { type: 'array', items: claim },
      causal_chain: { type: 'array', items: { type: 'string' } },
      what_happens_next: claim,
      permitted_activity: { type: 'boolean' },
      disposition: {
        type: 'string',
        enum: ['enforcement', 'operations', 'infrastructure', 'educational', 'monitor', 'no-action'],
      },
      needs_human_review: { type: 'boolean' },
      /* Bounded amplifiers only. The severity arithmetic is code. */
      amplifiers: {
        type: 'object',
        additionalProperties: false,
        required: ['repeat_location', 'vulnerable_population', 'time_of_day', 'infrastructure_state', 'escalation_potential'],
        properties: {
          repeat_location: { type: 'number', minimum: 0, maximum: 1 },
          vulnerable_population: { type: 'number', minimum: 0, maximum: 1 },
          time_of_day: { type: 'number', minimum: 0, maximum: 1 },
          infrastructure_state: { type: 'number', minimum: 0, maximum: 1 },
          escalation_potential: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

export const LEGAL_SCHEMA = {
  name: 'legal_selection',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['selections', 'action_line'],
    properties: {
      selections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['section', 'confidence', 'justification'],
          properties: {
            /* Only a section already present in the curated reference may be
               named. Anything else is dropped by the validator. */
            section: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            justification: { type: 'string' },
          },
        },
      },
      action_line: { type: 'string' },
    },
  },
} as const

export const GUARD_SCHEMA = {
  name: 'policy_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'findings', 'redactions'],
    properties: {
      verdict: { type: 'string', enum: ['pass', 'redacted', 'blocked'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule', 'detail'],
          properties: { rule: { type: 'string' }, detail: { type: 'string' } },
        },
      },
      redactions: { type: 'array', items: { type: 'string' } },
    },
  },
} as const

export const QUERY_SCHEMA = {
  name: 'query_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'incident_ids', 'table'],
    properties: {
      answer: { type: 'string' },
      incident_ids: { type: 'array', items: { type: 'string' } },
      table: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['columns', 'rows'],
            properties: {
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
          },
          { type: 'null' },
        ],
      },
    },
  },
} as const
