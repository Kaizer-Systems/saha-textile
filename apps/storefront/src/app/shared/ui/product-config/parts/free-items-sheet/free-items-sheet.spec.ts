import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { FreeItemsSheet } from './free-items-sheet';
import { freeWith } from '../../set-test-data';

const render = () => {
	const close = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: { close } }] });
	TestBed.overrideComponent(FreeItemsSheet, { set: { imports: [], template: '' } });
	return { sheet: TestBed.createComponent(FreeItemsSheet).componentInstance, close };
};

describe('FreeItemsSheet', () => {
	it('holds what it was opened with', () => {
		const { sheet } = render();
		const start = { pieceName: 'Arni saree', freeWith: freeWith(), picks: null };
		sheet.start(start);
		expect(sheet.config()).toBe(start);
	});

	it('closes with the picks on Done only once they are valid', () => {
		const { sheet, close } = render();
		sheet.done();
		expect(close).not.toHaveBeenCalled();
		sheet.state.set({ picks: [{ productId: 'pc', variantId: 'm' }], valid: true });
		sheet.done();
		expect(close).toHaveBeenCalledWith([{ productId: 'pc', variantId: 'm' }]);
	});

	it('closes with no picks on No thanks', () => {
		const { sheet, close } = render();
		sheet.noThanks();
		expect(close).toHaveBeenCalledWith([]);
	});
});
