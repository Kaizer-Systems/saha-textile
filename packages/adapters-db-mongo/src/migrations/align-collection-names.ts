import type mongoose from 'mongoose';

import { LEGACY_COLLECTION_NAMES } from '../collection-names';

/**
 * Renames Mongoose-default physical collections to their ratified Schema Nebula names.
 *
 * ## Why a migration rather than "it will just create new ones"
 *
 * Setting `collection` on a schema changes where the driver reads and writes. Existing
 * documents do not move; they become invisible to the application while still occupying
 * the old collection. For sessions and OTP challenges that silently signs everyone out;
 * for `auditLogs` it orphans retained security evidence, which the retention lock does not
 * allow. So the name change and the data move belong in the same reviewed step.
 *
 * ## Safety properties
 *
 * - **Idempotent.** A second run reports every pair as `already-aligned` and issues no
 *   command. Re-running after a partial failure resumes.
 * - **Never merges.** If BOTH names exist the migration refuses that pair and reports
 *   `conflict` instead of choosing a winner. Two collections holding the same entity is a
 *   situation only a human can resolve; guessing could destroy audit rows.
 * - **Preserves indexes.** `renameCollection` carries index definitions with the
 *   collection, so the catalogue proven by the adapter integration tests survives.
 * - **No `dropTarget`.** Deliberately omitted. It is the one flag that could delete data.
 *
 * ## Rollback
 *
 * The inverse rename restores the previous state exactly (`renamed` pairs, swapped). No
 * document is modified, so there is nothing else to undo. A database that has never run
 * this migration and a database that has run it twice are both valid inputs.
 *
 * Not run automatically at boot: `AGENTS.md` and the index-lifecycle rule forbid
 * uncontrolled schema/index mutation on startup. Invoke it explicitly through
 * `pnpm mongo:align-collections`.
 */
export type AlignmentOutcome = 'renamed' | 'already-aligned' | 'absent' | 'conflict';

export interface AlignmentEntry {
	legacyName: string;
	targetName: string;
	outcome: AlignmentOutcome;
	/** Document count observed on the collection that was acted on, when one existed. */
	documents?: number;
}

export interface AlignmentReport {
	dryRun: boolean;
	entries: AlignmentEntry[];
	renamed: number;
	conflicts: number;
}

export interface AlignCollectionNamesOptions {
	/** Report what would happen without issuing a rename. */
	dryRun?: boolean;
	/** Override the pairs to process. Defaults to every known legacy → ratified pair. */
	pairs?: Readonly<Record<string, string>>;
}

export async function alignCollectionNames(
	connection: mongoose.Connection,
	options: AlignCollectionNamesOptions = {},
): Promise<AlignmentReport> {
	const dryRun = options.dryRun ?? false;
	const pairs = options.pairs ?? LEGACY_COLLECTION_NAMES;

	const db = connection.db;
	if (!db) throw new Error('alignCollectionNames requires an established connection');

	const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name));

	const entries: AlignmentEntry[] = [];
	for (const [legacyName, targetName] of Object.entries(pairs)) {
		const hasLegacy = existing.has(legacyName);
		const hasTarget = existing.has(targetName);

		if (hasLegacy && hasTarget) {
			entries.push({
				legacyName,
				targetName,
				outcome: 'conflict',
				documents: await db.collection(legacyName).countDocuments(),
			});
			continue;
		}
		if (!hasLegacy) {
			entries.push({ legacyName, targetName, outcome: hasTarget ? 'already-aligned' : 'absent' });
			continue;
		}

		const documents = await db.collection(legacyName).countDocuments();
		if (!dryRun) {
			await db.renameCollection(legacyName, targetName);
			existing.delete(legacyName);
			existing.add(targetName);
		}
		entries.push({ legacyName, targetName, outcome: 'renamed', documents });
	}

	return {
		dryRun,
		entries,
		renamed: entries.filter((entry) => entry.outcome === 'renamed').length,
		conflicts: entries.filter((entry) => entry.outcome === 'conflict').length,
	};
}
