# OwnProperly — Launch checklist

**Updated:** 2026-05-25
**Status:** Code-side launch work complete. Items below are dashboard-only / account-only actions that only you can take.

---

## ⏱ 30 minutes today — must do before any paid ads

### 1. Submit sitemap to Google Search Console (5 min)
1. Go to https://search.google.com/search-console
2. Add property → "Domain" → `ownproperly.com`
3. Verify via DNS TXT record (your DNS provider — likely Vercel DNS) or HTML upload
4. Once verified: **Sitemaps** → submit `sitemap.xml`
5. **Indexing → Request indexing** on these 3 URLs:
   - `https://www.ownproperly.com/`
   - `https://www.ownproperly.com/mtd-itsa-landlord-software/`
   - `https://www.ownproperly.com/section-24-calculator/`

### 2. Submit sitemap to Bing Webmaster Tools (5 min)
1. Go to https://www.bing.com/webmasters
2. Add Site → `https://www.ownproperly.com`
3. Choose "**Import from Google Search Console**" — saves the verification step
4. Submit `sitemap.xml`

### 3. Set up Plausible Analytics (10 min)
1. Sign up at https://plausible.io (£9/month — cheaper than GA4 in admin time)
2. Add a site → `ownproperly.com`
3. Done. The script is already in `index.html` and will start sending events immediately on next Vercel deploy.

### 4. Set up Google Analytics 4 (10 min)
1. Go to https://analytics.google.com
2. Create property → "OwnProperly" → United Kingdom → GBP
3. Set up **Web** stream → enter `https://www.ownproperly.com`
4. Copy the **Measurement ID** — looks like `G-XXXXXXXXXX`
5. In `index.html`, uncomment the GA4 script block (lines around `Google Analytics 4 — PLACEHOLDER`) and replace both `G-XXXXXXXXXX` placeholders with your real measurement ID
6. Commit + push — Vercel auto-deploys

### 5. Trigger Vercel re-deploy if it didn't auto-fire
- Vercel → your project → Deployments → ⋮ → **Redeploy latest**

---

## ⏱ This week — set up paid-ad infrastructure

### 6. Apply for HMRC production credentials
- Go to https://developer.service.hmrc.gov.uk
- "My applications" → your app → **Apply for production credentials**
- They'll review your security questionnaire — typical lead time 4–6 weeks
- ⚠️ Don't promise customers "live HMRC" until you're approved. The sandbox flow already works end-to-end.

### 7. Book a third-party penetration test
- Required by HMRC for production approval
- Recommended UK pentesters (£3-5k typical):
  - **Cyber Smart** — https://cybersmart.co.uk (good for SaaS, includes Cyber Essentials)
  - **Pentest People** — https://pentestpeople.com (more technical)
  - **NCC Group** — https://www.nccgroup.com (enterprise, expensive)
- Book early — they're usually 4–6 weeks out

### 8. Enable Supabase Auth MFA
- Supabase Dashboard → Authentication → **Providers**
- Scroll to **Multi-Factor Authentication**
- Toggle **TOTP** on → Save
- Test by going to your account → Settings → Security & Data → "Enable two-factor authentication" (panel is already built)

### 9. Set up Meta Business Manager (for Facebook + Instagram ads)
1. Go to https://business.facebook.com → Create account
2. Add an ad account
3. Create a Meta Pixel → name "OwnProperly Pixel"
4. Copy the Pixel ID (a 16-digit number)
5. In `index.html`, uncomment the Meta Pixel script block and replace `0000000000000000` (both occurrences) with your pixel ID
6. **CAPI server-side events:** in Meta Events Manager → Pixel → Set up Conversions API → Direct integration. Save the access token. Then ping me and I'll wire it into the Stripe webhook so iOS 17+ users still get attributed.

### 10. Set up Google Ads account
1. Go to https://ads.google.com → Create account
2. Skip the Smart campaign suggestion (use Expert mode)
3. Link your Google Analytics property → Conversions tab → import GA4 events
4. Build the 5 campaigns described in `MARKETING_STRATEGY.md` section 3.1 — leave them PAUSED for now
5. Approve billing details so they can launch in one click

### 11. Set up LinkedIn Campaign Manager
1. https://www.linkedin.com/campaignmanager → New account
2. Add the Insight Tag to `index.html` (same pattern as GA4 — I can wire it for you once you have the partner ID)

### 12. Set up TikTok for Business (only if you want to test TikTok)
1. https://ads.tiktok.com → register
2. Create a Pixel → copy the Pixel Code
3. Add to `index.html` (same pattern — ping me with the ID)

### 13. Status page
- Sign up at https://betterstack.com/uptime (free tier covers this)
- Add monitors for:
  - `https://www.ownproperly.com` (homepage)
  - `https://hqrhqbkqxzllmzhcofrh.supabase.co/rest/v1/` (Supabase API)
  - `https://api.stripe.com/v1/charges` (sanity)
- Create a public status page at `status.ownproperly.com` (point DNS CNAME → BetterStack provided)

### 14. Customer success email
- Verify `hello@ownproperly.com` is monitored and has an auto-responder ("Thanks — we reply within 24h on weekdays")
- Set up forwarding rules so HMRC sandbox webhook errors don't bury support emails

### 15. Live Stripe end-to-end test
- Use a real credit card on production
- Sign up → trial → switch to paid (£2/property/month) → verify subscription in Stripe dashboard
- Then immediately cancel → verify the trial gate doesn't lock you out incorrectly
- This catches webhook configuration issues that sandbox testing won't surface

---

## ⏱ This month — content & outreach

### 16. Reach out for guest posts / directory listings
- **Property Tribes** (https://www.propertytribes.com) — DM Vanessa Warwick or send a thoughtful "I built X" post. Their "Tool Directory" listing is high value.
- **Property118** (https://www.property118.com) — Mark Alexander runs sponsored-post pricing. Worth £200-300 for a top-banner placement.
- **NRLA** (National Residential Landlords Association) — they have a sponsor programme. Premium UK landlord audience.
- **Money to the Masses** podcast — Damien Fahy covers tax + property a lot. Pitch the MTD ITSA angle.

### 17. Get listed in the Money Saving Expert "landlord software" thread
- https://forum.moneysavingexpert.com/categories/house-buying-renting-selling — there's a perpetual "best landlord software" thread. A genuine, helpful first post (not sales-y) from a verified account works wonders.

### 18. YouTube creator outreach
- **Property Hub Podcast** (Rob Bence + Rob Dix) — pre-roll sponsorship ~£1,500/episode
- **Jamie York** — runs Agent Rainmaker — high-end audience but check fit
- **Justin Wilkins (Property Investing)** — newer creator but growing fast

### 19. Press release on HMRC production approval (when it lands)
- Trade pubs: Property Industry Eye, Letting Agent Today, Property Investor Today
- Angle: "First MTD-ITSA-recognised landlord SaaS for sole traders" (assuming you're early in the queue)

---

## ⏱ Before paid ads turn on — conversion infrastructure

### 20. Cookie banner ✅ DONE
- Already live in `index.html` — gates GA4 + Meta Pixel firing until user accepts
- ICO/PECR compliant: reject is just as easy as accept

### 21. Real testimonials (replace placeholders)
- Three placeholder testimonials are in `MarketingSite.jsx` lines around "What landlords say"
- Email your top 10 trial users → "Would you be willing to share your experience?"
- Use real first name + last initial + portfolio size (no need for full names or photos initially)

### 22. Customer success person on call for first 100 paying users
- Set up Cal.com or Calendly → "Book a 15-min onboarding call"
- Embed link in the trial welcome email
- First 100 paying customers should get a personal call. They're your case studies, your referrals, and your bug reporters.

---

## ✅ Code-side work — DONE in this session

| Item | Status |
|---|---|
| robots.txt allows LLM crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) | ✅ |
| sitemap.xml with lastmod + new pages | ✅ |
| FAQPage + WebSite + BreadcrumbList JSON-LD on homepage | ✅ |
| `/mtd-itsa-landlord-software/` standalone landing page | ✅ |
| `/section-24-calculator/` interactive landing page | ✅ |
| FAQ section on MarketingSite (matches JSON-LD) | ✅ |
| Comparison table (vs spreadsheets / Arthur / Landlord Vision) | ✅ |
| Testimonials section (placeholders — replace with real) | ✅ |
| Cookie consent banner (consent mode v2) | ✅ |
| Plausible Analytics installed | ✅ |
| GA4 + Meta Pixel + GTM scaffold (commented out — uncomment when IDs ready) | ✅ |
| MTD ITSA quarterly mortgage interest now calculated correctly | ✅ |
| `fmt(NaN)` no longer hidden as £0 | ✅ |
| Portfolio yield calc no longer breaks with missing valuations | ✅ |
| 2FA enrol panel in Settings → Security | ✅ |
| WCAG: FocusTrap on 10 modals, role="dialog" + aria-labelledby | ✅ |
| WCAG: Colour-contrast tokens fixed (T.muted, T.faint, tenant portal) | ✅ |
| HMRC token encryption deployed (mtd_settings.encrypted_*) | ✅ |
| Plaid token encryption deployed (bank_connections.partner_data.access_token_enc) | ✅ |
| create-checkout company-ownership check (blocks Stripe portal hijack) | ✅ |
| stripe-webhook now throws on DB errors (no more silent billing divergence) | ✅ |
| Marketing strategy document (`MARKETING_STRATEGY.md`) | ✅ |

---

## What I CAN do next (just say which letter)

- **(W)** Wire up GTM/GA4/Meta with your real IDs — needs you to send them
- **(X)** Build 10 more SEO blog posts (a sub-agent is already working on this batch — it'll commit them autonomously)
- **(Y)** Write the trial-onboarding email sequence (6 emails over 14 days)
- **(Z)** Build a Cal.com-embedded "book onboarding call" section on the homepage
- **(AA)** Build the email-capture widget for the Section 24 calculator (right now it doesn't capture leads — fix this)
- **(BB)** Build a `/best-landlord-software-uk` comparison landing page
- **(CC)** Build a `/blog/` index page if the existing one needs improving
- **(DD)** Anything else from `MARKETING_STRATEGY.md`

---

## Cost summary (your monthly subscription cost to run this fully)

| Service | Monthly | Why |
|---|---|---|
| Plausible Analytics | £9 | Privacy-friendly, no GDPR banner needed |
| BetterStack (Status page + monitoring) | £0–£25 | Free tier might suffice |
| Cal.com (onboarding calls) | £0–£12 | Free tier covers 1 calendar |
| Customer.io (email sequences) — optional | £100 | If Resend gets too basic |
| Resend (transactional email) | £20 | Already wired |
| **Software total** | **£29–£166** | |
| Paid ads (per `MARKETING_STRATEGY.md`) | £22,500 | Optional — ramp up gradually |
| **Marketing total** | **£22,529–£22,666** | At full scale |

You can start ads at £500/month (just brand defence + the MTD wedge campaign) and ramp.
