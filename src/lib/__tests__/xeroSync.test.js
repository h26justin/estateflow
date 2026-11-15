import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }))
vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...a) => invoke(...a) },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}))

import { previewXeroSync, runXeroSyncForProperties } from '../api/xero'

beforeEach(() => invoke.mockClear())

describe('Xero client API', () => {
  it('previews the whole company, or only the given properties', async () => {
    await previewXeroSync('co1')
    expect(invoke).toHaveBeenLastCalledWith('xero-sync', { body: { action: 'preview', company_id: 'co1' } })
    await previewXeroSync('co1', ['p1'])
    expect(invoke).toHaveBeenLastCalledWith('xero-sync', { body: { action: 'preview', company_id: 'co1', property_ids: ['p1'] } })
  })

  it('a per-property sync only posts when asked for "both"; by default it only pulls', async () => {
    await runXeroSyncForProperties('co1', ['p1'])
    expect(invoke.mock.calls.at(-1)[1].body).toEqual({ action: 'reconcile_only', company_id: 'co1', property_ids: ['p1'] })
    await runXeroSyncForProperties('co1', ['p1'], 'anything else')
    expect(invoke.mock.calls.at(-1)[1].body.action).toBe('reconcile_only')
    await runXeroSyncForProperties('co1', ['p1'], 'both')
    expect(invoke.mock.calls.at(-1)[1].body.action).toBe('both')
  })
})

// The edge function can't run under Vitest (Deno imports), so these pin the
// shape of the fixes in its source, the way edgeAuthz.test.js does.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const src = readFileSync(join(ROOT, 'supabase-functions/xero-sync/index.ts'), 'utf8')
const migration = readFileSync(join(ROOT, 'supabase-migrations/2026-11-15_01_xero_sync_map_entity_types.sql'), 'utf8')

describe('xero-sync edge function', () => {
  it('never ignores the result of a sync-map upsert', () => {
    const upserts = [...src.matchAll(/(.{0,40})admin\.from\('xero_sync_map'\)\.upsert\(/g)]
    expect(upserts.length).toBeGreaterThanOrEqual(2)
    for (const m of upserts) expect(m[1]).toMatch(/const \{ error(: \w+)? \} = await $/)
  })

  it('posts nothing for an entity type the map cannot record, and counts created only after the map write', () => {
    for (const t of ['mortgage_interest', 'deposit', 'refurb']) {
      expect(src).toContain(`mapReady(!!settings.sync_`)
      expect(src).toContain(`'${t}')`)
    }
    expect(src).toMatch(/mapReady\(!!settings\.sync_mortgage_interest, 'mortgage_interest'\)/)
    expect(src).toMatch(/mapReady\(!!settings\.sync_deposits_separate, 'deposit'\)/)
    expect(src).toMatch(/mapReady\(!!settings\.sync_refurb_separate, 'refurb'\)/)
    const record = src.slice(src.indexOf('const recordPushed'), src.indexOf('const skippedBlocks'))
    expect(record.indexOf('if (error)')).toBeLessThan(record.indexOf('created++'))
  })

  it('pages every "load all" read', () => {
    expect(src).not.toMatch(/const \{ data: (payments|expenses|refurbs|tenancies|syncedMap|knownRows|rows|propsWithMortgage|companyProps) \}/)
    expect((src.match(/fetchAllRows\(\(\) => admin\.from\('rent_payments'\)/g) || []).length).toBe(2)
    expect((src.match(/fetchAllRows\(\(\) => admin\.from\('property_expenses'\)/g) || []).length).toBe(2)
    expect(src).toMatch(/async function loadSyncedSet[\s\S]{0,200}fetchAllRows/)
  })

  it('undo only targets rows Properly pushed', () => {
    const undo = src.slice(src.indexOf("if (action === 'undo_push')"), src.indexOf('Concurrency guard'))
    expect(undo).toContain('const targets = rows.filter(isPushed)')
    expect(undo).toContain("r.origin === 'pulled'")
    expect(undo).toContain("startsWith('xero:')")
  })

  it('reverse sync decodes the Xero date and uses the same amount as the expense pull', () => {
    expect(src).not.toContain("(t.Date || '').slice(0, 10)")
    expect(src).toContain('const xeroDate = xeroDateISO(t)')
    expect(src).toContain('t.Total ?? t.SubTotal ?? t.LineItems?.[0]?.LineAmount')
  })

  it('aborts when the rotated refresh token cannot be saved, and refreshes under the sync lock', () => {
    expect(src).toMatch(/if \(saveErr \|\| !saved/)
    const lock = src.indexOf("rpc('acquire_xero_sync_lock', { p_user_id: caller.id, p_company_id: companyId, p_ttl_seconds: 600 })\n  if (lockErr)")
    expect(lock).toBeGreaterThan(0)
    expect(src.indexOf('await ensureToken()', lock)).toBeGreaterThan(lock)
    expect(src).not.toMatch(/^ {2}const accessToken = await refreshIfNeeded/m)
  })

  it('a per-property push of mortgage interest is scoped to that property', () => {
    const block = src.slice(src.indexOf("'mortgage_interest')) {"), src.indexOf('PUSH: tenancy deposits'))
    expect(block).toContain(".in('id', propIds)")
  })
})

describe('migration 2026-11-15_01', () => {
  it('widens the entity_type check and adds origin, idempotently', () => {
    expect(migration).toMatch(/'mortgage_interest','deposit','refurb'/)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS origin text/)
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS xero_sync_map_origin_check/)
    expect(migration).toMatch(/pg_get_constraintdef\(oid\) ILIKE '%entity_type%'/)
  })
})
