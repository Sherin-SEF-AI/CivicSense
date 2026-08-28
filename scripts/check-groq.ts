/**
 * Verifies the understanding tier against the live API.
 *
 * Checks that the key works, that every model the role table names actually
 * exists on the account, and then runs one real structured call so the strict
 * schema path is exercised rather than assumed. Prints no part of the key.
 *
 * Run with `npm run check:groq`.
 */
import { call, isConfigured, ping, ROLES, type Role } from '../lib/groq/client'

async function main() {
  if (!isConfigured()) {
    console.error('GROQ_API_KEY is not set. Put it in .env.local or export it, then run this again.')
    process.exit(1)
  }

  const reachable = await ping()
  if (!reachable.ok) {
    console.error(`the api rejected the key: ${reachable.error}`)
    process.exit(1)
  }
  console.log(`key accepted, ${reachable.models.length} models available on this account\n`)

  const available = new Set(reachable.models)
  let missing = 0

  console.log('role            primary                              fallback                             status')
  for (const [role, config] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]) {
    const primaryOk = available.has(config.primary)
    const fallbackOk = config.fallback === null || available.has(config.fallback)
    if (!primaryOk && !fallbackOk) missing++
    const status = primaryOk ? 'ok' : fallbackOk ? 'primary missing, fallback available' : 'unavailable'
    console.log(
      `${role.padEnd(15)} ${config.primary.padEnd(36)} ${(config.fallback ?? 'none').padEnd(36)} ${status}`,
    )
  }

  if (missing > 0) {
    console.error(`\n${missing} role(s) have no available model. Update the table in lib/groq/client.ts.`)
  }

  /* One real structured call, so the strict schema path is verified rather than
     taken on trust. */
  console.log('\nrunning one structured call against the fast role')
  try {
    const result = await call<{ situation: string; confident: boolean }>({
      role: 'fast',
      schema: {
        name: 'connectivity_check',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['situation', 'confident'],
          properties: { situation: { type: 'string' }, confident: { type: 'boolean' } },
        },
      },
      messages: [
        { role: 'system', content: 'Answer with the requested JSON object and nothing else.' },
        {
          role: 'user',
          content:
            'A camera reports a two-wheeler with two occupants and no headgear on a 60 km/h corridor. Name the situation in three words and say whether the description alone is enough to be confident.',
        },
      ],
      maxTokens: 200,
    })
    console.log(`  model     ${result.model}`)
    console.log(`  latency   ${result.latencyMs} ms`)
    console.log(`  tokens    ${result.tokensIn} in, ${result.tokensOut} out`)
    console.log(`  cost      $${result.costUsd.toFixed(6)}`)
    console.log(`  response  ${JSON.stringify(result.data)}`)
    console.log('\nthe understanding tier is working. the call is recorded in model_calls.')
  } catch (error) {
    console.error(`\nthe structured call failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
