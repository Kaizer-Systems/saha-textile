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
 * Packages `http-transport` must never import. It is bundled directly into both browser
 * apps, so a framework or provider import here would land in every visitor's download —
 * and a value import of contracts would drag Zod in with it.
 */
const TRANSPORT_FORBIDDEN_GROUPS = [
	'@angular/*',
	'rxjs',
	'rxjs/*',
	'@analogjs/*',
	'@nestjs/*',
	'fastify',
	'@fastify/*',
	'mongoose',
	'@saha-textile/adapters-*',
	'@saha-textile/core-domain',
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
	{
		/**
		 * `@saha-textile/http-transport` is the shared browser transport primitive (auth
		 * matrix §2.2). Its value is that importing it drags nothing else into an Angular
		 * bundle, so the same two-tier ban as core applies for a different reason:
		 *
		 *   1. `@saha-textile/contracts` — TYPE-ONLY, and only in tests, where the drift
		 *      guard lives. A value import would make Zod a runtime dependency of both
		 *      browser bundles as a side effect of using the transport — pre-empting the
		 *      contracts-adoption pass that is supposed to weigh that cost deliberately.
		 *   2. Zod, Angular, RxJS, Analog, NestJS, Fastify, Mongoose and the adapter/core
		 *      packages — forbidden outright, type or value, so the primitive stays
		 *      framework-free and equally consumable by storefront, admin and any future
		 *      non-Angular client.
		 *
		 * `packages/http-transport/test/runtime-purity.test.ts` proves the same rule against
		 * the COMPILED output, so the guarantee does not rest on lint alone.
		 */
		files: ['packages/http-transport/**/*.ts'],
		rules: {
			'no-restricted-imports': 'off',
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@saha-textile/contracts', '@saha-textile/contracts/*'],
							allowTypeImports: true,
							message:
								'http-transport may reference contract shapes through `import type` ONLY. A value import would pull Zod into both Angular bundles through the transport primitive.',
						},
						{
							group: ['zod', 'zod/*'],
							message:
								'http-transport must stay dependency-free: no Zod. Narrow untrusted response shapes with the local structural guards in `errors.ts`.',
						},
						{
							group: TRANSPORT_FORBIDDEN_GROUPS,
							message:
								'http-transport must stay framework-free — type or value. It is bundled into both browser apps and must be consumable by any future non-Angular client; app-specific wiring belongs in that app`s HTTP adapter.',
						},
					],
				},
			],
		},
	},
];
