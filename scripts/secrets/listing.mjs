/**
 * Names-only listing for the Release Console's Secrets screen (owner, 2026-11-20: "Yes, all
 * recommended"). Values are read by the CLI, as for every other command here, and dropped inside
 * this module: nothing it returns can hold a value. The CLI's outputs carry no date (`export`:
 * key, value, type, path, tags, comment; `secrets -o json`: key and value), so `updatedAt` is null
 * and the screen says the date is not known.
 */
import { exportFolder } from './infisical.mjs';
import { FOLDERS, TIERS } from './inventory.mjs';
import { isBlank } from './render.mjs';

/**
 * @typedef {{ name: string, updatedAt: string | null, empty: boolean }} NameRow
 */

/**
 * One folder of one project, as names. Uses the CLI's current login (the owner's, or a deploy
 * identity's INFISICAL_TOKEN).
 * @param {{ projectId: string, environment: string, folder: string, notes?: Set<string>, read?: typeof exportFolder }} options
 * @returns {NameRow[]}
 */
export function listFolderNames({ projectId, environment, folder, notes, read = exportFolder }) {
	const values = read({ projectId, environment, folder, notes });
	return [...values]
		.map(([name, value]) => ({ name, updatedAt: null, empty: isBlank(value) }))
		.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * What the Secrets screen lists: for each tier, its project and environment, the four shop folders
 * and the other folders that tier holds (variable-names.json `otherFolders`).
 * @param {import('./inventory.mjs').Inventory} inventory
 */
export function secretsScreenPlan(inventory) {
	return TIERS.map((tier) => {
		const project = inventory.projects[tier];
		return {
			tier,
			project: project.name,
			projectId: project.projectId,
			environment: project.environment,
			folders: [
				...FOLDERS,
				...inventory.otherFolders.filter((group) => group.tiers.has(tier)).map((group) => group.folder),
			],
		};
	});
}
