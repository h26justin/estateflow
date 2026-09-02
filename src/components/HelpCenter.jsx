import { useState, useMemo } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'

const CATEGORIES = [
  { key: 'start',       label: 'Getting Started',      icon: 'sparkle' },
  { key: 'properties',  label: 'Properties',            icon: 'home' },
  { key: 'companies',   label: 'Companies',             icon: 'grid' },
  { key: 'rent',        label: 'Rent Tracker',          icon: 'pound' },
  { key: 'compliance',  label: 'Compliance',            icon: 'shield-check' },
  { key: 'tenancy',     label: 'Tenancy & Legal',       icon: 'scale' },
  { key: 'maintenance', label: 'Maintenance',           icon: 'wrench' },
  { key: 'documents',   label: 'Documents & Expenses',  icon: 'folder' },
  { key: 'deals',       label: 'Deals & Calculator',    icon: '🎯' },
  { key: 'lettings',    label: 'Lettings Pipeline',     icon: 'key' },
  { key: 'reports',     label: 'Reports',               icon: 'pie-chart' },
  { key: 'portal',      label: 'Tenant Portal',         icon: 'home' },
  { key: 'settings',    label: 'Settings & Account',    icon: '⚙' },
  { key: 'ai',          label: 'AI Tools',              icon: 'sparkle' },
]

const GUIDES = [
  // ── GETTING STARTED ──────────────────────────────────────────────────────
  { id: 1, cat: 'start', title: 'Creating your account & first login', tags: ['account','signup','login'],
    steps: [
      "Go to www.ownproperly.com and click \"Start free trial\".",
      "Enter your email address and choose a password (at least 8 characters).",
      "Check your inbox for a confirmation email and click the verification link.",
      "Once verified, sign in with your email and password.",
      "You will land on the Dashboard. The getting started tour will launch automatically to walk you through the key features.",
      "Your 14-day free trial is now active \u2014 no card required.",
    ]},
  { id: 2, cat: 'start', title: 'Adding your first company', tags: ['company','create','setup'],
    steps: [
      "Navigate to Portfolio using the top navigation bar.",
      "Switch to the Companies tab using the sub-navigation (Properties / Companies / Contractors).",
      "Click the \"+ Add Company\" button in the top-right corner.",
      "Enter the company name (e.g. \"Vale Property Group\") and a short code (3\u20134 letters, e.g. \"VPG\").",
      "Choose a colour for the company \u2014 this will be used throughout the app and on PDF reports.",
      "Click \"Add Company\" to save. Your new company will appear in the company tabs.",
    ]},
  { id: 3, cat: 'start', title: 'Adding your first property', tags: ['property','create','setup'],
    steps: [
      "Navigate to Portfolio and stay on the Properties tab.",
      "Click \"+ Add Property\" in the top-right corner.",
      "Fill in the required fields: Property Name, Company (select from dropdown), and Full Address.",
      "Add optional details: property type, purchase price, estimated value, refurb cost, mortgage amount, monthly rent, stamp duty, and legal fees.",
      "Set the property status: Purchased, Refurb, Rented, or Vacant.",
      "Click \"Add Property\" to save. Your property now appears in the portfolio and all stats update automatically.",
    ]},
  { id: 4, cat: 'start', title: 'Understanding the dashboard & smart alerts', tags: ['dashboard','alerts','overview'],
    steps: [
      "The Dashboard is your home screen \u2014 it shows key portfolio metrics at a glance.",
      "Smart Alerts appear at the top: overdue compliance certificates, rent arrears, expiring tenancies, and vacant properties.",
      "Click any alert to jump directly to the relevant property or section.",
      "Below the alerts you will see portfolio-wide stats: total properties, monthly rent, occupancy rate, and arrears.",
      "The dashboard updates in real time as you add data. All figures respect your company filter if you have one set on the Portfolio Overview page.",
    ]},
  { id: 5, cat: 'start', title: 'Setting up your profile', tags: ['profile','name','phone','email'],
    steps: [
      "Go to Settings (cog icon in the navigation bar).",
      "You will land on the Profile tab by default.",
      "Enter your full name and phone number.",
      "Click \"Save Profile\" to save your changes.",
      "Your email address is shown but cannot be changed here \u2014 use the Security & Data tab to update it.",
      "You can also replay the app tour from this tab at any time by clicking the \"Replay tour\" button.",
    ]},
  { id: 6, cat: 'start', title: 'Customising your navigation tabs', tags: ['nav','navigation','tabs','customise'],
    steps: [
      "Go to Settings and click the Navigation tab.",
      "You will see a list of optional sections: Companies, Rent Tracker, Deals, Reports, and Contractors.",
      "Toggle each section on or off. Dashboard, Properties, and Settings are always shown and cannot be hidden.",
      "Changes save automatically. Your navigation bar will update immediately.",
      "This is useful if you do not use certain features \u2014 hide them to keep the interface clean.",
    ]},

  // ── PROPERTIES ───────────────────────────────────────────────────────────
  { id: 7, cat: 'properties', title: 'Adding a property', tags: ['property','add','create','new'],
    steps: [
      "Navigate to Portfolio > Properties tab.",
      "Click \"+ Add Property\" in the top-right corner.",
      "Enter the property name (e.g. \"Flat 1, Station Road\"), select the company it belongs to, and add the full address.",
      "Fill in financial details: purchase price, estimated value, refurb cost, mortgage amount and rate, stamp duty, and legal fees.",
      "Set the monthly rent, rent due day, and arrears (if any).",
      "Choose the property status and click \"Add Property\" to save.",
      "Tip: If you are viewing a specific company on the Companies tab and click Add Property, the company will be pre-selected for you.",
    ]},
  { id: 8, cat: 'properties', title: 'Editing property details', tags: ['property','edit','update','change'],
    steps: [
      "Navigate to Portfolio > Properties and click on the property you want to edit.",
      "On the property detail page, click the \"Edit\" button in the top-right area.",
      "The edit modal will open with all current values pre-filled.",
      "Change any field: name, address, company, status, financial details, rent, mortgage, or notes.",
      "Click \"Save Changes\" to update. All related stats (yield, invested totals, etc.) will recalculate automatically.",
    ]},
  { id: 9, cat: 'properties', title: 'Updating mortgage amount & rate', tags: ['mortgage','rate','update','remortgage'],
    steps: [
      "Open the property you want to update and click \"Edit\".",
      "Find the \"Mortgage Amount\" field and enter the new outstanding balance.",
      "Find the \"Mortgage Rate\" field and enter the new annual interest rate as a percentage (e.g. 5.5 for 5.5%).",
      "The mortgage term field is used for repayment calculations \u2014 update this if you have remortgaged to a new term.",
      "Click \"Save Changes\". The property detail page will show updated monthly mortgage costs and profit figures.",
      "Tip: After a remortgage, also update the Deposit field if you released or added equity.",
    ]},
  { id: 10, cat: 'properties', title: 'Changing property status', tags: ['status','purchased','rented','vacant','refurb'],
    steps: [
      "Open the property and click \"Edit\".",
      "Find the \"Status\" dropdown. Options are: Purchased, Refurb, Rented, and Vacant.",
      "Select the new status and click \"Save Changes\".",
      "Status affects how the property appears across the app: Rented properties count toward rental income, Vacant properties trigger alerts, and Refurb properties appear in refurbishment tracking.",
      "The rent calendar will show \"refurb\" or \"void\" markers based on the status you set.",
    ]},
  { id: 11, cat: 'properties', title: 'Understanding the property detail page', tags: ['property','detail','overview','tabs'],
    steps: [
      "Click on any property from the Properties list to open its detail page.",
      "The top section shows key financials: purchase price, refurb cost, total invested, estimated value, gross yield, and monthly profit.",
      "Below that you will find tabs for different aspects of the property: Overview, Financials, Compliance, Tenancy, Maintenance, Documents, Expenses, and Rent History.",
      "Each tab contains specialised tools for managing that aspect of the property.",
      "The health score badge in the top-right gives an at-a-glance indicator of how well-managed the property is.",
    ]},
  { id: 12, cat: 'properties', title: 'Understanding the health score badge', tags: ['health','score','badge','rating'],
    steps: [
      "Every property has a health score from 0 to 100, shown as a coloured badge.",
      "The score is calculated from: compliance certificate status (are they all in date?), tenancy details (is there a valid tenancy?), rent arrears, and maintenance job status.",
      "Green (80\u2013100): Well-managed. Amber (50\u201379): Needs attention. Red (0\u201349): Urgent issues.",
      "Click the badge to see a breakdown of what is affecting the score.",
      "Improving the score is simple: update expired certificates, clear arrears, complete maintenance jobs, and keep tenancy details current.",
    ]},
  { id: 13, cat: 'properties', title: 'Sorting & filtering properties', tags: ['sort','filter','search','find'],
    steps: [
      "On the Properties tab, use the search box to find properties by name or address.",
      "Use the company filter pills (AH, ALIC, EXH, etc.) to show only properties from one company.",
      "Use the status filter pills (All Status, Rented, Vacant, Purchased, Refurbing) to filter by property status.",
      "The Sort By row lets you order properties by: Company/Name, Name A\u2013Z, Status, Rent (High\u2013Low), Yield (High\u2013Low), Arrears, Value (High\u2013Low), or Custom Order.",
      "Custom Order lets you drag properties into your preferred order, which is saved per user.",
    ]},
  { id: 14, cat: 'properties', title: 'Deleting a property', tags: ['property','delete','remove'],
    steps: [
      "Open the property you want to delete by clicking on it from the Properties list.",
      "Scroll down to find the delete option on the property detail page.",
      "Click \"Delete Property\". A confirmation modal will appear.",
      "Enter your account password to confirm the deletion. This is a security step to prevent accidental deletions.",
      "Click \"Permanently delete\". The property and all its related data (compliance, rent payments, documents, etc.) will be removed.",
      "Warning: This action cannot be undone. Consider exporting your data first via Reports if you need a record.",
    ]},

  // ── COMPANIES ────────────────────────────────────────────────────────────
  { id: 15, cat: 'companies', title: 'Creating a company', tags: ['company','create','add','new'],
    steps: [
      "Go to Portfolio > Companies tab.",
      "Click \"+ Add Company\" in the top-right.",
      "Enter the company name exactly as it appears on your incorporation documents (e.g. \"EXH Property Group Limited\").",
      "Enter a short code (3\u20134 letters) which will be used as a compact label throughout the app.",
      "Select a colour \u2014 this is used for company badges, chart colours, property borders, and PDF report headers.",
      "Click \"Add Company\" to save.",
    ]},
  { id: 16, cat: 'companies', title: 'Renaming a company', tags: ['company','rename','name','change'],
    steps: [
      "Go to Portfolio > Companies and select the company you want to rename.",
      "Click the \"Rename\" button next to the company name.",
      "A modal will appear with the current name and abbreviation pre-filled.",
      "Edit the name and/or abbreviation as needed.",
      "Enter your password to confirm the change (security step).",
      "Click \"Save new name\". The change is reflected everywhere immediately.",
    ]},
  { id: 17, cat: 'companies', title: 'Changing company colour', tags: ['company','colour','color','branding'],
    steps: [
      "Go to Settings > Branding & Logos.",
      "Select the company you want to update using the company selector at the top.",
      "In the \"Report colour\" section, either click one of the 10 preset swatches or use the custom colour picker.",
      "You can also type a hex colour code directly (e.g. #4B8FE0).",
      "The colour saves automatically and updates everywhere: property cards, company badges, PDF reports, and charts.",
    ]},
  { id: 18, cat: 'companies', title: 'Understanding multi-company structure', tags: ['company','structure','spv','limited'],
    steps: [
      "Many UK landlords hold properties through multiple companies (SPVs) for tax efficiency, liability protection, or portfolio separation.",
      "Properly lets you create one company per legal entity. Each company has its own properties, compliance, rent tracking, and reports.",
      "Reports can be filtered by company, so you can generate P&L reports per company for your accountant.",
      "The Portfolio Overview page shows all companies together, with filters to drill into one at a time.",
      "Each company can have its own logo, colour, and branding for professional PDF report exports.",
    ]},
  { id: 19, cat: 'companies', title: 'Moving a property between companies', tags: ['property','move','transfer','company'],
    steps: [
      "Open the property you want to move and click \"Edit\".",
      "In the \"Company\" dropdown, select the new company you want to assign this property to.",
      "Click \"Save Changes\".",
      "The property will now appear under the new company in all views: Portfolio, Rent Tracker, Reports, and Compliance.",
      "All historical data (rent payments, compliance records, documents) stays with the property \u2014 nothing is lost.",
    ]},

  // ── RENT TRACKER ─────────────────────────────────────────────────────────
  { id: 20, cat: 'rent', title: 'Understanding the rent calendar', tags: ['rent','calendar','tracker','overview'],
    steps: [
      "Navigate to Rent Tracker from the top navigation bar.",
      "The main view shows a calendar grid for each company: rows are properties, columns are months.",
      "Each cell is colour-coded: Green = Paid, Red = Missed, Amber = Late, Blue = Refurb, Grey = Void.",
      "Click any cell to change its status. The year filter at the top lets you switch between years.",
      "Click on a company header to collapse or expand that company section.",
    ]},
  { id: 21, cat: 'rent', title: 'Marking rent as paid, missed or late', tags: ['rent','paid','missed','late','status'],
    steps: [
      "On the Rent Tracker page, find the property and month you want to update.",
      "Click the cell for that month. A popup will appear with status options: Paid, Missed, Late, Refurb, or Void.",
      "Select the appropriate status. The cell colour will change immediately.",
      "The income totals at the bottom of each company section will update to reflect the change.",
      "Tip: Use the Day View for more granular daily rent tracking instead of monthly.",
    ]},
  { id: 22, cat: 'rent', title: 'Using the day view', tags: ['rent','day','daily','calendar'],
    steps: [
      "On the Rent Tracker page, click the \"Day view\" button in the top-right.",
      "The day view shows a detailed daily calendar for each property.",
      "You can see exactly which days rent was paid and identify gaps.",
      "Click \"Back\" to return to the standard monthly view.",
    ]},
  { id: 23, cat: 'rent', title: 'Importing PNE agent statements', tags: ['rent','import','statement','pne','agent'],
    steps: [
      "Navigate to the Rent Tracker page or the property detail Rent History tab.",
      "Click the statement import button (or access via the Dashboard import option).",
      "Upload a PNE statement PDF. The parser will automatically extract rent payments, management fees, and tenant names.",
      "Review the preview: each line item shows the property name from the statement, matched property, amount, and tenant.",
      "If a property is not matched correctly, use the dropdown to select the correct property from your portfolio.",
      "Uncheck any items you do not want to import.",
      "Click \"Confirm Import\" to log all selected items as rent payments.",
    ]},
  { id: 24, cat: 'rent', title: 'Importing RMS agent statements', tags: ['rent','import','statement','rms','rook'],
    steps: [
      "Navigate to the Rent Tracker page or property detail.",
      "Click the statement import button and upload an RMS (Rook Matthews Sayer) statement PDF.",
      "The parser extracts rent received, management fees (including VAT), and maintenance costs.",
      "Review the preview carefully. RMS statements often include maintenance invoices \u2014 these will appear separately from rent items.",
      "Correct any property matches using the dropdown if needed.",
      "Click \"Confirm Import\" to log everything.",
    ]},
  { id: 25, cat: 'rent', title: 'Viewing rent history for a property', tags: ['rent','history','property','payments'],
    steps: [
      "Click on any property from the Properties list to open its detail page.",
      "Switch to the \"Rent History\" tab.",
      "You will see a timeline of all rent payments recorded for this property: dates, amounts, status, and source (manual or statement import).",
      "Use this view to identify patterns \u2014 late payments, missed months, or rent increases over time.",
    ]},
  { id: 73, cat: 'rent', title: 'Short-Term Let Income (Hostaway bookings)', tags: ['rent','stl','short-term','airbnb','hostaway','booking','occupancy','refund'],
    steps: [
      "Open Short-Term Let Income from the Money section of the navigation (switch it on in Settings → Navigation if you cannot see it).",
      "It covers every property whose status is Short-Term Let and shows bookings synced from Hostaway (or Lodgify), by check-in month.",
      "Figures are GROSS booking values: what the guest paid, before the channel's commission. They are not net payouts.",
      "Record refunds, chargebacks, fees and payout differences with \"Add adjustment\". Refunds are entered as a negative amount and reduce Net; Gross never changes.",
      "Occupancy is nights sold divided by rooms × days in the period. It needs each property's Hostaway listings mapped so the room count is known.",
      "Short-term let income is excluded from the residential rent collection rate on the Rent Tracker, so an unbooked week never shows as missed rent.",
    ]},
  { id: 26, cat: 'rent', title: 'Using the rent review planner', tags: ['rent','review','increase','planner','model'],
    steps: [
      "On the Rent Tracker page, click \"Plan rent review\" (the green button in the top-right).",
      "A full-screen modal opens showing all your rented properties.",
      "Use the slider to set a global rent change from -10% to +10%. Preset pills (CPI, CPIH, 5%, etc.) are available for quick selection.",
      "The summary bar at the top updates in real time: current monthly vs new monthly, monthly and annual change, and yield impact.",
      "Use the Scope filter to model changes for all properties, rented only, or a specific company.",
      "Click \"Show overrides\" to set individual percentages per property using per-row sliders.",
      "Tenancy badges show which properties are free to change (green) vs locked in a fixed term (red).",
      "Click \"Export PDF\" to download a professional scenario report for your records or to share with an advisor.",
    ]},

  // ── COMPLIANCE ───────────────────────────────────────────────────────────
  { id: 27, cat: 'compliance', title: 'Adding a compliance certificate', tags: ['compliance','certificate','add','gas','epc','eicr'],
    steps: [
      "Open the property and switch to the Compliance tab.",
      "Click \"+ Add Certificate\" or the relevant certificate type button.",
      "Select the certificate type: Gas Safety, EICR, EPC, HMO Licence, Legionella, PAT Testing, Fire Safety, or Other.",
      "Enter the issue date and expiry date.",
      "Optionally add the certificate number, provider/contractor name, and upload a copy of the certificate.",
      "Click \"Save\". The certificate will appear in the property compliance timeline and will trigger alerts as the expiry date approaches.",
    ]},
  { id: 28, cat: 'compliance', title: 'Setting expiry dates & understanding alerts', tags: ['compliance','expiry','alert','reminder'],
    steps: [
      "When adding or editing a compliance certificate, always set the expiry date accurately.",
      "Properly generates alerts at these intervals: 90 days before expiry (amber), 30 days before (red), and on the expiry date itself.",
      "Alerts appear on the Dashboard in the Smart Alerts panel and contribute to the property health score.",
      "To stop receiving alerts for a specific certificate, update it with a new expiry date once renewed.",
      "You can control which alert types appear in Settings > Notifications.",
    ]},
  { id: 29, cat: 'compliance', title: 'Gas safety, EICR & EPC explained', tags: ['compliance','gas','eicr','epc','legal'],
    steps: [
      "Gas Safety Certificate (CP12): Required annually for all properties with gas appliances. Must be carried out by a Gas Safe registered engineer. You must give a copy to tenants within 28 days.",
      "EICR (Electrical Installation Condition Report): Required every 5 years for rented properties. Must be carried out by a qualified electrician. Any C1 (danger present) or C2 (potentially dangerous) issues must be remediated within 28 days.",
      "EPC (Energy Performance Certificate): Required when letting a property. Must be rated E or above (with some exemptions). Valid for 10 years. The government plans to require a C rating for new tenancies from 2030.",
      "Track all three in the Compliance tab of each property. Set expiry dates and Properly will alert you before they are due.",
    ]},
  { id: 30, cat: 'compliance', title: 'HMO licensing requirements', tags: ['compliance','hmo','licence','licensing'],
    steps: [
      "A House in Multiple Occupation (HMO) is a property rented to 3 or more tenants forming 2 or more households who share facilities.",
      "Mandatory HMO licensing applies to properties with 5 or more tenants. Many councils also require additional licensing for smaller HMOs.",
      "Check your local council website for their specific licensing requirements.",
      "In Properly, add the HMO licence as a compliance certificate with the licence number and expiry date.",
      "HMO licences typically last 5 years. Operating without one when required can result in fines of up to \u00a330,000.",
    ]},
  { id: 31, cat: 'compliance', title: 'Tracking multiple certificates per property', tags: ['compliance','multiple','certificates','manage'],
    steps: [
      "Each property can have multiple compliance certificates of different types.",
      "Open the property Compliance tab to see all certificates in a timeline view.",
      "Certificates are sorted by expiry date, with the most urgent at the top.",
      "Expired or soon-to-expire certificates are highlighted in red or amber.",
      "When you renew a certificate, add a new entry rather than editing the old one \u2014 this maintains a full audit trail.",
    ]},

  // ── TENANCY & LEGAL ──────────────────────────────────────────────────────
  { id: 32, cat: 'tenancy', title: 'Adding tenant details', tags: ['tenant','add','tenancy','details'],
    steps: [
      "Open the property and switch to the Tenancy tab.",
      "Click \"Edit Tenancy\" or \"Add Tenancy Details\".",
      "Enter the tenant name(s), contact phone number, and email address.",
      "Set the tenancy start date, end date, rent amount, and deposit amount.",
      "Add the deposit scheme and reference number if applicable.",
      "Click \"Save\". The tenancy details will appear on the property overview and trigger renewal alerts as the end date approaches.",
    ]},
  { id: 33, cat: 'tenancy', title: 'Setting up deposit protection', tags: ['deposit','protection','scheme','dps','tds'],
    steps: [
      "You must protect the deposit within 30 days of receiving it and serve prescribed information to the tenant.",
      "In the Tenancy tab, find the deposit section and select your scheme: DPS, TDS, mydeposits, or DPS Custodial.",
      "Enter the deposit amount and scheme reference number.",
      "Upload a copy of the deposit certificate if you have one.",
      "Properly will track this alongside the tenancy. Failure to protect a deposit can result in penalties of 1\u20133x the deposit amount and prevents you from serving a valid Section 21 notice.",
    ]},
  { id: 34, cat: 'tenancy', title: 'Running a right to rent check', tags: ['right','rent','check','immigration'],
    steps: [
      "Open the property and switch to the Right to Rent tab.",
      "Click \"+ New Check\" to start a new right to rent verification.",
      "Select the document type: Passport, BRP, Visa, Online Share Code, EU Settlement Status, or Other.",
      "Enter the document reference, expiry date, and date the check was performed.",
      "Upload a copy of the document for your records.",
      "You must check every adult tenant before the tenancy starts. Follow-up checks are required for time-limited immigration status (usually 12 months before expiry).",
      "Penalties for failure: up to \u00a310,000 per tenant for a first offence.",
    ]},
  { id: 35, cat: 'tenancy', title: 'Tenancy renewal alerts', tags: ['tenancy','renewal','expiry','alert'],
    steps: [
      "When you set a tenancy end date, Properly automatically generates alerts as the date approaches.",
      "Alerts appear on the Dashboard: 90 days before (plan ahead), 30 days before (action needed), and on the date itself.",
      "Use these alerts to decide whether to: renew the tenancy (new fixed term), let it roll to periodic (month by month), or serve notice and relet.",
      "Update the tenancy end date after renewal to reset the alert cycle.",
    ]},
  { id: 36, cat: 'tenancy', title: 'Serving a Section 21 notice', tags: ['section','21','notice','eviction','possession'],
    steps: [
      "A Section 21 notice is a no-fault possession notice giving tenants at least 2 months to vacate.",
      "Before serving, ensure all prerequisites are met: deposit protected and prescribed info served, gas safety certificate given, EPC provided, How to Rent guide given, and no retaliatory eviction issues.",
      "In the Notice Tracker tab, click \"+ New Notice\" and select \"Section 21\".",
      "Enter the date served and the date you want possession (at least 2 months from service).",
      "Track the status through: Draft, Served, Court Filed, Hearing Set, Possession Granted, or Withdrawn.",
      "Important: The Renters Reform Bill proposes to abolish Section 21 \u2014 check current legislation.",
    ]},
  { id: 37, cat: 'tenancy', title: 'Serving a Section 8 notice', tags: ['section','8','notice','grounds','possession'],
    steps: [
      "A Section 8 notice is a fault-based possession notice. You must specify one or more grounds for possession.",
      "Common grounds: Ground 8 (at least 2 months rent arrears), Ground 10 (some rent unpaid), Ground 11 (persistent late payment), Ground 12 (breach of tenancy terms).",
      "In the Notice Tracker tab, click \"+ New Notice\" and select \"Section 8\".",
      "Enter the grounds relied upon, date served, and hearing date if known.",
      "The notice period depends on the grounds: 2 weeks for rent arrears (Ground 8), 2 months for most other grounds.",
      "Track through the full process: Draft, Served, Court Filed, Hearing, Possession Granted.",
    ]},
  { id: 38, cat: 'tenancy', title: 'Section 13 rent increase notices', tags: ['section','13','rent','increase','notice'],
    steps: [
      "A Section 13 notice is the formal method to increase rent on a periodic tenancy.",
      "You must give at least one month notice for a monthly tenancy (using Form 4).",
      "The proposed new rent must be a fair market rent \u2014 not excessive compared to similar properties in the area.",
      "The tenant can accept the increase, negotiate, or refer it to the First-tier Tribunal for determination.",
      "You cannot increase rent during a fixed-term tenancy unless there is a rent review clause in the agreement.",
      "Use the Rent Review Planner in the Rent Tracker to model increases across your portfolio before serving formal notices.",
    ]},

  // ── MAINTENANCE ──────────────────────────────────────────────────────────
  { id: 39, cat: 'maintenance', title: 'Logging a repair job', tags: ['maintenance','repair','job','log'],
    steps: [
      "Open the property and switch to the Maintenance tab.",
      "Click \"+ Add Job\" to log a new repair or maintenance item.",
      "Enter a title (e.g. \"Boiler repair\"), select the category (plumbing, electrical, structural, etc.), and add a description.",
      "Enter the contractor name, estimated or actual cost, and the date reported.",
      "Set the status: Reported, In Progress, or Completed.",
      "Click \"Save\". The job appears in the property maintenance timeline and costs feed into your expense tracking.",
    ]},
  { id: 40, cat: 'maintenance', title: 'Adding & managing contractors', tags: ['contractor','add','manage','directory'],
    steps: [
      "Go to Portfolio > Contractors tab (or use the Contractors link in the navigation bar if enabled).",
      "Click \"+ Add Contractor\" to add a new contractor to your directory.",
      "Enter their name, trade (e.g. Plumber, Electrician), phone number, email, and any notes.",
      "Assign them to one or more companies so they appear when logging jobs for properties in those companies.",
      "Your contractor directory is searchable and filterable by trade.",
    ]},
  { id: 41, cat: 'maintenance', title: 'Tracking repair costs', tags: ['maintenance','cost','expense','tracking'],
    steps: [
      "Each maintenance job has a cost field that records the expense.",
      "Costs from completed jobs automatically feed into the property Expenses tab and P&L reports.",
      "To see total maintenance spend, go to Reports and run the \"Maintenance cost report\" \u2014 it breaks down spend by property, trade type, and contractor.",
      "Tip: Always update the actual cost when a job is completed, even if it differs from the estimate.",
    ]},
  { id: 42, cat: 'maintenance', title: 'Updating job status & completion', tags: ['maintenance','status','complete','update'],
    steps: [
      "Open the property Maintenance tab and find the job you want to update.",
      "Click on the job to expand its details.",
      "Change the status: Reported (new), In Progress (contractor assigned), or Completed (work done).",
      "When marking as Completed, update the actual cost and add any completion notes.",
      "Completed jobs are kept in the timeline for your records and audit trail.",
    ]},

  // ── DOCUMENTS & EXPENSES ─────────────────────────────────────────────────
  { id: 43, cat: 'documents', title: 'Uploading & organising documents', tags: ['document','upload','file','store'],
    steps: [
      "Open any property and switch to the Documents tab.",
      "Click \"Upload\" and select one or more files from your computer.",
      "Supported formats include PDF, images (JPG, PNG), and common document types.",
      "Each document is stored against the property and can be viewed, downloaded, or deleted at any time.",
      "Tip: Upload tenancy agreements, certificates, insurance documents, and key correspondence for each property.",
    ]},
  { id: 44, cat: 'documents', title: 'Sharing documents with tenants', tags: ['document','share','tenant','portal'],
    steps: [
      "Enable the Tenant Portal for the relevant company in Settings > Features.",
      "Enable \"Tenant Document Access\" in the tenant portal feature toggles.",
      "Upload documents to the property Documents tab as normal.",
      "Documents will automatically be available to tenants when they log into their portal.",
      "You can control which documents are shared \u2014 only documents you explicitly upload to the shared section will be visible.",
    ]},
  { id: 45, cat: 'documents', title: 'Adding & categorising expenses', tags: ['expense','add','category','cost'],
    steps: [
      "Open the property and switch to the Expenses tab.",
      "Click \"+ Add Expense\" to log a new cost.",
      "Enter the amount, date, category (e.g. Insurance, Repairs, Management Fees, Legal, Utilities), and a description.",
      "Expenses are tracked per property and feed into P&L reports and the portfolio financial summary.",
      "Tip: Log regular costs like insurance premiums and letting agent fees so your profit calculations are accurate.",
    ]},

  // ── DEALS & CALCULATOR ───────────────────────────────────────────────────
  { id: 46, cat: 'deals', title: 'Creating a new deal', tags: ['deal','create','new','pipeline'],
    steps: [
      "Navigate to Deals from the top navigation bar.",
      "Click \"+ New Deal\" in the top-right.",
      "Enter the property address, asking price, and your offer price.",
      "Fill in the financial details: deposit percentage, mortgage rate and term, expected monthly rent.",
      "Select whether this is a standard BTL, HMO, cash purchase, or refinance.",
      "The deal calculator runs automatically as you enter data, showing yield, profit, and cash required.",
      "Click \"Save\" to add the deal to your pipeline for tracking.",
    ]},
  { id: 47, cat: 'deals', title: 'Using the BTL deal calculator', tags: ['deal','calculator','btl','analysis'],
    steps: [
      "In the Deals section, open any deal to see the full calculator.",
      "The calculator shows: gross yield, net yield, monthly profit, cash-on-cash return, and total cash required.",
      "It factors in: purchase price, stamp duty (auto-calculated), mortgage costs, management fees, insurance, maintenance allowance, and void periods.",
      "Change any input and the results update in real time.",
      "Use the stress test section to see how your deal performs at higher mortgage rates.",
    ]},
  { id: 48, cat: 'deals', title: 'Understanding yield calculations', tags: ['yield','gross','net','cost','value'],
    steps: [
      "Gross yield = (Annual rent / Property value or cost) x 100. It is the simplest measure of return.",
      "In Settings > Display, you can choose whether yield is calculated on purchase price + refurb cost (\"on cost\") or on current estimated value (\"on value\").",
      "\"On cost\" shows your return on actual money invested. \"On value\" shows what yield the property delivers at current market prices.",
      "This setting applies everywhere: property cards, portfolio overview, deal calculator, and reports.",
      "Tip: Most investors use \"on cost\" for tracking investment returns and \"on value\" when deciding whether to hold or sell.",
    ]},
  { id: 49, cat: 'deals', title: 'SDLT calculator & additional property surcharge', tags: ['sdlt','stamp','duty','tax','surcharge'],
    steps: [
      "The deal calculator automatically computes stamp duty based on the purchase price and property type.",
      "For additional properties (which most BTL purchases are), a 5% surcharge applies to the entire purchase price from the first pound.",
      "Standard bands (with additional property rates): 0\u2013\u00a3125k = 5%, \u00a3125k\u2013\u00a3250k = 7%, \u00a3250k\u2013\u00a3925k = 10%, \u00a3925k\u2013\u00a31.5m = 15%, over \u00a31.5m = 17%.",
      "First-time buyer relief is available for non-additional purchases: 0% up to \u00a3300k, 5% from \u00a3300k to \u00a3500k.",
      "The calculator shows the full SDLT breakdown so you can verify it against HMRC figures.",
    ]},
  { id: 50, cat: 'deals', title: 'HMO deal modelling', tags: ['hmo','deal','rooms','rent','model'],
    steps: [
      "When creating a deal, toggle the HMO option on.",
      "Enter the number of rooms and the rent per room instead of a single monthly rent figure.",
      "The calculator will compute total gross rent, per-room yield, and factor in higher management costs typical of HMOs.",
      "HMO-specific costs to consider: licensing fees, fire safety upgrades, room furnishing, higher insurance premiums, and more intensive management.",
      "Compare the HMO yield against a standard single-let scenario to see if the conversion is worthwhile.",
    ]},
  { id: 51, cat: 'deals', title: 'Comparing deals side by side', tags: ['deal','compare','side','shortlist'],
    steps: [
      "In the Deals section, you can view all your active deals in a list or table view.",
      "Each deal card shows the key metrics: yield, monthly profit, cash required, and status.",
      "Use the compare view to see multiple deals side by side with all their financial metrics aligned.",
      "This helps you decide which deal to pursue when you have multiple options on the table.",
      "Move deals through status stages: Researching, Viewing, Offer Made, Accepted, Legal, Completed, or Rejected.",
    ]},

  // ── LETTINGS PIPELINE ────────────────────────────────────────────────────
  { id: 52, cat: 'lettings', title: 'Creating a new letting', tags: ['letting','create','new','pipeline'],
    steps: [
      "Navigate to Deals and switch to the Lettings tab.",
      "Click \"+ New Letting\" in the top-right.",
      "Select the property you are letting, the target rent, and the available date.",
      "The letting enters your pipeline at the first stage (typically \"Listing\").",
      "Track it through each stage: Listing, Viewings, Applications, Referencing, Contract, Move-in.",
    ]},
  { id: 53, cat: 'lettings', title: 'Moving through pipeline stages', tags: ['letting','pipeline','stage','progress'],
    steps: [
      "Open a letting from the Lettings tab.",
      "The pipeline shows all stages as a horizontal progress bar.",
      "Click the next stage button to advance the letting (e.g. from Viewings to Applications).",
      "Each stage can have notes and dates attached for your records.",
      "Once the letting reaches Move-in, it is marked as complete and the property status should be updated to Rented.",
    ]},
  { id: 54, cat: 'lettings', title: 'Setting up deal milestones & checklists', tags: ['milestone','checklist','setup','pipeline'],
    steps: [
      "Go to Settings > Deal Milestones.",
      "Here you can customise the checklist items that appear at each stage of your deals and lettings pipeline.",
      "Add items like: \"Instruct solicitor\", \"Order survey\", \"Exchange contracts\", \"Complete\", etc.",
      "These checklists help ensure nothing is missed during the purchase or letting process.",
      "Changes apply to all new deals and lettings going forward.",
    ]},

  // ── REPORTS ──────────────────────────────────────────────────────────────
  { id: 55, cat: 'reports', title: 'Running a P&L report', tags: ['report','pnl','profit','loss'],
    steps: [
      "Navigate to Reports from the top navigation bar.",
      "Select the \"Profit & Loss\" report from the list.",
      "Choose the company (or All Companies) and the reporting period (tax year or calendar year).",
      "The report shows: rental income, expenses broken down by category, mortgage costs, management fees, and net profit.",
      "Click \"Export PDF\" to download a professional report or \"Export CSV\" for spreadsheet analysis.",
    ]},
  { id: 56, cat: 'reports', title: 'Exporting reports to CSV & PDF', tags: ['report','export','csv','pdf','download'],
    steps: [
      "Open any report from the Reports page.",
      "At the top of the report, you will see export buttons: \"Export PDF\" and \"Export CSV\".",
      "PDF exports are professionally formatted with your company logo and colours (set in Settings > Branding).",
      "CSV exports open in Excel or Google Sheets for further analysis.",
      "Tip: Your accountant will typically want the P&L report as a CSV and the rent schedule as a PDF.",
    ]},
  { id: 57, cat: 'reports', title: 'Setting default reporting period', tags: ['report','period','tax','year','calendar'],
    steps: [
      "Go to Settings > Reporting (under the Preferences group).",
      "For each company, choose whether reports default to the UK tax year (6 April \u2013 5 April) or the calendar year (1 January \u2013 31 December).",
      "This sets the default \u2014 you can always override the period when running an individual report.",
      "Most landlords use the UK tax year for personal holdings and calendar year for limited company accounts.",
    ]},
  { id: 58, cat: 'reports', title: 'Overview of all 16 reports', tags: ['report','list','overview','available'],
    steps: [
      "Properly includes 16 built-in reports covering: Tax & Accounting (annual P&L, rental income schedule, expense breakdown, mortgage interest summary, capital gains summary), Portfolio Performance (yield comparison, occupancy rate, rent collection rate), Cash Flow & Finance (monthly cash flow, equity report, mortgage portfolio, arrears), Compliance & Legal (compliance status, tenancy schedule), and Maintenance (maintenance overview, contractor spend).",
      "All reports can be filtered by company, date range, and property status.",
      "Reports update in real time as you add data \u2014 no manual recalculation needed.",
      "Navigate to Reports and browse the full list organised by category.",
    ]},

  // ── TENANT PORTAL ────────────────────────────────────────────────────────
  { id: 59, cat: 'portal', title: 'Setting up the tenant portal', tags: ['portal','setup','enable','tenant'],
    steps: [
      "Go to Settings > Features and find the Tenant Portal toggle for the relevant company.",
      "Switch it ON. This enables the portal for that company.",
      "Below the main toggle, you can enable sub-features: Tenant Messaging, Tenant Repair Requests, and Tenant Document Access.",
      "Go to Settings > Tenant Portal to configure the contact mode (landlord or agent), subdomain, and bank details for tenant payments.",
      "The portal is now live \u2014 tenants can access it once you send them an invite link.",
    ]},
  { id: 60, cat: 'portal', title: 'Inviting a tenant', tags: ['portal','invite','tenant','link'],
    steps: [
      "Go to Settings > Tenant Portal.",
      "Select the company and property you want to invite a tenant to.",
      "Click \"Generate invite link\". A unique URL is created for that property.",
      "Send the link to your tenant via email or message. They can use it to create their portal account.",
      "The tenant will see their rent history, tenancy details, and any documents or messages you share.",
    ]},
  { id: 61, cat: 'portal', title: 'Customising your portal subdomain', tags: ['portal','subdomain','branding','url'],
    steps: [
      "Go to Settings > Tenant Portal.",
      "Find the \"Subdomain\" field for the selected company.",
      "Enter a subdomain name (e.g. \"vale-properties\"). This creates a branded URL for your tenants.",
      "The subdomain is auto-generated from your company name but can be customised.",
      "Click \"Save\" to apply the change.",
    ]},
  { id: 62, cat: 'portal', title: 'Managing tenant messages (inbox)', tags: ['portal','message','inbox','tenant','communication'],
    steps: [
      "When Tenant Messaging is enabled, tenants can send messages through their portal.",
      "Messages appear in your Dashboard inbox.",
      "Click on a message to read it and reply directly.",
      "Messages are linked to the specific property and tenant, so you always have context.",
      "Tip: Use this for routine communications to keep everything documented in one place.",
    ]},
  { id: 63, cat: 'portal', title: 'Handling tenant repair requests', tags: ['portal','repair','request','maintenance','tenant'],
    steps: [
      "When Tenant Repair Requests is enabled, tenants can submit maintenance requests through their portal.",
      "Requests include a description and optional photos.",
      "New requests appear in your Dashboard inbox with a maintenance badge.",
      "Click on a request to review it. You can then log it as a formal maintenance job on the property Maintenance tab.",
      "The tenant receives updates as the job status changes.",
    ]},

  // ── SETTINGS & ACCOUNT ───────────────────────────────────────────────────
  { id: 64, cat: 'settings', title: 'Changing dark/light mode', tags: ['dark','light','mode','theme','display'],
    steps: [
      "Go to Settings > Display (under the Preferences group).",
      "Click \"Dark\" or \"Light\" to switch the app theme.",
      "The change takes effect immediately and is saved to your account \u2014 it persists across devices.",
    ]},
  { id: 65, cat: 'settings', title: 'Changing yield basis (cost vs value)', tags: ['yield','basis','cost','value','setting'],
    steps: [
      "Go to Settings > Display (under the Preferences group).",
      "In the Yield Calculation section, choose: \"Purchase + refurb cost\" (on cost) or \"Current property value\" (on value).",
      "On cost: Yield is calculated as annual rent divided by purchase price plus refurb cost. This shows your return on actual money invested.",
      "On value: Yield is calculated as annual rent divided by current estimated value. This shows what the property yields at current market prices.",
      "The setting applies everywhere: property cards, portfolio overview, deal calculator, and all reports.",
    ]},
  { id: 66, cat: 'settings', title: 'Uploading company logos for reports', tags: ['logo','upload','branding','report','pdf'],
    steps: [
      "Go to Settings > Branding & Logos.",
      "Select the company you want to brand using the company selector.",
      "In the \"Company logo for reports\" section, click \"Upload logo\".",
      "Choose a PNG or SVG file with a transparent background (max 2MB). Recommended width: at least 400px.",
      "The logo will appear on all PDF report exports for that company.",
      "You can replace or remove the logo at any time.",
    ]},
  { id: 67, cat: 'settings', title: 'Setting up notifications & alerts', tags: ['notification','alert','setting','email'],
    steps: [
      "Go to Settings > Notifications (under Portfolio Setup).",
      "Toggle each alert type on or off: Rent Arrears, Lease Expiry, Compliance Expiry, Vacant Properties, and Weekly Summary.",
      "These control which alerts appear in the Smart Alerts panel on your Dashboard.",
      "The Weekly Summary sends a portfolio overview email every Monday (coming soon).",
      "Click \"Save Preferences\" to apply your changes.",
    ]},
  { id: 68, cat: 'settings', title: 'Managing user access (multi-user)', tags: ['access','user','multi','team','permission'],
    steps: [
      "Go to Settings > Team & Access (under the Preferences group). You must be an admin to see this section.",
      "Click \"Manage User Access\" to open the access management modal.",
      "You will see all users in your account with checkboxes for each company.",
      "Check a company to grant access or uncheck to revoke it.",
      "Invited users can view and manage properties within the companies they have access to.",
      "Use the Invitations tab to send email invites to new users.",
    ]},
  { id: 69, cat: 'settings', title: 'Using the referral programme', tags: ['referral','invite','programme','share'],
    steps: [
      "Go to Settings > Refer a Friend.",
      "You will see your unique referral link and code.",
      "Share this link with other landlords. When they sign up and subscribe, you both benefit.",
      "Track the status of your referrals on this page: pending, signed up, or paying.",
    ]},
  { id: 70, cat: 'settings', title: 'GDPR data export & account deletion', tags: ['gdpr','data','export','delete','privacy'],
    steps: [
      "Go to Settings > Security & Data.",
      "In the GDPR section, you can request a full data export. This generates a downloadable file containing all your personal data, properties, and records.",
      "To delete your account, click \"Delete Account\" at the bottom. You will need to enter your password to confirm.",
      "Account deletion is permanent and removes all your data including companies, properties, rent records, documents, and compliance certificates.",
      "Tip: Export your data before deleting your account if you want to keep a copy.",
    ]},

  // ── AI TOOLS ─────────────────────────────────────────────────────────────
  { id: 71, cat: 'ai', title: 'Using the AI listing writer', tags: ['ai','listing','writer','advert','generate'],
    steps: [
      "The AI listing writer generates professional property listings from your property data.",
      "Navigate to the AI Tools section (accessible from the property detail or + New menu).",
      "Select the property you want to create a listing for.",
      "The AI will use the property details (type, bedrooms, location, rent, features) to generate a polished listing suitable for Rightmove, Zoopla, or OpenRent.",
      "Edit the generated text as needed and copy it to your clipboard.",
    ]},
  { id: 72, cat: 'ai', title: 'Using the portfolio modeller', tags: ['modeller','portfolio','projection','model','slider'],
    steps: [
      "The Portfolio Modeller is a what-if tool with interactive sliders.",
      "Access it from the Dashboard or Reports section.",
      "Adjust the sliders: number of additional properties, average purchase price, average yield, mortgage rate, and LTV.",
      "The modeller shows projections for: portfolio value, monthly income, annual profit, and equity growth.",
      "Use it to plan your portfolio growth strategy and set acquisition targets.",
      "Tip: Try different scenarios to see how changes in mortgage rates or property counts affect your overall returns.",
    ]},
]

export default function HelpCenter() {
  const { T } = useTheme()
  const mono = MONO
  const [search, setSearch]     = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [openGuide, setOpenGuide] = useState(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return GUIDES.filter(g => {
      if (activeCat !== 'all' && g.cat !== activeCat) return false
      if (!q) return true
      return g.title.toLowerCase().includes(q)
        || g.tags.some(t => t.includes(q))
        || g.steps.some(s => s.toLowerCase().includes(q))
    })
  }, [search, activeCat])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(g => {
      if (!map[g.cat]) map[g.cat] = []
      map[g.cat].push(g)
    })
    return CATEGORIES.filter(c => map[c.key]).map(c => ({ ...c, guides: map[c.key] }))
  }, [filtered])

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Getting Started</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 14, lineHeight: 1.7 }}>
          Step-by-step guides for every feature in Properly. Search or browse by category.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => window.dispatchEvent(new CustomEvent('ownproperly:restart-tour'))}>
            {"▶ Replay app tour"}
          </button>
          <a href="/blog/" target="_blank" rel="noopener noreferrer" style={{ fontFamily: mono, fontSize: 11, color: T.gold, textDecoration: 'none' }}>
            {"Read full blog guides →"}
          </a>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search guides... e.g. mortgage, deposit, tenant"
          style={{ width: '100%', fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 10, padding: '10px 16px', outline: 'none', boxSizing: 'border-box' }}/>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={() => setActiveCat('all')}
          style={{ fontFamily: mono, fontSize: 10, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${activeCat === 'all' ? T.gold : T.border}`,
            background: activeCat === 'all' ? T.gold + '22' : 'transparent',
            color: activeCat === 'all' ? T.gold : T.muted, fontWeight: activeCat === 'all' ? 700 : 400 }}>
          All ({GUIDES.length})
        </button>
        {CATEGORIES.map(c => {
          const count = GUIDES.filter(g => g.cat === c.key).length
          return (
            <button key={c.key} onClick={() => setActiveCat(c.key)}
              style={{ fontFamily: mono, fontSize: 10, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${activeCat === c.key ? T.gold : T.border}`,
                background: activeCat === c.key ? T.gold + '22' : 'transparent',
                color: activeCat === c.key ? T.gold : T.muted, fontWeight: activeCat === c.key ? 700 : 400 }}>
              {ICON_NAMES.includes(c.icon)?<Icon name={c.icon} size={14}/>:c.icon} {c.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: 'center', padding: 40 }}>
          No guides match your search. Try a different keyword.
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.key} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ display:'flex' }}>{ICON_NAMES.includes(group.icon)?<Icon name={group.icon} size={18}/>:group.icon}</span>
              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group.label}</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>({group.guides.length})</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {group.guides.map(guide => {
                const isOpen = openGuide === guide.id
                return (
                  <div key={guide.id} style={{ background: T.card, border: `1px solid ${isOpen ? T.gold : T.border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                    <div onClick={() => setOpenGuide(isOpen ? null : guide.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{guide.title}</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {guide.tags.slice(0, 4).map(tag => (
                            <span key={tag} style={{ fontFamily: mono, fontSize: 8, color: T.faint, background: T.bg, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontFamily: mono, fontSize: 9, color: T.muted }}>{guide.steps.length} steps</span>
                        <span style={{ fontFamily: mono, fontSize: 12, color: isOpen ? T.gold : T.muted, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${T.border}` }}>
                        <div style={{ display: 'grid', gap: 0, paddingTop: 14 }}>
                          {guide.steps.map((step, i) => (
                            <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: 14, position: 'relative' }}>
                              {/* Step number + connector line */}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
                                <div style={{ width: 24, height: 24, borderRadius: 12, background: T.gold + '22', border: `1.5px solid ${T.gold}`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: 10, fontWeight: 700, color: T.gold, flexShrink: 0 }}>
                                  {i + 1}
                                </div>
                                {i < guide.steps.length - 1 && (
                                  <div style={{ width: 1.5, flex: 1, background: T.border, marginTop: 4 }}/>
                                )}
                              </div>
                              <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7, paddingTop: 3 }}>
                                {step}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginTop: 8 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Need more help?</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7 }}>
          {"Email us at "}
          <a href="mailto:hello@ownproperly.com" style={{ color: T.gold, fontWeight: 700 }}>hello@ownproperly.com</a>
          {" or use the Feedback tab to send us a message directly from the app."}
        </div>
      </div>
    </div>
  )
}
