/**
 * Read-only Infisical look-ups for the Release Console's Secrets screen when an environment's place
 * is not one of the name list's projects (owner, 20 Nov: each environment reads its own "reads
 * secrets from" setting): which project the place names, which environments that project has, and
 * which folders sit inside a folder. These CLI commands answer with names and ids only, never a
 * secret value. They use the CLI's current login, the owner's.
 */
import { spawnSync } from 'node:child_process';

import { SecretsError } from '../secrets/inventory.mjs';

export const LOOKUP_TIMEOUT_MS = 30_000;

/** The CLI's own message, short, with any account (email address) masked. */
function said(text) {
	const line = String(text ?? '')
		.split('\n')
		.map((t) => t.trim())
		.filter(Boolean)
		.pop();
	return line ? line.slice(0, 200).replace(/[^\s@]+@[^\s@]+/g, '<account>') : '';
}

/**
 * Runs one `infisical secrets-manager …` look-up with JSON output.
 * @param {string[]} args
 * @param {typeof spawnSync} run
 */
function lookUp(args, run) {
	const result = run('infisical', ['secrets-manager', ...args, '-o', 'json', '--silent'], {
		encoding: 'utf8',
		timeout: LOOKUP_TIMEOUT_MS,
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.error) {
		const { code } = /** @type {NodeJS.ErrnoException} */ (result.error);
		if (code === 'ENOENT')
			throw new SecretsError(
				'The Infisical CLI is not installed. Install it with: brew install infisical/get-cli/infisical',
			);
		if (code === 'ETIMEDOUT')
			throw new SecretsError(`Infisical did not answer within ${LOOKUP_TIMEOUT_MS / 1000} seconds.`);
		throw new SecretsError(`The Infisical CLI could not start (${result.error.message}).`);
	}
	/** @type {any} */
	let data = null;
	try {
		data = JSON.parse(String(result.stdout));
	} catch {
		data = null;
	}
	if (result.status !== 0 || data === null || data?.error) {
		const message = said(data?.error?.message) || said(result.stderr);
		throw new SecretsError(
			`Infisical refused the look-up${message ? `: ${message}` : ''}. If the login has expired, run: infisical login.`,
		);
	}
	return data;
}

/**
 * The project a place names, by name, slug or id, among the projects the login can open.
 * @param {string} wanted
 * @param {typeof spawnSync} [run]
 * @returns {{ id: string, name: string, environments: string[] }}
 */
export function findProject(wanted, run = spawnSync) {
	const list = lookUp(['projects', 'get'], run);
	if (!Array.isArray(list))
		throw new SecretsError(
			'Infisical answered with something that is not a list of projects. Update the Infisical CLI.',
		);
	const project = list.find((p) => p?.name === wanted || p?.slug === wanted || p?.id === wanted);
	if (!project) throw new SecretsError(`Your Infisical login can open no project named ${wanted}.`);
	return {
		id: String(project.id),
		name: String(project.name),
		environments: (Array.isArray(project.environments) ? project.environments : [])
			.map((e) => String(e?.slug ?? ''))
			.filter(Boolean),
	};
}

/**
 * The folders directly inside `folder` (`/` or `/api`), by name, sorted.
 * @param {{ projectId: string, environment: string, folder: string }} where
 * @param {typeof spawnSync} [run]
 * @returns {string[]}
 */
export function subfolders({ projectId, environment, folder }, run = spawnSync) {
	const list = lookUp(['folders', 'get', '--projectId', projectId, '--env', environment, '--path', folder], run);
	if (!Array.isArray(list))
		throw new SecretsError(
			'Infisical answered with something that is not a list of folders. Update the Infisical CLI.',
		);
	return list
		.map((f) => String(f?.name ?? ''))
		.filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
		.sort();
}

/**
 * `owner/name` from a Git remote address (https or ssh), or `null`.
 * @param {string} remote
 */
export function repositoryOf(remote) {
	const match = /[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
	return match ? `${match[1]}/${match[2]}` : null;
}
