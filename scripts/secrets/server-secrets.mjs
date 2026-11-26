/**
 * `pnpm secrets:generate -- <development|staging|production> [--write] [--replace-shared]`: fills a
 * server project's own secrets and plain server settings in Infisical (owner, 2026-11-20: made once
 * per tier on this computer, before that tier's first deploy, never by a GitHub runner and never per
 * release; 2026-11-21: "do the remaining pending items").
 *
 * - Secrets come from generate.mjs (the same recipe as this computer's): database and Redis
 *   passwords, sign-in and CSRF secrets, the mailbox key, the replica-set keyfile, the database
 *   administrator and the search master key. A filled value is kept: nothing is overwritten, except
 *   with `--replace-shared` a value that is still this computer's own (the development project was
 *   copied from saha-textile-local on 2026-11-21).
 * - Server settings are the shape every server runs (the production proof's): ports, container
 *   hosts, proxy, cookie and message settings, and the tier's database name. A blank one is set; a
 *   filled one that differs is reported, never changed.
 * - Everything else a deploy needs (domains, MSG91, Spaces, backups) is listed as still yours.
 *
 * Without `--write` it only reports. Values are read into memory, compared and dropped; output is
 * names only. Writes go through write.mjs (private files, one CLI call per folder).
 */
import { generateServiceSecrets } from './generate.mjs';
import { SecretsError, SERVER_TIERS } from './inventory.mjs';
import { isBlank } from './render.mjs';

/** Said when a tier other than a server's is named. */
export const SERVER_ONLY = `secrets:generate is for ${SERVER_TIERS.join(', ')}. This computer's own are made by pnpm secrets:setup-local.`;

/** The database each server tier uses (production as in environment-variables.mdx). */
export const SERVER_DATABASES = {
	development: 'saha_textile_development',
	staging: 'saha_textile_staging',
	production: 'saha_textile_prod',
};

/**
 * The plain settings every server runs with, as the production proof deploys them
 * (scripts/production-proof.sh `make_secrets`). None is secret.
 * @param {'development' | 'staging' | 'production'} tier
 */
export function serverSettings(tier) {
	return new Map([
		['NODE_ENV', 'production'],
		['DEPLOY_ENV', tier],
		['PORT', '4000'],
		['COOKIE_SECURE', 'true'],
		['TRUST_PROXY', 'true'],
		['CLIENT_IP_HEADER', 'cf-connecting-ip'],
		['NOTIFICATION_PROVIDER', 'msg91'],
		['MONGODB_HOST', 'mongo'],
		['MONGODB_PORT', '27017'],
		['MONGODB_REPLICA_SET', 'rs0'],
		['MONGODB_DB_NAME', SERVER_DATABASES[tier]],
		['REDIS_HOST', 'redis'],
		['REDIS_PORT', '6379'],
		['MEILISEARCH_HOST', 'http://meilisearch:7700'],
	]);
}

/** Generated names whose value is a fixed login name, not a secret: handled like server settings. */
const FIXED_NAMES = new Set(['MONGODB_USERNAME', 'mongo-root-username']);

/** What makes two values "the same secret": the search config differs in `env`, not in its key. */
function secretPart(name, value) {
	if (name !== 'meilisearch.toml') return value;
	return /^\s*master_key\s*=\s*"([^"]*)"/m.exec(value)?.[1] ?? value;
}

/**
 * @typedef {{ api: Map<string, string>, infrastructure: Map<string, string>, backup?: Map<string, string> }} Folders
 * @typedef {{ tier: 'development' | 'staging' | 'production', folder: string, name: string, value: string }} Change
 */

/**
 * The changes for one server project, and a names-only report of them.
 * @param {object} options
 * @param {string} options.tier
 * @param {Folders} options.folders            the server project's values (memory only)
 * @param {Folders} options.local              this computer's project, to find values still shared
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {boolean} [options.replaceShared]
 * @param {typeof generateServiceSecrets} [options.generate]
 */
export function planServerSecrets({
	tier,
	folders,
	local,
	inventory,
	replaceShared = false,
	generate = generateServiceSecrets,
}) {
	if (!SERVER_TIERS.includes(tier)) throw new SecretsError(SERVER_ONLY);
	const serverTier = /** @type {'development' | 'staging' | 'production'} */ (tier);
	const made = generate(serverTier);
	/** @type {Change[]} */
	const changes = [];
	const report = {
		/** blank, now made */ make: /** @type {string[]} */ ([]),
		/** still this computer's value, replaced (--replace-shared) */ replace: /** @type {string[]} */ ([]),
		/** still this computer's value, kept (no --replace-shared) */ shared: /** @type {string[]} */ ([]),
		/** filled with its own value, kept */ kept: /** @type {string[]} */ ([]),
		/** blank server setting, now set */ set: /** @type {string[]} */ ([]),
		/** filled server setting that differs from the server shape: `NAME (expected VALUE)` */ differs:
			/** @type {string[]} */ ([]),
		/** required for a deploy and still blank after this */ yours: /** @type {string[]} */ ([]),
		/** production backups, still blank */ backup: /** @type {string[]} */ ([]),
	};
	const label = (folder, name) => (folder === 'api' ? name : `/${folder}/${name}`);

	const fixed = [
		...[...serverSettings(serverTier)].map(([name, value]) => ['api', name, value]),
		...[...made.api].filter(([name]) => FIXED_NAMES.has(name)).map(([name, value]) => ['api', name, value]),
		...[...made.infrastructure]
			.filter(([name]) => FIXED_NAMES.has(name))
			.map(([name, value]) => ['infrastructure', name, value]),
	];
	for (const [folder, name, value] of fixed) {
		const current = folders[folder]?.get(name);
		if (isBlank(current)) {
			changes.push({ tier: serverTier, folder, name, value });
			report.set.push(label(folder, name));
		} else if (current !== value) report.differs.push(`${label(folder, name)} (expected ${value})`);
	}

	for (const folder of /** @type {const} */ (['api', 'infrastructure'])) {
		for (const [name, value] of made[folder]) {
			if (FIXED_NAMES.has(name)) continue;
			const current = folders[folder]?.get(name);
			const ours = local[folder]?.get(name);
			if (isBlank(current)) {
				changes.push({ tier: serverTier, folder, name, value });
				report.make.push(label(folder, name));
			} else if (!isBlank(ours) && secretPart(name, current) === secretPart(name, ours)) {
				if (replaceShared) {
					changes.push({ tier: serverTier, folder, name, value });
					report.replace.push(label(folder, name));
				} else report.shared.push(label(folder, name));
			} else report.kept.push(label(folder, name));
		}
	}

	const after = new Map(folders.api);
	for (const change of changes) if (change.folder === 'api') after.set(change.name, change.value);
	report.yours = inventory.requiredForRelease.filter((name) => isBlank(after.get(name)));
	if (serverTier === 'production')
		report.backup = inventory.backup.filter((name) => isBlank(folders.backup?.get(name)));
	for (const list of Object.values(report)) list.sort();
	return { changes, report };
}

/**
 * The report as lines, names only.
 * @param {ReturnType<typeof planServerSecrets>['report']} report
 * @param {{ project: string, written: boolean }} options
 */
export function formatServerPlan(report, { project, written }) {
	const lines = [project];
	const say = (title, names) => names.length > 0 && lines.push(`  ${title} (${names.length}): ${names.join(', ')}`);
	say(written ? 'Made' : 'Would make', report.make);
	say(written ? 'Replaced, were this computer’s' : 'Would replace, still this computer’s', report.replace);
	say(written ? 'Server settings set' : 'Would set server settings', report.set);
	say('Still this computer’s value, kept (run with --replace-shared to give the server its own)', report.shared);
	say('Already its own, kept', report.kept);
	say('Filled, but not the server shape (kept; change by hand if wrong)', report.differs);
	say('Still yours before a deploy', report.yours);
	say('Still yours before production backups', report.backup);
	if (written && report.make.length + report.replace.length > 0) {
		lines.push(
			'  Copy the new values into NordPass from the Infisical dashboard: Infisical Free keeps no history.',
		);
	}
	if (!written) lines.push('  Nothing written. Run again with --write to save these.');
	return lines.join('\n');
}
