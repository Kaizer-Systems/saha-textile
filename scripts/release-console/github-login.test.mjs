import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOGIN_ARGS, argsOf, repositoryLine, signedInAs, whyLoginFailed } from './github-login.mjs';

/** A stand-in gh: answers each command from `answers` by its first two words. */
const gh = (answers) => (args) => answers[args.slice(0, 2).join(' ')] ?? { status: 1, stdout: '', stderr: '' };

test('a saved sign-in counts only when it still answers', () => {
	assert.equal(
		signedInAs(gh({ 'auth status': { status: 0 }, 'api user': { status: 0, stdout: 'octocat\n' } })),
		'octocat',
	);
	assert.equal(signedInAs(gh({ 'auth status': { status: 0 }, 'api user': { status: 1, stdout: '' } })), null);
	assert.equal(signedInAs(gh({ 'auth status': { status: 1 } })), null);
});

test('the sign-in is gh’s browser device flow, the same on every machine', () => {
	assert.deepEqual(LOGIN_ARGS, [
		'auth',
		'login',
		'--hostname',
		'github.com',
		'--git-protocol',
		'https',
		'--web',
		'--skip-ssh-key',
	]);
});

test('takes only a checked repository and mode', () => {
	assert.deepEqual(argsOf(['n', 's', '--repository', 'Kaizer-Systems/saha-textile']), {
		repository: 'Kaizer-Systems/saha-textile',
		mode: 'login',
	});
	assert.equal(argsOf(['--repository', 'a/b', '--mode', 'another']).mode, 'another');
	assert.throws(() => argsOf(['--repository', 'a/b;rm']), /owner\/name/);
	assert.throws(() => argsOf(['--repository', 'a/b', '--mode', 'shell']), /Mode/);
});

test('says why a sign-in failed in plain words', () => {
	assert.match(whyLoginFailed('error: expired_token'), /code expired/);
	assert.match(whyLoginFailed('access_denied'), /denied on GitHub/);
	assert.match(whyLoginFailed('dial tcp: lookup github.com: no such host'), /could not be reached/);
	assert.match(whyLoginFailed('something else'), /did not finish/);
});

test('reports the repository, a rename and single sign-on', () => {
	assert.deepEqual(
		repositoryLine('kaizer03', 'Kaizer-Systems/saha-textile', {
			status: 0,
			stdout: 'Kaizer-Systems/saha-textile\n',
		}),
		{
			ok: true,
			text: '✓ kaizer03 can open Kaizer-Systems/saha-textile.',
		},
	);
	assert.match(repositoryLine('k', 'o/old', { status: 0, stdout: 'o/new' }).text, /now calls it o\/new/);
	assert.match(
		repositoryLine('k', 'o/r', {
			status: 1,
			stdout: '',
			stderr: 'Resource protected by organization SAML enforcement',
		}).text,
		/single sign-on/,
	);
	assert.match(repositoryLine('k', 'o/r', { status: 1, stdout: '', stderr: 'HTTP 404' }).text, /cannot open o\/r/);
});

test('asks yes or no, and anything but y or yes is no', async () => {
	const { ask } = await import('./github-login.mjs');
	const out = [];
	const write = { write: (t) => out.push(t) };
	assert.equal(await ask('update-gh', 'Update now? [y/N]', async () => 'y', write), true);
	assert.equal(await ask('update-gh', 'Update now? [y/N]', async () => '', write), false);
	assert.equal(await ask('update-gh', 'Update now? [y/N]', async () => 'nope', write), false);
	assert.deepEqual(JSON.parse(out[0]), { ask: 'update-gh', question: 'Update now? [y/N]' });
	assert.deepEqual(JSON.parse(out[1]), { answered: 'update-gh', yes: true });
});

test('an update check: two lines with nothing to do, a question with an update', async () => {
	const { updateStep } = await import('./github-login.mjs');
	const lines = [];
	const write = process.stdout.write.bind(process.stdout);
	process.stdout.write = (t) => (lines.push(String(t)), true);
	try {
		assert.equal(
			await updateStep({
				tool: 'gh',
				current: '2.105.0',
				latest: '2.105.0',
				available: false,
				note: '',
				apply: null,
			}),
			false,
		);
		let applied = false;
		const update = {
			tool: 'git',
			current: '2.56.1',
			latest: '2.57.0',
			available: true,
			note: '',
			apply: async () => ((applied = true), { ok: true, text: 'git updated to 2.57.0 with Homebrew.' }),
		};
		assert.equal(await updateStep(update, async () => false), false);
		assert.equal(applied, false, 'no means no update');
		assert.equal(await updateStep(update, async () => true), true);
		assert.equal(applied, true);
		const noApply = {
			...update,
			apply: null,
			note: 'Updating needs an admin password: run sudo apt-get install --only-upgrade git',
		};
		assert.equal(await updateStep(noApply, async () => true), false);
	} finally {
		process.stdout.write = write;
	}
	const text = lines.join('');
	assert.match(text, /Checking for gh updates…\n✓ No gh update available \(2\.105\.0\)\./);
	assert.match(text, /- Continuing with git 2\.56\.1\./);
	assert.match(text, /✓ git updated to 2\.57\.0 with Homebrew\./);
	assert.match(
		text,
		/! Updating needs an admin password: run sudo apt-get install --only-upgrade git Continuing with git 2\.56\.1\./,
	);
});
