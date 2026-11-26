/**
 * Reading and replacing the local env files that `pnpm secrets:pull` and `pnpm stack:env` keep.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { ROOT } from './inventory.mjs';

/** @type {{ parse(text: string): Record<string, string> } | undefined} */
let dotenv;

/**
 * Parses env text with the API's own dotenv, so a file is read exactly the way the API will read it.
 * dotenv is loaded here, on first use, not when this module is imported: the deploy job runs
 * `cli.mjs release` in a bare checkout with no packages installed, and that command never parses
 * an env file (tier-release.mjs reads its images file itself).
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseEnvText(text) {
	dotenv ??= createRequire(join(ROOT, 'apps/api/package.json'))('dotenv');
	return new Map(Object.entries(/** @type {NonNullable<typeof dotenv>} */ (dotenv).parse(text)));
}

/**
 * The file's text, or null when there is none.
 * @param {string} path
 */
export function readIfPresent(path) {
	return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Replaces a file in one step: a reader sees the old file or the new one, never half of either.
 * @param {string} path
 * @param {string} text
 * @param {number} mode
 */
export function replaceFile(path, text, mode) {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, text, { mode, flag: 'w' });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
