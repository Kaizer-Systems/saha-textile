import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tierSecrets } from './secret-names.mjs';
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
