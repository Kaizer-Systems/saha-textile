/**
 * `pnpm secrets:rotate -- <development|staging|production> --names <ids> [--no-grace] [--clear-previous] [--json]`:
 * new values for a server project's secrets, written to Infisical from this computer (owner,
 * 2026-11-23, Release Path brief: the Release Console's Run › Secrets › Rotate runs it).
 *
 * - New values follow generate.mjs's recipes, so a rotated value looks like a first one.
 * - The sign-in, CSRF and mailbox keys keep their old value for 30 days by default (grace): it
 *   moves to `<NAME>_PREVIOUS`, which the API still accepts, so nobody is signed out. After a leak,
 *   `--no-grace` leaves `<NAME>_PREVIOUS` blank instead. `--clear-previous` blanks every kept key
 *   once the 30 days are over.
 * - The database, Redis and search values reach the server only through a deploy started with
 *   rotation (`needsRotateDeploy`); a deploy without it is refused before anything changes.
 *
 * Values are read into memory, compared and written through write.mjs (private files); output is
 * names only, as JSON with `--json`.
 */
import { generateServiceSecrets } from './generate.mjs';
import { SecretsError, SERVER_TIERS } from './inventory.mjs';
import { isBlank } from './render.mjs';

const USAGE =
	'Usage: pnpm secrets:rotate -- <development|staging|production> --names <ids> [--no-grace] [--clear-previous] [--json]';

/** What each id the console sends changes: folder and name. */
export const ROTATION_IDS = /** @type {const} */ ({
	'mongo-app': [['api', 'MONGODB_PASSWORD']],
	redis: [['api', 'REDIS_PASSWORD']],
	'mongo-root': [['infrastructure', 'mongo-root-password']],
	'mongo-monitor': [['infrastructure', 'mongo-monitor-password']],
	search: [['infrastructure', 'meilisearch.toml']],
	keyfile: [['infrastructure', 'mongo-keyfile']],
	'sign-in': [
		['api', 'JWT_ACCESS_SECRET'],
		['api', 'JWT_REFRESH_SECRET'],
	],
	csrf: [['api', 'CSRF_SECRET']],
	mailbox: [['api', 'MAILBOX_TOKEN_KEY']],
});

/** Keys the API still accepts under `<NAME>_PREVIOUS` for 30 days after a planned change. */
export const GRACE_NAMES = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CSRF_SECRET', 'MAILBOX_TOKEN_KEY'];

/** Ids whose new values reach the server only through a deploy started with rotation. */
export const DATA_SERVICE_IDS = new Set(['mongo-app', 'redis', 'mongo-root', 'mongo-monitor', 'search', 'keyfile']);

/**
 * @param {string[]} args
 * @returns {{ tier: 'development' | 'staging' | 'production', ids: string[], grace: boolean, clearPrevious: boolean, json: boolean }}
 */
export function parseRotateArgs(args) {
	const words = args.filter((arg) => arg !== '--');
	/** @type {string[]} */
	let ids = [];
	let tier;
	let grace = true;
	let clearPrevious = false;
	let json = false;
	let namesGiven = false;
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word === '--names') {
			const value = words[index + 1];
			if (namesGiven || value === undefined || value.startsWith('--')) throw new SecretsError(USAGE);
			ids = value
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean);
			namesGiven = true;
			index += 1;
		} else if (word === '--no-grace') grace = false;
		else if (word === '--clear-previous') clearPrevious = true;
		else if (word === '--json') json = true;
		else if (word.startsWith('--') || tier !== undefined) throw new SecretsError(USAGE);
		else tier = word;
	}
	if (!SERVER_TIERS.includes(/** @type {string} */ (tier))) {
		throw new SecretsError(`secrets:rotate is for ${SERVER_TIERS.join(', ')}. ${USAGE}`);
	}
	const unknown = ids.filter((id) => !Object.hasOwn(ROTATION_IDS, id));
	if (unknown.length > 0) {
		throw new SecretsError(`Unknown id ${unknown[0]}. Use: ${Object.keys(ROTATION_IDS).join(', ')}.`);
	}
	if (new Set(ids).size !== ids.length) throw new SecretsError('An id is given twice.');
	if (ids.length === 0 && !clearPrevious) throw new SecretsError(`Nothing to rotate. ${USAGE}`);
	return {
		tier: /** @type {'development' | 'staging' | 'production'} */ (tier),
		ids,
		grace,
		clearPrevious,
		json,
	};
}

/**
 * The changes for one rotation, and a names-only report.
 * @param {object} options
 * @param {'development' | 'staging' | 'production'} options.tier
 * @param {string[]} options.ids
 * @param {boolean} options.grace
 * @param {boolean} options.clearPrevious
 * @param {{ api: Map<string, string>, infrastructure: Map<string, string> }} options.folders   the project's values (memory only)
 * @param {typeof generateServiceSecrets} [options.generate]
 * @param {string} [options.at]   when this rotation happens (ISO), recorded for an emergency sign-out
 */
export function planRotation({
	tier,
	ids,
	grace,
	clearPrevious,
	folders,
	generate = generateServiceSecrets,
	at = new Date().toISOString(),
}) {
	const made = generate(tier);
	/** @type {import('./write.mjs').SecretChange[]} */
	const changes = [];
	const report = {
		changed: /** @type {string[]} */ ([]),
		movedToPrevious: /** @type {string[]} */ ([]),
		clearedPrevious: /** @type {string[]} */ ([]),
		needsRotateDeploy: ids.some((id) => DATA_SERVICE_IDS.has(id)),
	};
	const blank = [];
	for (const id of ids) {
		for (const [folder, name] of ROTATION_IDS[/** @type {keyof typeof ROTATION_IDS} */ (id)]) {
			const current = folders[folder]?.get(name);
			// Nothing to rotate: a blank mailbox key means Gmail is off, and setting one alone would
			// stop the API (all five mailbox settings or none).
			if (isBlank(current)) {
				blank.push(name);
				continue;
			}
			if (GRACE_NAMES.includes(name)) {
				const previousName = `${name}_PREVIOUS`;
				if (grace) {
					changes.push({ tier, folder, name: previousName, value: /** @type {string} */ (current) });
					report.movedToPrevious.push(previousName);
				} else if (!isBlank(folders.api.get(previousName))) {
					changes.push({ tier, folder, name: previousName, value: '' });
					report.clearedPrevious.push(previousName);
				}
			}
			changes.push({ tier, folder, name, value: /** @type {string} */ (made[folder].get(name)) });
			report.changed.push(name);
		}
	}
	if (blank.length > 0) throw new SecretsError(`Blank in this project, so nothing to rotate: ${blank.join(', ')}.`);
	// A new CSRF key without grace is the change that signs everyone out (it keys every stored
	// session). The sign-in pages say so for 30 days from this time (SESSIONS_RESET_AT).
	if (ids.includes('csrf') && !grace) {
		changes.push({ tier, folder: 'api', name: 'SESSIONS_RESET_AT', value: at });
		report.changed.push('SESSIONS_RESET_AT');
	}
	if (clearPrevious) {
		for (const name of GRACE_NAMES) {
			const previousName = `${name}_PREVIOUS`;
			if (changes.some((change) => change.name === previousName)) continue;
			if (isBlank(folders.api.get(previousName))) continue;
			changes.push({ tier, folder: 'api', name: previousName, value: '' });
			report.clearedPrevious.push(previousName);
		}
	}
	return { changes, report };
}

/**
 * The report for people, names only.
 * @param {ReturnType<typeof planRotation>['report']} report
 * @param {string} project
 */
export function formatRotation(report, project) {
	const lines = [project];
	const say = (title, names) => names.length > 0 && lines.push(`  ${title} (${names.length}): ${names.join(', ')}`);
	say('New values', report.changed);
	say('Old values kept for 30 days', report.movedToPrevious);
	say('Kept old values cleared', report.clearedPrevious);
	if (report.needsRotateDeploy) {
		lines.push('  Deploy with rotation to change the database, Redis or search on the server.');
	}
	if (report.changed.length > 0) {
		lines.push(
			'  Copy the new values into NordPass from the Infisical dashboard: Infisical Free keeps no history.',
		);
	}
	return lines.join('\n');
}
