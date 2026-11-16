import { z } from 'zod';

import { IsoDateTime, LocaleCode } from './common';

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15).
 *
 * A language is added once its menu and button text came with a release in both apps. It starts
 * as a draft: forms show it and its text can be written, but the shop does not show it. The
 * Admin switch lets staff turn the admin's own words into it; the Shop switch shows it on the
 * shop once nothing is left to write. English is always on in both and can never be removed.
 */

/** Where the shop stands with a language: never shown since it was added, shown, or taken off. */
export const LanguageShopState = z.enum(['draft', 'on', 'off']);
export type LanguageShopState = z.infer<typeof LanguageShopState>;

/** One stored language (`languages`, `_id` = its code). */
export const LanguageRecord = z.object({
	code: LocaleCode,
	/** Staff may turn the admin into this language. */
	admin: z.boolean(),
	shop: LanguageShopState,
	/** The shop showed it at some point: while it is not on, its addresses answer 301 to English. */
	everOn: z.boolean().default(false),
	addedAt: IsoDateTime.nullable().default(null),
	addedBy: z.string().nullable().default(null),
	changedAt: IsoDateTime.nullable().default(null),
	changedBy: z.string().nullable().default(null),
	/** Deleted: gone from every list and switch; its text stays stored until it is erased. */
	deletedAt: IsoDateTime.nullable().default(null),
	deletedBy: z.string().nullable().default(null),
	/** When the owner last answered the 30-day reminder with "Keep it". */
	remindedAt: IsoDateTime.nullable().default(null),
	/** When its stored text was erased for good. */
	erasedAt: IsoDateTime.nullable().default(null),
});
export type LanguageRecord = z.infer<typeof LanguageRecord>;

/** One language in the working list every signed-in admin reads (`GET /admin/languages`). */
export const LanguageListEntry = z.object({
	code: LocaleCode,
	admin: z.boolean(),
	shop: LanguageShopState,
});
export type LanguageListEntry = z.infer<typeof LanguageListEntry>;

/** `GET /admin/languages`: every language that is not deleted, English first. */
export const LanguageListResponse = z.object({
	default: LocaleCode,
	languages: z.array(LanguageListEntry),
});
export type LanguageListResponse = z.infer<typeof LanguageListResponse>;

/**
 * The places a language's text lives, in the order the to-do list shows them. `shop_text`,
 * `admin_text` and `pages` come with a release (files); the rest is written in the admin.
 */
export const LanguageArea = z.enum([
	'shop_text',
	'admin_text',
	'products',
	'options',
	'categories',
	'photos',
	'banners',
	'blog_posts',
	'blog_categories',
	'blog_tags',
	'events',
	'stores',
	'faqs',
	'search_words',
	'addon_templates',
	'pages',
]);
export type LanguageArea = z.infer<typeof LanguageArea>;

/** Areas whose text is written in the admin (each has a list that can show only what is missing). */
export const WRITTEN_LANGUAGE_AREAS = [
	'products',
	'options',
	'categories',
	'photos',
	'banners',
	'blog_posts',
	'blog_categories',
	'blog_tags',
	'events',
	'stores',
	'faqs',
	'search_words',
	'addon_templates',
	'pages',
] as const satisfies readonly LanguageArea[];
export type WrittenLanguageArea = (typeof WRITTEN_LANGUAGE_AREAS)[number];
/** One written area, as a route parameter. */
export const WrittenLanguageAreaParam = z.enum(WRITTEN_LANGUAGE_AREAS);

/** `GET /admin/languages/:code/missing/:area`: the items that list shows, filtered to what is missing. */
export const LanguageMissingResponse = z.object({ ids: z.array(z.string()) });
export type LanguageMissingResponse = z.infer<typeof LanguageMissingResponse>;

/** One line of a language's to-do list. */
export const LanguageTodoLine = z.object({
	area: LanguageArea,
	/** Things still empty in this language: items, files or pages. */
	count: z.number().int().nonnegative(),
	/** Whether this line stops the shop showing the language (the admin's own words do not). */
	blocksShop: z.boolean(),
});
export type LanguageTodoLine = z.infer<typeof LanguageTodoLine>;

/** `GET /admin/languages/:code/todo`. */
export const LanguageTodoResponse = z.object({
	code: LocaleCode,
	lines: z.array(LanguageTodoLine),
	/** What stops the shop switch: the sum of the blocking lines. */
	total: z.number().int().nonnegative(),
});
export type LanguageTodoResponse = z.infer<typeof LanguageTodoResponse>;

/** A language whose files came with this release. */
export const ShippedLanguage = z.object({
	code: LocaleCode,
	/** In both apps' menu and button files. Only these can be added. */
	inBoth: z.boolean(),
	adminComplete: z.boolean(),
	shopComplete: z.boolean(),
});
export type ShippedLanguage = z.infer<typeof ShippedLanguage>;

/** Why an action is not allowed right now; the page shows its own sentence for each. */
export const LanguageRefusal = z.enum([
	'english_fixed',
	'unknown_language',
	'already_added',
	'not_in_release',
	'admin_text_incomplete',
	'todo_left',
	'shop_on',
	'not_deleted',
	'name_mismatch',
	'already_erased',
]);
export type LanguageRefusal = z.infer<typeof LanguageRefusal>;

/** One row of Settings › Languages. */
export const LanguageSettingsRow = LanguageRecord.extend({
	/** What is left before the shop can show it (0 for English and for a complete language). */
	todo: z.number().int().nonnegative(),
	/** Items holding text in this language (shown before delete and erase). */
	itemsWithText: z.number().int().nonnegative(),
	adminFileComplete: z.boolean(),
	/** The bell's 30-day reminder is due for this deleted language. */
	reminderDue: z.boolean(),
	/** Addresses in the sitemap under its prefix today (shown before switching the shop off). */
	addresses: z.number().int().nonnegative(),
});
export type LanguageSettingsRow = z.infer<typeof LanguageSettingsRow>;

/** `GET /admin/languages/settings`. */
export const LanguageSettingsResponse = z.object({
	default: LocaleCode,
	/** Every language ever added, English first; deleted ones last. */
	rows: z.array(LanguageSettingsRow),
	/** Languages this release can add (files in both apps), with the ones in one app only. */
	shipped: z.array(ShippedLanguage),
});
export type LanguageSettingsResponse = z.infer<typeof LanguageSettingsResponse>;

/** `POST /admin/languages`. */
export const LanguageAddWrite = z.object({ code: LocaleCode });
export type LanguageAddWrite = z.infer<typeof LanguageAddWrite>;

/** `PUT /admin/languages/:code/admin` and `/shop`. */
export const LanguageSwitchWrite = z.object({ on: z.boolean() });
export type LanguageSwitchWrite = z.infer<typeof LanguageSwitchWrite>;

/** `POST /admin/languages/:code/erase`: the language's own name, typed. */
export const LanguageEraseWrite = z.object({ confirm: z.string().trim().min(1).max(80) });
export type LanguageEraseWrite = z.infer<typeof LanguageEraseWrite>;

/** The bell's reminder for a deleted language whose text is still stored. */
export const LanguageReminder = z.object({
	code: LocaleCode,
	deletedAt: IsoDateTime,
	itemsWithText: z.number().int().nonnegative(),
});
export type LanguageReminder = z.infer<typeof LanguageReminder>;

/** `GET /admin/languages/reminders`. */
export const LanguageReminderResponse = z.object({ reminders: z.array(LanguageReminder) });
export type LanguageReminderResponse = z.infer<typeof LanguageReminderResponse>;

/** List pages that can show only the items missing one language's text (`?missing=hi`). */
export const MissingLanguageQuery = z.object({ missing: LocaleCode.optional() });
export type MissingLanguageQuery = z.infer<typeof MissingLanguageQuery>;
