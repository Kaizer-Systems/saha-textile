import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SelfInvoiceFormPage } from './self-invoice-form';

/** D2: record a reverse-charge supply. */

const rent = {
	templateCode: 'RS-RCM',
	templateVersion: 1,
	key: 'shop_rent',
	name: 'Rent of the shop (commercial property)',
	code: '997212',
	ratePercent: 18,
	expenseRole: 'rent',
	source: '13/2017',
};
const form = {
	suppliers: [
		{ id: 'sup_bose', name: 'Bose Properties', stateCode: '19' },
		{ id: 'sup_far', name: 'Far Transport', stateCode: '10' },
	],
	choices: [rent],
	placeOfSupply: '19',
};
const draft = {
	id: 'si_1',
	version: 3,
	status: 'draft',
	supplierId: 'sup_bose',
	rule: rent,
	forMonth: '2026-11',
	receivedOn: '2026-11-01',
	taxableINR: 60_000,
};

function setup(options: { id?: string; fail?: string | null; permissions?: string[]; place?: string } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const router = { navigate: vi.fn(async () => true) };
	const fail = () => throwError(() => ({ error: { error: { message: options.fail } } }));
	const gateway = {
		form: vi.fn(() => of({ ...form, placeOfSupply: options.place ?? '19' })),
		get: vi.fn(() => of(draft)),
		create: vi.fn(() => (options.fail ? fail() : of({ ...draft, id: 'si_new', version: 0 }))),
		save: vi.fn(() => (options.fail ? fail() : of({ ...draft, version: 4 }))),
		issue: vi.fn(() => of({ ...draft, id: 'si_1', number: 'SI/26-27/000002', status: 'issued' })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [SelfInvoiceFormPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})) },
			},
			{ provide: Router, useValue: router },
			{ provide: SelfInvoicesGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['accounts.post']) } },
		],
	});
	const fixture = TestBed.createComponent(SelfInvoiceFormPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier, router };
}

describe('a reverse-charge supply (D2)', () => {
	it('works out the tax as typed, within the State or from another, and the 30-day clock', async () => {
		const { fixture, page } = setup();
		expect([page.placeName(), page.choice(), page.ready()]).toEqual(['—', null, false]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.options.data()).toBeTruthy());
		page.supplierId.set('sup_bose');
		page.ruleKey.set('shop_rent');
		page.taxable.set('60,000');
		expect([page.placeName(), page.interState(), page.halfRate()]).toEqual(['West Bengal (19)', false, 9]);
		expect(page.tax()).toMatchObject({ cgstINR: 5_400, sgstINR: 5_400, taxINR: 10_800 });
		expect(page.ready()).toBe(true);
		page.supplierId.set('sup_far');
		expect([page.interState(), page.tax().igstINR]).toEqual([true, 10_800]);
		page.receivedOn.set('2026-11-01');
		expect(page.clock().by).toBe('2026-12-01');
		expect(page.clock().left).toBe(Math.round((Date.parse('2026-12-01') - Date.parse(page.today)) / 86_400_000));
		expect([page.day('2026-11-01'), page.inr(10_800)]).toEqual(['1 Nov 2026', '₹10,800.00']);
		page.taxable.set('abc');
		expect([page.tax().taxINR, page.ready()]).toEqual([0, false]);
		const unknown = setup({ place: '00' });
		unknown.fixture.detectChanges();
		await vi.waitFor(() => expect(unknown.page.placeName()).toBe('00 (00)'));
		expect(setup({ permissions: [] }).page.canPost()).toBe(false);
	});

	it('saves a new draft and opens it, then issues it and opens the self-invoice', async () => {
		const { page, gateway, router, notifier } = setup();
		page.supplierId.set('sup_bose');
		page.ruleKey.set('shop_rent');
		page.taxable.set('60000');
		await page.save();
		expect(gateway.create).toHaveBeenCalledWith(
			expect.objectContaining({
				supplierId: 'sup_bose',
				ruleKey: 'shop_rent',
				taxableINR: 60_000,
				version: null,
			}),
		);
		expect(router.navigate).toHaveBeenCalledWith(['/accounts/self-invoices', 'si_new', 'edit']);
		expect(notifier.showSuccess).toHaveBeenCalled();
		await page.issue();
		expect(gateway.issue).toHaveBeenCalledWith('si_new', 0);
		expect(router.navigate).toHaveBeenLastCalledWith(['/accounts/self-invoices', 'si_1']);
	});

	it('opens a draft with its own values, saves it by version, and says why a save was refused', async () => {
		const { fixture, page, gateway, router } = setup({ id: 'si_1' });
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.taxable()).toBe('60000'));
		expect([page.supplierId(), page.ruleKey(), page.forMonth()]).toEqual(['sup_bose', 'shop_rent', '2026-11']);
		await page.save();
		expect(gateway.save).toHaveBeenCalledWith('si_1', expect.objectContaining({ version: 3 }));
		expect(router.navigate).not.toHaveBeenCalled();
		page.taxable.set('');
		await page.save();
		expect(gateway.save).toHaveBeenLastCalledWith('si_1', expect.objectContaining({ taxableINR: 0, version: 4 }));
		for (const [fail, shown] of [
			['supplier_has_gstin', 'si_problem_supplier_has_gstin'],
			['Network down', 'Network down'],
		]) {
			const refused = setup({ fail });
			await refused.page.save();
			expect(refused.notifier.showError).toHaveBeenCalledWith(expect.stringContaining(shown));
			expect(refused.page.busy()).toBe(false);
		}
	});
});
