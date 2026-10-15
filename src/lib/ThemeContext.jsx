import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './supabase'

// Colour tokens — the OwnProperly redesign palette (handoff: design/redesign-2026).
// Neutrals adopt the design spec verbatim; the few semantic colours that the
// design renders too light to use as *body text* are darkened just enough to
// clear WCAG 2.1 AA (4.5:1 normal text, 3:1 for large >=18pt). HMRC's
// production-access review audits this; failing AA delays our ITSA go-live, so
// AA is a hard floor that overrides the exact hex where the two conflict. The
// design's lighter status hues are still used verbatim in tinted pills/cells —
// see STATUS in lib/styles.js, where the tinted background restores contrast.
//
// Verified Jun 2026 (sRGB WCAG formula) against the live backgrounds:
//   LIGHT  ink   #1C2830 on #F4F3EF → 13.6:1  ✓ AAA
//   LIGHT  muted #5C6670 on #F4F3EF →  5.3:1  ✓ AA
//   LIGHT  faint #686D72 on #F4F3EF →  4.7:1  ✓ AA   (spec #8A8E92 → 2.97 fail)
//   LIGHT  red   #B8392D on #F4F3EF →  5.2:1  ✓ AA   (spec #C5483B → 4.33 large-only)
//   LIGHT  amber #8A5600 on #F4F3EF →  5.5:1  ✓ AA  (was #B5720A → 3.5:1 FAIL, incl. on its
//                                              own tints; darkened so amber-as-text passes)
//   LIGHT  blue  #2D6FA8 on #F4F3EF →  4.8:1  ✓ AA
//   LIGHT  gold  is an accent / button-fill, never body text (2.7:1 — as before)
//   LIGHT  goldText #7A5E1C on #F4F3EF → 5.5:1 ✓ AA  — use this (not `gold`) whenever
//                                              gold is the *text* colour: section
//                                              labels, active chips, badges, figures
//   LIGHT  green #167A4C on #F4F3EF →  4.8:1  ✓ AA  (was #1F9D63 → 3.1:1 FAIL as text;
//                                              white-on-green fills improve to 5.4:1)
//   DARK   text  #E8E5DD on #0E141A → 14.7:1  ✓ AAA
//   DARK   muted #9AA6B0 on #0E141A →  7.5:1  ✓ AA
//   DARK   faint #8A939E on #0E141A →  6.0:1  ✓ AA  (was #6E7681 → 4.0:1 on bg but
//                                              only 3.4:1 on card — and it is used
//                                              at 9–12px throughout, so the "large
//                                              text" 3:1 allowance never applied)
//
// Dark neutrals are quoted against the *worst* background, card #1B242D, not bg —
// bg flatters by ~0.6:1 and card is what most panels actually sit on:
//   DARK   text  #E8E5DD on #1B242D → 12.5:1  ✓ AAA
//   DARK   muted #9AA6B0 on #1B242D →  6.3:1  ✓ AA
//   DARK   faint #8A939E on #1B242D →  5.1:1  ✓ AA
//   DARK   goldText #CBA64E on #1B242D → 6.8:1  ✓ AA  (dark gold already passes)
//   DARK   purple #B98AD0 on #1B242D →  5.7:1  ✓ AA  (was #9B59B6 → 3.4:1 FAIL)
export const DARK = {
  bg:'#0E141A', surface:'#151D25', card:'#1B242D', border:'#28333D',
  text:'#E8E5DD', muted:'#9AA6B0', faint:'#8A939E',
  gold:'#CBA64E', goldText:'#CBA64E', green:'#34C281', red:'#E06A5E', blue:'#5B9BD8', amber:'#E2A24A', purple:'#B98AD0',
}

export const LIGHT = {
  bg:'#F4F3EF', surface:'#FFFFFF', card:'#FAF9F6', border:'#E4E1D9',
  text:'#1C2830', muted:'#5C6670', faint:'#686D72',
  gold:'#B8902F', goldText:'#7A5E1C', green:'#167A4C', red:'#B8392D', blue:'#2D6FA8', amber:'#8A5600', purple:'#7B3FA0',
}

export const ThemeContext = createContext({ T: LIGHT, darkMode: false, setDarkMode: () => {}, loadUserTheme: () => {} })

// Theme resolution:
//   1. An explicit choice (the Settings toggle, the command palette, or the
//      user_profiles.dark_mode value loaded after sign-in) is stored under
//      STORAGE_KEY and always wins.
//   2. Otherwise the theme follows the OS `prefers-color-scheme`, live.
// The resolved theme is mirrored to <html data-theme>, which switches the CSS
// custom properties in src/styles/app.css. public/js/theme-init.js applies the
// same rule before React loads so the first paint is already correct.
export const STORAGE_KEY = 'ef_dark_mode'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredChoice() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'true' ? true : stored === 'false' ? false : null
  } catch { return null }
}

function writeStoredChoice(val) {
  try { localStorage.setItem(STORAGE_KEY, String(val)) } catch { /* storage blocked */ }
}

function systemPrefersDark() {
  try { return !!window.matchMedia?.(DARK_QUERY).matches } catch { return false }
}

export function ThemeProvider({ children }) {
  const [explicit, setExplicit] = useState(readStoredChoice)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const darkMode = explicit ?? systemDark

  // Follow OS changes live (only matters while there is no explicit choice).
  useEffect(() => {
    let mq
    try { mq = window.matchMedia?.(DARK_QUERY) } catch { mq = null }
    if (!mq) return
    const onChange = (e) => setSystemDark(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener?.(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener?.(onChange)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  // Load saved preference from Supabase after login — uses shared client, no new instance
  const loadUserTheme = useCallback(async (userId) => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('dark_mode')
        .eq('user_id', userId)
        .single()
      if (data && data.dark_mode !== null && data.dark_mode !== undefined) {
        setExplicit(!!data.dark_mode)
        writeStoredChoice(!!data.dark_mode)
      }
    } catch { /* keep the local choice */ }
  }, [])

  // An explicit toggle: overrides the OS preference and persists.
  const setDarkMode = useCallback((val) => {
    setExplicit(!!val)
    writeStoredChoice(!!val)
  }, [])

  const T = darkMode ? DARK : LIGHT
  // Stable value: a fresh object every render re-rendered every useTheme()
  // consumer whenever anything above the provider rendered.
  const value = useMemo(() => ({ T, darkMode, setDarkMode, loadUserTheme }), [T, darkMode, setDarkMode, loadUserTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
