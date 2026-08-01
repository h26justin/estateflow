import reactHooks from 'eslint-plugin-react-hooks'

// Lean lint gate: the one class of bug this repo has actually shipped is a
// hook called after a conditional early return (React #300 crash on signup,
// caught by the ErrorBoundary but fatal to the flow). rules-of-hooks makes
// that a hard CI failure. exhaustive-deps stays off — the codebase manages
// effect deps deliberately in several places and a wall of warnings would
// bury real errors.
export default [
  // Disable-directives for rules this config doesn't enable (no-console,
  // exhaustive-deps) are expected — don't warn about them anywhere.
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
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]
