/** Keeps the first copy of each id. A mixed FAQ that matches twice is shown once. */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
	const seen = new Set<string>();
	return rows.filter((row) => {
		if (seen.has(row.id)) return false;
		seen.add(row.id);
		return true;
	});
}

/** Drops a relation whose target is not a live product. */
export function liveRelations<T extends { targetId: string }>(rows: readonly T[], liveIds: ReadonlySet<string>): T[] {
	return rows.filter((row) => liveIds.has(row.targetId));
}
