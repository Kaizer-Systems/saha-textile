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

test("one run at a time: a live run holds the lock, a dead run's lock is taken over, and releasing frees it", async () => {
	const { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { acquireLock, LOCK_FILE } = await import('./local.mjs');
	const root = mkdtempSync(join(tmpdir(), 'pipeline-lock-'));
	try {
		const release = acquireLock(root, { commit: 'abc' });
		assert.ok(existsSync(join(root, LOCK_FILE)));
		assert.throws(
			() => acquireLock(root, { commit: 'def', isRunning: () => true }),
			/Another pnpm pipeline:local run is in progress/,
		);
		release();
		assert.equal(existsSync(join(root, LOCK_FILE)), false);
		mkdirSync(join(root, '.local-release'), { recursive: true });
		writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: 999999, started: 'then' }));
		const again = acquireLock(root, { commit: 'ghi', isRunning: () => false });
		again();
		writeFileSync(join(root, LOCK_FILE), 'not json');
		acquireLock(root, { commit: 'jkl' })();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
