import { useEffect, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { showAppToast } from '../lib/toast'
import { useConfirm } from '../lib/ConfirmContext'
import { fmt } from '../lib/format'
import {
  fetchMandate,
  createMandate,
  cancelMandate,
  fetchTenantMandate,
} from '../lib/api/rentCollection'

const COMING_SOON =
  'Coming soon — pending provider setup. Rent collection is inert: no payments are taken until FCA authorisation and a TrueLayer VRP agreement are in place.'

function Banner({ T }) {
  return (
    <div
      className="card"
      style={{
        borderColor: T.gold,
        background: 'transparent',
        padding: '12px 14px',
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: T.gold }}>Rent collection (preview)</strong>
      <div style={{ marginTop: 4, opacity: 0.85 }}>{COMING_SOON}</div>
    </div>
  )
}

// Landlord-side: set up / view / cancel a rent-collection mandate RECORD for a
// single property+tenancy. No money is ever moved — this only records intent.
export function RentCollectionPanel({ property, companyId, tenantUserId }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [mandate, setMandate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState(property?.rent_pcm ?? '')
  const [day, setDay] = useState(1)

  const propertyId = property?.id

  useEffect(() => {
    let live = true
    if (!propertyId) return
    setLoading(true)
    fetchMandate(propertyId)
      .then((m) => {
        if (!live) return
        setMandate(m)
        if (m) {
          if (m.amount_pcm != null) setAmount(m.amount_pcm)
          if (m.day_of_month != null) setDay(m.day_of_month)
        }
      })
      .catch((e) => showAppToast(e.message || 'Could not load mandate', 'error'))
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  async function handleCreate() {
    if (!propertyId || !companyId) {
      showAppToast('Missing property or company context', 'error')
      return
    }
    setSaving(true)
    try {
      const m = await createMandate({
        propertyId,
        companyId,
        tenantUserId,
        amountPcm: amount === '' ? null : Number(amount),
        dayOfMonth: Number(day),
      })
      setMandate(m)
      showAppToast('Mandate recorded as draft. Collection stays off until the provider is live.')
    } catch (e) {
      showAppToast(e.message || 'Could not save mandate', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel() {
    if (!mandate) return
    const ok = await confirmDialog({
      title: 'Cancel mandate?',
      body: 'This marks the rent-collection mandate as cancelled. No payments were ever scheduled.',
      confirmLabel: 'Cancel mandate',
      destructive: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      const m = await cancelMandate(mandate.id)
      setMandate(m)
      showAppToast('Mandate cancelled')
    } catch (e) {
      showAppToast(e.message || 'Could not cancel', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ opacity: 0.6, fontSize: 13 }}>Loading…</div>

  const isCancelled = mandate?.status === 'cancelled'
  const hasActiveDraft = mandate && !isCancelled

  return (
    <div>
      <Banner T={T} />

      {hasActiveDraft ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>Status:</strong> {mandate.status}
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>Amount:</strong>{' '}
            {mandate.amount_pcm != null ? fmt(mandate.amount_pcm) : '—'} / month
          </div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <strong>Collection day:</strong>{' '}
            {mandate.day_of_month != null ? `${mandate.day_of_month} of each month` : '—'}
          </div>
          <button className="btn btn-ghost" disabled={saving} onClick={handleCancel}>
            Cancel mandate
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 14 }}>
          {isCancelled && (
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
              Previous mandate was cancelled. You can record a new draft below.
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 4, opacity: 0.8 }}>Monthly amount (£)</div>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 4, opacity: 0.8 }}>Collection day (1–28)</div>
              <input
                className="input"
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
          </div>
          <button className="btn btn-gold" disabled={saving} onClick={handleCreate}>
            {saving ? 'Saving…' : 'Record draft mandate'}
          </button>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
            Recording a draft does not authorise any payment. The tenant must consent and the
            provider must be live before any collection could ever run.
          </div>
        </div>
      )}
    </div>
  )
}

// Tenant-side: consent view stub. Shows the proposed terms; the consent button
// is disabled while the feature is inert.
export function TenantRentCollectionConsent({ propertyId }) {
  const { T } = useTheme()
  const [mandate, setMandate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    if (!propertyId) return
    fetchTenantMandate(propertyId)
      .then((m) => { if (live) setMandate(m) })
      .catch(() => { /* tenant may have no mandate yet */ })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  if (loading) return null
  if (!mandate || mandate.status === 'cancelled') return null

  return (
    <div className="card" style={{ padding: 14, marginTop: 16 }}>
      <strong style={{ color: T.gold }}>Rent collection by Direct Payment</strong>
      <div style={{ fontSize: 13, marginTop: 6, marginBottom: 6 }}>
        Your landlord has proposed collecting{' '}
        {mandate.amount_pcm != null ? fmt(mandate.amount_pcm) : 'your rent'} on day{' '}
        {mandate.day_of_month ?? '—'} each month via open banking.
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>{COMING_SOON}</div>
      <button className="btn btn-gold" disabled title="Not yet available">
        Consent (coming soon)
      </button>
    </div>
  )
}

export default RentCollectionPanel
