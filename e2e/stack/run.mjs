#!/usr/bin/env node
/**
 * Runs the Playwright suite against production builds and a throwaway database.
 *
 *   pnpm e2e:stack                     build, seed, start everything, test, stop
 *   pnpm e2e:stack -- --keep           leave the stack running afterwards, for inspection
 *   pnpm e2e:stack -- --serve          start the stack and wait; no tests
 *   pnpm e2e:stack -- e2e/admin.spec.ts --project=desktop
 *
 * Everything lands in `saha_textile_e2e` and the `products_e2e` search index, never in the
 * working database. The test administrator is created fresh on every run and its generated
 * password passes to Playwright through the environment. `--serve` prints it, because the only
 * reason to serve is to sign in by hand; it dies with that throwaway database.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATABASE = 'saha_textile_e2e';
const SEARCH_INDEX = 'products_e2e';
const ADMIN_EMAIL = 'e2e-admin@example.test';
const STOREFRONT_PORT = '4210';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const keep = args.includes('--keep');
const serveOnly = args.includes('--serve');
const playwrightArgs = args.filter((arg) => arg !== '--keep' && arg !== '--serve');

const envFile = resolve(ROOT, 'apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = {
	...process.env,
	MONGODB_DB_NAME: DATABASE,
	MEILISEARCH_INDEX: SEARCH_INDEX,
	OTP_LOCAL_FIXED_CODE: process.env.OTP_LOCAL_FIXED_CODE || '123456',
	NOTIFICATION_PROVIDER: 'console',
};

const children = [];

function stopAll() {
	for (const child of children) child.kill('SIGTERM');
}

function fail(message) {
	process.stderr.write(`\n${message}\n`);
	stopAll();
	process.exit(1);
}

function run(label, command, commandArgs, options = {}) {
	process.stdout.write(`> ${label}\n`);
	const result = spawnSync(command, commandArgs, { cwd: ROOT, env, encoding: 'utf8', ...options });
	if (result.status !== 0) {
		process.stderr.write(result.stdout ?? '');
		process.stderr.write(result.stderr ?? '');
		fail(`${label} failed.`);
	}
	return result.stdout ?? '';
}

function start(label, command, commandArgs, options = {}) {
	const child = spawn(command, commandArgs, { cwd: ROOT, env, stdio: 'ignore', ...options });
	child.on('exit', (code) => {
		if (code && !child.killed) fail(`${label} stopped with code ${code}.`);
	});
	children.push(child);
}

async function waitFor(label, url) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
			if (response.status < 500) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((done) => setTimeout(done, 500));
	}
	fail(`${label} did not answer at ${url}.`);
}

async function resetDatabase() {
	const require = createRequire(resolve(ROOT, 'packages/adapters-db-mongo/package.json'));
	const mongoose = require('mongoose');
	const host = env.MONGODB_HOST || '127.0.0.1';
	const port = env.MONGODB_PORT || '27017';
	const replicaSet = env.MONGODB_REPLICA_SET || 'rs0';
	const connection = await mongoose
		.createConnection(`mongodb://${host}:${port}/${DATABASE}?replicaSet=${replicaSet}&directConnection=true`)
		.asPromise();
	await connection.dropDatabase();
	await connection.close();
}

function createTestAdmin() {
	const output = run(
		'Create the test administrator',
		'node',
		['dist/create-first-admin.js', '--email', ADMIN_EMAIL],
		{
			cwd: resolve(ROOT, 'apps/api'),
		},
	);
	const password = /password:\s+(\S+)/.exec(output)?.[1];
	if (!password) fail('The test administrator was created without a readable password.');
	return password;
}

process.on('SIGINT', () => {
	stopAll();
	process.exit(130);
});

// Node reads the local CA from the system store, as the storefront's server-side fetches need.
env.NODE_OPTIONS = '--use-system-ca';

run('Build the apps', 'pnpm', ['build:product-apps']);
await resetDatabase();
run('Seed reference data', 'pnpm', ['--filter', '@saha-textile/adapters-db-mongo', 'seed']);
run('Seed the demo catalogue', 'pnpm', ['--filter', '@saha-textile/adapters-db-mongo', 'seed:demo-catalogue']);
const adminPassword = createTestAdmin();
run('Fill the search index', 'pnpm', ['--filter', '@saha-textile/api', 'search:rebuild']);

start('API', 'node', ['dist/main.js'], { cwd: resolve(ROOT, 'apps/api') });
start('Storefront', 'node', ['dist/analog/server/index.mjs'], {
	cwd: resolve(ROOT, 'apps/storefront'),
	env: { ...env, PORT: STOREFRONT_PORT },
});
start('TLS proxy', 'node', [
	'e2e/stack/tls-proxy.mjs',
	'certs/localhost-key.pem',
	'certs/localhost-cert.pem',
	STOREFRONT_PORT,
]);
start('Admin', 'pnpm', ['exec', 'vite', 'preview', '--host', 'localhost', '--port', '4300', '--strictPort'], {
	cwd: resolve(ROOT, 'apps/admin'),
});

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
await waitFor('API', 'https://localhost:4000/health');
await waitFor('Storefront', 'https://localhost:4200/en');
await waitFor('Admin', 'https://localhost:4300/');
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

const playwrightEnv = { ...env, E2E_ADMIN_EMAIL: ADMIN_EMAIL, E2E_ADMIN_PASSWORD: adminPassword };

if (serveOnly) {
	process.stdout.write(`Stack is up on ${DATABASE}. Press Ctrl+C to stop.\n`);
	process.stdout.write(`E2E_ADMIN_EMAIL=${ADMIN_EMAIL}\nE2E_ADMIN_PASSWORD=${adminPassword}\n`);
	await new Promise(() => {});
}

const tests = spawnSync('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
	cwd: ROOT,
	env: playwrightEnv,
	stdio: 'inherit',
});

if (keep) {
	process.stdout.write('Stack left running. Press Ctrl+C to stop.\n');
	await new Promise(() => {});
}
stopAll();
process.exit(tests.status ?? 1);
