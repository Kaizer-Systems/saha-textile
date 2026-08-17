import type { Model } from 'mongoose';

/**
 * Brings the indexes actually present in MongoDB back in line with the ones the models declare.
 *
 * ## Why this is needed at all
 *
 * Mongoose creates an index it cannot find, but it will NOT alter one that already exists under
 * the same name with different options — it simply leaves the old definition in place, silently.
 * So the moment an index's options are edited in a model, every database created before that
 * edit keeps the OLD rule while the source reads like the new one. Nothing fails; the guarantee
 * is just quietly untrue.
 *
 * That is not hypothetical here. `customers` was found carrying:
 *
 *   - `email_1` and `phone_1` partial on `{ $type: 'string' }` only, while the model has said
 *     `status: { $ne: 'deleted' }` since soft delete landed. The comment in the model promises
 *     "soft-deleted rows release email/phone uniqueness so a reclaimed address can be
 *     re-created" — with the old index in force, a deleted customer burned their address and
 *     phone permanently and could never sign up again;
 *   - `username_1` and `role_1_status_1`, left over from before `DEC-ACCOUNT-SEPARATION` moved
 *     operators into `adminUsers`. Customers have neither field.
 *
 * ## What it does
 *
 * `syncIndexes()` drops what the schema no longer declares and creates what is missing, which is
 * exactly the reconciliation wanted. It is DESTRUCTIVE by design — an index added by hand and
 * never written into a model will be dropped — so this runs explicitly as a reviewed migration
 * and never at application boot, matching the index-lifecycle rule in `AGENTS.md`.
 *
 * The dry run reports what would change without touching anything.
 */

export type IndexReconciliationEntry = {
	collection: string;
	/** Index names that exist in MongoDB but are no longer declared, or whose options diverge. */
	dropped: string[];
	/**
	 * Declared indexes with no counterpart in MongoDB at all.
	 *
	 * Tracked separately because it is the state a FAILED reconciliation leaves behind:
	 * `syncIndexes()` drops before it creates, so a specification MongoDB refuses takes the old
	 * index with it and leaves the collection with no constraint. Reporting only divergence
	 * would call that collection "aligned" on the next run and never repair it.
	 */
	missing: string[];
	/** True when nothing had to change. */
	alreadyAligned: boolean;
};

export type IndexReconciliationReport = {
	entries: IndexReconciliationEntry[];
	dropped: number;
	missing: number;
	dryRun: boolean;
};

/** Compares two partial-filter expressions (or their absence) structurally. */
function sameFilter(left: unknown, right: unknown): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Names the indexes that would be dropped, WITHOUT changing anything.
 *
 * Mongoose exposes `diffIndexes()` for this, but it does not consider a changed
 * `partialFilterExpression` a difference in every version, and that is precisely the divergence
 * that caused the bug above — so the comparison is done here rather than delegated.
 */
async function compareIndexes(model: Model<unknown>): Promise<{ dropped: string[]; missing: string[] }> {
	/** `[keyPattern, options]` pairs; mongoose types the pair loosely, so it is narrowed here. */
	const declared = model.schema.indexes() as [Record<string, unknown>, Record<string, unknown> | undefined][];

	/**
	 * A collection that has never been written to does not exist yet, and asking it for indexes
	 * raises `NamespaceNotFound` (26). Nothing can diverge from a schema that was never applied,
	 * so this is "aligned", not an error — and creating the collection here purely to inspect it
	 * would be a side effect a dry run must not have.
	 */
	const live = await model.collection.indexes().catch((error: unknown) => {
		if ((error as { code?: number }).code === 26) return [];
		throw error;
	});
	const names: string[] = [];
	const matchedKeys = new Set<string>();

	for (const index of live) {
		if (index.name === '_id_') continue;

		const match = declared.find(([key]) => JSON.stringify(key) === JSON.stringify(index.key));
		// Present in the database, absent from the schema — a leftover.
		if (!match) {
			names.push(index.name as string);
			continue;
		}

		matchedKeys.add(JSON.stringify(index.key));
		const [, options = {}] = match;
		const uniqueDiffers = Boolean(options['unique']) !== Boolean(index.unique);
		const filterDiffers = !sameFilter(options['partialFilterExpression'], index.partialFilterExpression);
		if (uniqueDiffers || filterDiffers) names.push(index.name as string);
	}

	const missing = declared.map(([key]) => JSON.stringify(key)).filter((key) => !matchedKeys.has(key));

	return { dropped: names, missing };
}

export async function reconcileIndexes(
	models: Model<never>[],
	options: { dryRun?: boolean } = {},
): Promise<IndexReconciliationReport> {
	const dryRun = options.dryRun ?? false;
	const entries: IndexReconciliationEntry[] = [];

	for (const model of models) {
		const typed = model as unknown as Model<unknown>;
		const { dropped, missing } = await compareIndexes(typed);

		if (!dryRun && (dropped.length > 0 || missing.length > 0)) {
			/**
			 * `syncIndexes` drops what no longer matches and then creates what is declared. The
			 * order matters and it is not atomic: if MongoDB refuses the new specification, the
			 * OLD index is already gone and the collection is left with no constraint at all.
			 *
			 * So the collection is named in the failure. A bare driver error here reads as a
			 * generic index problem, when what it actually means is "this collection may right
			 * now be missing a uniqueness guarantee" — which is worth saying plainly.
			 */
			await typed.syncIndexes().catch((error: unknown) => {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(
					`${typed.collection.collectionName}: index rebuild failed and the previous index was already dropped — ` +
						`the collection may currently be missing a constraint. Fix the declaration and re-run. (${detail})`,
				);
			});
		}

		entries.push({
			collection: typed.collection.collectionName,
			dropped,
			missing,
			alreadyAligned: dropped.length === 0 && missing.length === 0,
		});
	}

	return {
		entries,
		dropped: entries.reduce((total, entry) => total + entry.dropped.length, 0),
		missing: entries.reduce((total, entry) => total + entry.missing.length, 0),
		dryRun,
	};
}
