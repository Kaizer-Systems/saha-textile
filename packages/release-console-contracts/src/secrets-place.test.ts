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
	it('reads project, environment and an optional folder', () => {
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
		for (const bad of ['', 'only-one', '-p · dev', 'p · --env', 'p · dev · api', 'p · dev · /a b', 'a·b·/c·d'])
			expect(parseSecretsPlace(bad), bad).toBeNull();
	});

	it('writes a place back the way the wizard shows it', () => {
		expect(formatSecretsPlace({ project: 'p', environment: 'dev', folder: '/' })).toBe('p · dev');
		expect(formatSecretsPlace({ project: 'p', environment: 'dev', folder: '/api' })).toBe('p · dev · /api');
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
