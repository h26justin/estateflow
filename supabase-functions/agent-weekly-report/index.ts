// Agent weekly report: emails each letting agent a PDF of the Rent Tracker
// for every property they look after. First user:
// Gareth at Propertunity, Mondays 07:00 UK.
//
// Schedules live in public.agent_report_schedules (one row per owner + agent).
// pg_cron calls this hourly; a schedule sends only when it is its weekday and
// send hour in Europe/London and it has not already gone out that day, so the
// UTC cron covers GMT and BST without editing.
//
// The report itself is src/lib/agentReport.js + agentReportPdf.js, bundled
// into ./report.bundle.js by scripts/build-agent-report.mjs, so the email is
// the same document as the Reports page download.
//
// Auth: x-cron-secret only (fails closed). Body options, all optional:
//   { "schedule_id": "<uuid>" }  only this schedule
//   { "preview": true }          send now to the schedule's cc list only (the
//                                owner), subject marked Preview, ignores
//                                enabled / day / hour, does not mark it sent
//   { "dry_run": true }          send nothing, return the headline figures
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, and an email
// provider: GOOGLE_SA_KEY + GMAIL_SENDER (Gmail) or RESEND_API_KEY (Resend,
// what production uses today). Replies go to the schedule owner (first cc).

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { encode as b64encode } from 'https://deno.land/std@0.190.0/encoding/base64.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1'
import { sendGmail } from './gmail.ts'
import { buildAgentReport, drawAgentReportPdf, agentReportFilename, dateLong } from './report.bundle.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const GMAIL_SENDER = Deno.env.get('GMAIL_SENDER') || 'noreply@ownproperly.com'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const LOGO_URL = 'https://www.ownproperly.com/icon-512.png'

// Same joins the rent engine needs as fetchProperties (src/lib/api/_monolith.js).
const PROPERTY_SELECT = 'id,user_id,company_id,name,address,status,rent_pcm,rent_due_day,tenancy_end,tenant_since,tenant_name,stl_manager_id,vacant_since,managed_by,managed_by_agent_id,deleted_at,archived_at,' +
  'company:companies(id,name,color),' +
  'rent_payments(id,property_id,year,month,month_label,status,amount,period_start,period_end),' +
  'stl_bookings(id,rent_payment_id),' +
  'rent_receipts(id,received_date,amount,kind,payer,source,review_status,reverses_receipt_id,rent_allocations(id,rent_payment_id,target,amount,payment_plan_id)),' +
  'non_chargeable_periods(id,start_date,end_date,reason),' +
  'rent_overrides(id,rent_payment_id,state,reason,expected_amount,created_at),' +
  'tenancies(id,tenant_name,tenancy_start,tenancy_end,notice_received_date,expected_move_out,rent_amount,rent_frequency,rent_due_day,payment_window_days,status,payment_source,benefit_type,benefit_contribution,tenant_contribution,benefit_frequency,benefit_next_payment_date,benefit_paid_to,opening_arrears,opening_arrears_date)'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const money0 = (n: number) => '\u00A3' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const validEmail = (e: string) => /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(e)

// Weekday (0 = Sunday), hour and ISO date in Europe/London.
function londonNow(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { weekday, hour: Number(p.hour), iso: `${p.year}-${p.month}-${p.day}` }
}

// A PNG as { data, w, h } for jsPDF (width and height from the IHDR chunk).
// Anything that is not a PNG is skipped; the header then shows the name only.
async function loadPng(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null
    const b = new Uint8Array(await r.arrayBuffer())
    if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47) return null
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { data: 'data:image/png;base64,' + b64encode(b), w: dv.getUint32(16), h: dv.getUint32(20) }
  } catch (_) { return null }
}

// Every row of a query, past PostgREST's 1,000-row page.
async function allRows(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

// Short-term-let bookings, adjustments, managers and listing mappings for the
// owner's short-let properties: what stlIncome.js needs for the STL section.
async function loadStl(admin: any, props: any[]) {
  const stl = props.filter(p => p.status === 'short_term_let')
  if (!stl.length) return null
  const ids = stl.map(p => p.id)
  const coIds = [...new Set(stl.map(p => p.company_id).filter(Boolean))]
  const [bookings, adjustments, managers, mappings] = await Promise.all([
    allRows((a, b) => admin.from('stl_bookings')
      .select('id,property_id,source,status,arrival,departure,total_amount,channel_commission,hostaway_commission,hostaway_listing_id,lodgify_property_id')
      .in('property_id', ids).order('id').range(a, b)),
    allRows((a, b) => admin.from('stl_adjustments').select('id,property_id,adjustment_date,amount,kind')
      .in('property_id', ids).order('id').range(a, b)),
    admin.from('stl_managers').select('id,company_id,name,percentage,basis,active').in('company_id', coIds).then((r: any) => r.data || []),
    admin.from('hostaway_property_mappings').select('id,property_id,hostaway_listing_id').in('property_id', ids).then((r: any) => r.data || []),
  ])
  return { bookings, adjustments, managers, mappings }
}

// Company logos live in this project's public-assets bucket; nothing else is
// fetched. Uploads can be thousands of pixels square, too big to decode inside
// the edge CPU budget, so ask Storage for a 400px copy first.
const LOGO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public-assets/`
async function loadLogo(url: string) {
  if (!url.startsWith(LOGO_PREFIX)) return null
  const path = url.slice(LOGO_PREFIX.length).split('?')[0]
  const small = `${SUPABASE_URL}/storage/v1/render/image/public/public-assets/${path}?width=400&height=400&resize=contain&format=origin`
  return (await loadPng(small)) || (await loadPng(url))
}

function emailHtml(model: any) {
  const s = model.summary
  const list = (rows: string[]) => rows.length ? `<ul style="margin:6px 0 0;padding-left:18px;color:#1A2530;font-size:13px;line-height:1.7">${rows.join('')}</ul>` : ''
  const owing = model.owing.slice(0, 8).map((l: any) => `<li>${esc(l.name)}${l.tenant ? ` <span style="color:#5A6A7A">(${esc(l.tenant)})</span>` : ''} <span style="color:#B8392D;font-weight:700">${money0(l.shortfallYear + l.arrears)}</span></li>`)
  if (model.owing.length > 8) owing.push(`<li style="color:#5A6A7A">and ${model.owing.length - 8} more in the report</li>`)
  const notLet = model.notLet.slice(0, 8).map((l: any) => `<li>${esc(l.name)} <span style="color:#5A6A7A">${esc(l.letLabel)}</span></li>`)
  if (model.notLet.length > 8) notLet.push(`<li style="color:#5A6A7A">and ${model.notLet.length - 8} more in the report</li>`)
  const stat = (label: string, value: string) => `<td style="padding:12px 14px;background:#F4F3EF;border-radius:8px;width:33%"><div style="font-size:10px;color:#5A6A7A;text-transform:uppercase;letter-spacing:0.08em">${label}</div><div style="font-size:18px;font-weight:700;color:#1A2530;margin-top:3px">${value}</div></td>`
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:28px 22px;color:#1A2530">
    <div style="text-align:center;margin-bottom:22px"><img src="https://www.ownproperly.com/brand/email-lockup.png" alt="Properly" style="height:36px;width:auto"/></div>
    <h2 style="margin:0 0 6px;font-size:20px">Rent report</h2>
    <p style="margin:0 0 18px;color:#5A6A7A;font-size:14px">${esc(dateLong(model.asOf))} &middot; ${s.units} properties managed by ${esc(model.agent?.name || 'you')}</p>
    <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 20px"><tr>
      ${stat(`Collected ${model.year}`, `${money0(s.yearCollected)} of ${money0(s.yearDue)}`)}
      ${stat('Rent owed', money0(s.shortfallYear + s.arrears))}
      ${stat('Not let', `${s.notLetUnits} of ${s.units}`)}
    </tr></table>
    ${owing.length ? `<p style="margin:0;font-weight:700;font-size:14px">Rent owed</p>${list(owing)}` : '<p style="margin:0;font-size:14px;color:#1F9D63;font-weight:700">Nothing overdue this week.</p>'}
    ${notLet.length ? `<p style="margin:18px 0 0;font-weight:700;font-size:14px">Not let (${s.notLetUnits})</p>${list(notLet)}` : ''}
    <p style="margin:22px 0 0;color:#5A6A7A;font-size:13px;line-height:1.6">The attached PDF has the full position: rent due and collected this year, what needs doing, every property company by company with its rent month by month, and the short-term lets. Rent owed means rent still unpaid after its payment window.</p>
    <p style="margin:26px 0 0;color:#9CA3AF;font-size:11px;text-align:center">Sent every week by Properly on behalf of the property owner.</p>
  </div>`
}

// Gmail when the Workspace service account is configured, else Resend.
async function sendReport({ to, cc, replyTo, subject, html, filename, pdf }: {
  to: string[]; cc: string[]; replyTo?: string; subject: string; html: string; filename: string; pdf: string
}) {
  const from = `Properly <${GMAIL_SENDER}>`
  if (Deno.env.get('GOOGLE_SA_KEY')) {
    await sendGmail({ from, to: to.join(', '), cc, subject, html,
      attachments: [{ filename, contentType: 'application/pdf', base64: pdf }] })
    return
  }
  if (!RESEND_API_KEY) throw new Error('No email provider configured: set GOOGLE_SA_KEY or RESEND_API_KEY')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to, subject, html,
      ...(cc.length ? { cc } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      attachments: [{ filename, content: pdf }],
    }),
  })
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

serve(async (req) => {
  const cronSecret = req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) return new Response('Forbidden', { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch (_) { body = {} }
  const preview = body.preview === true
  const dryRun = body.dry_run === true
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const now = londonNow()

  let q = admin.from('agent_report_schedules').select('*, agent:estate_agents(id,name,user_id)')
  if (body.schedule_id) q = q.eq('id', body.schedule_id)
  else if (!preview && !dryRun) q = q.eq('enabled', true)
  const { data: schedules, error } = await q
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const results: any[] = []
  let mark: { data: string; w: number; h: number } | null | undefined
  for (const sch of schedules || []) {
    const due = sch.enabled && sch.weekday === now.weekday && sch.send_hour === now.hour
      && !(sch.last_sent_at && londonNow(new Date(sch.last_sent_at)).iso === now.iso)
    if (!preview && !dryRun && !due) { results.push({ id: sch.id, skipped: 'not due' }); continue }
    try {
      // Owner-scoped: an agent row belongs to one owner, and only that
      // owner's properties are ever read for their schedule.
      if (!sch.agent || sch.agent.user_id !== sch.user_id) throw new Error('agent does not belong to the schedule owner')
      const { data: props, error: pErr } = await admin.from('properties').select(PROPERTY_SELECT)
        .eq('user_id', sch.user_id).is('deleted_at', null).is('archived_at', null)
      if (pErr) throw new Error(pErr.message)
      const [{ data: cos }, { data: settings }] = await Promise.all([
        admin.from('companies').select('id,name,color').eq('user_id', sch.user_id),
        admin.from('company_settings').select('company_id,logo_url').eq('user_id', sch.user_id),
      ])
      const logoUrl = new Map((settings || []).map((r: any) => [r.company_id, r.logo_url]))
      const companies = (cos || []).map((c: any) => ({ ...c, logo_url: logoUrl.get(c.id) || null }))
      const stl = await loadStl(admin, props || [])
      const model = buildAgentReport(props || [], { agent: sch.agent, companies, asOf: now.iso, stl })
      if (dryRun) {
        const stlSummary = (model.stl || []).map((b: any) => ({ name: b.name, rooms: b.rooms, of: b.totalRooms, month: { ...b.month, months: undefined }, year: { ...b.year, months: undefined } }))
        results.push({ id: sch.id, summary: model.summary, lines: model.lines.length, stl: stlSummary }); continue
      }

      const to = (preview ? sch.cc : sch.recipients).filter(validEmail)
      const cc = preview ? [] : (sch.cc || []).filter(validEmail)
      if (!to.length) throw new Error(preview ? 'no cc address to preview to' : 'no recipients')
      if (mark === undefined) mark = await loadPng(LOGO_URL)
      const logos: Record<string, unknown> = {}
      await Promise.all(model.byCompany.map(async (g: any) => {
        const im = g.logoUrl ? await loadLogo(String(g.logoUrl)) : null
        if (im) logos[g.companyId] = im
      }))
      const doc = drawAgentReportPdf(jsPDF, model, { logos, mark })
      const pdf = b64encode(new Uint8Array(doc.output('arraybuffer')))
      const subject = `${preview ? '[Preview] ' : ''}Rent report - ${dateLong(model.asOf)}`
      await sendReport({ to, cc, replyTo: (sch.cc || []).find(validEmail), subject, html: emailHtml(model), filename: agentReportFilename(model), pdf })
      if (!preview) {
        await admin.from('agent_report_schedules').update({ last_sent_at: new Date().toISOString(), last_status: `sent ${model.summary.units} properties`, updated_at: new Date().toISOString() }).eq('id', sch.id)
      }
      results.push({ id: sch.id, sent: to.length + cc.length, preview, units: model.summary.units, pages: doc.getNumberOfPages() })
    } catch (e) {
      const msg = (e as Error).message || String(e)
      console.error('[agent-weekly-report]', sch.id, msg)
      if (!preview && !dryRun) await admin.from('agent_report_schedules').update({ last_status: `error: ${msg.slice(0, 200)}`, updated_at: new Date().toISOString() }).eq('id', sch.id)
      results.push({ id: sch.id, error: msg })
    }
  }
  return new Response(JSON.stringify({ london: now, results }), { headers: { 'Content-Type': 'application/json' } })
})
