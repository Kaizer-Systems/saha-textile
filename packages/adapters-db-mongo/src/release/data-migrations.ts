import type { DataMigration } from '@saha-textile/core-domain';

import { addProfileSizes, seedProfilesAndNameVersions } from '../migrations/media-versions';

/**
 * Every data migration, in id order. The release-steps runner applies each one once per
 * database and records it in `releaseMigrations`.
 *
 * Rules for adding one:
 * - id `NNNN-short-name`, next number, never renamed after release;
 * - `expand` first (add the new shape, keep the old, so a rollback still reads the data), then a
 *   later release's `contract` removes the old shape;
 * - `up()` must be safe on a database where it already ran, and says how many records it touched.
 *
 * The scripts that ran by hand before this ledger existed (`align:collections`,
 * `split:admin-users`, `rename:admin-user-permissions`, `extract:credentials`,
 * `migrate:french-to-bengali`, `align:filter-values`, `ratings:recompute`) are not listed: no
 * deployed database exists yet and the first one is built by first-run setup, so none of them
 * has a server database to convert.
 */
export const DATA_MIGRATIONS: readonly DataMigration[] = [
	{
		id: '0001-media-profiles-and-versions',
		description:
			'Image profiles (media step 2): the starting profiles, and every photo’s files named under the version they already are; nothing is remade',
		half: 'expand',
		up: () => seedProfilesAndNameVersions(),
	},
	{
		id: '0002-media-profile-sizes',
		description:
			'Image profiles (media step 2c): each stored profile gets its sizes and quality, so Settings can edit them',
		half: 'expand',
		up: () => addProfileSizes(),
	},
];
