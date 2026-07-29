import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'

const mono = MONO

// Terms of Service for OwnProperly Ltd.
// Drafted to satisfy:
//   - HMRC's production-credentials requirement (T&Cs URL must be live)
//   - UK Consumer Rights Act / B2B SaaS contract norms
//   - Disclosure of all third-party data flows (HMRC, Plaid, Xero, Stripe)
//   - Tax-filing liability boundary (we facilitate, customer responsible
//     for accuracy of submissions)
//
// Not a substitute for a solicitor's review before going live with paying
// customers at scale, but covers the standard SaaS bases.

export default function TermsOfService({ onBack }) {
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
          <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, marginBottom: 8, letterSpacing: '-0.02em' }}>Terms of Service</h1>
          <p style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>OwnProperly Ltd · Last updated: 24 May 2026</p>
        </div>

        <Section title="1. Who these terms apply to">
          These Terms of Service ("<B>Terms</B>") form a legal agreement between you ("<B>you</B>", "<B>your</B>") and <B>OwnProperly Ltd</B> ("<B>we</B>", "<B>us</B>", "<B>our</B>"), a company registered in England and Wales.
          <br/><br/>
          By creating an account, paying for a subscription, or otherwise using the OwnProperly platform (the "<B>Service</B>"), you agree to these Terms and our <B>Privacy Policy</B>. If you don't agree, please don't use the Service.
          <br/><br/>
          The Service is intended for use by UK landlords, property investors and their authorised representatives in the course of a business or trade. If you are signing up as an individual consumer rather than for a business, your statutory consumer rights are not affected by these Terms.
        </Section>

        <Section title="2. The Service">
          OwnProperly is a property portfolio management platform. Features include (but are not limited to): property records, rent tracking, expense logging, compliance reminders (gas / EICR / EPC), tenancy management, document storage, mortgage tracking, deals pipeline, inspections, maintenance, AI-assisted document field extraction, Making Tax Digital ITSA quarterly submissions, Open Banking integration, accounting sync to Xero, and tenant portals.
          <br/><br/>
          We continuously improve the Service. Features may be added, changed or removed. We will give you reasonable notice of any material reduction in features for a paid plan.
        </Section>

        <Section title="3. Account and security">
          You must provide accurate information when creating your account. You are responsible for keeping your password secure and for all activity that occurs under your account.
          <br/><br/>
          You must be at least 18 years old to create an account. You may not share your account credentials with anyone else — invite team members using the in-platform team access controls instead.
          <br/><br/>
          You must notify us promptly at <B>hello@ownproperly.com</B> if you suspect any unauthorised use of your account.
        </Section>

        <Section title="4. Subscription, pricing and payment">
          The Service is billed monthly via <B>Stripe</B>. Current pricing is published on our website. As of the date of these Terms:
          <br/><br/>
          — <B>Starter:</B> £2 per property per month (minimum £10 / month)<br/>
          — <B>Investor:</B> £5 per property per month (minimum £10 / month). Adds AI insights, deals pipeline and remortgage broker alerts.
          <br/><br/>
          A free trial period applies to new accounts (length shown at signup). Your card is charged automatically on each renewal date until you cancel. Cancelling stops future renewals — you retain access until the end of the current paid period.
          <br/><br/>
          We do not refund partial months unless required by law. If we materially increase your price, we will give you at least 30 days' notice and you may cancel before the new price applies.
          <br/><br/>
          We may suspend your access if payment fails and you do not update your payment method within a reasonable time after we notify you.
        </Section>

        <Section title="5. Your data and content">
          You retain ownership of all data you upload or enter into the Service (properties, tenants, documents, financial records — "<B>Your Content</B>"). You grant us a limited licence to host, process, transmit and display Your Content solely to provide the Service to you.
          <br/><br/>
          You can export all of Your Content at any time via <B>Settings → Backups → Export</B>. We also offer per-record export within the platform.
          <br/><br/>
          You are responsible for ensuring you have the legal right to upload tenant data, contractor data and any other personal data about third parties — including providing appropriate privacy notices to those individuals.
        </Section>

        <Section title="6. Acceptable use">
          You must not, and must not allow anyone else to:
          <br/><br/>
          — Use the Service for anything illegal, including processing income that is the proceeds of crime<br/>
          — Upload malware, attempt to compromise the Service, or interfere with other users<br/>
          — Attempt to circumvent rate limits, billing, access controls or row-level security<br/>
          — Resell or repackage the Service without our written agreement<br/>
          — Use the Service to spam, harass, defame or otherwise harm tenants, contractors or any third party<br/>
          — Reverse-engineer, decompile or extract source code other than as permitted by law
          <br/><br/>
          We may suspend or terminate accounts that violate these rules.
        </Section>

        <Section title="7. HMRC Making Tax Digital (MTD ITSA)">
          When you enable the MTD ITSA feature and authorise us via the HMRC OAuth flow, we file quarterly submissions to HMRC on your behalf based on the data you have entered or imported into the Service.
          <br/><br/>
          <B>You are responsible</B> for:
          <br/><br/>
          — The accuracy and completeness of the rental income and expense data underlying each submission<br/>
          — Reviewing each quarterly summary before clicking <B>Submit</B><br/>
          — Categorising expenses correctly for HMRC purposes<br/>
          — Meeting HMRC's quarterly deadlines (we display them in advance)<br/>
          — Filing any other returns that fall outside MTD ITSA (Final Declaration, Capital Gains, etc.)
          <br/><br/>
          <B>We are responsible</B> for:
          <br/><br/>
          — Maintaining the technical integration with HMRC's APIs<br/>
          — Submitting the data you approve in the format HMRC requires<br/>
          — Securely storing the OAuth tokens you grant us<br/>
          — Recording each submission and HMRC's response for your audit trail
          <br/><br/>
          We are <B>not</B> an authorised tax adviser or accountant. The Service is software — not advice. If you need tax advice, speak to a qualified accountant.
        </Section>

        <Section title="8. Open Banking and bank feeds">
          If you connect a bank account via the Plaid Open Banking integration:
          <br/><br/>
          — Plaid Financial Ltd is FCA-regulated and operates under PSD2 read-only consent. We never see or store your bank login.<br/>
          — Consent expires every 90 days under PSD2 — you'll need to re-authorise periodically.<br/>
          — Transaction matching is automated but not infallible. You should review auto-matched rent payments before relying on them.<br/>
          — Disconnecting Plaid stops further data sync but does not delete already-imported transactions from the Service.
        </Section>

        <Section title="9. Third-party integrations">
          The Service integrates with third parties (Stripe, HMRC, Plaid, Xero, Anthropic, Postmark, Mapbox, Supabase, Vercel). Each is subject to its own terms and privacy policy.
          <br/><br/>
          We are not responsible for the availability, accuracy or actions of third-party services. If a third party experiences an outage that interrupts a feature, we will work to restore it but cannot guarantee continuous service for that feature.
        </Section>

        <Section title="10. Availability and support">
          We aim for high availability but do not currently offer a contractual uptime SLA. We may carry out maintenance with reasonable notice (typically out of business hours). Support is provided via email at <B>hello@ownproperly.com</B>. We aim to respond to all enquiries within two business days.
        </Section>

        <Section title="11. Limitation of liability">
          To the maximum extent permitted by law:
          <br/><br/>
          — Nothing in these Terms limits our liability for death or personal injury caused by our negligence, for fraud, or for any other liability that cannot be excluded by English law.<br/>
          — We are not liable for loss of profits, loss of business, loss of anticipated savings, loss of goodwill, or any indirect or consequential loss.<br/>
          — Our total aggregate liability to you for any claim arising out of or in connection with the Service, whether in contract, tort (including negligence) or otherwise, is capped at the total fees you have paid us in the <B>twelve months</B> immediately preceding the event giving rise to the claim.<br/>
          — We make no warranty that the Service will be uninterrupted or error-free, that defects will be corrected, or that the Service will meet your specific requirements.
          <br/><br/>
          You acknowledge that the Service is a tool — final responsibility for tax filings, tenancy compliance, rent collection and portfolio decisions rests with you.
        </Section>

        <Section title="12. Indemnity">
          You agree to indemnify and hold harmless OwnProperly Ltd and its officers from any claim, loss, liability or expense (including reasonable legal fees) arising from:
          <br/><br/>
          — Your breach of these Terms<br/>
          — Your unlawful use of the Service<br/>
          — Inaccurate or misleading data you submit to HMRC via the Service<br/>
          — Your failure to provide required privacy notices to tenants or other individuals whose data you upload
        </Section>

        <Section title="13. Termination">
          Either party may terminate at any time. <B>You</B> may cancel from <B>Settings → Billing</B>. <B>We</B> may suspend or terminate your account for material breach of these Terms (e.g. non-payment, abuse), with reasonable notice where practical.
          <br/><br/>
          On termination:
          <br/><br/>
          — You lose access to the Service at the end of the current paid period (or immediately for breach-based termination)<br/>
          — You can export your data for 30 days after termination<br/>
          — We then delete your account in line with our Privacy Policy (some financial records retained for 7 years for HMRC compliance)
        </Section>

        <Section title="14. Changes to the Service or these Terms">
          We may modify the Service or these Terms. Material changes that disadvantage you will be notified by email and an in-app notice at least <B>30 days</B> before they take effect. Continued use after the effective date constitutes acceptance. If you don't accept a material change, you may cancel before it takes effect.
        </Section>

        <Section title="15. Intellectual property">
          We retain all intellectual property rights in the Service itself — the software, design, branding, documentation and trademarks. These Terms grant you a non-exclusive, non-transferable right to use the Service in accordance with these Terms.
          <br/><br/>
          You retain all rights in Your Content.
        </Section>

        <Section title="16. Confidentiality">
          We treat your business information as confidential and use it only to provide and improve the Service. You will treat any non-public information about the Service or our business as confidential and not disclose it to third parties without our consent.
        </Section>

        <Section title="17. Governing law and jurisdiction">
          These Terms are governed by the laws of <B>England and Wales</B>. Any dispute will be subject to the exclusive jurisdiction of the courts of England and Wales, except that we may bring proceedings in any jurisdiction where you are based for the purpose of enforcing payment.
        </Section>

        <Section title="18. Entire agreement and severability">
          These Terms (together with the Privacy Policy and any order form or pricing page you accept at signup) constitute the entire agreement between you and us regarding the Service. If any provision is found to be unenforceable, the remaining provisions remain in full force.
        </Section>

        <Section title="19. Contact">
          Questions about these Terms? Email <B>hello@ownproperly.com</B>.
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
