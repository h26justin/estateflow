import { createClient } from '@supabase/supabase-js'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

export const DARK = {
  bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
  text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58',
  gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', blue:'#4B8FE0', amber:'#E0943A', purple:'#9B59B6',
}

export const LIGHT = {
  bg:'#F4F3EF', surface:'#FFFFFF', card:'#FAFAF8', border:'#E2DFD8',
  text:'#1A1C26', muted:'#6B7191', faint:'#B0ADAB',
  gold:'#A8862E', green:'#1A9E65', red:'#CC3333', blue:'#2B6CB0', amber:'#B5720A', purple:'#7B3FA0',
}

export const ThemeContext = createContext({ T: LIGHT, darkMode: false, setDarkMode: () => {}, loadUserTheme: () => {} })

export function ThemeProvider({ children }) {
  // Default is LIGHT — localStorage only used as a fast local cache
  const [darkMode, setDarkModeState] = useState(() => {
    try {
      const stored = localStorage.getItem('ef_dark_mode')
      // If never set, default false (light)
      if (stored === null) return false
      return stored === 'true'
    } catch(e) { return false }
  })

  // Apply bg colour to body whenever theme changes
  useEffect(() => {
    document.body.style.background = darkMode ? '#0B0D14' : '#F4F3EF'
    try { localStorage.setItem('ef_dark_mode', String(darkMode)) } catch(e) {}
  }, [darkMode])

  // Called after login to load user's saved preference from Supabase
  const loadUserTheme = useCallback(async (userId, email) => {
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
      const { data } = await sb.from('user_profiles')
        .select('dark_mode').eq('user_id', userId).single()
      if (data && data.dark_mode !== null && data.dark_mode !== undefined) {
        setDarkModeState(data.dark_mode)
        try { localStorage.setItem('ef_dark_mode', String(data.dark_mode)) } catch(e) {}
      }
    } catch(e) {}
  }, [])

  // Wraps setDarkMode to also persist to Supabase if we have a user
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
