import { useLayoutEffect } from 'react'

// Marks <html> with class "ef-app" while the signed-in app shell is mounted.
// The element-level and layout rules in src/styles/app.css (`:where(.ef-app) …`)
// only apply under it, so the marketing site and login page keep their own
// resets. Replaces the <style>{CSS}</style> the shell used to render, with the
// same lifetime: on while mounted, off on unmount.
export const APP_SHELL_CLASS = 'ef-app'

export default function AppShellStyles() {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.add(APP_SHELL_CLASS)
    return () => root.classList.remove(APP_SHELL_CLASS)
  }, [])
  return null
}
