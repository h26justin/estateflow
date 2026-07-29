import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'

const mono = MONO

// Public Security page at /security.
//
// Exists primarily for two compliance reasons:
//   1. HMRC Terms of Use #11/#12 — must publish a security contact
//      method and our 72-hour breach notification commitment.
//   2. RFC 9116 security.txt at /.well-known/security.txt links here.
//
// Also useful when prospective enterprise customers ask "what's your
// security posture?" — we can point at one page instead of a back-and-
// forth on email.

export default function SecurityPage({ onBack }) {
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
          <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, marginBottom: 8, letterSpacing: '-0.02em' }}>Security</h1>
          <p style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>OwnProperly Ltd · Last updated: 24 May 2026</p>
        </div>

        <Section title="Reporting a security issue">
          Email <B>security@ownproperly.com</B> with a description of the issue, steps to reproduce, and any proof-of-concept material.
          <br/><br/>
          We acknowledge reports within <B>1 business day</B> and aim to resolve material issues within <B>30 days</B>.
          <br/><br/>
          We commit not to pursue legal action against good-faith researchers who follow coordinated disclosure (give us a reasonable window to fix before public disclosure). With your permission we'll credit you publicly once the issue is resolved.
          <br/><br/>
          We don't currently run a paid bug bounty. We're happy to discuss recognition / thanks on a case-by-case basis.
          <br/><br/>
          A machine-readable disclosure file is available at <B>https://ownproperly.com/.well-known/security.txt</B>.
        </Section>

        <Section title="Breach notification commitments">
          If we suffer a personal-data breach that is likely to result in a risk to the rights and freedoms of natural persons, we will:
          <br/><br/>
          — Notify the <B>UK Information Commissioner's Office (ICO)</B> within <B>72 hours</B> of becoming aware, as required by UK GDPR Article 33.<br/>
          — Notify <B>affected customers</B> directly by email and an in-app banner within <B>72 hours</B>.<br/>
          — If we file via HMRC's Making Tax Digital APIs and the breach affects HMRC-submitted data, notify <B>HMRC</B> via the Developer Hub support ticket process within <B>72 hours</B>, per the Terms of Use we agreed to.<br/>
          — Publish a public post-mortem within 30 days of resolution covering: what happened, what data was affected, the timeline, what we changed, and our advice to customers.
        </Section>

        <Section title="Where data lives">
          Your data is held in <B>Supabase</B> (a Postgres database, file storage and authentication service) running on AWS infrastructure in the <B>EU West (London)</B> region. Backups stay in the same region.
          <br/><br/>
          Some sub-processors (Stripe, Anthropic) transfer data to the United States under UK-approved transfer mechanisms (Standard Contractual Clauses + UK Addendum).
        </Section>

        <Section title="Encryption">
          <B>In transit:</B> All connections to OwnProperly use TLS 1.2 or higher. HSTS is enforced with a 2-year max-age. The TLS certificate is managed by Vercel via Let's Encrypt.
          <br/><br/>
          <B>At rest:</B> The Postgres database and file storage are encrypted at rest using AES-256 via AWS RDS / S3 standard volume encryption.
          <br/><br/>
          <B>Application-level encryption of OAuth tokens (HMRC, Plaid, Xero):</B> Currently in development. Tokens are stored in a row-level-security-protected table with limited service-role access. We are migrating to application-layer envelope encryption (key separate from the database) before applying for HMRC production credentials.
          <br/><br/>
          <B>Passwords:</B> Never stored in plaintext. Supabase Auth uses bcrypt with a per-user salt.
        </Section>

        <Section title="Access control">
          — All tables use <B>Postgres Row Level Security</B> so users can only read their own data.<br/>
          — <B>SECURITY DEFINER</B> functions have explicit search_path locks to prevent privilege-escalation attacks.<br/>
          — Service-role keys are kept server-side only — never sent to the browser.<br/>
          — Edge functions verify a valid Supabase JWT before any user-scoped action, except for webhook endpoints that authenticate via signed payloads.<br/>
          — Multi-factor authentication is available to all accounts (recommended for any user filing to HMRC).
        </Section>

        <Section title="Logging and monitoring">
          — Significant platform actions (auth events, payment events, MTD submissions, data deletions) are written to an append-only audit log.<br/>
          — Edge-function and database errors are captured in Supabase observability and reviewed regularly.<br/>
          — Failed-login attempts are rate-limited at the auth layer.
        </Section>

        <Section title="Sub-processors">
          A full and current list of sub-processors is published in our <a href="/privacy" style={{ color: T.text, textDecoration: 'underline' }}>Privacy Policy</a>. We update the list whenever it changes.
        </Section>

        <Section title="Penetration testing & audits">
          We commission third-party penetration tests prior to each material expansion of HMRC API scope, and at least annually thereafter. Reports are available to enterprise customers under NDA on request.
          <br/><br/>
          We follow the <B>UK ICO Data Protection Self-Assessment Toolkit</B> on a rolling basis and review the checklist at each significant feature release.
        </Section>

        <Section title="Compliance">
          — UK GDPR / Data Protection Act 2018<br/>
          — HMRC Developer Hub Terms of Use (Making Tax Digital integration)<br/>
          — Open Banking PSD2 — via FCA-regulated AISP Plaid Financial Ltd<br/>
          — UK PECR (cookies and direct marketing) — we use only essential cookies, no tracking cookies
        </Section>

        <Section title="Contact">
          <B>security@ownproperly.com</B> for security reports and questions.<br/>
          <B>hello@ownproperly.com</B> for everything else.
        </Section>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, marginTop: 8 }}>
          <p style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
            OwnProperly Ltd · ownproperly.com
          </p>
        </div>
      </div>
    </div>
  )
}
