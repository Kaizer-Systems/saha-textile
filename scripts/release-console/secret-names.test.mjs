import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inside, placeFromArgs, placeSecrets, tierOfPlace, tierSecrets } from './secret-names.mjs';
import { loadInventory, SecretsError } from '../secrets/inventory.mjs';

const inventory = loadInventory();

test('reads only the asked tier’s project and folders, as set, empty or missing', () => {
	const asked = [];
	const [firstApi] = [...inventory.api].filter((n) => !inventory.developmentOnly.has(n)).sort();
	const view = tierSecrets(inventory, 'staging', ({ projectId, environment, folder }) => {
		asked.push(`${projectId}/${environment}/${folder}`);
		if (folder === 'backup') throw new SecretsError('Not signed in to Infisical.');
		return folder === 'api'
			? [
					{ name: firstApi, empty: false },
					{ name: 'EXTRA_NAME', empty: true },
				]
			: [];
	});
	const staging = inventory.projects.staging;
	assert.equal(view.project, staging.name);
	assert.equal(view.environment, staging.environment);
	assert.ok(asked.every((a) => a.startsWith(`${staging.projectId}/${staging.environment}/`)));
	assert.ok(!view.folders.some((f) => f.folder === 'release-console'), 'the console’s keys live in dev only');
	const api = view.folders.find((f) => f.folder === 'api');
	assert.equal(api.rows.find((r) => r.name === firstApi).state, 'set');
	assert.equal(api.rows.find((r) => r.name === firstApi).writable, true, 'listed names can take a value');
	assert.deepEqual(
		api.rows.find((r) => r.name === 'EXTRA_NAME'),
		{
			name: 'EXTRA_NAME',
			expected: false,
			devOnly: false,
			optional: false,
			writable: false,
			requiredForRelease: false,
			mayDeployBlank: false,
			state: 'empty',
		},
	);
	assert.ok(!api.rows.some((r) => r.devOnly), 'dev-only names are not expected in staging');
	assert.ok(api.rows.some((r) => r.state === 'missing'));
	assert.deepEqual(view.errors, [{ folder: 'backup', message: 'Not signed in to Infisical.' }]);
	assert.ok(view.folders.find((f) => f.folder === 'backup').rows.every((r) => r.state === 'unknown'));
});

test('refuses an unknown tier', () => {
	assert.throws(() => tierSecrets(inventory, 'qa', () => []), /Unknown tier/);
});

const placeOf = (tier, folder = '/') => ({
	project: inventory.projects[tier].name,
	environment: inventory.projects[tier].environment,
	folder,
});

test('a place in the name list reads that tier, narrowed to its folder', () => {
	assert.equal(tierOfPlace(inventory, placeOf('production')), 'production');
	assert.equal(tierOfPlace(inventory, { ...placeOf('production'), environment: 'dev' }), null);
	const asked = [];
	const view = placeSecrets(inventory, placeOf('local', '/api'), {
		list: ({ folder }) => {
			asked.push(folder);
			return [];
		},
		project: () => {
			throw new Error('a name-list place needs no project look-up');
		},
	});
	assert.deepEqual(asked, ['api']);
	assert.equal(view.tier, 'local');
	assert.equal(view.folder, '/api');
	assert.ok(view.folders[0].rows.some((r) => r.writable && r.state === 'missing'));
});

test('any other place is read only: names as found, nothing expected or writable', () => {
	const asked = [];
	const view = placeSecrets(
		inventory,
		{ project: 'client-shop-dev', environment: 'qa', folder: '/' },
		{
			project: (name) => ({ id: 'id-1', name, environments: ['dev', 'qa'] }),
			folders: ({ folder }) => (folder === '/' ? ['api', 'web'] : []),
			list: ({ projectId, environment, folder }) => {
				asked.push(`${projectId}/${environment}/${folder}`);
				if (folder === 'web') throw new SecretsError('Not signed in to Infisical.');
				return folder === 'api' ? [{ name: 'SHOP_KEY', empty: true }] : [];
			},
		},
	);
	assert.deepEqual(asked, ['id-1/qa/', 'id-1/qa/api', 'id-1/qa/web']);
	assert.equal(view.tier, null);
	assert.equal(view.project, 'client-shop-dev');
	assert.deepEqual(
		view.folders.map((f) => f.folder),
		['api', 'web'],
		'an empty top folder with folders inside is left out',
	);
	assert.deepEqual(view.folders[0].rows, [
		{ name: 'SHOP_KEY', expected: false, devOnly: false, optional: false, writable: false, state: 'empty' },
	]);
	assert.deepEqual(view.errors, [{ folder: 'web', message: 'Not signed in to Infisical.' }]);
});

test('a project without that environment says which it has', () => {
	assert.throws(
		() =>
			placeSecrets(
				inventory,
				{ project: 'client-shop-dev', environment: 'prod', folder: '/' },
				{ project: (name) => ({ id: 'x', name, environments: ['dev'] }) },
			),
		/has no environment prod; it has dev/,
	);
});

test('folders inside a place, and arguments that are refused', () => {
	assert.ok(inside({ folder: '/' }, 'api'));
	assert.ok(inside({ folder: '/api' }, 'api'));
	assert.ok(inside({ folder: '/backend' }, 'backend/api'));
	assert.ok(!inside({ folder: '/api' }, 'apis'));
	assert.deepEqual(placeFromArgs(['n', 's', '--project', 'p', '--environment', 'dev']), {
		project: 'p',
		environment: 'dev',
		folder: '/',
	});
	for (const bad of [
		['--project', '-x', '--environment', 'dev'],
		['--project', 'p', '--environment', '--folder'],
		['--project', 'p', '--environment', 'dev', '--folder', 'api'],
	])
		assert.throws(() => placeFromArgs(bad), /Give a place/);
});

test('marks /api names a release needs, and the ones a server deploy may leave blank', () => {
	const tagged = {
		...inventory,
		requiredForRelease: ['MSG91_AUTH_KEY', 'PORT'],
		mayDeployBlank: new Set(['MSG91_AUTH_KEY']),
	};
	const view = tierSecrets(tagged, 'staging', ({ folder }) =>
		folder === 'api'
			? [
					{ name: 'MSG91_AUTH_KEY', empty: true },
					{ name: 'PORT', empty: false },
				]
			: [],
	);
	const api = view.folders.find((f) => f.folder === 'api');
	const row = (n) => api.rows.find((r) => r.name === n);
	assert.deepEqual([row('MSG91_AUTH_KEY').requiredForRelease, row('MSG91_AUTH_KEY').mayDeployBlank], [true, true]);
	assert.deepEqual([row('PORT').requiredForRelease, row('PORT').mayDeployBlank], [true, false]);
	for (const f of view.folders.filter((x) => x.folder !== 'api'))
		for (const r of f.rows) assert.equal(r.requiredForRelease || r.mayDeployBlank, false);
});
