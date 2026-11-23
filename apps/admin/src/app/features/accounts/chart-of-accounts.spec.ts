import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { MoneyLandingGateway } from '@core/accounts/money-landing.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ChartOfAccountsPage } from './chart-of-accounts';

/** Accounts › Ledgers (brief Q1) with the "Where money lands" card under it (AP1). */

const at = '2026-11-23T00:00:00.000Z';
const group = (id: string, systemKey: string | null, parentId: string | null, order: number) => ({
	id,
	systemKey,
	roles: [],
	name: id,
	parentId,
	nature: 'asset',
	tradingAccount: false,
	order,
	createdAt: at,
	updatedAt: at,
});
const ledger = (id: string, groupId: string, extra: Record<string, unknown> = {}) => ({
	id,
	systemKey: null,
	roles: [],
	name: id,
	groupId,
	nature: 'asset',
	handPosting: true,
	active: true,
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
	...extra,
});
const fullChart = {
	groups: [
		group('g_ca', 'current_assets', null, 1),
		group('g_cash', 'cash_in_hand', 'g_ca', 2),
		group('g_exp', 'indirect_expenses', null, 3),
	],
	ledgers: [
		ledger('cash', 'g_cash', { systemKey: 'cash', handPosting: false }),
		ledger('rent', 'g_exp'),
		ledger('old', 'g_exp', { active: false }),
	],
};

function setup(options: { chart?: unknown; permissions?: string[]; fail?: unknown; noBalances?: boolean } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const result = () => (options.fail ? throwError(() => options.fail) : of({}));
	const gateway = {
		chart: vi.fn(() => of(options.chart ?? fullChart)),
		balances: vi.fn(() => (options.noBalances ? NEVER : of({ cash: 250_000, rent: -1_000 }))),
		addGroup: vi.fn(result),
		addLedger: vi.fn(result),
		saveLedger: vi.fn(result),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [ChartOfAccountsPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: LedgerGateway, useValue: gateway },
			{ provide: CompanyGateway, useValue: { profile: () => of({ kind: 'llp' }) } },
			{ provide: MoneyLandingGateway, useValue: { get: () => of({}), save: () => of({}) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['accounts.edit']) } },
		],
	});
	const fixture = TestBed.createComponent(ChartOfAccountsPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
}

describe('Accounts › Ledgers', () => {
	it('draws the tree with balances, top groups open, and opens or closes any level', async () => {
		const { fixture, page } = setup();
		expect(page.tree()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tree()).toHaveLength(2));
		await vi.waitFor(() => expect(page.tree()[0]?.balancePaise).toBe(250_000));
		fixture.detectChanges();
		expect(page.canEdit()).toBe(true);
		expect([0, 1, 2, 3, 4, 9].map((depth) => page.indent(depth))).toEqual([
			'ps-2',
			'ps-4',
			'ps-5',
			'ps-5 ms-3',
			'ps-5 ms-5',
			'ps-5 ms-5',
		]);
		expect(page.indent(-1)).toBe('ps-2');
		expect(page.isOpen('g_ca', 0)).toBe(true);
		page.toggle('g_ca', 0);
		expect(page.isOpen('g_ca', 0)).toBe(false);
		page.toggle('g_ca', 0);
		expect(page.isOpen('g_ca', 0)).toBe(true);
		expect(page.isOpen('g_cash', 1)).toBe(false);
		page.toggle('g_cash', 1);
		fixture.detectChanges();
		expect(page.isOpen('g_cash', 1)).toBe(true);
		page.toggle('g_cash', 1);
		expect(page.isOpen('g_cash', 1)).toBe(false);
		expect(page.drCr(250_000)).toContain('Dr');
	});

	it('opens the side form for a group, a new ledger and a ledger to edit, and patches it', async () => {
		const { fixture, page } = setup();
		page.patch({ name: 'nothing open' });
		expect(page.editing()).toBeNull();
		page.addGroup();
		expect(page.editing()).toEqual({ kind: 'group', name: '', parentId: '' });
		page.addLedger();
		expect(page.editing()).toMatchObject({ kind: 'ledger', id: null, groupId: '' });
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tree()).toHaveLength(2));
		page.addGroup();
		expect(page.editing()).toMatchObject({ parentId: 'g_ca' });
		fixture.detectChanges();
		page.addLedger();
		expect(page.editing()).toMatchObject({ groupId: 'g_exp' });
		page.editLedger(fullChart.ledgers[0] as never);
		expect(page.editing()).toMatchObject({ id: 'cash', system: true, expectedUpdatedAt: at });
		page.editLedger(fullChart.ledgers[1] as never);
		expect(page.editing()).toMatchObject({ id: 'rent', system: false });
		page.patch({ name: 'Shop rent' });
		fixture.detectChanges();
		expect(page.editing()).toMatchObject({ name: 'Shop rent', groupId: 'g_exp' });

		const noIndirect = setup({ chart: { groups: [group('g_x', null, null, 1)], ledgers: [] }, noBalances: true });
		noIndirect.fixture.detectChanges();
		await vi.waitFor(() => expect(noIndirect.page.tree()).toHaveLength(1));
		noIndirect.page.addLedger();
		expect(noIndirect.page.editing()).toMatchObject({ groupId: 'g_x' });
	});

	it('saves a group, a ledger change and a new ledger, and says why a save failed', async () => {
		const { fixture, page, gateway, notifier } = setup();
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tree()).toHaveLength(2));
		await page.save();
		expect(gateway.addGroup).not.toHaveBeenCalled();

		page.addGroup();
		page.patch({ name: 'Shops' });
		await page.save();
		expect(gateway.addGroup).toHaveBeenCalledWith({ name: 'Shops', parentId: 'g_ca' });
		expect(page.editing()).toBeNull();

		page.editLedger(fullChart.ledgers[1] as never);
		await page.save();
		expect(gateway.saveLedger).toHaveBeenCalledWith('rent', {
			name: 'rent',
			groupId: 'g_exp',
			active: true,
			expectedUpdatedAt: at,
		});

		page.addLedger();
		page.patch({ name: 'Electricity' });
		await page.save();
		expect(gateway.addLedger).toHaveBeenCalledWith({
			name: 'Electricity',
			groupId: 'g_exp',
			active: true,
			expectedUpdatedAt: null,
		});
		expect(notifier.showSuccess).toHaveBeenCalledTimes(3);

		for (const [fail, words] of [
			[{ error: { error: { message: 'ledger_changed' } } }, 'accounts_ledger_changed'],
			[new Error('offline'), 'accounts_chart_save_failed'],
		] as const) {
			const failing = setup({ fail });
			failing.page.addGroup();
			await failing.page.save();
			expect(failing.notifier.showError).toHaveBeenCalledWith(expect.stringContaining(words));
			expect(failing.page.saving()).toBe(false);
			expect(failing.page.editing()).not.toBeNull();
		}

		const readOnly = setup({ permissions: [] });
		readOnly.fixture.detectChanges();
		readOnly.page.addGroup();
		await readOnly.page.save();
		expect(readOnly.gateway.addGroup).not.toHaveBeenCalled();
	});
});
