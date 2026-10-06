// Minimal ESLint flat config: the recommended JavaScript and typescript-eslint
// rule sets over the TypeScript sources, unit tests and root build scripts.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'release/',
      'web-dist/',
      'test-results/',
      'playwright-report/',
      'build/',
      'web/',
      'examples/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Allow `const { omitted, ...rest } = obj` to drop a property on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  }
);
