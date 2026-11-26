import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRANCH_NAME, checkoutBranches, menusFileAt } from './git-branches.mjs';

/** A stand-in git that answers by the command's first words. */
const gitWith = (answers) => {
	const ran = [];
	const run = async (args) => {
		ran.push(args.join(' '));
		for (const [prefix, answer] of Object.entries(answers)) if (args.join(' ').startsWith(prefix)) return answer;
		return { ok: false, out: '' };
	};
	return { run, ran };
};
const ours = { 'remote get-url origin': { ok: true, out: 'https://github.com/Kaizer-Systems/saha-textile.git\n' } };

test('branch names: safe ones pass, unsafe ones do not', () => {
	for (const ok of ['main', 'dev', 'feat/combined-after-pr6', 'release/2026.11']) assert.ok(BRANCH_NAME.test(ok), ok);
	for (const bad of ['', '-x', 'a b', 'x..y', 'x/', 'x.lock', 'a//b', 'a~1', 'a:b'])
		assert.ok(!BRANCH_NAME.test(bad), bad);
});

test('lists this checkout’s branches only for its own repository, and fetches only when asked', async () => {
	const g = gitWith({
		...ours,
		'symbolic-ref': { ok: true, out: 'feat/combined-after-pr6\n' },
		'for-each-ref --format=%(refname:short) refs/heads': { ok: true, out: 'main\nfeat/combined-after-pr6\n' },
		'for-each-ref --format=%(refname:lstrip=3) refs/remotes/origin': {
			ok: true,
			out: 'HEAD\nmain\nstaging\ndev\n',
		},
		fetch: { ok: true, out: '' },
	});
	assert.deepEqual(await checkoutBranches('kaizer-systems/saha-textile', g.run), {
		checkout: true,
		current: 'feat/combined-after-pr6',
		local: ['main', 'feat/combined-after-pr6'],
		remote: ['main', 'staging', 'dev'],
	});
	assert.ok(!g.ran.some((r) => r.startsWith('fetch')));
	await checkoutBranches('Kaizer-Systems/saha-textile', g.run, { fetch: true });
	assert.ok(g.ran.includes('fetch --prune origin'));
	assert.equal((await checkoutBranches('someone/else', g.run)).checkout, false);
});

test('reads only .release-console.json, from the local branch first, then GitHub’s copy', async () => {
	const g = gitWith({ ...ours, 'show origin/dev:.release-console.json': { ok: true, out: '{"menus":["seo"]}' } });
	assert.deepEqual(await menusFileAt('Kaizer-Systems/saha-textile', 'dev', g.run), {
		found: true,
		text: '{"menus":["seo"]}',
		ref: 'origin/dev',
	});
	assert.deepEqual(
		g.ran.filter((r) => r.startsWith('show')),
		['show dev:.release-console.json', 'show origin/dev:.release-console.json'],
	);
	assert.equal((await menusFileAt('Kaizer-Systems/saha-textile', 'main', g.run)).found, false);
	await assert.rejects(() => menusFileAt('Kaizer-Systems/saha-textile', '-x', g.run), /Not a branch name/);
	await assert.rejects(() => menusFileAt('someone/else', 'dev', g.run), /another repository/);
});
