import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { MeasurementsSheet } from './measurements-sheet';

describe('MeasurementsSheet', () => {
	const open = () => {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: NgbActiveModal, useValue: modal }] });
		TestBed.overrideComponent(MeasurementsSheet, { set: { imports: [], template: '' } });
		const sheet = TestBed.createComponent(MeasurementsSheet).componentInstance;
		sheet.start({
			heading: 'Suit measurements',
			fields: [{ code: 'bust', label: 'Bust', unit: 'in' }],
			forName: 'Fully Stitched',
			values: { bust: 36 },
			sizeGuide: true,
		});
		return { sheet, modal };
	};

	it('starts from the page’s values and names the form', () => {
		const { sheet } = open();
		expect([sheet.heading(), sheet.forName(), sheet.sizeGuide()]).toEqual([
			'Suit measurements',
			'Fully Stitched',
			true,
		]);
		expect(sheet.initial()).toEqual({ bust: 36 });
	});

	it('saves only a valid form, handing the values back', () => {
		const { sheet, modal } = open();
		sheet.onValue({ bust: 38 });
		sheet.save();
		expect(modal.close).not.toHaveBeenCalled();
		sheet.onValid(true);
		sheet.save();
		expect(modal.close).toHaveBeenCalledWith({ bust: 38 });
	});
});
