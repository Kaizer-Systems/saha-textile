import type { Category, GoLiveGap, Product, SearchTerm } from '@saha-textile/contracts';

/** One spelling: single spaces, lower case where the script has case. */
export function cleanWord(word: string): string {
	return word.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
}

/** Spellings per language, cleaned, once each, and never the name itself. */
export function cleanSpellings(
	spellings: Readonly<Record<string, readonly string[]>>,
	name: Readonly<Record<string, string>>,
): Record<string, string[]> {
	const names = new Set(Object.values(name).map(cleanWord));
	return Object.fromEntries(
		Object.entries(spellings)
			.map(([locale, words]): [string, string[]] => [
				locale,
				[...new Set(words.map(cleanWord))].filter((word) => word && !names.has(word)),
			])
			.filter(([, words]) => words.length > 0),
	);
}

/** What stops a search word going live: a name in every language, and something to find. */
export function searchTermGaps(
	term: Pick<SearchTerm, 'name' | 'categoryIds' | 'productIds'>,
	locales: readonly string[],
): GoLiveGap[] {
	const gaps: GoLiveGap[] = locales
		.filter((locale) => !term.name[locale]?.trim())
		.map((locale) => ({ field: 'name', locale }));
	if (!term.categoryIds.length && !term.productIds.length) gaps.push({ field: 'tags', locale: null });
	return gaps;
}

/** Every name and spelling of a word, in every language, cleaned and once each. */
export function termWords(term: Pick<SearchTerm, 'name' | 'spellings'>): string[] {
	return [
		...new Set(
			[...Object.values(term.name), ...Object.values(term.spellings).flat()].map(cleanWord).filter(Boolean),
		),
	];
}

type CategoryNode = Pick<Category, 'id' | 'ancestors'>;

/** The categories themselves and every category under them. */
export function withDescendants(categoryIds: readonly string[], categories: readonly CategoryNode[]): string[] {
	const chosen = new Set(categoryIds);
	return [
		...new Set([
			...categoryIds,
			...categories.filter((row) => row.ancestors.some((id) => chosen.has(id))).map((row) => row.id),
		]),
	];
}

/** True when a product sits in one of the categories, directly or under it. */
function inCategories(
	product: Pick<Product, 'categoryIds'>,
	chosen: ReadonlySet<string>,
	ancestorsOf: ReadonlyMap<string, readonly string[]>,
): boolean {
	return product.categoryIds.some(
		(id) => chosen.has(id) || (ancestorsOf.get(id) ?? []).some((ancestor) => chosen.has(ancestor)),
	);
}

export interface SearchVocabulary {
	/** Each word finds the other names and spellings of the same search word. */
	synonyms: Record<string, string[]>;
	/** The words a product is found by through the search words that tag it. */
	wordsFor(product: Pick<Product, 'id' | 'categoryIds'>): string[];
	/** True when the product belongs to a "show first" category. */
	showsFirst(product: Pick<Product, 'categoryIds'>): boolean;
}

/** Live search words and the "show first" categories, ready for the index. */
export function searchVocabulary(
	terms: readonly SearchTerm[],
	categories: readonly CategoryNode[],
	showFirstCategoryIds: readonly string[] = [],
): SearchVocabulary {
	const live = terms.filter((term) => term.status === 'live');
	const ancestorsOf = new Map(categories.map((row) => [row.id, row.ancestors]));
	const synonyms: Record<string, string[]> = {};
	const tagged = live.map((term) => {
		const words = termWords(term);
		for (const word of words) {
			synonyms[word] = [...new Set([...(synonyms[word] ?? []), ...words.filter((other) => other !== word)])];
		}
		return { words, categories: new Set(term.categoryIds), products: new Set(term.productIds) };
	});
	const first = new Set(showFirstCategoryIds);
	return {
		synonyms,
		wordsFor: (product) => [
			...new Set(
				tagged
					.filter(
						(term) => term.products.has(product.id) || inCategories(product, term.categories, ancestorsOf),
					)
					.flatMap((term) => term.words),
			),
		],
		showsFirst: (product) => first.size > 0 && inCategories(product, first, ancestorsOf),
	};
}
