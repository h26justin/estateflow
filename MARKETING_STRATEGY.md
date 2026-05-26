# OwnProperly — Go-to-Market & Paid Advertising Strategy

**Last updated:** 2026-05-25
**Owner:** Justin Hammond
**Goal:** Acquire 10,000 paying UK landlords in 18 months at sustainable unit economics.

---

## 1. Who we sell to

### Primary persona — "Portfolio Patricia"
- UK landlord, 4–25 properties
- Mix of personal + SPV (limited company) ownership
- Currently using: a chaotic mix of spreadsheets + Notion + paper certificates
- Pain points: MTD ITSA deadline (April 2026), rent collection chase-ups, certificate expiry surprises, Section 24 tax shock
- Aged 35–60, household income £60k+, owns a smartphone, reads The Times Property and Property118
- **Willingness to pay:** £20–£100/month if it saves 5 hours/month

### Secondary persona — "Side-Hustle Sam"
- 1–3 properties, day job
- Wants the cheapest tool that handles compliance + rent
- Often a former tenant who became an "accidental" landlord
- **Willingness to pay:** £5–£20/month, very price sensitive

### Tertiary persona — "Letting-agent Lisa"
- Manages 20–500 properties on behalf of clients
- Currently uses Reapit / Goodlord / Arthur — but they're £200+/month
- Could become a high-LTV multi-tenant customer
- **Willingness to pay:** £200–£2,000/month

### Who we deliberately DON'T target (yet)
- Build-to-rent operators (need different feature set)
- Commercial landlords (different compliance regime)
- Non-UK landlords (HMRC integration is the moat)
- Tenants directly (they're a feature, not a buyer)

---

## 2. Positioning & message

### Our wedge
> **"The only landlord software built for the MTD ITSA April 2026 mandate — works from your first property at £2/month."**

### Key claims (each needs proof on landing page)
1. **MTD ITSA-ready today** — sandbox + production HMRC OAuth, fraud headers, encrypted tokens (proof: HMRC dev hub registration screenshot)
2. **Compliance never expires unnoticed** — automatic reminders 90 / 60 / 30 / 7 days out (proof: testimonial + screenshot of an expiring cert email)
3. **One number per company per month** — multi-company billing, no surprise minimums (proof: pricing calc widget)
4. **Tenant portal that doesn't make you look like a part-timer** — branded sub-domain (proof: live demo at `demo.ownproperly.com`)
5. **Section 24 calculator built in** — see your real after-tax profit (proof: BTL calculator side-by-side with manual sum)

### What NOT to say
- ❌ "AI-powered" (commoditised — and landlords are sceptical)
- ❌ "Revolutionary" (too startup-y for the persona)
- ❌ "Free forever" (we charge — and it's a feature, not a bug)
- ❌ "Manage 1,000 properties" (P. Patricia has 4; the bigger number anchors against us)

---

## 3. Channel-by-channel paid strategy

### 3.1 Google Ads (£8,000 / month — primary channel)

**Why Google first:** UK landlord searches have buying intent. Someone Googling "landlord software UK" is 6 weeks from picking a tool. Google Ads short-circuits SEO ramp (which takes 6+ months).

#### Search campaigns

**Campaign A — Brand defence (£500/month, exact match)**
- "ownproperly", "own properly", "ownproperly login"
- Defend against competitor poaching. Cheap (£0.30 CPC). Always-on.
- **Daily cap:** £20
- **Expected CTR:** 18%+
- **Expected CPA:** £4

**Campaign B — Category (£3,000/month, exact + phrase match)**
- "landlord software", "property management software uk", "buy to let software", "landlord app", "rental property software"
- High intent, high competition (£3–£6 CPC)
- **Negatives:** "free", "tenant" (different intent), "commercial", "estate agent"
- **Expected CPA:** £40–£60
- **Landing page:** `/` (current homepage works)

**Campaign C — MTD ITSA (£2,000/month, exact + phrase match)**
- "mtd itsa landlord", "making tax digital landlord", "hmrc landlord software", "mtd quarterly submission", "section 24 calculator"
- HUGE wedge campaign — 2.4M UK landlords are panicking about April 2026
- **Expected CPC:** £1.50–£3 (still ramping)
- **Expected CPA:** £25
- **Landing page:** dedicated `/mtd-itsa-landlord-software` (NEED TO BUILD)

**Campaign D — Compliance long-tail (£1,500/month, phrase + broad match modifier)**
- "gas safety reminder app", "eicr tracker", "hmo licence software", "right to rent app", "deposit protection software"
- Lower-volume but extremely high-intent
- **Expected CPA:** £20

**Campaign E — Competitor (£1,000/month, exact match)**
- "arthur online review", "reapit alternative", "landlord studio uk", "goodlord pricing", "rentila alternative", "lendlord review"
- DON'T name competitors in ad copy (Google rule). Focus on "save 60% vs [category leader]".
- **Expected CPA:** £55

#### Display + YouTube

**Campaign F — YouTube In-Stream + Display Remarketing (£1,000/month)**
- Audiences: previous site visitors + lookalikes of converted customers
- 15-second skip-able video showing the compliance reminder in action
- **Goal:** bring back 30% of dropped trials

**Total Google budget:** £8,000/month. **Target blended CPA:** £45. **Target conversions:** ~175/month.

---

### 3.2 Meta Ads — Facebook + Instagram (£5,000 / month)

**Why Meta:** Property landlords cluster in Facebook Groups (Property Tribes, Property118, UK Landlords). They scroll. Targeting is detailed enough to reach the persona without paying for irrelevant impressions.

#### Audiences
- **Lookalike of paying customers** (1% UK) — best performer once you have 100+ customers
- **Interests:** Property Tribes, Property118, Landlordzone, Buy-to-let, BTL, Rightmove (landlord side), Zoopla, NLA, NRLA, GoodLord, OpenRent
- **Demographics:** UK, age 35–65, household income top 25%, English speakers
- **Behavioural:** Frequent traveller (often a sign of portfolio scale)
- **Custom audience:** uploaders of HMRC self-assessment search terms (via interest proxies)

#### Creative angles (test 3 simultaneously)
1. **Tax-fear angle:** "Your first MTD ITSA quarterly is due [date]. Most landlords don't know." → static carousel showing what the dashboard does
2. **Time-saving angle:** "I used to spend Sunday afternoons doing rent. Now it's 12 minutes." → 30s testimonial video
3. **Money angle:** "How a 12-property landlord found £4,200 in missed Section 24 tax credit" → carousel ad with screenshots

#### Funnel
- TOFU: video views (£1/view target)
- MOFU: retarget video viewers with "Start your free trial" carousel
- BOFU: retarget site visitors with case-study static ad

**Target blended CPA:** £55. **Target conversions:** ~90/month.

---

### 3.3 LinkedIn Ads (£2,000 / month)

**Why LinkedIn:** Best place to reach Letting-agent Lisa + landlords who run SPVs ("director of [property name] Ltd"). Lower volume but high ACV.

#### Targeting
- Job titles: Property Manager, Lettings Manager, Director (filtered by company size 1–10)
- Industries: Real Estate, Leasing Non-Residential Real Estate
- UK only, England + Scotland + Wales

#### Format
- Single-image Sponsored Content (cheapest LinkedIn format)
- Sponsored InMail to specific job titles (more expensive, only for the agency persona)
- Lead Gen Forms (don't make them leave LinkedIn) — auto-filled email + company

#### Creative
- B2B-toned: "Why 8 letting agents switched to OwnProperly this quarter"
- Carousel showing the multi-user permissions feature

**Target CPA:** £120 (higher ACV justifies it). **Target conversions:** ~17/month.

---

### 3.4 TikTok Ads (£1,000 / month — experimental)

**Why TikTok:** Side-Hustle Sam is under 40 and uses TikTok for finance content. Property creators (#propertytok, #ukproperty) drive measurable trial signups for adjacent tools.

#### Format
- Spark Ads (boost organic creator content — feels native)
- Partner with 2 mid-tier creators (10k–100k followers) on revenue-share
- 15-second vertical video showing the receipt-scan flow

#### Creative angles
1. "How I track 6 rental properties on my phone in 2 minutes a day"
2. "POV: it's the day before your gas safety expires"
3. "I built a property portfolio of £2M in 5 years. This is the spreadsheet I replaced."

**Target CPA:** £40. **Target conversions:** ~25/month.

---

### 3.5 YouTube (£0 paid — organic via Property creators, £2,000 / month for sponsorships)

**Strategy:** UK property YouTube is dominated by 5 channels (Justin Wilkins, Samuel Leeds — controversial, Jamie York, Property Hub, Money to the Masses). Sponsorship reads convert WAY better than display ads.

- **Property Hub podcast pre-roll** (~£1,500/episode, but builds brand)
- **Jamie York mid-roll** (he runs an academy — different audience but premium engaged)
- **Money to the Masses** if MTD ITSA is the angle

Negotiate for a unique discount code (`PROPERTYHUB30`) so we can attribute precisely.

---

### 3.6 Reddit + Facebook Groups (Organic + £500/month boosts)

**Communities:**
- r/uklandlords (35k members)
- r/HousingUK (180k)
- r/UKPersonalFinance (1M+)
- Property118 forum
- "Landlords' Association UK" (45k)
- "UK Property Investors Network" (28k)

**Strategy:**
- Hire a community manager (£800/month freelancer) to genuinely participate — NOT spam
- Answer questions about Section 24 / MTD / compliance — link to relevant guide pages (not the homepage)
- Run quarterly AMA in r/uklandlords
- Don't post promotional content more than 1 in 20 posts

---

### 3.7 Content + SEO (£3,000 / month — long-term moat)

**Existing assets:**
- 9 blog posts (compliance checklist, rent tracker guide, BTL calculator, Right to Rent, deposit protection, tenant portal, portfolio management, lettings pipeline, Section 21)

**Content gaps to fill (priority order):**

| Topic | Search volume | Difficulty | Priority |
|---|---|---|---|
| MTD ITSA for landlords (definitive guide) | High | Low | ⭐⭐⭐ |
| Section 24 mortgage interest tax explained | High | Medium | ⭐⭐⭐ |
| Limited company vs personal ownership (SPV setup) | High | Medium | ⭐⭐⭐ |
| How to bulk-add properties to landlord software | Low | Low | ⭐⭐ |
| BTL stress test calculator (interactive) | High | High | ⭐⭐⭐ |
| Best UK landlord apps 2026 (comparison) | High | High | ⭐⭐ |
| EICR cost guide 2026 | Medium | Low | ⭐⭐ |
| HMO licence application step-by-step | Medium | Medium | ⭐⭐ |
| Right to Rent ID document checker (interactive) | Medium | Medium | ⭐⭐ |
| Tenant referencing UK guide | High | High | ⭐⭐ |

**Cadence:** 2 long-form posts/week (1,800+ words each), targeting one keyword cluster. Build out to 50 posts over 6 months.

**Distribution every post:**
1. Tweet from @ownproperly account
2. LinkedIn post (longer, professional tone)
3. Reddit (if relevant subreddit, naturally)
4. Email to existing trial users (segmented by interest)
5. Repurpose into a YouTube short / TikTok

---

### 3.8 Email Marketing (£200/month tool cost, near-zero variable)

**Tool:** Resend (already wired) — or upgrade to Customer.io for sequences.

**Sequences:**

1. **Trial onboarding (Day 0, 1, 3, 7, 11, 13)** — show one feature per email. Day 13 = "trial ends tomorrow, want a callback?"
2. **Cold lead nurture (post-content-download)** — 5 emails over 3 weeks teaching MTD ITSA
3. **Churn-prevention** — 7 days before sub renewal, send their "year in numbers" report
4. **Winback** — quarterly to cancelled customers with "what's new"

---

## 4. Budget summary

| Channel | Monthly | Annual | Expected conversions/month | Blended CPA |
|---|---|---|---|---|
| Google Ads | £8,000 | £96,000 | 175 | £45 |
| Meta (FB/IG) | £5,000 | £60,000 | 90 | £55 |
| LinkedIn | £2,000 | £24,000 | 17 | £120 |
| TikTok | £1,000 | £12,000 | 25 | £40 |
| YouTube sponsorships | £2,000 | £24,000 | 30 | £67 |
| Reddit / FB groups | £500 + £800 freelancer | £15,600 | 20 | £65 |
| Content + SEO | £3,000 | £36,000 | 50 (after 6mo) | £60 |
| Email tooling | £200 | £2,400 | — | — |
| **TOTAL** | **£22,500** | **£270,000** | **~400** | **£56** |

---

## 5. Unit economics math

- Average revenue per user (ARPU): £2 × 6 properties × 12 months = **£144/year**
- Investor tier (30% of users): £5 × 8 properties × 12 = **£480/year**
- **Blended ARR:** £144 × 0.70 + £480 × 0.30 = **£245/year**
- **Gross margin:** 88% (Supabase + Stripe + Resend + Vercel)
- **Gross profit per customer-year:** £216
- **Target CAC:** **£75 max** (3-year payback)
- **At blended CPA of £56 → payback in 3.1 months** — healthy
- **Target LTV:LCAC:** 3:1 minimum, aim for 5:1
- Assuming 12% annual churn → LTV ≈ £1,800 → LTV:CAC = **24:1** if CPA stays at £56

---

## 6. Conversion tracking & analytics

**Must install BEFORE turning on paid ads:**

1. **Google Tag Manager** (one container, all tags)
2. **GA4** with key events:
   - `start_trial`
   - `add_first_property`
   - `start_subscription`
   - `cancel_subscription`
3. **Meta Pixel** + Conversion API (server-side — Stripe webhook can fire this)
4. **LinkedIn Insight Tag**
5. **TikTok Pixel**
6. **Server-side conversion attribution** — Stripe webhook → posts paid conversions back to Google Ads (offline conversion import via Customer Match) and Meta CAPI. Critical because iOS 17 broke client-side attribution.
7. **Plausible Analytics** for daily numbers without GDPR cookie banner

---

## 7. Landing-page conversion lift work (do this BEFORE scaling spend)

**Current homepage state:** decent. Hero + features + how it works + pricing + CTA.

**Add before paid traffic hits:**
1. **Trust strip below hero:** "Built for MTD ITSA · Encrypted at rest · GDPR-compliant · 14-day free trial"
2. **Customer testimonials** (3 quotes minimum, ideally with photo + portfolio size)
3. **Live counter:** "X UK landlords currently using OwnProperly" (real number, updated nightly)
4. **Comparison table** (vs Arthur, vs Landlord Vision, vs spreadsheets)
5. **Embedded calculator widget:** "What's your portfolio's Section 24 cost?" — captures email
6. **FAQ section** — answers the 8 questions in the FAQPage schema. Helps SEO + AI search rankings massively.
7. **Logo strip:** "Featured in Property Tribes · Property118 · The Times" (only when true)

**Conversion goal:** lift homepage-to-trial conversion from current ~3% to 6%+ before adding more paid traffic.

---

## 8. SEO win priorities (you control this)

Now that AI-search crawler robots.txt + FAQPage schema are deployed:

| Action | Effort | Impact | Timeline |
|---|---|---|---|
| Submit sitemap to Google Search Console | 5 min | High | Today |
| Submit sitemap to Bing Webmaster Tools | 5 min | Medium | Today |
| Submit to IndexNow (Yandex + Bing batch) | 30 min | Medium | This week |
| Build /mtd-itsa-landlord-software landing page | 1 day | Very high | This week |
| Add FAQ section to MarketingSite UI (mirror schema) | 2 hours | Medium | This week |
| Build the 10 missing blog posts | 2/week × 5 weeks | Very high | 6 weeks |
| Internal link from every blog post → /mtd page | 2 hours | High | Once /mtd page exists |
| Reach out to Property Tribes for a guest post | 1 hour | High | This month |
| Get listed in Property118's "Tool Directory" | 1 hour | High | This month |
| Sponsor 1 episode of Property Hub podcast | 1 day comms | Medium | This quarter |
| Press release: "First landlord SaaS HMRC-approved for MTD ITSA" | 1 day | Very high | Once production HMRC approval lands |

---

## 9. Launch sequence (next 30 days)

**Week 1**
- ☐ Install GTM + GA4 + Meta Pixel + LinkedIn + TikTok tags (3 hours total)
- ☐ Configure Stripe webhook → server-side conversion fires (4 hours)
- ☐ Get OwnProperly verified on Google Business Profile + Bing Places
- ☐ Submit sitemap to GSC + BWT
- ☐ Set up Plausible
- ☐ Build the trust strip + testimonial section (need 3 willing customers)

**Week 2**
- ☐ Write + ship /mtd-itsa-landlord-software landing page
- ☐ Set up Google Ads account (if not already) + load all 6 campaigns paused
- ☐ Set up Meta Business Manager + Pixel + audiences
- ☐ Launch Brand defence campaign only (£500 cap)
- ☐ Write first 3 of the 10 missing blog posts

**Week 3**
- ☐ Launch MTD ITSA Google campaign at £500/day cap
- ☐ Launch first Meta retargeting campaign (need 200+ site visitors first)
- ☐ Approach 2 TikTok creators with rate cards

**Week 4**
- ☐ Review CPA across all campaigns
- ☐ Kill underperforming creative; double down on winners
- ☐ First LinkedIn Sponsored Content live
- ☐ Press outreach to Property Tribes + Property118
- ☐ Plan Property Hub sponsorship

---

## 10. Pre-launch checklist (everything must be ✅ before press / paid ads)

- ☐ 2FA enabled for admin accounts
- ☐ HMRC production approval submitted (or sandbox + clear roadmap)
- ☐ Pen test booked
- ☐ WCAG AA compliance complete (or visible-progress public doc)
- ☐ Privacy + Terms + Security pages live ✅ (done)
- ☐ Stripe live mode tested end-to-end with a real card
- ☐ Cookie consent banner (ICO-compliant for GA4/Meta Pixel)
- ☐ Cancellation flow tested (Stripe portal works)
- ☐ Status page (status.ownproperly.com) — even a simple BetterStack one
- ☐ Support email + auto-responder (hello@ownproperly.com)
- ☐ Customer success person on call for first 100 paying users

---

## 11. KPIs to watch weekly

| Metric | Target |
|---|---|
| Trial signups / week | 100 by month 3, 250 by month 6 |
| Trial → paid conversion | 25%+ |
| Monthly churn | <5% |
| CAC (paid only) | £75 |
| Blended CAC (paid + organic) | £45 |
| LTV / CAC | 5:1 minimum |
| Net revenue retention | 105%+ |
| Organic traffic / month | 5k by month 6, 25k by month 12 |
| Branded search volume | Track monthly via GSC |

---

**This document is a living strategy. Update monthly with what's working / killed.**
