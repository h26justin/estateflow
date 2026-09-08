import { describe, it, expect } from 'vitest'
import { resolveWidgetPrefs } from '../dashboardPrefs'

const ORDER = ['value', 'rent', 'forecast', 'received', 'arrears', 'count']
const ENABLED = { value: true, rent: true, forecast: true, received: true, arrears: true, count: false }

describe('resolveWidgetPrefs', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(resolveWidgetPrefs(null, ORDER, ENABLED)).toEqual([
      { key: 'value', enabled: true }, { key: 'rent', enabled: true }, { key: 'forecast', enabled: true },
      { key: 'received', enabled: true }, { key: 'arrears', enabled: true }, { key: 'count', enabled: false },
    ])
    expect(resolveWidgetPrefs([], ORDER, ENABLED)).toHaveLength(6)
  })

  it('keeps the saved order and flags, and inserts new keys at their default position', () => {
    const saved = [{ key: 'arrears', enabled: true }, { key: 'value', enabled: true }, { key: 'rent', enabled: false }, { key: 'count', enabled: true }]
    expect(resolveWidgetPrefs(saved, ORDER, ENABLED).map(w => `${w.key}:${w.enabled ? 1 : 0}`)).toEqual([
      'arrears:1', 'value:1', 'rent:0', 'forecast:1', 'received:1', 'count:1',
    ])
  })

  it('falls back to the nearest earlier default key when the immediate predecessor is missing', () => {
    const saved = [{ key: 'value', enabled: true }, { key: 'arrears', enabled: true }]
    expect(resolveWidgetPrefs(saved, ORDER, ENABLED).map(w => w.key)).toEqual(['value', 'rent', 'forecast', 'received', 'arrears', 'count'])
  })

  it('puts a new key with no earlier default key at the front', () => {
    const saved = [{ key: 'rent', enabled: true }]
    expect(resolveWidgetPrefs(saved, ORDER, ENABLED).map(w => w.key)[0]).toBe('value')
  })

  it('keeps unknown saved keys so the caller can drop or ignore them', () => {
    const saved = [{ key: 'gone', enabled: true }, { key: 'value', enabled: true }]
    expect(resolveWidgetPrefs(saved, ORDER, ENABLED).map(w => w.key)).toContain('gone')
  })

  it('pins an unsaved key directly before its anchor when opts.before names one', () => {
    // User has the "alerts" sections below the grid; the new key must still
    // land right above the grid, not after alerts.
    const order = ['alerts', 'inbox', 'income', 'grid', 'company']
    const saved = [{ key: 'grid', enabled: true }, { key: 'company', enabled: true }, { key: 'alerts', enabled: true }, { key: 'inbox', enabled: false }]
    expect(resolveWidgetPrefs(saved, order, {}, { before: { income: 'grid' } }).map(w => w.key))
      .toEqual(['income', 'grid', 'company', 'alerts', 'inbox'])
    // Without the anchor it follows the nearest earlier default key (inbox).
    expect(resolveWidgetPrefs(saved, order, {}).map(w => w.key))
      .toEqual(['grid', 'company', 'alerts', 'inbox', 'income'])
    // Anchor missing from the layout: falls back to the default rule.
    expect(resolveWidgetPrefs([{ key: 'alerts', enabled: true }], order, {}, { before: { income: 'grid' } }).map(w => w.key))
      .toEqual(['alerts', 'inbox', 'income', 'grid', 'company'])
  })

  it('puts a new first-default key at the top of any saved layout', () => {
    // Rental Income leads SECTION_DEFAULT_ORDER, so every existing user sees it
    // first until they move it.
    const order = ['income', 'alerts', 'grid', 'company']
    const saved = [{ key: 'grid', enabled: true }, { key: 'company', enabled: true }, { key: 'alerts', enabled: true }]
    expect(resolveWidgetPrefs(saved, order, {}).map(w => w.key)).toEqual(['income', 'grid', 'company', 'alerts'])
  })

  it('does not mutate the saved array', () => {
    const saved = [{ key: 'value', enabled: true }]
    resolveWidgetPrefs(saved, ORDER, ENABLED)
    expect(saved).toHaveLength(1)
  })
})
