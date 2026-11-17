import type { ContentBlock, PageSection, ScheduleEntry } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	DESIGN_NOTE_LIMITS,
	SECTION_COMMON_DEFAULTS,
	budgetLines,
	budgetProblems,
	designNotes,
	layoutChanges,
	layoutLinks,
	layoutSummary,
	linkProblems,
	livePeriods,
	pageSettingsProblems,
	pageTypeRules,
	previousLiveEntry,
	scheduleWithGoLive,
	scheduleWithout,
	shopPath,
	shopPathTarget,
	todaysHomePage,
	type PageTypeRules,
	type TodaysHomeTitles,
} from '../src/page-builder/index';

const home = pageTypeRules('home') as PageTypeRules;
const sec = (fields: Record<string, unknown>): PageSection =>
	({ ...SECTION_COMMON_DEFAULTS, ...fields }) as unknown as PageSection;
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
const row = (id: string, cards = 8, extra: object = {}) =>
	sec({
		id,
		type: 'product_row',
		title: { en: 'x', bn: 'y' },
		source: 'new_arrivals',
		sourceIds: [],
		cards,
		...extra,
	});

describe('links at Go Live (SG-13)', () => {
	it('reads a link as a shop path without language, query, hash or end slash; https is not a shop path', () => {
		const locales = ['en', 'bn'];
		expect(shopPath('/bn/collections/sarees/banarasi/?sort=new#top', locales)).toBe('collections/sarees/banarasi');
		expect(shopPath('/en/', locales)).toBe('');
		expect(shopPath('/', locales)).toBe('');
		expect(shopPath('/product/red-saree', locales)).toBe('product/red-saree');
		expect(shopPath('https://example.com/a', locales)).toBeNull();
		expect(shopPath('//evil.test/a', locales)).toBeNull();
		expect(shopPathTarget('faq')).toEqual({ kind: 'fixed', path: 'faq' });
		expect(shopPathTarget('product/red-saree')).toEqual({ kind: 'product', slug: 'red-saree' });
		expect(shopPathTarget('collections/sarees/banarasi')).toEqual({ kind: 'collection', path: 'sarees/banarasi' });
		expect(shopPathTarget('blog/winter-care')).toEqual({ kind: 'blog_post', slug: 'winter-care' });
		expect(shopPathTarget('product/a/b')).toEqual({ kind: 'unknown', path: 'product/a/b' });
		expect(shopPathTarget('colections/sarees').kind).toBe('unknown');
	});

	it('names each picture whose shop page is not live, and skips hidden sections and outside addresses', () => {
		const sections = [
			banner('hero', [
				picture('a', { link: { href: '/en/collections/winter-shawls', label: {} } }),
				picture('b', { link: { href: '/collections/sarees', label: {} } }),
				picture('c', { link: { href: 'https://instagram.com/x', label: {} } }),
			]),
			banner('old', [picture('d', { link: { href: '/collections/gone', label: {} } })], { hidden: true }),
		];
		expect(layoutLinks(sections)).toHaveLength(3);
		const live = new Set(['collections/sarees']);
		expect(linkProblems(layoutLinks(sections), ['en', 'bn'], (path) => live.has(path))).toEqual([
			{ kind: 'link_gone', sectionId: 'hero', piece: 'main', picture: 0, href: '/en/collections/winter-shawls' },
		]);
	});
});

describe('the main heading and the speed budget (FX-12, SG-9)', () => {
	it('turns missing page settings into problems that open Page settings', () => {
		expect(pageSettingsProblems({ bn: ['title', 'heading'] })).toEqual([
			{ kind: 'page_settings', locale: 'bn', field: 'title' },
			{ kind: 'page_settings', locale: 'bn', field: 'heading' },
		]);
	});

	it("keeps Today's home page inside Home's budget, and counts one early picture and the slider's code", () => {
		const block = (position: ContentBlock['position'], slot: string): ContentBlock =>
			({
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
				alt: { en: 'x', bn: 'y' },
				status: 'active',
				startsAt: null,
				endsAt: null,
			}) as unknown as ContentBlock;
		const titles = new Proxy({}, { get: () => ({ en: 'x', bn: 'y' }) }) as unknown as TodaysHomeTitles;
		const today = todaysHomePage(
			[block('hero', 'main'), block('hero', 'slide_2'), block('hero', 'slide_3'), block('promo_wide', 'item_1')],
			'hero_full',
			titles,
		);
		const lines = budgetLines(today, home);
		expect(lines.find((line) => line.key === 'early_pictures')).toEqual({
			key: 'early_pictures',
			value: 1,
			limit: 1,
		});
		expect(lines.find((line) => line.key === 'first_load_code')?.value).toBe(2.1);
		const html = lines.find((line) => line.key === 'html');
		expect(html?.value).toBeLessThanOrEqual(home.budget.pageHtmlKb);
		expect(html?.value).toBeGreaterThan(70);
		expect(budgetProblems(lines)).toEqual([]);
		expect(layoutSummary(today)).toEqual({ sections: 10, sliders: 1, sliderPictures: 3, earlyPictures: 1 });
	});

	it('holds Go Live when the page grows past its HTML budget, naming the measure', () => {
		const heavy = [banner('hero', [picture('a')]), ...Array.from({ length: 8 }, (_, i) => row(`row_${i}`, 12))];
		expect(budgetProblems(budgetLines(heavy, home))).toEqual([
			expect.objectContaining({ kind: 'budget', measure: 'html', limit: home.budget.pageHtmlKb }),
		]);
		// A product row first: no early picture and no slider code.
		const lines = budgetLines([row('first'), banner('hero', [picture('a'), picture('b')])], home);
		expect(lines.find((line) => line.key === 'early_pictures')?.value).toBe(0);
		expect(lines.find((line) => line.key === 'first_load_code')?.value).toBe(0);
		expect(lines.find((line) => line.key === 'later_code')?.value).toBeGreaterThan(0);
	});

	it('warns, never blocks, on long pages, many sliders and two dark sections in a row (SG-35)', () => {
		const dark = { look: { ...SECTION_COMMON_DEFAULTS.look, background: 'dark' } };
		const sliders = Array.from({ length: DESIGN_NOTE_LIMITS.sliders + 1 }, (_, i) =>
			banner(`b${i}`, [picture('a'), picture('b')]),
		);
		const rows = Array.from({ length: DESIGN_NOTE_LIMITS.sections }, (_, i) => row(`r${i}`));
		expect(designNotes([row('a', 8, dark), row('b', 8, dark)])).toEqual(['dark_in_a_row']);
		expect(designNotes([...sliders, ...rows])).toEqual(['many_sections', 'many_sliders']);
		expect(designNotes([row('a', 8, dark), row('h', 8, { hidden: true }), row('b')])).toEqual([]);
	});
});

describe('what will change on the shop (SG-16)', () => {
	it('lists everything as new the first time', () => {
		const changes = layoutChanges(null, [
			banner('hero', [picture('a'), picture('b')]),
			row('r', 8, { hidden: true }),
		]);
		expect(changes).toEqual({
			firstTime: true,
			list: [{ kind: 'added', sectionId: 'hero', type: 'banner_arrangement' }],
			newPictures: 2,
		});
	});

	it('names added, removed, moved, changed, hidden and shown sections, and counts new pictures', () => {
		const live = [
			banner('hero', [picture('a')]),
			row('new'),
			row('sale'),
			row('gone'),
			row('was_hidden', 8, { hidden: true }),
		];
		const draft = [
			row('sale'),
			banner('hero', [picture('a'), picture('z')]),
			row('new', 12),
			row('was_hidden'),
			row('added'),
		];
		const changes = layoutChanges(live, draft);
		const kinds = changes.list.map((change) => `${change.kind}:${change.sectionId}`);
		expect(kinds).toEqual(
			expect.arrayContaining([
				'moved:sale',
				'changed:hero',
				'changed:new',
				'shown:was_hidden',
				'added:added',
				'removed:gone',
			]),
		);
		// One section moved up past two: only that one is named.
		expect(kinds.filter((kind) => kind.startsWith('moved'))).toEqual(['moved:sale']);
		expect(changes.newPictures).toBe(1);
		expect(layoutChanges(draft, draft).list).toEqual([]);
	});
});

describe('the schedule behind Go Live, Put back and Cancel', () => {
	const now = new Date('2026-12-01T00:00:00.000Z');
	const entry = (revisionId: string, from: string, until: string | null = null): ScheduleEntry => ({
		revisionId,
		layoutId: `lay_${revisionId}`,
		from,
		until,
		by: null,
	});
	const today = entry('rev_today', '2026-11-07T00:00:00.000Z');

	it('adds the switch, and a hand-back to the chosen layout at its end', () => {
		const winter = entry('rev_winter', '2026-12-05T00:00:00.000Z', '2027-02-15T18:29:00.000Z');
		const next = scheduleWithGoLive({
			schedule: [today],
			entry: winter,
			handBack: { revisionId: 'rev_everyday', layoutId: 'lay_everyday' },
			now,
		});
		expect(next).toEqual([
			today,
			winter,
			{ ...entry('rev_everyday', winter.until as string), layoutId: 'lay_everyday' },
		]);
		expect(scheduleWithGoLive({ schedule: [today], entry: winter, handBack: null, now })).toEqual([today, winter]);
	});

	it('refuses a start in the past (beyond a minute) and an end before the start', () => {
		const refuse = (from: string, until: string | null) =>
			scheduleWithGoLive({ schedule: [], entry: entry('r', from, until), handBack: null, now });
		expect(refuse('2026-11-30T23:59:30.000Z', null)).toEqual([entry('r', '2026-11-30T23:59:30.000Z')]);
		expect(refuse('2026-11-30T23:58:00.000Z', null)).toBe('starts_in_past');
		expect(refuse('2026-12-02T00:00:00.000Z', '2026-12-01T12:00:00.000Z')).toBe('ends_before_start');
	});

	it('puts back the layout that showed before the one showing now', () => {
		const puja = entry('rev_puja', '2026-11-20T00:00:00.000Z');
		const again = entry('rev_today', '2026-11-25T00:00:00.000Z');
		expect(previousLiveEntry([today, puja], puja)).toBe(today);
		expect(previousLiveEntry([today, puja, again], again)).toBe(puja);
		expect(previousLiveEntry([today], today)).toBeNull();
		expect(previousLiveEntry([], null)).toBeNull();
	});

	it('cancels only a switch still to come', () => {
		const coming = entry('rev_winter', '2026-12-05T00:00:00.000Z');
		expect(scheduleWithout([today, coming], { revisionId: 'rev_winter', from: coming.from }, now)).toEqual([today]);
		expect(scheduleWithout([today, coming], { revisionId: 'rev_today', from: today.from }, now)).toBeNull();
		expect(scheduleWithout([today], { revisionId: 'nope', from: today.from }, now)).toBeNull();
	});
});

describe('who was live when (SG-23)', () => {
	const entry = (revisionId: string, from: string, until: string | null = null): ScheduleEntry => ({
		revisionId,
		layoutId: `lay_${revisionId}`,
		from,
		until,
		by: null,
	});

	it('cuts the timeline at every start and end, newest first, and leaves the future out', () => {
		const today = entry('today', '2026-11-01T00:00:00.000Z');
		const puja = entry('puja', '2026-11-10T00:00:00.000Z', '2026-11-15T00:00:00.000Z');
		const winter = entry('winter', '2026-12-01T00:00:00.000Z');
		const now = new Date('2026-11-20T00:00:00.000Z');
		expect(livePeriods([today, puja, winter], now).map((p) => [p.entry.revisionId, p.from, p.until])).toEqual([
			['today', '2026-11-15T00:00:00.000Z', null],
			['puja', '2026-11-10T00:00:00.000Z', '2026-11-15T00:00:00.000Z'],
			['today', '2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z'],
		]);
		expect(livePeriods([], now)).toEqual([]);
		expect(livePeriods([today, puja], now, 1)).toHaveLength(1);
	});

	it('joins the pieces of one entry, and skips stretches with nothing showing', () => {
		const first = entry('a', '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z');
		const later = entry('b', '2026-11-08T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
		const now = new Date('2026-11-20T00:00:00.000Z');
		expect(livePeriods([first, later], now).map((p) => [p.entry.revisionId, p.from, p.until])).toEqual([
			['b', '2026-11-08T00:00:00.000Z', '2026-11-09T00:00:00.000Z'],
			['a', '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
		]);
	});
});
