import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findProject, repositoryOf, subfolders } from './infisical-places.mjs';

/** A stand-in for the CLI: answers `stdout` with `status`, and records the arguments. */
const cli = (stdout, status = 0, calls = []) =>
	/** @type {any} */ (
		(cmd, args) => {
			calls.push([cmd, ...args].join(' '));
			return { status, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' };
		}
	);

test('finds a project by name, slug or id, with its environments', () => {
	const calls = [];
	const run = cli(
		[
			{
				id: 'id-1',
				name: 'client-shop-dev',
				slug: 'client-shop-dev-x1',
				environments: [{ slug: 'dev' }, { slug: 'qa' }],
			},
		],
		0,
		calls,
	);
	assert.deepEqual(findProject('client-shop-dev', run), {
		id: 'id-1',
		name: 'client-shop-dev',
		environments: ['dev', 'qa'],
	});
	assert.equal(findProject('client-shop-dev-x1', run).id, 'id-1');
	assert.equal(calls[0], 'infisical secrets-manager projects get -o json --silent');
	assert.throws(() => findProject('other', run), /can open no project named other/);
});

test('a refusal says what Infisical said, with the account masked', () => {
	const run = cli({ error: { message: 'Session expired for owner@example.com' } }, 1);
	assert.throws(
		() => findProject('p', run),
		(e) => {
			assert.match(e.message, /Session expired for <account>/);
			assert.match(e.message, /infisical login/);
			assert.ok(!e.message.includes('owner@example.com'));
			return true;
		},
	);
});

test('lists the folders inside a folder, by name', () => {
	const calls = [];
	const run = cli([{ name: 'web' }, { name: 'api' }, { name: 'bad name' }], 0, calls);
	assert.deepEqual(subfolders({ projectId: 'id-1', environment: 'qa', folder: '/' }, run), ['api', 'web']);
	assert.equal(calls[0], 'infisical secrets-manager folders get --projectId id-1 --env qa --path / -o json --silent');
});

test('reads owner/name from a Git remote', () => {
	assert.equal(repositoryOf('https://github.com/Kaizer-Systems/saha-textile.git'), 'Kaizer-Systems/saha-textile');
	assert.equal(repositoryOf('git@github.com:Kaizer-Systems/saha-textile.git\n'), 'Kaizer-Systems/saha-textile');
	assert.equal(repositoryOf('nothing'), null);
});
