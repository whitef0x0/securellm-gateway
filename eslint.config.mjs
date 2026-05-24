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
    // Config loader and tests read process.env directly; scripts use console for operator output.
    files: ['src/config/**', 'src/scripts/**', 'tests/**', '**/*.config.*'],
    rules: { 'no-process-env': 'off', 'no-console': 'off' },
  },
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
);
