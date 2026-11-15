// Per-property billing rules shared by create-checkout, stripe-webhook and
// sync-subscription-quantity. Mirrors calcMonthlyPrice in
// src/lib/tierGating.js. Copied into each function folder (Supabase deploys
// functions in isolation); src/lib/__tests__/edgeSharedCopies.test.js fails
// if a copy drifts.

export const MONTHLY_FLOOR_GBP = 10
export const PRICE_PER_PROPERTY_GBP: Record<string, number> = { starter: 2, investor: 5 }

// Minimum billed quantity that makes up the £10 floor: 5 on Starter, 2 on
// Investor. Stored on the Stripe subscription's metadata at checkout as
// `min_quantity`, so subscriptions created before the floor existed (no
// metadata) keep their old minimum of 1.
export function floorQuantity(tier: string | null | undefined): number {
  return Math.ceil(MONTHLY_FLOOR_GBP / (PRICE_PER_PROPERTY_GBP[tier || 'starter'] ?? 2))
}

export function billedQuantity(propertyCount: number, minQuantity: number): number {
  return Math.max(1, minQuantity || 1, Math.floor(propertyCount || 0))
}

// Billable properties for a company: everything not in Trash. Archived and
// sold properties are still billable (they still hold data and history).
// Returns null if the count couldn't be read — callers must not bill on a
// guess.
export async function countBillableProperties(supabase: any, companyId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('properties').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('deleted_at', null)
  if (error || typeof count !== 'number') return null
  return count
}
