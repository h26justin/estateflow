import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SETTINGS_PAGES, SETTINGS_TABS, resolveSettingsKey, settingsKeyFromHash, DEFAULT_SETTINGS_PAGE } from '../nav'

// Every Settings sub-tab key that existed before the five-page consolidation
// (2026-10). Deep links, notifications, the command palette and the drawer
// still send these, so each must keep resolving to a real section.
const LEGACY_TAB_KEYS = {
  account: 'account', security: 'account', display: 'account', notifications: 'account', navbar: 'account',
  features: 'companies', branding: 'companies', tenant: 'companies', team: 'companies',
  compliance: 'portfolio', milestones: 'portfolio', reporting: 'portfolio',
  integrations: 'integrations', bookkeeping: 'integrations', inbox: 'integrations',
  backups: 'integrations', trash: 'integrations', admin: 'integrations',
  billing: 'billing', referral: 'billing', help: 'billing',
}

describe('resolveSettingsKey', () => {
  it('maps every legacy tab key to its new page and section', () => {
    for (const [key, page] of Object.entries(LEGACY_TAB_KEYS)) {
      expect(resolveSettingsKey(key)).toEqual({ page, section: key })
    }
  })

  it('covers all 21 legacy keys and no section is lost or duplicated', () => {
    const sectionKeys = SETTINGS_PAGES.flatMap(p => p.sections.map(s => s.key))
    expect(new Set(sectionKeys).size).toBe(sectionKeys.length)
    expect([...sectionKeys].sort()).toEqual(Object.keys(LEGACY_TAB_KEYS).sort())
  })

  it('opens a page at the top when given a page key', () => {
    expect(resolveSettingsKey('companies')).toEqual({ page: 'companies', section: null })
    expect(resolveSettingsKey('portfolio')).toEqual({ page: 'portfolio', section: null })
  })

  it('falls back to the page top for a hidden conditional section', () => {
    expect(resolveSettingsKey('admin', new Set(['admin']))).toEqual({ page: 'integrations', section: null })
    expect(resolveSettingsKey('bookkeeping', new Set(['bookkeeping']))).toEqual({ page: 'integrations', section: null })
  })

  it('falls back to the default page for unknown or empty keys', () => {
    expect(resolveSettingsKey('nonsense')).toEqual({ page: DEFAULT_SETTINGS_PAGE, section: null })
    expect(resolveSettingsKey(null)).toEqual({ page: DEFAULT_SETTINGS_PAGE, section: null })
  })
})

describe('settingsKeyFromHash', () => {
  it('reads the key from settings hashes only', () => {
    expect(settingsKeyFromHash('#/settings/billing')).toBe('billing')
    expect(settingsKeyFromHash('#settings/backups')).toBe('backups')
    expect(settingsKeyFromHash('#/settings')).toBe(null)
    expect(settingsKeyFromHash('#/deals/pipeline')).toBe(null)
    expect(settingsKeyFromHash('')).toBe(null)
  })
})

describe('SETTINGS_TABS (command palette back-compat)', () => {
  it('lists unconditional sections only, keyed by page', () => {
    const keys = Object.values(SETTINGS_TABS).flat().map(t => t.key)
    expect(keys).toContain('billing')
    expect(keys).toContain('backups')
    expect(keys).not.toContain('admin')
    expect(keys).not.toContain('bookkeeping')
    for (const t of Object.values(SETTINGS_TABS).flat()) expect(typeof t.label).toBe('string')
  })
})

describe('SettingsPage render order', () => {
  // Sections render in place, so the registry order (the jump list) must
  // match the order SettingsPage emits them in.
  it('matches SETTINGS_PAGES section order within each page', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/settings/SettingsPage.jsx'), 'utf8')
    const rendered = [...src.matchAll(/\{sectionHeading\('([a-z]+)'\)\}/g)].map(m => m[1])
    for (const page of SETTINGS_PAGES) {
      const keys = page.sections.map(s => s.key)
      expect(rendered.filter(k => keys.includes(k))).toEqual(keys)
    }
  })
})
