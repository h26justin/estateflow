import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// Bank Inbox — review and match incoming transactions to rent payments.
//
// Shows recent bank_transactions (defaults to unmatched first). Each card:
//   - amount, date, counterparty, description
//   - if auto-matched: shows the link to property + month + an "unmatch" button
//   - if unmatched: a property picker → month picker → confirm
//
// We deliberately keep the picker tight (only unpaid months for active
// properties) so the list of options is small and obvious.

function fmtAmount(n, c = 'GBP') {
  const sign = n < 0 ? '-' : ''
  return sign + new Intl.NumberFormat('en-GB', { style: 'currency', currency: c }).format(Math.abs(n))
}
function fmtDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function BankInboxModal({ onClose, properties = [], onMatched }) {
  const { T } = useTheme()
  const mono = MONO

  const [txs, setTxs]               = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('unmatched') // unmatched | all
  const [matchingId, setMatchingId] = useState(null)
  const [selPropId, setSelPropId]   = useState('')
  const [selRpId, setSelRpId]       = useState('')

  async function reload() {
    setLoading(true)
    try {
      const list = await api.fetchBankTransactions({
        limit: 200,
        unmatchedOnly: filter === 'unmatched',
      })
      setTxs(list)
    } catch (e) {
      showAppToast(e.message || 'Failed to load transactions', 'error')
    }
    setLoading(false)
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [filter])

  // Unpaid rent_payments grouped by property — fed to the match picker.
  const unpaidByProperty = useMemo(() => {
    const map = {}
    for (const p of properties) {
      const unpaid = (p.rent_payments || []).filter(
        rp => rp.status === 'void' || rp.status === 'late' || rp.status === 'partial'
      )
      if (unpaid.length > 0) map[p.id] = { property: p, unpaid: unpaid.sort((a, b) => (b.year - a.year) || (b.month - a.month)) }
    }
    return map
  }, [properties])

  function openMatcher(txId) {
    setMatchingId(txId)
    setSelPropId('')
    setSelRpId('')
  }

  async function confirmMatch() {
    if (!matchingId || !selRpId) return
    try {
      await api.matchTransactionToRentPayment(matchingId, selRpId)
      showAppToast('Matched.')
      setMatchingId(null)
      reload()
      onMatched?.()
    } catch (e) {
      showAppToast(e.message || 'Match failed', 'error')
    }
  }

  async function unmatch(txId) {
    try {
      await api.unmatchTransaction(txId)
      showAppToast('Unmatched.')
      reload()
      onMatched?.()
    } catch (e) {
      showAppToast(e.message || 'Unmatch failed', 'error')
    }
  }

  async function syncNow() {
    try {
      const r = await api.syncBankTransactions()
      showAppToast(`Synced ${r?.inserted || 0} transactions (${r?.matched || 0} auto-matched)`)
      reload()
      onMatched?.()
    } catch (e) {
      showAppToast(e.message || 'Sync failed', 'error')
    }
  }

  const propertyForId = id => properties.find(p => p.id === id)

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 760 }}>
        <div style={{ padding: '22px 26px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
              Bank Inbox
            </h2>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
              Review and match incoming transactions to rent.
            </p>
          </div>
          <button onClick={syncNow} className="btn btn-ghost" style={{ fontSize: 11 }}>↻ Sync</button>
        </div>

        <div style={{ padding: '14px 26px 22px' }}>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {['unmatched', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  fontFamily: mono, fontSize: 11, fontWeight: 600,
                  padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${filter === f ? T.gold : T.border}`,
                  background: filter === f ? T.gold + '22' : 'transparent',
                  color: filter === f ? T.gold : T.muted,
                  textTransform: 'capitalize',
                }}>
                {f}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
          ) : txs.length === 0 ? (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '24px 16px', textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>
              {filter === 'unmatched'
                ? 'No unmatched transactions — everything is accounted for.'
                : 'No transactions yet. Sync a connection to pull them in.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
              {txs.map(t => {
                const isCredit = t.amount > 0
                const matched = !!t.matched_rent_payment_id
                const matchProp = matched && t.rent_payment?.property?.address
                return (
                  <div key={t.id} style={{
                    background: T.card, border: `1px solid ${matched ? T.green + '66' : T.border}`,
                    borderRadius: 10, padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: isCredit ? T.green : T.text }}>
                            {fmtAmount(t.amount, t.currency)}
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                            {fmtDate(t.posted_at)}
                          </span>
                          {matched && (
                            <span style={{
                              fontFamily: mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                              padding: '2px 7px', borderRadius: 10,
                              background: T.green + '22', color: T.green,
                            }}>
                              MATCHED {t.match_confidence < 1 ? `· ${Math.round(t.match_confidence * 100)}%` : ''}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: T.text, marginBottom: 2 }}>
                          {t.counterparty || t.description || '—'}
                        </div>
                        {t.description && t.counterparty && (
                          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{t.description}</div>
                        )}
                        {matched && (
                          <div style={{ fontFamily: mono, fontSize: 10, color: T.green, marginTop: 4 }}>
                            → {matchProp || 'property'} · {t.rent_payment?.month_label || `${t.rent_payment?.month}/${t.rent_payment?.year}`}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {matched ? (
                          <button onClick={() => unmatch(t.id)} className="btn btn-ghost" style={{ fontSize: 10 }}>
                            Unmatch
                          </button>
                        ) : isCredit ? (
                          <button onClick={() => openMatcher(t.id)}
                            style={{
                              fontFamily: mono, fontSize: 11, fontWeight: 700,
                              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${T.gold}`, background: T.gold + '22', color: T.gold,
                            }}>
                            Match →
                          </button>
                        ) : (
                          <span style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>OUTGOING</span>
                        )}
                      </div>
                    </div>

                    {matchingId === t.id && !matched && (
                      <div style={{ marginTop: 10, padding: 12, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                          Match this {fmtAmount(t.amount)} payment to…
                        </div>
                        <select value={selPropId} onChange={e => { setSelPropId(e.target.value); setSelRpId('') }}
                          style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '8px 10px', background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, marginBottom: 8 }}>
                          <option value="">— Choose a property —</option>
                          {Object.values(unpaidByProperty).map(({ property }) => (
                            <option key={property.id} value={property.id}>{property.address}</option>
                          ))}
                        </select>
                        {selPropId && (
                          <select value={selRpId} onChange={e => setSelRpId(e.target.value)}
                            style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '8px 10px', background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, marginBottom: 8 }}>
                            <option value="">— Choose a month —</option>
                            {unpaidByProperty[selPropId]?.unpaid.map(rp => (
                              <option key={rp.id} value={rp.id}>
                                {rp.month_label || `${rp.month}/${rp.year}`} · expected £{rp.amount || propertyForId(selPropId)?.rent_pcm || '?'} · {rp.status}
                              </option>
                            ))}
                          </select>
                        )}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => setMatchingId(null)} className="btn btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
                          <button onClick={confirmMatch} disabled={!selRpId} className="btn btn-gold" style={{ fontSize: 11 }}>Confirm match</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 18px' }}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
