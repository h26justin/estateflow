// Two-factor step-up for sensitive actions.
//
// Some edge functions refuse an aal1 session when the account has 2FA
// (api-access token minting) or always (platform-admin delete-user). A
// session can be aal1 even for a 2FA user: "remember this device" skips
// the login challenge, and a password re-authentication replaces the
// session with a fresh aal1 one. ensureAal2 upgrades the CURRENT session
// in place by verifying a TOTP code, so the next request carries an aal2
// JWT. The server stays the gate; this only gets the user there.
import { supabase } from './supabase'

export const MFA_REQUIRED_CODE = 'mfa_required'

export function isMfaRequiredError(e) {
  return e?.code === MFA_REQUIRED_CODE
}

// Verify a 6-digit TOTP code against the user's first verified factor.
export async function verifyTotpCode(code) {
  const { data: factorData, error: fErr } = await supabase.auth.mfa.listFactors()
  if (fErr) throw fErr
  const factor = (factorData?.totp || []).find(f => f.status === 'verified')
  if (!factor) throw new Error('No verified authenticator found on this account.')
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id })
  if (cErr) throw cErr
  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId: factor.id, challengeId: challenge.id, code: String(code).trim(),
  })
  if (vErr) throw vErr
}

// askCode: () => Promise<string|null> (e.g. a useConfirm prompt).
// Resolves 'aal2' (session is / now is aal2), 'none' (no verified factor:
// nothing to step up to) or 'cancelled' (the user dismissed the prompt).
export async function ensureAal2(askCode) {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  if (data?.currentLevel === 'aal2') return 'aal2'
  if (data?.nextLevel !== 'aal2') return 'none'
  const code = await askCode()
  if (!code || !String(code).trim()) return 'cancelled'
  await verifyTotpCode(code)
  return 'aal2'
}

// Standard prompt via useConfirm()'s prompt mode.
export function totpPrompt(confirmDialog, body) {
  return () => confirmDialog({
    title: 'Two-factor verification',
    body: body || 'Enter the 6-digit code from your authenticator app to continue.',
    prompt: true,
    placeholder: '123456',
    confirmLabel: 'Verify',
  })
}
