import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseEnvText } from './files.mjs';
import { APP_DATABASE_USER, ROOT_DATABASE_USER, generateServiceSecrets } from './generate.mjs';
import { SecretsError, loadInventory } from './inventory.mjs';
import {
	BEFORE_LOCAL_SETUP,
	DEV_SECRETS_DIR,
	FOR_INFISICAL,
	fillBlanks,
	mongoLoginScript,
	setupLocal,
} from './local-setup.mjs';
import { buildRelease } from './render.mjs';
import { TEST_DATABASE_USER, TEST_PASSWORD_FILE } from './test-login.mjs';

/** Deterministic stand-in for randomBytes: each call gives a new, recognisable run of bytes. */
function counterRandom() {
	let call = 0;
	return (size) => {
		call += 1;
		return Buffer.alloc(size, call);
	};
}

test('the generated secrets have the forms each service documents', () => {
	const made = generateServiceSecrets('dev');
	const api = Object.fromEntries(made.api);
	assert.equal(api.MONGODB_USERNAME, APP_DATABASE_USER);
	for (const name of ['MONGODB_PASSWORD', 'REDIS_PASSWORD']) assert.match(api[name], /^[0-9a-f]{64}$/);
	for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CSRF_SECRET'])
		assert.match(api[name], /^[0-9a-f]{96}$/);
	assert.equal(Buffer.from(api.MAILBOX_TOKEN_KEY, 'base64').length, 32);
	const files = Object.fromEntries(made.infrastructure);
	assert.equal(files['mongo-keyfile'].length, 1008);
	assert.match(files['mongo-keyfile'], /^[A-Za-z0-9+/=]+$/);
	assert.equal(files['mongo-root-username'], ROOT_DATABASE_USER);
	assert.match(files['mongo-root-password'], /^[0-9a-f]{64}$/);
	assert.match(
		files['meilisearch.toml'],
		/^master_key = "[0-9a-f]{64}"\nenv = "development"\nno_analytics = true\n$/,
	);
	assert.match(generateServiceSecrets('production').infrastructure.get('meilisearch.toml'), /env = "production"/);
	// Two runs never repeat a value.
	assert.notEqual(generateServiceSecrets('dev').api.get('MONGODB_PASSWORD'), api.MONGODB_PASSWORD);
});

test('generated values pass every check a release folder makes', () => {
	const inventory = loadInventory();
	const made = generateServiceSecrets('staging');
	const api = new Map([...inventory.api].map((name) => [name, `zz-made-up-${name.toLowerCase()}`]));
	for (const name of inventory.developmentOnly) api.set(name, '');
	for (const name of inventory.composeProvided) api.set(name, '');
	api.set('MONGODB_URI', '');
	api.set('MEILISEARCH_API_KEY', '');
	api.set('DEPLOY_ENV', 'staging');
	for (const [name, value] of made.api) api.set(name, value);
	const deployment = new Map(inventory.deployment.map((name) => [name, `zz-made-up-${name.toLowerCase()}`]));
	deployment.set('GOOGLE_CLIENT_ID', api.get('GOOGLE_OAUTH_CLIENT_ID'));
	deployment.set('FACEBOOK_APP_ID', api.get('FACEBOOK_OAUTH_APP_ID'));
	const { files } = buildRelease(
		{ api, backup: new Map(), infrastructure: made.infrastructure, deployment },
		{ tier: 'staging', inventory, source: 'test', release: new Map([['DEPLOY_ENV', 'staging']]) },
	);
	assert.equal(files.get('secrets/mongo-app-password'), made.api.get('MONGODB_PASSWORD'));
	assert.equal(files.get('secrets/redis-password'), made.api.get('REDIS_PASSWORD'));
});

test('fillBlanks fills blank and missing settings in place and touches nothing else', () => {
	const text = [
		'# a comment that stays',
		'PORT=4000',
		'CSRF_SECRET=',
		'# MONGODB_USERNAME=commented-out stays',
		'REDIS_PASSWORD=',
		'REDIS_PASSWORD=   ',
		'MONGODB_DB_NAME=saha_textile_local',
	].join('\n');
	const result = fillBlanks(
		text,
		new Map([
			['CSRF_SECRET', 'abc'],
			['PORT', '9999'],
			['REDIS_PASSWORD', 'with space'],
			['MONGODB_USERNAME', 'saha_textile_app'],
		]),
	);
	assert.deepEqual(result.filled, ['CSRF_SECRET', 'REDIS_PASSWORD', 'MONGODB_USERNAME']);
	assert.deepEqual(result.kept, ['PORT']);
	assert.equal(
		result.text,
		[
			'# a comment that stays',
			'PORT=4000',
			'CSRF_SECRET=abc',
			'# MONGODB_USERNAME=commented-out stays',
			'REDIS_PASSWORD=',
			"REDIS_PASSWORD='with space'",
			'MONGODB_DB_NAME=saha_textile_local',
			'',
			"# ---- Filled by pnpm secrets:setup-local (values in Infisical's dev project) ----",
			'MONGODB_USERNAME=saha_textile_app',
			'',
		].join('\n'),
	);
	assert.equal(parseEnvText(result.text).get('REDIS_PASSWORD'), 'with space');
	assert.deepEqual(fillBlanks('A=1\n', new Map([['A', '2']])), { text: 'A=1\n', filled: [], kept: ['A'] });
});

test('the login script creates the logins as deploy.sh does, plus the test login, and proves each on its own connection', () => {
	const script = mongoLoginScript({
		database: 'saha_textile_local',
		rootUser: 'saha_textile_root',
		rootPassword: 'r00t',
		appUser: 'saha_textile_app',
		appPassword: 'app"pw',
		testPassword: 't3st',
	});
	assert.match(script, /keep\('admin', "saha_textile_root", "r00t", \[\{ role: 'root', db: 'admin' \}\]\)/);
	assert.match(
		script,
		/keep\("saha_textile_local", "saha_textile_app", "app\\"pw", \[\{ role: 'readWrite', db: "saha_textile_local" \}\]\)/,
	);
	assert.ok(
		script.includes(
			`keep('admin', "${TEST_DATABASE_USER}", "t3st", [{"role":"readWriteAnyDatabase","db":"admin"},{"role":"dbAdminAnyDatabase","db":"admin"}])`,
		),
	);
	assert.ok(script.includes(`logsIn("${TEST_DATABASE_USER}", "t3st", 'admin')`));
	assert.match(script, /print\(all \? 'logins-ok' : 'logins-failed'\)/);
});

/** A throwaway repository root with a hand-written apps/api/.env. */
function withRoot(envText, fn) {
	const root = mkdtempSync(join(tmpdir(), 'secrets-local-'));
	mkdirSync(join(root, 'apps/api'), { recursive: true });
	if (envText !== null) writeFileSync(join(root, 'apps/api/.env'), envText);
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const HAND_WRITTEN =
	'PORT=4000\nMONGODB_DB_NAME=saha_textile_local\nJWT_ACCESS_SECRET=keep-me\nCSRF_SECRET=\nREDIS_PASSWORD=\n';

function mongoAccepting(scripts) {
	return (script) => {
		scripts.push(script);
		return { status: 0, stdout: 'logins-ok\n' };
	};
}

test('setupLocal fills the file, writes the services folder and the list for Infisical, and creates the logins', () => {
	withRoot(HAND_WRITTEN, (root) => {
		const scripts = [];
		const generate = (tier) => generateServiceSecrets(tier, counterRandom());
		const lines = setupLocal({
			root,
			generate,
			runMongo: mongoAccepting(scripts),
			makeTestPassword: () => 'zz-test-pw',
		});
		const env = parseEnvText(readFileSync(join(root, 'apps/api/.env'), 'utf8'));
		assert.equal(env.get('JWT_ACCESS_SECRET'), 'keep-me', 'a setting with a value is never changed');
		assert.equal(env.get('MONGODB_USERNAME'), APP_DATABASE_USER);
		assert.equal(env.get('DEPLOY_ENV'), 'local');
		assert.equal(env.has('MAILBOX_TOKEN_KEY'), false, 'held back without the Google client keys');
		assert.equal(env.has('ADMIN_APP_URL'), false);
		assert.equal(readFileSync(join(root, BEFORE_LOCAL_SETUP), 'utf8'), HAND_WRITTEN);
		assert.equal(statSync(join(root, 'apps/api/.env')).mode & 0o777, 0o600);

		const dir = join(root, DEV_SECRETS_DIR);
		assert.equal(statSync(dir).mode & 0o777, 0o700);
		for (const file of ['mongo-keyfile', 'mongo-root-username', 'mongo-root-password', 'meilisearch.toml']) {
			assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600);
		}
		assert.equal(readFileSync(join(dir, 'mongo-app-password'), 'utf8'), env.get('MONGODB_PASSWORD'));
		assert.equal(readFileSync(join(dir, 'redis-password'), 'utf8'), env.get('REDIS_PASSWORD'));
		assert.equal(scripts.length, 1);
		assert.ok(scripts[0].includes(env.get('MONGODB_PASSWORD')));
		assert.equal(readFileSync(join(root, TEST_PASSWORD_FILE), 'utf8'), 'zz-test-pw');
		assert.equal(statSync(join(root, TEST_PASSWORD_FILE)).mode & 0o777, 0o600);
		assert.ok(scripts[0].includes('"zz-test-pw"'));

		const handover = parseEnvText(readFileSync(join(root, FOR_INFISICAL), 'utf8'));
		assert.equal(handover.has('JWT_ACCESS_SECRET'), false, 'only what was blank is handed over');
		assert.equal(handover.get('CSRF_SECRET'), env.get('CSRF_SECRET'));
		assert.ok(handover.get('MAILBOX_TOKEN_KEY'));
		assert.equal(handover.get('ADMIN_APP_URL'), 'https://localhost:4300');

		const text = lines.join('\n');
		assert.match(text, /saha_textile_tests \(this Mac's test databases\)/);
		assert.equal(handover.has('MONGO_TEST_PASSWORD'), false, 'the test login never goes to Infisical');
		for (const value of [
			env.get('MONGODB_PASSWORD'),
			env.get('CSRF_SECRET'),
			handover.get('MAILBOX_TOKEN_KEY'),
			'zz-test-pw',
		]) {
			assert.ok(!text.includes(value), 'a value reached the output');
		}
		assert.match(text, /Not in apps\/api\/.env yet: MAILBOX_TOKEN_KEY, ADMIN_APP_URL/);

		// A second run changes nothing the owner may have copied, and keeps the whole list.
		const keyfile = readFileSync(join(dir, 'mongo-keyfile'), 'utf8');
		const again = setupLocal({
			root,
			generate: (tier) => generateServiceSecrets(tier),
			runMongo: mongoAccepting(scripts),
		});
		assert.deepEqual(parseEnvText(readFileSync(join(root, FOR_INFISICAL), 'utf8')), handover);
		assert.equal(readFileSync(join(dir, 'mongo-keyfile'), 'utf8'), keyfile);
		assert.equal(
			readFileSync(join(root, TEST_PASSWORD_FILE), 'utf8'),
			'zz-test-pw',
			'the test password is made once',
		);
		assert.match(again[0], /0 blank settings filled \(none\)/);
		assert.match(again.join('\n'), /were already there and are kept/);
	});
});

test('with the Google client keys present, the mailbox key and admin address go straight into the file', () => {
	const text = `${HAND_WRITTEN}GOOGLE_MAIL_CLIENT_ID=a\nGOOGLE_MAIL_CLIENT_SECRET=b\nGOOGLE_MAIL_REDIRECT_URI=https://localhost:4000/cb\n`;
	withRoot(text, (root) => {
		setupLocal({ root, runMongo: mongoAccepting([]) });
		const env = parseEnvText(readFileSync(join(root, 'apps/api/.env'), 'utf8'));
		assert.equal(Buffer.from(env.get('MAILBOX_TOKEN_KEY'), 'base64').length, 32);
		assert.equal(env.get('ADMIN_APP_URL'), 'https://localhost:4300');
	});
});

test('a failed login step leaves apps/api/.env as it was, and a missing file is refused', () => {
	withRoot(HAND_WRITTEN, (root) => {
		assert.throws(
			() => setupLocal({ root, runMongo: () => ({ status: 1, stdout: '' }) }),
			(error) => error instanceof SecretsError && /apps\/api\/.env was not changed/.test(error.message),
		);
		assert.equal(readFileSync(join(root, 'apps/api/.env'), 'utf8'), HAND_WRITTEN);
		assert.equal(existsSync(join(root, BEFORE_LOCAL_SETUP)), false);
		assert.throws(
			() => setupLocal({ root, runMongo: () => ({ status: 0, stdout: 'logins-failed' }) }),
			SecretsError,
		);
	});
	withRoot(null, (root) => {
		assert.throws(() => setupLocal({ root }), /apps\/api\/.env is missing/);
	});
});
