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
    apply: 'build',
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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // Agent worktrees live under .claude/worktrees and carry their own copies
    // of the test-suite; never collect them from the main checkout.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
  build: {
    chunkSizeWarningLimit: 600,
    // Vite 8 bundles with Rolldown and minifies with Oxc. The old esbuild
    // block (pure console.log/debug/info, drop debugger) maps to these:
    // console.error/warn stay for error monitoring, debugger statements are
    // dropped by the Oxc minifier by default (compress.dropDebugger).
    rolldownOptions: {
      treeshake: {
        manualPureFunctions: ['console.log', 'console.debug', 'console.info'],
      },
      output: {
        // Replaces the removed object form of manualChunks. React and
        // supabase-js change rarely, so they get long-lived vendor chunks.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'supabase-vendor', test: /node_modules[\\/]@supabase[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
