import * as api from '../../lib/api'
import { canUseInvestorFeatures } from '../../lib/tierGating'
import { DealsPage } from './lazyViews'

// Deals view: investor-tier gate around DealsPage. Moved verbatim from
// App.jsx; every value it reads is passed in explicitly.
export function DealsView({
  user, companies, properties, showToast, activeFlags, companySubs, isPlatformAdmin,
  setDashboardDeals, convertRefreshKey, setEditProp, setConvertSourceDealId, setConvertSourceDeal,
  setShowAddProp,
}) {
  return (
    <div className="fade">
      <DealsPage user={user} companies={companies} properties={properties} showToast={showToast} activeFlags={activeFlags}
        canUseInvestor={canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin })}
        onDealsChange={setDashboardDeals}
        convertRefreshKey={convertRefreshKey}
        onConvertToProperty={(deal)=>{
          // Map deal fields to property fields so the user doesn't
          // have to retype everything. Fields without a clean 1:1
          // mapping (e.g. timeline dates, deal_type) are dropped —
          // they live on the deal record. The user just fills in
          // anything that's specific to the property going forward
          // (estimated value, rent, tenancy details).
          //
          // Computed fields:
          //   mortgage_amount = purchase * (1 - deposit_percent/100)
          //   deposit         = purchase * deposit_percent/100
          // Cash deals get mortgage_amount=0, deposit=full price.
          const num = (v) => Number(v) || 0
          const price = num(deal.purchase_price)
          const depPct = num(deal.deposit_percent) || 25
          const isCash = deal.purchase_type === 'cash'
          const mortgageAmount = isCash ? 0 : Math.round(price * (1 - depPct / 100))
          const depositAmount  = isCash ? price : Math.round(price * depPct / 100)
          // Stamp duty: the user's override if they set one, otherwise
          // the SDLT calculator on the deal's flags. (There is no
          // stamp_duty column on deals — the previous fallback read one
          // and silently converted every non-overridden deal with £0.)
          const sd = deal.stamp_duty_override != null
            ? num(deal.stamp_duty_override)
            : api.calcStampDuty(price, deal.is_additional_property, deal.is_first_time_buyer)
          const prefill = {
            // UI hint — lets PropertyModal start with the mortgage block
            // hidden for cash deals. Stripped before save (no column).
            is_cash:     isCash,
            // Identity
            name:        deal.name || deal.address || '',
            address:     deal.address || '',
            company_id:  deal.company_id || '',
            // Money
            purchase_price:  price || '',
            stamp_duty:      sd || '',
            legal_fees:      num(deal.legal_fees) || '',
            mortgage_amount: mortgageAmount || '',
            deposit:         depositAmount || '',
            // Mortgage terms
            mortgage_rate:   num(deal.mortgage_rate) || '',
            mortgage_term:   num(deal.mortgage_term) || 25,
            // Status: 'purchased' makes sense for a freshly converted
            // deal — the user will switch it to 'refurb' or 'rented'
            // once that phase begins.
            status:          'purchased',
            // Notes carry across — useful context for property
            notes:           deal.notes || '',
            // Source link — once we add a deal_id column on properties
            // this would be deal.id. For now we just store a
            // breadcrumb in notes if there isn't already a notes
            // value, so the user can find their way back to the deal.
            // Skipped to avoid clobbering — left as a TODO.
          }
          setEditProp(prefill)
          // Remember which deal this came from. Once the property is
          // saved we soft-delete this deal so it leaves the Deals page.
          setConvertSourceDealId(deal.id)
          setConvertSourceDeal(deal)
          setShowAddProp(true)
          showToast('Deal data pre-filled — review and save')
        }}/>
    </div>
  )
}
