/**
 * The Release Console's Secrets screen data for ONE tier (owner, 20 Nov: each console environment
 * shows only its own Infisical project and environment, read only when that tab is open): which
 * names are set, empty or missing in each of that tier's folders. Run by the Mac helper in its own
 * process, because the Infisical CLI calls block. Values are dropped inside `listFolderNames`; this
 * prints names and states only, as one JSON object on stdout.
 *
 *   node scripts/release-console/secret-names.mjs --tier dev|staging|production
 */
import { pathToFileURL } from 'node:url';

import { describeError, folderNames, loadInventory, SecretsError, TIERS } from '../secrets/inventory.mjs';
import { listFolderNames, secretsScreenPlan } from '../secrets/listing.mjs';
import { writableNames } from '../secrets/write.mjs';

/**
 * @typedef {'set' | 'empty' | 'missing' | 'unknown'} State
 */

/**
 * @param {ReturnType<typeof loadInventory>} inventory
 * @param {string} tier
 * @param {(o: { projectId: string, environment: string, folder: string }) => { name: string, empty: boolean }[]} list
 */
export function tierSecrets(inventory, tier, list = listFolderNames) {
	const plan = secretsScreenPlan(inventory).find((p) => p.tier === tier);
	if (!plan) throw new SecretsError(`Unknown tier: ${tier}. Use one of ${TIERS.join(', ')}.`);
	const expectedOf = { ...folderNames(inventory) };
	/** Names that may stay empty: optional, or one of an either-one set. */
	const optional = new Set();
	for (const group of inventory.otherFolders) {
		expectedOf[group.folder] = new Set(group.names);
		for (const name of group.optional) optional.add(name);
		for (const set of group.oneOf) for (const name of set) optional.add(name);
	}
	/** @type {{ folder: string, message: string }[]} */
	const errors = [];
	return {
		at: new Date().toISOString(),
		tier,
		project: plan.project,
		environment: plan.environment,
		folders: plan.folders.map((folder) => {
			/** @type {Map<string, boolean> | null} */
			let values = null;
			try {
				const rows = list({ projectId: plan.projectId, environment: plan.environment, folder });
				values = new Map(rows.map((r) => [r.name, r.empty]));
			} catch (error) {
				errors.push({ folder, message: describeError(error) });
			}
			const expected = [...(expectedOf[folder] ?? [])].filter(
				(name) => tier === 'dev' || !inventory.developmentOnly.has(name),
			);
			const names = new Set([...expected, ...(values?.keys() ?? [])]);
			const writable = writableNames(inventory, tier, folder) ?? new Set();
			return {
				folder,
				rows: [...names].sort().map((name) => {
					/** @type {State} */
					let state;
					if (values === null) state = 'unknown';
					else if (!values.has(name)) state = 'missing';
					else state = values.get(name) ? 'empty' : 'set';
					return {
						name,
						expected: expected.includes(name),
						devOnly: inventory.developmentOnly.has(name),
						optional: optional.has(name),
						/** Only names the inventory lists for this folder can take a new value. */
						writable: writable.has(name),
						state,
					};
				}),
			};
		}),
		errors,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const at = process.argv.indexOf('--tier');
		const tier = at >= 0 ? (process.argv[at + 1] ?? '') : '';
		process.stdout.write(JSON.stringify(tierSecrets(loadInventory(), tier)));
	} catch (error) {
		process.stdout.write(JSON.stringify({ error: describeError(error) }));
		process.exitCode = 1;
	}
}
