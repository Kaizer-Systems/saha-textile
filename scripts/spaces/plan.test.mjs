import assert from 'node:assert/strict';
import test from 'node:test';

import {
	addressOf,
	checkConfirmation,
	corsAllows,
	fileAction,
	formatCopyReport,
	holderOf,
	md5OfEtag,
	parseCopyArgs,
	sameMetadata,
	SpacesCopyError,
	visibilityOf,
} from './plan.mjs';

const refused = (fn, pattern) =>
	assert.throws(fn, (error) => error instanceof SpacesCopyError && pattern.test(error.message));

test('the arguments: two bucket names, --apply, --confirm, repeated --origin', () => {
	assert.deepEqual(
		parseCopyArgs([
			'--',
			'--from',
			'saha-textile-media',
			'--to',
			'saha-textile-media-staging',
			'--apply',
			'--origin',
			'https://admin-staging.sahatextile.com',
			'--origin',
			'https://staging.sahatextile.com',
		]),
		{
			from: 'saha-textile-media',
			to: 'saha-textile-media-staging',
			apply: true,
			confirm: null,
			origins: ['https://admin-staging.sahatextile.com', 'https://staging.sahatextile.com'],
		},
	);
	assert.equal(parseCopyArgs(['--from', 'aaa', '--to', 'bbb', '--confirm', 'bbb']).confirm, 'bbb');
	refused(() => parseCopyArgs(['--from', 'aaa']), /Usage/);
	refused(() => parseCopyArgs(['--from', 'aaa', '--to', 'aaa']), /same bucket/);
	refused(() => parseCopyArgs(['--from', 'aaa', '--from', 'ccc', '--to', 'bbb']), /given twice/);
	refused(() => parseCopyArgs(['--from', 'Bad_Name', '--to', 'bbb']), /not a bucket name/);
	refused(() => parseCopyArgs(['--from', 'aaa', '--to', 'bbb', '--origin', 'http://x.test/path']), /--origin takes/);
	refused(() => parseCopyArgs(['--from', 'aaa', '--to', 'bbb', '--delete']), /Usage/);
	refused(() => parseCopyArgs(['--from', '--to', 'bbb']), /Usage/);
});

test('a bucket is reached through the first project that names it, and needs its key there', () => {
	const api = (bucket, filled = true) =>
		new Map([
			['SPACES_BUCKET', bucket],
			['SPACES_KEY', filled ? 'zz-made-up-key' : ''],
			['SPACES_SECRET', 'zz-made-up-secret'],
			['SPACES_REGION', 'sgp1'],
			['SPACES_ENDPOINT', 'https://sgp1.digitaloceanspaces.com'],
		]);
	const projects = [
		{ tier: 'local', api: api('media') },
		{ tier: 'development', api: api('media') },
		{ tier: 'staging', api: api('media-staging', false) },
	];
	assert.deepEqual(holderOf('media', projects), { tier: 'local', alsoIn: ['development'] });
	refused(() => holderOf('media-production', projects), /No Infisical project has SPACES_BUCKET = media-production/);
	refused(() => holderOf('media-staging', projects), /staging \/api\/SPACES_KEY is blank/);
});

test("production's bucket is written only with its name typed again", () => {
	const args = { apply: true, to: 'media-production', confirm: null };
	refused(() => checkConfirmation(args, 'production'), /--confirm media-production/);
	assert.doesNotThrow(() => checkConfirmation({ ...args, confirm: 'media-production' }, 'production'));
	assert.doesNotThrow(() => checkConfirmation({ ...args, apply: false }, 'production'));
	assert.doesNotThrow(() => checkConfirmation(args, 'staging'));
});

test('each file is copied, has only its public/private setting fixed, or is left alone', () => {
	const file = {
		size: 10,
		md5: 'a'.repeat(32),
		headers: { ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' },
		metadata: { sha256: 'x' },
		visibility: /** @type {const} */ ('public-read'),
	};
	assert.equal(fileAction(file, null), 'copy');
	assert.equal(fileAction(file, { ...file }), 'same');
	assert.equal(fileAction(file, { ...file, size: 11 }), 'copy');
	assert.equal(fileAction(file, { ...file, md5: 'b'.repeat(32) }), 'copy');
	assert.equal(fileAction({ ...file, md5: null }, { ...file }), 'copy');
	assert.equal(fileAction(file, { ...file, headers: { ...file.headers, CacheControl: 'no-cache' } }), 'copy');
	assert.equal(fileAction(file, { ...file, metadata: {} }), 'copy');
	assert.equal(fileAction(file, { ...file, visibility: 'private' }), 'set-visibility');
	assert.equal(sameMetadata(undefined, {}), true);
	assert.equal(sameMetadata({ a: '' }, {}), true);
});

test('content hashes, public/private answers, addresses and upload rules', () => {
	assert.equal(md5OfEtag(`"${'c'.repeat(32)}"`), 'c'.repeat(32));
	assert.equal(md5OfEtag('"abc-3"'), null);
	assert.equal(md5OfEtag(undefined), null);
	assert.equal(visibilityOf(200, 'k'), 'public-read');
	assert.equal(visibilityOf(403, 'k'), 'private');
	refused(() => visibilityOf(404, 'media/x'), /media\/x answered 404/);
	assert.equal(addressOf('https://b.test', 'media/a b/#1.webp'), 'https://b.test/media/a%20b/%231.webp');
	assert.equal(corsAllows(200, 'https://a.test', 'https://a.test'), true);
	assert.equal(corsAllows(200, '*', 'https://a.test'), true);
	assert.equal(corsAllows(403, null, 'https://a.test'), false);
	assert.equal(corsAllows(200, 'https://b.test', 'https://a.test'), false);
});

test('the report holds names and counts, and says what to fix', () => {
	const text = formatCopyReport({
		from: 'media',
		to: 'media-staging',
		fromTier: 'local',
		toTier: 'staging',
		apply: true,
		files: 3,
		bytes: 3 * 1024 * 1024,
		publicFiles: 1,
		privateFiles: 2,
		actions: { copy: 2, 'set-visibility': 1, same: 0 },
		extra: 4,
		failed: [],
		verify: { identical: 3, problems: [] },
		checks: {
			listingRefused: false,
			cdn: true,
			cors: [
				{ origin: 'https://a.test', allowed: true },
				{ origin: 'https://b.test', allowed: false },
			],
		},
	});
	assert.match(text, /media \(local\) → media-staging \(staging\)/);
	assert.match(text, /3 files, 3\.00 MiB, 1 public, 2 private/);
	assert.match(text, /Copied: 2 · public\/private set: 1 · already the same: 0/);
	assert.match(text, /left as they are\): 4/);
	assert.match(text, /Verified: 3\/3 identical/);
	assert.match(text, /listing refused to the public: NO/);
	assert.match(text, /from https:\/\/b\.test: NOT allowed/);
	const plan = formatCopyReport({
		from: 'a',
		to: 'b',
		fromTier: 'local',
		toTier: 'staging',
		apply: false,
		files: 0,
		bytes: 0,
		publicFiles: 0,
		privateFiles: 0,
		actions: { copy: 0, 'set-visibility': 0, same: 0 },
		extra: 0,
		failed: ['x: AccessDenied'],
		verify: { identical: 0, problems: ['k (copy)'] },
		checks: { listingRefused: true, cdn: null, cors: [] },
	});
	assert.match(plan, /plan only; add --apply/);
	assert.match(plan, /Failed \(1\): x: AccessDenied/);
	assert.match(plan, /problems: k \(copy\)/);
	assert.match(plan, /no public file to try/);
	const noCdn = formatCopyReport({
		from: 'a',
		to: 'b',
		fromTier: 'local',
		toTier: 'staging',
		apply: false,
		files: 0,
		bytes: 0,
		publicFiles: 0,
		privateFiles: 0,
		actions: { copy: 0, 'set-visibility': 0, same: 0 },
		extra: 0,
		failed: [],
		verify: null,
		checks: { listingRefused: true, cdn: false, cors: [] },
	});
	assert.match(noCdn, /CDN serves a public file: NO/);
});
