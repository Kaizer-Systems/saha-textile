/**
 * The decisions behind `pnpm db:copy` (scripts/db/copy-database.mjs), free of network calls so they can be tested.
 * Owner, 2026-11-23: staging gets this computer's database "as it is" under staging's own logins; later a trimmed
 * staging goes to production. Production's data never leaves production (production-deployment-plan.mdx §11).
 */

export const USAGE =
	'Usage: pnpm db:copy -- --from <local|stack|development|staging> --to <stack|development|staging|production> ' +
	'[--from-ssh <user@host>] [--to-ssh <user@host>] [--apply --confirm <destination database>]';

/**
 * Where each database lives. `local` is this computer's MongoDB (docker/mongo), `stack` the full Docker stack
 * (docker/stack, a server's shape on this computer), the rest a server reached over SSH (its admin login is in the
 * docker group, so no sudo). `apps` are stopped while the copy lands and run the release steps after it.
 */
export const ENDPOINTS = /** @type {const} */ ({
	local: { project: 'saha-textile-mongo', apps: [], remote: false, database: null },
	stack: { project: 'saha-textile-stack', apps: ['api', 'worker'], remote: false, database: 'saha_textile_stack' },
	development: { project: 'saha-textile', apps: ['api', 'worker'], remote: true, database: null },
	staging: { project: 'saha-textile', apps: ['api', 'worker'], remote: true, database: null },
	production: { project: 'saha-textile', apps: ['api', 'worker'], remote: true, database: null },
});

export class DatabaseCopyError extends Error {}

const SSH = /^[a-z_][a-z0-9_-]*@[A-Za-z0-9.:-]+$/;

/**
 * @param {string[]} args
 * @returns {{ from: keyof typeof ENDPOINTS, to: keyof typeof ENDPOINTS, fromSsh: string | null, toSsh: string | null, apply: boolean, confirm: string | null }}
 */
export function parseCopyArgs(args) {
	const words = args.filter((arg) => arg !== '--');
	/** @type {Record<string, string>} */
	const named = {};
	let apply = false;
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word === '--apply') {
			apply = true;
			continue;
		}
		if (!['--from', '--to', '--from-ssh', '--to-ssh', '--confirm'].includes(word))
			throw new DatabaseCopyError(USAGE);
		const value = words[index + 1];
		if (value === undefined || value.startsWith('--')) throw new DatabaseCopyError(USAGE);
		if (named[word] !== undefined) throw new DatabaseCopyError(`${word} is given twice.`);
		named[word] = value;
		index += 1;
	}
	const from = named['--from'];
	const to = named['--to'];
	if (!from || !to) throw new DatabaseCopyError(USAGE);
	for (const name of [from, to]) {
		if (!Object.hasOwn(ENDPOINTS, name)) throw new DatabaseCopyError(`Unknown place ${name}. ${USAGE}`);
	}
	if (from === to) throw new DatabaseCopyError('--from and --to name the same place.');
	if (from === 'production') throw new DatabaseCopyError("Production's data never leaves production.");
	if (to === 'local') {
		throw new DatabaseCopyError(
			"This computer's own database is never overwritten by a copy; it is where copies come from.",
		);
	}
	for (const [side, place, ssh] of [
		['from', from, named['--from-ssh']],
		['to', to, named['--to-ssh']],
	]) {
		const remote = ENDPOINTS[/** @type {keyof typeof ENDPOINTS} */ (place)].remote;
		if (remote && !ssh)
			throw new DatabaseCopyError(`${place} is a server: add --${side}-ssh <user@host> (its admin login).`);
		if (!remote && ssh) throw new DatabaseCopyError(`${place} is on this computer: --${side}-ssh is not used.`);
		if (ssh && !SSH.test(ssh)) throw new DatabaseCopyError(`--${side}-ssh takes user@host, not ${ssh}.`);
	}
	return {
		from: /** @type {keyof typeof ENDPOINTS} */ (from),
		to: /** @type {keyof typeof ENDPOINTS} */ (to),
		fromSsh: named['--from-ssh'] ?? null,
		toSsh: named['--to-ssh'] ?? null,
		apply,
		confirm: named['--confirm'] ?? null,
	};
}

/**
 * A copy replaces the destination's collections, so it needs the destination database's name typed again.
 * @param {{ apply: boolean, confirm: string | null }} args
 * @param {string} destinationDatabase
 */
export function checkConfirmation(args, destinationDatabase) {
	if (!args.apply) return;
	if (args.confirm !== destinationDatabase) {
		throw new DatabaseCopyError(
			`This replaces the collections of ${destinationDatabase}. Add --confirm ${destinationDatabase} to go ahead.`,
		);
	}
}

/** A database name the copy will pass to the tools: MongoDB's own rules, kept narrow. */
export function checkDatabaseName(name, where) {
	if (!/^[a-z][a-z0-9_]{2,62}$/.test(name ?? '')) {
		throw new DatabaseCopyError(`${where} has no usable MONGODB_DB_NAME.`);
	}
	return name;
}

/** Single quotes for a POSIX shell, for commands sent over SSH. */
export function shellQuote(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * Collections and document counts compared after a copy.
 * @param {Record<string, number>} source
 * @param {Record<string, number>} destination
 */
export function compareCounts(source, destination) {
	const different = Object.keys(source).filter((name) => destination[name] !== source[name]);
	const extra = Object.keys(destination).filter((name) => !(name in source));
	return { same: Object.keys(source).length - different.length, different, extra };
}

/**
 * @param {{ from: string, to: string, fromDatabase: string, toDatabase: string, apply: boolean,
 *   source: Record<string, number>, destination: Record<string, number>, after?: Record<string, number> | null,
 *   steps?: string[] }} r
 */
export function formatCopyReport(r) {
	const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);
	const lines = [
		`${r.from} (${r.fromDatabase}) → ${r.to} (${r.toDatabase})${r.apply ? '' : ' · plan only; add --apply --confirm ' + r.toDatabase}`,
		`  Source: ${Object.keys(r.source).length} collections, ${total(r.source)} documents`,
		`  Destination now: ${Object.keys(r.destination).length} collections, ${total(r.destination)} documents` +
			(r.apply ? '' : ' (its collections that the source also has are replaced)'),
	];
	for (const step of r.steps ?? []) lines.push(`  ${step}`);
	if (r.after) {
		const { same, different, extra } = compareCounts(r.source, r.after);
		lines.push(
			`  Verified: ${same}/${Object.keys(r.source).length} collections hold the same number of documents` +
				(different.length ? `; different: ${different.join(', ')}` : ''),
		);
		if (extra.length) lines.push(`  Only in the destination, left as they were: ${extra.join(', ')}`);
	}
	return lines.join('\n');
}
