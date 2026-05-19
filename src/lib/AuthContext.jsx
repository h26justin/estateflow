import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { logError } from './logError'

// AuthContext — three-state auth model.
//
// `session` (raw value) can be one of:
//   • undefined → still loading. We haven't yet heard back from
//                 supabase.auth.getSession(). Components should render a
//                 spinner/skeleton, not "logged out" UI.
//   • null      → loading complete, user is signed out.
//   • <object>  → loading complete, user is signed in.
//
// The context value also exposes a derived `loading` boolean and `user`
// shortcut so most consumers never need to know about `undefined`:
//
//   const { user, loading } = useAuth()
//   if (loading) return <Spinner/>
//   if (!user) return <LoggedOutView/>
//   return <App user={user}/>
//
// `user` is `null` while loading OR while signed out — that's a deliberate
// safety choice. Components that fetch user-scoped data should always also
// check `loading` to avoid kicking off requests with `null` user.

const AuthContext = createContext({ session: undefined, user: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(e => {
        logError('AuthContext:getSession', e)
        // Treat a failed initial fetch as "logged out" rather than leaving
        // the app in a permanent loading state.
        setSession(null)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loading = session === undefined
  const user    = session?.user ?? null

  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
