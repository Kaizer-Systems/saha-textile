import type { PageSection, ScheduleEntry } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	SECTION_COMMON_DEFAULTS,
	SPOT_BINS,
	budgetLines,
	comingUp,
	inkColours,
	layoutChanges,
	layoutLinks,
	layoutProblems,
	layoutStatus,
	liveEntry,
	livePeriods,
	luminance,
	mayDraftPage,
	mayGoLivePage,
	measureWordSpots,
	nextContentChangeAt,
	overlappingEntries,
	pageSettingsToSave,
	pageTypeRules,
	previousLiveEntry,
	readability,
	registerPageType,
	registeredPageTypes,
	sectionHtmlKb,
	shopSections,
	templateSections,
	wordsProblems,
	type LayoutCheckContext,
	type PageTypeRules,
} from '../src/page-builder/index';

const home = pageTypeRules('home') as PageTypeRules;
const sec = (fields: Record<string, unknown>): PageSection =>
	({ ...SECTION_COMMON_DEFAULTS, ...fields }) as unknown as PageSection;
const picture = (desktop: string | null, extra: object = {}) => ({
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
	alt: { en: 'x', bn: 'y' },
	decorative: false,
	from: null,
	until: null,
	...extra,
});
const banner = (id: string, pictures: object[], extra: object = {}) =>
	sec({
		id,
		type: 'banner_arrangement',
		arrangement: 'hero_full',
		phoneSides: 'below_side_by_side',
		pieces: [{ name: 'main', pictures, slider: { seconds: 6, controls: 'bottom_center', after: 'loop' } }],
		...extra,
	});
const entry = (id: string, from: string, until: string | null = null, layoutId = 'l1'): ScheduleEntry =>
	({ layoutId, revisionId: `rev-${id}`, from, until, by: null }) as ScheduleEntry;

describe('page access and the page type registry', () => {
	it('lets a role draft or go live on every page, or on one page type only', () => {
		expect(mayDraftPage(['theme_option.edit'], 'home')).toBe(true);
		expect(mayDraftPage(['page_builder.draft_home'], 'home')).toBe(true);
		expect(mayDraftPage([], 'home')).toBe(false);
		expect(mayGoLivePage(['page_builder.go_live'], 'home')).toBe(true);
		expect(mayGoLivePage(['page_builder.go_live_home'], 'home')).toBe(true);
		expect(mayGoLivePage([], 'home')).toBe(false);
	});

	it('registers a page type once, lists it, and takes it off again', () => {
		const rules = { ...home, key: 'test_page' } as PageTypeRules;
		const remove = registerPageType(rules);
		expect(registeredPageTypes().map((row) => row.key)).toContain('test_page');
		expect(() => registerPageType(rules)).toThrow('Page type test_page is already registered');
		remove();
		expect(pageTypeRules('test_page')).toBeNull();
	});
});

describe('words on pictures: the remaining cases', () => {
	it('reads anything but #rrggbb as black, and darkens an unreadable brand to black', () => {
		expect(luminance('blue')).toBe(0);
		expect(JSON.stringify(inkColours('brand_dark' as never, 'blue'))).toContain('#000000');
	});

	it('scores an empty spot as fully readable', () => {
		expect(readability({ hist: [0, 0, 0, 0] }, 0, 'none' as never, 4.5)).toEqual({
			ratio: 21,
			weakest: 21,
			passes: false,
		});
	});

	it('skips a band with no picture, and a spot the measurement does not cover', () => {
		const hero = (desktop: string | null) => [banner('hero', [picture(desktop, { heading: { en: 'Evenings' } })])];
		expect(wordsProblems(hero(null), '#417394', () => [])).toEqual([]);
		expect(wordsProblems(hero('med_1'), '#417394', () => [])).toEqual([]);
	});
});

describe('Go Live: links, budgets and changes, the remaining cases', () => {
	it('lists only pictures that link somewhere', () => {
		const linked = picture('med_1', { link: { href: '/collections/sarees' } });
		expect(layoutLinks([banner('b', [picture('med_2'), linked])])).toEqual([
			{ sectionId: 'b', piece: 'main', picture: 1, href: '/collections/sarees' },
		]);
	});

	it('budgets the newest blog posts for a section with none chosen, and a page with nothing drawn', () => {
		const posts = sec({ id: 'p', type: 'blog_posts', title: {}, description: {}, postIds: [] });
		const chosen = sec({ id: 'p', type: 'blog_posts', title: {}, description: {}, postIds: ['a', 'b', 'c'] });
		expect(sectionHtmlKb(posts)).toBe(sectionHtmlKb(chosen));
		expect(budgetLines([], home).length).toBeGreaterThan(0);
	});

	it('names hidden-to-shown and new sections, leaves a new hidden one out, and moves nothing without shared sections', () => {
		const live = [banner('a', [picture('med_1')], { hidden: true }), banner('b', [picture('med_2')])];
		const draft = [banner('a', [picture('med_1')]), banner('new', [picture('med_3')], { hidden: true })];
		expect(layoutChanges(live, draft).list).toEqual(
			expect.arrayContaining([{ kind: 'shown', sectionId: 'a', type: 'banner_arrangement' }]),
		);
		expect(layoutChanges(live, draft).list.some((row) => row.sectionId === 'new')).toBe(false);
		expect(layoutChanges(draft, live).list).toEqual(
			expect.arrayContaining([{ kind: 'hidden', sectionId: 'a', type: 'banner_arrangement' }]),
		);
		expect(layoutChanges([banner('x', [picture('med_1')])], [banner('y', [picture('med_1')])]).list).toEqual(
			expect.arrayContaining([{ kind: 'added', sectionId: 'y', type: 'banner_arrangement' }]),
		);
	});

	it('goes back to the latest earlier entry', () => {
		const current = entry('c', '2026-11-20T00:00:00Z');
		const schedule = [entry('a', '2026-11-01T00:00:00Z'), entry('b', '2026-11-10T00:00:00Z'), current];
		expect(previousLiveEntry(schedule, current)?.revisionId).toBe('rev-b');
	});
});

describe('schedules: the remaining cases', () => {
	const now = new Date('2026-11-20T12:00:00Z');

	it('shows the later start when two entries show at once, whatever their order', () => {
		const later = entry('later', '2026-11-15T00:00:00Z');
		expect(liveEntry([later, entry('early', '2026-11-01T00:00:00Z')], now)).toBe(later);
	});

	it('warns only about entries that both end and overlap', () => {
		const a = entry('a', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z');
		const b = entry('b', '2026-11-05T00:00:00Z', '2026-11-15T00:00:00Z');
		expect(overlappingEntries([a, b, entry('c', '2026-11-01T00:00:00Z')])).toEqual([a, b]);
	});

	it('names the next of several coming entries, or the last of several ended ones', () => {
		const coming = [
			entry('x', '2026-12-10T00:00:00Z', '2026-12-20T00:00:00Z'),
			entry('y', '2026-12-01T00:00:00Z', '2026-12-05T00:00:00Z'),
		];
		expect(layoutStatus('l1', coming, now)).toMatchObject({ status: 'scheduled', from: '2026-12-01T00:00:00Z' });
		const ended = [
			entry('p', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z'),
			entry('q', '2026-10-10T00:00:00Z', '2026-10-15T00:00:00Z'),
		];
		expect(layoutStatus('l1', ended, now)).toMatchObject({ status: 'ended', from: '2026-10-10T00:00:00Z' });
	});

	it('joins two stretches of the same entry into one live period', () => {
		const a = entry('a', '2026-11-02T00:00:00Z');
		const c = entry('c', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z');
		const periods = livePeriods([a, c], now);
		expect(periods.map((period) => [period.entry.revisionId, period.until])).toEqual([
			['rev-a', null],
			['rev-c', '2026-11-02T00:00:00.000Z'],
		]);
	});

	it('lists a showing switch by its end, under the layout id when the layout has no name', () => {
		const rows = comingUp(
			{
				pageType: 'home',
				target: 'home',
				schedule: [
					entry('s', '2026-11-19T00:00:00Z', '2026-11-25T00:00:00Z', 'gone'),
					entry('t', '2026-11-30T00:00:00Z'),
				],
			},
			[],
			now,
		);
		expect(rows.map((row) => [row.layoutName, row.state])).toEqual([
			['gone', 'showing'],
			['l1', 'coming'],
		]);
	});
});

describe('the shop’s drawing of a page, checks and settings: the remaining cases', () => {
	const image = () => ({ url: 'https://cdn.example/x.webp', width: 1600, height: 900 }) as never;
	const context = { locale: 'bn', now: new Date('2026-11-20T12:00:00Z'), image };

	it('draws promo banners wide, keeps decorative pictures wordless, and reads each section’s own fields', () => {
		const promo = sec({
			id: 'promo',
			type: 'promo_banners',
			pieces: [
				{
					name: 'left',
					pictures: [picture('med_1', { decorative: true }), picture('med_2', { alt: {} })],
					slider: { seconds: 6, controls: 'bottom_center', after: 'loop' },
				},
			],
		});
		const posts = sec({
			id: 'posts',
			type: 'blog_posts',
			title: { bn: 'ব্লগ' },
			description: { bn: 'নতুন' },
			postIds: ['p1'],
		});
		const letter = sec({ id: 'news', type: 'newsletter', title: { bn: 'চিঠি' }, subtitle: { bn: 'সাপ্তাহিক' } });
		const drawn = shopSections([promo, posts, letter], context);
		expect(drawn[0]?.pieces[0]?.pictures.map((p) => [p.position, p.alt])).toEqual([
			['promo_wide', ''],
			['promo_wide', ''],
		]);
		expect(drawn[1]).toMatchObject({ description: 'নতুন', subtitle: null, sourceIds: ['p1'] });
		expect(drawn[2]).toMatchObject({ description: null, subtitle: 'সাপ্তাহিক' });
	});

	it('has no next change when nothing starts or ends', () => {
		expect(
			nextContentChangeAt(
				[sec({ id: 'r', type: 'recently_viewed', title: {}, from: null, until: null })],
				new Date(),
			),
		).toBeNull();
	});

	it('flags a picture with no desktop file, and skips shapes it can’t measure', () => {
		const checks: LayoutCheckContext = {
			rules: home,
			slot: 'main',
			shopLocales: ['en'],
			picture: (id: string) => (id === 'med_gone' ? null : { ready: true, ratio: null }),
		} as never;
		const problems = layoutProblems(
			[banner('b', [picture(null), picture('med_gone', { versions: { med_gone: 'v1' } }), picture('med_1')])],
			checks,
		);
		expect(problems.map((p) => p.kind)).toContain('picture_missing');
		expect(problems.some((p) => p.kind === 'shape')).toBe(false);
	});

	it('copies a share picture when saving settings', () => {
		const shareImage = { assetId: 'med_1', versionId: null };
		const saved = pageSettingsToSave({
			title: {},
			description: {},
			heading: {},
			headingShown: true,
			shareImage,
		} as never);
		expect(saved.shareImage).toEqual(shareImage);
		expect(saved.shareImage).not.toBe(shareImage);
		const none = pageSettingsToSave({
			title: {},
			description: {},
			heading: {},
			headingShown: false,
			shareImage: null,
		} as never);
		expect(none.shareImage).toBeNull();
	});
});

describe('templates and word spot measuring: the remaining cases', () => {
	it('starts an unknown template from the full-width hero', () => {
		const sections = templateSections('missing' as never, {
			banners: [],
			heroLayout: 'hero_full' as never,
			bringPictures: false,
		});
		expect(sections.length).toBeGreaterThan(0);
	});

	it('skips a ready version that has no files yet', async () => {
		const deps = {
			assets: {
				findById: vi.fn(async () => ({
					id: 'med_1',
					deletedAt: null,
					derivatives: [],
					versions: [{ id: 'v1', state: 'ready' }],
				})),
			},
			storage: { download: vi.fn() },
			analysis: { wordSpots: vi.fn() },
			spots: { setWordSpots: vi.fn() },
		};
		expect(await measureWordSpots(deps as never, { assetId: 'med_1', versionId: 'v1' })).toBe('skipped');
		expect(deps.storage.download).not.toHaveBeenCalled();
		expect(SPOT_BINS).toBeGreaterThan(0);
	});
});
