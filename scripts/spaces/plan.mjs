/**
 * The decisions behind `pnpm spaces:copy` (scripts/spaces/copy-bucket.mjs), kept free of network calls so they
 * can be tested. The owner's rule (2026-11-23): a bucket copied into another must work with the apps as it is,
 * with every file's content, headers and public/private setting the same, and nothing in the destination deleted.
 */

export const USAGE =
	'Usage: pnpm spaces:copy -- --from <bucket> --to <bucket> [--apply] [--confirm <destination bucket>] [--origin <https address>]…';

/** Public web addresses each environment's pages upload from (production-deployment-plan.mdx, hostnames). */
export const DEFAULT_ORIGINS = /** @type {const} */ ({
	local: ['https://localhost:4200', 'https://localhost:4300'],
	development: ['https://localhost:4200', 'https://localhost:4300'],
	staging: ['https://staging.sahatextile.com', 'https://admin-staging.sahatextile.com'],
	production: ['https://sahatextile.com', 'https://admin.sahatextile.com'],
});

/** Headers a copy keeps, read from the source file. */
export const KEPT_HEADERS = /** @type {const} */ ([
	'ContentType',
	'CacheControl',
	'ContentDisposition',
	'ContentEncoding',
	'ContentLanguage',
]);

export class SpacesCopyError extends Error {}

const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * @param {string[]} args
 * @returns {{ from: string, to: string, apply: boolean, confirm: string | null, origins: string[] }}
 */
export function parseCopyArgs(args) {
	const words = args.filter((arg) => arg !== '--');
	/** @type {Record<string, string | undefined>} */
	const named = {};
	const origins = [];
	let apply = false;
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word === '--apply') {
			apply = true;
			continue;
		}
		if (!['--from', '--to', '--confirm', '--origin'].includes(word)) throw new SpacesCopyError(USAGE);
		const value = words[index + 1];
		if (value === undefined || value.startsWith('--')) throw new SpacesCopyError(USAGE);
		index += 1;
		if (word === '--origin') {
			if (!/^https:\/\/[^/]+$/.test(value))
				throw new SpacesCopyError(`--origin takes an address like https://admin.example.com, not ${value}.`);
			origins.push(value);
		} else {
			if (named[word] !== undefined) throw new SpacesCopyError(`${word} is given twice.`);
			named[word] = value;
		}
	}
	const from = named['--from'];
	const to = named['--to'];
	if (!from || !to) throw new SpacesCopyError(USAGE);
	for (const name of [from, to]) if (!BUCKET.test(name)) throw new SpacesCopyError(`${name} is not a bucket name.`);
	if (from === to) throw new SpacesCopyError('--from and --to name the same bucket.');
	return { from, to, apply, confirm: named['--confirm'] ?? null, origins };
}

/**
 * Which Infisical project holds a bucket's key: the first, in the inventory's tier order, whose `/api/SPACES_BUCKET`
 * names it. Several may (the development project starts as a copy of this computer's).
 * @param {string} bucket
 * @param {{ tier: string, api: Map<string, string> }[]} projects   in tier order
 */
export function holderOf(bucket, projects) {
	const holders = projects.filter((project) => project.api.get('SPACES_BUCKET') === bucket);
	if (holders.length === 0) {
		throw new SpacesCopyError(
			`No Infisical project has SPACES_BUCKET = ${bucket}. Put the bucket's name and key in its project's /api first.`,
		);
	}
	const holder = holders[0];
	for (const name of ['SPACES_KEY', 'SPACES_SECRET', 'SPACES_REGION', 'SPACES_ENDPOINT']) {
		if (!holder.api.get(name))
			throw new SpacesCopyError(`${holder.tier} /api/${name} is blank, so ${bucket} cannot be reached.`);
	}
	return { tier: holder.tier, alsoIn: holders.slice(1).map((project) => project.tier) };
}

/**
 * Writing into a production bucket needs its name typed again (`--confirm`).
 * @param {{ apply: boolean, to: string, confirm: string | null }} args
 * @param {string} destinationTier
 */
export function checkConfirmation(args, destinationTier) {
	if (!args.apply || destinationTier !== 'production') return;
	if (args.confirm !== args.to) {
		throw new SpacesCopyError(`${args.to} is production's bucket. Add --confirm ${args.to} to write into it.`);
	}
}

/**
 * What to do with one file.
 * @param {{ size: number, md5: string | null, headers: Record<string, string | undefined>, metadata: Record<string, string>, visibility: 'public-read' | 'private' }} source
 * @param {{ size: number, md5: string | null, headers: Record<string, string | undefined>, metadata: Record<string, string>, visibility: 'public-read' | 'private' } | null} destination
 * @returns {'copy' | 'set-visibility' | 'same'}
 */
export function fileAction(source, destination) {
	if (!destination || destination.size !== source.size) return 'copy';
	if (source.md5 === null || destination.md5 === null || source.md5 !== destination.md5) return 'copy';
	for (const name of KEPT_HEADERS)
		if ((source.headers[name] ?? '') !== (destination.headers[name] ?? '')) return 'copy';
	if (!sameMetadata(source.metadata, destination.metadata)) return 'copy';
	return source.visibility === destination.visibility ? 'same' : 'set-visibility';
}

/** @param {Record<string, string> | undefined} a @param {Record<string, string> | undefined} b */
export function sameMetadata(a = {}, b = {}) {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) if ((a[key] ?? '') !== (b[key] ?? '')) return false;
	return true;
}

/**
 * The MD5 of a file's content when its ETag is one (a single-part upload); null for a multipart ETag (`…-N`).
 * @param {string | undefined} etag
 */
export function md5OfEtag(etag) {
	const value = (etag ?? '').replaceAll('"', '');
	return /^[a-f0-9]{32}$/.test(value) ? value : null;
}

/**
 * Public or private, from an anonymous HEAD on the bucket's own address: 200 public, 403 private.
 * @param {number} status
 * @param {string} key
 */
export function visibilityOf(status, key) {
	if (status === 200) return 'public-read';
	if (status === 403) return 'private';
	throw new SpacesCopyError(
		`An anonymous check of ${key} answered ${status}; expected 200 (public) or 403 (private).`,
	);
}

/** @param {string} base @param {string} key */
export function addressOf(base, key) {
	return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The browser-upload rule check: a preflight from the origin must be allowed for PUT.
 * @param {number} status
 * @param {string | null} allowOrigin
 * @param {string} origin
 */
export function corsAllows(status, allowOrigin, origin) {
	return status >= 200 && status < 300 && (allowOrigin === origin || allowOrigin === '*');
}

/**
 * The report, names and counts only.
 * @param {{ from: string, to: string, fromTier: string, toTier: string, apply: boolean, files: number, bytes: number,
 *   publicFiles: number, privateFiles: number, actions: Record<'copy' | 'set-visibility' | 'same', number>, extra: number,
 *   failed: string[], verify?: { identical: number, problems: string[] } | null,
 *   checks?: { listingRefused: boolean, cdn: boolean | null, cors: { origin: string, allowed: boolean }[] } | null }} r
 */
export function formatCopyReport(r) {
	const lines = [
		`${r.from} (${r.fromTier}) → ${r.to} (${r.toTier})${r.apply ? '' : ' · plan only; add --apply to copy'}`,
		`  Source: ${r.files} files, ${(r.bytes / 1024 / 1024).toFixed(2)} MiB, ${r.publicFiles} public, ${r.privateFiles} private`,
		`  ${r.apply ? 'Copied' : 'To copy'}: ${r.actions.copy} · ${r.apply ? 'public/private set' : 'public/private to set'}: ${r.actions['set-visibility']} · already the same: ${r.actions.same}`,
		`  Only in the destination (left as they are): ${r.extra}`,
	];
	if (r.failed.length) lines.push(`  Failed (${r.failed.length}): ${r.failed.slice(0, 10).join('; ')}`);
	if (r.verify) {
		lines.push(
			`  Verified: ${r.verify.identical}/${r.files} identical in content, headers and public/private` +
				(r.verify.problems.length ? `; problems: ${r.verify.problems.slice(0, 10).join('; ')}` : ''),
		);
	}
	if (r.checks) {
		lines.push(
			`  Destination listing refused to the public: ${r.checks.listingRefused ? 'yes' : 'NO: set File Listing to Restricted'}`,
		);
		lines.push(
			`  CDN serves a public file: ${r.checks.cdn === null ? 'no public file to try' : r.checks.cdn ? 'yes' : 'NO: switch the CDN on, or check SPACES_CDN_URL'}`,
		);
		for (const { origin, allowed } of r.checks.cors) {
			lines.push(
				`  Browser uploads from ${origin}: ${allowed ? 'allowed' : 'NOT allowed: add it under the bucket’s CORS settings'}`,
			);
		}
	}
	return lines.join('\n');
}
