// Private helpers shared by the API domain modules. Not re-exported from
// index.js, so nothing here is part of the public `api` namespace.
import { supabase } from '../supabase'

// getSession() reads the cached session locally (no network); getUser() makes
// an HTTP round-trip to /auth/v1/user on EVERY call, which added ~100ms to
// every write. RLS revalidates the JWT server-side anyway.
export const uid = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id) return session.user.id
  return (await supabase.auth.getUser()).data.user.id
}
