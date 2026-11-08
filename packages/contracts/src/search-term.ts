import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText } from './common';

/**
 * Search words (`searchDictionary`, owner log § search words, 2026-11-08): a word such as "Puja"
 * with its name in every shop language, other spellings per language, and one shared set of
 * categories and products it finds. Typing the name, a spelling, or a near-miss of either, in any
 * script, finds every tagged product.
 */
export const SearchTermStatus = z.enum(['draft', 'live']);
export type SearchTermStatus = z.infer<typeof SearchTermStatus>;

const Word = z.string().trim().min(1).max(60);
/** Other spellings per language. */
const Spellings = z.record(z.string(), z.array(Word).max(30));

export const SearchTerm = z.object({
	id: Id,
	name: LocalizedText,
	spellings: Spellings.default({}),
	/** Every product in these categories, and in the categories under them. */
	categoryIds: z.array(Id).max(100).default([]),
	/** Single products on top of the categories. */
	productIds: z.array(Id).max(500).default([]),
	status: SearchTermStatus.default('draft'),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type SearchTerm = z.infer<typeof SearchTerm>;

/** The form. Live is refused, with the gaps, until every language has a name and something is tagged. */
export const SearchTermWrite = z.object({
	name: z.record(z.string(), z.string().max(60)),
	spellings: Spellings.default({}),
	categoryIds: z.array(Id).max(100).default([]),
	productIds: z.array(Id).max(500).default([]),
	status: SearchTermStatus.default('draft'),
});
export type SearchTermWrite = z.infer<typeof SearchTermWrite>;

/** The list's bulk Go Live and Take off shop. */
export const SearchTermStatusWrite = z.object({
	ids: z.array(Id).min(1).max(100),
	status: SearchTermStatus,
});
export type SearchTermStatusWrite = z.infer<typeof SearchTermStatusWrite>;

export const AdminSearchTermListQuery = z.object({
	search: z.string().max(100).optional(),
	status: SearchTermStatus.optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type AdminSearchTermListQuery = z.infer<typeof AdminSearchTermListQuery>;

export const AdminSearchTermListResponse = z.object({
	items: z.array(SearchTerm),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AdminSearchTermListResponse = z.infer<typeof AdminSearchTermListResponse>;

/** A tagged product as the form shows it. */
export const AdminSearchTermProduct = z.object({
	id: Id,
	name: z.string(),
	image: z.string().nullable(),
});
export type AdminSearchTermProduct = z.infer<typeof AdminSearchTermProduct>;

export const AdminSearchTermDetail = z.object({
	term: SearchTerm,
	products: z.array(AdminSearchTermProduct),
});
export type AdminSearchTermDetail = z.infer<typeof AdminSearchTermDetail>;

/** Storefront settings › Search (`storefront.search`). */
export const StorefrontSearchSettings = z.object({
	/** When the words fit two products equally well, products in these categories come first. */
	showFirstCategoryIds: z.array(Id).max(50).default([]),
});
export type StorefrontSearchSettings = z.infer<typeof StorefrontSearchSettings>;
