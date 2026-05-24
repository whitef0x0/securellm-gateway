import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Force all output through pino so nothing bypasses log redaction.
      'no-console': 'error',
      // Force env access through config/index.ts (single validated source).
      'no-process-env': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // The config loader and tests are the only places allowed to read process.env directly.
    files: ['src/config/**', 'tests/**', '**/*.config.*'],
    rules: { 'no-process-env': 'off', 'no-console': 'off' },
  },
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
);
