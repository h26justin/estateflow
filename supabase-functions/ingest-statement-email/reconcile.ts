// Statement reconciliation for ingest-statement-email: do the extracted line
// items add up to the totals printed on the statement? Pure (no Deno APIs)
// so supabase-functions/_shared/anthropic.test.ts can import it.

// deno-lint-ignore-file no-explicit-any

// Do the line items add up to the stated totals? Each stated total is
// compared with the sum of its items (rent → rent lines, fees → fee lines,
// maintenance → maintenance lines, net → every line), within 1p per line
// summed. Fees / maintenance are compared by size, since statements print
// them either signed or unsigned.
export function reconcileStatement(data: any): { ok: boolean; mismatches: { total: string; stated: number; items_sum: number; diff: number }[] } {
  const items: any[] = Array.isArray(data?.items) ? data.items : []
  const totals = data?.totals || {}
  const r2 = (n: number) => Math.round(n * 100) / 100
  const groups: [string, (it: any) => boolean, boolean][] = [
    ['rent_income', (it) => it.type === 'rent', false],
    ['fees', (it) => it.type === 'fee', true],
    ['maintenance', (it) => it.type === 'maintenance', true],
    ['net_to_landlord', () => true, false],
  ]
  const mismatches: { total: string; stated: number; items_sum: number; diff: number }[] = []
  for (const [key, inGroup, bySize] of groups) {
    const stated = totals[key]
    if (typeof stated !== 'number' || !Number.isFinite(stated)) continue
    const lines = items.filter((it) => inGroup(it) && typeof it?.amount === 'number' && Number.isFinite(it.amount))
    const sum = r2(lines.reduce((a, it) => a + it.amount, 0))
    const diff = bySize ? r2(Math.abs(Math.abs(sum) - Math.abs(stated))) : r2(Math.abs(sum - stated))
    if (diff > r2(Math.max(1, lines.length) * 0.01)) mismatches.push({ total: key, stated, items_sum: sum, diff })
  }
  return { ok: mismatches.length === 0, mismatches }
}
