-- AI bookkeeping rules (Feature 8 — flag: ai_bookkeeping, Investor-tier gated).
--
-- Builds on the existing bank feeds (bank_transactions) and receipt OCR.
-- Two parts:
--   1. txn_rules — user-authored, learnable categorisation rules. Each rule
--      matches a transaction field against a pattern and, when it fires,
--      sets a category (and optionally a property). Rules are applied in
--      priority order by the bookkeeping-ai edge function before any AI call.
--   2. ai_category / ai_category_confidence columns on bank_transactions —
--      where the categorisation result lands (whether from a rule or from a
--      Claude DRAFT suggestion the user later accepts).
--
-- Categorisation NEVER finalises a financial action on its own: the AI only
-- drafts suggestions; the user accepts/rejects in the BookkeepingRules UI.

-- ── txn_rules ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.txn_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- which transaction field the pattern is tested against
  match_field     text NOT NULL DEFAULT 'description'
                    CHECK (match_field IN ('description', 'counterparty')),
  -- case-insensitive substring matched against match_field
  match_pattern   text NOT NULL,
  set_category    text NOT NULL,
  set_property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  priority        int  NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS txn_rules_company_priority_idx
  ON public.txn_rules (company_id, active, priority);
CREATE INDEX IF NOT EXISTS txn_rules_user_idx
  ON public.txn_rules (user_id);

ALTER TABLE public.txn_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS txn_rules_select ON public.txn_rules;
CREATE POLICY txn_rules_select ON public.txn_rules
  FOR SELECT USING (
    is_developer()
    OR user_id = auth.uid()
    OR has_company_access(company_id)
  );

DROP POLICY IF EXISTS txn_rules_insert ON public.txn_rules;
CREATE POLICY txn_rules_insert ON public.txn_rules
  FOR INSERT WITH CHECK (
    (user_id = auth.uid() OR has_company_access(company_id))
    AND company_is_live(company_id)
  );

DROP POLICY IF EXISTS txn_rules_update ON public.txn_rules;
CREATE POLICY txn_rules_update ON public.txn_rules
  FOR UPDATE USING (
    (user_id = auth.uid() OR has_company_access(company_id))
    AND company_is_live(company_id)
  );

DROP POLICY IF EXISTS txn_rules_delete ON public.txn_rules;
CREATE POLICY txn_rules_delete ON public.txn_rules
  FOR DELETE USING (
    (user_id = auth.uid() OR has_company_access(company_id))
    AND company_is_live(company_id)
  );

-- ── bank_transactions: AI categorisation columns ──────────────────────────
-- ai_category is the suggested/applied bookkeeping category; the confidence
-- is 0..1 (rules write 1.0; Claude DRAFTs write its own estimate).
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS ai_category text;
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS ai_category_confidence numeric;

COMMENT ON COLUMN public.bank_transactions.ai_category IS
  'Bookkeeping category — set by a txn_rule (confidence 1.0) or an accepted AI DRAFT suggestion.';
COMMENT ON COLUMN public.bank_transactions.ai_category_confidence IS
  '0..1 confidence for ai_category. 1.0 = rule/manual; <1 = AI draft estimate.';

NOTIFY pgrst, 'reload schema';
