/**
 * The names-only inventory of what each Infisical project holds, read from the files the repo
 * already keeps: `docker/infisical/variable-names.json` and `docker/production/required-secrets.txt`.
 *
 * No values live here. The renderer and `pnpm secrets:status` compare Infisical against this.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Every project in variable-names.json, by its `tier`, each with its own Infisical project (owner
 * decisions 2026-11-17 and 2026-11-21): `local` is this computer (saha-textile-local, `pnpm dev`, the
 * Docker stack, the local pipeline), `development` a development server (saha-textile-development),
 * then `staging` and `production`. The key `dev` meant this computer until 2026-11-21; it is refused
 * now, because it reads as either `local` or `development`.
 */
export const TIERS = ['local', 'development', 'staging', 'production'];

/** The tier that is this computer, never a server. */
export const LOCAL_TIER = 'local';

/** The tiers a server deploy releases: every project but this computer's. */
export const SERVER_TIERS = ['development', 'staging', 'production'];

/** The Infisical folders every project uses. */
export const FOLDERS = ['api', 'backup', 'infrastructure', 'deployment'];

/** The tags a name in `required-secrets.txt` may carry (that file's header explains each). */
export const REQUIRED_TAGS = ['server-only', 'may-deploy-blank'];

/** The API setting a release writes to name the settings it deployed blank on purpose. */
export const RELEASE_ALLOWED_BLANK = 'RELEASE_ALLOWED_BLANK';

/** Thrown for anything the person running the command can fix. Messages name settings, never values. */
export class SecretsError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'SecretsError';
	}
}

/**
 * What may be printed about an error. Our own messages name settings and never carry a value; any
 * other error (a JSON parse error, for one) can quote its input, so only its kind is shown.
 * @param {unknown} error
 */
export function describeError(error) {
	if (error instanceof SecretsError) return error.message;
	const { name, code } = /** @type {NodeJS.ErrnoException} */ (error ?? {});
	return `Unexpected failure (${code ?? name ?? 'unknown'}).`;
}

/**
 * @typedef {object} Project
 * @property {string} name        e.g. `saha-textile-staging`
 * @property {string} environment the Infisical environment slug, e.g. `staging`
 * @property {string} projectId
 * @property {string | null} deployIdentityId  the GitHub deploy job's machine identity (not a secret;
 *   the Release Console's create job sets it as the environment's INFISICAL_IDENTITY_ID)
 *
 * @typedef {object} Inventory
 * @property {Record<string, Project>} projects       keyed by tier
 * @property {Set<string>} api                       every API setting name, development-only ones included
 * @property {Set<string>} developmentOnly           never sent to a release
 * @property {Set<string>} composeProvided           set by Compose in a release, so left out of `api.env`
 * @property {string[]} requiredForRelease           `required-secrets.txt`
 * @property {Set<string>} serverOnlyRequired        required on a server, not on a local machine
 * @property {Set<string>} mayDeployBlank            required, but a deploy may name it to go ahead blank
 * @property {Set<string>} releaseWritten            API settings the release itself writes, never stored
 *                                                    in Infisical (RELEASE_ALLOWED_BLANK)
 * @property {string[]} backup
 * @property {string[]} infrastructureFiles          stored whole in `/infrastructure`
 * @property {string[]} certificateFiles             optional in `/infrastructure`; deploy.sh installs them into certs/
 * @property {Record<string, string>} derivedFiles   secret file name → the `/api` setting it is written from
 * @property {string[]} deployment
 * @property {Record<string, string>} derivedDeployment  `release.env` name → the `/api` setting it is
 *                                                    written from (owner decision D2)
 * @property {OtherFolder[]} otherFolders            folders the shop never reads (e.g. /release-console)
 *
 * @typedef {object} OtherFolder
 * @property {string} folder          e.g. `release-console`
 * @property {Set<string>} tiers      the projects that hold it
 * @property {string} readBy          the one code folder that reads these names
 * @property {string[]} names
 * @property {Set<string>} optional   names that may stay blank
 * @property {string[][]} oneOf       sets where at least one name must be filled (e.g. a read key or
 *                                    a change key that can also read)
 */

/**
 * @param {string} [root]
 * @returns {Inventory}
 */
export function loadInventory(root = ROOT) {
	const json = JSON.parse(readFileSync(join(root, 'docker/infisical/variable-names.json'), 'utf8'));
	const requiredLines = readFileSync(join(root, 'docker/production/required-secrets.txt'), 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'))
		.map((line) => line.split(/\s+/));
	for (const [name, ...tags] of requiredLines) {
		const unknown = tags.filter((tag) => !REQUIRED_TAGS.includes(tag));
		if (unknown.length > 0) {
			throw new SecretsError(
				`required-secrets.txt: ${name} has an unknown tag ${unknown[0]} (known: ${REQUIRED_TAGS.join(', ')}).`,
			);
		}
	}
	const required = requiredLines.map(([name]) => name);
	const tagged = (tag) => new Set(requiredLines.filter(([, ...tags]) => tags.includes(tag)).map(([name]) => name));
	const serverOnly = tagged('server-only');

	/** @type {Record<string, Project>} */
	const projects = {};
	for (const project of json.projects) {
		if (TIERS.includes(project.tier))
			projects[project.tier] = {
				name: project.name,
				environment: project.environment,
				projectId: project.projectId,
				deployIdentityId: project.deployIdentityId ?? null,
			};
		if (project.deployIdentityId !== undefined && !/^[0-9a-f-]{36}$/.test(project.deployIdentityId)) {
			throw new SecretsError(`variable-names.json: ${project.tier}'s deployIdentityId is not an id.`);
		}
	}
	for (const tier of TIERS) {
		if (!projects[tier]) throw new SecretsError(`variable-names.json has no project for ${tier}.`);
	}

	return {
		projects,
		api: new Set([...json.apiVariables, ...json.developmentOnlyApiVariables]),
		developmentOnly: new Set(json.developmentOnlyApiVariables),
		composeProvided: new Set(json.composeProvidedApiVariables ?? []),
		requiredForRelease: required,
		serverOnlyRequired: serverOnly,
		mayDeployBlank: tagged('may-deploy-blank'),
		releaseWritten: new Set(json.releaseWrittenApiVariables ?? []),
		backup: json.backupVariables,
		infrastructureFiles: json.infrastructureSecretFileNames,
		certificateFiles: json.certificateFileNames ?? [],
		derivedFiles: json.derivedSecretFiles ?? {},
		deployment: json.deploymentVariables,
		derivedDeployment: json.derivedDeploymentVariables ?? {},
		otherFolders: otherFolders(json, new Set([...json.apiVariables, ...json.developmentOnlyApiVariables])),
	};
}

/**
 * Folders kept in Infisical for something other than the shop, such as the Release Console's keys.
 * The renderer never reads them; `pnpm secrets:status` reports them and the names check confirms
 * the code named in `readBy` reads every name.
 * @param {Record<string, any>} json
 * @param {Set<string>} apiNames
 * @returns {OtherFolder[]}
 */
function otherFolders(json, apiNames) {
	const seen = new Set();
	return Object.entries(json.otherFolders ?? {}).map(([folder, group]) => {
		if (FOLDERS.includes(folder))
			throw new SecretsError(`otherFolders may not reuse the shop's folder /${folder}.`);
		const tiers = new Set(group.projects ?? []);
		for (const tier of tiers) {
			if (!TIERS.includes(tier))
				throw new SecretsError(`otherFolders.${folder} names an unknown project: ${tier}.`);
		}
		if (typeof group.readBy !== 'string' || group.readBy === '') {
			throw new SecretsError(`otherFolders.${folder} needs readBy: the code folder that reads its names.`);
		}
		const names = [...(group.names ?? [])];
		for (const name of names) {
			if (apiNames.has(name) || seen.has(name)) {
				throw new SecretsError(`${name} is listed twice in variable-names.json (otherFolders.${folder}).`);
			}
			seen.add(name);
		}
		const optional = new Set(group.optional ?? []);
		for (const name of optional) {
			if (!names.includes(name))
				throw new SecretsError(`otherFolders.${folder}.optional lists ${name}, not one of its names.`);
		}
		/** @type {string[][]} */
		const oneOf = group.oneOf ?? [];
		const inSets = new Set();
		for (const set of oneOf) {
			if (!Array.isArray(set) || set.length < 2) {
				throw new SecretsError(`otherFolders.${folder}.oneOf needs sets of two names or more.`);
			}
			for (const name of set) {
				if (!names.includes(name) || optional.has(name) || inSets.has(name)) {
					throw new SecretsError(
						`otherFolders.${folder}.oneOf lists ${name}, which is not one of its names, is optional, or is in another set.`,
					);
				}
				inSets.add(name);
			}
		}
		return { folder, tiers, readBy: group.readBy, names, optional, oneOf };
	});
}

/**
 * The names each folder may hold.
 * @param {Inventory} inventory
 * @returns {Record<string, Set<string>>}
 */
export function folderNames(inventory) {
	return {
		api: inventory.api,
		backup: new Set(inventory.backup),
		infrastructure: new Set([...inventory.infrastructureFiles, ...inventory.certificateFiles]),
		deployment: new Set(inventory.deployment),
	};
}
