-- Dashboard section order/visibility was kept only in localStorage, so it was
-- lost on another device or browser, in a private window, or when site data
-- was cleared ("it keeps forgetting the order"). Store it on the profile next
-- to dashboard_widgets (KPI cards), as a JSONB array of { key, enabled }.
-- Additive and nullable: NULL means "use the default order".

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS dashboard_sections jsonb;
