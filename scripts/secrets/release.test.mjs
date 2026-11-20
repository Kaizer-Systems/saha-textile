import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseEnvText } from './files.mjs';
import { SecretsError, loadInventory } from './inventory.mjs';
import { RELEASES_DIR, localReleaseInputs, pruneReleases, writeLocalRelease } from './release.mjs';

// Every made-up value carries this marker, so a test can prove no value reaches a message.
const MARK = 'zzmadeup';
const inventory = loadInventory();
const DIGEST = `@sha256:${'b'.repeat(64)}`;
const images = new Map(
	['API_IMAGE', 'STOREFRONT_IMAGE', 'ADMIN_IMAGE', 'OPS_IMAGE'].map((name) => [
		name,
		`localhost:5056/saha-textile-${name.split('_')[0].toLowerCase()}${DIGEST}`,
	]),
);

/** The dev project as a filled-in Mac would have it: every release-required name, local addresses. */
function devFolders(apiExtra = {}, deployment = {}) {
	const api = new Map(inventory.requiredForRelease.map((name) => [name, `${MARK}-${name.toLowerCase()}`]));
	for (const [name, value] of Object.entries({
		DEPLOY_ENV: 'local',
		CLIENT_IP_HEADER: '',
		CORS_ALLOWED_ORIGINS: 'https://localhost:4200,https://localhost:4300',
		ADMIN_APP_URL: 'https://localhost:4300',
		MONGODB_HOST: '127.0.0.1',
		MONGODB_PORT: '27018',
		MONGODB_USERNAME: 'saha_textile_app',
		MONGODB_PASSWORD: `${MARK}app`,
		REDIS_PASSWORD: `${MARK}redis`,
		SPACES_CDN_URL: 'https://cdn.example.test',
		SPACES_ENDPOINT: 'https://sgp1.example.test',
		OTP_LOCAL_FIXED_CODE: '123456',
		MEILISEARCH_API_KEY: `${MARK}search`,
		...apiExtra,
	})) {
		api.set(name, value);
	}
	return {
		api,
		backup: new Map(),
		infrastructure: new Map([
			['mongo-keyfile', `${MARK}Keyfile0123456789`],
			['mongo-root-username', 'saha_textile_root'],
			['mongo-root-password', `${MARK}root`],
			['meilisearch.toml', `master_key = "${MARK}master"\nenv = "development"\n`],
		]),
		deployment: new Map(Object.entries(deployment)),
	};
}

function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), 'local-release-'));
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const write = (root, folders, id = 'r1', port = '8443') =>
	writeLocalRelease({ root, folders, inventory, source: 'saha-textile-dev (dev)', port, images, id });

test('the local release describes the stack: its hosts, port, proxy header and services, over the dev values', () => {
	withRoot((root) => {
		const { dir, notes } = write(root, devFolders());
		const release = parseEnvText(readFileSync(join(dir, 'release.env'), 'utf8'));
		assert.equal(release.get('SITE_URL'), 'https://local.saha-textile.localhost:8443');
		assert.equal(release.get('STOREFRONT_HOST'), 'local.saha-textile.localhost');
		assert.equal(release.get('ADMIN_URL'), 'https://admin-local.saha-textile.localhost:8443');
		assert.equal(release.get('EDGE_PORT'), '8443');
		assert.equal(release.get('DEPLOY_ENV'), 'local');
		assert.equal(release.get('CDN_HOST'), 'cdn.example.test');
		assert.equal(release.get('SPACES_HOST'), 'sgp1.example.test');
		assert.equal(release.get('CCAVENUE_HOST'), 'test.ccavenue.com');
		assert.equal(release.get('API_IMAGE'), images.get('API_IMAGE'));

		const api = parseEnvText(readFileSync(join(dir, 'secrets/api.env'), 'utf8'));
		assert.equal(api.get('CLIENT_IP_HEADER'), 'cf-connecting-ip');
		assert.equal(api.get('ADMIN_APP_URL'), 'https://admin-local.saha-textile.localhost:8443');
		assert.equal(api.get('MONGODB_HOST'), 'mongo');
		assert.equal(api.get('MONGODB_DB_NAME'), 'saha_textile_stack');
		assert.equal(api.has('OTP_LOCAL_FIXED_CODE'), false, 'local-only settings stay out');
		assert.equal(api.has('MEILISEARCH_API_KEY'), false, 'the deploy reads it from the search server');
		assert.equal(readFileSync(join(dir, 'secrets/mongo-app-password'), 'utf8'), `${MARK}app`);
		for (const part of ['compose.yaml', 'nginx', 'required-secrets.txt', 'bin/deploy.sh']) {
			assert.ok(existsSync(join(dir, part)), `${part} is copied like a deploy job does`);
		}
		assert.equal(statSync(join(root, '.local-release')).mode & 0o777, 0o700);
		for (const note of notes) assert.ok(!note.includes(MARK));

		// The droplet's own check accepts it (certificates live on the droplet, so --check-only).
		const check = spawnSync('bash', [join(dir, 'bin/deploy.sh'), '--check-only', dir], {
			encoding: 'utf8',
			env: { ...process.env, SAHA_TEXTILE_ROOT: join(root, 'root') },
		});
		assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
		assert.ok(!`${check.stdout}${check.stderr}`.includes(MARK));
	});
});

test('a blank required value stops the release before anything is written, naming it only', () => {
	withRoot((root) => {
		assert.throws(
			() => write(root, devFolders({ MSG91_AUTH_KEY: '' })),
			(error) =>
				error instanceof SecretsError && /MSG91_AUTH_KEY/.test(error.message) && !error.message.includes(MARK),
		);
		assert.equal(existsSync(join(root, RELEASES_DIR, 'r1')), false);
	});
});

test('a /deployment value that disagrees with the stack is refused; one that agrees is fine', () => {
	withRoot((root) => {
		assert.throws(
			() => write(root, devFolders({}, { SITE_URL: 'https://shop.example.test' })),
			/SITE_URL is set both in \/deployment and by the release step, with different values/,
		);
		assert.ok(write(root, devFolders({}, { SITE_URL: 'https://local.saha-textile.localhost:8443' }), 'r2').dir);
	});
});

test('images must be pinned by digest, and port 443 drops the port from every address', () => {
	assert.throws(
		() => localReleaseInputs(devFolders().api, devFolders().infrastructure, { port: '443', images: new Map() }),
		/API_IMAGE is missing or not pinned by digest/,
	);
	const { release } = localReleaseInputs(
		devFolders({ SPACES_ENDPOINT: '', SPACES_REGION: 'blr1', CCAVENUE_BASE_URL: 'https://secure.ccavenue.com/x' })
			.api,
		devFolders().infrastructure,
		{ port: '443', images },
	);
	assert.equal(release.get('API_URL'), 'https://api-local.saha-textile.localhost');
	assert.equal(release.get('SPACES_HOST'), 'blr1.digitaloceanspaces.com');
	assert.equal(release.get('CCAVENUE_HOST'), 'secure.ccavenue.com');
});

test('only the newest three release folders are kept, and a folder is never written twice', () => {
	withRoot((root) => {
		for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) {
			const { dir } = write(root, devFolders(), id);
			const time = new Date(Date.UTC(2020, 0, 1, 10, index));
			utimesSync(dir, time, time);
		}
		// Each write keeps the newest three; with d dated last, a is gone.
		assert.deepEqual(readdirSync(join(root, RELEASES_DIR)).sort(), ['b', 'c', 'd']);
		pruneReleases(join(root, RELEASES_DIR), 2);
		assert.deepEqual(readdirSync(join(root, RELEASES_DIR)).sort(), ['c', 'd']);
		assert.throws(() => write(root, devFolders(), 'd'), /already exists/);
	});
});
