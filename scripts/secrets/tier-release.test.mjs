import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { githubLogin } from './github-login.mjs';
import { parseEnvText } from './files.mjs';
import { SecretsError, loadInventory } from './inventory.mjs';
import { tierReleaseSettings, writeTierRelease } from './tier-release.mjs';

const MARK = 'zzmadeup';
const inventory = loadInventory();
const DIGEST = `@sha256:${'c'.repeat(64)}`;
const images = new Map(
	['API_IMAGE', 'STOREFRONT_IMAGE', 'ADMIN_IMAGE', 'OPS_IMAGE'].map((name) => [
		name,
		`ghcr.io/x/${name.toLowerCase()}${DIGEST}`,
	]),
);

/** A filled staging or production project, with made-up values and agreeing addresses. */
function project(tier) {
	const api = new Map(inventory.requiredForRelease.map((name) => [name, `${MARK}-${name.toLowerCase()}`]));
	for (const [name, value] of Object.entries({
		DEPLOY_ENV: tier,
		MONGODB_USERNAME: 'saha_textile_app',
		MONGODB_PASSWORD: `${MARK}app`,
		REDIS_PASSWORD: `${MARK}redis`,
		SPACES_CDN_URL: 'https://cdn.example.test',
		ADMIN_APP_URL: 'https://admin.example.test',
	})) {
		api.set(name, value);
	}
	const deployment = new Map(
		Object.entries({
			STOREFRONT_HOST: 'shop.example.test',
			ADMIN_HOST: 'admin.example.test',
			API_HOST: 'api.example.test',
			CDN_HOST: 'cdn.example.test',
			SPACES_HOST: 'sgp1.digitaloceanspaces.com',
			CCAVENUE_HOST: 'test.ccavenue.com',
			SITE_URL: 'https://shop.example.test',
			API_URL: 'https://api.example.test',
			ADMIN_URL: 'https://admin.example.test',
		}),
	);
	return {
		api,
		backup: new Map(inventory.backup.map((name) => [name, `${MARK}-${name.toLowerCase()}`])),
		infrastructure: new Map([
			['mongo-keyfile', `${MARK}Keyfile0123456789`],
			['mongo-root-username', 'saha_textile_root'],
			['mongo-root-password', `${MARK}root`],
			['meilisearch.toml', `master_key = "${MARK}master"\nenv = "production"\n`],
		]),
		deployment,
	};
}

function withDir(fn) {
	const dir = mkdtempSync(join(tmpdir(), 'tier-release-'));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('a staging or production release folder passes the droplet check, with digests, tier, port and root', () => {
	for (const tier of ['staging', 'production']) {
		withDir((dir) => {
			const out = join(dir, 'release');
			writeTierRelease({ out, folders: project(tier), inventory, tier, images, source: `test (${tier})` });
			const release = parseEnvText(readFileSync(join(out, 'release.env'), 'utf8'));
			assert.equal(release.get('DEPLOY_ENV'), tier);
			assert.equal(release.get('EDGE_PORT'), '443');
			assert.equal(release.get('SAHA_TEXTILE_ROOT'), '/opt/saha-textile');
			assert.equal(release.get('API_IMAGE'), images.get('API_IMAGE'));
			assert.equal(release.get('SITE_URL'), 'https://shop.example.test');
			assert.ok(existsSync(join(out, 'bin/deploy.sh')));
			const check = spawnSync('bash', [join(out, 'bin/deploy.sh'), '--check-only', out], {
				encoding: 'utf8',
				env: { ...process.env, SAHA_TEXTILE_ROOT: join(dir, 'root') },
			});
			assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
			assert.ok(!`${check.stdout}${check.stderr}`.includes(MARK));
		});
	}
});

test('a deploy release refuses another tier, unpinned images and a folder that is not empty', () => {
	assert.throws(() => tierReleaseSettings('dev', images), /for staging or production, not dev/);
	assert.throws(() => tierReleaseSettings('staging', new Map()), /API_IMAGE is missing or not pinned/);
	withDir((dir) => {
		writeFileSync(join(dir, 'old'), 'x');
		assert.throws(
			() =>
				writeTierRelease({
					out: dir,
					folders: project('staging'),
					inventory,
					tier: 'staging',
					images,
					source: 't',
				}),
			(error) => error instanceof SecretsError && /must be empty/.test(error.message),
		);
	});
	withDir((dir) => {
		const folders = project('production');
		folders.backup = new Map();
		assert.throws(
			() =>
				writeTierRelease({ out: join(dir, 'r'), folders, inventory, tier: 'production', images, source: 't' }),
			/Required for production backups but blank in \/backup/,
		);
	});
});

test('the GitHub sign-in exchanges the job token, masks the Infisical token and hands it to later steps', async () => {
	await (async () => {
		const dir = mkdtempSync(join(tmpdir(), 'gh-login-'));
		try {
			const envFile = join(dir, 'github_env');
			writeFileSync(envFile, '');
			const lines = [];
			const calls = [];
			await githubLogin({
				identityId: '5be455b6-0332-4009-932b-31bb7c7ab9d0',
				env: {
					ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example.test/?x=1',
					ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'bearer-zz',
					GITHUB_ENV: envFile,
					GITHUB_REPOSITORY_OWNER: 'Kaizer-Systems',
				},
				fetchImpl: async (url, init) => {
					calls.push({ url, auth: init.headers.Authorization });
					return { ok: true, json: async () => ({ value: 'jwt-zz' }) };
				},
				run: (command, args) => {
					calls.push({ command, args });
					return { status: 0, stdout: 'infisical-token-zz\n' };
				},
				write: (line) => lines.push(line),
			});
			assert.equal(
				calls[0].url,
				'https://token.example.test/?x=1&audience=https%3A%2F%2Fgithub.com%2FKaizer-Systems',
			);
			assert.equal(calls[0].auth, 'bearer bearer-zz');
			assert.deepEqual(calls[1].args.slice(0, 3), [
				'login',
				'--method=oidc-auth',
				'--machine-identity-id=5be455b6-0332-4009-932b-31bb7c7ab9d0',
			]);
			assert.deepEqual(lines, ['::add-mask::infisical-token-zz\n']);
			assert.equal(readFileSync(envFile, 'utf8'), 'INFISICAL_TOKEN=infisical-token-zz\n');
			mkdirSync(join(dir, 'x'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	})();
	await assert.rejects(githubLogin({ identityId: 'not-a-uuid' }), /machine identity id/);
	await assert.rejects(
		githubLogin({ identityId: '5be455b6-0332-4009-932b-31bb7c7ab9d0', env: {} }),
		/id-token: write/,
	);
	await assert.rejects(
		githubLogin({
			identityId: '5be455b6-0332-4009-932b-31bb7c7ab9d0',
			env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'u?', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't', GITHUB_ENV: '/dev/null' },
			fetchImpl: async () => ({ ok: true, json: async () => ({ value: 'jwt' }) }),
			run: () => ({ status: 1, stdout: '' }),
		}),
		/Infisical refused the sign-in \(exit 1\)/,
	);
	await assert.rejects(
		githubLogin({
			identityId: '5be455b6-0332-4009-932b-31bb7c7ab9d0',
			env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'u?', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't', GITHUB_ENV: '/dev/null' },
			fetchImpl: async () => ({ ok: false, status: 403 }),
		}),
		/GitHub refused the token request \(403\)/,
	);
});
