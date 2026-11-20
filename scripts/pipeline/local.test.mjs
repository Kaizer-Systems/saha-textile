import assert from 'node:assert/strict';
import test from 'node:test';

import { SecretsError } from '../secrets/inventory.mjs';
import { parseArgs } from './local.mjs';

test('the runner runs every stage by default, from one stage on, or one stage alone', () => {
	assert.deepEqual(parseArgs([]), {
		stages: ['checks', 'proof', 'images', 'release', 'deploy', 'record'],
		json: false,
	});
	assert.deepEqual(parseArgs(['--', '--from', 'images']).stages, ['images', 'release', 'deploy', 'record']);
	assert.deepEqual(parseArgs(['--only', 'release', '--json']), { stages: ['release'], json: true });
});

test('an unknown stage or option, or --from with --only, is refused', () => {
	assert.throws(
		() => parseArgs(['--only', 'publish']),
		(error) => error instanceof SecretsError && /Unknown stage "publish"/.test(error.message),
	);
	assert.throws(() => parseArgs(['--fast']), /Unknown option --fast/);
	assert.throws(() => parseArgs(['--from', 'images', '--only', 'record']), /--from or --only, not both/);
});
