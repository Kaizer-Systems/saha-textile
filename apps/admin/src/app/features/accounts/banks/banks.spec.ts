import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { BANK_CHIPS as CONTRACT_CHIPS } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BANK_CHIPS, BanksGateway } from '@core/accounts/banks.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';

import { BANK_KINDS, BankFormPage, bankProblemKey } from './bank-form';
import { BankPage } from './bank-page';
import { BanksListPage, drCr } from './banks-list';

/** Bank accounts in the admin (accounts brief BA1–BA3). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const account = (patch: Record<string, unknown> = {}) => ({
	id: 'bank_1',
	ledgerId: 'led_1',
	kind: 'current',
	ifsc: 'HDFC0001234',
	bankName: 'HDFC Bank',
	branch: 'Barasat',
	holder: 'K.R. Marketing',
	number: '50200012344821',
	numberShown: '50200012344821',
	shortName: 'HDFC Bank · Barasat',
	limitINR: null,
	ratePercent: null,
	maturesOn: null,
	locationId: null,
	openingINR: 3_12_000,
	openingOn: '2026-11-01',
	chequeFrom: '000401',
	chequeTo: '000450',
	upiIds: ['shop@hdfcbank'],
	active: true,
	openingVoucherId: 'jv_1',
	version: 2,
	createdAt: '2026-11-24T06:00:00.000Z',
	updatedAt: '2026-11-24T06:00:00.000Z',
	updatedBy: null,
	balancePaise: 31_200_000,
	lastStatementOn: null,
	toMatch: 0,
	lands: ['receivedByGateway'],
	...patch,
});

function mount<T>(component: Type<T>, gateway: Record<string, unknown>, id: string | null = null) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			provideRouter([]),
			{ provide: BanksGateway, useValue: gateway },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([{ id: 'loc_bar', name: 'Barasat' }])) } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(id ? { id } : {})),
					snapshot: { paramMap: convertToParamMap(id ? { id } : {}) },
				},
			},
		],
	});
	const router = TestBed.inject(Router);
	const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, navigate };
}

describe('the bank accounts list (BA1)', () => {
	it('shows each account with what lands there, filters by chip, and opens or adds', async () => {
		const items = [
			account(),
			account({
				id: 'b2',
				kind: 'overdraft',
				lands: [],
				balancePaise: -100,
				shortName: 'ICICI OD',
				bankName: 'ICICI Bank',
				lastStatementOn: '2026-11-20',
			}),
			account({ id: 'b3', kind: 'fixed_deposit', lands: [] }),
		];
		const { fixture, page, navigate } = mount(BanksListPage, {
			list: vi.fn(() => of({ items, counts: { all: 3, current: 1, credit: 1, deposits: 1 }, manage: true })),
		});
		await settle(fixture);
		const data = page.tableConfig().data;
		expect(data.map((r) => [r['kindText'], r['balanceText'], r['statementText']])).toEqual([
			['bank_kind_current', '₹3,12,000.00 Dr', '—'],
			['bank_kind_overdraft', '₹1.00 Cr', '2026-11-20'],
			['bank_kind_fixed_deposit', '₹3,12,000.00 Dr', '—'],
		]);
		expect(data[0]!['accountHtml']).toContain('bank_lands_receivedByGateway');
		expect(data[1]!['accountHtml']).toContain('ICICI Bank');
		page.chip.set('credit');
		expect(page.tableConfig().data.map((r) => r.id)).toEqual(['b2']);
		page.onAction({ actionToPerform: 'view', data: data[0] } as never);
		page.onAction({ actionToPerform: 'other', data: data[0] } as never);
		page.onAction({ actionToPerform: 'view' } as never);
		(fixture.nativeElement.querySelector('#bank_add') as HTMLButtonElement).click();
		expect(navigate.mock.calls).toEqual([[['/accounts/banks', 'bank_1']], [['/accounts/banks/new']]]);
		const empty = mount(BanksListPage, { list: vi.fn(() => of(undefined)) });
		expect(empty.page.tableConfig().total).toBe(0);
	});
});

describe('adding and changing a bank account (BA2)', () => {
	it('fills the bank from the IFSC, needs what the account must have, and adds it', async () => {
		const add = vi.fn(() => of({ id: 'bank_9' }));
		const ifsc = vi.fn((code: string) =>
			code === 'HDFC0001234' ? of({ ifsc: code, bankName: 'HDFC Bank' }) : throwError(() => new Error('down')),
		);
		const { fixture, page, navigate } = mount(BankFormPage, { add, ifsc });
		await page.ifsc('hdfc');
		expect(ifsc).not.toHaveBeenCalled();
		await page.ifsc(' hdfc0001234 ');
		expect(page.form().bankName).toBe('HDFC Bank');
		await page.ifsc('SBIN0001234');
		expect(page.form().bankName).toBe('HDFC Bank');
		page.set('bankName', '');
		await page.ifsc('HDFC0001234');
		expect(page.form().bankName).toBe('HDFC Bank');
		expect(page.ready()).toBe(false);
		await page.save();
		expect(add).not.toHaveBeenCalled();
		page.set('holder', 'K.R. Marketing');
		page.set('number', '50200012344821');
		page.set('shortName', 'HDFC main');
		page.set('openingINR', 5_000);
		expect(page.ready()).toBe(false);
		page.set('openingOn', '2026-11-01');
		page.set('kind', 'cash_credit');
		fixture.detectChanges();
		expect([page.credit(), page.deposit()]).toEqual([true, false]);
		page.set('kind', 'fixed_deposit');
		fixture.detectChanges();
		expect(page.deposit()).toBe(true);
		page.upiText.set('shop@hdfcbank, x, other@icici ');
		(fixture.nativeElement.querySelector('#bank_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'fixed_deposit',
				upiIds: ['shop@hdfcbank', 'other@icici'],
				openingINR: 5_000,
			}),
		);
		expect(navigate).toHaveBeenCalledWith(['/accounts/banks', 'bank_9']);
		page.cancel();
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/banks']);
	});

	it('loads an account to change, saves it over its version, and words a refusal', async () => {
		const edit = vi.fn(() => throwError(() => ({ error: { message: 'bank_account_exists' } })));
		const { fixture, page, navigate } = mount(BankFormPage, { one: vi.fn(() => of(account())), edit }, 'bank_1');
		await settle(fixture);
		expect([page.form().shortName, page.version(), page.upiText()]).toEqual([
			'HDFC Bank · Barasat',
			2,
			'shop@hdfcbank',
		]);
		await page.save();
		expect(edit).toHaveBeenCalledWith(
			'bank_1',
			expect.objectContaining({ version: 2, shortName: 'HDFC Bank · Barasat' }),
		);
		expect(page.problem()).toBe('bank_problem_bank_account_exists');
		page.cancel();
		expect(navigate).toHaveBeenLastCalledWith(['/accounts/banks', 'bank_1']);
		expect([bankProblemKey('boom'), BANK_KINDS.length]).toEqual(['bank_problem_failed', 5]);
	});
});

const noLines = () => of({ items: [], total: 0, counts: {} });

describe('a bank account’s page (BA3)', () => {
	it('shows its details, limit or rate where it has them, and links to its statement', async () => {
		const { fixture, page } = mount(
			BankPage,
			{
				one: vi.fn(() =>
					of(
						account({
							limitINR: 40_00_000,
							ratePercent: 7.1,
							maturesOn: null,
							branch: '',
							chequeFrom: '',
							chequeTo: '',
							upiIds: [],
							lands: ['receivedByGateway', 'paidByBank'],
						}),
					),
				),
				lines: vi.fn(noLines),
			},
			'bank_1',
		);
		await settle(fixture);
		page.tab.set('details');
		fixture.detectChanges();
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('₹40,00,000.00');
		expect(text).toContain('7.1%');
		expect((fixture.nativeElement.querySelector('#bank_statement') as HTMLAnchorElement).getAttribute('href')).toBe(
			'/accounts/ledgers/led_1',
		);
		expect([page.money(null), page.balance(-5)]).toEqual(['—', '₹0.05 Cr']);
		const bare = mount(BankPage, { one: vi.fn(() => of(account({ lands: [] }))), lines: vi.fn(noLines) }, 'bank_1');
		await settle(bare.fixture);
		bare.page.tab.set('details');
		bare.fixture.detectChanges();
		expect(bare.fixture.nativeElement.textContent).toContain('—');
		expect(drCr(0)).toBe('₹0.00 Dr');
		const none = mount(BankPage, { one: vi.fn() });
		await settle(none.fixture);
		expect(none.page.id()).toBe('');
	});
});

describe('the bank gateway', () => {
	it('calls each bank route and keeps the chips equal to the contract’s', () => {
		expect([...BANK_CHIPS]).toEqual([...CONTRACT_CHIPS]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(BanksGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/banks`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.list(), 'GET', ''],
			[() => gateway.one('b/1'), 'GET', '/b%2F1'],
			[() => gateway.ifsc('HDFC0001234'), 'GET', '/ifsc?code=HDFC0001234'],
			[() => gateway.add({} as never), 'POST', ''],
			[() => gateway.edit('b/1', {} as never), 'PUT', '/b%2F1'],
			[() => gateway.layouts(), 'GET', '/layouts'],
			[() => gateway.saveLayout({} as never), 'PUT', '/layouts'],
			[() => gateway.preview('b/1', {} as never), 'POST', '/b%2F1/lines/preview'],
			[() => gateway.saveLines('b/1', {} as never), 'POST', '/b%2F1/lines'],
			[() => gateway.lines('b/1', { from: '2026-11-01', page: 2 }), 'GET', '/b%2F1/lines?from=2026-11-01&page=2'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});
