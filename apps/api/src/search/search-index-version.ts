/**
 * The search version. Raise it by one only when a release changes what the index knows about a
 * product: a field in `listing-document.ts`, or the searchable, filterable or sortable
 * attributes or ranking rules in `MeilisearchSearch`. A release that raises it builds the new
 * index before it is switched in; a release that keeps it skips the rebuild and applies only
 * settings. The previous version's index stays until the next build, so a rollback finds it.
 */
export const SEARCH_INDEX_VERSION = 1;

/** The index a release reads: `products` becomes `products_v1`. */
export function versionedIndex(base: string, version: number = SEARCH_INDEX_VERSION): string {
	return `${base}_v${version}`;
}
