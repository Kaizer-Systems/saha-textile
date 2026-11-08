/**
 * The shopper's own recent searches, kept only in their browser under Functional cookies
 * (owner decision 2026-11-08). Nothing here ever reaches the server.
 */
const KEY = 'st_search';
export const MAX_TERMS = 6;
export const MAX_PRODUCTS = 4;
const MAX_TERM_LENGTH = 100;

export interface SearchHistory {
	/** Newest first. */
	terms: string[];
	/** Slugs of products opened from search, newest first. */
	products: string[];
}

const EMPTY: SearchHistory = { terms: [], products: [] };

const strings = (value: unknown, max: number): string[] =>
	Array.isArray(value)
		? value.filter((row): row is string => typeof row === 'string' && row.trim().length > 0).slice(0, max)
		: [];

export function readSearchHistory(storage: Storage): SearchHistory {
	try {
		const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
		if (!parsed || typeof parsed !== 'object') return EMPTY;
		const row = parsed as Record<string, unknown>;
		return { terms: strings(row['terms'], MAX_TERMS), products: strings(row['products'], MAX_PRODUCTS) };
	} catch {
		return EMPTY;
	}
}

function write(storage: Storage, history: SearchHistory): SearchHistory {
	try {
		storage.setItem(KEY, JSON.stringify(history));
	} catch {
		// A full or blocked store only means the list is not remembered.
	}
	return history;
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Moves the words to the top, once, whatever their case. */
export function rememberSearchTerm(storage: Storage, term: string): SearchHistory {
	const clean = term.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH);
	const history = readSearchHistory(storage);
	if (!clean) return history;
	return write(storage, {
		...history,
		terms: [clean, ...history.terms.filter((row) => !same(row, clean))].slice(0, MAX_TERMS),
	});
}

export function forgetSearchTerm(storage: Storage, term: string): SearchHistory {
	const history = readSearchHistory(storage);
	return write(storage, { ...history, terms: history.terms.filter((row) => !same(row, term)) });
}

export function rememberSearchProduct(storage: Storage, slug: string): SearchHistory {
	const history = readSearchHistory(storage);
	return write(storage, {
		...history,
		products: [slug, ...history.products.filter((row) => row !== slug)].slice(0, MAX_PRODUCTS),
	});
}

export function clearSearchHistory(storage: Storage): SearchHistory {
	try {
		storage.removeItem(KEY);
	} catch {
		// Nothing to clear.
	}
	return EMPTY;
}
