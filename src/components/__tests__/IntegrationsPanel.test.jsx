import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import { TOAST_EVENT } from '../../lib/toast'
import IntegrationsPanel from '../IntegrationsPanel'

const api = vi.hoisted(() => ({
  fetchXeroConnections: vi.fn(async () => [{ company_id: 'co1', tenant_name: 'Acme Xero' }]),
  fetchLodgifyConnections: vi.fn(async () => []),
  fetchLodgifyMappings: vi.fn(async () => []),
  fetchHostawayConnections: vi.fn(async () => []),
  fetchHostawayMappings: vi.fn(async () => []),
  fetchXeroSyncSettings: vi.fn(async () => ({ sync_rent: true, enable_webhook: true, webhook_signing_key: '' })),
  fetchXeroAccounts: vi.fn(async () => []),
  previewXeroSync: vi.fn(),
  runXeroSync: vi.fn(),
  runXeroSyncForProperties: vi.fn(),
}))
vi.mock('../../lib/api', () => Object.fromEntries(Object.keys(api).map(k => [k, (...a) => api[k](...a)])))

const T = { card: '#fff', border: '#ddd', text: '#000', muted: '#666', green: '#0a0', red: '#a00', amber: '#a60', gold: '#c90', goldText: '#960', bg: '#f7f7f7' }
const companies = [{ id: 'co1', name: 'Acme Lettings', abbr: 'AL' }]
const properties = [{ id: 'p1', company_id: 'co1', name: 'Flat 1' }, { id: 'p2', company_id: 'co1', name: 'Flat 2' }]
const empty = { count: 0, total: 0, earliest: null }
const preview = over => ({ preview: true, configured: true, missing: [], org: 'Acme Xero', bank: 'Current', from: '2026-04-06',
  rent: empty, expenses: empty, mortgage_interest: empty, deposits: empty, refurb: empty, blocked: [], preview_token: 'tok1', ...over })

let toasts = []
const onToast = e => toasts.push(e.detail)
beforeEach(() => {
  toasts = []
  window.addEventListener(TOAST_EVENT, onToast)
  for (const f of Object.values(api)) f.mockClear()
})
afterEach(() => window.removeEventListener(TOAST_EVENT, onToast))

async function openSettings() {
  render(<ThemeProvider><ConfirmProvider>
    <IntegrationsPanel T={T} mono="monospace" companies={companies} properties={properties} devModeActive />
  </ConfirmProvider></ThemeProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await screen.findByRole('button', { name: 'Save settings' })
}
const syncThisOne = () => fireEvent.click(screen.getAllByRole('button', { name: 'Sync this one' })[0])

describe('Xero per-property "Sync this one"', () => {
  it('previews only that property and posts only after a yes, listing mortgage interest too', async () => {
    api.previewXeroSync.mockResolvedValue(preview({ mortgage_interest: { count: 1, total: 250, earliest: '2026-11-01' } }))
    api.runXeroSyncForProperties.mockResolvedValue({ ok: true, created: 1, updated: 0, failed: 0 })
    await openSettings()
    syncThisOne()
    expect(await screen.findByText(/1 mortgage interest accrual\(s\), £250\.00, earliest 2026-11-01/)).toBeTruthy()
    expect(api.previewXeroSync).toHaveBeenCalledWith('co1', ['p1'])
    expect(api.runXeroSyncForProperties).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Post 1 to Xero' }))
    await waitFor(() => expect(api.runXeroSyncForProperties).toHaveBeenCalledWith('co1', ['p1'], 'both', { previewToken: 'tok1' }))
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ kind: 'info' }))
  })

  it('posts nothing when the confirm is cancelled', async () => {
    api.previewXeroSync.mockResolvedValue(preview({ rent: { count: 2, total: 1500, earliest: '2026-10-01' } }))
    await openSettings()
    syncThisOne()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sync this one' })[0].disabled).toBe(false))
    expect(api.runXeroSyncForProperties).not.toHaveBeenCalled()
  })

  it('with nothing to post, only pulls (no dialog)', async () => {
    api.previewXeroSync.mockResolvedValue(preview())
    api.runXeroSyncForProperties.mockResolvedValue({ ok: true, created: 0, updated: 3, failed: 0 })
    await openSettings()
    syncThisOne()
    await waitFor(() => expect(api.runXeroSyncForProperties).toHaveBeenCalledWith('co1', ['p1'], 'reconcile_only', { previewToken: undefined }))
    expect(screen.queryByRole('button', { name: /to Xero$/ })).toBeNull()
  })

  it('keeps the settings panel (and unsaved edits) open after the sync reloads the list', async () => {
    api.previewXeroSync.mockResolvedValue(preview())
    api.runXeroSyncForProperties.mockResolvedValue({ ok: true, created: 0, updated: 0, failed: 0 })
    await openSettings()
    const key = screen.getByPlaceholderText('paste signing key from Xero')
    fireEvent.change(key, { target: { value: 'abc' } })
    let finishReload
    api.fetchXeroConnections.mockImplementationOnce(() => new Promise(r => { finishReload = () => r([{ company_id: 'co1', tenant_name: 'Acme Xero' }]) }))
    syncThisOne()
    await waitFor(() => expect(api.fetchXeroConnections).toHaveBeenCalledTimes(2))
    // Mid-reload: no skeleton swap, the panel and its draft are still there.
    expect(screen.getByPlaceholderText('paste signing key from Xero').value).toBe('abc')
    finishReload()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sync this one' })[0].disabled).toBe(false))
    expect(screen.getByPlaceholderText('paste signing key from Xero').value).toBe('abc')
    expect(api.fetchXeroSyncSettings).toHaveBeenCalledTimes(1)
  })
})

describe('Xero Sync now', () => {
  it('is not success-styled when anything failed', async () => {
    api.previewXeroSync.mockResolvedValue(preview({ expenses: { count: 1, total: 90, earliest: '2026-10-02' } }))
    api.runXeroSync.mockResolvedValue({ ok: true, created: 0, updated: 0, failed: 1, errors: ['expense e1: invalid account'] })
    render(<ThemeProvider><ConfirmProvider>
      <IntegrationsPanel T={T} mono="monospace" companies={companies} properties={properties} devModeActive />
    </ConfirmProvider></ThemeProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Post 1 to Xero' }))
    await waitFor(() => expect(api.runXeroSync).toHaveBeenCalledWith('co1', 'both', { previewToken: 'tok1' }))
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ kind: 'error' }))
    expect(toasts.at(-1).message).toMatch(/1 failed\. expense e1: invalid account/)
  })

  it('counts deposit and refurb blocks as something to post', async () => {
    api.previewXeroSync.mockResolvedValue(preview({ deposits: { count: 1, total: 1200, earliest: '2026-09-01' }, refurb: { count: 2, total: 800, earliest: '2026-08-01' } }))
    api.runXeroSync.mockResolvedValue({ ok: true, created: 3, updated: 0, failed: 0 })
    render(<ThemeProvider><ConfirmProvider>
      <IntegrationsPanel T={T} mono="monospace" companies={companies} properties={properties} devModeActive />
    </ConfirmProvider></ThemeProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText(/1 tenancy deposit\(s\), £1,200\.00/)).toBeTruthy()
    expect(screen.getByText(/2 refurb cost\(s\), £800\.00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Post 3 to Xero' }))
    await waitFor(() => expect(api.runXeroSync).toHaveBeenCalledWith('co1', 'both', { previewToken: 'tok1' }))
  })
})

describe('Xero preview is bound to the push', () => {
  it('when the server says the list changed, nothing is reported as posted and the preview opens again', async () => {
    api.previewXeroSync
      .mockResolvedValueOnce(preview({ rent: { count: 1, total: 500, earliest: '2026-10-01' } }))
      .mockResolvedValueOnce(preview({ rent: { count: 2, total: 1000, earliest: '2026-10-01' }, preview_token: 'tok2' }))
    const changed = Object.assign(new Error('The list of transactions to post to Xero changed since you reviewed it — review again. Nothing was posted.'), { code: 'preview_changed' })
    api.runXeroSync.mockRejectedValueOnce(changed).mockResolvedValueOnce({ ok: true, created: 2, updated: 0, failed: 0 })
    render(<ThemeProvider><ConfirmProvider>
      <IntegrationsPanel T={T} mono="monospace" companies={companies} properties={properties} devModeActive />
    </ConfirmProvider></ThemeProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Post 1 to Xero' }))
    await waitFor(() => expect(api.runXeroSync).toHaveBeenCalledWith('co1', 'both', { previewToken: 'tok1' }))
    // The new list is shown for review; posting carries the new token.
    fireEvent.click(await screen.findByRole('button', { name: 'Post 2 to Xero' }))
    await waitFor(() => expect(api.runXeroSync).toHaveBeenLastCalledWith('co1', 'both', { previewToken: 'tok2' }))
    expect(api.previewXeroSync).toHaveBeenCalledTimes(2)
    expect(toasts.some(t => /changed since you reviewed it/.test(t.message))).toBe(true)
  })
})

describe('Xero settings panel', () => {
  it('typing in the webhook key keeps the same input (no remount per keystroke)', async () => {
    await openSettings()
    const key = screen.getByPlaceholderText('paste signing key from Xero')
    key.focus()
    fireEvent.change(key, { target: { value: 'a' } })
    expect(screen.getByPlaceholderText('paste signing key from Xero')).toBe(key)
    expect(document.activeElement).toBe(key)
  })
})
