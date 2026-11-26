import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PurchaseSettings } from './purchase-settings';

const h = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	bump: (): void => undefined,
	options: [] as Array<() => { queryKey: unknown[]; queryFn: () => unknown; enabled?: boolean }>,
	confirm: true,
	asked: [] as unknown[],
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	const { computed, signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	return {
		...actual,
		injectQuery: (options: (typeof h.options)[number]) => {
			h.options.push(options);
			return {
				data: computed(() => {
					version();
					return h.data.get(String(options().queryKey[0]));
				}),
			};
		},
	};
});
vi.mock('@features/purchasing/shared/popups', () => ({
	askConfirm: async (_modals: unknown, ask: unknown) => {
		h.asked.push(ask);
		return h.confirm;
	},
}));

const settings = (over: Record<string, unknown> = {}) => ({
	stepRules: {
		draftRoleId: 'role_buyer',
		checkRoleId: null,
		postRoleId: 'role_gone',
		paymentRoleId: null,
		checkByDifferentPerson: true,
		postByDifferentPerson: false,
		paymentByDifferentPerson: false,
	},
	priceChangeWarnPct: 10,
	marginFloorPct: 20,
	heldReminderDays: 14,
	booksClosedUpTo: '2026-03-31',
	unpaidAlertDays: 30,
	defaultPaymentTermsDays: 30,
	defaultDeliverTo: 'loc_1',
	business: { legalName: 'Roy Textiles' },
	canChangeSteps: true,
	stepRoleLabels: { role_gone: 'Old buyer' },
	...over,
});

function make(permissions = ['setting.edit', 'role.index'], given: unknown = settings()) {
	const start = given ?? undefined;
	h.data.set('inventory-settings', start);
	h.data.set('admin-roles', {
		items: [
			{ id: 'role_buyer', label: 'Buyer', permissions: ['purchase.create', 'purchase.check'] },
			{ id: 'role_cashier', label: 'Cashier', permissions: ['purchase.payment'] },
		],
	});
	const gateway = {
		settings: vi.fn(() => of(start)),
		saveSettings: vi.fn((_body: unknown) => of(settings({ priceChangeWarnPct: 12 }))),
	};
	const roles = { list: vi.fn(() => of({ items: [] })) };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queryClient = { setQueryData: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StockGateway, useValue: gateway },
			{ provide: AdminRolesGateway, useValue: roles },
			{ provide: AuthStore, useValue: { permissions: () => permissions } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: NgbModal, useValue: {} },
			{ provide: QueryClient, useValue: queryClient },
		],
	});
	TestBed.overrideComponent(PurchaseSettings, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PurchaseSettings);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture, gateway, roles, notifier, queryClient };
}

afterEach(() => {
	h.data.clear();
	h.asked = [];
	h.confirm = true;
});

describe('Settings › Purchases and stock screen (x02)', () => {
	it('fills the form once, and names the roles each step can use', async () => {
		const { c, gateway, roles } = make();
		expect(c.form()?.defaultDeliverTo).toBe('loc_1');
		expect(c.typed().priceChangeWarnPct).toBe('10');
		expect(c.canChangeSteps()).toBe(true);
		expect(c.optionsFor('purchase.check')).toEqual([{ id: 'role_buyer', label: 'Buyer' }]);
		expect(c.listed('purchase.check', 'role_buyer')).toBe(true);
		expect(c.listed('purchase.post', 'role_buyer')).toBe(false);
		expect(c.roleLabel(null)).toBe('');
		expect(c.roleLabel('role_cashier')).toBe('Cashier');
		expect(c.roleLabel('role_gone')).toBe('Old buyer');
		expect(c.roleLabel('role_unknown')).toBe('role_no_longer_exists');
		expect(c.roleOf('draft')).toBe('role_buyer');
		expect(c.roleOf('check')).toBe('');
		expect(c.differentOn('checkByDifferentPerson')).toBe(true);
		expect(c.differentOn(null)).toBe(false);
		for (const options of h.options) {
			void options().enabled;
			await options().queryFn();
		}
		expect(gateway.settings).toHaveBeenCalled();
		expect(roles.list).toHaveBeenCalled();
	});

	it('reads nothing before the settings load, and keeps the steps for those who may not change them', () => {
		const { c } = make(['setting.edit'], null);
		expect(c.form()).toBeNull();
		expect(c.differentOn('checkByDifferentPerson')).toBe(false);
		expect(c.roleOf('draft')).toBe('');
		c.setRole('check', 'role_buyer');
		c.setDifferent('postByDifferentPerson', true);
		c.setBooks('2026-04-30');
		c.setDeliverTo('loc_2');
		expect(c.form()).toBeNull();
		expect(c.booksInFuture()).toBe(false);
		h.data.delete('admin-roles');
		h.data.set('inventory-settings', settings({ stepRoleLabels: {} }));
		h.bump();
		expect(c.roleLabel('role_gone')).toBe('role_no_longer_exists');
		expect(c.optionsFor('purchase.check')).toEqual([]);
		expect(make([]).c.canChangeSteps()).toBe(false);
	});

	it('changes roles, switches, books, delivery place and figures, and marks wrong figures', () => {
		const { c } = make();
		c.setRole('check', 'role_buyer');
		c.setRole('draft', '');
		c.setDifferent('postByDifferentPerson', true);
		c.setBooks('');
		c.setDeliverTo('loc_2');
		expect(c.form()?.stepRules).toMatchObject({
			checkRoleId: 'role_buyer',
			draftRoleId: null,
			postByDifferentPerson: true,
		});
		expect(c.form()?.booksClosedUpTo).toBeNull();
		c.type('marginFloorPct', '120');
		expect(c.invalid()).toEqual(['marginFloorPct']);
		c.setBooks('2999-01-01');
		expect(c.booksInFuture()).toBe(true);
	});

	it('saves the figures as numbers, asking first when the books open again', async () => {
		const { c, gateway, notifier, queryClient } = make();
		c.type('priceChangeWarnPct', '12');
		c.setBooks('2026-01-31');
		h.confirm = false;
		await c.save();
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		expect((h.asked[0] as { body: string }).body).toBe('books_reopen_body');
		h.confirm = true;
		c.setBooks('');
		await c.save();
		expect((h.asked[1] as { body: string }).body).toBe('books_reopen_body_all');
		expect(gateway.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ priceChangeWarnPct: 12, booksClosedUpTo: null }),
		);
		expect(queryClient.setQueryData).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('settings_saved');
		expect(c.typed().priceChangeWarnPct).toBe('12');
		gateway.saveSettings.mockReturnValueOnce(throwError(() => new Error('down')));
		c.setBooks('2026-04-30');
		await c.save();
		expect(c.error()).toBe('purchasing_action_failed');
		c.type('heldReminderDays', '0');
		await c.save();
		c.type('heldReminderDays', '14');
		c.setBooks('2999-01-01');
		await c.save();
		c.setBooks('2026-04-30');
		c.busy.set(true);
		await c.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
	});

	it('saves without asking when the steps are not this person’s to change, or nothing loaded', async () => {
		const reader = make(['setting.edit'], settings({ canChangeSteps: false, booksClosedUpTo: null }));
		reader.c.setBooks('2026-01-31');
		await reader.c.save();
		expect(h.asked).toEqual([]);
		expect(reader.gateway.saveSettings).toHaveBeenCalled();
		const none = make(['setting.edit'], null);
		await none.c.save();
		expect(none.gateway.saveSettings).not.toHaveBeenCalled();
	});
});
