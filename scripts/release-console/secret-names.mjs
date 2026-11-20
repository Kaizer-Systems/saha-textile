/**
 * The Release Console's Secrets screen data: for every tier (dev, staging, production) and folder,
 * which names are set, empty or missing in Infisical. Run by the Mac helper in its own process,
 * because the Infisical CLI calls block. Values are dropped inside `listFolderNames`; this prints
 * names and states only, as one JSON object on stdout.
 */
import { pathToFileURL } from 'node:url';

import { describeError, folderNames, loadInventory, TIERS } from '../secrets/inventory.mjs';
import { listFolderNames, secretsScreenPlan } from '../secrets/listing.mjs';

/**
 * @typedef {'set' | 'empty' | 'missing' | 'not-here' | 'unknown'} CellState
 */

/**
 * @param {ReturnType<typeof loadInventory>} inventory
 * @param {(o: { projectId: string, environment: string, folder: string }) => { name: string, empty: boolean }[]} list
 */
export function secretsMatrix(inventory, list = listFolderNames) {
	const plan = secretsScreenPlan(inventory);
	const expectedOf = { ...folderNames(inventory) };
	const tiersOf = {};
	/** Names that may stay empty: optional, or one of an either-one set. */
	const optional = new Set();
	for (const group of inventory.otherFolders) {
		expectedOf[group.folder] = new Set(group.names);
		tiersOf[group.folder] = group.tiers;
		for (const name of group.optional) optional.add(name);
		for (const set of group.oneOf) for (const name of set) optional.add(name);
	}
	/** @type {{ tier: string, folder: string, message: string }[]} */
	const errors = [];
	/** @type {Record<string, Record<string, Map<string, boolean> | null>>} */
	const read = {};
	for (const p of plan) {
		read[p.tier] = {};
		for (const folder of p.folders) {
			try {
				const rows = list({ projectId: p.projectId, environment: p.environment, folder });
				read[p.tier][folder] = new Map(rows.map((r) => [r.name, r.empty]));
			} catch (error) {
				read[p.tier][folder] = null;
				errors.push({ tier: p.tier, folder, message: describeError(error) });
			}
		}
	}
	const folders = [...new Set(plan.flatMap((p) => p.folders))];
	return {
		at: new Date().toISOString(),
		tiers: plan.map((p) => ({ tier: p.tier, project: p.project, environment: p.environment })),
		folders: folders.map((folder) => {
			const expected = expectedOf[folder] ?? new Set();
			const names = new Set(expected);
			for (const tier of TIERS) for (const name of read[tier]?.[folder]?.keys() ?? []) names.add(name);
			return {
				folder,
				rows: [...names].sort().map((name) => ({
					name,
					expected: expected.has(name),
					devOnly: inventory.developmentOnly.has(name),
					optional: optional.has(name),
					cells: Object.fromEntries(
						TIERS.map((tier) => {
							const here = folder in (read[tier] ?? {});
							const values = read[tier]?.[folder];
							/** @type {CellState} */
							let state;
							if (!here || (tiersOf[folder] && !tiersOf[folder].has(tier))) state = 'not-here';
							else if (values === null || values === undefined) state = 'unknown';
							else if (!values.has(name))
								state = tier !== 'dev' && inventory.developmentOnly.has(name) ? 'not-here' : 'missing';
							else state = values.get(name) ? 'empty' : 'set';
							return [tier, state];
						}),
					),
				})),
			};
		}),
		errors,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.stdout.write(JSON.stringify(secretsMatrix(loadInventory())));
	} catch (error) {
		process.stdout.write(JSON.stringify({ error: describeError(error) }));
		process.exitCode = 1;
	}
}
