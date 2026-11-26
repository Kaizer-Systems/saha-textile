import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { type Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';

import { PaymentReturn } from './payment-return';

const outcome = (over: Record<string, unknown>) => ({
	orderId: 'o1',
	orderNumber: 'ST-2611-482190',
	result: 'paid',
	popup: null,
	firstCurrency: null,
	soldOutLineIds: [],
	...over,
});

const render = (query: Record<string, string>, answer: Observable<unknown>) => {
	const confirm = vi.fn(() => answer);
	const navigate = vi.fn(async () => true);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
			{ provide: Router, useValue: { navigate } },
			{ provide: CheckoutGateway, useValue: { confirm } },
		],
	});
	TestBed.overrideComponent(PaymentReturn, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(PaymentReturn).componentInstance, confirm, navigate };
};

describe('Back from the gateway (OD1, shop04, shop05)', () => {
	it('says paid, pending and refunded here', async () => {
		for (const result of ['paid', 'pending', 'refunded']) {
			const { page, navigate } = render({ attempt: 'a1' }, of(outcome({ result })));
			await page.ngOnInit();
			expect(page.outcome()?.result).toBe(result);
			expect(navigate).not.toHaveBeenCalled();
		}
	});

	it('sends a payment that didn’t go through back to the checkout, which opens the popup', async () => {
		const { page, confirm, navigate } = render(
			{ attempt: 'a1', token: '5O190127TN364715T' },
			of(outcome({ result: 'failed', popup: 'switchToRegionCurrency', firstCurrency: 'GBP' })),
		);
		await page.ngOnInit();
		expect(confirm).toHaveBeenCalledWith('a1', { token: '5O190127TN364715T', cancelled: false });
		expect(navigate).toHaveBeenCalledWith(['/checkout'], {
			replaceUrl: true,
			state: { paymentOutcome: { popup: 'switchToRegionCurrency', firstCurrency: 'GBP' } },
		});
		expect(page.outcome()).toBeNull();
	});

	it('passes the gateway’s Cancel on and ignores a token that isn’t PayPal’s', async () => {
		const { page, confirm } = render(
			{ attempt: 'a1', token: 'not a token', cancelled: '1' },
			of(outcome({ result: 'cancelled', popup: 'chooseCurrency', firstCurrency: 'INR' })),
		);
		await page.ngOnInit();
		expect(confirm).toHaveBeenCalledWith('a1', { cancelled: true });
	});

	it('says it couldn’t check without an attempt, or when the check fails', async () => {
		const missing = render({}, of(outcome({})));
		await missing.page.ngOnInit();
		expect(missing.page.failed()).toBe(true);
		expect(missing.confirm).not.toHaveBeenCalled();
		const broken = render(
			{ attempt: 'a1' },
			throwError(() => new Error('offline')),
		);
		await broken.page.ngOnInit();
		expect(broken.page.failed()).toBe(true);
	});

	it('is its own page beside the checkout, behind the shop’s sign-in', async () => {
		const page = await import('../../../../pages/checkout/payment-return.page');
		const { AuthGuard } = await import('@core/guards/auth.guard');
		expect(page.default).toBe(PaymentReturn);
		expect(page.routeMeta.canActivate).toContain(AuthGuard);
	});
});
