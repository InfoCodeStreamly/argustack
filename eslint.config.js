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
      'src/board/**',
      '.stryker-tmp/**',
      'mutation-reports/**',
      'coverage/**',
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
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/promise-function-async': 'error',

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
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-meaningless-void-operator': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      '@typescript-eslint/prefer-reduce-type-parameter': 'error',
      '@typescript-eslint/prefer-return-this-type': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',

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
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-var-requires': 'error',

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
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],

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
      'no-param-reassign': ['error', { props: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      'no-implicit-coercion': 'error',
      'no-return-assign': ['error', 'always'],
      'no-unneeded-ternary': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-nested-ternary': 'error',

      // === CLI project: console is OK (it's a CLI!) ===
      'no-console': 'off',

      // === Relax a couple for CLI ergonomics ===
      '@typescript-eslint/no-extraneous-class': 'off',  // use case classes are fine
    },
  },
);
