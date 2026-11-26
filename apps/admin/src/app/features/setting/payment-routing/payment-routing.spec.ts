import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FxGateway } from '@core/fx/fx.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PaymentRouting } from './payment-routing';

import type { AdminPaymentRouting, PaymentRoutingWrite } from '@saha-textile/contracts';

const ROUTING: AdminPaymentRouting = {
	settings: {
		activeInrGateway: 'ccavenue',
		paypalTakesNewPayments: true,
		testMode: { ccavenue: false, razorpay: false, paypal: false },
		popups: { paypalChooseCurrency: true, inrCardRefused: true },
		revision: 0,
		updatedBy: null,
	},
	keysOnServer: { ccavenue: false, razorpay: false, paypal: false },
	built: { ccavenue: true, razorpay: false, paypal: false },
};

const translate = (key: string, params?: Record<string, unknown>) =>
	params ? `${key}:${JSON.stringify(params)}` : key;

async function setup(options: { routing?: 'never'; permissions?: string[] } = {}) {
	const gateway = {
		routing: vi.fn(() => (options.routing === 'never' ? NEVER : of(ROUTING))),
		saveRouting: vi.fn((write: PaymentRoutingWrite) =>
			of({ ...ROUTING, settings: { ...ROUTING.settings, ...write } }),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: FxGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: TranslocoService, useValue: { translate, getActiveLang: () => 'en' } },
			{ provide: AuthStore, useValue: { permissions: () => options.permissions ?? ['setting.edit'] } },
		],
	});
	TestBed.overrideComponent(PaymentRouting, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PaymentRouting);
	fixture.detectChanges();
	for (let i = 0; i < 20 && options.routing !== 'never' && !fixture.componentInstance.draft(); i += 1) {
		await new Promise((done) => setTimeout(done, 5));
		fixture.detectChanges();
	}
	return { page: fixture.componentInstance, gateway, notifier };
}

describe('Settings › Payment method: the last cases', () => {
	it('does nothing before the settings arrive', async () => {
		const { page, gateway } = await setup({ routing: 'never', permissions: [] });
		expect(page.canEdit()).toBe(false);
		expect(page.draft()).toBeNull();
		page.patch({ paypalTakesNewPayments: false });
		expect(page.draft()).toBeNull();
		expect(page.takesNewPayments('ccavenue')).toBe(false);
		page.setTakesNewPayments('ccavenue', true);
		page.setTestMode('ccavenue', true);
		page.setPopup('inrCardRefused', false);
		expect(page.draft()).toBeNull();
		expect(page.changed()).toBe(false);
		await page.save();
		expect(gateway.saveRouting).not.toHaveBeenCalled();
	});

	it('reads PayPal’s own switch, and turning off a gateway that is not the active one changes nothing', async () => {
		const { page } = await setup();
		expect(page.canEdit()).toBe(true);
		expect(page.takesNewPayments('paypal')).toBe(true);
		expect(page.takesNewPayments('razorpay')).toBe(false);
		page.setTakesNewPayments('razorpay', false);
		expect(page.draft()?.activeInrGateway).toBe('ccavenue');
		expect(page.changed()).toBe(false);
		page.setTestMode('razorpay', true);
		page.setPopup('paypalChooseCurrency', false);
		expect(page.draft()).toMatchObject({
			testMode: { razorpay: true },
			popups: { paypalChooseCurrency: false },
		});
		expect(page.changed()).toBe(true);
	});

	it('says who saved first when the save was stale, and a plain line otherwise', async () => {
		const { page, gateway, notifier } = await setup();
		page.setTestMode('ccavenue', true);
		gateway.saveRouting.mockReturnValueOnce(
			throwError(() => ({
				error: {
					issues: [
						{
							code: 'stale_revision',
							message: 'Changed',
							params: { changedAt: '2026-11-19T07:00:00.000Z', changedBy: 'Asha Roy' },
						},
					],
				},
			})),
		);
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith(expect.stringContaining('fx_err_stale_revision_by'));
		expect(notifier.showError).toHaveBeenLastCalledWith(expect.stringContaining('Asha'));
		gateway.saveRouting.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('pay_save_failed');
		expect(page.saving()).toBe(false);
	});
});
