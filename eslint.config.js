import reactHooks from 'eslint-plugin-react-hooks'

// Lean lint gate: the one class of bug this repo has actually shipped is a
// hook called after a conditional early return (React #300 crash on signup,
// caught by the ErrorBoundary but fatal to the flow). rules-of-hooks makes
// that a hard CI failure. exhaustive-deps is an error too (2026-10, once the
// backlog reached zero): missing deps were the source of the stale-response
// bugs fixed that month. Where an effect is deliberately keyed to a narrower
// trigger (mount only, an id change), say why in a comment and use
// `// eslint-disable-next-line react-hooks/exhaustive-deps`.
export default [
  // Build output and agent worktrees (.claude/worktrees, full repo copies)
  // are not source.
  { ignores: ['dist/**', '.claude/**'] },
  // Disable-directives for rules this config doesn't enable (no-console) are
  // expected; don't flag them anywhere.
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
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]
