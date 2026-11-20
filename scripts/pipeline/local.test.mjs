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

test('a run can name its branch; an unsafe name is refused', () => {
	assert.deepEqual(parseArgs(['--branch', 'feat/combined-after-pr6']), {
		stages: ['checks', 'proof', 'images', 'release', 'deploy', 'record'],
		json: false,
		branch: 'feat/combined-after-pr6',
	});
	assert.throws(() => parseArgs(['--branch', '-x']), /is not a branch name/);
	assert.throws(() => parseArgs(['--branch']), /is not a branch name/);
});

test('every run starts with a pull that only fast-forwards and never switches the branch', async () => {
	const { pullBranch } = await import('./local.mjs');
	/** A stand-in git: answers by the command's words; records what ran. */
	const gitWith = (answers) => {
		const ran = [];
		const git = (args) => {
			ran.push(args.join(' '));
			for (const [prefix, answer] of Object.entries(answers))
				if (args.join(' ').startsWith(prefix)) return answer;
			return { ok: true, out: '' };
		};
		return { git, ran };
	};
	const notes = [];
	const note = (t) => notes.push(t);
	const base = {
		'symbolic-ref': { ok: true, out: 'feat/x' },
		'rev-parse --verify --quiet refs/heads/feat/x': { ok: true, out: '' },
		'rev-parse --verify --quiet refs/remotes/origin/feat/x': { ok: false, out: '' },
		'rev-parse refs/heads/feat/x': { ok: true, out: 'aaa' },
	};
	// A branch only on this computer is built as it is.
	let g = gitWith(base);
	assert.deepEqual(pullBranch(undefined, { note, git: g.git }), {
		commit: 'aaa',
		branch: 'feat/x',
		checkedOut: true,
	});
	assert.ok(notes.some((n) => /only on this computer/.test(n)));
	// Behind GitHub and checked out: fast-forward in this folder.
	g = gitWith({
		'symbolic-ref': { ok: true, out: 'dev' },
		'rev-parse --verify': { ok: true, out: '' },
		'rev-list --count dev..origin/dev': { ok: true, out: '3' },
		'rev-list --count origin/dev..dev': { ok: true, out: '0' },
		'rev-parse refs/heads/dev': { ok: true, out: 'bbb' },
	});
	assert.equal(pullBranch('dev', { note, git: g.git }).commit, 'bbb');
	assert.ok(g.ran.includes('merge --ff-only origin/dev'));
	assert.ok(!g.ran.some((r) => r.startsWith('checkout') || r.startsWith('switch')));
	// Behind GitHub, another branch: its ref only.
	g = gitWith({
		'symbolic-ref': { ok: true, out: 'feat/x' },
		'rev-parse --verify': { ok: true, out: '' },
		'rev-list --count main..origin/main': { ok: true, out: '2' },
		'rev-list --count origin/main..main': { ok: true, out: '0' },
		'rev-parse refs/heads/main': { ok: true, out: 'ccc' },
	});
	assert.deepEqual(pullBranch('main', { note, git: g.git }), { commit: 'ccc', branch: 'main', checkedOut: false });
	assert.ok(g.ran.includes('fetch origin main:main'));
	// Moved on both sides: stop, a person merges.
	g = gitWith({
		'symbolic-ref': { ok: true, out: 'dev' },
		'rev-parse --verify': { ok: true, out: '' },
		'rev-list --count dev..origin/dev': { ok: true, out: '1' },
		'rev-list --count origin/dev..dev': { ok: true, out: '2' },
	});
	assert.throws(() => pullBranch('dev', { note, git: g.git }), /Merge them in a terminal/);
});
