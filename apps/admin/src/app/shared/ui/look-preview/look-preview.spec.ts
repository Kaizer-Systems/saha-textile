import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { OPTION_LOOKS } from '@core/catalog/option-looks';

import { LookPreview, cropStyle, type LookPreviewValue } from './look-preview';

const values: LookPreviewValue[] = [
	{ label: 'No Design', price: 0, picture: 'no-design-160.webp', hex: '#ffffff' },
	{ label: 'Boat Neck', price: 750, picture: null, hex: '#aa0000', subLabel: 'Deep back' },
	{ label: 'M', subLabel: 'Bust 36 in' },
];

const draw = (look: string, list: LookPreviewValue[] = values, extra: Record<string, string> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ imports: [LookPreview, TranslocoTestingModule.forRoot({ langs: { en: {} } })] });
	const fixture = TestBed.createComponent(LookPreview);
	fixture.componentRef.setInput('look', look);
	fixture.componentRef.setInput('values', list);
	for (const [name, value] of Object.entries(extra)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return fixture.nativeElement as HTMLElement;
};

describe('LookPreview', () => {
	it('draws every look, the first value as chosen', () => {
		for (const look of OPTION_LOOKS.filter((name) => name !== 'dropdown')) {
			const host = draw(look);
			expect(host.querySelector('.lp-list')?.classList.contains(`lp-${look}`)).toBe(true);
			const items = [...host.querySelectorAll('.lp-item')];
			expect(items).toHaveLength(3);
			expect(items.map((item) => item.classList.contains('is-on'))).toEqual([true, false, false]);
		}
	});

	it('shows pictures, grey for a value with none, only in the picture looks', () => {
		const tiles = draw('picture_row');
		expect(tiles.querySelectorAll('img.lp-pic')).toHaveLength(1);
		expect(tiles.querySelectorAll('.lp-blank')).toHaveLength(2);
		expect(draw('rectangle').querySelector('.lp-pic')).toBeNull();
	});

	it('shows the price where the shop does, and the second line only in Size V2', () => {
		const notes = (host: HTMLElement) =>
			[...host.querySelectorAll('.lp-note')].map((note) => note.textContent?.trim());
		expect(notes(draw('picture_row'))).toEqual(['+₹0', '+₹750']);
		expect(notes(draw('picture_chip'))).toEqual([]);
		expect(notes(draw('size_v2'))).toEqual(['Deep back', 'Bust 36 in']);
	});

	it('draws colours from the values, and names on hover where the look shows none', () => {
		const dots = [...draw('colour_chip').querySelectorAll<HTMLElement>('.lp-dot')];
		expect(dots.map((dot) => dot.style.backgroundColor)).toEqual(['rgb(255, 255, 255)', 'rgb(170, 0, 0)', '']);
		const swatches = draw('color_swatch');
		expect(swatches.querySelector('.lp-name')).toBeNull();
		expect(swatches.querySelector('.lp-item')?.getAttribute('title')).toBe('No Design');
		expect(draw('radio').querySelectorAll('.lp-ring')).toHaveLength(3);
	});

	it('draws a dropdown as one closed box, keeps to six values, and shows its note and help', () => {
		const dropdown = draw('dropdown', values, {
			note: 'look_preview_changes',
			help: 'look_preview_help_attribute',
		});
		expect(dropdown.querySelector('.lp-select')?.textContent).toContain('No Design');
		expect(dropdown.querySelector('.look-preview-note')?.textContent).toContain('look_preview_changes');
		expect(dropdown.querySelector('.look-preview-help')?.textContent).toContain('look_preview_help_attribute');
		const many = Array.from({ length: 9 }, (_, index) => ({ label: `V${index}` }));
		expect(draw('rectangle', many).querySelectorAll('.lp-item')).toHaveLength(6);
		expect(draw('rectangle').querySelector('.look-preview-help')).toBeNull();
	});

	it('draws a square of a picture for the swatch cut pop-up, and only the element when compact (brief P11)', () => {
		const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
		const host = draw('image_tile', [{ label: 'Shadow work', picture: 'photo-900.webp', crop }], {
			compact: true,
			help: 'look_preview_help',
		} as never);
		const square = host.querySelector<HTMLElement>('.lp-cut');
		expect(square?.style.backgroundImage).toContain('photo-900.webp');
		expect(square?.style.backgroundSize).toBe('200% 400%');
		expect(square?.style.backgroundPosition).toMatch(/^50% 66\.666/);
		expect(host.querySelector('img.lp-pic')).toBeNull();
		expect(host.querySelector('.look-preview-head')).toBeNull();
		expect(host.querySelector('.look-preview-help')).toBeNull();
		expect(host.querySelector('.look-preview')?.classList.contains('is-compact')).toBe(true);
		// A square as wide as the picture sits at its start.
		expect(cropStyle({ x: 0, y: 0.2, width: 1, height: 0.75 }, 'a.webp')['background-position']).toBe('0% 80%');
	});
});
