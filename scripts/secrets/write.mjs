/**
 * Write-only secret updates for the Release Console's Secrets screen (owner, 2026-11-20: "Yes, build
 * it", with changes queued as drafts and saved together behind one PIN). The console collects the
 * batch; this module writes it. A value is never shown, logged, returned or put on a command line:
 * each one goes into a private file that the CLI reads (`NAME=@file`), and the files are deleted
 * straight after. Infisical Free keeps no history, so a write replaces the old value for good.
 *
 * The whole batch is checked before anything is written: only names the inventory lists for that
 * tier and folder, and no empty value. Then one CLI call per tier and folder.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { folderNames, SecretsError } from './inventory.mjs';

/** @typedef {{ tier: 'dev' | 'development' | 'staging' | 'production', folder: string, name: string, value: string }} SecretChange */

/**
 * The names a tier's folder may hold: the shop's four folders, or that tier's other folders.
 * @param {import('./inventory.mjs').Inventory} inventory
 * @param {string} tier
 * @param {string} folder
 * @returns {Set<string> | null}  null for a folder this tier does not hold
 */
export function writableNames(inventory, tier, folder) {
	const shop = folderNames(inventory);
	if (Object.hasOwn(shop, folder)) return shop[folder];
	const group = inventory.otherFolders.find((candidate) => candidate.folder === folder && candidate.tiers.has(tier));
	return group ? new Set(group.names) : null;
}

/**
 * Every problem in a batch, by name only. Nothing is written while any remain.
 * @param {SecretChange[]} changes
 * @param {import('./inventory.mjs').Inventory} inventory
 */
export function checkChanges(changes, inventory) {
	const problems = [];
	const seen = new Set();
	if (!Array.isArray(changes) || changes.length === 0) return ['There is nothing to save.'];
	for (const change of changes) {
		const where = `${change?.tier}/${change?.folder}/${change?.name}`;
		if (!inventory.projects[change?.tier]) {
			problems.push(`${where}: unknown project.`);
			continue;
		}
		const names = writableNames(inventory, change.tier, change.folder);
		if (names === null) problems.push(`${where}: the ${change.tier} project holds no /${change.folder} folder.`);
		else if (!names.has(change.name)) problems.push(`${where}: not a name the inventory lists for this folder.`);
		if (typeof change.value !== 'string' || change.value.trim() === '')
			problems.push(`${where}: the value is empty.`);
		else if (change.value.includes('\0')) problems.push(`${where}: the value holds a NUL character.`);
		if (seen.has(where)) problems.push(`${where}: changed twice in one batch.`);
		seen.add(where);
	}
	return problems;
}

/**
 * Writes a checked batch: one `infisical secrets set` per tier and folder. Returns names-only results.
 * @param {SecretChange[]} changes
 * @param {{ inventory: import('./inventory.mjs').Inventory, run?: typeof spawnSync, env?: NodeJS.ProcessEnv }} options
 * @returns {{ tier: string, folder: string, names: string[], saved: boolean, error?: string }[]}
 */
export function applySecretChanges(changes, { inventory, run = spawnSync, env = process.env }) {
	const problems = checkChanges(changes, inventory);
	if (problems.length > 0)
		throw new SecretsError(`Nothing was saved:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
	/** @type {Map<string, SecretChange[]>} */
	const groups = new Map();
	for (const change of changes) {
		const key = `${change.tier}\u0000${change.folder}`;
		groups.set(key, [...(groups.get(key) ?? []), change]);
	}
	const results = [];
	for (const group of groups.values()) {
		const { tier, folder } = group[0];
		const project = inventory.projects[tier];
		const names = group.map((change) => change.name);
		const dir = mkdtempSync(join(tmpdir(), 'secrets-write-'));
		try {
			const pairs = group.map((change, index) => {
				const file = join(dir, String(index));
				writeFileSync(file, change.value, { mode: 0o600, flag: 'wx' });
				return `${change.name}=@${file}`;
			});
			const result = run(
				'infisical',
				[
					'secrets',
					'set',
					...pairs,
					'--projectId',
					project.projectId,
					'--env',
					project.environment,
					'--path',
					`/${folder}`,
					'--silent',
				],
				{ env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 },
			);
			results.push(
				result.status === 0
					? { tier, folder, names, saved: true }
					: {
							tier,
							folder,
							names,
							saved: false,
							error: `Infisical refused the save (exit ${result.status}).`,
						},
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	return results;
}
