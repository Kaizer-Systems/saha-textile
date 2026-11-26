import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT, SecretsError, loadInventory } from './inventory.mjs';
import {
	buildDevEnv,
	buildRelease,
	envLine,
	formatReport,
	isBlank,
	isPlain,
	planEnvFileChange,
	projectReport,
	renderEnvFile,
	writeFiles,
} from './render.mjs';

// The API's own dotenv, so these tests prove what the API will actually read.
const dotenv = createRequire(join(ROOT, 'apps/api/package.json'))('dotenv');

// Every made-up value carries this marker, so a test can prove no value reaches a message.
const MARK = 'zz-made-up-';
const inventory = loadInventory();

/** A complete, valid project filled with made-up values. */
function completeProject(tier = 'staging') {
	const api = new Map();
	for (const name of inventory.api) api.set(name, `${MARK}${name.toLowerCase()}`);
	for (const name of inventory.developmentOnly) api.set(name, tier === 'local' ? `${MARK}dev` : '');
	for (const name of inventory.composeProvided) api.set(name, '');
	api.set('MONGODB_URI', '');
	api.set('MEILISEARCH_API_KEY', '');
	api.set('DEPLOY_ENV', tier);
	const backup = new Map(inventory.backup.map((name) => [name, `${MARK}${name.toLowerCase()}`]));
	const infrastructure = new Map([
		['meilisearch.toml', `master_key = "${MARK}master"\nenv = "production"\nno_analytics = true\n`],
		['mongo-keyfile', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY'],
		['mongo-root-password', `${MARK}root-password`],
		['mongo-root-username', 'saha_textile_root'],
	]);
	const deployment = new Map(inventory.deployment.map((name) => [name, `${MARK}${name.toLowerCase()}`]));
	return { api, backup, infrastructure, deployment };
}

const release = new Map([
	['API_IMAGE', 'localhost:5055/saha-textile-api@sha256:aaaa'],
	['DEPLOY_ENV', 'staging'],
	['EDGE_PORT', '443'],
]);

/** Runs `fn`, expects a SecretsError, checks it carries no value, and returns its message. */
function refusal(fn) {
	let message = '';
	assert.throws(fn, (error) => {
		assert.ok(error instanceof SecretsError, 'expected a SecretsError');
		message = error.message;
		return true;
	});
	assert.ok(!message.includes(MARK), `a value leaked into: ${message}`);
	return message;
}

test('isBlank and isPlain', () => {
	assert.equal(isBlank(undefined), true);
	assert.equal(isBlank('  '), true);
	assert.equal(isBlank('x'), false);
	assert.equal(isPlain('abc-1.2_3:/@+=%'), true);
	for (const value of ['a b', "a'b", 'a"b', 'a`b', 'a#b', 'a\\b', 'a$b', 'a\nb']) assert.equal(isPlain(value), false);
});

test('envLine: every value it accepts reads back exactly through dotenv', () => {
	const alphabet = 'ab \t\'"`#$\\\n=x৳';
	let accepted = 0;
	for (let i = 0; i < 20000; i += 1) {
		let value = '';
		const length = 1 + Math.floor(Math.random() * 9);
		for (let j = 0; j < length; j += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
		let line;
		try {
			line = envLine('K', value, false);
		} catch (error) {
			assert.ok(error instanceof SecretsError);
			continue;
		}
		accepted += 1;
		const parsed = dotenv.parse(`A=1\n${line}\nB=2\n`);
		assert.deepEqual(
			[parsed.A, parsed.K, parsed.B],
			['1', value, '2'],
			`round trip failed for ${JSON.stringify(value)}`,
		);
	}
	assert.ok(accepted > 15000, 'too many values refused');
});

test('envLine: known shapes', () => {
	assert.equal(envLine('K', 'plain', false), 'K=plain');
	assert.equal(envLine('K', 'a#b', false), "K='a#b'");
	assert.equal(envLine('K', "it's", false), "K=`it's`");
	assert.equal(envLine('K', "'`", false), 'K="\'`"');
	const pem = '-----BEGIN KEY-----\nAAA\n-----END KEY-----\n';
	assert.equal(dotenv.parse(envLine('K', pem, false)).K, pem);
	assert.match(
		refusal(() => envLine('K', `${MARK} x`, true)),
		/K contains a space/,
	);
	assert.match(
		refusal(() => envLine('K', `${MARK}\r`, false)),
		/carriage return/,
	);
	assert.match(
		refusal(() => envLine('K', `${MARK}'\`"`, false)),
		/every kind of quote/,
	);
});

test('renderEnvFile writes a header and one line per entry', () => {
	assert.equal(renderEnvFile([['A', '1']], { header: ['one'] }), '# one\nA=1\n');
	assert.equal(renderEnvFile([]), '\n');
	assert.throws(() => renderEnvFile([['A', 'a b']], { plainNames: new Set(['A']) }), SecretsError);
});

test('buildDevEnv: blanks left out, overrides on top, sorted, shell-read names unquoted', () => {
	const api = new Map([
		['PORT', '4000'],
		['LOG_LEVEL', ''],
		['JWT_ACCESS_SECRET', `${MARK}a b`],
		['MONGODB_DB_NAME', 'saha_textile_local'],
	]);
	const overrides = new Map([
		['PORT', '4100'],
		['MONGODB_DB_NAME', ''],
		['MY_OWN_SETTING', 'yes'],
	]);
	const { text, names, notes } = buildDevEnv(api, { inventory, source: 'saha-textile-dev (dev)', overrides });
	assert.deepEqual(names, ['JWT_ACCESS_SECRET', 'MY_OWN_SETTING', 'PORT']);
	assert.deepEqual(notes, []);
	assert.deepEqual(dotenv.parse(text), { JWT_ACCESS_SECRET: `${MARK}a b`, MY_OWN_SETTING: 'yes', PORT: '4100' });
	assert.match(text, /^# Written by pnpm secrets:pull from Infisical saha-textile-dev \(dev\), folder \/api\./);

	const message = refusal(() =>
		buildDevEnv(new Map([['MONGODB_USERNAME', `${MARK}has space`]]), { inventory, source: 'dev' }),
	);
	assert.match(message, /MONGODB_USERNAME contains a space/);
});

test('buildDevEnv: unknown names are refused when filled and noted when blank', () => {
	const message = refusal(() =>
		buildDevEnv(new Map([['JWT_ACESS_SECRET', `${MARK}x`]]), { inventory, source: 'dev' }),
	);
	assert.match(message, /\/api\/JWT_ACESS_SECRET is not in the inventory/);
	const { notes } = buildDevEnv(new Map([['OLD_NAME', '']]), { inventory, source: 'dev' });
	assert.deepEqual(notes, ['/api/OLD_NAME is blank and not in the inventory: it can be deleted.']);
});

test('buildRelease: a complete project gives every file deploy.sh checks', () => {
	const project = completeProject();
	const { files, notes } = buildRelease(project, {
		tier: 'staging',
		inventory,
		source: 'saha-textile-staging (staging)',
		release,
	});
	assert.deepEqual([...files.keys()].sort(), [
		'release.env',
		'secrets/api.env',
		'secrets/backup.env',
		'secrets/do-dns-token',
		'secrets/meilisearch.toml',
		'secrets/mongo-app-password',
		'secrets/mongo-keyfile',
		'secrets/mongo-monitor-password',
		'secrets/mongo-root-password',
		'secrets/mongo-root-username',
		'secrets/redis-password',
	]);
	assert.deepEqual(notes, []);
	const apiEnv = dotenv.parse(files.get('secrets/api.env'));
	for (const name of inventory.requiredForRelease) assert.ok(apiEnv[name], `${name} missing from api.env`);
	for (const name of [
		...inventory.developmentOnly,
		...inventory.composeProvided,
		'MEILISEARCH_API_KEY',
		'MONGODB_URI',
	]) {
		assert.equal(apiEnv[name], undefined, `${name} must not reach a release`);
	}
	// Owner decision L3: each password is kept once, in /api.
	assert.equal(files.get('secrets/mongo-app-password'), project.api.get('MONGODB_PASSWORD'));
	assert.equal(files.get('secrets/redis-password'), project.api.get('REDIS_PASSWORD'));
	assert.equal(files.get('secrets/meilisearch.toml'), project.infrastructure.get('meilisearch.toml'));
	const releaseEnv = dotenv.parse(files.get('release.env'));
	assert.equal(releaseEnv.API_IMAGE, release.get('API_IMAGE'));
	assert.equal(releaseEnv.STOREFRONT_HOST, project.deployment.get('STOREFRONT_HOST'));
	// Owner decision D2: the public sign-in IDs are kept once, in /api, and copied into the release.
	assert.equal(releaseEnv.GOOGLE_CLIENT_ID, project.api.get('GOOGLE_OAUTH_CLIENT_ID'));
	assert.equal(releaseEnv.FACEBOOK_APP_ID, project.api.get('FACEBOOK_OAUTH_APP_ID'));
	// deploy.sh reads these with sed, so they must be unquoted.
	assert.match(files.get('secrets/api.env'), /^MONGODB_DB_NAME=zz-made-up-mongodb_db_name$/m);
	assert.match(
		files.get('secrets/backup.env'),
		/^# Written from Infisical saha-textile-staging \(staging\), folder \/backup\./,
	);
});

test('buildRelease: notes for settings a release leaves out, with no values in them', () => {
	const project = completeProject();
	project.api.set('OTP_LOCAL_FIXED_CODE', `${MARK}123456`);
	project.api.set('SHOP_ORIGIN', `${MARK}https://shop`);
	project.api.set('MEILISEARCH_API_KEY', `${MARK}key`);
	project.infrastructure.set('mongo-app-password', '');
	project.infrastructure.set('redis-password', project.api.get('REDIS_PASSWORD'));
	project.deployment.set('GOOGLE_CLIENT_ID', project.api.get('GOOGLE_OAUTH_CLIENT_ID'));
	project.deployment.set('FACEBOOK_APP_ID', '');
	const { notes } = buildRelease(project, { tier: 'staging', inventory, source: 's', release });
	assert.deepEqual(notes.sort(), [
		'/deployment/FACEBOOK_APP_ID is no longer used (it is written from /api/FACEBOOK_OAUTH_APP_ID): delete it.',
		'/deployment/GOOGLE_CLIENT_ID repeats /api/GOOGLE_OAUTH_CLIENT_ID: delete it.',
		'/infrastructure/mongo-app-password is no longer used (it is written from /api/MONGODB_PASSWORD): delete it.',
		'/infrastructure/redis-password repeats /api/REDIS_PASSWORD: delete it.',
		'MEILISEARCH_API_KEY is left out: the deploy reads it from the search server.',
		'OTP_LOCAL_FIXED_CODE is for local development only and is left out of the release.',
		'SHOP_ORIGIN is set by Compose in a release, so it is left out of api.env.',
	]);
	for (const note of notes) assert.ok(!note.includes(MARK));
});

test('buildRelease: refuses, naming every problem at once and no value', () => {
	const project = completeProject('production');
	project.api.set('JWT_ACCESS_SECRET', '');
	project.api.set('CSRF_SECRET', '   ');
	project.api.set('MONGODB_URI', `${MARK}mongodb://x`);
	project.api.set('MONGODB_PASSWORD', ` ${MARK}padded `);
	project.api.set('REDIS_PASSWORD', `${MARK}has space`);
	project.api.set('JWT_ACESS_SECRET', `${MARK}typo`);
	project.api.set('MONGODB_USERNAME', `${MARK}a#b`);
	project.backup.set('BACKUP_BUCKET', '');
	project.infrastructure.set('mongo-keyfile', `${MARK}!!`);
	project.infrastructure.set('meilisearch.toml', `env = "production"\n${MARK}`);
	project.infrastructure.set('mongo-root-username', `${MARK} root`);
	project.infrastructure.set('mongo-root-password', '');
	project.infrastructure.set('mongo-app-password', `${MARK}different`);
	project.deployment.set('GOOGLE_CLIENT_ID', `${MARK}other-client`);
	project.deployment.set('CDN_HOST', `${MARK}a b`);
	const conflicting = new Map([...release, ['DEPLOY_ENV', 'staging'], ['STOREFRONT_HOST', 'other.example']]);
	const message = refusal(() =>
		buildRelease(project, { tier: 'production', inventory, source: 'p', release: conflicting }),
	);
	for (const expected of [
		/^The release folder was not written:/,
		/Required for a release but blank in \/api: [^\n]*JWT_ACCESS_SECRET/,
		/Required for a release but blank in \/api: [^\n]*CSRF_SECRET/,
		/MONGODB_URI must stay blank/,
		/MONGODB_PASSWORD may not start or end with a space/,
		/REDIS_PASSWORD may not contain/,
		/\/api\/JWT_ACESS_SECRET is not in the inventory/,
		/MONGODB_USERNAME contains a space, quote, #/,
		/Required for production backups but blank in \/backup: BACKUP_BUCKET/,
		/mongo-keyfile must be 6 to 1,024 base64 characters/,
		/meilisearch.toml needs a line/,
		/mongo-root-username may not contain/,
		/\/infrastructure\/mongo-root-password is blank/,
		/\/infrastructure\/mongo-app-password differs from \/api\/MONGODB_PASSWORD/,
		/STOREFRONT_HOST is set both in \/deployment and by the release step/,
		/DEPLOY_ENV in \/api differs/,
		/\/deployment\/GOOGLE_CLIENT_ID differs from \/api\/GOOGLE_OAUTH_CLIENT_ID/,
		/CDN_HOST contains a space/,
	]) {
		assert.match(message, expected);
	}
});

test('buildRelease: backups are optional outside production, and overrides reach api.env', () => {
	const project = completeProject('local');
	project.backup = new Map();
	project.deployment = new Map();
	const { files } = buildRelease(project, {
		tier: 'local',
		inventory,
		source: 'd',
		release: new Map([['DEPLOY_ENV', 'local']]),
		apiOverrides: new Map([
			['CORS_ALLOWED_ORIGINS', 'https://local.saha-textile.localhost'],
			['STACK_ONLY', 'yes'],
		]),
	});
	assert.equal(dotenv.parse(files.get('secrets/backup.env')).BACKUP_BUCKET, undefined);
	const apiEnv = dotenv.parse(files.get('secrets/api.env'));
	assert.equal(apiEnv.CORS_ALLOWED_ORIGINS, 'https://local.saha-textile.localhost');
	assert.equal(apiEnv.STACK_ONLY, 'yes');
	assert.equal(apiEnv.OTP_LOCAL_FIXED_CODE, undefined);
});

test('writeFiles: owner-only folders, files a container user can read, never over an existing file', () => {
	const dir = mkdtempSync(join(tmpdir(), 'secrets-render-'));
	try {
		const files = new Map([
			['secrets/api.env', 'A=1\n'],
			['release.env', 'B=2\n'],
		]);
		writeFiles(join(dir, 'r1'), files);
		assert.equal(readFileSync(join(dir, 'r1/secrets/api.env'), 'utf8'), 'A=1\n');
		assert.equal(statSync(join(dir, 'r1/secrets/api.env')).mode & 0o777, 0o644);
		assert.equal(statSync(join(dir, 'r1/secrets')).mode & 0o777, 0o700);
		// The deploy job writes under umask 077; the files must still be readable by the containers.
		const umask = process.umask(0o077);
		try {
			writeFiles(join(dir, 'r2'), files);
		} finally {
			process.umask(umask);
		}
		assert.equal(statSync(join(dir, 'r2/secrets/api.env')).mode & 0o777, 0o644);
		assert.equal(statSync(join(dir, 'r2/secrets')).mode & 0o777, 0o700);
		assert.match(
			refusal(() => writeFiles(join(dir, 'r1'), files)),
			/secrets\/api.env already exists/,
		);
		assert.throws(
			() => writeFiles(join(dir, 'r1/release.env/x'), new Map([['y', '1']])),
			(error) => !(error instanceof SecretsError),
		);
		// A folder that cannot be written to: the system's own error comes through.
		mkdirSync(join(dir, 'locked'), { mode: 0o500 });
		assert.throws(
			() => writeFiles(join(dir, 'locked'), new Map([['y', '1']])),
			(error) => error.code === 'EACCES',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('planEnvFileChange names what a refresh adds, removes and changes', () => {
	const before = new Map([
		['A', '1'],
		['B', '2'],
		['C', '3'],
	]);
	const after = new Map([
		['A', '1'],
		['B', 'x'],
		['D', '4'],
	]);
	assert.deepEqual(planEnvFileChange(before, after), {
		added: ['D'],
		removed: ['C'],
		changed: ['B'],
		same: 1,
		blankDropped: 0,
	});
	assert.deepEqual(planEnvFileChange(null, after), {
		added: ['A', 'B', 'D'],
		removed: [],
		changed: [],
		same: 0,
		blankDropped: 0,
	});
	// A name blank in the file is unset: blank on both sides is only counted, and filling it is an addition.
	const blanks = new Map([
		['A', '1'],
		['E', ''],
		['F', ' '],
	]);
	assert.deepEqual(
		planEnvFileChange(
			blanks,
			new Map([
				['A', '1'],
				['F', 'filled'],
			]),
		),
		{
			added: ['F'],
			removed: [],
			changed: [],
			same: 1,
			blankDropped: 1,
		},
	);
});

test('projectReport and formatReport: a complete project is ready', () => {
	const report = projectReport(completeProject(), { tier: 'staging', inventory });
	const text = formatReport(report, 'saha-textile-staging (staging)');
	assert.match(text, /Ready for a deploy\./);
	assert.ok(!text.includes(MARK));
	// Staging does not expect development-only or Compose-set names.
	assert.deepEqual(report.folders.find((folder) => folder.folder === 'api').missing, []);
});

test('projectReport and formatReport: what is missing, misspelt or due for deletion', () => {
	const project = completeProject('production');
	project.api.delete('SHOP_ORIGIN');
	project.api.set('JWT_ACCESS_SECRET', '');
	project.api.set('MSG91_AUTH_KEY', '');
	project.api.set('JWT_ACESS_SECRET', `${MARK}x`);
	project.backup.set('BACKUP_BUCKET', '');
	project.infrastructure.set('mongo-keyfile', '');
	project.infrastructure.set('redis-password', '');
	project.deployment.set('GOOGLE_CLIENT_ID', `${MARK}client`);
	const report = projectReport(project, { tier: 'production', inventory });
	const text = formatReport(report, 'saha-textile-production (prod)');
	assert.match(text, /not in the inventory \(misspelt\?\): JWT_ACESS_SECRET/);
	assert.match(text, /delete \(now written from \/api, owner decisions L3 and D2\): redis-password/);
	assert.match(text, /delete \(now written from \/api, owner decisions L3 and D2\): GOOGLE_CLIENT_ID/);
	assert.ok(!/misspelt[^\n]*GOOGLE_CLIENT_ID/.test(text));
	assert.match(text, /Blank, but a deploy needs it in \/api: JWT_ACCESS_SECRET, MSG91_AUTH_KEY/);
	assert.match(
		text,
		/a deploy may still go ahead with these blank if it names them \(--allow-blank\): MSG91_AUTH_KEY\n/,
	);
	assert.match(text, /Blank, but a deploy needs it in \/infrastructure: mongo-keyfile/);
	assert.match(text, /Blank, but production backups need it in \/backup: BACKUP_BUCKET/);
	assert.match(text, /Not ready for a deploy yet\./);
	assert.ok(!text.includes(MARK));

	const dev = projectReport({ api: new Map() }, { tier: 'local', inventory });
	const devText = formatReport(dev, 'saha-textile-local (dev)');
	assert.match(devText, /not in Infisical yet: .*OTP_LOCAL_FIXED_CODE.*SHOP_ORIGIN/);
	assert.match(devText, /the local pipeline needs it/);
});

test('buildRelease: certificates in /infrastructure ride along for deploy.sh to install (owner, 21 Nov)', () => {
	const cert = '-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----';
	const key = '-----BEGIN PRIVATE KEY-----\nMIIBexample\n-----END PRIVATE KEY-----\n';
	const project = completeProject();
	project.infrastructure.set('origin.pem', cert);
	project.infrastructure.set('origin.key', key);
	const { files } = buildRelease(project, { tier: 'staging', inventory, source: 's', release });
	assert.equal(files.get('secrets/origin.pem'), `${cert}\n`);
	assert.equal(files.get('secrets/origin.key'), key);
	assert.equal(files.has('secrets/origin-ca.pem'), false);

	const half = completeProject();
	half.infrastructure.set('origin.pem', cert);
	assert.match(
		refusal(() => buildRelease(half, { tier: 'staging', inventory, source: 's', release })),
		/origin\.pem and origin\.key go together/,
	);
	const wrong = completeProject();
	wrong.infrastructure.set('origin-ca.pem', 'not a certificate');
	assert.match(
		refusal(() => buildRelease(wrong, { tier: 'staging', inventory, source: 's', release })),
		/origin-ca\.pem is not a PEM certificate/,
	);
});
