-- Consolidated feature_flags seed for the 2026-06-11 feature batch.
-- Owned by the integrator: each feature builder intentionally did NOT seed
-- its own feature_flags row. Idempotent upsert (matches feature-flags.sql schema:
-- key, name, description, enabled_globally).
--
-- The 7 full features are enabled_globally=true; the 3 inert scaffolds
-- (rent_collection, esign, referencing) ship DISABLED pending provider setup.

INSERT INTO feature_flags (key, name, description, enabled_globally) VALUES
  ('ai_maintenance_triage', 'AI Maintenance Triage', 'AI drafts a severity/trade/diagnosis assessment from a repair''s photos and description', true),
  ('rent_collection', 'Rent Collection', 'Open-banking rent collection scaffold (inert pending FCA authorisation and TrueLayer VRP agreement)', false),
  ('portfolio_autopilot', 'Portfolio Autopilot', 'Daily AI scan of the portfolio drafting prioritised actions (arrears, compliance, renewals, mortgage)', true),
  ('ai_lettings', 'AI Lettings Assistant', 'AI drafts replies, pre-screens and scores inbound rental enquiries', false),
  ('hmo_rooms', 'HMO Room Management', 'Room-level HMO letting, occupancy, per-room rent and licence register', true),
  ('esign', 'E-Signature', 'Provider-agnostic e-signing scaffold (inert pending provider API key)', false),
  ('referencing', 'Tenant referencing & Right-to-Rent', 'Order tenant reference and Right-to-Rent checks (inert pending provider API key)', false),
  ('ai_bookkeeping', 'AI bookkeeping', 'Auto-categorise bank transactions with rules + AI drafts; MTD quarterly figures', true),
  ('renters_rights', 'Renters Rights', 'Renters Rights Act compliance copilot', true),
  ('epc_planner', 'EPC retrofit planner', 'Per-property EPC C retrofit plan with prioritised measures and 2030 MEES countdown', true)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = now();

NOTIFY pgrst, 'reload schema';
