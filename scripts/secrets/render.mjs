/**
 * The renderer: turns the values of one Infisical project into the files each place reads.
 *
 *   buildDevEnv     `apps/api/.env` for `pnpm dev` (owner decision L1, 2026-11-19)
 *   buildRelease    a release folder's `secrets/` and `release.env`, the same for the local
 *                   pipeline and the staging and production deploy jobs
 *   projectReport   what `pnpm secrets:status` prints: names and counts, never values
 *
 * Everything here is pure: it takes Maps of name → value and returns text. Reading Infisical and
 * writing files happen in the callers, so the rules can be tested with made-up values.
 *
 * The repository and its Actions logs are public. No message, note or error built here may contain
 * a value: only setting names, file names and counts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FOLDERS, SecretsError, folderNames } from './inventory.mjs';

/** @typedef {Map<string, string>} Folder */
/** @typedef {import('./inventory.mjs').Inventory} Inventory */

/**
 * API settings that shell scripts read with `sed` (deploy.sh, the stack script), so they must be
 * written without quotes. Any value that would need quoting is refused instead.
 */
export const SHELL_READ_API_NAMES = new Set([
	'ADMIN_APP_URL',
	'CCAVENUE_BASE_URL',
	'CCAVENUE_MERCHANT_ID',
	'CCAVENUE_RETURN_URL',
	'FACEBOOK_OAUTH_APP_ID',
	'GOOGLE_OAUTH_CLIENT_ID',
	'MONGODB_DB_NAME',
	'MONGODB_USERNAME',
	'SPACES_CDN_URL',
	'SPACES_ENDPOINT',
]);

/** The deploy reads this key from the search server, so a release never carries it. */
const DERIVED_AT_DEPLOY = 'MEILISEARCH_API_KEY';

/** No whitespace, quotes, `#`, backslash or `$`: safe unquoted for dotenv, Docker, Compose and sed. */
const PLAIN = /^[^\s'"`#\\$]*$/;

/** @param {string | undefined} value */
export function isBlank(value) {
	return value === undefined || value.trim() === '';
}

/** @param {string} value */
export function isPlain(value) {
	return PLAIN.test(value);
}

/**
 * One `NAME=value` line that dotenv reads back exactly. Quotes only when needed, and never quotes a
 * value a shell script or Docker will read raw (`plainOnly`).
 * @param {string} name
 * @param {string} value
 * @param {boolean} plainOnly
 */
export function envLine(name, value, plainOnly) {
	if (isPlain(value)) return `${name}=${value}`;
	if (plainOnly) {
		throw new SecretsError(
			`${name} contains a space, quote, #, backslash or $, which this file cannot carry. Choose a value without them.`,
		);
	}
	if (value.includes('\r'))
		throw new SecretsError(`${name} contains a carriage return, which a .env file cannot hold.`);
	// Checked against dotenv 18 with 200,000 random values: a quote mark the value does not contain
	// reads back exactly. Double quotes turn "\n" into a line break, so they need a value without a
	// backslash.
	if (!value.includes("'")) return `${name}='${value}'`;
	if (!value.includes('`')) return `${name}=\`${value}\``;
	if (!value.includes('"') && !value.includes('\\')) return `${name}="${value}"`;
	throw new SecretsError(`${name} uses every kind of quote mark, which a .env file cannot hold.`);
}

/**
 * @param {Array<[string, string]>} entries
 * @param {{ header?: string[], plainOnly?: boolean, plainNames?: Set<string> }} [options]
 */
export function renderEnvFile(entries, { header = [], plainOnly = false, plainNames = new Set() } = {}) {
	const lines = header.map((line) => `# ${line}`);
	for (const [name, value] of entries) lines.push(envLine(name, value, plainOnly || plainNames.has(name)));
	return `${lines.join('\n')}\n`;
}

/**
 * Renders entries one by one, collecting each refusal as a problem instead of stopping at the first.
 * @param {Array<[string, string]>} entries
 * @param {{ header: string[], plainOnly?: boolean, plainNames?: Set<string> }} options
 * @param {string[]} problems
 */
function renderCollecting(entries, options, problems) {
	const kept = [];
	for (const entry of entries) {
		try {
			renderEnvFile([entry], options);
			kept.push(entry);
		} catch (error) {
			problems.push(/** @type {Error} */ (error).message);
		}
	}
	return renderEnvFile(kept, options);
}

/** @param {Iterable<[string, string]>} entries */
function sorted(entries) {
	return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @param {string[]} problems */
function refuse(heading, problems) {
	throw new SecretsError([heading, ...problems.map((problem) => `  - ${problem}`)].join('\n'));
}

/**
 * The names a release writes from an `/api` setting, per folder they used to be stored in: the two
 * password files (owner decision L3) and the two public sign-in IDs (owner decision D2). An entry
 * left behind in Infisical is not unknown; it is due for deletion.
 * @param {Inventory} inventory
 * @returns {Record<string, Set<string>>}
 */
export function derivedNames(inventory) {
	return {
		infrastructure: new Set(Object.keys(inventory.derivedFiles)),
		deployment: new Set(Object.keys(inventory.derivedDeployment)),
	};
}

/**
 * A note or problem for an entry still stored in `folder` although a release now writes it from
 * `/api/<apiName>`. Names only, never a value.
 * @param {string} folder
 * @param {string} name
 * @param {string} apiName
 * @param {Record<string, Folder>} folders
 * @param {string | undefined} value   the `/api` value
 * @param {{ problems: string[], notes: string[] }} sink
 */
function checkLeftover(folder, name, apiName, folders, value, { problems, notes }) {
	const stored = folders[folder]?.get(name);
	if (stored === undefined) return;
	if (isBlank(stored)) {
		notes.push(`/${folder}/${name} is no longer used (it is written from /api/${apiName}): delete it.`);
	} else if (stored === value) {
		notes.push(`/${folder}/${name} repeats /api/${apiName}: delete it.`);
	} else {
		problems.push(
			`/${folder}/${name} differs from /api/${apiName}. Keep the right value in /api/${apiName} and delete /${folder}/${name}.`,
		);
	}
}

/**
 * Names in a folder that the inventory does not know. A blank one only earns a note; one with a
 * value is refused, because it is most likely a misspelt setting the apps would never read.
 * @param {string} folder
 * @param {Folder} values
 * @param {Set<string>} allowed
 * @param {{ problems: string[], notes: string[], skip?: Set<string> }} out
 */
function checkUnknown(folder, values, allowed, { problems, notes, skip = new Set() }) {
	for (const [name, value] of values) {
		if (allowed.has(name) || skip.has(name)) continue;
		if (isBlank(value)) notes.push(`/${folder}/${name} is blank and not in the inventory: it can be deleted.`);
		else {
			problems.push(
				`/${folder}/${name} is not in the inventory. Check the spelling, or add it to docker/infisical/variable-names.json.`,
			);
		}
	}
}

/**
 * `apps/api/.env` for `pnpm dev`, from the dev project's `/api` folder. Personal overrides (from
 * `apps/api/.env.overrides`) are laid on top; an override with an empty value removes the setting.
 * @param {Folder} api
 * @param {{ inventory: Inventory, source: string, overrides?: Folder }} options
 */
export function buildDevEnv(api, { inventory, source, overrides = new Map() }) {
	const problems = [];
	const notes = [];
	checkUnknown('api', api, inventory.api, { problems, notes });
	if (problems.length > 0) refuse('apps/api/.env was not written:', problems);

	const values = new Map([...api].filter(([, value]) => !isBlank(value)));
	for (const [name, value] of overrides) {
		if (value === '') values.delete(name);
		else values.set(name, value);
	}
	const header = [
		`Written by pnpm secrets:pull from Infisical ${source}, folder /api.`,
		'Change values in Infisical. Personal changes go in apps/api/.env.overrides, laid on top.',
	];
	const text = renderCollecting(sorted(values), { header, plainNames: SHELL_READ_API_NAMES }, problems);
	if (problems.length > 0) refuse('apps/api/.env was not written:', problems);
	return { text, names: [...values.keys()].sort(), notes };
}

/**
 * The API file of the full local Docker stack (mode 3), from the dev project's `/api` folder. Local
 * development settings and every setting the stack owns are dropped, then the stack's own values are
 * laid on top, so the stack runs the dev project's keys with its own hostnames and services.
 * @param {Folder} api
 * @param {object} options
 * @param {Inventory} options.inventory
 * @param {string} options.source        where the values came from, for the header
 * @param {RegExp} options.owned         names the stack sets itself
 * @param {Folder} options.settings      the stack's own values
 * @param {'refuse' | 'drop'} [options.unknown]  a name the inventory does not know: refused (values
 *                                       read from Infisical) or dropped with a note (a hand-written file)
 */
export function buildStackEnv(api, { inventory, source, owned, settings, unknown = 'refuse' }) {
	const problems = [];
	const notes = [];
	const known = new Set([...inventory.api, ...settings.keys()]);
	if (unknown === 'refuse') checkUnknown('api', api, known, { problems, notes });
	if (problems.length > 0) refuse('The stack files were not written:', problems);

	const values = new Map();
	const dropped = [];
	for (const [name, value] of api) {
		if (isBlank(value) || owned.test(name) || inventory.developmentOnly.has(name)) continue;
		if (known.has(name)) values.set(name, value);
		else dropped.push(name);
	}
	if (dropped.length > 0) notes.push(`Left out, not in the inventory: ${dropped.sort().join(', ')}.`);
	for (const [name, value] of settings) values.set(name, value);
	const header = [`Written by pnpm stack:env from ${source}.`, 'Change values there, never here.'];
	const text = renderCollecting(sorted(values), { header, plainNames: SHELL_READ_API_NAMES }, problems);
	if (problems.length > 0) refuse('The stack files were not written:', problems);
	return { text, names: [...values.keys()].sort(), notes };
}

/**
 * The files of one release folder, keyed by their path inside it:
 * `secrets/api.env`, `secrets/backup.env`, one file per `/infrastructure` entry, the files written
 * from `/api` settings (`derivedSecretFiles`, owner decision L3), and `release.env`.
 *
 * @param {Record<string, Folder>} folders     the project's four folders
 * @param {object} options
 * @param {'dev' | 'staging' | 'production'} options.tier
 * @param {Inventory} options.inventory
 * @param {string} options.source               the project, for the file headers
 * @param {Folder} [options.release]           non-secret settings from the caller: image digests,
 *                                              DEPLOY_ENV, the edge's port and network
 * @param {Folder} [options.apiOverrides]      settings the caller sets over `/api` (the local
 *                                              pipeline's hostnames, for example)
 */
export function buildRelease(folders, { tier, inventory, source, release = new Map(), apiOverrides = new Map() }) {
	const problems = [];
	const notes = [];
	const allowed = folderNames(inventory);
	const derived = derivedNames(inventory);
	for (const folder of FOLDERS) {
		checkUnknown(folder, folders[folder] ?? new Map(), allowed[folder], {
			problems,
			notes,
			skip: derived[folder] ?? new Set(),
		});
	}

	// ---- secrets/api.env
	const api = new Map(folders.api);
	for (const [name, value] of apiOverrides) api.set(name, value);
	const apiEntries = [];
	for (const [name, value] of sorted(api)) {
		if (isBlank(value) || (!inventory.api.has(name) && !apiOverrides.has(name))) continue;
		if (inventory.developmentOnly.has(name)) {
			notes.push(`${name} is for local development only and is left out of the release.`);
		} else if (inventory.composeProvided.has(name)) {
			notes.push(`${name} is set by Compose in a release, so it is left out of api.env.`);
		} else if (name === DERIVED_AT_DEPLOY) {
			notes.push(`${name} is left out: the deploy reads it from the search server.`);
		} else if (name === 'MONGODB_URI') {
			problems.push(
				'MONGODB_URI must stay blank for a release: the deploy uses the separate MONGODB_* settings.',
			);
		} else {
			apiEntries.push([name, value]);
		}
	}
	// On this computer (DEPLOY_ENV=local) the server-only names may stay blank (required-secrets.txt).
	const local = (release.get('DEPLOY_ENV') ?? api.get('DEPLOY_ENV')) === 'local';
	const missing = inventory.requiredForRelease.filter(
		(name) => isBlank(api.get(name)) && !(local && inventory.serverOnlyRequired.has(name)),
	);
	if (missing.length > 0) problems.push(`Required for a release but blank in /api: ${missing.join(', ')}.`);

	const mongoPassword = api.get('MONGODB_PASSWORD');
	if (mongoPassword !== undefined && mongoPassword !== mongoPassword.trim()) {
		problems.push('MONGODB_PASSWORD may not start or end with a space: the database reads its file trimmed.');
	}
	const redisPassword = api.get('REDIS_PASSWORD');
	if (!isBlank(redisPassword) && !isPlain(/** @type {string} */ (redisPassword))) {
		problems.push(
			'REDIS_PASSWORD may not contain a space, quote, #, backslash or $: Redis reads it from a config line.',
		);
	}
	const apiDeployEnv = api.get('DEPLOY_ENV');
	const releaseDeployEnv = release.get('DEPLOY_ENV');
	if (!isBlank(apiDeployEnv) && !isBlank(releaseDeployEnv) && apiDeployEnv !== releaseDeployEnv) {
		problems.push('DEPLOY_ENV in /api differs from the release setting DEPLOY_ENV.');
	}

	/** @type {Map<string, string>} */
	const files = new Map();
	const header = (folder) => [
		`Written from Infisical ${source}, folder /${folder}.`,
		'Change values in Infisical, never here.',
	];
	files.set(
		'secrets/api.env',
		renderCollecting(apiEntries, { header: header('api'), plainNames: SHELL_READ_API_NAMES }, problems),
	);

	// ---- secrets/backup.env: Docker's --env-file reads it raw, so values stay unquoted.
	const backupEntries = [];
	const backupMissing = [];
	for (const name of inventory.backup) {
		const value = folders.backup?.get(name);
		if (isBlank(value)) backupMissing.push(name);
		else backupEntries.push([name, /** @type {string} */ (value)]);
	}
	if (tier === 'production' && backupMissing.length > 0) {
		problems.push(`Required for production backups but blank in /backup: ${backupMissing.join(', ')}.`);
	}
	files.set(
		'secrets/backup.env',
		renderCollecting(backupEntries, { header: header('backup'), plainOnly: true }, problems),
	);

	// ---- one file per /infrastructure entry, written exactly as stored
	for (const file of inventory.infrastructureFiles) {
		const value = folders.infrastructure?.get(file);
		if (isBlank(value)) problems.push(`/infrastructure/${file} is blank.`);
		else files.set(`secrets/${file}`, /** @type {string} */ (value));
	}
	const keyfile = folders.infrastructure?.get('mongo-keyfile');
	if (!isBlank(keyfile) && !/^[A-Za-z0-9+/=]{6,1024}$/.test(/** @type {string} */ (keyfile).replace(/\s/g, ''))) {
		problems.push('mongo-keyfile must be 6 to 1,024 base64 characters, as made by: openssl rand -base64 756');
	}
	const searchConfig = folders.infrastructure?.get('meilisearch.toml');
	if (!isBlank(searchConfig) && !/^master_key *= *"[^"\n]+"/m.test(/** @type {string} */ (searchConfig))) {
		problems.push('meilisearch.toml needs a line of the form: master_key = "…"');
	}
	const rootUser = folders.infrastructure?.get('mongo-root-username');
	if (!isBlank(rootUser) && !isPlain(/** @type {string} */ (rootUser))) {
		problems.push('mongo-root-username may not contain a space, quote, #, backslash or $.');
	}

	// ---- files written from an /api setting, so each password is kept once (owner decision L3)
	for (const [file, apiName] of Object.entries(inventory.derivedFiles)) {
		const value = api.get(apiName);
		if (!isBlank(value)) files.set(`secrets/${file}`, /** @type {string} */ (value));
		checkLeftover('infrastructure', file, apiName, folders, value, { problems, notes });
	}

	// ---- release.env: Compose and sed both read it, so values stay unquoted.
	const releaseValues = new Map();
	for (const [name, value] of folders.deployment ?? new Map()) {
		if (allowed.deployment.has(name) && !isBlank(value)) releaseValues.set(name, value);
	}
	for (const [name, value] of release) {
		if (releaseValues.has(name) && releaseValues.get(name) !== value) {
			problems.push(`${name} is set both in /deployment and by the release step, with different values.`);
		}
		releaseValues.set(name, value);
	}
	// The public sign-in IDs, kept once in /api (owner decision D2). The shop's buttons and the API's
	// token check must use the same ID, so a release copies it rather than storing it twice.
	for (const [name, apiName] of Object.entries(inventory.derivedDeployment)) {
		const value = api.get(apiName);
		if (!isBlank(value)) releaseValues.set(name, /** @type {string} */ (value));
		checkLeftover('deployment', name, apiName, folders, value, { problems, notes });
	}
	files.set(
		'release.env',
		renderCollecting(sorted(releaseValues), { header: header('deployment'), plainOnly: true }, problems),
	);

	if (problems.length > 0) refuse('The release folder was not written:', problems);
	return { files, notes };
}

/**
 * Writes rendered files under `dir`, and never over an existing file, so a release folder is written
 * once.
 *
 * Folders are 0700 and files 0644. On a Linux droplet each file is mounted into a container whose
 * process is not root (the API runs as `node`, MongoDB reads its `_FILE` settings as `mongodb`), so a
 * root-owned 0600 file could not be read there. The 0700 folders are what keep every other account
 * on the host out; `pnpm production:proof` runs with the same modes.
 * @param {string} dir
 * @param {Map<string, string>} files
 */
export function writeFiles(dir, files) {
	for (const [path, content] of files) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
		try {
			writeFileSync(target, content, { mode: 0o644, flag: 'wx' });
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
				throw new SecretsError(
					`${path} already exists in ${dir}. A release folder is written once; use a new one.`,
				);
			}
			throw error;
		}
	}
}

/**
 * Which names a refresh of an env file adds, removes and changes. Names only. A blank line in the
 * current file counts as unset, so a name blank on both sides is not reported as removed: it is only
 * counted in `blankDropped`.
 * @param {Folder | null} current   the file as it is now, or null when there is none
 * @param {Folder} next
 */
export function planEnvFileChange(current, next) {
	const before = new Map([...(current ?? new Map())].filter(([, value]) => !isBlank(value)));
	const added = [...next.keys()].filter((name) => !before.has(name)).sort();
	const removed = [...before.keys()].filter((name) => !next.has(name)).sort();
	const changed = [...next.keys()].filter((name) => before.has(name) && before.get(name) !== next.get(name)).sort();
	const same = [...next.keys()].filter((name) => before.get(name) === next.get(name)).length;
	const blankDropped = [...(current ?? new Map())].filter(
		([name, value]) => isBlank(value) && !next.has(name),
	).length;
	return { added, removed, changed, same, blankDropped };
}

/**
 * What `pnpm secrets:status` reports for one project. Names and counts only.
 * @param {Record<string, Folder>} folders
 * @param {{ tier: 'dev' | 'staging' | 'production', inventory: Inventory }} options
 */
export function projectReport(folders, { tier, inventory, setByPipeline = new Set() }) {
	const allowed = folderNames(inventory);
	const derived = derivedNames(inventory);
	/** @type {Record<string, Set<string>>} */
	const expected = {
		...allowed,
		api:
			tier === 'dev'
				? allowed.api
				: new Set(
						[...allowed.api].filter(
							(name) => !inventory.developmentOnly.has(name) && !inventory.composeProvided.has(name),
						),
					),
	};
	const perFolder = FOLDERS.map((folder) => {
		const values = folders[folder] ?? new Map();
		const entries = [...values];
		return {
			folder,
			filled: entries.filter(([, value]) => !isBlank(value)).length,
			blank: entries.filter(([, value]) => isBlank(value)).length,
			missing: [...expected[folder]].filter((name) => !values.has(name)).sort(),
			unknown: entries
				.map(([name]) => name)
				.filter((name) => !allowed[folder].has(name) && !derived[folder]?.has(name))
				.sort(),
			toDelete: entries
				.map(([name]) => name)
				.filter((name) => derived[folder]?.has(name))
				.sort(),
		};
	});
	const api = folders.api ?? new Map();
	// The dev project's release is the local pipeline's, which sets the stack's own settings itself.
	const requiredBlank = inventory.requiredForRelease.filter(
		(name) =>
			isBlank(api.get(name)) &&
			!(tier === 'dev' && (setByPipeline.has(name) || inventory.serverOnlyRequired.has(name))),
	);
	const infrastructureBlank = inventory.infrastructureFiles.filter((file) =>
		isBlank(folders.infrastructure?.get(file)),
	);
	const backupBlank =
		tier === 'production' ? inventory.backup.filter((name) => isBlank(folders.backup?.get(name))) : [];
	// Fine on this computer, but a server reading this project (a future dev server) would need them.
	const serverOnlyBlank =
		tier === 'dev' ? [...inventory.serverOnlyRequired].filter((name) => isBlank(api.get(name))) : [];
	return { tier, folders: perFolder, requiredBlank, infrastructureBlank, backupBlank, serverOnlyBlank };
}

/**
 * @param {ReturnType<typeof projectReport>} report
 * @param {string} title
 */
/**
 * One folder the shop never reads (inventory.otherFolders), for `pnpm secrets:status`. Names only.
 * @param {import('./inventory.mjs').OtherFolder} group
 * @param {Map<string, string> | null} values   null when the folder could not be read
 * @param {Record<string, Map<string, string>>} [shopFolders]  the same project's shop folders, to
 *   point out a name still kept there (it belongs in this folder only)
 */
export function otherFolderReport(group, values, shopFolders = {}) {
	const alsoIn = Object.entries(shopFolders).flatMap(([folder, entries]) =>
		group.names.filter((name) => entries.has(name)).map((name) => `/${folder}/${name}`),
	);
	if (values === null) return { folder: group.folder, readable: false, count: group.names.length, alsoIn };
	const listed = new Set(group.names);
	const inSets = new Set(group.oneOf.flat());
	const required = group.names.filter((name) => !group.optional.has(name) && !inSets.has(name));
	const filled = (name) => !isBlank(values.get(name));
	// A set is met when any one of its names is filled; its blank names are then simply optional.
	const met = group.oneOf.filter((set) => set.some(filled));
	return {
		folder: group.folder,
		readable: true,
		filled: [...values].filter(([, value]) => !isBlank(value)).length,
		missing: required.filter((name) => !values.has(name)),
		blank: required.filter((name) => values.has(name) && isBlank(values.get(name))),
		needOneOf: group.oneOf.filter((set) => !set.some(filled)),
		optionalBlank: [...group.optional, ...met.flat()].filter((name) => !filled(name)),
		unknown: [...values.keys()].filter((name) => !listed.has(name)).sort(),
		alsoIn,
	};
}

/** @param {ReturnType<typeof otherFolderReport>} report */
export function formatOtherFolder(report) {
	const head = `  /${report.folder.padEnd(15)}`;
	const moved =
		report.alsoIn.length > 0
			? [`      also still in a shop folder: ${report.alsoIn.join(', ')} (delete it there once it is here)`]
			: [];
	if (!report.readable) {
		return [
			`${head} could not be read (not created yet?); its ${report.count} names are in docker/infisical/variable-names.json`,
			...moved,
		].join('\n');
	}
	const lines = [`${head} ${report.filled} filled`];
	if (report.missing.length > 0) lines.push(`      not in Infisical yet: ${report.missing.join(', ')}`);
	if (report.blank.length > 0) lines.push(`      blank: ${report.blank.join(', ')}`);
	if (report.needOneOf.length > 0) {
		lines.push(`      needs one of: ${report.needOneOf.map((set) => set.join(' or ')).join('; ')}`);
	}
	if (report.optionalBlank.length > 0) lines.push(`      optional, blank: ${report.optionalBlank.join(', ')}`);
	if (report.unknown.length > 0) lines.push(`      not in the inventory (misspelt?): ${report.unknown.join(', ')}`);
	lines.push(...moved);
	return lines.join('\n');
}

export function formatReport(report, title) {
	const lines = [title];
	for (const folder of report.folders) {
		lines.push(`  /${folder.folder.padEnd(15)} ${folder.filled} filled, ${folder.blank} blank`);
		if (folder.missing.length > 0) lines.push(`      not in Infisical yet: ${folder.missing.join(', ')}`);
		if (folder.unknown.length > 0)
			lines.push(`      not in the inventory (misspelt?): ${folder.unknown.join(', ')}`);
		if (folder.toDelete.length > 0) {
			lines.push(
				`      delete (now written from /api, owner decisions L3 and D2): ${folder.toDelete.join(', ')}`,
			);
		}
	}
	const release = report.tier === 'dev' ? 'the local pipeline' : 'a deploy';
	if (report.requiredBlank.length > 0) {
		lines.push(`  Blank, but ${release} needs it in /api: ${report.requiredBlank.join(', ')}`);
	}
	if (report.infrastructureBlank.length > 0) {
		lines.push(`  Blank, but ${release} needs it in /infrastructure: ${report.infrastructureBlank.join(', ')}`);
	}
	if (report.serverOnlyBlank?.length > 0) {
		lines.push(
			`  Blank, fine on this computer, needed before a server uses this project: ${report.serverOnlyBlank.join(', ')}`,
		);
	}
	if (report.backupBlank.length > 0)
		lines.push(`  Blank, but production backups need it in /backup: ${report.backupBlank.join(', ')}`);
	const ready =
		report.requiredBlank.length === 0 &&
		report.infrastructureBlank.length === 0 &&
		report.backupBlank.length === 0 &&
		report.folders.every((folder) => folder.unknown.length === 0);
	lines.push(ready ? `  Ready for ${release}.` : `  Not ready for ${release} yet.`);
	return lines.join('\n');
}
