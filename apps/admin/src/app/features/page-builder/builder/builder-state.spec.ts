import * as CONTRACT from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	ARRANGEMENT_PIECES,
	PIECE_MAX_PICTURES,
	PRODUCT_ROW_CARDS,
	SLIDE_SECONDS,
	UndoHistory,
	WORD_SPOTS,
	clamp,
	linkAllowed,
	duplicateSection,
	freshId,
	insertSection,
	moveSection,
	newSection,
	pictureFor,
	piecesFor,
	removeSection,
} from './builder-state';

describe('builder moves (Page Builder step 5)', () => {
	it('gives each new section a free id and its defaults; banners come with their pieces', () => {
		expect(freshId('newsletter', ['newsletter', 'newsletter_2'])).toBe('newsletter_3');
		const banner = newSection('banner_arrangement', []);
		expect(banner).toMatchObject({ id: 'banner_arrangement', arrangement: 'hero_full', hidden: false });
		expect('pieces' in banner && banner.pieces.map((piece) => piece.name)).toEqual(['main']);
		const promos = newSection('promo_banners', ['promo_banners']);
		expect(promos.id).toBe('promo_banners_2');
		expect('pieces' in promos && promos.pieces.map((piece) => piece.name)).toEqual(['item_1', 'item_2']);
	});

	it('keeps the pictures of pieces with the same name when the arrangement changes', () => {
		const kept = piecesFor('hero_center_sides', [
			{ name: 'main', pictures: [{ x: 1 }] } as never,
			{ name: 'side' },
		]);
		expect(kept.map((piece) => piece.name)).toEqual(['main', 'left', 'right']);
		expect(kept[0]).toMatchObject({ pictures: [{ x: 1 }] });
	});

	it('adds, moves, duplicates and removes sections without touching the list it was given', () => {
		const a = newSection('newsletter', []);
		const b = newSection('recently_viewed', [a.id]);
		const list = insertSection([a], b, null);
		expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
		expect(moveSection(list, 1, 0).map((s) => s.id)).toEqual([b.id, a.id]);
		expect(moveSection(list, 0, 5).map((s) => s.id)).toEqual([a.id, b.id]);
		const copy = duplicateSection(list, a.id);
		expect(copy.sections.map((s) => s.id)).toEqual([a.id, 'newsletter_2', b.id]);
		expect(removeSection(copy.sections, a.id).map((s) => s.id)).toEqual(['newsletter_2', b.id]);
		expect(list).toHaveLength(2);
		expect(insertSection(list, newSection('blog_posts', []), a.id).map((s) => s.type)).toEqual([
			'newsletter',
			'blog_posts',
			'recently_viewed',
		]);
	});

	it('keeps its written-out limits and defaults equal to the contract (the admin imports contract types only)', () => {
		expect(ARRANGEMENT_PIECES).toEqual(CONTRACT.ARRANGEMENT_PIECES);
		expect(PIECE_MAX_PICTURES).toBe(CONTRACT.PIECE_MAX_PICTURES);
		expect(PRODUCT_ROW_CARDS).toEqual(CONTRACT.PRODUCT_ROW_CARDS);
		expect(SLIDE_SECONDS).toEqual(CONTRACT.SLIDE_SECONDS);
		expect([...WORD_SPOTS]).toEqual(CONTRACT.WordSpot.options);
		// Every new section and picture is exactly what the contract makes of it, so a save never meets a refusal.
		for (const type of CONTRACT.SectionType.options) {
			const section = newSection(type, []);
			expect(CONTRACT.PageSection.parse(section)).toEqual(section);
		}
		const picture = pictureFor('med_1', 'v1');
		const parsed = CONTRACT.PageSection.parse({
			id: 'x',
			type: 'promo_banners',
			pieces: [{ name: 'p', pictures: [picture] }],
		});
		expect(parsed.type === 'promo_banners' && parsed.pieces[0]?.pictures[0]).toEqual(picture);
		expect(linkAllowed('/collections/sarees')).toBe(true);
		expect(linkAllowed('https://example.com/x')).toBe(true);
		expect(linkAllowed('//evil.example')).toBe(false);
		expect(linkAllowed('javascript:alert(1)')).toBe(false);
		expect(clamp(40, 4, 12)).toBe(12);
		expect(clamp(Number.NaN, 4, 12)).toBe(4);
	});

	it('makes a picture from the photo and version the picker chose', () => {
		expect(pictureFor('med_1', 'banner_keep_shape.as_is')).toMatchObject({
			images: { desktop: 'med_1' },
			versions: { med_1: 'banner_keep_shape.as_is' },
			spot: 'middle_start',
			ink: 'brand_dark',
		});
	});

	it('undoes and redoes whole states, and a new change clears what was undone (E3)', () => {
		const history = new UndoHistory<number[]>(2);
		history.record([1]);
		history.record([1, 2]);
		history.record([1, 2, 3]);
		expect(history.undo([1, 2, 3, 4])).toEqual([1, 2, 3]);
		expect(history.redo([1, 2, 3])).toEqual([1, 2, 3, 4]);
		expect(history.undo([1, 2, 3, 4])).toEqual([1, 2, 3]);
		expect(history.undo([1, 2, 3])).toEqual([1, 2]);
		expect(history.undo([1, 2])).toBeNull();
		expect(history.canRedo).toBe(true);
		history.record([9]);
		expect(history.canRedo).toBe(false);
	});
});
