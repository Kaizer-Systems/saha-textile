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

/** The three deployment tiers, each with its own Infisical project (owner decision 2026-11-17). */
export const TIERS = ['dev', 'staging', 'production'];

/** The Infisical folders every project uses. */
export const FOLDERS = ['api', 'backup', 'infrastructure', 'deployment'];

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
 *
 * @typedef {object} Inventory
 * @property {Record<string, Project>} projects       keyed by tier
 * @property {Set<string>} api                       every API setting name, development-only ones included
 * @property {Set<string>} developmentOnly           never sent to a release
 * @property {Set<string>} composeProvided           set by Compose in a release, so left out of `api.env`
 * @property {string[]} requiredForRelease           `required-secrets.txt`
 * @property {string[]} backup
 * @property {string[]} infrastructureFiles          stored whole in `/infrastructure`
 * @property {Record<string, string>} derivedFiles   secret file name → the `/api` setting it is written from
 * @property {string[]} deployment
 */

/**
 * @param {string} [root]
 * @returns {Inventory}
 */
export function loadInventory(root = ROOT) {
	const json = JSON.parse(readFileSync(join(root, 'docker/infisical/variable-names.json'), 'utf8'));
	const required = readFileSync(join(root, 'docker/production/required-secrets.txt'), 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'));

	/** @type {Record<string, Project>} */
	const projects = {};
	for (const project of json.projects) {
		const tier = TIERS.find((candidate) => project.name === `saha-textile-${candidate}`);
		if (tier)
			projects[tier] = { name: project.name, environment: project.environment, projectId: project.projectId };
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
		backup: json.backupVariables,
		infrastructureFiles: json.infrastructureSecretFileNames,
		derivedFiles: json.derivedSecretFiles ?? {},
		deployment: json.deploymentVariables,
	};
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
		infrastructure: new Set(inventory.infrastructureFiles),
		deployment: new Set(inventory.deployment),
	};
}
