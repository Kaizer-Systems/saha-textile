import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { githubLogin } from './github-login.mjs';
import { parseEnvText } from './files.mjs';
import { ROOT, SecretsError, loadInventory } from './inventory.mjs';
import {
	checkAllowBlankNames,
	parseImagesFile,
	parseReleaseArgs,
	tierReleaseSettings,
	writeTierRelease,
} from './tier-release.mjs';

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

test('the images file: four pinned names, comments and blank lines allowed, anything else refused', () => {
	const text = ['# images for this commit', '', ...[...images].map(([name, image]) => `${name}=${image}`), ''].join(
		'\n',
	);
	assert.deepEqual(parseImagesFile(text), images);
	assert.throws(() => parseImagesFile('API_IMAGE = x'), /line 1 is not NAME=/);
	assert.throws(() => parseImagesFile('\nWEB_IMAGE=x'), /line 2: WEB_IMAGE is not one of API_IMAGE/);
	assert.throws(() => parseImagesFile('API_IMAGE=a\nAPI_IMAGE=b'), /API_IMAGE is given twice/);
});

/**
 * Runs the deploy job's two steps the way deploy.yml does: a checkout with no node_modules anywhere
 * above it, a stand-in Infisical CLI on PATH answering `export --path /<folder>` from `folders`, and
 * `umask 077`. Returns both runs and the release folder.
 */
function runBareRelease(dir, folders, extraArgs = []) {
	const repo = join(dir, 'repo');
	for (const part of ['scripts/secrets', 'docker/infisical', 'docker/production']) {
		cpSync(join(ROOT, part), join(repo, part), { recursive: true });
	}
	const exports = join(dir, 'exports');
	mkdirSync(exports);
	for (const [folder, values] of Object.entries(folders)) {
		const entries = [...values].map(([key, value]) => ({ key, value }));
		writeFileSync(join(exports, `${folder}.json`), JSON.stringify(entries));
	}
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	writeFileSync(
		join(bin, 'infisical'),
		[
			'#!/usr/bin/env node',
			"const { existsSync, readFileSync } = require('node:fs');",
			"const folder = process.argv[process.argv.indexOf('--path') + 1].slice(1);",
			'const file = `${process.env.STAND_IN_EXPORTS}/${folder}.json`;',
			"process.stdout.write(existsSync(file) ? readFileSync(file, 'utf8') : '[]');",
			'',
		].join('\n'),
		{ mode: 0o755 },
	);
	const imagesFile = join(dir, 'images.env');
	writeFileSync(imagesFile, [...images].map(([name, image]) => `${name}=${image}\n`).join(''));
	const out = join(dir, 'release');
	const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STAND_IN_EXPORTS: exports };
	delete env.NODE_PATH;
	const write = spawnSync(
		'bash',
		[
			'-c',
			'umask 077 && mkdir "$2" && node "$1/scripts/secrets/cli.mjs" release staging --images "$3" --out "$2" "${@:4}"',
			'job',
			repo,
			out,
			imagesFile,
			...extraArgs,
		],
		{ encoding: 'utf8', env },
	);
	const check = existsSync(join(out, 'bin/deploy.sh'))
		? spawnSync('bash', [join(out, 'bin/deploy.sh'), '--check-only', out], { encoding: 'utf8', env })
		: null;
	for (const run of [write, check]) {
		if (run) assert.ok(!`${run.stdout}${run.stderr}`.includes(MARK), 'a value reached the output');
	}
	return { write, check, out };
}

test("the deploy job's steps run in a bare checkout under umask 077: no packages, files the containers can read", () => {
	withDir((dir) => {
		const { write, check, out } = runBareRelease(dir, project('staging'));
		assert.equal(write.status, 0, `${write.stdout}${write.stderr}`);
		assert.equal(statSync(join(out, 'secrets/api.env')).mode & 0o777, 0o644);
		assert.equal(statSync(join(out, 'secrets')).mode & 0o777, 0o700);
		assert.equal(check?.status, 0, `${check?.stdout}${check?.stderr}`);
		assert.ok(!existsSync(join(out, 'allowed-blank.txt')));
	});
});

test('a deploy job with --allow-blank ships a server whose provider keys are still blank, and records them', () => {
	withDir((dir) => {
		const folders = project('staging');
		for (const name of ['MSG91_AUTH_KEY', 'SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET'])
			folders.api.set(name, '');
		const allow = ['MSG91_AUTH_KEY', 'SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET'].flatMap((name) => [
			'--allow-blank',
			name,
		]);
		const { write, check, out } = runBareRelease(dir, folders, allow);
		assert.equal(write.status, 0, `${write.stdout}${write.stderr}`);
		assert.match(
			write.stdout,
			/Deployed blank, as asked: MSG91_AUTH_KEY, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET \(recorded in allowed-blank\.txt\)/,
		);
		assert.equal(
			readFileSync(join(out, 'allowed-blank.txt'), 'utf8'),
			'MSG91_AUTH_KEY\nSPACES_BUCKET\nSPACES_KEY\nSPACES_SECRET\n',
		);
		const api = parseEnvText(readFileSync(join(out, 'secrets/api.env'), 'utf8'));
		assert.equal(api.get('RELEASE_ALLOWED_BLANK'), 'MSG91_AUTH_KEY,SPACES_BUCKET,SPACES_KEY,SPACES_SECRET');
		assert.ok(!api.has('MSG91_AUTH_KEY'));
		assert.equal(check?.status, 0, `${check?.stdout}${check?.stderr}`);
		assert.match(check?.stdout ?? '', /Deploying with these blank, as asked: MSG91_AUTH_KEY, SPACES_BUCKET/);
	});
	// A name that may never be blank is refused before Infisical is read, so the stand-in is never called.
	withDir((dir) => {
		const { write } = runBareRelease(dir, project('staging'), ['--allow-blank', 'JWT_ACCESS_SECRET']);
		assert.equal(write.status, 1);
		assert.match(
			write.stderr,
			/JWT_ACCESS_SECRET can never be deployed blank\. Only these can: MSG91_AUTH_KEY, SPACES_BUCKET/,
		);
	});
});

test('--allow-blank names: only required names tagged may-deploy-blank, each once, never echoing a bad one', () => {
	assert.deepEqual(
		parseReleaseArgs([
			'--',
			'production',
			'--allow-blank',
			'A_B',
			'--images',
			'i',
			'--out',
			'o',
			'--allow-blank',
			'C_D',
		]),
		{ tier: 'production', imagesFile: 'i', out: 'o', allowBlank: ['A_B', 'C_D'] },
	);
	for (const args of [
		['staging', '--images', 'i'],
		['staging', '--images', 'i', '--out', 'o', '--allow-blank'],
		['staging', '--images', 'i', '--out', 'o', '--out', 'p'],
		['staging', '--images', 'i', '--out', 'o', '--force', 'x'],
		['staging', '--images', '--out', 'o'],
		['dev', '--images', 'i', '--out', 'o'],
	]) {
		assert.throws(() => parseReleaseArgs(args), /Usage: pnpm secrets:release/, args.join(' '));
	}
	assert.deepEqual(
		[...checkAllowBlankNames(['MSG91_AUTH_KEY', 'SPACES_KEY'], inventory)],
		['MSG91_AUTH_KEY', 'SPACES_KEY'],
	);
	assert.throws(() => checkAllowBlankNames(['CCAVENUE_WORKING_KEY'], inventory), /not required for a release/);
	for (const name of ['NOTIFICATION_PROVIDER', 'CLIENT_IP_HEADER', 'SPACES_CDN_URL', 'MONGODB_PASSWORD']) {
		assert.throws(() => checkAllowBlankNames([name], inventory), /can never be deployed blank/, name);
	}
	assert.throws(() => checkAllowBlankNames(['MSG91_AUTH_KEY', 'MSG91_AUTH_KEY'], inventory), /given twice/);
	assert.throws(
		() => checkAllowBlankNames([`${MARK}=secret`], inventory),
		(error) => /not a setting name/.test(error.message) && !error.message.includes(MARK),
	);
});

test('the release builder deploys blank only what it was told, keeps the media keys together, and refuses a stored record', () => {
	const write = (folders, allowBlank, tier = 'staging') => {
		let result;
		withDir((dir) => {
			const out = join(dir, 'release');
			result = writeTierRelease({ out, folders, inventory, tier, images, source: 't', allowBlank });
		});
		return /** @type {ReturnType<typeof writeTierRelease>} */ (result);
	};
	// Allowed but filled after all: deployed with its value, not recorded.
	const filled = write(project('staging'), new Set(['MSG91_AUTH_KEY']));
	assert.deepEqual(filled.deployedBlank, []);
	assert.ok(
		filled.notes.includes('MSG91_AUTH_KEY was allowed blank but has a value, so it is deployed with its value.'),
	);

	const partial = project('staging');
	partial.api.set('SPACES_KEY', '');
	assert.throws(
		() => write(partial, new Set(['SPACES_KEY'])),
		/SPACES_KEY, SPACES_SECRET, SPACES_BUCKET go together/,
	);

	const stored = project('production');
	stored.api.set('RELEASE_ALLOWED_BLANK', 'MSG91_AUTH_KEY');
	assert.throws(
		() => write(stored, new Set(), 'production'),
		/\/api\/RELEASE_ALLOWED_BLANK is written by the release itself/,
	);

	assert.throws(() => write(project('staging'), new Set(['CCAVENUE_WORKING_KEY'])), /not required for a release/);
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
