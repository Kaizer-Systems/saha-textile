import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { generateServiceSecrets } from './generate.mjs';
import { ROOT, loadInventory } from './inventory.mjs';
import { SERVER_DATABASES, formatServerPlan, planServerSecrets, serverSettings } from './server-secrets.mjs';
import { checkChanges } from './write.mjs';

// Every made-up value carries this marker, so a test can prove no value reaches the report.
const MARK = 'zz-made-up-';
const inventory = loadInventory();
let counter = 0;
const random = (size) => Buffer.from(`${MARK}${++counter}`.padEnd(size, 'x').slice(0, size));
const generate = (tier) => generateServiceSecrets(tier, random);
const empty = () => ({ api: new Map(), infrastructure: new Map(), backup: new Map() });

test('a blank server project gets its own secrets and the server settings, and the rest is named as yours', () => {
	const { changes, report } = planServerSecrets({
		tier: 'staging',
		folders: empty(),
		local: empty(),
		inventory,
		generate,
	});
	assert.deepEqual(checkChanges(changes, inventory), []);
	assert.ok(changes.every((change) => change.tier === 'staging' && change.value !== ''));
	assert.deepEqual(report.make, [
		'/infrastructure/meilisearch.toml',
		'/infrastructure/mongo-keyfile',
		'/infrastructure/mongo-root-password',
		'CSRF_SECRET',
		'JWT_ACCESS_SECRET',
		'JWT_REFRESH_SECRET',
		'MAILBOX_TOKEN_KEY',
		'MONGODB_PASSWORD',
		'REDIS_PASSWORD',
	]);
	assert.ok(report.set.includes('DEPLOY_ENV') && report.set.includes('MONGODB_USERNAME'));
	assert.ok(report.set.includes('/infrastructure/mongo-root-username'));
	const value = (name) => changes.find((change) => change.name === name)?.value;
	assert.equal(value('DEPLOY_ENV'), 'staging');
	assert.equal(value('MONGODB_DB_NAME'), 'saha_textile_staging');
	assert.match(value('meilisearch.toml') ?? '', /^env = "production"$/m);
	assert.deepEqual(report.yours, [
		'CORS_ALLOWED_ORIGINS',
		'MSG91_AUTH_KEY',
		'SPACES_BUCKET',
		'SPACES_CDN_URL',
		'SPACES_KEY',
		'SPACES_SECRET',
	]);
	assert.deepEqual(report.backup, []);
	const text = formatServerPlan(report, { project: 'saha-textile-staging (staging)', written: false });
	assert.ok(!text.includes(MARK));
	assert.match(text, /Nothing written\. Run again with --write/);
});

test('values copied from this computer are found, and replaced only when asked', () => {
	const local = empty();
	const made = generate('local');
	for (const [name, value] of made.api) local.api.set(name, value);
	for (const [name, value] of made.infrastructure) local.infrastructure.set(name, value);
	// The development project as copied on 21 Nov: the same secrets, the search config in production mode.
	const copied = {
		api: new Map(local.api),
		infrastructure: new Map(local.infrastructure),
		backup: new Map(),
	};
	copied.infrastructure.set(
		'meilisearch.toml',
		(local.infrastructure.get('meilisearch.toml') ?? '').replace('env = "development"', 'env = "production"'),
	);
	const kept = planServerSecrets({ tier: 'development', folders: copied, local, inventory, generate });
	assert.equal(kept.report.make.length, 0);
	assert.equal(kept.report.replace.length, 0);
	assert.ok(kept.report.shared.includes('/infrastructure/meilisearch.toml'));
	assert.ok(kept.report.shared.includes('MAILBOX_TOKEN_KEY') && kept.report.shared.includes('MONGODB_PASSWORD'));
	assert.ok(kept.changes.every((change) => !kept.report.shared.includes(change.name)));
	assert.match(formatServerPlan(kept.report, { project: 'p', written: false }), /--replace-shared/);

	const replaced = planServerSecrets({
		tier: 'development',
		folders: copied,
		local,
		inventory,
		replaceShared: true,
		generate,
	});
	assert.deepEqual(replaced.report.replace, kept.report.shared);
	for (const name of ['MONGODB_PASSWORD', 'mongo-keyfile', 'meilisearch.toml']) {
		const change = replaced.changes.find((candidate) => candidate.name === name);
		assert.ok(change, name);
		const folder = name === 'MONGODB_PASSWORD' ? 'api' : 'infrastructure';
		assert.notEqual(change.value, local[folder].get(name), name);
	}
	// The fixed login names are the same everywhere on purpose: never "shared", never replaced.
	assert.ok(!replaced.changes.some((change) => change.name === 'MONGODB_USERNAME'));
	assert.equal(replaced.changes.find((c) => c.name === 'MONGODB_DB_NAME')?.value, SERVER_DATABASES.development);
});

test('a project with its own values is left alone; a setting that is not the server shape is only reported', () => {
	const folders = empty();
	for (const [name, value] of generate('production').api) folders.api.set(name, `${value}-own`);
	for (const [name, value] of generate('production').infrastructure) folders.infrastructure.set(name, `${value}-own`);
	folders.api.set('MONGODB_USERNAME', 'saha_textile_app');
	folders.infrastructure.set('mongo-root-username', 'saha_textile_root');
	for (const [name, value] of serverSettings('production')) folders.api.set(name, value);
	folders.api.set('MONGODB_DB_NAME', `${MARK}other`);
	const { changes, report } = planServerSecrets({ tier: 'production', folders, local: empty(), inventory, generate });
	assert.deepEqual(changes, []);
	assert.equal(report.kept.length, 9);
	assert.deepEqual(report.differs, ['MONGODB_DB_NAME (expected saha_textile_prod)']);
	assert.deepEqual(report.backup, [...inventory.backup].sort());
	assert.ok(!formatServerPlan(report, { project: 'p', written: false }).includes(MARK));
});

test('this computer is never a server: secrets:generate refuses it and the old key', () => {
	for (const tier of ['local', 'dev', 'qa']) {
		assert.throws(
			() => planServerSecrets({ tier, folders: empty(), local: empty(), inventory, generate }),
			/secrets:generate is for development, staging, production/,
		);
	}
});

test('the server settings are the ones the production proof deploys', () => {
	const proof = readFileSync(join(ROOT, 'scripts/production-proof.sh'), 'utf8');
	const block = /cat >"\$secrets\/api\.env" <<VARS\n([\s\S]*?)\nVARS/.exec(proof)?.[1] ?? '';
	const proofValues = new Map(
		block.split('\n').map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1)]),
	);
	for (const [name, value] of serverSettings('staging')) {
		if (name === 'MONGODB_DB_NAME') continue;
		assert.equal(proofValues.get(name), value, name);
	}
	assert.equal(proofValues.get('MONGODB_USERNAME'), generate('staging').api.get('MONGODB_USERNAME'));
});
