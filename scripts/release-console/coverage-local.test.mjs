import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { changedFiles, coverageLocal } from './coverage-local.mjs';

let root;
const git = (...args) => {
	const out = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	assert.equal(out.status, 0, out.stderr);
	return out.stdout;
};
const write = (path, text) => {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), text);
};

describe('this Mac’s coverage for the console', () => {
	before(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'coverage-local-')));
		git('init', '-q', '-b', 'dev');
		git('config', 'user.email', 'test@saha-textile.test');
		git('config', 'user.name', 'Test');
		git('config', 'commit.gpgsign', 'false');
		write('.gitignore', 'coverage\n.env\n');
		write('apps/a.ts', 'one\ntwo\n');
		git('add', '.');
		git('commit', '-q', '-m', 'first');
		git('checkout', '-q', '-b', 'feature');
		write('apps/a.ts', 'one\nTWO\nthree\n');
		git('commit', '-q', '-am', 'second');
		write('apps/b.ts', 'new\n');
		write('.env', 'SECRET=1\n');
	});
	after(() => rmSync(root, { recursive: true, force: true }));

	it('says there is nothing until pnpm coverage has run', () => {
		assert.deepEqual(coverageLocal('meta', {}, root), {
			off: true,
			message: 'This copy has no coverage reports yet. Run pnpm coverage, then open this screen again.',
		});
		mkdirSync(join(root, 'coverage', 'admin'), { recursive: true });
		assert.equal(coverageLocal('meta', {}, root).off, true);
	});

	it('describes the run and each measured workspace, with or without meta.json', () => {
		write('coverage/admin/coverage-final.json', '{"x":1}');
		write('coverage/admin/tests.json', '{"files":[]}');
		write('coverage/Not_A_Name/coverage-final.json', '{}');
		const plain = coverageLocal('meta', {}, root).data;
		assert.equal(plain.meta, null);
		assert.equal(plain.repository, null);
		git('remote', 'add', 'origin', 'git@github.com:Kaizer-Systems/saha-textile.git');
		assert.equal(coverageLocal('meta', {}, root).data.repository, 'Kaizer-Systems/saha-textile');
		git('remote', 'set-url', 'origin', 'https://github.com/Kaizer-Systems/saha-textile');
		assert.equal(coverageLocal('meta', {}, root).data.repository, 'Kaizer-Systems/saha-textile');
		assert.deepEqual(
			plain.workspaces.map((w) => w.name),
			['admin'],
		);
		assert.match(plain.workspaces[0].measuredAt, /^\d{4}-\d\d-\d\dT/);
		write('coverage/meta.json', '{"sha":"abc"}');
		assert.deepEqual(coverageLocal('meta', {}, root).data.meta, { sha: 'abc' });
	});

	it('hands over a workspace’s line data or test results, and refuses other names', () => {
		assert.deepEqual(coverageLocal('report', { ws: 'admin' }, root), { data: { x: 1 } });
		assert.deepEqual(coverageLocal('report', { ws: 'admin', part: 'tests' }, root), { data: { files: [] } });
		assert.deepEqual(coverageLocal('report', { ws: 'api' }, root), { data: null });
		assert.deepEqual(coverageLocal('report', { ws: '../x' }, root), {
			status: 400,
			message: 'That is not a workspace name.',
		});
		assert.equal(coverageLocal('report', {}, root).status, 400);
	});

	it('lists the copy’s files, new ones included and ignored ones left out', () => {
		assert.deepEqual(coverageLocal('files', {}, root).data.sort(), ['.gitignore', 'apps/a.ts', 'apps/b.ts']);
		assert.deepEqual(coverageLocal('files', {}, join(root, 'nowhere')), { data: [] });
	});

	it('gives a file’s text, and never a file git ignores or one outside the copy', () => {
		assert.deepEqual(coverageLocal('text', { path: 'apps/a.ts' }, root), { data: 'one\nTWO\nthree\n' });
		assert.deepEqual(coverageLocal('text', { path: 'apps/gone.ts' }, root), { data: null });
		assert.deepEqual(coverageLocal('text', { path: 'apps' }, root), { data: null });
		assert.deepEqual(coverageLocal('text', { path: '.env' }, root), {
			status: 403,
			message: 'That file is ignored by git, so the console does not show it.',
		});
		assert.equal(coverageLocal('text', { path: '../etc/passwd' }, root).status, 400);
		assert.equal(coverageLocal('text', { path: '/etc/passwd' }, root).status, 400);
		assert.equal(coverageLocal('text', {}, root).status, 400);
	});

	it('finds the lines changed since the last commit’s parent or since a branch, uncommitted ones included', () => {
		write('apps/a.ts', 'one\nTWO\nthree\nfour\n');
		assert.deepEqual(coverageLocal('diff', {}, root).data, { 'apps/a.ts': [2, 3, 4] });
		assert.deepEqual(coverageLocal('diff', { base: 'dev' }, root).data, { 'apps/a.ts': [2, 3, 4] });
		assert.deepEqual(coverageLocal('diff', { base: 'nope' }, root), {
			status: 404,
			message: 'This copy has no branch nope.',
		});
		assert.equal(coverageLocal('diff', { base: 'a b' }, root).status, 400);
		assert.deepEqual(coverageLocal('diff', {}, join(root, 'nowhere')), { data: {} });
	});

	it('answers unknown questions with a 404', () => {
		assert.equal(coverageLocal('other', {}, root).status, 404);
	});
});

describe('changed lines in a diff', () => {
	it('reads added lines per file and skips deleted files', () => {
		const diff = [
			'diff --git a/a.ts b/a.ts',
			'--- a/a.ts',
			'+++ b/a.ts',
			'@@ -2 +2,2 @@',
			'-old',
			'+new',
			'+more',
			'diff --git a/gone.ts b/gone.ts',
			'--- a/gone.ts',
			'+++ /dev/null',
			'@@ -1 +0,0 @@',
			'-x',
		].join('\n');
		assert.deepEqual(changedFiles(diff), { 'a.ts': [2, 3] });
		assert.deepEqual(changedFiles('+stray line before any file'), {});
	});
});
