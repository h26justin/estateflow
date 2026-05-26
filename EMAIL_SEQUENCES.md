# OwnProperly — Trial onboarding email sequence

**Last updated:** 2026-05-25
**Tool:** Resend (via `supabase-functions/trial-emails`)
**Schedule:** Daily pg_cron job picks the right email for each user based on `auth.users.created_at`.

---

## How it works

A pg_cron job runs daily at 09:30 UK time:
1. Queries `auth.users` for any user whose `created_at` matches one of the trigger offsets (1, 3, 7, 11, 13 days ago).
2. For each match, invokes the `trial-emails` edge function with `{ user_id, day_offset }`.
3. The function looks up the user's first property + portfolio details, picks the matching template, and sends via Resend.

Suppression logic (so users don't get spam):
- Skip if the user has already paid (subscription.status='active')
- Skip if the user has unsubscribed (user_profiles.email_unsubscribed=true)
- Skip if a record exists in `trial_email_log` for this (user_id, day_offset) pair

---

## Email 1 — Day 0 (immediate, at signup) — `welcome`

**Subject:** Welcome to OwnProperly · 14 days, no card needed
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Welcome to OwnProperly. You've got 14 days to put us through our paces — every feature unlocked, no card needed.

Most landlords get a useful first win within 10 minutes. Three things worth doing today:

1. **Add your first company** (one company per legal entity — your name if you own personally, or your SPV name)
2. **Add a property** — or use Bulk Add if you've got a block of flats
3. **Plug in one rent payment** to see how the tracker works

If you're staring at the screen wondering where to start, [book a free 15-minute onboarding call here]({{cal_url}}). I'll walk you through it.

Anything broken or confusing? Just reply to this email — it comes straight to me.

Justin
Founder, OwnProperly

P.S. If you're worried about MTD ITSA in April 2026 — that's the main thing we built this for. Sandbox practice mode is on by default, so you can rehearse quarterly submissions today with zero risk.

---

## Email 2 — Day 1 — `add_first_property` (only sent if no property added)

**Subject:** Quick start: your first property in 90 seconds
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Noticed you haven't added a property yet — totally normal, most people don't until they have 5 minutes spare.

Here's the fastest way to get value from the trial:

→ **[Add your first property]({{app_url}}/properties)**

You only need three fields to get going:
- Name (e.g. "Flat 1, Station Road")
- Full address
- Status (most likely "Rented" if it's already let)

Mortgage, value, rent — all those are optional and you can fill in over time. The app gets smarter the more you add but works fine with the basics.

If you have a block of flats, hit the "+ Add Block" button instead — it adds the whole building in one shot.

Justin

---

## Email 3 — Day 3 — `compliance_check` (sent regardless)

**Subject:** The 4 expiry dates that catch landlords out
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Quick midweek tip. Most landlord fines I've seen don't come from "doing something wrong" — they come from missing an expiry date.

The four UK landlord compliance dates that catch people out, in order of cost:

| Certificate | Required every | Penalty if missed |
|---|---|---|
| **Gas Safety (CP12)** | 12 months | Unlimited fine + 6 months prison + automatic Section 21 invalidation |
| **EICR** (electrical) | 5 years | Up to £30,000 fine |
| **EPC** | 10 years (or when re-let if E or below) | Up to £5,000 fine + automatic Section 21 invalidation if F/G |
| **Right to Rent** | Per tenant — at start, then ongoing checks for time-limited | Up to £20,000 per occupier + criminal offence |

OwnProperly emails you 90, 60, 30 and 7 days before each one expires. So you never have to remember.

→ **[Add your compliance dates here]({{app_url}}/properties)** (click any property → Compliance tab)

If you've got a Gas Safety cert sitting in a pile of paper somewhere, take 30 seconds and type the expiry date in now. You'll thank yourself in 11 months.

Justin

P.S. Reply if anything's confusing about which certificates apply to your situation — happy to help directly.

---

## Email 4 — Day 7 — `mtd_itsa_pitch` (sent regardless)

**Subject:** MTD ITSA — your first quarterly is due {{first_mtd_quarter_date}}
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

If you've got rental income over £50,000, Making Tax Digital for Income Tax (MTD ITSA) goes live on 6 April 2026. From that day you have to file quarterly digital submissions to HMRC — annual self-assessment is gone.

The good news: this is one of the main reasons we built OwnProperly. Most other landlord tools haven't shipped MTD ITSA yet.

Here's the timeline you need to know:

- **April 2026:** mandatory if your previous-year rental income was above £50,000
- **April 2027:** threshold drops to £30,000
- **Quarterly submissions:** four per year, each due one month + 7 days after quarter end
- **First quarter** (April–July 2026) is due **5 August 2026**

In OwnProperly, you can practice the full submission flow today against HMRC's sandbox — no risk, no real data sent. Most landlords run 2-3 practice submissions before they trust the live flow.

→ **[Start MTD ITSA setup]({{app_url}}/mtd)**

It's a 3-minute setup: enter your NINO, click "Connect HMRC", sign in via gov.uk. Then run a practice quarter.

Justin

P.S. Section 24 mortgage interest restriction is baked into the calculations — your quarterly figures automatically include the 20% basic-rate credit so you don't have to remember.

---

## Email 5 — Day 11 — `pricing_reminder` (sent regardless)

**Subject:** Your trial ends in 3 days — questions?
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Your free trial ends in 3 days. No pressure — but a heads-up so it doesn't surprise you.

Quick recap on pricing:

- **£2/property/month** — every feature, no minimums, no per-user fees
- You're billed monthly, only for what you have
- Add/remove properties anytime, billed pro-rata

For most landlords that's £10–£50/month total. Less than the cost of one missed Gas Safety cert.

→ **[Add your card and continue]({{app_url}}/?settings=billing)**

If you've decided OwnProperly isn't right, that's fine — you can just let the trial expire and your account moves to read-only. Your data stays safe and you can come back later.

If anything's holding you back, hit reply and tell me what's missing. Genuinely useful feedback.

Justin

---

## Email 6 — Day 13 — `last_day` (sent only if not yet paying)

**Subject:** Last day of your trial — want a call instead?
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Your trial ends tomorrow. Two options:

1. **[Add a card]({{app_url}}/?settings=billing)** — continue with everything you've set up
2. **[Book a 15-min call with me]({{cal_url}})** — tell me what didn't work, get a personal walkthrough of anything you're stuck on

I want to know if we're not delivering for you. The fastest way to fix it is a real conversation, not another email. So if you're on the fence, please pick option 2.

If you decide OwnProperly isn't right after that, fine — but at least I'll have learnt something.

Justin

---

## Optional Email 7 — Day 21 (post-paid) — `quick_check_in` (sent only if paid)

**Subject:** How's it going? + a few power-user tips
**From:** Justin at OwnProperly <justin@ownproperly.com>

---

Hi {{first_name}},

Welcome to the paid tier — really glad you stuck with us.

A few things most landlords don't realise are in the app:

1. **Tenant portal** — every company has one at `{{company_subdomain}}.ownproperly.com`. You can invite tenants from any tenancy detail page.
2. **Statement importer** — forward bank statements to your company's inbox address (Settings → Integrations) and we'll pull rent payments out automatically.
3. **Bulk rent rev iew** — Rent Tracker → "Plan rent review" lets you plan multi-property increases with comparable rent data.
4. **Section 24 calculator on every property** — Property → Financials tab.

If you've got an awkward setup — HMO with per-room rent, joint ownership across two SPVs, refurb-in-progress flat — reply and tell me. We've usually got a way to handle it; if we don't, you've found us a real product idea.

Thanks for trusting us with your portfolio.

Justin

---

## Templates — variable reference

| Variable | Source |
|---|---|
| `{{first_name}}` | `user_profiles.first_name`, fall back to "there" |
| `{{cal_url}}` | Static — `https://cal.com/ownproperly/onboarding` |
| `{{app_url}}` | Static — `https://www.ownproperly.com` |
| `{{first_mtd_quarter_date}}` | Static — "5 August 2026" |
| `{{company_subdomain}}` | `companies.subdomain` (first company on the account) |

---

## Resend config

- **From address:** `justin@ownproperly.com` (must be verified in Resend with DKIM)
- **Reply-to:** `justin@ownproperly.com` — replies come straight to you
- **List-Unsubscribe header:** mandatory under EU + UK PECR. Resend handles this automatically when you supply an `{{{RESEND_UNSUBSCRIBE_URL}}}` token.
- **Tracking:** disable click tracking on Day 1 + Day 3 (looks spammy). Enable on Day 7 + Day 11 + Day 13 so you can measure CTR per CTA.

---

## Suppression rules (build into edge function)

Skip sending if ANY of these are true:
- User has paid (`subscriptions.status = 'active'` for any of their companies)
- User explicitly unsubscribed (`user_profiles.email_unsubscribed = true`)
- Email already sent for this user × day_offset (check `trial_email_log` table)
- User signed up via an invitation (they're a tenant or collaborator, not the trial customer)

The `trial_email_log` table needs:
```
trial_email_log
├── user_id (uuid, FK to auth.users)
├── day_offset (int, the offset value used)
├── template (text, the template slug like 'welcome')
├── sent_at (timestamptz default now())
└── unique (user_id, day_offset)
```
