import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseEnvText } from './files.mjs';
import { SecretsError, loadInventory } from './inventory.mjs';
import { STACK_ENV_DIR, stackPort, stackServiceSecrets, writeStackEnv } from './stack.mjs';

// Every made-up value carries this marker, so a test can prove no value reaches a message.
const MARK = 'zz-made-up-';
const inventory = loadInventory();

function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), 'secrets-stack-'));
	mkdirSync(join(root, 'apps/api'), { recursive: true });
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function devProject(extra = {}) {
	return new Map(
		Object.entries({
			CSRF_SECRET: `${MARK}csrf`,
			MSG91_AUTH_KEY: '',
			GOOGLE_OAUTH_CLIENT_ID: 'zz-made-up-google.apps.example',
			// The dev project's own values for settings the stack owns: all replaced or dropped.
			MONGODB_HOST: 'localhost',
			MONGODB_USERNAME: 'saha_textile_app',
			MONGODB_PASSWORD: `${MARK}dev-mongo`,
			REDIS_PASSWORD: 'zzmadeupdevredis0123',
			MEILISEARCH_API_KEY: `${MARK}dev-search`,
			SHOP_ORIGIN: 'https://localhost:4200',
			OTP_LOCAL_FIXED_CODE: '123456',
			TLS_CERT_FILE: '/certs/dev.pem',
			...extra,
		}),
	);
}

const SEARCH_KEY = 'zzmadeupsearchkey0123456789';
const SEARCH_CONFIG = `master_key = "${SEARCH_KEY}"\nenv = "development"\nno_analytics = true\n`;
const KEYFILE = 'zzMadeUpKeyfile0123456789+/=';
const infrastructureFolder = (config = SEARCH_CONFIG, extra = {}) =>
	new Map(
		Object.entries({
			'mongo-keyfile': `${KEYFILE}\n`,
			'mongo-root-username': 'saha_textile_root',
			'mongo-root-password': `${MARK}root`,
			'meilisearch.toml': config,
			...extra,
		}),
	);
const infrastructure = (config, extra) => () => infrastructureFolder(config, extra);

function write(root, api, extra = {}) {
	const lines = writeStackEnv({
		root,
		inventory,
		readApi: () => api,
		readInfrastructure: infrastructure(),
		...extra,
	});
	for (const line of lines) assert.ok(!line.includes(MARK), `a value leaked into: ${line}`);
	return lines;
}

const file = (root, name) => readFileSync(join(root, STACK_ENV_DIR, name), 'utf8');
const mode = (root, name) => statSync(join(root, STACK_ENV_DIR, name)).mode & 0o777;

test("stack:env writes the API file with the stack settings on top, and the dev project's Redis password and search key", () => {
	withRoot((root) => {
		const lines = write(root, devProject());
		assert.match(lines[0], /api\.env \(\d+ settings from Infisical saha-textile-local \(dev\), folder \/api\)/);

		const api = parseEnvText(file(root, 'api.env'));
		assert.equal(api.get('CSRF_SECRET'), `${MARK}csrf`);
		assert.equal(api.get('MONGODB_HOST'), 'mongo');
		assert.equal(api.get('NODE_ENV'), 'production');
		assert.equal(
			api.get('CORS_ALLOWED_ORIGINS'),
			'https://local.saha-textile.localhost,https://admin-local.saha-textile.localhost',
		);
		for (const name of ['SHOP_ORIGIN', 'OTP_LOCAL_FIXED_CODE', 'TLS_CERT_FILE', 'MSG91_AUTH_KEY']) {
			assert.equal(api.has(name), false, `${name} must not reach the stack`);
		}
		assert.equal(api.get('REDIS_PASSWORD'), 'zzmadeupdevredis0123');
		assert.equal(file(root, 'redis-password'), 'zzmadeupdevredis0123');
		assert.equal(api.get('MEILISEARCH_API_KEY'), SEARCH_KEY);
		assert.equal(file(root, 'meilisearch.toml'), SEARCH_CONFIG);
		assert.equal(
			lines.some((line) => line.includes('stack.env')),
			false,
		);
		// The database logins, as a droplet's release folder holds them.
		assert.equal(api.get('MONGODB_DB_NAME'), 'saha_textile_stack');
		assert.equal(api.get('MONGODB_USERNAME'), 'saha_textile_app');
		assert.equal(api.get('MONGODB_PASSWORD'), `${MARK}dev-mongo`);
		assert.equal(file(root, 'mongo-app-password'), `${MARK}dev-mongo`);
		assert.equal(file(root, 'mongo-root-username'), 'saha_textile_root');
		assert.equal(file(root, 'mongo-root-password'), `${MARK}root`);
		assert.equal(file(root, 'mongo-keyfile'), `${KEYFILE}\n`);

		const shop = JSON.parse(file(root, 'storefront.config.json'));
		assert.deepEqual(shop, {
			apiUrl: 'https://api-local.saha-textile.localhost',
			siteUrl: 'https://local.saha-textile.localhost',
			defaultLocale: 'en',
			googleClientId: 'zz-made-up-google.apps.example',
			facebookAppId: '',
		});
		assert.match(file(root, 'storefront.env'), /^SAHA_TEXTILE_PUBLIC_CONFIG=\{"apiUrl"/m);
		assert.deepEqual(
			JSON.parse(file(root, 'admin.config.json')).adminUrl,
			'https://admin-local.saha-textile.localhost',
		);

		for (const name of [
			'api.env',
			'redis-password',
			'meilisearch.toml',
			'mongo-keyfile',
			'mongo-root-username',
			'mongo-root-password',
			'mongo-app-password',
		])
			assert.equal(mode(root, name), 0o600);
		for (const name of ['storefront.env', 'storefront.config.json', 'admin.config.json'])
			assert.equal(mode(root, name), 0o644);
	});
});

test('stack.env keeps only the HTTPS port, which reaches every address; its old secrets are named as unused', () => {
	withRoot((root) => {
		write(root, devProject());
		const old = 'REDIS_PASSWORD=oldlocal\nMEILISEARCH_MASTER_KEY=oldsearch\nSTACK_HTTPS_PORT=8443\n';
		writeFileSync(join(root, STACK_ENV_DIR, 'stack.env'), old);
		const lines = write(root, devProject());
		assert.ok(
			lines.includes(
				'  docker/stack/env/stack.env still holds REDIS_PASSWORD and MEILISEARCH_MASTER_KEY, no longer used: the stack takes both from the dev project. Only STACK_HTTPS_PORT is read there.',
			),
		);
		assert.equal(file(root, 'stack.env'), old, 'stack.env is never rewritten');
		assert.equal(file(root, 'redis-password'), 'zzmadeupdevredis0123');
		assert.equal(
			write(root, devProject({ CSRF_SECRET: '' })).find((line) => line.includes('No longer')),
			'  No longer in api.env: CSRF_SECRET. Fill any the stack needs in Infisical, then run pnpm stack:env again.',
		);
		assert.equal(
			parseEnvText(file(root, 'api.env')).get('ADMIN_APP_URL'),
			'https://admin-local.saha-textile.localhost:8443',
		);
		assert.equal(
			JSON.parse(file(root, 'storefront.config.json')).siteUrl,
			'https://local.saha-textile.localhost:8443',
		);
	});
});

test('a blank or unsafe Redis password or database login, a bad keyfile or a search config without a key stops stack:env', () => {
	const api = (value, extra = {}) =>
		new Map(Object.entries({ REDIS_PASSWORD: value, MONGODB_USERNAME: 'app', MONGODB_PASSWORD: 'pw', ...extra }));
	const folder = infrastructureFolder;
	assert.throws(
		() => stackServiceSecrets(api(''), folder(), 'the dev project'),
		/REDIS_PASSWORD is blank in the dev project/,
	);
	assert.throws(
		() => stackServiceSecrets(api('abc', { MONGODB_PASSWORD: '' }), folder(), 'the dev project'),
		/MONGODB_PASSWORD is blank in the dev project/,
	);
	assert.throws(
		() => stackServiceSecrets(api('abc'), folder(SEARCH_CONFIG, { 'mongo-root-password': '' }), 'x'),
		/mongo-root-password is blank in the dev project's \/infrastructure folder/,
	);
	assert.throws(
		() => stackServiceSecrets(api('abc'), folder(SEARCH_CONFIG, { 'mongo-keyfile': 'not base64!' }), 'x'),
		/mongo-keyfile must be 6 to 1,024 base64 characters/,
	);
	assert.throws(() => stackServiceSecrets(api('abc'), folder('env = "development"\n'), 'x'), /has no master_key/);
	assert.throws(
		() => stackServiceSecrets(api('abc'), folder(SEARCH_CONFIG, { 'meilisearch.toml': undefined }), 'x'),
		/has no master_key/,
	);
	assert.throws(
		() => stackServiceSecrets(api('has space'), folder(), 'x'),
		(error) => error instanceof SecretsError && /REDIS_PASSWORD may not contain/.test(error.message),
	);
	assert.throws(
		() => stackServiceSecrets(api('abc', { MONGODB_PASSWORD: "it's" }), folder(), 'x'),
		/MONGODB_PASSWORD may not contain/,
	);
	assert.equal(stackServiceSecrets(api('abc'), folder('master_key = "k1"'), 'x').searchConfig, 'master_key = "k1"\n');
	withRoot((root) => {
		assert.throws(() => write(root, devProject(), { readInfrastructure: infrastructure('') }), SecretsError);
		assert.throws(() => write(root, devProject({ MONGODB_USERNAME: '' })), /MONGODB_USERNAME is blank/);
		assert.throws(() => file(root, 'api.env'), { code: 'ENOENT' });
	});
	assert.equal(stackPort(new Map()), '443');
	assert.throws(() => stackPort(new Map([['STACK_HTTPS_PORT', 'https']])), SecretsError);
});

test('a misspelt name in Infisical stops stack:env before anything is written', () => {
	withRoot((root) => {
		assert.throws(
			() => write(root, devProject({ CSRF_SECRTE: `${MARK}typo` })),
			(error) =>
				error instanceof SecretsError && /CSRF_SECRTE/.test(error.message) && !error.message.includes(MARK),
		);
		assert.throws(() => file(root, 'api.env'), { code: 'ENOENT' });
	});
});

test('without Infisical, apps/api/.env is used and names the inventory does not know are left out', () => {
	withRoot((root) => {
		writeFileSync(
			join(root, 'apps/api/.env'),
			`CSRF_SECRET=${MARK}from-file\nOLD_SETTING=${MARK}old\nPORT=4000\nREDIS_PASSWORD=zzfilepassword\nMONGODB_USERNAME=saha_textile_app\nMONGODB_PASSWORD=zzfilemongo\n`,
		);
		mkdirSync(join(root, 'docker/dev-secrets'), { recursive: true });
		for (const [name, value] of infrastructureFolder())
			writeFileSync(join(root, 'docker/dev-secrets', name), value);
		const unavailable = () => {
			throw new SecretsError('The Infisical CLI is not installed.');
		};
		const lines = write(root, null, { readApi: unavailable });
		assert.equal(lines[0], 'Infisical could not be read, so apps/api/.env was used instead:');
		assert.ok(lines.includes('  Left out, not in the inventory: OLD_SETTING.'));
		const api = parseEnvText(file(root, 'api.env'));
		assert.equal(api.get('CSRF_SECRET'), `${MARK}from-file`);
		assert.equal(api.has('OLD_SETTING'), false);
		assert.match(file(root, 'api.env'), /^# Written by pnpm stack:env from apps\/api\/.env/);
		assert.equal(file(root, 'redis-password'), 'zzfilepassword');
		assert.equal(file(root, 'meilisearch.toml'), SEARCH_CONFIG);
		assert.equal(file(root, 'mongo-app-password'), 'zzfilemongo');
		assert.equal(file(root, 'mongo-root-password'), `${MARK}root`);

		rmSync(join(root, 'apps/api/.env'));
		assert.throws(
			() => write(root, null, { readApi: unavailable }),
			(error) => error instanceof SecretsError && /no apps\/api\/.env to fall back on/.test(error.message),
		);
		assert.throws(
			() =>
				write(root, null, {
					readApi: () => {
						throw new TypeError('unexpected');
					},
				}),
			TypeError,
		);
	});
});
