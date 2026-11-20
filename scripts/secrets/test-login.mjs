#!/usr/bin/env node
/**
 * The Mac's test login for MongoDB, used by every runner that works on a database of its own: the
 * browser tests (`saha_textile_e2e`), coverage and the opt-in adapter suites (`saha_textile_it`,
 * `saha_textile_test` and the names they derive), and the session-rotation check.
 *
 * Once this Mac's MongoDB requires logins (phase 2 of the Infisical plan, 2026-11-20), the app login
 * in `apps/api/.env` reaches only `saha_textile_local`, as on a droplet. Test databases are named on
 * the fly (`saha_textile_it_purchasing_flow`, `…_permissions_rename_it`, `…_seed_local_…`), and
 * MongoDB cannot grant rights by name prefix, so this one login may read, write and drop any
 * database on this Mac. It exists only here: never in Infisical, never on a droplet. Each runner
 * still refuses a database that is not a test database, as before.
 *
 * `pnpm secrets:setup-local` makes the password once, in the gitignored
 * `docker/dev-secrets/mongo-test-password` of the main folder, which worktrees share. Without the
 * file (CI, or a Mac before setup) the address carries no login, as before.
 *
 *   MONGODB_URI="$(node scripts/secrets/test-login.mjs saha_textile_test)" RUN_DB_IT=1 \
 *     MONGODB_DB_NAME=saha_textile_test pnpm --filter @saha-textile/adapters-db-mongo test
 *
 * The address holds the password, so it is printed only into a pipe or `$(…)`, never to a screen.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DATABASE_USER = 'saha_textile_tests';
export const TEST_PASSWORD_FILE = 'docker/dev-secrets/mongo-test-password';
/** Read, write, index and drop on any database; no user, role or replica-set management. */
export const TEST_ROLES = [
	{ role: 'readWriteAnyDatabase', db: 'admin' },
	{ role: 'dbAdminAnyDatabase', db: 'admin' },
];

const OWN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The main folder of this checkout. A worktree has no `docker/dev-secrets/` of its own (it is
 * gitignored), so every folder reads the main folder's.
 * @param {string} [root]
 */
export function mainCheckout(root = OWN_ROOT) {
	try {
		const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return dirname(common);
	} catch {
		return root;
	}
}

/**
 * A connection address for one test database, with the test login when this Mac has one.
 * @param {{ host?: string, port?: string | number, replicaSet?: string, database: string }} target
 * @param {{ root?: string }} [options]  where `docker/dev-secrets/` lives (default: the main folder)
 */
export function testDatabaseUri({ host, port, replicaSet, database }, { root } = {}) {
	const file = join(root ?? mainCheckout(), TEST_PASSWORD_FILE);
	const password = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
	const login = password ? `${encodeURIComponent(TEST_DATABASE_USER)}:${encodeURIComponent(password)}@` : '';
	const params = new URLSearchParams({
		replicaSet: replicaSet || 'rs0',
		directConnection: 'true',
		retryWrites: 'true',
		w: 'majority',
	});
	if (password) params.set('authSource', 'admin');
	return `mongodb://${login}${host || '127.0.0.1'}:${port || '27017'}/${database}?${params.toString()}`;
}

/** Host, port and replica set: the environment first, then `apps/api/.env`, then the defaults. */
export function localMongoTarget(database, env = process.env, root = OWN_ROOT) {
	const file = join(root, 'apps/api/.env');
	const fromFile = existsSync(file) ? Object.fromEntries(parseEnvLines(readFileSync(file, 'utf8'))) : {};
	const pick = (name) => env[name] || fromFile[name] || undefined;
	return {
		host: pick('MONGODB_HOST'),
		port: pick('MONGODB_PORT'),
		replicaSet: pick('MONGODB_REPLICA_SET'),
		database,
	};
}

/** The three plain settings above only: NAME=value lines, quotes stripped. */
function* parseEnvLines(text) {
	for (const line of text.split('\n')) {
		const match = /^\s*(MONGODB_HOST|MONGODB_PORT|MONGODB_REPLICA_SET)\s*=\s*(.*?)\s*$/.exec(line);
		if (match) yield [match[1], match[2].replace(/^(['"`])(.*)\1$/, '$2')];
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const database = process.argv[2];
	if (!database || !/_(it|e2e|test)(_[a-z0-9_]+)?$/.test(database)) {
		process.stderr.write(
			'Usage: node scripts/secrets/test-login.mjs <test database, ending in _it, _e2e or _test>\n',
		);
		process.exit(2);
	}
	if (process.stdout.isTTY) {
		process.stderr.write('This prints a password. Use it inside $(…) or a pipe, never on the screen.\n');
		process.exit(2);
	}
	process.stdout.write(testDatabaseUri(localMongoTarget(database)));
}
