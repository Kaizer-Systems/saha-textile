/**
 * The Release Console's Secrets screen data for ONE environment's place (owner, 20 Nov: each console
 * environment shows only its own Infisical project and environment, read only when that tab is open,
 * from that environment's own "reads secrets from" setting): which names are set, empty or missing in
 * each folder. A place whose project and environment are one of the name list's tiers gets the
 * expected names, the missing check and writable rows; any other place is read only, names as found.
 * Run by the Mac helper in its own process, because the Infisical CLI calls block. Values are dropped
 * inside `listFolderNames`; this prints names and states only, as one JSON object on stdout.
 *
 *   node scripts/release-console/secret-names.mjs --project saha-textile-dev --environment dev [--folder /api]
 */
import { pathToFileURL } from 'node:url';

import { describeError, folderNames, loadInventory, SecretsError, TIERS } from '../secrets/inventory.mjs';
import { listFolderNames, secretsScreenPlan } from '../secrets/listing.mjs';
import { writableNames } from '../secrets/write.mjs';
import { findProject, subfolders } from './infisical-places.mjs';

/**
 * @typedef {'set' | 'empty' | 'missing' | 'unknown'} State
 */

/**
 * @param {ReturnType<typeof loadInventory>} inventory
 * @param {string} tier
 * @param {(o: { projectId: string, environment: string, folder: string }) => { name: string, empty: boolean }[]} list
 * @param {(folder: string) => boolean} [keep]  which of the tier's folders to read; all by default
 */
export function tierSecrets(inventory, tier, list = listFolderNames, keep = () => true) {
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
		folders: plan.folders.filter(keep).map((folder) => {
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

/**
 * @typedef {{ project: string, environment: string, folder: string }} Place
 */

/** Whether folder `folder` (`api`, `backend/api`) sits at or inside the place's folder (`/`, `/api`). */
export function inside(place, folder) {
	const path = `/${folder}`;
	return place.folder === '/' || path === place.folder || path.startsWith(`${place.folder}/`);
}

/**
 * The name list's tier whose Infisical project and environment the place names, or `null`.
 * @param {ReturnType<typeof loadInventory>} inventory
 * @param {Place} place
 */
export function tierOfPlace(inventory, place) {
	return (
		TIERS.find((t) => {
			const p = inventory.projects[t];
			return (
				p && (p.name === place.project || p.projectId === place.project) && p.environment === place.environment
			);
		}) ?? null
	);
}

/**
 * One environment's place, as the Secrets screen shows it.
 * @param {ReturnType<typeof loadInventory>} inventory
 * @param {Place} place
 * @param {{ list?: typeof listFolderNames, project?: typeof findProject, folders?: typeof subfolders }} [io]
 */
export function placeSecrets(
	inventory,
	place,
	{ list = listFolderNames, project = findProject, folders = subfolders } = {},
) {
	const tier = tierOfPlace(inventory, place);
	if (tier) {
		const plan = secretsScreenPlan(inventory).find((p) => p.tier === tier);
		if (plan?.folders.some((f) => inside(place, f)))
			return { ...tierSecrets(inventory, tier, list, (f) => inside(place, f)), folder: place.folder };
	}
	// Not one of the name list's places (or a folder the name list does not cover): names as found.
	const found = tier
		? {
				id: inventory.projects[tier].projectId,
				name: inventory.projects[tier].name,
				environments: [place.environment],
			}
		: project(place.project);
	if (!found.environments.includes(place.environment))
		throw new SecretsError(
			`${found.name} has no environment ${place.environment}; it has ${found.environments.join(', ') || 'none'}.`,
		);
	/** @type {{ folder: string, message: string }[]} */
	const errors = [];
	const base = place.folder === '/' ? '' : place.folder.slice(1);
	const names = [base];
	try {
		const inner = folders({ projectId: found.id, environment: place.environment, folder: place.folder });
		names.push(...inner.map((n) => (base ? `${base}/${n}` : n)));
	} catch (error) {
		errors.push({ folder: base, message: describeError(error) });
	}
	const read = names.map((folder) => {
		try {
			const rows = list({ projectId: found.id, environment: place.environment, folder });
			return {
				folder,
				rows: rows.map((r) => ({
					name: r.name,
					expected: false,
					devOnly: false,
					optional: false,
					writable: false,
					/** @type {'set' | 'empty'} */
					state: r.empty ? 'empty' : 'set',
				})),
			};
		} catch (error) {
			errors.push({ folder, message: describeError(error) });
			return { folder, rows: [] };
		}
	});
	return {
		at: new Date().toISOString(),
		tier: null,
		project: found.name,
		environment: place.environment,
		folder: place.folder,
		// The place's own folder is left out when it holds no names and has folders inside it.
		folders: read.filter((f, i) => i > 0 || f.rows.length > 0 || read.length === 1),
		errors,
	};
}

/** The place from `--project`, `--environment` and `--folder` (default `/`). */
export function placeFromArgs(argv) {
	const arg = (flag) => {
		const at = argv.indexOf(flag);
		return at >= 0 ? (argv[at + 1] ?? '') : '';
	};
	const place = { project: arg('--project'), environment: arg('--environment'), folder: arg('--folder') || '/' };
	if (
		!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(place.project) ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/.test(place.environment) ||
		!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(place.folder)
	)
		throw new SecretsError('Give a place as --project <name> --environment <slug> [--folder /path].');
	return place;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.stdout.write(JSON.stringify(placeSecrets(loadInventory(), placeFromArgs(process.argv))));
	} catch (error) {
		process.stdout.write(JSON.stringify({ error: describeError(error) }));
		process.exitCode = 1;
	}
}
