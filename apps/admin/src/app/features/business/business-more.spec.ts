import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BusinessForm } from './business-form';
import { BusinessList } from './business-list';
import { BusinessPage } from './business-page';
import { BusinessReceiptPopup } from './business-receipt-popup';
import { BusinessSetOffPopup } from './business-setoff-popup';
import { BusinessStandingPopup } from './business-standing-popup';

import type { Business, LedgerStatementRow } from '@saha-textile/contracts';

/** Each query is a stand-in read from `h`; the popups answer what `h` says. */
const h = vi.hoisted(() => ({
	business: undefined as unknown,
	receivable: undefined as unknown,
	payable: undefined as unknown,
	balances: undefined as unknown,
	list: undefined as unknown,
	zones: undefined as unknown,
	summary: undefined as unknown,
	reads: [] as Array<() => unknown>,
	reason: 'Paid late twice' as unknown,
	confirm: true,
	payment: vi.fn(async (_id: string, deps: { t: (key: string) => string }) => void deps.t('x')),
	exportStatement: vi.fn((_summary: unknown, t: (key: string) => string) => t('x')),
	bump: (): void => undefined,
}));
/** Sets stand-in answers and makes the pages read them again. */
const put = (values: Record<string, unknown>) => {
	Object.assign(h, values);
	h.bump();
};
vi.mock('@core/business/businesses.gateway', async (original) => {
	const { signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	const make = (read: () => unknown, ...params: Array<(() => unknown) | undefined>) => {
		h.reads.push(() => params.map((param) => param?.()));
		return {
			data: () => {
				version();
				return read();
			},
		};
	};
	return {
		...(await original<typeof import('@core/business/businesses.gateway')>()),
		injectBusinessQuery: (id: () => unknown) => make(() => h.business, id),
		injectBusinessLedgerQuery: (id: () => unknown, side: () => string) =>
			make(() => (side() === 'receivable' ? h.receivable : h.payable), id, side),
		injectBusinessBalancesQuery: (id: () => unknown) => make(() => h.balances, id),
		injectBusinessesQuery: (query: () => unknown) => make(() => h.list, query),
		injectZoneChoicesQuery: (enabled?: () => unknown) => make(() => h.zones, enabled),
	};
});
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSupplierSummaryQuery: (id: () => unknown) => {
		h.reads.push(() => id());
		return { data: () => h.summary };
	},
}));
vi.mock('@features/purchasing/shared/popups', () => ({
	askReason: async (_modals: unknown, options: { act: (reason: string) => Promise<unknown> }) =>
		typeof h.reason === 'string' ? options.act(h.reason) : h.reason,
	askConfirm: async () => h.confirm,
}));
vi.mock('@features/purchasing/shared/supplier-actions', () => ({
	recordSupplierPayment: h.payment,
	exportSupplierStatement: h.exportStatement,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function business(over: Record<string, unknown> = {}): Business {
	return {
		id: 'biz_1',
		legalName: 'Roy Textiles LLP',
		tradeName: 'Roy Textiles',
		businessType: 'llp',
		gstin: '19AABCR1234F1Z5',
		pan: 'AABCR1234F',
		stateCode: '19',
		registeredAddress: { line: '1 College Street', city: 'Kolkata', pin: '700073' },
		contacts: [
			{
				id: 'ct_1',
				name: 'Asha Roy',
				email: 'asha@example.test',
				mobile: { countryCallingCode: '91', number: '9800000000' },
				isAccounts: true,
			},
		],
		roles: {
			customer: { zoneId: 'zone_w', creditLimitINR: 100_000, creditDays: 30, standing: 'active' },
			supplier: true,
		},
		setOff: { mode: 'never' },
		addresses: [],
		notes: null,
		active: true,
		revision: 4,
		...over,
	} as unknown as Business;
}

const popupRef = (result: unknown) => {
	const instance = { start: vi.fn() };
	const promise = result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
	promise.catch(() => undefined);
	return { componentInstance: instance, result: promise };
};

interface Setup {
	id?: string | null;
	permissions?: string[];
	modalResult?: unknown;
}

function services(options: Setup = {}) {
	const gateway = {
		get: vi.fn(() => of(business())),
		save: vi.fn((_id: string | null, _body: unknown) => of(business({ id: 'biz_9' }))),
		setStanding: vi.fn((_id: string, _body: unknown) => of(business())),
		setSetOff: vi.fn((_id: string, _body: unknown) => of(business())),
		addAddress: vi.fn((_id: string, _body: unknown) => of(business({ addresses: [{ id: 'adr_1' }], revision: 5 }))),
		replaceAddress: vi.fn(() => of(business({ addresses: [{ id: 'adr_1' }], revision: 6 }))),
		removeAddress: vi.fn(() => of(business({ addresses: [], revision: 7 }))),
		documentPdf: vi.fn(() => of(new Blob(['%PDF']))),
		reverseSetOff: vi.fn(() => of({})),
		openOrders: vi.fn(() =>
			of([
				{ orderId: 'o2', placedAt: '2026-11-10', dueINR: 500 },
				{ orderId: 'o1', placedAt: '2026-11-01', dueINR: 1000 },
			]),
		),
		recordReceipt: vi.fn((_id: string, _body: unknown) => of({ id: 'rc_1' })),
		recordSetOff: vi.fn((_id: string, _body: unknown) => of({})),
	};
	const purchasing = {
		states: () => of([{ code: '19', name: 'West Bengal' }]),
		checkGstin: vi.fn(() => of({ problem: null, stateCode: '19', pan: 'AABCR1234F', sameGstin: null })),
		supplier: vi.fn(() => of({ kind: 'composition', paymentTermsDays: 45, usesItemCodes: true })),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn() };
	const modals = { open: vi.fn(() => popupRef('modalResult' in options ? options.modalResult : true)) };
	const activeModal = { close: vi.fn() };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	const id = options.id === undefined ? 'biz_1' : options.id;
	const params = convertToParamMap(id ? { id } : {});
	const providers = [
		{ provide: BusinessesGateway, useValue: gateway },
		{ provide: PurchasingGateway, useValue: purchasing },
		{ provide: NotificationService, useValue: notifier },
		{ provide: Router, useValue: router },
		{ provide: NgbModal, useValue: modals },
		{ provide: NgbActiveModal, useValue: activeModal },
		{ provide: QueryClient, useValue: queryClient },
		{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => 'en' } },
		{
			provide: AuthStore,
			useValue: {
				permissions: () => options.permissions ?? ['business.assign', 'business.approve', 'business.settle'],
			},
		},
		{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } },
	];
	return { gateway, purchasing, notifier, router, modals, activeModal, queryClient, providers };
}

function make<T>(type: Type<T>, options: Setup = {}) {
	const s = services(options);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: s.providers });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { ...s, c: fixture.componentInstance, fixture };
}

const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const key of ['business', 'receivable', 'payable', 'balances', 'list', 'zones', 'summary'] as const)
		h[key] = undefined;
	h.reason = 'Paid late twice';
	h.confirm = true;
	h.payment.mockClear();
	h.exportStatement.mockClear();
});

describe('business form: loading and the GSTIN (bz02)', () => {
	it('fills the form from the saved business and its supplier record, and checks the GSTIN', async () => {
		h.zones = [
			{ id: 'zone_b', name: 'Bulk', system: false },
			{ id: 'zone_retail', name: 'RETAIL', system: true },
			{ id: 'zone_a', name: 'Agents', system: false },
		];
		const { c, purchasing } = make(BusinessForm);
		await settle();
		expect(c.form.controls.legalName.value).toBe('Roy Textiles LLP');
		expect(c.form.controls.kind.value).toBe('composition');
		expect(c.form.controls.paymentTermsDays.value).toBe(45);
		expect(c.contacts.length).toBe(1);
		expect(c.zoneRows().map((zone) => zone.id)).toEqual(['zone_retail', 'zone_a', 'zone_b']);
		expect(c.verdict().kind).toBe('checking');
		await vi.advanceTimersByTimeAsync(350);
		expect(purchasing.checkGstin).toHaveBeenCalledWith('19AABCR1234F1Z5', 'biz_1');
		expect(c.verdict().kind).toBe('ok');
		expect(c.stateName()).toBe('West Bengal');
		expect(c.form.controls.stateCode.disabled).toBe(true);
		expect(c.gstinBlocks()).toBe(false);
		for (const read of h.reads) read();
	});

	it('reads an agreement and a business with no contacts, and a supplier record it cannot read', async () => {
		const setup = services();
		setup.gateway.get.mockReturnValue(
			of(
				business({
					contacts: [],
					gstin: null,
					pan: null,
					notes: 'Pays by cheque',
					roles: { customer: null, supplier: false },
					setOff: {
						mode: 'agreement',
						reference: 'STS/2026/04',
						signedOn: '2026-04-01',
						validUntil: null,
						mediaId: 'med_1',
					},
				}),
			),
		);
		setup.purchasing.supplier.mockReturnValue(throwError(() => new Error('not a supplier')));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: setup.providers });
		TestBed.overrideComponent(BusinessForm, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(BusinessForm).componentInstance;
		await settle();
		expect(c.contacts.length).toBe(1);
		expect(c.form.controls.buysFromUs.value).toBe(false);
		expect(c.form.controls.creditDays.value).toBe(30);
		expect(c.form.controls.zoneId.value).toBe('zone_retail');
		expect(c.form.controls.notes.value).toBe('Pays by cheque');
		expect(c.setOffMode()).toBe('agreement');
		expect(c.setOffValidUntil()).toBe('');
		expect(c.setOffCopy()).toEqual({ assetId: 'med_1', name: 'STS/2026/04' });
		expect(c.form.controls.kind.value).toBe('regular');
	});

	it('shows a business it cannot load, and starts a new one empty', async () => {
		const failing = services();
		failing.gateway.get.mockReturnValue(throwError(() => ({ error: { message: 'Not found' } })));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: failing.providers });
		TestBed.overrideComponent(BusinessForm, { set: { imports: [], template: '' } });
		TestBed.createComponent(BusinessForm);
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalledWith('Not found');
		const { c, gateway } = make(BusinessForm, { id: null, permissions: [] });
		expect(gateway.get).not.toHaveBeenCalled();
		expect(c.mayAssignZone()).toBe(false);
		expect(c.zoneRows()).toEqual([]);
		expect(c.stateName()).toBe('');
	});

	it('reads each GSTIN answer: a problem, one taken by another business or this one, and a failed check', async () => {
		const { c, purchasing } = make(BusinessForm, { id: null });
		c.onGstinInput('19aabcr');
		expect(c.verdict().kind).toBe('typing');
		expect(c.gstinBlocks()).toBe(true);
		purchasing.checkGstin.mockReturnValueOnce(of({ problem: 'check_digit', expectedLastCharacter: 'Z' } as never));
		c.onGstinInput('19AABCR1234F1Z6');
		expect(c.gstinBlocks()).toBe(true);
		await vi.advanceTimersByTimeAsync(350);
		expect(c.verdict().kind).toBe('problem');
		purchasing.checkGstin.mockReturnValueOnce(
			of({ problem: null, sameGstin: { id: 'biz_other', name: 'Other' } } as never),
		);
		c.onGstinInput('19AABCR1234F1Z7');
		await vi.advanceTimersByTimeAsync(350);
		expect(c.verdict().kind).toBe('taken');
		expect(c.gstinBlocks()).toBe(true);
		expect(c.form.controls.pan.disabled).toBe(false);
		purchasing.checkGstin.mockReturnValueOnce(throwError(() => new Error('down')));
		c.onGstinInput('19AABCR1234F1Z8');
		await vi.advanceTimersByTimeAsync(350);
		expect(c.check()).toBe('failed');
		expect(c.stateName()).toBe('');
		c.id.set('biz_same');
		purchasing.checkGstin.mockReturnValueOnce(
			of({ problem: null, sameGstin: { id: 'biz_same', name: 'Same' } } as never),
		);
		c.onGstinInput('29AABCR1234F1Z9');
		await vi.advanceTimersByTimeAsync(350);
		expect(c.form.controls.stateCode.value).toBe('29');
		expect(c.gstinBlocks()).toBe(false);
		purchasing.checkGstin.mockReturnValueOnce(of({ problem: null, stateCode: '99', sameGstin: null } as never));
		c.onGstinInput('99AABCR1234F1Z9');
		await vi.advanceTimersByTimeAsync(350);
		expect(c.stateName()).toBe('99');
	});
});

describe('business form: contacts, set-off and delivery addresses (bz02, so01)', () => {
	it('adds, removes and marks the accounts contact', () => {
		const { c } = make(BusinessForm, { id: null });
		c.addContact();
		expect(c.contacts.at(1).value.isAccounts).toBe(false);
		c.setAccounts(1);
		expect(c.contacts.controls.map((group) => group.value.isAccounts)).toEqual([false, true]);
		c.removeContact(0);
		expect(c.contacts.length).toBe(1);
	});

	it('builds the set-off setting only when an agreement is whole, and picks its signed copy', async () => {
		const { c, modals } = make(BusinessForm, {
			id: null,
			modalResult: [{ assetId: 'med_9', name: 'agreement.pdf' }],
		});
		expect(c.setOffSetting()).toEqual({ mode: 'never' });
		c.setOffMode.set('agreement');
		expect(c.setOffSetting()).toBeNull();
		c.setOffReference.set(' STS/1 ');
		c.setOffSignedOn.set('2026-04-01');
		expect(c.setOffSetting()).toBeNull();
		await c.pickSetOffCopy();
		expect(modals.open).toHaveBeenCalled();
		expect(c.setOffSetting()).toEqual({
			mode: 'agreement',
			reference: 'STS/1',
			signedOn: '2026-04-01',
			validUntil: null,
			mediaId: 'med_9',
		});
		c.setOffValidUntil.set('2027-03-31');
		expect(c.setOffSetting()?.mode).toBe('agreement');
		const none = make(BusinessForm, { id: null, modalResult: new Error('closed') });
		await none.c.pickSetOffCopy();
		expect(none.c.setOffCopy()).toBeNull();
		const empty = make(BusinessForm, { id: null, modalResult: [] });
		await empty.c.pickSetOffCopy();
		expect(empty.c.setOffCopy()).toBeNull();
	});

	it('keeps typed addresses on a new business until it is saved', async () => {
		const address = (label: string, isDefault = false) => ({ label, countryCode: 'IN', isDefault, line1: 'x' });
		const results = [address('Shop'), address('Godown', true), null, address('Shop 2', true)];
		const { c, modals } = make(BusinessForm, { id: null });
		modals.open.mockImplementation(() => popupRef(results.shift()) as never);
		await c.openAddress();
		await c.openAddress();
		expect(c.addressRows().map((row) => [row.label, row.isDefault])).toEqual([
			['Shop', false],
			['Godown', true],
		]);
		await c.openAddress(c.addressRows()[0] ?? null);
		expect(c.addressRows()).toHaveLength(2);
		await c.openAddress(c.addressRows()[0] ?? null);
		expect(c.addressRows().map((row) => [row.label, row.isDefault])).toEqual([
			['Shop 2', true],
			['Godown', false],
		]);
		expect(c.addressLine(c.addressRows()[0] as never)).toBeTypeOf('string');
		expect(c.postalLabelKey(c.addressRows()[0] as never)).toBeTypeOf('string');
		expect(c.phoneText(c.addressRows()[0] as never)).toBeTypeOf('string');
		await c.removeAddress(c.addressRows()[1] as never);
		expect(c.addressRows().map((row) => row.label)).toEqual(['Shop 2']);
	});

	it('adds, replaces and removes the addresses of a saved business', async () => {
		const { c, gateway, modals, notifier } = make(BusinessForm);
		await settle();
		await c.openAddress();
		expect(gateway.addAddress).toHaveBeenCalledWith('biz_1', true);
		expect(c.addresses()).toEqual([{ id: 'adr_1' }]);
		await c.openAddress({ id: 'adr_1' } as never);
		expect(gateway.replaceAddress).toHaveBeenCalledWith('biz_1', 'adr_1', true);
		expect(notifier.showSuccess).toHaveBeenCalledWith('cust_address_saved');
		gateway.addAddress.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.openAddress();
		expect(notifier.showError).toHaveBeenCalled();
		h.confirm = false;
		await c.removeAddress({ id: 'adr_1', label: null } as never);
		expect(gateway.removeAddress).not.toHaveBeenCalled();
		h.confirm = true;
		await c.removeAddress({ id: 'adr_1', label: 'Shop' } as never);
		expect(c.addresses()).toEqual([]);
		gateway.removeAddress.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.removeAddress({ id: 'adr_1', label: 'Shop' } as never);
		expect(notifier.showError).toHaveBeenCalledTimes(2);
		modals.open.mockImplementation(() => popupRef(null) as never);
		await c.openAddress();
		expect(gateway.addAddress).toHaveBeenCalledTimes(2);
	});

	it('changes addresses before the business has loaded without touching its revision', async () => {
		const setup = services();
		setup.gateway.get.mockReturnValue(throwError(() => new Error('down')));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: setup.providers });
		TestBed.overrideComponent(BusinessForm, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(BusinessForm).componentInstance;
		await settle();
		await c.openAddress();
		await c.removeAddress({ id: 'adr_1', label: 'Shop' } as never);
		expect(c.body()).not.toHaveProperty('revision');
		c.cancel();
		expect(setup.router.navigate).toHaveBeenCalledWith(['/businesses']);
	});
});

describe('business form: saving (bz02, bz05, so01)', () => {
	async function ready(options: Setup = {}) {
		const made = make(BusinessForm, options);
		await settle();
		await vi.advanceTimersByTimeAsync(350);
		return made;
	}

	it('refuses to save while busy, while the GSTIN blocks, without one, or with no role', async () => {
		const { c } = await ready({ id: null });
		c.form.patchValue({ legalName: 'X', line: 'L', pin: '700001' });
		expect(c.gstinRequired()).toBe(true);
		expect(c.canSave()).toBe(false);
		c.form.controls.kind.setValue('unregistered');
		expect(c.gstinRequired()).toBe(false);
		expect(c.canSave()).toBe(true);
		c.form.patchValue({ buysFromUs: false, sellsToUs: false });
		expect(c.canSave()).toBe(false);
		c.form.patchValue({ buysFromUs: true });
		c.saving.set(true);
		expect(c.canSave()).toBe(false);
		c.saving.set(false);
		c.onGstinInput('19AAB');
		expect(c.canSave()).toBe(false);
		c.onGstinInput('');
		c.form.controls.pin.setValue('12');
		expect(c.canSave()).toBe(false);
		c.form.disable();
		expect(c.canSave()).toBe(true);
	});

	it('writes the body: trimmed text, contacts with a name, both sides and the revision', async () => {
		const { c } = await ready();
		c.addContact();
		c.contacts.at(1).patchValue({ name: '  Bina Das ', email: '', mobile: '', callingCode: '' });
		c.addContact();
		c.contacts.at(2).patchValue({ name: 'Ravi', mobile: '98-300 00000', callingCode: '+-' });
		c.form.patchValue({
			zoneId: '',
			creditLimitINR: '' as never,
			creditDays: '' as never,
			paymentTermsDays: '' as never,
			notes: '  ',
		});
		const body = c.body();
		expect(body).toMatchObject({
			gstin: '19AABCR1234F1Z5',
			pan: 'AABCR1234F',
			stateCode: '19',
			notes: null,
			revision: 4,
		});
		expect(body.contacts).toEqual([
			expect.objectContaining({ id: 'ct_1', name: 'Asha Roy' }),
			{ name: 'Bina Das', role: '', email: null, mobile: null, isAccounts: false },
			expect.objectContaining({ name: 'Ravi', mobile: { countryCallingCode: '91', number: '98-300 00000' } }),
		]);
		expect(body.customer).toEqual({ zoneId: 'zone_retail', creditLimitINR: 0, creditDays: 0 });
		expect(body.supplier).toEqual({ paymentTermsDays: 0, usesItemCodes: true });
		c.onGstinInput('');
		c.form.patchValue({ pan: ' aabcr1234f ', buysFromUs: false, sellsToUs: false });
		expect(c.body()).toMatchObject({ gstin: null, pan: 'AABCR1234F', customer: null, supplier: null });
		c.form.patchValue({ pan: '' });
		expect(c.body().pan).toBeNull();
	});

	it('asks a reason for a new standing, then saves, sets the set-off and goes to the page', async () => {
		const { c, gateway, router, notifier } = await ready();
		c.form.controls.standing.setValue('blocked');
		h.reason = null;
		await c.save();
		expect(gateway.save).not.toHaveBeenCalled();
		h.reason = 'Paid late twice';
		c.setOffMode.set('agreement');
		c.setOffReference.set('STS/1');
		c.setOffSignedOn.set('2026-04-01');
		c.setOffCopy.set({ assetId: 'med_1', name: 'a.pdf' });
		await c.save();
		expect(gateway.setStanding).toHaveBeenCalledWith('biz_9', { standing: 'blocked', reason: 'Paid late twice' });
		expect(gateway.setSetOff).toHaveBeenCalledWith(
			expect.stringMatching(/^biz_/),
			expect.objectContaining({ mode: 'agreement' }),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('biz_updated');
		// The set-off answer is the business as it now stands (biz_1 here); the page opens on it.
		expect(router.navigate).toHaveBeenCalledWith(['/businesses', 'biz_1']);
		c.cancel();
		expect(router.navigate).toHaveBeenLastCalledWith(['/businesses', 'biz_1']);
	});

	it('leaves the set-off alone when unchanged or not allowed, and saves a new business’s typed addresses', async () => {
		const plain = await ready({ permissions: ['business.assign', 'business.approve'] });
		plain.c.setOffMode.set('agreement');
		plain.c.setOffReference.set('STS/1');
		plain.c.setOffSignedOn.set('2026-04-01');
		plain.c.setOffCopy.set({ assetId: 'med_1', name: 'a.pdf' });
		await plain.c.save();
		expect(plain.gateway.setSetOff).not.toHaveBeenCalled();
		const unchanged = await ready();
		await unchanged.c.save();
		expect(unchanged.gateway.setSetOff).not.toHaveBeenCalled();
		const customerOnly = await ready();
		customerOnly.c.form.controls.sellsToUs.setValue(false);
		await customerOnly.c.save();
		expect(customerOnly.gateway.setSetOff).not.toHaveBeenCalled();
		const incomplete = await ready();
		incomplete.c.setOffMode.set('agreement');
		await incomplete.c.save();
		expect(incomplete.gateway.setSetOff).not.toHaveBeenCalled();
		const supplierOnly = await ready();
		supplierOnly.c.form.controls.buysFromUs.setValue(false);
		supplierOnly.c.form.controls.standing.setValue('blocked');
		await supplierOnly.c.save();
		expect(supplierOnly.gateway.setStanding).not.toHaveBeenCalled();
		const created = await ready({ id: null });
		created.c.form.patchValue({ legalName: 'New', line: 'L', pin: '700001', kind: 'unregistered' });
		created.c.draftAddresses.set([{ label: 'A' } as never, { label: 'B' } as never]);
		await created.c.save();
		expect(created.gateway.addAddress).toHaveBeenCalledTimes(2);
		expect(created.notifier.showSuccess).toHaveBeenCalledWith('biz_created');
		created.c.form.controls.legalName.setValue('');
		await created.c.save();
		expect(created.gateway.save).toHaveBeenCalledTimes(1);
	});

	it('puts each refusal beside its field', async () => {
		const { c, gateway, notifier } = await ready();
		gateway.save.mockReturnValueOnce(
			throwError(() => ({
				error: {
					issues: [
						{ code: 'gstin_taken', message: 'Already used', path: ['gstin'] },
						{ code: 'pin_bad', message: 'Bad PIN', path: ['registeredAddress', 'pin'] },
						{ code: 'name_long', message: 'Too long' },
					],
				},
			})),
		);
		await c.save();
		expect(c.serverErrors()['gstin']).toBe('Already used');
		expect(Object.values(c.serverErrors())).toContain('Bad PIN');
		expect(Object.values(c.serverErrors())).toContain('Too long');
		expect(notifier.showError).toHaveBeenCalled();
		expect(c.saving()).toBe(false);
		c.onGstinInput('19AABCR1234F1Z5');
		expect(c.serverErrors()['gstin']).toBeUndefined();
	});
});

describe('business page (bz03, bz04, so04)', () => {
	const ledgerRow = (over: Partial<LedgerStatementRow> = {}): LedgerStatementRow =>
		({
			id: 'le_1',
			at: '2026-11-04T05:00:00.000Z',
			kind: 'orderOnAccount',
			side: 'receivable',
			documentType: 'invoice',
			documentId: 'doc_1',
			documentNumber: 'ST-1',
			amountINR: 1000,
			balanceINR: 1000,
			dueOn: null,
			reversalOf: null,
			agreement: null,
			...over,
		}) as unknown as LedgerStatementRow;

	it('reads balances, credit and activity from both accounts', () => {
		const empty = make(BusinessPage, { id: null });
		expect(empty.c.business()).toBeNull();
		expect(empty.c.owesUs()).toBe(0);
		expect(empty.c.weOwe()).toBe(0);
		expect(empty.c.available()).toBe(0);
		expect(empty.c.usedPercent()).toBe(0);
		expect(empty.c.zoneName()).toBe('');
		h.business = business();
		h.zones = [{ id: 'zone_w', name: 'Wholesale' }];
		h.receivable = {
			closingINR: 40_000,
			rows: [
				ledgerRow({ id: 'so_1', kind: 'setOff', at: '2026-11-05T00:00:00.000Z' }),
				ledgerRow({ id: 'so_2', kind: 'setOff', at: '2026-11-07T00:00:00.000Z' }),
				ledgerRow({
					id: 'rev_1',
					kind: 'setOffReversal',
					reversalOf: 'so_2',
					at: '2026-11-08T00:00:00.000Z',
				} as never),
			],
		};
		h.payable = { rows: [ledgerRow({ id: 'p_1', side: 'payable', at: '2026-11-06T00:00:00.000Z' })] };
		const { c } = make(BusinessPage);
		expect(c.zoneName()).toBe('Wholesale');
		expect(c.owesUs()).toBe(40_000);
		expect(c.available()).toBe(60_000);
		expect(c.usedPercent()).toBe(40);
		expect(c.setOffRows().map((row) => row.id)).toEqual(['so_1']);
		expect(c.supplierEntries()).toHaveLength(1);
		expect(c.activity().map((row) => row.id)).toEqual(['rev_1', 'so_2', 'p_1', 'so_1']);
		put({ balances: { theyOweUsINR: 250_000, weOweThemINR: -5 } });
		expect(c.owesUs()).toBe(250_000);
		expect(c.usedPercent()).toBe(100);
		expect(c.available()).toBe(0);
		expect(c.weOwe()).toBe(0);
		put({ zones: [] });
		expect(c.zoneName()).toBe('zone_w');
		put({ business: business({ roles: { customer: null, supplier: false } }) });
		expect(c.zoneName()).toBe('');
		expect(c.usedPercent()).toBe(0);
		for (const read of h.reads) read();
		c.tab.set('supplier');
		put({ business: business() });
		for (const read of h.reads) read();
	});

	it('words each document, and prints receipts and journal vouchers', async () => {
		h.business = business({
			setOff: {
				mode: 'agreement',
				reference: 'STS/2026/04',
				signedOn: '2026-04-01',
				validUntil: null,
				mediaId: 'm',
			},
		});
		const { c, gateway, notifier } = make(BusinessPage);
		expect(c.documentWords(ledgerRow({ kind: 'setOff', agreement: { reference: 'OWN/1' } } as never))).toBe(
			'biz_setoff_row_customer(ST-1) · biz_setoff_row_agreement(OWN/1)',
		);
		expect(c.documentWords(ledgerRow({ kind: 'setOff', side: 'payable', documentNumber: null }))).toBe(
			'biz_setoff_row_supplier() · biz_setoff_row_agreement(STS/2026/04)',
		);
		put({ business: business() });
		expect(c.documentWords(ledgerRow({ kind: 'setOff' }))).toBe('biz_setoff_row_customer(ST-1)');
		put({ business: undefined });
		expect(c.documentWords(ledgerRow({ kind: 'setOff' }))).toBe('biz_setoff_row_customer(ST-1)');
		expect(c.documentWords(ledgerRow())).toBe('biz_entry_orderOnAccount · ST-1');
		expect(c.documentWords(ledgerRow({ documentNumber: null }))).toBe('biz_entry_orderOnAccount');
		expect(c.printable(ledgerRow({ documentType: 'receipt' } as never))).toBe(true);
		expect(c.printable(ledgerRow({ documentType: 'journal' } as never))).toBe(true);
		expect(c.printable(ledgerRow())).toBe(false);
		expect(c.day('2026-11-04')).toBeTypeOf('string');
		expect(c.money(1500)).toBe('₹1,500');
		const create = vi.fn(() => 'blob:1');
		const revoke = vi.fn();
		const urls = URL as unknown as Record<string, unknown>;
		urls['createObjectURL'] = create;
		urls['revokeObjectURL'] = revoke;
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await c.printDocument(ledgerRow());
		expect(open).toHaveBeenCalledWith('blob:1', '_blank', 'noopener');
		vi.advanceTimersByTime(60_000);
		expect(revoke).toHaveBeenCalledWith('blob:1');
		gateway.documentPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.printDocument(ledgerRow());
		expect(notifier.showError).toHaveBeenCalledWith('print_failed');
		const none = make(BusinessPage, { id: null });
		await none.c.printDocument(ledgerRow());
		expect(none.gateway.documentPdf).not.toHaveBeenCalled();
		delete urls['createObjectURL'];
		delete urls['revokeObjectURL'];
	});

	it('opens the receipt, set-off and standing popups, and refreshes when they save', async () => {
		const empty = make(BusinessPage, { id: null });
		await empty.c.recordReceipt();
		await empty.c.recordSetOff();
		await empty.c.changeStanding();
		await empty.c.reverseSetOff(ledgerRow());
		await empty.c.recordSupplierPayment();
		empty.c.exportStatement();
		empty.c.exportSupplierStatement();
		expect(empty.modals.open).not.toHaveBeenCalled();
		expect(h.payment).not.toHaveBeenCalled();
		h.business = business();
		h.balances = { theyOweUsINR: 1000, weOweThemINR: 400 };
		const { c, modals, notifier, gateway } = make(BusinessPage);
		await c.recordReceipt();
		await c.recordSetOff();
		await c.changeStanding();
		expect(modals.open).toHaveBeenCalledTimes(3);
		expect(notifier.showSuccess).toHaveBeenCalledWith('biz_receipt_saved');
		expect(notifier.showSuccess).toHaveBeenCalledWith('biz_setoff_saved');
		expect(notifier.showSuccess).toHaveBeenCalledWith('biz_standing_saved');
		await c.reverseSetOff(ledgerRow({ documentNumber: null }));
		expect(gateway.reverseSetOff).toHaveBeenCalledWith('biz_1', 'doc_1', { reason: 'Paid late twice' });
		h.reason = null;
		await c.reverseSetOff(ledgerRow());
		expect(gateway.reverseSetOff).toHaveBeenCalledTimes(1);
		await c.recordSupplierPayment();
		expect(h.payment).toHaveBeenCalledWith('biz_1', expect.objectContaining({ modals }));
		h.summary = { rows: [] };
		c.exportSupplierStatement();
		expect(h.exportStatement).toHaveBeenCalled();
		const closed = make(BusinessPage, { modalResult: new Error('closed') });
		await closed.c.recordReceipt();
		await closed.c.recordSetOff();
		await closed.c.changeStanding();
		expect(closed.notifier.showSuccess).not.toHaveBeenCalled();
		h.business = business({ roles: { customer: null, supplier: true } });
		const supplier = make(BusinessPage);
		await supplier.c.changeStanding();
		expect(supplier.modals.open).not.toHaveBeenCalled();
		h.balances = undefined;
		await supplier.c.recordSetOff();
		expect(supplier.modals.open).not.toHaveBeenCalled();
	});

	it('exports the customer statement as a CSV file named after the business', () => {
		h.business = business({ tradeName: '' });
		h.receivable = { closingINR: 0, rows: [ledgerRow()] };
		const { c } = make(BusinessPage);
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		const urls = URL as unknown as Record<string, unknown>;
		urls['createObjectURL'] = () => 'blob:csv';
		urls['revokeObjectURL'] = vi.fn();
		c.exportStatement();
		expect(click).toHaveBeenCalled();
		put({ business: business() });
		c.exportStatement();
		expect(click).toHaveBeenCalledTimes(2);
		delete urls['createObjectURL'];
		delete urls['revokeObjectURL'];
	});
});

describe('business list (bz01)', () => {
	it('fills the table, counts each filter and pages it', () => {
		const empty = make(BusinessList);
		expect(empty.c.counts()).toEqual({ all: 0, customer: 0, supplier: 0, creditOnHold: 0, blocked: 0 });
		expect(empty.c.tableConfig().total).toBe(0);
		h.list = {
			items: [
				{
					id: 'biz_1',
					legalName: 'Roy Textiles LLP',
					tradeName: 'Roy Textiles',
					gstin: null,
					stateName: 'West Bengal',
					sellsToUs: true,
					buysFromUs: true,
					zone: null,
					creditLimitINR: 0,
					creditUsedINR: 0,
					owesUsINR: 0,
					weOweINR: 0,
					standing: 'active',
					active: true,
				},
			],
			total: 1,
			counts: { all: 1, customer: 1, supplier: 1, creditOnHold: 0, blocked: 0 },
		};
		const { c, router } = make(BusinessList);
		expect(c.tableConfig().total).toBe(1);
		expect(c.counts().supplier).toBe(1);
		for (const read of h.reads) read();
		c.setFilter('supplier');
		const tableData: Record<string, unknown> = { page: 3 };
		Object.defineProperty(c, 'table', { value: () => ({ tableData }) });
		c.setFilter('blocked');
		expect(tableData['page']).toBe(1);
		c.onTableChange({ page: 2 });
		c.onTableChange();
		c.onAction({ actionToPerform: 'view' } as never);
		expect(router.navigate).not.toHaveBeenCalled();
		c.onAction({ actionToPerform: 'edit', data: { id: 'biz_1' } } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/businesses', 'biz_1', 'edit']);
		c.onAction({ actionToPerform: 'view', data: { id: 'biz_1' } } as never);
		expect(router.navigate).toHaveBeenLastCalledWith(['/businesses', 'biz_1']);
	});
});

describe('the business popups’ remaining cases (bz05, bz06, so02)', () => {
	function popup<T>(type: Type<T>) {
		const s = services();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: s.providers });
		TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
		return { ...s, c: TestBed.createComponent(type).componentInstance };
	}

	it('receipt: refills the split until changed by hand, and refuses a share that is not a number', async () => {
		const { c, gateway, activeModal } = popup(BusinessReceiptPopup);
		await c.save();
		expect(c.amountWords()).toBe('₹0');
		gateway.openOrders.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.start(business());
		expect(c.error()).toBe('ord_action_failed');
		await c.start(business());
		c.setAmount('1200');
		expect(c.shares().map((share) => share.amount)).toEqual(['1000', '200']);
		expect(c.day(null)).toBe('—');
		expect(c.day('2026-11-01')).toBeTypeOf('string');
		c.setShare(1, 'abc');
		expect(c.splitProblem()).toBe(true);
		c.setAmount('5000');
		expect(c.shares()[1]?.amount).toBe('abc');
		c.setShare(1, '');
		c.reference.set('UTR 1');
		expect(c.canSave()).toBe(true);
		gateway.recordReceipt.mockReturnValueOnce(of(null));
		await c.save();
		expect(gateway.recordReceipt.mock.calls[0]?.[1]).toMatchObject({
			allocations: [{ orderId: 'o1', amountINR: 1000 }],
		});
		expect(activeModal.close).toHaveBeenCalledWith(true);
		gateway.recordReceipt.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(c.error()).toBe('ord_action_failed');
		c.amount.set('x');
		await c.save();
		expect(gateway.recordReceipt).toHaveBeenCalledTimes(2);
	});

	it('set-off: names the standing agreement, picks a one-off copy and refuses a save it cannot make', async () => {
		const { c, gateway, modals, activeModal } = popup(BusinessSetOffPopup);
		expect(c.agreementLine()).toBe('');
		await c.save();
		c.start(
			business({
				setOff: {
					mode: 'agreement',
					reference: 'STS/1',
					signedOn: '2026-01-01',
					validUntil: '2099-12-31',
					mediaId: 'm',
				},
			}),
			{ theyOweUsINR: 1000, weOweThemINR: 400 },
		);
		expect(c.agreementLine()).toContain('biz_setoff_agreement_line(STS/1|');
		c.start(
			business({
				setOff: {
					mode: 'agreement',
					reference: 'STS/2',
					signedOn: '2026-01-01',
					validUntil: null,
					mediaId: 'm',
				},
			}),
			{ theyOweUsINR: 1000, weOweThemINR: 400 },
		);
		expect(c.agreementLine()).toBe('STS/2');
		c.on.set('');
		expect(c.agreement()).not.toBeNull();
		c.amount.set('abc');
		expect(c.afterUs()).toBe(1000);
		expect(c.afterThem()).toBe(400);
		c.start(business(), { theyOweUsINR: 1000, weOweThemINR: 400 });
		c.on.set(c.today);
		modals.open.mockReturnValueOnce(popupRef([{ assetId: 'med_2', name: 'letter.pdf' }]) as never);
		await c.pickCopy();
		expect(c.signedCopy()).toEqual({ assetId: 'med_2', name: 'letter.pdf' });
		modals.open.mockReturnValueOnce(popupRef(new Error('closed')) as never);
		await c.pickCopy();
		expect(c.signedCopy()?.assetId).toBe('med_2');
		c.note.set('Agreed on call');
		c.letter.set(' L/1 ');
		await c.save();
		expect(gateway.recordSetOff.mock.calls[0]?.[1]).toMatchObject({
			basis: { kind: 'oneOff', reference: 'L/1', mediaId: 'med_2' },
		});
		expect(activeModal.close).toHaveBeenCalledWith(true);
		gateway.recordSetOff.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(c.error()).toBe('ord_action_failed');
		c.amount.set('');
		await c.save();
		expect(gateway.recordSetOff).toHaveBeenCalledTimes(2);
		expect(c.money(400)).toBe('₹400');
	});

	it('standing: starts at active for a business with no customer side, and shows a refusal', async () => {
		const { c, gateway, activeModal } = popup(BusinessStandingPopup);
		await c.save();
		expect(c.canSave()).toBe(false);
		c.start(business({ roles: { customer: null, supplier: true } }));
		expect(c.standing()).toBe('active');
		c.standing.set('blocked');
		c.reason.set('Paid late twice');
		gateway.setStanding.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(c.error()).toBe('ord_action_failed');
		await c.save();
		expect(activeModal.close).toHaveBeenCalled();
	});
});
