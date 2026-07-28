import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'
import { useConfirm } from '../lib/ConfirmContext'

// ── INTEGRATIONS SETTINGS PANEL — Phase 2 ────────────────────────────
// Settings → Portfolio Setup → Integrations.
//
// Multi-company: each of the user's OwnProperly companies gets its own
// Xero connection card. A user with N companies can link N separate
// Xero orgs.
//
// Per-connection settings: toggles for what to sync, account-code
// pickers, per-property bank account overrides, etc.

export default function IntegrationsPanel({ T, mono, companies = [], properties = [] }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const conns = await api.fetchXeroConnections()
      setConnections(conns)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign:'center', fontFamily: mono, fontSize: 12, color: T.muted }}>Loading integrations…</div>

  // Filter out limited-company-side companies (this panel only shows
  // companies the user owns / has access to)
  const visibleCompanies = (companies || []).filter(c => !c.deleted_at)

  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom: 6 }}>
        Integrations
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 18, lineHeight: 1.5 }}>
        Connect each OwnProperly company to its own Xero organisation. Each connection has independent sync controls.
      </div>

      {visibleCompanies.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 26px', fontFamily: mono, fontSize: 12, color: T.muted }}>
          No companies yet. Create one in Settings → Companies first.
        </div>
      )}

      {visibleCompanies.map(co => {
        const conn = connections.find(c => c.company_id === co.id)
        return (
          <CompanyXeroCard
            key={co.id}
            T={T} mono={mono}
            company={co}
            connection={conn}
            properties={(properties || []).filter(p => p.company_id === co.id)}
            onChanged={load}
          />
        )
      })}

      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.1em', margin: '26px 0 6px' }}>
        Short-term lets
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 18, lineHeight: 1.5 }}>
        Pull Airbnb / Booking.com / direct bookings from Lodgify into the Rent Tracker as revenue. One Lodgify account covers all your listings.
      </div>
      <LodgifyCard T={T} mono={mono} properties={properties || []} />
    </div>
  )
}

// ── LODGIFY (STL) CARD ─────────────────────────────────────────────────
// One per user, not per company — a Lodgify account holds all listings.
// Flow: paste API key → map each Lodgify listing to an OwnProperly
// property → sync (manual button here; daily 05:30 UTC cron server-side).
function LodgifyCard({ T, mono, properties }) {
  const confirmDialog = useConfirm()
  const [connection, setConnection] = useState(null)
  const [mappings, setMappings] = useState([])          // saved rows from DB
  const [lodgifyProps, setLodgifyProps] = useState(null) // live list, loaded on demand
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [lastSync, setLastSync] = useState(null)         // result of the last manual sync

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [conn, maps] = await Promise.all([
        api.fetchLodgifyConnection(),
        api.fetchLodgifyMappings(),
      ])
      setConnection(conn)
      setMappings(maps)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function connect() {
    if (!apiKey.trim()) { showAppToast('Paste your Lodgify API key first', 'error'); return }
    setBusy('connect')
    try {
      const r = await api.connectLodgify(apiKey.trim())
      setApiKey('')
      setLodgifyProps(r.properties || [])
      showAppToast(`Lodgify connected — ${r.properties?.length || 0} ${r.properties?.length === 1 ? 'listing' : 'listings'} found. Map them below.`)
      await load()
    } catch (e) { showAppToast(e.message, 'error') }
    setBusy(null)
  }

  async function openMappingEditor() {
    setBusy('props')
    try {
      const r = await api.fetchLodgifyProperties()
      setLodgifyProps(r.properties || [])
    } catch (e) { showAppToast(e.message, 'error') }
    setBusy(null)
  }

  function setMappingFor(lp, propertyId) {
    setMappings(ms => {
      const rest = ms.filter(m => String(m.lodgify_property_id) !== String(lp.id))
      if (!propertyId) return rest
      return [...rest, { lodgify_property_id: lp.id, lodgify_property_name: lp.name, property_id: propertyId }]
    })
  }

  async function saveMappings() {
    setBusy('save')
    try {
      await api.saveLodgifyMappings(mappings.map(m => ({
        lodgify_property_id: m.lodgify_property_id,
        lodgify_property_name: m.lodgify_property_name,
        property_id: m.property_id,
      })))
      showAppToast('Mappings saved')
      setLodgifyProps(null)
      await load()
    } catch (e) { showAppToast(e.message, 'error') }
    setBusy(null)
  }

  async function syncNow() {
    setBusy('sync')
    try {
      const r = await api.runLodgifySync()
      setLastSync(r)
      const parts = [
        r.created ? `${r.created} new` : null,
        r.updated ? `${r.updated} updated` : null,
        r.removed ? `${r.removed} cancelled` : null,
      ].filter(Boolean).join(', ') || 'nothing new'
      showAppToast(`Lodgify: ${parts} (${r.bookings} bookings checked)`)
      await load()
    } catch (e) { showAppToast(`Sync failed: ${e.message}`, 'error') }
    setBusy(null)
  }

  async function disconnect() {
    if (!await confirmDialog({
      title: 'Disconnect Lodgify?',
      body: 'Future syncs stop and the booking list clears. Rent Tracker entries already created stay — that revenue really happened.',
      confirmLabel: 'Disconnect', destructive: true,
    })) return
    setBusy('disconnect')
    try {
      await api.disconnectLodgify()
      setConnection(null); setMappings([]); setLodgifyProps(null)
      showAppToast('Lodgify disconnected')
    } catch (e) { showAppToast(e.message, 'error') }
    setBusy(null)
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 26px', marginBottom: 16 }
  const selectStyle = { fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, width: '100%' }
  const isConnected = !!connection

  // Alphabetical with natural number handling ("Flat 2" before "Flat 10") —
  // the raw properties array arrives in portfolio drag-sort order, which
  // interleaves companies and reads as noise in a long dropdown.
  const propLabel = p => p.name || p.address || ''
  const naturalSort = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
  const sortedProperties = properties
    .filter(p => !p.deleted_at && !p.archived_at)
    .sort((a, b) => naturalSort(propLabel(a), propLabel(b)))
  const sortedLodgifyProps = lodgifyProps
    ? [...lodgifyProps].sort((a, b) => naturalSort(a.name || '', b.name || ''))
    : null
  const sortedMappings = [...mappings].sort((a, b) =>
    naturalSort(a.lodgify_property_name || String(a.lodgify_property_id), b.lodgify_property_name || String(b.lodgify_property_id)))

  if (loading) return <div style={card}><div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div></div>

  return (
    <div style={card}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 14, flexWrap:'wrap', gap: 10 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: '#E8542722', color: '#E85427', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 17 }}>
            🏖
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Lodgify</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
              Airbnb · Booking.com · direct bookings
            </div>
          </div>
        </div>
        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding:'4px 11px', borderRadius: 20, background: isConnected ? T.green+'22' : T.border, color: isConnected ? T.green : T.muted }}>
          {isConnected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {!isConnected ? (
        <>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Bookings sync in as dated Rent Tracker entries — paid, part-paid or pending from the booking's balance, tagged with the channel (Airbnb, Booking.com…). Get your key in Lodgify: <strong style={{ color: T.text }}>Settings → Public API</strong>.
          </div>
          <div style={{ display:'flex', gap: 8, flexWrap:'wrap' }}>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste Lodgify API key"
              autoComplete="off"
              style={{ ...selectStyle, flex: 1, minWidth: 220, maxWidth: 380 }}
            />
            <button onClick={connect} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
              {busy==='connect' ? 'Checking key…' : '🔌 Connect Lodgify'}
            </button>
          </div>
        </>
      ) : (
        <>
          {mappings.length > 0 ? (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.text, marginBottom: 6 }}>
              {sortedMappings.map(m => {
                const prop = properties.find(p => p.id === m.property_id)
                return (
                  <div key={m.lodgify_property_id} style={{ marginBottom: 2 }}>
                    <span style={{ color: T.muted }}>{m.lodgify_property_name || `Lodgify #${m.lodgify_property_id}`}</span>
                    {' → '}{prop ? (prop.name || prop.address) : m.property_id}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.amber || '#c90', marginBottom: 6 }}>
              No listings mapped yet — nothing will sync until you map one.
            </div>
          )}
          {connection.last_synced_at && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 4 }}>
              Last sync: {new Date(connection.last_synced_at).toLocaleString('en-GB')}
              {connection.last_sync_status === 'error' && <span style={{ color: T.red, marginLeft: 6 }}>· error</span>}
              {connection.last_sync_status === 'ok' && <span style={{ color: T.green, marginLeft: 6 }}>✓</span>}
            </div>
          )}
          {connection.last_sync_status === 'error' && connection.last_sync_error && (
            <div style={{ fontFamily: mono, fontSize: 10, color: T.red, marginBottom: 8 }}>{connection.last_sync_error}</div>
          )}
          {lastSync && (
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginBottom: 8 }}>
              {lastSync.bookings} bookings checked · {lastSync.created} new · {lastSync.updated} updated · {lastSync.removed} cancelled
              {lastSync.skippedUnmapped ? ` · ${lastSync.skippedUnmapped} on unmapped listings` : ''}
            </div>
          )}
          <div style={{ display:'flex', gap: 8, flexWrap:'wrap', marginTop: 10 }}>
            <button onClick={syncNow} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy || mappings.length === 0}>
              {busy==='sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={lodgifyProps ? () => setLodgifyProps(null) : openMappingEditor} className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!!busy}>
              {busy==='props' ? 'Loading listings…' : (lodgifyProps ? 'Hide mappings' : 'Edit mappings')}
            </button>
            <button onClick={disconnect} className="btn btn-ghost" style={{ fontSize: 12, color: T.red, borderColor: T.red+'66' }} disabled={!!busy}>
              Disconnect
            </button>
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10 }}>
            Also syncs automatically three times a day (04:00, 12:00, 18:00 UTC).
          </div>

          {lodgifyProps && (
            <div style={{ marginTop: 16, padding: '16px 0 4px', borderTop: `1px dashed ${T.border}` }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom: 10 }}>
                Map Lodgify listings to properties
              </div>
              {lodgifyProps.length === 0 && (
                <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>No listings found in this Lodgify account.</div>
              )}
              <div style={{ display:'grid', gap: 8 }}>
                {sortedLodgifyProps.map(lp => {
                  const current = mappings.find(m => String(m.lodgify_property_id) === String(lp.id))
                  return (
                    <div key={lp.id} style={{ display:'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems:'center' }}>
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.text, overflow:'hidden', textOverflow:'ellipsis' }}>{lp.name}</div>
                      <select style={selectStyle}
                        value={current?.property_id || ''}
                        onChange={e => setMappingFor(lp, e.target.value || null)}>
                        <option value="">(don't sync)</option>
                        {sortedProperties.map(p => (
                          <option key={p.id} value={p.id}>{propLabel(p)}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 12, display:'flex', justifyContent:'flex-end' }}>
                <button onClick={saveMappings} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
                  {busy==='save' ? 'Saving…' : 'Save mappings'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── PER-COMPANY XERO CARD ──────────────────────────────────────────────
function CompanyXeroCard({ T, mono, company, connection, properties, onChanged }) {
  const confirmDialog = useConfirm()
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(null)

  async function connect() {
    setBusy('connect')
    try { await api.startXeroOAuth(company.id) /* redirects */ }
    catch (e) { showAppToast(e.message, 'error'); setBusy(null) }
  }
  async function disconnect() {
    if (!await confirmDialog({
      title: `Disconnect ${company.name} from Xero?`,
      body: 'Future syncs stop. Already-synced records stay in Xero.',
      confirmLabel: 'Disconnect', destructive: true,
    })) return
    setBusy('disconnect')
    try {
      await api.disconnectXero(company.id)
      showAppToast(`Xero disconnected for ${company.name}`)
      onChanged?.()
    } catch (e) { showAppToast(e.message, 'error') }
    setBusy(null)
  }
  async function syncNow() {
    setBusy('sync')
    try {
      const r = await api.runXeroSync(company.id, 'both')
      const parts = [
        r.created ? `${r.created} new` : null,
        r.updated ? `${r.updated} reconciliation updates` : null,
        r.failed ? `${r.failed} failed` : null,
      ].filter(Boolean).join(', ') || 'nothing to sync'
      showAppToast(`${company.abbr}: ${parts}`)
      onChanged?.()
    } catch (e) { showAppToast(`Sync failed: ${e.message}`, 'error') }
    setBusy(null)
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 26px', marginBottom: 16 }
  const isConnected = !!connection

  return (
    <div style={card}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 14, flexWrap:'wrap', gap: 10 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: (company.color || '#C8A84B') + '22', color: company.color || '#C8A84B', display:'flex', alignItems:'center', justifyContent:'center', fontFamily: mono, fontSize: 11, fontWeight: 700 }}>
            {company.abbr}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{company.name}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
              {properties.length} {properties.length === 1 ? 'property' : 'properties'}
            </div>
          </div>
        </div>
        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding:'4px 11px', borderRadius: 20, background: isConnected ? T.green+'22' : T.border, color: isConnected ? T.green : T.muted }}>
          {isConnected ? 'Xero connected' : 'Not connected'}
        </span>
      </div>

      {isConnected ? (
        <>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.text, marginBottom: 6 }}>
            <span style={{ color: T.muted }}>Xero organisation:</span> {connection.tenant_name || connection.tenant_id}
          </div>
          {connection.last_sync_at && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 14 }}>
              Last sync: {new Date(connection.last_sync_at).toLocaleString('en-GB')}
              {connection.last_sync_status === 'error' && <span style={{ color: T.red, marginLeft: 6 }}>· error</span>}
              {connection.last_sync_status === 'partial' && <span style={{ color: T.amber, marginLeft: 6 }}>· partial</span>}
              {connection.last_sync_status === 'ok' && <span style={{ color: T.green, marginLeft: 6 }}>✓</span>}
            </div>
          )}
          <div style={{ display:'flex', gap: 8, flexWrap:'wrap' }}>
            <button onClick={syncNow} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
              {busy==='sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={() => setShowSettings(s => !s)} className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!!busy}>
              {showSettings ? 'Hide settings' : 'Settings'}
            </button>
            <button onClick={disconnect} className="btn btn-ghost" style={{ fontSize: 12, color: T.red, borderColor: T.red+'66' }} disabled={!!busy}>
              Disconnect
            </button>
          </div>
          {showSettings && (
            <XeroSettingsPanel
              T={T} mono={mono}
              company={company} properties={properties}
              onSaved={onChanged}
            />
          )}
        </>
      ) : (
        <>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Push rent payments and expenses from {company.name} into a Xero organisation as bank transactions. Use Xero tracking categories to run P&L per property.
          </div>
          <button onClick={connect} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
            {busy==='connect' ? 'Redirecting…' : `🔌 Connect ${company.name} to Xero`}
          </button>
        </>
      )}
    </div>
  )
}

// ── PER-CONNECTION SETTINGS PANEL ──────────────────────────────────────
function XeroSettingsPanel({ T, mono, company, properties, onSaved }) {
  const confirmDialog = useConfirm()
  const [settings, setSettings] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() /* eslint-disable-next-line */ }, [company.id])

  async function load() {
    setLoading(true)
    try {
      const [s, accts] = await Promise.all([
        api.fetchXeroSyncSettings(company.id),
        api.fetchXeroAccounts(company.id).catch(() => []),
      ])
      setSettings(s || {
        sync_rent: true, sync_expenses: true, sync_mortgage_interest: false,
        sync_tracking_categories: true, sync_real_tenant_contacts: false,
        pull_reconciliation: true,
        per_property_bank_accounts: {},
      })
      setAccounts(accts || [])
    } catch (e) { showAppToast(e.message, 'error') }
    setLoading(false)
  }

  function patch(key, value) { setSettings(s => ({ ...s, [key]: value })) }
  function patchPropBank(propId, bankAccountId) {
    setSettings(s => ({
      ...s,
      per_property_bank_accounts: {
        ...(s?.per_property_bank_accounts || {}),
        ...(bankAccountId ? { [propId]: bankAccountId } : (() => {
          const next = { ...(s?.per_property_bank_accounts || {}) }
          delete next[propId]
          return next
        })()),
      },
    }))
  }

  async function save() {
    setSaving(true)
    try {
      await api.saveXeroSyncSettings(company.id, settings)
      showAppToast('Sync settings saved')
      onSaved?.()
    } catch (e) { showAppToast(e.message, 'error') }
    setSaving(false)
  }

  if (loading) return <div style={{ marginTop: 18, fontFamily: mono, fontSize: 12, color: T.muted }}>Loading settings…</div>

  const bankAccounts = accounts.filter(a => a.Type === 'BANK')
  const incomeAccounts = accounts.filter(a => ['REVENUE','SALES','OTHERINCOME'].includes(a.Type))
  const expenseAccounts = accounts.filter(a => ['EXPENSE','OVERHEADS','DIRECTCOSTS'].includes(a.Type))

  const Toggle = ({ keyName, label, desc }) => (
    <div style={{ display:'flex', alignItems:'flex-start', gap: 12, padding: '10px 0', borderBottom: `1px dashed ${T.border}` }}>
      <input type="checkbox" checked={!!settings?.[keyName]}
        onChange={e => patch(keyName, e.target.checked)}
        style={{ marginTop: 3, width: 18, height: 18, cursor: 'pointer', accentColor: T.gold }}/>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </div>
  )

  const Section = ({ title, children }) => (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )

  const selectStyle = { fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, width: '100%', maxWidth: 340 }

  return (
    <div style={{ marginTop: 18, padding: '18px 0 4px', borderTop: `1px dashed ${T.border}` }}>

      <Section title="What to sync (push: OwnProperly → Xero)">
        <Toggle keyName="sync_rent"                 label="Rent payments → Xero (RECEIVE)" desc="Pushes every paid rent_payments row as a bank transaction (income)." />
        <Toggle keyName="sync_expenses"             label="Property expenses → Xero (SPEND)" desc="Pushes every property_expenses row as a bank transaction (expense)." />
        <Toggle keyName="sync_mortgage_interest"    label="Mortgage interest accruals → Xero (SPEND)" desc="Monthly: mortgage_amount × rate ÷ 12, posted as a SPEND. Useful for Section 24 prep." />
        <Toggle keyName="sync_deposits_separate"    label="Tenancy deposits → separate Xero account" desc="Posts deposit_amount from tenancy_details as a RECEIVE against a liability account (or whatever you pick below). Otherwise deposits don't sync at all." />
        <Toggle keyName="sync_refurb_separate"      label="Refurb costs → separate Xero account" desc="Posts every paid refurb_costs row as a SPEND against a capex/refurb account. Off by default — many landlords prefer to lump refurbs into general expenses." />
        <Toggle keyName="sync_tracking_categories"  label="Use Xero Tracking Categories per property" desc='Creates (or reuses) a "Property" tracking category in Xero and tags every transaction with it. Lets you run P&L by property in Xero.' />
        <Toggle keyName="sync_real_tenant_contacts" label="Use real tenant/supplier names" desc="Off: contacts appear as 'Property X — Tenant' / '— Supplier' (privacy-safe). On: uses tenant_names from tenancy_details. Update your tenant privacy notice if enabling." />
        <Toggle keyName="sync_real_tenant_emails"   label="Also push tenant email + phone to Xero contact" desc="Only meaningful if 'real names' is on. Adds email + mobile to each Xero contact. Carries higher GDPR risk — get tenant consent first." />
      </Section>

      <Section title="What to pull back (Xero → OwnProperly)">
        <Toggle keyName="pull_reconciliation"  label="Pull reconciliation status back" desc="When your accountant marks a transaction reconciled in Xero, we mirror the flag onto rent_payments / property_expenses so the UI shows it." />
        <Toggle keyName="sync_reverse_changes" label="↔ Pull amount/date edits from Xero" desc="If your accountant edits a synced transaction's amount or date in Xero, mirror the change back to OwnProperly. Off by default — leave off if you treat OwnProperly as the source of truth." />
      </Section>

      <Section title="Automation">
        <Toggle keyName="enable_daily_cron" label="Daily reconciliation cron (6am UTC)" desc="Server-side daily pull of reconciliation status — no need to click Sync now. Off by default; safe to enable any time." />
        <Toggle keyName="enable_webhook"    label="Xero webhook (push notifications)" desc="Xero pings us instantly when something changes. Requires you to also enable it in Xero's developer portal + paste the signing key below." />
        {settings?.enable_webhook && (
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '12px 14px', marginTop: 10, fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.55 }}>
            <div style={{ color: T.text, fontWeight: 600, marginBottom: 6 }}>Setup in Xero:</div>
            <div>1. Xero dev portal → your app → <strong style={{ color: T.text }}>Webhooks</strong> tab</div>
            <div>2. Delivery URL: <code style={{ background: T.card, padding: '2px 5px', borderRadius: 3 }}>https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/xero-webhook</code></div>
            <div>3. Copy Xero's signing key into the field below and Save here:</div>
            <input type="text" value={settings?.webhook_signing_key || ''}
              onChange={e => patch('webhook_signing_key', e.target.value || null)}
              placeholder="paste signing key from Xero"
              style={{ ...selectStyle, maxWidth: 'none', marginTop: 8, fontFamily: 'inherit', fontSize: 12 }}/>
            <div style={{ marginTop: 6 }}>4. Subscribe to the events you want (Invoices, Contacts, etc).</div>
          </div>
        )}
      </Section>

      <Section title="Account code mapping (Chart of Accounts)">
        <div style={{ display:'grid', gap: 10 }}>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Rent income account</label>
            <select style={selectStyle}
              value={settings?.income_account_code || ''}
              onChange={e => patch('income_account_code', e.target.value || null)}>
              <option value="">(auto — first REVENUE account)</option>
              {incomeAccounts.map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Expense account</label>
            <select style={selectStyle}
              value={settings?.expense_account_code || ''}
              onChange={e => patch('expense_account_code', e.target.value || null)}>
              <option value="">(auto — first EXPENSE account)</option>
              {expenseAccounts.map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Mortgage interest account (optional)</label>
            <select style={selectStyle}
              value={settings?.mortgage_interest_account_code || ''}
              onChange={e => patch('mortgage_interest_account_code', e.target.value || null)}>
              <option value="">(use expense account)</option>
              {expenseAccounts.map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Tenancy deposits account (only if "Deposits separate" is on)</label>
            <select style={selectStyle}
              value={settings?.deposits_account_code || ''}
              onChange={e => patch('deposits_account_code', e.target.value || null)}>
              <option value="">(auto — first CURRLIAB account, else fall back to revenue)</option>
              {accounts.filter(a => a.Type === 'CURRLIAB').map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
              {accounts.filter(a => a.Type !== 'CURRLIAB' && a.Type !== 'BANK').map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Refurb costs account (only if "Refurb separate" is on)</label>
            <select style={selectStyle}
              value={settings?.refurb_account_code || ''}
              onChange={e => patch('refurb_account_code', e.target.value || null)}>
              <option value="">(auto — first FIXED account, else fall back to expense)</option>
              {accounts.filter(a => a.Type === 'FIXED').map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
              {expenseAccounts.map(a => <option key={a.AccountID} value={a.Code}>{a.Code} — {a.Name} ({a.Type})</option>)}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Bank account">
        <div style={{ display:'grid', gap: 10 }}>
          <div>
            <label style={{ fontFamily: mono, fontSize: 11, color: T.muted, display:'block', marginBottom: 5 }}>Default bank account (used unless overridden per property)</label>
            <select style={selectStyle}
              value={settings?.default_bank_account_id || ''}
              onChange={e => patch('default_bank_account_id', e.target.value || null)}>
              <option value="">(auto — first BANK account)</option>
              {bankAccounts.map(a => <option key={a.AccountID} value={a.AccountID}>{a.Name}{a.BankAccountNumber ? ` (${a.BankAccountNumber})` : ''}</option>)}
            </select>
          </div>
          {properties.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontFamily: mono, fontSize: 11, color: T.gold, cursor: 'pointer', userSelect: 'none' }}>
                Per-property overrides ({properties.length} properties)
              </summary>
              <div style={{ display:'grid', gap: 6, marginTop: 10, paddingLeft: 8, borderLeft: `2px solid ${T.border}` }}>
                {properties.map(p => (
                  <div key={p.id} style={{ display:'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems:'center' }}>
                    <div style={{ fontFamily: mono, fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.address}</div>
                    <select style={{ ...selectStyle, maxWidth: 'none' }}
                      value={settings?.per_property_bank_accounts?.[p.id] || ''}
                      onChange={e => patchPropBank(p.id, e.target.value || null)}>
                      <option value="">(use default)</option>
                      {bankAccounts.map(a => <option key={a.AccountID} value={a.AccountID}>{a.Name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Section>

      <Section title="Per-property sync (override the whole-portfolio button)">
        {properties.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>No properties in this company yet.</div>}
        <div style={{ display:'grid', gap: 6 }}>
          {properties.map(p => (
            <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background: T.bg, borderRadius: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.text }}>{p.name || p.address}</span>
              <button onClick={async () => {
                try {
                  const r = await api.runXeroSyncForProperties(company.id, [p.id])
                  showAppToast(`Synced ${p.name || 'property'}: ${r.created || 0} new, ${r.failed || 0} failed`)
                  onSaved?.()
                } catch (e) { showAppToast(e.message, 'error') }
              }} className="btn btn-ghost" style={{ fontSize: 10, padding: '4px 10px' }}>
                Sync this one
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Danger zone">
        <div style={{ background: T.red+'11', border: `1px solid ${T.red}44`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.text, marginBottom: 8, lineHeight: 1.5 }}>
            <strong>Re-sync everything</strong> wipes the sync map so the next sync re-pushes every record. Use this if you've manually deleted transactions from Xero and want to re-create them. Doesn't touch the Xero side directly.
          </div>
          <button onClick={async () => {
            if (!await confirmDialog({
              title: `Wipe the sync map for ${company.name}?`,
              body: "Next sync will re-push every record. Make sure you've cleared the corresponding records in Xero first or you'll get duplicates.",
              confirmLabel: 'Wipe sync map', destructive: true,
            })) return
            try {
              const n = await api.resyncAllXero(company.id)
              showAppToast(`Cleared ${n} sync map entries. Click Sync now to re-push.`)
              onSaved?.()
            } catch (e) { showAppToast(e.message, 'error') }
          }} className="btn btn-ghost" style={{ fontSize: 11, color: T.red, borderColor: T.red+'66' }}>
            Wipe sync map for {company.name}
          </button>
        </div>
      </Section>

      <div style={{ marginTop: 18, display:'flex', justifyContent:'flex-end' }}>
        <button onClick={save} className="btn btn-gold" style={{ fontSize: 12 }} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
