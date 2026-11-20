import assert from 'node:assert/strict';
import test from 'node:test';

import { loadInventory } from './inventory.mjs';
import { listFolderNames, secretsScreenPlan } from './listing.mjs';

test('a folder is listed as sorted names with empty flags, and no value survives', () => {
	const calls = [];
	const rows = listFolderNames({
		projectId: 'p1',
		environment: 'dev',
		folder: 'api',
		read: (options) => {
			calls.push(options);
			return new Map([
				['ZED', 'zz-secret-value'],
				['ALPHA', '  '],
				['MID', 'zz-other-value'],
			]);
		},
	});
	assert.deepEqual(rows, [
		{ name: 'ALPHA', updatedAt: null, empty: true },
		{ name: 'MID', updatedAt: null, empty: false },
		{ name: 'ZED', updatedAt: null, empty: false },
	]);
	assert.ok(!JSON.stringify(rows).includes('zz-'), 'no value in the result');
	assert.deepEqual(calls[0], { projectId: 'p1', environment: 'dev', folder: 'api', notes: undefined });
});

test('the screen lists every tier with its four shop folders, plus the other folders that tier holds', () => {
	const plan = secretsScreenPlan(loadInventory());
	assert.deepEqual(
		plan.map((row) => row.tier),
		['dev', 'staging', 'production'],
	);
	const dev = plan[0];
	assert.equal(dev.project, 'saha-textile-dev');
	assert.deepEqual(dev.folders.slice(0, 4), ['api', 'backup', 'infrastructure', 'deployment']);
	assert.ok(dev.folders.includes('release-console') && dev.folders.includes('github-actions'));
	assert.deepEqual(plan[2].folders, ['api', 'backup', 'infrastructure', 'deployment']);
	assert.equal(plan[2].environment, 'prod');
});
