import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';

import { DealsModal } from './deals-modal/deals-modal';
import { DeliveryReturnModal } from './delivery-return-modal/delivery-return-modal';
import { SizeChartModal } from './size-chart-modal/size-chart-modal';

const render = <T>(type: new () => T, platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: TranslocoService, useValue: { getActiveLang: () => 'en' } },
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return { modal: TestBed.createComponent(type).componentInstance, open, dismissAll };
};

const guide = { fields: [{ code: 'bust', label: 'Bust', unit: 'in' as const }], rows: [{ size: 'M', values: { bust: 36 } }] };

const cases = [
	{ name: 'DealsModal', type: DealsModal, call: (modal: DealsModal) => modal.openModal() },
	{
		name: 'DeliveryReturnModal',
		type: DeliveryReturnModal,
		call: (modal: DeliveryReturnModal) => modal.openModal('return'),
	},
	{
		name: 'SizeChartModal',
		type: SizeChartModal,
		call: (modal: SizeChartModal) => modal.openModal(guide),
	},
] as const;

describe.each(cases)('$name', ({ type, call }) => {
	const open = (modal: unknown) => (call as (value: unknown) => Promise<void>)(modal);

	it('opens nothing on the server', async () => {
		const parts = render(type as new () => unknown, 'server');
		await open(parts.modal);
		expect(parts.open).not.toHaveBeenCalled();
	});

	it('opens in the browser', async () => {
		const parts = render(type as new () => unknown);
		await open(parts.modal);
		expect(parts.open).toHaveBeenCalledOnce();
		expect((parts.modal as { modalOpen: boolean }).modalOpen).toBe(true);
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const parts = render(type as new () => unknown, 'browser', Promise.reject(reason));
		await open(parts.modal);
		await Promise.resolve();
		await Promise.resolve();
		expect((parts.modal as { closeResult: string }).closeResult).toBe(text);
	});
});

describe('modal details', () => {
	it('remembers the policy and the chart', async () => {
		const policy = render(DeliveryReturnModal);
		await policy.modal.openModal('return');
		expect(policy.modal.policy).toBe('return');
		const chart = render(SizeChartModal);
		await chart.modal.openModal(guide);
		expect(chart.modal.guide()).toBe(guide);
		expect(chart.modal.unit()).toBe('in');
	});

	it('shows a measure in the chosen unit, the way the language writes numbers', async () => {
		const { modal } = render(SizeChartModal);
		await modal.openModal(guide);
		expect(modal.cell(36, 'in')).toBe('36');
		expect(modal.cell(undefined, 'in')).toBe('-');
		expect(modal.cell(25.4, 'cm')).toBe('10');
		modal.unit.set('cm');
		expect(modal.cell(36, 'in')).toBe('91.4');
		expect(modal.cell(90, 'cm')).toBe('90');
	});

	it('closes the deals list', () => {
		const { modal, dismissAll } = render(DealsModal);
		modal.closeModal();
		expect(dismissAll).toHaveBeenCalledOnce();
	});
});
