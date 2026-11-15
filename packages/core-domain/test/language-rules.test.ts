import type { LanguageRecord } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	confirmsLanguageName,
	decideLanguageChange,
	LANGUAGE_REMINDER_DAYS,
	languageReminderDue,
	languageSets,
	languageTodo,
	seedLanguages,
	shippedLanguages,
	withEnglishFixed,
	type LanguageFacts,
} from '../src/catalog/language-rules';

const NOW = '2026-11-15T10:00:00.000Z';
const shipped = (code: string, inBoth = true, adminComplete = true, shopComplete = true) => ({
	code,
	inBoth,
	adminComplete,
	shopComplete,
});
const facts = (overrides: Partial<LanguageFacts> = {}): LanguageFacts => ({
	shipped: shipped('hi'),
	todo: 0,
	...overrides,
});
const [english, bangla] = seedLanguages(['en', 'bn'], NOW) as [LanguageRecord, LanguageRecord];
const draft = (code = 'hi'): LanguageRecord => ({
	...bangla,
	code,
	admin: false,
	shop: 'draft',
	everOn: false,
});

describe('the stored language list', () => {
	it('seeds English first, each language on in both apps', () => {
		const rows = seedLanguages(['bn', 'en', 'bad code'], NOW);
		expect(rows.map((row) => row.code)).toEqual(['en', 'bn']);
		for (const row of rows) expect(row).toMatchObject({ admin: true, shop: 'on', everOn: true, deletedAt: null });
	});

	it('keeps English on and present whatever was stored', () => {
		const broken = { ...english, admin: false, shop: 'off' as const, deletedAt: NOW };
		expect(withEnglishFixed([bangla, broken], NOW)[0]).toMatchObject({
			code: 'en',
			admin: true,
			shop: 'on',
			deletedAt: null,
		});
		expect(withEnglishFixed([bangla], NOW).map((row) => row.code)).toEqual(['en', 'bn']);
	});

	it('builds the shop, content, admin and redirect lists', () => {
		const off = { ...bangla, shop: 'off' as const };
		const deleted = { ...draft('ta'), everOn: true, shop: 'off' as const, deletedAt: NOW };
		const sets = languageSets([english, off, draft('hi'), deleted, { ...draft('gu'), deletedAt: NOW }]);
		expect(sets).toEqual({
			shop: ['en'],
			content: ['en', 'bn', 'hi'],
			admin: ['en', 'bn'],
			redirect: ['bn', 'ta'],
		});
		expect(languageSets([english, bangla])).toEqual({
			shop: ['en', 'bn'],
			content: ['en', 'bn'],
			admin: ['en', 'bn'],
			redirect: [],
		});
	});
});

describe('adding a language', () => {
	it('adds a shipped language as a draft, admin off', () => {
		const decision = decideLanguageChange(null, { kind: 'add', code: 'hi' }, facts(), 'adm_1', NOW);
		expect(decision).toMatchObject({
			ok: true,
			changed: true,
			next: { code: 'hi', admin: false, shop: 'draft', everOn: false, addedBy: 'adm_1', deletedAt: null },
		});
	});

	it('refuses English, a language already there, a bad code and one not in this release', () => {
		expect(decideLanguageChange(english, { kind: 'add', code: 'en' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'already_added',
		});
		expect(decideLanguageChange(draft(), { kind: 'add', code: 'hi' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'already_added',
		});
		expect(decideLanguageChange(null, { kind: 'add', code: 'Hindi' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'unknown_language',
		});
		for (const notShipped of [null, shipped('hi', false)]) {
			expect(
				decideLanguageChange(null, { kind: 'add', code: 'hi' }, facts({ shipped: notShipped }), null, NOW),
			).toEqual({ ok: false, reason: 'not_in_release' });
		}
	});

	it('adds a deleted language back as a draft, remembering that the shop showed it', () => {
		const deleted = { ...bangla, shop: 'off' as const, admin: false, deletedAt: NOW, remindedAt: NOW };
		const decision = decideLanguageChange(deleted, { kind: 'add', code: 'bn' }, facts(), 'adm_2', NOW);
		expect(decision).toMatchObject({
			ok: true,
			next: { code: 'bn', shop: 'draft', admin: false, everOn: true, deletedAt: null, remindedAt: null },
		});
	});
});

describe('the Admin switch (the admin’s own words)', () => {
	it('switches on only when the admin’s file for it is complete', () => {
		expect(decideLanguageChange(draft(), { kind: 'admin', code: 'hi', on: true }, facts(), 'a', NOW)).toMatchObject(
			{ ok: true, changed: true, next: { admin: true, changedBy: 'a' } },
		);
		expect(
			decideLanguageChange(
				draft(),
				{ kind: 'admin', code: 'hi', on: true },
				facts({ shipped: shipped('hi', true, false) }),
				null,
				NOW,
			),
		).toEqual({ ok: false, reason: 'admin_text_incomplete' });
	});

	it('switches off any time, and never touches English', () => {
		expect(
			decideLanguageChange(bangla, { kind: 'admin', code: 'bn', on: false }, facts({ shipped: null }), null, NOW),
		).toMatchObject({ ok: true, next: { admin: false } });
		expect(decideLanguageChange(english, { kind: 'admin', code: 'en', on: false }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'english_fixed',
		});
	});

	it('records nothing when the switch is already where it was asked to be', () => {
		expect(decideLanguageChange(bangla, { kind: 'admin', code: 'bn', on: true }, facts(), null, NOW)).toMatchObject(
			{ ok: true, changed: false },
		);
	});
});

describe('the Shop switch', () => {
	it('switches on only with nothing left to do, and remembers the shop showed it', () => {
		expect(decideLanguageChange(draft(), { kind: 'shop', code: 'hi', on: true }, facts({ todo: 3 }), null, NOW)).toEqual({
			ok: false,
			reason: 'todo_left',
		});
		expect(decideLanguageChange(draft(), { kind: 'shop', code: 'hi', on: true }, facts(), null, NOW)).toMatchObject({
			ok: true,
			next: { shop: 'on', everOn: true },
		});
	});

	it('switches off a shown language, and leaves a draft a draft', () => {
		expect(decideLanguageChange(bangla, { kind: 'shop', code: 'bn', on: false }, facts(), null, NOW)).toMatchObject({
			ok: true,
			changed: true,
			next: { shop: 'off', everOn: true },
		});
		expect(decideLanguageChange(draft(), { kind: 'shop', code: 'hi', on: false }, facts(), null, NOW)).toMatchObject({
			ok: true,
			changed: false,
			next: { shop: 'draft' },
		});
	});

	it('never switches English and never a deleted or unknown language', () => {
		expect(decideLanguageChange(english, { kind: 'shop', code: 'en', on: false }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'english_fixed',
		});
		expect(
			decideLanguageChange({ ...draft(), deletedAt: NOW }, { kind: 'shop', code: 'hi', on: true }, facts(), null, NOW),
		).toEqual({ ok: false, reason: 'unknown_language' });
		expect(decideLanguageChange(null, { kind: 'shop', code: 'hi', on: true }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'unknown_language',
		});
	});
});

describe('delete, the reminder and erase', () => {
	it('deletes only once the shop no longer shows it, and switches the admin off', () => {
		expect(decideLanguageChange(bangla, { kind: 'delete', code: 'bn' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'shop_on',
		});
		const off = { ...bangla, shop: 'off' as const };
		expect(decideLanguageChange(off, { kind: 'delete', code: 'bn' }, facts(), 'adm_1', NOW)).toMatchObject({
			ok: true,
			next: { deletedAt: NOW, deletedBy: 'adm_1', admin: false, shop: 'off' },
		});
		expect(decideLanguageChange(english, { kind: 'delete', code: 'en' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'english_fixed',
		});
	});

	it('reminds after 30 days unused, then every 30 days after “Keep it”, never after erase', () => {
		const deletedOn = new Date('2026-10-01T00:00:00.000Z');
		const deleted = { ...bangla, shop: 'off' as const, deletedAt: deletedOn.toISOString() };
		const day = (n: number) => new Date(deletedOn.getTime() + n * 86_400_000);
		expect(LANGUAGE_REMINDER_DAYS).toBe(30);
		expect(languageReminderDue(deleted, day(29))).toBe(false);
		expect(languageReminderDue(deleted, day(30))).toBe(true);
		const kept = { ...deleted, remindedAt: day(31).toISOString() };
		expect(languageReminderDue(kept, day(60))).toBe(false);
		expect(languageReminderDue(kept, day(61))).toBe(true);
		expect(languageReminderDue({ ...deleted, erasedAt: day(31).toISOString() }, day(90))).toBe(false);
		expect(languageReminderDue(bangla, day(90))).toBe(false);
	});

	it('“Keep it” snoozes the reminder; erase needs the language’s own name typed', () => {
		const deleted = { ...bangla, shop: 'off' as const, deletedAt: NOW };
		expect(decideLanguageChange(deleted, { kind: 'keep', code: 'bn' }, facts(), null, NOW)).toMatchObject({
			ok: true,
			next: { remindedAt: NOW },
		});
		expect(decideLanguageChange(deleted, { kind: 'erase', code: 'bn', typed: 'Bangla' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'name_mismatch',
		});
		expect(
			decideLanguageChange(deleted, { kind: 'erase', code: 'bn', typed: '  বাংলা ' }, facts(), null, NOW),
		).toMatchObject({ ok: true, next: { erasedAt: NOW } });
		expect(
			decideLanguageChange({ ...deleted, erasedAt: NOW }, { kind: 'erase', code: 'bn', typed: 'বাংলা' }, facts(), null, NOW),
		).toEqual({ ok: false, reason: 'already_erased' });
		expect(decideLanguageChange(bangla, { kind: 'erase', code: 'bn', typed: 'বাংলা' }, facts(), null, NOW)).toEqual({
			ok: false,
			reason: 'not_deleted',
		});
	});

	it('matches a typed name in its own script, case and spaces aside', () => {
		expect(confirmsLanguageName('bn', 'বাংলা')).toBe(true);
		expect(confirmsLanguageName('hi', 'हिन्दी')).toBe(true);
		expect(confirmsLanguageName('en', ' english ')).toBe(true);
		expect(confirmsLanguageName('bn', 'bn')).toBe(false);
	});
});

describe('the to-do list', () => {
	it('lists every area in order; the admin’s own words never stop the shop', () => {
		const { lines, total } = languageTodo({ products: 3, admin_text: 40, photos: 2, pages: 4, banners: -1 });
		expect(lines.map((line) => line.area)).toEqual([
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
		expect(lines.find((line) => line.area === 'admin_text')).toEqual({
			area: 'admin_text',
			count: 40,
			blocksShop: false,
		});
		expect(lines.find((line) => line.area === 'banners')?.count).toBe(0);
		expect(total).toBe(9);
	});
});

describe('what this release ships', () => {
	it('offers only languages in both apps, and says whose file is incomplete', () => {
		expect(shippedLanguages({ en: 0, bn: 0, hi: 2 }, { en: 0, bn: 0, ta: 0, hi: 0 })).toEqual([
			{ code: 'en', inBoth: true, adminComplete: true, shopComplete: true },
			{ code: 'bn', inBoth: true, adminComplete: true, shopComplete: true },
			{ code: 'hi', inBoth: true, adminComplete: false, shopComplete: true },
			{ code: 'ta', inBoth: false, adminComplete: false, shopComplete: true },
		]);
	});
});
