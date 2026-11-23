import assert from 'node:assert/strict';
import test from 'node:test';

import { SecretsError } from './inventory.mjs';
import { DATA_SERVICE_IDS, formatRotation, parseRotateArgs, planRotation, ROTATION_IDS } from './rotate.mjs';

const MARK = 'zz-made-up';

/** Fixed "new" values, so a test can tell new from old without real randomness. */
const generate = (tier) => ({
	api: new Map([
		['MONGODB_PASSWORD', `${MARK}-new-app`],
		['REDIS_PASSWORD', `${MARK}-new-redis`],
		['JWT_ACCESS_SECRET', `${MARK}-new-access`],
		['JWT_REFRESH_SECRET', `${MARK}-new-refresh`],
		['CSRF_SECRET', `${MARK}-new-csrf`],
		['MAILBOX_TOKEN_KEY', `${MARK}-new-mailbox`],
	]),
	infrastructure: new Map([
		['mongo-keyfile', `${MARK}-new-keyfile`],
		['mongo-root-password', `${MARK}-new-root`],
		['meilisearch.toml', `master_key = "${MARK}-new-master"\nenv = "${tier}"\n`],
	]),
});

const folders = (extra = {}) => ({
	api: new Map([
		['MONGODB_PASSWORD', `${MARK}-old-app`],
		['REDIS_PASSWORD', `${MARK}-old-redis`],
		['JWT_ACCESS_SECRET', `${MARK}-old-access`],
		['JWT_REFRESH_SECRET', `${MARK}-old-refresh`],
		['CSRF_SECRET', `${MARK}-old-csrf`],
		['MAILBOX_TOKEN_KEY', ''],
		...Object.entries(extra),
	]),
	infrastructure: new Map([
		['mongo-keyfile', `${MARK}-old-keyfile`],
		['mongo-root-password', `${MARK}-old-root`],
		['meilisearch.toml', `master_key = "${MARK}-old-master"\n`],
	]),
});

test('the arguments: a server tier, known ids once, the three switches', () => {
	assert.deepEqual(parseRotateArgs(['--', 'staging', '--names', 'redis,sign-in', '--no-grace', '--json']), {
		tier: 'staging',
		ids: ['redis', 'sign-in'],
		grace: false,
		clearPrevious: false,
		json: true,
	});
	assert.deepEqual(parseRotateArgs(['production', '--clear-previous']).clearPrevious, true);
	for (const [args, pattern] of [
		[['local', '--names', 'redis'], /is for development, staging, production/],
		[['staging', '--names', 'redis,dragons'], /Unknown id dragons/],
		[['staging', '--names', 'redis,redis'], /given twice/],
		[['staging'], /Nothing to rotate/],
		[['staging', '--names'], /Usage/],
		[['staging', 'production', '--names', 'redis'], /Usage/],
		[['staging', '--force'], /Usage/],
	]) {
		assert.throws(
			() => parseRotateArgs(args),
			(error) => error instanceof SecretsError && pattern.test(error.message),
		);
	}
	assert.deepEqual([...DATA_SERVICE_IDS].sort(), ['keyfile', 'mongo-app', 'mongo-root', 'redis', 'search']);
	assert.equal(Object.keys(ROTATION_IDS).length, 8);
});

test('a planned change keeps the old sign-in and CSRF keys under _PREVIOUS; data-service ids need a rotate deploy', () => {
	const { changes, report } = planRotation({
		tier: 'staging',
		ids: ['sign-in', 'csrf', 'redis'],
		grace: true,
		clearPrevious: false,
		folders: folders(),
		generate,
	});
	const set = new Map(changes.map((change) => [`${change.folder}/${change.name}`, change.value]));
	assert.equal(set.get('api/JWT_ACCESS_SECRET_PREVIOUS'), `${MARK}-old-access`);
	assert.equal(set.get('api/JWT_ACCESS_SECRET'), `${MARK}-new-access`);
	assert.equal(set.get('api/JWT_REFRESH_SECRET_PREVIOUS'), `${MARK}-old-refresh`);
	assert.equal(set.get('api/CSRF_SECRET_PREVIOUS'), `${MARK}-old-csrf`);
	assert.equal(set.get('api/REDIS_PASSWORD'), `${MARK}-new-redis`);
	assert.ok(!set.has('api/REDIS_PASSWORD_PREVIOUS'), 'data-service passwords keep no previous value');
	assert.deepEqual(report.movedToPrevious, [
		'JWT_ACCESS_SECRET_PREVIOUS',
		'JWT_REFRESH_SECRET_PREVIOUS',
		'CSRF_SECRET_PREVIOUS',
	]);
	assert.equal(report.needsRotateDeploy, true);
	const text = formatRotation(report, 'saha-textile-staging (staging)');
	assert.ok(!text.includes(MARK), 'the report holds names only');
	assert.match(text, /Deploy with rotation/);
});

test('after a leak (no grace) a kept key is cleared; --clear-previous clears the rest; nothing for a blank key', () => {
	const kept = { CSRF_SECRET_PREVIOUS: `${MARK}-older-csrf`, JWT_ACCESS_SECRET_PREVIOUS: `${MARK}-older-access` };
	const leak = planRotation({
		tier: 'production',
		ids: ['csrf'],
		grace: false,
		clearPrevious: false,
		folders: folders(kept),
		generate,
	});
	assert.deepEqual(
		leak.changes.map((change) => [change.name, change.value]),
		[
			['CSRF_SECRET_PREVIOUS', ''],
			['CSRF_SECRET', `${MARK}-new-csrf`],
		],
	);
	assert.equal(leak.report.needsRotateDeploy, false);
	const clear = planRotation({
		tier: 'production',
		ids: [],
		grace: true,
		clearPrevious: true,
		folders: folders(kept),
		generate,
	});
	assert.deepEqual(clear.report.clearedPrevious, ['JWT_ACCESS_SECRET_PREVIOUS', 'CSRF_SECRET_PREVIOUS']);
	assert.ok(clear.changes.every((change) => change.value === ''));
	assert.throws(
		() =>
			planRotation({
				tier: 'staging',
				ids: ['mailbox'],
				grace: true,
				clearPrevious: false,
				folders: folders(),
				generate,
			}),
		/Blank in this project, so nothing to rotate: MAILBOX_TOKEN_KEY/,
	);
	const search = planRotation({
		tier: 'staging',
		ids: ['search', 'keyfile'],
		grace: true,
		clearPrevious: false,
		folders: folders(),
		generate,
	});
	assert.deepEqual(search.report.changed, ['meilisearch.toml', 'mongo-keyfile']);
	assert.equal(search.changes.find((change) => change.name === 'meilisearch.toml')?.folder, 'infrastructure');
});
