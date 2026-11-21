import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { AddonSheet } from './addon-sheet';

describe('AddonSheet', () => {
	const render = () => {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: modal }] });
		TestBed.overrideComponent(AddonSheet, { set: { imports: [], template: '', providers: [] } });
		const sheet = TestBed.createComponent(AddonSheet).componentInstance;
		return { sheet, modal };
	};
	const drawn = (sheet: AddonSheet, part: 'part' | 'setPart', snapshot: unknown) =>
		Object.defineProperty(sheet, part, { value: () => ({ snapshot: () => snapshot }) });

	it("starts from the page and follows the part's total and state", () => {
		const { sheet } = render();
		expect(sheet.config()).toBeNull();
		sheet.start({ product: {} as never, basePrice: 10, selections: {}, measurements: {}, mode: 'set' });
		expect(sheet.config()?.mode).toBe('set');
		sheet.onState({ total: 7300, valid: true });
		expect([sheet.total(), sheet.valid()]).toEqual([7300, true]);
		sheet.onState({ total: 7400 });
		expect([sheet.valid(), sheet.pieceCount()]).toEqual([false, null]);
		expect(sheet.pieces()).toBe(0);
		sheet.onState({ total: 7400, pieces: ['a', 'b', 'c'] });
		expect([sheet.pieceCount(), sheet.pieces()]).toEqual([3, 3]);
		sheet.onState({ total: 7400 });
		sheet.start({
			product: { bundle: { components: [{}, {}] } } as never,
			basePrice: 0,
			selections: {},
			measurements: {},
			mode: 'set',
		});
		expect(sheet.pieces()).toBe(2);
	});

	it('hands back nothing before its part is drawn', () => {
		const { sheet, modal } = render();
		Object.defineProperty(sheet, 'part', { value: () => undefined });
		Object.defineProperty(sheet, 'setPart', { value: () => undefined });
		expect(sheet.save()).toBe(false);
		expect(modal.close).not.toHaveBeenCalled();
	});

	it("hands back the add-on's choices on Save", () => {
		const { sheet, modal } = render();
		const snapshot = { selections: { blouse: 'boat' }, measurements: {}, measured: false };
		drawn(sheet, 'part', snapshot);
		expect(sheet.save()).toBe(true);
		expect(modal.close).toHaveBeenCalledWith(snapshot);
	});

	it("hands back the set's choices, marked when Add set to cart was pressed", () => {
		const { sheet, modal } = render();
		Object.defineProperty(sheet, 'part', { value: () => undefined });
		const snapshot = { selections: {}, measurements: { chest: 34 }, measured: true };
		drawn(sheet, 'setPart', snapshot);
		sheet.save(true);
		expect(modal.close).toHaveBeenCalledWith({ ...snapshot, add: true });
	});

	it("names the chosen design and what it adds, for the footer's line", () => {
		const { sheet } = render();
		const product = {
			addon_groups: [
				{
					code: 'blouse',
					terms: [
						{ code: 'none', label: 'No Design', price_delta: 0 },
						{ code: 'boat', label: 'Boat Neck Blouse', price_delta: 750 },
					],
				},
				{ code: 'fall', terms: [{ code: 'pico', label: 'Fall and pico', price_delta: 0 }] },
			],
		};
		sheet.start({ product: product as never, basePrice: 14300, selections: {}, measurements: {}, mode: 'designs' });
		sheet.onState({ total: 14300, selections: { blouse: 'none', fall: 'pico' } });
		expect([sheet.delta(), sheet.addonNames()]).toEqual([0, '']);
		sheet.onState({ total: 15050, selections: { blouse: 'boat', fall: 'pico' } });
		expect([sheet.delta(), sheet.addonNames()]).toEqual([750, 'Boat Neck Blouse']);
		sheet.start({ product: {} as never, basePrice: 0, selections: {}, measurements: {}, mode: 'all' });
		expect(sheet.addonNames()).toBe('');
	});
});
