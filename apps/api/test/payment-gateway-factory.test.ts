import { randomBytes } from 'node:crypto';

import { CcavenuePaymentGateway, PayPalPaymentGateway } from '@saha-textile/adapters-payments';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/app-config';
import {
	buildCheckoutGateways,
	buildInrPaymentGateway,
	buildPayPalGateway,
	buildPaymentRequestPorts,
} from '../src/infra/payment-gateway-factory';
import { UnavailablePaymentGateway } from '../src/infra/unavailable-payment-gateway.adapter';

/** Only the parts the factory reads; production is never loaded here (it demands every hardening setting). */
const config = (paypal: Record<string, string | undefined>, deployEnv: string | undefined = 'development') =>
	({ deployEnv, payments: { paypal, ccavenue: { configured: false } } }) as never;
const keys = { clientId: 'client-test', clientSecret: 'secret-test' };

describe('PayPal on or off', () => {
	it('stays off quietly without keys outside production, and says so in production', () => {
		const logger = { warn: vi.fn() };
		expect(buildPayPalGateway(config({}), logger as never)).toBeNull();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(buildPayPalGateway(config({}, 'production'), logger as never)).toBeNull();
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(buildPayPalGateway(config({}))).toBeNull();
	});

	it('says why it stays off with keys but no usable environment', () => {
		const logger = { warn: vi.fn() };
		expect(buildPayPalGateway(config({ ...keys, env: 'moon' }), logger as never)).toBeNull();
		expect(buildPayPalGateway(config({ ...keys, env: 'live' }), logger as never)).toBeNull();
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it('turns on with keys and the sandbox outside production', () => {
		expect(buildPayPalGateway(config({ ...keys, env: 'sandbox' }))).toBeInstanceOf(PayPalPaymentGateway);
	});
});

describe('the checkout gateways and payment-request ports', () => {
	const ccavenue = () =>
		buildInrPaymentGateway(
			loadConfig({
				JWT_ACCESS_SECRET: 'a'.repeat(32),
				JWT_REFRESH_SECRET: 'b'.repeat(32),
				CCAVENUE_MERCHANT_ID: '123456',
				CCAVENUE_ACCESS_CODE: 'TESTACCESSCODE',
				CCAVENUE_WORKING_KEY: randomBytes(16).toString('hex'),
				CCAVENUE_RETURN_URL: 'https://api.example.test/payments/return',
			} as NodeJS.ProcessEnv),
		);

	it('leaves the INR gateway out until it has its keys, and PayPal out while off', () => {
		expect(buildCheckoutGateways(config({}), new UnavailablePaymentGateway('ccavenue'))).toEqual({
			inr: null,
			paypal: null,
		});
		const both = buildCheckoutGateways(config({ ...keys, env: 'sandbox' }), ccavenue());
		expect(both.inr).toBeInstanceOf(CcavenuePaymentGateway);
		expect(both.paypal).toBeInstanceOf(PayPalPaymentGateway);
	});

	it('sends payment requests through CCAvenue and PayPal only when each is there', () => {
		const both = buildCheckoutGateways(config({ ...keys, env: 'sandbox' }), ccavenue());
		expect([...buildPaymentRequestPorts(both).keys()]).toEqual(['ccavenue', 'paypal']);
		const other = { gateway: 'other' } as never;
		expect(buildPaymentRequestPorts({ inr: other, paypal: null }).size).toBe(0);
	});
});
