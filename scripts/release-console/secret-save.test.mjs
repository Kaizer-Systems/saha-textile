import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveBatch } from './secret-save.mjs';
import { loadInventory } from '../secrets/inventory.mjs';

test('saves one tier’s batch through applySecretChanges and answers names only', () => {
	const inventory = loadInventory();
	let given;
	const answer = saveBatch(
		{ tier: 'staging', changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }] },
		{
			inventory,
			apply: (changes) => {
				given = changes;
				return [{ tier: 'staging', folder: 'api', names: ['COOKIE_DOMAIN'], saved: true }];
			},
		},
	);
	assert.deepEqual(given, [{ tier: 'staging', folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }]);
	assert.deepEqual(answer, {
		tier: 'staging',
		project: inventory.projects.staging.name,
		environment: inventory.projects.staging.environment,
		results: [{ folder: 'api', names: ['COOKIE_DOMAIN'], saved: true, error: null }],
	});
	assert.ok(!JSON.stringify(answer).includes('test-value-not-real'), 'no value comes back');
});
