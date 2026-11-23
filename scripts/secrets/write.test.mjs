import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { SecretsError, loadInventory } from './inventory.mjs';
import { applySecretChanges, checkChanges, writableNames } from './write.mjs';

const inventory = loadInventory();
const VALUE = 'zz-made-up-value';

test('only names the inventory lists for that tier and folder may be written', () => {
	assert.ok(writableNames(inventory, 'staging', 'api').has('MSG91_AUTH_KEY'));
	assert.ok(writableNames(inventory, 'local', 'release-console').has('CONSOLE_GITHUB_TOKEN'));
	assert.equal(writableNames(inventory, 'production', 'release-console'), null);
	const problems = checkChanges(
		[
			{ tier: 'local', folder: 'api', name: 'NOT_A_NAME', value: VALUE },
			{ tier: 'qa', folder: 'api', name: 'X', value: VALUE },
			{ tier: 'production', folder: 'github-actions', name: 'DATA_GOV_IN_API_KEY', value: VALUE },
			{ tier: 'local', folder: 'api', name: 'CSRF_SECRET', value: '  ' },
			{ tier: 'local', folder: 'api', name: 'JWT_ACCESS_SECRET', value: 'a\0b' },
			{ tier: 'local', folder: 'api', name: 'JWT_REFRESH_SECRET', value: VALUE },
			{ tier: 'local', folder: 'api', name: 'JWT_REFRESH_SECRET', value: VALUE },
		],
		inventory,
	);
	assert.deepEqual(problems, [
		'local/api/NOT_A_NAME: not a name the inventory lists for this folder.',
		'qa/api/X: unknown project.',
		'production/github-actions/DATA_GOV_IN_API_KEY: the production project holds no /github-actions folder.',
		'local/api/CSRF_SECRET: the value is empty.',
		'local/api/JWT_ACCESS_SECRET: the value holds a NUL character.',
		'local/api/JWT_REFRESH_SECRET: changed twice in one batch.',
	]);
	assert.deepEqual(checkChanges([], inventory), ['There is nothing to save.']);
	for (const problem of problems) assert.ok(!problem.includes(VALUE));
});

test('a batch is saved with one CLI call per tier and folder, values only in private files deleted after', () => {
	const calls = [];
	const results = applySecretChanges(
		[
			{ tier: 'local', folder: 'api', name: 'CSRF_SECRET', value: `${VALUE}-1` },
			{ tier: 'local', folder: 'release-console', name: 'CONSOLE_GITHUB_TOKEN', value: `${VALUE}-2` },
			{ tier: 'local', folder: 'api', name: 'JWT_ACCESS_SECRET', value: `${VALUE}-3\nsecond line` },
		],
		{
			inventory,
			run: (command, args, options) => {
				const files = args.filter((arg) => arg.includes('=@')).map((arg) => arg.split('=@')[1]);
				calls.push({
					command,
					args,
					stdio: options.stdio,
					contents: files.map((file) => readFileSync(file, 'utf8')),
					modes: files.map((file) => statSync(file).mode & 0o777),
					files,
				});
				return { status: 0, stderr: '' };
			},
		},
	);
	assert.equal(calls.length, 2);
	const [api, consoleKeys] = calls;
	assert.deepEqual(api.args.slice(0, 2), ['secrets', 'set']);
	assert.deepEqual(api.args.slice(-7), [
		'--projectId',
		inventory.projects.local.projectId,
		'--env',
		'dev',
		'--path',
		'/api',
		'--silent',
	]);
	assert.deepEqual(api.contents, [`${VALUE}-1`, `${VALUE}-3\nsecond line`]);
	assert.deepEqual(api.modes, [0o600, 0o600]);
	assert.deepEqual(api.stdio, ['ignore', 'ignore', 'pipe']);
	assert.ok(consoleKeys.args.includes('/release-console'));
	for (const call of calls) {
		assert.ok(!call.args.some((arg) => arg.includes(VALUE)), 'no value on the command line');
		for (const file of call.files) assert.equal(existsSync(file), false, 'value files deleted');
	}
	assert.deepEqual(results, [
		{ tier: 'local', folder: 'api', names: ['CSRF_SECRET', 'JWT_ACCESS_SECRET'], saved: true },
		{ tier: 'local', folder: 'release-console', names: ['CONSOLE_GITHUB_TOKEN'], saved: true },
	]);
});

test('a bad batch writes nothing, and a refused save is reported by name only', () => {
	let ran = false;
	assert.throws(
		() =>
			applySecretChanges([{ tier: 'local', folder: 'api', name: 'NOPE', value: VALUE }], {
				inventory,
				run: () => {
					ran = true;
					return { status: 0 };
				},
			}),
		(error) =>
			error instanceof SecretsError && /Nothing was saved/.test(error.message) && !error.message.includes(VALUE),
	);
	assert.equal(ran, false);
	const [result] = applySecretChanges([{ tier: 'staging', folder: 'api', name: 'CSRF_SECRET', value: VALUE }], {
		inventory,
		run: () => ({ status: 1, stderr: `boom ${VALUE}` }),
	});
	assert.deepEqual(result, {
		tier: 'staging',
		folder: 'api',
		names: ['CSRF_SECRET'],
		saved: false,
		error: 'Infisical refused the save (exit 1).',
	});
});

test('a kept <NAME>_PREVIOUS key may be cleared with an empty value, on the command line; nothing else may be empty', () => {
	assert.deepEqual(
		checkChanges(
			[
				{ tier: 'staging', folder: 'api', name: 'CSRF_SECRET_PREVIOUS', value: '' },
				{ tier: 'staging', folder: 'api', name: 'CSRF_SECRET', value: '' },
				{ tier: 'staging', folder: 'api', name: 'JWT_ACCESS_SECRET_PREVIOUS', value: '  ' },
			],
			inventory,
		),
		['staging/api/CSRF_SECRET: the value is empty.', 'staging/api/JWT_ACCESS_SECRET_PREVIOUS: the value is empty.'],
	);
	const calls = [];
	applySecretChanges(
		[
			{ tier: 'staging', folder: 'api', name: 'CSRF_SECRET_PREVIOUS', value: '' },
			{ tier: 'staging', folder: 'api', name: 'CSRF_SECRET', value: VALUE },
		],
		{ inventory, run: (command, args) => (calls.push(args), { status: 0, stderr: '' }) },
	);
	assert.ok(calls[0].includes('CSRF_SECRET_PREVIOUS='));
	assert.ok(!calls[0].some((arg) => arg.includes(VALUE)), 'a value never goes on the command line');
});
