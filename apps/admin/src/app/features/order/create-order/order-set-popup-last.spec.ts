import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BundleService } from '@data-access/services/bundle.service';

import { OrderSetPopup } from './order-set-popup';

function popup(page: unknown) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
			{ provide: BundleService, useValue: { builder: () => of({ page }) } },
		],
	});
	TestBed.overrideComponent(OrderSetPopup, { set: { imports: [], template: '' } });
	return TestBed.createComponent(OrderSetPopup).componentInstance;
}

describe('Configure a set on Create order: the last cases', () => {
	it('a set the shop cannot show yet offers nothing to pick and is never ready', async () => {
		const set = popup(null);
		await set.start('set1', 'Wedding set');
		expect(set.title()).toBe('Wedding set');
		expect(set.bundle()).toBeNull();
		expect(set.picked('a')).toEqual([]);
		expect(set.sizesNeeded('a')).toEqual([]);
		expect(set.quote()).toEqual({ totalINR: 0, separatelyINR: 0, saveINR: 0, ok: false });
		expect(set.ready()).toBe(false);
		expect(set.money(16_400)).toContain('16,400');
	});

	it('ticks a piece in and out, keeping only as many as the level takes; an extra goes and comes back', () => {
		const set = popup(null);
		set.toggle('a', 's1', 2);
		set.toggle('a', 's2', 2);
		set.toggle('a', 's3', 2);
		expect(set.picked('a')).toEqual(['s2', 's3']);
		set.toggle('a', 's2', 2);
		expect(set.picked('a')).toEqual(['s3']);
		set.toggleExtra('box');
		set.toggleExtra('box');
		expect(set.extras()).toEqual([]);
	});
});
