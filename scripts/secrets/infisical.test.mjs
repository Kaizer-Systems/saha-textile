import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CACHE_NOTE, exportFolder, exportProject, parseExport } from './infisical.mjs';
import { SecretsError, TIERS, loadInventory } from './inventory.mjs';

const MARK = 'zz-made-up-';

/** Stands in for spawnSync: records each call and answers with the given result. */
function recorder(result) {
	const calls = [];
	const run = (command, args, options) => {
		calls.push({ command, args, options });
		return typeof result === 'function' ? result(args) : result;
	};
	return { run, calls };
}

function messageOf(fn) {
	let message = '';
	assert.throws(fn, (error) => {
		assert.ok(error instanceof SecretsError);
		message = error.message;
		return true;
	});
	assert.ok(!message.includes(MARK), `a value leaked into: ${message}`);
	return message;
}

test('parseExport reads the CLI array, a plain object, and refuses anything else without quoting it', () => {
	assert.deepEqual(
		[
			...parseExport(
				JSON.stringify([
					{ key: 'A', value: '1', type: 'shared' },
					{ secretKey: 'B', secretValue: '2' },
				]),
			),
		],
		[
			['A', '1'],
			['B', '2'],
		],
	);
	assert.deepEqual([...parseExport('{"A":"1"}')], [['A', '1']]);
	assert.match(
		messageOf(() => parseExport(`not json ${MARK}secret`)),
		/not JSON/,
	);
	assert.match(
		messageOf(() => parseExport(JSON.stringify([{ key: 'A' }]))),
		/no name or value/,
	);
	assert.match(
		messageOf(() => parseExport('{"A":1}')),
		/non-text value for A/,
	);
	assert.match(
		messageOf(() => parseExport('"text"')),
		/not a list of settings/,
	);
	assert.match(
		messageOf(() => parseExport('null')),
		/not a list of settings/,
	);
});

test('exportFolder asks the CLI for one folder as JSON', () => {
	const { run, calls } = recorder({ status: 0, stdout: '[{"key":"PORT","value":"4000"}]', stderr: '' });
	const values = exportFolder({ projectId: 'p1', environment: 'staging', folder: 'api', run, env: { HOME: '/x' } });
	assert.deepEqual([...values], [['PORT', '4000']]);
	assert.equal(calls[0].command, 'infisical');
	assert.deepEqual(calls[0].args, [
		'export',
		'--projectId',
		'p1',
		'--env',
		'staging',
		'--path',
		'/api',
		'--format',
		'json',
		'--silent',
	]);
	assert.deepEqual(calls[0].options.env, { HOME: '/x' });
});

test('exportFolder explains a missing CLI, a failed start and a refusal, never repeating the output', () => {
	const missing = Object.assign(new Error('spawn infisical ENOENT'), { code: 'ENOENT' });
	assert.match(
		messageOf(() =>
			exportFolder({ projectId: 'p', environment: 'dev', folder: 'api', run: recorder({ error: missing }).run }),
		),
		/not installed\. Install it with: brew install/,
	);
	const slow = recorder({ error: Object.assign(new Error('spawnSync infisical ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
	assert.match(
		messageOf(() => exportFolder({ projectId: 'p', environment: 'dev', folder: 'api', run: slow.run })),
		/did not answer within 30 seconds/,
	);
	assert.equal(slow.calls[0].options.timeout, 30_000);
	const other = Object.assign(new Error('EACCES'), { code: 'EACCES' });
	assert.match(
		messageOf(() =>
			exportFolder({ projectId: 'p', environment: 'dev', folder: 'api', run: recorder({ error: other }).run }),
		),
		/could not start \(EACCES\)/,
	);
	const refused = recorder({
		status: 1,
		stdout: `[{"key":"A","value":"${MARK}x"}]`,
		stderr: 'warn\nnot logged in\n',
	});
	const message = messageOf(() =>
		exportFolder({ projectId: 'p', environment: 'dev', folder: 'backup', run: refused.run }),
	);
	assert.match(
		message,
		/could not read \/backup \(exit 1\)\. Sign in with: infisical login\. Infisical said: not logged in$/,
	);
	const silent = recorder({ status: 2, stdout: '', stderr: undefined });
	assert.match(
		messageOf(() => exportFolder({ projectId: 'p', environment: 'dev', folder: 'api', run: silent.run })),
		/\(exit 2\)\. Sign in with: infisical login\.$/,
	);
});

test('exportProject reads the four folders of one project', () => {
	const project = loadInventory().projects.dev;
	const { run, calls } = recorder((args) => ({ status: 0, stdout: `{"FROM":"${args[6]}"}`, stderr: '' }));
	const folders = exportProject(project, { run, env: {} });
	assert.deepEqual(Object.keys(folders), ['api', 'backup', 'infrastructure', 'deployment']);
	assert.equal(folders.infrastructure.get('FROM'), '/infrastructure');
	assert.ok(calls.every((call) => call.args[2] === project.projectId && call.args[4] === project.environment));
});

test('loadInventory refuses an inventory without a project for every tier, and tolerates missing optional lists', () => {
	const root = mkdtempSync(join(tmpdir(), 'secrets-inventory-'));
	try {
		mkdirSync(join(root, 'docker/infisical'), { recursive: true });
		mkdirSync(join(root, 'docker/production'), { recursive: true });
		writeFileSync(join(root, 'docker/production/required-secrets.txt'), '# comment\nPORT\n\n');
		const json = {
			projects: TIERS.map((tier) => ({ name: `saha-textile-${tier}`, environment: tier, projectId: tier })),
			apiVariables: ['PORT'],
			developmentOnlyApiVariables: [],
			backupVariables: [],
			infrastructureSecretFileNames: [],
			deploymentVariables: [],
		};
		writeFileSync(join(root, 'docker/infisical/variable-names.json'), JSON.stringify(json));
		const inventory = loadInventory(root);
		assert.deepEqual(inventory.requiredForRelease, ['PORT']);
		assert.deepEqual(inventory.derivedFiles, {});
		assert.equal(inventory.composeProvided.size, 0);

		json.projects = json.projects.filter((project) => project.name !== 'saha-textile-production');
		json.projects.push({ name: 'another-project', environment: 'x', projectId: 'x' });
		writeFileSync(join(root, 'docker/infisical/variable-names.json'), JSON.stringify(json));
		assert.match(
			messageOf(() => loadInventory(root)),
			/has no project for production/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the inventory names a project for each tier', () => {
	const inventory = loadInventory();
	assert.deepEqual(Object.keys(inventory.projects).sort(), [...TIERS].sort());
	assert.equal(inventory.projects.production.environment, 'prod');
	for (const name of inventory.requiredForRelease) assert.ok(inventory.api.has(name), name);
	for (const name of Object.values(inventory.derivedFiles)) assert.ok(inventory.api.has(name), name);
});

test('a hidden value stops the read, and an account name never reaches a message', () => {
	assert.match(
		messageOf(() => parseExport(JSON.stringify([{ key: 'CSRF_SECRET', value: '', secretValueHidden: true }]))),
		/hid the value of CSRF_SECRET: whoever is signed in may see names but not values/,
	);
	const refused = recorder({ status: 1, stdout: '', stderr: 'error: profile owner.name@example.com is not valid\n' });
	assert.match(
		messageOf(() => exportFolder({ projectId: 'p', environment: 'dev', folder: 'api', run: refused.run })),
		/Infisical said: error: profile <account> is not valid$/,
	);
});

test("an answer from the CLI's own copy is read, and noted once", () => {
	const notes = new Set();
	const cached = recorder({
		status: 0,
		stdout: JSON.stringify([{ key: 'PORT', value: '4000' }]),
		stderr: 'Warning: Unable to fetch the latest secret(s) due to connection error, serving secrets from last successful fetch.\n',
	});
	const project = { name: 'p', projectId: 'id', environment: 'dev' };
	const folders = exportProject(project, { run: cached.run, notes });
	assert.equal(folders.api.get('PORT'), '4000');
	assert.deepEqual([...notes], [CACHE_NOTE]);
	const fresh = new Set();
	exportFolder({
		projectId: 'p',
		environment: 'dev',
		folder: 'api',
		run: recorder({ status: 0, stdout: '[]' }).run,
		notes: fresh,
	});
	assert.equal(fresh.size, 0);
});
