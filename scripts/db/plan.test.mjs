import assert from 'node:assert/strict';
import test from 'node:test';

import {
	checkConfirmation,
	checkDatabaseName,
	compareCounts,
	DatabaseCopyError,
	formatCopyReport,
	parseCopyArgs,
	shellQuote,
} from './plan.mjs';

const refused = (fn, pattern) =>
	assert.throws(fn, (error) => error instanceof DatabaseCopyError && pattern.test(error.message));

test('the arguments: two places, SSH only for servers, --apply with --confirm', () => {
	assert.deepEqual(
		parseCopyArgs(['--', '--from', 'local', '--to', 'staging', '--to-ssh', 'saha-textile-admin@10.122.0.5']),
		{
			from: 'local',
			to: 'staging',
			fromSsh: null,
			toSsh: 'saha-textile-admin@10.122.0.5',
			apply: false,
			confirm: null,
		},
	);
	const apply = parseCopyArgs(['--from', 'local', '--to', 'stack', '--apply', '--confirm', 'saha_textile_stack']);
	assert.equal(apply.apply, true);
	assert.equal(apply.confirm, 'saha_textile_stack');
	refused(() => parseCopyArgs(['--from', 'local']), /Usage/);
	refused(() => parseCopyArgs(['--from', 'local', '--to', 'moon']), /Unknown place moon/);
	refused(() => parseCopyArgs(['--from', 'stack', '--to', 'stack']), /same place/);
	refused(
		() => parseCopyArgs(['--from', 'production', '--to', 'staging', '--from-ssh', 'a@b', '--to-ssh', 'a@c']),
		/never leaves production/,
	);
	refused(() => parseCopyArgs(['--from', 'stack', '--to', 'local']), /never overwritten/);
	refused(() => parseCopyArgs(['--from', 'local', '--to', 'staging']), /staging is a server: add --to-ssh/);
	refused(() => parseCopyArgs(['--from', 'local', '--to', 'stack', '--to-ssh', 'a@b']), /--to-ssh is not used/);
	refused(
		() => parseCopyArgs(['--from', 'local', '--to', 'staging', '--to-ssh', 'a@b; rm -rf /']),
		/takes user@host/,
	);
	refused(() => parseCopyArgs(['--from', 'local', '--from', 'stack', '--to', 'staging']), /given twice/);
	refused(() => parseCopyArgs(['--from', 'local', '--to', 'stack', '--drop-everything']), /Usage/);
	refused(() => parseCopyArgs(['--from', '--to', 'stack']), /Usage/);
});

test('a copy needs the destination database typed again; names are checked', () => {
	refused(
		() => checkConfirmation({ apply: true, confirm: null }, 'saha_textile_staging'),
		/--confirm saha_textile_staging/,
	);
	refused(
		() => checkConfirmation({ apply: true, confirm: 'saha_textile_prod' }, 'saha_textile_staging'),
		/--confirm/,
	);
	assert.doesNotThrow(() =>
		checkConfirmation({ apply: true, confirm: 'saha_textile_staging' }, 'saha_textile_staging'),
	);
	assert.doesNotThrow(() => checkConfirmation({ apply: false, confirm: null }, 'saha_textile_staging'));
	assert.equal(checkDatabaseName('saha_textile_staging', 'staging'), 'saha_textile_staging');
	refused(() => checkDatabaseName('', 'staging'), /staging has no usable MONGODB_DB_NAME/);
	refused(() => checkDatabaseName('a"; drop', 'stack'), /stack has no usable/);
});

test('shell quoting keeps a value one word', () => {
	assert.equal(shellQuote('plain'), "'plain'");
	assert.equal(shellQuote("it's"), `'it'\\''s'`);
	assert.equal(shellQuote('$(cat x)'), "'$(cat x)'");
});

test('counts are compared collection by collection; the report says what happened', () => {
	assert.deepEqual(compareCounts({ a: 1, b: 2 }, { a: 1, b: 3, c: 9 }), { same: 1, different: ['b'], extra: ['c'] });
	const plan = formatCopyReport({
		from: 'local',
		to: 'staging',
		fromDatabase: 'saha_textile_local',
		toDatabase: 'saha_textile_staging',
		apply: false,
		source: { products: 1000, orders: 5 },
		destination: {},
	});
	assert.match(
		plan,
		/local \(saha_textile_local\) → staging \(saha_textile_staging\) · plan only; add --apply --confirm saha_textile_staging/,
	);
	assert.match(plan, /Source: 2 collections, 1005 documents/);
	assert.match(plan, /Destination now: 0 collections, 0 documents \(its collections/);
	const done = formatCopyReport({
		from: 'local',
		to: 'stack',
		fromDatabase: 'saha_textile_local',
		toDatabase: 'saha_textile_stack',
		apply: true,
		source: { products: 1000, orders: 5 },
		destination: { products: 3 },
		after: { products: 1000, orders: 4, leftovers: 2 },
		steps: ['Stopped 2 app containers (api, worker) while the copy lands.'],
	});
	assert.match(done, /Stopped 2 app containers/);
	assert.match(done, /Verified: 1\/2 collections hold the same number of documents; different: orders/);
	assert.match(done, /Only in the destination, left as they were: leftovers/);
	assert.doesNotMatch(done, /plan only/);
});
