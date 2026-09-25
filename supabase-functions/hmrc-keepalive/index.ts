// hmrc-keepalive — periodic sandbox activity ping for the "Own Properly"
// HMRC Developer Hub application. Fired ~every 28 days by a pg_cron job
// (hmrc-keepalive-28d) to reset HMRC's 30-day inactivity deletion clock.
//
// SAFETY:
//   - Talks ONLY to the HMRC SANDBOX host (test-api.service.hmrc.gov.uk) — hard-coded.
//   - Reads HMRC_CLIENT_ID / HMRC_CLIENT_SECRET from the project env. Never returns them.
//   - Touches no database, no tenant data, no real customer records.
//   - Auth: requires x-cron-secret header == CRON_SECRET (same pattern as
//     trial-emails / compliance-reminders). verify_jwt off.
//
// Source of record: this file. Deployed v7 was pulled into the repo on
// 2026-09-07 after living only in production since June.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SANDBOX = "https://test-api.service.hmrc.gov.uk" // hard-coded — never production
const CLIENT_ID = Deno.env.get("HMRC_CLIENT_ID") || ""
const CLIENT_SECRET = Deno.env.get("HMRC_CLIENT_SECRET") || ""
const CRON_SECRET = Deno.env.get("CRON_SECRET") || ""

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Forbidden", { status: 403 })
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      reason: "HMRC_CLIENT_ID / HMRC_CLIENT_SECRET not set in this project's env",
    }), { status: 503, headers: { "Content-Type": "application/json" } })
  }

  const out: Record<string, unknown> = { host: SANDBOX, ts: new Date().toISOString() }

  let accessToken = ""
  try {
    const tokenRes = await fetch(`${SANDBOX}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: "hello",
      }),
    })
    out.token_http = tokenRes.status
    const tokenJson = await tokenRes.json().catch(() => ({}))
    accessToken = (tokenJson as { access_token?: string }).access_token || ""
    out.token_obtained = !!accessToken
    if (!accessToken) {
      out.token_error = (tokenJson as { error?: string; error_description?: string }).error
        || (tokenJson as { error_description?: string }).error_description || "unknown"
    }
  } catch (e) {
    out.token_http = "fetch_failed"
    out.token_error = (e as Error).message
  }

  if (accessToken) {
    try {
      const helloRes = await fetch(`${SANDBOX}/hello/application`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.hmrc.1.0+json",
        },
      })
      out.hello_http = helloRes.status
      out.hello_body = await helloRes.text()
    } catch (e) {
      out.hello_http = "fetch_failed"
      out.hello_error = (e as Error).message
    }
  }

  out.activity_registered = out.token_http === 200 || out.hello_http === 200
  out.gateway_reached = typeof out.token_http === "number"
  return new Response(JSON.stringify(out, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  })
})
