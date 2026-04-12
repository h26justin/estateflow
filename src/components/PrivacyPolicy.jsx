import { useTheme } from '../lib/ThemeContext'

const mono = "'DM Mono',monospace"

export default function PrivacyPolicy({ onBack }) {
  const { T } = useTheme()

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 12, letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ fontFamily: mono, fontSize: 13, color: T.muted, lineHeight: 2 }}>{children}</div>
    </div>
  )

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
          <p style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>OwnProperly Ltd · Last updated: April 2026</p>
        </div>

        <Section title="1. Who we are">
          OwnProperly is a property portfolio management platform operated by OwnProperly Ltd.
          Our platform helps UK landlords and property investors manage their portfolios, compliance, maintenance, tenancies and finances.
          <br/><br/>
          If you have any questions about this policy, please contact us at <strong style={{ color: T.text }}>hello@ownproperly.com</strong>
        </Section>

        <Section title="2. What data we collect">
          We collect the following categories of personal data:
          <br/><br/>
          <strong style={{ color: T.text }}>Account data:</strong> Your email address, name and password when you create an account.
          <br/><br/>
          <strong style={{ color: T.text }}>Property data:</strong> Property addresses, purchase prices, rental income, mortgage details and compliance information that you enter into the platform.
          <br/><br/>
          <strong style={{ color: T.text }}>Tenant data:</strong> Tenant names, contact details and tenancy information that you record against your properties.
          <br/><br/>
          <strong style={{ color: T.text }}>Financial data:</strong> Rent payment records, expense records and deal analysis data.
          <br/><br/>
          <strong style={{ color: T.text }}>Usage data:</strong> Log data including actions taken within the platform, timestamps and IP addresses for security purposes.
          <br/><br/>
          <strong style={{ color: T.text }}>Payment data:</strong> Subscription payment information is handled by Stripe. We do not store your card details.
        </Section>

        <Section title="3. How we use your data">
          We use your data to:
          <br/><br/>
          — Provide and operate the OwnProperly platform<br/>
          — Send you service notifications (compliance alerts, rent reminders, weekly digests)<br/>
          — Process your subscription payments via Stripe<br/>
          — Provide customer support<br/>
          — Improve the platform based on usage patterns<br/>
          — Comply with our legal obligations<br/>
          — Send you important updates about the service
        </Section>

        <Section title="4. Legal basis for processing (GDPR)">
          We process your personal data under the following legal bases:
          <br/><br/>
          <strong style={{ color: T.text }}>Contract:</strong> Processing necessary to provide the service you have subscribed to.
          <br/><br/>
          <strong style={{ color: T.text }}>Legitimate interests:</strong> Security monitoring, fraud prevention and platform improvement.
          <br/><br/>
          <strong style={{ color: T.text }}>Legal obligation:</strong> Where we are required to retain or process data by law.
          <br/><br/>
          <strong style={{ color: T.text }}>Consent:</strong> For marketing communications — you can withdraw consent at any time.
        </Section>

        <Section title="5. Data storage and security">
          Your data is stored securely in the European Union using Supabase (PostgreSQL), hosted on AWS infrastructure.
          <br/><br/>
          We implement the following security measures:
          <br/><br/>
          — Row-level security ensuring users can only access their own data<br/>
          — Encrypted data transmission (HTTPS/TLS)<br/>
          — Secure authentication via Supabase Auth<br/>
          — Regular automated database backups<br/>
          — Audit logging of all significant platform actions
        </Section>

        <Section title="6. Data sharing">
          We do not sell your personal data. We share data only with:
          <br/><br/>
          <strong style={{ color: T.text }}>Supabase:</strong> Database and authentication infrastructure provider.
          <br/><br/>
          <strong style={{ color: T.text }}>Stripe:</strong> Payment processing. Subject to Stripe's privacy policy.
          <br/><br/>
          <strong style={{ color: T.text }}>Resend:</strong> Email delivery service for notifications and alerts.
          <br/><br/>
          <strong style={{ color: T.text }}>Vercel:</strong> Platform hosting and content delivery.
          <br/><br/>
          All third-party processors are GDPR-compliant and process data only on our instructions.
        </Section>

        <Section title="7. Data retention">
          We retain your data for as long as your account is active. If you close your account:
          <br/><br/>
          — Your account and personal profile are deleted within 30 days<br/>
          — Property and financial records are retained for 7 years to comply with HMRC requirements<br/>
          — Backup copies may be retained for up to 90 days<br/>
          — Anonymised usage data may be retained indefinitely
        </Section>

        <Section title="8. Your rights (GDPR)">
          Under GDPR you have the following rights:
          <br/><br/>
          <strong style={{ color: T.text }}>Right of access:</strong> Request a copy of all personal data we hold about you. Use the Data Export function in Settings → Account.
          <br/><br/>
          <strong style={{ color: T.text }}>Right to rectification:</strong> Correct any inaccurate data — you can update most data directly within the platform.
          <br/><br/>
          <strong style={{ color: T.text }}>Right to erasure:</strong> Request deletion of your account and personal data. Contact hello@ownproperly.com.
          <br/><br/>
          <strong style={{ color: T.text }}>Right to portability:</strong> Download all your data in a machine-readable format using the Data Export function.
          <br/><br/>
          <strong style={{ color: T.text }}>Right to object:</strong> Object to processing based on legitimate interests.
          <br/><br/>
          <strong style={{ color: T.text }}>Right to restrict processing:</strong> Request that we limit how we use your data.
          <br/><br/>
          To exercise any of these rights, contact <strong style={{ color: T.text }}>hello@ownproperly.com</strong>. We will respond within 30 days.
        </Section>

        <Section title="9. Cookies">
          OwnProperly uses only essential cookies required for authentication and session management.
          We do not use tracking cookies or advertising cookies. No cookie consent banner is required.
        </Section>

        <Section title="10. Children">
          OwnProperly is not intended for use by anyone under the age of 18. We do not knowingly collect data from minors.
        </Section>

        <Section title="11. Changes to this policy">
          We may update this policy from time to time. We will notify you of significant changes by email and by displaying a notice in the platform.
          Continued use of the platform after changes constitutes acceptance of the updated policy.
        </Section>

        <Section title="12. Complaints">
          If you are unhappy with how we handle your data, you have the right to lodge a complaint with the Information Commissioner's Office (ICO) at ico.org.uk.
          <br/><br/>
          We would appreciate the opportunity to resolve any concern directly first — please contact us at <strong style={{ color: T.text }}>hello@ownproperly.com</strong>
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
