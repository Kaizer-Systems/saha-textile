import assert from 'node:assert/strict';
import { test } from 'node:test';

import { secretsMatrix } from './secret-names.mjs';
import { loadInventory, SecretsError } from '../secrets/inventory.mjs';

test('lists set, empty and missing names per tier, and a folder Infisical could not read', () => {
	const inventory = loadInventory();
	const tierOf = Object.fromEntries(Object.entries(inventory.projects).map(([tier, p]) => [p.projectId, tier]));
	const [firstApi] = [...inventory.api].filter((n) => !inventory.developmentOnly.has(n)).sort();
	const matrix = secretsMatrix(inventory, ({ projectId, folder }) => {
		const tier = tierOf[projectId];
		if (tier === 'staging' && folder === 'api') throw new SecretsError('Not signed in to Infisical.');
		if (folder !== 'api') return [];
		return tier === 'dev'
			? [
					{ name: firstApi, empty: false },
					{ name: 'EXTRA_NAME', empty: true },
				]
			: [];
	});
	assert.deepEqual(
		matrix.tiers.map((t) => t.tier),
		['dev', 'staging', 'production'],
	);
	const api = matrix.folders.find((f) => f.folder === 'api');
	const row = (name) => api.rows.find((r) => r.name === name);
	assert.deepEqual(row(firstApi).cells, { dev: 'set', staging: 'unknown', production: 'missing' });
	assert.deepEqual(row('EXTRA_NAME'), {
		name: 'EXTRA_NAME',
		expected: false,
		devOnly: false,
		optional: false,
		cells: { dev: 'empty', staging: 'unknown', production: 'missing' },
	});
	assert.deepEqual(matrix.errors, [{ tier: 'staging', folder: 'api', message: 'Not signed in to Infisical.' }]);
	const consoleFolder = matrix.folders.find((f) => f.folder === 'release-console');
	if (consoleFolder) assert.equal(consoleFolder.rows[0].cells.production, 'not-here');
});
