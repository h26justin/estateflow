import { createContext, useContext, useState, useEffect } from 'react'

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

export const ThemeContext = createContext({ T: DARK, darkMode: true, setDarkMode: () => {} })

export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('ef_dark_mode') !== 'false' } catch(e) { return true }
  })

  useEffect(() => {
    try { localStorage.setItem('ef_dark_mode', darkMode) } catch(e) {}
    document.body.style.background = darkMode ? '#0B0D14' : '#F4F3EF'
  }, [darkMode])

  const T = darkMode ? DARK : LIGHT
  return (
    <ThemeContext.Provider value={{ T, darkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
