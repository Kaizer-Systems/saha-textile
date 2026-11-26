/**
 * One choice in the advanced dropdown. Each screen passes its own rows (categories, tags, pages); the dropdown reads
 * a row's label and its children under the keys the screen names (`displayKey`, `subArrayKey`).
 */
export interface DropdownOption {
	id?: string | number | null;
	/** Set on the row when it is ticked in the list. */
	selected?: boolean;
}

/** The id type of a screen's rows: what the dropdown hands back when choices change. */
export type DropdownOptionId<T extends DropdownOption> = NonNullable<T['id']>;

function field(row: DropdownOption, key: string): unknown {
	return (row as Record<string, unknown>)[key];
}

/** The text under `key`, for showing and searching; empty when the row has none. */
export function labelOf(row: DropdownOption, key: string): string {
	const value = field(row, key);
	return value === undefined || value === null ? '' : String(value);
}

/** The rows under `key` (a category's subcategories); none when the row has none or no key is named. */
export function childrenOf<T extends DropdownOption>(row: T, key: string): T[] {
	const value = key ? field(row, key) : undefined;
	return Array.isArray(value) ? (value as T[]) : [];
}
