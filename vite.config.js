import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Stamp a unique BUILD_ID into the service worker after the bundle is written.
// public/sw.js ships with the literal '__BUILD_ID__' placeholder; this plugin
// replaces it with a value derived from the current timestamp so each deploy
// gets its own cache bucket. Returning users on the previous deploy will then
// have their old caches dropped on the next SW activation.
function swVersionPlugin() {
  return {
    name: 'sw-version',
    closeBundle() {
      const swPath = resolve('dist/sw.js')
      if (!existsSync(swPath)) return
      const buildId = Date.now().toString(36)
      const content = readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId)
      writeFileSync(swPath, content)
      // eslint-disable-next-line no-console
      console.log(`[sw-version] Stamped BUILD_ID=${buildId}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  esbuild: {
    charset: 'utf8',
    // Only drop console.log and debugger, keep console.error for error monitoring
    pure: ['console.log', 'console.debug', 'console.info'],
    drop: ['debugger'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
