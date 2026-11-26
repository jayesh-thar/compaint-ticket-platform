// ESLint flat config: recommended JS + TypeScript rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // `_name` marks a parameter that must exist but is unused (Express handlers).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `declare global { namespace Express { ... } }` is how Express request types are extended.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  }
);
