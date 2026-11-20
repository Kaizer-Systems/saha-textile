import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOGIN_ARGS, signedInAs } from './github-login.mjs';

/** A stand-in gh: answers each command from `answers` by its first two words. */
const gh = (answers) => (args) => answers[args.slice(0, 2).join(' ')] ?? { status: 1, stdout: '' };

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
