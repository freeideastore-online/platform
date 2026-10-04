import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.wrangler/**', 'store/docs/**',
      '**/coverage/**', 'test-results/**', 'playwright-report/**', '.husky/_/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Existing APIs and test doubles use any; unused declarations are checked by
    // TypeScript where enabled. Introduce these style policies separately.
    rules: {
      'no-debugger': 'error',
      'no-async-promise-executor': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
