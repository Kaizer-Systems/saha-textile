import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat-config baseline for the whole monorepo.
 *
 * Framework-specific configs (eslint-config-next for the Next apps, NestJS rules
 * for the API) are layered on per-app once the real UI/feature work lands.
 */
export default tseslint.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/.next/**',
			'**/.turbo/**',
			'**/coverage/**',
			'**/*.config.{js,cjs,mjs}',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
		rules: {
			// TypeScript already reports undefined identifiers; the core rule
			// produces false positives on types/globals in .ts(x) files.
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
);
