// npm run lint: the recommended rules, with the globals each part runs among. The site's
// modules run in the page and in workers; tests and tools in Node.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['site/vendor/', '.tmp-*/'] }, // the libraries, as npm ships them; local scratch
  js.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  { files: ['site/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.worker, geodesic: 'readonly' } } },
  { files: ['test/**/*.mjs', 'tools/**/*.mjs', '*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser, map: 'readonly', drawing: 'readonly' } } }, // map, drawing: in page.evaluate
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }], eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-var': 'error', 'prefer-const': 'error', 'no-unused-expressions': ['error', { allowTernary: true }] } },
];
