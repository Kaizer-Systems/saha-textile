import { describe, expect, it } from 'vitest';

import {
	ARRANGEMENT_PIECES,
	BannerArrangement,
	PageLink,
	PageSection,
	Piece,
	PIECE_MAX_PICTURES,
	PiecePicture,
	ScheduleEntry,
	SECTION_DEFINITIONS,
	SectionType,
} from '../src/index';

const picture = (overrides: Record<string, unknown> = {}) => ({ images: { desktop: 'med_1' }, ...overrides });

describe('Page Builder contracts', () => {
	it('defines every section type once, with a budget (SG-32)', () => {
		for (const type of SectionType.options) {
			expect(SECTION_DEFINITIONS[type].type).toBe(type);
			expect(SECTION_DEFINITIONS[type].schemaVersion).toBeGreaterThan(0);
			expect(SECTION_DEFINITIONS[type].budget.htmlKb).toBeGreaterThan(0);
		}
		expect(Object.keys(SECTION_DEFINITIONS).sort()).toEqual([...SectionType.options].sort());
	});

	it('only banner sections may hold the early picture, and only when first', () => {
		const early = SectionType.options.filter(
			(type) => SECTION_DEFINITIONS[type].budget.firstPicture === 'when_first',
		);
		expect(early.sort()).toEqual(['banner_arrangement', 'promo_banners']);
	});

	it('draws Main first in every arrangement, so reading order is the source order (FX-4)', () => {
		for (const arrangement of BannerArrangement.options) expect(ARRANGEMENT_PIECES[arrangement][0]).toBe('main');
	});

	it('takes shop paths and https addresses as links, and nothing else (FX-22)', () => {
		expect(PageLink.safeParse({ href: '/collections/sarees' }).success).toBe(true);
		expect(PageLink.safeParse({ href: 'https://www.youtube.com/@channel', external: true }).success).toBe(true);
		for (const href of [
			'javascript:alert(1)',
			'http://plain.example',
			'//evil.example/x',
			'collections/sarees',
			'data:text/html,x',
		]) {
			expect(PageLink.safeParse({ href }).success).toBe(false);
		}
	});

	it('refuses a decorative picture that links somewhere, and a picture that stops before it starts', () => {
		expect(PiecePicture.safeParse(picture({ decorative: true, link: { href: '/offer' } })).success).toBe(false);
		expect(PiecePicture.safeParse(picture({ decorative: true })).success).toBe(true);
		const backwards = picture({ from: '2026-12-02T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' });
		expect(PiecePicture.safeParse(backwards).success).toBe(false);
	});

	it('holds at most 10 pictures in a piece and 3 to 15 seconds a slide (Q6 B, Q7 A)', () => {
		const pictures = (n: number) => Array.from({ length: n }, () => picture());
		expect(Piece.safeParse({ name: 'main', pictures: pictures(PIECE_MAX_PICTURES) }).success).toBe(true);
		expect(Piece.safeParse({ name: 'main', pictures: pictures(PIECE_MAX_PICTURES + 1) }).success).toBe(false);
		expect(Piece.parse({ name: 'main' }).slider.seconds).toBe(6);
		expect(Piece.safeParse({ name: 'main', slider: { seconds: 2 } }).success).toBe(false);
		expect(Piece.safeParse({ name: 'main', slider: { seconds: 16 } }).success).toBe(false);
	});

	it('fills a section with its defaults and keeps settings to choices and bounded numbers', () => {
		const row = PageSection.parse({ id: 's1', type: 'product_row' });
		expect(row).toMatchObject({
			type: 'product_row',
			source: 'new_arrivals',
			cards: 8,
			leaveOutSoldOut: true,
			hidden: false,
		});
		expect(row.look).toEqual({
			spaceAbove: 'none',
			spaceBelow: 'm',
			width: 'page',
			align: 'start',
			background: 'none',
		});
		expect(PageSection.safeParse({ id: 's1', type: 'product_row', cards: 13 }).success).toBe(false);
		expect(PageSection.safeParse({ id: 's1', type: 'product_row', look: { width: '742px' } }).success).toBe(false);
		expect(PageSection.safeParse({ id: 's1', type: 'custom_html' }).success).toBe(false);
	});

	it('only ends a scheduled switch after it starts', () => {
		const entry = { revisionId: 'r1', layoutId: 'l1', from: '2026-12-01T00:00:00.000Z' };
		expect(ScheduleEntry.safeParse(entry).success).toBe(true);
		expect(ScheduleEntry.safeParse({ ...entry, until: '2026-11-30T00:00:00.000Z' }).success).toBe(false);
	});
});
