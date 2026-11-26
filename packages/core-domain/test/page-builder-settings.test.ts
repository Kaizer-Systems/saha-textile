import type { PageSettings, ScheduleEntry } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { blockSection, linkedBlockIds, withLinkedBlocks } from '../src/page-builder/blocks';
import { comingUp, pageSettingsGaps, pageSettingsToSave, shopPageSettings } from '../src/page-builder/settings';

const settings = (overrides: Partial<PageSettings> = {}): PageSettings => ({
	title: { en: 'Handloom and Silk Sarees from Kolkata', bn: 'কলকাতার তাঁত ও সিল্ক শাড়ি' },
	description: { en: 'Sarees woven by hand.', bn: 'হাতে বোনা শাড়ি।' },
	heading: { en: 'Saha Textile sarees', bn: 'সাহা টেক্সটাইলের শাড়ি' },
	headingShown: false,
	shareImage: null,
	...overrides,
});

describe('Page settings (P3, SG-6)', () => {
	it('lists what each shop language still lacks; spaces alone are empty', () => {
		expect(pageSettingsGaps(settings(), ['en', 'bn'])).toEqual({});
		expect(
			pageSettingsGaps(settings({ description: { en: 'x', bn: '   ' }, heading: { en: 'h' } }), [
				'en',
				'bn',
				'hi',
			]),
		).toEqual({ bn: ['description', 'heading'], hi: ['title', 'description', 'heading'] });
	});

	it('saves words on one line each and drops empty languages', () => {
		const saved = pageSettingsToSave(
			settings({
				title: { en: '  Sarees \n from   Kolkata ', bn: ' ' },
				shareImage: { assetId: 'med_1', versionId: 'v1' },
			}),
		);
		expect(saved.title).toEqual({ en: 'Sarees from Kolkata' });
		expect(saved.shareImage).toEqual({ assetId: 'med_1', versionId: 'v1' });
	});

	it('gives the shop one language, and null where that language has nothing (the shop keeps its own words)', () => {
		expect(shopPageSettings(settings(), 'bn', 'https://cdn/share.jpg')).toEqual({
			title: 'কলকাতার তাঁত ও সিল্ক শাড়ি',
			description: 'হাতে বোনা শাড়ি।',
			heading: 'সাহা টেক্সটাইলের শাড়ি',
			headingShown: false,
			shareImageUrl: 'https://cdn/share.jpg',
		});
		expect(shopPageSettings(settings(), 'hi', null)).toMatchObject({ title: null, heading: null });
	});
});

describe('Coming up, across every page (SG-17)', () => {
	const entry = (layoutId: string, from: string, until: string | null = null): ScheduleEntry => ({
		revisionId: `rev_${layoutId}`,
		layoutId,
		from,
		until,
		by: null,
	});
	const now = new Date('2026-11-20T00:00:00.000Z');
	const layouts = [
		{ id: 'today', name: "Today's home page" },
		{ id: 'winter', name: 'Winter weddings' },
		{ id: 'puja', name: 'Durga Puja' },
	];

	it('lists switches still ahead, soonest first; past ones and open-ended live ones are left out', () => {
		const rows = comingUp(
			{
				pageType: 'home',
				target: 'page',
				schedule: [
					entry('today', '2026-11-01T00:00:00.000Z'),
					entry('winter', '2026-12-01T00:00:00.000Z', '2027-02-15T18:29:00.000Z'),
					entry('puja', '2026-11-10T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
					entry('puja', '2026-10-01T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
				],
			},
			layouts,
			now,
		);
		expect(rows.map((row) => [row.layoutName, row.state])).toEqual([
			['Durga Puja', 'showing'],
			['Winter weddings', 'coming'],
		]);
		expect(rows[1]).toMatchObject({ pageType: 'home', from: '2026-12-01T00:00:00.000Z' });
	});
});

describe('saved blocks (SG-5, P7)', () => {
	const promo = (id: string, block: { id: string; linked: boolean } | null, heading: string) =>
		({
			id,
			type: 'newsletter',
			title: { en: heading },
			subtitle: {},
			hidden: false,
			block,
		}) as unknown as import('@saha-textile/contracts').PageSection;

	it('draws a linked section from its block, keeping the layout’s own id and hiding; copies stay as they are', () => {
		const sections = [
			promo('a', { id: 'blk_1', linked: true }, 'old'),
			promo('b', { id: 'blk_1', linked: false }, 'copy'),
		];
		const drawn = withLinkedBlocks(sections, new Map([['blk_1', { section: promo('blk_1', null, 'Durga Puja') }]]));
		expect(drawn[0]).toMatchObject({ id: 'a', title: { en: 'Durga Puja' }, block: { id: 'blk_1', linked: true } });
		expect(drawn[1]).toMatchObject({ id: 'b', title: { en: 'copy' } });
		expect(withLinkedBlocks(sections, new Map())[0]).toMatchObject({ title: { en: 'old' } });
		expect(linkedBlockIds([...sections, promo('c', { id: 'blk_1', linked: true }, 'x')])).toEqual(['blk_1']);
		expect(blockSection(sections[0]!, 'blk_9')).toMatchObject({ id: 'blk_9', block: null, hidden: false });
	});
});
