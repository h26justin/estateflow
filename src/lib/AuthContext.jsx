import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { logError } from './logError'
import { MfaChallengeScreen, SetNewPasswordScreen } from '../components/LoginPage'

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
//
// Two gates sit between "has a session" and "sees the app":
//   • MFA (AAL2): signInWithPassword returns a usable AAL1 session even
//     when the user has a verified TOTP factor — Supabase leaves the
//     step-up to the app. We check getAuthenticatorAssuranceLevel() and
//     hold the app behind a TOTP challenge until the session reaches AAL2.
//   • PASSWORD_RECOVERY: clicking a reset-password email link signs the
//     user in and fires this event — we show a set-new-password screen
//     so the reset flow actually completes.

const AuthContext = createContext({ session: undefined, user: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  // AAL verdict, keyed to the user it was computed for. Keying on userId
  // makes the gate synchronous: a freshly-arrived session whose verdict
  // hasn't landed yet (aal.userId mismatch) holds the app instead of
  // flashing it for a frame before the MFA challenge appears.
  const [aal, setAal] = useState({ userId: null, status: 'ok' })
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(e => {
        logError('AuthContext:getSession', e)
        // Treat a failed initial fetch as "logged out" rather than leaving
        // the app in a permanent loading state.
        setSession(null)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      // Bail out when nothing meaningful changed — Supabase fires events on
      // every tab refocus with a fresh session object reference, and
      // publishing it unconditionally re-renders the whole app tree.
      setSession(prev => (
        prev && s &&
        prev.access_token === s.access_token &&
        prev.user?.id === s.user?.id
      ) ? prev : s)
    })
    return () => subscription.unsubscribe()
  }, [])

  // AAL check — runs once per sign-in (keyed on user id, NOT on the session
  // object, so routine token refreshes don't re-trigger it).
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) { setAal({ userId: null, status: 'ok' }); return }
    let cancelled = false
    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) throw error
        const challenge = data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2'
        setAal({ userId, status: challenge ? 'challenge' : 'ok' })
      })
      .catch(e => {
        if (cancelled) return
        logError('AuthContext:aalCheck', e)
        // Fail open — a broken check must not lock every user out.
        setAal({ userId, status: 'ok' })
      })
    return () => { cancelled = true }
  }, [userId])

  const loading = session === undefined
  const user    = session?.user ?? null
  const value   = useMemo(() => ({ session, user, loading }), [session, user, loading])

  let content = children
  if (session && aal.userId !== userId) {
    // Verdict for this sign-in hasn't landed yet — hold the app (and its
    // data fetches). The check is local-only so this lasts a frame at most.
    content = null
  } else if (session && aal.status === 'challenge') {
    content = <MfaChallengeScreen
      onVerified={() => setAal({ userId, status: 'ok' })}
      onSignOut={() => supabase.auth.signOut()} />
  } else if (session && recovery) {
    content = <SetNewPasswordScreen onDone={() => setRecovery(false)} />
  }

  return (
    <AuthContext.Provider value={value}>
      {content}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
