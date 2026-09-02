import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// src/lib/api/index.js re-exports every module with `export *`. When two
// modules export the same name, ES modules silently drop it and callers get
// `(void 0) is not a function` at runtime — which is exactly what broke the
// Short-Term Let Income page. Fail the build instead.
describe('api module exports', () => {
  it('have no duplicate exported names across modules', () => {
    const dir = join(process.cwd(), 'src/lib/api')
    const seen = new Map()
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js')) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = m[1]
        if (seen.has(name)) throw new Error(`Duplicate export "${name}" in ${f} and ${seen.get(name)}`)
        seen.set(name, f)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})
