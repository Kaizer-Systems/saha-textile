import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT } from './inventory.mjs';

// Every made-up value carries this marker, so a test can prove no value reaches a message.
const MARK = 'zzmadeup';
const DIGEST = `@sha256:${'a'.repeat(64)}`;

/** A complete release folder, with made-up values, that passes every check. */
function withRelease(change, fn) {
	const dir = mkdtempSync(join(tmpdir(), 'release-check-'));
	try {
		const release = join(dir, 'release');
		mkdirSync(join(release, 'secrets'), { recursive: true });
		cpSync(join(ROOT, 'docker/production/bin'), join(release, 'bin'), { recursive: true });
		cpSync(join(ROOT, 'docker/production/required-secrets.txt'), join(release, 'required-secrets.txt'));
		const vars = {
			API_IMAGE: `registry.test/api${DIGEST}`,
			STOREFRONT_IMAGE: `registry.test/storefront${DIGEST}`,
			ADMIN_IMAGE: `registry.test/admin${DIGEST}`,
			OPS_IMAGE: `registry.test/ops${DIGEST}`,
			DEPLOY_ENV: 'staging',
			EDGE_PORT: '443',
			STOREFRONT_HOST: 'shop.example.test',
			ADMIN_HOST: 'admin.example.test',
			API_HOST: 'api.example.test',
			CDN_HOST: 'cdn.example.test',
			SPACES_HOST: 'sgp1.example.test',
			CCAVENUE_HOST: 'test.ccavenue.com',
			SITE_URL: 'https://shop.example.test',
			API_URL: 'https://api.example.test',
			ADMIN_URL: 'https://admin.example.test',
			...change.release,
		};
		const required = readFileSync(join(release, 'required-secrets.txt'), 'utf8')
			.split('\n')
			.filter((line) => line && !line.startsWith('#'));
		const api = Object.fromEntries(required.map((name) => [name, `${MARK}-${name.toLowerCase()}`]));
		Object.assign(api, {
			SPACES_CDN_URL: 'https://cdn.example.test',
			SPACES_ENDPOINT: 'https://sgp1.example.test',
			ADMIN_APP_URL: 'https://admin.example.test/',
			...change.api,
		});
		const lines = (entries) =>
			Object.entries(entries)
				.filter(([, value]) => value !== undefined)
				.map(([name, value]) => `${name}=${value}`)
				.join('\n') + '\n';
		writeFileSync(join(release, 'release.env'), lines(vars));
		writeFileSync(join(release, 'secrets/api.env'), lines(api));
		for (const name of [
			'backup.env',
			'mongo-keyfile',
			'mongo-root-username',
			'mongo-root-password',
			'mongo-app-password',
			'redis-password',
			'meilisearch.toml',
		]) {
			writeFileSync(join(release, 'secrets', name), `${MARK}\n`);
		}
		fn(release, join(dir, 'root'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function check(release, root, args = ['--check-only']) {
	const run = spawnSync('bash', [join(release, 'bin/deploy.sh'), ...args, release], {
		encoding: 'utf8',
		env: { ...process.env, SAHA_TEXTILE_ROOT: root },
	});
	const output = `${run.stdout}${run.stderr}`;
	assert.ok(!output.includes(MARK), 'a value reached the output');
	for (const host of ['example.test', 'ccavenue.com']) assert.ok(!output.includes(host), 'a host reached the output');
	return { status: run.status, output };
}

test('--check-only passes a complete folder and starts nothing; a full deploy still needs the droplet certificates', () => {
	withRelease({}, (release, root) => {
		const ok = check(release, root);
		assert.equal(ok.status, 0, ok.output);
		assert.match(ok.output, /The release folder passed every check\. Nothing was started\./);
		const full = check(release, root, []);
		assert.equal(full.status, 1);
		assert.match(full.output, /certs\/origin\.pem is missing or empty/);
	});
});

test('a URL and its host that disagree are refused, naming the settings only (owner decision D3)', () => {
	const cases = [
		[
			{ release: { SITE_URL: 'https://other.example.test:8443' } },
			/SITE_URL and STOREFRONT_HOST in release\.env must name the same host/,
		],
		[{ release: { ADMIN_HOST: 'admin2.example.test' } }, /ADMIN_URL and ADMIN_HOST/],
		[{ release: { API_URL: 'https://api2.example.test/v1' } }, /API_URL and API_HOST/],
		[
			{ api: { SPACES_CDN_URL: 'https://cdn2.example.test' } },
			/CDN_HOST in release\.env must be the host of SPACES_CDN_URL/,
		],
		[
			{ api: { SPACES_ENDPOINT: 'https://blr1.example.test' } },
			/SPACES_HOST in release\.env must be the host of SPACES_ENDPOINT/,
		],
		[
			{ api: { ADMIN_APP_URL: 'https://admin.example.test:4300' } },
			/ADMIN_APP_URL in secrets\/api\.env must be ADMIN_URL/,
		],
	];
	for (const [change, message] of cases) {
		withRelease(change, (release, root) => {
			const result = check(release, root);
			assert.equal(result.status, 1, `expected a refusal for ${message}`);
			assert.match(result.output, message);
		});
	}
});

test('a port in an address is allowed, and the optional addresses may be unset', () => {
	withRelease(
		{
			release: { SITE_URL: 'https://shop.example.test:8443', EDGE_PORT: '8443' },
			api: { SPACES_ENDPOINT: undefined, ADMIN_APP_URL: undefined },
		},
		(release, root) => assert.equal(check(release, root).status, 0),
	);
});

test('the folder checks still refuse an image without a digest, a missing setting, file or required name', () => {
	const cases = [
		[{ release: { API_IMAGE: 'registry.test/api:latest' } }, /API_IMAGE must be pinned by digest/],
		[{ release: { CDN_HOST: undefined } }, /CDN_HOST is missing from release\.env/],
		[{ api: { MSG91_AUTH_KEY: '' } }, /MSG91_AUTH_KEY has no value in secrets\/api\.env/],
	];
	for (const [change, message] of cases) {
		withRelease(change, (release, root) => {
			const result = check(release, root);
			assert.equal(result.status, 1);
			assert.match(result.output, message);
		});
	}
	withRelease({}, (release, root) => {
		rmSync(join(release, 'secrets/mongo-keyfile'));
		assert.match(check(release, root).output, /secrets\/mongo-keyfile is missing or empty/);
	});
});
