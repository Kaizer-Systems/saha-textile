/**
 * `pnpm secrets:setup-local`: gives this Mac's own services real logins, the way a droplet has them
 * (owner, 2026-11-20: "proper configuration … because a similar configuration would need to be done
 * on staging and prod as well").
 *
 * 1. Fills every BLANK service setting in `apps/api/.env` with a value from generate.mjs, and the
 *    local settings that are blank (Redis address, DEPLOY_ENV=local, COOKIE_SECURE=true). A setting
 *    that already has a value is never changed; the file before is kept as
 *    `apps/api/.env.before-local-setup`.
 * 2. Writes `docker/dev-secrets/`: the four `/infrastructure` files (made once, never replaced) and
 *    the two files written from `/api` (mongo-app-password, redis-password), as in a release folder.
 * 3. Creates (or updates) the administrator in `admin` and the app login in the app's database with
 *    `readWrite` only, exactly as deploy.sh does, and proves the app login works. Also the Mac-only
 *    test login (`test-login.mjs`) for the test runners' own databases, its password made once in
 *    `docker/dev-secrets/mongo-test-password`. That one never goes to Infisical or a droplet.
 * 4. Writes `docker/dev-secrets/for-infisical.env`: the `/api` lines the dev project still lacks, to
 *    drag onto its `/api` folder. The `/infrastructure` files sit beside it.
 *
 * Logins are created but not yet required: Mongo and Redis only demand them once their switch is on
 * (phase 2, on the owner's word), so nothing running on this Mac breaks today. Names only in output.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvText, readIfPresent, replaceFile } from './files.mjs';
import { generateServiceSecrets } from './generate.mjs';
import { SecretsError } from './inventory.mjs';
import { envLine, isBlank } from './render.mjs';
import { TEST_DATABASE_USER, TEST_PASSWORD_FILE, TEST_ROLES } from './test-login.mjs';

export const DEV_SECRETS_DIR = 'docker/dev-secrets';
export const FOR_INFISICAL = `${DEV_SECRETS_DIR}/for-infisical.env`;
export const BEFORE_LOCAL_SETUP = 'apps/api/.env.before-local-setup';
export const MONGO_CONTAINER = 'saha-textile-mongo';

/** Local settings with one right value on this Mac. Equal to the API's own defaults where it has one. */
export const LOCAL_SETTINGS = new Map([
	['REDIS_HOST', '127.0.0.1'],
	['REDIS_PORT', '6379'],
	['DEPLOY_ENV', 'local'],
	['COOKIE_SECURE', 'true'],
	['ADMIN_APP_URL', 'https://localhost:4300'],
]);

/**
 * The API starts only with all five of these or none. A Mac without the Google client's three keys
 * gets the other two through Infisical with them, at the first pull, instead of in its file now.
 */
export const MAILBOX_GROUP = [
	'GOOGLE_MAIL_CLIENT_ID',
	'GOOGLE_MAIL_CLIENT_SECRET',
	'GOOGLE_MAIL_REDIRECT_URI',
	'MAILBOX_TOKEN_KEY',
	'ADMIN_APP_URL',
];

const SETTING_LINE = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);

/**
 * Fills blank settings in an env file's text and leaves everything else exactly as it was: comments,
 * order, and every setting that already has a value. A blank setting's line is replaced where it
 * stands; a missing one is added at the end.
 * @param {string} text
 * @param {Map<string, string>} values
 */
export function fillBlanks(text, values) {
	const current = parseEnvText(text);
	const lines = text.split('\n');
	const filled = [];
	const kept = [];
	const appended = [];
	for (const [name, value] of values) {
		if (!isBlank(current.get(name))) {
			kept.push(name);
			continue;
		}
		filled.push(name);
		const line = envLine(name, value, false);
		// dotenv keeps the last line for a name, so that is the one replaced.
		const index = lines.findLastIndex((candidate) => SETTING_LINE(name).test(candidate));
		if (index === -1) appended.push(line);
		else lines[index] = line;
	}
	let next = lines.join('\n');
	if (appended.length > 0) {
		if (!next.endsWith('\n')) next += '\n';
		next += `\n# ---- Filled by pnpm secrets:setup-local (values in Infisical's dev project) ----\n${appended.join('\n')}\n`;
	}
	return { text: next, filled, kept };
}

/**
 * The mongosh script that creates or updates both logins, as deploy.sh's ensure_database does, then
 * logs in as the app to prove it. Passed on standard input, so no password reaches a command line.
 * @param {{ database: string, rootUser: string, rootPassword: string, appUser: string, appPassword: string, testPassword: string }} logins
 */
export function mongoLoginScript({ database, rootUser, rootPassword, appUser, appPassword, testPassword }) {
	const json = JSON.stringify;
	return `
function keep(database, user, pwd, roles) {
	const target = db.getSiblingDB(database);
	if (target.getUser(user)) target.updateUser(user, { pwd, roles });
	else target.createUser({ user, pwd, roles });
}
// A connection carries one login, so each is proved on its own. A wrong password is refused even
// before logins are required.
function logsIn(user, pwd, database) {
	try {
		const uri = 'mongodb://' + encodeURIComponent(user) + ':' + encodeURIComponent(pwd) + '@127.0.0.1:27017/' + database + '?directConnection=true';
		return connect(uri).runCommand({ connectionStatus: 1 }).authInfo.authenticatedUsers.length === 1;
	} catch (error) {
		return false;
	}
}
// Where logins are already required (a new Mac whose administrator came from the mounted files),
// creating users needs the administrator. Before that, the login is refused and not needed.
try {
	db.getSiblingDB('admin').auth(${json(rootUser)}, ${json(rootPassword)});
} catch (error) {}
keep('admin', ${json(rootUser)}, ${json(rootPassword)}, [{ role: 'root', db: 'admin' }]);
keep(${json(database)}, ${json(appUser)}, ${json(appPassword)}, [{ role: 'readWrite', db: ${json(database)} }]);
// This Mac only: the test runners' login for their own databases (see test-login.mjs).
keep('admin', ${json(TEST_DATABASE_USER)}, ${json(testPassword)}, ${json(TEST_ROLES)});
const all = logsIn(${json(rootUser)}, ${json(rootPassword)}, 'admin') && logsIn(${json(appUser)}, ${json(appPassword)}, ${json(database)}) && logsIn(${json(TEST_DATABASE_USER)}, ${json(testPassword)}, 'admin');
print(all ? 'logins-ok' : 'logins-failed');
`;
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {(tier: 'local') => ReturnType<typeof generateServiceSecrets>} [options.generate]
 * @param {(script: string) => { status: number | null, stdout: string }} [options.runMongo]
 * @param {() => string} [options.makeTestPassword]
 * @returns {string[]} what to print: names, files and outcomes only
 */
export function setupLocal({
	root,
	generate = generateServiceSecrets,
	runMongo = runInMongoContainer,
	makeTestPassword = () => randomBytes(32).toString('hex'),
}) {
	const envPath = join(root, 'apps/api/.env');
	const before = readIfPresent(envPath);
	if (before === null) throw new SecretsError('apps/api/.env is missing. Create it first (pnpm secrets:pull).');
	const made = generate('local');

	const wanted = new Map([...made.api, ...LOCAL_SETTINGS]);
	const current = parseEnvText(before);
	// Values already handed over for Infisical stay as they are, so a second run never changes one
	// the owner may have copied.
	const handedOver = parseEnvText(readIfPresent(join(root, FOR_INFISICAL)) ?? '');
	for (const [name, value] of handedOver) if (wanted.has(name)) wanted.set(name, value);
	const heldBack = [];
	const mailboxComplete = MAILBOX_GROUP.filter((name) => !wanted.has(name)).every(
		(name) => !isBlank(current.get(name)),
	);
	if (!mailboxComplete) {
		for (const name of MAILBOX_GROUP) {
			if (wanted.has(name) && isBlank(current.get(name))) {
				heldBack.push([name, /** @type {string} */ (wanted.get(name))]);
				wanted.delete(name);
			}
		}
	}
	const result = fillBlanks(before, wanted);
	const after = parseEnvText(result.text);

	// ---- the folder the Mac's services read, laid out like a release folder's secrets/
	const dir = join(root, DEV_SECRETS_DIR);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const createdFiles = [];
	for (const [file, value] of made.infrastructure) {
		const path = join(dir, file);
		if (existsSync(path)) continue;
		writeFileSync(path, value, { mode: 0o600, flag: 'wx' });
		createdFiles.push(file);
	}
	const infrastructure = new Map(
		[...made.infrastructure.keys()].map((file) => [file, /** @type {string} */ (readIfPresent(join(dir, file)))]),
	);
	const testPasswordPath = join(root, TEST_PASSWORD_FILE);
	if (!existsSync(testPasswordPath)) {
		writeFileSync(testPasswordPath, makeTestPassword(), { mode: 0o600, flag: 'wx' });
		createdFiles.push('mongo-test-password');
	}
	const testPassword = /** @type {string} */ (readIfPresent(testPasswordPath)).trim();
	replaceFile(join(dir, 'mongo-app-password'), /** @type {string} */ (after.get('MONGODB_PASSWORD')), 0o600);
	replaceFile(join(dir, 'redis-password'), /** @type {string} */ (after.get('REDIS_PASSWORD')), 0o600);

	// ---- the logins, created before the file that uses them is written
	const database = after.get('MONGODB_DB_NAME') || 'saha_textile_local';
	const outcome = runMongo(
		mongoLoginScript({
			database,
			rootUser: /** @type {string} */ (infrastructure.get('mongo-root-username')),
			rootPassword: /** @type {string} */ (infrastructure.get('mongo-root-password')),
			appUser: /** @type {string} */ (after.get('MONGODB_USERNAME')),
			appPassword: /** @type {string} */ (after.get('MONGODB_PASSWORD')),
			testPassword,
		}),
	);
	if (outcome.status !== 0 || !outcome.stdout.includes('logins-ok')) {
		throw new SecretsError(
			`The database logins could not be created or did not work (is ${MONGO_CONTAINER} running? pnpm mongo:up). apps/api/.env was not changed.`,
		);
	}

	if (result.filled.length > 0) {
		if (!existsSync(join(root, BEFORE_LOCAL_SETUP))) {
			writeFileSync(join(root, BEFORE_LOCAL_SETUP), before, { mode: 0o600, flag: 'wx' });
		}
		replaceFile(envPath, result.text, 0o600);
	}

	// ---- what the dev project still lacks, ready to drag onto its /api folder. Earlier runs' lines stay.
	const forInfisical = [
		...new Map([
			...handedOver,
			...result.filled.map((name) => [name, /** @type {string} */ (after.get(name))]),
			...heldBack,
		]),
	].sort(([a], [b]) => (a < b ? -1 : 1));
	replaceFile(
		join(root, FOR_INFISICAL),
		forInfisical.map(([name, value]) => envLine(name, value, false)).join('\n') + '\n',
		0o600,
	);

	return [
		`apps/api/.env: ${result.filled.length} blank settings filled (${result.filled.join(', ') || 'none'}); ${result.kept.length} already set and left as they were.`,
		...(result.filled.length > 0 ? [`  The file before is kept as ${BEFORE_LOCAL_SETUP}.`] : []),
		...(heldBack.length > 0
			? [
					`  Not in apps/api/.env yet: ${heldBack.map(([name]) => name).join(', ')}. The API needs them together with the three GOOGLE_MAIL_* settings, so they arrive with those at the first pull.`,
				]
			: []),
		`${DEV_SECRETS_DIR}/: ${createdFiles.length > 0 ? `made ${createdFiles.join(', ')}` : 'the four /infrastructure files and the test password were already there and are kept'}; mongo-app-password and redis-password written from apps/api/.env.`,
		`Database logins: ${infrastructure.get('mongo-root-username')} (root, in admin), ${after.get('MONGODB_USERNAME')} (readWrite on ${database}) and ${TEST_DATABASE_USER} (this Mac's test databases) created or updated, and all three log in.`,
		`${FOR_INFISICAL}: ${forInfisical.length} settings for the dev project's /api folder (${forInfisical.map(([name]) => name).join(', ')}).`,
	];
}

/** @param {string} script */
function runInMongoContainer(script) {
	const result = spawnSync('docker', ['exec', '-i', MONGO_CONTAINER, 'mongosh', '--quiet', '--norc'], {
		input: script,
		encoding: 'utf8',
		timeout: 60_000,
	});
	return { status: result.status, stdout: String(result.stdout ?? '') };
}
