import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SupplierForm, gstinVerdict } from './supplier-form';
import { SupplierList, toSupplierRow, type SupplierTableRow } from './supplier-list';

import type { SupplierGstinCheck, SupplierListRow } from '@saha-textile/contracts';

const suppliersPage = signal<unknown>(undefined);
const settings = signal<unknown>(undefined);

vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSuppliersQuery: (query: () => unknown) => (query(), { data: suppliersPage }),
}));
vi.mock('@core/purchasing/stock.gateway', () => ({
	injectInventorySettingsQuery: (enabled: () => boolean) => (enabled(), { data: settings }),
}));

const translate = (key: string, params?: Record<string, unknown>) =>
	params ? `${key} ${JSON.stringify(params)}` : key;
const transloco = { translate, getActiveLang: () => 'en', getTranslation: () => ({}) };

function render<T>(
	type: Type<T>,
	gateway: Partial<Record<keyof PurchasingGateway, unknown>>,
	routeId: string | null = null,
) {
	const router = { navigate: vi.fn() };
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	const client = { invalidateQueries: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(routeId ? { id: routeId } : {}) } },
			},
			{
				provide: PurchasingGateway,
				useValue: {
					states: () =>
						of([
							{ code: '19', name: 'West Bengal' },
							{ code: '09', name: 'Uttar Pradesh' },
						]),
					...gateway,
				},
			},
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: transloco },
			{ provide: AuthStore, useValue: { permissions: signal(['setting.index']) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, router, toasts, client };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const check = (over: Partial<SupplierGstinCheck> = {}): SupplierGstinCheck =>
	({
		problem: null,
		expectedLastCharacter: null,
		stateCode: '19',
		pan: 'AAHFS7782K',
		taxType: 'intra_state',
		sameGstin: null,
		samePan: [{ id: 'sup_2', name: 'Branch' }],
		...over,
	}) as SupplierGstinCheck;

const GSTIN = '19AAHFS7782K1Z4';

/** Fills what a new supplier needs besides its GSTIN. */
const fillAddress = (page: SupplierForm) =>
	page.form.patchValue({ legalName: 'Shantipur Tant Ghar', line: '12 Station Road', pin: '741404' });

afterEach(() => {
	vi.useRealTimers();
});

describe('GSTIN verdicts: the remaining answers', () => {
	it('names an unknown State, a wrong shape, a check digit with no answer, and reads State and PAN from the number', () => {
		expect(gstinVerdict(GSTIN, check({ problem: 'state' }))).toMatchObject({ key: 'gstin_state_unknown' });
		expect(gstinVerdict(GSTIN, check({ problem: 'shape' }))).toMatchObject({ key: 'gstin_shape_wrong' });
		expect(gstinVerdict(GSTIN, check({ problem: 'check_digit' }))).toMatchObject({ params: { expected: '' } });
		expect(gstinVerdict(GSTIN, check({ stateCode: null, pan: null, taxType: null } as never))).toEqual({
			kind: 'ok',
			stateCode: '19',
			pan: 'AAHFS7782K',
			taxType: 'inter_state',
		});
	});
});

describe('SupplierForm', () => {
	it('starts a new supplier with the shop’s default terms, unless the terms were already typed', () => {
		settings.set(undefined);
		const { page } = render(SupplierForm, {});
		expect(page.form.controls.paymentTermsDays.value).toBe(30);
		settings.set({ defaultPaymentTermsDays: 15 });
		TestBed.tick();
		expect(page.form.controls.paymentTermsDays.value).toBe(15);
		page.form.controls.paymentTermsDays.markAsDirty();
		page.form.controls.paymentTermsDays.setValue(45);
		settings.set({ defaultPaymentTermsDays: 7 });
		TestBed.tick();
		expect(page.form.controls.paymentTermsDays.value).toBe(45);
	});

	it('checks a full GSTIN after a pause, locks State and PAN from it, and unlocks them when it changes', async () => {
		vi.useFakeTimers();
		const checkGstin = vi
			.fn()
			.mockReturnValueOnce(of(check()))
			.mockReturnValueOnce(of(check({ stateCode: '27', taxType: 'inter_state', samePan: [] })))
			.mockReturnValueOnce(of(check({ sameGstin: { id: 'sup_9', name: 'Old' } } as never)))
			.mockReturnValueOnce(throwError(() => new Error('offline')));
		const { page } = render(SupplierForm, { checkGstin });
		expect(page.stateName()).toBe('');
		expect(page.gstinState()).toBe('');
		expect(page.taxKey()).toBe('tax_igst');
		page.onGstinInput(' 19aahfs 7782k1z4 ');
		expect(page.verdict().kind).toBe('checking');
		await vi.advanceTimersByTimeAsync(350);
		expect(checkGstin).toHaveBeenCalledWith(GSTIN, null);
		expect(page.verdict().kind).toBe('ok');
		expect(page.stateName()).toBe('West Bengal');
		expect(page.gstinState()).toBe('19');
		expect(page.taxKey()).toBe('tax_cgst_sgst');
		expect(page.samePan()).toEqual([{ id: 'sup_2', name: 'Branch' }]);
		expect(page.form.controls.stateCode.disabled).toBe(true);
		expect(page.form.controls.pan.value).toBe('AAHFS7782K');
		// A State the list does not know is named by its code.
		page.onGstinInput('27AAHFS7782K1Z4');
		await vi.advanceTimersByTimeAsync(350);
		expect(page.stateName()).toBe('27');
		expect(page.taxKey()).toBe('tax_igst');
		// Already another supplier's: State and PAN still come from the number.
		page.onGstinInput('09AABCB4521R1Z6');
		await vi.advanceTimersByTimeAsync(350);
		expect(page.verdict().kind).toBe('taken');
		expect(page.samePan()).toEqual([]);
		expect(page.form.controls.stateCode.value).toBe('09');
		expect(page.form.controls.pan.value).toBe('AABCB4521R');
		// A check that could not run is no verdict: nothing locks or unlocks.
		page.onGstinInput('19AAHFS7782K1Z5');
		await vi.advanceTimersByTimeAsync(350);
		expect(page.verdict().kind).toBe('unchecked');
		page.onGstinInput('19AAH');
		await vi.advanceTimersByTimeAsync(350);
		expect(page.verdict().kind).toBe('typing');
		expect(page.form.controls.stateCode.enabled).toBe(true);
		expect(checkGstin).toHaveBeenCalledTimes(4);
	});

	it('saves only a complete supplier, from its GSTIN or, unregistered, from its typed PAN and State', async () => {
		const saveSupplier = vi.fn(() => of({ id: 'sup_new' }));
		const { page, router, toasts } = render(SupplierForm, { saveSupplier, checkGstin: () => of(check()) });
		await page.save();
		expect(page.canSave()).toBe(false);
		fillAddress(page);
		expect(page.canSave()).toBe(false);
		page.form.controls.kind.setValue('unregistered');
		page.form.controls.pan.setValue(' aahfs7782k ');
		expect(page.canSave()).toBe(true);
		expect(page.body()).toMatchObject({ gstin: null, pan: 'AAHFS7782K', stateCode: '19', email: null });
		page.saving.set(true);
		expect(page.canSave()).toBe(false);
		page.saving.set(false);
		page.form.controls.pin.setValue('74');
		expect(page.canSave()).toBe(false);
		page.form.controls.pin.setValue('741404');
		await page.save();
		expect(saveSupplier).toHaveBeenCalledWith(null, expect.objectContaining({ legalName: 'Shantipur Tant Ghar' }));
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_created');
		expect(router.navigate).toHaveBeenCalledWith(['/suppliers', 'sup_new']);
	});

	it('puts the API’s refusals beside their fields, the GSTIN ones on the GSTIN', async () => {
		const refusal = new HttpErrorResponse({
			status: 400,
			error: {
				error: {
					code: 'validation_failed',
					message: 'Request validation failed.',
					issues: [
						{ code: 'gstin_taken', message: 'Already used', path: ['gstin'] },
						{ code: 'pin_shape', message: 'Six digits', path: ['address', 'pin'] },
						{ code: 'legal_name_short', message: 'Too short', path: ['legalName'] },
					],
				},
			},
		});
		const { page, toasts } = render(SupplierForm, { saveSupplier: () => throwError(() => refusal) });
		fillAddress(page);
		page.form.controls.kind.setValue('unregistered');
		await page.save();
		expect(page.serverErrors()).toEqual({
			gstin: 'Already used',
			pin: 'Six digits',
			legal_name_short: 'Too short',
		});
		expect(toasts.showError).toHaveBeenCalledWith('Already used');
		expect(page.saving()).toBe(false);
	});

	it('opens a supplier for editing, saves it as an update, and cancels back to it', async () => {
		vi.useFakeTimers();
		const supplier = {
			id: 'sup_1',
			gstin: null,
			kind: 'unregistered',
			legalName: 'Shantipur Tant Ghar',
			shortName: 'Shantipur Tant Ghar',
			address: { line: '12 Station Road', city: 'Shantipur', pin: '741404' },
			stateCode: '19',
			pan: null,
			contactName: null,
			phone: null,
			email: null,
			paymentTermsDays: 0,
			usesItemCodes: false,
			notes: null,
			active: true,
		};
		const saveSupplier = vi.fn(() => of({ id: 'sup_1' }));
		const { page, router, toasts } = render(SupplierForm, { supplier: () => of(supplier), saveSupplier }, 'sup_1');
		await vi.advanceTimersByTimeAsync(10);
		expect(page.form.controls.shortName.value).toBe('');
		expect(page.form.controls.gstin.value).toBe('');
		settings.set({ defaultPaymentTermsDays: 15 });
		TestBed.tick();
		expect(page.form.controls.paymentTermsDays.value).toBe(0);
		await page.save();
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_updated');
		page.cancel();
		expect(router.navigate).toHaveBeenLastCalledWith(['/suppliers', 'sup_1']);
		const withGstin = render(
			SupplierForm,
			{
				supplier: () => of({ ...supplier, gstin: GSTIN, pan: 'AAHFS7782K', shortName: 'Tant Ghar' }),
				checkGstin: () => of(check()),
			},
			'sup_1',
		);
		await vi.advanceTimersByTimeAsync(400);
		expect(withGstin.page.form.controls.shortName.value).toBe('Tant Ghar');
		expect(withGstin.page.verdict().kind).toBe('ok');
	});

	it('cancels to the list for a new supplier, or one that could not be read', async () => {
		const fresh = render(SupplierForm, {});
		fresh.page.cancel();
		expect(fresh.router.navigate).toHaveBeenCalledWith(['/suppliers']);
		const broken = render(SupplierForm, { supplier: () => throwError(() => new Error('down')) }, 'sup_1');
		await settle();
		expect(broken.toasts.showError).toHaveBeenCalledWith('purchasing_action_failed');
		broken.page.cancel();
		expect(broken.router.navigate).toHaveBeenCalledWith(['/suppliers']);
	});
});

describe('SupplierList: the remaining cases', () => {
	const row = (over: Partial<SupplierListRow> = {}) =>
		({
			id: 'sup_1',
			legalName: 'Banaras Silk Weavers Co-operative Society Ltd',
			shortName: '',
			kind: 'regular',
			gstin: '09AABCB4521R1Z6',
			stateName: 'Uttar Pradesh',
			address: { line: 'D-47', city: 'Varanasi', pin: '221010' },
			paymentTermsDays: 0,
			owedINR: 0,
			purchaseCount: 0,
			lastPurchaseOn: null,
			active: true,
			...over,
		}) as SupplierListRow;

	it('names a supplier without a short name by its legal name, and paid on delivery', () => {
		const out = toSupplierRow(row(), (key: string, count?: number) =>
			count === undefined ? key : `${key}:${count}`,
		);
		expect(out.supplier).toContain('Banaras Silk Weavers Co-operative Society Ltd');
		expect(out.terms).toBe('supplier_terms_on_delivery');
	});

	it('counts nothing before the list loads, restarts filters at page 1, and acts only on a row', () => {
		suppliersPage.set(undefined);
		const deleteSupplier = vi
			.fn()
			.mockReturnValueOnce(of(null))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, router, toasts, client } = render(SupplierList, { deleteSupplier });
		expect(page.counts()).toEqual({ all: 0, owed: 0, inactive: 0 });
		expect(page.tableConfig().data).toEqual([]);
		suppliersPage.set({ items: [row()], total: 1, counts: { all: 1, owed: 0, inactive: 0 } });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		const table = { tableData: { page: 3 } };
		Object.assign(page, { table: () => table });
		page.setFilter('owed');
		expect(table.tableData.page).toBe(1);
		page.onTableChange();
		const target = { id: 'sup_1' } as SupplierTableRow;
		page.onAction({ actionToPerform: 'view' } as never);
		page.onAction({ actionToPerform: 'print', data: target } as never);
		page.onAction({ actionToPerform: 'view', data: target } as never);
		page.onAction({ actionToPerform: 'edit', data: target } as never);
		expect(router.navigate.mock.calls).toEqual([[['/suppliers', 'sup_1']], [['/suppliers', 'sup_1', 'edit']]]);
		page.onAction({ actionToPerform: 'delete', data: target } as never);
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_deleted');
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.onAction({ actionToPerform: 'delete', data: target } as never);
		expect(toasts.showError).toHaveBeenCalledWith('purchasing_action_failed');
	});
});
