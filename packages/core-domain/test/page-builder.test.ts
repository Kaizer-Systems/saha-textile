import type { ContentBlock, PageSection, ScheduleEntry } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	layoutProblems,
	liveEntry,
	nextSwitchAt,
	overlappingEntries,
	pageTypeRules,
	SECTION_COMMON_DEFAULTS,
	sectionAllowed,
	todaysHomePage,
	type LayoutCheckContext,
	type PageTypeRules,
	type TodaysHomeTitles,
} from '../src/page-builder/index';

const home = pageTypeRules('home') as PageTypeRules;
const both = { en: 'x', bn: 'y' };

/** A section with the contract's defaults (core reads contracts as types only). */
const sec = (fields: Record<string, unknown>): PageSection =>
	({ ...SECTION_COMMON_DEFAULTS, ...fields }) as unknown as PageSection;
const titled = (id: string, type: string, title: Record<string, string>, extra: object = {}) =>
	sec({ id, type, title, ...extra });

const context = (facts: Record<string, { ready: boolean; ratio: number | null }> = {}): LayoutCheckContext => ({
	rules: home,
	slot: 'main',
	shopLocales: ['en', 'bn'],
	picture: (id) => facts[id] ?? { ready: true, ratio: 3.38 },
});

const picture = (desktop: string, extra: object = {}) => ({
	images: { desktop, tablet: null, phone: null },
	localeImages: {},
	versions: {},
	containsText: false,
	heading: {},
	subheading: {},
	ctaLabel: {},
	spot: 'middle_start',
	ink: 'brand_dark',
	backing: 'none',
	link: null,
	alt: both,
	decorative: false,
	from: null,
	until: null,
	...extra,
});
const banner = (pictures: object[]) =>
	sec({
		id: 'hero',
		type: 'banner_arrangement',
		arrangement: 'hero_full',
		phoneSides: 'below_side_by_side',
		pieces: [{ name: 'main', pictures, slider: { seconds: 6, controls: 'bottom_center', after: 'loop' } }],
	});

describe('page types are registered (PG-4)', () => {
	it('knows Home and nothing it was not told about', () => {
		expect(home.kind).toBe('whole_page');
		expect(home.mainHeading).toBe('page_settings');
		expect(pageTypeRules('cart')).toBeNull();
		expect(sectionAllowed(home, 'main', 'product_row')).toBe(true);
		expect(sectionAllowed(home, 'aboveGrid', 'product_row')).toBe(false);
	});

	it('runs every check on a test-only page type with no store, API or screen of its own (PG-8)', () => {
		const testType: PageTypeRules = { ...home, key: 'pb_test', slots: { main: ['newsletter'] } };
		const problems = layoutProblems([titled('r', 'product_row', both), titled('n', 'newsletter', both)], {
			...context(),
			rules: testType,
		});
		expect(problems).toEqual([{ kind: 'not_allowed', sectionId: 'r', type: 'product_row' }]);
	});
});

describe('the schedule is data (FX-6)', () => {
	const entry = (revisionId: string, from: string, until: string | null = null): ScheduleEntry => ({
		revisionId,
		layoutId: 'l',
		from,
		until,
		by: null,
	});
	const schedule = [
		entry('today', '2026-11-01T00:00:00.000Z'),
		entry('winter', '2026-11-30T18:30:00.000Z', '2027-02-15T18:29:00.000Z'),
	];

	it('shows the later start, and hands back when it ends', () => {
		expect(liveEntry(schedule, new Date('2026-11-20T00:00:00Z'))?.revisionId).toBe('today');
		expect(liveEntry(schedule, new Date('2026-12-10T00:00:00Z'))?.revisionId).toBe('winter');
		expect(liveEntry(schedule, new Date('2027-02-16T00:00:00Z'))?.revisionId).toBe('today');
		expect(liveEntry(schedule, new Date('2026-10-01T00:00:00Z'))).toBeNull();
	});

	it('names the next moment the page may change, for the cache (FX-18)', () => {
		expect(nextSwitchAt(schedule, new Date('2026-11-20T00:00:00Z'))?.toISOString()).toBe(
			'2026-11-30T18:30:00.000Z',
		);
		expect(nextSwitchAt(schedule, new Date('2026-12-10T00:00:00Z'))?.toISOString()).toBe(
			'2027-02-15T18:29:00.000Z',
		);
		expect(nextSwitchAt(schedule, new Date('2027-03-01T00:00:00Z'))).toBeNull();
	});

	it('warns about switches that overlap', () => {
		const overlap = [...schedule, entry('sale', '2027-01-01T00:00:00.000Z', '2027-01-10T00:00:00.000Z')];
		expect(
			overlappingEntries(overlap)
				.map((e) => e.revisionId)
				.sort(),
		).toEqual(['sale', 'winter']);
		expect(overlappingEntries(schedule)).toEqual([]);
	});
});

describe('Go Live checks', () => {
	it('needs at least one shown section', () => {
		expect(layoutProblems([], context())).toEqual([{ kind: 'empty' }]);
		expect(layoutProblems([titled('n', 'newsletter', both, { hidden: true })], context())).toEqual([
			{ kind: 'empty' },
		]);
	});

	it('needs every word in every shop language, and only the languages a section shows in (SG-21)', () => {
		expect(layoutProblems([titled('r', 'product_row', { en: 'New' })], context())).toEqual([
			{ kind: 'words', sectionId: 'r', locale: 'bn', field: 'title' },
		]);
		const englishOnly = titled('r', 'product_row', { en: 'New' }, { languages: ['en'] });
		expect(layoutProblems([englishOnly], context())).toEqual([]);
	});

	it('asks for alt text unless decorative, and a heading written once in every language', () => {
		const problems = layoutProblems(
			[
				banner([
					picture('a', { alt: { en: 'Red' } }),
					picture('b', { alt: {}, decorative: true, heading: { en: 'Sale' } }),
				]),
			],
			context(),
		);
		expect(problems).toEqual([
			{ kind: 'words', sectionId: 'hero', piece: 'main', picture: 0, locale: 'bn', field: 'alt' },
			{ kind: 'words', sectionId: 'hero', piece: 'main', picture: 1, locale: 'bn', field: 'heading' },
		]);
	});

	it('waits for pictures still being made, and for a phone picture when Main carries words in its art', () => {
		const problems = layoutProblems(
			[banner([picture('a', { containsText: true }), picture('b')])],
			context({ b: { ready: false, ratio: 3.38 } }),
		);
		expect(problems).toEqual([
			{ kind: 'phone_picture', sectionId: 'hero', piece: 'main', picture: 0 },
			{ kind: 'picture_not_ready', sectionId: 'hero', piece: 'main', picture: 1, assetId: 'b' },
		]);
	});

	it('keeps one shape per piece within 5% (Q2 A), so slides never jump', () => {
		const facts = { a: { ready: true, ratio: 3.38 }, b: { ready: true, ratio: 3.3 }, c: { ready: true, ratio: 2 } };
		expect(layoutProblems([banner([picture('a'), picture('b'), picture('c')])], context(facts))).toEqual([
			{ kind: 'shape', sectionId: 'hero', piece: 'main', picture: 2, band: 'desktop' },
		]);
	});

	it('refuses two sections with one id', () => {
		const a = titled('n', 'newsletter', both);
		expect(layoutProblems([a, a], context())).toContainEqual({ kind: 'duplicate_id', sectionId: 'n' });
	});
});

describe("Today's home page", () => {
	const titles = Object.fromEntries(
		[
			'newArrivals',
			'recentlyViewed',
			'bestsellers',
			'featured',
			'onSale',
			'videos',
			'videosDescription',
			'blog',
			'blogDescription',
			'newsletter',
			'newsletterSubtitle',
		].map((key) => [key, { en: key, bn: `${key}-bn` }]),
	) as unknown as TodaysHomeTitles;
	const block = (
		position: ContentBlock['position'],
		slot: string,
		extra: Partial<ContentBlock> = {},
	): ContentBlock => ({
		id: `${position}-${slot}`,
		key: `home:-:${position}:${slot}`,
		ownerType: 'home',
		ownerId: null,
		position,
		slot,
		images: { desktop: `med_${slot}`, tablet: null, phone: `med_${slot}_p` },
		containsText: false,
		localeImages: {},
		imageVersions: {},
		heading: {},
		subheading: {},
		ctaLabel: {},
		link: null,
		alt: both,
		status: 'active',
		startsAt: null,
		endsAt: null,
		...extra,
	});

	it("makes the full-width hero's slides one slider in Main, promos with a soft backing, then today's rows", () => {
		const sections = todaysHomePage(
			[
				block('hero', 'main'),
				block('hero', 'slide_2'),
				block('hero', 'slide_3', { status: 'draft' }),
				block('promo_wide', 'item_1'),
			],
			'hero_full',
			titles,
		);
		expect(sections.map((s) => s.id)).toEqual([
			'hero',
			'promos',
			'new_arrivals',
			'recently_viewed',
			'bestsellers',
			'featured',
			'on_sale',
			'videos',
			'blog',
			'newsletter',
		]);
		const hero = sections[0];
		if (hero?.type !== 'banner_arrangement') throw new Error('hero first');
		expect(hero.pieces.map((p) => [p.name, p.pictures.length])).toEqual([['main', 2]]);
		expect(hero.pieces[0]?.pictures[0]).toMatchObject({
			ink: 'brand_dark',
			backing: 'none',
			images: { desktop: 'med_main' },
		});
		const promos = sections[1];
		if (promos?.type !== 'promo_banners') throw new Error('promos second');
		expect(promos.pieces[0]?.pictures[0]).toMatchObject({ ink: 'ink', backing: 'soft_light' });
		expect(layoutProblems(sections, context())).toEqual([]);
	});

	it('keeps the arrangement with Main first and its tiles as pieces; no live hero means no hero section', () => {
		const sections = todaysHomePage(
			[block('hero', 'left'), block('hero', 'main'), block('hero', 'right')],
			'hero_center_sides',
			titles,
		);
		const hero = sections[0];
		if (hero?.type !== 'banner_arrangement') throw new Error('hero first');
		expect(hero.arrangement).toBe('hero_center_sides');
		expect(hero.pieces.map((p) => p.name)).toEqual(['main', 'left', 'right']);
		expect(todaysHomePage([], 'hero_full', titles)[0]?.id).toBe('new_arrivals');
	});
});
