/**
 * @fileoverview ESLint Flat Config — strict TypeScript linting for Argustack CLI
 *
 * Uses typescript-eslint strictTypeChecked + stylisticTypeChecked — maximum strictness.
 * No React, no browser — pure Node.js CLI/MCP project.
 *
 * @see https://typescript-eslint.io/getting-started
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ─── Ignores ──────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'templates/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  // ─── Base ESLint ──────────────────────────────────────────────
  eslint.configs.recommended,

  // ─── TypeScript: strict + type-checked + stylistic ────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // ─── Parser: type-aware linting ───────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        project: ['tsconfig.json', 'tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ─── Custom rules: ERRORS, not warnings ───────────────────────
  {
    rules: {
      // === Type safety: ALL errors ===
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // === Promises: ALWAYS handle ===
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      // === Strict checks ===
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-shadow': 'error',
      'no-shadow': 'off',

      // === Import/export discipline ===
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // === Code quality ===
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',

      // === Naming convention ===
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE', 'PascalCase'],
        },
        {
          selector: 'property',
          format: null,  // properties can be anything (JSON keys, API responses)
        },
      ],

      // === Core JS rules ===
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'curly': ['error', 'all'],
      'no-param-reassign': 'error',
      'no-var': 'error',
      'prefer-const': 'error',

      // === CLI project: console is OK (it's a CLI!) ===
      'no-console': 'off',

      // === Relax a couple for CLI ergonomics ===
      '@typescript-eslint/no-extraneous-class': 'off',  // use case classes are fine
    },
  },
);
