import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
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
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return { modal: TestBed.createComponent(type).componentInstance, open, dismissAll };
};

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
		call: (modal: SizeChartModal) => modal.openModal({ id: 1 } as never),
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
		await chart.modal.openModal({ id: 1 } as never);
		expect(chart.modal.image).toEqual({ id: 1 });
	});

	it('closes the deals list', () => {
		const { modal, dismissAll } = render(DealsModal);
		modal.closeModal();
		expect(dismissAll).toHaveBeenCalledOnce();
	});
});
