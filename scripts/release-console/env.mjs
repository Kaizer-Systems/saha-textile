/**
 * `pnpm console:env`: writes the Release Console's key file from Infisical, as the owner's own CLI
 * login (no machine identity). Folder `/release-console` of the dev project only (owner decision,
 * 20 Nov 2026). Prints names only, never a value. When Infisical cannot be read, the last file is
 * kept and said so.
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readIfPresent, parseEnvText, replaceFile } from '../secrets/files.mjs';
import { CACHE_NOTE, exportFolder } from '../secrets/infisical.mjs';
import { ROOT, SecretsError, describeError, loadInventory } from '../secrets/inventory.mjs';
import { isBlank, renderEnvFile } from '../secrets/render.mjs';

export const CONSOLE_FOLDER = 'release-console';
export const CONSOLE_ENV_DIR = 'docker/release-console/env';
export const CONSOLE_ENV_FILE = `${CONSOLE_ENV_DIR}/console.env`;
/** Every key the console reads; the two change keys are made later and may stay blank. */
export const CONSOLE_KEY_NAMES = [
	'CONSOLE_CF_READ_TOKEN',
	'CONSOLE_CF_WRITE_TOKEN',
	'CONSOLE_DO_READ_TOKEN',
	'CONSOLE_DO_WRITE_TOKEN',
	'CONSOLE_GITHUB_TOKEN',
	'CONSOLE_OPS_TOKEN_DEV',
	'CONSOLE_OPS_TOKEN_LOCAL',
	'CONSOLE_OPS_TOKEN_PRODUCTION',
	'CONSOLE_OPS_TOKEN_STAGING',
	'CONSOLE_SPACES_ACCESS_KEY',
	'CONSOLE_SPACES_SECRET_KEY',
	'GOOGLE_SEARCH_CONSOLE_KEY',
];
export const OPTIONAL_NAMES = new Set([
	'CONSOLE_CF_WRITE_TOKEN',
	'CONSOLE_DO_WRITE_TOKEN',
	'CONSOLE_OPS_TOKEN_DEV',
	'CONSOLE_OPS_TOKEN_LOCAL',
	'CONSOLE_OPS_TOKEN_PRODUCTION',
	'CONSOLE_OPS_TOKEN_STAGING',
	'GOOGLE_SEARCH_CONSOLE_KEY',
]);
/** Pairs where either key will do: the console reads with the change key when there is no read key. */
export const EITHER_ONE = [
	['CONSOLE_DO_READ_TOKEN', 'CONSOLE_DO_WRITE_TOKEN'],
	['CONSOLE_CF_READ_TOKEN', 'CONSOLE_CF_WRITE_TOKEN'],
];

/** Names the console still needs: a pair counts as present when either of its keys is filled. */
export function missingNames(names) {
	const has = new Set(names);
	return CONSOLE_KEY_NAMES.filter((n) => {
		if (has.has(n) || OPTIONAL_NAMES.has(n)) return false;
		const pair = EITHER_ONE.find((p) => p.includes(n));
		return !(pair && pair.some((m) => has.has(m)));
	});
}

/**
 * Builds the file text and a names-only report from one folder's values.
 * @param {Map<string, string>} values
 * @param {{ source: string }} options
 */
export function buildConsoleEnv(values, { source }) {
	const filled = [...values].filter(([, v]) => !isBlank(v)).sort(([a], [b]) => (a < b ? -1 : 1));
	const text = renderEnvFile(filled, {
		header: [
			'Release Console keys. Written by pnpm console:env; do not edit by hand.',
			`From ${source}. Readable by the owner only; never served, mounted read-only in Docker.`,
		],
	});
	const names = filled.map(([name]) => name);
	const missing = missingNames(names);
	const optionalBlank = CONSOLE_KEY_NAMES.filter((n) => !names.includes(n) && !missing.includes(n));
	const extra = names.filter((n) => !CONSOLE_KEY_NAMES.includes(n));
	return { text, names, missing, optionalBlank, extra };
}

/**
 * @param {{ root?: string, project?: import('../secrets/inventory.mjs').Project, read?: () => Map<string, string>, notes?: Set<string> }} [options]
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function writeConsoleEnv({
	root = ROOT,
	project = loadInventory().projects.local,
	read,
	notes = new Set(),
} = {}) {
	const path = join(root, CONSOLE_ENV_FILE);
	const source = `Infisical ${project.name} (${project.environment}), folder /${CONSOLE_FOLDER}`;
	let values;
	try {
		values = (
			read ??
			(() =>
				exportFolder({
					projectId: project.projectId,
					environment: project.environment,
					folder: CONSOLE_FOLDER,
					notes,
				}))
		)();
	} catch (error) {
		const previous = readIfPresent(path);
		const reason = describeError(error);
		if (previous === null)
			return {
				ok: false,
				lines: [
					`Infisical could not be read, and there is no earlier key file. Nothing was written.`,
					`  ${reason}`,
				],
			};
		const kept = [...parseEnvText(previous).keys()].sort();
		const when = statSync(path).mtime.toISOString().slice(0, 16).replace('T', ' ');
		return {
			ok: true,
			lines: [
				`Infisical could not be read, so the key file from ${when} UTC is kept (${kept.length} names).`,
				`  ${reason}`,
			],
		};
	}
	const built = buildConsoleEnv(values, { source });
	mkdirSync(join(root, CONSOLE_ENV_DIR), { recursive: true, mode: 0o700 });
	replaceFile(path, built.text, 0o600);
	const lines = [`Wrote ${CONSOLE_ENV_FILE} from ${source}: ${built.names.length} names.`];
	if (built.names.length) lines.push(`  Filled: ${built.names.join(', ')}`);
	if (built.missing.length) lines.push(`  Not in Infisical yet: ${built.missing.join(', ')}`);
	if (built.optionalBlank.length) lines.push(`  Optional, blank: ${built.optionalBlank.join(', ')}`);
	if (built.extra.length)
		lines.push(`  Also in the folder (linked by name on Connections): ${built.extra.join(', ')}`);
	if (notes.has(CACHE_NOTE)) lines.push(`  ${CACHE_NOTE}`);
	lines.push('The console reads the new file at once; no restart needed.');
	return { ok: true, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const { ok, lines } = writeConsoleEnv();
		for (const line of lines) console.log(line);
		process.exitCode = ok ? 0 : 1;
	} catch (error) {
		console.error(error instanceof SecretsError ? error.message : describeError(error));
		process.exitCode = 1;
	}
}
