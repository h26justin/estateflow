import reactHooks from 'eslint-plugin-react-hooks'

// Lean lint gate: the one class of bug this repo has actually shipped is a
// hook called after a conditional early return (React #300 crash on signup,
// caught by the ErrorBoundary but fatal to the flow). rules-of-hooks makes
// that a hard CI failure. exhaustive-deps is a warning, not an error: the
// codebase manages effect deps deliberately in many places, so existing
// sites are not mass-fixed, but new missing deps (the source of the stale-
// response bugs fixed in 2026-10) at least show up in editors and lint
// output without failing CI.
export default [
  // Build output and agent worktrees (.claude/worktrees, full repo copies)
  // are not source.
  { ignores: ['dist/**', '.claude/**'] },
  // Disable-directives for rules this config doesn't enable (no-console) or
  // only warns on (exhaustive-deps) are expected; don't flag them anywhere.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
