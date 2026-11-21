/**
 * Mode 1, `pnpm dev` (owner decision L1, 2026-11-19): `apps/api/.env` is rewritten from the dev
 * project's `/api` folder, with `apps/api/.env.overrides` laid on top.
 *
 *   pnpm secrets:pull              refresh now; stops on anything that needs a person
 *   pnpm secrets:pull --dry-run    say which names would change, write nothing
 *   pnpm secrets:pull --replace    switch a hand-written file over even though Infisical lacks some
 *                                  of its settings (the file is kept as apps/api/.env.before-infisical)
 *   pnpm dev                       refreshes first (`--auto`): offline, signed out or refused, it
 *                                  says so in one line and the last copy is used
 *
 * The file stays where the ~20 API entry points, the tests and the stack scripts already read it.
 * Messages name settings and count them, never show a value.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvText, readIfPresent, replaceFile } from './files.mjs';
import { describeError } from './inventory.mjs';
import { buildDevEnv, planEnvFileChange } from './render.mjs';

export const DEV_ENV = 'apps/api/.env';
export const OVERRIDES = 'apps/api/.env.overrides';
export const PREVIOUS = 'apps/api/.env.previous';
export const BEFORE_INFISICAL = 'apps/api/.env.before-infisical';

/** The first line of a file this command wrote; anything else is a hand-written file. */
const WRITTEN_BY_PULL = '# Written by pnpm secrets:pull';

/** @param {string[]} names */
function listed(names) {
	return names.length > 0 ? ` (${names.join(', ')})` : '';
}

/** @param {ReturnType<typeof planEnvFileChange>} change */
export function describeChange(change) {
	const parts = [];
	if (change.added.length > 0) parts.push(`${change.added.length} added${listed(change.added)}`);
	if (change.removed.length > 0) parts.push(`${change.removed.length} removed${listed(change.removed)}`);
	if (change.changed.length > 0) parts.push(`${change.changed.length} changed${listed(change.changed)}`);
	parts.push(`${change.same} unchanged`);
	if (change.blankDropped > 0) parts.push(`${change.blankDropped} blank lines left out`);
	return `${parts.join('; ')}.`;
}

/**
 * @param {object} options
 * @param {string} options.root                     the repository root
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {() => Map<string, string>} options.readApi   reads the dev project's `/api` folder
 * @param {boolean} [options.auto]      the refresh before `pnpm dev`: a hand-written file is left alone
 * @param {boolean} [options.replace]
 * @param {boolean} [options.dryRun]
 * @returns {{ outcome: 'written' | 'unchanged' | 'kept' | 'dry-run', lines: string[] }}
 */
export function pullDevEnv({ root, inventory, readApi, auto = false, replace = false, dryRun = false }) {
	const project = inventory.projects.local;
	const source = `${project.name} (${project.environment})`;
	const envPath = join(root, DEV_ENV);
	const current = readIfPresent(envPath);
	const handWritten = current !== null && !current.startsWith(WRITTEN_BY_PULL);
	if (auto && handWritten) {
		return {
			outcome: 'kept',
			lines: [
				`${DEV_ENV} is still the hand-written copy, so it is used as it is. Run pnpm secrets:pull once to switch it to Infisical.`,
			],
		};
	}

	const overridesText = readIfPresent(join(root, OVERRIDES));
	const overrides = overridesText === null ? new Map() : parseEnvText(overridesText);
	const next = buildDevEnv(readApi(), { inventory, source, overrides });
	const notes = next.notes.map((note) => `  ${note}`);
	if (current === next.text) {
		return {
			outcome: 'unchanged',
			lines: [`${DEV_ENV} is up to date: ${next.names.length} settings from Infisical ${source}.`, ...notes],
		};
	}

	const currentValues = current === null ? null : parseEnvText(current);
	const change = planEnvFileChange(currentValues, parseEnvText(next.text));
	const summary = `  ${describeChange(change)}`;
	if (dryRun) {
		return {
			outcome: 'dry-run',
			lines: [
				`Dry run: ${DEV_ENV} would be rewritten from Infisical ${source}. Nothing was written.`,
				summary,
				...notes,
			],
		};
	}
	// A hand-written file may hold settings nobody has put in Infisical yet. Switching it over would
	// drop them silently, so the first switch stops and names them unless told to go ahead.
	const lost = change.removed;
	if (handWritten && lost.length > 0 && !replace) {
		return {
			outcome: 'kept',
			lines: [
				`${DEV_ENV} was not changed. It is hand-written and has settings that Infisical ${source} leaves blank or lacks:`,
				`  ${lost.join(', ')}`,
				`Fill them in Infisical (or put ones that are yours alone in ${OVERRIDES}), then run pnpm secrets:pull again.`,
				`To switch now anyway: pnpm secrets:pull --replace. Your current file is kept as ${BEFORE_INFISICAL}.`,
			],
		};
	}

	const lines = [`${DEV_ENV} rewritten from Infisical ${source}:`, summary];
	if (current !== null) {
		replaceFile(join(root, PREVIOUS), current, 0o600);
		lines.push(`  The previous copy is ${PREVIOUS}.`);
		if (handWritten && !existsSync(join(root, BEFORE_INFISICAL))) {
			writeFileSync(join(root, BEFORE_INFISICAL), current, { mode: 0o600, flag: 'wx' });
			lines.push(`  Your hand-written file is kept as ${BEFORE_INFISICAL}.`);
		}
	}
	replaceFile(envPath, next.text, 0o600);
	if (overrides.size > 0) lines.push(`  ${overrides.size} settings from ${OVERRIDES} laid on top.`);
	return { outcome: 'written', lines: [...lines, ...notes] };
}

/**
 * The refresh before `pnpm dev`. It never stops the run: offline, signed out, refused or failed, it
 * says why and the last copy of the file is used.
 * @param {Omit<Parameters<typeof pullDevEnv>[0], 'auto' | 'replace' | 'dryRun'>} options
 * @returns {ReturnType<typeof pullDevEnv>}
 */
export function refreshBeforeDev(options) {
	try {
		return pullDevEnv({ ...options, auto: true });
	} catch (error) {
		return { outcome: 'kept', lines: [`Using the last copy of ${DEV_ENV}. ${describeError(error)}`] };
	}
}
