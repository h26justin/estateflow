import { createContext, useContext, useState, useEffect, useCallback } from 'react'
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
export const DARK = {
  bg:'#0E141A', surface:'#151D25', card:'#1B242D', border:'#28333D',
  text:'#E8E5DD', muted:'#9AA6B0', faint:'#8A939E',
  gold:'#CBA64E', green:'#34C281', red:'#E06A5E', blue:'#5B9BD8', amber:'#E2A24A', purple:'#9B59B6',
}

export const LIGHT = {
  bg:'#F4F3EF', surface:'#FFFFFF', card:'#FAF9F6', border:'#E4E1D9',
  text:'#1C2830', muted:'#5C6670', faint:'#686D72',
  gold:'#B8902F', green:'#1F9D63', red:'#B8392D', blue:'#2D6FA8', amber:'#8A5600', purple:'#7B3FA0',
}

export const ThemeContext = createContext({ T: LIGHT, darkMode: false, setDarkMode: () => {}, loadUserTheme: () => {} })

export function ThemeProvider({ children }) {
  const [darkMode, setDarkModeState] = useState(() => {
    try {
      const stored = localStorage.getItem('ef_dark_mode')
      if (stored === null) return false // default light
      return stored === 'true'
    } catch(e) { return false }
  })

  useEffect(() => {
    document.body.style.background = darkMode ? '#0E141A' : '#F4F3EF'
    try { localStorage.setItem('ef_dark_mode', String(darkMode)) } catch(e) {}
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
        setDarkModeState(data.dark_mode)
        try { localStorage.setItem('ef_dark_mode', String(data.dark_mode)) } catch(e) {}
      }
    } catch(e) {}
  }, [])

  const setDarkMode = useCallback((val) => {
    setDarkModeState(val)
  }, [])

  const T = darkMode ? DARK : LIGHT

  return (
    <ThemeContext.Provider value={{ T, darkMode, setDarkMode, loadUserTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
