import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveBatch } from './secret-save.mjs';
import { loadInventory } from '../secrets/inventory.mjs';

const inventory = loadInventory();
const staging = {
	project: inventory.projects.staging.name,
	environment: inventory.projects.staging.environment,
	folder: '/',
};

test('saves one place’s batch through applySecretChanges and answers names only', () => {
	let given;
	const answer = saveBatch(
		{ place: staging, changes: [{ folder: 'api', name: 'COOKIE_DOMAIN', value: 'test-value-not-real' }] },
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

test('writes only a place in the name list, and only inside its folder', () => {
	const apply = () => {
		throw new Error('nothing may be written');
	};
	assert.throws(
		() =>
			saveBatch(
				{
					place: { project: 'client-shop-dev', environment: 'dev', folder: '/' },
					changes: [{ folder: 'api', name: 'A', value: 'test-value-not-real' }],
				},
				{ inventory, apply },
			),
		/read only here/,
	);
	assert.throws(
		() =>
			saveBatch(
				{
					place: { ...staging, folder: '/api' },
					changes: [{ folder: 'backup', name: 'A', value: 'test-value-not-real' }],
				},
				{ inventory, apply },
			),
		/outside this environment's place/,
	);
});
