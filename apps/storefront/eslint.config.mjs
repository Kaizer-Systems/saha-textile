// eslint.config.js
import tseslint from '@typescript-eslint/eslint-plugin';
import parserTs from '@typescript-eslint/parser';
import angularEslint from '@angular-eslint/eslint-plugin';
import angularTemplateParser from '@angular-eslint/template-parser';
import angularTemplatePlugin from '@angular-eslint/eslint-plugin-template';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['.angular/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: Object.fromEntries(
        Object.entries({
          ...globals.browser,
          ...globals.node,
          ...globals.es2021,
          Selector: 'readonly',
          State: 'readonly',
          Action: 'readonly',
        }).map(([key, value]) => [key.trim(), value]),
      ),
    },
    plugins: {
      '@typescript-eslint': tseslint,
      '@angular-eslint': angularEslint,
      import: importPlugin,
      prettier,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      // ✅ Prettier
      'prettier/prettier': 'warn',
      quotes: ['warn', 'single'],
      semi: ['warn', 'always'],
      indent: 'off',

      // ✅ TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',

      // ✅ Angular
      '@angular-eslint/component-class-suffix': 'off',
      '@angular-eslint/directive-class-suffix': ['error', { suffixes: ['Directive'] }],
      '@angular-eslint/no-empty-lifecycle-method': 'warn',
      '@angular-eslint/use-lifecycle-interface': 'off',

      // ✅ Import Sorting
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@angular/**',
              group: 'external',
              position: 'before',
            },
            {
              pattern: 'src/app/**',
              group: 'internal',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: [],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/no-unresolved': 'error',
      'import/no-duplicates': 'error',
      'import/first': 'error',
      'import/newline-after-import': ['warn', { count: 1 }],

      // ✅ NGXS Naming & Best Practices
      '@typescript-eslint/naming-convention': [
        'warn',

        // ✅ State classes must end with "State"
        {
          selector: 'class',
          format: ['PascalCase'],
          custom: {
            regex: 'State$',
            match: true,
          },
          filter: {
            regex: '.*State$',
            match: true,
          },
        },

        // ✅ Action classes must end with "Action"
        {
          selector: 'class',
          format: ['PascalCase'],
          custom: {
            regex: 'Action$',
            match: true,
          },
          filter: {
            regex: '.*Action$',
            match: true,
          },
        },

        // ✅ Service classes must end with "Service"
        {
          selector: 'class',
          format: ['PascalCase'],
          custom: {
            regex: 'Service$',
            match: true,
          },
          filter: {
            regex: '.*Service$',
            match: true,
          },
        },

        // ✅ Modal classes must end with "Modal"
        {
          selector: 'class',
          format: ['PascalCase'],
          custom: {
            regex: 'Modal$',
            match: true,
          },
          filter: {
            regex: '.*Modal$',
            match: true,
          },
        },

        // ✅ Directive classes must end with "Directive"
        {
          selector: 'class',
          format: ['PascalCase'],
          custom: {
            regex: 'Directive$',
            match: true,
          },
          filter: {
            regex: '.*Directive$',
            match: true,
          },
        },

        // ✅ Fallback: all other classes must be PascalCase (e.g., Components, Models, etc.)
        {
          selector: 'class',
          format: ['PascalCase'],
        },
      ],

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
    },
  },
  {
    files: ['**/*.html'],
    languageOptions: {
      parser: angularTemplateParser,
    },
    plugins: {
      '@angular-eslint/template': angularTemplatePlugin,
    },
    rules: {
      // ✅ Angular Template Rules
      '@angular-eslint/template/no-negated-async': 'off',
      '@angular-eslint/template/banana-in-box': 'error',
      '@angular-eslint/template/eqeqeq': 'error',
      '@angular-eslint/template/alt-text': 'warn',
    },
  },
  eslintConfigPrettier,
];
