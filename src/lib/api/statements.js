// Statement import support — property label aliases.
//
// Managing agents label the same unit differently from month to month
// ("35 Henley Road" / "Henly Road"), and a hand-keyed misspelling can score
// low enough that the importer leaves it unmatched. When the user fixes a
// match in the preview step we record the label they corrected, so the next
// statement resolves it automatically. See the property_statement_aliases
// migration and normaliseStatementName in src/lib/statementParser.js.

import { supabase } from '../supabase'

// All aliases visible to the caller (own rows plus anything on a property they
// have access to, per RLS). Small table — no need to filter by property.
export async function fetchStatementAliases() {
  const { data, error } = await supabase
    .from('property_statement_aliases')
    .select('id, property_id, alias, alias_norm, source')
  if (error) throw error
  return data || []
}

// Teach the importer that `alias` means `propertyId`. Upserts on
// (user_id, alias_norm) so re-teaching a label repoints it rather than
// leaving two rows competing for the lookup.
//
// `aliasNorm` must be the client-computed normalised form
// (normaliseStatementName) so lookup and storage agree.
export async function saveStatementAlias(propertyId, alias, aliasNorm, source = 'learned') {
  if (!propertyId || !aliasNorm) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('property_statement_aliases')
    .upsert({
      property_id: propertyId,
      user_id: user.id,
      alias,
      alias_norm: aliasNorm,
      source,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,alias_norm' })
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

export async function deleteStatementAlias(id) {
  const { error } = await supabase.from('property_statement_aliases').delete().eq('id', id)
  if (error) throw error
}
