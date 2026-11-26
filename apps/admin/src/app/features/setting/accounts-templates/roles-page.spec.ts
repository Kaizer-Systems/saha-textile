import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { RolesPage } from './roles-page';

/** Settings › Accounts templates › Roles (AT4). */

const rows = [
	{
		key: 'cash',
		target: 'ledger',
		usedBy: ['paymentVoucher', 'supplierPayment'],
		holderId: 'led_cash',
		holderName: 'Cash',
		fromTemplate: 'CH-COMMON v2',
		problem: null,
	},
	{
		key: 'gateway_clearing',
		target: 'ledger',
		usedBy: ['receipt'],
		holderId: null,
		holderName: null,
		fromTemplate: null,
		problem: 'missing',
	},
	{
		key: 'cash_in_hand',
		target: 'group',
		usedBy: ['contra'],
		holderId: 'grp_cash',
		holderName: 'Cash in hand',
		fromTemplate: null,
		problem: null,
	},
];

function setup(options: { fail?: unknown; permissions?: string[]; rows?: unknown[] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const gateway = {
		roles: vi.fn(() => of(options.rows ?? rows)),
		pointRole: vi.fn(() => (options.fail ? throwError(() => options.fail) : of(rows))),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [RolesPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: AccountsTemplatesGateway, useValue: gateway },
			{
				provide: LedgerGateway,
				useValue: {
					chart: () =>
						of({
							groups: [],
							ledgers: [
								{ id: 'led_cash', name: 'Cash', active: true },
								{ id: 'led_till', name: 'Till', active: true },
								{ id: 'led_old', name: 'Old', active: false },
							],
						}),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts_template.edit']) },
			},
		],
	});
	const fixture = TestBed.createComponent(RolesPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier };
}

describe('roles in the books (AT4)', () => {
	it('lists each role, who plays it and the template that set it, and counts the problems', async () => {
		const { fixture, page } = setup();
		expect([page.problems(), page.choices()]).toEqual([0, []]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.roles.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.choices().map((l) => l.id)).toEqual(['led_cash', 'led_till']));
		fixture.detectChanges();
		expect(page.problems()).toBe(1);
		expect(page.usedBy(rows[0] as never)).toBe('en.ar_doc_paymentVoucher, en.ar_doc_supplierPayment');
		const readOnly = setup({ permissions: [], rows: [rows[0], rows[2]] });
		readOnly.fixture.detectChanges();
		await vi.waitFor(() => expect(readOnly.page.roles.data()).toBeTruthy());
		readOnly.fixture.detectChanges();
		expect(readOnly.page.canEdit()).toBe(false);
	});

	it('points a ledger role at another ledger, and does nothing for the same one or none', async () => {
		const { page, gateway, notifier } = setup();
		await page.point(rows[0] as never, '');
		await page.point(rows[0] as never, 'led_cash');
		expect(gateway.pointRole).not.toHaveBeenCalled();
		await page.point(rows[0] as never, 'led_till');
		expect(gateway.pointRole).toHaveBeenCalledWith('cash', 'led_till');
		expect(notifier.showSuccess).toHaveBeenCalled();
		expect(page.busy()).toBe(false);
	});

	it('says why pointing was refused', async () => {
		const refused = (message: string) => ({ error: { error: { issues: [{ code: message, message }] } } });
		for (const [fail, words] of [
			[refused('roles_super_admin_only'), 'ar_problem_roles_super_admin_only'],
			[new Error('offline'), 'at_action_failed'],
		] as const) {
			const { page, notifier } = setup({ fail });
			await page.point(rows[1] as never, 'led_till');
			expect(notifier.showError).toHaveBeenCalledWith(expect.stringContaining(words));
		}
	});
});
