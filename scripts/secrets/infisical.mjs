/**
 * Reads one folder of one Infisical project through the Infisical CLI (`infisical export`).
 *
 * The CLI signs in as whoever ran `infisical login` on this Mac, or with a token in
 * `INFISICAL_TOKEN` (a deploy job's short-lived token). Values pass from the CLI's standard output
 * straight into memory: they are never printed, and an error never repeats that output.
 */
import { spawnSync } from 'node:child_process';

import { SecretsError } from './inventory.mjs';

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
	return line ? ` Infisical said: ${line.slice(0, 200)}` : '';
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.environment   the environment slug: dev, staging or prod
 * @param {string} options.folder        api, backup, infrastructure or deployment
 * @param {typeof spawnSync} [options.run]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Map<string, string>}
 */
export function exportFolder({ projectId, environment, folder, run = spawnSync, env = process.env }) {
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
	const result = run('infisical', args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
	if (result.error) {
		if (/** @type {NodeJS.ErrnoException} */ (result.error).code === 'ENOENT') {
			throw new SecretsError(
				'The Infisical CLI is not installed. Install it with: brew install infisical/get-cli/infisical',
			);
		}
		throw new SecretsError(`The Infisical CLI could not start (${result.error.message}).`);
	}
	if (result.status !== 0) {
		throw new SecretsError(
			`Infisical could not read /${folder} (exit ${result.status}). Sign in with: infisical login.${lastLine(String(result.stderr ?? ''))}`,
		);
	}
	return parseExport(String(result.stdout));
}

/**
 * All four folders of one project.
 * @param {import('./inventory.mjs').Project} project
 * @param {{ run?: typeof spawnSync, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Record<string, Map<string, string>>}
 */
export function exportProject(project, { run, env } = {}) {
	/** @type {Record<string, Map<string, string>>} */
	const folders = {};
	for (const folder of ['api', 'backup', 'infrastructure', 'deployment']) {
		folders[folder] = exportFolder({
			projectId: project.projectId,
			environment: project.environment,
			folder,
			run,
			env,
		});
	}
	return folders;
}
