import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ActiveLanguages } from '@core/i18n/active-languages';

import { newSection, pictureFor } from './builder-state';
import { PbSectionForm, fromLocalInput, toLocalInput } from './pb-section-form';

import type { PageSection } from '@core/page-builder/page-builder.gateway';

interface Piece {
	name: string;
	pictures: unknown[];
	slider: { seconds: number; controls: string; after: string };
}

function form(section: PageSection, options: { readOnly?: boolean; answer?: unknown } = {}) {
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const result =
				options.answer instanceof Error ? Promise.reject(options.answer) : Promise.resolve(options.answer);
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: ActiveLanguages, useValue: { list: () => ['en', 'bn'] } },
		],
	});
	TestBed.overrideComponent(PbSectionForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PbSectionForm);
	fixture.componentRef.setInput('section', section);
	fixture.componentRef.setInput('locale', 'bn');
	fixture.componentRef.setInput('readOnly', options.readOnly ?? false);
	const c = fixture.componentInstance;
	const out: PageSection[] = [];
	c.changed.subscribe((next) => out.push(next));
	const last = () => out.at(-1) as unknown as Record<string, unknown>;
	return { c, fixture, out, last, modals, instance };
}

const banner = (pictures = 0) => {
	const section = newSection('banner_arrangement', []) as unknown as { pieces: Piece[] };
	(section.pieces[0] as Piece).pictures = Array.from({ length: pictures }, (_, i) => pictureFor(`med_${i}`, null));
	return section as unknown as PageSection;
};

describe('a section’s Content and Look (B2, SG-4, SG-20, SG-21)', () => {
	it('reads and writes words in the language shown, and keeps the others', () => {
		const { c, last } = form({ ...newSection('product_row', []), title: { en: 'New in' } } as PageSection);
		expect(c.text('title')).toBe('');
		expect(c.text('subtitle')).toBe('');
		c.setText('title', 'নতুন');
		expect(last()['title']).toEqual({ en: 'New in', bn: 'নতুন' });
		c.setText('subtitle', 'x');
		expect(last()['subtitle']).toEqual({ bn: 'x' });
	});

	it('sets values, clamps the card count, and changes the look, screens and dates', () => {
		const { c, last } = form(newSection('product_row', []));
		c.set('cards', '99');
		expect(last()['cards']).toBe(12);
		c.set('source', 'tag');
		expect(last()['source']).toBe('tag');
		c.look('background', 'soft');
		expect((last()['look'] as Record<string, string>)['background']).toBe('soft');
		c.screen('phone', false);
		expect((last()['screens'] as Record<string, boolean>)['phone']).toBe(false);
		expect(c.when('from')).toBe('');
		c.setWhen('from', '2026-12-01T10:00');
		expect(last()['from']).toBe('2026-12-01T04:30:00.000Z');
		c.setWhen('until', '');
		expect(last()['until']).toBeNull();
		expect(toLocalInput('2026-12-01T04:30:00.000Z')).toBe('2026-12-01T10:00');
		expect(fromLocalInput('2026-12-01T10:00')).toBe('2026-12-01T04:30:00.000Z');
		const dated = form({ ...newSection('product_row', []), from: '2026-12-01T04:30:00.000Z' } as PageSection);
		expect(dated.c.when('from')).toBe('2026-12-01T10:00');
		expect(c.tab()).toBe('content');
		expect(c.shopLocales).toEqual(['en', 'bn']);
	});

	it('shows in every language or only the ticked ones, never none', () => {
		const { c, last, out } = form(newSection('newsletter', []));
		expect(c.languageOn('bn')).toBe(true);
		c.toggleLanguage('bn', ['en', 'bn']);
		expect(last()['languages']).toEqual(['en']);
		const some = form({ ...newSection('newsletter', []), languages: ['en'] } as PageSection);
		expect(some.c.languageOn('bn')).toBe(false);
		some.c.toggleLanguage('bn', ['en', 'bn']);
		expect(some.last()['languages']).toBe('all');
		some.c.toggleLanguage('en', ['en', 'bn']);
		expect(some.out).toHaveLength(1);
		const two = form({ ...newSection('newsletter', []), languages: ['en'] } as PageSection);
		two.c.toggleLanguage('bn', ['en', 'bn', 'hi']);
		expect(two.last()['languages']).toEqual(['en', 'bn']);
		expect(out).toHaveLength(1);
	});

	it('reads and writes picked product ids, capped at the card limit', () => {
		const { c, last } = form({ ...newSection('product_row', []), sourceIds: ['p1', 'p2'] } as PageSection);
		expect(c.idsText()).toBe('p1, p2');
		c.setIds(' p3, p4  p5,, ' + Array.from({ length: 20 }, (_, i) => `x${i}`).join(' '));
		expect((last()['sourceIds'] as string[]).slice(0, 3)).toEqual(['p3', 'p4', 'p5']);
		expect((last()['sourceIds'] as string[]).length).toBe(12);
		expect(form(newSection('newsletter', [])).c.idsText()).toBe('');
	});

	it('changes nothing while read-only', () => {
		const { c, out } = form(newSection('product_row', []), { readOnly: true });
		c.set('source', 'tag');
		expect(out).toEqual([]);
	});
});

describe('a banner’s pieces and pictures (B3–B6)', () => {
	it('changes the arrangement, keeping the pieces with the same name', () => {
		const { c, last } = form(banner(1));
		expect(c.pieces().length).toBeGreaterThan(0);
		c.arrangement('hero_main_side');
		expect(last()['arrangement']).toBe('hero_main_side');
		expect(form(newSection('newsletter', [])).c.pieces()).toEqual([]);
	});

	it('adds pictures from Media up to the limit, and ignores a closed picker', async () => {
		const picked = Array.from({ length: 12 }, (_, i) => ({ assetId: `new_${i}`, versionId: i ? null : 'v0' }));
		const { c, last, instance } = form(banner(8), { answer: picked });
		await c.addPictures(0);
		expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ already: 8 }));
		expect(((last()['pieces'] as Piece[])[0] as Piece).pictures).toHaveLength(10);
		await c.addPictures(9);
		const closed = form(banner(), { answer: new Error('closed') });
		await closed.c.addPictures(0);
		expect(closed.out).toEqual([]);
		const none = form(banner(), { answer: [] });
		await none.c.addPictures(0);
		expect(none.out).toEqual([]);
		const locked = form(banner(), { readOnly: true, answer: picked });
		await locked.c.addPictures(0);
		expect(locked.modals.open).not.toHaveBeenCalled();
	});

	it('edits one picture, and keeps it when the editor is closed', async () => {
		const edited = { ...pictureFor('med_0', null), containsText: true };
		const { c, last, instance } = form(banner(2), { answer: edited });
		await c.editPicture(0, 0);
		expect(instance.start).toHaveBeenCalledWith(expect.anything(), 'bn', false);
		expect(
			(((last()['pieces'] as Piece[])[0] as Piece).pictures[0] as { containsText: boolean }).containsText,
		).toBe(true);
		await c.editPicture(0, 9);
		await c.editPicture(9, 0);
		const closed = form(banner(2), { answer: null });
		await closed.c.editPicture(0, 0);
		expect(closed.out).toEqual([]);
	});

	it('moves, removes and times the pictures of a piece', () => {
		const { c, last, out } = form(banner(3));
		c.movePicture(0, 0, 2);
		const order = (
			((last()['pieces'] as Piece[])[0] as Piece).pictures as Array<{ images: { desktop: string } }>
		).map((picture) => picture.images.desktop);
		expect(order).toEqual(['med_1', 'med_2', 'med_0']);
		c.movePicture(0, 0, 3);
		c.movePicture(0, 0, -1);
		c.movePicture(9, 0, 1);
		expect(out).toHaveLength(1);
		c.movePicture(0, 7, 1);
		expect(out).toHaveLength(2);
		c.removePicture(0, 1);
		expect(((last()['pieces'] as Piece[])[0] as Piece).pictures).toHaveLength(2);
		c.removePicture(9, 0);
		c.slider(0, 'seconds', 99);
		expect(((last()['pieces'] as Piece[])[0] as Piece).slider.seconds).toBe(15);
		c.slider(0, 'after', 'stop');
		expect(((last()['pieces'] as Piece[])[0] as Piece).slider.after).toBe('stop');
		c.slider(9, 'after', 'stop');
		expect(out).toHaveLength(5);
	});
});
