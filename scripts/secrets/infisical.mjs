/**
 * Reads one folder of one Infisical project through the Infisical CLI (`infisical export`).
 *
 * The CLI signs in as whoever ran `infisical login` on this Mac, or with a token in
 * `INFISICAL_TOKEN` (a deploy job's short-lived token). Values pass from the CLI's standard output
 * straight into memory: they are never printed, and an error never repeats that output.
 */
import { spawnSync } from 'node:child_process';

import { SecretsError } from './inventory.mjs';

/** How long one folder may take. Offline, the CLI answers from its own cache well within this. */
export const EXPORT_TIMEOUT_MS = 30_000;

/** What the CLI (0.45) writes to standard error when it answers from its copy of the last read. */
const SERVED_FROM_CACHE = /serving secrets from last successful fetch/i;

/** Said when the CLI could not reach Infisical and answered from its own copy instead. */
export const CACHE_NOTE = 'Infisical could not be reached, so the CLI used its copy from the last successful read.';

/**
 * Turns `infisical export --format json` output into a Map. Accepts the array of `{ key, value }`
 * the CLI prints, and a plain `{ NAME: value }` object.
 * @param {string} stdout
 * @returns {Map<string, string>}
 */
export function parseExport(stdout) {
	let data;
	try {
		data = JSON.parse(stdout);
	} catch {
		throw new SecretsError('Infisical answered with something that is not JSON. Update the Infisical CLI.');
	}
	const values = new Map();
	if (Array.isArray(data)) {
		for (const item of data) {
			const key = item?.key ?? item?.secretKey;
			const value = item?.value ?? item?.secretValue;
			if (typeof key !== 'string' || typeof value !== 'string') {
				throw new SecretsError(
					'Infisical answered with an entry that has no name or value. Update the Infisical CLI.',
				);
			}
			// An identity allowed to list names but not to read values gets every value hidden. Taking
			// those as blank would quietly drop settings, so it stops here instead.
			if (item.secretValueHidden === true) {
				throw new SecretsError(
					`Infisical hid the value of ${key}: whoever is signed in may see names but not values. Give it read access to values.`,
				);
			}
			values.set(key, value);
		}
		return values;
	}
	if (data !== null && typeof data === 'object') {
		for (const [key, value] of Object.entries(data)) {
			if (typeof value !== 'string')
				throw new SecretsError(`Infisical answered with a non-text value for ${key}.`);
			values.set(key, value);
		}
		return values;
	}
	throw new SecretsError('Infisical answered with something that is not a list of settings.');
}

/**
 * The last line the CLI wrote to standard error, kept short. The CLI writes only its own messages
 * there ("not logged in", "project not found"), never a value.
 * @param {string | undefined} stderr
 */
function lastLine(stderr) {
	const line = (stderr ?? '')
		.split('\n')
		.map((text) => text.trim())
		.filter(Boolean)
		.pop();
	// The CLI names the signed-in account (an email address) in some messages; a deploy job's log is public.
	return line ? ` Infisical said: ${line.slice(0, 200).replace(/[^\s@]+@[^\s@]+/g, '<account>')}` : '';
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.environment   the environment slug: dev, staging or prod
 * @param {string} options.folder        api, backup, infrastructure or deployment
 * @param {typeof spawnSync} [options.run]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {Set<string>} [options.notes]  collects CACHE_NOTE when the CLI answered from its own copy
 * @returns {Map<string, string>}
 */
export function exportFolder({ projectId, environment, folder, run = spawnSync, env = process.env, notes }) {
	const args = [
		'export',
		'--projectId',
		projectId,
		'--env',
		environment,
		'--path',
		`/${folder}`,
		'--format',
		'json',
		'--silent',
	];
	const result = run('infisical', args, {
		encoding: 'utf8',
		env,
		maxBuffer: 16 * 1024 * 1024,
		timeout: EXPORT_TIMEOUT_MS,
	});
	if (result.error) {
		const { code } = /** @type {NodeJS.ErrnoException} */ (result.error);
		if (code === 'ENOENT') {
			throw new SecretsError(
				'The Infisical CLI is not installed. Install it with: brew install infisical/get-cli/infisical',
			);
		}
		if (code === 'ETIMEDOUT') {
			throw new SecretsError(`Infisical did not answer within ${EXPORT_TIMEOUT_MS / 1000} seconds.`);
		}
		throw new SecretsError(`The Infisical CLI could not start (${result.error.message}).`);
	}
	if (result.status !== 0) {
		throw new SecretsError(
			`Infisical could not read /${folder} (exit ${result.status}). Sign in with: infisical login.${lastLine(String(result.stderr ?? ''))}`,
		);
	}
	if (SERVED_FROM_CACHE.test(String(result.stderr ?? ''))) notes?.add(CACHE_NOTE);
	return parseExport(String(result.stdout));
}

/**
 * All four folders of one project.
 * @param {import('./inventory.mjs').Project} project
 * @param {{ run?: typeof spawnSync, env?: NodeJS.ProcessEnv, notes?: Set<string> }} [options]
 * @returns {Record<string, Map<string, string>>}
 */
export function exportProject(project, { run, env, notes } = {}) {
	/** @type {Record<string, Map<string, string>>} */
	const folders = {};
	for (const folder of ['api', 'backup', 'infrastructure', 'deployment']) {
		folders[folder] = exportFolder({
			projectId: project.projectId,
			environment: project.environment,
			folder,
			run,
			env,
			notes,
		});
	}
	return folders;
}
