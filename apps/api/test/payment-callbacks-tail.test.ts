import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PaymentCallbacksController } from '../src/shop-checkout/payment-callbacks.controller';

function setup(answer: 'fail' | 'attempt') {
	const payments = {
		ccavenueReturn: vi.fn(async () => {
			if (answer === 'fail') throw new Error('forged');
			return { id: 'att_1' };
		}),
		localeOf: vi.fn(async () => 'bn'),
		resultPage: vi.fn((id: string, locale: string) => `https://shop.test/${locale}/pay/${id}`),
		paypalWebhook: vi.fn(async (_headers: Record<string, string | undefined>, _raw: string) => {
			if (answer === 'fail') throw new Error('bad signature');
			return 'settled';
		}),
	};
	return { payments, controller: new PaymentCallbacksController(payments as never) };
}

describe('what the gateways send us', () => {
	it('sends the browser to the result page of the attempt, in its language, or of "unknown" when the return fails', async () => {
		const redirect = vi.fn(async () => undefined);
		const good = setup('attempt');
		await good.controller.ccavenueReturn({ body: {} } as never, { redirect } as never);
		const bad = setup('fail');
		await bad.controller.ccavenueReturn({ body: {} } as never, { redirect } as never);
		expect(redirect.mock.calls).toEqual([
			['https://shop.test/bn/pay/att_1', 303],
			['https://shop.test/en/pay/unknown', 303],
		]);
	});

	it('answers CCAvenue’s notice the same way whether it was read or not', async () => {
		await expect(setup('fail').controller.ccavenueNotify({ body: {} } as never)).resolves.toEqual({
			received: true,
		});
	});

	it('reads PayPal’s headers in lower case, first value of each, and refuses what cannot be checked', async () => {
		const good = setup('attempt');
		await expect(
			good.controller.paypalWebhook({
				headers: { 'PayPal-Transmission-Id': ['t1', 't2'], 'paypal-auth-algo': 'SHA256withRSA' },
				rawBody: Buffer.from('{"id":"WH-1"}'),
			} as never),
		).resolves.toEqual({ received: true });
		expect(good.payments.paypalWebhook).toHaveBeenCalledWith(
			{ 'paypal-transmission-id': 't1', 'paypal-auth-algo': 'SHA256withRSA' },
			'{"id":"WH-1"}',
		);
		const bad = setup('fail');
		await expect(bad.controller.paypalWebhook({ headers: {} } as never)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(bad.payments.paypalWebhook).toHaveBeenCalledWith({}, '');
	});
});
