import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MtdItsaPage from '../MtdItsaPage'
import { buildQuarterAndYearToDate, currentTaxYear } from '../../lib/mtdItsa'

vi.mock('../../lib/ThemeContext', () => ({
  useTheme: () => ({ T: { card: '#fff', bg: '#f6f6f4', border: '#ddd', muted: '#666', text: '#111', gold: '#b8860b', goldText: '#7a5a00', green: '#2e8b57', amber: '#d98e04', red: '#c0392b', blue: '#2563eb' } }),
}))
const confirmSpy = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../lib/ConfirmContext', () => ({ useConfirm: () => confirmSpy }))

const api = vi.hoisted(() => ({
  fetchMtdSettings: vi.fn(),
  fetchMtdSubmissions: vi.fn(),
  fetchMtdLiveStatus: vi.fn(),
  fetchMtdPropertyScope: vi.fn(),
  fetchMtdRawForPeriod: vi.fn(),
  submitMtdQuarter: vi.fn(),
  upsertMtdSubmission: vi.fn(),
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

  describe('Submit to HMRC', () => {
    const raw = {
      payments: [{ id: 'r1', status: 'paid', amount: 1000, period_start: `${currentTaxYear().slice(0, 4)}-05-01` }],
      expenses: [], receipts: [], mortgageProps: [],
    }
    const current = () => buildQuarterAndYearToDate({ taxYear: currentTaxYear(), quarter: 1, ...raw })
    beforeEach(() => {
      confirmSpy.mockReset()
      api.fetchMtdLiveStatus.mockResolvedValue(true)
      api.fetchMtdRawForPeriod.mockResolvedValue(raw)
      api.submitMtdQuarter.mockReset().mockResolvedValue({ sandbox: false })
      api.upsertMtdSubmission.mockReset().mockResolvedValue({})
    })

    it('asks for confirmation, showing the figures and that it cannot be undone', async () => {
      api.fetchMtdSubmissions.mockResolvedValue([{ id: 's1', quarter_number: 1, status: 'draft', summary_json: current() }])
      confirmSpy.mockResolvedValueOnce(false)
      render(<MtdItsaPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Submit to HMRC' }))
      await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
      const opts = confirmSpy.mock.calls[0][0]
      expect(opts.title).toMatch(/Submit Quarter 1 to HMRC/)
      expect(opts.body).toMatch(/Income £1,000\.00/)
      expect(opts.body).toMatch(/cannot be undone/)
      expect(api.submitMtdQuarter).not.toHaveBeenCalled()
    })

    it('submits once confirmed', async () => {
      api.fetchMtdSubmissions.mockResolvedValue([{ id: 's1', quarter_number: 1, status: 'draft', summary_json: current() }])
      confirmSpy.mockResolvedValueOnce(true)
      render(<MtdItsaPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Submit to HMRC' }))
      await waitFor(() => expect(api.submitMtdQuarter).toHaveBeenCalledWith('s1'))
    })

    it('warns when the draft is out of date and offers to refresh it instead of submitting', async () => {
      const stale = { ...current(), income: { periodAmount: 400, taxDeducted: 0 } }
      api.fetchMtdSubmissions.mockResolvedValue([{ id: 's1', quarter_number: 1, status: 'draft', summary_json: stale }])
      confirmSpy.mockResolvedValueOnce(true)
      render(<MtdItsaPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Submit to HMRC' }))
      await waitFor(() => expect(api.upsertMtdSubmission).toHaveBeenCalled())
      expect(confirmSpy.mock.calls[0][0].confirmLabel).toBe('Refresh draft')
      expect(api.upsertMtdSubmission.mock.calls[0][0].summary_json).toEqual(current())
      expect(api.submitMtdQuarter).not.toHaveBeenCalled()
    })
  })
})
