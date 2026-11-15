import type { LanguageRecord, WrittenLanguageArea } from '@saha-textile/contracts';

/**
 * Settings › Languages (`languages`): one row per language ever added, English included. Deleted
 * languages keep their row (with `deletedAt`), so an address the shop once served can still
 * answer 301 and adding the language again finds its text.
 */
export interface LanguageRepository {
	list(): Promise<LanguageRecord[]>;
	find(code: string): Promise<LanguageRecord | null>;
	save(record: LanguageRecord): Promise<LanguageRecord>;
	/** Writes the first rows only while the list is empty; answers whether it wrote them. */
	seedIfEmpty(records: readonly LanguageRecord[]): Promise<boolean>;
}

/**
 * The text stored in one language across everything the admin writes for the shop. Counts look
 * only at what the shop shows (live items, and photos those items use); a field that may stay
 * empty needs other languages only once its English is written.
 */
export interface LanguageCoverageRepository {
	/** Items the shop shows whose text in `code` is incomplete, per area. */
	missing(code: string): Promise<Record<WrittenLanguageArea, number>>;
	/** The ids of those items in one area, for its list page's "missing" filter. */
	missingIds(area: WrittenLanguageArea, code: string): Promise<string[]>;
	/** Items (live or not) holding any text in `code`. */
	itemsWithText(code: string): Promise<number>;
	/** Removes every stored text in `code` for good; answers how many items changed. */
	erase(code: string): Promise<number>;
}
