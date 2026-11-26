import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { LabelSheet, barsPath, labelsForLine } from './label-sheet';

import type { PurchaseItemOption } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({ saved: [] as string[] }));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: (name: string) => void h.saved.push(name),
}));

const option = (variantId: string, over: Partial<PurchaseItemOption> = {}) =>
	({
		variantId,
		sku: `SKU-${variantId}`,
		title: 'Red saree',
		optionsLabel: '',
		soldBy: 'piece',
		sellingPriceINR: 15900,
		mrpINR: 18500,
		...over,
	}) as PurchaseItemOption;

function sheet(options: { id?: string; gateway?: object } = {}) {
	const gateway = {
		entry: vi.fn(() =>
			of({
				number: 'PE/26-27/00031',
				lines: [
					{
						variantId: 'v1',
						sku: 'ST-1',
						title: 'A',
						optionsLabel: '',
						soldBy: 'piece',
						sellingPriceINR: 100,
						accepted: 2,
					},
					{
						variantId: 'v2',
						sku: 'ST-2',
						title: 'B',
						optionsLabel: '',
						soldBy: 'metre',
						sellingPriceINR: 50,
						accepted: 15,
					},
					{
						variantId: 'v3',
						sku: 'ST-3',
						title: 'C',
						optionsLabel: '',
						soldBy: 'piece',
						sellingPriceINR: 50,
						accepted: 0,
					},
					{
						variantId: 'v4',
						sku: 'ST-4',
						title: 'D',
						optionsLabel: '',
						soldBy: 'piece',
						sellingPriceINR: 50,
						accepted: null,
					},
				],
			}),
		),
		labelsPdf: vi.fn((_body: unknown) => of(new Blob(['%PDF']))),
		...options.gateway,
	};
	const notifier = { showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(options.id ? { id: options.id } : {}) } },
			},
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(LabelSheet, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(LabelSheet).componentInstance, gateway, notifier };
}
const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
	h.saved = [];
});

describe('barcode labels (l01): the last cases', () => {
	it('one label per piece, one per roll of fabric, none for nothing received; bars only for codes they can draw', () => {
		expect([labelsForLine(0, 'piece'), labelsForLine(3, 'piece'), labelsForLine(15, 'metre')]).toEqual([0, 3, 1]);
		expect(barsPath('ST-1')).toMatchObject({ d: expect.stringMatching(/^M/), width: expect.any(Number) });
		expect(barsPath('শাড়ি')).toBeNull();
	});

	it('fills the labels from a posted entry, skipping lines with nothing received; says why it cannot', async () => {
		const { page } = sheet({ id: 'pe_31' });
		await settle();
		expect(page.entryNumber()).toBe('PE/26-27/00031');
		expect(page.items().map((item) => [item.variantId, item.count])).toEqual([
			['v1', 2],
			['v2', 1],
		]);
		const failing = sheet({ id: 'pe_31', gateway: { entry: vi.fn(() => throwError(() => new Error('down'))) } });
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
	});

	it('adds items, counts them within limits, leaves out what is removed, and lays out the first sheet', () => {
		const { page } = sheet();
		expect(page.entryId()).toBeNull();
		page.add(option('v1'));
		page.add(option('v1'));
		page.add(option('v2', { sku: 'শাড়ি' }));
		page.add(option('v2', { sku: 'শাড়ি' }));
		expect(page.items().map((item) => item.count)).toEqual([2, 2]);
		page.setCount(1, 'abc');
		expect(page.items()[1]?.count).toBe(0);
		page.setCount(1, 5_000);
		expect(page.items()[1]?.count).toBe(1000);
		page.setCount(1, 1);
		page.setStart(3);
		const cells = page.preview();
		expect(cells.slice(0, 5).map((cell) => cell.kind)).toEqual(['used', 'used', 'label', 'label', 'label']);
		expect(cells[4]?.bars).toBeNull();
		expect(cells[5]?.kind).toBe('blank');
		page.toggle('barcode');
		expect(page.preview()[2]?.bars).toBeNull();
		page.toggle('barcode');
		page.remove(1);
		expect(page.total()).toBe(2);
		page.items.update((items) => [...items, { ...(items[0] as (typeof items)[number]), count: Number.NaN }]);
		expect(page.total()).toBe(2);
		page.setStart('x');
		expect(page.startAt()).toBe(1);
		page.setStart(999);
		expect(page.startAt()).toBe(page.perSheet());
		page.setSheet('a4_21');
		expect(page.startAt()).toBe(21);
		expect(page.sheets()).toBeGreaterThan(0);
		expect(page.geometry()).toBeTruthy();
	});

	it('prints only something sensible, with the entry named when it came from one; says why it failed', async () => {
		const loose = sheet();
		expect(loose.page.canPrint()).toBe(false);
		loose.page.add(option('v1'));
		loose.page.items.update((items) => [
			...items,
			{ ...(items[0] as (typeof items)[number]), variantId: 'v0', count: 0 },
		]);
		for (const field of loose.page.fieldsList) loose.page.toggle(field);
		expect(loose.page.canPrint()).toBe(false);
		loose.page.toggle('sku');
		loose.page.busy.set(true);
		expect(loose.page.canPrint()).toBe(false);
		await loose.page.print();
		loose.page.busy.set(false);
		loose.page.setCount(0, 1000);
		loose.page.add(option('v5'));
		loose.page.setCount(2, 999);
		loose.page.add(option('v6'));
		loose.page.setCount(3, 1000);
		expect(loose.page.canPrint()).toBe(false);
		loose.page.setCount(3, 1);
		await loose.page.print();
		expect(loose.gateway.labelsPdf).toHaveBeenCalledWith({
			sheet: 'a4_65',
			startAt: 1,
			fields: ['sku'],
			items: [
				{ variantId: 'v1', count: 1000 },
				{ variantId: 'v5', count: 999 },
				{ variantId: 'v6', count: 1 },
			],
		});
		expect(h.saved).toEqual(['barcode-labels-2000.pdf']);

		const fromEntry = sheet({
			id: 'pe_31',
			gateway: { labelsPdf: vi.fn(() => throwError(() => new Error('down'))) },
		});
		await settle();
		await fromEntry.page.print();
		expect(fromEntry.gateway.labelsPdf).toHaveBeenCalledWith(expect.objectContaining({ purchaseEntryId: 'pe_31' }));
		expect(fromEntry.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		expect(fromEntry.page.busy()).toBe(false);
	});
});
