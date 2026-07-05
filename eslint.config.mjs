import base from '@saha-textile/config/eslint';

/**
 * Root ESLint flat config. Extends the shared baseline (@saha-textile/config/eslint)
 * and adds the hexagonal architecture boundary: packages/core-domain must not
 * import any infrastructure/adapter/framework code.
 */
export default [
	...base,
	{
		files: ['packages/core-domain/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'mongoose',
								'@saha-textile/adapters-*',
								'fastify',
								'@nestjs/*',
								'next',
								'react',
								'react-dom',
								'axios',
								'ioredis',
								'@aws-sdk/*',
							],
							message:
								'core-domain must not import infrastructure/adapters/frameworks (hexagonal dependency rule). Depend on ports + contracts only.',
						},
					],
				},
			],
		},
	},
];
