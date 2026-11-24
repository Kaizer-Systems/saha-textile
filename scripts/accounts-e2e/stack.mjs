/**
 * The throwaway stack for the full accounts run (accounts brief, owner's request of 24 Nov): one API on its own port
 * over its own test database, reference data and the demo catalogue seeded, a test administrator made. Nothing it
 * does reaches the working database, the shop's search index or a real phone or mailbox:
 *
 * - the database is `saha_textile_accounts_e2e`, reached with this Mac's test login (scripts/secrets/test-login.mjs),
 *   which accepts only test database names;
 * - search writes to `products_accounts_e2e`; notifications go to the console;
 * - the API is a build kept outside apps/api (ACCOUNTS_E2E_API_DIST): rebuilding apps/api/dist stops the API the
 *   other apps use.
 *
 * `dropSandbox()` removes the database and the search index when the run is over.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testDatabaseUri } from '../secrets/test-login.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATABASE = 'saha_textile_accounts_e2e';
export const SEARCH_INDEX = 'products_accounts_e2e';
export const ADMIN_EMAIL = 'accounts-e2e@example.test';
export const PORT = process.env.ACCOUNTS_E2E_PORT ?? '4097';
export const API_URL = `https://localhost:${PORT}`;

const envFile = resolve(ROOT, 'apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** The API build to run: never apps/api/dist. */
export function apiDist() {
	const dist = process.env.ACCOUNTS_E2E_API_DIST;
	if (!dist || resolve(dist) === resolve(ROOT, 'apps/api/dist'))
		throw new Error(
			'Set ACCOUNTS_E2E_API_DIST to an API build outside apps/api (tsc -p tsconfig.build.json --outDir …).',
		);
	return resolve(dist);
}

/** Everything the stack's processes see. */
export function environment() {
	return {
		...process.env,
		MONGODB_DB_NAME: DATABASE,
		MONGODB_URI: testDatabaseUri({
			host: process.env.MONGODB_HOST,
			port: process.env.MONGODB_PORT,
			replicaSet: process.env.MONGODB_REPLICA_SET,
			database: DATABASE,
		}),
		MONGODB_USERNAME: '',
		MONGODB_PASSWORD: '',
		MEILISEARCH_INDEX: SEARCH_INDEX,
		NOTIFICATION_PROVIDER: 'console',
		OTP_LOCAL_FIXED_CODE: '123456',
		RATE_LIMIT_MAX: '100000',
		PORT,
		NODE_PATH: [resolve(ROOT, 'apps/api/node_modules'), resolve(ROOT, 'node_modules')].join(':'),
		NODE_OPTIONS: '--use-system-ca',
	};
}

function run(label, command, args, options = {}) {
	process.stdout.write(`> ${label}\n`);
	const result = spawnSync(command, args, { cwd: ROOT, env: environment(), encoding: 'utf8', ...options });
	if (result.status !== 0) {
		process.stderr.write((result.stdout ?? '').slice(-4000));
		process.stderr.write((result.stderr ?? '').slice(-4000));
		throw new Error(`${label} failed.`);
	}
	return result.stdout ?? '';
}

async function connection() {
	const require = createRequire(resolve(ROOT, 'packages/adapters-db-mongo/package.json'));
	const mongoose = require('mongoose');
	return mongoose.createConnection(environment().MONGODB_URI).asPromise();
}

/** Drops the sandbox database (only ever this one) and the sandbox search index. */
export async function dropSandbox() {
	const db = await connection();
	if (db.name !== DATABASE) throw new Error(`Refusing to drop ${db.name}.`);
	await db.dropDatabase();
	await db.close();
	const host = process.env.MEILISEARCH_HOST;
	if (host)
		await fetch(`${host.replace(/\/$/, '')}/indexes/${SEARCH_INDEX}`, {
			method: 'DELETE',
			headers: process.env.MEILISEARCH_API_KEY
				? { Authorization: `Bearer ${process.env.MEILISEARCH_API_KEY}` }
				: {},
		}).catch(() => undefined);
}

/** A fresh sandbox: dropped, seeded, an administrator made, the release steps run. Returns the admin password. */
export async function prepare() {
	await dropSandbox();
	run('Seed reference data', 'pnpm', ['--filter', '@saha-textile/adapters-db-mongo', 'seed']);
	run('Seed the demo catalogue', 'pnpm', ['--filter', '@saha-textile/adapters-db-mongo', 'seed:demo-catalogue']);
	const output = run(
		'Create the test administrator',
		'node',
		[resolve(apiDist(), 'create-first-admin.js'), '--email', ADMIN_EMAIL],
		{
			cwd: resolve(ROOT, 'apps/api'),
		},
	);
	const password = /password:\s+(\S+)/.exec(output)?.[1];
	if (!password) throw new Error('The test administrator has no readable password.');
	run('Release steps', 'node', [resolve(apiDist(), 'release-steps.js'), '--without-search'], {
		cwd: resolve(ROOT, 'apps/api'),
	});
	return password;
}

/** Starts the sandbox API and waits until it answers; the child to stop at the end. */
export async function startApi() {
	const child = spawn('node', [resolve(apiDist(), 'main.js')], {
		cwd: resolve(ROOT, 'apps/api'),
		env: environment(),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let log = '';
	child.stdout.on('data', (chunk) => (log = (log + chunk).slice(-20_000)));
	child.stderr.on('data', (chunk) => (log = (log + chunk).slice(-20_000)));
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`The API stopped:\n${log.slice(-3000)}`);
		try {
			const answer = await fetch(`${API_URL}/health/live`, { signal: AbortSignal.timeout(2_000) });
			if (answer.status < 500) return { child, log: () => log };
		} catch {
			// not listening yet
		}
		await new Promise((done) => setTimeout(done, 500));
	}
	child.kill('SIGKILL');
	throw new Error(`The API did not answer on ${API_URL}:\n${log.slice(-3000)}`);
}

/** A product's first variant in the sandbox (id, SKU and selling price). */
export async function variantOf(productId) {
	const db = await connection();
	try {
		const row = await db.collection('productVariants').findOne({ productId });
		if (!row) throw new Error(`No variant for ${productId}`);
		return { id: String(row._id), sku: String(row.sku), price: row.price };
	} finally {
		await db.close();
	}
}
