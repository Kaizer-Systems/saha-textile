import type {
	LanguageArea,
	LanguageRecord,
	LanguageRefusal,
	LanguageTodoLine,
	ShippedLanguage,
} from '@saha-textile/contracts';

import { PRIMARY_LOCALE, isLocaleCode, languageName, orderLocales } from './languages';

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15): which language may be added,
 * switched on or off for the admin and the shop, deleted and erased, and what each list holds.
 *
 * English is the default: always on in both, never deleted. A new language starts as a draft whose
 * text can be written in every form (Option 1: the Admin switch is only about the admin's own
 * words). The shop shows it once nothing is left to write.
 */

/** The bell reminds the owner about a deleted language's stored text this often (days). */
export const LANGUAGE_REMINDER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The to-do list's order; `admin_text` is the one line that does not stop the shop. */
const AREA_ORDER: readonly LanguageArea[] = [
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
	'page_builder',
];

/** The lists every app reads, from the stored languages. English is in each and always first. */
export interface LanguageSets {
	/** The languages the shop shows. */
	shop: string[];
	/** Every language that is not deleted: forms show each one, drafts included. */
	content: string[];
	/** The languages staff may turn the admin into. */
	admin: string[];
	/** Languages the shop showed once and does not show now: their addresses answer 301. */
	redirect: string[];
}

export function languageSets(records: readonly LanguageRecord[]): LanguageSets {
	const live = records.filter((record) => !record.deletedAt);
	const codes = (rows: readonly LanguageRecord[]) => orderLocales(rows.map((row) => row.code));
	return {
		shop: codes(live.filter((row) => row.shop === 'on')),
		content: codes(live),
		admin: codes(live.filter((row) => row.admin)),
		redirect: records
			.filter((row) => row.code !== PRIMARY_LOCALE && row.everOn && (row.deletedAt || row.shop !== 'on'))
			.map((row) => row.code),
	};
}

const blank = (code: string, now: string, actor: string | null): LanguageRecord => ({
	code,
	admin: false,
	shop: 'draft',
	everOn: false,
	addedAt: now,
	addedBy: actor,
	changedAt: now,
	changedBy: actor,
	deletedAt: null,
	deletedBy: null,
	remindedAt: null,
	erasedAt: null,
});

/**
 * The first rows of an empty list: the languages the deployment served before the list was
 * stored (`ACTIVE_LOCALES`), each on for the admin and the shop.
 */
export function seedLanguages(locales: readonly string[], now: string): LanguageRecord[] {
	return orderLocales(locales.filter(isLocaleCode)).map((code) => ({
		...blank(code, now, null),
		admin: true,
		shop: 'on',
		everOn: true,
	}));
}

/** English as it must always be, whatever was stored. */
export function withEnglishFixed(records: readonly LanguageRecord[], now: string): LanguageRecord[] {
	const english = records.find((row) => row.code === PRIMARY_LOCALE);
	const fixed: LanguageRecord = {
		...(english ?? blank(PRIMARY_LOCALE, now, null)),
		admin: true,
		shop: 'on',
		everOn: true,
		deletedAt: null,
		deletedBy: null,
		erasedAt: null,
	};
	return [fixed, ...records.filter((row) => row.code !== PRIMARY_LOCALE)];
}

export type LanguageChange =
	| { kind: 'add'; code: string }
	| { kind: 'admin'; code: string; on: boolean }
	| { kind: 'shop'; code: string; on: boolean }
	| { kind: 'delete'; code: string }
	| { kind: 'erase'; code: string; typed: string }
	| { kind: 'keep'; code: string };

/** What the rules need to know besides the stored row. */
export interface LanguageFacts {
	/** This release's files for the language, or null when neither app ships it. */
	shipped: ShippedLanguage | null;
	/** What still stops the shop showing it (only asked for when switching the shop on). */
	todo: number;
}

export type LanguageDecision =
	{ ok: true; next: LanguageRecord; changed: boolean } | { ok: false; reason: LanguageRefusal };

const refuse = (reason: LanguageRefusal): LanguageDecision => ({ ok: false, reason });

/** A typed confirmation matches the language's own name ("বাংলা"), ignoring case and spacing. */
export function confirmsLanguageName(code: string, typed: string): boolean {
	const clean = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
	return clean(typed) === clean(languageName(code));
}

/** Every change one rule decides, so the API, its tests and the page agree. */
export function decideLanguageChange(
	current: LanguageRecord | null,
	change: LanguageChange,
	facts: LanguageFacts,
	actor: string | null,
	now: string,
): LanguageDecision {
	if (!isLocaleCode(change.code)) return refuse('unknown_language');
	const stamp = { changedAt: now, changedBy: actor };
	const done = (next: LanguageRecord): LanguageDecision => ({
		ok: true,
		next,
		changed:
			JSON.stringify({ ...next, changedAt: null, changedBy: null }) !==
			JSON.stringify({ ...current, changedAt: null, changedBy: null }),
	});

	if (change.kind === 'add') {
		if (change.code === PRIMARY_LOCALE || (current && !current.deletedAt)) return refuse('already_added');
		if (!facts.shipped?.inBoth) return refuse('not_in_release');
		// Adding it again brings back whatever text is still stored; it starts as a draft either way.
		return done({
			...blank(change.code, now, actor),
			everOn: current?.everOn ?? false,
		});
	}

	if (change.code === PRIMARY_LOCALE) return refuse('english_fixed');
	if (!current) return refuse('unknown_language');

	if (change.kind === 'erase' || change.kind === 'keep') {
		if (!current.deletedAt) return refuse('not_deleted');
		if (current.erasedAt) return refuse('already_erased');
		if (change.kind === 'keep') return done({ ...current, remindedAt: now });
		if (!confirmsLanguageName(change.code, change.typed)) return refuse('name_mismatch');
		return done({ ...current, erasedAt: now, ...stamp });
	}

	if (current.deletedAt) return refuse('unknown_language');

	if (change.kind === 'admin') {
		if (change.on && !facts.shipped?.adminComplete) return refuse('admin_text_incomplete');
		return done({ ...current, admin: change.on, ...(current.admin === change.on ? {} : stamp) });
	}

	if (change.kind === 'shop') {
		if (!change.on) {
			// A draft was never shown: switching it off leaves it a draft.
			if (current.shop !== 'on') return done(current);
			return done({ ...current, shop: 'off', ...stamp });
		}
		if (current.shop === 'on') return done(current);
		if (facts.todo > 0) return refuse('todo_left');
		return done({ ...current, shop: 'on', everOn: true, ...stamp });
	}

	// Delete: only once the shop no longer shows it. Its text stays stored.
	if (current.shop === 'on') return refuse('shop_on');
	return done({
		...current,
		admin: false,
		deletedAt: now,
		deletedBy: actor,
		remindedAt: null,
		...stamp,
	});
}

/** The bell reminds about a deleted language's text after 30 days unused, then every 30 days. */
export function languageReminderDue(record: LanguageRecord, now: Date): boolean {
	if (!record.deletedAt || record.erasedAt) return false;
	const since = (iso: string) => now.getTime() - new Date(iso).getTime();
	const period = LANGUAGE_REMINDER_DAYS * DAY_MS;
	return since(record.deletedAt) >= period && (!record.remindedAt || since(record.remindedAt) >= period);
}

/**
 * A language's to-do list in the page's order. Everything stops the shop except the admin's own
 * words, which only the Admin switch needs. English has nothing to do by definition.
 */
export function languageTodo(counts: Readonly<Partial<Record<LanguageArea, number>>>): {
	lines: LanguageTodoLine[];
	total: number;
} {
	const lines = AREA_ORDER.map((area) => ({
		area,
		count: Math.max(0, Math.floor(counts[area] ?? 0)),
		blocksShop: area !== 'admin_text',
	}));
	return { lines, total: lines.filter((line) => line.blocksShop).reduce((sum, line) => sum + line.count, 0) };
}

/** One app's menu and button files: language code → keys missing against English. */
export type ShippedFiles = Readonly<Record<string, number>>;

/**
 * What this release ships, from both apps' files. Only a language in both can be added; a file
 * missing keys is incomplete (CI's parity check normally keeps every shipped file complete).
 */
export function shippedLanguages(admin: ShippedFiles, shop: ShippedFiles): ShippedLanguage[] {
	const codes = orderLocales([...Object.keys(admin), ...Object.keys(shop)].filter(isLocaleCode));
	return codes.map((code) => ({
		code,
		inBoth: code in admin && code in shop,
		adminComplete: admin[code] === 0,
		shopComplete: shop[code] === 0,
	}));
}
