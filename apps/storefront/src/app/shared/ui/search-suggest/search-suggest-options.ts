import type { ICategory } from '@data-access/interfaces/category.interface';
import type { IProduct } from '@data-access/interfaces/product.interface';

/** One row of the box. Every row the arrow keys reach is one of these. */
export type SuggestOption =
	| { kind: 'term'; id: string; term: string }
	| { kind: 'product'; id: string; product: IProduct }
	| { kind: 'category'; id: string; category: ICategory; parent: string | null }
	| { kind: 'all'; id: string; term: string; total: number };

export interface SuggestSection {
	/** Translation key of the heading; null for the "See all" row. */
	title: string | null;
	icon: string | null;
	/** Shows Clear all beside the heading. */
	clearable: boolean;
	options: SuggestOption[];
}

export interface Highlighted {
	text: string;
	hit: boolean;
}

/** Splits a name round the first place the typed words appear, for the bold part. */
export function highlight(text: string, term: string): Highlighted[] {
	const needle = term.trim().toLocaleLowerCase();
	const at = needle ? text.toLocaleLowerCase().indexOf(needle) : -1;
	if (at < 0) return [{ text, hit: false }];
	return [
		{ text: text.slice(0, at), hit: false },
		{ text: text.slice(at, at + needle.length), hit: true },
		{ text: text.slice(at + needle.length), hit: false },
	].filter((part) => part.text.length > 0);
}

const MAX_CATEGORIES = 3;

/**
 * Categories whose name, in the page language, or whose English slug holds the typed words:
 * a Bengali page still finds Jamdani from "jamdani". Top levels first, then the fuller ones.
 */
export function matchCategories(
	rows: readonly ICategory[],
	term: string,
): Array<{ category: ICategory; parent: string | null }> {
	const needle = term.trim().toLocaleLowerCase();
	if (needle.length < 2) return [];
	const byPath = new Map(rows.map((row) => [row.canonical_path ?? '', row]));
	return rows
		.filter(
			(row): row is ICategory & { canonical_path: string } =>
				!!row.canonical_path &&
				(row.name.toLocaleLowerCase().includes(needle) || row.slug.replace(/-/g, ' ').includes(needle)),
		)
		.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || (b.products_count ?? 0) - (a.products_count ?? 0))
		.slice(0, MAX_CATEGORIES)
		.map((category) => {
			const parentPath = category.canonical_path.split('/').slice(0, -1).join('/');
			return { category, parent: parentPath ? (byPath.get(parentPath)?.name ?? null) : null };
		});
}
