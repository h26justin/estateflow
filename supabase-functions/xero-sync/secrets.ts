// Constant-time secret comparison for cron / webhook / shared-secret checks.
//
// IMPORTANT: like oauth-state.ts and encryption.ts, this file is NOT shared
// at runtime — each edge function deploys in isolation, so every function
// that needs it carries a byte-identical copy at ./secrets.ts (imported as
// `import { secretMatches } from './secrets.ts'`). This file is the
// canonical source; src/lib/__tests__/edgeSharedCopies.test.js fails if a
// copy drifts. Update all copies together.
//
// Plain `===` / `!==` on a secret short-circuits at the first differing
// byte, which leaks how much of a guess was right through response timing.
// These helpers always walk the full length of the longer input.

const enc = new TextEncoder()

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(typeof a === 'string' ? a : '')
  const y = enc.encode(typeof b === 'string' ? b : '')
  const len = Math.max(x.length, y.length)
  let diff = x.length ^ y.length
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// True only when a secret is configured AND the provided value matches it.
// An unset/empty expected secret never matches (fail closed).
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false
  return timingSafeEqual(provided || '', expected)
}
