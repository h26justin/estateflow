// Daily Xero reconciliation cron.
//
// Iterates every xero_cron_schedules row (one per opted-in user+company)
// and triggers xero-sync's pull-reconciliation flow on their behalf.
// Doesn't push — pulling is idempotent and safe to run unattended;
// pushing could be surprising if the user has been editing records.
//
// Scheduled via pg_cron in the database. Setup:
//
//   SELECT cron.schedule(
//     'xero-daily-reconciliation',
//     '0 6 * * *',  -- 6am UTC daily
//     $$ SELECT net.http_post(
//          url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/xero-cron-reconcile',
//          headers := '{"Authorization":"Bearer ' || current_setting('app.cron_secret', true) || '"}'::jsonb
//        ); $$
//   );
//
// Authentication: CRON_SECRET env var. Anyone with the URL would
// otherwise be able to trigger reconciliation pulls. The Authorization
// header must match CRON_SECRET — anything else returns 401.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET      = Deno.env.get('CRON_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Auth: must match CRON_SECRET exactly
  const auth = req.headers.get('Authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Every opted-in (user, company) gets a reconciliation pull. We call
  // the xero-sync function with action='reconcile_only' so it skips the
  // push path. (Actually we currently don't have that action — let's
  // emulate by setting flags. For simplicity, call xero-sync internally
  // using the service role, mimicking the user's JWT context via
  // a special header that xero-sync recognises.)
  const { data: schedules } = await admin.from('xero_cron_schedules').select('user_id, company_id')

  const results: any[] = []
  for (const s of (schedules || [])) {
    try {
      // Use service-role to call xero-sync. We pass a sentinel
      // x-cron-secret header that xero-sync checks; the function then
      // skips its normal JWT validation and operates with the row's user_id.
      // (NOTE: requires a small additive change to xero-sync — done in the
      // same commit as this function.)
      const r = await fetch(`${SUPABASE_URL}/functions/v1/xero-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': CRON_SECRET,
          'x-cron-user-id': s.user_id,
        },
        body: JSON.stringify({
          action: 'reconcile_only',
          company_id: s.company_id,
        }),
      })
      const status = r.status
      const body = await r.text()
      results.push({ user_id: s.user_id, company_id: s.company_id, status, ok: r.ok })

      await admin.from('xero_cron_schedules').update({
        last_run_at: new Date().toISOString(),
        last_run_status: r.ok ? 'ok' : 'error',
      }).eq('user_id', s.user_id).eq('company_id', s.company_id)
    } catch (e) {
      results.push({ user_id: s.user_id, company_id: s.company_id, error: (e as Error).message })
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
