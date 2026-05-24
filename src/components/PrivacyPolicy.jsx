import { useTheme } from '../lib/ThemeContext'

const mono = "'DM Mono',monospace"

// Privacy Policy — UK GDPR / Data Protection Act 2018 compliant.
// Updated 24 May 2026 to cover:
//   - HMRC MTD ITSA integration (NINO, business ID, OAuth tokens)
//   - Plaid Open Banking (read-only PSD2 access to bank transactions)
//   - Xero accounting integration (tokens, transaction sync)
//   - Anthropic API for AI document extraction
//   - Postmark inbound email for statement forwarding
//   - Tenant portal data (data we hold on behalf of landlords)
//
// HMRC requires this URL to be live before granting production credentials —
// must clearly explain what user data is sent to HMRC, why, and how long
// tokens persist.

export default function PrivacyPolicy({ onBack }) {
  const { T } = useTheme()

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 12, letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ fontFamily: mono, fontSize: 13, color: T.muted, lineHeight: 1.85 }}>{children}</div>
    </div>
  )

  const B = ({ children }) => <strong style={{ color: T.text }}>{children}</strong>

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: '40px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {onBack && (
          <button onClick={onBack} style={{ fontFamily: mono, fontSize: 11, background: 'none', border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', marginBottom: 32 }}>
            ← Back
          </button>
        )}

        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, marginBottom: 8, letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>OwnProperly Ltd · Last updated: 24 May 2026</p>
        </div>

        <Section title="1. Who we are">
          OwnProperly is a property portfolio management platform operated by <B>OwnProperly Ltd</B>, a company registered in England and Wales. We help UK landlords and property investors manage their portfolios, compliance, maintenance, tenancies, finances and tax submissions.
          <br/><br/>
          For the purposes of UK GDPR we are the <B>data controller</B> for personal data about you (the account holder). For tenant data, contractor data and similar third-party data you enter into the platform, we act as a <B>data processor</B> on your behalf — you are the controller and bear responsibility for the legal basis on which you process it.
          <br/><br/>
          Contact: <B>hello@ownproperly.com</B>
        </Section>

        <Section title="2. What data we collect">
          <B>Account data:</B> Your email, name, password (hashed), phone number (optional), and account preferences. Collected when you sign up.
          <br/><br/>
          <B>Property data:</B> Addresses, purchase prices, valuations, rental income, mortgage details, photos, compliance dates (gas/EICR/EPC) and any other portfolio data you choose to enter.
          <br/><br/>
          <B>Tenant data (processor):</B> Tenant names, contact details, tenancy dates, rent figures, references, and any documents you upload. You enter this — we hold it on your behalf.
          <br/><br/>
          <B>Financial data:</B> Rent payment records, expense records, deal analysis, and (if you connect Open Banking) read-only access to bank transactions for matching rent payments.
          <br/><br/>
          <B>Tax data (HMRC MTD ITSA):</B> If you enable HMRC integration, we store your National Insurance Number, HMRC property business ID, and OAuth access/refresh tokens issued by HMRC. We use these to file quarterly Making Tax Digital submissions on your behalf.
          <br/><br/>
          <B>Document data:</B> PDFs and images you upload (tenancy agreements, gas certificates, EICRs, EPCs, mortgage offers, insurance policies, receipts). We extract structured fields from these using AI — see section 6.
          <br/><br/>
          <B>Usage data:</B> Log entries of significant actions, timestamps, IP addresses (for security and abuse detection), browser type, and the device used to access the platform.
          <br/><br/>
          <B>Payment data:</B> Subscription billing is processed by Stripe. We store the Stripe customer ID and subscription status — we never see or store your card details.
        </Section>

        <Section title="3. How we use your data">
          To provide and operate the platform, including:
          <br/><br/>
          — Showing you your portfolio, finances, compliance and tax position<br/>
          — Sending you service notifications (rent arrears, compliance expiry, weekly digests, MTD deadlines)<br/>
          — Processing your subscription via Stripe<br/>
          — Filing tax submissions to HMRC on your behalf when you authorise us<br/>
          — Pulling bank transactions via Plaid when you authorise us<br/>
          — Pushing transactions to Xero when you authorise us<br/>
          — Extracting fields from documents you upload using AI<br/>
          — Detecting and preventing abuse or fraud<br/>
          — Providing customer support when you contact us<br/>
          — Improving the platform based on aggregated usage patterns<br/>
          — Complying with our legal obligations (e.g. HMRC record-keeping)
        </Section>

        <Section title="4. Legal basis for processing">
          We process your personal data under the following UK GDPR bases:
          <br/><br/>
          <B>Contract:</B> Most processing is necessary to provide the service you have subscribed to.
          <br/><br/>
          <B>Legitimate interests:</B> Security monitoring, fraud prevention, platform improvement, and direct service communications about features you actively use.
          <br/><br/>
          <B>Legal obligation:</B> Where we are required to retain or process data by law (financial records, HMRC compliance).
          <br/><br/>
          <B>Consent:</B> For marketing emails about new features (you can unsubscribe at any time), and for each third-party integration you choose to enable (HMRC, Plaid, Xero) — each requires explicit OAuth consent that you can revoke.
        </Section>

        <Section title="5. HMRC Making Tax Digital (MTD ITSA)">
          If you enable HMRC integration in <B>Settings → MTD Tax</B>:
          <br/><br/>
          — We redirect you to the gov.uk website to sign in and authorise OwnProperly to file MTD ITSA submissions on your behalf.<br/>
          — HMRC returns OAuth tokens (access + refresh) to us. We store these encrypted at rest in our database, scoped strictly to your user account via row-level security.<br/>
          — When you submit a quarterly summary, we send HMRC the aggregated income and expense totals you have approved — never your raw tenant data, property addresses or supporting documents.<br/>
          — HMRC requires us to send certain anti-fraud headers describing your device and browser (e.g. screen resolution, timezone, IP address). This is HMRC's mandatory requirement, not ours.<br/>
          — You can disconnect HMRC at any time from <B>Settings → MTD Tax → Disconnect</B>. Tokens are deleted immediately.<br/>
          — Submitted records remain in our database for 7 years to satisfy HMRC's record-keeping rules.
        </Section>

        <Section title="6. AI-assisted document extraction">
          When you upload a document (tenancy agreement, certificate, receipt, mortgage offer, etc.), we send the document to <B>Anthropic</B> (https://anthropic.com) to extract structured fields such as dates, amounts and parties. This makes data entry faster.
          <br/><br/>
          — Anthropic processes the document under their data processing agreement and does not retain it for model training.<br/>
          — Documents are sent over TLS-encrypted connections.<br/>
          — The extracted fields and the original document are stored in our database, scoped to your account.<br/>
          — You can delete any document from the platform at any time via the property's Documents tab.
        </Section>

        <Section title="7. Open Banking (Plaid)">
          If you connect a bank account via the Bank Feeds feature, you authorise <B>Plaid Financial Ltd</B> (FCA-regulated, FRN 804718) to provide us with read-only access to your bank transactions under the EU PSD2 framework. We never see or store your bank login credentials.
          <br/><br/>
          — Plaid's consent expires every 90 days as required by PSD2. We will prompt you to reauthorise.<br/>
          — We receive only the transaction data needed to match rent payments and categorise expenses.<br/>
          — You can revoke consent at any time from <B>Bank Connections → Disconnect</B> or directly through your bank's portal.<br/>
          — Plaid's own privacy policy applies to their handling of your data: https://plaid.com/legal/
        </Section>

        <Section title="8. Xero integration">
          If you connect Xero, you authorise OwnProperly to push rent payments and expenses to your Xero organisation as bank transactions. We store the Xero OAuth tokens and the IDs of records we have synced.
          <br/><br/>
          You can disconnect at any time from <B>Settings → Integrations → Xero → Disconnect</B>. Already-synced records remain in Xero — we don't delete them.
        </Section>

        <Section title="9. Data storage and security">
          Your data is stored in <B>Supabase</B> (Postgres database, file storage, authentication), hosted on AWS infrastructure in the <B>EU West (London)</B> region. Data does not leave the UK/EU for storage.
          <br/><br/>
          Security controls:
          <br/><br/>
          — All connections use TLS 1.2+<br/>
          — Postgres row-level security ensures users can only read their own data<br/>
          — Edge functions run with strict JWT verification (where applicable) and never expose service-role keys to the browser<br/>
          — Files are stored in private buckets; access is mediated by signed URLs<br/>
          — At-rest encryption is provided by Supabase / AWS RDS<br/>
          — Regular automated backups; manual on-demand backups available to you via <B>Settings → Backups</B><br/>
          — Audit logging of significant platform actions<br/>
          — Multi-factor authentication available on your account (recommended)
        </Section>

        <Section title="10. Sub-processors we use">
          <B>Supabase Inc.</B> — database, authentication, file storage, serverless functions. EU-hosted.
          <br/><br/>
          <B>Stripe, Inc.</B> — subscription billing and payments.
          <br/><br/>
          <B>Vercel Inc.</B> — application hosting and global content delivery.
          <br/><br/>
          <B>Postmark (ActiveCampaign LLC)</B> — transactional emails and inbound statement-email parsing.
          <br/><br/>
          <B>Anthropic, PBC</B> — AI-assisted document field extraction. Documents are not retained for model training.
          <br/><br/>
          <B>Mapbox, Inc.</B> — interactive property maps.
          <br/><br/>
          <B>Plaid Financial Ltd</B> — Open Banking (only when you connect a bank account).
          <br/><br/>
          <B>Xero Ltd</B> — accounting sync (only when you connect Xero).
          <br/><br/>
          <B>HMRC</B> — Making Tax Digital submissions (only when you authorise the gov.uk OAuth flow).
          <br/><br/>
          All sub-processors are bound by data processing agreements requiring GDPR-equivalent protections.
        </Section>

        <Section title="11. Data retention">
          — Your <B>account profile</B> is deleted within 30 days of you closing the account.<br/>
          — <B>Property and financial records</B> are retained for <B>7 years</B> from the end of the relevant tax year, as required by HMRC.<br/>
          — <B>Tax submissions to HMRC</B> are retained for 7 years and include the snapshot we sent.<br/>
          — <B>HMRC, Plaid and Xero OAuth tokens</B> are deleted immediately when you disconnect.<br/>
          — <B>Backups</B> may retain copies for up to 90 days after deletion.<br/>
          — <B>Anonymised aggregate usage data</B> may be retained indefinitely for analytics.<br/>
          — <B>Trash items</B> (soft-deleted records) remain recoverable for 30 days, then hard-deleted on the next sweep.
        </Section>

        <Section title="12. Your rights">
          Under UK GDPR you have the rights to:
          <br/><br/>
          <B>Access:</B> Request a copy of your data. Use <B>Settings → Backups → Export</B>, or email us.
          <br/><br/>
          <B>Rectification:</B> Correct inaccurate data — most of it is directly editable within the platform.
          <br/><br/>
          <B>Erasure:</B> Request deletion of your account and personal data. Email <B>hello@ownproperly.com</B>. We may retain some data for the 7-year HMRC period.
          <br/><br/>
          <B>Portability:</B> Download your data in a machine-readable format (CSV/JSON) using <B>Settings → Backups</B>.
          <br/><br/>
          <B>Object / restrict:</B> Object to processing based on legitimate interests or restrict our use.
          <br/><br/>
          <B>Withdraw consent:</B> For any third-party integration (HMRC, Plaid, Xero, etc.) by disconnecting in the platform. For marketing emails, unsubscribe.
          <br/><br/>
          We respond to rights requests within 30 days.
        </Section>

        <Section title="13. Cookies and tracking">
          We use only essential cookies and local storage required for authentication, theme preferences and session management. We do not use third-party tracking cookies, advertising cookies or analytics that profile you. No cookie consent banner is required under UK PECR.
        </Section>

        <Section title="14. Children">
          OwnProperly is not intended for use by anyone under 18. We do not knowingly collect data from minors.
        </Section>

        <Section title="15. International transfers">
          Your data is held in the UK/EU. Some sub-processors (e.g. Stripe, Anthropic) may transfer data to the United States under UK-approved transfer mechanisms (Standard Contractual Clauses + UK Addendum, and the UK-US Data Bridge where applicable).
        </Section>

        <Section title="16. Changes to this policy">
          We may update this policy. Material changes will be announced by email and an in-app notice at least 30 days before they take effect. The "Last updated" date at the top of this page always reflects the current version. Continued use after the effective date constitutes acceptance.
        </Section>

        <Section title="17. Complaints">
          If you're unhappy with how we handle your data, please contact us first at <B>hello@ownproperly.com</B>. You also have the right to complain to the UK Information Commissioner's Office:
          <br/><br/>
          <B>ICO</B> · ico.org.uk · 0303 123 1113
        </Section>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, marginTop: 8 }}>
          <p style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
            OwnProperly Ltd · hello@ownproperly.com · ownproperly.com
          </p>
        </div>
      </div>
    </div>
  )
}
