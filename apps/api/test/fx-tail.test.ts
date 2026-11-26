import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { adminNames } from '../src/common/admin-names';
import { FX_RATE_PORT } from '../src/fx/fx-admin.service';
import { fetchRatesNow } from '../src/fx/fx-fetch';
import { FxModule } from '../src/fx/fx.module';
import { PaymentRoutingService, gatewayRoutingOf } from '../src/fx/payment-routing.service';

const routing = (over: Record<string, unknown> = {}) => ({
	activeInrGateway: 'ccavenue',
	paypalTakesNewPayments: true,
	testMode: { ccavenue: false, razorpay: false, paypal: false },
	popups: { paypalChooseCurrency: true, inrCardRefused: true },
	revision: 4,
	...over,
});

describe('rates and payment routing: the last cases', () => {
	it('builds the rates adapter with the key, or without one', () => {
		const providers = Reflect.getMetadata('providers', FxModule) as Array<{
			provide: unknown;
			useFactory?: (config: unknown) => unknown;
		}>;
		const factory = providers.find((row) => row.provide === FX_RATE_PORT)?.useFactory as (
			config: unknown,
		) => unknown;
		expect(factory({ fx: { exchangeRateApiKey: 'key' } })).toBeDefined();
		expect(factory({ fx: {} })).toBeDefined();
	});

	it('records a failed fetch that threw something other than an error', async () => {
		const set = vi.fn(async () => undefined);
		const result = await fetchRatesNow(
			{
				settings: { get: async () => null, set },
				currencies: { listAll: async () => [], upsert: async () => undefined },
				fx: {
					getAllRatesFromINR: async () => {
						throw 'rate limit reached';
					},
				},
			} as never,
			new Date('2026-11-24T00:30:00.000Z'),
		);
		expect(result).toMatchObject({ ok: false, problem: 'rate limit reached' });
	});

	it('routes every other currency to PayPal while PayPal takes new payments', () => {
		expect(gatewayRoutingOf(routing() as never)).toEqual({
			activeInrGateway: 'ccavenue',
			foreignGateway: 'paypal',
			homeCurrency: 'INR',
		});
	});

	it('refuses a stale save without naming anyone when nobody is known, and saves without an audit trail', async () => {
		const set = vi.fn(async () => undefined);
		let stored: Record<string, unknown> = routing({ updatedBy: null });
		const svc = new PaymentRoutingService(
			{
				get: async () => stored,
				set: async (_key: string, value: Record<string, unknown>) => {
					stored = value;
					await set();
				},
			} as never,
			{ payments: { ccavenue: { merchantId: '' }, paypal: {} }, deployEnv: 'local' } as never,
		);
		await expect(svc.save(routing({ revision: 1 }) as never, 'adm_1')).rejects.toMatchObject({
			response: { issues: [{ code: 'stale_revision' }] },
		});
		stored = routing({ updatedBy: 'adm_2', updatedAt: '2026-11-20T10:00:00.000Z' });
		await expect(svc.save(routing({ revision: 1 }) as never, 'adm_1')).rejects.toMatchObject({
			response: { issues: [{ code: 'stale_revision', params: { changedAt: '2026-11-20T10:00:00.000Z' } }] },
		});
		await svc.save(routing({ revision: 4, paypalTakesNewPayments: false }) as never, 'adm_1');
		expect(stored).toMatchObject({ revision: 5, paypalTakesNewPayments: false, updatedBy: 'adm_1' });
	});
});

describe('the names admins know each other by: the last cases', () => {
	it('names nobody without the admin list, and leaves out an admin whose read failed', async () => {
		expect(await adminNames(null, ['adm_1'])).toEqual(new Map());
		const names = await adminNames(
			{
				findById: async (id: string) => {
					if (id === 'adm_bad') throw new Error('db down');
					return { displayName: 'Moulik' } as never;
				},
			},
			['adm_1', 'adm_bad'],
		);
		expect(names).toEqual(new Map([['adm_1', 'Moulik']]));
	});
});
