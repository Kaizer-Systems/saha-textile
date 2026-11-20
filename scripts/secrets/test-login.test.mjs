import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT } from './inventory.mjs';
import { TEST_PASSWORD_FILE, localMongoTarget, mainCheckout, testDatabaseUri, testRunEnv } from './test-login.mjs';

function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), 'secrets-test-login-'));
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test('without a test password the address carries no login, as on CI', () => {
	withRoot((root) => {
		assert.equal(
			testDatabaseUri({ database: 'saha_textile_it' }, { root }),
			'mongodb://127.0.0.1:27017/saha_textile_it?replicaSet=rs0&directConnection=true&retryWrites=true&w=majority',
		);
	});
});

test('with the test password the address logs in against admin, with the password encoded', () => {
	withRoot((root) => {
		mkdirSync(join(root, 'docker/dev-secrets'), { recursive: true });
		writeFileSync(join(root, TEST_PASSWORD_FILE), 'p@ss/word\n');
		const uri = testDatabaseUri(
			{ host: 'db', port: 27018, replicaSet: 'rs1', database: 'saha_textile_e2e' },
			{ root },
		);
		assert.equal(
			uri,
			'mongodb://saha_textile_tests:p%40ss%2Fword@db:27018/saha_textile_e2e?replicaSet=rs1&directConnection=true&retryWrites=true&w=majority&authSource=admin',
		);
	});
});

test('host, port and replica set come from the environment first, then apps/api/.env', () => {
	withRoot((root) => {
		mkdirSync(join(root, 'apps/api'), { recursive: true });
		writeFileSync(
			join(root, 'apps/api/.env'),
			"MONGODB_PORT='27018'\nMONGODB_HOST=127.0.0.1\nMONGODB_PASSWORD=secret\n",
		);
		assert.deepEqual(localMongoTarget('saha_textile_it', {}, root), {
			host: '127.0.0.1',
			port: '27018',
			replicaSet: undefined,
			database: 'saha_textile_it',
		});
		assert.equal(localMongoTarget('x_it', { MONGODB_PORT: '1234' }, root).port, '1234');
		assert.deepEqual(localMongoTarget('x_it', {}, join(root, 'none')).port, undefined);
	});
});

test('the main folder is found from this checkout, and a folder outside git falls back to itself', () => {
	assert.equal(mainCheckout(ROOT).length > 0, true);
	withRoot((root) => assert.equal(mainCheckout(root), root));
});

test('run gives the command the test address, the database name and the opt-in flag, and clears the app login', () => {
	const script = join(ROOT, 'scripts/secrets/test-login.mjs');
	const probe =
		'const e=process.env;const u=e.MONGODB_URI||"";console.log(JSON.stringify({db:e.MONGODB_DB_NAME,run:e.RUN_DB_IT,user:e.MONGODB_USERNAME,pwd:e.MONGODB_PASSWORD,path:/\\/saha_textile_test\\?/.test(u)}))';
	const child = spawnSync(
		process.execPath,
		[script, 'run', 'saha_textile_test', '--', process.execPath, '-e', probe],
		{ encoding: 'utf8', env: { ...process.env, MONGODB_USERNAME: 'saha_textile_app', MONGODB_PASSWORD: 'x' } },
	);
	assert.equal(child.status, 0);
	assert.deepEqual(JSON.parse(child.stdout), { db: 'saha_textile_test', run: '1', user: '', pwd: '', path: true });
	const exit = spawnSync(process.execPath, [
		script,
		'run',
		'saha_textile_it',
		'--',
		process.execPath,
		'-e',
		'process.exit(3)',
	]);
	assert.equal(exit.status, 3, "the command's exit code is passed on");
	assert.equal(spawnSync(process.execPath, [script, 'run', 'saha_textile_local', '--', 'true']).status, 2);
	assert.equal(spawnSync(process.execPath, [script, 'run', 'saha_textile_it']).status, 2);
	assert.equal(testRunEnv('saha_textile_e2e', {}).MONGODB_DB_NAME, 'saha_textile_e2e');
});

test('the command refuses a non-test database and never prints to a screen', () => {
	const script = join(ROOT, 'scripts/secrets/test-login.mjs');
	const local = spawnSync(process.execPath, [script, 'saha_textile_local'], { encoding: 'utf8' });
	assert.equal(local.status, 2);
	assert.match(local.stderr, /Usage/);
	const piped = spawnSync(process.execPath, [script, 'saha_textile_it_purchasing_flow'], { encoding: 'utf8' });
	assert.equal(piped.status, 0);
	// assert.ok with a message, so a failure never prints the address (it may hold this Mac's password).
	assert.ok(/\/saha_textile_it_purchasing_flow\?/.test(piped.stdout), 'an address for the asked database');
});
