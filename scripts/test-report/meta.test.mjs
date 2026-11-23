import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coverageMeta, gitAnswer } from './meta.mjs';

const results = [
	{ name: 'admin', dir: 'apps/admin', passed: true, ok: true, full: false, line: 'PASS admin' },
	{ name: 'api', dir: 'apps/api', passed: false, ok: false, full: false, line: 'FAIL api' },
];
const now = new Date('2026-11-24T02:50:00.000Z');

describe('the coverage run description', () => {
	it('names the CI run, its commit and branch, and never reports uncommitted changes there', () => {
		const asked = [];
		const meta = coverageMeta({
			root: '/home/runner/work/saha-textile/saha-textile',
			env: {
				GITHUB_SHA: 'abc123',
				GITHUB_HEAD_REF: 'feat/combined-after-pr6',
				GITHUB_REF_NAME: '7/merge',
				GITHUB_RUN_ID: '901',
			},
			results,
			floor: 10,
			now,
			git: (args) => (asked.push(args), 'x'),
		});
		assert.deepEqual(asked, []);
		assert.deepEqual(meta, {
			root: '/home/runner/work/saha-textile/saha-textile',
			sha: 'abc123',
			ref: 'feat/combined-after-pr6',
			runId: '901',
			uncommitted: false,
			finishedAt: '2026-11-24T02:50:00.000Z',
			floor: 10,
			workspaces: {
				admin: {
					dir: 'apps/admin',
					passed: true,
					ok: true,
					full: false,
					measuredAt: '2026-11-24T02:50:00.000Z',
				},
				api: { dir: 'apps/api', passed: false, ok: false, full: false, measuredAt: '2026-11-24T02:50:00.000Z' },
			},
		});
	});

	it('reads the branch name of a push run when there is no pull request', () => {
		const meta = coverageMeta({
			root: '/r',
			env: { GITHUB_SHA: 's', GITHUB_REF_NAME: 'dev', GITHUB_RUN_ID: '1' },
			results: [],
			floor: 10,
			now,
		});
		assert.equal(meta.ref, 'dev');
	});

	it('asks git on this Mac, and marks a copy with uncommitted changes', () => {
		const answers = {
			'rev-parse HEAD': '03ae04a6',
			'rev-parse --abbrev-ref HEAD': 'claude/search-fix-01720e',
			'status --porcelain': ' M a.ts',
		};
		const meta = coverageMeta({
			root: '/r',
			env: {},
			results: [],
			floor: 10,
			now,
			git: (args) => answers[args.join(' ')],
		});
		assert.deepEqual(
			[meta.sha, meta.ref, meta.runId, meta.uncommitted],
			['03ae04a6', 'claude/search-fix-01720e', null, true],
		);
		const clean = coverageMeta({
			root: '/r',
			env: {},
			results: [],
			floor: 10,
			now,
			git: (args) => (args[0] === 'status' ? '' : 'x'),
		});
		assert.equal(clean.uncommitted, false);
	});

	it('gives git’s answer, or nothing when git fails', () => {
		assert.equal(
			gitAnswer('/r', ['rev-parse', 'HEAD'], () => ({ status: 0, stdout: 'abc\n' })),
			'abc',
		);
		assert.equal(
			gitAnswer('/r', ['rev-parse', 'HEAD'], () => ({ status: 128, stdout: '' })),
			'',
		);
		assert.match(gitAnswer(process.cwd(), ['rev-parse', '--show-toplevel']), /saha-textile/);
	});

	it('uses the time of the call when none is given', () => {
		const before = Date.now();
		const meta = coverageMeta({
			root: '/r',
			env: { GITHUB_RUN_ID: '1', GITHUB_SHA: 's', GITHUB_REF_NAME: 'r' },
			results: [],
			floor: 10,
		});
		assert.ok(Date.parse(meta.finishedAt) >= before - 1000);
	});

	it('keeps the other workspaces of an earlier run of the same copy, and nothing from another copy', () => {
		const env = { GITHUB_SHA: 's', GITHUB_REF_NAME: 'r', GITHUB_RUN_ID: '2' };
		const older = {
			dir: 'apps/storefront',
			passed: true,
			ok: true,
			full: true,
			measuredAt: '2026-11-23T20:00:00.000Z',
		};
		const previous = { root: '/r', workspaces: { storefront: older, admin: { dir: 'apps/admin', passed: false } } };
		const meta = coverageMeta({ root: '/r', env, results: results.slice(0, 1), floor: 10, now, previous });
		assert.deepEqual(Object.keys(meta.workspaces).sort(), ['admin', 'storefront']);
		assert.deepEqual(meta.workspaces.storefront, older);
		assert.equal(meta.workspaces.admin.passed, true);
		assert.deepEqual(
			Object.keys(coverageMeta({ root: '/other', env, results: [], floor: 10, now, previous }).workspaces),
			[],
		);
		assert.deepEqual(
			Object.keys(
				coverageMeta({ root: '/r', env, results: [], floor: 10, now, previous: { root: '/r' } }).workspaces,
			),
			[],
		);
	});

	it('asks the real repository when no git answer is given', () => {
		const meta = coverageMeta({ root: process.cwd(), env: {}, results: [], floor: 10, now });
		assert.match(meta.sha, /^[0-9a-f]{40}$/);
		assert.equal(typeof meta.uncommitted, 'boolean');
	});
});
