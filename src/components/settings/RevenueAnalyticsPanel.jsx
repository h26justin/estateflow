import { useState, useEffect } from 'react'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { plural } from '../../lib/format'
import { SkeletonRows } from '../../lib/Skeleton'

// ── REVENUE ANALYTICS PANEL (Developer only) ────────────────────────────────
export function RevenueAnalyticsPanel({ companies, T, showToast }) {
  const mono = MONO
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, totalCompanies: 0, totalProperties: 0, mrr: 0, signupsLast30: 0, signupsLast7: 0, cohorts: [] })

  useEffect(()=>{ load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [users, properties] = await Promise.all([
        api.fetchAllUsers().catch(()=>[]),
        supabase.from('properties').select('id, user_id, company_id, created_at').then(r=>r.data||[]),
      ])
      const totalUsers = users.length
      const totalCompanies = companies.length
      const totalProperties = properties.length
      const mrr = totalProperties * 2  // £2/property/month

      const now = Date.now()
      const signupsLast30 = users.filter(u => new Date(u.created_at).getTime() > now - 30*24*60*60*1000).length
      const signupsLast7 = users.filter(u => new Date(u.created_at).getTime() > now - 7*24*60*60*1000).length
      const propertyOwnerIds = new Set(properties.map(p=>p.user_id))
      const activeUsers = propertyOwnerIds.size

      // Build monthly signup cohorts (last 6 months)
      const cohorts = []
      const today = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const nextD = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
        const monthUsers = users.filter(u => {
          const t = new Date(u.created_at).getTime()
          return t >= d.getTime() && t < nextD.getTime()
        })
        const monthActive = monthUsers.filter(u => propertyOwnerIds.has(u.id)).length
        cohorts.push({
          month: d.toLocaleDateString('en-GB', { month:'short', year:'2-digit' }),
          signups: monthUsers.length,
          active: monthActive,
          retention: monthUsers.length > 0 ? (monthActive/monthUsers.length*100) : 0,
        })
      }

      setStats({ totalUsers, activeUsers, totalCompanies, totalProperties, mrr, signupsLast30, signupsLast7, cohorts })
    } catch(e) { showToast('Failed to load revenue data','error') }
    setLoading(false)
  }

  if (loading) return <SkeletonRows rows={5} height={44}/>

  const arpu = stats.activeUsers > 0 ? stats.mrr / stats.activeUsers : 0
  const conversionRate = stats.totalUsers > 0 ? (stats.activeUsers / stats.totalUsers) * 100 : 0
  const fmt = n => '£'+(n||0).toLocaleString('en-GB',{maximumFractionDigits:0})

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Revenue Analytics</div>
        <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>Key metrics updated in real-time. MRR assumes £2/property/month.</div>
      </div>

      {/* KPI cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:12,marginBottom:24}}>
        {[
          { label:'MRR', value: fmt(stats.mrr), color:T.goldText, sub:`${fmt(stats.mrr*12)} ARR projected`},
          { label:'Total users', value: stats.totalUsers, color:T.text, sub:`${stats.activeUsers} with properties (${conversionRate.toFixed(1)}% activation)`},
          { label:'ARPU', value: fmt(arpu), color:T.green, sub:'per active user per month'},
          { label:'Total properties', value: stats.totalProperties, color:T.blue, sub:`across ${plural(stats.totalCompanies,'company','companies')}`},
          { label:'Signups (30d)', value: stats.signupsLast30, color:T.goldText, sub:`${stats.signupsLast7} last 7 days`},
        ].map((k,i) => (
          <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{k.label}</div>
            <div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:k.color,marginBottom:4}}>{k.value}</div>
            <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Monthly signup cohorts */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:16,marginBottom:20}}>
        <div style={{fontFamily:mono,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Monthly cohort performance</div>
        <div style={{overflowX:'auto'}}>
          <table className="table-stack" style={{width:'100%',borderCollapse:'collapse',fontFamily:mono,fontSize:11}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${T.border}`}}>
                <th style={{textAlign:'left',padding:'6px 8px',color:T.muted,fontWeight:700}}>Cohort</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Signups</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Activated</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Retention %</th>
              </tr>
            </thead>
            <tbody>
              {stats.cohorts.map((c,i) => (
                <tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                  <td data-label="Cohort" style={{padding:'8px',color:T.text}}>{c.month}</td>
                  <td data-label="Signups" style={{padding:'8px',textAlign:'right',color:T.text}}>{c.signups}</td>
                  <td data-label="Activated" style={{padding:'8px',textAlign:'right',color:T.green}}>{c.active}</td>
                  <td data-label="Retention %" style={{padding:'8px',textAlign:'right',fontWeight:700,color:c.retention>=50?T.green:c.retention>=25?T.amber:T.red}}>
                    {c.signups === 0 ? '—' : c.retention.toFixed(0)+'%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{fontFamily:mono,fontSize:FS.xs,color:T.muted,marginTop:10,lineHeight:1.6}}>
          "Activated" = user has created at least one property. Retention = % of signups who activated.
        </div>
      </div>
    </div>
  )
}
