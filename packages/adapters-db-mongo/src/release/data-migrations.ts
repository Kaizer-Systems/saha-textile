import type { DataMigration } from '@saha-textile/core-domain';

import { seedLegalPages } from '../migrations/legal-pages';
import { giveMailboxAccessRights } from '../migrations/mailbox-rights';
import {
	addCardWidth600,
	addProfileSizes,
	seedProfilesAndNameVersions,
	widenProfileTypes,
} from '../migrations/media-versions';
import { seedTodaysHomePage } from '../migrations/todays-home-page';

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
	{
		id: '0003-legal-pages',
		description:
			'Legal pages (Legal Pages brief): the four pages, exactly as the shop showed them, written once into the database; a stored page is never overwritten',
		half: 'expand',
		up: () => seedLegalPages(),
	},
	{
		id: '0004-media-photo-types',
		description:
			'Photo types (media step 5): built-in image profiles still taking only JPEG and PNG take every type the worker reads; a list an admin changed stays',
		half: 'expand',
		up: () => widenProfileTypes(),
	},
	{
		id: '0005-page-builder-todays-home',
		description:
			'Page Builder (step 2): Home’s first layout, “Today’s home page”, made from today’s live home banners and fixed sections and put on Home’s schedule; the shop keeps its fixed home page until the builder’s renderer is switched on',
		half: 'expand',
		up: () => seedTodaysHomePage(),
	},
	{
		id: '0006-media-card-600',
		description:
			'Product-card size (shop speed round 4): built-in image profiles still on the seeded card sizes gain a 600 px size and a new version, so "Bring older versions up to date" adds it to existing photos; sizes an admin changed stay',
		half: 'expand',
		up: () => addCardWidth600(),
	},
	{
		id: '0007-mailbox-rights',
		description:
			'Mailbox rights (admin Inbox upgrade): each access row gets its seven-right list; Read stays Read, Read-and-send becomes Read, Send, Organise and Bin; nobody gains Delete forever, Labels or Settings',
		half: 'expand',
		up: () => giveMailboxAccessRights(),
	},
];
