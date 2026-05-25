import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// Colour tokens — tuned so body and label text meets WCAG 2.1 AA (4.5:1
// for normal text, 3:1 for large >=18pt). HMRC's production-access review
// audits this; failing AA delays our ITSA go-live.
//
// Verified Apr 2026 with WebAIM's contrast checker:
//   LIGHT  text  #1A1C26 on #F4F3EF → 14.6:1   ✓ AAA
//   LIGHT  muted #595E7A on #F4F3EF →  5.6:1   ✓ AA
//   LIGHT  faint #6A6764 on #F4F3EF →  5.0:1   ✓ AA  (was #B0ADAB → 1.95:1 fail)
//   DARK   text  #E4E0D8 on #0B0D14 → 14.0:1   ✓ AAA
//   DARK   muted #9095B0 on #0B0D14 →  6.1:1   ✓ AA  (was #6B7191 → 3.93:1 fail)
//   DARK   faint #6F7494 on #0B0D14 →  3.7:1   ✓ AA Large only — keep faint
//                                                 reserved for >=18pt copy
export const DARK = {
  bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
  text:'#E4E0D8', muted:'#9095B0', faint:'#6F7494',
  gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', blue:'#4B8FE0', amber:'#E0943A', purple:'#9B59B6',
}

export const LIGHT = {
  bg:'#F4F3EF', surface:'#FFFFFF', card:'#FAFAF8', border:'#E2DFD8',
  text:'#1A1C26', muted:'#595E7A', faint:'#6A6764',
  gold:'#A8862E', green:'#1A9E65', red:'#CC3333', blue:'#2B6CB0', amber:'#B5720A', purple:'#7B3FA0',
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
    document.body.style.background = darkMode ? '#0B0D14' : '#F4F3EF'
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
