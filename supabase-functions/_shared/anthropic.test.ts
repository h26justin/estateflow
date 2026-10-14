// @vitest-environment node
//
// Tests for the shared Claude helper (Deno source, run under vitest — the
// helper only touches Deno through a guarded globalThis lookup) and for the
// small pure helpers the AI edge functions import. Also enforces that every
// per-function copy of anthropic.ts matches the canonical _shared file.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  callClaude, callClaudeWithEscalation, checkAiRateLimit, recordAiUsage, ClaudeError,
  validateAgainstSchema, firstTextBlock, modelForTier, nullable, obj, DEFAULT_MODELS,
} from './anthropic.ts'
import { isAllowedJobPhotoPath } from '../maintenance-triage/photo-paths.ts'
import { decideComplianceTarget } from '../extract-document/compliance-gate.ts'

const here = dirname(fileURLToPath(import.meta.url))
const functionsDir = join(here, '..')

// ── helpers ─────────────────────────────────────────────────────────────────
function apiResponse(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}
function okMessage(over: Record<string, unknown> = {}) {
  return apiResponse({
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"a":"x"}' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    ...over,
  })
}
const SCHEMA = obj({ a: { type: 'string' } })
const noSleep = async () => {}
const base = { apiKey: 'test-key', sleepImpl: noSleep }

afterEach(() => {
  delete (globalThis as any).Deno
})

describe('per-function copies', () => {
  it('every function copy of anthropic.ts is identical to _shared/anthropic.ts', () => {
    const canonical = readFileSync(join(here, 'anthropic.ts'), 'utf8')
    const copies = readdirSync(functionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '_shared')
      .map((d) => join(functionsDir, d.name, 'anthropic.ts'))
      .filter((p) => existsSync(p))
    expect(copies.length).toBeGreaterThanOrEqual(10)
    for (const p of copies) {
      expect(readFileSync(p, 'utf8'), `${p} drifted — re-copy from _shared/anthropic.ts`).toBe(canonical)
    }
  })

  it('no AI function still hard-codes a model id or calls the API directly', () => {
    const fns = ['ai-listing-writer', 'bookkeeping-ai', 'epc-planner', 'extract-document', 'ingest-statement-email',
      'lettings-assistant', 'maintenance-triage', 'portfolio-autopilot', 'portfolio-insights', 'rra-notice']
    for (const f of fns) {
      const src = readFileSync(join(functionsDir, f, 'index.ts'), 'utf8')
      expect(src, f).not.toMatch(/api\.anthropic\.com/)
      expect(src, f).not.toMatch(/['"`]claude-(opus|sonnet|haiku)-/)
      expect(src, f).toMatch(/from '\.\/anthropic\.ts'/)
    }
  })
})

describe('modelForTier', () => {
  it('maps tiers to the current models', () => {
    expect(modelForTier('fast')).toBe('claude-haiku-5-5')
    expect(modelForTier('standard')).toBe('claude-sonnet-5-5')
    expect(modelForTier('escalate')).toBe('claude-opus-5-5')
  })
  it('honours a per-tier env override', () => {
    ;(globalThis as any).Deno = { env: { get: (k: string) => (k === 'ANTHROPIC_MODEL_FAST' ? 'claude-sonnet-5-5' : undefined) } }
    expect(modelForTier('fast')).toBe('claude-sonnet-5-5')
    expect(modelForTier('standard')).toBe(DEFAULT_MODELS.standard)
  })
})

describe('validateAgainstSchema', () => {
  const schema = obj({
    kind: { type: 'string', enum: ['a', 'b'] },
    n: nullable({ type: 'number' }),
    list: { type: 'array', items: obj({ id: { type: 'string' } }) },
  })
  it('accepts a valid object', () => {
    expect(validateAgainstSchema({ kind: 'a', n: null, list: [{ id: 'x' }] }, schema)).toBeNull()
  })
  it('reports missing keys, bad enums and nested type errors', () => {
    expect(validateAgainstSchema({ kind: 'a', list: [] }, schema)).toMatch(/\$\.n: missing/)
    expect(validateAgainstSchema({ kind: 'z', n: 1, list: [] }, schema)).toMatch(/kind/)
    expect(validateAgainstSchema({ kind: 'a', n: 1, list: [{ id: 3 }] }, schema)).toMatch(/list\[0\]\.id/)
  })
})

describe('firstTextBlock', () => {
  it('skips thinking blocks and never assumes content[0] is text', () => {
    expect(firstTextBlock([{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hi' }])).toBe('hi')
    expect(firstTextBlock([{ type: 'thinking', thinking: '' }])).toBe('')
    expect(firstTextBlock(undefined)).toBe('')
  })
})

describe('callClaude', () => {
  it('sends tier model, effort, structured output, and the server-side fallback for Sonnet', async () => {
    const fetchImpl = vi.fn(async () => okMessage())
    const r = await callClaude({ ...base, tier: 'standard', content: 'x', maxTokens: 100, schema: SCHEMA, fetchImpl })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } })
    expect(body.fallbacks).toBe('default')
    expect((init.headers as Record<string, string>)['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    expect(body).not.toHaveProperty('temperature')
    expect(r.data).toEqual({ a: 'x' })
    expect(r.usage.input_tokens).toBe(10)
  })

  it('does not send fallbacks to Haiku (no server-side fallback there)', async () => {
    const fetchImpl = vi.fn(async () => okMessage({ model: 'claude-haiku-5-5' }))
    await callClaude({ ...base, tier: 'fast', content: 'x', maxTokens: 100, fetchImpl })
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.fallbacks).toBeUndefined()
    expect(body.output_config.effort).toBe('low')
  })

  it('reports the model that actually served the response', async () => {
    const fetchImpl = vi.fn(async () => okMessage({ model: 'claude-sonnet-5' }))
    const r = await callClaude({ ...base, tier: 'standard', content: 'x', maxTokens: 100, fetchImpl })
    expect(r.model).toBe('claude-sonnet-5')
    expect(r.requestedModel).toBe('claude-sonnet-5-5')
  })

  it('retries the same model on 529 / 429, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(apiResponse({ error: 'overloaded' }, 529))
      .mockResolvedValueOnce(apiResponse({ error: 'rate' }, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(okMessage())
    const r = await callClaude({ ...base, tier: 'standard', content: 'x', maxTokens: 100, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const models = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).model)
    expect(new Set(models)).toEqual(new Set(['claude-sonnet-5-5']))
    expect(r.attempts).toBe(3)
  })

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn(async () => apiResponse({ error: 'bad' }, 400))
    await expect(callClaude({ ...base, tier: 'standard', content: 'x', maxTokens: 100, fetchImpl }))
      .rejects.toMatchObject({ kind: 'http', status: 400 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('turns max_tokens and refusal stop reasons into clear errors', async () => {
    const cut = vi.fn(async () => okMessage({ stop_reason: 'max_tokens' }))
    await expect(callClaude({ ...base, tier: 'fast', content: 'x', maxTokens: 50, fetchImpl: cut }))
      .rejects.toMatchObject({ kind: 'max_tokens' })
    const refused = vi.fn(async () => okMessage({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }))
    const err = await callClaude({ ...base, tier: 'fast', content: 'x', maxTokens: 50, fetchImpl: refused }).catch((e) => e)
    expect(err).toBeInstanceOf(ClaudeError)
    expect(err.kind).toBe('refusal')
    expect(err.refusalCategory).toBe('cyber')
  })

  it('flags unparseable / off-schema structured output', async () => {
    const bad = vi.fn(async () => okMessage({ content: [{ type: 'text', text: 'not json' }] }))
    await expect(callClaude({ ...base, tier: 'fast', content: 'x', maxTokens: 50, schema: SCHEMA, fetchImpl: bad }))
      .rejects.toMatchObject({ kind: 'parse' })
    const off = vi.fn(async () => okMessage({ content: [{ type: 'text', text: '{"b":1}' }] }))
    await expect(callClaude({ ...base, tier: 'fast', content: 'x', maxTokens: 50, schema: SCHEMA, fetchImpl: off }))
      .rejects.toMatchObject({ kind: 'schema' })
  })

  it('fails fast without an API key', async () => {
    await expect(callClaude({ tier: 'fast', content: 'x', maxTokens: 50, apiKey: '' }))
      .rejects.toMatchObject({ kind: 'config' })
  })
})

describe('callClaudeWithEscalation', () => {
  it('escalates to the escalate tier on a parse failure and sums usage', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okMessage({ content: [{ type: 'text', text: 'oops' }] }))
      .mockResolvedValueOnce(okMessage({ model: 'claude-opus-5-5' }))
    const r = await callClaudeWithEscalation({ ...base, tier: 'standard', content: 'x', maxTokens: 50, schema: SCHEMA, fetchImpl })
    const second = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))
    expect(second.model).toBe('claude-opus-5-5')
    expect(r.escalated).toBe(true)
    expect(r.model).toBe('claude-opus-5-5')
    expect(r.usage.input_tokens).toBe(20)
  })

  it('does NOT escalate on rate limiting / overload', async () => {
    const fetchImpl = vi.fn(async () => apiResponse({ error: 'rate' }, 429))
    await expect(callClaudeWithEscalation({ ...base, tier: 'standard', content: 'x', maxTokens: 50, schema: SCHEMA, fetchImpl, maxRetries: 1 }))
      .rejects.toMatchObject({ kind: 'http', status: 429 })
    const models = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).model)
    expect(models).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])
  })

  it('does NOT escalate a valid low-confidence answer', async () => {
    const fetchImpl = vi.fn(async () => okMessage({ content: [{ type: 'text', text: '{"a":"low"}' }] }))
    const r = await callClaudeWithEscalation({ ...base, tier: 'fast', content: 'x', maxTokens: 50, schema: SCHEMA, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r.escalated).toBe(false)
  })
})

describe('checkAiRateLimit / recordAiUsage', () => {
  // Minimal stand-in for the supabase-js query builder.
  function fakeAdmin(opts: { count?: number; countError?: any; insertError?: any }) {
    const calls: { op: string; payload?: unknown }[] = []
    const builder = (op: string): any => {
      const b: any = {
        select: () => b, eq: () => b, gte: () => b, single: () => b,
        insert: (payload: unknown) => { calls.push({ op: 'insert', payload }); return builder('insert') },
        update: (payload: unknown) => { calls.push({ op: 'update', payload }); return builder('update') },
        then: (res: (v: unknown) => unknown) => {
          if (op === 'count') return Promise.resolve({ count: opts.count ?? 0, error: opts.countError ?? null }).then(res)
          if (op === 'insert') return Promise.resolve({ data: opts.insertError ? null : { id: 42 }, error: opts.insertError ?? null }).then(res)
          return Promise.resolve({ data: null, error: null }).then(res)
        },
      }
      return b
    }
    return {
      calls,
      from: () => ({
        select: () => builder('count'),
        insert: (payload: unknown) => { calls.push({ op: 'insert', payload }); return builder('insert') },
        update: (payload: unknown) => { calls.push({ op: 'update', payload }); return builder('update') },
      }),
    }
  }

  it('reserves a row when under the cap', async () => {
    const admin = fakeAdmin({ count: 3 })
    const d = await checkAiRateLimit(admin, 'u1', 'fn', { perHour: 5 })
    expect(d).toEqual({ allowed: true, usageId: 42 })
    expect(admin.calls[0]).toEqual({ op: 'insert', payload: { user_id: 'u1', function_name: 'fn' } })
  })

  it('denies with 429 at the cap', async () => {
    const d = await checkAiRateLimit(fakeAdmin({ count: 5 }), 'u1', 'fn', { perHour: 5 })
    expect(d).toMatchObject({ allowed: false, status: 429 })
  })

  it('fails open only when the ai_usage table is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing = await checkAiRateLimit(fakeAdmin({ countError: { code: '42P01', message: 'relation "ai_usage" does not exist' } }), 'u1', 'fn', { perDay: 1 })
    expect(missing).toEqual({ allowed: true, usageId: null })
    const broken = await checkAiRateLimit(fakeAdmin({ countError: { code: '57014', message: 'timeout' } }), 'u1', 'fn', { perDay: 1 })
    expect(broken).toMatchObject({ allowed: false, status: 503 })
  })

  it('records the served model and tokens', async () => {
    const admin = fakeAdmin({})
    await recordAiUsage(admin, 42, { model: 'claude-haiku-5-5', usage: { input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
    expect(admin.calls[0]).toEqual({ op: 'update', payload: { model: 'claude-haiku-5-5', input_tokens: 7, output_tokens: 3 } })
  })
})

describe('maintenance-triage photo paths', () => {
  const job = { user_id: 'tenant-1', property_id: 'prop-1' }
  it('allows the reporter tenant-upload folder and the owner property folder', () => {
    expect(isAllowedJobPhotoPath('tenant-1/tenant-uploads/1700.jpg', job, 'owner-1')).toBe(true)
    expect(isAllowedJobPhotoPath('owner-1/prop-1/1700_leak.png', job, 'owner-1')).toBe(true)
  })
  it("rejects other users' files, traversal and bare prefixes", () => {
    expect(isAllowedJobPhotoPath('someone-else/tenant-uploads/x.jpg', job, 'owner-1')).toBe(false)
    expect(isAllowedJobPhotoPath('owner-1/other-prop/lease.pdf', job, 'owner-1')).toBe(false)
    expect(isAllowedJobPhotoPath('tenant-1/tenant-uploads/../../owner-2/prop/x.pdf', job, 'owner-1')).toBe(false)
    expect(isAllowedJobPhotoPath('/tenant-1/tenant-uploads/x.jpg', job, 'owner-1')).toBe(false)
    expect(isAllowedJobPhotoPath('tenant-1/tenant-uploads/', job, 'owner-1')).toBe(false)
    expect(isAllowedJobPhotoPath(42, job, 'owner-1')).toBe(false)
  })
})

describe('extract-document compliance gate', () => {
  it('auto-writes only on a high-confidence match that agrees with the document', () => {
    expect(decideComplianceTarget('p1', { property_id: 'p1', match_confidence: 'high' }))
      .toEqual({ propertyId: 'p1', needsReview: false, reason: null })
    expect(decideComplianceTarget(null, { property_id: 'p2', match_confidence: 'high' }).propertyId).toBe('p2')
  })
  it('stages medium / low / missing / conflicting matches for review', () => {
    expect(decideComplianceTarget('p1', { property_id: 'p1', match_confidence: 'medium' })).toMatchObject({ propertyId: null, needsReview: true })
    expect(decideComplianceTarget('p1', { property_id: 'p1', match_confidence: 'low' })).toMatchObject({ propertyId: null, needsReview: true })
    expect(decideComplianceTarget('p1', null)).toMatchObject({ propertyId: null, needsReview: true })
    expect(decideComplianceTarget('p1', { property_id: 'p9', match_confidence: 'high' }))
      .toMatchObject({ propertyId: null, needsReview: true, reason: 'match_conflicts_with_document_property' })
  })
})
