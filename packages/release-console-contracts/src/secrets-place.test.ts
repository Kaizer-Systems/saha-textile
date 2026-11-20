import { describe, expect, it } from 'vitest';

import { repositorySchema } from './projects.js';
import { formatSecretsPlace, parseSecretsPlace, secretsSourceOf } from './secrets-place.js';

const repo = repositorySchema.parse({
	id: 'shop-web',
	name: 'shop-web',
	sourceCode: { vendor: 'github', repository: 'example-org/shop-web' },
	environments: [
		{ name: 'local', label: 'Local', secretsId: 'infisical', secretsPath: 'client-shop-dev · dev' },
		{ name: 'qa', label: 'QA', secretsId: 'infisical', secretsPath: 'client-shop-dev | qa | /api/' },
		{ name: 'staging', label: 'Staging', secretsId: 'infisical', secretsPath: '' },
		{ name: 'production', label: 'Production', secretsId: 'doppler', secretsPath: 'shop · prd' },
		{ name: 'demo', label: 'Demo' },
	],
	secrets: [
		{ id: 'infisical', vendor: 'infisical' },
		{ id: 'doppler', vendor: 'doppler' },
	],
});

describe('secrets places', () => {
	it('reads project/environment and an optional folder, typed with slashes', () => {
		expect(parseSecretsPlace('saha-textile-dev/dev')).toEqual({
			project: 'saha-textile-dev',
			environment: 'dev',
			folder: '/',
		});
		expect(parseSecretsPlace(' saha-textile-dev / dev / api / payments / ')).toEqual({
			project: 'saha-textile-dev',
			environment: 'dev',
			folder: '/api/payments',
		});
		expect(parseSecretsPlace('Example Project/Prod')?.environment).toBe('prod');
	});

	it('still reads the older dotted form', () => {
		expect(parseSecretsPlace('saha-textile-dev · dev · /api')).toEqual({
			project: 'saha-textile-dev',
			environment: 'dev',
			folder: '/api',
		});
		expect(parseSecretsPlace('Example Project · Prod')).toEqual({
			project: 'Example Project',
			environment: 'prod',
			folder: '/',
		});
		expect(parseSecretsPlace('a | b | /x/y/')).toEqual({ project: 'a', environment: 'b', folder: '/x/y' });
	});

	it('refuses text that could reach the command line oddly', () => {
		for (const bad of [
			'',
			'only-one',
			'only-one/',
			'-p/dev',
			'p/--env',
			'p/dev/a b',
			'-p · dev',
			'p · --env',
			'p · dev · api',
			'p · dev · /a b',
			'a·b·/c·d',
		])
			expect(parseSecretsPlace(bad), bad).toBeNull();
	});

	it('writes a place back the way it is typed', () => {
		expect(formatSecretsPlace({ project: 'p', environment: 'dev', folder: '/' })).toBe('p/dev');
		expect(formatSecretsPlace({ project: 'p', environment: 'dev', folder: '/api/x' })).toBe('p/dev/api/x');
		const place = { project: 'saha-textile-dev', environment: 'dev', folder: '/api' };
		expect(parseSecretsPlace(formatSecretsPlace(place))).toEqual(place);
	});

	it('follows each environment’s own setting', () => {
		expect(secretsSourceOf(repo, 'local')).toEqual({
			kind: 'infisical',
			vendor: 'infisical',
			place: { project: 'client-shop-dev', environment: 'dev', folder: '/' },
		});
		expect(secretsSourceOf(repo, 'qa')).toMatchObject({ kind: 'infisical', place: { folder: '/api' } });
		expect(secretsSourceOf(repo, 'staging')).toEqual({ kind: 'no-place', vendor: 'infisical', text: '' });
		expect(secretsSourceOf(repo, 'production')).toEqual({ kind: 'later', vendor: 'doppler', place: 'shop · prd' });
		expect(secretsSourceOf(repo, 'demo')).toEqual({ kind: 'none' });
		expect(secretsSourceOf(repo, 'nowhere')).toEqual({ kind: 'none' });
	});
});
