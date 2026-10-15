import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MtdItsaPage from '../MtdItsaPage'

vi.mock('../../lib/ThemeContext', () => ({
  useTheme: () => ({ T: { card: '#fff', bg: '#f6f6f4', border: '#ddd', muted: '#666', text: '#111', gold: '#b8860b', goldText: '#7a5a00', green: '#2e8b57', amber: '#d98e04', red: '#c0392b', blue: '#2563eb' } }),
}))
vi.mock('../../lib/ConfirmContext', () => ({ useConfirm: () => async () => true }))

const api = vi.hoisted(() => ({
  fetchMtdSettings: vi.fn(),
  fetchMtdSubmissions: vi.fn(),
  fetchMtdLiveStatus: vi.fn(),
  fetchMtdPropertyScope: vi.fn(),
}))
vi.mock('../../lib/api', () => api)

const settings = { nino: 'QQ123456C', mtd_business_id: 'XPIS0001', sandbox_mode: false, hmrc_access_token: 'x' }
const subs = [
  { id: 's1', quarter_number: 1, status: 'draft', summary_json: { totals: { income: 3000, expenses: 1000, net: 2000 } } },
  { id: 's2', quarter_number: 2, status: 'draft', summary_json: { totals: { income: 3000, expenses: 500, net: 2500 } } },
]

describe('MtdItsaPage', () => {
  beforeEach(() => {
    api.fetchMtdSettings.mockResolvedValue(settings)
    api.fetchMtdSubmissions.mockResolvedValue(subs)
    api.fetchMtdPropertyScope.mockResolvedValue(null)
  })

  it('says plainly when live HMRC filing is not switched on', async () => {
    api.fetchMtdLiveStatus.mockResolvedValue(false)
    render(<MtdItsaPage />)
    expect(await screen.findByText(/Live filing to HMRC isn.t switched on yet/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Rehearse (practice mode)' }).length).toBe(2)
    expect(screen.queryByRole('button', { name: 'Submit to HMRC' })).toBeNull()
  })

  it('offers real submission once live filing is on', async () => {
    api.fetchMtdLiveStatus.mockResolvedValue(true)
    render(<MtdItsaPage />)
    expect((await screen.findAllByRole('button', { name: 'Submit to HMRC' })).length).toBe(2)
    expect(screen.queryByText(/Live filing to HMRC isn.t switched on yet/)).toBeNull()
  })

  it('shows the year-end totals and final declaration deadline', async () => {
    api.fetchMtdLiveStatus.mockResolvedValue(false)
    render(<MtdItsaPage />)
    expect(await screen.findByText(/After the year ends: final declaration/)).toBeTruthy()
    expect(screen.getByText('2 of 4')).toBeTruthy()
    expect(screen.getByText(/31 January/)).toBeTruthy()
  })
})
