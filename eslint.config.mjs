import base from '@saha-textile/config/eslint';

/**
 * Infrastructure/framework/provider packages `core-domain` must never import —
 * NOT EVEN AS TYPES (owner lock: "Core must have no ... import — type or value —
 * of NestJS, Fastify, Mongoose, provider SDKs, or adapter packages").
 */
const CORE_FORBIDDEN_GROUPS = [
	'mongoose',
	'@saha-textile/adapters-*',
	'fastify',
	'@fastify/*',
	'@nestjs/*',
	'next',
	'react',
	'react-dom',
	'axios',
	'ioredis',
	'@aws-sdk/*',
	'bullmq',
	'sharp',
	'meilisearch',
	'vidstack',
	'@vidstack/*',
	'fluent-ffmpeg',
];

/**
 * Root ESLint flat config. Extends the shared baseline (@saha-textile/config/eslint)
 * and enforces the hexagonal dependency rule at the `core-domain` boundary.
 *
 * Two distinct bans (owner lock 2026-07-25, gate G-CORE-CONTRACTS — Option C):
 *   1. `@saha-textile/contracts` — TYPE-ONLY. `import type` is allowed because it is
 *      erased at compile time; a value import would give core a runtime dependency
 *      on contracts (and therefore on Zod), which the lock forbids.
 *   2. `zod` and every infrastructure/provider package — forbidden outright, in both
 *      type and value position, so core stays runtime-pure and swappable.
 *
 * `packages/core-domain/test/runtime-purity.test.ts` proves the same rule against the
 * COMPILED output, so the guarantee does not rest on lint alone.
 */
export default [
	...base,
	{
		files: ['packages/core-domain/**/*.ts'],
		rules: {
			// Superseded by the TypeScript-aware variant below (which understands `import type`).
			'no-restricted-imports': 'off',
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@saha-textile/contracts', '@saha-textile/contracts/*'],
							allowTypeImports: true,
							message:
								'core-domain may reference contract shapes through `import type` ONLY (G-CORE-CONTRACTS). A value import would make contracts/Zod a runtime dependency of core.',
						},
						{
							group: ['zod', 'zod/*'],
							message:
								'core-domain must stay runtime-pure: no Zod. Validate at the adapter/API boundary and pass plain domain values inward.',
						},
						{
							group: CORE_FORBIDDEN_GROUPS,
							message:
								'core-domain must not import infrastructure/adapters/frameworks/provider SDKs — type or value (hexagonal dependency rule). Depend on ports plus type-only contracts.',
						},
					],
				},
			],
		},
	},
];
