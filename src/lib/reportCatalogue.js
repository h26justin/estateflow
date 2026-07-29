// The report catalogue lives here (not in ReportsPage.jsx) so lightweight
// consumers — the command palette needs ids + names — can import it without
// statically pulling the whole lazy-loaded ReportsPage chunk into the main
// bundle.
// Curated to 16 reports — May 2026. Removed 4 redundancies whose data
// is now folded into the surviving reports:
//   - "expiring_certs" → top section of Compliance
//   - "best_worst"     → Yield Comparison already ranks (and best_worst
//                        crashed at runtime on row colour logic)
//   - "open_jobs"      → top section of Maintenance Cost Report
//   - "portfolio_growth" → Equity Report covers same numbers more clearly
export const REPORT_CATALOGUE = [
  { id:'pnl',          cat:'tax',         icon:'pie-chart', name:'Annual P&L',                  desc:'Collected rent vs expenses, net profit per property — HMRC-ready' },
  { id:'income_sched', cat:'tax',         icon:'calendar', name:'Rental income schedule',       desc:'Month-by-month rent received — ideal for SA105' },
  { id:'expense_breakdown', cat:'tax',    icon:'receipt', name:'Expense breakdown',            desc:'All expenses by category, ready for your accountant' },
  { id:'mortgage_interest', cat:'tax',    icon:'landmark', name:'Mortgage interest summary',    desc:'Total interest paid per property — Section 24 tax credit' },
  { id:'capital_gains', cat:'tax',        icon:'trending-up', name:'Capital gains summary',        desc:'Purchase cost vs current value, unrealised gain per property' },
  { id:'yield_compare', cat:'performance',icon:'target', name:'Yield comparison',             desc:'Gross and net yield ranked across all properties' },
  { id:'occupancy',     cat:'performance',icon:'home', name:'Occupancy rate',               desc:'Portfolio occupancy %, vacant days, void cost by property' },
  { id:'rent_collect',  cat:'performance',icon:'pound', name:'Rent collection rate',         desc:'% collected on time, late and missed payments by property' },
  { id:'cashflow',      cat:'finance',    icon:'wallet', name:'Monthly cash flow',            desc:'Real monthly rent in, all costs out, net cash month-by-month' },
  { id:'equity',        cat:'finance',    icon:'building', name:'Equity report',                desc:'Property values, debt, equity, LTV and unrealised gain per property' },
  { id:'mortgage_port', cat:'finance',    icon:'file-text', name:'Mortgage portfolio',           desc:'All mortgages, rates, terms, monthly payments and LTV ratios' },
  { id:'arrears',       cat:'finance',    icon:'alert-triangle', name:'Arrears report',               desc:'Outstanding rent by property, amount and days overdue' },
  { id:'compliance',    cat:'compliance', icon:'shield-check', name:'Compliance status',            desc:'All certificates — expired, expiring soon, valid (RAG)' },
  { id:'tenancy_sched', cat:'compliance', icon:'clipboard-check', name:'Tenancy schedule',             desc:'All tenancies, start/end dates, notice periods, renewals' },
  { id:'maintenance_report',cat:'maintenance',icon:'wrench',name:'Maintenance overview',      desc:'Open jobs, total spend by property and trade' },
  { id:'contractor_spend',cat:'maintenance',icon:'users',name:'Contractor spend',            desc:'Total paid to each contractor, job counts, average cost' },
]

