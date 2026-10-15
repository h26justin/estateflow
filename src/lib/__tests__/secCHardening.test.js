// Pins the untrusted-text guards added on 15 Oct 2026: the invitation-email
// name sanitiser (send-invite) and the AI insight link allow-list
// (PortfolioInsightsWidget).
import { subjectSafe } from '../../../supabase-functions/send-invite/sanitise.ts'
import { safeInsightLink } from '../../components/PortfolioInsightsWidget.jsx'

describe('send-invite subjectSafe', () => {
  it('keeps ordinary names', () => {
    expect(subjectSafe('Acme Lettings Ltd', 'x')).toBe('Acme Lettings Ltd')
  })
  it('strips newlines and control characters', () => {
    expect(subjectSafe('Acme\r\nBcc: victim@example.com', 'x')).not.toMatch(/[\r\n]/)
  })
  it('strips URLs and bare domains', () => {
    const out = subjectSafe('Claim your refund at https://evil.example/pay or www.evil.test and paypa1.com/login', 'x')
    expect(out).not.toMatch(/https?:|www\.|evil|paypa1\.com/i)
  })
  it('caps length', () => {
    expect(subjectSafe('a'.repeat(500), 'x').length).toBeLessThanOrEqual(60)
    expect(subjectSafe('b'.repeat(500), 'x', 80).length).toBeLessThanOrEqual(80)
  })
  it('falls back when nothing is left', () => {
    expect(subjectSafe('https://evil.example', 'their company')).toBe('their company')
    expect(subjectSafe(null, 'A colleague')).toBe('A colleague')
  })
})

describe('PortfolioInsightsWidget safeInsightLink', () => {
  it('allows in-app hash routes', () => {
    expect(safeInsightLink('#/properties')).toBe('#/properties')
    expect(safeInsightLink('#/detail/0b6f1c2e-1234-4abc-9def-0123456789ab/compliance')).toBeTruthy()
  })
  it('rejects anything else', () => {
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '#javascript:alert(1)',
      '#/x?y=1', '#/x#y', '/properties', '', null, undefined, 42]) {
      expect(safeInsightLink(bad)).toBeNull()
    }
  })
})
